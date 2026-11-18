"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidecarRtcTransport = void 0;
/**
 * The WebRTC transport under RtcSender: the `agy-desktop-rtc` sidecar (pion,
 * a Go binary next to the helper; coordinator #1107, d1), driven over stdio
 * JSON with media on its fd 3 (scratch desktop_rtc_protocol.md).
 *
 * The sidecar is a transport only. Every decision stays in RtcSender: slots,
 * the IDR gating, the session cap and TTL, the DataChannel allowlist, SDP
 * filtering. The sidecar enforces the ICE/DTLS profile (local = loopback
 * only; remote = the LS's ICE servers with mDNS host candidates) and writes
 * samples.
 *
 * Node-only, no Electron.
 */
const desktopHelper_1 = require("../computer/desktopHelper");
const frames_1 = require("./frames");
const OPEN_TIMEOUT_MS = 15000;
const OP_TIMEOUT_MS = 5000;
function str(v) {
    return typeof v === 'string' ? v : '';
}
/** The sidecar transport. The process starts with the first session. */
class SidecarRtcTransport {
    constructor(binaryPath, log = () => { }, 
    /** The sidecar's environment (default: this process's). */
    env) {
        this.log = log;
        this.proc = new desktopHelper_1.DesktopHelper(binaryPath, log, [], {
            mediaOut: true,
            name: 'DesktopRtc',
            ...(env ? { env } : {}),
        });
        this.proc.onEvent('state', (m) => {
            const state = str(m['state']);
            if (state === 'connecting' ||
                state === 'connected' ||
                state === 'disconnected' ||
                state === 'failed' ||
                state === 'closed') {
                this.events?.onState(str(m['session_id']), state);
            }
        });
        this.proc.onEvent('dc_open', (m) => this.events?.onDcOpen(str(m['session_id'])));
        this.proc.onEvent('dc_message', (m) => {
            if (typeof m['data'] === 'string') {
                this.events?.onDcMessage(str(m['session_id']), m['data']);
            }
        });
        this.proc.onEvent('keyframe', (m) => {
            const slot = m['slot'];
            if (typeof slot === 'number' && Number.isInteger(slot)) {
                this.events?.onKeyframe(str(m['session_id']), slot);
            }
        });
        this.proc.onExit(() => this.events?.onReset());
    }
    setEvents(e) {
        this.events = e;
    }
    async openLocal(sessionId, slots) {
        const r = await this.proc.call('open', {
            session_id: sessionId,
            profile: 'local',
            ...(slots ? { slots } : {}),
        }, OPEN_TIMEOUT_MS);
        if (!r.ok || r['type'] !== 'offer' || typeof r['sdp'] !== 'string') {
            throw new Error(`desktop rtc open failed: ${r.error ?? 'no offer'}`);
        }
        return { sdp: r['sdp'] };
    }
    async answer(sessionId, sdp) {
        const r = await this.proc.call('answer', { session_id: sessionId, sdp }, OP_TIMEOUT_MS);
        if (!r.ok) {
            throw new Error(`desktop rtc answer failed: ${r.error ?? ''}`);
        }
    }
    async openRemote(sessionId, offerSdp, iceServers, slots) {
        const r = await this.proc.call('open', {
            session_id: sessionId,
            profile: 'remote',
            ...(slots ? { slots } : {}),
            offer_sdp: offerSdp,
            ice_servers: iceServers.map((s) => ({
                urls: [...s.urls],
                username: s.username ?? '',
                credential: s.credential ?? '',
            })),
        }, OPEN_TIMEOUT_MS);
        const mids = r['mids'];
        if (!r.ok ||
            r['type'] !== 'answer' ||
            typeof r['sdp'] !== 'string' ||
            !Array.isArray(mids) ||
            !mids.every((x) => typeof x === 'string')) {
            throw new Error(r.error ?? 'desktop rtc open failed: no answer');
        }
        return { sdp: r['sdp'], mids: mids };
    }
    close(sessionId) {
        if (this.proc.running) {
            void this.proc.call('close', { session_id: sessionId }, OP_TIMEOUT_MS);
        }
    }
    dcSend(sessionId, data) {
        this.proc.notify('dc_send', { session_id: sessionId, data });
    }
    sendSample(sessionId, slot, tsMs, key, payload) {
        return this.proc.writeMedia((0, frames_1.encodeFrameRecord)({ session_id: sessionId, slot, ts_ms: tsMs, key }, payload));
    }
    async stats() {
        if (!this.proc.running) {
            return [];
        }
        const r = await this.proc.call('stats', {}, OP_TIMEOUT_MS);
        const raw = r['sessions'];
        if (!r.ok || !Array.isArray(raw)) {
            return [];
        }
        return raw.map((x) => {
            const o = (x ?? {});
            const pair = o['pair'];
            return {
                sessionId: str(o['session_id']),
                state: str(o['state']),
                pair: pair === 'loopback' || pair === 'non_loopback' || pair === 'relay'
                    ? pair
                    : 'none',
                bytesSent: typeof o['bytes_sent'] === 'number' ? o['bytes_sent'] : 0,
            };
        });
    }
    stop() {
        this.proc.stop();
    }
}
exports.SidecarRtcTransport = SidecarRtcTransport;
