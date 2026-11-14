"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSchemefulSite = getSchemefulSite;
exports.isCrossSite = isCrossSite;
exports.isCrossSiteSubframeRequest = isCrossSiteSubframeRequest;
exports.shouldWithholdCrossSiteCredentials = shouldWithholdCrossSiteCredentials;
exports.stripCrossSiteSubframeRequestCredentials = stripCrossSiteSubframeRequestCredentials;
exports.withoutSetCookie = withoutSetCookie;
exports.stripCrossSiteSubframeResponseCookies = stripCrossSiteSubframeResponseCookies;
exports.configureSessionCrossSiteCredentialPolicy = configureSessionCrossSiteCredentialPolicy;
const electron_1 = require("electron");
const guestAgentControl_1 = require("./guestAgentControl");
const guestRequestHeaders_1 = require("./guestRequestHeaders");
const scriptJail_1 = require("./scriptJail");
/**
 * Second-level labels of country-code TLDs that are registries themselves
 * (`example.co.uk`), so a registrable domain under them keeps three labels.
 *
 * Mirrors `getSchemefulSite` in the agent UI toolkit's
 * `agentBrowser/subframeProtocol.ts`, which redacts the same cross-site frames
 * from agent screenshots and snapshots (the toolkit gets the internal
 * `googlers.com` / `googleplex.com` suffixes from its corp host policy).
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
    'ac.in',
    'ac.jp',
    'ac.kr',
    'ac.uk',
    'ac.za',
    'co.id',
    'co.il',
    'co.in',
    'co.jp',
    'co.ke',
    'co.kr',
    'co.nz',
    'co.th',
    'co.uk',
    'co.ve',
    'co.za',
    'com.ar',
    'com.au',
    'com.br',
    'com.cn',
    'com.co',
    'com.eg',
    'com.hk',
    'com.mx',
    'com.my',
    'com.ng',
    'com.pe',
    'com.ph',
    'com.pk',
    'com.sa',
    'com.sg',
    'com.tr',
    'com.tw',
    'com.ua',
    'com.vn',
    'edu.au',
    'edu.cn',
    'go.jp',
    'go.kr',
    'gob.mx',
    'gov.au',
    'gov.cn',
    'gov.in',
    'gov.uk',
    'gov.za',
    'ltd.uk',
    'me.uk',
    'ne.jp',
    'net.au',
    'net.cn',
    'net.in',
    'or.jp',
    'or.kr',
    'or.th',
    'org.au',
    'org.cn',
    'org.in',
    'org.nz',
    'org.uk',
    'plc.uk',
]);
/**
 * Generic second-level labels that country-code registries commonly sell
 * under (`example.com.ng`, `example.or.th`). Any `<label>.<two-letter TLD>`
 * with one of them is treated as a public suffix, so unlisted registries err
 * toward smaller sites (more redaction).
 */
const CC_GENERIC_SECOND_LEVELS = new Set([
    'ac',
    'co',
    'com',
    'edu',
    'go',
    'gob',
    'gouv',
    'gov',
    'ltd',
    'me',
    'mil',
    'ne',
    'net',
    'nhs',
    'nic',
    'nom',
    'or',
    'org',
    'plc',
    'sch',
]);
/**
 * Shared-hosting suffixes whose tenants get sibling subdomains
 * (`alice.github.io`, `bob.github.io`), plus Google first-party and internal
 * domains whose subdomains are separate apps with separate data
 * (`mail.google.com`, `sites.google.com`, `*.corp.google.com`,
 * `*.googlers.com`). Every host under one is its own site.
 */
const SHARED_HOSTING_SUFFIXES = [
    'amazonaws.com',
    'appspot.com',
    'azureedge.net',
    'azurestaticapps.net',
    'azurewebsites.net',
    'blob.core.windows.net',
    'blogspot.com',
    'cloud.goog',
    'cloudapp.net',
    'cloudflareworkers.com',
    'cloudfront.net',
    'cloudfunctions.net',
    'codesandbox.io',
    'corp.goog',
    'csb.app',
    'deno.dev',
    'firebaseapp.com',
    'firebaseio.com',
    'fly.dev',
    'framer.app',
    'github.io',
    'githubusercontent.com',
    'gitlab.io',
    'gitpod.io',
    'glitch.me',
    'google.com',
    'googleplex.com',
    'googlers.com',
    'googleusercontent.com',
    'herokuapp.com',
    'hf.space',
    'myshopify.com',
    'netlify.app',
    'ngrok-free.app',
    'ngrok.io',
    'notion.site',
    'ondigitalocean.app',
    'onrender.com',
    'pages.dev',
    'readthedocs.io',
    'repl.co',
    'replit.dev',
    'run.app',
    'sharepoint.com',
    'stackblitz.io',
    'streamlit.app',
    'substack.com',
    'surge.sh',
    'translate.goog',
    'trycloudflare.com',
    'vercel.app',
    'web.app',
    'webcontainer.io',
    'webflow.io',
    'wixsite.com',
    'wordpress.com',
    'workers.dev',
];
/**
 * Returns the schemeful site (`scheme://registrable-domain`) of `rawUrl`, or
 * `''` when it has no http(s) host. Loopback hosts share one site; other IP
 * and single-label hosts are their own site. Approximates the Public Suffix
 * List without shipping it: listed shared-hosting suffixes err toward smaller
 * sites (more stripping).
 */
