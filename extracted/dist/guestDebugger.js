"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDP_NETWORK_ENABLE_PARAMS = void 0;
exports.ensureGuestDebuggerAttached = ensureGuestDebuggerAttached;
/**
 * Shared CDP `Network.enable` buffer parameters across all main-process CDP
 * clients sharing a guest `webContents.debugger` session (`webviewSecurityState`
 * and `guestNetworkController`), keeping a bounded 4 MiB per-guest / 256 KiB
 * per-resource response buffer so `Network.getResponseBody` can read small
 * `4xx/5xx` and `xhr`/`fetch` diagnostic bodies without zeroing out another
 * client's buffer.
 */
exports.CDP_NETWORK_ENABLE_PARAMS = {
    maxTotalBufferSize: 4 * 1024 * 1024,
    maxResourceBufferSize: 256 * 1024,
};
/**
 * Attaches a guest's `webContents.debugger` unless it is already attached, and
 * returns whether it is attached afterwards.
 *
 * Electron gives each `WebContents` one debugger session, shared by every
 * main-process CDP client of that guest. To keep the session usable for all of
 * them, clients must:
 * - attach only through this function, and reuse a session someone else
 *   attached;
 * - never call `detach()`, and never `*.disable` a domain they did not enable;
 * - after a `'detach'` caused by something else (such as DevTools opening on
 *   the guest, or a renderer crash), attach again through this function and
 *   re-enable their own domains.
 */
function ensureGuestDebuggerAttached(dbg) {
    if (dbg.isAttached()) {
        return true;
    }
    try {
        dbg.attach('1.3');
    }
    catch {
        // Another client attached between the check and the attach; reuse it.
    }
    return dbg.isAttached();
}
