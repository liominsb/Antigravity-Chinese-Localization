"use strict";
/**
 * The viewer protocol of the desktop host (P3-1): the DataChannel
 * `agy-computer` messages and the video slots. Pure and Node/browser
 * neutral; the AUIT viewer (computerAuxPane) speaks the same shapes.
 *
 * Every message is JSON `{v: 1, t, ...}`, at most {@link MAX_DC_MESSAGE_BYTES}.
 * Viewer -> host is an allowlist ({@link parseViewerMessage}): only stopAgent
 * and stopAll in P3-1 (no input until the P3-3 control lease); anything else
 * is dropped.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDACT_POLICY = exports.REDACT_STARTING = exports.FRAME_META_MIN_INTERVAL_MS = exports.H264_CLOCK_RATE = exports.H264_PAYLOAD_TYPE = exports.VIDEO_SLOTS = exports.MAX_VIDEO_SLOTS = exports.DEFAULT_VIDEO_SLOTS = exports.MAX_DC_MESSAGE_BYTES = exports.PROTOCOL_V = exports.DC_LABEL = void 0;
exports.clampVideoSlots = clampVideoSlots;
exports.videoMids = videoMids;
exports.slotMid = slotMid;
exports.encodeHostMessage = encodeHostMessage;
exports.frameMeta = frameMeta;
exports.isActorId = isActorId;
exports.parseViewerMessage = parseViewerMessage;
exports.DC_LABEL = 'agy-computer';
exports.PROTOCOL_V = 1;
exports.MAX_DC_MESSAGE_BYTES = 64 * 1024;
/**
 * Fixed sendonly video transceivers offered to every viewer (mids
 * v0..v<N-1>): streams are assigned to slots without renegotiation. N is the
 * host's `computer.maxPreviewSlots` setting, {@link DEFAULT_VIDEO_SLOTS} by
 * default and at most {@link MAX_VIDEO_SLOTS}.
 */
exports.DEFAULT_VIDEO_SLOTS = 6;
exports.MAX_VIDEO_SLOTS = 12;
/** The default slot count (see DEFAULT_VIDEO_SLOTS). */
exports.VIDEO_SLOTS = exports.DEFAULT_VIDEO_SLOTS;
/**
 * A slot count from a setting: an integer (or integer string) clamped to
 * 1..MAX_VIDEO_SLOTS; anything else (missing, 0, NaN) is the default.
 */
function clampVideoSlots(v) {
    const n = typeof v === 'number'
        ? v
        : typeof v === 'string' && /^\s*\d+\s*$/.test(v)
            ? Number(v)
            : NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return exports.DEFAULT_VIDEO_SLOTS;
    }
    return Math.min(exports.MAX_VIDEO_SLOTS, n);
}
/**
 * The mids of the `m=video` sections of an SDP, in order (an offer from a
 * sidecar may carry fewer slots than asked for, e.g. an older one).
 */
function videoMids(sdp) {
    const out = [];
    let inVideo = false;
    for (const line of sdp.split(/\r?\n/)) {
        if (line.startsWith('m=')) {
            inVideo = line.startsWith('m=video ');
        }
        else if (inVideo && line.startsWith('a=mid:')) {
            out.push(line.slice('a=mid:'.length).trim());
            inVideo = false;
        }
    }
    return out;
}
exports.H264_PAYLOAD_TYPE = 96;
exports.H264_CLOCK_RATE = 90000;
/** frame_meta repeats the fd 3 header at most this often per stream. */
exports.FRAME_META_MIN_INTERVAL_MS = 200;
function slotMid(slot) {
    return `v${slot}`;
}
/**
 * Why a stream is black (state 'redacted'): 'starting' is the helper's
 * initial hold (not a verdict; the tile says "Starting preview…"); the rest
 * are policy verdicts (secure_field, denied_app, title_rule, page, policy),
 * or screen_locked (the Mac's screen is locked).
 */
exports.REDACT_STARTING = 'starting';
/** A verdict the helper did not name. */
exports.REDACT_POLICY = 'policy';
/** Serializes a host message; undefined if it would exceed the cap. */
function encodeHostMessage(m) {
    const s = JSON.stringify(m);
    return utf8Length(s) <= exports.MAX_DC_MESSAGE_BYTES ? s : undefined;
}
const utf8 = new TextEncoder();
/** UTF-8 byte length without Node's Buffer (this file also runs in pages). */
function utf8Length(s) {
    return utf8.encode(s).length;
}
/** The frame_meta message of a record's header. */
function frameMeta(appId, h, redactReason, colorIndex) {
    const m = {
        v: 1,
        t: 'frame_meta',
        streamId: h.streamId,
        appId,
        window: h.window ?? null,
        widthPx: h.widthPx,
        heightPx: h.heightPx,
        redacted: h.redacted,
        minimized: h.minimized,
        tsMs: h.tsMs,
    };
    if (h.redacted && redactReason) {
        m.redactReason = redactReason;
    }
    if (colorIndex !== undefined) {
        m.colorIndex = colorIndex;
    }
    return m;
}
const ACTOR_ID = /^[\x21-\x7e]{1,128}$/;
/** A well-formed actor id (printable ASCII, 1..128 chars). */
function isActorId(v) {
    return typeof v === 'string' && ACTOR_ID.test(v);
}
const STREAM_ID = /^[\x21-\x7e]{1,64}$/;
/**
 * A viewer message if it is one of the allowed ones and well formed, else
 * undefined (the caller drops it). Binary messages are never accepted.
 */
function parseViewerMessage(raw) {
    if (typeof raw !== 'string' || raw.length > exports.MAX_DC_MESSAGE_BYTES) {
        return undefined;
    }
    if (utf8Length(raw) > exports.MAX_DC_MESSAGE_BYTES) {
        return undefined;
    }
    let m;
    try {
        m = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
        return undefined;
    }
    const o = m;
    if (o['v'] !== exports.PROTOCOL_V) {
        return undefined;
    }
    switch (o['t']) {
        case 'stopAgent':
        case 'takeOver':
        case 'handBack': {
            const id = o['actorId'];
            return isActorId(id) ? { v: 1, t: o['t'], actorId: id } : undefined;
        }
        case 'stopAll':
            return { v: 1, t: 'stopAll' };
        case 'keyframe': {
            const id = o['streamId'];
            return typeof id === 'string' && STREAM_ID.test(id)
                ? { v: 1, t: 'keyframe', streamId: id }
                : undefined;
        }
        default:
            return undefined;
    }
}
