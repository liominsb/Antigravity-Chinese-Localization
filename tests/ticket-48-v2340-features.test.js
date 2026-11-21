'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');
const { loadTranslatorSandbox, compareSemver } = require('./helpers/translator-loader');
const { extractChangelogSection } = require('../release-assets/generate-release-assets');

console.log('=== 开始 Ticket-48 Antigravity 2.34.0 官方版本全量特性与主进程补丁专项测试 ===\n');

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

// -----------------------------------------------------------------------------
// 1. v2.34.0 版本号、文档与产物元数据一致性校验
// -----------------------------------------------------------------------------
console.log('--- 1. v2.34.0 版本号与文档元数据校验 ---');
const localizeSource = fs.readFileSync(path.join(ROOT, 'localize.js'), 'utf-8');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const extractedPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extracted', 'package.json'), 'utf-8'));
const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const readmeZh = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
const readmeEn = fs.readFileSync(path.join(ROOT, 'README.en.md'), 'utf-8');
const archZh = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf-8');
const archEn = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.en.md'), 'utf-8');
const changelogZh = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8');
const changelogEn = fs.readFileSync(path.join(ROOT, 'CHANGELOG.en.md'), 'utf-8');
const readyAsarPath = path.join(ROOT, 'app.asar.ready');

const curVerMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
const relVerMatch = localizeSource.match(/const RELEASE_VERSION = ['"]([^'"]+)['"];/);
check('localize.js CURRENT_VERSION >= 2.34.0', Boolean(curVerMatch && compareSemver(curVerMatch[1], '2.34.0') >= 0), true);
check('localize.js RELEASE_VERSION >= 2.34.0', Boolean(relVerMatch && compareSemver(relVerMatch[1], '2.34.0') >= 0), true);
check('package.json version >= 2.34.0', compareSemver(rootPkg.version, '2.34.0') >= 0, true);
check('extracted/package.json version >= 2.34.0', compareSemver(extractedPkg.version, '2.34.0') >= 0, true);
check('app.asar.ready package.json version >= 2.34.0', compareSemver(readAsarPackageVersion(readyAsarPath), '2.34.0') >= 0, true);
check('index.html 控制中心显示 v2.34.0+', /控制中心 v2\.(3[4-9]|[4-9]\d)\./.test(indexSource), true);
check('README.md 与 README.en.md 标注 v2.34.0+', /v2\.(3[4-9]|[4-9]\d)\./.test(readmeZh) && /v2\.(3[4-9]|[4-9]\d)\./.test(readmeEn), true);
check('docs/architecture(.en).md 同步 v2.34.0+', archZh.includes('2.34.0') && archEn.includes('2.34.0'), true);
check('CHANGELOG.md 与 CHANGELOG.en.md 包含 v2.34.0 章节', changelogZh.includes('## v2.34.0 (2026-11-21)') && changelogEn.includes('## v2.34.0 (2026-11-21)'), true);
check('extractChangelogSection 精确提取 v2.34.0 章节', extractChangelogSection(changelogZh, '2.34.0').matchedExact, true);

// -----------------------------------------------------------------------------
// 2. v2.34.0 主进程补丁点精确验收 (updater / hud / hudState / 新模块)
// -----------------------------------------------------------------------------
console.log('\n--- 2. v2.34.0 主进程补丁点与新增模块校验 ---');
const distDir = path.join(ROOT, 'extracted', 'dist');
const updaterJs = fs.readFileSync(path.join(distDir, 'updater.js'), 'utf-8');
check(
  'updater.js 注入 MENU_UPDATE_STEP_LABELS 并适配 void quitAndInstall() 签名',
  updaterJs.includes('const MENU_UPDATE_STEP_LABELS = {') &&
    updaterJs.includes("'检查更新': () => checkForUpdates(true)") &&
    updaterJs.includes("'重启以应用更新': () => void quitAndInstall()"),
  true
);

