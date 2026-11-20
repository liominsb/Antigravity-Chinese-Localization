'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { DOM_TRANSLATOR_INJECTION } = require('./src/build-injection');
const { createReleaseManager } = require('./release-manager');
const { createPackageInstaller } = require('./package-installer');
const { withInstallLock } = require('./src/install-lock');
const { isAppRunningStrict, stopAntigravityProcesses } = require('./process-check');
const { readAsarPackageVersion } = require('./asar-version');
const { findValidOfficialBackup, normalizeVersion } = require('./src/backup-utils');
const {
  httpError,
  isValidLoopbackHostHeader,
  verifySameOriginAndToken,
  readJsonBody,
  createAsyncWriteLock,
  sanitizeSingleSegmentUsername,
} = require('./src/http-security');
const {
  isLocalizedAsar,
  checkClientStatus,
  executeAutoRestore,
  hashFile,
  findAvailablePatch,
} = require('./auto-restore');

const CURRENT_VERSION = '2.33.0';
const RELEASE_VERSION = '2.33.0'; // 补丁发版追踪号；CURRENT_VERSION 保持与目标客户端及 app.asar.ready 一致

function compareVersions(v1, v2) {
  const parse = (v) => {
    const clean = String(v || '').trim().replace(/^[vV]/, '');
    const [core, prerelease = ''] = clean.split('-', 2);
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    return { nums, prerelease };
  };
  const p1 = parse(v1);
  const p2 = parse(v2);
  const maxLen = Math.max(p1.nums.length, p2.nums.length);
  for (let i = 0; i < maxLen; i++) {
    const a = p1.nums[i] || 0;
    const b = p2.nums[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && !p2.prerelease) return -1;
  if (p1.prerelease && p2.prerelease && p1.prerelease !== p2.prerelease) {
    return p1.prerelease > p2.prerelease ? 1 : -1;
  }
  return 0;
}

const PORT = parseInt(process.env.PORT || '3388', 10) || 3388;
const HOST_BIND = '127.0.0.1';
const WORKSPACE_DIR = __dirname;
const EXTRACT_DIR = path.join(WORKSPACE_DIR, 'extracted');
const CSRF_TOKEN = crypto.randomBytes(24).toString('hex');
const MAX_LOGS = 500;
const ASAR_PACKAGE_SPEC = '@electron/asar@3.2.18';
const writeLock = createAsyncWriteLock();

const releaseManager = createReleaseManager({
  workspaceDir: WORKSPACE_DIR,
  securityToken: CSRF_TOKEN,
});
const packageInstaller = createPackageInstaller({
  workspaceDir: WORKSPACE_DIR,
  releaseManager,
  getAppDir,
  getResourcesDir,
  isAppRunning: isAppRunningStrict,
  stopProcesses: killApp,
  securityToken: CSRF_TOKEN,
  writeLock,
});

let logs = [];

function log(msg) {
  const time = new Date().toLocaleTimeString();
  const formatted = `[${time}] ${msg}`;
  if (logs.length >= MAX_LOGS) {
    logs.shift();
  }
  logs.push(formatted);
  console.log(formatted);
}

function getHostUsername() {
  try {
    const info = os.userInfo();
    if (info && typeof info.username === 'string' && info.username.trim()) {
      return info.username.trim();
    }
  } catch (_) {}
  return process.env.USER || process.env.USERNAME || path.basename(os.homedir()) || 'user';
}

function getAsarCmd() {
  return `npx --yes ${ASAR_PACKAGE_SPEC}`;
}

function resolveCachedAsarCliJs() {
  try {
    return require.resolve('@electron/asar/bin/asar.js');
  } catch (_) {}

  const cacheRoots = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    cacheRoots.push(path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
  }
  cacheRoots.push(path.join(os.homedir(), '.npm', '_npx'));

  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const dirs = fs.readdirSync(root);
      for (const d of dirs) {
        const cliCandidate = path.join(root, d, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
        if (fs.existsSync(cliCandidate)) {
          return cliCandidate;
        }
      }
    } catch (_) {}
  }
  return null;
}

function runAsarCli(asarArgs) {
  const cachedCli = resolveCachedAsarCliJs();
  if (cachedCli) {
    execFileSync(process.execPath, [cachedCli, ...asarArgs], {
      cwd: WORKSPACE_DIR,
      stdio: 'pipe',
      timeout: 180000,
    });
    return;
  }

  const nodeDir = path.dirname(process.execPath);
  const npxCliCandidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  for (const npxCli of npxCliCandidates) {
    if (fs.existsSync(npxCli)) {
      execFileSync(process.execPath, [npxCli, '--yes', ASAR_PACKAGE_SPEC, ...asarArgs], {
        cwd: WORKSPACE_DIR,
        stdio: 'pipe',
        timeout: 180000,
      });
      return;
    }
  }

  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npxBin, ['--yes', ASAR_PACKAGE_SPEC, ...asarArgs], {
    cwd: WORKSPACE_DIR,
    stdio: 'pipe',
    timeout: 180000,
    shell: process.platform === 'win32',
  });
}

// Check if Antigravity processes are running (delegates to unified strict process checker)
function isAppRunning() {
  try {
    return isAppRunningStrict();
  } catch (_) {
    return false;
  }
}

// Kill Antigravity processes and its language_server background processes
function killApp() {
  log('正在尝试关闭运行中的 Antigravity 2.0 及相关后台进程...');
  try {
    stopAntigravityProcesses();
    log('已成功强制解除 Antigravity 及其语言服务器进程占用！');
  } catch (e) {
    log('Antigravity 未在运行或关闭时遇到异常: ' + e.message);
    throw e;
  }
}

async function stopAndWaitAppExit(timeoutMs = 5000) {
  killApp();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let running = false;
    try {
      running = isAppRunningStrict();
    } catch (err) {
      throw new Error('无法确认 Antigravity 进程是否已完全退出: ' + err.message);
    }
    if (!running) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (isAppRunningStrict()) {
    throw new Error('关闭 Antigravity 进程超时，文件仍被占用，已中止写入以保护客户端完整性。');
  }
}

function assertNotSymlinkOrJunction(targetPath, label = '目标路径') {
  if (!fs.existsSync(targetPath)) return;
  const st = fs.lstatSync(targetPath);
  if (st.isSymbolicLink()) {
    throw httpError(`${label}不允许使用符号链接或目录联接: ${targetPath}`, 400);
  }
}

// 安全清理 Antigravity 客户端的渲染与编译缓存（不删除用户配置与账号）
function cleanAppCache(username) {
  log('正在扫描并安全清理 Antigravity 临时渲染与编译缓存...');
  const defaultUser = getHostUsername();
  const cleanUser = sanitizeSingleSegmentUsername(username, { allowEmpty: true });
  const user = cleanUser || defaultUser;
  const isDefaultUser = !cleanUser || cleanUser.toLowerCase() === defaultUser.toLowerCase();
  let cacheRootDirs = [];

  if (process.platform === 'win32') {
    if (isDefaultUser && (process.env.APPDATA || process.env.LOCALAPPDATA)) {
      const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      cacheRootDirs = [
        path.join(roaming, 'Antigravity'),
        path.join(roaming, 'antigravity'),
        path.join(local, 'antigravity'),
      ];
    } else {
      cacheRootDirs = [
        path.join('C:\\Users', user, 'AppData', 'Roaming', 'Antigravity'),
        path.join('C:\\Users', user, 'AppData', 'Roaming', 'antigravity'),
        path.join('C:\\Users', user, 'AppData', 'Local', 'antigravity'),
      ];
    }
  } else if (process.platform === 'darwin') {
    const homeBase = isDefaultUser ? os.homedir() : path.join('/Users', user);
    cacheRootDirs = [
      path.join(homeBase, 'Library', 'Application Support', 'Antigravity'),
      path.join(homeBase, 'Library', 'Caches', 'com.google.antigravity'),
    ];
  } else {
    const homeBase = isDefaultUser ? os.homedir() : path.join('/home', user);
    cacheRootDirs = [
      path.join(homeBase, '.config', 'Antigravity'),
      path.join(homeBase, '.cache', 'antigravity'),
    ];
  }

  const targetSubDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage'];
  let cleanedCount = 0;

  const uniqueRoots = [...new Set(cacheRootDirs)];
  for (const root of uniqueRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      if (fs.lstatSync(root).isSymbolicLink()) continue;
    } catch (_) {
      continue;
    }
    for (const sub of targetSubDirs) {
      const fullPath = path.join(root, sub);
      if (fs.existsSync(fullPath)) {
        try {
          if (fs.lstatSync(fullPath).isSymbolicLink()) {
            log(`跳过符号链接目录: ${sub}`);
            continue;
          }
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleanedCount++;
          log(`已清理临时缓存: ${sub} (${root})`);
        } catch (_) {
          log(`缓存正在占用中已跳过: ${sub}`);
        }
      }
    }
  }
  log(`缓存安全清理完成，共清理 ${cleanedCount} 处临时目录。建议重新启动软件。`);
  return cleanedCount;
}

// Compute standard app directory based on dynamic username or custom path input
function getAppDir(username, useDefault, customPath) {
  let dir = '';
  const isCustom = (useDefault === false || useDefault === 'false');
  if (isCustom && customPath !== undefined && customPath !== null && String(customPath).trim() !== '') {
    if (typeof customPath !== 'string') {
      throw httpError('自定义路径参数格式无效', 400);
    }
    const trimmed = customPath.trim();
    if (trimmed.includes('\0')) {
      throw httpError('安装路径包含非法空字节', 400);
    }
    if (/^\\\\/.test(trimmed) || /^\/\//.test(trimmed)) {
      throw httpError('不允许使用远程网络共享路径 (UNC)', 400);
    }
    dir = path.resolve(trimmed);
  } else {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const defaultUser = getHostUsername();
    const cleanUser = sanitizeSingleSegmentUsername(username, { allowEmpty: true });
    const user = cleanUser || defaultUser;
    const isDefaultUser = !cleanUser || cleanUser.toLowerCase() === defaultUser.toLowerCase();

    if (isWin) {
      const localAppData = isDefaultUser && process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity')
        : '';
      const userProfileCandidate = path.join('C:\\Users', user, 'AppData', 'Local', 'Programs', 'antigravity');
      if (localAppData && (fs.existsSync(localAppData) || !fs.existsSync(userProfileCandidate))) {
        dir = localAppData;
      } else {
        dir = userProfileCandidate;
      }
    } else if (isMac) {
      dir = '/Applications/Antigravity.app/Contents';
    } else {
      const homeCandidate = isDefaultUser ? path.join(os.homedir(), 'Antigravity', 'Antigravity-x64') : '';
      const explicitCandidate = `/home/${user}/Antigravity/Antigravity-x64`;
      dir = (homeCandidate && (fs.existsSync(homeCandidate) || !fs.existsSync(explicitCandidate)))
        ? homeCandidate
        : explicitCandidate;
    }
  }

  if (process.platform === 'darwin') {
    if (dir.endsWith('.app')) {
      dir = path.join(dir, 'Contents');
    } else if (dir.endsWith('.app/')) {
      dir = path.join(dir.slice(0, -1), 'Contents');
    }
  }
  return dir;
}

// 智能检测 Resources 目录大小写（macOS .app 包使用大写 Resources，Windows/Linux 使用小写 resources）
function getResourcesDir(appDir) {
  const upperPath = path.join(appDir, 'Resources');
  const lowerPath = path.join(appDir, 'resources');
  if (fs.existsSync(upperPath)) return upperPath;
  if (fs.existsSync(lowerPath)) return lowerPath;
  return process.platform === 'darwin' ? upperPath : lowerPath;
}

// Helper to replace text in file cleanly (idempotent)
function replaceInFile(filePath, target, replacement) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到要修改的文件: ${filePath}`);
  }
  let content = fs.readFileSync(filePath, 'utf-8');
  if (replacement.includes(target) && content.includes(replacement)) {
    log(`文件 ${path.basename(filePath)} 已经应用过此汉化修改，跳过。`);
    return;
  }
  if (!content.includes(target)) {
    if (content.includes(replacement)) {
      log(`文件 ${path.basename(filePath)} 已经应用过此汉化修改，跳过。`);
    } else {
      log(`提示：文件 ${path.basename(filePath)} 未找到匹配目标内容，跳过。`);
    }
    return;
  }
  content = content.split(target).join(replacement);
  fs.writeFileSync(filePath, content, 'utf-8');
  log(`已成功修改 ${path.basename(filePath)}`);
}

// Perform localization modification operations on extracted files
function applyTranslations(targetExtractDir = EXTRACT_DIR) {
  log('开始对解压的文件进行汉化替换和代码注入...');

  function injectOrUpdate(filePath, content, startMarker, desc) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`找不到要修改的文件: ${filePath}`);
    }
    let existing = fs.readFileSync(filePath, 'utf-8');
    const markerIndex = existing.indexOf(startMarker);
    if (markerIndex !== -1) {
      existing = existing.substring(0, markerIndex).trimEnd() + '\n\n' + content;
      fs.writeFileSync(filePath, existing, 'utf-8');
      log(`已更新 ${path.basename(filePath)} 中的 ${desc} 为最新版本。`);
    } else {
      fs.appendFileSync(filePath, '\n\n' + content, 'utf-8');
      log(`已向 ${path.basename(filePath)} 注入 ${desc}。`);
    }
  }

  // 1. Localize & Inject DOM Localization in dist/preload.js
  const preloadPath = path.join(targetExtractDir, 'dist', 'preload.js');
  // Patch official preload SSH fallback error before appending/updating the injected DOM engine
  if (fs.existsSync(preloadPath)) {
    const rawPreload = fs.readFileSync(preloadPath, 'utf-8');
    const markerIdx = rawPreload.indexOf('// Antigravity 2.0 Chinese Localization Engine');
    const headPart = markerIdx !== -1 ? rawPreload.slice(0, markerIdx) : rawPreload;
    const tailPart = markerIdx !== -1 ? rawPreload.slice(markerIdx) : '';
    const enSshFallback = 'message: "Couldn\'t connect to the SSH host. See the app log.",';
    const zhSshFallback = 'message: "无法连接到 SSH 主机。请查看应用日志。",';
    if (headPart.includes(enSshFallback)) {
      fs.writeFileSync(preloadPath, headPart.split(enSshFallback).join(zhSshFallback) + tailPart, 'utf-8');
      log('已成功修改 preload.js (SSH 错误提示)');
    }
  }
  injectOrUpdate(preloadPath, DOM_TRANSLATOR_INJECTION, '// Antigravity 2.0 Chinese Localization Engine', 'Web UI 实时汉化引擎');

  // 2. Inject DOM Localization in dist/ideInstall/wizardPreload.js
  const wizardPreloadPath = path.join(targetExtractDir, 'dist', 'ideInstall', 'wizardPreload.js');
  injectOrUpdate(wizardPreloadPath, DOM_TRANSLATOR_INJECTION, '// Antigravity 2.0 Chinese Localization Engine', '新版向导 Web UI 汉化引擎');

  // 3. Localize dist/menu.js (Native Application Menu)
  const menuPath = path.join(targetExtractDir, 'dist', 'menu.js');
  const menuInjectCode = `
