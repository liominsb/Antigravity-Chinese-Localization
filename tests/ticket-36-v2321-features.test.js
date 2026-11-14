const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');

console.log('=== 开始 Ticket-36 Antigravity 2.32.1 官方大版本特性与 Remote SSH 远程开发专项测试 ===\n');

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
console.log('--- 1. 2.32.1 版本元数据校验 ---');
check('localize.js CURRENT_VERSION 为 2.32.1', /const CURRENT_VERSION = '2\.32\.1';/.test(localizeSource), true);
check('extracted/package.json version 为 2.32.1', packageJson.version, '2.32.1');
check('index.html 控制中心显示 v2.32.1', indexSource.includes('控制中心 v2.32.1'), true);
check('README.md 包含 v2.32.1+', readmeSource.includes('Antigravity v2.32.1+'), true);
check('README.en.md 包含 v2.32.1+', readmeEnSource.includes('Antigravity v2.32.1+'), true);
check('CHANGELOG.md 包含 v2.32.1 章节', changelogSource.includes('## v2.32.1 (2026-11-14)'), true);
check('CHANGELOG.en.md 包含 v2.32.1 章节', changelogEnSource.includes('## v2.32.1 (2026-11-14)'), true);
check('app.asar.ready package.json 版本为 2.32.1', readAsarPackageVersion(readyAsarPath), '2.32.1');

// 2. Remote SSH 远程开发子系统原生注入与汉化校验
console.log('\n--- 2. Remote SSH 远程开发子系统原生注入与汉化校验 ---');
const distDir = path.join(root, 'extracted', 'dist');
const remoteDir = path.join(distDir, 'remote');

const disconnectedSource = fs.readFileSync(path.join(remoteDir, 'disconnectedPage.js'), 'utf-8');
const sshPromptsSource = fs.readFileSync(path.join(remoteDir, 'sshPrompts.js'), 'utf-8');
const sshPromptPreloadSource = fs.readFileSync(path.join(remoteDir, 'sshPromptPreload.js'), 'utf-8');
const remoteManagerSource = fs.readFileSync(path.join(remoteDir, 'remoteManager.js'), 'utf-8');
const sshArgsSource = fs.readFileSync(path.join(remoteDir, 'sshArgs.js'), 'utf-8');

check('disconnectedPage.js 包含 已断开连接 状态标题汉化', disconnectedSource.includes("const title = connecting ? '正在重新连接…' : '已断开连接';"), true);
check('disconnectedPage.js 包含 已断开与 主机连接大标题汉化', disconnectedSource.includes("已断开与 ${host} 的连接"), true);
check('disconnectedPage.js 包含 重新连接 按钮汉化', disconnectedSource.includes(">重新连接</a>"), true);
check('disconnectedPage.js 包含 关闭 按钮汉化', disconnectedSource.includes(">关闭</a>"), true);

check('sshPrompts.js 包含 再次提示密码 提示文本汉化', sshPromptsSource.includes("再次提示：上一次输入的密码或凭据可能不正确。"), true);
check('sshPrompts.js 包含 内容过长 校验提示汉化', sshPromptsSource.includes("内容过长。"), true);
check('sshPrompts.js 包含 取消/继续 按钮文本汉化', sshPromptsSource.includes(">取消</button><button id=\"continue\">继续</button>"), true);
check('sshPrompts.js 包含 请轻触你的安全密钥 交互提示汉化', sshPromptsSource.includes("请轻触你的安全密钥"), true);
check('sshPrompts.js 包含 是/否 对话框按钮汉化', sshPromptsSource.includes("['是', '否']"), true);

check('sshPromptPreload.js 包含 主机询问 标签汉化', sshPromptPreloadSource.includes("${label} 询问："), true);

check('remoteManager.js 包含 选择 SSH 配置文件 对话框标题汉化', remoteManagerSource.includes("title: '选择 SSH 配置文件'"), true);
check('remoteManager.js 包含 停止 SSH 服务端 警告标题汉化', remoteManagerSource.includes("title: '停止 SSH 服务端'"), true);
check('remoteManager.js 包含 停止服务端 按钮汉化', remoteManagerSource.includes("['停止服务端', '取消']"), true);
check('remoteManager.js 包含 未连接到 主机提示汉化', remoteManagerSource.includes("未连接到 ${label}"), true);
check('remoteManager.js 包含 组织登录 对话框标题汉化', remoteManagerSource.includes("title: '登录'"), true);

