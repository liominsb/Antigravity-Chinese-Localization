# Antigravity-Chinese-Localization

Antigravity 深度汉化与高性能本地化补丁程序

中文 | [English](README.en.md)

[![GitHub release](https://img.shields.io/github/v/release/liominsb/Antigravity-Chinese-Localization?style=flat&color=blue)](https://github.com/liominsb/Antigravity-Chinese-Localization/releases/latest)
[![GitHub downloads](https://img.shields.io/github/downloads/liominsb/Antigravity-Chinese-Localization/total?style=flat&color=success)](https://github.com/liominsb/Antigravity-Chinese-Localization/releases)
[![GitHub stars](https://img.shields.io/github/stars/liominsb/Antigravity-Chinese-Localization?style=flat&color=gold)](https://github.com/liominsb/Antigravity-Chinese-Localization/stargazers)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/liominsb/Antigravity-Chinese-Localization)
[![Package Size](https://img.shields.io/badge/ASAR%20Size-4.53%20MB%20(Official%20Standard)-success)](https://github.com/liominsb/Antigravity-Chinese-Localization)
[![Node Runtime](https://img.shields.io/badge/Node.js-%3E%3D%2014.0.0-informational)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/liominsb/Antigravity-Chinese-Localization)](LICENSE)

专为 Google Antigravity 打造的高性能、非破坏性深度汉化补丁。全面适配 **Antigravity v2.26.0+** 最新架构，深度重构基础算力层与 DOM 调度层，带来百万级吞吐量的极致流畅体验。全量汉化规划模式、系统设置、权限沙盒、官方插件生态等上千条核心界面文案，严格遵循官方 4.53 MB 轻量级打包规格，并对用户打字与代码编辑区实施绝对物理免疫。

> [最新 Release 下载](https://github.com/liominsb/Antigravity-Chinese-Localization/releases/latest) · [问题反馈与建议](https://github.com/liominsb/Antigravity-Chinese-Localization/issues)

---

## 核心特性矩阵

### 1. 全景交互与工作流深度汉化 (UI & Workflow Coverage)

| 核心模块 | 覆盖深度与技术指标 | 汉化范围与业务价值 |
| :--- | :--- | :--- |
| **规划模式 (Planning Mode)** | 全生命周期闭环深度汉化 | 覆盖规划模式开关、实施计划 (Implementation Plan)、变更回顾 (Walkthrough)、审批阻断、待确认问题、代码拟定变更及测试验证全套流程。 |
| **系统设置 (Settings)** | 150+ 设置项全景覆盖 | 汉化外观主题、对话流宽度自适应、防休眠、后台保活、自动检查更新、命令执行策略（直接执行/人工审查/严格模式/极速模式）、数据存储与缓存维护。 |
| **安全与权限沙盒 (Permissions)** | 粒度精细化安全策略 | 适配 2.14.0 最新全局权限与项目继承架构，汉化终端沙盒、沙盒外命令确认、文件访问策略（允许/询问/拒绝）、网络策略及域名/命令黑白名单。 |
| **会话分屏与多维协作 (Split & Fork)** | 原生菜单 + DOM 级联全覆盖 | 全面覆盖左侧栏会话分屏（向右/向下分屏、均分窗格、分屏差异比对）、会话派生 (Fork)、分组管理（新建/移动/重命名/删除）全套菜单。 |
| **侧边问答与版本控制 (Side Q & Git)** | 2.13.0+ 专项交互适配 | 深度汉化侧边问答系统（问答卡片/选项交互/最小化计数器）、源码控制 Git Amend（追加提交）全流程及悬停卡片（Hover Card）。 |
| **官方插件与远程生态 (Plugins & Remote)** | 全生命周期生态管理 | 深度汉化插件中心全套操作（安装/卸载/启用/禁用）、构件标签（Skills/Rules/MCP/Hooks）以及远程控制（Remote Control）跨设备流转弹窗。 |

### 2. 专业开发哲学与物理安全装甲 (Ergonomics & Physical Sandbox)

| 核心策略 | 防护机制与实现方案 | 业务价值与开发者保障 |
| :--- | :--- | :--- |
| **模型与思考链原生保留** | 100% 保持官方英文原生 | 严格遵循专业开发习惯，模型下拉框（Gemini 3.8 / Claude 3.7 等）及思考链（Thinking / Thought 过程）保留原生英文，杜绝机器硬翻引起的认知歧义。 |
| **编辑器与输入物理免疫** | Shadow DOM 穿透隔离 | 智能免疫 `INPUT`、`TEXTAREA`、富文本输入框、Monaco 代码编辑器、Diff 比对器与用户对话气泡，绝对物理隔离，严禁篡改用户编写的代码与 Prompt。 |
| **无损备份与一键自愈** | 双向无损瞬时切换 | 首次部署自动生成官方原版 `app.asar.bak`，支持随时通过控制面板或命令行 `node localize.js --restore` 毫秒级无损还原至官方纯英文状态。 |

### 3. 工业级底层算力与工程工艺 (High-Performance Engine & Engineering)

| 工程维度 | 性能指标与工程标准 | 底层技术实现 |
| :--- | :--- | :--- |
| **极致吞吐与高帧率调度** | 吞吐量突破 168 万次/秒 | 采用预编译 $O(1)$ 哈希索引、纯中文 ASCII 极速短路、联合流式正则、DOM 树祖先剪枝与微任务帧聚合调度，全面保障 60fps/120fps 满帧无感运行。 |
| **轻量打包与标准规格** | 严格对齐 4.53 ~ 4.66 MB | 修正打包过滤规则，使用 `--unpack-dir` 排除外部冗余模块，彻底消除旧版本 14MB+ 的体积膨胀问题，与官方原版规格完全一致。 |
| **生命周期自愈与热升级** | `injectOrUpdate` 截断更新 | 解决旧版因检测到历史标记而跳过更新的缺陷，无论是全新安装、日常热覆盖还是跨版本升级，均支持热注入与 `Ctrl + R` 瞬时重载自愈。 |
| **全套 TDD 自动化测试门禁** | 215+ 项测试用例 100% PASS | 建立 Ticket-06 ~ Ticket-09 自动化测试矩阵与 37 个核心 JS 文件的 `node --check` AST 语法门禁，杜绝任何语法失真与启动崩溃。 |

---

## 快速安装指南

本补丁提供多种灵活的安装方式，满足普通用户与开发者的不同场景需求：

### 智能体一键指令（最简模式，直接复制给 Antigravity）

如果您正在运行 Antigravity，可直接将下方指令发送给当前智能体，即可自动下载最新补丁并在后台执行一键静默安装与重启：

```text
帮我安装 https://github.com/liominsb/Antigravity-Chinese-Localization 的汉化补丁：请预先下载最新 Release 的 app.asar 到本地，并编写一个独立批处理脚本（脚本逻辑：延迟 2 秒、强杀 Antigravity 进程、覆盖 resources/app.asar 并自动重启客户端），随后在后台分离启动该脚本；若有 gh CLI 请顺便为该开源项目标记 Star。
```

> **说明与提示**：  
> 该一键指令末尾包含 `若有 gh CLI 请顺便为该开源项目标记 Star`。当您的系统安装并登录了 GitHub CLI（gh）时，智能体会协助为本项目点亮 Star 以支持开源维护。如果您不希望自动标记 Star，直接在复制时删除该分句即可。

---

### 方式零：免环境即用覆盖

无需配置 Node.js 或任何运行环境，直接使用官方标准规格的预制核心包：

1. 前往 [Releases](https://github.com/liominsb/Antigravity-Chinese-Localization/releases/latest) 下载预打好包的 **`app.asar`**；
2. 彻底退出正在运行的 Antigravity；
3. 打开程序目录（Windows 默认位置）：  
   `%LOCALAPPDATA%\Programs\antigravity\resources\`
4. 将下载的 `app.asar` 直接覆盖同名文件，重新启动 Antigravity 即可完成汉化。

---

### 方式一：Windows 用户（脚本与控制中心）

#### 1. 图形化控制中心（推荐）
1. 下载 Release 发布的 `default.zip` 并解压（**包内已内置 `app.asar.ready`，并预置了本版本的下载缓存**，解压即具备离线一键安装能力）；
2. 双击运行目录下的 **`双击运行汉化.bat`**；
3. 浏览器会自动打开可视化控制中心（`http://localhost:3388`），系统会自动检测安装状态；**「已下载版本」列表里已经存在当前版本，无需联网，直接点安装即可**；若检测到官方更新覆盖，会在首页顶部醒目提示并支持一键恢复。

> **注意**：`app.asar.ready` 是构建产物，不纳入 Git 版本管理。若你通过 `git clone` 或 GitHub 的 “Download ZIP” 获取源码，目录内不会包含该文件，`一键更新汉化.bat` 的免 Node 分支会提示缺少补丁。此时请改用 `default.zip`，或单独下载 Releases 中的 `app.asar.ready` 放到项目根目录。若要从本机已安装的客户端现取一份：先执行 `node localize.js --now` 完成注入，再把 `%LOCALAPPDATA%\Programs\antigravity\resources\app.asar` 复制到项目根目录并命名为 `app.asar.ready`（`localize.js` 只就地覆盖客户端文件，不会自己生成这个就绪包）。

控制中心首页显示实际已安装的 `app.asar` 版本，可以直接读取 GitHub Releases，选择最新正式版或历史版本。“仅下载”将文件缓存到本项目的 `downloads/` 目录；“下载并安装”在下载和 SHA-256 校验后，确认安装到配置的目标路径。更新说明和已下载版本默认折叠；路径配置、本地脚本汉化、还原及日志可在“设置与维护”中展开。

各版本缓存会一直保留。用户可以在“已下载版本”列表中安装或单独删除某个缓存包；删除缓存不会修改 Antigravity 的安装文件。安装确认会提醒先保存编辑；用户确认后，如程序仍在运行，控制中心会结束所有 Antigravity 实例及后台语言服务，并严格确认进程退出后才备份和安装。强制退出可能丢失未保存的编辑；停止失败时不替换安装文件。替换失败会尝试恢复本次备份。备份按文件内容（SHA-256）去重，相同内容直接复用已有备份；当前安装文件已经与所选包一致时，跳过结束进程、安装和备份。不同内容的备份及历史备份会保留，不自动删除。原有“一键汉化”按钮继续使用本地脚本注入流程。

#### 2. 一键快速更新与官方更新恢复（双击即用）
官方客户端自动更新后会还原为英文原版，此时双击运行 **`一键更新汉化.bat`**：
- 自动检测 Node.js 环境与客户端实际版本；
- 具备严格的版本兼容性校验（避免因跨版本强行覆盖造成客户端白屏）；
- 自动备份原版并原子替换恢复汉化；
- 若系统无 Node.js 环境，则自动降级为纯批处理保底流程（直接使用目录内的 `app.asar.ready`，因此请确保从 `default.zip` 解压获得该文件）。

#### 3. 命令行极速部署与静默恢复（免开浏览器）
在终端中进入项目目录，执行以下命令：
```bash
# 官方更新后自动检查并恢复（匹配版本安全安装，不兼容则自动拦截）
node localize.js --auto-restore

# 查看客户端状态与本地补丁兼容性信息
node localize.js --check-status

# 直接全量重新打包并部署
node localize.js --now
```

---

### 方式二：Linux / Ubuntu 用户

1. 打开终端，进入项目目录，运行一键启动脚本：
   ```bash
   ./运行汉化.sh
   ```
2. 浏览器自动打开可视化控制面板，点击“一键汉化”。  
   或者直接通过无头命令行部署：
   ```bash
   node localize.js --now
   ```

---

### 方式三：macOS 用户

1. 打开终端，进入项目目录，赋予执行权限并运行：
   ```bash
   chmod +x 运行汉化.sh
   ./运行汉化.sh
   ```
2. 浏览器自动打开控制中心，点击“一键汉化”。默认定位路径为 `/Applications/Antigravity.app`。

> **macOS 代码签名提示**：  
> 在 macOS 下修改应用内部 asar 包会破坏原有的签名信息，Gatekeeper 可能会拦截并提示“应用已损坏，无法打开”。若遇到该情况，在终端中执行以下命令清除隔离属性即可恢复正常：  
> ```bash
> xattr -cr /Applications/Antigravity.app
> ```

---

## 常用命令行参数

`localize.js` 支持直接通过参数进行静默操作，适合自动化脚本或开发者快速调用：

```bash
# 立即执行汉化并静默退出（不启动 Web 界面）
node localize.js --now

# 立即恢复到官方原版英文（使用 app.asar.bak 还原）
node localize.js --restore

# 仅解包 app.asar 到 extracted 目录（用于开发与分析）
node localize.js --extract-only

# 仅从 extracted 目录重新打包为 app.asar
node localize.js --pack-only
```

---

## 开发者文档 (Developer Documentation)

本项目并非单纯的文本查找替换脚本，而是在 Electron 原生渲染管线与 React 虚拟 DOM 调度层之间构建的一套高韧性、高吞吐的工业级本地化引擎。

```text
[ Antigravity 启动 ]
        │
        ├─► [ 原生层: dist/loadingOverlay.js ] ──► 本地化启动遮罩动画
        ├─► [ 原生层: dist/menu.js & tray.js ] ──► 本地化原生菜单栏与系统托盘
        │
        └─► [ Web 容器: dist/preload.js ]
                    │
                    ▼
        [ DOM_TRANSLATOR_INJECTION 核心引擎 ]
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  [ 算力层: 预编译哈希 ]   [ 调度层: 微任务与剪枝 ]
  • Map O(1) 极速索引     • 联合词边界流式正则 (CORE_WORDS_UNION_REGEX)
  • ASCII 纯中文极速短路   • DOM 树祖先剪枝 (消灭 O(N^2) 嵌套递归)
  • WeakSet 成功标记门禁   • queueMicrotask 高保真帧聚合调度
        │                       │
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────────────────┐
        ▼                                   ▼
  [ 绝对物理免疫沙盒 ]                 [ 生命周期自愈与动态切片 ]
  • Monaco 代码编辑器物理隔离         • Ctrl + R 重载生命周期与占位节点保护
  • INPUT / TEXTAREA 用户打字免疫     • React 独立节点物理切片动态自愈拼合
  • 控制中心防密码管理器篡改装甲       • 前置长句正则与中英混排纠偏
```

完整架构设计、底层算力算法、50,000 次压测基准数据与工程工艺详见 [docs/](docs/)：

| 文档 | 语言 | 核心技术要点 |
| :--- | :--- | :--- |
| [architecture.md](docs/architecture.md) | 中文 | 基础算力层重构 ($O(1)$ Map 哈希与 ASCII 短路)、DOM 调度层优化 (联合流式正则与祖先剪枝)、`Ctrl+R` 重载生命周期自愈与 React 切片拼合、50,000 次压测基准数据、Shadow DOM 输入免疫与控制中心防篡改装甲 |
| [architecture.en.md](docs/architecture.en.md) | English | Deep engineering breakdown: $O(1)$ precompiled Map lookups, ASCII short-circuit, unified regex stream scanning, DOM ancestor pruning, queueMicrotask frame aggregation, 1.68M qps benchmark, lifecycle healing & input physical immunity |

### 发布打包（生成 default.zip）

**Windows 用户可以直接双击 `打包发布.bat`**：脚本会检查 Node 环境、从 `localize.js` 读取 `CURRENT_VERSION` 对就绪包做版本强校验，再调用打包器。该 bat 刻意保持纯 ASCII、中文提示统一由 Node 输出——实测 cmd 在 `chcp 65001` 下解析含多字节字符的行会丢字节，导致 `echo` 输出被截断，且出错位置随脚本长度漂移，无法靠调整标点规避。

命令行方式：`app.asar.ready` 是构建产物，被 `.gitignore` 中的 `app.asar*` 规则排除，因此任何源码包都不会自带它。发布前请先确保项目根目录已存在构建好的 `app.asar.ready`，再执行：

```bash
# 自动读取 ready 包内版本号，输出 release-assets/default.zip
node build-release-zip.js

# 强制校验版本，版本不符直接失败，避免发错包
node build-release-zip.js --version 2.26.0

# 手动指定 GitHub Release ID（无网络或自动查询失败时使用）
node build-release-zip.js --version 2.26.0 --release-id 422504512

# 跳过预置下载缓存（"已下载版本"列表将为空，用户需自行点「仅下载」）
node build-release-zip.js --version 2.26.0 --no-cache

# 自定义输出路径
node build-release-zip.js --out /tmp/default.zip
```

**预置下载缓存**：默认会在包内生成 `downloads/release-<tag>-<releaseId>-<sha256>/` 目录，内含 `app.asar.ready` 与 `download.json` 元数据。用户解压后打开控制中心，「已下载版本」列表里便直接存在该版本，可离线一键安装，无需再联网点「仅下载」。缓存目录名必须与 `release-manager.js` 的命名规则严格一致，否则会被 `listFiles()` 当作无关目录丢弃，因此打包器的 cacheId 直接复用该模块导出的 `makeCacheId`，不另写一套实现。`releaseId` 默认通过 GitHub API 按 tag 自动查询（缓存目录名需带上真实 ID，供「重新下载」入口使用），无网络时用 `--release-id` 手动指定。

打包器零第三方依赖（只用 Node 内置的 `zlib` 自行写出 ZIP），写入后会重新解析压缩包中央目录自检，任一项不满足即构建失败，不会产出半成品包：

- 条目数量与清单一致，`app.asar.ready` 确实在包内且字节长度吻合；
- 文件名带 UTF-8 标志位，`一键更新汉化.bat`、`运行汉化.sh` 等中文名在 Windows / Linux / macOS 解压均不丢字；
- 条目路径一律使用正斜杠且非绝对路径，避免 Linux/macOS 解压后变成怪文件名或越界写入；
- `.sh` 写入 `0755` 可执行位、普通文件 `0644`、目录 `0755`，Linux/macOS 解压后可直接 `./运行汉化.sh`，无需额外 `chmod +x`。

---

## 版本更新日志 (Changelog)

各版本的详细更新记录、新特性适配细节与底层技术架构演进，请参阅独立的 [CHANGELOG.md](CHANGELOG.md)（英文版请参阅 [CHANGELOG.en.md](CHANGELOG.en.md)）：

- **[v2.15.1](CHANGELOG.md#v2151-2026-09-21)** (2026-09-21)：全面适配 Antigravity v2.15.1 最新官方构建；左侧栏置顶会话（Pinned Conversations）及常用分组标题全量汉化；通过全套 305 项 TDD 自动化测试与 37 个 JS 文件 AST 静态语法校验门禁。
- **[v2.15.0](CHANGELOG.md#v2150-2026-09-19)** (2026-09-19)：全面适配 Antigravity v2.15.0 核心架构；自定义智能体默认提示词与工具控制汉化；未关联项目状态与无效工具调用轻量提示优化；通过全套 239 项 TDD 自动化测试与 37 个 JS 文件 AST 静态语法校验门禁。
- **[v2.14.0](CHANGELOG.md#v2140-2026-09-16)** (2026-09-16)：全面适配 Antigravity v2.14.0 核心架构；版本定义与依赖平滑升级；通过全套 TDD 自动化测试与 37 个 JS 文件 AST 静态语法校验门禁。
- **[v2.13.0](CHANGELOG.md#v2130-2026-09-13)** (2026-09-13)：全面适配 Antigravity v2.13.0 核心架构；深度汉化侧边问答系统 (Side Question / Questionnaire)；全流程汉化源码控制 Git Amend（追加提交）；通用设置高级区域重构适配；产物与表格宽度自适应显示控制；Windows 管理员权限 UAC 提升流程汉化；自然语言插件构建与自定义项视图分类；左侧会话分屏 (Split)、派生 (Fork) 与分组管理全套级联菜单深度汉化与原生菜单语法加固。
- **[v2.12.2](CHANGELOG.md#v2122-2026-09-08)** (2026-09-08)：全面适配 Antigravity v2.12.2 核心架构；斜杠命令（Slash Commands）与悬浮卡片全量汉化；上下文提及（@ Mention）菜单精准汉化与文件名保护；通用设置项深层补齐；原生应用菜单与侧边栏历史会话悬停卡片（Hover Card）动态时间与多状态指示深度汉化。
- **[v2.12.0.1](CHANGELOG.md#v21201-2026-09-04)** (2026-09-04)：模型思考链 (Thinking Process) 绝对物理隔离防误译；动态正则转义失真纠正；控制中心亮暗色主题切换、在线 Release 检测与一键缓存清理。

> 完整历史版本变更记录与工程细节请查阅 [完整更新日志 (CHANGELOG.md)](CHANGELOG.md)。

---

## 常见问题与排错 (FAQ)

### Q1: 运行汉化后，启动应用提示找不到文件或报错？
请检查是否在 Antigravity 尚未完全关闭的情况下执行了打包。Antigravity 的 Go 语言后端进程（`language_server.exe`）可能在后台占用文件句柄。  
解决办法：在任务管理器中确保 `Antigravity.exe` 及相关进程已完全退出，然后重新运行 `node localize.js --now`。

### Q2: 官方推送新版本后，汉化失效了怎么办？
官方推送更新后会静默覆盖 `app.asar`。只需在更新完成后重新执行一次汉化命令即可：
```bash
node localize.js --now
```
脚本会自动备份新的官方 `app.asar` 并重新注入最新的深度汉化补丁。或者直接下载最新 Release 预制的 `app.asar` 进行覆盖。

### Q3: 如何完全卸载汉化、恢复官方原版？
在控制中心点击“还原英文原版”，或者直接运行：
```bash
node localize.js --restore
```
程序将自动从此前备份的 `app.asar.bak` 中无损还原原始文件。

---

## 贡献者与开源协作

| 贡献者 | 角色与主要贡献 |
| :--- | :--- |
| [liominsb](https://github.com/liominsb) | 原项目创作者，搭建了最初的 Electron asar 注入与 Web 控制中心基础架构 |
| [LAN-TINA-WS](https://github.com/LAN-TINA-WS) | 2.12.0+ 深度重构、基础算力层与 DOM 调度层飞跃优化（168万次/秒）、4.53MB 瘦身修复、热更新引擎、生命周期与切片自愈、全套设置与插件生态词库扩充与独立维护 |
| [Justin-Mai](https://github.com/Justin-Mai) | 2.0 汉化控制中心架构升级、多用户/自定义路径、心跳自愈与防劫持、代码预览与 Diff 防误翻译隔离机制 |
| [songxitao](https://github.com/songxitao) | 2.10.0+ 深度适配、三层 DOM 物理隔离防护（彻底解决 Project 目录误译）、Markdown 与代码区防污染、全套 TDD 自动化测试套件构建 |

- **参与贡献**：欢迎提交 Pull Request 或通过 Issues 反馈未汉化的词条与界面。

---

## 开源许可

本项目采用 [MIT License](LICENSE) 许可协议。