const menuTranslationMap = {
  'File': '文件',
  'Edit': '编辑',
  'View': '视图',
  'Window': '窗口',
  'Help': '帮助',
  'New Window': '新建窗口',
  'Docs': '使用文档',
  'Toggle Developer Tools': '开发者工具',
  'Check for Updates': '检查更新',
  'Checking for Updates...': '正在检查更新...',
  'Downloading Update...': '正在下载更新...',
  'Restart to Update': '重启以应用更新',
  'Undo': '撤销',
  'Redo': '重做',
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Select All': '全选',
  'Minimize': '最小化',
  'Close': '关闭',
  'Quit Antigravity': '退出 Antigravity',
  'About Antigravity': '关于 Antigravity',
  'Services': '服务',
  'Hide Antigravity': '隐藏 Antigravity',
  'Hide Others': '隐藏其他',
  'Show All': '显示全部',
  'Force Reload': '强制重新加载',
  'Reload': '重新加载',
  'Actual Size': '实际大小',
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'Toggle Full Screen': '切换全屏',
  'Toggle Fullscreen': '切换全屏',
  'Reset Zoom': '重置缩放',
  'New Conversation': '新建对话',
  'Create Project': '创建项目',
  'New Project': '新建项目',
  'Create New Project': '创建新项目',
  'Open Project': '打开项目',
  'Command Palette': '命令面板',
  'Split': '分屏',
  'Split Right': '向右分屏',
  'Split Down': '向下分屏',
  'Split Left': '向左分屏',
  'Split Up': '向上分屏',
  'Replace With New': '替换为新建',
  'Replace with New': '替换为新建',
  'Replace with new': '替换为新建',
  'Remove From Split': '从分屏中移除',
  'Remove from Split': '从分屏中移除',
  'Split Terminal': '拆分终端',
  'Split Conversation Vertically': '垂直分屏对话',
  'Split Conversation Horizontally': '水平分屏对话',
  'Equalize Split Panes': '均分分屏窗格',
  'Fork': '派生',
  'Fork Conversation': '派生对话',
  'Connect to WSL': '连接到 WSL',
  'Reopen Locally': '本地重新打开',
  'Automations': '自动化',
  'Automation': '自动化',
  'Give Feedback': '提供反馈',
  'Provide Feedback': '提供反馈',
  // 顶置对话与排序菜单
  'Sort By': '排序方式',
  'Sort by': '排序方式',
  'Last Updated': '最近更新',
  'Last Prompt': '最新提示词',
  'Custom Order': '自定义排序',
  'Quote': '引用',
  'Quote Ctrl+L': '引用 Ctrl+L',
  'Quote Cmd+L': '引用 Cmd+L',

  // 顶层与二级右键子菜单 (v2.32.1 补充)
  'Conversation Name': '对话名称',
  'Conversation ID': '对话 ID',
  'Project Name': '项目名称',
  'Project Path': '项目路径',
  'Workspace Name': '工作区名称',
  'Workspace Path': '工作区路径',
  'Worktree Name': '工作树名称',
  'Conversation Path': '对话路径',
  'Ask /btw': '通过 /btw 提问',
  // 侧边栏标签页、文件查看器、媒体与链接右键菜单补充
  'Close Tab': '关闭标签页',
  'Close Other Tabs': '关闭其他标签页',
  'Close Tabs to the Left': '关闭左侧标签页',
  'Close Tabs to the Right': '关闭右侧标签页',
  'Close All Tabs': '关闭全部标签页',
  'Close Terminal Tab': '关闭终端标签页',
  'Keep Open': '保持打开',
  'Pin Tab': '固定标签页',
  'Unpin Tab': '取消固定标签页',
  'Reopen Closed Tab': '重新打开已关闭的标签页',
  'Open in Tab': '在标签页中打开',
  'Open in New Tab': '在新标签页中打开',
  'Open in New Window': '在新窗口中打开',
  'Open in Side Panel': '在侧边栏中打开',
  'Open in Built-in Browser': '在内置浏览器中打开',
  'Open in External Browser': '在外部浏览器中打开',
  'Open Link in New Tab': '在新标签页中打开链接',
  'Open Link in External Browser': '在外部浏览器中打开链接',
  'Open Image in New Tab': '在新标签页中打开图片',
  'Open Conversation in New Tab': '在新标签页中打开对话',
  'Open In': '打开方式',
  'Side Panel': '侧边栏',
  'Built-in Browser': '内置浏览器',
  'External Browser': '外部浏览器',
  'Link Settings': '链接设置',
  'Copy Image': '复制图片',
  'Copy Image Address': '复制图片地址',
  'Copy Link Address': '复制链接地址',
  'Copy Message': '复制消息',
  'Save Image': '保存图片',
  'Save Video': '保存视频',
  'Undo to Here': '撤销到此处',
  'Edit Shortcut': '编辑快捷键',
  'Add Shortcut': '添加快捷键',
  'Remove Shortcut': '移除快捷键',
  'Reset to Default': '重置为默认',
  'Move to Group': '移动到分组',
  'New Group': '新建分组',
  'Rename Group': '重命名分组',
  'Delete Group': '删除分组',
  'Move Up': '上移',
  'Move Down': '下移',
  'Remove from Group': '从分组中移除',
  'Delete Permanently': '永久删除',
  'Proceed with Plan': '按计划继续',
  // 2.32.2 新增菜单与分屏/远程操作
  'Copy Conversation Markdown': '复制对话 Markdown',
  'Pin This Conversation': '置顶此对话',
  'Unpin This Conversation': '取消置顶此对话',
  'Rename This Conversation': '重命名此对话',
  'Copy Trajectory ID': '复制轨迹 ID',
  'Copy Config File Path': '复制配置文件路径',
  'Remove from Recent': '从最近记录中移除',
  'Find References': '查找引用',
  'Open on phone': '在手机上打开',
  'Open on another device': '在其他设备上打开',
  'Coordinator settings': '协调器设置',
  // 2.33.0 新增菜单、Computer Use 虚拟机控制、SSH 远程操作与组合包
  'Interrupt Agent': '中断智能体',
  'Disconnect': '断开连接',
  'Stop Server': '停止服务端',
  'Stop SSH Server': '停止 SSH 服务端',
  'Stop SSH Server…': '停止 SSH 服务端…',
  'Restart SSH Server': '重启 SSH 服务端',
  'SSH Host…': 'SSH 主机…',
  'SSH Host...': 'SSH 主机...',
  'Connect to SSH Host': '连接到 SSH 主机',
  'Connect to SSH Host…': '连接到 SSH 主机…',
  'Side Question Selection': '针对所选内容发起侧边提问',
  'Quote Selection': '引用所选内容',
  'Open in Code Search': '在代码搜索中打开',
  'Comment on Selection': '针对所选内容添加评论',
  'Switch to This Computer': '切换到本机',
  'This Computer': '本机',
  'Toggle Virtual Machine': '切换虚拟机面板',
  'Agents': '智能体',
  'Screen Recording': '屏幕录制',
  'Add bundle': '添加组合包',
  'Remove bundle': '移除组合包',
  'Terminal: Select All': '终端：全选',
  'Terminal: Add to Chat': '终端：添加到对话',
  'Maximize': '最大化',
  'Delete Hook': '删除钩子',
  'Add Hook Card': '添加钩子卡片',
  'Delete Handler': '删除处理程序',
};
function translateMenu(menuItem) {
  if (menuItem.label && menuTranslationMap[menuItem.label]) {
    menuItem.label = menuTranslationMap[menuItem.label];
  }
  if (menuItem.submenu) {
    if (menuItem.submenu.items) {
      menuItem.submenu.items.forEach(translateMenu);
    } else if (Array.isArray(menuItem.submenu)) {
      menuItem.submenu.forEach(translateMenu);
    }
  }
}
`;
  injectOrUpdate(menuPath, menuInjectCode, 'const menuTranslationMap = {', '原生菜单翻译映射');

  replaceInFile(
    menuPath,
    'const submenuItem = appMenu.items.find((item) => item.label === submenuLabel);',
    'const submenuItem = appMenu.items.find((item) => item.label === submenuLabel || (typeof menuTranslationMap !== "undefined" && item.label === menuTranslationMap[submenuLabel]));'
  );
  replaceInFile(
    menuPath,
    "const viewMenuItem = appMenu.items?.find((item) => item.label === 'View');",
    "const viewMenuItem = appMenu.items?.find((item) => item.label === 'View' || item.label === '视图');"
  );
  replaceInFile(
    menuPath,
    'electron_1.Menu.setApplicationMenu(menu);',
    `if (typeof translateMenu === 'function') { menu.items.forEach(translateMenu); } electron_1.Menu.setApplicationMenu(menu);`
  );

  // 4. Localize dist/tray.js (Native System Tray + Async WSL/Reopen items)
  const trayPath = path.join(targetExtractDir, 'dist', 'tray.js');
  replaceInFile(
    trayPath,
    `countItem.label =
                (count > 0 ? \`\${count}\` : 'No') +
                    ' agent' +
                    (count === 1 ? '' : 's') +
                    ' running';`,
    `countItem.label = count > 0 ? \`\${count} 个智能体运行中\` : '没有智能体在运行';`
  );
  replaceInFile(
    trayPath,
    `contextMenu = electron_1.Menu.buildFromTemplate(actions);`,
    `const translatedActions = actions.map(action => {
        if (action.label === 'No agents running') action.label = '没有智能体在运行';
        if (action.label && action.label.startsWith('Open ')) action.label = '打开 Antigravity';
        if (action.label === 'Quit') action.label = '退出';
        return action;
    });
    contextMenu = electron_1.Menu.buildFromTemplate(translatedActions);`
  );
  replaceInFile(
    trayPath,
    '    contextMenu.insert(Math.min(position, contextMenu.items.length), new electron_1.MenuItem(options));',
    `    if (options && typeof options === 'object') {
        if (options.label === 'Connect to WSL') options = { ...options, label: '连接到 WSL' };
        else if (options.label === 'Reopen Locally') options = { ...options, label: '在本地重新打开' };
    }
    contextMenu.insert(Math.min(position, contextMenu.items.length), new electron_1.MenuItem(options));`
  );

  // 5. Localize dist/loadingOverlay.js (Legacy splash text guard — v2.32.2+ uses textless SVG logo)
  const loadingOverlayPath = path.join(targetExtractDir, 'dist', 'loadingOverlay.js');
  if (fs.existsSync(loadingOverlayPath)) {
    const overlayContent = fs.readFileSync(loadingOverlayPath, 'utf-8');
    if (overlayContent.includes('<div class="text">Loading Antigravity</div>')) {
      replaceInFile(
        loadingOverlayPath,
        '<div class="text">Loading Antigravity</div>',
        '<div class="text">正在加载 Antigravity...</div>'
      );
    }
  }

  // 6. Localize dist/provisionSplash.js (WSL Provision Splash Screen)
  const splashPath = path.join(targetExtractDir, 'dist', 'provisionSplash.js');
  if (fs.existsSync(splashPath)) {
    replaceInFile(
      splashPath,
      '<div>Setting up WSL: ${escapeHtml(distro)}</div>',
      '<div>正在配置 WSL: ${escapeHtml(distro)}</div>'
    );
    replaceInFile(
      splashPath,
      "document.getElementById('status').textContent = ${JSON.stringify(text)}",
      "document.getElementById('status').textContent = ${JSON.stringify(typeof text === 'string' ? (text.includes('Downloading the Antigravity binary') ? '正在下载 Antigravity 二进制组件…' : (text.startsWith('Installing into ') ? text.replace('Installing into ', '正在安装到 ') : text)) : text)}"
    );
  }

  // 7. Localize dist/ipcHandlers.js (Workspace/Download Dialogs & WSL Alerts & Native Context Menu)
  const ipcPath = path.join(targetExtractDir, 'dist', 'ipcHandlers.js');
  if (fs.existsSync(ipcPath)) {
    replaceInFile(ipcPath, "title: 'Open workspace',", "title: '打开工作区',");
    replaceInFile(ipcPath, "title: 'Open workspaces',", "title: '打开工作区',");
    replaceInFile(ipcPath, "title: 'Select Download Folder',", "title: '选择下载文件夹',");
    replaceInFile(ipcPath, "electron_1.dialog.showErrorBox('Cannot open folder', t.error);", "electron_1.dialog.showErrorBox('无法打开文件夹', t.error);");
    replaceInFile(ipcPath, "message: 'Folder is on the Windows filesystem',", "message: '文件夹位于 Windows 文件系统中',");

    const contextMenuInject = `
const contextMenuTranslationMap = {
  // 基础剪贴板与选择
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Select All': '全选',
  'Undo': '撤销',
  'Redo': '重做',
  'Delete': '删除',

  // 内置浏览器 Webview 与窗格导航菜单
  'Comment': '评论',
  'Back': '后退',
  'Forward': '前进',
  'Reload': '重新加载',
  'Go Back': '后退',
  'Go Forward': '前进',
  'Add to Chat': '添加到对话',
  'Find in Pane': '在窗格中查找',
  'Split Terminal': '拆分终端',
  'Kill Terminal': '终止终端',
  'Settings': '设置',

  // 项目与工作区右键菜单（项目文件夹）
  'Copy Project Name': '复制项目名称',
  'Copy Project Path': '复制项目路径',
  'Project Settings': '项目设置',
  'Delete Project': '删除项目',
  'Rename Project': '重命名项目',
  'Open Project': '打开项目',
  'Open Folder': '打开文件夹',
  'New Folder': '新建文件夹',
  'Remove Project': '移除项目',
  'Remove from List': '从列表中移除',
  'Project options': '项目选项',

  // 对话列表与分组右键菜单
  'New Conversation': '新建对话',
  'Fork': '派生',
  'Fork Conversation': '派生对话',
  'Rename': '重命名',
  'Rename Group': '重命名分组',
  'Move Up': '上移',
  'Move Down': '下移',
  'Delete Group': '删除分组',
  'Restore': '恢复',
  'View Debug': '查看调试信息',
  'Telemetry': '遥测',
  'Pin': '置顶',
  'Unpin': '取消置顶',
  'Auto Pin': '自动置顶',
  'Mark Unread': '标为未读',
  'Mark Read': '标为已读',
  'Mark as Unread': '标为未读',
  'Mark as Read': '标为已读',
  'Split': '拆分',
  'Split Conversation': '拆分对话',
  'Stop': '停止',
  'Stop Agent': '停止智能体',
  'Resume': '恢复',
  'Restart': '重新启动',
  'Close': '关闭',
  'Close Others': '关闭其他',
  'Close All': '全部关闭',
  'Copy Path': '复制路径',
  'Copy Relative Path': '复制相对路径',
  'Reveal in File Explorer': '在文件资源管理器中显示',
  'Reveal in Finder': '在访达中显示',
  'Open in Terminal': '在终端中打开',
  'View Usage': '查看使用额度',
  'Duplicate': '创建副本',
  'Archive': '归档',
  'Archive Conversation': '归档对话',
  'Unarchive': '取消归档',
  'Unarchive Conversation': '取消归档对话',
  'Share': '分享',
  'Copy Link': '复制链接',
  'Export': '导出',
  'Export Conversation': '导出对话',
  'Clear': '清除',
  'Clear History': '清除历史',
  'Automations': '自动化',
  'Automation': '自动化',
  'Give Feedback': '提供反馈',
  'Provide Feedback': '提供反馈',
  // 顶置对话与排序菜单
  'Sort By': '排序方式',
  'Sort by': '排序方式',
  'Last Updated': '最近更新',
  'Last Prompt': '最新提示词',
  'Custom Order': '自定义排序',
  'Quote': '引用',
  'Quote Ctrl+L': '引用 Ctrl+L',
  'Quote Cmd+L': '引用 Cmd+L',

  // 顶层与二级右键子菜单 (v2.32.1 补充)
  'Conversation Name': '对话名称',
  'Conversation ID': '对话 ID',
  'Project Name': '项目名称',
  'Project Path': '项目路径',
  'Workspace Name': '工作区名称',
  'Workspace Path': '工作区路径',
  'Worktree Name': '工作树名称',
  'Conversation Path': '对话路径',
  'Split Right': '向右分屏',
  'Split Down': '向下分屏',
  'Split Left': '向左分屏',
  'Split Up': '向上分屏',
  'Replace with New': '替换为新建',
  'Replace With New': '替换为新建',
  'Replace with new': '替换为新建',
  'Ask /btw': '通过 /btw 提问',
  // 侧边栏标签页、文件查看器、媒体与链接右键菜单补充
  'Close Tab': '关闭标签页',
  'Close Other Tabs': '关闭其他标签页',
  'Close Tabs to the Left': '关闭左侧标签页',
  'Close Tabs to the Right': '关闭右侧标签页',
  'Close All Tabs': '关闭全部标签页',
  'Close Terminal Tab': '关闭终端标签页',
  'Keep Open': '保持打开',
  'Pin Tab': '固定标签页',
  'Unpin Tab': '取消固定标签页',
  'Reopen Closed Tab': '重新打开已关闭的标签页',
  'Open in Tab': '在标签页中打开',
  'Open in New Tab': '在新标签页中打开',
  'Open in New Window': '在新窗口中打开',
  'Open in Side Panel': '在侧边栏中打开',
  'Open in Built-in Browser': '在内置浏览器中打开',
  'Open in External Browser': '在外部浏览器中打开',
  'Open Link in New Tab': '在新标签页中打开链接',
  'Open Link in External Browser': '在外部浏览器中打开链接',
  'Open Image in New Tab': '在新标签页中打开图片',
  'Open Conversation in New Tab': '在新标签页中打开对话',
  'Open In': '打开方式',
  'Side Panel': '侧边栏',
  'Built-in Browser': '内置浏览器',
  'External Browser': '外部浏览器',
  'Link Settings': '链接设置',
  'Copy Image': '复制图片',
  'Copy Image Address': '复制图片地址',
  'Copy Link Address': '复制链接地址',
  'Copy Message': '复制消息',
  'Save Image': '保存图片',
  'Save Video': '保存视频',
  'Undo to Here': '撤销到此处',
  'Edit Shortcut': '编辑快捷键',
  'Add Shortcut': '添加快捷键',
  'Remove Shortcut': '移除快捷键',
  'Reset to Default': '重置为默认',
  'Move to Group': '移动到分组',
  'New Group': '新建分组',
  'Remove from Group': '从分组中移除',
  'Delete Permanently': '永久删除',
  'Proceed with Plan': '按计划继续',
  // 2.32.2 新增上下文菜单与分屏/远程操作
  'Copy Conversation Markdown': '复制对话 Markdown',
  'Pin This Conversation': '置顶此对话',
  'Unpin This Conversation': '取消置顶此对话',
  'Rename This Conversation': '重命名此对话',
  'Copy Trajectory ID': '复制轨迹 ID',
  'Copy Config File Path': '复制配置文件路径',
  'Remove From Split': '从分屏中移除',
  'Remove from Split': '从分屏中移除',
  'Remove from Recent': '从最近记录中移除',
  'Find References': '查找引用',
  'Open on phone': '在手机上打开',
  'Open on another device': '在其他设备上打开',
  'Coordinator settings': '协调器设置',
  // 2.33.0 新增菜单、Computer Use 虚拟机控制、SSH 远程操作与组合包
  'Interrupt Agent': '中断智能体',
  'Disconnect': '断开连接',
  'Stop Server': '停止服务端',
  'Stop SSH Server': '停止 SSH 服务端',
  'Stop SSH Server…': '停止 SSH 服务端…',
  'Restart SSH Server': '重启 SSH 服务端',
  'SSH Host…': 'SSH 主机…',
  'SSH Host...': 'SSH 主机...',
  'Connect to SSH Host': '连接到 SSH 主机',
  'Connect to SSH Host…': '连接到 SSH 主机…',
  'Side Question Selection': '针对所选内容发起侧边提问',
  'Quote Selection': '引用所选内容',
  'Open in Code Search': '在代码搜索中打开',
  'Comment on Selection': '针对所选内容添加评论',
  'Switch to This Computer': '切换到本机',
  'This Computer': '本机',
  'Toggle Virtual Machine': '切换虚拟机面板',
  'Agents': '智能体',
  'Screen Recording': '屏幕录制',
  'Add bundle': '添加组合包',
  'Remove bundle': '移除组合包',
  'Terminal: Select All': '终端：全选',
  'Terminal: Add to Chat': '终端：添加到对话',
  'Maximize': '最大化',
  'Delete Hook': '删除钩子',
  'Add Hook Card': '添加钩子卡片',
  'Delete Handler': '删除处理程序',
};
function translateContextLabel(lbl) {
  if (!lbl) return '';
  const trimmed = typeof lbl === 'string' ? lbl.trim() : '';
  if (contextMenuTranslationMap[lbl]) return contextMenuTranslationMap[lbl];
  if (contextMenuTranslationMap[trimmed]) return contextMenuTranslationMap[trimmed];
  if (/\\s+\\(Default\\)$/i.test(trimmed)) {
    const base = trimmed.replace(/\\s+\\(Default\\)$/i, '').trim();
    if (contextMenuTranslationMap[base]) return contextMenuTranslationMap[base] + '（默认）';
    const openMatch = base.match(/^Open in\\s+(.+)$/i);
    if (openMatch) return '在 ' + openMatch[1] + ' 中打开（默认）';
  }
  let m = trimmed.match(/^Move to Group:\\s*(.+)$/i);
  if (m) return '移动到分组：' + m[1];
  m = trimmed.match(/^Remove\\s+(.+)\\s+from Recent$/i);
  if (m) return '从最近记录中移除 ' + m[1];
  m = trimmed.match(/^Hide\\s+(.+)\\s+from this list$/i);
  if (m) return '从此列表中隐藏 ' + m[1];
  m = trimmed.match(/^Show\\s+(.+)\\s+in the list again$/i);
  if (m) return '在列表中重新显示 ' + m[1];
  m = trimmed.match(/^Open in\\s+(.+)$/i);
  if (m) return '在 ' + m[1] + ' 中打开';
  return lbl;
}
`;
    injectOrUpdate(ipcPath, contextMenuInject, 'const contextMenuTranslationMap = {', '原生上下文菜单翻译映射');
    replaceInFile(ipcPath, "label: item.label ?? '',", "label: (typeof translateContextLabel === 'function' ? translateContextLabel(item.label) : item.label) ?? '',");
  }

  // 8. Localize dist/wsl.js (WSL Path Mappings & Status Messages)
  const wslPath = path.join(targetExtractDir, 'dist', 'wsl.js');
  if (fs.existsSync(wslPath)) {
    replaceInFile(
      wslPath,
      "warning: 'This folder is on the Windows filesystem. Accessing it from WSL (via /mnt) can be slow — for best performance keep projects inside the WSL filesystem.',",
      "warning: '此文件夹位于 Windows 文件系统。从 WSL 访问（通过 /mnt）可能较慢 — 为获得最佳性能，建议将项目保留在 WSL 文件系统中。',"
    );
    replaceInFile(
      wslPath,
      "error: `This folder belongs to the WSL distro \"${unc[1]}\", but this window is connected to \"${distro}\".`,",
      "error: `此文件夹属于 WSL 发行版 \"${unc[1]}\"，但当前窗口连接到 \"${distro}\"。`,"
    );
    replaceInFile(
      wslPath,
      "error: `This location cannot be opened in WSL: ${winPath}`",
      "error: `无法在 WSL 中打开此位置: ${winPath}`"
    );
    replaceInFile(
      wslPath,
      "onStatus?.('Downloading the Antigravity binary\\u2026');",
      "onStatus?.('正在下载 Antigravity 二进制组件\\u2026');"
    );
    replaceInFile(
      wslPath,
      "onStatus?.(`Installing into ${distro}\\u2026`);",
      "onStatus?.(`正在安装到 ${distro}\\u2026`);"
    );
  }

  // 9. Localize dist/main.js (Startup & WSL Warnings)
  const mainPath = path.join(targetExtractDir, 'dist', 'main.js');
  if (fs.existsSync(mainPath)) {
    replaceInFile(mainPath, "title: 'WSL distro not found',", "title: '未找到 WSL 发行版',");
    replaceInFile(mainPath, "message: `The WSL distro \"${WSL_DISTRO}\" is no longer installed.`,", "message: `WSL 发行版 \"${WSL_DISTRO}\" 已不再安装。`,");
    replaceInFile(mainPath, "detail: 'Antigravity opened on Windows instead.',", "detail: 'Antigravity 已改为在 Windows 本地打开。',");
    replaceInFile(mainPath, "await electron_1.dialog.showErrorBox('WSL setup failed', msg);", "await electron_1.dialog.showErrorBox('WSL 配置失败', msg);");
    replaceInFile(mainPath, "await electron_1.dialog.showErrorBox('Startup failed', msg);", "await electron_1.dialog.showErrorBox('启动失败', msg);");
    replaceInFile(mainPath, "await electron_1.dialog.showErrorBox('Binary not found', msg);", "await electron_1.dialog.showErrorBox('未找到核心二进制组件', msg);");
    replaceInFile(mainPath, "title: 'Confirm Quit',", "title: '确认退出',");
    replaceInFile(mainPath, "message: 'Are you sure you want to quit?',", "message: '您确定要退出吗？',");
    replaceInFile(mainPath, "detail: 'There may be agents or background tasks running.',", "detail: '可能还有智能体或后台任务正在运行。',");
    replaceInFile(mainPath, "buttons: ['Cancel', 'Quit'],", "buttons: ['取消', '退出'],");
    replaceInFile(mainPath, "label: 'New Window',", "label: '新建窗口',");
  }

  // 9.1. Localize dist/webauthn.js (Passkey 账户选择对话框)
  const webAuthnPath = path.join(targetExtractDir, 'dist', 'webauthn.js');
  if (fs.existsSync(webAuthnPath)) {
    replaceInFile(webAuthnPath, "title: 'Choose a Passkey',", "title: '选择通行密钥',");
    replaceInFile(webAuthnPath, "message: `Sign in to ${rpLabel}`,", "message: `登录到 ${rpLabel}`,");
    replaceInFile(webAuthnPath, "detail: 'Select a passkey account to continue:',", "detail: '请选择一个通行密钥账户以继续：',");
    replaceInFile(webAuthnPath, "buttons: [...accountLabels, 'Cancel'],", "buttons: [...accountLabels, '取消'],");
    replaceInFile(webAuthnPath, "const rpLabel = details.relyingPartyId || 'this site';", "const rpLabel = details.relyingPartyId || '此站点';");
    replaceInFile(webAuthnPath, "return `Account ${index + 1}`;", "return `账户 ${index + 1}`;");
  }

  // 9.2. Localize dist/cablev2.js (Passkey 二维码弹窗与底部按钮)
  const cableV2Path = path.join(targetExtractDir, 'dist', 'cablev2.js');
  if (fs.existsSync(cableV2Path)) {
    replaceInFile(cableV2Path, '<title>Passkeys</title>', '<title>通行密钥</title>');
    replaceInFile(cableV2Path, '<h1 class="sheet-title">Passkeys</h1>', '<h1 class="sheet-title">通行密钥</h1>');
    replaceInFile(cableV2Path, '<p class="mechanism-header">Use your phone or tablet</p>', '<p class="mechanism-header">使用你的手机或平板</p>');
    replaceInFile(cableV2Path, '<p id="status" class="mechanism-desc">Scan this QR code with the camera on the device that has your passkey for ${safeRpId}</p>', '<p id="status" class="mechanism-desc">用存有 ${safeRpId} 通行密钥的设备相机扫描此二维码</p>');
    replaceInFile(cableV2Path, '<button type="button" class="cancel-btn" onclick="window.close()">Cancel</button>', '<button type="button" class="cancel-btn" onclick="window.close()">取消</button>');
    replaceInFile(cableV2Path, "title: 'Passkeys',", "title: '通行密钥',");
    replaceInFile(cableV2Path, "modal?.updateStatus('Connecting to your device…');", "modal?.updateStatus('正在连接你的设备…');");
    replaceInFile(cableV2Path, "modal?.updateStatus('Verify on your device to continue…');", "modal?.updateStatus('请在你的设备上验证以继续…');");
  }

  // 10. Localize dist/updater.js (Update Notifications, Dialogs & macOS Menu State Machine)
  const updaterPath = path.join(targetExtractDir, 'dist', 'updater.js');
  if (fs.existsSync(updaterPath)) {
    replaceInFile(updaterPath, "title: 'Check for Updates',", "title: '检查更新',");
    replaceInFile(updaterPath, "message: 'No updates available',", "message: '当前已是最新版本，暂无可用更新。',");
    replaceInFile(updaterPath, "buttons: ['OK'],", "buttons: ['确定'],");
    replaceInFile(
      updaterPath,
      `exports.updateActions = {
    [MenuUpdateStep.CheckForUpdates]: () => checkForUpdates(true),
    [MenuUpdateStep.CheckingForUpdates]: undefined,
    [MenuUpdateStep.DownloadingUpdate]: undefined,
    [MenuUpdateStep.RestartToUpdate]: () => quitAndInstall(),
};`,
      `const MENU_UPDATE_STEP_LABELS = {
    [MenuUpdateStep.CheckForUpdates]: '检查更新',
    [MenuUpdateStep.CheckingForUpdates]: '正在检查更新...',
    [MenuUpdateStep.DownloadingUpdate]: '正在下载更新...',
    [MenuUpdateStep.RestartToUpdate]: '重启以应用更新',
};
exports.updateActions = {
    [MenuUpdateStep.CheckForUpdates]: () => checkForUpdates(true),
    '检查更新': () => checkForUpdates(true),
    [MenuUpdateStep.CheckingForUpdates]: undefined,
    '正在检查更新...': undefined,
    [MenuUpdateStep.DownloadingUpdate]: undefined,
    '正在下载更新...': undefined,
    [MenuUpdateStep.RestartToUpdate]: () => quitAndInstall(),
    '重启以应用更新': () => quitAndInstall(),
};`
    );
    replaceInFile(
      updaterPath,
      `            item.label = step;
            item.enabled = exports.updateActions[step] !== undefined;`,
      `            item.label = (typeof MENU_UPDATE_STEP_LABELS !== 'undefined' && MENU_UPDATE_STEP_LABELS[step]) || step;
            item.enabled = exports.updateActions[step] !== undefined;`
    );
  }

  // 11. Localize dist/ideInstall/wizardHtml.js (IDE Install Wizard Static Template)
  const wizardHtmlPath = path.join(targetExtractDir, 'dist', 'ideInstall', 'wizardHtml.js');
  if (fs.existsSync(wizardHtmlPath)) {
    replaceInFile(wizardHtmlPath, '<title>Welcome to Antigravity</title>', '<title>欢迎使用 Antigravity</title>');
    replaceInFile(wizardHtmlPath, 'Setting up…', '正在配置…');
    replaceInFile(wizardHtmlPath, '<h1>Welcome to the new Antigravity!</h1>', '<h1>欢迎使用全新 Antigravity！</h1>');
    replaceInFile(
      wizardHtmlPath,
      "<p>Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named <b>Antigravity IDE</b>.</p>",
      "<p>Antigravity 经过全面重构，赋予智能体更强大的原生能力。如果您仍需要代码编辑器，可单独下载独立应用 <b>Antigravity IDE</b>。</p>"
    );
    replaceInFile(wizardHtmlPath, '<span>Download the Antigravity IDE</span>', '<span>下载 Antigravity IDE</span>');
    replaceInFile(wizardHtmlPath, '<button class="btn-primary" id="btn-skip">Explore the new Antigravity</button>', '<button class="btn-primary" id="btn-skip">探索全新 Antigravity</button>');
  }

  // 12. Localize dist/deviceChooser.js (WebHID/WebUSB/WebSerial 设备选择原生弹窗完整汉化)
  const deviceChooserPath = path.join(targetExtractDir, 'dist', 'deviceChooser.js');
  if (fs.existsSync(deviceChooserPath)) {
    replaceInFile(deviceChooserPath, "hid: 'HID device',", "hid: 'HID 设备',");
    replaceInFile(deviceChooserPath, "usb: 'USB device',", "usb: 'USB 设备',");
    replaceInFile(deviceChooserPath, "serial: 'serial port',", "serial: '串行端口',");
    replaceInFile(deviceChooserPath, "'Unknown device'", "'未知设备'");
    replaceInFile(deviceChooserPath, "title: 'Connect a device',", "title: '连接设备',");
    replaceInFile(deviceChooserPath, "message: `${origin} wants to connect to a ${KIND_NOUNS[kind]}`,", "message: `${origin} 请求连接 ${KIND_NOUNS[kind]}`,");
    replaceInFile(
      deviceChooserPath,
      `                        detail: cancelId
                            ? 'Select a device:'
                            : 'No compatible devices found.',`,
      `                        detail: cancelId
                            ? '请选择设备：'
                            : '未找到兼容设备。',`
    );
    replaceInFile(deviceChooserPath, "buttons: [...snapshot.map(({ label }) => label), 'Cancel'],", "buttons: [...snapshot.map(({ label }) => label), '取消'],");
  }

  // 13. Localize dist/webviewPopupSecurity.js (Webview 连接信息弹窗与证书详情完整汉化)
  const webviewSecurityPath = path.join(targetExtractDir, 'dist', 'webviewPopupSecurity.js');
  if (fs.existsSync(webviewSecurityPath)) {
    replaceInFile(webviewSecurityPath, "insecure: 'Not secure',", "insecure: '不安全',");
    replaceInFile(webviewSecurityPath, "dangerous: '⚠ Not secure',", "dangerous: '⚠ 不安全',");
    replaceInFile(webviewSecurityPath, "'Your connection to this site is not secure',", "'您与此网站的连接不安全',");
    replaceInFile(
      webviewSecurityPath,
      `    'You should not enter any sensitive information on this site (for ' +
        'example, passwords or credit cards), because it could be stolen by ' +
        'attackers.',`,
      `    '请勿在此网站输入任何敏感信息（例如密码或信用卡信息），否则可能会被攻击者窃取。',`
    );
    replaceInFile(webviewSecurityPath, "'Connection is secure',", "'连接安全',");
    replaceInFile(
      webviewSecurityPath,
      `        'Your information (for example, passwords or credit card numbers) is ' +
            'private when it is sent to this site.',`,
      `        '您的信息（例如密码或信用卡号）在发送到此网站时受隐私保护。',`
    );
    replaceInFile(webviewSecurityPath, "'Connection security information is not available for this page'", "'无法获取此页面的连接安全信息'");
    replaceInFile(webviewSecurityPath, "return ms > 0 ? new Date(ms).toLocaleString() : 'unknown';", "return ms > 0 ? new Date(ms).toLocaleString() : '未知';");
    replaceInFile(webviewSecurityPath, "lines.push('', state.level === 'secure' ? 'Certificate is valid' : 'Certificate details');", "lines.push('', state.level === 'secure' ? '证书有效' : '证书详情');");
    replaceInFile(webviewSecurityPath, "lines.push(`Error: ${state.certificateError}`);", "lines.push(`错误：${state.certificateError}`);");
    replaceInFile(
      webviewSecurityPath,
      "lines.push(`Issued to: ${certificate.subjectName}`, `Issued by: ${certificate.issuer}`, `Valid from: ${formatDate(certificate.validFromMs)}`, `Valid until: ${formatDate(certificate.validToMs)}`);",
      "lines.push(`颁发给：${certificate.subjectName}`, `颁发者：${certificate.issuer}`, `有效期自：${formatDate(certificate.validFromMs)}`, `有效期至：${formatDate(certificate.validToMs)}`);"
    );
    replaceInFile(webviewSecurityPath, "lines.push(`Protocol: ${certificate.protocol}`);", "lines.push(`协议：${certificate.protocol}`);");
    replaceInFile(webviewSecurityPath, "message: extractOrigin(state.url) ?? (state.url || 'This page'),", "message: extractOrigin(state.url) ?? (state.url || '此页面'),");
    replaceInFile(webviewSecurityPath, "{ role: 'cut', enabled: canCut },", "{ role: 'cut', label: '剪切', enabled: canCut },");
    replaceInFile(webviewSecurityPath, "{ role: 'copy', enabled: canCopy },", "{ role: 'copy', label: '复制', enabled: canCopy },");
    replaceInFile(webviewSecurityPath, "{ role: 'paste', enabled: canPaste },", "{ role: 'paste', label: '粘贴', enabled: canPaste },");
    replaceInFile(webviewSecurityPath, "{ role: 'selectAll', enabled: canSelectAll },", "{ role: 'selectAll', label: '全选', enabled: canSelectAll },");
    replaceInFile(webviewSecurityPath, "label: 'Connection info…',", "label: '连接信息…',");
    replaceInFile(webviewSecurityPath, "title: 'Connection info',", "title: '连接信息',");
    replaceInFile(webviewSecurityPath, "buttons: ['OK'],", "buttons: ['确定'],");
  }

  // 14. Localize dist/remote/disconnectedPage.js (Remote SSH 断开/重连/重启过渡页)
  const disconnectedPagePath = path.join(targetExtractDir, 'dist', 'remote', 'disconnectedPage.js');
  if (fs.existsSync(disconnectedPagePath)) {
    replaceInFile(
      disconnectedPagePath,
      `const BUTTON_LABELS = {
    reconnect: 'Reconnect',
    stop: 'Stop Server',
    close: 'Close',
};`,
      `const BUTTON_LABELS = {
    reconnect: '重新连接',
    stop: '停止服务端',
    close: '关闭',
};`
    );
    replaceInFile(
      disconnectedPagePath,
      `    const title = restarting
        ? 'Restarting…'
        : connecting
            ? 'Reconnecting…'
            : 'Disconnected';`,
      `    const title = restarting
        ? '正在重启…'
        : connecting
            ? '正在重新连接…'
            : '已断开连接';`
    );
    replaceInFile(
      disconnectedPagePath,
      `    const heading = restarting
        ? \`Restarting the Antigravity server on \${host}…\`
        : connecting
            ? \`Reconnecting to \${host}…\`
            : \`Disconnected from \${host}\`;`,
      `    const heading = restarting
        ? \`正在重启 \${host} 上的 Antigravity 服务端…\`
        : connecting
            ? \`正在重新连接到 \${host}…\`
            : \`已断开与 \${host} 的连接\`;`
    );
    replaceInFile(
      disconnectedPagePath,
      `    const body = restarting
        ? 'This window opens it again once it has started.'
        : connecting
            ? page.serverStopped
                ? \`Its server on \${host} stopped, and its agents with it.\`
                : \`Agents keep running on \${host}.\`
            : page.serverStopped
                ? \`Its agents on \${host} stopped with it.\`
                : \`Agents keep running on \${host} unless its server stopped.\`;`,
      `    const body = restarting
        ? '服务端启动完成后，此窗口将自动重新打开。'
        : connecting
            ? page.serverStopped
                ? \`\${host} 上的服务端已停止，其智能体也已随之停止。\`
                : \`智能体将在 \${host} 上继续运行。\`
            : page.serverStopped
                ? \`\${host} 上的智能体已随服务端一同停止。\`
                : \`智能体将在 \${host} 上继续运行（除非其服务端已停止）。\`;`
    );
  }

  // 15. Localize dist/remote/sshPrompts.js (Remote SSH 凭据、主机指纹与安全密钥弹窗)
  const sshPromptsPath = path.join(targetExtractDir, 'dist', 'remote', 'sshPrompts.js');
  if (fs.existsSync(sshPromptsPath)) {
    replaceInFile(sshPromptsPath, "const TOUCH_TITLE = 'Touch your security key';", "const TOUCH_TITLE = '请轻触你的安全密钥';");
    replaceInFile(sshPromptsPath, "(who) => (isAccount(who) ? ['Password', who] : undefined),", "(who) => (isAccount(who) ? ['密码', who] : undefined),");
    replaceInFile(sshPromptsPath, "(who) => (isAccount(who) ? ['Current password', who] : undefined),", "(who) => (isAccount(who) ? ['当前密码', who] : undefined),");
    replaceInFile(sshPromptsPath, "(who) => (isAccount(who) ? ['New password', who] : undefined),", "(who) => (isAccount(who) ? ['新密码', who] : undefined),");
    replaceInFile(sshPromptsPath, "(who) => (isAccount(who) ? ['Confirm new password', who] : undefined),", "(who) => (isAccount(who) ? ['确认新密码', who] : undefined),");
    replaceInFile(sshPromptsPath, '["Enter passphrase for key \'", "\':", (key) => [\'Passphrase\', baseName(key)]],', '["Enter passphrase for key \'", "\':", (key) => [\'密钥口令\', baseName(key)]],');
    replaceInFile(sshPromptsPath, "return ['PIN', what.slice(1, -1)];", "return ['PIN 码', what.slice(1, -1)];");
    replaceInFile(sshPromptsPath, "return key < 0 ? undefined : ['PIN', baseName(what.slice(key + 5))];", "return key < 0 ? undefined : ['PIN 码', baseName(what.slice(key + 5))];");
    replaceInFile(sshPromptsPath, "? `Trust ${hostName(host.split(' (')[0])}?`", "? `信任主机 ${hostName(host.split(' (')[0])}？`");
    replaceInFile(sshPromptsPath, "? `Connect to ${hostName(host)} anyway?`", "? `仍要连接到 ${hostName(host)}？`");
    replaceInFile(sshPromptsPath, "return 'Accept updated host keys?';", "return '接受更新后的主机密钥？';");
    replaceInFile(sshPromptsPath, "return key ? `Add ${baseName(key.split(' (')[0])} to ssh-agent?` : undefined;", "return key ? `将密钥 ${baseName(key.split(' (')[0])} 添加到 ssh-agent？` : undefined;");
    replaceInFile(
      sshPromptsPath,
      `function wordedTitle(kind, text, who) {
    if (kind === 'confirm') {
        return \`Question from \${who}\`;
    }
    if (CODE_WORDS.test(text)) {
        return \`Verification code for \${who}\`;
    }
    if (/password/i.test(text)) {
        return \`Password for \${who}\`;
    }
    return /\\bpin\\b/i.test(text) ? \`PIN for \${who}\` : \`Sign in to \${who}\`;
}`,
      `function wordedTitle(kind, text, who) {
    if (kind === 'confirm') {
        return \`来自 \${who} 的询问\`;
    }
    if (CODE_WORDS.test(text)) {
        return \`\${who} 的验证码\`;
    }
    if (/password/i.test(text)) {
        return \`\${who} 的密码\`;
    }
    return /\\bpin\\b/i.test(text) ? \`\${who} 的 PIN 码\` : \`登录到 \${who}\`;
}`
    );
    replaceInFile(
      sshPromptsPath,
      "? `${asked[0]} for ${hostPromptsMarked ? asked[1] : label}`",
      "? `${hostPromptsMarked ? asked[1] : label} 的${asked[0]}`"
    );
    replaceInFile(sshPromptsPath, '<p class="context">Connecting to <span id="label"></span></p>', '<p class="context">正在连接到 <span id="label"></span></p>');
    replaceInFile(sshPromptsPath, '<div id="retry" class="note" hidden>Asked again: your last answer may not have worked.</div>', '<div id="retry" class="note" hidden>再次提示：上一次输入的密码或凭据可能不正确。</div>');
    replaceInFile(sshPromptsPath, '<div id="long" class="note" role="alert" hidden>That\'s too long.</div>', '<div id="long" class="note" role="alert" hidden>内容过长。</div>');
    replaceInFile(sshPromptsPath, '<div class="buttons"><button id="cancel" class="secondary">Cancel</button><button id="continue" class="primary">Continue</button></div>', '<div class="buttons"><button id="cancel" class="secondary">取消</button><button id="continue" class="primary">继续</button></div>');
    replaceInFile(sshPromptsPath, "buttons: confirm ? ['Yes', 'No'] : ['Cancel'],", "buttons: confirm ? ['是', '否'] : ['取消'],");
  }

  // 16. Legacy guard: dist/remote/sshPromptPreload.js (v2.33.0 moved prompt title logic to sshPrompts.js)
  const sshPromptPreloadPath = path.join(targetExtractDir, 'dist', 'remote', 'sshPromptPreload.js');
  if (fs.existsSync(sshPromptPreloadPath)) {
    const sshPreloadRaw = fs.readFileSync(sshPromptPreloadPath, 'utf-8');
    if (sshPreloadRaw.includes('asks.textContent = `${label} asks:`;')) {
      replaceInFile(sshPromptPreloadPath, "asks.textContent = `${label} asks:`;", "asks.textContent = `${label} 询问：`;");
    }
  }

  // 17. Localize dist/remote/remoteManager.js (Remote SSH 主机管理、共享主目录接管与服务端重启弹窗完整汉化)
  const remoteManagerPath = path.join(targetExtractDir, 'dist', 'remote', 'remoteManager.js');
  if (fs.existsSync(remoteManagerPath)) {
    replaceInFile(remoteManagerPath, "title: 'SSH connection failed',", "title: 'SSH 连接失败',");
    replaceInFile(remoteManagerPath, "this.reportError(err, entry.label, 'Sign-in failed', win);", "this.reportError(err, entry.label, '登录失败', win);");
    replaceInFile(remoteManagerPath, "this.reportError(err, entry.label, 'Could not stop the SSH server', win);", "this.reportError(err, entry.label, '无法停止 SSH 服务端', win);");
    replaceInFile(remoteManagerPath, "title: 'Choose an SSH config file',", "title: '选择 SSH 配置文件',");
    replaceInFile(remoteManagerPath, "title: 'Stop SSH server',", "title: '停止 SSH 服务端',");
    replaceInFile(remoteManagerPath, "message: `Stop the Antigravity server on ${entry.label}?`,", "message: `停止 ${entry.label} 上的 Antigravity 服务端？`,");
    replaceInFile(
      remoteManagerPath,
      `                    detail: 'Agents running on this host will stop and its window will close. ' +
                        'The server starts again the next time you connect.',`,
      `                    detail: '在此主机上运行的智能体将停止，且其窗口将关闭。下次连接时服务端将重新启动。',`
    );
    replaceInFile(remoteManagerPath, "buttons: ['Stop Server', 'Cancel'],", "buttons: ['停止服务端', '取消'],");
    replaceInFile(remoteManagerPath, "message: `Not connected to ${label}`,", "message: `未连接到 ${label}`,");
    replaceInFile(remoteManagerPath, "detail: 'Reconnect first, then stop its server.',", "detail: '请先重新连接，然后再停止其服务端。',");
    replaceInFile(remoteManagerPath, "buttons: ['Sign In', 'Cancel'],", "buttons: ['登录', '取消'],");
    replaceInFile(remoteManagerPath, "title: 'Sign in',", "title: '登录',");
    replaceInFile(remoteManagerPath, "message: `Sign in to your organization for ${entry.label}?`,", "message: `为 ${entry.label} 登录到您的组织？`,");
    replaceInFile(
      remoteManagerPath,
      `            detail: 'Continue only if you just chose to sign in with your organization ' +
                \`in this window. \${entry.label} will get access to your \` +
                "organization's Google Cloud account.\\n" +
                (names
                    ? \`Workforce pool: \${names[1]}  Provider: \${names[2]}\`
                    : \`Identity provider: \${provider}\`),`,
      `            detail: '仅当您刚刚在此窗口中选择使用组织账号登录时才继续。' +
                \`\${entry.label} 将获得您组织的 Google Cloud 账户访问权限。\\n\` +
                (names
                    ? \`员工池：\${names[1]}  提供商：\${names[2]}\`
                    : \`身份提供商：\${provider}\`),`
    );
    replaceInFile(
      remoteManagerPath,
      "this.onDisconnected(entry, conn, new types_1.RemoteError('CONNECTION_CLOSED', `${entry.label} didn't answer after this computer woke up.`, { retryable: true }));",
      "this.onDisconnected(entry, conn, new types_1.RemoteError('CONNECTION_CLOSED', `本机唤醒后 ${entry.label} 未响应。`, { retryable: true }));"
    );
    replaceInFile(
      remoteManagerPath,
      "detail: `${problem.why[0].toUpperCase()}${problem.why.slice(1)}. ${problem.fix}`,",
      "detail: `${problem.why[0].toUpperCase()}${problem.why.slice(1)}。${problem.fix}`,"
    );
    replaceInFile(
      remoteManagerPath,
      "message: `${name} can't be the SSH config file`,",
      "message: `无法将 ${name} 用作 SSH 配置文件`,"
    );
    replaceInFile(remoteManagerPath, "title: 'Choose another SSH config file',", "title: '选择其他 SSH 配置文件',");
    replaceInFile(remoteManagerPath, "buttons: ['Choose Another File…', 'Cancel'],", "buttons: ['选择其他文件…', '取消'],");
    replaceInFile(remoteManagerPath, "title: 'Could not restart the SSH server',", "title: '无法重启 SSH 服务端',");
    replaceInFile(remoteManagerPath, "message: `${entry.label} still runs Antigravity server ${running}.`,", "message: `${entry.label} 仍在运行 Antigravity 服务端 ${running}。`,");
    replaceInFile(remoteManagerPath, "buttons: ['Allow', \"Don't Allow\"],", "buttons: ['允许', '不允许'],");
    replaceInFile(remoteManagerPath, "title: 'Microphone access',", "title: '麦克风访问权限',");
    replaceInFile(remoteManagerPath, "message: `Allow ${label} to use your microphone?`,", "message: `允许 ${label} 使用您的麦克风吗？`,");
    replaceInFile(
      remoteManagerPath,
      `            detail: \`The page in this window comes from \${label}. If you allow it, that \` +
                "host can use this computer's microphone for voice whenever one of " +
                'its windows is open. Antigravity asks again after you quit it.',`,
      `            detail: \`此窗口中的页面来自 \${label}。如果允许，只要该主机的任一窗口处于打开状态，该主机即可使用本机的麦克风进行语音交互。退出 Antigravity 后将重新询问。\`,`
    );
    replaceInFile(remoteManagerPath, "buttons: ['Continue', 'Cancel'],", "buttons: ['继续', '取消'],");
    replaceInFile(remoteManagerPath, "message: `Finish this sign-in on ${entry.label}?`,", "message: `在 ${entry.label} 上完成此次登录？`,");
    replaceInFile(
      remoteManagerPath,
      `            detail: \`Continue only if you just chose to sign in from the \${entry.label} \` +
                'window. Your browser opens the sign-in page; once you sign in, ' +
                \`\${entry.label} gets access to that account.\\n\` +
                \`Sign-in page: \${(0, types_1.sanitizeRemoteText)(new URL(origin).host, 200)}\`,`,
      `            detail: \`仅当您刚刚在 \${entry.label} 窗口中发起登录时才继续。您的浏览器将打开登录页面；完成登录后，\${entry.label} 将获得该账户的访问权限。\\n\` +
                \`登录页面：\${(0, types_1.sanitizeRemoteText)(new URL(origin).host, 200)}\`,`
    );
    replaceInFile(
      remoteManagerPath,
      `function takeOverSheet({ label, lastServerPid }, { host, here, pid, state }, onHostWindow) {
    const live = state === 'live';
    const own = live && pid === lastServerPid && onHostWindow;
    return {
        type: 'warning',
        buttons: ['Take Over', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Shared home directory',
        message: own
            ? \`This window's Antigravity server runs on \${host}, another machine that shares your home directory.\`
            : live
                ? \`Your Antigravity server runs on \${host}, another machine that shares your home directory.\`
                : \`\${host}, another machine that shares your home directory, started your Antigravity server.\`,
        detail: own
            ? \`\${label} reached \${here} this time. Cancel and reconnect to try again for \${host}, or take over to stop the server on \${host}, and its agents, and run it on \${here} instead.\`
            : live
                ? \`\${label} reached \${here}. Take over to stop the server on \${host}, and its agents, and run it on \${here} instead. To keep it running, connect to \${host}.\`
                : \`\${label} reached \${here}. Take over only if that server no longer runs, for example if \${host} was shut down or replaced: if it still runs, both servers would write the same files. To check, connect to \${host}.\`,
    };
}`,
      `function takeOverSheet({ label, lastServerPid }, { host, here, pid, state }, onHostWindow) {
    const live = state === 'live';
    const own = live && pid === lastServerPid && onHostWindow;
    return {
        type: 'warning',
        buttons: ['接管', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: '共享主目录冲突',
        message: own
            ? \`此窗口对应的 Antigravity 服务端正在与您共享主目录的另一台机器 \${host} 上运行。\`
            : live
                ? \`您的 Antigravity 服务端正在与您共享主目录的另一台机器 \${host} 上运行。\`
                : \`与您共享主目录的另一台机器 \${host} 启动了您的 Antigravity 服务端。\`,
        detail: own
            ? \`本次 \${label} 连接到了 \${here}。点击“取消”并重新连接可再次尝试连接 \${host}；或选择“接管”以停止 \${host} 上的服务端及其智能体，并改为在 \${here} 上运行。\`
            : live
                ? \`\${label} 连接到了 \${here}。选择“接管”将停止 \${host} 上的服务端及其智能体，并改为在 \${here} 上运行。若要保持其继续运行，请直接连接到 \${host}。\`
                : \`\${label} 连接到了 \${here}。请仅在确认原服务端已停止运行（例如 \${host} 已关机或被替换）时才选择“接管”：若原服务端仍在运行，两个服务端将同时写入同一批文件。如需核实，请连接到 \${host}。\`,
    };
}`
    );
    replaceInFile(
      remoteManagerPath,
      `function restartSheet(label, { server, terminals }, expected) {
    const running = (0, types_1.sanitizeRemoteText)(server.version, 64);
    // Any may run agents, tasks or jobs: the LS doesn't say which.
    const what = terminals === 0 ? 'agent or task' : 'agent, task or terminal';
    return {
        type: 'question',
        buttons: ['Restart', 'Later'],
        // Shows by itself: a Return meant for the page mustn't restart.
        defaultId: 1,
        cancelId: 1,
        title: 'Restart SSH server',
        message: \`\${label} is running server \${running}; this app is \${expected}. Restart the server now?\`,
        detail: \`Any \${what} still running on it stops. The server starts again with this app's version.\`,
    };
}`,
      `function restartSheet(label, { server, terminals }, expected) {
    const running = (0, types_1.sanitizeRemoteText)(server.version, 64);
    // Any may run agents, tasks or jobs: the LS doesn't say which.
    const what = terminals === 0 ? '智能体或后台任务' : '智能体、后台任务或终端会话';
    return {
        type: 'question',
        buttons: ['立即重启', '稍后'],
        // Shows by itself: a Return meant for the page mustn't restart.
        defaultId: 1,
        cancelId: 1,
        title: '重启 SSH 服务端',
        message: \`\${label} 当前运行的服务端版本为 \${running}，而本应用版本为 \${expected}。是否立即重启服务端？\`,
        detail: \`其上仍在运行的任何\${what}都将停止，随后服务端将以本应用的版本重新启动。\`,
    };
}`
    );
  }

  // 18. Localize dist/remote/sshArgs.js (Remote SSH 全部错误码与架构提示)
  const sshArgsPath = path.join(targetExtractDir, 'dist', 'remote', 'sshArgs.js');
  if (fs.existsSync(sshArgsPath)) {
    replaceInFile(sshArgsPath, "throw new types_1.RemoteError('INVALID_DESTINATION', 'Invalid SSH config file.');", "throw new types_1.RemoteError('INVALID_DESTINATION', 'SSH 配置文件无效。');");
    replaceInFile(sshArgsPath, "exports.LINUX_HOST_NEEDED = 'Antigravity needs a Linux host on x64 or arm64 with glibc 2.26 or newer.';", "exports.LINUX_HOST_NEEDED = 'Antigravity 需要搭载 glibc 2.26 或更新版本的 Linux x64 或 arm64 系统。';");
    replaceInFile(sshArgsPath, "return `Couldn't connect to the SSH host (${String(code)}).`;", "return `无法连接到 SSH 主机 (${String(code)})。`;");
    replaceInFile(sshArgsPath, "yes: 'SSH authentication failed. Check your password, code or keys, then try again.',", "yes: 'SSH 身份验证失败。请检查密码、动态验证码或密钥，然后重试。',");
    replaceInFile(sshArgsPath, "onReconnect: 'SSH authentication failed. Click Reconnect to sign in again.',", "onReconnect: 'SSH 身份验证失败。请点击重新连接以再次登录。',");
    replaceInFile(sshArgsPath, 'no: "SSH authentication failed. Antigravity can\'t answer password or code prompts on Windows yet: set up key-based login with ssh-agent, then try again.",', 'no: "SSH 身份验证失败。Antigravity 暂不支持在 Windows 下响应密码或动态码交互提示：请通过 ssh-agent 配置密钥免密登录后重试。",');
    replaceInFile(sshArgsPath, "case 'INVALID_DESTINATION':\n            return \"That SSH host isn't valid. Enter an alias from your SSH config or a host like user@host or user@host:2222.\";", "case 'INVALID_DESTINATION':\n            return \"该 SSH 主机地址无效。请输入 SSH 配置中的别名或类似 user@host、user@host:2222 的格式。\";");
    replaceInFile(
      sshArgsPath,
      `        case 'HOSTKEY_REJECTED':
            return prompts === 'no'
                ? "The host's SSH key is unknown or has changed. Save it with ssh in a terminal. If it changed, ask the host's owner first: the connection may be intercepted."
                : "The host's SSH key has changed or isn't trusted. If it changed, ask the host's owner first: the connection may be intercepted.";`,
      `        case 'HOSTKEY_REJECTED':
            return prompts === 'no'
                ? "该主机的 SSH 密钥未知或已发生变更。请在终端中使用 ssh 连接并保存它。如果密钥发生了变更，请先向主机管理员核实：连接可能遭到拦截。"
                : "该主机的 SSH 密钥已发生变更或不受信任。如果密钥发生了变更，请先向主机管理员核实：连接可能遭到拦截。";`
    );
    replaceInFile(
      sshArgsPath,
      "        case 'CONNECTION_FAILED':\n            return `Couldn't connect to the SSH host. Check its name, your network and ssh config (e.g. a ProxyCommand), and that ssh to it works in a terminal${prompts === 'no' ? ' without a prompt' : ''}.`;",
      "        case 'CONNECTION_FAILED':\n            return `无法连接到 SSH 主机。请检查主机名、网络连接与 ssh 配置（例如 ProxyCommand），并确认在终端中可${prompts === 'no' ? '免交互提示地' : ''}通过 ssh 正常连接。`;"
    );
    replaceInFile(
      sshArgsPath,
      "        case 'SSH_CONFIG_INVALID':\n            return \"SSH can't use your SSH config file. Fix the problem ssh reports, or choose another config file.\";",
      "        case 'SSH_CONFIG_INVALID':\n            return \"SSH 无法使用您的 SSH 配置文件。请修复 ssh 报告的问题，或选择其他配置文件。\";"
    );
    replaceInFile(sshArgsPath, "case 'FORWARDING_PROHIBITED':\n            return 'SSH port forwarding failed. Make sure the server allows TCP forwarding (AllowTcpForwarding) for your account, then try again.';", "case 'FORWARDING_PROHIBITED':\n            return 'SSH 端口转发失败。请确认服务端已允许您的账户进行 TCP 转发 (AllowTcpForwarding)，然后重试。';");
    replaceInFile(
      sshArgsPath,
      "        case 'UNSUPPORTED_HOST':\n            return `The SSH host isn't supported. ${exports.LINUX_HOST_NEEDED} Windows and macOS hosts aren't supported yet.`;",
      "        case 'UNSUPPORTED_HOST':\n            return `该 SSH 主机不受支持。${exports.LINUX_HOST_NEEDED}暂不支持 Windows 和 macOS 主机。`;"
    );
    replaceInFile(
      sshArgsPath,
      "        case 'SHARED_HOME_UNSUPPORTED':\n            return 'Another host that shares your home directory runs the Antigravity server. Connect to that host, or connect again and choose Take Over.';",
      "        case 'SHARED_HOME_UNSUPPORTED':\n            return '与此主目录共享的另一台主机正在运行 Antigravity 服务端。请改为连接该主机，或重新连接并选择“接管”。';"
    );
    replaceInFile(sshArgsPath, "case 'INSTALL_FAILED':\n            return \"Couldn't install the Antigravity server on the SSH host. Make sure it has free disk space, and that it or this computer can download from the internet.\";", "case 'INSTALL_FAILED':\n            return \"无法在 SSH 主机上安装 Antigravity 服务端。请确认该主机磁盘空间充足，且该主机或本计算机能够访问互联网下载。\";");
    replaceInFile(
      sshArgsPath,
      "        case 'LS_START_FAILED':\n            return `The Antigravity server failed to start on the SSH host. See its log in ~/${types_1.REMOTE_INSTALL_ROOT}/data on that host.`;",
      "        case 'LS_START_FAILED':\n            return `SSH 主机上的 Antigravity 服务端启动失败。请查看该主机上 ~/${types_1.REMOTE_INSTALL_ROOT}/data 目录中的日志。`;"
    );
    replaceInFile(sshArgsPath, "case 'LS_STOPPED':\n            return 'The Antigravity server on the SSH host stopped. Reconnect to start it again.';", "case 'LS_STOPPED':\n            return 'SSH 主机上的 Antigravity 服务端已停止。请重新连接以启动它。';");
    replaceInFile(sshArgsPath, "case 'CONNECTION_CLOSED':\n            return 'The SSH connection closed. Check your network connection, then reconnect.';", "case 'CONNECTION_CLOSED':\n            return 'SSH 连接已断开。请检查网络连接后重新连接。';");
    replaceInFile(sshArgsPath, "case 'CANCELLED':\n            return 'The connection was cancelled.';", "case 'CANCELLED':\n            return '连接已取消。';");
    replaceInFile(
      sshArgsPath,
      "        case 'UNKNOWN':\n            return \"Couldn't connect to the SSH host. Try ssh to it in a terminal, and see the Antigravity log for details.\";",
      "        case 'UNKNOWN':\n            return \"无法连接到 SSH 主机。请尝试在终端中使用 ssh 连接，并查看 Antigravity 日志了解详情。\";"
    );
  }

  // 19. Localize dist/remote/sshErrorText.js (独立错误详情拼装模块)
  const sshErrorTextPath = path.join(targetExtractDir, 'dist', 'remote', 'sshErrorText.js');
  if (fs.existsSync(sshErrorTextPath)) {
    replaceInFile(sshErrorTextPath, "return `Error code: ${err.code}\\nLogs: ${logPath()}`;", "return `错误代码：${err.code}\\n日志：${logPath()}`;");
    replaceInFile(sshErrorTextPath, "return err.reportedByRemote ? `${label} reported: ${text}` : text;", "return err.reportedByRemote ? `${label} 报告：${text}` : text;");
    replaceInFile(sshErrorTextPath, ": 'The connection was closed before it finished.';", ": '连接在完成前已关闭。';");
    replaceInFile(sshErrorTextPath, "return `Windows SSH hosts aren't supported yet. ${sshArgs_1.LINUX_HOST_NEEDED}`;", "return `暂不支持 Windows SSH 主机。${sshArgs_1.LINUX_HOST_NEEDED}`;");
    replaceInFile(sshErrorTextPath, "return pointsToLog ? `${text}\\nLogs: ${logPath()}` : text;", "return pointsToLog ? `${text}\\n日志：${logPath()}` : text;");
  }

  // 20. Localize dist/remote/signInCallback.js (SSH OAuth 浏览器本地回调页面)
  const signInCallbackPath = path.join(targetExtractDir, 'dist', 'remote', 'signInCallback.js');
  if (fs.existsSync(signInCallbackPath)) {
    replaceInFile(signInCallbackPath, "const host = escapeHtml(opts.hostLabel ?? 'the SSH host');", "const host = escapeHtml(opts.hostLabel ?? 'SSH 主机');");
    replaceInFile(
      signInCallbackPath,
      "const SIGNED_IN = page('You have successfully authenticated.', 'You can close this tab and return to Antigravity.');",
      "const SIGNED_IN = page('您已成功完成身份验证。', '登录成功，您可以关闭此标签页并返回 Antigravity。');"
    );
    replaceInFile(
      signInCallbackPath,
      `function unreachablePage(host) {
    return page("Sign-in didn't finish", \`Antigravity couldn't reach \${host} to finish signing in. \` +
        'Sign in again from Antigravity.');
}`,
      `function unreachablePage(host) {
    return page('登录未完成', \`Antigravity 无法连接到 \${host} 以完成登录。请返回 Antigravity 重新发起登录。\`);
}`
    );
    replaceInFile(
      signInCallbackPath,
      `function otherIssuerPage(host) {
    return page("Sign-in didn't finish", 'This sign-in came back from another server than the sign-in page you ' +
        \`agreed to, so Antigravity didn't pass it on to \${host}.\`);
}`,
      `function otherIssuerPage(host) {
    return page('登录未完成', \`此次登录回调来自与您确认的登录页面不同的服务器，因此 Antigravity 未将其转发至 \${host}。\`);
}`
    );
    replaceInFile(
      signInCallbackPath,
      `function failedPage(host, status) {
    return page("Sign-in didn't finish", \`Antigravity on \${host} couldn't finish signing in (HTTP \${status}). \` +
        'Sign in again from Antigravity.');
}`,
      `function failedPage(host, status) {
    return page('登录未完成', \`\${host} 上的 Antigravity 无法完成登录 (HTTP \${status})。请返回 Antigravity 重新发起登录。\`);
}`
    );
  }

  // 21. Localize dist/remote/sshConnection.js (SSH 连接实时状态流与隧道/令牌错误；保留 describeExit 英文供 Windows Shell 探测正则匹配)
  const sshConnectionPath = path.join(targetExtractDir, 'dist', 'remote', 'sshConnection.js');
  if (fs.existsSync(sshConnectionPath)) {
    replaceInFile(sshConnectionPath, "exports.PROMPT_CANCELLED = 'Sign-in cancelled.';", "exports.PROMPT_CANCELLED = '登录已取消。';");
    replaceInFile(sshConnectionPath, "reject(new types_1.RemoteError('CONNECTION_FAILED', `Timed out connecting to ${this.label}.`));", "reject(new types_1.RemoteError('CONNECTION_FAILED', `连接 ${this.label} 超时。`));");
    replaceInFile(sshConnectionPath, "this.status(`Connecting to ${this.label}…`);", "this.status(`正在连接到 ${this.label}…`);");
    replaceInFile(sshConnectionPath, "this.emit('status', open ? 'Waiting for your answer…' : this.lastStatus);", "this.emit('status', open ? '正在等待您的输入…' : this.lastStatus);");
    replaceInFile(sshConnectionPath, ": new types_1.RemoteError('UNKNOWN', \"Couldn't answer ssh's prompt.\")));", ": new types_1.RemoteError('UNKNOWN', \"无法响应 SSH 的交互提示。\")));");
    replaceInFile(sshConnectionPath, "throw new types_1.RemoteError('CONNECTION_CLOSED', 'Not connected.');", "throw new types_1.RemoteError('CONNECTION_CLOSED', '尚未连接。');");
    replaceInFile(sshConnectionPath, "throw new types_1.RemoteError('UNKNOWN', `The Antigravity server on ${this.label} has no HTTP port to stop it through.`);", "throw new types_1.RemoteError('UNKNOWN', `${this.label} 上的 Antigravity 服务端没有可用于停止它的 HTTP 端口。`);");
    replaceInFile(sshConnectionPath, "throw new types_1.RemoteError('UNKNOWN', `The Antigravity server on ${this.label} refused to stop (HTTP ${status}).`);", "throw new types_1.RemoteError('UNKNOWN', `${this.label} 上的 Antigravity 服务端拒绝停止 (HTTP ${status})。`);");
    replaceInFile(
      sshConnectionPath,
      `            throw new types_1.RemoteError('UNKNOWN', \`Could not confirm that the Antigravity server on \${this.label} stopped\` +
                (rpcError ? \` (\${this.redact((0, types_1.sanitizeRemoteText)(rpcError))}).\` : '.'));`,
      `            throw new types_1.RemoteError('UNKNOWN', \`无法确认 \${this.label} 上的 Antigravity 服务端是否已停止\` +
                (rpcError ? \` (\${this.redact((0, types_1.sanitizeRemoteText)(rpcError))})。\` : '。'));`
    );
    replaceInFile(sshConnectionPath, "why = 'it has no HTTP port';", "why = '未开放 HTTP 端口';");
    replaceInFile(sshConnectionPath, "why = 'an invalid answer';", "why = '响应内容无效';");
    replaceInFile(
      sshConnectionPath,
      "throw new types_1.RemoteError('UNKNOWN', `The Antigravity server on ${this.label} didn't give this window a sign-in token (${why}).`, { explainsItself: true });",
      "throw new types_1.RemoteError('UNKNOWN', `${this.label} 上的 Antigravity 服务端未向此窗口提供登录令牌 (${why})。`, { explainsItself: true });"
    );
    replaceInFile(
      sshConnectionPath,
      `                fail(new types_1.RemoteError('CONNECTION_FAILED', \`\${this.label} did not start the setup within \${Math.round(firstLineMs / 1000)} s. \` +
                    'ssh (e.g. a ProxyCommand or ProxyJump login) or a command in ' +
                    'your shell startup files (e.g. ~/.bashrc) may be waiting for input.',`,
      `                fail(new types_1.RemoteError('CONNECTION_FAILED', \`\${this.label} 未在 \${Math.round(firstLineMs / 1000)} 秒内启动初始化流程。\` +
                    'ssh（例如 ProxyCommand 或 ProxyJump 登录）或您的 Shell 启动脚本（例如 ~/.bashrc）中的命令可能正在等待输入。',`
    );
    replaceInFile(
      sshConnectionPath,
      `                this.fatal ?? (this.fatal = err.code === 'ENOENT'
                    ? new types_1.RemoteError('UNKNOWN', \`Could not run "\${sshBin}". Install OpenSSH or set ANTIGRAVITY_SSH_BIN.\`)
                    : new types_1.RemoteError('UNKNOWN', \`Could not run ssh: \${err.message}\`));`,
      `                this.fatal ?? (this.fatal = err.code === 'ENOENT'
                    ? new types_1.RemoteError('UNKNOWN', \`无法运行 "\${sshBin}"。请安装 OpenSSH 或设置环境变量 ANTIGRAVITY_SSH_BIN。\`)
                    : new types_1.RemoteError('UNKNOWN', \`无法运行 ssh：\${err.message}\`));`
    );
    replaceInFile(sshConnectionPath, "fail(new types_1.RemoteError('UNKNOWN', `ssh could not listen on its SOCKS port ${this.socksPort}.`));", "fail(new types_1.RemoteError('UNKNOWN', `ssh 无法监听其 SOCKS 端口 ${this.socksPort}。`));");
    replaceInFile(sshConnectionPath, "fail(new types_1.RemoteError('UNKNOWN', `${this.label} asked for an upload it can't need.`));", "fail(new types_1.RemoteError('UNKNOWN', `${this.label} 请求了不应需要的服务端上传。`));");
    replaceInFile(sshConnectionPath, "() => fail(new types_1.RemoteError('UNKNOWN', `${this.label} sent a line longer than ${MAX_LINE_CHARS} characters.`)));", "() => fail(new types_1.RemoteError('UNKNOWN', `${this.label} 发送了超过 ${MAX_LINE_CHARS} 个字符的超长行。`)));");
    replaceInFile(sshConnectionPath, "this.status(`Uploading the Antigravity server to ${this.label}…`);", "this.status(`正在向 ${this.label} 上传 Antigravity 服务端…`);");
    replaceInFile(sshConnectionPath, "throw new types_1.RemoteError('INSTALL_FAILED', `Neither ${this.label} nor this computer could download the Antigravity server: ${errorMessage(err)}`);", "throw new types_1.RemoteError('INSTALL_FAILED', `${this.label} 与本机均无法下载 Antigravity 服务端：${errorMessage(err)}`);");
    replaceInFile(sshConnectionPath, "return new types_1.RemoteError('LS_STOPPED', `The Antigravity server on ${this.label} stopped.`, { retryable: true });", "return new types_1.RemoteError('LS_STOPPED', `${this.label} 上的 Antigravity 服务端已停止。`, { retryable: true });");
    replaceInFile(sshConnectionPath, "this.status(`Connecting to the Antigravity server on ${this.label}…`);", "this.status(`正在连接 ${this.label} 上的 Antigravity 服务端…`);");
    replaceInFile(sshConnectionPath, "throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');", "throw new types_1.RemoteError('CANCELLED', '连接已取消。');");
    replaceInFile(sshConnectionPath, "throw new types_1.RemoteError('FORWARDING_PROHIBITED', 'The SSH server does not allow port forwarding (AllowTcpForwarding).');", "throw new types_1.RemoteError('FORWARDING_PROHIBITED', 'SSH 服务端不允许端口转发 (AllowTcpForwarding)。');");
    replaceInFile(sshConnectionPath, "throw new types_1.RemoteError('LS_START_FAILED', `The Antigravity server on ${this.label} did not respond through the SSH tunnel (${(0, types_1.sanitizeRemoteText)(lastErr, 200)}).`);", "throw new types_1.RemoteError('LS_START_FAILED', `${this.label} 上的 Antigravity 服务端未通过 SSH 隧道响应 (${(0, types_1.sanitizeRemoteText)(lastErr, 200)})。`);");
    replaceInFile(
      sshConnectionPath,
      "this.emit('signInError', new types_1.RemoteError('UNKNOWN', `${this.label} asked to open a sign-in at ${origin} that can't finish on that host, so it was not opened.`));",
      "this.emit('signInError', new types_1.RemoteError('UNKNOWN', `${this.label} 请求打开位于 ${origin} 的登录页面，但该登录无法在该主机上完成，因此未予打开。`));"
    );
    replaceInFile(
      sshConnectionPath,
      `                this.emit('signInError', new types_1.RemoteError('UNKNOWN', \`The sign-in request of the Antigravity server on \${this.label} doesn't match what this app expects, so it was not opened. \` +
                    'Update Antigravity, or restart the server on that host.'));`,
      `                this.emit('signInError', new types_1.RemoteError('UNKNOWN', \`\${this.label} 上的 Antigravity 服务端发出的登录请求与当前应用预期不符，因此未予打开。请更新 Antigravity，或重启该主机上的服务端。\`));`
    );
    replaceInFile(
      sshConnectionPath,
      `            const remoteErr = new types_1.RemoteError('UNKNOWN', \`Local port \${port} is in use, so the sign-in callback can't \` +
                \`reach \${this.label}. Close the program using it and sign in again. \` +
                \`(\${errorMessage(err)})\`);`,
      `            const remoteErr = new types_1.RemoteError('UNKNOWN', \`本地端口 \${port} 已被占用，导致登录回调无法送达 \${this.label}。请关闭占用该端口的程序后重新登录。(\${errorMessage(err)})\`);`
    );
    replaceInFile(
      sshConnectionPath,
      `        case 'checking':
            return \`Checking \${label}…\`;
        case 'waiting':
            return \`Waiting for another window to finish installing on \${label}…\`;
        case 'invalid binary removed':
            return \`Replacing an invalid server binary on \${label}…\`;
        case 'downloading':
            return \`Downloading the Antigravity server on \${label}…\`;
        case 'installed':
            return \`Installed the Antigravity server on \${label}.\`;
        case 'starting':
            return \`Starting the Antigravity server on \${label}…\`;
        case 'attached':
            return \`Connecting to the running server on \${label}…\`;
        case 'replacing':
            return \`Restarting the Antigravity server on \${label}…\`;
        case 'checking other host':
            return \`Checking whether another host still runs your Antigravity server…\`;
        case 'taking over':
            return \`Moving the Antigravity server to \${label}…\`;`,
      `        case 'checking':
            return \`正在检查 \${label}…\`;
        case 'waiting':
            return \`正在等待另一个窗口完成在 \${label} 上的安装…\`;
        case 'invalid binary removed':
            return \`正在替换 \${label} 上无效的服务端二进制文件…\`;
        case 'downloading':
            return \`正在 \${label} 上下载 Antigravity 服务端…\`;
        case 'installed':
            return \`已在 \${label} 上安装 Antigravity 服务端。\`;
        case 'starting':
            return \`正在启动 \${label} 上的 Antigravity 服务端…\`;
        case 'attached':
            return \`正在连接到 \${label} 上运行中的服务端…\`;
        case 'replacing':
            return \`正在重启 \${label} 上的 Antigravity 服务端…\`;
        case 'checking other host':
            return \`正在检查是否有其他主机仍在运行您的 Antigravity 服务端…\`;
        case 'taking over':
            return \`正在将 Antigravity 服务端迁移至 \${label}…\`;`
    );
  }

  // 22. Localize dist/remote/sshBridge.js (SSH IPC 输入校验提示)
  const sshBridgePath = path.join(targetExtractDir, 'dist', 'remote', 'sshBridge.js');
  if (fs.existsSync(sshBridgePath)) {
    replaceInFile(sshBridgePath, "const BAD_CONFIG_FILE = 'The SSH config file must be a path of at most 4 KiB.';", "const BAD_CONFIG_FILE = 'SSH 配置文件路径长度不得超过 4 KiB。';");
    replaceInFile(sshBridgePath, "message: 'Enter an SSH host, for example \"devbox\" or \"user@host\".',", "message: '请输入 SSH 主机，例如 \"devbox\" 或 \"user@host\"。',");
  }

  // 23. Localize dist/remote/sshConfigHosts.js (v2.33.0 SSH 配置文件类型/BOM/权限校验)
  const sshConfigHostsPath = path.join(targetExtractDir, 'dist', 'remote', 'sshConfigHosts.js');
  if (fs.existsSync(sshConfigHostsPath)) {
    replaceInFile(
      sshConfigHostsPath,
      "const invalid = (problem) => new types_1.RemoteError('INVALID_DESTINATION', `The SSH config file ${problem}`, {",
      "const invalid = (problem) => new types_1.RemoteError('INVALID_DESTINATION', `SSH 配置文件${problem}`, {"
    );
    replaceInFile(sshConfigHostsPath, "throw invalid(`${shown} isn't a file.`);", "throw invalid(` ${shown} 不是常规文件。`);");
    replaceInFile(
      sshConfigHostsPath,
      "throw invalid(`${shown} can be changed by others: it must be yours or root's, and not group- or world-writable.`);",
      "throw invalid(` ${shown} 可被其他用户修改：该文件必须归您本人或 root 所有，且不可对用户组或其他用户开放写权限。`);"
    );
    replaceInFile(
      sshConfigHostsPath,
      `const NOT_CONFIG = "isn't an SSH config file";
const CHOOSE_CONFIG = 'Choose a file of ssh settings, such as ~/.ssh/config.';
const UNREADABLE = "is saved in a way ssh can't read";
const SAVE_AS_UTF8 = 'Save it as UTF-8 without a byte-order mark.';
const notConfig = (why) => ({
    what: NOT_CONFIG,
    why,
    fix: CHOOSE_CONFIG,
});
const BINARY = notConfig("it's a binary file");
const KEY = notConfig('it holds a key or certificate');
const PUBLIC_KEYS = notConfig('it holds SSH public keys, like a .pub or authorized_keys file');
const HOST_KEYS = notConfig('it lists SSH host keys, like known_hosts');
// OpenSSH reads a byte-order mark as part of the first keyword.
const BOM = {
    what: UNREADABLE,
    why: 'it starts with a byte-order mark',
    fix: SAVE_AS_UTF8,
};
const UTF16 = {
    what: UNREADABLE,
    why: "it's saved as UTF-16",
    fix: SAVE_AS_UTF8,
};
/** "<file> <what>: <why>. <fix>" */
function describeSshConfigProblem(file, { what, why, fix }) {
    return \`\${file} \${what}: \${why}. \${fix}\`;
}`,
      `const NOT_CONFIG = '不是有效的 SSH 配置文件';
const CHOOSE_CONFIG = '请选择包含 ssh 配置项的文件（例如 ~/.ssh/config）。';
const UNREADABLE = '的保存格式无法被 ssh 读取';
const SAVE_AS_UTF8 = '请将其另存为不带 BOM 的 UTF-8 编码格式。';
const notConfig = (why) => ({
    what: NOT_CONFIG,
    why,
    fix: CHOOSE_CONFIG,
});
const BINARY = notConfig('这是一个二进制文件');
const KEY = notConfig('该文件包含私钥或证书内容');
const PUBLIC_KEYS = notConfig('该文件包含 SSH 公钥（例如 .pub 或 authorized_keys 文件）');
const HOST_KEYS = notConfig('该文件记录的是 SSH 主机密钥（例如 known_hosts）');
// OpenSSH reads a byte-order mark as part of the first keyword.
const BOM = {
    what: UNREADABLE,
    why: '文件开头包含字节顺序标记 (BOM)',
    fix: SAVE_AS_UTF8,
};
const UTF16 = {
    what: UNREADABLE,
    why: '文件保存为了 UTF-16 编码',
    fix: SAVE_AS_UTF8,
};
/** "<file> <what>: <why>. <fix>" */
function describeSshConfigProblem(file, { what, why, fix }) {
    return \`\${file} \${what}：\${why}。\${fix}\`;
}`
    );
    replaceInFile(sshConfigHostsPath, "throw invalid('must be a path on one line.');", "throw invalid('路径必须位于单行内。');");
    replaceInFile(sshConfigHostsPath, "throw invalid(`must be an absolute path (got ${shown}).`);", "throw invalid(`必须是绝对路径（当前为 ${shown}）。`);");
    replaceInFile(sshConfigHostsPath, "throw invalid(`must be on one of this computer's drives (got ${shown}).`);", "throw invalid(`必须位于本机磁盘驱动器上（当前为 ${shown}）。`);");
    replaceInFile(sshConfigHostsPath, "throw invalid(`can't be on a network share (${shown}).`);", "throw invalid(`不能位于网络共享路径上 (${shown})。`);");
    replaceInFile(sshConfigHostsPath, "invalid(`${shown} doesn't exist or can't be read.`)", "invalid(` ${shown} 不存在或无法读取。`)");
    replaceInFile(sshConfigHostsPath, "? invalid(`${shown} is now a link: choose the file again.`)", "? invalid(` ${shown} 已变为符号链接：请重新选择该文件。`)");
    replaceInFile(sshConfigHostsPath, "throw invalid(`${shown} is over 4 MiB.`);", "throw invalid(` ${shown} 体积超过 4 MiB 上限。`);");
  }

  // 24. Localize dist/remote/sshDestination.js & dist/remote/serverArtifacts.js (SSH 目标地址解析与服务端构建校验)
  const sshDestinationPath = path.join(targetExtractDir, 'dist', 'remote', 'sshDestination.js');
  if (fs.existsSync(sshDestinationPath)) {
    replaceInFile(sshDestinationPath, "invalid('The user name before \"@\" is missing.');", "invalid('缺少 \"@\" 之前的用户名。');");
    replaceInFile(sshDestinationPath, "invalid('The user name must not start with \"-\".');", "invalid('用户名不能以 \"-\" 开头。');");
    replaceInFile(sshDestinationPath, "invalid(`\"${shown}\" isn't a valid user name.`);", "invalid(`\"${shown}\" 不是有效的用户名。`);");
    replaceInFile(sshDestinationPath, "invalid('The host name is missing.');", "invalid('缺少主机名。');");
    replaceInFile(sshDestinationPath, "invalid('The host name must not start with \"-\".');", "invalid('主机名不能以 \"-\" 开头。');");
    replaceInFile(sshDestinationPath, "invalid(`\"${host}\" isn't a valid host name.`);", "invalid(`\"${host}\" 不是有效的主机名。`);");
    replaceInFile(sshDestinationPath, "invalid(`Invalid port \"${port}\": use a number from 1 to 65535.`);", "invalid(`端口 \"${port}\" 无效：请使用 1 到 65535 之间的数字。`);");
    replaceInFile(sshDestinationPath, "invalid(`\"${addr}\" isn't a valid IPv6 address. Write an IPv6 address with a port in brackets, for example [::1]:2222.`);", "invalid(`\"${addr}\" 不是有效的 IPv6 地址。带端口的 IPv6 地址请用方括号括起，例如 [::1]:2222。`);");
    replaceInFile(sshDestinationPath, "invalid(`Missing \"]\" after the IPv6 address in \"${hostPort}\".`);", "invalid(`\"${hostPort}\" 中的 IPv6 地址后缺少 \"]\"。`);");
    replaceInFile(sshDestinationPath, "invalid(`Unexpected \"${rest}\" after \"]\".`);", "invalid(`\"]\" 后存在意外字符 \"${rest}\"。`);");
    replaceInFile(sshDestinationPath, "invalid(`Invalid percent-encoding in the user name \"${s}\".`);", "invalid(`用户名 \"${s}\" 中的百分号编码无效。`);");
    replaceInFile(sshDestinationPath, "invalid('Write \"@\" inside the user name of an ssh:// URI as %40.');", "invalid('请在 ssh:// URI 的用户名中将 \"@\" 写作 %40。');");
    replaceInFile(sshDestinationPath, "invalid('Write an IPv6 address in an ssh:// URI in brackets, for example ssh://[::1]:2222.');", "invalid('请在 ssh:// URI 中用方括号括起 IPv6 地址，例如 ssh://[::1]:2222。');");
    replaceInFile(sshDestinationPath, "invalid('Enter an SSH host, for example \"devbox\" or \"user@host:2222\".');", "invalid('请输入 SSH 主机，例如 \"devbox\" 或 \"user@host:2222\"。');");
    replaceInFile(sshDestinationPath, "invalid(`The SSH host is too long (at most ${MAX_DESTINATION_LENGTH} characters).`);", "invalid(`SSH 主机地址过长（最多 ${MAX_DESTINATION_LENGTH} 个字符）。`);");
    replaceInFile(sshDestinationPath, "invalid('The SSH host must not start with \"-\".');", "invalid('SSH 主机地址不能以 \"-\" 开头。');");
    replaceInFile(sshDestinationPath, "invalid('The SSH host must not contain spaces or control characters.');", "invalid('SSH 主机地址不能包含空格或控制字符。');");
    replaceInFile(sshDestinationPath, "invalid(`The SSH host must not contain ${describeChar(bad[0])}.`);", "invalid(`SSH 主机地址不能包含 ${describeChar(bad[0])}。`);");
  }

  const serverArtifactsPath = path.join(targetExtractDir, 'dist', 'remote', 'serverArtifacts.js');
  if (fs.existsSync(serverArtifactsPath)) {
    replaceInFile(serverArtifactsPath, "throw new types_1.RemoteError('INSTALL_FAILED', `Invalid server version: ${JSON.stringify(version)}`);", "throw new types_1.RemoteError('INSTALL_FAILED', `无效的服务端版本：${JSON.stringify(version)}`);");
    replaceInFile(serverArtifactsPath, "throw new types_1.RemoteError('INSTALL_FAILED', `${exports.SSH_LS_REMOTE_PATH_ENV} must be an absolute path on the SSH host: ${JSON.stringify(remotePath)}`);", "throw new types_1.RemoteError('INSTALL_FAILED', `${exports.SSH_LS_REMOTE_PATH_ENV} 必须是 SSH 主机上的绝对路径：${JSON.stringify(remotePath)}`);");
    replaceInFile(
      serverArtifactsPath,
      `            resolutionError: \`Could not find the Antigravity server build \${version}: \` +
                \`\${err instanceof Error ? err.message : String(err)}. Development builds must set \` +
                \`\${exports.SSH_LS_VERSION_ENV} to a released version.\`,`,
      `            resolutionError: \`找不到 Antigravity 服务端构建版本 \${version}：\` +
                \`\${err instanceof Error ? err.message : String(err)}。开发版构建必须将环境变量 \` +
                \`\${exports.SSH_LS_VERSION_ENV} 设置为已发布的版本号。\`,`
    );
  }

  // 25. Localize dist/computer/* (v2.33.0 Computer Use 桌面控制悬浮栏 HUD 与边框遮罩)
  const hudPath = path.join(targetExtractDir, 'dist', 'computer', 'hud.js');
  if (fs.existsSync(hudPath)) {
    replaceInFile(
      hudPath,
      `<body><div id="bar"><div id="dot"></div><div id="status">AGY is controlling your Mac</div>
<button id="stop">Stop</button><button id="resume">Resume</button></div>`,
      `<body><div id="bar"><div id="dot"></div><div id="status">AGY 正在控制您的 Mac</div>
<button id="stop">停止</button><button id="resume">继续</button></div>`
    );
    replaceInFile(hudPath, "end.textContent = 'Stopped';", "end.textContent = '已停止';");
    replaceInFile(hudPath, "end.textContent = 'Stop';", "end.textContent = '停止';");
  }

  const hudStatePath = path.join(targetExtractDir, 'dist', 'computer', 'hudState.js');
  if (fs.existsSync(hudStatePath)) {
    replaceInFile(hudStatePath, "return { state: 'paused', text: 'Agent paused — you have control', visible };", "return { state: 'paused', text: '智能体已暂停 — 您已接管控制', visible };");
    replaceInFile(hudStatePath, "return { state: 'idle', text: 'Agent idle', visible };", "return { state: 'idle', text: '智能体空闲', visible };");
    replaceInFile(
      hudStatePath,
      `            text: name
                ? \`AGY working in \${name} (background)\`
                : 'AGY working in the background',`,
      `            text: name
                ? \`AGY 正在后台操作 \${name}\`
                : 'AGY 正在后台运行',`
    );
    replaceInFile(hudStatePath, "return { state: 'running', text: 'AGY is controlling your Mac', visible };", "return { state: 'running', text: 'AGY 正在控制您的 Mac', visible };");
  }

  const hudAgentsPath = path.join(targetExtractDir, 'dist', 'computer', 'hudAgents.js');
  if (fs.existsSync(hudAgentsPath)) {
    replaceInFile(
      hudAgentsPath,
      "text: `${(0, overlay_1.overlayDisplayName)(label)} · ${app || 'starting'} · ${stopped ? 'stopped' : paused ? 'paused' : m}`,",
      "text: `${(0, overlay_1.overlayDisplayName)(label)} · ${app || '正在启动'} · ${stopped ? '已停止' : paused ? '已暂停' : (m === 'foreground' ? '前台' : '后台')}`,"
    );
    replaceInFile(
      hudAgentsPath,
      `function hudAgentsHeadline(text, rows) {
    const working = rows.filter((r) => !r.stopped).length;
    const stopped = rows.length - working;
    if (working > 1) {
        return \`\${working} AGY agents working\`;
    }
    if (working === 0 && stopped > 0) {
        return stopped === 1 ? 'Agent stopped' : \`\${stopped} agents stopped\`;
    }
    return stopped > 0 ? \`\${text} (+\${stopped} stopped)\` : text;
}`,
      `function hudAgentsHeadline(text, rows) {
    const working = rows.filter((r) => !r.stopped).length;
    const stopped = rows.length - working;
    if (working > 1) {
        return \`\${working} 个 AGY 智能体正在运行\`;
    }
    if (working === 0 && stopped > 0) {
        return stopped === 1 ? '智能体已停止' : \`\${stopped} 个智能体已停止\`;
    }
    return stopped > 0 ? \`\${text}（另有 \${stopped} 个已停止）\` : text;
}`
    );
  }

  const overlayPath = path.join(targetExtractDir, 'dist', 'computer', 'overlay.js');
  if (fs.existsSync(overlayPath)) {
    replaceInFile(
      overlayPath,
      `function overlayDisplayName(label) {
    return \`Agent: \${label}\`;
}`,
      `function overlayDisplayName(label) {
    return \`智能体：\${label === 'unnamed' ? '未命名' : label}\`;
}`
    );
  }

  log('汉化修改注入完成！');
}

