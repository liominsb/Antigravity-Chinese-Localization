"use strict";
/**
 * @fileoverview An optional Layer 3 capability: operating apps in the
 * background. A surface that implements ComputerBackgroundDriver can attach to
 * an app without activating it, read its accessibility tree, act on tree
 * elements and capture one window, all without moving the cursor, changing
 * the frontmost app or posting HID events, so the user keeps working while the
 * agent does. Additive to the frozen ComputerSurfaceDriver (v1): surfaces
 * without it keep working in the foreground only.
 *
 * Element refs are opaque `s<epoch>:e<N>` strings from the latest snapshots of
 * an app; a ref from a snapshot the surface no longer keeps fails STALE_REF.
 * Every call that reads or acts on an app enforces its ConfinementPolicy
 * (denied apps, the allowed apps, the browser page policy) before touching the
 * app, exactly like the foreground primitives.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportsBackground = supportsBackground;
exports.supportsMultiAgent = supportsMultiAgent;
/** Whether `d` also implements {@link ComputerBackgroundDriver}. */
function supportsBackground(d) {
    const b = d;
    return (typeof b.bindApp === 'function' &&
        typeof b.axSnapshot === 'function' &&
        typeof b.axPress === 'function' &&
        typeof b.axSetValue === 'function' &&
        typeof b.axSelect === 'function' &&
        typeof b.axScroll === 'function' &&
        typeof b.windowScreenshot === 'function');
}
/** Whether `d` currently runs agents concurrently. */
function supportsMultiAgent(d) {
    const m = d;
    return typeof m.multiAgent === 'function' && m.multiAgent() === true;
}
