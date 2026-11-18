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
exports.ComputerViewerHandler = exports.PAIRING_PROMPT_TIMEOUT_MS = exports.COMPUTER_VIEWER_ACTUATOR_TYPE_VERSION = exports.COMPUTER_VIEWER_ACTUATOR_TYPE = void 0;
exports.fingerprintShort = fingerprintShort;
exports.internalSessionId = internalSessionId;
exports.isTransientRefusal = isTransientRefusal;
/**
 * The `computer_viewer` actuator (P3-2, ls-impl #1092 / rt-security R1-R7):
 * the loopback leg of remote viewing. The LS relays a paired device's
 * WebRTC offer (from ComputerViewerService over remote control); the host
 * checks it, pairs the device on first use (a local, non-activating prompt),
 * and answers through the agy-desktop-rtc sidecar's remote profile. Media
 * goes peer to peer (or via TURN) and never through the LS.
 *
 * Checks, in order, before any prompt or media (P5): request shape, SDP size
 * and exactly one sha-256 fingerprint, the device's ECDSA P-256 proof over
 * that fingerprint, nonce replay, a running agent of the root; then pairing
 * (stored per device, revocable), then the answer. Only that root's agents'
 * windows are streamed; a session closes at its deadline (+2 s), on close /
 * renew-less expiry, and when its root has no running agent left.
 *
 * Node-only, no Electron. Off unless the host enables remote viewing.
 */
