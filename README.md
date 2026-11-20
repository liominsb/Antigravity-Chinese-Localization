# Antigravity-Chinese-Localization

Antigravity 深度汉化与高性能本地化补丁程序

中文 | [English](README.en.md)

[![GitHub release](https://img.shields.io/github/v/release/antigravity-cn-community/Antigravity-Chinese-Localization?style=flat&color=blue)](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/releases/latest)
[![GitHub downloads](https://img.shields.io/github/downloads/antigravity-cn-community/Antigravity-Chinese-Localization/total?style=flat&color=success)](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/releases)
[![GitHub stars](https://img.shields.io/github/stars/antigravity-cn-community/Antigravity-Chinese-Localization?style=flat&color=gold)](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/stargazers)
[![GitHub Discussions](https://img.shields.io/github/discussions/antigravity-cn-community/Antigravity-Chinese-Localization?style=flat&color=purple)](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/discussions)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization)
[![Package Size](https://img.shields.io/badge/ASAR%20Size-~7.1%20MB%20(Official%20Slim)-success)](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization)
[![Node Runtime](https://img.shields.io/badge/Node.js-%3E%3D%2018.18.0-informational)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/antigravity-cn-community/Antigravity-Chinese-Localization)](LICENSE)

专为 Google Antigravity 打造的高性能、非破坏性深度汉化补丁，现由开源社区组织 **[`antigravity-cn-community`](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization)** 联合维护。全面适配 **Antigravity v2.33.0+** 最新架构，完成 `src/` 模块化引擎解耦与 DOM 微任务调度重构，带来百万级吞吐量的极致流畅体验。全量汉化规划模式、系统设置、安全沙盒、Remote SSH 远程开发、Computer Use 桌面操控、Gemini Live 9 款语音音色与官方插件组合包（`Bundles`）等 `4,250+` 条核心界面文案，严格对齐官方原生轻量级打包规格（v2.33.0 约 7.08 MB），并对用户打字与代码编辑区实施绝对物理免疫。

> [最新 Release 下载](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/releases/latest) · [社区讨论与千星里程碑 (Discussions)](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/discussions) · [问题反馈与建议](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/issues)

---

## 核心特性矩阵

### 1. 全景交互与工作流深度汉化 (UI & Workflow Coverage)

| 核心模块 | 覆盖深度与技术指标 | 汉化范围与业务价值 |
| :--- | :--- | :--- |
| **规划模式与步骤计划 (Planning & Step Plan)** | 全生命周期闭环深度汉化 | 覆盖规划模式开关、实施计划 (Implementation Plan)、变更回顾 (Walkthrough)、Step Plan 步骤进度胶囊、审批阻断及待确认问题全套流程。 |
| **系统设置、语音与快捷键 (Settings & Voice)** | 250+ 设置项全景覆盖 | 覆盖双语配色主题（含 Nord / Everforest）、`VS Code Default` / `Antigravity (AGY) Style` 双模快捷键方案、Gemini Live 9 款音色与实时语音听写、浏览数据与按站点 Cookie 管理、以及模型配额与 `Orchestrator` 编排卡片。 |
| **安全与权限沙盒 (Permissions)** | 粒度精细化安全策略 | 适配全局权限、云端权限、GitHub 细粒度权限策略与项目继承架构，汉化终端沙盒、文件访问策略（允许/询问/拒绝）、网络策略及域名/命令黑白名单。 |
| **Remote SSH 与跨端协同** | 主进程 12 模块 + 前端联动 | 全面汉化 SSH 远程连接、断连/重启过渡页、密码/密钥口令/主机指纹弹窗、共享主目录冲突接管 (`Take Over`)、远程麦克风授权、SSH 配置文件编码/权限诊断及跨设备远程接力。 |
| **Computer Use 与多维协作** | 原生 HUD + 实时视频流窗格 | 超前覆盖 `v2.33.0` 新增 `Computer Use` 桌面操控悬浮栏 (`hud.js`)、`Agents Live` 实时画面流与暂停接管横幅、`/btw` 侧边提问（含一键插入主对话）、会话分屏派生与侧栏项目拖拽坐标热修复。 |
| **插件市场与组合包 (Marketplace & Bundles)** | 全生命周期生态管理 | 深度汉化扩展市场精选生态、`Bundles` 插件组合包、第三方/实验性插件安装前源码安全审查弹窗、构件标签（Skills/Rules/MCP/Hooks）及协调器 (`Coordinator`) 与定时自动化向导。 |

### 2. 专业开发哲学与物理安全装甲 (Ergonomics & Physical Sandbox)

| 核心策略 | 防护机制与实现方案 | 业务价值与开发者保障 |
| :--- | :--- | :--- |
| **模型与思考链原生保留** | 100% 保持官方英文原生 | 严格遵循专业开发习惯，模型名称（Gemini 4 / Orchestrator / Gemini 3.8 / Claude 等）、相对时间（`24m` / `2m ago`）及思考链（Thinking / Thought 过程）保留原生英文，杜绝机器硬翻歧义。 |
| **编辑器与输入物理免疫** | 叶子节点级 React Fiber 安全 | 智能免疫 `INPUT`、`TEXTAREA`、富文本输入框、Monaco 代码编辑器、Diff 比对器与用户对话气泡；严格仅修改叶子 `TextNode` 而不覆写容器 `Element.textContent`，杜绝破坏 React Fiber 子树。 |
| **双轨备份与防白屏门禁** | 版本指纹预检 + 原子替换 | 部署前自动校验原版并维护版本匹配的官方备份，跨版本还原自动安全拦截防白屏；连离线批处理也内置了 PowerShell 二进制 ASAR 头解析预检。 |

### 3. 工业级底层算力与工程工艺 (High-Performance Engine & Engineering)

| 工程维度 | 性能指标与工程标准 | 底层技术实现 |
| :--- | :--- | :--- |
| **极致吞吐与防夹生守卫** | 吞吐量突破 168 万次/秒 | 模块化拆分为 `src/dictionary.js` 与 `src/dom-translator.js`，前置 `O(1)` 哈希精确查找、ASCII 纯中文短路、DOM 祖先剪枝、`queueMicrotask` 帧聚合及 `coreWords` 100% 实词命中防夹生守卫。 |
| **本机回环安全装甲** | `127.0.0.1` + CSRF 强鉴权 | 控制中心强制绑定 `127.0.0.1`，全接口实施 `Host`/`Origin` 回环校验、单进程一次性 CSRF Token 鉴权、JSON 请求体大小限制与显式 TLS 证书校验。 |
| **轻量打包与标准规格** | 严格对齐官方原生规格（约 7.08 MB） | 使用 `--unpack-dir` 排除外部解包依赖，彻底消除历史版本体积膨胀问题，与官方原生分发包规格保持一致。 |
| **全套 TDD 自动化测试门禁** | 51 组测试套件 ALL GREEN | 覆盖模块化翻译引擎、词典零重复基线、主进程功能沙盒、AST 语法门禁、回环安全鉴权、无 Node.js 实机批处理离线桥接及流式发布下载防护。 |

---

## 快速安装指南

本补丁提供多种灵活的安装方式，满足普通用户与开发者的不同场景需求：

### 智能体一键指令（最简模式，直接复制给 Antigravity）

如果您正在运行 Antigravity，可直接将下方指令发送给当前智能体，即可自动下载最新补丁并在后台执行一键静默安装与重启：

```text
帮我安装 https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization 的汉化补丁：请预先下载最新 Release 的 app.asar 到本地，并编写一个独立批处理脚本（脚本逻辑：延迟 2 秒、强杀 Antigravity 进程、覆盖 resources/app.asar 并自动重启客户端），随后在后台分离启动该脚本；若有 gh CLI 请顺便为该开源项目标记 Star。
```

> **说明与提示**：  
> 该一键指令末尾包含 `若有 gh CLI 请顺便为该开源项目标记 Star`。当您的系统安装并登录了 GitHub CLI（gh）时，智能体会协助为本项目点亮 Star 以支持开源维护。如果您不希望自动标记 Star，直接在复制时删除该分句即可。

---

### 方式零：免环境即用覆盖

无需配置 Node.js 或任何运行环境，直接使用官方标准规格的预制核心包：

1. 前往 [Releases](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/releases/latest) 下载预打好包的 **`app.asar`**；
2. 彻底退出正在运行的 Antigravity；
3. 打开程序目录（Windows 默认位置）：  
   `%LOCALAPPDATA%\Programs\antigravity\resources\`
4. 将下载的 `app.asar` 直接覆盖同名文件，重新启动 Antigravity 即可完成汉化。

---

### 方式一：Windows 用户（脚本与控制中心）

#### 1. 图形化控制中心（支持无 Node.js 自动离线桥接）
1. 下载 Release 发布的 **`default.zip`**（或直接 clone 仓库 / 下载源码包），**先完整解压到本地文件夹**（请勿直接在压缩包预览窗口内双击运行；压缩包内已自带 `app.asar.ready`）；
2. 双击运行目录下的 **`双击运行汉化.bat`**：
   - **已安装 Node.js 环境**：自动启动本地管理服务并在默认浏览器打开可视化控制中心（`http://127.0.0.1:3388`），支持状态检测、在线拉取历史/最新 Release 补丁、备份去重与一键还原；
   - **未安装 Node.js 环境（开箱即用）**：自动识别同目录下的 `app.asar.ready`，**无缝切换至【离线安全模式】**直接校验客户端版本并完成安全备份与汉化部署，无需手动折腾运行环境！

控制中心首页显示实际已安装的 `app.asar` 版本，可以直接读取 GitHub Releases，选择最新正式版或历史版本。“仅下载”将文件缓存到本项目的 `downloads/` 目录；“下载并安装”在下载和 SHA-256 校验后，确认安装到配置的目标路径。更新说明和已下载版本默认折叠；路径配置、本地脚本汉化、还原及日志可在“设置与维护”中展开。

各版本缓存会一直保留。用户可以在“已下载版本”列表中安装或单独删除某个缓存包；删除缓存不会修改 Antigravity 的安装文件。安装确认会提醒先保存编辑；用户确认后，如程序仍在运行，控制中心会结束所有 Antigravity 实例及后台语言服务，并严格确认进程退出后才备份和安装。强制退出可能丢失未保存的编辑；停止失败时不替换安装文件。替换失败会尝试恢复本次备份。备份按文件内容（SHA-256）去重，相同内容直接复用已有备份；当前安装文件已经与所选包一致时，跳过结束进程、安装和备份。不同内容的备份及历史备份会保留，不自动删除。“设置与维护”中的“使用本地脚本汉化”按钮继续提供本地解包注入流程。

#### 2. 一键快速更新与官方更新恢复（双击即用）
官方客户端自动更新后会还原为英文原版，此时双击运行 **`一键更新汉化.bat`**：
- 自动检测 Node.js 环境与客户端实际版本；
- 具备严格的版本兼容性校验（即使在未安装 Node.js 的离线保底模式下，也会通过内置 PowerShell 二进制解析器校验 ASAR 版本与汉化指纹，彻底防止跨版本覆盖白屏与备份污染）；
- 自动备份纯净官方原版并原子替换恢复汉化。

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
2. 浏览器自动打开可视化控制面板，点击“下载并安装”（或在“设置与维护”中点击“使用本地脚本汉化”）。  
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
2. 浏览器自动打开控制中心，点击“下载并安装”（或在“设置与维护”中点击“使用本地脚本汉化”）。默认定位路径为 `/Applications/Antigravity.app`。

官方升级后需要重新应用汉化时，可在源码目录或包含 `localize.js` 的完整分发包中双击 **`一键更新汉化.command`**（首次使用可运行 `chmod +x 一键更新汉化.command`）。需要 Node.js 18.18.0 或更新版本；执行前会提示保存工作并确认，随后调用现有 `--auto-restore` 流程关闭客户端、备份并恢复汉化，成功后打开应用。此入口不依赖 `extracted/`，不联网下载或重新打包；仅支持实际归档版本相同的本地预制包，版本不匹配或无法读取时停止。尚未发布对应版本汉化包时，请等待适配，不要用旧包覆盖新客户端。这里的“恢复”指恢复汉化，不是还原英文版。

启动器优先使用当前 PATH 中可用的 Node，并补充常见 Homebrew 路径；必要时通过用户的登录交互 shell 加载 nvm、fnm、asdf 等初始化配置，再尝试 NVM 默认版本。请确保这些工具已在自己的 shell 中正确配置。自动打开应用失败只显示提示，不会改变汉化成功的退出码。

> **macOS 代码签名提示**：  
> 在 macOS（尤其是 Apple Silicon `arm64`）下修改应用内部 `app.asar` 会破坏原有的代码签名密封哈希，Gatekeeper 或 `amfid` 可能提示“应用已损坏，无法打开”。若遇到该情况，请在终端执行以下命令清除隔离属性并进行本地 Ad-hoc 重签（注：重签可能会重置 macOS 本地 TCC 权限授权）：  
> ```bash
> xattr -cr "/Applications/Antigravity.app" && codesign --force --deep --sign - "/Applications/Antigravity.app"
> ```

---

## 在喜鹊（Magpie）中使用

喜鹊用户可以从侧栏找到本社区的汉化项目。插件负责下载、校验和应用本仓库翻译脚本生成的汉化包，也可以从本机备份还原。

Windows 上，克隆完整仓库，在喜鹊的插件页选择「从文件夹添加」，选中 `integrations/magpie` 并启用。打开侧栏的「Antigravity 汉化」，下载汉化包，退出客户端后点「应用汉化」。下次从原入口启动即可使用中文。macOS 用户请先参阅上方的代码签名说明。

已有匹配的缓存包可直接应用；「还原官方版」使用同版本的本机备份。自定义安装目录可在插件选项中设置 `appDir`。[查看喜鹊中的实际界面](docs/magpie-workbench.png)

## 常用命令行参数

`localize.js` 支持直接通过参数进行静默操作，适合自动化脚本或开发者快速调用：

```bash
# 立即执行汉化并静默退出（不启动 Web 界面）
node localize.js --now

# 官方更新后自动检查并恢复汉化（版本不兼容时自动拦截，退出码 2）
node localize.js --auto-restore

# 查看安装路径、客户端版本、汉化状态与可用补丁
node localize.js --check-status

# 仅对已解包的 extracted 目录注入汉化文本（开发者调试用）
node localize.js --apply-only
```

> **参数白名单**：`localize.js` 只接受上述四个参数。传入其它参数（包括旧版文档里曾出现、但从未实现的 `--restore`、`--extract-only`、`--pack-only`）会立即报错并以退出码 `1` 结束，不会再静默启动 Web 面板。

---

## 开发者文档 (Developer Documentation)

本项目并非单纯的文本查找替换脚本，而是在 Electron 原生渲染管线与 React 虚拟 DOM 调度层之间构建的一套高韧性、高吞吐的工业级本地化引擎。

```text
[ 模块化构建层: src/ ]
  • src/dictionary.js (4,250+ 零重复词典 + 实词库)
  • src/dom-translator.js (Web UI 实时翻译与防夹生引擎)
  • src/build-injection.js (编译拼接与载荷校验)
  • src/http-security.js & src/backup-utils.js (127.0.0.1 回环鉴权与双轨备份校验)
        │
        ▼
[ Antigravity 启动 ]
        │
        ├─► [ 原生层: dist/menu.js & updater.js ] ──► 本地化原生菜单栏与更新状态机
        ├─► [ 原生层: dist/tray.js & ipcHandlers.js ] ──► 本地化系统托盘与全量右键菜单
        ├─► [ 原生层: dist/remote/* & dist/computer/* ] ──► Remote SSH 生命周期与 Computer Use HUD
        │
        └─► [ Web 容器: dist/preload.js & wizardPreload.js ]
                    │
                    ▼
        [ DOM_TRANSLATOR_INJECTION 核心引擎 ]
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  [ 算力层: 预编译哈希 ]   [ 调度层: 微任务与剪枝 ]
  • Map O(1) 前置精确索引   • 100% 实词命中防夹生守卫
  • ASCII 纯中文极速短路   • DOM 树祖先剪枝 (消灭 O(N^2) 嵌套递归)
  • WeakSet 成功标记门禁   • queueMicrotask 高保真帧聚合调度
        │                       │
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────────────────┐
        ▼                                   ▼
  [ 绝对物理免疫沙盒 ]                 [ 生命周期自愈与动态切片 ]
  • Monaco 代码编辑器物理隔离         • 叶子 TextNode 改写保护 React Fiber
  • INPUT / TEXTAREA 用户打字免疫     • React 独立节点物理切片动态自愈拼合
  • 思考链与用户提问框双重免疫       • 侧边栏展开态项目拖拽坐标补偿热修复
```

完整架构设计、底层算力算法、50,000 次压测基准数据与工程工艺详见 [docs/](docs/)：

| 文档 | 语言 | 核心技术要点 |
| :--- | :--- | :--- |
| [architecture.md](docs/architecture.md) | 中文 | 基础算力层重构 ($O(1)$ Map 哈希与 ASCII 短路)、DOM 调度层优化 (联合流式正则与祖先剪枝)、`Ctrl+R` 重载生命周期自愈与 React 切片拼合、50,000 次压测基准数据、Shadow DOM 输入免疫与控制中心防篡改装甲 |
| [architecture.en.md](docs/architecture.en.md) | English | Deep engineering breakdown: $O(1)$ precompiled Map lookups, ASCII short-circuit, unified regex stream scanning, DOM ancestor pruning, queueMicrotask frame aggregation, 1.68M qps benchmark, lifecycle healing & input physical immunity |

---

## 版本更新日志 (Changelog)

各版本的详细更新记录、新特性适配细节与底层技术架构演进，请参阅独立的 [CHANGELOG.md](CHANGELOG.md)（英文版请参阅 [CHANGELOG.en.md](CHANGELOG.en.md)）：

- **[v2.33.0](CHANGELOG.md#v2330-2026-11-18)** (2026-11-18)：全面同步适配官方 `v2.33.0` 大版本架构更新！重磅覆盖 `Computer Use` 桌面操控 HUD 悬浮条与 `Agents Live` 实时桌面预览窗格、Remote SSH 服务端重启/共享目录接管/远程麦克风授权与配置诊断、新版 9 款 Gemini Live 音色与实时语音听写、内置浏览器按站点 Cookie 管理、VS Code / AGY 双模快捷键方案以及扩展市场 `Bundles` 插件组合包与安装前源码审查；同步完成 `src/` 模块化引擎解耦、回环安全鉴权与词库去重瘦身（共 `4,250+` 条零重复词条、51 组自动化测试门禁 100% ALL GREEN）。
- **[v2.32.2.1](CHANGELOG.md#v23221-2026-11-17)** (2026-11-17)：深度补齐对话页排队发送按钮（`Send all (N)` ➔ `全部发送 (N)`）及排队消息卡片（`Sends after agent finishes working`、`Empty message`）、补全模型思考档位 `Extra` / `Max`（`极高` / `最高` 及 `· 上下文窗口` 组合标签）、撤销确认弹窗、过长对话历史提示与 Best of N 回复偏好问卷（共 +44 条词典与 +8 组动态正则），并在放行排队/操作装饰栏的同时保持用户正文与时间标签（如 `2m ago`）原样不变。
- **[v2.32.2](CHANGELOG.md#v2322-2026-11-17)** (2026-11-17)：全面同步官方 `v2.32.2` 更新，新增官方插件市场 `Robotics` 机器人开发插件（描述及 9 条示例提示词）、GitHub 细粒度权限策略 (`GitHub Policies & Permissions`)、协调器 (`Coordinator`)、跨设备接力、侧边提问 (`Side Question`) 与自动化分步创建向导及定时计划编辑器（共 +140 条词典、+9 组动态正则与 +13 项原生菜单映射），并修复 `replaceInFile` 同义目标幂等逻辑。
- **[v2.32.1.2](CHANGELOG.md#v23212-2026-11-16)** (2026-11-16)：补全标签页与侧边栏原生右键菜单 40 项（含 `(Default)` 动态后缀）、117 条设置与右侧栏界面文案、`File not found` 兜底、首页问候语与第三方模型公告（PR #57）、模型专属限额动态正则及全套双语外观主题预设；植入 `setupSidebarProjectDragFix` 热修复官方左侧栏项目拖拽偏移 Bug；同步千星纪念组织化治理与共同 MIT 版权声明（PR #58）。
- **[v2.32.1](CHANGELOG.md#v2321-2026-11-14)** (2026-11-14)：全面深度适配 Antigravity v2.32.1 与 Remote SSH 远程开发子系统（断开页、凭据密钥弹窗、主机管理与连接诊断），补全原生二级右键子菜单、`Ask /btw` 气泡、空状态防夹生机制与 Google Workspace / Gmail 等 16 款官方与合作插件生态汉化。
- **[v2.31.2](CHANGELOG.md#v2312-2026-11-12)** (2026-11-12)：全面适配 v2.31.2 维护更新；新增 macOS 一键更新恢复启动器并收紧版本安全校验防线；补充浏览器设置、项目作用域及删除弹窗对话统计自适应规则。
- **[v2.31.0](CHANGELOG.md#v2310-2026-11-10)** (2026-11-10)：全面适配 v2.31.0 大版本架构，验证 50 余处原生补丁点 100% 命中并通过 37+ 套回归测试门禁。
- **[v2.30.0](CHANGELOG.md#v2300-2026-11-10)** (2026-11-10)：适配 20 个官方新增原生模块与插件侧边栏能力，扩充设置与执行策略词库。
- **[v2.29.1](CHANGELOG.md#v2291-2026-11-08)** (2026-11-08)：扩展市场（Marketplace）全量插件生态详情页深度汉化，补齐原生右键二级子菜单。

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
在控制中心点击“还原英文原版”；也可以直接用此前备份的官方原版覆盖当前文件——`app.asar.bak` 与 `app.asar` 位于同一个 `Resources` 目录，把 `.bak` 复制过去改名为 `app.asar` 即可。

> 覆盖前请确认 Antigravity 已完全退出，否则文件可能被占用而复制失败；同时建议保留一份 `app.asar.bak`，以便下次重新汉化。

### Q4: 源码包中自带的 app.asar.ready 会导致仓库体积无限膨胀吗？
不会。终端用户下载的 Release 资产包或网页 "Download ZIP" 仅包含单版本快照（当前约 7.08 MB），零历史冗余包。对于通过 `git clone` 参与贡献的开发者，推荐使用浅克隆（Shallow Clone）：
```bash
git clone --depth=1 https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization.git
```
更多关于工程权衡、历史修剪与云端动态按需拉取的架构演进设计，请参阅 [架构与工程文档：二进制资产维护策略](docs/architecture.md#七版本分发与二进制资产维护策略-binary-assets--repository-maintenance-strategy)。

---

## 千星里程碑与 Star 增长趋势

> **2026 年 11 月 16 日 13:25（北京时间）**：项目正式突破 **1,000 Stars** 里程碑（从 2026-05-25 第 1 颗星起历时 175 天），并已顺利迁移至开源社区组织 **[`antigravity-cn-community`](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization)** 联合运营！欢迎前往 [Discussions 社区讨论区](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/discussions) 参与交流与反馈。

![Antigravity-Chinese-Localization 千星里程碑历史增长曲线](docs/star_history_light.png)

> 矢量图表存档：[docs/star_history_light.svg](docs/star_history_light.svg) · 全量时间戳数据：[docs/stargazers.json](docs/stargazers.json)

---

## 贡献者与开源协作

| 贡献者 | 角色与主要贡献 |
| :--- | :--- |
| [liominsb](https://github.com/liominsb) | 原项目创作者，搭建了最初的 Electron asar 注入与 Web 控制中心基础架构，推动仓库升级至社区组织联合运营 |
| [LAN-TINA-WS](https://github.com/LAN-TINA-WS) | 组织化联合维护者，2.12.0+ 深度重构、算力与 DOM 调度飞跃优化（168万次/秒）、`src/` 模块化安全加固、设置与插件词库全量扩充及 2.33.0+ 持续适配 |
| [Justin-Mai](https://github.com/Justin-Mai) | 2.0 汉化控制中心架构升级、多用户/自定义路径、心跳自愈与防劫持、代码预览与 Diff 防误翻译隔离机制 |
| [songxitao](https://github.com/songxitao) | 2.10.0+ 深度适配、三层 DOM 物理隔离防护、Markdown 与代码区防污染、全套 TDD 自动化测试套件构建 |
| [angel12538](https://github.com/angel12538) | 首页动态问候语、第三方模型上下线公告、用量窗口与设置长文案批量补漏及 Ticket-37/38 测试建设 |
| [mojingjing-git](https://github.com/mojingjing-git) | 2.26.0 ~ 2.29.0 多轮官方大版本适配、新增词条全量覆盖与版本校验修复 |
| [mutezebra](https://github.com/mutezebra) | macOS 双击「一键更新汉化.command」离线恢复启动器及自动恢复版本校验安全加固 |
| [501Ranger](https://github.com/501Ranger) | Linux / Ubuntu 平台适配及低版本 Node.js 兼容性支持 |
| [shixiaogaoya](https://github.com/shixiaogaoya) | 早期词典扩充及重复注入崩溃问题修复 |

- **参与贡献**：欢迎提交 Pull Request、在 [Discussions](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/discussions) 参与社区交流，或通过 [Issues](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/issues) 反馈未汉化的词条与界面问题。

---

## 开源许可

本项目采用 [MIT License](LICENSE) 许可协议。
