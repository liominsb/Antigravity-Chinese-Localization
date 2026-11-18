const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== Running Ticket-18: Agent Execution Labels & Tool Groups Localization Test ===\n');

const preloadPath = path.join(__dirname, '..', 'extracted', 'dist', 'preload.js');
assert.ok(fs.existsSync(preloadPath), 'extracted/dist/preload.js must exist');
const preloadCode = fs.readFileSync(preloadPath, 'utf-8');

// 1. VM 沙箱初始化以提取 translateString
const sandbox = {
  globalThis: {},
  window: {},
  document: { body: {}, addEventListener: () => {}, readyState: 'loading' },
  NodeFilter: { SHOW_TEXT: 4 },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
  Element: { prototype: {} },
  MutationObserver: class { observe() {} disconnect() {} },
  WeakSet: WeakSet,
  WeakMap: WeakMap,
  Set: Set,
  Map: Map,
  queueMicrotask: (fn) => fn(),
  requestAnimationFrame: (fn) => fn(),
  console: console
};
vm.createContext(sandbox);

// 从注入标记处提取引擎并注入测试导出钩子
const marker = '// Antigravity 2.0 Chinese Localization Engine';
const markerIdx = preloadCode.indexOf(marker);
assert.ok(markerIdx !== -1, 'Preload must contain localization injection marker');
const engineCode = preloadCode.substring(markerIdx);

const exportInstrument = engineCode.replace(
  "if (document.readyState === 'loading')",
  'globalThis.__test_translateString = translateString;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
);

vm.runInContext(exportInstrument, sandbox);
const translate = sandbox.globalThis.__test_translateString;
assert.ok(typeof translate === 'function', 'translateString must be callable in VM');

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

// 2. 基础 Agent 执行药丸与状态标签
console.log('--- 1. 基础 Agent 执行药丸与状态标签 ---');
check('Run 药丸', translate('Run'), '运行');
check('run 药丸小写', translate('run'), '运行');
check('Running 状态标签', translate('Running'), '正在运行');
check('running 状态标签小写', translate('running'), '正在运行');
check('Ran 状态标签', translate('Ran'), '已运行');
check('ran 状态标签小写', translate('ran'), '已运行');
check('Working 状态标签', translate('Working'), '正在工作');
check('Done 状态标签', translate('Done'), '已完成');
check('Waiting 状态标签', translate('Waiting'), '等待中');
check('Rejected 状态标签', translate('Rejected'), '已拒绝');
check('Errored 状态标签', translate('Errored'), '已出错');
check('Analyzed 状态标签', translate('Analyzed'), '已分析');
check('Analyzing 状态标签', translate('Analyzing'), '正在分析');
check('Explored 状态标签', translate('Explored'), '已探索');
check('Exploring 状态标签', translate('Exploring'), '正在探索');
check('Edited 状态标签', translate('Edited'), '已编辑');
check('Editing 状态标签', translate('Editing'), '正在编辑');
check('Created 状态标签', translate('Created'), '已创建');
check('Creating 状态标签', translate('Creating'), '正在创建');
check('Deleted 状态标签', translate('Deleted'), '已删除');
check('Deleting 状态标签', translate('Deleting'), '正在删除');

// 3. 工具组与命令药丸短语
console.log('\n--- 2. 工具组与命令药丸短语 ---');
check('Ran command 单数', translate('Ran command'), '已运行命令');
check('Ran commands 复数', translate('Ran commands'), '已运行命令');
check('Running command 单数', translate('Running command'), '正在运行命令');
check('Running commands 复数', translate('Running commands'), '正在运行命令');
check('Run command 单数', translate('Run command'), '运行命令');
check('Run commands 复数', translate('Run commands'), '运行命令');

// 4. 夹生词防漏自愈清洗
console.log('\n--- 3. 夹生词防漏自愈清洗 ---');
check('消除 Ran 命令 夹生词', translate('Ran 命令'), '已运行命令');
check('消除 Running 命令 夹生词', translate('Running 命令'), '正在运行命令');
check('消除 Ran 命令: 冒号前缀', translate('Ran 命令: git status -s'), '已运行命令: git status -s');
check('消除 Running 命令: 冒号前缀', translate('Running 命令: npm test'), '正在运行命令: npm test');
check('消除 Ran 数字 命令 夹生词', translate('Ran 3 命令'), '已运行 3 条命令');
check('消除 Running 数字 命令 夹生词', translate('Running 2 命令'), '正在运行 2 条命令');

// 5. 动词三联/复合短语 (pqb 聚合头)
console.log('\n--- 4. 复合动词多状态聚合短语 ---');
check('Explored files, ran commands, edited files', 
  translate('Explored files, ran commands, edited files'), 
  '已探索文件、已执行命令、已编辑文件'
);
check('Explored files, ran commands, edited artifact', 
  translate('Explored files, ran commands, edited artifact'), 
  '已探索文件、已执行命令、已编辑工件'
);
check('Explored files, ran commands, edited artifacts', 
  translate('Explored files, ran commands, edited artifacts'), 
  '已探索文件、已执行命令、已编辑工件'
);
check('Exploring files, running commands, editing files', 
  translate('Exploring files, running commands, editing files'), 
  '正在探索文件、运行命令、编辑文件'
);
check('Exploring files, running commands, editing artifact', 
  translate('Exploring files, running commands, editing artifact'), 
  '正在探索文件、运行命令、编辑工件'
);
check('Exploring files, running commands, editing artifacts', 
  translate('Exploring files, running commands, editing artifacts'), 
  '正在探索文件、运行命令、编辑工件'
);

