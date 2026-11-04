"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_WINDOW_HEIGHT = exports.MIN_WINDOW_WIDTH = exports.DEFAULT_WINDOW_HEIGHT = exports.DEFAULT_WINDOW_WIDTH = void 0;
exports.parseWindowState = parseWindowState;
exports.readPersistedWindowState = readPersistedWindowState;
exports.persistWindowState = persistWindowState;
exports.resolveWindowStateForDisplays = resolveWindowStateForDisplays;
exports.cascadeWindowState = cascadeWindowState;
exports.resolveInitialWindowState = resolveInitialWindowState;
exports.trackWindowState = trackWindowState;
exports.flushTrackedWindowState = flushTrackedWindowState;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const paths_1 = require("./paths");
exports.DEFAULT_WINDOW_WIDTH = 1400;
exports.DEFAULT_WINDOW_HEIGHT = 900;
exports.MIN_WINDOW_WIDTH = 500;
exports.MIN_WINDOW_HEIGHT = 400;
const MIN_VISIBLE_PX = 64;
const CASCADE_OFFSET_PX = 28;
const SAVE_DEBOUNCE_MS = 250;
const activeTrackers = new Map();
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isValidRectangle(rect) {
    if (!rect || typeof rect !== 'object') {
        return false;
    }
    const r = rect;
    return (isFiniteNumber(r.x) &&
        isFiniteNumber(r.y) &&
        isFiniteNumber(r.width) &&
        r.width > 0 &&
        isFiniteNumber(r.height) &&
        r.height > 0);
}
function getUsableArea(display) {
    if (isValidRectangle(display.workArea)) {
        return display.workArea;
    }
    return display.bounds;
}
function clampDimension(value, minValue, maxAvailable) {
    const rounded = Math.max(minValue, Math.round(value));
    if (maxAvailable >= minValue) {
        return Math.min(rounded, Math.round(maxAvailable));
    }
    return rounded;
}
function findBestMatchingDisplay(rect, displays) {
    let bestDisplay;
    let bestArea = 0;
    for (const display of displays) {
        const area = getUsableArea(display);
        if (!isValidRectangle(area)) {
            continue;
        }
        const overlapWidth = Math.min(rect.x + rect.width, area.x + area.width) -
            Math.max(rect.x, area.x);
        const overlapHeight = Math.min(rect.y + rect.height, area.y + area.height) -
            Math.max(rect.y, area.y);
        if (overlapWidth >= MIN_VISIBLE_PX && overlapHeight >= MIN_VISIBLE_PX) {
            const overlapArea = overlapWidth * overlapHeight;
            if (overlapArea > bestArea) {
                bestArea = overlapArea;
                bestDisplay = display;
            }
        }
    }
    return bestDisplay;
}
/**
 * Validates and normalizes raw parsed JSON into a safe `WindowState`.
 */
function parseWindowState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            width: exports.DEFAULT_WINDOW_WIDTH,
            height: exports.DEFAULT_WINDOW_HEIGHT,
            isMaximized: false,
            isFullScreen: false,
        };
    }
    const record = raw;
    const width = isFiniteNumber(record.width) && record.width >= exports.MIN_WINDOW_WIDTH
        ? Math.round(record.width)
        : exports.DEFAULT_WINDOW_WIDTH;
    const height = isFiniteNumber(record.height) && record.height >= exports.MIN_WINDOW_HEIGHT
        ? Math.round(record.height)
        : exports.DEFAULT_WINDOW_HEIGHT;
    const hasCoordinates = isFiniteNumber(record.x) && isFiniteNumber(record.y);
    return {
        ...(hasCoordinates
            ? {
                x: Math.round(record.x),
                y: Math.round(record.y),
            }
            : {}),
        width,
        height,
        isMaximized: Boolean(record.isMaximized),
        isFullScreen: Boolean(record.isFullScreen),
    };
}
/**
 * Reads persisted window state from disk, returning defaults if missing or invalid.
 */
