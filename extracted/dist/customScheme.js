"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extensionAuthorities = void 0;
exports.registerCustomSchemes = registerCustomSchemes;
exports.registerCustomSchemeHandlers = registerCustomSchemeHandlers;
const electron_1 = require("electron");
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
    ]);
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
        const targetUrl = new URL(url.pathname + url.search, originalHost);
        try {
            const fetchOptions = {
                method: request.method,
                headers: request.headers,
                body: request.body,
            };
            if (request.body) {
                // Required by Electron's net.fetch when the body is a stream
                fetchOptions.duplex = 'half';
            }
            const response = await electron_1.net.fetch(targetUrl.toString(), fetchOptions);
            return response;
        }
        catch (err) {
            console.error(`Failed to proxy request to ${targetUrl}:`, err);
            return new Response(null, { status: 500 });
        }
    });
}
