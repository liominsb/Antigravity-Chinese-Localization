"use strict";
/**
 * One `webRequest.onBeforeSendHeaders` listener per guest session, shared by
 * every request-header policy.
 *
 * Electron keeps a single `onBeforeSendHeaders` listener per session: a second
 * registration silently replaces the first. Guest policies that rewrite
 * request headers (the User-Agent cleanup, cross-site subframe credential
 * stripping) therefore add a rewriter here instead of registering their own
 * listener. Rewriters run in registration order on the same header object.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.addGuestRequestHeaderRewriter = addGuestRequestHeaderRewriter;
const rewritersBySession = new WeakMap();
/**
 * Adds `rewriter` to `targetSession`'s request-header pipeline, installing the
 * session's single `onBeforeSendHeaders` listener on first use. Returns
 * `false` (and adds nothing) when the session has no `webRequest`.
 */
function addGuestRequestHeaderRewriter(targetSession, rewriter) {
    if (typeof targetSession.webRequest?.onBeforeSendHeaders !== 'function') {
        return false;
    }
    let rewriters = rewritersBySession.get(targetSession);
    if (!rewriters) {
        const list = [];
        rewriters = list;
        rewritersBySession.set(targetSession, list);
        targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
            let requestHeaders = details.requestHeaders;
            try {
                for (const rewrite of list) {
                    try {
                        requestHeaders = rewrite(details, requestHeaders);
                    }
                    catch {
                        // Keep the headers as they were; each rewriter fails closed itself.
                    }
                }
            }
            finally {
                // An unanswered listener stalls the request forever.
                callback({ requestHeaders });
            }
        });
    }
    rewriters.push(rewriter);
    return true;
}
