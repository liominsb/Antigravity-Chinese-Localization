'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ITEMS_TO_ZIP = [
  'app.asar.ready',
  'src',
  'package.json',
  'index.html',
  'localize.js',
  'auto-restore.js',
  'asar-version.js',
  'process-check.js',
  'package-installer.js',
  'release-manager.js',
  'release-assets/generate-release-assets.js',
  'release-assets/update-release-body.js',
  'tests',
  '一键更新汉化.bat',
  '一键更新汉化.command',
  '双击运行汉化.bat',
  '运行汉化.sh',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'CHANGELOG.en.md',
  'LICENSE'
];

const OPTIONAL_ITEMS = new Set([
  'src',
  'tests',
  'auto-restore.js',
  'asar-version.js',
  'process-check.js',
  'package-installer.js',
  'release-manager.js',
  'README.en.md',
  'CHANGELOG.en.md'
]);

const PYTHON_ZIP_BUILDER = `
import json
import os
import sys
import time
import zipfile

cfg = json.loads(sys.argv[1])
root_dir = os.path.abspath(cfg["rootDir"])
zip_dest = os.path.abspath(cfg["zipDest"])
items = cfg["items"]
optional_items = set(cfg.get("optionalItems", []))

SKIP_NAMES = {"__pycache__", ".DS_Store", "Thumbs.db"}

def add_file(zf, full_path, arcname):
    arc_norm = arcname.replace("\\\\", "/").lstrip("/")
    st = os.stat(full_path)
    mtime = max(int(st.st_mtime), 315561600)
    dt = time.localtime(mtime)[:6]

    with open(full_path, "rb") as f:
        data = f.read()

    lower = arc_norm.lower()
    is_exec_shell = lower.endswith(".sh") or lower.endswith(".command")
    is_win_batch = lower.endswith(".bat") or lower.endswith(".cmd")

    if is_exec_shell:
        data = data.replace(b"\\r\\n", b"\\n").replace(b"\\r", b"\\n")
        mode = 0o100755
    elif is_win_batch:
        data = data.replace(b"\\r\\n", b"\\n").replace(b"\\r", b"\\n").replace(b"\\n", b"\\r\\n")
        mode = 0o100644
    else:
        mode = 0o100644

    zinfo = zipfile.ZipInfo(filename=arc_norm, date_time=dt)
    zinfo.create_system = 3
    zinfo.flag_bits |= 0x800
    zinfo.external_attr = (mode << 16)
    zinfo.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(zinfo, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

os.makedirs(os.path.dirname(zip_dest), exist_ok=True)
if os.path.exists(zip_dest):
    os.remove(zip_dest)

count = 0
skipped = []
with zipfile.ZipFile(zip_dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for item in items:
        target = os.path.join(root_dir, item)
        if not os.path.exists(target):
            if item in optional_items:
                skipped.append(item)
                continue
            raise FileNotFoundError(f"Required release item missing: {item} ({target})")
        if os.path.isfile(target):
            add_file(zf, target, item)
            count += 1
        elif os.path.isdir(target):
            for dirpath, dirnames, filenames in os.walk(target):
                dirnames[:] = sorted(d for d in dirnames if d not in SKIP_NAMES)
                for fn in sorted(filenames):
                    if fn in SKIP_NAMES:
                        continue
                    fp = os.path.join(dirpath, fn)
                    if os.path.islink(fp):
                        continue
                    rel = os.path.relpath(fp, root_dir)
                    add_file(zf, fp, rel)
                    count += 1

print(json.dumps({"packedFiles": count, "skipped": skipped}, ensure_ascii=False))
`;

function normalizeVersion(ver) {
  return String(ver || '').trim().replace(/^[vV]/, '');
}

function getSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function getMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function findPythonExecutable() {
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['-c', 'import sys, zipfile; assert sys.version_info[0] >= 3'], {
        stdio: 'ignore',
        timeout: 10000
      });
      return cmd;
    } catch (_) {
      // Try next candidate
    }
  }
  throw new Error('未检测到可用的 Python 3 环境，无法构建跨平台 UTF-8/POSIX 权限 ZIP 资产包。');
}

function resolveVersions(rootDir) {
  const sources = [];
  const localizePath = path.join(rootDir, 'localize.js');
  if (fs.existsSync(localizePath)) {
    sources.push(fs.readFileSync(localizePath, 'utf-8'));
  }
  const srcDir = path.join(rootDir, 'src');
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    for (const name of fs.readdirSync(srcDir).sort()) {
      if (name.endsWith('.js')) {
        sources.push(fs.readFileSync(path.join(srcDir, name), 'utf-8'));
      }
    }
  }

  let releaseVer = null;
  let currentVer = null;
  for (const content of sources) {
    if (!releaseVer) {
      const m = content.match(/(?:const|let|var)\s+RELEASE_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (m) releaseVer = normalizeVersion(m[1]);
    }
    if (!currentVer) {
      const m = content.match(/(?:const|let|var)\s+CURRENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (m) currentVer = normalizeVersion(m[1]);
    }
  }

  if (!currentVer) {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) currentVer = normalizeVersion(pkg.version);
      } catch (_) {}
    }
  }

  const finalBaseVer = currentVer || releaseVer || '0.0.0';
  const finalReleaseVer = releaseVer || finalBaseVer;
  return {
    currentVer: finalReleaseVer,
    baseClientVer: finalBaseVer
  };
}

