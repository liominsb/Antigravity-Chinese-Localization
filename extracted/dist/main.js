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
const electron_1 = require("electron");
const main_1 = __importDefault(require("electron-log/main"));
const ipcHandlers_1 = require("./ipcHandlers");
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const readline = __importStar(require("readline"));
const utils_1 = require("./utils");
const languageServer_1 = require("./languageServer");
const updater_1 = require("./updater");
const constants_1 = require("./constants");
const tray_1 = require("./tray");
const storage_1 = require("./storage");
const paths_1 = require("./paths");
const menu_1 = require("./menu");
const customScheme_1 = require("./customScheme");
const settingsService_1 = require("./services/settingsService");
const ideInstall_1 = require("./ideInstall");
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
    process.exit(0);
}
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let storageManager;
let settingsService;
let hasStartedMainApplication = false;
let isQuitting = false;
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Driven by ELECTRON_OZONE_PLATFORM_HINT=headless env var.
// This single env var both prevents GTK from crashing (Electron 33+)
// and tells our code to skip createWindow().
const HEADLESS = process.env.ELECTRON_OZONE_PLATFORM_HINT === 'headless';
// When set, skip LS startup and load this URL directly (for dev iteration).
const DEV_URL = process.env.DEV_URL;
if (HEADLESS) {
    electron_1.app.commandLine.appendSwitch('ozone-platform', 'headless');
    electron_1.app.commandLine.appendSwitch('headless');
    electron_1.app.commandLine.appendSwitch('disable-gpu');
    electron_1.app.commandLine.appendSwitch('no-sandbox');
}
if (!electron_1.app.commandLine.hasSwitch('remote-debugging-port')) {
    electron_1.app.commandLine.appendSwitch('remote-debugging-port', '0');
}
// ---------------------------------------------------------------------------
// Application Lifecycle
// ---------------------------------------------------------------------------
let pendingDeepLink = null;
function handleDeepLink(url) {
    const wins = electron_1.BrowserWindow.getAllWindows();
    // This block handles deep links when windows are already open.
    if (wins.length > 0) {
        if (wins[0].isMinimized()) {
            wins[0].restore();
        }
        wins[0].show();
        wins[0].focus();
        electron_1.app.focus({ steal: true });
        wins[0].webContents.send('deep-link', url);
    }
    else {
        pendingDeepLink = url;
    }
}
electron_1.app.on('second-instance', (event, commandLine) => {
    const wins = electron_1.BrowserWindow.getAllWindows();
    if (wins.length > 0) {
        if (wins[0].isMinimized()) {
            wins[0].restore();
        }
        wins[0].show();
        wins[0].focus();
        electron_1.app.focus({ steal: true });
    }
    const url = commandLine.find((arg) => arg.startsWith('antigravity://'));
    if (url) {
        handleDeepLink(url);
    }
});
(0, customScheme_1.registerCustomSchemes)();
// Register as default protocol client for deep linking
const PROTOCOL = 'antigravity';
if (!electron_1.app.isDefaultProtocolClient(PROTOCOL)) {
    electron_1.app.setAsDefaultProtocolClient(PROTOCOL);
}
electron_1.app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});
/**
 * App entry point. Runs once Electron has finished initializing.
 * Validates the LS binary, frees the port if needed, spawns the LS,
 * and opens the initial browser window.
 */
