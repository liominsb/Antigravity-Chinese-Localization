# 版本更新日志 (Changelog)

本文件记录 Antigravity-Chinese-Localization 汉化项目的全部版本迭代与核心架构变动。

---

## 未发布 (Unreleased)

### 1. 修复发布包缺失就绪补丁导致一键安装失败
- **问题定位**：`app.asar.ready` 属于构建产物，被 `.gitignore` 的 `app.asar*` 规则排除，因此 `git clone` 与 GitHub “Download ZIP” 得到的源码包天然不含该文件；历史上 `default.zip` 打包时也未把它纳入，导致用户解压后运行 `一键更新汉化.bat`，在无 Node.js 环境下直接报“未找到就绪补丁”，在有 Node.js 环境下则返回 `NO_PATCH_FOUND` 并以失败码退出。
- **新增零依赖发布打包器 `build-release-zip.js`**：打包时自动把根目录的 `app.asar.ready` 一并写入 `default.zip`，输出至 `release-assets/`。支持 `--version` 强校验（版本不符直接失败，避免发错包）与 `--out` 自定义输出路径。
- **打包后自校验**：写入完成后重新解析 ZIP 中央目录，逐项核对条目数量、`app.asar.ready` 是否存在、字节长度是否一致、文件名是否带 UTF-8 标志位（保证 `一键更新汉化.bat` 等中文脚本名解压后不乱码），任一项不通过即构建失败，不产出半成品包。
- **新增 TDD 测试 `tests/release-zip.test.js`**：覆盖 CRC32 标准校验值、ZIP 结构与内容一致性、中文文件名 UTF-8 往返、目录条目保留、跨平台路径与权限、缺件/损坏包拦截，24 项断言全部通过。

### 2. 发布包跨平台兼容加固（Windows / Linux / macOS）
- **修复 `.sh` 丢失可执行位**：历史发布包以 FAT 宿主（`version made by = 0x0014`）写入，`运行汉化.sh` 的 Unix mode 为 `0o0`，Linux/macOS 用户解压后执行 `./运行汉化.sh` 会直接 `Permission denied`。现改为 Unix 宿主（`0x031E`）并按扩展名写入权限：`.sh` 为 `0755`、普通文件 `0644`、目录 `0755`，解压即用，无需 `chmod +x`。
- **新增跨平台自检闸门**：打包后强制校验条目路径为正斜杠、非绝对路径、`.sh` 带可执行位，任一不满足即构建失败。反斜杠路径在 Linux/macOS 上会被当作文件名的一部分（PowerShell `Compress-Archive` 的已知缺陷），绝对路径则存在解压越界风险，两者均被阻断。
- **路径兼容性实测对比**：Windows 自带 `tar.exe`（bsdtar）打出的 zip 中文名为 GBK 裸存、不设 UTF-8 标志也无 `0x7075` 兜底；`Compress-Archive`（PS 5.1）中文名正确但路径使用反斜杠。两者均不满足跨平台要求，故放弃纯批处理方案，统一使用 Node 打包器（打包流程本身依赖 `npx asar pack`，Node 环境已是既存前提）。
- **文档同步**：README 中英文版补充 `default.zip` 已内置 `app.asar.ready`，并说明源码包缺失该文件的原因与补救方式（改用 `default.zip`、单独下载该文件放入根目录、或从已汉化客户端的 `resources/app.asar` 复制一份）。

### 3. 发布包预置下载缓存，「已下载版本」解压即用
- **打包时预置缓存目录**：默认在包内生成 `downloads/release-<tag>-<releaseId>-<sha256>/`，内含 `app.asar.ready` 与 `download.json` 元数据。用户解压后打开控制中心，「已下载版本」列表直接列出该版本，可离线一键安装，无需再联网点「仅下载」。
- **cacheId 复用单一实现**：缓存目录名必须与 `release-manager.js` 的命名规则完全一致，否则 `listFiles()` 会将其视为无关目录丢弃。打包器直接复用该模块导出的 `makeCacheId`，不另写一套规则，避免两处实现漂移。
- **releaseId 使用真实值**：默认按 tag 从 GitHub API 查询（缓存目录名中的 ID 供「重新下载」入口使用，填占位值会让该入口指向不存在的发布），无网络时可用 `--release-id` 手动指定；`--no-cache` 可跳过预置。
- **`release-manager.js` 增加导出**：新增 `makeCacheId`、`CACHE_ID_PATTERN`、`FILE_NAME` 三个导出，供打包器与测试复用。
- **测试扩充至 39 项断言**：新增缓存目录命名、元数据字段完整性、缓存内 ready 字节一致性、路径规范等校验。

---

## v2.26.0 (2026-10-24)

