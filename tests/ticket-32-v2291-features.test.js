const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');

console.log('=== 开始 Ticket-32 Antigravity 2.29.1 官方维护版本特性专项测试 ===\n');

const root = path.join(__dirname, '..');
const localizePath = path.join(root, 'localize.js');
const localizeSource = fs.readFileSync(localizePath, 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'extracted', 'package.json'), 'utf-8'));
const indexPath = path.join(root, 'index.html');
const indexSource = fs.readFileSync(indexPath, 'utf-8');
const readmePath = path.join(root, 'README.md');
const readmeSource = fs.readFileSync(readmePath, 'utf-8');
const readmeEnPath = path.join(root, 'README.en.md');
const readmeEnSource = fs.readFileSync(readmeEnPath, 'utf-8');
const changelogPath = path.join(root, 'CHANGELOG.md');
const changelogSource = fs.readFileSync(changelogPath, 'utf-8');
const changelogEnPath = path.join(root, 'CHANGELOG.en.md');
const changelogEnSource = fs.readFileSync(changelogEnPath, 'utf-8');
const readyAsarPath = path.join(root, 'app.asar.ready');

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

// 1. 版本元数据校验
console.log('--- 1. 2.29.1 版本元数据校验 ---');
function isVerGte2291(ver) {
  if (!ver) return false;
  const parts = ver.split('.').map(n => parseInt(n, 10));
  if (parts[0] > 2) return true;
  if (parts[0] === 2 && parts[1] > 29) return true;
  if (parts[0] === 2 && parts[1] === 29 && parts[2] >= 1) return true;
  return false;
}

const versionMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
const currentVer = versionMatch ? versionMatch[1] : '';
check('localize.js CURRENT_VERSION 版本号有效且 >= 2.29.1', isVerGte2291(currentVer), true);
check('extracted/package.json 版本与 CURRENT_VERSION 完全一致', packageJson.version, currentVer);
check('extracted/package.json 版本有效且 >= 2.29.1', isVerGte2291(packageJson.version), true);

if (fs.existsSync(readyAsarPath)) {
  check('app.asar.ready 读取包版本有效且 >= 2.29.1', isVerGte2291(readAsarPackageVersion(readyAsarPath)), true);
  check('app.asar.ready 版本与 CURRENT_VERSION 完全一致', readAsarPackageVersion(readyAsarPath), currentVer);
}

check('index.html 包含 控制中心 v2.29.1+', (() => {
  const m = indexSource.match(/(?:本地词库|控制中心) v(2\.\d+\.\d+)/);
  return m ? isVerGte2291(m[1]) : false;
})(), true);
check('index.html 包含 Antigravity 汉化', indexSource.includes('<h1>Antigravity 汉化</h1>'), true);
check('README.md 包含 Antigravity v' + currentVer + '+', readmeSource.includes('Antigravity v' + currentVer + '+'), true);
check('README.en.md 包含 Antigravity v' + currentVer + '+', readmeEnSource.includes('Antigravity v' + currentVer + '+'), true);
check('CHANGELOG.md 包含 2.29.1 版本日志条目', changelogSource.includes('## v2.29.1 (2026-11-08)'), true);
check('CHANGELOG.en.md 包含 2.29.1 版本日志条目', changelogEnSource.includes('## v2.29.1 (2026-11-08)'), true);

// 2. 原生层与补丁产物校验
console.log('\n--- 2. 原生层与补丁产物校验 ---');
const distDir = path.join(root, 'extracted', 'dist');
const REQUIRED_MODULES = [
  'externalUrl.js',
  'guestDialogController.js',
  'wcvBrowserRegistry.js',
  'wcvIpcHandlers.js',
  'wcvZOrderController.js',
  'webviewDownloadRouting.js',
  'windowState.js',
  'webauthn.js',
  'cablev2.js',
  'webviewBrowser.js',
  'scriptJail.js',
  'scriptJailPreload.js',
  'guestDebugger.js',
  'webviewSecurityState.js'
];
for (const mod of REQUIRED_MODULES) {
  check(`模块 ${mod} 存在`, fs.existsSync(path.join(distDir, mod)), true);
}

const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');
const menuSource = fs.readFileSync(path.join(distDir, 'menu.js'), 'utf-8');
const cableSource = fs.readFileSync(path.join(distDir, 'cablev2.js'), 'utf-8');
const webauthnSource = fs.readFileSync(path.join(distDir, 'webauthn.js'), 'utf-8');

check('preload.js 包含 DOM 实时汉化注入引擎', preloadSource.includes('// Antigravity 2.0 Chinese Localization Engine'), true);
check('preload.js 包含 语音模式 (Voice mode) 汉化', preloadSource.includes('语音模式'), true);
check('preload.js 包含 Gemini Live 语音文案', preloadSource.includes('由 Gemini Live 提供支持'), true);
check('preload.js 包含 内置浏览器下载位置汉化', preloadSource.includes('在内置浏览器中下载的文件所保存的文件夹'), true);
check('preload.js 包含 5h limit 限额汉化', preloadSource.includes('5h limit') && preloadSource.includes('5 小时限额'), true);
check('preload.js 包含 Resets in 配额重置时间动态规则', preloadSource.includes('Resets?') && preloadSource.includes('后重置'), true);
check('preload.js 包含 % left 配额剩余动态规则', preloadSource.includes('left') && preloadSource.includes('剩余'), true);
check('menu.js 包含 原生菜单翻译映射', menuSource.includes('const menuTranslationMap = {'), true);
check('cablev2.js 包含 通行密钥 汉化', cableSource.includes('通行密钥'), true);
check('webauthn.js 包含 选择通行密钥 汉化', webauthnSource.includes('选择通行密钥'), true);

