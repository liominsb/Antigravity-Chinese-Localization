'use strict';

const assert = require('assert');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

console.log('=== 开始 Ticket-47 归档提示 toast 专项测试 ===\n');

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
// 1. 完整文案（isMarkdown 原文 + plainTextFallback）
// -----------------------------------------------------------------------------
console.log('--- 1. 完整文案 ---');
check(
  'markdown 原文',
  translateString('View archived in the sidebar (![filter](icon://filter_list) menu).'),
  '已归档内容可在侧边栏（显示选项菜单）中查看。'
);
check(
  '纯文本兜底',
  translateString('View archived in the sidebar (Display options menu).'),
  '已归档内容可在侧边栏（显示选项菜单）中查看。'
);

// -----------------------------------------------------------------------------
// 2. 节点级片段：markdown 渲染行内图标后，句子被切成三段
// -----------------------------------------------------------------------------
console.log('--- 2. 节点级片段 ---');
check('前缀片段', translateString('View archived in the sidebar ('), '已归档内容可在侧边栏（');
check('后缀片段（保留前导空格）', translateString(' menu).'), ' 菜单）中查看。');

// -----------------------------------------------------------------------------
// 3. 幂等性：二次翻译必须与一次结果一致
// -----------------------------------------------------------------------------
console.log('--- 3. 幂等性 ---');
for (const text of [
  'View archived in the sidebar (![filter](icon://filter_list) menu).',
  ' menu).',
  'menu).',
  'View archived in the sidebar (',
  ' View archived in the sidebar ( ',
]) {
  const first = translateString(text);
  const second = translateString(text);
  check(`二次命中缓存不叠加空白：${text}`, second, first);
  check(`译文再次翻译不变：${text}`, translateString(first), first);
}

// -----------------------------------------------------------------------------
// 4. 相邻文案与防误伤
// -----------------------------------------------------------------------------
console.log('--- 4. 相邻文案与防误伤 ---');
check('归档标题（既有词条）', translateString('Conversation Archived'), '对话已归档');
check('无关句子不误伤', translateString('View all archived conversations'), 'View all archived conversations');

console.log(`\n======================================================`);
console.log(`Ticket-47 验收结果: ${passed}/${total} 断言通过`);
console.log(`======================================================`);

if (passed !== total) {
  process.exit(1);
}
