const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== 开始 Ticket-37 首页问候语与第三方模型访问公告汉化专项测试 ===\n');

const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');

// 从 localize.js 中抽出注入引擎，取到 translateString 用于纯函数级验证
function extractTranslator() {
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
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(injectionCode, sandbox);
  return sandbox.globalThis.__test_translateString;
}

const translateString = extractTranslator();

let passed = 0;
let total = 0;

function check(desc, actual, expected) {
  total++;
  try {
    assert.strictEqual(actual, expected);
    passed++;
    console.log(`  ✓ ${desc}`);
  } catch (e) {
    console.error(`  ✗ ${desc}`);
    console.error(`    期望: ${JSON.stringify(expected)}`);
    console.error(`    实际: ${JSON.stringify(actual)}`);
  }
}

console.log('[1] 首页问候语：3 组模板 × 有/无用户名共 6 种文案');
check('Hey + 用户名', translateString('Hey 和月夜, what should we build today?'), '嘿，和月夜，今天想构建点什么？');
check('Hey there（无用户名）', translateString('Hey there, what should we build today?'), '嘿，今天想构建点什么？');
check('Welcome back + 用户名', translateString('Welcome back, 和月夜. Where should we pick up?'), '欢迎回来，和月夜。我们从哪里继续？');
check('Welcome back（无用户名）', translateString('Welcome back. Where should we pick up?'), '欢迎回来。我们从哪里继续？');
check('Good to see you + 用户名', translateString("Good to see you, 和月夜. What's next?"), '很高兴见到你，和月夜。接下来做什么？');
check('Good to see you（无用户名）', translateString("Good to see you. What's next?"), '很高兴见到你。接下来做什么？');

console.log('\n[2] 首页问候语不误伤用户内容');
check('普通 Hey 开头句子不翻译', translateString('Hey there, please review my PR.'), 'Hey there, please review my PR.');
check('代码片段不翻译', translateString('const isGoodToSee = true;'), 'const isGoodToSee = true;');

console.log('\n[3] 第三方模型访问公告（服务端下发文案）');
check('公告标题', translateString('Changes to third-party model access'), '第三方模型访问方式调整');
check(
  '公告正文（含日期本地化）',
  translateString('Opus 5.5 and Sonnet 5.5 are available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 18, 2026.'),
  'Opus 5.5 与 Sonnet 5.5 现已在付费 Pro 与 Ultra 方案中提供。自 2026 年 11 月 18 日起，你当前方案将不再提供第三方模型访问。'
);
check(
  '公告正文（其他月份与版本号）',
  translateString('Opus 4.6 and Sonnet 3.7 are available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on March 1, 2027.'),
  'Opus 4.6 与 Sonnet 3.7 现已在付费 Pro 与 Ultra 方案中提供。自 2027 年 3 月 1 日起，你当前方案将不再提供第三方模型访问。'
);
check(
  '公告正文（模型选择页 "is now available" 句式）',
  translateString('Sonnet 5.5 is now available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 18, 2026.'),
  'Sonnet 5.5 现已在付费 Pro 与 Ultra 方案中提供。自 2026 年 11 月 18 日起，你当前方案将不再提供第三方模型访问。'
);
check(
  '公告正文（单模型 Opus "is now" 句式）',
  translateString('Opus 4.6 is now available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 18, 2026.'),
  'Opus 4.6 现已在付费 Pro 与 Ultra 方案中提供。自 2026 年 11 月 18 日起，你当前方案将不再提供第三方模型访问。'
);
check(
  '公告正文（三模型并列用顿号）',
  translateString('Claude Opus 4.6 and Claude Sonnet 4.6 and GPT-5.2 are available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on December 1, 2026.'),
  'Claude Opus 4.6、Claude Sonnet 4.6、GPT-5.2 现已在付费 Pro 与 Ultra 方案中提供。自 2026 年 12 月 1 日起，你当前方案将不再提供第三方模型访问。'
);

console.log('\n[4] 账号方案与设置页残留词条');
check('Your Plan 动态前缀', translateString('Your Plan: Antigravity Starter Quota'), '当前方案：Antigravity 入门配额');
check('Your Plan 未知方案名保留原文', translateString('Your Plan: Custom Enterprise Tier'), '当前方案：Custom Enterprise Tier');
check('Antigravity Starter Quota', translateString('Antigravity Starter Quota'), 'Antigravity 入门配额');
check('Verbose', translateString('Verbose'), '详细');
check('Code Preview', translateString('Code Preview'), '代码预览');
check('空自定义项提示', translateString('There are no customizations enabled.'), '尚未启用任何自定义项。');
check('开发者专属提示', translateString('Developer-only tools. These settings do not affect other users.'), '仅开发者可用的工具，这些设置不会影响其他用户。');
check('提交提示词快捷键', translateString('Submit Prompt (Alternate to Enter)'), '提交提示词（Enter 的备用键）');
check('二级快捷键说明', translateString('Enter always submits. This adds a second shortcut.'), 'Enter 始终用于提交，此项用于添加第二个快捷键。');
check('上一条提示词', translateString('Jump to Previous Prompt'), '跳转到上一条提示词');
check('下一条提示词', translateString('Jump to Next Prompt'), '跳转到下一条提示词');
check('置顶/取消置顶对话', translateString('Pin / Unpin Conversation'), '置顶 / 取消置顶对话');

