"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchWcvRemoteControlCommand = exports.onWcvAgentCursorStateChanged = exports.getWcvAgentCursorState = exports.WCV_REMOTE_CONTROL_COMMAND_TIMEOUT_MS = exports.WCV_RECLAIM_REMOTE_CONTROL_CHANNEL = exports.WCV_REMOTE_CONTROL_COMMAND_ACK_CHANNEL = exports.WCV_REMOTE_CONTROL_COMMAND_CHANNEL = exports.WCV_PUSH_CURSOR_STATE_CHANNEL = void 0;
exports.isAuthorizedHubMainFrameEvent = isAuthorizedHubMainFrameEvent;
exports.registerWcvIpcHandlers = registerWcvIpcHandlers;
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const catcherChannels_1 = require("./catcherChannels");
const utils_1 = require("./utils");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const remoteWindowSecurity_1 = require("./remote/remoteWindowSecurity");
const wcvZOrderController_1 = require("./wcvZOrderController");
const guestPromptController_1 = require("./guestPromptController");
const guestAgentControl_1 = require("./guestAgentControl");
const guestWebMcpController_1 = require("./guestWebMcpController");
exports.WCV_PUSH_CURSOR_STATE_CHANNEL = 'wcv:push-cursor-state';
exports.WCV_REMOTE_CONTROL_COMMAND_CHANNEL = 'wcv:remote-control-command';
exports.WCV_REMOTE_CONTROL_COMMAND_ACK_CHANNEL = 'wcv:remote-control-command-ack';
exports.WCV_RECLAIM_REMOTE_CONTROL_CHANNEL = 'wcv:reclaim-remote-control';
exports.WCV_REMOTE_CONTROL_COMMAND_TIMEOUT_MS = 5000;
const DOWN_BUTTONS = ['left', 'middle', 'right', 'back', 'forward'];
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPositiveInt = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isModifiersMask = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 15;
const isDragButton = (v) => v === 'left' || v === 'middle' || v === 'right';
const isClickCount = (v) => v === 1 || v === 2 || v === 3;
const isDragPhase = (v) => v === 'enter' || v === 'over' || v === 'leave' || v === 'drop';
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
// Toolkit tab keys are `builtin-browser:<conversationId>:<tabId>` (~90 chars);
// 256 matches this file's other identifier-string caps.
const isTabKey = (v) => isStr(v, 256);
const CURSOR_PHASES = new Set('idle|browsing|clicking|scrolling|typing|thinking|loading|done'.split('|'));
const C_KEYS = ['active', 'x', 'y', 'phase', 'clickSeq', 'intent', 'label'];
const isOpt = (v, n = 512) => v === undefined || (typeof v === 'string' && v.length <= n);
const parseCursor = (p) => isPlainObject(p) &&
    typeof p.active === 'boolean' &&
    [p.x, p.y].every(isFiniteNum) &&
    CURSOR_PHASES.has(p.phase) &&
    Number.isInteger(p.clickSeq) &&
    p.clickSeq >= 0 &&
    [p.intent, p.label].every((v) => isOpt(v))
    ? Object.fromEntries(C_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))
    : null;
const isFindOptions = (v) => isPlainObject(v) &&
    typeof v.forward === 'boolean' &&
    typeof v.findNext === 'boolean' &&
    typeof v.matchCase === 'boolean';
const isStopFindAction = (v) => v === 'clearSelection' || v === 'keepSelection' || v === 'activateSelection';
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
 * Validates renderer-supplied `WcvBoundsOptions` and scales the content size
 * from hub CSS px to DIP. Returns undefined when no valid field remains.
 */
