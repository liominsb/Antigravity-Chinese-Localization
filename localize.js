const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');
const { createReleaseManager } = require('./release-manager');
const { createPackageInstaller } = require('./package-installer');
const { isAppRunningStrict } = require('./process-check');
const { readAsarPackageVersion } = require('./asar-version');
const {
  isLocalizedAsar,
  checkClientStatus,
  executeAutoRestore,
  findAvailablePatch
} = require('./auto-restore');

const CURRENT_VERSION = '2.32.1';

function compareVersions(v1, v2) {
  const parse = (v) => (v || '').replace(/^[vV]/, '').split('.').map(n => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

const PORT = 3388;
const WORKSPACE_DIR = __dirname;
const EXTRACT_DIR = path.join(WORKSPACE_DIR, 'extracted');
const releaseManager = createReleaseManager({ workspaceDir: WORKSPACE_DIR });
const packageInstaller = createPackageInstaller({ workspaceDir: WORKSPACE_DIR, releaseManager, getAppDir,
  getResourcesDir, isAppRunning: isAppRunningStrict, stopProcesses: killApp });

let logs = [];

function log(msg) {
  const time = new Date().toLocaleTimeString();
  const formatted = `[${time}] ${msg}`;
  logs.push(formatted);
  console.log(formatted);
}

function getHostUsername() {
  return process.env.USER || process.env.USERNAME || (process.platform === 'win32' ? '11215' : 'ranger');
}

function getAsarCmd() {
  const majorVersion = parseInt(process.versions.node.split('.')[0], 10);
  if (majorVersion >= 18) {
    return 'npx -y @electron/asar';
  } else {
    return 'npx -y asar@3.2.0';
  }
}

// Check if Antigravity processes are running
function isAppRunning() {
  try {
    if (process.platform === 'win32') {
      const output = execSync('tasklist', { encoding: 'utf-8' }).toLowerCase();
      return output.includes('antigravity.exe') || output.includes('language_server.exe');
    } else if (process.platform === 'darwin') {
      execSync('pgrep -xi "antigravity|language_server"', { stdio: 'ignore' });
      return true;
    } else {
      execSync('pgrep -x "antigravity|language_server"', { stdio: 'ignore' });
      return true;
    }
  } catch (e) {
    return false;
  }
}

// Kill Antigravity processes and its language_server background processes
function killApp() {
  log('正在尝试关闭运行中的 Antigravity 2.0 及相关后台进程...');
  try {
    if (process.platform === 'win32') {
      try { execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' }); } catch (e) {}
      try { execSync('taskkill /F /IM language_server.exe', { stdio: 'ignore' }); } catch (e) {}
    } else if (process.platform === 'darwin') {
      try { execSync('pkill -xi antigravity', { stdio: 'ignore' }); } catch (e) {}
      try { execSync('pkill -xi language_server', { stdio: 'ignore' }); } catch (e) {}
    } else {
      try { execSync('pkill -x antigravity', { stdio: 'ignore' }); } catch (e) {}
      try { execSync('pkill -x language_server', { stdio: 'ignore' }); } catch (e) {}
    }
    log('已成功强制解除 Antigravity 及其语言服务器进程占用！');
  } catch (e) {
    log('Antigravity 未在运行或关闭时无需操作。');
  }
}

// 安全清理 Antigravity 客户端的渲染与编译缓存（不删除用户配置与账号）
function cleanAppCache(username) {
  log('正在扫描并安全清理 Antigravity 临时渲染与编译缓存...');
  const defaultUser = getHostUsername();
  const user = username ? username.trim() : defaultUser;
  let cacheRootDirs = [];

  if (process.platform === 'win32') {
    cacheRootDirs = [
      path.join('C:\\Users', user, 'AppData', 'Roaming', 'Antigravity'),
      path.join('C:\\Users', user, 'AppData', 'Roaming', 'antigravity'),
      path.join('C:\\Users', user, 'AppData', 'Local', 'antigravity')
    ];
  } else if (process.platform === 'darwin') {
    cacheRootDirs = [
      path.join('/Users', user, 'Library', 'Application Support', 'Antigravity'),
      path.join('/Users', user, 'Library', 'Caches', 'com.google.antigravity')
    ];
  } else {
    cacheRootDirs = [
      path.join('/home', user, '.config', 'Antigravity'),
      path.join('/home', user, '.cache', 'antigravity')
    ];
  }

  const targetSubDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage'];
  let cleanedCount = 0;

  for (const root of cacheRootDirs) {
    if (!fs.existsSync(root)) continue;
    for (const sub of targetSubDirs) {
      const fullPath = path.join(root, sub);
      if (fs.existsSync(fullPath)) {
        try {
          if (typeof fs.rmSync === 'function') {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.rmdirSync(fullPath, { recursive: true });
          }
          cleanedCount++;
          log(`已清理临时缓存: ${sub} (${root})`);
        } catch (e) {
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
  if ((useDefault === false || useDefault === 'false') && customPath) {
    dir = customPath.trim();
  } else {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const defaultUser = getHostUsername();
    const user = username ? username.trim() : defaultUser;
    if (isWin) {
      dir = `C:\\Users\\${user}\\AppData\\Local\\Programs\\antigravity`;
    } else if (isMac) {
      // macOS: /Applications/Antigravity.app/Contents/Resources/app.asar
      dir = `/Applications/Antigravity.app/Contents`;
    } else {
      dir = `/home/${user}/Antigravity/Antigravity-x64`;
    }
  }

  // macOS 特殊处理：如果路径指向 .app，自动补全 /Contents
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
  // 默认值：macOS 用大写，其他用小写
  return process.platform === 'darwin' ? upperPath : lowerPath;
}

// Web UI DOM Localization engine injection payload
const DOM_TRANSLATOR_INJECTION = `
// Antigravity 2.0 Chinese Localization Engine Enhanced
(function() {
  const dictionary = {
    // Top Bar & Menus
    "File": "文件",
    "Edit": "编辑",
    "View": "视图",
    "Selection": "选择",
    "Find": "查找",
    "Help": "帮助",
    "Docs": "文档",
    "Docs & API Reference": "文档与 API 参考",
    "Toggle Developer Tools": "开发者工具",
    "New Window": "新窗口",
    "Quit": "退出",
    "Cancel": "取消",
    "Confirm Quit": "确认退出",
    "Are you sure you want to quit?": "您确定要退出吗？",
    "There may be agents or background tasks running.": "可能还有智能体或后台任务正在运行。",
    "Connect to WSL": "连接到 WSL",
    "Reopen Locally": "本地重新打开",
    "WSL": "WSL",
    "WSL Environment": "WSL 环境",
    "WSL environment": "WSL 环境",
    "Distro": "发行版",
    "Distros": "发行版",
    "Default Distro": "默认发行版",
    "Setting up WSL": "正在配置 WSL",
    "Setting up WSL…": "正在配置 WSL...",
    "Downloading the Antigravity binary…": "正在下载 Antigravity 二进制组件…",
    "Downloading the Antigravity binary": "正在下载 Antigravity 二进制组件",
    "Installing into": "正在安装到",
    "Folder is on the Windows filesystem": "文件夹位于 Windows 文件系统",
    "Cannot open folder": "无法打开文件夹",
    "WSL distro not found": "未找到 WSL 发行版",
    "WSL setup failed": "WSL 配置失败",
    "Open workspace": "打开工作区",
    "Open workspaces": "打开工作区",
    "Open Workspace": "打开工作区",
    "Open Workspaces": "打开工作区",
    "Welcome to the new Antigravity!": "欢迎使用全新 Antigravity！",
    "Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named": "Antigravity 已经重构为以智能体为核心的全新平台。如果您仍需要代码编辑器，可以将其作为名为以下的独立应用下载：",
    "Antigravity IDE": "Antigravity IDE 编辑器",
    "Download the Antigravity IDE": "下载 Antigravity IDE",
    "Explore the new Antigravity": "探索全新 Antigravity",
    "Setting up…": "正在启动/设置中...",
    "Agent": "智能体",
    "Agents": "智能体",
    "Subagent": "子智能体",
    "Subagents": "子智能体",
    "Task": "任务",
    "Tasks": "任务",
    "Workspace": "工作区",
    "Workspaces": "工作区",
    "Command": "命令",
    "Run": "运行",
    "Settings": "设置",
    "Model": "模型",
    "Stop": "停止",
    "Approve": "批准",
    "Reject": "拒绝",
    "Terminal": "终端",
    "Output": "输出",
    "Codebase": "代码库",
    "Error": "错误",
    "Success": "成功",
    "Pending": "等待中",
    "Running": "运行中",
    "Completed": "已完成",
    "Failed": "已失败",
    "Branch": "分支",
    "Merge": "合并",
    "Conflict": "冲突",
    "Generate Image": "生成图像",
    "Web Search": "网页搜索",
    "Grep Search": "全局搜索",
    "Active Agents": "活跃智能体",
    "No agents running": "没有运行中的智能体",
    "active workspace": "活动工作区",
    "Active Workspace": "活动工作区",
    "Search": "搜索",
    "Search...": "搜索...",
    "Type a command...": "输入命令...",
    "Settings & Preferences": "设置与偏好",
    "General": "通用",
    "Themes": "主题",
    "Language": "语言",
    "Model Selection": "模型选择",
    "Advanced": "高级",
    "Developer": "开发者",
    "Save": "保存",
    "Close": "关闭",
    "Status": "状态",
    "Progress": "进度",
    "Logs": "日志",
    "Console": "控制台",
    "Running task...": "任务运行中...",
    "Task completed successfully": "任务成功完成",
    "An error occurred": "发生错误",
    "Connecting to Language Server...": "正在连接语言服务器...",
    "Language Server": "语言服务器",
    "Connected": "已连接",
    "Disconnected": "已断开",
    "Select a folder": "选择文件夹",
    "Open Folder": "打开文件夹",
    "Create Project": "创建项目",
    "create project": "创建项目",
    "New Project": "新建项目",
    "new project": "新建项目",
    "Create New Project": "创建新项目",
    "Open Project": "打开项目",
    "open project": "打开项目",
    "Reset Zoom": "重置缩放",
    "Toggle Fullscreen": "切换全屏",
    "Antigravity": "Antigravity",
    "Antigravity 2.0": "Antigravity 2.0",
    "Google DeepMind": "谷歌 DeepMind",
    "Advanced Agentic Coding": "高级智能体编码",
    "Welcome to Antigravity": "欢迎使用 Antigravity",
    "Get Started": "开始使用",
    "Create an agent to get started": "创建一个智能体以开始",
    "New Agent": "新建智能体",
    "Agent Name": "智能体名称",
    "System Prompt": "系统提示词",
    "Description": "描述",
    "Capabilities": "能力",
    "Write Files": "写入文件",
    "Run Commands": "运行命令",
    "Web Browsing": "网页浏览",
    "Define Subagents": "定义子智能体",
    "Call MCP Tools": "调用 MCP 工具",
    "Inherit Workspace": "继承工作区",
    "Branch Workspace": "分支隔离工作区",
    "Share Workspace": "共享工作区",
    "timer": "定时器",
    "Timers": "定时器",
    "Cron Jobs": "计划任务",
    "Schedule": "调度",
    "Directory analysis": "目录分析",
    "Web search": "网页搜索",
    "File edit": "文件编辑",
    "Command execution": "命令执行",
    "Semantic search": "语义搜索",

    // Added sentences & refined for user experience
    "Permissions": "权限",
    "Configure global allowed and denied resource permissions. Learn more.": "配置全局允许与拒绝的资源访问权限。了解更多。",
    "Configure global allowed and denied resource permissions.": "配置全局允许与拒绝的资源访问权限。",
    "Learn more.": "了解更多。",
    "Learn more": "了解更多",
    "Project-Specific Settings": "项目专属设置",
    "Project-Specific": "项目专属",
    "Modify scoped permissions, folders, and Agent settings like Sandbox and Terminal command execution.": "修改项目专属访问权限、工作文件夹以及智能体设置（例如沙盒和终端命令执行）。",
    "Modify scoped permissions, folders, and Agent settings": "修改项目专属访问权限、工作文件夹以及智能体设置",
    "like Sandbox and Terminal command execution.": "例如沙盒与终端命令执行。",
    "Go to Projects": "转到项目",
    "File Permissions": "文件权限",
    "File Access Rules": "文件访问规则",
    "Configure allowed and denied paths for file reads and writes.": "配置文件读写的允许与拒绝路径。",
    "Network Permissions": "网络权限",
    "Network Access Rules": "网络访问规则",
    "Configure allowed and denied URLs for reading.": "配置允许或禁止读取的 URL。",
    "Terminal & Tooling Permissions": "终端和工具权限",
    "Terminal Commands": "终端命令",
    "Configure allowed terminal commands.": "配置允许执行的终端命令。",
    "Commands Outside Sandbox": "沙盒外命令",
    "Configure allowed commands outside the sandbox.": "配置允许在沙盒外执行的终端命令。",
    "MCP Tools": "MCP 工具",
    "Tool Permissions": "工具权限",
    "Tool permissions": "工具权限",
    "工具 Permissions": "工具权限",
    "Configure external tools via Model Context Protocol.": "通过模型上下文协议 (MCP) 配置外部工具。",
    "Global": "全局",
    "Sandbox": "沙盒",
    "Sandbox enabled": "沙盒已启用",
    "Sandbox disabled": "沙盒已禁用",
    "Allowed": "已允许",
    "Denied": "已拒绝",
    "Paths": "路径",
    "URLs": "URL",
    "Tools": "工具",

    // Appearance & Settings
    "Appearance": "外观",
    "Configure the Agent's visual theme and display preferences.": "配置智能体的视觉主题与显示偏好。",
    "Chat Settings": "聊天设置",
    "Verbose Agent Chat": "显示智能体详细输出",
    "Display and preserve intermediate thinking steps": "显示并保留智能体中间思考过程",
    "Choose light, dark, or inherit system settings.": "选择浅色、深色，或继承系统设置。",
    "Dark": "深色",
    "Light": "浅色",
    "Light Theme": "浅色主题",
    "Preset": "预设",
    "Default Light": "默认浅色",
    "Background": "背景色",
    "Foreground": "前景色",
    "Accent": "强调色",
    "Dark Theme": "深色主题",
    "Default Dark": "默认深色",
    
    // Customizations
    "Customizations": "自定义",
    "Configure default behaviors, skills, and MCP servers.": "配置默认行为、技能以及 MCP 服务器。",
    "Token Usage": "Token 使用详情",
    "The breakdown below shows token usage from customizations like skills, rules, and MCP. If the budget is exceeded, large customizations will be truncated automatically.": "以下详情展示了来自技能、规则和 MCP 等自定义项的 Token 使用情况。如果额度超限，大型自定义内容将被自动截断。",
    "of the customization budget is available.": "的自定义额度可用。",
    "% of the customization budget is available.": "% 的自定义额度可用。",
    "% of the customization budget is available。": "% 的自定义额度可用。",
    "% of the customization budget is available": "% 的自定义额度可用。",
    "% of the budget is available.": "% 的自定义额度可用。",
    "% of the budget is available。": "% 的自定义额度可用。",
    "% of the customization budget is used.": "% 的自定义额度已使用。",
    "% of the customization budget is used。": "% 的自定义额度已使用。",
    "100.0% of the customization budget is available.": "100.0% 的自定义额度可用。",
    "No customizations found for this workspace.": "未找到此工作区的自定义项。",
    "Installed MCP Servers": "已安装的 MCP 服务器",
    "No MCP Servers": "无已安装的 MCP 服务器",
    "You currently don't have any MCP Servers installed.": "您当前未安装任何 MCP 服务器。",
    "Add an MCP server above": "在上方添加一个 MCP 服务器",
    // Build With Google Plugins & 官方插件生态
    "Build With Google Plugins": "使用 Google 插件构建",
    "Build with Google Plugins": "使用 Google 插件构建",
    "build with google plugins": "使用 Google 插件构建",
    "Google Plugins": "Google 插件",
    "Google plugins": "Google 插件",
    "Official Google plugins": "Google 官方插件",
    "Official Google plugins designed for Antigravity.": "专为 Antigravity 设计的 Google 官方扩展插件。",
    "Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products. You can always change your choices in Settings.": "插件是技能和 MCP 的打包集合，用于协助 Antigravity 中的智能体使用 Google 开发者产品。你可以随时在设置中更改你的选择。",
    "Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products. You can always change your choices in Settings": "插件是技能和 MCP 的打包集合，用于协助 Antigravity 中的智能体使用 Google 开发者产品。你可以随时在设置中更改你的选择",
    "Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products.": "插件是技能和 MCP 的打包集合，用于协助 Antigravity 中的智能体使用 Google 开发者产品。",
    "Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products": "插件是技能和 MCP 的打包集合，用于协助 Antigravity 中的智能体使用 Google 开发者产品",
    "You can always change your choices in Settings.": "你可以随时在设置中更改你的选择。",
    "You can always change your choices in Settings": "你可以随时在设置中更改你的选择",
    "Plugins are packaged collections of skills and MCPs to help the Agent in": "插件是技能和 MCP 的打包集合，用于协助智能体在",
    "Plugins are packaged collections of skills and MCPs to help the Agent in ": "插件是技能和 MCP 的打包集合，用于协助智能体在 ",
    "Antigravity work with Google developer products. You can always change your choices in Settings.": "Antigravity 中协同 Google 开发者产品工作。你可以随时在设置中更改你的选择。",
    "Antigravity work with Google developer products. You can always change your choices in Settings": "Antigravity 中协同 Google 开发者产品工作。你可以随时在设置中更改你的选择",
    "Antigravity work with Google developer products.": "Antigravity 中协同 Google 开发者产品工作。",
    "Antigravity work with Google developer products": "Antigravity 中协同 Google 开发者产品工作",
    "work with Google developer products. You can always change your choices in Settings.": "协同 Google 开发者产品工作。你可以随时在设置中更改你的选择。",
    "work with Google developer products. You can always change your choices in Settings": "协同 Google 开发者产品工作。你可以随时在设置中更改你的选择",
    "work with Google developer products.": "协同 Google 开发者产品工作。",
    "work with Google developer products": "协同 Google 开发者产品工作",
    "Plugins built and maintained by Google to extend Antigravity capabilities.": "由 Google 官方构建并维护，用于全面扩展 Antigravity 各项能力的插件。",
    "Explore, install, and manage plugins to enhance your agent with specialized skills, MCP servers, and rules.": "浏览、安装并管理插件，为智能体扩展专属技能、MCP 服务器与执行规则。",
    "Discover plugins to integrate with Google APIs, Cloud services, and developer tools.": "发现并集成适用于 Google API、云服务及开发者工具的官方插件。",
    "Install Plugin": "安装插件",
    "Uninstall Plugin": "卸载插件",
    "Enable Plugin": "启用插件",
    "Disable Plugin": "禁用插件",
    "Installed Plugins": "已安装插件",
    "Available Plugins": "可用插件",
    "All Plugins": "全部插件",
    "Featured Plugins": "精选插件",
    "Search plugins...": "搜索插件...",
    "Search plugins": "搜索插件",
    "No plugins found": "未找到相关插件",
    "No plugins installed": "尚未安装任何插件",
    "Loading plugins...": "正在加载插件列表...",
    "Failed to load plugins": "加载插件列表失败",
    "Reload plugins": "重新加载插件",
    "Check for plugin updates": "检查插件更新",
    "Plugin Settings": "插件设置",
    "Plugin details": "插件详情",
    "View details": "查看详情",
    "View Documentation": "查看文档",
    "View documentation": "查看文档",
    "Bundled Skills": "内置技能",
    "Bundled skills": "内置技能",
    "bundled skills": "内置技能",
    "Bundled Rules": "内置规则",
    "Bundled rules": "内置规则",
    "bundled rules": "内置规则",
    "Bundled MCP Servers": "内置 MCP 服务器",
    "Bundled MCP servers": "内置 MCP 服务器",
    "bundled MCP servers": "内置 MCP 服务器",
    "Bundled Hooks": "内置生命周期钩子",
    "bundled hooks": "内置生命周期钩子",
    "Skills included": "包含技能",
    "Rules included": "包含规则",
    "MCP servers included": "包含 MCP 服务器",
    "Hooks included": "包含钩子",
    "Author: Google": "作者: Google",
    "Browse and enable plugins from the Build With Google catalog.": "浏览并启用来自 Build With Google 目录的官方插件。",
    "Browse and enable plugins from the Build With Google catalog": "浏览并启用来自 Build With Google 目录的官方插件",
    "Use Add MCP to browse the store, or add a custom server via the MCP config.": "使用“添加 MCP”浏览应用商店，或通过 MCP 配置文件添加自定义服务器。",
    "Use Add MCP to browse the store, or add a custom server via the MCP config": "使用“添加 MCP”浏览应用商店，或通过 MCP 配置文件添加自定义服务器",
    "No MCP servers installed": "未安装任何 MCP 服务器",
    "Add MCP": "添加 MCP",
    "Open MCP Config": "打开 MCP 配置文件",
    "Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.": "与 GitHub 交互的执行规范；当命令因智能体环境受限失败时，向用户提请权限确认的指南。",
    // 官方 Firebase 与 Google Cloud 扩展插件深度汉化
    "Skills and MCP servers for building with Firebase.": "用于基于 Firebase 构建应用的专属技能与 MCP 服务器。",
    "Skills and MCP servers for building with Firebase": "用于基于 Firebase 构建应用的专属技能与 MCP 服务器",
    "Skills and MCP servers for working with Google Cloud.": "用于在 Google Cloud 云平台上进行开发的技能与 MCP 服务器。",
    "Skills and MCP servers for working with Google Cloud": "用于在 Google Cloud 云平台上进行开发的技能与 MCP 服务器",
    "Configure agent execution, queued message delivery, and permissions.": "配置智能体执行策略、消息队列发送机制以及安全权限。",
    "Configure agent execution, queued message delivery, and permissions": "配置智能体执行策略、消息队列发送机制以及安全权限",
    "Configure 智能体 执行, queued 消息 delivery, and 权限。": "配置智能体执行策略、消息队列发送机制以及安全权限。",
    "Configure 智能体 执行, queued 消息 delivery, and 权限": "配置智能体执行策略、消息队列发送机制以及安全权限",
    "Use Build With Google Plugins": "使用 Google 插件构建",
    "Use Build with Google Plugins": "使用 Google 插件构建",
    "Use Build With Google Plugins to": "使用 Google 插件构建以",
    "queued message delivery": "消息队列发送",
    "queued message": "排队消息",
    "queued messages": "排队消息",

    // ===== 官方插件市场 (Build with Antigravity Plugins) 深度全量汉化 =====
    "Build with Antigravity Plugins": "使用 Antigravity 插件构建",
    "Build with Antigravity plugins": "使用 Antigravity 插件构建",
    "Build With Antigravity Plugins": "使用 Antigravity 插件构建",
    "Build with Antigravity 插件": "使用 Antigravity 插件构建",
    "Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products. You can always change your choices in Settings.": "插件是技能与 MCP 服务器的打包集合，用于帮助 Antigravity 中的智能体更好地协同 Google 开发者产品。您可以随时在设置中更改配置。",
    "Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products.": "插件是技能与 MCP 服务器的打包集合，用于帮助 Antigravity 中的智能体更好地协同 Google 开发者产品。",
    "You can always change your choices in Settings.": "您可以随时在设置中更改配置。",

    // 1. Android
    "Core tools and knowledge required to develop for Android.": "面向 Android 应用开发所需的核心工具集与专业领域知识。",
    "Core tools and knowledge required to develop for Android": "面向 Android 应用开发所需的核心工具集与专业领域知识",
    "Core 工具 and knowledge required to develop 持续 Android": "面向 Android 应用开发所需的核心工具集与专业领域知识",
    "develop for Android": "Android 应用开发",

    // 2. Modern Web Guidance
    "Modern Web Guidance": "现代 Web 开发指南",
    "Keep your coding agent up to date with the latest web best practices.": "让您的编码智能体紧跟最新的 Web 最佳实践与现代技术规范。",
    "Keep your coding agent up to date with the latest web best practices": "让您的编码智能体紧跟最新的 Web 最佳实践与现代技术规范",
    "Keep your coding 智能体 已是最新版本 with the latest web best practices。": "让您的编码智能体紧跟最新的 Web 最佳实践与现代技术规范。",
    "Keep your coding 智能体 已是最新版本 with the latest web best practices": "让您的编码智能体紧跟最新的 Web 最佳实践与现代技术规范",
    "latest web best practices": "最新的 Web 最佳实践",

    // 3. Google Antigravity SDK
    "Google Antigravity SDK": "Google Antigravity SDK",
    "Using the Antigravity Python SDK to build AI agents.": "使用官方 Antigravity Python SDK 构建自定义 AI 智能体。",
    "Using the Antigravity Python SDK to build AI agents": "使用官方 Antigravity Python SDK 构建自定义 AI 智能体",
    "Using the Antigravity Python SDK to build AI 智能体": "使用官方 Antigravity Python SDK 构建自定义 AI 智能体",
    "build AI agents": "构建 AI 智能体",

    // 4. Science
    "Science": "科学研究",
    "Curated collection of agent skills for science.": "专为科学计算、学术研究与实验探索精选的智能体技能集合。",
    "Curated collection of agent skills for science": "专为科学计算、学术研究与实验探索精选的智能体技能集合",
    "agent skills for science": "科学研究智能体技能",

    // 5. Firebase
    "Prototype, build & run modern apps users love with Firebase's backend, AI, and operational infrastructure.": "借助 Firebase 强大的后端、AI 与运维基础设施，原型设计、构建并运行深受用户喜爱的现代应用程序。",
    "Prototype, build & run modern apps users love with Firebase's backend, AI, and operational infrastructure": "借助 Firebase 强大的后端、AI 与运维基础设施，原型设计、构建并运行深受用户喜爱的现代应用程序",
    "backend, AI, and operational infrastructure": "后端、AI 与运维基础设施",

    // 6. Chrome DevTools
    "Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer.": "在 Chrome 中结合 Chrome DevTools 与 Puppeteer，实现高可靠的自动化操作、深度调试与性能分析。",
    "Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer": "在 Chrome 中结合 Chrome DevTools 与 Puppeteer，实现高可靠的自动化操作、深度调试与性能分析",
    "in-depth debugging, and performance analysis in Chrome": "在 Chrome 中进行深度调试与性能分析",

    // 7. Dart and Flutter
    "Dart and Flutter": "Dart 与 Flutter",
    "Skills providing tailored instructions for happy path Dart and Flutter development workflows.": "为流畅、标准的 Dart 与 Flutter 开发工作流提供定制化指令与实践技能。",
    "Skills providing tailored instructions for happy path Dart and Flutter development workflows": "为流畅、标准的 Dart 与 Flutter 开发工作流提供定制化指令与实践技能",
    "happy path Dart and Flutter development workflows": "标准的 Dart 与 Flutter 开发工作流",

    // 8. Google Maps Platform
    "Google Maps Platform": "Google Maps Platform",
    "Build and prototype location-aware applications with Google Maps Platform. Integrate interactive maps, search and inspect Places details, calculate optimal routes.": "基于 Google Maps Platform 构建并原型设计位置感知应用。支持集成交互式地图、搜索与查看地点详情、计算最优行车路线。",
    "Build and prototype location-aware applications with Google Maps Platform. Integrate interactive maps, search and inspect Places details, calculate optimal routes": "基于 Google Maps Platform 构建并原型设计位置感知应用。支持集成交互式地图、搜索与查看地点详情、计算最优行车路线",
    "Integrate interactive maps, search and inspect Places details, calculate optimal routes.": "集成交互式地图、搜索与查看地点详情、计算最优行车路线。",
    "Integrate interactive maps, search and inspect Places details, calculate optimal routes": "集成交互式地图、搜索与查看地点详情、计算最优行车路线",

    // 9. Data Agent Kit
    "Data Agent Kit": "数据智能体套件",
    "Data 智能体 Kit": "数据智能体套件",
    "Specialized suite of skills for data engineers and database practitioners on Google Cloud.": "专为 Google Cloud 上的数据工程师与数据库从业者打造的专业技能套件。",
    "Specialized suite of skills for data engineers and database practitioners on Google Cloud": "专为 Google Cloud 上的数据工程师与数据库从业者打造的专业技能套件",
    "data engineers and database practitioners on Google Cloud": "Google Cloud 数据工程师与数据库从业者",

    // 官方首发插件 (gemini-api 及扩展体系) 长句深度汉化
    "Build applications with the Gemini Interactions API and Live API, including text generation, multi-turn chat, streaming, function calling, managed agents, and real-time audio/video.": "使用 Gemini Interactions API 和 Live API 构建应用，包括文本生成、多轮对话、流式响应、函数调用、托管智能体以及实时音视频处理。",
    "Use this skill when building applications with Gemini API hosted models, including Gemini and Gemma 4, working with multimodal content (text, images, audio, video), implementing function calling, using structured outputs, or needing current model specifications. Covers SDK usage (google-genai for Python, @google/genai for JavaScript/TypeScript, com.google.genai:google-genai for Java, google.golang.org/genai for Go), model selection, and API capabilities.": "在使用 Gemini API 托管模型（包括 Gemini 与 Gemma 4）构建应用、处理多模态内容（文本/图像/音频/视频）、实现函数调用、使用结构化输出或需要当前模型规格时使用此技能。覆盖各主流语言 SDK 使用、模型选择及 API 核心能力。",
    "Use this skill when writing code that calls the Gemini API for text generation, multi-turn chat, multimodal understanding, image generation, video generation, streaming responses, background research tasks, function calling, structured output, or migrating from the old generateContent API. This skill covers the Interactions API, the recommended way to use Gemini models and agents in Python and TypeScript.": "在编写调用 Gemini API 进行文本生成、多轮对话、多模态理解、图像/视频生成、流式响应、后台调研、函数调用、结构化输出或从旧版迁移时使用此技能。本技能覆盖 Interactions API，这是在 Python 和 TypeScript 中使用 Gemini 模型与智能体的官方推荐方式。",
    "Use this skill when building real-time, bidirectional streaming applications with the Gemini Live API. Covers WebSocket-based audio/video/text streaming, voice activity detection (VAD), native audio features, function calling, session management, ephemeral tokens for client-side auth, live translation, and all Live API configuration options. SDKs covered - google-genai (Python), @google/genai (JavaScript/TypeScript).": "在通过 Gemini Live API 构建低延迟双向实时流式应用时使用此技能。覆盖基于 WebSocket 的音视频/文本流、语音活动检测 (VAD)、原生音频特性、函数调用、会话管理、客户端临时令牌认证、实时翻译及所有 Live API 配置项。",
    "Use this skill for generative video editing, text-to-video, image-referenced video generation, first-frame-to-video, first-and-last-frame transitions, and video extensions using Gemini Omni 1.1 Flash (gemini-omni-1.1-flash) via the official google-genai SDK. Includes workflows for pre-processing/optimizing high-resolution or long source videos with ffmpeg, stripping audio for full sound regeneration, and handling turn-by-turn video editing and parallel execution.": "在使用 Gemini Omni 1.1 Flash (gemini-omni-1.1-flash) 通过官方 google-genai SDK 进行生成式视频编辑、文生视频、图像参考视频生成、首尾帧过渡及视频拓展时使用此技能。包含使用 ffmpeg 预处理优化高分辨率源视频、音频分离以及多轮分步编辑工作流。",
    "How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text and markdown.": "如何在对话中以内联方式或作为独立工件渲染丰富的交互式 HTML 小部件。当需要向用户展示架构图表、数据可视化、交互式控件、教程回顾或超出纯文本与 Markdown 的丰富视觉内容时使用此技能。",
    "Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work, their loading priority, discovery mechanisms, and to guide the creation of skills, rules, plugins, hooks, and MCP servers.": "Antigravity 自定义扩展系统的完整指南与技术参考。用于阐述自定义项的工作机制、加载优先级、自动发现机制，并指导技能、规则、插件、钩子及 MCP 服务器的创建。",
    "Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars). Activate this skill when the user asks questions about how to use, configure, or customize Antigravity, AGY, the agy CLI, the Antigravity IDE, or Antigravity 2.0.": "提供 Google Antigravity (AGY) 的完整指南、速查参考与系统导航，涵盖 Antigravity CLI (agy)、Antigravity 2.0、Antigravity IDE、Python SDK、斜杠命令、快捷键及自定义扩展（技能、规则、MCP、Sidecar）。",
    // Account
    "Account": "账号",
    "Manage your plan, credentials, and general preferences.": "管理您的计划、凭据和常规偏好。",
    "Enable Telemetry": "启用遥测",
    "When toggled on, Antigravity collects usage data to help Google enhance performance and features.": "开启后，Antigravity 会收集匿名使用数据，以帮助 Google 持续改进性能和功能。",
    "Marketing Emails": "营销电子邮件",
    "Receive product updates, tips, and promotions from Google Antigravity via email.": "通过电子邮件接收来自 Google Antigravity 的产品更新、技巧与促销信息。",
    "Your Plan:": "您的计划：",
    "Your Plan: Google AI Pro": "您的计划：Google AI Pro",
    "You can upgrade to a Google AI Ultra plan to receive the highest rate limits.": "您可以升级到 Google AI Ultra 计划以获得更高额的使用速率限制。",
    "Email": "电子邮件",
    "Labs": "实验室",
    "For help, visit": "如需帮助，请访问",
    "Follow the guide at": "请参考此指南：",
    "to back up your data and run the migration.": "以备份您的数据并执行迁移。",
    
    // Browser & App Settings
    "Browser Settings": "浏览器设置",
    "Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.": "配置浏览器子智能体。这需要安装 Google Chrome。可以在对话输入框中输入 /browser 来调用浏览器子智能体。",
    "Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing": "配置浏览器子智能体。这需要安装 Google Chrome。可以通过输入",
    "Configure the browser subagent. It requires": "配置浏览器子智能体。这需要",
    "in the conversation input box.": "在对话输入框中调用该子智能体。",
    "Browser Javascript Execution Policy": "浏览器 JavaScript 执行策略",
    "Controls whether the agent can run custom JavaScript to automate complex browser actions.": "控制智能体是否可以运行自定义 JavaScript 以自动化复杂的浏览器操作。",
    "Request Review": "需要人工审核",
    "Disabled": "已禁用",
    "Block all browser JavaScript execution.": "禁止执行所有浏览器 JavaScript。",
    "Prompt for approval before running browser scripts.": "在运行浏览器脚本前需人工批准。",
    "Allow full browser script execution without prompting.": "允许执行所有浏览器脚本（无需提示）。",
    "Actuation Permissions": "动作执行权限",
    "Browser Actuation Rules": "浏览器操作控制规则",
    "Configure allowed and denied URLs for browser actuation.": "配置允许或禁止浏览器执行动作的 URL 列表。",
    "App Settings": "应用设置",
    "Prevent Sleep": "防止计算机休眠",
    "Prevent the computer from sleeping while the app is running.": "在应用运行时防止计算机进入休眠状态。",
    "Keep In Menu Bar": "常驻系统托盘",
    "The app will be accessible from the menu bar and will keep running in the background when all windows are closed.": "关闭所有窗口后，应用将常驻菜单栏并在后台保持运行。",
    "Notifications": "通知",
    "Notification Settings": "通知设置",
    "To modify notification settings, open your operating system's system preferences.": "如需修改通知设置，请打开您操作系统的系统偏好设置。",

    // Agent Settings
    "Agent Settings": "智能体设置",
    "Security Preset": "安全预设",
    "Choose a predefined security preset for the agent. This controls terminal auto-execution policy, and file access policy.": "为智能体选择预定义的安全预设。这将控制终端自动执行策略和文件访问策略。",
    "Choose a predefined security preset for the agent.": "为智能体选择预定义的安全预设。",
    "This controls terminal auto-execution policy, and file access policy.": "这将控制终端自动执行策略和文件访问策略。",
    "Learn more about Default": "了解关于默认预设的更多信息",
    "Default": "默认",
    "Agent Behavior": "智能体行为",
    "Artifact Review Policy": "工件审核策略",
    "Specifies agent's behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.": "设置智能体在请求审核工件时的行为方式。工件是其为提供更丰富对话体验而创建的文档。",
    "Always Ask": "始终询问",
    "Plan Review": "计划审核",
    "Plan review": "计划审核",
    "Plan Review Policy": "计划审核策略",
    "Plan review policy": "计划审核策略",
    "Policy": "策略",
    "policy": "策略",
    "Type / and select plan to have the agent generate a plan.": "输入 / 并选择 plan 来让智能体生成计划。",
    "Type / and select plan to have the agent generate a plan": "输入 / 并选择 plan 来让智能体生成计划",
    "Type / and select 'plan' to have the agent generate a plan.": "输入 / 并选择 'plan' 来让智能体生成计划。",
    "Type / and select 'plan' to have the agent generate a plan": "输入 / 并选择 'plan' 来让智能体生成计划",
    "Type / and 选择 plan to have the agent generate a plan.": "输入 / 并选择 plan 来让智能体生成计划。",
    "Type / and 选择 plan to have the agent generate a plan": "输入 / 并选择 plan 来让智能体生成计划",
    "Type / and 选择 'plan' to have the agent generate a plan.": "输入 / 并选择 'plan' 来让智能体生成计划。",
    "Type / and 选择 'plan' to have the agent generate a plan": "输入 / 并选择 'plan' 来让智能体生成计划",
    "Type / and": "输入 / 并",
    "Type / and ": "输入 / 并 ",
    "Type / and select": "输入 / 并选择",
    "Type / and select ": "输入 / 并选择 ",
    "Type / and 选择": "输入 / 并选择",
    "Type / and 选择 ": "输入 / 并选择 ",
    "Type /": "输入 /",
    "Type / ": "输入 / ",
    "to have the agent generate a plan.": "来让智能体生成计划。",
    "to have the agent generate a plan": "来让智能体生成计划",
    "have the agent generate a plan.": "让智能体生成计划。",
    "have the agent generate a plan": "让智能体生成计划",
    "generate a plan.": "生成计划。",
    "generate a plan": "生成计划",
    "plan to have the agent generate a plan.": "plan 来让智能体生成计划。",
    "plan to have the agent generate a plan": "plan 来让智能体生成计划",
    "Never": "从不",
    "Always": "总是",
    "Auto": "自动",
    "Manual": "手动",
    "Ask": "询问",
    "Binary not found": "未找到核心二进制组件",
    "No updates available": "当前已是最新版本，暂无可用更新。",
    "No updates available.": "当前已是最新版本，暂无可用更新。",
    "Up to date": "已是最新版本",
    "Permission denied": "权限不足 / 无访问权限",
    "Permission denied.": "权限不足 / 无访问权限。",
    "Permissions and Memberships": "权限与成员资格",
    "Select all options that apply": "选择所有适用的选项",
    "Press ENTER to continue": "按回车键继续",
    "Additional Context": "附加上下文",
    "Directory not empty": "目录非空",
    "File already exists": "文件已存在",
    "File too large": "文件过大",
    "Filename too long": "文件名过长",
    "Not a directory": "不是有效目录",
    "Review this code": "审核此代码",
    "Review my design": "审核我的设计",
    "Review this paper": "审核此论文/文档",
    "Local Permissions": "项目专属权限",
    "Inherits from global settings. Local permissions have higher priority.": "继承自全局设置。项目专属权限具有更高的优先级。",
    "Inherits from global settings.": "继承自全局设置。",
    "Local permissions have higher priority.": "项目专属权限具有更高的优先级。",
    "Danger Zone": "危险区域",
    "Delete Project": "删除项目",
    "Permanently delete this project and all of its conversations.": "永久删除当前项目及其包含的所有历史对话。",
    
    // Additional Agent Settings & Context Menu
    "Custom": "自定义",
    "Outside of folders file access policy": "文件夹外文件访问策略",
    "Configures how the agent tries to access files outside of its working folders.": "配置智能体如何尝试访问其工作文件夹外部的文件。",
    "Terminal command Auto execution": "终端命令自动执行",
    "Controls whether terminal commands require your approval before running.": "控制终端命令在运行前是否需要您批准。",
    "Require Review": "需要审核",
    "Add Context": "添加上下文",
    "Media": "媒体",
    "Mentions": "提及",
    "Actions": "操作",
    "Browser": "浏览器",
    "Worktree": "工作树",
    "Projects": "项目",
    "Review Changes": "审核更改",
    "Ask anything, @ to mention, / for actions": "输入任何问题，输入 @ 提及，/ 触发操作",
    "Ask anything, @to mention, /for actions": "输入任何问题，输入 @ 提及，/ 触发操作",
    "Ask anything, @ to mention, / for commands": "输入任何问题，输入 @ 提及，/ 触发命令",
    "Ask anything, @to mention, /for commands": "输入任何问题，输入 @ 提及，/ 触发命令",
    "Overview": "概览",
    "Artifacts": "工件",
    "Conversations": "对话",
    "Agent settings and permissions for conversations outside of projects.": "项目外部对话的智能体设置和权限配置。",
    "Not in Project": "不在项目中",
    "Manage project folders, agent settings, and permissions.": "管理项目文件夹、智能体设置和专属权限。",

    // Security Presets
    "Requires manual review for all terminal commands and file accesses outside of the working folders.": "运行终端命令以及访问工作区外的文件时，均需手动人工审核。",
    "Full Machine": "完整本机访问",
    "All terminal commands require review. The agent can read or write to any file in the machine.": "所有终端命令均需审核，智能体可读写本机上的任意文件。",
    "Unrestricted": "无限制模式",
    "Disables all safety barriers for maximal iteration velocity.": "禁用所有安全屏障以获得极致的迭代效率。",
    "Manually customize individual settings.": "手动自定义各项具体设置。",
    "Always Proceed": "自动继续",

    // Themes
    "One Light": "One 浅色",
    "Solarized Light": "Solarized 浅色",
    "One Dark Pro": "One 深色 Pro",
    
    // Models
    "Configure AI models and view your quota.": "配置 AI 模型并查看您的配额与可用点数。",
    "Refresh": "刷新",
    "Model Credits": "模型额度",
    "Enable AI Credit Overages": "允许 AI 额度超限使用",
    "When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.": "开启后，当您的免费配额耗尽时，Antigravity 将使用您的 AI 点数来满足请求。系统会优先扣除免费模型配额，配额不足时再使用点数。",
    "Model Quota": "模型配额",
    "View your available model quota and AI credits. Model quota refreshes periodically based on your plan. Enable AI Credit Overages to continue using models when your quota is exhausted.": "查看您的可用模型配额与 AI 账户额度。模型配额会根据您的订阅计划定期刷新。额度耗尽后，可开启 AI 额度超限使用以继续体验。",

    // Shortcuts & UI
    "Shortcuts": "快捷键",
    "Keyboard shortcuts for quick navigation and control.": "用于快速导航与控制的键盘快捷键。",
    "Recommended": "推荐",
    "Open Conversation Picker": "打开对话选择器",
    "Open File Search": "打开文件搜索",
    "Focus Input": "聚焦输入框",
    "New Conversation": "新建对话",
    "Navigation": "导航",
    "Go Back": "后退",
    "Go Forward": "前进",
    "File Picker": "文件选择器",
    "Scheduled Tasks": "计划任务",
    "Select Previous Conversation": "选择上一个对话",
    "Select Next Conversation": "选择下一个对话",
    "Open Settings": "打开设置",
    "Conversation": "对话",
    "Conversation History": "历史对话",
    "Conversation history": "历史对话",
    "Toggle Model Selector": "切换模型选择器",
    "Toggle Voice Recording": "切换录音",
    "Find in Pane": "在窗格中查找",
    "Layout Controls": "布局控制",
    "Toggle Sidebar": "切换侧边栏",
    "Toggle Auxiliary Pane": "切换辅助窗格",
    "Zoom In": "放大",
    "Zoom Out": "缩小",
    "Reset Zoom": "重置缩放",

    // Feedback
    "Give Feedback": "提供反馈",
    "Give feedback": "提供反馈",
    "give feedback": "提供反馈",
    "Send Feedback": "发送反馈",
    "Send feedback": "发送反馈",
    "Share Feedback": "分享反馈",
    "Share feedback": "分享反馈",
    "Provide Feedback": "提供反馈",
    "Provide feedback": "提供反馈",
    "Feedback Type": "反馈类型",
    "Bug Report": "Bug 报告",
    "Feature Request": "功能请求",
    "Auth and Billing": "账号与计费",
    "General Feedback": "常规反馈",
    "Please describe the feature you'd like to see. The more detailed the requirements, the easier it will be for our team to incorporate your ideas. Some helpful information includes:": "请描述您希望获得的新功能。需求描述越详尽，我们的团队就越容易采纳您的想法。以下是一些建议提供的信息：",
    "What is missing in your workflow": "您的工作流中缺少了什么",
    "What you would like to see to address this gap in your workflow": "您希望通过什么功能来解决这一需求",
    "How this feature would help you and other users": "此功能如何帮助您和其他用户",
    "Describe the feature you would like to see...": "请描述您希望获得的新功能...",
    "Attach a screenshot (optional)": "添加屏幕截图（可选）",
    "Attach Antigravity server logs": "附带 Antigravity 服务器日志",
    "Send feedback as": "发送反馈身份",
    "We recommend attaching logs. Attaching logs will help the Antigravity team act on and prioritize your feedback.": "我们建议附带日志。这将有助于 Antigravity 团队更快速、更有针对性地处理您的问题。",

    // Automatic Update Menus
    "Checking for Updates...": "正在检查更新...",
    "Downloading Update...": "正在下载更新...",
    "Restart to Update": "重启以应用更新",
    "Check for Updates": "检查更新",
    "No updates available": "当前已是最新版本",
    "Update available": "发现新版本",
    "Downloading...": "正在下载...",
    "Update downloaded": "更新已下载完成",
    "Error checking for updates": "检查更新失败",

    // ===== 2.2.1 新增 UI 文本补充 =====
    // 窗口与原生 UI
    "Window": "窗口",
    "Install IDE": "安装 IDE",
    "App": "应用",

    // 偏好设置区
    "Inherits from": "继承自",
    "Rules": "规则",
    "Skills": "技能",
    "Plugin": "插件",
    "Plugins": "插件",
    "Customize": "自定义",
    "Setup": "设置",

    // 账号区
    "Google AI Pro": "Google AI Pro",
    "Upgrade": "升级",
    "Sign Out": "退出登录",
    "By using this app, you agree to its": "使用本应用即表示您同意其",
    "Terms of Service": "服务条款",
    "Google Drive integration not available": "Google 云端硬盘集成不可用",

    // 外观与编辑器
    "Select light, dark, or inherit system settings.": "选择浅色、深色，或继承系统设置。",
    "Configure editor-specific behaviors and shortcuts.": "配置编辑器专属行为与快捷键。",
    "Tab": "制表符",
    "Configure tab completion, suggestions, and navigation behavior.": "配置 Tab 补全、建议以及导航行为。",

    // 编辑器与市场
    "Marketplace": "扩展市场",
    "Marketplace Item URL": "扩展市场项目 URL",
    "Marketplace Gallery URL": "扩展市场图库 URL",
    "Changes the base URL on each extension page. You must restart Antigravity to use the new marketplace after changing this value.": "更改每个扩展页面的基础 URL。更改此值后，必须重启 Antigravity 才能使用新的扩展市场。",
    "Changes the base URL for marketplace search results. You must restart Antigravity to use the new marketplace after changing this value.": "更改扩展市场搜索结果的基础 URL。更改此值后，必须重启 Antigravity 才能使用新的扩展市场。",
    "To modify editor settings, open Settings within the editor window.": "如需修改编辑器设置，请在编辑器窗口中打开“设置”。",
    "Editor": "编辑器",
    "Editor Settings": "编辑器设置",
    "Open Editor Settings": "打开编辑器设置",

    // 浏览器子智能体
    "Configure the browser subagent.": "配置浏览器子智能体。",
    "Configure the browser subagent. It requires": "配置浏览器子智能体。这需要",
    "It requires": "它需要",
    "Google Chrome to be installed.": "安装 Google Chrome。",
    "The browser subagent can be invoked by typing": "可以通过输入",
    "/browser": "/browser",
    "in the conversation input box.": "在对话输入框中调用浏览器子智能体。",

    // 提及菜单 (@ Mentions)
    "Rules": "规则",
    "Conversation": "对话",
    "PDF Document": "PDF 文档",
    "MCP Resource": "MCP 资源",
    "Browser Page": "浏览器页面",
    "Browser Text": "浏览器文本",
    "Git Commit": "Git 提交",
    "Git Diff": "Git 差异",
    "Directory": "目录",

    // 对话区
    "Conversation Width": "对话宽度",
    "Configure the maximum width of the conversation panel.": "配置对话面板的最大宽度。",
    "New Conversation in Project": "项目内新建对话",
    "Show": "显示",
    "all": "全部",

    // 分解统计
    "breakdown": "明细",
    "breakdowns": "明细",

    // Google Chat / Jetski
    "Configure a chat bot so you can use Jetski directly from Google Chat.": "配置一个聊天机器人，以便您可以直接在 Google Chat 中使用 Jetski。",
    "Jetski Chat": "Jetski 聊天",
    "Setup Jetski Chat": "设置 Jetski 聊天",
    "Bot Name": "机器人名称",
    "Avatar URL": "头像 URL",
    "Enter bot name (optional)": "输入机器人名称（可选）",
    "Enter avatar URL (optional)": "输入头像 URL（可选）",
    "Chat Space": "聊天空间",
    "Continue to help, visit": "如需继续获取帮助，请访问",

    // 反馈区
    "Please describe the issue in detail. The more actionable your feedback, the quicker our team can address your request. Some helpful information includes:": "请详细描述您遇到的问题。反馈越具可操作性，我们的团队就能越快处理您的请求。以下是一些有用的信息：",
    "Steps to reproduce the issue": "问题复现步骤",
    "Expected behavior": "预期行为",
    "Actual behavior": "实际行为",
    "Any relevant information": "任何相关信息",
    "Any error messages": "任何错误消息",
    "Steps to Reproduce": "复现步骤",
    "Submit": "提交",
    "Describe the bug you encountered...": "请描述您遇到的 Bug...",
    "Please list the steps to reproduce the issue": "请列出复现该问题的步骤",

    // 通知与其他
    "Manage your notification preferences.": "管理您的通知偏好。",
    "Manage application settings.": "管理应用设置。",
    "Refresh quota and credits data": "刷新配额与额度数据",

    // 权限与提示
    "Local permissions have higher priority.": "项目专属权限具有更高的优先级。",
    "No conversations yet": "暂无对话",
    "No conversation yet": "暂无对话",
    "of the customization budget is available.": "的自定义额度可用。",

    // MCP 相关
    "Add MCP": "添加 MCP",
    "Add an MCP Server": "添加 MCP 服务器",

    // 单词补充(2.2.1 新出现的)
    "width": "宽度",
    "priority": "优先级",
    "quota": "配额",
    "credits": "额度",
    "preference": "偏好",
    "preferences": "偏好",
    "application": "应用",
    "subagent": "子智能体",
    "notification": "通知",
    "notifications": "通知",
    "bot": "机器人",
    "space": "空间",
    "visit": "访问",
    "editor": "编辑器",
    "marketplace": "扩展市场",
    "avatar": "头像",
    "name": "名称",
    "messages": "消息",
    "message": "消息",

    // ===== 第2轮验证新增 (2.2.1 配额/限额/aria-label) =====
    "Weekly Limit": "每周限额",
    "Five Hour Limit": "五小时限额",
    "Hourly Limit": "每小时限额",
    "Daily Limit": "每日限额",
    "Monthly Limit": "每月限额",
    "limit": "限额",
    "limits": "限额",
    "weekly": "每周",
    "hourly": "每小时",
    "customization": "自定义",
    "budget": "额度",
    "available": "可用",

    // 浏览器设置残片补全
    "to be installed.": "需要安装。",
    "to be installed": "需要安装",
    "or join the": "或加入",

    // 智能体执行标签与步骤状态 (Agent Execution Labels)
    "Ran command": "已运行命令",
    "Ran commands": "已运行命令",
    "Running command": "正在运行命令",
    "Running commands": "正在运行命令",
    "Run command": "运行命令",
    "Run commands": "运行命令",
    "Explored files, ran commands, edited files": "已探索文件、已执行命令、已编辑文件",
    "Explored files, ran commands, edited artifact": "已探索文件、已执行命令、已编辑工件",
    "Explored files, ran commands, edited artifacts": "已探索文件、已执行命令、已编辑工件",
    "Running commands, editing files": "正在运行命令、编辑文件",
    "Running commands, editing artifact": "正在运行命令、编辑工件",
    "Running commands, editing artifacts": "正在运行命令、编辑工件",
    "Checking command status": "正在检查命令状态",
    "Checked command status": "已检查命令状态",
    "Analyzing Task Log": "正在分析任务日志",
    "Analyzed Task Log": "已分析任务日志",
    "Analyzing content": "正在分析内容",
    "Analyzed content": "已分析内容",
    "Unknown file edit": "未知文件编辑",
    "termination request": "终止请求",
    "User cancelled agent execution.": "用户已取消智能体执行。",
    "User cancelled agent execution": "用户已取消智能体执行",
    "Agent execution failed.": "智能体执行失败。",
    "Agent execution failed": "智能体执行失败",
    "The agent has encountered an internal error.": "智能体遇到了内部错误。",
    "Used MCP tool": "调用 MCP 工具",
    "Used tool": "调用工具",
    "Generated image": "已生成图像",
    "Browser task": "浏览器任务",
    "Opened browser": "已打开浏览器",
    "Read URL": "读取 URL",
    "Searched web": "网页搜索",
    "Invoked subagent": "调用子智能体",
    "Git commit": "Git 提交",
    "Searched for files": "搜索文件",
    "Searched files": "已搜索文件",
    "Code search": "代码搜索",
    "Internal search": "内部搜索",

    // ===== 2.26.0 界面文案补充（依据 Web UI bundle 全量比对 + 运行时 DOM 抓取）=====
    // 环境 / 选择器
    "Select Environment": "选择环境",
    "Local": "本地",
    "Toggle Environment Selector": "切换环境选择器",
    "Toggle Project Selector": "切换项目选择器",
    "Select Billing Model": "选择计费模型",
    "Select Default Branch": "选择默认分支",
    "Select All": "全选",
    "Select Agent": "选择智能体",
    "Select Project": "选择项目",
    "Select Resource(s)": "选择资源",
    "Select Theme": "选择主题",
    "Select Workspace": "选择工作区",
    "Select Worktree": "选择工作树",
    "Select Folder(s)": "选择文件夹",
    "Select category to search...": "选择要搜索的分类...",
    "Select a model in the model selector": "在模型选择器中选择模型",
    "Select a model to send message": "选择要发送消息的模型",
    "Select workspace to send message": "选择要发送消息的工作区",
    "Select your license": "选择你的许可证",
    "Select an option": "选择一个选项",
    "Choose Region": "选择区域",
    "Choose a License": "选择许可证",
    "Open Agent on Reload": "窗口重载时打开智能体面板",
    "Open the agent panel on window reload": "窗口重载时打开智能体面板",
    "Open Browser Setup": "打开浏览器设置",
    "Open Command Palette": "打开命令面板",
    "Open Commit Graph": "打开提交图",
    "Open Conversation": "打开对话",
    "Open Conversation History": "打开对话历史",
    "Open File": "打开文件",
    "Open Keyboard Shortcuts": "打开键盘快捷键",
    "Open Preferences": "打开首选项",
    "Open Preview": "打开预览",
    "Open Project Picker": "打开项目选择器",
    "Open Search": "打开搜索",
    "Open Tabs": "打开标签页列表",
    "Open Terminal": "打开终端",
    "Open Workspace Selector": "打开工作区选择器",
    "Open in Browser": "在浏览器中打开",
    "Open in Built-in Browser": "在内置浏览器中打开",
    "Open in External Browser": "在外部浏览器中打开",
    "Open in New Tab": "在新标签页中打开",
    "Open in New Window": "在新窗口中打开",
    "Open in Preview": "在预览中打开",
    "Open in Preview Tab": "在预览标签页中打开",
    "Open in Side Pane": "在侧边窗格中打开",
    "Open in Tab": "在标签页中打开",
    "Open in Notebook View": "在笔记本视图中打开",
    "Open in external browser": "在外部浏览器中打开",
    "Open in Critique": "在 Critique 中打开",
    "Open link": "打开链接",
    "Open plugin page": "打开插件页面",
    "Open project settings": "打开项目设置",
    "Open settings menu": "打开设置菜单",
    "Open skill page": "打开技能页面",
    "Open the change": "打开该更改",
    "Open the page in system browser": "在系统浏览器中打开该页面",
    "Open search in external browser": "在外部浏览器中搜索",
    "Open System Browser": "打开系统浏览器",
    "Open System Preferences": "打开系统偏好设置",
    "Open Launchpad": "打开 Launchpad",
    "Open Hub": "打开 Hub",
    "View Debug": "查看调试",
    "View Diff": "查看差异",
    "View File": "查看文件",
    "View Logs": "查看日志",
    "View Page": "查看页面",
    "View comments": "查看评论",
    "View network request": "查看网络请求",
    "View network requests": "查看网络请求",
    "View or edit comment": "查看或编辑评论",
    "View archived in the sidebar": "在侧边栏中查看已归档",
    "View full search results": "查看完整搜索结果",
    "Toggle Editor": "切换编辑器",
    "Toggle File Viewer": "切换文件查看器",
    "Toggle Overview Panel": "切换概览面板",
    "Toggle Status Bar": "切换状态栏",
    "Toggle Thumbnails": "切换缩略图",
    "Toggle Sidebar, conversations need attention": "切换侧边栏（有对话需要关注）",
    "Show All": "显示全部",
    "Show details": "显示详情",
    "Show or Hide Plugins": "显示或隐藏插件",
    "Show suggestions when typing in the editor": "在编辑器中输入时显示建议",
    "Show temporary and forked workspaces": "显示临时及派生工作区",
    "Show token": "显示令牌",
    "Hide token": "隐藏令牌",
    "Hide Thumbnail Sidebar": "隐藏缩略图侧边栏",
    "Show Thumbnail Sidebar": "显示缩略图侧边栏",
    "Show all resources": "显示全部资源",
    "Show fewer resources": "显示更少资源",
    "Show more results on Agent Market": "在智能体市场显示更多结果",
    "Show settings anyway": "仍然显示设置",
    "Close Sidebar": "关闭侧边栏",
    "Close panel": "关闭面板",
    "Close skills panel": "关闭技能面板",
    "Close Logs Modal": "关闭日志弹窗",
    "Close Other Tabs": "关闭其他标签页",
    "Close Settings": "关闭设置",
    "Close Tab": "关闭标签页",
    "Close Tabs to the Right": "关闭右侧标签页",
    "Close Terminal Tab": "关闭终端标签页",
    "Pin Tab": "固定标签页",
    "Unpin Tab": "取消固定标签页",
    "Tab to Jump": "Tab 键跳转",
    "Tab to Import": "Tab 键导入",
    "Next Page": "下一页",
    "Previous Page": "上一页",
    "Next match": "下一个匹配",
    "Previous match": "上一个匹配",
    "Next question": "下一个问题",
    "Previous question": "上一个问题",
    "Next side question": "下一个侧边问题",
    "Previous side question": "上一个侧边问题",
    "Next Aux Pane Tab": "下一个辅助窗格标签",
    "Previous Aux Pane Tab": "上一个辅助窗格标签",
    "Next toast": "下一个通知",
    "Previous toast": "上一个通知",
    "Collapse Diffs": "折叠差异",
    "Expand Diffs": "展开差异",
    "Collapse queued messages": "折叠排队消息",
    "Expand queued messages": "展开排队消息",
    "Collapse subagents": "折叠子智能体",
    "Expand subagents": "展开子智能体",
    "Collapse idle": "折叠空闲项",
    "Collapse string": "折叠字符串",
    "Expand long string": "展开长字符串",
    "Collapse toast": "折叠通知",
    "Add All": "全部添加",
    "Add Custom Model": "添加自定义模型",
    "Add Model": "添加模型",
    "Add Workspace": "添加工作区",
    "Add Terminal": "添加终端",
    "Add Folder": "添加文件夹",
    "Add Resource": "添加资源",
    "Add Handler": "添加处理器",
    "Add Hook Card": "添加钩子卡片",
    "Add to Chat": "添加到对话",
    "Add to allowlist": "添加到允许列表",
    "Create New": "新建",
    "Create a Project": "创建项目",
    "Create project from scratch": "从零开始创建项目",
    "Create a Plugin with the Agent": "借助智能体创建插件",
    "Create with Prompt": "使用提示词创建",
    "Remove All": "全部移除",
    "Remove audio": "移除音频",
    "Remove policy": "移除策略",
    "Remove resource": "移除资源",
    "Delete Task": "删除任务",
    "Delete Terminal": "删除终端",
    "Delete agent": "删除智能体",
    "Delete plugin": "删除插件",
    "Delete workspace": "删除工作区",
    "Delete Handler": "删除处理器",
    "Delete Hook": "删除钩子",
    "Delete comment": "删除评论",
    "Delete Data Directory": "删除数据目录",
    "Delete Permanently": "永久删除",
    "Delete organization policy": "删除组织策略",
    "Delete repository policy": "删除仓库策略",
    "Rename Conversation": "重命名对话",
    "Edit Conversation Title": "编辑对话标题",
    "Restore Conversation": "恢复对话",
    "Archive This Conversation": "归档此对话",
    "Conversation Archived": "对话已归档",
    "Conversation unavailable": "对话不可用",
    "Conversation turns": "对话轮次",
    "Conversation navigator off": "对话导航器已关闭",
    "Conversation copied as Markdown to clipboard": "对话已以 Markdown 复制到剪贴板",
    "Move Down": "下移",
    "Move Up": "上移",
    "Move to New Group": "移到新分组",
    "Group Actions": "分组操作",
    "Sort By": "排序方式",
    "Sort By Input Model": "按输入模型排序",
    "Sort Projects": "排序项目",
    "Sort Workspaces": "排序工作区",
    "Sort and filter conversations": "排序并筛选对话",
    "Review pending conversations": "审查待处理的对话",
    "Copy Message": "复制消息",
    "Copy as Markdown": "复制为 Markdown",
    "Copy output": "复制输出",
    "Copy response": "复制回复",
    "Copy value": "复制值",
    "Copy email address": "复制邮箱地址",
    "Copy sign-in link": "复制登录链接",
    "Link copied to clipboard.": "链接已复制到剪贴板。",
    "Paste code": "粘贴代码",
    "Paste code here": "在此粘贴代码",
    "Paste key": "粘贴密钥",
    "Paste auth code": "粘贴认证码",
    "Replace with": "替换为",
    "Search conversations...": "搜索对话...",
    "Search files...": "搜索文件...",
    "Search across files...": "跨文件搜索...",
    "Search projects...": "搜索项目...",
    "Search workspaces...": "搜索工作区...",
    "Search for commands...": "搜索命令...",
    "Search for conversations...": "搜索对话...",
    "Search for files in the project...": "在项目中搜索文件...",
    "Search for content to open": "搜索要打开的内容",
    "Search complete": "搜索完成",
    "Search failed": "搜索失败",
    "Search results": "搜索结果",
    "Find in Conversation": "在对话中查找",
    "Clear Search": "清除搜索",
    "Clear search": "清除搜索",
    "Clear filter": "清除筛选",
    "Clear all": "全部清除",
    "Filter resources...": "筛选资源...",
    "Loading apps...": "正在加载应用...",
    "Loading available plugins...": "正在加载可用插件...",
    "Loading custom agents...": "正在加载自定义智能体...",
    "Loading customizations...": "正在加载自定义项...",
    "Loading events...": "正在加载事件...",
    "Loading hooks...": "正在加载钩子...",
    "Loading installed plugins...": "正在加载已安装插件...",
    "Loading instances...": "正在加载实例...",
    "Loading licenses...": "正在加载许可证...",
    "Loading models...": "正在加载模型...",
    "Loading page": "正在加载页面",
    "Loading resources...": "正在加载资源...",
    "Loading skills...": "正在加载技能...",
    "Loading subagent...": "正在加载子智能体...",
    "Loading token usage...": "正在加载令牌用量...",
    "Loading trajectory...": "正在加载轨迹...",
    "Loading workspace customizations...": "正在加载工作区自定义项...",
    "Loading worktrees...": "正在加载工作树...",
    "Loading Notebook View...": "正在加载笔记本视图...",
    "Agent Auto-Fix Lints": "智能体自动修复 Lint",
    "Agent Edits": "智能体编辑",
    "Agent Team": "智能体团队",
    "Agent options": "智能体选项",
    "Agent Hooks Configuration": "智能体钩子配置",
    "Agent Security Settings": "智能体安全设置",
    "Agent security mode": "智能体安全模式",
    "Agent finished": "智能体已完成",
    "Agent stopped": "智能体已停止",
    "Agent encountered an internal error.": "智能体遇到内部错误。",
    "Agent terminated due to error": "智能体因错误而终止",
    "Agent data is not available": "智能体数据不可用",
    "Accept Step": "接受步骤",
    "Reject Step": "拒绝步骤",
    "Cancel Step": "取消步骤",
    "Cancel step": "取消步骤",
    "Cancel All Tasks": "取消所有任务",
    "Cancel Generation": "取消生成",
    "Cancel recording": "取消录音",
    "Cancel Sending Message": "取消发送消息",
    "Stop All Subagents": "停止所有子智能体",
    "Stop Subagent": "停止子智能体",
    "Stop subagent": "停止子智能体",
    "Stop Task": "停止任务",
    "Stop Voice Recording": "停止语音录制",
    "Stop recording": "停止录音",
    "Task Log": "任务日志",
    "Task Logs": "任务日志",
    "Task not found": "未找到任务",
    "Continue Response": "继续回复",
    "Explain and Fix": "解释并修复",
    "Debug and fix": "调试并修复",
    "Help me understand the current context.": "帮我理解当前上下文。",
    "Run Now": "立即运行",
    "Send Now": "立即发送",
    "Stop Recording and Send": "停止录音并发送",
    "Mute mic": "静音麦克风",
    "Unmute mic": "取消静音麦克风",
    "Project Settings": "项目设置",
    "Project Folders": "项目文件夹",
    "Project Agent": "项目智能体",
    "Project not found": "未找到项目",
    "Project already exists": "项目已存在",
    "Project management is not available": "项目管理不可用",
    "Workspace Settings": "工作区设置",
    "Workspace Creation": "创建工作区",
    "Workspace File Access": "工作区文件访问",
    "Workspace Web Access": "工作区网络访问",
    "Workspace Command Access": "工作区命令访问",
    "Workspace File Explorer": "工作区文件浏览器",
    "Workspace name cannot be empty": "工作区名称不能为空",
    "Workspace setup warning": "工作区设置警告",
    "Workspace mismatch actions": "工作区不匹配操作",
    "Workspace folder suggestions": "工作区文件夹建议",
    "Fork in Current Workspace": "在当前工作区中派生",
    "Fork in New Workspace": "在新工作区中派生",
    "Fork in Shared Workspace": "在共享工作区中派生",
    "Fork conversation in this folder": "在此文件夹中派生对话",
    "Fork warning": "派生警告",
    "Archive Workspace": "归档工作区",
    "Archive project": "归档项目",
    "Allow List Terminal Commands": "终端命令允许列表",
    "Deny List Terminal Commands": "终端命令拒绝列表",
    "Advanced Command Access": "高级命令访问",
    "Advanced File Access": "高级文件访问",
    "Advanced Web Access": "高级网络访问",
    "Agent Non-Workspace File Access": "智能体非工作区文件访问",
    "Run terminal commands with sandbox restrictions.": "在沙盒限制下运行终端命令。",
    "Terminal commands the agent can execute.": "智能体可执行的终端命令。",
    "Review permissions": "审查权限",
    "Confirm Browser Interaction": "确认浏览器交互",
    "Manage Permissions": "管理权限",
    "Manage Hooks": "管理钩子",
    "Manage Skills": "管理技能",
    "Configure Branches": "配置分支",
    "Configure Worktree Branches": "配置工作树分支",
    "Configure GitHub access policies.": "配置 GitHub 访问策略。",
    "Review Policy": "审查策略",
    "Enable Notifications": "启用通知",
    "Enable Chat": "启用对话",
    "Enable Overages": "启用超额用量",
    "Enable Shell Integration": "启用 Shell 集成",
    "Enable Text Selection": "启用文本选择",
    "Disable Text Selection": "禁用文本选择",
    "Font Size": "字号",
    "Zoom Level": "缩放级别",
    "Tab Speed": "标签建议速度",
    "Debug Mode": "调试模式",
    "General Compactor": "常规压缩器",
    "General Punctuation": "常规标点",
    "General work": "常规工作",
    "Settings Unavailable": "设置不可用",
    "Reset Onboarding": "重置引导流程",
    "Reset to preset": "重置为预设",
    "Switch to Dark Mode": "切换到深色模式",
    "Switch to Light Mode": "切换到浅色模式",
    "Switch Roles": "切换角色",
    "Set the speed of tab suggestions": "设置标签建议速度",
    "Set Project Name": "设置项目名称",
    "Editor background color.": "编辑器背景色。",
    "Editor default foreground color.": "编辑器默认前景色。",
    "Input box background.": "输入框背景色。",
    "Input box border.": "输入框边框色。",
    "Input box foreground.": "输入框前景色。",
    "Input box foreground color for placeholder text.": "输入框占位文本前景色。",
    "Output view background color.": "输出视图背景色。",
    "Output view sticky scroll background color.": "输出视图粘性滚动背景色。",
    "Font size used for a label.": "标签使用的字号。",
    "Layout Hierarchy": "布局层级",
    "Layout Partition": "布局分区",
    "Layout Partitioning": "布局分区",
    "Debug view layout": "调试视图布局",
    "Apply layout results": "应用布局结果",
    "Find roots": "查找根目录",
    "Branch Changes": "分支更改",
    "Stage change": "暂存更改",
    "Stage and commit all changes": "暂存并提交所有更改",
    "Discard unstaged changes": "丢弃未暂存的更改",
    "Revert file changes": "还原文件更改",
    "Commit message cannot be empty": "提交信息不能为空",
    "Commit staged changes": "提交已暂存的更改",
    "Commit succeeded": "提交成功",
    "Push succeeded": "推送成功",
    "Pull requests": "拉取请求",
    "Pull request creation": "创建拉取请求",
    "Open a pull request": "打开拉取请求",
    "Open a merge request": "打开合并请求",
    "Merge Conflict": "合并冲突",
    "Undo to Here": "撤销到此处",
    "Run in a new worktree": "在新的工作树中运行",
    "Run in a new git worktree": "在新的 Git 工作树中运行",
    "Run in your current workspace": "在当前工作区中运行",
    "Download File": "下载文件",
    "Download image": "下载图片",
    "Download video": "下载视频",
    "Download Diagnostics": "下载诊断信息",
    "Upload Files": "上传文件",
    "Upload to Agent": "上传给智能体",
    "Upload to Google Drive": "上传到 Google 云端硬盘",
    "Upload Debug Bundle": "上传调试包",
    "Upload debug bundle": "上传调试包",
    "Show in File Explorer": "在文件资源管理器中显示",
    "Show in File Manager": "在文件管理器中显示",
    "Read Files": "读取文件",
    "Read files": "读取文件",
    "Read URLs": "读取网址",
    "Read page": "读取页面",
    "Read Browser Page in Browser": "在浏览器中读取页面",
    "Export Artifact": "导出构件",
    "Export artifact": "导出构件",
    "Install Update": "安装更新",
    "Update Anyway": "仍然更新",
    "Reload app": "重新加载应用",
    "Reload this window.": "重新加载此窗口。",
    "Restart Main Language Server": "重启主语言服务器",
    "Confirm Window Reload": "确认重载窗口",
    "Confirm Undo": "确认撤销",
    "Confirm Selection": "确认选择",
    "Back to": "返回到",
    "Back to home": "返回首页",
    "Generate Share Link": "生成分享链接",
    "Generate personalized rules": "生成个性化规则",
    "Mention Page": "提及页面",
    "Command Center": "命令中心",
    "Command Setup Script": "命令设置脚本",
    "Agent Market Search Results": "智能体市场搜索结果",
    "Connect your account to browse": "连接账号以浏览",
    "Continue with Google": "使用 Google 继续",
    "Continue with Google Cloud": "使用 Google Cloud 继续",
    "Continue with different account": "使用其他账号继续",
    "Sign in again": "重新登录",
    "Sign in with a different account": "使用其他账号登录",
    "Log back in": "重新登录",
    "Log in to use the agent": "登录以使用智能体",
    "Refresh Skills": "刷新技能",
    "Refresh skills": "刷新技能",
    "Refresh all credentials": "刷新所有凭据",
    "Refresh custom agents": "刷新自定义智能体",
    "Refresh customizations": "刷新自定义项",
    "Refresh skills paths": "刷新技能路径",
    "Write a comment...": "写评论...",
    "Write and edit docs": "编写和编辑文档",
    "Save Comment": "保存评论",
    "Edit Comment": "编辑评论",
    "Edit comment": "编辑评论",
    "Submit comment": "提交评论",
    "Submit Appeal": "提交申诉",
    "Pick at most 2 reasons": "最多选择 2 个原因",
    "Input required": "需要输入",
    "Model quota reached": "已达模型配额",
    "Model selector loading": "正在加载模型选择器",
    "Model Label": "模型标签",
    "Add not supported on this list": "此列表不支持添加",
    "Remove not supported on this list": "此列表不支持移除",
    "Set not supported on this list": "此列表不支持设置",
    "write access to this path": "对此路径的写入权限",
    "read access to this path": "对此路径的读取权限",
    "terminal auto execution policy value": "终端自动执行策略值",
    "lint error": "Lint 错误",
    // ===== 2.26.0 补充：作者漏翻 + React 片段化整句 =====
    "Models within this group": "本组内的模型",
    "Windows Subsystem for Linux": "适用于 Linux 的 Windows 子系统",
    "Run the app against a Linux environment. Connecting relaunches the app into the selected WSL distro.": "在 Linux 环境中运行应用。连接后会将应用重新启动到所选的 WSL 发行版。",
    // ===== 2.28.0 新增：内置浏览器、通行密钥、安全沙箱与标签页 =====
    "Choose a Passkey": "选择通行密钥 (Passkey)",
    "Choose a passkey": "选择通行密钥",
    "Select a passkey account to continue:": "选择通行密钥账号以继续：",
    "Select a passkey account to continue": "选择通行密钥账号以继续",
    "Passkey": "通行密钥",
    "Passkeys": "通行密钥",
    "Passkey QR code": "通行密钥二维码",
    "Passkey QR Code": "通行密钥二维码",
    "Scan with your phone": "使用手机扫码",
    "Use a phone or tablet": "使用手机或平板电脑",
    "Security State": "安全状态",
    "Secure Connection": "安全连接",
    "Insecure Connection": "不安全连接",
    "Connection is secure": "连接安全",
    "Connection is not secure": "连接不安全",
    "Certificate valid": "证书有效",
    "Certificate invalid": "证书无效",
    "Script Jail": "脚本安全沙箱",
    "Script jail": "脚本安全沙箱",
    "Script execution failed": "脚本执行失败",
    "Script aborted by host": "脚本已被宿主中止",
    "Webview Browser": "内置浏览器",
    "Open in Browser": "在浏览器中打开",
    "Open in Default Browser": "在默认浏览器中打开",
    "Open in New Window": "在新窗口中打开",
    "Open Link in New Tab": "在新标签页中打开链接",
    "Open link in new tab": "在新标签页中打开链接",
    "New Tab": "新标签页",
    "Close Tab": "关闭标签页",
    "Close Other Tabs": "关闭其他标签页",
    "Close Tabs to the Right": "关闭右侧标签页",
    "Reload Tab": "重新加载标签页",
    "Duplicate Tab": "复制标签页",
    "Pin Tab": "固定标签页",
    "Unpin Tab": "取消固定标签页",
    "Mute Tab": "静音标签页",
    "Unmute Tab": "取消静音标签页",
    "Back": "后退",
    "Forward": "前进",
    "Copy URL": "复制链接",
    "Copy link address": "复制链接地址",
    "View Page Source": "查看网页源代码",
    "Inspect Element": "检查元素",
    "Zoom 100%": "缩放 100%",



    // aria-label 无障碍标签 (这些会影响屏幕阅读器与提示)
    "Sidebar": "侧边栏",
    "Display Options": "显示选项",
    "Message input": "消息输入框",
    "Record voice memo": "录制语音备忘",
    "Typeahead menu": "预输入菜单",
    "voice memo": "语音备忘",
    "memo": "备忘",
    "typeahead": "预输入",

    // ===== 第3轮验证补充 =====
    "current": "当前",
    "Choose a model": "选择模型",
    "Select model": "选择模型",
    "current model": "当前模型",

    // ===== 第4轮验证补充 (显示选项下拉菜单) =====
    "Group By": "分组方式",
    "Last Updated": "最近更新",
    "Alphabetical (A-Z)": "字母顺序 (A-Z)",
    "Date Added": "添加日期",
    "Subtitles": "副标题",
    "No Subtitle": "无副标题",
    "Filter": "筛选",
    "Scheduled": "已计划",
    "Environment": "环境",
    "None": "无",
    "Fast": "快速",
    "Sort Conversations": "对话排序",
    "Last Prompt": "最新提示词",
    "Last prompt": "最新提示词",
    "Archived Only": "仅已归档",
    "Active Only": "仅活跃",
    "Pinned Only": "仅置顶",
    "Unarchived Only": "仅未归档",
    "Last 7 days": "最近 7 天",
    "Last 24 hours": "最近 24 小时",
    "Last 30 days": "最近 30 天",
    "Display": "显示",

    // 第5轮: 单数形式补全 (分组选项)
    "Project": "项目",
    "project": "项目",
    "projects": "项目",
    "Conversation": "对话",
    "conversation": "对话",
    "Workspace": "工作区",
    "workspace": "工作区",

    // ===== 第6轮彻底验证补充 =====
    // 窗口控制
    "Minimize": "最小化",
    "Maximize": "最大化",
    "Back": "返回",
    // 计划任务
    "No scheduled tasks configured.": "暂无已配置的计划任务。",
    // 配额提示 (含动态时间,用部分匹配)
    "You have used some of your weekly limit": "您已使用部分每周限额",
    "You have used some of your weekly limit.": "您已使用部分每周限额。",
    "You have used some of your 5-hour limit": "您已使用部分 5 小时限额",
    "You have used some of your 5-hour limit.": "您已使用部分 5 小时限额。",
    "You have used some of your Five Hour Limit": "您已使用部分 5 小时限额",
    "You have used some of your five-hour limit": "您已使用部分 5 小时限额",
    "You have used some of your five hour limit": "您已使用部分 5 小时限额",
    "it will fully refresh in": "它将在以下时间后完全刷新：",
    "hours": "小时",
    "minutes": "分钟",
    "days": "天",
    // 文件夹与权限
    "Folders": "文件夹",
    "folders": "文件夹",
    "including": "包括",
    "Allow/deny agent read access to specific files or directories.": "允许/拒绝智能体读取特定文件或目录。",
    "Allow/deny agent write access to specific files or directories.": "允许/拒绝智能体写入特定文件或目录。",
    "Allow/deny": "允许/拒绝",
    "read access": "读取权限",
    "write access": "写入权限",
    "specific files or directories": "特定文件或目录",
    // 浏览器子智能体说明(完整句)
    "The browser subagent can be invoked by typing /browser in the conversation input box.": "可以在对话输入框中输入 /browser 来调用浏览器子智能体。",

    // ===== 第7轮验证补充 (项目/文件夹状态提示) =====
    "Missing": "缺失",
    "Missing folder": "缺失文件夹",
    "Missing Folder": "缺失文件夹",
    "does not exist": "不存在",
    "not found": "未找到",
    "Not Found": "未找到",
    "No longer available": "已不可用",
    "Path": "路径",

    // ===== Antigravity 2.12.0+ 深度汉化补充 =====
    // 规划模式 (Planning Mode)
    "Planning Mode": "规划模式",
    "planning mode": "规划模式",
    "Planning Mode is ON": "规划模式已开启",
    "Planning Mode is OFF": "规划模式已关闭",
    "Implementation Plan": "实施计划",
    "implementation plan": "实施计划",
    "implementation_plan.md": "实施计划.md",
    "Walkthrough": "变更回顾",
    "walkthrough": "变更回顾",
    "walkthrough.md": "变更回顾.md",
    "User Review Required": "需用户审批",
    "Open Questions": "待确认问题",
    "Proposed Changes": "拟定变更",
    "Verification Plan": "验证计划",
    "Automated Tests": "自动化测试",
    "Manual Verification": "手动验证",
    "Proceed": "继续执行",
    "Plan Execution": "计划执行",
    "Approve Plan": "批准计划",
    "Reject Plan": "拒绝计划",
    "Plan approved": "计划已批准",
    "Plan rejected": "计划已拒绝",
    "Creating plan...": "正在生成计划...",
    "Updating plan...": "正在更新计划...",
    "Reviewing plan...": "正在审核计划...",
    "Implementation plan created": "实施计划已创建",
    "Implementation plan updated": "实施计划已更新",
    "Exit Planning Mode": "退出规划模式",
    "Enter Planning Mode": "进入规划模式",
    "Plan Mode": "规划模式",
    "Plan": "计划",
    "Goal Description": "目标描述",
    "Component Name": "组件名称",

    "Default model": "默认模型",
    "Inherit model": "继承模型",
    "Select a model": "选择模型",
    "Model tier": "模型级别",
    "Remaining tokens": "剩余 Token",
    "Remaining": "剩余",
    "remaining": "剩余",
    "Weekly limit remaining": "每周限额剩余",
    "Weekly limit Remaining": "每周限额剩余",
    "Weekly Limit Remaining": "每周限额剩余",
    "5-hour limit remaining": "5 小时限额剩余",
    "5-hour limit Remaining": "5 小时限额剩余",
    "5-Hour Limit Remaining": "5 小时限额剩余",
    "Five Hour Limit Remaining": "5 小时限额剩余",
    "Five Hour Limit remaining": "5 小时限额剩余",
    "Five hour limit remaining": "5 小时限额剩余",
    "Five-Hour Limit Remaining": "5 小时限额剩余",
    "Five-hour limit remaining": "5 小时限额剩余",
    "Five Hour Limit": "5 小时限额",
    "Five hour limit": "5 小时限额",
    "Five-Hour Limit": "5 小时限额",
    "Five-hour limit": "5 小时限额",
    "每周限额 Remaining": "每周限额剩余",
    "五小时限额 Remaining": "5 小时限额剩余",
    "Weekly limit": "每周限额",
    "weekly limit": "每周限额",
    "Weekly Limit": "每周限额",
    "5-hour limit": "5 小时限额",
    "5-Hour Limit": "5 小时限额",
    "5h limit": "5 小时限额",
    "5h Limit": "5 小时限额",
    "5 hour limit": "5 小时限额",
    "5 Hour Limit": "5 小时限额",
    "Claude and GPT models": "Claude 与 GPT 模型",
    "Claude and GPT Models": "Claude 与 GPT 模型",
    "Claude and GPT 模型": "Claude 与 GPT 模型",
    "Gemini models": "Gemini 模型",
    "Gemini Models": "Gemini 模型",
    "Gemini 3.8 Flash": "Gemini 3.8 Flash",
    "Gemini 3.8 Flash using ADC in AGY Enterprise": "AGY 企业版通过 ADC 使用 Gemini 3.8 Flash",
    "Gemini 3.8 Flash using ADC": "通过 ADC 使用 Gemini 3.8 Flash",
    "Enterprise users can now select and use Gemini 3.8 Flash via ADC for agentic tasks.": "企业用户现可通过 ADC 为智能体任务选用 Gemini 3.8 Flash 推理模型。",
    "Application Default Credentials": "应用默认凭据 (ADC)",
    "Application Default Credentials (ADC)": "应用默认凭据 (ADC)",
    "Quoting, /boost, and improved Settings": "划词引用、/boost 与设置优化",

    // 会话管理与右键/操作菜单 (Conversation Management & Context Menu)
    "Rename": "重命名",
    "rename": "重命名",
    "Mark Unread": "标记为未读",
    "Mark unread": "标记为未读",
    "mark unread": "标记为未读",
    "Mark as Unread": "标记为未读",
    "Mark as unread": "标记为未读",
    "Mark Read": "标记为已读",
    "Mark read": "标记为已读",
    "mark read": "标记为已读",
    "Mark as Read": "标记为已读",
    "Mark as read": "标记为已读",
    "Pin": "置顶",
    "pin": "置顶",
    "Unpin": "取消置顶",
    "unpin": "取消置顶",
    "Archive": "归档",
    "archive": "归档",
    "Unarchive": "取消归档",
    "unarchive": "取消归档",
    "Copy Conversation Name": "复制对话名称",
    "Copy conversation name": "复制对话名称",
    "Copy Conversation ID": "复制对话 ID",
    "Copy conversation id": "复制对话 ID",
    "Copy Project Name": "复制项目名称",
    "Copy project name": "复制项目名称",
    "Copy Terminal": "复制终端命令",
    "Copy terminal": "复制终端命令",
    "Copy terminal command": "复制终端命令",
    "Conversation name": "对话名称",
    "Conversation Name": "对话名称",
    "Conversation ID": "对话 ID",
    "conversation id": "对话 ID",
    "Workspace Name": "工作区名称",
    "workspace name": "工作区名称",
    "Worktree Name": "Worktree 名称",
    "worktree name": "Worktree 名称",
    "Project Name": "项目名称",
    "project name": "项目名称",
    "Copy": "复制",
    "copy": "复制",
    "Copied": "已复制",
    "copied": "已复制",
    "Copied!": "已复制！",
    "Copy Content": "复制内容",
    "Copy content": "复制内容",
    "Copy Link": "复制链接",
    "Copy link": "复制链接",
    "Copy Path": "复制路径",
    "Copy path": "复制路径",
    "Copy Image": "复制图片",
    "Copy image": "复制图片",
    "Copy prompt": "复制提示词",
    "Copy Command": "复制命令",
    "Copy command": "复制命令",
    "Copy error": "复制错误信息",
    "Copy error to clipboard": "复制错误信息到剪贴板",
    "Copy config file path": "复制配置文件路径",
    "Copy full URL to clipboard": "复制完整 URL 到剪贴板",
    "Copy to clipboard": "复制到剪贴板",
    "Copy File Path": "复制文件路径",
    "Copy File Name": "复制文件名",
    "Copy workspace": "复制工作区",
    "Copy project": "复制项目",
    "Copy debug info": "复制调试信息",
    "Copy conversation markdown": "复制对话 Markdown",
    "Copy trajectory ID": "复制轨迹 ID",
    "Copy the trajectory ID": "复制轨迹 ID",
    "Trajectory ID": "轨迹 ID",
    "Attach the trajectory ID to the feedback form": "将轨迹 ID 附加到反馈表单中",
    "Open in Trajectory Dashboard": "在轨迹仪表盘中打开",
    "Trajectory Metadata": "轨迹元数据",
    "No trajectory metadata available": "暂无轨迹元数据",
    "Delete Conversation": "删除对话",
    "delete conversation": "删除对话",
    "Updated": "已更新",
    "updated": "已更新",
    "Action Required": "需要操作",
    "action required": "需要操作",
    "Unread": "未读",
    "unread": "未读",
    "Active": "活跃",
    "active": "活跃",
    "Idle": "空闲",
    "idle": "空闲",
    "Canceling": "正在取消",
    "canceling": "正在取消",

    // ===== Antigravity 2.13.0+ 深度汉化补充 =====
    // 侧边问答与表单交互 (Side Question & Questionnaire)
    "Side Question": "侧边提问",
    "side question": "侧边提问",
    "Side question": "侧边提问",
    "Side question answered.": "侧边提问已回答。",
    "Side question answered": "侧边提问已回答",
    "View side question": "查看侧边提问",
    "Minimize side question": "最小化侧边提问",
    "Delete side question": "删除侧边提问",
    "Cancel questionnaire": "取消问答",
    "Cancel questionnaire and stop the agent": "取消问答并停止智能体",

    // Git Amend 追加提交 (Git Version Control)
    "Amend": "追加提交",
    "amend": "追加提交",
    "Amending...": "正在追加提交...",
    "Amend staged changes into the current commit": "将已暂存改动追加合并至当前提交",
    "Stage and amend all changes into the current commit": "暂存并将所有改动追加合并至当前提交",
    "Amend succeeded": "追加提交成功",
    "Failed to Amend": "追加提交失败",
    "No changes to amend": "没有可追加的改动",
    "No commit to amend": "没有可追加的目标提交",
    "Resolve conflicts first": "请先解决冲突",

    // 设置中心高级迁移 (Settings Restructuring & Advanced)
    "Best of N settings have moved": "Best of N 设置已迁移",
    "Best of N settings have moved to the Advanced section of General settings.": "Best of N 设置已移至通用设置中的“高级”区域。",
    "CitC settings have moved": "CitC 设置已迁移",
    "CitC settings have moved to the Advanced section of General settings.": "CitC 设置已移至通用设置中的“高级”区域。",
    "Labs settings have moved": "实验室设置已迁移",
    "Labs settings have moved to the Advanced section of General settings.": "实验室设置已移至通用设置中的“高级”区域。",
    "Change VCS in General settings, under Advanced": "在通用设置的“高级”区域中更改版本控制系统",
    "Skills and rules settings": "技能与规则设置",

    // 产物与表格宽度自定义 (Display & Artifact Settings)
    "Markdown Artifact Width": "Markdown 产物宽度",
    "Configure the default width of markdown artifacts.": "配置 Markdown 产物的默认显示宽度。",
    "Table Width": "表格宽度",
    "Configure the default width of tables.": "配置表格的默认显示宽度。",
    "Fit to content": "适应内容",
    "Fit to width": "适应宽度",

    // Windows 管理员权限 (UAC Elevation)
    "Administrator access (UAC)": "管理员权限 (UAC)",
    "Grant administrator access for": "授予管理员权限至",
    "Grant one-time administrator access": "授予一次性管理员权限",
    "Requesting a one-time administrator (UAC) elevation": "正在请求一次性管理员 (UAC) 权限提升",
    "Yes, allow": "允许授权",

    // 插件、技能与自定义扩展 (Customizations & Plugins)
    "Create plugin": "创建插件",
    "Describe a plugin and the agent builds it": "描述插件功能，智能体将自动构建",
    "Delete Skill": "删除技能",
    "Enable recommended skills": "启用推荐技能",
    "Disable recommended skills": "禁用推荐技能",
    "Customizations views": "自定义项视图",
    "Installed by you": "由您安装",
    "Bundled with the app": "随应用内置",
    "Listed in your config": "已在您的配置中列出",
    "Found in this workspace": "在此工作区中找到",
    "No custom agents yet.": "暂无自定义智能体。",
    "No customizations match your search.": "没有匹配您搜索的自定义项。",
    "No skills or rules match this filter.": "没有匹配此筛选条件的技能或规则。",
    "No skills or rules yet.": "暂无技能或规则。",
    "Pre-installed": "预置",
    "Builtin": "内置",

    // 分屏 (Split) 交互与子菜单
    "Split": "分屏",
    "split": "分屏",
    "Split Right": "向右分屏",
    "split right": "向右分屏",
    "Split Down": "向下分屏",
    "split down": "向下分屏",
    "Replace With New": "替换为新建",
    "replace with new": "替换为新建",
    "Remove From Split": "从分屏中移除",
    "remove from split": "从分屏中移除",
    "Split Terminal": "拆分终端",
    "split terminal": "拆分终端",
    "Split Conversation Vertically": "垂直分屏对话",
    "Split Conversation Horizontally": "水平分屏对话",
    "Equalize Split Panes": "均分分屏窗格",
    "Restore split view": "恢复分屏视图",
    "Close split view and go to forked conversation": "关闭分屏视图并转到派生的对话",
    "View Split Diff": "查看分屏差异",
    "Resize terminal panes": "调整终端窗格大小",

    // 派生 (Fork) 交互与子菜单
    "Fork": "派生",
    "fork": "派生",
    "Fork Conversation": "派生对话",
    "Create fork in current workspace": "在当前工作区创建派生",
    "Create fork in shared workspace": "在共享工作区创建派生",
    "Create fork in new workspace": "在新建工作区创建派生",
    "Failed to fork conversation": "派生对话失败",
    "Forked from": "派生自",
    "Fork Environment Notice": "派生环境提示",
    "The server returned no conversation to fork into.": "服务器未返回可供派生的对话。",

    // 对话分组 (Conversation Groups)
    "Move to Group": "移动到分组",
    "Move to group": "移动到分组",
    "New Group": "新建分组",
    "new group": "新建分组",
    "Create Group": "创建分组",
    "create group": "创建分组",
    "Delete Group": "删除分组",
    "Rename Group": "重命名分组",
    "Remove from Group": "从分组中移除",
    "No groups yet": "暂无分组",
    "Group name": "分组名称",
    "Group Name": "分组名称",
    "Enter group name": "输入分组名称",
    "A group with this name already exists.": "已存在同名分组。",
    "Group By": "分组方式",
    "Group By Project": "按项目分组",
    "Group By Workspace": "按工作区分组",
    "Sidebar grouped by project": "侧边栏已按项目分组",
    "Sidebar grouped by workspace": "侧边栏已按工作区分组",
    "New chats will be grouped by workspace.": "新会话将按工作区进行分组。",

    // 窗格与插件扩展 (Panes & Extensions)
    "Maximize Pane": "最大化窗格",
    "Restore Pane": "恢复窗格",
    "Auxiliary Pane": "辅助窗格",
    "Toggle Auxiliary Pane": "切换辅助窗格",
    "Open in Preview Pane": "在预览窗格中打开",
    "No plugins available": "暂无可用插件",

    // 分屏与分组自愈修正 (Self-healing fallbacks)
    "Replace With 新建": "替换为新建",
    "移除 From Split": "从分屏中移除",
    "Split 终端": "拆分终端",
    "新建 Group": "新建分组",
    "创建 Group": "创建分组",
    "移动到 Group": "移动到分组",
    "重命名 Group": "重命名分组",
    "删除 Group": "删除分组",
    "从 Group 中移除": "从分组中移除",
    "向右 Split": "向右分屏",
    "向下 Split": "向下分屏",

    // 会话管理、暂存文件与比对器 (Conversations, Scratch & Diff)
    "Pin this conversation": "置顶此对话",
    "Unpin this conversation": "取消置顶此对话",
    "Rename this conversation": "重命名此对话",
    "Forked conversation": "派生的对话",
    "Scratch Files": "暂存文件",
    "No scratch files": "暂无暂存文件",
    "Show Whitespace Changes": "显示空白字符变动",
    "Hide Whitespace Changes": "隐藏空白字符变动",
    "Search Conversations": "搜索对话",
    "Search Projects": "搜索项目",
    "Search Workspaces": "搜索工作区",
    "Scroll to Bottom": "滚动到底部",
    "Code block": "代码块",
    "Code snippet": "代码片段",
    "Comment on Selection": "针对所选内容添加注释",
    "Configure MCP Server": "配置 MCP 服务器",
    "Conversation Log": "对话日志",
    "Copy error messages": "复制错误信息",
    "Failed to display native context menu:": "无法显示原生上下文菜单：",
    "Failed to load media": "加载媒体资源失败",
    "Failed to parse settings. Fix and restart.": "设置解析失败，请修正后重启软件。",
    "Failed to save image: ": "保存图片失败：",
    "Loading media...": "正在加载媒体...",
    "More info": "更多信息",
    "No documents": "暂无文档",
    "No matching items": "无匹配项",
    "Reason for opting out": "退出原因",
    "Remote Control channel closed": "远程控制通道已关闭",
    "This cannot be undone.": "此操作无法撤销。",
    "Vetted (Preview)": "官方审核 (预览版)",
    "View side question": "查看侧边提问",
    "What counts as a document": "哪些内容属于文档",
    "Your changes were not saved. Please try again.": "您的更改未保存，请重试。",

    // 企业级许可证与项目凭据 (Licensing & Cloud Project)
    "License Required": "需要许可证",
    "Project Required": "需要关联项目",
    "Manage License": "管理许可证",
    "A Google Cloud project is required to use Antigravity.": "使用 Antigravity 需要关联 Google Cloud 项目。",
    "A license or project selection is required to use Antigravity.": "使用 Antigravity 需要具备许可证或选择关联项目。",

    // 多智能体协同与子智能体 (Subagents & Teamwork)
    "Teamwork": "团队协作",
    "teamwork": "团队协作",
    "Manage Subagents": "管理子智能体",
    "manage subagents": "管理子智能体",
    "Active Subagents": "活跃子智能体",
    "Invoke subagent": "调用子智能体",
    "Define subagent": "定义子智能体",
    "Kill subagent": "终止子智能体",
    "Kill all": "终止全部",
    "Waiting for input": "等待输入",
    "Waiting for dependents": "等待依赖任务",
    "Waiting for message": "等待消息",
    "Canceling": "正在取消",
    "Errored": "发生错误",
    "Idle": "空闲",
    "Unspecified": "未指定",
    "Research Agent": "调研智能体",
    "Codebase Researcher": "代码库调研员",
    "Conversation ID": "对话 ID",
    "Conversation transcript": "对话记录",
    "Transcript logs": "转录日志",
    "Reactive Wakeup": "响应式唤醒",
    "No polling needed": "无需轮询",
    "Subagent conversation": "子智能体对话",
    "Parent agent": "父智能体",
    "Child agent": "子智能体",

    // 工作区隔离与分支模式
    "Branch Workspace": "分支隔离工作区",
    "Share Workspace": "共享工作区",
    "Inherit Workspace": "继承工作区",
    "Isolated branch": "隔离分支",
    "Shared repository": "共享仓库",
    "Workspace directory permissions": "工作区目录权限",
    "Active workspace": "活动工作区",
    "Switch workspace": "切换工作区",
    "Add folder to workspace": "添加文件夹到工作区",
    "Remove from workspace": "从工作区移除",

    // MCP 与扩展工具体系
    "MCP Servers": "MCP 服务器",
    "MCP Server": "MCP 服务器",
    "MCP Tools": "MCP 工具",
    "Call MCP Tools": "调用 MCP 工具",
    "Active MCPs": "活跃 MCP 服务",
    "Connectors": "连接器",
    "Configure MCP server": "配置 MCP 服务器",
    "Inspect parameters": "检查参数",
    "Tool execution": "工具执行",
    "Tool call": "工具调用",
    "Tool calls": "工具调用",
    "Tool summary": "工具摘要",
    "Tool action": "工具操作",
    "Built-in tools": "内置工具",
    "External tools": "外部工具",
    "Running command": "运行命令",
    "Analyzing directory": "分析目录",
    "Analyzed directory": "分析目录",
    "analyzed directory": "分析目录",
    "Analyzed": "分析",
    "analyzed": "分析",
    "Searching the web": "搜索网页",
    "Editing file": "编辑文件",
    "Viewing file": "查看文件",
    "Semantic searching": "语义搜索",

    // 权限控制与沙盒增强
    "Sandbox": "沙盒",
    "Sandboxed": "沙盒内",
    "Unsandboxed": "沙盒外",
    "Commands Outside Sandbox": "沙盒外命令",
    "Terminal & Tooling Permissions": "终端与工具权限",
    "Network Access Rules": "网络访问规则",
    "File Access Rules": "文件访问规则",
    "Allowed paths": "允许路径",
    "Denied paths": "拒绝路径",
    "Allowed commands": "允许命令",
    "Denied commands": "拒绝命令",
    "Allowed URLs": "允许的 URL",
    "Denied URLs": "拒绝的 URL",
    "Always allow": "总是允许",
    "Ask every time": "每次询问",
    "Deny by default": "默认拒绝",
    "Allowlist": "白名单",
    "Denylist": "黑名单",
    "Global permissions": "全局权限",
    "Project permissions": "项目权限",

    // 定时任务与调度 (Schedule & Cron)
    "Schedule": "计划调度",
    "One-shot timer": "单次定时器",
    "Recurring cron": "循环定时任务",
    "Cron expression": "Cron 表达式",
    "Duration in seconds": "持续秒数",
    "Max iterations": "最大执行次数",
    "Timer condition": "定时条件",
    "Early termination": "提前终止",
    "Any message": "任何消息",
    "Specific sender": "特定发送者",
    "Expired": "已过期",

    // 自定义技能与规则 (Customizations & Skills)
    "Customizations": "自定义配置",
    "Skills": "技能",
    "Skill": "技能",
    "Rules": "规则",
    "Rule": "规则",
    "Plugins": "插件",
    "Sidecars": "伴生进程 (Sidecars)",
    "Hooks": "钩子",
    "App Data Directory": "应用数据目录",
    "Artifact": "工件",
    "Artifacts": "工件",
    "Artifact metadata": "工件元数据",

    // 通用界面与交互
    "Loading Antigravity": "正在加载 Antigravity...",
    "Setting up…": "正在启动/设置中...",
    "Setting up...": "正在启动/设置中...",
    "Recent Workspaces": "最近工作区",
    "Clear Cache": "清除缓存",
    "Reset Settings": "重置设置",
    "Log Out": "退出登录",
    "Sign In": "登录",
    "Sign in with Google": "使用 Google 账号登录",
    "Signed in as": "当前登录为",
    "Check for Updates": "检查更新",
    "Checking for Updates...": "正在检查更新...",
    "Downloading Update...": "正在下载更新...",
    "Restart to Update": "重启以应用更新",
    "Up to date": "已是最新版本",
    "New version available": "有新版本可用",
    "Automatic 检查更新": "自动检查更新",
    "Automatic check for updates": "自动检查更新",
    "Automatic Check for Updates": "自动检查更新",
    "Automatic Updates": "自动更新",
    "Automatic updates": "自动更新",
    "Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the app menu.": "当有新版本可用时，自动提示您重启应用以完成更新。禁用后，您仍可通过应用菜单手动检查更新。",
    "Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the app menu": "当有新版本可用时，自动提示您重启应用以完成更新。禁用后，您仍可通过应用菜单手动检查更新",
    "Automatically prompt you to restart the app when a new update is available.": "当有新版本可用时，自动提示您重启应用以完成更新。",
    "Automatically prompt you to restart the app when a new update is available": "当有新版本可用时，自动提示您重启应用以完成更新",
    "When disabled, you can check for updates manually from the app menu.": "禁用后，您仍可通过应用菜单手动检查更新。",
    "When disabled, you can check for updates manually from the app menu": "禁用后，您仍可通过应用菜单手动检查更新",
    "Copy code": "复制代码",
    "Copied!": "已复制！",
    "Copied": "已复制",
    "Collapse": "折叠",
    "Expand": "展开",
    "Show more": "显示更多",
    "Show less": "显示更少",
    "Details": "详情",
    "Overview": "概览",

    // ===== 对话流步骤标签与执行状态 (用户定制方案 3) =====
    "Run": "运行",
    "run": "运行",
    "Ran": "运行",
    "ran": "运行",
    "Running": "运行中",
    "running": "运行中",
    "Thought": "思考过程",
    "thought": "思考过程",
    "Thinking...": "思考中...",
    "thinking...": "思考中...",
    "Thinking": "思考中",
    "thinking": "思考中",
    "Explored": "检索",
    "explored": "检索",
    "Exploring": "检索中",
    "exploring": "检索中",
    "Edited": "编辑",
    "edited": "编辑",
    "Editing": "编辑中",
    "editing": "编辑中",
    "Viewed": "查看",
    "viewed": "查看",
    "Viewing": "查看中",
    "viewing": "查看中",
    "Searched": "搜索",
    "searched": "搜索",
    "Searching": "搜索中",
    "searching": "搜索中",
    "Working...": "处理中...",
    "working...": "处理中...",
    "Working": "处理中",
    "working": "处理中",
    "Load older messages": "加载更早消息",
    "Artifact not found": "未找到产物文件",
    "could not be opened": "无法打开",
    "Tool definitions": "工具定义",
    "Subagent definitions": "子智能体定义",

    // ===== 顶部应用菜单与命令面板 (Application Menu & Command Palette) =====
    "Command Palette": "命令面板",
    "Command Palette...": "命令面板...",
    "Command palette": "命令面板",
    "command palette": "命令面板",
    "Palette": "面板",
    "palette": "面板",
    "命令palette": "命令面板",
    "命令 Palette": "命令面板",
    "命令 palette": "命令面板",
    "New Window": "新建窗口",
    "new window": "新建窗口",
    "Open Folder": "打开文件夹",
    "Open folder": "打开文件夹",
    "Open Folder...": "打开文件夹...",
    "Open Workspace": "打开工作区",
    "Open workspace": "打开工作区",
    "Open Workspace...": "打开工作区...",
    "Save As...": "另存为...",
    "Save As": "另存为",
    "Save as": "另存为",
    "Save all": "全部保存",
    "Save All": "全部保存",
    "Close Window": "关闭窗口",
    "close window": "关闭窗口",
    "Close Workspace": "关闭工作区",
    "close workspace": "关闭工作区",
    "Close Editor": "关闭编辑器",
    "close editor": "关闭编辑器",
    "Close Folder": "关闭文件夹",
    "close folder": "关闭文件夹",
    "Quit Antigravity": "退出 Antigravity",
    "Exit": "退出",
    "exit": "退出",

    // ===== 深度汉化补充：通用与应用设置 (General & App Settings) =====
    "Appearance": "外观",
    "appearance": "外观",
    "Theme": "主题",
    "Themes": "主题",
    "Theme mode": "主题模式",
    "Theme Mode": "主题模式",
    "theme mode": "主题模式",
    "Color theme": "颜色主题",
    "Custom theme": "自定义主题",
    "Light": "浅色",
    "Dark": "深色",
    "System": "跟随系统",
    "Follow system": "跟随系统",
    "Inherit from system": "跟随系统设置",
    "Conversation width": "对话区宽度",
    "Conversation Width": "对话区宽度",
    "conversation width": "对话区宽度",
    "Compact": "紧凑",
    "Comfortable": "适中",
    "Wide": "加宽",
    "Full width": "全宽",
    "Full Width": "全宽",
    "App Settings": "应用设置",
    "Keep computer awake": "保持电脑唤醒",
    "Keep computer awake while running tasks": "运行任务时防止电脑休眠",
    "Prevent the system from sleeping during long-running agent tasks.": "在智能体执行长时间任务期间防止系统进入休眠。",
    "Run in background": "后台运行",
    "Run in background when closed": "关闭窗口后在后台继续运行",
    "Run in background when all windows are closed": "关闭所有窗口后在后台继续运行",
    "Keep Antigravity running in the background when all windows are closed.": "关闭所有窗口后，保持 Antigravity 在系统后台运行。",
    "Auto-check for updates": "自动检查更新",
    "Auto check for updates": "自动检查更新",
    "Automatically check for updates": "自动检查软件更新",
    "Automatically check for and notify about application updates.": "自动检查并提示新版本应用程序更新。",
    "Notifications": "系统通知",
    "Notification preferences": "通知偏好",
    "Manage your notification preferences.": "管理您的通知偏好。",
    "Manage your notification preferences": "管理您的通知偏好",
    "Enable Notifications for Agent": "启用智能体通知",
    "Enable notifications for agent": "启用智能体通知",
    "Show system notifications when your action is needed or the agent finishes.": "当需要您的操作或智能体完成任务时显示系统通知。",
    "Show system notifications when your action is needed or the agent finishes": "当需要您的操作或智能体完成任务时显示系统通知",
    "Enable system notifications": "启用系统通知",
    "Enable system notifications on task completion": "任务完成时发送系统通知",
    "Task completion notifications": "任务完成通知",
    "Receive desktop notifications when background tasks or agent turns finish.": "当后台任务或智能体回合完成时接收桌面通知。",
    "Play sound on task completion": "任务完成时播放提示音",
    "Sound effects": "声音效果",
    "Sound": "声音",
    "sound": "声音",
    "Sounds": "声音",
    "sounds": "声音",
    "Enable Sounds for Agent": "启用智能体提示音",
    "Enable sounds for agent": "启用智能体提示音",
    "Play a sound when your action is needed or the agent finishes.": "当需要您的操作或智能体完成任务时播放提示音。",
    "Play a sound when your action is needed or the agent finishes": "当需要您的操作或智能体完成任务时播放提示音",
    "Volume": "音量",
    "volume": "音量",
    "Set the volume of agent sounds.": "设置智能体提示音的音量。",
    "Set the volume of agent sounds": "设置智能体提示音的音量",
    "Agent sounds": "智能体提示音",
    "agent sounds": "智能体提示音",
    "Agent sound": "智能体提示音",
    "agent sound": "智能体提示音",

    // ===== 深度汉化补充：v2.15.0 智能体控制、项目状态与键位导航 (v2.15.0 Features) =====
    "No Project": "无项目",
    "No project": "无项目",
    "no project": "无项目",
    "Invalid tool call": "无效的工具调用",
    "Invalid Tool Call": "无效的工具调用",
    "invalid tool call": "无效的工具调用",
    "Main Agent": "主智能体",
    "Main agent": "主智能体",
    "main agent": "主智能体",
    "Main Agent (Default)": "主智能体 (默认)",
    "Main agent (default)": "主智能体 (默认)",
    "Default tools": "默认工具",
    "default tools": "默认工具",
    "Default Tools": "默认工具",
    "Default prompt sections": "默认提示词小节",
    "default prompt sections": "默认提示词小节",
    "Default prompts": "默认提示词",
    "default prompts": "默认提示词",
    "Switch off default tools": "关闭默认工具",
    "Switch off default prompts": "关闭默认提示词",
    "Switch off default prompt sections": "关闭默认提示词小节",
    "Add back tools": "重新添加工具",
    "Cannot display binary file": "无法显示二进制文件",
    "Binary file cannot be displayed": "无法显示二进制文件",
    "Unable to display binary file": "无法显示二进制文件",
    "Command canceled": "命令已取消",
    "Command cancelled": "命令已取消",
    "Canceled on restart": "重启时已取消",
    "Cancelled on restart": "重启时已取消",
    "Working outside of a project": "在项目外部工作",
    "Working outside of a project.": "在项目外部工作。",

    // ===== 深度汉化补充：高频交互操作、无障碍标签与反馈按钮 =====
    "Good response": "好评回复",
    "Bad response": "差评回复",
    "More actions": "更多操作",
    "more actions": "更多操作",
    "More options": "更多选项",
    "more options": "更多选项",
    "Pin conversation": "置顶对话",
    "Unpin conversation": "取消置顶对话",
    "Archive conversation": "归档对话",
    "Pinned Conversations": "置顶对话",
    "Pinned conversations": "置顶对话",
    "pinned conversations": "置顶对话",
    "PINNED CONVERSATIONS": "置顶对话",
    "Pinned Conversation": "置顶对话",
    "Pinned conversation": "置顶对话",
    "pinned conversation": "置顶对话",
    "Pinned": "已置顶",
    "pinned": "已置顶",
    "Unpinned": "未置顶",
    "unpinned": "未置顶",
    "Recent Conversations": "最近对话",
    "Recent conversations": "最近对话",
    "recent conversations": "最近对话",
    "All Conversations": "全部对话",
    "All conversations": "全部对话",
    "all conversations": "全部对话",
    "Other Conversations": "其他对话",
    "other conversations": "其他对话",
    "Undo to this point": "撤销到此处",
    "Copy code": "复制代码",
    "copy code": "复制代码",
    "At mention code block": "提及代码块",
    "Add inline comment": "添加行内注释",
    "Fold code block": "折叠代码块",
    "User message": "用户消息",
    "user message": "用户消息",
    "Send message": "发送消息",
    "send message": "发送消息",
    "Agent execution terminated due to error.": "智能体执行因错误而终止。",
    "Agent execution terminated due to error": "智能体执行因错误而终止",
    "Agent execution terminated": "智能体执行已终止",
    "See all": "查看全部",
    "see all": "查看全部",
    "Media actions": "媒体操作",
    "Overview tab": "概览标签页",
    "Review tab": "评审标签页",
    "Terminal tab": "终端标签页",
    "Resolve Merge": "解决合并",
    "Add comment": "添加注释",

    // ===== 深度汉化补充：远程控制 (Remote Control) =====
    "Open in Remote Control": "在远程控制中打开",
    "Open in remote control": "在远程控制中打开",
    "open in remote control": "在远程控制中打开",
    "Continue your work from another device with Remote Control. Scan the QR code or open the link below.": "借助远程控制从另一台设备继续工作。请扫描下方二维码或打开下方链接。",
    "Continue your work from another device with Remote Control. Scan the QR code or open the link below": "借助远程控制从另一台设备继续工作。请扫描下方二维码或打开下方链接",
    "Continue your work from another device with Remote Control.": "借助远程控制从另一台设备继续工作。",
    "Continue your work from another device with Remote Control": "借助远程控制从另一台设备继续工作",
    "Continue your work from another device with remote control.": "借助远程控制从另一台设备继续工作。",
    "Continue your work from another device with remote control": "借助远程控制从另一台设备继续工作",
    "Continue your work from another device": "从另一台设备继续工作",
    "continue your work from another device": "从另一台设备继续工作",
    "Scan the QR code or open the link below.": "扫描二维码或打开下方链接。",
    "Scan the QR code or open the link below": "扫描二维码或打开下方链接",
    "Scan the QR code": "扫描二维码",
    "scan the QR code": "扫描二维码",
    "open the link below.": "打开下方链接。",
    "open the link below": "打开下方链接",
    "Remote Control": "远程控制",
    "Remote control": "远程控制",
    "remote control": "远程控制",
    "Scan the code to open this device in remote control, or copy link.": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to open this device in Remote Control, or copy link.": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to open this device in remote control, or copy link": "扫描二维码以在远程控制中打开此设备，或复制链接",
    "Scan the code to open this device in Remote Control, or copy link": "扫描二维码以在远程控制中打开此设备，或复制链接",
    "Scan the code to open this device in 远程控制, or copy link。": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to open this device in 远程控制, or copy link.": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to open this device in 远程控制, or copy link": "扫描二维码以在远程控制中打开此设备，或复制链接",
    "Scan the code to 打开 this device in 远程控制, or copy link。": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to 打开 this device in 远程控制, or copy link": "扫描二维码以在远程控制中打开此设备，或复制链接",
    "Scan the code to 打开 this 设备 in 远程 Control, or 复制链接": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to 打开 this 设备 in 远程 Control, or 复制链接。": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to 打开 this 设备 in 远程 Control, or 复制链接.": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to 打开 this 设备 in 远程 控制, or 复制链接": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to 打开 this 设备 in 远程 控制, or 复制链接。": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to 打开 this 设备 in 远程 控制, or 复制链接.": "扫描二维码以在远程控制中打开此设备，或复制链接。",
    "Scan the code to open this device in Remote Control, or": "扫描二维码以在远程控制中打开此设备，或",
    "Scan the code to open this device in remote control, or": "扫描二维码以在远程控制中打开此设备，或",
    "Scan the code to 打开 this 设备 in 远程 控制, or": "扫描二维码以在远程控制中打开此设备，或",
    "Scan the code to 打开 this 设备 in 远程 Control, or": "扫描二维码以在远程控制中打开此设备，或",
    "Scan the code to 打开 this device in 远程控制, or": "扫描二维码以在远程控制中打开此设备，或",
    "Scan the code to": "扫描二维码以",
    "scan the code to": "扫描二维码以",
    "open this device in Remote Control": "在远程控制中打开此设备",
    "open this device in remote control": "在远程控制中打开此设备",
    "this device in Remote Control": "在远程控制中的此设备",
    "Control": "控制",
    "control": "控制",
    "Scan the code to open this device": "扫描二维码以打开此设备",
    "in remote control": "在远程控制中",
    "in Remote Control": "在远程控制中",
    "or copy link.": "或复制链接。",
    "or copy link": "或复制链接",
    "Copy link": "复制链接",
    "copy link": "复制链接",
    "Copy Link": "复制链接",
    "Link copied": "链接已复制",
    "Link copied!": "链接已复制！",
    "Scan the code": "扫描二维码",
    "scan the code": "扫描二维码",
    "Scan code": "扫描二维码",
    "QR code": "二维码",
    "QR Code": "二维码",
    "Connect device": "连接设备",
    "Connect your device": "连接您的设备",
    "Open on your mobile device": "在移动设备上打开",
    "Open on this device": "在此设备上打开",
    "This device": "此设备",
    "this device": "此设备",

    // ===== 深度汉化补充：工具执行与自动审批策略 (Tool Execution & Approval) =====
    "Tool Execution Policy": "工具执行策略",
    "Tool execution policy": "工具执行策略",
    "Auto-Execution Policy": "自动执行策略",
    "Auto Execution Policy": "自动执行策略",
    "auto-execution policy": "自动执行策略",
    "Execution Policy": "执行策略",
    "execution policy": "执行策略",
    "Controls whether terminal commands require approval before running": "控制终端命令在运行前是否需要人工审批",
    "Controls whether terminal commands require approval before running.": "控制终端命令在运行前是否需要人工审批。",
    "Always proceed": "总是直接执行",
    "Always Proceed": "总是直接执行",
    "always-proceed": "总是直接执行",
    "Always proceed (Run without asking)": "总是直接执行 (无需询问)",
    "Request review": "请求人工审查",
    "Request Review": "请求人工审查",
    "request-review": "请求人工审查",
    "Request review (Ask before every command)": "请求人工审查 (每次运行命令前询问)",
    "Proceed in sandbox": "在沙盒中直接执行",
    "Proceed in Sandbox": "在沙盒中直接执行",
    "proceed-in-sandbox": "在沙盒中直接执行",
    "Proceed in sandbox (Run in sandbox without asking)": "在沙盒中直接执行 (沙盒内无需询问)",
    "Strict": "严格模式",
    "strict": "严格模式",
    "Strict (Ask for all tools)": "严格模式 (所有工具调用均需确认)",
    "Agent decides": "智能体自主决定",
    "agent-decides": "智能体自主决定",
    "Agent decides (Request review when recommended)": "智能体自主决定 (仅在有风险时请求审查)",
    "Asks for review": "询问审查",
    "Ask for review": "询问审查",
    "asks-for-review": "询问审查",
    "Turbo": "极速模式",
    "turbo": "极速模式",
    "Turbo mode": "极速模式",
    "turbo mode": "极速模式",
    "极速模式 mode": "极速模式",
    "Every command requires approval.": "每条命令都需要审批。",
    "Every command requires approval": "每条命令都需要审批",
    "every command requires approval.": "每条命令都需要审批。",
    "every command requires approval": "每条命令都需要审批",
    "Ask before sensitive operations.": "在执行敏感操作前询问。",
    "Ask before sensitive operations": "在执行敏感操作前询问",
    "ask before sensitive operations.": "在执行敏感操作前询问。",
    "ask before sensitive operations": "在执行敏感操作前询问",
    "Run all commands without restrictions.": "无限制运行所有命令。",
    "Run all commands without restrictions": "无限制运行所有命令",
    "run all commands without restrictions.": "无限制运行所有命令。",
    "run all commands without restrictions": "无限制运行所有命令",
    "Run all commands in sandbox without restrictions.": "在沙盒中无限制运行所有命令。",
    "Run all commands in sandbox without restrictions": "在沙盒中无限制运行所有命令",
    "Run in sandbox without asking.": "在沙盒中直接运行，无需询问。",
    "Run in sandbox without asking": "在沙盒中直接运行，无需询问",
    "Every tool requires approval.": "每个工具调用均需审批。",
    "Every tool requires approval": "每个工具调用均需审批",
    "Learn more about": "了解更多关于",
    "learn more about": "了解更多关于",
    "了解更多 about": "了解更多关于",

    // ===== 通用执行与排队消息策略 (Execution & Queued Messages) =====
    "Configure when follow-up messages are sent.": "配置后续跟进消息的发送时机。",
    "Configure when follow-up messages are sent": "配置后续跟进消息的发送时机",
    "Queue": "排队等待",
    "queue": "排队等待",
    "Send Immediately": "立即发送",
    "send immediately": "立即发送",
    "Steer": "实时插话指导",
    "steer": "实时插话指导",
    "Interrupt": "中断当前执行",
    "interrupt": "中断当前执行",
    "Controls the actions the agent can take.": "控制智能体可以执行的具体操作范围。",
    "Controls the actions the agent can take": "控制智能体可以执行的具体操作范围",
    "Controls the 操作 the 智能体 can take。": "控制智能体可以执行的具体操作范围。",
    "Controls the 操作 the 智能体 can take": "控制智能体可以执行的具体操作范围",
    "Whether the agent asks you to review its documents.": "控制智能体是否提请您审查其生成的文档工件。",
    "Whether the agent asks you to review its documents": "控制智能体是否提请您审查其生成的文档工件",
    "Modify permissions for files, terminal, and MCP tools.": "修改针对文件系统、终端命令以及 MCP 工具的安全权限。",
    "Modify permissions for files, terminal, and MCP tools": "修改针对文件系统、终端命令以及 MCP 工具的安全权限",
    "Modify 权限 持续 文件, 终端, and MCP 工具。": "修改针对文件系统、终端命令以及 MCP 工具的安全权限。",
    "Modify 权限 持续 文件, 终端, and MCP 工具": "修改针对文件系统、终端命令以及 MCP 工具的安全权限",
    "Modify permissions for 文件, 终端, and MCP 工具。": "修改针对文件系统、终端命令以及 MCP 工具的安全权限。",
    "Modify permissions for 文件, 终端, and MCP 工具": "修改针对文件系统、终端命令以及 MCP 工具的安全权限",
    "You can upgrade to a Google AI Ultra plan to receive higher rate limits.": "您可以升级至 Google AI Ultra 计划以获得更高额度的调用速率上限。",
    "You can upgrade to a Google AI Ultra plan to receive higher rate limits": "您可以升级至 Google AI Ultra 计划以获得更高额度的调用速率上限",
    "You can 升级 to a Google AI Ultra 计划 to receive higher rate 限额。": "您可以升级至 Google AI Ultra 计划以获得更高额度的调用速率上限。",
    "You can 升级 to a Google AI Ultra 计划 to receive higher rate 限额": "您可以升级至 Google AI Ultra 计划以获得更高额度的调用速率上限",
    "Keyboard Shortcuts": "键盘快捷键",
    "keyboard shortcuts": "键盘快捷键",
    "Keyboard 快捷键": "键盘快捷键",
    "Narrow": "紧凑",
    "narrow": "紧凑",

    // ===== 深度汉化补充：终端沙盒与安全隔离 (Terminal Sandbox & Security) =====
    "Terminal Sandbox": "终端沙盒",
    "terminal sandbox": "终端沙盒",
    "Sandbox Mode": "沙盒模式",
    "sandbox mode": "沙盒模式",
    "Enable Sandbox Mode (Preview)": "启用沙盒模式 (预览)",
    "Enable Sandbox Mode (preview)": "启用沙盒模式 (预览)",
    "enable sandbox mode (preview)": "启用沙盒模式 (预览)",
    "Enable Sandbox Mode": "启用沙盒模式",
    "enable sandbox mode": "启用沙盒模式",
    "Sandbox Mode (Preview)": "沙盒模式 (预览)",
    "sandbox mode (preview)": "沙盒模式 (预览)",
    "Enable Terminal Sandbox": "启用终端沙盒",
    "enable terminal sandbox": "启用终端沙盒",
    "Restricts agent tools to a secure, isolated local sandbox.": "将智能体工具限制在安全、隔离的本地沙盒环境中。",
    "Restricts agent tools to a secure, isolated local sandbox": "将智能体工具限制在安全、隔离的本地沙盒环境中",
    "restricts agent tools to a secure, isolated local sandbox.": "将智能体工具限制在安全、隔离的本地沙盒环境中。",
    "restricts agent tools to a secure, isolated local sandbox": "将智能体工具限制在安全、隔离的本地沙盒环境中",
    "Run agent commands inside a restricted sandbox environment for added security.": "在受限沙盒环境中运行智能体命令以提高系统安全性。",
    "Run agent commands inside a restricted sandbox environment": "在受限沙盒环境中运行智能体命令",
    "for added security.": "以提高安全性。",
    "Commands executed outside the sandbox require approval.": "在沙盒外执行的命令必须经过用户明确批准。",
    "Commands executed outside the sandbox require explicit user confirmation.": "在沙盒外执行的命令需要用户显式确认。",
    "Sandbox allowed domains": "沙盒允许访问的域名",
    "Sandbox Allowed Domains": "沙盒允许域名",
    "Security Preset": "安全预设",
    "Security preset": "安全预设",
    "security preset": "安全预设",
    "Security Presets": "安全预设",
    "Security presets": "安全预设",
    "security presets": "安全预设",
    "Custom Preset": "自定义预设",
    "Standard Preset": "标准预设",
    "Strict Preset": "严格预设",

    // ===== 深度汉化补充：项目与对话权限继承 (Project & Conversation Permission Inheritance) =====
    "Inherit Global": "继承全局",
    "inherit global": "继承全局",
    "Inherits Global": "继承全局",
    "inherits global": "继承全局",
    "Inherit global": "继承全局",
    "Inherit Global Permissions": "继承全局权限",
    "inherit global permissions": "继承全局权限",
    "Inherit Global Permissions.": "继承全局权限。",
    "Inherits your Global Permissions when working in this project.": "在此项目中工作时继承您的全局权限。",
    "Inherits your Global Permissions when working in this project": "在此项目中工作时继承您的全局权限",
    "inherits your global permissions when working in this project.": "在此项目中工作时继承您的全局权限。",
    "inherits your global permissions when working in this project": "在此项目中工作时继承您的全局权限",
    "Inherits your Global Permissions": "继承您的全局权限",
    "inherits your global permissions": "继承您的全局权限",
    "Manually customize individual settings.": "手动自定义各项独立设置。",
    "Manually customize individual settings": "手动自定义各项独立设置",
    "manually customize individual settings.": "手动自定义各项独立设置。",
    "Also includes": "在当前项目中工作时亦继承",
    "also includes": "在当前项目中工作时亦继承",
    "when working in this project.": "配置。",
    "when working in this project": "配置",
    "When working in this project.": "在当前项目中工作时。",
    "When working in this project": "在当前项目中工作时",
    "This project was created for": "此项目创建用于",
    "automation. Automations do not inherit Global Permissions.": "自动化任务。自动化任务不会继承全局权限。",
    "Automations do not inherit Global Permissions.": "自动化任务不会继承全局权限。",
    "Automations do not inherit Global Permissions": "自动化任务不会继承全局权限",
    "automations do not inherit global permissions.": "自动化任务不会继承全局权限。",
    "Outside of folders file access policy": "工作文件夹外文件访问策略",
    "Configures how the agent tries to access files outside of its working folders.": "配置智能体尝试访问其工作文件夹之外的文件时的访问策略。",
    "Configures how the agent tries to access files outside of its working folders": "配置智能体尝试访问其工作文件夹之外的文件时的访问策略",
    "Terminal Command Auto Execution": "终端命令自动执行",
    "Controls whether terminal commands require your approval before running.": "控制终端命令在运行前是否需要您的批准。",
    "Controls whether terminal commands require your approval before running": "控制终端命令在运行前是否需要您的批准",
    "Proceed in Sandbox": "在沙盒中执行",
    "proceed in sandbox": "在沙盒中执行",
    "Require Review": "需要审查",
    "require review": "需要审查",
    "Permission Preset": "权限预设",
    "permission preset": "权限预设",
    "Permission Presets": "权限预设",
    "permission presets": "权限预设",
    "Permission Settings": "权限设置",
    "permission settings": "权限设置",
    "Local Permissions": "本地权限",
    "local permissions": "本地权限",
    "Agent Settings (For Project)": "智能体设置 (适用于项目)",
    "Configure global allowed and denied resource permissions.": "配置全局允许或禁止的资源权限。",
    "Requires manual review for all terminal commands and file accesses outside of the working folders.": "对所有终端命令以及工作区文件夹之外的文件访问均需要手动审查。",
    "Requires manual review for all terminal commands and file accesses outside of the working folders": "对所有终端命令以及工作区文件夹之外的文件访问均需要手动审查",
    "All terminal commands require review. The agent can read or write to any file in the machine.": "所有终端命令均需审查。智能体可以读写本机上的任意文件。",
    "All terminal commands require review.": "所有终端命令均需审查。",
    "The agent can read or write to any file in the machine.": "智能体可以读写本机上的任意文件。",
    "Disables all safety barriers for maximal iteration velocity.": "禁用所有安全防护以换取最快的迭代速度。",
    "Full machine": "本机全部权限",
    "full machine": "本机全部权限",
    "Useful for typical development with an emphasis on security. It prioritizes safety over speed by requiring manual approval for all terminal commands and files outside the project directory.": "适用于注重安全性的常规开发场景。通过要求对所有终端命令及项目目录之外的文件操作进行手动批准，将安全性置于速度之上。",
    "Useful for tasks that require file access across your full machine. The agent has full read and write access to all local files, but all proposed terminal commands require manual review and approval before running.": "适用于需要跨整台计算机访问文件的任务。智能体对所有本地文件拥有完全读写权限，但所有拟执行的终端命令在运行前均需手动审查与批准。",
    "A high-risk mode that disables all safety barriers. The agent operates with full system access, auto-executes all terminal commands, and reads or writes to all local files without review prompts.": "高风险模式，禁用所有安全防护。智能体拥有完整的系统访问权限，会自动执行所有终端命令，并在读写任意本地文件时均不弹出审查提示。",
    "managed by your organization": "由您的组织统一管理",
    "Disabled by organization policy": "已由组织策略禁用",

    // ===== 深度汉化补充：文件与网络访问策略 (File & Network Access) =====
    "Non-Workspace File Access": "工作区外文件访问",
    "Non-Workspace File Access Policy": "工作区外文件访问策略",
    "non-workspace file access policy": "工作区外文件访问策略",
    "File Access Policy": "文件访问策略",
    "file access policy": "文件访问策略",
    "Controls whether the agent can read or write files outside the current workspace root": "控制智能体是否可以读写当前工作区根目录之外的文件",
    "Controls whether the agent can read or write files outside the current workspace root.": "控制智能体是否可以读写当前工作区根目录之外的文件。",
    "Internet Access Policy": "网络访问策略",
    "internet access policy": "网络访问策略",
    "Controls whether the agent can make network requests": "控制智能体是否可以发起网络外部请求",
    "Controls whether the agent can make network requests.": "控制智能体是否可以发起网络外部请求。",
    "Allow agent access to .gitignore files": "允许智能体访问 .gitignore 忽略的文件",
    "Allow agent access to .gitignore files.": "允许智能体访问 .gitignore 忽略的文件。",
    "Allow": "允许",
    "allow": "允许",
    "Ask": "每次询问",
    "ask": "每次询问",
    "Deny": "拒绝",
    "deny": "拒绝",
    "Allow/deny": "允许/拒绝",
    "Allow/Deny": "允许/拒绝",

    // ===== 深度汉化补充：权限规则、白名单与黑名单 (Permissions & Lists) =====
    "Permission Grants": "权限授予规则",
    "permission grants": "权限授予规则",
    "Global permission grants": "全局权限规则",
    "Project-scoped permission grants": "项目专属权限规则",
    "Command Allowlist": "命令白名单",
    "Command Denylist": "命令黑名单",
    "Command Allowlist / Denylist": "命令白名单 / 黑名单",
    "Specify terminal commands that are always permitted or always blocked.": "指定始终允许直接执行或始终禁止执行的终端命令。",
    "Browser Allowlist": "浏览器白名单",
    "browser allowlist": "浏览器白名单",
    "Restrict which domains the agent's browser tools can navigate to.": "限制智能体浏览器工具可以访问的域名范围。",
    "Define global allow/deny rules for specific files, commands, and URLs.": "为特定的文件路径、终端命令及网络 URL 定义全局允许/拒绝规则。",
    "Add path": "添加路径",
    "Add Path": "添加路径",
    "Add command": "添加命令",
    "Add Command": "添加命令",
    "Add URL": "添加 URL",
    "Add domain": "添加域名",
    "Add Domain": "添加域名",
    "Add rule": "添加规则",
    "Add Rule": "添加规则",
    "Edit rule": "编辑规则",
    "Remove rule": "移除规则",
    "Delete rule": "删除规则",

    // ===== 深度汉化补充：工件审查模式 (Artifact Review Mode) =====
    "Artifact Review Mode": "工件审查模式",
    "artifact review mode": "工件审查模式",
    "Artifact Review": "工件审查",
    "artifact review": "工件审查",
    "Controls when the agent asks for artifact review": "控制智能体何时向用户提请工件审查",
    "Controls when the agent asks for artifact review.": "控制智能体何时向用户提请工件审查。",
    "Override artifact review behavior per project.": "在当前项目中覆盖工件审查行为设置。",

    // ===== 深度汉化补充：浏览器 JS 执行策略 (Browser JS Execution) =====
    "Browser JavaScript Execution": "浏览器 JavaScript 执行策略",
    "Browser JavaScript Execution Policy": "浏览器 JavaScript 执行策略",
    "Browser JS Execution Policy": "浏览器 JS 执行策略",
    "browser js execution policy": "浏览器 JS 执行策略",
    "Controls whether the browser tool can execute JavaScript on web pages.": "控制浏览器工具是否可以在网页上执行 JavaScript 脚本。",

    // ===== 深度汉化补充：远程控制 (Remote Control) =====
    "Remote Control": "远程控制",
    "remote control": "远程控制",
    "Enable Remote Control": "启用远程控制",
    "enable remote control": "启用远程控制",
    "Remote control hostname": "远程控制主机名",
    "Remote Control Hostname": "远程控制主机名",
    "Allow controlling this agent instance remotely via CLI or web.": "允许通过命令行工具或 Web 端远程控制当前智能体实例。",
    "Staying disconnected: Remote Control user setting is off": "保持断开：远程控制用户设置已关闭",

    // ===== 深度汉化补充：数据存储、缓存与维护 (Data, Storage & Reset) =====
    "Data & Storage": "数据与存储",
    "Data and Storage": "数据与存储",
    "Storage": "存储空间",
    "Clear cache": "清除缓存",
    "Clear Cache": "清除缓存",
    "Clear temporary data and cached assets.": "清除临时数据和缓存资源。",
    "Reset all settings": "重置所有设置",
    "Reset all settings to default": "恢复所有设置为默认值",
    "Reset Settings": "重置设置",
    "Restore all settings back to their factory default values.": "将所有配置选项还原为出厂默认设置。",
    "Open configuration folder": "打开配置所在文件夹",
    "Open application logs": "打开应用程序日志",
    "Open Logs Folder": "打开日志文件夹",
    "Data storage path": "数据存储路径",

    // ===== 深度汉化补充：点数用量与账号 (Credits & Account) =====
    "AI Credits": "AI 点数",
    "ai credits": "AI 点数",
    "Use AI credits": "使用个人 AI 点数",
    "use ai credits": "使用个人 AI 点数",
    "Consume personal tier credits for faster inference and higher rate limits.": "使用个人等级点数以获得更快的推理速度和更高的调用限额。",
    "Account": "账号",
    "Account & Profile": "账号与个人中心",
    "Sign in with Google": "使用 Google 账号登录",
    "Signed in as": "当前登录账号",
    "Log out": "退出登录",
    "Sign out": "退出登录",
    "Manage subscription": "管理订阅计划",
    "Manage Google account": "管理 Google 账号",

    // ===== 深度汉化补充：通用偏好、系统托盘与远程控制 =====
    "Manage Antigravity app settings.": "管理 Antigravity 应用程序偏好设置。",
    "Keep the app accessible from the menu bar and running in the background when all windows are closed.": "关闭所有窗口后，保持应用常驻系统托盘并继续在后台运行。",
    "Work with local agents from another device.": "支持从其他设备远程协同与控制本地智能体。",
    "Browser settings have moved": "浏览器设置已迁移",
    "Browser settings have moved to the Browser section of General settings.": "浏览器设置已移动到“常规设置”的“浏览器”板块中。",
    "Go to General settings": "前往常规设置",
    "Models & Usage": "模型配额与用量",
    "Manage your model quota and credits.": "管理您的模型配额与个人 AI 点数。",
    "Show Selection Actions": "显示划词快捷操作",
    "Show Selection Actions when selecting text": "选中文本时显示划词操作",
    'Show "Edit" and "Chat" buttons when selecting text in the editor.': '在编辑器中选中代码或文本时，浮动显示“编辑”与“聊天”快捷按钮。',
    "Selection Actions": "划词操作",
    "Previous Pane Tab": "切换到上一个窗格",
    "Next Pane Tab": "切换到下一个窗格",
    "Toggle Terminal": "切换终端面板",
    "Add to Chat/Quote": "添加到聊天引用",

    // ===== 深度汉化补充：Labs 实验功能与开发者工具 =====
    "Try out early-stage features before they ship. These may change or be removed at any time.": "在正式发布前抢先体验早期新特性。这些功能可能会随时变更或移除。",
    "Experimental features": "实验性功能",
    "Conversation Sharing": "对话分享",
    "Generate a link that lets any Googler load a read-only copy of a conversation. Sharing exports the conversation history to your public x20 folder, so it needs that folder to be readable by others.": "生成一个只读对话分享链接。分享操作会将对话记录导出至公开目录，需要该目录对外具备读取权限。",
    "Inline Actions": "内联操作卡片",
    "Show a floating notification card when background conversations need your input. Answer questions, approve commands, and grant permissions without leaving your current conversation. Share feedback at go/inline-actions-feedback.": "当后台对话需要您的输入时显示浮动通知卡片。无需切换离开当前对话即可直接回答问题、审批命令及授予权限。",
    "CitC Settings": "CitC 工作区设置",
    "Manage settings specific to Google CitC workspaces development.": "管理专用于 Google CitC 工作区开发的配置项。",
    "Best of N": "Best of N 策略配置",
    "Manage how Best of N sets up the workspaces its arms run in.": "配置 Best of N 在各分支运行时的工作区环境。",
    "Developer-only tools. These settings are stored locally in this browser and do not affect other users.": "仅限开发者使用的内部工具。这些设置仅保存在本地，不会影响其他用户。",
    "Regroup Google3 Chats": "重新归类 Google3 对话",
    "Google3 chats will be regrouped into their workspaces in the sidebar.": "侧边栏中的 Google3 对话将按所属工作区重新归类分组。",
    "This migration may mess up your settings, chats, and sidebar.": "此项迁移可能会影响您的偏好设置、对话记录及侧边栏布局。",
    "Follow the guide at go/jetski-project-migration to back up your data and run the migration.": "请按照相关指南备份您的数据后再执行迁移。",
    // ===== 全量预置 MCP 服务器卡片与生态长句深度汉化 (63 款官方与社区 MCP) =====
    // 1. MCP 标题与界面导航
    "Google Kubernetes Engine (Remote)": "Google Kubernetes Engine (远程)",
    "Google Cloud Bigtable Admin": "Google Cloud Bigtable 管理",
    "Google Cloud CLI (Preview)": "Google Cloud CLI (预览版)",
    "Google Cloud Apigee API hub": "Google Cloud Apigee API Hub",
    "Knowledge Catalog": "Knowledge Catalog 数据资产目录",
    "MCP Toolbox for Databases": "数据库 MCP 工具箱 (MCP Toolbox for Databases)",
    "Oracle Database": "Oracle 数据库",
    "Google Home Developer": "Google Home 开发者",
    "Perplexity Ask": "Perplexity 搜索 (Perplexity Ask)",
    "Sequential Thinking": "顺序思考 (Sequential Thinking)",
    "Sonatype Guide": "Sonatype 指南 (Sonatype Guide)",
    "Google Maps Platform Code Assist": "Google Maps Platform 编程助手",
    "ArizeTracingAssistant": "Arize Tracing 助手",
    "Google Developer Knowledge": "Google 开发者知识库",
    "Android Management API": "Android 管理 API",
    "Google Cloud Resource Manager": "Google Cloud 资源管理器",
    "Vertex AI Search": "Vertex AI 搜索",
    "Google Cloud Logging": "Google Cloud 日志",
    "Google Managed Service for Apache Kafka": "Google Cloud 托管 Apache Kafka 服务",
    "Google Cloud Monitoring": "Google Cloud 监控",
    "Google Cloud Quotas": "Google Cloud 配额管理",
    "Chrome DevTools for agents": "面向智能体的 Chrome DevTools",
    "Cloud Run": "Cloud Run",
    "Cloud 运行": "Cloud Run",
    "Search MCP servers...": "搜索 MCP 服务器...",
    "Search MCP servers": "搜索 MCP 服务器",
    "Available MCP Servers": "可用 MCP 服务器",
    "Available MCP servers": "可用 MCP 服务器",
    "All MCP Servers": "全部 MCP 服务器",
    "All MCP servers": "全部 MCP 服务器",
    "Featured MCP Servers": "精选 MCP 服务器",
    "Featured MCP servers": "精选 MCP 服务器",
    "Custom MCP Server": "自定义 MCP 服务器",
    "Add Custom MCP Server": "添加自定义 MCP 服务器",
    "Add custom MCP server": "添加自定义 MCP 服务器",
    "Install MCP Server": "安装 MCP 服务器",
    "Add Server": "添加服务器",
    "Remove MCP Server": "移除 MCP 服务器",
    "Configured MCP Servers": "已配置的 MCP 服务器",

    // 2. 预置 63 款 MCP 服务卡片描述长句
    "Investigate and fix software issues using AI-powered root cause analysis. This MCP server connects to your Antimetal account to search issues, read investigative reports with causal graphs, retrieve observability artifacts (logs, traces, metrics), and apply remediations—directly from your AI tools.": "利用 AI 驱动的根因分析调查并修复软件问题。该 MCP 服务器可连接到您的 Antimetal 账户，支持检索问题、阅读带因果关系图的调查报告、提取可观测性工件（日志、链路追踪、指标），并直接在您的 AI 工具中应用修复方案。",
    "Query and act on your marketing, analytics, CRM, e-commerce, and warehouse data across 325+ connectors (Meta Ads, Google Ads, TikTok Ads, GA4, HubSpot, Salesforce, Shopify, Stripe, BigQuery, Snowflake, and more) using natural language. Read live data and write changes back (pause or enable campaigns, set budgets, upload conversions) with no SQL and no custom integrations.": "通过自然语言查询并操作跨 325+ 个连接器（Meta Ads、Google Ads、TikTok Ads、GA4、HubSpot、Salesforce、Shopify、Stripe、BigQuery、Snowflake 等）的营销、分析、CRM、电商及数据仓库数据。无需编写 SQL 或定制集成，即可读取实时数据并回写变更（如暂停/启用营销活动、调整预算、上传转化数据）。",
    "Query your GitLab SDLC as a knowledge graph. Orbit indexes groups, projects, source code, merge requests, pipelines, work items, and security findings into a single graph so agents can answer blast radius, onboarding, and dependency mapping questions by traversing real relationships instead of grepping across separate systems.": "将您的 GitLab 软件开发生命周期 (SDLC) 作为知识图谱进行查询。Orbit 会将群组、项目、源码、合并请求 (MR)、流水线、工作项及安全漏洞索引到一个统一的图谱中，使智能体能通过遍历真实关联关系来解答影响范围 (blast radius)、新人上手以及依赖拓扑映射等问题，而无需在不同系统间进行机械 grep 搜索。",
    "Enable Antigravity to deploy apps to Google Cloud Run.": "让 Antigravity 能够直接将应用部署到 Google Cloud Run 无服务器容器平台。",
    'Ask questions. Get answers. The MCP is a server your coding agent talks to. Ask a question in English. It runs the query against your PostHog data. The answer lands in your editor. No SQL. No dashboards. No tabs full of charts you forgot you opened. Try things like: - "How many unique users signed up in the last 7 days, broken down by day?" - "Create an A/B test for our pricing page that measures conversion to checkout." - "What are the top 5 errors in my project this week?"': "提出问题，获取答案。该 MCP 服务器为您的编程智能体提供数据对话能力。直接用自然语言提问，它将对您的 PostHog 数据执行查询，并直接在编辑器中返回结果。无需编写 SQL，无需翻找仪表盘，也无需打开一堆遗忘的图表标签页。您可以尝试提问：“过去 7 天每天有多少独立用户注册？”、“为定价页面创建 A/B 测试以衡量结账转化率”、“本周我项目中排名前 5 的错误是什么？”",
    "Search and reference over 600,000 real-world app screens, user flows, and UI patterns from Mobbin directly within your AI tools.": "直接在您的 AI 工具中检索并参考来自 Mobbin 的 60 多万个真实移动应用界面、用户旅程流程及 UI 设计模式。",
    "Build, edit, deploy, and manage full-stack web apps with Lovable, the AI-powered app builder, using natural language. This MCP server connects your AI client to Lovable so you can create projects and workspaces, send build instructions to the Lovable agent, inspect generated code via diffs and file trees, read and write project knowledge, manage Postgres databases and connectors, and deploy apps directly from your AI tools.": "通过自然语言使用 AI 应用构建工具 Lovable 构建、编辑、部署和管理全栈 Web 应用。该 MCP 服务器将您的 AI 客户端连接至 Lovable，支持创建项目与工作区、向 Lovable 智能体发送构建指令、通过 Diff 和文件树审查生成代码、读写项目知识库、管理 Postgres 数据库与连接器，并直接在 AI 工具中完成应用部署。",
    "The GKE remote MCP server provides read write access to your GKE Kubernetes resources. It allows an AI agent to inspect and observe your environment.": "GKE 远程 MCP 服务器提供对您 GKE Kubernetes 资源的读写访问权限，允许 AI 智能体检查和观测您的集群与运行环境。",
    "The Dart and Flutter MCP server exposes Dart (and Flutter) development tool actions to compatible AI-assistant clients.": "Dart 与 Flutter MCP 服务器向兼容的 AI 助手客户端开放 Dart（及 Flutter）开发工具的各项操作指令。",
    "The Firebase Model Context Protocol (MCP) Server gives AI-powered development tools the ability to work with your Firebase projects and your app's codebase.": "Firebase MCP 服务器让 AI 驱动的开发工具具备协同操作 Firebase 项目及应用程序代码库的能力。",
    "The Genkit Model Context Protocol (MCP) Server gives AI-powered development tools the ability to build, debug and inspect your Genkit app.": "Genkit MCP 服务器让 AI 驱动的开发工具具备构建、调试和检查 Genkit 应用的能力。",
    "The gopls Model Context Protocol (MCP) server provides tools for semantic code analysis, live diagnostics, and transformation of your Go codebase.": "gopls MCP 服务器为您的 Go 代码库提供语义代码分析、实时诊断以及代码重构转换工具。",
    "Interact with your BigQuery data using natural language. This MCP server allows you to securely connect to your datasets to search the datasets, inspect table metadata, execute SQL queries, generate time-series forecasts, and perform contribution analysis directly from your AI tools.": "使用自然语言与您的 BigQuery 数据交互。该 MCP 服务器让您能够安全连接到数据集，直接在 AI 工具中搜索数据集、检查数据表元数据、执行 SQL 查询、生成时间序列预测并执行贡献度归因分析。",
    "The AlloyDB for PostgreSQL remote MCP server lets you access and run AlloyDB tools to manage AlloyDB clusters and instances, manage users, create and restore backups, administer users, import and export data, and run SQL queries from your AI-enabled development environments and AI agent platforms.": "AlloyDB for PostgreSQL 远程 MCP 服务器让您能从 AI 开发环境和智能体平台访问并运行 AlloyDB 工具，用以管理集群与实例、管理用户权限、创建与恢复备份、导入导出数据以及执行 SQL 查询。",
    "The Bigtable Admin remote MCP server lets you manage Bigtable resources.": "Bigtable Admin 远程 MCP 服务器让您能够全面管理 Google Cloud Bigtable 资源。",
    "Manage Google Cloud resources with gcloud and bq CLI tools in a remote sandbox environment": "在远程沙盒环境中通过 gcloud 和 bq 命令行工具管理 Google Cloud 云资源",
    "The Cloud SQL remote MCP server lets you access and run Cloud SQL tools to manage Cloud SQL instances, manage users, create and restore backups, administer users, import and export data, and run SQL queries from your AI-enabled development environments and AI agent platforms.": "Cloud SQL 远程 MCP 服务器让您能从 AI 开发环境和智能体平台访问并运行 Cloud SQL 工具，用以管理实例、管理用户权限、创建与恢复备份、导入导出数据以及执行 SQL 查询。",
    "The Spanner remote MCP server lets you access and run Spanner tools to create, manage, and query Spanner resources from your AI-enabled development environments and AI agent platforms.": "Spanner 远程 MCP 服务器让您能从 AI 开发环境和智能体平台访问并运行 Spanner 工具，以创建、管理和查询 Spanner 分布式数据库资源。",
    "The Apigee API hub remote MCP server lets you manage the APIs, versions, specs, operations, deployments, attributes, external APIs, and dependencies registered in your API hub instance - including creating, reading, updating, and deleting them - and search across resources, using natural language.": "Apigee API Hub 远程 MCP 服务器让您能通过自然语言管理在 API Hub 实例中注册的 API、版本、规范、操作、部署、属性、外部 API 及依赖项（包括增删改查），并跨资源进行智能检索。",
    "Connect your AI assistants to Looker business intelligence. This MCP server enables data exploration and content management by allowing you to execute natural language queries, run saved Looks, create and manage dashboards, and perform instance health checks within your Looker environment.": "将您的 AI 助手连接到 Looker 商业智能平台。该 MCP 服务器支持通过自然语言执行查询、运行已保存的 Look 分析、创建和管理仪表盘，并在 Looker 环境中执行实例健康检查，赋能数据探索与内容管理。",
    "Connect your AI assistants to the Knowledge Catalog (formerly known as Dataplex). This MCP server enables data discovery and governance by allowing you to search for data assets, retrieve detailed metadata such as schemas and ownership, and explore aspect types across your distributed data.": "将您的 AI 助手连接到 Knowledge Catalog（前身为 Dataplex）。该 MCP 服务器支持数据发现与数据治理，允许您搜索数据资产、检索表结构模式 (Schema) 与归属权等详细元数据，并探索分布式数据中的切面类型。",
    "The MCP Toolbox for Databases is an open-source MCP server designed to simplify and secure the development of tools for interacting with databases.": "MCP Toolbox for Databases 是一个开源 MCP 服务器，旨在简化并保障数据库交互工具开发的安全与效率。",
    "Interact with your Oracle Database data using natural language. This MCP server allows you to securely connect to your databases for executing SQL queries, inspecting table schemas, and troubleshooting database performance issues directly from your AI tools.": "使用自然语言与您的 Oracle 数据库交互。该 MCP 服务器让您能够安全连接到数据库，直接在 AI 工具中执行 SQL 查询、检查表模式结构，并排查数据库性能瓶颈与故障。",
    "The Dev Mode MCP Server brings Figma directly into your workflow by providing important design information and context to AI agents generating code from Figma design files.": "Dev Mode MCP 服务器将 Figma 深度融入您的开发工作流，为从 Figma 设计稿生成代码的 AI 智能体提供关键的设计信息与上下文依据。",
    "The GitHub MCP Server is a Model Context Protocol (MCP) server that provides seamless integration with GitHub APIs, enabling advanced automation and interaction capabilities for developers and tools.": "GitHub MCP 服务器提供与 GitHub API 的无缝集成，为开发者和工具赋能强大的自动化协同与操作能力。",
    "The Google Home Developer MCP server allows you to search through Google Home documentation, OpenThread and Matter specifications documentation.": "Google Home Developer MCP 服务器让您能够检索 Google Home 文档、OpenThread 以及 Matter 智能家居协议规范文档。",
    "Neon MCP Server is an open-source tool that lets you interact with your Neon Postgres databases in natural language.": "Neon MCP Server 是一款开源工具，支持通过自然语言与您的 Neon Serverless Postgres 数据库进行交互操作。",
    "The Stripe Model Context Protocol server allows you to integrate with Stripe APIs through function calling. This protocol supports various tools to interact with different Stripe services.": "Stripe MCP 服务器允许您通过函数调用 (Function Calling) 与 Stripe API 集成，支持使用多种内置工具与各类 Stripe 支付及账务服务进行交互。",
    "Interact with Redis key-value stores": "与 Redis 键值存储数据库进行高效交互",
    "A Model Context Protocol server for interacting with MongoDB Atlas.": "用于与 MongoDB Atlas 云数据库进行交互的 MCP 服务器。",
    "Official Notion MCP Server that allows interaction with Notion workspaces, pages, databases, and comments via the Notion API.": "官方 Notion MCP 服务器，支持通过 Notion API 与 Notion 工作区、页面、数据库及评论进行协同交互。",
    "Official Linear.app MCP Server for interacting with Linear projects, issues, and workflows.": "官方 Linear.app MCP 服务器，用于与 Linear 项目、Issue 问题工单以及研发工作流进行交互。",
    "An MCP server implementation that integrates the Perplexity Sonar API to provide real-time, web-wide research capabilities.": "集成 Perplexity Sonar API 的 MCP 服务器实现，为智能体提供实时、全网范围的深度检索与信息调研能力。",
    "Official PayPal MCP Server that allows integration with PayPal APIs for payment processing, transaction management, and account operations.": "官方 PayPal MCP 服务器，支持与 PayPal API 集成以处理在线支付、交易管理及账户操作。",
    "The Heroku Platform MCP Server enables seamless interaction with Heroku Platform resources, allowing LLMs to read, manage, and operate applications, add-ons, databases, and more.": "Heroku Platform MCP 服务器实现与 Heroku 平台资源的无缝交互，允许大语言模型读取、管理和运维应用程序、附加组件 (Add-ons)、数据库等。",
    "The Pinecone MCP Server enables AI tools to search Pinecone documentation, configure indexes, generate code informed by your index configuration, and upsert/search data in your Pinecone indexes.": "Pinecone MCP 服务器让 AI 工具能够检索 Pinecone 文档、配置向量索引、根据索引配置生成代码，并在 Pinecone 索引中执行数据更新 (upsert) 与向量相似度搜索。",
    "Connect your Supabase projects to AI assistants. This MCP server allows managing tables, fetching config, executing SQL queries, managing edge functions, and working with database schema in your Supabase projects.": "将您的 Supabase 项目连接至 AI 助手。该 MCP 服务器支持管理数据表、拉取项目配置、执行 SQL 查询、管理 Edge Functions 边缘函数，以及维护数据库架构模式。",
    "The Prisma MCP Server enables AI tools to interact with Prisma for creating and managing Postgres databases easily.": "Prisma MCP 服务器让 AI 工具能够与 Prisma 交互，轻松创建和管理 Postgres 数据库。",
    "The Locofy MCP Server enables Locofy.ai code to be integrated and extended with your IDE.": "Locofy MCP 服务器支持将 Locofy.ai 前端生成代码集成并拓展到您的 IDE 编辑器中。",
    "Airweave lets agents search any app.": "Airweave 赋予智能体检索任意第三方应用数据的能力。",
    "Atlassian MCP Server for interacting with Atlassian products.": "用于与 Jira、Confluence 等 Atlassian 旗下产品进行交互的 MCP 服务器。",
    "Interact with your Harness account using natural language. This MCP server lets AI agents inspect and manage CI/CD pipelines, executions, services, environments, connectors, feature flags, cloud costs, security findings, chaos experiments, and other Harness platform resources.": "通过自然语言与您的 Harness 账户交互。该 MCP 服务器让 AI 智能体能够检查并管理 CI/CD 流水线、执行记录、微服务、部署环境、连接器、功能开关 (Feature Flags)、云成本、安全发现、混沌工程实验以及其他 Harness 平台资源。",
    "SonarQube MCP Server enables AI assistants to interact with SonarQube instances for code quality analysis, project management, and quality gate operations.": "SonarQube MCP 服务器让 AI 助手能够与 SonarQube 实例交互，执行代码质量分析、项目管理以及质量阀 (Quality Gate) 门禁操作。",
    "Netlify MCP Server enables AI assistants to interact with Netlify's platform for managing sites, deployments, domains, and other web development workflows.": "Netlify MCP 服务器让 AI 助手能够与 Netlify 平台交互，以管理网站、部署记录、自定义域名及其他 Web 开发工作流。",
    "A Model Context Protocol server that provides structured thinking and reasoning capabilities for LLM conversations.": "为大语言模型对话提供结构化深思、思维链推演与逻辑推导能力的 MCP 服务器。",
    "Sonatype MCP server for interacting with our dependency management and security intelligence platform.": "用于与 Sonatype 依赖项管理及开源安全情报平台进行交互的 MCP 服务器。",
    "The Google Maps Platform Code Assist MCP server provides your favorite AI coding assistant with up-to-date, official Google Maps Platform documentation, code samples, and best practices. By grounding your AI assistant in our official resources, it can generate more accurate, reliable, and useful code.": "Google Maps Platform Code Assist MCP 服务器为您的 AI 编程助手提供最新官方 Google Maps Platform 文档、代码示例和最佳实践。通过将 AI 助手的认知锚定在官方权威资源中，能够生成更精确、更可靠、更具实用价值的代码。",
    "This MCP server provides your LLM with docs and examples to instrument your AI apps with Arize AX. It also provides access to Arize support. Connect it to your IDE or LLM and get curated tracing examples, best practices and Arize support!": "该 MCP 服务器为大语言模型提供文档和示例，帮助使用 Arize AX 埋点监控您的 AI 应用，同时提供对 Arize 支持服务的访问。连接到您的 IDE 或大模型，即可获取精心策划的链路追踪示例、最佳实践与官方支持！",
    "The Postman MCP Server connects Postman to AI tools, giving AI agents and assistants the ability to access workspaces, manage collections and environments, evaluate APIs, and automate workflows through natural language interactions.": "Postman MCP 服务器将 Postman 连接至 AI 工具，让 AI 智能体与助手能通过自然语言交互访问工作区、管理集合 (Collections) 与环境变量、评估 API，并实现接口自动化工作流。",
    "The Stitch MCP server enables AI assistants to interact with Stitch for vibe design: generating UI designs from text and images, and accessing project and screen details. See https://stitch.withgoogle.com/docs for more details.": "Stitch MCP 服务器让 AI 助手能够与 Stitch 交互以进行即兴设计 (Vibe Design)：根据文本和图像生成 UI 设计，并访问项目及屏幕界面细节。详见 https://stitch.withgoogle.com/docs。",
    "The Google Developer Knowledge MCP server gives AI-powered development tools the ability to search Google's official developer documentation and retrieve information for Google's products such as Firebase, Google Cloud, Android, Maps, and more. By connecting your AI application straight to our official library of documentation, it ensures the code and guidance you receive are up-to-date and based on authoritative context.": "Google Developer Knowledge MCP 服务器让 AI 驱动的开发工具能够检索 Google 官方开发者文档，并获取 Firebase、Google Cloud、Android、Maps 等 Google 产品的信息。通过将您的 AI 应用直接接入官方文档库，确保您获得的代码和技术指导保持最新并基于权威上下文。",
    "The ClickHouse MCP server enables agents to securely interact with ClickHouse databases. It provides a universal interface to execute SQL, explore data, and view backup & billing details, allowing agentic tooling to leverage ClickHouse's high-performance analytical capabilities.": "ClickHouse MCP 服务器使智能体能够安全地与 ClickHouse 数据库交互。它提供用于执行 SQL、探索数据以及查看备份与计费详情的通用接口，赋能智能体工具充分利用 ClickHouse 极致的高性能分析能力。",
    "Perform a range of infrastructure management tasks, including: manage virtual machine (VM) instances, manage instance group managers and instance templates, manage disks and snapshots, retrieve information about reservations and commitments.": "执行一系列基础架构管理任务，包括：管理虚拟机 (VM) 实例、管理实例组管理器与实例模板、管理磁盘与快照、获取预留资源与承诺使用折扣信息。",
    "Access enterprise mobility data using natural language queries about device fleets, automated auditing of policy compliance, and the integration of device management data into broader automated workflows.": "使用自然语言查询获取企业移动管理数据，涵盖设备机群状态、合规策略自动化审计，以及将设备管理数据无缝集成到更广泛的自动化工作流中。",
    "Search your Google Cloud projects using natural language.": "通过自然语言快速检索您的 Google Cloud 项目与资源层级。",
    "Perform searches on ingested data in Google-owned data stores.": "在 Google 托管的数据存储区中，对已摄取的数据执行智能语义与向量搜索。",
    "Interact with documents stored in a Firestore database using natural language.": "使用自然语言与存储在 Firestore 数据库中的文档进行交互与查询。",
    "Access resources in the Cloud Logging platform using natural language.": "使用自然语言访问和查询 Cloud Logging 日志平台中的各类资源与日志流。",
    "Manage clusters for Managed Service for Apache Kafka and Kafka Connect using natural language.": "使用自然语言管理 Google Cloud 托管 Apache Kafka 服务集群与 Kafka Connect 连接器。",
    "Access resources in the Cloud Monitoring platform using natural language.": "使用自然语言访问和查看 Cloud Monitoring 监控平台中的各类监控资源与指标度量。",
    "Manage Pub/Sub resources and publish messages. Create, list, get, update, and delete Pub/Sub topics, subscriptions, and snapshots, as well as publish messages to topics.": "管理 Pub/Sub 资源并发布消息。支持创建、列出、获取、更新和删除 Pub/Sub 主题 (Topics)、订阅 (Subscriptions) 及快照，并向指定主题投递消息。",
    "The Cloud Quotas MCP server allows you to view quota allocations, request quota increases, and manage Quota Adjuster configurations.": "Cloud Quotas MCP 服务器允许您查看配额分配情况、申请提升服务配额，以及管理 Quota Adjuster 自动配额调整器配置。",
    "Enable Antigravity to control and inspect a live Chrome browser, with access to the full power of Chrome DevTools for reliable automation, in-depth debugging, and performance analysis.": "让 Antigravity 能够直接控制并检查运行中的 Chrome 浏览器，充分调用 Chrome DevTools 的强大能力，实现高可靠的自动化操作、深度调试与性能分析。",

    // 斜杠命令（Slash Commands）原生说明、浮动卡片与简介汉化
    "Invoke the Boost multi-agent orchestrator for complex tasks.": "调用 Boost 多智能体编排器处理复杂任务。",
    "Run until the specified goal is completely finished.": "持续自主运行，直至指定目标彻底完成。",
    "Run an instruction on a recurring schedule or as a one-time timer.": "按周期循环计划或单次定时器执行指令。",
    "Invoke a browser agent for web tasks.": "调用浏览器智能体执行网页相关任务。",
    "[Teamfood] Invoke a browser with computer-use tools only with experimental model.": "[内部测试] 仅在实验模型下调用具备计算机操作工具的浏览器。",
    "Plan carefully before executing a task.": "在执行任务前进行周密规划。",
    "Interview me to align on a plan.": "通过交互式提问访谈，与我沟通对齐方案设计。",
    "Invoke a team of agents to autonomously tackle large projects.": "调度智能体团队协同自主处理大型工程项目。",
    "Reflect on recent successes or corrections to capture reusable skills or rules.": "回顾近期的成功经验或纠偏记录，沉淀可复用的技能或规则。",
    "Experimental. Invoke the deep agent to plan, build, verify complex coding tasks.": "实验性。调用深度智能体进行复杂编程任务的规划、构建与验证。",
    "Ask a quick question without interrupting the main conversation.": "提出快速疑问，不中断主对话流程。",
    "enhance thinking effort by using a multi-agent reasoning pipeline.": "通过多智能体推理流水线增强深度思考能力。",

    // 斜杠命令智能体推荐文案 (System / Language Server Recommendation Prompts)
    "Available slash commands you can recommend to the user:": "可推荐给用户的可用斜杠命令：",
    "You cannot execute these commands yourself. Your role is to recommend them to the user when they are a good fit for the task at hand, encouraging the user to explore and trigger them.": "您不能自行执行这些命令。您的职责是在命令契合当前任务时向用户推荐，引导用户主动探索并触发它们。",
    'To recommend a slash command, suggest it clearly in your response (e.g., "You can use the \\x60/goal\\x60 command to...").': '如需推荐斜杠命令，请在回复中明确建议（例如："您可以使用 \\x60/goal\\x60 命令来..."）。',
    "Recommend this when the user has a complex coding or research project that requires deep thinking, strategic planning, multiple perspectives, and rigorous verification.": "当用户拥有需要深度思考、策略规划、多视角审视和严谨验证的复杂编程或调研项目时推荐此项。",
    "Recommend this when the user wants to run a long-running task (e.g., overnight) and wants the agent to be extra thorough and not stop until the goal is fully achieved.": "当用户希望执行长时间运行的任务（例如通宵运行），且要求智能体格外彻底并在目标完全达成前不停止时推荐此项。",
    "Recommend this when the user wants to run an instruction on a recurring schedule or set a one-time timer.": "当用户希望按周期循环计划运行指令或设置单次定时器时推荐此项。",
    "Recommend this when the user's task involves web browsing, searching the web, or interacting with web applications.": "当用户的任务涉及网页浏览、搜索网络或与 Web 应用程序交互时推荐此项。",
    "Recommend this when the user wants to align on a plan through an interactive interview to resolve design decisions.": "当用户希望通过交互式访谈对齐方案以敲定设计决策时推荐此项。",
    "Recommend this when the user has a large project that would benefit from a team of autonomous agents working together.": "当用户拥有适合由自主智能体团队协作推进的大型工程项目时推荐此项。",
    "Recommend this when the user has corrected the agent or solved a complex setup and wants the agent to persist this behavior for future tasks.": "当用户纠正了智能体或解决了复杂配置，并希望智能体在后续任务中持久复用该行为时推荐此项。",

    // 内置技能（自动注入斜杠命令菜单）说明文案
    "Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.": "在全局与工作区配置中将旧版工作流自动迁移为现代技能。扫描现有工作流，生成目标 SKILL.md 文件并安全归档旧文件。",
    "Use this skill when configuring, managing, or troubleshooting MCP (Model Context Protocol) tool permissions and whitelist authorizations in Antigravity. Covers syntax rules, config file locations, automatic whitelist injection, avoiding UI overwrite traps, and troubleshooting Windows environment gotchas.": "在 Antigravity 中配置、管理或排查 MCP 工具权限与白名单授权时使用此技能。涵盖语法规则、配置文件位置、自动白名单注入、规避 UI 覆盖陷阱以及 Windows 避坑指南。",
    "Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.": "与 GitHub 交互的操作准则，当命令因智能体环境限制执行失败时向用户申请授权。",
    "Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars). Activate this skill when the user asks questions about how to use, configure, or customize Antigravity, AGY, the agy CLI, the Antigravity IDE, or Antigravity 2.0.": "提供 Google Antigravity (AGY) 的完整指南、速查参考与系统导航，涵盖 Antigravity CLI (agy)、Antigravity 2.0、Antigravity IDE、Python SDK、斜杠命令、快捷键及自定义扩展（技能、规则、MCP、Sidecar）。",
    "Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work, their loading priority, discovery mechanisms, and to guide the creation of skills, rules, plugins, hooks, and MCP servers.": "Antigravity 自定义扩展系统的完整指南与技术参考。用于阐述自定义项的工作机制、加载优先级、自动发现机制，并指导技能、规则、插件、钩子及 MCP 服务器的创建。",
    "How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text and markdown.": "如何在对话中以内联方式或作为独立工件渲染丰富的交互式 HTML 小部件。当需要向用户展示架构图表、数据可视化、交互式控件、教程回顾或超出纯文本与 Markdown 的丰富视觉内容时使用此技能。",

    // 斜杠菜单与提及（Mention）下拉弹出容器状态与分组提示
    "recently opened": "最近打开",
    "Recently opened": "最近打开",
    "Recently Opened": "最近打开",
    "file results": "文件结果",
    "File results": "文件结果",
    "File Results": "文件结果",
    "No matching results": "无匹配结果",
    "Searching…": "搜索中…",
    "Searching...": "搜索中...",
    "Mentions": "提及",
    "Commands": "命令",
    "Skills": "技能",
    "Workflows": "工作流",

    // ===== 深度汉化补充：高级设置与差异视图操作 (Advanced Settings & Diff Review Actions) =====
    "Advanced Settings": "高级设置",
    "Advanced settings": "高级设置",
    "advanced settings": "高级设置",
    "Advanced 设置": "高级设置",
    "advanced 设置": "高级设置",
    "Advanced": "高级",
    "advanced": "高级",
    "Automatic Check for Updates": "自动检查更新",
    "automatic check for updates": "自动检查更新",
    "Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the app menu.": "当有新版本可用时，自动提示您重启应用以完成更新。禁用后，您可以在应用菜单中手动检查更新。",
    "Automatically prompt you to restart the app when a new update is available.": "当有新版本可用时，自动提示您重启应用以完成更新。",
    "When disabled, you can check for updates manually from the app menu.": "禁用后，您可以在应用菜单中手动检查更新。",
    "Collapse All": "全部折叠",
    "collapse all": "全部折叠",
    "Collapse all": "全部折叠",
    "Expand All": "全部展开",
    "expand all": "全部展开",
    "Expand all": "全部展开",
    "View Stacked Diff": "查看堆叠差异",
    "view stacked diff": "查看堆叠差异",
    "View Split Diff": "查看分屏差异",
    "view split diff": "查看分屏差异",
    "Show Whitespace Changes": "显示空白字符变动",
    "show whitespace changes": "显示空白字符变动",
    "Hide Whitespace Changes": "隐藏空白字符变动",
    "hide whitespace changes": "隐藏空白字符变动",
    "Collapse All Folders": "折叠所有文件夹",
    "collapse all folders": "折叠所有文件夹",
    "Expand All Folders": "展开所有文件夹",
    "expand all folders": "展开所有文件夹",
    "Collapse folder": "折叠文件夹",
    "Expand folder": "展开文件夹",
    "Collapse file": "折叠文件",
    "Expand file": "展开文件",
    "Open in Code Search": "在代码搜索中打开",

    // === 2.18.1 补全：向导截断容错 ===
    "Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named": "Antigravity 经过全面重构，赋予智能体更强大的原生能力。如果您仍需要代码编辑器，可单独下载独立应用",
    "If you'd still like a code editor, you can download it as a separate app named": "如果您仍需要代码编辑器，可单独下载独立应用",
    "separate app named Antigravity IDE": "名为 Antigravity IDE 的独立应用",
    "separate app named": "独立应用",

    // === 2.18.1 补全：代码差异与 Diff 工具栏 ===
    "Insert into terminal": "插入至终端",
    "Run in terminal": "在终端中运行",
    "Apply diff": "应用改动",
    "Revert diff": "还原改动",
    "Accept changes": "接受改动",
    "Reject changes": "放弃改动",
    "Show diff": "显示差异",
    "Hide diff": "隐藏差异",
    "Inline diff": "行内差异",
    "Side-by-side diff": "并排差异",
    "Toggle raw markdown": "切换原生 Markdown",
    "View raw markdown": "查看原生 Markdown",
    "Copy raw markdown": "复制原生 Markdown",
    "Clear Conversation": "清除对话",
    "Export Conversation": "导出对话",
    "Share Conversation": "分享对话",

    // === 2.18.1 补全：智能体运行态胶囊与状态提示 ===
    "Planning...": "正在制定计划...",
    "Generating plan...": "正在生成计划...",
    "Executing command...": "正在执行命令...",
    "Analyzing repository...": "正在分析代码库...",
    "Reading files...": "正在读取文件...",
    "Writing changes...": "正在写入改动...",
    "Running verification...": "正在运行验证...",
    "Searching codebase...": "正在搜索代码库...",
    "Waiting for approval...": "等待审批...",
    "Waiting for approval": "等待审批",
    "Waiting for user input...": "等待用户输入...",
    "Waiting for user input": "等待用户输入",
    "Requires approval": "需要审批",
    "Stop generating": "停止生成",
    "Stop execution": "停止执行",
    "Stop agent": "停止智能体",
    "Ask anything, @ to mention, / for workflows": "输入任何问题，输入 @ 提及，输入 / 调用工作流",
    "Type a message or press / for workflows": "输入消息或按 / 调用工作流",
    "Ask a question or describe a task...": "提出问题或描述任务...",

    // === 2.18.1 补全：设置中心、权限沙箱与模型参数 ===
    "Terminal auto-execution policy": "终端自动执行策略",
    "Background terminal execution": "后台终端执行",
    "Terminal Execution": "终端执行",
    "Terminal command execution": "终端命令执行",
    "Command auto-execution": "命令自动执行",
    "Always deny": "始终拒绝",
    "Auto-approve": "自动批准",
    "Auto approve": "自动批准",
    "Require approval": "需要审批",
    "Allow background tasks": "允许后台任务",
    "Cancel task": "取消任务",
    "Kill task": "终止任务",
    "Task status": "任务状态",
    "Reasoning": "推理",
    "Thinking budget": "思考预算",
    "Models": "模型",
    "Temperature": "温度参数",
    "Context window": "上下文窗口",
    "Max output tokens": "最大输出 Token",
    "System instructions": "系统指令",
    "Custom instructions": "自定义指令",
    "Active model": "当前活跃模型",
    "Available models": "可用模型列表",
    "Keybindings": "快捷键绑定",
    "Quick Open": "快速打开",
    "Installed Distros": "已安装发行版",
    "WSL Distros": "WSL 发行版",
    "Security": "安全",
    "Allow once": "允许一次",
    "Always allow in this project": "在此项目中始终允许",
    "Standard sandbox": "标准沙箱",
    "Full access": "完全访问",
    "Read-only access": "只读访问",
    "Workspace only": "仅工作区",
    "Allow network access": "允许网络访问",
    "Allow file system modifications": "允许修改文件系统",
    "Add MCP Server": "添加 MCP 服务器",
    "Restart MCP Server": "重启 MCP 服务器",
    "Reload customizations": "重新加载自定义项",
    "Google Cloud Project": "Google Cloud 项目",
    "Select a Google Cloud Project": "选择 Google Cloud 项目",
    "No Google Cloud project selected": "未选择 Google Cloud 项目",
    "Switch Account": "切换账号",
    "Enterprise License": "企业许可证",
    "Personal License": "个人许可证",
    "Free tier": "免费层级",
    "Pro tier": "专业版层级",
    "Enterprise tier": "企业版层级",
    "Quota exceeded": "配额超限",
    "Rate limit exceeded": "速率限制超限",

    // === 2.18.1 补全：斜杠指令描述长句 ===
    "Run an autonomous, goal-driven agent loop until task completion": "自主目标驱动的智能体循环，直至彻底完成任务",
    "Schedule recurring workflows or set delayed reminders": "调度周期性工作流或设定延时提醒",
    "Generate a detailed step-by-step implementation plan": "生成详尽的分步实施计划",
    "Interactive interview to clarify and align requirements": "通过互动访谈厘清需求与设计决策",
    "Coordinate multiple autonomous subagents": "多子智能体并行协作预览模式",
    "Save corrected workflows and habits to long-term memory": "将纠正后的工作流与习惯沉淀至长期记忆",
    "Deep thinking and multi-perspective verification mode": "深度思考与多重视角交叉验证增强模式",

    // === 2.21.0 深度补全：官方底座新特性、模型状态、操作卡片与设置中心全量词条 ===
    // 1. 设置中心新版体验与 Token 明细
    "Choose the experience that fits how you work.": "选择适合您工作方式的操作体验。",
    "Choose the experience that fits how you work": "选择适合您工作方式的操作体验",
    "Choose between the Default and Project 4K experience.": "在默认体验与 4K 项目体验之间切换。",
    "Choose between the Default and Project 4K experience": "在默认体验与 4K 项目体验之间切换",
    "Project 4K": "项目 4K",
    "The breakdown below shows token usage from customizations like rules, skills, and MCP. If a budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.": "下方明细展示了来自规则、技能和 MCP 等自定义项的 Token 用量。如果超出额度，大型规则将自动降级为路径指针，大型自定义项将被自动排除。",
    "The breakdown below shows token usage from customizations like rules, skills, and MCP.": "下方明细展示了来自规则、技能和 MCP 等自定义项的 Token 用量。",
    "If a budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.": "如果超出额度，大型规则将自动降级为路径指针，大型自定义项将被自动排除。",
    "Other Customizations": "其他自定义项",
    "Show 1 breakdown": "显示 1 项明细",
    "Show 2 breakdowns": "显示 2 项明细",
    "Show 5 breakdowns": "显示 5 项明细",
    "Hide breakdown": "隐藏明细",
    "Hide breakdowns": "隐藏明细",
    "File Reads": "文件读取",
    "File Writes": "文件写入",
    "file reads": "文件读取",
    "file writes": "文件写入",
    "Reads": "读取",
    "Writes": "写入",
    "Contrast": "对比度",
    "Strong": "强烈",
    "Strong contrast": "高对比度",
    "Creating Cloud Project": "正在创建云项目",
    "Creating Chat Bot": "正在创建聊天机器人",
    "Installing Chat Bot": "正在安装聊天机器人",
    "Creating Sidecar": "正在创建 Sidecar",
    "Setup may take over 5 minutes. Please keep this screen open during setup.": "配置可能需要 5 分钟以上。配置期间请保持此界面打开。",
    "Legal Help": "法律帮助",
    "to ask for content changes for legal reasons.": "出于法律原因申请内容变更。",
    "Permanently delete": "永久删除",
    "Permanently delete this project and all of its conversations.": "永久删除当前项目及其所有历史对话。",
    "Refreshing...": "正在刷新...",
    "Refreshing": "正在刷新",
    "App Version": "应用版本",
    "Bug Report": "Bug 报告",
    "Remote Control Issue": "远程控制问题反馈",
    "Attach Antigravity server logs": "附带 Antigravity 服务器日志",

    // 2. 主聊天交互与按钮
    "Project options": "项目选项",
    "Agent response": "智能体回复",
    "Undo to this point": "撤销至此处",
    "Explored files, ran commands": "已探索文件，已执行命令",
    "Exploring file, running commands, editing artifact": "正在探索文件、运行命令、编辑工件",
    "Exploring file, running commands, editing artifacts": "正在探索文件、运行命令、编辑工件",
    "Drag to select a region to comment": "拖动以选取区域进行评论",
    "Select a region to comment": "选取区域以进行评论",
    "Copy markdown": "复制 Markdown",
    "Copy code": "复制代码",
    "Copy raw text": "复制纯文本",

    // 3. 模型状态与官方插件
    "View Usage": "查看使用额度",
    "View usage": "查看使用额度",
    "view usage": "查看使用额度",
    "Leaving Soon": "即将下线",
    "leaving soon": "即将下线",
    "Notice": "重要提示",
    "High": "高",
    "Medium": "中",
    "Low": "低",
    "Thinking": "深度思考",
    "Build applications with the Gemini Interactions API and Live API, including text, image, video, and speech generation, managed agents, and real-time multimodal streaming.": "借助 Gemini Interactions API 与 Live API 构建应用程序，涵盖文本、图像、视频与语音生成，托管智能体以及实时多模态流式交互。",
    "Build applications with the Gemini Interactions API and Live API": "借助 Gemini Interactions API 与 Live API 构建应用程序",
    "Download": "下载",
    "Gemini 3.8 Flash High": "Gemini 3.8 Flash (高)",
    "Gemini 3.7 Flash Medium": "Gemini 3.7 Flash (中)",
    "Gemini 3.6 Flash Low": "Gemini 3.6 Flash (低)",
    "Gemini 3.1 Pro Low": "Gemini 3.1 Pro (低)",
    "Claude Sonnet 4.6 (Thinking)": "Claude Sonnet 4.6 (深度思考)",
    "Claude Opus 4.6 (Thinking)": "Claude Opus 4.6 (深度思考)",
    "GPT-OSS 120B (Medium)": "GPT-OSS 120B (中)",

    // 4. 原生上下文菜单新增
    "Duplicate": "创建副本",
    "Archive": "归档",
    "Share": "分享",
    "Copy Link": "复制链接",
    "Export": "导出",
    "Export Conversation": "导出对话",
    "Clear History": "清除历史",
    "Message input": "消息输入框",
    "This plugin provides a specialized suite of skills for data engineers and database practitioners working on Google Cloud. It acts as an expert assistant, allowing you to use natural language prompts in your preferred coding agent to architect complex data pipelines, transform data with dbt, write Spark and BigQuery SQL notebooks, and orchestrate end-to-end workflows across GCP's data ecosystem.": "此插件为在 Google Cloud 上工作的数据工程师和数据库从业人员提供了专业技能套件。它充当专家助手，让您可以在首选的编码智能体中使用自然语言提示来构建复杂的数据管道、使用 dbt 转换数据、编写 Spark 和 BigQuery SQL 笔记本，并在 GCP 的数据生态系统中编排端到端工作流。",
    "This skill helps the agent generate or update orchestration pipeline definitions for Google Cloud Composer to initialize orchestration pipeline or update the orchestration definition for orchestration of various data pipelines, like dbt pipelines, notebooks, Spark jobs, Dataform, Python scripts or inline BigQuery SQL queries. This skill also helps deploy and trigger orchestration pipelines.": "此技能可帮助智能体为 Google Cloud Composer 生成或更新编排管道定义，以初始化编排管道或更新各种数据管道（如 dbt 管道、笔记本、Spark 作业、Dataform、Python 脚本或内联 BigQuery SQL 查询）的编排定义。此技能还有助于部署和触发编排管道。",

    // 5. 侧边栏与系统导航：Automations (自动化)
    "Automations": "自动化",
    "automations": "自动化",
    "Automation": "自动化",
    "automation": "自动化",
    "New Automation": "新建自动化",
    "new automation": "新建自动化",
    "Create Automation": "创建自动化",
    "create automation": "创建自动化",
    "Scheduled Automations": "定时自动化",
    "scheduled automations": "定时自动化",
    "Background Automations": "后台自动化",
    "background automations": "后台自动化",
    "Active Automations": "活跃自动化",
    "active automations": "活跃自动化",
    "Automation Settings": "自动化设置",
    "automation settings": "自动化设置",
    "Automations Settings": "自动化设置",
    "automations settings": "自动化设置",
    "No automations": "暂无自动化任务",
    "no automations": "暂无自动化任务",
    "No automations found": "未找到自动化任务",
    "no automations found": "未找到自动化任务",
    "Run Automation": "运行自动化",
    "Trigger Automation": "触发自动化",
    "Manage Automations": "管理自动化",

    // 6. 自定义配置（Customizations）扩展市场与管理
    "Installed": "已安装",
    "installed": "已安装",
    "Marketplace": "扩展市场",
    "marketplace": "扩展市场",
    "Browse the Marketplace": "浏览扩展市场",
    "browse the marketplace": "浏览扩展市场",
    "Find skills, agents, and more in the Marketplace.": "在扩展市场中查找技能、智能体等。",
    "Search customizations...": "搜索自定义项...",
    "Search customizations": "搜索自定义项",
    "search customizations": "搜索自定义项",
    "Skills & Rules": "技能与规则",
    "skills & rules": "技能与规则",
    "Built In": "内置",
    "built in": "内置",
    "Built-in": "内置",
    "See less": "收起",
    "see less": "收起",
    "Custom Agents": "自定义智能体",
    "custom agents": "自定义智能体",
    "Loading plugin...": "正在加载插件...",
    "Loading plugin": "正在加载插件",
    "This is a preview of the plugin's source. Nothing below is active until you install it.": "这是此插件源码的预览。在您安装之前，以下内容均未激活生效。",

    // 官方插件生态与详情
    "Connect to Google Workspace, including Docs, Sheets, Slides, Drive, and Calendar.": "连接至 Google Workspace，涵盖 Docs、Sheets、Slides、Drive 与 Calendar。",
    "Google Docs": "Google 文档",
    "Read, draft, and edit docs.": "阅读、起草和编辑文档。",
    "Read and write your Google Docs. Summarize any doc from its link, draft proposals and announcements in a new doc, and reply to and resolve open comments.": "阅读与编辑您的 Google 文档。通过链接总结任意文档内容，在新文档中起草提案与公告，并回复与解决未结评论。",
    "Read, create, edit, and manage Google Docs. Use when the user shares a docs.google.com URL, asks to summarize or extract content from a doc, wants a doc drafted, edited, formatted, or commented on, wants tables, images, or smart chips inserted, wants markdown imported or synchronized with a doc, or wants a doc exported. Requires a known document ID — use the gdrive skill to search for or locate documents. Don't use for Google Sheets, Slides, or Drive file management.": "读取、创建、编辑与管理 Google 文档。当用户分享 docs.google.com 链接、要求总结或提取文档内容、起草或修改文档排版评论、插入表格与图像智能芯片、导入导出 Markdown 时使用。",

    "Google Sheets": "Google 表格",
    "Read, write, and format spreadsheets.": "读取、编写和格式化电子表格。",
    "Read, create, edit, and manage Google Sheets spreadsheets. Use when the user shares a sheets.google.com URL, asks to summarize, inspect, or analyze spreadsheet data, wants sheets drafted, edited, formatted, cleared, or deleted, wants rows/columns inserted, appended, deleted, or sorted, wants cells updated, formulas added, charts created, or formatting applied, or wants CSV/tsv imported or synchronized with a sheet. Requires a known spreadsheet ID — use the gdrive skill to search for or locate spreadsheets. Don't use for Google Docs, Slides, or Drive file management.": "读取、创建、编辑与管理 Google 表格。当用户分享 sheets.google.com 链接、要求汇总分析表格数据、增删修改行列单元格、添加公式图表时使用。",

    "Google Slides": "Google 幻灯片",
    "Read, edit, and export presentations.": "阅读、编辑和导出演示文稿。",

    "Google Drive": "Google 云端硬盘",
    "Search, upload, download, and share files.": "搜索、上传、下载和共享文件。",

    "Google Calendar": "Google 日历",
    "Check availability, schedule events, and RSVP.": "查看空闲时间、安排活动日程并回复邀请。",

    "Build with Google": "使用 Google 构建",
    "Build on Google's developer platforms, including Android, Chrome, Gemini, and Google Cloud.": "基于 Google 开发者平台进行构建，涵盖 Android、Chrome、Gemini 与 Google Cloud。",

    "Google Maps Platform": "Google Maps 平台",
    "Integration skill and tools for Google Maps Platform APIs": "用于 Google Maps Platform API 的集成技能与工具套件",

    "Dart 与 Flutter": "Dart 与 Flutter",
    "Official plugin for Dart and Flutter that installs Flutter/Dart Skills, Rules, Custom Agents, and Dart MCP server for building natively compiled, visually stunning applications for mobile, web, desktop, and embedded devices from a single codebase": "Dart 与 Flutter 官方插件，提供 Flutter/Dart 技能、规则、自定义智能体与 Dart MCP 服务器，支持从单一代码库构建适用于移动端、Web、桌面及嵌入式设备的原生编译精美应用。",

    "Firebase": "Firebase",
    "Prototype, build & run modern apps that users love with Firebase's backend, AI, and operational infrastructure.": "借助 Firebase 的后端、AI 和运维基础设施，原型设计、构建并运行深受用户喜爱的现代化应用程序。",

    "Curated collection of agent skills for science tasks.": "精选的面向科学计算与科研任务的智能体技能套件。",
    "Google Antigravity SDK": "Google Antigravity SDK",
    "Using the Google Antigravity Python SDK to build AI agents": "使用 Google Antigravity Python SDK 构建 AI 智能体",

    // 内置技能说明
    "Interactive guide to design and create a scheduled background automation. Use this skill when the user wants to create an automated or recurring scheduled task (e.g. \\\"summarize my emails every morning\\\", \\\"every Monday send me a to-do list\\\"). Also triggered by the /automation slash command.": "设计与创建后台定时自动化的交互式指南。当用户需要创建定时或循环调度任务时使用（例如“每天早上总结我的邮件”、“每周一发送待办清单”）。亦可通过 /automation 斜杠命令触发。",
    "How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit. Use this skill when the user wants to enable, disable, install or uninstall a plugin, when they want to create a new plugin, or when a new customization should be packaged into a plugin rather than left loose. Also triggered by the /plugin slash command. Don't use for the underlying customization system itself — discovery roots, loading priority, or authoring a standalone skill, agent, rule, hook or MCP server outside a plugin; see the customizations guide skill for those.": "管理与创建插件的指南——插件是将技能、智能体、规则、MCP 服务器和钩子整合成具有独立命名空间的套件包，支持作为独立单元进行安装、启用与禁用。当用户需要管理插件、创建新插件或将扩展组件打包封装时使用。亦可通过 /plugin 斜杠命令触发。",
    "Build, package, run, and debug UI extensions for Antigravity: interactive web panels that render in the side pane, served by a Node.js sidecar using the built-in Sidecar SDK.": "构建、打包、运行与调试 Antigravity UI 扩展：在侧边窗格中渲染的交互式 Web 面板，由基于内置 Sidecar SDK 的 Node.js sidecar 提供服务。",
    "Discover UI plugin panels relevant to the current task and surface a one-click pill in chat to open (toggle) them in the side pane. Use when a running UI plugin's panel would help with what the user is doing, or right after the user enables a new UI plugin pane and a shortcut to open it is handy.": "发现与当前任务相关的 UI 插件面板，并在对话中提供一键展开胶囊按钮，以便在侧边窗格中快速切换显示。",
    "Guidelines for interacting with GitHub, prompting the user for approval when commands fail due to agent environment restrictions.": "与 GitHub 交互的操作准则，当命令因智能体环境限制执行失败时向用户申请授权。",

    // 7. 显示选项与会话列表视图配置 (Display Options)
    "Sort Conversations": "对话排序",
    "sort conversations": "对话排序",
    "Sort conversations": "对话排序",
    "Last Prompt": "最新提示词",
    "last prompt": "最新提示词",
    "Last prompt": "最新提示词",
    "Archived Only": "仅已归档",
    "archived only": "仅已归档",
    "Archived only": "仅已归档",
    "Active Only": "仅活跃",
    "active only": "仅活跃",
    "Pinned Only": "仅置顶",
    "pinned only": "仅置顶",
    "Unarchived Only": "仅未归档",
    "unarchived only": "仅未归档",
    "Last 7 days": "最近 7 天",
    "Last 7 Days": "最近 7 天",
    "last 7 days": "最近 7 天",
    "Last 24 hours": "最近 24 小时",
    "Last 24 Hours": "最近 24 小时",
    "last 24 hours": "最近 24 小时",
    "Last 30 days": "最近 30 天",
    "Last 30 Days": "最近 30 天",
    "last 30 days": "最近 30 天",
    "Last week": "最近一周",
    "last week": "最近一周",
    "Last month": "最近一个月",
    "last month": "最近一个月",
    "All time": "全部时间",
    "all time": "全部时间",
    "All Time": "全部时间",
    "Display": "显示",
    "display": "显示",

    // 8. 智能体执行标签与工具组聚合状态 (Agent Execution Labels & Tool Groups)
    "Run": "运行",
    "run": "运行",
    "Running": "正在运行",
    "running": "正在运行",
    "Ran": "已运行",
    "ran": "已运行",
    "Working": "正在工作",
    "working": "正在工作",
    "Working...": "正在工作...",
    "Done": "已完成",
    "done": "已完成",
    "Done.": "已完成。",
    "Errored": "已出错",
    "errored": "已出错",
    "Rejected": "已拒绝",
    "rejected": "已拒绝",
    "Waiting": "等待中",
    "waiting": "等待中",
    "Sent": "已发送",
    "sent": "已发送",
    "Sending": "正在发送",
    "sending": "正在发送",
    "Analyzed": "已分析",
    "analyzed": "已分析",
    "Analyzing": "正在分析",
    "analyzing": "正在分析",
    "Explored": "已探索",
    "explored": "已探索",
    "Exploring": "正在探索",
    "exploring": "正在探索",
    "Edited": "已编辑",
    "edited": "已编辑",
    "Editing": "正在编辑",
    "editing": "正在编辑",
    "Created": "已创建",
    "created": "已创建",
    "Creating": "正在创建",
    "creating": "正在创建",
    "Deleted": "已删除",
    "deleted": "已删除",
    "Deleting": "正在删除",
    "deleting": "正在删除",
    "Searched": "已搜索",
    "searched": "已搜索",
    "Searching": "正在搜索",
    "searching": "正在搜索",
    "Viewed": "已查看",
    "viewed": "已查看",
    "Viewing": "正在查看",
    "viewing": "正在查看",

    // 工具组与单复数完整短语
    "Ran command": "已运行命令",
    "ran command": "已运行命令",
    "Ran commands": "已运行命令",
    "ran commands": "已运行命令",
    "Running command": "正在运行命令",
    "running command": "正在运行命令",
    "Running commands": "正在运行命令",
    "running commands": "正在运行命令",
    "Run command": "运行命令",
    "run command": "运行命令",
    "Run commands": "运行命令",
    "run commands": "运行命令",
    "Ran 命令": "已运行命令",
    "Running 命令": "正在运行命令",
    "Explored files": "已探索文件",
    "explored files": "已探索文件",
    "Exploring files": "正在探索文件",
    "exploring files": "正在探索文件",
    "Explored file": "已探索文件",
    "explored file": "已探索文件",
    "Exploring file": "正在探索文件",
    "exploring file": "正在探索文件",
    "Edited files": "已编辑文件",
    "edited files": "已编辑文件",
    "Editing files": "正在编辑文件",
    "editing files": "正在编辑文件",
    "Edited file": "已编辑文件",
    "edited file": "已编辑文件",
    "Editing file": "正在编辑文件",
    "editing file": "正在编辑文件",
    "Edited artifact": "已编辑工件",
    "edited artifact": "已编辑工件",
    "Edited artifacts": "已编辑工件",
    "edited artifacts": "已编辑工件",
    "Editing artifact": "正在编辑工件",
    "editing artifact": "正在编辑工件",
    "Editing artifacts": "正在编辑工件",
    "editing artifacts": "正在编辑工件",

    // 复合动词组合短语 (全量收录 pqb 输出的所有组合)
    "Explored files, ran commands, edited files": "已探索文件、已执行命令、已编辑文件",
    "Explored files, ran commands, edited artifact": "已探索文件、已执行命令、已编辑工件",
    "Explored files, ran commands, edited artifacts": "已探索文件、已执行命令、已编辑工件",
    "Explored files, ran commands": "已探索文件、已执行命令",
    "Explored files, edited files": "已探索文件、已编辑文件",
    "Explored files, edited artifact": "已探索文件、已编辑工件",
    "Explored files, edited artifacts": "已探索文件、已编辑工件",
    "Ran commands, edited files": "已执行命令、已编辑文件",
    "Ran commands, edited artifact": "已执行命令、已编辑工件",
    "Ran commands, edited artifacts": "已执行命令、已编辑工件",
    "Exploring files, running commands, editing files": "正在探索文件、运行命令、编辑文件",
    "Exploring files, running commands, editing artifact": "正在探索文件、运行命令、编辑工件",
    "Exploring files, running commands, editing artifacts": "正在探索文件、运行命令、编辑工件",
    "Exploring files, running commands": "正在探索文件、运行命令",
    "Exploring files, editing files": "正在探索文件、编辑文件",
    "Exploring files, editing artifact": "正在探索文件、编辑工件",
    "Exploring files, editing artifacts": "正在探索文件、编辑工件",
    "Running commands, editing files": "正在运行命令、编辑文件",
    "Running commands, editing artifact": "正在运行命令、编辑工件",
    "Running commands, editing artifacts": "正在运行命令、编辑工件",

    // 步骤行具体动作前缀与通知状态
    "Checking command status": "正在检查命令状态",
    "Checked command status": "已检查命令状态",
    "Analyzing Task Log": "正在分析任务日志",
    "Analyzed Task Log": "已分析任务日志",
    "Analyzing content": "正在分析内容",
    "Analyzed content": "已分析内容",
    "Unknown file edit": "未知文件编辑",
    "termination request": "终止请求",
    "User cancelled agent execution.": "用户已取消智能体执行。",
    "User cancelled agent execution": "用户已取消智能体执行",
    "Agent execution failed.": "智能体执行失败。",
    "Agent execution failed": "智能体执行失败",
    "The agent has encountered an internal error.": "智能体遇到了内部错误。",
    "Used MCP tool": "调用 MCP 工具",
    "Used tool": "调用工具",
    "Generated image": "已生成图像",
    "Browser task": "浏览器任务",
    "Opened browser": "已打开浏览器",
    "Read URL": "读取 URL",
    "Searched web": "网页搜索",
    "Invoked subagent": "调用子智能体",
    "Git commit": "Git 提交",
    "Searched for files": "搜索文件",
    "Searched files": "已搜索文件",
    "Code search": "代码搜索",
    "Internal search": "内部搜索",

    // ===== 2.26.0 界面文案补充（依据 Web UI bundle 全量比对 + 运行时 DOM 抓取）=====
    // 环境 / 选择器
    "Select Environment": "选择环境",
    "Local": "本地",
    "Toggle Environment Selector": "切换环境选择器",
    "Toggle Project Selector": "切换项目选择器",
    "Select Billing Model": "选择计费模型",
    "Select Default Branch": "选择默认分支",
    "Select All": "全选",
    "Select Agent": "选择智能体",
    "Select Project": "选择项目",
    "Select Resource(s)": "选择资源",
    "Select Theme": "选择主题",
    "Select Workspace": "选择工作区",
    "Select Worktree": "选择工作树",
    "Select Folder(s)": "选择文件夹",
    "Select category to search...": "选择要搜索的分类...",
    "Select a model in the model selector": "在模型选择器中选择模型",
    "Select a model to send message": "选择要发送消息的模型",
    "Select workspace to send message": "选择要发送消息的工作区",
    "Select your license": "选择你的许可证",
    "Select an option": "选择一个选项",
    "Choose Region": "选择区域",
    "Choose a License": "选择许可证",
    "Open Agent on Reload": "窗口重载时打开智能体面板",
    "Open the agent panel on window reload": "窗口重载时打开智能体面板",
    "Open Browser Setup": "打开浏览器设置",
    "Open Command Palette": "打开命令面板",
    "Open Commit Graph": "打开提交图",
    "Open Conversation": "打开对话",
    "Open Conversation History": "打开对话历史",
    "Open File": "打开文件",
    "Open Keyboard Shortcuts": "打开键盘快捷键",
    "Open Preferences": "打开首选项",
    "Open Preview": "打开预览",
    "Open Project Picker": "打开项目选择器",
    "Open Search": "打开搜索",
    "Open Tabs": "打开标签页列表",
    "Open Terminal": "打开终端",
    "Open Workspace Selector": "打开工作区选择器",
    "Open in Browser": "在浏览器中打开",
    "Open in Built-in Browser": "在内置浏览器中打开",
    "Open in External Browser": "在外部浏览器中打开",
    "Open in New Tab": "在新标签页中打开",
    "Open in New Window": "在新窗口中打开",
    "Open in Preview": "在预览中打开",
    "Open in Preview Tab": "在预览标签页中打开",
    "Open in Side Pane": "在侧边窗格中打开",
    "Open in Tab": "在标签页中打开",
    "Open in Notebook View": "在笔记本视图中打开",
    "Open in external browser": "在外部浏览器中打开",
    "Open in Critique": "在 Critique 中打开",
    "Open link": "打开链接",
    "Open plugin page": "打开插件页面",
    "Open project settings": "打开项目设置",
    "Open settings menu": "打开设置菜单",
    "Open skill page": "打开技能页面",
    "Open the change": "打开该更改",
    "Open the page in system browser": "在系统浏览器中打开该页面",
    "Open search in external browser": "在外部浏览器中搜索",
    "Open System Browser": "打开系统浏览器",
    "Open System Preferences": "打开系统偏好设置",
    "Open Launchpad": "打开 Launchpad",
    "Open Hub": "打开 Hub",
    "View Debug": "查看调试",
    "View Diff": "查看差异",
    "View File": "查看文件",
    "View Logs": "查看日志",
    "View Page": "查看页面",
    "View comments": "查看评论",
    "View network request": "查看网络请求",
    "View network requests": "查看网络请求",
    "View or edit comment": "查看或编辑评论",
    "View archived in the sidebar": "在侧边栏中查看已归档",
    "View full search results": "查看完整搜索结果",
    "Toggle Editor": "切换编辑器",
    "Toggle File Viewer": "切换文件查看器",
    "Toggle Overview Panel": "切换概览面板",
    "Toggle Status Bar": "切换状态栏",
    "Toggle Thumbnails": "切换缩略图",
    "Toggle Sidebar, conversations need attention": "切换侧边栏（有对话需要关注）",
    "Show All": "显示全部",
    "Show details": "显示详情",
    "Show or Hide Plugins": "显示或隐藏插件",
    "Show suggestions when typing in the editor": "在编辑器中输入时显示建议",
    "Show temporary and forked workspaces": "显示临时及派生工作区",
    "Show token": "显示令牌",
    "Hide token": "隐藏令牌",
    "Hide Thumbnail Sidebar": "隐藏缩略图侧边栏",
    "Show Thumbnail Sidebar": "显示缩略图侧边栏",
    "Show all resources": "显示全部资源",
    "Show fewer resources": "显示更少资源",
    "Show more results on Agent Market": "在智能体市场显示更多结果",
    "Show settings anyway": "仍然显示设置",
    "Close Sidebar": "关闭侧边栏",
    "Close panel": "关闭面板",
    "Close skills panel": "关闭技能面板",
    "Close Logs Modal": "关闭日志弹窗",
    "Close Other Tabs": "关闭其他标签页",
    "Close Settings": "关闭设置",
    "Close Tab": "关闭标签页",
    "Close Tabs to the Right": "关闭右侧标签页",
    "Close Terminal Tab": "关闭终端标签页",
    "Pin Tab": "固定标签页",
    "Unpin Tab": "取消固定标签页",
    "Tab to Jump": "Tab 键跳转",
    "Tab to Import": "Tab 键导入",
    "Next Page": "下一页",
    "Previous Page": "上一页",
    "Next match": "下一个匹配",
    "Previous match": "上一个匹配",
    "Next question": "下一个问题",
    "Previous question": "上一个问题",
    "Next side question": "下一个侧边问题",
    "Previous side question": "上一个侧边问题",
    "Next Aux Pane Tab": "下一个辅助窗格标签",
    "Previous Aux Pane Tab": "上一个辅助窗格标签",
    "Next toast": "下一个通知",
    "Previous toast": "上一个通知",
    "Collapse Diffs": "折叠差异",
    "Expand Diffs": "展开差异",
    "Collapse queued messages": "折叠排队消息",
    "Expand queued messages": "展开排队消息",
    "Collapse subagents": "折叠子智能体",
    "Expand subagents": "展开子智能体",
    "Collapse idle": "折叠空闲项",
    "Collapse string": "折叠字符串",
    "Expand long string": "展开长字符串",
    "Collapse toast": "折叠通知",
    "Add All": "全部添加",
    "Add Custom Model": "添加自定义模型",
    "Add Model": "添加模型",
    "Add Workspace": "添加工作区",
    "Add Terminal": "添加终端",
    "Add Folder": "添加文件夹",
    "Add Resource": "添加资源",
    "Add Handler": "添加处理器",
    "Add Hook Card": "添加钩子卡片",
    "Add to Chat": "添加到对话",
    "Add to allowlist": "添加到允许列表",
    "Create New": "新建",
    "Create a Project": "创建项目",
    "Create project from scratch": "从零开始创建项目",
    "Create a Plugin with the Agent": "借助智能体创建插件",
    "Create with Prompt": "使用提示词创建",
    "Remove All": "全部移除",
    "Remove audio": "移除音频",
    "Remove policy": "移除策略",
    "Remove resource": "移除资源",
    "Delete Task": "删除任务",
    "Delete Terminal": "删除终端",
    "Delete agent": "删除智能体",
    "Delete plugin": "删除插件",
    "Delete workspace": "删除工作区",
    "Delete Handler": "删除处理器",
    "Delete Hook": "删除钩子",
    "Delete comment": "删除评论",
    "Delete Data Directory": "删除数据目录",
    "Delete Permanently": "永久删除",
    "Delete organization policy": "删除组织策略",
    "Delete repository policy": "删除仓库策略",
    "Rename Conversation": "重命名对话",
    "Edit Conversation Title": "编辑对话标题",
    "Restore Conversation": "恢复对话",
    "Archive This Conversation": "归档此对话",
    "Conversation Archived": "对话已归档",
    "Conversation unavailable": "对话不可用",
    "Conversation turns": "对话轮次",
    "Conversation navigator off": "对话导航器已关闭",
    "Conversation copied as Markdown to clipboard": "对话已以 Markdown 复制到剪贴板",
    "Move Down": "下移",
    "Move Up": "上移",
    "Move to New Group": "移到新分组",
    "Group Actions": "分组操作",
    "Sort By": "排序方式",
    "Sort By Input Model": "按输入模型排序",
    "Sort Projects": "排序项目",
    "Sort Workspaces": "排序工作区",
    "Sort and filter conversations": "排序并筛选对话",
    "Review pending conversations": "审查待处理的对话",
    "Copy Message": "复制消息",
    "Copy as Markdown": "复制为 Markdown",
    "Copy output": "复制输出",
    "Copy response": "复制回复",
    "Copy value": "复制值",
    "Copy email address": "复制邮箱地址",
    "Copy sign-in link": "复制登录链接",
    "Link copied to clipboard.": "链接已复制到剪贴板。",
    "Paste code": "粘贴代码",
    "Paste code here": "在此粘贴代码",
    "Paste key": "粘贴密钥",
    "Paste auth code": "粘贴认证码",
    "Replace with": "替换为",
    "Search conversations...": "搜索对话...",
    "Search files...": "搜索文件...",
    "Search across files...": "跨文件搜索...",
    "Search projects...": "搜索项目...",
    "Search workspaces...": "搜索工作区...",
    "Search for commands...": "搜索命令...",
    "Search for conversations...": "搜索对话...",
    "Search for files in the project...": "在项目中搜索文件...",
    "Search for content to open": "搜索要打开的内容",
    "Search complete": "搜索完成",
    "Search failed": "搜索失败",
    "Search results": "搜索结果",
    "Find in Conversation": "在对话中查找",
    "Clear Search": "清除搜索",
    "Clear search": "清除搜索",
    "Clear filter": "清除筛选",
    "Clear all": "全部清除",
    "Filter resources...": "筛选资源...",
    "Loading apps...": "正在加载应用...",
    "Loading available plugins...": "正在加载可用插件...",
    "Loading custom agents...": "正在加载自定义智能体...",
    "Loading customizations...": "正在加载自定义项...",
    "Loading events...": "正在加载事件...",
    "Loading hooks...": "正在加载钩子...",
    "Loading installed plugins...": "正在加载已安装插件...",
    "Loading instances...": "正在加载实例...",
    "Loading licenses...": "正在加载许可证...",
    "Loading models...": "正在加载模型...",
    "Loading page": "正在加载页面",
    "Loading resources...": "正在加载资源...",
    "Loading skills...": "正在加载技能...",
    "Loading subagent...": "正在加载子智能体...",
    "Loading token usage...": "正在加载令牌用量...",
    "Loading trajectory...": "正在加载轨迹...",
    "Loading workspace customizations...": "正在加载工作区自定义项...",
    "Loading worktrees...": "正在加载工作树...",
    "Loading Notebook View...": "正在加载笔记本视图...",
    "Agent Auto-Fix Lints": "智能体自动修复 Lint",
    "Agent Edits": "智能体编辑",
    "Agent Team": "智能体团队",
    "Agent options": "智能体选项",
    "Agent Hooks Configuration": "智能体钩子配置",
    "Agent Security Settings": "智能体安全设置",
    "Agent security mode": "智能体安全模式",
    "Agent finished": "智能体已完成",
    "Agent stopped": "智能体已停止",
    "Agent encountered an internal error.": "智能体遇到内部错误。",
    "Agent terminated due to error": "智能体因错误而终止",
    "Agent data is not available": "智能体数据不可用",
    "Accept Step": "接受步骤",
    "Reject Step": "拒绝步骤",
    "Cancel Step": "取消步骤",
    "Cancel step": "取消步骤",
    "Cancel All Tasks": "取消所有任务",
    "Cancel Generation": "取消生成",
    "Cancel recording": "取消录音",
    "Cancel Sending Message": "取消发送消息",
    "Stop All Subagents": "停止所有子智能体",
    "Stop Subagent": "停止子智能体",
    "Stop subagent": "停止子智能体",
    "Stop Task": "停止任务",
    "Stop Voice Recording": "停止语音录制",
    "Stop recording": "停止录音",
    "Task Log": "任务日志",
    "Task Logs": "任务日志",
    "Task not found": "未找到任务",
    "Continue Response": "继续回复",
    "Explain and Fix": "解释并修复",
    "Debug and fix": "调试并修复",
    "Help me understand the current context.": "帮我理解当前上下文。",
    "Run Now": "立即运行",
    "Send Now": "立即发送",
    "Stop Recording and Send": "停止录音并发送",
    "Mute mic": "静音麦克风",
    "Unmute mic": "取消静音麦克风",
    "Project Settings": "项目设置",
    "Project Folders": "项目文件夹",
    "Project Agent": "项目智能体",
    "Project not found": "未找到项目",
    "Project already exists": "项目已存在",
    "Project management is not available": "项目管理不可用",
    "Workspace Settings": "工作区设置",
    "Workspace Creation": "创建工作区",
    "Workspace File Access": "工作区文件访问",
    "Workspace Web Access": "工作区网络访问",
    "Workspace Command Access": "工作区命令访问",
    "Workspace File Explorer": "工作区文件浏览器",
    "Workspace name cannot be empty": "工作区名称不能为空",
    "Workspace setup warning": "工作区设置警告",
    "Workspace mismatch actions": "工作区不匹配操作",
    "Workspace folder suggestions": "工作区文件夹建议",
    "Fork in Current Workspace": "在当前工作区中派生",
    "Fork in New Workspace": "在新工作区中派生",
    "Fork in Shared Workspace": "在共享工作区中派生",
    "Fork conversation in this folder": "在此文件夹中派生对话",
    "Fork warning": "派生警告",
    "Archive Workspace": "归档工作区",
    "Archive project": "归档项目",
    "Allow List Terminal Commands": "终端命令允许列表",
    "Deny List Terminal Commands": "终端命令拒绝列表",
    "Advanced Command Access": "高级命令访问",
    "Advanced File Access": "高级文件访问",
    "Advanced Web Access": "高级网络访问",
    "Agent Non-Workspace File Access": "智能体非工作区文件访问",
    "Run terminal commands with sandbox restrictions.": "在沙盒限制下运行终端命令。",
    "Terminal commands the agent can execute.": "智能体可执行的终端命令。",
    "Review permissions": "审查权限",
    "Confirm Browser Interaction": "确认浏览器交互",
    "Manage Permissions": "管理权限",
    "Manage Hooks": "管理钩子",
    "Manage Skills": "管理技能",
    "Configure Branches": "配置分支",
    "Configure Worktree Branches": "配置工作树分支",
    "Configure GitHub access policies.": "配置 GitHub 访问策略。",
    "Review Policy": "审查策略",
    "Enable Notifications": "启用通知",
    "Enable Chat": "启用对话",
    "Enable Overages": "启用超额用量",
    "Enable Shell Integration": "启用 Shell 集成",
    "Enable Text Selection": "启用文本选择",
    "Disable Text Selection": "禁用文本选择",
    "Font Size": "字号",
    "Zoom Level": "缩放级别",
    "Tab Speed": "标签建议速度",
    "Debug Mode": "调试模式",
    "General Compactor": "常规压缩器",
    "General Punctuation": "常规标点",
    "General work": "常规工作",
    "Settings Unavailable": "设置不可用",
    "Reset Onboarding": "重置引导流程",
    "Reset to preset": "重置为预设",
    "Switch to Dark Mode": "切换到深色模式",
    "Switch to Light Mode": "切换到浅色模式",
    "Switch Roles": "切换角色",
    "Set the speed of tab suggestions": "设置标签建议速度",
    "Set Project Name": "设置项目名称",
    "Editor background color.": "编辑器背景色。",
    "Editor default foreground color.": "编辑器默认前景色。",
    "Input box background.": "输入框背景色。",
    "Input box border.": "输入框边框色。",
    "Input box foreground.": "输入框前景色。",
    "Input box foreground color for placeholder text.": "输入框占位文本前景色。",
    "Output view background color.": "输出视图背景色。",
    "Output view sticky scroll background color.": "输出视图粘性滚动背景色。",
    "Font size used for a label.": "标签使用的字号。",
    "Layout Hierarchy": "布局层级",
    "Layout Partition": "布局分区",
    "Layout Partitioning": "布局分区",
    "Debug view layout": "调试视图布局",
    "Apply layout results": "应用布局结果",
    "Find roots": "查找根目录",
    "Branch Changes": "分支更改",
    "Stage change": "暂存更改",
    "Stage and commit all changes": "暂存并提交所有更改",
    "Discard unstaged changes": "丢弃未暂存的更改",
    "Revert file changes": "还原文件更改",
    "Commit message cannot be empty": "提交信息不能为空",
    "Commit staged changes": "提交已暂存的更改",
    "Commit succeeded": "提交成功",
    "Push succeeded": "推送成功",
    "Pull requests": "拉取请求",
    "Pull request creation": "创建拉取请求",
    "Open a pull request": "打开拉取请求",
    "Open a merge request": "打开合并请求",
    "Merge Conflict": "合并冲突",
    "Undo to Here": "撤销到此处",
    "Run in a new worktree": "在新的工作树中运行",
    "Run in a new git worktree": "在新的 Git 工作树中运行",
    "Run in your current workspace": "在当前工作区中运行",
    "Download File": "下载文件",
    "Download image": "下载图片",
    "Download video": "下载视频",
    "Download Diagnostics": "下载诊断信息",
    "Upload Files": "上传文件",
    "Upload to Agent": "上传给智能体",
    "Upload to Google Drive": "上传到 Google 云端硬盘",
    "Upload Debug Bundle": "上传调试包",
    "Upload debug bundle": "上传调试包",
    "Show in File Explorer": "在文件资源管理器中显示",
    "Show in File Manager": "在文件管理器中显示",
    "Read Files": "读取文件",
    "Read files": "读取文件",
    "Read URLs": "读取网址",
    "Read page": "读取页面",
    "Read Browser Page in Browser": "在浏览器中读取页面",
    "Export Artifact": "导出构件",
    "Export artifact": "导出构件",
    "Install Update": "安装更新",
    "Update Anyway": "仍然更新",
    "Reload app": "重新加载应用",
    "Reload this window.": "重新加载此窗口。",
    "Restart Main Language Server": "重启主语言服务器",
    "Confirm Window Reload": "确认重载窗口",
    "Confirm Undo": "确认撤销",
    "Confirm Selection": "确认选择",
    "Back to": "返回到",
    "Back to home": "返回首页",
    "Generate Share Link": "生成分享链接",
    "Generate personalized rules": "生成个性化规则",
    "Mention Page": "提及页面",
    "Command Center": "命令中心",
    "Command Setup Script": "命令设置脚本",
    "Agent Market Search Results": "智能体市场搜索结果",
    "Connect your account to browse": "连接账号以浏览",
    "Continue with Google": "使用 Google 继续",
    "Continue with Google Cloud": "使用 Google Cloud 继续",
    "Continue with different account": "使用其他账号继续",
    "Sign in again": "重新登录",
    "Sign in with a different account": "使用其他账号登录",
    "Log back in": "重新登录",
    "Log in to use the agent": "登录以使用智能体",
    "Refresh Skills": "刷新技能",
    "Refresh skills": "刷新技能",
    "Refresh all credentials": "刷新所有凭据",
    "Refresh custom agents": "刷新自定义智能体",
    "Refresh customizations": "刷新自定义项",
    "Refresh skills paths": "刷新技能路径",
    "Write a comment...": "写评论...",
    "Write and edit docs": "编写和编辑文档",
    "Save Comment": "保存评论",
    "Edit Comment": "编辑评论",
    "Edit comment": "编辑评论",
    "Submit comment": "提交评论",
    "Submit Appeal": "提交申诉",
    "Pick at most 2 reasons": "最多选择 2 个原因",
    "Input required": "需要输入",
    "Model quota reached": "已达模型配额",
    "Model selector loading": "正在加载模型选择器",
    "Model Label": "模型标签",
    "Add not supported on this list": "此列表不支持添加",
    "Remove not supported on this list": "此列表不支持移除",
    "Set not supported on this list": "此列表不支持设置",
    "write access to this path": "对此路径的写入权限",
    "read access to this path": "对此路径的读取权限",
    "terminal auto execution policy value": "终端自动执行策略值",
    "lint error": "Lint 错误",
    // ===== 2.26.0 补充：作者漏翻 + React 片段化整句 =====
    "Models within this group": "本组内的模型",
    "Windows Subsystem for Linux": "适用于 Linux 的 Windows 子系统",
    "Run the app against a Linux environment. Connecting relaunches the app into the selected WSL distro.": "在 Linux 环境中运行应用。连接后会将应用重新启动到所选的 WSL 发行版。",

    // ===== 2.27.0 补充：浏览器工具与浏览器权限 =====
    "Browser Actuation Permissions": "浏览器操作权限",
    "Browser Configuration Required": "需要配置浏览器",
    "Browser Subagent Viewer": "浏览器子智能体查看器",
    "Browser User Profile Path": "浏览器用户配置目录",
    "Browser actions": "浏览器操作",
    "New Browser": "新建浏览器",
    "Enable Browser Tools": "启用浏览器工具",
    "Deny setting up browser": "拒绝配置浏览器",
    "Allow remote debugging for this browser instance": "允许对此浏览器实例进行远程调试",
    "Allow/deny agent browser actuation access to specific URLs.": "允许/禁止智能体对特定 URL 的浏览器操作访问。",
    "Allow/deny agent read access to specific URLs or domains.": "允许/禁止智能体对特定 URL 或域名的读取访问。",
    "Allow/deny agent command execution outside the sandbox.": "允许/禁止智能体在沙箱外执行命令。",
    "Allow/deny specific terminal commands.": "允许/禁止特定终端命令。",
    "Allow sandboxed commands to make network requests.": "允许沙箱内命令发起网络请求。",
    "Open Google Chrome on the machine running Antigravity.": "在运行 Antigravity 的机器上打开 Google Chrome。",
    "Open Link in External Browser": "在外部浏览器中打开链接",
    "Open with External Browser": "用外部浏览器打开",
    "Open in Hub": "在 Hub 中打开",
    "Open in Antigravity IDE": "在 Antigravity IDE 中打开",
    "Open Antigravity IDE": "打开 Antigravity IDE",
    "Open IDE": "打开 IDE",
    "The Agent attempted to interact with some sites that are not allowlisted": "智能体尝试与部分不在允许列表中的站点交互",
    "The agent was prevented from accessing some sites": "智能体被阻止访问部分站点",
    "Agent can retrieve console logs from the browser and return it for further processing.": "智能体可以获取浏览器控制台日志并返回以供进一步处理。",
    "Agent can scroll on browser pages to access more content.": "智能体可以滚动浏览器页面以访问更多内容。",
    "Browser tools are disabled in the Antigravity Android desktop app.": "在 Antigravity Android 桌面应用中，浏览器工具已禁用。",
    "Browser tools are not available in the Antigravity Android desktop app.": "在 Antigravity Android 桌面应用中，浏览器工具不可用。",
    "Replace the default browser right-click menu with quick actions.": "用快捷操作替换默认的浏览器右键菜单。",
    "Permissions granted by the host (camera, microphone, geolocation).": "由宿主机授予的权限（摄像头、麦克风、地理位置）。",
    "Add them to allow future interactions": "添加它们以允许后续交互",
    "Are you sure you want to delete": "确定要删除",
    "Are you sure you want to delete the": "确定要删除",

    // ===== 2.27.0 补充：远程工作区 (ABFS / CitC / Cog / Fig / JJ) =====
    "Create ABFS Workspace (Alpha)": "创建 ABFS 工作区（Alpha）",
    "Select ABFS Workspace (Alpha)": "选择 ABFS 工作区（Alpha）",
    "Create CitC Workspace": "创建 CitC 工作区",
    "Select CitC Workspace": "选择 CitC 工作区",
    "Select CitC workspace": "选择 CitC 工作区",
    "This is a CitC workspace (Fig share)": "这是一个 CitC 工作区（Fig 共享）",
    "Create a new project using normal folders and/or citc workspaces.": "使用普通文件夹和/或 CitC 工作区创建新项目。",
    "Your existing conversations in CitC are grouped under a": "你在 CitC 中的现有对话归类于",
    "Create Cog Workspace": "创建 Cog 工作区",
    "Select Cog Workspace": "选择 Cog 工作区",
    "Default Cog Branch / Ref": "默认 Cog 分支 / 引用",
    "Default Cog Repository": "默认 Cog 仓库",
    "Create a Fig shared workspace": "创建 Fig 共享工作区",
    "New Fig Share": "新建 Fig 共享",
    "New Fig Share?": "新建 Fig 共享？",
    "New Fig Workspace": "新建 Fig 工作区",
    "Run in a new jj workspace or Fig share": "在新的 jj 工作区或 Fig 共享中运行",
    "Start in a new Fig share (go/fig-shares)": "在新的 Fig 共享中开始",
    "Create a JJ worktree": "创建 JJ 工作树",
    "New Worktree": "新建工作树",
    "Previous Worktrees": "历史工作树",
    "Search past worktrees...": "搜索历史工作树...",
    "No previous worktrees": "没有历史工作树",
    "Workspace + Worktree": "工作区 + 工作树",
    "Project + Worktree": "项目 + 工作树",
    "New Remote Project": "新建远程项目",
    "Create a project whose conversations run remotely.": "创建对话在远程运行的项目。",
    "Create a new project from one or more folders.": "从一个或多个文件夹创建新项目。",
    "New Workspace (Do not use for PII/NTK data)": "新建工作区（请勿用于 PII/NTK 数据）",
    "Files and resources in cloud workspaces": "云工作区中的文件与资源",
    "Workspace URI Switcher": "工作区 URI 切换器",
    "Workspace URI not found": "未找到工作区 URI",
    "Workspace URI to switch to": "要切换至的工作区 URI",
    "Workspace URI query parameter": "工作区 URI 查询参数",
    "Select or enter a workspace URI": "选择或输入工作区 URI",
    "Workspace CL Status": "工作区 CL 状态",
    "Workspace name can only contain letters, numbers, underscores, and dashes": "工作区名称只能包含字母、数字、下划线和连字符",
    "No workspaces found": "未找到工作区",
    "No workspaces open.": "没有打开的工作区。",
    "Search Recent Workspaces": "搜索最近的工作区",
    "Search past workspaces...": "搜索历史工作区...",
    "Select Workspace...": "选择工作区...",
    "Select a workspace to save agent scripts to your workspace.": "选择工作区，以将智能体脚本保存到你的工作区。",
    "All Workspaces": "所有工作区",
    "This conversation is in a different workspace.": "此对话位于另一个工作区。",
    "This project is associated with a different workspace.": "此项目关联到另一个工作区。",
    "Your administrator has disabled MCP servers for this workspace.": "你的管理员已为此工作区禁用 MCP 服务器。",
    "No recommended skills found in workspace": "工作区中未找到推荐技能",
    "This skill is installed in your workspace": "此技能已安装到你的工作区",
    "Configure workspace-specific permissions, resources, and customizations.": "配置工作区专属的权限、资源和自定义项。",
    "No environments found": "未找到环境",
    "Environment not found": "未找到环境",
    "Environment Status": "环境状态",
    "Environment name should contain only text characters and spaces": "环境名称只能包含文字字符和空格",
    "No project selected": "未选择项目",
    "No projects created": "尚未创建项目",
    "No project selected or project management not available.": "未选择项目，或项目管理不可用。",
    "Search GoB repositories...": "搜索 GoB 仓库...",
    "Select or enter GoB repository...": "选择或输入 GoB 仓库...",
    "The branch was pushed to GitLab.": "分支已推送到 GitLab。",
    "The change was pushed to Gerrit.": "变更已推送到 Gerrit。",
    "The remote shared a link for this push.": "远程共享了此次推送的链接。",
    "No remote configured": "未配置远程仓库",
    "Not on a branch": "不在任何分支上",

    // ===== 2.27.0 补充：登录 / SSO / 账号 =====
    "Continue with SSO": "使用 SSO 继续",
    "Sign In with SSO": "使用 SSO 登录",
    "Sign in required": "需要登录",
    "Sign in required.": "需要登录。",
    "Sign-in required": "需要登录",
    "Not Signed In": "未登录",
    "No sign-in needed": "无需登录",
    "Log in": "登录",
    "Log in to Google Drive": "登录 Google Drive",
    "Set up authentication": "配置身份验证",
    "This sign-in option is only available to invited teams.": "此登录选项仅对受邀团队开放。",
    "Your session has expired. Please log back in to continue.": "你的会话已过期，请重新登录以继续。",
    "Use Business Account": "使用企业账户",
    "Sign out of this server?": "要从此服务器登出吗？",
    "You cannot sign out from Remote Control. Please sign out on your local application.": "你无法从远程控制登出，请在本地应用上登出。",
    "Show Remote Control QR code": "显示远程控制二维码",
    "Your credentials (gcert) are currently valid, but you can renew them if needed:": "你的凭证（gcert）当前有效，但如有需要可以续期：",
    "Refresh gcert Credentials": "刷新 gcert 凭证",
    "Your environment is active, but you can renew it if needed.": "你的环境已激活，但如有需要可以续期。",
    "Provide Google Cloud Project": "提供 Google Cloud 项目",
    "Your Antigravity use will be associated with provided project.": "你的 Antigravity 使用将关联到所提供的项目。",
    "Manage and delete your data anytime": "随时管理和删除你的数据",
    "Security Notice & Data Use": "安全声明与数据使用",
    "Manage your conversations from the companion website.": "在配套网站上管理你的对话。",
    "Account connected.": "账户已连接。",
    "Add account": "添加账户",
    "Go to Accounts": "前往账户",
    "Connected apps": "已连接的应用",
    "Connected Google Drive and GitHub resources": "已连接的 Google Drive 与 GitHub 资源",
    "No apps connected yet. Connect one from Marketplace.": "还没有连接任何应用，请从应用市场连接。",
    "No apps available.": "没有可用的应用。",
    "Select Google Drive files or folders": "选择 Google Drive 文件或文件夹",
    "Manage fine-grained permissions for GitHub.": "管理 GitHub 的细粒度权限。",
    "Issue creation": "Issue 创建",
    "Allow creating issues and grant access to specific issues.": "允许创建 Issue 并授予特定 Issue 的访问权限。",
    "Allow opening pull requests and grant access to specific PRs.": "允许创建 Pull Request 并授予特定 PR 的访问权限。",
    "Allow reading workflow runs (list, view, watch) across the whole repository.": "允许在整个仓库中读取工作流运行记录（列出、查看、关注）。",
    "Toggle this on to allow creating new issues.": "开启此项以允许创建新 Issue。",
    "Toggle this on to allow creating new pull requests.": "开启此项以允许创建新的 Pull Request。",
    "Toggle this on to enable read access on contents.": "开启此项以启用内容读取权限。",
    "Access grants": "访问授权",
    "Access rules": "访问规则",
    "No access": "无访问权限",

    // ===== 2.27.0 补充：MCP / 插件 / 技能 =====
    "Add MCP Servers": "添加 MCP 服务器",
    "Delete MCP Server": "删除 MCP 服务器",
    "Loading MCP servers...": "正在加载 MCP 服务器...",
    "MCP Servers Disabled": "MCP 服务器已禁用",
    "Refresh MCP servers": "刷新 MCP 服务器",
    "Search MCP servers by name": "按名称搜索 MCP 服务器",
    "Search for MCP servers to add to your configuration": "搜索要添加到配置中的 MCP 服务器",
    "No MCP servers yet. Use Add to browse the store.": "还没有 MCP 服务器。点击添加以浏览商店。",
    "Use Add MCP to browse the store.": "使用「添加 MCP」浏览商店。",
    "Ask the agent to diagnose and fix this server": "让智能体诊断并修复此服务器",
    "Delete server": "删除服务器",
    "This MCP server can no longer be configured.": "此 MCP 服务器已无法配置。",
    "MCP App": "MCP 应用",
    "MCP App:": "MCP 应用：",
    "MCP Authentication Error:": "MCP 认证错误：",
    "MCP Configuration Error:": "MCP 配置错误：",
    "MCP Install Error:": "MCP 安装错误：",
    "MCP Restart Error:": "MCP 重启错误：",
    "Plugin Operation Error:": "插件操作错误：",
    "Plugin update required": "需要更新插件",
    "Plugin metadata": "插件元数据",
    "Plugin:": "插件：",
    "Plugins, skills and MCP servers installed here. They run locally.": "此处安装的插件、技能和 MCP 服务器均在本地运行。",
    "You can also add or remove each plugin below.": "你也可以在下方添加或移除每个插件。",
    "This plugin requires authentication before the agent can use its tools.": "此插件需要身份验证后，智能体才能使用其工具。",
    "This plugin was force disabled.": "此插件已被强制禁用。",
    "No plugins available in the marketplace.": "应用市场中没有可用的插件。",
    "No plugins available.": "没有可用的插件。",
    "No plugins match your search.": "没有匹配的插件。",
    "No matching plugins found.": "未找到匹配的插件。",
    "No matching customizations found.": "未找到匹配的自定义项。",
    "No matching resources found.": "未找到匹配的资源。",
    "No resources added yet.": "还没有添加资源。",
    "No resources available": "没有可用的资源",
    "No extensions available": "没有可用的扩展",
    "Skill deletion is not available.": "技能删除不可用。",
    "Skill download success": "技能下载成功",
    "Skills are instructions that extend what Agent can do.": "技能是扩展智能体能力的指令。",
    "Active Skills": "活跃技能",
    "No skills available": "没有可用的技能",
    "No skills loaded.": "没有加载任何技能。",
    "Default Customizations": "默认自定义项",

    // ===== 2.27.0 补充：会话 / 任务 / 自动化 =====
    "No archived conversations": "没有已归档的对话",
    "No pinned conversations": "没有置顶的对话",
    "No conversations found": "未找到对话",
    "No matching conversations": "没有匹配的对话",
    "Loading conversations...": "正在加载对话...",
    "Search conversations with": "搜索对话：",
    "Search conversations, commands, and code...": "搜索对话、命令和代码...",
    "Search tasks...": "搜索任务...",
    "Search automations...": "搜索自动化...",
    "Search file contents...": "搜索文件内容...",
    "Search in document...": "在文档中搜索...",
    "No more older messages": "没有更早的消息了",
    "The conversation was compacted to fit within the context window.": "为适配上下文窗口，该对话已被压缩。",
    "The conversation was compacted while generating this response.": "生成此回复时，该对话已被压缩。",
    "The conversation could not be loaded because its data was not found.": "未找到该对话的数据，无法加载。",
    "This conversation is not on disk. Delete it to remove it from your sidebar.": "此对话不在磁盘上。删除它即可从侧边栏移除。",
    "Conversation is not open in this Hub window": "此对话未在该 Hub 窗口中打开",
    "No agent client available to start conversation": "没有可用的智能体客户端来启动对话",
    "The new conversation has no ID": "新对话没有 ID",
    "New Conversation in Workspace": "在工作区中新建对话",
    "Share Conversation (Preview)": "共享对话（预览）",
    "Back to chat": "返回对话",
    "Conversation Telemetry": "对话遥测",
    "New: Per-Conversation Telemetry": "新增：按对话遥测",
    "Enable telemetry in Settings before changing per-conversation telemetry.": "请先在设置中启用遥测，然后再更改按对话遥测。",
    "The task has not begun yet.": "任务尚未开始。",
    "The task is already done.": "任务已完成。",
    "Active Tasks & Conversations:": "活跃任务与对话：",
    "Not scheduled": "未安排",
    "Start Automation": "启动自动化",
    "This automation is currently stopped. Events and stdout streams will appear here once started.": "此自动化当前已停止。启动后，事件和标准输出流将显示在此处。",
    "This extension is currently stopped. Events and stdout streams will appear here once started.": "此扩展当前已停止。启动后，事件和标准输出流将显示在此处。",
    "Prompt to execute on schedule...": "要按计划执行的提示词...",
    "Prompt to run when triggered...": "触发时要运行的提示词...",
    "Not suitable for Best-of-N": "不适合 Best-of-N",
    "This prompt is straightforward and does not need alternative comparisons.": "此提示词较为直接，无需进行备选方案比较。",
    "Submit & Reroll": "提交并重新生成",
    "Review plans and walkthroughs": "审查计划与走查",
    "Review": "审查",
    "Agent Script": "智能体脚本",
    "New Agent Script": "新建智能体脚本",
    "Custom Agent Error:": "自定义智能体错误：",
    "The agent has a question for you:": "智能体有一个问题要问你：",
    "The agent has questions for you:": "智能体有几个问题要问你：",
    "The agent is waiting for your input.": "智能体正在等待你的输入。",
    "Error during tool execution": "工具执行期间出错",
    "Error while running MCP tool": "运行 MCP 工具时出错",
    "Error while running command": "运行命令时出错",
    "Error while searching": "搜索时出错",
    "Error while searching filesystem": "搜索文件系统时出错",
    "Error while searching the web": "搜索网络时出错",
    "Error while semantic searching": "语义搜索时出错",
    "Error while viewing": "查看时出错",
    "Error editing file": "编辑文件时出错",
    "Error viewing file": "查看文件时出错",
    "Error reading notebook": "读取笔记本时出错",
    "Error editing notebook": "编辑笔记本时出错",
    "Error parsing JSON:": "解析 JSON 时出错：",
    "Error fetching MCP prompt": "获取 MCP 提示词时出错",
    "Error fetching rules:": "获取规则时出错：",
    "Error occurred during import.": "导入过程中出错。",
    "Error while analyzing directory": "分析目录时出错",
    "Model Summarization Failed": "模型摘要失败",
    "Debug bundle uploaded!": "调试包已上传！",
    "Download the bundle manually and share it instead:": "请手动下载该包并分享：",

    // ===== 2.27.0 补充：Hook / 权限 / 终端 / 通用操作 =====
    "Configure hooks that run on agent lifecycle events.": "配置在智能体生命周期事件中运行的 Hook。",
    "Hook with this name already exists": "同名 Hook 已存在",
    "New hook name": "新 Hook 名称",
    "Delete command": "删除命令",
    "Edit permission target": "编辑权限目标",
    "Next: Review Permissions": "下一步：检查权限",
    "The agent auto-executes commands matched by an allow list entry.": "智能体将自动执行匹配允许列表条目的命令。",
    "The agent asks for permission before executing commands matched by a deny list entry.": "对于匹配拒绝列表条目的命令，智能体执行前会请求权限。",
    "Terminal allowed commands are no longer supported": "已不再支持终端允许命令",
    "Terminal denied commands are no longer supported": "已不再支持终端拒绝命令",
    "New Terminal": "新建终端",
    "New Terminal Tab": "新建终端标签页",
    "No active terminals": "没有活跃的终端",
    "No active terminals. Click + to create one.": "没有活跃的终端。点击 + 创建一个。",
    "Terminal input": "终端输入",
    "Terminal: Add to Chat": "终端：添加到对话",
    "Terminal Disabled on Non-Corp Domains": "终端在非企业域名下已禁用",
    "Run (unsandboxed)": "运行（非沙箱）",
    "This command ran in the sandbox.": "此命令在沙箱中运行。",
    "Run visibility": "运行可见性",
    "Tool visibility scope - who can access the tool.": "工具可见范围——谁可以访问该工具。",
    "Tool arguments": "工具参数",
    "Tool Output": "工具输出",
    "Custom Context Menus": "自定义上下文菜单",
    "Context Menus": "上下文菜单",
    "Context Providers": "上下文提供者",
    "Context usage": "上下文用量",
    "Code Context Items": "代码上下文项",
    "Toggle Between Light/Dark Themes": "在浅色/深色主题间切换",
    "Toggle Maximize Auxiliary Pane": "切换辅助窗格最大化",
    "Maximize Width": "最大化宽度",
    "Minimize Width": "最小化宽度",
    "Open side-by-side view": "打开并排视图",
    "Show in Sidebar": "在侧边栏中显示",
    "Go Back in Pane": "在窗格中后退",
    "Go Forward in Pane": "在窗格中前进",
    "Reset NUX": "重置新手引导",
    "Reset State": "重置状态",
    "Reset zoom (0)": "重置缩放 (0)",
    "Reload Window": "重新加载窗口",
    "Reload": "重新加载",
    "Open Trajectory Debug View": "打开轨迹调试视图",
    "Open extracted DOM in editor": "在编辑器中打开提取的 DOM",
    "Open allowlist": "打开允许列表",
    "Download PDF": "下载 PDF",
    "Export as PDF": "导出为 PDF",
    "Download SVG": "下载 SVG",
    "Save Image": "保存图片",
    "Save Video": "保存视频",
    "Copy Image Address": "复制图片地址",
    "Copy Link Address": "复制链接地址",
    "Leave a comment": "留下评论",
    "No comments yet": "还没有评论",
    "File Comments": "文件评论",
    "Diff Comments": "差异评论",
    "Artifact Comments": "产物评论",
    "Artifact Viewer": "产物查看器",
    "Artifact updated by agent": "产物已由智能体更新",
    "Artifact URL not found": "未找到产物 URL",
    "No artifacts generated": "没有生成任何产物",
    "File Explorer": "文件资源管理器",
    "File Viewer": "文件查看器",
    "Files Changed": "已更改的文件",
    "Files modified by the agent in this conversation": "此对话中由智能体修改的文件",
    "No file changes": "没有文件变更",
    "No changes to review": "没有需要审查的变更",
    "No branches": "没有分支",
    "No commits to push": "没有需要推送的提交",
    "No commit message was generated": "没有生成提交信息",
    "Select branch": "选择分支",
    "Branch / Ref": "分支 / 引用",
    "All Files": "所有文件",
    "No files or folders found": "未找到文件或文件夹",
    "No folders added yet.": "还没有添加文件夹。",
    "Select a folder.": "选择一个文件夹。",
    "Copy the folder elsewhere first if you might want it back.": "如果你之后可能还需要它，请先将该文件夹复制到别处。",
    "Are you sure you want to delete this hook card?": "确定要删除此 Hook 卡片吗？",
    "Edit title": "编辑标题",
    "Edit task title": "编辑任务标题",
    "Add label": "添加标签",
    "Add label for": "添加标签：",
    "Add files": "添加文件",
    "Add a message...": "添加消息...",
    "Add screenshot to conversation": "添加截图到对话",
    "Audio file size exceeds 20MB limit": "音频文件大小超过 20MB 上限",
    "Text file size exceeds 1MB limit": "文本文件大小超过 1MB 上限",
    "Image preview not available": "图片预览不可用",
    "Audio File": "音频文件",
    "Audio attachment": "音频附件",
    "Image attachment": "图片附件",
    "Text attachment": "文本附件",
    "File attachment": "文件附件",
    "Text Selection": "文本选区",
    "Continue": "继续",
    "Accept and continue": "接受并继续",
    "Next": "下一步",
    "Previous": "上一步",
    "Save & Continue": "保存并继续",
    "Save Configuration": "保存配置",
    "Confirm & Save": "确认并保存",
    "Confirm": "确认",
    "Apply": "应用",
    "Change": "更改",
    "Clear": "清除",
    "Configure": "配置",
    "Connect": "连接",
    "Disable": "禁用",
    "Enable": "启用",
    "Disconnect": "断开连接",
    "Install": "安装",
    "Manage": "管理",
    "Restart": "重启",
    "Restore": "恢复",
    "Retry": "重试",
    "Try Again": "重试",
    "Try again": "重试",
    "Not now": "暂不",
    "Not set": "未设置",
    "Not configured": "未配置",
    "Not connected": "未连接",
    "Unavailable": "不可用",
    "Not available": "不可用",
    "Optional": "可选",
    "This field is required": "此字段为必填项",
    "Show Error": "显示错误",
    "Hide Error": "隐藏错误",
    "Hide tools": "隐藏工具",
    "Bold": "加粗",
    "Italic": "斜体",
    "Underline": "下划线",
    "Error Details:": "错误详情：",
    "Error ID:": "错误 ID：",
    "Error Loading Models": "加载模型出错",
    "No Models Available": "没有可用模型",
    "No Model Selected": "未选择模型",
    "Select Model to Send Message": "选择模型以发送消息",
    "Select a model using the model selector in the input box": "使用输入框中的模型选择器选择一个模型",
    "Select another model": "选择其他模型",
    "Edit Model": "编辑模型",
    "Edit Custom Model": "编辑自定义模型",
    "Model URL": "模型 URL",
    "Model URL info": "模型 URL 信息",
    "No models available": "没有可用模型",
    "Custom models are only supported on Linux machines.": "自定义模型仅在 Linux 机器上受支持。",
    "Your quota for this model is running low.": "此模型的配额即将用尽。",
    "Your AI credits balance is too low to continue.": "你的 AI 点数余额过低，无法继续。",
    "No quota information available.": "没有可用的配额信息。",
    "New models have been enabled for you!": "已为你启用新模型！",
    "This request is not well-suited for parallel Best-of-N generation.": "此请求不适合并行 Best-of-N 生成。",
    "Custom agents are not available in Best of N mode.": "自定义智能体在 Best of N 模式下不可用。",
    "No model specified for Battle Mode, falling back to use current selected model": "Battle 模式未指定模型，将回退使用当前所选模型",
    "Code search is not available.": "代码搜索不可用。",
    "No internet. Agent features may not work.": "无网络连接。智能体功能可能无法正常工作。",
    "Agent sound playback blocked.": "智能体语音播放被阻止。",
    "Start Voice Recording": "开始语音录制",
    "Start Live Chat": "开始实时对话",
    "The voice Jetski speaks with.": "Jetski 使用的语音。",
    "Next voice": "下一个语音",
    "Previous voice": "上一个语音",
    "Not supported.": "不支持。",
    "Not implemented": "未实现",
    "Request aborted": "请求已中止",
    "Request timed out": "请求超时",
    "No results": "没有结果",
    "No results found": "未找到结果",
    "No results found.": "未找到结果。",
    "Size": "大小",
    // ===== 2.28.0 补充：幕僚长 (Chief of Staff)、语音模式与反馈评估 =====
    "A fast Talker acks; Jetski answers; a Narrator reads it out.": "快速应答交给 Talker；回答交给 Jetski；朗读交给 Narrator。",
    "An error occurred while submitting your feedback. Please try again.": "提交反馈时出错，请重试。",
    "Bad clarification": "无效澄清",
    "Chief of Staff": "幕僚长",
    "Chief of Staff Dashboard": "幕僚长仪表板",
    "Chief of Staff canvas": "幕僚长画布",
    "Chief of Staff voice message failed": "幕僚长语音消息发送失败",
    "Chief of Staff voice mode is active": "幕僚长语音模式已开启",
    "Chief of Staff voice mode stopped": "幕僚长语音模式已停止",
    "Correctness": "正确性",
    "Elegant code": "代码优雅",
    "Forgot context": "忘记上下文",
    "Good questions": "好问题",
    "Hacky/lazy code": "取巧/偷懒的代码",
    "Hallucinated": "产生幻觉",
    "How loud Jetski's voice is.": "Jetski 语音的音量大小。",
    "Incomplete / Gave up": "未完成 / 已放弃",
    "Input device for voice mode.": "语音模式的输入设备。",
    "Intent understanding": "意图理解",
    "Lacked initiative": "缺乏主动性",
    "Microphone": "麦克风",
    "Mute Live Chat Mic": "静音实时聊天麦克风",
    "One live model talks and hands real lookups to Jetski.": "由实时模型负责对话，并将实际查询交给 Jetski 处理。",
    "Proactive solution": "主动提供解决方案",
    "Semantic": "语义",
    "Sent to Chief of Staff": "发送给幕僚长",
    "Talker + Narrator (relay)": "说话者 + 旁白（中继）",
    "Thank you! Your feedback has been submitted successfully.": "谢谢！你的反馈已成功提交。",
    "Thorough research": "深入研究",
    "Thorough testing": "彻底测试",
    "Type any voice server address.": "输入任意语音服务器地址。",
    "Under-researched": "调研不足",
    "Understanding Intent": "理解意图",
    "Used context well": "上下文利用得当",
    "Voice": "语音",
    "Voice engine": "语音引擎",
    "Voice recording is unavailable while the Chief of Staff mic is on": "幕僚长麦克风开启时无法录制语音",
    "Whatever the voice-engine-addr flag serves you.": "由 voice-engine-addr 标志提供的任意地址。",
    // ===== 2.28.0 补充：内置浏览器、浏览器工具与连接安全 =====
    "Absolute path to the Chrome/Chromium executable": "Chrome/Chromium 可执行文件的绝对路径",
    "Auto (Preview)": "自动（预览）",
    "Browser CDP Port": "浏览器 CDP 端口",
    "Browser Subagent": "浏览器子智能体",
    "Browser tools (browser_.*)": "浏览器工具（browser_.*）",
    "Built-in Browser": "内置浏览器",
    "Built-in Browser Preferences": "内置浏览器偏好设置",
    "Capture Console Logs": "捕获控制台日志",
    "Capture Screenshot": "捕获屏幕截图",
    "Choose where links open by default when clicked.": "选择点击链接时默认打开的位置。",
    "Choose where links open by default when clicked": "选择点击链接时默认打开的位置",
    "Chrome Binary Path": "Chrome 可执行文件路径",
    "Chromium": "Chromium",
    "Click to copy URL": "点击复制 URL",
    "Configure link opening and built-in browser preferences.": "配置链接打开方式与内置浏览器偏好设置。",
    "Configure link opening and built-in browser preferences": "配置链接打开方式与内置浏览器偏好设置",
    "Couldn't load Google Drive link title": "无法加载 Google Drive 链接标题",
    "Custom path for the browser user profile directory. Leave empty for default (~/.gemini/antigravity-browser-profile).": "浏览器用户配置文件目录的自定义路径。留空则使用默认路径（~/.gemini/antigravity-browser-profile）。",
    "Embedded web preview": "内嵌网页预览",
    "Execute URLs": "执行 URL",
    "External Browser": "外部浏览器",
    "Git-on-Borg repository used when creating a new Cog workspace from your initial prompt (e.g., chromium/src or android/platform/superproject).": "从初始提示词创建新的 Cog 工作区时所用的 Git-on-Borg 仓库（例如 chromium/src 或 android/platform/superproject）。",
    "Hook will only trigger if the tool name starts with browser_.": "仅当工具名称以 browser_ 开头时才会触发 Hook。",
    "Inline PDF preview is not available in this environment.": "当前环境不支持内嵌 PDF 预览。",
    "Install or enable the Google Drive plugin in Customizations to search files with @drive: or paste Drive links": "在自定义设置中安装或启用 Google Drive 插件，即可使用 @drive: 搜索文件或粘贴云端硬盘链接",
    "Links": "链接",
    "No links": "无链接",
    "Open Conversation in New Tab": "在新标签页中打开对话",
    "Open Image in New Tab": "在新标签页中打开图片",
    "Open Links In": "链接打开位置",
    "Path to the Chrome/Chromium executable. Leave empty for auto-detection.": "Chrome/Chromium 可执行文件的路径。留空则自动检测。",
    "Port number for Chrome DevTools Protocol remote debugging. Leave empty for default (9222).": "Chrome DevTools 协议远程调试使用的端口号。留空则使用默认值（9222）。",
    "Preview": "预览",
    "Preview is not available for this file type.": "此文件类型不支持预览。",
    "Reopen Closed Tab": "重新打开已关闭的标签页",
    "Table options": "表格选项",
    "Target text in PDF...": "在 PDF 中查找文本...",
    "View site information": "查看站点信息",
    "Your connection to this site is not secure": "你与该网站的连接不安全",
    // ===== 2.28.0 补充：远程工作区、执行模式、Hooks 与企业集成 =====
    "A shell setup script run before every command the agent executes in this project. Overrides the global script.": "在智能体于本项目中执行每条命令之前运行的 Shell 初始化脚本。会覆盖全局脚本。",
    "A shell setup script run before every command the agent executes.": "在智能体执行每条命令之前运行的 Shell 初始化脚本。",
    "ABFS Workspace (Alpha)": "ABFS 工作区（Alpha）",
    "AI Credits Used to Generate Response": "生成回复已使用的 AI 额度",
    "Agent Host Address": "智能体主机地址",
    "Agent always asks for review.": "智能体始终请求审查。",
    "Autonomous Mode": "自主模式",
    "Autonomous mode active: the agent works independently and does not ask questions or request new permissions.": "自主模式已开启：智能体独立工作，不会提问或请求新的权限。",
    "Best-of-N Ended": "Best-of-N 已结束",
    "Best-of-N Started": "Best-of-N 已开始",
    "Build with one agent or a team": "用一个智能体或一支团队来构建",
    "CitC Clone": "CitC 克隆",
    "CitC Workspace (Do not use for PII/NTK data)": "CitC 工作区（不要用于存放 PII/NTK 数据）",
    "CitC Workspace Type": "CitC 工作区类型",
    "Clone current workspace into a new independent workspace": "将当前工作区克隆为新的独立工作区",
    "Cog Workspace (Do not use for PII/NTK data)": "Cog 工作区（不要用于存放 PII/NTK 数据）",
    "Comment on the plan before your agent starts, and get a walkthrough when it finishes.": "在智能体开始前为计划添加评论，完成后可获得完整讲解。",
    "Commit": "提交",
    "Connect an account so the agent can use this app.": "连接账号，以便智能体可以使用此应用。",
    "Could not create Cog workspace": "无法创建 Cog 工作区",
    "Created a new branch on GitHub.": "已在 GitHub 上创建新分支。",
    "Created a new branch on Origin.": "已在 Origin 上创建新分支。",
    "Current workspace": "当前工作区",
    "Default Workspace VCS": "默认工作区 VCS",
    "Delete ABFS Workspace": "删除 ABFS 工作区",
    "Describe what you want. Your agent plans and builds it, and brings in other agents when needed.": "描述你的需求。你的智能体会规划并构建它，并在需要时引入其他智能体。",
    "Dev mode: Localhost server automatically detected": "开发模式：已自动检测到本地服务器",
    "Enable fine-grained GitHub permissions and define the org, repository, and resource-level access the agent is allowed to use.": "启用 GitHub 细粒度权限，并定义智能体允许使用的组织、仓库和资源级访问权限。",
    "Enter a prompt for the agent to run...": "输入要运行智能体的提示词...",
    "Enter workspace name (e.g., my-cog-feature)": "输入工作区名称（例如 my-cog-feature）",
    "Enter workspace name (e.g., my-feature)": "输入工作区名称（例如 my-feature）",
    "Enterprise": "企业版",
    "External tools the agent can call via Model Context Protocol.": "智能体可通过 MCP 调用的外部工具。",
    "Failed to Commit": "提交失败",
    "Failed to Generate Commit Message": "生成提交信息失败",
    "Failed to create CitC clone workspace": "创建 CitC 克隆工作区失败",
    "Failed to start Best of N mode": "启动 Best-of-N 模式失败",
    "Gemini Enterprise": "Gemini 企业版",
    "Get notified when the agent needs your attention or completes a task.": "当智能体需要你关注或完成任务时，你会收到通知。",
    "GitHub": "GitHub",
    "GitHub Permissions": "GitHub 权限",
    "GitHub Personal Access Token": "GitHub 个人访问令牌",
    "GitHub Policies": "GitHub 策略",
    "Helpful explanation": "有帮助的解释",
    "Hook will only trigger if the tool name matches run_command or view_file.": "仅当工具名称匹配 run_command 或 view_file 时才会触发 Hook。",
    "Hook will only trigger if the tool name matches run_command.": "仅当工具名称匹配 run_command 时才会触发 Hook。",
    "Hook will trigger if any tool is executed.": "执行任意工具时都会触发 Hook。",
    "Host Environment": "宿主环境",
    "Insufficient AI Credits": "AI 额度不足",
    "Managed by Enterprise Gateway": "由企业网关管理",
    "No matching flags": "没有匹配的标志",
    "No models are available for your current project or account. Please check your project settings and IAM permissions.": "当前项目或账户没有可用的模型。请检查项目设置和 IAM 权限。",
    "Optional branch or ref used when creating a new Cog workspace (defaults to main if unset).": "创建新的 Cog 工作区时使用的可选分支或 ref（未设置时默认为 main）。",
    "Permission Details": "权限详情",
    "Proceed with Plan": "继续执行计划",
    "Purchase Credits": "购买额度",
    "Remount workspace": "重新挂载工作区",
    "Search flags": "搜索标志",
    "See Plans": "查看计划",
    "Select the workspace type that will be used for new conversations started with the New Workspace option.": "选择工作区类型，该类型将用于通过“新建工作区”选项开始的新对话。",
    "Simulate a different host (Electron, desktop or mobile Web, Extension, remote control, or installed PWA).": "模拟不同的宿主环境（Electron、桌面端或移动网页端、扩展、远程控制或已安装的 PWA）。",
    "Simulate a different user cohort (Google, External, Enterprise).": "模拟不同的用户群体（Google、外部、企业）。",
    "Simulate running on a different OS.": "模拟在其他操作系统上运行。",
    "Subagent ended": "子智能体已结束",
    "Sync JJ Worktrees to Head": "将 JJ 工作树同步到 Head",
    "Sync newly created JJ worktrees to head when starting a conversation.": "开始对话时，将新建的 JJ 工作树同步到 head。",
    "Team of subagents to do long running work": "由子智能体组成的团队，负责长时间运行的工作",
    "True changes vs the parent workspace": "与父工作区相比的实际更改",
    "Turn on a flag you don't have": "开启你尚未拥有的标志",
    "Uncommitted": "未提交",
    "Unmount workspace": "卸载工作区",
    "Use full Git clones for Best of N": "为 Best-of-N 使用完整 Git 克隆",
    "Use full VCS clones for Best of N": "为 Best-of-N 使用完整 VCS 克隆",
    "VCS used when creating a new workspace, including workspaces generated based off your initial prompt.": "创建新工作区时使用的 VCS，包括基于初始提示词生成的工作区。",
    "When enabled, the agent will include default customizations, including default skills.": "启用后，智能体将包含默认定制内容，包括默认技能。",
    "When enabled, the values below replace the auto-detected OS, host, and user type used for feature gating.": "启用后，以下取值将替换自动检测到的操作系统、主机和用户类型（用于功能门控）。",
    "Why are you opting out of auto-triggered Best-of-N?": "你为什么选择退出自动触发的 Best-of-N？",
    "Work in a CitC workspace.": "在 CitC 工作区中工作。",
    "Work in a Cog workspace.": "在 Cog 工作区中工作。",
    "Work in an ABFS workspace.": "在 ABFS 工作区中工作。",
    "Your information (for example, passwords or credit card numbers) is private when it is sent to this site.": "你的信息（例如密码或信用卡号）在发送到该网站时属于私密信息。",
    // ===== 2.28.0 补充：终端、任务、版本控制与通用界面 =====
    "(Optional) Tell us more or type your reason...": "（可选）告诉我们更多，或输入你的原因……",
    "(empty)": "（空）",
    "// Greet a user by name": "// 按名称向用户问好",
    "A label for this computer when you connect from another device. Changing it reconnects.": "从其他设备连接时用于标识本机的名称。更改后会重新连接。",
    "A nickname for identifying this application in the companion website. Changing this will restart the connection.": "在配套网站中用于标识本应用的昵称。更改后连接会重启。",
    "ALIAS": "别名",
    "Aborted due to condition callback returning false.": "已中止，原因是条件回调返回 false。",
    "Accounts": "账户",
    "Add Shortcut": "添加快捷方式",
    "Added (Staged)": "已添加（已暂存）",
    "Address CLs needing attention": "处理需要关注的 CL",
    "Admin escalation": "管理员提权",
    "After": "之后",
    "All tools (*)": "所有工具（*）",
    "Android (main)": "Android（主）",
    "Annotation": "标注",
    "Antigravity Interactive HTML": "Antigravity 交互式 HTML",
    "Aoede": "Aoede",
    "App update required": "需要更新应用",
    "Archive / Restore": "归档 / 恢复",
    "Ask about your code or any topic, get clear answers.": "就你的代码或任何话题提问，获得清晰的答案。",
    "Authenticate": "身份验证",
    "Authenticating...": "正在验证身份……",
    "Authentication expired": "身份验证已过期",
    "Auto (detected)": "自动（已检测）",
    "Automatically decide if commands run.": "自动判断命令是否运行。",
    "Automatically reproduce bugs, trace causes, test fixes.": "自动复现 Bug、追查根因、验证修复。",
    "Background Commands": "后台命令",
    "Background Task Output": "后台任务输出",
    "Background Tasks": "后台任务",
    "Backoff": "退避",
    "Baseline model quota reached": "已达到基线模型配额上限",
    "Before": "之前",
    "Binary file not shown": "二进制文件不予显示",
    "Block": "阻止",
    "Blocked": "已阻止",
    "BoN": "BoN",
    "Buganizer": "Buganizer",
    "Build new features": "构建新功能",
    "By default, agents work in folders you choose and ask before sensitive changes. Adjust this anytime in Settings.": "默认情况下，智能体在你选择的文件夹中工作，并在进行敏感改动前征求同意。你可以随时在设置中调整。",
    "CLOSED": "已关闭",
    "CORD": "CORD",
    "Changelists": "变更列表",
    "Charon": "Charon",
    "Check CLs that require my attention and fix them in their respective conversations.": "检查需要我关注的 CL，并在各自的对话中修复它们。",
    "Check pending conversations in the last 3 days that require action from me.": "检查最近 3 天内待处理且需要我采取行动的对话。",
    "Clear & concise": "清晰简洁",
    "Click to view or edit comment": "点击查看或编辑评论",
    "Close (Esc)": "关闭 (Esc)",
    "Cloud": "云端",
    "Commands and files these agents can use.": "这些智能体可使用的命令和文件。",
    "Comments": "评论",
    "Communication": "通信",
    "Complete Onboarding Step": "完成新手引导步骤",
    "Complete verification": "完成验证",
    "Connection security information is not available for this page": "此页面无法获取连接安全信息",
    "Core AI Systems is hiring!": "Core AI Systems 正在招聘！",
    "Correct code": "代码正确",
    "Could not create project": "无法创建项目",
    "Couldn't mark conversations as read": "无法将对话标记为已读",
    "Critique": "点评",
    "Cron expression e.g. 0 */6 * * *": "Cron 表达式，例如 0 */6 * * *",
    "Currently installed": "当前已安装",
    "Custom Order": "自定义排序",
    "Customize Global Skills": "自定义全局技能",
    "Cut": "剪切",
    "Daily": "每日",
    "Declaration": "声明",
    "Default (Mendel)": "默认 (Mendel)",
    "Delete All Remote Agents Data": "删除所有远程智能体数据",
    "Delete All Remote Agents Data?": "删除所有远程智能体数据？",
    "Determines the markup language of the output.": "确定输出内容的标记语言。",
    "Device Name": "设备名称",
    "Did what I wanted": "符合我的预期",
    "Disabled. Open Details to finish setup or enable.": "已禁用。打开详情以完成设置或启用。",
    "Disabled. Open the plugin page to finish setup.": "已禁用。打开插件页面以完成设置。",
    "Discard": "丢弃",
    "Discover helpful skills & plugins": "发现实用的技能与插件",
    "Dismiss": "关闭",
    "Dismiss service announcement": "关闭服务公告",
    "Display and preserve intermediate thinking steps.": "显示并保留中间思考步骤。",
    "Documents": "文档",
    "Don't show this for 2 days": "2 天内不再显示",
    "Draft documents, emails, and notes that sound like you.": "起草符合你风格的文档、邮件和笔记。",
    "Drag to resize, double-click to reset": "拖动调整大小，双击重置",
    "Drawer": "抽屉",
    "Drive": "云端硬盘",
    "E.g. locations/global/workforcePools...": "例如 locations/global/workforcePools...",
    "Edit Shortcut": "编辑快捷键",
    "Electron (Android Desktop)": "Electron（Android 桌面端）",
    "Electron (Desktop)": "Electron（桌面端）",
    "Electron (Gemini App)": "Electron（Gemini 应用）",
    "Enable Demo Mode (Beta)": "启用演示模式 (Beta)",
    "Enable New Themes": "启用新主题",
    "Enter authorization code...": "输入授权码...",
    "Enter device name...": "输入设备名称...",
    "Enter project name...": "输入项目名称...",
    "Enter the configuration values this MCP server needs. Saving restarts the server with them.": "输入此 MCP 服务器所需的配置值。保存后将使用这些配置重启服务器。",
    "Enter tool name or server...": "输入工具名称或服务器...",
    "Error:": "错误：",
    "Errors": "错误",
    "Europe": "欧洲",
    "Excellent tool usage": "工具使用出色",
    "Exceptional work": "卓越的工作",
    "Explore the plugin marketplace": "浏览插件市场",
    "Extension": "扩展",
    "Extension (Cider)": "扩展（Cider）",
    "Extension (Eclipse)": "扩展（Eclipse）",
    "Extension (VS Code)": "扩展（VS Code）",
    "Extension (Visual Studio)": "扩展（Visual Studio）",
    "Extensions": "扩展",
    "External": "外部",
    "Failed to Push": "推送失败",
    "Failed to continue": "继续失败",
    "Failed to create cloud project": "创建云端项目失败",
    "Failed to create terminal": "创建终端失败",
    "Failed to create worktree": "创建工作树失败",
    "Failed to delete conversation": "删除对话失败",
    "Failed to proceed": "继续操作失败",
    "Failed to refresh credentials": "刷新凭据失败",
    "Failed to rename conversation": "重命名对话失败",
    "Failed to revert conversation": "回滚对话失败",
    "Failed to start conversation": "启动对话失败",
    "Failed to stop agent": "停止智能体失败",
    "Failed to stop conversation": "停止对话失败",
    "Failed to upload HTML artifact to Drive": "将 HTML 制品上传到云端硬盘失败",
    "Fenrir": "Fenrir",
    "Fit Mode": "适配模式",
    "Flash": "Flash",
    "Flash Lite": "Flash Lite",
    "Folders these agents can access.": "这些智能体可访问的文件夹。",
    "Friday": "星期五",
    "Full Error": "完整错误",
    "Gemini 2.5 Flash Image": "Gemini 2.5 Flash Image",
    "Gemini 3 Pro Image": "Gemini 3 Pro Image",
    "Gemini 3.1 Flash Image": "Gemini 3.1 Flash Image",
    "Generations": "生成记录",
    "Getting scripts...": "正在获取脚本...",
    "Getting started with Google Antigravity": "开始使用 Google Antigravity",
    "Goals": "目标",
    "Google (internal)": "Google（内部）",
    "Google Sans": "Google Sans",
    "Google3": "Google3",
    "Google3 Configuration": "Google3 配置",
    "Google3 projects are deprecated. Learn more": "Google3 项目已弃用。了解更多",
    "Got it": "知道了",
    "Grasped nuance": "抓住了细微差别",
    "Hand off a feature and come back to working code.": "交付一个功能，回来时就有可运行的代码。",
    "Highly independent": "高度独立",
    "I prefer an immediate single response to prioritize productivity right now.": "我更倾向于立即得到单次回复，以优先提升当前效率。",
    "Ignored": "已忽略",
    "Import AI Studio Project": "导入 AI Studio 项目",
    "In Progress": "进行中",
    "In a rush": "急于求成",
    "Include Jetski Default Customizations": "包含 Jetski 默认自定义项",
    "Include default customizations, such as default skills.": "包含默认自定义项，例如默认技能。",
    "Include unstaged changes": "包含未暂存的更改",
    "Inline Widget": "内联组件",
    "Installed Skills": "已安装的技能",
    "JSType": "JSType",
    "Keeps working in this folder. Nothing is copied.": "继续在此文件夹中工作，不会复制任何内容。",
    "Kill Terminal": "终止终端",
    "Kore": "Kore",
    "Label": "标签",
    "Laziness": "偷懒",
    "Learn from my conversation history to write a personalized set of rules for future agentic interactions.": "从我的对话历史中学习，为今后的智能体交互编写一套个性化规则。",
    "Leda": "Leda",
    "Linux": "Linux",
    "Local Checkout": "本地检出",
    "Local Windows environment": "本地 Windows 环境",
    "Location": "位置",
    "MCP": "MCP",
    "MacOS": "macOS",
    "Makes \\color behave like LaTeX's 2-argument \\textcolor, instead of LaTeX's one-argument \\color mode change.": "使 \\color 的行为与 LaTeX 的双参数 \\textcolor 一致，而不是 LaTeX 单参数 \\color 的模式切换。",
    "Manifest Changes": "清单变更",
    "Mark All as Read": "全部标为已读",
    "Mark This Conversation as Read": "将此对话标为已读",
    "Mark This Conversation as Unread": "将此对话标为未读",
    "Misunderstood": "理解有误",
    "Modified": "已修改",
    "Modified Files": "已修改的文件",
    "Monday": "星期一",
    "More": "更多",
    "Move Conversation Down": "向下移动对话",
    "Move Conversation Up": "向上移动对话",
    "Nickname": "昵称",
    "No uploads": "无上传",
    "OK": "确定",
    "Offline": "离线",
    "Online": "在线",
    "Open Folder (Interactive)": "打开文件夹（交互式）",
    "Open in": "打开位置",
    "Open in Side Panel": "在侧边栏中打开",
    "Operating System": "操作系统",
    "Options": "选项",
    "Organization Allowed Domains (Read-Only)": "组织允许的域（只读）",
    "Orus": "Orus",
    "Other": "其他",
    "Other (write your answer)": "其他（请写出你的答案）",
    "Overfixated": "过度修复",
    "Override feature environment": "覆盖功能环境",
    "Owner": "所有者",
    "Paste": "粘贴",
    "Pay As You Go": "按量付费",
    "Print telemetry to the console": "将遥测数据打印到控制台",
    "Pro": "Pro",
    "Prompt too simple": "提示词过于简单",
    "Puck": "Puck",
    "Push": "推送",
    "Quality": "质量",
    "Quote Selection": "引用选择",
    "Ready": "就绪",
    "Recent Files": "最近的文件",
    "Recent files": "最近的文件",
    "Refreshed credentials for all automations.": "已刷新所有自动化的凭据。",
    "Remote Agents Data": "远程智能体数据",
    "Remove Shortcut": "移除快捷方式",
    "Renamed": "已重命名",
    "Render display math flush left.": "将行间公式顶格左对齐显示。",
    "Render display math in leqno style (left-justified tags).": "以 leqno 风格渲染行间公式（标签左对齐）。",
    "Research & Codenav": "研究与代码导航",
    "Research anything": "研究任何内容",
    "Research, writing, and everyday tasks, without code.": "研究、写作与日常任务，无需编写代码。",
    "Reset All to Defaults": "全部重置为默认值",
    "Reset to Default": "重置为默认值",
    "Resume it to load this file.": "恢复它以加载此文件。",
    "Resume it to open a new terminal. Anything that was running in this one has stopped.": "恢复它以打开新的终端。此终端中正在运行的任何内容都已停止。",
    "Runs in the cloud": "在云端运行",
    "Runs on this computer": "在本机运行",
    "STRING": "字符串",
    "Sample GDoc": "示例 Google 文档",
    "Sandbox Allow Network": "沙箱允许网络",
    "Saturday": "星期六",
    "Screen Recording": "屏幕录制",
    "See more results": "查看更多结果",
    "Seek": "定位",
    "Set the rules, define the boundaries.": "设定规则，明确边界。",
    "Setup required": "需要完成设置",
    "Sign in to finish setting up this plugin.": "登录以完成此插件的设置。",
    "Staged Changes": "已暂存的更改",
    "Staged index changes and working tree changes": "已暂存的索引更改和工作树更改",
    "Stale info": "信息已过期",
    "Standalone": "独立",
    "Standalone Terminals": "独立终端",
    "Starting": "启动中",
    "Stop Editing": "停止编辑",
    "Stopped": "已停止",
    "Stored and mounted in your cloud environment": "存储并挂载到你的云环境中",
    "Strict Mode": "严格模式",
    "Style": "样式",
    "Sunday": "星期日",
    "System default": "系统默认",
    "Telemetry": "遥测",
    "Telemetry is disabled in Settings": "遥测已在设置中关闭",
    "Terminals": "终端",
    "The current trigger rate is too high.": "当前的触发频率过高。",
    "The full developer experience with code and tooling.": "完整的开发者体验，涵盖代码与工具。",
    "There was an error with your authentication. To log in, click": "身份验证时发生错误。要登录，请点击",
    "This Computer": "本机",
    "This computer": "本机",
    "This conversation is also open in another app. Sending messages from both may cause conflicts.": "此对话也已在另一个应用中打开。从两处同时发送消息可能会导致冲突。",
    "Thumbnails": "缩略图",
    "Thursday": "星期四",
    "Time Zone": "时区",
    "Tip": "提示",
    "To use the agent, please login": "要使用该智能体，请先登录",
    "Toggle": "切换",
    "Too many requests, please try again in a bit!": "请求过多，请稍后再试！",
    "Too many surveys": "问卷过多",
    "Trajectory Debug View": "轨迹调试视图",
    "Tuesday": "星期二",
    "Type": "类型",
    "Type absolute path or navigate folders...": "输入绝对路径或浏览文件夹...",
    "UI Extensions": "UI 扩展",
    "UI extensions": "UI 扩展",
    "Unauthenticated": "未认证",
    "Undercommunicated": "沟通不足",
    "Undo": "撤销",
    "United States": "美国",
    "Unknown": "未知",
    "Unsandboxed commands": "非沙箱命令",
    "Unstage change": "取消暂存更改",
    "Untracked (Unstaged)": "未跟踪（未暂存）",
    "Updated sidebar grouping": "侧边栏分组已更新",
    "Updater": "更新程序",
    "Updates to your sidebar": "侧边栏更新",
    "Uploaded to Google Drive": "已上传到 Google Drive",
    "Uploads": "上传",
    "Uptime": "运行时长",
    "Usage": "用量",
    "Use Google Sans instead of the default Inter typeface": "使用 Google Sans 替代默认的 Inter 字体",
    "Use my conversation history to tell me which skills and plugins would be helpful for me.": "根据我的对话历史，告诉我哪些技能和插件对我有帮助。",
    "Use the experimental visual themes instead of standard presets": "使用实验性视觉主题而非标准预设",
    "Use theme to be imported with settings": "导入设置时使用的主题",
    "User Type": "用户类型",
    "Verification required": "需要验证",
    "Waiting for your input": "等待你的输入",
    "Web (desktop)": "网页端（桌面端）",
    "Web (desktop, PWA)": "网页端（桌面端，PWA）",
    "Web (desktop, remote control)": "网页端（桌面端，远程控制）",
    "Web (desktop, remote control, PWA)": "网页端（桌面端，远程控制，PWA）",
    "Web (mobile)": "网页端（移动端）",
    "Web (mobile, PWA)": "网页端（移动端，PWA）",
    "Web (mobile, remote control)": "网页端（移动端，远程控制）",
    "Web (mobile, remote control, PWA)": "网页端（移动端，远程控制，PWA）",
    "Wednesday": "星期三",
    "Welcome to Cider with Jetski": "欢迎使用 Cider 与 Jetski",
    "Windows": "Windows",
    "Zephyr": "Zephyr",
    "Zoom": "缩放",
    "Zoom in (+)": "放大 (+)",
    "Zoom out (-)": "缩小 (-)",
    "main (or e.g., sc-dev, sc-release)": "main（例如 sc-dev、sc-release）",
    // ===== 2.29.0 补充：语音模式、录音与无障碍 =====
    "Accessibility": "无障碍",
    "Delete all recordings?": "删除所有录音？",
    "Files, folders, and repositories you connect are accessible to your agent in this project, including during background or scheduled runs.": "你连接的文件、文件夹和仓库，在此项目中可被你的智能体访问，包括在后台或计划运行期间。",
    "Font": "字体",
    "How loud Antigravity's voice is.": "Antigravity 的语音音量大小。",
    "How loud Antigravity's voice is": "Antigravity 的语音音量大小",
    "Input device for voice mode and dictation.": "语音模式与语音输入的输入设备。",
    "Mute Voice Mic": "静音语音麦克风",
    "Mute Voice Speaker": "静音语音扬声器",
    "Optimize the interface and terminal output for screen readers.": "为屏幕阅读器优化界面与终端输出。",
    "Recordings": "录音",
    "Save audio recordings": "保存音频录音",
    "Screen Reader Mode": "屏幕阅读器模式",
    "The voice used in Voice mode. Powered by Gemini Live.": "语音模式下使用的声音。由 Gemini Live 提供支持。",
    "The voice used in Voice mode. Powered by Gemini Live": "语音模式下使用的声音。由 Gemini Live 提供支持",
    "Type a voice variant name, such as rev27.": "输入语音变体名称，例如 rev27。",
    "Voice mode": "语音模式",
    "Voice Mode": "语音模式",
    // ===== 2.29.0 补充：远程智能体、云端环境与用量配额 =====
    "Browse MCP resources": "浏览 MCP 资源",
    "Browse rules": "浏览规则",
    "Browser Use": "浏览器使用",
    "Connect GitHub": "连接 GitHub",
    "Connect an account so the agent can run automations.": "连接账号，以便智能体运行自动化。",
    "Context and Quota Indicator": "上下文与配额指示器",
    "Controls permissions for remote conversations.": "控制远程对话的权限。",
    "Conversation limit reached": "已达到对话数量上限",
    "Daily conversation limit reached": "已达到每日对话数量上限",
    "Daily environment time used": "已使用的每日环境时间",
    "Failed to create remote project": "创建远程项目失败",
    "Free": "免费",
    "More cloud environments": "更多云端环境",
    "Remote agents are busy": "远程智能体繁忙",
    "Runs remotely": "在远程运行",
    "Search connectors": "搜索连接器",
    "Subscription": "订阅",
    "Too many environments running": "运行中的环境过多",
    "Your connection to this site is not fully secure": "你与此站点的连接并非完全安全",
    // ===== 2.29.0 补充：内置浏览器、下载与站点信息 =====
    "Attackers might be able to see the images you're looking at on this site and trick you by modifying them.": "攻击者可能会看到你在此站点上浏览的图片，并通过篡改它们来欺骗你。",
    "Browsing History": "浏览历史",
    "Cancel download": "取消下载",
    "Clear visited URLs and autocomplete suggestions from the built-in browser.": "清除内置浏览器中访问过的网址与自动补全建议。",
    "Clear visited URLs and autocomplete suggestions from the built-in browser": "清除内置浏览器中访问过的网址与自动补全建议",
    "Download Location": "下载位置",
    "Download this site as an app to get notified when the agent needs your attention or completes a task.": "将此站点下载为应用，以便在智能体需要你处理或完成任务时收到通知。",
    "Downloads": "下载",
    "Folder where files downloaded in the built-in browser are saved.": "在内置浏览器中下载的文件所保存的文件夹。",
    "Folder where files downloaded in the built-in browser are saved": "在内置浏览器中下载的文件所保存的文件夹",
    "Google Search": "Google 搜索",
    "Remove from history (Shift+Delete)": "从历史记录中移除 (Shift+Delete)",
    "Website": "网站",
    "You're viewing a blank page": "你正在查看一个空白页面",
    "You're viewing a local or shared file": "你正在查看本地或共享文件",
    // ===== 2.29.0 补充：自动化调度、对话与任务 =====
    "Attach terminal output": "附加终端输出",
    "Author": "作者",
    "Background tasks and terminals agents left running, across all conversations.": "所有对话中由智能体留下的后台任务和终端。",
    "Change schedule": "更改调度",
    "Chat": "聊天",
    "Chat Input": "聊天输入框",
    "Chat Width": "聊天宽度",
    "Choose how much detail is shown during a conversation.": "选择对话过程中显示的详细程度。",
    "Choose where terminal sessions appear.": "选择终端会话显示的位置。",
    "CitC Workspace": "CitC 工作区",
    "Cog Workspace": "Cog 工作区",
    "Conversation Steps": "对话步骤",
    "Conversation Unarchived": "对话已取消归档",
    "Couldn't edit queued message": "无法编辑排队消息",
    "Docs, Sheets, Slides, and folders": "文档、表格、幻灯片和文件夹",
    "Every day": "每天",
    "Every hour": "每小时",
    "Every week": "每周",
    "Every weekday": "每个工作日",
    "Explore other marketplace customizations": "浏览其他市场自定义项",
    "Failed to read file": "读取文件失败",
    "For example: every morning, summarize new bugs assigned to me and anything that changed overnight.": "例如：每天早上汇总分配给我的新缺陷，以及夜间发生的任何变化。",
    "Google Chat": "Google Chat",
    "It was already sent or couldn't be removed from the queue.": "它已被发送，或无法从队列中移除。",
    "Members": "成员",
    "More Plugins": "更多插件",
    "New Conversation Button": "新建对话按钮",
    "New Workspace": "新建工作区",
    "On a schedule": "按计划执行",
    "Repository": "仓库",
    "Search branches": "搜索分支",
    "Show in folder": "在文件夹中显示",
    "Terminal Placement": "终端布局",
    "When something happens": "当有情况发生时",
    "Which workspace the New Conversation button and keyboard shortcut start you in.": "新建对话按钮和快捷键将在哪个工作区中启动。",
    // ===== 2.29.0 补充：侧边面板、界面布局与通用操作 =====
    "Announcements and tips": "公告与提示",
    "Change model": "更改模型",
    "Close Tabs to the Left": "关闭左侧标签页",
    "Enter to Send": "回车发送",
    "Extension (Antigravity IDE)": "扩展 (Antigravity IDE)",
    "Failed to send side question": "发送侧边提问失败",
    "Failed to start side question": "启动侧边提问失败",
    "For example: Morning bug summary": "例如：早间缺陷汇总",
    "From": "来自",
    "Instructions and tools": "指令与工具",
    "Next Side Panel Tab": "下一个侧面板标签页",
    "Only stored on your machine.": "仅存储在你的机器上。",
    "Previous Side Panel Tab": "上一个侧面板标签页",
    "Remove from list": "从列表中移除",
    "Search Google Drive": "搜索 Google Drive",
    "Send messages with the keyboard's Enter key instead of starting a new line.": "使用键盘的 Enter 键发送消息，而不是另起一行。",
    "Toggle Maximize Side Panel": "切换最大化侧面板",
    "Toggle Side Panel": "切换侧面板",
    "Untitled": "未命名",
    "What should it do?": "它应该做什么？",
    "What should the agent do on each run?": "智能体每次运行时应该做什么？",
    "When": "时间",
    "Where": "位置",
        // ===== 2.29.1 置顶对话排序与选中文本引用气泡 =====
    "Sort by": "排序方式",
    "Last updated": "最近更新",
    "Custom order": "自定义排序",
    "Quote": "引用",
    "Quote Ctrl+L": "引用 Ctrl+L",
    "Quote Cmd+L": "引用 Cmd+L",
        // ===== 2.29.1 扩展市场货架分类与描述深度汉化 =====
    "Design, Creative & Media": "设计、创意与媒体",
    "Design, creative, and media tools.": "设计、创意与媒体工具。",
    "Productivity & Project Management": "生产力与项目管理",
    "Plan work, track issues, sign documents, and manage your notes and files.": "规划工作、跟踪事务、签署文档并管理笔记与文件。",
    "Cloud Hosting & Deployment": "云托管与部署",
    "Deploy and host your apps, sites, and their backends.": "部署并托管你的应用程序、网站及其后端服务。",
    "Developer Tools": "开发者工具",
    "Developer 工具": "开发者工具",
    "APIs, services, and tools to build, test, secure, and run your apps.": "用于构建、测试、保护和运行应用程序的 API、服务与工具。",
    "Business": "商业与商务",
    "Payments, CRM, accounting, data, identity, customer support, marketing, and workflow automation.": "支付、CRM、记账、数据、身份识别、客户支持、营销和工作流自动化。",
        // ===== 2.29.1 扩展市场搜索框、第三方隐私声明与自动化空状态 =====
    "No automations yet": "暂无自动化",
    "No 自动化 yet": "暂无自动化",
    "Run a prompt on a schedule, like a morning summary of yesterday's changes. Runs show up here.": "按计划定时运行提示词，例如每天早晨汇总昨天的更改。运行记录将显示在此处。",
    "Runs show up here.": "运行记录将显示在此处。",
    "Google does not control the availability or functionality of third party developer tools. Your data from third party developer tools connected to your Antigravity instance may be shared with Google. Google will protect any such data in accordance with the Google Privacy Policy, found here:": "Google 不控制第三方开发者工具的可用性或功能。连接到你的 Antigravity 实例的第三方开发者工具数据可能会与 Google 共享。Google 将根据 Google 隐私权政策保护此类数据，详情请参阅：",
    "Google does not control the availability or functionality of third party developer tools. Your data from third party developer tools connected to your Antigravity instance may be shared with Google. Google will protect any such data in accordance with the Google Privacy Policy, found here": "Google 不控制第三方开发者工具的可用性或功能。连接到你的 Antigravity 实例的第三方开发者工具数据可能会与 Google 共享。Google 将根据 Google 隐私权政策保护此类数据，详情请参阅",
    // ===== 2.29.1 扩展市场全量插件、提示词与生态卡片汉化 (Marketplace & Plugins) =====
    "Split Conversation": "拆分对话",
    "Stop Agent": "停止智能体",
    // ===== 2.30.0 设置面板新增界面布局、对话布局、快捷键搜索与浏览器规则 =====
    "Interface Layout": "界面布局",
    "Knowledge Work": "知识工作",
    "Simplified interface for research, writing, and everyday tasks.": "专为调研、写作和日常任务打造的精简界面。",
    "Software Engineering": "软件工程",
    "Full interface for coding, developer tools, and managing agents.": "涵盖编程、开发者工具与智能体管理的完整界面。",
    "Chat Layout": "对话布局",
    "Fill": "铺满",
    "Search shortcuts...": "搜索快捷键...",
    "Search shortcuts": "搜索快捷键",
    "search shortcuts...": "搜索快捷键...",
    "search shortcuts": "搜索快捷键",
    "搜索 shortcuts...": "搜索快捷键...",
    "搜索 shortcuts": "搜索快捷键",
    "Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires Google Chrome.": "配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 Google Chrome。",
    "Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires Google Chrome": "配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 Google Chrome",
    "Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires ": "配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 ",
    "Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires": "配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要",
    "Configure allowed and denied URLs for the browser subagent (invoked with /browser).": "配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。",
    "Requires Google Chrome.": "需要 Google Chrome。",
    "Requires Google Chrome": "需要 Google Chrome",
    // ===== 2.30.0 语音模式选择与左侧过滤菜单 =====
    "Auto Pin": "自动置顶",
    "Auto pin": "自动置顶",
    "auto pin": "自动置顶",
    "Choose Antigravity's Voice": "选择 Antigravity 的声音",
    "Choose Antigravity's voice": "选择 Antigravity 的声音",
    "Choose Antigravity Voice": "选择 Antigravity 的声音",
    "Clear and friendly": "清晰友好",
    "Clear and friendly.": "清晰友好。",
    "清除 and friendly": "清晰友好",
    "清除 and friendly.": "清晰友好。",
    "Calm and gentle": "沉稳温和",
    "Warm and expressive": "温暖生动",
    "Bright and clear": "明朗清晰",
    "Deep and resonant": "深沉浑厚",
    "Soft and soothing": "柔和舒缓",
    "Engaged and lively": "专注生动",
    "Energetic and upbeat": "元气活力",
    "Smooth and easygoing": "流畅自然",
    "Calm, mid-range": "沉稳，中频音色",
    "Calm, mid-range voice": "沉稳，中频音色",
    "Engaged, deeper voice": "专注，低沉音色",
    "Engaged, mid-range voice": "专注，中频音色",
    "Google does not control the availability or functionality of third party developer tools. Your data from third party developer tools connected to your Antigravity instance may be shared with Google. Google will protect any such data in accordance with the Google Privacy Policy, found here: https://policies.google.com/privacy": "Google 不控制第三方开发者工具的可用性或功能。连接到你的 Antigravity 实例的第三方开发者工具数据可能会与 Google 共享。Google 将根据 Google 隐私权政策保护此类数据，详情请参阅：https://policies.google.com/privacy",
    "Browse other marketplace customizations": "浏览其他市场自定义项",
    "What's included": "包含内容",
    "What's Included": "包含内容",
    "MCP server": "MCP 服务器",
    "Example Prompts": "示例提示词",
    "Example prompts": "示例提示词",
    "Routing Rules": "路由规则",
    "Plugin in Action": "插件实战",
    "Network, Sandbox, and Permission Requirements": "网络、沙箱与权限要求",
    "1. Required Outbound URL Allowlist": "1. 必需的出站 URL 白名单",
    "2. Required Terminal Command Permissions": "2. 必需的终端命令权限",
    "Antigravity manifest": "Antigravity 清单",
    "Plugin icon": "插件图标",
    "Notion plugin for Antigravity": "Antigravity 的 Notion 插件",
    "Connects Google Antigravity to the Notion MCP server and adds the MCP client skills.": "将 Google Antigravity 连接到 Notion MCP 服务器并添加 MCP 客户端技能。",
    "The first Notion tool call opens a browser window to authorize your workspace.": "首次调用 Notion 工具时会打开浏览器窗口以授权你的工作区。",
    "Notion MCP server at https://mcp.notion.com/mcp (OAuth)": "位于 https://mcp.notion.com/mcp 的 Notion MCP 服务器（OAuth）",
    "Generated from skills/mcp-clients/. Do not edit.": "生成自 skills/mcp-clients/。请勿直接编辑。",
    "Edit skills in skills/mcp-clients/": "在 skills/mcp-clients/ 中编辑技能",
    "Set up Notion so you can use my workspace as context": "配置 Notion，以便你可以将我的工作区作为上下文使用",
    "Turn this spec in Notion into an implementation plan with tasks": "将 Notion 中的这份规范转换为带有具体任务的实施计划",
    "Write a weekly update for my project from what changed in Notion": "根据 Notion 中的变动为我的项目撰写每周更新报告",
    "Create a PySpark notebook to train a distributed Random Forest model on the BigQuery table my_transactions": "创建一个 PySpark 笔记本，在 BigQuery 表 my_transactions 上训练分布式随机森林模型",
    "Find datasets about customer orders in Knowledge Catalog and show their lineage": "在 Knowledge Catalog 中查找有关客户订单的数据集并展示其血缘关系",
    "My last Dataflow job failed. Find the root cause in the logs and propose a fix": "我上一个 Dataflow 作业失败了。在日志中查找根本原因并提出修复建议",
    "Summarize this design doc and list the open questions": "总结这份设计文档并列出待决问题",
    "Draft a launch announcement in a new doc from my notes": "根据我的笔记在新建文档中起草一份发布公告",
    "Reply to the open comments on my doc and resolve them": "回复我文档中的待决批注并解决它们",
    "Find last quarter's budget and share it with Alex": "查找上季度的预算表并分享给 Alex",
    "Move this week's design exports into the Launch folder": "将本周导出的设计稿移动到 Launch 文件夹中",
    "Download the Q3 report as a PDF": "将第三季度报告下载为 PDF",
    "Build a stateful multi-turn chat script using the Interactions API and the latest models": "使用 Interactions API 与最新模型构建有状态多轮对话脚本",
    "Create a real-time voice agent using the Gemini Live API and non-blocking function calling": "使用 Gemini Live API 和非阻塞函数调用创建实时语音智能体",
    "Migrate my project from client.models.generate_content to the Interactions API": "将我的项目从 client.models.generate_content 迁移至 Interactions API",
    "Help me set up a new Google Cloud project, link billing, and configure local authentication.": "帮我设置一个新的 Google Cloud 项目，关联结算并配置本地身份验证。",
    "Configure Application Default Credentials (ADC) and IAM permissions for my local development environment.": "为我的本地开发环境配置应用默认凭据 (ADC) 和 IAM 权限。",
    "Search official Google Cloud documentation using Developer Knowledge and validate my gcloud CLI commands.": "使用 Developer Knowledge 检索官方 Google Cloud 文档并验证我的 gcloud CLI 命令。",
    "Search and retrieve official documentation across Google Cloud, Gemini, Android, Firebase, Flutter, and Web. Requires Google Cloud credentials (ADC) or an API key.": "检索 Google Cloud、Gemini、Android、Firebase、Flutter 与 Web 的官方文档。需要 Google Cloud 凭据 (ADC) 或 API 密钥。",
    "Google Cloud guidance for coding agents: first-project onboarding, authentication and credential selection, and safety-critical validation for gcloud CLI commands. Includes the Google Developer Knowledge MCP server for grounded, up-to-date Google Cloud documentation.": "面向编码智能体的 Google Cloud 指南：新手项目上手、身份验证与凭据选择，以及针对 gcloud CLI 命令的高安全性校验。内置 Google Developer Knowledge MCP 服务器，提供权威、最新的一手 Google Cloud 文档。",
    "Connect to your managed Looker MCP server to explore data, run saved Looks, build dashboards, and validate LookML.": "连接到你的托管 Looker MCP 服务器以探索数据、运行保存的 Look、构建仪表板并验证 LookML。",
    "Accept payments and grow your business. Stripe's official MCP server enables AI agents to manage customers, products, prices, payment links, invoices, subscriptions, and refunds, as well as search Stripe documentation.": "接受在线付款并拓展业务。Stripe 官方 MCP 服务器让 AI 智能体能够管理客户、产品、价格、支付链接、发票、订阅与退款，并能检索 Stripe 官方开发文档。",
    "Add Auth0 authentication to any app: login, MFA, SSO, Organizations, RBAC, custom domains, and branding. Debug auth errors and migrate from other providers.": "为任意应用接入 Auth0 身份验证：登录、多因素认证 (MFA)、单点登录 (SSO)、组织机构管理、基于角色的访问控制 (RBAC)、自定义域名与品牌定制。调试认证错误并支持从其他提供商平滑迁移。",
    "Build and deploy Base44 full-stack apps: CLI project management, JavaScript/TypeScript SDK development, and production troubleshooting skills.": "构建与部署 Base44 全栈应用：提供 CLI 项目管理、JavaScript/TypeScript SDK 开发以及生产环境故障排查技能。",
    "Give your agent a real browser: navigate, click, type, screenshot, and extract data from any site, locally or on Browserbase cloud browsers.": "为你的智能体配备真实浏览器：在本地或 Browserbase 云端浏览器中，对任意网站执行页面导航、点击、输入、截屏并提取数据。",
    "Create, edit, review, resize, and brand-check Canva designs with the Canva MCP server.": "通过 Canva MCP 服务器创建、编辑、审查、调整尺寸并进行品牌一致性校验。",
    "AI-powered code review and review-comment autofix, powered by CodeRabbit.": "由 CodeRabbit 驱动的 AI 智能代码审查与审查意见自动修复工具。",
    "Up-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your LLM context.": "最新文档实时查询。直接从源码仓库提取特定版本的文档与代码示例并注入大模型上下文。",
    "Use the official CrowdStrike-hosted MCP server to work across Falcon: detections, cases, threat intel, SIEM, hosts, vulnerabilities, cloud, and more.": "使用官方 CrowdStrike 托管的 MCP 服务器跨 Falcon 平台协同工作：涵盖威胁检测、安全事件、威胁情报、SIEM、主机、漏洞管理与云安全等。",
    "Databricks skills for the CLI, Apps, Lakebase, Model Serving, Lakeflow Jobs, Spark Declarative Pipelines, Declarative Automation Bundles (DABs), and classic-to-serverless migration.": "Databricks 专属技能集，支持 CLI、Apps、Lakebase、模型服务、Lakeflow 作业、Spark 声明式管道、声明式自动化捆绑包 (DAB) 以及从经典架构向无服务器架构迁移。",
    "Use Datadog directly in Antigravity through a preconfigured Datadog MCP server. Query logs, metrics, traces, dashboards, and more through natural conversation. This plugin is in preview.": "通过预配置的 Datadog MCP 服务器在 Antigravity 中直接使用 Datadog。通过自然语言对话查询日志、指标、链路追踪、仪表板等。该插件目前处于预览阶段。",
    "Connect Antigravity to Dropbox to search, inspect, summarize, share, collect uploads, organize folders, and clean up files with confirmation for write actions.": "将 Antigravity 连接到 Dropbox 以搜索、检查、总结、共享文件、收集上传、整理文件夹并清理文件，写入操作需要确认以保安全。",
    "Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities, via skills and the MCP server.": "利用真实的 Dynatrace 生产数据排查线上故障：通过技能与 MCP 服务器分析问题与根因、查询日志、指标、链路追踪与安全漏洞。",
    "Packaged workflows for SCA remediation, AI SAST triage, CI/CD posture, malware response, findings review, Endor Labs setup, and more.": "开箱即用的安全工作流，支持软件成分分析 (SCA) 修复、AI 静态分析 (SAST) 分流、CI/CD 安全基线态势、恶意软件响应、安全审计结果审查及 Endor Labs 配置等。",
    "Turn Figma designs into production code, map components with Code Connect, and create or edit Figma files in Antigravity.": "将 Figma 设计稿转化为生产级代码，利用 Code Connect 映射组件，并在 Antigravity 中直接创建或编辑 Figma 设计文件。",
    "Build and debug pipelines, manage deployments, investigate security findings, and operate Harness with connected tools and reusable workflow skills.": "构建与调试发布管道、管理应用部署、审查安全检测结果，并通过连接的工具与可复用工作流技能操作 Harness 平台。",
    "Search Intercom conversations, contacts, and companies, spot support trends, and install the Intercom Messenger with secure identity verification.": "搜索 Intercom 对话、联系人与公司信息，发现客户支持趋势，并安装带有安全身份验证的 Intercom Messenger。",
    "Connect your agent to invideo's AI-native video editor. It trims, grades and mixes on a real timeline while you watch every change land.": "将你的智能体连接到 invideo AI 原生视频编辑器。它在真实的时间线上进行裁剪、调色与混音，实时呈现每一次变动的视觉效果。",
    "Search the web and read any page as clean markdown with Keenable, a search engine built for AI agents. Keyless: no signup or API key needed.": "通过专为 AI 智能体打造的 Keenable 搜索引擎搜索网络并将任意网页转换为整洁的 Markdown。免密开箱即用：无需注册或填写 API 密钥。",
    "Ask a question of the live web and get a table back. Keenable SELECT runs many searches, reads the pages and extracts the fields you need in one call. Sign in with a Keenable account.": "对实时网络提问并获得结构化表格返回结果。Keenable SELECT 执行多重检索、解析页面并在单次调用中提取所需字段。需要登录 Keenable 账号。",
    "Create, run and debug Leapwork Play tests and runlists, build agents, and hand work to Play's AI workflows, right from Antigravity.": "在 Antigravity 中直接创建、运行和调试 Leapwork Play 测试与运行列表，构建自动化测试智能体并无缝交接给 Play AI 工作流。",
    "The product development system for teams and agents. Manage issues, projects, and documents across your Linear workspace from Antigravity.": "面向团队与智能体的现代产品研发系统。在 Antigravity 中跨 Linear 工作区统一管理议题、项目与文档。",
    "Give your AI agent 600,000+ real app screens, and the skills to use them. Includes the Mobbin MCP and a skill that redesigns your screen from patterns real apps ship, in your own design system, with the references behind every change.": "为你的 AI 智能体配备 600,000+ 真实应用界面资产及其使用技能。内置 Mobbin MCP，能基于成熟上线应用的设计模式，在你的设计规范下重构界面，并附带每一次改动的参考来源。",
    "Plan and track work in monday.com from Antigravity: create, update and assign items, write docs, and build forms that turn requests into items.": "在 Antigravity 中规划与追踪 monday.com 工作任务：创建、更新与分派工作项，编写文档，并构建能将需求快速转换为任务的表单。",
    "Official Antigravity plugin for MongoDB Atlas (hosted MCP Server + Skills). Connect to the MongoDB-hosted Atlas MCP server, explore data, manage collections, optimize queries, generate reliable code, implement best practices, develop advanced features, and more.": "MongoDB Atlas 官方 Antigravity 插件（托管 MCP 服务器 + 技能）。连接到 MongoDB 官方托管的 Atlas MCP 服务器，探索数据、管理集合、优化查询、生成高可靠代码、践行最佳实践并开发高级特性。",
    "Agent skills for Neo4j graph database — write Cypher queries, design graph models, use drivers, run imports, build GraphRAG pipelines, run GDS algorithms, and manage Aura instances.": "Neo4j 图数据库智能体技能——编写 Cypher 查询、设计图谱模型、调用驱动、执行数据导入、构建 GraphRAG 管道、运行图数据科学 (GDS) 算法并管理 Aura 云实例。",
    "Build and deploy on Netlify: functions, edge functions, blobs, database, identity, forms, image CDN, caching, and AI Gateway, plus the Netlify MCP server.": "在 Netlify 上构建与部署应用：涵盖函数计算、边缘函数、Blob 存储、数据库、身份认证、表单处理、图像 CDN、缓存优化及 AI Gateway，并内置 Netlify MCP 服务器。",
    "Connect Antigravity to your Notion workspace with the Notion MCP server, plus skills for research, documentation, meeting prep, specs, trackers, and project updates.": "通过 Notion MCP 服务器将 Antigravity 连接到你的 Notion 工作区，并提供用于调研、文档编写、会议准备、产品规范、跟踪器与项目更新的技能。",
    "Create and send proposals, quotes, and contracts for e-signature. Track signing progress and identify documents that need follow-up.": "创建并发送用于电子签名的方案建议书、报价单与合同。实时跟踪签署进度并识别需要跟进的文档。",
    "Search the live web and fetch page content with Parallel's hosted MCP server. Free access with no Parallel account, API key, or Parallel CLI required.": "通过 Parallel 托管的 MCP 服务器搜索实时网络并抓取页面正文内容。免费使用，无需 Parallel 账号、API 密钥或命令行工具。",
    "Agent plugin for PingOne multi-tenant. Includes skills and a remote MCP server that lets AI agents configure and monitor your PingOne environments.": "PingOne 多租户智能体插件。包含技能与远程 MCP 服务器，允许 AI 智能体配置并监控你的 PingOne 身份安全环境。",
    "Equip Antigravity with specialized Postman skills for the complete API lifecycle. Discover, design, test, document, mock, monitor, and improve APIs through agent-friendly, filesystem-first workflows.": "为 Antigravity 配备覆盖 API 全生命周期的专业 Postman 技能。通过对智能体友好且以文件系统优先的工作流发现、设计、测试、编写文档、Mock、监控与持续改进 API。",
    "Set up Qodo, explore code and repository history, review local changes, and resolve pull-request findings directly from Antigravity.": "配置 Qodo，在 Antigravity 中直接探索代码与仓库提交历史、审查本地更改并高效处理 Pull Request 审查意见。",
    "Deploy, configure, monitor, and troubleshoot apps, databases, and infrastructure on Railway from Antigravity with Railway's agent skill and hosted MCP server.": "借助 Railway 智能体技能与托管 MCP 服务器，在 Antigravity 中部署、配置、监控及排查 Railway 上的应用、数据库和基础设施故障。",
    "SEO workflows on live Semrush data: keyword research, site audits, backlinks, competitor, traffic and market analytics, PPC, and AI brand visibility.": "基于实时 Semrush 数据的专业 SEO 工作流：关键词挖掘、网站审计、反向链接分析、竞品与市场流量分析、PPC 广告洞察以及 AI 品牌曝光度分析。",
    "Query your SentinelOne Singularity Console from Antigravity through a self-hosted, read-only Purple AI MCP server. Requires an active console deployment, your console URL, and an API token.": "通过自托管的只读 Purple AI MCP 服务器在 Antigravity 中查询 SentinelOne Singularity 控制台。需要活跃的控制台实例、控制台 URL 与 API Token。",
    "Set up Sentry monitoring, investigate production errors, and configure alerts and releases with expert skills and live context from your Sentry projects.": "配置 Sentry 监控、调查线上生产环境错误，并结合 Sentry 项目的实时上下文配置报警规则与发布版本追踪。",
    "Triage Exabeam New-Scale alerts and cases end to end: gather the evidence, map MITRE, reach a verdict, and record it behind an approval step.": "端到端分流 Exabeam New-Scale 安全警报与事件：收集取证数据、映射 MITRE ATT&CK 框架、得出分析结论并在审批流程后归档记录。",
    "Official Supabase plugin for Antigravity with Supabase skills and MCP access for project management, database work, auth, storage, and Postgres best practices.": "Supabase 官方 Antigravity 插件，提供 Supabase 专业技能与 MCP 访问，涵盖项目管理、数据库操作、身份验证、对象存储与 Postgres 最佳实践。",
    "Make your coding agent a better engineer": "让你的编码智能体成为一名更卓越的工程师。",
    "Official Trello plugin with the Trello MCP server and a skill for boards, lists, cards, checklists, Inbox, and Planner.": "Trello 官方插件，提供 Trello MCP 服务器及用于管理看板、列表、卡片、清单、收件箱与规划器的技能。",
    "Unity's official plugin for Antigravity, with curated skills for game development, monetization, and performance optimization.": "Unity 官方 Antigravity 插件，精选面向游戏开发、商业化变现与性能调优的专属技能。",
    "Build and deploy web apps and AI agents on Vercel with skills for Next.js, AI SDK, and cloud services, plus the official Vercel MCP server.": "在 Vercel 上构建并部署 Web 应用与 AI 智能体，提供 Next.js、AI SDK 与云服务技能，内置官方 Vercel MCP 服务器。",
    "Investigate files, URLs, domains and IP addresses with VirusTotal threat intelligence, analysis and submission recovery.": "利用 VirusTotal 威胁情报、深度分析与样本检测追踪，全面调查可疑文件、URL、域名及 IP 地址安全威胁。",
    "Search and read your Wispr Flow meeting notes, transcripts, scratchpad notes, and calendar events. Read-only access to your own account.": "搜索并阅读你的 Wispr Flow 会议笔记、语音转写文本、速记便签与日历日程。对你的个人账户提供安全的只读访问。",
    "Build Wix apps and headless sites, and manage Wix stores, bookings, CMS and more, with Wix CLI skills and the official Wix MCP server.": "通过 Wix CLI 技能与官方 Wix MCP 服务器构建 Wix 应用与 Headless 网站，轻松管理 Wix 电商商店、预约排期、CMS 内容系统等。",
    "Build, publish, and manage WordPress.com and Jetpack-connected sites. Draft posts, edit blocks, check traffic stats, moderate comments, and manage plugins.": "构建、发布与管理 WordPress.com 及已连接 Jetpack 的站点。起草文章、编辑 Gutenberg 区块、查看访问统计、审核评论并管理插件。",
    "Connect 9,000+ apps to your AI workflow. Discover, enable, and execute Zapier actions and workflows directly from your client.": "将 9,000+ 款应用程序连接到你的 AI 工作流。直接在客户端中发现、启用并执行 Zapier 自动化动作与工作流。",
    "Manage your Bigin CRM from Antigravity: review pipelines, find contacts and deals, log calls, plan follow-ups, and email customers.": "在 Antigravity 中管理你的 Bigin CRM：查看销售管道、查找联系人与商机、记录通话、规划后续跟进并给客户发送电子邮件。",
    "Build on Zoho CRM v8: REST API, Deluge functions, ClientScript, widgets, COQL and connections, with live CRM data through your Zoho MCP server.": "基于 Zoho CRM v8 构建应用：通过 Zoho MCP 服务器访问实时 CRM 数据，操作 REST API、Deluge 函数、ClientScript、小组件、COQL 与集成连接。",
    "Zoho Desk plugin for Antigravity. Review, prioritize, and update Zoho Desk tickets directly from Antigravity through Zoho Desk MCP and includes a Ticket Prioritization Agent for triage and priority updates.": "Zoho Desk 的 Antigravity 插件。通过 Zoho Desk MCP 在 Antigravity 中直接查看、调整优先级并更新工单，并内置用于工单分流与优先级更新的工单定级智能体。",
    "Connect Zoho Projects to Antigravity to turn tasks and issues into working code. Access project context, investigate bugs, and update work items as you develop.": "将 Zoho Projects 连接到 Antigravity，将任务与缺陷直接转化为可运行的代码。在开发过程中无缝获取项目上下文、调查 Bug 并更新工作项状态。",
    "Run Zoho Books from Antigravity: invoicing, bills, banking, journals, projects, items, taxes, customization and automation.": "在 Antigravity 中高效运行 Zoho Books：发票管理、账单、银行对账、日记账、项目核算、商品、税务设置、定制化与财务自动化。",
    "Configure built-in browser, link opening, and browser subagent preferences.": "配置内置浏览器、链接打开方式以及浏览器子智能体偏好设置。",
    "Configure built-in browser, link opening, and browser subagent preferences": "配置内置浏览器、链接打开方式以及浏览器子智能体偏好设置",
    "Manage project folders and settings.": "管理项目文件夹与设置。",
    "Manage project folders and settings": "管理项目文件夹与设置",
    // ===== 2.32.1 远程 SSH 开发与配置 =====
    "Connect to Host...": "连接到主机...",
    "Connect to Host": "连接到主机",
    "Connect to SSH Host...": "连接到 SSH 主机...",
    "Connect to SSH Host": "连接到 SSH 主机",
    "Recent Hosts": "最近的主机",
    "Configure SSH Hosts...": "配置 SSH 主机...",
    "Configure SSH Hosts": "配置 SSH 主机",
    "Add New SSH Host...": "添加新的 SSH 主机...",
    "Remote - SSH": "远程 - SSH",
    "Stop SSH server": "停止 SSH 服务端",
    "Stop Server": "停止服务端",
    "Reconnecting…": "正在重新连接…",
    "Reconnect": "重新连接",
    "SSH Remote": "SSH 远程",
    "SSH Configuration": "SSH 配置",
    "SSH Config": "SSH 配置",
    "SSH config": "SSH 配置",
    "SSH Host": "SSH 主机",
    "SSH hosts": "SSH 主机",
    "Enter an SSH host": "输入 SSH 主机",
    "Choose an SSH config file": "选择 SSH 配置文件",
    "Touch your security key": "请轻触你的安全密钥",

    // ===== 2.32.1 右键菜单子项与分屏补充 =====
    "Replace with New": "替换为新建",
    "Replace with new": "替换为新建",
    "Split Left": "向左分屏",
    "Split Up": "向上分屏",
    "Ask /btw": "通过 /btw 提问",

    // ===== 2.32.1 扩展市场新增与更新插件全量汉化 =====
    // 1. Google Workspace & 官方插件 (Official Plugins)
    "Connect to Google Workspace, including Docs, Sheets, Slides, Drive, Calendar, and Gmail.": "连接到 Google Workspace，包括 Google 文档、表格、幻灯片、云端硬盘、日历和 Gmail。",
    "Search, read, draft, and send emails in Gmail.": "在 Gmail 中搜索、阅读、起草和发送电子邮件。",
    "Summarize my unread emails from today": "总结我今天的未读邮件",
    "Draft a reply to the latest thread about launch readiness": "起草一份关于发布就绪状态最新会话的回复",
    "Find emails with attachments from last week": "查找上周带有附件的电子邮件",
    "Run your Gmail inbox. Search and summarize threads, draft replies, organize labels, and send messages with your approval.": "管理您的 Gmail 收件箱。搜索并总结邮件会话、起草回复、整理标签，并在经您批准后发送邮件。",
    "Read, search, send, and manage Gmail messages, drafts, labels, and emoji reactions using a Go CLI. Use when reading emails, searching inbox, sending messages, reacting to messages with emoji, managing drafts, forwarding, checking vacation responder, managing labels, downloading attachments, or decoding mail.google.com Web UI URLs. Don't use for Google Chat messages or Calendar invites.": "使用 Go CLI 阅读、搜索、发送和管理 Gmail 邮件、草稿、标签和表情反应。用于阅读邮件、搜索收件箱、发送邮件、使用表情回复、管理草稿、转发、检查自动回复设置、管理标签、下载附件或解析 mail.google.com Web UI 网址。请勿用于 Google Chat 消息或日历邀请。",
    "Build applications and shell workflows with the Gemini Interactions API, Decisions API, Live API, and Gemini API CLI, including text, image, video, and speech generation, managed agents, and real-time multimodal streaming.": "借助 Gemini Interactions API、Decisions API、Live API 以及 Gemini API CLI 构建应用程序与终端工作流，涵盖文本、图像、视频和语音生成、托管智能体以及实时多模态流式传输。",
    "Develop ideas with context and review documents with fresh eyes.": "结合上下文深入拓展构想，以全新视角审阅文档。",

    // 2. 合作伙伴插件 (Partners Marketplace Plugins)
    // Arize AX
    "Query Arize AX projects, traces, datasets, and experiments from Antigravity, with skills for tracing, evals, and prompt optimization.": "在 Antigravity 中查询 Arize AX 项目、链路追踪、数据集和实验，提供用于链路追踪、模型评估及提示词优化的专业技能。",
    "List my Arize projects and show recent traces with errors": "列出我的 Arize 项目并显示最近出错的追踪记录",
    "Add Arize tracing to this application": "为此应用程序添加 Arize 链路追踪",
    "Show the prompt version labeled production in my Arize Prompt Hub": "在我的 Arize Prompt Hub 中显示标记为生产环境的提示词版本",

    // Atlassian Teamwork Graph CLI
    "Help me implement [JIRA-123]. Retrieve the requirements, acceptance criteria, and linked design decisions. Inspect this repository and propose an implementation plan before changing code.": "帮我实现 [JIRA-123]。获取需求、验收条件及关联的设计决策。检查此代码仓库，并在修改代码前提出实现计划。",
    "Investigate [JIRA-123] in this repository. Find related bugs, previous fixes, and relevant technical decisions. Recommend a fix and the tests needed to verify it.": "调查此仓库中的 [JIRA-123]。查找相关缺陷、历史修复方案与相关技术决策。提出修复建议及验证所需的测试。",
    "Review my current changes against [JIRA-123] and its linked specification. Flag missed requirements, conflicting decisions, and missing tests.": "根据 [JIRA-123] 及其关联规范审查我当前的更改。标记遗漏的需求、冲突的决策以及缺失的测试。",

    // Better Stack
    "Investigate incidents, check who's on call, and query logs, metrics, traces, errors and RUM in Better Stack. Build dashboards and manage uptime monitors.": "在 Better Stack 中调查事件、查看值班人员并查询日志、指标、追踪、错误与 RUM。构建仪表盘并管理正常运行时间监控器。",
    "Show me all monitors that are currently down.": "显示当前处于离线状态的所有监控器。",
    "Who's on call right now?": "现在谁在值班？",
    "Create a dashboard showing error rates for my API service.": "创建一个显示我 API 服务错误率的仪表盘。",

    // Cloudflare
    "Build, deploy and manage apps on Cloudflare Workers, storage and AI, with platform skills and the Cloudflare API through one MCP server.": "在 Cloudflare Workers、存储与 AI 上构建、部署和管理应用程序，通过单一 MCP 服务器提供平台技能并调用 Cloudflare API。",
    "Deploy this project to Cloudflare Workers": "将此项目部署到 Cloudflare Workers",
    "Which Cloudflare storage fits this app: D1, KV, R2 or Durable Objects?": "哪种 Cloudflare 存储方案最适合此应用：D1、KV、R2 还是 Durable Objects？",
    "List my Cloudflare zones and Workers and flag anything that needs attention": "列出我的 Cloudflare 区域和 Workers，并标出需要注意的事项",

    // CodeRabbit
    "AI-powered code review, review-comment autofix, and repository configuration, powered by CodeRabbit.": "由 CodeRabbit 提供支持的 AI 代码审查、评审意见自动修复以及代码仓库配置。",

    // Context7
    "Up-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your coding agent's context.": "获取最新官方文档。直接将源仓库中特定版本的文档和代码示例提取到编码智能体的上下文中。",
    "How do I set up a proxy in the latest Next.js?": "如何在最新的 Next.js 中配置代理？",
    "Show me how to define relations in Prisma": "向我展示如何在 Prisma 中定义关联关系",
    "What are the Supabase auth methods?": "Supabase 都有哪些身份验证方法？",

    // Grafana Cloud
    "Query Grafana Cloud metrics, logs, traces and profiles, manage dashboards, alerts and incidents, and ask Grafana Assistant through the hosted MCP server.": "查询 Grafana Cloud 指标、日志、追踪与性能剖析数据，管理仪表盘、告警和突发事件，并通过托管的 MCP 服务器向 Grafana Assistant 提问。",
    "Ask Grafana Assistant why checkout latency is spiking right now": "向 Grafana Assistant 询问为何结账延迟此时出现激增",
    "Investigate errors from the latest deployment": "排查最近一次部署出现的错误",
    "Summarize active incidents and related alerts": "汇总进行中的突发事件和相关告警",

    // Granola
    "The AI notepad for meetings. Connect to your meeting history and use your conversation context to get things done.": "专为会议打造的 AI 记事本。连接您的会议历史，借助对话上下文高效完成各项任务。",
    "What did we decide in my meetings this week?": "我们本周的会议上都做出了哪些决定？",
    "What action items came out of my last meeting?": "我上次会议产生了哪些待办行动项？",
    "Summarize what my team discussed about this project": "总结我的团队关于该项目讨论的内容",

    // incident.io
    "Respond to and investigate incidents, manage on-call schedules and escalations, and write runbooks and skills. Bundles the official incident.io MCP server.": "响应与调查突发事件、管理值班排班与升级策略，并编写运维手册与技能。捆绑官方 incident.io MCP 服务器。",
    "Run the extensions skill": "运行扩展技能",
    "What incidents are open right now?": "当前有哪些未关闭的突发事件？",
    "Who's on call this week?": "本周谁值班？",

    // Levels.fyi
    "Real salaries and company levels from Levels.fyi: check if an offer is fair, compare offers, find jobs with pay shown and add your own salary.": "来自 Levels.fyi 的真实薪资与职级体系：评估 Offer 是否公允、对比多份 Offer、寻找标明薪资的职位并提交您的薪酬数据。",
    "I'm a Google L5 in Seattle making $190k base and $120k stock a year. Am I underpaid?": "我是西雅图的 Google L5，底薪 19 万美元，股票每年 12 万美元。我的薪酬偏低吗？",
    "I have a Stripe offer: $210k base, $400k RSUs over 4 years. Is it good?": "我拿到了 Stripe 的 Offer：底薪 21 万美元，4 年 40 万美元 RSU。这个待遇好吗？",
    "Find remote product manager jobs that pay at least $200k base.": "寻找底薪至少 20 万美元的远程产品经理职位。",

    // SonarQube
    "SonarQube is the AI code quality and security verification platform used by millions of developers to catch bugs, vulnerabilities, and leaked secrets. This plugin enforces those standards in the agent coding loop: 7,500+ distinct issue types, secrets scanning, agentic analysis, and quality gates across 40+ languages.": "SonarQube 是受到数百万开发者信赖的 AI 代码质量与安全校验平台，用于捕获缺陷、漏洞与泄露的机密。该插件在智能体编码闭环中强制执行这些标准：涵盖 40 多种语言的 7,500+ 种问题类型、机密扫描、智能分析与质量门禁。",

    // Spacefast
    "Turn an idea into a website, dashboard, report, or small web tool you can share. Build it in chat or bring your own work, and publish it with Spacefast.": "将灵感转化为可分享的网站、仪表盘、报告或轻量级 Web 工具。在对话中直接构建或导入现有成果，并使用 Spacefast 一键发布。",
    "Build a website for my project and publish it on Spacefast.": "为我的项目构建一个网站并在 Spacefast 上发布。",
    "Publish this dashboard and give me a link to share.": "发布此仪表盘并提供分享链接。",
    "Update the content and design of my existing Spacefast site.": "更新我现有的 Spacefast 网站内容与设计。",

    // Tavily
    "Web search, content extraction, website crawling, URL discovery, and deep research for Antigravity via Tavily's hosted MCP server and skills.": "通过 Tavily 托管的 MCP 服务器和技能，为 Antigravity 提供网络搜索、内容提取、网站抓取、URL 发现与深度调研能力。",
    "Find key decision-makers at [company] and summarize their professional backgrounds.": "查找 [公司] 的核心决策者并总结他们的职业背景。",
    "Research [company], including its products, competitors, and latest news.": "调研 [公司]，包括其产品、竞品及最新动态。",
    "Find the latest documentation and code examples for integrating [API or library] into my project.": "查找将 [API 或库] 集成到我项目中的最新文档与代码示例。",
  };

  const coreWords = {
    "create": "创建", "delete": "删除", "new": "新建", "edit": "编辑", "save": "保存", "cancel": "取消", "confirm": "确认", "copy": "复制",
    "close": "关闭", "open": "打开", "stop": "停止", "start": "启动", "add": "添加", "remove": "移除",
    "update": "更新", "select": "选择", "clear": "清除", "search": "搜索", "find": "查找", "view": "查看", "show": "显示", "hide": "隐藏",
    "agent": "智能体", "agents": "智能体", "subagent": "子智能体", "subagents": "子智能体", "task": "任务", "tasks": "任务",
    "automation": "自动化", "automations": "自动化",
    "workspace": "工作区", "workspaces": "工作区", "project": "项目", "projects": "项目", "directory": "目录", "folder": "文件夹", "file": "文件", "files": "文件",
    "command": "命令", "commands": "命令", "palette": "面板", "terminal": "终端", "console": "控制台", "output": "输出", "input": "输入", "remote": "远程", "control": "控制", "device": "设备", "devices": "设备", "link": "链接",
    "log": "日志", "logs": "日志", "setting": "设置", "settings": "设置", "preference": "偏好", "preferences": "偏好", "permission": "权限", "permissions": "权限",
    "theme": "主题", "themes": "主题", "model": "模型", "models": "模型", "capability": "能力", "capabilities": "能力",
    "run": "运行", "ran": "已运行", "running": "运行中", "completed": "已完成", "failed": "已失败", "pending": "等待中", "success": "成功", "error": "错误",
    "system": "系统", "prompt": "提示词", "instructions": "指令", "description": "描述", "name": "名称", "version": "版本",
    "active": "活跃", "background": "后台", "parent": "父级", "child": "子级", "branch": "分支", "share": "共享", "inherit": "继承",
    "original": "原始", "backup": "备份", "duration": "持续时间", "seconds": "秒", "timer": "定时器", "timers": "定时器",
    "schedule": "调度", "cron": "定时任务", "tools": "工具", "tool": "工具", "execute": "执行", "execution": "执行", "plan": "计划",
    "policy": "策略", "policies": "策略", "never": "从不", "always": "总是",
    "changed": "已更改", "review": "审核", "reviewing": "审核中", "reviewed": "已审核",
    "canceled": "已取消",
    "explore": "探索", "search": "搜索", "change": "更改", "changes": "更改",
    "turn": "回合", "turns": "回合",
    "analyzed": "分析", "analyzing": "分析",
    "advanced": "高级", "collapse": "折叠", "expand": "展开",
    "global": "全局", "inherits": "继承",
    "wsl": "WSL", "distro": "发行版", "distros": "发行版"
  };

  const combinedDict = Object.assign({}, coreWords, dictionary);
  // 性能优化 1：预先构建全小写字典 Map，将未命中小写查找由 O(N) 降低为 O(1)
  const lowerDictionary = new Map();
  for (const k in dictionary) {
    const lk = k.toLowerCase();
    if (!lowerDictionary.has(lk)) {
      lowerDictionary.set(lk, dictionary[k]);
    }
  }

  const stringCache = new Map();
  const MAX_STRING_CACHE = 5000;

  const escapeRegExp = (str) => {
    const specials = ['[', ']', '(', ')', '{', '}', '*', '+', '?', '.', '^', '$', '|', '\\\\'];
    return str.split('').map(c => specials.includes(c) ? '\\\\' + c : c).join('');
  };

  // 性能优化 4：启动阶段一次性预编译单次联合分词正则，彻底消灭运行时 80 次循环迭代正则匹配
  const sortedCoreKeys = Object.keys(coreWords)
    .sort((a, b) => b.length - a.length)
    .filter(w => w.length > 2 || /^[a-zA-Z0-9]+$/.test(w));
  const escapedCoreUnion = sortedCoreKeys.map(w => escapeRegExp(w)).join('|');
  const CORE_WORDS_UNION_REGEX = new RegExp('\\\\b(' + escapedCoreUnion + ')\\\\b', 'gi');

  function translateString(text) {
    if (!text) return text;
    const trimmed = text.trim();
    if (!trimmed) return text;

    // 性能优化 2：极速短路。若文本完全不包含任何英文字母（纯中文/纯数字/纯标点），绝对无需查英文词典或跑正则，瞬间原样返回
    if (!/[a-zA-Z]/.test(trimmed)) {
      return text;
    }

    // 0. 极速缓存查询（O(1) 命中瞬间返回）
    if (stringCache.has(trimmed)) {
      return text.replace(trimmed, stringCache.get(trimmed));
    }

        // ===== 2.29.1 对话区选中文本浮动引用按钮（自适应快捷键） =====
    if (/^Quote(?:\s+(Ctrl\+[a-zA-Z0-9]+|Cmd\+[a-zA-Z0-9]+))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Quote(?:\s+(Ctrl\+[a-zA-Z0-9]+|Cmd\+[a-zA-Z0-9]+))?$/i, (match, shortcut) => {
        return shortcut ? ('引用 ' + shortcut.toUpperCase().replace('CTRL', 'Ctrl').replace('CMD', 'Cmd')) : '引用';
      });
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.32.1 对话区选中文本浮动提问按钮 (Ask /btw) =====
    if (/^Ask(?:\\s+|\\s*\\/\\s*)btw(?:\\s+(Ctrl\\+[a-zA-Z0-9]+|Cmd\\+[a-zA-Z0-9]+))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ask(?:\\s+|\\s*\\/\\s*)btw(?:\\s+(Ctrl\\+[a-zA-Z0-9]+|Cmd\\+[a-zA-Z0-9]+))?$/i, (match, shortcut) => {
        return shortcut ? ('通过 /btw 提问 ' + shortcut.toUpperCase().replace('CTRL', 'Ctrl').replace('CMD', 'Cmd')) : '通过 /btw 提问';
      });
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.29.1 置顶对话排序菜单动态双重保障 =====
    if (/^(?:Sort By|Sort by)$/i.test(trimmed)) {
      const fixed = '排序方式';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Last Updated|Last updated)$/i.test(trimmed)) {
      const fixed = '最近更新';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Custom Order|Custom order)$/i.test(trimmed)) {
      const fixed = '自定义排序';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

        // ===== 2.29.1 扩展市场分类货架与描述动态双重保障 =====
    if (/^Design,\\s*Creative\\s*&\\s*Media$/i.test(trimmed)) {
      const fixed = '设计、创意与媒体';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Productivity\\s*&\\s*Project\\s*Management$/i.test(trimmed)) {
      const fixed = '生产力与项目管理';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Cloud\\s*Hosting\\s*&\\s*Deployment$/i.test(trimmed)) {
      const fixed = '云托管与部署';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Developer\\s+(?:Tools|工具)$/i.test(trimmed)) {
      const fixed = '开发者工具';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Business$/i.test(trimmed)) {
      const fixed = '商业与商务';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Design,\\s*creative,\\s*and\\s*media\\s*tools[.。]?$/i.test(trimmed)) {
      const fixed = '设计、创意与媒体工具。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Plan\\s*work,\\s*track\\s*issues,\\s*sign\\s*documents,\\s*and\\s*manage\\s*your\\s*notes\\s*and\\s*files[.。]?$/i.test(trimmed)) {
      const fixed = '规划工作、跟踪事务、签署文档并管理笔记与文件。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Deploy\\s*and\\s*host\\s*your\\s*apps,\\s*sites,\\s*and\\s*their\\s*backends[.。]?$/i.test(trimmed)) {
      const fixed = '部署并托管你的应用程序、网站及其后端服务。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^APIs,\\s*services,\\s*and\\s*tools\\s*to\\s*build,\\s*test,\\s*secure,\\s*and\\s*run\\s*your\\s*apps[.。]?$/i.test(trimmed)) {
      const fixed = '用于构建、测试、保护和运行应用程序的 API、服务与工具。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Payments,\\s*CRM,\\s*accounting,\\s*data,\\s*identity,\\s*customer\\s*support,\\s*marketing,\\s*and\\s*workflow\\s*automation[.。]?$/i.test(trimmed)) {
      const fixed = '支付、CRM、记账、数据、身份识别、客户支持、营销和工作流自动化。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

        // ===== 2.29.1+ 自动化面板空状态与第三方免责声明动态双重保障 =====
    if (/^No\\s+(?:automations?|自动化)\\s+yet$/i.test(trimmed)) {
      const fixed = '暂无自动化';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Run a prompt on a schedule, like a morning summary of yesterday's changes\\.\\s*Runs show up here[.。]?$/i.test(trimmed)) {
      const fixed = '按计划定时运行提示词，例如每天早晨汇总昨天的更改。运行记录将显示在此处。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Google does not control the availability or functionality of third party developer tools\\./i.test(trimmed)) {
      const fixed = 'Google 不控制第三方开发者工具的可用性或功能。连接到你的 Antigravity 实例的第三方开发者工具数据可能会与 Google 共享。Google 将根据 Google 隐私权政策保护此类数据，详情请参阅：';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.30.0 扩展市场搜索框占位符动态双重保障 =====
    if (/^Search customizations\\.{0,3}$/i.test(trimmed)) {
      const fixed = '搜索自定义项...';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.30.0 设置面板新增动态双重保障 (界面布局/对话布局/快捷键搜索/浏览器规则) =====
    if (/^Interface\\s+Layout$/i.test(trimmed)) {
      const fixed = '界面布局';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Knowledge\\s+Work$/i.test(trimmed)) {
      const fixed = '知识工作';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Software\\s+Engineering$/i.test(trimmed)) {
      const fixed = '软件工程';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Simplified\\s+interface\\s+for\\s+research,\\s*writing,\\s*and\\s+everyday\\s+tasks[.。]?$/i.test(trimmed)) {
      const fixed = '专为调研、写作和日常任务打造的精简界面。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Full\\s+interface\\s+for\\s+coding,\\s*developer\\s+tools,\\s*and\\s+managing\\s+agents[.。]?$/i.test(trimmed)) {
      const fixed = '涵盖编程、开发者工具与智能体管理的完整界面。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Chat\\s+Layout$/i.test(trimmed)) {
      const fixed = '对话布局';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Fill$/i.test(trimmed)) {
      const fixed = '铺满';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Search|搜索)\\s+shortcuts\\.{0,3}$/i.test(trimmed)) {
      const fixed = '搜索快捷键...';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Configure\\s+allowed\\s+and\\s+denied\\s+URLs\\s+for\\s+the\\s+browser\\s+subagent/i.test(trimmed)) {
      const fixed = trimmed.includes('Google Chrome')
        ? '配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 Google Chrome。'
        : '配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 ';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.30.0 语音选择器与过滤菜单动态保障 =====
    if (/^Auto\\s+Pin$/i.test(trimmed)) {
      const fixed = '自动置顶';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Choose\\s+Antigravity(?:'s)?\\s+Voice$/i.test(trimmed)) {
      const fixed = '选择 Antigravity 的声音';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Use\\s+([A-Za-z0-9_-]+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Use\\s+([A-Za-z0-9_-]+)$/i, '使用 $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Clear|清除)\\s+and\\s+friendly[.。]?$/i.test(trimmed)) {
      const fixed = '清晰友好';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.31.2 设置面板与项目管理深度补漏动态保障 =====
    if (/^Configure built-in browser, link opening, and browser subagent preferences[.。]?$/i.test(trimmed)) {
      const fixed = '配置内置浏览器、链接打开方式以及浏览器子智能体偏好设置。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Manage project folders and settings[.。]?$/i.test(trimmed)) {
      const fixed = '管理项目文件夹与设置。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/\\bModified\\s+in\\s+([a-zA-Z0-9_\\-\\/\\.]+)/i.test(trimmed)) {
      const fixed = trimmed.replace(/\\bModified\\s+in\\s+([a-zA-Z0-9_\\-\\/\\.]+)/gi, '已在 $1 中修改');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Permanently delete|永久删除)\\s+(.+?)\\s+(?:including|包括|包含)\\s+(\\d+)\\s+active\\s+conversations?\\s+and\\s+(\\d+)\\s+archived\\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:Permanently delete|永久删除)\\s+(.+?)\\s+(?:including|包括|包含)\\s+(\\d+)\\s+active\\s+conversations?\\s+and\\s+(\\d+)\\s+archived\\s+conversations?([.。]?)$/i, '永久删除 $1，包含 $2 个活跃对话与 $3 个已归档对话。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Permanently delete|永久删除)\\s+(.+?)\\s+(?:including|包括|包含)\\s+(\\d+)\\s+active\\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:Permanently delete|永久删除)\\s+(.+?)\\s+(?:including|包括|包含)\\s+(\\d+)\\s+active\\s+conversations?([.。]?)$/i, '永久删除 $1，包含 $2 个活跃对话。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Permanently delete|永久删除)\\s+(.+?)\\s+(?:including|包括|包含)\\s+(\\d+)\\s+archived\\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:Permanently delete|永久删除)\\s+(.+?)\\s+(?:including|包括|包含)\\s+(\\d+)\\s+archived\\s+conversations?([.。]?)$/i, '永久删除 $1，包含 $2 个已归档对话。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:(?:including|包括|包含)\\s+)?(\\d+)\\s+active\\s+conversations?\\s+and\\s+(\\d+)\\s+archived\\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:(?:including|包括|包含)\\s+)?(\\d+)\\s+active\\s+conversations?\\s+and\\s+(\\d+)\\s+archived\\s+conversations?([.。]?)$/i, '包含 $1 个活跃对话与 $2 个已归档对话。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(\\d+)\\s+active\\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\\d+)\\s+active\\s+conversations?([.。]?)$/i, '$1 个活跃对话。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(\\d+)\\s+archived\\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\\d+)\\s+archived\\s+conversations?([.。]?)$/i, '$1 个已归档对话。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.32.1 远程 SSH 交互与状态动态保障 =====
    if (/^Reconnecting to (.+?)[.…⋯]?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Reconnecting to (.+?)[.…⋯]?$/i, '正在重新连接到 $1…');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Disconnected from (.+?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Disconnected from (.+?)$/i, '已断开与 $1 的连接');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Agents keep running on (.+?)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Agents keep running on (.+?)\.?$/i, '智能体将在 $1 上继续运行。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Agents keep running on (.+?) unless its server stopped\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Agents keep running on (.+?) unless its server stopped\.?$/i, '智能体将在 $1 上继续运行（除非其服务端已停止）。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.32.1 Google Workspace 与插件生态动态兼容 =====
    if (/^Connect to Google Workspace, including Docs, Sheets, Slides, Drive, Calendar(?:, and Gmail)?[.…⋯]?$/i.test(trimmed)) {
      const fixed = '连接到 Google Workspace，包括 Google 文档、表格、幻灯片、云端硬盘、日历' + (trimmed.includes('Gmail') ? '和 Gmail。' : '。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Stop the Antigravity server on (.+?)\?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Stop the Antigravity server on (.+?)\?$/i, '停止 $1 上的 Antigravity 服务端？');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Not connected to (.+?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Not connected to (.+?)$/i, '未连接到 $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.29.1 扩展市场通用模式匹配 =====
    if (/^(.+)\\s+plugin for Antigravity$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+)\\s+plugin for Antigravity$/i, 'Antigravity 的 $1 插件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^The first (.+) tool call opens a browser window to authorize your workspace[.。]?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^The first (.+) tool call opens a browser window to authorize your workspace[.。]?$/i, '首次调用 $1 工具时会打开浏览器窗口以授权你的工作区。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (trimmed.startsWith("Teamwork Graph CLI is Atlassian's agent-first interface")) {
      const fixed = "Teamwork Graph CLI 是 Atlassian 专为智能体打造的工作上下文接口：汇集 Jira 议题、Confluence 页面、Bitbucket PR 以及连接的第三方数据源。专为 Antigravity 等编码智能体量身定制，由 Atlassian 上下文图谱驱动。试试说：“根据此 PR 起草一个 Jira issue 并关联到史诗”。安装后运行 /twg-setup 将 Atlassian Teamwork Graph CLI 连接到 Antigravity。";
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 2.21.0 专属动态模式匹配与防御 =====
    // Customizations 扩展市场与已安装动态模式
    if (/^See\\s+(\\d+)\\s+more$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^See\\s+(\\d+)\\s+more$/i, '查看其余 $1 项');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^See\\s+less$/i.test(trimmed)) {
      const fixed = '收起';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^See\\s+more\\s+in\\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^See\\s+more\\s+in\\s+(.+)$/i, '在“$1”中查看更多');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Install\\s+(.+)$/i.test(trimmed)) {
      const target = trimmed.replace(/^Install\\s+/i, '');
      const translatedTarget = translateString(target);
      const fixed = '安装 ' + translatedTarget;
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Uninstall\\s+(.+)$/i.test(trimmed)) {
      const target = trimmed.replace(/^Uninstall\\s+/i, '');
      const translatedTarget = translateString(target);
      const fixed = '卸载 ' + translatedTarget;
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(\\d+)\\s+(?:tools?|工具)\\s+enabled$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\\d+)\\s+(?:tools?|工具)\\s+enabled$/i, '已启用 $1 个工具');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Custom Agents|Custom 智能体|custom agents)$/i.test(trimmed)) {
      const fixed = '自定义智能体';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Skills\\s*&\\s*Rules|skills\\s*&\\s*rules)$/i.test(trimmed)) {
      const fixed = '技能与规则';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Built In|Built-in|built in)$/i.test(trimmed)) {
      const fixed = '内置';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Loading plugin[.…]*$/i.test(trimmed)) {
      const fixed = '正在加载插件...';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 显示选项与筛选子菜单动态防御 =====
    if (/^(?:Last 提示词|Last Prompt|Last prompt)$/i.test(trimmed)) {
      const fixed = '最新提示词';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Sort Conversations|Sort conversations|sort conversations)$/i.test(trimmed)) {
      const fixed = '对话排序';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Archived Only|Archived only|archived only)$/i.test(trimmed)) {
      const fixed = '仅已归档';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Last\\s+(\\d+)\\s+days?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Last\\s+(\\d+)\\s+days?$/i, '最近 $1 天');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Last\\s+(\\d+)\\s+hours?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Last\\s+(\\d+)\\s+hours?$/i, '最近 $1 小时');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Show\\s+(\\d+)\\s+breakdowns?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Show\\s+(\\d+)\\s+breakdowns?$/i, '显示 $1 项明细');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Hide\\s+breakdowns?$/i.test(trimmed)) {
      const fixed = '隐藏明细';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // ===== 智能体执行标签、工具组与步骤状态动态正则匹配 =====
    // 1. 夹生词清理：Ran 命令 -> 已运行命令
    if (/^Ran\\s+命令$/i.test(trimmed)) {
      const fixed = '已运行命令';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Running\\s+命令$/i.test(trimmed)) {
      const fixed = '正在运行命令';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Ran\\s+命令:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\\s+命令:\\s*(.+)$/i, '已运行命令: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Running\\s+命令:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\\s+命令:\\s*(.+)$/i, '正在运行命令: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Ran\\s+(\\d+)\\s+命令$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\\s+(\\d+)\\s+命令$/i, '已运行 $1 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Running\\s+(\\d+)\\s+命令$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\\s+(\\d+)\\s+命令$/i, '正在运行 $1 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // 执行模式副标题动态匹配
    if (/^Every command requires approval[.。]?$/i.test(trimmed)) {
      const fixed = /[.。]$/.test(trimmed) ? '每条命令都需要审批。' : '每条命令都需要审批';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Ask before sensitive operations[.。]?$/i.test(trimmed)) {
      const fixed = /[.。]$/.test(trimmed) ? '在执行敏感操作前询问。' : '在执行敏感操作前询问';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Run all commands without restrictions[.。]?$/i.test(trimmed)) {
      const fixed = /[.。]$/.test(trimmed) ? '无限制运行所有命令。' : '无限制运行所有命令';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Run all commands in sandbox without restrictions[.。]?$/i.test(trimmed)) {
      const fixed = /[.。]$/.test(trimmed) ? '在沙盒中无限制运行所有命令。' : '在沙盒中无限制运行所有命令';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // 2. 动词三联/复合短语（已完成与进行中）
    if (/^Explored\\s+(\\d+)\\s+files?,\\s*ran\\s+(\\d+)\\s+commands?,\\s*edited\\s+(\\d+)\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const isArt = /artifacts?$/i.test(trimmed);
      const fixed = trimmed.replace(/^Explored\\s+(\\d+)\\s+files?,\\s*ran\\s+(\\d+)\\s+commands?,\\s*edited\\s+(\\d+)\\s+(?:files?|artifacts?)$/i, 
        isArt ? '已探索 $1 个文件，已执行 $2 条命令，已编辑 $3 个工件' : '已探索 $1 个文件，已执行 $2 条命令，已编辑 $3 个文件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Exploring\\s+(\\d+)\\s+files?,\\s*running\\s+(\\d+)\\s+commands?,\\s*editing\\s+(\\d+)\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const isArt = /artifacts?$/i.test(trimmed);
      const fixed = trimmed.replace(/^Exploring\\s+(\\d+)\\s+files?,\\s*running\\s+(\\d+)\\s+commands?,\\s*editing\\s+(\\d+)\\s+(?:files?|artifacts?)$/i, 
        isArt ? '正在探索 $1 个文件，正在运行 $2 条命令，正在编辑 $3 个工件' : '正在探索 $1 个文件，正在运行 $2 条命令，正在编辑 $3 个文件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Explored\\s+files?,\\s*ran\\s+commands?,\\s*edited\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '已探索文件、已执行命令、已编辑工件' : '已探索文件、已执行命令、已编辑文件';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Exploring\\s+files?,\\s*running\\s+commands?,\\s*editing\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '正在探索文件、运行命令、编辑工件' : '正在探索文件、运行命令、编辑文件';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Explored\\s+(\\d+)\\s+files?,\\s*ran\\s+(\\d+)\\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Explored\\s+(\\d+)\\s+files?,\\s*ran\\s+(\\d+)\\s+commands?$/i, '已探索 $1 个文件，已执行 $2 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Exploring\\s+(\\d+)\\s+files?,\\s*running\\s+(\\d+)\\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Exploring\\s+(\\d+)\\s+files?,\\s*running\\s+(\\d+)\\s+commands?$/i, '正在探索 $1 个文件，正在运行 $2 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Explored\\s+files?,\\s*ran\\s+commands?$/i.test(trimmed)) {
      const fixed = '已探索文件，已执行命令';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Exploring\\s+files?,\\s*running\\s+commands?$/i.test(trimmed)) {
      const fixed = '正在探索文件，正在运行命令';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Running\\s+commands?,\\s*editing\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '正在运行命令、编辑工件' : '正在运行命令、编辑文件';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Ran\\s+commands?,\\s*edited\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '已执行命令、已编辑工件' : '已执行命令、已编辑文件';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Explored\\s+files?,\\s*edited\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '已探索文件、已编辑工件' : '已探索文件、已编辑文件';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Exploring\\s+files?,\\s*editing\\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '正在探索文件、编辑工件' : '正在探索文件、编辑文件';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // 3. 统计数字类模式
    if (/^Ran\\s+(\\d+)\\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\\s+(\\d+)\\s+commands?$/i, '已运行 $1 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Running\\s+(\\d+)\\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\\s+(\\d+)\\s+commands?$/i, '正在运行 $1 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Ran\\s+(\\d+)\\s+command$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\\s+(\\d+)\\s+command$/i, '已运行 $1 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Running\\s+(\\d+)\\s+command$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\\s+(\\d+)\\s+command$/i, '正在运行 $1 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Explored\\s+(\\d+)\\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Explored\\s+(\\d+)\\s+files?$/i, '已探索 $1 个文件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Exploring\\s+(\\d+)\\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Exploring\\s+(\\d+)\\s+files?$/i, '正在探索 $1 个文件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Edited\\s+(\\d+)\\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Edited\\s+(\\d+)\\s+files?$/i, '已编辑 $1 个文件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Editing\\s+(\\d+)\\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Editing\\s+(\\d+)\\s+files?$/i, '正在编辑 $1 个文件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Edited\\s+(\\d+)\\s+artifacts?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Edited\\s+(\\d+)\\s+artifacts?$/i, '已编辑 $1 个工件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Editing\\s+(\\d+)\\s+artifacts?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Editing\\s+(\\d+)\\s+artifacts?$/i, '正在编辑 $1 个工件');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // 4. 具体工具步骤行模式
    if (/^Ran\\s+command:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\\s+command:\\s*(.+)$/i, '已运行命令: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Running\\s+command:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\\s+command:\\s*(.+)$/i, '正在运行命令: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Waiting for command completion \\(up to (\\d+) seconds\\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Waiting for command completion \\(up to (\\d+) seconds\\)$/i, '等待命令执行完成（最多 $1 秒）');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Rejected sending (?:termination request|input) to command$/i.test(trimmed)) {
      const isTerm = /termination/i.test(trimmed);
      const fixed = isTerm ? '已拒绝向命令发送终止请求' : '已拒绝向命令发送输入';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Sent (?:termination request|input) to command$/i.test(trimmed)) {
      const isTerm = /termination/i.test(trimmed);
      const fixed = isTerm ? '已向命令发送终止请求' : '已向命令发送输入';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Suggested sending (?:termination request|input) to command$/i.test(trimmed)) {
      const isTerm = /termination/i.test(trimmed);
      const fixed = isTerm ? '建议向命令发送终止请求' : '建议向命令发送输入';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Sending (?:termination request|input) to command$/i.test(trimmed)) {
      const isTerm = /termination/i.test(trimmed);
      const fixed = isTerm ? '正在向命令发送终止请求' : '正在向命令发送输入';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Error sending (?:termination request|input) to command$/i.test(trimmed)) {
      const isTerm = /termination/i.test(trimmed);
      const fixed = isTerm ? '向命令发送终止请求时出错' : '向命令发送输入时出错';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Canceled edit to (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Canceled edit to (.+)$/i, '已取消对 $1 的编辑');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Canceled creation of (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Canceled creation of (.+)$/i, '已取消创建 $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Canceled deletion of (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Canceled deletion of (.+)$/i, '已取消删除 $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Used MCP tool:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Used MCP tool:\\s*(.+)$/i, '调用 MCP 工具: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Used tool:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Used tool:\\s*(.+)$/i, '调用工具: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Generated image:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Generated image:\\s*(.+)$/i, '生成图像: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Browser task:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Browser task:\\s*(.+)$/i, '浏览器任务: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Opened browser:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Opened browser:\\s*(.+)$/i, '已打开浏览器: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Read URL:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Read URL:\\s*(.+)$/i, '读取 URL: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Searched web:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Searched web:\\s*(.+)$/i, '网页搜索: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Invoked subagent:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Invoked subagent:\\s*(.+)$/i, '调用子智能体: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Searched for files:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Searched for files:\\s*(.+)$/i, '搜索文件: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Searched for\\s+"([^"]+)"$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Searched for\\s+"([^"]+)"$/i, '搜索: "$1"');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Code search:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Code search:\\s*(.+)$/i, '代码搜索: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Internal search:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Internal search:\\s*(.+)$/i, '内部搜索: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Listed directory\\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Listed directory\\s+(.+)$/i, '列出目录: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^No more older messages(?:,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^No more older messages(?:,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+))?$/i, (m, a, b) => {
        return a && b ? ('已无更早的历史消息（共显示 ' + a + ' / ' + b + ' 条）') : '已无更早的历史消息';
      });
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Select model,\\s*current:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Select model,\\s*current:\\s*(.+)$/i, '选择模型，当前为: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Opens external link:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Opens external link:\\s*(.+)$/i, '打开外部链接: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Send feedback as\\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Send feedback as\\s+(.+)$/i, '以 $1 身份发送反馈');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Show All|Show all|show all|显示 All)$/i.test(trimmed)) {
      const fixed = '显示全部';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:File Reads|文件 Reads|file reads)$/i.test(trimmed)) {
      const fixed = '文件读取';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:File Writes|文件 Writes|file writes)$/i.test(trimmed)) {
      const fixed = '文件写入';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Project options|项目 options)$/i.test(trimmed)) {
      const fixed = '项目选项';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Agent response|智能体 response)$/i.test(trimmed)) {
      const fixed = '智能体回复';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:View Usage|View usage|view usage|查看 Usage)$/i.test(trimmed)) {
      const fixed = '查看使用额度';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Permanently delete|Permanently 删除)$/i.test(trimmed)) {
      const fixed = '永久删除';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (trimmed.includes('could not be opened')) {
      const replacedCouldNot = trimmed.replace(/could not be opened/gi, '无法打开');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, replacedCouldNot);
      return text.replace(trimmed, replacedCouldNot);
    }

    if (/Scan the code to/i.test(trimmed)) {
      if (/Scan the code to.*,\\s*or\\s*$/i.test(trimmed)) {
        const fixed = '扫描二维码以在远程控制中打开此设备，或';
        if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
        return text.replace(trimmed, fixed);
      }
      if (/Scan the code to.*(?:copy link|复制链接)/i.test(trimmed)) {
        const fixed = '扫描二维码以在远程控制中打开此设备，或复制链接。';
        if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
        return text.replace(trimmed, fixed);
      }
      if (/Scan the code to.*(?:Remote Control|远程\\s*控制)/i.test(trimmed)) {
        const fixed = '扫描二维码以在远程控制中打开此设备';
        if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
        return text.replace(trimmed, fixed);
      }
    }

    if (/Continue your work from another device/i.test(trimmed)) {
      let fixed = '借助远程控制从另一台设备继续工作。请扫描下方二维码或打开下方链接。';
      if (!/Scan the QR code/i.test(trimmed)) {
        fixed = '借助远程控制从另一台设备继续工作。';
      }
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/Scan the QR code or open the link below/i.test(trimmed)) {
      const fixed = '扫描下方二维码或打开下方链接。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Invalid tool call$/i.test(trimmed)) {
      const fixed = '无效的工具调用';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^No Project$/i.test(trimmed)) {
      const fixed = '无项目';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^See all\\s*\\(([^)]+)\\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^See all\\s*\\(([^)]+)\\)$/i, '查看全部 ($1)');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Ran\\s+(\\d+)\\s*(?:commands|命令)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\\s+(\\d+)\\s*(?:commands|命令)$/i, '已运行 $1 条命令');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Load older messages,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Load older messages,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+)$/i, '加载历史消息，正在显示 $1 / $2 条');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Fold lines\\s+([0-9-]+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Fold lines\\s+([0-9-]+)$/i, '折叠第 $1 行');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Advanced\\s*Settings|Advanced\\s*设置|advanced\\s*settings)$/i.test(trimmed)) {
      const fixed = '高级设置';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Collapse\\s*All|Collapse\\s*all|collapse\\s*all)$/i.test(trimmed)) {
      const fixed = '全部折叠';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Expand\\s*All|Expand\\s*all|expand\\s*all)$/i.test(trimmed)) {
      const fixed = '全部展开';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Inherit\\s*Global|Inherits\\s*Global|继承\\s*Global)$/i.test(trimmed)) {
      const fixed = '继承全局';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Inherits\\s+your\\s+Global\\s+Permissions\\s+when\\s+working\\s+in\\s+this\\s+project\\.?$/i.test(trimmed)) {
      const fixed = '在此项目中工作时继承您的全局权限。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Also\\s+includes.*(?:Global\\s+Permissions|全局权限).*when\\s+working\\s+in\\s+this\\s+project/i.test(trimmed)) {
      const fixed = '在当前项目中工作时，亦继承全局权限配置。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Modify permissions for/i.test(trimmed)) {
      const fixed = '修改针对文件系统、终端命令以及 MCP 工具的安全权限。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^(?:Tool[\\s ]+Permissions|工具[\\s ]*Permissions)$/i.test(trimmed)) {
      const fixed = '工具权限';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Setting up WSL:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Setting up WSL:\\s*(.+)$/i, '正在配置 WSL: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Installing into\\s*(.+?)[…\\.]*$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Installing into\\s*(.+?)[…\\.]*$/i, '正在安装到 $1…');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^This folder belongs to the WSL distro "([^"]+)", but this window is connected to "([^"]+)"\\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^This folder belongs to the WSL distro "([^"]+)", but this window is connected to "([^"]+)"\\.?$/i, '此文件夹属于 WSL 发行版“$1”，但当前窗口连接到“$2”。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^This location cannot be opened in WSL:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^This location cannot be opened in WSL:\\s*(.+)$/i, '无法在 WSL 中打开此位置: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^The WSL distro "([^"]+)" is no longer installed\\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^The WSL distro "([^"]+)" is no longer installed\\.?$/i, 'WSL 发行版“$1”已不再安装。');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Antigravity opened on Windows instead\\.?$/i.test(trimmed)) {
      const fixed = 'Antigravity 已改为在 Windows 本地打开。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Connected to WSL:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Connected to WSL:\\s*(.+)$/i, '已连接到 WSL: $1');
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/% of the (?:customization )?budget is (?:available|used)/i.test(trimmed)) {
      let fixed = trimmed;
      if (/^%\\s*of the (?:customization )?budget is available[.。]?$/i.test(trimmed)) {
        fixed = '% 的自定义额度可用。';
      } else if (/^%\\s*of the (?:customization )?budget is used[.。]?$/i.test(trimmed)) {
        fixed = '% 的自定义额度已使用。';
      } else if (/available/i.test(trimmed)) {
        fixed = trimmed.replace(/(\\d+(?:\\.\\d+)?)% of the (?:customization )?budget is available[.。]?/i, '自定义额度尚有 $1% 可用。');
      } else if (/used/i.test(trimmed)) {
        fixed = trimmed.replace(/(\\d+(?:\\.\\d+)?)% of the (?:customization )?budget is used[.。]?/i, '已使用 $1% 的自定义额度。');
      }
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Plugins are packaged collections of/i.test(trimmed)) {
      let fixed = '';
      if (/Google developer products/i.test(trimmed)) {
        if (/change your choices in Settings/i.test(trimmed)) {
          fixed = '插件是技能和 MCP 的打包集合，用于协助 Antigravity 中的智能体使用 Google 开发者产品。你可以随时在设置中更改你的选择。';
        } else {
          fixed = '插件是技能和 MCP 的打包集合，用于协助 Antigravity 中的智能体使用 Google 开发者产品。';
        }
      } else {
        fixed = '插件是技能和 MCP 的打包集合，用于协助智能体在';
      }
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^You can always change your choices in Settings[.。]?$/i.test(trimmed)) {
      const fixed = '你可以随时在设置中更改你的选择。';
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^Antigravity work with Google developer products/i.test(trimmed)) {
      let fixed = 'Antigravity 中协同 Google 开发者产品工作。';
      if (/change your choices in Settings/i.test(trimmed)) {
        fixed = 'Antigravity 中协同 Google 开发者产品工作。你可以随时在设置中更改你的选择。';
      }
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    if (/^work with Google developer products/i.test(trimmed)) {
      let fixed = '协同 Google 开发者产品工作。';
      if (/change your choices in Settings/i.test(trimmed)) {
        fixed = '协同 Google 开发者产品工作。你可以随时在设置中更改你的选择。';
      }
      if (stringCache.size < MAX_STRING_CACHE) stringCache.set(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }

    // --- Dynamic Agent Logs Regex Rules (Fixed Escaping) ---
    let dynamicMatch = trimmed;
    let isDynamic = false;
    
    // 用户定制方案 3：思考了 (时间) 与 总耗时 (时间) 动态正则
    if (/^Thought (?:for|持续) (.+)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Thought (?:for|持续) (.+)$/i, '思考了 $1');
      isDynamic = true;
    }
    if (/^Worked (?:for|持续) (.+)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Worked (?:for|持续) (.+)$/i, '总耗时 $1');
      isDynamic = true;
    }
    if (/^\\d+ files? changed(.*)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+) files? changed(.*)/i, '$1 个文件已更改$2');
      isDynamic = true;
    }
    if (/^(\\d+)\\s+searches?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+)\\s+searches?/i, '$1 次搜索');
      isDynamic = true;
    }
    if (/^Edited (.*) \\+(\\d+) -(\\d+)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Edited (.*) \\+(\\d+) -(\\d+)/i, '编辑 $1 (+$2 -$3)');
      isDynamic = true;
    }
    if (/^Canceled taskkill/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Canceled (.*)/, '已取消 $1');
      isDynamic = true;
    }
    if (/^\\d+(?:\\.\\d+)?% of the (?:customization )?budget is (?:available|used)[.。]?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch
        .replace(/(\\d+(?:\\.\\d+)?)% of the (?:customization )?budget is available[.。]?/i, '自定义额度尚有 $1% 可用。')
        .replace(/(\\d+(?:\\.\\d+)?)% of the (?:customization )?budget is used[.。]?/i, '已使用 $1% 的自定义额度。');
      isDynamic = true;
    }

    // 限额剩余标题动态匹配 (例如 "Five Hour Limit Remaining", "Weekly Limit Remaining", "5-hour limit remaining")
    if (/^(Weekly|Five[- ]Hour|5[- ]Hour|Hourly|Daily)\\s+Limit\\s+Remaining$/i.test(trimmed)) {
      const lower = trimmed.toLowerCase();
      if (lower.includes('weekly')) dynamicMatch = '每周限额剩余';
      else if (lower.includes('five') || lower.includes('5')) dynamicMatch = '5 小时限额剩余';
      else if (lower.includes('hourly')) dynamicMatch = '每小时限额剩余';
      else if (lower.includes('daily')) dynamicMatch = '每日限额剩余';
      isDynamic = true;
    }

    // 配额提示句 (含动态天数/小时/分钟，支持全英或半中文状态下自愈清洗)
    if (/(?:You have used some of your|您已使用了部分).*(?:limit|限额)/i.test(trimmed)) {
      dynamicMatch = dynamicMatch
        .replace(/^(?:You have used some of your|您已使用了部分)\\s*(?:weekly|每周)\\s*(?:limit|限额)?/i, '您已使用了部分每周限额')
        .replace(/^(?:You have used some of your|您已使用了部分)\\s*(?:5[- ]hour|five[- ]hour|5 小时|五小时)\\s*(?:limit|限额)?/i, '您已使用了部分 5 小时限额')
        .replace(/^(?:You have used some of your|您已使用了部分)\\s*(?:hourly|每小时)\\s*(?:limit|限额)?/i, '您已使用了部分每小时限额')
        .replace(/^(?:You have used some of your|您已使用了部分)\\s*(?:daily|每日)\\s*(?:limit|限额)?/i, '您已使用了部分每日限额')
        .replace(/(?:it will fully refresh in|它将在以下时间后完全刷新[：:]?)\\s*/i, ' 它将在以下时间后完全刷新：')
        .replace(/(\\d+)\\s*days?/gi, ' $1 天')
        .replace(/(\\d+)\\s*hours?/gi, ' $1 小时')
        .replace(/(\\d+)\\s*minutes?\\.?$/gi, ' $1 分钟')
        .replace(/\\s+/g, ' ')
        .trim();
      isDynamic = true;
    }
    // 模型分组配额说明长句
    if (/^Within each group, models share/.test(trimmed)) {
      dynamicMatch = '在每个分组中，模型共享每周限额和 5 小时限额。配额按 token 成本比例消耗。因此，较短的任务或使用更具性价比的模型时，限额可持续更长时间。5 小时限额用于平滑总需求，以便在所有用户间公平分配全球容量，而每周限额则与您的个人等级直接挂钩。';
      isDynamic = true;
    }

    // 模型配额剩余动态匹配 (例如 "70% left", "100% Remaining", "85.4% remaining")
    if (/^(\\d+(?:\\.\\d+)?%?)\\s+(?:remaining|left)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+(?:\\.\\d+)?%?)\\s+(?:remaining|left)$/i, '$1 剩余');
      isDynamic = true;
    }
    // 限额周期动态匹配 (例如 "5h limit", "5h Limit", "24h limit", "1h limit")
    if (/^(\\d+)h\\s+limit$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+)h\\s+limit$/i, '$1 小时限额');
      isDynamic = true;
    }
    // 配额重置时间动态匹配 (例如 "Resets in 15h 14m", "Resets in 4h 50m", "Resets in 4d 15h", "Resets in 28m")
    if (/^Resets?\\s+in\\s+(.+)$/i.test(trimmed)) {
      const timePart = trimmed.replace(/^Resets?\\s+in\\s+/i, '');
      const formattedTime = timePart
        .replace(/(\\d+)\\s*d(?:ays?)?/gi, '$1 天 ')
        .replace(/(\\d+)\\s*h(?:(?:ou)?rs?)?/gi, '$1 小时 ')
        .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?/gi, '$1 分钟 ')
        .replace(/(\\d+)\\s*s(?:ec(?:ond)?s?)?/gi, '$1 秒 ')
        .replace(/\\s+/g, ' ')
        .trim();
      dynamicMatch = formattedTime + '后重置';
      isDynamic = true;
    }
    // 剩余时间刷新动态匹配 (例如 "15 minutes", "1 hour 26 minutes", "2 hours", "1 day")
    if (/^(\\d+)\\s+hours?\\s+(\\d+)\\s+minutes?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+)\\s+hours?\\s+(\\d+)\\s+minutes?$/i, '$1 小时 $2 分钟');
      isDynamic = true;
    }
    if (/^(\\d+)\\s+minutes?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+)\\s+minutes?$/i, '$1 分钟');
      isDynamic = true;
    }
    if (/^(\\d+)\\s+hours?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+)\\s+hours?$/i, '$1 小时');
      isDynamic = true;
    }
    if (/^(\\d+)\\s+days?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+)\\s+days?$/i, '$1 天');
      isDynamic = true;
    }

    // 项目/路径不存在的动态提示 (项目名 + " does not exist"，超3词无法走分词)
    if (/^.+ does not exist\\.?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(.+) does not exist\\.?$/i, '$1 不存在');
      isDynamic = true;
    }
    // "xxx was not found" 动态提示
    if (/^.+ was not found\\.?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(.+) was not found\\.?$/i, '$1 未找到');
      isDynamic = true;
    }

    // 步骤与回合动态提示
    if (/^Step \\d+ \\([^\\)]+\\):?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Step (\\d+) \\(([^\\)]+)\\):?/i, '步骤 $1 ($2)：');
      isDynamic = true;
    }
    if (/^\\d+ turns?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+) turns?$/i, '$1 回合');
      isDynamic = true;
    }
    if (/^Turn \\d+$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Turn (\\d+)$/i, '第 $1 回合');
      isDynamic = true;
    }
    if (/^Task id "[^"]+" finished with result:$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Task id "([^"]+)" finished with result:$/i, '任务 "$1" 执行完成：');
      isDynamic = true;
    }
    if (/^Tool is running as a background task with task id: (.+)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Tool is running as a background task with task id: (.+)$/i, '工具正在后台运行 (任务ID: $1)');
      isDynamic = true;
    }
    if (/^Thought (?:for|持续) (.+)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Thought (?:for|持续) (.+)$/i, '思考了 $1');
      isDynamic = true;
    }
    if (/^Thinking (?:for|持续) (.+)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Thinking (?:for|持续) (.+)$/i, '思考了 $1');
      isDynamic = true;
    }
    if (/^Thinking \\((.+)\\)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Thinking \\((.+)\\)$/i, '正在思考 ($1)');
      isDynamic = true;
    }
    if (/^Version\\s+(\\d+.*)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Version\\s+(\\d+.*)$/i, '版本 $1');
      isDynamic = true;
    }
    if (/^Updated\\s+(.+)$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Updated\\s+(.+)$/i, '更新于 $1')
        .replace(/\\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2})\\b/gi, (m, mon, day) => {
          const monMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
          return monMap[mon.toLowerCase()] + '月' + day + '日';
        });
      isDynamic = true;
    }

    // 智能体设置：计划审核策略提示 (包含纯英文、部分翻译、夹生等各种形态)
    if (/(?:Type|输入)\\s*\\/\\s*(?:and|并|和)?\\s*(?:select|选择)?\\s*['"]?plan['"]?\\s*to\\s+have\\s+the\\s+agent\\s+generate\\s+a\\s+plan[。.]?/i.test(trimmed)) {
      dynamicMatch = /[。.]\\s*$/.test(trimmed) ? '输入 / 并选择 plan 来让智能体生成计划。' : '输入 / 并选择 plan 来让智能体生成计划';
      isDynamic = true;
    }
    if (/^(?:to\\s+)?have\\s+the\\s+agent\\s+generate\\s+a\\s+plan[。.]?$/i.test(trimmed)) {
      dynamicMatch = /[。.]\\s*$/.test(trimmed) ? '来让智能体生成计划。' : '来让智能体生成计划';
      isDynamic = true;
    }
    if (/^plan\\s+to\\s+have\\s+the\\s+agent\\s+generate\\s+a\\s+plan[。.]?$/i.test(trimmed)) {
      dynamicMatch = /[。.]\\s*$/.test(trimmed) ? 'plan 来让智能体生成计划。' : 'plan 来让智能体生成计划';
      isDynamic = true;
    }
    if (/^(?:Type|输入)\\s*\\/\\s*(?:and|并|和)\\s*$/i.test(trimmed)) {
      dynamicMatch = '输入 / 并';
      isDynamic = true;
    }

    // 服务端下发的模型分组标签：文本节点包含动态模型列表（如
    // "Models within this group: Claude Opus, Claude Sonnet, GPT-OS"），
    // 精确词典条目无法命中，必须用前缀动态匹配；模型名列表保持英文原样。
    if (/^Models within this group:\\s*(.*)$/i.test(trimmed)) {
      dynamicMatch = trimmed.replace(/^Models within this group:\\s*(.*)$/i,
        (_m, list) => '本组内的模型：' + list.trim());
      isDynamic = true;
    }

    // 2.26.0 带「当前值」后缀的动态选择器 aria-label
    // 注意：必须用函数式 replace，避免捕获到的路径/名称里含 $ 时被误当作替换模板
    if (/^Select project, current: (.+)$/i.test(trimmed)) {
      dynamicMatch = trimmed.replace(/^Select project, current: (.+)$/i, (_m, v) => '选择项目，当前：' + v);
      isDynamic = true;
    }
    if (/^Agent permissions preset selector, current: (.+)$/i.test(trimmed)) {
      dynamicMatch = trimmed.replace(/^Agent permissions preset selector, current: (.+)$/i,
        (_m, v) => '智能体权限预设选择器，当前：' + v.replace(/Turbo/gi, '极速模式'));
      isDynamic = true;
    }
    if (isDynamic) {
      return text.replace(trimmed, dynamicMatch);
    }
    // --- End Dynamic Regex ---

    // 1. Direct Literal Match (Exact match including punctuation)
    if (dictionary[trimmed]) {
      return text.replace(trimmed, dictionary[trimmed]);
    }

    // Normalizing internal multiple whitespace/newlines for multi-sentence cards
    const normalizedSpace = trimmed.replace(/\\s+/g, ' ');
    if (dictionary[normalizedSpace]) {
      return text.replace(trimmed, dictionary[normalizedSpace]);
    }
    
    // 性能：大小写不敏感匹配改用预先构建的 O(1) 索引 lowerDictionary，
    // 语义与原先遍历整本词典完全一致（取首个 toLowerCase 相同的键），
    // 但避免了每次未命中都要线性扫描两千余条词典。
    const caseInsensitiveHit = lowerDictionary.get(trimmed.toLowerCase());
    if (caseInsensitiveHit !== undefined) {
      return text.replace(trimmed, caseInsensitiveHit);
    }

    // 2. Intelligent Punctuation Stripping & Reconstruction
    let core = trimmed;
    let trailPunc = '';
    let matchPunc = '';

    // Strip trailing common punctuation
    const puncRegex = /(\\.\\.\\.|…|\\.|\\?|!|:|：|？|！|。)$/;
    const match = core.match(puncRegex);
    if (match) {
      matchPunc = match[0];
      core = core.slice(0, -matchPunc.length).trim();
      
      // Determine the correct Chinese counterpart punctuation
      if (matchPunc === '.') trailPunc = '。';
      else if (matchPunc === '?') trailPunc = '？';
      else if (matchPunc === '!') trailPunc = '！';
      else if (matchPunc === ':') trailPunc = '：';
      else if (matchPunc === '：') trailPunc = '：';
      else if (matchPunc === '？') trailPunc = '？';
      else if (matchPunc === '！') trailPunc = '！';
      else if (matchPunc === '。') trailPunc = '。';
      else trailPunc = matchPunc; // keep ..., …
    }

    // Check stripped core in dictionary (O(1) exact or O(1) case-insensitive)
    const coreTranslated = dictionary[core] || lowerDictionary.get(core.toLowerCase()) || '';

    if (coreTranslated) {
      return text.replace(trimmed, coreTranslated + trailPunc);
    }

    // 3. Fallback to word-by-word ONLY for short strings (<= 3 words)
    // 如果短语中已经包含了中文字符（即原本就是汉化内容或中英混排），则严禁进入英文分词翻译
    // 这可以完美阻止像中英文混排短语被分词规则执行二次翻译导致重叠和污染
    if (/[\\u4e00-\\u9fa5]/.test(core)) {
      return text;
    }
    // 防御：若短语包含连字符、下划线、斜杠、反斜杠、点号等，属于代码标识符、文件名、路径或扩展名，绝对跳过分词！
    if (/[-_\\\\/.]/.test(core)) {
      return text;
    }
    // This prevents long unmatched sentences from getting mangled into Chinglish.
    const wordsCount = core.split(/\\s+/).filter(Boolean).length;
    if (wordsCount > 3) {
      return text; // Do not translate, keep original English sentence clean
    }

    let replaced = false;
    let temp = core.replace(CORE_WORDS_UNION_REGEX, (matched) => {
      const lower = matched.toLowerCase();
      if (coreWords[lower]) {
        replaced = true;
        return coreWords[lower];
      }
      return matched;
    });

    let finalTranslated = replaced ? temp : core;
    // 消除中文字符之间可能由分词替换残留的英文空格，提升翻译句子的连贯精致度
    finalTranslated = finalTranslated.replace(/([\\u4e00-\\u9fa5])\\s+([\\u4e00-\\u9fa5])/g, '$1$2');
    // 特殊去重清洗：防止前置分词造成的“使用使用”与半中半英长句残留
    finalTranslated = finalTranslated.replace(/使用使用 Google 插件构建/g, '使用 Google 插件构建');
    finalTranslated = finalTranslated.replace(/Advanced\\s*设置/gi, '高级设置');
    finalTranslated = finalTranslated.replace(/Collapse\\s*All/gi, '全部折叠');
    finalTranslated = finalTranslated.replace(/Expand\\s*All/gi, '全部展开');
    finalTranslated = finalTranslated.replace(/了解更多关于\\s*继承\\s*Global/gi, '了解更多关于 继承全局');
    finalTranslated = finalTranslated.replace(/继承\\s*Global/gi, '继承全局');
    finalTranslated = finalTranslated.replace(/Also\\s+includes\\s*(?:Global\\s*Permissions|全局权限)\\s*when\\s+working\\s+in\\s+this\\s+project\\.?[。.]?/gi, '在当前项目中工作时，亦继承全局权限配置。');
    finalTranslated = finalTranslated.replace(/Configure 智能体 执行[,\\s]+queued 消息 delivery[,\\s]+and 权限[。.]?/g, '配置智能体执行策略、消息队列发送机制以及安全权限。');
    finalTranslated = finalTranslated.replace(/Automatic 检查更新/g, '自动检查更新');
    finalTranslated = finalTranslated.replace(/每周限额\\s*Remaining/gi, '每周限额剩余');
    finalTranslated = finalTranslated.replace(/五小时限额\\s*Remaining/gi, '5 小时限额剩余');
    finalTranslated = finalTranslated.replace(/Claude and GPT 模型/g, 'Claude 与 GPT 模型');
    finalTranslated = finalTranslated.replace(/命令\\s*palette/gi, '命令面板');
    finalTranslated = finalTranslated.replace(/Scan the code to .*(?:copy link|复制链接)[。.]?/gi, '扫描二维码以在远程控制中打开此设备，或复制链接。');
    finalTranslated = finalTranslated.replace(/Scan the code to (?:打开|open) this (?:设备|device) in 远程\\s*(?:Control|控制)[,\\s]+or (?:复制链接|copy link)[。.]?/gi, '扫描二维码以在远程控制中打开此设备，或复制链接。');
    finalTranslated = finalTranslated.replace(/(?:工作了\\s*持续|总耗时\\s*持续|Worked for)\\s*(.+)/gi, '总耗时 $1');
    finalTranslated = finalTranslated.replace(/(?:Thought\\s*持续|思考了\\s*持续)\\s*(.+)/gi, '思考了 $1');
    finalTranslated = finalTranslated.replace(/查看\\s*could not be opened/gi, '查看文件无法打开');
    finalTranslated = finalTranslated.replace(/could not be opened/gi, '无法打开');
    finalTranslated = finalTranslated.replace(/(\\d+)\\s+searches?/gi, '$1 次搜索');
    finalTranslated = finalTranslated.replace(/(?:Type|输入)\\s*\\/\\s*(?:and|并|和)?\\s*(?:select|选择)?\\s*['"]?plan['"]?\\s*to\\s+have\\s+the\\s+agent\\s+generate\\s+a\\s+plan[。.]?/gi, '输入 / 并选择 plan 来让智能体生成计划。');
    finalTranslated = finalTranslated.replace(/输入\\s*\\/\\s*并\\s*选择\\s*plan\\s*来让智能体生成计划[。.]?/g, '输入 / 并选择 plan 来让智能体生成计划。');
    finalTranslated = finalTranslated.replace(/^Ran\\s*命令$/i, '已运行命令');
    finalTranslated = finalTranslated.replace(/^Running\\s*命令$/i, '正在运行命令');
    finalTranslated = finalTranslated.replace(/^Run\\s*命令$/i, '运行命令');
    finalTranslated = finalTranslated.replace(/^Ran\\s*命令:\\s*(.+)$/i, '已运行命令: $1');
    finalTranslated = finalTranslated.replace(/^Running\\s*命令:\\s*(.+)$/i, '正在运行命令: $1');
    finalTranslated = finalTranslated.replace(/^Run\\s*命令:\\s*(.+)$/i, '运行命令: $1');
    if (matchPunc) {
      finalTranslated += trailPunc;
    }
    if (stringCache.size < MAX_STRING_CACHE) {
      stringCache.set(trimmed, finalTranslated);
    }
    return text.replace(trimmed, finalTranslated);
  }

  // 用于精确匹配代码编辑器、语法高亮等容器类名（收敛范围，防止误杀带 font-mono 或 viewer 的正常 UI）
  const codeClassPattern = /(?:^|[\\s_-])(monaco-editor|editor-instance|hljs|shiki|prism|codemirror|line-content|gutter|codeblock|code-block|code-line|view-line)(?:$|[\\s_-])/i;

  // 提及菜单 (@ Mentions) 分类白名单：放行汉化，同时保持斜杠命令 (/boost 等) 与代码文件名严格跳过
  const MENTION_CATEGORIES = new Set([
    'Rules',
    '规则',
    'Conversation',
    '对话',
    'PDF Document',
    'PDF 文档',
    'MCP Resource',
    'MCP 资源',
    'Browser Page',
    '浏览器页面',
    'Browser Text',
    '浏览器文本',
    'Directory',
    '目录',
    'Git Commit',
    'Git 提交',
    'Git Diff',
    'Git 差异'
  ]);

  const skipCache = new WeakMap();

  function shouldSkipNode(node) {
    if (!node) return true;
    
    // 如果是文本节点，我们检查其父元素；如果是属性/元素节点，检查自身
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) return false;

    // 1. 记忆化缓存查询：O(1) 瞬间返回，消除折叠栏展开时的万次重复检查
    if (skipCache.has(element)) {
      return skipCache.get(element);
    }

    // 2. 绝对不能翻译的脚本/样式/按键标签
    const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'KBD', 'SAMP', 'VAR'];
    if (skipTags.includes(element.tagName)) {
      skipCache.set(element, true);
      return true;
    }

    // 核心保护：斜杠命令与提及建议菜单的触发词标签（保持 /boost, /schedule, /browser 等原生命令标识不变）
    // 但针对提及菜单（@）中的分类标签（如 Rules -> 规则, Conversation -> 对话 等）放行汉化
    const isMenuOptionLabel = element.closest && element.closest('[data-testid="menu-option-label"]');
    if (isMenuOptionLabel) {
      const labelText = (isMenuOptionLabel.innerText || isMenuOptionLabel.textContent || '').trim();
      if (MENTION_CATEGORIES.has(labelText)) {
        skipCache.set(element, false);
        return false;
      }
      skipCache.set(element, true);
      return true;
    }

    // 思考过程触发药丸按钮（如“Thought for 4s”折叠栏标题）：必须放行汉化为“思考了 4s”
    const isThinkingTrigger = element.closest && element.closest('button[data-testid="thinking-collapsible-trigger"]');
    if (isThinkingTrigger) {
      skipCache.set(element, false);
      return false;
    }

    // 3. 特殊特权放行：针对执行步骤的药丸标签（如 Ran, Explored, Edited, Viewed, Thought, Thinking, Working 等）
    // 无论其父级为 SPAN、CODE 还是 BUTTON，只要是系统执行药丸且不在用户提问气泡内，一律无条件放行汉化
    const textContent = (element.innerText || element.textContent || '').trim();
        // 选中文本快捷引用气泡（Quote / Quote Ctrl+L / Quote Cmd+L）及 /btw 提问气泡特权放行
    if (/^(?:Quote|Ask(?:\\s+|\\s*\\/\\s*)btw)(?:\\s+(?:Ctrl|Cmd)\\+[a-zA-Z0-9]+)?$/i.test(textContent)) {
      skipCache.set(element, false);
      return false;
    }

    const isActionPill = textContent.length <= 40 && /^(Explored|Exploring|Ran|Run|Running|Viewed|Viewing|Edited|Editing|Thought|Thinking|Working|Done|Analyzed|Analyzing|Created|Creating|Deleted|Deleting|Waiting|Rejected|Errored|Completed|Used)(\\s+(command|commands|files?|tools?|artifacts?))?$/i.test(textContent);
    if (isActionPill) {
      let inUserInput = false;
      let inThinkingContent = false;
      let checkCur = element;
      while (checkCur && checkCur !== document.body) {
        if (checkCur.classList) {
          if (checkCur.classList.contains('group/user-input-step') || checkCur.classList.contains('cursor-edit')) {
            inUserInput = true;
            break;
          }
        }
        if (checkCur.parentElement && checkCur.parentElement.querySelector) {
          const trigger = checkCur.parentElement.querySelector(':scope > button[data-testid="thinking-collapsible-trigger"]');
          if (trigger && checkCur !== trigger && !trigger.contains(checkCur)) {
            inThinkingContent = true;
            break;
          }
        }
        checkCur = checkCur.parentElement;
      }
      if (!inUserInput && !inThinkingContent) {
        skipCache.set(element, false);
        return false;
      }
    }

    if (element.tagName === 'CODE') {
      if (!isActionPill) {
        skipCache.set(element, true);
        return true;
      }
    }
    if (element.tagName === 'PRE') {
      skipCache.set(element, true);
      return true;
    }

    // 4. 输入框/文本域/富文本编辑器/用户提问气泡绝对跳过（输入前、输入中、发送后 100% 原样保留）
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      skipCache.set(element, true);
      return true;
    }
    if (element.getAttribute && (
        element.getAttribute('contenteditable') === 'true' ||
        element.getAttribute('role') === 'textbox' ||
        element.getAttribute('data-lexical-editor') === 'true'
    )) {
      skipCache.set(element, true);
      return true;
    }

    // 5. 检查元素自身是否带有代码语言标记属性
    if (element.getAttribute) {
      if (element.getAttribute('data-language') || 
          element.getAttribute('data-code') ||
          element.getAttribute('data-line') ||
          element.getAttribute('data-line-number')) {
        skipCache.set(element, true);
        return true;
      }
    }

    // 6. 向上递归检查祖先节点（带路径记忆化剪枝）
    let cur = element;
    let shouldSkip = false;
    while (cur && cur !== document.body) {
      if (skipCache.has(cur)) {
        shouldSkip = skipCache.get(cur);
        break;
      }

      // 核心防御：模型思考链正文容器绝对跳过
      // 思考链为 AI 运行时生成的自由英文/动态推理流，切勿进行逐词或断句翻译，否则会导致中英夹杂混乱
      if (cur.classList && (
        cur.classList.contains('cursor-edit') ||
        cur.classList.contains('thought-content') ||
        cur.classList.contains('thinking-content') ||
        cur.classList.contains('thought-box')
      )) {
        shouldSkip = true;
        break;
      }

      // 思考折叠栏内容区域：位于 thinking-collapsible-trigger 旁的展开正文容器
      if (cur.parentElement && cur.parentElement.querySelector) {
        const trigger = cur.parentElement.querySelector(':scope > button[data-testid="thinking-collapsible-trigger"]');
        if (trigger && cur !== trigger && !trigger.contains(cur)) {
          shouldSkip = true;
          break;
        }
      }

      // 用户输入框与富文本编辑器（输入前/输入中绝对不翻译）
      if (cur.getAttribute && (
          cur.getAttribute('contenteditable') === 'true' ||
          cur.getAttribute('role') === 'textbox' ||
          cur.getAttribute('data-lexical-editor') === 'true'
      )) {
        shouldSkip = true;
        break;
      }

      if (cur.getAttribute && (
          cur.getAttribute('data-language') || 
          cur.getAttribute('data-code') ||
          cur.getAttribute('data-line') ||
          cur.getAttribute('data-line-number') ||
          cur.getAttribute('role') === 'code'
      )) {
        shouldSkip = true;
        break;
      }

      if (cur.classList && (
        cur.classList.contains('group/user-input-step') ||
        cur.classList.contains('user-message') ||
        cur.classList.contains('cursor-text') ||
        cur.classList.contains('monaco-editor') || 
        cur.classList.contains('editor-instance') ||
        cur.classList.contains('input-area') ||
        cur.classList.contains('chat-input')
      )) {
        shouldSkip = true;
        break;
      }

      if (cur.className && typeof cur.className === 'string') {
        const lowerClass = cur.className.toLowerCase();
        if (
          lowerClass.includes('code-line') ||
          lowerClass.includes('view-line') ||
          codeClassPattern.test(cur.className)
        ) {
          shouldSkip = true;
          break;
        }
      }

      if (cur.tagName === 'PRE') {
        shouldSkip = true;
        break;
      }

      cur = cur.parentElement;
    }

    skipCache.set(element, shouldSkip);
    return shouldSkip;
  }

  // ---- 组合句翻译兜底（React Fragment 片段化）----
  // React 常把一句话拆成「多个文本节点 + 内联元素」，例如：
  //   "Configure the browser subagent. It requires", " ",
  //   <a>Google Chrome</a>, " ", "to be installed."
  // 这种结构下整句词典条目永远无法命中，只会由碎片条目各自命中后拼接，
  // 导致中文语序错乱（例："这需要 Google Chrome 需要安装。"）。
  // 此处改为：用元素整体文本命中整句词典，再用内联元素的锚点文本把译文切回各节点。
  function tryCombinedSentenceTranslation(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const children = Array.prototype.slice.call(element.childNodes);
    if (children.length < 2) return false;

    const slots = [];
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.nodeValue.trim()) { slots.push({ type: 'space', node: child }); continue; }
        slots.push({ type: 'text', node: child });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.childNodes.length !== 1 || child.firstChild.nodeType !== Node.TEXT_NODE) return false;
        slots.push({ type: 'anchor', node: child, anchorText: child.firstChild.nodeValue.trim() });
      } else {
        return false;
      }
    }

    const anchors = slots.filter(function (s) { return s.type === 'anchor'; });
    if (!anchors.length) return false;

    let fullText = '';
    for (const child of children) {
      fullText += child.nodeType === Node.TEXT_NODE ? child.nodeValue : child.textContent;
    }
    const key = fullText.trim();
    if (!key || !/[A-Za-z]/.test(key)) return false;

    // 快速路径：整句已在词典中时直接取译文，避免为一个已收录的整句
    // 跑完整的动态正则链 + 大小写索引查找。
    let translated = dictionary[key];
    if (!translated) translated = lowerDictionary.get(key.toLowerCase());
    if (!translated) translated = translateString(key);
    if (!translated || translated === key) return false;

    // 所有锚点必须原样出现在译文中，否则无法安全切分
    let probe = 0;
    for (const a of anchors) {
      if (!a.anchorText) return false;
      const idx = translated.indexOf(a.anchorText, probe);
      if (idx < 0) return false;
      a.start = idx;
      a.end = idx + a.anchorText.length;
      probe = a.end;
    }

    // 按 DOM 顺序把译文回填到各文本节点；锚点元素文本保持原样
    let anchorIdx = 0;
    let consumed = 0;
    for (const s of slots) {
      if (s.type === 'anchor') {
        consumed = anchors[anchorIdx].end;
        anchorIdx++;
        continue;
      }
      if (s.type === 'space') {
        s.node.nodeValue = '';
        translatedNodes.add(s.node);
        continue;
      }
      const segEnd = anchorIdx < anchors.length ? anchors[anchorIdx].start : translated.length;
      s.node.nodeValue = translated.slice(consumed, segEnd);
      translatedNodes.add(s.node);
      consumed = segEnd;
    }
    return true;
  }

  // 性能优化 3：已处理文本节点记忆化 WeakSet，消除父容器重绘时的重复遍历
  const translatedNodes = new WeakSet();

  function translateNode(node) {
    if (!node) return;

    // 优先翻译元素自身的静态 UI 属性（如 input 的 placeholder、按钮的 title 与 aria-label）
    // 必须在 shouldSkipNode 之前处理，因为 shouldSkipNode 会跳过 INPUT/TEXTAREA 的文本子节点与 value
    if (node.nodeType === Node.ELEMENT_NODE) {
      ['placeholder', 'title', 'aria-label'].forEach(attr => {
        if (node.hasAttribute && node.hasAttribute(attr)) {
          const original = node.getAttribute(attr);
          if (original) {
            const translated = translateString(original);
            if (original !== translated) {
              node.setAttribute(attr, translated);
            }
          }
        }
      });
    }

    if (shouldSkipNode(node)) return;

    if (node.nodeType === Node.TEXT_NODE) {
      if (translatedNodes.has(node)) return;
      const original = node.nodeValue;
      if (!original || !original.trim()) return;
      const translated = translateString(original);
      if (original !== translated) {
        node.nodeValue = translated;
        translatedNodes.add(node);
      } else if (!/[a-zA-Z]/.test(original)) {
        translatedNodes.add(node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      ['placeholder', 'title', 'aria-label', 'value'].forEach(attr => {
        if (node.hasAttribute && node.hasAttribute(attr)) {
          // 双重锁死：绝对不翻译任何输入框或编辑区的用户 value 属性
          if (attr === 'value' && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) {
            return;
          }
          const original = node.getAttribute(attr);
          if (original && (node.tagName !== 'INPUT' || node.type === 'button' || node.type === 'submit' || attr !== 'value')) {
            const translated = translateString(original);
            if (original !== translated) {
              node.setAttribute(attr, translated);
            }
          }
        }
      });
      // 2.32.1 针对 React 片段化导致的「No 自动化 yet」等空状态提示进行容器级收敛
      const containerText = (node.textContent || '').trim();
      const emptyStateMatch = containerText.match(/^No\\s+(automations?|automation|自动化|conversations?|conversation|对话|groups?|group|分组)\\s+yet[.。]?$/i);
      if (emptyStateMatch) {
        const emptyStateMap = {
          automations: '暂无自动化',
          automation: '暂无自动化',
          '自动化': '暂无自动化',
          conversations: '暂无对话',
          conversation: '暂无对话',
          '对话': '暂无对话',
          groups: '暂无分组',
          group: '暂无分组',
          '分组': '暂无分组'
        };
        const targetText = emptyStateMap[emptyStateMatch[1].toLowerCase()] || '暂无自动化';
        let setDone = false;
        for (let i = 0; i < node.childNodes.length; i++) {
          const child = node.childNodes[i];
          if (child.nodeType === Node.TEXT_NODE) {
            if (!setDone) {
              child.nodeValue = targetText;
              translatedNodes.add(child);
              setDone = true;
            } else {
              child.nodeValue = '';
              translatedNodes.add(child);
            }
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (!setDone) {
              child.textContent = targetText;
              setDone = true;
            } else {
              child.textContent = '';
            }
          }
        }
        return;
      }

      // 组合句翻译兜底：React 片段化导致整句词典条目无法命中时启用
      tryCombinedSentenceTranslation(node);

      if (node.shadowRoot) {
        observeRoot(node.shadowRoot);
        translateNode(node.shadowRoot);
      }
      for (let i = 0; i < node.childNodes.length; i++) {
        translateNode(node.childNodes[i]);
      }
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i++) {
        translateNode(node.childNodes[i]);
      }
    }
  }

  const observerConfig = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'title', 'aria-label', 'value']
  };

  const observedRoots = new WeakSet();
  let isTranslating = false;
  let batchRafHandle = null;
  const pendingAddedNodes = new Set();
  const pendingTextNodes = new Set();
  const pendingAttrNodes = new Map();

  const scheduleBatchFrame = (fn) => {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(fn);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(fn);
    } else {
      setTimeout(fn, 0);
    }
  };

  function scheduleBatchTranslation() {
    if (batchRafHandle !== null) return;
    batchRafHandle = true;
    scheduleBatchFrame(processBatchTranslation);
  }

  function processBatchTranslation() {
    batchRafHandle = null;
    if (isTranslating) return;
    isTranslating = true;

    try {
      // 1. 批量处理属性变更
      if (pendingAttrNodes.size > 0) {
        for (const [target, attrs] of pendingAttrNodes) {
          for (const attrName of attrs) {
            if (attrName === 'value' && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
              continue;
            }
            if (attrName === 'placeholder' || attrName === 'title' || attrName === 'aria-label' || !shouldSkipNode(target)) {
              const original = target.getAttribute(attrName);
              if (original) {
                const translated = translateString(original);
                if (original !== translated) {
                  target.setAttribute(attrName, translated);
                }
              }
            }
          }
        }
        pendingAttrNodes.clear();
      }

      // 2. 批量处理文本变更 (characterData)
      if (pendingTextNodes.size > 0) {
        for (const node of pendingTextNodes) {
          if (!shouldSkipNode(node)) {
            const original = node.nodeValue;
            if (original && original.trim()) {
              const translated = translateString(original);
              if (original !== translated) {
                node.nodeValue = translated;
                translatedNodes.add(node);
              } else if (!/[a-zA-Z]/.test(original)) {
                translatedNodes.add(node);
              }
            }
          }
        }
        pendingTextNodes.clear();
      }

      // 3. 批量处理新增节点（性能优化 6：祖先包含剪枝，彻底消灭 O(N^2) 嵌套递归）
      if (pendingAddedNodes.size > 0) {
        const rootNodes = [];
        for (const node of pendingAddedNodes) {
          let hasAncestor = false;
          let p = node.parentElement;
          while (p) {
            if (pendingAddedNodes.has(p)) {
              hasAncestor = true;
              break;
            }
            p = p.parentElement;
          }
          if (!hasAncestor) {
            rootNodes.push(node);
          }
        }
        pendingAddedNodes.clear();

        for (let i = 0; i < rootNodes.length; i++) {
          const node = rootNodes[i];
          if (node.shadowRoot) {
            observeRoot(node.shadowRoot);
          }
          if (!shouldSkipNode(node)) {
            translateNode(node);
          }
        }
      }
    } catch (e) {
      console.error('Batch translation error:', e);
    } finally {
      isTranslating = false;
    }
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);

    const observer = new MutationObserver((mutations) => {
      let needsSchedule = false;
      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];
        if (mutation.type === 'childList') {
          const added = mutation.addedNodes;
          for (let j = 0; j < added.length; j++) {
            const node = added[j];
            if (node.shadowRoot) {
              observeRoot(node.shadowRoot);
            }
            pendingAddedNodes.add(node);
            needsSchedule = true;
          }
        } else if (mutation.type === 'characterData') {
          translatedNodes.delete(mutation.target);
          pendingTextNodes.add(mutation.target);
          needsSchedule = true;
        } else if (mutation.type === 'attributes') {
          const target = mutation.target;
          let attrSet = pendingAttrNodes.get(target);
          if (!attrSet) {
            attrSet = new Set();
            pendingAttrNodes.set(target, attrSet);
          }
          attrSet.add(mutation.attributeName);
          needsSchedule = true;
        }
      }

      if (needsSchedule) {
        scheduleBatchTranslation();
      }
    });

    observer.observe(root, observerConfig);
  }

  // Hook attachShadow
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function() {
    const shadowRoot = originalAttachShadow.apply(this, arguments);
    observeRoot(shadowRoot);
    return shadowRoot;
  };

  function safeScan() {
    if (document.body) {
      try {
        translateNode(document.body);
      } catch (e) {
        console.error('Translation scan error:', e);
      }
      observeRoot(document.body);
    }
  }

  function startObserver() {
    safeScan();

    // 1. 渐进式多阶挂载兜底 (Progressive Mounting Backstop)
    // 应对托盘重开、温热加载下 React 异步挂载延迟与路由初次渲染
    [50, 150, 400, 1000, 2500].forEach(delay => {
      setTimeout(safeScan, delay);
    });

    // 2. 窗口激活 (Focus) 与可见性恢复 (VisibilityChange) 兜底
    // 无论是窗口从最小化还原、托盘重新唤醒，还是失焦后重新聚焦，自动触发增量补丁
    window.addEventListener('focus', safeScan);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        safeScan();
      }
    });

    // 3. 单页应用 (SPA) 路由切换监听 (History API Hook)
    // 保证在不同会话、项目切换、从欢迎根路径跳转至具体任务视图时即时汉化
    try {
      const origPushState = history.pushState;
      history.pushState = function() {
        const ret = origPushState.apply(this, arguments);
        setTimeout(safeScan, 50);
        return ret;
      };
      const origReplaceState = history.replaceState;
      history.replaceState = function() {
        const ret = origReplaceState.apply(this, arguments);
        setTimeout(safeScan, 50);
        return ret;
      };
      window.addEventListener('popstate', () => setTimeout(safeScan, 50));
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }


})();
`;

// Helper to replace text in file cleanly
function replaceInFile(filePath, target, replacement) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到要修改的文件: ${filePath}`);
  }
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.includes(replacement)) {
    log(`文件 ${path.basename(filePath)} 已经应用过此汉化修改，跳过。`);
    return;
  }
  if (!content.includes(target)) {
    log(`提示：文件 ${path.basename(filePath)} 未找到匹配目标内容，跳过。`);
    return;
  }
  content = content.split(target).join(replacement);
  fs.writeFileSync(filePath, content, 'utf-8');
  log(`已成功修改 ${path.basename(filePath)}`);
}

// Perform localization modification operations on extracted files
function applyTranslations() {
  log('开始对解压的文件进行汉化替换和代码注入...');

  // 智能注入与版本热升级: 若目标文件已包含注入标记，则截断替换为最新版本；若不存在则追加注入。
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

  // 1. Inject DOM Localization in dist/preload.js
  const preloadPath = path.join(EXTRACT_DIR, 'dist', 'preload.js');
  injectOrUpdate(preloadPath, DOM_TRANSLATOR_INJECTION, '// Antigravity 2.0 Chinese Localization Engine', 'Web UI 实时汉化引擎');

  // 2. Inject DOM Localization in dist/ideInstall/wizardPreload.js
  const wizardPreloadPath = path.join(EXTRACT_DIR, 'dist', 'ideInstall', 'wizardPreload.js');
  injectOrUpdate(wizardPreloadPath, DOM_TRANSLATOR_INJECTION, '// Antigravity 2.0 Chinese Localization Engine', '新版向导 Web UI 汉化引擎');

  // 3. Localize dist/menu.js (Native Application Menu)
  const menuPath = path.join(EXTRACT_DIR, 'dist', 'menu.js');
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
  'Replace With New': '替换为新建',
  'Remove From Split': '从分屏中移除',
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
  'Conversation Path': '对话路径',
  'Split Right': '向右分屏',
  'Split Down': '向下分屏',
  'Split Left': '向左分屏',
  'Split Up': '向上分屏',
  'Replace with New': '替换为新建',
  'Replace With New': '替换为新建',
  'Replace with new': '替换为新建',
  'Ask /btw': '通过 /btw 提问',
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
  // Append definitions at the end of the file
  injectOrUpdate(menuPath, menuInjectCode, 'const menuTranslationMap = {', '原生菜单翻译映射');

  // Fix submenu finding so it matches both original English and translated Chinese labels
  replaceInFile(
    menuPath,
    'const submenuItem = appMenu.items.find((item) => item.label === submenuLabel);',
    'const submenuItem = appMenu.items.find((item) => item.label === submenuLabel || (typeof menuTranslationMap !== "undefined" && item.label === menuTranslationMap[submenuLabel]));'
  );

  // Replace menu application step safely (both initial and WSL async addition)
  replaceInFile(
    menuPath,
    'electron_1.Menu.setApplicationMenu(menu);',
    `if (typeof translateMenu === 'function') { menu.items.forEach(translateMenu); } electron_1.Menu.setApplicationMenu(menu);`
  );

  // 4. Localize dist/tray.js (Native System Tray)
  const trayPath = path.join(EXTRACT_DIR, 'dist', 'tray.js');
  
  // Replace active agents counts
  replaceInFile(
    trayPath,
    `countItem.label =
                (count > 0 ? \`\${count}\` : 'No') +
                    ' agent' +
                    (count === 1 ? '' : 's') +
                    ' running';`,
    `countItem.label = count > 0 ? \`\${count} 个智能体运行中\` : '没有智能体在运行';`
  );

  // Replace default action labels in createTray
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

  // 5. Localize dist/loadingOverlay.js (Starting loading screen)
  const loadingOverlayPath = path.join(EXTRACT_DIR, 'dist', 'loadingOverlay.js');
  if (fs.existsSync(loadingOverlayPath)) {
    replaceInFile(
      loadingOverlayPath,
      '<div class="text">Loading Antigravity</div>',
      '<div class="text">正在加载 Antigravity...</div>'
    );
  }

  // 6. Localize dist/provisionSplash.js (WSL Provision Splash Screen)
  const splashPath = path.join(EXTRACT_DIR, 'dist', 'provisionSplash.js');
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

  // 7. Localize dist/ipcHandlers.js (Workspace Dialogs & WSL Alerts & Native Context Menu)
  const ipcPath = path.join(EXTRACT_DIR, 'dist', 'ipcHandlers.js');
  if (fs.existsSync(ipcPath)) {
    replaceInFile(ipcPath, "title: 'Open workspace',", "title: '打开工作区',");
    replaceInFile(ipcPath, "title: 'Open workspaces',", "title: '打开工作区',");
    replaceInFile(ipcPath, "electron_1.dialog.showErrorBox('Cannot open folder', t.error);", "electron_1.dialog.showErrorBox('无法打开文件夹', t.error);");
    replaceInFile(ipcPath, "message: 'Folder is on the Windows filesystem',", "message: '文件夹位于 Windows 文件系统中',");

    // 2.19.1 新增：原生右键上下文菜单汉化注入
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

  // 对话列表右键菜单（对话条目）
  'New Conversation': '新建对话',
  'Fork Conversation': '派生对话',
  'Rename': '重命名',
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
  'Conversation Path': '对话路径',
  'Split Right': '向右分屏',
  'Split Down': '向下分屏',
  'Split Left': '向左分屏',
  'Split Up': '向上分屏',
  'Replace with New': '替换为新建',
  'Replace With New': '替换为新建',
  'Replace with new': '替换为新建',
  'Ask /btw': '通过 /btw 提问',
};
function translateContextLabel(lbl) {
  if (!lbl) return '';
  const trimmed = typeof lbl === 'string' ? lbl.trim() : '';
  return contextMenuTranslationMap[lbl] || contextMenuTranslationMap[trimmed] || lbl;
}
`;
    injectOrUpdate(ipcPath, contextMenuInject, 'const contextMenuTranslationMap = {', '原生上下文菜单翻译映射');
    replaceInFile(ipcPath, "label: item.label ?? '',", "label: (typeof translateContextLabel === 'function' ? translateContextLabel(item.label) : item.label) ?? '',");
  }

  // 8. Localize dist/wsl.js (WSL Path Mappings & Status Messages)
  const wslPath = path.join(EXTRACT_DIR, 'dist', 'wsl.js');
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
  const mainPath = path.join(EXTRACT_DIR, 'dist', 'main.js');
  if (fs.existsSync(mainPath)) {
    replaceInFile(mainPath, "title: 'WSL distro not found',", "title: '未找到 WSL 发行版',");
    replaceInFile(
      mainPath,
      "message: `The WSL distro \"${WSL_DISTRO}\" is no longer installed.`,",
      "message: `WSL 发行版 \"${WSL_DISTRO}\" 已不再安装。`,"
    );
    replaceInFile(
      mainPath,
      "detail: 'Antigravity opened on Windows instead.',",
      "detail: 'Antigravity 已改为在 Windows 本地打开。',"
    );
    replaceInFile(
      mainPath,
      "await electron_1.dialog.showErrorBox('WSL setup failed', msg);",
      "await electron_1.dialog.showErrorBox('WSL 配置失败', msg);"
    );
    replaceInFile(
      mainPath,
      "await electron_1.dialog.showErrorBox('Startup failed', msg);",
      "await electron_1.dialog.showErrorBox('启动失败', msg);"
    );
    replaceInFile(
      mainPath,
      "await electron_1.dialog.showErrorBox('Binary not found', msg);",
      "await electron_1.dialog.showErrorBox('未找到核心二进制组件', msg);"
    );
    replaceInFile(
      mainPath,
      "title: 'Confirm Quit',",
      "title: '确认退出',"
    );
    replaceInFile(
      mainPath,
      "message: 'Are you sure you want to quit?',",
      "message: '您确定要退出吗？',"
    );
    replaceInFile(
      mainPath,
      "detail: 'There may be agents or background tasks running.',",
      "detail: '可能还有智能体或后台任务正在运行。',"
    );
    replaceInFile(
      mainPath,
      "buttons: ['Cancel', 'Quit'],",
      "buttons: ['取消', '退出'],"
    );
    replaceInFile(
      mainPath,
      "label: 'New Window',",
      "label: '新建窗口',"
    );
  }

  // 9.1. Localize dist/webauthn.js (Passkey 账户选择对话框, v2.27.0+)
  const webAuthnPath = path.join(EXTRACT_DIR, 'dist', 'webauthn.js');
  if (fs.existsSync(webAuthnPath)) {
    replaceInFile(webAuthnPath, "title: 'Choose a Passkey',", "title: '选择通行密钥',");
    replaceInFile(webAuthnPath, "message: `Sign in to ${rpLabel}`,", "message: `登录到 ${rpLabel}`,");
    replaceInFile(webAuthnPath, "detail: 'Select a passkey account to continue:',", "detail: '请选择一个通行密钥账户以继续：',");
    replaceInFile(webAuthnPath, "buttons: [...accountLabels, 'Cancel'],", "buttons: [...accountLabels, '取消'],");
    replaceInFile(webAuthnPath, "const rpLabel = details.relyingPartyId || 'this site';", "const rpLabel = details.relyingPartyId || '此站点';");
    replaceInFile(webAuthnPath, "return `Account ${index + 1}`;", "return `账户 ${index + 1}`;");
  }

  // 9.2. Localize dist/cablev2.js (Passkey 二维码弹窗与实时状态, v2.27.0+)
  const cableV2Path = path.join(EXTRACT_DIR, 'dist', 'cablev2.js');
  if (fs.existsSync(cableV2Path)) {
    replaceInFile(cableV2Path, '<title>Passkeys</title>', '<title>通行密钥</title>');
    replaceInFile(cableV2Path, '<h1 class="sheet-title">Passkeys</h1>', '<h1 class="sheet-title">通行密钥</h1>');
    replaceInFile(cableV2Path, '<p class="mechanism-header">Use your phone or tablet</p>', '<p class="mechanism-header">使用你的手机或平板</p>');
    replaceInFile(cableV2Path, '<p id="status" class="mechanism-desc">Scan this QR code with the camera on the device that has your passkey for ${safeRpId}</p>', '<p id="status" class="mechanism-desc">用存有 ${safeRpId} 通行密钥的设备相机扫描此二维码</p>');
    replaceInFile(cableV2Path, "title: 'Passkeys',", "title: '通行密钥',");
    replaceInFile(cableV2Path, "modal?.updateStatus('Connecting to your device…');", "modal?.updateStatus('正在连接你的设备…');");
    replaceInFile(cableV2Path, "modal?.updateStatus('Verify on your device to continue…');", "modal?.updateStatus('请在你的设备上验证以继续…');");
  }

  // 10. Localize dist/updater.js (Update Notifications & Dialogs)
  const updaterPath = path.join(EXTRACT_DIR, 'dist', 'updater.js');
  if (fs.existsSync(updaterPath)) {
    replaceInFile(updaterPath, "title: 'Check for Updates',", "title: '检查更新',");
    replaceInFile(updaterPath, "message: 'No updates available',", "message: '当前已是最新版本，暂无可用更新。',");
    replaceInFile(updaterPath, "buttons: ['OK'],", "buttons: ['确定'],");
  }

  // 11. Localize dist/ideInstall/wizardHtml.js (IDE Install Wizard Static Template)
  const wizardHtmlPath = path.join(EXTRACT_DIR, 'dist', 'ideInstall', 'wizardHtml.js');
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

  // 12. Localize dist/deviceChooser.js (WebHID/WebUSB/WebSerial 设备选择原生弹窗, v2.30.0+)
  const deviceChooserPath = path.join(EXTRACT_DIR, 'dist', 'deviceChooser.js');
  if (fs.existsSync(deviceChooserPath)) {
    replaceInFile(deviceChooserPath, "hid: 'HID device',", "hid: 'HID 设备',");
    replaceInFile(deviceChooserPath, "usb: 'USB device',", "usb: 'USB 设备',");
    replaceInFile(deviceChooserPath, "serial: 'serial port',", "serial: '串行端口',");
    replaceInFile(deviceChooserPath, "title: 'Connect a device',", "title: '连接设备',");
    replaceInFile(deviceChooserPath, "buttons: [...snapshot.map(({ label }) => label), 'Cancel'],", "buttons: [...snapshot.map(({ label }) => label), '取消'],");
  }

  // 13. Localize dist/webviewPopupSecurity.js (Webview 连接信息弹窗与原生安全指示, v2.30.0+)
  const webviewSecurityPath = path.join(EXTRACT_DIR, 'dist', 'webviewPopupSecurity.js');
  if (fs.existsSync(webviewSecurityPath)) {
    replaceInFile(webviewSecurityPath, "insecure: 'Not secure',", "insecure: '不安全',");
    replaceInFile(webviewSecurityPath, "dangerous: '⚠ Not secure',", "dangerous: '⚠ 不安全',");
    replaceInFile(webviewSecurityPath, "'Your connection to this site is not secure',", "'您与此网站的连接不安全',");
    replaceInFile(webviewSecurityPath, "'Connection is secure',", "'连接安全',");
    replaceInFile(webviewSecurityPath, "'Connection security information is not available for this page'", "'无法获取此页面的连接安全信息'");
    replaceInFile(webviewSecurityPath, "label: 'Connection info…',", "label: '连接信息…',");
    replaceInFile(webviewSecurityPath, "title: 'Connection info',", "title: '连接信息',");
    replaceInFile(webviewSecurityPath, "buttons: ['OK'],", "buttons: ['确定'],");
  }

  // 14. Localize dist/remote/disconnectedPage.js (Remote SSH 断开/重连过渡页, v2.32.1+)
  const disconnectedPagePath = path.join(EXTRACT_DIR, 'dist', 'remote', 'disconnectedPage.js');
  if (fs.existsSync(disconnectedPagePath)) {
    replaceInFile(disconnectedPagePath, "const title = connecting ? 'Reconnecting…' : 'Disconnected';", "const title = connecting ? '正在重新连接…' : '已断开连接';");
    replaceInFile(disconnectedPagePath, "const heading = connecting\n        ? `Reconnecting to ${host}…`\n        : `Disconnected from ${host}`;", "const heading = connecting\n        ? `正在重新连接到 ${host}…`\n        : `已断开与 ${host} 的连接`;");
    replaceInFile(disconnectedPagePath, "const body = connecting\n        ? `Agents keep running on ${host}.`\n        : `Agents keep running on ${host} unless its server stopped.`;", "const body = connecting\n        ? `智能体将在 ${host} 上继续运行。`\n        : `智能体将在 ${host} 上继续运行（除非其服务端已停止）。`;");
    replaceInFile(disconnectedPagePath, '<a class="button primary" href="${action(\'reconnect\')}">Reconnect</a>', '<a class="button primary" href="${action(\'reconnect\')}">重新连接</a>');
    replaceInFile(disconnectedPagePath, '<a class="button" href="${action(\'close\')}">Close</a>', '<a class="button" href="${action(\'close\')}">关闭</a>');
  }

  // 15. Localize dist/remote/sshPrompts.js (Remote SSH 凭据与安全密钥弹窗, v2.32.1+)
  const sshPromptsPath = path.join(EXTRACT_DIR, 'dist', 'remote', 'sshPrompts.js');
  if (fs.existsSync(sshPromptsPath)) {
    replaceInFile(sshPromptsPath, '<div id="retry" class="note" hidden>Asked again: your last answer may not have worked.</div>', '<div id="retry" class="note" hidden>再次提示：上一次输入的密码或凭据可能不正确。</div>');
    replaceInFile(sshPromptsPath, '<div id="long" class="note" hidden>That\'s too long.</div>', '<div id="long" class="note" hidden>内容过长。</div>');
    replaceInFile(sshPromptsPath, '<div class="buttons"><button id="cancel">Cancel</button><button id="continue">Continue</button></div>', '<div class="buttons"><button id="cancel">取消</button><button id="continue">继续</button></div>');
    replaceInFile(sshPromptsPath, "message: confirm ? `${label} asks:` : 'Touch your security key',", "message: confirm ? `${label} 询问：` : '请轻触你的安全密钥',");
    replaceInFile(sshPromptsPath, "buttons: confirm ? ['Yes', 'No'] : ['Cancel'],", "buttons: confirm ? ['是', '否'] : ['取消'],");
  }

  // 16. Localize dist/remote/sshPromptPreload.js (Remote SSH 密码弹窗 Preload, v2.32.1+)
  const sshPromptPreloadPath = path.join(EXTRACT_DIR, 'dist', 'remote', 'sshPromptPreload.js');
  if (fs.existsSync(sshPromptPreloadPath)) {
    replaceInFile(sshPromptPreloadPath, "asks.textContent = `${label} asks:`;", "asks.textContent = `${label} 询问：`;");
  }

  // 17. Localize dist/remote/remoteManager.js (Remote SSH 主机管理对话框, v2.32.1+)
  const remoteManagerPath = path.join(EXTRACT_DIR, 'dist', 'remote', 'remoteManager.js');
  if (fs.existsSync(remoteManagerPath)) {
    replaceInFile(remoteManagerPath, "title: 'Choose an SSH config file',", "title: '选择 SSH 配置文件',");
    replaceInFile(remoteManagerPath, "title: 'Stop SSH server',", "title: '停止 SSH 服务端',");
    replaceInFile(remoteManagerPath, "message: `Stop the Antigravity server on ${entry.label}?`,", "message: `停止 ${entry.label} 上的 Antigravity 服务端？`,");
    replaceInFile(remoteManagerPath, "buttons: ['Stop Server', 'Cancel'],", "buttons: ['停止服务端', '取消'],");
    replaceInFile(remoteManagerPath, "message: `Not connected to ${label}`,", "message: `未连接到 ${label}`,");
    replaceInFile(remoteManagerPath, "detail: 'Reconnect first, then stop its server.',", "detail: '请先重新连接，然后再停止其服务端。',");
    replaceInFile(remoteManagerPath, "buttons: ['Sign In', 'Cancel'],", "buttons: ['登录', '取消'],");
    replaceInFile(remoteManagerPath, "title: 'Sign in',", "title: '登录',");
    replaceInFile(remoteManagerPath, "message: `Sign in to your organization for ${entry.label}?`,", "message: `为 ${entry.label} 登录到您的组织？`,");
  }

  // 18. Localize dist/remote/sshArgs.js (Remote SSH 错误与连接提示, v2.32.1+)
  const sshArgsPath = path.join(EXTRACT_DIR, 'dist', 'remote', 'sshArgs.js');
  if (fs.existsSync(sshArgsPath)) {
    replaceInFile(sshArgsPath, "yes: 'SSH authentication failed. Check your password, code or keys, then try again.',", "yes: 'SSH 身份验证失败。请检查密码、动态验证码或密钥，然后重试。',");
    replaceInFile(sshArgsPath, "onReconnect: 'SSH authentication failed. Click Reconnect to sign in again.',", "onReconnect: 'SSH 身份验证失败。请点击重新连接以再次登录。',");
    replaceInFile(sshArgsPath, 'no: "SSH authentication failed. Antigravity can\'t answer password or code prompts on Windows yet: set up key-based login with ssh-agent, then try again.",', 'no: "SSH 身份验证失败。Antigravity 暂不支持在 Windows 下响应密码或动态码交互提示：请通过 ssh-agent 配置密钥免密登录后重试。",');
    replaceInFile(sshArgsPath, "case 'INVALID_DESTINATION':\n            return \"That SSH host isn't valid. Enter an alias from your SSH config or a host like user@host or user@host:2222.\";", "case 'INVALID_DESTINATION':\n            return \"该 SSH 主机地址无效。请输入 SSH 配置中的别名或类似 user@host、user@host:2222 的格式。\";");
    replaceInFile(sshArgsPath, "case 'FORWARDING_PROHIBITED':\n            return 'SSH port forwarding failed. Make sure the server allows TCP forwarding (AllowTcpForwarding) for your account, then try again.';", "case 'FORWARDING_PROHIBITED':\n            return 'SSH 端口转发失败。请确认服务端已允许您的账户进行 TCP 转发 (AllowTcpForwarding)，然后重试。';");
    replaceInFile(sshArgsPath, "case 'UNSUPPORTED_HOST':\n            return \"The SSH host isn't supported. Antigravity needs Linux on x64 or arm64 with glibc 2.26 or newer.\";", "case 'UNSUPPORTED_HOST':\n            return \"该 SSH 主机不受支持。Antigravity 需要搭载 glibc 2.26 或更新版本的 Linux x64 或 arm64 系统。\";");
    replaceInFile(sshArgsPath, "case 'SHARED_HOME_UNSUPPORTED':\n            return 'Another host that shares your home directory runs the Antigravity server. Connect to that host instead.';", "case 'SHARED_HOME_UNSUPPORTED':\n            return '与此主目录共享的另一台主机正在运行 Antigravity 服务端。请改为连接该主机。';");
    replaceInFile(sshArgsPath, "case 'INSTALL_FAILED':\n            return \"Couldn't install the Antigravity server on the SSH host. Make sure it has free disk space, and that it or this computer can download from the internet.\";", "case 'INSTALL_FAILED':\n            return \"无法在 SSH 主机上安装 Antigravity 服务端。请确认该主机磁盘空间充足，且该主机或本计算机能够访问互联网下载。\";");
    replaceInFile(sshArgsPath, "case 'LS_STOPPED':\n            return 'The Antigravity server on the SSH host stopped. Reconnect to start it again.';", "case 'LS_STOPPED':\n            return 'SSH 主机上的 Antigravity 服务端已停止。请重新连接以启动它。';");
    replaceInFile(sshArgsPath, "case 'CONNECTION_CLOSED':\n            return 'The SSH connection closed. Check your network connection, then reconnect.';", "case 'CONNECTION_CLOSED':\n            return 'SSH 连接已断开。请检查网络连接后重新连接。';");
    replaceInFile(sshArgsPath, "case 'CANCELLED':\n            return 'The connection was cancelled.';", "case 'CANCELLED':\n            return '连接已取消。';");
  }


  log('汉化修改注入完成！');
}

// isLocalizedAsar 已统一在 auto-restore.js 中维护并引入

// Full workflow runner
async function runLocalizationWorkflow(appDir) {
  const resourcesDir = getResourcesDir(appDir);
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.bak');

  logs = [];
  log('=================== 开始汉化流程 ===================');
  log(`目标程序目录: ${appDir}`);

  // Check path
  if (!fs.existsSync(asarPath)) {
    throw new Error(`找不到 app.asar 路径: ${asarPath}\n请确认软件是否安装在指定路径。`);
  }

  // 1. Kill running instances
  killApp();

  // 2. Backup app.asar (avoid backing up an already localized file)
  if (!fs.existsSync(backupPath)) {
    if (isLocalizedAsar(asarPath)) {
      log('提示：当前系统 app.asar 已包含汉化代码，跳过自动备份以避免污染官方原版备份。');
    } else {
      log('正在创建 app.asar 的初始安全备份...');
      fs.copyFileSync(asarPath, backupPath);
      log('安全备份创建成功：' + backupPath);
    }
  } else {
    if (isLocalizedAsar(backupPath)) {
      log('警告：检测到备份文件 app.asar.bak 已被汉化包污染！建议在有官方原版时替换此备份。');
    } else {
      log('安全备份已存在且为官方原版，跳过备份。备份文件: ' + backupPath);
    }
  }

  // 3. Clean up existing extract dir if any
  if (fs.existsSync(EXTRACT_DIR)) {
    log('正在清理历史解压目录...');
    if (typeof fs.rmSync === 'function') {
      fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
    } else {
      fs.rmdirSync(EXTRACT_DIR, { recursive: true });
    }
  }

  // 4. Unpack app.asar
  //    注意：必须解包当前 app.asar（而非 .bak 备份），因为 Electron 的
  //    app.asar.unpacked 配套目录不会被备份，从 .bak 解包会因缺失 unpacked
  //    文件而失败。重复注入问题由 applyTranslations() 内的幂等检查解决。
  log('正在解包 app.asar...');
  try {
    execSync(`${getAsarCmd()} extract "${asarPath}" "${EXTRACT_DIR}"`, { cwd: WORKSPACE_DIR });
    log('解包成功。');
  } catch (e) {
    throw new Error('解压 app.asar 失败: ' + e.message);
  }

  // 5. Apply modifications
  applyTranslations();

  // 6. Repack to temporary file
  const tempAsar = path.join(WORKSPACE_DIR, 'app.asar.temp');
  if (fs.existsSync(tempAsar)) {
    fs.unlinkSync(tempAsar);
  }

  log('正在将修改后的文件重新打包为 app.asar...');
  try {
    execSync(`${getAsarCmd()} pack "${EXTRACT_DIR}" "${tempAsar}" --unpack-dir "**/chrome-devtools-mcp/**"`, { cwd: WORKSPACE_DIR });
    log('打包成功。');
  } catch (e) {
    throw new Error('打包新 asar 失败: ' + e.message);
  }

  // 7. Deploy newly packed app.asar
  log('正在部署新的汉化 app.asar...');
  try {
    fs.copyFileSync(tempAsar, asarPath);
    fs.unlinkSync(tempAsar);
    log('汉化 app.asar 部署成功！');
  } catch (e) {
    throw new Error('复制汉化包到系统程序目录失败 (请检查是否有读写权限): ' + e.message);
  }

  log('🎉 Antigravity 2.0 一键汉化成功完成！现在您可以安全启动程序了。');
  log('=================== 汉化流程结束 ===================');
}

// Restore workflow
function runRestoreWorkflow(appDir) {
  const resourcesDir = getResourcesDir(appDir);
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.bak');

  logs = [];
  log('=================== 开始还原流程 ===================');
  log(`目标程序目录: ${appDir}`);
  if (!fs.existsSync(backupPath)) {
    throw new Error('未找到备份文件 `app.asar.bak`。无法执行恢复！');
  }
  if (isLocalizedAsar(backupPath)) {
    throw new Error('检测到备份文件 `app.asar.bak` 本身已被汉化包污染，无法还原为官方原版！请重新安装官方安装包以恢复。');
  }

  killApp();

  log('正在从安全备份恢复原始官方 app.asar...');
  try {
    fs.copyFileSync(backupPath, asarPath);
    log('还原原始 app.asar 成功！软件已恢复为官方英文版。');
  } catch (e) {
    throw new Error('恢复文件失败: ' + e.message);
  }
  log('=================== 还原流程结束 ===================');
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API routing
  if (releaseManager.handleRequest(req, res)) return;
  if (packageInstaller.handleRequest(req, res)) return;

  if (req.url.startsWith('/api/status') && req.method === 'GET') {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const username = urlObj.searchParams.get('username') || '';
    const useDefault = urlObj.searchParams.get('useDefault') !== 'false';
    const customPath = urlObj.searchParams.get('customPath') || '';

    const appDir = getAppDir(username, useDefault, customPath);
    const resourcesDir = getResourcesDir(appDir);
    const asarPath = path.join(resourcesDir, 'app.asar');
    const backupPath = path.join(resourcesDir, 'app.asar.bak');

    const isInstalled = fs.existsSync(asarPath);
    const hasBackup = fs.existsSync(backupPath) && !isLocalizedAsar(backupPath);
    const isRunning = isAppRunning();
    const installedPackageVersion = isInstalled ? readAsarPackageVersion(asarPath) : null;
    const isLocalized = isInstalled && isLocalizedAsar(asarPath);
    const isUpdateOverwritten = Boolean(isInstalled && !isLocalized);

    findAvailablePatch({ workspaceDir: WORKSPACE_DIR, targetVersion: installedPackageVersion, releaseManager })
      .then(patch => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          isInstalled,
          hasBackup,
          isRunning,
          asarPath,
          backupPath,
          platform: process.platform,
          defaultUsername: getHostUsername(),
          currentVersion: CURRENT_VERSION,
          installedPackageVersion,
          isLocalized,
          isUpdateOverwritten,
          patchAvailable: Boolean(patch),
          patchVersion: patch ? patch.version : null,
          patchIsMatch: patch ? patch.isMatch : false
        }));
      })
      .catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          isInstalled,
          hasBackup,
          isRunning,
          asarPath,
          backupPath,
          platform: process.platform,
          defaultUsername: getHostUsername(),
          currentVersion: CURRENT_VERSION,
          installedPackageVersion,
          isLocalized,
          isUpdateOverwritten,
          patchAvailable: false,
          patchVersion: null,
          patchIsMatch: false
        }));
      });
  }
  else if (req.url === '/api/auto-restore' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = body ? JSON.parse(body) : {};
        const appDir = getAppDir(params.username, params.useDefault, params.customPath);
        const result = await executeAutoRestore({
          appDir,
          getResourcesDir,
          workspaceDir: WORKSPACE_DIR,
          releaseManager,
          isAppRunning: isAppRunningStrict,
          stopProcesses: killApp,
          forceStop: params.forceStop !== false
        });
        log(result.message);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, result, logs }));
        } else {
          const status = result.code === 'VERSION_MISMATCH' ? 409 : 400;
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: result.message, result, logs }));
        }
      } catch (err) {
        log(`自动恢复流程异常: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message, logs }));
      }
    });
  } 
  else if (req.url === '/api/localize' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const params = body ? JSON.parse(body) : {};
        const appDir = getAppDir(params.username, params.useDefault, params.customPath);
        runLocalizationWorkflow(appDir)
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, logs }));
          })
          .catch((err) => {
            log(`汉化流程失败: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message, logs }));
          });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: '请求解析失败: ' + e.message, logs }));
      }
    });
  } 
  else if (req.url === '/api/restore' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const params = body ? JSON.parse(body) : {};
        const appDir = getAppDir(params.username, params.useDefault, params.customPath);
        runRestoreWorkflow(appDir);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, logs }));
      } catch (err) {
        log(`恢复流程失败: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message, logs }));
      }
    });
  } 
  else if (req.url === '/api/launch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const params = body ? JSON.parse(body) : {};
        const appDir = getAppDir(params.username, params.useDefault, params.customPath);

        if (process.platform === 'darwin') {
          // macOS: 使用 open 命令启动 .app 包
          // 提取以 .app 结尾的完整应用路径
          const match = appDir.match(/^.*\.app/);
          const appBundlePath = match ? match[0] : appDir;
          log(`正在尝试启动 Antigravity 2.0 (macOS: open -a ${appBundlePath})...`);
          spawn('open', ['-a', appBundlePath], { detached: true, stdio: 'ignore' }).unref();
          log('Antigravity 2.0 启动指令已发送。');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, logs }));
        } else {
          const exeName = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
          const appPath = path.join(appDir, exeName);
          log(`正在尝试启动 Antigravity 2.0 (路径: ${appPath})...`);
          if (fs.existsSync(appPath)) {
            spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();
            log('Antigravity 2.0 启动指令已发送。');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, logs }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: '未找到可执行程序: ' + appPath, logs }));
          }
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: '请求解析失败: ' + e.message, logs }));
      }
    });
  }
  else if (req.url === '/api/kill' && req.method === 'POST') {
    try {
      killApp();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, logs }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: e.message, logs }));
    }
  }
  else if (req.url === '/api/clean-cache' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const params = body ? JSON.parse(body) : {};
        const count = cleanAppCache(params.username);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, cleanedCount: count, logs }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: e.message, logs }));
      }
    });
  }
  else if (req.url === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ logs }));
  }
  else if (req.url === '/api/check-release' && req.method === 'GET') {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/liominsb/Antigravity-Chinese-Localization/releases/latest',
      headers: {
        'User-Agent': 'Antigravity-Chinese-Localization-Console'
      },
      timeout: 8000
    };

    const ghReq = https.get(options, (ghRes) => {
      let data = '';
      ghRes.on('data', chunk => { data += chunk; });
      ghRes.on('end', () => {
        try {
          if (ghRes.statusCode >= 200 && ghRes.statusCode < 300) {
            const release = JSON.parse(data);
            const latestTag = release.tag_name || '';
            const cleanLatest = latestTag.replace(/^[vV]/, '');
            const hasUpdate = compareVersions(cleanLatest, CURRENT_VERSION) > 0;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: true,
              currentVersion: CURRENT_VERSION,
              latestVersion: cleanLatest,
              hasUpdate,
              releaseName: release.name || latestTag,
              releaseUrl: release.html_url,
              publishedAt: release.published_at,
              body: release.body || ''
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: false,
              currentVersion: CURRENT_VERSION,
              error: `GitHub API 响应异常 (HTTP ${ghRes.statusCode})`
            }));
          }
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            currentVersion: CURRENT_VERSION,
            error: '解析 GitHub Release 数据失败: ' + err.message
          }));
        }
      });
    });

    ghReq.on('error', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        currentVersion: CURRENT_VERSION,
        error: '连接 GitHub 失败: ' + err.message
      }));
    });

    ghReq.on('timeout', () => {
      ghReq.destroy();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        currentVersion: CURRENT_VERSION,
        error: '请求 GitHub API 超时 (网络连接受限)'
      }));
    });
  }
  // Serve the dashboard
  else if (req.url === '/' || req.url === '/index.html') {
    const indexPath = path.join(WORKSPACE_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexPath));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('index.html not found.');
    }
  } 
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// 命令行参数白名单校验（issue #40）
// 此前未识别的参数（例如旧文档里记载的 --restore / --extract-only / --pack-only）
// 会静默落入下方的 Web 面板分支并占住端口，命令看起来"执行成功"，实际什么都没做。
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

if (process.argv.includes('--apply-only')) {
  try {
    applyTranslations();
    console.log('[成功] 静态文件汉化注入全部成功！');
    process.exit(0);
  } catch (err) {
    console.error('[失败] 汉化注入失败:', err.message);
    process.exit(1);
  }
}

if (process.argv.includes('--auto-restore')) {
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
      forceStop: true
    });
    console.log(result.message);
    if (result.success) {
      if (result.code === 'RESTORED') {
        console.log('\n[成功] 汉化已顺利恢复为最新状态。');
      } else {
        console.log('\n[状态正常] 客户端运行正常，无需重复操作。');
      }
      process.exit(0);
    } else {
      if (result.code === 'VERSION_MISMATCH') {
        console.error('\n[版本警告] 发现官方版本更新，本地暂无兼容补丁。');
        process.exit(2);
      } else {
        console.error('\n[失败] 自动恢复汉化未能完成。');
        process.exit(1);
      }
    }
  })().catch(err => {
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
  })().catch(err => {
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
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`\n======================================================`);
      console.log(` [提示] Antigravity 2.0 汉化服务已经在运行中！(端口 ${PORT})`);
      console.log(` 本地管理面板: http://localhost:${PORT}`);
      console.log(`======================================================\n`);
    } else {
      console.error('服务启动异常:', err.message);
    }
  });

  server.listen(PORT, async () => {
    console.log(`\n======================================================`);
    console.log(` Antigravity 2.0 汉化服务已在后台运行！`);
    console.log(` 本地管理面板: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
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
