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
exports.disposeCaptureWindow = exports.onCapturePageEvent = exports.closeAllCaptureSessions = exports.closeCaptureSession = exports.updateCaptureSessionState = exports.openCaptureSession = exports.CaptureWindowManager = exports.CAPTURE_PRELOAD_PATH = exports.BROWSER_STREAM_CSP = exports.CAPTURE_SCRIPT_URL = exports.CAPTURE_PAGE_URL = exports.BROWSER_STREAM_PARTITION = void 0;
exports.isBrowserStreamSession = isBrowserStreamSession;
exports.shouldAllowBrowserStreamRequest = shouldAllowBrowserStreamRequest;
exports.handleBrowserStreamProtocolRequest = handleBrowserStreamProtocolRequest;
exports.resetCaptureWindowStateForTests = resetCaptureWindowStateForTests;
/**
 * Isolated capture session and lazy hidden `BrowserWindow` manager hosting the
 * `agy-browser-stream://capture/` WebRTC tab-capture runtime.
 */
const electron_1 = require("electron");
const crypto = __importStar(require("crypto"));
const path_1 = __importDefault(require("path"));
const customScheme_1 = require("../customScheme");
const hubWindows_1 = require("../hubWindows");
const capturePage_1 = require("./capturePage");
const capturePreload_1 = require("./capturePreload");
exports.BROWSER_STREAM_PARTITION = `agy-browser-stream-${crypto.randomUUID()}`;
exports.CAPTURE_PAGE_URL = `${customScheme_1.BROWSER_STREAM_SCHEME}://capture/`;
exports.CAPTURE_SCRIPT_URL = `${customScheme_1.BROWSER_STREAM_SCHEME}://capture/capture.js`;
exports.BROWSER_STREAM_CSP = "default-src 'none'; script-src 'self'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";
exports.CAPTURE_PRELOAD_PATH = path_1.default.join(__dirname, 'capturePreload.js');
const READY_TIMEOUT_MS = 10000;
const GATHER_TIMEOUT_MS = 5000;
const ACK_TIMEOUT_MS = 5000;
const ROUTES = {
    '/': [capturePage_1.renderCapturePageHtml, 'text/html; charset=utf-8'],
    '/capture.js': [capturePage_1.renderCapturePageScript, 'text/javascript; charset=utf-8'],
};
const browserStreamSessions = new WeakSet();
const configuredSessions = new WeakSet();
let creatingBrowserStreamSession = false;
let cachedCaptureSession = null;
let activeCaptureWcGetter = () => null;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0;
function bindEmitter(t, ev, fn) {
    t.on(ev, fn);
    return () => (t.removeListener ? t.removeListener(ev, fn) : t.off?.(ev, fn));
}
/** Whether `targetSession` is the isolated browser-stream capture session. */
function isBrowserStreamSession(targetSession) {
    if (!targetSession || typeof targetSession !== 'object') {
        return false;
    }
    if (creatingBrowserStreamSession) {
        browserStreamSessions.add(targetSession);
        return true;
    }
    return browserStreamSessions.has(targetSession);
}
/** Allows only `agy-browser-stream://capture/...` requests with no credentials or port. */
function shouldAllowBrowserStreamRequest(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) {
        return false;
    }
    try {
        const u = new URL(rawUrl);
        return (u.protocol === `${customScheme_1.BROWSER_STREAM_SCHEME}:` &&
            u.hostname === 'capture' &&
            !u.port &&
            !u.username &&
            !u.password &&
            u.pathname.startsWith('/'));
    }
    catch {
        return false;
    }
}
/** Serves the static capture HTML and IIFE script on `agy-browser-stream://capture/`. */
function handleBrowserStreamProtocolRequest(request) {
    if (request.method !== 'GET') {
        return new Response(null, { status: 405 });
    }
    if (!shouldAllowBrowserStreamRequest(request.url)) {
        return new Response(null, { status: 404 });
    }
    const { pathname, search } = new URL(request.url);
    const route = search === '' ? ROUTES[pathname] : undefined;
    if (!route) {
        return new Response(null, { status: 404 });
    }
    return new Response(route[0](), {
        status: 200,
        headers: {
            'Content-Type': route[1],
            'Content-Security-Policy': exports.BROWSER_STREAM_CSP,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
        },
    });
}
function isCaptureSecurityOrigin(rawOrigin) {
    if (typeof rawOrigin !== 'string' || !rawOrigin) {
        return false;
    }
    try {
        const u = new URL(rawOrigin);
        return (u.protocol === `${customScheme_1.BROWSER_STREAM_SCHEME}:` &&
            u.hostname === 'capture' &&
            !u.port &&
            !u.username &&
            !u.password &&
            (u.pathname === '' || u.pathname === '/') &&
            u.search === '' &&
            u.hash === '');
    }
    catch {
        return false;
    }
}
function isAllowedCaptureMediaPermissionRequest(wc, permission, details, activeCaptureWc) {
    const mediaTypes = details?.mediaTypes;
    return (permission === 'media' &&
        activeCaptureWc !== null &&
        wc === activeCaptureWc &&
        !wc.isDestroyed?.() &&
        details?.isMainFrame === true &&
        Array.isArray(mediaTypes) &&
        mediaTypes.length === 1 &&
        mediaTypes[0] === 'video' &&
        typeof details.requestingUrl === 'string' &&
        shouldAllowBrowserStreamRequest(details.requestingUrl) &&
        (details.securityOrigin === undefined ||
            isCaptureSecurityOrigin(details.securityOrigin)));
}
function ensureConfiguredCaptureSession(getActiveCaptureWc) {
    activeCaptureWcGetter = getActiveCaptureWc;
    if (!cachedCaptureSession) {
        creatingBrowserStreamSession = true;
        try {
            cachedCaptureSession = electron_1.session.fromPartition(exports.BROWSER_STREAM_PARTITION);
            browserStreamSessions.add(cachedCaptureSession);
        }
        finally {
            creatingBrowserStreamSession = false;
        }
    }
    const ses = cachedCaptureSession;
    (ses.getPreloadScripts?.() ?? []).forEach((s) => ses.unregisterPreloadScript(s.id));
    if ((ses.getPreloads?.().length ?? 0) > 0) {
        ses.setPreloads?.([]);
    }
    const preloadCount = (ses.getPreloadScripts?.().length ?? 0) + (ses.getPreloads?.().length ?? 0);
    if (preloadCount > 0) {
        throw new Error('Capture session has unexpected preload scripts');
    }
    if (!configuredSessions.has(ses)) {
        const allow = shouldAllowBrowserStreamRequest;
        ses.setPermissionCheckHandler(() => false);
        ses.setPermissionRequestHandler((wc, permission, cb, details) => {
            cb(isAllowedCaptureMediaPermissionRequest(wc, permission, details, activeCaptureWcGetter()));
        });
        ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !allow(d.url) }));
        ses.protocol.handle(customScheme_1.BROWSER_STREAM_SCHEME, handleBrowserStreamProtocolRequest);
        configuredSessions.add(ses);
    }
    return ses;
}
/** Manages the lazy hidden capture `BrowserWindow` and active capture sessions. */
class CaptureWindowManager {
    constructor(options) {
        this.sessions = new Map();
        this.pendingAcks = new Map();
        this.eventListeners = new Set();
        this.win = null;
        this.readyPromise = null;
        this.onWindowReady = null;
        this.detachWindowListeners = null;
        this.closingCount = 0;
        this.nextSeq = 0;
        this.readyTimeoutMs = options?.readyTimeoutMs ?? READY_TIMEOUT_MS;
        this.customAckTimeoutMs = options?.ackTimeoutMs;
    }
    onEvent(listener) {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }
    async openSession(params) {
        const { sessionId, tabId, targetWebContents, ackTimeoutMs, ...sessionOpts } = params;
        if (!sessionId || !tabId) {
            throw new Error('Missing capture sessionId or tabId');
        }
        const token = Symbol(sessionId);
        const entry = {
            tabId,
            token,
            status: 'opening',
            dispatchedOpen: Boolean(this.sessions.get(sessionId)?.dispatchedOpen),
        };
        this.sessions.set(sessionId, entry);
        let accepted = false;
        try {
            const win = await this.ensureReadyWindow();
            if (this.sessions.get(sessionId)?.token !== token) {
                throw new Error('Capture session closed or superseded while warming');
            }
            if (targetWebContents.isDestroyed?.()) {
                throw new Error('Target WebContents is destroyed');
            }
            const srcId = targetWebContents.getMediaSourceId(win.webContents);
            if (!isNonEmptyStr(srcId)) {
                throw new Error('Failed to mint tab capture media source ID');
            }
            entry.dispatchedOpen = true;
            const ms = ackTimeoutMs ??
                this.customAckTimeoutMs ??
                Math.max(10000, (params.gatherTimeoutMs ?? GATHER_TIMEOUT_MS) + 5000);
            const ack = await this.sendCommandWithAck({
                type: 'open_session',
                sessionId,
                tabId,
                chromeMediaSourceId: srcId,
                ...sessionOpts,
            }, ms, 'Failed to open capture session', (r) => {
                const cur = this.sessions.get(sessionId);
                if (r.ok && r.answerSdp) {
                    if (cur?.token === token) {
                        cur.status = 'active';
                        accepted = true;
                    }
                    else if (!cur) {
                        this.sendBestEffort({ type: 'close_session', sessionId });
                        this.destroyWindowIfIdle();
                    }
                }
                else if (cur?.token === token) {
                    this.sessions.delete(sessionId);
                    this.destroyWindowIfIdle();
                }
            });
            if (!ack.answerSdp || !accepted) {
                const msg = ack.answerSdp
                    ? 'Capture session closed or superseded while opening'
                    : ack.error || 'Failed to open capture session';
                throw new Error(msg);
            }
            return { answerSdp: ack.answerSdp };
        }
        catch (err) {
            if (this.sessions.get(sessionId)?.token === token) {
                this.sessions.delete(sessionId);
                if (entry.dispatchedOpen) {
                    this.sendBestEffort({ type: 'close_session', sessionId });
                }
            }
            this.destroyWindowIfIdle();
            throw err;
        }
    }
    async updateState(sessionId, patch, opts) {
        if (this.sessions.get(sessionId)?.status !== 'active') {
            throw new Error(`Capture session "${sessionId}" is not active`);
        }
        await this.sendCommandWithAck({ type: 'update_state', sessionId, ...patch }, opts, 'Failed to update capture session state');
    }
    async closeSession(sessionId, opts) {
        const send = Boolean(this.sessions.get(sessionId)?.dispatchedOpen);
        this.sessions.delete(sessionId);
        await this.finishClose(send, { type: 'close_session', sessionId }, opts);
    }
    async closeAll(opts) {
        const send = [...this.sessions.values()].some((e) => e.dispatchedOpen);
        this.sessions.clear();
        await this.finishClose(send, { type: 'close_all' }, opts);
    }
    dispose() {
        this.teardownWindow('window_disposed', 'closed');
    }
    resetForTests() {
        this.eventListeners.clear();
        this.sessions.clear();
        this.teardownWindow('Capture window reset');
    }
    async finishClose(send, cmd, opts) {
        this.closingCount++;
        try {
            if (send && this.hasReadyWindow()) {
                await this.sendCommandWithAck(cmd, opts, 'Failed to close session');
            }
        }
        finally {
            this.closingCount--;
            this.destroyWindowIfIdle();
        }
    }
    isWindowAlive() {
        const w = this.win;
        return Boolean(w && !w.isDestroyed?.() && !w.webContents.isDestroyed?.());
    }
    hasReadyWindow() {
        return !this.readyPromise && this.isWindowAlive();
    }
    destroyWindowIfIdle() {
        if (this.sessions.size === 0 && this.closingCount === 0) {
            this.teardownWindow('Capture window idle');
        }
    }
    sendBestEffort(command) {
        if (this.isWindowAlive()) {
            try {
                this.win?.webContents.send(capturePreload_1.BROWSER_STREAM_COMMAND_CHANNEL, command);
            }
            catch {
                // Ignore send failures on tearing-down windows.
            }
        }
    }
    sendCommandWithAck(payload, t, fallbackError, onAck) {
        const win = this.win;
        if (!win || !this.hasReadyWindow()) {
            return Promise.reject(new Error('Capture window is not ready'));
        }
        const requestId = `req-${++this.nextSeq}-${crypto.randomUUID()}`;
        const cmd = { ...payload, requestId };
        const ms = typeof t === 'number'
            ? t
            : (t?.ackTimeoutMs ?? this.customAckTimeoutMs ?? ACK_TIMEOUT_MS);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingAcks.delete(requestId);
                reject(new Error(`Capture command "${cmd.type}" timed out`));
            }, ms);
            this.pendingAcks.set(requestId, {
                fallbackError,
                onAck,
                resolve,
                reject,
                timer,
            });
            try {
                win.webContents.send(capturePreload_1.BROWSER_STREAM_COMMAND_CHANNEL, cmd);
            }
            catch (e) {
                clearTimeout(timer);
                this.pendingAcks.delete(requestId);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }
    handleIpc(kind, ev, raw) {
        const wc = this.win?.webContents;
        const f = ev?.senderFrame;
        if (!wc ||
            ev.sender !== wc ||
            ev.sender.isDestroyed?.() ||
            (typeof wc.getType === 'function' && wc.getType() !== 'window') ||
            !f ||
            typeof f !== 'object' ||
            f.parent ||
            (wc.mainFrame && f !== wc.mainFrame) ||
            (f.url && f.url !== exports.CAPTURE_PAGE_URL) ||
            !isPlainObject(raw)) {
            return;
        }
        if (kind === 'ack') {
            if (!isNonEmptyStr(raw.requestId) || typeof raw.ok !== 'boolean') {
                return;
            }
            const pending = this.pendingAcks.get(raw.requestId);
            if (!pending) {
                return;
            }
            const ack = {
                requestId: raw.requestId,
                ok: raw.ok,
                answerSdp: typeof raw.answerSdp === 'string' ? raw.answerSdp : undefined,
                error: typeof raw.error === 'string' ? raw.error : undefined,
            };
            this.pendingAcks.delete(ack.requestId);
            clearTimeout(pending.timer);
            pending.onAck?.(ack);
            if (!ack.ok) {
                pending.reject(new Error(ack.error || pending.fallbackError));
            }
            else {
                pending.resolve(ack);
            }
            return;
        }
        if (raw.type === 'ready') {
            this.onWindowReady?.();
            return;
        }
        const { sessionId, tabId, state, reason } = raw;
        if (!isNonEmptyStr(sessionId) || !isNonEmptyStr(tabId)) {
            return;
        }
        const cur = this.sessions.get(sessionId);
        if (!cur || cur.status !== 'active' || cur.tabId !== tabId) {
            return;
        }
        if (raw.type === 'viewer_message' && isPlainObject(raw.message)) {
            try {
                const message = (0, capturePage_1.parseCaptureViewerMessage)(JSON.stringify(raw.message));
                if (message) {
                    this.emit({ type: 'viewer_message', sessionId, tabId, message });
                }
            }
            catch {
                // Ignore unserializable viewer payloads.
            }
        }
        else if (raw.type === 'session_state' &&
            (state === 'connected' || state === 'failed' || state === 'closed') &&
            (reason === undefined || typeof reason === 'string')) {
            if (state !== 'connected') {
                this.sessions.delete(sessionId);
                this.destroyWindowIfIdle();
            }
            const extra = typeof reason === 'string' ? { reason } : {};
            this.emit({ type: 'session_state', sessionId, tabId, state, ...extra });
        }
    }
    emit(event) {
        for (const listener of [...this.eventListeners]) {
            try {
                listener(event);
            }
            catch {
                // Isolate subscriber errors from session state transitions.
            }
        }
    }
    ensureReadyWindow() {
        if (this.hasReadyWindow() && this.win) {
            return Promise.resolve(this.win);
        }
        if (this.readyPromise) {
            return this.readyPromise;
        }
        if (this.win) {
            this.teardownWindow('Replacing stale capture window');
        }
        ensureConfiguredCaptureSession(() => this.win && !this.win.isDestroyed?.() ? this.win.webContents : null);
        const win = new electron_1.BrowserWindow({
            show: false,
            skipTaskbar: true,
            focusable: false,
            webPreferences: {
                backgroundThrottling: false,
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                webviewTag: false,
                navigateOnDragDrop: false,
                partition: exports.BROWSER_STREAM_PARTITION,
                preload: exports.CAPTURE_PRELOAD_PATH,
            },
        });
        this.win = win;
        (0, hubWindows_1.registerAuxWindow)(win);
        win.webContents.setWebRTCIPHandlingPolicy?.('default');
        win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
        let settled = false;
        const readyPromise = new Promise((resolve, reject) => {
            const fail = (msg) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    if (this.win === win) {
                        this.teardownWindow(msg);
                    }
                    reject(new Error(msg));
                }
            };
            const timer = setTimeout(() => fail('Capture window timed out waiting for ready'), this.readyTimeoutMs);
            this.onWindowReady = () => {
                if (!settled && this.win === win) {
                    settled = true;
                    clearTimeout(timer);
                    this.onWindowReady = null;
                    this.readyPromise = null;
                    resolve(win);
                }
            };
            const die = (st, why, msg) => {
                if (!settled) {
                    fail(msg);
                }
                else if (this.win === win) {
                    this.teardownWindow(why, st);
                }
            };
            const wc = win.webContents;
            const ipc = electron_1.ipcMain;
            const block = ((e) => e.preventDefault());
            const onNav = ((e, u) => {
                if ((typeof e?.url === 'string' ? e.url : u) !== exports.CAPTURE_PAGE_URL) {
                    e.preventDefault();
                }
            });
            const onFail = ((...a) => {
                if (a[4] !== false) {
                    fail(`Capture window load failed (${String(a[1] ?? '')}: ${String(a[2] ?? '')})`);
                }
            });
            const onGone = ((_e, d) => {
                const r = d?.reason || 'render_process_gone';
                die('failed', r, `Capture window render process gone: ${r}`);
            });
            const unsubs = [
                bindEmitter(wc, 'will-attach-webview', block),
                bindEmitter(wc, 'will-redirect', block),
                bindEmitter(wc, 'will-navigate', onNav),
                bindEmitter(wc, 'did-fail-load', onFail),
                bindEmitter(wc, 'render-process-gone', onGone),
                bindEmitter(win, 'closed', () => die('closed', 'window_closed', 'Capture window closed')),
                bindEmitter(ipc, capturePreload_1.BROWSER_STREAM_ACK_CHANNEL, ((e, r) => this.handleIpc('ack', e, r))),
                bindEmitter(ipc, capturePreload_1.BROWSER_STREAM_EVENT_CHANNEL, ((e, r) => this.handleIpc('event', e, r))),
            ];
            this.detachWindowListeners = () => {
                clearTimeout(timer);
                this.onWindowReady = null;
                unsubs.forEach((u) => u());
                if (!settled) {
                    settled = true;
                    reject(new Error('Capture window destroyed before ready'));
                }
            };
            void new Promise((r) => r(win.loadURL(exports.CAPTURE_PAGE_URL))).catch((err) => fail(err instanceof Error ? err.message : String(err)));
        });
        if (this.win === win && !settled) {
            this.readyPromise = readyPromise;
        }
        return readyPromise;
    }
    teardownWindow(reason, emitState) {
        const active = emitState
            ? [...this.sessions.entries()].filter(([, e]) => e.status === 'active')
            : [];
        if (emitState) {
            this.sessions.clear();
        }
        const win = this.win;
        const detach = this.detachWindowListeners;
        this.win = null;
        this.readyPromise = null;
        this.onWindowReady = null;
        this.detachWindowListeners = null;
        const pending = [...this.pendingAcks.values()];
        this.pendingAcks.clear();
        for (const item of pending) {
            clearTimeout(item.timer);
            item.reject(new Error(reason));
        }
        detach?.();
        if (win && !win.isDestroyed?.()) {
            const d = win;
            (typeof d.destroy === 'function' ? d.destroy : d.close)?.call(win);
        }
        if (emitState) {
            for (const [sessionId, { tabId }] of active) {
                const st = emitState;
                this.emit({ type: 'session_state', sessionId, tabId, state: st, reason });
            }
        }
    }
}
exports.CaptureWindowManager = CaptureWindowManager;
const manager = new CaptureWindowManager();
exports.openCaptureSession = manager.openSession.bind(manager);
exports.updateCaptureSessionState = manager.updateState.bind(manager);
exports.closeCaptureSession = manager.closeSession.bind(manager);
exports.closeAllCaptureSessions = manager.closeAll.bind(manager);
exports.onCapturePageEvent = manager.onEvent.bind(manager);
const disposeCaptureWindow = () => manager.dispose();
exports.disposeCaptureWindow = disposeCaptureWindow;
function resetCaptureWindowStateForTests() {
    manager.resetForTests();
    cachedCaptureSession = null;
    creatingBrowserStreamSession = false;
    activeCaptureWcGetter = () => null;
}
