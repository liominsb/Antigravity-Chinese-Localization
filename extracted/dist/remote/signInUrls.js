"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyOpenUrl = classifyOpenUrl;
exports.isSignInOrigin = isSignInOrigin;
exports.withState = withState;
exports.classifyLoopbackSignInUrl = classifyLoopbackSignInUrl;
exports.withConsentPrompt = withConsentPrompt;
exports.redirectsToLocalNetwork = redirectsToLocalNetwork;
/**
 * The sign-in URLs from an SSH remote whose loopback callback the Hub takes:
 * the remote language server's (LS) own, pinned to exactly what it prints,
 * and other sign-ins its window opens (e.g. a plugin's), which the user must
 * agree to first.
 */
const localNetwork_1 = require("./localNetwork");
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
/**
 * `url` (one `state`, as the classifiers check) with `state` in place of
 * its own: the Hub's, which only the callback it relays brings back (see
 * signInCallback.ts). Its name is read in any case, as
 * classifyLoopbackSignInUrl reads it, and written as `state`. The rest
 * stays as it was.
 */
function withState(url, state) {
    const parts = url.search
        .slice(1)
        .split('&')
        .map((part) => [...new URLSearchParams(part)][0]?.[0]?.toLowerCase() === 'state'
        ? `state=${encodeURIComponent(state)}`
        : part);
    const replaced = new URL(url.href);
    replaced.search = `?${parts.join('&')}`;
    return replaced;
}
/** Long enough to be unguessable, short enough to log nothing big. */
const LOOPBACK_STATE = /^[\x21-\x7e]{8,512}$/;
/**
 * An OAuth authorization request (RFC 6749 4.1.1) with PKCE (RFC 7636) that
 * redirects to a loopback port (RFC 8252 7.3): what the LS's plugin and MCP
 * server sign-ins open. Never one that asks to skip the user (prompt=none):
 * relayed, a silent sign-in would hand the remote a code for any app the user
 * once allowed. Its authorization server is anyone's, so the user is asked.
 */
function classifyLoopbackSignInUrl(url) {
    if (url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        // Plain query encoding only: no ';' or anything else parsers disagree on.
        !/^\?[A-Za-z0-9\-._~%+=&]*$/.test(url.search) ||
        // No NUL, which servers may cut a value at, and no '&' in a value: a
        // server that decodes twice would read login_hint=a%26prompt%3Dnone as
        // a prompt.
        /%00|%26/i.test(url.search) ||
        // Names as plain tokens: '+prompt', '%20prompt' or 'prompt%3Dnone' may
        // read as prompt to a server, but not to the checks below.
        url.search
            .slice(1)
            .split('&')
            .some((part) => !/^[A-Za-z0-9\-._~]+(=|$)/.test(part))) {
        return undefined;
    }
    // Read in any case: some servers fold it (e.g. ASP.NET's query strings).
    const params = new Map();
    for (const [name, value] of url.searchParams) {
        // RFC 6749 3.1: no parameter twice; servers differ on which one counts.
        const key = name.toLowerCase();
        if (params.has(key)) {
            return undefined;
        }
        params.set(key, value);
    }
    const state = params.get('state');
    const redirect = parseLoopbackRedirect(params.get('redirect_uri'));
    if (
    // A request object (RFC 9101) or a pushed one (RFC 9126) wins over the
    // query, so the prompt the Hub adds would count for nothing.
    params.has('request') ||
        params.has('request_uri') ||
        params.get('response_type') !== 'code' ||
        !params.get('client_id') ||
        params.get('code_challenge_method') !== 'S256' ||
        !params.get('code_challenge') ||
        // Any spelling: none of prompt's real values contains it.
        /none/i.test(params.get('prompt') ?? '') ||
        !state ||
        !LOOPBACK_STATE.test(state) ||
        !redirect) {
        return undefined;
    }
    return { ...redirect, state, origin: url.origin };
}
/**
 * `url`, a sign-in classifyLoopbackSignInUrl accepted, with `consent` in its
 * prompt, keeping any other values (OIDC Core 3.1.2.1). The authorization
 * server then shows its consent screen, which names the app that asks, also
 * for an app the user already allowed: without it, Google asks only the first
 * time, so a host could get a code for any app the user once allowed. Other
 * servers ignore a parameter they don't know (RFC 6749 3.1). The rest of the
 * query stays as it was.
 */
function withConsentPrompt(url) {
    // In any case, as classifyLoopbackSignInUrl reads it: once at most.
    const [name, value] = [...url.searchParams].find(([n]) => isPromptName(n)) ?? [undefined, ''];
    const values = value.split(' ').filter(Boolean);
    // Exactly "prompt": a server that minds case ignores "Prompt".
    if (name === 'prompt' && values.includes('consent')) {
        return url;
    }
    if (!values.includes('consent')) {
        values.push('consent');
    }
    const parts = url.search
        .slice(1)
        .split('&')
        .filter((part) => part && !isPromptName(queryPartName(part)));
    const prompt = values.map(encodeURIComponent).join('%20');
    const consenting = new URL(url.href);
    consenting.search = `?${[...parts, `prompt=${prompt}`].join('&')}`;
    return consenting;
}
function isPromptName(name) {
    return name.toLowerCase() === 'prompt';
}
/** A query part's name, decoded as searchParams does (e.g. "pr%6Fmpt"). */
function queryPartName(part) {
    return [...new URLSearchParams(part)][0]?.[0] ?? '';
}
/**
 * Whether `url` asks for a redirect to this computer's own network (e.g. a
 * loopback sign-in classifyLoopbackSignInUrl rejects): opened, its code would
 * go to whatever listens there.
 */
function redirectsToLocalNetwork(url) {
    // In any case: some servers fold it.
    return [...url.searchParams].some(([name, redirect]) => {
        if (name.toLowerCase() !== 'redirect_uri') {
            return false;
        }
        try {
            return (0, localNetwork_1.isLocalNetworkHost)(new URL(redirect).hostname);
        }
        catch {
            return false;
        }
    });
}
function parseLoopbackRedirect(redirect) {
    // As text: URL parsing accepts variants (127.1, escapes) clients never send.
    const m = /^http:\/\/(localhost|127\.0\.0\.1):([1-9]\d{3,4})(\/[A-Za-z0-9\-._~/]*)?$/.exec(redirect ?? '');
    if (!m) {
        return undefined;
    }
    const port = Number(m[2]);
    const path = m[3] ?? '/';
    // Never privileged ports, and only paths the browser requests as they are.
    if (port < 1024 || port > 65535 || /\/\/|(^|\/)\.\.?(\/|$)/.test(path)) {
        return undefined;
    }
    return {
        callbackPort: port,
        callbackPath: path,
        // Browsers resolve "localhost" to either loopback: both must be ours, or
        // whoever holds the other could get the code.
        listenHosts: m[1] === 'localhost' ? ['127.0.0.1', '::1'] : ['127.0.0.1'],
    };
}
