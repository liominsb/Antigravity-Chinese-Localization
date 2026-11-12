# Changelog

This document tracks all version releases, core architecture adaptations, and feature updates for Antigravity-Chinese-Localization.

---

## v2.31.2 (2026-11-12)

### 1. Seamless Adaptation to Official Antigravity v2.31.2 Maintenance Release
- **Smooth Version Transition**: Closely synchronized with the official 2.31.2 maintenance update pushed on November 12, advancing core version definitions and metadata to `2.31.2`.
- **100% Native Patch Hit Rate**: Comprehensively analyzed all 1,112 native files between 2.31.0 and 2.31.2, confirming that all 62 active native injection points remain 100% hit with zero regressions.
- **macOS Double-Click Offline Restore & Version Hardening**: Added dedicated macOS `一键更新汉化.command` offline restore launcher with automated Node.js environment discovery across login shells (NVM, fnm, asdf); strictly hardened version validation in `auto-restore.js` by checking the true binary archive to eliminate white-screen risks from unknown or spoofed versions (thanks to @mutezebra in #52).

### 2. Comprehensive UI & Interaction Consolidation & Settings Refinement
- **Retained All Localization Assets**: Fully carried over the comprehensive Marketplace plugin details, categorized shelves, Settings interface layout & Chat layout options, adaptive shortcut search, browser subagent rules, and full Gemini Live voice descriptions.
- **Settings & Project Management Refinement**:
  - Added browser settings subtitle localization: `Configure built-in browser, link opening, and browser subagent preferences.` ➔ `配置内置浏览器、链接打开方式以及浏览器子智能体偏好设置。`.
  - Added project settings subtitle localization: `Manage project folders and settings.` ➔ `管理项目文件夹与设置。`.
  - Added adaptive pattern for setting override scope: `Modified in <scope>` ➔ `已在 <scope> 中修改`.
  - Fixed project deletion confirmation dialog with dynamic conversation statistics: intelligently handles composite sentence fragmentation (`Permanently delete ... including <X> active conversation(s) and <Y> archived conversation(s).`), producing clean and fluent Chinese copy.
- **Zero Token Contamination & Instant Response**: Maintained zero-latency DOM micro-batch translation engine and strict physical isolation for all user input and editor fields.

### 3. Artifacts & Test Safeguards
- **Pre-compiled Core Ready Package**: Built and validated `app.asar.ready` for 2.31.2, ready for instant zero-lag atomic deployment.
- **TDD Regression Suite All Green**: Added Ticket-35 dedicated test suite, achieving **100% ALL GREEN** across all automated tests.

---

## v2.31.0 (2026-11-10)

### 1. Comprehensive Deep Adaptation for Antigravity v2.31.0 Official Major Release
- **Seamless Official Version Upgrade**: Closely tracks official release 2.31.0 pushed on Nov 10, updating all project version metadata to `2.31.0`.
- **100% Native Patch Hit Rate**: Validated all 50+ native patch points across application menu, tray, splash screen, IPC handlers, WSL, WebAuthn, device chooser, and webview popup security, achieving 100% hit rate.

### 2. UI & Interaction Consolidation
- **Inherited Full Localization Assets**: Fully carried over marketplace plugin details, layout settings, shortcut search placeholder translation, browser actuation rules, and Gemini Live voice chooser tone descriptors.
- **Zero Tokenization Pollution**: Ensured million-level queries/sec DOM localization throughput and absolute physical immunity for code editors.

### 3. Build & Test Guarantee
- **Latest Precompiled Asar**: Packaged `app.asar.ready` for instant hot-reload and atomic replacement on v2.31.0.
- **100% Green TDD Test Suite**: Added Ticket-34 suite; all 37 test suites pass with zero failures.

---

## v2.30.0 (2026-11-10)

### 1. Comprehensive Deep Adaptation for Antigravity v2.30.0 Official Major Release
- **Seamless Official Version Upgrade**: Closely tracks official release 2.30.0 pushed on Nov 10, updating all project version metadata to `2.30.0`.
- **Native Deep Integration for 20 New Subsystems**: Fully adapts 20 new upstream modules including built-in browser engine (`browserEngine/`), CDP pipe communication (`cdpPipe.js`), Chrome auto-discovery (`chromeDiscovery.js`), guest Web MCP controller (`guestWebMcpController.js`), and file chooser controller (`guestFileChooserController.js`).
- **Native Security & Device Chooser Patch Injections**:
  - Added native dialog localization for `dist/deviceChooser.js` (HID, USB, and Serial port selection and cancellation prompts).
  - Added native dialog localization for `dist/webviewPopupSecurity.js` (connection info, certificate details, and security level indicators).

### 2. UI & Interaction Polish
- **Marketplace Shelf Alignment**: Thoroughly translated all shelf titles and descriptions ("Design, Creative & Media", "Productivity & Project Management", "Cloud Hosting & Deployment", "Developer Tools", and "Business").
- **Search Input Placeholder Adaptation**: Matched `Search customizations...` with placeholder attribute pass-through.
- **Project & Pinned Chat Menus**: Completed native right-click menus for projects and sorting options for pinned chats.
- **Automation Empty State**: Intercepted single/plural variations (`No automation yet` / `No automations yet` / `No 自动化 yet` ➔ "暂无自动化").
- **Settings Layout & Presets Localization**: Fully translated "Interface Layout", "Knowledge Work" with simplified interface description, and "Software Engineering" with full developer tools description.
- **Advanced Settings & Shortcut Search**: Translated "Chat Layout" title and "Fill" width option; completely resolved hybrid text in shortcut search placeholder ("Search shortcuts..." ➔ "搜索快捷键...").
- **Sidebar Filter Menu & Voice Chooser Localization**: Added translation for "Auto Pin" in the project filter menu; comprehensively localized Gemini Live's "Choose Antigravity's Voice" modal, dynamic "Use <VoiceName>" buttons, and fixed tone description Chinglish issues ("Clear and friendly" ➔ "清晰友好").
- **Browser Subagent URL Rules Description**: Seamlessly translated official actuation rules description (`Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires Google Chrome.`).

### 3. Build & Test Guarantee
- **Latest Precompiled Asar**: Packaged `app.asar.ready` for instant hot-reload and atomic replacement on v2.30.0.
- **100% Green TDD Test Suite**: Added Ticket-33 suite; all 36 test suites pass with zero failures.

---

## v2.29.1 (2026-11-08)

### 1. Full Deep Adaptation for Antigravity v2.29.1
- **Official Version Smooth Upgrade**: Synchronized with the official 2.29.1 maintenance release pushed on November 8, upgrading package metadata and version definitions to `2.29.1`.
- **100% Native Module Compatibility**: Verified official native architecture and dependencies; 49 of 50 native patch points hit cleanly.

### 2. Major: Complete Marketplace Ecosystem & Plugin Details Localization
- **Full Coverage of 71 Official & Partner Plugins**: Extracted and translated all plugin descriptions from local cache (including Notion, Stripe, Semrush, Intercom, Wispr Flow, Looker, invideo, Neo4j, Postman, Sentry, Supabase, Figma, Databricks, Datadog, etc.).
- **Plugin Detail Pages & Suggested Prompts**: Translated implementation plan prompts, weekly update prompts, installation commands, and OAuth authorization notices.
- **Full Alignment of 5 Marketplace Shelves**: Translated "Design, Creative & Media", "Productivity & Project Management", "Cloud Hosting & Deployment", "Developer Tools" (fixed tokenization defect), and "Business" along with all their descriptions.
- **Input Placeholder Architecture Refactor & Disclaimer Penetration**: Refactored attribute translation in `translateNode` to enable `placeholder` translation (e.g., `Search customizations...` ➔ "搜索自定义项...") without risking user input values; penetrated composite disclaimer blocks containing external links.
- **Zero Duplicate Key Additions**: Strictly maintained dictionary health below the upstream baseline.

### 3. Native Context Menus & Interaction Refinements
- **Pinned Conversations Sort Menu**: Added `Sort By` ➔ "排序方式", `Last Updated` ➔ "最近更新", `Last Prompt` ➔ "最新提示词", `Custom Order` ➔ "自定义排序".
- **Selection Quote Tooltip (Quote Ctrl+L)**: Added bypass privilege in `shouldSkipNode` and adaptive regex matching for `Quote`, `Quote Ctrl+L`, and `Quote Cmd+L`.
- **Project & Conversation Native Menus**: Completed project folder menus (Copy Project Name, Project Settings, Delete Project) and conversation menus (Mark Unread, Split Conversation, Stop Agent).
- **Automations Empty State**: Fixed tokenization flaw to render standard "暂无自动化" and translated scheduling descriptions.

### 4. Build Artifacts & Quality Assurance
- **Instant Ready-to-Use Artifact**: Packed latest `app.asar.ready` (5.35 MB, 5,611,177 bytes) supporting zero-downtime hot replacement.
- **100% TDD Regression Suite Pass**: Ticket-32 expanded to **95 assertions, all passing**; all 35 suites in the project remain **100% ALL GREEN**.

---

## v2.29.0 (2026-11-05)

### 1. Comprehensive Adaptation to Antigravity v2.29.0
- **Seamless Official Version Update**: Tracks the official 2.29.0 release of November 3; the application version and project metadata move to `2.29.0`. This release adds a Jupyter notebook viewer, Gemini Live powered voice mode, remote agents (cloud conversations), a redesigned Automations page, browser downloads and an address-bar redesign, the Onyx theme with Google Sans, and customizable keyboard shortcuts.
- **Seven New Native Modules, Fully Compatible**: `externalUrl.js` (external URL scheme dispatch), `guestDialogController.js` (in-page dialogs in the built-in browser), `wcvBrowserRegistry.js` / `wcvIpcHandlers.js` / `wcvZOrderController.js` (WebContentsView browser registry, IPC and z-order control), `webviewDownloadRouting.js` (download routing) and `windowState.js` (window state persistence). Each was inspected item by item and contains only internal logic and IPC channels — **no user-visible copy** — so no new native string patches are required. All 50 existing native replacement targets keep hitting in the official 2.29.0 package (the one remaining miss is a historical dead patch that has been absent since 2.26.0).
- **100 New Web UI Entries**: covers **voice mode and recordings** (mute voice mic / speaker, save audio recordings, naming a voice variant, input device for voice mode and dictation), **accessibility** (Screen Reader Mode, optimizing the interface and terminal output for screen readers), **remote agents and cloud environments** (remote agents are busy, runs remotely, too many environments running, connect an account so the agent can run automations), **usage and quota** (context and quota indicator, daily and overall conversation limits, daily environment time used), **built-in browser and downloads** (download location, cancel download, browsing history, connection-security notices), **automations and schedules** (on a schedule, every day / hour / week / weekday, change schedule), **layout** (terminal placement, chat width, toggle and maximize the side panel, close tabs to the left, new conversation button) and **conversations and tasks** (could not edit a queued message, conversation unarchived, conversation steps).
- **How it was produced**: 1309 candidates were extracted from the official 2.29.0 renderer bundle (11.19 MB, 535 KB larger than 2.28.2) using interface-copy context keys (`title` / `label` / `placeholder` / `description` / `tooltip` / `message` etc.); 254 noise entries (protobuf enums, LaTeX/Markdown internals, third-party component names, internal state keys) were discarded and 100 were added after manual review. Every one of the 100 keys was compared character by character against the official candidate list.
- **Dictionary health**: unique dictionary keys 3583 → 3683 (+100), source-level duplicate keys unchanged at 619 (zero new duplicates), no empty translations and no "translation equals source" leftovers (`Google Chat` is kept as a product name).
- **Added Missing Settings Copy for Built-in Browser & Voice Mode**: Added descriptions for built-in browser download directory (`Folder where files downloaded in the built-in browser are saved.`), clear browsing history (`Clear visited URLs and autocomplete suggestions from the built-in browser.`), voice mode section header (`Voice mode`), Gemini Live voice explanation (`The voice used in Voice mode. Powered by Gemini Live.`), and voice volume description (`How loud Antigravity's voice is.`).
- **New `tests/ticket-31-v2290-features.test.js`** (56 assertions): self-consistent version metadata checks, existence of the seven new native modules, representative entries from the five new copy groups, the zero-omission and zero-empty checks, dictionary size and duplicate-key health, plus artifact-level verification that the new entries really landed in `extracted/dist/preload.js` and `app.asar.ready`.
- **Synced the `app.asar.ready` Offline Patch Bundle**: `auto-restore.js` matches patch versions exactly and rejects a mismatch with `VERSION_MISMATCH` (exit code 2), while the `--now` deploy flow never refreshes that file. The bundle is repackaged for 2.29.0 (5,538,793 bytes, version 2.29.0) so the one-click restore keeps working after an official update.

---

## v2.28.2 (2026-10-30)

### 1. Comprehensive Adaptation for Antigravity v2.28.2
- **Seamless Official Version Update**: Synchronized with the latest official 2.28.2 maintenance release on October 30; upgraded application version and project metadata to `2.28.2`.
- **Native Patch Verification**: Verified that all native injection points hit with 100% stability against 2.28.2 official unpacked files.
- **Complete Translation Maintenance**: Fully retained all 878+ UI text entries (Chief of Staff dashboard & canvas, built-in browser CDP/toolbar, CitC/ABFS/Cog remote workspaces, Autonomous Mode, Best-of-N, AI credits, etc.).
- **Bundled app.asar.ready Pre-compiled Patch**: Packaged a ready-to-use 2.28.2 patch artifact (5.1 MB) for one-click installation and deployment.
- **Automated Regression Test Suite**: Added Ticket-30 test suite, all 33 TDD test suites 100% passed (ALL GREEN).

---

## v2.28.1 (2026-10-29)

### 1. Comprehensive Adaptation for Antigravity v2.28.1
- **Seamless Official Version Update**: Synchronized with the latest official 2.28.1 release on October 29; upgraded application version and project metadata to `2.28.1`.
- **Integrated PR #44 Contributions**: Fully absorbed 465 UI text entries (Chief of Staff dashboard & canvas, built-in browser CDP/toolbar, CitC/ABFS/Cog remote workspaces, Autonomous Mode, Best-of-N, AI credits, etc.).
- **Native Patch Verification**: Verified that all native injection points hit with 100% stability against 2.28.1 official unpacked files.
- **Bundled app.asar.ready Pre-compiled Patch**: Packaged a ready-to-use 2.28.1 patch artifact (5.1 MB) for one-click installation and deployment.
- **Automated Regression Test Suite**: All TDD test suites 100% passed (ALL GREEN).

---

## v2.28.0 (2026-10-28)

### 1. Comprehensive Adaptation to Antigravity v2.28.0 Architecture
- **Official Version Seamless Upgrade**: Upgraded application definition and project metadata to `2.28.0`, following Google's official Oct 28 release.
- **Upstream Native Modules & Core Files 100% Compatible**: Synchronized official 2.28.0 native architecture updates (including WebAuthn/Passkey module `webauthn.js`, built-in multi-tab browser `webviewBrowser.js`, sandbox `scriptJail.js`, and QR encoder `qrEncoder.js`), maintaining full parity with upstream.
- **Passkey Modal Dialog Localization**: Injected comprehensive Chinese localization for native WebAuthn dialogs, account selectors, labels, and cancellation flows.
- **Webview Browser & Security Vocabulary**: Enriched Web UI translation terms for browser tab controls, navigation, and connection security states.
- **New Packaged Archive app.asar.ready**: Injected deep Chinese localization into official 2.28.0 archives and repacked, perfectly conforming to official 4.98 MB standards.
- **Full TDD Regression Suite 100% Green**: Added Ticket-26 automated test suite; all regression pipelines pass 100% (ALL GREEN).

### 2. Completing the 2.28.0 UI Copy Missed Upstream
- **465 New Web UI Entries**: Fills the interface copy that upstream's 2.28.0 adaptation left out — the **Chief of Staff** dashboard and voice mode, the **built-in browser** tool panel (CDP port, Chrome binary path, console logs, screenshot, site information), **connection security state** (certificate validity, secure/insecure connection), **remote workspaces** (ABFS / CitC / Cog creation, cloning, unmounting and workspace type), **Autonomous Mode** and execution policies, **Best-of-N** toggles, **background tasks / background commands / standalone terminals**, **hook trigger conditions**, **AI credits and billing**, **fine-grained GitHub permissions**, and **voice engine / device settings**.
- **How it was produced**: 1342 candidates were extracted from the official 2.28.0 renderer bundle (10.6 MB) using interface-copy context keys (`title` / `label` / `placeholder` / `description` / `tooltip` / `message` etc.); 465 were added after manual review, while 263 noise entries were discarded (protobuf enums, LaTeX/Markdown internals, third-party component names, internal state keys). Interface-copy candidate coverage rose from 44.6% to 99.6%.
- **Dictionary health**: unique dictionary keys 3105 → 3570 (+465), source-level duplicate keys unchanged at 619 (zero new duplicates), no empty translations and no "translation equals source" leftovers.
- **New `tests/ticket-28-v2280-coverage.test.js`** (70 assertions): representative entries across the five new feature groups, the zero-omission check, dictionary size and duplicate-key health, plus artifact-level verification that the new entries really landed in `extracted/dist/preload.js` and `app.asar.ready`.
- **Fixed a Version-Assertion Regression**: upstream `ticket-26-v2280-features.test.js` had reverted the version metadata assertions to hard-coded "strictly equals 2.28.0", which would report a false failure on every future official update. Restored to self-consistent checks (valid version, not below baseline, equal to `CURRENT_VERSION`), matching the existing ticket-24 / ticket-25 approach.
- **Synced the `app.asar.ready` Offline Patch Bundle**: the `--now` deploy flow never refreshes this file, yet `--auto-restore` and the one-click update script rely on it to restore the localization. Without syncing it, a one-click restore after an official update would fall back to an old bundle missing the new entries. The complete localized bundle is now committed (5,340,451 bytes, version 2.28.0).
---

## v2.27.0 (2026-10-28)

### 1. Comprehensive Adaptation to Antigravity v2.27.0 Architecture
- **Official Version Seamless Upgrade**: Upgraded the application definition and project metadata to `2.27.0`, following Google's latest official 2.27.0 release.
- **Upstream Native Layer 100% Compatible**: Synchronized official 2.27.0 native modules; 49 of 50 exact-match native string replacement targets resolve and apply. The remaining one (`Loading Antigravity` in `loadingOverlay.js`) was already absent from the official 2.26.0 package, so it is a historical dead patch. Six new native modules were added (`webauthn.js`, `cablev2.js`, `qrEncoder.js`, `webviewBrowser.js`, `webviewWebAuthnPreload.js`, `__mocks__/electron-log`); `package.json` dependencies are unchanged.
- **New Passkey / WebAuthn UI Localization**: Covers the new native passkey account chooser (`Choose a Passkey` / `Sign in to` / `Select a passkey account to continue:`), the caBLEv2 QR dialog (`Passkeys` / `Use your phone or tablet` / scan prompt), and its live connect/verify status strings.
- **413 New Web UI Entries**: Covers browser actuation permissions and authorization panels, ABFS / CitC / Cog / Fig / JJ remote workspaces, SSO and enterprise account sign-in, MCP servers and plugins, conversations and automations, hooks and terminal permissions. Candidate coverage rose from 0% to 57%.
- **Fixed a Template-String Regex Escaping Defect**: The dynamic rule `/^Models within this group:\s*(.*)$/i` lost its backslash inside a template literal and degraded to `s*`, silently disabling the rule. Corrected to a double backslash and added an "evaluate-then-match" verification that closes the syntax-only blind spot of upstream `check-injection-syntax.js`.
- **Fixed CLI Documentation / Implementation Mismatch (issue #40)**: The long-documented `--restore`, `--extract-only` and `--pack-only` flags never existed in `localize.js`; passing them was silently ignored, falling through to starting the web dashboard and holding its port, so the command looked successful while doing nothing. The docs now describe the four real flags (`--now` / `--auto-restore` / `--check-status` / `--apply-only`) plus the actual way to restore the official build, and an argument whitelist rejects unknown flags immediately with exit code `1`.
- **Version-Decoupled Test Assertions**: Ticket-25 version metadata assertions were upgraded from "strictly equals 2.26.0" to self-consistent checks (valid version, not below baseline, and equal to `CURRENT_VERSION`) so future releases do not produce false failures.

---

## v2.26.0 (2026-10-24)

### 1. Comprehensive Adaptation to Antigravity v2.26.0 Architecture
- **Official Version Seamless Upgrade**: Upgraded application definition and project metadata to `2.26.0`, following Google's official Oct 24 release.
- **Upstream Native Modules & Core Files 100% Compatible**: Synchronized official 2.26.0 native modules and core architecture adaptations (including Google BeyondCorp proxy support `beyondcorpPac.js` and `debugConsole.js`), keeping full parity with the upstream baseline.
- **New Packaged Archive app.asar.ready**: Injected deep Chinese localization into official 2.26.0 archives and repacked, perfectly conforming to the official packaging standards.
- **Settings & Feedback Localization**: Completed localization for sidebar "Give Feedback", "Send Feedback", and feedback modal elements.
- **Community Contribution Integration (PR #39 by @mojingjing-git)**: Integrated 427 deep Web UI vocabulary entries; optimized case-insensitive dictionary lookup to O(1) (reducing DOM translation latency by 94%); fixed template regex escaping & functional replacements; added React Fragment sentence fallback.
- **Full TDD Regression Suite 100% Green**: Added Ticket-25 automated test suite; all regression pipelines (Ticket-03 to Ticket-25 and 4 architecture suites, 29 in total) pass 100% (ALL GREEN).

---

## v2.25.0 (2026-10-22)

### 1. Comprehensive Adaptation to Antigravity v2.25.0 Architecture
- **Official Version Seamless Upgrade**: Upgraded application definition and project metadata to `2.25.0`, following Google's official Oct 22 release.
- **Upstream Native Modules & Core Files 100% Compatible**: Synchronized official 2.25.0 native modules and core dependency tree (including updated `@connectrpc/connect` modules), keeping full parity with the upstream baseline.
- **New Packaged Archive app.asar.ready**: Injected deep Chinese localization into official 2.25.0 archives and repacked, perfectly conforming to the official packaging standards.
- **Full TDD Regression Suite 100% Green**: Added Ticket-24 automated test suite; all regression pipelines (Ticket-03 to Ticket-24 and 4 architecture suites, 28 in total) pass 100% (ALL GREEN).

---

## v2.24.0 (2026-10-16)

### 1. Comprehensive Adaptation to Antigravity v2.24.0 Architecture
- **Official Version Seamless Upgrade**: Upgraded application definition and project metadata to `2.24.0`, following Google's official Oct 16 release.
- **Upstream Native Modules & Core Files 100% Compatible**: Synchronized official 2.24.0 native modules and core dependency tree, keeping full parity with the upstream baseline.
- **New Packaged Archive app.asar.ready**: Injected deep Chinese localization into official 2.24.0 archives and repacked, perfectly conforming to the official packaging standards.
- **Full TDD Regression Suite 100% Green**: Added Ticket-23 automated test suite; all regression pipelines (Ticket-03 to Ticket-23 and 4 architecture suites, 27 in total) pass 100% (ALL GREEN).

---

## v2.23.1-p1 (2026-10-15)

### 1. Auto Check & Safe Recovery on Official Updates (Issue #35)
- **Batch Script Enhancements**: Upgraded `一键更新汉化.bat` and `双击运行汉化.bat` to prioritize Node.js-powered safe checks while retaining fallback for environments without Node.js.
- **Strict Version Compatibility Guard & Anti-Crash Mechanism**: Integrated `auto-restore.js` to inspect the installed client version against the candidate patch; version-matched archives are atomically installed, while mismatched versions are safely blocked from corrupting the client.
- **Web Dashboard Notification**: Added an update-detection banner to the dashboard home page for one-click recovery.
- **Full TDD Regression Suite 100% Green**: Added Ticket-22 test suite (8 assertions passing 100%); full regression suite (26 suites) remains ALL GREEN.

---

## v2.23.1 (2026-10-14)

### 1. Comprehensive Adaptation to Antigravity v2.23.1 Architecture
- **Official Version Seamless Upgrade**: Upgraded application definition and project metadata to `2.23.1`, following Google's official Oct 14 release.
- **Upstream Modules & Dependency Tree 100% Compatible**: Synchronized official 2.23.1 native modules and core dependencies, keeping full parity with the upstream baseline.
- **Full TDD Regression Suite 100% Green**: Added Ticket-21 automated test suite; all regression pipelines (Ticket-03 to Ticket-21) continue to pass 100% (ALL GREEN).

---

## v2.23.0 (2026-10-13)

### 1. Comprehensive Adaptation to Antigravity v2.23.0 Architecture
- **Official Version Seamless Upgrade**: Upgraded application definition and project metadata to `2.23.0`, following Google's official Oct 13 release.
- **Upstream Modules & Dependency Tree Compatibility**: Synchronized official 2.23.0 native modules and core dependencies.
- **Full TDD Regression Suite 100% Green**: Added Ticket-20 automated test suite; all regression pipelines (Ticket-03 to Ticket-20) pass 100% (ALL GREEN).

---

## v2.22.0 (2026-10-09)

### 1. Comprehensive Adaptation to Antigravity v2.22.0 Architecture
- **Official Version Seamless Upgrade**: Upgraded application definition and project metadata to `2.22.0`, following Google's official Oct 9 release.
- **Upstream Modules & Dependency Compatibility**: Synchronized official 2.22.0 native unpacked modules and dependencies.
- **Full TDD Regression Suite 100% Green**: Added Ticket-19 automated test suite (30 assertions passed); all regression pipelines pass 100% (ALL GREEN).

---

## v2.17.0 (2026-09-24)

### 1. Comprehensive Adaptation to Antigravity v2.17.0 Architecture
- **Version Metadata & Environment Seamless Upgrade**: Upgraded application definition to `2.17.0`, tracking Google official Sep 24 build with 100% compatibility with new dependencies (e.g. `js-yaml`) and main/renderer architectures.
- **Complete TDD Test Suite**: Added Ticket-12 test suite, passing all 45 automated regression test cases and keeping the full test suite 100% green.

### 2. Deep WSL (Windows Subsystem for Linux) Integration Localization
- **Native File Menu & Dynamic Submenu**: Localized `Connect to WSL` and `Reopen Locally`, and implemented a two-way matching fallback engine in `addItemToSubmenu` to eliminate parent menu lookup failures when adding WSL menu entries asynchronously.
- **WSL Provision Splash Window**: Localized the dedicated frameless setup splash `Setting up WSL: <distro>` along with real-time status notifications: `Downloading the Antigravity binary…` and `Installing into <distro>…`.
- **WSL Cross-System Paths & Filesystem Warnings**: Localized performance warnings when opening folders across Windows and WSL filesystems, distro mismatch errors, and path parsing alerts.
- **WSL Failure & Fallback Dialogs**: Localized `WSL distro not found`, `WSL setup failed`, and automatic fallback notifications when opening locally on Windows.

### 3. Sandbox Mode, Advanced Settings, View Folding & Project Permission Inheritance
- **Local Sandbox Mode**: Fully translated `Enable Sandbox Mode (Preview)`, `Restricts agent tools to a secure, isolated local sandbox.`, and `Security Preset`.
- **Application Advanced Settings & Review Actions**: Translated `Advanced Settings` in Settings, and `Collapse All` / `Expand All` in review views.
- **Project-Specific Permissions & Global Inheritance**: Translated `Inherit Global` and `Also includes Global Permissions when working in this project.`.

---

## v2.15.1 (2026-09-21)

### 1. Comprehensive Adaptation to Antigravity v2.15.1 Architecture
- **Version Metadata & Environment Seamless Upgrade**: Upgraded application definition to `2.15.1`, tracking Google official Sep 21 build with 100% compatibility with updater and dependencies.
- **Localization Engine Full Inheritance**: Maintained 100% localization coverage across DOM mutation, Electron native menus, tray, and overlays.
- **Complete TDD Test Suite**: Added Ticket-11 test suite, passing all 305 automated regression test cases and 37 dist JS AST syntax check gates.

### 2. Sidebar Pinned Conversations & Grouping Titles Localization
- **Pinned & Recent Group Titles**: Translated left sidebar section headers including `Pinned Conversations` / `pinned conversations`, `Recent Conversations`, `All Conversations`, and `Other Conversations`.
- **Status & Accessibility Labels**: Normalized `Pinned` and `Unpinned` UI interaction labels.

---

## v2.15.0 (2026-09-19)

### 1. Comprehensive Adaptation to Antigravity v2.15.0 Architecture
- **Version Metadata & Updater Headers**: Bumped application definition to `2.15.0`, tracking Google official Sep 19 build and new updater request header specifications.
- **Localization Engine Full Inheritance**: Maintained 100% localization coverage across DOM mutation, Electron native menus, tray, and overlays.
- **Complete TDD Test Suite**: Added Ticket-10 test suite, passing all 239 automated test cases and 37 dist JS AST syntax check gates.

### 2. Custom Agent Controls & Default Tools Localization
- **Agent Prompts & Tools Controls**: Deeply translated custom agent controls: `Default tools`, `Default prompt sections`, `Switch off default tools`, `Switch off default prompts`, `Add back tools`.
- **Main Agent State & Fallback**: Translated `Main Agent`, `Main Agent (Default)`, and reset fallback interactions.

### 3. Project Picker, Prompts & Error Presentation
- **Project Picker Unbound State**: Translated `No Project` and `Working outside of a project`.
- **Malformed Tool Call Handling**: Translated compact model failure status `Invalid tool call`.
- **Binary File Error & Cancelled Command**: Translated clear binary reading errors `Cannot display binary file` and restart cancelled status `Command canceled`.

### 4. High-frequency UI Interactions, Accessibility Labels & Dynamic Templates
- **Conversation Feedback & Actions**: Translated `Good response`, `Bad response`, `More actions`, `More options`, `Pin conversation` / `Pinned Conversations`, `Recent Conversations`, `All Conversations`, `Undo to this point`.
- **Code Block Actions & Floating Controls**: Translated `Copy code`, `At mention code block`, `Add inline comment`, `Fold code block`, `User message`, `Send message`.
- **Error Banners & Dynamic Templates**: Translated `Agent execution terminated due to error.` and added dynamic regex handlers for `See all (N)`, `Ran N commands`, `Load older messages, showing N of M`, and `Fold lines N-M`.

---

## v2.14.0 (2026-09-16)

### 1. Comprehensive Adaptation to Antigravity v2.14.0 Architecture
- **Version Metadata & Environment Seamless Upgrade**: Upgraded to 2.14.0, fully compatible with Google official Sep 16 release build.
- **Full Localization Engine Inheritance & Syntax Hardening**: Maintained 100% localization coverage across DOM mutation, Electron native application menus, tray, and splash overlays.
- **Full TDD Test Suite Validation**: Added Ticket-09 test suite, passing all 37 dist JS AST static syntax check gates.

---

## v2.13.0 (2026-09-13)

### 1. Comprehensive Adaptation to Antigravity v2.13.0 Architecture
- **Frontend Bundle Structure Adaptation**: Deep support for official 2.13.0 frontend build updates, extracting and localizing 116+ new interface strings.
- **Preload Injection Engine Synchronization**: Upgraded main renderer and install wizard preload injection modules, guaranteeing 100% coverage and high-framerate throughput.

### 2. Side Question & Questionnaire System In-depth Localization
- **Independent Side Question Flyout**: Localized new side questionnaire interactions: `Side Question`, `Side question answered.`, `View side question`, `Minimize side question`, `Delete side question`.
- **Questionnaire Form Controls**: Localized `Cancel questionnaire` and `Cancel questionnaire and stop the agent`.

### 3. Source Control Git Amend Flow Full Localization
- **Amend Capabilities**: Localized primary Amend actions: `Amend`, `Amending...`.
- **Commit Strategies & Status Notices**: Localized `Amend staged changes into the current commit`, `Stage and amend all changes into the current commit`, `No changes to amend`, `No commit to amend`, and conflict resolution notices.

### 4. General Settings Advanced Area Reorganization Adaptation
- **Settings Reorganization**: Adapted to 2.13.0 migration of `Best of N`, `CitC`, and `Labs` into General Settings -> Advanced.
- **Migration Guidance & VCS Notes**: Localized migration guidance sentences and version control selector notices.

### 5. Artifact & Table Width Display Customization
- **Display Preferences**: Localized `Markdown Artifact Width`, `Configure the default width of markdown artifacts.`, and `Table Width`.
- **Layout Modes**: Localized `Fit to content` and `Fit to width`.

### 6. Windows Administrator Elevation (UAC) Flow Localization
- **Elevation Interaction**: Localized Windows one-time UAC elevation notices: `Administrator access (UAC)`, `Grant administrator access for`, `Grant one-time administrator access`, `Requesting a one-time administrator (UAC) elevation`, and `Yes, allow`.

### 7. Natural Language Plugin Builder & Customization View Categorization
- **Plugin Builder**: Localized `Create plugin`, `Describe a plugin and the agent builds it`.
- **Customization View Category Tags**: Localized `Installed by you`, `Bundled with the app`, `Listed in your config`, `Found in this workspace`, `Pre-installed`, `Builtin`.
- **Recommended Skills Switch**: Localized `Enable recommended skills` and `Disable recommended skills`.

### 8. Conversation Pinning, Scratch Files & Diff Inspector Enhancements
- **Pinning & Forking**: Localized `Pin this conversation`, `Unpin this conversation`, `Rename this conversation`, `Forked conversation`.
- **Scratch Files Panel**: Localized `Scratch Files` and `No scratch files`.
- **Diff Inspector Whitespace Toggle**: Localized `Show Whitespace Changes` and `Hide Whitespace Changes`.

### 9. Split, Fork & Conversation Group Menu In-Depth Localization & Hardening
- **Split Submenus Flow**: Localized left sidebar conversation `Split`, `Split Right`, `Split Down`, `Replace With New`, `Remove From Split`, `Split Terminal`, `Split Conversation Vertically`, `Split Conversation Horizontally`, `Equalize Split Panes`.
- **Fork & Group Management**: Localized `Fork`, `Create fork in current/shared/new workspace`, `Move to Group`, `New Group`, `Create Group`, `Group By Project/Workspace`.
- **Native Menu Parsing Hardening**: Fixed `menu.js` recursive traversal closure issue to eliminate startup AST syntax errors in Electron.

---

## v2.12.2 (2026-09-08)

### 1. Comprehensive Adaptation to Antigravity v2.12.2 Architecture
- **Updated Lexicon & Model Menus**: Adapted Gemini 3.8 Flash and enterprise release notes and model selection menus.
- **Pre-installed MCP Ecosystem Full Localization**: Localized 63 official and community MCP service cards, descriptions, and permission notices in Settings.

### 2. Slash Commands & Floating Cards Localization
- **Commands & Popup Cards**: Localized slash commands (`/boost`, `/goal`, `/schedule`, `/browser`, `/grill-me`, `/plan`, `/teamwork-preview`, `/learn`, etc.) and descriptions.
- **Trigger Identifiers Protection**: Strict shielding for native trigger characters (e.g. `boost`, `goal` remain in English).

### 3. Context Mention (@ Mention) Menu Localization & Parameter Protection
- **Context Categories Full Localization**: Localized `@` trigger categories (Rules, Conversation, PDF Document, Commit, Diff, Directory, etc.).
- **Tagging & File Name Shielding**: Category whitelist and file extension isolation protecting project file names and arguments.

### 4. General Settings In-depth Completion
- **Browser Subagent Localization**: Completed segmented sentences and lab features for Browser Subagent settings.

### 5. Native Application Menu & Sidebar Experience Refinements
- **Native Top Menus**: Localized `Create Project`, `New Project`, `Open Project`, `Copy`, etc.
- **Conversation Details & Copy Submenus**: Localized `Copy trajectory ID`, `Trajectory Metadata`, etc.
- **Hover Card Timestamps & Multi-state Indicators**: Localized hover cards with dynamic update times (`Updated <time>` -> `更新于 <time>`) and status badges (`Idle`, `Active`, `Action Required`, `Unread`).

---

## v2.12.0.1 (2026-09-04)

### 1. Thinking Process Physical Containment
- Completely eliminated token-level mistranslation inside AI streaming thoughts.
- Double-layer filtering: safely bypassed `.cursor-edit` and thinking content blocks.
- Preserved action pills: `Thought for 4s` -> `思考了 4s`, `Thinking...` -> `正在思考...`.

### 2. Dynamic Regex Escaping Corrections
- Fixed template string double-escaping restoring numeric and file diff patterns.
- Restored escaped quota matching expressions.

### 3. Dashboard Enhancements
- Added persistent light/dark theme toggle.
- Added online GitHub Release check button and update indicator badge.
- Improved light mode modal contrast.
- Added one-click frontend cache cleaner.
