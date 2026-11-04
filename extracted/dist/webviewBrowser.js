"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POPUP_USER_ACTIVATION_WINDOW_MS = exports.MIN_POPUP_INTERVAL_MS = exports.MAX_CONCURRENT_POPUPS_PER_WEBVIEW = exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL = exports.WEBVIEW_FAVICON_UPDATED_CHANNEL = exports.WEBVIEW_OPEN_NEW_TAB_CHANNEL = void 0;
exports.isExternalOnlyAuthUrl = isExternalOnlyAuthUrl;
exports.validateWebviewNavigationUrl = validateWebviewNavigationUrl;
exports.isPopupWindowRequest = isPopupWindowRequest;
exports.parsePopupWindowDimensions = parsePopupWindowDimensions;
exports.clearWebviewFaviconCacheForTesting = clearWebviewFaviconCacheForTesting;
exports.isOwnedBrowserGuestWebContents = isOwnedBrowserGuestWebContents;
exports.setGuestDownloadDirectory = setGuestDownloadDirectory;
exports.configureWebviewBrowserContents = configureWebviewBrowserContents;
const electron_1 = require("electron");
const utils_1 = require("./utils");
const webviewSecurityState_1 = require("./webviewSecurityState");
const webviewDownloadRouting_1 = require("./webviewDownloadRouting");
/** IPC channel sent to the host renderer when a `<webview>` requests a new tab. */
exports.WEBVIEW_OPEN_NEW_TAB_CHANNEL = 'webview:open-new-tab';
/** IPC channel sent to the host renderer when a `<webview>` guest's favicon updates. */
exports.WEBVIEW_FAVICON_UPDATED_CHANNEL = 'webview:favicon-updated';
const MAX_INLINE_FAVICON_BYTES = 8 * 1024;
const MAX_RAW_FAVICON_BYTES = 256 * 1024;
const MAX_FAVICON_DATA_URL_LENGTH = Math.ceil((MAX_INLINE_FAVICON_BYTES * 4) / 3) + 64;
const MAX_FAVICON_CACHE_ENTRIES = 256;
const MAX_FAVICON_REDIRECTS = 5;
const FAVICON_ISOLATED_WORLD_ID = 9998;
const ISOLATED_FAVICON_LINKS_SCRIPT = 'Array.from(document.querySelectorAll(\'link[rel~="icon" i]\')).map((el) => el.href).filter(Boolean)';
/** IPC channel sent to the host renderer when a guest download progresses or finishes. */
exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL = 'webview:download-progress';
const DEFAULT_POPUP_WIDTH = 520;
const DEFAULT_POPUP_HEIGHT = 680;
const MIN_POPUP_WIDTH = 360;
const MAX_POPUP_WIDTH = 1280;
const MIN_POPUP_HEIGHT = 400;
const MAX_POPUP_HEIGHT = 960;
/** Maximum concurrent child popup windows allowed per `<webview>` guest. */
exports.MAX_CONCURRENT_POPUPS_PER_WEBVIEW = 2;
/** Minimum interval (ms) between child popup creations from the same `<webview>`. */
exports.MIN_POPUP_INTERVAL_MS = 500;
/** Maximum age (ms) of a user input event on a `<webview>` to authorize a popup. */
exports.POPUP_USER_ACTIVATION_WINDOW_MS = 5000;
const GOOGLE_OAUTH_PATH_RE = /^(?:\/u\/\d+)?\/(?:o\/oauth2|signin\/oauth)(?:\/|$)/;
const OOB_REDIRECT_URIS = new Set([
    'oob',
    'urn:ietf:wg:oauth:2.0:oob',
    'urn:ietf:wg:oauth:2.0:oob:auto',
]);
const URI_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const NON_EXTERNAL_REDIRECT_SCHEMES = new Set([
    'http',
    'https',
    'storagerelay',
    'javascript',
    'data',
    'blob',
    'file',
    'about',
]);
const BLOCKED_METADATA_HOSTS = new Set([
    'metadata.google.internal',
    'metadata.goog',
]);
function extractGoogleOAuthRedirectUri(parsed) {
    const direct = parsed.searchParams.get('redirect_uri');
    if (direct) {
        return direct;
    }
    const continueParam = parsed.searchParams.get('continue');
    if (!continueParam) {
        return null;
    }
    try {
        const nested = new URL(continueParam, parsed);
        if ((nested.protocol === 'https:' || nested.protocol === 'http:') &&
            normalizeHostname(nested.hostname) === 'accounts.google.com' &&
            GOOGLE_OAUTH_PATH_RE.test(nested.pathname)) {
            return nested.searchParams.get('redirect_uri');
        }
    }
    catch {
        // Ignore malformed continue URLs.
    }
    return null;
}
function isExternalOnlyRedirectUri(rawRedirectUri) {
    const trimmed = rawRedirectUri.trim();
    if (!trimmed) {
        return false;
    }
    const lower = trimmed.toLowerCase();
    if (OOB_REDIRECT_URIS.has(lower)) {
        return true;
    }
    const schemeMatch = URI_SCHEME_RE.exec(trimmed);
    if (!schemeMatch) {
        return false;
    }
    const scheme = schemeMatch[1].toLowerCase();
    if (!NON_EXTERNAL_REDIRECT_SCHEMES.has(scheme)) {
        return true;
    }
    if (scheme !== 'http' && scheme !== 'https') {
        return false;
    }
    try {
        const redirectUrl = new URL(trimmed);
        if (isLoopbackHost(redirectUrl.hostname)) {
            return true;
        }
        if (redirectUrl.protocol === 'https:' &&
            normalizeHostname(redirectUrl.hostname) === 'antigravity.google' &&
            redirectUrl.pathname.replace(/\/+$/, '') === '/oauth-callback') {
            return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
/**
 * Returns `true` when `rawUrl` is a Google OAuth endpoint on
 * `accounts.google.com` (`/o/oauth2/...`, `/signin/oauth/...`, or `/u/N/...`)
 * whose `redirect_uri` targets a native, loopback, out-of-band, or external
 * callback rather than an in-session web callback.
 */
function isExternalOnlyAuthUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return false;
        }
        if (normalizeHostname(parsed.hostname) !== 'accounts.google.com') {
            return false;
        }
        if (!GOOGLE_OAUTH_PATH_RE.test(parsed.pathname)) {
            return false;
        }
        const redirectUri = extractGoogleOAuthRedirectUri(parsed);
        return redirectUri !== null && isExternalOnlyRedirectUri(redirectUri);
    }
    catch {
        return false;
    }
}
function normalizeHostname(rawHostname) {
    return rawHostname
        .trim()
        .replace(/^\[|\]$/g, '')
        .replace(/\.+$/, '')
        .toLowerCase();
}
function parseIpv4Octets(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) {
        return null;
    }
    const octets = [];
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) {
            return null;
        }
        const n = Number(part);
        if (n < 0 || n > 255) {
            return null;
        }
        octets.push(n);
    }
    return [octets[0], octets[1], octets[2], octets[3]];
}
function parseIpv6Groups(host) {
    if (!host.includes(':')) {
        return null;
    }
    const doubleColonParts = host.split('::');
    if (doubleColonParts.length > 2) {
        return null;
    }
    const parseSide = (side, allowTrailingIpv4) => {
        if (side === '') {
            return [];
        }
        const tokens = side.split(':');
        const groups = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (allowTrailingIpv4 && i === tokens.length - 1 && token.includes('.')) {
                const octets = parseIpv4Octets(token);
                if (!octets) {
                    return null;
                }
                groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
            }
            else {
                if (!/^[0-9a-f]{1,4}$/i.test(token)) {
                    return null;
                }
                groups.push(parseInt(token, 16));
            }
        }
        return groups;
    };
    if (doubleColonParts.length === 1) {
        const groups = parseSide(doubleColonParts[0], true);
        return groups && groups.length === 8 ? groups : null;
    }
    const left = parseSide(doubleColonParts[0], false);
    const right = parseSide(doubleColonParts[1], true);
    if (!left || !right || left.length + right.length >= 8) {
        return null;
    }
    const missing = 8 - left.length - right.length;
    return [...left, ...new Array(missing).fill(0), ...right];
}
function extractMappedIpv4FromIpv6(host) {
    const groups = parseIpv6Groups(host);
    if (!groups) {
        return null;
    }
    const firstFiveZero = groups[0] === 0 &&
        groups[1] === 0 &&
        groups[2] === 0 &&
        groups[3] === 0 &&
        groups[4] === 0;
    if (!firstFiveZero) {
        return null;
    }
    const isIpv4Mapped = groups[5] === 0xffff;
    const isIpv4Compatible = groups[5] === 0 &&
        !(groups[6] === 0 && (groups[7] === 0 || groups[7] === 1));
    if (!isIpv4Mapped && !isIpv4Compatible) {
        return null;
    }
    return [
        (groups[6] >> 8) & 0xff,
        groups[6] & 0xff,
        (groups[7] >> 8) & 0xff,
        groups[7] & 0xff,
    ];
}
function isLinkLocalHost(hostname) {
    const host = normalizeHostname(hostname);
    const v4 = parseIpv4Octets(host) ?? extractMappedIpv4FromIpv6(host);
    if (v4) {
        return v4[0] === 169 && v4[1] === 254;
    }
    const groups = parseIpv6Groups(host);
    if (groups) {
        return (groups[0] & 0xffc0) === 0xfe80;
    }
    return false;
}
function isLoopbackHost(hostname) {
    const host = normalizeHostname(hostname);
    if (host === 'localhost' || host.endsWith('.localhost')) {
        return true;
    }
    const v4 = parseIpv4Octets(host) ?? extractMappedIpv4FromIpv6(host);
    if (v4) {
        return v4[0] === 127 || v4[0] === 0;
    }
    const groups = parseIpv6Groups(host);
    if (groups) {
        const firstSevenZero = groups[0] === 0 &&
            groups[1] === 0 &&
            groups[2] === 0 &&
            groups[3] === 0 &&
            groups[4] === 0 &&
            groups[5] === 0 &&
            groups[6] === 0;
        return firstSevenZero && (groups[7] === 0 || groups[7] === 1);
    }
    return false;
}
function isPrivateNetworkHost(hostname) {
    const host = normalizeHostname(hostname);
    const v4 = parseIpv4Octets(host) ?? extractMappedIpv4FromIpv6(host);
    if (v4) {
        return (v4[0] === 10 ||
            (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) ||
            (v4[0] === 192 && v4[1] === 168));
    }
    const groups = parseIpv6Groups(host);
    if (groups) {
        return (groups[0] & 0xfe00) === 0xfc00;
    }
    return false;
}
function isLoopbackOrigin(originOrUrl) {
    if (!originOrUrl || originOrUrl === 'null') {
        return false;
    }
    try {
        const parsed = new URL(originOrUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }
        return isLoopbackHost(parsed.hostname);
    }
    catch {
        return false;
    }
}
/**
 * Validates a `<webview>` or child popup target URL against the Hub browser
 * navigation policy:
 * - Only `http:` and `https:` URLs are permitted.
 * - Cloud metadata hosts (`metadata.google.internal`, `*.metadata.google.internal`,
 *   `metadata.goog`, `*.metadata.goog`) and link-local addresses
 *   (`169.254.0.0/16`, `fe80::/10`) are always blocked.
 * - Loopback (`localhost`, `127.0.0.0/8`, `0.0.0.0/8`, `::1`, `::`) and
 *   private RFC1918 / IPv6 ULA ranges (`10.0.0.0/8`, `172.16.0.0/12`,
 *   `192.168.0.0/16`, `fc00::/7`) are blocked unless initiated from a
 *   loopback opener origin.
 */
