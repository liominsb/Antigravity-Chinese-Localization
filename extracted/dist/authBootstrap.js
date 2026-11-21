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
exports.WSL_AUTH_ENV_FORWARD = exports.MAX_MINT_RESPONSE_BYTES = exports.ACTIVE_LS_MINT_RETRY_DELAY_MS = exports.ACTIVE_LS_MINT_MAX_WAIT_MS = exports.ACTIVE_LS_MINT_ATTEMPT_TIMEOUT_MS = exports.MINT_BOOTSTRAP_TIMEOUT_MS = void 0;
exports.setActiveLanguageServerAuth = setActiveLanguageServerAuth;
exports.getActiveLsPort = getActiveLsPort;
exports.getActiveLsCsrfToken = getActiveLsCsrfToken;
exports.getActiveLsBaseUrl = getActiveLsBaseUrl;
exports.mintActiveLsBootstrapToken = mintActiveLsBootstrapToken;
exports.isLoopbackHostname = isLoopbackHostname;
exports.mintBootstrapToken = mintBootstrapToken;
exports.mintBootstrapTokenWithRetry = mintBootstrapTokenWithRetry;
exports.withBootstrapTokenFragment = withBootstrapTokenFragment;
exports.redactUrlTokens = redactUrlTokens;
exports.redactSensitiveArgsForLog = redactSensitiveArgsForLog;
exports.appendWslAuthEnvForwarding = appendWslAuthEnvForwarding;
exports.buildLsRestartWindowUrl = buildLsRestartWindowUrl;
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const constants_1 = require("./constants");
exports.MINT_BOOTSTRAP_TIMEOUT_MS = 2000;
exports.ACTIVE_LS_MINT_ATTEMPT_TIMEOUT_MS = 5000;
exports.ACTIVE_LS_MINT_MAX_WAIT_MS = 30000;
exports.ACTIVE_LS_MINT_RETRY_DELAY_MS = 150;
exports.MAX_MINT_RESPONSE_BYTES = 4096;
let _activeLsPort = 0;
let _activeLsCsrfToken = '';
/** Updates the active Language Server port and admin CSRF token held in main-process memory. */
function setActiveLanguageServerAuth(params) {
    if (params.port !== undefined) {
        _activeLsPort = params.port;
    }
    if (params.csrfToken !== undefined) {
        _activeLsCsrfToken = params.csrfToken;
    }
}
/** Returns the active Language Server HTTPS port, or `0` if not running. */
function getActiveLsPort() {
    return _activeLsPort;
}
/** Returns the active Language Server admin CSRF token held in main-process memory. */
function getActiveLsCsrfToken() {
    return _activeLsCsrfToken;
}
/** Returns the base URL (e.g. `https://127.0.0.1:54321`) of the active Language Server, if running. */
function getActiveLsBaseUrl() {
    return _activeLsPort > 0 ? `${constants_1.WINDOW_ORIGIN}:${_activeLsPort}` : undefined;
}
/**
 * Mints a single-use UI bootstrap token from `POST /auth/mint` on the active
 * Language Server.
 *
 * `language_server` logs its bound port (`setUpServerPortListeners`) several
 * seconds before `setUpHTTPServers` starts accepting TLS handshakes (while
 * running SQLite/plugin startup migrations). Retrying transient socket/timeout
 * failures within `ACTIVE_LS_MINT_MAX_WAIT_MS` ensures cold-start and restart
 * navigations reliably receive `#t=<bootstrapToken>`, while definitive HTTP
 * statuses (e.g. `200`, `401`, `403`, `404` on older dev binaries) return
 * immediately on the first response.
 */
async function mintActiveLsBootstrapToken() {
    const serverBaseUrl = getActiveLsBaseUrl();
    const csrfToken = _activeLsCsrfToken || undefined;
    if (!serverBaseUrl || !csrfToken) {
        return undefined;
    }
    return mintBootstrapTokenWithRetry({
        serverBaseUrl,
        csrfToken,
        attemptTimeoutMs: exports.ACTIVE_LS_MINT_ATTEMPT_TIMEOUT_MS,
        maxWaitMs: exports.ACTIVE_LS_MINT_MAX_WAIT_MS,
        retryDelayMs: exports.ACTIVE_LS_MINT_RETRY_DELAY_MS,
    });
}
exports.WSL_AUTH_ENV_FORWARD = 'ANTIGRAVITY_SERVER_CSRF_TOKEN/u:AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP/u';
const SENSITIVE_ARG_NAMES = new Set([
    '--csrf_token',
    '--extension_server_csrf_token',
    '--host_bridge_token',
]);
const REDACTED_QUERY_PARAMS = [
    'csrf',
    '_workstationAccessToken',
    '_cloudshellAccessToken',
];
/**
 * Returns `true` iff `hostname` is a loopback literal (`127.0.0.1`, `localhost`,
 * `::1`, or `[::1]`), case-insensitively.
 */
