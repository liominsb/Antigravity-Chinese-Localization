'use strict';

const assert = require('assert');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

console.log('=== 开始 Ticket-45 权限作用域提示与语音模式/通话浮层专项测试 ===\n');

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
// 1. 权限作用域提示（tag tooltip）：两条固定串 + 项目名插值
// -----------------------------------------------------------------------------
console.log('--- 1. 权限作用域提示 ---');
check('本机作用域', translateString('Your This Computer setting'), '沿用你在「本机」的设置');
check('远程作用域', translateString('Your Remote setting'), '沿用你在「远程」的设置');
check('项目作用域（中文项目名）', translateString('清理C盘 setting'), '沿用「清理C盘」的设置');
check('项目作用域（小写连字符工程名）', translateString('my-app setting'), '沿用「my-app」的设置');
check('项目作用域（小写多段工程名）', translateString('deepseek-harness setting'), '沿用「deepseek-harness」的设置');
check('项目作用域（工作区回退词）', translateString('Workspace setting'), '沿用「Workspace」的设置');
check('项目作用域（既有项目词条不被截胡）', translateString('Project setting'), '项目设置');
check(
  '项目作用域（英文项目名）',
  translateString('Default Tools Area Location setting'),
  '沿用「Default Tools Area Location」的设置'
);

// 规则收窄后的防误伤
check('普通短语不误伤：proxy setting', translateString('proxy setting'), 'proxy setting');
check('普通短语不误伤：Proxy setting', translateString('Proxy setting'), 'Proxy setting');
check('普通英文长句不误伤：Configure your environment setting', translateString('Configure your environment setting'), 'Configure your environment setting');
check('普通英文短语不误伤：Use global setting / Your custom setting', [
  translateString('Use global setting'),
  translateString('Your custom setting'),
], ['Use global setting', 'Your custom setting']);
check('普通短语不会被套成作用域句式', translateString('proxy setting') === '沿用「proxy」的设置', false);

// -----------------------------------------------------------------------------
// 2. 语音模式开关与通话状态
// -----------------------------------------------------------------------------
console.log('--- 2. 语音模式开关与状态 ---');
check('开启语音模式', translateString('Start Voice mode'), '开启语音模式');
check('结束按钮（首字母大写）', translateString('End'), '结束');
check('小写 end 不误伤', translateString('end'), 'end');
check('监听状态', translateString('Listening. Ask anything.'), '正在聆听，随时提问。');
check('连接中', translateString('Connecting…'), '正在连接…');
check('仍在连接', translateString('Still connecting…'), '仍在连接…');

// -----------------------------------------------------------------------------
// 3. 通话浮层动态文案
// -----------------------------------------------------------------------------
console.log('--- 3. 通话浮层动态文案 ---');
check('语速 1x', translateString('Voice speed, 1x'), '语速，1x');
check('语速 2.5x', translateString('Voice speed, 2.5x'), '语速，2.5x');
check('静音麦克风 tooltip', translateString('Mute mic (⌘M)'), '静音麦克风 (⌘M)');
check('取消静音智能体 tooltip', translateString('Unmute Antigravity (⌥M)'), '取消静音 Antigravity (⌥M)');
check('静音 Jetski tooltip', translateString('Mute Jetski (Ctrl+M)'), '静音 Jetski (Ctrl+M)');
check('非目标 Mute 句式不半中半英误伤', translateString('Mute audio (optional)'), 'Mute audio (optional)');

// -----------------------------------------------------------------------------
// 4. 幂等性：同一文本二次翻译必须与一次翻译一致（防止缓存存入带空白译文）
// -----------------------------------------------------------------------------
console.log('--- 4. 幂等性 ---');
for (const text of [
  'Your This Computer setting',
  ' Your Remote setting ',
  '清理C盘 setting',
  'my-app setting',
  'Voice speed, 1.5x',
  ' Mute mic (⌘M) ',
  '  End  ',
]) {
  const first = translateString(text);
  const second = translateString(text); // 同一输入第二次调用会命中 stringCache
  check(`二次命中缓存不叠加空白：${text}`, second, first);
  check(`译文再次翻译不变：${text}`, translateString(first), first);
}

// -----------------------------------------------------------------------------
// 5. 红线
// -----------------------------------------------------------------------------
console.log('--- 5. 红线 ---');
check('模型名保留', translateString('Gemini 3.8 Flash'), 'Gemini 3.8 Flash');

console.log(`\n======================================================`);
console.log(`Ticket-45 验收结果: ${passed}/${total} 断言通过`);
console.log(`======================================================`);

if (passed !== total) {
  process.exit(1);
}
