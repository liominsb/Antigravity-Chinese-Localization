const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// 1. 读取当前 localize.js 源码
const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');

// 2. 提取 DOM_TRANSLATOR_INJECTION 中的 translateString 和 shouldSkipNode
function extractTranslator() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();

  injectionCode = injectionCode.replace(
    'if (document.readyState === \'loading\')',
    'globalThis.__test_translateString = translateString;\n  globalThis.__test_shouldSkipNode = shouldSkipNode;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
  );

  const sandbox = {
    globalThis: {},
    document: { body: null, readyState: 'loading', addEventListener: () => {} },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
    Element: { prototype: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    console: console
  };

  vm.createContext(sandbox);
  vm.runInContext(injectionCode, sandbox);
  return {
    translateString: sandbox.globalThis.__test_translateString,
    shouldSkipNode: sandbox.globalThis.__test_shouldSkipNode
  };
}

// 3. 提取 menuTranslationMap
function extractMenuTranslationMap() {
  const match = localizeSource.match(/const menuTranslationMap = ({[\s\S]*?});/);
  if (!match) {
    throw new Error('未能在 localize.js 中找到 menuTranslationMap 定义');
  }
  const hostSandbox = { globalThis: {} };
  vm.createContext(hostSandbox);
  vm.runInContext('globalThis.map = ' + match[1], hostSandbox);
  return hostSandbox.globalThis.map;
}

const { translateString } = extractTranslator();
const menuTranslationMap = extractMenuTranslationMap();

let passed = 0;
let total = 0;

function check(label, actual, expected) {
  total++;
  try {
    assert.strictEqual(actual, expected);
    console.log(`PASS [${total}]: ${label} => "${actual}"`);
    passed++;
  } catch (err) {
    console.error(`FAIL [${total}]: ${label}`);
    console.error(`  Expected: "${expected}"`);
    console.error(`  Actual:   "${actual}"`);
  }
}

console.log('=== 开始 Ticket-06 顶部菜单 Project 与侧边栏 Copy 汉化单元测试 ===\n');

// 1. 顶部菜单 Project 与缩放控制测试
console.log('--- 顶部文件与视图菜单测试 ---');
check('Create Project 汉化', translateString('Create Project'), '创建项目');
check('create project 汉化', translateString('create project'), '创建项目');
check('New Project 汉化', translateString('New Project'), '新建项目');
check('Open Project 汉化', translateString('Open Project'), '打开项目');
check('Reset Zoom 汉化', translateString('Reset Zoom'), '重置缩放');
check('Toggle Fullscreen 汉化', translateString('Toggle Fullscreen'), '切换全屏');
check('Version 动态版本提示', translateString('Version 2.12.2'), '版本 2.12.2');
check('Version 动态版本提示 v2', translateString('Version 1.0.0-beta'), '版本 1.0.0-beta');

// 2. 侧边栏与会话 Copy 及子菜单测试
console.log('\n--- 侧边栏与会话 Copy 及子项测试 ---');
check('独立 Copy 汉化', translateString('Copy'), '复制');
check('小写 copy 汉化', translateString('copy'), '复制');
check('已复制 Copied 汉化', translateString('Copied'), '已复制');
check('已复制 Copied! 汉化', translateString('Copied!'), '已复制！');
check('Conversation Name 汉化', translateString('Conversation Name'), '对话名称');
check('Conversation ID 汉化', translateString('Conversation ID'), '对话 ID');
check('Workspace Name 汉化', translateString('Workspace Name'), '工作区名称');
check('Worktree Name 汉化', translateString('Worktree Name'), 'Worktree 名称');
check('Project Name 汉化', translateString('Project Name'), '项目名称');