// Full workflow runner (protected by shared writeLock, temp isolation, symlink guard & shell-free ASAR CLI)
function runClientWrite(appDir, owner, operation) {
  const resourcesDir = getResourcesDir(appDir);
  return writeLock.tryRun(() => {
    assertNotSymlinkOrJunction(appDir, '安装目录');
    assertNotSymlinkOrJunction(resourcesDir, 'Resources 目录');
    return withInstallLock(resourcesDir, () => operation(resourcesDir));
  }, { owner, conflictMessage: '当前已有安装、还原或汉化任务正在进行，请稍候重试' });
}

async function runLocalizationWorkflow(appDir) {
  return runClientWrite(appDir, 'localize', async resourcesDir => {
    const asarPath = path.join(resourcesDir, 'app.asar');
    const backupPath = path.join(resourcesDir, 'app.asar.bak');

    logs = [];
    log('=================== 开始汉化流程 ===================');
    log(`目标程序目录: ${appDir}`);

    if (!fs.existsSync(asarPath)) {
      throw new Error(`找不到 app.asar 路径: ${asarPath}\n请确认软件是否安装在指定路径。`);
    }
    assertNotSymlinkOrJunction(appDir, '安装目录');
    assertNotSymlinkOrJunction(resourcesDir, 'Resources 目录');
    assertNotSymlinkOrJunction(asarPath, 'app.asar');
    assertNotSymlinkOrJunction(backupPath, 'app.asar.bak');

    // 1. Kill running instances and wait until file locks are released
    await stopAndWaitAppExit(5000);

    // 2. Backup app.asar (avoid backing up an already localized file or keeping stale version .bak)
    const clientVer = readAsarPackageVersion(asarPath);
    if (!fs.existsSync(backupPath)) {
      if (isLocalizedAsar(asarPath)) {
        log('提示：当前系统 app.asar 已包含汉化代码，跳过自动备份以避免污染官方原版备份。');
      } else {
        log('正在创建 app.asar 的初始安全备份...');
        fs.copyFileSync(asarPath, backupPath);
        log('安全备份创建成功：' + backupPath);
      }
    } else if (isLocalizedAsar(backupPath)) {
      log('警告：检测到备份文件 app.asar.bak 已被汉化包污染！');
      if (!isLocalizedAsar(asarPath)) {
        fs.copyFileSync(asarPath, backupPath);
        log('已用当前纯净官方原版修复 app.asar.bak。');
      }
    } else if (!isLocalizedAsar(asarPath)) {
      const bakVer = readAsarPackageVersion(backupPath);
      if (clientVer && bakVer && compareVersions(clientVer, bakVer) !== 0) {
        log(`检测到官方客户端已从 v${bakVer} 更新至 v${clientVer}，正在刷新原版备份...`);
        fs.copyFileSync(asarPath, backupPath);
      } else {
        log('安全备份已存在且为官方原版，跳过备份。备份文件: ' + backupPath);
      }
    } else {
      log('安全备份已存在且为官方原版，跳过备份。备份文件: ' + backupPath);
    }

    // 3. Isolated temporary workspace to prevent concurrent/partial corruption & root .unpacked clutter
    const workTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-loc-'));
    const tempExtractDir = path.join(workTmpRoot, 'extracted');
    const tempAsar = path.join(workTmpRoot, 'app.asar.temp');
    const stageAsar = path.join(resourcesDir, `app.asar.stage-${process.pid}-${Date.now()}`);

    try {
      log('正在解包 app.asar...');
      try {
        runAsarCli(['extract', asarPath, tempExtractDir]);
        log('解包成功。');
      } catch (e) {
        throw new Error('解压 app.asar 失败: ' + e.message);
      }

      applyTranslations(tempExtractDir);

      log('正在将修改后的文件重新打包为 app.asar...');
      try {
        runAsarCli(['pack', tempExtractDir, tempAsar, '--unpack-dir', '**/chrome-devtools-mcp/**']);
        log('打包成功。');
      } catch (e) {
        throw new Error('打包新 asar 失败: ' + e.message);
      }

      log('正在部署新的汉化 app.asar...');
      try {
        fs.copyFileSync(tempAsar, stageAsar);
        fs.renameSync(stageAsar, asarPath);
        log('汉化 app.asar 部署成功！');
      } catch (e) {
        try { if (fs.existsSync(stageAsar)) fs.unlinkSync(stageAsar); } catch (_) {}
        throw new Error('复制汉化包到系统程序目录失败 (请检查是否有读写权限): ' + e.message);
      }
    } finally {
      try {
        fs.rmSync(workTmpRoot, { recursive: true, force: true });
      } catch (_) {}
    }

    if (process.platform === 'darwin') {
      log('macOS 提示：如启动时提示“已损坏”，请执行: xattr -cr "/Applications/Antigravity.app" && codesign --force --deep --sign - "/Applications/Antigravity.app"');
    }
    log('Antigravity 2.0 一键汉化成功完成！现在您可以安全启动程序了。');
    log('=================== 汉化流程结束 ===================');
  });
}

