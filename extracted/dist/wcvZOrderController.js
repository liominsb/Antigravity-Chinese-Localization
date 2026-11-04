"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wcvZOrderController = exports.WcvZOrderController = exports.NON_ELEVATED_POPUP_SUPPRESSION_CSS = exports.POPUP_GUARD_ISOLATED_WORLD_ID = exports.CAPTURE_RETRY_MS = exports.WCV_CURSOR_CHANGED_CHANNEL = exports.WCV_SHORTCUT_FORWARDED_CHANNEL = exports.WCV_Z_ORDER_CHANGED_CHANNEL = void 0;
const guestDialogController_1 = require("./guestDialogController");
const utils_1 = require("./utils");
const webviewBrowser_1 = require("./webviewBrowser");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
exports.WCV_Z_ORDER_CHANGED_CHANNEL = 'wcv:z-order-changed';
exports.WCV_SHORTCUT_FORWARDED_CHANNEL = 'wcv:shortcut-forwarded';
exports.WCV_CURSOR_CHANGED_CHANNEL = 'wcv:cursor-changed';
/** Delay before the single capturePage() retry, about two frames at 60 Hz. */
exports.CAPTURE_RETRY_MS = 35;
/**
 * Isolated V8 world ID used to suppress native OS color/file/date picker
 * activation while a `WebContentsView` is hidden or at `z=0`, without touching
 * main-world globals or DOM prototypes.
 */
exports.POPUP_GUARD_ISOLATED_WORLD_ID = 9997;
/**
 * User-origin stylesheet active while a `WebContentsView` is not elevated at
 * `z=1`. Renders single-select dropdown menus in-page (`appearance: base-select`)
 * inside the view's own compositor surface (so `curtainView` / `hubWcv` occlude
 * them and `capturePage()` captures the open option list) and hides the
 * external OS calendar/time indicator button.
 */
exports.NON_ELEVATED_POPUP_SUPPRESSION_CSS = [
    'select:not([multiple]):not([size]),',
    'select:not([multiple])[size="1"] { appearance: base-select !important; }',
    'select:not([multiple]):not([size])::picker(select),',
    'select:not([multiple])[size="1"]::picker(select) { appearance: base-select !important; background-color: Canvas; color: CanvasText; }',
    'input::-webkit-calendar-picker-indicator { display: none !important; pointer-events: none !important; }',
    'input[type="color" i] { pointer-events: none !important; }',
].join('\n');
function buildIsolatedWorldPopupGuardScript(suppress) {
    const flag = suppress ? 'true' : 'false';
    return `(() => {
    window.__wcvSuppressNativePopups = ${flag};
    if (window.__wcvPopupGuardInstalled) return;
    window.__wcvPopupGuardInstalled = true;
    const isBlockedPickerInput = (node) => {
      if (!node || node.tagName !== 'INPUT') return false;
      const t = (node.type || '').toLowerCase();
      return t === 'color' || t === 'file';
    };
    const isDateLikeInput = (node) => {
      if (!node || node.tagName !== 'INPUT') return false;
      const t = (node.type || '').toLowerCase();
      return t === 'date' || t === 'time' || t === 'datetime-local' || t === 'month' || t === 'week';
    };
    const resolveTarget = (e) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
      const target = (path && path.length > 0 ? path[0] : null) || e.target;
      return target && target.nodeType === 3 ? target.parentElement : target;
    };
    window.addEventListener('click', (e) => {
      if (!window.__wcvSuppressNativePopups) return;
      const raw = resolveTarget(e);
      const labelControl = raw && typeof raw.closest === 'function' ? raw.closest('label')?.control : null;
      if (isBlockedPickerInput(raw) || isBlockedPickerInput(labelControl)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    window.addEventListener('keydown', (e) => {
      if (!window.__wcvSuppressNativePopups) return;
      const raw = resolveTarget(e);
      const labelControl = raw && typeof raw.closest === 'function' ? raw.closest('label')?.control : null;
      if ((isBlockedPickerInput(raw) || isBlockedPickerInput(labelControl)) && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (isDateLikeInput(raw) && ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  })()`;
}
const HUB_GLOBAL_SHORTCUT_KEYS = new Set(['l', 't', 'w', 'k', ',', 'b', 'q']);
const contentViewOf = (win) => !win || win.isDestroyed?.()
    ? undefined
    : win.contentView;
