const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== 开始 Ticket-41 模型角标 NEW 误译修复（新 vs 新建）专项测试 ===\n');

const root = path.join(__dirname, '..');
const localizeSource = fs.readFileSync(path.join(root, 'localize.js'), 'utf-8');
const readyAsarPath = path.join(root, 'app.asar.ready');
const preloadPath = path.join(root, 'extracted', 'dist', 'preload.js');

function extractDomEngine() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();

  injectionCode = injectionCode.replace(
    "if (document.readyState === 'loading')",
    [
      'globalThis.__test_translateString = translateString;',
      '  globalThis.__test_translateNode = translateNode;',
      '  globalThis.__test_shouldSkipNode = shouldSkipNode;',
      '  globalThis.__test_processBatchTranslation = processBatchTranslation;',
      '  globalThis.__test_pendingTextNodes = pendingTextNodes;',
      '  if (typeof document !== "undefined" && document.readyState === "loading")'
    ].join('\n  ')
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
  return {
    translateString: sandbox.globalThis.__test_translateString,
    translateNode: sandbox.globalThis.__test_translateNode,
    shouldSkipNode: sandbox.globalThis.__test_shouldSkipNode,
    processBatchTranslation: sandbox.globalThis.__test_processBatchTranslation,
    pendingTextNodes: sandbox.globalThis.__test_pendingTextNodes
  };
}

const {
  translateString,
  translateNode,
  processBatchTranslation,
  pendingTextNodes
} = extractDomEngine();

let passed = 0;
let total = 0;

function check(desc, actual, expected) {
  total++;
  try {
    assert.strictEqual(actual, expected);
    passed++;
    console.log(`PASS [${total}]: ${desc}`);
  } catch (e) {
    console.error(`FAIL [${total}]: ${desc}`);
    console.error(`   期望: ${JSON.stringify(expected)}`);
    console.error(`   实际: ${JSON.stringify(actual)}`);
  }
}