// 3. 轨迹与反馈详情测试
console.log('\n--- 轨迹与反馈详情测试 ---');
check('Copy trajectory ID 汉化', translateString('Copy trajectory ID'), '复制轨迹 ID');
check('Copy the trajectory ID 汉化', translateString('Copy the trajectory ID'), '复制轨迹 ID');
check('Trajectory ID 汉化', translateString('Trajectory ID'), '轨迹 ID');
check('Attach the trajectory ID to the feedback form 汉化', translateString('Attach the trajectory ID to the feedback form'), '将轨迹 ID 附加到反馈表单中');
check('Open in Trajectory Dashboard 汉化', translateString('Open in Trajectory Dashboard'), '在轨迹仪表盘中打开');
check('Trajectory Metadata 汉化', translateString('Trajectory Metadata'), '轨迹元数据');
check('No trajectory metadata available 汉化', translateString('No trajectory metadata available'), '暂无轨迹元数据');

// 4. 通用 Copy 复合词测试
console.log('\n--- 通用 Copy 复合词测试 ---');
check('Copy Content 汉化', translateString('Copy Content'), '复制内容');
check('Copy Link 汉化', translateString('Copy Link'), '复制链接');
check('Copy Path 汉化', translateString('Copy Path'), '复制路径');
check('Copy Image 汉化', translateString('Copy Image'), '复制图片');
check('Copy prompt 汉化', translateString('Copy prompt'), '复制提示词');
check('Copy Command 汉化', translateString('Copy Command'), '复制命令');
check('Copy error 汉化', translateString('Copy error'), '复制错误信息');
check('Copy to clipboard 汉化', translateString('Copy to clipboard'), '复制到剪贴板');
check('Copy File Path 汉化', translateString('Copy File Path'), '复制文件路径');
check('Copy File Name 汉化', translateString('Copy File Name'), '复制文件名');
check('Copy workspace 汉化', translateString('Copy workspace'), '复制工作区');
check('Copy project 汉化', translateString('Copy project'), '复制项目');
check('Copy debug info 汉化', translateString('Copy debug info'), '复制调试信息');
check('Copy conversation markdown 汉化', translateString('Copy conversation markdown'), '复制对话 Markdown');

// 5. 鼠标悬停预览窗 (Hover Card) 动态时间与状态测试
console.log('\n--- 鼠标悬停预览窗 (Hover Card) 测试 ---');
check('Updated 单独词条汉化', translateString('Updated'), '已更新');
check('updated 小写词条汉化', translateString('updated'), '已更新');
check('Action Required 汉化', translateString('Action Required'), '需要操作');
check('Unread 汉化', translateString('Unread'), '未读');
check('Active 汉化', translateString('Active'), '活跃');
check('Idle 汉化', translateString('Idle'), '空闲');
check('Canceling 汉化', translateString('Canceling'), '正在取消');
check('Updated 当天时间动态汉化', translateString('Updated 13:22'), '更新于 13:22');
check('Updated 历史时间动态汉化 (中文系统)', translateString('Updated 9月6日, 19:34'), '更新于 9月6日, 19:34');
check('Updated 历史时间动态汉化 (英文月份自动本地化)', translateString('Updated Sep 6, 19:34'), '更新于 9月6日, 19:34');
check('Updated 英文月份无逗号', translateString('Updated Oct 15, 08:30'), '更新于 10月15日, 08:30');

// 6. Electron 原生菜单映射测试
console.log('\n--- 原生菜单映射测试 ---');
check('menuTranslationMap: Create Project', menuTranslationMap['Create Project'], '创建项目');
check('menuTranslationMap: New Project', menuTranslationMap['New Project'], '新建项目');
check('menuTranslationMap: Open Project', menuTranslationMap['Open Project'], '打开项目');
check('menuTranslationMap: Copy', menuTranslationMap['Copy'], '复制');
check('menuTranslationMap: Reset Zoom', menuTranslationMap['Reset Zoom'], '重置缩放');
check('menuTranslationMap: Toggle Fullscreen', menuTranslationMap['Toggle Fullscreen'], '切换全屏');
check('menuTranslationMap: Command Palette', menuTranslationMap['Command Palette'], '命令面板');

console.log(`\n========================================`);
console.log(`测试完成: ${passed}/${total} 通过 (${passed === total ? 'ALL PASS' : 'FAILED'})`);
console.log(`========================================`);

if (passed !== total) {
  process.exit(1);
}
