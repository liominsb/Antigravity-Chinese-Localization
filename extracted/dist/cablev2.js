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
exports.CableCrypter = exports.NoiseKNpsk0Initiator = exports.CableKeyPurpose = exports.CableMessageType = exports.MAX_WEBSOCKET_MESSAGE_BYTES = exports.WEBAUTHN_CABLE_CANCEL_ASSERTION_CHANNEL = exports.WEBAUTHN_CABLE_GET_ASSERTION_CHANNEL = exports.WEBAUTHN_CABLE_AVAILABLE_CHANNEL = void 0;
exports.encodeCbor = encodeCbor;
exports.decodeCbor = decodeCbor;
exports.digitEncode = digitEncode;
exports.digitDecode = digitDecode;
exports.deriveCableKey = deriveCableKey;
exports.generateCableQrSession = generateCableQrSession;
exports.encryptCableEid = encryptCableEid;
exports.decryptCableEid = decryptCableEid;
exports.decodeTunnelServerDomain = decodeTunnelServerDomain;
exports.buildCableTunnelConnectUrl = buildCableTunnelConnectUrl;
exports.encodeCtapGetAssertionRequest = encodeCtapGetAssertionRequest;
exports.decodeCtapGetAssertionResponse = decodeCtapGetAssertionResponse;
exports.toBase64Url = toBase64Url;
exports.fromBase64Url = fromBase64Url;
exports.canonicalizeWebAuthnChallenge = canonicalizeWebAuthnChallenge;
exports.buildCollectedClientDataJson = buildCollectedClientDataJson;
exports.isValidRpIdForOrigin = isValidRpIdForOrigin;
exports.verifyAuthenticatorData = verifyAuthenticatorData;
exports.resolveCableBleScannerBinaryPath = resolveCableBleScannerBinaryPath;
exports.isCableBleScannerAvailable = isCableBleScannerAvailable;
exports.connectCableWebSocket = connectCableWebSocket;
exports.buildCableQrModalHtml = buildCableQrModalHtml;
exports.recordWebviewUserActivation = recordWebviewUserActivation;
exports.performCableGetAssertion = performCableGetAssertion;
exports.registerCableWebAuthnIpcHandlers = registerCableWebAuthnIpcHandlers;
exports.cancelCableGetAssertion = cancelCableGetAssertion;
exports.resetCableWebAuthnIpcStateForTesting = resetCableWebAuthnIpcStateForTesting;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const path = __importStar(require("path"));
const qrEncoder_1 = require("./qrEncoder");
const utils_1 = require("./utils");
/** IPC channel invoked by `<webview>` guests to query whether `caBLEv2` is available. */
exports.WEBAUTHN_CABLE_AVAILABLE_CHANNEL = 'webauthn:cable-available';
/** IPC channel invoked by `<webview>` guests to perform a `caBLEv2` assertion. */
exports.WEBAUTHN_CABLE_GET_ASSERTION_CHANNEL = 'webauthn:cable-get-assertion';
/** IPC channel invoked by `<webview>` guests to abort an active `caBLEv2` assertion. */
exports.WEBAUTHN_CABLE_CANCEL_ASSERTION_CHANNEL = 'webauthn:cable-cancel-assertion';
/** Maximum allowed WebSocket message size (single frame or reassembled fragments). */
exports.MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024;
const MAX_CBOR_DEPTH = 16;
const MAX_CBOR_COLLECTION_ITEMS = 1024;
const MIN_WEBAUTHN_CHALLENGE_BYTES = 16;
// The challenge is only hashed into `clientDataHash`, so the authenticator never
// sees its length. Google sign-in sends challenges of over 12 KB; this bound only
// limits the work done on a pathological challenge after it arrives over IPC.
const MAX_WEBAUTHN_CHALLENGE_BYTES = 64 * 1024;
const MIN_AUTHENTICATOR_DATA_BYTES = 37;
const AUTH_DATA_FLAG_UP = 0x01;
const AUTH_DATA_FLAG_UV = 0x04;
const USER_ACTIVATION_WINDOW_MS = 5000;
const QR_CODE_PREFIX = 'FIDO:/';
const ASSIGNED_TUNNEL_DOMAINS = ['cable.ua5v.com', 'cable.auth.com'];
const DYNAMIC_DOMAIN_TLDS = ['.com', '.org', '.net', '.info'];
const DYNAMIC_DOMAIN_BASE32_CHARS = 'abcdefghijklmnopqrstuvwxyz234567';
const DYNAMIC_DOMAIN_SHA_PREFIX = Buffer.from('caBLEv2 tunnel server domain', 'utf8');
const NOISE_KN_PSK0_PROTOCOL_NAME = Buffer.from('Noise_KNpsk0_P256_AESGCM_SHA256\0', 'utf8');
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CABLE_WEBSOCKET_SUBPROTOCOL = 'fido.cable';
const CHUNK_SIZE = 7;
const CHUNK_DIGITS = 17;
const PARTIAL_CHUNK_DIGITS = [0, 3, 5, 8, 10, 13, 15];
const EID_AES_BLOCK_SIZE = 16;
const EID_HMAC_SIZE = 4;
const EID_TOTAL_SIZE = EID_AES_BLOCK_SIZE + EID_HMAC_SIZE;
const EID_KEY_SIZE = 64;
const TUNNEL_ID_SIZE = 16;
const PSK_SIZE = 32;
const P256_X962_UNCOMPRESSED_SIZE = 65;
const AES_GCM_TAG_SIZE = 16;
const CRYPTER_PADDING_GRANULARITY = 32;
const CRYPTER_MAX_SEQUENCE = (1 << 24) - 1;
const CTAP_CMD_GET_ASSERTION = 0x02;
const CTAP_STATUS_OK = 0x00;
/** Tunnel framing message types defined by CTAP 2.2 Hybrid Transport. */
var CableMessageType;
(function (CableMessageType) {
    CableMessageType[CableMessageType["SHUTDOWN"] = 0] = "SHUTDOWN";
    CableMessageType[CableMessageType["CTAP"] = 1] = "CTAP";
    CableMessageType[CableMessageType["UPDATE"] = 2] = "UPDATE";
    CableMessageType[CableMessageType["JSON"] = 3] = "JSON";
})(CableMessageType || (exports.CableMessageType = CableMessageType = {}));
/** Key derivation purpose values defined by CTAP 2.2 Hybrid Transport. */
var CableKeyPurpose;
(function (CableKeyPurpose) {
    CableKeyPurpose[CableKeyPurpose["EID_KEY"] = 1] = "EID_KEY";
    CableKeyPurpose[CableKeyPurpose["TUNNEL_ID"] = 2] = "TUNNEL_ID";
    CableKeyPurpose[CableKeyPurpose["PSK"] = 3] = "PSK";
})(CableKeyPurpose || (exports.CableKeyPurpose = CableKeyPurpose = {}));
function encodeCborHeader(majorType, length) {
    const majorBits = (majorType & 0x07) << 5;
    const n = typeof length === 'bigint' ? length : BigInt(length);
    if (n < 24n) {
        return Buffer.from([majorBits | Number(n)]);
    }
    if (n <= 0xffn) {
        return Buffer.from([majorBits | 24, Number(n)]);
    }
    if (n <= 0xffffn) {
        const buf = Buffer.alloc(3);
        buf[0] = majorBits | 25;
        buf.writeUInt16BE(Number(n), 1);
        return buf;
    }
    if (n <= 0xffffffffn) {
        const buf = Buffer.alloc(5);
        buf[0] = majorBits | 26;
        buf.writeUInt32BE(Number(n), 1);
        return buf;
    }
    const buf = Buffer.alloc(9);
    buf[0] = majorBits | 27;
    buf.writeBigUInt64BE(n, 1);
    return buf;
}
/**
 * Encodes a {@link CborValue} into deterministic CTAP2 / RFC 7049 canonical
 * CBOR bytes.
 */
