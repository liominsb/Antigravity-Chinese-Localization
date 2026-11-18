const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. 读取当前 localize.js 源码与 extracted/package.json
const { getCombinedSource, loadTranslatorSandbox } = require('./helpers/translator-loader');
const localizeSource = getCombinedSource();
const { translateString } = loadTranslatorSandbox();
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extracted', 'package.json'), 'utf-8'));

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

console.log('=== 开始 Ticket-11 Antigravity 2.15.1 核心版本与特性专项测试 ===\n');

// 1. 版本号校验
console.log('--- 2.15.1 版本元数据校验 ---');
const versionMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
const currentVer = versionMatch ? versionMatch[1] : '';
const parseVer = (v) => (v || '').split('.').map(n => parseInt(n, 10) || 0);
const isVerGte2151 = (v) => {
  const [maj, min, patch] = parseVer(v);
  return maj > 2 || (maj === 2 && min > 15) || (maj === 2 && min === 15 && patch >= 1);
};
check('localize.js CURRENT_VERSION 版本号有效且 >= 2.15.1', isVerGte2151(currentVer), true);
check('extracted/package.json version 有效且 >= 2.15.1', isVerGte2151(packageJson.version), true);

// 2. 核心文件完备性
console.log('\n--- 核心注入文件完备性测试 ---');
const distDir = path.join(__dirname, '..', 'extracted', 'dist');
check('preload.js 存在', fs.existsSync(path.join(distDir, 'preload.js')), true);
check('wizardPreload.js 存在', fs.existsSync(path.join(distDir, 'ideInstall', 'wizardPreload.js')), true);
check('menu.js 存在', fs.existsSync(path.join(distDir, 'menu.js')), true);
check('tray.js 存在', fs.existsSync(path.join(distDir, 'tray.js')), true);
check('loadingOverlay.js 存在', fs.existsSync(path.join(distDir, 'loadingOverlay.js')), true);
check('updater.js 存在', fs.existsSync(path.join(distDir, 'updater.js')), true);

// 3. 官方 2.15.1 更新器特征校验
console.log('\n--- 官方 2.15.1 更新器特征校验 ---');
const updaterSource = fs.readFileSync(path.join(distDir, 'updater.js'), 'utf-8');
check('updater.js 包含 2.15.x requestHeaders 特征', updaterSource.includes("autoUpdater.requestHeaders = { 'x-app-version': electron_1.app.getVersion() }"), true);

// 4. v2.15.1 核心特性汉化校验
console.log('\n--- 智能体控制、项目状态与报错汉化校验 ---');
const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');
check('preload.js 包含 No Project 映射', preloadSource.includes('"No Project": "无项目"'), true);
check('preload.js 包含 Invalid tool call 映射', preloadSource.includes('"Invalid tool call": "无效的工具调用"'), true);
check('preload.js 包含 Main Agent 映射', preloadSource.includes('"Main Agent": "主智能体"'), true);
check('preload.js 包含 Default tools 映射', preloadSource.includes('"Default tools": "默认工具"'), true);
check('preload.js 包含 Default prompt sections 映射', preloadSource.includes('"Default prompt sections": "默认提示词小节"'), true);
check('preload.js 包含 Cannot display binary file 映射', preloadSource.includes('"Cannot display binary file": "无法显示二进制文件"'), true);
check('preload.js 包含 Command canceled 映射', preloadSource.includes('"Command canceled": "命令已取消"'), true);

check('localize.js 包含 No Project 映射', localizeSource.includes('"No Project": "无项目"'), true);
check('localize.js 包含 Invalid tool call 映射', localizeSource.includes('"Invalid tool call": "无效的工具调用"'), true);
check('localize.js 包含 Main Agent 映射', localizeSource.includes('"Main Agent": "主智能体"'), true);
check('localize.js 包含 Default tools 映射', localizeSource.includes('"Default tools": "默认工具"'), true);

// 5. 侧边栏置顶与会话列表分组汉化校验
console.log('\n--- 侧边栏置顶与会话列表分组汉化校验 ---');
check('preload.js 包含 Pinned Conversations 映射', preloadSource.includes('"Pinned Conversations": "置顶对话"'), true);
check('preload.js 包含 pinned conversations 映射', preloadSource.includes('"pinned conversations": "置顶对话"'), true);
check('preload.js 包含 Recent Conversations 映射', preloadSource.includes('"Recent Conversations": "最近对话"'), true);
check('preload.js 包含 All Conversations 映射', preloadSource.includes('"All Conversations": "全部对话"'), true);
check('localize.js 包含 Pinned Conversations 映射', localizeSource.includes('"Pinned Conversations": "置顶对话"'), true);