const hudJs = fs.readFileSync(path.join(distDir, 'computer', 'hud.js'), 'utf-8');
check(
  'hud.js 适配 v2.34.0 Allow again ➔ 重新允许 与中文 title 并保留 IPC 令牌',
  hudJs.includes('AGY 正在控制您的 Mac') &&
    hudJs.includes('<button id="stop">停止</button>') &&
    hudJs.includes('title="重新允许智能体使用此 Mac。已停止的任务不会自动重启。">重新允许</button>') &&
    hudJs.includes('agy-hud:stop') &&
    hudJs.includes('agy-hud:resume'),
  true
);

const hudState = require(path.join(distDir, 'computer', 'hudState.js'));
check(
  'hudState.hudView user_takeover 输出接管文案',
  hudState.hudView({ agentActive: true, paused: true, pauseCause: 'user_takeover' }),
  { state: 'paused', text: '您已接管 — 智能体已停止', visible: true }
);
check(
  'hudState.hudView agent_stop 输出停止文案',
  hudState.hudView({ agentActive: true, paused: true, pauseCause: 'agent_stop' }),
  { state: 'paused', text: '智能体已停止', visible: true }
);

check(
  'extracted 同步 v2.34.0 新增主进程模块且协议字面量完整保留',
  fs.existsSync(path.join(distDir, 'authBootstrap.js')) &&
    fs.existsSync(path.join(distDir, 'computer', 'screenLock.js')) &&
    fs.existsSync(path.join(distDir, 'proto', 'browser_viewer_pb.js')) &&
    fs.existsSync(path.join(distDir, 'browserStream', 'capturePage.js')) &&
    fs.readFileSync(path.join(distDir, 'browserStream', 'capturePage.js'), 'utf-8').includes("'agy-browser'"),
  true
);

// -----------------------------------------------------------------------------
// 3. Web UI 新增模块（Input Box / Orchestrator / 内联卡片 / 侧栏与筛选 / Computer Use）
// -----------------------------------------------------------------------------
console.log('\n--- 3. Web UI v2.34.0 全量新增特性与动态规则校验 ---');
const { translateString, shouldSkipNode } = loadTranslatorSandbox();

const dictChecks = [
  ['Input Box', '输入框'],
  ['Press Cmd+Enter to send, Enter for a new line.', '按 Cmd+Enter 发送，按 Enter 换行。'],
  ['Messages now send immediately. Configure in', '消息现在将立即发送。前往'],
  ['Sync JJ worktrees to head', '将 JJ 工作树同步到 Head'],
  ['Orchestrator Settings', 'Orchestrator 设置'],
  ['Orchestrator Model', 'Orchestrator 模型'],
  ['Executor Model', '执行器模型'],
  ["The Orchestrator's own planner", 'Orchestrator 自带规划器'],
  ['Orchestrator', 'Orchestrator'],
  ['Thinking effort', '思考深度'],
  ['ELMO Composite', 'ELMO 复合语音'],
  ['Coordinator', '协调器'],
  ['Skip', '跳过'],
  ['Skipped', '已跳过'],
  ['Add note', '添加备注'],
  ['Add a note or condition...', '添加备注或条件...'],
  ['In chat', '在对话中查看'],
  ['Resolved in chat', '已在对话中处理'],
  ['Replaced by newer request', '已被新请求替代'],
  ['Expired · Action not taken', '已过期 · 未执行操作'],
  ['Ask to retry', '请求重试'],
  ['Select one or more options', '选择一个或多个选项'],
  ['Other answer', '其他回答'],
  ['Retry requested', '已请求重试'],
  ['Yes, allow for this conversation', '是，在当前对话中允许'],
  ['Runtime permission', '运行时权限'],
  ['Permission approval scope', '权限审批作用域'],
  ['Tell the agent what to do instead...', '告诉智能体改为执行什么操作...'],
  ['Deny with note', '附带备注拒绝'],
  ['Customize Sidebar', '自定义侧边栏'],
  ['Idle Conversations', '空闲对话'],
  ['Only applies when grouped by status', '仅在按状态分组时生效'],
  ['Show Automation Conversations', '显示自动化对话'],
  ['Show Plugin Conversations', '显示插件对话'],
  ['Filter and Sort', '筛选与排序'],
  ['Last Activity', '最近活动'],
  ['Any time', '不限时间'],
  ['Manual Order', '手动排序'],
  ['Needs Input', '等待输入'],
  ['Unsent draft', '未发送的草稿'],
  ["Screen locked: agents can't use this Mac until you unlock it", '屏幕已锁定：在您解锁之前，智能体无法使用此 Mac'],
  ['Connecting to the live preview…', '正在连接实时预览…'],
  ['Open System Settings ↗', '打开系统设置 ↗'],
  ['Allowed ✓', '已允许 ✓'],
  ['Continue Task →', '继续任务 →'],
  ['Searching older messages…', '正在搜索更早的消息…'],
  ['UI Plugin (SidePanel)', 'UI 插件（侧边栏面板）'],
  ['This plugin is currently stopped. Events and stdout streams will appear here once started.', '此插件当前已停止。启动后，事件和标准输出流将在此处显示。'],
  ['No sign-in required. This app is ready to use.', '无需登录，此应用已就绪可用。'],
  ['Weekdays', '每个工作日'],
  ['Weekly', '每周'],
];

