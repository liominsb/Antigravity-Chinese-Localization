'use strict';

const assert = require('assert');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');

const { shouldSkipNode, translateString } = loadTranslatorSandbox();

class MockNode {
  constructor(nodeType, parentElement = null) {
    this.nodeType = nodeType;
    this.parentElement = parentElement;
    this.parentNode = parentElement;
  }
}

function matchesSimpleSelector(el, singleSel) {
  const s = singleSel.trim();
  if (!s) return false;
  // Support [attr="val"] / [attr]
  const attrMatch = s.match(/^([a-zA-Z0-9_-]+)?\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) {
    const [, tag, attr, val] = attrMatch;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    if (!el.hasAttribute(attr)) return false;
    return val === undefined ? true : el.getAttribute(attr) === val;
  }
  // Support .class (including escaped \/ in Tailwind classes like .group\/user-input-step)
  if (s.startsWith('.')) {
    const rawCls = s.slice(1).replace(/\\\//g, '/');
    return el.classList.contains(rawCls);
  }
  // Tag name
  return el.tagName === s.toUpperCase();
}

class MockElement extends MockNode {
  constructor(tagName, { className = '', attributes = {}, parentElement = null } = {}) {
    super(1, parentElement);
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.attributes = { ...attributes };
    this.children = [];
    this.childNodes = [];
  }

  get classList() {
    const classes = this.className ? this.className.split(/\s+/).filter(Boolean) : [];
    return {
      contains: (cls) => classes.includes(cls),
    };
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent || c.nodeValue || '').join('');
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return this.attributes[name] !== undefined;
  }

  matches(selectorList) {
    return String(selectorList)
      .split(',')
      .some((sel) => matchesSimpleSelector(this, sel));
  }

  closest(selectorList) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (cur.matches(selectorList)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    if (child.nodeType === 1) this.children.push(child);
    this.childNodes.push(child);
    return child;
  }
}

class MockTextNode extends MockNode {
  constructor(text, parentElement = null) {
    super(3, parentElement);
    this.nodeValue = text;
    this.textContent = text;
  }
}

const testCases = [
  {
    name: 'Case 1 (正常 UI 按钮控件): <button class="btn-primary">Settings</button> -> 不跳过 (false)',
    buildNode: () => {
      const button = new MockElement('button', { className: 'btn-primary' });
      const text = new MockTextNode('Settings', button);
      button.appendChild(text);
      return text;
    },
    expected: false,
  },
  {
    name: 'Case 2 (用户提问气泡组): <div class="group/user-input-step"><span>File</span></div> -> 跳过 (true)',
    buildNode: () => {
      const container = new MockElement('div', { className: 'group/user-input-step' });
      const span = new MockElement('span');
      container.appendChild(span);
      const text = new MockTextNode('File', span);
      span.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 3 (用户提问正文 data-testid="user-message-content"): 独立容器跳过 (true)',
    buildNode: () => {
      const msgDiv = new MockElement('div', { attributes: { 'data-testid': 'user-message-content' } });
      const p = new MockElement('p');
      msgDiv.appendChild(p);
      const text = new MockTextNode('NEW', p);
      p.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 4 (思考链正文保护): <div class="thought-content"><div>Thought</div></div> -> 跳过 (true)',
    buildNode: () => {
      const thoughtDiv = new MockElement('div', { className: 'thought-content' });
      const innerDiv = new MockElement('div');
      thoughtDiv.appendChild(innerDiv);
      const text = new MockTextNode('Thought', innerDiv);
      innerDiv.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 5 (Monaco 代码编辑器): <div class="monaco-editor"><span>Settings</span></div> -> 跳过 (true)',
    buildNode: () => {
      const editor = new MockElement('div', { className: 'monaco-editor' });
      const span = new MockElement('span');
      editor.appendChild(span);
      const text = new MockTextNode('Settings', span);
      span.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 6 (输入控件 TEXTAREA / INPUT / contenteditable): <textarea>Settings</textarea> -> 跳过 (true)',
    buildNode: () => {
      const ta = new MockElement('textarea');
      const text = new MockTextNode('Settings', ta);
      ta.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 7 (富文本编辑区 contenteditable="true"): 跳过 (true)',
    buildNode: () => {
      const div = new MockElement('div', { attributes: { contenteditable: 'true' } });
      const text = new MockTextNode('Models', div);
      div.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 8 (PRE / CODE 代码块节点): <pre><code>Settings</code></pre> -> 跳过 (true)',
    buildNode: () => {
      const pre = new MockElement('pre');
      const code = new MockElement('code');
      pre.appendChild(code);
      const text = new MockTextNode('Settings', code);
      code.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 9 (Xterm 终端容器): <div class="xterm"><span>File</span></div> -> 跳过 (true)',
    buildNode: () => {
      const xterm = new MockElement('div', { className: 'xterm' });
      const span = new MockElement('span');
      xterm.appendChild(span);
      const text = new MockTextNode('File', span);
      span.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 10 (KaTeX 数学公式容器): <span class="katex"><span>Plan</span></span> -> 跳过 (true)',
    buildNode: () => {
      const katex = new MockElement('span', { className: 'katex' });
      const span = new MockElement('span');
      katex.appendChild(span);
      const text = new MockTextNode('Plan', span);
      span.appendChild(text);
      return text;
    },
    expected: true,
  },
  {
    name: 'Case 11 (SVG 矢量图形标签): <svg><text>View</text></svg> -> 跳过 (true)',
    buildNode: () => {
      const svg = new MockElement('svg');
      const t = new MockElement('text');
      svg.appendChild(t);
      const text = new MockTextNode('View', t);
      t.appendChild(text);
      return text;
    },
    expected: true,
  },
];

let failedCount = 0;
let passedCount = 0;
console.log('=== 开始执行 Ticket 02 DOM 物理隔离 (shouldSkipNode) 单元测试 ===\n');

for (const tc of testCases) {
  const node = tc.buildNode();
  const actual = shouldSkipNode(node);
  try {
    assert.strictEqual(actual, tc.expected);
    console.log(`[PASS] ${tc.name}`);
    passedCount++;
  } catch (_) {
    console.error(`[FAIL] ${tc.name}`);
    console.error(`       实际返回: ${actual}`);
    console.error(`       期望返回: ${tc.expected}\n`);
    failedCount++;
  }
}

// 补充路径与 URL 免疫断言
assert.strictEqual(translateString('grill-with-docs-zh/SKILL.md'), 'grill-with-docs-zh/SKILL.md');
passedCount++;
console.log('[PASS] Case 12 (文件路径字符串保护): grill-with-docs-zh/SKILL.md 原样保留');

console.log(`\n测试汇总: 通过: ${passedCount}, 失败: ${failedCount}, 总计: ${testCases.length + 1}`);

if (failedCount > 0) {
  process.exit(1);
}
