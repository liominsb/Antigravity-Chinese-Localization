"use strict";
/**
 * Credential, Identity Provider (IdP) / corporate SSO, Same-Origin Policy
 * (SOP), and untrusted-content boundary sanitizers for guest network capture.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_URL_CHARS = exports.MAX_HEADER_VALUE_CHARS = exports.MAX_HEADERS_PER_MESSAGE = exports.MAX_RESPONSE_BODY_PREVIEW_CHARS = void 0;
exports.sanitizeUntrustedNetworkText = sanitizeUntrustedNetworkText;
exports.extractHttpOrigin = extractHttpOrigin;
exports.isProtectedNetworkUrl = isProtectedNetworkUrl;
exports.isCrossOriginSensitiveGoogleUrl = isCrossOriginSensitiveGoogleUrl;
exports.sanitizeNetworkUrl = sanitizeNetworkUrl;
exports.isSensitiveHeaderName = isSensitiveHeaderName;
exports.scrubNetworkHeaders = scrubNetworkHeaders;
exports.normalizeResourceType = normalizeResourceType;
exports.isSafeTextualMime = isSafeTextualMime;
exports.canCaptureCrossOriginDetails = canCaptureCrossOriginDetails;
exports.MAX_RESPONSE_BODY_PREVIEW_CHARS = 2048;
exports.MAX_HEADERS_PER_MESSAGE = 32;
exports.MAX_HEADER_VALUE_CHARS = 256;
exports.MAX_URL_CHARS = 1024;
const PROTECTED_EXACT_OR_SUBDOMAIN_HOSTS = [
    'accounts.google.com',
    'myaccount.google.com',
    'accounts.youtube.com',
    'gds.google.com',
    'login.google.com',
    'login.corp.google.com',
    'sso.google.com',
    'websso.corp.google.com',
    'uberproxy.corp.google.com',
    'uberproxy-pen-redirect.corp.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
    'mainsail.exceedlms.com',
    'metadata.google.internal',
    'metadata.goog',
];
/** OAuth token endpoints, as `host` plus an optional path prefix. */
const PROTECTED_OAUTH_TOKEN_ENDPOINTS = [
    ['oauth2.googleapis.com', ''],
    ['securetoken.googleapis.com', ''],
    ['identitytoolkit.googleapis.com', ''],
    ['sts.googleapis.com', ''],
    // `normalizeHost` drops a leading `www.`.
    ['googleapis.com', '/oauth2/'],
    ['github.com', '/login/oauth/'],
    ['gitlab.com', '/oauth/'],
    ['bitbucket.org', '/site/oauth2/'],
    ['graph.facebook.com', '/oauth/'],
    ['api.twitter.com', '/oauth'],
    ['api.x.com', '/oauth'],
    ['slack.com', '/api/oauth.'],
    ['api.dropboxapi.com', '/oauth2/'],
    ['api.amazon.com', '/auth/o2/'],
];
const PROTECTED_WILDCARD_SUFFIXES = [
    '.okta.com',
    '.oktapreview.com',
    '.okta-emea.com',
    '.auth0.com',
];
const PROTECTED_IDP_PUBLIC_HOSTS = [
    'developer.okta.com',
    'docs.okta.com',
    'help.okta.com',
    'support.okta.com',
    'status.okta.com',
    'docs.auth0.com',
    'developer.auth0.com',
    'help.auth0.com',
    'support.auth0.com',
    'community.auth0.com',
    'status.auth0.com',
];
const SENSITIVE_GOOGLE_SUBDOMAINS = [
    'admin.google.com',
    'ads.google.com',
    'analytics.google.com',
    'business.google.com',
    'calendar.google.com',
    'chat.google.com',
    'colab.research.google.com',
    'console.cloud.google.com',
    'contacts.google.com',
    'docs.google.com',
    'drive.google.com',
    'gemini.google.com',
    'groups.google.com',
    'keep.google.com',
    'lookerstudio.google.com',
    'mail.google.com',
    'meet.google.com',
    'passwords.google.com',
    'pay.google.com',
    'photos.google.com',
    'script.google.com',
    'shell.cloud.google.com',
    'sites.google.com',
    'ssh.cloud.google.com',
    'takeout.google.com',
    'voice.google.com',
];
const SENSITIVE_QUERY_PARAMS = new Set([
    'access_token',
    'id_token',
    'refresh_token',
    'client_secret',
    'api_key',
    'apikey',
    'password',
    'passwd',
    'auth_token',
    'session_token',
    'csrf_token',
    'xsrf_token',
    'samlresponse',
    'samlrequest',
    'x-goog-signature',
    'x-goog-credential',
    'x-amz-security-token',
    'x-amz-signature',
    'x-amz-credential',
    'code',
    'state',
    'token',
    'sig',
    'signature',
    'key',
    'secret',
]);
/** Generic credential-bearing parameter/field name suffixes (`foo_token`). */
const SENSITIVE_NAME_SUFFIX_RE = /[-_.](?:token|sig|signature|key|secret|credential|password)$/i;
function isSensitiveParamName(rawName) {
    const name = rawName.trim().toLowerCase();
    return (SENSITIVE_QUERY_PARAMS.has(name) || SENSITIVE_NAME_SUFFIX_RE.test(name));
}
/** Normalized (case- and `[_-]`-stripped) substrings identifying credential keys. */
const SECRET_BODY_KEY_PATTERN_RE = /token|secret|password|passwd|apikey|privatekey|assertion|verifier/;
function isSecretBodyFieldName(rawKey) {
    const lower = rawKey.trim().toLowerCase();
    if (!lower) {
        return false;
    }
    if (lower === 'code' || lower === 'state') {
        return true;
    }
    const compact = lower.replace(/[_-]/g, '');
    return (SECRET_BODY_KEY_PATTERN_RE.test(compact) ||
        /(?:auth|authorization|oauth|device|user|verification)code$/.test(compact));
}
const JSON_STRING_FIELD_RE = /("([^"\\]{1,128})"\s*:\s*)"(?:[^"\\]|\\.|\\$)*(?:"|$)/g;
const FORM_FIELD_RE = /(^|[?&\s])([A-Za-z0-9_.-]{1,128})=(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s]*/g;
const FORMAT_CHARS_RE = /\p{Cf}|[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]|\uDB40[\uDC00-\uDC7F]/gu;
const UNTRUSTED_TAG_RE = /<[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*\/?[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*untrusted_page_content[^>]*>|<[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*\/?[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*untrusted_page_content/gi;
const SECRET_VALUE_TOKEN_RE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*|\bya29\.[A-Za-z0-9_-]{12,}|\bAIza[0-9A-Za-z_-]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gi;
const SENSITIVE_HEADER_TOKEN_RE = /(?:^|[-_])(?:cookie|auth|authorization|token|secret|api[-_]?key|apikey|password|passwd|session[-_]?id|jwt|bearer|credential|csrf|xsrf)(?:$|[-_])/i;
function stripControlChars(input, multiline) {
    let out = '';
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        const isLineWs = code === 0x09 || code === 0x0a || code === 0x0d;
        if (code === 0x7f || (code < 0x20 && !isLineWs)) {
            if (!multiline) {
                out += ' ';
            }
            continue;
        }
        if (!multiline && isLineWs) {
            out += ' ';
            continue;
        }
        out += input[i];
    }
    return multiline ? out : out.replace(/ {2,}/g, ' ').trim();
}
/** Strips format chars, control chars, secret tokens, and untrusted tags. */
function sanitizeUntrustedNetworkText(raw, maxChars, multiline = false) {
    if (!raw) {
        return '';
    }
    let cur = raw;
    for (;;) {
        const prev = cur;
        // Strip control chars before tags so `</untrusted_page\x01_content>`
        // cannot reassemble into a real boundary tag.
        cur = stripControlChars(cur.replace(FORMAT_CHARS_RE, ''), multiline).replace(UNTRUSTED_TAG_RE, '');
        if (cur === prev) {
            break;
        }
    }
    cur = cur
        .replace(JSON_STRING_FIELD_RE, (full, prefix, key) => isSecretBodyFieldName(key) ? `${prefix}"[REDACTED]"` : full)
        .replace(FORM_FIELD_RE, (full, prefix, key) => isSecretBodyFieldName(key) ? `${prefix}${key}=[REDACTED]` : full)
        .replace(SECRET_VALUE_TOKEN_RE, '[REDACTED]');
    return cur.length > maxChars ? cur.slice(0, maxChars) : cur;
}
function normalizeHost(rawHost) {
    return rawHost
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/%.*$/, '')
        .replace(/\.+$/, '')
        .replace(/^www\./, '');
}
function isLinkLocalMetadataHost(host) {
    if (/^fe[89ab][0-9a-f]*:/i.test(host)) {
        return true;
    }
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host) ??
        /^(?:0*:){0,5}0*:(?:ffff|0{1,4}):(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(host);
    return Boolean(m && Number(m[1]) === 169 && Number(m[2]) === 254);
}
/** Extracts an `http(s)` origin from `rawUrl`, or returns `undefined`. */
function extractHttpOrigin(rawUrl) {
    if (!rawUrl) {
        return undefined;
    }
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed.origin
            : undefined;
    }
    catch {
        return undefined;
    }
}
function isLoopbackOrigin(origin) {
    if (!origin) {
        return false;
    }
    try {
        const host = normalizeHost(new URL(origin).hostname);
        return (host === 'localhost' ||
            host.endsWith('.localhost') ||
            host === '::1' ||
            /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host));
    }
    catch {
        return false;
    }
}
/** Returns `true` when `rawUrl` targets a protected IdP, SSO, or metadata. */
function isProtectedNetworkUrl(rawUrl) {
    let current = (rawUrl ?? '').trim();
    if (!current) {
        return true;
    }
    for (let depth = 0; depth < 8; depth++) {
        let parsed;
        try {
            parsed = new URL(current);
        }
        catch {
            return depth === 0;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return true;
        }
        const host = normalizeHost(parsed.hostname);
        if (!host || isLinkLocalMetadataHost(host)) {
            return true;
        }
        if (PROTECTED_EXACT_OR_SUBDOMAIN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
            return true;
        }
        const path = parsed.pathname.toLowerCase();
        if (PROTECTED_OAUTH_TOKEN_ENDPOINTS.some(([h, prefix]) => host === h && path.startsWith(prefix))) {
            return true;
        }
        const isPublicIdpDoc = PROTECTED_IDP_PUBLIC_HOSTS.some((pub) => host === pub || host.endsWith(`.${pub}`));
        if (!isPublicIdpDoc &&
            PROTECTED_WILDCARD_SUFFIXES.some((sfx) => host.endsWith(sfx))) {
            return true;
        }
        const nestedUrl = parsed.searchParams.get('url') ??
            parsed.searchParams.get('continue') ??
            parsed.searchParams.get('redirect_uri');
        const isNestedHttp = Boolean(nestedUrl && /^https?:\/\//i.test(nestedUrl));
        if (isNestedHttp && nestedUrl && nestedUrl !== current) {
            current = nestedUrl;
            continue;
        }
        return false;
    }
    return true;
}
/** Checks if `rawUrl` is a cross-origin request to a sensitive Google host. */
function isCrossOriginSensitiveGoogleUrl(rawUrl, documentOrigin) {
    try {
        const parsed = new URL(rawUrl);
        if (documentOrigin && parsed.origin === documentOrigin) {
            return false;
        }
        const host = normalizeHost(parsed.hostname);
        return (host === 'corp.google.com' ||
            host.endsWith('.corp.google.com') ||
            SENSITIVE_GOOGLE_SUBDOMAINS.some((s) => host === s || host.endsWith(`.${s}`)));
    }
    catch {
        return true;
    }
}
/** Scrubs URL userinfo credentials and sensitive query parameters. */
function sanitizeNetworkUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl.trim());
        parsed.username = '';
        parsed.password = '';
        for (const key of [...parsed.searchParams.keys()]) {
            if (isSensitiveParamName(key)) {
                parsed.searchParams.set(key, '[REDACTED]');
            }
        }
        return sanitizeUntrustedNetworkText(parsed.toString(), exports.MAX_URL_CHARS);
    }
    catch {
        return '';
    }
}
/** Returns `true` when `rawName` carries cookies, auth tokens, or secrets. */
function isSensitiveHeaderName(rawName) {
    const name = rawName.trim().toLowerCase();
    if (!name || name.startsWith(':')) {
        return true;
    }
    if (name.startsWith('access-control-') || name.startsWith('sec-')) {
        return false;
    }
    if (name === 'cookie' ||
        name === 'cookie2' ||
        name === 'set-cookie' ||
        name === 'set-cookie2' ||
        name === 'authorization' ||
        name === 'proxy-authorization' ||
        name === 'www-authenticate' ||
        name === 'proxy-authenticate' ||
        name.startsWith('x-goog-') ||
        name.startsWith('x-google-') ||
        name.startsWith('x-uberproxy-') ||
        name.startsWith('uberproxy-') ||
        name.startsWith('x-beyondcorp-') ||
        name.startsWith('cf-access-') ||
        name.includes('csrf') ||
        name.includes('xsrf')) {
        return true;
    }
    return SENSITIVE_HEADER_TOKEN_RE.test(name);
}
/** Headers whose whole value is a single URL. */
const URL_HEADER_NAMES = new Set([
    'location',
    'referer',
    'origin',
    'content-location',
]);
/** Strips sensitive headers and bounds remaining safe header values. */
function scrubNetworkHeaders(rawHeaders) {
    const out = {};
    if (!rawHeaders || typeof rawHeaders !== 'object') {
        return out;
    }
    let count = 0;
    for (const [rawKey, rawVal] of Object.entries(rawHeaders)) {
        if (count >= exports.MAX_HEADERS_PER_MESSAGE) {
            break;
        }
        const key = sanitizeUntrustedNetworkText(rawKey, 64).toLowerCase();
        if (!key || isSensitiveHeaderName(key)) {
            continue;
        }
        let strVal = '';
        if (Array.isArray(rawVal)) {
            strVal = rawVal.map(String).join(', ');
        }
        else if (typeof rawVal === 'string' ||
            typeof rawVal === 'number' ||
            typeof rawVal === 'boolean') {
            strVal = String(rawVal);
        }
        if (key === 'location' && isProtectedNetworkUrl(strVal)) {
            continue;
        }
        if (URL_HEADER_NAMES.has(key) && /^https?:\/\//i.test(strVal.trim())) {
            out[key] = sanitizeNetworkUrl(strVal);
        }
        else if (key === 'link') {
            out[key] = sanitizeUntrustedNetworkText(strVal.replace(/<([^>]*)>/g, (_m, u) => `<${sanitizeNetworkUrl(u)}>`), exports.MAX_HEADER_VALUE_CHARS);
        }
        else if (key === 'refresh') {
            out[key] = sanitizeUntrustedNetworkText(strVal.replace(/(url\s*=\s*['"]?)([^'"\s;]+)/i, (_m, p, u) => `${p}${sanitizeNetworkUrl(u)}`), exports.MAX_HEADER_VALUE_CHARS);
        }
        else {
            out[key] = sanitizeUntrustedNetworkText(strVal, exports.MAX_HEADER_VALUE_CHARS);
        }
        count++;
    }
    return out;
}
/** Normalizes a CDP `ResourceType` token to lowercase Playwright convention. */
function normalizeResourceType(cdpType, method) {
    const lower = (cdpType ?? '').trim().toLowerCase();
    const isOptionsFallback = method === 'OPTIONS' && (!lower || lower === 'other');
    if (lower === 'preflight' || isOptionsFallback) {
        return 'preflight';
    }
    return lower || 'other';
}
/** Reports whether `mime` is a textual/JSON/XML/form MIME safe to preview. */
function isSafeTextualMime(mime) {
    const clean = (mime ?? '').split(';')[0].trim().toLowerCase();
    return (clean.startsWith('text/') ||
        clean === 'application/json' ||
        clean.endsWith('+json') ||
        clean === 'application/xml' ||
        clean.endsWith('+xml') ||
        clean === 'application/x-www-form-urlencoded' ||
        clean === 'application/graphql');
}
/** Reports whether headers and response body are SOP-safe to capture. */
function canCaptureCrossOriginDetails(requestUrl, documentOrigin, corsAllowOrigin) {
    const reqOrigin = extractHttpOrigin(requestUrl);
    if (!reqOrigin) {
        return false;
    }
    // Without a known document origin there is no SOP baseline to compare to.
    if (!documentOrigin) {
        return false;
    }
    if (reqOrigin === documentOrigin) {
        return true;
    }
    if (isLoopbackOrigin(reqOrigin) && isLoopbackOrigin(documentOrigin)) {
        return true;
    }
    // `ACAO: *` is not honored for credentialed requests and says nothing about
    // no-cors fetches, so only an exact echo of the document origin proves the
    // page itself could read this response.
    return (corsAllowOrigin ?? '').trim() === documentOrigin;
}
