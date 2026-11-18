"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBlockRemoteRequest = shouldBlockRemoteRequest;
exports.isRemoteSession = isRemoteSession;
exports.isRemoteContents = isRemoteContents;
exports.removeSessionPreloads = removeSessionPreloads;
exports.hardenRemoteSession = hardenRemoteSession;
exports.openRemoteUrl = openRemoteUrl;
exports.remoteNavigationPolicy = remoteNavigationPolicy;
exports.hardenRemoteWindow = hardenRemoteWindow;
/**
 * Hardening for SSH windows. The remote host serves their content, so a
 * compromised remote account, tampered install or toolkit XSS must stay on
 * the remote: the page must not reach the laptop's loopback or private network
 * (notably the local language server, whose CORS policy trusts any loopback
 * origin), hand other schemes or local addresses to the OS, leave its origin,
 * attach <webview> guests, get device, camera, screen or clipboard-read
 * permissions or a client certificate, run session-wide preloads, or veto
 * unloading. The microphone is the one device: for voice, the window's own
 * page may use it once the user allows its host (RemoteSessionPolicy's
 * askMicrophone, which RemoteManager answers).
 * Sidecar UIs (`plugin:`) are the one other origin: their handler fetches the
 * remote's loopback through the same SOCKS proxy (remoteSidecars.ts).
 *
 * TODO(nathanjuan): Narrow the local language server's CORS policy too.
 */
const electron_1 = require("electron");
const externalUrl_1 = require("../externalUrl");
const disconnectedPage_1 = require("./disconnectedPage");
const localNetwork_1 = require("./localNetwork");
const transport_1 = require("./transport");
const windowBackends_1 = require("./windowBackends");
/**
 * Whether a request in an SSH window's session must be blocked: local
 * addresses other than `allowedOrigin` (the window's own; undefined while
 * disconnected), which are the remote's other services or network, and all
 * cleartext, since the host check sees only literals and a DNS name can
 * resolve to a local address.
 */
function shouldBlockRemoteRequest(rawUrl, allowedOrigin) {
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        return true;
    }
    switch (url.protocol) {
        case 'data:':
        case 'blob:':
        case 'about:':
        case 'devtools:':
            return false;
        case 'plugin:':
            // The session's own handler (remoteSidecars.ts, installed before its
            // window exists): it fetches only the host's loopback, through the
            // host's SOCKS proxy. A partition's handlers are its own: nothing falls
            // through to the default session's (local) plugin:// map.
            return false;
        case 'https:':
        case 'wss:':
            break;
        default:
            return true;
    }
    if (!(0, localNetwork_1.isLocalNetworkHost)(url.hostname)) {
        return false;
    }
    if (!allowedOrigin) {
        return true;
    }
    let allowed;
    try {
        allowed = new URL(allowedOrigin);
    }
    catch {
        return true;
    }
    const protocol = url.protocol === 'wss:' ? 'https:' : url.protocol;
    return !(protocol === allowed.protocol &&
        url.hostname === allowed.hostname &&
        url.port === allowed.port);
}
/** Permissions remote pages get without asking; everything else is denied. */
const ALWAYS_ALLOWED_PERMISSIONS = new Set([
    'clipboard-sanitized-write',
    'fullscreen',
]);
function isOwnOrigin(url, allowedOrigin) {
    return typeof url === 'string' && (0, externalUrl_1.isSameOrigin)(url, allowedOrigin);
}
/**
 * Whether a permission request is getUserMedia for the microphone alone, from
 * the window's own page: its main frame, on `allowedOrigin` (undefined while
 * disconnected). Not the camera, the screen or system audio (other or more
 * `mediaTypes`), subframes such as sidecar UIs, nor other origins.
 */
