'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { loadTranslatorSandbox } = require('./helpers/translator-loader');
const { findValidOfficialBackup } = require('../src/backup-utils');
const { sanitizeSingleSegmentUsername } = require('../src/http-security');
const { executeAutoRestore } = require('../auto-restore');
const { ITEMS_TO_ZIP, extractChangelogSection } = require('../release-assets/generate-release-assets');
const localizerApp = require('../localize');

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

function httpRequest(port, reqOptions, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'GET',
        path: '/',
        ...reqOptions,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c.toString('utf-8'); });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function buildMinimalAsar(pkgObj, preloadContent = '"use strict";\n') {
  const pkgBytes = Buffer.from(JSON.stringify(pkgObj), 'utf-8');
  const preloadBytes = Buffer.from(preloadContent, 'utf-8');
  const headerObj = {
    files: {
      'package.json': { size: pkgBytes.length, offset: '0' },
      dist: {
        files: {
          'preload.js': { size: preloadBytes.length, offset: String(pkgBytes.length) },
        },
      },
    },
  };
  const headerJson = Buffer.from(JSON.stringify(headerObj), 'utf-8');
  const pad = (4 - (headerJson.length % 4)) % 4;
  const alignedJsonLen = headerJson.length + pad;
  const headerPickleSize = 4 + alignedJsonLen;
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(4, 0);
  pre.writeUInt32LE(headerPickleSize + 4, 4);
  pre.writeUInt32LE(headerPickleSize, 8);
  pre.writeUInt32LE(headerJson.length, 12);
  return Buffer.concat([pre, headerJson, Buffer.alloc(pad), pkgBytes, preloadBytes]);
}

