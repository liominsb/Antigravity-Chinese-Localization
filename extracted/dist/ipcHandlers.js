"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const types_1 = require("./types");
const updater_1 = require("./updater");
const main_1 = __importDefault(require("electron-log/main"));
const fs = __importStar(require("fs/promises"));
const customScheme_1 = require("./customScheme");
const tray_1 = require("./tray");
const webviewBrowser_1 = require("./webviewBrowser");
const constants_1 = require("./ideInstall/constants");
const url_1 = require("url");
const wsl_1 = require("./wsl");
const menu_1 = require("./menu");
const scriptJail_1 = require("./scriptJail");
const externalUrl_1 = require("./externalUrl");
const utils_1 = require("./utils");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const wcvIpcHandlers_1 = require("./wcvIpcHandlers");
const guestDialogController_1 = require("./guestDialogController");
function buildContextMenuTemplate(items, onSelect) {
    return items.map((item) => {
        if (item.type === 'separator') {
            return { type: 'separator' };
        }
        if (item.type === 'submenu' || (item.submenu && item.submenu.length > 0)) {
            return {
                id: item.id,
                label: (typeof translateContextLabel === 'function' ? translateContextLabel(item.label) : item.label) ?? '',
                type: 'submenu',
                enabled: !item.disabled,
                submenu: buildContextMenuTemplate(item.submenu ?? [], onSelect),
            };
        }
        return {
            id: item.id,
            label: (typeof translateContextLabel === 'function' ? translateContextLabel(item.label) : item.label) ?? '',
            type: item.type ?? 'normal',
            checked: item.checked,
            enabled: !item.disabled,
            accelerator: item.accelerator,
            click: () => {
                onSelect(item.id);
            },
        };
    });
}
/**
 * Registers all IPC handlers for the main process.
 */
