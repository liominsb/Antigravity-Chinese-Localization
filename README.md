# Antigravity 2.0 一键汉化补丁 (Chinese Localization Patch)

这是一个为 Antigravity 2.0 打造的全自动一键汉化补丁程序。

## ✨ 特性

- **全自动解包与重打包**：自动备份原始的 `app.asar` 文件，解压后注入汉化代码，再重新打包替换，全程无需手动干预。
- **动态 DOM 拦截汉化**：利用高级的 `MutationObserver` 与 Shadow DOM 穿透技术，实时拦截并翻译 Web 界面中的英文文本和属性（如 `placeholder`、`title`、`aria-label` 等）。
- **原生 UI 汉化**：支持对 Electron 原生菜单栏（Menu）和系统托盘（Tray）进行深度翻译。
- **超大且精准的词库**：内置数百个针对 IDE、智能体（Agent）配置、权限设置、快捷键以及工作区的精准翻译短语，避免机器翻译产生的“中英夹杂”现象。
- **安全备份与一键恢复**：每次汉化前都会自动备份 `app.asar.bak`，支持一键恢复到原版英文状态。

## 🚀 使用方法

**直接双击运行目录下的 **`双击运行汉化.bat`**。
**脚本会自动关闭正在运行的 Antigravity 进程
**脚本会自动打开浏览器访问可视化的控制面板
**在可视化的控制面板中，你可以清晰地看到安装状态，并可以点击“一键开始汉化”或“恢复英文原版”。

## 🛠️ 技术细节

本工具通过 `node` 脚本和 `@electron/asar` 库实现解包，向 `dist/preload.js`、`dist/ideInstall/wizardPreload.js` 等核心预加载文件中注入一段特制的 `DOM_TRANSLATOR_INJECTION` 引擎。
该引擎不仅重写了原生的 `attachShadow` 方法以捕获组件（如 Monaco Editor 等）的内部文本，还监听了完整的 DOM 树和属性更新，能够在几乎无性能损耗的情况下实现页面的即时语言转换。同时还在 `menu.js` 和 `tray.js` 中注入了原生的映射逻辑以翻译系统级 UI。

## ⚠️ 注意事项

- 请确保你的系统中已安装了 [Node.js](https://nodejs.org/)。
- 汉化过程中会强制关闭 Antigravity 及其语言服务器，请提前保存您的工作内容。
- 如果遇到界面异常或想要升级 Antigravity，可以通过图形化面板，或手动将 `%APPDATA%\Local\Programs\antigravity\resources\app.asar.bak` 恢复为 `app.asar` 来还原。
