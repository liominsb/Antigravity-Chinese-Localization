'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

console.log('=== Ticket-49 Antigravity 2.34.0 增量补齐（技能卡与插件描述、遗漏词条、设置描述模板规则） ===\n');

const ROOT = path.resolve(__dirname, '..');
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

const { translateString } = loadTranslatorSandbox();

// -----------------------------------------------------------------------------
// 1. 内置技能卡片描述（2.34.0 新增技能，上游 055ca22 未收录）
// -----------------------------------------------------------------------------
console.log('--- 1. 技能卡描述 ---');
check(
  '技能卡 mcp-app-development',
  translateString("Build, package, and debug MCP Apps for Antigravity: MCP server tools whose results render as interactive UI in the conversation, in the side pane, or full-page from the sidebar. Use when adding a UI to an MCP tool, building or theming the app itself, packaging it as a plugin, or debugging an app that doesn't render or behave as expected."),
  '为 Antigravity 构建、打包并调试 MCP 应用：这类 MCP 服务器工具的返回结果会以交互式 UI 呈现——可显示在对话中、侧边面板内，或从侧边栏打开为整页。适用于为 MCP 工具添加界面、构建或定制应用主题、将其打包为插件，以及调试渲染或行为不符合预期的应用。'
);
check(
  '技能卡 migrate-agent-settings',
  translateString("Migrates the user's MCP servers, skills, slash commands, subagents, and instruction files from other coding agents (Claude Code, Codex, Cursor, Gemini CLI) into one new Antigravity plugin. Use when the user wants to bring over, import, or migrate their setup or config from another agent or tool. Don't use for installing Marketplace plugins or authoring a new plugin from scratch (use the plugin skill)."),
  '把用户在其他编码智能体（Claude Code、Codex、Cursor、Gemini CLI）中的 MCP 服务器、技能、斜杠命令、子智能体与指令文件迁移到一个新的 Antigravity 插件中。适用于用户希望导入或迁移其他智能体或工具的配置。不适用于安装市场插件或从零编写新插件（请使用 plugin 技能）。'
);
check(
  '技能卡 native_swarm',
  translateString("(Preview & Quota Heavy) Run a swarm: several agents working in parallel on one task, each in its own conversation, collaborating through a shared message board. Use when the work splits into pieces that can be done at the same time, or when a second pair of eyes should check the first pair's work."),
  '（预览版，消耗额度较多）运行一个编排集群：多个智能体并行处理同一任务，各自在独立对话中工作，并通过共享留言板协作。适用于任务可拆分为可同时推进的多块，或需要第二组人复核第一组工作的情况。'
);
check(
  '技能卡 run-workflow',
  translateString("How to write and run a dynamic workflow script with the `run_workflow` tool: a Python script that orchestrates many agents with `agent`, `parallel`, `pipeline`, and `phase`. Use when a task splits into many independent or staged pieces of agent work (fan out over files, modules, bugs, or review angles, then aggregate), or when the user asks for a workflow. Don't use for a single delegated task (use a subagent) or for legacy workflow files (see migrate-workflows)."),
  '介绍如何用 `run_workflow` 工具编写并运行动态工作流脚本：这是一段 Python 脚本，通过 `agent`、`parallel`、`pipeline` 与 `phase` 来编排多个智能体。适用于任务可拆成多个独立或分阶段的智能体工作（按文件、模块、缺陷或评审角度分发后再汇总），或用户明确要求工作流时。不适用于单次委派任务（请用子智能体）或旧版工作流文件（见 migrate-workflows）。'
);
check(
  '技能卡 swarm_monitor',
  translateString('ONLY for the native-swarm worker whose brief says it is the monitor. On a timer, it checks whether the whole swarm has stalled and calls on the one member who can unstick it. Coordinators and other workers: do not load this.'),
  '仅用于简介中声明自己是 monitor 的 native-swarm 工作者。它按定时器检查整个集群是否停滞，并召集唯一能让其恢复推进的成员。协调者与其他工作者请勿加载本技能。'
);
check(
  '技能卡 swarm_narrator',
  translateString("ONLY for the native-swarm worker whose brief says it is the narrator. It watches the board and keeps the facts behind the user's Overview (view.json) current. Coordinators and other workers: do not load this."),
  '仅用于简介中声明自己是 narrator 的 native-swarm 工作者。它监视留言板，维护用户「概览」（view.json）背后的事实数据。协调者与其他工作者请勿加载本技能。'
);
check(
  '技能卡 swarm_pane',
  translateString("What the coordinator writes so the Swarm UI's Overview can show the swarm's goal, its groups of work and a screenshot timeline. Load it before you brief and add the first workers to a swarm."),
  '协调者写入的内容，用于让 Swarm 界面的「概览」展示集群目标、工作分组与截图时间线。在为集群撰写简介并加入首批工作者之前加载本技能。'
);

