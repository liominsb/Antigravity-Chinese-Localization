const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');

const PORT = 3388;
const WORKSPACE_DIR = __dirname;
const EXTRACT_DIR = path.join(WORKSPACE_DIR, 'extracted');

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
      const output = execSync('tasklist', { encoding: 'utf-8' });
      return output.toLowerCase().includes('antigravity.exe');
    } else {
      const output = execSync('pgrep -fl antigravity', { encoding: 'utf-8' });
      return output.toLowerCase().includes('antigravity');
    }
  } catch (e) {
    return false;
  }
}

// Kill Antigravity processes
function killApp() {
  log('正在尝试关闭运行中的 Antigravity 2.0...');
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' });
    } else {
      execSync('pkill -f antigravity', { stdio: 'ignore' });
    }
    log('已成功强制关闭 Antigravity 进程！');
  } catch (e) {
    log('Antigravity 未在运行或关闭时无需操作。');
  }
}

// Compute standard app directory based on dynamic username or custom path input
function getAppDir(username, useDefault, customPath) {
  if ((useDefault === false || useDefault === 'false') && customPath) {
    return customPath.trim();
  }
  const isWin = process.platform === 'win32';
  const defaultUser = getHostUsername();
  const user = username ? username.trim() : defaultUser;
  if (isWin) {
    return `C:\\Users\\${user}\\AppData\\Local\\Programs\\antigravity`;
  } else {
    return `/home/${user}/Antigravity/Antigravity-x64`;
  }
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
    "Create New Project": "创建新项目",
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
    "100.0% of the customization budget is available.": "100.0% 的自定义额度可用。",
    "No customizations found for this workspace.": "未找到此工作区的自定义项。",
    "Installed MCP Servers": "已安装的 MCP 服务器",
    "No MCP Servers": "无已安装的 MCP 服务器",
    "You currently don't have any MCP Servers installed.": "您当前未安装任何 MCP 服务器。",
    "Add an MCP server above": "在上方添加一个 MCP 服务器",
    "Build With Google Plugins": "使用 Google 插件构建",
    
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
    
    // Browser & App Settings
    "Browser Settings": "浏览器设置",
    "Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.": "配置浏览器子智能体。这需要安装 Google Chrome。可以在对话输入框中输入 /browser 来调用浏览器子智能体。",
    "Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing": "配置浏览器子智能体。这需要安装 Google Chrome。可以通过输入",
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
    "Provide Feedback": "提供反馈",
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
    "Error checking for updates": "检查更新失败"
  };

  const coreWords = {
    "create": "创建", "delete": "删除", "new": "新建", "edit": "编辑", "save": "保存", "cancel": "取消", "confirm": "确认",
    "close": "关闭", "open": "打开", "stop": "停止", "start": "启动", "run": "运行", "add": "添加", "remove": "移除",
    "update": "更新", "select": "选择", "clear": "清除", "search": "搜索", "find": "查找", "view": "查看", "show": "显示", "hide": "隐藏",
    "agent": "智能体", "agents": "智能体", "subagent": "子智能体", "subagents": "子智能体", "task": "任务", "tasks": "任务",
    "workspace": "工作区", "workspaces": "工作区", "directory": "目录", "folder": "文件夹", "file": "文件", "files": "文件",
    "command": "命令", "commands": "命令", "terminal": "终端", "console": "控制台", "output": "输出", "input": "输入",
    "log": "日志", "logs": "日志", "setting": "设置", "settings": "设置", "preference": "偏好", "preferences": "偏好",
    "theme": "主题", "themes": "主题", "model": "模型", "models": "模型", "capability": "能力", "capabilities": "能力",
    "running": "运行中", "completed": "已完成", "failed": "已失败", "pending": "等待中", "success": "成功", "error": "错误",
    "system": "系统", "prompt": "提示词", "instructions": "指令", "description": "描述", "name": "名称", "version": "版本",
    "active": "活跃", "background": "后台", "parent": "父级", "child": "子级", "branch": "分支", "share": "共享", "inherit": "继承",
    "original": "原始", "backup": "备份", "duration": "持续时间", "seconds": "秒", "timer": "定时器", "timers": "定时器",
    "schedule": "调度", "cron": "定时任务", "tools": "工具", "tool": "工具", "execute": "执行", "execution": "执行", "plan": "计划",
    "chat": "聊天", "message": "消息", "messages": "消息", "history": "历史", "clear history": "清除历史",
    "worked": "工作了", "changed": "已更改", "review": "审核", "reviewing": "审核中", "reviewed": "已审核", "for": "持续",
    "thought": "思考了", "edited": "编辑了", "canceled": "已取消", "js": "Js",
    "explore": "探索", "explored": "浏览了", "change": "更改", "changes": "更改",
    "turn": "回合", "turns": "回合"
  };

  const combinedDict = Object.assign({}, coreWords, dictionary);

  const escapeRegExp = (str) => {
    const specials = ['[', ']', '(', ')', '{', '}', '*', '+', '?', '.', '^', '$', '|', '\\\\'];
    return str.split('').map(c => specials.includes(c) ? '\\\\' + c : c).join('');
  };

  function translateString(text) {
    if (!text) return text;
    const trimmed = text.trim();
    if (!trimmed) return text;

    // --- Dynamic Agent Logs Regex Rules (Fixed Escaping) ---
    let dynamicMatch = trimmed;
    let isDynamic = false;
    
    if (/^Worked for \\d+s$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/Worked for (\\d+)s/, '已工作 $1 秒');
      isDynamic = true;
    }
    if (/^Thought for \\d+s$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/Thought for (\\d+)s/, '已思考 $1 秒');
      isDynamic = true;
    }
    if (/^Edited .* \\+\\d+ -\\d+$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/Edited (.*) \\+(\\d+) -(\\d+)/, '编辑了 $1 (+$2 -$3)');
      isDynamic = true;
    }
    if (/^\\d+ files? changed$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\\d+) files? changed(.*)/, '$1 个文件已更改$2');
      isDynamic = true;
    }
    if (/^Explored/.test(trimmed)) {
      if (/^Explored \\d+ files?$/.test(trimmed)) {
        dynamicMatch = dynamicMatch.replace(/^Explored (\\d+) files?(.*)/, '浏览了 $1 个文件$2');
      } else if (/^Explored (.*)$/.test(trimmed)) {
        dynamicMatch = dynamicMatch.replace(/^Explored (.*)/, '浏览了 $1');
      }
      isDynamic = true;
    }
    if (/^Canceled taskkill/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Canceled (.*)/, '已取消 $1');
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
    
    const trimmedLower = trimmed.toLowerCase();
    for (const key in dictionary) {
      if (key.toLowerCase() === trimmedLower) {
        return text.replace(trimmed, dictionary[key]);
      }
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

    // Check stripped core in dictionary
    let coreTranslated = '';
    if (dictionary[core]) {
      coreTranslated = dictionary[core];
    } else {
      const coreLower = core.toLowerCase();
      for (const key in dictionary) {
        if (key.toLowerCase() === coreLower) {
          coreTranslated = dictionary[key];
          break;
        }
      }
    }

    if (coreTranslated) {
      return text.replace(trimmed, coreTranslated + trailPunc);
    }

    // 3. Fallback to word-by-word ONLY for short strings (<= 3 words)
    // 如果短语中已经包含了中文字符（即原本就是汉化内容或中英混排），则严禁进入英文分词翻译
    // 这可以完美阻止像中英文混排短语被分词规则执行二次翻译导致重叠和污染
    if (/[\u4e00-\u9fa5]/.test(core)) {
      return text;
    }
    // This prevents long unmatched sentences from getting mangled into Chinglish.
    const wordsCount = core.split(/\s+/).filter(Boolean).length;
    if (wordsCount > 3) {
      return text; // Do not translate, keep original English sentence clean
    }

    let temp = core;
    let replaced = false;
    const sortedKeys = Object.keys(combinedDict).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (key.length <= 3 && !/^[a-zA-Z0-9]+$/.test(key)) continue;
      const escapedKey = escapeRegExp(key);
      const startBoundary = /^[a-zA-Z0-9]/.test(key) ? '\\\\b' : '';
      const endBoundary = /[a-zA-Z0-9]$/.test(key) ? '\\\\b' : '';
      const regex = new RegExp(startBoundary + escapedKey + endBoundary, 'gi');
      if (regex.test(temp)) {
        temp = temp.replace(regex, combinedDict[key]);
        replaced = true;
      }
    }

    let finalTranslated = replaced ? temp : core;
    // 消除中文字符之间可能由分词替换残留的英文空格，提升翻译句子的连贯精致度
    finalTranslated = finalTranslated.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
    if (matchPunc) {
      finalTranslated += trailPunc;
    }
    return text.replace(trimmed, finalTranslated);
  }

  function shouldSkipNode(node) {
    if (!node) return true;
    
    // 如果是文本节点，我们检查其父元素；如果是属性/元素节点，检查自身
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) return false;

    // 1. 绝对不能翻译的脚本/样式/代码块标签
    const skipTags = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT'];
    if (skipTags.includes(element.tagName)) {
      return true;
    }

    // 2. 如果是文本节点，并且其父元素是输入框/文本域，必须跳过文本节点翻译
    if (node.nodeType === Node.TEXT_NODE) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return true;
      }
    }

    // 3. 向上递归检查祖先节点，判断是否处于富文本编辑区（contenteditable="true"）或代码编辑器中
    let cur = element;
    while (cur) {
      if (cur.getAttribute && cur.getAttribute('contenteditable') === 'true') {
        return true;
      }
      if (cur.classList && (
        cur.classList.contains('monaco-editor') || 
        cur.classList.contains('editor-instance') ||
        cur.classList.contains('input-area') ||
        cur.classList.contains('chat-input')
      )) {
        return true;
      }
      cur = cur.parentElement;
    }

    return false;
  }

  function translateNode(node) {
    if (!node) return;
    if (shouldSkipNode(node)) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const original = node.nodeValue;
      const translated = translateString(original);
      if (original !== translated) {
        node.nodeValue = translated;
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
      if (node.shadowRoot) {
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

  const observers = [];

  function observeRoot(root) {
    const observer = new MutationObserver((mutations) => {
      observer.disconnect();
      try {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(node => {
              if (!shouldSkipNode(node)) {
                translateNode(node);
              }
            });
          } else if (mutation.type === 'characterData') {
            const node = mutation.target;
            if (!shouldSkipNode(node)) {
              const original = node.nodeValue;
              const translated = translateString(original);
              if (original !== translated) {
                node.nodeValue = translated;
              }
            }
          } else if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (!shouldSkipNode(target)) {
              const attrName = mutation.attributeName;
              if (attrName === 'value' && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
                continue;
              }
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
      } catch (e) {
        console.error('Observer translation error:', e);
      }
      observer.observe(root, observerConfig);
    });
    observer.observe(root, observerConfig);
    observers.push(observer);
  }

  // Hook attachShadow
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function() {
    const shadowRoot = originalAttachShadow.apply(this, arguments);
    observeRoot(shadowRoot);
    return shadowRoot;
  };

  function startObserver() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', startObserver);
      return;
    }
    try {
      translateNode(document.body);
    } catch (e) {
      console.error('Translation error:', e);
    }
    observeRoot(document.body);
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
  content = content.replace(target, replacement);
  fs.writeFileSync(filePath, content, 'utf-8');
  log(`已成功修改 ${path.basename(filePath)}`);
}

// Perform localization modification operations on extracted files
function applyTranslations() {
  log('开始对解压的文件进行汉化替换和代码注入...');

  // 1. Inject DOM Localization in dist/preload.js
  const preloadPath = path.join(EXTRACT_DIR, 'dist', 'preload.js');
  fs.appendFileSync(preloadPath, DOM_TRANSLATOR_INJECTION, 'utf-8');
  log('已向 preload.js 注入 Web UI 实时汉化引擎。');

  // 2. Inject DOM Localization in dist/ideInstall/wizardPreload.js
  const wizardPreloadPath = path.join(EXTRACT_DIR, 'dist', 'ideInstall', 'wizardPreload.js');
  fs.appendFileSync(wizardPreloadPath, DOM_TRANSLATOR_INJECTION, 'utf-8');
  log('已向 wizardPreload.js 注入新版向导 Web UI 汉化引擎。');

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
  'Toggle Full Screen': '切换全屏'
};
function translateMenu(menuItem) {
  if (menuItem.label && menuTranslationMap[menuItem.label]) {
    menuItem.label = menuTranslationMap[menuItem.label];
  }
  if (menuItem.submenu && menuItem.submenu.items) {
    menuItem.submenu.items.forEach(translateMenu);
  }
}
`;
  // Append definitions at the end of the file
  fs.appendFileSync(menuPath, menuInjectCode, 'utf-8');
  log('已向 menu.js 追加翻译映射。');

  // Replace menu application step safely
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

  log('汉化修改注入完成！');
}

// Full workflow runner
async function runLocalizationWorkflow(appDir) {
  const asarPath = path.join(appDir, 'resources', 'app.asar');
  const backupPath = path.join(appDir, 'resources', 'app.asar.bak');

  logs = [];
  log('=================== 开始汉化流程 ===================');
  log(`目标程序目录: ${appDir}`);

  // Check path
  if (!fs.existsSync(asarPath)) {
    throw new Error(`找不到 app.asar 路径: ${asarPath}\n请确认软件是否安装在指定路径。`);
  }

  // 1. Kill running instances
  killApp();

  // 2. Backup app.asar
  if (!fs.existsSync(backupPath)) {
    log('正在创建 app.asar 的初始安全备份...');
    fs.copyFileSync(asarPath, backupPath);
    log('安全备份创建成功：' + backupPath);
  } else {
    log('安全备份已存在，跳过备份。备份文件: ' + backupPath);
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
    execSync(`${getAsarCmd()} pack "${EXTRACT_DIR}" "${tempAsar}"`, { cwd: WORKSPACE_DIR });
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
  const asarPath = path.join(appDir, 'resources', 'app.asar');
  const backupPath = path.join(appDir, 'resources', 'app.asar.bak');

  logs = [];
  log('=================== 开始还原流程 ===================');
  log(`目标程序目录: ${appDir}`);
  if (!fs.existsSync(backupPath)) {
    throw new Error('未找到备份文件 `app.asar.bak`。无法执行恢复！');
  }

  killApp();

  log('正在从备份恢复原始 app.asar...');
  try {
    fs.copyFileSync(backupPath, asarPath);
    log('还原原始 app.asar 成功！软件已恢复为纯英文版。');
  } catch (e) {
    throw new Error('恢复文件失败: ' + e.message);
  }
  log('=================== 还原流程结束 ===================');
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API routing
  if (req.url.startsWith('/api/status') && req.method === 'GET') {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const username = urlObj.searchParams.get('username') || '';
    const useDefault = urlObj.searchParams.get('useDefault') !== 'false';
    const customPath = urlObj.searchParams.get('customPath') || '';

    const appDir = getAppDir(username, useDefault, customPath);
    const asarPath = path.join(appDir, 'resources', 'app.asar');
    const backupPath = path.join(appDir, 'resources', 'app.asar.bak');

    const isInstalled = fs.existsSync(asarPath);
    const hasBackup = fs.existsSync(backupPath);
    const isRunning = isAppRunning();
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      isInstalled,
      hasBackup,
      isRunning,
      asarPath,
      backupPath,
      platform: process.platform,
      defaultUsername: getHostUsername()
    }));
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
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: '请求解析失败: ' + e.message, logs }));
      }
    });
  }
  else if (req.url === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ logs }));
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

if (process.argv.includes('--now')) {
  const defaultAppDir = getAppDir(getHostUsername(), true, '');
  runLocalizationWorkflow(defaultAppDir)
    .then(() => {
      console.log('🎉 汉化打包部署成功！');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ 汉化出错:', err.message);
      process.exit(1);
    });
} else {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` Antigravity 2.0 汉化服务已在后台运行！`);
    console.log(` 本地管理面板: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}