function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase();
    return (normalized === '127.0.0.1' ||
        normalized === 'localhost' ||
        normalized === '::1' ||
        normalized === '[::1]');
}
function mintBootstrapTokenAttempt(params) {
    const { serverBaseUrl, csrfToken, timeoutMs = exports.MINT_BOOTSTRAP_TIMEOUT_MS, requestFns, } = params;
    if (!serverBaseUrl || !csrfToken) {
        return Promise.resolve({ kind: 'definitive_failure' });
    }
    let mintUrl;
    try {
        mintUrl = new URL('/auth/mint', serverBaseUrl);
    }
    catch {
        return Promise.resolve({ kind: 'definitive_failure' });
    }
    const isHttps = mintUrl.protocol === 'https:';
    const isHttp = mintUrl.protocol === 'http:';
    if ((!isHttps && !isHttp) || !isLoopbackHostname(mintUrl.hostname)) {
        return Promise.resolve({ kind: 'definitive_failure' });
    }
    const payload = '{}';
    return new Promise((resolve) => {
        let req;
        let settled = false;
        const finish = (outcome) => {
            if (!settled) {
                settled = true;
                req?.setTimeout(0);
                resolve(outcome);
            }
        };
        const requestOptions = {
            method: 'POST',
            agent: false,
            // Node does not inherit Chromium's certificate-error trust for the LS's
            // embedded self-signed cert; safe strictly because loopback was verified above.
            ...(isHttps ? { rejectUnauthorized: false } : {}),
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'x-codeium-csrf-token': csrfToken,
            },
        };
        const requestFn = isHttps
            ? (requestFns?.httpsRequest ?? https.request)
            : (requestFns?.httpRequest ?? http.request);
        try {
            req = requestFn(mintUrl, requestOptions, (res) => {
                const status = res.statusCode ?? 0;
                let body = '';
                let bodyTooLarge = false;
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    if (body.length + chunk.length <= exports.MAX_MINT_RESPONSE_BYTES) {
                        body += chunk;
                    }
                    else {
                        bodyTooLarge = true;
                        finish({ kind: 'definitive_failure' });
                        req?.destroy();
                    }
                });
                res.on('end', () => {
                    if (status === 502 || status === 503 || status === 504) {
                        finish({ kind: 'retryable_failure' });
                        return;
                    }
                    if (status !== 200 || bodyTooLarge) {
                        finish({ kind: 'definitive_failure' });
                        return;
                    }
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed !== null &&
                            typeof parsed === 'object' &&
                            'bootstrapToken' in parsed &&
                            typeof parsed.bootstrapToken === 'string' &&
                            parsed.bootstrapToken.length > 0) {
                            finish({ kind: 'ok', token: parsed.bootstrapToken });
                            return;
                        }
                    }
                    catch {
                        // Fall through to definitive_failure.
                    }
                    finish({ kind: 'definitive_failure' });
                });
                res.on('error', () => finish({ kind: 'retryable_failure' }));
            });
            req.on('error', () => finish({ kind: 'retryable_failure' }));
            req.setTimeout(timeoutMs, () => {
                req?.destroy();
                finish({ kind: 'retryable_failure' });
            });
            req.end(payload);
        }
        catch {
            finish({ kind: 'definitive_failure' });
        }
    });
}
/**
 * Mints a single-use, 60s-TTL UI bootstrap token from `POST /auth/mint` on the
 * locally managed Language Server using the main process's admin CSRF token.
 *
 * Uses `node:https` / `node:http` directly so no Chromium `Origin` header is
 * attached (`POST /auth/mint` explicitly permits an omitted `Origin` from a
 * local host process and rejects unexpected `Origin` values with `403`).
 *
 * Never throws: resolves to `undefined` when `DEV_URL` is active, when no local
 * LS is running, when `serverBaseUrl` is non-loopback, or when talking to an
 * older dev-override LS binary whose `/auth/mint` returns 404.
 */
async function mintBootstrapToken(params) {
    const outcome = await mintBootstrapTokenAttempt(params);
    return outcome.kind === 'ok' ? outcome.token : undefined;
}
/**
 * Mints a bootstrap token while retrying transient socket/timeout failures up to
 * `maxWaitMs` (bridging the gap between `language_server` binding its TCP port
 * and starting `setUpHTTPServers` after startup migrations), while returning
 * immediately on definitive HTTP statuses (`200`, `401`, `403`, `404`, `500`).
 */
async function mintBootstrapTokenWithRetry(params) {
    const { serverBaseUrl, csrfToken, attemptTimeoutMs = exports.ACTIVE_LS_MINT_ATTEMPT_TIMEOUT_MS, maxWaitMs = exports.ACTIVE_LS_MINT_MAX_WAIT_MS, retryDelayMs = exports.ACTIVE_LS_MINT_RETRY_DELAY_MS, requestFns, } = params;
    if (!serverBaseUrl || !csrfToken) {
        return undefined;
    }
    const deadline = Date.now() + Math.max(1, maxWaitMs);
    while (true) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            return undefined;
        }
        const outcome = await mintBootstrapTokenAttempt({
            serverBaseUrl,
            csrfToken,
            timeoutMs: Math.min(attemptTimeoutMs, remainingMs),
            requestFns,
        });
        if (outcome.kind === 'ok') {
            return outcome.token;
        }
        if (outcome.kind === 'definitive_failure') {
            return undefined;
        }
        const afterAttemptRemaining = deadline - Date.now();
        if (afterAttemptRemaining <= 0) {
            return undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, afterAttemptRemaining)));
    }
}
function isBootstrapTokenHashParam(segment) {
    return segment === 't' || segment.startsWith('t=');
}
/**
 * Appends (or replaces) `t=<bootstrapToken>` in `urlString`'s URL fragment,
 * preserving pathname, query parameters, and any other fragment parameters
 * (matching `bootstrapAuthenticationFromFragment()` in Agent UI Toolkit).
 * If `bootstrapToken` is undefined or empty, strips any stale `t` parameter cleanly.
 */
