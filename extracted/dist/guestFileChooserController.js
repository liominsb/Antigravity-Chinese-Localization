"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guestFileChooserController = exports.GuestFileChooserController = exports.DEFAULT_FILE_CHOOSER_PAGE_ENABLE_TIMEOUT_MS = exports.DEFAULT_FILE_CHOOSER_TIMEOUT_MS = exports.WEBVIEW_FILE_CHOOSER_OPENED_CHANNEL = exports.resolveGuestUploadFiles = void 0;
const guestDebugger_1 = require("./guestDebugger");
const guestFileAttachment_1 = require("./guestFileAttachment");
Object.defineProperty(exports, "resolveGuestUploadFiles", { enumerable: true, get: function () { return guestFileAttachment_1.resolveGuestUploadFiles; } });
Object.defineProperty(exports, "WEBVIEW_FILE_CHOOSER_OPENED_CHANNEL", { enumerable: true, get: function () { return guestFileAttachment_1.WEBVIEW_FILE_CHOOSER_OPENED_CHANNEL; } });
const webviewUploadValidation_1 = require("./webviewUploadValidation");
exports.DEFAULT_FILE_CHOOSER_TIMEOUT_MS = 10000;
exports.DEFAULT_FILE_CHOOSER_PAGE_ENABLE_TIMEOUT_MS = 1500;
/** Coordinates main-process CDP `DOM.setFileInputFiles` and `Page.fileChooserOpened` handling. */
class GuestFileChooserController {
    constructor(opts) {
        this.records = new Map();
        this.nextChooserSeq = 1;
        this.chooserTimeoutMs =
            opts?.chooserTimeoutMs ?? exports.DEFAULT_FILE_CHOOSER_TIMEOUT_MS;
        this.pageEnableTimeoutMs =
            opts?.pageEnableTimeoutMs ?? exports.DEFAULT_FILE_CHOOSER_PAGE_ENABLE_TIMEOUT_MS;
    }
    registerGuest(wc, sender, fallbackContext) {
        const rec = this.getOrCreateRecord(wc, sender);
        rec.sender = sender;
        if (fallbackContext) {
            rec.fallbackContext = fallbackContext;
        }
        this.attachListenersIfNeeded(rec);
    }
    async syncInterception(wc) {
        const rec = this.getOrCreateRecord(wc);
        this.attachListenersIfNeeded(rec);
        return this.syncInterceptDialogState(rec);
    }
    async setPolicy(wc, sender, policy) {
        const rec = this.getOrCreateRecord(wc, sender);
        rec.sender = sender;
        rec.lastNavigatedUrl = undefined;
        rec.policy = { ...policy };
        this.attachListenersIfNeeded(rec);
        if (!policy.enabled) {
            this.cancelPendingChooser(rec);
            await this.syncPopupGuardAllowFlag(rec, false);
            await this.syncInterceptDialogState(rec);
            return true;
        }
        if ((0, webviewUploadValidation_1.isGuestOnProtectedIdp)(wc)) {
            rec.policy = { enabled: false, tabKey: policy.tabKey };
            await this.syncPopupGuardAllowFlag(rec, false);
            await this.syncInterceptDialogState(rec);
            return false;
        }
        const dbg = wc.debugger;
        if (!dbg || wc.isDestroyed?.() || !(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            await this.syncPopupGuardAllowFlag(rec, false);
            return false;
        }
        this.attachNavigationListenersIfNeeded(rec);
        if ((0, guestFileAttachment_1.isGuestOnBlankOrEmptyUrl)(wc)) {
            return true;
        }
        return this.armInterceptionThenAllow(rec);
    }
    /**
     * Enables `Page` + file chooser interception and only then lets the
     * isolated-world popup guard pass `<input type=file>` clicks through, so a
     * failed interception can never fall back to a native OS picker.
     */
    async armInterceptionThenAllow(rec) {
        const armed = (await this.enablePageDomain(rec)) &&
            (await this.syncInterceptDialogState(rec)) &&
            rec.interceptEnabled === true;
        await this.syncPopupGuardAllowFlag(rec, armed);
        return armed;
    }
    /** Whether the popup guard may let `<input type=file>` clicks reach the intercepted chooser. */
    isFileChooserAllowed(webContentsId) {
        const rec = this.records.get(webContentsId);
        return Boolean(rec?.policy?.enabled &&
            rec.interceptEnabled === true &&
            !this.isRecordOnProtectedIdp(rec));
    }
    async handleFileChooser(wc, decision) {
        const rec = this.records.get(wc.id);
        if ((0, webviewUploadValidation_1.isGuestOnProtectedIdp)(wc) ||
            (rec && this.isRecordOnProtectedIdp(rec))) {
            if (rec) {
                this.cancelPendingChooser(rec);
            }
            return (0, guestFileAttachment_1.idpBlockedErr)();
        }
        const pending = rec?.pendingChooser;
        if (!rec || !pending) {
            return (0, guestFileAttachment_1.actionErr)('No open file chooser to handle (resolved or timed out)');
        }
        if (typeof decision.chooserId !== 'string' || !decision.chooserId) {
            return (0, guestFileAttachment_1.actionErr)('chooserId is required to handle a file chooser');
        }
        if (pending.chooserId !== decision.chooserId) {
            return (0, guestFileAttachment_1.actionErr)(`File chooser ${decision.chooserId} is no longer active`);
        }
        const clearPending = () => {
            clearTimeout(pending.timer);
            if (rec.pendingChooser === pending) {
                rec.pendingChooser = undefined;
            }
        };
        const initCheck = await pending.verifyPromise;
        if (rec.pendingChooser !== pending) {
            return (0, guestFileAttachment_1.actionErr)('File chooser was superseded or cancelled');
        }
        if (!initCheck.allowed || !pending.mainOrigin) {
            this.cancelPendingChooser(rec);
            return (0, guestFileAttachment_1.actionErr)('Intercepted file chooser is cross-origin or inactive');
        }
        const dbg = wc.debugger;
        if (!dbg || wc.isDestroyed?.() || !(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            clearPending();
            return (0, guestFileAttachment_1.actionErr)('Guest debugger is unavailable for file chooser');
        }
        const live = await (0, guestFileAttachment_1.verifySameOriginChooserFrame)(dbg, wc, pending.frameId);
        if (rec.pendingChooser !== pending) {
            return (0, guestFileAttachment_1.actionErr)('File chooser was superseded or cancelled');
        }
        if (!live.allowed || live.mainOrigin !== pending.mainOrigin) {
            this.cancelPendingChooser(rec);
            return (0, guestFileAttachment_1.actionErr)('Page or frame origin changed since file chooser opened');
        }
        return (0, guestFileAttachment_1.applyInterceptedChooserDecision)(dbg, pending, decision, clearPending);
    }
    async setInputFiles(wc, request) {
        return (0, guestFileAttachment_1.attachStagedFilesByDomPath)(wc, request);
    }
    isRecordOnProtectedIdp(rec) {
        return Boolean((rec.lastNavigatedUrl &&
            (0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(rec.lastNavigatedUrl)) ||
            (0, webviewUploadValidation_1.isGuestOnProtectedIdp)(rec.wc));
    }
    getOrCreateRecord(wc, sender) {
        let rec = this.records.get(wc.id);
        if (!rec || rec.wc !== wc) {
            if (rec) {
                rec.pageEnableEpoch++;
                rec.detachNavListeners?.();
                this.cancelPendingChooser(rec);
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
                if (cur.pendingChooser) {
                    clearTimeout(cur.pendingChooser.timer);
                }
                cur.pendingChooser = undefined;
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
        const onDidNavigate = (_event, url) => {
            this.cancelPendingChooser(rec);
            if (rec.wc.isDestroyed?.()) {
                return;
            }
            const targetUrl = (typeof url === 'string' && url.trim() !== ''
                ? url
                : (rec.wc.getURL?.() ?? '')).trim();
            rec.lastNavigatedUrl = targetUrl;
            if (this.isRecordOnProtectedIdp(rec)) {
                void this.syncPopupGuardAllowFlag(rec, false);
                void this.syncInterceptDialogState(rec);
                return;
            }
            if (!rec.policy?.enabled ||
                !targetUrl ||
                /^about:blank(?:[?#].*)?$/i.test(targetUrl) ||
                !rec.wc.debugger ||
                !(0, guestDebugger_1.ensureGuestDebuggerAttached)(rec.wc.debugger)) {
                return;
            }
            void this.armInterceptionThenAllow(rec);
        };
        rec.wc.on('did-navigate', onDidNavigate);
        rec.detachNavListeners = () => {
            rec.wc.removeListener?.('did-navigate', onDidNavigate);
            rec.navListenersAttached = false;
            rec.detachNavListeners = undefined;
        };
    }
    async enablePageDomain(rec) {
        if (rec.pageDomainEnabled) {
            return true;
        }
        if (rec.pageEnableInFlight) {
            return rec.pageEnableInFlight;
        }
        const dbg = rec.wc.debugger;
        if (!dbg || rec.wc.isDestroyed?.()) {
            return false;
        }
        if (typeof dbg.sendCommand !== 'function') {
            rec.pageDomainEnabled = true;
            return true;
        }
        const epoch = rec.pageEnableEpoch;
        let timer;
        const tracked = (async () => {
            try {
                const bad = Symbol('bad');
                const res = await Promise.race([
                    Promise.resolve(dbg.sendCommand('Page.enable')).catch(() => bad),
                    new Promise((r) => {
                        timer = setTimeout(() => r(bad), this.pageEnableTimeoutMs);
                    }),
                ]);
                if (res === bad ||
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
        })().finally(() => {
            if (rec.pageEnableInFlight === tracked) {
                rec.pageEnableInFlight = undefined;
            }
        });
        rec.pageEnableInFlight = tracked;
        return tracked;
    }
    shouldInterceptFileChooser(rec) {
        if (this.isRecordOnProtectedIdp(rec)) {
            // Keep suppressing native pickers on IdP pages; onFileChooserOpened
            // auto-cancels the intercepted chooser there.
            return rec.fallbackContext?.().suppressNativePopups === true;
        }
        return (rec.policy?.enabled === true ||
            rec.fallbackContext?.().suppressNativePopups === true);
    }
    async syncInterceptDialogState(rec) {
        const dbg = rec.wc.debugger;
        if (!dbg || rec.wc.isDestroyed?.()) {
            return false;
        }
        const shouldIntercept = this.shouldInterceptFileChooser(rec);
        if (!shouldIntercept && !dbg.isAttached()) {
            rec.interceptEnabled = false;
            return true;
        }
        if (!(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            return false;
        }
        if (rec.interceptEnabled === shouldIntercept) {
            return true;
        }
        try {
            await dbg.sendCommand?.('Page.setInterceptFileChooserDialog', {
                enabled: shouldIntercept,
            });
            rec.interceptEnabled = shouldIntercept;
            return true;
        }
        catch {
            rec.interceptEnabled = undefined;
            return false;
        }
    }
    async syncPopupGuardAllowFlag(rec, allow) {
        await (0, guestFileAttachment_1.syncPopupGuardIsolatedFlag)(rec.wc, allow);
    }
    attachListenersIfNeeded(rec) {
        if (rec.listenerAttached || !rec.wc.debugger?.on) {
            return;
        }
        rec.listenerAttached = true;
        rec.wc.debugger.on('detach', () => {
            rec.pageEnableEpoch++;
            rec.pageDomainEnabled = false;
            rec.pageEnableInFlight = undefined;
            rec.interceptEnabled = undefined;
            void this.syncPopupGuardAllowFlag(rec, false);
            if (rec.pendingChooser) {
                clearTimeout(rec.pendingChooser.timer);
                rec.pendingChooser = undefined;
            }
        });
        rec.wc.debugger.on('message', (_event, method, rawParams) => {
            if (method === 'Page.fileChooserOpened') {
                this.onFileChooserOpened(rec, rawParams);
            }
        });
    }
    onFileChooserOpened(rec, rawParams) {
        const backendNodeId = typeof rawParams?.backendNodeId === 'number' &&
            rawParams.backendNodeId > 0
            ? rawParams.backendNodeId
            : undefined;
        const policyEnabled = rec.policy?.enabled === true && !this.isRecordOnProtectedIdp(rec);
        if (!policyEnabled) {
            if (backendNodeId !== undefined &&
                (rec.fallbackContext?.().suppressNativePopups === true ||
                    rec.policy?.enabled === true)) {
                void rec.wc.debugger
                    ?.sendCommand?.('DOM.setFileInputFiles', { files: [], backendNodeId })
                    .catch(() => undefined);
            }
            return;
        }
        this.cancelPendingChooser(rec);
        const chooserId = `fc_${this.nextChooserSeq++}`;
        const multiple = rawParams?.mode === 'selectMultiple';
        const frameId = typeof rawParams?.frameId === 'string' && rawParams.frameId
            ? rawParams.frameId
            : undefined;
        const url = rec.wc.getURL?.() || '';
        const tabKey = rec.policy?.tabKey ?? rec.fallbackContext?.().tabKey;
        const dbg = rec.wc.debugger;
        const timer = setTimeout(() => {
            if (rec.pendingChooser?.chooserId === chooserId) {
                rec.pendingChooser = undefined;
                if (backendNodeId !== undefined) {
                    void dbg
                        ?.sendCommand?.('DOM.setFileInputFiles', { files: [], backendNodeId })
                        .catch(() => undefined);
                }
            }
        }, this.chooserTimeoutMs);
        const verifyPromise = (0, guestFileAttachment_1.verifySameOriginChooserFrame)(dbg, rec.wc, frameId);
        rec.pendingChooser = {
            chooserId,
            frameId,
            backendNodeId,
            multiple,
            mainOrigin: '',
            verifyPromise,
            timer,
        };
        void verifyPromise.then(async ({ allowed, mainOrigin, frameOrigin, frameUrl }) => {
            if (rec.pendingChooser?.chooserId !== chooserId) {
                return;
            }
            if (!allowed ||
                !rec.policy?.enabled ||
                this.isRecordOnProtectedIdp(rec)) {
                this.cancelPendingChooser(rec);
                return;
            }
            rec.pendingChooser.mainOrigin = mainOrigin;
            const domPath = dbg
                ? await (0, guestFileAttachment_1.resolveConnectedDomPathForBackendNode)(dbg, frameId, backendNodeId)
                : undefined;
            if (rec.pendingChooser?.chooserId !== chooserId ||
                rec.wc.isDestroyed?.()) {
                return;
            }
            if (!rec.sender || rec.sender.isDestroyed()) {
                this.cancelPendingChooser(rec);
                return;
            }
            try {
                rec.sender.send(guestFileAttachment_1.WEBVIEW_FILE_CHOOSER_OPENED_CHANNEL, {
                    chooserId,
                    webContentsId: rec.wc.id,
                    ...(tabKey ? { tabKey } : {}),
                    multiple,
                    url,
                    frameOrigin: frameOrigin || mainOrigin,
                    ...(frameUrl ? { frameUrl } : {}),
                    ...(domPath ? { domPath } : {}),
                });
            }
            catch {
                // Ignore send errors on tearing-down renderer frames.
            }
        });
    }
    cancelPendingChooser(rec) {
        const pending = rec.pendingChooser;
        if (!pending) {
            return;
        }
        clearTimeout(pending.timer);
        rec.pendingChooser = undefined;
        if (pending.backendNodeId !== undefined) {
            void rec.wc.debugger
                ?.sendCommand?.('DOM.setFileInputFiles', {
                files: [],
                backendNodeId: pending.backendNodeId,
            })
                .catch(() => undefined);
        }
    }
}
exports.GuestFileChooserController = GuestFileChooserController;
exports.guestFileChooserController = new GuestFileChooserController();
