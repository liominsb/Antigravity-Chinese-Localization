"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sshProxyConfig = sshProxyConfig;
exports.routeSessionThroughSsh = routeSessionThroughSsh;
exports.trustLoopbackCertificate = trustLoopbackCertificate;
exports.transportPartitionFor = transportPartitionFor;
exports.sidecarPartitionFor = sidecarPartitionFor;
exports.openTransport = openTransport;
/**
 * Routes Electron sessions through an SSH connection's SOCKS proxy
 * (`ssh -D`): every request, 127.0.0.1 included, exits on the remote host, and
 * none falls back to a direct connection.
 */
const electron_1 = require("electron");
const redirects_1 = require("../redirects");
const isPort = (port) => typeof port === 'number' &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536;
/** Checked as text, so no URL parser can read another host into it. */
function checkTransportUrl(url) {
    const m = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\//.exec(url);
    if (m === null || !isPort(Number(m[1]))) {
        // Not echoed: a URL can carry secrets.
        throw new Error('The SSH transport only fetches http://127.0.0.1:<port>/ URLs.');
    }
}
/** `<-loopback>` drops Chromium's implicit bypass of loopback hosts. */
function sshProxyConfig(socksPort) {
    // An invalid port must never leave the session without a proxy.
    if (!isPort(socksPort)) {
        throw new Error(`Invalid SOCKS port: ${String(socksPort)}`);
    }
    return {
        mode: 'fixed_servers',
        proxyRules: `socks5://127.0.0.1:${socksPort}`,
        proxyBypassRules: '<-loopback>',
    };
}
/** Call for each new connection (new port) before the session's requests. */
async function routeSessionThroughSsh(ses, socksPort) {
    await ses.setProxy(sshProxyConfig(socksPort));
    await ses.closeAllConnections();
}
/**
 * Through the tunnel, 127.0.0.1 is the remote LS with its self-signed
 * certificate. Every other host, `localhost` included, gets Chromium's (-3).
 */
function trustLoopbackCertificate(ses) {
    ses.setCertificateVerifyProc((request, callback) => {
        callback(request.hostname === '127.0.0.1' ? 0 : -3);
    });
}
/** In memory, not `persist:`. */
function transportPartitionFor(hostId) {
    return `ssh-transport-${hostId}`;
}
/** In memory too; see Transport.sidecars. */
function sidecarPartitionFor(hostId) {
    return `ssh-sidecars-${hostId}`;
}
/**
 * No request filter: only the Hub (and, on the sidecar partition, its SSH
 * window's plugin:// handler) fetch here, one validated loopback URL each.
 */
async function openTransport(hostId, socksPort) {
    const [hub, sidecars] = await Promise.all([
        openRoutedSession(transportPartitionFor(hostId), socksPort),
        openRoutedSession(sidecarPartitionFor(hostId), socksPort),
    ]);
    return {
        fetch: async (url, init) => {
            checkTransportUrl(url);
            return hub.fetch(url, { ...init, redirect: 'manual' });
        },
        sidecars: {
            fetch: async (url, request) => {
                checkTransportUrl(url);
                return (0, redirects_1.fetchWithoutFollowing)(url, request, sidecars);
            },
        },
        close: async () => {
            await Promise.all([
                hub.closeAllConnections(),
                sidecars.closeAllConnections(),
            ]);
        },
    };
}
async function openRoutedSession(partition, socksPort) {
    const ses = electron_1.session.fromPartition(partition);
    // No spellchecker dictionary downloads through the proxy.
    ses.setSpellCheckerLanguages([]);
    trustLoopbackCertificate(ses);
    await routeSessionThroughSsh(ses, socksPort);
    return ses;
}