function registerIpcHandlers(storageManager) {
    const getTargetHubWindow = () => {
        return (0, utils_1.getFocusedHubWindow)() ?? (0, utils_1.getHubWindows)()[0];
    };
    // Dialog
    // In WSL mode, start the folder dialog in the distro's home directory.
    async function dialogDefaultPath() {
        const distro = (0, wsl_1.getActiveWslDistro)();
        if (!distro) {
            return undefined;
        }
        try {
            return (0, wsl_1.distroToWindowsPath)(await (0, wsl_1.getDistroHome)(distro), distro);
        }
        catch {
            return undefined;
        }
    }
    // In WSL mode, translate a picked Windows path to the distro's view.
    // Returns undefined when the path is unusable (e.g. another distro).
    function mapPickedPath(picked) {
        const distro = (0, wsl_1.getActiveWslDistro)();
        if (!distro) {
            return picked;
        }
        const t = (0, wsl_1.windowsToDistroPath)(picked, distro);
        if (t.error) {
            electron_1.dialog.showErrorBox('无法打开文件夹', t.error);
            return undefined;
        }
        if (t.warning) {
            void electron_1.dialog.showMessageBox({
                type: 'warning',
                message: '文件夹位于 Windows 文件系统中',
                detail: t.warning,
            });
        }
        return t.path;
    }
    electron_1.ipcMain.handle('dialog:open-workspace', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: '打开工作区',
            defaultPath: await dialogDefaultPath(),
        });
        if (result.canceled || result.filePaths.length === 0) {
            return undefined;
        }
        return mapPickedPath(result.filePaths[0]);
    });
    // Like 'dialog:open-workspace' but allows selecting multiple folders,
    // returning an array of paths (empty if cancelled).
    electron_1.ipcMain.handle('dialog:open-workspaces', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory', 'multiSelections'],
            title: '打开工作区',
            defaultPath: await dialogDefaultPath(),
        });
        if (result.canceled || result.filePaths.length === 0) {
            return [];
        }
        return result.filePaths
            .map(mapPickedPath)
            .filter((p) => p !== undefined);
    });
    // Auto-updater
    electron_1.ipcMain.handle('updater:apply', async () => {
        (0, updater_1.broadcastState)({ type: types_1.UpdateState.Ready });
    });
    electron_1.ipcMain.handle('updater:quit-and-install', () => {
        if (!electron_1.app.isPackaged) {
            console.log('[AutoUpdater] Skipping quitAndInstall (requires a packaged app).');
            return;
        }
        electron_updater_1.autoUpdater.quitAndInstall();
    });
    electron_1.ipcMain.handle('updater:get-state', () => {
        return (0, updater_1.getLastState)();
    });
    // Notifications
    electron_1.ipcMain.handle('notification:send', (_, options) => {
        const notification = new electron_1.Notification({
            title: options.title,
            body: options.body,
            silent: options.silent ?? false,
        });
        notification.on('click', () => {
            const win = (0, utils_1.getHubWindows)()[0];
            if (win) {
                if (win.isMinimized()) {
                    win.restore();
                }
                win.show();
                win.focus();
                if (options.payload) {
                    win.webContents.send('notification:clicked', options.payload);
                }
            }
        });
        notification.show();
    });
    // Note: copied from our desktop AGY implementation:
    // vs/platform/nativeNotification/electron-main/electronNotificationService.ts
    electron_1.ipcMain.handle('notification:open-system-preferences', async () => {
        if (process.platform === 'darwin') {
            void electron_1.shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
        }
        else if (process.platform === 'win32') {
            void electron_1.shell.openExternal('ms-settings:notifications');
        }
        else if (process.platform === 'linux') {
            const { exec } = await Promise.resolve().then(() => __importStar(require('child_process')));
            const commands = [
                'gnome-control-center notifications',
                'systemsettings kcm_notifications',
                'xfce4-notifyd-config',
                'gnome-control-center',
                'systemsettings',
            ];
            for (const command of commands) {
                try {
                    exec(command);
                    return; // If one command executes without immediate error, assume success for now
                }
                catch {
                    // Try next
                }
            }
        }
    });
    // Storage
    electron_1.ipcMain.handle('storage:get-items', async () => {
        return storageManager.getItems();
    });
    electron_1.ipcMain.handle('storage:update-items', async (_event, changes) => {
        await storageManager.updateItems(changes);
    });
    // Logs
    electron_1.ipcMain.handle('logs:electron', async () => {
        try {
            const logPath = main_1.default.transports.file.getFile().path;
            const contents = await fs.readFile(logPath, 'utf-8');
            return contents;
        }
        catch (err) {
            return `Failed to read logs: ${String(err)}`;
        }
    });
    // Sidecar extension custom scheme
    electron_1.ipcMain.handle('extensions:send-authorities', async (_event, authorities) => {
        customScheme_1.extensionAuthorities.clear();
        for (const [key, value] of Object.entries(authorities)) {
            customScheme_1.extensionAuthorities.set(key, value);
        }
    });
    // Agent
    electron_1.ipcMain.handle('agent:update-active-count', async (_event, count) => {
        (0, tray_1.updateTrayAgentCount)(count);
    });
    // Window
    electron_1.ipcMain.handle('window:set-title-bar-overlay', async (_event, options) => {
        const win = getTargetHubWindow();
        if (win && process.platform === 'win32') {
            win.setTitleBarOverlay({
                color: options.color,
                symbolColor: options.symbolColor,
                height: 30,
            });
        }
    });
    electron_1.ipcMain.handle('window:minimize', async () => {
        const win = getTargetHubWindow();
        if (win) {
            win.minimize();
        }
    });
    electron_1.ipcMain.handle('window:maximize', async () => {
        const win = getTargetHubWindow();
        if (win) {
            win.maximize();
        }
    });
    electron_1.ipcMain.handle('window:unmaximize', async () => {
        const win = getTargetHubWindow();
        if (win) {
            win.unmaximize();
        }
    });
    electron_1.ipcMain.handle('window:is-maximized', async () => {
        const win = getTargetHubWindow();
        return win ? win.isMaximized() : false;
    });
    electron_1.ipcMain.handle('window:close', async () => {
        const win = getTargetHubWindow();
        if (win) {
            win.close();
        }
    });
    electron_1.ipcMain.handle('window:toggle-devtools', async () => {
        const win = getTargetHubWindow();
        if (win) {
            win.webContents.toggleDevTools();
        }
    });
    let activeContextMenu = null;
    electron_1.ipcMain.handle('window:show-context-menu', async (_event, items) => {
        const win = getTargetHubWindow();
        if (!win || !Array.isArray(items) || items.length === 0) {
            return null;
        }
        activeContextMenu?.closePopup?.(win);
        return new Promise((resolve) => {
            let settled = false;
            const template = buildContextMenuTemplate(items, (id) => {
                if (!settled) {
                    settled = true;
                    activeContextMenu = null;
                    resolve(id);
                }
            });
            const menu = electron_1.Menu.buildFromTemplate(template);
            activeContextMenu = menu;
            menu.popup({
                window: win,
                callback: () => {
                    setImmediate(() => {
                        if (activeContextMenu === menu) {
                            activeContextMenu = null;
                        }
                        if (!settled) {
                            settled = true;
                            resolve(null);
                        }
                    });
                },
            });
        });
    });
    electron_1.ipcMain.handle('window:close-context-menu', () => {
        const win = getTargetHubWindow();
        activeContextMenu?.closePopup?.(win);
        activeContextMenu = null;
    });
    // Zoom — main-process source of truth so the level is reliably persisted
    // across restarts on all platforms (works around a Chromium quirk on Windows
    // where renderer-only webFrame.setZoomLevel changes aren't cached).
    const ZOOM_LEVEL_KEY = 'zoomLevel';
    const ZOOM_STEP = 0.5;
    electron_1.ipcMain.handle('window:zoom-in', async () => {
        const win = getTargetHubWindow();
        if (win) {
            const newLevel = win.webContents.getZoomLevel() + ZOOM_STEP;
            win.webContents.setZoomLevel(newLevel);
            await storageManager.updateItems({
                [ZOOM_LEVEL_KEY]: String(newLevel),
            });
        }
    });
    electron_1.ipcMain.handle('window:zoom-out', async () => {
        const win = getTargetHubWindow();
        if (win) {
            const newLevel = win.webContents.getZoomLevel() - ZOOM_STEP;
            win.webContents.setZoomLevel(newLevel);
            await storageManager.updateItems({
                [ZOOM_LEVEL_KEY]: String(newLevel),
            });
        }
    });
    electron_1.ipcMain.handle('window:reset-zoom', async () => {
        const win = getTargetHubWindow();
        if (win) {
            win.webContents.setZoomLevel(0);
            await storageManager.updateItems({ [ZOOM_LEVEL_KEY]: String(0) });
        }
    });
    // Auto-updater manual check
    electron_1.ipcMain.handle('updater:check-for-updates', () => {
        (0, updater_1.checkForUpdates)(true);
    });
    // Safe external shell launch
    electron_1.ipcMain.handle('shell:open-external', async (_event, url) => {
        await (0, externalUrl_1.openExternalSafely)(url, 'confirmed');
    });
    electron_1.ipcMain.handle('shell:reveal-in-file-picker', (_event, path) => {
        const distro = (0, wsl_1.getActiveWslDistro)();
        if (distro) {
            const posixPath = (0, url_1.fileURLToPath)(path, { windows: false });
            electron_1.shell.showItemInFolder((0, wsl_1.distroToWindowsPath)(posixPath, distro));
            return;
        }
        electron_1.shell.showItemInFolder((0, url_1.fileURLToPath)(path));
    });
    electron_1.ipcMain.handle('webview:set-download-dir', (event, webContentsId, downloadDir) => {
        if (typeof webContentsId !== 'number' ||
            !Number.isInteger(webContentsId) ||
            webContentsId <= 0) {
            throw new Error(`Invalid webContentsId: ${String(webContentsId)}`);
        }
        if (downloadDir !== null && typeof downloadDir !== 'string') {
            throw new Error('downloadDir must be a string or null');
        }
        if (event?.senderFrame?.parent) {
            throw new Error('Unauthorized webview:set-download-dir sender: subframe cannot configure downloads');
        }
        const sender = event?.sender;
        if (!sender || sender.isDestroyed?.()) {
            throw new Error(`WebContents ${webContentsId} is not owned by the calling renderer`);
        }
        const wc = electron_1.webContents.fromId(webContentsId);
        if (!(0, webviewBrowser_1.isOwnedBrowserGuestWebContents)(wc, sender.id)) {
            throw new Error(`WebContents ${webContentsId} is not owned by the calling renderer`);
        }
        return (0, webviewBrowser_1.setGuestDownloadDirectory)(wc, downloadDir);
    });
    // IDE installation check
    electron_1.ipcMain.handle('ide:is-installed', async () => {
        try {
            // Check standard installation path (works even if the app has never been launched).
            await fs.stat((0, constants_1.getIdeInstallPath)());
            return true;
        }
        catch {
            return false;
        }
    });
    // Per-guest renderer working-set memory in bytes for memory-budgeted LRU eviction.
    electron_1.ipcMain.handle('webview:get-memory-usage', async (event, webContentsIds) => {
        const sender = event?.sender;
        if (!sender ||
            sender.isDestroyed() ||
            event?.senderFrame?.parent ||
            (event?.senderFrame &&
                sender.mainFrame &&
                event.senderFrame !== sender.mainFrame) ||
            !Array.isArray(webContentsIds) ||
            webContentsIds.length === 0) {
            return {};
        }
        const MAX_QUERIED_GUESTS = 64;
        const seenIds = new Set();
        const ownedGuests = [];
        for (const rawId of webContentsIds) {
            if (seenIds.size >= MAX_QUERIED_GUESTS) {
                break;
            }
            if (typeof rawId !== 'number' ||
                !Number.isInteger(rawId) ||
                rawId <= 0 ||
                seenIds.has(rawId)) {
                continue;
            }
            seenIds.add(rawId);
            const wc = electron_1.webContents.fromId(rawId);
            const isWcv = wcvBrowserRegistry_1.wcvBrowserRegistry.isRegisteredWcv(rawId);
            if (!wc || wc.isDestroyed() || (wc.getType() !== 'webview' && !isWcv)) {
                continue;
            }
            const isOwned = isWcv
                ? wcvBrowserRegistry_1.wcvBrowserRegistry.isOwnedBySender(rawId, sender.id)
                : Boolean(sender.id !== undefined && wc.hostWebContents?.id === sender.id);
            if (!isOwned) {
                continue;
            }
            let pid;
            try {
                pid = wc.getOSProcessId?.();
            }
            catch {
                pid = undefined;
            }
            ownedGuests.push({ webContentsId: rawId, pid });
        }
        if (ownedGuests.length === 0) {
            return {};
        }
        const bytesByWcId = wcvBrowserRegistry_1.wcvBrowserRegistry.computeGuestMemoryBytes(ownedGuests);
        const out = {};
        for (const [id, bytes] of bytesByWcId.entries()) {
            out[id] = bytes;
        }
        return out;
    });
    // WSL environment switching (Windows only). Lets the web UI (e.g. the
    // Settings page) discover WSL distros and relaunch the app into/out of one.
    electron_1.ipcMain.handle('wsl:get-state', async () => {
        if (!(0, wsl_1.isWslAvailable)()) {
            return { available: false, activeDistro: null, distros: [] };
        }
        try {
            const distros = await (0, wsl_1.listWslDistros)();
            return {
                available: true,
                activeDistro: (0, wsl_1.getActiveWslDistro)() ?? null,
                distros: distros.map((d) => ({ name: d.name, isDefault: d.isDefault })),
            };
        }
        catch (err) {
            main_1.default.error('wsl:get-state failed:', err);
            return { available: false, activeDistro: null, distros: [] };
        }
    });
    // Relaunches into the given distro, or locally when `distro` is empty.
    electron_1.ipcMain.handle('wsl:connect', (_event, distro) => {
        (0, menu_1.relaunchWithWslDistro)(distro || '');
    });
    // Execute JavaScript inside an Electron <webview> guest's isolated world.
    // Only the renderer that hosts the <webview> may target it, and worldId is
    // bounded to [MIN, MAX] so it can never hit the main (0) or preload worlds
    // and stays well below Chromium's fatal ISOLATED_WORLD_ID_MAX CHECK.
    const MIN_ISOLATED_WORLD_ID = 1000;
    const MAX_ISOLATED_WORLD_ID = 100000;
    electron_1.ipcMain.handle('webview:execute-js-isolated-world', async (event, webContentsId, worldId, code) => {
        if (typeof webContentsId !== 'number' ||
            !Number.isInteger(webContentsId) ||
            webContentsId <= 0) {
            throw new Error(`Invalid webContentsId: ${String(webContentsId)}`);
        }
        if (typeof worldId !== 'number' ||
            !Number.isInteger(worldId) ||
            worldId < MIN_ISOLATED_WORLD_ID ||
            worldId > MAX_ISOLATED_WORLD_ID) {
            throw new Error(`Invalid isolated worldId: ${String(worldId)} (must be in [${MIN_ISOLATED_WORLD_ID}, ${MAX_ISOLATED_WORLD_ID}])`);
        }
        if (typeof code !== 'string') {
            throw new Error('code must be a string');
        }
        const wc = electron_1.webContents.fromId(webContentsId);
        const isWcv = wcvBrowserRegistry_1.wcvBrowserRegistry.isRegisteredWcv(webContentsId);
        if (!wc || wc.isDestroyed() || (wc.getType() !== 'webview' && !isWcv)) {
            throw new Error(`Invalid or non-webview webContents id: ${webContentsId}`);
        }
        const sender = event?.sender;
        const isOwned = isWcv
            ? wcvBrowserRegistry_1.wcvBrowserRegistry.isOwnedBySender(webContentsId, sender?.id)
            : wc.hostWebContents?.id === sender?.id;
        if (!sender || sender.isDestroyed() || !isOwned) {
            throw new Error(`WebContents ${webContentsId} is not owned by the calling renderer`);
        }
        if (!event?.senderFrame ||
            event.senderFrame !== sender.mainFrame ||
            event.senderFrame.parent) {
            throw new Error('webview:execute-js-isolated-world must be called from the main frame');
        }
        return wc.executeJavaScriptInIsolatedWorld(worldId, [{ code }], false);
    });
    const resolveOwnedGuestWebContents = (event, webContentsId) => {
        if (typeof webContentsId !== 'number' ||
            !Number.isInteger(webContentsId) ||
            webContentsId <= 0) {
            throw new Error(`Invalid webContentsId: ${String(webContentsId)}`);
        }
        const wc = electron_1.webContents.fromId(webContentsId);
        const isWcv = wcvBrowserRegistry_1.wcvBrowserRegistry.isRegisteredWcv(webContentsId);
        if (!wc || wc.isDestroyed() || (wc.getType() !== 'webview' && !isWcv)) {
            throw new Error(`Invalid or non-webview webContents id: ${webContentsId}`);
        }
        const sender = event?.sender;
        const isOwned = isWcv
            ? wcvBrowserRegistry_1.wcvBrowserRegistry.isOwnedBySender(webContentsId, sender?.id)
            : wc.hostWebContents?.id === sender?.id;
        if (!sender || sender.isDestroyed() || !isOwned) {
            throw new Error(`WebContents ${webContentsId} is not owned by the calling renderer`);
        }
        return { wc, sender };
    };
    electron_1.ipcMain.handle('webview:set-dialog-policy', async (event, webContentsId, policy) => {
        const { wc, sender } = resolveOwnedGuestWebContents(event, webContentsId);
        const safePolicy = {
            enabled: Boolean(policy?.enabled),
            ...(policy?.action === 'accept' ||
                policy?.action === 'dismiss' ||
                policy?.action === 'manual'
                ? { action: policy.action }
                : {}),
            ...(typeof policy?.promptText === 'string'
                ? { promptText: policy.promptText }
                : {}),
            ...(typeof policy?.tabKey === 'string' ? { tabKey: policy.tabKey } : {}),
        };
        return guestDialogController_1.guestDialogController.setPolicy(wc, sender, safePolicy);
    });
    electron_1.ipcMain.handle('webview:handle-javascript-dialog', async (event, webContentsId, decision) => {
        const { wc } = resolveOwnedGuestWebContents(event, webContentsId);
        return guestDialogController_1.guestDialogController.handleDialog(wc, {
            ...(typeof decision?.dialogId === 'string'
                ? { dialogId: decision.dialogId }
                : {}),
            accept: Boolean(decision?.accept),
            ...(typeof decision?.promptText === 'string'
                ? { promptText: decision.promptText }
                : {}),
        });
    });
    // Execute an untrusted agent script inside a single-use, zero-egress
    // Electron script jail and transfer the paired MessagePort to the caller.
    electron_1.ipcMain.handle('script-jail:run', async (event, req) => {
        return (0, scriptJail_1.runScriptInJail)(event?.sender, req, event?.senderFrame);
    });
    electron_1.ipcMain.handle('script-jail:abort', (event, jailId) => {
        return (0, scriptJail_1.abortScriptInJail)(event?.sender, jailId, event?.senderFrame);
    });
    (0, wcvIpcHandlers_1.registerWcvIpcHandlers)();
}



