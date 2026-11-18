const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// 1. 读取当前 localize.js 源码
const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');

// 2. 提取 DOM_TRANSLATOR_INJECTION 中的 translateString
function extractTranslator() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();

  injectionCode = injectionCode.replace(
    'if (document.readyState === \'loading\')',
    'globalThis.__test_translateString = translateString;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
  );

  const sandbox = {
    globalThis: {},
    document: { body: null, readyState: 'loading', addEventListener: () => {} },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
    Element: { prototype: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    window: {},
    history: {},
    queueMicrotask: (fn) => fn(),
    requestAnimationFrame: (fn) => fn()
  };
  vm.createContext(sandbox);
  vm.runInContext(injectionCode, sandbox);

  return sandbox.globalThis.__test_translateString;
}

const translateString = extractTranslator();
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

console.log('=== 开始 Ticket-07 Antigravity 2.13.0 核心特性汉化测试 ===\n');

// 1. 版本号校验
console.log('--- 版本元数据校验 ---');
const versionMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
const currentVer = versionMatch ? versionMatch[1] : null;
const isVerValid = Boolean(currentVer && require('./helpers/translator-loader').compareSemver(currentVer, '2.13.0') >= 0);
check('CURRENT_VERSION 版本号应 >= 2.13.0', isVerValid ? currentVer : null, currentVer);

// 2. 侧边问答与表单交互 (Side Question & Questionnaire)
console.log('\n--- 侧边问答与表单交互测试 ---');
check('Side Question 汉化', translateString('Side Question'), '侧边提问');
check('Side question 汉化', translateString('Side question'), '侧边提问');
check('Side question answered. 汉化', translateString('Side question answered.'), '侧边提问已回答。');
check('Side question answered 汉化', translateString('Side question answered'), '侧边提问已回答');
check('View side question 汉化', translateString('View side question'), '查看侧边提问');
check('Minimize side question 汉化', translateString('Minimize side question'), '最小化侧边提问');
check('Delete side question 汉化', translateString('Delete side question'), '删除侧边提问');
check('Cancel questionnaire 汉化', translateString('Cancel questionnaire'), '取消问答');
check('Cancel questionnaire and stop the agent 汉化', translateString('Cancel questionnaire and stop the agent'), '取消问答并停止智能体');

// 3. Git Amend 追加提交操作
console.log('\n--- Git Amend 追加提交测试 ---');
check('Amend 独立词条汉化', translateString('Amend'), '追加提交');
check('Amending... 动态操作态汉化', translateString('Amending...'), '正在追加提交...');
check('Amend staged changes into the current commit 汉化', translateString('Amend staged changes into the current commit'), '将已暂存改动追加合并至当前提交');
check('Stage and amend all changes into the current commit 汉化', translateString('Stage and amend all changes into the current commit'), '暂存并将所有改动追加合并至当前提交');
check('Amend succeeded 汉化', translateString('Amend succeeded'), '追加提交成功');
check('Failed to Amend 汉化', translateString('Failed to Amend'), '追加提交失败');
check('No changes to amend 汉化', translateString('No changes to amend'), '没有可追加的改动');
check('No commit to amend 汉化', translateString('No commit to amend'), '没有可追加的目标提交');
check('Resolve conflicts first 汉化', translateString('Resolve conflicts first'), '请先解决冲突');

// 4. 设置中心高级区域迁移 (Settings Restructuring)
console.log('\n--- 设置中心高级区域迁移提示测试 ---');
check('Best of N settings have moved 汉化', translateString('Best of N settings have moved'), 'Best of N 设置已迁移');
check('Best of N settings 迁移提示长句 汉化', translateString('Best of N settings have moved to the Advanced section of General settings.'), 'Best of N 设置已移至通用设置中的“高级”区域。');
check('CitC settings have moved 汉化', translateString('CitC settings have moved'), 'CitC 设置已迁移');
check('CitC settings 迁移提示长句 汉化', translateString('CitC settings have moved to the Advanced section of General settings.'), 'CitC 设置已移至通用设置中的“高级”区域。');
check('Labs settings have moved 汉化', translateString('Labs settings have moved'), '实验室设置已迁移');
check('Labs settings 迁移提示长句 汉化', translateString('Labs settings have moved to the Advanced section of General settings.'), '实验室设置已移至通用设置中的“高级”区域。');
check('Change VCS in General settings 汉化', translateString('Change VCS in General settings, under Advanced'), '在通用设置的“高级”区域中更改版本控制系统');
check('Skills and rules settings 汉化', translateString('Skills and rules settings'), '技能与规则设置');

// 5. 产物与表格宽度自适应 (Display Settings)
console.log('\n--- 产物与表格宽度自定义测试 ---');
check('Markdown Artifact Width 汉化', translateString('Markdown Artifact Width'), 'Markdown 产物宽度');
check('Configure the default width of markdown artifacts. 汉化', translateString('Configure the default width of markdown artifacts.'), '配置 Markdown 产物的默认显示宽度。');
check('Table Width 汉化', translateString('Table Width'), '表格宽度');
check('Configure the default width of tables. 汉化', translateString('Configure the default width of tables.'), '配置表格的默认显示宽度。');
check('Fit to content 汉化', translateString('Fit to content'), '适应内容');
check('Fit to width 汉化', translateString('Fit to width'), '适应宽度');

