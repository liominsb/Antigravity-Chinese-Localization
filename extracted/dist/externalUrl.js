"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DENIED_EXTERNAL_SCHEMES = void 0;
exports.classifyExternalUrl = classifyExternalUrl;
exports.openExternalSafely = openExternalSafely;
exports.isSameOrigin = isSameOrigin;
const electron_1 = require("electron");
/**
 * Lowercase URL schemes (without trailing `:`) never forwarded to OS protocol
 * handlers from renderer-reachable entry points.
 *
 * Superset of Chromium's `kDeniedSchemes` in
 * `chrome/browser/external_protocol/external_protocol_handler.cc`
 * (https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/external_protocol/external_protocol_handler.cc)
 * plus browser-internal schemes, the Hub `plugin` scheme, and OS protocol
 * handlers with known RCE/credential-leak advisories; adding entries only
 * makes the gate stricter.
 */
exports.DENIED_EXTERNAL_SCHEMES = new Set([
    // Chromium kDeniedSchemes superset
    'afp',
    'applescript',
    'data',
    'disk',
    'disks',
    'file',
    'hcp',
    'ie.http',
    'javascript',
    'mk',
    'ms-help',
    'nntp',
    'res',
    'shell',
    'vbscript',
    'view-source',
    'vnd.ms.radio',
    // Browser-internal schemes
    'about',
    'blob',
    'filesystem',
    // Hub-internal custom scheme (src/customScheme.ts)
    'plugin',
    // Microsoft Office URI schemes (per Microsoft's "Office URI Schemes"
    // specification; remote document fetches over SMB/WebDAV risk NTLM
    // credential leaks and macro prompts)
    'ms-word',
    'ms-excel',
    'ms-powerpoint',
    'ms-visio',
    'ms-access',
    'ms-project',
    'ms-publisher',
    'ms-spd',
    'ms-infopath',
    // Other dangerous OS protocol handlers (Follina/MSDT, search-ms,
    // ms-officecmd, and ms-appinstaller advisories, plus network share mounts)
    'ms-msdt',
    'search-ms',
    'search',
    'ms-officecmd',
    'ms-cxh',
    'ms-cxh-full',
    'ms-appinstaller',
    'smb',
]);
const UNCONFIRMED_ALLOWED_SCHEMES = new Set([
    'http',
    'https',
    'mailto',
]);
function parseUrl(url) {
    if (typeof url !== 'string') {
        return null;
    }
    try {
        return new URL(url);
    }
    catch {
        return null;
    }
}
function classifyParsedExternalUrl(parsed, policy) {
    const scheme = parsed.protocol.slice(0, -1);
    // Single-letter schemes match Windows drive paths such as `C:\x.exe`.
    if (scheme.length === 1 || exports.DENIED_EXTERNAL_SCHEMES.has(scheme)) {
        return 'deny';
    }
    if (policy === 'unconfirmed' && !UNCONFIRMED_ALLOWED_SCHEMES.has(scheme)) {
        return 'deny';
    }
    return 'allow';
}
/**
 * Classifies an untrusted candidate URL for launching via the OS handler under
 * `policy`.
 */
function classifyExternalUrl(url, policy) {
    const parsed = parseUrl(url);
    return parsed ? classifyParsedExternalUrl(parsed, policy) : 'deny';
}
/**
 * Validates `url` under `policy` and, when allowed, opens the normalized
 * `URL.href` with `shell.openExternal`. Logs a scheme-only warning without
 * throwing when denied or when `shell.openExternal` rejects.
 */
async function openExternalSafely(url, policy) {
    const parsed = parseUrl(url);
    const scheme = parsed ? parsed.protocol.slice(0, -1) : '<invalid>';
    if (!parsed || classifyParsedExternalUrl(parsed, policy) !== 'allow') {
        console.warn(`[externalUrl] Blocked external URL with scheme "${scheme}"`);
        return;
    }
    try {
        await electron_1.shell.openExternal(parsed.href);
    }
    catch (err) {
        // OS errors may embed the full target URL in `err.message`.
        const errType = err instanceof Error ? err.name : typeof err;
        console.warn(`[externalUrl] Failed to open external URL with scheme "${scheme}" (${errType})`);
    }
}
/**
 * Returns `true` iff `targetUrl` and `currentUrl` parse as valid URLs with
 * matching non-opaque (`!== 'null'`) origins.
 */
function isSameOrigin(targetUrl, currentUrl) {
    if (!URL.canParse(targetUrl) || !URL.canParse(currentUrl)) {
        return false;
    }
    const targetOrigin = new URL(targetUrl).origin;
    const currentOrigin = new URL(currentUrl).origin;
    if (targetOrigin === 'null' || currentOrigin === 'null') {
        return false;
    }
    return targetOrigin === currentOrigin;
}
