"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ipcRenderer = exports.contextBridge = exports.shell = exports.Notification = exports.Menu = exports.MenuItem = exports.Tray = exports.nativeImage = exports.protocol = exports.ipcMain = exports.dialog = exports.WebContentsView = exports.BrowserWindow = exports.app = void 0;
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
    isPackaged: true,
    getAppPath: vitest_1.vi.fn().mockReturnValue('/mock/path'),
    getPath: vitest_1.vi.fn().mockReturnValue('/mock/user/data'),
    getVersion: vitest_1.vi.fn().mockReturnValue('1.0.0'),
    getName: vitest_1.vi.fn().mockReturnValue('App'),
    commandLine: {
        appendSwitch: vitest_1.vi.fn(),
        hasSwitch: vitest_1.vi.fn().mockReturnValue(false),
    },
    dock: {
        show: vitest_1.vi.fn(),
        setIcon: vitest_1.vi.fn(),
        setMenu: vitest_1.vi.fn(),
    },
    requestSingleInstanceLock: vitest_1.vi.fn().mockReturnValue(true),
    isDefaultProtocolClient: vitest_1.vi.fn().mockReturnValue(false),
    setAsDefaultProtocolClient: vitest_1.vi.fn().mockReturnValue(true),
    isReady: vitest_1.vi.fn().mockReturnValue(true),
    focus: vitest_1.vi.fn(),
};
const _mockBrowserWindowInstance = {
    loadURL: vitest_1.vi.fn(),
    once: vitest_1.vi.fn(),
    close: vitest_1.vi.fn(),
    show: vitest_1.vi.fn(),
    on: vitest_1.vi.fn(),
    off: vitest_1.vi.fn(),
    isDestroyed: vitest_1.vi.fn().mockReturnValue(false),
    getContentSize: vitest_1.vi.fn().mockReturnValue([1000, 800]),
    contentView: {
        addChildView: vitest_1.vi.fn(),
        removeChildView: vitest_1.vi.fn(),
    },
    webContents: {
        send: vitest_1.vi.fn(),
        on: vitest_1.vi.fn(),
        once: vitest_1.vi.fn(),
        setWindowOpenHandler: vitest_1.vi.fn(),
    },
};
exports.BrowserWindow = Object.assign(vitest_1.vi.fn().mockImplementation(function () {
    return _mockBrowserWindowInstance;
}), {
    getAllWindows: vitest_1.vi.fn().mockReturnValue([_mockBrowserWindowInstance]),
    getFocusedWindow: vitest_1.vi.fn().mockReturnValue(_mockBrowserWindowInstance),
});
exports.WebContentsView = vitest_1.vi.fn().mockImplementation(function () {
    return {
        webContents: {
            loadURL: vitest_1.vi.fn(),
        },
        setBounds: vitest_1.vi.fn(),
    };
});
exports.dialog = {
    showErrorBox: vitest_1.vi.fn(),
    showMessageBox: vitest_1.vi.fn(),
};
exports.ipcMain = {
    handle: vitest_1.vi.fn(),
    removeHandler: vitest_1.vi.fn(),
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
};
exports.Menu = {
    buildFromTemplate: vitest_1.vi.fn().mockReturnValue(_mockMenuInstance),
    getApplicationMenu: vitest_1.vi.fn().mockReturnValue(_mockMenuInstance),
    setApplicationMenu: vitest_1.vi.fn(),
};
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
};
exports.contextBridge = {
    exposeInMainWorld: vitest_1.vi.fn(),
};
exports.ipcRenderer = {
    invoke: vitest_1.vi.fn(),
    on: vitest_1.vi.fn(),
    removeListener: vitest_1.vi.fn(),
};
