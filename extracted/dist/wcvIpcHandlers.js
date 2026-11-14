"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAuthorizedHubMainFrameEvent = isAuthorizedHubMainFrameEvent;
exports.registerWcvIpcHandlers = registerWcvIpcHandlers;
const electron_1 = require("electron");
const catcherChannels_1 = require("./catcherChannels");
const utils_1 = require("./utils");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const remoteWindowSecurity_1 = require("./remote/remoteWindowSecurity");
const wcvZOrderController_1 = require("./wcvZOrderController");
const guestPromptController_1 = require("./guestPromptController");
const guestAgentControl_1 = require("./guestAgentControl");
const guestWebMcpController_1 = require("./guestWebMcpController");
const DOWN_BUTTONS = ['left', 'middle', 'right', 'back', 'forward'];
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPositiveInt = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isModifiersMask = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 15;
const isDragButton = (v) => v === 'left' || v === 'middle' || v === 'right';
const isClickCount = (v) => v === 1 || v === 2 || v === 3;
const isDragPhase = (v) => v === 'enter' || v === 'over' || v === 'leave' || v === 'drop';
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isList = (v, max, fn) => Array.isArray(v) && v.length <= max && v.every(fn);
const isDropFile = (f) => isStr(f, 4096) && !f.includes('\0');
const isDropItem = (it) => isPlainObject(it) &&
    isStr(it.mimeType, 256) &&
    typeof it.data === 'string' &&
    it.data.length <= 1048576;
