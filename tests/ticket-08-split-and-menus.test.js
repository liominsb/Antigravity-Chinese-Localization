const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// 1. 读取当前 localize.js 源码并提取 translateString
const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');

function getTranslateStringFunction() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();

  injectionCode = injectionCode.replace(
    'if (document.readyState === \'loading\')',
    'globalThis.__test_translateString = translateString;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
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
  return sandbox.globalThis.__test_translateString;
}

const translateString = getTranslateStringFunction();

// 2. 提取 menuTranslationMap
function getMenuTranslationMap() {
  const match = localizeSource.match(/const menuTranslationMap = (\{[\s\S]*?\});/);
  if (!match) {
    throw new Error('未找到 menuTranslationMap');
  }
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('var map = ' + match[1], sandbox);
  return sandbox.map;
}

const menuMap = getMenuTranslationMap();

console.log('=== 开始 Ticket-08 分屏 (Split)、派生 (Fork) 与菜单交互测试 ===\n');

const testCases = [
  // --- 分屏 (Split) 交互与子菜单 ---
  { name: 'Split 独立词条汉化', input: 'Split', expected: '分屏' },
  { name: 'split 小写词条汉化', input: 'split', expected: '分屏' },
  { name: 'Split Right 汉化', input: 'Split Right', expected: '向右分屏' },
  { name: 'split right 汉化', input: 'split right', expected: '向右分屏' },
  { name: 'Split Down 汉化', input: 'Split Down', expected: '向下分屏' },
  { name: 'split down 汉化', input: 'split down', expected: '向下分屏' },
  { name: 'Replace With New 汉化', input: 'Replace With New', expected: '替换为新建' },
  { name: 'replace with new 汉化', input: 'replace with new', expected: '替换为新建' },
  { name: 'Remove From Split 汉化', input: 'Remove From Split', expected: '从分屏中移除' },
  { name: 'remove from split 汉化', input: 'remove from split', expected: '从分屏中移除' },
  { name: 'Split Terminal 汉化', input: 'Split Terminal', expected: '拆分终端' },
  { name: 'Split Conversation Vertically 汉化', input: 'Split Conversation Vertically', expected: '垂直分屏对话' },
  { name: 'Split Conversation Horizontally 汉化', input: 'Split Conversation Horizontally', expected: '水平分屏对话' },
  { name: 'Equalize Split Panes 汉化', input: 'Equalize Split Panes', expected: '均分分屏窗格' },
  { name: 'Restore split view 汉化', input: 'Restore split view', expected: '恢复分屏视图' },
  { name: 'Close split view and go to forked conversation 汉化', input: 'Close split view and go to forked conversation', expected: '关闭分屏视图并转到派生的对话' },
  { name: 'View Split Diff 汉化', input: 'View Split Diff', expected: '查看分屏差异' },
  { name: 'Resize terminal panes 汉化', input: 'Resize terminal panes', expected: '调整终端窗格大小' },

  // --- 派生 (Fork) 交互与子菜单 ---
  { name: 'Fork 独立词条汉化', input: 'Fork', expected: '派生' },
  { name: 'fork 小写词条汉化', input: 'fork', expected: '派生' },
  { name: 'Fork Conversation 汉化', input: 'Fork Conversation', expected: '派生对话' },
  { name: 'Create fork in current workspace 汉化', input: 'Create fork in current workspace', expected: '在当前工作区创建派生' },
  { name: 'Create fork in shared workspace 汉化', input: 'Create fork in shared workspace', expected: '在共享工作区创建派生' },
  { name: 'Create fork in new workspace 汉化', input: 'Create fork in new workspace', expected: '在新建工作区创建派生' },
  { name: 'Failed to fork conversation 汉化', input: 'Failed to fork conversation', expected: '派生对话失败' },
  { name: 'Forked from 汉化', input: 'Forked from', expected: '派生自' },
  { name: 'Fork Environment Notice 汉化', input: 'Fork Environment Notice', expected: '派生环境提示' },
  { name: 'The server returned no conversation to fork into. 汉化', input: 'The server returned no conversation to fork into.', expected: '服务器未返回可供派生的对话。' },

  // --- 对话分组 (Conversation Groups) ---
  { name: 'Move to Group 汉化', input: 'Move to Group', expected: '移动到分组' },
  { name: 'Move to group 汉化', input: 'Move to group', expected: '移动到分组' },
  { name: 'New Group 汉化', input: 'New Group', expected: '新建分组' },
  { name: 'Create Group 汉化', input: 'Create Group', expected: '创建分组' },
  { name: 'Delete Group 汉化', input: 'Delete Group', expected: '删除分组' },
  { name: 'Rename Group 汉化', input: 'Rename Group', expected: '重命名分组' },
  { name: 'Remove from Group 汉化', input: 'Remove from Group', expected: '从分组中移除' },
  { name: 'No groups yet 汉化', input: 'No groups yet', expected: '暂无分组' },
  { name: 'Group name 汉化', input: 'Group name', expected: '分组名称' },
  { name: 'Group Name 汉化', input: 'Group Name', expected: '分组名称' },
  { name: 'Enter group name 汉化', input: 'Enter group name', expected: '输入分组名称' },
  { name: 'A group with this name already exists. 汉化', input: 'A group with this name already exists.', expected: '已存在同名分组。' },
  { name: 'Group By 汉化', input: 'Group By', expected: '分组方式' },
  { name: 'Group By Project 汉化', input: 'Group By Project', expected: '按项目分组' },
  { name: 'Group By Workspace 汉化', input: 'Group By Workspace', expected: '按工作区分组' },
  { name: 'Sidebar grouped by project 汉化', input: 'Sidebar grouped by project', expected: '侧边栏已按项目分组' },
  { name: 'Sidebar grouped by workspace 汉化', input: 'Sidebar grouped by workspace', expected: '侧边栏已按工作区分组' },

  // --- 窗格与插件扩展 ---
  { name: 'Maximize Pane 汉化', input: 'Maximize Pane', expected: '最大化窗格' },
  { name: 'Restore Pane 汉化', input: 'Restore Pane', expected: '恢复窗格' },
  { name: 'Auxiliary Pane 汉化', input: 'Auxiliary Pane', expected: '辅助窗格' },
  { name: 'Toggle Auxiliary Pane 汉化', input: 'Toggle Auxiliary Pane', expected: '切换辅助窗格' },
  { name: 'Open in Preview Pane 汉化', input: 'Open in Preview Pane', expected: '在预览窗格中打开' },
  { name: 'No plugins available 汉化', input: 'No plugins available', expected: '暂无可用插件' },

  // --- 分屏与分组自愈修正测试 ---
  { name: 'Replace With 新建 自愈修正', input: 'Replace With 新建', expected: '替换为新建' },
  { name: '移除 From Split 自愈修正', input: '移除 From Split', expected: '从分屏中移除' },
  { name: 'Split 终端 自愈修正', input: 'Split 终端', expected: '拆分终端' },
  { name: '新建 Group 自愈修正', input: '新建 Group', expected: '新建分组' },
  { name: '创建 Group 自愈修正', input: '创建 Group', expected: '创建分组' },
  { name: '移动到 Group 自愈修正', input: '移动到 Group', expected: '移动到分组' },
  { name: '重命名 Group 自愈修正', input: '重命名 Group', expected: '重命名分组' },
  { name: '删除 Group 自愈修正', input: '删除 Group', expected: '删除分组' },
  { name: '从 Group 中移除 自愈修正', input: '从 Group 中移除', expected: '从分组中移除' },
  { name: '向右 Split 自愈修正', input: '向右 Split', expected: '向右分屏' },
  { name: '向下 Split 自愈修正', input: '向下 Split', expected: '向下分屏' }
];

let passed = 0;
let failed = 0;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const actual = translateString(tc.input);
  try {
    assert.strictEqual(actual, tc.expected);
    console.log(`PASS [${i + 1}]: ${tc.name} => "${actual}"`);
    passed++;
  } catch (e) {
    console.error(`FAIL [${i + 1}]: ${tc.name}`);
    console.error(`  期望: "${tc.expected}"`);
    console.error(`  实际: "${actual}"`);
    failed++;
  }
}

// 原生菜单校验
const menuCheckKeys = ['Split', 'Split Right', 'Split Down', 'Replace With New', 'Remove From Split', 'Split Terminal', 'Fork'];
for (const k of menuCheckKeys) {
  try {
    assert(menuMap[k], `menuTranslationMap 应包含 ${k}`);
    console.log(`PASS [Menu]: menuTranslationMap[${k}] => "${menuMap[k]}"`);
    passed++;
  } catch (e) {
    console.error(`FAIL [Menu]: ${e.message}`);
    failed++;
  }
}

console.log('\n========================================');
console.log(`测试完成: ${passed}/${passed + failed} 通过 (${failed === 0 ? 'ALL PASS' : 'FAILED'})`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
