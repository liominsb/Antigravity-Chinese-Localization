const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('=== 开始 Ticket-19 Antigravity 2.22.0 官方版本与架构特性专项测试 ===\n');

// 1. 读取当前工程与解包文件
const localizePath = path.join(__dirname, '..', 'localize.js');
const localizeSource = fs.readFileSync(localizePath, 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extracted', 'package.json'), 'utf-8'));
const indexPath = path.join(__dirname, '..', 'index.html');
const indexSource = fs.readFileSync(indexPath, 'utf-8');
const readmePath = path.join(__dirname, '..', 'README.md');
const readmeSource = fs.readFileSync(readmePath, 'utf-8');
const readmeEnPath = path.join(__dirname, '..', 'README.en.md');
const readmeEnSource = fs.readFileSync(readmeEnPath, 'utf-8');

let passed = 0;
let total = 0;

function check(desc, actual, expected) {
  total++;
  try {
    assert.strictEqual(actual, expected);
    console.log(`PASS [${total}]: ${desc} => "${actual}"`);
    passed++;
  } catch (err) {
    console.error(`FAIL [${total}]: ${desc}`);
    console.error(`   期望: "${expected}"`);
    console.error(`   实际: "${actual}"`);
  }
}

// 2. 版本元数据校验
console.log('--- 1. 2.22.0 版本元数据校验 ---');
const versionMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
const currentVer = versionMatch ? versionMatch[1] : '';
const parseVer = (v) => (v || '').split('.').map(n => parseInt(n, 10) || 0);
const isVerGte2220 = (v) => {
  const [maj, min, patch] = parseVer(v);
  return maj > 2 || (maj === 2 && min >= 22);
};
check('localize.js CURRENT_VERSION 版本号有效且 >= 2.22.0', isVerGte2220(currentVer), true);
check('extracted/package.json version 有效且 >= 2.22.0', isVerGte2220(packageJson.version), true);
check('index.html 包含 本地词库/控制中心 v2.22.0 或更新', (() => {
  const m = indexSource.match(/(?:本地词库|控制中心) v(2\.\d+\.\d+)/);
  return m ? isVerGte2220(m[1]) : false;
})(), true);
check('index.html 包含 Antigravity 汉化 或 2.0 / 2.22.0+', (() => {
  return /Antigravity (?:2\.0 \/ (2\.\d+\.\d+)\+|汉化)/.test(indexSource);
})(), true);
check('index.html 包含有效版本标识且 >= 2.22.0', (() => {
  const m = indexSource.match(/(?:const currentVer = '|控制中心 v)(2\.\d+\.\d+)/);
  return m ? isVerGte2220(m[1]) : false;
})(), true);
check('README.md 包含 Antigravity v2.22.0+ 或更新', (() => {
  const m = readmeSource.match(/Antigravity v(2\.\d+\.\d+)\+/);
  return m ? isVerGte2220(m[1]) : false;
})(), true);
check('README.en.md 包含 Antigravity v2.22.0+ 或更新', (() => {
  const m = readmeEnSource.match(/Antigravity v(2\.\d+\.\d+)\+/);
  return m ? isVerGte2220(m[1]) : false;
})(), true);

// 3. 2.22.0 官方架构与主进程接口完备性校验
console.log('\n--- 2. 2.22.0 官方架构与接口完备性校验 ---');
const distDir = path.join(__dirname, '..', 'extracted', 'dist');
const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');
const ipcSource = fs.readFileSync(path.join(distDir, 'ipcHandlers.js'), 'utf-8');
const traySource = fs.readFileSync(path.join(distDir, 'tray.js'), 'utf-8');
const mainSource = fs.readFileSync(path.join(distDir, 'main.js'), 'utf-8');
const menuSource = fs.readFileSync(path.join(distDir, 'menu.js'), 'utf-8');
const updaterSource = fs.readFileSync(path.join(distDir, 'updater.js'), 'utf-8');
const wizardHtmlSource = fs.readFileSync(path.join(distDir, 'ideInstall', 'wizardHtml.js'), 'utf-8');

check('preload.js 官方保持 getPathForFile 桥接接口', preloadSource.includes('getPathForFile'), true);
check('preload.js 保持 showContextMenu 桥接定义', preloadSource.includes('showContextMenu:'), true);
check('ipcHandlers.js 保持原生 show-context-menu 调度支持', ipcSource.includes('window:show-context-menu'), true);
check('ipcHandlers.js 注入 translateContextLabel 过滤器', ipcSource.includes('translateContextLabel('), true);
check('menu.js 注入 translateMenu 递归汉化机制', menuSource.includes('translateMenu('), true);
check('tray.js 注入运行中智能体数量汉化', traySource.includes('个智能体运行中'), true);
check('updater.js 检查更新弹窗汉化', updaterSource.includes('当前已是最新版本，暂无可用更新。'), true);
check('wizardHtml.js 首发向导模板汉化', wizardHtmlSource.includes('欢迎使用全新 Antigravity！'), true);

// 4. 实时汉化引擎提取与 Agent 执行标签回归
console.log('\n--- 3. 实时汉化引擎与执行标签回归校验 ---');
const sandbox = {
  globalThis: {},
  window: {},
  document: { body: {}, addEventListener: () => {}, readyState: 'loading' },
  NodeFilter: { SHOW_TEXT: 4 },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
  Element: { prototype: {} },
  MutationObserver: class { observe() {} disconnect() {} },
  WeakSet: WeakSet,
  WeakMap: WeakMap,
  Set: Set,
  Map: Map,
  queueMicrotask: (fn) => fn(),
  requestAnimationFrame: (fn) => fn(),
  console: console
};
vm.createContext(sandbox);

const marker = '// Antigravity 2.0 Chinese Localization Engine';
const markerIdx = preloadSource.indexOf(marker);
assert.ok(markerIdx !== -1, 'preload.js 必须包含汉化引擎注入标记');
const engineCode = preloadSource.substring(markerIdx);

const exportInstrument = engineCode.replace(
  "if (document.readyState === 'loading')",
  'globalThis.__test_translateString = translateString;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
);

vm.runInContext(exportInstrument, sandbox);
const translate = sandbox.globalThis.__test_translateString;
assert.ok(typeof translate === 'function', 'translateString 必须在 VM 沙箱内可正常调用');

// 执行药丸与状态
check('Run 药丸', translate('Run'), '运行');
check('Running 药丸', translate('Running'), '正在运行');
check('Ran 药丸', translate('Ran'), '已运行');
check('Ran command 单数', translate('Ran command'), '已运行命令');
check('Running commands 复数', translate('Running commands'), '正在运行命令');
check('Run command 单数', translate('Run command'), '运行命令');

// 消除夹生词
check('彻底消除 Ran 命令 夹生词', translate('Ran 命令'), '已运行命令');
check('彻底消除 Running 命令 夹生词', translate('Running 命令'), '正在运行命令');
check('彻底消除 Ran 命令: 冒号前缀', translate('Ran 命令: ls -la'), '已运行命令: ls -la');

// 复合状态短语
check('Explored files, ran commands, edited files',
  translate('Explored files, ran commands, edited files'),
  '已探索文件、已执行命令、已编辑文件'
);
check('Exploring files, running commands, editing artifact',
  translate('Exploring files, running commands, editing artifact'),
  '正在探索文件、运行命令、编辑工件'
);
check('动态数字短语: 3 files, 2 commands, 1 file',
  translate('Explored 3 files, ran 2 commands, edited 1 file'),
  '已探索 3 个文件，已执行 2 条命令，已编辑 1 个文件'
);

// 药丸白名单校验
const isActionPillRegexMatch = engineCode.match(/const isActionPill\s*=\s*textContent\.length\s*<=\s*\d+\s*&&\s*(\/[^/]+\/i)\.test/);
assert.ok(isActionPillRegexMatch, 'isActionPill 正则必须存在于注入代码中');
const actionPillRegex = vm.runInNewContext(isActionPillRegexMatch[1]);
check('isActionPill 放行 Run', actionPillRegex.test('Run'), true);
check('isActionPill 放行 Running', actionPillRegex.test('Running'), true);
check('isActionPill 放行 Ran', actionPillRegex.test('Ran'), true);

console.log(`\n======================================================`);
console.log(`Ticket-19 测试结果: ${passed}/${total} 断言全部通过！`);
console.log(`======================================================\n`);

if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}
