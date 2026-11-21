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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserViewerHandler = exports.MAX_BROWSER_VIEWER_HOST_LABEL_RUNES = exports.BROWSER_VIEWER_RECONCILE_INTERVAL_MS = exports.BROWSER_VIEWER_HOST_LEASE_GRACE_MS = exports.BROWSER_VIEWER_SESSION_TTL_MS = exports.MAX_BROWSER_VIEWER_SESSIONS = exports.BROWSER_VIEWER_ACTUATOR_TYPE_VERSION = exports.BROWSER_VIEWER_ACTUATOR_TYPE = void 0;
exports.registerBrowserViewer = registerBrowserViewer;
exports.syncBrowserViewerHostPresence = syncBrowserViewerHostPresence;
exports.resetBrowserViewerSessions = resetBrowserViewerSessions;
exports.unregisterBrowserViewer = unregisterBrowserViewer;
/** Main-process `browser_viewer` `ActuatorHandler` and session/control lifecycle. */
const protobuf_1 = require("@bufbuild/protobuf");
const crypto = __importStar(require("crypto"));
const electron_1 = require("electron");
const os = __importStar(require("os"));
const mainClient_1 = require("../actuator/mainClient");
const pb = __importStar(require("../proto/browser_viewer_pb"));
const utils_1 = require("../utils");
const wcvBrowserRegistry_1 = require("../wcvBrowserRegistry");
const drvMod = __importStar(require("./browserViewerTabDriver"));
const snapMod = __importStar(require("./browserViewerTabSnapshot"));
const policy = __importStar(require("./browserViewerUrlPolicy"));
const capMod = __importStar(require("./captureWindow"));
exports.BROWSER_VIEWER_ACTUATOR_TYPE = 'browser_viewer';
exports.BROWSER_VIEWER_ACTUATOR_TYPE_VERSION = 1;
exports.MAX_BROWSER_VIEWER_SESSIONS = 4;
exports.BROWSER_VIEWER_SESSION_TTL_MS = 30000;
exports.BROWSER_VIEWER_HOST_LEASE_GRACE_MS = 10000;
exports.BROWSER_VIEWER_RECONCILE_INTERVAL_MS = 250;
exports.MAX_BROWSER_VIEWER_HOST_LABEL_RUNES = 64;
const INVALID_REQ = 'ACTUATOR_ERROR_CODE_INVALID_REQUEST';
const NO_HOST = 'No open local browser host';
const computeClientDeadlineMs = (nowMs, expiresUnixMs) => expiresUnixMs <= 0n
    ? nowMs + exports.BROWSER_VIEWER_SESSION_TTL_MS
    : Math.min(Number(expiresUnixMs), nowMs + exports.BROWSER_VIEWER_SESSION_TTL_MS);