electron_1.app
    .whenReady()
    .then(async () => {
    // Initialize electron-log and override console
    main_1.default.initialize();
    Object.assign(console, main_1.default.functions);
    const storagePath = (0, paths_1.getAppStoragePath)();
    storageManager = new storage_1.StorageManager(storagePath, settingsService_1.DEFAULTS);
    settingsService = new settingsService_1.SettingsService(storageManager);
    // Handle deep link URL from command line arguments (All platforms)
    const deepLinkFromArg = process.argv.find((arg) => arg.startsWith('antigravity://'));
    if (deepLinkFromArg) {
        console.log('Launched with deep link:', deepLinkFromArg);
        pendingDeepLink = deepLinkFromArg;
    }
    // Register IPC handlers
    (0, ipcHandlers_1.registerIpcHandlers)(storageManager);
    electron_1.ipcMain.handle('deep-link:get-stored', () => {
        const link = pendingDeepLink;
        pendingDeepLink = null; // Clear after read
        return link;
    });
    // Handle requests coming from custom schemes
    (0, customScheme_1.registerCustomSchemeHandlers)();
    // Set About panel options with LS CL
    const cl = await (0, languageServer_1.getLsCL)();
    electron_1.app.setAboutPanelOptions({
        applicationName: 'Antigravity',
        applicationVersion: electron_1.app.getVersion(),
        version: cl || undefined,
    });
    // Pre-onboarding: check if we should offer to re-install the IDE.
    // This runs before the LS starts so we can show a standalone wizard.
    if (!HEADLESS) {
        await (0, ideInstall_1.maybeShowIdeInstallWizard)(storageManager);
    }
    if (DEV_URL) {
        console.log('Starting in dev mode with URL:', DEV_URL);
        (0, utils_1.createWindow)(DEV_URL);
        hasStartedMainApplication = true;
        return;
    }
    if (!fs.existsSync(languageServer_1.LS_BINARY)) {
        const msg = `language_server binary not found at:\n${languageServer_1.LS_BINARY}\n\nPlease build set a valid location.`;
        if (HEADLESS) {
            console.error('ERROR:', msg);
        }
        else {
            await electron_1.dialog.showErrorBox('Binary not found', msg);
        }
        electron_1.app.quit();
        return;
    }
    const csrf = crypto.randomUUID();
    console.log(`Starting app (v${electron_1.app.getVersion()}) with dynamic port…`);
    let handle;
    const targetPort = Number(process.env.JETSKI_LS_PORT) || constants_1.DYNAMIC_PORT;
    try {
        handle = await (0, languageServer_1.startAndMonitorLanguageServer)(targetPort, csrf, {
            headless: HEADLESS,
            onPortChanged: (newPort) => {
                const newUrl = `${constants_1.WINDOW_ORIGIN}:${newPort}/`;
                console.log(`[Auto-Restart] Port changed! Reloading all windows with URL: ${newUrl}`);
                // Apply cert trust
                (0, languageServer_1.setupLocalCertTrust)();
                if (!HEADLESS) {
                    const windows = electron_1.BrowserWindow.getAllWindows();
                    for (const win of windows) {
                        void win.loadURL(newUrl);
                    }
                }
            },
        });
    }
    catch (err) {
        const msg = err.message;
        if (HEADLESS) {
            console.error('Startup failed:', msg);
        }
        else {
            await electron_1.dialog.showErrorBox('Startup failed', msg);
        }
        electron_1.app.quit();
        return;
    }
    const url = `${constants_1.WINDOW_ORIGIN}:${handle.port}/`;
    console.log('\n' + '='.repeat(60));
    console.log(`  Local:       ${url}`);
    console.log(`  LS Logs:     ${(0, paths_1.getLsLogPath)()}`);
    console.log(`  Electron Logs: ${main_1.default.transports.file.getFile().path}`);
    console.log('='.repeat(60) + '\n');
    if (HEADLESS) {
        // In headless mode, forward stdin to the Language Server to allow interaction via terminal.
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.on('line', (line) => {
            const lsProc = (0, languageServer_1.getLsProcess)();
            if (lsProc && lsProc.stdin) {
                lsProc.stdin.write(line + '\n');
                console.log('-> Forwarded input to Language Server.');
            }
            else {
                console.log('Language Server process is not running.');
            }
        });
    }
    // Initial window — opened once after the LS has successfully started.
    if (!HEADLESS) {
        (0, menu_1.setupApplicationMenu)(url);
        (0, utils_1.createWindow)(url);
        if (electron_1.app.dock) {
            const dockMenu = electron_1.Menu.buildFromTemplate([
                {
                    label: 'New Window',
                    click: () => (0, utils_1.createWindow)(url),
                },
            ]);
            electron_1.app.dock.setMenu(dockMenu);
        }
        (0, tray_1.createTray)([
            {
                id: 'running-agents',
                label: 'No agents running',
                enabled: false,
            },
            { type: 'separator' },
            {
                label: `Open ${electron_1.app.getName()}`,
                click: () => (0, utils_1.showOrCreateWindow)((0, languageServer_1.getLsPort)()),
            },
            {
                label: 'Quit',
                click: () => {
                    // Triggers 'before-quit' to run graceful cleanup without confirmation.
                    electron_1.app.quit();
                },
            },
        ]);
    }
    // Start checking for app updates.
    (0, updater_1.initAutoUpdater)(HEADLESS);
    hasStartedMainApplication = true;
})
    .catch(() => {
    hasStartedMainApplication = true;
});
/**
 * Fired when all windows have been closed.
 * On macOS the app (and LS) stay alive so the user can re-open via the tray.
 * On all other platforms, shut down the LS and quit.
 */