(async () => {
  console.log('=== 开始 Ticket-43 全工程审计修复与架构优化综合验收测试 ===\n');

  // ---------------------------------------------------------------------------
  // Phase 1: 安全基建、回环鉴权、备份统一与进程 Fail-Closed
  // ---------------------------------------------------------------------------
  console.log('--- Phase 1: 安全基建、HTTP 回环鉴权与备份/进程安全 ---');
  check('HTTP 服务强制绑定 127.0.0.1', localizerApp.HOST_BIND, '127.0.0.1');
  check('CSRF_TOKEN 为 48 位随机十六进制字符串', /^[0-9a-f]{48}$/.test(localizerApp.CSRF_TOKEN), true);
  check('compareVersions 预发布号排序: 2.33.0-beta.1 < 2.33.0', localizerApp.compareVersions('2.33.0-beta.1', '2.33.0'), -1);
  check('compareVersions 补丁追踪号排序: 2.32.2.1 > 2.32.2', localizerApp.compareVersions('2.32.2.1', '2.32.2'), 1);
  check('getHostUsername 不再返回私人硬编码账号', !['11215', 'ranger'].includes(localizerApp.getHostUsername()), true);

  let traversalBlocked = false;
  try { sanitizeSingleSegmentUsername('../AppData'); } catch (e) { traversalBlocked = e.statusCode === 400; }
  check('sanitizeSingleSegmentUsername 拦截路径穿越 ../AppData', traversalBlocked, true);

  let nonStrBlocked = false;
  try { sanitizeSingleSegmentUsername(12345); } catch (e) { nonStrBlocked = e.statusCode === 400; }
  check('sanitizeSingleSegmentUsername 拦截非字符串类型参数', nonStrBlocked, true);

  let uncBlocked = false;
  try { localizerApp.getAppDir('', false, '\\\\192.168.1.9\\evil\\share'); } catch (e) { uncBlocked = e.statusCode === 400; }
  check('getAppDir 严格拦截 UNC 网络共享路径', uncBlocked, true);

  // Ephemeral loopback server integration tests
  await new Promise((resolve, reject) => {
    localizerApp.server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  const srvPort = localizerApp.server.address().port;
  try {
    const badHostRes = await httpRequest(srvPort, { path: '/api/status', headers: { Host: 'evil-rebind.example.com' } });
    check('DNS Rebinding 防护: 非法 Host 头返回 403', badHostRes.statusCode, 403);

    const ipv6MalformedRes = await httpRequest(srvPort, { path: '/api/status', headers: { Host: '::1' } });
    check('畸形 IPv6 Host (::1 无括号) 安全返回 403 不崩溃', ipv6MalformedRes.statusCode, 403);

    const optRes = await httpRequest(srvPort, { method: 'OPTIONS', path: '/api/status', headers: { Host: `127.0.0.1:${srvPort}` } });
    check('移除通配 CORS: OPTIONS 返回 405 且无 Access-Control-Allow-Origin: *', optRes.statusCode === 405 && !optRes.headers['access-control-allow-origin'], true);

    const indexRes = await httpRequest(srvPort, { path: '/', headers: { Host: `127.0.0.1:${srvPort}` } });
    check('首页注入一次性 CSRF Token 与严格 CSP 响应头',
      indexRes.statusCode === 200 &&
      indexRes.body.includes(`content="${localizerApp.CSRF_TOKEN}"`) &&
      Boolean(indexRes.headers['content-security-policy']),
      true
    );

    const noCsrfPost = await httpRequest(
      srvPort,
      {
        method: 'POST',
        path: '/api/clean-cache',
        headers: { Host: `127.0.0.1:${srvPort}`, 'Content-Type': 'application/json' },
      },
      '{}'
    );
    check('状态变更接口无 X-Localizer-Token 严格拒绝 (403)', noCsrfPost.statusCode, 403);

    const crossOriginPost = await httpRequest(
      srvPort,
      {
        method: 'POST',
        path: '/api/clean-cache',
        headers: {
          Host: `127.0.0.1:${srvPort}`,
          Origin: 'https://attacker.example',
          'Content-Type': 'application/json',
          'X-Localizer-Token': localizerApp.CSRF_TOKEN,
        },
      },
      '{}'
    );
    check('跨源 Origin 请求严格拒绝 (403)', crossOriginPost.statusCode, 403);

    const bigPayload = JSON.stringify({ pad: 'x'.repeat(20000) });
    const tooLargeRes = await httpRequest(
      srvPort,
      {
        method: 'POST',
        path: '/api/restore',
        headers: {
          Host: `127.0.0.1:${srvPort}`,
          'Content-Type': 'application/json',
          'X-Localizer-Token': localizerApp.CSRF_TOKEN,
        },
      },
      bigPayload
    );
    check('超大 JSON 请求体 (>16KB) 严格拦截返回 413', tooLargeRes.statusCode, 413);

    const statusRes = await httpRequest(srvPort, { path: '/api/status', headers: { Host: `127.0.0.1:${srvPort}` } });
    const statusJson = JSON.parse(statusRes.body);
    check('/api/status 返回 currentVersion 与 releaseVersion',
      statusRes.statusCode === 200 && statusJson.currentVersion === localizerApp.CURRENT_VERSION && statusJson.releaseVersion === localizerApp.RELEASE_VERSION,
      true
    );
  } finally {
    await new Promise((resolve) => localizerApp.server.close(() => resolve()));
  }

  // Backup unification & version validation test
  const tmpBakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-t43-bak-'));
  try {
    fs.writeFileSync(path.join(tmpBakDir, 'app.asar.bak'), buildMinimalAsar({ version: '2.15.0' }));
    fs.writeFileSync(path.join(tmpBakDir, 'app.asar.backup-abcdef1234567890-1'), buildMinimalAsar({ version: '2.32.2' }));
    const found2322 = findValidOfficialBackup({ resourcesDir: tmpBakDir, targetVersion: '2.32.2' });
    check('findValidOfficialBackup 自动跳过旧版 2.15.0 .bak 并命中匹配的 2.32.2 backup-*',
      Boolean(found2322.match && found2322.match.version === '2.32.2' && found2322.staleBackups.length === 1),
      true
    );
    const found2990 = findValidOfficialBackup({ resourcesDir: tmpBakDir, targetVersion: '2.99.0' });
    check('findValidOfficialBackup 无同版本备份时返回 match=null 防跨版本还原白屏', found2990.match, null);
  } finally {
    fs.rmSync(tmpBakDir, { recursive: true, force: true });
  }

  // Auto-restore fail-closed process check test
  const tmpRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-t43-ar-'));
  try {
    const resDir = path.join(tmpRestoreDir, 'resources');
    fs.mkdirSync(resDir, { recursive: true });
    const officialBuf = buildMinimalAsar({ version: '2.32.2' });
    const patchBuf = buildMinimalAsar({ version: '2.32.2' }, '// Antigravity 2.0 Chinese Localization Engine\n');
    fs.writeFileSync(path.join(resDir, 'app.asar'), officialBuf);
    const patchFile = path.join(tmpRestoreDir, 'app.asar.ready');
    fs.writeFileSync(patchFile, patchBuf);

    const arResult = await executeAutoRestore({
      appDir: tmpRestoreDir,
      getResourcesDir: () => resDir,
      workspaceDir: tmpRestoreDir,
      isAppRunning: () => { throw new Error('tasklist RPC timeout'); },
      stopProcesses: () => {},
      forceStop: true,
    });
    check('executeAutoRestore 进程检测抛错时 Fail-closed 中止覆盖', arResult.code, 'PROCESS_CHECK_FAILED');
  } finally {
    fs.rmSync(tmpRestoreDir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // Phase 2: 模块化翻译引擎、词典零重复、正则截胡修复与防夹生守卫
  // ---------------------------------------------------------------------------
  console.log('\n--- Phase 2: 模块化 src/ 引擎、词典去重、正则修复与 React Fiber 安全 ---');
  const dictPath = path.join(ROOT, 'src', 'dictionary.js');
  const domTransPath = path.join(ROOT, 'src', 'dom-translator.js');
  const buildInjPath = path.join(ROOT, 'src', 'build-injection.js');
  check('src/ 模块化三件套物理文件齐全',
    fs.existsSync(dictPath) && fs.existsSync(domTransPath) && fs.existsSync(buildInjPath),
    true
  );

  // Check zero duplicate keys in src/dictionary.js object literal
  const dictSrc = fs.readFileSync(dictPath, 'utf-8');
  const dictBlockMatch = dictSrc.match(/const\s+dictionary\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(dictBlockMatch, 'src/dictionary.js 必须定义 const dictionary = { ... };');
  const keyMatches = [...dictBlockMatch[1].matchAll(/^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:/gm)];
  const seenKeys = new Set();
  const dupKeys = [];
  for (const m of keyMatches) {
    const rawKey = m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2];
    if (seenKeys.has(rawKey)) dupKeys.push(rawKey);
    seenKeys.add(rawKey);
  }
  check('src/dictionary.js 词典键 100% 零重复', dupKeys.length, 0);

  const { translateString, translateNode } = loadTranslatorSandbox();

  // [C-02] 8 hijacked dictionary entries restored
  check('字典前置修复 [1]: Google Drive @drive: 长句不被 Install 正则截胡',
    translateString('Install or enable the Google Drive plugin in Customizations to search files with @drive: or paste Drive links'),
    '在自定义设置中安装或启用 Google Drive 插件，即可使用 @drive: 搜索文件或粘贴云端硬盘链接'
  );
  check('字典前置修复 [2]: 浏览器子智能体内置运行说明不被截断反转',
    translateString('Configure allowed and denied URLs for the browser subagent. It runs in the built-in browser, so no separate browser install is needed.'),
    '配置浏览器子智能体允许和拒绝访问的 URL。它在内置浏览器中运行，无需单独安装浏览器。'
  );
  check('字典前置修复 [3]: 远程接力二维码说明前半句不被吞掉',
    translateString('Pick up this remote conversation on your phone or in any browser. Scan the QR code or open the link below.'),
    '在手机或任意浏览器中继续此远程对话。请扫描二维码或打开下方链接。'
  );
  check('字典前置修复 [4]: Updated sidebar grouping 不再变夹生',
    translateString('Updated sidebar grouping'),
    '侧边栏分组已更新'
  );
  check('字典前置修复 [5]: 对话数据未找到长句不再仅翻末尾三词',
    translateString('The conversation could not be loaded because its data was not found.'),
    '未找到该对话的数据，无法加载。'
  );
  check('字典前置修复 [6]: Modify permissions for file and terminal tools. 精确输出',
    translateString('Modify permissions for file and terminal tools.'),
    '修改文件与终端工具的权限。'
  );

  // Regex & replacement bugs fixed
  check('Resets in 3 days 修复为 "3 天后重置" (无 天ays 残余)', translateString('Resets in 3 days'), '3 天后重置');
  const weeklyRefresh = translateString('You have used some of your weekly limit it will fully refresh in: 2 days 19 hours');
  check('每周限额刷新动态语句消除中英双冒号 "：:"', !weeklyRefresh.includes('：:') && weeklyRefresh.includes('2 天 19 小时'), true);
  check('LaTeX \\textcolor 字符串不被控制字符污染', dictSrc.includes('\\t') === false || !JSON.stringify(require('../src/dictionary').dictionary).includes('\\tcolor'), true);
  check('$ 替换符安全性: 含 $& / $$ 的动态参数不被篡改', translateString('Open in $&App').includes('$&App'), true);

  // Chinglish guard + 38 audited v2.32.2 phrases + 4 JSX split parenthesis prefixes
  check('coreWords 100% 实词守卫: 未收录混合词组保持纯英文不夹生', translateString('Toggle Fictional FooPanel'), 'Toggle Fictional FooPanel');
  check('高频夹生词修复: Toggle Terminal Panel', translateString('Toggle Terminal Panel'), '切换终端面板');
  check('高频夹生词修复: Working copy', translateString('Working copy'), '工作副本');
  check('高频夹生词修复: Always on', translateString('Always on'), '常驻运行');
  check('高频夹生词修复: Password Prompt Blocked', translateString('Password Prompt Blocked'), '密码输入提示已拦截');
  check('高频夹生词修复: Expand Questionnaire', translateString('Expand Questionnaire'), '展开问卷');
  check('v2.32.2 核心漏译补充: Queue Message', translateString('Queue Message'), '排队发送消息');
  check('React JSX 拆分左括号前缀: "See all ("', translateString('See all ('), '查看全部 (');
  check('React JSX 拆分左括号前缀: "Generation Steps ("', translateString('Generation Steps ('), '生成步骤 (');
  check('React JSX 拆分左括号前缀: "Show submitted ("', translateString('Show submitted ('), '显示已提交 (');
  check('React JSX 拆分左括号前缀: "Show more ("', translateString('Show more ('), '显示更多 (');

  // React Fiber safety: never overwrite Element.textContent destroying child elements
  const childSpan1Text = { nodeType: 3, nodeValue: 'No matching files', parentElement: null };
  const childSpan1 = {
    nodeType: 1,
    tagName: 'SPAN',
    className: '',
    attributes: {},
    children: [],
    childNodes: [childSpan1Text],
    get firstChild() { return this.childNodes[0]; },
    get textContent() { return this.childNodes.map((n) => n.nodeValue).join(''); },
    set textContent(_v) { throw new Error('FORBIDDEN: Element.textContent setter destroys React Fiber children!'); },
    getAttribute() { return null; },
    hasAttribute() { return false; },
    closest() { return null; },
  };
  childSpan1Text.parentElement = childSpan1;
  const emptyContainer = {
    nodeType: 1,
    tagName: 'DIV',
    className: 'empty-state',
    attributes: {},
    children: [childSpan1],
    childNodes: [childSpan1],
    get firstChild() { return this.childNodes[0]; },
    get textContent() { return childSpan1.textContent; },
    set textContent(_v) { throw new Error('FORBIDDEN: Element.textContent setter destroys React Fiber children!'); },
    getAttribute() { return null; },
    hasAttribute() { return false; },
    closest() { return null; },
  };
  childSpan1.parentElement = emptyContainer;
  translateNode(emptyContainer);
  check('React Fiber 安全: 空状态容器仅改写叶子 Text.nodeValue 不销毁子元素', childSpan1Text.nodeValue, '无匹配文件');

  // ---------------------------------------------------------------------------
  // Phase 3: 官方 v2.32.2 Electron 主进程静态补丁覆盖验证
  // ---------------------------------------------------------------------------
  console.log('\n--- Phase 3: 官方 v2.32.2 主进程全模块补丁校验 ---');
  const distDir = path.join(ROOT, 'extracted', 'dist');
  const updaterJs = fs.readFileSync(path.join(distDir, 'updater.js'), 'utf-8');
  const menuJs = fs.readFileSync(path.join(distDir, 'menu.js'), 'utf-8');
  const trayJs = fs.readFileSync(path.join(distDir, 'tray.js'), 'utf-8');
  const ipcJs = fs.readFileSync(path.join(distDir, 'ipcHandlers.js'), 'utf-8');
  const chooserJs = fs.readFileSync(path.join(distDir, 'deviceChooser.js'), 'utf-8');
  const cableJs = fs.readFileSync(path.join(distDir, 'cablev2.js'), 'utf-8');
  const popupSecJs = fs.readFileSync(path.join(distDir, 'webviewPopupSecurity.js'), 'utf-8');
  const remoteMgrJs = fs.readFileSync(path.join(distDir, 'remote', 'remoteManager.js'), 'utf-8');
  const sshArgsJs = fs.readFileSync(path.join(distDir, 'remote', 'sshArgs.js'), 'utf-8');
  const sshErrJs = fs.readFileSync(path.join(distDir, 'remote', 'sshErrorText.js'), 'utf-8');
  const signInCbJs = fs.readFileSync(path.join(distDir, 'remote', 'signInCallback.js'), 'utf-8');
  const sshConnJs = fs.readFileSync(path.join(distDir, 'remote', 'sshConnection.js'), 'utf-8');

  check('updater.js 挂载中文 updateActions 键并映射 MENU_UPDATE_STEP_LABELS',
    updaterJs.includes("'检查更新': () => checkForUpdates(true)") &&
      (updaterJs.includes("'重启以应用更新': () => quitAndInstall()") || updaterJs.includes("'重启以应用更新': () => void quitAndInstall()")) &&
      updaterJs.includes('MENU_UPDATE_STEP_LABELS'),
    true
  );
  check('menu.js 缩放菜单兼容中文 "视图" 标签', menuJs.includes("item.label === 'View' || item.label === '视图'"), true);
  check('tray.js 汉化异步插入的 Connect to WSL 与 Reopen Locally', trayJs.includes('连接到 WSL') && trayJs.includes('在本地重新打开'), true);
  check('ipcHandlers.js 汉化选择下载文件夹与动态右键菜单',
    ipcJs.includes('选择下载文件夹') && ipcJs.includes('重命名分组') && ipcJs.includes('移动到分组：') && ipcJs.includes('从最近记录中移除 '),
    true
  );
  check('deviceChooser.js 消除半英半中弹窗文本',
    chooserJs.includes('请求连接') && chooserJs.includes('请选择设备：') && chooserJs.includes('未知设备') && !chooserJs.includes('wants to connect to a'),
    true
  );
  check('cablev2.js 汉化底部取消按钮', cableJs.includes('>取消</button>'), true);
  check('webviewPopupSecurity.js 汉化证书详情与角色右键菜单',
    popupSecJs.includes('证书有效') && popupSecJs.includes('颁发给：') && popupSecJs.includes("label: '剪切'"),
    true
  );
  check('remoteManager.js 汉化停止服务端与组织登录详情正文',
    remoteMgrJs.includes('在此主机上运行的智能体将停止') && remoteMgrJs.includes('员工池：') && remoteMgrJs.includes('SSH 连接失败'),
    true
  );
  check('sshArgs.js 补齐 HOSTKEY_REJECTED / CONNECTION_FAILED / LS_START_FAILED / UNKNOWN',
    sshArgsJs.includes('该主机的 SSH 密钥') && sshArgsJs.includes('SSH 配置文件无效。') && sshArgsJs.includes('服务端启动失败'),
    true
  );
  check('sshErrorText.js 汉化错误代码与日志标签', sshErrJs.includes('错误代码：') && sshErrJs.includes('连接在完成前已关闭。'), true);
  check('signInCallback.js 汉化 OAuth 本地回调页 HTML', signInCbJs.includes('登录成功，您可以关闭此标签页') && signInCbJs.includes('登录未完成'), true);
  check('sshConnection.js 汉化 7 阶段实时连接状态流', sshConnJs.includes('正在检查 ${label}…') && sshConnJs.includes('正在启动 ${label} 上的 Antigravity 服务端…'), true);

  // ---------------------------------------------------------------------------
  // Phase 4: 跨平台脚本行尾、发版工具防呆与前端无阻塞安全校验
  // ---------------------------------------------------------------------------
  console.log('\n--- Phase 4: 跨平台脚本、发版流水线与前端状态机校验 ---');
  const gitattrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf-8');
  check('.gitattributes 声明 *.command text eol=lf', gitattrs.includes('*.command text eol=lf'), true);
  check('一键更新汉化.command 为纯 LF 无 CR 字节', !fs.readFileSync(path.join(ROOT, '一键更新汉化.command')).includes(0x0d), true);
  check('运行汉化.sh 为纯 LF 无 CR 字节', !fs.readFileSync(path.join(ROOT, '运行汉化.sh')).includes(0x0d), true);
  check('generate-release-assets ITEMS_TO_ZIP 包含 app.asar.ready 与 src 且排除 extracted',
    ITEMS_TO_ZIP.includes('app.asar.ready') && ITEMS_TO_ZIP.includes('src') && !ITEMS_TO_ZIP.includes('extracted'),
    true
  );
  check('extractChangelogSection 动态提取 v2.32.2.1 更新日志章节',
    extractChangelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8'), '2.32.2.1').matchedExact,
    true
  );

  const updateBodyRun = spawnSync(process.execPath, [path.join(ROOT, 'release-assets', 'update-release-body.js')], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 10000,
  });
  check('update-release-body.js 无 --tag 参数严格拦截退出 (exit=1)', updateBodyRun.status, 1);

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  check('index.html 移除 Google Fonts 外链并集成 CSRF meta 与弹窗串行队列',
    !indexHtml.includes('fonts.googleapis.com') &&
    indexHtml.includes('meta name="localizer-csrf"') &&
    indexHtml.includes('confirmModalQueue') &&
    indexHtml.includes('X-Localizer-Token'),
    true
  );

  console.log(`\n======================================================`);
  console.log(`Ticket-43 综合验收结果: ${passed}/${total} 断言通过`);
  console.log(`======================================================`);

  if (passed !== total) {
    process.exit(1);
  }
})();