console.log('\n[5] 模型下线公告（模型选择页底部提示）');
check(
  'GPT-OSS 下线提示',
  translateString('GPT-OSS will be removed from Antigravity on November 18, 2026.'),
  'GPT-OSS 将于 2026 年 11 月 18 日从 Antigravity 移除。'
);
check(
  '其他模型下线提示（换月份）',
  translateString('Gemini 2.5 Pro will be removed from Antigravity on January 5, 2027.'),
  'Gemini 2.5 Pro 将于 2027 年 1 月 5 日从 Antigravity 移除。'
);
check('提及日期的无关句子不翻译', translateString('This text mentions November 18, 2026 but is unrelated.'), 'This text mentions November 18, 2026 but is unrelated.');

console.log('\n[6] 模型可用范围提示（仅向部分订阅方案开放）');
check(
  'Ultra 与付费 Pro 方案',
  translateString('Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers.'),
  'Gemini 4 Argon 目前仅向 Ultra 与付费 Pro 方案订阅用户提供。'
);
check(
  '付费 Pro 与 Ultra 方案（语序相反）',
  translateString('Gemini 4 Hydrogen is currently available to paid Pro and Ultra plan subscribers.'),
  'Gemini 4 Hydrogen 目前仅向付费 Pro 与 Ultra 方案订阅用户提供。'
);
check(
  '其他订阅层级（保留原文并补空格）',
  translateString('GPT-5.2 is currently available to Business subscribers.'),
  'GPT-5.2 目前仅向 Business 订阅用户提供。'
);
check(
  '当前方案不可用',
  translateString('Gemini 4 Argon is not available on your current plan.'),
  'Gemini 4 Argon 在你当前方案中不可用。'
);
check(
  '无关的 available to 句子不翻译',
  translateString('This feature is available to everyone.'),
  'This feature is available to everyone.'
);

console.log('\n[7] 用量窗口与重置时间（模型下拉「查看使用额度」浮层）');
check(
  '周限额 + 天/小时倒计时',
  translateString('Weekly limit, resets in 6d 23h'),
  '每周限额，6 天 23 小时后重置'
);
check(
  '日限额 + 时/分倒计时',
  translateString('Daily limit, resets in 5h 30m'),
  '每日限额，5 小时 30 分钟后重置'
);
check(
  '仅分钟倒计时',
  translateString('Daily limit, resets in 45m'),
  '每日限额，45 分钟后重置'
);
check(
  '独立倒计时文案',
  translateString('Resets in <1m'),
  '不到 1 分钟后重置'
);
check('剩余百分比（独立节点）', translateString('% left'), '% 可用');
check('剩余百分比（整串）', translateString('100% left'), '100% 可用');
check(
  'AI 点数余额',
  translateString('Available AI Credits: 1250'),
  '可用 AI 点数：1250'
);
check('查看活动记录', translateString('See Activity'), '查看活动记录');
check('获取更多 AI 点数', translateString('Get More AI Credits'), '获取更多 AI 点数');
check('无限额度', translateString('Unlimited'), '无限制');
check(
  '无关的 left 句子不翻译',
  translateString('The panel is left aligned.'),
  'The panel is left aligned.'
);

console.log('\n[8] 声音选择弹窗（9 个声音的音色描述与确认按钮）');
check('Arlo 音色', translateString('Confident and clear'), '自信而清晰');
check('Fola 音色', translateString('Clear and friendly'), '清晰友好');
check('Cleo 音色', translateString('Warm and engaging'), '温暖而有感染力');
check('Finn 音色', translateString('Warm and approachable'), '温暖而亲切');
check('Neno 音色', translateString('Deep and velvety'), '低沉而丝滑');
check('Olin 音色', translateString('Light and precise'), '轻快而精准');
check('确认按钮（整串）', translateString('Use Arlo'), '使用 Arlo');
check('确认按钮（"Use " 独立节点）', translateString('Use '), '使用 ');
check('声音名保持原文', translateString('Tari'), 'Tari');
check(
  '普通 Use 开头的句子不翻译',
  translateString('Use the browser to open the page.'),
  'Use the browser to open the page.'
);

console.log('\n[9] 键盘快捷键提示（执行 → 排队消息 的悬停说明）');
check(
  'Enter 排队说明',
  translateString('Enter Queues after the turn'),
  'Enter 在当前回合结束后排队'
);
check(
  'Alt+Enter 立即发送',
  translateString('Alt+Enter Sends immediately'),
  'Alt+Enter 立即发送'
);
check(
  'Alt+Enter 空输入框取队列',
  translateString('Alt+Enter On empty prompt, sends next in queue'),
  'Alt+Enter 输入框为空时，发送队列中的下一条'
);
check('macOS 符号键名保留', translateString('⌥⏎ Sends immediately'), '⌥⏎ 立即发送');
check(
  '无关句子不翻译',
  translateString('This message queues after the turn but is unrelated'),
  'This message queues after the turn but is unrelated'
);

