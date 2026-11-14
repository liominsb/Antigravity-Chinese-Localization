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
const cablev2_1 = require("./cablev2");
const wcvBrowserRegistry_1 = require("./wcvBrowserRegistry");
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const readline = __importStar(require("readline"));
const utils_1 = require("./utils");
const languageServer_1 = require("./languageServer");
const updater_1 = require("./updater");
const hostBridgeServer_1 = require("./hostBridgeServer");
const constants_1 = require("./constants");
const tray_1 = require("./tray");
const storage_1 = require("./storage");
const deviceChooser_1 = require("./deviceChooser");
const paths_1 = require("./paths");
const menu_1 = require("./menu");
const customScheme_1 = require("./customScheme");
const settingsService_1 = require("./services/settingsService");
const ideInstall_1 = require("./ideInstall");
const provisionSplash_1 = require("./provisionSplash");
const path = __importStar(require("path"));
const wsl_1 = require("./wsl");
const beyondcorpPac_1 = require("./beyondcorpPac");
const scriptJail_1 = require("./scriptJail");
const webauthn_1 = require("./webauthn");
const guestPromptController_1 = require("./guestPromptController");
const webviewBrowser_1 = require("./webviewBrowser");
const windowState_1 = require("./windowState");
const browserEngine_1 = require("./browserEngine/browserEngine");
const remoteWindowSecurity_1 = require("./remote/remoteWindowSecurity");
const hostStores_1 = require("./remote/hostStores");
const remoteManager_1 = require("./remote/remoteManager");
const sshBridge_1 = require("./remote/sshBridge");
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
// Loopback HTTP server the language server uses to read update status and
// request an update. Kept at module scope so it is not garbage collected.
let hostBridgeServer;
let remoteManager;
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Driven by ELECTRON_OZONE_PLATFORM_HINT=headless env var.
// This single env var both prevents GTK from crashing (Electron 33+)
// and tells our code to skip createWindow().
const HEADLESS = process.env.ELECTRON_OZONE_PLATFORM_HINT === 'headless';
// When set, skip LS startup and load this URL directly (for dev iteration).
const DEV_URL = process.env.DEV_URL;
const IS_INSIDERS = electron_1.app.getName().toLowerCase().includes('insiders');
// WSL distro to provision and launch the LS in (Windows only, '' = local).
// Precedence: --wsl-distro switch (empty value forces local) >
// ANTIGRAVITY_WSL_DISTRO env var > distro persisted from the last session.
function resolveStartupWslDistro() {
    if (process.platform !== 'win32') {
        return '';
    }
    if (electron_1.app.commandLine.hasSwitch('wsl-distro')) {
        return electron_1.app.commandLine.getSwitchValue('wsl-distro');
    }
    return (process.env.ANTIGRAVITY_WSL_DISTRO ||
        (0, wsl_1.readPersistedWslDistro)(path.join(electron_1.app.getPath('userData'), wsl_1.WSL_STATE_FILE)));
}
let WSL_DISTRO = resolveStartupWslDistro();
if (!DEV_URL) {
    (0, languageServer_1.prefetchShellEnv)();
}
/** True if `distro` is currently registered in WSL (false on wsl.exe errors). */
async function wslDistroExists(distro) {
    try {
        return (await (0, wsl_1.listWslDistros)()).some((d) => d.name === distro);
    }
    catch (err) {
        console.error('[WSL] Failed to list distros:', err);
        return false;
    }
}
if (HEADLESS) {
    electron_1.app.commandLine.appendSwitch('ozone-platform', 'headless');
    electron_1.app.commandLine.appendSwitch('headless');
    electron_1.app.commandLine.appendSwitch('disable-gpu');
    electron_1.app.commandLine.appendSwitch('no-sandbox');
}
if (!electron_1.app.commandLine.hasSwitch('remote-debugging-port')) {
    electron_1.app.commandLine.appendSwitch('remote-debugging-port', '0');
}
electron_1.app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
electron_1.app.commandLine.appendSwitch('disable-features', 'FedCm');
// Hidden built-in browser tabs stay attached under an opaque curtain view
// (see WcvBrowserRegistry). Without these switches Chromium treats them as
// occluded, stops producing frames, and capturePage() returns nothing. They are
// unconditional because the renderer may switch to the WebContentsView browser
// at any time, after these startup-only switches can no longer be changed.
// `disable-features` keeps only its last value, so merge with any earlier one.
const disabledFeatures = electron_1.app.commandLine.getSwitchValue('disable-features');
electron_1.app.commandLine.appendSwitch('disable-features', [disabledFeatures, 'CalculateNativeWinOcclusion'].filter(Boolean).join(','));
electron_1.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// ---------------------------------------------------------------------------
// Application Lifecycle
// ---------------------------------------------------------------------------
let pendingDeepLink = null;
function handleDeepLink(url) {
    // Deep links can carry auth codes: never to an SSH window.
    const wins = (0, utils_1.getLocalHubWindows)();
    // This block handles deep links when windows are already open.
    if (wins.length > 0) {
        if (wins[0].isMinimized()) {
            wins[0].restore();
        }
        wins[0].show();
        wins[0].focus();
        electron_1.app.focus({ steal: true });
        const hubContents = (0, utils_1.getHubWebContents)(wins[0]);
        if (!hubContents ||
            hubContents.isDestroyed?.() ||
            hubContents.isLoadingMainFrame?.()) {
            // The window is still loading (e.g. it was just created by
            // `second-instance`), so the renderer has not subscribed to 'deep-link'
            // yet and the IPC message would be dropped. Store the link instead; the
            // renderer reads it via 'deep-link:get-stored' once it mounts.
            pendingDeepLink = url;
        }
        else {
            hubContents.send('deep-link', url);
        }
    }
    else {
        pendingDeepLink = url;
        // No local window (maybe only SSH windows): open one to take the link.
        if (!HEADLESS && hasStartedMainApplication) {
            (0, utils_1.createWindow)(DEV_URL ?? `${constants_1.WINDOW_ORIGIN}:${(0, languageServer_1.getLsPort)()}/`, storageManager);
            electron_1.app.focus({ steal: true });
        }
    }
}
const PROTOCOL = electron_1.app
    .getName()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
