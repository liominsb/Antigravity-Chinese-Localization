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
exports.updateActions = exports.MenuUpdateStep = void 0;
exports.broadcastState = broadcastState;
exports.initAutoUpdater = initAutoUpdater;
exports.checkForUpdates = checkForUpdates;
exports.quitAndInstall = quitAndInstall;
const electron_updater_1 = require("electron-updater");
const electron_1 = require("electron");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
var MenuUpdateStep;
(function (MenuUpdateStep) {
    MenuUpdateStep["CheckForUpdates"] = "Check for Updates";
    MenuUpdateStep["CheckingForUpdates"] = "Checking for Updates...";
    MenuUpdateStep["DownloadingUpdate"] = "Downloading Update...";
    MenuUpdateStep["RestartToUpdate"] = "Restart to Update";
})(MenuUpdateStep || (exports.MenuUpdateStep = MenuUpdateStep = {}));
exports.updateActions = {
    [MenuUpdateStep.CheckForUpdates]: () => checkForUpdates(true),
    [MenuUpdateStep.CheckingForUpdates]: undefined,
    [MenuUpdateStep.DownloadingUpdate]: undefined,
    [MenuUpdateStep.RestartToUpdate]: () => quitAndInstall(),
};
// True if the last call to check for updates was from a user click in the menu.
let isManualCheck = false;
// How long to wait after app start before first update check (ms)
const INITIAL_CHECK_DELAY_MS = 10000; // 10 seconds
// How often to re-check for updates after the initial check (ms)
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
/** Broadcast a state change to every open BrowserWindow. */
function broadcastState(state) {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        win.webContents.send('updater:state-changed', state);
    }
}
/**
 * Updates the state of the menu item based on the current step of the updater.
 */
function updateMenuState(step) {
    const menu = electron_1.Menu.getApplicationMenu();
    if (menu) {
        const item = menu.getMenuItemById('check-for-updates');
        if (item) {
            item.label = step;
            item.enabled = exports.updateActions[step] !== undefined;
        }
    }
}
/**
 * Initializes the auto-updater and registers IPC handlers.
 * Call once after the first window is created.
 *
 * The updater will:
 * 1. Wait INITIAL_CHECK_DELAY_MS ms, then check for updates.
 * 2. Re-check every CHECK_INTERVAL_MS ms.
 * 3. Download updates automatically in the background.
 * 4. Broadcast state to the renderer so AppUpdateButton can display progress.
 */
