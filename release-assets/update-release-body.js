'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_REPOS = [
  'antigravity-cn-community/Antigravity-Chinese-Localization',
  'LAN-TINA-WS/Antigravity-Chinese-Localization'
];

const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/;

function getUsageText() {
  return [
    '用法 (Usage):',
    '  node release-assets/update-release-body.js --tag <vX.Y.Z> [--notes <path>] [--title <title>] [--repo <owner/repo>] [--make-latest]',
    '',
    '参数说明:',
    '  --tag <vX.Y.Z>      必填。目标 GitHub Release 标签名（例如 v2.32.2 或 v2.32.2.1）',
    '  --notes <path>      可选。Release Notes Markdown 文件路径（默认读取同目录 RELEASE_NOTES_<tag无v前缀>.md）',
    '  --title <title>     可选。显式指定新的 Release 标题（默认保留远端 Release 现有标题）',
    '  --repo <owner/repo> 可选。指定目标仓库（可重复传入；默认同步社区上游与个人源仓库）',
    '  --make-latest       可选开关。仅在显式传入时将该 Release 标记为 Latest（默认不修改 Latest 指向，防止历史补丁误夺 Latest）',
    '  -h, --help          显示本帮助说明'
  ].join('\n');
}

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const options = {
    tag: '',
    notesPath: '',
    title: '',
    makeLatest: false,
    repos: [],
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--make-latest') {
      options.makeLatest = true;
      continue;
    }
    if (arg === '--tag' || arg.startsWith('--tag=')) {
      const val = arg === '--tag' ? args[++i] : arg.slice('--tag='.length);
      if (!val || val.startsWith('-')) {
        throw new Error('参数 --tag 缺少有效的版本号值（例如 --tag v2.32.2.1）。');
      }
      options.tag = val.trim();
      continue;
    }
    if (arg === '--notes' || arg.startsWith('--notes=')) {
      const val = arg === '--notes' ? args[++i] : arg.slice('--notes='.length);
      if (!val || val.startsWith('-')) {
        throw new Error('参数 --notes 缺少有效的文件路径。');
      }
      options.notesPath = val.trim();
      continue;
    }
    if (arg === '--title' || arg.startsWith('--title=')) {
      const val = arg === '--title' ? args[++i] : arg.slice('--title='.length);
      if (!val) {
        throw new Error('参数 --title 缺少有效的标题内容。');
      }
      options.title = val.trim();
      continue;
    }
    if (arg === '--repo' || arg.startsWith('--repo=')) {
      const val = arg === '--repo' ? args[++i] : arg.slice('--repo='.length);
      if (!val || !/^[^/\s]+\/[^/\s]+$/.test(val.trim())) {
        throw new Error('参数 --repo 格式无效，应为 <owner/repo>。');
      }
      options.repos.push(val.trim());
      continue;
    }
    throw new Error(`未识别的命令行参数: ${arg}`);
  }

  if (options.help) {
    return options;
  }

  if (!options.tag) {
    throw new Error('缺少必填参数 --tag <vX.Y.Z>（已禁用硬编码默认版本号以防误覆盖历史 Release）。');
  }

  if (!TAG_PATTERN.test(options.tag)) {
    throw new Error(`参数 --tag 格式不合法: "${options.tag}"，必须以 v 开头并符合版本号规范（如 v2.32.2 或 v2.32.2.1）。`);
  }

  const verWithoutV = options.tag.replace(/^v/, '');
  options.notesPath = options.notesPath
    ? path.resolve(options.notesPath)
    : path.join(__dirname, `RELEASE_NOTES_${verWithoutV}.md`);

  if (options.repos.length === 0) {
    options.repos = [...DEFAULT_REPOS];
  }

  return options;
}

function updateRepoRelease(repo, { tag, body, title, makeLatest }) {
  console.log(`\n正在处理仓库: ${repo} (tag: ${tag})`);
  const viewOutput = execFileSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`], {
    encoding: 'utf-8',
    timeout: 30000
  });
  const releaseInfo = JSON.parse(viewOutput);
  console.log(`获取到 Release ID: ${releaseInfo.id}, 当前标题: ${releaseInfo.name}`);

  const payloadObj = {
    name: title || releaseInfo.name || tag,
    body
  };
  if (makeLatest) {
    payloadObj.make_latest = 'true';
  }

  const tmpPayloadFile = path.join(__dirname, `payload-${releaseInfo.id}-${process.pid}.json`);
  fs.writeFileSync(tmpPayloadFile, JSON.stringify(payloadObj), 'utf-8');

  try {
    const patchOutput = execFileSync('gh', [
      'api',
      '--method', 'PATCH',
      `repos/${repo}/releases/${releaseInfo.id}`,
      '--input', tmpPayloadFile
    ], {
      encoding: 'utf-8',
      timeout: 30000
    });

    const result = JSON.parse(patchOutput);
    console.log(`更新成功！标题: ${result.name}, Body 长度: ${(result.body || '').length}, make_latest: ${makeLatest ? 'true' : '(未变更)'}`);
  } finally {
    if (fs.existsSync(tmpPayloadFile)) {
      fs.unlinkSync(tmpPayloadFile);
    }
  }
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    console.error(`[参数错误] ${err.message}\n`);
    console.error(getUsageText());
    process.exit(1);
  }

  if (options.help) {
    console.log(getUsageText());
    process.exit(0);
  }

  if (!fs.existsSync(options.notesPath)) {
    console.error(`[文件缺失] 未找到 Release Notes 文件: ${options.notesPath}`);
    console.error('请先运行 generate-release-assets.js 生成发布说明，或通过 --notes <path> 指定文件路径。');
    process.exit(1);
  }

  const body = fs.readFileSync(options.notesPath, 'utf-8');
  if (!body.trim()) {
    console.error(`[内容为空] Release Notes 文件为空: ${options.notesPath}`);
    process.exit(1);
  }

  console.log(`目标标签: ${options.tag}`);
  console.log(`读取到 Release Notes (${options.notesPath})，长度: ${body.length} 字符`);
  console.log(`标记为 Latest: ${options.makeLatest ? '是 (--make-latest)' : '否 (默认安全模式)'}`);

  for (const repo of options.repos) {
    updateRepoRelease(repo, {
      tag: options.tag,
      body,
      title: options.title,
      makeLatest: options.makeLatest
    });
  }

  console.log('\n全部目标仓库 Release 说明更新完成！');
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_REPOS,
  TAG_PATTERN,
  getUsageText,
  parseCliArgs,
  main
};