/** Coordinates the `"Focus == Z-Order"` state machine and main-process CDP session for `browserWcv`. */
class WcvZOrderController {
    constructor(registry = wcvBrowserRegistry_1.wcvBrowserRegistry, dialogController = guestDialogController_1.guestDialogController, options) {
        this.registry = registry;
        this.dialogController = dialogController;
        this.tabStates = new Map();
        this.windowPortalOpen = new WeakMap();
        this.trackedWindows = new WeakSet();
        this.pageEnableTimeoutMs =
            options?.pageEnableTimeoutMs ?? guestDialogController_1.DEFAULT_PAGE_ENABLE_TIMEOUT_MS;
    }
    ensureRecord(entry) {
        let rec = this.tabStates.get(entry.tabKey);
        let isNewOrReplaced = false;
        if (!rec) {
            rec = {
                webContentsId: entry.webContentsId,
                zOrder: 0,
                userElevationLatch: false,
                dragElevationActive: false,
                overlayActive: false,
            };
            this.tabStates.set(entry.tabKey, rec);
            isNewOrReplaced = true;
        }
        else if (rec.webContentsId !== entry.webContentsId) {
            rec.webContentsId = entry.webContentsId;
            rec.zOrder = 0;
            rec.userElevationLatch = false;
            rec.dragElevationActive = false;
            rec.overlayActive = false;
            rec.listenersAttached = false;
            rec.cdpAttached = false;
            rec.cdpAttachEpoch = (rec.cdpAttachEpoch ?? 0) + 1;
            rec.cdpAttachInFlight = undefined;
            rec.popupSuppressionCssKey = undefined;
            rec.popupSuppressionCssInFlight = undefined;
            rec.popupCssGeneration = 0;
            rec.isolatedGuardSuppressed = undefined;
            rec.isolatedGuardInFlight = undefined;
            rec.fileChooserIntercepted = undefined;
            isNewOrReplaced = true;
        }
        this.attachWindowHooks(entry.parentWindow);
        this.attachGuestHooks(entry, rec);
        if (isNewOrReplaced) {
            void this.syncPopupSuppression(entry, rec);
        }
        return rec;
    }
    getState(tabKey) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        return {
            tabKey,
            zOrder: rec.zOrder,
            userElevationLatch: rec.userElevationLatch,
            dragElevationActive: rec.dragElevationActive,
            overlayActive: rec.overlayActive,
            portalOverlayOpen: Boolean(this.windowPortalOpen.get(entry.parentWindow)),
            isAgentStepActive: Boolean(entry.isAgentStepActive),
        };
    }
    isElevationBlocked(entry, rec) {
        return Boolean(!entry.visible ||
            entry.isAgentStepActive ||
            rec.overlayActive ||
            this.windowPortalOpen.get(entry.parentWindow));
    }
    demoteSiblingTabs(entry) {
        for (const [otherKey, otherRec] of this.tabStates.entries()) {
            if (otherKey !== entry.tabKey && otherRec.zOrder === 1) {
                const otherEntry = this.registry.getEntry(otherKey);
                if (otherEntry && otherEntry.parentWindow === entry.parentWindow) {
                    this.applyDemotion(otherEntry, otherRec, 'sibling-tab-elevated');
                }
            }
        }
    }
    /** `T1`: Elevates `browserWcv` to `z=1` (`State B`) on explicit user activation inside `[data-browser-hole]`. */
    elevateToZ1(tabKey, reason = 'pointerdown', focusBrowser = true) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        if (this.isElevationBlocked(entry, rec)) {
            this.applyDemotion(entry, rec, 'blocked-by-overlay-or-agent');
            return this.getState(tabKey);
        }
        this.demoteSiblingTabs(entry);
        rec.userElevationLatch = focusBrowser || rec.userElevationLatch;
        rec.zOrder = 1;
        void this.syncPopupSuppression(entry, rec);
        contentViewOf(entry.parentWindow)?.addChildView?.(entry.view);
        if (focusBrowser) {
            entry.view.webContents.focus?.();
        }
        this.emitZOrderChanged(entry, rec.zOrder, reason);
        return this.getState(tabKey);
    }
    /** `T2`: Elevates `browserWcv` to `z=1` during an external OS file drag over `[data-browser-hole]`. */
    setDragOverActive(tabKey, active) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        if (active) {
            if (this.isElevationBlocked(entry, rec)) {
                return this.getState(tabKey);
            }
            this.demoteSiblingTabs(entry);
            rec.dragElevationActive = true;
            rec.zOrder = 1;
            void this.syncPopupSuppression(entry, rec);
            contentViewOf(entry.parentWindow)?.addChildView?.(entry.view);
            this.emitZOrderChanged(entry, 1, 'dragenter');
            return this.getState(tabKey);
        }
        rec.dragElevationActive = false;
        rec.userElevationLatch = false;
        this.applyDemotion(entry, rec, 'drag-ended');
        return this.getState(tabKey);
    }
    /** `T3`: Demotes `browserWcv` back to `z=0` (`State A`) by placing `hubWcv` at the top of `contentView`. */
    demoteToZ0(tabKey, reason = 'hub-interaction') {
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        this.applyDemotion(entry, this.ensureRecord(entry), reason);
        return this.getState(tabKey);
    }
    demoteWindowToZ0(win, reason) {
        for (const [tabKey, rec] of this.tabStates.entries()) {
            const entry = this.registry.getEntry(tabKey);
            if (!entry) {
                this.tabStates.delete(tabKey);
                continue;
            }
            if (entry.parentWindow === win &&
                (rec.zOrder === 1 || rec.userElevationLatch || rec.dragElevationActive)) {
                this.applyDemotion(entry, rec, reason);
            }
        }
    }
    clearWindowElevationBlockers(win, reason) {
        this.windowPortalOpen.set(win, false);
        for (const [tabKey, rec] of this.tabStates.entries()) {
            const entry = this.registry.getEntry(tabKey);
            if (!entry) {
                this.tabStates.delete(tabKey);
                continue;
            }
            if (entry.parentWindow === win) {
                this.registry.setAgentStepActive(tabKey, false);
                rec.overlayActive = false;
                this.applyDemotion(entry, rec, reason);
            }
        }
    }
    setOverlayActive(tabKey, active) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        rec.overlayActive = Boolean(active);
        if (rec.overlayActive) {
            this.applyDemotion(entry, rec, 'overlay-active');
        }
        return this.getState(tabKey);
    }
    setPortalOverlayOpen(win, open) {
        this.windowPortalOpen.set(win, Boolean(open));
        if (open) {
            this.demoteWindowToZ0(win, 'portal-overlay-open');
        }
    }
    setAgentControlling(tabKey, active) {
        this.registry.setAgentStepActive(tabKey, active);
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        if (active) {
            this.applyDemotion(entry, rec, 'agent-controlling');
            void this.ensureCdpAttached(entry);
        }
        return this.getState(tabKey);
    }
    async ensureCdpAttached(entry) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        if (!wc || wc.isDestroyed?.()) {
            return;
        }
        const rec = this.ensureRecord(entry);
        const dbg = wc.debugger;
        if (!dbg) {
            return;
        }
        if (typeof wc.getURL === 'function' && (wc.getURL() ?? '').trim() === '') {
            return;
        }
        if (!dbg.isAttached?.()) {
            try {
                dbg.attach('1.3');
            }
            catch {
                // Already attached.
            }
        }
        if (!rec.cdpAttached) {
            if (rec.cdpAttachInFlight) {
                await rec.cdpAttachInFlight;
            }
            else if (typeof dbg.sendCommand !== 'function') {
                rec.cdpAttached = true;
            }
            else {
                const epoch = rec.cdpAttachEpoch ?? 0;
                let timer;
                const inFlight = (async () => {
                    try {
                        const sendFailed = Symbol('cdp-page-enable-failed');
                        const timedOut = Symbol('cdp-page-enable-timeout');
                        const result = await Promise.race([
                            Promise.resolve(dbg.sendCommand('Page.enable')).catch(() => sendFailed),
                            new Promise((resolve) => {
                                timer = setTimeout(() => resolve(timedOut), this.pageEnableTimeoutMs);
                            }),
                        ]);
                        if (result !== sendFailed &&
                            result !== timedOut &&
                            (rec.cdpAttachEpoch ?? 0) === epoch &&
                            !wc.isDestroyed?.()) {
                            rec.cdpAttached = true;
                        }
                    }
                    finally {
                        if (timer !== undefined) {
                            clearTimeout(timer);
                        }
                    }
                })();
                const tracked = inFlight.finally(() => {
                    if (rec.cdpAttachInFlight === tracked) {
                        rec.cdpAttachInFlight = undefined;
                    }
                });
                rec.cdpAttachInFlight = tracked;
                await tracked;
            }
        }
        await this.syncFileChooserInterception(entry, rec);
    }
    shouldSuppressNativePopups(entry, rec) {
        return !entry.visible || rec.zOrder !== 1;
    }
    async syncFileChooserInterception(entry, rec) {
        if (!rec.cdpAttached || entry.view.webContents.isDestroyed()) {
            return;
        }
        const suppress = this.shouldSuppressNativePopups(entry, rec);
        if (rec.fileChooserIntercepted === suppress) {
            return;
        }
        rec.fileChooserIntercepted = suppress;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await entry.view.webContents.debugger?.sendCommand?.('Page.setInterceptFileChooserDialog', { enabled: suppress });
        }
        catch {
            rec.fileChooserIntercepted = undefined;
        }
    }
    /**
     * Synchronizes non-elevated popup protections for `entry`:
     * - While hidden or at `z=0`, injects user-origin CSS rendering `<select>`
     *   menus in-page (`appearance: base-select`) and hiding calendar picker
     *   indicators, enables the isolated-world color/file activation guard, and
     *   intercepts file-chooser dialogs over CDP so background tabs never open
     *   OS-level popups over the active tab or Hub UI.
     * - While visible and elevated at `z=1`, removes those overrides so direct
     *   human interaction uses native OS menus and pickers.
     */
    async syncPopupSuppression(entry, rec) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        if (!wc || wc.isDestroyed?.()) {
            return;
        }
        const suppress = this.shouldSuppressNativePopups(entry, rec);
        if (suppress) {
            if (!rec.popupSuppressionCssKey &&
                !rec.popupSuppressionCssInFlight &&
                typeof wc.insertCSS === 'function') {
                const gen = (rec.popupCssGeneration ?? 0) + 1;
                rec.popupCssGeneration = gen;
                const tracked = Promise.resolve(wc.insertCSS(exports.NON_ELEVATED_POPUP_SUPPRESSION_CSS, { cssOrigin: 'user' }))
                    .then((key) => {
                    if (typeof key !== 'string' || !key) {
                        return;
                    }
                    if (wc.isDestroyed?.() ||
                        rec.popupCssGeneration !== gen ||
                        !this.shouldSuppressNativePopups(entry, rec)) {
                        void Promise.resolve(wc.removeInsertedCSS?.(key)).catch(() => undefined);
                        return;
                    }
                    rec.popupSuppressionCssKey = key;
                })
                    .catch(() => undefined)
                    .finally(() => {
                    if (rec.popupSuppressionCssInFlight === tracked) {
                        rec.popupSuppressionCssInFlight = undefined;
                    }
                });
                rec.popupSuppressionCssInFlight = tracked;
            }
        }
        else {
            rec.popupCssGeneration = (rec.popupCssGeneration ?? 0) + 1;
            const key = rec.popupSuppressionCssKey;
            rec.popupSuppressionCssKey = undefined;
            rec.popupSuppressionCssInFlight = undefined;
            if (key && typeof wc.removeInsertedCSS === 'function') {
                void Promise.resolve(wc.removeInsertedCSS(key)).catch(() => undefined);
            }
        }
        if (rec.isolatedGuardSuppressed !== suppress) {
            rec.isolatedGuardSuppressed = suppress;
            const script = buildIsolatedWorldPopupGuardScript(suppress);
            const tasks = [];
            if (typeof wc.executeJavaScriptInIsolatedWorld === 'function') {
                tasks.push(Promise.resolve(wc.executeJavaScriptInIsolatedWorld(exports.POPUP_GUARD_ISOLATED_WORLD_ID, [
                    { code: script },
                ])).catch(() => undefined));
            }
            const frames = Array.isArray(wc.mainFrame?.framesInSubtree)
                ? wc.mainFrame.framesInSubtree
                : null;
            if (frames) {
                for (const frame of frames) {
                    if (frame &&
                        frame !== wc.mainFrame &&
                        !frame.isDestroyed?.() &&
                        typeof frame.executeJavaScriptInIsolatedWorld === 'function') {
                        tasks.push(Promise.resolve(frame.executeJavaScriptInIsolatedWorld(exports.POPUP_GUARD_ISOLATED_WORLD_ID, [{ code: script }])).catch(() => undefined));
                    }
                }
            }
            if (tasks.length > 0) {
                const tracked = Promise.all(tasks)
                    .then(() => undefined)
                    .finally(() => {
                    if (rec.isolatedGuardInFlight === tracked) {
                        rec.isolatedGuardInFlight = undefined;
                    }
                });
                rec.isolatedGuardInFlight = tracked;
            }
        }
        await Promise.all([
            rec.popupSuppressionCssInFlight,
            rec.isolatedGuardInFlight,
            this.syncFileChooserInterception(entry, rec),
        ]);
    }
    async ensurePopupSuppressionBeforeInput(tabKey) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return;
        }
        const rec = this.ensureRecord(entry);
        if (this.shouldSuppressNativePopups(entry, rec)) {
            await this.syncPopupSuppression(entry, rec);
        }
    }
    async sendCdp(tabKey, method, params) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        if (typeof wc.getURL === 'function' && (wc.getURL() ?? '').trim() === '') {
            return;
        }
        await this.ensureCdpAttached(entry);
        if (wc.isDestroyed?.()) {
            return;
        }
        await wc.debugger?.sendCommand?.(method, params);
    }
    async dispatchMouseEvent(tabKey, params) {
        if (params.type === 'mousePressed') {
            await this.ensurePopupSuppressionBeforeInput(tabKey);
        }
        await this.sendCdp(tabKey, 'Input.dispatchMouseEvent', {
            button: 'none',
            clickCount: 0,
            ...params,
            x: Math.round(params.x),
            y: Math.round(params.y),
        });
    }
    async dispatchKeyEvent(tabKey, params) {
        if (params.type === 'keyDown' || params.type === 'rawKeyDown') {
            await this.ensurePopupSuppressionBeforeInput(tabKey);
        }
        await this.sendCdp(tabKey, 'Input.dispatchKeyEvent', params);
    }
    async insertText(tabKey, text) {
        await this.sendCdp(tabKey, 'Input.insertText', { text });
    }
    async capturePage(tabKey) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return null;
        }
        // A parked hidden tab may be covered by a more recently hidden one; move
        // it directly below the curtain and allow one frame for it to repaint.
        this.registry.prepareHiddenCapture(tabKey);
        let image;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                image = await entry.view.webContents.capturePage?.();
            }
            catch {
                image = undefined;
            }
            if ((image && !image.isEmpty?.()) ||
                attempt > 0 ||
                entry.view.webContents.isDestroyed()) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, exports.CAPTURE_RETRY_MS));
        }
        if (!image || image.isEmpty?.()) {
            return null;
        }
        const size = image.getSize?.();
        let finalImage = image;
        if (size &&
            typeof image.resize === 'function' &&
            (size.width > 1024 || size.height > 1024)) {
            const resized = size.width >= size.height
                ? image.resize({ width: 1024, quality: 'good' })
                : image.resize({ height: 1024, quality: 'good' });
            if (resized && !resized.isEmpty?.()) {
                finalImage = resized;
            }
        }
        return finalImage.toDataURL();
    }
    async navigate(tabKey, url) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return false;
        }
        if ((0, webviewBrowser_1.isExternalOnlyAuthUrl)(url)) {
            void this.registry.openExternalUrl(url);
            return false;
        }
        if (!(0, webviewBrowser_1.validateWebviewNavigationUrl)(url, 'http://127.0.0.1').allowed) {
            return false;
        }
        this.registry.noteExternalNavigation(tabKey, url);
        await entry.view.webContents.loadURL(url).catch(() => undefined);
        return true;
    }
    applyDemotion(entry, rec, reason) {
        const wasElevated = rec.zOrder === 1 || rec.userElevationLatch || rec.dragElevationActive;
        rec.zOrder = 0;
        rec.userElevationLatch = false;
        rec.dragElevationActive = false;
        void this.syncPopupSuppression(entry, rec);
        const hubView = (0, utils_1.getHubView)(entry.parentWindow);
        const cv = contentViewOf(entry.parentWindow);
        if (hubView && cv) {
            const kids = cv.children;
            if (!Array.isArray(kids) || kids[kids.length - 1] !== hubView) {
                cv.addChildView?.(hubView);
            }
        }
        if (wasElevated) {
            this.emitZOrderChanged(entry, 0, reason);
        }
    }
    emitZOrderChanged(entry, zOrder, reason) {
        if (!entry.hubSender.isDestroyed()) {
            entry.hubSender.send(exports.WCV_Z_ORDER_CHANGED_CHANNEL, {
                tabKey: entry.tabKey,
                webContentsId: entry.webContentsId,
                zOrder,
                reason,
            });
        }
    }
    attachWindowHooks(win) {
        if (this.trackedWindows.has(win)) {
            return;
        }
        this.trackedWindows.add(win);
        const onBlur = () => {
            if (!win.isDestroyed?.()) {
                this.demoteWindowToZ0(win, 'window-blur');
            }
        };
        const onHubFocus = () => {
            if (!win.isDestroyed?.()) {
                this.demoteWindowToZ0(win, 'hub-focus');
            }
        };
        const onHubDidStartNavigation = (_event, _url, isInPlace, isMainFrame) => {
            if (isMainFrame && !isInPlace && !win.isDestroyed?.()) {
                this.clearWindowElevationBlockers(win, 'hub-reload');
            }
        };
        const onHubRenderProcessGone = () => {
            if (!win.isDestroyed?.()) {
                this.clearWindowElevationBlockers(win, 'hub-render-process-gone');
            }
        };
        const hubContents = (0, utils_1.getHubWebContents)(win);
        win.on?.('blur', onBlur);
        hubContents?.on?.('focus', onHubFocus);
        hubContents?.on?.('did-start-navigation', onHubDidStartNavigation);
        hubContents?.on?.('render-process-gone', onHubRenderProcessGone);
        win.once?.('closed', () => {
            win.off?.('blur', onBlur);
            hubContents?.off?.('focus', onHubFocus);
            hubContents?.off?.('did-start-navigation', onHubDidStartNavigation);
            hubContents?.off?.('render-process-gone', onHubRenderProcessGone);
        });
    }
    attachGuestHooks(entry, rec) {
        if (rec.listenersAttached) {
            return;
        }
        rec.listenersAttached = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        wc.on?.('focus', () => {
            if (!rec.userElevationLatch && !rec.dragElevationActive) {
                this.applyDemotion(entry, rec, 'unlatched-guest-focus');
                setImmediate(() => {
                    if (!rec.userElevationLatch && !rec.dragElevationActive) {
                        const hubContents = (0, utils_1.getHubWebContents)(entry.parentWindow);
                        if (hubContents && !hubContents.isDestroyed?.()) {
                            hubContents.focus?.();
                        }
                    }
                });
            }
        });
        wc.on?.('cursor-changed', (_event, type) => {
            if (!entry.hubSender.isDestroyed()) {
                entry.hubSender.send(exports.WCV_CURSOR_CHANGED_CHANNEL, {
                    tabKey: entry.tabKey,
                    webContentsId: entry.webContentsId,
                    cursor: type || 'default',
                });
            }
        });
        wc.on?.('before-input-event', (event, input) => {
            if (input?.type &&
                input.type !== 'keyDown' &&
                input.type !== 'rawKeyDown') {
                return;
            }
            const keyLower = (input?.key || '').toLowerCase();
            if (keyLower === 'escape' && rec.dragElevationActive) {
                event.preventDefault();
                this.setDragOverActive(entry.tabKey, false);
                return;
            }
            const cmdOrCtrl = (0, utils_1.isMacOS)()
                ? Boolean(input?.meta)
                : Boolean(input?.control);
            const isGlobalShortcut = cmdOrCtrl &&
                !input?.alt &&
                ((!input?.shift && HUB_GLOBAL_SHORTCUT_KEYS.has(keyLower)) ||
                    (Boolean(input?.shift) && keyLower === 'n'));
            if (isGlobalShortcut) {
                event.preventDefault();
                this.applyDemotion(entry, rec, 'shortcut-forwarded');
                const hubContents = (0, utils_1.getHubWebContents)(entry.parentWindow);
                if (hubContents && !hubContents.isDestroyed?.()) {
                    hubContents.focus?.();
                }
                if (!entry.hubSender.isDestroyed()) {
                    entry.hubSender.send(exports.WCV_SHORTCUT_FORWARDED_CHANNEL, {
                        tabKey: entry.tabKey,
                        key: input.key || '',
                        code: input.code || '',
                        meta: Boolean(input.meta),
                        control: Boolean(input.control),
                        shift: Boolean(input.shift),
                        alt: Boolean(input.alt),
                    });
                }
            }
        });
        const onDocumentReset = () => {
            rec.popupCssGeneration = (rec.popupCssGeneration ?? 0) + 1;
            rec.popupSuppressionCssKey = undefined;
            rec.popupSuppressionCssInFlight = undefined;
            rec.isolatedGuardSuppressed = undefined;
            void this.syncPopupSuppression(entry, rec);
            if (entry.isAgentStepActive && !rec.cdpAttached) {
                void this.ensureCdpAttached(entry);
            }
        };
        wc.on?.('dom-ready', onDocumentReset);
        wc.on?.('did-navigate', onDocumentReset);
        wc.on?.('did-frame-finish-load', (_event, isMainFrame) => {
            if (isMainFrame === false) {
                rec.isolatedGuardSuppressed = undefined;
                void this.syncPopupSuppression(entry, rec);
            }
        });
        const dbg = wc.debugger;
        dbg?.on?.('detach', () => {
            rec.cdpAttachEpoch = (rec.cdpAttachEpoch ?? 0) + 1;
            rec.cdpAttachInFlight = undefined;
            rec.cdpAttached = false;
            rec.fileChooserIntercepted = undefined;
        });
        this.dialogController.registerGuest(wc, entry.hubSender, () => ({
            tabKey: entry.tabKey,
            isAgentStepActive: entry.isAgentStepActive,
        }));
        wc.once?.('destroyed', () => {
            if (this.tabStates.get(entry.tabKey)?.webContentsId === entry.webContentsId) {
                this.tabStates.delete(entry.tabKey);
            }
        });
    }
}
exports.WcvZOrderController = WcvZOrderController;
exports.wcvZOrderController = new WcvZOrderController();