// 6. 高频交互操作与无障碍标签校验
console.log('\n--- 高频交互操作与无障碍标签校验 ---');
check('preload.js 包含 Good response 映射', preloadSource.includes('"Good response": "好评回复"'), true);
check('preload.js 包含 Bad response 映射', preloadSource.includes('"Bad response": "差评回复"'), true);
check('preload.js 包含 More actions 映射', preloadSource.includes('"More actions": "更多操作"'), true);
check('preload.js 包含 Pin conversation 映射', preloadSource.includes('"Pin conversation": "置顶对话"'), true);
check('preload.js 包含 Undo to this point 映射', preloadSource.includes('"Undo to this point": "撤销至此处"'), true);
check('preload.js 包含 Copy code 映射', preloadSource.includes('"Copy code": "复制代码"'), true);
check('preload.js 包含 At mention code block 映射', preloadSource.includes('"At mention code block": "提及代码块"'), true);
check('preload.js 包含 Add inline comment 映射', preloadSource.includes('"Add inline comment": "添加行内注释"'), true);
check('preload.js 包含 Fold code block 映射', preloadSource.includes('"Fold code block": "折叠代码块"'), true);
check('preload.js 包含 User message 映射', preloadSource.includes('"User message": "用户消息"'), true);
check('preload.js 包含 Send message 映射', preloadSource.includes('"Send message": "发送消息"'), true);
check('preload.js 包含 Agent execution terminated 报错映射', preloadSource.includes('"Agent execution terminated due to error.": "智能体执行因错误而终止。"'), true);

// 7. 动态模板正则替换校验
console.log('\n--- 动态模板正则替换逻辑校验 ---');
check('preload.js 包含 See all (N) 动态正则', preloadSource.includes('/^See all\\s*\\(([^)]+)\\)$/i'), true);
check('preload.js 包含 Ran N commands 动态正则', preloadSource.includes('/^Ran\\s+(\\d+)\\s*(?:commands|命令)$/i'), true);
check('preload.js 包含 Load older messages 动态正则', preloadSource.includes('/^Load older messages,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+)$/i'), true);
check('preload.js 包含 Fold lines 动态正则', preloadSource.includes('/^Fold lines\\s+([0-9-]+)$/i'), true);

check('localize.js 包含 Good response 映射', localizeSource.includes('"Good response": "好评回复"'), true);
check('localize.js 包含 Bad response 映射', localizeSource.includes('"Bad response": "差评回复"'), true);
check('localize.js 包含 More actions 映射', localizeSource.includes('"More actions": "更多操作"'), true);
// 8. 安全预设与本地沙盒隔离模式校验
console.log('\n--- 安全预设与本地沙盒隔离模式校验 ---');
check('preload.js 包含 Enable Sandbox Mode (Preview) 映射', preloadSource.includes('"Enable Sandbox Mode (Preview)": "启用沙盒模式 (预览)"'), true);
check('preload.js 包含 Restricts agent tools 隔离描述映射', preloadSource.includes('"Restricts agent tools to a secure, isolated local sandbox.": "将智能体工具限制在安全、隔离的本地沙盒环境中。"'), true);
check('preload.js 包含 Security Preset 映射', preloadSource.includes('"Security Preset": "安全预设"'), true);

check('localize.js 包含 Enable Sandbox Mode (Preview) 映射', localizeSource.includes('"Enable Sandbox Mode (Preview)": "启用沙盒模式 (预览)"'), true);
check('localize.js 包含 Restricts agent tools 隔离描述映射', localizeSource.includes('"Restricts agent tools to a secure, isolated local sandbox.": "将智能体工具限制在安全、隔离的本地沙盒环境中。"'), true);
check('localize.js 包含 Security Preset 映射', localizeSource.includes('"Security Preset": "安全预设"'), true);

// 9. 高级设置与差异视图操作校验 (Advanced Settings & Diff Review Actions)
console.log('\n--- 高级设置与差异视图操作校验 ---');
check('preload.js 包含 Advanced Settings 映射', preloadSource.includes('"Advanced Settings": "高级设置"'), true);
check('引擎自愈映射: Advanced 设置 -> 高级设置', translateString('Advanced 设置'), '高级设置');
check('preload.js 包含 Automatic Check for Updates 映射', preloadSource.includes('"Automatic Check for Updates": "自动检查更新"'), true);
check('preload.js 包含 Collapse All 映射', preloadSource.includes('"Collapse All": "全部折叠"'), true);
check('preload.js 包含 Expand All 映射', preloadSource.includes('"Expand All": "全部展开"'), true);
check('preload.js 包含 View Stacked Diff 映射', preloadSource.includes('"View Stacked Diff": "查看堆叠差异"'), true);
check('preload.js 包含 View Split Diff 映射', preloadSource.includes('"View Split Diff": "查看分屏差异"'), true);
check('preload.js 包含 Show Whitespace Changes 映射', preloadSource.includes('"Show Whitespace Changes": "显示空白字符变动"'), true);
check('preload.js 包含 Hide Whitespace Changes 映射', preloadSource.includes('"Hide Whitespace Changes": "隐藏空白字符变动"'), true);
check('preload.js 包含 Collapse All Folders 映射', preloadSource.includes('"Collapse All Folders": "折叠所有文件夹"'), true);

