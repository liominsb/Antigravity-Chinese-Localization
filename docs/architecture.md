# Antigravity 本地化引擎架构与深度工程文档 (Architecture & Engineering)

本文档面向对 Antigravity-Chinese-Localization 内部实现原理感兴趣的开发者，详细剖析本补丁在 Electron 原生层、Web 容器层、DOM 调度层以及底层算力优化方面的工业级设计。

---

## 一、系统全景架构拓扑

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

---

## 二、基础算力层重构 (Computational Layer)

在复杂的 AI 工作台交互中，单次页面重绘可能涉及数千个 DOM 文本节点。若汉化引擎开销过大，将直接抢占浏览器渲染主线程，造成掉帧与卡顿。

### 1. 预编译 Map 哈希索引
- **传统实现痛点**：社区旧版在主字典未直接命中时，通过 `for...in` 循环遍历全字典（1,300+ 项）进行小写不区分大小写匹配，导致单次查表算法复杂度退化为 $O(N)$；
- **重构方案**：在引擎初始化阶段建立 `lowerDictionary = new Map()`，将字典所有键名降序预编译入哈希表。查找时通过 `dictionary[core] || lowerDictionary.get(core.toLowerCase())` 瞬间获取译文，算法复杂度强制收敛为标准的 $O(1)$。

### 2. ASCII 纯中文极速短路 (Fast Short-Circuit)
- **原理分析**：界面在初次渲染完成后，90% 以上的可见 DOM 节点已经是中文、符号或纯数字，根本不需要反复进入分词管道；
- **优化实现**：在 `translateString` 的入口处增设微秒级短路断言：
  ```javascript
  if (!/[a-zA-Z]/.test(trimmed)) {
    return text;
  }
  ```
  该检查仅消耗极微小的 CPU 周期，使绝大多数已翻译内容在 0 运算开销下瞬间返回。

### 3. WeakSet 节点记忆化与精准打标门禁
- **记忆化缓存**：引入 `translatedNodes = new WeakSet()` 记录已汉化的 `TextNode`，消除父容器触发重绘时的深度递归开销；
- **严格打标门禁**：仅在节点真正翻译成功（`original !== translated`）或原本为纯中文时才将其记录入 `WeakSet`。如果节点当前为异步骨架屏占位符（未命中字典），严禁打标，确保后续异步数据就绪时能被正常补救汉化。

### 4. 算力压测基准数据 (Benchmark)
在 50,000 次混合文本（包含纯中文、英文单词、长句、未命中词及数字符号）的严格压测中：
- **旧版全遍历耗时**：`1,982.59 ms`
- **重构后耗时**：**`29.70 ms`**（总延迟下降 **98.5%**）
- **单次调用平均耗时**：**0.59 微秒**
- **瞬时文本吞吐量**：**168 万次/秒**

---

## 三、DOM 调度层与高帧率保障 (DOM Scheduling)

### 1. 单次流式联合正则扫描 (CORE_WORDS_UNION_REGEX)
- **循环正则痛点**：短语分词若采用 `for` 循环遍历 80 余个独立单正则，长文本需要经历 80 多次 `.test()` 与 `.replace()` 字符串拷贝；
- **联合编译设计**：
  在启动时将核心词按长度降序拼接为单一联合词边界正则：
  ```javascript
  const escapedKeys = Object.keys(coreWords).sort((a, b) => b.length - a.length);
  const CORE_WORDS_UNION_REGEX = new RegExp('\\b(' + escapedKeys.join('|') + ')\\b', 'gi');
  ```
  文本仅需经过**单次流式扫描**，在回调中基于哈希字典直接替换，分词速度直接提升 **3.1 倍**（10 万次分词耗时从 `301 ms` 降至 `98 ms`）。

### 2. DOM 树祖先包含剪枝 (Ancestor Pruning)
- **嵌套遍历放大问题**：当 React 挂载一个多层深层卡片时，外层容器被报告为 `addedNodes`，其内部的数十个子元素也被同时报告为 `addedNodes`，引发严重的 $O(N^2)$ 递归遍历浪费；
- **集合剪枝算法**：在批处理执行前对新增节点队列进行祖先过滤：
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
  若节点任意祖先已在待处理集合中，直接剔除该节点，仅对最高层的公共祖先执行单次深度扫描，实际深搜节点数减少 80% 以上。

