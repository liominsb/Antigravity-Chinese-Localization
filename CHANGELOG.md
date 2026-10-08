# 版本更新日志 (Changelog)

本文件记录 Antigravity-Chinese-Localization 汉化项目的全部版本迭代与核心架构变动。

## v2.21.0 (2026-10-07)

### 1. 全面深度适配 Antigravity v2.21.0 架构与官方底座接口
- **官方版本无缝平滑升级**：深度跟进官方 10月最新发布的 2.21.0 版本，同步升级应用版本定义至 `2.21.0`，全面适配主进程与渲染进程架构。
- **官方底座接口桥接**：在 `preload.js` 中保留并桥接官方新增的 `getPathForFile: (file) => electron_1.webUtils.getPathForFile(file)` 接口，确保文件拖拽上传与文件系统绝对路径解析功能稳定运行。
- **全套 TDD 自动化测试验证**：新增 Ticket-15（62 项断言）与 Ticket-16 专项测试套件，全量 14 套回归测试用例 100% 保持全绿通过 (ALL GREEN)。

### 2. 深度汉化 2.21.0 新增界面文案与交互体验
- **设置中心新版体验与 Token 明细**：深度汉化 Project 4K 体验模式选项（`Choose between the Default and Project 4K experience.` -> `在默认体验与 4K 项目体验之间切换。`）、自定义项（规则、技能、MCP）Token 消耗明细（`Show breakdown`）及动态计数。
- **云端与智能体全生命周期状态**：汉化 `Creating Cloud Project`（正在创建云项目）、`Creating Chat Bot`（正在创建聊天机器人）、`Creating Sidecar`（正在创建 Sidecar）等创建与安装状态，以及 `Agent response`、`Undo to this point` 等聊天卡片交互。
- **扩展市场与自动化 (Automations)**：汉化 `Automations`（自动化）、Google Docs / Sheets / Slides / Drive / Calendar 等官方插件生态、`Custom Agents`（自定义智能体）及启用工具动态计数。

### 3. 分词防误伤保护规则与系统加固
- **分词防误伤保护 (Anti-Corruption Protection)**：加固正则匹配分词规则，对代码文件路径（如 `tests/run-all-tests.js`）、kebab-case 标识符（如 `mcp-permission-authorization`）、内部 URL（如 `go/jetski-project-migration`）与打包产物名（如 `app.asar.ready`）实施严格物理隔离，杜绝误伤破坏。
- **原生上下文菜单增强**：在 `ipcHandlers.js` 中扩充 Project options、View Usage、Duplicate、Archive、Clear History 等原生右键菜单词典映射。

---

## v2.19.1 (2026-10-01)

### 1. 全面适配 Antigravity v2.19.1 核心架构
- **官方版本无缝平滑升级**：升级应用版本定义至 `2.19.1`，保持与官方最新更新器与依赖架构的无缝兼容。
- **全套 TDD 自动化测试验证**：新增 Ticket-14 专项测试套件（56 项断言全部通过），覆盖原生右键上下文菜单沙盒运行与核心文件完备性。

### 2. 原生右键上下文菜单深度拦截与汉化
- **IPC 上下文菜单翻译引擎**：拦截 `ipcHandlers.js` 中的 `window:show-context-menu` 通道，支持递归子菜单结构与动态 label 翻译。
- **全量右键操作汉化**：汉化剪切、复制、粘贴、全选、撤销、重做、新建对话、派生对话、置顶/取消置顶、在文件资源管理器中显示、在访达中显示、在终端中打开等全部原生菜单项。

---

## v2.18.1 (2026-09-29)

### 1. 全面适配 Antigravity v2.18.1 架构
- **版本平滑升级**：升级应用版本定义至 `2.18.1`。
- **全套 TDD 自动化测试验证**：新增 Ticket-13 专项测试套件，全量回归测试保持 100% 通过。

