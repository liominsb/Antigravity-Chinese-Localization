"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wcvZOrderController = exports.WcvZOrderController = exports.NON_ELEVATED_POPUP_SUPPRESSION_CSS = exports.POPUP_GUARD_ISOLATED_WORLD_ID = exports.CAPTURE_RETRY_MS = exports.WCV_CURSOR_CHANGED_CHANNEL = exports.WCV_SHORTCUT_FORWARDED_CHANNEL = exports.WCV_Z_ORDER_CHANGED_CHANNEL = void 0;
exports.resolveMacEditingCommands = resolveMacEditingCommands;
const guestDialogController_1 = require("./guestDialogController");
const isolatedWorldExec_1 = require("./isolatedWorldExec");
Object.defineProperty(exports, "POPUP_GUARD_ISOLATED_WORLD_ID", { enumerable: true, get: function () { return isolatedWorldExec_1.POPUP_GUARD_ISOLATED_WORLD_ID; } });
const guestFileChooserController_1 = require("./guestFileChooserController");
const utils_1 = require("./utils");
const hubZoom_1 = require("./hubZoom");
const webviewBrowser_1 = require("./webviewBrowser");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const webviewUploadValidation_1 = require("./webviewUploadValidation");
exports.WCV_Z_ORDER_CHANGED_CHANNEL = 'wcv:z-order-changed';
exports.WCV_SHORTCUT_FORWARDED_CHANNEL = 'wcv:shortcut-forwarded';
exports.WCV_CURSOR_CHANGED_CHANNEL = 'wcv:cursor-changed';
/** Delay before the single capturePage() retry, about two frames at 60 Hz. */
exports.CAPTURE_RETRY_MS = 35;
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
function buildIsolatedWorldPopupGuardScript(suppress, allowFileChooser = false) {
    const flag = suppress ? 'true' : 'false';
    const allowFile = allowFileChooser ? 'true' : 'false';
    return `(() => {
    window.__wcvSuppressNativePopups = ${flag};
    window.__wcvAllowInterceptedFileChooser = ${allowFile};
    if (window.__wcvPopupGuardInstalled) return;
    window.__wcvPopupGuardInstalled = true;
    const isBlockedPickerInput = (node) => {
      if (!node || node.tagName !== 'INPUT') return false;
      const t = (node.type || '').toLowerCase();
      return t === 'color' || (t === 'file' && !window.__wcvAllowInterceptedFileChooser);
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
const MIN_VIEWPORT_DIMENSION = 1;
const MAX_VIEWPORT_DIMENSION = 8192;
const VIEWPORT_INVALIDATE_SETTLE_MS = 34;
/**
 * Returns `true` when a viewport override must not apply to `rawUrl`: external-only
 * OAuth endpoints and protected IdP hosts (shared list in `webviewUploadValidation`),
 * following UberProxy `/uberproxy/pen?url=` redirects to their target first.
 */
function isProtectedViewportOverrideUrl(rawUrl) {
    let current = (rawUrl || '').trim();
    for (let depth = 0; depth < 8 && current; depth++) {
        if ((0, webviewBrowser_1.isExternalOnlyAuthUrl)(current)) {
            return true;
        }
        let target = null;
        try {
            const parsed = new URL(current);
            if (parsed.protocol === 'https:' &&
                parsed.hostname.toLowerCase().replace(/\.+$/, '') ===
                    'uberproxy-pen-redirect.corp.google.com' &&
                parsed.pathname === '/uberproxy/pen') {
                target = parsed.searchParams.get('url');
            }
        }
        catch {
            return false;
        }
        if (!target || !/^https?:\/\//i.test(target) || target === current) {
            return (0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(current);
        }
        current = target;
    }
    return false;
}
/**
 * macOS Cocoa/Blink editing commands for synthetic CDP `Input.dispatchKeyEvent`
 * modifier chords. On macOS, AppKit normally translates `Cmd`/`Option`/`Ctrl`
 * key equivalents into Blink editor commands before Blink sees the event; CDP
 * bypasses AppKit, so `commands` must be supplied explicitly on `keyDown` /
 * `rawKeyDown` for `Meta+A` (`selectAll`), clipboard, undo/redo, and word/line
 * navigation/deletion to take effect (while still honoring page `keydown`
 * `Event.preventDefault()`).
 */
const MAC_EDITING_COMMANDS = {
    'Meta+KeyA': ['selectAll'],
    'Meta+KeyC': ['copy'],
    'Meta+KeyV': ['paste'],
    'Shift+Alt+Meta+KeyV': ['pasteAndMatchStyle'],
    'Meta+KeyX': ['cut'],
    'Meta+KeyZ': ['undo'],
    'Shift+Meta+KeyZ': ['redo'],
    'Meta+Backspace': ['deleteToBeginningOfLine'],
    'Alt+Backspace': ['deleteWordBackward'],
    'Alt+Delete': ['deleteWordForward'],
    'Control+KeyH': ['deleteBackward'],
    'Control+KeyD': ['deleteForward'],
    'Control+KeyK': ['deleteToEndOfParagraph'],
    'Meta+ArrowLeft': ['moveToLeftEndOfLine'],
    'Shift+Meta+ArrowLeft': ['moveToLeftEndOfLineAndModifySelection'],
    'Meta+ArrowRight': ['moveToRightEndOfLine'],
    'Shift+Meta+ArrowRight': ['moveToRightEndOfLineAndModifySelection'],
    'Meta+ArrowUp': ['moveToBeginningOfDocument'],
    'Shift+Meta+ArrowUp': ['moveToBeginningOfDocumentAndModifySelection'],
    'Meta+ArrowDown': ['moveToEndOfDocument'],
    'Shift+Meta+ArrowDown': ['moveToEndOfDocumentAndModifySelection'],
    'Alt+ArrowLeft': ['moveWordLeft'],
    'Shift+Alt+ArrowLeft': ['moveWordLeftAndModifySelection'],
    'Alt+ArrowRight': ['moveWordRight'],
    'Shift+Alt+ArrowRight': ['moveWordRightAndModifySelection'],
    'Alt+ArrowUp': ['moveToBeginningOfParagraph'],
    'Shift+Alt+ArrowUp': ['moveToBeginningOfParagraphAndModifySelection'],
    'Alt+ArrowDown': ['moveToEndOfParagraph'],
    'Shift+Alt+ArrowDown': ['moveToEndOfParagraphAndModifySelection'],
    'Control+KeyA': ['moveToBeginningOfParagraph'],
    'Shift+Control+KeyA': ['moveToBeginningOfParagraphAndModifySelection'],
    'Control+KeyE': ['moveToEndOfParagraph'],
    'Shift+Control+KeyE': ['moveToEndOfParagraphAndModifySelection'],
    'Control+KeyB': ['moveBackward'],
    'Shift+Control+KeyB': ['moveBackwardAndModifySelection'],
    'Control+KeyF': ['moveForward'],
    'Shift+Control+KeyF': ['moveForwardAndModifySelection'],
    'Control+KeyP': ['moveUp'],
    'Shift+Control+KeyP': ['moveUpAndModifySelection'],
    'Control+KeyN': ['moveDown'],
    'Shift+Control+KeyN': ['moveDownAndModifySelection'],
};
function normalizeMacCommandCode(params) {
    const rawCode = (params.code ?? '').trim();
    if (rawCode) {
        return rawCode;
    }
    const rawKey = (params.key ?? '').trim();
    if (/^[a-zA-Z]$/.test(rawKey)) {
        return `Key${rawKey.toUpperCase()}`;
    }
    if (/^[0-9]$/.test(rawKey)) {
        return `Digit${rawKey}`;
    }
    return rawKey;
}
/**
 * Resolves Blink `EditorCommand` names for a macOS CDP `Input.dispatchKeyEvent`
 * payload when `params` is a `keyDown` or `rawKeyDown` without explicit
 * `commands`, or `undefined` when no macOS editing command applies.
 */
function resolveMacEditingCommands(params) {
    if ((params.type !== 'keyDown' && params.type !== 'rawKeyDown') ||
        params.commands !== undefined) {
        return undefined;
    }
    const mods = params.modifiers ?? 0;
    if ((mods & 7) === 0) {
        // Unmodified or Shift-only keys are handled natively by Blink.
        return undefined;
    }
    const code = normalizeMacCommandCode(params);
    if (!code) {
        return undefined;
    }
    const parts = [];
    if (mods & 8) {
        parts.push('Shift');
    }
    if (mods & 2) {
        parts.push('Control');
    }
    if (mods & 1) {
        parts.push('Alt');
    }
    if (mods & 4) {
        parts.push('Meta');
    }
    parts.push(code);
    const matched = MAC_EDITING_COMMANDS[parts.join('+')];
    return matched ? [...matched] : undefined;
}
const HUB_GLOBAL_SHORTCUT_KEYS = new Set(['l', 't', 'w', 'k', ',', 'b', 'q']);
// How long a tab ignores its own focus event after a hidden tab hands focus
// back to it.
const FOCUS_HAND_BACK_GRACE_MS = 250;
const contentViewOf = (win) => !win || win.isDestroyed?.() ? undefined : win.contentView;
function placeAt(cv, view, index) {
    cv.addChildView?.(view, index);
    const after = cv.children;
    if (Array.isArray(after) &&
        after.indexOf(view) !== index &&
        typeof cv.removeChildView === 'function') {
        // Electron only documents addChildView(existingChild) as reordering to
        // topmost; detach and re-insert when index is ignored on an existing child.
        cv.removeChildView(view);
        cv.addChildView?.(view, index);
    }
}
const isTransientFullscreenFocusReason = (reason) => reason === 'window-blur' || reason === 'hub-focus';
/** Coordinates derived z-order layering, keyboard focus grants, and main-process CDP input for browser `WebContentsView`s. */
class WcvZOrderController {
    constructor(registry = wcvBrowserRegistry_1.wcvBrowserRegistry, dialogController = guestDialogController_1.guestDialogController, options) {
        this.registry = registry;
        this.dialogController = dialogController;
        this.tabStates = new Map();
        this.viewportOverrides = new Map();
        this.windowPortalOpen = new WeakMap();
        this.trackedWindows = new WeakSet();
        this.pageEnableTimeoutMs =
            options?.pageEnableTimeoutMs ?? guestDialogController_1.DEFAULT_PAGE_ENABLE_TIMEOUT_MS;
        this.fileChooserController =
            options?.fileChooserController ??
                new guestFileChooserController_1.GuestFileChooserController({
                    pageEnableTimeoutMs: this.pageEnableTimeoutMs,
                });
        this.registry.onHtmlFullscreenChanged?.((entry, active) => {
            this.handleHtmlFullscreenChanged(entry, active);
        });
    }
    syncMenuShortcutSuppression(entry, rec) {
        const wc = entry.view.webContents;
        if (!wc || wc.isDestroyed?.()) {
            return;
        }
        wc.setIgnoreMenuShortcuts?.(rec.zOrder === 0 || Boolean(entry.isAgentStepActive));
    }
    handleHtmlFullscreenChanged(entry, active) {
        if (entry.view.webContents.isDestroyed()) {
            return;
        }
        const rec = this.ensureRecord(entry);
        if (active) {
            if (this.isElevationBlocked(entry, rec)) {
                this.registry.exitHtmlFullscreen?.(entry.tabKey);
                return;
            }
            rec.userElevationLatch = true;
            this.reconcileWindow(entry.parentWindow, 'enter-html-full-screen');
            entry.view.webContents.focus?.();
            return;
        }
        this.reconcileWindow(entry.parentWindow, 'leave-html-full-screen');
        this.syncMenuShortcutSuppression(entry, rec);
    }
    ensureRecord(entry) {
        let rec = this.tabStates.get(entry.tabKey);
        let isNewOrReplaced = false;
        if (!rec) {
            rec = {
                webContentsId: entry.webContentsId,
                zOrder: 0,
                userElevationLatch: false,
                overlayActive: false,
                cdpMouseInFlight: 0,
            };
            this.tabStates.set(entry.tabKey, rec);
            isNewOrReplaced = true;
        }
        else if (rec.webContentsId !== entry.webContentsId) {
            // Preserve rec.overlayActive: it tracks host UI occlusion of the tabKey
            // slot rather than the replaced guest WebContents instance.
            rec.webContentsId = entry.webContentsId;
            rec.zOrder = 0;
            rec.userElevationLatch = false;
            rec.cdpMouseInFlight = 0;
            rec.humanPromptOpen = false;
            rec.listenersAttached = false;
            rec.cdpAttached = false;
            rec.cdpAttachEpoch = (rec.cdpAttachEpoch ?? 0) + 1;
            rec.cdpAttachInFlight = undefined;
            rec.popupSuppressionCssKey = undefined;
            rec.popupSuppressionCssInFlight = undefined;
            rec.popupCssGeneration = 0;
            rec.isolatedGuardSuppressed = undefined;
            rec.isolatedGuardInFlight = undefined;
            rec.isolatedGuardFlushPending = false;
            rec.focusEmulationEnabled = undefined;
            rec.focusHandBackUntil = undefined;
            this.viewportOverrides.delete(entry.tabKey);
            isNewOrReplaced = true;
        }
        this.attachWindowHooks(entry.parentWindow);
        this.attachGuestHooks(entry, rec);
        if (isNewOrReplaced) {
            this.syncMenuShortcutSuppression(entry, rec);
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
            // TODO(yushis): Drop once renderers no longer read the legacy drag
            // elevation field from WcvZOrderState.
            dragElevationActive: false,
            overlayActive: rec.overlayActive,
            portalOverlayOpen: Boolean(this.windowPortalOpen.get(entry.parentWindow)),
            isAgentStepActive: Boolean(entry.isAgentStepActive),
        };
    }
    isElevationBlocked(entry, rec) {
        return Boolean(!entry.visible ||
            entry.isAgentStepActive ||
            rec.overlayActive ||
            rec.humanPromptOpen ||
            this.windowPortalOpen.get(entry.parentWindow));
    }
    /**
     * Reconciles every tab in `win` so visible tabs sit immediately above or
     * below `hubView` according to `isElevationBlocked`, without moving `hubView`
     * or unrelated sibling views.
     */
    reconcileWindow(win, reason) {
        if (!win || win.isDestroyed?.()) {
            return;
        }
        this.attachWindowHooks(win);
        for (const tabKey of this.tabStates.keys()) {
            if (!this.registry.getEntry(tabKey)) {
                this.tabStates.delete(tabKey);
            }
        }
        const cv = contentViewOf(win);
        const hubView = (0, utils_1.getHubView)(win);
        for (const entry of this.registry.getEntriesForWindow(win)) {
            const rec = this.ensureRecord(entry);
            if (!entry.visible || entry.view.webContents.isDestroyed()) {
                const prev = rec.zOrder;
                rec.zOrder = 0;
                rec.userElevationLatch = false;
                if (prev === 1) {
                    this.emitZOrderChanged(entry, 0, reason);
                }
                this.syncMenuShortcutSuppression(entry, rec);
                void this.syncPopupSuppression(entry, rec);
                continue;
            }
            const desired = this.isElevationBlocked(entry, rec) ? 0 : 1;
            const kids = cv?.children;
            if (cv && hubView && Array.isArray(kids)) {
                const hubIdx = kids.indexOf(hubView);
                if (hubIdx >= 0) {
                    const viewIdx = kids.indexOf(entry.view);
                    const physical = viewIdx < 0 ? -1 : viewIdx > hubIdx ? 1 : 0;
                    if (physical !== desired) {
                        const withoutTab = kids.filter((child) => child !== entry.view);
                        const idx = withoutTab.indexOf(hubView);
                        placeAt(cv, entry.view, desired === 1 ? idx + 1 : idx);
                    }
                }
            }
            const prev = rec.zOrder;
            if (rec.zOrder !== desired) {
                rec.zOrder = desired;
                this.emitZOrderChanged(entry, desired, reason);
            }
            this.syncMenuShortcutSuppression(entry, rec);
            void this.syncPopupSuppression(entry, rec);
            if (desired === 0 && entry.htmlFullscreen) {
                this.registry.exitHtmlFullscreen?.(entry.tabKey);
            }
            if (prev === 1 && desired === 0) {
                (0, isolatedWorldExec_1.dismissNativeGuestPopups)(entry.view.webContents, {
                    onlyPopupControls: true,
                    shouldStillDismiss: () => rec.zOrder === 0,
                });
            }
        }
    }
    revokeFocusGrant(tabKey) {
        const rec = this.tabStates.get(tabKey);
        if (rec) {
            rec.userElevationLatch = false;
        }
    }
    revokeWindowFocusGrants(win) {
        for (const entry of this.registry.getEntriesForWindow(win)) {
            if (entry.htmlFullscreen && entry.visible && !entry.isAgentStepActive) {
                continue;
            }
            const rec = this.tabStates.get(entry.tabKey);
            if (rec) {
                rec.userElevationLatch = false;
            }
        }
    }
    /** Reconciles `tabKey`'s window and, when elevated at `z=1` with `focusBrowser`, grants and applies guest keyboard focus. */
    elevate(tabKey, reason = 'pointerdown', focusBrowser = true) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        this.reconcileWindow(entry.parentWindow, reason);
        if (rec.zOrder === 1 && focusBrowser) {
            rec.userElevationLatch = true;
            entry.view.webContents.focus?.();
        }
        return this.getState(tabKey);
    }
    setDragOverActive(tabKey, _active) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return null;
        }
        return this.getState(tabKey);
    }
    /** Revokes `tabKey`'s keyboard focus grant without changing z-order. */
    demote(tabKey, reason = 'hub-interaction') {
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        if (isTransientFullscreenFocusReason(reason) &&
            entry.htmlFullscreen &&
            entry.visible &&
            !entry.isAgentStepActive) {
            return this.getState(tabKey);
        }
        if (entry.htmlFullscreen) {
            this.registry.exitHtmlFullscreen?.(tabKey);
        }
        const rec = this.ensureRecord(entry);
        rec.userElevationLatch = false;
        return this.getState(tabKey);
    }
    clearWindowElevationBlockers(win, reason) {
        const entriesSnapshot = this.registry
            .getEntriesForWindow(win)
            .map((entry) => ({
            entry,
            wasVisible: Boolean(entry.visible),
            wasAgentActive: Boolean(entry.isAgentStepActive),
        }));
        this.registry.cancelWindowShowRequests?.(win);
        this.windowPortalOpen.set(win, false);
        for (const { entry, wasVisible, wasAgentActive } of entriesSnapshot) {
            if (entry.htmlFullscreen) {
                this.registry.exitHtmlFullscreen?.(entry.tabKey);
            }
            if (wasVisible && entry.visible) {
                this.registry.hide(entry.tabKey);
            }
            this.registry.setAgentStepActive(entry.tabKey, false);
            if (wasAgentActive) {
                this.resetViewportOverride(entry);
            }
            const rec = this.tabStates.get(entry.tabKey);
            if (rec) {
                rec.overlayActive = false;
                rec.humanPromptOpen = false;
                rec.userElevationLatch = false;
                if (wasAgentActive &&
                    !wasVisible &&
                    !entry.view.webContents.isDestroyed()) {
                    (0, isolatedWorldExec_1.dismissNativeGuestPopups)(entry.view.webContents, {
                        onlyPopupControls: true,
                        shouldStillDismiss: () => !entry.isAgentStepActive && rec.zOrder === 0,
                    });
                }
            }
        }
        this.reconcileWindow(win, reason);
    }
    setOverlayActive(tabKey, active) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        rec.overlayActive = Boolean(active);
        this.reconcileWindow(entry.parentWindow, rec.overlayActive ? 'overlay-active' : 'overlay-inactive');
        return this.getState(tabKey);
    }
    setHumanPromptOpen(tabKey, open) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        rec.humanPromptOpen = Boolean(open);
        this.reconcileWindow(entry.parentWindow, rec.humanPromptOpen ? 'human-prompt-open' : 'human-prompt-closed');
        return this.getState(tabKey);
    }
    setPortalOverlayOpen(win, open) {
        const isOpen = Boolean(open);
        this.windowPortalOpen.set(win, isOpen);
        this.reconcileWindow(win, isOpen ? 'portal-overlay-open' : 'portal-overlay-closed');
    }
    setAgentControlling(tabKey, active) {
        const isActive = Boolean(active);
        this.registry.setAgentStepActive(tabKey, isActive);
        const entry = this.registry.getEntry(tabKey);
        if (!entry) {
            return null;
        }
        const rec = this.ensureRecord(entry);
        this.reconcileWindow(entry.parentWindow, isActive ? 'agent-controlling' : 'agent-controlling-ended');
        if (isActive) {
            void this.ensureCdpAttached(entry);
        }
        else {
            void this.syncFocusEmulation(entry, rec);
            this.syncMenuShortcutSuppression(entry, rec);
            this.resetViewportOverride(entry);
            (0, isolatedWorldExec_1.dismissNativeGuestPopups)(entry.view.webContents, {
                onlyPopupControls: true,
                shouldStillDismiss: () => !entry.isAgentStepActive && rec.zOrder === 0,
            });
        }
        void this.dialogController.syncFallbackContext?.(entry.view.webContents);
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
        await this.syncFocusEmulation(entry, rec);
    }
    shouldSuppressNativePopups(entry, rec) {
        return !entry.visible || rec.zOrder !== 1;
    }
    async syncFileChooserInterception(entry, rec) {
        if (!rec.cdpAttached || entry.view.webContents.isDestroyed()) {
            return;
        }
        await this.fileChooserController.syncInterception(entry.view.webContents);
    }
    /**
     * Enables Chromium CDP focus emulation while an agent step drives a `z=0`
     * background `WebContentsView` so `Input.dispatchMouseEvent`,
     * `Input.insertText`, and `Input.dispatchKeyEvent` focus and type into guest
     * elements without stealing OS/window focus from a foreground `z=1` tab.
     */
    async syncFocusEmulation(entry, rec) {
        if (!rec.cdpAttached || entry.view.webContents.isDestroyed()) {
            return;
        }
        const wantEnabled = Boolean(entry.isAgentStepActive);
        if (!wantEnabled && !rec.focusEmulationEnabled) {
            return;
        }
        if (rec.focusEmulationEnabled === wantEnabled) {
            return;
        }
        rec.focusEmulationEnabled = wantEnabled;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await entry.view.webContents.debugger?.sendCommand?.('Emulation.setFocusEmulationEnabled', { enabled: wantEnabled });
        }
        catch {
            rec.focusEmulationEnabled = undefined;
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
                const tracked = Promise.resolve(wc.insertCSS(exports.NON_ELEVATED_POPUP_SUPPRESSION_CSS, {
                    cssOrigin: 'user',
                }))
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
        const hasCommittedUrl = typeof wc.getURL !== 'function' || (wc.getURL() ?? '').trim() !== '';
        const isLoadingMain = typeof wc.isLoadingMainFrame === 'function' &&
            Boolean(wc.isLoadingMainFrame());
        if (!hasCommittedUrl) {
            // No main-frame document has committed yet; `onDocumentReset` will apply
            // the isolated-world popup guard once navigation commits.
        }
        else if (isLoadingMain) {
            // Electron's `WebContents.executeJavaScriptInIsolatedWorld` defers
            // execution until `did-stop-loading` anyway and registers a separate
            // `did-stop-loading` listener per call. Coalesce main-frame guard updates
            // during an active load into a single post-load sync using the latest
            // desired `suppress` state while still updating already-loaded subframes.
            void Promise.all(this.syncSubframePopupSuppression(wc, suppress));
            if (!rec.isolatedGuardFlushPending) {
                rec.isolatedGuardFlushPending = true;
                const targetWcId = rec.webContentsId;
                void (0, isolatedWorldExec_1.waitForWebContentsCanExecuteJs)(wc)
                    .then(() => {
                    if (rec.webContentsId !== targetWcId) {
                        return;
                    }
                    rec.isolatedGuardFlushPending = false;
                    if (!wc.isDestroyed?.() &&
                        this.tabStates.get(entry.tabKey) === rec) {
                        void this.syncPopupSuppression(entry, rec);
                    }
                })
                    .catch(() => {
                    if (rec.webContentsId === targetWcId) {
                        rec.isolatedGuardFlushPending = false;
                    }
                });
            }
        }
        else if (rec.isolatedGuardSuppressed !== suppress) {
            rec.isolatedGuardSuppressed = suppress;
            const script = buildIsolatedWorldPopupGuardScript(suppress, this.fileChooserController.isFileChooserAllowed(entry.webContentsId));
            const tasks = [];
            if (typeof wc.executeJavaScriptInIsolatedWorld === 'function') {
                tasks.push(Promise.resolve((0, isolatedWorldExec_1.executeJavaScriptInIsolatedWorldWhenReady)(wc, isolatedWorldExec_1.POPUP_GUARD_ISOLATED_WORLD_ID, [{ code: script }])).catch(() => undefined));
            }
            tasks.push(...this.syncSubframePopupSuppression(wc, suppress));
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
    syncSubframePopupSuppression(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wc, suppress) {
        const tasks = [];
        const frames = Array.isArray(wc.mainFrame?.framesInSubtree)
            ? wc.mainFrame.framesInSubtree
            : null;
        if (!frames) {
            return tasks;
        }
        // Carry the file chooser allow flag so a suppress toggle does not reset it
        // in same-origin subframes.
        const script = buildIsolatedWorldPopupGuardScript(suppress, this.fileChooserController.isFileChooserAllowed(wc.id));
        for (const frame of frames) {
            if (frame &&
                frame !== wc.mainFrame &&
                !frame.isDestroyed?.() &&
                typeof frame.executeJavaScriptInIsolatedWorld === 'function') {
                tasks.push(Promise.resolve(frame.executeJavaScriptInIsolatedWorld(isolatedWorldExec_1.POPUP_GUARD_ISOLATED_WORLD_ID, [{ code: script }])).catch(() => undefined));
            }
        }
        return tasks;
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
        const vpRec = this.viewportOverrides.get(tabKey);
        if (vpRec &&
            vpRec.webContentsId === entry.webContentsId &&
            vpRec.desired &&
            !vpRec.appliedKey) {
            await this.applyViewportOverride(entry, vpRec.desired);
            if (wc.isDestroyed?.()) {
                return;
            }
        }
        await wc.debugger?.sendCommand?.(method, params);
    }
    /** Clears any live viewport override on `entry`; a no-op when none is set. */
    resetViewportOverride(entry) {
        if (this.viewportOverrides.get(entry.tabKey)?.webContentsId !==
            entry.webContentsId) {
            return;
        }
        void this.applyViewportOverride(entry, null).catch(() => undefined);
    }
    async applyViewportOverride(entry, desired) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        if (!wc || wc.isDestroyed?.()) {
            return;
        }
        let vpRec = this.viewportOverrides.get(entry.tabKey);
        if (!vpRec || vpRec.webContentsId !== entry.webContentsId) {
            if (!desired) {
                this.viewportOverrides.delete(entry.tabKey);
                return;
            }
            vpRec = {
                webContentsId: entry.webContentsId,
                desired,
            };
            this.viewportOverrides.set(entry.tabKey, vpRec);
        }
        else {
            vpRec.desired = desired;
        }
        const prev = vpRec.inFlight ?? Promise.resolve();
        const tracked = prev
            .catch(() => undefined)
            .then(async () => {
            if (wc.isDestroyed?.() ||
                this.viewportOverrides.get(entry.tabKey) !== vpRec) {
                return;
            }
            const initialDesired = vpRec.desired;
            if (typeof wc.getURL === 'function' &&
                (wc.getURL() ?? '').trim() === '') {
                vpRec.appliedKey = undefined;
                if (!initialDesired) {
                    this.viewportOverrides.delete(entry.tabKey);
                }
                return;
            }
            if (!initialDesired && !vpRec.appliedKey) {
                this.viewportOverrides.delete(entry.tabKey);
                return;
            }
            await this.ensureCdpAttached(entry);
            if (wc.isDestroyed?.() ||
                this.viewportOverrides.get(entry.tabKey) !== vpRec ||
                typeof wc.debugger?.sendCommand !== 'function') {
                if (!vpRec.desired) {
                    this.viewportOverrides.delete(entry.tabKey);
                }
                return;
            }
            const liveUrl = (typeof wc.getURL === 'function' ? wc.getURL() : '') ||
                entry.lastUrl ||
                '';
            if (vpRec.desired && isProtectedViewportOverrideUrl(liveUrl)) {
                vpRec.desired = null;
            }
            const currentDesired = vpRec.desired;
            if (!currentDesired) {
                if (vpRec.appliedKey) {
                    await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride', {});
                    vpRec.appliedKey = undefined;
                    if (!wc.isDestroyed?.() && typeof wc.invalidate === 'function') {
                        wc.invalidate();
                        await new Promise((resolve) => setTimeout(resolve, VIEWPORT_INVALIDATE_SETTLE_MS));
                    }
                }
                if (!vpRec.desired) {
                    this.viewportOverrides.delete(entry.tabKey);
                }
                return;
            }
            const targetKey = `${currentDesired.width}x${currentDesired.height}`;
            if (vpRec.appliedKey === targetKey) {
                return;
            }
            await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
                width: currentDesired.width,
                height: currentDesired.height,
                deviceScaleFactor: 0,
                mobile: false,
            });
            vpRec.appliedKey = targetKey;
            if (!vpRec.desired) {
                await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride', {});
                vpRec.appliedKey = undefined;
                this.viewportOverrides.delete(entry.tabKey);
            }
            if (!wc.isDestroyed?.() && typeof wc.invalidate === 'function') {
                wc.invalidate();
                await new Promise((resolve) => setTimeout(resolve, VIEWPORT_INVALIDATE_SETTLE_MS));
            }
        })
            .finally(() => {
            if (vpRec && vpRec.inFlight === tracked) {
                vpRec.inFlight = undefined;
            }
        });
        vpRec.inFlight = tracked;
        await tracked;
    }
    /**
     * Overrides or clears (`null`) the emulated CSS viewport dimensions for a
     * `WebContentsView` tab via `Emulation.setDeviceMetricsOverride`, refusing and
     * clearing overrides on protected Identity Provider origins.
     */
    async setViewportSize(tabKey, size) {
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return false;
        }
        this.ensureRecord(entry);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        if (size === null) {
            await this.applyViewportOverride(entry, null);
            return true;
        }
        if (!size ||
            typeof size !== 'object' ||
            typeof size.width !== 'number' ||
            typeof size.height !== 'number' ||
            !Number.isFinite(size.width) ||
            !Number.isFinite(size.height) ||
            Math.round(size.width) < MIN_VIEWPORT_DIMENSION ||
            Math.round(size.height) < MIN_VIEWPORT_DIMENSION) {
            return false;
        }
        const currentUrl = (typeof wc.getURL === 'function' ? wc.getURL() : '') ||
            entry.lastUrl ||
            '';
        if (isProtectedViewportOverrideUrl(currentUrl)) {
            await this.applyViewportOverride(entry, null);
            return false;
        }
        const normalized = {
            width: Math.min(MAX_VIEWPORT_DIMENSION, Math.max(MIN_VIEWPORT_DIMENSION, Math.round(size.width))),
            height: Math.min(MAX_VIEWPORT_DIMENSION, Math.max(MIN_VIEWPORT_DIMENSION, Math.round(size.height))),
        };
        await this.applyViewportOverride(entry, normalized);
        return true;
    }
    clampMousePointToViewport(entry, rawX, rawY) {
        const vpRec = entry ? this.viewportOverrides.get(entry.tabKey) : undefined;
        const activeOverride = vpRec && vpRec.webContentsId === entry?.webContentsId
            ? vpRec.desired
            : null;
        const liveBounds = activeOverride ??
            (entry?.boundsDip &&
                entry.boundsDip.width > 0 &&
                entry.boundsDip.height > 0
                ? entry.boundsDip
                : entry?.lastNonZeroSize);
        const width = liveBounds?.width ?? 0;
        const height = liveBounds?.height ?? 0;
        const roundCoord = (v) => typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
        const rx = roundCoord(rawX);
        const ry = roundCoord(rawY);
        return {
            x: width > 0 ? Math.max(0, Math.min(rx, width - 1)) : Math.max(0, rx),
            y: height > 0 ? Math.max(0, Math.min(ry, height - 1)) : Math.max(0, ry),
        };
    }
    async dispatchMouseEvent(tabKey, params) {
        if (params.type === 'mousePressed') {
            await this.ensurePopupSuppressionBeforeInput(tabKey);
        }
        const entry = this.registry.getEntry(tabKey);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return;
        }
        const { x, y } = this.clampMousePointToViewport(entry, params.x, params.y);
        const rec = this.ensureRecord(entry);
        const wcId = entry.webContentsId;
        rec.cdpMouseInFlight++;
        try {
            await this.sendCdp(tabKey, 'Input.dispatchMouseEvent', {
                button: 'none',
                clickCount: 0,
                ...params,
                x,
                y,
            });
        }
        finally {
            if (rec.webContentsId === wcId && rec.cdpMouseInFlight > 0) {
                rec.cdpMouseInFlight--;
            }
        }
    }
    async dispatchKeyEvent(tabKey, params) {
        if (params.type === 'keyDown' || params.type === 'rawKeyDown') {
            await this.ensurePopupSuppressionBeforeInput(tabKey);
        }
        const entry = this.registry.getEntry(tabKey);
        if (entry && !entry.view.webContents.isDestroyed()) {
            this.syncMenuShortcutSuppression(entry, this.ensureRecord(entry));
        }
        // Strip `nativeVirtualKeyCode` so Chromium's `InputHandler::DispatchKeyEvent`
        // sets `skip_if_unhandled = true` and `os_event = nil`, preventing synthetic
        // CDP keys from reaching AppKit `[[NSApp mainMenu] performKeyEquivalent:]`.
        const { nativeVirtualKeyCode: _ignoredNativeVk, ...sanitized } = params;
        const macCommands = (0, utils_1.isMacOS)()
            ? resolveMacEditingCommands(sanitized)
            : undefined;
        const cdpParams = macCommands
            ? { ...sanitized, commands: macCommands }
            : sanitized;
        await this.sendCdp(tabKey, 'Input.dispatchKeyEvent', cdpParams);
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
        const onHubFocus = () => {
            if (!win.isDestroyed?.()) {
                this.revokeWindowFocusGrants(win);
            }
        };
        const onHubDidStartNavigation = (details, _url, isInPlace, isMainFrame) => {
            const mainFrame = (details?.isMainFrame ?? isMainFrame) === true;
            const inPlace = Boolean(details?.isSameDocument ?? details?.isInPlace ?? isInPlace);
            if (mainFrame && !inPlace && !win.isDestroyed?.()) {
                this.clearWindowElevationBlockers(win, 'hub-reload');
            }
        };
        const onHubRenderProcessGone = () => {
            if (!win.isDestroyed?.()) {
                this.clearWindowElevationBlockers(win, 'hub-render-process-gone');
            }
        };
        const hubContents = (0, utils_1.getHubWebContents)(win);
        hubContents?.on?.('focus', onHubFocus);
        hubContents?.on?.('did-start-navigation', onHubDidStartNavigation);
        hubContents?.on?.('render-process-gone', onHubRenderProcessGone);
        win.once?.('closed', () => {
            hubContents?.off?.('focus', onHubFocus);
            hubContents?.off?.('did-start-navigation', onHubDidStartNavigation);
            hubContents?.off?.('render-process-gone', onHubRenderProcessGone);
        });
    }
    findFocusGrantedVisibleTab(win) {
        for (const entry of this.registry.getEntriesForWindow(win)) {
            const rec = this.tabStates.get(entry.tabKey);
            if (entry.visible && rec?.userElevationLatch) {
                return entry;
            }
        }
        return undefined;
    }
    attachGuestHooks(entry, rec) {
        if (rec.listenersAttached) {
            return;
        }
        rec.listenersAttached = true;
        entry.view.webContents.on?.('before-mouse-event', (_event, mouse) => {
            if (entry.visible &&
                mouse?.type === 'mouseDown' &&
                rec.cdpMouseInFlight === 0) {
                rec.userElevationLatch = true;
                this.emitZOrderChanged(entry, 1, 'user-gesture');
            }
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        wc.on?.('focus', () => {
            if (!entry.visible) {
                // Agent CDP input can focus a hidden tab. Hand focus back to the
                // focus-granted visible tab, or to the Hub when none holds a grant.
                setImmediate(() => {
                    // The window may have closed, or the user may have shown this tab,
                    // before this callback runs.
                    if (entry.parentWindow.isDestroyed?.() || entry.visible) {
                        return;
                    }
                    const owner = this.findFocusGrantedVisibleTab(entry.parentWindow);
                    if (owner && !owner.view.webContents.isDestroyed()) {
                        // focus() fires the owner's own focus handler, possibly after a
                        // forwarded shortcut or wcv:demote has revoked its grant. Mark the
                        // hand-back so that event is not bounced to the Hub as ungranted
                        // guest focus.
                        this.ensureRecord(owner).focusHandBackUntil =
                            Date.now() + FOCUS_HAND_BACK_GRACE_MS;
                        owner.view.webContents.focus?.();
                        return;
                    }
                    const hubContents = (0, utils_1.getHubWebContents)(entry.parentWindow);
                    if (hubContents && !hubContents.isDestroyed?.()) {
                        hubContents.focus?.();
                    }
                });
                return;
            }
            if (rec.focusHandBackUntil !== undefined) {
                const handedBack = Date.now() <= rec.focusHandBackUntil;
                rec.focusHandBackUntil = undefined;
                if (handedBack) {
                    return;
                }
            }
            if (!rec.userElevationLatch &&
                rec.zOrder === 1 &&
                rec.cdpMouseInFlight === 0) {
                // Touch and pen taps never reach before-mouse-event, so focus moving
                // into the page on top with no agent input in flight is the user's.
                rec.userElevationLatch = true;
                this.emitZOrderChanged(entry, 1, 'user-gesture');
                return;
            }
            if (!rec.userElevationLatch &&
                !(entry.htmlFullscreen && entry.visible && !entry.isAgentStepActive)) {
                setImmediate(() => {
                    if (!rec.userElevationLatch &&
                        !(entry.htmlFullscreen &&
                            entry.visible &&
                            !entry.isAgentStepActive) &&
                        !entry.parentWindow.isDestroyed?.() &&
                        !this.findFocusGrantedVisibleTab(entry.parentWindow)) {
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
            if (input?.isComposing) {
                return;
            }
            const keyLower = (input?.key || '').toLowerCase();
            const cmdOrCtrl = (0, utils_1.isMacOS)()
                ? Boolean(input?.meta)
                : Boolean(input?.control);
            const hasDisallowedModifier = (0, utils_1.isMacOS)()
                ? Boolean(input?.control || input?.alt)
                : Boolean(input?.alt || input?.meta);
            const hasAltGr = Boolean(input?.modifiers?.some((mod) => {
                const m = mod.toLowerCase();
                return m === 'altgr' || m === 'alt';
            }));
            if (entry.visible &&
                !entry.isAgentStepActive &&
                cmdOrCtrl &&
                !hasDisallowedModifier &&
                !hasAltGr) {
                const zoomAction = (0, hubZoom_1.resolveHubZoomShortcutAction)(input, keyLower);
                if (zoomAction) {
                    event.preventDefault();
                    wc.setZoomLevel?.(0);
                    void (0, hubZoom_1.applyHubWindowZoom)(entry.parentWindow, zoomAction).catch(() => undefined);
                    return;
                }
            }
            // Tab cycling uses physical Ctrl+Tab / Ctrl+Shift+Tab across all
            // desktop OSes (including macOS, where cmdOrCtrl requires Meta so
            // Cocoa editing chords such as Ctrl+K remain in the guest).
            const isTabCycleShortcut = Boolean(input?.control) &&
                !input?.meta &&
                !input?.alt &&
                !hasAltGr &&
                (keyLower === 'tab' || input?.code === 'Tab');
            const isGlobalShortcut = cmdOrCtrl &&
                !hasDisallowedModifier &&
                !hasAltGr &&
                ((!input?.shift && HUB_GLOBAL_SHORTCUT_KEYS.has(keyLower)) ||
                    (Boolean(input?.shift) && (keyLower === 'n' || keyLower === 't')));
            if (entry.visible &&
                !entry.isAgentStepActive &&
                rec.zOrder === 1 &&
                (isTabCycleShortcut || isGlobalShortcut)) {
                event.preventDefault();
                // Suppress repeat ticks after preventDefault so held chords neither
                // leak into the guest nor re-emit synthetic host keydowns.
                const isAutoRepeat = Boolean(input?.isAutoRepeat ||
                    input?.modifiers?.some((mod) => mod.toLowerCase() === 'isautorepeat'));
                if (isAutoRepeat) {
                    return;
                }
                if (entry.htmlFullscreen) {
                    this.registry.exitHtmlFullscreen?.(entry.tabKey);
                }
                rec.userElevationLatch = false;
                const hubContents = (0, utils_1.getHubWebContents)(entry.parentWindow);
                if (hubContents && !hubContents.isDestroyed?.()) {
                    hubContents.focus?.();
                }
                if (!entry.hubSender.isDestroyed()) {
                    entry.hubSender.send(exports.WCV_SHORTCUT_FORWARDED_CHANNEL, {
                        tabKey: entry.tabKey,
                        key: isTabCycleShortcut ? 'Tab' : input.key || '',
                        code: isTabCycleShortcut ? input.code || 'Tab' : input.code || '',
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
            const vpRec = this.viewportOverrides.get(entry.tabKey);
            if (vpRec &&
                vpRec.webContentsId === entry.webContentsId &&
                vpRec.desired) {
                const navUrl = (typeof wc.getURL === 'function' ? wc.getURL() : '') ||
                    entry.lastUrl ||
                    '';
                if (isProtectedViewportOverrideUrl(navUrl)) {
                    void this.applyViewportOverride(entry, null).catch(() => undefined);
                }
                else if (!vpRec.appliedKey) {
                    void this.applyViewportOverride(entry, vpRec.desired).catch(() => undefined);
                }
            }
            if (entry.isAgentStepActive && !rec.cdpAttached) {
                void this.ensureCdpAttached(entry);
            }
        };
        wc.on?.('dom-ready', onDocumentReset);
        wc.on?.('did-navigate', onDocumentReset);
        // Clear before commit so a protected IdP never paints with an override.
        wc.on?.('did-start-navigation', (details, url, isInPlace, isMainFrame) => {
            const navUrl = url ?? details?.url ?? '';
            const mainFrame = (details?.isMainFrame ?? isMainFrame) !== false;
            const sameDocument = Boolean(details?.isSameDocument ?? isInPlace);
            if (mainFrame &&
                !sameDocument &&
                isProtectedViewportOverrideUrl(navUrl)) {
                this.resetViewportOverride(entry);
            }
        });
        wc.on?.('did-frame-finish-load', (_event, isMainFrame) => {
            if (isMainFrame === false && !wc.isDestroyed?.()) {
                void Promise.all(this.syncSubframePopupSuppression(wc, this.shouldSuppressNativePopups(entry, rec)));
            }
        });
        const dbg = wc.debugger;
        dbg?.on?.('detach', () => {
            if (rec.webContentsId !== entry.webContentsId) {
                return;
            }
            rec.cdpAttachEpoch = (rec.cdpAttachEpoch ?? 0) + 1;
            rec.cdpAttachInFlight = undefined;
            rec.cdpAttached = false;
            rec.focusEmulationEnabled = undefined;
        });
        this.dialogController.registerGuest(wc, entry.hubSender, () => ({
            tabKey: entry.tabKey,
            isAgentStepActive: entry.isAgentStepActive,
        }));
        dbg?.on?.('detach', () => {
            const vpRec = this.viewportOverrides.get(entry.tabKey);
            if (vpRec && vpRec.webContentsId === entry.webContentsId) {
                vpRec.appliedKey = undefined;
            }
        });
        this.fileChooserController.registerGuest(wc, entry.hubSender, () => ({
            tabKey: entry.tabKey,
            suppressNativePopups: this.shouldSuppressNativePopups(entry, rec),
        }));
        wc.once?.('destroyed', () => {
            if (this.tabStates.get(entry.tabKey)?.webContentsId ===
                entry.webContentsId &&
                !this.registry.getEntry(entry.tabKey)) {
                this.tabStates.delete(entry.tabKey);
            }
            if (this.viewportOverrides.get(entry.tabKey)?.webContentsId ===
                entry.webContentsId) {
                this.viewportOverrides.delete(entry.tabKey);
            }
        });
    }
}
exports.WcvZOrderController = WcvZOrderController;
exports.wcvZOrderController = new WcvZOrderController(wcvBrowserRegistry_1.wcvBrowserRegistry, guestDialogController_1.guestDialogController, { fileChooserController: guestFileChooserController_1.guestFileChooserController });