// -----------------------------------------------------------------------------
// 2. 插件描述与遗漏界面文案
// -----------------------------------------------------------------------------
console.log('--- 2. 插件描述与遗漏词条 ---');
check('插件卡 Swarm 描述', translateString('Unlock the power of agent swarms.'), '解锁智能体集群的全部能力。');
const misc = [
  ['e.g. work', '例如：work'],
  ['e.g., curl', '例如：curl'],
  ['e.g., npm test', '例如：npm test'],
  ['e.g., example.com', '例如：example.com'],
  ['e.g., chromium/src', '例如：chromium/src'],
  ['e.g., /path/to/file', '例如：/path/to/file'],
  ['e.g., main or refs/heads/main', '例如：main 或 refs/heads/main'],
  ['Open in Cider', '在 Cider 中打开'],
  ["Couldn't connect", '无法连接'],
  ['Method not found', '方法不存在'],
  ['Skipping...', '正在跳过…'],
  ['script source must not be empty', '脚本源码不能为空'],
];
for (const [en, zh] of misc) check(en, translateString(en), zh);

// -----------------------------------------------------------------------------
// 3. 设置描述模板规则（上游 055ca22 未覆盖）
// -----------------------------------------------------------------------------
console.log('--- 3. 设置描述模板规则 ---');
check('项目外对话设置（projects）', translateString('Settings for conversations outside of projects.'), '项目之外对话的设置。');
check('项目外对话设置（workspaces 变体）', translateString('Settings for conversations outside of workspaces.'), '工作区之外对话的设置。');
check('项目外对话设置（folders 变体）', translateString('Settings for conversations outside of folders.'), '文件夹之外对话的设置。');
check('项目外对话设置（conversations 变体）', translateString('Settings for conversations outside of conversations.'), '对话之外对话的设置。');
check('项目外智能体设置与权限', translateString('Agent settings and permissions for conversations outside of projects.'), '项目之外对话的智能体设置与权限。');
check(
  '旧措辞（外部…配置）不再出现',
  translateString('Agent settings and permissions for conversations outside of projects.') === '项目外部对话的智能体设置和权限配置。',
  false
);

// -----------------------------------------------------------------------------
// 4. 快捷键录制规则（上游 055ca22 未覆盖）
// -----------------------------------------------------------------------------
console.log('--- 4. 快捷键录制规则 ---');
check(
  '录制提示（动作名透传）',
  translateString('Recording shortcut for Open Chat. Press keys to bind, Enter to save, Escape to cancel.'),
  '正在为 Open Chat 录制快捷键。按下按键绑定，Enter 保存，Escape 取消。'
);
check('Press keys 占位', translateString('Press keys...'), '请按下按键...');

// -----------------------------------------------------------------------------
// 5. 幂等性
// -----------------------------------------------------------------------------
console.log('--- 5. 幂等性 ---');
const idemCases = [
  'Settings for conversations outside of projects.',
  'Agent settings and permissions for conversations outside of projects.',
  'Unlock the power of agent swarms.',
  'Recording shortcut for Open Chat. Press keys to bind, Enter to save, Escape to cancel.',
];
for (const s of idemCases) {
  const first = translateString(s);
  const second = translateString(s);
  check(`二次命中缓存不变：${s.slice(0, 36)}...`, second, first);
}

// -----------------------------------------------------------------------------
// 6. 红线
// -----------------------------------------------------------------------------
console.log('--- 6. 红线 ---');
check('Google Chat 保留', translateString('Google Chat'), 'Google Chat');
check('模型名保留', translateString('Gemini 3.8 Flash'), 'Gemini 3.8 Flash');
check('无关句子不误伤', translateString('Select a sidebar item from the list'), 'Select a sidebar item from the list');
check('无关句子不误伤（2）', translateString('Press the button to continue.'), 'Press the button to continue.');

console.log(`\n======================================================`);
console.log(`Ticket-49 验收结果: ${passed}/${total} 断言通过`);
console.log(`======================================================`);

if (passed !== total) {
  process.exit(1);
}
