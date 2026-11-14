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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SleepBlocker = exports.showOrCreateWindow = exports.CATCHER_STABLE_LOAD_RESET_MS = exports.CATCHER_CRASH_BACKOFF_MS = exports.CATCHER_DATA_URL = exports.WCV_THREE_LAYER_STACK_FLAG = exports.HUB_SURFACE_COLOR_STORAGE_KEY = exports.showQuitConfirmation = void 0;
exports.setShowQuitConfirmation = setShowQuitConfirmation;
exports.isMacOS = isMacOS;
exports.isLightTheme = isLightTheme;
exports.isWcvThreeLayerStackEnabled = isWcvThreeLayerStackEnabled;
exports.normalizeHexSurfaceColor = normalizeHexSurfaceColor;
exports.buildHubCurtainDataUrl = buildHubCurtainDataUrl;
exports.markWebviewPopupWindow = markWebviewPopupWindow;
exports.registerWindowWebContents = registerWindowWebContents;
exports.getHubView = getHubView;
exports.getHubClipView = getHubClipView;
exports.getHubCatcherView = getHubCatcherView;
exports.getHubCurtainView = getHubCurtainView;
exports.getHubCurtainColor = getHubCurtainColor;
exports.setHubCurtainColor = setHubCurtainColor;
exports.setHubSurfaceTransparent = setHubSurfaceTransparent;
exports.isHubSurfaceTransparent = isHubSurfaceTransparent;
exports.getHubWebContents = getHubWebContents;
exports.resolveHubWindowFromWebContents = resolveHubWindowFromWebContents;
exports.resolveHubWindowFromCatcherWebContents = resolveHubWindowFromCatcherWebContents;
exports.getHubWindows = getHubWindows;
exports.getLocalHubWindows = getLocalHubWindows;
exports.getLastFocusedLocalHubWindow = getLastFocusedLocalHubWindow;
exports.isLocalHubTopFrame = isLocalHubTopFrame;
exports.getFocusedHubWindow = getFocusedHubWindow;
exports.createWindow = createWindow;
exports.getNodeWrapperPaths = getNodeWrapperPaths;
exports.setupNodeWrapper = setupNodeWrapper;
const electron_1 = require("electron");
const constants_1 = require("./constants");
const externalUrl_1 = require("./externalUrl");
const keybindings_1 = require("./keybindings");
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
const paths_1 = require("./paths");
const loadingOverlay_1 = require("./loadingOverlay");
const wsl_1 = require("./wsl");
const debugConsole_1 = require("./debugConsole");
const windowState_1 = require("./windowState");
const windowBackends_1 = require("./remote/windowBackends");
const nodeWrapper_1 = require("./nodeWrapper");
exports.showQuitConfirmation = false;
function setShowQuitConfirmation(value) {
    exports.showQuitConfirmation = value;
}
function isMacOS() {
    return process.platform === 'darwin';
}
/**
 * Reads the user's theme preference from the settings file.
 */
function getThemeMode() {
    try {
        const filePath = (0, paths_1.getSettingsPbPath)();
        if (!fs.existsSync(filePath)) {
            return 'DARK';
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content);
        const themeMode = config?.userSettings?.themeMode;
        if (themeMode && themeMode.includes('INHERIT')) {
            return electron_1.nativeTheme.shouldUseDarkColors ? 'DARK' : 'LIGHT';
        }
        if (themeMode && themeMode.includes('LIGHT')) {
            return 'LIGHT';
        }
        return 'DARK';
    }
    catch (e) {
        console.error('Error reading theme mode:', e);
        return 'DARK';
    }
}
/** Whether the app (not necessarily the OS) uses a light theme. */
function isLightTheme() {
    return getThemeMode().toUpperCase().includes('LIGHT');
}
/**
 * Ensures the app is visible in the dock for MacOS with the icon set.
 * When refocusing the app after being hidden in the dock, the icon is sometimes lost.
 * This ensures the icon is always visible.
 */
function ensureAppIsInDock() {
    void electron_1.app.dock?.show();
    if (isMacOS() && electron_1.app.dock) {
        const iconPath = path_1.default.join(__dirname, '..', 'icon.png');
        electron_1.app.dock.setIcon(electron_1.nativeImage.createFromPath(iconPath));
    }
}
exports.HUB_SURFACE_COLOR_STORAGE_KEY = 'hubSurfaceBackgroundColor';
exports.WCV_THREE_LAYER_STACK_FLAG = 'enable-wcv-three-layer-stack';
/** Minimal transparent full-viewport HTML document loaded into `catcherWcv`. */
exports.CATCHER_DATA_URL = 'data:text/html,<!doctype html><html style="margin:0;width:100%;height:100%;overflow:hidden;background:transparent;user-select:none"><body style="margin:0;width:100%;height:100%;overflow:hidden;background:transparent;user-select:none"></body></html>';
exports.CATCHER_CRASH_BACKOFF_MS = [100, 500, 2000];
exports.CATCHER_STABLE_LOAD_RESET_MS = 5000;
const CUSTOM_FLAG_OVERRIDES_STORAGE_KEY = 'jetski.developer.customFlagOverrides';
const HEX_COLOR_6_RE = /^#[0-9a-fA-F]{6}$/;
const hubWindows = new WeakSet();
const hubViewByWindow = new WeakMap();
const hubClipViewByWindow = new WeakMap();
const hubCatcherViewByWindow = new WeakMap();
const hubCurtainViewByWindow = new WeakMap();
const hubCurtainColorByWindow = new WeakMap();
const hubCurtainStateByWindow = new WeakMap();
const hubSurfaceTransparentByWindow = new WeakMap();
const windowByWebContents = new WeakMap();
const windowByWebContentsId = new Map();
const windowByCatcherWebContents = new WeakMap();
const windowByCatcherWebContentsId = new Map();
function isCatcherWebContents(candidate) {
    return Boolean(candidate &&
        typeof candidate === 'object' &&
        (windowByCatcherWebContents.has(candidate) ||
            (typeof candidate.id === 'number' &&
                windowByCatcherWebContentsId.has(candidate.id))));
}
/** Each Hub window's `focusCount` when it last got focus. */
const lastFocusOf = new WeakMap();
let focusCount = 0;
const asRecord = (v) => v && typeof v === 'object' && !Array.isArray(v)
    ? v
    : undefined;