function validateWebviewNavigationUrl(rawUrl, openerOrigin) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return { allowed: false, reason: 'Invalid URL' };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return {
            allowed: false,
            reason: `Disallowed URL protocol: ${parsed.protocol}`,
        };
    }
    const host = normalizeHostname(parsed.hostname);
    if (!host) {
        return { allowed: false, reason: 'Empty hostname' };
    }
    if (BLOCKED_METADATA_HOSTS.has(host) ||
        host.endsWith('.metadata.google.internal') ||
        host.endsWith('.metadata.goog') ||
        isLinkLocalHost(host)) {
        return {
            allowed: false,
            reason: `Blocked cloud metadata or link-local host: ${host}`,
        };
    }
    if (isLoopbackHost(host) || isPrivateNetworkHost(host)) {
        if (!isLoopbackOrigin(openerOrigin)) {
            return {
                allowed: false,
                reason: `Cross-origin navigation from remote origin to local/private host "${host}" is blocked`,
            };
        }
    }
    return { allowed: true };
}
/**
 * Returns `true` when a `window.open()` request explicitly specifies popup
 * window features (`width=`, `height=`, `left=`, `top=`, or `popup`) or opens
 * a scriptable `about:blank` / empty-URL launcher without `noopener` /
 * `noreferrer`, rather than a standard tab navigation (including Shift-click
 * `new-window` without popup features).
 */