### 2. 新版向导、Diff 控制栏与原生交互补全
- **新版安装向导**：深度汉化 `wizardHtml.js` 欢迎与设置引导界面（`欢迎使用全新 Antigravity！`）。
- **Diff 审查与控制栏**：补齐代码 Diff 审查栏操作、视图折叠与智能体计划审核策略。
- **原生对话框与确认退出**：汉化检查更新提示框、当前已是最新版本弹窗、托盘智能体运行计数及确认退出交互。

---

## v2.17.0 (2026-09-24)

### 1. 全面深度适配 Antigravity v2.17.0 架构
- **官方版本无缝平滑升级**：深度跟进官方 9月24日最新发布的 2.17.0 版本，同步升级应用版本定义至 `2.17.0`，适配新增依赖项（如 `js-yaml`）与主进程/渲染进程架构。
- **全套 TDD 自动化测试验证**：新增 Ticket-12 专项测试套件（45 项断言全部通过），全量回归测试套件 100% 保持通过 (ALL GREEN)。

### 2. WSL (Windows Subsystem for Linux) 远程环境深度汉化
- **原生文件菜单与动态子菜单**：汉化 `Connect to WSL`（连接到 WSL）、`Reopen Locally`（本地重新打开），并实现原生菜单双向匹配回退引擎，杜绝异步添加 WSL 菜单项时的父菜单查找丢失问题。
- **WSL 首发部署启动弹窗 (Provision Splash)**：汉化首次接入 WSL 时的专用无边框下载与安装弹窗 `Setting up WSL: <distro>`（正在配置 WSL: <发行版>），并实时翻译状态通知：`Downloading the Antigravity binary…`（正在下载 Antigravity 二进制组件…）、`Installing into <distro>…`（正在安装到 <发行版>…）。
- **WSL 跨系统路径与文件系统警告**：汉化 Windows 与 WSL 文件系统混用时的性能警告提示（建议保留在 WSL 文件系统内以获得最佳性能）、发行版不匹配提示及路径解析错误。
- **WSL 故障与环境弹窗**：汉化 `WSL distro not found`（未找到 WSL 发行版）、`WSL setup failed`（WSL 配置失败）以及改在 Windows 本地打开的自动回退提示。

### 3. 沙盒模式、高级设置、视图折叠与项目权限继承补全
- **本地沙盒隔离模式**：补全 `Enable Sandbox Mode (Preview)`（启用沙盒模式 (预览)）、`Restricts agent tools to a secure, isolated local sandbox.`（将智能体工具限制在安全、隔离的本地沙盒环境中。）、`Security Preset`（安全预设）。
- **应用高级设置与审查视图**：汉化设置中的 `Advanced Settings`（高级设置）与审查栏操作 `Collapse All`（全部折叠）、`Expand All`（全部展开）。
- **项目专属权限与全局继承**：汉化 `Inherit Global`（继承全局）、`Also includes 全局权限 when working in this project.`（在当前项目中工作时亦继承 全局权限 配置。）等引导与选项文案。

---

## v2.15.1 (2026-09-21)

### 1. 全面适配 Antigravity v2.15.1 核心架构
- **官方版本无缝平滑升级**：深度跟进官方 9月21日最新构建，升级版本定义至 `2.15.1`，保持对官方最新更新器与依赖体系的 100% 兼容。
- **全量汉化引擎继承与语法加固**：无缝继承 100% 汉化覆盖，保持 DOM 注入、Electron 原生菜单栏与系统托盘的高韧性运行。
- **全套 TDD 自动化测试验证**：新增 Ticket-11 专项测试套件，通过全量 305 项自动化用例与全部 37 个 dist JS 文件的 AST 语法门禁。

### 2. 侧边栏置顶会话与分组标题全量补齐
- **置顶与常用会话分组标题**：汉化左侧栏 `Pinned Conversations` / `pinned conversations`（置顶对话）、`Recent Conversations`（最近对话）、`All Conversations`（全部对话）、`Other Conversations`（其他对话）等核心标题。
- **置顶状态与无障碍标签**：同步规范化 `Pinned`（已置顶）、`Unpinned`（未置顶）等交互状态文案。

---

## v2.15.0 (2026-09-19)