const crypto = __importStar(require("crypto"));
const protobuf_1 = require("@bufbuild/protobuf");
const computer_viewer_pb_1 = require("../proto/computer_viewer_pb");
const pairing_1 = require("./pairing");
const rtcSender_1 = require("./rtcSender");
exports.COMPUTER_VIEWER_ACTUATOR_TYPE = 'computer_viewer';
exports.COMPUTER_VIEWER_ACTUATOR_TYPE_VERSION = 1;
/** The pairing prompt auto-denies at 60 s; the call must outlive it. */
exports.PAIRING_PROMPT_TIMEOUT_MS = 65000;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
/** "AB:CD:..." of the first 8 bytes of a device id (sha256 of its SPKI). */
function fingerprintShort(deviceId) {
    return (deviceId.slice(0, 16).toUpperCase().match(/../g) ?? []).join(':');
}
/** The sidecar's 32-hex session id for the LS's session id. */
function internalSessionId(lsSessionId) {
    return crypto
        .createHash('sha256')
        .update(lsSessionId)
        .digest('hex')
        .slice(0, 32);
}
class ComputerViewerHandler {
    constructor(o) {
        this.o = o;
        this.actuatorType = exports.COMPUTER_VIEWER_ACTUATOR_TYPE;
        this.actuatorTypeVersion = exports.COMPUTER_VIEWER_ACTUATOR_TYPE_VERSION;
        this.schemas = {
            hello: computer_viewer_pb_1.ComputerViewerHelloSchema,
            request: computer_viewer_pb_1.ComputerViewerRequestSchema,
            result: computer_viewer_pb_1.ComputerViewerResultSchema,
        };
        /** Offers still being handled (prompt, answer), and whether closed since. */
        this.pending = new Map();
        this.actuatorId = o.actuatorId;
        this.now = o.now ?? (() => Date.now());
        this.nonces = o.nonces ?? new pairing_1.NonceCache(this.now);
        this.log = o.log ?? (() => { });
    }
    register(client) {
        const reg = client.register(this);
        this.reg = reg;
        return reg;
    }
    /** Unsubscribes computer_viewer (GOING_AWAY) when the host stops. */
    async dispose() {
        const reg = this.reg;
        this.reg = undefined;
        await reg?.unsubscribe();
    }
    async hello() {
        return {
            hello: (0, protobuf_1.create)(computer_viewer_pb_1.ComputerViewerHelloSchema, {
                maxSessions: rtcSender_1.MAX_SESSIONS,
                videoCodecs: ['H264'],
                desktopLabel: [...this.o.desktopLabel].slice(0, 64).join(''),
            }),
            conversationIds: [],
        };
    }
    async onRequest(req, ctx) {
        let result;
        try {
            result = await this.handle(req.payload);
        }
        catch (err) {
            result = failure('INVALID_SDP', `viewer request failed: ${String(err)}`);
        }
        try {
            await ctx.fulfill(result);
        }
        catch (err) {
            this.log(`[DesktopHost] computer_viewer fulfill failed: ${String(err)}`);
        }
    }
    /** One signaling step (exported for tests through onRequest). */
    async handle(q) {
        if (!SESSION_ID.test(q.sessionId)) {
            return failure('UNKNOWN_SESSION', 'bad session id');
        }
        const id = internalSessionId(q.sessionId);
        switch (q.op.case) {
            case 'offer': {
                if (this.pending.has(id) || this.o.sender.hasSession(id)) {
                    return failure('UNKNOWN_SESSION', 'duplicate session id');
                }
                const p = { cancelled: false };
                this.pending.set(id, p);
                try {
                    const r = await this.offer(id, q.op.value);
                    if (p.cancelled && !r.errorCode) {
                        // The LS closed the view while it was being set up.
                        this.o.sender.close(id);
                        return failure('UNKNOWN_SESSION', 'closed while opening');
                    }
                    return r;
                }
                finally {
                    this.pending.delete(id);
                }
            }
            case 'renew': {
                // Like an offer's: a NaN deadline would never expire.
                const deadline = Number(q.op.value.expiresUnixMs);
                if (!this.o.sender.hasSession(id)) {
                    return failure('UNKNOWN_SESSION', 'no such view');
                }
                if (!Number.isFinite(deadline) || deadline <= this.now()) {
                    return failure('INVALID_SDP', 'invalid or expired renew deadline');
                }
                return this.o.sender.renewRemote(id, deadline)
                    ? ok()
                    : failure('UNKNOWN_SESSION', 'no such view');
            }
            case 'close': {
                this.log(`[DesktopHost] remote view ${id.slice(0, 8)} closed by the LS (${q.op.value.reason || 'no reason'})`);
                const p = this.pending.get(id);
                if (p) {
                    p.cancelled = true;
                }
                this.o.sender.close(id);
                return ok();
            }
            default:
                return failure('INVALID_SDP', 'empty viewer request');
        }
    }
    async offer(id, offer) {
        const deadline = Number(offer.expiresUnixMs);
        if (!Number.isFinite(deadline) || deadline <= this.now()) {
            return failure('INVALID_SDP', 'the view has already expired');
        }
        if (!offer.sdp || Buffer.byteLength(offer.sdp) > rtcSender_1.MAX_SDP_BYTES) {
            return failure('INVALID_SDP', 'missing or oversized SDP');
        }
        const fingerprint = (0, pairing_1.sdpFingerprint)(offer.sdp);
        if (!fingerprint) {
            return failure('INVALID_SDP', 'the offer must carry exactly one sha-256 a=fingerprint');
        }
        const root = offer.rootConversationId;
        if (!root) {
            return failure('NO_STREAMS', 'no root conversation');
        }
        // P5: the proof is checked before any prompt can appear.
        const proof = (0, pairing_1.verifyDeviceProof)(offer.device, root, fingerprint);
        if (!proof.ok) {
            this.log(`[DesktopHost] remote view refused: ${proof.error}`);
            return failure('INVALID_DEVICE', proof.error);
        }
        if (!this.nonces.use(offer.device.nonce, deadline)) {
            return failure('INVALID_DEVICE', 'replayed device proof');
        }
        if (!this.o.sender.hasRunningAgent(root)) {
            return failure('NO_STREAMS', 'no computer agent of that conversation is running');
        }
        if (!this.o.pairing.isPaired(proof.deviceId)) {
            const denied = await this.pair(proof.deviceId, proof.label);
            if (denied !== undefined) {
                // Transient refusals are retryable; the user's No or a timeout is final.
                return failure(isTransientRefusal(denied) ? 'PAIRING_PENDING' : 'PAIRING_DENIED', denied);
            }
            // The prompt can take a minute: re-check what may have changed.
            if (deadline <= this.now()) {
                return failure('UNKNOWN_SESSION', 'the view expired during pairing');
            }
        }
        try {
            const r = await this.o.sender.openRemote({
                sessionId: id,
                root,
                deviceId: proof.deviceId,
                offerSdp: offer.sdp,
                iceServers: offer.iceServers.map((s) => ({
                    urls: [...s.urls],
                    username: s.username,
                    credential: s.credential,
                })),
                deadlineMs: deadline,
            });
            return (0, protobuf_1.create)(computer_viewer_pb_1.ComputerViewerResultSchema, {
                answerSdp: r.sdp,
                streams: r.streams.map((s) => (0, protobuf_1.create)(computer_viewer_pb_1.ComputerViewerStreamSchema, {
                    streamId: s.streamId,
                    bundleId: s.bundleId,
                    windowId: s.windowId,
                })),
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const code = /^([A-Z_]+):/.exec(msg)?.[1];
            return failure(code === 'VIEWER_LIMIT' ||
                code === 'NO_STREAMS' ||
                code === 'INVALID_SDP' ||
                code === 'UNKNOWN_SESSION'
                ? code
                : 'INVALID_SDP', msg);
        }
    }
    /**
     * Asks the user to pair a device (one prompt at a time). Offers from the
     * same device wait for the open prompt's answer; another device gets
     * "busy". Returns undefined if allowed, else the reason.
     */
    async pair(deviceId, label) {
        if (this.prompt) {
            return this.prompt.deviceId === deviceId
                ? this.prompt.answer
                : 'busy: another pairing prompt is open';
        }
        const answer = (async () => {
            const r = await this.o.prompter.call('pairing_prompt', {
                device_id: deviceId,
                device_label: label,
                fingerprint_short: fingerprintShort(deviceId),
            }, exports.PAIRING_PROMPT_TIMEOUT_MS);
            const reason = typeof r['reason'] === 'string' ? r['reason'] : '';
            if (!(r.ok && r['allowed'] === true)) {
                this.log(`[DesktopHost] pairing denied for ${fingerprintShort(deviceId)} (${(0, pairing_1.logLabel)(reason || 'no answer')})`);
                return reason || 'the user did not allow it';
            }
            this.o.pairing.pair(deviceId, label);
            this.log(`[DesktopHost] paired ${fingerprintShort(deviceId)} (${(0, pairing_1.logLabel)(label)})`);
            return undefined;
        })();
        this.prompt = { deviceId, answer };
        try {
            return await answer;
        }
        finally {
            this.prompt = undefined;
        }
    }
    /** Revokes a paired device and ends its live views. */
    revokeDevice(deviceId) {
        const had = this.o.pairing.revoke(deviceId);
        const closed = this.o.sender.closeDevice(deviceId);
        if (had || closed) {
            this.log(`[DesktopHost] revoked ${fingerprintShort(deviceId)} (${closed} views closed)`);
        }
        return had || closed > 0;
    }
}
exports.ComputerViewerHandler = ComputerViewerHandler;
/** Prompt refusals a viewer may retry later (helper reasons, #1108). */
function isTransientRefusal(reason) {
    return /^(busy|rate_limited|agent_active)\b/.test(reason);
}
function ok() {
    return (0, protobuf_1.create)(computer_viewer_pb_1.ComputerViewerResultSchema, {});
}
function failure(code, error) {
    return (0, protobuf_1.create)(computer_viewer_pb_1.ComputerViewerResultSchema, { errorCode: code, error });
}
