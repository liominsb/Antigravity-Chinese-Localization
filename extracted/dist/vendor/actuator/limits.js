"use strict";
/**
 * @fileoverview Client-side enforcement of the actuator limits (contract §1.4
 * and `SubscribeAck.limits`), so oversized messages never reach the LS.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActuatorLimitError = exports.RESULT_EXCEEDS_LIMITS = exports.ENVELOPE_LIMITS = void 0;
exports.utf8Length = utf8Length;
exports.truncateUtf8 = truncateUtf8;
exports.validateActuatorType = validateActuatorType;
exports.validateActuatorId = validateActuatorId;
exports.checkHelloBytes = checkHelloBytes;
exports.clampConversationIds = clampConversationIds;
exports.clampDetail = clampDetail;
exports.clampErrorMessage = clampErrorMessage;
exports.fulfillLimitViolation = fulfillLimitViolation;
const protobuf_1 = require("@bufbuild/protobuf"); // from //third_party/javascript/bufbuild_protobuf
const actuator_pb_1 = require("../../proto/actuator_pb"); // from //third_party/jetski/actuator_pb:actuator_ts_proto
/** §1.4 envelope limits, used for fields the ack doesn't cover and before the first ack. */
exports.ENVELOPE_LIMITS = {
    maxActuatorTypeBytes: 32,
    maxActuatorIdBytes: 128,
    maxIdBytes: 256,
    maxClientFieldBytes: 64,
    maxConversationIds: 256,
    maxHelloBytes: 65536,
    maxDetailBytes: 256,
    maxErrorBytes: 16384,
};
const ACTUATOR_TYPE_RE = /^[a-z][a-z0-9_]{0,31}$/;
const ACTUATOR_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
/** The message `ActuatorClient` sends instead of a result that breaks a limit. */
exports.RESULT_EXCEEDS_LIMITS = 'result exceeds limits';
/** Thrown when a caller passes a value the LS would reject. */
class ActuatorLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ActuatorLimitError';
    }
}
exports.ActuatorLimitError = ActuatorLimitError;
const encoder = new TextEncoder();
/** UTF-8 byte length of `s`. */
function utf8Length(s) {
    return encoder.encode(s).length;
}
/** Truncates `s` to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateUtf8(s, maxBytes) {
    const bytes = encoder.encode(s);
    if (bytes.length <= maxBytes) {
        return s;
    }
    let end = Math.max(0, maxBytes);
    // Step back over UTF-8 continuation bytes (10xxxxxx).
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end--;
    }
    return new TextDecoder().decode(bytes.subarray(0, end));
}
/** Throws unless `actuatorType` matches `[a-z][a-z0-9_]{0,31}`. */
function validateActuatorType(actuatorType) {
    if (!ACTUATOR_TYPE_RE.test(actuatorType)) {
        throw new ActuatorLimitError(`invalid actuator type "${actuatorType}"`);
    }
}
/** Throws unless `actuatorId` matches `[A-Za-z0-9._:-]{1,128}`. */
function validateActuatorId(actuatorId) {
    if (!ACTUATOR_ID_RE.test(actuatorId)) {
        throw new ActuatorLimitError(`invalid actuator_id "${actuatorId}"`);
    }
}
/** A limit from the ack, or `fallback` when the ack is absent or sent 0. */
function limitOr(value, fallback) {
    return value && value > 0 ? value : fallback;
}
/** Throws when an encoded Hello is larger than `max_hello_bytes`. */
function checkHelloBytes(helloBytes, limits) {
    const max = limitOr(limits?.maxHelloBytes, exports.ENVELOPE_LIMITS.maxHelloBytes);
    if (helloBytes > max) {
        throw new ActuatorLimitError(`hello is ${helloBytes} B, max ${max} B`);
    }
}
/**
 * Drops conversation IDs the LS would reject: empty or over `max_id_bytes`,
 * duplicates, and anything past `max_conversation_ids`. Returns the kept IDs
 * and how many were dropped.
 */
function clampConversationIds(ids, limits) {
    const maxCount = limitOr(limits?.maxConversationIds, exports.ENVELOPE_LIMITS.maxConversationIds);
    const maxBytes = limitOr(limits?.maxIdBytes, exports.ENVELOPE_LIMITS.maxIdBytes);
    const kept = [];
    const seen = new Set();
    for (const id of ids) {
        if (kept.length < maxCount &&
            id !== '' &&
            !seen.has(id) &&
            utf8Length(id) <= maxBytes) {
            seen.add(id);
            kept.push(id);
        }
    }
    return { ids: kept, dropped: ids.length - kept.length };
}
/** Truncates a status `detail` to `max_detail_bytes`. */
function clampDetail(detail, limits) {
    return truncateUtf8(detail, limitOr(limits?.maxDetailBytes, exports.ENVELOPE_LIMITS.maxDetailBytes));
}
/** Truncates an `ActuatorError.message` to `max_error_bytes`. */
function clampErrorMessage(message, limits) {
    return truncateUtf8(message, limitOr(limits?.maxErrorBytes, exports.ENVELOPE_LIMITS.maxErrorBytes));
}
/**
 * Returns why `req` breaks `limits`, or undefined when it fits. A limit the ack
 * sent as 0 (or no ack yet) is not checked; the LS still enforces it.
 */
function fulfillLimitViolation(req, limits, encodedBytes) {
    if (!limits) {
        return undefined;
    }
    if (req.outcome.case === 'payload') {
        const size = req.outcome.value.value.length;
        if (limits.maxPayloadBytes > 0 && size > limits.maxPayloadBytes) {
            return `payload is ${size} B, max ${limits.maxPayloadBytes} B`;
        }
    }
    if (limits.maxBlobs > 0 && req.blobs.length > limits.maxBlobs) {
        return `${req.blobs.length} blobs, max ${limits.maxBlobs}`;
    }
    for (const blob of req.blobs) {
        if (limits.maxBlobBytes > 0 && blob.data.length > limits.maxBlobBytes) {
            return `blob "${blob.name}" is ${blob.data.length} B, max ${limits.maxBlobBytes} B`;
        }
        if (limits.blobMimeTypes.length > 0 &&
            !limits.blobMimeTypes.includes(blob.mimeType)) {
            return `blob "${blob.name}" has MIME type "${blob.mimeType}", allowed: ${limits.blobMimeTypes.join(', ')}`;
        }
        const maxPx = limits.maxBlobDimensionPx;
        if (maxPx > 0 && (blob.widthPx > maxPx || blob.heightPx > maxPx)) {
            return `blob "${blob.name}" is ${blob.widthPx}x${blob.heightPx} px, max ${maxPx} px`;
        }
    }
    if (limits.maxFulfillBytes > 0) {
        const size = encodedBytes ?? (0, protobuf_1.toBinary)(actuator_pb_1.FulfillRequestSchema, req).length;
        if (size > limits.maxFulfillBytes) {
            return `fulfill is ${size} B, max ${limits.maxFulfillBytes} B`;
        }
    }
    return undefined;
}
