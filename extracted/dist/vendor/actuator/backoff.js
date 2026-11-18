"use strict";
/**
 * @fileoverview Reconnect and retry timing for `ActuatorClient` (actuator
 * contract §4.2 "Reconnect" and "Fulfill delivery").
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Backoff = exports.ActuatorErrorReason = exports.DEFAULT_TYPE_UNAVAILABLE_RETRY_MS = exports.DEFAULT_UNIMPLEMENTED_RETRY_MS = exports.DEFAULT_BACKOFF = void 0;
exports.backoffDelayMs = backoffDelayMs;
exports.connectErrorReason = connectErrorReason;
exports.decideReconnect = decideReconnect;
exports.isTerminalFulfillError = isTerminalFulfillError;
exports.sleep = sleep;
const wire_1 = require("@bufbuild/protobuf/wire"); // from //third_party/javascript/bufbuild_protobuf
const connect_1 = require("@connectrpc/connect"); // from //third_party/javascript/connectrpc_connect
/** 1 s → 10 s with ±20% jitter. */
exports.DEFAULT_BACKOFF = {
    initialMs: 1000,
    maxMs: 10000,
    jitter: 0.2,
};
/** Wait after `UNIMPLEMENTED` (an old LS without ActuatorService). */
exports.DEFAULT_UNIMPLEMENTED_RETRY_MS = 30000;
/** Wait after `FAILED_PRECONDITION / ACTUATOR_TYPE_UNAVAILABLE`. */
exports.DEFAULT_TYPE_UNAVAILABLE_RETRY_MS = 30000;
/** `google.rpc.ErrorInfo.reason` values from contract §1.5. */
var ActuatorErrorReason;
(function (ActuatorErrorReason) {
    ActuatorErrorReason["BINARY_REQUIRED"] = "ACTUATOR_BINARY_REQUIRED";
    ActuatorErrorReason["TYPE_UNAVAILABLE"] = "ACTUATOR_TYPE_UNAVAILABLE";
    ActuatorErrorReason["PROTOCOL_MISMATCH"] = "ACTUATOR_PROTOCOL_MISMATCH";
    ActuatorErrorReason["LIMIT_EXCEEDED"] = "ACTUATOR_LIMIT_EXCEEDED";
    ActuatorErrorReason["PAYLOAD_TYPE"] = "ACTUATOR_PAYLOAD_TYPE";
    ActuatorErrorReason["SESSION_MISMATCH"] = "ACTUATOR_SESSION_MISMATCH";
    ActuatorErrorReason["NO_PENDING"] = "ACTUATOR_NO_PENDING";
    ActuatorErrorReason["NOT_CONNECTED"] = "ACTUATOR_NOT_CONNECTED";
    ActuatorErrorReason["INVALID_RESULT"] = "ACTUATOR_INVALID_RESULT";
    ActuatorErrorReason["REPLACED"] = "ACTUATOR_REPLACED";
})(ActuatorErrorReason || (exports.ActuatorErrorReason = ActuatorErrorReason = {}));
/**
 * Delay before retry number `attempt` (0-based): `initialMs * 2^attempt`,
 * jittered by ±`jitter`, and never above `maxMs`.
 */
function backoffDelayMs(attempt, opts, random = Math.random) {
    const exp = Math.min(Math.max(0, attempt), 30);
    const base = Math.min(opts.maxMs, opts.initialMs * 2 ** exp);
    const spread = base * opts.jitter;
    const jittered = base - spread + random() * 2 * spread;
    return Math.round(Math.min(opts.maxMs, Math.max(0, jittered)));
}
/** Stateful wrapper around `backoffDelayMs`. */
class Backoff {
    constructor(opts, random = Math.random) {
        this.opts = opts;
        this.random = random;
        this.attempt = 0;
    }
    /** Returns the next delay and advances. */
    next() {
        return backoffDelayMs(this.attempt++, this.opts, this.random);
    }
    /** Restarts at `initialMs`. */
    reset() {
        this.attempt = 0;
    }
}
exports.Backoff = Backoff;
const ERROR_INFO_TYPE = 'google.rpc.ErrorInfo';
const REASON_IN_TEXT = /\bACTUATOR_[A-Z_]+\b/;
/** Reads `reason` (field 1) from encoded `google.rpc.ErrorInfo` bytes. */
function decodeErrorInfoReason(bytes) {
    try {
        const reader = new wire_1.BinaryReader(bytes);
        while (reader.pos < reader.len) {
            const [fieldNo, wireType] = reader.tag();
            if (fieldNo === 1 && wireType === wire_1.WireType.LengthDelimited) {
                return reader.string();
            }
            reader.skip(wireType);
        }
    }
    catch {
        // A malformed detail counts as absent; the caller falls back to the text.
        return '';
    }
    return '';
}
/**
 * Returns the `ErrorInfo.reason` of an LS error, or "" when absent. Reads the
 * `google.rpc.ErrorInfo` detail without depending on its generated type, and
 * falls back to an `ACTUATOR_*` token in the message text.
 */
function connectErrorReason(err) {
    for (const detail of err.details) {
        // An incoming detail is {type, value}; an outgoing one has no `type`.
        const incoming = detail;
        if (incoming.type === ERROR_INFO_TYPE && incoming.value) {
            const reason = decodeErrorInfoReason(incoming.value);
            if (reason) {
                return reason;
            }
        }
    }
    return REASON_IN_TEXT.exec(err.rawMessage)?.[0] ?? '';
}
/**
 * Maps a stream end to the contract §4.2 reconnect rule. `err` is undefined
 * when the server closed the stream cleanly.
 */
function decideReconnect(err, timing) {
    if (err === undefined) {
        return {
            action: 'retry',
            state: 'backoff',
            delayMs: timing.backoff.next(),
            reason: 'stream closed by server',
        };
    }
    const ce = connect_1.ConnectError.from(err);
    const reason = connectErrorReason(ce);
    if (ce.code === connect_1.Code.Unimplemented) {
        return {
            action: 'retry',
            state: 'unimplemented',
            delayMs: timing.unimplementedRetryMs,
            reason: 'ActuatorService unimplemented',
        };
    }
    if (reason === ActuatorErrorReason.REPLACED) {
        return { action: 'stop', reason };
    }
    if (reason === ActuatorErrorReason.TYPE_UNAVAILABLE ||
        reason === ActuatorErrorReason.PROTOCOL_MISMATCH) {
        return {
            action: 'retry',
            state: 'backoff',
            delayMs: timing.typeUnavailableRetryMs,
            reason,
        };
    }
    return {
        action: 'retry',
        state: 'backoff',
        delayMs: timing.backoff.next(),
        reason: reason || ce.message,
    };
}
/**
 * True when a Fulfill error is final: the LS will not accept this outcome no
 * matter how often it is resent (no pending request, wrong token, invalid or
 * oversized result, or no ActuatorService at all).
 */
function isTerminalFulfillError(err) {
    switch (err.code) {
        case connect_1.Code.NotFound:
        case connect_1.Code.PermissionDenied:
        case connect_1.Code.InvalidArgument:
        case connect_1.Code.FailedPrecondition:
        case connect_1.Code.Unimplemented:
        case connect_1.Code.ResourceExhausted:
            return true;
        default:
            return false;
    }
}
/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms, signal) {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, Math.max(0, ms));
        signal?.addEventListener('abort', done, { once: true });
    });
}
