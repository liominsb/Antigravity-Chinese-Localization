"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteSidecarRoutes = void 0;
exports.sidecarRoutesOf = sidecarRoutesOf;
exports.loopbackPortOf = loopbackPortOf;
exports.installRemoteSidecarProtocol = installRemoteSidecarProtocol;
const redirects_1 = require("../redirects");
const LOOPBACK_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
]);
/**
 * Upstream fetches at once per host; further requests wait their turn. The
 * renderer sends a page's whole first paint at once (custom schemes skip its
 * request scheduler), and each fetch holds main-process objects until the
 * remote answers its headers. Per host, not per sidecar: a stuck sidecar
 * makes the host's others wait (a coarser cut than Chromium's per-port pool,
 * for a plugin that the host's user installed) until its requests time out.
 */
const MAX_UPSTREAM = 64;
/**
 * Waiting plus in flight per host; beyond it a request gets 503. Blink's own
 * renderer-side scheduler allows 1024 outstanding requests per frame
 * (kLimitForRendererSideResourceScheduler), so an honest page never gets here.
 */
const MAX_PENDING = 1024;
/**
 * How long a sidecar may take to answer (its headers, and for a type that
 * Chromium sniffs, the first bytes or the end of the body): 504 after that,
 * which frees the slot. Electron never aborts a handler's request when the
 * page gives up on it (checked on Electron 44), so only this bounds a sidecar
 * that never answers.
 */
const SIDECAR_ANSWER_TIMEOUT_MS = 60000;
/** The remote's loopback, through the SOCKS proxy (the LS binds localhost). */
const REMOTE_LOOPBACK = '127.0.0.1';
/** For the LS's list of its sidecars. */
const SIDECAR_LIST_TIMEOUT_MS = 5000;
/**
 * An SSH session's `plugin://` routes: for each sidecar that the host's LS
 * lists, the toolkit's authority for it -> the port of its base URL on the
 * host's loopback.
 */
class RemoteSidecarRoutes {
    /** `ls` gives undefined while the session isn't up. */
    constructor(ls) {
        this.ls = ls;
        this.routes = new Map();
        /**
         * Ends with the last listing asked for (why it failed, if it did): one at
         * a time, so an older one can't end after a newer one. Never rejects.
         */
        this.listed = Promise.resolve(undefined);
        /** A listing is asked for and not started: who asks now shares it. */
        this.queued = false;
    }
    /**
     * Lists the LS's sidecars in a listing that starts after this call; if it
     * fails, the routes stay as they were. Resolves with why it failed.
     */
    refresh() {
        if (!this.queued) {
            this.queued = true;
            this.listed = this.listed.then(() => {
                this.queued = false;
                return this.list();
            });
        }
        return this.listed;
    }
    /**
     * The host port of `plugin://<authority>`, once the listings asked for so
     * far have ended: the page's send on a load or a reconnect comes just
     * before its iframes' requests. An authority that they don't list gets a
     * listing of its own first: its sidecar may have started since.
     */
    async port(authority) {
        await this.listed;
        if (!this.routes.has(authority)) {
            await this.refresh();
        }
        return this.routes.get(authority);
    }
    async list() {
        try {
            const ls = this.ls();
            if (!ls) {
                throw new Error('not connected');
            }
            this.routes = await listSidecarRoutes(ls);
            return undefined;
        }
        catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    }
}
exports.RemoteSidecarRoutes = RemoteSidecarRoutes;
/**
 * The routes of the sidecars that the LS runs: its GetSidecars, through the
 * Hub's transport. Rejects if the LS doesn't answer it.
 */
async function listSidecarRoutes(ls) {
    const res = await ls.transport.fetch(`http://${REMOTE_LOOPBACK}:${ls.httpPort}/exa.language_server_pb.LanguageServerService/GetSidecars`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'connect-protocol-version': '1',
            'x-codeium-csrf-token': ls.csrfToken,
        },
        body: '{}',
        redirect: 'manual',
        signal: AbortSignal.timeout(SIDECAR_LIST_TIMEOUT_MS),
    });
    if (res.status !== 200) {
        await res.body?.cancel().catch(() => { });
        throw new Error(`GetSidecars answered HTTP ${res.status}`);
    }
    return sidecarRoutesOf(await res.json());
}
/**
 * Authority -> host port for the sidecars of a GetSidecarsResponse, as the
 * toolkit's buildAuthorities() keys its map (createExtensibilityProvider.ts):
 * those with an id, a web port and a base URL, here a loopback one. Exported
 * for tests.
 */
function sidecarRoutesOf(body) {
    const routes = new Map();
    const sidecars = isRecord(body) && Array.isArray(body.sidecars) ? body.sidecars : [];
    for (const sidecar of sidecars) {
        if (!isRecord(sidecar)) {
            continue;
        }
        const { sidecarId, webPort, baseUrl } = sidecar;
        const port = typeof baseUrl === 'string' ? loopbackPortOf(baseUrl) : undefined;
        if (typeof sidecarId === 'string' &&
            sidecarId !== '' &&
            typeof webPort === 'number' &&
            webPort !== 0 &&
            port !== undefined) {
            routes.set(sidecarAuthority(sidecarId, webPort), port);
        }
    }
    return routes;
}
/**
 * The toolkit's sidecarAuthority(), the host of a sidecar's `plugin://` URL:
 * its id with `/` as `--`, then `-<webPort>`, lower-cased.
 */