// Restore workflow (unified backup discovery + strict version guard + atomic replace)
async function runRestoreWorkflow(appDir, { forceStop = true, isAppRunning = isAppRunningStrict } = {}) {
  return runClientWrite(appDir, 'restore', async resourcesDir => {
    const asarPath = path.join(resourcesDir, 'app.asar');
    const legacyBackupPath = path.join(resourcesDir, 'app.asar.bak');

    logs = [];
    log('=================== 开始还原流程 ===================');
    log(`目标程序目录: ${appDir}`);
    if (!fs.existsSync(asarPath)) {
      throw new Error(`找不到已安装的 app.asar: ${asarPath}`);
    }
    assertNotSymlinkOrJunction(appDir, '安装目录');
    assertNotSymlinkOrJunction(resourcesDir, 'Resources 目录');
    assertNotSymlinkOrJunction(asarPath, 'app.asar');

    const originalStat = fs.statSync(asarPath, { bigint: true });
    const currentClientVer = readAsarPackageVersion(asarPath);
    if (!currentClientVer) throw httpError('无法确认客户端版本，已停止还原', 409);
    const originalHash = await hashFile(asarPath);
    const backupSearch = findValidOfficialBackup({
      resourcesDir,
      targetVersion: currentClientVer,
      isLocalizedAsar,
    });

    if (!backupSearch.match) {
      if (backupSearch.staleBackups && backupSearch.staleBackups.length > 0) {
        const staleVer = backupSearch.staleBackups[0].version || '未知';
        throw httpError(
          `检测到备份文件版本 (v${staleVer}) 与当前客户端版本 (v${currentClientVer || '未知'}) 不匹配！已安全拦截还原以防止白屏崩溃。`,
          409
        );
      }
      if (fs.existsSync(legacyBackupPath) && isLocalizedAsar(legacyBackupPath)) {
        throw new Error('检测到备份文件 `app.asar.bak` 本身已被汉化包污染，无法还原为官方原版！请重新安装官方安装包以恢复。');
      }
      throw new Error('未找到与当前客户端版本匹配的官方原版备份文件，无法执行恢复！');
    }

    const backupPath = backupSearch.match.path;
    assertNotSymlinkOrJunction(backupPath, '备份文件');

    if (forceStop) await stopAndWaitAppExit(5000);
    else if (await isAppRunning()) throw httpError('请先正常退出 Antigravity 及其后台服务，再还原官方版', 409);

    log(`正在从安全备份 (${path.basename(backupPath)}) 恢复原始官方 app.asar...`);
    const stageRestore = path.join(resourcesDir, `.app.asar.restore-${crypto.randomUUID()}.stage`);
    let staged = false;
    try {
      fs.copyFileSync(backupPath, stageRestore, fs.constants.COPYFILE_EXCL);
      staged = true;
      if (normalizeVersion(readAsarPackageVersion(stageRestore)) !== normalizeVersion(currentClientVer) || isLocalizedAsar(stageRestore) ||
          await hashFile(stageRestore) !== await hashFile(backupPath)) {
        throw httpError('原版备份发生变化，已停止还原', 409);
      }
      assertNotSymlinkOrJunction(asarPath, 'app.asar');
      if (await hashFile(asarPath) !== originalHash) {
        throw httpError('客户端在还原期间发生变化，已保留当前文件，请刷新后重试', 409);
      }
      if (await isAppRunning()) throw httpError('客户端已重新启动，请退出后再还原', 409);
      const beforeCommit = fs.lstatSync(asarPath, { bigint: true });
      if (readAsarPackageVersion(asarPath) !== currentClientVer ||
          beforeCommit.ino !== originalStat.ino || beforeCommit.dev !== originalStat.dev ||
          beforeCommit.ctimeNs !== originalStat.ctimeNs || beforeCommit.size !== originalStat.size) {
        throw httpError('客户端文件已更换，已停止还原', 409);
      }
      fs.renameSync(stageRestore, asarPath);
      staged = false;
      log('还原原始 app.asar 成功！软件已恢复为官方英文版。');
    } catch (error) {
      if (error.code === 'ENOENT') throw httpError('客户端或备份文件已更换，请刷新后重试', 409);
      throw error;
    } finally {
      if (staged) fs.unlinkSync(stageRestore);
    }
    log('=================== 还原流程结束 ===================');
  });
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    const activeAddr = server.address();
    const activePort = (activeAddr && typeof activeAddr === 'object' && activeAddr.port) ? activeAddr.port : PORT;
    // Enforce loopback Host header on all requests to defeat DNS Rebinding & malformed Host crashes
    if (!isValidLoopbackHostHeader(req.headers.host, activePort)) {
      sendJson(res, 403, { success: false, error: '非法 Host 请求头，仅允许本机回环地址访问' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    // Serve the dashboard (injects per-process CSRF token + strict CSP)
    if ((req.url === '/' || req.url === '/index.html') && req.method === 'GET') {
      const indexPath = path.join(WORKSPACE_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath, 'utf-8').replace('__LOCALIZER_CSRF_TOKEN__', CSRF_TOKEN);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
        });
        res.end(html);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('index.html not found.');
      }
      return;
    }

    // Delegate release manager & package installer routes (equipped with securityToken & writeLock)
    if (releaseManager.handleRequest(req, res)) return;
    if (packageInstaller.handleRequest(req, res)) return;

    const isMutating = req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH';
    verifySameOriginAndToken(req, {
      securityToken: CSRF_TOKEN,
      requireToken: isMutating,
      expectedPort: activePort,
    });

    const urlObj = new URL(req.url || '/', `http://127.0.0.1:${activePort}`);
    const pathname = urlObj.pathname;

    if (pathname === '/api/status' && req.method === 'GET') {
      const username = urlObj.searchParams.get('username') || '';
      const useDefault = urlObj.searchParams.get('useDefault') !== 'false';
      const customPath = urlObj.searchParams.get('customPath') || '';

      const appDir = getAppDir(username, useDefault, customPath);
      const resourcesDir = getResourcesDir(appDir);
      const asarPath = path.join(resourcesDir, 'app.asar');

      const isInstalled = fs.existsSync(asarPath);
      const isRunning = isAppRunning();
      const installedPackageVersion = isInstalled ? readAsarPackageVersion(asarPath) : null;
      const isLocalized = isInstalled && isLocalizedAsar(asarPath);
      const isUpdateOverwritten = Boolean(isInstalled && !isLocalized);
      const backupInfo = findValidOfficialBackup({
        resourcesDir,
        targetVersion: installedPackageVersion,
        isLocalizedAsar,
      });
      const hasBackup = Boolean(backupInfo.match);
      const backupPath = backupInfo.match ? backupInfo.match.path : path.join(resourcesDir, 'app.asar.bak');

      try {
        const patch = await findAvailablePatch({
          workspaceDir: WORKSPACE_DIR,
          targetVersion: installedPackageVersion,
          releaseManager,
        });
        sendJson(res, 200, {
          isInstalled,
          hasBackup,
          isRunning,
          asarPath,
          backupPath,
          platform: process.platform,
          defaultUsername: getHostUsername(),
          currentVersion: CURRENT_VERSION,
          releaseVersion: RELEASE_VERSION,
          installedPackageVersion,
          isLocalized,
          isUpdateOverwritten,
          patchAvailable: Boolean(patch),
          patchVersion: patch ? patch.version : null,
          patchIsMatch: patch ? patch.isMatch : false,
        });
      } catch (_) {
        sendJson(res, 200, {
          isInstalled,
          hasBackup,
          isRunning,
          asarPath,
          backupPath,
          platform: process.platform,
          defaultUsername: getHostUsername(),
          currentVersion: CURRENT_VERSION,
          releaseVersion: RELEASE_VERSION,
          installedPackageVersion,
          isLocalized,
          isUpdateOverwritten,
          patchAvailable: false,
          patchVersion: null,
          patchIsMatch: false,
        });
      }
      return;
    }

    if (pathname === '/api/auto-restore' && req.method === 'POST') {
      const params = await readJsonBody(req);
      const appDir = getAppDir(params.username, params.useDefault, params.customPath);
      const result = await writeLock.tryRun(
        () => executeAutoRestore({
          appDir,
          getResourcesDir,
          workspaceDir: WORKSPACE_DIR,
          releaseManager,
          isAppRunning: isAppRunningStrict,
          stopProcesses: killApp,
          forceStop: params.forceStop !== false,
        }),
        { owner: 'auto-restore', conflictMessage: '当前已有安装或恢复任务正在进行，请稍候重试' }
      );
      log(result.message);
      if (result.success) {
        sendJson(res, 200, { success: true, result, logs });
      } else {
        const status = result.code === 'VERSION_MISMATCH' ? 409 : (result.code === 'PROCESS_CHECK_FAILED' ? 503 : 400);
        sendJson(res, status, { success: false, error: result.message, result, logs });
      }
      return;
    }

    if (pathname === '/api/localize' && req.method === 'POST') {
      const params = await readJsonBody(req);
      const appDir = getAppDir(params.username, params.useDefault, params.customPath);
      try {
        await runLocalizationWorkflow(appDir);
        sendJson(res, 200, { success: true, logs });
      } catch (err) {
        log(`汉化流程失败: ${err.message}`);
        sendJson(res, err.statusCode || 500, { success: false, error: err.message, logs });
      }
      return;
    }

    if (pathname === '/api/restore' && req.method === 'POST') {
      const params = await readJsonBody(req);
      const appDir = getAppDir(params.username, params.useDefault, params.customPath);
      try {
        await runRestoreWorkflow(appDir);
        sendJson(res, 200, { success: true, logs });
      } catch (err) {
        log(`恢复流程失败: ${err.message}`);
        sendJson(res, err.statusCode || 500, { success: false, error: err.message, logs });
      }
      return;
    }

    if (pathname === '/api/launch' && req.method === 'POST') {
      const params = await readJsonBody(req);
      const appDir = getAppDir(params.username, params.useDefault, params.customPath);
      assertNotSymlinkOrJunction(appDir, '启动目录');

      if (process.platform === 'darwin') {
        const match = appDir.match(/^(.*\.app)(?:\/|$)/);
        if (!match) {
          sendJson(res, 400, { success: false, error: 'macOS 启动路径必须指向有效的 .app 应用包', logs });
          return;
        }
        const appBundlePath = match[1];
        assertNotSymlinkOrJunction(appBundlePath, '应用包');
        const asarCheck = path.join(getResourcesDir(appDir), 'app.asar');
        if (!fs.existsSync(asarCheck)) {
          sendJson(res, 404, { success: false, error: '未在目标应用包内找到 Antigravity 资源文件: ' + asarCheck, logs });
          return;
        }
        log(`正在尝试启动 Antigravity 2.0 (macOS: open -a ${appBundlePath})...`);
        spawn('open', ['-a', appBundlePath], { detached: true, stdio: 'ignore' }).unref();
        log('Antigravity 2.0 启动指令已发送。');
        sendJson(res, 200, { success: true, logs });
      } else {
        const exeName = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
        const appPath = path.join(appDir, exeName);
        assertNotSymlinkOrJunction(appPath, '可执行文件');
        const asarCheck = path.join(getResourcesDir(appDir), 'app.asar');
        log(`正在尝试启动 Antigravity 2.0 (路径: ${appPath})...`);
        if (fs.existsSync(appPath) && fs.existsSync(asarCheck)) {
          spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();
          log('Antigravity 2.0 启动指令已发送。');
          sendJson(res, 200, { success: true, logs });
        } else {
          sendJson(res, 404, { success: false, error: '未找到有效的 Antigravity 可执行程序: ' + appPath, logs });
        }
      }
      return;
    }

    if (pathname === '/api/kill' && req.method === 'POST') {
      await readJsonBody(req, { allowEmpty: true });
      killApp();
      sendJson(res, 200, { success: true, logs });
      return;
    }

    if (pathname === '/api/clean-cache' && req.method === 'POST') {
      const params = await readJsonBody(req);
      const count = cleanAppCache(params.username);
      sendJson(res, 200, { success: true, cleanedCount: count, logs });
      return;
    }

    if (pathname === '/api/logs' && req.method === 'GET') {
      sendJson(res, 200, { logs });
      return;
    }

    if (pathname === '/api/check-release' && req.method === 'GET') {
      const MAX_GH_JSON_BYTES = 2 * 1024 * 1024;
      let responded = false;
      const replyOnce = (payload) => {
        if (responded) return;
        responded = true;
        sendJson(res, 200, payload);
      };

      const options = {
        hostname: 'api.github.com',
        path: '/repos/antigravity-cn-community/Antigravity-Chinese-Localization/releases/latest',
        headers: {
          'User-Agent': 'Antigravity-Chinese-Localization-Console',
          'Accept': 'application/vnd.github+json',
        },
        timeout: 8000,
        rejectUnauthorized: true,
      };

      const ghReq = https.get(options, (ghRes) => {
        const chunks = [];
        let received = 0;
        ghRes.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_GH_JSON_BYTES) {
            ghReq.destroy(new Error('GitHub API 响应体积超出安全上限'));
            return;
          }
          chunks.push(chunk);
        });
        ghRes.on('end', () => {
          if (responded) return;
          try {
            const data = Buffer.concat(chunks).toString('utf-8');
            if (ghRes.statusCode >= 200 && ghRes.statusCode < 300) {
              const release = JSON.parse(data);
              const latestTag = release.tag_name || '';
              const cleanLatest = latestTag.replace(/^[vV]/, '');
              const hasUpdate = compareVersions(cleanLatest, RELEASE_VERSION) > 0;
              replyOnce({
                success: true,
                currentVersion: CURRENT_VERSION,
                releaseVersion: RELEASE_VERSION,
                latestVersion: cleanLatest,
                hasUpdate,
                releaseName: release.name || latestTag,
                releaseUrl: release.html_url,
                publishedAt: release.published_at,
                body: release.body || '',
              });
            } else {
              replyOnce({
                success: false,
                currentVersion: CURRENT_VERSION,
                releaseVersion: RELEASE_VERSION,
                error: `GitHub API 响应异常 (HTTP ${ghRes.statusCode})`,
              });
            }
          } catch (err) {
            replyOnce({
              success: false,
              currentVersion: CURRENT_VERSION,
              releaseVersion: RELEASE_VERSION,
              error: '解析 GitHub Release 数据失败: ' + err.message,
            });
          }
        });
      });

      ghReq.on('timeout', () => {
        replyOnce({
          success: false,
          currentVersion: CURRENT_VERSION,
          releaseVersion: RELEASE_VERSION,
          error: '请求 GitHub API 超时 (网络连接受限)',
        });
        ghReq.destroy();
      });

      ghReq.on('error', (err) => {
        replyOnce({
          success: false,
          currentVersion: CURRENT_VERSION,
          releaseVersion: RELEASE_VERSION,
          error: '连接 GitHub 失败: ' + err.message,
        });
      });
      return;
    }

    sendJson(res, 404, { success: false, error: 'Not Found' });
  } catch (err) {
    const status = err && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    sendJson(res, status, { success: false, error: err ? err.message : '服务内部错误', logs });
  }
});

