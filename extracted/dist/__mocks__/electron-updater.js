"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoUpdater = exports.autoUpdaterEvents = void 0;
/**
 * Shared electron-updater mock for all test files.
 *
 * This file is automatically used by Vitest when a test calls
 * `vi.mock('electron-updater')` without a factory argument.
 *
 * The `autoUpdaterEvents` export allows tests to trigger event callbacks
 * that were registered via `autoUpdater.on(event, callback)`.
 */
const vitest_1 = require("vitest");
exports.autoUpdaterEvents = {};
exports.autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    forceDevUpdateConfig: false,
    updateConfigPath: '',
    on: vitest_1.vi.fn().mockImplementation((event, cb) => {
        exports.autoUpdaterEvents[event] = cb;
    }),
    checkForUpdates: vitest_1.vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vitest_1.vi.fn(),
};
