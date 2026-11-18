const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// 1. 读取当前 localize.js 源码
const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');

// 2. 提取 DOM_TRANSLATOR_INJECTION 中的 translateString 和 shouldSkipNode
function extractTranslator() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();
  
  injectionCode = injectionCode.replace(
    'if (document.readyState === \'loading\')',
    'globalThis.__test_translateString = translateString;\n  globalThis.__test_shouldSkipNode = shouldSkipNode;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
  );

  const sandbox = {
    globalThis: {},
    document: { body: null, readyState: 'loading', addEventListener: () => {} },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
    Element: { prototype: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    console: console
  };
  
  vm.createContext(sandbox);
  vm.runInContext(injectionCode, sandbox);
  return {
    translateString: sandbox.globalThis.__test_translateString,
    shouldSkipNode: sandbox.globalThis.__test_shouldSkipNode
  };
}

const { translateString, shouldSkipNode } = extractTranslator();

// 3. Mock DOM 节点
class MockNode {
  constructor(nodeType, parentElement = null) {
    this.nodeType = nodeType;
    this.parentElement = parentElement;
  }
}

class MockElement extends MockNode {
  constructor(tagName, { className = '', attributes = {}, parentElement = null } = {}) {
    super(1, parentElement);
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.attributes = { ...attributes };
    this.children = [];
  }

  get classList() {
    const classes = this.className ? this.className.split(/\s+/).filter(Boolean) : [];
    return {
      contains: (cls) => classes.includes(cls)
    };
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return this.attributes[name] !== undefined;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.matches && cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1);
    const attrMatch = selector.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/);
    if (attrMatch) {
      const val = this.getAttribute(attrMatch[1]);
      if (attrMatch[2] !== undefined) return val === attrMatch[2];
      return val !== null;
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches && child.matches(selector)) return child;
      if (child.querySelector) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  get textContent() {
    return this.children.map(c => c.textContent || c.nodeValue || '').join('');
  }

  get innerText() {
    return this.textContent;
  }
}

class MockTextNode extends MockNode {
  constructor(text, parentElement = null) {
    super(3, parentElement);
    this.nodeValue = text;
    this.textContent = text;
  }
}

// 4. 测试套件
console.log('=== 开始执行 Ticket 05 @ 提及菜单与上下文分类汉化专项测试 ===\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL - RED] ${name}`);
    console.error(`       错误: ${err.message}\n`);
    failed++;
  }
}

// 模块 A: @ 提及菜单分类名称精确词典翻译
const mentionTranslationCases = [
  { en: 'Rules', expected: '规则' },
  { en: 'Conversation', expected: '对话' },
  { en: 'PDF Document', expected: 'PDF 文档' },
  { en: 'MCP Resource', expected: 'MCP 资源' },
  { en: 'Browser Page', expected: '浏览器页面' },
  { en: 'Browser Text', expected: '浏览器文本' },
  { en: 'Git Commit', expected: 'Git 提交' },
  { en: 'Git Diff', expected: 'Git 差异' },
  { en: 'Directory', expected: '目录' }
];

for (const m of mentionTranslationCases) {
  runTest(`提及分类词典汉化: "${m.en}" -> "${m.expected}"`, () => {
    const actual = translateString(m.en);
    assert.strictEqual(actual, m.expected);
  });
}

// 模块 B: @ 提及菜单分类项放行测试 (shouldSkipNode 必须返回 false)
for (const m of mentionTranslationCases) {
  runTest(`提及分类放行 [menu-option-label]: "${m.en}" 绝不被跳过`, () => {
    const labelSpan = new MockElement('span', { attributes: { 'data-testid': 'menu-option-label' } });
    const inner = new MockElement('span', { parentElement: labelSpan });
    labelSpan.appendChild(inner);
    const textNode = new MockTextNode(m.en, inner);
    inner.appendChild(textNode);
    const isSkipped = shouldSkipNode(textNode);
    assert.strictEqual(isSkipped, false, `提及分类 "${m.en}" 应当被放行汉化(false)，实际返回: ${isSkipped}`);
  });
}

// 模块 C: 保护测试：斜杠命令名依然严格跳过 (shouldSkipNode 必须返回 true)
const slashTriggers = ['boost', 'goal', 'schedule', 'browser', 'grill-me', 'learn', 'plan', 'btw', 'teamwork-preview'];

for (const trigger of slashTriggers) {
  runTest(`斜杠命令触发符保护: "${trigger}" 依然严格跳过`, () => {
    const labelSpan = new MockElement('span', { attributes: { 'data-testid': 'menu-option-label' } });
    const inner = new MockElement('span', { parentElement: labelSpan });
    labelSpan.appendChild(inner);
    const textNode = new MockTextNode(trigger, inner);
    inner.appendChild(textNode);
    const isSkipped = shouldSkipNode(textNode);
    assert.strictEqual(isSkipped, true, `触发符 "${trigger}" 必须被 shouldSkipNode 跳过(true)`);
  });
}

// 模块 D: 保护测试：工作区文件名依然严格跳过 (shouldSkipNode 必须返回 true)
const workspaceFiles = ['README.md', 'main.js', 'package.json', 'find_f.py', 'test.ts'];

for (const file of workspaceFiles) {
  runTest(`文件搜索项保护: "${file}" 依然严格跳过`, () => {
    const labelSpan = new MockElement('span', { attributes: { 'data-testid': 'menu-option-label' } });
    const inner = new MockElement('span', { parentElement: labelSpan });
    labelSpan.appendChild(inner);
    const textNode = new MockTextNode(file, inner);
    inner.appendChild(textNode);
    const isSkipped = shouldSkipNode(textNode);
    assert.strictEqual(isSkipped, true, `文件 "${file}" 必须被 shouldSkipNode 跳过(true)`);
  });
}

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${failed}, 总计: ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
