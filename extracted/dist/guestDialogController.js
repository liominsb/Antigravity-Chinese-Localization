"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guestDialogController = exports.GuestDialogController = exports.DEFAULT_PAGE_ENABLE_TIMEOUT_MS = exports.DEFAULT_MANUAL_DIALOG_TIMEOUT_MS = exports.WEBVIEW_DIALOG_OPENING_CHANNEL = void 0;
exports.runMainWorldDialogBootstrap = runMainWorldDialogBootstrap;
exports.runMainWorldDialogDisarm = runMainWorldDialogDisarm;
exports.buildMainWorldDialogBootstrapScript = buildMainWorldDialogBootstrapScript;
exports.buildMainWorldDialogDisarmScript = buildMainWorldDialogDisarmScript;
const crypto_1 = require("crypto");
const guestAgentControl_1 = require("./guestAgentControl");
const guestPromptController_1 = require("./guestPromptController");
const guestDebugger_1 = require("./guestDebugger");
const isolatedWorldExec_1 = require("./isolatedWorldExec");
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
    return typeof wc.getURL === 'function' && isBlankOrEmptyGuestUrl(wc.getURL());
}
function normalizeDialogType(raw) {
    return raw === 'alert' ||
        raw === 'confirm' ||
        raw === 'prompt' ||
        raw === 'beforeunload'
        ? raw
        : 'alert';
}
function defaultAcceptForDismissPolicy(dialogType) {
    return dialogType === 'alert' || dialogType === 'beforeunload';
}
/**
 * Self-contained main-world bootstrap function executed inside the guest frame
 * (and serialized via `.toString()` for CDP `Page.addScriptToEvaluateOnNewDocument`).
 */