function initAutoUpdater(isHeadless) {
    // In dev mode (npm start), electron-updater skips checks because the app
    // isn't packaged. Force it to use the dev config file instead.
    if (!electron_1.app.isPackaged) {
        electron_updater_1.autoUpdater.forceDevUpdateConfig = true;
        electron_updater_1.autoUpdater.updateConfigPath = path.join(electron_1.app.getAppPath(), 'dev-app-update.yml');
    }
    // Set the channel based on architecture and OS.
    // On Windows, we need to explicitly append '-win' to match the artifact name.
    // On macOS and linux, Electron automatically appends the OS to the channel name.
    if (process.platform === 'win32') {
        electron_updater_1.autoUpdater.channel = `latest-${process.arch}-win`;
    }
    else {
        electron_updater_1.autoUpdater.channel = `latest-${process.arch}`;
    }
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = electron_1.app.isPackaged;
    // Auto-updater event handlers → broadcast to renderer
    electron_updater_1.autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdater] Checking for update…');
        broadcastState({ type: 'checking for updates' });
        updateMenuState(MenuUpdateStep.CheckingForUpdates);
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        console.log(`[AutoUpdater] Update available: ${info.version}`);
        broadcastState({
            type: 'available for download',
            update: { version: info.version },
        });
        updateMenuState(MenuUpdateStep.DownloadingUpdate);
        isManualCheck = false;
    });
    electron_updater_1.autoUpdater.on('update-not-available', (info) => {
        console.log(`[AutoUpdater] Up to date (${info.version})`);
        broadcastState({ type: 'idle' });
        updateMenuState(MenuUpdateStep.CheckForUpdates);
        if (isManualCheck && !isHeadless) {
            const win = electron_1.BrowserWindow.getFocusedWindow();
            const options = {
                type: 'info',
                title: 'Check for Updates',
                message: 'No updates available',
                buttons: ['OK'],
            };
            if (win) {
                electron_1.dialog.showMessageBox(win, options);
            }
            else {
                electron_1.dialog.showMessageBox(options);
            }
        }
        isManualCheck = false;
    });
    electron_updater_1.autoUpdater.on('download-progress', () => {
        broadcastState({ type: 'downloading' });
        updateMenuState(MenuUpdateStep.DownloadingUpdate);
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        console.log(`[AutoUpdater] Update downloaded: ${info.version}`);
        if (isHeadless) {
            // Proceed to auto install in headless mode
            if (electron_1.app.isPackaged) {
                if (process.platform === 'linux') {
                    const downloadedFilePath = info.downloadedFile;
                    headlessQuitAndInstall(downloadedFilePath);
                }
                else {
                    electron_updater_1.autoUpdater.quitAndInstall();
                }
            }
            else {
                console.log('[AutoUpdater] Headless mode: Skipping quitAndInstall (not packaged).');
            }
            return;
        }
        broadcastState({
            type: 'ready',
            update: { version: info.version },
        });
        updateMenuState(MenuUpdateStep.RestartToUpdate);
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        console.error('[AutoUpdater] Error:', err.message);
        broadcastState({ type: 'idle' });
        updateMenuState(MenuUpdateStep.CheckForUpdates);
        isManualCheck = false;
    });
    // Schedule periodic checks
    setTimeout(() => {
        checkForUpdates();
        setInterval(checkForUpdates, CHECK_INTERVAL_MS);
    }, INITIAL_CHECK_DELAY_MS);
}
function checkForUpdates(isManual = false) {
    isManualCheck = isManual;
    electron_updater_1.autoUpdater.checkForUpdates().catch((err) => {
        console.error('[AutoUpdater] Failed to check for updates:', err.message);
    });
}
function quitAndInstall() {
    electron_updater_1.autoUpdater.quitAndInstall();
}
/**
 * Electron native quitAndInstall doesn't relaunch the app with command line arguments.
 * This function waits for the app process to quit, manually replaces the executable with
 * the downloaded update, and then relaunches it with the right headless flags.
 */
function headlessQuitAndInstall(downloadedFilePath) {
    console.log('[AutoUpdater] Headless mode: Scheduling post-quit restart.');
    try {
        const currentPid = process.pid;
        const appPath = process.env.APPIMAGE || process.execPath;
        const args = [
            '--ozone-platform=headless',
            '--headless',
            '--disable-gpu',
            '--no-sandbox',
        ];
        let script = '';
        if (downloadedFilePath) {
            console.log(`[AutoUpdater] Will manually replace ${appPath} with ${downloadedFilePath}`);
            script = `
        while kill -0 ${currentPid} 2>/dev/null; do sleep 0.5; done
        cp -f "${downloadedFilePath}" "${appPath}"
        chmod +x "${appPath}"
        "${appPath}" ${args.join(' ')}
      `;
        }
        else {
            console.warn('[AutoUpdater] No downloaded file path found, relaunching without update.');
            script = `
        while kill -0 ${currentPid} 2>/dev/null; do sleep 0.5; done
        sleep 3
        "${appPath}" ${args.join(' ')}
      `;
        }
        const child = (0, child_process_1.spawn)('sh', ['-c', script], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, ELECTRON_OZONE_PLATFORM_HINT: 'headless' },
        });
        child.unref();
    }
    catch (e) {
        console.error('[AutoUpdater] Failed to schedule restart:', e);
    }
    electron_1.app.quit();
}
