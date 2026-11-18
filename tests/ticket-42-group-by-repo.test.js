const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== 开始 Ticket-42 侧边栏分组方式 Repo 及远程项目文案专项测试 ===\n');

const root = path.join(__dirname, '..');
const localizeSource = fs.readFileSync(path.join(root, 'localize.js'), 'utf-8');
const preloadPath = path.join(root, 'extracted', 'dist', 'preload.js');
const readyAsarPath = path.join(root, 'app.asar.ready');

function extractDomEngine() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();

  injectionCode = injectionCode.replace(
    "if (document.readyState === 'loading')",
    [
      'globalThis.__test_translateString = translateString;',
      '  globalThis.__test_translateNode = translateNode;',
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
    translateNode: sandbox.globalThis.__test_translateNode
  };
}

const { translateString, translateNode } = extractDomEngine();

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

function makeMockEl(opts = {}) {
  const attrs = opts.attrs || {};
  const classes = new Set(opts.classes || []);
  const el = {
    nodeType: 1,
    tagName: (opts.tagName || 'DIV').toUpperCase(),
    parentElement: opts.parent || null,
    childNodes: [],
    get firstChild() { return this.childNodes[0] || null; },
    hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
    getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
    className: Array.from(classes).join(' '),
    classList: { contains: (c) => classes.has(c) },
    closest: (sel) => {
      const selectors = sel.split(',').map((s) => s.trim()).filter(Boolean);
      let cur = el;
      while (cur) {
        for (const s of selectors) {
          const m = s.match(/^\[([^\]=]+)="([^"]+)"\]$/);
          if (m && cur.getAttribute(m[1]) === m[2]) return cur;
          if (s.startsWith('.') && cur.classList.contains(s.slice(1))) return cur;
        }
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
  const tn = { nodeType: 3, nodeValue: text, parentElement: parent };
  if (parent && Array.isArray(parent.childNodes)) parent.childNodes.push(tn);
  return tn;
}

console.log('--- 1. 分组方式菜单全量词条校验 ---');
check('Group By 翻译为 分组方式', translateString('Group By'), '分组方式');
check('Project 翻译为 项目', translateString('Project'), '项目');
check('Repo 翻译为 仓库', translateString('Repo'), '仓库');
check('Environment 翻译为 环境', translateString('Environment'), '环境');
check('Status 翻译为 状态', translateString('Status'), '状态');
check('None 翻译为 无', translateString('None'), '无');
check('Repo default 翻译为 仓库默认', translateString('Repo default'), '仓库默认');
check('Remote Projects 翻译为 远程项目', translateString('Remote Projects'), '远程项目');

console.log('\n--- 2. 边界防误伤保护校验（代码路径与用户正文）---');
check('owner/repo 标识符保持原样', translateString('owner/repo'), 'owner/repo');
check('my-repo 含连字符标识符保持原样', translateString('my-repo'), 'my-repo');

const menu = makeMockEl({ tagName: 'DIV', attrs: { role: 'menu' } });
const triggerLabel = makeMockEl({ tagName: 'SPAN', parent: menu, attrs: { 'data-testid': 'group-by-submenu-trigger' } });
const triggerTitleText = makeTextNode('Group By', triggerLabel);
const triggerVal = makeMockEl({ tagName: 'SPAN', parent: menu });
const triggerValText = makeTextNode('Repo', triggerVal);
const repoOption = makeMockEl({ tagName: 'SPAN', parent: menu, attrs: { 'data-testid': 'group-by-option-repo' } });
const repoOptionText = makeTextNode('Repo', repoOption);
translateNode(menu);
check('分组方式菜单标题译为 分组方式', triggerTitleText.nodeValue, '分组方式');
check('分组方式父项当前选中值 Repo 译为 仓库', triggerValText.nodeValue, '仓库');
check('分组方式子菜单项 group-by-option-repo 译为 仓库', repoOptionText.nodeValue, '仓库');

const userStep = makeMockEl({ tagName: 'DIV', classes: ['group/user-input-step'] });
const userContent = makeMockEl({ tagName: 'DIV', parent: userStep, attrs: { 'data-testid': 'user-message-content' } });
const userSpan = makeMockEl({ tagName: 'SPAN', parent: userContent });
const userRepoText = makeTextNode('Repo', userSpan);
translateNode(userStep);
check('用户提问正文中的 Repo 严格跳过保护', userRepoText.nodeValue, 'Repo');

console.log('\n--- 3. preload.js 与 app.asar.ready 产物验证 ---');
const preloadSource = fs.readFileSync(preloadPath, 'utf-8');
check('preload.js 包含 "Repo": "仓库"', preloadSource.includes('"Repo": "仓库"'), true);
check('preload.js 包含 "Remote Projects": "远程项目"', preloadSource.includes('"Remote Projects": "远程项目"'), true);

const asarBuf = fs.readFileSync(readyAsarPath);
const asarSource = asarBuf.toString('utf-8', 0, Math.min(asarBuf.length, 30000000));
check('app.asar.ready 包含 "Repo": "仓库"', asarSource.includes('"Repo": "仓库"'), true);

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}\n`);
if (passed !== total) {
  console.error('Ticket-42 校验存在失败项！');
  process.exit(1);
}
console.log('[成功] Ticket-42 Repo 汉化修复与回归测试全部通过！');
