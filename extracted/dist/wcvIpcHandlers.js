"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWcvIpcHandlers = registerWcvIpcHandlers;
const electron_1 = require("electron");
const utils_1 = require("./utils");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const wcvZOrderController_1 = require("./wcvZOrderController");
function assertAuthorizedWcvCaller(event, registry, tabKey) {
    const sender = event?.sender;
    if (!sender ||
        sender.isDestroyed?.() ||
        (typeof sender.getType === 'function' && sender.getType() !== 'window') ||
        event?.senderFrame?.parent) {
        throw new Error('Unauthorized WCV IPC caller');
    }
    const win = (0, utils_1.resolveHubWindowFromWebContents)(sender);
    if (!win || (0, utils_1.getHubWebContents)(win) !== sender) {
        throw new Error('Unauthorized WCV IPC window sender');
    }
    if (tabKey !== undefined) {
        const entry = registry.getEntry(tabKey);
        if (entry && entry.hubSender.id !== sender.id) {
            throw new Error(`WCV tab ${tabKey} is not owned by calling renderer`);
        }
        const evictedSenderId = !entry
            ? registry.getEvictedSenderId(tabKey)
            : undefined;
        if (evictedSenderId !== undefined && evictedSenderId !== sender.id) {
            throw new Error(`WCV tab ${tabKey} is not owned by calling renderer`);
        }
        return { win, sender, entry };
    }
    return { win, sender };
}
function registerWcvIpcHandlers(registry = wcvBrowserRegistry_1.wcvBrowserRegistry, controller = wcvZOrderController_1.wcvZOrderController) {
    electron_1.ipcMain.handle('wcv:acquire', (event, req) => {
        const { win, sender } = assertAuthorizedWcvCaller(event, registry, req?.tabKey);
        return registry.acquire(win, sender, req).then((snap) => {
            controller.demoteToZ0(req.tabKey, 'tab-acquired');
            return snap;
        });
    });
    electron_1.ipcMain.handle('wcv:show', (event, tabKey, boundsDip) => {
        const { win, sender } = assertAuthorizedWcvCaller(event, registry, tabKey);
        const snap = registry.show(tabKey, boundsDip, win);
        if (snap) {
            controller.demoteWindowToZ0(win, 'tab-shown');
            controller.demoteToZ0(tabKey, 'tab-shown');
            return snap;
        }
        if (registry.hasEvicted(tabKey, sender.id)) {
            return registry
                .rehydrateEvictedAndShow(win, sender, tabKey, boundsDip)
                .then((rehydrated) => {
                if (rehydrated?.visible) {
                    controller.demoteWindowToZ0(win, 'tab-shown');
                    controller.demoteToZ0(tabKey, 'tab-shown');
                }
                return rehydrated;
            });
        }
        return null;
    });
    electron_1.ipcMain.handle('wcv:hide', (event, tabKey) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        controller.demoteToZ0(tabKey, 'tab-hidden');
        registry.hide(tabKey);
    });
    electron_1.ipcMain.handle('wcv:set-bounds', (event, tabKey, boundsDip) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        registry.setBounds(tabKey, boundsDip);
    });
    electron_1.ipcMain.handle('wcv:set-theme-color', (event, color) => {
        const { win } = assertAuthorizedWcvCaller(event, registry);
        return Boolean((0, utils_1.setHubCurtainColor)(win, color));
    });
    electron_1.ipcMain.handle('wcv:set-pinned', (event, tabKey, pinned) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        registry.setPinned(tabKey, pinned);
    });
    electron_1.ipcMain.handle('wcv:set-agent-controlling', (event, tabKey, active) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.setAgentControlling(tabKey, active);
    });
    electron_1.ipcMain.handle('wcv:set-overlay-active', (event, tabKey, active) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.setOverlayActive(tabKey, active);
    });
    electron_1.ipcMain.handle('wcv:set-portal-overlay-open', (event, open) => {
        const { win } = assertAuthorizedWcvCaller(event, registry);
        controller.setPortalOverlayOpen(win, open);
    });
    electron_1.ipcMain.handle('wcv:elevate', (event, tabKey, reason, focusBrowser) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.elevateToZ1(tabKey, reason, focusBrowser);
    });
    electron_1.ipcMain.handle('wcv:set-drag-over', (event, tabKey, active) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.setDragOverActive(tabKey, active);
    });
    electron_1.ipcMain.handle('wcv:demote', (event, tabKey, reason) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.demoteToZ0(tabKey, reason);
    });
    electron_1.ipcMain.handle('wcv:navigate', (event, tabKey, url) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.navigate(tabKey, url);
    });
    electron_1.ipcMain.handle('wcv:control', (event, tabKey, action) => {
        const { entry } = assertAuthorizedWcvCaller(event, registry, tabKey);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry?.view.webContents;
        if (!wc || wc.isDestroyed()) {
            return;
        }
        const history = wc.navigationHistory;
        switch (action) {
            case 'goBack':
            case 'back':
                if (history?.canGoBack) {
                    if (history.canGoBack()) {
                        history.goBack();
                    }
                }
                else if (wc.canGoBack?.()) {
                    wc.goBack?.();
                }
                break;
            case 'goForward':
            case 'forward':
                if (history?.canGoForward) {
                    if (history.canGoForward()) {
                        history.goForward();
                    }
                }
                else if (wc.canGoForward?.()) {
                    wc.goForward?.();
                }
                break;
            case 'reload':
                wc.reload?.();
                break;
            case 'stop':
                wc.stop?.();
                break;
            case 'openDevTools':
                wc.openDevTools?.({ mode: 'detach' });
                break;
            case 'mute':
                registry.setUserMuted(tabKey, true);
                break;
            case 'unmute':
                registry.setUserMuted(tabKey, false);
                break;
            case 'cut':
                wc.cut?.();
                break;
            case 'copy':
                wc.copy?.();
                break;
            case 'paste':
                wc.paste?.();
                break;
            case 'selectAll':
                wc.selectAll?.();
                break;
        }
    });
    electron_1.ipcMain.handle('wcv:send-mouse', (event, tabKey, params) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.dispatchMouseEvent(tabKey, params);
    });
    electron_1.ipcMain.handle('wcv:send-key', (event, tabKey, params) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.dispatchKeyEvent(tabKey, params);
    });
    electron_1.ipcMain.handle('wcv:insert-text', (event, tabKey, text) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.insertText(tabKey, text);
    });
    electron_1.ipcMain.handle('wcv:capture-page', (event, tabKey) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.capturePage(tabKey);
    });
    electron_1.ipcMain.handle('wcv:dispose', (event, tabKey) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        controller.demoteToZ0(tabKey, 'disposed');
        registry.dispose(tabKey);
    });
}
