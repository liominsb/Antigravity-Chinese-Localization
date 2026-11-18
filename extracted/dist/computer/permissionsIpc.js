"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSIONS_CHANNELS = void 0;
exports.registerComputerPermissionsIpc = registerComputerPermissionsIpc;
/**
 * @fileoverview IPC for the Hub UI's macOS permission onboarding card
 * (preload `window.agyComputerPreview.getPermissions`, `openPermissionSettings`
 * and `relaunchApp`). Registered with the computer preview IPC, so only while
 * computer use is on.
 *
 * Only the top frame of a Hub UI window may call it (not popups, webview
 * guests or subframes). Reading the grants is passive (Electron's TCC queries;
 * the desktop helper is never started for it), settings panes are named, not
 * passed as URLs, and a relaunch quits gracefully (the language server and
 * the helper are shut down) before the Hub starts again.
 */
const electron_1 = require("electron");
const utils_1 = require("../utils");
const index_1 = require("./index");
const permissions_1 = require("./permissions");
const previewViewers_1 = require("./previewViewers");
exports.PERMISSIONS_CHANNELS = Object.freeze({
    get: 'computer-permissions:get',
    openSettings: 'computer-permissions:open-settings',
    relaunch: 'computer-permissions:relaunch',
});
const defaultReadGrants = () => ({
    accessibility: electron_1.systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: electron_1.systemPreferences.getMediaAccessStatus('screen') === 'granted',
});
/**
 * A local Hub window (never an SSH remote window) showing the Hub UI (not a
 * page it navigated to). Independent of the preview, so onboarding works with
 * AGY_DESKTOP_PREVIEW=0.
 */
function defaultIsHubUi(wc) {
    return ((0, utils_1.getLocalHubWindows)().some((w) => (0, utils_1.getHubWebContents)(w) === wc) &&
        (0, previewViewers_1.isHubUiUrl)(wc.getURL()));
}
/** How long a grant flip waits for the Hello refresh before answering. */
const REFRESH_HELLO_TIMEOUT_MS = 2000;
function defaultRelaunch() {
    electron_1.app.relaunch();
    // A graceful quit ('before-quit' stops the LS and the helper), then the
    // relaunch.
    electron_1.app.quit();
}
/** Registers the handlers; samples the grants now (process start). */
function registerComputerPermissionsIpc(deps = {}) {
    const tracker = new permissions_1.PermissionTracker(deps.readGrants ?? defaultReadGrants);
    const isHubUi = deps.isHubUi ?? defaultIsHubUi;
    const openExternal = deps.openExternal ?? ((url) => electron_1.shell.openExternal(url));
    const relaunch = deps.relaunch ?? defaultRelaunch;
    const refreshHello = deps.refreshHello ?? index_1.refreshComputerHello;
    const check = (e) => {
        const wc = e.sender;
        if (wc.isDestroyed() ||
            wc.getType() !== 'window' ||
            e.senderFrame !== wc.mainFrame ||
            !isHubUi(wc)) {
            throw new Error('computer permissions: not allowed from this frame');
        }
    };
    let last = tracker.sample();
    electron_1.ipcMain.handle(exports.PERMISSIONS_CHANNELS.get, async (e) => {
        check(e);
        const now = tracker.sample();
        const flipped = now.accessibility !== last.accessibility ||
            now.screenRecording !== last.screenRecording;
        last = now;
        if (flipped) {
            // The LS sees the new grants before the card offers to continue,
            // not on the next Hello timer (a stale PERMISSION_MISSING).
            await Promise.race([
                refreshHello().catch(() => { }),
                new Promise((resolve) => setTimeout(resolve, REFRESH_HELLO_TIMEOUT_MS)),
            ]);
        }
        return now;
    });
    electron_1.ipcMain.handle(exports.PERMISSIONS_CHANNELS.openSettings, async (e, pane) => {
        check(e);
        await openExternal((0, permissions_1.permissionPaneUrl)(pane));
    });
    let relaunching = false;
    electron_1.ipcMain.handle(exports.PERMISSIONS_CHANNELS.relaunch, (e) => {
        check(e);
        if (!relaunching) {
            relaunching = true;
            relaunch();
        }
    });
}
