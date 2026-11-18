"use strict";
/**
 * @fileoverview The macOS permissions computer use needs (Accessibility and
 * Screen Recording), for the Hub UI's permission onboarding card: a passive
 * read of the grants (no helper is started), whether Screen Recording only
 * takes effect after a relaunch, and the System Settings pane for each
 * permission. The renderer names a pane; it never passes a URL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionTracker = void 0;
exports.permissionPaneUrl = permissionPaneUrl;
/** System Settings > Privacy & Security, by pane (the only URLs opened). */
const PANE_URLS = Object.freeze({
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
});
/**
 * The settings URL of `pane`. Throws on anything but the two pane names (no
 * URL from the renderer is ever opened).
 */
function permissionPaneUrl(pane) {
    if (pane !== 'accessibility' && pane !== 'screenRecording') {
        throw new Error('computer permissions: unknown settings pane');
    }
    return PANE_URLS[pane];
}
/**
 * Tracks the grants over this process's lifetime. Call {@link sample} at
 * startup so a Screen Recording grant given before the first card counts as
 * needing a relaunch.
 */
class PermissionTracker {
    constructor(read) {
        this.read = read;
        this.sawScreenRecordingMissing = false;
    }
    /** Reads the grants and remembers a missing Screen Recording grant. */
    sample() {
        let g;
        try {
            g = this.read();
        }
        catch (_e) {
            g = { accessibility: false, screenRecording: false };
        }
        const accessibility = g.accessibility === true;
        const screenRecording = g.screenRecording === true;
        if (!screenRecording) {
            this.sawScreenRecordingMissing = true;
        }
        return {
            accessibility,
            screenRecording,
            screenRecordingNeedsRelaunch: screenRecording && this.sawScreenRecordingMissing,
        };
    }
}
exports.PermissionTracker = PermissionTracker;