function readAppStorageSync() {
    try {
        const p = (0, paths_1.getAppStoragePath)();
        if (fs.existsSync(p)) {
            return asRecord(JSON.parse(fs.readFileSync(p, 'utf-8'))) ?? {};
        }
    }
    catch {
        // Ignore missing or corrupt app storage.
    }
    return {};
}
/** Evaluates whether a new Hub window latches the `clipView` stack, with boolean `customFlagOverrides` precedence. */
function isWcvThreeLayerStackEnabled(storageManager) {
    let items = {};
    if (typeof storageManager?.getItemsSync === 'function') {
        try {
            items = asRecord(storageManager.getItemsSync()) ?? {};
        }
        catch {
            // Fall back to empty items on storage read error.
        }
    }
    else {
        items = readAppStorageSync();
    }
    const rawOverrides = items[CUSTOM_FLAG_OVERRIDES_STORAGE_KEY];
    if (typeof rawOverrides === 'string') {
        try {
            const val = asRecord(JSON.parse(rawOverrides))?.[exports.WCV_THREE_LAYER_STACK_FLAG];
            if (typeof val === 'boolean') {
                return val;
            }
        }
        catch {
            // Ignore malformed customFlagOverrides JSON and fall through.
        }
    }
    const saved = items[exports.WCV_THREE_LAYER_STACK_FLAG];
    return saved === true || saved === 'true';
}
/** Validates a 6-digit `#RRGGBB` hex color string and returns it normalized to uppercase. */
function normalizeHexSurfaceColor(color) {
    const s = typeof color === 'string' ? color.trim() : '';
    return HEX_COLOR_6_RE.test(s) ? s.toUpperCase() : undefined;
}
/** Builds the minimal opaque HTML document URL loaded into `curtainView` so its compositor surface paints. */
function buildHubCurtainDataUrl(color) {
    const c = encodeURIComponent(color);
    return `data:text/html,<!doctype html><html style="margin:0;height:100%;background:${c}"><body style="margin:0;height:100%;background:${c}"></body></html>`;
}
function isPopupWindow(win) {
    return Boolean(win &&
        typeof win === 'object' &&
        win.__isWebviewPopupWindow);
}
/** Marks a child `BrowserWindow` created by `<webview>` `window.open()` so `getHubWindows()` ignores it. */
function markWebviewPopupWindow(win) {
    if (win && typeof win === 'object') {
        win.__isWebviewPopupWindow = true;
    }
}
/** Associates `contents` (`hubWcv` or `browserWcv`) with its owning `HubWindow`. */
function registerWindowWebContents(win, contents) {
    if (!win || !contents || typeof contents !== 'object') {
        return;
    }
    const hubWin = win;
    windowByWebContents.set(contents, hubWin);
    if (typeof contents.id === 'number') {
        windowByWebContentsId.set(contents.id, hubWin);
        contents.once?.('destroyed', () => {
            if (windowByWebContentsId.get(contents.id) === hubWin) {
                windowByWebContentsId.delete(contents.id);
            }
        });
    }
}
/** Returns the primary Hub UI `WebContentsView` (`hubWcv`) for `win`. */
function getHubView(win) {
    return win && typeof win === 'object' ? hubViewByWindow.get(win) : undefined;
}
/** Returns the slot-clipping `View` container (`clipView`) for `win` when `enable-wcv-three-layer-stack` was latched on window creation. */
function getHubClipView(win) {
    return win && typeof win === 'object'
        ? hubClipViewByWindow.get(win)
        : undefined;
}
/** Returns the top-layer input-catcher `WebContentsView` (`catcherWcv`) for `win`, or `null` when unavailable. */
function getHubCatcherView(win) {
    return win && typeof win === 'object'
        ? (hubCatcherViewByWindow.get(win) ?? null)
        : null;
}
/** Returns the opaque background `View` curtain separating hidden background `browserWcv` tabs from `hubWcv` and the active `[data-browser-hole]` tab. */
function getHubCurtainView(win) {
    return win && typeof win === 'object'
        ? hubCurtainViewByWindow.get(win)
        : undefined;
}
/** Returns the theme surface and curtain background color (`#RRGGBB`) for `win`. */
function getHubCurtainColor(win) {
    if (win && typeof win === 'object') {
        const cached = hubCurtainColorByWindow.get(win);
        if (cached) {
            return cached;
        }
    }
    const stored = normalizeHexSurfaceColor(readAppStorageSync()[exports.HUB_SURFACE_COLOR_STORAGE_KEY]);
    if (stored) {
        return stored;
    }
    return getThemeMode().toUpperCase().includes('LIGHT') ? '#FAFAFA' : '#131313';
}
/** Updates a Hub window's `baseWin` (and opaque `curtainView` document when present) to `color` (`#RRGGBB`); no-ops for non-Hub or closed windows. */
function setHubCurtainColor(win, color) {
    const normalized = normalizeHexSurfaceColor(color);
    if (!normalized || !win || typeof win !== 'object') {
        return undefined;
    }
    const curtain = hubCurtainViewByWindow.get(win);
    const hasClipView = hubClipViewByWindow.has(win);
    if (!curtain && !hasClipView) {
        return undefined;
    }
    const w = win;
    if (!curtain && w.isDestroyed?.()) {
        return undefined;
    }
    hubCurtainColorByWindow.set(win, normalized);
    if (!w.isDestroyed?.()) {
        w.setBackgroundColor?.(normalized);
    }
    if (hubSurfaceTransparentByWindow.get(win) === false) {
        const hubView = hubViewByWindow.get(win);
        if (hubView && !hubView.webContents?.isDestroyed?.()) {
            hubView.setBackgroundColor?.(normalized);
        }
    }
    if (curtain && !curtain.webContents?.isDestroyed?.()) {
        curtain.setBackgroundColor?.(normalized);
        const st = hubCurtainStateByWindow.get(win) ?? { chain: Promise.resolve() };
        st.chain = st.chain.then(async () => {
            if (curtain.webContents?.isDestroyed?.() ||
                hubCurtainColorByWindow.get(win) !== normalized) {
                return;
            }
            const prev = st.cssKey;
            const css = `html, body { background: ${normalized} !important; }`;
            const key = await curtain.webContents
                .insertCSS(css, { cssOrigin: 'user' })
                .catch(() => undefined);
            if (typeof key === 'string' && key) {
                st.cssKey = key;
                if (prev && prev !== key) {
                    await curtain.webContents
                        .removeInsertedCSS(prev)
                        .catch(() => undefined);
                }
            }
        });
        hubCurtainStateByWindow.set(win, st);
    }
    return normalized;
}
/**
 * Makes `hubWcv` see-through (`transparent`) or paints it with the curtain
 * color. A native browser tab can only show through the Hub UI's
 * `[data-browser-hole]` while `hubWcv` is see-through, so callers make it
 * see-through before a tab is shown and opaque again once no tab is visible.
 * No-ops when the state is unchanged or `win` has no `hubWcv`.
 *
 * Why this exists (perf): keep `hubWcv` opaque whenever no tab is visible.
 * Do not make it see-through all the time, as it was from #231 until #356.
 * - On macOS each WebContentsView is its own layer, and WindowServer blends a
 *   see-through full-window layer over the curtain on every frame the Hub
 *   draws. That made every Hub animation visibly slow on Intel Macs (2020
 *   MacBook Pro, integrated GPU) while the same UI in the VS Code extension
 *   was smooth.
 * - The cost cannot be seen on Linux, where Chromium merges all views into
 *   one buffer, or on Google's macOS test VMs, which have no real GPU
 *   (Kokoro, Forge on Mac; measured, see #356). So no perf test catches a
 *   regression here. #362 adds a check of the opacity itself to
 *   scripts/wcv_3layer_regression_check.mjs.
 */
