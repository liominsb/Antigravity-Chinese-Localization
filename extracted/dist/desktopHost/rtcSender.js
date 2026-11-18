"use strict";
/**
 * The desktop host's WebRTC sender: one session per viewer over an
 * {@link RtcTransport} (the agy-desktop-rtc sidecar, pion), carrying
 *
 * - up to `slots` H.264 video slots (the `computer.maxPreviewSlots`
 *   setting, {@link DEFAULT_VIDEO_SLOTS} by default) fed with the helper's
 *   already-encoded, already-redacted access units (no re-encode, no
 *   browser), each slot waiting for its stream's IDR, and
 * - the DataChannel `agy-computer` (protocol.ts): agents, activity, streams
 *   and frame_meta out; only stopAgent / stopAll in.
 *
 * Two kinds of session:
 * - local (the Hub's own aux pane, P3-1): the transport offers, every agent
 *   and stream is shown. Exposure per rt-security #1048: the sidecar's local
 *   profile binds and gathers loopback only with no STUN/TURN; offers and
 *   answers are non-trickle and additionally stripped here to loopback
 *   candidates (an answer without one is refused); sessions close with the
 *   pane or after {@link SESSION_TTL_MS} without renew.
 * - remote (a paired device through the LS, P3-2): the transport answers the
 *   viewer's offer; the session sees only its root conversation's agents,
 *   their activity and their windows (never display mode), and closes at its
 *   deadline (+2 s), when its root has no running agent left, or on close.
 *
 * SDP is never logged. Node-only, no Electron.
 */
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
exports.RtcSender = exports.MAX_VIEWER_KEYFRAMES_PER_S = exports.MAX_SDP_BYTES = exports.REMOTE_GRACE_MS = exports.SESSION_TTL_MS = exports.MAX_SESSIONS = void 0;
exports.isLoopbackAddress = isLoopbackAddress;
exports.loopbackOnlySdp = loopbackOnlySdp;
exports.noRawHostSdp = noRawHostSdp;
const crypto = __importStar(require("crypto"));
const protocol_1 = require("./protocol");
exports.MAX_SESSIONS = 4;
/** A local session nobody renews closes after this. */
exports.SESSION_TTL_MS = 60000;
/** A remote session closes this long after its deadline (ls-impl #1101). */
exports.REMOTE_GRACE_MS = 2000;
exports.MAX_SDP_BYTES = 64 * 1024;
// ---- SDP candidate filtering ----
/** True for 127.0.0.0/8 and ::1. */
function isLoopbackAddress(addr) {
    const a = addr.trim().toLowerCase();
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)) {
        return true;
    }
    return a === '::1' || a === '0:0:0:0:0:0:0:1';
}
function filterCandidates(sdp, keep) {
    let kept = 0;
    let dropped = 0;
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/).filter((line) => {
        if (!line.startsWith('a=candidate:')) {
            return true;
        }
        // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
        const parts = line.split(' ');
        if (parts.length >= 8 && keep(parts)) {
            kept++;
            return true;
        }
        dropped++;
        return false;
    });
    return { sdp: lines.join(eol), kept, dropped };
}
/**
 * The SDP with every `a=candidate` line whose address is not loopback
 * removed (LAN, IPv6, mDNS `.local`, relay, ...).
 */
function loopbackOnlySdp(sdp) {
    return filterCandidates(sdp, (p) => isLoopbackAddress(p[4]));
}
/**
 * A remote answer without raw host addresses (rt-security R6): host
 * candidates must be mDNS (`.local`); srflx and relay candidates stay.
 */