function hubCssBoundsOptionsToDip(event, rawOptions) {
    if (!isPlainObject(rawOptions)) {
        return undefined;
    }
    const zoom = resolveHubSenderZoomFactor(event);
    const toDip = (v) => {
        const dip = isFiniteNum(v) && v > 0
            ? Math.min(wcvZOrderController_1.MAX_VIEWPORT_DIMENSION, Math.round(v * zoom))
            : 0;
        return dip > 0 ? dip : undefined;
    };
    const contentWidth = toDip(rawOptions.contentWidth);
    const contentHeight = toDip(rawOptions.contentHeight);
    const { isTransitioning } = rawOptions;
    const options = {};
    if (contentWidth !== undefined) {
        options.contentWidth = contentWidth;
    }
    if (contentHeight !== undefined) {
        options.contentHeight = contentHeight;
    }
    if (typeof isTransitioning === 'boolean') {
        options.isTransitioning = isTransitioning;
    }
    return Object.keys(options).length > 0 ? options : undefined;
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
const failCmd = (error, errorCode = 'FAILED_PRECONDITION') => ({ ok: false, errorCode, error });
const isDead = (x) => !!x?.isDestroyed?.();
const isLive = (e, allowCrash = false) => !!e?.hubSender &&
    (allowCrash || !e.crashed) &&
    ![e.view?.webContents, e.parentWindow, e.hubSender].some(isDead);
function makeBridge(r) {
    let tok = 0;
    const cursors = new Map();
    const ls = new Set();
    const pending = new Map();
    const hooks = [new WeakSet(), new WeakSet()];
    const emit = (k, s) => [...ls].forEach((fn) => {
        try {
            fn(k, s ? { ...s } : null);
        }
        catch {
            /* ignore */
        }
    });
    const drop = (k) => void (cursors.delete(k) && emit(k, null));
    const settle = (id, res, p = pending.get(id)) => Boolean(p && (pending.delete(id), clearTimeout(p.t), p.r(res), 1));
    const watch = (o, f, ev) => (ev ? [ev] : ['destroyed', 'render-process-gone']).forEach((e, i) => {
        const em = o;
        if (typeof em?.once === 'function' && !hooks[i].has(em)) {
            hooks[i].add(em);
            em.once(e, () => (hooks[i].delete(em), tok > 0 && f()));
        }
    });
    const purge = (m, hit, end) => {
        tok = end ? -Math.abs(tok) : tok;
        sweep((e) => hit(e.hubSender, e.parentWindow));
        [...pending].forEach(([id, p]) => hit(p.s, p.w) && settle(id, failCmd(m)));
        return end && ls.clear();
    };
    const hookHost = (s, w) => {
        watch(s, () => purge('Renderer closed', (x) => x === s || x.id === s.id));
        watch(w, () => purge('Window closed', (_s, x) => x === w), 'closed');
    };
    const sweep = (f) => {
        for (const [k, c] of [...cursors]) {
            const [e, id] = [r.getEntry(k), c.webContentsId];
            if (tok <= 0 || !isLive(e) || e.webContentsId !== id || f?.(e, id)) {
                drop(k);
            }
            else {
                c.hubSenderId = e.hubSender.id;
                watch(e.view?.webContents, () => sweep((_e, x) => x === id));
                hookHost(e.hubSender, e.parentWindow);
            }
        }
    };
    const push = (k, raw) => {
        const state = isTabKey(k) ? parseCursor(raw) : null;
        if (!isTabKey(k) || !state) {
            throw new Error('Invalid WCV cursor state');
        }
        const e = tok > 0 ? r.getEntry(k) : undefined;
        if (!isLive(e)) {
            return tok > 0 && (drop(k), sweep());
        }
        const { webContentsId, hubSender } = e;
        cursors.set(k, { state, webContentsId, hubSenderId: hubSender.id });
        sweep();
        return cursors.has(k) && emit(k, state);
    };
    const get = (k, c = (sweep(), tok > 0 && isTabKey(k) ? cursors.get(k) : null)) => (c ? { ...c.state } : null);
    const sub = (fn) => (ls.add(fn), () => void ls.delete(fn));
    const ack = (senderId, a) => {
        if (!isPlainObject(a) ||
            !isStr(a.requestId, 128) ||
            typeof a.ok !== 'boolean' ||
            !isOpt(a.error, 1024)) {
            throw new Error('Invalid WCV remote-control command ack');
        }
        const p = pending.get(a.requestId);
        const err = a.error || 'Remote-control command failed';
        const res = a.ok ? { ok: true } : failCmd(err);
        return !!(p && senderId === p.s.id && settle(a.requestId, res));
    };
    const send = (k, c, ms) => {
        const ok = tok > 0 && c === 'STOP' && isTabKey(k) && isFiniteNum(ms);
        const e = ok && ms > 0 ? r.getEntry(k) : undefined;
        if (!isLive(e, true) || typeof e.hubSender.send !== 'function') {
            return Promise.resolve(failCmd('Cannot dispatch command'));
        }
        const [id, s, w] = [(0, crypto_1.randomUUID)(), e.hubSender, e.parentWindow];
        return new Promise((res) => {
            const onT = () => settle(id, failCmd('Timed out', 'DEADLINE_EXCEEDED'));
            pending.set(id, { s, w, t: setTimeout(onT, ms), r: res });
            hookHost(s, w);
            try {
                const cmd = { requestId: id, command: 'STOP', tabKey: k };
                s.send(exports.WCV_REMOTE_CONTROL_COMMAND_CHANNEL, cmd);
            }
            catch (err) {
                settle(id, failCmd(err instanceof Error ? err.message : 'Send failed'));
            }
        });
    };
    const close = () => purge('Closed', () => true, 1);
    const on = (t = (tok > 0 && close(), (tok = Math.abs(tok) + 1))) => () => tok === t && (close(), bridges.delete(r));
    return { on, sweep, push, get, sub, ack, send };
}
const DEF_REG = wcvBrowserRegistry_1.wcvBrowserRegistry;
const bridges = new WeakMap();
const getBridge = (r) => bridges.get(r) ?? bridges.set(r, makeBridge(r)).get(r);
const requireMainFrame = (ev) => {
    if (!isAuthorizedHubMainFrameEvent(ev)) {
        const s = ev?.sender && (0, remoteWindowSecurity_1.isRemoteContents)(ev.sender) ? ': SSH window' : '';
        throw new Error(`Unauthorized WCV IPC caller${s}`);
    }
};
const getCursor = (k, r = DEF_REG) => bridges.get(r)?.get(k) ?? null;
exports.getWcvAgentCursorState = getCursor;
const onCursor = (fn, r = DEF_REG) => getBridge(r).sub(fn);
exports.onWcvAgentCursorStateChanged = onCursor;
const sendCmd = (k, c, r = DEF_REG, ms = 5000) => bridges.get(r)?.send(k, c, ms) ?? Promise.resolve(failCmd('Inactive'));
exports.dispatchWcvRemoteControlCommand = sendCmd;
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
    const bridge = getBridge(registry);
    const stopBridge = bridge.on();
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
            bridge.sweep();
            controller.reconcileWindow(win, 'tab-acquired');
            return snap;
        });
    });
    registerHandle('wcv:show', (event, tabKey, boundsCss, optionsCss) => {
        const { win, sender } = assertAuthorizedWcvCaller(event, registry, tabKey);
        const boundsDip = hubCssToDip(event, boundsCss);
        // Two-layer windows have no clip to slide, so they ignore options.
        const optionsDip = (0, utils_1.getHubClipView)(win) || (0, utils_1.getHubCatcherView)(win)
            ? hubCssBoundsOptionsToDip(event, optionsCss)
            : undefined;
        const snap = optionsDip !== undefined
            ? registry.show(tabKey, boundsDip, win, optionsDip)
            : registry.show(tabKey, boundsDip, win);
        controller.reconcileWindow(win, 'tab-shown');
        if (snap) {
            return snap;
        }
        if (registry.hasEvicted(tabKey, sender.id)) {
            return (optionsDip !== undefined
                ? registry.rehydrateEvictedAndShow(win, sender, tabKey, boundsDip, optionsDip)
                : registry.rehydrateEvictedAndShow(win, sender, tabKey, boundsDip)).then((rehydrated) => {
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
    registerOn('wcv:set-bounds-sync', (event, tabKey, boundsCss, optionsCss) => {
        try {
            const { win, entry } = assertAuthorizedWcvCaller(event, registry, tabKey);
            const apply = () => {
                const boundsDip = hubCssToDip(event, boundsCss);
                const optionsDip = (0, utils_1.getHubClipView)(win) || (0, utils_1.getHubCatcherView)(win)
                    ? hubCssBoundsOptionsToDip(event, optionsCss)
                    : undefined;
                if (optionsDip !== undefined) {
                    registry.setBounds(tabKey, boundsDip, optionsDip);
                }
                else {
                    registry.setBounds(tabKey, boundsDip);
                }
            };
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
    registerHandle('wcv:find', (event, tabKey, text, options, token) => {
        assertAuthorizedWcvCaller(event, registry, isTabKey(tabKey) ? tabKey : undefined);
        if (!isTabKey(tabKey) ||
            !isStr(text, wcvBrowserRegistry_1.MAX_WCV_FIND_TEXT_LENGTH) ||
            !isFindOptions(options) ||
            !isFiniteNum(token)) {
            throw new Error('Invalid WCV find request');
        }
        registry.find(tabKey, text, options, token);
    });
    registerHandle('wcv:stop-find', (event, tabKey, action) => {
        assertAuthorizedWcvCaller(event, registry, isTabKey(tabKey) ? tabKey : undefined);
        if (!isTabKey(tabKey) || !isStopFindAction(action)) {
            throw new Error('Invalid WCV stop-find request');
        }
        registry.stopFind(tabKey, action);
    });
    registerHandle('wcv:focus-hub', (event, tabKey) => {
        assertAuthorizedWcvCaller(event, registry, isTabKey(tabKey) ? tabKey : undefined);
        if (!isTabKey(tabKey)) {
            throw new Error('Invalid WCV focus-hub request');
        }
        controller.focusHub(tabKey);
    });
    const revokeRemoteOnLocalUserOp = (tabKey) => {
        if (!registry.getEntry(tabKey)?.isAgentStepActive) {
            registry.requestRemoteControlRevocation(tabKey, 'local-user-interaction');
        }
    };
    registerHandle('wcv:navigate', async (event, tabKey, url) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => {
            revokeRemoteOnLocalUserOp(tabKey);
            return controller.navigate(tabKey, url);
        });
    });
    registerHandle('wcv:control', (event, tabKey, action) => {
        const { entry } = assertAuthorizedWcvCaller(event, registry, tabKey);
        revokeRemoteOnLocalUserOp(tabKey);
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
        return runOnLiveAgentTab(event, registry, tabKey, () => {
            revokeRemoteOnLocalUserOp(tabKey);
            return controller.dispatchMouseEvent(tabKey, hubCssMouseToDip(event, params, coordSpace));
        });
    });
    registerHandle('wcv:send-key', async (event, tabKey, params) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => {
            revokeRemoteOnLocalUserOp(tabKey);
            return controller.dispatchKeyEvent(tabKey, params);
        });
    });
    registerHandle('wcv:insert-text', async (event, tabKey, text) => {
        return runOnLiveAgentTab(event, registry, tabKey, () => {
            revokeRemoteOnLocalUserOp(tabKey);
            return controller.insertText(tabKey, text);
        });
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
        bridge.sweep();
        controller.reconcileWindow(win, 'disposed');
    });
    registerHandle(exports.WCV_PUSH_CURSOR_STATE_CHANNEL, (ev, k, raw) => (assertAuthorizedWcvCaller(ev, registry, isTabKey(k) ? k : undefined),
        requireMainFrame(ev),
        void bridge.push(k, raw)));
    registerHandle(exports.WCV_REMOTE_CONTROL_COMMAND_ACK_CHANNEL, (ev, a) => (requireMainFrame(ev), bridge.ack(ev.sender.id, a)));
    registerHandle(exports.WCV_RECLAIM_REMOTE_CONTROL_CHANNEL, (ev, k, rawOpts) => {
        assertAuthorizedWcvCaller(ev, registry, isTabKey(k) ? k : undefined);
        requireMainFrame(ev);
        if (!isTabKey(k) ||
            (rawOpts !== undefined &&
                (!isPlainObject(rawOpts) ||
                    (rawOpts.disconnectStream !== undefined &&
                        typeof rawOpts.disconnectStream !== 'boolean')))) {
            throw new Error('Invalid WCV reclaim-remote-control request');
        }
        if (isPlainObject(rawOpts) && rawOpts.disconnectStream === true) {
            registry.requestRemoteStreamDisconnect(k);
            return;
        }
        registry.requestRemoteControlRevocation(k, 'local-reclaim');
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
        stopBridge();
        for (const channel of handleChannels) {
            electron_1.ipcMain.removeHandler(channel);
        }
        for (const [channel, listener] of onListeners) {
            electron_1.ipcMain.removeListener(channel, listener);
        }
    };
}
