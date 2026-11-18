"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuxWindow = registerAuxWindow;
exports.isAuxWindow = isAuxWindow;
/**
 * Windows that are not Hub UI windows (the desktop HUD). utils.ts's
 * getHubWindows() / getFocusedHubWindow() leave them out, so they are never
 * reloaded with the Hub URL, never picked as "the" window for window
 * commands, notifications or deep links, and don't count as an open Hub
 * window.
 */
const auxWindows = new WeakSet();
/** Marks `win` as an aux (non-Hub UI) window. */
function registerAuxWindow(win) {
    auxWindows.add(win);
}
/** Whether `win` is an aux (non-Hub UI) window. */
function isAuxWindow(win) {
    return !!win && auxWindows.has(win);
}
