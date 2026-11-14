"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZOOM_STEP = exports.ZOOM_LEVEL_KEY = void 0;
exports.setHubZoomStorageManager = setHubZoomStorageManager;
exports.resolveTargetHubWindow = resolveTargetHubWindow;
exports.resolveHubZoomShortcutAction = resolveHubZoomShortcutAction;
exports.applyHubWindowZoom = applyHubWindowZoom;
const utils_1 = require("./utils");
exports.ZOOM_LEVEL_KEY = 'zoomLevel';
exports.ZOOM_STEP = 0.5;
let registeredStorageManager;
/**
 * Registers the main-process storage updater used to persist Hub window zoom
 * changes initiated from IPC, application menu items, or keyboard shortcuts.
 */
function setHubZoomStorageManager(storageManager) {
    registeredStorageManager = storageManager;
}
function isWebviewPopupWindow(win) {
    return Boolean(win &&
        typeof win === 'object' &&
        win.__isWebviewPopupWindow);
}
/**
 * Resolves the target top-level Hub window for a menu or IPC zoom action,
 * preferring an explicit live Hub window and falling back to the focused or
 * first open Hub window.
 */
function resolveTargetHubWindow(win) {
    if (win && !win.isDestroyed?.() && !isWebviewPopupWindow(win)) {
        return win;
    }
    return (0, utils_1.getFocusedHubWindow)() ?? (0, utils_1.getHubWindows)()[0];
}
/**
 * Maps a `Cmd`/`Ctrl`-modified keyboard input payload (after caller modifier
 * validation) to its corresponding Hub zoom action, or `null` when unrelated.
 */
function resolveHubZoomShortcutAction(input, keyLower = (input.key || '').toLowerCase()) {
    const code = input.code || '';
    if (keyLower === '+' || keyLower === '=' || code === 'NumpadAdd') {
        return 'in';
    }
    if (keyLower === '-' || keyLower === '_' || code === 'NumpadSubtract') {
        return 'out';
    }
    if (!input.shift &&
        (keyLower === '0' || code === 'Digit0' || code === 'Numpad0')) {
        return 'reset';
    }
    return null;
}
/**
 * Adjusts or resets the zoom level strictly on `win`'s Hub UI `WebContents`
 * (`getHubWebContents(win)`) — never on a focused child `WebContentsView` —
 * and persists `zoomLevel` when a storage updater is registered.
 */
async function applyHubWindowZoom(win, action, 
/** Bounds the new level (e.g. for zoom that remote content asked for). */
limit) {
    if (!win || win.isDestroyed?.()) {
        return;
    }
    const hubContents = (0, utils_1.getHubWebContents)(win);
    if (!hubContents || hubContents.isDestroyed?.()) {
        return;
    }
    let newLevel = 0;
    if (action !== 'reset') {
        const current = typeof hubContents.getZoomLevel === 'function'
            ? hubContents.getZoomLevel()
            : 0;
        const baseLevel = typeof current === 'number' && Number.isFinite(current) ? current : 0;
        newLevel = action === 'in' ? baseLevel + exports.ZOOM_STEP : baseLevel - exports.ZOOM_STEP;
    }
    newLevel = limit ? limit(newLevel) : newLevel;
    hubContents.setZoomLevel?.(newLevel);
    if (typeof registeredStorageManager?.updateItems === 'function') {
        await registeredStorageManager.updateItems({
            [exports.ZOOM_LEVEL_KEY]: String(newLevel),
        });
    }
}
