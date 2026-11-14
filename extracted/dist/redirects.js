"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isManualRedirect = isManualRedirect;
exports.fetchWithoutFollowing = fetchWithoutFollowing;
exports.pluginResponse = pluginResponse;
/**
 * Redirects in the Hub's fetches that follow none themselves: the plugin://
 * proxies (customScheme.ts here, and an SSH window's through its host) and
 * the SSH transport (remote/transport.ts).
 */
const electron_1 = require("electron");
const stream_1 = require("stream");
/** The statuses that browsers follow as redirects (not 300, 304 or 305). */
const REDIRECT_STATUSES = new Set([
    301, 302, 303, 307, 308,
]);
/** Responses without a body, as net.fetch makes them. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
/**
 * Whether a fetch with `redirect: 'manual'` met a redirect: Electron's fetch
 * rejects with "Redirect was cancelled", others may answer with an opaque
 * redirect (status 0).
 */
function isManualRedirect(outcome) {
    if (outcome instanceof Response) {
        return outcome.type === 'opaqueredirect';
    }
    return (outcome instanceof Error && /redirect was cancelled/i.test(outcome.message));
}
function toHeaders(raw) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(raw)) {
        for (const one of Array.isArray(value) ? value : [value]) {
            headers.append(name, one);
        }
    }
    return headers;
}
/**
 * Sends `request` to `url` as net.fetch does (method, headers, body, and the
 * session's cookies unless it has an Origin), on `session` (by default the
 * default one), but answers a redirect with the redirect itself: its status
 * and headers, the Location resolved, no body. net.fetch with
 * `redirect: 'manual'` rejects instead, without the Location. A Set-Cookie
 * on the redirect still reaches the session's cookies. The request's signal
 * counts until the answer: the body is then the caller's to cancel.
 */
function fetchWithoutFollowing(url, request, session) {
    return new Promise((resolve, reject) => {
        const { signal } = request;
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const origin = request.headers.get('origin') ?? undefined;
        const upstream = electron_1.net.request({
            url,
            method: request.method,
            session,
            origin,
            credentials: origin === undefined ? 'include' : 'same-origin',
            redirect: 'manual',
        });
        const abandon = () => {
            upstream.abort();
            reject(signal?.reason);
        };
        signal?.addEventListener('abort', abandon, { once: true });
        const answered = () => signal?.removeEventListener('abort', abandon);
        for (const [name, value] of request.headers) {
            upstream.setHeader(name, value);
        }
        upstream.on('redirect', (status, _method, location, headers) => {
            answered();
            const answer = toHeaders(headers);
            answer.set('location', location);
            // Not followed, so Electron then ends the request.
            resolve(new Response(null, { status, headers: answer }));
        });
        upstream.on('response', (response) => {
            answered();
            // Electron's IncomingMessage is a Readable; its types don't say so.
            if (!(response instanceof stream_1.Readable)) {
                reject(new Error('The response is not a stream'));
                return;
            }
            const body = NULL_BODY_STATUSES.has(response.statusCode) || request.method === 'HEAD'
                ? null
                : stream_1.Readable.toWeb(response);
            try {
                resolve(new Response(body, {
                    status: response.statusCode,
                    statusText: response.statusMessage,
                    headers: toHeaders(response.headers),
                }));
            }
            catch (err) {
                // E.g. a status outside 200 to 599: not thrown in an event handler.
                response.destroy();
                reject(err);
            }
        });
        upstream.on('error', reject);
        if (request.body) {
            // Whole: Electron sends a body that isn't chunked only once it ends.
            new Response(request.body).arrayBuffer().then((bytes) => upstream.end(Buffer.from(bytes)), (err) => {
                upstream.abort();
                reject(err);
            });
        }
        else {
            upstream.end();
        }
    });
}
/**
 * What a plugin:// frame at `frame` gets for its sidecar's `response` to
 * `target`: a redirect within the sidecar's origin as the same redirect to
 * plugin://, which the frame follows as browsers do, its URL too (relative
 * URLs resolve against it); any other redirect as a 502, logged without the
 * query. Anything else as it is.
 */
function pluginResponse(response, target, frame) {
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return response;
    }
    // Not passed on (one Chromium didn't follow, as its Location is no URL).
    void response.body?.cancel().catch(() => { });
    let to;
    try {
        to = new URL(location, target);
    }
    catch {
        // No URL: no redirect to follow.
    }
    if (to?.origin !== target.origin) {
        console.warn(`plugin:// follows redirects only within the sidecar's origin: ${target.origin}${target.pathname} sent another`);
        return new Response(null, { status: 502 });
    }
    const headers = new Headers(response.headers);
    // Not a relative "//x/...", which would leave the frame's authority.
    headers.set('location', `${frame.protocol}//${frame.host}${to.pathname}${to.search}${to.hash}`);
    return new Response(null, { status: response.status, headers });
}