function encodeCbor(value) {
    if (value === null) {
        return Buffer.from([0xf6]);
    }
    if (typeof value === 'boolean') {
        return Buffer.from([value ? 0xf5 : 0xf4]);
    }
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new Error('Floating-point CBOR values are not supported');
        }
        if (value >= 0) {
            return encodeCborHeader(0, value);
        }
        return encodeCborHeader(1, -1 - value);
    }
    if (typeof value === 'bigint') {
        if (value >= 0n) {
            return encodeCborHeader(0, value);
        }
        return encodeCborHeader(1, -1n - value);
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
        return Buffer.concat([encodeCborHeader(2, bytes.length), bytes]);
    }
    if (typeof value === 'string') {
        const utf8 = Buffer.from(value, 'utf8');
        return Buffer.concat([encodeCborHeader(3, utf8.length), utf8]);
    }
    if (Array.isArray(value)) {
        const parts = [encodeCborHeader(4, value.length)];
        for (const item of value) {
            parts.push(encodeCbor(item));
        }
        return Buffer.concat(parts);
    }
    if (value instanceof Map) {
        // CTAP2 canonical CBOR sorts map keys by encoded byte length first, then
        // unsigned lexicographical byte comparison.
        const encodedEntries = [];
        for (const [k, v] of value.entries()) {
            encodedEntries.push({
                keyBytes: encodeCbor(k),
                valBytes: encodeCbor(v),
            });
        }
        encodedEntries.sort((a, b) => {
            if (a.keyBytes.length !== b.keyBytes.length) {
                return a.keyBytes.length - b.keyBytes.length;
            }
            return Buffer.compare(a.keyBytes, b.keyBytes);
        });
        const parts = [encodeCborHeader(5, encodedEntries.length)];
        for (const entry of encodedEntries) {
            parts.push(entry.keyBytes, entry.valBytes);
        }
        return Buffer.concat(parts);
    }
    throw new Error(`Unsupported CBOR value type: ${typeof value}`);
}
function readCborArgument(buf, offset, additionalInfo) {
    if (additionalInfo < 24) {
        return { arg: additionalInfo, nextOffset: offset };
    }
    if (additionalInfo === 24) {
        if (offset + 1 > buf.length) {
            throw new Error('Truncated CBOR uint8');
        }
        return { arg: buf.readUInt8(offset), nextOffset: offset + 1 };
    }
    if (additionalInfo === 25) {
        if (offset + 2 > buf.length) {
            throw new Error('Truncated CBOR uint16');
        }
        return { arg: buf.readUInt16BE(offset), nextOffset: offset + 2 };
    }
    if (additionalInfo === 26) {
        if (offset + 4 > buf.length) {
            throw new Error('Truncated CBOR uint32');
        }
        return { arg: buf.readUInt32BE(offset), nextOffset: offset + 4 };
    }
    if (additionalInfo === 27) {
        if (offset + 8 > buf.length) {
            throw new Error('Truncated CBOR uint64');
        }
        const big = buf.readBigUInt64BE(offset);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error('CBOR uint64 exceeds MAX_SAFE_INTEGER');
        }
        return { arg: Number(big), nextOffset: offset + 8 };
    }
    throw new Error(`Unsupported CBOR additional info: ${additionalInfo}`);
}
function decodeCborInternal(buf, offset, depth) {
    if (depth > MAX_CBOR_DEPTH) {
        throw new Error(`CBOR nesting depth exceeds maximum (${MAX_CBOR_DEPTH})`);
    }
    if (offset >= buf.length) {
        throw new Error('Unexpected end of CBOR buffer');
    }
    const initialByte = buf[offset];
    const majorType = initialByte >>> 5;
    const additionalInfo = initialByte & 0x1f;
    const { arg, nextOffset } = readCborArgument(buf, offset + 1, additionalInfo);
    switch (majorType) {
        case 0:
            return { value: arg, nextOffset };
        case 1:
            return { value: -1 - arg, nextOffset };
        case 2: {
            if (nextOffset + arg > buf.length) {
                throw new Error('Truncated CBOR byte string');
            }
            return {
                value: Buffer.from(buf.subarray(nextOffset, nextOffset + arg)),
                nextOffset: nextOffset + arg,
            };
        }
        case 3: {
            if (nextOffset + arg > buf.length) {
                throw new Error('Truncated CBOR text string');
            }
            return {
                value: buf.subarray(nextOffset, nextOffset + arg).toString('utf8'),
                nextOffset: nextOffset + arg,
            };
        }
        case 4: {
            if (arg > MAX_CBOR_COLLECTION_ITEMS) {
                throw new Error(`CBOR array length exceeds maximum (${MAX_CBOR_COLLECTION_ITEMS})`);
            }
            const arr = [];
            let cursor = nextOffset;
            for (let i = 0; i < arg; i++) {
                const decoded = decodeCborInternal(buf, cursor, depth + 1);
                arr.push(decoded.value);
                cursor = decoded.nextOffset;
            }
            return { value: arr, nextOffset: cursor };
        }
        case 5: {
            if (arg > MAX_CBOR_COLLECTION_ITEMS) {
                throw new Error(`CBOR map length exceeds maximum (${MAX_CBOR_COLLECTION_ITEMS})`);
            }
            const map = new Map();
            let cursor = nextOffset;
            for (let i = 0; i < arg; i++) {
                const decodedKey = decodeCborInternal(buf, cursor, depth + 1);
                cursor = decodedKey.nextOffset;
                const decodedVal = decodeCborInternal(buf, cursor, depth + 1);
                cursor = decodedVal.nextOffset;
                if (typeof decodedKey.value !== 'number' &&
                    typeof decodedKey.value !== 'string') {
                    throw new Error('Unsupported CBOR map key type');
                }
                if (map.has(decodedKey.value)) {
                    throw new Error(`Duplicate CBOR map key: ${String(decodedKey.value)}`);
                }
                map.set(decodedKey.value, decodedVal.value);
            }
            return { value: map, nextOffset: cursor };
        }
        case 7: {
            if (additionalInfo === 20) {
                return { value: false, nextOffset: offset + 1 };
            }
            if (additionalInfo === 21) {
                return { value: true, nextOffset: offset + 1 };
            }
            if (additionalInfo === 22) {
                return { value: null, nextOffset: offset + 1 };
            }
            throw new Error(`Unsupported CBOR simple value: ${additionalInfo}`);
        }
        default:
            throw new Error(`Unsupported CBOR major type: ${majorType}`);
    }
}
/**
 * Decodes a single CBOR item from `buf` starting at `offset` and verifies that
 * no trailing unconsumed bytes remain in `buf`.
 */
function decodeCbor(buf, offset = 0) {
    const result = decodeCborInternal(buf, offset, 0);
    if (result.nextOffset !== buf.length) {
        throw new Error('Trailing bytes after top-level CBOR value');
    }
    return result;
}
/**
 * Encodes arbitrary bytes into FIDO Hybrid CTAP decimal digits (7-byte
 * little-endian chunks -> 17 zero-padded digits).
 */
function digitEncode(input) {
    let out = '';
    let i = 0;
    while (i + CHUNK_SIZE <= input.length) {
        let val = 0n;
        for (let j = 0; j < CHUNK_SIZE; j++) {
            val |= BigInt(input[i + j]) << BigInt(8 * j);
        }
        out += val.toString(10).padStart(CHUNK_DIGITS, '0');
        i += CHUNK_SIZE;
    }
    const rem = input.length - i;
    if (rem > 0) {
        let val = 0n;
        for (let j = 0; j < rem; j++) {
            val |= BigInt(input[i + j]) << BigInt(8 * j);
        }
        out += val.toString(10).padStart(PARTIAL_CHUNK_DIGITS[rem], '0');
    }
    return out;
}
/**
 * Decodes a FIDO Hybrid CTAP decimal digit string back into raw bytes.
 */
function digitDecode(digits) {
    if (!/^\d*$/.test(digits)) {
        throw new Error('Digit-encoded input contains non-digit characters');
    }
    const completeChunks = Math.floor(digits.length / CHUNK_DIGITS);
    const partialDigits = digits.length % CHUNK_DIGITS;
    const partialChunkSize = PARTIAL_CHUNK_DIGITS.indexOf(partialDigits);
    if (partialChunkSize === -1) {
        throw new Error(`Invalid digit-encoded length: ${digits.length}`);
    }
    const out = Buffer.alloc(completeChunks * CHUNK_SIZE + partialChunkSize);
    for (let c = 0; c < completeChunks; c++) {
        const slice = digits.slice(c * CHUNK_DIGITS, (c + 1) * CHUNK_DIGITS);
        const val = BigInt(slice);
        if (val >= 1n << 56n) {
            throw new Error('Decoded digit chunk overflows 7 bytes');
        }
        for (let j = 0; j < CHUNK_SIZE; j++) {
            out[c * CHUNK_SIZE + j] = Number((val >> BigInt(8 * j)) & 0xffn);
        }
    }
    if (partialChunkSize > 0) {
        const slice = digits.slice(digits.length - partialDigits);
        const val = BigInt(slice);
        if (val >= 1n << BigInt(8 * partialChunkSize)) {
            throw new Error('Decoded partial digit chunk overflows remaining bytes');
        }
        const baseOffset = completeChunks * CHUNK_SIZE;
        for (let j = 0; j < partialChunkSize; j++) {
            out[baseOffset + j] = Number((val >> BigInt(8 * j)) & 0xffn);
        }
    }
    return out;
}
function pad32(buf) {
    if (buf.length === 32) {
        return buf;
    }
    if (buf.length > 32) {
        return buf.subarray(buf.length - 32);
    }
    const out = Buffer.alloc(32, 0);
    buf.copy(out, 32 - buf.length);
    return out;
}
/**
 * Derives a `caBLEv2` key of `size` bytes using HKDF-SHA256 with the 4-byte
 * little-endian purpose info `[purpose, 0, 0, 0]`.
 */
function deriveCableKey(secret, salt, purpose, size) {
    const info = Buffer.from([purpose, 0x00, 0x00, 0x00]);
    return Buffer.from(crypto.hkdfSync('sha256', secret, salt, info, size));
}
/**
 * Generates a fresh `caBLEv2` QR session (`FIDO:/<digits>` URI, P-256 identity
 * keypair, 16-byte QR secret, 64-byte EID key, and 16-byte tunnel ID).
 */
function generateCableQrSession(options) {
    const ecdh = crypto.createECDH('prime256v1');
    if (options?.identityPrivateKey) {
        ecdh.setPrivateKey(options.identityPrivateKey);
    }
    else {
        ecdh.generateKeys();
    }
    const identityPublicKeyCompressed = Buffer.from(ecdh.getPublicKey(null, 'compressed'));
    const identityPublicKeyUncompressed = Buffer.from(ecdh.getPublicKey(null, 'uncompressed'));
    const identityPrivateKey = pad32(Buffer.from(ecdh.getPrivateKey()));
    const qrSecret = options?.qrSecret
        ? Buffer.from(options.qrSecret)
        : crypto.randomBytes(16);
    if (qrSecret.length !== 16) {
        throw new Error('qrSecret must be exactly 16 bytes');
    }
    const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const hint = options?.hint ?? 'ga';
    const qrMap = new Map([
        [0, identityPublicKeyCompressed],
        [1, qrSecret],
        [2, ASSIGNED_TUNNEL_DOMAINS.length],
        [3, nowSeconds],
        [4, false],
        [5, hint],
    ]);
    const cborBytes = encodeCbor(qrMap);
    const qrUri = `${QR_CODE_PREFIX}${digitEncode(cborBytes)}`;
    const eidKey = deriveCableKey(qrSecret, Buffer.alloc(0), CableKeyPurpose.EID_KEY, EID_KEY_SIZE);
    const tunnelId = deriveCableKey(qrSecret, Buffer.alloc(0), CableKeyPurpose.TUNNEL_ID, TUNNEL_ID_SIZE);
    return {
        qrUri,
        qrSecret,
        identityPublicKeyCompressed,
        identityPublicKeyUncompressed,
        identityPrivateKey,
        eidKey,
        tunnelId,
    };
}
/**
 * Encrypts a 16-byte `caBLEv2` EID block with single-block AES-256 and appends
 * a 4-byte HMAC-SHA256 tag.
 */