// 6. 动态数字统计复合短语
console.log('\n--- 5. 动态数字统计复合短语 ---');
check('动态数字短语: 3 files, 2 commands, 1 file',
  translate('Explored 3 files, ran 2 commands, edited 1 file'),
  '已探索 3 个文件，已执行 2 条命令，已编辑 1 个文件'
);
check('动态数字短语: 1 file, 1 command, 2 artifacts',
  translate('Explored 1 file, ran 1 command, edited 2 artifacts'),
  '已探索 1 个文件，已执行 1 条命令，已编辑 2 个工件'
);
check('动态进行时短语: 2 files, 3 commands, 1 file',
  translate('Exploring 2 files, running 3 commands, editing 1 file'),
  '正在探索 2 个文件，正在运行 3 条命令，正在编辑 1 个文件'
);
check('动态进行时短语: 1 file, 2 commands, 1 artifact',
  translate('Exploring 1 file, running 2 commands, editing 1 artifact'),
  '正在探索 1 个文件，正在运行 2 条命令，正在编辑 1 个工件'
);
check('双动词: Explored 2 files, ran 3 commands',
  translate('Explored 2 files, ran 3 commands'),
  '已探索 2 个文件，已执行 3 条命令'
);
check('单动词统计: Ran 4 commands',
  translate('Ran 4 commands'),
  '已运行 4 条命令'
);
check('单动词统计: Running 2 commands',
  translate('Running 2 commands'),
  '正在运行 2 条命令'
);

// 7. 具体工具步骤行模式
console.log('\n--- 6. 具体工具步骤行模式 ---');
check('Ran command 具体命令', translate('Ran command: git status -s'), '已运行命令: git status -s');
check('Running command 具体命令', translate('Running command: npm run build'), '正在运行命令: npm run build');
check('等待命令完成', translate('Waiting for command completion (up to 30 seconds)'), '等待命令执行完成（最多 30 秒）');
check('已拒绝发送终止请求', translate('Rejected sending termination request to command'), '已拒绝向命令发送终止请求');
check('已拒绝发送输入', translate('Rejected sending input to command'), '已拒绝向命令发送输入');
check('已向命令发送终止请求', translate('Sent termination request to command'), '已向命令发送终止请求');
check('已向命令发送输入', translate('Sent input to command'), '已向命令发送输入');
check('建议向命令发送终止请求', translate('Suggested sending termination request to command'), '建议向命令发送终止请求');
check('建议向命令发送输入', translate('Suggested sending input to command'), '建议向命令发送输入');
check('正在向命令发送终止请求', translate('Sending termination request to command'), '正在向命令发送终止请求');
check('正在向命令发送输入', translate('Sending input to command'), '正在向命令发送输入');
check('发送终止请求出错', translate('Error sending termination request to command'), '向命令发送终止请求时出错');
check('发送输入出错', translate('Error sending input to command'), '向命令发送输入时出错');
check('取消编辑', translate('Canceled edit to src/app.js'), '已取消对 src/app.js 的编辑');
check('取消创建', translate('Canceled creation of test.txt'), '已取消创建 test.txt');
check('取消删除', translate('Canceled deletion of config.json'), '已取消删除 config.json');
check('调用 MCP 工具', translate('Used MCP tool: playwright/navigate'), '调用 MCP 工具: playwright/navigate');
check('调用工具', translate('Used tool: view_file'), '调用工具: view_file');
check('生成图像', translate('Generated image: cat sitting on desk'), '生成图像: cat sitting on desk');
check('浏览器任务', translate('Browser task: research docs'), '浏览器任务: research docs');
check('打开浏览器', translate('Opened browser: https://example.com'), '已打开浏览器: https://example.com');
check('读取 URL', translate('Read URL: https://example.com/api'), '读取 URL: https://example.com/api');
check('网页搜索', translate('Searched web: Antigravity release notes'), '网页搜索: Antigravity release notes');
check('调用子智能体', translate('Invoked subagent: research_assistant'), '调用子智能体: research_assistant');
check('搜索文件', translate('Searched for files: *.test.js'), '搜索文件: *.test.js');
check('搜索关键词', translate('Searched for "test"'), '搜索: "test"');
check('代码搜索', translate('Code search: function translateString'), '代码搜索: function translateString');
check('内部搜索', translate('Internal search: query'), '内部搜索: query');
check('列出目录', translate('Listed directory src/'), '列出目录: src/');

// 8. 校验 isActionPill 药丸白名单源码规则
console.log('\n--- 7. isActionPill 药丸白名单校验 ---');
const isActionPillRegexMatch = engineCode.match(/const isActionPill\s*=\s*textContent\.length\s*<=\s*\d+\s*&&\s*(\/[^/]+\/i)\.test/);
assert.ok(isActionPillRegexMatch, 'isActionPill regex must exist in engine code');
const actionPillRegex = vm.runInNewContext(isActionPillRegexMatch[1]);

const testPills = ['Run', 'Running', 'Ran', 'Explored', 'Exploring', 'Edited', 'Editing', 'Thought', 'Thinking', 'Working', 'Done', 'Analyzed', 'Analyzing', 'Waiting', 'Rejected', 'Errored', 'Ran command', 'Running commands'];
for (const pill of testPills) {
  check(`isActionPill 放行 "${pill}"`, actionPillRegex.test(pill), true);
}

console.log(`\n========================================`);
console.log(`Ticket-18 测试总结: 共 ${total} 项测试，通过 ${passed} 项，失败 ${total - passed} 项`);
if (passed === total) {
  console.log('🎉 Ticket-18 全部用例通过 (ALL GREEN)！');
  process.exit(0);
} else {
  console.error('❌ Ticket-18 存在失败用例！');
  process.exit(1);
}
