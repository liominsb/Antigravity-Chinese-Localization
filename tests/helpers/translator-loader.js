'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function getInjectionCode() {
  const buildPath = path.join(ROOT_DIR, 'src', 'build-injection.js');
  if (fs.existsSync(buildPath)) {
    const mod = require(buildPath);
    if (mod && typeof mod.DOM_TRANSLATOR_INJECTION === 'string') {
      return mod.DOM_TRANSLATOR_INJECTION;
    }
    if (mod && typeof mod.buildDomTranslatorInjection === 'function') {
      return mod.buildDomTranslatorInjection();
    }
  }
  const localizeSource = fs.readFileSync(path.join(ROOT_DIR, 'localize.js'), 'utf-8');
  const match = localizeSource.match(/(const DOM_TRANSLATOR_INJECTION = `[\s\S]*?`;)/);
  if (!match) {
    throw new Error('Unable to locate DOM_TRANSLATOR_INJECTION in src/build-injection.js or localize.js');
  }
  const hostSandbox = { globalThis: {} };
  vm.createContext(hostSandbox);
  vm.runInContext(match[1].replace('const DOM_TRANSLATOR_INJECTION', 'globalThis.DOM_TRANSLATOR_INJECTION'), hostSandbox);
  return hostSandbox.globalThis.DOM_TRANSLATOR_INJECTION;
}

function getCombinedSource() {
  const parts = [];
  const files = [
    path.join(ROOT_DIR, 'localize.js'),
    path.join(ROOT_DIR, 'src', 'dictionary.js'),
    path.join(ROOT_DIR, 'src', 'dom-translator.js'),
    path.join(ROOT_DIR, 'src', 'build-injection.js'),
  ];
  for (const fp of files) {
    if (fs.existsSync(fp)) {
      parts.push(fs.readFileSync(fp, 'utf-8'));
    }
  }
  try {
    parts.push(getInjectionCode());
  } catch (_) {}
  return parts.join('\n');
}

function loadTranslatorSandbox(extraSandbox = {}) {
  let injectionCode = getInjectionCode();

  const hookSnippet = [
    'globalThis.__test_exports = {',
    '  translateString: typeof translateString === "function" ? translateString : undefined,',
    '  shouldSkipNode: typeof shouldSkipNode === "function" ? shouldSkipNode : undefined,',
    '  translateNode: typeof translateNode === "function" ? translateNode : undefined,',
    '  tryCombinedSentenceTranslation: typeof tryCombinedSentenceTranslation === "function" ? tryCombinedSentenceTranslation : undefined,',
    '  translateElementAttributes: typeof translateElementAttributes === "function" ? translateElementAttributes : undefined,',
    '  setupSidebarProjectDragFix: typeof setupSidebarProjectDragFix === "function" ? setupSidebarProjectDragFix : undefined,',
    '};',
  ].join('\n');

  const lastEndIdx = injectionCode.lastIndexOf('})();');
  if (lastEndIdx === -1) {
    throw new Error('DOM_TRANSLATOR_INJECTION does not end with IIFE closure "})();"');
  }
  const instrumentedCode =
    injectionCode.slice(0, lastEndIdx) +
    '\n' + hookSnippet + '\n' +
    injectionCode.slice(lastEndIdx);

  const defaultDoc = {
    body: null,
    documentElement: null,
    readyState: 'loading',
    addEventListener: () => {},
    querySelectorAll: () => [],
  };
  const defaultWin = {
    addEventListener: () => {},
    getComputedStyle: () => ({ position: 'static', display: 'block', visibility: 'visible' }),
  };

  const sandbox = {
    globalThis: {},
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    queueMicrotask: (fn) => fn(),
    requestAnimationFrame: (fn) => fn(),
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
    Element: { prototype: {} },
    HTMLElement: function HTMLElement() {},
    ShadowRoot: function ShadowRoot() {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    document: defaultDoc,
    window: defaultWin,
    history: { pushState: () => {}, replaceState: () => {} },
    ...extraSandbox,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(instrumentedCode, sandbox);

  return {
    ...sandbox.__test_exports,
    injectionCode,
    sandbox,
  };
}

function compareSemver(v1, v2) {
  const parse = (v) => {
    const clean = String(v || '').trim().replace(/^[vV]/, '');
    const [core, prerelease = ''] = clean.split('-', 2);
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    return { nums, prerelease };
  };
  const a = parse(v1);
  const b = parse(v2);
  const len = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < len; i++) {
    const na = a.nums[i] || 0;
    const nb = b.nums[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease && b.prerelease && a.prerelease !== b.prerelease) {
    return a.prerelease > b.prerelease ? 1 : -1;
  }
  return 0;
}

module.exports = {
  ROOT_DIR,
  getInjectionCode,
  getCombinedSource,
  loadTranslatorSandbox,
  compareSemver,
};