// 3. 2.29.1 扩展市场全量插件生态与详情页深度汉化校验
console.log('\n--- 3. 2.29.1 扩展市场全量插件生态与详情页深度汉化校验 ---');
const asarSource = fs.readFileSync(readyAsarPath, 'utf-8');

check('localize.js 包含 2.29.1 扩展市场全量插件补充分组', localizeSource.includes('2.29.1 扩展市场全量插件、提示词与生态卡片汉化'), true);
check('preload.js 包含 2.29.1 扩展市场全量插件补充分组', preloadSource.includes('2.29.1 扩展市场全量插件、提示词与生态卡片汉化'), true);
check('preload.js 包含 Notion 插件描述汉化', preloadSource.includes('通过 Notion MCP 服务器将 Antigravity 连接到你的 Notion 工作区'), true);
check('preload.js 包含 Notion 提示词配置汉化', preloadSource.includes('配置 Notion，以便你可以将我的工作区作为上下文使用'), true);
check('preload.js 包含 Notion 提示词实施计划汉化', preloadSource.includes('将 Notion 中的这份规范转换为带有具体任务的实施计划'), true);
check('preload.js 包含 Stripe 插件描述汉化', preloadSource.includes('接受在线付款并拓展业务。Stripe 官方 MCP 服务器让 AI 智能体能够管理客户'), true);
check('preload.js 包含 Semrush 插件描述汉化', preloadSource.includes('基于实时 Semrush 数据的专业 SEO 工作流'), true);
check('preload.js 包含 Wispr Flow 会议笔记描述汉化', preloadSource.includes('搜索并阅读你的 Wispr Flow 会议笔记、语音转写文本'), true);
check('preload.js 包含 Looker 插件描述汉化', preloadSource.includes('连接到你的托管 Looker MCP 服务器以探索数据'), true);
check('preload.js 包含 invideo 插件描述汉化', preloadSource.includes('将你的智能体连接到 invideo AI 原生视频编辑器'), true);
check('preload.js 包含 Neo4j 插件描述汉化', preloadSource.includes('Neo4j 图数据库智能体技能——编写 Cypher 查询'), true);
check('preload.js 包含 第三方开发者工具免责声明汉化', preloadSource.includes('Google 不控制第三方开发者工具的可用性或功能'), true);
check('preload.js 包含 plugin for Antigravity 通用动态正则', preloadSource.includes('Antigravity 的 $1 插件'), true);
check('preload.js 包含 OAuth 浏览器授权通用动态正则', preloadSource.includes('首次调用 $1 工具时会打开浏览器窗口以授权你的工作区。'), true);

check('app.asar.ready 包含 Notion 插件描述汉化', asarSource.includes('通过 Notion MCP 服务器将 Antigravity 连接到你的 Notion 工作区'), true);
check('app.asar.ready 包含 Stripe 插件描述汉化', asarSource.includes('接受在线付款并拓展业务。Stripe 官方 MCP 服务器让 AI 智能体能够管理客户'), true);
check('app.asar.ready 包含 第三方开发者工具免责声明汉化', asarSource.includes('Google 不控制第三方开发者工具的可用性或功能'), true);

// 4. 原生上下文菜单（项目文件夹与对话列表右键）校验
console.log('\n--- 4. 原生上下文菜单（项目文件夹与对话列表右键）校验 ---');
const ipcSource = fs.readFileSync(path.join(distDir, 'ipcHandlers.js'), 'utf-8');

check('ipcHandlers.js 包含 Copy Project Name -> 复制项目名称', ipcSource.includes("'Copy Project Name': '复制项目名称'"), true);
check('ipcHandlers.js 包含 Project Settings -> 项目设置', ipcSource.includes("'Project Settings': '项目设置'"), true);
check('ipcHandlers.js 包含 Delete Project -> 删除项目', ipcSource.includes("'Delete Project': '删除项目'"), true);
check('ipcHandlers.js 包含 Mark Unread -> 标为未读', ipcSource.includes("'Mark Unread': '标为未读'"), true);
check('ipcHandlers.js 包含 Split -> 拆分', ipcSource.includes("'Split': '拆分'"), true);
check('ipcHandlers.js 包含 Stop -> 停止', ipcSource.includes("'Stop': '停止'"), true);

check('app.asar.ready 包含 Copy Project Name 汉化', asarSource.includes('复制项目名称'), true);
check('app.asar.ready 包含 Project Settings 汉化', asarSource.includes('项目设置'), true);
check('app.asar.ready 包含 Mark Unread 汉化', asarSource.includes('标为未读'), true);



console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}`);
if (passed === total) {
  console.log('Ticket-32 校验全部通过！');
  process.exit(0);
} else {
  console.error('Ticket-32 校验存在失败项！');
  process.exit(1);
}