const errRes = snapMod.createBrowserViewerErrorResult;
const okRes = () => (0, protobuf_1.create)(pb.BrowserViewerResultSchema, {});
const errMsg = (err, fallback) => err instanceof Error && err.message ? err.message : fallback;
const tokensMatchConstantTime = (provided, expected) => {
    if (typeof provided !== 'string' ||
        typeof expected !== 'string' ||
        !policy.isValidControlToken(provided) ||
        !policy.isValidControlToken(expected)) {
        return false;
    }
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const digestState = (s) => [
    JSON.stringify(s.tabMeta),
    s.cssCursor,
    JSON.stringify(s.agentCursor),
    s.devicePixelRatio,
];
const defaultCapture = {
    openSession: capMod.openCaptureSession,
    updateState: capMod.updateCaptureSessionState,
    closeSession: capMod.closeCaptureSession,
    closeAll: capMod.closeAllCaptureSessions,
    onEvent: capMod.onCapturePageEvent,
};
const defaultActuatorId = () => {
    const h = crypto.createHash('sha256').update(os.hostname() || 'local');
    return `browser-viewer-${h.digest('hex').slice(0, 8)}`;
};
const isValidScope = (rootId, sid) => policy.isValidRootConversationId(rootId) &&
    typeof sid === 'string' &&
    policy.isValidViewerSessionId(sid);
const isCapDim = (v) => typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 0 &&
    v <= policy.MAX_BLOB_DIMENSION_PX;
const swallow = async (op) => {
    try {
        await op();
    }
    catch {
        /* ignore teardown race */
    }
};
/** Serves `browser_viewer` on Desktop Hub's main-process `ActuatorClient`. */
class BrowserViewerHandler {
    constructor(opts = {}) {
        this.opts = opts;
        this.actuatorType = exports.BROWSER_VIEWER_ACTUATOR_TYPE;
        this.actuatorTypeVersion = exports.BROWSER_VIEWER_ACTUATOR_TYPE_VERSION;
        this.actuatorId = this.opts.actuatorId ?? defaultActuatorId();
        this.schemas = {
            hello: pb.BrowserViewerHelloSchema,
            request: pb.BrowserViewerRequestSchema,
            result: pb.BrowserViewerResultSchema,
        };
        this.maxSessions = this.opts.maxSessions ?? exports.MAX_BROWSER_VIEWER_SESSIONS;
        this.now = this.opts.now ?? Date.now;
        this.registry = this.opts.registry ?? wcvBrowserRegistry_1.wcvBrowserRegistry;
        this.cap = this.opts.capture ?? defaultCapture;
        this.onFocus = this.opts.onFocusChange ?? utils_1.onHubWindowFocusChange;
        this.appEv = this.opts.appEvents ?? electron_1.app;
        this.sessions = new Map();
        this.opening = new Map();
        this.streamRefs = new Map();
        this.hostSubscribed = false;
        this.disposed = false;
        this.hostCleanups = [];
        const wcv = opts.registry instanceof wcvBrowserRegistry_1.WcvBrowserRegistry ? opts.registry : undefined;
        const snap = !opts.snapshot && wcv
            ? new snapMod.BrowserViewerTabSnapshotController({ registry: wcv })
            : undefined;
        this.snap = opts.snapshot ?? snap ?? snapMod.browserViewerTabSnapshot;
        const d = wcv &&
            new drvMod.BrowserViewerTabDriver({
                registry: wcv,
                snapshot: snap,
                isControlLeaseActive: (k) => wcv.isRemoteControlActive(k),
            });
        this.drv = opts.driver ?? d ?? drvMod.browserViewerTabDriver;
    }
    ensureListeners() {
        if (this.disposed) {
            return;
        }
        this.detachCapture ?? (this.detachCapture = this.cap.onEvent((ev) => this.onCaptureEvent(ev)));
        if (!this.detachRegistryListeners) {
            const offRevoke = this.registry.onRemoteControlRevoked?.((tabKey) => {
                this.revokeControlForTab(tabKey);
            });
            const offDisc = this.registry.onRemoteStreamDisconnectRequested?.((tabKey) => {
                this.disconnectStreamsForTab(tabKey);
            });
            this.detachRegistryListeners = () => {
                offRevoke?.();
                offDisc?.();
            };
        }
    }
    register(client) {
        if (this.reg) {
            this.syncHostPresence();
            return this.reg;
        }
        this.disposed = false;
        this.reg = client.register(this);
        this.hostSubscribed = true;
        this.ensureListeners();
        this.syncHostPresence();
        const deferSync = () => {
            if (!this.disposed && this.pendingSync === undefined) {
                this.pendingSync = setImmediate(() => {
                    this.pendingSync = undefined;
                    this.syncHostPresence();
                });
            }
        };
        const offFocus = this.onFocus?.(() => {
            this.syncHostPresence();
            deferSync();
        });
        if (offFocus) {
            this.hostCleanups.push(offFocus);
        }
        const onCreated = (_ev, wc) => {
            if (wc?.getType?.() !== 'webview' &&
                !capMod.isBrowserStreamSession(wc?.session)) {
                deferSync();
            }
        };
        this.appEv.on?.('web-contents-created', onCreated);
        this.hostCleanups.push(() => {
            (this.appEv.removeListener ?? this.appEv.off)?.call(this.appEv, 'web-contents-created', onCreated);
        });
        return this.reg;
    }
    hasActiveHost() {
        return !this.disposed && this.snap.hasBrowserHost();
    }
    syncHostPresence() {
        if (this.disposed) {
            return;
        }
        if (!this.snap.hasBrowserHost()) {
            void this.resetSessions();
            if (this.hostSubscribed && this.reg) {
                this.hostSubscribed = false;
                void this.reg.unsubscribe().catch(() => undefined);
            }
        }
        else if (!this.hostSubscribed && this.reg) {
            this.hostSubscribed = true;
            this.reg.resubscribe();
        }
    }
    hello() {
        const cap = exports.MAX_BROWSER_VIEWER_HOST_LABEL_RUNES;
        const raw = this.opts.hostLabel ??
            (os.hostname() || this.appEv.getName?.() || 'Desktop Hub');
        const clean = snapMod.sanitizeControlFreeUtf8(raw, 4 * cap);
        const hello = (0, protobuf_1.create)(pb.BrowserViewerHelloSchema, {
            maxSessions: this.maxSessions,
            videoCodecs: ['H264', 'VP8'],
            hostLabel: [...clean].slice(0, cap).join(''),
            supportsWebrtc: true,
            supportsFrameRead: true,
        });
        return Promise.resolve({ hello, conversationIds: [] });
    }
    async onRequest(req, ctx) {
        let result;
        let blobs;
        try {
            const out = await this.dispatch(req);
            result = out.result;
            blobs =
                result.errorCode === '' && out.blobs?.length
                    ? [...out.blobs]
                    : undefined;
        }
        catch (err) {
            result = errRes('FAILED_PRECONDITION', errMsg(err, 'Request failed'));
        }
        await swallow(() => blobs ? ctx.fulfill(result, blobs) : ctx.fulfill(result));
    }
    onStreamLost() {
        void this.resetSessions();
    }
    resetSessions() {
        let hadWebRtc = false;
        for (const op of this.opening.values()) {
            hadWebRtc = hadWebRtc || op.mode === 'webrtc';
            op.cancelled = true;
            op.cancelReason ?? (op.cancelReason = 'reset');
        }
        for (const [id, s] of [...this.sessions.entries()]) {
            hadWebRtc = hadWebRtc || s.mode === 'webrtc';
            this.detachSession(id);
        }
        return hadWebRtc ? swallow(() => this.cap.closeAll()) : Promise.resolve();
    }
    async dispose() {
        this.disposed = true;
        clearImmediate(this.pendingSync);
        this.pendingSync = undefined;
        this.hostCleanups.splice(0).forEach((fn) => fn());
        this.detachCapture?.();
        this.detachCapture = undefined;
        this.detachRegistryListeners?.();
        this.detachRegistryListeners = undefined;
        const reg = this.reg;
        this.reg = undefined;
        this.hostSubscribed = false;
        await Promise.all([
            this.resetSessions(),
            swallow(async () => reg?.unsubscribe()),
        ]);
    }
    hasActiveControlGrant(s, nowMs = this.now()) {
        const g = s.controlGrant;
        return Boolean(g && nowMs < g.expiresAtMs && nowMs < s.expiresAtMs);
    }
    hasTabControlGrant(tabKey) {
        for (const s of this.sessions.values()) {
            if (s.tabKey === tabKey && s.controlGrant) {
                return true;
            }
        }
        return false;
    }
    hasMatchingSessionControl(sessionId, tabKey, controlToken, nowMs = this.now()) {
        this.sweepExpired(nowMs);
        const s = this.sessions.get(sessionId);
        if (!s ||
            s.tabKey !== tabKey ||
            (this.registry.isRemoteControlActive &&
                !this.registry.isRemoteControlActive(tabKey)) ||
            !this.hasActiveControlGrant(s, nowMs) ||
            !tokensMatchConstantTime(controlToken, s.controlGrant?.token)) {
            return false;
        }
        return true;
    }
    withGrantState(s, base, nowMs = this.now()) {
        return {
            ...base,
            tabMeta: {
                ...base.tabMeta,
                remoteControlGranted: this.hasActiveControlGrant(s, nowMs),
            },
        };
    }
    syncTabControlState(tabKey, nowMs = this.now()) {
        let activeOnTab = false;
        for (const s of this.sessions.values()) {
            if (s.tabKey === tabKey && this.hasActiveControlGrant(s, nowMs)) {
                activeOnTab = true;
            }
        }
        this.registry.setRemoteControlActive?.(tabKey, activeOnTab);
        const live = this.snap.getLiveOwnedEntry(tabKey);
        if (!live) {
            return;
        }
        const snap = this.snap.buildCaptureSessionState(live);
        for (const [id, s] of this.sessions.entries()) {
            if (s.tabKey === tabKey) {
                this.pushStateDiff(id, snap, nowMs);
            }
        }
    }
    revokeControlForTab(tabKey, exceptSessionId, nowMs = this.now()) {
        let changed = false;
        for (const s of this.sessions.values()) {
            if (s.tabKey === tabKey &&
                s.sessionId !== exceptSessionId &&
                s.controlGrant) {
                s.controlGrant = undefined;
                changed = true;
            }
        }
        if (changed || exceptSessionId === undefined) {
            this.syncTabControlState(tabKey, nowMs);
        }
    }
    disconnectStreamsForTab(tabKey) {
        for (const op of this.opening.values()) {
            if (op.retainedKey === tabKey) {
                op.cancelled = true;
                op.cancelReason = 'close';
                if (op.mode === 'webrtc') {
                    void swallow(() => this.cap.closeSession(op.sessionId));
                }
            }
        }
        for (const [id, s] of [...this.sessions.entries()]) {
            if (s.tabKey === tabKey) {
                void this.releaseSession(id);
            }
        }
    }
    async resolveAuthorizedSession(rootId, sessionId, tabId, nowMs = this.now()) {
        if (!isValidScope(rootId, sessionId) ||
            typeof tabId !== 'string' ||
            policy.parseConversationTabKey(tabId)?.rootConversationId !== rootId) {
            return {
                ok: false,
                result: errRes(INVALID_REQ, 'Invalid session or tabId'),
            };
        }
        if (!this.hasActiveHost()) {
            this.syncHostPresence();
            return { ok: false, result: errRes('FAILED_PRECONDITION', NO_HOST) };
        }
        this.sweepExpired(nowMs);
        const s = this.sessions.get(sessionId);
        if (!s || s.rootId !== rootId || s.tabKey !== tabId) {
            return {
                ok: false,
                result: errRes('UNKNOWN_SESSION', 'Unknown viewer session'),
            };
        }
        const live = this.snap.getLiveOwnedEntry(tabId);
        if (!live || live.view?.webContents !== s.targetWc) {
            await this.releaseSession(sessionId);
            return {
                ok: false,
                result: errRes('TAB_NOT_FOUND', 'Browser tab not found'),
            };
        }
        return { ok: true, session: s, live };
    }
    async dispatch(req) {
        const rootId = req?.rootConversationId;
        const q = req?.payload;
        if (typeof rootId !== 'string' || !q || typeof q !== 'object') {
            return { result: errRes(INVALID_REQ, 'Invalid request') };
        }
        const op = q.op;
        const validRoot = policy.isValidRootConversationId(rootId);
        const hasVal = Boolean(op?.value && typeof op.value === 'object');
        if (op?.case === 'listTabs') {
            if (!hasVal) {
                return { result: errRes(INVALID_REQ, 'Invalid listTabs request') };
            }
            if (this.disposed && validRoot) {
                return { result: (0, protobuf_1.create)(pb.BrowserViewerResultSchema, { tabs: [] }) };
            }
            const out = this.snap.listConversationTabs(rootId);
            if (!out.hasBrowserHost) {
                this.syncHostPresence();
            }
            return {
                result: this.disposed && out.result.errorCode === ''
                    ? (0, protobuf_1.create)(pb.BrowserViewerResultSchema, { tabs: [] })
                    : out.result,
            };
        }
        if (op?.case === 'readFrame') {
            return this.handleReadFrame(rootId, q.sessionId, hasVal ? op.value : undefined);
        }
        if (op?.case === 'control') {
            return {
                result: await this.handleControl(rootId, q.sessionId, hasVal ? op.value : undefined),
            };
        }
        if (op?.case === 'takeControl') {
            return {
                result: await this.handleTakeControl(rootId, q.sessionId, hasVal ? op.value : undefined),
            };
        }
        if (op?.case === 'releaseControl') {
            return {
                result: await this.handleReleaseControl(rootId, q.sessionId, hasVal ? op.value : undefined),
            };
        }
        if (op?.case === 'offer') {
            return { result: await this.handleOffer(rootId, q.sessionId, op.value) };
        }
        if (op?.case === 'renew') {
            return { result: this.handleRenew(rootId, q.sessionId, op.value) };
        }
        if (op?.case === 'close') {
            return { result: await this.handleClose(rootId, q.sessionId, op.value) };
        }
        return { result: errRes(INVALID_REQ, 'Unknown browser_viewer operation') };
    }
    async handleReadFrame(rootId, sessionId, req) {
        if (!req || !isCapDim(req.maxWidthPx) || !isCapDim(req.maxHeightPx)) {
            return { result: errRes(INVALID_REQ, 'Invalid readFrame request') };
        }
        const auth = await this.resolveAuthorizedSession(rootId, sessionId, req.tabId);
        if (!auth.ok) {
            return { result: auth.result };
        }
        const out = await this.snap.readFrame(rootId, req);
        if (!this.snap.hasBrowserHost()) {
            this.syncHostPresence();
        }
        return this.disposed && out.result.errorCode === ''
            ? { result: errRes('FAILED_PRECONDITION', NO_HOST) }
            : out;
    }
    async handleControl(rootId, sessionId, control) {
        if (!control ||
            typeof control.action !== 'number' ||
            control.action < pb.BrowserViewerControlAction.STOP ||
            control.action > pb.BrowserViewerControlAction.INPUT_EVENT) {
            return errRes(INVALID_REQ, 'Invalid control request');
        }
        const nowMs = this.now();
        const auth = await this.resolveAuthorizedSession(rootId, sessionId, control.tabId, nowMs);
        if (!auth.ok) {
            return auth.result;
        }
        const isStop = control.action === pb.BrowserViewerControlAction.STOP;
        if (!isStop) {
            if (!this.hasMatchingSessionControl(sessionId, control.tabId, control.controlToken, nowMs)) {
                this.syncTabControlState(auth.session.tabKey, nowMs);
                return errRes('CONTROL_REQUIRED', 'Active control lease required');
            }
        }
        const res = await this.drv.controlTab(rootId, control, isStop
            ? undefined
            : {
                isControlLeaseActive: () => this.hasMatchingSessionControl(sessionId, control.tabId, control.controlToken),
            });
        if (!this.snap.hasBrowserHost()) {
            this.syncHostPresence();
        }
        return this.disposed && res.errorCode === ''
            ? errRes('FAILED_PRECONDITION', NO_HOST)
            : res;
    }
    async handleTakeControl(rootId, sessionId, op) {
        const nowMs = this.now();
        const nowBig = BigInt(Math.trunc(nowMs));
        if (!op ||
            typeof op.expiresUnixMs !== 'bigint' ||
            op.expiresUnixMs < 0n ||
            (op.expiresUnixMs > 0n && op.expiresUnixMs <= nowBig)) {
            return errRes(INVALID_REQ, 'Invalid takeControl request');
        }
        const auth = await this.resolveAuthorizedSession(rootId, sessionId, op.tabId, nowMs);
        if (!auth.ok) {
            return auth.result;
        }
        let mintedInPin;
        const mintGrant = async (tab) => {
            const postNow = this.now();
            this.sweepExpired(postNow);
            if (!this.hasActiveHost()) {
                this.syncHostPresence();
                return errRes('FAILED_PRECONDITION', NO_HOST);
            }
            const cur = this.sessions.get(sessionId);
            if (!cur || cur !== auth.session) {
                return errRes('UNKNOWN_SESSION', 'Viewer session closed during takeControl');
            }
            const live = this.snap.getLiveOwnedEntry(op.tabId);
            if (!live || live.view?.webContents !== cur.targetWc) {
                await this.releaseSession(sessionId);
                return errRes('TAB_NOT_FOUND', 'Browser tab closed during takeControl');
            }
            if (live.isAgentStepActive) {
                return errRes('FAILED_PRECONDITION', 'Tab remains under active agent control');
            }
            this.revokeControlForTab(cur.tabKey, sessionId, postNow);
            const reqClientExp = computeClientDeadlineMs(postNow, op.expiresUnixMs);
            const sessionBound = cur.clientExpiresAtMs > postNow
                ? cur.clientExpiresAtMs
                : cur.expiresAtMs;
            const clientExpiresAtMs = Math.max(postNow + 1, Math.min(reqClientExp, sessionBound));
            const token = crypto.randomBytes(16).toString('hex');
            cur.controlGrant = {
                token,
                clientExpiresAtMs,
                expiresAtMs: Math.min(cur.expiresAtMs, clientExpiresAtMs + exports.BROWSER_VIEWER_HOST_LEASE_GRACE_MS),
            };
            this.syncTabControlState(cur.tabKey, postNow);
            return (0, protobuf_1.create)(pb.BrowserViewerResultSchema, {
                tab,
                controlToken: token,
                controlExpiresUnixMs: BigInt(Math.trunc(clientExpiresAtMs)),
                controlActive: true,
            });
        };
        const drvRes = this.drv.takeControlTab
            ? await this.drv.takeControlTab(rootId, op.tabId, async (tab) => {
                mintedInPin = await mintGrant(tab);
                return mintedInPin;
            })
            : (0, protobuf_1.create)(pb.BrowserViewerResultSchema, {});
        if (mintedInPin) {
            return mintedInPin;
        }
        if (drvRes.errorCode !== '') {
            return drvRes;
        }
        return mintGrant(drvRes.tab);
    }
    async handleReleaseControl(rootId, sessionId, op) {
        if (!op) {
            return errRes(INVALID_REQ, 'Invalid releaseControl request');
        }
        const nowMs = this.now();
        const auth = await this.resolveAuthorizedSession(rootId, sessionId, op.tabId, nowMs);
        if (!auth.ok) {
            return auth.result;
        }
        if (!this.hasMatchingSessionControl(sessionId, op.tabId, op.controlToken, nowMs)) {
            this.syncTabControlState(auth.session.tabKey, nowMs);
            return errRes('CONTROL_REQUIRED', 'Active control lease required');
        }
        auth.session.controlGrant = undefined;
        this.syncTabControlState(auth.session.tabKey, nowMs);
        return okRes();
    }
    async rollbackOpening(op, close = true) {
        if (close && op.captureOpened && op.mode === 'webrtc') {
            op.captureOpened = false;
            await swallow(() => this.cap.closeSession(op.sessionId));
        }
        if (op.retainedKey !== undefined) {
            const k = op.retainedKey;
            op.retainedKey = undefined;
            this.adjustStreamRef(k, -1);
        }
    }
    async handleOffer(rootId, sessionId, offer) {
        const nowPre = BigInt(Math.trunc(this.now()));
        const tabRoot = offer
            ? policy.parseConversationTabKey(offer.tabId)?.rootConversationId
            : '';
        const validTab = typeof offer?.tabId === 'string' &&
            (offer.tabId === '' || tabRoot === rootId);
        const validExp = typeof offer?.expiresUnixMs === 'bigint' &&
            offer.expiresUnixMs >= 0n &&
            (offer.expiresUnixMs === 0n || offer.expiresUnixMs > nowPre);
        if (!isValidScope(rootId, sessionId) ||
            !offer ||
            typeof offer.sdp !== 'string' ||
            !validTab ||
            !validExp) {
            return errRes(INVALID_REQ, 'Invalid browser_viewer offer');
        }
        const mode = offer.sdp === '' ? 'frame' : 'webrtc';
        const sdpOk = mode === 'frame' ||
            policy.validateBrowserViewerSdp(offer.sdp, { requireCandidate: true });
        const iceServers = sdpOk
            ? policy.validateBrowserViewerIceServers(offer.iceServers)
            : null;
        if (!sdpOk || iceServers === null) {
            return errRes('INVALID_SDP', sdpOk ? 'Invalid ICE servers' : 'Bad SDP');
        }
        if (!this.hasActiveHost()) {
            this.syncHostPresence();
            return errRes('FAILED_PRECONDITION', NO_HOST);
        }
        this.sweepExpired();
        if (this.sessions.has(sessionId) || this.opening.has(sessionId)) {
            return errRes('UNKNOWN_SESSION', 'Duplicate viewer session ID');
        }
        if (this.sessions.size + this.opening.size >= this.maxSessions) {
            return errRes('VIEWER_LIMIT', 'Maximum browser viewer sessions reached');
        }
        const op = { sessionId, rootId, mode, cancelled: false };
        this.opening.set(sessionId, op);
        this.ensureListeners();
        let promoted = false;
        try {
            const pinned = await this.snap.withPinnedOfferTab(rootId, offer.tabId, async ({ entry, initialState }) => {
                if (op.cancelled || !this.hasActiveHost()) {
                    return null;
                }
                const targetWc = entry.view.webContents;
                op.retainedKey = entry.tabKey;
                this.adjustStreamRef(entry.tabKey, 1);
                const initWithGrant = {
                    ...initialState,
                    tabMeta: { ...initialState.tabMeta, remoteControlGranted: false },
                };
                if (mode === 'frame') {
                    return {
                        answerSdp: '',
                        tabKey: entry.tabKey,
                        targetWc,
                        initialState: initWithGrant,
                    };
                }
                const { widthDip, heightDip } = initWithGrant.tabMeta;
                let answerSdp;
                try {
                    answerSdp = (await this.cap.openSession({
                        sessionId,
                        tabId: entry.tabKey,
                        targetWebContents: targetWc,
                        offerSdp: offer.sdp,
                        iceServers,
                        widthDip,
                        heightDip,
                        devicePixelRatio: initWithGrant.devicePixelRatio,
                        initialState: initWithGrant,
                    })).answerSdp;
                }
                catch (err) {
                    await this.rollbackOpening(op, false);
                    const msg = errMsg(err, 'Open failed');
                    if (!op.cancelled && !op.opFailure && this.hasActiveHost()) {
                        const live = this.snap.getLiveOwnedEntry(entry.tabKey);
                        if (live?.view?.webContents === targetWc) {
                            op.opFailure = errRes(/\bsdp\b/i.test(msg) ? 'INVALID_SDP' : 'FAILED_PRECONDITION', msg);
                        }
                    }
                    return null;
                }
                const wasOpened = !op.opFailure;
                op.captureOpened = wasOpened;
                if (op.cancelled || op.opFailure || !this.hasActiveHost()) {
                    await this.rollbackOpening(op, wasOpened);
                    return null;
                }
                if (!policy.validateBrowserViewerSdp(answerSdp, {
                    requireCandidate: false,
                })) {
                    await this.rollbackOpening(op);
                    op.opFailure = errRes('INVALID_SDP', 'Invalid host answer SDP');
                    return null;
                }
                return {
                    answerSdp,
                    tabKey: entry.tabKey,
                    targetWc,
                    initialState: initWithGrant,
                };
            }, () => this.rollbackOpening(op));
            const val = pinned.ok ? pinned.value : null;
            const postWc = val
                ? this.snap.getLiveOwnedEntry(val.tabKey)?.view?.webContents
                : undefined;
            const hasHost = this.hasActiveHost();
            const ready = !op.cancelled && hasHost && !op.opFailure && pinned.ok && Boolean(val);
            if (!ready || !pinned.ok || !val || postWc !== val.targetWc) {
                await this.rollbackOpening(op);
                if (!hasHost) {
                    this.syncHostPresence();
                }
                const fb = !pinned.ok
                    ? pinned.result
                    : errRes('TAB_NOT_FOUND', 'Tab closed or replaced');
                return op.cancelReason === 'close'
                    ? errRes('UNKNOWN_SESSION', 'Closed while opening')
                    : !hasHost
                        ? errRes('FAILED_PRECONDITION', NO_HOST)
                        : op.cancelled
                            ? errRes('FAILED_PRECONDITION', 'Reset while opening')
                            : (op.opFailure ?? fb);
            }
            const { answerSdp, tabKey, targetWc, initialState } = val;
            promoted = true;
            op.retainedKey = undefined;
            op.captureOpened = false;
            const nowMs = this.now();
            const clientExpiresAtMs = computeClientDeadlineMs(nowMs, offer.expiresUnixMs);
            const session = {
                sessionId,
                rootId,
                tabKey,
                mode,
                targetWc,
                clientExpiresAtMs,
                expiresAtMs: clientExpiresAtMs + exports.BROWSER_VIEWER_HOST_LEASE_GRACE_MS,
                unwatchTab: () => undefined,
                digest: digestState(initialState),
            };
            this.sessions.set(sessionId, session);
            const unwatch = this.snap.watchTabState(tabKey, {
                onStateChange: (s) => this.pushStateDiff(sessionId, s),
                onTabGone: () => void this.releaseSession(sessionId),
            });
            if (!this.sessions.has(sessionId)) {
                unwatch();
            }
            else {
                session.unwatchTab = unwatch;
                this.armExpiry(session);
                this.syncReconciler();
            }
            return (0, protobuf_1.create)(pb.BrowserViewerResultSchema, { answerSdp, tab: pinned.tab });
        }
        finally {
            this.opening.delete(sessionId);
            if (!promoted) {
                await this.rollbackOpening(op);
            }
        }
    }
    /**
     * Extends the viewer session lease and, when an unrevoked control grant is
     * active on the session, extends that control grant alongside the session
     * heartbeat. Revoked or expired control grants are never reinstated by
     * `renew`; control remains immediately revocable by local Hub interaction,
     * agent step execution, `releaseControl`, or `close`.
     */
    handleRenew(rootId, sid, renew) {
        const nowMs = this.now();
        if (!isValidScope(rootId, sid) ||
            !renew ||
            typeof renew !== 'object' ||
            typeof renew.expiresUnixMs !== 'bigint' ||
            renew.expiresUnixMs <= BigInt(Math.trunc(nowMs))) {
            return errRes(INVALID_REQ, 'Invalid browser_viewer renew');
        }
        this.sweepExpired(nowMs);
        const s = this.sessions.get(sid);
        if (!s || s.rootId !== rootId) {
            return errRes('UNKNOWN_SESSION', 'Unknown viewer session');
        }
        s.clientExpiresAtMs = computeClientDeadlineMs(nowMs, renew.expiresUnixMs);
        s.expiresAtMs = s.clientExpiresAtMs + exports.BROWSER_VIEWER_HOST_LEASE_GRACE_MS;
        this.armExpiry(s);
        if (this.hasActiveControlGrant(s, nowMs) && s.controlGrant) {
            s.controlGrant.clientExpiresAtMs = s.clientExpiresAtMs;
            s.controlGrant.expiresAtMs = s.expiresAtMs;
            return (0, protobuf_1.create)(pb.BrowserViewerResultSchema, {
                controlActive: true,
                controlExpiresUnixMs: BigInt(Math.trunc(s.clientExpiresAtMs)),
            });
        }
        if (s.controlGrant) {
            s.controlGrant = undefined;
            this.syncTabControlState(s.tabKey, nowMs);
        }
        return (0, protobuf_1.create)(pb.BrowserViewerResultSchema, {
            controlActive: false,
            controlExpiresUnixMs: 0n,
        });
    }
    async handleClose(rootId, sid, close) {
        if (!isValidScope(rootId, sid) || !close || typeof close !== 'object') {
            return errRes(INVALID_REQ, 'Invalid browser_viewer close');
        }
        this.sweepExpired();
        const op = this.opening.get(sid);
        if (op && op.rootId === rootId) {
            op.cancelled = true;
            op.cancelReason = 'close';
            if (op.mode === 'webrtc') {
                await swallow(() => this.cap.closeSession(sid));
            }
        }
        else if (this.sessions.get(sid)?.rootId === rootId) {
            await this.releaseSession(sid);
        }
        return okRes();
    }
    onCaptureEvent(ev) {
        if (this.disposed) {
            return;
        }
        if (ev.type === 'viewer_message') {
            const nowMs = this.now();
            this.sweepExpired(nowMs);
            const s = this.sessions.get(ev.sessionId);
            if (!s || s.mode !== 'webrtc' || s.tabKey !== ev.tabId) {
                return;
            }
            const msg = ev.message;
            const isStop = msg.type === 'stop';
            if (!isStop) {
                if (!this.hasMatchingSessionControl(s.sessionId, s.tabKey, msg.controlToken, nowMs)) {
                    this.syncTabControlState(s.tabKey, nowMs);
                    return;
                }
            }
            void this.drv
                .handleViewerMessage(s.rootId, s.tabKey, msg, isStop
                ? undefined
                : {
                    isControlLeaseActive: () => this.hasMatchingSessionControl(s.sessionId, s.tabKey, msg.controlToken),
                })
                .catch(() => undefined);
            return;
        }
        if (ev.type !== 'session_state' || ev.state === 'connected') {
            return;
        }
        const s = this.sessions.get(ev.sessionId);
        const op = this.opening.get(ev.sessionId);
        if (s && s.mode === 'webrtc' && s.tabKey === ev.tabId) {
            void this.releaseSession(ev.sessionId, false);
        }
        else if (op &&
            op.mode === 'webrtc' &&
            (!op.retainedKey || op.retainedKey === ev.tabId)) {
            op.captureOpened = false;
            op.opFailure ?? (op.opFailure = errRes('FAILED_PRECONDITION', ev.reason || 'Capture session closed while opening'));
        }
    }
    pushStateDiff(id, rawNext, nowMs = this.now()) {
        const s = this.sessions.get(id);
        if (!s) {
            return;
        }
        if (Boolean(rawNext.tabMeta.isAgentStepActive) &&
            this.hasTabControlGrant(s.tabKey)) {
            this.revokeControlForTab(s.tabKey, undefined, nowMs);
        }
        if (s.mode !== 'webrtc') {
            return;
        }
        const next = this.withGrantState(s, rawNext, nowMs);
        const [prevMeta, prevCur, prevAgc, prevDpr] = s.digest;
        const [meta, cur, agc, dpr] = (s.digest = digestState(next));
        const patch = {
            ...(meta !== prevMeta ? { tabMeta: next.tabMeta } : {}),
            ...(cur !== prevCur ? { cssCursor: cur } : {}),
            ...(agc !== prevAgc ? { agentCursor: next.agentCursor } : {}),
            ...(dpr !== prevDpr ? { devicePixelRatio: dpr } : {}),
        };
        if (Object.keys(patch).length > 0) {
            void this.cap.updateState(id, patch).catch(() => undefined);
        }
    }
    syncReconciler() {
        if (this.sessions.size > 0 && !this.reconcileTimer) {
            this.reconcileTimer = setInterval(() => this.reconcile(), exports.BROWSER_VIEWER_RECONCILE_INTERVAL_MS);
            this.reconcileTimer.unref?.();
        }
        else if (this.sessions.size === 0 && this.reconcileTimer) {
            clearInterval(this.reconcileTimer);
            this.reconcileTimer = undefined;
        }
    }
    reconcile() {
        const nowMs = this.now();
        this.sweepExpired(nowMs);
        for (const [id, s] of [...this.sessions.entries()]) {
            const live = this.snap.getLiveOwnedEntry(s.tabKey);
            if (!live || live.view?.webContents !== s.targetWc) {
                void this.releaseSession(id);
            }
            else {
                if (s.controlGrant && !this.hasActiveControlGrant(s, nowMs)) {
                    s.controlGrant = undefined;
                    this.syncTabControlState(s.tabKey, nowMs);
                }
                this.pushStateDiff(id, this.snap.buildCaptureSessionState(live), nowMs);
            }
        }
        this.syncReconciler();
    }
    armExpiry(s) {
        clearTimeout(s.expiryTimer);
        const check = () => {
            const cur = this.sessions.get(s.sessionId);
            if (cur) {
                if (this.now() >= cur.expiresAtMs) {
                    void this.releaseSession(cur.sessionId);
                }
                else {
                    this.armExpiry(cur);
                }
            }
        };
        s.expiryTimer = setTimeout(check, Math.max(0, s.expiresAtMs - this.now()));
        s.expiryTimer.unref?.();
    }
    sweepExpired(nowMs = this.now()) {
        for (const [id, s] of [...this.sessions.entries()]) {
            if (nowMs >= s.expiresAtMs) {
                void this.releaseSession(id);
            }
            else if (s.controlGrant && nowMs >= s.controlGrant.expiresAtMs) {
                s.controlGrant = undefined;
                this.syncTabControlState(s.tabKey, nowMs);
            }
        }
    }
    adjustStreamRef(tabKey, delta) {
        const next = (this.streamRefs.get(tabKey) ?? 0) + delta;
        if (next <= 0 && this.streamRefs.delete(tabKey)) {
            this.registry.setRemoteStreamActive(tabKey, false);
        }
        else if (next > 0) {
            this.streamRefs.set(tabKey, next);
            if (next === 1 && delta === 1) {
                this.registry.setRemoteStreamActive(tabKey, true);
            }
        }
    }
    detachSession(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s) {
            return undefined;
        }
        this.sessions.delete(sessionId);
        clearTimeout(s.expiryTimer);
        this.syncReconciler();
        try {
            s.unwatchTab();
        }
        catch {
            // Ensure listener errors never skip stream refcount release.
        }
        if (s.controlGrant) {
            s.controlGrant = undefined;
            this.syncTabControlState(s.tabKey);
        }
        this.adjustStreamRef(s.tabKey, -1);
        return s;
    }
    async releaseSession(id, close = true) {
        const s = this.detachSession(id);
        if (s && s.mode === 'webrtc' && close) {
            await swallow(() => this.cap.closeSession(id));
        }
    }
}
exports.BrowserViewerHandler = BrowserViewerHandler;
let activeHandler;
function registerBrowserViewer(opts = {}) {
    if (activeHandler) {
        activeHandler.syncHostPresence();
        return activeHandler;
    }
    const handler = new BrowserViewerHandler(opts);
    handler.register(opts.client ?? (0, mainClient_1.getMainActuatorClient)());
    activeHandler = handler;
    return handler;
}
function syncBrowserViewerHostPresence() {
    activeHandler?.syncHostPresence();
}
function resetBrowserViewerSessions() {
    return activeHandler ? activeHandler.resetSessions() : Promise.resolve();
}
async function unregisterBrowserViewer() {
    const handler = activeHandler;
    activeHandler = undefined;
    await handler?.dispose();
}
