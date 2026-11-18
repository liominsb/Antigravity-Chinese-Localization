'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { getInjectionCode } = require('./helpers/translator-loader');

const injectionCode = getInjectionCode();
assert.ok(typeof injectionCode === 'string' && injectionCode.length > 10000, 'DOM_TRANSLATOR_INJECTION 长度异常');
assert.ok(injectionCode.includes('// Antigravity 2.0 Chinese Localization Engine'), '缺少引擎头部标识');

console.log('injectionCode 长度:', injectionCode.length);
try {
  new vm.Script(injectionCode);
  console.log('injectionCode 语法完全合法 (Valid JavaScript)');
} catch (e) {
  console.error('injectionCode 存在语法错误:', e.message);
  process.exit(1);
}

// 同步检查 localize.js 本身语法合法
const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');
new vm.Script(localizeSource);
console.log('localize.js 语法完全合法 (Valid JavaScript)');
