"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guestFrameBridge = exports.GuestFrameBridgeController = exports.FRAME_EVAL_TIMEOUT_MS = exports.PAGE_AGENT_ISOLATED_WORLD_NAME = void 0;
const guestDebugger_1 = require("./guestDebugger");
const guestFramePolicy_1 = require("./guestFramePolicy");
Object.defineProperty(exports, "PAGE_AGENT_ISOLATED_WORLD_NAME", { enumerable: true, get: function () { return guestFramePolicy_1.PAGE_AGENT_ISOLATED_WORLD_NAME; } });
const AUTO_ATTACH = {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
};
// Used only when Page.getLayoutMetrics is unavailable; the in-page geometry
// function still clips every frame to its own document's viewport.
const UNBOUNDED_ROOT_RECT = {
    x: 0,
    y: 0,
    width: 1e9,
    height: 1e9,
    visible: true,
};
exports.FRAME_EVAL_TIMEOUT_MS = 30000;
function withTimeout(p, ms, msg) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(msg)), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
const isNodeIdp = (u, o) => (0, guestFramePolicy_1.isProtectedIdpFrameUrl)(u || '') || (0, guestFramePolicy_1.isProtectedIdpFrameUrl)(o || '');
const isMainOnIdp = (wc) => (0, guestFramePolicy_1.isProtectedIdpFrameUrl)(wc.getURL?.() || '') ||
    isNodeIdp(wc.mainFrame?.url, wc.mainFrame?.origin);