function encryptCableEid(eid16Bytes, eidKey) {
    if (eid16Bytes.length !== EID_AES_BLOCK_SIZE || eid16Bytes[0] !== 0x00) {
        throw new Error('EID plaintext must be 16 bytes starting with 0x00');
    }
    if (eidKey.length !== EID_KEY_SIZE) {
        throw new Error('EID key must be 64 bytes');
    }
    const cipher = crypto.createCipheriv('aes-256-cbc', eidKey.subarray(0, 32), Buffer.alloc(16, 0));
    cipher.setAutoPadding(false);
    const encryptedBlock = Buffer.concat([
        cipher.update(eid16Bytes),
        cipher.final(),
    ]);
    const hmac = crypto
        .createHmac('sha256', eidKey.subarray(32, 64))
        .update(encryptedBlock)
        .digest()
        .subarray(0, EID_HMAC_SIZE);
    return Buffer.concat([encryptedBlock, hmac]);
}
/**
 * Verifies and decrypts a BLE advertisement service-data payload (`>= 20`
 * bytes, ignoring any trailing CTAP 2.3 transport-options suffix) against the
 * 64-byte `eidKey`. Returns `null` if the HMAC or reserved byte does not match.
 */
function decryptCableEid(advertServiceData, eidKey) {
    if (advertServiceData.length < EID_TOTAL_SIZE ||
        eidKey.length !== EID_KEY_SIZE) {
        return null;
    }
    const encryptedBlock = advertServiceData.subarray(0, EID_AES_BLOCK_SIZE);
    const receivedTag = advertServiceData.subarray(EID_AES_BLOCK_SIZE, EID_TOTAL_SIZE);
    const expectedTag = crypto
        .createHmac('sha256', eidKey.subarray(32, 64))
        .update(encryptedBlock)
        .digest()
        .subarray(0, EID_HMAC_SIZE);
    if (!crypto.timingSafeEqual(receivedTag, expectedTag)) {
        return null;
    }
    const decipher = crypto.createDecipheriv('aes-256-cbc', eidKey.subarray(0, 32), Buffer.alloc(16, 0));
    decipher.setAutoPadding(false);
    const plaintext = Buffer.concat([
        decipher.update(encryptedBlock),
        decipher.final(),
    ]);
    if (plaintext.length !== EID_AES_BLOCK_SIZE || plaintext[0] !== 0x00) {
        return null;
    }
    const domainId = plaintext.readUInt16LE(14);
    if (domainId >= ASSIGNED_TUNNEL_DOMAINS.length && domainId < 256) {
        return null;
    }
    return {
        decryptedEid: plaintext,
        nonce: Buffer.from(plaintext.subarray(1, 11)),
        routingId: Buffer.from(plaintext.subarray(11, 14)),
        domainId,
    };
}
/**
 * Decodes a 16-bit `caBLEv2` tunnel server domain ID into a hostname.
 */
function decodeTunnelServerDomain(domainId) {
    if (domainId >= 0 && domainId < ASSIGNED_TUNNEL_DOMAINS.length) {
        return ASSIGNED_TUNNEL_DOMAINS[domainId];
    }
    if (domainId < 256 || domainId > 0xffff) {
        throw new Error(`Unrecognized caBLEv2 tunnel domain ID: ${domainId}`);
    }
    const shaInput = Buffer.alloc(DYNAMIC_DOMAIN_SHA_PREFIX.length + 3);
    DYNAMIC_DOMAIN_SHA_PREFIX.copy(shaInput, 0);
    shaInput.writeUInt16LE(domainId, DYNAMIC_DOMAIN_SHA_PREFIX.length);
    shaInput[DYNAMIC_DOMAIN_SHA_PREFIX.length + 2] = 0x00;
    const digest = crypto.createHash('sha256').update(shaInput).digest();
    let val = digest.readBigUInt64LE(0);
    const tldIndex = Number(val & 3n);
    val >>= 2n;
    let label = 'cable.';
    while (val !== 0n) {
        label += DYNAMIC_DOMAIN_BASE32_CHARS[Number(val & 31n)];
        val >>= 5n;
    }
    return `${label}${DYNAMIC_DOMAIN_TLDS[tldIndex]}`;
}
/**
 * Builds the `wss://` WebSocket tunnel connection URL for a decrypted BLE EID.
 */
function buildCableTunnelConnectUrl(components, tunnelId) {
    const domain = decodeTunnelServerDomain(components.domainId);
    const routingIdHex = components.routingId.toString('hex');
    const tunnelIdHex = tunnelId.toString('hex');
    return `wss://${domain}/cable/connect/${routingIdHex}/${tunnelIdHex}`;
}
function noiseHkdf(chainingKey, ikm, numOutputs) {
    const prk = crypto.createHmac('sha256', chainingKey).update(ikm).digest();
    const outputs = [];
    let prev = Buffer.alloc(0);
    for (let i = 1; i <= numOutputs; i++) {
        prev = crypto
            .createHmac('sha256', prk)
            .update(prev)
            .update(Buffer.from([i]))
            .digest();
        outputs.push(prev);
    }
    return outputs;
}
/**
 * Stateful Noise `KNpsk0_P256_AESGCM_SHA256` handshake initiator for
 * QR-initiated `caBLEv2` connections.
 */
class NoiseKNpsk0Initiator {
    constructor(psk, localIdentityPrivateKey, ephemeralPrivateKey) {
        this.psk = psk;
        this.symmetricKey = Buffer.alloc(0);
        if (psk.length !== PSK_SIZE) {
            throw new Error('Noise PSK must be 32 bytes');
        }
        this.chainingKey = Buffer.from(NOISE_KN_PSK0_PROTOCOL_NAME);
        this.h = Buffer.from(NOISE_KN_PSK0_PROTOCOL_NAME);
        this.identityEcdh = crypto.createECDH('prime256v1');
        this.identityEcdh.setPrivateKey(localIdentityPrivateKey);
        this.ephemeralEcdh = crypto.createECDH('prime256v1');
        if (ephemeralPrivateKey) {
            this.ephemeralEcdh.setPrivateKey(ephemeralPrivateKey);
        }
        else {
            this.ephemeralEcdh.generateKeys();
        }
    }
    mixHash(data) {
        this.h = crypto.createHash('sha256').update(this.h).update(data).digest();
    }
    mixKey(ikm) {
        const [ck, k] = noiseHkdf(this.chainingKey, ikm, 2);
        this.chainingKey = ck;
        this.symmetricKey = k;
    }
    mixKeyAndHash(ikm) {
        const [ck, tempH, k] = noiseHkdf(this.chainingKey, ikm, 3);
        this.chainingKey = ck;
        this.mixHash(tempH);
        this.symmetricKey = k;
    }
    encryptAndHash(plaintext) {
        const nonce = Buffer.alloc(12, 0);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.symmetricKey, nonce);
        cipher.setAAD(this.h);
        const encrypted = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
            cipher.getAuthTag(),
        ]);
        this.mixHash(encrypted);
        return encrypted;
    }
    decryptAndHash(ciphertextWithTag) {
        if (ciphertextWithTag.length < AES_GCM_TAG_SIZE) {
            return null;
        }
        const nonce = Buffer.alloc(12, 0);
        const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AES_GCM_TAG_SIZE);
        const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - AES_GCM_TAG_SIZE);
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.symmetricKey, nonce);
            decipher.setAAD(this.h);
            decipher.setAuthTag(tag);
            const plaintext = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]);
            this.mixHash(ciphertextWithTag);
            return plaintext;
        }
        catch {
            return null;
        }
    }
    /**
     * Builds the 81-byte initial handshake message (`65B ephemeral X9.62 point || 16B GCM tag`).
     */
    buildInitialMessage() {
        const localPub = Buffer.from(this.identityEcdh.getPublicKey(null, 'uncompressed'));
        this.mixHash(Buffer.from([0x01]));
        this.mixHash(localPub);
        this.mixKeyAndHash(this.psk);
        const ephemeralPub = Buffer.from(this.ephemeralEcdh.getPublicKey(null, 'uncompressed'));
        this.mixHash(ephemeralPub);
        this.mixKey(ephemeralPub);
        return Buffer.concat([ephemeralPub, this.encryptAndHash(Buffer.alloc(0))]);
    }
    /**
     * Processes the responder's handshake message (`>= 81` bytes) and derives
     * the post-handshake traffic keys (`readKey`, `writeKey`).
     */
    processResponse(response) {
        if (response.length < P256_X962_UNCOMPRESSED_SIZE + AES_GCM_TAG_SIZE ||
            response[0] !== 0x04) {
            throw new Error('Invalid Noise handshake response length or point format');
        }
        const peerPoint = response.subarray(0, P256_X962_UNCOMPRESSED_SIZE);
        const ciphertext = response.subarray(P256_X962_UNCOMPRESSED_SIZE);
        this.mixHash(peerPoint);
        this.mixKey(peerPoint);
        const esShared = pad32(this.ephemeralEcdh.computeSecret(peerPoint));
        this.mixKey(esShared);
        const seShared = pad32(this.identityEcdh.computeSecret(peerPoint));
        this.mixKey(seShared);
        const plaintext = this.decryptAndHash(ciphertext);
        if (!plaintext || plaintext.length !== 0) {
            throw new Error('Noise handshake GCM authentication failed');
        }
        const [writeKey, readKey] = noiseHkdf(this.chainingKey, Buffer.alloc(0), 2);
        return {
            readKey,
            writeKey,
            handshakeHash: Buffer.from(this.h),
        };
    }
}
exports.NoiseKNpsk0Initiator = NoiseKNpsk0Initiator;
/**
 * Post-handshake `caBLEv2` traffic crypter implementing 32-byte block padding
 * and AES-256-GCM encryption with big-endian 24-bit sequence counters.
 */
