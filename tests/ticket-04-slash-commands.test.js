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

// 3. Mock DOM
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
console.log('=== 开始执行 Slash Commands & Mention Menu 专项测试 ===\n');

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

// 模块 A: 核心斜杠命令描述翻译
const commandDescCases = [
  {
    cmd: '/boost',
    en: 'Invoke the Boost multi-agent orchestrator for complex tasks.',
    expected: '调用 Boost 多智能体编排器处理复杂任务。'
  },
  {
    cmd: '/goal',
    en: 'Run until the specified goal is completely finished.',
    expected: '持续自主运行，直至指定目标彻底完成。'
  },
  {
    cmd: '/schedule',
    en: 'Run an instruction on a recurring schedule or as a one-time timer.',
    expected: '按周期循环计划或单次定时器执行指令。'
  },
  {
    cmd: '/browser',
    en: 'Invoke a browser agent for web tasks.',
    expected: '调用浏览器智能体执行网页相关任务。'
  },
  {
    cmd: '/browser-vision',
    en: '[Teamfood] Invoke a browser with computer-use tools only with experimental model.',
    expected: '[内部测试] 仅在实验模型下调用具备计算机操作工具的浏览器。'
  },
  {
    cmd: '/plan',
    en: 'Plan carefully before executing a task.',
    expected: '在执行任务前进行周密规划。'
  },
  {
    cmd: '/grill-me',
    en: 'Interview me to align on a plan.',
    expected: '通过交互式提问访谈，与我沟通对齐方案设计。'
  },
  {
    cmd: '/teamwork-preview',
    en: 'Invoke a team of agents to autonomously tackle large projects.',
    expected: '调度智能体团队协同自主处理大型工程项目。'
  },
  {
    cmd: '/learn',
    en: 'Reflect on recent successes or corrections to capture reusable skills or rules.',
    expected: '回顾近期的成功经验或纠偏记录，沉淀可复用的技能或规则。'
  },
  {
    cmd: '/deepagent',
    en: 'Experimental. Invoke the deep agent to plan, build, verify complex coding tasks.',
    expected: '实验性。调用深度智能体进行复杂编程任务的规划、构建与验证。'
  },
  {
    cmd: '/btw',
    en: 'Ask a quick question without interrupting the main conversation.',
    expected: '提出快速疑问，不中断主对话流程。'
  }
];

for (const c of commandDescCases) {
  runTest(`斜杠命令描述汉化: ${c.cmd}`, () => {
    const actual = translateString(c.en);
    assert.strictEqual(actual, c.expected);
  });
}

// 模块 B: 内置技能（自动注册为斜杠命令）说明汉化
const skillDescCases = [
  {
    name: 'migrate-workflows',
    en: 'Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.',
    expected: '在全局与工作区配置中将旧版工作流自动迁移为现代技能。扫描现有工作流，生成目标 SKILL.md 文件并安全归档旧文件。'
  },
  {
    name: 'mcp-permission-authorization',
    en: 'Use this skill when configuring, managing, or troubleshooting MCP (Model Context Protocol) tool permissions and whitelist authorizations in Antigravity. Covers syntax rules, config file locations, automatic whitelist injection, avoiding UI overwrite traps, and troubleshooting Windows environment gotchas.',
    expected: '在 Antigravity 中配置、管理或排查 MCP 工具权限与白名单授权时使用此技能。涵盖语法规则、配置文件位置、自动白名单注入、规避 UI 覆盖陷阱以及 Windows 避坑指南。'
  },
  {
    name: 'permissioned-github',
    en: 'Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.',
    expected: '与 GitHub 交互的操作准则，当命令因智能体环境限制执行失败时向用户申请授权。'
  }
];

for (const s of skillDescCases) {
  runTest(`内置技能说明汉化: ${s.name}`, () => {
    const actual = translateString(s.en);
    assert.strictEqual(actual, s.expected);
  });
}

// 模块 C: 菜单交互状态与分组标签汉化
const menuUiCases = [
  { en: 'recently opened', expected: '最近打开' },
  { en: 'Recently Opened', expected: '最近打开' },
  { en: 'file results', expected: '文件结果' },
  { en: 'File Results', expected: '文件结果' },
  { en: 'No matching results', expected: '无匹配结果' },
  { en: 'Searching…', expected: '搜索中…' },
  { en: 'Searching...', expected: '搜索中...' }
];

for (const m of menuUiCases) {
  runTest(`菜单交互状态汉化: "${m.en}"`, () => {
    const actual = translateString(m.en);
    assert.strictEqual(actual, m.expected);
  });
}

// 模块 D: 核心保护：斜杠命令名绝对保留英文原生触发符，严禁翻译
const triggerProtectionCases = ['boost', 'goal', 'schedule', 'browser', 'grill-me', 'learn', 'plan'];

for (const trigger of triggerProtectionCases) {
  runTest(`触发符保护 [menu-option-label]: "${trigger}" 必须跳过翻译`, () => {
    const labelSpan = new MockElement('span', { attributes: { 'data-testid': 'menu-option-label' } });
    const inner = new MockElement('span', { parentElement: labelSpan });
    labelSpan.appendChild(inner);
    const textNode = new MockTextNode(trigger, inner);
    inner.appendChild(textNode);
    const isSkipped = shouldSkipNode(textNode);
    assert.strictEqual(isSkipped, true, `触发符 ${trigger} 应当被 shouldSkipNode 判定为跳过(true)`);
  });
}

// 模块 E: 斜杠命令描述与浮层内容必须放行汉化
runTest('描述内容 [menu-option-description] 绝不被跳过', () => {
  const descSpan = new MockElement('span', { attributes: { 'data-testid': 'menu-option-description' } });
  const textNode = new MockTextNode('Invoke the Boost multi-agent orchestrator for complex tasks.', descSpan);
  descSpan.appendChild(textNode);
  const isSkipped = shouldSkipNode(textNode);
  assert.strictEqual(isSkipped, false, '描述内容应当被放行(false)');
});

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${failed}, 总计: ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