// When running unpackaged (`npm start` / `electron .`), process.execPath is
// the stock Electron binary, so the app path must be registered too or the OS
// would launch bare Electron for deep links. Only Windows uses these args.
const protocolClientArgs = process.defaultApp && process.argv.length >= 2
    ? [process.execPath, [path.resolve(process.argv[1])]]
    : [];
if (!electron_1.app.isDefaultProtocolClient(PROTOCOL, ...protocolClientArgs)) {
    electron_1.app.setAsDefaultProtocolClient(PROTOCOL, ...protocolClientArgs);
}
electron_1.app.on('second-instance', (_event, commandLine) => {
    if (!HEADLESS && hasStartedMainApplication) {
        (0, utils_1.showOrCreateWindow)((0, languageServer_1.getLsPort)());
        electron_1.app.focus({ steal: true });
    }
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
        handleDeepLink(url);
    }
    else if (hasStartedMainApplication) {
        // Not before: the IDE install wizard may be open.
        openSshHostFromArgs(commandLine);
    }
});
const SSH_HOST_SWITCH = '--ssh-host=';
function sshHostFromArgs(argv) {
    const arg = argv.find((a) => a.startsWith(SSH_HOST_SWITCH));
    // '||': an empty value means unset.
    return arg?.slice(SSH_HOST_SWITCH.length).trim() || undefined;
}
/** Opens `--ssh-host`'s window; a failure shows on the local window. */
function openSshHostFromArgs(argv) {
    // Deep links take precedence over --ssh-host (both on cold start and
    // second-instance) so protocol launches cannot carry an SSH destination.
    if (argv.some((a) => a.startsWith(`${PROTOCOL}://`))) {
        return;
    }
    const host = sshHostFromArgs(argv);
    if (!host || isQuitting || !remoteManager) {
        return;
    }
    if (HEADLESS) {
        console.log('[SSH] Ignoring --ssh-host: this Hub is headless.');
        return;
    }
    // Opened at startup or by the second launch.
    const [parent] = (0, utils_1.getLocalHubWindows)();
    if (parent) {
        void remoteManager.openFromCommandLine(host, parent);
    }
}
(0, customScheme_1.registerCustomSchemes)();
electron_1.app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});
electron_1.app.on('session-created', (targetSession) => {
    if ((0, scriptJail_1.isScriptJailSession)(targetSession)) {
        return;
    }
    (0, webauthn_1.configureSessionWebAuthn)(targetSession);
    (0, guestPromptController_1.configureSessionPromptPreload)(targetSession);
});
electron_1.app.on('web-contents-created', (_event, contents) => {
    // Not SSH sessions: the setup below would undo their hardening (e.g. re-add
    // the session preloads it removed).
    if ((0, scriptJail_1.isScriptJailSession)(contents.session) ||
        (0, remoteWindowSecurity_1.isRemoteSession)(contents.session)) {
        return;
    }
    (0, deviceChooser_1.configureSessionDeviceChooser)(contents.session);
    (0, webauthn_1.configureSessionWebAuthn)(contents.session);
    (0, guestPromptController_1.configureSessionPromptPreload)(contents.session);
    if (contents.getType() !== 'webview') {
        return;
    }
    (0, webauthn_1.attachWebviewWebAuthnUserActivationTracking)(contents);
    (0, webviewBrowser_1.configureWebviewBrowserContents)(contents);
    void (0, beyondcorpPac_1.configureWebviewSessionProxy)(contents.session);
});
/**
 * App entry point. Runs once Electron has finished initializing.
 * Validates the LS binary, frees the port if needed, spawns the LS,
 * and opens the initial browser window.
 */
