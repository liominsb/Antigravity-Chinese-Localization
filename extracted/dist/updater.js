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
exports.setAutoUpdateChecking = setAutoUpdateChecking;
exports.broadcastState = broadcastState;
exports.getLastState = getLastState;
exports.initAutoUpdater = initAutoUpdater;
exports.checkForUpdates = checkForUpdates;
exports.quitAndInstall = quitAndInstall;
exports.getHostUpdateStatus = getHostUpdateStatus;
exports.applyHostUpdate = applyHostUpdate;
const electron_updater_1 = require("electron-updater");
const electron_1 = require("electron");
const path = __importStar(require("path"));
const types_1 = require("./types");
const child_process_1 = require("child_process");
const settingsService_1 = require("./services/settingsService");
const utils_1 = require("./utils");
var MenuUpdateStep;
(function (MenuUpdateStep) {
    MenuUpdateStep["CheckForUpdates"] = "Check for Updates";
    MenuUpdateStep["CheckingForUpdates"] = "Checking for Updates...";
    MenuUpdateStep["DownloadingUpdate"] = "Downloading Update...";
    MenuUpdateStep["RestartToUpdate"] = "Restart to Update";
})(MenuUpdateStep || (exports.MenuUpdateStep = MenuUpdateStep = {}));
const MENU_UPDATE_STEP_LABELS = {
    [MenuUpdateStep.CheckForUpdates]: '检查更新',
    [MenuUpdateStep.CheckingForUpdates]: '正在检查更新...',
    [MenuUpdateStep.DownloadingUpdate]: '正在下载更新...',
    [MenuUpdateStep.RestartToUpdate]: '重启以应用更新',
};
exports.updateActions = {
    [MenuUpdateStep.CheckForUpdates]: () => checkForUpdates(true),
    '检查更新': () => checkForUpdates(true),
    [MenuUpdateStep.CheckingForUpdates]: undefined,
    '正在检查更新...': undefined,
    [MenuUpdateStep.DownloadingUpdate]: undefined,
    '正在下载更新...': undefined,
    [MenuUpdateStep.RestartToUpdate]: () => void quitAndInstall(),
    '重启以应用更新': () => void quitAndInstall(),
};
let installingUpdate = false;
// True if the last call to check for updates was from a user click in the menu.
let isManualCheck = false;
// How long to wait after app start before first update check (ms)
const INITIAL_CHECK_DELAY_MS = 10000; // 10 seconds
// How often to re-check for updates after the initial check (ms)
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
/**
 * States in which a newer version is known to exist. Anything else (idle,
 * checking for updates) means we have nothing newer to offer.
 */
