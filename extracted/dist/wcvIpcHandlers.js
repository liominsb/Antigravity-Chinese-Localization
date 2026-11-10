"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAuthorizedHubMainFrameEvent = isAuthorizedHubMainFrameEvent;
exports.registerWcvIpcHandlers = registerWcvIpcHandlers;
const electron_1 = require("electron");
const utils_1 = require("./utils");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const wcvZOrderController_1 = require("./wcvZOrderController");
const guestPromptController_1 = require("./guestPromptController");
const guestAgentControl_1 = require("./guestAgentControl");
const guestWebMcpController_1 = require("./guestWebMcpController");
function isAuthorizedHubMainFrameEvent(event) {
    const s = event?.sender;
    const f = event?.senderFrame;
    const okType = typeof s?.getType !== 'function' || s.getType() === 'window';
    if (!s || s.isDestroyed?.() || !okType || !f || f.parent) {
        return false;
    }
    if (s.mainFrame && f !== s.mainFrame) {
        return false;
    }
    const win = (0, utils_1.resolveHubWindowFromWebContents)(s);
    const hub = win ? (0, utils_1.getHubWebContents)(win) : undefined;
    return hub === s || (typeof s.id === 'number' && hub?.id === s.id);
}
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
function resolveHubSenderZoomFactor(event) {
    if (event.sender?.isDestroyed?.()) {
        return 1;
    }
    const zoom = event.sender?.getZoomFactor?.();
    return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0
        ? zoom
        : 1;
}
/**
 * Converts a rect the hub renderer measured in its own CSS px into the DIP that
 * `WebContentsView.setBounds` takes. Hub zoom makes one CSS px span
 * `zoomFactor` DIP; a missing or invalid factor is treated as 1.
 */
function hubCssToDip(event, boundsCss) {
    const zoom = resolveHubSenderZoomFactor(event);
    if (zoom === 1) {
        return boundsCss;
    }
    // Round edges rather than sizes so the right/bottom edge cannot drift 1 DIP
    // from the pane it covers.
    const x = Math.round(boundsCss.x * zoom);
    const y = Math.round(boundsCss.y * zoom);
    return {
        x,
        y,
        width: Math.round((boundsCss.x + boundsCss.width) * zoom) - x,
        height: Math.round((boundsCss.y + boundsCss.height) * zoom) - y,
    };
}
/**
 * Converts `WcvCdpMouseParams` measured in hub renderer CSS pixels into guest
 * DIP when `coordSpace === 'hub-css'`, leaving guest-DIP or untagged payloads
 * untouched.
 */
function hubCssMouseToDip(event, params, coordSpace) {
    if (coordSpace !== 'hub-css' || !params || typeof params !== 'object') {
        return params;
    }
    const zoom = resolveHubSenderZoomFactor(event);
    if (zoom === 1) {
        return params;
    }
    const x = typeof params.x === 'number' && Number.isFinite(params.x) && params.x >= 0
        ? Math.round(params.x * zoom)
        : params.x;
    const y = typeof params.y === 'number' && Number.isFinite(params.y) && params.y >= 0
        ? Math.round(params.y * zoom)
        : params.y;
    const scaled = { ...params, x, y };
    if (typeof params.deltaX === 'number' && Number.isFinite(params.deltaX)) {
        scaled.deltaX = Math.round(params.deltaX * zoom) || 0;
    }
    if (typeof params.deltaY === 'number' && Number.isFinite(params.deltaY)) {
        scaled.deltaY = Math.round(params.deltaY * zoom) || 0;
    }
    return scaled;
}
/**
 * Authorizes a tab-scoped agent operation and runs it on a live tab. A hidden
 * tab evicted under the hidden-tab count or memory budget keeps only its URL
 * and title, so CDP input and `capturePage` would silently do nothing;
 * recreate it at its saved URL (or wait for a rehydration already loading)
 * first. The tab stays exempt from eviction until `op` settles.
 */
