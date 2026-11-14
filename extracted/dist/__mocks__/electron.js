"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webUtils = exports.screen = exports.webFrame = exports.webContents = exports.session = exports.ipcRenderer = exports.contextBridge = exports.systemPreferences = exports.shell = exports.Notification = exports.Menu = exports.MenuItem = exports.Tray = exports.nativeImage = exports.protocol = exports.ipcMain = exports.dialog = exports.MessageChannelMain = exports.WebContentsView = exports.View = exports.BrowserWindow = exports.BaseWindow = exports.app = void 0;
/**
 * Shared Electron mock for all test files.
 *
 * This file is automatically used by Vitest when a test calls
 * `vi.mock('electron')` without a factory argument, because it lives
 * in the `__mocks__` directory.
 *
 * Individual tests can still override specific properties on these
 * mock objects in their `beforeEach` or `vi.hoisted` blocks.
 */
const vitest_1 = require("vitest");
exports.app = {
    whenReady: vitest_1.vi.fn().mockReturnValue({
        then: vitest_1.vi.fn().mockImplementation(function (cb) {
            this.cb = cb;
            return { catch: vitest_1.vi.fn() };
        }),
    }),
    on: vitest_1.vi.fn(),
    quit: vitest_1.vi.fn(),
    relaunch: vitest_1.vi.fn(),
    isPackaged: true,
    getAppPath: vitest_1.vi.fn().mockReturnValue('/mock/path'),
    getPath: vitest_1.vi.fn().mockReturnValue('/mock/user/data'),
    getVersion: vitest_1.vi.fn().mockReturnValue('1.0.0'),
    getName: vitest_1.vi.fn().mockReturnValue('App'),
    commandLine: {
        appendSwitch: vitest_1.vi.fn(),
        getSwitchValue: vitest_1.vi.fn().mockReturnValue(''),
        hasSwitch: vitest_1.vi.fn().mockReturnValue(false),
    },
    dock: {
        show: vitest_1.vi.fn(),
        hide: vitest_1.vi.fn(),
        setIcon: vitest_1.vi.fn(),
        setMenu: vitest_1.vi.fn(),
    },
    requestSingleInstanceLock: vitest_1.vi.fn().mockReturnValue(true),
    isDefaultProtocolClient: vitest_1.vi.fn().mockReturnValue(false),
    setAsDefaultProtocolClient: vitest_1.vi.fn().mockReturnValue(true),
    isReady: vitest_1.vi.fn().mockReturnValue(true),
    focus: vitest_1.vi.fn(),
    getAppMetrics: vitest_1.vi.fn().mockReturnValue([]),
};
function createMockContainerView() {
    const children = [];
    let visible = true;
    let bounds = { x: 0, y: 0, width: 0, height: 0 };
    return {
        children,
        addChildView: vitest_1.vi.fn((view, index) => {
            const existing = children.indexOf(view);
            if (existing >= 0) {
                children.splice(existing, 1);
            }
            if (typeof index === 'number' && index >= 0 && index <= children.length) {
                children.splice(index, 0, view);
            }
            else {
                children.push(view);
            }
        }),
        removeChildView: vitest_1.vi.fn((view) => {
            const idx = children.indexOf(view);
            if (idx >= 0) {
                children.splice(idx, 1);
            }
        }),
        setBounds: vitest_1.vi.fn((next) => {
            bounds = { ...next };
        }),
        getBounds: vitest_1.vi.fn(() => ({ ...bounds })),
        setVisible: vitest_1.vi.fn((next) => {
            visible = Boolean(next);
        }),
        getVisible: vitest_1.vi.fn(() => visible),
        setBackgroundColor: vitest_1.vi.fn(),
    };
}
const _mockBrowserWindowInstance = {
    loadURL: vitest_1.vi.fn(),
    once: vitest_1.vi.fn(),
    close: vitest_1.vi.fn(),
    show: vitest_1.vi.fn(),
    focus: vitest_1.vi.fn(),
    setTitle: vitest_1.vi.fn(),
    isMinimized: vitest_1.vi.fn().mockReturnValue(false),
    isMaximized: vitest_1.vi.fn().mockReturnValue(false),
    isFullScreen: vitest_1.vi.fn().mockReturnValue(false),
    maximize: vitest_1.vi.fn(),
    unmaximize: vitest_1.vi.fn(),
    setFullScreen: vitest_1.vi.fn(),
    restore: vitest_1.vi.fn(),
    on: vitest_1.vi.fn(),
    off: vitest_1.vi.fn(),
    isDestroyed: vitest_1.vi.fn().mockReturnValue(false),
    getBounds: vitest_1.vi
        .fn()
        .mockReturnValue({ x: 100, y: 100, width: 1400, height: 900 }),
    getNormalBounds: vitest_1.vi
        .fn()
        .mockReturnValue({ x: 100, y: 100, width: 1400, height: 900 }),
    getContentSize: vitest_1.vi.fn().mockReturnValue([1000, 800]),
    setBackgroundColor: vitest_1.vi.fn(),
    contentView: createMockContainerView(),
    webContents: {
        id: 1,
        isDestroyed: vitest_1.vi.fn().mockReturnValue(false),
        getType: vitest_1.vi.fn().mockReturnValue('window'),
        getURL: vitest_1.vi.fn().mockReturnValue('https://127.0.0.1:1234/'),
        send: vitest_1.vi.fn(),
        postMessage: vitest_1.vi.fn(),
        on: vitest_1.vi.fn(),
        off: vitest_1.vi.fn(),
        once: vitest_1.vi.fn(),
        removeListener: vitest_1.vi.fn(),
        setWindowOpenHandler: vitest_1.vi.fn(),
        getZoomLevel: vitest_1.vi.fn().mockReturnValue(0),
        setZoomLevel: vitest_1.vi.fn(),
        getZoomFactor: vitest_1.vi.fn().mockReturnValue(1),
        setVisualZoomLevelLimits: vitest_1.vi.fn().mockResolvedValue(undefined),
        isLoadingMainFrame: vitest_1.vi.fn().mockReturnValue(false),
    },
};
exports.BaseWindow = Object.assign(vitest_1.vi.fn().mockImplementation(function () {
    return {
        ..._mockBrowserWindowInstance,
        contentView: createMockContainerView(),
    };
}), {
    getAllWindows: vitest_1.vi.fn().mockReturnValue([]),
    getFocusedWindow: vitest_1.vi.fn().mockReturnValue(null),
});
exports.BrowserWindow = Object.assign(vitest_1.vi.fn().mockImplementation(function () {
    return _mockBrowserWindowInstance;
}), {
    getAllWindows: vitest_1.vi.fn().mockReturnValue([_mockBrowserWindowInstance]),
    getFocusedWindow: vitest_1.vi.fn().mockReturnValue(_mockBrowserWindowInstance),
    fromWebContents: vitest_1.vi.fn().mockReturnValue(null),
});
exports.View = vitest_1.vi.fn().mockImplementation(function () {
    return createMockContainerView();
});
let _nextMockWebContentsViewId = 10000;
exports.WebContentsView = vitest_1.vi.fn().mockImplementation(function () {
    const id = _nextMockWebContentsViewId++;
    let visible = true;
    let zoomFactor = 1;
    let bounds = { x: 0, y: 0, width: 0, height: 0 };
    return {
        webContents: {
            id,
            loadURL: vitest_1.vi.fn().mockResolvedValue(undefined),
            reload: vitest_1.vi.fn(),
            insertCSS: vitest_1.vi.fn().mockResolvedValue('mock-css-key'),
            removeInsertedCSS: vitest_1.vi.fn().mockResolvedValue(undefined),
            executeJavaScript: vitest_1.vi.fn().mockResolvedValue({ ok: true }),
            postMessage: vitest_1.vi.fn(),
            send: vitest_1.vi.fn(),
            on: vitest_1.vi.fn(),
            off: vitest_1.vi.fn(),
            once: vitest_1.vi.fn(),
            removeListener: vitest_1.vi.fn(),
            getType: vitest_1.vi.fn().mockReturnValue('window'),
            getURL: vitest_1.vi.fn().mockReturnValue('https://127.0.0.1:1234/'),
            setWebRTCIPHandlingPolicy: vitest_1.vi.fn(),
            setWindowOpenHandler: vitest_1.vi.fn(),
            setIgnoreMenuShortcuts: vitest_1.vi.fn(),
            setZoomMode: vitest_1.vi.fn(),
            getZoomLevel: vitest_1.vi.fn().mockReturnValue(0),
            setZoomLevel: vitest_1.vi.fn(),
            getZoomFactor: vitest_1.vi.fn(() => zoomFactor),
            setZoomFactor: vitest_1.vi.fn((next) => {
                zoomFactor = next;
            }),
            setVisualZoomLevelLimits: vitest_1.vi.fn().mockResolvedValue(undefined),
            toggleDevTools: vitest_1.vi.fn(),
            getOSProcessId: vitest_1.vi.fn().mockReturnValue(12345),
            isDestroyed: vitest_1.vi.fn().mockReturnValue(false),
            isLoadingMainFrame: vitest_1.vi.fn().mockReturnValue(false),
            close: vitest_1.vi.fn(),
            destroy: vitest_1.vi.fn(),
        },
        setBounds: vitest_1.vi.fn((next) => {
            bounds = { ...next };
        }),
        getBounds: vitest_1.vi.fn(() => ({ ...bounds })),
        setVisible: vitest_1.vi.fn((next) => {
            visible = Boolean(next);
        }),
        getVisible: vitest_1.vi.fn(() => visible),
        setBackgroundColor: vitest_1.vi.fn(),
    };
});
exports.MessageChannelMain = vitest_1.vi.fn().mockImplementation(function () {
    return {
        port1: {
            postMessage: vitest_1.vi.fn(),
            close: vitest_1.vi.fn(),
            on: vitest_1.vi.fn(),
            once: vitest_1.vi.fn(),
            start: vitest_1.vi.fn(),
        },
        port2: {
            postMessage: vitest_1.vi.fn(),
            close: vitest_1.vi.fn(),
            on: vitest_1.vi.fn(),
            once: vitest_1.vi.fn(),
            start: vitest_1.vi.fn(),
        },
    };
});
exports.dialog = {
    showErrorBox: vitest_1.vi.fn(),
    showMessageBox: vitest_1.vi.fn(),
    showOpenDialog: vitest_1.vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
};
exports.ipcMain = {
    handle: vitest_1.vi.fn(),
    removeHandler: vitest_1.vi.fn(),
    on: vitest_1.vi.fn(),
    removeListener: vitest_1.vi.fn(),
};
exports.protocol = {
    registerSchemesAsPrivileged: vitest_1.vi.fn(),
    handle: vitest_1.vi.fn(),
};
const _mockNativeImage = {
    setTemplateImage: vitest_1.vi.fn(),
};
exports.nativeImage = {
    createFromPath: vitest_1.vi.fn().mockReturnValue(_mockNativeImage),
    createFromBuffer: vitest_1.vi.fn().mockReturnValue({
        isEmpty: vitest_1.vi.fn().mockReturnValue(true),
    }),
};
exports.Tray = vitest_1.vi.fn().mockImplementation(function () {
    return {
        setToolTip: vitest_1.vi.fn(),
        setContextMenu: vitest_1.vi.fn(),
        on: vitest_1.vi.fn(),
        destroy: vitest_1.vi.fn(),
    };
});
exports.MenuItem = vitest_1.vi.fn().mockImplementation(function (options) {
    Object.assign(this, options);
});
const _mockMenuInstance = {
    items: [
        {
            label: 'File',
            submenu: {
                insert: vitest_1.vi.fn(),
            },
        },
    ],
    getMenuItemById: vitest_1.vi.fn().mockReturnValue({ label: '' }),
    popup: vitest_1.vi.fn(),
};
exports.Menu = Object.assign(vitest_1.vi.fn().mockImplementation(function () {
    this.items = [];
    this.append = (item) => {
        this.items.push(item);
    };
}), {
    buildFromTemplate: vitest_1.vi.fn().mockReturnValue(_mockMenuInstance),
    getApplicationMenu: vitest_1.vi.fn().mockReturnValue(_mockMenuInstance),
    setApplicationMenu: vitest_1.vi.fn(),
});
const _mockNotificationInstance = {
    show: vitest_1.vi.fn(),
    on: vitest_1.vi.fn(),
};
exports.Notification = Object.assign(vitest_1.vi.fn().mockImplementation(function () {
    return _mockNotificationInstance;
}), {
    // Static method
    isSupported: vitest_1.vi.fn().mockReturnValue(true),
    // Expose the mock instance for assertions
    _mockInstance: _mockNotificationInstance,
});
exports.shell = {
    openExternal: vitest_1.vi.fn().mockResolvedValue(undefined),
    openPath: vitest_1.vi.fn().mockResolvedValue(''),
    showItemInFolder: vitest_1.vi.fn(),
};
exports.systemPreferences = {
    getMediaAccessStatus: vitest_1.vi.fn().mockReturnValue('granted'),
    askForMediaAccess: vitest_1.vi.fn().mockResolvedValue(true),
};
exports.contextBridge = {
    exposeInMainWorld: vitest_1.vi.fn(),
};
exports.ipcRenderer = {
    invoke: vitest_1.vi.fn(),
    send: vitest_1.vi.fn(),
    on: vitest_1.vi.fn(),
    removeListener: vitest_1.vi.fn(),
    sendSync: vitest_1.vi.fn(),
};
exports.session = {
    defaultSession: {
        on: vitest_1.vi.fn(),
        setProxy: vitest_1.vi.fn().mockResolvedValue(undefined),
        closeAllConnections: vitest_1.vi.fn().mockResolvedValue(undefined),
        setCertificateVerifyProc: vitest_1.vi.fn(),
    },
    fromPartition: vitest_1.vi.fn().mockImplementation(() => {
        let preloadScripts = [];
        let legacyPreloads = [];
        return {
            on: vitest_1.vi.fn(),
            setProxy: vitest_1.vi.fn().mockResolvedValue(undefined),
            getPreloadScripts: vitest_1.vi.fn(() => [...preloadScripts]),
            registerPreloadScript: vitest_1.vi.fn((script) => {
                const id = script.id ?? `preload-${preloadScripts.length + 1}`;
                preloadScripts.push({
                    id,
                    filePath: script.filePath,
                    type: script.type,
                });
                return id;
            }),
            unregisterPreloadScript: vitest_1.vi.fn((id) => {
                preloadScripts = preloadScripts.filter((s) => s.id !== id);
            }),
            getPreloads: vitest_1.vi.fn(() => [...legacyPreloads]),
            setPreloads: vitest_1.vi.fn((preloads) => {
                legacyPreloads = [...preloads];
            }),
            setPermissionRequestHandler: vitest_1.vi.fn(),
            setPermissionCheckHandler: vitest_1.vi.fn(),
            webRequest: {
                onBeforeRequest: vitest_1.vi.fn(),
            },
            protocol: {
                handle: vitest_1.vi.fn(),
            },
        };
    }),
};
exports.webContents = {
    fromId: vitest_1.vi.fn(),
};
exports.webFrame = {
    executeJavaScript: vitest_1.vi.fn().mockResolvedValue(undefined),
    getZoomFactor: vitest_1.vi.fn().mockReturnValue(1),
};
const _mockDisplay = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1050 },
    workAreaSize: { width: 1920, height: 1050 },
    scaleFactor: 1,
};
exports.screen = {
    getAllDisplays: vitest_1.vi.fn().mockReturnValue([_mockDisplay]),
    getPrimaryDisplay: vitest_1.vi.fn().mockReturnValue(_mockDisplay),
    getDisplayMatching: vitest_1.vi.fn().mockReturnValue(_mockDisplay),
};
exports.webUtils = {
    getPathForFile: vitest_1.vi.fn().mockReturnValue('/mock/file/path'),
};
