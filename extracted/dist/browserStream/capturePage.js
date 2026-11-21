"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCapturePageScript = exports.renderCapturePageHtml = exports.installCapturePageRuntime = exports.parseCaptureViewerMessage = exports.encodeCaptureHostMessage = exports.normalizeIceServers = exports.sanitizeAnswerSdp = exports.validateSdp = exports.buildTrackCapConstraints = exports.buildFallbackTabCaptureConstraints = exports.buildTabCaptureConstraints = exports.computeCaptureDimensions = exports.MAX_DC_MESSAGE_BYTES = exports.MAX_PASTE_TEXT_BYTES = exports.MAX_SDP_BYTES = exports.BROWSER_STREAM_PROTOCOL_VERSION = exports.BROWSER_STREAM_DATA_CHANNEL_LABEL = void 0;
function createCapturePageKernel() {
    const [L, V, S, P, D] = ['agy-browser', 1, 65536, 65536, 131072];
    const BTNS = ['left', 'middle', 'right', 'back', 'forward'];
    const NAV_RE = /^https?:\/\/[^/\s][^\s]*$/i;
    const OVER_P = 'overconstrained|constraint.*not.*satisfied|';
    const OVER_RE = new RegExp(OVER_P + '(?:min|max)(?:Width|Height|FrameRate)', 'i');
    const SDP_P = '(?:^|\\s)(?:v=0|m=video|a=candidate:|a=fingerprint:|';
    const SDP_RE = new RegExp(SDP_P + 'a=ice-(?:ufrag|pwd):)', 'i');
    const META_TYPES = Object.create(null);
    for (const [t, ks] of [
        ['number', 'widthDip,heightDip'],
        ['string', 'url,title'],
        [
            'boolean',
            'canGoBack,canGoForward,isLoading,isAgentStepActive,remoteControlGranted',
        ],
    ]) {
        ks.split(',').forEach((k) => (META_TYPES[k] = t));
    }
    const noop = () => undefined;
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
    const isPos = (v) => isNum(v) && v > 0;
    const pickPos = (...vs) => vs.find(isPos) ?? 1;
    function fail(msg) {
        throw new Error(msg);
    }
    const must = (v, m) => v ? v : fail(m);
    const tryDo = (fn) => {
        try {
            return fn ? fn() : null;
        }
        catch {
            return null;
        }
    };
    const utf8 = (s) => {
        let n = 0;
        for (const c of s) {
            const k = c.charCodeAt(0);
            n += c.length > 1 ? 4 : k < 128 ? 1 : k < 2048 ? 2 : 3;
        }
        return n;
    };
    const hasCtrl = (s, lf = false) => {
        for (let i = 0; i < s.length; i++) {
            const k = s.charCodeAt(i);
            if ((k < 32 && (!lf || k !== 10)) || k === 127) {
                return true;
            }
        }
        return false;
    };
    const within = (s, cap) => typeof s === 'string' && s.length <= cap && utf8(s) <= cap;
    const dims = (w, h, dpr = 1) => {
        const ok = isPos(w) && isPos(h);
        const s = ok ? Math.min(Math.max(2, pickPos(dpr)), 3840 / w, 2160 / h) : 0;
        const ev = (d, c) => ok ? Math.min(c, Math.max(2, Math.round((d * s) / 2) * 2)) : 2;
        return { maxWidth: ev(w, 3840), maxHeight: ev(h, 2160) };
    };
    const mand = (id, ex) => {
        const base = { chromeMediaSource: 'tab', chromeMediaSourceId: id };
        return { audio: false, video: { mandatory: { ...base, ...ex } } };
    };
    const FPS = { minFrameRate: 1, maxFrameRate: 60 };
    const tabC = (id, w, h, d = 1) => mand(id, { ...FPS, ...dims(w, h, d) });
    const fbC = (id) => mand(id, {});
    const trkC = (w, h, d = 1) => {
        const { maxWidth: mw, maxHeight: mh } = dims(w, h, d);
        return { width: { max: mw }, height: { max: mh }, frameRate: { max: 60 } };
    };
    const vSdp = (s) => within(s, S) && s.length > 0 && !hasCtrl(s.replace(/\r\n/g, '\n'), true)
        ? s
        : fail('Invalid SDP');
    const isLoop = (a) => {
        const s = a.trim().toLowerCase();
        const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
        const v4 = m ? m.slice(1).every((x) => Number(x) <= 255) : false;
        return v4 || s === '::1' || s === '0:0:0:0:0:0:0:1';
    };
    const cParts = (l) => l.startsWith('a=candidate:') ? l.split(' ') : null;
    const cTyp = (p) => p && p.length >= 8 && p[6].toLowerCase() === 'typ'
        ? p[7].toLowerCase()
        : '';
    const sSdp = (ans, offer) => {
        vSdp(ans);
        const loopOk = Boolean(offer?.split(/\r?\n/).some((l) => {
            const p = cParts(l);
            return Boolean(cTyp(p) && isLoop(p[4]));
        }));
        let [kept, drop] = [0, 0];
        const out = ans.split(/\r?\n/).filter((l) => {
            const p = cParts(l);
            if (!p) {
                return true;
            }
            const t = cTyp(p);
            const mdns = Boolean(p[4]?.toLowerCase().endsWith('.local'));
            const ok = t !== '' && (t !== 'host' || mdns || (loopOk && isLoop(p[4])));
            kept += ok ? 1 : 0;
            drop += ok ? 0 : 1;
            return ok;
        });
        const eol = ans.includes('\r\n') ? '\r\n' : '\n';
        return drop > 0 && kept === 0
            ? fail('No usable ICE candidates in answer')
            : out.join(eol);
    };
    const nonEmp = (x) => typeof x === 'string' && x.trim().length > 0;
    const ice = (raw) => !Array.isArray(raw)
        ? []
        : raw.flatMap((e) => {
            const u = isObj(e) ? e.urls : null;
            const arr = Array.isArray(u)
                ? u.filter(nonEmp).map((x) => x.trim())
                : [];
            const urls = typeof u === 'string' ? u.trim() : arr;
            const ls = typeof urls === 'string' ? (urls ? [urls] : []) : urls;
            const cr = isObj(e) && ls.length > 0 && !ls.every((x) => /^stuns?:/i.test(x));
            const kv = (k) => cr && isObj(e) && typeof e[k] === 'string' && e[k]
                ? { [k]: e[k] }
                : {};
            const item = { urls, ...kv('username'), ...kv('credential') };
            return ls.length ? [item] : [];
        });
    const enc = (m) => {
        const s = JSON.stringify(m);
        return within(s, D) ? s : null;
    };
    const crd = (v) => isNum(v) && Math.abs(v) <= 100000 ? v || 0 : null;
    const rng = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi
        ? v || 0
        : null;
    const kStr = (lo) => (v) => within(v, 64) && !v.includes('\0') && utf8(v) >= lo ? v : null;
    const opts = (o, s, rs) => Object.entries(rs).every(([k, fn]) => {
        const r = fn && s[k] !== undefined ? fn(s[k]) : undefined;
        return r !== null && (r === undefined || ((o[k] = r), true));
    })
        ? o
        : null;
    const P_OPT = { buttons: rng(0, 31), clickCount: rng(0, 10) };
    const K_OPT = { code: kStr(0), keyCode: rng(0, 255), modifiers: rng(0, 15) };
    const boolOpt = (v) => (typeof v === 'boolean' ? v : null);
    const parseEv = (ev) => {
        const k = isObj(ev) && typeof ev.kind === 'string' ? ev.kind : '';
        if (!isObj(ev) || !k) {
            return null;
        }
        if (k === 'pointerdown' || k === 'pointerup' || k === 'pointermove') {
            const [x, y] = [crd(ev.x), crd(ev.y)];
            const button = (v) => BTNS.includes(v) || (k === 'pointermove' && v === 'none')
                ? v
                : null;
            const rs = { button, ...P_OPT, modifiers: rng(0, 15) };
            return x === null || y === null ? null : opts({ kind: k, x, y }, ev, rs);
        }
        if (k === 'wheel') {
            const cs = [ev.x, ev.y, ev.deltaX, ev.deltaY].map(crd);
            const b = { kind: k, x: cs[0], y: cs[1], deltaX: cs[2], deltaY: cs[3] };
            return cs.some((c) => c === null)
                ? null
                : opts(b, ev, { modifiers: rng(0, 15) });
        }
        if (k === 'keydown' || k === 'keyup') {
            const key = kStr(1)(ev.key);
            const bad = k === 'keyup' && ev.text !== undefined && ev.text !== '';
            const text = k === 'keydown' ? kStr(0) : undefined;
            const rs = { ...K_OPT, repeat: boolOpt, text };
            return key === null || bad ? null : opts({ kind: k, key }, ev, rs);
        }
        return k === 'paste' && within(ev.text, P)
            ? { kind: 'paste', text: ev.text }
            : null;
    };
    const dec = (raw) => {
        const m = within(raw, D) && raw.length > 0
            ? tryDo(() => JSON.parse(raw))
            : null;
        const t = isObj(m) && (m.v === undefined || m.v === V) ? m.type : null;
        if (t === 'stop') {
            return { type: 'stop' };
        }
        const tok = isObj(m) && m.controlToken !== undefined
            ? within(m.controlToken, 256) &&
                m.controlToken.length > 0 &&
                !hasCtrl(m.controlToken) &&
                !/\s/.test(m.controlToken)
                ? { controlToken: m.controlToken }
                : null
            : {};
        if (!tok) {
            return null;
        }
        if (t === 'back' || t === 'forward' || t === 'reload') {
            return { type: t, ...tok };
        }
        if (t === 'navigate' && isObj(m) && within(m.url, 8192) && m.url.length) {
            const u = m.url;
            const valid = !hasCtrl(u) && !/\s/.test(u) && (u === 'about:blank' || NAV_RE.test(u));
            return valid ? { type: 'navigate', url: u, ...tok } : null;
        }
        const event = t === 'input_event' && isObj(m) ? parseEv(m.event) : null;
        return event ? { type: 'input_event', event, ...tok } : null;
    };
    const isOver = (e) => isObj(e) &&
        (e.name === 'OverconstrainedError' ||
            e.name === 'ConstraintNotSatisfiedError' ||
            (typeof e.message === 'string' && OVER_RE.test(e.message)));
    const fmtErr = (e, offer) => {
        const msg = isObj(e) && typeof e.message === 'string'
            ? e.message
            : 'Capture session failed';
        const raw = typeof e === 'string' ? e : msg;
        const leak = Boolean(offer && raw.includes(offer)) || SDP_RE.test(raw);
        return (leak ? 'WebRTC SDP negotiation failed' : raw).slice(0, 256);
    };
    const stopAll = (s, t) => {
        const a = [...(s?.getTracks?.() ?? []), ...(s?.getVideoTracks() ?? [])];
        new Set(t ? [...a, t] : a).forEach((x) => tryDo(() => x.stop()));
    };
    const run = (win) => {
        const br = win?.agyBrowserCapture;
        if (!win || !br) {
            return undefined;
        }
        const map = new Map();
        const live = (r) => !r.disposed && map.get(r.sessionId) === r;
        const emit = (e) => e && tryDo(() => void Promise.resolve(br.sendEvent(e)).catch(noop));
        const ack = (a) => tryDo(() => void Promise.resolve(br.ackCommand(a)).catch(noop));
        const setTmr = (cb, ms) => typeof win.setTimeout === 'function'
            ? win.setTimeout(cb, ms)
            : typeof setTimeout === 'function'
                ? setTimeout(cb, ms)
                : undefined;
        const clrTmr = (tm) => tm !== undefined &&
            (typeof win.clearTimeout === 'function'
                ? win.clearTimeout(tm)
                : typeof clearTimeout === 'function' && clearTimeout(tm));
        const cap = (r) => tryDo(() => {
            const c = trkC(r.tabMeta.widthDip, r.tabMeta.heightDip, r.dpr);
            if (typeof r.track?.applyConstraints === 'function') {
                void Promise.resolve(r.track.applyConstraints(c)).catch(noop);
            }
        });
        const sendDc = (r, m, c, a, o = false) => {
            const dc = r.flushed && (o || r.dc?.readyState === 'open') ? r.dc : null;
            const tx = (on, msg) => {
                const s = dc && on ? enc(msg) : null;
                if (dc && s !== null) {
                    tryDo(() => dc.send(s));
                }
            };
            tx(m, { v: 1, type: 'tab_meta', ...r.tabMeta });
            tx(c && r.cssCursor !== undefined, {
                v: 1,
                type: 'css_cursor',
                tabId: r.tabId,
                cursor: r.cssCursor ?? '',
            });
            tx(a && r.agentCursor !== undefined, {
                v: 1,
                type: 'agent_cursor',
                tabId: r.tabId,
                cursor: r.agentCursor ?? null,
            });
        };
        const patch = (r, p, tx = false) => {
            if (!r) {
                return false;
            }
            r.dpr = isPos(p?.devicePixelRatio) ? p.devicePixelRatio : r.dpr;
            const tm = p && isObj(p.tabMeta) ? p.tabMeta : null;
            const dst = r.tabMeta;
            Object.entries(tm ?? {}).forEach(([k, v]) => {
                const exp = META_TYPES[k];
                if (exp === 'number' ? isNum(v) : exp !== undefined && typeof v === exp) {
                    dst[k] = v;
                }
            });
            const cOn = typeof p?.cssCursor === 'string';
            r.cssCursor = cOn && p ? p.cssCursor : r.cssCursor;
            const aOn = Boolean(p && p.agentCursor !== undefined);
            r.agentCursor = aOn && p ? p.agentCursor : r.agentCursor;
            const d = dims(r.tabMeta.widthDip, r.tabMeta.heightDip, r.dpr);
            r.capKey = `${d.maxWidth}x${d.maxHeight}`;
            if (r.track && r.appliedCap !== r.capKey) {
                r.appliedCap = r.capKey;
                cap(r);
            }
            if (tx) {
                sendDc(r, Boolean(tm), cOn, aOn);
            }
            return true;
        };
        const CLR_DC = {
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
        };
        const CLR_PC = {
            ondatachannel: null,
            onconnectionstatechange: null,
            onicegatheringstatechange: null,
        };
        const drop = (r, st = false, reason) => {
            if (!r || r.disposed) {
                return;
            }
            const cur = map.get(r.sessionId) === r && map.delete(r.sessionId);
            r.disposed = true;
            const { cancelGather, dc, pc, stream, track, onEnded } = r;
            r.cancelGather = r.dc = r.pc = r.stream = r.track = r.onEnded = undefined;
            cancelGather?.();
            tryDo(() => dc && (Object.assign(dc, CLR_DC), dc.close()));
            tryDo(() => pc && (Object.assign(pc, CLR_PC), pc.close()));
            tryDo(() => {
                if (track) {
                    track.onended = null;
                    if (onEnded) {
                        track.removeEventListener?.('ended', onEnded);
                    }
                }
            });
            stopAll(stream, track);
            if (cur && st) {
                emit({
                    type: 'session_state',
                    sessionId: r.sessionId,
                    tabId: r.tabId,
                    state: st,
                    ...(reason ? { reason } : {}),
                });
            }
        };
        const gather = (r, pc, ms) => new Promise((res) => {
            if (pc.iceGatheringState === 'complete' || !live(r)) {
                res();
                return;
            }
            let done = false;
            const onG = () => pc.iceGatheringState === 'complete' && fin();
            const fin = () => {
                if (done) {
                    return;
                }
                done = true;
                r.cancelGather = r.cancelGather === fin ? undefined : r.cancelGather;
                tryDo(() => clrTmr(tm));
                if (pc.onicegatheringstatechange === onG) {
                    pc.onicegatheringstatechange = null;
                }
                pc.removeEventListener?.('icegatheringstatechange', onG);
                res();
            };
            const tm = setTmr(fin, ms);
            r.cancelGather = fin;
            pc.onicegatheringstatechange = onG;
            pc.addEventListener?.('icegatheringstatechange', onG);
        });
        const bindDc = (r, ch) => {
            if (!ch || !live(r) || ch.label !== L || r.acceptedDataChannel) {
                tryDo(() => ch?.close());
                return;
            }
            r.acceptedDataChannel = true;
            r.dc = ch;
            const flush = () => {
                const closed = ch.readyState === 'closed' || ch.readyState === 'closing';
                if (live(r) && r.dc === ch && !r.flushed && !closed) {
                    r.flushed = true;
                    sendDc(r, true, true, true, true);
                }
            };
            ch.onmessage = (ev) => {
                const m = live(r) && r.dc === ch ? dec(ev?.data) : null;
                emit(m && {
                    type: 'viewer_message',
                    sessionId: r.sessionId,
                    tabId: r.tabId,
                    message: m,
                });
            };
            ch.onclose = () => live(r) && r.dc === ch && drop(r, 'closed', 'datachannel_closed');
            ch.onopen = ch.readyState === 'open' ? (flush(), null) : flush;
        };
        const open = async (c) => {
            const { requestId, sessionId, tabId } = c;
            drop(map.get(sessionId), false);
            const dpr = pickPos(c.devicePixelRatio, win.devicePixelRatio, 1);
            const tabMeta = { tabId, widthDip: c.widthDip, heightDip: c.heightDip };
            const r = { sessionId, tabId, dpr, tabMeta };
            patch(r, c.initialState, false);
            map.set(sessionId, r);
            const step = async (p) => {
                const v = await p;
                return live(r) ? v : fail('Session closed while opening');
            };
            try {
                const hasIds = Boolean(sessionId && tabId && c.chromeMediaSourceId);
                must(hasIds, 'Missing capture session identifiers');
                const offer = vSdp(c.offerSdp);
                const md = win.navigator?.mediaDevices;
                const gum = must(md && typeof md.getUserMedia === 'function'
                    ? md.getUserMedia.bind(md)
                    : null, 'WebRTC tab capture APIs unavailable');
                const PC = must(typeof win.RTCPeerConnection === 'function'
                    ? win.RTCPeerConnection
                    : null, 'WebRTC tab capture APIs unavailable');
                const initCap = r.capKey;
                const srcId = c.chromeMediaSourceId;
                const pri = tabC(srcId, r.tabMeta.widthDip, r.tabMeta.heightDip, r.dpr);
                let fb = false;
                const stream = await gum(pri).catch((e1) => {
                    if (!live(r) || !isOver(e1)) {
                        throw live(r) ? e1 : new Error('Session closed while opening');
                    }
                    fb = true;
                    return gum(fbC(srcId)).catch(() => {
                        throw e1;
                    });
                });
                if (!live(r)) {
                    stopAll(stream);
                    fail('Session closed while opening');
                }
                r.stream = stream;
                const track = must(stream.getVideoTracks()[0], 'Captured stream contains no video track');
                r.track = track;
                r.onEnded = () => live(r) && drop(r, 'closed', 'track_ended');
                track.onended = r.onEnded;
                track.addEventListener?.('ended', r.onEnded);
                r.appliedCap = fb ? r.appliedCap : initCap;
                if (fb || r.appliedCap !== r.capKey) {
                    r.appliedCap = r.capKey;
                    cap(r);
                }
                const pc = (r.pc = new PC({
                    iceServers: ice(c.iceServers),
                    bundlePolicy: 'max-bundle',
                }));
                pc.ondatachannel = (ev) => bindDc(r, ev?.channel);
                pc.onconnectionstatechange = () => {
                    const st = live(r) && r.pc === pc ? pc.connectionState : '';
                    if (st === 'connected' && !r.connected) {
                        r.connected = true;
                        emit({ type: 'session_state', sessionId, tabId, state: st });
                    }
                    else if (st === 'failed' || st === 'closed') {
                        const why = st === 'failed' ? 'connection_failed' : 'connection_closed';
                        drop(r, st, why);
                    }
                };
                pc.addTrack(track, stream);
                await step(pc.setRemoteDescription({ type: 'offer', sdp: offer }));
                const ans = await step(pc.createAnswer());
                await step(pc.setLocalDescription(ans));
                await step(gather(r, pc, pickPos(c.gatherTimeoutMs, 5000)));
                const rawAns = pc.localDescription?.sdp ?? ans?.sdp ?? '';
                ack({ requestId, sessionId, ok: true, answerSdp: sSdp(rawAns, offer) });
            }
            catch (e) {
                drop(r, false);
                ack({ requestId, sessionId, ok: false, error: fmtErr(e, c.offerSdp) });
            }
        };
        const ackOpt = (id, sid, ok = true, error) => id &&
            ack({
                requestId: id,
                ...(sid ? { sessionId: sid } : {}),
                ok,
                ...(error ? { error } : {}),
            });
        const dropAll = (why) => Array.from(map.values()).forEach((rec) => drop(rec, 'closed', why));
        const unsub = br.onCommand((rawCmd) => {
            const c = isObj(rawCmd) ? rawCmd : null;
            if (!c) {
                return;
            }
            if (c.type === 'open_session') {
                void open(c);
            }
            else if (c.type === 'update_state') {
                const ok = patch(map.get(c.sessionId), c, true);
                const err = ok ? undefined : 'Unknown session';
                ackOpt(c.requestId, c.sessionId, ok, err);
            }
            else if (c.type === 'close_session') {
                drop(map.get(c.sessionId), 'closed', 'close_session');
                ackOpt(c.requestId, c.sessionId);
            }
            else if (c.type === 'close_all') {
                dropAll('close_all');
                ackOpt(c.requestId);
            }
        });
        emit({ type: 'ready' });
        return () => {
            dropAll('disposed');
            tryDo(() => typeof unsub === 'function' && unsub());
        };
    };
    return { L, V, S, P, D, dims, tabC, fbC, trkC, vSdp, sSdp, ice, enc, dec, run };
}
const k = createCapturePageKernel();
exports.BROWSER_STREAM_DATA_CHANNEL_LABEL = k.L;
exports.BROWSER_STREAM_PROTOCOL_VERSION = k.V;
exports.MAX_SDP_BYTES = k.S;
exports.MAX_PASTE_TEXT_BYTES = k.P;
exports.MAX_DC_MESSAGE_BYTES = k.D;
exports.computeCaptureDimensions = k.dims;
exports.buildTabCaptureConstraints = k.tabC;
exports.buildFallbackTabCaptureConstraints = k.fbC;
exports.buildTrackCapConstraints = k.trkC;
exports.validateSdp = k.vSdp;
exports.sanitizeAnswerSdp = k.sSdp;
exports.normalizeIceServers = k.ice;
exports.encodeCaptureHostMessage = k.enc;
exports.parseCaptureViewerMessage = k.dec;
exports.installCapturePageRuntime = k.run;
const renderCapturePageHtml = () => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'"><title>Browser Stream Capture</title></head><body><script src="/capture.js"></script></body></html>`;
exports.renderCapturePageHtml = renderCapturePageHtml;
const renderCapturePageScript = () => `'use strict';\n(${createCapturePageKernel.toString()})().run(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : undefined));\n`;
exports.renderCapturePageScript = renderCapturePageScript;
