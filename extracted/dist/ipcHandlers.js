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
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const paths_1 = require("./paths");
const debugConsole_1 = require("./debugConsole");
const customScheme_1 = require("./customScheme");
const tray_1 = require("./tray");
const webviewBrowser_1 = require("./webviewBrowser");
const constants_1 = require("./ideInstall/constants");
const deviceChooser_1 = require("./deviceChooser");
const url_1 = require("url");
const wsl_1 = require("./wsl");
const menu_1 = require("./menu");
const scriptJail_1 = require("./scriptJail");
const externalUrl_1 = require("./externalUrl");
const utils_1 = require("./utils");
const hubZoom_1 = require("./hubZoom");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const wcvIpcHandlers_1 = require("./wcvIpcHandlers");
const guestDialogController_1 = require("./guestDialogController");
const guestFileChooserController_1 = require("./guestFileChooserController");
const guestPromptController_1 = require("./guestPromptController");
const webviewPromptPreload_1 = require("./webviewPromptPreload");
const isolatedWorldExec_1 = require("./isolatedWorldExec");
const guestFrameBridge_1 = require("./guestFrameBridge");
const guestNetworkController_1 = require("./guestNetworkController");
const guestWebMcpController_1 = require("./guestWebMcpController");
function isMainFramePromptCaller(event) {
    const s = event?.sender;
    return Boolean(s &&
        !s.isDestroyed?.() &&
        !event?.senderFrame?.parent &&
        (!event?.senderFrame || !s.mainFrame || event.senderFrame === s.mainFrame));
}
const onHumanPromptSync = (event, rawJson) => {
    guestPromptController_1.guestPromptController.handleSyncPrompt(event, rawJson);
};
const onHumanPromptSubscriberState = (event, subscribed) => {
    if (isMainFramePromptCaller(event)) {
        guestPromptController_1.guestPromptController.setHostSubscribed(event.sender, Boolean(subscribed));
    }
};
deviceChooser_1.deviceChooserController.setHostResolver((webContentsId) => wcvBrowserRegistry_1.wcvBrowserRegistry.resolveDeviceChooserHost(webContentsId));
function onDeviceChooserSubscriberState(event, subscribed) {
    if ((0, wcvIpcHandlers_1.isAuthorizedHubMainFrameEvent)(event)) {
        deviceChooser_1.deviceChooserController.setHostSubscribed(event.sender, Boolean(subscribed));
    }
}
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
const SAFE_UPLOAD_CONVERSATION_ID_RE = /^[A-Za-z0-9._-]+$/;
function registerIpcHandlers(storageManager) {
    (0, hubZoom_1.setHubZoomStorageManager)(storageManager);
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
    electron_1.ipcMain.handle('dialog:get-default-download-dir', (event) => {
        const sender = event?.sender;
        if (!sender ||
            sender.isDestroyed?.() ||
            event?.senderFrame?.parent ||
            (event?.senderFrame &&
                sender.mainFrame &&
                event.senderFrame !== sender.mainFrame) ||
            sender.getType?.() === 'webview' ||
            (typeof sender.id === 'number' &&
                wcvBrowserRegistry_1.wcvBrowserRegistry.isRegisteredWcv(sender.id))) {
            throw new Error('Unauthorized dialog:get-default-download-dir sender');
        }
        try {
            const downloadsDir = electron_1.app.getPath('downloads');
            if (typeof downloadsDir !== 'string' || downloadsDir.includes('\0')) {
                return null;
            }
            const trimmed = downloadsDir.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        catch {
            return null;
        }
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
    const readOsMicAccessStatus = () => {
        try {
            return electron_1.systemPreferences.getMediaAccessStatus('microphone');
        }
        catch {
            return 'unknown';
        }
    };
    electron_1.ipcMain.handle('mic:get-access-status', (event) => {
        if (!(0, wcvIpcHandlers_1.isAuthorizedHubMainFrameEvent)(event)) {
            return 'unknown';
        }
        if (process.platform === 'darwin' || process.platform === 'win32') {
            return readOsMicAccessStatus();
        }
        return 'unknown';
    });
    let pendingMicAccessRequest = null;
    electron_1.ipcMain.handle('mic:request-access', async (event) => {
        if (!(0, wcvIpcHandlers_1.isAuthorizedHubMainFrameEvent)(event)) {
            return 'unknown';
        }
        if (process.platform === 'darwin') {
            const status = readOsMicAccessStatus();
            if (status !== 'not-determined') {
                return status;
            }
            if (!pendingMicAccessRequest) {
                pendingMicAccessRequest =
                    (async () => {
                        try {
                            const granted = await electron_1.systemPreferences.askForMediaAccess('microphone');
                            if (granted) {
                                return 'granted';
                            }
                            const after = readOsMicAccessStatus();
                            return after === 'not-determined' ? 'denied' : after;
                        }
                        catch {
                            return 'unknown';
                        }
                        finally {
                            pendingMicAccessRequest = null;
                        }
                    })();
            }
            return pendingMicAccessRequest;
        }
        if (process.platform === 'win32') {
            return readOsMicAccessStatus();
        }
        return 'unknown';
    });
    electron_1.ipcMain.handle('mic:open-system-preferences', async (event) => {
        if (!(0, wcvIpcHandlers_1.isAuthorizedHubMainFrameEvent)(event)) {
            return;
        }
        if (process.platform === 'darwin') {
            await (0, externalUrl_1.openExternalSafely)('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone', 'confirmed');
        }
        else if (process.platform === 'win32') {
            await (0, externalUrl_1.openExternalSafely)('ms-settings:privacy-microphone', 'confirmed');
        }
    });
    // Storage
    electron_1.ipcMain.removeAllListeners?.('storage:get-items-sync');
    electron_1.ipcMain.on('storage:get-items-sync', (event) => {
        const s = event?.sender;
        const trusted = Boolean(s) &&
            !s.isDestroyed?.() &&
            s.getType?.() !== 'webview' &&
            !event.senderFrame?.parent &&
            (0, utils_1.getHubWindows)().some((w) => (0, utils_1.getHubWebContents)(w) === s);
        event.returnValue = trusted ? storageManager.getItemsSync() : null;
    });
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
    electron_1.ipcMain.handle('window:toggle-devtools', async (event) => {
        if (!(0, debugConsole_1.isDebugConsoleEnabled)() || !(0, wcvIpcHandlers_1.isAuthorizedHubMainFrameEvent)(event)) {
            return;
        }
        const win = getTargetHubWindow();
        if (win) {
            win.webContents.toggleDevTools();
        }
    });
    electron_1.ipcMain.removeListener?.(deviceChooser_1.WEBVIEW_DEVICE_CHOOSER_SUBSCRIBER_STATE_CHANNEL, onDeviceChooserSubscriberState);
    electron_1.ipcMain.on?.(deviceChooser_1.WEBVIEW_DEVICE_CHOOSER_SUBSCRIBER_STATE_CHANNEL, onDeviceChooserSubscriberState);
    electron_1.ipcMain.handle(deviceChooser_1.WEBVIEW_DEVICE_CHOOSER_RESPONSE_CHANNEL, async (event, requestId, resolution) => {
        if (!(0, wcvIpcHandlers_1.isAuthorizedHubMainFrameEvent)(event)) {
            throw new Error('Unauthorized webview:device-chooser-response sender');
        }
        if (typeof requestId !== 'string' ||
            requestId.length === 0 ||
            !resolution ||
            typeof resolution !== 'object') {
            return false;
        }
        const { action, deviceId } = resolution;
        if (action === 'claim' || action === 'unclaimed' || action === 'cancel') {
            return deviceChooser_1.deviceChooserController.respond(event.sender, requestId, {
                action,
            });
        }
        if (action === 'select' &&
            typeof deviceId === 'string' &&
            deviceId.length > 0) {
            return deviceChooser_1.deviceChooserController.respond(event.sender, requestId, {
                action: 'select',
                deviceId,
            });
        }
        return false;
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
    electron_1.ipcMain.handle('window:zoom-in', async () => {
        await (0, hubZoom_1.applyHubWindowZoom)(getTargetHubWindow(), 'in');
    });
    electron_1.ipcMain.handle('window:zoom-out', async () => {
        await (0, hubZoom_1.applyHubWindowZoom)(getTargetHubWindow(), 'out');
    });
    electron_1.ipcMain.handle('window:reset-zoom', async () => {
        await (0, hubZoom_1.applyHubWindowZoom)(getTargetHubWindow(), 'reset');
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
    const assertTopLevelSenderId = (event, channel) => {
        if (event?.senderFrame?.parent) {
            throw new Error(`Unauthorized ${channel} sender: subframe cannot invoke ${channel}`);
        }
        const sender = event?.sender;
        if (!sender ||
            sender.isDestroyed?.() ||
            typeof sender.id !== 'number' ||
            !Number.isInteger(sender.id)) {
            throw new Error(`Unauthorized ${channel} sender`);
        }
        return sender.id;
    };
    electron_1.ipcMain.handle('webview:open-download', async (event, downloadId) => {
        const senderId = assertTopLevelSenderId(event, 'webview:open-download');
        if (typeof downloadId !== 'string') {
            throw new Error('downloadId must be a string');
        }
        return (0, webviewBrowser_1.openTrackedWebviewDownload)(senderId, downloadId);
    });
    electron_1.ipcMain.handle('webview:show-download-in-folder', (event, downloadId) => {
        const senderId = assertTopLevelSenderId(event, 'webview:show-download-in-folder');
        if (typeof downloadId !== 'string') {
            throw new Error('downloadId must be a string');
        }
        return (0, webviewBrowser_1.showTrackedWebviewDownloadInFolder)(senderId, downloadId);
    });
    electron_1.ipcMain.handle('webview:cancel-download', (event, downloadId) => {
        const senderId = assertTopLevelSenderId(event, 'webview:cancel-download');
        if (typeof downloadId !== 'string') {
            throw new Error('downloadId must be a string');
        }
        return (0, webviewBrowser_1.cancelTrackedWebviewDownload)(senderId, downloadId);
    });
    electron_1.ipcMain.handle('dialog:select-download-dir', async (event, defaultPath) => {
        assertTopLevelSenderId(event, 'dialog:select-download-dir');
        let resolvedDefaultPath;
        if (typeof defaultPath === 'string' &&
            defaultPath.trim().length > 0 &&
            !defaultPath.includes('\0')) {
            resolvedDefaultPath = defaultPath.trim();
        }
        else {
            try {
                resolvedDefaultPath = electron_1.app.getPath('downloads');
            }
            catch {
                resolvedDefaultPath = undefined;
            }
        }
        const options = {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Download Folder',
            defaultPath: resolvedDefaultPath,
        };
        const owner = electron_1.BrowserWindow.fromWebContents(event.sender);
        const result = owner
            ? await electron_1.dialog.showOpenDialog(owner, options)
            : await electron_1.dialog.showOpenDialog(options);
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        const picked = result.filePaths[0];
        if (typeof picked !== 'string' ||
            picked.includes('\0') ||
            !path.isAbsolute(picked)) {
            return null;
        }
        try {
            return (await fs.stat(picked)).isDirectory() ? picked : null;
        }
        catch {
            return null;
        }
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
        return (0, isolatedWorldExec_1.executeJavaScriptInIsolatedWorldWhenReady)(wc, worldId, [{ code }], false);
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
    electron_1.ipcMain.handle('webview:get-network-requests', (event, webContentsId) => {
        const { wc, sender } = resolveOwnedGuestWebContents(event, webContentsId);
        if (!event?.senderFrame ||
            (sender.mainFrame && event.senderFrame !== sender.mainFrame) ||
            event.senderFrame.parent) {
            throw new Error('webview:get-network-requests must be called from the main frame');
        }
        return guestNetworkController_1.guestNetworkController.getRequests(wc.id);
    });
    electron_1.ipcMain.handle('webview:clear-network-requests', (event, webContentsId) => {
        const { wc, sender } = resolveOwnedGuestWebContents(event, webContentsId);
        if (!event?.senderFrame ||
            (sender.mainFrame && event.senderFrame !== sender.mainFrame) ||
            event.senderFrame.parent) {
            throw new Error('webview:clear-network-requests must be called from the main frame');
        }
        return guestNetworkController_1.guestNetworkController.clearRequests(wc.id);
    });
    const guestOf = (e, id) => {
        const { wc, sender } = resolveOwnedGuestWebContents(e, id);
        const f = e?.senderFrame;
        if (!f || f.parent || (sender.mainFrame && f !== sender.mainFrame)) {
            throw new Error('WebMCP IPC must be called from the main frame');
        }
        return { wc, sender };
    };
    electron_1.ipcMain.handle('webview:webmcp-set-enabled', (event, enabled) => {
        if (!(0, wcvIpcHandlers_1.isAuthorizedHubMainFrameEvent)(event) || typeof enabled !== 'boolean') {
            throw new Error('Invalid webview:webmcp-set-enabled call');
        }
        guestWebMcpController_1.guestWebMcpController.setEnabled(enabled);
        return guestWebMcpController_1.guestWebMcpController.isEnabled();
    });
    electron_1.ipcMain.handle('webview:webmcp-list-tools', (event, webContentsId, origin) => guestWebMcpController_1.guestWebMcpController.listTools(guestOf(event, webContentsId).wc, origin));
    electron_1.ipcMain.handle('webview:webmcp-call-tool', (event, webContentsId, origin, params) => {
        const { wc, sender } = guestOf(event, webContentsId);
        return guestWebMcpController_1.guestWebMcpController.callTool(wc, sender, origin, params);
    });
    electron_1.ipcMain.handle('webview:webmcp-cancel-tool-call', (event, webContentsId, callId) => guestWebMcpController_1.guestWebMcpController.cancelToolCall(webContentsId, callId, guestOf(event, webContentsId).sender.id));
    electron_1.ipcMain.handle('webview:set-dialog-policy', async (event, webContentsId, policy) => {
        const { wc, sender } = resolveOwnedGuestWebContents(event, webContentsId);
        const safePolicy = {
            enabled: Boolean(policy?.enabled),
        };
        if (policy?.action === 'accept' ||
            policy?.action === 'dismiss' ||
            policy?.action === 'manual') {
            safePolicy.action = policy.action;
        }
        if (typeof policy?.promptText === 'string') {
            safePolicy.promptText = policy.promptText;
        }
        if (typeof policy?.tabKey === 'string') {
            safePolicy.tabKey = policy.tabKey;
        }
        if (policy?.fallbackAction === 'accept' ||
            policy?.fallbackAction === 'dismiss') {
            safePolicy.fallbackAction = policy.fallbackAction;
        }
        if (typeof policy?.fallbackPromptText === 'string') {
            safePolicy.fallbackPromptText = policy.fallbackPromptText;
        }
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
    electron_1.ipcMain.removeListener?.(webviewPromptPreload_1.HUMAN_PROMPT_SYNC_CHANNEL, onHumanPromptSync);
    electron_1.ipcMain.on?.(webviewPromptPreload_1.HUMAN_PROMPT_SYNC_CHANNEL, onHumanPromptSync);
    electron_1.ipcMain.removeListener?.(guestPromptController_1.WEBVIEW_PROMPT_SUBSCRIBER_STATE_CHANNEL, onHumanPromptSubscriberState);
    electron_1.ipcMain.on?.(guestPromptController_1.WEBVIEW_PROMPT_SUBSCRIBER_STATE_CHANNEL, onHumanPromptSubscriberState);
    electron_1.ipcMain.handle(guestPromptController_1.WEBVIEW_PROMPT_RESPONSE_CHANNEL, (event, promptId, value) => {
        if (!isMainFramePromptCaller(event)) {
            throw new Error('webview:prompt-response must be called from the main frame');
        }
        return guestPromptController_1.guestPromptController.respondPrompt(event.sender.id, promptId, typeof value === 'string' ? value : null);
    });
    const assertMainFrameSender = (event, channel) => {
        const sender = event?.sender;
        if (!sender ||
            sender.isDestroyed() ||
            !event?.senderFrame ||
            event.senderFrame !== sender.mainFrame ||
            event.senderFrame.parent) {
            throw new Error(`${channel} must be called from the main frame`);
        }
    };
    // The renderer only names a conversation; the uploads root itself is always
    // derived here from the app data dir the Language Server was started with.
    const pinUploadsRoot = (conversationId) => {
        if (typeof conversationId !== 'string' ||
            !SAFE_UPLOAD_CONVERSATION_ID_RE.test(conversationId) ||
            /^\.+$/.test(conversationId)) {
            return '';
        }
        let appDataDir = (0, paths_1.getAppDataDir)();
        try {
            appDataDir = fsSync.realpathSync(appDataDir);
        }
        catch {
            // Upload validation reports the missing directory.
        }
        return path.join(appDataDir, 'brain', conversationId, 'browser_sandbox', 'uploads');
    };
    const resolveMainFrameOwnedGuest = (event, webContentsId, channel) => {
        const { wc, sender } = resolveOwnedGuestWebContents(event, webContentsId);
        assertMainFrameSender(event, channel);
        return { wc, sender };
    };
    electron_1.ipcMain.handle('webview:set-file-chooser-policy', async (event, webContentsId, policy) => {
        const { wc, sender } = resolveMainFrameOwnedGuest(event, webContentsId, 'webview:set-file-chooser-policy');
        return guestFileChooserController_1.guestFileChooserController.setPolicy(wc, sender, {
            enabled: Boolean(policy?.enabled),
            ...(typeof policy?.tabKey === 'string' ? { tabKey: policy.tabKey } : {}),
        });
    });
    electron_1.ipcMain.handle('webview:handle-file-chooser', async (event, webContentsId, decision) => {
        const { wc } = resolveMainFrameOwnedGuest(event, webContentsId, 'webview:handle-file-chooser');
        const pinned = {
            ...(decision ?? { chooserId: '' }),
        };
        if (Array.isArray(pinned.files) && pinned.files.length > 0) {
            pinned.allowedUploadsDir = pinUploadsRoot(pinned.expectedConversationId);
        }
        return guestFileChooserController_1.guestFileChooserController.handleFileChooser(wc, pinned);
    });
    electron_1.ipcMain.handle('webview:set-input-files', async (event, webContentsId, request) => {
        const { wc } = resolveMainFrameOwnedGuest(event, webContentsId, 'webview:set-input-files');
        return guestFileChooserController_1.guestFileChooserController.setInputFiles(wc, {
            ...request,
            allowedUploadsDir: pinUploadsRoot(request?.expectedConversationId),
        });
    });
    electron_1.ipcMain.handle('webview:resolve-upload-files', (event, req) => {
        assertMainFrameSender(event, 'webview:resolve-upload-files');
        return (0, guestFileChooserController_1.resolveGuestUploadFiles)(req && {
            ...req,
            uploadsRoot: pinUploadsRoot(req.expectedConversationId),
        });
    });
    const assertMainFrameGuestCaller = (event, webContentsId, channel) => resolveMainFrameOwnedGuest(event, webContentsId, channel).wc;
    electron_1.ipcMain.handle('webview:list-frames', async (event, wcId) => guestFrameBridge_1.guestFrameBridge.listFrames(assertMainFrameGuestCaller(event, wcId, 'webview:list-frames')));
    electron_1.ipcMain.handle('webview:execute-js-frame-isolated-world', async (event, wcId, frameId, code, expectedOrigin) => {
        const channel = 'webview:execute-js-frame-isolated-world';
        const wc = assertMainFrameGuestCaller(event, wcId, channel);
        return guestFrameBridge_1.guestFrameBridge.executeInFrameIsolatedWorld(wc, frameId, code, expectedOrigin);
    });
    // Execute an untrusted agent script inside a single-use, zero-egress
    // Electron script jail and transfer the paired MessagePort to the caller.
    electron_1.ipcMain.handle('script-jail:run', async (event, req) => {
        return (0, scriptJail_1.runScriptInJail)(event?.sender, req, event?.senderFrame);
    });
    electron_1.ipcMain.handle('script-jail:abort', (event, jailId) => {
        return (0, scriptJail_1.abortScriptInJail)(event?.sender, jailId, event?.senderFrame);
    });
    electron_1.ipcMain.handle('script-jail:warm', async (event) => {
        return (0, scriptJail_1.warmScriptJail)(event?.sender, event?.senderFrame);
    });
    (0, wcvIpcHandlers_1.registerWcvIpcHandlers)(undefined, undefined, storageManager);
}


const contextMenuTranslationMap = {
  // 基础剪贴板与选择
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Select All': '全选',
  'Undo': '撤销',
  'Redo': '重做',
  'Delete': '删除',

  // 项目与工作区右键菜单（项目文件夹）
  'Copy Project Name': '复制项目名称',
  'Copy Project Path': '复制项目路径',
  'Project Settings': '项目设置',
  'Delete Project': '删除项目',
  'Rename Project': '重命名项目',
  'Open Project': '打开项目',
  'Open Folder': '打开文件夹',
  'New Folder': '新建文件夹',
  'Remove Project': '移除项目',
  'Remove from List': '从列表中移除',
  'Project options': '项目选项',

  // 对话列表右键菜单（对话条目）
  'New Conversation': '新建对话',
  'Fork Conversation': '派生对话',
  'Rename': '重命名',
  'Pin': '置顶',
  'Unpin': '取消置顶',
  'Auto Pin': '自动置顶',
  'Mark Unread': '标为未读',
  'Mark Read': '标为已读',
  'Mark as Unread': '标为未读',
  'Mark as Read': '标为已读',
  'Split': '拆分',
  'Split Conversation': '拆分对话',
  'Stop': '停止',
  'Stop Agent': '停止智能体',
  'Resume': '恢复',
  'Restart': '重新启动',
  'Close': '关闭',
  'Close Others': '关闭其他',
  'Close All': '全部关闭',
  'Copy Path': '复制路径',
  'Copy Relative Path': '复制相对路径',
  'Reveal in File Explorer': '在文件资源管理器中显示',
  'Reveal in Finder': '在访达中显示',
  'Open in Terminal': '在终端中打开',
  'View Usage': '查看使用额度',
  'Duplicate': '创建副本',
  'Archive': '归档',
  'Archive Conversation': '归档对话',
  'Unarchive': '取消归档',
  'Unarchive Conversation': '取消归档对话',
  'Share': '分享',
  'Copy Link': '复制链接',
  'Export': '导出',
  'Export Conversation': '导出对话',
  'Clear': '清除',
  'Clear History': '清除历史',
  'Automations': '自动化',
  'Automation': '自动化',
  'Give Feedback': '提供反馈',
  'Provide Feedback': '提供反馈',
  // 顶置对话与排序菜单
  'Sort By': '排序方式',
  'Sort by': '排序方式',
  'Last Updated': '最近更新',
  'Last Prompt': '最新提示词',
  'Custom Order': '自定义排序',
  'Quote': '引用',
  'Quote Ctrl+L': '引用 Ctrl+L',
  'Quote Cmd+L': '引用 Cmd+L',
};
function translateContextLabel(lbl) {
  if (!lbl) return '';
  const trimmed = typeof lbl === 'string' ? lbl.trim() : '';
  return contextMenuTranslationMap[lbl] || contextMenuTranslationMap[trimmed] || lbl;
}