### 3. 微任务高保真调度 (queueMicrotask)
- **rAF 节流陷阱**：在窗口失焦、最小化、或者刚刚按下 `Ctrl + R` 重载的瞬间，Chromium 会主动节流甚至挂起 `requestAnimationFrame`；
- **微任务并发合并**：采用 `queueMicrotask` 作为突变合并调度器。微任务在当前事件循环结束时即刻执行，既实现了对同一帧内多次零碎突变的合并防抖，又彻底消除了渲染延迟与掉帧。

---

## 四、复杂生命周期与动态切片自愈 (Lifecycle & Slicing)

### 1. `Ctrl + R` 重载生命周期闭环
在 Electron 中按下 `Ctrl + R` 会清空渲染上下文重载页面。引擎通过三道防线保证重载时的 100% 稳定性：
1. **骨架屏豁免**：初次扫过未就绪占位节点时不赋予 `translatedNodes` 标记；
2. **突变解绑清除**：在 `MutationObserver` 捕获到 `characterData` 变动时，执行 `translatedNodes.delete(mutation.target)`，响应 React 重新赋值；
3. **多阶渐进式兜底**：在挂载初期按 `[50, 150, 400, 1000, 2500]` 毫秒阶梯执行增量扫描，捕获晚到达的异步数据。

### 2. React 动态切片拼接自愈
在 React JSX 语法中，数值变量或局部强调（如 `{val}% of the budget...` 或在 `the Agent in` 之后插入样式标签）会导致一段语义在物理 DOM 树中被拆分成两个甚至多个兄弟 TextNode。
引擎针对切片特征构建了切片级前置拦截规则：
- 前半截：`Plugins are packaged collections of skills and MCPs to help the Agent in` ➔ 拦截为 `插件是技能和 MCP 的打包集合，用于协助智能体在`
- 后半截：`Antigravity work with Google developer products...` ➔ 拦截为 `Antigravity 中协同 Google 开发者产品工作。你可以随时在设置中更改你的选择。`
两个兄弟节点在界面渲染时自然接驳，拼合后语法通顺、浑然天成。

---

## 五、渲染安全与物理沙盒 (Safety & Sandbox)

### 1. 代码编辑区与用户输入绝对免疫
- **穿透 Shadow DOM**：递归检测目标节点直至根级；
- **全方位白名单过滤**：严格免疫 `INPUT`、`TEXTAREA`、`contenteditable`、Monaco Editor 容器及内部行、以及带有 `.group/user-input-step` 的用户对话气泡；
- **属性锁死**：对于输入控件的 `value` 属性，无论匹配到何种词条均绝对拒绝替换，严防篡改用户的代码与指令。

### 2. 控制中心防密码管理器篡改装甲 (Autofill Armor)
针对第三方密码管理器（1Password、Bitwarden、Edge/Chrome 密码保存插件）容易将控制中心配置面板误判为登录表单并强制覆盖保存凭据的问题：
1. **诱饵隔离**：在 DOM 顶层插入坐标位于 `-9999px` 的诱饵账号密码输入框，吸引并消耗外部密码钩子；
2. **只读保护装甲**：账户名输入框默认处于 `readonly` 状态，仅在鼠标焦点（`onfocus`）进入时解开，失焦（`onblur`）时立即重新锁死；
3. **元属性声明**：显式声明 `autocomplete="new-password"` 与 `spellcheck="false"`，彻底阻断外部脚本的恶意注入与改写。

---

## 六、打包瘦身与热升级机制 (Packaging & Upgrades)

### 1. 4.53 MB 官方基准瘦身原理
官方 Antigravity 在打包时将 `chrome-devtools-mcp` 等体积达 17MB 的原生依赖模块存放在 `resources/app.asar.unpacked/` 中。若重新打包时不加过滤，打包工具会将外置文件冗余压缩进 `app.asar` 导致体积膨胀至 21.4MB。  
本项目在重打包命令中严谨注入：
```bash
npx --yes asar pack "<extract_dir>" "<output_asar>" --unpack-dir "**/chrome-devtools-mcp/**"
```
保持外置目录解耦，使输出的 `app.asar` 物理体积精准维持在官方标准的 **4.53 MB**。

### 2. `injectOrUpdate` 平滑升级机制
摒弃检测到标记即跳过的旧版逻辑，采用正确定位与截断技术：
```javascript
const markerIndex = existing.indexOf('// Antigravity 2.0 Chinese Localization Engine');
if (markerIndex !== -1) {
  existing = existing.substring(0, markerIndex).trimEnd() + '\n\n' + newPayload;
}
```
确保用户无论是全新安装还是跨版本热升级，均能无损刷入最新的核心引擎与词库规则。