check('sshArgs.js 包含 SSH 身份验证失败 错误指引汉化', sshArgsSource.includes("SSH 身份验证失败。请检查密码、动态验证码或密钥，然后重试。"), true);
check('sshArgs.js 包含 该 SSH 主机地址无效 错误描述汉化', sshArgsSource.includes("该 SSH 主机地址无效。"), true);
check('sshArgs.js 包含 SSH 端口转发失败 错误指引汉化', sshArgsSource.includes("SSH 端口转发失败。请确认服务端已允许您的账户进行 TCP 转发 (AllowTcpForwarding)，然后重试。"), true);
check('sshArgs.js 包含 该 SSH 主机不受支持 架构提示汉化', sshArgsSource.includes("该 SSH 主机不受支持。Antigravity 需要搭载 glibc 2.26 或更新版本的 Linux x64 或 arm64 系统。"), true);
check('sshArgs.js 包含 无法在 SSH 主机上安装 Antigravity 服务端 汉化', sshArgsSource.includes("无法在 SSH 主机上安装 Antigravity 服务端。"), true);
check('sshArgs.js 包含 SSH 连接已断开 状态提示汉化', sshArgsSource.includes("SSH 连接已断开。请检查网络连接后重新连接。"), true);

// 3. UI 界面细节与动态保障断言
console.log('\n--- 3. UI 界面细节与动态保障断言 ---');
const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');

check('preload.js 包含 连接到主机... 汉化', preloadSource.includes('"Connect to Host...": "连接到主机..."'), true);
check('preload.js 包含 连接到 SSH 主机... 汉化', preloadSource.includes('"Connect to SSH Host...": "连接到 SSH 主机..."'), true);
check('preload.js 包含 最近的主机 汉化', preloadSource.includes('"Recent Hosts": "最近的主机"'), true);
check('preload.js 包含 配置 SSH 主机... 汉化', preloadSource.includes('"Configure SSH Hosts...": "配置 SSH 主机..."'), true);
check('preload.js 包含 停止 SSH 服务端 汉化', preloadSource.includes('"Stop SSH server": "停止 SSH 服务端"'), true);
check('preload.js 包含 Reconnecting to 动态正则保障', preloadSource.includes("正在重新连接到 $1…"), true);
check('preload.js 包含 Disconnected from 动态正则保障', preloadSource.includes("已断开与 $1 的连接"), true);
check('preload.js 包含 Stop the Antigravity server on 动态正则保障', preloadSource.includes("停止 $1 上的 Antigravity 服务端？"), true);

// 4. app.asar.ready 打包产物全面验证
console.log('\n--- 4. app.asar.ready 打包产物全面验证 ---');
const asarBuf = fs.readFileSync(readyAsarPath);
const asarSource = asarBuf.toString('utf-8', 0, Math.min(asarBuf.length, 30000000));

check('app.asar.ready 包含 连接到 SSH 主机...', asarSource.includes('连接到 SSH 主机...'), true);
check('app.asar.ready 包含 停止 SSH 服务端', asarSource.includes('停止 SSH 服务端'), true);
check('app.asar.ready 包含 选择 SSH 配置文件', asarSource.includes('选择 SSH 配置文件'), true);
check('app.asar.ready 包含 已断开连接', asarSource.includes('已断开连接'), true);
check('app.asar.ready 包含 正在重新连接…', asarSource.includes('正在重新连接…'), true);
check('app.asar.ready 包含 请轻触你的安全密钥', asarSource.includes('请轻触你的安全密钥'), true);
check('app.asar.ready 包含 浏览器设置副标题汉化', asarSource.includes('配置内置浏览器、链接打开方式以及浏览器子智能体偏好设置。'), true);
check('app.asar.ready 包含 项目设置副标题汉化', asarSource.includes('管理项目文件夹与设置。'), true);

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}\n`);

if (passed !== total) {
  console.error('Ticket-36 校验存在失败项！');
  process.exit(1);
} else {
  console.log('[成功] Ticket-36 2.32.1 官方大版本特性与 Remote SSH 远程开发专项测试全部通过！');
}
