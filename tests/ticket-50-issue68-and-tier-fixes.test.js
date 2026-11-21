'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

console.log('=== 开始 Ticket-50 Orchestrator 原生保留 / Extra High 档位修复 & Issue #68 权限弹窗专项测试 ===\n');

const ROOT = path.resolve(__dirname, '..');
const { translateString } = loadTranslatorSandbox();
let passed = 0;
let total = 0;

function check(desc, actual, expected) {
  total++;
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`PASS [${total}]: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`FAIL [${total}]: ${desc}`);
    console.error('   期望:', expected);
    console.error('   实际:', actual);
  }
}

console.log('--- 1. Orchestrator 模式名保留与 Extra High (杜绝"极高高") 修复 ---');
check('Orchestrator 模式名保持英文原生', translateString('Orchestrator'), 'Orchestrator');
check('Orchestrator Settings 使用原生模式名', translateString('Orchestrator Settings'), 'Orchestrator 设置');
check('Orchestrator Model 使用原生模式名', translateString('Orchestrator Model'), 'Orchestrator 模型');
check("The Orchestrator's own planner 使用原生模式名", translateString("The Orchestrator's own planner"), 'Orchestrator 自带规划器');
check('Extra High 精确输出 极高（不拼出极高高）', translateString('Extra High'), '极高');
check('Extra high 小写输出 极高（不拼出极高高）', translateString('Extra high'), '极高');
check('Extra High · 1M 上下文窗口组合正常', translateString('Extra High · 1M context'), '极高 · 1M context');
check('Gemini 4 Neon Extra High 整体模型名保持原生', translateString('Gemini 4 Neon Extra High'), 'Gemini 4 Neon Extra High');

console.log('\n--- 2. Issue #68 终端高危命令/沙箱跨区拦截与运行时权限弹窗家族 ---');
const staticCases = [
  ['Yes, allow this time', '是，仅本次允许'],
  ['Yes, allow this download', '是，允许本次下载'],
  ['Yes, save rule in this conversation', '是，在当前对话中保存规则'],
  ['Yes, and always allow in this conversation', '是，并在当前对话中始终允许'],
  ['Yes, save rule globally', '是，全局保存规则'],
  ['Yes, and always allow', '是，并始终允许'],
  ['No (tell the agent what to do instead)', '否（告诉智能体改为执行什么操作）'],
  ['(tell the agent what to do instead)', '（告诉智能体改为执行什么操作）'],
  ['Allow the browser agent to download a file?', '是否允许浏览器智能体下载文件？'],
  ['Requires manual confirmation.', '需要人工确认。'],
  ['Requesting a one-time administrator (UAC) elevation', '正在请求一次性管理员 (UAC) 权限提升'],
];
for (const [en, zh] of staticCases) {
  check(`静态权限选项: ${en}`, translateString(en), zh);
}

const dynamicCases = [
  ["Yes, and always allow 'npm test' in this conversation", "是，并在当前对话中始终允许 'npm test'"],
  ["Yes, and always allow 'Remove-Item -Recurse -Force'", "是，并始终允许 'Remove-Item -Recurse -Force'"],
  ["Yes, save rule for 'rm' in this conversation", "是，在当前对话中为 'rm' 保存规则"],
  ["Yes, save rule for 'git status' globally", "是，全局保存 'git status' 的规则"],
  ['Yes, allow downloads from github.com for this run', '是，本次运行允许从 github.com 下载'],
  ['Yes, allow downloads from github.com in this conversation', '是，在当前对话中允许从 github.com 下载'],
  ['Yes, always allow downloads from github.com', '是，始终允许从 github.com 下载'],
  ['Yes, allow example.com in this conversation', '是，在当前对话中允许 example.com'],
  ['Yes, always allow example.com', '是，始终允许 example.com'],
  ['Conflicts with your configured Ask permission: command(rm)', '与您配置的询问权限冲突：command(rm)'],
  ['Requires manual confirmation: destructive shell rule', '需要人工确认：destructive shell rule'],
  ['Save rule to always allow running this command?', '保存规则以始终允许运行此命令？'],
  ['Save rule to always allow running this command outside the sandbox?', '保存规则以始终允许在沙盒外运行此命令？'],
  ['Allow running this command?', '是否允许运行此命令？'],
  ['Allow running this command outside the sandbox?', '是否允许在沙盒外运行此命令？'],
  ['Allow using this MCP tool?', '是否允许使用此 MCP 工具？'],
  ['Allow access to this resource?', '是否允许访问此资源？'],
  ['Allow PowerShell command?', '是否允许 PowerShell command？'],
  [
    'Recursively deleting the pre-existing directory C:\\temp\\foo permanently destroys files outside the workspace that cannot be locally recovered.',
    '递归删除已有目录 C:\\temp\\foo 将永久销毁工作区外且无法在本地恢复的文件。',
  ],
  ['Requesting permission to execute npm test', '正在请求执行权限：npm test'],
];
for (const [en, zh] of dynamicCases) {
  check(`动态权限模板: ${en}`, translateString(en), zh);
}

console.log('\n--- 3. 幂等性与不重复拼接检查 ---');
for (const sample of [
  'Extra High',
  "Yes, and always allow 'npm test' in this conversation",
  'Allow running this command outside the sandbox?',
  'Recursively deleting the pre-existing directory /tmp/a permanently destroys files outside the workspace that cannot be locally recovered.',
]) {
  const once = translateString(sample);
  const twice = translateString(once);
  check(`幂等校验: ${sample}`, twice, once);
  check(`无“极高高”残余: ${sample}`, !once.includes('极高高'), true);
}

const builtPreload = fs.readFileSync(path.join(ROOT, 'extracted', 'dist', 'preload.js'), 'utf-8');
check(
  'extracted preload.js 包含 Extra High 修复且不含独立 "Orchestrator": "编排器"',
  builtPreload.includes('"Extra High"') &&
    builtPreload.includes('"极高"') &&
    !/"Orchestrator"\s*:\s*"编排器"/.test(builtPreload),
  true
);

console.log(`\n=== Ticket-50 测试总结: ${passed}/${total} 通过 ===`);
if (passed !== total) {
  process.exit(1);
}
