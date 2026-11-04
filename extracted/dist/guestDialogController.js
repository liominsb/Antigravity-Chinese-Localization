"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guestDialogController = exports.GuestDialogController = exports.DEFAULT_PAGE_ENABLE_TIMEOUT_MS = exports.DEFAULT_MANUAL_DIALOG_TIMEOUT_MS = exports.WEBVIEW_DIALOG_OPENING_CHANNEL = void 0;
const guestDebugger_1 = require("./guestDebugger");
/** Renderer push channel for `Page.javascriptDialogOpening` events. */
exports.WEBVIEW_DIALOG_OPENING_CHANNEL = 'webview:javascript-dialog-opening';
/** Default fail-safe timeout (ms) for an unhandled `'manual'` dialog before auto-resolving. */
exports.DEFAULT_MANUAL_DIALOG_TIMEOUT_MS = 10000;
/** Default timeout (ms) bounding CDP `Page.enable` so uninitialized targets cannot hang callers. */
exports.DEFAULT_PAGE_ENABLE_TIMEOUT_MS = 1500;
function isBlankOrEmptyGuestUrl(rawUrl) {
    const trimmed = (rawUrl ?? '').trim();
    return trimmed === '' || trimmed.toLowerCase() === 'about:blank';
}
function isGuestOnBlankOrEmptyUrl(wc) {
    if (typeof wc.getURL !== 'function') {
        return false;
    }
    return isBlankOrEmptyGuestUrl(wc.getURL());
}
function normalizeDialogType(raw) {
    if (raw === 'alert' ||
        raw === 'confirm' ||
        raw === 'prompt' ||
        raw === 'beforeunload') {
        return raw;
    }
    return 'alert';
}
function defaultAcceptForDismissPolicy(dialogType) {
    return dialogType === 'alert' || dialogType === 'beforeunload';
}
/**
 * Coordinates non-blocking CDP `Page.javascriptDialogOpening` capture and
 * `Page.handleJavaScriptDialog` resolution across `<webview>` and
 * `WebContentsView` guests.
 */
