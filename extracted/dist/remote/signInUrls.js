"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyOpenUrl = classifyOpenUrl;
exports.isSignInOrigin = isSignInOrigin;
/**
 * The remote language server's (LS) own sign-in URLs, pinned to exactly what
 * it prints: the only URLs from an SSH remote the Hub opens.
 */
const signInCallback_1 = require("./signInCallback");
/** Besides per-client extras (language_server/auth_client). */
const LS_GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
];
/** The LS's clients (language_server/code_assist_client, auth_client). */
const SIGN_IN_CLIENTS = [
    {
        // Personal accounts.
        origin: 'https://accounts.google.com',
        paths: ['/o/oauth2/auth', '/o/oauth2/v2/auth'],
        clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
        scopes: [...LS_GOOGLE_SCOPES, 'https://www.googleapis.com/auth/aicode'],
        prompt: 'consent',
    },
    {
        // Google Cloud (business) accounts.
        origin: 'https://accounts.google.com',
        paths: ['/o/oauth2/auth', '/o/oauth2/v2/auth'],
        clientId: '884354919052-36trc1jjb3tguiac32ov6cod268c5blh.apps.googleusercontent.com',
        scopes: LS_GOOGLE_SCOPES,
        prompt: 'consent',
    },
    {
        // Workforce Identity Federation: provider_name (Login RPC input) can name
        // any pool's IdP, whose sign-in may be silent, so the Hub asks the user
        // first, before it listens for the callback.
        origin: 'https://auth.cloud.google',
        paths: ['/authorize'],
        // The LS's BusinessWIFOAuthClientID, verbatim: the 9-character group is real.
        clientId: 'a2a6f0e3e-3ff0-462b-869a-47277df4c806',
        scopes: [
            'https://www.googleapis.com/auth/cloud-platform',
            'openid',
            'email',
            'profile',
            'offline_access',
        ],
        prompt: undefined,
    },
];
/**
 * A workforce pool provider in IAM's format, the only provider_name
 * auth.cloud.google accepts; the LS passes on what it's given.
 */
const WIF_PROVIDER_NAME = /^locations\/global\/workforcePools\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/providers\/[a-z0-9-]{4,32}$/;
/** golang.org/x/oauth2's AuthCodeURL with PKCE: any other isn't the LS's. */
const SIGN_IN_PARAMS = new Set([
    'access_type',
    'client_id',
    'code_challenge',
    'code_challenge_method',
    'prompt',
    'provider_name',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
]);
/**
 * Pins all a remote process could vary: endpoint, client, exact scopes (the
 * LS's Login RPC allows extra ones) and prompt (prompt=none could silently
 * hand out a token for an approved client), PKCE and the loopback redirect.
 * A WIF provider_name can name any pool: `provider` is set, so the Hub asks.
 */
function classifyOpenUrl(url) {
    if (url.username || url.password || url.hash) {
        return undefined;
    }
    // Only Go's query encoding: no ';' or anything else parsers disagree on.
    if (!/^\?[A-Za-z0-9\-._~%+=&]*$/.test(url.search)) {
        return undefined;
    }
    const params = new Map();
    for (const [name, value] of url.searchParams) {
        if (!SIGN_IN_PARAMS.has(name) || params.has(name)) {
            return undefined;
        }
        params.set(name, value);
    }
    const client = SIGN_IN_CLIENTS.find((c) => c.origin === url.origin &&
        c.paths.includes(url.pathname) &&
        c.clientId === params.get('client_id'));
    if (!client ||
        params.get('response_type') !== 'code' ||
        params.get('access_type') !== 'offline' ||
        params.get('code_challenge_method') !== 'S256' ||
        !params.get('code_challenge')) {
        return undefined;
    }
    const provider = params.get('provider_name');
    // The whole value: neither "consent none" nor "none<TAB>consent" passes.
    const promptOk = client.prompt === undefined
        ? !params.has('prompt') && WIF_PROVIDER_NAME.test(provider ?? '')
        : params.get('prompt') === client.prompt && provider === undefined;
    if (!promptOk || !hasExactScopes(params.get('scope'), client.scopes)) {
        return undefined;
    }
    const state = params.get('state');
    const callbackPort = loopbackCallbackPort(params.get('redirect_uri'));
    if (!state || callbackPort === undefined) {
        return undefined;
    }
    return provider === undefined
        ? { callbackPort, state }
        : { callbackPort, state, provider };
}
/** For sign-in URLs classifyOpenUrl rejects, e.g. another LS version's. */
function isSignInOrigin(url) {
    return SIGN_IN_CLIENTS.some((c) => c.origin === url.origin);
}
function hasExactScopes(scope, expected) {
    // Single spaces only: other whitespace could split differently elsewhere.
    if (scope === undefined || /[^\S ]/.test(scope)) {
        return false;
    }
    const scopes = scope.split(' ');
    return (scopes.length === expected.length &&
        new Set(scopes).size === scopes.length &&
        scopes.every((s) => expected.includes(s)));
}
function loopbackCallbackPort(redirect) {
    // As text: URL parsing would accept variants (127.1) the LS never sends.
    const m = /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9]\d{3,4})(\/.*)$/.exec(redirect ?? '');
    const port = m && m[2] === signInCallback_1.SIGN_IN_CALLBACK_PATH ? Number(m[1]) : NaN;
    // Never privileged ports.
    return port >= 1024 && port <= 65535 ? port : undefined;
}
