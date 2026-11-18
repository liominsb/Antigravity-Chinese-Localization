'use strict';

const assert = require('assert');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

const { translateString } = loadTranslatorSandbox();

const testCases = [
  // --- 基础文件名/路径/普通英文短语防误伤保护 ---
  { name: '文件名中的 remove 不能被误分词为 移除', input: '01-remove-dynamic-words-engine.md', expected: '01-remove-dynamic-words-engine.md' },
  { name: '文件名中的 backup 不能被误分词为 备份', input: '03-verification-and-backup-safety-test.md', expected: '03-verification-and-backup-safety-test.md' },
  { name: '路径中的 docs 不能被误分词为 文档', input: 'grill-with-docs-zh/SKILL.md', expected: 'grill-with-docs-zh/SKILL.md' },
  { name: '普通短语中的 Error 不能被强制半中半英替换', input: 'Fixing Npm Ebusy Error', expected: 'Fixing Npm Ebusy Error' },

  // --- 智能体步骤状态与核心菜单词条 ---
  { name: 'Worked for 5s 汉化为 总耗时 5s', input: 'Worked for 5s', expected: '总耗时 5s' },
  { name: 'Explored 1 file 汉化为 已探索 1 个文件', input: 'Explored 1 file', expected: '已探索 1 个文件' },
  { name: 'UI 菜单 File 正常汉化为 文件', input: 'File', expected: '文件' },
  { name: 'UI 菜单 Settings 正常汉化为 设置', input: 'Settings', expected: '设置' },
  { name: '分组菜单项 Project 正常汉化为 项目', input: 'Project', expected: '项目' },
  { name: '菜单项复数 Projects 正常汉化为 项目', input: 'Projects', expected: '项目' },
  { name: '复合短语 Select Project 汉化为 选择项目', input: 'Select Project', expected: '选择项目' },
  { name: '复合短语 New Project 汉化为 新建项目', input: 'New Project', expected: '新建项目' },
  { name: '复合短语 Quick Start 汉化为 快速开始 (绝不夹生)', input: 'Quick Start', expected: '快速开始' },
  { name: '复合短语 No Project 汉化为 无项目', input: 'No Project', expected: '无项目' },

  // --- Models & Usage 与动态配额刷新 ---
  { name: 'Models & Usage 标题汉化', input: 'Models & Usage', expected: '模型配额与用量' },
  { name: 'Manage your model quota and credits. 汉化', input: 'Manage your model quota and credits.', expected: '管理您的模型配额与个人 AI 点数。' },
  { name: 'Plan 汉化为 计划', input: 'Plan', expected: '计划' },
  { name: 'Google AI Ultra 升级文案汉化', input: 'You can upgrade to a Google AI Ultra plan to receive higher rate limits.', expected: '您可以升级至 Google AI Ultra 计划以获得更高额度的调用速率上限。' },
  { name: 'Gemini Models 汉化为 Gemini 模型', input: 'Gemini Models', expected: 'Gemini 模型' },
  { name: 'Weekly Limit Remaining 汉化为 每周剩余限额', input: 'Weekly Limit Remaining', expected: '每周限额剩余' },
  { name: 'Five Hour Limit Remaining 汉化为 5 小时剩余限额', input: 'Five Hour Limit Remaining', expected: '5 小时限额剩余' },
  { name: 'Claude and GPT models 汉化为 Claude 与 GPT 模型', input: 'Claude and GPT models', expected: 'Claude 与 GPT 模型' },
  { name: '导航栏 Models 汉化为 模型', input: 'Models', expected: '模型' },
  {
    name: '动态刷新时间句子汉化（天/小时，无双冒号）',
    input: 'You have used some of your weekly limit it will fully refresh in: 2 days 19 hours',
    expected: '您已使用了部分每周限额。它将在以下时间后完全刷新：2 天 19 小时',
  },

  // --- 应用设置、远程控制与执行/队列设置 ---
  { name: 'Manage Antigravity app settings. 汉化', input: 'Manage Antigravity app settings.', expected: '管理 Antigravity 应用程序偏好设置。' },
  { name: '后台常驻描述文案汉化', input: 'Keep the app accessible from the menu bar and running in the background when all windows are closed.', expected: '关闭所有窗口后，保持应用常驻系统托盘并继续在后台运行。' },
  { name: 'Remote Control 汉化为 远程控制', input: 'Remote Control', expected: '远程控制' },
  { name: 'Enable Remote Control 汉化为 启用远程控制', input: 'Enable Remote Control', expected: '启用远程控制' },
  { name: 'Work with local agents from another device. 汉化', input: 'Work with local agents from another device.', expected: '支持从其他设备远程协同与控制本地智能体。' },
  { name: 'Device Name 汉化为 设备名称', input: 'Device Name', expected: '设备名称' },
  { name: 'Scan the code to open this device in Remote Control, or copy link. 汉化', input: 'Scan the code to open this device in Remote Control, or copy link.', expected: '扫描二维码以在远程控制中打开此设备，或复制链接。' },
  { name: 'Configure agent execution, queued message delivery, and permissions. 汉化', input: 'Configure agent execution, queued message delivery, and permissions.', expected: '配置智能体执行策略、消息队列发送机制以及安全权限。' },
  { name: 'Execution 汉化为 执行', input: 'Execution', expected: '执行' },
  { name: 'Queued Messages 汉化为 队列消息', input: 'Queued Messages', expected: '排队消息' },
  { name: 'Configure when follow-up messages are sent. 汉化', input: 'Configure when follow-up messages are sent.', expected: '配置后续跟进消息的发送时机。' },
  { name: 'Queue 汉化为 排队', input: 'Queue', expected: '排队等待' },
  { name: 'Send Immediately 汉化为 立即发送', input: 'Send Immediately', expected: '立即发送' },
  { name: 'Keyboard shortcuts 汉化为 键盘快捷键', input: 'Keyboard shortcuts', expected: '键盘快捷键' },
  { name: 'Turbo Mode 汉化为 极速模式', input: 'Turbo Mode', expected: '极速模式' },
  { name: 'Learn more about Turbo mode 汉化', input: 'Learn more about Turbo mode', expected: '了解关于极速模式的更多信息' },
  { name: 'Configure the browser subagent. It requires 汉化', input: 'Configure the browser subagent. It requires', expected: '配置浏览器子智能体。这需要' },
  { name: 'to be installed. 汉化', input: 'to be installed.', expected: '需要安装。' },
];

let failedCount = 0;
let passedCount = 0;
console.log('=== 开始执行 Ticket 01 翻译精准度与防误伤单元测试 ===\n');

for (const tc of testCases) {
  const actual = translateString(tc.input);
  try {
    assert.strictEqual(actual, tc.expected);
    console.log(`[PASS] ${tc.name}`);
    passedCount++;
  } catch (_) {
    console.error(`[FAIL] ${tc.name}`);
    console.error(`       输入: "${tc.input}"`);
    console.error(`       实际: "${actual}"`);
    console.error(`       期望: "${tc.expected}"\n`);
    failedCount++;
  }
}

console.log(`\n测试汇总: 通过: ${passedCount}, 失败: ${failedCount}, 总计: ${testCases.length}`);
if (failedCount > 0) {
  process.exit(1);
}