function extractChangelogSection(changelogText, targetVersion) {
  const normalized = String(changelogText || '').replace(/\r\n/g, '\n');
  const headingRegex = /^##\s+[vV]?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?)\b([^\n]*)$/gm;
  const matches = [];
  let match;
  while ((match = headingRegex.exec(normalized)) !== null) {
    matches.push({
      version: normalizeVersion(match[1]),
      rawHeadingSuffix: (match[2] || '').trim(),
      startIndex: match.index,
      bodyStartIndex: match.index + match[0].length
    });
  }

  if (matches.length === 0) {
    return {
      version: normalizeVersion(targetVersion),
      matchedExact: false,
      subtitle: '',
      body: '- 详见仓库 `CHANGELOG.md` 更新记录。'
    };
  }

  const sections = matches.map((m, idx) => {
    const endIndex = idx + 1 < matches.length ? matches[idx + 1].startIndex : normalized.length;
    let body = normalized.slice(m.bodyStartIndex, endIndex);
    body = body.replace(/\n---\s*$/g, '').trim();
    const subtitle = m.rawHeadingSuffix
      .replace(/^\([^)]*\)\s*/, '')
      .replace(/^[—–-]\s*/, '')
      .trim();
    return {
      version: m.version,
      subtitle,
      body
    };
  });

  const targetNorm = normalizeVersion(targetVersion);
  const exact = sections.find(s => s.version === targetNorm);
  if (exact) {
    return { ...exact, matchedExact: true };
  }

  return { ...sections[0], matchedExact: false };
}

function buildReleaseZip({ rootDir, zipDest, items = ITEMS_TO_ZIP, optionalItems = Array.from(OPTIONAL_ITEMS) }) {
  const pythonCmd = findPythonExecutable();
  const payload = JSON.stringify({
    rootDir,
    zipDest,
    items,
    optionalItems
  });
  const stdout = execFileSync(pythonCmd, ['-c', PYTHON_ZIP_BUILDER, payload], {
    cwd: rootDir,
    encoding: 'utf-8',
    timeout: 120000
  });
  const lastLine = stdout.trim().split(/\r?\n/).pop() || '{}';
  return JSON.parse(lastLine);
}

function buildReleaseNotes({ currentVer, baseClientVer, changelogText, asarInfo, zipInfo, shaSumsSize }) {
  const extracted = extractChangelogSection(changelogText, currentVer);
  const subtitleLine = extracted.subtitle
    ? `\n> **本版主题（v${extracted.version}）**：${extracted.subtitle}\n`
    : '';

  return `# Antigravity-Chinese-Localization v${currentVer} 发布说明

专为 Google Antigravity 打造的高性能、非破坏性深度汉化补丁。全面深度适配 **Antigravity v${baseClientVer}** 官方版本，保持与官方原生架构 100% 同步兼容。
${subtitleLine}
---

## 核心更新内容 (Changelog — v${extracted.version})

${extracted.body}

---

## 资产文件说明 (Assets)

本 Release 提供以下免编译与开箱即用工程资产：

| 资产文件 | 文件大小 | SHA256 校验和 | 说明与用途 |
| :--- | :--- | :--- | :--- |
| **\`app.asar\`** | ${asarInfo.sizeMB} (${asarInfo.size.toLocaleString()} 字节) | \`${asarInfo.sha256}\` | 官方标准轻量规格免解包即用核心包。直接替换客户端 \`resources/app.asar\` 即可 |
| **\`app.asar.ready\`** | ${asarInfo.sizeMB} (${asarInfo.size.toLocaleString()} 字节) | \`${asarInfo.sha256}\` | 预制就绪镜像，供 \`一键更新汉化.bat\` 及 macOS \`一键更新汉化.command\` 自动版本校验与原子替换使用 |
| **\`default.zip\`** | ${zipInfo.sizeMB} (${zipInfo.size.toLocaleString()} 字节) | \`${zipInfo.sha256}\` | 开箱即用发行包（内置 \`app.asar.ready\`、Web 控制中心与全平台启动器，支持 UTF-8 文件名与 macOS/Linux 可执行权限） |
| **\`SHA256SUMS.txt\`** | ${shaSumsSize} 字节 | - | 标准 SHA-256 校验清单，供命令行及自动化脚本比对校验 |

---

## 快速使用

- **Windows 一键恢复 / 安装**：解压 \`default.zip\`（或将 \`app.asar.ready\` 与 \`一键更新汉化.bat\` 放在同一目录），双击运行 \`一键更新汉化.bat\`。
- **macOS 一键恢复 / 安装**：解压 \`default.zip\`，双击运行 \`一键更新汉化.command\`。若 Apple Silicon (\`arm64\`) 系统提示“已损坏 / 无法打开”，请在终端执行 \`xattr -cr "/Applications/Antigravity.app"\`（必要时执行 \`codesign --force --deep --sign - "/Applications/Antigravity.app"\`）。
- **可视化控制中心**：双击运行 \`双击运行汉化.bat\`（Windows）或执行 \`./运行汉化.sh\`（macOS / Linux），在浏览器 \`http://127.0.0.1:3388\` 中管理汉化与版本更新。
- **手动直接替换**：下载 \`app.asar\`，备份原版后覆盖到客户端 \`resources/app.asar\`（macOS 为 \`/Applications/Antigravity.app/Contents/Resources/app.asar\`）并重启 Antigravity。
`;
}

