"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_INLINE_PDF_DOWNLOAD_BYTES = exports.APPROVED_REDOWNLOAD_TOKEN_TTL_MS = exports.HUMAN_DOWNLOAD_AFTER_RELEASE_ACTIVATION_WINDOW_MS = exports.EXTERNAL_LAUNCH_DEDUPE_WINDOW_MS = exports.MIN_EXTERNAL_LAUNCH_INTERVAL_MS = exports.POPUP_USER_ACTIVATION_WINDOW_MS = exports.MIN_POPUP_INTERVAL_MS = exports.MAX_CONCURRENT_POPUPS_PER_WEBVIEW = exports.MAX_PENDING_APPROVALS_PER_GUEST = exports.MAX_DOWNLOAD_URL_CHAIN_ENTRY_LENGTH = exports.MAX_DOWNLOAD_URL_CHAIN_ENTRIES = exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL = exports.WEBVIEW_FAVICON_UPDATED_CHANNEL = exports.WEBVIEW_OPEN_NEW_TAB_CHANNEL = exports.AGENT_DOWNLOAD_APPROVAL_TIMEOUT_MS = void 0;
exports.isExternalOnlyAuthUrl = isExternalOnlyAuthUrl;
exports.isOAuthPopupUrl = isOAuthPopupUrl;
exports.validateWebviewNavigationUrl = validateWebviewNavigationUrl;
exports.isPopupWindowRequest = isPopupWindowRequest;
exports.parsePopupWindowDimensions = parsePopupWindowDimensions;
exports.clearWebviewFaviconCacheForTesting = clearWebviewFaviconCacheForTesting;
exports.isOwnedBrowserGuestWebContents = isOwnedBrowserGuestWebContents;
exports.clearTrackedWebviewDownloadsForTesting = clearTrackedWebviewDownloadsForTesting;
exports.openTrackedWebviewDownload = openTrackedWebviewDownload;
exports.showTrackedWebviewDownloadInFolder = showTrackedWebviewDownloadInFolder;
exports.cancelTrackedWebviewDownload = cancelTrackedWebviewDownload;
exports.resolveTrackedWebviewDownload = resolveTrackedWebviewDownload;
exports.setGuestAgentControlled = setGuestAgentControlled;
exports.setGuestDownloadDirectory = setGuestDownloadDirectory;
exports.configureWebviewBrowserContents = configureWebviewBrowserContents;
const electron_1 = require("electron");
const utils_1 = require("./utils");
const faviconStore_1 = require("./faviconStore");
const webviewSecurityState_1 = require("./webviewSecurityState");
const guestNetworkController_1 = require("./guestNetworkController");
const webviewDownloadRouting_1 = require("./webviewDownloadRouting");
Object.defineProperty(exports, "AGENT_DOWNLOAD_APPROVAL_TIMEOUT_MS", { enumerable: true, get: function () { return webviewDownloadRouting_1.AGENT_DOWNLOAD_APPROVAL_TIMEOUT_MS; } });
const crypto_1 = require("crypto");
/** IPC channel sent to the host renderer when a `<webview>` requests a new tab. */
exports.WEBVIEW_OPEN_NEW_TAB_CHANNEL = 'webview:open-new-tab';
/** IPC channel sent to the host renderer when a `<webview>` guest's favicon updates. */
exports.WEBVIEW_FAVICON_UPDATED_CHANNEL = 'webview:favicon-updated';
const guestAgentControl_1 = require("./guestAgentControl");
const guestPermissionPolicy_1 = require("./guestPermissionPolicy");
const isolatedWorldExec_1 = require("./isolatedWorldExec");
const MAX_INLINE_FAVICON_BYTES = 8 * 1024;
const MAX_FAVICON_DATA_URL_LENGTH = Math.ceil((MAX_INLINE_FAVICON_BYTES * 4) / 3) + 64;
const MAX_FAVICON_REDIRECTS = 5;
const FAVICON_ISOLATED_WORLD_ID = 9998;
const ISOLATED_FAVICON_LINKS_SCRIPT = 'Array.from(document.querySelectorAll(\'link[rel~="icon" i]\')).map((el) => el.href).filter(Boolean)';
/** IPC channel sent to the host renderer when a guest download progresses or finishes. */
exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL = 'webview:download-progress';
/**
 * Maximum number of `urlChain` entries sent. Chains of up to 32 URLs are sent
 * whole; a longer chain is sent as its first 33 entries (the head, so hop 0
 * is always kept), letting the receiver detect it and cancel the download.
 */
exports.MAX_DOWNLOAD_URL_CHAIN_ENTRIES = 33;
/** Maximum length of each `urlChain` entry. */
exports.MAX_DOWNLOAD_URL_CHAIN_ENTRY_LENGTH = 2048;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDownloadUrlChain(item, url) {
    let chain;
    try {
        chain = item?.getURLChain?.();
    }
    catch {
        chain = undefined;
    }
    const entries = (Array.isArray(chain) ? chain : [url]).filter((u) => typeof u === 'string');
    // Keep the head, never the tail, so the initial URL is always reported.
    return entries
        .slice(0, exports.MAX_DOWNLOAD_URL_CHAIN_ENTRIES)
        .map((u) => u.slice(0, exports.MAX_DOWNLOAD_URL_CHAIN_ENTRY_LENGTH));
}
/**
 * Maximum number of agent downloads one guest may have awaiting approval at
 * once; further agent downloads from that guest are cancelled immediately.
 */
exports.MAX_PENDING_APPROVALS_PER_GUEST = 8;
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
/** Minimum interval (ms) between external system-browser launches per guest. */
exports.MIN_EXTERNAL_LAUNCH_INTERVAL_MS = 1000;
/** Cooldown window (ms) suppressing duplicate launches of the same external URL. */
exports.EXTERNAL_LAUNCH_DEDUPE_WINDOW_MS = 5000;
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
/** AWS EC2 IPv6 instance metadata endpoint `fd00:ec2::254`. */
const AWS_IPV6_IMDS_GROUPS = [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254];
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
const OAUTH_DEDICATED_HOSTS = new Set([
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'login.yahoo.com',
]);
const OAUTH_HOST_SUFFIXES = [
    '.auth0.com',
    '.okta.com',
    '.oktapreview.com',
    '.onelogin.com',
    '.duosecurity.com',
];
const OAUTH_PATH_SEGMENT_RE = /\/(?:o\/oauth2|oauth2?\/(?:authori[zs](?:e|ation)|auth|v\d+(?:\.\d+)?\/(?:authori[zs](?:e|ation)|auth))|(?:signin|login)\/oauth2?|connect\/authori[zs](?:e|ation)|protocol\/openid-connect\/auth)(?:\/|$)/;
const OAUTH_IDP_LOGIN_PATH_RE = /^\/(?:authori[zs](?:e|ation)|oauth2?|login|u\/login|idp\/idx|app\/[^/]+\/sso)(?:\/|$)/;
/**
 * Returns `true` when `rawUrl` targets an HTTP(S) OAuth or OIDC authorization
 * popup endpoint that requires a framed child `BrowserWindow` rather than a
 * tab navigation.
 */
function isOAuthPopupUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return false;
    }
    const host = normalizeHostname(parsed.hostname);
    if (!host) {
        return false;
    }
    const pathname = parsed.pathname.toLowerCase();
    if (OAUTH_DEDICATED_HOSTS.has(host)) {
        return true;
    }
    if ((host === 'github.com' || host === 'www.github.com') &&
        (pathname === '/login/oauth' ||
            pathname.startsWith('/login/oauth/') ||
            pathname === '/login/device' ||
            pathname.startsWith('/login/device/'))) {
        return true;
    }
    if (host === 'appleid.apple.com' &&
        (pathname === '/auth' || pathname.startsWith('/auth/'))) {
        return true;
    }
    if ((host === 'facebook.com' || host === 'www.facebook.com') &&
        /^\/(?:v\d+\.\d+\/)?dialog\/oauth(?:\/|$)/.test(pathname)) {
        return true;
    }
    if (host === 'slack.com' &&
        /^\/oauth\/(?:v2\/)?authorize(?:\/|$)/.test(pathname)) {
        return true;
    }
    if (host === 'discord.com' &&
        /^\/(?:api\/)?oauth2\/authorize(?:\/|$)/.test(pathname)) {
        return true;
    }
    if (OAUTH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) &&
        OAUTH_IDP_LOGIN_PATH_RE.test(pathname)) {
        return true;
    }
    if (OAUTH_PATH_SEGMENT_RE.test(pathname)) {
        return true;
    }
    if (/(?:^|\/)(?:authori[zs](?:e|ation)|auth)(?:\/|$)/.test(pathname) &&
        parsed.searchParams.has('client_id') &&
        (parsed.searchParams.has('redirect_uri') ||
            parsed.searchParams.has('response_type'))) {
        return true;
    }
    return false;
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
/**
 * Returns `true` for cloud metadata IP literals outside link-local ranges:
 * Alibaba Cloud `100.100.100.200` (including IPv4-mapped IPv6) and AWS EC2
 * IPv6 IMDS `fd00:ec2::254`.
 */
