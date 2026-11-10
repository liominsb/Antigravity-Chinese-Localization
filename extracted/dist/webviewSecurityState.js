"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBVIEW_CLEAR_SITE_DATA_CHANNEL = exports.WEBVIEW_ALLOW_CERTIFICATE_CHANNEL = exports.WEBVIEW_GET_SECURITY_STATE_CHANNEL = exports.WEBVIEW_SECURITY_STATE_CHANNEL = void 0;
exports.trackGuestSecurityState = trackGuestSecurityState;
exports.getGuestSecurityStateForOwner = getGuestSecurityStateForOwner;
exports.allowGuestCertificateForOwner = allowGuestCertificateForOwner;
exports.clearGuestSiteDataForOwner = clearGuestSiteDataForOwner;
exports.isSecurityTrackableContents = isSecurityTrackableContents;
exports.resetTrackedGuestSecurityStateForTesting = resetTrackedGuestSecurityStateForTesting;
const electron_1 = require("electron");
const guestDebugger_1 = require("./guestDebugger");
const webviewUploadValidation_1 = require("./webviewUploadValidation");
/** IPC channel that pushes a guest's connection security state to its host. */
exports.WEBVIEW_SECURITY_STATE_CHANNEL = 'webview:security-state-changed';
/** IPC invoke channel that returns a guest's latest connection security state. */
exports.WEBVIEW_GET_SECURITY_STATE_CHANNEL = 'webview:get-security-state';
/**
 * IPC invoke channel that allows a pinned untrusted certificate for one host
 * on a specific guest `WebContents`.
 */
exports.WEBVIEW_ALLOW_CERTIFICATE_CHANNEL = 'webview:allow-certificate';
/** IPC invoke channel that clears cookies and storage for the guest's current HTTP(S) origin. */
exports.WEBVIEW_CLEAR_SITE_DATA_CHANNEL = 'webview:clear-site-data';
/** Document responses remembered per guest while waiting for their commit. */
const MAX_PENDING_DOCUMENT_RESPONSES = 8;
/** Rejected host certificates remembered per guest before a user bypasses one. */
const MAX_REMEMBERED_REJECTED_CERTS = 16;
/** Chromium `net::ERR_ABORTED`, reported for cancelled loads and downloads. */
const NET_ERROR_ABORTED = -3;
/**
 * Soft Chromium certificate verification errors that permit an explicit
 * user-initiated click-through exception. Hard errors (such as revocation,
 * key-pinning failures, excessive validity, and TLS protocol failures) are
 * never overridable.
 */
const OVERRIDABLE_CERTIFICATE_ERRORS = new Set([
    'ERR_CERT_AUTHORITY_INVALID',
    'ERR_CERT_COMMON_NAME_INVALID',
    'ERR_CERT_DATE_INVALID',
    'ERR_CERT_WEAK_SIGNATURE_ALGORITHM',
    'ERR_CERT_WEAK_KEY',
    'ERR_CERT_NAME_CONSTRAINT_VIOLATION',
    'ERR_CERT_SYMANTEC_LEGACY',
]);
/**
 * TLDs on Chromium's HSTS preload list in their entirety. Chrome never offers
 * a certificate click-through on HSTS hosts, so neither does the Hub.
 */
const HSTS_PRELOADED_TLDS = new Set([
    'android',
    'app',
    'chrome',
    'day',
    'dev',
    'esq',
    'foo',
    'google',
    'ing',
    'mov',
    'new',
    'nexus',
    'page',
    'phd',
    'prof',
    'youtube',
    'zip',
]);
const trackedGuests = new Map();
/**
 * Hosts whose untrusted certificate is bypassed by at least one live guest in
 * a given `Session`. Sibling guests in that partition fail their requests to
 * these hosts (so they never reuse the bypassing guest's sockets) and never
 * report them as `secure`. Never used to authorize `certificate-error`
 * callbacks on other guests. An entry is removed when its last bypassing guest
 * is destroyed.
 */
let sessionBypassedCertificates = new WeakMap();
/**
 * Hostnames that sent a `Strict-Transport-Security` header over a valid TLS
 * connection in a given `Session`, mapped to their `includeSubDomains` flag.
 */