check('localize.js 包含 Advanced Settings 映射', localizeSource.includes('"Advanced Settings": "高级设置"'), true);
check('源码包含 Advanced 设置 自愈映射', localizeSource.includes('Advanced 设置'), true);
check('localize.js 包含 Automatic Check for Updates 映射', localizeSource.includes('"Automatic Check for Updates": "自动检查更新"'), true);
check('localize.js 包含 Collapse All 映射', localizeSource.includes('"Collapse All": "全部折叠"'), true);
check('localize.js 包含 Expand All 映射', localizeSource.includes('"Expand All": "全部展开"'), true);
check('localize.js 包含 View Stacked Diff 映射', localizeSource.includes('"View Stacked Diff": "查看堆叠差异"'), true);
check('localize.js 包含 View Split Diff 映射', localizeSource.includes('"View Split Diff": "查看分屏差异"'), true);
check('localize.js 包含 Show Whitespace Changes 映射', localizeSource.includes('"Show Whitespace Changes": "显示空白字符变动"'), true);
check('localize.js 包含 Hide Whitespace Changes 映射', localizeSource.includes('"Hide Whitespace Changes": "隐藏空白字符变动"'), true);
check('localize.js 包含 Collapse All Folders 映射', localizeSource.includes('"Collapse All Folders": "折叠所有文件夹"'), true);

// 10. 项目专属权限与全局继承校验 (Project Permissions & Inherit Global)
console.log('\n--- 项目专属权限与全局继承校验 ---');
check('preload.js 包含 Inherit Global 映射', preloadSource.includes('"Inherit Global": "继承全局"'), true);
check('preload.js 包含 Inherits your Global Permissions 选项简介映射', preloadSource.includes('"Inherits your Global Permissions when working in this project.": "在此项目中工作时继承您的全局权限。"'), true);
check('preload.js 包含项目继承完整句映射', preloadSource.includes('"Also includes Global Permissions when working in this project."'), true);
check('行为级校验: Also includes Global Permissions 完整句汉化', translateString('Also includes Global Permissions when working in this project.'), '在当前项目中工作时，亦继承全局权限配置。');
check('preload.js 包含 Manually customize individual settings. 映射', preloadSource.includes('"Manually customize individual settings.": "手动自定义各项独立设置。"'), true);
check('preload.js 包含 Permission Preset 映射', preloadSource.includes('"Permission Preset": "权限预设"'), true);
check('preload.js 包含 Terminal Command Auto Execution 映射', preloadSource.includes('"Terminal Command Auto Execution": "终端命令自动执行"'), true);

check('localize.js 包含 Inherit Global 映射', localizeSource.includes('"Inherit Global": "继承全局"'), true);
check('localize.js 包含 Inherits your Global Permissions 选项简介映射', localizeSource.includes('"Inherits your Global Permissions when working in this project.": "在此项目中工作时继承您的全局权限。"'), true);
check('模块化词库包含项目继承完整句映射', localizeSource.includes('"Also includes Global Permissions when working in this project."'), true);
check('模块化词库已清除单残片全局污染键', !localizeSource.includes('"when working in this project.": "配置。"'), true);
check('localize.js 包含 Manually customize individual settings. 映射', localizeSource.includes('"Manually customize individual settings.": "手动自定义各项独立设置。"'), true);
check('localize.js 包含 Permission Preset 映射', localizeSource.includes('"Permission Preset": "权限预设"'), true);
check('localize.js 包含 Terminal Command Auto Execution 映射', localizeSource.includes('"Terminal Command Auto Execution": "终端命令自动执行"'), true);


check('行为级验证: See all (12) 动态翻译', translateString('See all (12)'), '查看全部 (12)');
check('行为级验证: Fold lines 10-25 动态翻译', translateString('Fold lines 10-25'), '折叠第 10-25 行');

console.log('\n========================================');
console.log(`测试完成: ${passed}/${total} 通过 (${passed === total ? 'ALL PASS' : 'FAILED'})`);
console.log('========================================');

if (passed !== total) {
  process.exit(1);
}



