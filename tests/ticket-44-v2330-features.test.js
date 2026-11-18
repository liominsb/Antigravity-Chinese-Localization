'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');
const { loadTranslatorSandbox, compareSemver } = require('./helpers/translator-loader');
const { extractChangelogSection } = require('../release-assets/generate-release-assets');

console.log('=== 开始 Ticket-44 Antigravity 2.33.0 官方版本特性 (Computer Use HUD / 9 音色语音听写 / Cookie 站点管理 / 组合包 / SSH 接管) 专项测试 ===\n');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let total = 0;

function check(desc, actual, expected) {
  total++;
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`PASS [${total}]: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`FAIL [${total}]: ${desc}`);
    console.error('   期望:', expected);
    console.error('   实际:', actual);
  }
}

// -----------------------------------------------------------------------------
// 1. v2.33.0 版本号、文档与产物元数据一致性校验
// -----------------------------------------------------------------------------
console.log('--- 1. v2.33.0 版本号与文档元数据校验 ---');
const localizeSource = fs.readFileSync(path.join(ROOT, 'localize.js'), 'utf-8');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const extractedPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extracted', 'package.json'), 'utf-8'));
const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const readmeZh = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
const readmeEn = fs.readFileSync(path.join(ROOT, 'README.en.md'), 'utf-8');
const archZh = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf-8');
const archEn = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.en.md'), 'utf-8');
const changelogZh = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8');
const changelogEn = fs.readFileSync(path.join(ROOT, 'CHANGELOG.en.md'), 'utf-8');
const readyAsarPath = path.join(ROOT, 'app.asar.ready');

const curVerMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
const relVerMatch = localizeSource.match(/const RELEASE_VERSION = ['"]([^'"]+)['"];/);
check('localize.js CURRENT_VERSION >= 2.33.0', Boolean(curVerMatch && compareSemver(curVerMatch[1], '2.33.0') >= 0), true);
check('localize.js RELEASE_VERSION >= 2.33.0', Boolean(relVerMatch && compareSemver(relVerMatch[1], '2.33.0') >= 0), true);
check('package.json version >= 2.33.0', compareSemver(rootPkg.version, '2.33.0') >= 0, true);
check('extracted/package.json version >= 2.33.0', compareSemver(extractedPkg.version, '2.33.0') >= 0, true);
check('app.asar.ready package.json version >= 2.33.0', compareSemver(readAsarPackageVersion(readyAsarPath), '2.33.0') >= 0, true);
check('index.html 控制中心显示 v2.33.0+', /控制中心 v2\.(3[3-9]|[4-9]\d)\./.test(indexSource), true);
check('README.md 与 README.en.md 标注 v2.33.0+', /v2\.(3[3-9]|[4-9]\d)\./.test(readmeZh) && /v2\.(3[3-9]|[4-9]\d)\./.test(readmeEn), true);
check('docs/architecture(.en).md 同步 v2.33.0+', archZh.includes('2.33.0') && archEn.includes('2.33.0'), true);
check('CHANGELOG.md 与 CHANGELOG.en.md 包含 v2.33.0 章节', changelogZh.includes('## v2.33.0 (2026-11-18)') && changelogEn.includes('## v2.33.0 (2026-11-18)'), true);
check('extractChangelogSection 精确提取 v2.33.0 章节', extractChangelogSection(changelogZh, '2.33.0').matchedExact, true);

// -----------------------------------------------------------------------------
// 2. Computer Use 桌面控制 HUD 与边框遮罩主进程模块功能校验
// -----------------------------------------------------------------------------
console.log('\n--- 2. Computer Use 桌面控制 HUD 与主进程安全红线校验 ---');
const distDir = path.join(ROOT, 'extracted', 'dist');
const hudJs = fs.readFileSync(path.join(distDir, 'computer', 'hud.js'), 'utf-8');
check(
  'hud.js 汉化悬浮控制栏文案并严格保留 agy-hud: 控制台 IPC 协议令牌',
  hudJs.includes('AGY 正在控制您的 Mac') &&
    hudJs.includes('<button id="stop">停止</button><button id="resume">继续</button>') &&
    hudJs.includes("end.textContent = '已停止';") &&
    hudJs.includes('agy-hud:stop') &&
    hudJs.includes('agy-hud:resume'),
  true
);

const hudState = require(path.join(distDir, 'computer', 'hudState.js'));
check('hudState.hudView 暂停接管态保留 state="paused" 并输出中文', hudState.hudView({ agentActive: true, paused: true }), {
  state: 'paused',
  text: '智能体已暂停 — 您已接管控制',
  visible: true,
});
check('hudState.hudView 后台应用态保留 state="background" 并输出中文', hudState.hudView({ agentActive: true, paused: false, mode: 'background', appName: 'Safari' }), {
  state: 'background',
  text: 'AGY 正在后台操作 Safari',
  visible: true,
});
check('hudState.hudView 空闲态保留 state="idle"', hudState.hudView({ agentActive: false, paused: false }), {
  state: 'idle',
  text: '智能体空闲',
  visible: false,
});

const hudAgents = require(path.join(distDir, 'computer', 'hudAgents.js'));
const agentRows = hudAgents.hudAgentRows({
  agentActive: true,
  paused: false,
  agents: [{ actor: { id: 'a1', label: '' }, appName: '', mode: 'foreground', stopped: false }],
});
check('hudAgents.hudAgentRows 保留 row.mode="foreground" 枚举并汉化展示文本', {
  mode: agentRows[0].mode,
  text: agentRows[0].text,
}, {
  mode: 'foreground',
  text: '智能体：未命名 · 正在启动 · 前台',
});
check(
  'hudAgents.hudAgentsHeadline 多智能体协同与已停止汇总文案汉化',
  hudAgents.hudAgentsHeadline('AGY 正在控制您的 Mac', [
    { stopped: false },
    { stopped: false },
    { stopped: true },
  ]),
  '2 个 AGY 智能体正在运行'
);

const overlay = require(path.join(distDir, 'computer', 'overlay.js'));
check('overlay.overlayLabel 保留发往 Overlay.swift 的 "unnamed" 协议字面量', overlay.overlayLabel(''), 'unnamed');
check('overlay.overlayDisplayName 将 unnamed 渲染为 "智能体：未命名"', overlay.overlayDisplayName('unnamed'), '智能体：未命名');

const actuatorErrorsJs = fs.readFileSync(path.join(distDir, 'computerActuator', 'driver', 'errors.js'), 'utf-8');
check('computerActuator/driver/errors.js 模型侧报错保持纯英文未篡改', actuatorErrorsJs.includes('reaches the model as is') && !/[\u4e00-\u9fa5]/.test(actuatorErrorsJs), true);

// -----------------------------------------------------------------------------
// 3. v2.33.0 Remote SSH 扩展模块与菜单映射校验
// -----------------------------------------------------------------------------
console.log('\n--- 3. Remote SSH 扩展模块 (重启/共享主目录接管/配置诊断/地址校验) 校验 ---');
const discPage = require(path.join(distDir, 'remote', 'disconnectedPage.js'));
const restartingHtml = decodeURIComponent(
  discPage.disconnectedPageUrl(
    { state: 'restarting', canStop: false, serverStopped: false, label: 'devbox', dark: true },
    'tok44'
  ).replace(/^data:text\/html;charset=utf-8,/, '')
);
const stoppedHtml = decodeURIComponent(
  discPage.disconnectedPageUrl(
    { state: 'disconnected', canStop: true, serverStopped: true, label: 'devbox', dark: true },
    'tok44'
  ).replace(/^data:text\/html;charset=utf-8,/, '')
);
check(
  'disconnectedPage.js 支持 v2.33.0 restarting 与停止服务端按钮且保留 agy-ssh.invalid 动作路由',
  restartingHtml.includes('正在重启 devbox 上的 Antigravity 服务端…') &&
    stoppedHtml.includes('>停止服务端</a>') &&
    stoppedHtml.includes('href="https://agy-ssh.invalid/stop?page=tok44"'),
  true
);

const remoteMgrJs = fs.readFileSync(path.join(distDir, 'remote', 'remoteManager.js'), 'utf-8');
check(
  'remoteManager.js 汉化共享主目录冲突接管 (takeOverSheet)、服务端重启 (restartSheet) 与远程麦克风授权',
  remoteMgrJs.includes("title: '共享主目录冲突'") &&
    remoteMgrJs.includes("buttons: ['接管', '取消']") &&
    remoteMgrJs.includes("title: '重启 SSH 服务端'") &&
    remoteMgrJs.includes("buttons: ['立即重启', '稍后']") &&
    remoteMgrJs.includes("title: '麦克风访问权限'"),
  true
);

const sshArgs = require(path.join(distDir, 'remote', 'sshArgs.js'));
check('sshArgs.describeRemoteError 支持 SSH_CONFIG_INVALID 中文提示', sshArgs.describeRemoteError('SSH_CONFIG_INVALID', 'yes').includes('SSH 配置文件'), true);
check('sshArgs.describeRemoteError 支持 SHARED_HOME_UNSUPPORTED 接管指引', sshArgs.describeRemoteError('SHARED_HOME_UNSUPPORTED', 'yes').includes('接管'), true);
check(
  'sshArgs.isWindowsShellLine 精确识别英文 describeExit 输出 (未误改冒号)',
  sshArgs.isWindowsShellLine("ssh exited (exit code 1): 'sh' is not recognized as an internal or external command"),
  true
);

const sshConfigHosts = require(path.join(distDir, 'remote', 'sshConfigHosts.js'));
const bomProblem = sshConfigHosts.sshConfigProblemOfText('\uFEFFHost devbox');
check(
  'sshConfigHosts.describeSshConfigProblem 汉化 UTF-8 BOM 配置文件诊断',
  sshConfigHosts.describeSshConfigProblem('~/.ssh/config', bomProblem),
  '~/.ssh/config 的保存格式无法被 ssh 读取：文件开头包含字节顺序标记 (BOM)。请将其另存为不带 BOM 的 UTF-8 编码格式。'
);

const sshDest = require(path.join(distDir, 'remote', 'sshDestination.js'));
let destErrMsg = '';
try {
  sshDest.parseSshDestination('@devbox');
} catch (e) {
  destErrMsg = e.message;
}
check('sshDestination.parseSshDestination 抛出中文地址格式校验提示', destErrMsg.includes('缺少 "@" 之前的用户名'), true);

const menuJs = fs.readFileSync(path.join(distDir, 'menu.js'), 'utf-8');
const ipcJs = fs.readFileSync(path.join(distDir, 'ipcHandlers.js'), 'utf-8');
check(
  'menu.js 与 ipcHandlers.js 包含 v2.33.0 新增虚拟机/组合包/选区侧边提问/隐藏列表项菜单',
  menuJs.includes("'Toggle Virtual Machine': '切换虚拟机面板'") &&
    menuJs.includes("'Restart SSH Server': '重启 SSH 服务端'") &&
    ipcJs.includes("'Add bundle': '添加组合包'") &&
    ipcJs.includes("'Side Question Selection': '针对所选内容发起侧边提问'") &&
    ipcJs.includes('从此列表中隐藏 '),
  true
);

// -----------------------------------------------------------------------------
// 4. v2.33.0 Web UI 词典、9 款语音音色、站点 Cookie、组合包与动态正则验证
// -----------------------------------------------------------------------------
console.log('\n--- 4. Web UI 词典与动态正则全场景校验 ---');
const { translateString } = loadTranslatorSandbox();

// Computer Use & Agents Live
check('Computer Use 视图模式: Stage / Desktop', [translateString('Stage'), translateString('Desktop')], ['台前', '桌面']);
check('Computer Use: Switch to This Computer', translateString('Switch to This Computer'), '切换到本机');
check('Computer Use: Starting preview… (不夹生)', translateString('Starting preview…'), '正在启动预览…');
check('Computer Use macOS 权限引导: ✓ macOS permissions granted', translateString('✓ macOS permissions granted'), '✓ 已授予 macOS 权限');
check('Computer Use 暂停接管动态横幅', translateString('The agent is paused in Safari; its view keeps playing here. Resume to let it continue.'), '智能体已在 Safari 中暂停；其画面仍在此处实时播放。点击“恢复”即可让其继续操作。');
check('Computer Use 窗口标题聚焦提示', translateString('GitHub · Agent: main (Focus this tile)'), 'GitHub · 智能体：main（聚焦此视图）');
check('Computer Use 智能体意图胶囊: Agent: unnamed · typing', translateString('Agent: unnamed · typing'), '智能体：未命名 · 正在输入');
check('Computer Use 状态后缀芯片: · Finder · paused', translateString('· Finder · paused'), '· Finder · 已暂停');
check('Computer Use 策略隐藏原因动态提示', translateString('Hidden by policy (password field)'), '已按策略隐藏（password field）。');

// Voices & Voice Dictation (9 Gemini Live Voices)
check('语音设置与听写状态: Voices / Voice dictation unavailable', [translateString('Voices'), translateString('Voice dictation unavailable')], ['音色列表', '语音听写不可用']);
check('9 款新音色切换按钮: Use Cleo / Use Tari', [translateString('Use Cleo'), translateString('Use Tari')], ['使用 Cleo', '使用 Tari']);
check('音色无障碍序号: Arlo, voice 1 of 9', translateString('Arlo, voice 1 of 9'), 'Arlo，第 1 / 9 个音色');
check('语音转写重试动态提示: Retrying transcription (attempt 2)…', translateString('Retrying transcription (attempt 2)…'), '正在重试转写（第 2 次尝试）…');
check('麦克风缺失报错汉化', translateString('No microphone was found on this machine. Connect or enable an input device and try again.'), '未在此设备上检测到麦克风。请连接或启用音频输入设备后重试。');
check('宿主机麦克风服务报错汉化', translateString('Host microphone server is unavailable'), '宿主机麦克风服务不可用');

// Browsing Data & Per-Site Cookies
check('浏览数据面板: Browsing Data / Cookies by Site', [translateString('Browsing Data'), translateString('Cookies by Site')], ['浏览数据', '按站点管理 Cookie']);
check('站点 Cookie 数量: 12 cookies', translateString('12 cookies'), '12 个 Cookie');
check('删除站点 Cookie 按钮: Delete cookies for github.com', translateString('Delete cookies for github.com'), '删除 github.com 的 Cookie');
check('已删除站点 Cookie 提示: Deleted cookies for google.com', translateString('Deleted cookies for google.com'), '已删除 google.com 的 Cookie');

// Keybinding Scheme & Conflict Warning
check('快捷键方案: Keybinding Scheme / VS Code Default / Antigravity (AGY) Style', [
  translateString('Keybinding Scheme'),
  translateString('VS Code Default'),
  translateString('Antigravity (AGY) Style'),
], ['快捷键方案', 'VS Code 默认方案', 'Antigravity (AGY) 风格']);
check('快捷键冲突提示: Conflicts with "Toggle Terminal"', translateString('Conflicts with "Toggle Terminal"'), '与“Toggle Terminal”冲突');

// Marketplace Bundles & Source Review
check('插件市场组合包: Bundles / Loading bundle', [translateString('Bundles'), translateString('Loading bundle')], ['插件组合包', '正在加载插件组合包...']);
check('组合包安装完成通知: Added Cloud Pack and installed 3 plugins.', translateString('Added Cloud Pack and installed 3 plugins.'), '已添加 Cloud Pack 并安装 3 个插件。');
check('源码安全审查弹窗标题与警示正文', [
  translateString('Review bundle before adding'),
  translateString("This plugin's source is in prototypes/, which can have looser review standards than standard Google code. Review its contents before installing."),
], [
  '添加前审查组合包',
  '此插件的源码位于 prototypes/，其代码审查标准可能比标准 Google 代码更宽松。请在安装前审查其内容。',
]);

// Step Plan & Setup Routine & Remote SSH & Regression Guards
check('步骤计划卡片进度: Plan, 2 of 5 steps done', translateString('Plan, 2 of 5 steps done'), '计划：已完成 2 / 5 步');
check('步骤计划失败摘要: 2/5 steps · 1 failed. Show plan', translateString('2/5 steps · 1 failed. Show plan'), '2/5 步 · 1 失败。显示计划');
check('Remote SSH 登录归属动态提示', translateString("You're signing in on devbox. Your sign-in stays on that machine."), '你正在 devbox 上登录。登录状态将保存在该机器上。');
check('顶配 Google AI Ultra 订阅状态说明汉化', translateString('You are subscribed to the best Google AI plan.'), '您已订阅最高等级的 Google AI 计划。');
check('账户页 Your Plan 动态等级名称汉化', translateString('Your Plan: Google AI Ultra'), '您的计划：Google AI Ultra');
check('Orchestrator (Carbon) 悬浮说明气泡汉化', translateString('Carbon that may offload routine steps to Hydrogen. Same Carbon-level quality, fewer tokens used.'), '由 Carbon 主导，可将常规步骤分流至 Hydrogen 执行。保持 Carbon 级输出质量，消耗更少 Token。');
check('Orchestrator (Argon) 悬浮说明气泡汉化', translateString('Argon that may offload routine steps to Hydrogen. Same Argon-level quality, fewer tokens used.'), '由 Argon 主导，可将常规步骤分流至 Hydrogen 执行。保持 Argon 级输出质量，消耗更少 Token。');
check('Orchestrator 动态模型组合正则兜底', translateString('Oxygen that may offload routine steps to Hydrogen. Same Oxygen-level quality, fewer tokens used.'), '由 Oxygen 主导，可将常规步骤分流至 Hydrogen 执行。保持 Oxygen 级输出质量，消耗更少 Token。');
check('Orchestrator 固定档位不可调提示汉化', translateString("Effort isn't adjustable for Orchestrator (Argon)."), '无法为 Orchestrator (Argon) 调整思考档位。');
check('模型下线日期提示兼容无 from Antigravity 形态', translateString('This model will be removed on November 18, 2026.'), '此模型将于 2026 年 11 月 18 日移除。');

// Issue #60 回归守护：双击运行汉化.bat 严格 CRLF 且无 Node.js 时支持无缝桥接一键更新汉化.bat
const launcherBatBuf = fs.readFileSync(path.join(ROOT, '双击运行汉化.bat'));
const launcherBatStr = launcherBatBuf.toString('utf-8');
let bareLfCount = 0;
for (let i = 0; i < launcherBatBuf.length; i++) {
  if (launcherBatBuf[i] === 0x0a && (i === 0 || launcherBatBuf[i - 1] !== 0x0d)) bareLfCount++;
}
check('双击运行汉化.bat 保持严格 CRLF 行尾 (0 裸 LF) 防 CP936 偏移截断', bareLfCount, 0);
check(
  '双击运行汉化.bat 包含未解压拦截与无 Node.js 自动桥接离线模式 (Issue #60)',
  launcherBatStr.includes('goto BRIDGE_OFFLINE') && launcherBatStr.includes('call "%~dp0一键更新汉化.bat"') && launcherBatStr.includes('goto NO_SCRIPT'),
  true
);

if (process.platform === 'win32') {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const tmpIssue60 = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-t44-i60-'));
  try {
    fs.copyFileSync(path.join(ROOT, '双击运行汉化.bat'), path.join(tmpIssue60, '双击运行汉化.bat'));
    fs.writeFileSync(path.join(tmpIssue60, 'localize.js'), '// stub\r\n');
    fs.writeFileSync(path.join(tmpIssue60, 'app.asar.ready'), 'stub');
    fs.writeFileSync(path.join(tmpIssue60, '一键更新汉化.bat'), '@echo off\r\necho BRIDGED_OFFLINE_INSTALLER_OK\r\nexit /b 0\r\n');
    const bridgeRun = spawnSync('cmd.exe', ['/d', '/c', path.join(tmpIssue60, '双击运行汉化.bat')], {
      cwd: tmpIssue60,
      env: {
        SystemRoot: process.env.SystemRoot || 'C:\\Windows',
        ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
        PATH: 'C:\\Windows\\System32;C:\\Windows',
      },
      timeout: 5000,
    });
    check(
      'Windows 实机验证 (Issue #60): 无 Node.js 时双击运行汉化.bat 自动桥接离线安装器成功退出',
      bridgeRun.status === 0 && bridgeRun.stdout.toString('utf-8').includes('BRIDGED_OFFLINE_INSTALLER_OK'),
      true
    );
  } finally {
    fs.rmSync(tmpIssue60, { recursive: true, force: true });
  }
}
check('防截胡回归: Canceled saving setup routine', translateString('Canceled saving setup routine'), '已取消保存配置例程');
check('防截胡回归: Canceled deletion of setup routine', translateString('Canceled deletion of setup routine'), '已取消删除配置例程');
check('防夹生回归: Command prompt', translateString('Command prompt'), '命令提示符');
check('历史高频修复守护: NEW -> 新 / Repo -> 仓库', [translateString('NEW'), translateString('Repo')], ['新', '仓库']);
check('红线守护: 时间戳与模型名原样保留', [translateString('24m'), translateString('2m ago'), translateString('Gemini 3.8 Flash')], ['24m', '2m ago', 'Gemini 3.8 Flash']);

console.log(`\n======================================================`);
console.log(`Ticket-44 v2.33.0 专项验收结果: ${passed}/${total} 断言通过`);
console.log(`======================================================`);

if (passed !== total) {
  process.exit(1);
}