function parseCatcherDragPayload(p) {
    if (!isPlainObject(p) ||
        !isDragPhase(p.phase) ||
        !isFiniteNum(p.x) ||
        !isFiniteNum(p.y) ||
        !isModifiersMask(p.modifiers) ||
        typeof p.hasFiles !== 'boolean' ||
        !isList(p.types, 64, (t) => isStr(t, 256))) {
        return null;
    }
    const { phase, x, y, modifiers, hasFiles } = p;
    const base = {
        phase,
        x,
        y,
        modifiers,
        hasFiles,
        types: [...p.types],
    };
    if (phase !== 'drop') {
        return base;
    }
    if (p.files !== undefined && !isList(p.files, 256, isDropFile)) {
        return null;
    }
    if (p.items !== undefined && !isList(p.items, 64, isDropItem)) {
        return null;
    }
    if (p.files) {
        base.files = [...p.files];
    }
    if (p.items) {
        base.items = p.items.map(({ mimeType, data }) => ({ mimeType, data }));
    }
    return base;
}
function isTopFrameWindowSender(event) {
    const s = event?.sender;
    const f = event?.senderFrame;
    const okType = typeof s?.getType !== 'function' || s.getType() === 'window';
    return Boolean(s &&
        typeof s === 'object' &&
        !s.isDestroyed?.() &&
        okType &&
        !(0, remoteWindowSecurity_1.isRemoteContents)(s) &&
        f &&
        typeof f === 'object' &&
        !f.parent &&
        s.mainFrame &&
        f === s.mainFrame);
}
function resolveAuthorizedCatcherWindow(event) {
    if (!isTopFrameWindowSender(event)) {
        return undefined;
    }
    const win = (0, utils_1.resolveHubWindowFromCatcherWebContents)(event.sender);
    if (!win || win.isDestroyed?.()) {
        return undefined;
    }
    const catcher = (0, utils_1.getHubCatcherView)(win);
    return catcher?.webContents &&
        !catcher.webContents.isDestroyed?.() &&
        catcher.webContents === event.sender
        ? win
        : undefined;
}
function resolveAuthorizedHubCatcherTargetWindow(event) {
    if (!isTopFrameWindowSender(event)) {
        return undefined;
    }
    const win = (0, utils_1.resolveHubWindowFromWebContents)(event.sender);
    if (!win || win.isDestroyed?.() || (0, utils_1.getHubWebContents)(win) !== event.sender) {
        return undefined;
    }
    const catcher = (0, utils_1.getHubCatcherView)(win);
    return catcher?.webContents && !catcher.webContents.isDestroyed?.()
        ? win
        : undefined;
}
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
    if ((0, remoteWindowSecurity_1.isRemoteContents)(s)) {
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
    // Not SSH windows: these tabs use the laptop's browser profiles.
    if ((0, remoteWindowSecurity_1.isRemoteContents)(sender)) {
        throw new Error('Unauthorized WCV IPC caller: SSH window');
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
    const handleChannels = [];
    const registerHandle = (channel, listener) => {
        electron_1.ipcMain.handle(channel, listener);
        handleChannels.push(channel);
    };
    const onListeners = [];
    const registerOn = (channel, fn) => {
        const listener = fn;
        electron_1.ipcMain.on(channel, listener);
        onListeners.push([channel, listener]);
    };
    guestPromptController_1.guestPromptController.setPromptVisibilityListener((tabKey, open) => {
        controller.setHumanPromptOpen(tabKey, open);
    });
    // Latest `wcv:set-agent-controlling(true)` call per tab. A step start that
    // is still waiting for rehydration applies only if no later call (such as
    // the step end) arrived meanwhile, so it cannot leave the tab
    // agent-controlling after the step.
    let agentControllingCalls = 0;
    const latestAgentControllingCall = new Map();
    registerHandle('wcv:acquire', (event, req) => {
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
    registerHandle('wcv:show', (event, tabKey, boundsCss) => {
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
    registerHandle('wcv:hide', (event, tabKey) => {
        const { win } = assertAuthorizedWcvCaller(event, registry, tabKey);
        registry.hide(tabKey);
        controller.revokeFocusGrant(tabKey);
        controller.reconcileWindow(win, 'tab-hidden');
    });
    registerOn('wcv:set-bounds-sync', (event, tabKey, boundsCss) => {
        try {
            const { win, entry } = assertAuthorizedWcvCaller(event, registry, tabKey);
            const apply = () => registry.setBounds(tabKey, hubCssToDip(event, boundsCss));
            if (!(0, utils_1.getHubCatcherView)(win)) {
                apply();
                return;
            }
            const ok = isPlainObject(boundsCss) &&
                [boundsCss.x, boundsCss.y, boundsCss.width, boundsCss.height].every(isFiniteNum);
            if (!ok) {
                return;
            }
            apply();
            if (entry && (0, utils_1.getHubCatcherView)(entry.parentWindow)) {
                controller.syncCatcherSlotBounds(entry.parentWindow);
            }
        }
        catch {
            // Ignore unauthorized one-way callers without crashing main process.
        }
    });
    registerHandle('wcv:set-theme-color', async (event, color) => {
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
    registerHandle('wcv:set-pinned', (event, tabKey, pinned) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        registry.setPinned(tabKey, pinned);
    });
    registerHandle('wcv:set-agent-controlling', async (event, tabKey, active) => {
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
    registerHandle('wcv:set-overlay-active', (event, tabKey, active) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.setOverlayActive(tabKey, active);
    });
    registerHandle('wcv:set-portal-overlay-open', (event, open) => {
        const { win } = assertAuthorizedWcvCaller(event, registry);
        controller.setPortalOverlayOpen(win, open);
    });
    registerHandle('wcv:elevate', (event, tabKey, reason, focusBrowser) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.elevate(tabKey, reason, focusBrowser);
    });
    registerHandle('wcv:set-drag-over', (event, tabKey, active) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.setDragOverActive(tabKey, active);
    });
    registerHandle('wcv:demote', (event, tabKey, reason) => {
        assertAuthorizedWcvCaller(event, registry, tabKey);
        return controller.demote(tabKey, reason);
    });
    registerHandle('wcv:navigate', async (event, tabKey, url) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.navigate(tabKey, url));
    });
    registerHandle('wcv:control', (event, tabKey, action) => {
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
    registerHandle('wcv:send-mouse', async (event, tabKey, params, coordSpace) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.dispatchMouseEvent(tabKey, hubCssMouseToDip(event, params, coordSpace)));
    });
    registerHandle('wcv:send-key', async (event, tabKey, params) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.dispatchKeyEvent(tabKey, params));
    });
    registerHandle('wcv:insert-text', async (event, tabKey, text) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.insertText(tabKey, text));
    });
    registerHandle('wcv:set-viewport-size', (event, tabKey, size) => {
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
    registerHandle('wcv:capture-page', async (event, tabKey) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => controller.capturePage(tabKey));
    });
    registerHandle('wcv:dispose', (event, tabKey) => {
        const { win } = assertAuthorizedWcvCaller(event, registry, tabKey);
        controller.revokeFocusGrant(tabKey);
        registry.dispose(tabKey);
        controller.reconcileWindow(win, 'disposed');
    });
    registerOn(wcvZOrderController_1.WCV_HUB_CURSOR_HOLE_STATE_CHANNEL, (event, p) => {
        const win = resolveAuthorizedHubCatcherTargetWindow(event);
        if (win &&
            isPlainObject(p) &&
            typeof p.isHole === 'boolean' &&
            isFiniteNum(p.dipX) &&
            isFiniteNum(p.dipY) &&
            (p.reason === undefined ||
                p.reason === 'pointermove' ||
                p.reason === 'stationary-overlay' ||
                p.reason === 'dragover')) {
            controller.handleHubCursorHoleState(win, p);
        }
    });
    registerOn(wcvZOrderController_1.WCV_HUB_PROBE_POINT_RESPONSE_CHANNEL, (event, p) => {
        const win = resolveAuthorizedHubCatcherTargetWindow(event);
        if (win &&
            isPlainObject(p) &&
            isPositiveInt(p.requestId) &&
            typeof p.isHole === 'boolean') {
            controller.handleHubProbePointResponse(win, p);
        }
    });
    registerOn(catcherChannels_1.WCV_CATCHER_POINTER_DOWN_CHANNEL, (event, p) => {
        const win = resolveAuthorizedCatcherWindow(event);
        if (win &&
            isPlainObject(p) &&
            isPositiveInt(p.pressId) &&
            isFiniteNum(p.x) &&
            isFiniteNum(p.y) &&
            typeof p.rawButton === 'number' &&
            Number.isInteger(p.rawButton) &&
            p.rawButton >= 0 &&
            p.rawButton <= 4 &&
            DOWN_BUTTONS[p.rawButton] === p.button &&
            isClickCount(p.clickCount) &&
            isModifiersMask(p.modifiers)) {
            void controller.handleCatcherPointerDown(win, p);
        }
    });
    registerOn(catcherChannels_1.WCV_CATCHER_POINTER_MOVE_CHANNEL, (event, p) => {
        const win = resolveAuthorizedCatcherWindow(event);
        if (win &&
            isPlainObject(p) &&
            typeof p.isDragging === 'boolean' &&
            isFiniteNum(p.x) &&
            isFiniteNum(p.y) &&
            isModifiersMask(p.modifiers) &&
            (p.isDragging
                ? isPositiveInt(p.pressId) && isDragButton(p.button)
                : p.pressId === null && p.button === 'none')) {
            controller.handleCatcherPointerMove(win, p);
        }
    });
    registerOn(catcherChannels_1.WCV_CATCHER_POINTER_UP_CHANNEL, (event, p) => {
        const win = resolveAuthorizedCatcherWindow(event);
        if (win &&
            isPlainObject(p) &&
            isPositiveInt(p.pressId) &&
            isFiniteNum(p.x) &&
            isFiniteNum(p.y) &&
            isDragButton(p.button) &&
            isClickCount(p.clickCount) &&
            isModifiersMask(p.modifiers) &&
            typeof p.outOfBounds === 'boolean') {
            void controller.handleCatcherPointerUp(win, p);
        }
    });
    registerOn(catcherChannels_1.WCV_CATCHER_POINTER_LEAVE_CHANNEL, (event) => {
        const win = resolveAuthorizedCatcherWindow(event);
        if (win) {
            controller.handleCatcherPointerLeave(win);
        }
    });
    registerOn(catcherChannels_1.WCV_CATCHER_WHEEL_CHANNEL, (event, p) => {
        const win = resolveAuthorizedCatcherWindow(event);
        if (win &&
            isPlainObject(p) &&
            isFiniteNum(p.x) &&
            isFiniteNum(p.y) &&
            isFiniteNum(p.deltaX) &&
            isFiniteNum(p.deltaY) &&
            isModifiersMask(p.modifiers)) {
            controller.handleCatcherWheel(win, p);
        }
    });
    registerOn(catcherChannels_1.WCV_CATCHER_PINCH_CHANNEL, (event, p) => {
        const win = resolveAuthorizedCatcherWindow(event);
        if (win &&
            isPlainObject(p) &&
            isFiniteNum(p.x) &&
            isFiniteNum(p.y) &&
            isFiniteNum(p.scaleFactor) &&
            p.scaleFactor > 0) {
            controller.handleCatcherPinch(win, p);
        }
    });
    registerOn(catcherChannels_1.WCV_CATCHER_DRAG_CHANNEL, (event, p) => {
        const win = resolveAuthorizedCatcherWindow(event);
        const parsed = win ? parseCatcherDragPayload(p) : null;
        if (win && parsed) {
            void controller.handleCatcherDrag(win, parsed);
        }
    });
    let cleanedUp = false;
    return () => {
        if (cleanedUp) {
            return;
        }
        cleanedUp = true;
        for (const channel of handleChannels) {
            electron_1.ipcMain.removeHandler(channel);
        }
        for (const [channel, listener] of onListeners) {
            electron_1.ipcMain.removeListener(channel, listener);
        }
    };
}
