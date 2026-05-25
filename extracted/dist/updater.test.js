"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const updater_1 = require("./updater");
const electron_updater_1 = require("electron-updater");
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const electron_updater_2 = require("./__mocks__/electron-updater");
// Use shared auto-mocks from __mocks__/
vitest_1.vi.mock('electron');
vitest_1.vi.mock('electron-updater');
vitest_1.vi.mock('child_process', () => ({
    spawn: vitest_1.vi.fn(() => ({
        unref: vitest_1.vi.fn(),
    })),
}));
(0, vitest_1.describe)('updater', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks(); // Clear mock history before each test
        vitest_1.vi.useFakeTimers();
    });
    (0, vitest_1.it)('should register IPC handlers and updater events on init', () => {
        (0, updater_1.initAutoUpdater)(false);
        // Verify autoUpdater events were registered
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.on).toHaveBeenCalledWith('checking-for-update', vitest_1.expect.any(Function));
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.on).toHaveBeenCalledWith('update-available', vitest_1.expect.any(Function));
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.on).toHaveBeenCalledWith('update-not-available', vitest_1.expect.any(Function));
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.on).toHaveBeenCalledWith('download-progress', vitest_1.expect.any(Function));
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.on).toHaveBeenCalledWith('update-downloaded', vitest_1.expect.any(Function));
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.on).toHaveBeenCalledWith('error', vitest_1.expect.any(Function));
    });
    (0, vitest_1.it)('should schedule an update check', () => {
        (0, updater_1.initAutoUpdater)(false);
        // Fast-forward the 10-second delay
        vitest_1.vi.advanceTimersByTime(10000);
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.checkForUpdates).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should auto-install on update-downloaded in headless mode (packaged)', () => {
        (0, updater_1.initAutoUpdater)(true);
        const callback = electron_updater_2.autoUpdaterEvents['update-downloaded'];
        (0, vitest_1.expect)(callback).toBeDefined();
        callback({ version: '1.2.3' });
        if (process.platform === 'linux') {
            (0, vitest_1.expect)(child_process_1.spawn).toHaveBeenCalled();
            (0, vitest_1.expect)(electron_1.app.quit).toHaveBeenCalled();
            (0, vitest_1.expect)(electron_updater_1.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
        }
        else {
            (0, vitest_1.expect)(electron_updater_1.autoUpdater.quitAndInstall).toHaveBeenCalled();
        }
        (0, vitest_1.expect)(electron_1.BrowserWindow.getAllWindows).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('should prompt the user on update-downloaded in normal mode (packaged)', () => {
        (0, updater_1.initAutoUpdater)(false);
        const callback = electron_updater_2.autoUpdaterEvents['update-downloaded'];
        (0, vitest_1.expect)(callback).toBeDefined();
        callback({ version: '1.2.3' });
        (0, vitest_1.expect)(electron_updater_1.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
        const win = vitest_1.vi.mocked(electron_1.BrowserWindow.getAllWindows).mock.results[0].value[0];
        (0, vitest_1.expect)(win.webContents.send).toHaveBeenCalledWith('updater:state-changed', {
            type: 'ready',
            update: { version: '1.2.3' },
        });
    });
    (0, vitest_1.it)('should show modal on update-not-available if manual check', () => {
        (0, updater_1.initAutoUpdater)(false);
        (0, updater_1.checkForUpdates)(true);
        const callback = electron_updater_2.autoUpdaterEvents['update-not-available'];
        (0, vitest_1.expect)(callback).toBeDefined();
        callback({ version: '1.0.0' });
        (0, vitest_1.expect)(electron_1.dialog.showMessageBox).toHaveBeenCalledWith(vitest_1.expect.anything(), vitest_1.expect.objectContaining({
            message: 'No updates available',
        }));
    });
    (0, vitest_1.it)('should NOT show modal on update-not-available if periodic check', () => {
        (0, updater_1.initAutoUpdater)(false);
        (0, updater_1.checkForUpdates)(false);
        const callback = electron_updater_2.autoUpdaterEvents['update-not-available'];
        (0, vitest_1.expect)(callback).toBeDefined();
        callback({ version: '1.0.0' });
        (0, vitest_1.expect)(electron_1.dialog.showMessageBox).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('should NOT show modal on update-not-available if manual check in headless mode', () => {
        (0, updater_1.initAutoUpdater)(true);
        (0, updater_1.checkForUpdates)(true);
        const callback = electron_updater_2.autoUpdaterEvents['update-not-available'];
        (0, vitest_1.expect)(callback).toBeDefined();
        callback({ version: '1.0.0' });
        (0, vitest_1.expect)(electron_1.dialog.showMessageBox).not.toHaveBeenCalled();
    });
});