function isOwnMicrophoneRequest(permission, details, allowedOrigin) {
    const types = details?.mediaTypes;
    return (permission === 'media' &&
        !!allowedOrigin &&
        Array.isArray(types) &&
        types.length === 1 &&
        types[0] === 'audio' &&
        details?.isMainFrame === true &&
        isOwnOrigin(details.requestingUrl, allowedOrigin) &&
        (details.securityOrigin === undefined ||
            isOwnOrigin(details.securityOrigin, allowedOrigin)));
}
/**
 * The same for a permission check: navigator.permissions, and the device
 * names enumerateDevices() shows (microphones and speakers). Checks with no
 * media type (Chromium re-reads a granted permission without one) or another
 * one are refused.
 */
function isOwnMicrophoneCheck(permission, requestingOrigin, details, allowedOrigin) {
    return (permission === 'media' &&
        !!allowedOrigin &&
        details?.mediaType === 'audio' &&
        details.isMainFrame === true &&
        isOwnOrigin(requestingOrigin, allowedOrigin) &&
        [
            details.requestingUrl,
            details.securityOrigin,
            details.embeddingOrigin,
        ].every((url) => url === undefined || isOwnOrigin(url, allowedOrigin)));
}
/** The SSH window `contents` shows, unless it is gone or not one. */
function liveRemoteBackend(contents) {
    return contents && !contents.isDestroyed?.()
        ? (0, windowBackends_1.remoteBackendOf)(contents)
        : undefined;
}
const hardenedSessions = new WeakMap();
/** Whether `ses` belongs to an SSH window (see hardenRemoteSession). */
function isRemoteSession(ses) {
    return !!ses && hardenedSessions.has(ses);
}
/** An SSH window, or anything else on an SSH session: every check uses this. */
function isRemoteContents(contents) {
    if (!contents) {
        return false;
    }
    // Fail closed: a destroyed contents' registration is gone.
    if (contents.isDestroyed?.()) {
        return true;
    }
    return !!(0, windowBackends_1.remoteBackendOf)(contents) || isRemoteSession(contents.session);
}
/**
 * Removes the session-wide preloads, which would run in its pages
 * ('session-created' listeners add them, e.g. electron-log's; legacy
 * setPreloads entries are listed too). Throws unless none remain.
 */
function removeSessionPreloads(ses) {
    if (typeof ses.getPreloadScripts !== 'function' ||
        typeof ses.unregisterPreloadScript !== 'function') {
        throw new Error('Cannot check the preload scripts of a session');
    }
    for (const script of ses.getPreloadScripts()) {
        ses.unregisterPreloadScript(script.id);
    }
    if (ses.getPreloadScripts().length > 0) {
        throw new Error('Could not remove the preload scripts of a session');
    }
}
/**
 * Hardens an SSH window's session (its proxy is set per connection, in
 * transport.ts). May be called again; the latest policy wins.
 */
