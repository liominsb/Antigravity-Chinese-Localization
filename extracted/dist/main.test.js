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
const vitest_1 = require("vitest");
const helpers_1 = require("./test/helpers");
const constants_1 = require("./constants");
// Use the shared auto-mocks from __mocks__/
vitest_1.vi.mock('electron');
vitest_1.vi.mock('fs', () => ({
    existsSync: vitest_1.vi.fn(),
    readFileSync: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('crypto', () => ({
    randomUUID: vitest_1.vi.fn().mockReturnValue('mock-uuid'),
}));
vitest_1.vi.mock('./utils', () => ({
    sleep: vitest_1.vi.fn().mockResolvedValue(undefined),
    createWindow: vitest_1.vi.fn(),
    showOrCreateWindow: vitest_1.vi.fn(),
    ensureAppIsInDock: vitest_1.vi.fn(),
    isMacOS: vitest_1.vi.fn().mockReturnValue(true),
    showQuitConfirmation: false,
    setShowQuitConfirmation: vitest_1.vi.fn(),
    SleepBlocker: {
        getInstance: vitest_1.vi.fn().mockReturnValue({
            shouldKeepComputerAwake: vitest_1.vi.fn(),
        }),
    },
}));
vitest_1.vi.mock('./languageServer', () => ({
    LS_BINARY: '/mock/ls',
    getLsProcess: vitest_1.vi.fn(),
    clearLsProcess: vitest_1.vi.fn(),
    startLanguageServer: vitest_1.vi.fn(),
    killLanguageServer: vitest_1.vi.fn(),
    startAndMonitorLanguageServer: vitest_1.vi.fn(),
    setupLocalCertTrust: vitest_1.vi.fn(),
    getLsCL: vitest_1.vi.fn().mockResolvedValue('12345'),
}));
vitest_1.vi.mock('./updater', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        initAutoUpdater: vitest_1.vi.fn(),
    };
});
vitest_1.vi.mock('./ipcHandlers', () => ({
    registerIpcHandlers: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./tray', () => ({
    createTray: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./ideInstall', () => ({
    maybeShowIdeInstallWizard: vitest_1.vi.fn().mockResolvedValue('skipped'),
}));
(0, vitest_1.describe)('main', () => {
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.clearAllMocks();
        vitest_1.vi.resetModules();
        (0, helpers_1.silenceConsole)();
        const { app } = await Promise.resolve().then(() => __importStar(require('electron')));
        app.setAboutPanelOptions = vitest_1.vi.fn();
    });
    (0, vitest_1.it)('should initialize the app correctly on successful startup', async () => {
        const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
        const { createWindow } = await Promise.resolve().then(() => __importStar(require('./utils')));
        const { startAndMonitorLanguageServer } = await Promise.resolve().then(() => __importStar(require('./languageServer')));
        const { initAutoUpdater } = await Promise.resolve().then(() => __importStar(require('./updater')));
        const { createTray } = await Promise.resolve().then(() => __importStar(require('./tray')));
        const { app } = await Promise.resolve().then(() => __importStar(require('electron')));
        const { registerIpcHandlers } = await Promise.resolve().then(() => __importStar(require('./ipcHandlers')));
        const ACTUAL_PORT = 49152;
        vitest_1.vi.mocked(existsSync).mockReturnValue(true);
        vitest_1.vi.mocked(startAndMonitorLanguageServer).mockResolvedValue({
            port: ACTUAL_PORT,
            process: { pid: 1234 },
            exitPromise: new Promise(() => { }),
        });
        // Import main to trigger top-level registration
        await Promise.resolve().then(() => __importStar(require('./main')));
        // Trigger the whenReady callback
        const whenReadyCall = vitest_1.vi.mocked(app.whenReady).mock.results[0].value;
        await whenReadyCall.cb();
        (0, vitest_1.expect)(startAndMonitorLanguageServer).toHaveBeenCalledWith(constants_1.DYNAMIC_PORT, 'mock-uuid', vitest_1.expect.objectContaining({ headless: false }));
        (0, vitest_1.expect)(registerIpcHandlers).toHaveBeenCalled();
        (0, vitest_1.expect)(createWindow).toHaveBeenCalled();
        (0, vitest_1.expect)(createTray).toHaveBeenCalled();
        (0, vitest_1.expect)(initAutoUpdater).toHaveBeenCalled();
        (0, vitest_1.expect)(app.setAboutPanelOptions).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            applicationVersion: '1.0.0',
            version: '12345',
        }));
    });
    (0, vitest_1.it)('should quit if language server binary is missing', async () => {
        const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
        const { app, dialog } = await Promise.resolve().then(() => __importStar(require('electron')));
        vitest_1.vi.mocked(existsSync).mockReturnValue(false);
        await Promise.resolve().then(() => __importStar(require('./main')));
        const whenReadyCall = vitest_1.vi.mocked(app.whenReady).mock.results[0].value;
        await whenReadyCall.cb();
        (0, vitest_1.expect)(dialog.showErrorBox).toHaveBeenCalledWith('Binary not found', vitest_1.expect.stringContaining('language_server binary not found'));
        (0, vitest_1.expect)(app.quit).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should use dynamic port assignment (port 0) without port-conflict checks', async () => {
        const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
        const { createWindow } = await Promise.resolve().then(() => __importStar(require('./utils')));
        const { startAndMonitorLanguageServer } = await Promise.resolve().then(() => __importStar(require('./languageServer')));
        const { app } = await Promise.resolve().then(() => __importStar(require('electron')));
        // Simulate the OS assigning a random high port
        const OS_ASSIGNED_PORT = 63421;
        vitest_1.vi.mocked(existsSync).mockReturnValue(true);
        vitest_1.vi.mocked(startAndMonitorLanguageServer).mockResolvedValue({
            port: OS_ASSIGNED_PORT,
            process: { pid: 1234 },
            exitPromise: new Promise(() => { }),
        });
        await Promise.resolve().then(() => __importStar(require('./main')));
        const whenReadyCall = vitest_1.vi.mocked(app.whenReady).mock.results[0].value;
        await whenReadyCall.cb();
        // Verify port 0 (DYNAMIC_PORT) is passed — the OS picks the real port
        (0, vitest_1.expect)(startAndMonitorLanguageServer).toHaveBeenCalledWith(constants_1.DYNAMIC_PORT, 'mock-uuid', vitest_1.expect.objectContaining({ headless: false }));
        // Window should load the OS-assigned port, not a hardcoded one
        (0, vitest_1.expect)(createWindow).toHaveBeenCalledWith(`https://127.0.0.1:${OS_ASSIGNED_PORT}/`);
    });
    (0, vitest_1.it)('should quit on language server startup failure', async () => {
        const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
        const { startAndMonitorLanguageServer } = await Promise.resolve().then(() => __importStar(require('./languageServer')));
        const { app, dialog } = await Promise.resolve().then(() => __importStar(require('electron')));
        vitest_1.vi.mocked(existsSync).mockReturnValue(true);
        vitest_1.vi.mocked(startAndMonitorLanguageServer).mockRejectedValue(new Error('Timeout: language server did not report its port within 60s'));
        await Promise.resolve().then(() => __importStar(require('./main')));
        const whenReadyCall = vitest_1.vi.mocked(app.whenReady).mock.results[0].value;
        await whenReadyCall.cb();
        (0, vitest_1.expect)(dialog.showErrorBox).toHaveBeenCalledWith('Startup failed', vitest_1.expect.stringContaining('Timeout'));
        (0, vitest_1.expect)(app.quit).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should reload windows when onPortChanged is called', async () => {
        const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
        const { startAndMonitorLanguageServer } = await Promise.resolve().then(() => __importStar(require('./languageServer')));
        const { app, BrowserWindow } = await Promise.resolve().then(() => __importStar(require('electron')));
        vitest_1.vi.mocked(existsSync).mockReturnValue(true);
        let onPortChangedCallback;
        vitest_1.vi.mocked(startAndMonitorLanguageServer).mockImplementation(async (port, csrf, options) => {
            onPortChangedCallback = options?.onPortChanged;
            return {
                port: 49152,
                process: {
                    pid: 1234,
                },
                exitPromise: new Promise(() => { }),
            };
        });
        await Promise.resolve().then(() => __importStar(require('./main')));
        const whenReadyCall = vitest_1.vi.mocked(app.whenReady).mock.results[0].value;
        await whenReadyCall.cb();
        (0, vitest_1.expect)(onPortChangedCallback).toBeDefined();
        // Re-trigger port changed (simulating auto-restart event)
        const NEW_PORT = 50000;
        if (onPortChangedCallback) {
            onPortChangedCallback(NEW_PORT);
        }
        // Verify BrowserWindow instances are reloaded with new URL
        (0, vitest_1.expect)(BrowserWindow.getAllWindows).toHaveBeenCalled();
        const windows = vitest_1.vi.mocked(BrowserWindow.getAllWindows).mock.results[0]
            .value;
        (0, vitest_1.expect)(windows[0].loadURL).toHaveBeenCalledWith(`https://127.0.0.1:${NEW_PORT}/`);
    });
});