class CableCrypter {
    constructor(readKey, writeKey) {
        this.readKey = readKey;
        this.writeKey = writeKey;
        this.readSeq = 0;
        this.writeSeq = 0;
        if (readKey.length !== 32 || writeKey.length !== 32) {
            throw new Error('CableCrypter keys must be 32 bytes');
        }
    }
    buildNonce(counter) {
        if (counter > CRYPTER_MAX_SEQUENCE) {
            throw new Error('caBLEv2 sequence number overflow');
        }
        const nonce = Buffer.alloc(12, 0);
        nonce.writeUInt32BE(counter, 8);
        return nonce;
    }
    encrypt(plaintext) {
        const extraBytes = CRYPTER_PADDING_GRANULARITY -
            (plaintext.length % CRYPTER_PADDING_GRANULARITY);
        const padded = Buffer.alloc(plaintext.length + extraBytes, 0);
        plaintext.copy(padded, 0);
        padded[padded.length - 1] = extraBytes - 1;
        const nonce = this.buildNonce(this.writeSeq++);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.writeKey, nonce);
        return Buffer.concat([
            cipher.update(padded),
            cipher.final(),
            cipher.getAuthTag(),
        ]);
    }
    decrypt(ciphertextWithTag) {
        if (ciphertextWithTag.length < AES_GCM_TAG_SIZE) {
            return null;
        }
        const nonce = this.buildNonce(this.readSeq);
        const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AES_GCM_TAG_SIZE);
        const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - AES_GCM_TAG_SIZE);
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.readKey, nonce);
            decipher.setAuthTag(tag);
            const padded = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]);
            this.readSeq++;
            if (padded.length === 0) {
                return null;
            }
            const extraBytes = padded[padded.length - 1] + 1;
            if (extraBytes > padded.length) {
                return null;
            }
            return Buffer.from(padded.subarray(0, padded.length - extraBytes));
        }
        catch {
            return null;
        }
    }
}
exports.CableCrypter = CableCrypter;
/**
 * Encodes a CTAP2 `authenticatorGetAssertion` command (`0x02 || CBOR map`).
 */
function encodeCtapGetAssertionRequest(params) {
    if (params.clientDataHash.length !== 32) {
        throw new Error('clientDataHash must be 32 bytes');
    }
    const map = new Map([
        [1, params.rpId],
        [2, params.clientDataHash],
    ]);
    if (params.allowCredentialIds && params.allowCredentialIds.length > 0) {
        const allowList = params.allowCredentialIds.map((id) => new Map([
            ['id', id],
            ['type', 'public-key'],
        ]));
        map.set(3, allowList);
    }
    if (params.userVerificationRequired) {
        map.set(5, new Map([['uv', true]]));
    }
    return Buffer.concat([
        Buffer.from([CTAP_CMD_GET_ASSERTION]),
        encodeCbor(map),
    ]);
}
/**
 * Decodes a CTAP2 `authenticatorGetAssertion` response payload (`statusByte || CBOR map`).
 */
function decodeCtapGetAssertionResponse(ctapPayload) {
    if (ctapPayload.length === 0) {
        throw new Error('Empty CTAP2 assertion response');
    }
    const status = ctapPayload[0];
    if (status !== CTAP_STATUS_OK) {
        throw new Error(`CTAP2 authenticatorGetAssertion failed with status 0x${status.toString(16).padStart(2, '0')}`);
    }
    const { value } = decodeCbor(ctapPayload, 1);
    if (!(value instanceof Map)) {
        throw new Error('CTAP2 assertion response is not a CBOR map');
    }
    let credentialId = null;
    const credDesc = value.get(1);
    if (credDesc instanceof Map) {
        const idVal = credDesc.get('id');
        if (Buffer.isBuffer(idVal)) {
            credentialId = idVal;
        }
    }
    const authData = value.get(2);
    const signature = value.get(3);
    if (!Buffer.isBuffer(authData) || !Buffer.isBuffer(signature)) {
        throw new Error('CTAP2 assertion response missing authenticatorData or signature');
    }
    let userHandle = null;
    const userEntity = value.get(4);
    if (userEntity instanceof Map) {
        const uid = userEntity.get('id');
        if (Buffer.isBuffer(uid)) {
            userHandle = uid;
        }
    }
    return {
        credentialId,
        authenticatorData: authData,
        signature,
        userHandle,
    };
}
/**
 * Encodes a Buffer into unpadded Base64URL (`RFC 4648 §5`).
 */
function toBase64Url(buf) {
    return buf.toString('base64url');
}
/**
 * Decodes a Base64URL (or standard Base64) string into a Buffer.
 */
function fromBase64Url(input) {
    return Buffer.from(input, 'base64url');
}
/**
 * Canonicalizes and validates a Base64URL challenge string and returns its
 * decoded bytes and canonical unpadded Base64URL representation.
 */
function canonicalizeWebAuthnChallenge(challengeBase64Url, minBytes = 1) {
    if (typeof challengeBase64Url !== 'string' ||
        challengeBase64Url.length === 0 ||
        !/^[A-Za-z0-9_-]+$/.test(challengeBase64Url)) {
        throw new Error('[TypeError] Invalid Base64URL WebAuthn challenge');
    }
    const challengeBytes = fromBase64Url(challengeBase64Url);
    if (challengeBytes.length < minBytes ||
        challengeBytes.length > MAX_WEBAUTHN_CHALLENGE_BYTES) {
        throw new Error(`[TypeError] WebAuthn challenge length (${challengeBytes.length} bytes) must be in ${minBytes}..${MAX_WEBAUTHN_CHALLENGE_BYTES}`);
    }
    const canonicalBase64Url = toBase64Url(challengeBytes);
    return { challengeBytes, canonicalBase64Url };
}
/**
 * Builds the WebAuthn `CollectedClientData` JSON string and its SHA-256 hash.
 */
function buildCollectedClientDataJson(challengeBase64Url, origin, crossOrigin = false) {
    const { canonicalBase64Url } = canonicalizeWebAuthnChallenge(challengeBase64Url, 1);
    const json = JSON.stringify({
        type: 'webauthn.get',
        challenge: canonicalBase64Url,
        origin,
        crossOrigin,
    });
    const clientDataJSON = Buffer.from(json, 'utf8');
    const clientDataHash = crypto
        .createHash('sha256')
        .update(clientDataJSON)
        .digest();
    return { clientDataJSON, clientDataHash };
}
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
    'co.uk',
    'org.uk',
    'ac.uk',
    'gov.uk',
    'me.uk',
    'net.uk',
    'com.au',
    'net.au',
    'org.au',
    'edu.au',
    'gov.au',
    'co.jp',
    'ne.jp',
    'or.jp',
    'ac.jp',
    'go.jp',
    'com.br',
    'org.br',
    'net.br',
    'com.cn',
    'net.cn',
    'org.cn',
    'co.in',
    'net.in',
    'org.in',
    'co.nz',
    'net.nz',
    'org.nz',
    'co.za',
    'org.za',
    'com.mx',
    'com.sg',
    'com.tw',
    'com.hk',
    'co.kr',
    'or.kr',
    'github.io',
    'gitlab.io',
    'bitbucket.io',
    'appspot.com',
    'firebaseapp.com',
    'web.app',
    'pages.dev',
    'workers.dev',
    'vercel.app',
    'netlify.app',
    'herokuapp.com',
    'cloudfront.net',
    'azurewebsites.net',
    's3.amazonaws.com',
    'amazonaws.com',
    'googleusercontent.com',
    'blogspot.com',
    'run.app',
    'cloudfunctions.net',
]);
function isPublicSuffixRpId(normalizedRpId) {
    if (!normalizedRpId.includes('.')) {
        return true;
    }
    if (MULTI_LABEL_PUBLIC_SUFFIXES.has(normalizedRpId)) {
        return true;
    }
    // Reject standard two-label ccTLD registry suffixes (e.g. co.xx, com.xx, org.xx, gov.xx).
    if (/^(?:co|com|org|net|gov|edu|ac|mil|ne|or|go|gob)\.[a-z]{2}$/.test(normalizedRpId)) {
        return true;
    }
    return false;
}
/**
 * Validates that `rpId` is a registrable domain suffix of `originUrl` and that
 * `originUrl` is a secure WebAuthn context (`https:` or `http://localhost`).
 */
