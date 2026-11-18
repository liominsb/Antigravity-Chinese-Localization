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
exports.PairingStore = exports.NonceCache = exports.MAX_NONCES = exports.PROOF_CONTEXT = void 0;
exports.sdpFingerprint = sdpFingerprint;
exports.proofMessage = proofMessage;
exports.deviceId = deviceId;
exports.verifyDeviceProof = verifyDeviceProof;
exports.sanitizeLabel = sanitizeLabel;
exports.logLabel = logLabel;
/**
 * Remote viewer device pairing (P3-2, rt-security R2): a viewer device is an
 * ECDSA P-256 key. Every offer carries a proof, a signature over
 *
 *   "agy-computer-view-v1\n" + nonce + "\n" + root_conversation_id + "\n" +
 *   <the offer SDP's a=fingerprint value>
 *
 * so the DTLS endpoint the host will accept belongs to a device the user
 * paired once on this Mac (a local, non-activating prompt). The LS does not
 * check the signature; the host is the only authority.
 *
 * Node-only, no Electron.
 */
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.PROOF_CONTEXT = 'agy-computer-view-v1';
const MAX_SPKI_B64 = 1024;
const MAX_SIG_B64 = 1024;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_LABEL = 64;
/** Nonces remembered for replay protection. */
exports.MAX_NONCES = 4096;
/** The single `a=fingerprint:` value of an SDP (e.g. "sha-256 AB:CD:..."). */
function sdpFingerprint(sdp) {
    const values = new Set();
    for (const line of sdp.split(/\r?\n/)) {
        if (line.startsWith('a=fingerprint:')) {
            values.add(line.slice('a=fingerprint:'.length).trim());
        }
    }
    if (values.size !== 1) {
        return undefined;
    }
    const v = [...values][0];
    return /^sha-256 ([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(v)
        ? v
        : undefined;
}
/** The bytes a device signs. */
function proofMessage(nonce, rootConversationId, fingerprint) {
    return Buffer.from(`${exports.PROOF_CONTEXT}\n${nonce}\n${rootConversationId}\n${fingerprint}`, 'utf8');
}
/** A stable device id: sha256 of the SPKI DER, hex. */
function deviceId(spki) {
    return crypto.createHash('sha256').update(spki).digest('hex');
}
/** Checks a device proof (key type, nonce shape, signature). */
function verifyDeviceProof(d, rootConversationId, fingerprint) {
    if (!d) {
        return { ok: false, error: 'no device proof' };
    }
    if (!d.publicKeySpki ||
        d.publicKeySpki.length > MAX_SPKI_B64 ||
        !d.signature ||
        d.signature.length > MAX_SIG_B64) {
        return { ok: false, error: 'bad device key or signature size' };
    }
    if (!NONCE.test(d.nonce)) {
        return { ok: false, error: 'bad nonce' };
    }
    let spki;
    let key;
    try {
        spki = Buffer.from(d.publicKeySpki, 'base64');
        key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    }
    catch {
        return { ok: false, error: 'bad device key' };
    }
    if (key.asymmetricKeyType !== 'ec' ||
        key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        return { ok: false, error: 'the device key must be ECDSA P-256' };
    }
    let ok = false;
    try {
        ok = crypto.verify('sha256', proofMessage(d.nonce, rootConversationId, fingerprint), { key, dsaEncoding: 'der' }, Buffer.from(d.signature, 'base64'));
    }
    catch {
        ok = false;
    }
    if (!ok) {
        return { ok: false, error: 'the device proof does not verify' };
    }
    return {
        ok: true,
        deviceId: deviceId(spki),
        label: sanitizeLabel(d.label),
        spki,
    };
}
/** A display label: no control/format characters, <= 64 characters. */
function sanitizeLabel(raw) {
    // Labels come off the wire: anything but a string is no label.
    const s = [...(typeof raw === 'string' ? raw : '')]
        .filter((c) => !/[\p{Cc}\p{Cf}]/u.test(c))
        .join('')
        .trim();
    const chars = [...s];
    return ((chars.length > MAX_LABEL ? chars.slice(0, MAX_LABEL) : chars).join('') ||
        'Unnamed device');
}
/** A device label for logs: sanitized, <= 32 code points, JSON-quoted. */
function logLabel(raw) {
    return JSON.stringify([...sanitizeLabel(raw)].slice(0, 32).join(''));
}
/** Rejects a nonce seen before (until its expiry). */
class NonceCache {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.seen = new Map();
    }
    /** False if the nonce was already used and has not expired. */
    use(nonce, expiresAtMs) {
        const now = this.now();
        for (const [n, exp] of this.seen) {
            if (exp <= now) {
                this.seen.delete(n);
            }
        }
        if (this.seen.has(nonce)) {
            return false;
        }
        this.seen.set(nonce, Math.max(expiresAtMs, now + 60000));
        while (this.seen.size > exports.MAX_NONCES) {
            const oldest = this.seen.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.seen.delete(oldest);
        }
        return true;
    }
}
exports.NonceCache = NonceCache;
/** The paired devices (a JSON file, mode 0600); revocable per device. */
class PairingStore {
    constructor(file, now = () => Date.now()) {
        this.file = file;
        this.now = now;
    }
    list() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (!Array.isArray(raw.devices)) {
                return [];
            }
            return raw.devices.filter((d) => !!d &&
                typeof d.deviceId === 'string' &&
                /^[0-9a-f]{64}$/.test(d.deviceId));
        }
        catch {
            return [];
        }
    }
    isPaired(id) {
        return this.list().some((d) => d.deviceId === id);
    }
    pair(id, label) {
        const devices = this.list().filter((d) => d.deviceId !== id);
        devices.push({ deviceId: id, label, pairedAtMs: this.now() });
        this.write(devices);
    }
    revoke(id) {
        const before = this.list();
        const after = before.filter((d) => d.deviceId !== id);
        if (after.length === before.length) {
            return false;
        }
        this.write(after);
        return true;
    }
    /** Atomic: a temp file (0600, fsynced) renamed over the store. */
    write(devices) {
        const dir = path.dirname(this.file);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tmp = path.join(dir, `.${path.basename(this.file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
        const fd = fs.openSync(tmp, 'w', 0o600);
        try {
            fs.writeSync(fd, JSON.stringify({ devices }, null, 2));
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, this.file);
    }
}
exports.PairingStore = PairingStore;
