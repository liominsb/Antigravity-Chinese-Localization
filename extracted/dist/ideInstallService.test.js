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
// Use the shared auto-mocks from __mocks__/
vitest_1.vi.mock('electron');
// Mock electron-log
vitest_1.vi.mock('electron-log/main', () => ({
    default: {
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
    },
}));
// Mock fs
vitest_1.vi.mock('fs', () => ({
    existsSync: vitest_1.vi.fn(),
    mkdirSync: vitest_1.vi.fn(),
    createWriteStream: vitest_1.vi.fn(),
    unlinkSync: vitest_1.vi.fn(),
}));
// Mock fs/promises
vitest_1.vi.mock('fs/promises', () => ({
    cp: vitest_1.vi.fn().mockResolvedValue(undefined),
    mkdir: vitest_1.vi.fn().mockResolvedValue(undefined),
    rm: vitest_1.vi.fn().mockResolvedValue(undefined),
    rename: vitest_1.vi.fn().mockResolvedValue(undefined),
    readdir: vitest_1.vi.fn().mockResolvedValue(['Antigravity.app']),
    unlink: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
// Mock child_process (used by extractIde)
vitest_1.vi.mock('child_process', () => ({
    execFile: vitest_1.vi.fn(),
}));
// Mock storage
const mockStorageManager = {
    getItems: vitest_1.vi.fn(),
    updateItems: vitest_1.vi.fn(),
    onDidChange: vitest_1.vi.fn().mockReturnValue({ dispose: vitest_1.vi.fn() }),
};
(0, vitest_1.describe)('ideInstallService', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        vitest_1.vi.resetModules();
        (0, helpers_1.silenceConsole)();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.describe)('shouldShowIdeInstallWizard', () => {
        (0, vitest_1.it)('should return false if wizard was already shown', async () => {
            mockStorageManager.getItems.mockResolvedValue({
                'ide-install-wizard-shown': 'true',
            });
            const { shouldShowIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const result = await shouldShowIdeInstallWizard(mockStorageManager);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should return false if ~/.gemini/antigravity-ide already exists', async () => {
            const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            mockStorageManager.getItems.mockResolvedValue({});
            // First call: IDE_NEW_DATA_DIR exists
            vitest_1.vi.mocked(existsSync).mockReturnValue(true);
            const { shouldShowIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const result = await shouldShowIdeInstallWizard(mockStorageManager);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should return false if ~/.gemini/antigravity does not exist', async () => {
            const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            mockStorageManager.getItems.mockResolvedValue({});
            // Both dirs don't exist
            vitest_1.vi.mocked(existsSync).mockReturnValue(false);
            const { shouldShowIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const result = await shouldShowIdeInstallWizard(mockStorageManager);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should return true when all conditions are met', async () => {
            const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            mockStorageManager.getItems.mockResolvedValue({});
            // IDE_NEW_DATA_DIR does NOT exist (first call), IDE_OLD_DATA_DIR DOES exist (second call)
            vitest_1.vi.mocked(existsSync)
                .mockReturnValueOnce(false) // IDE_NEW_DATA_DIR
                .mockReturnValueOnce(true); // IDE_OLD_DATA_DIR
            const { shouldShowIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const result = await shouldShowIdeInstallWizard(mockStorageManager);
            (0, vitest_1.expect)(result).toBe(true);
        });
    });
    (0, vitest_1.describe)('getPlatformKey', () => {
        let originalPlatform;
        let originalArch;
        (0, vitest_1.beforeEach)(() => {
            originalPlatform = process.platform;
            originalArch = process.arch;
        });
        (0, vitest_1.afterEach)(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
                configurable: true,
            });
            Object.defineProperty(process, 'arch', {
                value: originalArch,
                configurable: true,
            });
        });
        (0, vitest_1.it)('should return just "darwin" on macOS x64', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'darwin',
                configurable: true,
            });
            Object.defineProperty(process, 'arch', {
                value: 'x64',
                configurable: true,
            });
            const { getPlatformKey } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            (0, vitest_1.expect)(getPlatformKey()).toBe('darwin');
        });
        (0, vitest_1.it)('should return "darwin-arm64" on macOS arm64', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'darwin',
                configurable: true,
            });
            Object.defineProperty(process, 'arch', {
                value: 'arm64',
                configurable: true,
            });
            const { getPlatformKey } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            (0, vitest_1.expect)(getPlatformKey()).toBe('darwin-arm64');
        });
        (0, vitest_1.it)('should return "win32-x64-user" on Windows x64', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'win32',
                configurable: true,
            });
            Object.defineProperty(process, 'arch', {
                value: 'x64',
                configurable: true,
            });
            const { getPlatformKey } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            (0, vitest_1.expect)(getPlatformKey()).toBe('win32-x64-user');
        });
        (0, vitest_1.it)('should return "linux-x64" on Linux x64', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                configurable: true,
            });
            Object.defineProperty(process, 'arch', {
                value: 'x64',
                configurable: true,
            });
            const { getPlatformKey } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            (0, vitest_1.expect)(getPlatformKey()).toBe('linux-x64');
        });
    });
    (0, vitest_1.describe)('getIdeInstallPath', () => {
        (0, vitest_1.it)('should return a non-empty install path', async () => {
            const { getIdeInstallPath } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const installPath = getIdeInstallPath();
            (0, vitest_1.expect)(installPath).toBeTruthy();
            (0, vitest_1.expect)(typeof installPath).toBe('string');
        });
    });
    (0, vitest_1.describe)('copyUserData', () => {
        (0, vitest_1.it)('should recursively copy source to destination', async () => {
            const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            const fsPromises = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            vitest_1.vi.mocked(existsSync).mockReturnValue(true);
            const { copyUserData } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            await copyUserData('/source', '/dest');
            (0, vitest_1.expect)(fsPromises.cp).toHaveBeenCalledWith('/source', '/dest', {
                recursive: true,
                force: true,
            });
        });
        (0, vitest_1.it)('should skip copy if source does not exist', async () => {
            const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            const fsPromises = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            vitest_1.vi.mocked(existsSync).mockReturnValue(false);
            const { copyUserData } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            await copyUserData('/nonexistent', '/dest');
            (0, vitest_1.expect)(fsPromises.cp).not.toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('maybeShowIdeInstallWizard', () => {
        (0, vitest_1.it)('should return false when conditions are not met', async () => {
            mockStorageManager.getItems.mockResolvedValue({
                'ide-install-wizard-shown': 'true',
            });
            const { maybeShowIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const result = await maybeShowIdeInstallWizard(mockStorageManager);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should copy to NEW and BACKUP dirs if conditions are met and source exists', async () => {
            const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            const fsPromises = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            mockStorageManager.getItems.mockResolvedValue({});
            vitest_1.vi.mocked(existsSync).mockImplementation((p) => {
                const pathStr = String(p);
                if (pathStr.endsWith('antigravity-ide')) {
                    return false;
                }
                if (pathStr.endsWith('antigravity-backup')) {
                    return false;
                }
                if (pathStr.endsWith('antigravity')) {
                    return true;
                }
                if (pathStr.endsWith('icon.png')) {
                    return true;
                }
                return false;
            });
            const { maybeShowIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const wizardPromise = maybeShowIdeInstallWizard(mockStorageManager);
            // Trigger ready-to-show to run the setup copying logic
            const { BrowserWindow } = await Promise.resolve().then(() => __importStar(require('electron')));
            const mockWindowInstance = vitest_1.vi.mocked(BrowserWindow).mock.results[0].value;
            const readyToShowHandler = vitest_1.vi.mocked(mockWindowInstance.once).mock.calls.find((call) => call[0] === 'ready-to-show')?.[1];
            if (readyToShowHandler) {
                await readyToShowHandler();
            }
            // Simulate complete to resolve the promise
            const { ipcMain } = await Promise.resolve().then(() => __importStar(require('electron')));
            const completeHandler = vitest_1.vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === 'wizard:complete');
            if (completeHandler) {
                await completeHandler[1]({}, false);
            }
            const result = await wizardPromise;
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(fsPromises.cp).toHaveBeenCalledTimes(2);
        });
    });
    (0, vitest_1.describe)('fetchIdeDownloadUrl', () => {
        (0, vitest_1.it)('should fetch the correct URL from the API', async () => {
            // Mock fetch
            const mockFetch = vitest_1.vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    url: 'https://edgedl.me.gvt1.com/edgedl/release2/antigravity/darwin-arm/Antigravity IDE.zip',
                }),
            });
            global.fetch = mockFetch;
            const { fetchIdeDownloadUrl } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const url = await fetchIdeDownloadUrl('darwin-arm64');
            (0, vitest_1.expect)(mockFetch).toHaveBeenCalledWith('https://antigravity-ide-auto-updater-974169037036.us-central1.run.app/api/update/darwin-arm64/stable/latest');
            (0, vitest_1.expect)(url).toBe('https://edgedl.me.gvt1.com/edgedl/release2/antigravity/darwin-arm/Antigravity IDE.zip');
        });
        (0, vitest_1.it)('should throw an error if the API request fails', async () => {
            const mockFetch = vitest_1.vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });
            global.fetch = mockFetch;
            const { fetchIdeDownloadUrl } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            await (0, vitest_1.expect)(fetchIdeDownloadUrl('darwin-arm64')).rejects.toThrow('Failed to fetch IDE download URL: 500 Internal Server Error');
        });
        (0, vitest_1.it)('should throw an error if the API response has no URL', async () => {
            const mockFetch = vitest_1.vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({}),
            });
            global.fetch = mockFetch;
            const { fetchIdeDownloadUrl } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            await (0, vitest_1.expect)(fetchIdeDownloadUrl('darwin-arm64')).rejects.toThrow('No download URL found in the auto-updater response for platform: darwin-arm64');
        });
    });
    (0, vitest_1.describe)('showIdeInstallWizard', () => {
        (0, vitest_1.it)('should create a BrowserWindow with correct options', async () => {
            const { BrowserWindow } = await Promise.resolve().then(() => __importStar(require('electron')));
            mockStorageManager.getItems.mockResolvedValue({});
            mockStorageManager.updateItems.mockResolvedValue(undefined);
            const { showIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            // Start the wizard but don't await — we'll resolve it via the mock
            const wizardPromise = showIdeInstallWizard();
            // Verify BrowserWindow was created with expected options
            (0, vitest_1.expect)(BrowserWindow).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
                width: 720,
                height: 580,
                resizable: false,
                titleBarStyle: 'hidden',
                backgroundColor: '#0D0D0D',
                webPreferences: vitest_1.expect.objectContaining({
                    nodeIntegration: false,
                    contextIsolation: true,
                }),
            }));
            // Simulate complete to resolve the promise
            const { ipcMain } = await Promise.resolve().then(() => __importStar(require('electron')));
            const completeHandler = vitest_1.vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === 'wizard:complete');
            if (completeHandler) {
                await completeHandler[1]({}, undefined);
            }
            const result = await wizardPromise;
            (0, vitest_1.expect)(result).toBeUndefined();
        });
        (0, vitest_1.it)('should start background download if shouldDownload is true when skipping', async () => {
            mockStorageManager.getItems.mockResolvedValue({});
            mockStorageManager.updateItems.mockResolvedValue(undefined);
            const serviceModule = await Promise.resolve().then(() => __importStar(require('./ideInstall/service')));
            const downloadSpy = vitest_1.vi
                .spyOn(serviceModule, 'downloadAndInstallIde')
                .mockResolvedValue(undefined);
            const { showIdeInstallWizard } = await Promise.resolve().then(() => __importStar(require('./ideInstall')));
            const wizardPromise = showIdeInstallWizard();
            // Simulate complete with shouldDownload = true
            const { ipcMain } = await Promise.resolve().then(() => __importStar(require('electron')));
            const completeHandler = vitest_1.vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === 'wizard:complete');
            if (completeHandler) {
                await completeHandler[1]({}, true);
            }
            const result = await wizardPromise;
            (0, vitest_1.expect)(result).toBeUndefined();
            (0, vitest_1.expect)(downloadSpy).toHaveBeenCalled();
        });
    });
});
