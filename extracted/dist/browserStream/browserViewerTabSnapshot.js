"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserViewerTabSnapshot = exports.BrowserViewerTabSnapshotController = exports.READ_FRAME_FALLBACK_JPEG_QUALITY = exports.READ_FRAME_JPEG_QUALITY = exports.DEFAULT_READ_FRAME_MAX_HEIGHT_PX = exports.DEFAULT_READ_FRAME_MAX_WIDTH_PX = exports.MAX_ERROR_BYTES = exports.MAX_TAB_TITLE_BYTES = exports.MAX_BROWSER_VIEWER_TABS = void 0;
exports.sanitizeControlFreeUtf8 = sanitizeControlFreeUtf8;
exports.sanitizeNulFreeUtf8 = sanitizeNulFreeUtf8;
exports.createBrowserViewerErrorResult = createBrowserViewerErrorResult;
/**
 * Conversation-scoped `WebContentsView` tab discovery, offer-only evicted-tab
 * rehydration, live tab/cursor snapshot watching, and single-encode Retina
 * `read_frame` capture for the `browser_viewer` actuator.
 */
const protobuf_1 = require("@bufbuild/protobuf");
const electron_1 = require("electron");
const guestAgentControl_1 = require("../guestAgentControl");
const browser_viewer_pb_1 = require("../proto/browser_viewer_pb");
const utils_1 = require("../utils");
const limits_1 = require("../vendor/actuator/limits");
const wcvBrowserRegistry_1 = require("../wcvBrowserRegistry");
const wcvIpcHandlers_1 = require("../wcvIpcHandlers");
const wcvZOrderController_1 = require("../wcvZOrderController");
const browserViewerUrlPolicy_1 = require("./browserViewerUrlPolicy");
exports.MAX_BROWSER_VIEWER_TABS = 64;
exports.MAX_TAB_TITLE_BYTES = 4096;
exports.MAX_ERROR_BYTES = 1024;
exports.DEFAULT_READ_FRAME_MAX_WIDTH_PX = 1920;
exports.DEFAULT_READ_FRAME_MAX_HEIGHT_PX = 1080;
exports.READ_FRAME_JPEG_QUALITY = 80;
exports.READ_FRAME_FALLBACK_JPEG_QUALITY = 50;
const LONE_SURROGATE_RE = /[\ud800-\udfff]/gu;
const INVALID_REQ = 'ACTUATOR_ERROR_CODE_INVALID_REQUEST';
const GUEST_EVENTS = [
    'did-navigate',
    'did-navigate-in-page',
    'page-title-updated',
    'did-start-loading',
    'did-stop-loading',
    'did-fail-load',
    'cursor-changed',
];
function cleanUtf8(raw, max, keep) {
    if (typeof raw !== 'string' || raw.length === 0 || max <= 0) {
        return '';
    }
    const clean = raw.replace(LONE_SURROGATE_RE, '');
    let out = '';
    for (let i = 0; i < clean.length; i++) {
        out += keep(clean.charCodeAt(i)) ? clean[i] : '';
    }
    return (0, limits_1.truncateUtf8)(out, max);
}
/** Strips lone surrogates and C0/C1 control chars, then UTF-8-truncates. */
function sanitizeControlFreeUtf8(raw, maxBytes) {
    return cleanUtf8(raw, maxBytes, (c) => c > 0x1f && (c < 0x7f || c > 0x9f));
}
/** Strips lone surrogates and NUL (`\0`), preserving `\t`/`\n`/`\r`, then truncates. */
function sanitizeNulFreeUtf8(raw, maxBytes) {
    return cleanUtf8(raw, maxBytes, (c) => c !== 0);
}
/** Builds an error `BrowserViewerResult` with zero success fields and bounded `error`. */
function createBrowserViewerErrorResult(errorCode, error) {
    return (0, protobuf_1.create)(browser_viewer_pb_1.BrowserViewerResultSchema, {
        errorCode,
        error: sanitizeNulFreeUtf8(error, exports.MAX_ERROR_BYTES),
    });
}
const errRes = createBrowserViewerErrorResult;
const failOffer = (c, m) => ({
    ok: false,
    result: errRes(c, m),
});
const failFrame = (c, m) => ({
    result: errRes(c, m),
});
const isPos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isCap = (v) => typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 0 &&
    v <= browserViewerUrlPolicy_1.MAX_BLOB_DIMENSION_PX;