const contextMenuTranslationMap = {
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Select All': '全选',
  'Undo': '撤销',
  'Redo': '重做',
  'Delete': '删除',
  'New Conversation': '新建对话',
  'Fork Conversation': '派生对话',
  'Rename': '重命名',
  'Pin': '置顶',
  'Unpin': '取消置顶',
  'Close': '关闭',
  'Close Others': '关闭其他',
  'Close All': '全部关闭',
  'Copy Path': '复制路径',
  'Copy Relative Path': '复制相对路径',
  'Reveal in File Explorer': '在文件资源管理器中显示',
  'Reveal in Finder': '在访达中显示',
  'Open in Terminal': '在终端中打开',
  'Project options': '项目选项',
  'View Usage': '查看使用额度',
  'Duplicate': '创建副本',
  'Archive': '归档',
  'Share': '分享',
  'Copy Link': '复制链接',
  'Export': '导出',
  'Export Conversation': '导出对话',
  'Clear': '清除',
  'Clear History': '清除历史',
  'Automations': '自动化',
  'Automation': '自动化',
  'Give Feedback': '提供反馈',
  'Provide Feedback': '提供反馈'
};
function translateContextLabel(lbl) {
  if (!lbl) return '';
  return contextMenuTranslationMap[lbl] || lbl;
}
