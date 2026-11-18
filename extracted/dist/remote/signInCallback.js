"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGN_IN_CALLBACK_PATH = void 0;
exports.startSignInCallback = startSignInCallback;
/**
 * The laptop's end of a loopback sign-in on an SSH remote: the remote language
 * server's (LS) own, or one its window opened (e.g. a plugin's). Tunnelling
 * the port would give the remote every browser request to localhost:<port>,
 * cookies included, and let a remote process answer. So the Hub takes one GET
 * of the redirect's path with the sign-in's `state`, relays only its path and
 * query, sends the browser on to Antigravity's sign-in success page (or shows
 * a fixed page) and stops; anything else gets a 404.
 *
 * That `state` is the Hub's own: it opens the sign-in with a fresh one in
 * place of the remote's, and puts the remote's back when it relays. The
 * remote picks the port and its own state, so otherwise any request it got
 * the browser to make with them (e.g. through a page that redirects to
 * another sign-in) would bring a code back to it as if from this one.
 */
const http = __importStar(require("http"));
/** The LS's OAuth loopback redirect path (auth_client/acquirer.go). */
exports.SIGN_IN_CALLBACK_PATH = '/auth/callback';
/** Rejects with the listen error (e.g. EADDRINUSE). */
async function startSignInCallback(opts) {
    const callbackPath = opts.path ?? exports.SIGN_IN_CALLBACK_PATH;
    if (opts.successUrl !== undefined) {
        // Ours, never the remote's: a check against a caller's mistake.
        if (new URL(opts.successUrl).protocol !== 'https:') {
            throw new Error('The sign-in success page must be https');
        }
    }
    const host = escapeHtml(opts.hostLabel ?? 'SSH 主机');
    let handled = false;
    let ending;
    let endedWith = () => { };
    const ended = new Promise((r) => (endedWith = r));
    const servers = [];
    const end = (how) => {
        ending ?? (ending = (async () => {
            clearTimeout(timer);
            await Promise.all(servers.map((server) => new Promise((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            })));
            endedWith(how);
        })());
        return ending;
    };
    const onRequest = (req, res) => {
        // The base only makes relative request targets parseable.
        let url;
        try {
            url = new URL(req.url ?? '', 'http://localhost');
        }
        catch {
            url = undefined;
        }
        const states = url?.searchParams.getAll('state') ?? [];
        if (handled ||
            ending ||
            !url ||
            req.method !== 'GET' ||
            url.pathname !== callbackPath ||
            states.length !== 1 ||
            states[0] !== opts.state) {
            respond(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
            return;
        }
        handled = true;
        clearTimeout(timer);
        if (!fromIssuer(url, opts.issuer)) {
            opts.log?.('Refused a sign-in callback from another server.');
            respondPage(res, 400, otherIssuerPage(host));
            void end('refused');
            return;
        }
        const query = withHostState(url.search, opts.hostState);
        const pathAndQuery = `${callbackPath}?${query}`;
        // Subscribed now: 'close' fires once, maybe during the relay.
        const closed = new Promise((resolve) => res.once('close', resolve));
        void (async () => {
            let answer;
            try {
                const status = await opts.relay(pathAndQuery);
                opts.log?.(`Passed the sign-in callback on (HTTP ${status}).`);
                if (status >= 200 && status < 400) {
                    try {
                        opts.onSignedIn?.();
                    }
                    catch {
                        // Only bookkeeping: the browser still gets its page.
                    }
                    const { successUrl } = opts;
                    answer = successUrl
                        ? () => redirect(res, successUrl)
                        : () => respondPage(res, 200, SIGNED_IN);
                }
                else {
                    answer = () => respondPage(res, 502, failedPage(host, status));
                }
            }
            catch (err) {
                // Code or name only: messages may quote the auth code.
                opts.log?.(`Could not pass the sign-in callback on (${errorLabel(err)}).`);
                answer = () => respondPage(res, 502, unreachablePage(host));
            }
            if (!ending && !res.destroyed) {
                answer();
            }
            // Stop listening only once the browser has the page (or is gone).
            await closed;
            await end('relayed');
        })();
    };
    const timer = setTimeout(() => {
        opts.log?.('Gave up waiting for the sign-in callback.');
        void end('expired');
    }, opts.ttlMs);
    timer.unref();
    try {
        for (const listenHost of opts.listenHosts) {
            const server = http.createServer(onRequest);
            try {
                await new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen({ host: listenHost, port: opts.port }, () => {
                        server.removeListener('error', reject);
                        resolve();
                    });
                });
            }
            catch (err) {
                const code = errorLabel(err);
                if (listenHost === '::1' &&
                    (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT')) {
                    continue; // No IPv6 loopback here, so nobody else has it either.
                }
                throw err;
            }
            server.on('error', (err) => opts.log?.(`Sign-in callback error: ${err.message}`));
            servers.push(server);
        }
    }
    catch (err) {
        await end('closed');
        throw err;
    }
    return {
        port: opts.port,
        path: callbackPath,
        state: opts.state,
        hostState: opts.hostState,
        issuer: opts.issuer,
        listenHosts: opts.listenHosts,
        ended,
        close: () => end('closed'),
    };
}
/**
 * Whether `url` (a callback) comes from `issuer`: it names no `iss`
 * (RFC 9207), or one https URL with that origin. Any server if unset.
 */
