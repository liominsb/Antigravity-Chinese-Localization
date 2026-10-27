# Antigravity-Chinese-Localization

Deep Localization & High-Performance Chinese Patch for Google Antigravity

[中文](README.md) | English

[![GitHub release](https://img.shields.io/github/v/release/liominsb/Antigravity-Chinese-Localization?style=flat&color=blue)](https://github.com/liominsb/Antigravity-Chinese-Localization/releases/latest)
[![GitHub downloads](https://img.shields.io/github/downloads/liominsb/Antigravity-Chinese-Localization/total?style=flat&color=success)](https://github.com/liominsb/Antigravity-Chinese-Localization/releases)
[![GitHub stars](https://img.shields.io/github/stars/liominsb/Antigravity-Chinese-Localization?style=flat&color=gold)](https://github.com/liominsb/Antigravity-Chinese-Localization/stargazers)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/liominsb/Antigravity-Chinese-Localization)
[![Package Size](https://img.shields.io/badge/ASAR%20Size-4.53%20MB%20(Official%20Standard)-success)](https://github.com/liominsb/Antigravity-Chinese-Localization)
[![Node Runtime](https://img.shields.io/badge/Node.js-%3E%3D%2014.0.0-informational)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/liominsb/Antigravity-Chinese-Localization)](LICENSE)

A high-performance, non-destructive deep Chinese localization patch designed for Google Antigravity. Fully adapted to the latest architecture of **Antigravity v2.26.0+**, featuring fundamental computational refactoring and DOM micro-batch scheduling that delivers 1.68 million queries/sec throughput. It provides comprehensive translation for Planning Mode, System Settings, Security Sandbox, and Google Plugin Ecosystem, strictly follows the official 4.53 MB slim packaging standard, and guarantees absolute physical immunity for code editors and user input fields.

> [Download Latest Release](https://github.com/liominsb/Antigravity-Chinese-Localization/releases/latest) · [Issues & Feedback](https://github.com/liominsb/Antigravity-Chinese-Localization/issues)

---

## Core Feature Matrix

### 1. UI & Workflow Coverage

| Core Module | Coverage Depth & Metrics | Translation Scope & Value |
| :--- | :--- | :--- |
| **Planning Mode** | Full Lifecycle Closed-Loop | Translates Planning Mode toggles, Implementation Plans, Walkthrough reviews, Approval prompts, Open Questions, Proposed Changes, Automated Tests, and Manual Verification workflows. |
| **System Settings** | 150+ Configuration Items | Translates Appearance (Light/Dark/System), Conversation Width, Keep-awake, Background Running, Auto Updates, Command Approval Policies (Always Run/Review/Strict/Turbo), Storage and Cache Maintenance. |
| **Security & Sandbox** | Granular Policy Engine | Fully adapted to 2.14.0 Global Permissions and Inherit Global architecture; translates Terminal Sandbox, confirmation rules, workspace file access (Allow/Ask/Deny), network policies, and domain/command whitelists. |
| **Split & Fork Collaboration** | Native Menu + DOM Cascades | Comprehensive coverage of left sidebar split views (Split Right/Down, Equalize Panes, Split Diff), Conversation Forking, and Group Management (New/Move/Rename/Delete) menus. |
| **Side Questions & VCS** | 2.13.0+ Deep Adaptation | Deeply translates Side Question / Questionnaire interactions (question cards, response choices, minimized counter), Git Amend full workflow, and Sidebar Hover Cards. |
| **Plugins & Remote Ecosystem** | Full Lifecycle Ecosystem | Translates Plugin Center operations (Install/Uninstall/Enable/Disable), Component badges (Skills/Rules/MCP/Hooks), and Remote Control cross-device flow modals. |

### 2. Developer Ergonomics & Physical Sandbox Guard

| Core Strategy | Guard Mechanism | Developer Protection & Value |
| :--- | :--- | :--- |
| **Native Model & Thinking Display** | 100% Native English Retained | Strictly adheres to developer ergonomics: Model selector dropdowns (Gemini 3.8 / Claude 3.7) and Thinking/Thought processes strictly retain native English, eliminating confusion caused by machine translation. |
| **Physical Code & Input Immunity** | Shadow DOM Penetration | Actively protects `INPUT`, `TEXTAREA`, rich text editors, Monaco Code Editor, Diff views, and user message bubbles with absolute physical isolation, guaranteeing zero tampering with prompts and source code. |
| **Lossless Backup & Self-Healing** | Instant Bidirectional Switch | Automatically creates `app.asar.bak` on first run, enabling instant one-click rollback to pristine English via UI or `node localize.js --restore` at any time. |

### 3. High-Performance Engine & Engineering Standards

| Engineering Dimension | Performance & Standards | Implementation Details |
| :--- | :--- | :--- |
| **High Throughput & Frame Rate** | Over 1.68 Million QPS | Leverages precompiled $O(1)$ Hash Map, ASCII short-circuit, unified regex stream scanning, DOM ancestor pruning, and microtask frame aggregation to ensure buttery-smooth 60fps/120fps operation. |
| **Slim Packaging Standards** | Aligned with 4.53 ~ 4.66 MB | Uses `--unpack-dir` to exclude redundant external Node modules, completely eliminating legacy 14MB+ package bloat and matching official distribution size. |
| **Lifecycle Self-Healing & Hot Updates** | `injectOrUpdate` Truncation Logic | Overcomes legacy limitations where existing markers prevented updates; supports hot file replacement and instantaneous `Ctrl + R` reload across versions. |
| **TDD Automated Test Gate** | 215+ Test Cases 100% PASS | Robust test matrix (Ticket-06 through Ticket-09) coupled with strict `node --check` AST syntax verification across 37 core JavaScript files, preventing runtime crashes. |

---

## Quick Installation

### Agent-Driven Execution (Easiest Method)

If you are running Antigravity, simply send the instruction below to your Antigravity agent to automate the download, kill-and-replace, and relaunch via a background detached script:

```text
帮我安装 https://github.com/liominsb/Antigravity-Chinese-Localization 的汉化补丁：请预先下载最新 Release 的 app.asar 到本地，并编写一个独立批处理脚本（脚本逻辑：延迟 2 秒、强杀 Antigravity 进程、覆盖 resources/app.asar 并自动重启客户端），随后在后台分离启动该脚本；若有 gh CLI 请顺便为该开源项目标记 Star。
```

> **Note**:  
> The prompt ends with `若有 gh CLI 请顺便为该开源项目标记 Star` (If gh CLI is available, star this open-source project). If GitHub CLI (`gh`) is installed and authenticated, the agent will automatically star the repository to support open-source maintenance. If you prefer not to star, simply remove that clause before copying.

---

### Method 0: Zero-Config Drop-in Replacement (Recommended, 5 Seconds)

No Node.js or build tools required:

1. Download the pre-built **`app.asar`** from [Releases](https://github.com/liominsb/Antigravity-Chinese-Localization/releases/latest);
2. Completely quit Antigravity;
3. Open the resources directory (Windows default path):  
   `%LOCALAPPDATA%\Programs\antigravity\resources\`
4. Overwrite the existing `app.asar` with the downloaded file and restart Antigravity.

---

### Method 1: Windows Users (Scripts & Dashboard)

#### 1. Web Dashboard (Recommended)
1. Download `default.zip` from Releases and extract (**`app.asar.ready` is bundled inside along with a pre-seeded download cache**, so one-click offline installation works immediately);
2. Double-click **`双击运行汉化.bat`**;
3. The dashboard opens automatically (`http://localhost:3388`), auto-detects program status, and highlights automatic recovery if official updates have overwritten the localization. **The current version is already listed under "已下载版本" (Downloaded Versions) — install it offline without downloading again.**

> **Note**: `app.asar.ready` is a build artifact and is not tracked by Git. If you get the project via `git clone` or GitHub's "Download ZIP", the file will be missing and the Node-free branch of `一键更新汉化.bat` will report a missing patch. Use `default.zip` instead, or download `app.asar.ready` from Releases into the project root. To capture one from your own installed client: run `node localize.js --now` first, then copy `%LOCALAPPDATA%\Programs\antigravity\resources\app.asar` to the project root as `app.asar.ready` (`localize.js` only overwrites the client in place and never produces this ready bundle itself).

The dashboard shows the installed `app.asar` version and lets you select the latest stable, historical, or prerelease localization package from GitHub Releases. Use "仅下载" (Download Only) to cache a package, or "下载并安装" (Download and Install) to verify its SHA-256 and confirm installation. Release notes, downloaded packages, and settings/maintenance tools are collapsed by default.

Downloaded packages remain available until you explicitly delete them. Installation asks you to save your work before confirming: running Antigravity instances and background language services will be stopped, and their exit is verified before replacing files. Forced exit can lose unsaved edits. If stopping fails, installation stops without replacing the archive. Backups are deduplicated by SHA-256 and retained; replacement failures attempt to restore the verified backup. An identical installed file skips process termination, installation, and backup creation. The original local-script localization and restore tools remain under settings/maintenance.

#### 2. One-Click Batch Update & Auto Recovery
When an official update overwrites localization with English defaults, double-click **`一键更新汉化.bat`**:
- Auto-detects Node.js runtime and client version;
- Performs strict version compatibility checks to prevent white-screen crashes;
- Creates safe backups and atomically restores Chinese localization;
- Gracefully falls back to pure batch script mode if Node.js is not installed (this branch consumes the bundled `app.asar.ready`, so extract from `default.zip`).

#### 3. Headless CLI Deployment & Silent Restore
In your terminal, navigate to the folder and run:
```bash
# Auto-check and restore localization after official updates (safe version guard)
node localize.js --auto-restore

# Inspect client status and local patch compatibility
node localize.js --check-status

# Full repack and deployment
node localize.js --now
```

---

### Method 2: Linux / Ubuntu Users

1. Open terminal, navigate to project directory, and run:
   ```bash
   ./运行汉化.sh
   ```
2. Open dashboard in browser and click "一键汉化", or deploy directly via headless CLI:
   ```bash
   node localize.js --now
   ```

---

### Method 3: macOS Users

1. Open terminal, grant execute permission, and launch:
   ```bash
   chmod +x 运行汉化.sh
   ./运行汉化.sh
   ```
2. Click "一键汉化" in the dashboard. The default path is `/Applications/Antigravity.app`.

> **macOS Code Signing Notice**:  
> Modifying the internal asar bundle breaks the original signature, and Gatekeeper may report "App is damaged". Run the following command in terminal to clear the quarantine flag:  
> ```bash
> xattr -cr /Applications/Antigravity.app
> ```

---

## Command Line Arguments

`localize.js` supports headless execution for automation or developer workflows:

```bash
# Execute localization immediately and exit
node localize.js --now

# Restore to pristine official English (using app.asar.bak)
node localize.js --restore

# Extract app.asar to extracted/ folder only
node localize.js --extract-only

# Repack from extracted/ folder to app.asar only
node localize.js --pack-only
```

---

## Developer Documentation

This project is not a simple string replacement script, but an industrial-grade localization engine operating between Electron's native rendering pipeline and React's virtual DOM reconciliation loop.

```text
[ Antigravity Launches ]
        │
        ├─► [ Native: dist/loadingOverlay.js ] ──► Localized loading splash screen
        ├─► [ Native: dist/menu.js & tray.js ] ──► Localized menus & system tray
        │
        └─► [ Web Container: dist/preload.js ]
                    │
                    ▼
        [ DOM_TRANSLATOR_INJECTION Core Engine ]
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  [ Compute: Precompiled Map ]   [ Scheduling: Microtasks & Pruning ]
  • Map O(1) instant lookup      • Unified word-boundary regex (CORE_WORDS_UNION_REGEX)
  • ASCII pure-Chinese bypass    • Ancestor Pruning (eliminates O(N^2) deep recursions)
  • WeakSet selective caching    • queueMicrotask high-fidelity frame scheduling
        │                       │
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────────────────┐
        ▼                                   ▼
  [ Absolute Physical Immunity ]       [ Lifecycle Healing & Slicing ]
  • Monaco Code Editor isolated        • Ctrl + R reload lifecycle & placeholder protection
  • INPUT / TEXTAREA typing immune     • React split TextNode dynamic auto-stitching
  • Password-manager shield            • Leading regex repair for hybrid Chinese/English
```

Detailed architectural designs, benchmarks (1.68M qps), and engineering practices are available in [docs/](docs/):

| Document | Language | Core Technical Highlights |
| :--- | :--- | :--- |
| [architecture.md](docs/architecture.md) | 中文 | 基础算力层重构 ($O(1)$ Map 哈希与 ASCII 短路)、DOM 调度层优化 (联合流式正则与祖先剪枝)、`Ctrl+R` 重载生命周期自愈与 React 切片拼合、50,000 次压测基准数据、Shadow DOM 输入免疫与控制中心防篡改装甲 |
| [architecture.en.md](docs/architecture.en.md) | English | Deep engineering breakdown: $O(1)$ precompiled Map lookups, ASCII short-circuit, unified regex stream scanning, DOM ancestor pruning, queueMicrotask frame aggregation, 1.68M qps benchmark, lifecycle healing & input physical immunity |

### Release Packaging (building default.zip)

**On Windows you can simply double-click `打包发布.bat`**: it verifies the Node runtime, confirms a built `app.asar.ready` exists in the project root, then invokes the packer. That bat is deliberately pure ASCII with all Chinese messages printed by Node — under `chcp 65001`, cmd.exe drops bytes when parsing lines with multi-byte characters, truncating `echo` output, and the failing line shifts as the script grows, so it cannot be worked around by adjusting punctuation.

Command-line usage: `app.asar.ready` is a build artifact excluded by the `app.asar*` rule in `.gitignore`, so no source archive ever contains it. Before publishing, make sure a freshly built `app.asar.ready` sits in the project root, then run:

```bash
# Read the version embedded in the ready bundle and write release-assets/default.zip
node build-release-zip.js

# Enforce an expected version; mismatches fail the build instead of shipping a wrong package
node build-release-zip.js --version 2.26.0

# Skip the pre-seeded download cache ("Downloaded Versions" will be empty)
node build-release-zip.js --version 2.26.0 --no-cache

# Custom output path
node build-release-zip.js --out /tmp/default.zip
```

**Pre-seeded download cache**: by default the archive contains `downloads/release-<tag>-<sha256>/` with `app.asar.ready` and a `download.json` manifest. After extraction, the dashboard's "已下载版本" list already shows this version, so users install offline without clicking "Download Only" first. The cache directory name must match `release-manager.js` exactly or `listFiles()` discards it as unrelated — the packer therefore reuses the exported `makeCacheId` instead of reimplementing the rule. The releaseId segment is a fixed placeholder: the dashboard only consumes `cacheId` and `tag` when installing, and releaseId is used solely for directory naming, so packaging needs no network access at all.

The packer has zero third-party dependencies (it writes the ZIP itself with the built-in `zlib`) and re-parses the resulting central directory as a self-check. Any failed check aborts the build, so a half-finished archive is never produced:

- Entry count matches the manifest, and `app.asar.ready` is present with matching byte length;
- Filenames carry the UTF-8 flag, so `一键更新汉化.bat` and `运行汉化.sh` survive extraction intact on Windows, Linux, and macOS;
- All entry paths use forward slashes and are never absolute, preventing mangled names or out-of-tree writes on Linux/macOS;
- `.sh` files get mode `0755`, regular files `0644`, and directories `0755`, so `./运行汉化.sh` runs right after extraction without an extra `chmod +x`.

---

## Changelog

For detailed release notes, new feature adaptations, and architectural evolution history across all versions, please refer to the dedicated [CHANGELOG.en.md](CHANGELOG.en.md) (or [Chinese CHANGELOG.md](CHANGELOG.md)):

- **[v2.15.1](CHANGELOG.en.md#v2151-2026-09-21)** (2026-09-21): Comprehensive adaptation to Antigravity v2.15.1 architecture; left sidebar Pinned Conversations & group headers localization; 100% TDD test suite (305 tests) and 37 dist JS AST static syntax check gates passed.
- **[v2.15.0](CHANGELOG.en.md#v2150-2026-09-19)** (2026-09-19): Comprehensive adaptation to Antigravity v2.15.0 architecture; custom agent default prompt & tools controls localization; project picker unbound state & invalid tool call prompt optimizations; 100% TDD test suite (239 tests) and 37 dist JS AST static syntax check gates passed.
- **[v2.14.0](CHANGELOG.en.md#v2140-2026-09-16)** (2026-09-16): Comprehensive adaptation to Antigravity v2.14.0 architecture; version metadata and dependencies seamless upgrade; 100% TDD test suite and 37 dist JS AST static syntax check gates passed.
- **[v2.13.0](CHANGELOG.en.md#v2130-2026-09-13)** (2026-09-13): Comprehensive adaptation to Antigravity v2.13.0 architecture; in-depth localization for Side Question & Questionnaire system; full-flow localization for Source Control Git Amend; General Settings Advanced area reorganization; Artifact and table width customization; Windows UAC elevation flow; natural language plugin builder; Split, Fork, and Conversation Group cascade menus full localization and native menu parsing hardening.
- **[v2.12.2](CHANGELOG.en.md#v2122-2026-09-08)** (2026-09-08): Comprehensive v2.12.2 adaptation; Slash Commands & floating cards full localization; Context Mention (@ Mention) menu localization and parameter protection; General Settings in-depth completion; native application menu & sidebar history hover cards dynamic timestamps and multi-state indicators.
- **[v2.12.0.1](CHANGELOG.en.md#v21201-2026-09-04)** (2026-09-04): Thinking Process physical containment against token mistranslation; dynamic regex escaping distortion corrections; dashboard light/dark theme toggle, online release check, and one-click cache cleaning.

> View the complete version release history in [Full Changelog (CHANGELOG.en.md)](CHANGELOG.en.md).

---

## Frequently Asked Questions (FAQ)

### Q1: App fails to start or reports file access error after localization?
Ensure Antigravity is fully closed before running the script. Antigravity's Go backend (`language_server.exe`) may hold file locks in the background.  
Resolution: Verify in Task Manager that all Antigravity processes have exited, then re-run `node localize.js --now`.

### Q2: What if an official update overwrites the localization?
Official updates replace `app.asar`. Simply re-run:
```bash
node localize.js --now
```
The script will back up the new official file and inject the latest patch, or simply replace `app.asar` with the latest Release asset.

### Q3: How to cleanly uninstall and restore official English?
Click "还原英文原版" in the dashboard, or run:
```bash
node localize.js --restore
```
The script will restore the original file from `app.asar.bak`.

---

## Contributors & Open Source Collaboration

| Contributor | Role & Contributions |
| :--- | :--- |
| [liominsb](https://github.com/liominsb) | Original project creator, built the initial Electron asar injection and Web dashboard architecture |
| [LAN-TINA-WS](https://github.com/LAN-TINA-WS) | v2.12.0+ deep refactoring, computational & DOM scheduling performance leap (1.68M/s), 4.53MB slimming fix, hot-upgrade engine, lifecycle & slice auto-stitching, comprehensive Settings/Plugins dictionary expansion, and standalone maintenance |
| [Justin-Mai](https://github.com/Justin-Mai) | 2.0 Web dashboard architecture upgrade, multi-user/custom path support, heartbeat self-healing, code preview & diff isolation mechanisms |
| [songxitao](https://github.com/songxitao) | v2.10.0+ deep adaptation, 3-layer DOM physical isolation defense (eliminating Project directory mistranslation), Markdown & code area anti-pollution, and full TDD automated test suite construction |

- **Contributions**: Pull Requests and Issues reporting untranslated strings are welcome.

---

## License

This project is licensed under the [MIT License](LICENSE).