for (const [src, expected] of dictChecks) {
  check(`词典校验: ${src}`, translateString(src), expected);
}

// 动态规则 + 防半英文泄露 + 保留归档 toast
const dynamicChecks = [
  ['View archived in the sidebar (![tune](icon://tune) Customize Sidebar).', '已归档内容可在侧边栏（自定义侧边栏）中查看。'],
  [' Customize Sidebar).', ' 自定义侧边栏）中查看。'],
  [' menu).', ' 菜单）中查看。'],
  [
    'Telemetry is turned off for your account. This means Antigravity does not collect any of your prompts, content, or model responses, but will still collect general usage patterns (e.g., feature adoption, active user counts).',
    '您的账号已关闭遥测功能。这意味着 Antigravity 不会收集您的任何提示词、内容或模型回复，但仍会收集常规使用模式（例如功能采用率、活跃用户数）。',
  ],
  ['Open Accessibility settings', '打开辅助功能设置'],
  ['Reopen Screen Recording settings', '重新打开屏幕录制设置'],
  ['Antigravity needs both to use your computer.', 'Antigravity 需要辅助功能和屏幕录制权限才能控制您的电脑。'],
  ['Relaunch Antigravity to finish Screen Recording.', '重启 Antigravity 以完成屏幕录制权限配置。'],
  ['2 agents working, live preview unavailable', '2 个智能体正在工作，实时预览不可用'],
  ['Live preview unavailable · not installed', '实时预览不可用 · 未安装'],
  ['Please retry: Run build tests', '请重试：Run build tests'],
  ['Sent response: Confirmed', '已发送回复：Confirmed'],
  ['Skipped: Optional check', '已跳过：Optional check'],
  ['Open Subagent: Codebase Auditor', '打开子智能体：Codebase Auditor'],
  ['Pin Entire Workspace', '置顶整个工作区'],
  ['Unpin Project', '取消置顶项目'],
  ['Opens the New Conversation screen for this workspace', '为此工作区打开新建对话界面'],
  ['No messages in last 50 steps — load older', '最近 50 步中无消息 — 加载更早内容'],
  ['No messages in last 30 steps · Load more', '最近 30 步中无消息 · 加载更多'],
  ['No visible messages in last 40 steps. Activate Load older messages to continue.', '最近 40 步中没有可见消息，激活“加载更早的消息”以继续。'],
  ['Load older messages, showing 20 of 100', '加载历史消息，正在显示 20 / 100 条'],
  ['No more older messages, showing 20 of 100', '已无更早的历史消息（共显示 20 / 100 条）'],
  ['Select Sidebar Item 3', '选择侧边栏第 3 项'],
  ['UI Plugin 2', 'UI 插件 2'],
  ['More options for MyPlugin', 'MyPlugin 的更多选项'],
  ['Open image 2 of 5', '打开第 2 张图片（共 5 张）'],
  ['Show 8 More', '显示其余 8 项'],
  ['Canvas Preview (experimental)', 'Canvas Preview（实验性）'],
  ['Line 12 → 48', '第 12 → 48 行'],
  ['45s left', '剩余 45 秒'],
  ['1d 3h 20m left', '剩余 1 天 3 小时 20 分钟'],
  ['Conflicts with "Next Tab" (reserved for sidebar switching)', '与“Next Tab”冲突（保留用于侧栏切换）'],
  ['docs.example.com (opens in external browser)', 'docs.example.com（在外部浏览器中打开）'],
  // macOS permissions segmented spans
  ['In System Settings, turn on ', '在“系统设置”中开启 '],
  ['. If it isn\'t in the list, drag it in from the small window next to System Settings.', '。如果列表中没有，请从“系统设置”旁的小窗口将其拖入。'],
];