function isCloudMetadataIp(hostname) {
    const host = normalizeHostname(hostname);
    const v4 = parseIpv4Octets(host) ?? extractMappedIpv4FromIpv6(host);
    if (v4) {
        return v4.join('.') === '100.100.100.200';
    }
    const groups = parseIpv6Groups(host);
    return (groups !== null &&
        groups.every((group, i) => group === AWS_IPV6_IMDS_GROUPS[i]));
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
 *   `metadata.goog`, `*.metadata.goog`), metadata IPs (`100.100.100.200`,
 *   `fd00:ec2::254`), and link-local addresses (`169.254.0.0/16`,
 *   `fe80::/10`) are always blocked.
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
        isLinkLocalHost(host) ||
        isCloudMetadataIp(host)) {
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
/** Clears the main-process favicon cache for hermetic unit tests. */
function clearWebviewFaviconCacheForTesting() {
    (0, faviconStore_1.clearFaviconStoreForTesting)();
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
    if (buf.byteLength === 0 || buf.byteLength > faviconStore_1.MAX_RAW_FAVICON_BYTES) {
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
/**
 * Returns whether a favicon URL may be fetched: the navigation policy, plus the
 * document's own origin when that origin is a private-network IP literal.
 */
function isFaviconFetchUrlAllowed(url, docOrigin) {
    if (validateWebviewNavigationUrl(url, docOrigin).allowed) {
        return true;
    }
    if (docOrigin === undefined || extractHttpOrigin(url) !== docOrigin) {
        return false;
    }
    const host = new URL(url).hostname;
    return isPrivateNetworkHost(host) && !isCloudMetadataIp(host);
}
async function fetchFaviconCandidateInMain(guestSession, candidateUrl, docOrigin) {
    const trimmed = candidateUrl.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.startsWith('data:')) {
        return trimmed.startsWith('data:image/') &&
            trimmed.length <= MAX_FAVICON_DATA_URL_LENGTH
            ? { dataUrl: trimmed }
            : undefined;
    }
    if (!isFaviconFetchUrlAllowed(trimmed, docOrigin)) {
        return undefined;
    }
    const sessionKey = getSessionCacheKey(guestSession);
    const cached = (0, faviconStore_1.getCachedFavicon)(sessionKey, trimmed);
    if (cached) {
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
                if (!isFaviconFetchUrlAllowed(redirectTarget, docOrigin)) {
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
                    contentLength > faviconStore_1.MAX_RAW_FAVICON_BYTES) {
                    return undefined;
                }
            }
            const buf = Buffer.from(await response.arrayBuffer());
            const mimeType = sniffImageMimeType(buf, response.headers?.get?.('content-type'));
            const dataUrl = mimeType
                ? encodeFaviconBufferToDataUrl(buf, mimeType)
                : undefined;
            return (0, faviconStore_1.resolveFaviconBytes)(sessionKey, trimmed, buf, mimeType, dataUrl);
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
const webviewPopupSecurity_1 = require("./webviewPopupSecurity");
function formatPopupWindowTitle(rawUrl, pageTitle, securityLabel) {
    const originPrefix = formatOriginPrefix(rawUrl);
    const prefix = securityLabel
        ? `${securityLabel} ${originPrefix}`
        : originPrefix;
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
const configuredWebviewById = new Map();
const configuredWebviewInitialOriginById = new Map();
/**
 * Consume-once getter for a guest's in-flight armed main-frame directory.
 * Passing `peek = true` reports the directory without consuming it.
 */
const configuredWebviewInFlightArmedDirById = new Map();
/** Per-guest agent-control predicates (including `options.isAgentControlled`). */
const configuredWebviewAgentControlledById = new Map();
/** Per-guest time of the last real input activation (never consumed). */
const configuredWebviewLastInputActivationMsById = new Map();
/**
 * A download from a guest that stopped being agent-controlled less than a
 * minute ago is still treated as the agent's, unless the user clicked or
 * typed in that guest after it was released and within this window before
 * the download started (e.g. a human download right after Take over).
 */
exports.HUMAN_DOWNLOAD_AFTER_RELEASE_ACTIVATION_WINDOW_MS = 10000;
const configuredDownloadSessions = new WeakSet();
const inFlightInlinePdfDownloads = new Map();
const hostByGuestContents = new WeakMap();
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
const MAX_TRACKED_DOWNLOADS = 256;
const DOWNLOAD_ID_RE = /^dl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const trackedDownloadsById = new Map();
/** Agent downloads awaiting approval, keyed by owning guest webContents id. */
const pendingApprovalCountByGuestWcId = new Map();
/**
 * How long an approved agent download may take to come back through
 * `will-download` after Hub re-requests it with `downloadURL()`.
 */
exports.APPROVED_REDOWNLOAD_TOKEN_TTL_MS = 30000;
const approvedRedownloadTokens = new Set();
/** Removes and returns the token matching this download, if any. */
function takeApprovedRedownloadToken(guestSession, rawWcId, openerWcId, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
item) {
    if (approvedRedownloadTokens.size === 0) {
        return undefined;
    }
    const urls = collectItemCandidateUrls(item);
    for (const token of approvedRedownloadTokens) {
        const sameGuest = token.guestWcId === rawWcId ||
            token.guestWcId === openerWcId ||
            (rawWcId <= 0 && openerWcId <= 0);
        if (token.guestSession === guestSession &&
            sameGuest &&
            urls.has(token.url)) {
            approvedRedownloadTokens.delete(token);
            return token;
        }
    }
    return undefined;
}
/**
 * Site key a download URL is approved for: the host for http(s), the
 * creator origin for blob:, and the scheme otherwise (e.g. `data:`).
 */
function downloadUrlSiteKey(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
        }
        if (parsed.protocol === 'blob:') {
            return `blob:${parsed.origin}`;
        }
        return parsed.protocol;
    }
    catch {
        return '';
    }
}
/**
 * URLs of Hub-started inline-PDF re-fetches whose agent owner went away (or
 * whose entry expired) before Chromium reported the download. A late
 * `will-download` for one of them is cancelled instead of being saved to the
 * default downloads folder.
 */
const droppedInlinePdfUrlTombstones = new Map();
/**
 * Per-webContents callbacks run once when it is destroyed. A single
 * `destroyed` listener is attached per webContents no matter how many pending
 * agent downloads it owns, so many downloads cannot trip max-listener limits.
 */
const destroyedCallbacksByContents = new WeakMap();
/**
 * Runs `callback` when `contents` is destroyed (immediately if it already is).
 * Returns a function that unregisters the callback.
 */
function onContentsDestroyed(contents, callback) {
    if (!contents || typeof contents !== 'object') {
        return () => { };
    }
    const source = contents;
    if (source.isDestroyed?.()) {
        callback();
        return () => { };
    }
    let callbacks = destroyedCallbacksByContents.get(contents);
    if (!callbacks) {
        const created = new Set();
        callbacks = created;
        destroyedCallbacksByContents.set(contents, created);
        const runAll = () => {
            const pending = Array.from(created);
            created.clear();
            for (const cb of pending) {
                try {
                    cb();
                }
                catch {
                    // Keep running the remaining callbacks.
                }
            }
        };
        if (typeof source.once === 'function') {
            source.once('destroyed', runAll);
        }
        else {
            source.on?.('destroyed', runAll);
        }
    }
    callbacks.add(callback);
    const registered = callbacks;
    return () => {
        registered.delete(callback);
    };
}
function isTerminalDownloadState(state) {
    return (state === 'completed' || state === 'cancelled' || state === 'interrupted');
}
function upsertTrackedDownload(record) {
    if (!trackedDownloadsById.has(record.id) &&
        trackedDownloadsById.size >= MAX_TRACKED_DOWNLOADS) {
        let victimId;
        for (const [id, existing] of trackedDownloadsById) {
            if (isTerminalDownloadState(existing.state)) {
                victimId = id;
                break;
            }
        }
        if (victimId === undefined) {
            victimId = trackedDownloadsById.keys().next().value;
        }
        if (victimId !== undefined) {
            const victim = trackedDownloadsById.get(victimId);
            trackedDownloadsById.delete(victimId);
            // An untracked in-flight download could never be resolved or cancelled
            // through IPC again, so cancel it rather than leave it running/paused.
            if (victim && !isTerminalDownloadState(victim.state)) {
                const cancelFn = victim.cancel;
                victim.cancel = undefined;
                try {
                    cancelFn?.();
                }
                catch {
                    // Chromium reports the outcome through `done`.
                }
            }
        }
    }
    trackedDownloadsById.set(record.id, record);
}
/** Clears tracked main-process download records for hermetic unit tests. */
function clearTrackedWebviewDownloadsForTesting() {
    trackedDownloadsById.clear();
    pendingApprovalCountByGuestWcId.clear();
    approvedRedownloadTokens.clear();
    (0, webviewDownloadRouting_1.clearAgentControlTombstonesForTesting)();
    (0, webviewDownloadRouting_1.clearAgentControlledGuestsForTesting)();
    droppedInlinePdfUrlTombstones.clear();
}
/**
 * Opens a completed download identified by `downloadId` when owned by
 * `callerHostWcId`. Executable, script, and shortcut extensions are revealed in
 * the OS file manager instead of being launched directly via `shell.openPath`.
 */
async function openTrackedWebviewDownload(callerHostWcId, downloadId, options) {
    if (typeof callerHostWcId !== 'number' ||
        !Number.isInteger(callerHostWcId) ||
        typeof downloadId !== 'string' ||
        !DOWNLOAD_ID_RE.test(downloadId)) {
        return false;
    }
    const record = trackedDownloadsById.get(downloadId);
    if (!record ||
        record.ownerHostWcId !== callerHostWcId ||
        record.state !== 'completed' ||
        !(0, webviewDownloadRouting_1.isSafeExistingRegularFile)(record.savePath)) {
        return false;
    }
    const platformPath = options?.mapPlatformPath
        ? options.mapPlatformPath(record.savePath)
        : record.savePath;
    if ((0, webviewDownloadRouting_1.isExecutableDownloadPath)(record.savePath)) {
        const showFn = options?.showItemInFolder ?? ((p) => electron_1.shell.showItemInFolder(p));
        try {
            showFn(platformPath);
            return true;
        }
        catch {
            return false;
        }
    }
    const openFn = options?.openPath ?? ((p) => electron_1.shell.openPath(p));
    try {
        const err = await openFn(platformPath);
        return err === '';
    }
    catch {
        return false;
    }
}
/**
 * Reveals a tracked download identified by `downloadId` in the OS file manager
 * when owned by `callerHostWcId` and present on disk as a regular file.
 */
function showTrackedWebviewDownloadInFolder(callerHostWcId, downloadId, options) {
    if (typeof callerHostWcId !== 'number' ||
        !Number.isInteger(callerHostWcId) ||
        typeof downloadId !== 'string' ||
        !DOWNLOAD_ID_RE.test(downloadId)) {
        return false;
    }
    const record = trackedDownloadsById.get(downloadId);
    if (!record ||
        record.ownerHostWcId !== callerHostWcId ||
        !(0, webviewDownloadRouting_1.isSafeExistingRegularFile)(record.savePath)) {
        return false;
    }
    const platformPath = options?.mapPlatformPath
        ? options.mapPlatformPath(record.savePath)
        : record.savePath;
    const showFn = options?.showItemInFolder ?? ((p) => electron_1.shell.showItemInFolder(p));
    try {
        showFn(platformPath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Cancels an in-flight download identified by `downloadId` when owned by
 * `callerHostWcId`.
 */
function cancelTrackedWebviewDownload(callerHostWcId, downloadId) {
    if (typeof callerHostWcId !== 'number' ||
        !Number.isInteger(callerHostWcId) ||
        typeof downloadId !== 'string' ||
        !DOWNLOAD_ID_RE.test(downloadId)) {
        return false;
    }
    const record = trackedDownloadsById.get(downloadId);
    if (!record ||
        record.ownerHostWcId !== callerHostWcId ||
        isTerminalDownloadState(record.state) ||
        typeof record.cancel !== 'function') {
        return false;
    }
    const cancelFn = record.cancel;
    record.cancel = undefined;
    try {
        cancelFn();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Approves (resumes) or denies (cancels) an agent download that is paused in
 * the `awaiting_approval` state, when owned by `callerHostWcId`. Returns false
 * for invalid arguments, unknown or foreign-owned ids, and downloads that are
 * not (or no longer) awaiting approval, so each download resolves at most once.
 */
function resolveTrackedWebviewDownload(callerHostWcId, downloadId, approve) {
    if (typeof callerHostWcId !== 'number' ||
        !Number.isInteger(callerHostWcId) ||
        typeof downloadId !== 'string' ||
        !DOWNLOAD_ID_RE.test(downloadId) ||
        typeof approve !== 'boolean') {
        return false;
    }
    const record = trackedDownloadsById.get(downloadId);
    if (!record ||
        record.ownerHostWcId === undefined ||
        record.ownerHostWcId !== callerHostWcId ||
        record.state !== 'awaiting_approval' ||
        typeof record.resolveApproval !== 'function') {
        return false;
    }
    return record.resolveApproval(approve);
}
/** Marks or clears agent control of a browser guest (see routing module). */
function setGuestAgentControlled(wc, active) {
    return (0, webviewDownloadRouting_1.setGuestAgentControlledForWc)(wc, active);
}
/** Arms or clears the sandbox download directory for a browser guest. */
function setGuestDownloadDirectory(wc, downloadDir) {
    return (0, webviewDownloadRouting_1.setGuestDownloadDirectoryForWc)(wc, downloadDir);
}
const INLINE_PDF_DEDUPE_TTL_MS = 60000;
/** Largest inline PDF that Hub re-fetches into an agent download folder. */
exports.MAX_INLINE_PDF_DOWNLOAD_BYTES = 200 * 1024 * 1024;
/** Chromium `net::ERR_ABORTED`, as reported by `did-fail-load`. */
const ERR_ABORTED = -3;
function extractHeaderFirstValue(headers, targetLowerName) {
    if (!headers || typeof headers !== 'object') {
        return '';
    }
    for (const [key, raw] of Object.entries(headers)) {
        if (key.toLowerCase() === targetLowerName) {
            if (Array.isArray(raw)) {
                return typeof raw[0] === 'string' ? raw[0] : '';
            }
            return typeof raw === 'string' ? raw : '';
        }
    }
    return '';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectItemCandidateUrls(item) {
    const urls = new Set();
    const directUrl = item?.getURL?.();
    if (typeof directUrl === 'string' && directUrl) {
        urls.add(directUrl);
    }
    const chain = item?.getURLChain?.();
    if (Array.isArray(chain)) {
        for (const u of chain) {
            if (typeof u === 'string' && u) {
                urls.add(u);
            }
        }
    }
    return urls;
}
function consumeInFlightInlinePdfArmedDir(guestSession, rawWcId, openerWcId, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
item) {
    const urls = collectItemCandidateUrls(item);
    if (urls.size === 0) {
        return undefined;
    }
    for (const candidateWcId of [rawWcId, openerWcId]) {
        if (candidateWcId > 0) {
            for (const u of urls) {
                const inlineKey = `${candidateWcId}:${u}`;
                const entry = inFlightInlinePdfDownloads.get(inlineKey);
                if (entry && !entry.consumed) {
                    entry.consumed = true;
                    return {
                        inlineKey,
                        capturedArmedDir: entry.capturedArmedDir,
                        armedOwnerWcId: entry.armedOwnerWcId,
                        ownerGuestWc: entry.ownerGuestWc,
                    };
                }
            }
        }
    }
    if (rawWcId <= 0 && openerWcId <= 0) {
        // Programmatic `wc.downloadURL(url)` invokes `session`'s `will-download`
        // with `webContents === null` (`rawWcId === 0, openerWcId === 0`).
        for (const [inlineKey, entry] of inFlightInlinePdfDownloads.entries()) {
            if (!entry.consumed &&
                entry.guestSession === guestSession &&
                urls.has(entry.targetUrl)) {
                entry.consumed = true;
                return {
                    inlineKey,
                    capturedArmedDir: entry.capturedArmedDir,
                    armedOwnerWcId: entry.armedOwnerWcId,
                    ownerGuestWc: entry.ownerGuestWc,
                };
            }
        }
    }
    return undefined;
}
function clearInlinePdfDedupeForItem(guestSession, rawWcId, openerWcId, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
item, matchedInlineKey) {
    if (matchedInlineKey) {
        const matched = inFlightInlinePdfDownloads.get(matchedInlineKey);
        if (matched !== undefined) {
            clearTimeout(matched.timer);
            inFlightInlinePdfDownloads.delete(matchedInlineKey);
        }
        return;
    }
    const urls = collectItemCandidateUrls(item);
    if (urls.size === 0) {
        return;
    }
    for (const candidateWcId of [rawWcId, openerWcId]) {
        if (candidateWcId > 0) {
            for (const u of urls) {
                const key = `${candidateWcId}:${u}`;
                const entry = inFlightInlinePdfDownloads.get(key);
                if (entry !== undefined) {
                    clearTimeout(entry.timer);
                    inFlightInlinePdfDownloads.delete(key);
                }
            }
        }
    }
    if (rawWcId <= 0 && openerWcId <= 0) {
        for (const [key, entry] of inFlightInlinePdfDownloads.entries()) {
            if (entry.consumed &&
                entry.guestSession === guestSession &&
                urls.has(entry.targetUrl)) {
                clearTimeout(entry.timer);
                inFlightInlinePdfDownloads.delete(key);
                break;
            }
        }
    }
}
function clearInlinePdfDedupeForOwner(ownerWcId) {
    if (ownerWcId <= 0) {
        return;
    }
    const prefix = `${ownerWcId}:`;
    for (const [key, entry] of inFlightInlinePdfDownloads.entries()) {
        if (key.startsWith(prefix)) {
            clearTimeout(entry.timer);
            inFlightInlinePdfDownloads.delete(key);
            recordDroppedInlinePdfTombstone(entry);
        }
    }
}
/**
 * Remembers an inline-PDF re-fetch that was dropped before its download
 * started, so a late null-webContents `will-download` for it fails closed.
 */
function recordDroppedInlinePdfTombstone(entry) {
    if (entry.consumed) {
        return;
    }
    droppedInlinePdfUrlTombstones.set(entry.targetUrl, {
        guestSession: entry.guestSession,
        expiresAtMs: Date.now() + webviewDownloadRouting_1.AGENT_CONTROL_TOMBSTONE_TTL_MS,
    });
}
function consumeDroppedInlinePdfTombstone(guestSession, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
item) {
    const nowMs = Date.now();
    for (const [url, tombstone] of droppedInlinePdfUrlTombstones) {
        if (tombstone.expiresAtMs <= nowMs) {
            droppedInlinePdfUrlTombstones.delete(url);
        }
    }
    for (const url of collectItemCandidateUrls(item)) {
        const tombstone = droppedInlinePdfUrlTombstones.get(url);
        if (tombstone && tombstone.guestSession === guestSession) {
            droppedInlinePdfUrlTombstones.delete(url);
            return true;
        }
    }
    return false;
}
/**
 * Whether guest `webContentsId` is, or within the last minute was, under agent
 * control (armed, agent-controlled, or mid armed main-frame navigation).
 */
function isAgentAssociatedGuest(webContentsId) {
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
        return false;
    }
    if ((0, guestAgentControl_1.isGuestAgentControlled)(webContentsId)) {
        return true;
    }
    try {
        if (configuredWebviewAgentControlledById.get(webContentsId)?.() ||
            configuredWebviewInFlightArmedDirById.get(webContentsId)?.(true)) {
            return true;
        }
    }
    catch {
        // Fall through to the tombstone check.
    }
    const releasedAtMs = (0, webviewDownloadRouting_1.getAgentControlReleasedAtMs)(webContentsId);
    if (releasedAtMs === undefined) {
        return false;
    }
    // Recently released (agent step ended, or the user took over). Main cannot
    // tell those apart, so only real input the user gave the guest after the
    // release, shortly before this download, marks it as a human download.
    // Input from before the release may have been the agent's.
    let lastInputMs = 0;
    try {
        lastInputMs =
            configuredWebviewLastInputActivationMsById.get(webContentsId)?.() ?? 0;
    }
    catch {
        lastInputMs = 0;
    }
    const nowMs = Date.now();
    const isHumanAfterRelease = lastInputMs > releasedAtMs &&
        nowMs >= lastInputMs &&
        nowMs - lastInputMs <= exports.HUMAN_DOWNLOAD_AFTER_RELEASE_ACTIVATION_WINDOW_MS;
    return !isHumanAfterRelease;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureSessionDownloadListener(guestSession) {
    if (!guestSession ||
        typeof guestSession.on !== 'function' ||
        configuredDownloadSessions.has(guestSession)) {
        return;
    }
    configuredDownloadSessions.add(guestSession);
    if (typeof guestSession.webRequest?.onHeadersReceived === 'function') {
        guestSession.webRequest.onHeadersReceived(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (details, callback) => {
            callback({ cancel: false });
            if (!details ||
                details.resourceType !== 'mainFrame' ||
                String(details.method || 'GET').toUpperCase() !== 'GET' ||
                typeof details.statusCode !== 'number' ||
                details.statusCode < 200 ||
                details.statusCode >= 300 ||
                typeof details.url !== 'string' ||
                !/^https?:\/\//i.test(details.url)) {
                return;
            }
            const contentType = extractHeaderFirstValue(details.responseHeaders, 'content-type');
            const mimeType = contentType.split(';')[0]?.trim().toLowerCase();
            if (mimeType !== 'application/pdf') {
                return;
            }
            const contentDisposition = extractHeaderFirstValue(details.responseHeaders, 'content-disposition');
            const disposition = contentDisposition
                .split(';')[0]
                ?.trim()
                .toLowerCase();
            if (disposition === 'attachment') {
                return;
            }
            const rawWcId = typeof details.webContentsId === 'number' &&
                Number.isInteger(details.webContentsId) &&
                details.webContentsId > 0
                ? details.webContentsId
                : typeof details.webContents?.id === 'number' &&
                    Number.isInteger(details.webContents.id) &&
                    details.webContents.id > 0
                    ? details.webContents.id
                    : 0;
            const wc = details.webContents ??
                (rawWcId > 0
                    ? (configuredWebviewById.get(rawWcId) ??
                        electron_1.webContents?.fromId?.(rawWcId))
                    : undefined);
            if (!wc || wc.isDestroyed?.() || typeof wc.downloadURL !== 'function') {
                return;
            }
            const openerWc = (0, webviewDownloadRouting_1.resolveOpenerWebContents)(wc);
            const openerWcId = openerWc && !openerWc.isDestroyed?.() ? (openerWc.id ?? 0) : 0;
            const rawArmedDir = (rawWcId > 0 ? (0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(rawWcId) : undefined) ??
                (rawWcId > 0
                    ? configuredWebviewInFlightArmedDirById.get(rawWcId)?.()
                    : undefined);
            // Only consult the opener when the guest itself is not armed: the
            // opener's in-flight getter is consume-once, so reading it here would
            // discard a directory the opener still needs.
            const openerArmedDir = rawArmedDir
                ? undefined
                : ((openerWcId > 0
                    ? (0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(openerWcId)
                    : undefined) ??
                    (openerWcId > 0
                        ? configuredWebviewInFlightArmedDirById.get(openerWcId)?.()
                        : undefined));
            const capturedArmedDir = rawArmedDir ?? openerArmedDir;
            if (!capturedArmedDir) {
                return;
            }
            const armedOwnerWcId = rawArmedDir ? rawWcId : openerWcId;
            const explicitReferrerOrigin = extractHttpOrigin(typeof details.referrer === 'string' ? details.referrer : undefined);
            const fallbackOrigin = extractHttpOrigin(typeof wc.getURL === 'function' ? wc.getURL() : undefined) ??
                extractHttpOrigin(typeof openerWc?.getURL === 'function'
                    ? openerWc.getURL()
                    : undefined) ??
                (rawWcId > 0 && openerWcId === 0
                    ? configuredWebviewInitialOriginById.get(rawWcId)?.()
                    : undefined);
            const referrerOrigin = explicitReferrerOrigin && !isLoopbackOrigin(explicitReferrerOrigin)
                ? explicitReferrerOrigin
                : fallbackOrigin && !isLoopbackOrigin(fallbackOrigin)
                    ? fallbackOrigin
                    : (explicitReferrerOrigin ?? fallbackOrigin);
            if (!validateWebviewNavigationUrl(details.url, referrerOrigin).allowed) {
                return;
            }
            const dedupeOwnerId = rawWcId || openerWcId;
            const inlineKey = `${dedupeOwnerId}:${details.url}`;
            if (inFlightInlinePdfDownloads.has(inlineKey)) {
                return;
            }
            const ttlTimer = setTimeout(() => {
                const expired = inFlightInlinePdfDownloads.get(inlineKey);
                inFlightInlinePdfDownloads.delete(inlineKey);
                if (expired) {
                    recordDroppedInlinePdfTombstone(expired);
                }
            }, INLINE_PDF_DEDUPE_TTL_MS);
            ttlTimer.unref?.();
            inFlightInlinePdfDownloads.set(inlineKey, {
                timer: ttlTimer,
                capturedArmedDir,
                armedOwnerWcId,
                targetUrl: details.url,
                guestSession,
                ownerGuestWc: wc,
            });
            const targetUrl = details.url;
            setImmediate(() => {
                if (wc.isDestroyed?.()) {
                    clearTimeout(ttlTimer);
                    const dropped = inFlightInlinePdfDownloads.get(inlineKey);
                    inFlightInlinePdfDownloads.delete(inlineKey);
                    if (dropped) {
                        recordDroppedInlinePdfTombstone(dropped);
                    }
                    return;
                }
                try {
                    wc.downloadURL(targetUrl);
                }
                catch {
                    clearTimeout(ttlTimer);
                    inFlightInlinePdfDownloads.delete(inlineKey);
                }
            });
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    guestSession.on('will-download', (ev, item, wc) => {
        const isWcAlive = wc && typeof wc === 'object' && !wc.isDestroyed?.();
        const rawWcId = isWcAlive ? (wc.id ?? 0) : 0;
        const openerWc = (0, webviewDownloadRouting_1.resolveOpenerWebContents)(wc);
        const openerWcId = openerWc && !openerWc.isDestroyed?.() ? (openerWc.id ?? 0) : 0;
        // The re-download Hub started for an approved agent download is allowed
        // once, without another prompt, and reported under the original id.
        const approvedToken = takeApprovedRedownloadToken(guestSession, rawWcId, openerWcId, item);
        if (approvedToken) {
            approvedToken.start(item, ev);
            return;
        }
        const liveRawArmedDir = rawWcId > 0 ? (0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(rawWcId) : undefined;
        const liveOpenerArmedDir = openerWcId > 0 ? (0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(openerWcId) : undefined;
        const inlinePdfMatch = consumeInFlightInlinePdfArmedDir(guestSession, rawWcId, openerWcId, item);
        const isArmedGuestOrOpener = Boolean(liveRawArmedDir || liveOpenerArmedDir || inlinePdfMatch);
        const isConfiguredTopLevelGuest = Boolean(wc &&
            typeof wc === 'object' &&
            configuredWebviewContents.has(wc));
        const webContentsId = openerWcId > 0 &&
            (!isConfiguredTopLevelGuest ||
                (!liveRawArmedDir &&
                    (Boolean(liveOpenerArmedDir) ||
                        inlinePdfMatch?.armedOwnerWcId === openerWcId)))
            ? openerWcId
            : rawWcId || openerWcId || inlinePdfMatch?.armedOwnerWcId || 0;
        const inlineOwnerWc = inlinePdfMatch?.ownerGuestWc &&
            !inlinePdfMatch.ownerGuestWc.isDestroyed?.()
            ? inlinePdfMatch.ownerGuestWc
            : undefined;
        const host = (wc && typeof wc === 'object' ? hostByGuestContents.get(wc) : null) ??
            (isWcAlive ? wc.hostWebContents : undefined) ??
            (openerWc ? hostByGuestContents.get(openerWc) : null) ??
            openerWc?.hostWebContents ??
            (inlineOwnerWc ? hostByGuestContents.get(inlineOwnerWc) : null) ??
            inlineOwnerWc?.hostWebContents;
        const closeInitialDownloadPopup = (0, webviewDownloadRouting_1.prepareChildPopupDownloadCleanup)(wc);
        const id = `dl-${(0, crypto_1.randomUUID)()}`;
        const buildPayload = (state, savePath, agent) => {
            const url = item?.getURL?.() ?? '';
            const payload = {
                id,
                webContentsId,
                url,
                urlChain: getDownloadUrlChain(item, url),
                filename: item?.getFilename?.() ?? '',
                receivedBytes: item?.getReceivedBytes?.() ?? 0,
                totalBytes: item?.getTotalBytes?.() ?? 0,
                savePath,
                mimeType: item?.getMimeType?.() ?? '',
                isAgentDownload: agent,
                state,
            };
            if (openerWcId > 0) {
                payload.openerWebContentsId = openerWcId;
            }
            return payload;
        };
        /** Cancels before any tracking and reports `cancelled` to the host. */
        const cancelImmediately = (agent) => {
            clearInlinePdfDedupeForItem(guestSession, rawWcId, openerWcId, item, inlinePdfMatch?.inlineKey);
            try {
                item?.cancel?.();
            }
            catch {
                // Still report the download as cancelled.
            }
            if (host && !host.isDestroyed()) {
                host.send(exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL, buildPayload('cancelled', '', agent));
            }
            closeInitialDownloadPopup?.();
        };
        // A download from an agent-controlled (or recently armed/agent-controlled)
        // guest that has no live armed sandbox directory must never fall back to
        // the default downloads folder without asking: cancel it.
        if (!isArmedGuestOrOpener &&
            (isAgentAssociatedGuest(rawWcId) ||
                isAgentAssociatedGuest(openerWcId) ||
                (rawWcId <= 0 &&
                    openerWcId <= 0 &&
                    consumeDroppedInlinePdfTombstone(guestSession, item)))) {
            cancelImmediately(true);
            return;
        }
        // Synchronously assign a validated destination path (or cancel on error) so
        // Chromium never opens a modal OS save dialog.
        const existingSavePath = item?.getSavePath?.() ?? '';
        let resolvedSavePath = existingSavePath;
        let isAgentDownload = isArmedGuestOrOpener;
        let releaseReservation;
        // Agent downloads need the user's approval (b/581957522). Inline-PDF
        // re-fetches that Hub itself starts for a PDF the agent is already
        // viewing are size-capped and sandboxed, so they are not gated.
        let requiresApproval = isAgentDownload && inlinePdfMatch === undefined;
        if (!existingSavePath) {
            const target = (0, webviewDownloadRouting_1.resolveSynchronousDownloadTarget)({
                webContentsId: rawWcId,
                openerWebContentsId: openerWcId,
                fallbackArmedDir: inlinePdfMatch?.capturedArmedDir,
                rawFilename: item?.getFilename?.(),
            });
            // Agent downloads never write executables or active local markup to disk.
            const isBlockedAgentFormat = target?.isAgentDownload === true &&
                ((0, webviewDownloadRouting_1.isBlockedAgentDownloadFormat)(item?.getFilename?.(), item?.getMimeType?.()) ||
                    (0, webviewDownloadRouting_1.isBlockedAgentDownloadFormat)(target.savePath));
            if (!target || isBlockedAgentFormat) {
                target?.release();
                isAgentDownload = target?.isAgentDownload ?? isAgentDownload;
                cancelImmediately(isAgentDownload);
                return;
            }
            resolvedSavePath = target.savePath;
            isAgentDownload = target.isAgentDownload;
            releaseReservation = target.release;
            requiresApproval = isAgentDownload && inlinePdfMatch === undefined;
            if (!requiresApproval) {
                item?.setSavePath?.(target.savePath);
            }
        }
        const ownerHostWcId = host && typeof host.id === 'number' && Number.isInteger(host.id)
            ? host.id
            : undefined;
        if (requiresApproval) {
            // Zero bytes on disk before approval: capture what the prompt needs,
            // then cancel before Chromium picks a target file. preventDefault() and
            // cancel() inside will-download both leave nothing on disk (no partial
            // or .crdownload file), whereas pause() does not stop a small download
            // from finishing. On approval Hub downloads the URL again.
            const snapshotUrl = item?.getURL?.() ?? '';
            let rawChain = [];
            try {
                const chain = item?.getURLChain?.();
                rawChain = Array.isArray(chain)
                    ? chain.filter((u) => typeof u === 'string')
                    : [];
            }
            catch {
                rawChain = [];
            }
            const snapshot = {
                url: snapshotUrl,
                urlChain: getDownloadUrlChain(item, snapshotUrl),
                filename: item?.getFilename?.() ?? '',
                mimeType: item?.getMimeType?.() ?? '',
                totalBytes: item?.getTotalBytes?.() ?? 0,
            };
            const approvedSiteKeys = new Set([...rawChain, snapshotUrl].map(downloadUrlSiteKey).filter(Boolean));
            const ownerGuestWc = webContentsId > 0 && webContentsId === openerWcId
                ? openerWc
                : webContentsId > 0 && webContentsId === rawWcId
                    ? wc
                    : inlineOwnerWc;
            let referrer;
            try {
                const pageUrl = ownerGuestWc?.getURL?.();
                referrer =
                    typeof pageUrl === 'string' && /^https?:/i.test(pageUrl)
                        ? pageUrl
                        : undefined;
            }
            catch {
                referrer = undefined;
            }
            try {
                ev?.preventDefault?.();
            }
            catch {
                // cancel() below still stops the download.
            }
            try {
                item?.cancel?.();
            }
            catch {
                // Nothing was assigned a path, so nothing can be written.
            }
            const gatedRecord = {
                id,
                ownerHostWcId,
                savePath: resolvedSavePath,
                state: 'started',
                isAgentDownload: true,
            };
            upsertTrackedDownload(gatedRecord);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let activeItem;
            let pending = false;
            let finished = false;
            let approvalTimer;
            let token;
            let tokenTimer;
            const watcherDisposers = [];
            const pendingCountKey = webContentsId;
            const sendGated = (state) => {
                gatedRecord.state = state;
                if (isTerminalDownloadState(state)) {
                    gatedRecord.cancel = undefined;
                }
                if (host && !host.isDestroyed()) {
                    const payload = {
                        id,
                        webContentsId,
                        url: snapshot.url,
                        urlChain: snapshot.urlChain,
                        filename: snapshot.filename,
                        receivedBytes: activeItem?.getReceivedBytes?.() ?? 0,
                        totalBytes: activeItem?.getTotalBytes?.() || snapshot.totalBytes,
                        savePath: resolvedSavePath,
                        mimeType: snapshot.mimeType,
                        isAgentDownload: true,
                        state,
                    };
                    if (openerWcId > 0) {
                        payload.openerWebContentsId = openerWcId;
                    }
                    host.send(exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL, payload);
                }
            };
            /** Ends the wait for the user's decision (idempotent). */
            const settlePending = () => {
                if (!pending) {
                    return;
                }
                pending = false;
                gatedRecord.resolveApproval = undefined;
                const remaining = (pendingApprovalCountByGuestWcId.get(pendingCountKey) ?? 1) - 1;
                if (remaining > 0) {
                    pendingApprovalCountByGuestWcId.set(pendingCountKey, remaining);
                }
                else {
                    pendingApprovalCountByGuestWcId.delete(pendingCountKey);
                }
                if (approvalTimer !== undefined) {
                    clearTimeout(approvalTimer);
                    approvalTimer = undefined;
                }
                for (const dispose of watcherDisposers.splice(0)) {
                    dispose();
                }
            };
            const dropToken = () => {
                if (token) {
                    approvedRedownloadTokens.delete(token);
                    token = undefined;
                }
                if (tokenTimer !== undefined) {
                    clearTimeout(tokenTimer);
                    tokenTimer = undefined;
                }
            };
            /** Reports the final state exactly once and frees everything held. */
            const finish = (state) => {
                if (finished) {
                    return;
                }
                finished = true;
                settlePending();
                dropToken();
                releaseReservation?.();
                sendGated(state);
                // A download-only popup closes once its downloads are over, as for
                // ungated downloads.
                closeInitialDownloadPopup?.();
            };
            const cancelPending = () => {
                if (pending) {
                    finish('cancelled');
                }
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const refuse = (redownload, redownloadEvent) => {
                try {
                    redownloadEvent?.preventDefault?.();
                }
                catch {
                    // cancel() below still stops it.
                }
                try {
                    redownload?.cancel?.();
                }
                catch {
                    // Already stopped.
                }
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const startApproved = (redownload, redownloadEvent) => {
                token = undefined;
                if (tokenTimer !== undefined) {
                    clearTimeout(tokenTimer);
                    tokenTimer = undefined;
                }
                if (finished) {
                    refuse(redownload, redownloadEvent);
                    return;
                }
                // Fail closed if the re-download reaches a site the user did not
                // approve, or now serves a blocked format; the agent can retry and
                // get a new prompt.
                const reachesUnapprovedSite = [
                    ...collectItemCandidateUrls(redownload),
                ].some((u) => !approvedSiteKeys.has(downloadUrlSiteKey(u)));
                if (reachesUnapprovedSite ||
                    (0, webviewDownloadRouting_1.isBlockedAgentDownloadFormat)(redownload?.getFilename?.(), redownload?.getMimeType?.())) {
                    refuse(redownload, redownloadEvent);
                    finish('cancelled');
                    return;
                }
                activeItem = redownload;
                redownload?.setSavePath?.(resolvedSavePath);
                gatedRecord.cancel =
                    typeof redownload?.cancel === 'function'
                        ? () => {
                            redownload.cancel();
                        }
                        : undefined;
                redownload?.on?.('updated', (_e, state) => {
                    if (!finished) {
                        sendGated(state === 'interrupted' ? 'interrupted' : 'progressing');
                    }
                });
                redownload?.on?.('done', (_e, state) => {
                    finish(state === 'completed'
                        ? 'completed'
                        : state === 'cancelled'
                            ? 'cancelled'
                            : 'interrupted');
                });
                sendGated('progressing');
            };
            sendGated('started');
            if (ownerHostWcId === undefined || !host || host.isDestroyed?.()) {
                // No host can ask the user, so fail closed right away.
                finish('cancelled');
                return;
            }
            if ((pendingApprovalCountByGuestWcId.get(pendingCountKey) ?? 0) >=
                exports.MAX_PENDING_APPROVALS_PER_GUEST) {
                // Too many prompts from one guest: refuse instead of queueing.
                finish('cancelled');
                return;
            }
            pending = true;
            pendingApprovalCountByGuestWcId.set(pendingCountKey, (pendingApprovalCountByGuestWcId.get(pendingCountKey) ?? 0) + 1);
            // Before approval there is nothing to stop but the record itself.
            gatedRecord.cancel = () => {
                if (activeItem) {
                    activeItem.cancel?.();
                }
                else {
                    finish('cancelled');
                }
            };
            gatedRecord.resolveApproval = (approve) => {
                if (!pending) {
                    return false;
                }
                settlePending();
                if (!approve) {
                    finish('cancelled');
                    return true;
                }
                const guest = ownerGuestWc;
                if (!guest ||
                    guest.isDestroyed?.() ||
                    typeof guest.downloadURL !== 'function' ||
                    !snapshot.url) {
                    finish('cancelled');
                    return false;
                }
                gatedRecord.state = 'progressing';
                token = {
                    guestWcId: webContentsId,
                    guestSession,
                    url: snapshot.url,
                    start: startApproved,
                };
                approvedRedownloadTokens.add(token);
                tokenTimer = setTimeout(() => {
                    tokenTimer = undefined;
                    if (token) {
                        // The re-download never arrived.
                        finish('interrupted');
                    }
                }, exports.APPROVED_REDOWNLOAD_TOKEN_TTL_MS);
                tokenTimer.unref?.();
                try {
                    // Same guest, so the same session and cookies as the original.
                    if (referrer) {
                        guest.downloadURL(snapshot.url, { headers: { Referer: referrer } });
                    }
                    else {
                        guest.downloadURL(snapshot.url);
                    }
                }
                catch {
                    finish('interrupted');
                    return false;
                }
                return true;
            };
            approvalTimer = setTimeout(cancelPending, webviewDownloadRouting_1.AGENT_DOWNLOAD_APPROVAL_TIMEOUT_MS);
            approvalTimer.unref?.();
            watcherDisposers.push(onContentsDestroyed(host, cancelPending));
            if (pending && ownerGuestWc) {
                watcherDisposers.push(onContentsDestroyed(ownerGuestWc, cancelPending));
            }
            if (pending) {
                sendGated('awaiting_approval');
            }
            return;
        }
        const trackedRecord = {
            id,
            ownerHostWcId,
            savePath: resolvedSavePath,
            state: 'started',
            isAgentDownload,
            cancel: typeof item?.cancel === 'function'
                ? () => {
                    item.cancel();
                }
                : undefined,
        };
        upsertTrackedDownload(trackedRecord);
        const send = (state) => {
            const latestSavePath = item?.getSavePath?.() || resolvedSavePath;
            trackedRecord.savePath = latestSavePath;
            trackedRecord.state = state;
            if (isTerminalDownloadState(state)) {
                trackedRecord.cancel = undefined;
            }
            if (host && !host.isDestroyed()) {
                host.send(exports.WEBVIEW_DOWNLOAD_PROGRESS_CHANNEL, buildPayload(state, latestSavePath, isAgentDownload));
            }
        };
        // The inline PDF re-fetch is started by Hub rather than the page, so cap
        // its size to keep a page from filling the disk through it.
        const exceedsInlinePdfByteCap = () => inlinePdfMatch !== undefined &&
            Math.max(item?.getTotalBytes?.() ?? 0, item?.getReceivedBytes?.() ?? 0) >
                exports.MAX_INLINE_PDF_DOWNLOAD_BYTES;
        send('started');
        item?.on?.('updated', (_e, state) => {
            if (exceedsInlinePdfByteCap()) {
                item?.cancel?.();
                return;
            }
            send(state === 'interrupted' ? 'interrupted' : 'progressing');
        });
        item?.on?.('done', (_e, state) => {
            clearInlinePdfDedupeForItem(guestSession, rawWcId, openerWcId, item, inlinePdfMatch?.inlineKey);
            releaseReservation?.();
            send(state === 'completed'
                ? 'completed'
                : state === 'cancelled'
                    ? 'cancelled'
                    : 'interrupted');
            closeInitialDownloadPopup?.();
        });
        if (typeof item?.on !== 'function') {
            clearInlinePdfDedupeForItem(guestSession, rawWcId, openerWcId, item, inlinePdfMatch?.inlineKey);
            trackedRecord.cancel = undefined;
            releaseReservation?.();
            closeInitialDownloadPopup?.();
            return;
        }
        if (exceedsInlinePdfByteCap()) {
            item?.cancel?.();
        }
    });
}
function isActivationInputType(type) {
    return (type === 'mouseDown' ||
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
        type === 'touchEnd');
}
function attachGuestUserActivationTracker(targetContents, now) {
    let lastUserActivationMs = 0;
    let lastActivationInputMs = 0;
    const onInputEvent = (_event, inputEvent) => {
        if (isActivationInputType(inputEvent?.type)) {
            lastUserActivationMs = now();
            lastActivationInputMs = lastUserActivationMs;
        }
    };
    // Cross-origin out-of-process iframes have their own RenderWidgetHost, so OS
    // mouse clicks inside an OOPIF do not emit `input-event` on the guest primary
    // main frame's RenderWidgetHost. Listen to `before-mouse-event` and
    // `before-input-event` (`PreHandleMouseEvent` / `PreHandleKeyboardEvent` on
    // the guest `WebContentsDelegate`, which fire across all guest frames
    // including OOPIFs) without subscribing to `hostWebContents`, so typing or
    // clicking in Hub chrome never grants popup activation to the guest.
    targetContents?.on?.('before-input-event', onInputEvent);
    targetContents?.on?.('before-mouse-event', onInputEvent);
    targetContents?.on?.('input-event', onInputEvent);
    return {
        hasRecentActivation: (currentTime = now()) => lastUserActivationMs > 0 &&
            currentTime >= lastUserActivationMs &&
            currentTime - lastUserActivationMs <= exports.POPUP_USER_ACTIVATION_WINDOW_MS,
        clear: () => {
            lastUserActivationMs = 0;
        },
        lastInputMs: () => lastActivationInputMs,
    };
}
function isCrossDocumentNavigationStart(event, isInPlaceArg) {
    return !(typeof isInPlaceArg === 'boolean'
        ? isInPlaceArg
        : Boolean(event?.isSameDocument));
}
function normalizeExternalLaunchKey(rawUrl) {
    try {
        return new URL(rawUrl).href;
    }
    catch {
        return rawUrl.trim();
    }
}
function createExternalLaunchDispatcher(openExternal, now) {
    let lastLaunchMs = 0;
    const recentLaunchMsByUrl = new Map();
    return (rawUrl, currentTime = now()) => {
        const normalizedKey = normalizeExternalLaunchKey(rawUrl);
        if (lastLaunchMs > 0 && currentTime < lastLaunchMs) {
            lastLaunchMs = currentTime;
            recentLaunchMsByUrl.clear();
            recentLaunchMsByUrl.set(normalizedKey, currentTime);
            return false;
        }
        if (lastLaunchMs > 0 &&
            currentTime - lastLaunchMs < exports.MIN_EXTERNAL_LAUNCH_INTERVAL_MS) {
            return false;
        }
        for (const [key, launchedAtMs] of recentLaunchMsByUrl) {
            if (currentTime < launchedAtMs ||
                currentTime - launchedAtMs >= exports.EXTERNAL_LAUNCH_DEDUPE_WINDOW_MS) {
                recentLaunchMsByUrl.delete(key);
            }
        }
        if (recentLaunchMsByUrl.has(normalizedKey)) {
            return false;
        }
        lastLaunchMs = currentTime;
        recentLaunchMsByUrl.set(normalizedKey, currentTime);
        void Promise.resolve(openExternal(rawUrl)).catch(() => undefined);
        return true;
    };
}
function createExternalAuthNavigationGate(options) {
    let inFlightAllowed = Boolean(options.allowInitialNavigation);
    let initialAllowanceRemaining = Boolean(options.allowInitialNavigation);
    return {
        onMainFrameNavigationStarted: (hasFrameInitiator) => {
            inFlightAllowed = !hasFrameInitiator
                ? true
                : options.isAgentControlled() ||
                    options.userActivation.hasRecentActivation(options.now()) ||
                    initialAllowanceRemaining;
        },
        onWillNavigateAllowed: () => {
            const agentControlled = options.isAgentControlled();
            const hasActivation = options.userActivation.hasRecentActivation(options.now());
            inFlightAllowed =
                agentControlled || hasActivation || initialAllowanceRemaining;
            initialAllowanceRemaining = false;
            if (!agentControlled && hasActivation) {
                options.userActivation.clear();
            }
        },
        onInFlightReset: () => {
            inFlightAllowed = false;
        },
        onCommittedRealNavigation: () => {
            inFlightAllowed = false;
            initialAllowanceRemaining = false;
        },
        handleExternalOnlyAuthNavigation: (navigationUrl, { isRedirect }) => {
            const currentTime = options.now();
            const agentControlled = options.isAgentControlled();
            const hasActivation = options.userActivation.hasRecentActivation(currentTime);
            const authorized = isRedirect
                ? agentControlled || inFlightAllowed
                : agentControlled || hasActivation || initialAllowanceRemaining;
            if (!isRedirect || inFlightAllowed) {
                initialAllowanceRemaining = false;
            }
            inFlightAllowed = false;
            if (!authorized) {
                return false;
            }
            if (!agentControlled && hasActivation) {
                options.userActivation.clear();
            }
            return options.maybeOpenExternal(navigationUrl, currentTime);
        },
    };
}
/**
 * Configures a `<webview>` or `WebContentsView` guest `WebContents` to:
 * 1. Route external-only Google OAuth endpoints (`accounts.google.com/o/oauth2/*`
 *    and `/signin/oauth/*`) to the system browser via `shell.openExternal`.
 * 2. Open explicit popup windows (`window.open(..., 'width=...,height=...')` and
 *    scriptable `about:blank` launchers) in hardened framed child `BrowserWindow`s
 *    (preserving `window.opener`, enforcing user gesture activation, rate limits,
 *    concurrency caps, native origin-prefixed title bars + close controls,
 *    private-network URL validation, and automatic teardown on cross-origin
 *    opener navigation, tab hide/release, or conversation switch).
 * 3. Route user-activated or agent-controlled tab navigations (`target="_blank"`,
 *    modifier clicks, and `window.open(..., '_blank')`) to the built-in browser
 *    tab strip via `webview:open-new-tab`.
 */
function configureWebviewBrowserContents(contents, options) {
    if (!contents ||
        (contents.getType() !== 'webview' && !options?.allowWebContentsView) ||
        configuredWebviewContents.has(contents)) {
        return;
    }
    configuredWebviewContents.add(contents);
    contents.setMaxListeners?.(32);
    const guestSession = contents.session;
    const host = options?.hostWebContents ?? contents.hostWebContents;
    if (host) {
        hostByGuestContents.set(contents, host);
    }
    const trackedId = typeof contents.id === 'number' && contents.id > 0 ? contents.id : 0;
    if (trackedId > 0) {
        configuredWebviewById.set(trackedId, contents);
    }
    ensureSessionDownloadListener(guestSession);
    (0, guestPermissionPolicy_1.configureSessionAgentPermissionPolicy)(guestSession);
    const webContentsId = contents.id;
    const openExternal = options?.openExternal ?? ((url) => electron_1.shell.openExternal(url));
    const now = options?.now ?? (() => Date.now());
    const maybeOpenExternal = createExternalLaunchDispatcher(openExternal, now);
    const isOpenerCurrentlyAgentControlled = () => {
        let customAgentControlled = false;
        try {
            customAgentControlled = Boolean(options?.isAgentControlled?.());
        }
        catch {
            customAgentControlled = false;
        }
        return customAgentControlled || (0, guestAgentControl_1.isGuestAgentControlled)(webContentsId);
    };
    const getParentWindow = options?.getParentWindow ??
        (() => {
            if (host && typeof electron_1.BrowserWindow?.fromWebContents === 'function') {
                const fromHost = electron_1.BrowserWindow.fromWebContents(host);
                if (fromHost) {
                    return fromHost;
                }
            }
            // `BrowserWindow.getFocusedWindow()` never returns the Hub's
            // `BaseWindow`, so fall back to the focused Hub window instead.
            return (0, utils_1.getFocusedHubWindow)();
        });
    let lastPopupOpenedMs = 0;
    let lastPopupInitialUrl = '';
    let lastPopupOpenerOrigin;
    let lastPopupHostUrl;
    let popupOpenedWhileUnmuted = false;
    let hasCommittedWebviewNavigation = false;
    let inFlightWebviewOrigin;
    let popupVisibilityTimer = null;
    let initialUncommittedOrigin;
    let inFlightMainFrameArmedDir;
    const activePopups = new Set();
    const guestUserActivation = attachGuestUserActivationTracker(contents, now);
    const guestExternalAuthGate = createExternalAuthNavigationGate({
        userActivation: guestUserActivation,
        isAgentControlled: isOpenerCurrentlyAgentControlled,
        maybeOpenExternal,
        now,
    });
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
    contents.on?.('render-process-gone', () => {
        guestUserActivation.clear();
        guestExternalAuthGate.onCommittedRealNavigation();
        closeActivePopups();
    });
    contents.on?.('destroyed', () => {
        if (trackedId > 0) {
            let wasAgentControlled = false;
            try {
                wasAgentControlled = isOpenerCurrentlyAgentControlled();
            }
            catch {
                wasAgentControlled = false;
            }
            if (wasAgentControlled) {
                (0, webviewDownloadRouting_1.recordAgentControlTombstone)(trackedId);
            }
            if (configuredWebviewById.get(trackedId) === contents) {
                configuredWebviewById.delete(trackedId);
                configuredWebviewInitialOriginById.delete(trackedId);
                configuredWebviewInFlightArmedDirById.delete(trackedId);
                configuredWebviewAgentControlledById.delete(trackedId);
                configuredWebviewLastInputActivationMsById.delete(trackedId);
            }
            clearInlinePdfDedupeForOwner(trackedId);
        }
        inFlightMainFrameArmedDir = undefined;
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
    if (!options?.allowWebContentsView &&
        host &&
        (0, guestNetworkController_1.isNetworkTrackableContents)(contents)) {
        guestNetworkController_1.guestNetworkController.trackGuest(contents, {
            ownerId: host.id,
            sender: host,
        });
    }
    const forwardNewTabToHost = (url) => {
        if (host && !host.isDestroyed()) {
            host.send(exports.WEBVIEW_OPEN_NEW_TAB_CHANNEL, url, webContentsId);
        }
    };
    let currentFaviconDocUrl = contents.getURL?.() || '';
    let lastFaviconOrigin = extractHttpOrigin(currentFaviconDocUrl);
    // Strings only: the icon bytes stay in the favicon store.
    let lastFavicon;
    let inFlightFaviconPromise = null;
    let faviconSeq = 0;
    const forwardFaviconToHost = (documentUrl, favicon) => {
        if (host && !host.isDestroyed()) {
            host.send(exports.WEBVIEW_FAVICON_UPDATED_CHANNEL, {
                webContentsId,
                documentUrl,
                dataUrl: favicon.dataUrl,
                ...(favicon.faviconUrl ? { faviconUrl: favicon.faviconUrl } : {}),
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
        // The first servable icon becomes `faviconUrl`; the first inline icon ends
        // the search and becomes `dataUrl`, as before servable icons existed.
        let faviconUrl;
        let chosenDataUrl;
        for (const candidate of candidates) {
            const resolution = await fetchFaviconCandidateInMain(guestSession, candidate, docOrigin);
            if (seq !== faviconSeq || contents.isDestroyed?.()) {
                return;
            }
            faviconUrl ?? (faviconUrl = resolution?.servable?.url);
            if (resolution?.dataUrl) {
                chosenDataUrl = resolution.dataUrl;
                break;
            }
        }
        if (!chosenDataUrl && !faviconUrl) {
            return;
        }
        // `lastFavicon` is cleared across origins, so carrying its `dataUrl`
        // forward only keeps a same-origin inline icon for old renderers.
        lastFavicon = {
            dataUrl: chosenDataUrl ?? lastFavicon?.dataUrl ?? '',
            ...(faviconUrl ? { faviconUrl } : {}),
        };
        lastFaviconOrigin = docOrigin;
        forwardFaviconToHost(getActiveFaviconDocUrl() || docUrl, lastFavicon);
    };
    if (typeof webContentsId === 'number' && webContentsId > 0) {
        configuredWebviewInitialOriginById.set(webContentsId, () => !hasCommittedWebviewNavigation && getOpenerOrigin() === undefined
            ? initialUncommittedOrigin
            : undefined);
        configuredWebviewInFlightArmedDirById.set(webContentsId, (peek) => {
            if (!inFlightMainFrameArmedDir) {
                return undefined;
            }
            if (now() - inFlightMainFrameArmedDir.startedAtMs >
                INLINE_PDF_DEDUPE_TTL_MS) {
                inFlightMainFrameArmedDir = undefined;
                return undefined;
            }
            const dir = inFlightMainFrameArmedDir.dir;
            if (!peek) {
                inFlightMainFrameArmedDir = undefined;
            }
            return dir;
        });
        configuredWebviewLastInputActivationMsById.set(webContentsId, guestUserActivation.lastInputMs);
        configuredWebviewAgentControlledById.set(webContentsId, isOpenerCurrentlyAgentControlled);
    }
    contents.on?.('did-start-navigation', (event, navigationUrl, isInPlaceArg, isMainFrameArg) => {
        if (!isMainFrameNavigationEvent(event, isMainFrameArg)) {
            return;
        }
        const startedUrl = navigationUrl ?? event?.url ?? '';
        closeActivePopupsIfCrossOrigin(startedUrl);
        // Ignore same-document (`pushState` / `#hash`) navigations: they never
        // emit `did-navigate` or start a network redirect chain, and must not
        // clobber an active cross-document navigation's origin.
        if (isCrossDocumentNavigationStart(event, isInPlaceArg)) {
            guestExternalAuthGate.onMainFrameNavigationStarted(Boolean(event?.initiator));
            const liveArmedDir = trackedId > 0 ? (0, webviewDownloadRouting_1.getArmedGuestDownloadDirectory)(trackedId) : undefined;
            inFlightMainFrameArmedDir = liveArmedDir
                ? { dir: liveArmedDir, startedAtMs: now() }
                : undefined;
            inFlightWebviewOrigin = extractHttpOrigin(startedUrl);
            if (!hasCommittedWebviewNavigation &&
                initialUncommittedOrigin === undefined &&
                !isBlankPopupUrl(startedUrl) &&
                getOpenerOrigin() === undefined) {
                initialUncommittedOrigin = extractHttpOrigin(startedUrl) ?? 'null';
            }
        }
    });
    contents.on?.('did-navigate', (_event, navigationUrl) => {
        // Transient user activation is per-Document: a click that navigates the
        // main frame to a new document must not carry over to authorize script
        // popups on the newly committed page.
        guestUserActivation.clear();
        guestExternalAuthGate.onCommittedRealNavigation();
        closeActivePopupsIfCrossOrigin(navigationUrl);
        inFlightWebviewOrigin = undefined;
        if (!isBlankPopupUrl(navigationUrl)) {
            hasCommittedWebviewNavigation = true;
            initialUncommittedOrigin = undefined;
            currentFaviconDocUrl = navigationUrl;
            const nextOrigin = extractHttpOrigin(navigationUrl);
            if (nextOrigin !== lastFaviconOrigin) {
                faviconSeq++;
                inFlightFaviconPromise = null;
                lastFaviconOrigin = nextOrigin;
                lastFavicon = undefined;
                forwardFaviconToHost(navigationUrl, { dataUrl: '' });
            }
            else if (nextOrigin &&
                lastFavicon &&
                (lastFavicon.dataUrl || lastFavicon.faviconUrl)) {
                forwardFaviconToHost(navigationUrl, lastFavicon);
            }
        }
    });
    contents.on?.('did-navigate-in-page', (event, navigationUrl, isMainFrameArg) => {
        if (!isMainFrameNavigationEvent(event, isMainFrameArg) ||
            isBlankPopupUrl(navigationUrl)) {
            return;
        }
        currentFaviconDocUrl = navigationUrl;
        if (lastFavicon && (lastFavicon.dataUrl || lastFavicon.faviconUrl)) {
            forwardFaviconToHost(navigationUrl, lastFavicon);
        }
    });
    contents.on?.('did-fail-load', (event, errorCode, _errorDescription, _validatedUrl, isMainFrameArg) => {
        // ERR_ABORTED (-3) also reports a navigation superseded by a newer one,
        // possibly after the newer one's did-start-navigation, so clearing here
        // could drop the newer chain's origin. Every new main-frame navigation
        // overwrites the origin in did-start-navigation anyway.
        if (errorCode === ERR_ABORTED) {
            return;
        }
        if (isMainFrameNavigationEvent(event, isMainFrameArg)) {
            inFlightWebviewOrigin = undefined;
            guestExternalAuthGate.onInFlightReset();
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
        inFlightMainFrameArmedDir = undefined;
        guestExternalAuthGate.onInFlightReset();
        const docUrl = getActiveFaviconDocUrl();
        const docOrigin = extractHttpOrigin(docUrl);
        // Keyed on the inline icon: a servable-only state still re-scans late
        // <link rel=icon> elements, which may offer an inline icon.
        if (!docOrigin ||
            (lastFavicon?.dataUrl && lastFaviconOrigin === docOrigin)) {
            if (docOrigin &&
                lastFavicon?.dataUrl &&
                lastFaviconOrigin === docOrigin) {
                forwardFaviconToHost(docUrl, lastFavicon);
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
                (lastFavicon?.dataUrl && lastFaviconOrigin === docOrigin)) {
                return;
            }
            const seqAtStop = faviconSeq;
            let isolatedLinks = [];
            try {
                const raw = typeof contents.executeJavaScriptInIsolatedWorld === 'function'
                    ? await (0, isolatedWorldExec_1.executeJavaScriptInIsolatedWorldWhenReady)(contents, FAVICON_ISOLATED_WORLD_ID, [{ code: ISOLATED_FAVICON_LINKS_SCRIPT }], false)
                    : undefined;
                if (Array.isArray(raw)) {
                    isolatedLinks = raw.filter((item) => typeof item === 'string');
                }
            }
            catch {
                // Ignore isolated-world query errors if guest navigated or closed.
            }
            if (seqAtStop === faviconSeq &&
                !contents.isDestroyed?.() &&
                !(lastFavicon?.dataUrl && lastFaviconOrigin === docOrigin)) {
                await resolveAndPublishFavicons(isolatedLinks);
            }
        })();
    });
    const createWebviewNavigationListener = (isRedirect) => (event, navigationUrl, _isInPlace, isMainFrameArg) => {
        const isMainFrame = isMainFrameNavigationEvent(event, isMainFrameArg);
        if (isExternalOnlyAuthUrl(navigationUrl)) {
            event.preventDefault();
            if (isMainFrame) {
                inFlightWebviewOrigin = undefined;
                guestExternalAuthGate.handleExternalOnlyAuthNavigation(navigationUrl, { isRedirect });
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
            if (isMainFrame) {
                inFlightWebviewOrigin = undefined;
                guestExternalAuthGate.onInFlightReset();
            }
            return;
        }
        if (isMainFrame) {
            if (!isRedirect) {
                guestExternalAuthGate.onWillNavigateAllowed();
            }
            closeActivePopupsIfCrossOrigin(navigationUrl);
            inFlightWebviewOrigin = extractHttpOrigin(navigationUrl);
        }
    };
    contents.on?.('will-navigate', createWebviewNavigationListener(false));
    contents.on?.('will-redirect', createWebviewNavigationListener(true));
    contents.setWindowOpenHandler((details) => {
        const isOpenerAgentControlled = isOpenerCurrentlyAgentControlled();
        const currentTime = now();
        const hasUserActivation = guestUserActivation.hasRecentActivation(currentTime);
        if (isExternalOnlyAuthUrl(details.url)) {
            if (isOpenerAgentControlled || hasUserActivation) {
                if (!isOpenerAgentControlled) {
                    guestUserActivation.clear();
                }
                maybeOpenExternal(details.url, currentTime);
            }
            return { action: 'deny' };
        }
        const openerOrigin = getOpenerOrigin(details);
        const blankPopup = isBlankPopupUrl(details.url);
        const urlValidation = blankPopup
            ? { allowed: true }
            : validateWebviewNavigationUrl(details.url, openerOrigin);
        // Agent-driven tabs cannot perceive or actuate standalone desktop popup
        // BrowserWindows; route non-OAuth popup URLs into the built-in tab strip.
        if (isOpenerAgentControlled &&
            !blankPopup &&
            !isOAuthPopupUrl(details.url)) {
            if (urlValidation.allowed) {
                forwardNewTabToHost(details.url);
            }
            return { action: 'deny' };
        }
        if (isPopupWindowRequest(details)) {
            if (!urlValidation.allowed || !hasUserActivation) {
                return { action: 'deny' };
            }
            if (activePopups.size >= exports.MAX_CONCURRENT_POPUPS_PER_WEBVIEW) {
                return { action: 'deny' };
            }
            if (lastPopupOpenedMs > 0 &&
                currentTime - lastPopupOpenedMs < exports.MIN_POPUP_INTERVAL_MS) {
                return { action: 'deny' };
            }
            guestUserActivation.clear();
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
        if (!blankPopup &&
            urlValidation.allowed &&
            (isOpenerAgentControlled || hasUserActivation)) {
            if (!isOpenerAgentControlled) {
                guestUserActivation.clear();
            }
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
        let popupSecurityState;
        let popupTitleUrl = currentPopupUrl;
        const updatePopupTitle = (rawUrl, pageTitle) => {
            popupTitleUrl = rawUrl;
            childWindow.setTitle?.(formatPopupWindowTitle(rawUrl, pageTitle, (0, webviewPopupSecurity_1.formatPopupSecurityLabel)(popupSecurityState, rawUrl)));
        };
        updatePopupTitle(currentPopupUrl);
        const popupContents = childWindow.webContents;
        if ((0, webviewSecurityState_1.isSecurityTrackableContents)(popupContents)) {
            (0, webviewSecurityState_1.trackGuestSecurityState)(popupContents, {
                onChange: (state) => {
                    popupSecurityState = state;
                    // Title the document the state describes: a failed load (such as a
                    // rejected certificate) never reaches this window's did-navigate.
                    const stateOrigin = extractHttpOrigin(state.url);
                    if (!stateOrigin) {
                        updatePopupTitle(popupTitleUrl, currentPageTitle);
                        return;
                    }
                    const sameOrigin = stateOrigin === extractHttpOrigin(popupTitleUrl);
                    updatePopupTitle(state.url, sameOrigin ? currentPageTitle : undefined);
                },
            });
            (0, webviewPopupSecurity_1.attachPopupConnectionInfoMenu)(childWindow, popupContents, () => popupSecurityState);
        }
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
        const childUserActivation = attachGuestUserActivationTracker(childWindow.webContents, now);
        const childExternalAuthGate = createExternalAuthNavigationGate({
            userActivation: childUserActivation,
            isAgentControlled: isOpenerCurrentlyAgentControlled,
            maybeOpenExternal,
            now,
            allowInitialNavigation: true,
        });
        const createChildNavigationListener = (isRedirect) => (event, navigationUrl, _isInPlace, isMainFrameArg) => {
            const isMainFrame = isMainFrameNavigationEvent(event, isMainFrameArg);
            if (isExternalOnlyAuthUrl(navigationUrl)) {
                event.preventDefault();
                if (isMainFrame) {
                    inFlightMainFrameOrigin = undefined;
                    const launched = childExternalAuthGate.handleExternalOnlyAuthNavigation(navigationUrl, { isRedirect });
                    if (launched || !hasCommittedFirstNavigation) {
                        closePopupIfOpen();
                    }
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
                if (isMainFrame) {
                    inFlightMainFrameOrigin = undefined;
                    childExternalAuthGate.onInFlightReset();
                    if (!hasCommittedFirstNavigation) {
                        closePopupIfOpen();
                    }
                }
                return;
            }
            if (isMainFrame) {
                if (!isRedirect) {
                    childExternalAuthGate.onWillNavigateAllowed();
                }
                inFlightMainFrameOrigin = extractHttpOrigin(navigationUrl);
            }
        };
        childWindow.webContents?.on?.('did-start-navigation', (event, _url, isInPlaceArg, isMainFrameArg) => {
            if (isMainFrameNavigationEvent(event, isMainFrameArg) &&
                isCrossDocumentNavigationStart(event, isInPlaceArg)) {
                childExternalAuthGate.onMainFrameNavigationStarted(Boolean(event?.initiator));
            }
        });
        childWindow.webContents?.on?.('did-fail-load', (event, errorCode, _desc, _url, isMainFrameArg) => {
            if (errorCode !== ERR_ABORTED &&
                isMainFrameNavigationEvent(event, isMainFrameArg)) {
                inFlightMainFrameOrigin = undefined;
                childExternalAuthGate.onInFlightReset();
            }
        });
        childWindow.webContents?.on?.('did-stop-loading', () => {
            if (hasCommittedFirstNavigation) {
                childExternalAuthGate.onInFlightReset();
            }
        });
        childWindow.webContents?.on?.('will-navigate', createChildNavigationListener(false));
        childWindow.webContents?.on?.('will-redirect', createChildNavigationListener(true));
        childWindow.webContents?.on?.('render-process-gone', () => {
            childUserActivation.clear();
            childExternalAuthGate.onCommittedRealNavigation();
        });
        childWindow.webContents?.on?.('did-navigate', (_event, navigationUrl) => {
            if (isBlankPopupUrl(navigationUrl) && !hasCommittedFirstNavigation) {
                return;
            }
            childUserActivation.clear();
            childExternalAuthGate.onCommittedRealNavigation();
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
            const currentTime = now();
            const hasChildActivation = childUserActivation.hasRecentActivation(currentTime);
            if (isExternalOnlyAuthUrl(nestedDetails.url)) {
                if (hasChildActivation) {
                    childUserActivation.clear();
                    maybeOpenExternal(nestedDetails.url, currentTime);
                }
                return { action: 'deny' };
            }
            const openerOrigin = getPopupBaseValidationOrigin();
            if (hasChildActivation &&
                !isBlankPopupUrl(nestedDetails.url) &&
                validateWebviewNavigationUrl(nestedDetails.url, openerOrigin).allowed) {
                childUserActivation.clear();
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
