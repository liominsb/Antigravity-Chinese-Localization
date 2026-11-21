'use strict';

const assert = require('node:assert/strict');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

function element(tagName, attributes = {}, children = []) {
  const classes = String(attributes.class || '').split(/\s+/).filter(Boolean);
  const node = {
    nodeType: 1,
    tagName,
    className: attributes.class || '',
    classList: { contains: (name) => classes.includes(name) },
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
const pastedInsideDraft = element('BUTTON', { 'aria-label': 'Start Voice mode' });
const composer = element('DIV', {
  role: 'combobox',
  contenteditable: 'true',
  'aria-label': 'Message input',
  title: 'Settings',
}, [draft, pastedInsideDraft]);
const simpleComposer = element('DIV', { role: 'textbox', 'aria-label': 'Message input' });
const voice = element('BUTTON', { 'aria-label': 'Start Voice mode' });
const innerToolbar = element('DIV', {}, [voice]);
const toolbar = element('DIV', { class: 'chat-input' }, [composer, innerToolbar]);
const ordinaryElement = element('DIV', { role: 'code', 'aria-label': 'Message input' });
const protectedTextbox = element('DIV', { role: 'textbox', 'aria-label': 'Message input' });
const protectedVoice = element('button', { 'aria-label': 'Start Voice mode' });
const userMsgBox = element('DIV', { 'data-testid': 'user-message-content' }, [protectedTextbox, protectedVoice]);
const body = element('BODY', {}, [toolbar, simpleComposer, ordinaryElement, userMsgBox]);
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
  ['Bring over my setup from other Agentic Developer Tools', '从其他智能体开发工具迁移我的配置'],
  ['Dismiss suggestion', '关闭建议'],
  ['Background color picker', '背景颜色选择器'],
  ['Foreground color picker', '前景颜色选择器'],
  ['Accent color picker', '强调色选择器'],
  ['Breadcrumb', '面包屑导航'],
  ['GPT-OSS will be removed from Antigravity on November 30, 2026.', 'GPT-OSS 将于 2026 年 11 月 30 日从 Antigravity 移除。'],
  ['Add shortcut for Open Conversation Picker', '添加快捷键（打开对话选择器）'],
  ['Shortcut ⌘K for Open Conversation Picker', '快捷键 ⌘K（打开对话选择器）'],
  ['Remove shortcut Ctrl+Shift+K for Open Conversation Picker', '移除快捷键 Ctrl+Shift+K（打开对话选择器）'],
  ['Add shortcut for Check for Updates', '添加快捷键（检查更新）'],
  ['Shortcut ⌘K for Wait for input', '快捷键 ⌘K（Wait for input）'],
  ['Remove shortcut Ctrl+Shift+K for Search for files', '移除快捷键 Ctrl+Shift+K（Search for files）'],
  ['Shortcut Forward for New Tab', '快捷键 Forward（新标签页）'],
  ['Shortcut ⌘K ⌘S for Open Keyboard Shortcuts', '快捷键 ⌘K ⌘S（打开键盘快捷键）'],
  ['Shortcut keys for editing', 'Shortcut keys for editing'],
  ['Shortcut menu for actions', 'Shortcut menu for actions'],
  ['Shortcut for quick testing.', 'Shortcut for quick testing.'],
  ['Add shortcut for Open File...', '添加快捷键（打开文件...）'],
  ['24m', '24m'],
  ['2m ago', '2m ago'],
]) {
  assert.equal(translateString(english), chinese, english);
  assert.equal(translateString(chinese), chinese, `idempotent:${english}`);
}

// 首屏全页扫描需能穿透 .chat-input 包装容器直达内部 composer 与 voice 按钮，且绝不触碰 user-message-content 隔离区
assert.equal(composer.getAttribute('aria-label'), '消息输入框');
assert.equal(voice.getAttribute('aria-label'), '开启语音模式');
assert.equal(simpleComposer.getAttribute('aria-label'), '消息输入框');
assert.equal(ordinaryElement.getAttribute('aria-label'), 'Message input');
assert.equal(protectedTextbox.getAttribute('aria-label'), 'Message input');
assert.equal(protectedVoice.getAttribute('aria-label'), 'Start Voice mode');
assert.equal(composer.getAttribute('title'), 'Settings');
assert.equal(draft.nodeValue, 'Build me a web app');
assert.equal(pastedInsideDraft.getAttribute('aria-label'), 'Start Voice mode');

// 动态 childList 挂载 .input-area（含 <textarea aria-label="Message input"> 与小写 tagName button）同样需可穿透
const textareaComposer = element('TEXTAREA', { 'aria-label': 'Message input' });
const dynamicVoice = element('button', { 'aria-label': 'Start Voice mode' });
const dynamicInputArea = element('DIV', { class: 'input-area' }, [textareaComposer, dynamicVoice]);
translateNode(dynamicInputArea);
assert.equal(textareaComposer.getAttribute('aria-label'), '消息输入框');
assert.equal(dynamicVoice.getAttribute('aria-label'), '开启语音模式');

composer.setAttribute('aria-label', 'Message input');
voice.setAttribute('aria-label', 'End Voice mode');
protectedTextbox.setAttribute('aria-label', 'Message input');
protectedVoice.setAttribute('aria-label', 'Start Voice mode');
notifyObserver([
  { type: 'attributes', target: composer, attributeName: 'aria-label' },
  { type: 'attributes', target: voice, attributeName: 'aria-label' },
  { type: 'attributes', target: protectedTextbox, attributeName: 'aria-label' },
  { type: 'attributes', target: protectedVoice, attributeName: 'aria-label' },
  { type: 'characterData', target: draft },
]);
assert.equal(composer.getAttribute('aria-label'), '消息输入框');
assert.equal(voice.getAttribute('aria-label'), '结束语音模式');
assert.equal(protectedTextbox.getAttribute('aria-label'), 'Message input');
assert.equal(protectedVoice.getAttribute('aria-label'), 'Start Voice mode');
assert.equal(draft.nodeValue, 'Build me a web app');
console.log('PASS: 首页文案、快捷键辅助名称、输入区穿透安全边界与属性变更');
