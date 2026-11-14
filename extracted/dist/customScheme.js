"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extensionAuthorities = void 0;
exports.registerCustomSchemes = registerCustomSchemes;
exports.handleFaviconProtocolRequest = handleFaviconProtocolRequest;
exports.registerCustomSchemeHandlers = registerCustomSchemeHandlers;
const electron_1 = require("electron");
const faviconStore_1 = require("./faviconStore");
const redirects_1 = require("./redirects");
// A map of extension authority -> original URL (http://localhost:<port>)
// The authority is usually a hash of unique extension identifiers
// like extension ID + port + project ID. An extension running on localhost:<port>
// is then exposed on plugin://<authority>.
exports.extensionAuthorities = new Map();
function registerCustomSchemes() {
    electron_1.protocol.registerSchemesAsPrivileged([
        {
            scheme: 'plugin',
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                allowServiceWorkers: true,
                codeCache: true,
            },
        },
        {
            // Serves cached favicon bytes to the Hub renderer's <img> tags only, so
            // no fetch, CORS, or service-worker privileges.
            scheme: faviconStore_1.FAVICON_SCHEME,
            privileges: { standard: true, secure: true },
        },
    ]);
}
/**
 * Handles `agy-favicon://<token>/` by looking the token up in the favicon
 * store. Never fetches: unknown tokens and any other path are 404.
 */
function handleFaviconProtocolRequest(request) {
    if (request.method !== 'GET') {
        return new Response(null, { status: 405 });
    }
    let url;
    try {
        url = new URL(request.url);
    }
    catch {
        return new Response(null, { status: 404 });
    }
    const favicon = url.pathname === '/' ? (0, faviconStore_1.lookupFaviconToken)(url.hostname) : undefined;
    if (!favicon) {
        return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(favicon.bytes), {
        status: 200,
        headers: {
            'Content-Type': favicon.mime,
            'X-Content-Type-Options': 'nosniff',
            // A top-level load of an SVG favicon must not run as a document.
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cache-Control': 'no-store',
        },
    });
}
function registerCustomSchemeHandlers() {
    // Handle custom scheme for UI extensions
    electron_1.protocol.handle('plugin', async (request) => {
        const url = new URL(request.url);
        const authority = url.hostname;
        const originalHost = exports.extensionAuthorities.get(authority);
        if (!originalHost) {
            return new Response(null, { status: 404 });
        }
        // Origin plus path: resolving a path like "//host/x" against the sidecar
        // URL would switch to another host.
        const sidecar = new URL(originalHost);
        const targetUrl = new URL(`${sidecar.origin}${url.pathname}${url.search}`);
        if (targetUrl.host !== sidecar.host) {
            return new Response(null, { status: 404 });
        }
        try {
            // With the main process's network and cookies. A redirect goes back to
            // the frame if it stays on the sidecar's origin (redirects.ts).
            const response = await (0, redirects_1.fetchWithoutFollowing)(targetUrl.href, request);
            return (0, redirects_1.pluginResponse)(response, targetUrl, url);
        }
        catch (err) {
            console.error(`Failed to proxy request to ${targetUrl}:`, err);
            return new Response(null, { status: 500 });
        }
    });
    // Module-level `protocol` binds to the default session only: the Hub
    // renderer's session, never a guest partition.
    electron_1.protocol.handle(faviconStore_1.FAVICON_SCHEME, handleFaviconProtocolRequest);
}