---

## 七、版本分发与二进制资产维护策略 (Binary Assets & Repository Maintenance Strategy)

### 1. 架构权衡背景 (Trade-off: 体验 vs 仓库体积)
为了让非技术用户享受“解压即用、零环境依赖”的极致体验，工程在 PR #42 中将预编译补丁包 `app.asar.ready` 纳入了 Git 版本追踪。
- **核心收益**：用户从 GitHub 点击 "Download ZIP" 下载源码包或克隆后，目录内直接包含预制补丁镜像，双击批处理无需安装 Node.js/asar 编译工具链即可一键无缝替换。
- **物理代价**：Git 作为内容寻址数据库，无法对二进制打包文件（.asar）进行有效的行级差分压缩（Delta Compression）。每次发版更新 `app.asar.ready` 时，Git 会向 `.git/objects` 历史树中写入一个约 4.8 MB ~ 5.1 MB 的完整独立 Blob 对象，使 Git 提交历史呈现线性膨胀。

### 2. 影响范围清晰界定
- **终端用户（完全不受影响）**：
  1. 通过 GitHub Releases 页面下载 `app.asar` 或 `default.zip` 的用户：仅包含当前版本纯净文件，不含 Git 历史，体积恒定为 4.5 MB ~ 5.1 MB；
  2. 通过 GitHub 网页点击 "Download ZIP" 下载源码的用户：GitHub 动态打包当前分支的快照（Snapshot），不含 `.git` 目录，体积恒定为约 5 MB；
  3. 本地安装与更新目录：工作区始终只保留最新一份物理文件，不产生历史冗余。
- **开发者与源码克隆者（受历史累加影响）**：
  使用完整 `git clone` 拉取全部提交历史时，下载体积会随迭代版本数量逐渐累加（每次迭代增加约 5 MB 历史包）。

### 3. 三大治理与演进方案 (Maintenance Solutions)

针对 Git 二进制历史膨胀问题，工程制定了“即时防护 - 中期修剪 - 长期解耦”三阶治理策略：

#### 方案一：开发者浅克隆规范（即时生效，零维护成本）
面向通过源码参与贡献或拉取工程的开发者，推荐使用浅克隆（Shallow Clone），直接忽略历史所有大文件 commit：
```bash
# 只克隆最新一次提交，历史体积归零，拉取体积恒定为 ~5 MB
git clone --depth=1 https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization.git
```
若后续需要提交 PR，可通过 `git fetch --unshallow` 按需拉取历史，或直接在浅克隆分支上提交改动。

#### 方案二：Git 历史修剪与大文件剥离（中长期维护）
当版本经过几十上百次频繁迭代，若 `.git` 文件夹体积累积接近 200 MB ~ 500 MB 警戒线时，仓库管理员可执行一次性历史瘦身操作，剥离过往已被废弃的历史版本 asar blob，使仓库瞬间瘦身回初始几十 MB：
```bash
# 使用官方推荐的 git-filter-repo 工具剥离历史旧包（保留最新 HEAD 的文件）
# 1. 安装 git-filter-repo
pip install git-filter-repo

# 2. 从历史提交中剥离大文件，仅保留当前最新版本的跟踪
git filter-repo --path app.asar.ready --invert-paths --refs <old-release-tags>

# 3. 强力回收与压缩无引用对象
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```
*注：该操作会重写 Git 提交哈希，仅建议在跨大版本架构重构时统一执行。*

#### 方案三：架构演进——基于 Release CDN 的按需动态拉取（终极解耦）
随着项目规模扩大，若需彻底消除 Git 仓库中包含二进制文件的负担，可将分发架构演进为“云端按需拉取”：
1. **主分支纯文本化**：从 Git 版本管理中移除 `app.asar.ready`，重新恢复 `.gitignore` 规则，保持仓库历史为 100% 极轻量纯代码（仅几百 KB）；
2. **脚本智能按需下载**：升级 `一键更新汉化.bat` 与 `auto-restore.js`，在本地未检测到补丁包时，自动根据客户端版本从 GitHub Releases CDN（或国内高速镜像）静默流式下载对应的预编译 `app.asar.ready` 缓存至 `downloads/` 目录；
3. **优势**：兼顾“源码仓库极致轻盈”与“小白用户开箱即用”的双重优势，彻底终结二进制膨胀隐患。