function isValidRpIdForOrigin(rpId, originUrl) {
    if (!rpId || /[/:\s]/.test(rpId)) {
        return false;
    }
    let parsed;
    try {
        parsed = new URL(originUrl);
    }
    catch {
        return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    const normalizedRpId = rpId.toLowerCase();
    const isSecure = parsed.protocol === 'https:' ||
        (parsed.protocol === 'http:' &&
            (hostname === 'localhost' || hostname === '127.0.0.1'));
    if (!isSecure) {
        return false;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return normalizedRpId === hostname;
    }
    if (/^\d+(?:\.\d+){3}$/.test(hostname) || hostname.startsWith('[')) {
        return false;
    }
    if (!normalizedRpId.includes('.') ||
        normalizedRpId.startsWith('.') ||
        normalizedRpId.endsWith('.') ||
        isPublicSuffixRpId(normalizedRpId)) {
        return false;
    }
    const labels = normalizedRpId.split('.');
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
        return false;
    }
    return hostname === normalizedRpId || hostname.endsWith(`.${normalizedRpId}`);
}
/**
 * Verifies CTAP2 `authenticatorData` length, `rpIdHash`, User Present (`UP`),
 * and (when required) User Verified (`UV`) flags per W3C WebAuthn §7.2.
 */
function verifyAuthenticatorData(authData, rpId, userVerificationRequired) {
    if (authData.length < MIN_AUTHENTICATOR_DATA_BYTES) {
        throw new Error('[SecurityError] Authenticator data is shorter than 37 bytes');
    }
    const expectedRpIdHash = crypto
        .createHash('sha256')
        .update(rpId.toLowerCase(), 'utf8')
        .digest();
    if (!crypto.timingSafeEqual(authData.subarray(0, 32), expectedRpIdHash)) {
        throw new Error('[SecurityError] Authenticator rpIdHash does not match requested rpId');
    }
    const flags = authData[32];
    if ((flags & AUTH_DATA_FLAG_UP) === 0) {
        throw new Error('[NotAllowedError] Authenticator did not assert User Presence (UP)');
    }
    if (userVerificationRequired && (flags & AUTH_DATA_FLAG_UV) === 0) {
        throw new Error('[NotAllowedError] Authenticator did not assert User Verification (UV)');
    }
}
/**
 * Resolves the prebuilt macOS `CoreBluetooth` BLE advert scanner binary path
 * (`Contents/Resources/bin/cable_ble_scanner` in packaged builds, or
 * `<repoRoot>/bin/cable_ble_scanner` in local unpackaged builds).
 */
function resolveCableBleScannerBinaryPath(options) {
    const isPackaged = options?.isPackaged ?? Boolean(electron_1.app?.isPackaged);
    if (isPackaged) {
        const resPath = options?.resourcesPath ?? process.resourcesPath;
        return path.join(resPath, 'bin', 'cable_ble_scanner');
    }
    const appPath = options?.appPath ??
        (typeof electron_1.app?.getAppPath === 'function' ? electron_1.app.getAppPath() : process.cwd());
    return path.join(appPath, 'bin', 'cable_ble_scanner');
}
/**
 * Returns `true` when running on macOS and the prebuilt `cable_ble_scanner`
 * helper binary exists and is executable.
 */
function isCableBleScannerAvailable(options) {
    const platform = options?.platform ?? process.platform;
    if (platform !== 'darwin') {
        return false;
    }
    const binaryPath = options?.binaryPath ?? resolveCableBleScannerBinaryPath(options);
    try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function encodeWebSocketFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
        header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    }
    else if (payload.length <= 0xffff) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
    }
    else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ mask[i & 3];
    }
    return Buffer.concat([header, mask, masked]);
}
/**
 * Establishes a `wss://` WebSocket connection with `Sec-WebSocket-Protocol: fido.cable`.
 */
function connectCableWebSocket(targetUrl, callbacks, requestImpl = https.request) {
    const parsed = new URL(targetUrl);
    const wsKey = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto
        .createHash('sha1')
        .update(wsKey + WEBSOCKET_GUID)
        .digest('base64');
    let socketRef = null;
    let closed = false;
    const req = requestImpl({
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
            Host: parsed.host,
            Upgrade: 'websocket',
            Connection: 'Upgrade',
            'Sec-WebSocket-Key': wsKey,
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Protocol': CABLE_WEBSOCKET_SUBPROTOCOL,
        },
    });
    const cleanup = () => {
        if (closed) {
            return;
        }
        closed = true;
        try {
            req.destroy();
        }
        catch {
            // Ignore destroy errors during teardown.
        }
        if (socketRef) {
            try {
                socketRef.destroy();
            }
            catch {
                // Ignore socket destroy errors.
            }
            socketRef = null;
        }
    };
    req.on('response', (res) => {
        if (!closed) {
            closed = true;
            callbacks.onError(new Error(`caBLEv2 tunnel server returned HTTP ${res.statusCode ?? 'unknown'}`));
        }
    });
    req.on('error', (err) => {
        if (!closed) {
            closed = true;
            callbacks.onError(err);
        }
    });
    req.on('upgrade', (res, socket, head) => {
        if (closed) {
            socket.destroy();
            return;
        }
        const accept = res.headers['sec-websocket-accept'];
        if (accept !== expectedAccept) {
            cleanup();
            callbacks.onError(new Error('Invalid Sec-WebSocket-Accept from tunnel'));
            return;
        }
        const rawSubprotocol = res.headers['sec-websocket-protocol'];
        const subprotocolHeader = Array.isArray(rawSubprotocol)
            ? rawSubprotocol.join(',')
            : (rawSubprotocol ?? '');
        const negotiatedProtocols = subprotocolHeader
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
        if (negotiatedProtocols.length !== 1 ||
            negotiatedProtocols[0] !== CABLE_WEBSOCKET_SUBPROTOCOL) {
            cleanup();
            callbacks.onError(new Error(`Invalid or missing Sec-WebSocket-Protocol from tunnel: "${subprotocolHeader}"`));
            return;
        }
        socketRef = socket;
        let rxBuffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
        let fragmentBuffers = [];
        let fragmentedBytes = 0;
        const conn = {
            send(payload) {
                if (closed || !socketRef) {
                    return;
                }
                socketRef.write(encodeWebSocketFrame(0x02, payload));
            },
            close() {
                if (closed) {
                    return;
                }
                if (socketRef) {
                    try {
                        socketRef.end(encodeWebSocketFrame(0x08, Buffer.alloc(0)));
                    }
                    catch {
                        // Ignore write errors on close.
                    }
                }
                cleanup();
            },
        };
        const parseFrames = () => {
            while (rxBuffer.length >= 2 && !closed) {
                const b0 = rxBuffer[0];
                const b1 = rxBuffer[1];
                const fin = (b0 & 0x80) !== 0;
                const opcode = b0 & 0x0f;
                const masked = (b1 & 0x80) !== 0;
                if (masked) {
                    cleanup();
                    callbacks.onError(new Error('RFC 6455 violation: server-to-client WebSocket frame must not be masked'));
                    return;
                }
                let payloadLen = b1 & 0x7f;
                let headerLen = 2;
                if (payloadLen === 126) {
                    if (rxBuffer.length < 4) {
                        return;
                    }
                    payloadLen = rxBuffer.readUInt16BE(2);
                    headerLen = 4;
                }
                else if (payloadLen === 127) {
                    if (rxBuffer.length < 10) {
                        return;
                    }
                    const bigLen = rxBuffer.readBigUInt64BE(2);
                    if (bigLen > BigInt(exports.MAX_WEBSOCKET_MESSAGE_BYTES)) {
                        cleanup();
                        callbacks.onError(new Error('Oversized WebSocket frame'));
                        return;
                    }
                    payloadLen = Number(bigLen);
                    headerLen = 10;
                }
                if (payloadLen > exports.MAX_WEBSOCKET_MESSAGE_BYTES) {
                    cleanup();
                    callbacks.onError(new Error('Oversized WebSocket frame'));
                    return;
                }
                if (rxBuffer.length < headerLen + payloadLen) {
                    return;
                }
                const payload = Buffer.from(rxBuffer.subarray(headerLen, headerLen + payloadLen));
                rxBuffer = Buffer.from(rxBuffer.subarray(headerLen + payloadLen));
                if (opcode === 0x08) {
                    // Close frame
                    cleanup();
                    callbacks.onClose();
                    return;
                }
                else if (opcode === 0x09) {
                    // Ping -> Pong
                    if (socketRef && !closed) {
                        socketRef.write(encodeWebSocketFrame(0x0a, payload));
                    }
                }
                else if (opcode === 0x01 || opcode === 0x02) {
                    if (fragmentBuffers.length > 0) {
                        cleanup();
                        callbacks.onError(new Error('Interleaved WebSocket data frame during fragmentation'));
                        return;
                    }
                    if (fin) {
                        callbacks.onMessage(payload);
                    }
                    else {
                        fragmentBuffers = [payload];
                        fragmentedBytes = payload.length;
                    }
                }
                else if (opcode === 0x00) {
                    if (fragmentBuffers.length === 0) {
                        cleanup();
                        callbacks.onError(new Error('Unexpected WebSocket continuation frame'));
                        return;
                    }
                    if (fragmentedBytes + payload.length > exports.MAX_WEBSOCKET_MESSAGE_BYTES) {
                        cleanup();
                        callbacks.onError(new Error('Oversized fragmented WebSocket message'));
                        return;
                    }
                    fragmentBuffers.push(payload);
                    fragmentedBytes += payload.length;
                    if (fin) {
                        const full = Buffer.concat(fragmentBuffers);
                        fragmentBuffers = [];
                        fragmentedBytes = 0;
                        callbacks.onMessage(full);
                    }
                }
            }
        };
        socket.on('data', (chunk) => {
            rxBuffer = Buffer.concat([rxBuffer, chunk]);
            parseFrames();
        });
        socket.on('close', () => {
            if (!closed) {
                closed = true;
                callbacks.onClose();
            }
        });
        socket.on('error', (err) => {
            if (!closed) {
                closed = true;
                callbacks.onError(err);
            }
        });
        callbacks.onOpen(conn);
        if (rxBuffer.length > 0) {
            parseFrames();
        }
    });
    req.end();
    return { abort: cleanup };
}
// ---------------------------------------------------------------------------
// QR Code Modal Dialog + End-to-End caBLEv2 Orchestrator
// ---------------------------------------------------------------------------
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const CHROME_CAMERA_ICON_PATH = 'M10 14.83 C11 14.83 11.83 14.49 12.5 13.81 C13.17 13.13 13.5 12.3 13.5 11.33 C13.5 10.37 13.17 9.55 12.5 8.87 C11.83 8.18 11 7.83 10 7.83 C9 7.83 8.17 8.18 7.5 8.87 C6.83 9.55 6.5 10.38 6.5 11.35 C6.5 12.31 6.83 13.13 7.5 13.81 C8.17 14.49 9 14.83 10 14.83 Z M10 13.33 C9.42 13.33 8.94 13.14 8.56 12.75 C8.19 12.36 8 11.88 8 11.31 C8 10.76 8.19 10.29 8.56 9.92 C8.94 9.53 9.42 9.33 10 9.33 C10.58 9.33 11.06 9.53 11.44 9.92 C11.81 10.29 12 10.76 12 11.31 C12 11.88 11.81 12.36 11.44 12.75 C11.06 13.14 10.58 13.33 10 13.33 Z M3.5 17.33 C3.1 17.33 2.74 17.19 2.44 16.89 C2.15 16.59 2 16.23 2 15.83 V6.83 C2 6.43 2.15 6.08 2.44 5.79 C2.74 5.48 3.1 5.33 3.5 5.33 H6 L7.5 3.33 H12.5 L14 5.33 H16.5 C16.92 5.33 17.27 5.48 17.56 5.79 C17.85 6.08 18 6.43 18 6.83 V15.83 C18 16.23 17.85 16.59 17.56 16.89 C17.27 17.19 16.92 17.33 16.5 17.33 H3.5 Z M3.5 15.83 H16.5 V6.83 H13.25 L11.75 4.83 H8.25 L6.75 6.83 H3.5 V15.83 Z';
/**
 * Builds the Chromium CR2023 WebAuthn QR sheet HTML (`Step::kCableV2QRCode` /
 * `AuthenticatorHybridAndSecurityKeySheetView` + `AuthenticatorQrCenteredView`).
 */
