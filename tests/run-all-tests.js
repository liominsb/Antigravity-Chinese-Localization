'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tests = [
  'ticket-01-translation.test.js',
  'ticket-02-dom-skip.test.js',
  'ticket-03-workflow-safety.test.js',
  'ticket-04-slash-commands.test.js',
  'ticket-05-at-mentions.test.js',
  'ticket-06-project-and-copy.test.js',
  'ticket-07-v213-features.test.js',
  'ticket-08-split-and-menus.test.js',
  'ticket-09-v214-features.test.js',
  'ticket-10-v215-features.test.js',
  'ticket-11-v2151-features.test.js',
  'ticket-12-v2170-features.test.js',
  'ticket-13-v2181-features.test.js',
  'ticket-14-v2191-features.test.js',
  'ticket-15-v2210-features.test.js',
  'ticket-16-v2210-refinements.test.js',
  'ticket-17-v2211-features.test.js',
  'ticket-18-agent-execution-labels.test.js',
  'ticket-19-v2220-features.test.js',
  'ticket-20-v2230-features.test.js',
  'ticket-21-v2231-features.test.js',
  'ticket-22-auto-restore-on-update.test.js',
  'macos-auto-restore-launcher.test.js',
  'ticket-23-v2240-features.test.js',
  'ticket-24-v2250-features.test.js',
  'ticket-25-v2260-features.test.js',
  'ticket-26-v2280-features.test.js',
  'ticket-27-cli-flags.test.js',
  'ticket-28-v2280-coverage.test.js',
  'ticket-29-v2281-features.test.js',
  'ticket-30-v2282-features.test.js',
  'ticket-31-v2290-features.test.js',
  'ticket-32-v2291-features.test.js',
  'ticket-33-v2300-features.test.js',
  'ticket-34-v2310-features.test.js',
  'ticket-35-v2312-features.test.js',
  'ticket-36-v2321-features.test.js',
  'ticket-37-home-greeting-and-notice.test.js',
  'ticket-38-settings-ui-copy.test.js',
  'ticket-39-v2322-features.test.js',
  'ticket-40-conversation-queue-and-tiers.test.js',
  'ticket-41-new-badge-fix.test.js',
  'ticket-42-group-by-repo.test.js',
  'ticket-43-comprehensive-audit-fixes.test.js',
  'ticket-44-v2330-features.test.js',
  'check-injection-syntax.js',
  'verify-ready-asar.js',
  'asar-version.test.js',
  'process-check.test.js',
  'package-installer.test.js',
  'release-manager.test.js',
  'magpie-control-center.test.js',
];

console.log(`================ 全套 TDD 回归测试套件 (${tests.length} 组) ================\n`);

// 自动对账门禁：确保 tests/ 根目录下不存在脱离注册的孤儿测试脚本
const registeredSet = new Set([...tests, 'run-all-tests.js']);
const unregistered = fs
  .readdirSync(__dirname, { withFileTypes: true })
  .filter((ent) => ent.isFile() && ent.name.endsWith('.js') && !registeredSet.has(ent.name))
  .map((ent) => ent.name);

if (unregistered.length > 0) {
  console.error(`[门禁阻断] tests/ 目录下存在未注册至 run-all-tests.js 的孤儿测试脚本: ${unregistered.join(', ')}`);
  process.exit(1);
}

// 清洗宿主环境污染的 NODE_TLS_REJECT_UNAUTHORIZED，确保子测试在标准 TLS 校验环境下运行
const cleanEnv = { ...process.env };
delete cleanEnv.NODE_TLS_REJECT_UNAUTHORIZED;

function runSingleSuite(testFile) {
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, testFile);
    if (!fs.existsSync(testPath)) {
      resolve({ testFile, ok: false, output: `测试文件不存在: ${testPath}` });
      return;
    }
    const child = spawn(process.execPath, [testPath], {
      cwd: path.resolve(__dirname, '..'),
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      stderr += '\n[TIMEOUT] 测试执行超过 60 秒超时中止';
    }, 60000);
    child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        testFile,
        ok: code === 0,
        code,
        output: (stdout + (stderr ? `\n${stderr}` : '')).trim(),
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ testFile, ok: false, code: -1, output: err.message });
    });
  });
}

(async () => {
  const CONCURRENCY = 6;
  const results = new Array(tests.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tests.length) {
      const idx = cursor++;
      results[idx] = await runSingleSuite(tests[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tests.length) }, () => worker()));

  let passedCount = 0;
  const failedSuites = [];

  for (const res of results) {
    if (res.ok) {
      passedCount++;
      console.log(`[PASS] ${res.testFile}`);
    } else {
      failedSuites.push(res.testFile);
      console.error(`\n>>> [FAILED TEST]: ${res.testFile} (exit=${res.code})`);
      console.error(res.output);
    }
  }

  console.log(`\n======================================================`);
  console.log(`测试套件汇总: ${passedCount}/${tests.length} 组通过`);
  console.log(`======================================================`);

  if (failedSuites.length > 0) {
    console.error(`\n未通过测试套件 (${failedSuites.length}): ${failedSuites.join(', ')}`);
    process.exit(1);
  } else {
    console.log('\n恭喜！全套 TDD 测试用例 100% 全部通过 (ALL GREEN)！');
    process.exit(0);
  }
})();