### 1. 全面深度适配 Antigravity v2.26.0 官方最新架构
- **官方版本无缝平滑升级**：深度跟进官方 10 月 24 日最新推送的 2.26.0 版本，同步升级应用版本定义与全工程元数据至 `2.26.0`。
- **上游原生模块与核心文件 100% 兼容**：解包同步 2.26.0 官方原生模块与核心架构变动（新增 Google BeyondCorp 企业代理支持模块 `beyondcorpPac.js` 与调试控制台 `debugConsole.js`），保持与官方最新底座架构完全同步。
- **全新打包就绪包 app.asar.ready**：基于官方 2.26.0 核心代码完成汉化注入并重新打包，体积规范严格对齐官方标准规格。
- **设置中心与意见反馈汉化**：补全设置左侧栏底部的 “Give Feedback”（提供反馈）、“Send Feedback”（发送反馈）与反馈表单交互文本汉化。
- **社区优质贡献吸收 (PR #39 by @mojingjing-git)**：补齐 2.26.0 深度 Web UI 词条 427 条；大小写匹配优化为 O(1) 索引查找（DOM 遍历耗时降低 94%）；修复模板正则转义与动态选择器安全替换；引入 React 片段化组合句兜底机制。
- **全套 TDD 回归测试套件保持全绿**：新增 Ticket-25 专项自动化测试套件，全量回归测试流水线（Ticket-03 至 Ticket-25 以及 4 套架构测试，共 29 套套件）100% 保持通过 (ALL GREEN)。

---

## v2.25.0 (2026-10-22)

### 1. 全面深度适配 Antigravity v2.25.0 官方最新架构
- **官方版本无缝平滑升级**：深度跟进官方 10 月 22 日最新推送的 2.25.0 版本，同步升级应用版本定义与全工程元数据至 `2.25.0`。
- **上游原生模块与核心文件 100% 兼容**：解包同步 2.25.0 官方原生模块与核心依赖树（更新 `@connectrpc/connect` 系列组件），保持与官方最新底座架构完全同步。
- **全新打包就绪包 app.asar.ready**：基于官方 2.25.0 核心代码完成汉化注入并重新打包，体积规范对齐官方标准规格。
- **全套 TDD 回归测试套件保持全绿**：新增 Ticket-24 专项自动化测试套件，全量回归测试流水线（Ticket-03 至 Ticket-24 以及 4 套架构测试，共 28 套套件）100% 保持通过 (ALL GREEN)。

---

## v2.24.0 (2026-10-16)

### 1. 全面深度适配 Antigravity v2.24.0 官方最新架构
- **官方版本无缝平滑升级**：深度跟进官方 10 月 16 日最新推送的 2.24.0 版本，同步升级应用版本定义与全工程元数据至 `2.24.0`。
- **上游原生模块与核心文件 100% 兼容**：解包同步 2.24.0 官方原生模块与核心依赖树，保持与官方最新底座架构完全同步。
- **全新打包就绪包 app.asar.ready**：基于官方 2.24.0 核心代码完成汉化注入并重新打包，体积规范对齐官方标准规格。
- **全套 TDD 回归测试套件保持全绿**：新增 Ticket-23 专项自动化测试套件，全量回归测试流水线（Ticket-03 至 Ticket-23 以及 4 套架构测试，共 27 套套件）100% 保持通过 (ALL GREEN)。

---

## v2.23.1-p1 (2026-10-15)

### 1. 官方更新后自动检查与安全恢复汉化 (Issue #35)
- **双批处理入口智能升级**：升级 `一键更新汉化.bat` 与 `双击运行汉化.bat`，优先利用 Node.js 启动智能安全检查流程，并保留纯批处理离线保底能力。
- **严格版本兼容性拦截与防白屏机制**：引入 `auto-restore.js` 核心模块，自动提取官方客户端实际版本，与本地补丁包比对；版本一致时安全原子替换，版本不兼容时自动安全拦截并提示升级汉化包，杜绝跨版本强行覆盖导致白屏。
- **控制中心 Web 界面智能提示**：在控制中心（`index.html`）首页置顶“检测到官方更新覆盖”提醒条，支持一键安全恢复。
- **全套 TDD 回归测试套件保持全绿**：新增 Ticket-22 自动化测试套件（8 项断言 100% 通过），全量回归测试套件（26 套用例）保持 ALL GREEN。

---

## v2.23.1 (2026-10-14)

### 1. 全面深度适配 Antigravity v2.23.1 官方最新架构
- **官方版本无缝平滑升级**：深度跟进官方 10 月 14 日最新推送的 2.23.1 版本，同步升级应用版本定义与全工程元数据至 `2.23.1`。
- **上游原生模块与依赖树保持 100% 兼容**：解包同步 2.23.1 官方原生模块与核心依赖，保持与官方最新底座架构完全同步。
- **全套 TDD 回归测试套件保持全绿**：新增 Ticket-21 专项自动化测试套件，全量回归测试流水线（Ticket-03 至 Ticket-21）100% 保持通过 (ALL GREEN)。

---

## v2.23.0 (2026-10-13)

### 1. 全面深度适配 Antigravity v2.23.0 官方最新架构
- **官方版本无缝平滑升级**：深度跟进官方 10 月 13 日最新推送的 2.23.0 版本，同步升级应用版本定义与全工程元数据至 `2.23.0`。
- **上游原生模块与依赖树同步**：解包同步 2.23.0 官方原生模块与核心依赖，保持与官方最新底座架构 100% 同步兼容。
- **全套 TDD 回归测试套件保持全绿**：新增 Ticket-20 专项自动化测试套件，全量回归测试流水线（Ticket-03 至 Ticket-20）100% 保持通过 (ALL GREEN)。

---

## v2.22.0 (2026-10-09)

### 1. 全面深度适配 Antigravity v2.22.0 官方最新架构
- **官方版本无缝平滑升级**：深度跟进官方 10 月 9 日最新推送的 2.22.0 版本，同步升级应用版本定义与全工程元数据至 `2.22.0`。
- **上游原生模块与依赖同步**：更新官方解包核心文件与依赖树，保持与 2.22.0 官方原生架构 100% 同步兼容。
- **全套 TDD 回归测试套件保持全绿**：新增 Ticket-19 专项自动化测试套件（30 项断言全绿通过），全量回归测试流水线（Ticket-03 至 Ticket-19）100% 保持通过 (ALL GREEN)。

---

## v2.21.1 (2026-10-08)

### 1. Agent 执行标签与药丸（Run/Running/Ran）深度汉化
- **药丸特权放行白名单（isActionPill）全面扩充**：突破性重构 `shouldSkipNode` 规则，彻底放行包含 `Run`、`Running`、`Ran`、`Working`、`Done`、`Waiting`、`Rejected`、`Errored`、`Analyzed`、`Analyzing` 等核心动作药丸，杜绝执行药丸被代码块防御逻辑跳过而保持英文的问题。
- **双字典全量收录对齐**：在第一静态字典与第二注入字典中全量收录 `Run`（运行）、`Running`（正在运行 / 运行中）、`Ran`（已运行）及对应复数命令短语。

### 2. 工具组聚合折叠标题（pqb 函数）全量覆盖与动态数字统计
- **多动词三联与双联复合状态**：完整覆盖工具组折叠栏 `pqb` 函数输出的全部动词组合（探索、运行、编辑工件/文件），如 `已探索文件、已执行命令、已编辑文件`、`正在探索文件、运行命令、编辑工件` 等。
- **带数量统计动态正则**：支持各类带数量的复合状态短语（如 `已探索 3 个文件，已执行 2 条命令，已编辑 1 个文件`、`正在探索 2 个文件，正在运行 3 条命令，正在编辑 1 个工件`、`已运行 4 条命令`）。

### 3. 彻底根治“Ran 命令”半中半英夹生词
- **分词引擎词表对齐**：在分词核心词表 `coreWords` 中补齐收录 `run` 与 `ran`，消除过去因只分词替换 `command` 导致残留 `Ran 命令` 的根因。
- **多层自愈保底机制**：在动态正则匹配段与分词清洗后处理管道中均注入绝对拦截规则，彻底杜绝任何形式的 `Ran 命令`、`Running 命令` 或 `Ran 命令: <cmd>` 夹生词残留。
- **具体命令行模式汉化**：支持 `已运行命令: <cmd>`、`正在运行命令: <cmd>`、`等待命令执行完成（最多 N 秒）`、`已拒绝向命令发送终止请求` 等全套步骤行状态。

### 4. 全面深度适配 Antigravity v2.21.1 官方最新架构
- **官方版本无缝平滑升级**：深度跟进官方最新发布的 2.21.1 版本，同步升级应用版本定义与全工程元数据至 `2.21.1`。
- **拖拽与文件获取桥接兼容**：适配官方在 `preload.js` 中新增的 `getPathForFile`（基于 Electron `webUtils.getPathForFile`）原生桥接接口，保证文件拖拽与文件选择器在中文环境下的完整可用性。
- **设置中心新文案补全**：覆盖体验模式切换（`Project 4K`）、Token 预算提示、明细数量动态折叠/展开、文件读写权限分类、强烈对比度选项、法律帮助及云项目/聊天机器人/Sidecar 创建进度提示。
- **原生上下文菜单与托盘交互**：完整继承主进程 `ipcHandlers.js` 原生上下文菜单调度机制与系统托盘单击唤醒抢占焦点交互。

### 5. 全套 TDD 回归测试套件 100% 通过
- **Ticket-17 架构与文件完备性测试**：63 项断言全部通过。
- **Ticket-18 执行标签与工具组专项测试**：93 项断言全部通过。
- **全量回归流水线**：从 Ticket-03 至 Ticket-18 全套测试用例 100% 全部通过 (ALL GREEN)。

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