const clampPx = (n) => Math.min(browserViewerUrlPolicy_1.MAX_BLOB_DIMENSION_PX, Math.max(1, n));
const cmpVisRecent = (a, b) => Number(Boolean(b.visible)) - Number(Boolean(a.visible)) ||
    (b.lastShownAt || 0) - (a.lastShownAt || 0) ||
    a.tabKey.localeCompare(b.tabKey);
function toDip(r) {
    const [w, h] = r && isPos(r.width) && isPos(r.height)
        ? [Math.round(r.width), Math.round(r.height)]
        : [0, 0];
    return w > 0 && h > 0 ? { widthDip: clampPx(w), heightDip: clampPx(h) } : null;
}
function fitFloor(w, h, capW, capH) {
    const r = Math.min(capW / w, capH / h);
    return {
        width: Math.max(1, Math.min(capW, Math.floor(w * r))),
        height: Math.max(1, Math.min(capH, Math.floor(h * r))),
    };
}
function bindGuest(wc, fn, gone) {
    const em = wc;
    GUEST_EVENTS.forEach((ev) => em.on?.(ev, fn));
    const addGone = (typeof em.once === 'function' ? em.once : em.on)?.bind(em);
    addGone?.('render-process-gone', gone);
    addGone?.('destroyed', gone);
    return () => {
        const off = (typeof em.removeListener === 'function' ? em.removeListener : em.off)?.bind(em);
        GUEST_EVENTS.forEach((ev) => off?.(ev, fn));
        off?.('render-process-gone', gone);
        off?.('destroyed', gone);
    };
}
function encodeBoundedJpeg(img, capW, capH) {
    const enc = (im, q = exports.READ_FRAME_JPEG_QUALITY) => {
        const jpegBytes = new Uint8Array(im.toJPEG(q));
        return { jpegBytes, dims: (0, browserViewerUrlPolicy_1.parseJpegDimensions)(jpegBytes) };
    };
    try {
        const sz = img.getSize?.();
        if (!sz || !isPos(sz.width) || !isPos(sz.height)) {
            return null;
        }
        const raw = img.getScaleFactors?.();
        const maxS = Math.max(1, ...(Array.isArray(raw) ? raw.filter(isPos) : []));
        const [estW, estH] = [
            Math.round(sz.width * maxS),
            Math.round(sz.height * maxS),
        ];
        let [cur, lastReq] = [img, { width: sz.width, height: sz.height }];
        const didPre = estW > capW || estH > capH;
        if (didPre) {
            lastReq = fitFloor(estW, estH, capW, capH);
            cur = img.resize({ ...lastReq, quality: 'good' });
        }
        let { jpegBytes, dims } = enc(cur);
        if (dims && (dims.widthPx > capW || dims.heightPx > capH) && !didPre) {
            lastReq = fitFloor(dims.widthPx, dims.heightPx, capW, capH);
            cur = img.resize({ ...lastReq, quality: 'good' });
            ({ jpegBytes, dims } = enc(cur));
        }
        if (dims && (dims.widthPx > capW || dims.heightPx > capH)) {
            const want = fitFloor(dims.widthPx, dims.heightPx, capW, capH);
            const cs = cur.getSize?.() ?? lastReq;
            const bw = cs.width > 0 ? cs.width : lastReq.width;
            const bh = cs.height > 0 ? cs.height : lastReq.height;
            const width = Math.max(1, Math.floor(want.width / (bw > 0 ? dims.widthPx / bw : 1)));
            const height = Math.max(1, Math.floor(want.height / (bh > 0 ? dims.heightPx / bh : 1)));
            cur = img.resize({ width, height, quality: 'good' });
            ({ jpegBytes, dims } = enc(cur));
        }
        if (jpegBytes.byteLength > browserViewerUrlPolicy_1.MAX_BLOB_BYTES) {
            ({ jpegBytes, dims } = enc(cur, exports.READ_FRAME_FALLBACK_JPEG_QUALITY));
        }
        const ok = dims !== null &&
            dims.widthPx >= 1 &&
            dims.heightPx >= 1 &&
            dims.widthPx <= capW &&
            dims.heightPx <= capH &&
            jpegBytes.byteLength >= 1 &&
            jpegBytes.byteLength <= browserViewerUrlPolicy_1.MAX_BLOB_BYTES;
        return ok && dims ? { jpegBytes, dims } : null;
    }
    catch {
        return null;
    }
}
class BrowserViewerTabSnapshotController {
    constructor(opts = {}) {
        this.opts = opts;
        this.cssCursors = new WeakMap();
        this.cursorHooked = new WeakSet();
        this.subscribers = new Map();
        this.reg = opts.registry ?? wcvBrowserRegistry_1.wcvBrowserRegistry;
        this.cReg = this.reg instanceof wcvBrowserRegistry_1.WcvBrowserRegistry ? this.reg : null;
    }
    openWins() {
        return (this.opts.getLocalWindows ?? utils_1.getLocalHubWindows)().filter((w) => Boolean(w && !w.isDestroyed?.()));
    }
    isEverOwned(tabKey, entry) {
        if (typeof this.reg.isTabEverAgentOwned === 'function') {
            return this.reg.isTabEverAgentOwned(tabKey);
        }
        const e = entry ?? this.reg.getEntry(tabKey);
        return Boolean(e &&
            (e.everAgentOwned ||
                e.isAgentStepActive ||
                this.reg.isGuestAgentOwned(e.webContentsId)));
    }
    hasBrowserHost() {
        return this.openWins().length > 0;
    }
    getLiveOwnedEntry(tabKey) {
        const e = this.reg.getEntry(tabKey);
        const wc = e?.view?.webContents;
        const ok = Boolean(e &&
            !e.crashed &&
            wc &&
            !wc.isDestroyed?.() &&
            !wc.isCrashed?.() &&
            this.isEverOwned(tabKey, e));
        return ok && e && this.openWins().includes(e.parentWindow) ? e : undefined;
    }
    resolveGuestDipSize(e) {
        const clip = (this.opts.getWindowClipView ?? utils_1.getHubClipView)(e.parentWindow);
        let viewBounds;
        try {
            viewBounds = e.view?.getBounds?.();
        }
        catch {
            viewBounds = undefined;
        }
        for (const r of [
            clip ? e.appliedBoundsDip : undefined,
            e.contentSizeDip,
            e.boundsDip,
            e.lastNonZeroSize,
            viewBounds,
        ]) {
            const sz = toDip(r);
            if (sz) {
                return sz;
            }
        }
        return {
            widthDip: wcvBrowserRegistry_1.DEFAULT_HIDDEN_WCV_BOUNDS.width,
            heightDip: wcvBrowserRegistry_1.DEFAULT_HIDDEN_WCV_BOUNDS.height,
        };
    }
    ensureCursorHook(wc) {
        if (!wc ||
            wc.isDestroyed?.() ||
            typeof wc.on !== 'function' ||
            this.cursorHooked.has(wc)) {
            return;
        }
        this.cursorHooked.add(wc);
        const onCursor = (_ev, t) => {
            this.cssCursors.set(wc, (0, wcvZOrderController_1.mapElectronCursorToCss)(t));
        };
        wc.on('cursor-changed', onCursor);
        wc.once?.('destroyed', () => {
            const off = (typeof wc.removeListener === 'function' ? wc.removeListener : wc.off)?.bind(wc);
            off?.('cursor-changed', onCursor);
            this.cssCursors.delete(wc);
            this.cursorHooked.delete(wc);
        });
    }
    resolveDpr(win) {
        try {
            const fn = this.opts.getDisplayScaleFactor;
            const r = fn
                ? fn(win)
                : electron_1.screen.getDisplayMatching(win.getBounds()).scaleFactor;
            return isPos(r) ? r : 1;
        }
        catch {
            return 1;
        }
    }
    readTabMeta(e, remoteControlGranted) {
        const wc = e.view?.webContents;
        const alive = Boolean(wc && !wc.isDestroyed?.());
        const liveUrl = alive ? wc.getURL?.() || '' : '';
        const low = liveUrl.toLowerCase();
        const okLive = liveUrl !== '' &&
            low !== 'about:blank' &&
            !low.startsWith('chrome-error://');
        const rawUrl = !e.lastLoadError && okLive ? liveUrl : e.lastUrl || '';
        const rawTitle = (alive ? wc.getTitle?.() || '' : '') || e.lastTitle || '';
        const hist = alive ? wc.navigationHistory : undefined;
        const { widthDip, heightDip } = this.resolveGuestDipSize(e);
        return {
            tabId: e.tabKey,
            widthDip,
            heightDip,
            url: sanitizeControlFreeUtf8(rawUrl, browserViewerUrlPolicy_1.MAX_URL_BYTES),
            title: sanitizeNulFreeUtf8(rawTitle, exports.MAX_TAB_TITLE_BYTES),
            canGoBack: Boolean(hist?.canGoBack?.() ?? (alive && wc.canGoBack?.())),
            canGoForward: Boolean(hist?.canGoForward?.() ?? (alive && wc.canGoForward?.())),
            isLoading: Boolean(alive && wc.isLoading?.()),
            isAgentStepActive: Boolean(e.isAgentStepActive),
            ...(remoteControlGranted !== undefined ? { remoteControlGranted } : {}),
        };
    }
    buildBrowserTabInfo(entry, rootId) {
        const m = this.readTabMeta(entry);
        return (0, protobuf_1.create)(browser_viewer_pb_1.BrowserTabInfoSchema, {
            tabId: m.tabId,
            rootConversationId: rootId,
            url: m.url ?? '',
            title: m.title ?? '',
            active: Boolean(entry.visible),
            loading: Boolean(m.isLoading),
            agentOwned: this.reg.isGuestAgentOwned(entry.webContentsId),
            widthPx: m.widthDip,
            heightPx: m.heightDip,
        });
    }
    buildCaptureSessionState(target, stateOpts) {
        const e = typeof target === 'string' ? this.getLiveOwnedEntry(target) : target;
        if (!e) {
            return null;
        }
        const wc = e.view?.webContents;
        this.ensureCursorHook(wc);
        const showAgc = Boolean(e.isAgentStepActive) ||
            this.reg.isGuestAgentOwned(e.webContentsId);
        const cReg = this.cReg;
        const getAgc = this.opts.getAgentCursorState ??
            ((k) => (cReg ? (0, wcvIpcHandlers_1.getWcvAgentCursorState)(k, cReg) : null));
        return {
            tabMeta: this.readTabMeta(e, stateOpts?.remoteControlGranted),
            cssCursor: (wc && this.cssCursors.get(wc)) ?? 'default',
            agentCursor: showAgc ? getAgc(e.tabKey) : null,
            devicePixelRatio: this.resolveDpr(e.parentWindow),
        };
    }
    collectEntries(wins, rootId) {
        const out = [];
        const seen = new Set();
        for (const win of wins) {
            for (const e of this.reg.getEntriesForWindow(win)) {
                const wc = e.view?.webContents;
                if (!seen.has(e.tabKey) &&
                    !e.crashed &&
                    wc &&
                    !wc.isDestroyed?.() &&
                    !wc.isCrashed?.() &&
                    wins.includes(e.parentWindow) &&
                    (0, browserViewerUrlPolicy_1.parseConversationTabKey)(e.tabKey)?.rootConversationId === rootId &&
                    this.isEverOwned(e.tabKey, e)) {
                    seen.add(e.tabKey);
                    out.push(e);
                }
            }
        }
        return out;
    }
    listConversationTabs(rootId) {
        if (!(0, browserViewerUrlPolicy_1.isValidRootConversationId)(rootId)) {
            return {
                hasBrowserHost: this.hasBrowserHost(),
                result: errRes(INVALID_REQ, 'Invalid rootConversationId'),
            };
        }
        const wins = this.openWins();
        if (wins.length === 0) {
            return {
                hasBrowserHost: false,
                result: (0, protobuf_1.create)(browser_viewer_pb_1.BrowserViewerResultSchema, { tabs: [] }),
            };
        }
        const tabs = this.collectEntries(wins, rootId)
            .sort(cmpVisRecent)
            .slice(0, exports.MAX_BROWSER_VIEWER_TABS)
            .map((e) => this.buildBrowserTabInfo(e, rootId));
        return {
            hasBrowserHost: true,
            result: (0, protobuf_1.create)(browser_viewer_pb_1.BrowserViewerResultSchema, { tabs }),
        };
    }
    async resolveLiveOrRehydratedTab(tabKey) {
        const wins = this.openWins();
        if (wins.length === 0) {
            return undefined;
        }
        const rehydrate = (win, s) => this.reg.withOperationPin(tabKey, async () => {
            try {
                await this.reg.rehydrateEvicted(win, s, tabKey);
            }
            catch {
                return undefined;
            }
            return this.getLiveOwnedEntry(tabKey);
        });
        const ex = this.reg.getEntry(tabKey);
        if (ex) {
            if (!this.isEverOwned(tabKey, ex)) {
                return undefined;
            }
            return wins.includes(ex.parentWindow) &&
                Boolean(ex.hubSender && !ex.hubSender.isDestroyed?.())
                ? rehydrate(ex.parentWindow, ex.hubSender)
                : this.getLiveOwnedEntry(tabKey);
        }
        if (typeof this.reg.isTabEverAgentOwned === 'function' &&
            !this.reg.isTabEverAgentOwned(tabKey)) {
            return undefined;
        }
        const sid = this.reg.hasEvicted(tabKey)
            ? this.reg.getEvictedSenderId(tabKey)
            : undefined;
        const getWc = this.opts.getWindowWebContents ?? utils_1.getHubWebContents;
        for (const win of sid === undefined ? [] : wins) {
            const s = getWc(win);
            if (s && !s.isDestroyed?.() && s.id === sid) {
                return rehydrate(win, s);
            }
        }
        return undefined;
    }
    async withPinnedOfferTab(rootId, requestedTabId, op, onPostOpTabGone) {
        const validTab = typeof requestedTabId === 'string' &&
            (requestedTabId === '' ||
                (0, browserViewerUrlPolicy_1.parseConversationTabKey)(requestedTabId)?.rootConversationId === rootId);
        if (!(0, browserViewerUrlPolicy_1.isValidRootConversationId)(rootId) || !validTab) {
            return failOffer(INVALID_REQ, 'Invalid rootConversationId or tabId');
        }
        const wins = this.openWins();
        if (wins.length === 0) {
            return failOffer('FAILED_PRECONDITION', 'No open local browser host');
        }
        const cmpOffer = (a, b) => Number(this.reg.isGuestAgentOwned(b.webContentsId)) -
            Number(this.reg.isGuestAgentOwned(a.webContentsId)) ||
            cmpVisRecent(a, b);
        const key = requestedTabId ||
            this.collectEntries(wins, rootId).sort(cmpOffer)[0]?.tabKey ||
            '';
        if (!key) {
            return failOffer('TAB_NOT_FOUND', 'No live browser tab for conversation');
        }
        return this.reg.withOperationPin(key, async () => {
            const entry = await this.resolveLiveOrRehydratedTab(key);
            if (!entry) {
                return failOffer('TAB_NOT_FOUND', 'Browser tab not found');
            }
            const tab = this.buildBrowserTabInfo(entry, rootId);
            const initialState = this.buildCaptureSessionState(entry);
            const value = await op({ entry, tab, initialState });
            const post = this.getLiveOwnedEntry(key);
            if (!post) {
                if (onPostOpTabGone) {
                    try {
                        await onPostOpTabGone(value);
                    }
                    catch {
                        // Cleanup errors must not mask TAB_NOT_FOUND result.
                    }
                }
                return failOffer('TAB_NOT_FOUND', 'Tab closed while opening view');
            }
            return { ok: true, value, tab: this.buildBrowserTabInfo(post, rootId) };
        });
    }
    notifyTabStateSubscribers(tabKey) {
        const subs = this.subscribers.get(tabKey);
        const live = subs && subs.size > 0 ? this.getLiveOwnedEntry(tabKey) : undefined;
        if (!subs || !live) {
            return;
        }
        const snap = this.buildCaptureSessionState(live);
        for (const sub of [...subs]) {
            if (subs.has(sub)) {
                try {
                    sub(live, snap);
                }
                catch {
                    // Isolate subscriber errors so remaining listeners still receive updates.
                }
            }
        }
    }
    watchTabState(tabKey, cb) {
        const initial = this.getLiveOwnedEntry(tabKey);
        if (!initial) {
            return () => undefined;
        }
        const [wc, wcId] = [initial.view.webContents, initial.webContentsId];
        this.ensureCursorHook(wc);
        let disposed = false;
        const sub = (live, s) => {
            if (!disposed && live.view?.webContents === wc) {
                cb.onStateChange(s);
            }
        };
        const set = this.subscribers.get(tabKey) ?? new Set();
        this.subscribers.set(tabKey, set.add(sub));
        const push = () => {
            const live = !disposed ? this.getLiveOwnedEntry(tabKey) : undefined;
            if (live && live.view?.webContents === wc) {
                sub(live, this.buildCaptureSessionState(live));
            }
        };
        const cReg = this.cReg;
        const onAgc = this.opts.onAgentCursorStateChanged ??
            ((fn) => cReg ? (0, wcvIpcHandlers_1.onWcvAgentCursorStateChanged)(fn, cReg) : () => undefined);
        const offCursor = onAgc((k) => {
            if (k === tabKey) {
                push();
            }
        });
        const offArmed = (this.opts.onAgentControlArmed ?? guestAgentControl_1.onGuestAgentControlArmed)((id) => {
            if (id === wcId) {
                push();
            }
        });
        const offWc = bindGuest(wc, push, () => {
            if (!disposed) {
                cleanup();
                cb.onTabGone();
            }
        });
        const cleanup = () => {
            if (!disposed) {
                disposed = true;
                offWc();
                offCursor();
                offArmed();
                const cur = this.subscribers.get(tabKey);
                cur?.delete(sub);
                if (cur && cur.size === 0) {
                    this.subscribers.delete(tabKey);
                }
            }
        };
        return cleanup;
    }
    async readFrame(rootId, req) {
        if (!(0, browserViewerUrlPolicy_1.isValidRootConversationId)(rootId) ||
            !req ||
            typeof req !== 'object' ||
            typeof req.tabId !== 'string' ||
            (0, browserViewerUrlPolicy_1.parseConversationTabKey)(req.tabId)?.rootConversationId !== rootId ||
            !isCap(req.maxWidthPx) ||
            !isCap(req.maxHeightPx)) {
            return failFrame(INVALID_REQ, 'Invalid readFrame request');
        }
        if (!this.hasBrowserHost()) {
            return failFrame('FAILED_PRECONDITION', 'No open local browser host');
        }
        const { tabId, maxWidthPx, maxHeightPx } = req;
        const capW = maxWidthPx > 0 ? maxWidthPx : exports.DEFAULT_READ_FRAME_MAX_WIDTH_PX;
        const capH = maxHeightPx > 0 ? maxHeightPx : exports.DEFAULT_READ_FRAME_MAX_HEIGHT_PX;
        const capturer = this.opts.controller ?? wcvZOrderController_1.wcvZOrderController;
        return this.reg.withOperationPin(tabId, async () => {
            if (!this.getLiveOwnedEntry(tabId)) {
                return failFrame('TAB_NOT_FOUND', 'Browser tab not found');
            }
            let img;
            try {
                img = await capturer.capturePageImage(tabId);
            }
            catch {
                img = null;
            }
            if (!img || img.isEmpty?.()) {
                return !this.getLiveOwnedEntry(tabId)
                    ? failFrame('TAB_NOT_FOUND', 'Tab closed while capturing frame')
                    : failFrame('FAILED_PRECONDITION', 'Failed to capture browser frame');
            }
            const encoded = encodeBoundedJpeg(img, capW, capH);
            const post = this.getLiveOwnedEntry(tabId);
            if (!post) {
                return failFrame('TAB_NOT_FOUND', 'Tab closed while capturing frame');
            }
            if (!encoded) {
                return failFrame('FAILED_PRECONDITION', 'Failed to encode JPEG frame');
            }
            return {
                result: (0, protobuf_1.create)(browser_viewer_pb_1.BrowserViewerResultSchema, {
                    tab: this.buildBrowserTabInfo(post, rootId),
                }),
                blobs: [
                    {
                        name: 'frame.jpg',
                        mimeType: 'image/jpeg',
                        data: encoded.jpegBytes,
                        widthPx: encoded.dims.widthPx,
                        heightPx: encoded.dims.heightPx,
                    },
                ],
            };
        });
    }
}
exports.BrowserViewerTabSnapshotController = BrowserViewerTabSnapshotController;
exports.browserViewerTabSnapshot = new BrowserViewerTabSnapshotController();