console.log('\n[10] 设置项下拉/开关的选项说明（悬停浮层）');
check(
  '排队等待说明',
  translateString('Queue until after the current turn.'),
  '在当前回合结束后排队。'
);
check(
  '立即发送说明',
  translateString('Interrupt the agent and send immediately.'),
  '中断智能体并立即发送。'
);
check(
  '浏览器脚本策略：阻止',
  translateString('Block all browser JavaScript execution.'),
  '禁止执行所有浏览器 JavaScript。'
);
check(
  '终端策略：始终确认',
  translateString('The agent always asks for confirmation before executing terminal commands (except those in the Allow list).'),
  '智能体在执行终端命令前始终请求确认（允许列表中的命令除外）。'
);
check(
  '终端策略：沙箱内自动执行',
  translateString('Terminal command automatically proceeds if the command runs inside the sandbox. Otherwise, it requests review.'),
  '终端命令如果在沙箱内运行，则自动执行；否则会请求审核。'
);
check(
  '终端策略：从不确认（长文案）',
  translateString('The agent never asks for confirmation before executing terminal commands (except those in the Deny list). This provides the agent with the maximum ability to operate over long periods without intervention, but also has the highest risk of the agent executing an unsafe terminal command.'),
  '智能体在执行终端命令前不会请求确认（拒绝列表中的命令除外）。这让智能体能在长时间内以最大自主能力运行，但同时也是最高风险：智能体可能执行不安全的终端命令。'
);

console.log('\n[11] 开发者设置：workspaceUri 说明（原文含反引号，走通配规则）');
check(
  'workspaceUri 说明',
  translateString('Sets the `workspaceUri` URL parameter and reloads, repointing the active workspace. Pick a folder from an existing project or enter a custom URI (e.g. file:///path/to/workspace).'),
  '设置 workspaceUri URL 参数并重新加载，从而把当前工作区指向新的位置。可从已有项目中选择文件夹，或输入自定义 URI（例如 file:///path/to/workspace）。'
);

console.log('\n[12] 右下角新模型发布弹窗公告（Gemini 4 Hydrogen 等）');
check(
  '模型发布标题：Introducing Gemini 4 Hydrogen',
  translateString('Introducing Gemini 4 Hydrogen'),
  '全新推出 Gemini 4 Hydrogen'
);
check(
  '模型发布标题：同类模型泛化（Introducing Gemini 4 Argon!）',
  translateString('Introducing Gemini 4 Argon!'),
  '全新推出 Gemini 4 Argon！'
);
check(
  '模型发布正文：单行原文',
  translateString('Our daily driver for rapid coding and dependable agentic execution!'),
  '我们的日常主力模型，兼顾快速编码与可靠的智能体执行！'
);
check(
  '模型发布正文：含换行折行容错',
  translateString('Our daily driver for rapid coding and dependable\nagentic execution!'),
  '我们的日常主力模型，兼顾快速编码与可靠的智能体执行！'
);
check(
  '模型发布正文：无标点容错',
  translateString('Our daily driver for rapid coding and dependable agentic execution'),
  '我们的日常主力模型，兼顾快速编码与可靠的智能体执行'
);
check(
  '非模型 Introducing 文本不误翻译',
  translateString('Introducing my new workflow to the team today.'),
  'Introducing my new workflow to the team today.'
);

console.log('\n--- [13] 模型专属限额标题与防夹生兜底 ---');
check(
  'Gemini 4 Argon Weekly Limit 动态翻译',
  translateString('Gemini 4 Argon Weekly Limit'),
  'Gemini 4 Argon 每周限额'
);
check(
  'Gemini 4 Hydrogen 5-Hour Limit 动态翻译',
  translateString('Gemini 4 Hydrogen 5-Hour Limit'),
  'Gemini 4 Hydrogen 5 小时限额'
);
check(
  'Claude Opus 5.5 Weekly Limit Remaining 动态翻译',
  translateString('Claude Opus 5.5 Weekly Limit Remaining'),
  'Claude Opus 5.5 每周限额剩余'
);
check(
  'Show 3 more subagents 动态翻译',
  translateString('Show 3 more subagents'),
  '显示其余 3 个子智能体'
);
check(
  'File not found 完整翻译防夹生',
  translateString('File not found'),
  '文件未找到'
);
check(
  'Directory not found 防夹生后置清洗',
  translateString('Directory not found'),
  '目录未找到'
);

console.log(`\n=== Ticket-37 结果：${passed}/${total} 通过 ===`);

if (passed !== total) {
  console.error('❌ Ticket-37 存在未通过用例');
  process.exit(1);
}
console.log('✅ Ticket-37 全部通过');