const UPDATE_PENDING_STATES = new Set([
    types_1.UpdateState.AvailableForDownload,
    types_1.UpdateState.Downloading,
    types_1.UpdateState.Ready,
]);
let updaterInitialized = false;
let periodicCheckInterval;
function startAutoUpdateChecks() {
    if (periodicCheckInterval) {
        return;
    }
    console.log('[AutoUpdater] Starting auto update checks');
    checkForUpdates();
    periodicCheckInterval = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
function stopAutoUpdateChecks() {
    console.log('[AutoUpdater] Stopping auto update checks');
    if (periodicCheckInterval) {
        clearInterval(periodicCheckInterval);
        periodicCheckInterval = undefined;
    }
}
function setAutoUpdateChecking(enabled) {
    if (!updaterInitialized) {
        return;
    }
    if (enabled) {
        startAutoUpdateChecks();
    }
    else {
        stopAutoUpdateChecks();
    }
}
// The last update state broadcast to renderers.
let lastState = { type: types_1.UpdateState.Idle };
/** Broadcast a state change to every open Hub window. */
function broadcastState(state) {
    lastState = state;
    for (const win of (0, utils_1.getHubWindows)()) {
        const hubContents = (0, utils_1.getHubWebContents)(win);
        if (hubContents && !hubContents.isDestroyed?.()) {
            hubContents.send('updater:state-changed', state);
        }
    }
}
/**
 * Returns the last update state broadcast to renderers.
 */
function getLastState() {
    return lastState;
}
/**
 * Updates the state of the menu item based on the current step of the updater.
 */
function updateMenuState(step) {
    const menu = electron_1.Menu.getApplicationMenu();
    if (menu) {
        const item = menu.getMenuItemById('check-for-updates');
        if (item) {
            item.label = (typeof MENU_UPDATE_STEP_LABELS !== 'undefined' && MENU_UPDATE_STEP_LABELS[step]) || step;
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
function initAutoUpdater(isHeadless, settingsService) {
    installingUpdate = false;
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
        electron_updater_1.autoUpdater.disableWebInstaller = true;
        electron_updater_1.autoUpdater.disableDifferentialDownload = true;
    }
    else {
        electron_updater_1.autoUpdater.channel = `latest-${process.arch}`;
    }
    electron_updater_1.autoUpdater.requestHeaders = { 'x-app-version': electron_1.app.getVersion() };
    electron_updater_1.autoUpdater.autoDownload = true;
    // Silent `/S` NSIS install-on-quit skips ShutdownBlockReasonCreate and can
    // delete $INSTDIR if interrupted by OS shutdown or blocked by file locks.
    electron_updater_1.autoUpdater.autoInstallOnAppQuit =
        electron_1.app.isPackaged && process.platform !== 'win32';
    // Auto-updater event handlers → broadcast to renderer
    electron_updater_1.autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdater] Checking for update…');
        broadcastState({ type: types_1.UpdateState.CheckingForUpdates });
        updateMenuState(MenuUpdateStep.CheckingForUpdates);
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        console.log(`[AutoUpdater] Update available: ${info.version}`);
        broadcastState({
            type: types_1.UpdateState.AvailableForDownload,
            update: { version: info.version },
        });
        updateMenuState(MenuUpdateStep.DownloadingUpdate);
        isManualCheck = false;
    });
    electron_updater_1.autoUpdater.on('update-not-available', (info) => {
        console.log(`[AutoUpdater] Up to date (${info.version})`);
        broadcastState({ type: types_1.UpdateState.Idle });
        updateMenuState(MenuUpdateStep.CheckForUpdates);
        if (isManualCheck && !isHeadless) {
            const win = (0, utils_1.getFocusedHubWindow)() ?? (0, utils_1.getHubWindows)()[0];
            const options = {
                type: 'info',
                title: '检查更新',
                message: '当前已是最新版本，暂无可用更新。',
                buttons: ['确定'],
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
        broadcastState({ type: types_1.UpdateState.Downloading });
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
                    void quitAndInstall(true);
                }
            }
            else {
                console.log('[AutoUpdater] Headless mode: Skipping quitAndInstall (not packaged).');
            }
            return;
        }
        broadcastState({
            type: types_1.UpdateState.Ready,
            update: { version: info.version },
        });
        updateMenuState(MenuUpdateStep.RestartToUpdate);
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        console.error('[AutoUpdater] Error:', err.message);
        broadcastState({ type: types_1.UpdateState.Idle });
        updateMenuState(MenuUpdateStep.CheckForUpdates);
        isManualCheck = false;
    });
    // Schedule periodic checks if needed
    updaterInitialized = true;
    setTimeout(async () => {
        const autoCheckEnabled = await settingsService.getSetting(settingsService_1.SettingKey.AUTO_CHECK_FOR_UPDATES);
        setAutoUpdateChecking(autoCheckEnabled);
    }, INITIAL_CHECK_DELAY_MS);
    // Cancel or restart periodic checks on setting change
    settingsService.onSettingChanged(settingsService_1.SettingKey.AUTO_CHECK_FOR_UPDATES, (enabled) => {
        setAutoUpdateChecking(enabled);
    });
}
function checkForUpdates(isManual = false) {
    isManualCheck = isManual;
    electron_updater_1.autoUpdater.checkForUpdates().catch((err) => {
        console.error('[AutoUpdater] Failed to check for updates:', err.message);
    });
}
async function quitAndInstall(isSilent = false) {
    if (!electron_1.app.isPackaged) {
        console.log('[AutoUpdater] Skipping quitAndInstall (requires a packaged app).');
        return;
    }
    if (installingUpdate) {
        return;
    }
    const updater = electron_updater_1.autoUpdater;
    // On Windows, electron-updater spawns the NSIS installer before calling
    // app.quit(), so shut down the language server and its child tree first.
    if (process.platform === 'win32' && updater.installerPath) {
        installingUpdate = true;
        let launched = false;
        try {
            const { killLanguageServer } = await Promise.resolve().then(() => __importStar(require('./languageServer')));
            await killLanguageServer();
            electron_updater_1.autoUpdater.quitAndInstall(isSilent, true);
            launched = Boolean(updater.quitAndInstallCalled);
        }
        finally {
            if (!launched) {
                installingUpdate = false;
            }
        }
        return;
    }
    electron_updater_1.autoUpdater.quitAndInstall(isSilent, true);
}
/**
 * Builds the update status served to the language server over the loopback
 * host bridge server.
 *
 * This reads the cached state only — it never triggers a network check, so
 * polling it is cheap.
 *
 * Before the first check completes the cached state is 'idle' and no version
 * is known. In that case we report `latestVersion` as the running version
 * (rather than an empty string) so consumers can compare the two fields
 * without special-casing, together with `updateAvailable: false`.
 */
function getHostUpdateStatus() {
    const currentVersion = electron_1.app.getVersion();
    const state = getLastState();
    const knownVersion = state.update?.version;
    const updateAvailable = UPDATE_PENDING_STATES.has(state.type) && knownVersion !== undefined;
    return {
        currentVersion,
        latestVersion: updateAvailable ? knownVersion : currentVersion,
        updateAvailable,
    };
}
/**
 * Applies an update on behalf of the language server, mirroring what the
 * renderer bridge used to do.
 *
 * Returns true when the request moved an update forward: restarting into a
 * downloaded update, letting an in-flight download finish, or kicking off a
 * check (autoDownload is enabled, so a found update downloads by itself).
 * Returns false only when there is genuinely nothing we can do.
 */
function applyHostUpdate() {
    const state = getLastState();
    switch (state.type) {
        case types_1.UpdateState.Ready:
            // quitAndInstall is a no-op (and logs a warning) in an unpackaged dev
            // build, so don't claim we accepted it.
            if (!electron_1.app.isPackaged) {
                console.log('[AutoUpdater] Skipping quitAndInstall (requires a packaged app).');
                return false;
            }
            void quitAndInstall();
            return true;
        case types_1.UpdateState.AvailableForDownload:
        case types_1.UpdateState.Downloading:
            // Already downloading; it installs once the download completes.
            console.log('[AutoUpdater] Update already in progress.');
            return true;
        case types_1.UpdateState.CheckingForUpdates:
            // A check is in flight — starting another would race it.
            return true;
        default:
            // Nothing known yet. Kick off a check so an update can proceed.
            checkForUpdates();
            return true;
    }
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