async function runOnLiveAgentTab(event, registry, tabKey, op) {
    const { win, sender } = assertAuthorizedWcvCaller(event, registry, tabKey);
    return registry.withOperationPin(tabKey, async () => {
        await registry.rehydrateEvicted(win, sender, tabKey);
        return op();
    });
}
function registerWcvIpcHandlers(registry = wcvBrowserRegistry_1.wcvBrowserRegistry, controller = wcvZOrderController_1.wcvZOrderController, storageManager) {
    guestPromptController_1.guestPromptController.setPromptVisibilityListener((tabKey, open) => {
        controller.setHumanPromptOpen(tabKey, open);
    });
    // Latest `wcv:set-agent-controlling(true)` call per tab. A step start that
    // is still waiting for rehydration applies only if no later call (such as
    // the step end) arrived meanwhile, so it cannot leave the tab
    // agent-controlling after the step.
    let agentControllingCalls = 0;
    const latestAgentControllingCall = new Map();
    electron_1.ipcMain.handle('wcv:acquire', (event, req) => {
        const { win, sender } = assertAuthorizedWcvCaller(event, registry, req?.tabKey);
        const { webmcpEnabled, ...rest } = req ?? {};
        if (typeof webmcpEnabled === 'boolean') {
            if (!isAuthorizedHubMainFrameEvent(event)) {
                throw new Error('Unauthorized wcv:acquire webmcpEnabled sender');
            }
            guestWebMcpController_1.guestWebMcpController.setEnabled(webmcpEnabled);
        }
        return registry.acquire(win, sender, rest).then((snap) => {
            controller.reconcileWindow(win, 'tab-acquired');
            return snap;
        });
    });
    electron_1.ipcMain.handle('wcv:show', (event, tabKey, boundsCss) => {
        const { win, sender } = assertAuthorizedWcvCaller(event, registry, tabKey);
        const boundsDip = hubCssToDip(event, boundsCss);
        const snap = registry.show(tabKey, boundsDip, win);
        controller.reconcileWindow(win, 'tab-shown');
        if (snap) {
            return snap;
        }
        if (registry.hasEvicted(tabKey, sender.id)) {
            return registry
                .rehydrateEvictedAndShow(win, sender, tabKey, boundsDip)
                .then((rehydrated) => {
                controller.reconcileWindow(win, 'tab-shown');
                return rehydrated;
            });
        }
        return null;
    });
    electron_1.ipcMain.handle('wcv:hide', (event, tabKey) => {
        const { win } = assertAuthorizedWcvCaller(event, registry, tabKey);
        registry.hide(tabKey);
        controller.revokeFocusGrant(tabKey);
        controller.reconcileWindow(win, 'tab-hidden');
    });
    electron_1.ipcMain.on('wcv:set-bounds-sync', (event, tabKey, boundsCss) => {
        try {
            assertAuthorizedWcvCaller(event, registry, tabKey);
            registry.setBounds(tabKey, hubCssToDip(event, boundsCss));
        }
        catch {
            // Ignore unauthorized one-way callers without crashing main process.
        }
    });
    electron_1.ipcMain.handle('wcv:set-theme-color', async (event, color) => {
        const { win } = assertAuthorizedWcvCaller(event, registry);
        const normalized = (0, utils_1.setHubCurtainColor)(win, color);
        if (!normalized) {
            return false;
        }
        await Promise.resolve(storageManager?.updateItems({
            [utils_1.HUB_SURFACE_COLOR_STORAGE_KEY]: normalized,
        })).catch(() => undefined);
        return true;
    });
    electron_1.ipcMain.handle('wcv:set-pinned', (event, tabKey, pinned) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        registry.setPinned(tabKey, pinned);
    });
    electron_1.ipcMain.handle('wcv:set-agent-controlling', async (event, tabKey, active) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        if (!active) {
            latestAgentControllingCall.delete(tabKey);
            return controller.setAgentControlling(tabKey, false);
        }
        const call = ++agentControllingCalls;
        latestAgentControllingCall.set(tabKey, call);
        // Rehydrating at step start also lets the step-active flag protect the
        // tab from eviction for the rest of the step.
        return runOnLiveAgentTab(event, registry, tabKey, () => {
            if (latestAgentControllingCall.get(tabKey) !== call) {
                return controller.getState(tabKey);
            }
            latestAgentControllingCall.delete(tabKey);
            return controller.setAgentControlling(tabKey, true);
        });
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
        return controller.elevate(tabKey, reason, focusBrowser);
    });
    electron_1.ipcMain.handle('wcv:set-drag-over', (event, tabKey, active) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.setDragOverActive(tabKey, active);
    });
    electron_1.ipcMain.handle('wcv:demote', (event, tabKey, reason) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.demote(tabKey, reason);
    });
    electron_1.ipcMain.handle('wcv:navigate', async (event, tabKey, url) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.navigate(tabKey, url));
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
                // Agent-driven tabs must never expose a DevTools surface.
                if (!(0, guestAgentControl_1.isGuestAgentControlled)(wc.id)) {
                    wc.openDevTools?.({ mode: 'detach' });
                }
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
    electron_1.ipcMain.handle('wcv:send-mouse', async (event, tabKey, params, coordSpace) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.dispatchMouseEvent(tabKey, hubCssMouseToDip(event, params, coordSpace)));
    });
    electron_1.ipcMain.handle('wcv:send-key', async (event, tabKey, params) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.dispatchKeyEvent(tabKey, params));
    });
    electron_1.ipcMain.handle('wcv:insert-text', async (event, tabKey, text) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.insertText(tabKey, text));
    });
    electron_1.ipcMain.handle('wcv:set-viewport-size', (event, tabKey, size) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        if (size !== null &&
            (!size ||
                typeof size !== 'object' ||
                typeof size.width !== 'number' ||
                typeof size.height !== 'number' ||
                !Number.isFinite(size.width) ||
                !Number.isFinite(size.height))) {
            throw new Error('Invalid WCV viewport size');
        }
        return controller.setViewportSize(tabKey, size);
    });
    electron_1.ipcMain.handle('wcv:capture-page', async (event, tabKey) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.capturePage(tabKey));
    });
    electron_1.ipcMain.handle('wcv:dispose', (event, tabKey) => {
        const { win } = assertAuthorizedWcvCaller(event, registry, tabKey);
        controller.revokeFocusGrant(tabKey);
        registry.dispose(tabKey);
        controller.reconcileWindow(win, 'disposed');
    });
}