function withBootstrapTokenFragment(urlString, bootstrapToken) {
    try {
        const url = new URL(urlString);
        const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
        const keptSegments = rawHash
            ? rawHash
                .split('&')
                .filter((seg) => seg.length > 0 && !isBootstrapTokenHashParam(seg))
            : [];
        if (bootstrapToken) {
            keptSegments.push(`t=${encodeURIComponent(bootstrapToken)}`);
        }
        url.hash = keptSegments.length > 0 ? `#${keptSegments.join('&')}` : '';
        return url.toString();
    }
    catch {
        return urlString;
    }
}
/**
 * Redacts `#t=<bootstrapToken>` (and query CSRF/access tokens) before writing
 * any URL to console or `main.log`.
 */
function redactUrlTokens(urlString) {
    try {
        const url = new URL(urlString);
        for (const key of REDACTED_QUERY_PARAMS) {
            if (url.searchParams.has(key)) {
                url.searchParams.set(key, 'REDACTED');
            }
        }
        if (url.hash) {
            const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
            if (rawHash) {
                let changed = false;
                const redactedSegments = rawHash.split('&').map((seg) => {
                    if (isBootstrapTokenHashParam(seg)) {
                        changed = true;
                        return 't=REDACTED';
                    }
                    return seg;
                });
                if (changed) {
                    url.hash = `#${redactedSegments.join('&')}`;
                }
            }
        }
        return url.toString();
    }
    catch {
        return urlString;
    }
}
/**
 * Redacts sensitive CLI flags (`--csrf_token`, `--extension_server_csrf_token`,
 * `--host_bridge_token`) in both `--flag=value` and `['--flag', 'value']` forms
 * before logging child `argv`.
 */
function redactSensitiveArgsForLog(args) {
    const redacted = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const eqIdx = arg.indexOf('=');
        if (eqIdx !== -1 && SENSITIVE_ARG_NAMES.has(arg.slice(0, eqIdx))) {
            redacted.push(`${arg.slice(0, eqIdx)}=REDACTED`);
            continue;
        }
        if (SENSITIVE_ARG_NAMES.has(arg)) {
            redacted.push(arg);
            if (i + 1 < args.length) {
                redacted.push('REDACTED');
                i++;
            }
            continue;
        }
        redacted.push(arg);
    }
    return redacted;
}
/**
 * Appends `ANTIGRAVITY_SERVER_CSRF_TOKEN/u:AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP/u`
 * to `env.WSLENV` (respecting case-insensitive Windows env keys) without
 * clobbering existing `WSLENV` entries.
 */
function appendWslAuthEnvForwarding(env) {
    const wslEnvKey = Object.keys(env).find((k) => k.toUpperCase() === 'WSLENV') || 'WSLENV';
    const existing = env[wslEnvKey]?.trim().replace(/:+$/, '');
    if (!existing) {
        env[wslEnvKey] = exports.WSL_AUTH_ENV_FORWARD;
        return;
    }
    const existingEntries = new Set(existing.split(':').filter(Boolean));
    const missing = exports.WSL_AUTH_ENV_FORWARD.split(':').filter((entry) => !existingEntries.has(entry));
    if (missing.length > 0) {
        env[wslEnvKey] = `${existing}:${missing.join(':')}`;
    }
}
/**
 * Constructs the re-navigation URL on `newServerBaseUrl` for an existing Hub
 * window after a Language Server restart, preserving the window's current
 * `pathname`, `search`, and non-`t` `hash`.
 *
 * Returns `undefined` for non-Hub auxiliary `data:` / `devtools:` / off-loopback
 * windows so modal helper windows (e.g. WebAuthn QR dialogs) are left untouched.
 */
function buildLsRestartWindowUrl(currentWindowUrl, newServerBaseUrl) {
    let base;
    try {
        base = new URL(newServerBaseUrl);
    }
    catch {
        return undefined;
    }
    const trimmed = currentWindowUrl?.trim() ?? '';
    if (!trimmed ||
        trimmed === 'about:blank' ||
        trimmed.startsWith('chrome-error://')) {
        return new URL('/', base).toString();
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        return new URL('/', base).toString();
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return undefined;
    }
    if (!isLoopbackHostname(parsed.hostname)) {
        return undefined;
    }
    const rebased = new URL(base.toString());
    rebased.pathname = parsed.pathname;
    rebased.search = parsed.search;
    rebased.hash = parsed.hash;
    return withBootstrapTokenFragment(rebased.toString(), undefined);
}