function cdp(dbg, sid, method, params = {}) {
    if (typeof dbg.sendCommand !== 'function') {
        return Promise.reject(new Error('CDP sendCommand is unavailable'));
    }
    return (sid ? dbg.sendCommand(method, params, sid) : dbg.sendCommand(method, params));
}
function purgeWorlds(state, sid) {
    for (const map of [state.worlds, state.pendingWorlds]) {
        for (const key of map.keys()) {
            if (key.startsWith(`${sid}::`)) {
                map.delete(key);
            }
        }
    }
}
function isStaleCtxErr(err) {
    if (err?.isEvalErr) {
        return false;
    }
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return /cannot find context|execution context was destroyed|inspected target navigated|frame with the given id was not found/i.test(msg);
}
function findChain(n, target) {
    if (n.id === target) {
        return [n];
    }
    for (const ch of n.children) {
        const sub = findChain(ch, target);
        if (sub) {
            return [n, ...sub];
        }
    }
    return undefined;
}
class GuestFrameBridgeController {
    constructor() {
        this.states = new WeakMap();
    }
    ensureState(wc, dbg) {
        let state = this.states.get(wc);
        if (!state) {
            state = {
                listening: false,
                targets: new Map(),
                worlds: new Map(),
                pendingWorlds: new Map(),
            };
            this.states.set(wc, state);
        }
        if (state.listening) {
            return state;
        }
        state.listening = true;
        const cur = state;
        dbg.on?.('message', (_ev, method, params, incomingSid) => {
            const parentSid = incomingSid || '';
            const sid = typeof params?.sessionId === 'string' ? params.sessionId : '';
            if (method === 'Target.attachedToTarget') {
                const info = params?.targetInfo;
                if (sid && info?.type === 'iframe') {
                    const p = cdp(dbg, sid, 'Target.setAutoAttach', AUTO_ATTACH);
                    cur.targets.set(sid, {
                        sessionId: sid,
                        targetId: String(info.targetId || ''),
                        parentSessionId: parentSid,
                        ready: p.then(() => undefined).catch(() => undefined),
                    });
                }
                if (sid && params?.waitingForDebugger === true) {
                    void cdp(dbg, sid, 'Runtime.runIfWaitingForDebugger').catch(() => undefined);
                }
            }
            else if (method === 'Target.detachedFromTarget' && sid) {
                const q = [sid];
                while (q.length > 0) {
                    const s = q.pop();
                    cur.targets.delete(s);
                    purgeWorlds(cur, s);
                    for (const [k, t] of cur.targets.entries()) {
                        if (t.parentSessionId === s) {
                            q.push(k);
                        }
                    }
                }
            }
            else if (method === 'Page.frameNavigated') {
                const fid = params?.frame?.id;
                if (typeof fid === 'string' && fid) {
                    cur.worlds.delete(`${parentSid}::${fid}`);
                    cur.pendingWorlds.delete(`${parentSid}::${fid}`);
                }
            }
            else if (method === 'Runtime.executionContextDestroyed') {
                const ctxId = params?.executionContextId;
                for (const [k, v] of cur.worlds.entries()) {
                    if (v === ctxId) {
                        cur.worlds.delete(k);
                    }
                }
            }
            else if (method === 'Runtime.executionContextsCleared') {
                purgeWorlds(cur, parentSid);
            }
        });
        dbg.on?.('detach', () => {
            cur.rootReady = undefined;
            cur.targets.clear();
            cur.worlds.clear();
            cur.pendingWorlds.clear();
        });
        return state;
    }
    async ensureAttached(wc) {
        const dbg = !wc.isDestroyed?.() ? wc.debugger : undefined;
        if (!dbg ||
            typeof dbg.sendCommand !== 'function' ||
            !(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            return null;
        }
        const state = this.ensureState(wc, dbg);
        if (!state.rootReady) {
            state.rootReady = cdp(dbg, '', 'Target.setAutoAttach', AUTO_ATTACH)
                .then(() => undefined)
                .catch((err) => {
                state.rootReady = undefined;
                throw err;
            });
        }
        try {
            await state.rootReady;
        }
        catch {
            return null;
        }
        const seen = new Set();
        for (;;) {
            const batch = [];
            for (const t of state.targets.values()) {
                if (t.ready && !seen.has(t.ready)) {
                    seen.add(t.ready);
                    batch.push(t.ready);
                }
            }
            if (batch.length === 0) {
                break;
            }
            await Promise.all(batch);
        }
        return { dbg, state };
    }
    // Resolves the session to run in via `resolveSid` on every attempt, so a
    // retry after a stale context re-validates the frame before running again.
    async withWorld(dbg, state, resolveSid, frameId, fn) {
        const wp = {
            frameId,
            worldName: guestFramePolicy_1.PAGE_AGENT_ISOLATED_WORLD_NAME,
            grantUniversalAccess: false,
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            const sid = await resolveSid();
            const key = `${sid}::${frameId}`;
            if (attempt > 0) {
                state.worlds.delete(key);
                state.pendingWorlds.delete(key);
            }
            let ctxId = state.worlds.get(key);
            if (!ctxId) {
                let pending = state.pendingWorlds.get(key);
                if (!pending) {
                    const m = 'Page.createIsolatedWorld';
                    const created = cdp(dbg, sid, m, wp)
                        .then((res) => {
                        const id = res?.executionContextId;
                        if (typeof id !== 'number' || id <= 0) {
                            return undefined;
                        }
                        if (state.pendingWorlds.get(key) === created) {
                            state.worlds.set(key, id);
                        }
                        return id;
                    })
                        .finally(() => {
                        if (state.pendingWorlds.get(key) === created) {
                            state.pendingWorlds.delete(key);
                        }
                    });
                    state.pendingWorlds.set(key, created);
                    pending = created;
                }
                ctxId = await pending;
            }
            if (!ctxId) {
                throw new Error(`ISOLATED_WORLD_UNAVAILABLE: Frame ${frameId}`);
            }
            try {
                return await fn(sid, ctxId);
            }
            catch (err) {
                if (attempt === 0 && isStaleCtxErr(err)) {
                    continue;
                }
                throw err;
            }
        }
        throw new Error(`ISOLATED_WORLD_UNAVAILABLE: Frame ${frameId}`);
    }
    async collectTree(dbg, state) {
        const getTree = (s) => cdp(dbg, s, 'Page.getFrameTree').catch(() => undefined);
        const rootTree = (await getTree(''))?.frameTree;
        if (!rootTree?.frame?.id) {
            return null;
        }
        const oopifs = new Map();
        await Promise.all(Array.from(state.targets.values()).map(async (t) => {
            const tree = (await getTree(t.sessionId))?.frameTree;
            const fid = tree?.frame?.id || t.targetId;
            if (tree?.frame && fid) {
                const entry = { sid: t.sessionId, parentSid: t.parentSessionId, tree };
                oopifs.set(fid, entry);
            }
        }));
        const visited = new Set();
        const build = (n, sid, parentId, ownerSid) => {
            const f = n.frame;
            const id = f?.id ?? '';
            if (!id || visited.has(id)) {
                return null;
            }
            const oopif = oopifs.get(id);
            if (oopif && oopif.sid !== sid) {
                return build(oopif.tree, oopif.sid, f?.parentId || parentId, sid);
            }
            visited.add(id);
            const node = {
                id,
                parentId: f?.parentId || parentId,
                url: String(f?.url ?? ''),
                securityOrigin: String(f?.securityOrigin ?? ''),
                name: String(f?.name ?? ''),
                execSid: sid,
                ownerSid,
                children: [],
            };
            for (const ch of n.childFrames ?? []) {
                const sub = build(ch, sid, id, sid);
                if (sub) {
                    node.children.push(sub);
                }
            }
            for (const [oid, entry] of oopifs.entries()) {
                const dp = entry.tree.frame?.parentId ?? '';
                const isRoot = parentId === '' || ownerSid !== sid;
                const match = dp ? dp === id : entry.parentSid === sid && isRoot;
                if (!visited.has(oid) && match) {
                    const sub = build(entry.tree, entry.sid, id, sid);
                    if (sub) {
                        node.children.push(sub);
                    }
                }
            }
            return node;
        };
        return build(rootTree, '', '', '');
    }
    async resolveOwnerGeometry(dbg, state, ownerSid, parentFid, childFid) {
        const owner = await cdp(dbg, ownerSid, 'DOM.getFrameOwner', { frameId: childFid }).catch(() => undefined);
        const bId = owner?.backendNodeId;
        if (typeof bId !== 'number' || bId <= 0) {
            return undefined;
        }
        const ownerSidFn = async () => ownerSid;
        return this.withWorld(dbg, state, ownerSidFn, parentFid, async (_, ctxId) => {
            const p = { backendNodeId: bId, executionContextId: ctxId };
            const resolved = await cdp(dbg, ownerSid, 'DOM.resolveNode', p);
            const objectId = resolved?.object?.objectId;
            if (!objectId) {
                return undefined;
            }
            const fnParams = {
                objectId,
                functionDeclaration: guestFramePolicy_1.COMPUTE_OWNER_PATH_AND_RECT_FN,
                returnByValue: true,
            };
            try {
                const res = await cdp(dbg, ownerSid, 'Runtime.callFunctionOn', fnParams);
                const val = (res?.exceptionDetails ? null : res?.result?.value);
                if (!val || !(0, guestFramePolicy_1.isValidDomPath)(val.domPath) || !val.rect) {
                    return undefined;
                }
                const r = val.rect;
                const rx = Number(r.x);
                const ry = Number(r.y);
                const rw = Number(r.width);
                const rh = Number(r.height);
                if (![rx, ry, rw, rh].every(Number.isFinite)) {
                    return undefined;
                }
                const width = Math.max(0, rw);
                const height = Math.max(0, rh);
                const rect = { x: rx, y: ry, width, height, visible: !!r.visible };
                return { domPath: val.domPath, rect };
            }
            finally {
                void cdp(dbg, ownerSid, 'Runtime.releaseObject', { objectId }).catch(() => undefined);
            }
        }).catch(() => undefined);
    }
    async listFrames(wc) {
        const ok = Boolean(wc && !wc.isDestroyed?.() && !isMainOnIdp(wc));
        const attached = ok ? await this.ensureAttached(wc) : null;
        const root = attached
            ? await this.collectTree(attached.dbg, attached.state)
            : null;
        if (!attached || !root || isNodeIdp(root.url, root.securityOrigin)) {
            return guestFramePolicy_1.EMPTY_FRAME_TREE;
        }
        const mainOrigin = (0, guestFramePolicy_1.extractFrameOrigin)(root.securityOrigin, root.url) ||
            (0, guestFramePolicy_1.extractFrameOrigin)(wc.mainFrame?.origin, wc.getURL?.() || '');
        const frames = [];
        const walk = async (parent, scopeFid, scopeOrigin, scopeRect) => {
            for (const ch of parent.children) {
                const chOrigin = (0, guestFramePolicy_1.extractFrameOrigin)(ch.securityOrigin, ch.url);
                const opaque = (0, guestFramePolicy_1.isOpaqueOrigin)(ch.securityOrigin);
                const idp = isNodeIdp(ch.url, ch.securityOrigin);
                const same = !idp &&
                    !opaque &&
                    ch.execSid === parent.execSid &&
                    Boolean(chOrigin) &&
                    chOrigin === scopeOrigin;
                if (same) {
                    await walk(ch, scopeFid, scopeOrigin, scopeRect);
                    continue;
                }
                const geom = await this.resolveOwnerGeometry(attached.dbg, attached.state, ch.ownerSid, parent.id, ch.id);
                const rect = geom && (0, guestFramePolicy_1.composeFrameViewportRect)(scopeRect, geom.rect);
                frames.push({
                    frameId: ch.id,
                    parentFrameId: ch.parentId,
                    url: idp
                        ? chOrigin || (0, guestFramePolicy_1.extractFrameOrigin)(undefined, ch.url)
                        : (0, guestFramePolicy_1.redactFrameUrl)(ch.url),
                    origin: chOrigin || (opaque ? 'null' : ''),
                    name: ch.name,
                    isCrossOrigin: true,
                    isProtectedIdp: idp,
                    ownerContextFrameId: scopeFid,
                    ...(geom ? { ownerDomPath: geom.domPath } : {}),
                    ...(rect ? { viewportRect: rect } : {}),
                });
                if (!idp) {
                    const hide = { ...scopeRect, width: 0, height: 0, visible: false };
                    await walk(ch, ch.id, chOrigin, rect ?? hide);
                }
            }
        };
        await walk(root, '', mainOrigin, await this.rootRect(attached.dbg));
        const mainUrl = (0, guestFramePolicy_1.redactFrameUrl)(root.url);
        return { mainFrameId: root.id, mainUrl, mainOrigin, frames };
    }
    async rootRect(dbg) {
        const m = await cdp(dbg, '', 'Page.getLayoutMetrics').catch(() => undefined);
        const vp = m?.cssLayoutViewport ?? m?.layoutViewport;
        const width = Number(vp?.clientWidth);
        const height = Number(vp?.clientHeight);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return UNBOUNDED_ROOT_RECT;
        }
        return { x: 0, y: 0, width, height, visible: width >= 1 && height >= 1 };
    }
    /**
     * Runs `code` in the page-agent isolated world of `frameId`. When
     * `expectedOrigin` is given, throws FRAME_ORIGIN_CHANGED if the frame's
     * current document has a different origin. IdP and origin checks run both
     * against the CDP frame tree and inside the target context itself.
     */
    async executeInFrameIsolatedWorld(wc, frameId, code, expectedOrigin) {
        if (typeof frameId !== 'string' || !frameId.trim()) {
            throw new Error('frameId must be a non-empty string');
        }
        if (typeof code !== 'string') {
            throw new Error('code must be a string');
        }
        const expected = (0, guestFramePolicy_1.normalizeExpectedOrigin)(expectedOrigin);
        if (!wc || wc.isDestroyed?.() || isMainOnIdp(wc)) {
            throw new Error('IDP_BLOCKED: Guest unavailable or on protected IdP');
        }
        const attached = await this.ensureAttached(wc);
        if (!attached) {
            throw new Error('ISOLATED_WORLD_UNAVAILABLE: Guest debugger unavailable');
        }
        const { dbg, state } = attached;
        const resolveTarget = async () => {
            if (wc.isDestroyed?.() || isMainOnIdp(wc)) {
                throw new Error('IDP_BLOCKED: Guest unavailable or on protected IdP');
            }
            const root = await this.collectTree(dbg, state);
            if (!root) {
                throw new Error('ISOLATED_WORLD_UNAVAILABLE: Guest debugger unavailable');
            }
            const chain = findChain(root, frameId);
            if (!chain || chain.length === 0) {
                throw new Error(`FRAME_NOT_FOUND: Subframe ${frameId} is detached`);
            }
            if (chain.some((f) => isNodeIdp(f.url, f.securityOrigin))) {
                throw new Error('IDP_BLOCKED: Protected Identity Provider frame');
            }
            const t = chain[chain.length - 1];
            if (expected !== undefined) {
                const current = (0, guestFramePolicy_1.extractFrameOrigin)(t.securityOrigin, t.url) ||
                    ((0, guestFramePolicy_1.isOpaqueOrigin)(t.securityOrigin) ? 'null' : '');
                if (current !== expected) {
                    throw new Error('FRAME_ORIGIN_CHANGED: Frame origin no longer matches the expected origin');
                }
            }
            return t.execSid;
        };
        const expression = `${(0, guestFramePolicy_1.buildFrameGuardPrelude)(expected)}${code}`;
        return this.withWorld(dbg, state, resolveTarget, frameId, (sid, id) => withTimeout(cdp(dbg, sid, 'Runtime.evaluate', {
            expression,
            contextId: id,
            returnByValue: true,
            awaitPromise: true,
            userGesture: false,
        }), exports.FRAME_EVAL_TIMEOUT_MS, `FRAME_EVAL_TIMEOUT: Frame ${frameId} did not finish within ${exports.FRAME_EVAL_TIMEOUT_MS}ms`).then((res) => {
            if (res?.exceptionDetails) {
                const exc = res.exceptionDetails.exception;
                const msg = exc?.description ||
                    (exc?.value !== undefined ? String(exc.value) : '') ||
                    res.exceptionDetails.text ||
                    'Frame isolated world evaluation failed';
                throw Object.assign(new Error(msg), { isEvalErr: true });
            }
            return res?.result?.value;
        }));
    }
}
exports.GuestFrameBridgeController = GuestFrameBridgeController;
exports.guestFrameBridge = new GuestFrameBridgeController();