function isPopupWindowRequest(details) {
    const features = details.features || '';
    if (/\b(?:width|height|left|top)\s*=\s*\d+/i.test(features)) {
        return true;
    }
    if (/\bpopup\s*=\s*(?:0|no|false)\b/i.test(features)) {
        return false;
    }
    if (/\bpopup(?:\s*=\s*(?:1|yes|true))?\b/i.test(features)) {
        return true;
    }
    if (details.url !== undefined &&
        isBlankPopupUrl(details.url) &&
        !/\b(?:noopener|noreferrer)\b/i.test(features)) {
        return true;
    }
    return false;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/**
 * Parses `width` and `height` from a `window.open()` `features` string,
 * clamping to safe desktop popup dimensions.
 */
function parsePopupWindowDimensions(features) {
    const widthMatch = /\bwidth\s*=\s*(\d+)/i.exec(features);
    const heightMatch = /\bheight\s*=\s*(\d+)/i.exec(features);
    const parsedWidth = widthMatch ? Number(widthMatch[1]) : NaN;
    const parsedHeight = heightMatch ? Number(heightMatch[1]) : NaN;
    return {
        width: Number.isFinite(parsedWidth)
            ? clamp(parsedWidth, MIN_POPUP_WIDTH, MAX_POPUP_WIDTH)
            : DEFAULT_POPUP_WIDTH,
        height: Number.isFinite(parsedHeight)
            ? clamp(parsedHeight, MIN_POPUP_HEIGHT, MAX_POPUP_HEIGHT)
            : DEFAULT_POPUP_HEIGHT,
    };
}
function isBlankPopupUrl(url) {
    return url === '' || /^about:blank(?:[?#].*)?$/i.test(url);
}
function extractHttpOrigin(rawUrl) {
    if (!rawUrl || isBlankPopupUrl(rawUrl)) {
        return undefined;
    }
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.origin;
        }
    }
    catch {
        // Non-URL strings are ignored.
    }
    return undefined;
}
let nextSessionCacheId = 1;
const sessionCacheIds = new WeakMap();
const faviconDataUrlCache = new Map();
/** Clears the main-process favicon cache for hermetic unit tests. */
function clearWebviewFaviconCacheForTesting() {
    faviconDataUrlCache.clear();
}
function getSessionCacheKey(session) {
    if (!session || typeof session !== 'object') {
        return 'default';
    }
    let id = sessionCacheIds.get(session);
    if (!id) {
        id = `s${nextSessionCacheId++}`;
        sessionCacheIds.set(session, id);
    }
    return id;
}
const IMAGE_MAGIC_MIME = [
    ['00000100', 'image/x-icon'],
    ['00000200', 'image/x-icon'],
    ['89504e47', 'image/png'],
    ['47494638', 'image/gif'],
    ['ffd8ff', 'image/jpeg'],
];
function sniffImageMimeType(buf, contentTypeHeader) {
    const headerMime = contentTypeHeader?.split(';')[0]?.trim().toLowerCase();
    if (headerMime?.startsWith('image/')) {
        return headerMime;
    }
    const hex = buf.subarray(0, 4).toString('hex');
    for (const [prefix, mime] of IMAGE_MAGIC_MIME) {
        if (hex.startsWith(prefix)) {
            return mime;
        }
    }
    if (buf.length >= 12 &&
        buf.toString('ascii', 0, 4) === 'RIFF' &&
        buf.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    const head = buf.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<svg') ? 'image/svg+xml' : undefined;
}
function encodeFaviconBufferToDataUrl(buf, mimeType) {
    if (buf.byteLength === 0 || buf.byteLength > MAX_RAW_FAVICON_BYTES) {
        return undefined;
    }
    if (buf.byteLength <= MAX_INLINE_FAVICON_BYTES) {
        const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;
        return dataUrl.length <= MAX_FAVICON_DATA_URL_LENGTH ? dataUrl : undefined;
    }
    if (mimeType !== 'image/svg+xml' &&
        typeof electron_1.nativeImage?.createFromBuffer === 'function') {
        try {
            const img = electron_1.nativeImage.createFromBuffer(buf);
            const dataUrl = !img?.isEmpty?.()
                ? (img.resize?.({ width: 32, height: 32 }) ?? img).toDataURL?.()
                : undefined;
            if (dataUrl?.startsWith('data:image/') &&
                dataUrl.length <= MAX_FAVICON_DATA_URL_LENGTH) {
                return dataUrl;
            }
        }
        catch {
            // Ignore nativeImage decode errors on malformed icon bytes.
        }
    }
    return undefined;
}
async function fetchFaviconCandidateInMain(guestSession, candidateUrl, docOrigin) {
    const trimmed = candidateUrl.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.startsWith('data:')) {
        return trimmed.startsWith('data:image/') &&
            trimmed.length <= MAX_FAVICON_DATA_URL_LENGTH
            ? trimmed
            : undefined;
    }
    if (!validateWebviewNavigationUrl(trimmed, docOrigin).allowed) {
        return undefined;
    }
    const cacheKey = `${getSessionCacheKey(guestSession)}\0${trimmed}`;
    const cached = faviconDataUrlCache.get(cacheKey);
    if (cached) {
        faviconDataUrlCache.delete(cacheKey);
        faviconDataUrlCache.set(cacheKey, cached);
        return cached;
    }
    const sessionFetch = guestSession
        ?.fetch;
    if (typeof sessionFetch !== 'function') {
        return undefined;
    }
    let currentUrl = trimmed;
    for (let hop = 0; hop <= MAX_FAVICON_REDIRECTS; hop++) {
        try {
            const response = await sessionFetch.call(guestSession, currentUrl, {
                redirect: 'manual',
            });
            if (response.status >= 300 &&
                response.status < 400 &&
                hop < MAX_FAVICON_REDIRECTS) {
                const location = response.headers?.get?.('location')?.trim();
                if (!location) {
                    return undefined;
                }
                const redirectTarget = new URL(location, currentUrl).toString();
                if (!validateWebviewNavigationUrl(redirectTarget, docOrigin).allowed) {
                    return undefined;
                }
                currentUrl = redirectTarget;
                continue;
            }
            if (!response.ok) {
                return undefined;
            }
            const contentLengthHeader = response.headers
                ?.get?.('content-length')
                ?.trim();
            if (contentLengthHeader) {
                const contentLength = Number(contentLengthHeader);
                if (!Number.isFinite(contentLength) ||
                    contentLength < 0 ||
                    contentLength > MAX_RAW_FAVICON_BYTES) {
                    return undefined;
                }
            }
            const buf = Buffer.from(await response.arrayBuffer());
            const mimeType = sniffImageMimeType(buf, response.headers?.get?.('content-type'));
            const dataUrl = mimeType
                ? encodeFaviconBufferToDataUrl(buf, mimeType)
                : undefined;
            if (dataUrl) {
                faviconDataUrlCache.delete(cacheKey);
                if (faviconDataUrlCache.size >= MAX_FAVICON_CACHE_ENTRIES) {
                    const oldestKey = faviconDataUrlCache.keys().next().value;
                    if (oldestKey !== undefined) {
                        faviconDataUrlCache.delete(oldestKey);
                    }
                }
                faviconDataUrlCache.set(cacheKey, dataUrl);
            }
            return dataUrl;
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
function isMainFrameNavigationEvent(event, isMainFrameArg) {
    if (typeof isMainFrameArg === 'boolean') {
        return isMainFrameArg;
    }
    if (typeof event?.isMainFrame === 'boolean') {
        return event.isMainFrame;
    }
    return true;
}
function extractOriginAndPathname(rawUrl) {
    if (!rawUrl) {
        return undefined;
    }
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
            return `${parsed.origin}${normalizedPath}`;
        }
    }
    catch {
        // Fall through to undefined.
    }
    return undefined;
}
const hostNavigationMuxByHost = new WeakMap();
/**
 * Multiplexes `did-navigate` and `did-navigate-in-page` across all guest
 * `<webview>` / `WebContentsView` instances sharing the same `host`
 * (`hubWcv.webContents`) so `host` never holds more than one listener per event
 * regardless of how many pooled browser tabs are open simultaneously.
 */
function subscribeHostNavigation(host, subscriber) {
    if (!host || typeof host.on !== 'function') {
        return () => undefined;
    }
    let mux = hostNavigationMuxByHost.get(host);
    if (!mux) {
        const subscribers = new Set();
        const fanOut = (event, navigationUrl, isMainFrameArg) => {
            for (const sub of [...subscribers]) {
                sub(event, navigationUrl, isMainFrameArg);
            }
        };
        const onNavigate = (event, navigationUrl, isMainFrameArg) => {
            fanOut(event, navigationUrl, isMainFrameArg);
        };
        const onInPageNavigate = (event, navigationUrl, isMainFrameArg) => {
            fanOut(event, navigationUrl, isMainFrameArg);
        };
        mux = { subscribers, onNavigate, onInPageNavigate };
        hostNavigationMuxByHost.set(host, mux);
        host.on('did-navigate', onNavigate);
        host.on('did-navigate-in-page', onInPageNavigate);
    }
    mux.subscribers.add(subscriber);
    let unsubscribed = false;
    return () => {
        if (unsubscribed) {
            return;
        }
        unsubscribed = true;
        const currentMux = hostNavigationMuxByHost.get(host);
        if (!currentMux) {
            return;
        }
        currentMux.subscribers.delete(subscriber);
        if (currentMux.subscribers.size === 0) {
            hostNavigationMuxByHost.delete(host);
            if (!host.isDestroyed?.()) {
                try {
                    host.removeListener?.('did-navigate', currentMux.onNavigate);
                    host.removeListener?.('did-navigate-in-page', currentMux.onInPageNavigate);
                }
                catch {
                    // Ignore errors if host is already destroyed during window teardown.
                }
            }
        }
    };
}
function formatOriginPrefix(rawUrl) {
    if (!rawUrl) {
        return '[about:blank]';
    }
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return `[${parsed.origin}]`;
        }
    }
    catch {
        // Fall through to about:blank prefix.
    }
    return '[about:blank]';
}
function formatPopupWindowTitle(rawUrl, pageTitle) {
    const prefix = formatOriginPrefix(rawUrl);
    const trimmedTitle = pageTitle?.trim();
    if (!trimmedTitle || trimmedTitle === prefix) {
        return prefix;
    }
    if (trimmedTitle.startsWith(`${prefix} `)) {
        return trimmedTitle;
    }
    return `${prefix} ${trimmedTitle}`;
}
const configuredWebviewContents = new WeakSet();
const configuredDownloadSessions = new WeakSet();
const hostByGuestContents = new WeakMap();
let nextDownloadSequence = 0;
/**
 * Returns `true` when `wc` is a live browser guest (`<webview>` or configured
 * `WebContentsView`) hosted by `senderId`.
 */
