"use strict";
/**
 * The helper's preview frame records on fd 3 (P3 contract §2):
 *
 *   "AGYF" | u32 BE hdrLen | hdr (UTF-8 JSON) | u32 BE payLen | payload
 *
 * One record per encoded access unit (H.264 Annex B); payLen 0 is a state-only
 * record (e.g. minimized). The parser is incremental (pipe chunks split
 * records anywhere) and bounded: an oversized or malformed record makes it
 * skip ahead to the next magic, so a corrupt pipe can't grow memory.
 *
 * Node-only, no Electron.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameParser = exports.MAX_FRAME_PAYLOAD_BYTES = exports.MAX_FRAME_HEADER_BYTES = exports.FRAME_MAGIC = void 0;
exports.redactReasonOf = redactReasonOf;
exports.frameWindowOf = frameWindowOf;
exports.frameHeaderOf = frameHeaderOf;
exports.encodeFrameRecord = encodeFrameRecord;
exports.FRAME_MAGIC = Buffer.from('AGYF', 'ascii');
/** Headers are small JSON objects. */
exports.MAX_FRAME_HEADER_BYTES = 16 * 1024;
/** An access unit at 1280 px is well below this; a 4K keyframe too. */
exports.MAX_FRAME_PAYLOAD_BYTES = 8 * 1024 * 1024;
const REDACT_REASON = /^[a-z][a-z_]{0,31}$/;
/** A redaction reason as viewers accept it ([a-z_], <= 32), else undefined. */
function redactReasonOf(v) {
    return typeof v === 'string' && REDACT_REASON.test(v) ? v : undefined;
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
/** The helper's snake_case window JSON, if well formed. */
function frameWindowOf(raw) {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const w = raw;
    const x = num(w['x']);
    const y = num(w['y']);
    const width = num(w['width_points']);
    const height = num(w['height_points']);
    if (x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined ||
        width < 0 ||
        height < 0) {
        return undefined;
    }
    return {
        windowId: num(w['window_id']) ?? 0,
        x,
        y,
        widthPoints: width,
        heightPoints: height,
        scaleFactor: num(w['scale_factor']) ?? 1,
    };
}
/** The header JSON as a record (without payload), or undefined if invalid. */
function frameHeaderOf(raw) {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const h = raw;
    const streamId = h['stream_id'];
    if (typeof streamId !== 'string' || !streamId || streamId.length > 64) {
        return undefined;
    }
    const rec = {
        streamId,
        tsMs: num(h['ts_ms']) ?? 0,
        widthPx: Math.max(0, Math.floor(num(h['width_px']) ?? 0)),
        heightPx: Math.max(0, Math.floor(num(h['height_px']) ?? 0)),
        // Fail closed: anything but an explicit false is redacted.
        redacted: h['redacted'] !== false,
        minimized: h['minimized'] === true,
        codec: typeof h['codec'] === 'string' ? h['codec'] : '',
        key: h['key'] === true,
    };
    const reason = rec.redacted ? redactReasonOf(h['redact_reason']) : undefined;
    if (reason) {
        rec.redactReason = reason;
    }
    const w = frameWindowOf(h['window']);
    if (w) {
        rec.window = w;
    }
    return rec;
}
/** Incremental fd 3 parser. */
class FrameParser {
    constructor(onRecord, log = () => { }) {
        this.onRecord = onRecord;
        this.log = log;
        this.buf = Buffer.alloc(0);
        /**
         * Chunks received since `buf` was last examined: they are joined only once
         * `need` bytes are there, so a large record arriving in many pipe chunks is
         * copied O(1) times rather than once per chunk.
         */
        this.pending = [];
        this.pendingBytes = 0;
        /** Bytes (buf + pending) needed before parsing can make progress. */
        this.need = 8;
        /** Records skipped as malformed (diagnostics). */
        this.dropped = 0;
    }
    /** Feeds a pipe chunk; emits every complete record in it. */
    push(chunk) {
        this.pending.push(chunk);
        this.pendingBytes += chunk.length;
        if (this.buf.length + this.pendingBytes < this.need) {
            return;
        }
        this.buf = Buffer.concat([this.buf, ...this.pending]);
        this.pending = [];
        this.pendingBytes = 0;
        this.need = 8;
        for (;;) {
            if (this.buf.length < 8) {
                this.need = 8;
                return;
            }
            if (!this.buf.subarray(0, 4).equals(exports.FRAME_MAGIC)) {
                this.resync('bad magic');
                continue;
            }
            const hdrLen = this.buf.readUInt32BE(4);
            if (hdrLen === 0 || hdrLen > exports.MAX_FRAME_HEADER_BYTES) {
                this.resync(`header length ${hdrLen}`);
                continue;
            }
            if (this.buf.length < 8 + hdrLen + 4) {
                this.need = 8 + hdrLen + 4;
                return;
            }
            const payLen = this.buf.readUInt32BE(8 + hdrLen);
            if (payLen > exports.MAX_FRAME_PAYLOAD_BYTES) {
                this.resync(`payload length ${payLen}`);
                continue;
            }
            const total = 8 + hdrLen + 4 + payLen;
            if (this.buf.length < total) {
                this.need = total;
                return;
            }
            let header;
            try {
                header = frameHeaderOf(JSON.parse(this.buf.subarray(8, 8 + hdrLen).toString('utf8')));
            }
            catch {
                header = undefined;
            }
            // Copy: the record outlives this buffer.
            const payload = Buffer.from(this.buf.subarray(8 + hdrLen + 4, total));
            this.buf = this.buf.subarray(total);
            if (!header) {
                this.dropped++;
                this.log('[DesktopHost] dropped a frame record with a bad header');
                continue;
            }
            this.onRecord({ ...header, payload });
        }
    }
    /** Drops bytes up to the next magic after the current position. */
    resync(why) {
        this.dropped++;
        this.log(`[DesktopHost] frame pipe out of sync (${why}); resyncing`);
        const next = this.buf.indexOf(exports.FRAME_MAGIC, 1);
        // Without a later magic, keep only a possible partial magic at the end.
        this.buf =
            next >= 0
                ? this.buf.subarray(next)
                : this.buf.subarray(Math.max(1, this.buf.length - 3));
    }
    /** Forgets a partial record (e.g. after a helper restart). */
    reset() {
        this.pending = [];
        this.pendingBytes = 0;
        this.need = 8;
        this.buf = Buffer.alloc(0);
    }
}
exports.FrameParser = FrameParser;
/** Encodes a record (tests, fakes). */
function encodeFrameRecord(header, payload = Buffer.alloc(0)) {
    const h = Buffer.from(JSON.stringify(header), 'utf8');
    const hdrLen = Buffer.alloc(4);
    hdrLen.writeUInt32BE(h.length, 0);
    const payLen = Buffer.alloc(4);
    payLen.writeUInt32BE(payload.length, 0);
    return Buffer.concat([exports.FRAME_MAGIC, hdrLen, h, payLen, payload]);
}
