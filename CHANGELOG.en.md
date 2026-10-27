# Changelog

This document tracks all version releases, core architecture adaptations, and feature updates for Antigravity-Chinese-Localization.

---

## Unreleased

### 1. Fixed: Release Archive Shipped Without the Ready Patch
- **Root cause**: `app.asar.ready` is a build artifact excluded by the `app.asar*` rule in `.gitignore`, so both `git clone` and GitHub's "Download ZIP" never contain it. Historical `default.zip` builds did not include it either, so after extracting, `一键更新汉化.bat` reported "ready patch not found" in the Node-free branch, or exited with a failure code (`NO_PATCH_FOUND`) in the Node branch.
- **New zero-dependency release packer `build-release-zip.js`**: bundles the root-level `app.asar.ready` into `default.zip` under `release-assets/`. Supports `--version` enforcement (fails the build on mismatch instead of shipping a wrong package) and `--out` for a custom destination.
- **Post-build self-check**: re-parses the resulting central directory and verifies entry count, presence of `app.asar.ready`, byte-length agreement, and the UTF-8 filename flag (keeping Chinese script names such as `一键更新汉化.bat` intact after extraction). Any failed check aborts the build, so a half-finished archive is never produced.
- **New TDD suite `tests/release-zip.test.js`**: covers CRC32 reference values, ZIP structure and content round-tripping, UTF-8 filename handling, directory entries, cross-platform paths and permissions, and rejection of incomplete/corrupt archives — 24 assertions, all passing.

### 2. Cross-Platform Hardening of the Release Archive (Windows / Linux / macOS)
- **Fixed missing executable bit on `.sh`**: previous archives were written with a FAT host (`version made by = 0x0014`), leaving `运行汉化.sh` at Unix mode `0o0` — Linux/macOS users hit `Permission denied` when running `./运行汉化.sh`. Entries are now written as Unix host (`0x031E`) with extension-based modes: `.sh` as `0755`, regular files `0644`, directories `0755`, so the script runs immediately without `chmod +x`.
- **New cross-platform self-check gate**: after writing, the build verifies forward-slash paths, non-absolute paths, and the executable bit on `.sh` files; any failure aborts the build. Backslash paths are treated as part of the filename on Linux/macOS (a known `Compress-Archive` defect), and absolute paths carry extraction-escape risk — both are blocked.
- **Measured comparison of path compatibility**: a zip produced by the bundled Windows `tar.exe` (bsdtar) stores Chinese names as raw GBK with neither the UTF-8 flag nor a `0x7075` fallback; `Compress-Archive` (PS 5.1) keeps names correct but uses backslashes in paths. Neither meets the cross-platform requirement, so the batch-only approach was dropped in favour of the Node packer (the release pipeline already requires `npx asar pack`, so Node is an existing prerequisite, not a new dependency).
- **Documentation**: both READMEs now state that `default.zip` bundles `app.asar.ready`, and explain why source archives lack it plus three remedies (use `default.zip`, download the file separately into the project root, or regenerate it with `node localize.js --now`).

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
