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
exports.makeTestCert = makeTestCert;
exports.makeTestCerts = makeTestCerts;
/**
 * Test-only TLS material, generated in memory at test time so that no private
 * key is ever committed. Each call makes a fresh P-256 key and a self-signed
 * certificate for `localhost` / `127.0.0.1`.
 *
 * The certificate is DER-encoded by hand (a few fixed fields) and signed with
 * node:crypto, so tests need neither an `openssl` binary nor an X.509 package.
 * These keys protect nothing; never use this outside tests.
 */
const crypto = __importStar(require("node:crypto"));
const OID_ECDSA_WITH_SHA256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];
const OID_COMMON_NAME = [0x55, 0x04, 0x03];
const OID_ORGANIZATION = [0x55, 0x04, 0x0a];
const OID_SUBJECT_ALT_NAME = [0x55, 0x1d, 0x11];
const OID_BASIC_CONSTRAINTS = [0x55, 0x1d, 0x13];
/** One DER TLV with a definite length. */
function der(tag, ...content) {
    const body = Buffer.concat(content);
    let header;
    if (body.length < 0x80) {
        header = [tag, body.length];
    }
    else if (body.length < 0x100) {
        header = [tag, 0x81, body.length];
    }
    else {
        header = [tag, 0x82, body.length >> 8, body.length & 0xff];
    }
    return Buffer.concat([Buffer.from(header), body]);
}
const seq = (...c) => der(0x30, ...c);
const set = (...c) => der(0x31, ...c);
const oid = (bytes) => der(0x06, Buffer.from(bytes));
const utf8 = (s) => der(0x0c, Buffer.from(s, 'utf8'));
const octets = (b) => der(0x04, b);
const TRUE = der(0x01, Buffer.from([0xff]));
/** A positive INTEGER from big-endian bytes. */
function integer(bytes) {
    return der(0x02, bytes[0] & 0x80 ? Buffer.from([0]) : Buffer.alloc(0), bytes);
}
/** UTCTime through 2049, GeneralizedTime after (RFC 5280 4.1.2.5). */
function time(date) {
    const stamp = date.toISOString().replace(/[-:T]|\.\d+/g, ''); // YYYYMMDDHHMMSSZ
    return date.getUTCFullYear() < 2050
        ? der(0x17, Buffer.from(stamp.slice(2), 'ascii'))
        : der(0x18, Buffer.from(stamp, 'ascii'));
}
function name(organization) {
    return seq(set(seq(oid(OID_COMMON_NAME), utf8('localhost'))), set(seq(oid(OID_ORGANIZATION), utf8(organization))));
}
/** A fresh P-256 key and a self-signed certificate for it. */
function makeTestCert(options) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
    });
    const signatureAlgorithm = seq(oid(OID_ECDSA_WITH_SHA256));
    const subject = name(options.organization);
    const serial = crypto.randomBytes(16);
    serial[0] &= 0x7f; // positive
    serial[0] |= 0x40; // and never shortened by a leading zero byte
    const extensions = seq(
    // basicConstraints, critical: CA:TRUE (what `openssl req -x509` emits).
    seq(oid(OID_BASIC_CONSTRAINTS), TRUE, octets(seq(TRUE))), 
    // subjectAltName: DNS:localhost, IP:127.0.0.1
    seq(oid(OID_SUBJECT_ALT_NAME), octets(seq(der(0x82, Buffer.from('localhost', 'ascii')), der(0x87, Buffer.from([127, 0, 0, 1]))))));
    const tbs = seq(der(0xa0, integer(Buffer.from([2]))), // v3
    integer(serial), signatureAlgorithm, subject, // issuer: self-signed
    seq(time(options.notBefore), time(options.notAfter)), subject, publicKey.export({ type: 'spki', format: 'der' }), der(0xa3, extensions));
    const signature = crypto.sign('sha256', tbs, privateKey); // DER ECDSA-Sig
    const certDer = seq(tbs, signatureAlgorithm, der(0x03, Buffer.from([0]), signature));
    const base64 = certDer.toString('base64').match(/.{1,64}/g) ?? [];
    return {
        cert: `-----BEGIN CERTIFICATE-----\n${base64.join('\n')}\n-----END CERTIFICATE-----\n`,
        key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
}
const utc = (year, month = 1) => new Date(Date.UTC(year, month - 1, 1));
/**
 * The certificates the actuator tests use:
 * - `valid`: valid 2025-01-01 to 2125-01-01 (the pinned certificate in tests).
 * - `other`: valid, but a different self-signed certificate (never pinned).
 * - `expired`: expired 2020-02-01 (exercises the pinned-certificate fallback).
 */
function makeTestCerts() {
    return {
        valid: makeTestCert({
            organization: 'hub endpoint test valid',
            notBefore: utc(2025),
            notAfter: utc(2125),
        }),
        other: makeTestCert({
            organization: 'hub endpoint test other',
            notBefore: utc(2025),
            notAfter: utc(2125),
        }),
        expired: makeTestCert({
            organization: 'hub endpoint test expired',
            notBefore: utc(2020),
            notAfter: utc(2020, 2),
        }),
    };
}