electron_1.app.on('window-all-closed', async () => {
    if (isQuitting) {
        return;
    }
    if (!hasStartedMainApplication) {
        return;
    }
    const runInBackground = await settingsService.getSetting(settingsService_1.SettingKey.RUN_IN_BACKGROUND);
    if (!runInBackground) {
        // Triggers 'before-quit' to run graceful cleanup without confirmation.
        electron_1.app.quit();
    }
    else {
        electron_1.app.dock?.hide();
    }
});
/**
 * Fired just before the app quits (e.g. Cmd+Q on macOS, or after
 * window-all-closed on non-macOS). Ensures the LS is terminated even if
 * window-all-closed didn't handle it (e.g. on macOS quit via menu).
 */
electron_1.app.on('before-quit', async (event) => {
    if (isQuitting) {
        return;
    }
    if (!utils_1.showQuitConfirmation) {
        event.preventDefault();
        isQuitting = true;
        // Destroy all windows to terminate renderers and release keep-alive sockets
        const windows = electron_1.BrowserWindow.getAllWindows();
        for (const win of windows) {
            win.destroy();
        }
        // Close all active connections and kill the language server in parallel
        await Promise.all([
            electron_1.session.defaultSession.closeAllConnections().catch((err) => {
                console.error('Failed to close session connections:', err);
            }),
            (0, languageServer_1.killLanguageServer)(),
        ]);
        electron_1.app.quit();
        return;
    }
    // Show a confirmation dialog before quitting
    event.preventDefault();
    const win = electron_1.BrowserWindow.getFocusedWindow() || electron_1.BrowserWindow.getAllWindows()[0];
    const options = {
        type: 'question',
        buttons: ['Cancel', 'Quit'],
        defaultId: 1,
        cancelId: 0,
        title: 'Confirm Quit',
        message: 'Are you sure you want to quit?',
        detail: 'There may be agents or background tasks running.',
    };
    (0, utils_1.setShowQuitConfirmation)(false);
    if (win) {
        void electron_1.dialog.showMessageBox(win, options).then((result) => {
            if (result.response === 1) {
                // Quit - this will retrigger 'before-quit'
                electron_1.app.quit();
            }
        });
    }
});
/**
 * Fired when the app is re-activated (e.g. clicking the dock icon on macOS).
 * Re-opens a window if none are currently open.
 */
electron_1.app.on('activate', () => {
    // On Mac, re-open a window when the user clicks the dock
    // icon and no windows are open.
    if (!HEADLESS && electron_1.BrowserWindow.getAllWindows().length === 0) {
        const url = DEV_URL ?? `${constants_1.WINDOW_ORIGIN}:${(0, languageServer_1.getLsPort)()}/`;
        (0, utils_1.createWindow)(url);
    }
});