function readPersistedWindowState(stateFilePath = (0, paths_1.getWindowStatePath)()) {
    try {
        if (!fs.existsSync(stateFilePath)) {
            return parseWindowState(undefined);
        }
        const content = fs.readFileSync(stateFilePath, 'utf-8');
        if (!content || !content.trim()) {
            return parseWindowState(undefined);
        }
        return parseWindowState(JSON.parse(content));
    }
    catch {
        return parseWindowState(undefined);
    }
}
/**
 * Writes window state to disk on a best-effort basis without throwing.
 */
function persistWindowState(state, stateFilePath = (0, paths_1.getWindowStatePath)()) {
    try {
        const normalized = parseWindowState(state);
        const dir = path.dirname(stateFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(stateFilePath, JSON.stringify(normalized, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Failed to persist window state:', err);
    }
}
/**
 * Ensures `state` fits on one of the currently connected `displays`.
 * If the saved coordinates lie off-screen (e.g. an external monitor was
 * disconnected), falls back to default centered positioning on the primary
 * display while preserving `isMaximized` / `isFullScreen`.
 */
function resolveWindowStateForDisplays(state, displays, primaryDisplay) {
    const normalized = parseWindowState(state);
    if (displays.length === 0) {
        return normalized;
    }
    const fallbackDisplay = primaryDisplay ?? displays[0];
    const fallbackArea = getUsableArea(fallbackDisplay);
    if (normalized.x === undefined || normalized.y === undefined) {
        return {
            width: isValidRectangle(fallbackArea)
                ? clampDimension(normalized.width, exports.MIN_WINDOW_WIDTH, fallbackArea.width)
                : normalized.width,
            height: isValidRectangle(fallbackArea)
                ? clampDimension(normalized.height, exports.MIN_WINDOW_HEIGHT, fallbackArea.height)
                : normalized.height,
            isMaximized: normalized.isMaximized,
            isFullScreen: normalized.isFullScreen,
        };
    }
    const matchedDisplay = findBestMatchingDisplay({
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
    }, displays);
    if (!matchedDisplay) {
        return {
            width: isValidRectangle(fallbackArea)
                ? clampDimension(normalized.width, exports.MIN_WINDOW_WIDTH, fallbackArea.width)
                : normalized.width,
            height: isValidRectangle(fallbackArea)
                ? clampDimension(normalized.height, exports.MIN_WINDOW_HEIGHT, fallbackArea.height)
                : normalized.height,
            isMaximized: normalized.isMaximized,
            isFullScreen: normalized.isFullScreen,
        };
    }
    const area = getUsableArea(matchedDisplay);
    const width = clampDimension(normalized.width, exports.MIN_WINDOW_WIDTH, area.width);
    const height = clampDimension(normalized.height, exports.MIN_WINDOW_HEIGHT, area.height);
    const minX = area.x + MIN_VISIBLE_PX - width;
    const maxX = area.x + area.width - MIN_VISIBLE_PX;
    const x = Math.max(minX, Math.min(normalized.x, maxX));
    // Keep the top edge inside `workArea` so the hidden titlebar drag region
    // remains reachable beneath any OS menu bar or top panel.
    const maxY = Math.max(area.y, area.y + area.height - MIN_VISIBLE_PX);
    const y = Math.max(area.y, Math.min(normalized.y, maxY));
    return {
        x,
        y,
        width,
        height,
        isMaximized: normalized.isMaximized,
        isFullScreen: normalized.isFullScreen,
    };
}
/**
 * Offsets `baseState` slightly when opening an additional window while another
 * Hub window is already open, wrapping within the display's usable area.
 */
function cascadeWindowState(baseState, displays) {
    const width = baseState.width;
    const height = baseState.height;
    if (baseState.x === undefined || baseState.y === undefined) {
        return {
            width,
            height,
            isMaximized: false,
            isFullScreen: false,
        };
    }
    let nextX = baseState.x + CASCADE_OFFSET_PX;
    let nextY = baseState.y + CASCADE_OFFSET_PX;
    const matched = findBestMatchingDisplay({ x: baseState.x, y: baseState.y, width, height }, displays);
    if (matched) {
        const area = getUsableArea(matched);
        if (nextX + width > area.x + area.width ||
            nextY + height > area.y + area.height) {
            nextX = area.x + CASCADE_OFFSET_PX;
            nextY = area.y + CASCADE_OFFSET_PX;
        }
        nextX = Math.max(area.x, Math.min(nextX, area.x + area.width - width));
        nextY = Math.max(area.y, Math.min(nextY, area.y + area.height - height));
    }
    return {
        x: nextX,
        y: nextY,
        width,
        height,
        isMaximized: false,
        isFullScreen: false,
    };
}
function getConnectedDisplays() {
    try {
        const displays = typeof electron_1.screen?.getAllDisplays === 'function'
            ? electron_1.screen.getAllDisplays()
            : [];
        const primaryDisplay = typeof electron_1.screen?.getPrimaryDisplay === 'function'
            ? electron_1.screen.getPrimaryDisplay()
            : displays[0];
        return { displays, primaryDisplay };
    }
    catch {
        return { displays: [], primaryDisplay: undefined };
    }
}
/**
 * Resolves the initial bounds and state to apply to a newly created Hub window.
 */
function resolveInitialWindowState(options) {
    const persisted = readPersistedWindowState(options?.stateFilePath);
    const { displays, primaryDisplay } = getConnectedDisplays();
    const resolved = resolveWindowStateForDisplays(persisted, displays, primaryDisplay);
    const refWin = options?.cascadeFromWindow;
    if (!refWin || refWin.isDestroyed?.()) {
        return resolved;
    }
    let baseForCascade = resolved;
    if (!refWin.isFullScreen?.() &&
        !refWin.isMaximized?.() &&
        !refWin.isMinimized?.()) {
        const refBounds = refWin.getBounds?.();
        if (isValidRectangle(refBounds)) {
            baseForCascade = {
                x: Math.round(refBounds.x),
                y: Math.round(refBounds.y),
                width: clampDimension(refBounds.width, exports.MIN_WINDOW_WIDTH, Number.MAX_SAFE_INTEGER),
                height: clampDimension(refBounds.height, exports.MIN_WINDOW_HEIGHT, Number.MAX_SAFE_INTEGER),
            };
        }
    }
    return cascadeWindowState(baseForCascade, displays);
}
/**
 * Attaches listeners to `win` so moves, resizes, maximize, and full-screen
 * transitions are persisted to `window_state.json`.
 */
function trackWindowState(win, initialState, stateFilePath = (0, paths_1.getWindowStatePath)()) {
    activeTrackers.get(win)?.dispose();
    const state = {
        ...(initialState.x !== undefined && initialState.y !== undefined
            ? { x: initialState.x, y: initialState.y }
            : {}),
        width: initialState.width,
        height: initialState.height,
        isMaximized: Boolean(initialState.isMaximized),
        isFullScreen: Boolean(initialState.isFullScreen),
    };
    if ((state.x === undefined || state.y === undefined) &&
        !win.isDestroyed?.() &&
        !win.isMinimized?.() &&
        !win.isMaximized?.() &&
        !win.isFullScreen?.()) {
        const seeded = win.getBounds?.();
        if (isValidRectangle(seeded)) {
            state.x = Math.round(seeded.x);
            state.y = Math.round(seeded.y);
            state.width = Math.max(exports.MIN_WINDOW_WIDTH, Math.round(seeded.width));
            state.height = Math.max(exports.MIN_WINDOW_HEIGHT, Math.round(seeded.height));
        }
    }
    let debounceTimer;
    const clearTimer = () => {
        if (debounceTimer !== undefined) {
            clearTimeout(debounceTimer);
            debounceTimer = undefined;
        }
    };
    const captureCurrentState = () => {
        if (win.isDestroyed?.() || win.isMinimized?.()) {
            return false;
        }
        const isFullScreen = Boolean(win.isFullScreen?.());
        const isMaximized = isFullScreen
            ? Boolean(state.isMaximized)
            : Boolean(win.isMaximized?.());
        state.isFullScreen = isFullScreen;
        state.isMaximized = isMaximized;
        if (!isFullScreen && !isMaximized) {
            const bounds = win.getBounds?.();
            if (isValidRectangle(bounds)) {
                state.x = Math.round(bounds.x);
                state.y = Math.round(bounds.y);
                state.width = Math.max(exports.MIN_WINDOW_WIDTH, Math.round(bounds.width));
                state.height = Math.max(exports.MIN_WINDOW_HEIGHT, Math.round(bounds.height));
            }
            return true;
        }
        // When maximized or full-screen, keep the normal width/height intact, but
        // ensure `(x, y)` sits on the display currently hosting the window so
        // reopening restores on the same monitor.
        const currentBounds = win.getBounds?.();
        if (isValidRectangle(currentBounds) &&
            typeof electron_1.screen?.getDisplayMatching === 'function') {
            try {
                const currentDisplay = electron_1.screen.getDisplayMatching(currentBounds);
                const area = getUsableArea(currentDisplay);
                if (isValidRectangle(area)) {
                    const priorDisplay = state.x !== undefined && state.y !== undefined
                        ? electron_1.screen.getDisplayMatching({
                            x: state.x,
                            y: state.y,
                            width: state.width,
                            height: state.height,
                        })
                        : undefined;
                    if (!priorDisplay || priorDisplay.id !== currentDisplay.id) {
                        state.width = clampDimension(state.width, exports.MIN_WINDOW_WIDTH, area.width);
                        state.height = clampDimension(state.height, exports.MIN_WINDOW_HEIGHT, area.height);
                        state.x = Math.round(area.x + (area.width - state.width) / 2);
                        state.y = Math.round(area.y + (area.height - state.height) / 2);
                    }
                }
            }
            catch {
                // Ignore screen lookup errors in partial environments.
            }
        }
        return true;
    };
    const captureAndSave = () => {
        clearTimer();
        if (captureCurrentState()) {
            persistWindowState(state, stateFilePath);
        }
    };
    const scheduleSave = () => {
        clearTimer();
        debounceTimer = setTimeout(captureAndSave, SAVE_DEBOUNCE_MS);
    };
    win.on?.('resize', scheduleSave);
    win.on?.('move', scheduleSave);
    win.on?.('maximize', scheduleSave);
    win.on?.('unmaximize', scheduleSave);
    win.on?.('enter-full-screen', scheduleSave);
    win.on?.('leave-full-screen', scheduleSave);
    const handleClose = () => {
        captureAndSave();
    };
    const dispose = () => {
        clearTimer();
        win.off?.('resize', scheduleSave);
        win.off?.('move', scheduleSave);
        win.off?.('maximize', scheduleSave);
        win.off?.('unmaximize', scheduleSave);
        win.off?.('enter-full-screen', scheduleSave);
        win.off?.('leave-full-screen', scheduleSave);
        win.off?.('close', handleClose);
        win.off?.('closed', dispose);
        if (activeTrackers.get(win) === tracker) {
            activeTrackers.delete(win);
        }
    };
    const tracker = {
        win,
        clearTimer,
        captureAndSave,
        dispose,
    };
    activeTrackers.set(win, tracker);
    win.on?.('close', handleClose);
    win.on?.('closed', dispose);
}
/**
 * Synchronously flushes window state before app quit destroys open windows
 * (since `win.destroy()` skips the `'close'` event).
 */
function flushTrackedWindowState(preferredWindow) {
    let targetTracker;
    for (const tracker of activeTrackers.values()) {
        tracker.clearTimer();
        if (!tracker.win.isDestroyed?.()) {
            targetTracker = tracker;
        }
    }
    if (preferredWindow && !preferredWindow.isDestroyed?.()) {
        const preferredTracker = activeTrackers.get(preferredWindow);
        if (preferredTracker) {
            targetTracker = preferredTracker;
        }
    }
    targetTracker?.captureAndSave();
}
