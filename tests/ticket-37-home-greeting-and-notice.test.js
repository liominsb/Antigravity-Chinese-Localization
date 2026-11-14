const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== 开始 Ticket-37 首页问候语与第三方模型访问公告汉化专项测试 ===\n');

const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');

// 从 localize.js 中抽出注入引擎，取到 translateString 用于纯函数级验证
function extractTranslator() {
  const match = localizeSource.match(/(const DOM_TRANSLATOR_INJECTION = `[\s\S]*?`;)/);
  if (!match) {
    throw new Error('未能在 localize.js 中找到 DOM_TRANSLATOR_INJECTION 定义');
  }
  const hostSandbox = { globalThis: {} };
  vm.createContext(hostSandbox);
  vm.runInContext(match[1].replace('const DOM_TRANSLATOR_INJECTION', 'globalThis.DOM_TRANSLATOR_INJECTION'), hostSandbox);
  let injectionCode = hostSandbox.globalThis.DOM_TRANSLATOR_INJECTION;

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

console.log(`\n=== Ticket-37 结果：${passed}/${total} 通过 ===`);

if (passed !== total) {
  console.error('❌ Ticket-37 存在未通过用例');
  process.exit(1);
}
console.log('✅ Ticket-37 全部通过');