function isOwnedBrowserGuestWebContents(wc, senderId) {
    if (!wc ||
        typeof wc !== 'object' ||
        typeof senderId !== 'number' ||
        !Number.isInteger(senderId)) {
        return false;
    }
    const candidate = wc;
    if (candidate.isDestroyed?.()) {
        return false;
    }
    if (configuredWebviewContents.has(candidate) &&
        hostByGuestContents.get(candidate)?.id === senderId) {
        return true;
    }
    return (candidate.getType?.() === 'webview' &&
        candidate.hostWebContents?.id === senderId);
}
/** Arms or clears the sandbox download directory for a browser guest. */
function setGuestDownloadDirectory(wc, downloadDir) {
    return (0, webviewDownloadRouting_1.setGuestDownloadDirectoryForWc)(wc, downloadDir);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureSessionDownloadListener(guestSession) {
    if (!guestSession ||
        typeof guestSession.on !== 'function' ||
        configuredDownloadSessions.has(guestSession)) {
        return;
    }
    configuredDownloadSessions.add(guestSession);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    guestSession.on('will-download', (_ev, item, wc) => {
        const isWcAlive = wc && typeof wc === 'object' && !wc.isDestroyed?.();
        const rawWcId = isWcAlive ? (wc.id ?? 0) : 0;
        const openerWc = (0, webviewDownloadRouting_1.resolveOpenerWebContents)(wc);
        const openerWcId = openerWc && !openerWc.isDestroyed?.() ? (openerWc.id ?? 0) : 0;
        const isConfiguredTopLevelGuest = Boolean(wc &&
            typeof wc === 'object' &&
            configuredWebviewContents.has(wc));
        const webContentsId = openerWcId > 0 &&
            (!isConfiguredTopLevelGuest ||
                (!(0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(rawWcId) &&
                    Boolean((0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(openerWcId))))
            ? openerWcId
            : rawWcId || openerWcId;
        const host = (wc && typeof wc === 'object' ? hostByGuestContents.get(wc) : null) ??
            (isWcAlive ? wc.hostWebContents : undefined) ??
            (openerWc ? hostByGuestContents.get(openerWc) : null) ??
            openerWc?.hostWebContents;
        const closeInitialDownloadPopup = (0, webviewDownloadRouting_1.prepareChildPopupDownloadCleanup)(wc);
        const id = `dl-${++nextDownloadSequence}`;
        // Synchronously assign a validated destination path (or cancel on error) so
        // Chromium never opens a modal OS save dialog.
        const existingSavePath = item?.getSavePath?.() ?? '';
        let resolvedSavePath = existingSavePath;
        let releaseReservation;
        if (!existingSavePath) {
            const target = (0, webviewDownloadRouting_1.resolveSynchronousDownloadTarget)({
                webContentsId: rawWcId,
                openerWebContentsId: openerWcId,
                rawFilename: item?.getFilename?.(),
            });
            if (!target) {
                item?.cancel?.();
                if (host && !host.isDestroyed()) {
                    const cancelledPayload = {
                        id,
                        webContentsId,
                        url: item?.getURL?.() ?? '',
                        filename: item?.getFilename?.() ?? '',
                        receivedBytes: item?.getReceivedBytes?.() ?? 0,
                        totalBytes: item?.getTotalBytes?.() ?? 0,
                        savePath: '',
                        mimeType: item?.getMimeType?.() ?? '',
                        state: 'cancelled',
                    };
                    if (openerWcId > 0) {
                        cancelledPayload.openerWebContentsId = openerWcId;
                    }
                    host.send(exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL, cancelledPayload);
                }
                closeInitialDownloadPopup?.();
                return;
            }
            resolvedSavePath = target.savePath;
            releaseReservation = target.release;
            item?.setSavePath?.(target.savePath);
        }
        const send = (state) => {
            if (host && !host.isDestroyed()) {
                const payload = {
                    id,
                    webContentsId,
                    url: item?.getURL?.() ?? '',
                    filename: item?.getFilename?.() ?? '',
                    receivedBytes: item?.getReceivedBytes?.() ?? 0,
                    totalBytes: item?.getTotalBytes?.() ?? 0,
                    savePath: item?.getSavePath?.() || resolvedSavePath,
                    mimeType: item?.getMimeType?.() ?? '',
                    state,
                };
                if (openerWcId > 0) {
                    payload.openerWebContentsId = openerWcId;
                }
                host.send(exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL, payload);
            }
        };
        send('started');
        item?.on?.('updated', (_e, state) => send(state === 'interrupted' ? 'interrupted' : 'progressing'));
        item?.on?.('done', (_e, state) => {
            releaseReservation?.();
            send(state === 'completed'
                ? 'completed'
                : state === 'cancelled'
                    ? 'cancelled'
                    : 'interrupted');
            closeInitialDownloadPopup?.();
        });
        if (typeof item?.on !== 'function') {
            releaseReservation?.();
            closeInitialDownloadPopup?.();
        }
    });
}
/**
 * Configures a `<webview>` guest `WebContents` to:
 * 1. Route external-only Google OAuth endpoints (`accounts.google.com/o/oauth2/*`
 *    and `/signin/oauth/*`) to the system browser via `shell.openExternal`.
 * 2. Open explicit popup windows (`window.open(..., 'width=...,height=...')` and
 *    scriptable `about:blank` launchers) in hardened framed child `BrowserWindow`s
 *    (preserving `window.opener`, enforcing user gesture activation, rate limits,
 *    concurrency caps, native origin-prefixed title bars + close controls,
 *    private-network URL validation, and automatic teardown on cross-origin
 *    opener navigation, tab hide/release, or conversation switch).
 * 3. Route standard tab navigations (`target="_blank"`, Shift-click) to the
 *    built-in browser tab strip via `webview:open-new-tab`.
 */
function configureWebviewBrowserContents(contents, options) {
    if (!contents ||
        (contents.getType() !== 'webview' && !options?.allowWebContentsView) ||
        configuredWebviewContents.has(contents)) {
        return;
    }
    configuredWebviewContents.add(contents);
    const guestSession = contents.session;
    const host = options?.hostWebContents ?? contents.hostWebContents;
    if (host) {
        hostByGuestContents.set(contents, host);
    }
    ensureSessionDownloadListener(guestSession);
    const webContentsId = contents.id;
    const openExternal = options?.openExternal ?? ((url) => electron_1.shell.openExternal(url));
    const now = options?.now ?? (() => Date.now());
    const getParentWindow = options?.getParentWindow ??
        (() => {
            if (host && typeof electron_1.BrowserWindow?.fromWebContents === 'function') {
                const fromHost = electron_1.BrowserWindow.fromWebContents(host);
                if (fromHost) {
                    return fromHost;
                }
            }
            return electron_1.BrowserWindow?.getFocusedWindow?.() ?? undefined;
        });
    let lastUserActivationMs = 0;
    let lastPopupOpenedMs = 0;
    let lastPopupInitialUrl = '';
    let lastPopupOpenerOrigin;
    let lastPopupHostUrl;
    let popupOpenedWhileUnmuted = false;
    let hasCommittedWebviewNavigation = false;
    let inFlightWebviewOrigin;
    let popupVisibilityTimer = null;
    const activePopups = new Set();
    const isActivationInputType = (type) => !type ||
        type === 'mouseDown' ||
        type === 'mouseUp' ||
        type === 'pointerDown' ||
        type === 'pointerUp' ||
        type === 'pointerCausedUaAction' ||
        type === 'rawKeyDown' ||
        type === 'keyDown' ||
        type === 'char' ||
        type === 'gestureTapDown' ||
        type === 'gestureTap' ||
        type === 'touchStart' ||
        type === 'touchEnd';
    const onBeforeInputEvent = () => {
        lastUserActivationMs = now();
    };
    const onInputEvent = (_event, inputEvent) => {
        if (isActivationInputType(inputEvent?.type)) {
            lastUserActivationMs = now();
        }
    };
    // Cross-origin out-of-process iframes (such as `accounts.google.com/gsi/button`)
    // have their own RenderWidgetHost, so OS mouse clicks inside an OOPF do not
    // emit `input-event` on the guest `<webview>` primary main frame's
    // RenderWidgetHost. Listen to `before-mouse-event` and `before-input-event`
    // (`PreHandleMouseEvent` / `PreHandleKeyboardEvent` on the guest
    // `WebContentsDelegate`, which fire across all guest frames including OOPFs)
    // without subscribing to `hostWebContents`, so typing or clicking in Hub
    // chrome never grants popup activation to the guest.
    contents.on?.('before-input-event', onBeforeInputEvent);
    contents.on?.('before-mouse-event', onInputEvent);
    contents.on?.('input-event', onInputEvent);
    const stopPopupVisibilityTimer = () => {
        if (popupVisibilityTimer !== null) {
            clearInterval(popupVisibilityTimer);
            popupVisibilityTimer = null;
        }
        lastPopupOpenerOrigin = undefined;
        lastPopupHostUrl = undefined;
        popupOpenedWhileUnmuted = false;
    };
    const closeActivePopups = () => {
        stopPopupVisibilityTimer();
        const toClose = [...activePopups];
        activePopups.clear();
        for (const popup of toClose) {
            try {
                if (!popup.isDestroyed?.()) {
                    popup.close?.();
                }
            }
            catch {
                // Ignore errors when closing already-destroyed child popups.
            }
        }
    };
    const ensurePopupVisibilityTimer = () => {
        if (popupVisibilityTimer !== null || activePopups.size === 0) {
            return;
        }
        popupVisibilityTimer = setInterval(() => {
            if (activePopups.size === 0) {
                stopPopupVisibilityTimer();
                return;
            }
            if (contents.isDestroyed?.() ||
                (popupOpenedWhileUnmuted && contents.isAudioMuted?.() === true)) {
                closeActivePopups();
            }
        }, 200);
        popupVisibilityTimer.unref?.();
    };
    const closeActivePopupsIfCrossOrigin = (navigationUrl) => {
        if (activePopups.size === 0) {
            return;
        }
        const navOrigin = extractHttpOrigin(navigationUrl);
        const openerHttpOrigin = extractHttpOrigin(lastPopupOpenerOrigin);
        const isCrossOrigin = !navOrigin ||
            lastPopupOpenerOrigin === 'null' ||
            (openerHttpOrigin !== undefined && navOrigin !== openerHttpOrigin);
        if (isCrossOrigin) {
            closeActivePopups();
        }
    };
    const onHostNavigate = (event, navigationUrl, isMainFrameArg) => {
        if (!isMainFrameNavigationEvent(event, isMainFrameArg)) {
            return;
        }
        if (activePopups.size === 0) {
            return;
        }
        const nextHostRoute = extractOriginAndPathname(navigationUrl);
        const popupHostRoute = extractOriginAndPathname(lastPopupHostUrl);
        if (!popupHostRoute || !nextHostRoute || nextHostRoute !== popupHostRoute) {
            closeActivePopups();
        }
    };
    const unsubscribeHostNavigation = subscribeHostNavigation(host, onHostNavigate);
    contents.on?.('render-process-gone', closeActivePopups);
    contents.on?.('destroyed', () => {
        unsubscribeHostNavigation();
        closeActivePopups();
    });
    const getOpenerOrigin = (details) => {
        const frameOrigin = details?.frame?.origin;
        if (frameOrigin === 'null') {
            return 'null';
        }
        const mainFrame = contents.mainFrame;
        const mainFrameHasUncommittedBlankUrl = typeof mainFrame?.url === 'string' && isBlankPopupUrl(mainFrame.url);
        if (mainFrame?.origin === 'null' && !mainFrameHasUncommittedBlankUrl) {
            return 'null';
        }
        if (frameOrigin) {
            return frameOrigin;
        }
        if (mainFrame?.origin && mainFrame.origin !== 'null') {
            return mainFrame.origin;
        }
        const currentUrl = contents.getURL?.();
        if (currentUrl && !isBlankPopupUrl(currentUrl)) {
            return currentUrl;
        }
        return details?.referrer?.url;
    };
    if (host && (0, webviewSecurityState_1.isSecurityTrackableContents)(contents)) {
        (0, webviewSecurityState_1.trackGuestSecurityState)(contents, {
            ownerId: host.id,
            onChange: (state) => {
                if (!host.isDestroyed()) {
                    host.send(webviewSecurityState_1.WEBVIEW_SECURITY_STATE_CHANNEL, state);
                }
            },
        });
    }
    const forwardNewTabToHost = (url) => {
        if (host && !host.isDestroyed()) {
            host.send(exports.WEBVIEW_OPEN_NEW_TAB_CHANNEL, url, webContentsId);
        }
    };
    let currentFaviconDocUrl = contents.getURL?.() || '';
    let lastFaviconOrigin = extractHttpOrigin(currentFaviconDocUrl);
    let lastFaviconDataUrl;
    let inFlightFaviconPromise = null;
    let faviconSeq = 0;
    const forwardFaviconToHost = (documentUrl, dataUrl) => {
        if (host && !host.isDestroyed()) {
            host.send(exports.WEBVIEW_FAVICON_UPDATED_CHANNEL, {
                webContentsId,
                documentUrl,
                dataUrl,
            });
        }
    };
    const getActiveFaviconDocUrl = () => !isBlankPopupUrl(currentFaviconDocUrl)
        ? currentFaviconDocUrl
        : contents.getURL?.() || '';
    const resolveAndPublishFavicons = async (rawCandidates) => {
        const docUrl = getActiveFaviconDocUrl();
        const docOrigin = extractHttpOrigin(docUrl);
        if (!docOrigin) {
            return;
        }
        lastFaviconOrigin = docOrigin;
        const seq = ++faviconSeq;
        const candidates = Array.from(new Set([...rawCandidates, `${docOrigin}/favicon.ico`]
            .map((raw) => (typeof raw === 'string' ? raw.trim() : ''))
            .filter(Boolean)));
        for (const candidate of candidates) {
            const dataUrl = await fetchFaviconCandidateInMain(guestSession, candidate, docOrigin);
            if (seq !== faviconSeq || contents.isDestroyed?.()) {
                return;
            }
            if (dataUrl) {
                lastFaviconDataUrl = dataUrl;
                lastFaviconOrigin = docOrigin;
                forwardFaviconToHost(getActiveFaviconDocUrl() || docUrl, dataUrl);
                return;
            }
        }
    };
    contents.on?.('did-start-navigation', (event, navigationUrl, _isInPlace, isMainFrameArg) => {
        if (isMainFrameNavigationEvent(event, isMainFrameArg)) {
            closeActivePopupsIfCrossOrigin(navigationUrl);
            if (!inFlightWebviewOrigin) {
                inFlightWebviewOrigin = extractHttpOrigin(navigationUrl);
            }
        }
    });
    contents.on?.('did-navigate', (_event, navigationUrl) => {
        closeActivePopupsIfCrossOrigin(navigationUrl);
        inFlightWebviewOrigin = undefined;
        if (!isBlankPopupUrl(navigationUrl)) {
            hasCommittedWebviewNavigation = true;
            currentFaviconDocUrl = navigationUrl;
            const nextOrigin = extractHttpOrigin(navigationUrl);
            if (nextOrigin !== lastFaviconOrigin) {
                faviconSeq++;
                inFlightFaviconPromise = null;
                lastFaviconOrigin = nextOrigin;
                lastFaviconDataUrl = undefined;
                forwardFaviconToHost(navigationUrl, '');
            }
            else if (nextOrigin && lastFaviconDataUrl) {
                forwardFaviconToHost(navigationUrl, lastFaviconDataUrl);
            }
        }
    });
    contents.on?.('did-navigate-in-page', (event, navigationUrl, isMainFrameArg) => {
        if (!isMainFrameNavigationEvent(event, isMainFrameArg) ||
            isBlankPopupUrl(navigationUrl)) {
            return;
        }
        currentFaviconDocUrl = navigationUrl;
        if (lastFaviconDataUrl) {
            forwardFaviconToHost(navigationUrl, lastFaviconDataUrl);
        }
    });
    contents.on?.('page-favicon-updated', (_event, favicons) => {
        const promise = resolveAndPublishFavicons(Array.isArray(favicons) ? favicons : []);
        inFlightFaviconPromise = promise;
        void promise.finally(() => {
            if (inFlightFaviconPromise === promise) {
                inFlightFaviconPromise = null;
            }
        });
    });
    contents.on?.('did-stop-loading', () => {
        const docUrl = getActiveFaviconDocUrl();
        const docOrigin = extractHttpOrigin(docUrl);
        if (!docOrigin || (lastFaviconDataUrl && lastFaviconOrigin === docOrigin)) {
            if (docOrigin && lastFaviconDataUrl && lastFaviconOrigin === docOrigin) {
                forwardFaviconToHost(docUrl, lastFaviconDataUrl);
            }
            return;
        }
        const pendingFavicon = inFlightFaviconPromise;
        void (async () => {
            if (pendingFavicon) {
                await pendingFavicon;
            }
            if (contents.isDestroyed?.() ||
                getActiveFaviconDocUrl() !== docUrl ||
                (lastFaviconDataUrl && lastFaviconOrigin === docOrigin)) {
                return;
            }
            const seqAtStop = faviconSeq;
            let isolatedLinks = [];
            try {
                const raw = await contents.executeJavaScriptInIsolatedWorld?.(FAVICON_ISOLATED_WORLD_ID, [{ code: ISOLATED_FAVICON_LINKS_SCRIPT }], false);
                if (Array.isArray(raw)) {
                    isolatedLinks = raw.filter((item) => typeof item === 'string');
                }
            }
            catch {
                // Ignore isolated-world query errors if guest navigated or closed.
            }
            if (seqAtStop === faviconSeq &&
                !contents.isDestroyed?.() &&
                !(lastFaviconDataUrl && lastFaviconOrigin === docOrigin)) {
                await resolveAndPublishFavicons(isolatedLinks);
            }
        })();
    });
    const createWebviewNavigationListener = (isRedirect) => (event, navigationUrl, _isInPlace, isMainFrameArg) => {
        const isMainFrame = isMainFrameNavigationEvent(event, isMainFrameArg);
        if (isExternalOnlyAuthUrl(navigationUrl)) {
            event.preventDefault();
            if (isMainFrame) {
                void openExternal(navigationUrl);
            }
            return;
        }
        const baseOrigin = getOpenerOrigin();
        let validationOrigin;
        if (baseOrigin !== undefined) {
            validationOrigin =
                isRedirect &&
                    inFlightWebviewOrigin &&
                    !isLoopbackOrigin(inFlightWebviewOrigin)
                    ? inFlightWebviewOrigin
                    : baseOrigin;
        }
        else if (!hasCommittedWebviewNavigation) {
            validationOrigin =
                isRedirect && inFlightWebviewOrigin
                    ? inFlightWebviewOrigin
                    : extractHttpOrigin(navigationUrl);
        }
        if (!validateWebviewNavigationUrl(navigationUrl, validationOrigin).allowed) {
            event.preventDefault();
            return;
        }
        if (isMainFrame) {
            closeActivePopupsIfCrossOrigin(navigationUrl);
            inFlightWebviewOrigin = extractHttpOrigin(navigationUrl);
        }
    };
    contents.on?.('will-navigate', createWebviewNavigationListener(false));
    contents.on?.('will-redirect', createWebviewNavigationListener(true));
    contents.setWindowOpenHandler((details) => {
        if (isExternalOnlyAuthUrl(details.url)) {
            void openExternal(details.url);
            return { action: 'deny' };
        }
        const openerOrigin = getOpenerOrigin(details);
        const blankPopup = isBlankPopupUrl(details.url);
        const urlValidation = blankPopup
            ? { allowed: true }
            : validateWebviewNavigationUrl(details.url, openerOrigin);
        if (isPopupWindowRequest(details)) {
            if (!urlValidation.allowed) {
                return { action: 'deny' };
            }
            const currentTime = now();
            if (lastUserActivationMs <= 0 ||
                currentTime - lastUserActivationMs > exports.POPUP_USER_ACTIVATION_WINDOW_MS) {
                return { action: 'deny' };
            }
            if (activePopups.size >= exports.MAX_CONCURRENT_POPUPS_PER_WEBVIEW) {
                return { action: 'deny' };
            }
            if (lastPopupOpenedMs > 0 &&
                currentTime - lastPopupOpenedMs < exports.MIN_POPUP_INTERVAL_MS) {
                return { action: 'deny' };
            }
            lastPopupOpenedMs = currentTime;
            lastPopupInitialUrl = details.url;
            lastPopupOpenerOrigin = openerOrigin;
            lastPopupHostUrl = host?.getURL?.();
            const { width, height } = parsePopupWindowDimensions(details.features || '');
            const parentWindow = getParentWindow() ?? undefined;
            let x;
            let y;
            if (parentWindow &&
                !parentWindow.isDestroyed?.() &&
                typeof parentWindow.getBounds === 'function') {
                const bounds = parentWindow.getBounds();
                if (bounds &&
                    Number.isFinite(bounds.x) &&
                    Number.isFinite(bounds.y) &&
                    Number.isFinite(bounds.width) &&
                    Number.isFinite(bounds.height)) {
                    x = Math.round(bounds.x + Math.max(0, (bounds.width - width) / 2));
                    y = Math.round(bounds.y + Math.max(0, (bounds.height - height) / 2));
                }
            }
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width,
                    height,
                    x: x ?? 120,
                    y: y ?? 80,
                    ...(parentWindow && !parentWindow.isDestroyed?.()
                        ? { parent: parentWindow }
                        : {}),
                    title: formatPopupWindowTitle(details.url),
                    titleBarStyle: 'default',
                    frame: true,
                    modal: false,
                    show: !(0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(webContentsId),
                    movable: true,
                    resizable: true,
                    maximizable: true,
                    minimizable: true,
                    closable: true,
                    focusable: true,
                    hasShadow: true,
                    roundedCorners: true,
                    thickFrame: true,
                    type: 'normal',
                    autoHideMenuBar: true,
                    fullscreen: false,
                    fullscreenable: false,
                    kiosk: false,
                    alwaysOnTop: false,
                    transparent: false,
                    opacity: 1,
                    skipTaskbar: false,
                    webPreferences: {
                        sandbox: true,
                        contextIsolation: true,
                        nodeIntegration: false,
                        nodeIntegrationInWorker: false,
                        nodeIntegrationInSubFrames: false,
                        webviewTag: false,
                        navigateOnDragDrop: false,
                        enableBlinkFeatures: '',
                        session: guestSession,
                    },
                },
            };
        }
        if (!blankPopup && urlValidation.allowed) {
            forwardNewTabToHost(details.url);
        }
        return { action: 'deny' };
    });
    contents.on?.('did-create-window', (childWindow, details) => {
        (0, utils_1.markWebviewPopupWindow)(childWindow);
        activePopups.add(childWindow);
        popupOpenedWhileUnmuted = contents.isAudioMuted?.() === false;
        lastPopupOpenerOrigin = lastPopupOpenerOrigin ?? getOpenerOrigin();
        lastPopupHostUrl = lastPopupHostUrl ?? host?.getURL?.();
        ensurePopupVisibilityTimer();
        const cleanupPopup = () => {
            activePopups.delete(childWindow);
            if (activePopups.size === 0) {
                stopPopupVisibilityTimer();
            }
        };
        const closePopupIfOpen = () => {
            if (!childWindow.isDestroyed?.()) {
                childWindow.close?.();
            }
        };
        childWindow.once?.('closed', cleanupPopup);
        childWindow.webContents?.once?.('destroyed', cleanupPopup);
        const initialOpenerOrigin = lastPopupOpenerOrigin ?? getOpenerOrigin();
        const initialRequestedUrl = details?.url ||
            childWindow.webContents?.getURL?.() ||
            lastPopupInitialUrl;
        const initialPopupOrigin = extractHttpOrigin(initialRequestedUrl);
        let hasCommittedFirstNavigation = false;
        let currentPopupUrl = initialRequestedUrl;
        let currentPageTitle;
        let inFlightMainFrameOrigin;
        const updatePopupTitle = (rawUrl, pageTitle) => {
            childWindow.setTitle?.(formatPopupWindowTitle(rawUrl, pageTitle));
        };
        updatePopupTitle(currentPopupUrl);
        childWindow.on?.('page-title-updated', (event, title) => {
            event.preventDefault();
            currentPageTitle = title;
            const displayUrl = !isBlankPopupUrl(currentPopupUrl)
                ? currentPopupUrl
                : childWindow.webContents?.getURL?.() || currentPopupUrl;
            updatePopupTitle(displayUrl, title);
        });
        const getPopupBaseValidationOrigin = () => {
            if (hasCommittedFirstNavigation) {
                return extractHttpOrigin(currentPopupUrl) ?? 'null';
            }
            if (initialPopupOrigin && !isLoopbackOrigin(initialPopupOrigin)) {
                return initialPopupOrigin;
            }
            if (initialOpenerOrigin && !isLoopbackOrigin(initialOpenerOrigin)) {
                return initialOpenerOrigin;
            }
            return initialPopupOrigin ?? initialOpenerOrigin;
        };
        const createChildNavigationListener = (isRedirect) => (event, navigationUrl, _isInPlace, isMainFrameArg) => {
            const isMainFrame = isMainFrameNavigationEvent(event, isMainFrameArg);
            if (isExternalOnlyAuthUrl(navigationUrl)) {
                event.preventDefault();
                if (isMainFrame) {
                    void openExternal(navigationUrl);
                    closePopupIfOpen();
                }
                return;
            }
            const baseOrigin = getPopupBaseValidationOrigin();
            const validationOrigin = isRedirect &&
                inFlightMainFrameOrigin &&
                !isLoopbackOrigin(inFlightMainFrameOrigin)
                ? inFlightMainFrameOrigin
                : baseOrigin;
            if (!validateWebviewNavigationUrl(navigationUrl, validationOrigin)
                .allowed) {
                event.preventDefault();
                if (isMainFrame && !hasCommittedFirstNavigation) {
                    closePopupIfOpen();
                }
                return;
            }
            if (isMainFrame) {
                inFlightMainFrameOrigin = extractHttpOrigin(navigationUrl);
            }
        };
        childWindow.webContents?.on?.('will-navigate', createChildNavigationListener(false));
        childWindow.webContents?.on?.('will-redirect', createChildNavigationListener(true));
        childWindow.webContents?.on?.('did-navigate', (_event, navigationUrl) => {
            if (isBlankPopupUrl(navigationUrl) && !hasCommittedFirstNavigation) {
                return;
            }
            inFlightMainFrameOrigin = undefined;
            currentPopupUrl = navigationUrl;
            currentPageTitle = undefined;
            if (!isBlankPopupUrl(navigationUrl)) {
                hasCommittedFirstNavigation = true;
            }
            updatePopupTitle(navigationUrl);
        });
        childWindow.webContents?.on?.('did-navigate-in-page', (event, navigationUrl, isMainFrameArg) => {
            if (!isMainFrameNavigationEvent(event, isMainFrameArg)) {
                return;
            }
            currentPopupUrl = navigationUrl;
            updatePopupTitle(navigationUrl, currentPageTitle);
        });
        childWindow.webContents?.setWindowOpenHandler?.((nestedDetails) => {
            if (isExternalOnlyAuthUrl(nestedDetails.url)) {
                void openExternal(nestedDetails.url);
                return { action: 'deny' };
            }
            const openerOrigin = getPopupBaseValidationOrigin();
            if (!isBlankPopupUrl(nestedDetails.url) &&
                validateWebviewNavigationUrl(nestedDetails.url, openerOrigin).allowed) {
                forwardNewTabToHost(nestedDetails.url);
            }
            return { action: 'deny' };
        });
        (0, webviewDownloadRouting_1.trackChildPopupDownloadLifecycle)({
            childWindow,
            openerContents: contents,
            isBlankPopupUrl,
            hasCommittedNavigation: () => hasCommittedFirstNavigation,
        });
    });
}