function generateReleaseAssets({
  rootDir = path.join(__dirname, '..'),
  releaseDir = __dirname
} = {}) {
  const { currentVer, baseClientVer } = resolveVersions(rootDir);
  console.log(`=== 开始构建 Antigravity v${currentVer} (客户端基线 v${baseClientVer}) Release 发布资产 ===\n`);

  const readySrc = path.join(rootDir, 'app.asar.ready');
  if (!fs.existsSync(readySrc)) {
    console.error('错误: 未找到根目录下的 app.asar.ready，请先编译生成就绪包！');
    process.exit(1);
  }

  fs.mkdirSync(releaseDir, { recursive: true });
  const asarDest = path.join(releaseDir, 'app.asar');
  const readyDest = path.join(releaseDir, 'app.asar.ready');
  const zipDest = path.join(releaseDir, 'default.zip');

  console.log('1. 同步复制 app.asar 与 app.asar.ready...');
  fs.copyFileSync(readySrc, asarDest);
  fs.copyFileSync(readySrc, readyDest);

  console.log('2. 使用 Python zipfile 构建跨平台 default.zip（UTF-8 标志 + LF/0755 规范化）...');
  const zipStats = buildReleaseZip({ rootDir, zipDest, items: ITEMS_TO_ZIP });
  console.log(`   已打包 ${zipStats.packedFiles} 个文件。` +
    (zipStats.skipped.length > 0 ? `（跳过可选缺失项: ${zipStats.skipped.join(', ')}）` : ''));

  console.log('\n3. 计算资产校验和与尺寸...');
  const assets = ['app.asar', 'app.asar.ready', 'default.zip'];
  const manifest = [];
  const shaSums = [];

  for (const name of assets) {
    const p = path.join(releaseDir, name);
    const stat = fs.statSync(p);
    const sha = getSha256(p);
    manifest.push({
      name,
      size: stat.size,
      sizeMB: getMB(stat.size),
      sha256: sha
    });
    shaSums.push(`${sha}  ${name}`);
    console.log(`- ${name}: ${stat.size} 字节 (${getMB(stat.size)}), SHA-256: ${sha}`);
  }

  const manifestPath = path.join(releaseDir, 'manifest.json');
  const shaSumsPath = path.join(releaseDir, 'SHA256SUMS.txt');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(shaSumsPath, shaSums.join('\n') + '\n', 'utf-8');

  console.log(`\n4. 从 CHANGELOG.md 动态解析并生成 RELEASE_NOTES_${currentVer}.md...`);
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf-8') : '';
  const extractedCheck = extractChangelogSection(changelogText, currentVer);
  if (!extractedCheck.matchedExact) {
    console.warn(`[提示] CHANGELOG.md 未找到 v${currentVer} 精确章节，已自动回退提取首个版本章节 (v${extractedCheck.version})。`);
  }

  const asarInfo = manifest.find(m => m.name === 'app.asar');
  const zipInfo = manifest.find(m => m.name === 'default.zip');
  const shaSumsSize = fs.statSync(shaSumsPath).size;

  const releaseNotes = buildReleaseNotes({
    currentVer,
    baseClientVer,
    changelogText,
    asarInfo,
    zipInfo,
    shaSumsSize
  });

  const notesPath = path.join(releaseDir, `RELEASE_NOTES_${currentVer}.md`);
  fs.writeFileSync(notesPath, releaseNotes, 'utf-8');
  console.log(`构建全部完成！所有资产与 RELEASE_NOTES_${currentVer}.md 已准备就绪。`);

  return {
    currentVer,
    baseClientVer,
    manifest,
    notesPath,
    zipStats
  };
}

if (require.main === module) {
  generateReleaseAssets();
}

module.exports = {
  ITEMS_TO_ZIP,
  OPTIONAL_ITEMS,
  resolveVersions,
  extractChangelogSection,
  buildReleaseZip,
  buildReleaseNotes,
  generateReleaseAssets
};
