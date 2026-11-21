'use strict';

const assert = require('node:assert/strict');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

function element(tagName, attributes = {}, children = []) {
  const node = {
    nodeType: 1,
    tagName,
    childNodes: children,
    firstChild: children[0] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value; },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

const draft = { nodeType: 3, nodeValue: 'Build me a web app' };
const composer = element('DIV', {
  role: 'combobox',
  contenteditable: 'true',
  'aria-label': 'Message input',
  title: 'Settings',
}, [draft]);
const simpleComposer = element('DIV', { role: 'textbox', 'aria-label': 'Message input' });
const voice = element('BUTTON', { 'aria-label': 'Start Voice mode' });
const toolbar = element('DIV', {}, [voice]);
toolbar.classList = { contains: (name) => name === 'chat-input' };
const ordinaryElement = element('DIV', { role: 'code', 'aria-label': 'Message input' });
const body = element('BODY', {}, [composer, simpleComposer, ordinaryElement]);
let notifyObserver;
const { translateString, translateNode } = loadTranslatorSandbox({
  document: { body, readyState: 'complete', addEventListener() {} },
  MutationObserver: class {
    constructor(callback) { notifyObserver = callback; }
    observe() {}
  },
});

for (const [english, chinese] of [
  ['Build me a web app', '帮我构建一个 Web 应用'],
  ['Add a Gemini feature to my app', '给我的应用添加 Gemini 功能'],
  ['Bring over my setup from other Agentic Developer Tools', '从其他智能开发工具迁移我的配置'],
  ['Dismiss suggestion', '关闭建议'],
  ['Background color picker', '背景颜色选择器'],
  ['Foreground color picker', '前景颜色选择器'],
  ['Accent color picker', '强调色选择器'],
  ['Breadcrumb', '面包屑导航'],
  ['GPT-OSS will be removed from Antigravity on November 30, 2026.', 'GPT-OSS 将于 2026 年 11 月 30 日从 Antigravity 下线。'],
  ['Add shortcut for Open Conversation Picker', '添加快捷键（打开对话选择器）'],
  ['Shortcut ⌘K for Open Conversation Picker', '快捷键 ⌘K（打开对话选择器）'],
  ['Remove shortcut Ctrl+Shift+K for Open Conversation Picker', '移除快捷键 Ctrl+Shift+K（打开对话选择器）'],
  ['24m', '24m'],
  ['2m ago', '2m ago'],
]) {
  assert.equal(translateString(english), chinese, english);
}

assert.equal(composer.getAttribute('aria-label'), '消息输入框');
assert.equal(simpleComposer.getAttribute('aria-label'), '消息输入框');
assert.equal(ordinaryElement.getAttribute('aria-label'), 'Message input');
assert.equal(composer.getAttribute('title'), 'Settings');
assert.equal(draft.nodeValue, 'Build me a web app');

translateNode(voice);
assert.equal(voice.getAttribute('aria-label'), '开启语音模式');
composer.setAttribute('aria-label', 'Message input');
voice.setAttribute('aria-label', 'End Voice mode');
notifyObserver([
  { type: 'attributes', target: composer, attributeName: 'aria-label' },
  { type: 'attributes', target: voice, attributeName: 'aria-label' },
  { type: 'characterData', target: draft },
]);
assert.equal(composer.getAttribute('aria-label'), '消息输入框');
assert.equal(voice.getAttribute('aria-label'), '结束语音模式');
assert.equal(draft.nodeValue, 'Build me a web app');
console.log('PASS: 首页文案、快捷键辅助名称、输入区首屏和属性变更');