function probeExistingLocalizerService(port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: HOST_BIND,
        port,
        path: '/api/status',
        headers: { Host: `${HOST_BIND}:${port}` },
        timeout: 1500,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { if (body.length < 8192) body += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(Boolean(parsed && typeof parsed === 'object' && 'currentVersion' in parsed && 'isInstalled' in parsed));
          } catch (_) {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 命令行参数白名单校验（issue #40）
const KNOWN_CLI_FLAGS = ['--apply-only', '--auto-restore', '--check-status', '--now'];
const unknownCliFlags = process.argv
  .slice(2)
  .filter((arg) => arg.startsWith('--') && arg.length > 2 && !KNOWN_CLI_FLAGS.includes(arg));
if (unknownCliFlags.length > 0) {
  console.error(`[参数错误] 未识别的命令行参数: ${unknownCliFlags.join(', ')}`);
  console.error(`可用参数: ${KNOWN_CLI_FLAGS.join(' | ')}`);
  console.error('如需启动 Web 管理面板，请不带任何参数运行: node localize.js');
  process.exit(1);
}

if (require.main === module) {
  if (process.argv.includes('--apply-only')) {
    try {
      applyTranslations();
      console.log('[成功] 静态文件汉化注入全部成功！');
      process.exit(0);
    } catch (err) {
      console.error('[失败] 汉化注入失败:', err.message);
      process.exit(1);
    }
  } else if (process.argv.includes('--auto-restore')) {
    (async () => {
      console.log('=======================================================');
      console.log('  Antigravity 2.0 汉化自动恢复程序 (官方更新后自动检查)');
      console.log('=======================================================\n');
      const defaultAppDir = getAppDir(getHostUsername(), true, '');
      const result = await executeAutoRestore({
        appDir: defaultAppDir,
        getResourcesDir,
        workspaceDir: WORKSPACE_DIR,
        releaseManager,
        isAppRunning: isAppRunningStrict,
        stopProcesses: killApp,
        forceStop: true,
      });
      console.log(result.message);
      if (result.success) {
        if (result.code === 'RESTORED') {
          console.log('\n[成功] 汉化已顺利恢复为最新状态。');
        } else {
          console.log('\n[状态正常] 客户端运行正常，无需重复操作。');
        }
        process.exit(0);
      } else if (result.code === 'VERSION_MISMATCH') {
        console.error('\n[版本警告] 发现官方版本更新，本地暂无兼容补丁。');
        process.exit(2);
      } else {
        console.error('\n[失败] 自动恢复汉化未能完成。');
        process.exit(1);
      }
    })().catch((err) => {
      console.error('[异常]', err.message);
      process.exit(1);
    });
  } else if (process.argv.includes('--check-status')) {
    (async () => {
      const defaultAppDir = getAppDir(getHostUsername(), true, '');
      const status = await checkClientStatus({ appDir: defaultAppDir, getResourcesDir });
      const patch = await findAvailablePatch({ workspaceDir: WORKSPACE_DIR, targetVersion: status.appVersion, releaseManager });
      console.log(JSON.stringify({ status, patch }, null, 2));
      process.exit(0);
    })().catch((err) => {
      console.error('[异常]', err.message);
      process.exit(1);
    });
  } else if (process.argv.includes('--now')) {
    const defaultAppDir = getAppDir(getHostUsername(), true, '');
    runLocalizationWorkflow(defaultAppDir)
      .then(() => {
        console.log('[成功] 汉化打包部署成功！');
        process.exit(0);
      })
      .catch((err) => {
        console.error('[失败] 汉化出错:', err.message);
        process.exit(1);
      });
  } else {
    server.on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        const isOurService = await probeExistingLocalizerService(PORT);
        if (isOurService) {
          console.log('\n======================================================');
          console.log(` [提示] Antigravity 2.0 汉化服务已经在运行中！(端口 ${PORT})`);
          console.log(` 本地管理面板: http://127.0.0.1:${PORT}`);
          console.log('======================================================\n');
          process.exit(0);
        } else {
          console.error(`\n[端口冲突] 端口 ${PORT} 已被其他无关程序占用，请释放该端口或通过环境变量 PORT 指定其他端口。`);
          process.exit(1);
        }
      } else {
        console.error('服务启动异常:', err.message);
        process.exit(1);
      }
    });

    server.listen(PORT, HOST_BIND, async () => {
      console.log('\n======================================================');
      console.log(' Antigravity 2.0 汉化服务已在后台运行！');
      console.log(` 本地管理面板: http://127.0.0.1:${PORT}`);
      console.log('======================================================\n');
      try {
        const defaultAppDir = getAppDir(getHostUsername(), true, '');
        const status = await checkClientStatus({ appDir: defaultAppDir, getResourcesDir });
        if (status.isInstalled) {
          if (status.isUpdateOverwritten) {
            log(`[状态检查] 检测到客户端已更新或处于原版状态 (v${status.appVersion || '未知'})，汉化尚未应用。`);
          } else {
            log(`[状态检查] 客户端已处于汉化状态 (v${status.appVersion || '未知'})。`);
          }
        }
      } catch (_) {}
    });
  }
}

module.exports = {
  CURRENT_VERSION,
  RELEASE_VERSION,
  PORT,
  HOST_BIND,
  CSRF_TOKEN,
  compareVersions,
  getHostUsername,
  getAppDir,
  getResourcesDir,
  cleanAppCache,
  applyTranslations,
  runLocalizationWorkflow,
  runRestoreWorkflow,
  writeLock,
  server,
};