function fromIssuer(url, issuer) {
    const named = url.searchParams.getAll('iss');
    if (issuer === undefined || named.length === 0) {
        return true;
    }
    try {
        const iss = new URL(named[0]);
        return (named.length === 1 && iss.protocol === 'https:' && iss.origin === issuer);
    }
    catch {
        return false;
    }
}
/**
 * `search` (one `state`, checked) with the remote's state in place of the
 * Hub's; the rest stays as the browser sent it.
 */
function withHostState(search, hostState) {
    return search
        .slice(1)
        .split('&')
        .map((part) => 
    // Decoded as searchParams does, which found the one state.
    [...new URLSearchParams(part)][0]?.[0] === 'state'
        ? `state=${encodeURIComponent(hostState)}`
        : part)
        .join('&');
}
function errorLabel(err) {
    if (typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof err.code === 'string') {
        return err.code;
    }
    return err instanceof Error ? err.name : 'unknown error';
}
const SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    // The callback's URL holds the code: no page it leads to may see it.
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
};
function respond(res, status, contentType, body) {
    res.writeHead(status, {
        ...SECURITY_HEADERS,
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}
function respondPage(res, status, body) {
    respond(res, status, 'text/html; charset=utf-8', body);
}
function redirect(res, location) {
    res.writeHead(302, {
        ...SECURITY_HEADERS,
        Location: location,
        'Content-Length': 0,
    });
    res.end();
}
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
/**
 * Laid out like Antigravity's sign-in success page (antigravity.google/
 * auth-success): no scripts, images or fonts to fetch, which the CSP forbids.
 * `title` and `text` are HTML.
 */
function page(title, text) {
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        `<title>${title}</title><style>` +
        'html{color-scheme:light}' +
        'body{margin:0;min-height:100vh;display:flex;align-items:center;' +
        'justify-content:center;background:#fff;color:#202124;text-align:center;' +
        'font-family:"Google Sans","Google Sans Text",Roboto,system-ui,' +
        '-apple-system,"Segoe UI",sans-serif}' +
        'main{display:flex;flex-direction:column;align-items:center;gap:24px;' +
        'max-width:40em;padding:24px}' +
        '.brand{font-size:24px;font-weight:500;color:#5f6368}' +
        'h1{margin:0;font-size:32px;font-weight:500;line-height:1.25}' +
        'p{margin:0;font-size:14px;line-height:1.5;color:#5f6368}' +
        '</style></head><body><main>' +
        '<div class="brand">Google Antigravity</div>' +
        `<h1>${title}</h1><p>${text}</p></main></body></html>\n`);
}
const SIGNED_IN = page('您已成功完成身份验证。', '登录成功，您可以关闭此标签页并返回 Antigravity。');
function unreachablePage(host) {
    return page('登录未完成', `Antigravity 无法连接到 ${host} 以完成登录。请返回 Antigravity 重新发起登录。`);
}
function otherIssuerPage(host) {
    return page('登录未完成', `此次登录回调来自与您确认的登录页面不同的服务器，因此 Antigravity 未将其转发至 ${host}。`);
}
function failedPage(host, status) {
    return page('登录未完成', `${host} 上的 Antigravity 无法完成登录 (HTTP ${status})。请返回 Antigravity 重新发起登录。`);
}
