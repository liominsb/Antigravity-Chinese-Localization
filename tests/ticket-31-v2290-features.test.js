const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('=== 开始 Ticket-31 Antigravity 2.29.0 官方版本与新增界面文案专项测试 ===\n');

const root = path.join(__dirname, '..');
const localizeSource = fs.readFileSync(path.join(root, 'localize.js'), 'utf-8');
const preloadSource = fs.readFileSync(path.join(root, 'extracted', 'dist', 'preload.js'), 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'extracted', 'package.json'), 'utf-8'));
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
const readmeSource = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');
const readmeEnSource = fs.readFileSync(path.join(root, 'README.en.md'), 'utf-8');
const changelogSource = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8');
const changelogEnSource = fs.readFileSync(path.join(root, 'CHANGELOG.en.md'), 'utf-8');
const readyAsarPath = path.join(root, 'app.asar.ready');
const distDir = path.join(root, 'extracted', 'dist');

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

// ---------------------------------------------------------------------------
// 1. 版本元数据（自洽校验，不钉死具体版本号）
// ---------------------------------------------------------------------------
console.log('--- 1. 2.29.0 版本元数据校验 ---');
function isVerGte2290(ver) {
  if (!ver) return false;
  const parts = ver.split('.').map((n) => parseInt(n, 10));
  if (Number.isNaN(parts[0])) return false;
  if (parts[0] > 2) return true;
  if (parts[0] === 2 && parts[1] > 29) return true;
  if (parts[0] === 2 && parts[1] === 29 && (parts[2] || 0) >= 0) return true;
  return false;
}
const versionMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
const currentVer = versionMatch ? versionMatch[1] : '';
check('localize.js CURRENT_VERSION 版本号有效且 >= 2.29.0', isVerGte2290(currentVer), true);
check('extracted/package.json 版本与 CURRENT_VERSION 完全一致', packageJson.version, currentVer);
check('extracted/package.json 版本号有效且 >= 2.29.0', isVerGte2290(packageJson.version), true);
if (fs.existsSync(readyAsarPath)) {
  const { readAsarPackageVersion } = require('../asar-version');
  check('app.asar.ready 读取包版本有效且 >= 2.29.0', isVerGte2290(readAsarPackageVersion(readyAsarPath)), true);
  check('app.asar.ready 版本与 CURRENT_VERSION 完全一致', readAsarPackageVersion(readyAsarPath), currentVer);
}
check('index.html 包含 控制中心版本号有效且 >= 2.29.0', (() => {
  const m = indexSource.match(/(?:本地词库|控制中心) v(2\.\d+\.\d+)/);
  return m ? isVerGte2290(m[1]) : false;
})(), true);
check('README.md 包含 Antigravity 版本号有效且 >= 2.29.0', (() => {
  const m = readmeSource.match(/Antigravity v(2\.\d+\.\d+)\+/);
  return m ? isVerGte2290(m[1]) : false;
})(), true);
check('README.en.md 包含 Antigravity 版本号有效且 >= 2.29.0', (() => {
  const m = readmeEnSource.match(/Antigravity v(2\.\d+\.\d+)\+/);
  return m ? isVerGte2290(m[1]) : false;
})(), true);
check('CHANGELOG.md 包含 2.29.0 版本日志条目', changelogSource.includes('## v2.29.0'), true);
check('CHANGELOG.en.md 包含 2.29.0 版本日志条目', changelogEnSource.includes('## v2.29.0'), true);

// ---------------------------------------------------------------------------
// 2. 2.29.0 新增原生模块完备性
// ---------------------------------------------------------------------------
console.log('\n--- 2. 2.29.0 新增原生模块完备性 ---');
const NEW_MODULES = [
  ['externalUrl.js', '外部 URL 协议调度'],
  ['guestDialogController.js', '内置浏览器页内对话框控制器'],
  ['wcvBrowserRegistry.js', 'WebContentsView 浏览器注册表'],
  ['wcvIpcHandlers.js', 'WCV IPC 处理器'],
  ['wcvZOrderController.js', 'WCV 层叠顺序控制器'],
  ['webviewDownloadRouting.js', '内置浏览器下载路由'],
  ['windowState.js', '窗口状态持久化']
];
for (const [m, desc] of NEW_MODULES) {
  check(`2.29.0 新增模块 ${m} 存在（${desc}）`, fs.existsSync(path.join(distDir, m)), true);
}

