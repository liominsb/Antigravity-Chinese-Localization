const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');

console.log('=== 开始 Ticket-34 Antigravity 2.31.0 官方大版本特性与架构演进专项测试 ===\n');

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
console.log('--- 1. 2.31.0 版本元数据校验 ---');
function isVerGte2310(v) {
  if (!v) return false;
  const parts = String(v).split('.').map(Number);
  if (parts[0] > 2) return true;
  if (parts[0] === 2 && parts[1] > 31) return true;
  if (parts[0] === 2 && parts[1] === 31 && parts[2] >= 0) return true;
  return false;
}
const currentVerMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
check('localize.js CURRENT_VERSION >= 2.31.0', isVerGte2310(currentVerMatch ? currentVerMatch[1] : ''), true);
check('extracted/package.json version >= 2.31.0', isVerGte2310(packageJson.version), true);
check('index.html 控制中心显示 v2.31.x', /控制中心 v2\.31\.\d+/.test(indexSource), true);
check('README.md 包含 v2.31.x+', /Antigravity v2\.31\.\d+\+/.test(readmeSource), true);
check('README.en.md 包含 v2.31.x+', /Antigravity v2\.31\.\d+\+/.test(readmeEnSource), true);
check('CHANGELOG.md 包含 v2.31.0 章节', changelogSource.includes('## v2.31.0 (2026-11-10)'), true);
check('CHANGELOG.en.md 包含 v2.31.0 章节', changelogEnSource.includes('## v2.31.0 (2026-11-10)'), true);
check('app.asar.ready package.json 版本 >= 2.31.0', isVerGte2310(readAsarPackageVersion(readyAsarPath)), true);

// 2. 原生补丁注入与汉化校验
console.log('\n--- 2. 原生补丁注入与汉化校验 ---');
const distDir = path.join(root, 'extracted', 'dist');
const deviceChooserSource = fs.readFileSync(path.join(distDir, 'deviceChooser.js'), 'utf-8');
const webviewSecuritySource = fs.readFileSync(path.join(distDir, 'webviewPopupSecurity.js'), 'utf-8');
const ipcSource = fs.readFileSync(path.join(distDir, 'ipcHandlers.js'), 'utf-8');

check('deviceChooser.js 包含 HID 设备 汉化', deviceChooserSource.includes("hid: 'HID 设备'"), true);
check('deviceChooser.js 包含 USB 设备 汉化', deviceChooserSource.includes("usb: 'USB 设备'"), true);
check('deviceChooser.js 包含 串行端口 汉化', deviceChooserSource.includes("serial: '串行端口'"), true);
check('deviceChooser.js 包含 连接设备 标题汉化', deviceChooserSource.includes("title: '连接设备'"), true);
check('deviceChooser.js 包含 取消 按钮汉化', deviceChooserSource.includes("'取消']"), true);

check('webviewPopupSecurity.js 包含 不安全 状态汉化', webviewSecuritySource.includes("insecure: '不安全'"), true);
check('webviewPopupSecurity.js 包含 ⚠ 不安全 状态汉化', webviewSecuritySource.includes("dangerous: '⚠ 不安全'"), true);
check('webviewPopupSecurity.js 包含 连接安全 描述汉化', webviewSecuritySource.includes("'连接安全'"), true);
check('webviewPopupSecurity.js 包含 连接信息… 菜单汉化', webviewSecuritySource.includes("label: '连接信息…'"), true);
check('webviewPopupSecurity.js 包含 连接信息 弹窗标题汉化', webviewSecuritySource.includes("title: '连接信息'"), true);
check('webviewPopupSecurity.js 包含 确定 按钮汉化', webviewSecuritySource.includes("buttons: ['确定']"), true);

check('ipcHandlers.js 包含 Auto Pin -> 自动置顶', ipcSource.includes("'Auto Pin': '自动置顶'"), true);
check('ipcHandlers.js 包含 Copy Project Name -> 复制项目名称', ipcSource.includes("'Copy Project Name': '复制项目名称'"), true);
check('ipcHandlers.js 包含 Project Settings -> 项目设置', ipcSource.includes("'Project Settings': '项目设置'"), true);
check('ipcHandlers.js 包含 Delete Project -> 删除项目', ipcSource.includes("'Delete Project': '删除项目'"), true);

// 3. UI 界面细节与动态保障断言
console.log('\n--- 3. UI 界面细节与动态保障断言 ---');
const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');

check('preload.js 包含 自动置顶 (Auto Pin) 汉化', preloadSource.includes('自动置顶'), true);
check('preload.js 包含 选择 Antigravity 的声音 汉化', preloadSource.includes('选择 Antigravity 的声音'), true);
check('preload.js 包含 清晰友好 声音特性描述汉化', preloadSource.includes('清晰友好'), true);
check('preload.js 包含 搜索快捷键... 汉化', preloadSource.includes('搜索快捷键...'), true);
check('preload.js 包含 界面布局 汉化', preloadSource.includes('界面布局'), true);
check('preload.js 包含 对话布局 汉化', preloadSource.includes('对话布局'), true);
check('preload.js 包含 铺满 汉化', preloadSource.includes('铺满'), true);
check('preload.js 包含 浏览器操作控制规则描述汉化', preloadSource.includes('配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 Google Chrome。'), true);

// 4. app.asar.ready 打包产物全面验证
console.log('\n--- 4. app.asar.ready 打包产物全面验证 ---');
const asarSource = fs.readFileSync(readyAsarPath).toString('utf-8');

check('app.asar.ready 包含 连接设备', asarSource.includes('连接设备'), true);
check('app.asar.ready 包含 连接信息…', asarSource.includes('连接信息…'), true);
check('app.asar.ready 包含 自动置顶', asarSource.includes('自动置顶'), true);
check('app.asar.ready 包含 选择 Antigravity 的声音', asarSource.includes('选择 Antigravity 的声音'), true);
check('app.asar.ready 包含 清晰友好', asarSource.includes('清晰友好'), true);
check('app.asar.ready 包含 搜索快捷键...', asarSource.includes('搜索快捷键...'), true);
check('app.asar.ready 包含 界面布局', asarSource.includes('界面布局'), true);
check('app.asar.ready 包含 对话布局', asarSource.includes('对话布局'), true);
check('app.asar.ready 包含 铺满', asarSource.includes('铺满'), true);

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}`);
if (passed === total) {
  console.log('Ticket-34 校验全部通过！');
  process.exit(0);
} else {
  console.error('Ticket-34 校验存在失败项！');
  process.exit(1);
}