function buildCableQrModalHtml(rpId, qrSvg) {
    const safeRpId = escapeHtml(rpId);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>通行密钥</title>
<style>
  :root {
    color-scheme: light dark;
  }
  * {
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: 448px;
    background: transparent;
    overflow: hidden;
    font-family: 'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }
  .sheet-card {
    width: 448px;
    background: #ffffff;
    color: #1f1f1f;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .sheet-content {
    padding: 20px 24px 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sheet-title {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    line-height: 24px;
    text-align: left;
    color: #1f1f1f;
  }
  .mechanism-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 8px;
  }
  .camera-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    margin-top: 2px;
    color: #474747;
  }
  .mechanism-text {
    display: flex;
    flex-direction: column;
  }
  .mechanism-header {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    color: #1f1f1f;
  }
  .mechanism-desc {
    margin: 0;
    font-size: 13px;
    font-weight: 400;
    line-height: 20px;
    color: #474747;
  }
  .qr-centered-view {
    width: 280px;
    height: 280px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sheet-footer {
    padding: 4px 24px 20px 24px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  .cancel-btn {
    appearance: none;
    height: 36px;
    min-width: 64px;
    padding: 0 16px;
    border-radius: 9999px;
    border: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    background: #d3e3fd;
    color: #041e49;
    cursor: pointer;
  }
  .cancel-btn:hover {
    background: #c7dafc;
  }
  .cancel-btn:active {
    background: #bbd2fb;
  }
  @media (prefers-color-scheme: dark) {
    .sheet-card {
      background: #1f1f1f;
      color: #e3e3e3;
      border: 1px solid rgba(255, 255, 255, 0.16);
    }
    .sheet-title,
    .mechanism-header {
      color: #e3e3e3;
    }
    .camera-icon,
    .mechanism-desc {
      color: #c7c7c7;
    }
    .qr-centered-view {
      background: #ffffff;
    }
    .cancel-btn {
      background: #004a77;
      color: #c2e7ff;
    }
    .cancel-btn:hover {
      background: #00578a;
    }
    .cancel-btn:active {
      background: #00639b;
    }
  }
</style>
</head>
<body>
  <div id="sheet-card" class="sheet-card">
    <div class="sheet-content">
      <h1 class="sheet-title">通行密钥</h1>
      <div class="mechanism-row">
        <svg class="camera-icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="${CHROME_CAMERA_ICON_PATH}"/>
        </svg>
        <div class="mechanism-text">
          <p class="mechanism-header">使用你的手机或平板</p>
          <p id="status" class="mechanism-desc">用存有 ${safeRpId} 通行密钥的设备相机扫描此二维码</p>
        </div>
      </div>
      <div class="qr-centered-view">${qrSvg}</div>
    </div>
    <div class="sheet-footer">
      <button type="button" class="cancel-btn" onclick="window.close()">Cancel</button>
    </div>
  </div>
  <script>
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
    });
  </script>
</body>
</html>`;
}
const activeCableAborters = new Map();
const activeSenderCeremonies = new Map();
const lastInputTimestampBySender = new Map();
function buildCableAborterKey(requestId, senderId) {
    return senderId !== undefined ? `${senderId}:${requestId}` : requestId;
}
/**
 * Records a user-activation timestamp (`input-event` / `before-input-event`)
 * for a `<webview>` `WebContents` ID.
 */
function recordWebviewUserActivation(senderId, now = Date.now()) {
    lastInputTimestampBySender.set(senderId, now);
}
const MODAL_DIALOG_WIDTH = 448;
const MODAL_DIALOG_DEFAULT_HEIGHT = 496;
const MODAL_TOP_OFFSET_PX = 12;
function createDefaultModalWindow(rpId, qrSvg, parentWindow, onUserClosed, webviewOffsetInParent) {
    let programmaticClose = false;
    let currentHeight = MODAL_DIALOG_DEFAULT_HEIGHT;
    const validParent = parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined;
    const computePosition = (dialogHeight) => {
        if (!validParent || validParent.isDestroyed()) {
            return null;
        }
        const contentBounds = typeof validParent.getContentBounds === 'function'
            ? validParent.getContentBounds()
            : null;
        if (!contentBounds) {
            return null;
        }
        const anchorX = webviewOffsetInParent && webviewOffsetInParent.width > 0
            ? contentBounds.x + webviewOffsetInParent.x
            : contentBounds.x;
        const anchorY = webviewOffsetInParent && webviewOffsetInParent.height > 0
            ? contentBounds.y + webviewOffsetInParent.y
            : contentBounds.y;
        const anchorWidth = webviewOffsetInParent && webviewOffsetInParent.width > 0
            ? webviewOffsetInParent.width
            : contentBounds.width;
        const x = Math.round(anchorX + (anchorWidth - MODAL_DIALOG_WIDTH) / 2);
        const maxY = Math.max(anchorY, contentBounds.y + contentBounds.height - dialogHeight - 8);
        const y = Math.min(Math.round(anchorY + MODAL_TOP_OFFSET_PX), maxY);
        return { x, y };
    };
    const initialPos = computePosition(currentHeight);
    const win = new electron_1.BrowserWindow({
        width: MODAL_DIALOG_WIDTH,
        height: currentHeight,
        ...(initialPos ? { x: initialPos.x, y: initialPos.y } : {}),
        useContentSize: true,
        frame: false,
        transparent: true,
        hasShadow: true,
        parent: validParent,
        // Keep `modal: false` so macOS does not convert the dialog into a
        // window-centered AppKit sheet or subtract titlebar height; positioning the
        // child window over the `<webview>` matches Chrome's tab-modal WebAuthn UI.
        modal: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        autoHideMenuBar: true,
        show: false,
        title: '通行密钥',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webviewTag: false,
        },
    });
    win.__isWebviewPopupWindow = true;
    const reposition = () => {
        if (win.isDestroyed()) {
            return;
        }
        const pos = computePosition(currentHeight);
        if (pos && typeof win.setPosition === 'function') {
            win.setPosition(pos.x, pos.y);
        }
    };
    if (validParent && typeof validParent.on === 'function') {
        validParent.on('move', reposition);
        validParent.on('resize', reposition);
    }
    win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) {
            return;
        }
        void (async () => {
            try {
                const measured = (await win.webContents.executeJavaScript(`(() => {
            const card = document.getElementById('sheet-card');
            return card ? Math.ceil(card.getBoundingClientRect().height) : 0;
          })()`));
                if (!win.isDestroyed() &&
                    typeof measured === 'number' &&
                    measured >= 400 &&
                    measured <= 720) {
                    currentHeight = measured;
                    if (typeof win.setContentSize === 'function') {
                        win.setContentSize(MODAL_DIALOG_WIDTH, currentHeight);
                    }
                }
            }
            catch {
                // Fall back to default height if measurement fails.
            }
            if (!win.isDestroyed()) {
                reposition();
                win.show();
            }
        })();
    });
    win.on('closed', () => {
        if (validParent &&
            !validParent.isDestroyed() &&
            typeof validParent.off === 'function') {
            validParent.off('move', reposition);
            validParent.off('resize', reposition);
        }
        if (!programmaticClose) {
            onUserClosed();
        }
    });
    const html = buildCableQrModalHtml(rpId, qrSvg);
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return {
        updateStatus(statusText) {
            if (win.isDestroyed()) {
                return;
            }
            const literal = JSON.stringify(statusText);
            void win.webContents
                .executeJavaScript(`(() => { const el = document.getElementById('status'); if (el) el.textContent = ${literal}; })()`)
                .catch(() => { });
        },
        close() {
            programmaticClose = true;
            if (!win.isDestroyed()) {
                win.close();
            }
        },
    };
}
/**
 * Executes a full `caBLEv2` (CTAP 2.2 Hybrid Transport) `authenticatorGetAssertion`
 * ceremony on macOS: displays a QR code modal, scans for matching BLE EID
 * advertisements, connects to the tunnel server, runs the Noise `KNpsk0`
 * handshake, and exchanges the encrypted CTAP2 assertion.
 */
async function performCableGetAssertion(request, origin, deps) {
    if (!request || typeof request.requestId !== 'string' || !request.requestId) {
        throw new Error('[TypeError] Missing WebAuthn requestId');
    }
    const rpId = request.rpId || new URL(origin).hostname;
    if (!isValidRpIdForOrigin(rpId, origin)) {
        throw new Error(`[SecurityError] Invalid WebAuthn rpId "${rpId}" for origin "${origin}"`);
    }
    const { canonicalBase64Url } = canonicalizeWebAuthnChallenge(request.challengeBase64Url, MIN_WEBAUTHN_CHALLENGE_BYTES);
    const { clientDataJSON, clientDataHash } = buildCollectedClientDataJson(canonicalBase64Url, origin, false);
    const allowCredentialIds = (request.allowCredentials ?? []).map((c) => fromBase64Url(c.idBase64Url));
    const userVerificationRequired = request.userVerification !== 'discouraged';
    const strictUvCheck = request.userVerification === 'required';
    const ctapCommandBytes = encodeCtapGetAssertionRequest({
        rpId,
        clientDataHash,
        allowCredentialIds,
        userVerificationRequired,
    });
    const session = deps?.qrSession ?? generateCableQrSession({ hint: 'ga' });
    const qrSvg = (0, qrEncoder_1.renderQrSvg)(session.qrUri);
    const aborterKey = buildCableAborterKey(request.requestId, deps?.senderId);
    let preSpawnCancelled = false;
    activeCableAborters.set(aborterKey, () => {
        preSpawnCancelled = true;
    });
    let scannerBinaryPath;
    try {
        if (deps?.ensureBleScannerBinary) {
            scannerBinaryPath = await deps.ensureBleScannerBinary(deps.userDataPath ?? '');
        }
        else {
            scannerBinaryPath =
                deps?.scannerBinaryPath ?? resolveCableBleScannerBinaryPath();
            if (!deps?.spawnBleScanner &&
                !isCableBleScannerAvailable({ binaryPath: scannerBinaryPath })) {
                throw new Error('[NotAllowedError] Prebuilt macOS BLE scanner helper is unavailable');
            }
        }
    }
    catch (err) {
        activeCableAborters.delete(aborterKey);
        throw err;
    }
    if (preSpawnCancelled) {
        activeCableAborters.delete(aborterKey);
        throw new Error('[AbortError] Passkey sign-in was cancelled');
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        let scannerProc = null;
        let wsAborter = null;
        let wsConn = null;
        let tunnelStarted = false;
        let modal = null;
        const timeoutMs = Math.max(15000, Math.min(request.timeoutMs ?? 120000, 180000));
        const cleanupAll = () => {
            activeCableAborters.delete(aborterKey);
            clearTimeout(timer);
            if (scannerProc) {
                try {
                    scannerProc.kill('SIGTERM');
                }
                catch {
                    // Ignore kill errors.
                }
                scannerProc = null;
            }
            if (wsConn) {
                try {
                    wsConn.close();
                }
                catch {
                    // Ignore close errors.
                }
                wsConn = null;
            }
            if (wsAborter) {
                wsAborter.abort();
                wsAborter = null;
            }
            if (modal) {
                modal.close();
                modal = null;
            }
        };
        const fail = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupAll();
            reject(err);
        };
        const succeed = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupAll();
            resolve(result);
        };
        const timer = setTimeout(() => {
            fail(new Error('[NotAllowedError] Passkey sign-in timed out'));
        }, timeoutMs);
        activeCableAborters.set(aborterKey, () => {
            fail(new Error('[AbortError] Passkey sign-in was cancelled'));
        });
        if (!deps?.isHeadless) {
            const createModal = deps?.createModalWindow ?? createDefaultModalWindow;
            modal = createModal(rpId, qrSvg, deps?.parentWindow, () => {
                fail(new Error('[NotAllowedError] Passkey sign-in cancelled by user'));
            }, deps?.webviewOffsetInParent);
        }
        const startTunnelForEid = (components) => {
            if (tunnelStarted || settled) {
                return;
            }
            tunnelStarted = true;
            if (scannerProc) {
                try {
                    scannerProc.kill('SIGTERM');
                }
                catch {
                    // Ignore kill errors once EID is matched.
                }
                scannerProc = null;
            }
            modal?.updateStatus('正在连接你的设备…');
            const psk = deriveCableKey(session.qrSecret, components.decryptedEid, CableKeyPurpose.PSK, PSK_SIZE);
            const handshake = new NoiseKNpsk0Initiator(psk, session.identityPrivateKey);
            const initialHandshakeMsg = handshake.buildInitialMessage();
            const tunnelUrl = buildCableTunnelConnectUrl(components, session.tunnelId);
            let handshakeCompleted = false;
            let postHandshakeReceived = false;
            let crypter = null;
            const connectWs = deps?.connectWebSocket ?? connectCableWebSocket;
            wsAborter = connectWs(tunnelUrl, {
                onOpen(conn) {
                    wsConn = conn;
                    conn.send(initialHandshakeMsg);
                },
                onMessage(framePayload) {
                    if (settled) {
                        return;
                    }
                    try {
                        if (!handshakeCompleted) {
                            const hsResult = handshake.processResponse(framePayload);
                            crypter = new CableCrypter(hsResult.readKey, hsResult.writeKey);
                            handshakeCompleted = true;
                            return;
                        }
                        if (!crypter) {
                            throw new Error('Missing caBLEv2 crypter after handshake');
                        }
                        const decrypted = crypter.decrypt(framePayload);
                        if (!decrypted || decrypted.length === 0) {
                            throw new Error('Failed to decrypt caBLEv2 tunnel frame');
                        }
                        if (!postHandshakeReceived) {
                            // The first encrypted frame from the authenticator is the CBOR
                            // post-handshake message containing getInfoResponse.
                            const { value: postHsMap } = decodeCbor(decrypted);
                            if (!(postHsMap instanceof Map) || !postHsMap.has(1)) {
                                throw new Error('Invalid caBLEv2 post-handshake CBOR map');
                            }
                            postHandshakeReceived = true;
                            modal?.updateStatus('请在你的设备上验证以继续…');
                            const ctapFrame = Buffer.concat([
                                Buffer.from([CableMessageType.CTAP]),
                                ctapCommandBytes,
                            ]);
                            wsConn?.send(crypter.encrypt(ctapFrame));
                            return;
                        }
                        const msgType = decrypted[0];
                        const msgBody = decrypted.subarray(1);
                        if (msgType === CableMessageType.UPDATE) {
                            // Optional linking update message; ignore since state-assisted
                            // linking is disabled in our QR payload.
                            return;
                        }
                        if (msgType === CableMessageType.SHUTDOWN) {
                            fail(new Error('[NotAllowedError] caBLEv2 connection shut down by authenticator'));
                            return;
                        }
                        if (msgType !== CableMessageType.CTAP) {
                            return;
                        }
                        const parsed = decodeCtapGetAssertionResponse(msgBody);
                        verifyAuthenticatorData(parsed.authenticatorData, rpId, strictUvCheck);
                        const resolvedCredId = parsed.credentialId ??
                            (allowCredentialIds.length === 1 ? allowCredentialIds[0] : null);
                        if (!resolvedCredId) {
                            throw new Error('CTAP2 assertion response omitted credential ID');
                        }
                        try {
                            wsConn?.send(crypter.encrypt(Buffer.from([CableMessageType.SHUTDOWN])));
                        }
                        catch {
                            // Ignore shutdown frame send errors after receiving assertion.
                        }
                        const idStr = toBase64Url(resolvedCredId);
                        succeed({
                            id: idStr,
                            rawIdBase64Url: idStr,
                            clientDataJSONBase64Url: toBase64Url(clientDataJSON),
                            authenticatorDataBase64Url: toBase64Url(parsed.authenticatorData),
                            signatureBase64Url: toBase64Url(parsed.signature),
                            userHandleBase64Url: parsed.userHandle
                                ? toBase64Url(parsed.userHandle)
                                : null,
                        });
                    }
                    catch (err) {
                        fail(err instanceof Error ? err : new Error(String(err)));
                    }
                },
                onClose() {
                    if (!settled) {
                        fail(new Error('[NotAllowedError] caBLEv2 tunnel closed before assertion completed'));
                    }
                },
                onError(err) {
                    fail(err);
                },
            });
        };
        const spawnScanner = deps?.spawnBleScanner ??
            ((bin) => (0, child_process_1.spawn)(bin, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
            }));
        if (settled) {
            return;
        }
        scannerProc = spawnScanner(scannerBinaryPath);
        scannerProc.stderr?.resume();
        let stdoutRemainder = '';
        scannerProc.stdout?.on('data', (chunk) => {
            if (settled || tunnelStarted) {
                return;
            }
            stdoutRemainder += chunk.toString('utf8');
            const lines = stdoutRemainder.split('\n');
            stdoutRemainder = lines.pop() ?? '';
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (line.startsWith('EID:')) {
                    const hex = line.slice(4);
                    if (hex.length >= 40 && /^[0-9a-fA-F]+$/.test(hex)) {
                        const advertBytes = Buffer.from(hex, 'hex');
                        const components = decryptCableEid(advertBytes, session.eidKey);
                        if (components) {
                            startTunnelForEid(components);
                            return;
                        }
                    }
                }
                else if (line.startsWith('ERROR:')) {
                    fail(new Error(`[NotAllowedError] Bluetooth scanner error (${line.slice(6)})`));
                    return;
                }
            }
        });
        scannerProc.on('error', (err) => {
            if (!tunnelStarted) {
                fail(err);
            }
        });
        scannerProc.on('close', (code) => {
            if (!tunnelStarted && !settled) {
                fail(new Error(`[NotAllowedError] Bluetooth scanner exited unexpectedly (code ${code ?? 'null'})`));
            }
        });
    });
}
let cableIpcRegistered = false;
/**
 * Returns `'webview'` for `<webview>` guests, the tab state for registered
 * `WebContentsView` tabs, or `null` for senders that may not use `caBLEv2`.
 */
function resolveCableBrowserGuest(sender, resolveWcvTab) {
    if (!sender || typeof sender.getType !== 'function') {
        return null;
    }
    if (sender.getType() === 'webview') {
        return 'webview';
    }
    return resolveWcvTab?.(sender.id) ?? null;
}
/**
 * Registers main-process IPC handlers for `<webview>` `caBLEv2` WebAuthn
 * assertions. Safe to call multiple times (idempotent).
 */
function registerCableWebAuthnIpcHandlers(options) {
    if (cableIpcRegistered) {
        return;
    }
    cableIpcRegistered = true;
    const checkScannerAvailable = options?.isScannerAvailable ?? isCableBleScannerAvailable;
    const runAssertion = options?.performAssertion ?? performCableGetAssertion;
    // Report caBLE as unavailable to senders the assertion handler would reject,
    // so the guest preload falls back to native WebAuthn instead of failing.
    electron_1.ipcMain.handle(exports.WEBAUTHN_CABLE_AVAILABLE_CHANNEL, (event) => resolveCableBrowserGuest(event?.sender, options?.resolveWcvTab)
        ? checkScannerAvailable({ platform: options?.platform })
        : false);
    electron_1.ipcMain.handle(exports.WEBAUTHN_CABLE_GET_ASSERTION_CHANNEL, async (event, request) => {
        const platform = options?.platform ?? process.platform;
        if (platform !== 'darwin') {
            throw new Error('[NotAllowedError] caBLEv2 hybrid transport is only supported on macOS');
        }
        if (!request ||
            typeof request.requestId !== 'string' ||
            !request.requestId) {
            throw new Error('[TypeError] Missing WebAuthn requestId');
        }
        const sender = event.sender;
        if (!sender ||
            (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
            throw new Error('[NotAllowedError] Sender WebContents is destroyed');
        }
        const browserGuest = resolveCableBrowserGuest(sender, options?.resolveWcvTab);
        if (!browserGuest) {
            throw new Error('[SecurityError] WebAuthn caBLEv2 IPC is restricted to built-in browser guests');
        }
        const senderFrame = event.senderFrame;
        if (!senderFrame || senderFrame !== sender.mainFrame) {
            throw new Error('[SecurityError] WebAuthn caBLEv2 IPC is restricted to the top-level frame');
        }
        const origin = senderFrame.origin;
        if (!origin || origin === 'null') {
            throw new Error('[SecurityError] WebAuthn caBLEv2 requires a non-opaque origin');
        }
        const rpId = request.rpId || new URL(origin).hostname;
        if (!isValidRpIdForOrigin(rpId, origin)) {
            throw new Error(`[SecurityError] Invalid WebAuthn rpId "${rpId}" for origin "${origin}"`);
        }
        if (typeof sender.getVisibilityState === 'function' &&
            sender.getVisibilityState() === 'hidden') {
            throw new Error('[NotAllowedError] WebAuthn caBLEv2 requires a visible <webview>');
        }
        // Parked `WebContentsView` tabs stay attached and report `visible`, so
        // consult the registry: a hidden or agent-driven tab must not open a QR
        // prompt over the tab the user is looking at.
        if (browserGuest !== 'webview' &&
            (!browserGuest.visible || browserGuest.isAgentStepActive)) {
            throw new Error('[NotAllowedError] WebAuthn caBLEv2 requires the visible, user-controlled browser tab');
        }
        const isFocused = typeof sender.isFocused === 'function' ? sender.isFocused() : true;
        const lastInputAt = lastInputTimestampBySender.get(sender.id) ?? 0;
        const hasRecentInput = Date.now() - lastInputAt <= USER_ACTIVATION_WINDOW_MS;
        if (!isFocused && !hasRecentInput) {
            throw new Error('[NotAllowedError] WebAuthn caBLEv2 requires a focused <webview> or recent user interaction');
        }
        const senderId = sender.id;
        if (activeSenderCeremonies.has(senderId)) {
            throw new Error('[NotAllowedError] A WebAuthn ceremony is already active for this frame');
        }
        activeSenderCeremonies.set(senderId, request.requestId);
        const abortCeremony = () => {
            cancelCableGetAssertion(request.requestId, senderId);
        };
        const onDidStartNavigation = (_navEvent, _url, isInPlace, isMainFrame) => {
            if (isMainFrame !== false && !isInPlace) {
                abortCeremony();
            }
        };
        if (typeof sender.on === 'function') {
            sender.on('destroyed', abortCeremony);
            sender.on('render-process-gone', abortCeremony);
            sender.on('did-start-navigation', onDidStartNavigation);
            sender.on('did-navigate', abortCeremony);
        }
        try {
            const hostContents = sender.hostWebContents ?? sender;
            const isPopupWindow = (w) => Boolean(w &&
                w
                    .__isWebviewPopupWindow);
            const fromHost = typeof electron_1.BrowserWindow.fromWebContents === 'function'
                ? electron_1.BrowserWindow.fromWebContents(hostContents)
                : null;
            // Static `BrowserWindow` focus/list lookups never return the Hub's
            // `BaseWindow`, so fall back through the Hub window registry.
            const parentWindow = (fromHost && !isPopupWindow(fromHost) ? fromHost : null) ??
                (0, utils_1.resolveHubWindowFromWebContents)(sender) ??
                (0, utils_1.getFocusedHubWindow)() ??
                (0, utils_1.getHubWindows)()[0] ??
                null;
            let webviewOffsetInParent = null;
            if (sender.hostWebContents &&
                (typeof sender.hostWebContents.isDestroyed !== 'function' ||
                    !sender.hostWebContents.isDestroyed()) &&
                typeof sender.hostWebContents.executeJavaScript === 'function') {
                try {
                    const guestId = Number(sender.id);
                    const probe = (await sender.hostWebContents.executeJavaScript(`(() => {
                const wvs = Array.from(document.querySelectorAll('webview'));
                const target = wvs.find((w) => {
                  try {
                    return typeof w.getWebContentsId === 'function' && w.getWebContentsId() === ${guestId};
                  } catch {
                    return false;
                  }
                });
                if (!target) {
                  return { found: false, hidden: true, x: 0, y: 0, width: 0, height: 0 };
                }
                const cs = getComputedStyle(target);
                const r = target.getBoundingClientRect();
                const hidden =
                  cs.display === 'none' ||
                  cs.visibility === 'hidden' ||
                  r.width <= 0 ||
                  r.height <= 0;
                return {
                  found: true,
                  hidden,
                  x: Math.round(r.left),
                  y: Math.round(r.top),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                };
              })()`));
                    if (!probe ||
                        probe.found === false ||
                        probe.hidden === true ||
                        probe.width <= 0 ||
                        probe.height <= 0) {
                        throw new Error('[NotAllowedError] WebAuthn caBLEv2 requires a visible <webview>');
                    }
                    webviewOffsetInParent = {
                        x: probe.x,
                        y: probe.y,
                        width: probe.width,
                        height: probe.height,
                    };
                }
                catch (err) {
                    if (err instanceof Error &&
                        err.message.startsWith('[NotAllowedError]')) {
                        throw err;
                    }
                    // Fall back to centering within parentWindow content bounds only if
                    // hostWebContents.executeJavaScript threw an unexpected IPC error.
                }
            }
            return await runAssertion(request, origin, {
                senderId,
                parentWindow,
                webviewOffsetInParent,
                isHeadless: process.env.ELECTRON_OZONE_PLATFORM_HINT === 'headless',
            });
        }
        finally {
            activeSenderCeremonies.delete(senderId);
            if (typeof sender.off === 'function' &&
                (typeof sender.isDestroyed !== 'function' || !sender.isDestroyed())) {
                sender.off('destroyed', abortCeremony);
                sender.off('render-process-gone', abortCeremony);
                sender.off('did-start-navigation', onDidStartNavigation);
                sender.off('did-navigate', abortCeremony);
            }
        }
    });
    electron_1.ipcMain.handle(exports.WEBAUTHN_CABLE_CANCEL_ASSERTION_CHANNEL, (event, requestId) => {
        if (typeof requestId === 'string' && requestId) {
            cancelCableGetAssertion(requestId, event.sender?.id);
        }
    });
}
/** Cancels an in-flight `caBLEv2` assertion identified by `requestId` (and optional `senderId`). */
function cancelCableGetAssertion(requestId, senderId) {
    const key = buildCableAborterKey(requestId, senderId);
    const aborter = activeCableAborters.get(key);
    if (aborter) {
        aborter();
    }
}
/** Resets IPC registration and active ceremony maps (for unit testing only). */
function resetCableWebAuthnIpcStateForTesting() {
    cableIpcRegistered = false;
    activeCableAborters.clear();
    activeSenderCeremonies.clear();
    lastInputTimestampBySender.clear();
}