function getSchemefulSite(rawUrl) {
    let parsed;
    try {
        parsed = new URL((rawUrl || '').trim());
    }
    catch {
        return '';
    }
    const scheme = parsed.protocol.toLowerCase();
    if (scheme !== 'http:' && scheme !== 'https:') {
        return '';
    }
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) {
        return '';
    }
    // Every loopback host is the user's own machine, so they are one site per
    // scheme (a dev page on 127.0.0.1 framing localhost stays same-site).
    if (host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '[::1]' ||
        /^127\.\d+\.\d+\.\d+$/.test(host)) {
        return `${scheme}//localhost`;
    }
    const isIp = host.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(host);
    const labels = host.split('.');
    if (isIp ||
        labels.length <= 2 ||
        SHARED_HOSTING_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
        return `${scheme}//${host}`;
    }
    const lastTwo = labels.slice(-2).join('.');
    const isMultiLabelSuffix = MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo) ||
        (labels[labels.length - 1].length === 2 &&
            CC_GENERIC_SECOND_LEVELS.has(labels[labels.length - 2]));
    const site = isMultiLabelSuffix ? labels.slice(-3).join('.') : lastTwo;
    return `${scheme}//${site}`;
}
/**
 * Returns whether `frameUrl` and `topUrl` are different schemeful sites.
 * Fails closed: a URL without an http(s) host is cross-site to everything.
 */
function isCrossSite(frameUrl, topUrl) {
    const frameSite = getSchemefulSite(frameUrl);
    return !frameSite || frameSite !== getSchemefulSite(topUrl);
}
/** Returns the id of the guest `details` belongs to, if known. */
function guestWebContentsId(details) {
    const id = typeof details.webContentsId === 'number'
        ? details.webContentsId
        : details.webContents?.id;
    return typeof id === 'number' && Number.isInteger(id) && id > 0
        ? id
        : undefined;
}
/** Request header names that carry the user's credentials to a site. */
const CREDENTIAL_REQUEST_HEADERS = new Set([
    'cookie',
    'authorization',
]);
/** Response header names that would write a site's cookies to the partition. */
const CREDENTIAL_RESPONSE_HEADERS = new Set([
    'set-cookie',
]);
/**
 * Returns the URL whose site `frame`'s document belongs to: its origin, else
 * its URL. Returns `''` for an opaque-origin `about:blank` / `about:srcdoc` /
 * not-yet-committed frame, which takes its site from its parent.
 */