### 1. 全面适配 Antigravity v2.15.0 核心架构
- **版本元数据与环境平滑升级**：全面升级应用版本定义至 `2.15.0`，适配官方 9月19日最新架构与更新器版本请求头特性。
- **全量汉化引擎继承与语法加固**：继承 100% 汉化覆盖，保持 DOM 注入、Electron 原生菜单栏与系统托盘的高韧性运行。
- **全套 TDD 自动化测试套件**：新增 Ticket-10 专项测试套件，通过全量 239 项自动化用例与 37 个 JS 文件的 AST 语法门禁。

### 2. 自定义智能体控制与默认提示词/工具汉化
- **智能体提示词与工具控制**：汉化智能体配置控制：`Default tools`（默认工具）、`Default prompt sections`（默认提示词小节）、`Switch off default tools`（关闭默认工具）、`Switch off default prompts`（关闭默认提示词）、`Add back tools`（重新添加工具）。
- **主智能体状态与重置**：汉化 `Main Agent`（主智能体）、`Main Agent (Default)`（主智能体 (默认)）、删除或关闭后重置为主智能体的交互文案。

### 3. 项目状态、输入框与错误展示优化
- **项目选择器无项目状态**：汉化输入框上方在非项目工作环境下的状态标签：`No Project`（无项目）、`Working outside of a project`（在项目外部工作）。
- **无效工具调用展示**：汉化模型返回格式异常时的轻量级提示：`Invalid tool call`（无效的工具调用）。
- **二进制文件与已取消状态**：汉化智能体尝试读取不可预览文件时的明晰报错 `Cannot display binary file`（无法显示二进制文件），以及应用重启时终端命令状态纠正为 `Command canceled`（命令已取消）。

### 4. 高频交互操作、无障碍属性与动态模板全量补全
- **会话交互与反馈按钮**：汉化 `Good response`（好评回复）、`Bad response`（差评回复）、`More actions` / `More options`（更多操作 / 更多选项）、`Pin conversation` / `Pinned Conversations`（置顶对话）、`Recent Conversations`（最近对话）、`All Conversations`（全部对话）、`Undo to this point`（撤销到此处）。
- **代码块与浮动操作**：汉化 `Copy code`（复制代码）、`At mention code block`（提及代码块）、`Add inline comment`（添加行内注释）、`Fold code block`（折叠代码块）、`User message`（用户消息）、`Send message`（发送消息）。
- **执行报错与动态模板**：汉化智能体异常终止提示 `Agent execution terminated due to error.`（智能体执行因错误而终止。），并新增 `See all (N)`（查看全部 (N)）、`Ran N commands`（已运行 N 条命令）、`Load older messages, showing N of M`（加载历史消息，正在显示 N / M 条）、`Fold lines N-M`（折叠第 N-M 行）等高频动态正则匹配。

---

## v2.14.0 (2026-09-16)

### 1. 全面适配 Antigravity v2.14.0 核心架构
- **版本元数据与环境无缝升级**：全面升级版本定义至 2.14.0，适配官方 9月16日最新稳定版本构建。
- **全量汉化引擎继承与语法加固**：无缝继承 100% 汉化覆盖，保持 DOM 注入与 Electron 原生系统菜单、托盘与启动遮罩高韧性运行。
- **全套 TDD 自动化测试验证**：新增 Ticket-09 专项测试套件，全量通过 37 个 JS 文件的 AST 静态语法校验门禁。

---

## v2.13.0 (2026-09-13)

### 1. 全面适配 Antigravity v2.13.0 核心架构
- **前端 Bundle 变动适配**：深度适配官方 2.13.0 前端代码结构与构建更新，提取并全量汉化 116+ 处新增界面文案。
- **Preload 注入引擎同步**：同步升级主渲染线程与安装向导预加载注入模块，保障 100% 汉化覆盖与高帧率吞吐。

