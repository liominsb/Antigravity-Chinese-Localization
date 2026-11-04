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
exports.SleepBlocker = exports.showOrCreateWindow = exports.HUB_SURFACE_COLOR_STORAGE_KEY = exports.WCV_BROWSER_FLAG_NAME = exports.WCV_BROWSER_STORAGE_KEY = exports.showQuitConfirmation = void 0;
exports.setShowQuitConfirmation = setShowQuitConfirmation;
exports.isMacOS = isMacOS;
exports.normalizeHexSurfaceColor = normalizeHexSurfaceColor;
exports.buildHubCurtainDataUrl = buildHubCurtainDataUrl;
exports.isWcvBrowserWindowEnabled = isWcvBrowserWindowEnabled;
exports.markWebviewPopupWindow = markWebviewPopupWindow;
exports.registerWindowWebContents = registerWindowWebContents;
exports.getHubView = getHubView;
exports.getHubCurtainView = getHubCurtainView;
exports.getHubCurtainColor = getHubCurtainColor;
exports.setHubCurtainColor = setHubCurtainColor;
exports.getHubWebContents = getHubWebContents;
exports.resolveHubWindowFromWebContents = resolveHubWindowFromWebContents;
exports.getHubWindows = getHubWindows;
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
exports.WCV_BROWSER_STORAGE_KEY = 'browserSubagentWebviewUx';
exports.WCV_BROWSER_FLAG_NAME = 'enable-browser-subagent-webview-ux';
exports.HUB_SURFACE_COLOR_STORAGE_KEY = 'hubSurfaceBackgroundColor';
const FLAG_OVERRIDE_STORAGE_KEYS = [
    'jetski_feature_flag_overrides',
    'jetski.developer.customFlagOverrides',
    'ag:jetski.developer.customFlagOverrides',
];
const HEX_COLOR_6_RE = /^#[0-9a-fA-F]{6}$/;
const hubWindows = new WeakSet();
const hubViewByWindow = new WeakMap();
const hubCurtainViewByWindow = new WeakMap();
const hubCurtainColorByWindow = new WeakMap();
const hubCurtainStateByWindow = new WeakMap();
const windowByWebContents = new WeakMap();
const windowByWebContentsId = new Map();
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
/** Returns true when the Flag-3 WCV browser gate is enabled via CLI switch, env var, or `app_storage.json`. */
function isWcvBrowserWindowEnabled() {
    if (electron_1.app.commandLine?.hasSwitch?.('disable-wcv-browser')) {
        return false;
    }
    if (electron_1.app.commandLine?.hasSwitch?.('enable-wcv-browser')) {
        return true;
    }
    const envVal = process.env.ANTIGRAVITY_WCV_BROWSER?.trim().toLowerCase();
    if (envVal === '0' || envVal === 'false') {
        return false;
    }
    if (envVal === '1' || envVal === 'true') {
        return true;
    }
    try {
        const storagePath = (0, paths_1.getAppStoragePath)();
        if (!fs.existsSync(storagePath)) {
            return false;
        }
        const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
        const direct = parsed?.[exports.WCV_BROWSER_STORAGE_KEY];
        if (direct === 'true' || direct === true) {
            return true;
        }
        if (direct === 'false' || direct === false) {
            return false;
        }
        for (const key of FLAG_OVERRIDE_STORAGE_KEYS) {
            const raw = parsed?.[key];
            if (typeof raw === 'string' && raw.trim()) {
                try {
                    const flags = JSON.parse(raw);
                    const flagVal = flags?.[exports.WCV_BROWSER_FLAG_NAME];
                    if (flagVal === true || flagVal === 'true') {
                        return true;
                    }
                    if (flagVal === false || flagVal === 'false') {
                        return false;
                    }
                }
                catch {
                    // Ignore malformed override JSON.
                }
            }
        }
        return false;
    }
    catch {
        return false;
    }
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
    try {
        const storagePath = (0, paths_1.getAppStoragePath)();
        if (fs.existsSync(storagePath)) {
            const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
            const stored = normalizeHexSurfaceColor(parsed?.[exports.HUB_SURFACE_COLOR_STORAGE_KEY]);
            if (stored) {
                return stored;
            }
        }
    }
    catch {
        // Fall back to theme settings below.
    }
    return getThemeMode().toUpperCase().includes('LIGHT') ? '#FAFAFA' : '#131313';
}
/** Updates a WCV window's `baseWin` and opaque `curtainView` document to `color` (`#RRGGBB`); no-ops on flag-off `BrowserWindow`s. */
function setHubCurtainColor(win, color) {
    const normalized = normalizeHexSurfaceColor(color);
    const curtain = win && typeof win === 'object'
        ? hubCurtainViewByWindow.get(win)
        : undefined;
    if (!normalized || !win || !curtain) {
        return undefined;
    }
    hubCurtainColorByWindow.set(win, normalized);
    const w = win;
    if (!w.isDestroyed?.()) {
        w.setBackgroundColor?.(normalized);
    }
    if (!curtain.webContents?.isDestroyed?.()) {
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
    if (!contents || typeof contents !== 'object') {
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
/**
 * Creates and returns a new Hub window pointed at `url`.
 * When `isWcvBrowserWindowEnabled()` is false (default), constructs a standard
 * `BrowserWindow`. When true, constructs a `BaseWindow` hosting a transparent
 * `hubWcv` (`WebContentsView`) so native browser views can stack at `z=0`/`z=1`.
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
    const windowOptions = {
        ...(initialWindowState.x !== undefined && initialWindowState.y !== undefined
            ? { x: initialWindowState.x, y: initialWindowState.y }
            : {}),
        width: initialWindowState.width,
        height: initialWindowState.height,
        ...(initialWindowState.isFullScreen ? { fullscreen: true } : {}),
        minWidth: windowState_1.MIN_WINDOW_WIDTH,
        minHeight: windowState_1.MIN_WINDOW_HEIGHT,
        title: electron_1.app.getName() + wslBadge,
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
            webviewTag: true,
        },
    };
    let win;
    let syncHubViewBounds;
    let onCurtainProcessGone;
    if (isWcvBrowserWindowEnabled()) {
        const curtainColor = getHubCurtainColor();
        const { webPreferences, ...baseWindowOptions } = windowOptions;
        const baseWin = new electron_1.BaseWindow({
            ...baseWindowOptions,
            backgroundColor: curtainColor,
        });
        // Load a minimal static HTML document into `curtainView` (`javascript: false`):
        // without a committed renderer frame, a WebContentsView's compositor layer
        // remains transparent (`setBackgroundColor` only paints behind NSView hosts
        // on macOS and awaits a committed frame on Aura/Viz), letting parked tabs bleed.
        const curtainView = new electron_1.WebContentsView({
            webPreferences: { sandbox: true, javascript: false },
        });
        curtainView.setBackgroundColor?.(curtainColor);
        const initialCurtainLoad = Promise.resolve(curtainView.webContents?.loadURL?.(buildHubCurtainDataUrl(curtainColor))).catch(() => undefined);
        const hubWcv = new electron_1.WebContentsView({
            webPreferences: { ...webPreferences, transparent: true },
        });
        hubWcv.setBackgroundColor?.('#00000000');
        baseWin.contentView.addChildView(curtainView);
        baseWin.contentView.addChildView(hubWcv);
        syncHubViewBounds = () => {
            if (!baseWin.isDestroyed?.() && !hubWcv.webContents?.isDestroyed?.()) {
                const [width, height] = baseWin.getContentSize();
                curtainView.setBounds({ x: 0, y: 0, width, height });
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
        hubCurtainViewByWindow.set(win, curtainView);
        hubCurtainColorByWindow.set(win, curtainColor);
        hubCurtainStateByWindow.set(win, { chain: initialCurtainLoad });
        onCurtainProcessGone = () => {
            if (!baseWin.isDestroyed?.() &&
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
        curtainView.webContents?.on?.('render-process-gone', onCurtainProcessGone);
    }
    else {
        win = new electron_1.BrowserWindow(windowOptions);
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
    registerWindowWebContents(win, hubContents);
    // Prevent the menu dropdown from being very wide due to long page titles
    const hasHubView = Boolean(getHubView(win));
    const handleTitleUpdate = (event, title) => {
        if (win.isDestroyed?.()) {
            return;
        }
        const maxLength = 25;
        const truncated = title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
        if (truncated !== title || wslBadge || hasHubView) {
            event?.preventDefault?.();
            win.setTitle(truncated + wslBadge);
        }
    };
    win.on('page-title-updated', handleTitleUpdate);
    if (hasHubView) {
        hubContents.on?.('page-title-updated', handleTitleUpdate);
    }
    const guardExternalNavigation = (event) => {
        // will-redirect also fires for subframes (e.g. sidecar iframes); only
        // top-level Hub navigations should be guarded or handed to the OS.
        if (!event.isMainFrame) {
            return;
        }
        if ((0, externalUrl_1.isSameOrigin)(event.url, hubContents.getURL())) {
            return;
        }
        event.preventDefault();
        void (0, externalUrl_1.openExternalSafely)(event.url, 'unconfirmed');
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
        if (hasHubView && !hubContents.isDestroyed?.()) {
            hubContents.close?.();
        }
    });
    hubContents.setWindowOpenHandler((details) => {
        void (0, externalUrl_1.openExternalSafely)(details.url, 'unconfirmed');
        return { action: 'deny' };
    });
    hubContents.on('will-navigate', guardExternalNavigation);
    hubContents.on('will-redirect', guardExternalNavigation);
    (0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor);
    (0, keybindings_1.registerKeybindings)(win, {
        createNewWindow: () => {
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
    const wins = getHubWindows();
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
    let nodeWrapperContent = '';
    switch (process.platform) {
        case 'win32':
            nodeWrapperContent = `@echo off\nset ELECTRON_RUN_AS_NODE=1\n"${process.execPath}" %*\n`;
            break;
        case 'darwin': {
            // Use the Helper app instead of the main executable to prevent macOS
            // from bouncing a new Dock icon when this script is executed. The Helper
            // has LSUIElement=true in its Info.plist, running it invisibly.
            const appName = path_1.default.basename(process.execPath);
            let electronBinary = process.execPath;
            const helperPath = path_1.default.join(path_1.default.dirname(process.execPath), '..', 'Frameworks', `${appName} Helper.app`, 'Contents', 'MacOS', `${appName} Helper`);
            if (fs.existsSync(helperPath)) {
                electronBinary = helperPath;
            }
            nodeWrapperContent = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${electronBinary}" "$@"\n`;
            break;
        }
        default: // linux, etc.
            nodeWrapperContent = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`;
            break;
    }
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
