const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== 开始 Ticket-40 对话页排队发送 (Send all (N))、模型档位与撤销/状态专项测试 ===\n');

const root = path.join(__dirname, '..');
const localizeSource = fs.readFileSync(path.join(root, 'localize.js'), 'utf-8');
const readyAsarPath = path.join(root, 'app.asar.ready');

function extractTranslatorAndSkip() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();

  injectionCode = injectionCode.replace(
    "if (document.readyState === 'loading')",
    'globalThis.__test_translateString = translateString;\n  globalThis.__test_shouldSkipNode = shouldSkipNode;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
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
    shouldSkipNode: sandbox.globalThis.__test_shouldSkipNode
  };
}

const { translateString, shouldSkipNode } = extractTranslatorAndSkip();

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

console.log('--- 1. 排队发送按钮与排队消息卡片文案 ---');
check('Send all (1) 动态计数翻译', translateString('Send all (1)'), '全部发送 (1)');
check('Send all (12) 两位计数翻译', translateString('Send all (12)'), '全部发送 (12)');
check('Send all 纯按钮翻译', translateString('Send all'), '全部发送');
check('Sends after agent finishes working 翻译', translateString('Sends after agent finishes working'), '智能体完成当前工作后发送');
check('Queued message deleted 提示翻译', translateString('Queued message deleted'), '已删除排队消息');
check('Empty message 占位翻译', translateString('Empty message'), '空消息');
check('+3 attachments 动态翻译', translateString('+3 attachments'), '+3 个附件');
check('Send now: Fix bug 动态无障碍翻译', translateString('Send now: Fix bug'), '立即发送：Fix bug');

console.log('\n--- 2. 模型思考档位（Extra / Max 及上下文窗组合）---');
check('Extra 档位翻译为 极高', translateString('Extra'), '极高');
check('Max 档位翻译为 最高', translateString('Max'), '最高');
check('Extra · 1M 组合标签翻译', translateString('Extra · 1M'), '极高 · 1M');
check('High · 200K 组合标签翻译', translateString('High · 200K'), '高 · 200K');
check('3 models selected 多模型统计翻译', translateString('3 models selected'), '已选择 3 个模型');

console.log('\n--- 3. 对话页撤销弹窗、过长提示与反馈问卷 ---');
check('过长对话历史提示 p5', translateString('This conversation grew too large, so the history before this point may be missing or incomplete.'), '此对话已过长，因此该节点之前的历史记录可能已缺失或不完整。');
check('无法撤回消息提示', translateString('Cannot revert this message'), '无法撤回此消息');
check('仅回退对话说明', translateString('Only the conversation will be rewound; your files will be left as-is.'), '仅会回退对话内容；您的文件将保持原样不变。');
check('View Diff for app.js 动态翻译', translateString('View Diff for app.js'), '查看 app.js 的差异');
check('错误Determining undo changes 动态翻译', translateString('There was an error determining the code changes that this undo action will make: timeout'), '确定此撤销操作将产生的代码更改时出错：timeout');
check('等待您的回答', translateString('Waiting for your answer'), '等待您的回答');
check('等待您的批准', translateString('Waiting for your approval'), '等待您的批准');
check('已自动继续 Auto-proceeded with', translateString('Auto-proceeded with'), '已自动继续');
check('Best of N 反馈问卷标题', translateString('Why did you choose this response?'), '你为什么选择此回复？');
check('Worktree 仓库提示', translateString('Worktrees are available for Git repositories'), 'Git 仓库支持 Worktree');

console.log('\n--- 4. 时间戳保持英文原样不被翻译（用户明确要求）---');
check('2m ago 保持不变', translateString('2m ago'), '2m ago');
check('24m 保持不变', translateString('24m'), '24m');
check('3m 保持不变', translateString('3m'), '3m');
check('11h 保持不变', translateString('11h'), '11h');
check('1mo 保持不变', translateString('1mo'), '1mo');
check('Just now 保持不变', translateString('Just now'), 'Just now');
check('Today at 11:50 AM 保持不变', translateString('Today at 11:50 AM'), 'Today at 11:50 AM');

console.log('\n--- 5. shouldSkipNode 装饰栏放行与用户正文绝对免疫校验 ---');
function makeMockEl(opts = {}) {
  const attrs = opts.attrs || {};
  const classes = new Set(opts.classes || []);
  const el = {
    nodeType: 1,
    tagName: opts.tagName || 'DIV',
    parentElement: opts.parent || null,
    innerText: opts.text || '',
    textContent: opts.text || '',
    className: Array.from(classes).join(' '),
    classList: { contains: (c) => classes.has(c) },
    getAttribute: (k) => attrs[k] || null,
    closest: (sel) => {
      const parts = sel.split(',').map((s) => s.trim());
      let cur = el;
      while (cur) {
        for (const p of parts) {
          const m = p.match(/^\[data-testid="([^"]+)"\]$/);
          if (m && cur.getAttribute('data-testid') === m[1]) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    }
  };
  return el;
}

const userInputStep = makeMockEl({ classes: ['group/user-input-step'], attrs: { 'data-testid': 'user-input-step' } });
const queuedDecorators = makeMockEl({ parent: userInputStep, attrs: { 'data-testid': 'queued-decorators' } });
const userActions = makeMockEl({ parent: userInputStep, attrs: { 'data-testid': 'user-message-actions' } });
const userMsgContent = makeMockEl({ parent: userInputStep, attrs: { 'data-testid': 'user-message-content' } });
const cancelBtnSpan = makeMockEl({ tagName: 'SPAN', parent: queuedDecorators, text: 'Cancel Sending Message' });
const actionSpan = makeMockEl({ tagName: 'SPAN', parent: userActions, text: 'Undo to this point' });
const userTextSpan = makeMockEl({ tagName: 'SPAN', parent: userMsgContent, text: 'Send all (1)' });

check('queued-decorators 内的按钮文本放行汉化', shouldSkipNode(cancelBtnSpan), false);
check('user-message-actions 内的操作提示放行汉化', shouldSkipNode(actionSpan), false);
check('user-message-content 内的用户文本严格跳过保护', shouldSkipNode(userTextSpan), true);

console.log('\n--- 6. RELEASE_VERSION 与 app.asar.ready 二进制产物验证 ---');
const releaseVerMatch = localizeSource.match(/const RELEASE_VERSION = ['"]([^'"]+)['"];/);
const releaseVer = releaseVerMatch ? releaseVerMatch[1] : '';
check('localize.js RELEASE_VERSION >= 2.32.2.1', require('./helpers/translator-loader').compareSemver(releaseVer, '2.32.2.1') >= 0, true);

const asarBuf = fs.readFileSync(readyAsarPath);
const asarSource = asarBuf.toString('utf-8', 0, Math.min(asarBuf.length, 30000000));
check('app.asar.ready 包含 全部发送 ($1) 动态正则', asarSource.includes('全部发送 ($1)'), true);
check('app.asar.ready 包含 智能体完成当前工作后发送', asarSource.includes('智能体完成当前工作后发送'), true);
check('app.asar.ready 包含 Extra/Max 档位 极高/最高', asarSource.includes('"Extra": "极高"') && asarSource.includes('"Max": "最高"'), true);

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}\n`);
if (passed !== total) {
  console.error('Ticket-40 校验存在失败项！');
  process.exit(1);
}
console.log('[成功] Ticket-40 对话页排队发送与模型档位专项测试全部通过！');