function runMainWorldDialogBootstrap(winRoot, globalRoot, bindingName, authToken, controlKey, controlToken, initialCfg) {
    let capturedBind = null;
    try {
        const candidate = globalRoot[bindingName];
        if (typeof candidate === 'function') {
            capturedBind = candidate;
        }
        delete globalRoot[bindingName];
    }
    catch {
        // Ignore frozen globalThis properties.
    }
    if (!winRoot || !initialCfg) {
        return;
    }
    const sym = Symbol.for(controlKey);
    const toJson = JSON.stringify;
    const Str = String;
    let sharedReportFn = capturedBind;
    const sharedQueue = [];
    const flushSharedQueue = () => {
        if (typeof sharedReportFn !== 'function') {
            return;
        }
        while (sharedQueue.length > 0) {
            const nextItem = sharedQueue.shift();
            if (nextItem !== undefined) {
                try {
                    sharedReportFn(nextItem);
                }
                catch {
                    // Ignore binding errors during navigation teardown.
                }
            }
        }
    };
    const installOnWindow = (targetWin) => {
        const WinObj = targetWin.Object || Object;
        const defProp = WinObj.defineProperty;
        const getDesc = WinObj.getOwnPropertyDescriptor;
        const hasOwn = WinObj.prototype.hasOwnProperty;
        const snap = (key) => ({
            own: hasOwn.call(targetWin, key),
            desc: getDesc(targetWin, key),
            fn: targetWin[key],
        });
        const saved = {
            alert: snap('alert'),
            confirm: snap('confirm'),
            prompt: snap('prompt'),
        };
        let cur = initialCfg;
        let active = true;
        const setFallbackSym = Symbol.for('__agy_set_prompt_fallback__');
        const restore = (key) => {
            const entry = saved[key];
            try {
                if (entry.own && entry.desc) {
                    defProp(targetWin, key, entry.desc);
                }
                else {
                    delete targetWin[key];
                    if (targetWin[key] !== entry.fn && typeof entry.fn === 'function') {
                        targetWin[key] = entry.fn;
                    }
                }
            }
            catch {
                // Ignore frozen window teardown errors.
            }
        };
        const emit = (type, msg, def, acc, inp) => {
            try {
                let u = '';
                try {
                    const loc = targetWin.location ||
                        winRoot.location;
                    u = loc ? Str(loc.href || '') : '';
                }
                catch {
                    u = '';
                }
                const payload = {
                    token: authToken,
                    type,
                    message: msg,
                    defaultPrompt: def,
                    url: u,
                    accepted: acc,
                };
                if (inp !== undefined) {
                    payload.userInput = inp;
                }
                const raw = toJson(payload);
                if (typeof sharedReportFn === 'function') {
                    sharedReportFn(raw);
                }
                else if (sharedQueue.length < 64) {
                    sharedQueue.push(raw);
                }
            }
            catch {
                // Ignore serialization errors.
            }
        };
        const wAlert = function (...args) {
            if (!active || !cur) {
                return typeof saved.alert.fn === 'function'
                    ? saved.alert.fn.apply(targetWin, args)
                    : undefined;
            }
            emit('alert', args.length === 0 ? '' : Str(args[0]), '', true, undefined);
            return undefined;
        };
        const wConfirm = function (message) {
            if (!active || !cur) {
                return typeof saved.confirm.fn === 'function'
                    ? Boolean(saved.confirm.fn.call(targetWin, message))
                    : false;
            }
            const accepted = cur.action === 'accept';
            emit('confirm', message === undefined ? '' : Str(message), '', accepted, undefined);
            return accepted;
        };
        const wPrompt = function (message, defaultValue) {
            if (!active || !cur) {
                return typeof saved.prompt.fn === 'function'
                    ? (saved.prompt.fn.call(targetWin, message, defaultValue) ?? null)
                    : null;
            }
            const ms = message === undefined ? '' : Str(message);
            const ds = defaultValue === undefined ? '' : Str(defaultValue);
            if (cur.action !== 'accept') {
                emit('prompt', ms, ds, false, undefined);
                return null;
            }
            const ans = cur.hasPromptText ? Str(cur.promptText) : ds;
            emit('prompt', ms, ds, true, ans);
            return ans;
        };
        const ctrl = (tok, next, nextBind) => {
            if (tok !== controlToken) {
                return false;
            }
            if (typeof nextBind === 'function') {
                sharedReportFn = nextBind;
                flushSharedQueue();
            }
            if (!next) {
                if (active) {
                    active = false;
                    cur = null;
                    restore('alert');
                    restore('confirm');
                    restore('prompt');
                    try {
                        delete targetWin[sym];
                    }
                    catch {
                        // Ignore frozen window teardown errors.
                    }
                }
                return true;
            }
            cur = next;
            return true;
        };
        try {
            defProp(wPrompt, setFallbackSym, {
                value: (fn) => {
                    if (typeof fn === 'function') {
                        saved.prompt = {
                            own: true,
                            desc: {
                                value: fn,
                                writable: true,
                                enumerable: true,
                                configurable: true,
                            },
                            fn,
                        };
                    }
                },
                writable: false,
                enumerable: false,
                configurable: false,
            });
        }
        catch {
            // Ignore frozen function prototypes.
        }
        defProp(targetWin, sym, {
            value: ctrl,
            writable: false,
            enumerable: false,
            configurable: true,
        });
        defProp(targetWin, 'alert', {
            value: wAlert,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        defProp(targetWin, 'confirm', {
            value: wConfirm,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        defProp(targetWin, 'prompt', {
            value: wPrompt,
            writable: true,
            enumerable: true,
            configurable: true,
        });
    };
    const seen = [];
    const visitFrame = (w, depth) => {
        if (!w || depth > 8 || seen.indexOf(w) !== -1) {
            return;
        }
        seen.push(w);
        let updated = false;
        try {
            const existing = w[sym];
            if (typeof existing === 'function') {
                updated =
                    existing(controlToken, initialCfg, capturedBind) === true;
            }
        }
        catch {
            updated = false;
        }
        if (!updated) {
            try {
                installOnWindow(w);
            }
            catch {
                // Cross-origin frame access denied; handled via CDP Page.javascriptDialogOpening.
            }
        }
        let frameCount = 0;
        try {
            const frames = w.frames;
            frameCount = typeof frames?.length === 'number' ? frames.length : 0;
        }
        catch {
            frameCount = 0;
        }
        for (let i = 0; i < frameCount; i++) {
            let child = null;
            try {
                child = w.frames[i];
            }
            catch {
                child = null;
            }
            if (child) {
                visitFrame(child, depth + 1);
            }
        }
    };
    visitFrame(winRoot, 0);
}
/**
 * Self-contained main-world disarm function restoring native dialog descriptors
 * across `winRoot` and all accessible nested same-origin subframes.
 */
function runMainWorldDialogDisarm(winRoot, globalRoot, bindingName, controlKey, controlToken) {
    try {
        delete globalRoot[bindingName];
    }
    catch {
        // Ignore frozen globalThis properties.
    }
    if (!winRoot) {
        return;
    }
    const sym = Symbol.for(controlKey);
    const seen = [];
    const visitFrame = (w, depth) => {
        if (!w || depth > 8 || seen.indexOf(w) !== -1) {
            return;
        }
        seen.push(w);
        try {
            const fn = w[sym];
            if (typeof fn === 'function' &&
                fn(controlToken, null) === true) {
                delete w[sym];
            }
        }
        catch {
            // Ignore cross-origin frame errors.
        }
        let frameCount = 0;
        try {
            const frames = w.frames;
            frameCount = typeof frames?.length === 'number' ? frames.length : 0;
        }
        catch {
            frameCount = 0;
        }
        for (let i = 0; i < frameCount; i++) {
            let child = null;
            try {
                child = w.frames[i];
            }
            catch {
                child = null;
            }
            if (child) {
                visitFrame(child, depth + 1);
            }
        }
    };
    visitFrame(winRoot, 0);
}
/**
 * Builds the main-world bootstrap script that synchronously intercepts
 * `window.alert`, `window.confirm`, and `window.prompt` while armed so no macOS
 * `NSAlert` sheet opens and `window.prompt()` works in sandboxed Electron WCVs.
 */
function buildMainWorldDialogBootstrapScript(bindingName, authToken, controlKey, controlToken, cfg) {
    return `(${runMainWorldDialogBootstrap.toString()})(typeof window!=='undefined'?window:undefined,globalThis,${JSON.stringify(bindingName)},${JSON.stringify(authToken)},${JSON.stringify(controlKey)},${JSON.stringify(controlToken)},${JSON.stringify(cfg)});`;
}
/** Builds the main-world teardown script restoring native dialog descriptors. */
function buildMainWorldDialogDisarmScript(bindingName, controlKey, controlToken) {
    return `(${runMainWorldDialogDisarm.toString()})(typeof window!=='undefined'?window:undefined,globalThis,${JSON.stringify(bindingName)},${JSON.stringify(controlKey)},${JSON.stringify(controlToken)});`;
}
/**
 * Coordinates non-blocking synchronous main-world `alert`/`confirm`/`prompt`
 * interception plus CDP `Page.javascriptDialogOpening` capture and
 * `Page.handleJavaScriptDialog` resolution across `<webview>` and `WebContentsView`.
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
    registerGuest(wc, sender, fallbackContext) {
        const rec = this.getOrCreateRecord(wc, sender);
        rec.sender = sender;
        if (fallbackContext) {
            rec.fallbackContext = fallbackContext;
        }
        this.attachListenersIfNeeded(rec);
    }
    async syncFallbackContext(wc) {
        if (!wc || typeof wc.id !== 'number') {
            return false;
        }
        const rec = this.records.get(wc.id);
        if (!rec || rec.wc !== wc) {
            return false;
        }
        if (!this.isInterceptionArmed(rec)) {
            this.flushPendingManual(rec);
            if (this.supportsMainWorldInterception(rec)) {
                await this.syncMainWorldInterceptor(rec);
            }
            return true;
        }
        guestPromptController_1.guestPromptController.cancelForGuest(wc.id);
        if (!this.supportsMainWorldInterception(rec)) {
            return true;
        }
        return this.ensureArmedDomainAndSync(rec);
    }
    async setPolicy(wc, sender, policy) {
        const rec = this.getOrCreateRecord(wc, sender);
        rec.sender = sender;
        rec.policy = { ...policy };
        this.attachListenersIfNeeded(rec);
        if (!policy.enabled) {
            this.flushPendingManual(rec);
            if (this.supportsMainWorldInterception(rec)) {
                await this.syncMainWorldInterceptor(rec);
            }
            return true;
        }
        guestPromptController_1.guestPromptController.cancelForGuest(wc.id);
        return this.ensureArmedDomainAndSync(rec);
    }
    async ensureArmedDomainAndSync(rec) {
        const dbg = rec.wc.debugger;
        if (!dbg || rec.wc.isDestroyed?.()) {
            return false;
        }
        if (!(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            return false;
        }
        this.attachListenersIfNeeded(rec);
        this.attachNavigationListenersIfNeeded(rec);
        if (!rec.pageDomainEnabled) {
            if (isGuestOnBlankOrEmptyUrl(rec.wc)) {
                return true;
            }
            return this.enablePageDomain(rec);
        }
        if (this.supportsMainWorldInterception(rec)) {
            await this.syncMainWorldInterceptor(rec);
        }
        return true;
    }
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
    /**
     * Dismisses any open native JavaScript dialog and cleans up CDP dialog state
     * for `wc` immediately before `WebContents` teardown (`wcvBrowserRegistry.dispose`).
     */
    disposeGuest(wc) {
        if (!wc || typeof wc.id !== 'number') {
            return;
        }
        const rec = this.records.get(wc.id);
        const preloadScriptId = rec?.preloadScriptId;
        const bindingName = rec?.bindingAdded ? rec.bindingName : undefined;
        if (rec && rec.wc === wc) {
            rec.pageEnableEpoch++;
            rec.detachNavListeners?.();
            if (rec.pendingManual) {
                clearTimeout(rec.pendingManual.timer);
                rec.pendingManual = undefined;
            }
            rec.preloadScriptId = undefined;
            rec.bindingAdded = false;
            this.records.delete(wc.id);
        }
        const dbg = wc.debugger;
        if (!wc.isDestroyed?.() &&
            dbg?.isAttached?.() &&
            typeof dbg.sendCommand === 'function') {
            if (preloadScriptId) {
                void dbg
                    .sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
                    identifier: preloadScriptId,
                })
                    .catch(() => undefined);
            }
            if (bindingName) {
                void dbg
                    .sendCommand('Runtime.removeBinding', { name: bindingName })
                    .catch(() => undefined);
            }
            void dbg
                .sendCommand('Page.handleJavaScriptDialog', { accept: false })
                .catch(() => undefined);
        }
    }
    supportsMainWorldInterception(rec) {
        return typeof rec.wc.executeJavaScript === 'function';
    }
    isInterceptionArmed(rec) {
        return (rec.policy?.enabled === true ||
            rec.fallbackContext?.()?.isAgentStepActive === true);
    }
    resolveMainWorldConfig(rec) {
        if (rec.policy?.enabled === true) {
            const action = rec.policy.action ?? 'dismiss';
            const effectiveAction = action === 'accept' ||
                (action === 'manual' && rec.policy.fallbackAction === 'accept')
                ? 'accept'
                : 'dismiss';
            const rawPrompt = action === 'manual'
                ? (rec.policy.fallbackPromptText ?? rec.policy.promptText)
                : rec.policy.promptText;
            return {
                action: effectiveAction,
                hasPromptText: rawPrompt !== undefined,
                promptText: rawPrompt ?? '',
            };
        }
        if (rec.fallbackContext?.()?.isAgentStepActive === true) {
            return { action: 'dismiss', hasPromptText: false, promptText: '' };
        }
        return null;
    }
    syncMainWorldInterceptor(rec) {
        if (!this.supportsMainWorldInterception(rec)) {
            return Promise.resolve();
        }
        const run = async () => {
            const dbg = rec.wc.debugger;
            if (!dbg || rec.wc.isDestroyed?.()) {
                return;
            }
            const cfg = this.resolveMainWorldConfig(rec);
            if (cfg !== null) {
                if (!rec.pageDomainEnabled || typeof dbg.sendCommand !== 'function') {
                    return;
                }
                const epoch = rec.pageEnableEpoch;
                if (!rec.bindingAdded) {
                    try {
                        await dbg.sendCommand('Runtime.addBinding', {
                            name: rec.bindingName,
                        });
                        if (rec.pageEnableEpoch !== epoch || rec.wc.isDestroyed?.()) {
                            return;
                        }
                        rec.bindingAdded = true;
                    }
                    catch {
                        return;
                    }
                }
                if (rec.preloadScriptId) {
                    const prevId = rec.preloadScriptId;
                    rec.preloadScriptId = undefined;
                    await dbg
                        .sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
                        identifier: prevId,
                    })
                        .catch(() => undefined);
                    if (rec.pageEnableEpoch !== epoch || rec.wc.isDestroyed?.()) {
                        return;
                    }
                }
                const latestCfg = this.resolveMainWorldConfig(rec);
                if (!latestCfg) {
                    return;
                }
                const source = buildMainWorldDialogBootstrapScript(rec.bindingName, rec.authToken, rec.controlKey, rec.controlToken, latestCfg);
                try {
                    const res = (await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true }));
                    if (rec.pageEnableEpoch !== epoch || rec.wc.isDestroyed?.()) {
                        return;
                    }
                    if (typeof res?.identifier === 'string') {
                        rec.preloadScriptId = res.identifier;
                    }
                    else if (!isGuestOnBlankOrEmptyUrl(rec.wc) &&
                        typeof rec.wc.executeJavaScript === 'function') {
                        await (0, isolatedWorldExec_1.executeJavaScriptWhenReady)(rec.wc, source).catch(() => undefined);
                    }
                }
                catch {
                    if (!isGuestOnBlankOrEmptyUrl(rec.wc) &&
                        typeof rec.wc.executeJavaScript === 'function') {
                        await (0, isolatedWorldExec_1.executeJavaScriptWhenReady)(rec.wc, source).catch(() => undefined);
                    }
                }
                return;
            }
            if (typeof dbg.sendCommand === 'function' && dbg.isAttached?.()) {
                if (rec.preloadScriptId) {
                    const prevId = rec.preloadScriptId;
                    rec.preloadScriptId = undefined;
                    await dbg
                        .sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
                        identifier: prevId,
                    })
                        .catch(() => undefined);
                }
                if (rec.bindingAdded) {
                    rec.bindingAdded = false;
                    await dbg
                        .sendCommand('Runtime.removeBinding', { name: rec.bindingName })
                        .catch(() => undefined);
                }
                if (!isGuestOnBlankOrEmptyUrl(rec.wc) && !rec.wc.isDestroyed?.()) {
                    const disarmSource = buildMainWorldDialogDisarmScript(rec.bindingName, rec.controlKey, rec.controlToken);
                    try {
                        const evalRes = (await dbg.sendCommand('Runtime.evaluate', {
                            expression: disarmSource,
                        }));
                        if ((!evalRes || typeof evalRes.result !== 'object') &&
                            typeof rec.wc.executeJavaScript === 'function') {
                            await (0, isolatedWorldExec_1.executeJavaScriptWhenReady)(rec.wc, disarmSource).catch(() => undefined);
                        }
                    }
                    catch {
                        if (typeof rec.wc.executeJavaScript === 'function') {
                            await (0, isolatedWorldExec_1.executeJavaScriptWhenReady)(rec.wc, disarmSource).catch(() => undefined);
                        }
                    }
                }
            }
        };
        const next = (rec.mainWorldSyncChain ?? Promise.resolve()).then(run, run);
        rec.mainWorldSyncChain = next.finally(() => {
            if (rec.mainWorldSyncChain === next) {
                rec.mainWorldSyncChain = undefined;
            }
        });
        return next;
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
                bindingName: `__agyDlgBind_${(0, crypto_1.randomBytes)(16).toString('hex')}`,
                authToken: (0, crypto_1.randomBytes)(32).toString('hex'),
                controlKey: `__agyDlgCtrl_${(0, crypto_1.randomBytes)(32).toString('hex')}`,
                controlToken: (0, crypto_1.randomBytes)(32).toString('hex'),
                bindingAdded: false,
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
            if (this.isInterceptionArmed(rec) && !rec.pageDomainEnabled) {
                void this.enablePageDomain(rec);
            }
        };
        const onDidNavigate = (_event, url) => {
            const navUrl = typeof url === 'string' ? url : rec.wc.getURL?.();
            if (isBlankOrEmptyGuestUrl(navUrl) || !this.isInterceptionArmed(rec)) {
                return;
            }
            if (!rec.pageDomainEnabled) {
                void this.enablePageDomain(rec);
            }
            else if (this.supportsMainWorldInterception(rec)) {
                // `Runtime.addBinding` without `Runtime.enable` is not replayed by
                // Chromium across cross-process RenderFrameHost swaps; re-bind and
                // flush any queued early-document dialog reports on navigation commit.
                rec.bindingAdded = false;
                void this.syncMainWorldInterceptor(rec);
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
                if (this.supportsMainWorldInterception(rec)) {
                    await this.syncMainWorldInterceptor(rec);
                }
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
            rec.bindingAdded = false;
            rec.preloadScriptId = undefined;
            if (rec.pendingManual) {
                clearTimeout(rec.pendingManual.timer);
                rec.pendingManual = undefined;
            }
        });
        dbg.on('message', (_event, method, rawParams) => {
            if (method === 'Runtime.bindingCalled') {
                this.onBindingCalled(rec, rawParams);
                return;
            }
            if (method === 'Page.javascriptDialogClosed') {
                if (rec.pendingManual) {
                    clearTimeout(rec.pendingManual.timer);
                    rec.pendingManual = undefined;
                }
                return;
            }
            if (method === 'Page.javascriptDialogOpening') {
                this.onDialogOpening(rec, rawParams);
            }
        });
    }
    onBindingCalled(rec, rawParams) {
        if (rawParams?.name !== rec.bindingName ||
            typeof rawParams.payload !== 'string' ||
            !this.isInterceptionArmed(rec)) {
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(rawParams.payload);
        }
        catch {
            return;
        }
        if (!parsed ||
            typeof parsed !== 'object' ||
            parsed.token !== rec.authToken) {
            return;
        }
        const tabKey = rec.policy?.tabKey ?? rec.fallbackContext?.()?.tabKey;
        const eventPayload = {
            dialogId: `dlg_${this.nextDialogSeq++}`,
            webContentsId: rec.wc.id,
            type: normalizeDialogType(parsed.type),
            message: typeof parsed.message === 'string' ? parsed.message : '',
            defaultPrompt: typeof parsed.defaultPrompt === 'string' ? parsed.defaultPrompt : '',
            url: typeof parsed.url === 'string' && parsed.url
                ? parsed.url
                : rec.wc.getURL?.() || '',
            handled: true,
            accepted: Boolean(parsed.accepted),
        };
        if (tabKey) {
            eventPayload.tabKey = tabKey;
        }
        if (typeof parsed.userInput === 'string') {
            eventPayload.userInput = parsed.userInput;
        }
        this.emitToSender(rec.sender, eventPayload);
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
        const manualFallbackAction = policyEnabled
            ? rec.policy?.fallbackAction
            : undefined;
        if (action === 'manual' &&
            manualFallbackAction === undefined &&
            dialogType !== 'beforeunload') {
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
            rec.pendingManual = { dialogId, type: dialogType, defaultPrompt, timer };
            const manualPayload = {
                dialogId,
                webContentsId: rec.wc.id,
                type: dialogType,
                message,
                defaultPrompt,
                url,
                handled: false,
            };
            if (tabKey) {
                manualPayload.tabKey = tabKey;
            }
            this.emitToSender(rec.sender, manualPayload);
            return;
        }
        const effectiveAction = action === 'manual' ? (manualFallbackAction ?? 'dismiss') : action;
        const effectivePrompt = action === 'manual'
            ? (rec.policy?.fallbackPromptText ?? rec.policy?.promptText)
            : rec.policy?.promptText;
        const accepted = effectiveAction === 'accept'
            ? true
            : defaultAcceptForDismissPolicy(dialogType);
        const cmdParams = { accept: accepted };
        let userInput;
        if (policyEnabled && effectivePrompt !== undefined) {
            cmdParams.promptText = effectivePrompt;
            if (dialogType === 'prompt' && accepted) {
                userInput = effectivePrompt;
            }
        }
        else if (dialogType === 'prompt' && accepted) {
            if (defaultPrompt) {
                cmdParams.promptText = defaultPrompt;
            }
            userInput = defaultPrompt;
        }
        const dbg = rec.wc.debugger;
        const canSend = Boolean(dbg && typeof dbg.sendCommand === 'function' && !rec.wc.isDestroyed?.());
        if (canSend) {
            void dbg.sendCommand('Page.handleJavaScriptDialog', cmdParams).catch(() => undefined);
        }
        const autoPayload = {
            dialogId,
            webContentsId: rec.wc.id,
            type: dialogType,
            message,
            defaultPrompt,
            url,
            handled: canSend,
            accepted: canSend ? accepted : false,
        };
        if (tabKey) {
            autoPayload.tabKey = tabKey;
        }
        if (canSend && userInput !== undefined) {
            autoPayload.userInput = userInput;
        }
        this.emitToSender(rec.sender, autoPayload);
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
    /**
     * Returns `true` when guest `webContentsId` currently has agent dialog
     * interception armed.
     */
    isAgentDialogArmed(webContentsId) {
        const rec = this.records.get(webContentsId);
        if (!rec || rec.wc.isDestroyed?.()) {
            return false;
        }
        return this.isInterceptionArmed(rec);
    }
}
exports.GuestDialogController = GuestDialogController;
exports.guestDialogController = new GuestDialogController();
(0, guestAgentControl_1.registerGuestAgentControlPredicate)((webContentsId) => exports.guestDialogController.isAgentDialogArmed(webContentsId));
