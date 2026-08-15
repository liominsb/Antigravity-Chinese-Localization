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
    } else if (process.platform === 'darwin') {
      // macOS BSD pgrep: -x 精确匹配进程名, -i 忽略大小写
      execSync('pgrep -xi antigravity', { stdio: 'ignore' });
      return true;
    } else {
      // Linux: 不使用 -i（旧版 procps 不支持），Linux 二进制名为小写 antigravity
      execSync('pgrep -x antigravity', { stdio: 'ignore' });
      return true;
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
    } else if (process.platform === 'darwin') {
      execSync('pkill -xi antigravity', { stdio: 'ignore' });
    } else {
      execSync('pkill -x antigravity', { stdio: 'ignore' });
    }
    log('已成功强制关闭 Antigravity 进程！');
  } catch (e) {
    log('Antigravity 未在运行或关闭时无需操作。');
  }
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
    "Selection": "选择",
    "Find": "查找",
    "Help": "帮助",
    "Docs & API Reference": "文档与 API 参考",
    "Toggle Developer Tools": "开发者工具",
    "Quit": "退出",
    "Confirm Quit": "确认退出",
    "Are you sure you want to quit?": "您确定要退出吗？",
    "There may be agents or background tasks running.": "可能还有智能体或后台任务正在运行。",
    "Welcome to the new Antigravity!": "欢迎使用全新 Antigravity！",
    "Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named": "Antigravity 已经重构为以智能体为核心的全新平台。如果您仍需要代码编辑器，可以将其作为名为以下的独立应用下载：",
    "Antigravity IDE": "Antigravity IDE 编辑器",
    "Download the Antigravity IDE": "下载 Antigravity IDE",
    "Explore the new Antigravity": "探索全新 Antigravity",
    "Setting up…": "正在启动/设置中...",
    "Subagent": "子智能体",
    "Subagents": "子智能体",
    "Run": "运行",
    "Stop": "停止",
    "Approve": "批准",
    "Reject": "拒绝",
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
    "timer": "定时器",

    // Added sentences & refined for user experience
    "Configure global allowed and denied resource permissions. Learn more.": "配置全局允许与拒绝的资源访问权限。了解更多。",
    "Configure global allowed and denied resource permissions.": "配置全局允许与拒绝的资源访问权限。",
    "Modify scoped permissions, folders, and Agent settings": "修改项目专属访问权限、工作文件夹以及智能体设置",
    "like Sandbox and Terminal command execution.": "例如沙盒与终端命令执行。",

    // Appearance & Settings
    "Configure the Agent's visual theme and display preferences.": "配置智能体的视觉主题与显示偏好。",
    "Display and preserve intermediate thinking steps": "显示并保留智能体中间思考过程",
    "Choose light, dark, or inherit system settings.": "选择浅色、深色，或继承系统设置。",
    "Light Theme": "浅色主题",
    "Default Light": "默认浅色",
    "Background": "背景色",
    "Foreground": "前景色",
    "Accent": "强调色",
    "Dark Theme": "深色主题",
    "Default Dark": "默认深色",
    
    // Customizations
    "Configure default behaviors, skills, and MCP servers.": "配置默认行为、技能以及 MCP 服务器。",
    "Add an MCP server above": "在上方添加一个 MCP 服务器",
    
    // Account
    
    // Browser & App Settings
    "Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.": "配置浏览器子智能体。这需要安装 Google Chrome。可以在对话输入框中输入 /browser 来调用浏览器子智能体。",
    "Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing": "配置浏览器子智能体。这需要安装 Google Chrome。可以通过输入",
    "Configure allowed and denied URLs for browser actuation.": "配置允许或禁止浏览器执行动作的 URL 列表。",
    "The app will be accessible from the menu bar and will keep running in the background when all windows are closed.": "关闭所有窗口后，应用将常驻菜单栏并在后台保持运行。",

    // Agent Settings
    "Choose a predefined security preset for the agent. This controls terminal auto-execution policy, and file access policy.": "为智能体选择预定义的安全预设。这将控制终端自动执行策略和文件访问策略。",
    "Choose a predefined security preset for the agent.": "为智能体选择预定义的安全预设。",
    "This controls terminal auto-execution policy, and file access policy.": "这将控制终端自动执行策略和文件访问策略。",
    "Agent Behavior": "智能体行为",
    "Specifies agent's behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.": "设置智能体在请求审核工件时的行为方式。工件是其为提供更丰富对话体验而创建的文档。",
    
    // Additional Agent Settings & Context Menu
    "Add Context": "添加上下文",
    "Media": "媒体",
    "Mentions": "提及",
    "Actions": "操作",
    "Worktree": "工作树",
    "Review Changes": "审核更改",
    "Ask anything, @ to mention, / for actions": "输入任何问题，输入 @ 提及，/ 触发操作",
    "Ask anything, @to mention, /for actions": "输入任何问题，输入 @ 提及，/ 触发操作",
    "Ask anything, @ to mention, / for commands": "输入任何问题，输入 @ 提及，/ 触发命令",
    "Ask anything, @to mention, /for commands": "输入任何问题，输入 @ 提及，/ 触发命令",
    "Agent settings and permissions for conversations outside of projects.": "项目外部对话的智能体设置和权限配置。",
    "Not in Project": "不在项目中",
    "Manage project folders, agent settings, and permissions.": "管理项目文件夹、智能体设置和专属权限。",

    // Security Presets

    // Themes
    "One Light": "One 浅色",
    "Solarized Light": "Solarized 浅色",
    "One Dark Pro": "One 深色 Pro",
    
    // Models
    "Refresh": "刷新",

    // Shortcuts & UI
    "Keyboard shortcuts for quick navigation and control.": "用于快速导航与控制的键盘快捷键。",

    // Feedback
    "Please describe the feature you'd like to see. The more detailed the requirements, the easier it will be for our team to incorporate your ideas. Some helpful information includes:": "请描述您希望获得的新功能。需求描述越详尽，我们的团队就越容易采纳您的想法。以下是一些建议提供的信息：",
    "What is missing in your workflow": "您的工作流中缺少了什么",
    "What you would like to see to address this gap in your workflow": "您希望通过什么功能来解决这一需求",
    "How this feature would help you and other users": "此功能如何帮助您和其他用户",
    "Describe the feature you would like to see...": "请描述您希望获得的新功能...",

    // Automatic Update Menus

    // ===== 2.2.1 新增 UI 文本补充 =====
    // 窗口与原生 UI

    // 偏好设置区
    "Inherits from": "继承自",

    // 账号区

    // 外观与编辑器
    "Select light, dark, or inherit system settings.": "选择浅色、深色，或继承系统设置。",
    "Configure editor-specific behaviors and shortcuts.": "配置编辑器专属行为与快捷键。",
    "Configure tab completion, suggestions, and navigation behavior.": "配置 Tab 补全、建议以及导航行为。",

    // 编辑器与市场
    "Marketplace Item URL": "扩展市场项目 URL",
    "Marketplace Gallery URL": "扩展市场图库 URL",
    "Changes the base URL on each extension page. You must restart Antigravity to use the new marketplace after changing this value.": "更改每个扩展页面的基础 URL。更改此值后，必须重启 Antigravity 才能使用新的扩展市场。",
    "Changes the base URL for marketplace search results. You must restart Antigravity to use the new marketplace after changing this value.": "更改扩展市场搜索结果的基础 URL。更改此值后，必须重启 Antigravity 才能使用新的扩展市场。",
    "To modify editor settings, open Settings within the editor window.": "如需修改编辑器设置，请在编辑器窗口中打开“设置”。",
    "Editor": "编辑器",
    "Open Editor Settings": "打开编辑器设置",

    // 浏览器子智能体
    "Configure the browser subagent.": "配置浏览器子智能体。",
    "It requires": "它需要",
    "Google Chrome to be installed.": "安装 Google Chrome。",
    "The browser subagent can be invoked by typing": "可以通过输入",
    "/browser": "/browser",
    "in the conversation input box.": "在对话输入框中调用浏览器子智能体。",

    // 对话区
    "Configure the maximum width of the conversation panel.": "配置对话面板的最大宽度。",
    "all": "全部",

    // 分解统计

    // Google Chat / Jetski
    "Configure a chat bot so you can use Jetski directly from Google Chat.": "配置一个聊天机器人，以便您可以直接在 Google Chat 中使用 Jetski。",

    // 反馈区
    "Please describe the issue in detail. The more actionable your feedback, the quicker our team can address your request. Some helpful information includes:": "请详细描述您遇到的问题。反馈越具可操作性，我们的团队就能越快处理您的请求。以下是一些有用的信息：",

    // 通知与其他

    // 权限与提示

    // MCP 相关

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

    // 浏览器设置残片补全
    "to be installed.": "需要安装。",
    "to be installed": "需要安装",
    "or join the": "或加入",

    // aria-label 无障碍标签 (这些会影响屏幕阅读器与提示)

    // ===== 第3轮验证补充 =====
    "current": "当前",
    "Choose a model": "选择模型",
    "Select model": "选择模型",
    "current model": "当前模型",

    // ===== 第4轮验证补充 (显示选项下拉菜单) =====

    // 第5轮: 单数形式补全 (分组选项)
    "project": "项目",
    "projects": "项目",
    "conversation": "对话",
    "workspace": "工作区",

    // ===== 第6轮彻底验证补充 =====
    // 窗口控制
    // 计划任务
    // 配额提示 (含动态时间,用部分匹配)
    // 文件夹与权限
    "folders": "文件夹",
    "Allow/deny agent read access to specific files or directories.": "允许/拒绝智能体读取特定文件或目录。",
    "Allow/deny agent write access to specific files or directories.": "允许/拒绝智能体写入特定文件或目录。",
    // 浏览器子智能体说明(完整句)
    "The browser subagent can be invoked by typing /browser in the conversation input box.": "可以在对话输入框中输入 /browser 来调用浏览器子智能体。",

    // ===== 第7轮验证补充 (项目/文件夹状态提示) =====

    // ===== 第8轮补充 (2.8.1 会话窗口/项目侧栏/辅助窗格/设置全覆盖) =====
    // --- 会话窗口与消息操作 ---
    "Copy": "复制",
    "Copying...": "正在复制...",
    "Copy Content": "复制内容",
    "Copy Path": "复制路径",
    "Copy path": "复制路径",
    "Copy File Name": "复制文件名",
    "Copy File Path": "复制文件路径",
    "Copy Image": "复制图片",
    "Copy output": "复制输出",
    "Copy thinking": "复制思考内容",
    "Copy value": "复制值",
    "Copy description": "复制描述",
    "Copy email address": "复制电子邮件地址",
    "Copy raw string value": "复制原始字符串值",
    "Copy schema JSON": "复制 Schema JSON",
    "Copy section content": "复制章节内容",
    "Copy this subtree JSON": "复制此子树 JSON",
    "Copy config file path": "复制配置文件路径",
    "Copy debug info": "复制调试信息",
    "Copy full URL to clipboard": "复制完整 URL 到剪贴板",
    "Copy conversation markdown": "复制对话为 Markdown",
    "Copy trajectory ID": "复制轨迹 ID",
    "Conversation copied as Markdown to clipboard": "对话已以 Markdown 格式复制到剪贴板",
    "Click to copy URL": "点击复制 URL",
    "Click to copy full command": "点击复制完整命令",
    "Rename": "重命名",
    "Renamed": "已重命名",
    "Failed to rename conversation": "重命名对话失败",
    "Undo": "撤销",
    "Redo": "重做",
    "Confirm Undo": "确认撤销",
    "How to undo": "如何撤销",
    "Archive": "归档",
    "Unarchive": "取消归档",
    "Archive / Restore": "归档 / 恢复",
    "Archive this conversation": "归档此对话",
    "Archive project": "归档项目",
    "Archive Workspace": "归档工作区",
    "Conversation Archived": "对话已归档",
    "Failed to archive workspace": "归档工作区失败",
    "Workspace archived successfully": "工作区归档成功",
    "Failed to unarchive project: project management feature not available": "取消归档项目失败：项目管理功能不可用",
    "Dismiss": "忽略",
    "Duplicate": "创建副本",
    "Pin": "固定",
    "Pinned": "已固定",
    "Pinned Conversations": "已固定对话",
    "Share": "分享",
    "Share Conversation": "分享对话",
    "Failed to share conversation": "分享对话失败",
    "Fork": "分叉",
    "Fork in current workspace": "在当前工作区中分叉",
    "Failed to fork conversation": "对话分叉失败",
    "Split Conversation Horizontally": "水平拆分对话",
    "Split Conversation Vertically": "垂直拆分对话",
    "Remove From Split": "从分屏中移除",
    "Close split view and go to forked conversation": "关闭分屏并跳转到分叉对话",
    "Open Conversation": "打开对话",
    "Open Conversation History": "打开历史对话",
    "Delete Conversation": "删除对话",
    "Failed to delete conversation": "删除对话失败",
    "Failed to stop conversation": "停止对话失败",
    "Failed to start conversation": "启动对话失败",
    "Continue Response": "继续生成回复",
    "Regenerate": "重新生成",
    "Accept Step": "接受此步骤",
    "Reject Step": "拒绝此步骤",
    "Cancel All Tasks": "取消所有任务",
    "Stop Subagent": "停止子智能体",
    "Stop All Subagents": "停止所有子智能体",
    "Start Voice Recording": "开始录音",
    "Stop Voice Recording": "停止录音",
    "Blocked on Your Input": "等待您的输入",
    "Input required": "需要输入",
    "Action required": "需要操作",
    "Conversation unavailable": "对话不可用",
    "Conversation picker": "对话选择器",
    "Conversation Name": "对话名称",
    "Conversation ID": "对话 ID",
    "Conversations reorganized": "对话已重新整理",
    "Mark as Read": "标记为已读",
    "Mark as Unread": "标记为未读",
    "Mark all as read": "全部标记为已读",
    "Failed to mark all as read": "全部标记为已读失败",
    "Quote Selection": "引用所选内容",
    "Selection Actions": "选区操作",
    "Show Selection Actions": "显示选区操作",
    "Add to Chat": "添加到聊天",
    "Add to Chat/Quote": "添加到聊天/引用",
    "Terminal: Add to Chat": "终端：添加到聊天",
    "Mention Page": "提及页面",
    "Find in conversation": "在对话中查找",
    "View archived conversations in [history](notification://history).": "在[历史记录]中查看已归档的对话。",
    "Other Conversations": "其他对话",
    "My Stuff": "我的内容",
    "In Progress": "进行中",
    "Recent": "最近",
    "Recent Files": "最近文件",
    "All Files": "所有文件",
    "More Actions": "更多操作",
    "More actions": "更多操作",
    "Review pending conversations": "审核待处理的对话",
    "Nothing to reorganize": "没有可整理的内容",
    "Conversation Width": "对话宽度",
    "Show": "显示",
    "Hide": "隐藏",
    "All": "全部",
    "First": "第一个",
    "Last": "最后一个",
    "Next": "下一个",
    "Previous": "上一个",
    "Unknown": "未知",
    "Deleted": "已删除",
    "Idle": "空闲",
    "Stopped": "已停止",
    "Enable": "启用",
    "Disable": "禁用",
    "Block": "阻止",
    "Blocked": "已阻止",
    "Overwrite": "覆盖",
    "Read": "读取",
    "Write": "写入",
    "Read Files": "读取文件",
    "Read URL": "读取 URL",
    "Read URLs": "读取 URL",
    "Execute URLs": "执行 URL",
    "File Reads": "文件读取",
    "File Writes": "文件写入",
    "File access": "文件访问",
    "File explorer": "文件浏览器",
    "Files Changed": "更改的文件",
    "Files modified by the agent in this conversation": "智能体在此对话中修改的文件",
    "Download": "下载",
    "Upload": "上传",
    "Export": "导出",
    "Import": "导入",
    "Paste": "粘贴",
    "Cut": "剪切",
    "Select All": "全选",
    "Retry": "重试",
    "Restart": "重启",
    "Pause": "暂停",
    "Resume": "继续",
    "Sort": "排序",
    "Group": "分组",
    "Errors": "错误",
    "Warning": "警告",
    "Info": "信息",
    "Verified": "已验证",
    "Vetted": "已审核",
    "Verification required": "需要验证",
    "Complete verification": "完成验证",
    "Complete Onboarding Step": "完成引导步骤",
    "Continue": "继续",
    "Send": "发送",
    "Apply": "应用",
    "Reset": "重置",
    "Restore": "恢复",
    "Move": "移动",
    "Mention": "提及",
    "Attach": "附加",
    "Record": "录制",
    "Edit": "编辑",
    "Context": "上下文",
    "Plan": "计划",
    "Proceed with Plan": "继续执行计划",
    "Execute plan": "执行计划",
    "Copied": "已复制",
    "Cancel": "取消",
    "Close": "关闭",
    "Open": "打开",
    "Save": "保存",
    "Confirm": "确认",
    "Clear": "清除",
    "Filter": "筛选",
    "Search": "搜索",

    // --- Project / Workspace 侧栏 ---
    "New Project": "新建项目",
    "Create Project": "创建项目",
    "Create project": "创建项目",
    "Project ID": "项目 ID",
    "Project Name": "项目名称",
    "Project Settings": "项目设置",
    "Project picker": "项目选择器",
    "Open project settings": "打开项目设置",
    "Failed to save project": "保存项目失败",
    "Could not create project": "无法创建项目",
    "An unexpected error occurred during creation": "创建过程中发生意外错误",
    "Import AI Studio Project": "导入 AI Studio 项目",
    "Local Side Project": "本地侧项目",
    "Same Project": "同一项目",
    "Group By Project": "按项目分组",
    "Sidebar grouped by project": "侧边栏按项目分组",
    "Group By Workspace": "按工作区分组",
    "Sidebar grouped by workspace": "侧边栏按工作区分组",
    "Updated sidebar grouping": "已更新侧边栏分组",
    "Updates to your sidebar": "侧边栏更新",
    "New Workspace": "新建工作区",
    "Open Workspace": "打开工作区",
    "Open Workspace Selector": "打开工作区选择器",
    "Current Workspace": "当前工作区",
    "Current workspace": "当前工作区",
    "Workspace Settings": "工作区设置",
    "Workspace File Access": "工作区文件访问",
    "Workspace Command Access": "工作区命令访问",
    "Workspace Web Access": "工作区网络访问",
    "Workspace setup warning": "工作区设置警告",
    "Add Workspace": "添加工作区",
    "Add recent remote workspace": "添加最近的远程工作区",
    "Unknown Workspace": "未知工作区",
    "Failed to create workspace.": "创建工作区失败。",
    "Clone current workspace into a new independent workspace": "将当前工作区克隆为新的独立工作区",
    "New Worktree": "新建工作树",
    "New worktree": "新建工作树",
    "Failed to create worktree": "创建工作树失败",
    "Run in a new worktree": "在新工作树中运行",
    "Run in your current workspace": "在当前工作区中运行",
    "Overwrites changes in the target workspace.": "覆盖目标工作区中的更改。",
    "Merge with Conflicts": "带冲突合并",
    "Safe Merge": "安全合并",
    "Checks for pending changes before merging.": "合并前检查待处理的更改。",
    "Merges changes and inserts conflict markers if needed.": "合并更改并在需要时插入冲突标记。",
    "Staged Changes": "已暂存更改",
    "Branch Changes": "分支更改",
    "Manifest Changes": "清单更改",
    "Added (Staged)": "已添加（已暂存）",
    "Untracked (Unstaged)": "未跟踪（未暂存）",
    "Modified": "已修改",
    "True changes vs the parent workspace": "与父工作区的真实差异",
    "Configure Branches": "配置分支",
    "Collapse All Folders": "全部折叠",
    "Expand All Folders": "全部展开",
    "Enter project name...": "输入项目名称...",
    "Enter workspace name (e.g., my-cog-feature)": "输入工作区名称（例如 my-cog-feature）",
    "Open Folder (Interactive)": "打开文件夹（交互式）",

    // --- Auxiliary Pane / 窗格 ---
    "Next Aux Pane Tab": "下一个辅助窗格标签",
    "Previous Aux Pane Tab": "上一个辅助窗格标签",
    "Next Pane Tab": "下一个窗格标签",
    "Previous Pane Tab": "上一个窗格标签",
    "Go Back in Pane": "在窗格中后退",
    "Go Forward in Pane": "在窗格中前进",
    "Next match (Enter)": "下一个匹配项（Enter）",
    "Previous match (Shift+Enter)": "上一个匹配项（Shift+Enter）",
    "Clear search (Esc)": "清除搜索（Esc）",
    "Toggle Editor": "切换编辑器",
    "Toggle File Viewer": "切换文件查看器",
    "Toggle Terminal": "切换终端",
    "Toggle Fullscreen": "切换全屏",
    "Toggle Project Selector": "切换项目选择器",
    "Toggle Environment Selector": "切换环境选择器",
    "Open Preview": "打开预览",
    "Open in Preview Pane": "在预览窗格中打开",
    "Open in Notebook View": "在笔记本视图中打开",
    "Open in Tab": "在标签页中打开",
    "Open in new tab": "在新标签页中打开",
    "Open in Code Search": "在代码搜索中打开",
    "Open in Trajectory Dashboard": "在轨迹仪表板中打开",
    "Open URL": "打开 URL",
    "Embedded web preview": "内嵌网页预览",
    "Opens in the in-app preview pane. Some sites don't support iframe embedding and may not load.": "在内置预览窗格中打开。部分网站不支持 iframe 嵌入，可能无法加载。",
    "Split Down": "向下拆分",
    "Split Right": "向右拆分",
    "Split Terminal": "拆分终端",
    "New Terminal Tab": "新建终端标签",
    "Close Terminal Tab": "关闭终端标签",
    "Close Tab": "关闭标签",
    "Close Settings": "关闭设置",
    "New Editor Window": "新建编辑器窗口",
    "Screen Recording": "屏幕录制",
    "Capture screenshot": "截取屏幕截图",
    "Capture console logs": "捕获控制台日志",
    "Console logs": "控制台日志",
    "Full Error": "完整错误",
    "Run JS": "运行 JS",
    "Paste code here": "在此粘贴代码",
    "Paste auth code": "粘贴授权码",
    "Refresh gcert credentials": "刷新 gcert 凭据",
    "View Page": "查看页面",
    "Binary file not shown": "不显示二进制文件",
    "Invalid Media": "无效媒体",
    "Text attachment": "文本附件",
    "Screenshot": "截图",
    "Standalone Terminals": "独立终端",
    "Standalone Conversations": "独立对话",
    "Standalone": "独立",
    "Double-click to reset panel sizes": "双击重置面板大小",
    "Terminals": "终端",
    "Drawer": "抽屉",
    "Modal": "弹窗",

    // --- 设置：通用/外观/编辑器 ---
    "Advanced Settings": "高级设置",
    "General Settings": "通用设置",
    "Automatic Check for Updates": "自动检查更新",
    "Update Available": "有可用更新",
    "Operating System": "操作系统",
    "Host Environment": "主机环境",
    "User Type": "用户类型",
    "Auto (detected)": "自动（检测）",
    "Electron (Desktop)": "Electron（桌面）",
    "Android (main)": "Android（主）",
    "Google (internal)": "Google（内部）",
    "External": "外部",
    "Enterprise": "企业",
    "Europe": "欧洲",
    "United States": "美国",
    "Mobile": "移动端",
    "Before": "之前",
    "After": "之后",
    "Strict Mode": "严格模式",
    "Display and preserve intermediate thinking steps.": "显示并保留中间思考步骤。",
    "Verbose Agent Chat": "显示智能体详细输出",
    "Chat Settings": "聊天设置",
    "Tab": "Tab 键",
    "Tab Speed": "Tab 补全速度",
    "Set the speed of tab suggestions": "设置 Tab 建议的速度",
    "Tab to Import": "Tab 导入",
    "Quickly add and update imports with a tab keypress.": "按 Tab 快速添加和更新导入。",
    "Tab to Jump": "Tab 跳转",
    "Predict the location of your next edit and navigate you there with a tab keypress.": "预测您下一次编辑的位置，按 Tab 跳转到那里。",
    "Show suggestions when typing in the editor": "在编辑器中输入时显示建议",
    "Suggestions in Editor": "编辑器中的建议",
    "Highlight After Accept": "接受后高亮",
    "Highlight newly inserted text after accepting a Tab completion.": "接受 Tab 补全后高亮显示新插入的文本。",
    "Tab Gitignore Access": "Tab 访问 .gitignore",
    "Experimental Features": "实验性功能",
    "Try out early-stage features before they ship. These may change or be removed at any time.": "体验尚未正式发布的新功能。这些功能可能随时更改或移除。",
    "Labs": "实验室",
    "Developer": "开发者",
    "Developer-only tools. These settings are stored locally in this browser and do not affect other users.": "开发者专属工具。这些设置仅存储在本机浏览器中，不影响其他用户。",
    "Dev mode: Localhost server automatically detected": "开发模式：自动检测本地服务器",
    "Simulate running on a different OS.": "模拟在不同的操作系统上运行。",
    "When enabled, the values below replace the auto-detected OS, host, and user type used for feature gating.": "启用后，以下值将替换用于功能开关的自动检测操作系统、主机和用户类型。",
    "Override feature environment": "覆盖功能环境",
    "[Dev] GCP Project ID": "[开发] GCP 项目 ID",
    "GCP Project ID for enterprise features.": "企业功能所需的 GCP 项目 ID。",
    "Restart Main Language Server": "重启主语言服务器",
    "Reload": "重新加载",
    "Download Diagnostics": "下载诊断信息",
    "Troubleshoot": "故障排查",
    "Uptime": "运行时间",
    "Usage": "使用情况",
    "Outer App Version | Inner App Version": "外层应用版本 | 内层应用版本",
    "Installation": "安装",
    "About": "关于",
    "Label": "标签",
    "Location": "位置",
    "Nickname": "昵称",
    "Enter nickname...": "输入昵称...",
    "A nickname for identifying this application in the companion website. Changing this will restart the connection.": "用于在配套网站中识别此应用的昵称。更改后将重启连接。",
    "If enabled, you can manage your conversations from the companion website.": "启用后，您可以在配套网站中管理对话。",
    "Manage your conversations from the companion website.": "在配套网站中管理您的对话。",
    "Enable Remote Control": "启用远程控制",
    "Remote Control": "远程控制",
    "Don't show this for 2 days": "两天内不再显示",
    "Keep In Menu Bar": "常驻系统托盘",
    "Keep the app accessible from the menu bar and running in the background when all windows are closed.": "关闭所有窗口后，应用仍可从菜单栏访问并在后台运行。",
    "Prevent Sleep": "防止计算机休眠",
    "Prevent the computer from sleeping while the app is running.": "在应用运行时防止计算机进入休眠状态。",
    "Notifications": "通知",
    "Notification Preferences": "通知偏好",
    "Choose whether to be notified when the agent needs your attention or completes a task.": "选择智能体需要您关注或完成任务时是否通知您。",
    "Get notified when the agent needs your attention or completes a task.": "在智能体需要您关注或完成任务时通知您。",
    "Show browser notifications when your action is needed or execution finishes.": "当需要您操作或执行完成时显示浏览器通知。",
    "Enable Notifications": "启用通知",
    "Enable Notifications for Agent": "启用智能体通知",
    "Enable Sounds for Agent": "启用智能体声音",
    "Play a sound when the agent finishes generating a response.": "智能体完成回复生成时播放声音。",
    "When enabled, Antigravity will play a sound when Agent finishes generating a response.": "启用后，Antigravity 将在智能体完成回复生成时播放声音。",
    "Enable Shell Integration": "启用 Shell 集成",
    "When enabled, Agent will use IDE's shell integration to detect and report terminal command execution.": "启用后，智能体将使用 IDE 的 Shell 集成来检测和报告终端命令执行情况。",
    "Enable Demo Mode (Beta)": "启用演示模式（Beta）",
    "Enable Sandbox Mode (Preview)": "启用沙盒模式（预览）",
    "Enable Terminal Sandbox": "启用终端沙盒",
    "Enable Browser Tools": "启用浏览器工具",
    "Enable Chat": "启用聊天",
    "Enable Overages": "允许超额使用",
    "Enable Personal Customizations": "启用个人自定义",

    // --- 设置：账号/计费/配额 ---
    "Not Signed In": "未登录",
    "Log in to use the agent": "登录以使用智能体",
    "To use the agent, please login ": "要使用智能体，请登录 ",
    "There was an error with your authentication. To log in, click ": "您的身份验证出错。要登录，请点击 ",
    "Insufficient AI Credits": "AI 点数不足",
    "AI Credits Used to Generate Response": "生成回复所用的 AI 点数",
    "Baseline model quota reached": "已达到基线模型配额",
    "Model quota reached": "已达到模型配额",
    "Purchase Credits": "购买点数",
    "See Plans": "查看方案",
    "No Model Selected": "未选择模型",
    "No Models Available": "没有可用模型",
    "Error Loading Models": "加载模型失败",
    "Select Model to Send Message": "选择要发送消息的模型",
    "Select a model using the model selector in the input box": "使用输入框中的模型选择器选择模型",
    "Select another model": "选择其他模型",
    "No model specified for Battle Mode, falling back to use current selected model": "未为对战模式指定模型，将回退使用当前所选模型",
    "Battle Mode Infos": "对战模式信息",
    "Best-of-N Ended": "Best-of-N 已结束",
    "Best-of-N Started": "Best-of-N 已开始",
    "Not suitable for Best-of-N": "不适合 Best-of-N",
    "This request is not well-suited for parallel Best-of-N generation.": "此请求不适合并行 Best-of-N 生成。",
    "This prompt is straightforward and does not need alternative comparisons.": "此提示词很简单，无需备选方案对比。",
    "I prefer an immediate single response to prioritize productivity right now.": "我倾向于立即获得单一回复，以优先保证当前效率。",
    "In a rush": "赶时间",
    "Turbo": "极速",
    "Tool Call Generation": "工具调用生成",
    "Tool Execution": "工具执行",
    "Time to First Token (TTFT)": "首 Token 时间 (TTFT)",
    "Segment Metrics": "分段指标",
    "Trajectory Metrics": "轨迹指标",
    "Trajectory Debug View": "轨迹调试视图",
    "Trajectory ID": "轨迹 ID",
    "Trajectory Metadata": "轨迹元数据",
    "Execution ID": "执行 ID",
    "Cascade ID": "级联 ID",
    "Cascade Config": "级联配置",
    "Step Details": "步骤详情",
    "Step Type": "步骤类型",
    "Step details have been cleared": "步骤详情已清除",
    "Start Snapshot": "开始快照",
    "End Snapshot": "结束快照",
    "Reset State": "重置状态",
    "Getting scripts...": "正在获取脚本...",
    "Generator Metadata": "生成器元数据",
    "Daily": "每日",
    "Weekly": "每周",
    "Hourly": "每小时",
    "Monthly": "每月",
    "Streaming Generation": "流式生成",

    // --- 设置：智能体/权限/沙盒/终端 ---
    "Permission Preset": "权限预设",
    "Permission Settings": "权限设置",
    "Access grants": "访问授权",
    "Other Misc Permissions": "其他杂项权限",
    "Agent Script": "智能体脚本",
    "New Agent Script": "新建智能体脚本",
    "Agent Host Address": "智能体主机地址",
    "Agent Team": "智能体团队",
    "Agent Edits": "智能体编辑",
    "Agent Auto-Fix Lints": "智能体自动修复 Lint",
    "Give the agent awareness of lint errors created by its edits so it can fix them without explicit prompting.": "让智能体感知其编辑产生的 Lint 错误，无需明确提示即可修复。",
    "Agent Non-Workspace File Access": "智能体非工作区文件访问",
    "Allows the agent to access files outside of your current workspace.": "允许智能体访问当前工作区之外的文件。",
    "Active Skills": "已启用技能",
    "Installed Skills": "已安装技能",
    "Customize Global Skills": "自定义全局技能",
    "Skill Custom Paths": "技能自定义路径",
    "Refresh skills paths": "刷新技能路径",
    "Default Customizations": "默认自定义",
    "Include Jetski Default Customizations": "包含 Jetski 默认自定义",
    "Include default customizations, such as default skills.": "包含默认自定义项，例如默认技能。",
    "When enabled, the agent will include default customizations, including default skills.": "启用后，智能体将包含默认自定义项（包括默认技能）。",
    "Personal Customizations": "个人自定义",
    "Layer your personal customizations (skills, rules, etc.) from your config on top of the active profile.": "将您配置中的个人自定义项（技能、规则等）叠加到当前配置文件之上。",
    "Generate personalized rules": "生成个性化规则",
    "Custom Agents": "自定义智能体",
    "Team of subagents to do long running work": "用于执行长时间运行工作的子智能体团队",
    "View child subagents": "查看子智能体",
    "Meta-agent for managing conversations": "用于管理对话的元智能体",
    "Steward": "管家",
    "Concierge": "礼宾",
    "Switch Roles": "切换角色",
    "Agent terminated due to error": "智能体因错误而终止",
    "Aborted due to condition callback returning false.": "因条件回调返回 false 而中止。",
    "Allow Once": "允许一次",
    "Allow once": "允许一次",
    "Always Allow": "始终允许",
    "Always run": "始终运行",
    "Ask every time": "每次都询问",
    "Ask first": "先询问",
    "Ask for permission for sensitive operations.": "敏感操作需请求权限。",
    "Allow List Terminal Commands": "终端命令允许列表",
    "Deny List Terminal Commands": "终端命令拒绝列表",
    "Commands the agent can run outside the sandbox.": "智能体可在沙盒外运行的命令。",
    "Commands the agent can run outside the sandbox in this workspace.": "智能体可在此工作区中于沙盒外运行的命令。",
    "Terminal commands the agent can execute.": "智能体可执行的终端命令。",
    "Terminal commands the agent can execute in this workspace.": "智能体可在此工作区中执行的终端命令。",
    "Paths the agent can read.": "智能体可读取的路径。",
    "Paths the agent can read inside this workspace.": "智能体可在此工作区中读取的路径。",
    "Paths the agent can modify.": "智能体可修改的路径。",
    "Paths the agent can modify inside this workspace.": "智能体可在此工作区中修改的路径。",
    "Folders the automation agents can access.": "自动化智能体可访问的文件夹。",
    "Command and file access granted to the automation agents.": "授予自动化智能体的命令和文件访问权限。",
    "URLs the agent can actuate on using the browser.": "智能体可使用浏览器操作的 URL。",
    "URLs the agent can actuate on in this workspace.": "智能体可在此工作区中操作的 URL。",
    "URLs the agent can read or open in the browser.": "智能体可在浏览器中读取或打开的 URL。",
    "URLs the agent can read or open in this workspace.": "智能体可在此工作区中读取或打开的 URL。",
    "Allow/deny agent browser actuation access to specific URLs.": "允许/拒绝智能体对特定 URL 的浏览器操作访问。",
    "Allow/deny agent command execution outside the sandbox.": "允许/拒绝智能体在沙盒外执行命令。",
    "Allow/deny agent read access to specific URLs or domains.": "允许/拒绝智能体读取特定 URL 或域名。",
    "Allow/deny specific terminal commands.": "允许/拒绝特定终端命令。",
    "Allow sandboxed commands to make network requests.": "允许沙盒内命令发起网络请求。",
    "When enabled, sandboxed commands are allowed to make network requests.": "启用后，沙盒内命令可发起网络请求。",
    "Sandbox Allow Network": "沙盒允许网络",
    "Restricts agent tools to a secure, isolated local sandbox.": "将智能体工具限制在安全隔离的本地沙盒中。",
    "Run terminal commands with sandbox restrictions.": "在沙盒限制下运行终端命令。",
    "The agent auto-executes commands matched by an allow list entry.": "与允许列表匹配的命令由智能体自动执行。",
    "The agent asks for permission before executing commands matched by a deny list entry.": "与拒绝列表匹配的命令，执行前需智能体请求权限。",
    "Every terminal command requires approval.": "每条终端命令都需要批准。",
    "Always allow commands and file access (unrestricted).": "始终允许命令和文件访问（无限制）。",
    "Enhanced version of Default with more safety guardrails.": "默认预设的增强版，具有更多安全护栏。",
    "Configure agent execution, queued message delivery, and permissions.": "配置智能体执行、排队消息投递和权限。",
    "Configure workspace-specific permissions, resources, and customizations.": "配置工作区专属权限、资源和自定义项。",
    "Configure when follow-up messages are sent.": "配置后续消息的发送时机。",
    "Queued Messages": "排队消息",
    "Send Now": "立即发送",
    "Queue Wait": "排队等待",
    "Auto-Open Edited Files": "自动打开已编辑文件",
    "Open files in the background if the agent creates or edits them": "智能体创建或编辑文件时在后台打开",
    "Open files in the background if Agent creates or edits them": "智能体创建或编辑文件时在后台打开",
    "Auto-Expand Changes Overview": "自动展开更改概览",
    "Automatically expand the Changes Overview toolbar when the agent finishes generating a response.": "智能体完成回复生成时自动展开更改概览工具栏。",
    "When enabled, the Changes Overview toolbar will automatically expand when Agent finishes generating a response.": "启用后，智能体完成回复生成时更改概览工具栏将自动展开。",
    "Explain and Fix in Current Conversation": "在当前对话中解释并修复",
    "When enabled, 'Explain and Fix' actions will continue in the current conversation instead of starting a new one.": "启用后，“解释并修复”操作将在当前对话中继续，而不是新建对话。",
    "Let the agent access past conversations to inform its responses.": "允许智能体访问过去的对话以辅助其回复。",
    "When enabled, the agent will be able to access past conversations to inform its responses.": "启用后，智能体可访问过去的对话以辅助其回复。",
    "Agent always asks for review.": "智能体始终请求审核。",
    "Automations": "自动化",
    "Prompt to execute on schedule...": "要按计划执行的提示词...",
    "Cron expression e.g. 0 */6 * * *": "Cron 表达式，例如 0 */6 * * *",
    "Monday": "星期一",
    "Tuesday": "星期二",
    "Wednesday": "星期三",
    "Thursday": "星期四",
    "Friday": "星期五",
    "Saturday": "星期六",
    "Sunday": "星期日",
    "Background Tasks": "后台任务",
    "Background Task Output": "后台任务输出",
    "Delete Task": "删除任务",

    // --- 设置：浏览器 ---
    "Browser Actuation Permissions": "浏览器操作权限",
    "Browser Actuation Rules": "浏览器操作规则",
    "Browser CDP Port": "浏览器 CDP 端口",
    "Port number for Chrome DevTools Protocol remote debugging. Leave empty for default (9222).": "Chrome DevTools 协议远程调试端口号。留空则使用默认值 (9222)。",
    "Chrome Binary Path": "Chrome 二进制路径",
    "Browser User Profile Path": "浏览器用户配置路径",
    "Absolute path to the Chrome/Chromium executable": "Chrome/Chromium 可执行文件的绝对路径",
    "Path to the Chrome/Chromium executable. Leave empty for auto-detection.": "Chrome/Chromium 可执行文件的路径。留空则自动检测。",
    "Custom path for the browser user profile directory. Leave empty for default (~/.gemini/antigravity-browser-profile).": "浏览器用户配置目录的自定义路径。留空则使用默认值（~/.gemini/antigravity-browser-profile）。",
    "Browser tools (browser_.*)": "浏览器工具（browser_.*）",
    "The browser subagent has been disabled by your administrator.": "浏览器子智能体已被管理员禁用。",
    "Enter URL pattern...": "输入 URL 模式...",
    "Enter a URL (e.g. http://localhost:8080)": "输入 URL（例如 http://localhost:8080）",

    // --- 设置：自定义/MCP/钩子/扩展 ---
    "UI Extensions": "UI 扩展",
    "UI Plugins": "UI 插件",
    "UI extensions": "UI 扩展",
    "UI Actions": "UI 操作",
    "Inline Actions": "内联操作",
    "Inline Widget": "内联组件",
    "Custom View": "自定义视图",
    "Discover helpful skills & plugins": "发现有用的技能与插件",
    "Search all skills on Agent Market…": "搜索 Agent 市场中的所有技能…",
    "Search skills…": "搜索技能…",
    "MCP Servers": "MCP 服务器",
    "MCP servers": "MCP 服务器",
    "MCP tool": "MCP 工具",
    "Search MCP servers by name": "按名称搜索 MCP 服务器",
    "External tools the agent can call via Model Context Protocol.": "智能体可通过模型上下文协议调用的外部工具。",
    "Enter tool name or server...": "输入工具名称或服务器...",
    "Error fetching MCP prompt": "获取 MCP 提示词失败",
    "MCP Configuration Error:": "MCP 配置错误：",
    "Skills Configuration Error:": "技能配置错误：",
    "Plugin Operation Error:": "插件操作错误：",
    "Configure agent hooks": "配置智能体钩子",
    "Manage Hooks": "管理钩子",
    "Add Hook Card": "添加钩子卡片",
    "Delete Hook": "删除钩子",
    "Delete Handler": "删除处理器",
    "New hook name": "新钩子名称",
    "Hooks": "钩子",
    "Hook will only trigger if the tool name matches run_command or view_file.": "仅当工具名称匹配 run_command 或 view_file 时，钩子才会触发。",
    "Hook will only trigger if the tool name matches run_command.": "仅当工具名称匹配 run_command 时，钩子才会触发。",
    "Hook will only trigger if the tool name starts with browser_.": "仅当工具名称以 browser_ 开头时，钩子才会触发。",
    "Hook will trigger if any tool is executed.": "执行任何工具时钩子都会触发。",
    "Command Setup Script": "命令设置脚本",
    "A shell setup script run before every command the agent executes.": "智能体执行的每条命令前运行的 Shell 设置脚本。",
    "A shell setup script run before every command the agent executes in this project. Overrides the global script.": "智能体在此项目中执行的每条命令前运行的 Shell 设置脚本。覆盖全局脚本。",
    "example:": "示例：",
    "Command Center": "命令中心",
    "Command Palette": "命令面板",
    "Open Command Palette": "打开命令面板",
    "Open Keyboard Shortcuts": "打开键盘快捷键",
    "Open Launchpad": "打开启动台",
    "Open Preferences": "打开偏好设置",
    "Open Commit Graph": "打开提交图",
    "Open Agent on Reload": "重载时打开智能体面板",
    "Open Agent panel on window reload": "窗口重载时打开智能体面板",
    "Open the agent panel on window reload": "窗口重载时打开智能体面板",
    "Code Search": "代码搜索",
    "Search across files...": "跨文件搜索...",
    "Search all convos...": "搜索所有对话...",
    "Search conversations...": "搜索对话...",
    "Search conversations (by name or Cascade ID)": "搜索对话（按名称或 Cascade ID）",
    "Search by name or Cascade ID...": "按名称或 Cascade ID 搜索...",
    "Search projects...": "搜索项目...",
    "Search workspaces...": "搜索工作区...",
    "Search steps...": "搜索步骤...",
    "Search metrics...": "搜索指标...",
    "Type to search...": "输入以搜索...",
    "Type absolute path or navigate folders...": "输入绝对路径或浏览文件夹...",
    "Enter file or directory path...": "输入文件或目录路径...",
    "Enter directory path...": "输入目录路径...",
    "Enter command (e.g., git, blaze)...": "输入命令（例如 git、blaze）...",
    "Enter a prompt for the agent to run...": "输入要智能体运行的提示词...",
    "Enter document link": "输入文档链接",
    "Prompt too simple": "提示词过于简单",
    "This error is likely temporary. You can prompt the model to try again after some time.": "此错误可能是暂时的。您可以稍后让模型重试。",
    "Too many requests, please try again in a bit!": "请求过多，请稍后重试！",
    "The current trigger rate is too high.": "当前触发频率过高。",
    "The conversation was compacted while generating this response.": "生成此回复时对话已被压缩。",
    "The conversation could not be loaded because its data was not found.": "无法加载对话，因为未找到其数据。",
    "This conversation's workspace does not match the IDE workspace.": "此对话的工作区与 IDE 工作区不匹配。",
    "This sidecar runs from a path that is not officially supported. Make sure your code is in a trusted location in google3.": "此 sidecar 从不受官方支持的路径运行。请确保您的代码位于 google3 中的受信任位置。",
    "GitHub": "GitHub",
    "Configure GitHub access policies.": "配置 GitHub 访问策略。",
    "Configure Google Drive access permissions.": "配置 Google Drive 访问权限。",
    "Google Drive": "Google 云端硬盘",
    "Google Docs": "Google 文档",
    "Google Sheets": "Google 表格",
    "Google Slides": "Google 幻灯片",
    "Document Access": "文档访问",
    "Create Documents": "创建文档",
    "Gives the agent permission to create and upload documents to Google Drive.": "允许智能体创建并上传文档到 Google Drive。",
    "Gives the agent permission to search through Google Drive. The agent will only see file titles, not file contents.": "允许智能体搜索 Google Drive。智能体只会看到文件标题，不会看到文件内容。",
    "Would you like to grant the agent access to google drive?": "是否授予智能体 Google Drive 的访问权限？",
    "Permissions for specific Google Drive documents": "特定 Google Drive 文档的权限",
    "Couldn't load Google Drive link title": "无法加载 Google Drive 链接标题",
    "Organization Allowed Domains (Read-Only)": "组织允许的域名（只读）",
    "CitC Settings": "CitC 设置",
    "Manage settings specific to Google CitC workspaces development.": "管理与 Google CitC 工作区开发相关的设置。",
    "CitC Clone": "CitC 克隆",
    "CitC Workspace": "CitC 工作区",
    "CitC Workspace Type": "CitC 工作区类型",
    "Cog Workspace": "Cog 工作区",
    "Generate CitC Workspace VCS": "生成 CitC 工作区 VCS",
    "VCS used when generating a new workspace based off your initial prompt.": "根据初始提示词生成新工作区时使用的 VCS。",
    "Select the workspace type that will be used for new conversations started with the New Workspace option.": "选择使用“新建工作区”选项启动的新对话将使用的工作区类型。",
    "Create or select a CitC workspace to use in this conversation": "创建或选择要在对话中使用的 CitC 工作区",
    "This quick start workspace is not a CitC workspace and cannot be accessed in Web IDE.": "此快速入门工作区不是 CitC 工作区，无法在 Web IDE 中访问。",
    "Google3 Configuration": "Google3 配置",
    "They remain in your Google3 project.": "它们保留在您的 Google3 项目中。",
    "Address CLs needing attention": "处理需要关注的 CL",
    "Search GoB repositories...": "搜索 GoB 仓库...",
    "Regroup Google3 Chats": "重新分组 Google3 聊天",
    "You have no google3 conversations left to reorganize.": "没有剩余的 google3 对话可重新整理。",
    "Your google3 conversations have been reorganized into projects.": "您的 google3 对话已重新整理到项目中。",
    "Welcome to Cider with Jetski": "欢迎使用 Jetski",
    "Core AI Systems is hiring!": "Core AI 系统团队正在招聘！",
    "Help improve Gemini": "帮助改进 Gemini",
    "Thank you! Your feedback has been submitted successfully.": "感谢您的反馈！已成功提交。",
    "An error occurred while submitting your feedback. Please try again.": "提交反馈时出错，请重试。",
    "Too many surveys": "问卷太多",
    "Other (write your answer)": "其他（请填写答案）",
    "(Optional) Tell us more or type your reason...": "（可选）告诉我们更多信息或输入原因...",
    "(Optional) Tell us more...": "（可选）告诉我们更多信息...",
    "Backup failed — migration not run": "备份失败——未运行迁移",
    "Gemini directory backed up": "Gemini 目录已备份",
    "We could not back up your ~/.gemini directory. See go/projects-jetski-migration for next steps.": "无法备份您的 ~/.gemini 目录。请参阅 go/projects-jetski-migration 了解后续步骤。",
    "Knowledge": "知识",
    "Install IDE": "安装 IDE",
    "New Window": "新窗口",
    "Variant Name": "变体名称",
    "Workspaces": "工作区",
    "Overview": "概览",
    "Artifacts": "工件",
    "Members": "成员",
    "History": "历史",
    "Output": "输出",
    "Console": "控制台",
    "Terminal": "终端",
    "Browser": "浏览器",
    "Web": "网页",
    "Docs": "文档",
    "Status": "状态",
    "Progress": "进度",
    "Logs": "日志",
    "Scheduled Tasks": "计划任务",
    "Cron Jobs": "计划任务",
    "Schedule": "调度",
    "Time": "时间",
    "Date": "日期",
    "Name": "名称",
    "Type": "类型",
    "Size": "大小",
    "URL": "URL",
    "URLs": "URL",
    "Tool": "工具",
    "Tools": "工具",
    "Command": "命令",
    "Commands": "命令",
    "File": "文件",
    "Files": "文件",
    "Folder": "文件夹",
    "Project": "项目",
    "Projects": "项目",
    "Workspace": "工作区",
    "Agent": "智能体",
    "Agents": "智能体",
    "Task": "任务",
    "Tasks": "任务",
    "Model": "模型",
    "Models": "模型",
    "Message": "消息",
    "Messages": "消息",
    "Conversations": "对话",
    "Settings": "设置",
    "General": "通用",
    "Appearance": "外观",
    "Shortcuts": "快捷键",
    "Marketplace": "扩展市场",
    "Feedback": "反馈",
    "Customizations": "自定义",
    "Permissions": "权限",
    "Advanced": "高级",
    "Global": "全局",
    "Local": "本地",
    "Default": "默认",
    "Custom": "自定义",
    "Recommended": "推荐",
    "Dark": "深色",
    "Light": "浅色",
    "Preset": "预设",
    "Themes": "主题",
    "Language": "语言",
    "Editor Settings": "编辑器设置",
    "Browser Settings": "浏览器设置",
    "Agent Settings": "智能体设置",
    "Security Preset": "安全预设",
    "Danger Zone": "危险区域",
    "Delete Project": "删除项目",
    "Permanently delete this project and all of its conversations.": "永久删除当前项目及其包含的所有历史对话。",
    "Review Policy": "审核策略",
    "Artifact Review Policy": "工件审核策略",
    "Always Ask": "始终询问",
    "Always Proceed": "自动继续",
    "Require Review": "需要审核",
    "Requires manual review for all terminal commands and file accesses outside of the working folders.": "运行终端命令以及访问工作区外的文件时，均需手动人工审核。",
    "Full Machine": "完整本机访问",
    "All terminal commands require review. The agent can read or write to any file in the machine.": "所有终端命令均需审核，智能体可读写本机上的任意文件。",
    "Unrestricted": "无限制模式",
    "Disables all safety barriers for maximal iteration velocity.": "禁用所有安全屏障以获得极致的迭代效率。",
    "Manually customize individual settings.": "手动自定义各项具体设置。",
    "Learn more about Default": "了解关于默认预设的更多信息",
    "Learn more.": "了解更多。",
    "Learn more": "了解更多",
    "Sandbox": "沙盒",
    "Sandbox enabled": "沙盒已启用",
    "Sandbox disabled": "沙盒已禁用",
    "Allowed": "已允许",
    "Denied": "已拒绝",
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
    "Paths": "路径",
    "Local Permissions": "项目专属权限",
    "Inherits from global settings. Local permissions have higher priority.": "继承自全局设置。项目专属权限具有更高的优先级。",
    "Inherits from global settings.": "继承自全局设置。",
    "Local permissions have higher priority.": "项目专属权限具有更高的优先级。",
    "Project-Specific Settings": "项目专属设置",
    "Project-Specific": "项目专属",
    "Modify scoped permissions, folders, and Agent settings like Sandbox and Terminal command execution.": "修改项目专属访问权限、工作文件夹以及智能体设置（例如沙盒和终端命令执行）。",
    "Go to Projects": "转到项目",
    "Outside of folders file access policy": "文件夹外文件访问策略",
    "Configures how the agent tries to access files outside of its working folders.": "配置智能体如何尝试访问其工作文件夹外部的文件。",
    "Terminal command Auto execution": "终端命令自动执行",
    "Controls whether terminal commands require your approval before running.": "控制终端命令在运行前是否需要您批准。",
    "Model Quota": "模型配额",
    "Model Credits": "模型额度",
    "Refresh quota and credits data": "刷新配额与额度数据",
    "Enable AI Credit Overages": "允许 AI 额度超限使用",
    "When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.": "开启后，当您的免费配额耗尽时，Antigravity 将使用您的 AI 点数来满足请求。系统会优先扣除免费模型配额，配额不足时再使用点数。",
    "View your available model quota and AI credits. Model quota refreshes periodically based on your plan. Enable AI Credit Overages to continue using models when your quota is exhausted.": "查看您的可用模型配额与 AI 账户额度。模型配额会根据您的订阅计划定期刷新。额度耗尽后，可开启 AI 额度超限使用以继续体验。",
    "Configure AI models and view your quota.": "配置 AI 模型并查看您的配额与可用点数。",
    "Token Usage": "Token 使用详情",
    "The breakdown below shows token usage from customizations like skills, rules, and MCP. If the budget is exceeded, large customizations will be truncated automatically.": "以下详情展示了来自技能、规则和 MCP 等自定义项的 Token 使用情况。如果额度超限，大型自定义内容将被自动截断。",
    "of the customization budget is available.": "的自定义额度可用。",
    "100.0% of the customization budget is available.": "100.0% 的自定义额度可用。",
    "No customizations found for this workspace.": "未找到此工作区的自定义项。",
    "Installed MCP Servers": "已安装的 MCP 服务器",
    "No MCP Servers": "无已安装的 MCP 服务器",
    "You currently don't have any MCP Servers installed.": "您当前未安装任何 MCP 服务器。",
    "Add an MCP Server": "添加 MCP 服务器",
    "Add MCP": "添加 MCP",
    "Build With Google Plugins": "使用 Google 插件构建",
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
    "Within each group, models share": "在每个分组中，模型共享",
    "Browser Javascript Execution Policy": "浏览器 JavaScript 执行策略",
    "Controls whether the agent can run custom JavaScript to automate complex browser actions.": "控制智能体是否可以运行自定义 JavaScript 以自动化复杂的浏览器操作。",
    "Request Review": "需要人工审核",
    "Disabled": "已禁用",
    "Block all browser JavaScript execution.": "禁止执行所有浏览器 JavaScript。",
    "Prompt for approval before running browser scripts.": "在运行浏览器脚本前需人工批准。",
    "Allow full browser script execution without prompting.": "允许执行所有浏览器脚本（无需提示）。",
    "Actuation Permissions": "动作执行权限",
    "App Settings": "应用设置",
    "Notification Settings": "通知设置",
    "To modify notification settings, open your operating system's system preferences.": "如需修改通知设置，请打开您操作系统的系统偏好设置。",
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
    "Google AI Pro": "Google AI Pro",
    "Upgrade": "升级",
    "Sign Out": "退出登录",
    "By using this app, you agree to its": "使用本应用即表示您同意其",
    "Terms of Service": "服务条款",
    "Google Drive integration not available": "Google 云端硬盘集成不可用",
    "Manage application settings.": "管理应用设置。",
    "Manage your notification preferences.": "管理您的通知偏好。",
    "Manage your model quota and credits.": "管理您的模型配额与点数。",
    "Conversation History": "历史对话",
    "Conversation history": "历史对话",
    "No conversations yet": "暂无对话",
    "No conversation yet": "暂无对话",
    "New Conversation": "新建对话",
    "New Conversation in Project": "项目内新建对话",
    "New Agent": "新建智能体",
    "Agent Name": "智能体名称",
    "System Prompt": "系统提示词",
    "System Instruction": "系统指令",
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
    "Timer": "定时器",
    "Timers": "定时器",
    "Directory analysis": "目录分析",
    "Web search": "网页搜索",
    "File edit": "文件编辑",
    "Command execution": "命令执行",
    "Semantic search": "语义搜索",
    "Active Agents": "活跃智能体",
    "No agents running": "没有运行中的智能体",
    "Active Workspace": "活动工作区",
    "active workspace": "活动工作区",
    "Search...": "搜索...",
    "Type a command...": "输入命令...",
    "Settings & Preferences": "设置与偏好",
    "Model Selection": "模型选择",
    "Open Conversation Picker": "打开对话选择器",
    "Open File Search": "打开文件搜索",
    "Focus Input": "聚焦输入框",
    "Navigation": "导航",
    "Go Back": "后退",
    "Go Forward": "前进",
    "File Picker": "文件选择器",
    "Select Previous Conversation": "选择上一个对话",
    "Select Next Conversation": "选择下一个对话",
    "Open Settings": "打开设置",
    "Conversation": "对话",
    "Toggle Model Selector": "切换模型选择器",
    "Toggle Voice Recording": "切换录音",
    "Find in Pane": "在窗格中查找",
    "Layout Controls": "布局控制",
    "Toggle Sidebar": "切换侧边栏",
    "Toggle Auxiliary Pane": "切换辅助窗格",
    "Zoom In": "放大",
    "Zoom Out": "缩小",
    "Reset Zoom": "重置缩放",
    "Provide Feedback": "提供反馈",
    "Feedback Type": "反馈类型",
    "Bug Report": "Bug 报告",
    "Feature Request": "功能请求",
    "Auth and Billing": "账号与计费",
    "General Feedback": "常规反馈",
    "Attach a screenshot (optional)": "添加屏幕截图（可选）",
    "Attach Antigravity server logs": "附带 Antigravity 服务器日志",
    "Send feedback as": "发送反馈身份",
    "We recommend attaching logs. Attaching logs will help the Antigravity team act on and prioritize your feedback.": "我们建议附带日志。这将有助于 Antigravity 团队更快速、更有针对性地处理您的问题。",
    "Steps to reproduce the issue": "问题复现步骤",
    "Expected behavior": "预期行为",
    "Actual behavior": "实际行为",
    "Any relevant information": "任何相关信息",
    "Any error messages": "任何错误消息",
    "Steps to Reproduce": "复现步骤",
    "Submit": "提交",
    "Describe the bug you encountered...": "请描述您遇到的 Bug...",
    "Please list the steps to reproduce the issue": "请列出复现该问题的步骤",
    "Checking for Updates...": "正在检查更新...",
    "Downloading Update...": "正在下载更新...",
    "Restart to Update": "重启以应用更新",
    "Check for Updates": "检查更新",
    "No updates available": "当前已是最新版本",
    "Update available": "发现新版本",
    "Downloading...": "正在下载...",
    "Update downloaded": "更新已下载完成",
    "Error checking for updates": "检查更新失败",
    "Window": "窗口",
    "App": "应用",
    "Rules": "规则",
    "Skills": "技能",
    "Plugin": "插件",
    "Plugins": "插件",
    "Customize": "自定义",
    "Setup": "设置",
    "Breakdown": "明细",
    "breakdown": "明细",
    "breakdowns": "明细",
    "Jetski Chat": "Jetski 聊天",
    "Setup Jetski Chat": "设置 Jetski 聊天",
    "Bot Name": "机器人名称",
    "Avatar URL": "头像 URL",
    "Enter bot name (optional)": "输入机器人名称（可选）",
    "Enter avatar URL (optional)": "输入头像 URL（可选）",
    "Chat Space": "聊天空间",
    "Continue to help, visit": "如需继续获取帮助，请访问",
    "Creating Chat Bot": "正在创建聊天机器人",
    "Installing Chat Bot": "正在安装聊天机器人",
    "Creating Cloud Project": "正在创建云项目",
    "Creating Sidecar": "正在创建 Sidecar",
    "Authenticating...": "正在验证身份...",
    "Sidebar": "侧边栏",
    "Display Options": "显示选项",
    "Message input": "消息输入框",
    "Record voice memo": "录制语音备忘",
    "Typeahead menu": "预输入菜单",
    "voice memo": "语音备忘",
    "memo": "备忘",
    "typeahead": "预输入",
    "Group By": "分组方式",
    "Last Updated": "最后更新",
    "Alphabetical (A-Z)": "字母顺序 (A-Z)",
    "Date Added": "添加日期",
    "Subtitles": "副标题",
    "No Subtitle": "无副标题",
    "Scheduled": "已计划",
    "Environment": "环境",
    "None": "无",
    "Fast": "快速",
    "Minimize": "最小化",
    "Maximize": "最大化",
    "Back": "返回",
    "No scheduled tasks configured.": "暂无已配置的计划任务。",
    "You have used some of your weekly limit": "您已使用部分每周限额",
    "You have used some of your 5-hour limit": "您已使用部分 5 小时限额",
    "it will fully refresh in": "它将在以下时间后完全刷新：",
    "hours": "小时",
    "minutes": "分钟",
    "days": "天",
    "Folders": "文件夹",
    "including": "包括",
    "Allow/deny": "允许/拒绝",
    "read access": "读取权限",
    "write access": "写入权限",
    "specific files or directories": "特定文件或目录",
    "Missing": "缺失",
    "Missing folder": "缺失文件夹",
    "Missing Folder": "缺失文件夹",
    "does not exist": "不存在",
    "not found": "未找到",
    "Not Found": "未找到",
    "No longer available": "已不可用",
    "Path": "路径"
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
    "turn": "回合", "turns": "回合",
    // ===== 第8轮 coreWords 补充 (2.8.1) =====
    "copy": "复制", "rename": "重命名", "undo": "撤销", "redo": "重做", "archive": "归档", "unarchive": "取消归档",
    "dismiss": "忽略", "duplicate": "创建副本", "pin": "固定", "pinned": "已固定", "star": "收藏", "fork": "分叉",
    "share": "分享", "export": "导出", "import": "导入", "download": "下载", "upload": "上传",
    "refresh": "刷新", "retry": "重试", "restart": "重启", "pause": "暂停", "resume": "继续",
    "approve": "批准", "reject": "拒绝", "allow": "允许", "deny": "拒绝", "grant": "授予", "block": "阻止",
    "read": "读取", "write": "写入", "restore": "恢复", "move": "移动", "quote": "引用", "mention": "提及",
    "attach": "附加", "record": "录制", "mark": "标记", "sort": "排序", "group": "分组", "filter": "筛选",
    "paste": "粘贴", "cut": "剪切", "send": "发送", "submit": "提交", "apply": "应用", "reset": "重置",
    "enable": "启用", "disable": "禁用", "more": "更多", "less": "更少", "next": "下一个", "previous": "上一个",
    "forward": "前进", "unknown": "未知", "deleted": "已删除", "renamed": "已重命名", "copied": "已复制",
    "archived": "已归档", "blocked": "已阻止", "idle": "空闲", "stopped": "已停止", "enabled": "已启用",
    "disabled": "已禁用", "verified": "已验证", "vetted": "已审核", "queued": "排队中", "scheduled": "已计划",
    "daily": "每日", "weekly": "每周", "monthly": "每月", "hourly": "每小时", "monday": "星期一",
    "tuesday": "星期二", "wednesday": "星期三", "thursday": "星期四", "friday": "星期五",
    "saturday": "星期六", "sunday": "星期日", "conversation": "对话", "conversations": "对话",
    "project": "项目", "projects": "项目", "model": "模型", "models": "模型", "message": "消息",
    "messages": "消息", "copied": "已复制", "renamed": "已重命名", "archived": "已归档", "restored": "已恢复",
    "moved": "已移动", "granted": "已授予", "quoted": "已引用", "sent": "已发送", "submitted": "已提交"
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

    // 配额提示句 (含动态天数/小时/分钟)
    if (/^You have used some of your (weekly|5-hour|hourly|daily) limit/.test(trimmed)) {
      dynamicMatch = dynamicMatch
        .replace(/^You have used some of your weekly limit/, '您已使用了部分每周限额')
        .replace(/^You have used some of your 5-hour limit/, '您已使用了部分 5 小时限额')
        .replace(/^You have used some of your hourly limit/, '您已使用了部分每小时限额')
        .replace(/^You have used some of your daily limit/, '您已使用了部分每日限额')
        .replace(/it will fully refresh in/, '它将在以下时间后完全刷新：')
        .replace(/(\d+)\s*days?/g, '$1 天 ')
        .replace(/(\d+)\s*hours?/g, '$1 小时 ')
        .replace(/(\d+)\s*minutes?\.?$/g, '$1 分钟')
        .replace(/[,.]/g, '');
      isDynamic = true;
    }
    // 模型分组配额说明长句
    if (/^Within each group, models share/.test(trimmed)) {
      dynamicMatch = '在每个分组中，模型共享每周限额和 5 小时限额。配额按 token 成本比例消耗。因此，较短的任务或使用更具性价比的模型时，限额可持续更长时间。5 小时限额用于平滑总需求，以便在所有用户间公平分配全球容量，而每周限额则与您的个人等级直接挂钩。';
      isDynamic = true;
    }

    // 项目/路径不存在的动态提示 (项目名 + " does not exist"，超3词无法走分词)
    if (/^.+ does not exist\.?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(.+) does not exist\.?$/i, '$1 不存在');
      isDynamic = true;
    }
    // "xxx was not found" 动态提示
    if (/^.+ was not found\.?$/i.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(.+) was not found\.?$/i, '$1 未找到');
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

  // 用于模糊匹配类名中包含代码/预览/diff相关关键词的正则
  const codeClassPattern = /(?:^|[\\s_-])(code|diff|source|syntax|highlight|viewer|hljs|shiki|prism|monaco|codemirror|token|line-number|line-content|gutter|codeblock|code-block|code-view|code-preview|file-preview|file-content)(?:$|[\\s_-])/i;

  function shouldSkipNode(node) {
    if (!node) return true;
    
    // 如果是文本节点，我们检查其父元素；如果是属性/元素节点，检查自身
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) return false;

    // 1. 绝对不能翻译的脚本/样式/代码块标签
    const skipTags = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'KBD', 'SAMP', 'VAR'];
    if (skipTags.includes(element.tagName)) {
      return true;
    }

    // 2. 如果是文本节点，并且其父元素是输入框/文本域，必须跳过文本节点翻译
    if (node.nodeType === Node.TEXT_NODE) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return true;
      }
    }

    // 3. 检查元素自身是否带有代码语言标记属性
    if (element.getAttribute) {
      if (element.getAttribute('data-language') || 
          element.getAttribute('data-code') ||
          element.getAttribute('data-line') ||
          element.getAttribute('data-line-number')) {
        return true;
      }
    }

    // 4. 向上递归检查祖先节点
    let cur = element;
    while (cur) {
      // 4a. contenteditable 区域
      if (cur.getAttribute && cur.getAttribute('contenteditable') === 'true') {
        return true;
      }

      // 4b. 检查 data 属性（代码块语言标记等）
      if (cur.getAttribute) {
        if (cur.getAttribute('data-language') || 
            cur.getAttribute('data-code') ||
            cur.getAttribute('data-line') ||
            cur.getAttribute('data-line-number')) {
          return true;
        }
      }

      // 4c. 检查 role 属性
      if (cur.getAttribute) {
        const role = cur.getAttribute('role');
        if (role === 'code') {
          return true;
        }
      }

      // 4d. 精确类名匹配 — 已知的编辑器/输入区域
      if (cur.classList && (
        cur.classList.contains('monaco-editor') || 
        cur.classList.contains('editor-instance') ||
        cur.classList.contains('input-area') ||
        cur.classList.contains('chat-input')
      )) {
        return true;
      }

      // 4e. 类名匹配 — 精确与模糊检测（高精度防御，防止 Tailwind 选择器如 [&_code] 引起的误杀）
      if (cur.className && typeof cur.className === 'string') {
        const lowerClass = cur.className.toLowerCase();
        if (
          lowerClass.includes('code-line') ||
          lowerClass.includes('select-contain') ||
          lowerClass.includes('font-mono') ||
          codeClassPattern.test(cur.className)
        ) {
          return true;
        }
      }

      // 4f. 检查 tagName: 如果在 PRE 或 CODE 结构内部也应跳过
      if (cur.tagName === 'PRE' || cur.tagName === 'CODE') {
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

  // 幂等注入:若目标文件已包含注入标记则跳过，防止重复注入导致语法错误。
  // 用唯一的稳定标记判断是否已注入（DOM_TRANSLATOR_INJECTION 与 menuInjectCode 各自的特征片段）。
  // 与 replaceInFile() 保持一致：文件不存在直接抛错，fail-fast，避免路径错误时
  // appendFileSync 静默创建新文件而产生“注入成功”的假象。
  function appendOnce(filePath, content, marker, desc) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`找不到要修改的文件: ${filePath}`);
    }
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing.includes(marker)) {
      log(`${desc} 已存在注入，跳过（避免重复）。`);
      return;
    }
    fs.appendFileSync(filePath, content, 'utf-8');
    log(`已向 ${path.basename(filePath)} 注入 ${desc}。`);
  }

  // 1. Inject DOM Localization in dist/preload.js
  const preloadPath = path.join(EXTRACT_DIR, 'dist', 'preload.js');
  appendOnce(preloadPath, DOM_TRANSLATOR_INJECTION, 'Antigravity 2.0 Chinese Localization Engine', 'Web UI 实时汉化引擎');

  // 2. Inject DOM Localization in dist/ideInstall/wizardPreload.js
  const wizardPreloadPath = path.join(EXTRACT_DIR, 'dist', 'ideInstall', 'wizardPreload.js');
  appendOnce(wizardPreloadPath, DOM_TRANSLATOR_INJECTION, 'Antigravity 2.0 Chinese Localization Engine', '新版向导 Web UI 汉化引擎');

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
  appendOnce(menuPath, menuInjectCode, 'const menuTranslationMap = {', '原生菜单翻译映射');

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
    `            countItem.label =
                (count > 0 ? \`\${count}\` : 'No') +
                    ' agent' +
                    (count === 1 ? '' : 's') +
                    ' running';`,
    `            countItem.label = count > 0 ? \`\${count} 个智能体运行中\` : '没有智能体在运行';`
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
    // --unpack 保持 chrome-devtools-mcp 作为外部 unpacked 文件（与官方打包结构一致，避免 asar 膨胀）
    execSync(`${getAsarCmd()} pack "${EXTRACT_DIR}" "${tempAsar}" --unpack "**/chrome-devtools-mcp/**"`, { cwd: WORKSPACE_DIR });
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
    const resourcesDir = getResourcesDir(appDir);
    const asarPath = path.join(resourcesDir, 'app.asar');
    const backupPath = path.join(resourcesDir, 'app.asar.bak');

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
