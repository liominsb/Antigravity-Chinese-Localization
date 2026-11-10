const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');

console.log('=== 开始 Ticket-33 Antigravity 2.30.0 官方大版本特性与架构演进专项测试 ===\n');

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
console.log('--- 1. 2.30.0 版本元数据校验 ---');
check('localize.js CURRENT_VERSION 为 2.30.0', /const CURRENT_VERSION = '2\.30\.0';/.test(localizeSource), true);
check('extracted/package.json version 为 2.30.0', packageJson.version, '2.30.0');
check('index.html 控制中心显示 v2.30.0', indexSource.includes('控制中心 v2.30.0'), true);
check('README.md 包含 v2.30.0+', readmeSource.includes('Antigravity v2.30.0+'), true);
check('README.en.md 包含 v2.30.0+', readmeEnSource.includes('Antigravity v2.30.0+'), true);
check('CHANGELOG.md 包含 v2.30.0 章节', changelogSource.includes('## v2.30.0 (2026-11-10)'), true);
check('CHANGELOG.en.md 包含 v2.30.0 章节', changelogEnSource.includes('## v2.30.0 (2026-11-10)'), true);
check('app.asar.ready package.json 版本为 2.30.0', readAsarPackageVersion(readyAsarPath), '2.30.0');

// 2. 官方新增 20 个核心原生模块存在性校验
console.log('\n--- 2. 官方 2.30.0 新增 20 个核心原生模块存在性校验 ---');
const distDir = path.join(root, 'extracted', 'dist');
const newModules = [
  path.join(distDir, 'browserEngine', 'browserEngine.js'),
  path.join(distDir, 'browserEngine', 'cdpPipe.js'),
  path.join(distDir, 'browserEngine', 'chromeDiscovery.js'),
  path.join(distDir, 'deviceChooser.js'),
  path.join(distDir, 'faviconStore.js'),
  path.join(distDir, 'guestAgentControl.js'),
  path.join(distDir, 'guestFileAttachment.js'),
  path.join(distDir, 'guestFileChooserController.js'),
  path.join(distDir, 'guestFrameBridge.js'),
  path.join(distDir, 'guestFramePolicy.js'),
  path.join(distDir, 'guestNetworkController.js'),
  path.join(distDir, 'guestNetworkSanitizer.js'),
  path.join(distDir, 'guestPermissionPolicy.js'),
  path.join(distDir, 'guestPromptController.js'),
  path.join(distDir, 'guestWebMcpController.js'),
  path.join(distDir, 'hubZoom.js'),
  path.join(distDir, 'isolatedWorldExec.js'),
  path.join(distDir, 'webviewPopupSecurity.js'),
  path.join(distDir, 'webviewPromptPreload.js'),
  path.join(distDir, 'webviewUploadValidation.js')
];

newModules.forEach(modPath => {
  const rel = path.relative(root, modPath).replace(/\\/g, '/');
  check(`新增原生模块存在: ${rel}`, fs.existsSync(modPath), true);
});

// 3. 新增原生模块补丁注入与汉化校验 (deviceChooser.js & webviewPopupSecurity.js)
console.log('\n--- 3. 新增原生模块补丁注入与汉化校验 ---');
const deviceChooserSource = fs.readFileSync(path.join(distDir, 'deviceChooser.js'), 'utf-8');
const webviewSecuritySource = fs.readFileSync(path.join(distDir, 'webviewPopupSecurity.js'), 'utf-8');

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

// 4. UI 界面细节与动态保障断言 (搜索框、自动化空状态、免责声明、货架分类、右键菜单)
console.log('\n--- 4. UI 界面细节与动态保障断言 ---');
const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');

check('preload.js 包含 搜索自定义项... 占位符汉化', preloadSource.includes('搜索自定义项...'), true);
check('preload.js 包含 搜索框动态正则保障', preloadSource.includes('Search customizations'), true);
check('preload.js 包含 自动化空状态单复数自适应正则', preloadSource.includes('No\\s+(?:automations?|自动化)\\s+yet'), true);
check('preload.js 包含 第三方免责声明前缀匹配', preloadSource.includes('Google does not control the availability or functionality of third party developer tools'), true);
check('preload.js 包含 设计、创意与媒体 货架分类', preloadSource.includes('设计、创意与媒体'), true);
check('preload.js 包含 生产力与项目管理 货架分类', preloadSource.includes('生产力与项目管理'), true);
check('preload.js 包含 云托管与部署 货架分类', preloadSource.includes('云托管与部署'), true);
check('preload.js 包含 开发者工具 货架分类（防分词）', preloadSource.includes('Developer 工具') && preloadSource.includes('开发者工具'), true);
check('preload.js 包含 商业与商务 货架分类', preloadSource.includes('商业与商务'), true);

