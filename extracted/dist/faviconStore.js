"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RAW_FAVICON_BYTES = exports.FAVICON_SCHEME = void 0;
exports.resolveFaviconBytes = resolveFaviconBytes;
exports.getCachedFavicon = getCachedFavicon;
exports.lookupFaviconToken = lookupFaviconToken;
exports.getFaviconStoreBytesForTesting = getFaviconStoreBytesForTesting;
exports.clearFaviconStoreForTesting = clearFaviconStoreForTesting;
const node_crypto_1 = require("node:crypto");
/** Custom scheme the Hub renderer uses to load cached favicon bytes. */
exports.FAVICON_SCHEME = 'agy-favicon';
/** Largest favicon body the main process accepts, cached, or serves. */
exports.MAX_RAW_FAVICON_BYTES = 256 * 1024;
const MAX_FAVICON_STORE_ENTRIES = 256;
const MAX_FAVICON_STORE_BYTES = 8 * 1024 * 1024;
/**
 * MIME types that may be served over {@link FAVICON_SCHEME}, mapped to the
 * canonical `Content-Type` sent with them. SVG is the only document-capable
 * type, and the handler serves it with a `sandbox` CSP.
 */
const SERVABLE_FAVICON_MIME_TYPES = new Map([
    ['image/x-icon', 'image/x-icon'],
    ['image/vnd.microsoft.icon', 'image/x-icon'],
    ['image/png', 'image/png'],
    ['image/gif', 'image/gif'],
    ['image/jpeg', 'image/jpeg'],
    ['image/webp', 'image/webp'],
    ['image/svg+xml', 'image/svg+xml'],
]);
// Per-process secret: tokens can't be guessed or enumerated, and rotate on
// restart, so URLs persisted by an earlier process resolve to 404.
const tokenSecret = (0, node_crypto_1.randomBytes)(32);
// Insertion order is LRU order: the first key is the least recently used.
const entries = new Map();
let totalBytes = 0;
function tokenFor(sessionKey, iconUrl) {
    // Hex only: hosts of standard schemes are lowercased by the URL parser.
    return (0, node_crypto_1.createHmac)('sha256', tokenSecret)
        .update(`${sessionKey}\0${iconUrl}`)
        .digest('hex')
        .slice(0, 32);
}
function sizeOf(resolution) {
    return ((resolution.servable?.bytes.byteLength ?? 0) +
        (resolution.dataUrl?.length ?? 0));
}
function remove(token) {
    const existing = entries.get(token);
    if (existing) {
        entries.delete(token);
        totalBytes -= sizeOf(existing);
    }
}
/**
 * Caches the outcome of fetching `iconUrl` in the guest session `sessionKey`.
 *
 * Mints a servable `agy-favicon://` URL when the bytes are non-empty, within
 * {@link MAX_RAW_FAVICON_BYTES}, and of an allowlisted MIME type. Returns
 * undefined, caching nothing, when there is neither a servable form nor a
 * `dataUrl`.
 */
function resolveFaviconBytes(sessionKey, iconUrl, bytes, sniffedMime, dataUrl) {
    const mime = sniffedMime
        ? SERVABLE_FAVICON_MIME_TYPES.get(sniffedMime)
        : undefined;
    const token = tokenFor(sessionKey, iconUrl);
    const servable = mime && bytes.byteLength > 0 && bytes.byteLength <= exports.MAX_RAW_FAVICON_BYTES
        ? { url: `${exports.FAVICON_SCHEME}://${token}/`, mime, bytes }
        : undefined;
    if (!servable && !dataUrl) {
        return undefined;
    }
    const resolution = {
        ...(dataUrl ? { dataUrl } : {}),
        ...(servable ? { servable } : {}),
    };
    remove(token);
    entries.set(token, resolution);
    totalBytes += sizeOf(resolution);
    for (const oldest of entries.keys()) {
        if (entries.size <= MAX_FAVICON_STORE_ENTRIES &&
            totalBytes <= MAX_FAVICON_STORE_BYTES) {
            break;
        }
        remove(oldest);
    }
    return resolution;
}
/** Returns the cached resolution for `iconUrl` and marks it recently used. */
function getCachedFavicon(sessionKey, iconUrl) {
    const token = tokenFor(sessionKey, iconUrl);
    const resolution = entries.get(token);
    if (resolution) {
        entries.delete(token);
        entries.set(token, resolution);
    }
    return resolution;
}
/**
 * Looks up the servable favicon for an `agy-favicon://` token. Never fetches
 * and leaves LRU order unchanged.
 */
function lookupFaviconToken(token) {
    return entries.get(token)?.servable;
}
/** Total bytes currently held, for hermetic unit tests. */
function getFaviconStoreBytesForTesting() {
    return totalBytes;
}
/** Empties the store for hermetic unit tests. */
function clearFaviconStoreForTesting() {
    entries.clear();
    totalBytes = 0;
}
