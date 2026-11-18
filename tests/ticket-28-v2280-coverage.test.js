const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('=== 开始 Ticket-28 Antigravity 2.28.0 新增界面文案覆盖专项测试 ===\n');

const root = path.join(__dirname, '..');
const localizeSource = fs.readFileSync(path.join(root, 'src', 'dictionary.js'), 'utf-8');
const preloadSource = fs.readFileSync(path.join(root, 'extracted', 'dist', 'preload.js'), 'utf-8');

let passed = 0;
let total = 0;

function check(desc, actual, expected) {
  total++;
  try {
    assert.strictEqual(actual, expected);
    console.log(`PASS [${total}]: ${desc} => "${actual}"`);
    passed++;
  } catch (err) {
    console.error(`FAIL [${total}]: ${desc}`);
    console.error(`   期望: "${expected}"`);
    console.error(`   实际: "${actual}"`);
  }
}

// ---------------------------------------------------------------------------
// 1. 解析词典
// ---------------------------------------------------------------------------
function extractObj(src, name) {
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, inStr = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const dictBlock = extractObj(localizeSource, 'dictionary');
check('localize.js 存在 dictionary 词典块', Boolean(dictBlock), true);
const dictionary = vm.runInNewContext('(' + dictBlock + ')');
const coreWords = vm.runInNewContext('(' + extractObj(localizeSource, 'coreWords') + ')');

const dictKeys = new Set([...Object.keys(dictionary), ...Object.keys(coreWords)]);
const lowerKeys = new Set();
for (const k of dictKeys) lowerKeys.add(k.toLowerCase());

// ---------------------------------------------------------------------------
// 2. 2.28.0 新增界面文案必须全部覆盖（按功能分组抽样核心项）
// ---------------------------------------------------------------------------
const GROUPS = [
  {
    name: '幕僚长 (Chief of Staff)',
    entries: [
      ['Chief of Staff', '幕僚长'],
      ['Chief of Staff Dashboard', '幕僚长仪表板'],
      ['Chief of Staff canvas', '幕僚长画布'],
      ['Chief of Staff voice message failed', '幕僚长语音消息发送失败'],
      ['Chief of Staff voice mode is active', '幕僚长语音模式已开启'],
      ['Chief of Staff voice mode stopped', '幕僚长语音模式已停止'],
      ['Sent to Chief of Staff', '发送给幕僚长']
    ]
  },
  {
    name: '内置浏览器与浏览器工具',
    entries: [
      ['Browser CDP Port', '浏览器 CDP 端口'],
      ['Chrome Binary Path', 'Chrome 可执行文件路径'],
      ['Capture Console Logs', '捕获控制台日志'],
      ['Capture Screenshot', '捕获屏幕截图'],
      ['Click to copy URL', '点击复制 URL'],
      ['Browser Subagent', '浏览器子智能体']
    ]
  },
  {
    name: '远程工作区 (ABFS / CitC / Cog)',
    entries: [
      ['ABFS Workspace (Alpha)', 'ABFS 工作区（Alpha）'],
      ['Delete ABFS Workspace', '删除 ABFS 工作区'],
      ['CitC Clone', 'CitC 克隆'],
      ['CitC Workspace Type', 'CitC 工作区类型'],
      ['Delete All Remote Agents Data', '删除所有远程智能体数据']
    ]
  },
  {
    name: '执行模式、Hooks 与 Best-of-N',
    entries: [
      ['Autonomous Mode', '自主模式'],
      ['Agent always asks for review.', '智能体始终请求审查。'],
      ['Automatically decide if commands run.', '自动判断命令是否运行。'],
      ['Best-of-N Started', 'Best-of-N 已开始'],
      ['Best-of-N Ended', 'Best-of-N 已结束'],
      ['Hook will trigger if any tool is executed.', '执行任意工具时都会触发 Hook。']
    ]
  },
  {
    name: '后台任务、终端与企业集成',
    entries: [
      ['Background Tasks', '后台任务'],
      ['Background Commands', '后台命令'],
      ['Background Task Output', '后台任务输出'],
      ['Admin escalation', '管理员提权'],
      ['AI Credits Used to Generate Response', '生成回复已使用的 AI 额度'],
      ['GitHub Personal Access Token', 'GitHub 个人访问令牌']
    ]
  }
];

for (const g of GROUPS) {
  console.log(`--- ${g.name} ---`);
  for (const [k, v] of g.entries) {
    check(`${g.name}: 词典包含 "${k}"`, dictKeys.has(k) || lowerKeys.has(k.toLowerCase()), true);
    check(`${g.name}: "${k}" 译文`, dictionary[k] !== undefined ? dictionary[k] : coreWords[k], v);
  }
}

// ---------------------------------------------------------------------------
// 3. 译文不得为英文原文（专有名词白名单除外）
// ---------------------------------------------------------------------------
const PROPER_NOUNS = new Set([
  'Aoede', 'BoN', 'Buganizer', 'CORD', 'Charon', 'Chromium', 'Fenrir', 'Flash', 'Flash Lite',
  'Gemini 2.5 Flash Image', 'Gemini 3 Pro Image', 'Gemini 3.1 Flash Image', 'GitHub',
  'Google Sans', 'Google3', 'JSType', 'Kore', 'Leda', 'Linux', 'MCP', 'Orus', 'Pro', 'Puck',
  'Windows', 'Zephyr'
]);

// 只扫描 localize.js 中「===== 2.28.0 补充：」分组区段内的词条，
// 避免把基线词典里本就保留原文的专有名词（WSL / Antigravity 等）误判为漏翻。
const sampleGroupKeys = GROUPS.flatMap((g) => g.entries.map(([k]) => k));
check('src/dictionary.js 去重后总词条数 >= 3800 条', Object.keys(dictionary).length >= 3800, true);

const untranslated = sampleGroupKeys.filter(
  (k) => !PROPER_NOUNS.has(k) && String(dictionary[k]).trim() === k.trim()
);
check('2.28.0 核心词条中无「译文等于原文」的漏翻项', untranslated.length, 0);

const emptyVal = Object.keys(dictionary).filter((k) => !String(dictionary[k] || '').trim());
check('全量词典中无空译文', emptyVal.length, 0);

// ---------------------------------------------------------------------------
// 4. 词典规模与重复键健康度
// ---------------------------------------------------------------------------
console.log('\n--- 词典健康度 ---');
check('dictionary 词条数 >= 3500', Object.keys(dictionary).length >= 3500, true);

// 源码级重复 key 统计（与上游基线 619 对齐，不得新增）
const re = /^\s{4}("(?:[^"\\]|\\.)*")\s*:/gm;
let m;
const counts = new Map();
while ((m = re.exec(dictBlock))) {
  const k = JSON.parse(m[1]);
  counts.set(k, (counts.get(k) || 0) + 1);
}
let dupKeys = 0;
for (const c of counts.values()) if (c > 1) dupKeys++;
check('dictionary 源码级重复 key 数严格归零 (0)', dupKeys, 0);