### 2. 侧边问答系统 (Side Question / Questionnaire) 深度汉化
- **独立侧边追问浮窗**：汉化全新侧边追问卡片交互：`Side Question`（侧边提问）、`Side question answered.`（侧边提问已回答。）、`View side question`（查看侧边提问）、`Minimize side question`（最小化侧边提问）、`Delete side question`（删除侧边提问）。
- **问答表单控制**：汉化 `Cancel questionnaire`（取消问答）与 `Cancel questionnaire and stop the agent`（取消问答并停止智能体）交互。

### 3. 源码控制 Git Amend（追加提交）全流程汉化
- **追加提交能力**：汉化源码控制面板新增的一级追加入口：`Amend`（追加提交）、`Amending...`（正在追加提交...）。
- **提交策略与状态提示**：汉化 `Amend staged changes into the current commit`（将已暂存改动追加合并至当前提交）、`Stage and amend all changes into the current commit`（暂存并将所有改动追加合并至当前提交）、`No changes to amend`（没有可追加的改动）、`No commit to amend`（没有可追加的目标提交）以及冲突提示。

### 4. 通用设置中心高级区域重构深度适配
- **设置项集中收纳适配**：适配 2.13.0 将 `Best of N`、`CitC`、`Labs`（实验室）设置集中收纳至“通用设置 - 高级”区域的架构重构。
- **迁移引导与版本控制说明**：汉化各个模块的迁移引导长句（如“Best of N 设置已移至通用设置中的‘高级’区域。”）以及版本控制系统切换指引。

### 5. 产物与表格宽度自适应显示控制
- **显示尺寸偏好设置**：汉化产物显示新设置项：`Markdown Artifact Width`（Markdown 产物宽度）、`Configure the default width of markdown artifacts.`（配置 Markdown 产物的默认显示宽度。）、`Table Width`（表格宽度）。
- **布局模式选项**：汉化 `Fit to content`（适应内容）与 `Fit to width`（适应宽度）两种排版模式。

### 6. Windows 管理员权限 UAC 提升流程汉化
- **提权交互提示**：汉化 Windows 平台下终端命令的一次性提权交互：`Administrator access (UAC)`（管理员权限 (UAC)）、`Grant administrator access for`（授予管理员权限至）、`Grant one-time administrator access`（授予一次性管理员权限）、`Requesting a one-time administrator (UAC) elevation`（正在请求一次性管理员 (UAC) 权限提升）以及 `Yes, allow`（允许授权）。

### 7. 自然语言插件构建与自定义项视图分类
- **自然语言插件构建**：汉化 `Create plugin`（创建插件）、`Describe a plugin and the agent builds it`（描述插件功能，智能体将自动构建）。
- **自定义项视图分类标签**：汉化来源与安装状态标签：`由您安装`（Installed by you）、`随应用内置`（Bundled with the app）、`已在您的配置中列出`（Listed in your config）、`在此工作区中找到`（Found in this workspace）、`预置`（Pre-installed）、`内置`（Builtin）。
- **推荐技能开关**：汉化 `Enable recommended skills`（启用推荐技能）与 `Disable recommended skills`（禁用推荐技能）。

### 8. 会话置顶、暂存文件与比对器增强
- **会话置顶与分叉**：汉化 `Pin this conversation`（置顶此对话）、`Unpin this conversation`（取消置顶此对话）、`Rename this conversation`（重命名此对话）、`Forked conversation`（派生的对话）。
- **暂存文件面板**：汉化 `Scratch Files`（暂存文件）、`No scratch files`（暂无暂存文件）。
- **比对器空白字符切换**：汉化代码比对器中的 `Show Whitespace Changes`（显示空白字符变动）与 `Hide Whitespace Changes`（隐藏空白字符变动）。

### 9. 会话分屏 (Split)、派生 (Fork) 与分组管理全套汉化及菜单语法加固
- **分屏菜单全流程**：补全左侧会话 `Split`（分屏）及级联子菜单 `Split Right`（向右分屏）、`Split Down`（向下分屏）、`Replace With New`（替换为新建）、`Remove From Split`（从分屏中移除）、`Split Terminal`（拆分终端）、`Split Conversation Vertically`（垂直分屏对话）、`Split Conversation Horizontally`（水平分屏对话）、`Equalize Split Panes`（均分分屏窗格）。
- **会话派生与分组管理**：汉化 `Fork`（派生）、`Create fork in current/shared/new workspace`（在当前/共享/新建工作区创建派生）、`Move to Group`（移动到分组）、`New Group`（新建分组）、`Create Group`（创建分组）及相关自愈纠偏规则。
- **原生菜单解析稳定性**：修复 `menu.js` 原生菜单遍历语法闭合问题，杜绝 Electron 启动加载时的 AST 语法报错，保障启动稳定性。