function matchesSimpleSelector(el, sel) {
  const tokens = [];
  const attrRe = /\[([^\]=]+)="([^"]+)"\]/g;
  let rest = sel.replace(attrRe, (_, k, v) => {
    tokens.push({ type: 'attr', k, v });
    return '';
  });
  for (const part of rest.split(/(?=[.#])/)) {
    if (!part) continue;
    if (part.startsWith('.')) tokens.push({ type: 'class', name: part.slice(1) });
    else if (part.startsWith('#')) tokens.push({ type: 'id', name: part.slice(1) });
    else tokens.push({ type: 'tag', name: part.toUpperCase() });
  }
  if (tokens.length === 0) return false;
  return tokens.every((tok) => {
    if (tok.type === 'attr') return el.getAttribute(tok.k) === tok.v;
    if (tok.type === 'class') return el.classList.contains(tok.name);
    if (tok.type === 'tag') return el.tagName === tok.name;
    return false;
  });
}

function makeMockEl(opts = {}) {
  const attrs = opts.attrs || {};
  const classes = new Set(opts.classes || []);
  const el = {
    nodeType: 1,
    tagName: (opts.tagName || 'DIV').toUpperCase(),
    parentElement: opts.parent || null,
    childNodes: [],
    hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
    getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
    className: Array.from(classes).join(' '),
    classList: { contains: (c) => classes.has(c) },
    closest: (sel) => {
      const selectors = sel.split(',').map((s) => s.trim()).filter(Boolean);
      let cur = el;
      while (cur) {
        if (selectors.some((s) => matchesSimpleSelector(cur, s))) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
  };
  if (opts.parent && Array.isArray(opts.parent.childNodes)) {
    opts.parent.childNodes.push(el);
  }
  return el;
}

function makeTextNode(text, parent) {
  const tn = {
    nodeType: 3,
    nodeValue: text,
    parentElement: parent
  };
  if (parent && Array.isArray(parent.childNodes)) {
    parent.childNodes.push(tn);
  }
  return tn;
}

console.log('--- 1. 纯文本字符串大小写与词组边界校验 ---');
check('全大写角标 NEW 翻译为 新', translateString('NEW'), '新');
check('带前后空白的 NEW 保留空白并翻译为 新', translateString('  NEW  '), '  新  ');
check('独立动词按钮 New 仍翻译为 新建', translateString('New'), '新建');
check('小写 new 兜底仍翻译为 新建', translateString('new'), '新建');
check('New Project 短语不受影响', translateString('New Project'), '新建项目');
check('New Group 短语不受影响', translateString('New Group'), '新建分组');
check('New Coordinator 短语不受影响', translateString('New Coordinator'), '新建协调器');
check('Replace With New 短语不受影响', translateString('Replace With New'), '替换为新建');
check('replace with new 小写短语不受影响', translateString('replace with new'), '替换为新建');

console.log('\n--- 2. DOM 上下文识别：角标 (新) vs 动作按钮 (新建) vs 用户正文免疫 ---');
const menuRow = makeMockEl({ tagName: 'BUTTON', attrs: { role: 'menuitem' } });
const tagPill = makeMockEl({ tagName: 'DIV', parent: menuRow, classes: ['bg-secondary', 'rounded-full', 'px-1.5', 'text-sm'] });
const upperBadgeText = makeTextNode('NEW', tagPill);
translateNode(menuRow);
check('模型选择器角标 <div>NEW</div> 译为 新', upperBadgeText.nodeValue, '新');

const tooltipPill = makeMockEl({ tagName: 'DIV', parent: menuRow, classes: ['bg-secondary', 'opacity-70', 'rounded-full', 'px-1.5', 'text-sm'] });
const tooltipSpan = makeMockEl({ tagName: 'SPAN', parent: tooltipPill });
const titleCaseBadgeText = makeTextNode('New', tooltipSpan);
translateNode(tooltipPill);
check('模型选择器含 info 提示的 Title Case 角标 <span>New</span> 译为 新', titleCaseBadgeText.nodeValue, '新');

const stepPrefixPill = makeMockEl({ tagName: 'SPAN', classes: ['text-sm', 'bg-secondary', 'rounded', 'px-1', 'py-px'] });
const stepPrefixText = makeTextNode('New', stepPrefixPill);
translateNode(stepPrefixPill);
check('步骤前缀徽章 <span class="bg-secondary rounded">New</span> 译为 新', stepPrefixText.nodeValue, '新');

const sidecarNewBtn = makeMockEl({ tagName: 'BUTTON', attrs: { 'data-testid': 'sidecar-new-button' }, classes: ['rounded-md'] });
const sidecarBtnText = makeTextNode('New', sidecarNewBtn);
translateNode(sidecarNewBtn);
check('Sidecar "+ New" 新建按钮保留为 新建', sidecarBtnText.nodeValue, '新建');

const roundedNewBtn = makeMockEl({ tagName: 'BUTTON', attrs: { 'data-testid': 'sidecar-new-button' }, classes: ['rounded-full'] });
const roundedBtnSpan = makeMockEl({ tagName: 'SPAN', parent: roundedNewBtn });
const roundedBtnText = makeTextNode('New', roundedBtnSpan);
translateNode(roundedNewBtn);
check('带 rounded-full 的 sidecar-new-button 仍保留为 新建', roundedBtnText.nodeValue, '新建');

const genericPillBtn = makeMockEl({ tagName: 'BUTTON', classes: ['bg-secondary', 'rounded-full'] });
const genericPillBtnSpan = makeMockEl({ tagName: 'SPAN', parent: genericPillBtn });
const genericPillBtnText = makeTextNode('New', genericPillBtnSpan);
translateNode(genericPillBtn);
check('普通 <button class="bg-secondary rounded-full"><span>New</span></button> 保留为 新建', genericPillBtnText.nodeValue, '新建');

const userInputStep = makeMockEl({ tagName: 'DIV', classes: ['group/user-input-step'], attrs: { 'data-testid': 'user-input-step' } });
const userContent = makeMockEl({ tagName: 'DIV', parent: userInputStep, attrs: { 'data-testid': 'user-message-content' } });
const userSpan = makeMockEl({ tagName: 'SPAN', parent: userContent });
const userNewText = makeTextNode('NEW', userSpan);
translateNode(userInputStep);
check('用户提问正文中的 NEW 严格跳过不被翻译', userNewText.nodeValue, 'NEW');

console.log('\n--- 3. characterData 增量批量通道回归校验 ---');
const dynamicPill = makeMockEl({ tagName: 'DIV', classes: ['bg-secondary', 'rounded-full'] });
const dynamicText = makeTextNode('New', dynamicPill);
pendingTextNodes.add(dynamicText);
processBatchTranslation();
check('characterData 增量通道正确将角标 New 译为 新', dynamicText.nodeValue, '新');

console.log('\n--- 4. 本地打包产物与 preload.js 注入校验 ---');
const preloadSource = fs.readFileSync(preloadPath, 'utf-8');
check('preload.js 已注入 trimmed === NEW 区分规则', preloadSource.includes("if (trimmed === 'NEW')"), true);
check('preload.js 已注入 isNewBadgeTextNode 与 translateTextNode', preloadSource.includes('isNewBadgeTextNode') && preloadSource.includes('translateTextNode'), true);

const asarBuf = fs.readFileSync(readyAsarPath);
const asarSource = asarBuf.toString('utf-8', 0, Math.min(asarBuf.length, 30000000));
check('app.asar.ready 包含 NEW 角标区分逻辑', asarSource.includes("if (trimmed === 'NEW')"), true);
check('app.asar.ready 包含 isNewBadgeTextNode 上下文识别函数', asarSource.includes('isNewBadgeTextNode'), true);

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}\n`);
if (passed !== total) {
  console.error('Ticket-41 校验存在失败项！');
  process.exit(1);
}
console.log('[成功] Ticket-41 模型角标 NEW 误译修复测试全部通过！');