// 6. Windows 管理员权限 (UAC Elevation)
console.log('\n--- Windows 管理员权限 UAC 提升测试 ---');
check('Administrator access (UAC) 汉化', translateString('Administrator access (UAC)'), '管理员权限 (UAC)');
check('Grant administrator access for 汉化', translateString('Grant administrator access for'), '授予管理员权限至');
check('Grant one-time administrator access 汉化', translateString('Grant one-time administrator access'), '授予一次性管理员权限');
check('Requesting a one-time administrator (UAC) elevation 汉化', translateString('Requesting a one-time administrator (UAC) elevation'), '正在请求一次性管理员 (UAC) 权限提升');
check('Yes, allow 汉化', translateString('Yes, allow'), '允许授权');

// 7. 自定义项、插件与技能
console.log('\n--- 自定义项、插件与技能测试 ---');
check('Create plugin 汉化', translateString('Create plugin'), '创建插件');
check('Describe a plugin and the agent builds it 汉化', translateString('Describe a plugin and the agent builds it'), '描述插件功能，智能体将自动构建');
check('Delete Skill 汉化', translateString('Delete Skill'), '删除技能');
check('Enable recommended skills 汉化', translateString('Enable recommended skills'), '启用推荐技能');
check('Disable recommended skills 汉化', translateString('Disable recommended skills'), '禁用推荐技能');
check('Customizations views 汉化', translateString('Customizations views'), '自定义项视图');
check('Installed by you 汉化', translateString('Installed by you'), '由您安装');
check('Bundled with the app 汉化', translateString('Bundled with the app'), '随应用内置');
check('Listed in your config 汉化', translateString('Listed in your config'), '已在您的配置中列出');
check('Found in this workspace 汉化', translateString('Found in this workspace'), '在此工作区中找到');
check('No custom agents yet. 汉化', translateString('No custom agents yet.'), '暂无自定义智能体。');
check('No customizations match your search. 汉化', translateString('No customizations match your search.'), '没有匹配您搜索的自定义项。');
check('No skills or rules match this filter. 汉化', translateString('No skills or rules match this filter.'), '没有匹配此筛选条件的技能或规则。');
check('No skills or rules yet. 汉化', translateString('No skills or rules yet.'), '暂无技能或规则。');
check('Pre-installed 汉化', translateString('Pre-installed'), '预置');
check('Builtin 汉化', translateString('Builtin'), '内置');

// 8. 会话管理、暂存文件与比对器
console.log('\n--- 会话管理、暂存文件与比对器测试 ---');
check('Pin this conversation 汉化', translateString('Pin this conversation'), '置顶此对话');
check('Unpin this conversation 汉化', translateString('Unpin this conversation'), '取消置顶此对话');
check('Rename this conversation 汉化', translateString('Rename this conversation'), '重命名此对话');
check('Forked conversation 汉化', translateString('Forked conversation'), '派生的对话');
check('Scratch Files 汉化', translateString('Scratch Files'), '暂存文件');
check('No scratch files 汉化', translateString('No scratch files'), '暂无暂存文件');
check('Show Whitespace Changes 汉化', translateString('Show Whitespace Changes'), '显示空白字符变动');
check('Hide Whitespace Changes 汉化', translateString('Hide Whitespace Changes'), '隐藏空白字符变动');
check('Search Conversations 汉化', translateString('Search Conversations'), '搜索对话');
check('Search Projects 汉化', translateString('Search Projects'), '搜索项目');
check('Search Workspaces 汉化', translateString('Search Workspaces'), '搜索工作区');
check('Scroll to Bottom 汉化', translateString('Scroll to Bottom'), '滚动到底部');
check('Code block 汉化', translateString('Code block'), '代码块');
check('Code snippet 汉化', translateString('Code snippet'), '代码片段');
check('Comment on Selection 汉化', translateString('Comment on Selection'), '针对所选内容添加注释');
check('Configure MCP Server 汉化', translateString('Configure MCP Server'), '配置 MCP 服务器');
check('Conversation Log 汉化', translateString('Conversation Log'), '对话日志');
check('Copy error messages 汉化', translateString('Copy error messages'), '复制错误信息');

// 9. 企业级许可证与 Google Cloud 项目
console.log('\n--- 企业级许可证与 Google Cloud 项目测试 ---');
check('License Required 汉化', translateString('License Required'), '需要许可证');
check('Project Required 汉化', translateString('Project Required'), '需要关联项目');
check('Manage License 汉化', translateString('Manage License'), '管理许可证');
check('Google Cloud project required 汉化', translateString('A Google Cloud project is required to use Antigravity.'), '使用 Antigravity 需要关联 Google Cloud 项目。');
check('License or project required 汉化', translateString('A license or project selection is required to use Antigravity.'), '使用 Antigravity 需要具备许可证或选择关联项目。');

console.log('\n========================================');
console.log(`测试完成: ${passed}/${total} 通过 (${passed === total ? 'ALL PASS' : 'FAILED'})`);
console.log('========================================');

if (passed !== total) {
  process.exit(1);
}