function setHubSurfaceTransparent(win, transparent) {
    if (!win || typeof win !== 'object') {
        return;
    }
    const hubView = hubViewByWindow.get(win);
    if (!hubView ||
        hubView.webContents?.isDestroyed?.() ||
        hubSurfaceTransparentByWindow.get(win) === transparent) {
        return;
    }
    hubSurfaceTransparentByWindow.set(win, transparent);
    hubView.setBackgroundColor?.(transparent ? '#00000000' : getHubCurtainColor(win));
}
/** Returns whether `hubWcv` is currently see-through (see `setHubSurfaceTransparent`). */
function isHubSurfaceTransparent(win) {
    return Boolean(win && typeof win === 'object' && hubSurfaceTransparentByWindow.get(win));
}
/** Returns the trusted Hub UI `WebContents` (`hubWcv.webContents`) for `win`. */
function getHubWebContents(win) {
    if (!win || typeof win !== 'object') {
        return undefined;
    }
    return (hubViewByWindow.get(win)?.webContents ??
        win.webContents);
}
/** Resolves the owning `HubWindow` for `hubWcv`, `browserWcv`, or `<webview>` `contents`. */
function resolveHubWindowFromWebContents(contents) {
    if (!contents ||
        typeof contents !== 'object' ||
        isCatcherWebContents(contents) ||
        isCatcherWebContents(contents.hostWebContents)) {
        return undefined;
    }
    const direct = windowByWebContents.get(contents) ??
        (typeof contents.id === 'number'
            ? windowByWebContentsId.get(contents.id)
            : undefined);
    if (direct && !direct.isDestroyed?.() && !isPopupWindow(direct)) {
        return direct;
    }
    if (contents.hostWebContents && contents.hostWebContents !== contents) {
        const fromHost = resolveHubWindowFromWebContents(contents.hostWebContents);
        if (fromHost) {
            return fromHost;
        }
    }
    for (const win of getHubWindows()) {
        const hubContents = getHubWebContents(win);
        if (hubContents === contents ||
            (typeof contents.id === 'number' && hubContents?.id === contents.id)) {
            return win;
        }
    }
    if (typeof electron_1.BrowserWindow?.fromWebContents === 'function') {
        const candidate = (contents.hostWebContents
            ? electron_1.BrowserWindow.fromWebContents(contents.hostWebContents)
            : null) ??
            electron_1.BrowserWindow.fromWebContents(contents);
        if (candidate && !candidate.isDestroyed?.() && !isPopupWindow(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
/** Resolves the owning `HubWindow` strictly for a top-layer `catcherWcv` `WebContents` in `O(1)`. */
function resolveHubWindowFromCatcherWebContents(contents) {
    if (!contents || typeof contents !== 'object' || contents.isDestroyed?.()) {
        return undefined;
    }
    const win = windowByCatcherWebContents.get(contents) ??
        (typeof contents.id === 'number'
            ? windowByCatcherWebContentsId.get(contents.id)
            : undefined);
    if (!win || win.isDestroyed?.() || isPopupWindow(win)) {
        return undefined;
    }
    const catcherContents = hubCatcherViewByWindow.get(win)?.webContents;
    if (!catcherContents || catcherContents.isDestroyed?.()) {
        return undefined;
    }
    if (catcherContents === contents) {
        return win;
    }
    return typeof contents.id === 'number' &&
        catcherContents.id === contents.id &&
        !windowByWebContents.has(contents) &&
        !contents.hostWebContents &&
        getHubWebContents(win) !== contents
        ? win
        : undefined;
}
/** Returns all open top-level Hub windows (excluding `<webview>` child popup windows). */
function getHubWindows() {
    const candidates = [];
    const seen = new Set();
    const baseWins = typeof electron_1.BaseWindow?.getAllWindows === 'function'
        ? electron_1.BaseWindow.getAllWindows()
        : [];
    const browserWins = typeof electron_1.BrowserWindow?.getAllWindows === 'function'
        ? electron_1.BrowserWindow.getAllWindows()
        : [];
    for (const win of [...baseWins, ...browserWins]) {
        if (!win ||
            typeof win !== 'object' ||
            seen.has(win) ||
            win.isDestroyed?.()) {
            continue;
        }
        seen.add(win);
        if (hubWindows.has(win) || !isPopupWindow(win)) {
            candidates.push(win);
        }
    }
    return candidates;
}
/** The open Hub windows on the local backend (no SSH windows or dialogs). */
function getLocalHubWindows() {
    return getHubWindows().filter(windowBackends_1.isLocalAppWindow);
}
/**
 * The local Hub window focused last (the first if none was), of those
 * createWindow opened: not e.g. the IDE install wizard.
 */
function getLastFocusedLocalHubWindow() {
    const lastFocus = (win) => lastFocusOf.get(win) ?? 0;
    return getLocalHubWindows()
        .filter((win) => hubWindows.has(win))
        .sort((a, b) => lastFocus(b) - lastFocus(a))[0];
}
/** From a local Hub window's top frame: not SSH, webview, tab or subframe. */
function isLocalHubTopFrame(event) {
    const s = event?.sender;
    // Null once the frame navigated or was destroyed: fails closed.
    const frame = event?.senderFrame;
    return (Boolean(s) &&
        !s.isDestroyed?.() &&
        s.getType?.() !== 'webview' &&
        Boolean(frame) &&
        frame === s.mainFrame &&
        getLocalHubWindows().some((w) => getHubWebContents(w) === s));
}
/** Returns the currently focused top-level `HubWindow`, if any. */
function getFocusedHubWindow() {
    const focused = (typeof electron_1.BaseWindow?.getFocusedWindow === 'function'
        ? electron_1.BaseWindow.getFocusedWindow()
        : null) ??
        (typeof electron_1.BrowserWindow?.getFocusedWindow === 'function'
            ? electron_1.BrowserWindow.getFocusedWindow()
            : null);
    return focused &&
        !focused.isDestroyed?.() &&
        (hubWindows.has(focused) || !isPopupWindow(focused))
        ? focused
        : undefined;
}
/** Same origin stays; everything else goes to the OS (http(s) or mailto). */
const defaultNavigationPolicy = {
    allowsNavigation: (url, contents) => (0, externalUrl_1.isSameOrigin)(url, contents.getURL()),
    openOutside: (url) => {
        void (0, externalUrl_1.openExternalSafely)(url, 'unconfirmed');
    },
};
/**
 * Creates and returns a new Hub window pointed at `url`.
 * Constructs a `BaseWindow` hosting a transparent `hubWcv`
 * (`WebContentsView`), so native browser views can stack at `z=0`/`z=1` and
 * the `<webview>` engine renders inside `hubWcv`. The browser engine is chosen
 * by the renderer at runtime, so it may change without recreating the window.
 * With `builtInBrowser: false`, a plain `BrowserWindow` instead.
 */
function createWindow(url, storageManager, options) {
    ensureAppIsInDock();
    const existingWindows = options?.cascade ? getHubWindows() : [];
    const initialWindowState = (0, windowState_1.resolveInitialWindowState)({
        cascadeFromWindow: existingWindows.length > 0
            ? (getFocusedHubWindow() ?? existingWindows[existingWindows.length - 1])
            : undefined,
    });
    const theme = getThemeMode().toUpperCase();
    const isLight = theme.includes('LIGHT');
    const backgroundColor = isLight ? '#FAFAFA' : '#131313';
    const foregroundColor = isLight ? '#383A42' : '#FAFAFA';
    const wslBadge = (0, wsl_1.getActiveWslDistro)()
        ? ` (WSL: ${(0, wsl_1.getActiveWslDistro)()})`
        : '';
    const badge = options?.titleSuffix ?? wslBadge;
    const builtInBrowser = options?.builtInBrowser ?? true;
    const additionalArguments = options?.additionalArguments ?? [];
    const windowOptions = {
        ...(initialWindowState.x !== undefined && initialWindowState.y !== undefined
            ? { x: initialWindowState.x, y: initialWindowState.y }
            : {}),
        width: initialWindowState.width,
        height: initialWindowState.height,
        ...(initialWindowState.isFullScreen ? { fullscreen: true } : {}),
        minWidth: windowState_1.MIN_WINDOW_WIDTH,
        minHeight: windowState_1.MIN_WINDOW_HEIGHT,
        title: electron_1.app.getName() + badge,
        icon: path_1.default.join(__dirname, '..', 'icon.png'),
        titleBarStyle: 'hidden',
        titleBarOverlay: isMacOS()
            ? false
            : {
                color: backgroundColor,
                symbolColor: foregroundColor,
                height: 30,
            },
        backgroundColor,
        trafficLightPosition: { x: 12, y: 12 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, 'preload.js'),
            devTools: (0, debugConsole_1.isDebugConsoleEnabled)(),
            // Required for the in-app <webview> browser surface so the guest
            // runs in an out-of-process Chromium WebContents that ignores
            // X-Frame-Options and frame-ancestors CSP and supports isolated worlds.
            webviewTag: builtInBrowser,
            ...(options?.partition ? { partition: options.partition } : {}),
            ...(additionalArguments.length > 0 ? { additionalArguments } : {}),
        },
    };
    let win;
    let syncHubViewBounds;
    let onCurtainProcessGone;
    let clipView;
    let cleanupCatcher;
    if (builtInBrowser) {
        const curtainColor = getHubCurtainColor();
        const threeLayer = isWcvThreeLayerStackEnabled(storageManager);
        const { webPreferences, ...baseWindowOptions } = windowOptions;
        const baseWin = new electron_1.BaseWindow({
            ...baseWindowOptions,
            backgroundColor: curtainColor,
        });
        clipView = threeLayer ? new electron_1.View() : undefined;
        clipView?.setBounds?.({ x: 0, y: 0, width: 1280, height: 800 });
        clipView?.setVisible?.(false);
        // Load a minimal static HTML document into `curtainView` (`javascript: false`):
        // without a committed renderer frame, a WebContentsView's compositor layer
        // remains transparent (`setBackgroundColor` only paints behind NSView hosts
        // on macOS and awaits a committed frame on Aura/Viz), letting parked tabs bleed.
        const curtainView = !threeLayer
            ? new electron_1.WebContentsView({
                webPreferences: { sandbox: true, javascript: false },
            })
            : undefined;
        curtainView?.setBackgroundColor?.(curtainColor);
        const initialCurtainLoad = Promise.resolve(curtainView?.webContents?.loadURL?.(buildHubCurtainDataUrl(curtainColor))).catch(() => undefined);
        const hubWcv = new electron_1.WebContentsView({
            webPreferences: { ...webPreferences, transparent: true },
        });
        // Opaque until a native browser tab must show through. Don't change this
        // back to '#00000000': a see-through full-window hubWcv slows every Hub
        // animation on Intel Macs, and no test machine can measure it. See
        // setHubSurfaceTransparent for why.
        hubWcv.setBackgroundColor?.(curtainColor);
        hubSurfaceTransparentByWindow.set(baseWin, false);
        const catcherView = threeLayer
            ? new electron_1.WebContentsView({
                webPreferences: {
                    preload: path_1.default.join(__dirname, 'catcherPreload.js'),
                    contextIsolation: true,
                    sandbox: true,
                    nodeIntegration: false,
                    backgroundThrottling: false,
                    focusOnNavigation: false,
                    transparent: true,
                },
            })
            : undefined;
        catcherView?.setBackgroundColor?.('#00000000');
        catcherView?.setBounds?.({ x: 0, y: 0, width: 0, height: 0 });
        catcherView?.setVisible?.(false);
        const placeCatcherAtTopLayer = () => {
            if (!catcherView || baseWin.isDestroyed?.()) {
                return;
            }
            const children = baseWin.contentView?.children ?? [];
            const withoutCatcher = children.filter((c) => c !== catcherView);
            const anchorIdx = Math.max(clipView ? withoutCatcher.indexOf(clipView) : -1, withoutCatcher.indexOf(hubWcv));
            const targetIdx = anchorIdx >= 0 ? anchorIdx + 1 : withoutCatcher.length;
            const currentIdx = children.indexOf(catcherView);
            if (currentIdx === targetIdx &&
                children.length === withoutCatcher.length + 1) {
                return;
            }
            if (currentIdx >= 0) {
                baseWin.contentView.removeChildView(catcherView);
            }
            baseWin.contentView.addChildView(catcherView, targetIdx);
        };
        baseWin.contentView.addChildView(clipView ?? curtainView);
        baseWin.contentView.addChildView(hubWcv);
        placeCatcherAtTopLayer();
        syncHubViewBounds = () => {
            if (!baseWin.isDestroyed?.() && !hubWcv.webContents?.isDestroyed?.()) {
                const [width, height] = baseWin.getContentSize();
                curtainView?.setBounds({ x: 0, y: 0, width, height });
                hubWcv.setBounds({ x: 0, y: 0, width, height });
            }
        };
        syncHubViewBounds();
        baseWin.on('resize', syncHubViewBounds);
        win = baseWin;
        Object.defineProperty(win, 'webContents', {
            get: () => hubWcv.webContents,
            configurable: true,
        });
        win.loadURL = (targetUrl, options) => hubWcv.webContents.loadURL(targetUrl, options);
        hubViewByWindow.set(win, hubWcv);
        if (clipView) {
            hubClipViewByWindow.set(win, clipView);
        }
        else if (curtainView) {
            hubCurtainViewByWindow.set(win, curtainView);
            hubCurtainStateByWindow.set(win, { chain: initialCurtainLoad });
        }
        const catcherContents = catcherView?.webContents;
        let [catcherReloadSeq, catcherCrashCount] = [0, 0];
        let catcherBackoffTimer;
        let catcherStableTimer;
        let cancelCatcherReloadWait;
        const clearCatcherTimers = () => {
            [catcherBackoffTimer, catcherStableTimer].forEach((t) => clearTimeout(t));
            catcherBackoffTimer = catcherStableTimer = undefined;
        };
        const guardCatcherNavigation = (event, legacyUrl) => {
            const targetUrl = typeof event?.url === 'string' ? event.url : legacyUrl;
            if (event?.isMainFrame === false || targetUrl !== exports.CATCHER_DATA_URL) {
                event.preventDefault();
            }
        };
        const lockCatcherZoom = () => {
            if (!catcherContents || catcherContents.isDestroyed?.()) {
                return;
            }
            catcherContents.setZoomMode?.('disabled');
            catcherContents.setZoomFactor?.(1);
            void Promise.resolve(catcherContents.setVisualZoomLevelLimits?.(1, 1)).catch(() => undefined);
        };
        const onCatcherZoomChanged = (event) => {
            event?.preventDefault?.();
            lockCatcherZoom();
        };
        const onCatcherProcessGone = (_event, details) => {
            if (!catcherView ||
                !catcherContents ||
                details?.reason === 'clean-exit' ||
                baseWin.isDestroyed?.() ||
                hubCatcherViewByWindow.get(win) !== catcherView ||
                catcherContents.isDestroyed?.()) {
                return;
            }
            const seq = ++catcherReloadSeq;
            clearCatcherTimers();
            cancelCatcherReloadWait?.();
            catcherView.setBounds?.({ x: 0, y: 0, width: 0, height: 0 });
            catcherView.setVisible?.(false);
            // Detach across crash reload so recreating RenderWidgetHostView cannot
            // blur hubWcv or move keyboard focus onto catcherWcv.
            baseWin.contentView?.removeChildView?.(catcherView);
            const attempt = ++catcherCrashCount;
            if (attempt > exports.CATCHER_CRASH_BACKOFF_MS.length) {
                hubCatcherViewByWindow.delete(win);
                detachCatcherListeners();
                return;
            }
            catcherBackoffTimer = setTimeout(() => runCatcherRecovery(seq), exports.CATCHER_CRASH_BACKOFF_MS[attempt - 1]);
        };
        const runCatcherRecovery = (seq) => {
            catcherBackoffTimer = undefined;
            const isLiveSeq = () => Boolean(catcherView && catcherContents) &&
                seq === catcherReloadSeq &&
                !baseWin.isDestroyed?.() &&
                hubCatcherViewByWindow.get(win) === catcherView &&
                !catcherContents.isDestroyed?.();
            if (!isLiveSeq() || !catcherView || !catcherContents) {
                return;
            }
            let loadOk = false;
            const markOk = () => void (loadOk = true);
            // Reload in place when CATCHER_DATA_URL is already committed so Chromium
            // re-binds blink.mojom.WidgetHost blocking wheel listener properties.
            const recoverCatcher = catcherContents.getURL?.() === exports.CATCHER_DATA_URL &&
                typeof catcherContents.reload === 'function'
                ? new Promise((resolve) => {
                    let settled = false;
                    const settle = () => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        if (cancelCatcherReloadWait === settle) {
                            cancelCatcherReloadWait = undefined;
                        }
                        catcherContents.off?.('did-finish-load', onOk);
                        catcherContents.off?.('did-fail-load', settle);
                        catcherContents.off?.('destroyed', settle);
                        resolve();
                    };
                    const onOk = () => (markOk(), settle());
                    cancelCatcherReloadWait = settle;
                    catcherContents.on?.('did-finish-load', onOk);
                    catcherContents.on?.('did-fail-load', settle);
                    catcherContents.on?.('destroyed', settle);
                    try {
                        catcherContents.reload();
                    }
                    catch {
                        settle();
                    }
                })
                : Promise.resolve(catcherContents.loadURL(exports.CATCHER_DATA_URL)).then(markOk);
            void recoverCatcher
                .catch(() => undefined)
                .finally(() => {
                if (!isLiveSeq()) {
                    return;
                }
                catcherView.setBounds?.({ x: 0, y: 0, width: 0, height: 0 });
                catcherView.setVisible?.(false);
                lockCatcherZoom();
                placeCatcherAtTopLayer();
                if (loadOk) {
                    const onStable = () => void ((catcherStableTimer = undefined), (catcherCrashCount = 0));
                    catcherStableTimer = setTimeout(onStable, exports.CATCHER_STABLE_LOAD_RESET_MS);
                }
            });
        };
        function detachCatcherListeners() {
            const off = (e, fn) => catcherContents?.off?.(e, fn);
            ['will-navigate', 'will-frame-navigate', 'will-redirect'].forEach((e) => off(e, guardCatcherNavigation));
            ['dom-ready', 'did-finish-load'].forEach((e) => off(e, lockCatcherZoom));
            off('zoom-changed', onCatcherZoomChanged);
            off('render-process-gone', onCatcherProcessGone);
        }
        if (catcherView && catcherContents) {
            hubCatcherViewByWindow.set(win, catcherView);
            windowByCatcherWebContents.set(catcherContents, win);
            if (typeof catcherContents.id === 'number') {
                const catcherId = catcherContents.id;
                windowByCatcherWebContentsId.set(catcherId, win);
                catcherContents.once?.('destroyed', () => {
                    if (windowByCatcherWebContentsId.get(catcherId) === win) {
                        windowByCatcherWebContentsId.delete(catcherId);
                    }
                });
            }
            catcherContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
            catcherContents.setIgnoreMenuShortcuts?.(true);
            catcherContents.on?.('will-navigate', guardCatcherNavigation);
            catcherContents.on?.('will-frame-navigate', guardCatcherNavigation);
            catcherContents.on?.('will-redirect', guardCatcherNavigation);
            catcherContents.on?.('dom-ready', lockCatcherZoom);
            catcherContents.on?.('did-finish-load', lockCatcherZoom);
            catcherContents.on?.('zoom-changed', onCatcherZoomChanged);
            catcherContents.on?.('render-process-gone', onCatcherProcessGone);
            lockCatcherZoom();
            void Promise.resolve(catcherContents.loadURL(exports.CATCHER_DATA_URL)).catch(() => undefined);
        }
        if (catcherView) {
            cleanupCatcher = () => {
                ++catcherReloadSeq;
                clearCatcherTimers();
                cancelCatcherReloadWait?.();
                if (typeof catcherContents?.id === 'number' &&
                    windowByCatcherWebContentsId.get(catcherContents.id) === win) {
                    windowByCatcherWebContentsId.delete(catcherContents.id);
                }
                hubCatcherViewByWindow.delete(win);
                catcherContents?.off?.('will-navigate', guardCatcherNavigation);
                catcherContents?.off?.('will-frame-navigate', guardCatcherNavigation);
                catcherContents?.off?.('will-redirect', guardCatcherNavigation);
                catcherContents?.off?.('dom-ready', lockCatcherZoom);
                catcherContents?.off?.('did-finish-load', lockCatcherZoom);
                catcherContents?.off?.('zoom-changed', onCatcherZoomChanged);
                catcherContents?.off?.('render-process-gone', onCatcherProcessGone);
                if (!baseWin.isDestroyed?.()) {
                    baseWin.contentView?.removeChildView?.(catcherView);
                }
                if (catcherContents && !catcherContents.isDestroyed?.()) {
                    catcherContents.close?.();
                }
            };
        }
        hubCurtainColorByWindow.set(win, curtainColor);
        onCurtainProcessGone = () => {
            if (!baseWin.isDestroyed?.() &&
                curtainView &&
                !curtainView.webContents?.isDestroyed?.()) {
                const currentColor = hubCurtainColorByWindow.get(win) ?? curtainColor;
                const st = hubCurtainStateByWindow.get(win) ?? {
                    chain: Promise.resolve(),
                };
                st.cssKey = undefined;
                st.chain = st.chain.then(() => Promise.resolve(curtainView.webContents?.loadURL?.(buildHubCurtainDataUrl(currentColor))).catch(() => undefined));
                hubCurtainStateByWindow.set(win, st);
            }
        };
        curtainView?.webContents?.on?.('render-process-gone', onCurtainProcessGone);
    }
    else {
        // No hubWcv, curtain, clipView or <webview>: no browser engine can attach.
        // The title comes from handleTitleUpdate, not the raw page title.
        win = new electron_1.BrowserWindow(windowOptions);
        win.on('page-title-updated', (event) => event.preventDefault());
    }
    if (initialWindowState.isFullScreen) {
        if (!win.isFullScreen?.()) {
            win.setFullScreen?.(true);
        }
        syncHubViewBounds?.();
    }
    else if (initialWindowState.isMaximized) {
        win.maximize?.();
        syncHubViewBounds?.();
    }
    (0, windowState_1.trackWindowState)(win, initialWindowState);
    const hubContents = getHubWebContents(win);
    if (!hubContents) {
        throw new Error('Failed to initialize Hub WebContents');
    }
    hubWindows.add(win);
    win.on('focus', () => lastFocusOf.set(win, ++focusCount));
    registerWindowWebContents(win, hubContents);
    // `BaseWindow` does not mirror the Hub page title, so set it explicitly.
    // Truncation keeps the menu dropdown from being very wide.
    const handleTitleUpdate = (_event, title) => {
        if (win.isDestroyed?.()) {
            return;
        }
        const maxLength = 25;
        const truncated = title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
        win.setTitle(truncated + badge);
    };
    hubContents.on?.('page-title-updated', handleTitleUpdate);
    const navigationPolicy = options?.navigationPolicy ?? defaultNavigationPolicy;
    // A throwing allowsNavigation blocks (openOutside still gets the URL); a
    // throwing openOutside opens nothing. Logs omit the URL: it can carry tokens.
    const allowsNavigation = (url) => {
        try {
            return navigationPolicy.allowsNavigation(url, hubContents);
        }
        catch (err) {
            console.error('allowsNavigation failed:', err);
            return false;
        }
    };
    const openOutside = (url) => {
        try {
            navigationPolicy.openOutside(url, hubContents);
        }
        catch (err) {
            console.error('openOutside failed:', err);
        }
    };
    const guardExternalNavigation = (event) => {
        // will-redirect also fires for subframes (e.g. sidecar iframes); only
        // top-level Hub navigations should be guarded or handed to the OS.
        if (!event.isMainFrame) {
            return;
        }
        if (allowsNavigation(event.url)) {
            return;
        }
        event.preventDefault();
        openOutside(event.url);
    };
    win.on('closed', () => {
        for (const [id, mappedWin] of windowByWebContentsId.entries()) {
            if (mappedWin === win) {
                windowByWebContentsId.delete(id);
            }
        }
        if (syncHubViewBounds) {
            win.off?.('resize', syncHubViewBounds);
        }
        hubContents.off?.('page-title-updated', handleTitleUpdate);
        hubContents.off?.('will-navigate', guardExternalNavigation);
        hubContents.off?.('will-redirect', guardExternalNavigation);
        hubViewByWindow.delete(win);
        if (clipView) {
            if (!win.isDestroyed?.()) {
                win.contentView?.removeChildView?.(clipView);
            }
            hubClipViewByWindow.delete(win);
        }
        cleanupCatcher?.();
        const curtainContents = hubCurtainViewByWindow.get(win)?.webContents;
        if (onCurtainProcessGone) {
            curtainContents?.off?.('render-process-gone', onCurtainProcessGone);
        }
        if (curtainContents && !curtainContents.isDestroyed?.()) {
            curtainContents.close?.();
        }
        hubCurtainViewByWindow.delete(win);
        hubCurtainColorByWindow.delete(win);
        hubCurtainStateByWindow.delete(win);
        if (!hubContents.isDestroyed?.()) {
            hubContents.close?.();
        }
    });
    hubContents.setWindowOpenHandler((details) => {
        openOutside(details.url);
        return { action: 'deny' };
    });
    hubContents.on('will-navigate', guardExternalNavigation);
    hubContents.on('will-redirect', guardExternalNavigation);
    (0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor);
    (0, keybindings_1.registerKeybindings)(win, {
        createNewWindow: () => {
            if (options?.onNewWindow) {
                options.onNewWindow();
                return;
            }
            void createWindow(url, storageManager, { cascade: true });
        },
        onQuitRequested: () => {
            exports.showQuitConfirmation = true;
            electron_1.app.quit();
        },
    });
    // Zoom persistence — restore saved level and capture future changes.
    if (storageManager) {
        const ZOOM_LEVEL_KEY = 'zoomLevel';
        let isRestoringZoom = false;
        const applyStoredZoomLevel = async () => {
            const items = await storageManager.getItems();
            if (win.isDestroyed?.() || hubContents.isDestroyed?.()) {
                return;
            }
            const stored = items[ZOOM_LEVEL_KEY];
            if (stored !== undefined) {
                const level = parseFloat(stored);
                if (!isNaN(level)) {
                    isRestoringZoom = true;
                    hubContents.setZoomLevel(level);
                    isRestoringZoom = false;
                }
            }
        };
        const handleDidFinishLoad = () => {
            if (!win.isDestroyed?.() && !hubContents.isDestroyed?.()) {
                void applyStoredZoomLevel();
            }
        };
        hubContents.on('did-finish-load', handleDidFinishLoad);
        // Capture zoom changes from native menu accelerators, trackpad
        // pinch-to-zoom, or Ctrl+scroll so they are also persisted.
        const handleZoomChanged = (_event, _direction) => {
            if (isRestoringZoom ||
                win.isDestroyed?.() ||
                hubContents.isDestroyed?.()) {
                return;
            }
            const currentLevel = hubContents.getZoomLevel();
            void storageManager.updateItems({
                [ZOOM_LEVEL_KEY]: String(currentLevel),
            });
        };
        hubContents.on('zoom-changed', handleZoomChanged);
        win.on('closed', () => {
            hubContents.off?.('did-finish-load', handleDidFinishLoad);
            hubContents.off?.('zoom-changed', handleZoomChanged);
        });
    }
    void win.loadURL(url);
    return win;
}
/**
 * Focuses a window if it exists, or creates a new one.
 */
const showOrCreateWindow = (port) => {
    const wins = getLocalHubWindows();
    if (wins.length > 0) {
        if (wins[0].isMinimized()) {
            wins[0].restore();
        }
        wins[0].show();
        wins[0].focus();
    }
    else {
        createWindow(`${constants_1.WINDOW_ORIGIN}:${port}/`);
    }
};
exports.showOrCreateWindow = showOrCreateWindow;
/**
 * Manages the power save blocker to keep the computer awake.
 */
class SleepBlocker {
    constructor() {
        this.currentBlockerId = null;
    }
    static getInstance() {
        if (!SleepBlocker.instance) {
            SleepBlocker.instance = new SleepBlocker();
        }
        return SleepBlocker.instance;
    }
    shouldKeepComputerAwake(keep) {
        if (keep) {
            if (this.currentBlockerId === null) {
                this.currentBlockerId = electron_1.powerSaveBlocker.start('prevent-display-sleep');
                console.log('Power save blocker started:', this.currentBlockerId);
            }
        }
        else {
            if (this.currentBlockerId !== null) {
                electron_1.powerSaveBlocker.stop(this.currentBlockerId);
                console.log('Power save blocker stopped:', this.currentBlockerId);
                this.currentBlockerId = null;
            }
        }
    }
}
exports.SleepBlocker = SleepBlocker;
function getNodeWrapperPaths(envPath, os, isPackaged, userDataPath, baseDir) {
    const delimiter = os === 'win32' ? ';' : ':';
    if (!isPackaged) {
        const devBinPath = path_1.default.join(baseDir, '..', 'node_modules', '.bin');
        return {
            newEnvPath: `${devBinPath}${delimiter}${envPath || ''}`,
            nodeWrapperPath: undefined,
            binPath: undefined,
        };
    }
    const binPath = path_1.default.join(userDataPath, 'bin');
    const nodeWrapperPath = path_1.default.join(binPath, os === 'win32' ? 'agy-node.cmd' : 'agy-node');
    return {
        newEnvPath: `${binPath}${delimiter}${envPath || ''}`,
        nodeWrapperPath,
        binPath,
    };
}
/**
 * Sets up a wrapper script for Node.js that runs Electron as Node.
 * This allows running standard Node scripts using the Electron binary.
 */
function setupNodeWrapper(env) {
    const userDataPath = electron_1.app.isPackaged ? electron_1.app.getPath('userData') : '';
    // Windows environment variables are case-insensitive, but when copying process.env
    // into a plain object, we might get 'Path' instead of 'PATH'. We need to find
    // the actual key used to avoid creating case-duplicate keys (e.g. 'Path' and 'PATH')
    // which can confuse child_process.spawn on Windows.
    const isWindows = process.platform === 'win32';
    const pathKey = isWindows
        ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
        : 'PATH';
    const { newEnvPath, nodeWrapperPath, binPath } = getNodeWrapperPaths(env[pathKey], process.platform, electron_1.app.isPackaged, userDataPath, __dirname);
    env[pathKey] = newEnvPath;
    // In non-packaged dev mode, we don't create a wrapper and it'll just use machine node
    if (!nodeWrapperPath || !binPath) {
        return;
    }
    if (!fs.existsSync(binPath)) {
        fs.mkdirSync(binPath, { recursive: true });
    }
    const nodeWrapperContent = isWindows
        ? `@echo off\nset ELECTRON_RUN_AS_NODE=1\n"${process.execPath}" %*\n`
        : (0, nodeWrapper_1.nodeWrapperScript)((0, nodeWrapper_1.electronNodeBinary)());
    try {
        const existingContent = fs.existsSync(nodeWrapperPath)
            ? fs.readFileSync(nodeWrapperPath, 'utf-8')
            : '';
        if (existingContent !== nodeWrapperContent) {
            fs.writeFileSync(nodeWrapperPath, nodeWrapperContent);
            if (process.platform !== 'win32') {
                fs.chmodSync(nodeWrapperPath, 0o755);
            }
        }
    }
    catch (err) {
        console.error(`Failed to create node wrapper: ${err}`);
    }
}