let sessionHstsHosts = new WeakMap();
let nextSeq = 1;
function isOverridableCertificateError(error) {
    if (!error) {
        return false;
    }
    const normalized = error
        .trim()
        .replace(/^net::/i, '')
        .toUpperCase();
    return OVERRIDABLE_CERTIFICATE_ERRORS.has(normalized);
}
function unwrapEffectiveUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === 'blob:' ? new URL(parsed.pathname) : parsed;
    }
    catch {
        return undefined;
    }
}
function isLoopbackHostname(hostname) {
    const lower = hostname.toLowerCase();
    return (lower === 'localhost' ||
        lower.endsWith('.localhost') ||
        lower === '[::1]' ||
        lower === '::1' ||
        /^127(?:\.\d{1,3}){3}$/.test(lower));
}
function isLoopbackHttpUrl(rawUrl) {
    const parsed = unwrapEffectiveUrl(rawUrl);
    return Boolean(parsed && parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname));
}
function isPlainHttpUrl(rawUrl) {
    const parsed = unwrapEffectiveUrl(rawUrl);
    return parsed?.protocol === 'http:';
}
function extractDirectHttpsHost(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === 'https:' && parsed.host
            ? parsed.host.toLowerCase()
            : undefined;
    }
    catch {
        return undefined;
    }
}
function extractEffectiveHttpsHost(rawUrl) {
    const parsed = unwrapEffectiveUrl(rawUrl);
    return parsed?.protocol === 'https:' && parsed.host
        ? parsed.host.toLowerCase()
        : undefined;
}
function extractHttpOrigin(rawUrl) {
    const parsed = unwrapEffectiveUrl(rawUrl);
    return parsed &&
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.origin !== 'null'
        ? parsed.origin
        : undefined;
}
function certificatesMatchSummary(a, b) {
    return (a.subjectName === b.subjectName &&
        a.issuer === b.issuer &&
        a.validFromMs === b.validFromMs &&
        a.validToMs === b.validToMs);
}
function syncSessionBypassFetchInterception(sessionKey) {
    for (const candidate of trackedGuests.values()) {
        if (candidate.sessionKey === sessionKey) {
            candidate.syncBypassFetchInterception();
        }
    }
}
function recordSessionBypassedCertificate(sessionKey, host, details, guestId) {
    let hostMap = sessionBypassedCertificates.get(sessionKey);
    if (!hostMap) {
        hostMap = new Map();
        sessionBypassedCertificates.set(sessionKey, hostMap);
    }
    const entry = hostMap.get(host);
    if (entry) {
        entry.details = details;
        entry.guestIds.add(guestId);
    }
    else {
        hostMap.set(host, { details, guestIds: new Set([guestId]) });
    }
    syncSessionBypassFetchInterception(sessionKey);
}
function releaseSessionBypassedCertificates(sessionKey, guestId) {
    const hostMap = sessionBypassedCertificates.get(sessionKey);
    if (!hostMap) {
        return;
    }
    let changed = false;
    for (const [host, entry] of hostMap) {
        if (entry.guestIds.delete(guestId) && entry.guestIds.size === 0) {
            hostMap.delete(host);
            changed = true;
        }
    }
    if (hostMap.size === 0) {
        sessionBypassedCertificates.delete(sessionKey);
    }
    if (changed) {
        syncSessionBypassFetchInterception(sessionKey);
    }
}
function recordHstsHeader(sessionKey, response) {
    if (response.securityState !== 'secure' ||
        !response.url ||
        !response.headers) {
        return;
    }
    const headerName = Object.keys(response.headers).find((name) => name.toLowerCase() === 'strict-transport-security');
    if (!headerName) {
        return;
    }
    let hostname;
    try {
        const parsed = new URL(response.url);
        if (parsed.protocol !== 'https:') {
            return;
        }
        hostname = parsed.hostname.toLowerCase();
    }
    catch {
        return;
    }
    const directives = response.headers[headerName]
        .split(';')
        .map((d) => d.trim().toLowerCase());
    const maxAge = directives
        .map((d) => /^max-age\s*=\s*"?(\d+)"?$/.exec(d)?.[1])
        .find((v) => v !== undefined);
    if (maxAge === undefined) {
        return;
    }
    let hostMap = sessionHstsHosts.get(sessionKey);
    if (Number(maxAge) === 0) {
        hostMap?.delete(hostname);
        return;
    }
    if (!hostMap) {
        hostMap = new Map();
        sessionHstsHosts.set(sessionKey, hostMap);
    }
    hostMap.set(hostname, directives.includes('includesubdomains'));
}
function isHstsHostname(sessionKey, hostname) {
    const labels = hostname.replace(/\.+$/, '').split('.');
    if (HSTS_PRELOADED_TLDS.has(labels[labels.length - 1] ?? '')) {
        return true;
    }
    const hostMap = sessionHstsHosts.get(sessionKey);
    if (!hostMap) {
        return false;
    }
    if (hostMap.has(hostname)) {
        return true;
    }
    for (let i = 1; i < labels.length - 1; i++) {
        if (hostMap.get(labels.slice(i).join('.')) === true) {
            return true;
        }
    }
    return false;
}
/**
 * Returns `true` when certificate errors on HTTPS `host` (`hostname[:port]`)
 * must never be bypassed: HSTS hosts and protected Identity Provider hosts.
 */