class GuestDialogController {
    constructor(opts) {
        this.records = new Map();
        this.nextDialogSeq = 1;
        this.manualTimeoutMs =
            opts?.manualTimeoutMs ?? exports.DEFAULT_MANUAL_DIALOG_TIMEOUT_MS;
        this.pageEnableTimeoutMs =
            opts?.pageEnableTimeoutMs ?? exports.DEFAULT_PAGE_ENABLE_TIMEOUT_MS;
    }
    /**
     * Registers baseline WCV step state so agent-controlled WCV tabs remain
     * protected from modal hangs even when no explicit dialog policy was set,
     * while deferring to any active renderer dialog policy (`accept`/`manual`).
     */
    registerGuest(wc, sender, fallbackContext) {
        const rec = this.getOrCreateRecord(wc, sender);
        rec.sender = sender;
        if (fallbackContext) {
            rec.fallbackContext = fallbackContext;
        }
        this.attachListenersIfNeeded(rec);
    }
    /**
     * Updates the dialog interception policy for `wc` and enables CDP `Page`
     * events when `policy.enabled` is true. When `wc` is still on `''` or
     * `'about:blank'`, `Page.enable` is deferred until the first non-blank
     * navigation so uninitialized guest frames never block policy updates.
     */
    async setPolicy(wc, sender, policy) {
        const rec = this.getOrCreateRecord(wc, sender);
        rec.sender = sender;
        rec.policy = { ...policy };
        this.attachListenersIfNeeded(rec);
        if (!policy.enabled) {
            this.flushPendingManual(rec);
            return true;
        }
        const dbg = wc.debugger;
        if (!dbg || wc.isDestroyed?.()) {
            return false;
        }
        if (!(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            return false;
        }
        this.attachNavigationListenersIfNeeded(rec);
        if (!rec.pageDomainEnabled) {
            if (isGuestOnBlankOrEmptyUrl(wc)) {
                return true;
            }
            return this.enablePageDomain(rec);
        }
        return true;
    }
    /**
     * Resolves an open JavaScript dialog on `wc` with `decision.accept` and
     * optional `decision.promptText`.
     */
    async handleDialog(wc, decision) {
        const rec = this.records.get(wc.id);
        if (!rec?.pendingManual) {
            return false;
        }
        if (decision.dialogId && rec.pendingManual.dialogId !== decision.dialogId) {
            return false;
        }
        clearTimeout(rec.pendingManual.timer);
        rec.pendingManual = undefined;
        const dbg = wc.debugger;
        if (!dbg || wc.isDestroyed?.()) {
            return false;
        }
        const params = {
            accept: Boolean(decision.accept),
        };
        if (decision.promptText !== undefined) {
            params.promptText = String(decision.promptText);
        }
        try {
            await dbg.sendCommand?.('Page.handleJavaScriptDialog', params);
            return true;
        }
        catch {
            return false;
        }
    }
    getOrCreateRecord(wc, sender) {
        let rec = this.records.get(wc.id);
        if (!rec || rec.wc !== wc) {
            if (rec) {
                rec.pageEnableEpoch++;
                rec.detachNavListeners?.();
                if (rec.pendingManual) {
                    clearTimeout(rec.pendingManual.timer);
                }
            }
            rec = {
                wc,
                sender,
                listenerAttached: false,
                navListenersAttached: false,
                pageDomainEnabled: false,
                pageEnableEpoch: 0,
            };
            this.records.set(wc.id, rec);
            wc.once?.('destroyed', () => {
                const cur = this.records.get(wc.id);
                if (cur?.wc !== wc) {
                    return;
                }
                cur.pageEnableEpoch++;
                cur.detachNavListeners?.();
                if (cur.pendingManual) {
                    clearTimeout(cur.pendingManual.timer);
                }
                this.records.delete(wc.id);
            });
        }
        return rec;
    }
    attachNavigationListenersIfNeeded(rec) {
        if (rec.navListenersAttached || !rec.wc.on) {
            return;
        }
        rec.navListenersAttached = true;
        const onDidStartNavigation = (details, url, _isInPlace, isMainFrame) => {
            const navUrl = typeof url === 'string' ? url : details?.url;
            const mainFrame = (details?.isMainFrame ?? isMainFrame) !== false;
            if (!mainFrame || isBlankOrEmptyGuestUrl(navUrl)) {
                return;
            }
            if (rec.policy?.enabled === true && !rec.pageDomainEnabled) {
                void this.enablePageDomain(rec);
            }
        };
        const onDidNavigate = (_event, url) => {
            const navUrl = typeof url === 'string' ? url : rec.wc.getURL?.();
            if (isBlankOrEmptyGuestUrl(navUrl)) {
                return;
            }
            if (rec.policy?.enabled === true && !rec.pageDomainEnabled) {
                void this.enablePageDomain(rec);
            }
        };
        rec.wc.on('did-start-navigation', onDidStartNavigation);
        rec.wc.on('did-navigate', onDidNavigate);
        rec.detachNavListeners = () => {
            rec.wc.removeListener?.('did-start-navigation', onDidStartNavigation);
            rec.wc.removeListener?.('did-navigate', onDidNavigate);
            rec.detachNavListeners = undefined;
        };
    }
    enablePageDomain(rec) {
        if (rec.pageDomainEnabled) {
            return Promise.resolve(true);
        }
        if (rec.pageEnableInFlight) {
            return rec.pageEnableInFlight;
        }
        const dbg = rec.wc.debugger;
        if (!dbg || rec.wc.isDestroyed?.()) {
            return Promise.resolve(false);
        }
        if (!(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            return Promise.resolve(false);
        }
        this.attachListenersIfNeeded(rec);
        if (typeof dbg.sendCommand !== 'function') {
            rec.pageDomainEnabled = true;
            return Promise.resolve(true);
        }
        const epoch = rec.pageEnableEpoch;
        let timer;
        const inFlight = (async () => {
            try {
                const sendFailed = Symbol('page-enable-failed');
                const timedOut = Symbol('page-enable-timeout');
                const result = await Promise.race([
                    dbg.sendCommand('Page.enable').catch(() => sendFailed),
                    new Promise((resolve) => {
                        timer = setTimeout(() => resolve(timedOut), this.pageEnableTimeoutMs);
                    }),
                ]);
                if (result === sendFailed ||
                    result === timedOut ||
                    rec.pageEnableEpoch !== epoch ||
                    rec.wc.isDestroyed?.()) {
                    return false;
                }
                rec.pageDomainEnabled = true;
                return true;
            }
            finally {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
            }
        })();
        const tracked = inFlight.finally(() => {
            if (rec.pageEnableInFlight === tracked) {
                rec.pageEnableInFlight = undefined;
            }
        });
        rec.pageEnableInFlight = tracked;
        return tracked;
    }
    attachListenersIfNeeded(rec) {
        if (rec.listenerAttached) {
            return;
        }
        const dbg = rec.wc.debugger;
        if (!dbg?.on) {
            return;
        }
        rec.listenerAttached = true;
        dbg.on('detach', () => {
            rec.pageEnableEpoch++;
            rec.pageDomainEnabled = false;
            rec.pageEnableInFlight = undefined;
            if (rec.pendingManual) {
                clearTimeout(rec.pendingManual.timer);
                rec.pendingManual = undefined;
            }
        });
        dbg.on('message', (_event, method, rawParams) => {
            if (method === 'Page.javascriptDialogClosed') {
                if (rec.pendingManual) {
                    clearTimeout(rec.pendingManual.timer);
                    rec.pendingManual = undefined;
                }
                return;
            }
            if (method !== 'Page.javascriptDialogOpening') {
                return;
            }
            this.onDialogOpening(rec, rawParams);
        });
    }
    onDialogOpening(rec, rawParams) {
        const fallback = rec.fallbackContext?.();
        const policyEnabled = rec.policy?.enabled === true;
        const wcvStepActive = fallback?.isAgentStepActive === true;
        if (!policyEnabled && !wcvStepActive) {
            return;
        }
        const dialogType = normalizeDialogType(rawParams?.type);
        const message = typeof rawParams?.message === 'string' ? rawParams.message : '';
        const defaultPrompt = typeof rawParams?.defaultPrompt === 'string'
            ? rawParams.defaultPrompt
            : '';
        const url = typeof rawParams?.url === 'string' && rawParams.url
            ? rawParams.url
            : rec.wc.getURL?.() || '';
        const tabKey = rec.policy?.tabKey ?? fallback?.tabKey;
        const dialogId = `dlg_${this.nextDialogSeq++}`;
        const action = policyEnabled
            ? (rec.policy?.action ?? 'dismiss')
            : 'dismiss';
        if (action === 'manual') {
            this.flushPendingManual(rec);
            const timer = setTimeout(() => {
                if (rec.pendingManual?.dialogId === dialogId) {
                    rec.pendingManual = undefined;
                    void rec.wc.debugger
                        ?.sendCommand?.('Page.handleJavaScriptDialog', {
                        accept: defaultAcceptForDismissPolicy(dialogType),
                    })
                        .catch(() => undefined);
                }
            }, this.manualTimeoutMs);
            rec.pendingManual = {
                dialogId,
                type: dialogType,
                defaultPrompt,
                timer,
            };
            this.emitToSender(rec.sender, {
                dialogId,
                webContentsId: rec.wc.id,
                ...(tabKey ? { tabKey } : {}),
                type: dialogType,
                message,
                defaultPrompt,
                url,
                handled: false,
            });
            return;
        }
        const accepted = action === 'accept' ? true : defaultAcceptForDismissPolicy(dialogType);
        const cmdParams = { accept: accepted };
        if (policyEnabled && rec.policy?.promptText !== undefined) {
            cmdParams.promptText = rec.policy.promptText;
        }
        else if (dialogType === 'prompt' && accepted && defaultPrompt) {
            cmdParams.promptText = defaultPrompt;
        }
        void rec.wc.debugger
            ?.sendCommand?.('Page.handleJavaScriptDialog', cmdParams)
            .catch(() => undefined);
        this.emitToSender(rec.sender, {
            dialogId,
            webContentsId: rec.wc.id,
            ...(tabKey ? { tabKey } : {}),
            type: dialogType,
            message,
            defaultPrompt,
            url,
            handled: true,
            accepted,
        });
    }
    flushPendingManual(rec) {
        const pending = rec.pendingManual;
        if (!pending) {
            return;
        }
        clearTimeout(pending.timer);
        rec.pendingManual = undefined;
        void rec.wc.debugger
            ?.sendCommand?.('Page.handleJavaScriptDialog', {
            accept: defaultAcceptForDismissPolicy(pending.type),
        })
            .catch(() => undefined);
    }
    emitToSender(sender, payload) {
        if (!sender || sender.isDestroyed()) {
            return;
        }
        try {
            sender.send(exports.WEBVIEW_DIALOG_OPENING_CHANNEL, payload);
        }
        catch {
            // Ignore send errors on tearing-down renderer frames.
        }
    }
}
exports.GuestDialogController = GuestDialogController;
exports.guestDialogController = new GuestDialogController();
