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
exports.PinnedTlsDuplex = exports.LS_HOST = exports.CSRF_HEADER = void 0;
exports.certFingerprint256 = certFingerprint256;
exports.decideTlsTrust = decideTlsTrust;
exports.createPinnedConnection = createPinnedConnection;
exports.csrfInterceptor = csrfInterceptor;
exports.nodeTransportFactory = nodeTransportFactory;
/**
 * connect-node transport from the Hub main process to the language server's
 * ActuatorService (actuator contract §4.1).
 *
 * - TLS: the LS serves its bundled self-signed certificate on 127.0.0.1. That
 *   certificate is the only trust anchor. Verification is normal, except that
 *   an expired / not-yet-valid error is tolerated when the server presents
 *   exactly the pinned certificate (the LS rotates it on a schedule, and the
 *   user's clock may be off). Every other failure (unknown issuer, hostname
 *   mismatch, a different self-signed certificate) closes the connection.
 *   Verification is never disabled (rt P3-16).
 * - Adds the admin CSRF header on every call.
 * - onPortChanged: transports are per port; building one for a new port
 *   closes the HTTP/2 session of the previous port.
 */
const crypto = __importStar(require("node:crypto"));
const node_stream_1 = require("node:stream");
const tls = __importStar(require("node:tls"));
const connect_node_1 = require("@connectrpc/connect-node");
const pinnedLsCert_1 = require("./pinnedLsCert");
/** Header checked by the LS csrf_interceptor (admin token). */
exports.CSRF_HEADER = 'x-codeium-csrf-token';
exports.LS_HOST = '127.0.0.1';
/** The only verification errors the pinned certificate may override. */
const PIN_FALLBACK_ERRORS = new Set([
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
]);
/** SHA-256 fingerprint of a PEM certificate, in Node's `AA:BB:...` form. */
function certFingerprint256(pem) {
    return new crypto.X509Certificate(pem).fingerprint256.toUpperCase();
}
/**
 * Decides whether a finished TLS handshake may be used. `authorized` and
 * `authorizationError` are the socket's own verification against the pinned
 * trust anchor.
 */
function decideTlsTrust(handshake, pinnedFingerprints) {
    if (handshake.authorized) {
        return { ok: true, viaPinFallback: false };
    }
    const err = handshake.authorizationError;
    const code = typeof err === 'string'
        ? err
        : (err?.code ??
            err?.message ??
            'UNKNOWN');
    if (!PIN_FALLBACK_ERRORS.has(code)) {
        return { ok: false, reason: `TLS verification failed: ${code}` };
    }
    const peer = (handshake.peerFingerprint256 ?? '').toUpperCase();
    if (peer && pinnedFingerprints.includes(peer)) {
        return { ok: true, viaPinFallback: true };
    }
    return {
        ok: false,
        reason: `TLS verification failed: ${code} and the certificate is not the pinned LS certificate`,
    };
}
/**
 * A Duplex over a TLS socket that only becomes readable/writable (and only
 * emits 'connect') after {@link decideTlsTrust} accepted the handshake, so the
 * HTTP/2 preface and the CSRF header never reach an untrusted peer.
 *
 * Node's http2 can't be handed a raw TLSSocket that is destroyed from a
 * 'secureConnect' listener (its own listener then runs on the dead socket and
 * aborts the process), hence the wrapper: http2 waits for this stream's
 * 'connect', and a rejected handshake surfaces as a stream error instead.
 */
class PinnedTlsDuplex extends node_stream_1.Duplex {
    constructor(opts) {
        super();
        /** Read by http2 to decide whether to wait for 'connect'. */
        this.connecting = true;
        const pinnedFingerprints = opts.pinnedCertsPem.map(certFingerprint256);
        const socket = tls.connect({
            host: opts.host,
            port: opts.port,
            ca: [...opts.pinnedCertsPem],
            ALPNProtocols: ['h2'],
            // Verified below: an expired pinned certificate must remain usable,
            // and nothing is written before the verdict.
            rejectUnauthorized: false,
        });
        this.socket = socket;
        socket.on('error', (err) => this.destroy(err));
        socket.once('secureConnect', () => {
            const verdict = decideTlsTrust({
                authorized: socket.authorized,
                authorizationError: socket.authorizationError,
                peerFingerprint256: socket.getPeerCertificate()?.fingerprint256,
            }, pinnedFingerprints);
            if (!verdict.ok) {
                opts.log?.(`[ActuatorTransport] ${verdict.reason}`);
                this.destroy(new Error(verdict.reason));
                return;
            }
            if (verdict.viaPinFallback) {
                opts.log?.(`[ActuatorTransport] accepted the pinned LS certificate despite ${String(socket.authorizationError)}`);
            }
            this.connecting = false;
            socket.on('data', (chunk) => {
                if (!this.push(chunk)) {
                    socket.pause();
                }
            });
            socket.on('end', () => this.push(null));
            socket.on('close', () => this.destroy());
            this.emit('connect');
        });
    }
    _read() {
        if (!this.connecting) {
            this.socket.resume();
        }
    }
    _write(chunk, encoding, callback) {
        this.socket.write(chunk, encoding, callback);
    }
    _final(callback) {
        this.socket.end();
        callback();
    }
    _destroy(error, callback) {
        this.socket.destroy();
        callback(error);
    }
    setNoDelay(noDelay) {
        this.socket.setNoDelay(noDelay);
        return this;
    }
}
exports.PinnedTlsDuplex = PinnedTlsDuplex;
/** Opens a {@link PinnedTlsDuplex} (http2 `createConnection`). */
function createPinnedConnection(opts) {
    return new PinnedTlsDuplex(opts);
}
/** Interceptor that adds the admin CSRF token. */
function csrfInterceptor(getToken) {
    return (next) => async (req) => {
        req.header.set(exports.CSRF_HEADER, getToken());
        return next(req);
    };
}
/**
 * Returns a transport factory for `ActuatorClientOptions.transportFactory`.
 * Each call reads the current port; a new port aborts the previous port's
 * HTTP/2 session, and `close()` aborts the current one.
 */
function nodeTransportFactory(opts) {
    const host = opts.host ?? exports.LS_HOST;
    const pinned = opts.pinnedCertsPem ?? pinnedLsCert_1.PINNED_LS_CERTS_PEM;
    let current;
    const factory = () => {
        const port = opts.getPort();
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error(`invalid language server port: ${port}`);
        }
        const baseUrl = `https://${host}:${port}`;
        if (!current || current.port !== port) {
            current?.manager.abort(new Error('language server port changed'));
            current = {
                port,
                manager: new connect_node_1.Http2SessionManager(baseUrl, { pingIntervalMs: 15000, pingTimeoutMs: 10000 }, {
                    createConnection: () => createPinnedConnection({
                        host,
                        port,
                        pinnedCertsPem: pinned,
                        log: opts.log,
                    }),
                }),
            };
        }
        return (0, connect_node_1.createConnectTransport)({
            baseUrl,
            httpVersion: '2',
            useBinaryFormat: true,
            sessionManager: current.manager,
            interceptors: [csrfInterceptor(opts.getCsrfToken)],
        });
    };
    return Object.assign(factory, {
        close: () => {
            current?.manager.abort(new Error('actuator transport closed'));
            current = undefined;
        },
    });
}