for (const [src, expected] of dynamicChecks) {
  check(`动态规则校验: ${src}`, translateString(src), expected);
}

// -----------------------------------------------------------------------------
// 4. 幂等性、词典零重复、产物注入真实性及红线防误翻守卫
// -----------------------------------------------------------------------------
console.log('\n--- 4. 幂等性、去重基线与红线防御 ---');
for (const sample of [
  'Connecting to the live preview…',
  '2 agents working, live preview unavailable',
  '1d 3h 20m left',
  'Customize Sidebar).',
  'Please retry: Check status',
]) {
  const once = translateString(sample);
  const twice = translateString(once);
  check(`幂等性校验: ${sample}`, twice, once);
}

check('模型名称与版本保持原生: Gemini 4', translateString('Gemini 4'), 'Gemini 4');
check('相对时间保持原生: 2m ago', translateString('2m ago'), '2m ago');
check('小写项目名保持原生: antigravity-cn', translateString('antigravity-cn'), 'antigravity-cn');
check(
  '输入组件豁免: TEXTAREA 不翻译',
  shouldSkipNode({
    nodeType: 3,
    nodeValue: 'Add a note or condition...',
    parentElement: {
      nodeType: 1,
      tagName: 'TEXTAREA',
      hasAttribute: () => false,
      getAttribute: () => null,
      closest: () => null,
    },
  }),
  true
);

// 词典零重复验证
const dictSource = fs.readFileSync(path.join(ROOT, 'src', 'dictionary.js'), 'utf-8');
const coreIdx = dictSource.indexOf('const coreWords');
const dictPart = dictSource.slice(0, coreIdx);
const keyRegex = /^\s*"((?:[^"\\]|\\.)+)"\s*:/gm;
const seenKeys = new Set();
const dupKeys = [];
let km;
while ((km = keyRegex.exec(dictPart)) !== null) {
  if (seenKeys.has(km[1])) dupKeys.push(km[1]);
  seenKeys.add(km[1]);
}
check('src/dictionary.js 零重复键基线验证 (Duplicates === 0)', dupKeys.length, 0);

const builtPreload = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');
const builtWizard = fs.readFileSync(path.join(distDir, 'ideInstall', 'wizardPreload.js'), 'utf-8');
check(
  'extracted preload.js 与 wizardPreload.js 已实装 v2.34.0 词条与规则',
  builtPreload.includes('Orchestrator Settings') &&
    builtPreload.includes('Customize Sidebar') &&
    builtPreload.includes('正在连接实时预览') &&
    builtWizard.includes('Orchestrator Settings'),
  true
);

console.log(`\n=== Ticket-48 测试总结: ${passed}/${total} 通过 ===`);
if (passed !== total) {
  process.exit(1);
}