function hardenRemoteSession(ses, policy) {
    removeSessionPreloads(ses);
    refuseRemoteClientCertificates();
    const already = hardenedSessions.has(ses);
    hardenedSessions.set(ses, policy);
    if (already) {
        return;
    }
    const current = () => hardenedSessions.get(ses) ?? policy;
    ses.webRequest.onBeforeRequest((details, callback) => {
        const p = current();
        let cancel = true;
        try {
            cancel = shouldBlockRemoteRequest(details.url, p.allowedOrigin());
        }
        catch {
            // Fail closed.
        }
        if (cancel) {
            try {
                p.onBlocked?.(details.url);
            }
            catch {
                // Only a log: the request must still get its verdict.
            }
        }
        callback({ cancel });
    });
    (0, transport_1.trustLoopbackCertificate)(ses);
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
        if (ALWAYS_ALLOWED_PERMISSIONS.has(permission)) {
            callback(true);
            return;
        }
        const ownMicrophone = () => {
            try {
                return isOwnMicrophoneRequest(permission, details, current().allowedOrigin());
            }
            catch {
                return false; // Fail closed.
            }
        };
        const ask = current().askMicrophone;
        if (!ask || !ownMicrophone() || !liveRemoteBackend(contents)) {
            callback(false);
            return;
        }
        // Re-checked once answered: the window may have closed or moved on.
        void ask(contents)
            .then((allowed) => allowed && !!liveRemoteBackend(contents) && ownMicrophone())
            .catch(() => false) // Fail closed.
            .then(callback);
    });
    ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
        if (ALWAYS_ALLOWED_PERMISSIONS.has(permission)) {
            return true;
        }
        try {
            const policy = current();
            // Granted until the user says no: the toolkit reads this before it
            // calls getUserMedia, whose request asks the user. Until then the
            // page sees microphone and speaker names, and WebRTC could list
            // this computer's addresses but for hardenRemoteWindow's policy.
            return (!!policy.askMicrophone &&
                isOwnMicrophoneCheck(permission, requestingOrigin, details, policy.allowedOrigin()) &&
                !!contents &&
                !!liveRemoteBackend(contents) &&
                !policy.microphoneRefused?.(contents));
        }
        catch {
            return false; // Fail closed.
        }
    });
    // No USB/HID/serial devices (Electron would otherwise ask the app).
    ses.setDevicePermissionHandler(() => false);
    ses.on('select-hid-device', (event, _details, callback) => {
        event.preventDefault();
        callback();
    });
    ses.on('select-serial-port', (event, _ports, _contents, callback) => {
        event.preventDefault();
        callback('');
    });
    ses.on('select-usb-device', (event, _details, callback) => {
        event.preventDefault();
        callback();
    });
}
let clientCertificatePolicyInstalled = false;
// SSH sessions send no client certificate: Electron would pick the store's
// first (e.g. a corp device certificate).
function refuseRemoteClientCertificates() {
    if (clientCertificatePolicyInstalled) {
        return;
    }
    clientCertificatePolicyInstalled = true;
    electron_1.app.on('select-client-certificate', (event, contents, _url, _list, callback) => {
        // Without a WebContents (service workers) the session is unknown: keep
        // the default, which local ones may need.
        if (isRemoteContents(contents)) {
            event.preventDefault();
            callback();
        }
    });
}
/**
 * Opens a URL from an SSH window in the OS browser if it is a web URL off the
 * local network: the browser would send the user's cookies to local services.
 * `open`, if given, opens it instead (the window's connection, which relays
 * sign-in callbacks to the host).
 */
function openRemoteUrl(url, open) {
    if (typeof url !== 'string' || !(0, localNetwork_1.isRemoteOpenableUrl)(url)) {
        return 'blocked';
    }
    if (open) {
        open(url);
    }
    else {
        void (0, externalUrl_1.openExternalSafely)(url, 'unconfirmed');
    }
    return 'opened';
}
/**
 * An SSH window stays on its origin; other URLs go to openRemoteUrl (with
 * `open`), except the Disconnected page's buttons (`onPageAction`, while it
 * shows that page).
 */
function remoteNavigationPolicy(allowedOrigin, onPageAction, open) {
    return {
        allowsNavigation: (url) => {
            const origin = allowedOrigin();
            return !!origin && (0, externalUrl_1.isSameOrigin)(url, origin);
        },
        openOutside: (url, contents) => {
            if ((0, disconnectedPage_1.isDisconnectedPageLink)(url)) {
                const action = (0, disconnectedPage_1.disconnectedPageAction)(contents, url);
                if (action) {
                    onPageAction?.(action);
                }
                return;
            }
            openRemoteUrl(url, open);
        },
    };
}
/** Hardens an SSH window (its navigation policy is set at creation). */
function hardenRemoteWindow(win) {
    // A window that is gone shows nothing (and its webContents throws).
    if (win.isDestroyed?.() || win.webContents?.isDestroyed?.()) {
        return;
    }
    const contents = win.webContents;
    contents.on('will-attach-webview', (event) => {
        event.preventDefault();
    });
    // beforeunload must not keep the window open, or off the Disconnected page.
    contents.on('will-prevent-unload', (event) => {
        event.preventDefault();
    });
    // Bluetooth pickers auto-select the first device when unhandled.
    contents.on('select-bluetooth-device', (event, _devices, callback) => {
        event.preventDefault();
        callback('');
    });
    // No UDP, which the SOCKS proxy can't carry (TCP goes through it). Chromium
    // still resolves TURN host names locally: a DNS lookup, no connection.
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
}