function sidecarAuthority(sidecarId, webPort) {
    return `${sidecarId.replace(/\//g, '--')}-${webPort}`.toLowerCase();
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
/**
 * The port of a sidecar base URL on the LS's loopback: `http:`, `localhost`
 * or `127.0.0.1`, an explicit port, no path; the query (the UI token) and
 * anything after it are ignored, like customScheme.ts does. Exported for
 * tests.
 */
function loopbackPortOf(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl);
    }
    catch {
        return undefined;
    }
    if (url.protocol !== 'http:' ||
        !LOOPBACK_HOSTNAMES.has(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.port === '') {
        return undefined;
    }
    // The parser leaves only 0..65535 here (and '' for the default port).
    const port = Number(url.port);
    return port > 0 ? port : undefined;
}
const sessionRoutes = new WeakMap();
/**
 * Serves `plugin://` on an SSH window's session (a handler once per session;
 * a later install only replaces `getSession`). Requests go to the host's
 * current session, whose sidecar fetch reaches only
 * `http://127.0.0.1:<port>/` and follows no redirect itself: the frame
 * follows one within the sidecar's origin, any other is a 502
 * (pluginResponse); `getSession` returns undefined while the host is
 * disconnected (503).
 * Electron keeps a partition's handlers apart from the default session's:
 * local windows' plugin:// map is never consulted here, nor this one there.
 */
function installRemoteSidecarProtocol(ses, getSession) {
    const installed = sessionRoutes.get(ses);
    if (installed) {
        installed.getSession = getSession;
        return;
    }
    if (typeof ses.protocol?.handle !== 'function') {
        throw new Error('Cannot serve plugin:// on an SSH session');
    }
    const route = { getSession, inFlight: 0, waiters: [] };
    ses.protocol.handle('plugin', (request) => handleRemoteSidecarRequest(route, request));
    // Only once handle() returned: a throw leaves the session to a retry.
    sessionRoutes.set(ses, route);
}
/** Resolves with a slot, or false when the host's queue is full. */
async function acquireSlot(route) {
    if (route.inFlight + route.waiters.length >= MAX_PENDING) {
        return false;
    }
    if (route.inFlight < MAX_UPSTREAM) {
        route.inFlight++;
        return true;
    }
    await new Promise((resolve) => route.waiters.push(resolve));
    return true;
}
function releaseSlot(route) {
    const next = route.waiters.shift();
    if (next) {
        next(); // The slot passes on; inFlight is unchanged.
    }
    else {
        route.inFlight--;
    }
}
/**
 * Like customScheme.ts's local handler (method, headers and body pass
 * through, and redirects as there), with the remote's answers: 503 while disconnected or with
 * MAX_PENDING requests already pending, 404 for an authority that the host's
 * LS doesn't list, 502 when the sidecar can't be reached or redirects off
 * its origin, 504 when it doesn't answer in time.
 */
async function handleRemoteSidecarRequest(route, request) {
    const url = new URL(request.url);
    const session = route.getSession();
    if (!session?.sidecarFetch) {
        return new Response(null, { status: 503 });
    }
    if (!(await acquireSlot(route))) {
        return new Response(null, { status: 503 });
    }
    try {
        const port = await session.sidecars.port(url.hostname);
        // Read again, before any 404: the host may have dropped, or reconnected,
        // meanwhile, and a session that dropped can't list its sidecars.
        const remote = route.getSession() === session ? session.sidecarFetch : undefined;
        if (!remote) {
            return new Response(null, { status: 503 });
        }
        if (port === undefined) {
            return new Response(null, { status: 404 });
        }
        // A string, not new URL(path, base): a path like "//host/x" stays a path.
        // Chromium gives a plugin:// URL at least "/"; the transport needs it.
        return await fetchSidecar(remote, `http://${REMOTE_LOOPBACK}:${port}${url.pathname || '/'}${url.search}`, request, url);
    }
    finally {
        // The slot is for the answer: a streaming body holds no main-process work.
        releaseSlot(route);
    }
}
/**
 * The sidecar's answer to `target`, as the frame at `frame` gets it
 * (pluginResponse: a redirect within the sidecar's origin is the frame's to
 * follow, another is a 502); 502 for a failed fetch, 504 if late.
 */
async function fetchSidecar(remote, target, request, frame) {
    const late = new AbortController();
    const timer = setTimeout(() => late.abort(), SIDECAR_ANSWER_TIMEOUT_MS);
    try {
        const res = await remote.fetch(target, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: late.signal,
        });
        const asked = new URL(target);
        return (0, redirects_1.pluginResponse)(asAsked(res, asked), asked, frame);
    }
    catch {
        return new Response(null, { status: late.signal.aborted ? 504 : 502 });
    }
    finally {
        // Until the answer only: its body may stream for longer.
        clearTimeout(timer);
    }
}
/**
 * A redirect to `localhost`, as the LS names its sidecars, as one to the
 * 127.0.0.1 that the transport asks; pluginResponse() compares the rest.
 */
function asAsked(res, asked) {
    const location = res.headers.get('location');
    if (res.status < 300 || res.status > 399 || location === null) {
        return res;
    }
    let to;
    try {
        to = new URL(location, asked);
    }
    catch {
        return res; // No URL: pluginResponse() answers 502.
    }
    if (to.hostname !== 'localhost') {
        return res;
    }
    to.hostname = asked.hostname;
    const headers = new Headers(res.headers);
    headers.set('location', to.href);
    return new Response(res.body, { status: res.status, headers });
}