function noRawHostSdp(sdp) {
    return filterCandidates(sdp, (p) => p[7] !== 'host' || p[4].toLowerCase().endsWith('.local'));
}
/** Viewer keyframe requests honored per session per second. */
exports.MAX_VIEWER_KEYFRAMES_PER_S = 4;
class RtcSender {
    constructor(transport, hooks, now = () => Date.now(), opts = {}) {
        this.transport = transport;
        this.hooks = hooks;
        this.now = now;
        this.sessions = new Map();
        this.streams = [];
        this.agents = [];
        this.paused = false;
        /** Last frame_meta per stream, and when it was sent. */
        this.lastMeta = new Map();
        /** open() calls still waiting for the transport (they count against the cap). */
        this.opening = 0;
        /** Per stream since the last stats line: access units and bytes sent. */
        this.sent = new Map();
        this.log = hooks.log ?? (() => { });
        this.slots = (0, protocol_1.clampVideoSlots)(opts.slots ?? protocol_1.DEFAULT_VIDEO_SLOTS);
        transport.setEvents({
            onState: (id, state) => {
                if (state === 'failed' || state === 'closed') {
                    this.close(id);
                }
            },
            onDcOpen: (id) => this.onDcOpen(id),
            onDcMessage: (id, data) => {
                const s = this.sessions.get(id);
                if (!s) {
                    return;
                }
                const m = (0, protocol_1.parseViewerMessage)(data);
                if (!m) {
                    this.log('[DesktopHost] dropped a viewer message (not allowed)');
                    return;
                }
                if (m.t === 'keyframe') {
                    this.viewerKeyframe(s, m.streamId);
                    return;
                }
                if (m.t === 'takeOver' || m.t === 'handBack') {
                    // Idempotent in the host; capped here like keyframes (UC-7).
                    const now = this.now();
                    s.controlAsks = s.controlAsks.filter((t) => now - t < 1000);
                    if (s.controlAsks.length >= exports.MAX_VIEWER_KEYFRAMES_PER_S) {
                        return;
                    }
                    s.controlAsks.push(now);
                }
                this.hooks.onControl(m, id, s.kind === 'remote' ? s.root : undefined);
            },
            onKeyframe: (id) => {
                if (this.sessions.has(id)) {
                    this.hooks.onNeedKeyframe();
                }
            },
            onReset: () => {
                // The sidecar died with every session in it.
                for (const id of [...this.sessions.keys()]) {
                    this.close(id, false);
                }
            },
        });
    }
    get sessionCount() {
        return this.sessions.size;
    }
    hasSession(id) {
        return this.sessions.has(id);
    }
    /** A local session: a non-trickle offer with loopback candidates only. */
    async open() {
        this.reserve();
        const id = crypto.randomBytes(16).toString('hex');
        try {
            const { sdp } = await this.transport.openLocal(id, this.slots);
            const f = loopbackOnlySdp(sdp);
            // The slots the sidecar really offered (an older one offers 6).
            const offered = (0, protocol_1.videoMids)(sdp).slice(0, this.slots);
            if (f.kept === 0) {
                this.transport.close(id);
                throw new Error('no loopback ICE candidate gathered');
            }
            this.add({
                id,
                kind: 'local',
                root: '',
                deviceId: '',
                mids: offered.length
                    ? offered
                    : Array.from({ length: this.slots }, (_, i) => (0, protocol_1.slotMid)(i)),
                expiresAt: this.now() + exports.SESSION_TTL_MS,
            });
            this.log(`[DesktopHost] preview session ${id.slice(0, 8)} offered (${f.kept} loopback candidates, ${f.dropped} dropped)`);
            return { sessionId: id, type: 'offer', sdp: f.sdp };
        }
        finally {
            this.opening--;
        }
    }
    /** Applies the local viewer's (non-trickle) answer, loopback only. */
    async answer(sessionId, sdp) {
        const s = this.sessions.get(sessionId);
        if (!s || s.kind !== 'local') {
            throw new Error('unknown preview session');
        }
        if (typeof sdp !== 'string' || Buffer.byteLength(sdp) > exports.MAX_SDP_BYTES) {
            throw new Error('bad answer');
        }
        const f = loopbackOnlySdp(sdp);
        if (f.kept === 0) {
            this.close(sessionId);
            throw new Error('the answer has no loopback ICE candidate');
        }
        try {
            await this.transport.answer(sessionId, f.sdp);
        }
        catch (err) {
            // A failed handshake must not hold one of the MAX_SESSIONS until its TTL.
            this.close(sessionId);
            throw err;
        }
        this.log(`[DesktopHost] preview session ${sessionId.slice(0, 8)} answered (${f.kept} loopback candidates, ${f.dropped} dropped)`);
    }
    /**
     * A remote session for `root`: the transport answers the viewer's offer
     * (already validated by the caller: size, fingerprint, device proof,
     * pairing). Throws Error('VIEWER_LIMIT' | 'NO_STREAMS' | ...).
     */
    async openRemote(o) {
        if (!/^[0-9a-f]{32}$/.test(o.sessionId) || this.sessions.has(o.sessionId)) {
            throw new Error('INVALID_SESSION: bad or duplicate session id');
        }
        if (!this.rootRunning(o.root)) {
            throw new Error('NO_STREAMS: no computer agent of that conversation is running');
        }
        this.reserve();
        try {
            const r = await this.transport.openRemote(o.sessionId, o.offerSdp, o.iceServers, this.slots);
            // The world may have moved during the sidecar's gather.
            if (!this.rootRunning(o.root) || o.deadlineMs <= this.now()) {
                this.transport.close(o.sessionId);
                throw new Error(this.rootRunning(o.root)
                    ? 'UNKNOWN_SESSION: the view expired while it opened'
                    : 'NO_STREAMS: no computer agent of that conversation is running');
            }
            const mids = r.mids.slice(0, this.slots);
            const f = noRawHostSdp(r.sdp);
            if (mids.length === 0 || f.kept === 0) {
                this.transport.close(o.sessionId);
                throw new Error(mids.length === 0
                    ? 'INVALID_SDP: the offer has no H.264 receive slot'
                    : 'NO_STREAMS: no usable ICE candidate');
            }
            const s = this.add({
                id: o.sessionId,
                kind: 'remote',
                root: o.root,
                deviceId: o.deviceId,
                mids,
                expiresAt: o.deadlineMs + exports.REMOTE_GRACE_MS,
            });
            this.log(`[DesktopHost] remote view ${o.sessionId.slice(0, 8)} answered (${mids.length} slots, ${f.kept} candidates, ${f.dropped} raw host dropped)`);
            return { sdp: f.sdp, streams: this.remoteStreams(s) };
        }
        finally {
            this.opening--;
        }
    }
    /** Extends a local session's TTL; false if it is gone. */
    renew(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s || s.kind !== 'local') {
            return false;
        }
        s.expiresAt = this.now() + exports.SESSION_TTL_MS;
        return true;
    }
    /** Sets a remote session's latest deadline; false if it is gone. */
    renewRemote(sessionId, deadlineMs) {
        const s = this.sessions.get(sessionId);
        if (!s || s.kind !== 'remote') {
            return false;
        }
        s.expiresAt = deadlineMs + exports.REMOTE_GRACE_MS;
        return true;
    }
    close(sessionId, tellTransport = true) {
        const s = this.sessions.get(sessionId);
        if (!s || s.closed) {
            return;
        }
        s.closed = true;
        this.sessions.delete(sessionId);
        if (tellTransport) {
            this.transport.close(sessionId);
        }
        this.log(`[DesktopHost] preview session ${sessionId.slice(0, 8)} closed`);
        this.emitDemand();
        try {
            this.hooks.onSessionClosed?.(sessionId);
        }
        catch {
            // never affects the sender
        }
        if (this.sessions.size === 0) {
            if (this.ttlTimer) {
                clearInterval(this.ttlTimer);
                this.ttlTimer = undefined;
            }
            if (this.statsTimer) {
                clearInterval(this.statsTimer);
                this.statsTimer = undefined;
            }
        }
    }
    /** Closes every remote session a device opened (it was revoked). */
    closeDevice(deviceId) {
        let n = 0;
        for (const s of [...this.sessions.values()]) {
            if (s.kind === 'remote' && s.deviceId === deviceId) {
                this.close(s.id);
                n++;
            }
        }
        return n;
    }
    closeAll() {
        for (const id of [...this.sessions.keys()]) {
            this.close(id);
        }
    }
    // ---- host -> viewers ----
    /** Layer 2's agents (on every state change). */
    setAgents(agents, paused) {
        this.agents = [...agents];
        this.paused = paused;
        for (const s of [...this.sessions.values()]) {
            if (s.kind === 'remote' && !this.rootRunning(s.root)) {
                // AGENT_STOPPED or lease end for the root's last agent.
                this.log(`[DesktopHost] remote view ${s.id.slice(0, 8)}: no running agent of its conversation left`);
                this.close(s.id);
                continue;
            }
            this.sendTo(s, this.agentsMessageFor(s));
        }
    }
    /** One agent action (C12b activity), to the sessions that may see it. */
    sendActivity(a) {
        const msg = { v: 1, t: 'activity', a };
        for (const s of this.sessions.values()) {
            if (s.kind === 'local' || a.rootConversationId === s.root) {
                this.sendTo(s, msg);
            }
        }
    }
    /** The streams changed: slots, `streams` messages, keyframes. */
    setStreams(streams) {
        this.streams = [...streams];
        for (const id of [...this.lastMeta.keys()]) {
            if (!streams.some((s) => s.streamId === id)) {
                this.lastMeta.delete(id);
            }
        }
        for (const s of this.sessions.values()) {
            this.assignSlots(s);
            this.sendTo(s, this.streamsMessage(s));
        }
    }
    /** One frame: the access unit to every session carrying it, plus meta. */
    sendFrame(stream, r) {
        this.sendMeta(stream, r);
        if (r.payload.length === 0) {
            return; // state-only record
        }
        let forwarded = false;
        let dropped = false;
        for (const s of this.sessions.values()) {
            const idx = s.slots.findIndex((x) => x.streamId === stream.streamId);
            if (idx < 0) {
                continue;
            }
            if (s.kind === 'remote' && stream.remoteGated) {
                // The local user is in control (and may be typing): remote viewers
                // see nothing until it is handed back. Resume at the next IDR.
                s.slots[idx].awaitingKey = true;
                continue;
            }
            const slot = s.slots[idx];
            if (slot.awaitingKey) {
                if (!r.key) {
                    continue; // a decoder can't start mid-GOP
                }
                slot.awaitingKey = false;
            }
            if (this.transport.sendSample(s.id, idx, r.tsMs, r.key, r.payload)) {
                forwarded = true;
            }
            else {
                // Dropped (transport backed up or down): resume at the next IDR.
                slot.awaitingKey = true;
                dropped = true;
            }
        }
        if (forwarded) {
            const c = this.sent.get(stream.streamId) ?? { aus: 0, bytes: 0 };
            c.aus++;
            c.bytes += r.payload.length;
            this.sent.set(stream.streamId, c);
        }
        if (dropped) {
            this.hooks.onNeedKeyframe();
        }
    }
    /**
     * One line of preview stats (logged every second while a viewer is
     * connected): sessions (local/remote) with their selected pair class
     * (never an address), and per stream the slot, state, AU/s and kbit/s.
     */
    statsLine(stats) {
        const pairs = [...this.sessions.values()].map((s) => {
            const st = stats.find((x) => x.sessionId === s.id);
            return `${s.kind}:${st ? st.pair : 'none'}`;
        });
        const streams = this.streams.map((st) => {
            const c = this.sent.get(st.streamId) ?? { aus: 0, bytes: 0 };
            return `${(0, protocol_1.slotMid)(st.slot)}:${st.streamId}:${st.state}:${c.aus}au/s:${Math.round((c.bytes * 8) / 1000)}kbps`;
        });
        this.sent.clear();
        return `[DesktopHost] preview stats sessions=${this.sessions.size} pairs=[${pairs.join(',')}] streams=[${streams.join(' ')}]`;
    }
    // ---- internals ----
    reserve() {
        if (this.sessions.size + this.opening >= exports.MAX_SESSIONS) {
            throw new Error(`VIEWER_LIMIT: at most ${exports.MAX_SESSIONS} preview sessions`);
        }
        this.opening++;
    }
    add(o) {
        const s = {
            ...o,
            slots: o.mids.map(() => ({ streamId: '', awaitingKey: true })),
            dcOpen: false,
            keyframeAsks: [],
            controlAsks: [],
            closed: false,
        };
        this.sessions.set(s.id, s);
        this.armTimers();
        this.emitDemand();
        this.assignSlots(s);
        return s;
    }
    emitDemand() {
        const local = [...this.sessions.values()].filter((s) => s.kind === 'local').length;
        const roots = [
            ...new Set([...this.sessions.values()]
                .filter((s) => s.kind === 'remote')
                .map((s) => s.root)),
        ];
        this.hooks.onDemand(local, roots);
    }
    /** Whether some agent of `root` is in the lease and not stopped. */
    hasRunningAgent(root) {
        return this.rootRunning(root);
    }
    rootRunning(root) {
        return (!!root &&
            this.agents.some((a) => a.rootConversationId === root && !a.stopped));
    }
    /** The streams a session may carry, in slot order. */
    streamsFor(s) {
        if (s.kind === 'local') {
            return s.slots.map((_, i) => this.streams.find((x) => x.slot === i));
        }
        const mine = this.streams
            .filter((x) => x.mode === 'window' && x.root === s.root)
            .sort((a, b) => a.slot - b.slot);
        // Keep streams in the slots they already have; fill the rest in order.
        const out = s.slots.map((sl) => mine.find((x) => x.streamId === sl.streamId));
        for (const st of mine) {
            if (out.includes(st)) {
                continue;
            }
            const free = out.findIndex((x) => !x);
            if (free < 0) {
                break;
            }
            out[free] = st;
        }
        return out;
    }
    assignSlots(s) {
        let needKey = false;
        const want = this.streamsFor(s);
        for (let i = 0; i < s.slots.length; i++) {
            const id = want[i]?.streamId ?? '';
            if (s.slots[i].streamId !== id) {
                s.slots[i].streamId = id;
                s.slots[i].awaitingKey = true;
                needKey = needKey || !!id;
            }
        }
        if (needKey) {
            this.hooks.onNeedKeyframe();
        }
    }
    /**
     * A viewer's keyframe request: only for a stream the session carries, at
     * most {@link MAX_VIEWER_KEYFRAMES_PER_S} per session per second.
     */
    viewerKeyframe(s, streamId) {
        if (!s.slots.some((sl) => sl.streamId === streamId)) {
            return; // not one of its streams
        }
        if (s.kind === 'remote' &&
            this.streams.find((x) => x.streamId === streamId)?.remoteGated) {
            return; // gated while the local user is in control (UC-3)
        }
        const now = this.now();
        s.keyframeAsks = s.keyframeAsks.filter((t) => now - t < 1000);
        if (s.keyframeAsks.length >= exports.MAX_VIEWER_KEYFRAMES_PER_S) {
            return;
        }
        s.keyframeAsks.push(now);
        if (this.hooks.onStreamKeyframe) {
            this.hooks.onStreamKeyframe(streamId);
        }
        else {
            this.hooks.onNeedKeyframe();
        }
    }
    /** The color the host assigned to an agent (AgentColors), if known. */
    colorOf(actorId) {
        return this.agents.find((a) => a.actor.id === actorId)?.actor.colorIndex;
    }
    remoteStreams(s) {
        const out = [];
        s.slots.forEach((sl, i) => {
            const st = this.streams.find((x) => x.streamId === sl.streamId);
            if (st) {
                out.push({
                    streamId: st.streamId,
                    bundleId: st.bundleId,
                    windowId: st.window?.windowId ?? 0,
                    mid: s.mids[i],
                });
            }
        });
        return out;
    }
    agentsMessageFor(s) {
        const agents = s.kind === 'local'
            ? this.agents
            : this.agents.filter((a) => a.rootConversationId === s.root);
        return { v: 1, t: 'agents', agents, paused: this.paused };
    }
    streamsMessage(s) {
        const streams = [];
        s.slots.forEach((sl, i) => {
            const st = this.streams.find((x) => x.streamId === sl.streamId);
            if (st) {
                const info = {
                    streamId: st.streamId,
                    mid: s.mids[i],
                    appId: st.appId,
                    bundleId: st.bundleId,
                    state: st.state,
                };
                const color = this.colorOf(st.actorId);
                if (color !== undefined) {
                    info.colorIndex = color;
                }
                if (st.state === 'redacted' && st.redactReason) {
                    info.redactReason = st.redactReason;
                }
                streams.push(info);
            }
        });
        return { v: 1, t: 'streams', streams };
    }
    onDcOpen(id) {
        const s = this.sessions.get(id);
        if (!s) {
            return;
        }
        s.dcOpen = true;
        this.sendTo(s, this.agentsMessageFor(s));
        this.sendTo(s, this.streamsMessage(s));
        for (const sl of s.slots) {
            if (s.kind === 'remote' &&
                this.streams.find((x) => x.streamId === sl.streamId)?.remoteGated) {
                continue; // no geometry while the user is in control (UC-2)
            }
            const m = this.lastMeta.get(sl.streamId);
            if (m) {
                this.sendTo(s, m.msg);
            }
        }
        this.hooks.onNeedKeyframe();
    }
    sendMeta(stream, r) {
        const reason = r.redacted ? stream.redactReason : undefined;
        const msg = (0, protocol_1.frameMeta)(stream.appId, r, reason, this.colorOf(stream.actorId));
        // Throttle on what matters to the overlay, not on tsMs.
        const json = JSON.stringify({
            w: r.window ?? null,
            px: [r.widthPx, r.heightPx],
            red: r.redacted,
            why: reason ?? '',
            c: this.colorOf(stream.actorId) ?? -1,
            min: r.minimized,
        });
        const last = this.lastMeta.get(stream.streamId);
        const now = this.now();
        if (last &&
            last.json === json &&
            now - last.sentAt < protocol_1.FRAME_META_MIN_INTERVAL_MS) {
            last.msg = msg;
            return;
        }
        this.lastMeta.set(stream.streamId, { json, sentAt: now, msg });
        for (const s of this.sessions.values()) {
            if (s.kind === 'remote' && stream.remoteGated) {
                continue; // no geometry either while the user is in control (UC-2)
            }
            if (s.slots.some((sl) => sl.streamId === stream.streamId)) {
                this.sendTo(s, msg);
            }
        }
    }
    sendTo(s, m) {
        if (!s.dcOpen) {
            return;
        }
        const json = (0, protocol_1.encodeHostMessage)(m);
        if (!json) {
            this.log(`[DesktopHost] dropped an oversized ${m.t} message`);
            return;
        }
        this.transport.dcSend(s.id, json);
    }
    armTimers() {
        if (!this.statsTimer) {
            this.statsTimer = setInterval(() => {
                void this.transport
                    .stats()
                    .catch(() => [])
                    .then((st) => this.log(this.statsLine(st)));
            }, 1000);
            this.statsTimer.unref?.();
        }
        if (this.ttlTimer) {
            return;
        }
        this.ttlTimer = setInterval(() => this.expire(), 1000);
        this.ttlTimer.unref?.();
    }
    /** Closes sessions past their TTL or deadline (also called by tests). */
    expire() {
        const now = this.now();
        for (const s of [...this.sessions.values()]) {
            if (s.expiresAt <= now) {
                this.log(`[DesktopHost] preview session ${s.id.slice(0, 8)} expired (${s.kind === 'local' ? 'no renew' : 'deadline'})`);
                this.close(s.id);
            }
        }
    }
}
exports.RtcSender = RtcSender;