function isCertificateBypassForbidden(sessionKey, host) {
    let hostname;
    try {
        hostname = new URL(`https://${host}/`).hostname.toLowerCase();
    }
    catch {
        return true;
    }
    return (isHstsHostname(sessionKey, hostname) ||
        (0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(`https://${host}/`));
}
function normalizeTlsNetError(errorDescription) {
    const trimmed = errorDescription.trim();
    if (!/^(?:net::)?ERR_(?:CERT|SSL|BAD_SSL)_/i.test(trimmed)) {
        return undefined;
    }
    return /^net::/i.test(trimmed)
        ? `net::${trimmed.slice(5)}`
        : `net::${trimmed}`;
}
function mapCdpSecurityState(securityState) {
    switch (securityState) {
        case 'secure':
            return 'secure';
        case 'insecure':
            return 'insecure';
        case 'insecure-broken':
            return 'dangerous';
        default:
            return 'neutral';
    }
}
/**
 * Converts a CDP main-frame Document response into security details. Loopback
 * HTTP (`localhost`, `127.0.0.1`, `[::1]`) always maps to `neutral` (matching
 * Chrome's icon-only `(i)` omnibox state), non-loopback HTTP always maps to
 * `insecure`, and only a response with TLS `securityDetails` counts as `secure`.
 */
function securityDetailsFromCdpResponse(response) {
    if (response.url && isLoopbackHttpUrl(response.url)) {
        return { level: 'neutral' };
    }
    if (response.url && isPlainHttpUrl(response.url)) {
        return { level: 'insecure' };
    }
    const level = mapCdpSecurityState(response.securityState);
    const details = response.securityDetails;
    if (!details) {
        return { level: level === 'secure' ? 'neutral' : level };
    }
    return {
        level,
        certificate: {
            subjectName: details.subjectName ?? '',
            issuer: details.issuer ?? '',
            validFromMs: (details.validFrom ?? 0) * 1000,
            validToMs: (details.validTo ?? 0) * 1000,
            ...(details.protocol ? { protocol: details.protocol } : {}),
        },
    };
}
/** Converts a rejected certificate or TLS error into `dangerous` security details. */
function securityDetailsFromCertificateError(error, certificate) {
    return {
        level: 'dangerous',
        certificateError: error,
        ...(certificate
            ? {
                certificate: {
                    subjectName: certificate.subjectName ?? '',
                    issuer: certificate.issuerName ?? '',
                    validFromMs: (certificate.validStart ?? 0) * 1000,
                    validToMs: (certificate.validExpiry ?? 0) * 1000,
                },
            }
            : {}),
    };
}
function fallbackSecurityDetailsForNavigation(url, previousState) {
    if (/^data:/i.test(url)) {
        return { level: 'insecure' };
    }
    if (/^blob:/i.test(url)) {
        const inner = unwrapEffectiveUrl(url);
        if (!inner ||
            (inner.protocol !== 'http:' && inner.protocol !== 'https:') ||
            inner.origin === 'null') {
            return { level: 'insecure' };
        }
        if (inner.protocol === 'http:') {
            return {
                level: isLoopbackHostname(inner.hostname) ? 'neutral' : 'insecure',
            };
        }
        if (extractHttpOrigin(previousState.url) === inner.origin &&
            previousState.level === 'secure' &&
            !previousState.certificateError &&
            !previousState.mixedContent) {
            return {
                level: 'secure',
                ...(previousState.certificate
                    ? { certificate: previousState.certificate }
                    : {}),
            };
        }
        return { level: 'neutral' };
    }
    if (isPlainHttpUrl(url)) {
        return { level: isLoopbackHttpUrl(url) ? 'neutral' : 'insecure' };
    }
    return { level: 'neutral' };
}
/**
 * Returns `url` without its fragment: CDP reports document responses without
 * it, while `did-navigate` keeps it.
 */
function documentKey(url) {
    const hashIndex = url.indexOf('#');
    return hashIndex === -1 ? url : url.slice(0, hashIndex);
}
/**
 * Tracks the connection security of `contents`' committed main-frame document
 * from Chromium's network stack and reports every change to `onChange`.
 */
function trackGuestSecurityState(contents, options) {
    const webContentsId = contents.id;
    if (contents.isDestroyed() || trackedGuests.has(webContentsId)) {
        return;
    }
    ensureSecurityIpcHandlersRegistered();
    const guest = {
        ownerId: options.ownerId,
        contents,
        sessionKey: contents.session ?? contents,
        state: { webContentsId, seq: nextSeq++, url: '', level: 'neutral' },
        lastRejectedCertificates: new Map(),
        allowedCertificates: new Map(),
        syncBypassFetchInterception: () => { },
    };
    trackedGuests.set(webContentsId, guest);
    const applyBypassedHostOverride = (url, base) => {
        const host = extractEffectiveHttpsHost(url);
        if (!host) {
            return base;
        }
        const bypassed = guest.allowedCertificates.get(host)?.details ??
            sessionBypassedCertificates.get(guest.sessionKey)?.get(host)?.details;
        if (!bypassed) {
            return base;
        }
        if (base.certificate &&
            bypassed.certificate &&
            !certificatesMatchSummary(base.certificate, bypassed.certificate)) {
            return base;
        }
        const mergedCert = base.certificate ?? bypassed.certificate;
        return {
            ...base,
            level: 'dangerous',
            certificateError: bypassed.certificateError ??
                base.certificateError ??
                'net::ERR_CERT_INVALID',
            ...(mergedCert ? { certificate: mergedCert } : {}),
        };
    };
    let activeMixedContent;
    const applyMixedContent = (details) => {
        if (!activeMixedContent) {
            if (!details.mixedContent) {
                return details;
            }
            const { mixedContent: _dropped, ...rest } = details;
            return rest;
        }
        if (activeMixedContent === 'active') {
            return {
                ...details,
                level: 'dangerous',
                mixedContent: 'active',
            };
        }
        return {
            ...details,
            level: details.level === 'dangerous' ? 'dangerous' : 'insecure',
            mixedContent: 'passive',
        };
    };
    const publish = (url, details) => {
        guest.state = { ...details, webContentsId, seq: nextSeq++, url };
        options.onChange(guest.state);
    };
    let mainFrameId;
    let committedUrl = '';
    const pendingDocumentResponses = new Map();
    let pendingCertificateError;
    const rememberPendingDocument = (key, details) => {
        pendingDocumentResponses.delete(key);
        pendingDocumentResponses.set(key, details);
        if (pendingDocumentResponses.size > MAX_PENDING_DOCUMENT_RESPONSES) {
            const oldest = pendingDocumentResponses.keys().next().value;
            if (oldest !== undefined) {
                pendingDocumentResponses.delete(oldest);
            }
        }
    };
    const rememberRejectedCertificate = (host, entry) => {
        guest.lastRejectedCertificates.delete(host);
        guest.lastRejectedCertificates.set(host, entry);
        if (guest.lastRejectedCertificates.size > MAX_REMEMBERED_REJECTED_CERTS) {
            const oldest = guest.lastRejectedCertificates.keys().next().value;
            if (oldest !== undefined) {
                guest.lastRejectedCertificates.delete(oldest);
            }
        }
    };
    const dbg = contents.debugger;
    let armedFetchKey = '';
    const syncBypassFetchInterception = () => {
        if (contents.isDestroyed() || !dbg.isAttached()) {
            return;
        }
        const bypassed = sessionBypassedCertificates.get(guest.sessionKey);
        const unallowedHosts = bypassed
            ? [...bypassed.keys()]
                .filter((h) => !guest.allowedCertificates.has(h))
                .sort()
            : [];
        const nextKey = unallowedHosts.join(',');
        if (nextKey === armedFetchKey) {
            return;
        }
        armedFetchKey = nextKey;
        if (unallowedHosts.length === 0) {
            void dbg.sendCommand('Fetch.disable').catch(() => undefined);
            return;
        }
        void dbg
            .sendCommand('Fetch.enable', {
            patterns: unallowedHosts.map((h) => ({
                urlPattern: `https://${h}/*`,
                requestStage: 'Request',
            })),
        })
            .catch(() => undefined);
    };
    guest.syncBypassFetchInterception = syncBypassFetchInterception;
    const enableNetworkTracking = () => {
        if (!(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            return;
        }
        void dbg
            .sendCommand('Network.enable', guestDebugger_1.CDP_NETWORK_ENABLE_PARAMS)
            .catch(() => undefined);
        syncBypassFetchInterception();
        void dbg
            .sendCommand('Page.getFrameTree')
            .then((result) => {
            mainFrameId = result
                ?.frameTree?.frame?.id;
        })
            .catch(() => undefined);
    };
    enableNetworkTracking();
    dbg.on('message', (_event, method, params) => {
        if (method === 'Fetch.requestPaused') {
            const requestId = params?.requestId;
            if (!requestId) {
                return;
            }
            const reqHost = params.request?.url
                ? extractDirectHttpsHost(params.request.url)
                : undefined;
            // Fail sibling requests to a host another guest bypassed, so they
            // can never ride that guest's sockets past certificate verification.
            const blocked = reqHost !== undefined &&
                sessionBypassedCertificates.get(guest.sessionKey)?.has(reqHost) ===
                    true &&
                !guest.allowedCertificates.has(reqHost);
            void dbg
                .sendCommand(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest', blocked ? { requestId, errorReason: 'BlockedByClient' } : { requestId })
                .catch(() => undefined);
            return;
        }
        if (method !== 'Network.responseReceived' || !params?.response?.url) {
            return;
        }
        recordHstsHeader(guest.sessionKey, params.response);
        const isMainFrameDocument = params.type === 'Document' &&
            (mainFrameId === undefined || params.frameId === mainFrameId);
        if (isMainFrameDocument) {
            const key = documentKey(params.response.url);
            const details = applyBypassedHostOverride(params.response.url, securityDetailsFromCdpResponse(params.response));
            rememberPendingDocument(key, details);
            if (committedUrl && key === documentKey(committedUrl)) {
                publish(committedUrl, applyMixedContent(details));
            }
            return;
        }
        // Track passive (Image/Media) and active (Script/Stylesheet/XHR/subframe)
        // HTTP mixed content loaded by a committed HTTPS main-frame document.
        if (!committedUrl ||
            !extractEffectiveHttpsHost(committedUrl) ||
            !isPlainHttpUrl(params.response.url) ||
            isLoopbackHttpUrl(params.response.url)) {
            return;
        }
        const kind = params.type === 'Image' || params.type === 'Media'
            ? 'passive'
            : 'active';
        if (activeMixedContent === 'active' || activeMixedContent === kind) {
            return;
        }
        activeMixedContent = kind;
        const { level, certificate, certificateError } = guest.state;
        publish(committedUrl, applyMixedContent({ level, certificate, certificateError }));
    });
    dbg.on('detach', () => {
        armedFetchKey = '';
        pendingDocumentResponses.clear();
        activeMixedContent = undefined;
        if (!contents.isDestroyed() && committedUrl) {
            publish(committedUrl, { level: 'neutral' });
        }
    });
    contents.on('certificate-error', (event, url, error, certificate, callback, isMainFrame) => {
        const details = securityDetailsFromCertificateError(error, certificate);
        const fingerprint = typeof certificate?.fingerprint === 'string'
            ? certificate.fingerprint.trim()
            : '';
        const host = extractDirectHttpsHost(url);
        if (host) {
            if (isMainFrame !== false) {
                rememberRejectedCertificate(host, { fingerprint, error, details });
            }
            const allowed = guest.allowedCertificates.get(host);
            if (allowed &&
                fingerprint.length > 0 &&
                allowed.fingerprint === fingerprint &&
                isOverridableCertificateError(error) &&
                !isCertificateBypassForbidden(guest.sessionKey, host)) {
                allowed.error = error;
                allowed.details = details;
                recordSessionBypassedCertificate(guest.sessionKey, host, details, webContentsId);
                event?.preventDefault?.();
                callback?.(true);
                if (isMainFrame !== false) {
                    rememberPendingDocument(documentKey(url), details);
                }
                return;
            }
        }
        if (isMainFrame === false) {
            return;
        }
        pendingCertificateError = { url, details };
    });
    contents.on('did-start-navigation', () => {
        if (!contents.isDestroyed() && !dbg.isAttached()) {
            enableNetworkTracking();
        }
    });
    contents.on('did-navigate', (_event, url) => {
        const previousState = guest.state;
        committedUrl = url;
        activeMixedContent = undefined;
        pendingCertificateError = undefined;
        const pendingDetails = pendingDocumentResponses.get(documentKey(url));
        const fallbackDetails = fallbackSecurityDetailsForNavigation(url, previousState);
        const baseDetails = pendingDetails &&
            !(/^blob:https:/i.test(url) &&
                pendingDetails.level === 'neutral' &&
                fallbackDetails.level === 'secure')
            ? pendingDetails
            : fallbackDetails;
        publish(url, applyBypassedHostOverride(url, baseDetails));
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame === false) {
            return;
        }
        committedUrl = url;
        const { level, certificate, certificateError, mixedContent } = guest.state;
        publish(url, {
            level,
            ...(certificate ? { certificate } : {}),
            ...(certificateError ? { certificateError } : {}),
            ...(mixedContent ? { mixedContent } : {}),
        });
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame === false || errorCode === NET_ERROR_ABORTED) {
            return;
        }
        committedUrl = validatedUrl;
        activeMixedContent = undefined;
        let failureDetails = pendingCertificateError &&
            documentKey(pendingCertificateError.url) === documentKey(validatedUrl)
            ? pendingCertificateError.details
            : undefined;
        pendingCertificateError = undefined;
        if (!failureDetails && typeof errorDescription === 'string') {
            const tlsNetError = normalizeTlsNetError(errorDescription);
            if (tlsNetError) {
                failureDetails = securityDetailsFromCertificateError(tlsNetError, undefined);
            }
        }
        publish(validatedUrl, failureDetails ?? { level: 'neutral' });
    });
    contents.on('destroyed', () => {
        trackedGuests.delete(webContentsId);
        releaseSessionBypassedCertificates(guest.sessionKey, webContentsId);
    });
}
/**
 * Returns the latest security state of guest `webContentsId` when
 * `requesterId` is the renderer that owns it, else `null`.
 */
function getGuestSecurityStateForOwner(webContentsId, requesterId) {
    if (typeof webContentsId !== 'number') {
        return null;
    }
    const guest = trackedGuests.get(webContentsId);
    if (!guest || guest.ownerId === undefined || guest.ownerId !== requesterId) {
        return null;
    }
    return guest.state;
}
/**
 * Pins the last rejected certificate fingerprint of `url`'s HTTPS host to the
 * in-memory certificate-bypass allowlist of guest `webContentsId` alone when
 * `requesterId` owns the guest and the rejected certificate failed with an
 * overridable soft `ERR_CERT_*` code on a host that is neither HSTS nor a
 * protected Identity Provider. Sibling guests sharing the same session never
 * inherit `certificate-error` approval, and bypassed hosts remain reported at
 * `level: 'dangerous'` across reloads and navigations.
 */
function allowGuestCertificateForOwner(webContentsId, url, requesterId) {
    if (typeof webContentsId !== 'number' || typeof url !== 'string') {
        return false;
    }
    const guest = trackedGuests.get(webContentsId);
    if (!guest ||
        guest.ownerId === undefined ||
        guest.ownerId !== requesterId ||
        guest.contents.isDestroyed()) {
        return false;
    }
    const host = extractDirectHttpsHost(url);
    if (!host || isCertificateBypassForbidden(guest.sessionKey, host)) {
        return false;
    }
    const currentHost = extractDirectHttpsHost(guest.state.url) ??
        extractDirectHttpsHost(guest.contents.getURL?.() ?? '');
    if (currentHost && currentHost !== host) {
        return false;
    }
    const rejected = guest.lastRejectedCertificates.get(host);
    if (!rejected ||
        !rejected.fingerprint ||
        !isOverridableCertificateError(rejected.error)) {
        return false;
    }
    guest.allowedCertificates.set(host, {
        fingerprint: rejected.fingerprint,
        error: rejected.error,
        details: rejected.details,
    });
    recordSessionBypassedCertificate(guest.sessionKey, host, rejected.details, webContentsId);
    return true;
}
/**
 * Clears cookies and site storage for `origin` in `webContentsId`'s session
 * when `requesterId` owns the guest and `origin` matches the guest's current
 * HTTP(S) origin.
 */
async function clearGuestSiteDataForOwner(webContentsId, origin, requesterId) {
    if (typeof webContentsId !== 'number' || typeof origin !== 'string') {
        return false;
    }
    const guest = trackedGuests.get(webContentsId);
    if (!guest ||
        guest.ownerId === undefined ||
        guest.ownerId !== requesterId ||
        guest.contents.isDestroyed()) {
        return false;
    }
    const normalizedOrigin = extractHttpOrigin(origin);
    if (!normalizedOrigin || normalizedOrigin !== origin) {
        return false;
    }
    const currentOrigin = extractHttpOrigin(guest.state.url) ??
        extractHttpOrigin(guest.contents.getURL?.() ?? '');
    if (currentOrigin !== normalizedOrigin) {
        return false;
    }
    const clearFn = guest.contents.session?.clearStorageData;
    if (typeof clearFn !== 'function') {
        return false;
    }
    try {
        await clearFn.call(guest.contents.session, { origin: normalizedOrigin });
        return true;
    }
    catch {
        return false;
    }
}
let securityIpcHandlersRegistered = false;
function isTrustedMainFrameSender(event) {
    const mainFrame = event.sender
        ?.mainFrame;
    if (!event.senderFrame || !mainFrame) {
        return false;
    }
    return event.senderFrame === mainFrame;
}
function ensureSecurityIpcHandlersRegistered() {
    if (securityIpcHandlersRegistered) {
        return;
    }
    securityIpcHandlersRegistered = true;
    electron_1.ipcMain.handle(exports.WEBVIEW_GET_SECURITY_STATE_CHANNEL, (event, webContentsId) => isTrustedMainFrameSender(event)
        ? getGuestSecurityStateForOwner(webContentsId, event.sender.id)
        : null);
    electron_1.ipcMain.handle(exports.WEBVIEW_ALLOW_CERTIFICATE_CHANNEL, (event, webContentsId, url) => isTrustedMainFrameSender(event)
        ? allowGuestCertificateForOwner(webContentsId, url, event.sender.id)
        : false);
    electron_1.ipcMain.handle(exports.WEBVIEW_CLEAR_SITE_DATA_CHANNEL, (event, webContentsId, origin) => isTrustedMainFrameSender(event)
        ? clearGuestSiteDataForOwner(webContentsId, origin, event.sender.id)
        : false);
}
/**
 * Returns `true` when `contents` exposes what {@link trackGuestSecurityState}
 * needs (every real `WebContents` does).
 */
function isSecurityTrackableContents(contents) {
    const candidate = contents;
    return (typeof candidate?.id === 'number' &&
        typeof candidate.on === 'function' &&
        typeof candidate.isDestroyed === 'function' &&
        typeof candidate.debugger?.attach === 'function' &&
        typeof candidate.debugger.isAttached === 'function' &&
        typeof candidate.debugger.sendCommand === 'function' &&
        typeof candidate.debugger.on === 'function');
}
/** Clears tracked guests and certificate allowlists; for tests only. */
function resetTrackedGuestSecurityStateForTesting() {
    trackedGuests.clear();
    sessionBypassedCertificates = new WeakMap();
    sessionHstsHosts = new WeakMap();
    nextSeq = 1;
    securityIpcHandlersRegistered = false;
}