// ---------------------------------------------------------------------------
// 3. 解析词典
// ---------------------------------------------------------------------------
console.log('\n--- 3. 词典解析与 2.29.0 新增词条校验 ---');
function extractObj(src, name) {
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*\\{');
  const mm = re.exec(src);
  if (!mm) return null;
  const start = mm.index + mm[0].length - 1;
  let depth = 0, inStr = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}
const dictBlock = extractObj(localizeSource, 'dictionary');
check('localize.js 存在 dictionary 词典块', Boolean(dictBlock), true);
const dictionary = vm.runInNewContext('(' + dictBlock + ')');
const coreWords = vm.runInNewContext('(' + extractObj(localizeSource, 'coreWords') + ')');

// 2.29.0 补充分组区段内的词条
const groupKeys = [];
{
  const dictLines = dictBlock.split(/\r\n|\n/);
  let inGroup = false;
  for (const ln of dictLines) {
    if (/===== 2\.29\.0 补充：/.test(ln)) { inGroup = true; continue; }
    if (inGroup && /^ {4}"/.test(ln)) {
      const mk = ln.match(/^ {4}("(?:[^"\\]|\\.)*")\s*:/);
      if (mk) groupKeys.push(JSON.parse(mk[1]));
    }
  }
}
check('localize.js 含 2.29.0 补充分组词条（>= 90 条）', groupKeys.length >= 90, true);

// 代表性词条译文
const SAMPLES = [
  ['Screen Reader Mode', '屏幕阅读器模式'],
  ['Mute Voice Mic', '静音语音麦克风'],
  ['Save audio recordings', '保存音频录音'],
  ['Input device for voice mode and dictation.', '语音模式与语音输入的输入设备。'],
  ['Remote agents are busy', '远程智能体繁忙'],
  ['Runs remotely', '在远程运行'],
  ['Context and Quota Indicator', '上下文与配额指示器'],
  ['Conversation limit reached', '已达到对话数量上限'],
  ['Browse MCP resources', '浏览 MCP 资源'],
  ['Search connectors', '搜索连接器'],
  ['Cancel download', '取消下载'],
  ['Browsing History', '浏览历史'],
  ['Your connection to this site is not fully secure', '你与此站点的连接并非完全安全'],
  ['Terminal Placement', '终端布局'],
  ['Toggle Maximize Side Panel', '切换最大化侧面板'],
  ['Close Tabs to the Left', '关闭左侧标签页'],
  ['New Conversation Button', '新建对话按钮'],
  ['Every weekday', '每个工作日'],
  ['On a schedule', '按计划执行'],
  ['What should the agent do on each run?', '智能体每次运行时应该做什么？'],
  ["Send messages with the keyboard's Enter key instead of starting a new line.", '使用键盘的 Enter 键发送消息，而不是另起一行。'],
  ['Font', '字体'],
  ['Enter to Send', '回车发送'],
  ['CitC Workspace', 'CitC 工作区'],
  ['Cog Workspace', 'Cog 工作区'],
  ['Voice mode', '语音模式'],
  ['The voice used in Voice mode. Powered by Gemini Live.', '语音模式下使用的声音。由 Gemini Live 提供支持。'],
  ["How loud Antigravity's voice is.", 'Antigravity 的语音音量大小。'],
  ['Folder where files downloaded in the built-in browser are saved.', '在内置浏览器中下载的文件所保存的文件夹。'],
  ['Clear visited URLs and autocomplete suggestions from the built-in browser.', '清除内置浏览器中访问过的网址与自动补全建议。']
];
for (const [k, v] of SAMPLES) {
  const actual = dictionary[k] !== undefined ? dictionary[k] : coreWords[k];
  check(`2.29.0 词条译文 "${k}"`, actual, v);
}

// 新增词条零漏翻 / 零空译文
const PROPER_NOUNS = new Set(['Google Chat']);
const untranslated = groupKeys.filter(
  (k) => !PROPER_NOUNS.has(k) && String(dictionary[k]).trim() === k.trim()
);
check('2.29.0 新增词条中无「译文等于原文」的漏翻项', untranslated.length, 0);
if (untranslated.length) untranslated.slice(0, 20).forEach((u) => console.error('   漏翻: ' + u));
const emptyVal = groupKeys.filter((k) => !String(dictionary[k] || '').trim());
check('2.29.0 新增词条中无空译文', emptyVal.length, 0);

// ---------------------------------------------------------------------------
// 4. 词典健康度
// ---------------------------------------------------------------------------
console.log('\n--- 4. 词典健康度 ---');
check('dictionary 词条数 >= 3600', Object.keys(dictionary).length >= 3600, true);
const re = /^ {4}("(?:[^"\\]|\\.)*")\s*:/gm;
let mm2;
const counts = new Map();
while ((mm2 = re.exec(dictBlock))) {
  const k = JSON.parse(mm2[1]);
  counts.set(k, (counts.get(k) || 0) + 1);
}
let dupKeys = 0;
for (const c of counts.values()) if (c > 1) dupKeys++;
check('dictionary 源码级重复 key 数不超过上游基线 619', dupKeys <= 619, true);

// ---------------------------------------------------------------------------
// 5. 产物级验证：新增词条已真实注入
// ---------------------------------------------------------------------------
console.log('\n--- 5. 产物级验证 ---');
const groups = (preloadSource.match(/===== 2\.29\.0 补充：/g) || []).length;
check('preload.js 含 2.29.0 补充分组注释', groups >= 4, true);
let notInjected = 0;
for (const [k] of SAMPLES) {
  if (!preloadSource.includes(k)) { notInjected++; console.error('   未注入: ' + k); }
}
check('2.29.0 代表性词条已全部注入 preload.js', notInjected, 0);

if (fs.existsSync(readyAsarPath)) {
  const readyBuf = fs.readFileSync(readyAsarPath).toString('latin1');
  let readyMissing = 0;
  for (const [k] of SAMPLES) {
    if (!readyBuf.includes(k)) { readyMissing++; console.error('   ready 缺: ' + k); }
  }
  check('app.asar.ready 包含 2.29.0 代表性词条', readyMissing, 0);
}

console.log('\n======================================================');
console.log(`Ticket-31 测试结果: ${passed}/${total} 断言全部通过！`);
console.log('======================================================\n');

if (passed !== total) {
  process.exit(1);
} else {
  process.exit(0);
}
