# Antigravity Localization Engine: Architecture & Deep Engineering

This document is dedicated to developers and contributors interested in the inner workings of Antigravity-Chinese-Localization. It details the industrial-grade engineering practices implemented across Electron native layers, web containers, DOM mutation scheduling, and low-level computational optimizations.

---

## 1. System Architecture Topology

```text
[ Antigravity Launches ]
        │
        ├─► [ Native: dist/menu.js & updater.js ] ──► Localized menus & auto-updater state
        ├─► [ Native: dist/tray.js & ipcHandlers.js ] ──► Localized system tray & context menus
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

---

## 2. Fundamental Computational Optimization

In dynamic AI workstation workflows, a single UI render may involve thousands of text nodes. Excessive overhead in the localization engine would block the browser main thread and cause visible frame drops.

### 1. Precompiled Map Hash Lookups
- **Legacy Issue**: Previous community versions iterated over the entire dictionary (1,300+ keys) via `for...in` loops on misses, degrading lookup complexity to $O(N)$.
- **Solution**: At startup, all keys are compiled into `lowerDictionary = new Map()`. Lookups execute via `dictionary[core] || lowerDictionary.get(core.toLowerCase())`, reducing lookup time strictly to $O(1)$.

### 2. ASCII Short-Circuit (Fast Path)
- **Principle**: After initial rendering, over 90% of DOM text nodes are already localized Chinese, numbers, or symbols.
- **Optimization**: A microsecond short-circuit check runs at the entrance of `translateString`:
  ```javascript
  if (!/[a-zA-Z]/.test(trimmed)) {
    return text;
  }
  ```
  This immediately skips pure Chinese content with zero computational cost.

### 3. WeakSet Selective Node Caching
- **Memory Guard**: `translatedNodes = new WeakSet()` caches processed text nodes to avoid redundant re-scans when parent elements re-render.
- **Strict Gating**: Only nodes that have been successfully localized (`original !== translated`) or are natively pure Chinese are admitted into the WeakSet. Unfinished skeleton or placeholder nodes are never marked prematurely.

### 4. Stress-Test Benchmarks
In a 50,000-query mixed text stress test:
- **Legacy Iterative Latency**: `1,982.59 ms`
- **Refactored Engine Latency**: **`29.70 ms`** (**98.5%** latency drop)
- **Average Single-Call Latency**: **0.59 microseconds**
- **Throughput**: **1.68 million queries/second**

---

## 3. DOM Micro-Batching & High Frame Rate Scheduling

### 1. Unified Regex Stream Scanning (CORE_WORDS_UNION_REGEX)
- **Regex Loop Problem**: Iterating through 80+ regexes causes excessive string copies and regex executions on every sentence.
- **Unified Compilation**: Core words are sorted by length and unified into a single boundary regex:
  ```javascript
  const escapedKeys = Object.keys(coreWords).sort((a, b) => b.length - a.length);
  const CORE_WORDS_UNION_REGEX = new RegExp('\\b(' + escapedKeys.join('|') + ')\\b', 'gi');
  ```
  Text undergoes a single-pass scan with $O(1)$ dictionary lookup callbacks, accelerating phrase tokenization by **3.1x** (100k queries down from 301 ms to 98 ms).

### 2. DOM Ancestor Pruning
- **Nested Traversal Bloat**: When React mounts nested cards, the outer container and all descendant elements are both pushed into `addedNodes`, triggering $O(N^2)$ recursive traversals.
- **Pruning Algorithm**: Descendant nodes whose parents are already present in the mutation queue are filtered out before traversal:
  ```javascript
  const rootNodes = [];
  for (const node of pendingAddedNodes) {
    let hasAncestor = false;
    let p = node.parentElement;
    while (p) {
      if (pendingAddedNodes.has(p)) { hasAncestor = true; break; }
      p = p.parentElement;
    }
    if (!hasAncestor) rootNodes.push(node);
  }
  ```
  This reduces the number of deep-walked nodes by over 80%.

### 3. queueMicrotask High-Fidelity Scheduling
- **rAF Throttling Trap**: Chromium heavily throttles `requestAnimationFrame` when windows lose focus or during page reloads.
- **Microtask Concurrency**: `queueMicrotask` flushes mutation queues at the end of the current microtask tick. This merges fragmented mutations while guaranteeing zero-delay response.

---

## 4. Lifecycle Healing & React Slicing

### 1. `Ctrl + R` Reload Lifecycle Healing
Pressing `Ctrl + R` destroys and recreates the rendering pipeline. The engine handles this cleanly through three safeguards:
1. **Skeleton Pass**: Placeholder nodes are not cached in `WeakSet`;
2. **Mutation Invalidation**: `characterData` mutations trigger `translatedNodes.delete(mutation.target)` to allow React re-renders to be translated;
3. **Progressive Backstop**: Incremental safe scans trigger at `[50, 150, 400, 1000, 2500]` ms intervals to capture late-arriving async data.

### 2. React Split-Node Auto-Stitching
React JSX splits phrases into separate sibling TextNodes (e.g. `% of customization budget`, or sentences wrapped around stylized spans).  
The engine implements slice-level leading interceptors that match and format both halves seamlessly:
- Sliced Prefix: `Plugins are packaged collections of skills and MCPs to help the Agent in` ➔ translated to `插件是技能和 MCP 的打包集合，用于协助智能体在`
- Sliced Suffix: `Antigravity work with Google developer products...` ➔ translated to `Antigravity 中协同 Google 开发者产品工作。你可以随时在设置中更改你的选择。`

---

## 5. Render Security & Password Manager Armor

### 1. Code Editor & Input Physical Immunity
- **Shadow DOM Penetration**: Recursively verifies ancestors up to the root level;
- **Absolute Whitelist Exclusion**: Excludes `INPUT`, `TEXTAREA`, `contenteditable`, Monaco Editor containers/lines, and `.group/user-input-step` user message bubbles;
- **Value Attribute Lockdown**: Strict refusal to translate input `value` attributes.

### 2. Dashboard Shield Against Password Managers
To prevent password managers (1Password, Bitwarden, etc.) from falsely recognizing username inputs as credentials:
1. **Decoy Inputs**: Hidden inputs placed at `-9999px` consume autofill hooks;
2. **Readonly Armor**: Inputs remain `readonly` until focused (`onfocus`), re-locking immediately `onblur`;
3. **HTML Attributes**: Enforces `autocomplete="new-password"` and `spellcheck="false"`.

---

## 6. Package Slimming & Upgrades

### 1. Official Slim Size Guarantee (4.53 MB on v2.12.0 / ~6.23 MB on v2.33.0)
Native modules like `chrome-devtools-mcp` reside in `resources/app.asar.unpacked/`. Packing rules must explicitly decouple them:
```bash
npx --yes @electron/asar@3.2.18 pack "<extract_dir>" "<output_asar>" --unpack-dir "**/chrome-devtools-mcp/**"
```
This prevents 21MB+ bundle bloat and keeps `app.asar` strictly aligned with each upstream version's official distribution size (4.53 MB on v2.12.0, ~6.23 MB on v2.33.0). In addition, the dictionary and DOM runtime engine are modularized under `src/dictionary.js`, `src/dom-translator.js`, and `src/build-injection.js` to eliminate backtick template-escaping bugs.

### 2. `injectOrUpdate` Seamless Upgrades
Truncates legacy injection blocks cleanly and writes the updated engine payload, ensuring smooth upgrades without manual cleanups.

---

## 7. Binary Assets & Repository Maintenance Strategy

### 1. Architectural Trade-off (UX vs Repository Size)
To give end users a seamless out-of-the-box experience without build toolchain prerequisites, PR #42 tracked the pre-compiled patch `app.asar.ready` directly in Git.
- **Core Benefit**: Users downloading the source archive (via GitHub "Download ZIP" or clone) get the pre-built patch ready for instant execution. Running the one-click batch script requires zero local Node.js/asar dependencies.
- **Physical Cost**: As a content-addressable storage engine, Git cannot perform efficient line-by-line delta compression on monolithic binary archives (`.asar`). Each version bump writes a ~6.35 MiB (~6.66 MB) standalone Blob object into `.git/objects`, causing linear history growth over time.

### 2. Scope of Impact
- **End Users (Completely Unaffected)**:
  1. Users downloading release assets (`app.asar` / `default.zip`) receive clean snapshots with zero Git history (constant ~6.35 MiB / 6.66 MB);
  2. Users clicking "Download ZIP" on GitHub download branch snapshots with no `.git` metadata;
  3. Local installation directories maintain only the single active file.
- **Developers & Full Clones (Historical Accumulation)**:
  Running a full `git clone` pulls the entire commit history, which accumulates ~5 MB per release.

### 3. Three-Tier Maintenance & Evolution Strategy

#### Solution 1: Developer Shallow Clone (Zero Cost, Immediate)
Developers contributing or working on source code should use shallow clones to skip large historical blobs:
```bash
# Clone only the latest commit; historical payload drops to zero (~5 MB download)
git clone --depth=1 https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization.git
```
Unshallow can be performed on demand (`git fetch --unshallow`) if full history is ever required.

#### Solution 2: Git History Pruning & Blob Decoupling (Mid-term Maintenance)
When cumulative history approaches the 200 MB+ threshold after dozens of releases, maintainers can run standard historical pruning using `git-filter-repo` to strip obsolete intermediate blobs:
```bash
# 1. Install git-filter-repo
pip install git-filter-repo

# 2. Strip obsolete historical asar blobs (retaining only current tracking)
git filter-repo --path app.asar.ready --invert-paths --refs <old-release-tags>

# 3. Aggressive GC and repack
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

#### Solution 3: Release CDN Dynamic Streaming (Long-term Evolution)
If release frequency increases significantly, distribution can evolve into on-demand cloud retrieval:
1. **Pure Text Mainline**: Remove `app.asar.ready` from Git tracking and restore `.gitignore` ignore rules, returning the repository to pure source code (~hundreds of KB);
2. **Intelligent On-demand Streaming**: Upgrade `auto-restore.js` and batch scripts to automatically stream and cache the matching `app.asar.ready` from GitHub Releases CDN if absent locally;
3. **Outcome**: Achieves an ultralight codebase and hassle-free end-user execution simultaneously.
