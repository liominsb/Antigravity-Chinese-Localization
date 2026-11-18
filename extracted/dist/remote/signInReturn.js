"use strict";
/**
 * Where an SSH window's sign-in ends: Antigravity's sign-in success page, as
 * after a local sign-in. The page sends the browser to the app's own scheme
 * (`<scheme>://oauth-success`), which would bring up a local window (or open
 * one); RemoteManager.takeSignInReturn brings up the SSH window instead for a
 * while after its sign-in. Pure: no state, no Electron.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGN_IN_RETURN_MS = void 0;
exports.protocolSchemeFor = protocolSchemeFor;
exports.authSuccessUrl = authSuccessUrl;
exports.isOAuthSuccessLink = isOAuthSuccessLink;
/** The page the language server sends a finished sign-in to (acquirer.go). */
const AUTH_SUCCESS_PAGE = 'https://antigravity.google/auth-success';
/** The host of the page's link back to the app. */
const OAUTH_SUCCESS_HOST = 'oauth-success';
/** The page links back within seconds; the browser may ask the user first. */
exports.SIGN_IN_RETURN_MS = 60000;
/** The app's URL scheme: its name, e.g. "antigravity-insiders". */
function protocolSchemeFor(appName) {
    return appName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
/** The success page that links back to the app with URL scheme `scheme`. */
function authSuccessUrl(scheme) {
    return `${AUTH_SUCCESS_PAGE}?app=${encodeURIComponent(scheme)}`;
}
/** Whether deep link `url` is the success page's link back to this app. */
function isOAuthSuccessLink(url, scheme) {
    try {
        const parsed = new URL(url);
        return (parsed.protocol === `${scheme}:` && parsed.hostname === OAUTH_SUCCESS_HOST);
    }
    catch {
        return false;
    }
}