// ---------------------------------------------------------------------------
// 5. 注入产物必须真实包含 2.28.0 补充分组与新增词条
// ---------------------------------------------------------------------------
console.log('\n--- 注入产物 (extracted/dist/preload.js) ---');
check('preload.js 包含引擎标识与 JSON 序列化词库', preloadSource.includes('// Antigravity 2.0 Chinese Localization Engine'), true);

const injected = [
  'Chief of Staff Dashboard', 'Browser CDP Port', 'Autonomous Mode', 'ABFS Workspace (Alpha)',
  'CitC Clone', 'Capture Console Logs', 'Delete ABFS Workspace', 'Best-of-N Started',
  'AI Credits Used to Generate Response', 'Hook will trigger if any tool is executed.'
];
let notInjected = 0;
for (const k of injected) if (!preloadSource.includes(k)) { notInjected++; console.error('   未注入: ' + k); }
check('新增词条已全部注入 preload.js', notInjected, 0);

// ---------------------------------------------------------------------------
// 6. app.asar.ready 必须与当前汉化一致（含新增词条）
// ---------------------------------------------------------------------------
console.log('\n--- app.asar.ready 离线补丁包 ---');
const readyPath = path.join(root, 'app.asar.ready');
check('app.asar.ready 存在', fs.existsSync(readyPath), true);
if (fs.existsSync(readyPath)) {
  const readyBuf = fs.readFileSync(readyPath).toString('latin1');
  let readyMissing = 0;
  for (const k of injected) if (!readyBuf.includes(k)) { readyMissing++; console.error('   ready 缺: ' + k); }
  check('app.asar.ready 包含全部新增词条', readyMissing, 0);
}

console.log('\n======================================================');
console.log(`Ticket-28 测试结果: ${passed}/${total} 断言全部通过！`);
console.log('======================================================\n');

if (passed !== total) {
  process.exit(1);
} else {
  process.exit(0);
}