electron_1.app
    .whenReady()
    .then(async () => {
    // Initialize electron-log on the default window session only so browser
    // <webview> partitions do not inherit the electron-log-preload script.
    main_1.default.initialize({
        includeFutureSession: false,
        includeFutureSessions: false,
    });
    Object.assign(console, main_1.default.functions);
    (0, paths_1.tightenActivePortPermissions)(electron_1.app.getPath('userData'), (0, paths_1.getActivePortFilePath)());
    const storagePath = (0, paths_1.getAppStoragePath)();
    // SSH windows hear only this store's app settings (hosts have their own).
    storageManager = new storage_1.StorageManager(storagePath, settingsService_1.DEFAULTS, hostStores_1.mainStoreScope);
    settingsService = new settingsService_1.SettingsService(storageManager);
    // Handle deep link URL from command line arguments (All platforms)
    const deepLinkFromArg = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (deepLinkFromArg) {
        console.log('Launched with deep link:', deepLinkFromArg);
        pendingDeepLink = deepLinkFromArg;
    }
    remoteManager = new remoteManager_1.RemoteManager({
        mainStorage: storageManager,
        appVersion: electron_1.app.getVersion(),
        isInsiders: IS_INSIDERS,
        openLocalWindow: () => {
            (0, utils_1.createWindow)(DEV_URL ?? `${constants_1.WINDOW_ORIGIN}:${(0, languageServer_1.getLsPort)()}/`, storageManager, { cascade: true });
        },
    });
    (0, sshBridge_1.registerSshBridgeIpc)(remoteManager);
    // Register IPC handlers. SSH windows get their host's store.
    const hostStores = new hostStores_1.HostStores(electron_1.app.getPath('userData'), storageManager);
    (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {
        resolveStorage: (sender) => hostStores.forSender(sender),
        sidecarRoutesFor: (sender) => remoteManager?.sidecarRoutesFor(sender),
    });
    electron_1.ipcMain.handle('deep-link:get-stored', (event) => {
        if ((0, remoteWindowSecurity_1.isRemoteContents)(event?.sender)) {
            return null; // Deep links are for local windows only.
        }
        const link = pendingDeepLink;
        pendingDeepLink = null; // Clear after read
        return link;
    });
    // Handle requests coming from custom schemes
    (0, customScheme_1.registerCustomSchemeHandlers)();
    // Set About panel options with LS CL. Not awaited: `--stamp` runs the LS
    // binary, which would otherwise delay the real LS spawn.
    electron_1.app.setAboutPanelOptions({ applicationVersion: electron_1.app.getVersion() });
    void (0, languageServer_1.getLsCL)().then((cl) => {
        if (cl) {
            electron_1.app.setAboutPanelOptions({
                applicationVersion: electron_1.app.getVersion(),
                version: cl,
            });
        }
    });
    // Pre-onboarding: check if we should offer to re-install the IDE.
    // This runs before the LS starts so we can show a standalone wizard.
    if (!HEADLESS) {
        await (0, ideInstall_1.maybeShowIdeInstallWizard)(storageManager);
    }
    // Pre-configure the BeyondCorp PAC proxy on known <webview> partitions
    // before any BrowserWindow or <webview> is created so the first shortlink
    // navigation never races an in-flight setProxy call.
    await (0, beyondcorpPac_1.preconfigureWebviewPartitionProxies)();
    // Configure macOS caBLEv2 WebAuthn IPC handlers and attach the WebAuthn
    // account chooser to the default session before any BrowserWindow or
    // <webview> is created.
    (0, webauthn_1.configurePlatformWebAuthn)({
        registerCableIpc: () => (0, cablev2_1.registerCableWebAuthnIpcHandlers)({
            resolveWcvTab: (id) => wcvBrowserRegistry_1.wcvBrowserRegistry.resolveDeviceChooserHost(id),
        }),
    });
    (0, webauthn_1.configureSessionWebAuthn)(electron_1.session.defaultSession);
    if (DEV_URL) {
        console.log('Starting in dev mode with URL:', DEV_URL);
        (0, utils_1.createWindow)(DEV_URL, storageManager);
        hasStartedMainApplication = true;
        openSshHostFromArgs(process.argv);
        return;
    }
    if (!WSL_DISTRO && !fs.existsSync(languageServer_1.LS_BINARY)) {
        const msg = `language_server binary not found at:\n${languageServer_1.LS_BINARY}\n\nPlease build set a valid location.`;
        if (HEADLESS) {
            console.error('ERROR:', msg);
        }
        else {
            await electron_1.dialog.showErrorBox('未找到核心二进制组件', msg);
        }
        electron_1.app.quit();
        return;
    }
    // In WSL mode, make sure the matching server version is installed in the
    // distro before launching.
    let wslOptions;
    if (WSL_DISTRO && !(await wslDistroExists(WSL_DISTRO))) {
        // The distro was removed since the last session (e.g. `wsl
        // --unregister`). Open locally instead of failing provisioning.
        console.warn(`[WSL] Distro "${WSL_DISTRO}" is not installed; opening locally instead.`);
        (0, wsl_1.persistWslDistro)(path.join(electron_1.app.getPath('userData'), wsl_1.WSL_STATE_FILE), '');
        if (!HEADLESS) {
            void electron_1.dialog.showMessageBox({
                type: 'warning',
                title: '未找到 WSL 发行版',
                message: `WSL 发行版 "${WSL_DISTRO}" 已不再安装。`,
                detail: 'Antigravity 已改为在 Windows 本地打开。',
            });
        }
        WSL_DISTRO = '';
    }
    if (WSL_DISTRO) {
        (0, wsl_1.setActiveWslDistro)(WSL_DISTRO);
        // Created lazily on the first status update, so it only appears when
        // provisioning actually has work to do (first launch per version).
        let splash;
        try {
            const binaryPath = await (0, wsl_1.ensureServerInstalled)(WSL_DISTRO, electron_1.app.getVersion(), IS_INSIDERS, (status) => {
                if (!HEADLESS) {
                    splash ?? (splash = (0, provisionSplash_1.createProvisionSplash)(WSL_DISTRO));
                    splash.setStatus(status);
                }
            });
            wslOptions = { distro: WSL_DISTRO, binaryPath };
        }
        catch (err) {
            const msg = `Failed to install the server into WSL distro "${WSL_DISTRO}":\n${err.message}`;
            (0, wsl_1.persistWslDistro)(path.join(electron_1.app.getPath('userData'), wsl_1.WSL_STATE_FILE), '');
            if (HEADLESS) {
                console.error('ERROR:', msg);
            }
            else {
                await electron_1.dialog.showErrorBox('WSL 配置失败', msg);
            }
            electron_1.app.quit();
            return;
        }
        finally {
            splash?.close();
        }
    }
    const csrf = crypto.randomUUID();
    console.log(`Starting app (v${electron_1.app.getVersion()}) with dynamic port…`);
    // Start the host bridge server before the LS so we can hand it the URL
    // and token. This lives in the main process (not the renderer) so it stays
    // up in headless mode and after every window has been closed. It uses its
    // own token — the renderer's CSRF token must not unlock ApplyUpdate.
    try {
        hostBridgeServer = await (0, hostBridgeServer_1.startHostBridgeServer)({
            getUpdateStatus: updater_1.getHostUpdateStatus,
            applyUpdate: updater_1.applyHostUpdate,
        });
        console.log(`Host bridge server listening on ${hostBridgeServer.url}`);
    }
    catch (err) {
        // Non-fatal: the app is still usable, the LS just can't drive updates.
        console.error('Failed to start host bridge server:', err.message);
    }
    let handle;
    const targetPort = Number(process.env.JETSKI_LS_PORT) || constants_1.DYNAMIC_PORT;
    try {
        handle = await (0, languageServer_1.startAndMonitorLanguageServer)(targetPort, csrf, {
            headless: HEADLESS,
            wsl: wslOptions,
            hostBridgeUrl: hostBridgeServer?.url,
            hostBridgeToken: hostBridgeServer?.token,
            onPortChanged: (newPort) => {
                const newUrl = `${constants_1.WINDOW_ORIGIN}:${newPort}/`;
                console.log(`[Auto-Restart] Port changed! Reloading all windows with URL: ${newUrl}`);
                // Apply cert trust
                (0, languageServer_1.setupLocalCertTrust)();
                if (!HEADLESS) {
                    const windows = (0, utils_1.getLocalHubWindows)();
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
            await electron_1.dialog.showErrorBox('启动失败', msg);
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
        (0, utils_1.createWindow)(url, storageManager);
        if (electron_1.app.dock) {
            const dockMenu = electron_1.Menu.buildFromTemplate([
                {
                    label: '新建窗口',
                    click: () => (0, utils_1.createWindow)(url, storageManager, { cascade: true }),
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
        ], () => {
            (0, utils_1.showOrCreateWindow)((0, languageServer_1.getLsPort)());
            electron_1.app.focus({ steal: true });
        });
        // The app menu bar isn't reachable on Windows (hidden title bar), so
        // the tray menu also gets the "Connect to WSL" entry.
        void (0, menu_1.wslConnectMenuTemplate)().then((wslItem) => {
            if (wslItem) {
                (0, tray_1.insertTrayMenuItem)(2, wslItem);
                const reopen = (0, menu_1.wslReopenLocallyTemplate)();
                if (reopen) {
                    (0, tray_1.insertTrayMenuItem)(3, reopen);
                }
            }
        });
    }
    openSshHostFromArgs(process.argv);
    // Start checking for app updates.
    (0, updater_1.initAutoUpdater)(HEADLESS, settingsService);
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
});
/** Shuts down the host bridge server, if it was started. */
async function closeHostBridgeServer() {
    if (!hostBridgeServer) {
        return;
    }
    try {
        await hostBridgeServer.close();
    }
    catch (err) {
        console.error('Failed to close host bridge server:', err);
    }
    hostBridgeServer = undefined;
}
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
        // Persist the focused/open Hub window bounds and full-screen/maximized state
        // before `win.destroy()`, which bypasses the normal `'close'` event.
        (0, windowState_1.flushTrackedWindowState)((0, utils_1.getFocusedHubWindow)());
        // Before destroying the windows (see disposeAll).
        const sshClosed = remoteManager?.disposeAll().catch((err) => {
            console.error('Failed to close SSH connections:', err);
        }) ?? Promise.resolve();
        // Destroy all windows to terminate renderers and release keep-alive sockets
        const windows = [
            ...new Set([...(0, utils_1.getHubWindows)(), ...electron_1.BrowserWindow.getAllWindows()]),
        ];
        for (const win of windows) {
            win.destroy();
        }
        // Close all active connections and kill the language server in parallel
        await Promise.all([
            electron_1.session.defaultSession.closeAllConnections().catch((err) => {
                console.error('Failed to close session connections:', err);
            }),
            (0, languageServer_1.killLanguageServer)(),
            (0, browserEngine_1.closeAllBrowserSessions)().catch((err) => {
                console.error('Failed to close browser sessions:', err);
            }),
            sshClosed,
        ]);
        // The host bridge server comes down last, in reverse order of startup: the
        // language server is its only client, so closing it first would just drop
        // in-flight requests and log errors on the way out.
        await closeHostBridgeServer();
        electron_1.app.quit();
        return;
    }
    // Show a confirmation dialog before quitting
    event.preventDefault();
    const hubWindows = (0, utils_1.getHubWindows)();
    const focusedWindow = (0, utils_1.getFocusedHubWindow)() ?? electron_1.BrowserWindow.getFocusedWindow();
    const win = (focusedWindow && hubWindows.includes(focusedWindow)
        ? focusedWindow
        : undefined) || hubWindows[0];
    const options = {
        type: 'question',
        buttons: ['取消', '退出'],
        defaultId: 1,
        cancelId: 0,
        title: '确认退出',
        message: '您确定要退出吗？',
        detail: '可能还有智能体或后台任务正在运行。',
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
    if (!HEADLESS && (0, utils_1.getHubWindows)().length === 0) {
        const url = DEV_URL ?? `${constants_1.WINDOW_ORIGIN}:${(0, languageServer_1.getLsPort)()}/`;
        (0, utils_1.createWindow)(url, storageManager);
    }
});