---

## v2.12.2 (2026-09-08)

### 1. 全面适配 Antigravity v2.12.2 核心架构
- **更新词库与模型菜单**：适配 Gemini 3.8 Flash 与 2.12.2 企业级更新词库与模型选择菜单。
- **预置 MCP 生态全量汉化**：全量汉化设置中心 63 款官方与社区预置 MCP 服务卡片、长句说明及权限声明。

### 2. 斜杠命令（Slash Commands）与悬浮卡片汉化
- **命令菜单与悬浮卡片**：汉化斜杠命令浮动菜单（`/boost`、`/goal`、`/schedule`、`/browser`、`/grill-me`、`/plan`、`/teamwork-preview`、`/learn` 等）及其详细说明卡片。
- **原生触发符免疫保护**：严格保护原生触发字符（如 `boost`、`goal` 保持英文不被误译破坏）。

### 3. 上下文提及（@ Mention）菜单精准汉化与放行保护
- **上下文分类全量汉化**：汉化 `@` 触发的规则（Rules）、对话（Conversation）、文档（PDF Document）、提交（Git Commit）、差异（Git Diff）、目录（Directory）等全部分类项。
- **分类标签与文件名隔离**：建立标签放行与文件名保护机制，绝对保护项目代码文件名、扩展名与触发参数原生结构。

### 4. 通用设置项深层补齐
- **浏览器子智能体汉化**：补齐通用设置中浏览器子智能体（Browser Subagent）分段长句与实验室功能词条汉化。

### 5. 原生应用菜单与侧边栏会话交互体验提升
- **原生顶部菜单精准汉化**：顶部原生菜单 `Create Project`（创建项目）、`New Project`（新建项目）、`Open Project`（打开项目）、`Copy`（复制）等。
- **历史会话详情与复制子项**：侧边栏历史会话详情与复制子菜单汉化（`Copy trajectory ID`、`Trajectory Metadata` 等）。
- **悬停卡片动态更新时间与状态指示**：历史会话悬停预览卡片（Hover Card）更新时间（`Updated <time>` -> `更新于 <time>`）及多状态标签（`空闲`、`活跃`、`需要操作`、`未读`）深度汉化，并支持英文月份自动转换为地道中文日期。

---

## v2.12.0.1 (2026-09-04)

### 1. 模型思考链 (Thinking Process) 绝对物理隔离
- 彻底解决 AI 流式吐字时单词 token 命中分词逻辑导致中英杂糅的缺陷（如英文原句中 `Control` 误译为“控制”）。
- 双层精准过滤：彻底跳过 `.cursor-edit` 及思考正文包裹容器，杜绝任何正文词汇误篡改。
- 外部触发药丸保留汉化：`Thought for 4s` 汉化为 `思考了 4s`，`Thinking...` 汉化为 `正在思考...`。

### 2. 动态正则转义失真全量纠正
- 修复注入模板字符串中的双重反斜杠问题（`\\d`、`\\s`、`\\+` 误匹配字面量反斜杠），全面恢复数字与文件数变更等正则语义。
- 修正限额标题动态匹配 `\s+Limit\s+Remaining` 转义丢失问题。

### 3. 控制中心全景功能升级
- 新增亮色 / 暗色主题一键切换按钮（支持持久化记忆与系统主题跟随）。
- 新增在线 Release 词库检测按钮与红点徽标提示，一键获取 GitHub 最新补丁。
- 优化浅色模式下打包中的半透明遮罩与文案对比度，彻底修复白底白字无法看清问题。
- 增加“清除前端缓存”一键维护工具。