function frameDocumentUrl(frame) {
    if (frame.origin && frame.origin !== 'null') {
        return frame.origin;
    }
    const url = (frame.url || '').trim();
    return !url || /^about:(?:blank|srcdoc)(?:[?#]|$)/i.test(url) ? '' : url;
}
function resolveTopUrl(details, getWebContentsUrl) {
    const top = details.frame?.top;
    const topUrl = top ? frameDocumentUrl(top) : '';
    if (topUrl) {
        return topUrl;
    }
    const id = guestWebContentsId(details);
    return id !== undefined ? (getWebContentsUrl(id) ?? '') : '';
}
function defaultWebContentsUrl(webContentsId) {
    try {
        const wc = electron_1.webContents?.fromId?.(webContentsId);
        return wc && !wc.isDestroyed() ? wc.getURL() : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Returns whether `details` is a request made by a subframe (or loading one,
 * including an `<object>` / `<embed>` load) where that frame, or any frame
 * between it and the top-level document, is cross-site to the top-level
 * document. A subresource request without a frame (a dedicated, shared, or
 * service worker) matches when both its URL and its referrer (the worker or
 * page that sent it) are cross-site to the top-level document, or it has no
 * referrer: a cross-site frame's worker loses its credentials, a top-level
 * page's worker keeps them. Main-frame requests never match. An unknown
 * top-level URL makes every matched kind of request cross-site (fail closed).
 */
function isCrossSiteSubframeRequest(details, getWebContentsUrl = defaultWebContentsUrl) {
    if (details.resourceType === 'mainFrame') {
        return false;
    }
    const frame = details.frame ?? undefined;
    const isSubframeNavigation = details.resourceType === 'subFrame' || details.resourceType === 'object';
    if (!frame && !isSubframeNavigation) {
        const topUrl = resolveTopUrl(details, getWebContentsUrl);
        const referrer = (details.referrer ?? '').trim();
        return (isCrossSite(details.url, topUrl) &&
            (!referrer || isCrossSite(referrer, topUrl)));
    }
    if (!isSubframeNavigation && !frame?.parent) {
        return false;
    }
    const topUrl = resolveTopUrl(details, getWebContentsUrl);
    const chain = isSubframeNavigation ? [details.url] : [];
    const seen = new Set();
    for (let cur = frame; cur?.parent && !seen.has(cur); cur = cur.parent) {
        seen.add(cur);
        const url = frameDocumentUrl(cur);
        if (url) {
            chain.push(url);
        }
    }
    return chain.some((url) => isCrossSite(url, topUrl));
}
/**
 * Returns whether credentials must be withheld from `details`: the request
 * comes from a guest the agent owns and a cross-site subframe, so it must load
 * signed-out (go/browser-use-agent-security, "Redact cross-site iframes").
 * Never throws: if the guest or its frames cannot be read (for example a
 * `WebFrameMain` disposed mid-request), any non-main-frame request of a guest
 * that may be agent-owned is withheld, so a listener always answers.
 */
function shouldWithholdCrossSiteCredentials(details, isAgentOwned = guestAgentControl_1.isGuestAgentOwned, getWebContentsUrl) {
    let owned;
    try {
        const id = guestWebContentsId(details);
        owned = id !== undefined && isAgentOwned(id);
    }
    catch {
        owned = true;
    }
    if (!owned) {
        return false;
    }
    try {
        return isCrossSiteSubframeRequest(details, getWebContentsUrl);
    }
    catch {
        return details.resourceType !== 'mainFrame';
    }
}
function withoutHeaders(headers, names) {
    const out = {};
    let removed = false;
    for (const [name, value] of Object.entries(headers ?? {})) {
        if (names.has(name.toLowerCase())) {
            removed = true;
        }
        else {
            out[name] = value;
        }
    }
    return { headers: out, removed };
}
/**
 * Returns `requestHeaders` without `Cookie` and `Authorization` when
 * {@link shouldWithholdCrossSiteCredentials} holds, else unchanged. Every other
 * header, including `User-Agent` and `Proxy-Authorization`, is kept.
 */
function stripCrossSiteSubframeRequestCredentials(details, isAgentOwned, getWebContentsUrl) {
    if (!shouldWithholdCrossSiteCredentials(details, isAgentOwned, getWebContentsUrl)) {
        return details.requestHeaders;
    }
    return withoutHeaders(details.requestHeaders, CREDENTIAL_REQUEST_HEADERS)
        .headers;
}
/** Returns `responseHeaders` without `Set-Cookie` (case-insensitive). */
function withoutSetCookie(responseHeaders) {
    return withoutHeaders(responseHeaders, CREDENTIAL_RESPONSE_HEADERS).headers;
}
/**
 * Returns `responseHeaders` without `Set-Cookie` when
 * {@link shouldWithholdCrossSiteCredentials} holds and the response sets a
 * cookie, else `undefined` (keep the response as is). A signed-out frame must
 * not overwrite the user's cookies for that site in the shared partition.
 */
function stripCrossSiteSubframeResponseCookies(details, isAgentOwned, getWebContentsUrl) {
    if (!details.responseHeaders ||
        !shouldWithholdCrossSiteCredentials(details, isAgentOwned, getWebContentsUrl)) {
        return undefined;
    }
    const { headers, removed } = withoutHeaders(details.responseHeaders, CREDENTIAL_RESPONSE_HEADERS);
    return removed ? headers : undefined;
}
const configuredCredentialSessions = new WeakSet();
/**
 * Adds (once per session) a request-header rewriter to a built-in browser
 * guest session's shared `onBeforeSendHeaders` pipeline (guestRequestHeaders.ts:
 * Electron keeps one listener per session, also used by the User-Agent
 * cleanup) that strips `Cookie` and `Authorization` from requests of
 * cross-site subframes in agent-owned guests. User tabs share the partition,
 * so ownership is resolved per request. `session.defaultSession` and Script
 * Jail sessions are left alone.
 */
function configureSessionCrossSiteCredentialPolicy(targetSession) {
    if (!targetSession ||
        typeof targetSession.webRequest?.onBeforeSendHeaders !== 'function' ||
        configuredCredentialSessions.has(targetSession) ||
        targetSession === electron_1.session?.defaultSession ||
        (0, scriptJail_1.isScriptJailSession)(targetSession)) {
        return;
    }
    configuredCredentialSessions.add(targetSession);
    (0, guestRequestHeaders_1.addGuestRequestHeaderRewriter)(targetSession, (details, requestHeaders) => {
        try {
            return stripCrossSiteSubframeRequestCredentials({
                ...details,
                requestHeaders,
            });
        }
        catch {
            // Unreachable while the policy keeps failing closed internally; kept so
            // a future throw still strips credentials unless it loads the top
            // document.
            return details?.resourceType === 'mainFrame'
                ? requestHeaders
                : withoutHeaders(requestHeaders, CREDENTIAL_REQUEST_HEADERS).headers;
        }
    });
}