// 4.1 设置面板新增界面布局、对话布局、快捷键搜索与浏览器规则校验
check('preload.js 包含 界面布局 汉化', preloadSource.includes('界面布局'), true);
check('preload.js 包含 知识工作 汉化', preloadSource.includes('知识工作'), true);
check('preload.js 包含 专为调研、写作和日常任务打造的精简界面 汉化', preloadSource.includes('专为调研、写作和日常任务打造的精简界面。'), true);
check('preload.js 包含 软件工程 汉化', preloadSource.includes('软件工程'), true);
check('preload.js 包含 涵盖编程、开发者工具与智能体管理的完整界面 汉化', preloadSource.includes('涵盖编程、开发者工具与智能体管理的完整界面。'), true);
check('preload.js 包含 对话布局 (Chat Layout) 汉化', preloadSource.includes('对话布局'), true);
check('preload.js 包含 铺满 (Fill) 汉化', preloadSource.includes('铺满'), true);
check('preload.js 包含 搜索快捷键... 汉化', preloadSource.includes('搜索快捷键...'), true);
check('preload.js 包含 搜索快捷键正则保障', preloadSource.includes('(?:Search|搜索)\\s+shortcuts'), true);
check('preload.js 包含 浏览器操作控制规则描述汉化', preloadSource.includes('配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 Google Chrome。'), true);

const ipcSource = fs.readFileSync(path.join(distDir, 'ipcHandlers.js'), 'utf-8');
check('ipcHandlers.js 包含 Copy Project Name -> 复制项目名称', ipcSource.includes("'Copy Project Name': '复制项目名称'"), true);
check('ipcHandlers.js 包含 Project Settings -> 项目设置', ipcSource.includes("'Project Settings': '项目设置'"), true);
check('ipcHandlers.js 包含 Delete Project -> 删除项目', ipcSource.includes("'Delete Project': '删除项目'"), true);
check('ipcHandlers.js 包含 Sort By -> 排序方式', ipcSource.includes("'Sort By': '排序方式'"), true);
check('ipcHandlers.js 包含 Last Updated -> 最近更新', ipcSource.includes("'Last Updated': '最近更新'"), true);
check('ipcHandlers.js 包含 Last Prompt -> 最新提示词', ipcSource.includes("'Last Prompt': '最新提示词'"), true);
check('ipcHandlers.js 包含 Custom Order -> 自定义排序', ipcSource.includes("'Custom Order': '自定义排序'"), true);

// 5. app.asar.ready 打包产物全面验证
console.log('\n--- 5. app.asar.ready 打包产物全面验证 ---');
const asarSource = fs.readFileSync(readyAsarPath).toString('utf-8');

check('app.asar.ready 包含 连接设备', asarSource.includes('连接设备'), true);
check('app.asar.ready 包含 连接信息…', asarSource.includes('连接信息…'), true);
check('app.asar.ready 包含 搜索自定义项...', asarSource.includes('搜索自定义项...'), true);
check('app.asar.ready 包含 暂无自动化', asarSource.includes('暂无自动化'), true);
check('app.asar.ready 包含 第三方免责声明汉化', asarSource.includes('Google 不控制第三方开发者工具的可用性或功能'), true);
check('app.asar.ready 包含 复制项目名称', asarSource.includes('复制项目名称'), true);
check('app.asar.ready 包含 项目设置', asarSource.includes('项目设置'), true);
check('app.asar.ready 包含 删除项目', asarSource.includes('删除项目'), true);
check('app.asar.ready 包含 排序方式', asarSource.includes('排序方式'), true);
check('app.asar.ready 包含 最近更新', asarSource.includes('最近更新'), true);
check('app.asar.ready 包含 自定义排序', asarSource.includes('自定义排序'), true);
check('app.asar.ready 包含 界面布局', asarSource.includes('界面布局'), true);
check('app.asar.ready 包含 对话布局', asarSource.includes('对话布局'), true);
check('app.asar.ready 包含 铺满', asarSource.includes('铺满'), true);
check('app.asar.ready 包含 搜索快捷键...', asarSource.includes('搜索快捷键...'), true);
check('app.asar.ready 包含 浏览器操作控制规则描述', asarSource.includes('配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 Google Chrome。'), true);

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}`);
if (passed === total) {
  console.log('Ticket-33 校验全部通过！');
  process.exit(0);
} else {
  console.error('Ticket-33 校验存在失败项！');
  process.exit(1);
}
