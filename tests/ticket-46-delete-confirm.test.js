'use strict';

const assert = require('assert');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

console.log('=== 开始 Ticket-46 删除确认弹窗专项测试 ===\n');

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
// 1. 整句：删除会话确认
// -----------------------------------------------------------------------------
console.log('--- 1. 整句 ---');
check(
  '删除会话确认正文',
  translateString('Are you sure you want to delete this conversation? This action cannot be undone.'),
  '确定要删除该对话吗？此操作无法撤销。'
);

// -----------------------------------------------------------------------------
// 2. 节点级片段：资源名以 <strong> 插值
// -----------------------------------------------------------------------------
console.log('--- 2. 节点级片段 ---');
check('前缀片段（词典既有）', translateString('Are you sure you want to delete the '), '确定要删除 ');
check('前缀片段（无 the，词典既有）', translateString('Are you sure you want to delete '), '确定要删除 ');
check('后缀片段', translateString('? This action cannot be undone.'), '吗？此操作无法撤销。');
check(
  'MCP 服务器删除确认后缀片段',
  translateString('? This will remove it from your MCP configuration.'),
  '吗？这将从你的 MCP 配置中移除。'
);

// -----------------------------------------------------------------------------
// 3. 幂等性：二次翻译必须与一次结果一致（缓存不得存带空白的译文）
// -----------------------------------------------------------------------------
console.log('--- 3. 幂等性 ---');
for (const text of [
  'Are you sure you want to delete this conversation? This action cannot be undone.',
  '? This action cannot be undone.',
  ' ? This action cannot be undone. ',
  ' ? This will remove it from your MCP configuration.',
  'Are you sure you want to delete the ',
]) {
  const first = translateString(text);
  const second = translateString(text);
  check(`二次命中缓存不叠加空白：${text}`, second, first);
  check(`译文再次翻译不变：${text}`, translateString(first), first);
}

// -----------------------------------------------------------------------------
// 4. 防误伤
// -----------------------------------------------------------------------------
console.log('--- 4. 防误伤 ---');
check('未收录的同类句式保持原文', translateString('Are you sure you want to delete this file?'), 'Are you sure you want to delete this file?');
check('相邻既有译法不受影响', translateString('This cannot be undone.'), '此操作无法撤销。');
check('模型名保留', translateString('Gemini 3.8 Flash'), 'Gemini 3.8 Flash');

console.log(`\n======================================================`);
console.log(`Ticket-46 验收结果: ${passed}/${total} 断言通过`);
console.log(`======================================================`);

if (passed !== total) {
  process.exit(1);
}
