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
exports.RemoteManager = void 0;
/** One SshConnection and one window per SSH host. */
const electron_1 = require("electron");
const main_1 = __importDefault(require("electron-log/main"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const externalUrl_1 = require("../externalUrl");
const nodeWrapper_1 = require("../nodeWrapper");
const paths_1 = require("../paths");
const utils_1 = require("../utils");
const disconnectedPage_1 = require("./disconnectedPage");
const remoteWindowSecurity_1 = require("./remoteWindowSecurity");
const connectionInputs_1 = require("./connectionInputs");
const remoteSidecars_1 = require("./remoteSidecars");
const serverArtifacts_1 = require("./serverArtifacts");
const sshBridge_1 = require("./sshBridge");
const sshAskpass_1 = require("./sshAskpass");
const sshConfigHosts_1 = require("./sshConfigHosts");
const sshConnection_1 = require("./sshConnection");
const sshDestination_1 = require("./sshDestination");
const sshErrorText_1 = require("./sshErrorText");
const sshPrompts_1 = require("./sshPrompts");
const sshRecentHosts_1 = require("./sshRecentHosts");
const transport_1 = require("./transport");
const types_1 = require("./types");
const windowBackends_1 = require("./windowBackends");
const DEV_OVERRIDE_ENVS = [
    'ANTIGRAVITY_SSH_BIN',
    serverArtifacts_1.SSH_LS_VERSION_ENV,
    serverArtifacts_1.SSH_LS_REMOTE_PATH_ENV,
];
/** 781 s of back-off; ~20 min if every attempt hits ssh's 15 s timeout. */
const MAX_RECONNECT_ATTEMPTS = 30;
/** Doubles after each automatic reconnect, up to the max. */
const FIRST_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
/** A session up this long gives the next drop a new reconnect budget. */
const STABLE_SESSION_MS = 60000;
const MAX_PAGE_DETAIL_CHARS = 300;
/** The pinned shape of an organization sign-in's provider_name. */
const WORKFORCE_PROVIDER_RE = /^locations\/global\/workforcePools\/([^/]+)\/providers\/([^/]+)$/;
class RemoteManager {
    constructor(deps) {
        this.deps = deps;
        this.hosts = new Map();
        /** Teardowns in flight, for disposeAll(). */
        this.disposals = new Set();
        /** Windows showing a sheet from showSheet(). */
        this.openSheets = new WeakSet();
        /** Each window's prompts, one at a time; it never holds an answer. */
        this.promptChains = new WeakMap();
        /** Prompt parents that started to close: no prompt goes there any more. */
        this.closingWindows = new WeakSet();
        /** Each window's latest intent from connect(), until its page takes it. */
        this.pendingIntents = new WeakMap();
        this.recentHosts = new sshRecentHosts_1.RecentSshHosts(deps.mainStorage);
        this.inputs = new connectionInputs_1.ConnectionInputs(deps);
        for (const name of DEV_OVERRIDE_ENVS) {
            if (process.env[name]) {
                main_1.default.warn(`[SSH] ${name} is set; using it for SSH connections.`);
            }
        }
    }
    /** The plugin:// routes of `sender`'s session, while it's up. */
    sidecarRoutesFor(sender) {
        const own = (0, windowBackends_1.remoteBackendOf)(sender);
        const connection = own && this.hosts.get(own.hostId)?.connection;
        return connection?.sidecarFetch ? connection.sidecars : undefined;
    }
    getState(sender) {
        // Remote-served content learns only whether its own host is connected,
        // and no laptop paths.
        const own = (0, windowBackends_1.remoteBackendOf)(sender);
        const remote = (0, remoteWindowSecurity_1.isRemoteContents)(sender);
        const connected = [...this.hosts.values()]
            .filter((e) => !e.disposed && e.session)
            .filter((e) => !remote || e.hostId === own?.hostId);
        return {
            currentHost: own?.label ?? null,
            connectedHosts: connected.map((e) => e.label),
            connected: connected.map((e) => remote || e.configFile === undefined
                ? { host: e.label }
                : { host: e.label, configFile: e.configFile }),
        };
    }
    async listHosts({ configFile, } = {}) {
        // A chosen file replaces the default ones, as with ssh -F.
        const found = configFile === undefined
            ? (0, sshConfigHosts_1.listSshConfigHosts)()
            : (0, sshConfigHosts_1.resolveSshConfigFile)(configFile).then((configPath) => configPath === undefined
                ? (0, sshConfigHosts_1.listSshConfigHosts)()
                : (0, sshConfigHosts_1.listSshConfigHosts)({ configPath, systemConfigPath: null }));
        const [configHosts, { recent, recentHosts, recentConfigFiles }] = await Promise.all([found, this.recentHosts.list()]);
        return { configHosts, recent, recentHosts, recentConfigFiles };
    }
    async connect(sender, host, onProgress, { intent, configFile } = {}) {
        const label = host.trim();
        try {
            const win = await this.connectAndOpenWindow(host, {
                onStatus: onProgress,
                configFile: configFile === undefined
                    ? undefined
                    : await (0, sshConfigHosts_1.resolveSshConfigFile)(configFile),
                promptParent: (0, utils_1.resolveHubWindowFromWebContents)(sender),
            });
            if (intent) {
                // Kept across reloads: the toolkit may subscribe only after sign-in.
                this.pendingIntents.set(win.webContents, intent);
                if (!win.webContents.isLoadingMainFrame()) {
                    win.webContents.send(sshBridge_1.SSH_INTENT_CHANNEL);
                }
            }
            return { ok: true };
        }
        catch (err) {
            const remoteErr = (0, sshConnection_1.toRemoteError)(err);
            this.logError(remoteErr, label, 'SSH connection failed');
            return {
                ok: false,
                code: remoteErr.code,
                message: (0, sshErrorText_1.userMessage)(remoteErr, label),
            };
        }
    }
    /** A file picker on `sender`'s window, in ~/.ssh: see SshBridgeBackend. */
    async chooseConfigFile(sender) {
        const parent = (0, utils_1.resolveHubWindowFromWebContents)(sender);
        if (!parent) {
            return null;
        }
        const sshDir = path.join(os.homedir(), '.ssh');
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(parent, {
            title: '选择 SSH 配置文件',
            defaultPath: (await fs.promises.stat(sshDir).catch(() => undefined))
                ? sshDir
                : os.homedir(),
            properties: ['openFile', 'showHiddenFiles'],
        });
        const [picked] = filePaths;
        if (canceled || picked === undefined) {
            return null;
        }
        // listHosts() and connect() check it.
        const configFile = await (0, sshConfigHosts_1.canonicalSshConfigFile)(picked);
        return configFile === undefined ? {} : { configFile };
    }
    async stopServer(sender) {
        const win = electron_1.BrowserWindow.fromWebContents(sender);
        if (win) {
            await this.confirmAndStopServer(win);
        }
    }
    openLocalWindow() {
        const win = (0, utils_1.getLastFocusedLocalHubWindow)();
        if (!win) {
            this.deps.openLocalWindow();
            return;
        }
        if (win.isMinimized()) {
            win.restore();
        }
        win.show();
        win.focus();
    }
    /** For --ssh-host: connects, or explains the failure in a sheet on `parent`. */
    async openFromCommandLine(host, parent) {
        const label = host.trim();
        try {
            await this.connectAndOpenWindow(host, {
                onStatus: (text) => main_1.default.info(`[SSH] ${text}`),
                promptParent: parent,
            });
        }
        catch (err) {
            const remoteErr = (0, sshConnection_1.toRemoteError)(err);
            if (remoteErr.code === 'CANCELLED') {
                return; // E.g. quitting.
            }
            this.logError(remoteErr, label, 'SSH connection failed');
            const detail = (0, sshErrorText_1.detailOf)(remoteErr, label);
            await this.showSheet(parent, {
                type: 'error',
                title: 'SSH connection failed',
                message: (0, sshErrorText_1.explanationOf)(remoteErr, label),
                detail: [detail, (0, sshErrorText_1.codeAndLogs)(remoteErr)].filter(Boolean).join('\n'),
            });
        }
    }
    takeIntent(sender) {
        const intent = this.pendingIntents.get(sender);
        this.pendingIntents.delete(sender);
        return intent;
    }
    /** Connects to `input`, then focuses the host's window or opens one. */
    async connectAndOpenWindow(input, { onStatus, configFile, promptParent } = {}) {
        const entry = this.entryFor(input, configFile);
        let sshSession;
        try {
            sshSession = await this.connectEntry(entry, { onStatus, promptParent });
        }
        catch (err) {
            // Forget a host that never connected, so its next spelling starts over.
            if (!entry.attempt &&
                !entry.session &&
                (0, windowBackends_1.windowsForHost)(entry.hostId).length === 0) {
                void this.disposeHost(entry);
            }
            throw err;
        }
        if (entry.disposed) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        const [existing] = (0, windowBackends_1.windowsForHost)(entry.hostId);
        if (existing) {
            if (existing.isMinimized()) {
                existing.restore();
            }
            existing.show();
            existing.focus();
            return existing;
        }
        return this.openWindow(entry, sshSession);
    }
    /** The host's session: connects, or joins the connect in flight. */
    async connectEntry(entry, { onStatus, attachOnly = false, promptParent } = {}) {
        if (entry.session) {
            return entry.session;
        }
        if (onStatus) {
            entry.statusListeners.add(onStatus);
        }
        try {
            const attempt = this.joinAttempt(entry, attachOnly, (0, sshAskpass_1.canPrompt)() ? promptParent : undefined);
            try {
                return await attempt.session;
            }
            catch (err) {
                // It failed, but an attempt that may start or ask took over.
                if (entry.attempt && entry.attempt !== attempt) {
                    return await this.connectEntry(entry, { attachOnly, promptParent });
                }
                throw err;
            }
        }
        finally {
            if (onStatus) {
                entry.statusListeners.delete(onStatus);
            }
        }
    }
    /**
     * The connect in flight, or a new one: a full connect extends an attach,
     * and one that can prompt extends one that can't.
     */
    joinAttempt(entry, attachOnly, promptParent) {
        const current = entry.attempt;
        if (current &&
            (attachOnly || !current.attachOnly) &&
            (!promptParent || current.promptParents)) {
            if (promptParent) {
                // The run's askOn reads this array: prompts move to the newest caller.
                current.promptParents?.push(promptParent);
            }
            return current;
        }
        const promptParents = promptParent && [promptParent];
        const session = current
            ? this.afterAttempt(entry, current, attachOnly, promptParents)
            : this.openConnection(entry, attachOnly, promptParents);
        const attempt = {
            session: session.finally(() => {
                if (entry.attempt === attempt) {
                    entry.attempt = undefined;
                }
            }),
            attachOnly,
            promptParents,
        };
        entry.attempt = attempt;
        return attempt;
    }
    /**
     * Waits for `current`; connects again if it found no server and this may
     * start one, or if ssh needed to ask and only this can.
     */
    async afterAttempt(entry, current, attachOnly, promptParents) {
        try {
            return await current.session;
        }
        catch (err) {
            const { code } = (0, sshConnection_1.toRemoteError)(err);
            const start = code === 'LS_STOPPED' && current.attachOnly && !attachOnly;
            const ask = promptParents &&
                !current.promptParents &&
                (code === 'AUTH_FAILED' || code === 'HOSTKEY_REJECTED');
            if (!start && !ask) {
                throw err;
            }
            return await this.openConnection(entry, attachOnly, promptParents);
        }
    }
    async openConnection(entry, attachOnly, promptParents) {
        // In parallel: on the first connect each can take seconds.
        const [loginEnv, artifacts] = await Promise.all([
            this.inputs.loginShellEnv(),
            this.inputs.serverFor(attachOnly),
        ]);
        if (entry.disposed) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        const conn = new sshConnection_1.SshConnection({
            destination: entry.destination,
            configFile: entry.configFile,
            label: entry.label,
            server: artifacts,
            attachOnly,
            askpass: promptParents && {
                nodeBinary: (0, nodeWrapper_1.electronNodeBinary)(),
                ask: (prompt) => this.askOn(promptParents, entry.label, prompt),
            },
            userDataDir: electron_1.app.getPath('userData'),
            appDataDirName: (0, paths_1.getAppDataDirName)(),
            createTransport: (socksPort) => (0, transport_1.openTransport)(entry.hostId, socksPort),
            openExternal: (url) => (0, externalUrl_1.openExternalSafely)(url, 'unconfirmed'),
            confirmOrganizationSignIn: (provider, signal) => this.confirmOrganizationSignIn(entry, provider, signal),
            env: { ...process.env, ...loginEnv },
            fetch: (url, init) => electron_1.net.fetch(url, init),
            log: (line) => main_1.default.info(line),
        });
        // dispose() removes these listeners.
        conn.on('status', (text) => {
            for (const listener of entry.statusListeners) {
                listener(text);
            }
        });
        // No window, no dialog: an app-modal one would block every window.
        conn.on('signInError', (err) => {
            const [win] = (0, windowBackends_1.windowsForHost)(entry.hostId);
            if (win) {
                this.reportError(err, entry.label, 'Sign-in failed', win);
            }
            else {
                this.logError(err, entry.label, 'Sign-in failed');
            }
        });
        conn.on('disconnected', (err) => this.onDisconnected(entry, conn, err));
        entry.connection = conn;
        // A drop before the session is up fails this connect with its error.
        let dropped;
        conn.once('disconnected', (err) => (dropped = err));
        try {
            const sshSession = await conn.connect();
            if (entry.disposed) {
                throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
            }
            // Before any window loads: each connection has a new SOCKS port.
            await (0, transport_1.routeSessionThroughSsh)(electron_1.session.fromPartition(partitionFor(entry.hostId)), sshSession.socksPort);
            if (entry.disposed || entry.connection !== conn) {
                throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
            }
            if (dropped) {
                throw dropped;
            }
            this.onConnected(entry, sshSession);
            return sshSession;
        }
        catch (err) {
            if (entry.connection === conn) {
                entry.connection = undefined;
            }
            this.trackDisposal(conn.dispose());
            throw err;
        }
    }
    onConnected(entry, sshSession) {
        entry.session = sshSession;
        entry.connectedAt = Date.now();
        clearTimeout(entry.reconnectTimer); // E.g. connected from a local window.
        main_1.default.info(`[SSH] Connected to ${entry.label} at ${sshSession.url}`);
        const running = sshSession.discovery.lsVersion;
        if (running !== sshSession.expectedVersion) {
            // Kept: replacing it would stop its agents.
            main_1.default.info(`[SSH] ${entry.label} runs Antigravity server ${(0, types_1.sanitizeRemoteText)(running, 64)}; this app uses ${sshSession.expectedVersion}.`);
        }
        this.recentHosts.remember(entry.label, entry.configFile);
        for (const win of (0, windowBackends_1.windowsForHost)(entry.hostId)) {
            // E.g. ERR_ABORTED: the window closed or navigated during the load.
            win
                .loadURL(sshSession.url)
                .catch((err) => main_1.default.warn(`[SSH] Could not load ${entry.label} in its window:`, err));
        }
    }
    openWindow(entry, sshSession) {
        const partition = partitionFor(entry.hostId);
        // Windows outlive entries (Reconnect reuses them): look the host up by id.
        const { hostId, label, configFile } = entry;
        const current = () => {
            const e = this.hosts.get(hostId);
            return e && !e.disposed ? e : undefined;
        };
        const allowedOrigin = () => {
            const e = current();
            return e?.session ? new URL(e.session.url).origin : undefined;
        };
        let win;
        try {
            const ses = electron_1.session.fromPartition(partition);
            (0, remoteWindowSecurity_1.hardenRemoteSession)(ses, {
                allowedOrigin,
                onBlocked: (url) => this.logBlockedRequest(current() ?? entry, url),
            });
            // Sidecar UIs: the host's current session routes and fetches them.
            (0, remoteSidecars_1.installRemoteSidecarProtocol)(ses, () => current()?.connection);
            const created = (0, utils_1.createWindow)(sshSession.url, this.deps.mainStorage, {
                cascade: true,
                partition,
                titleSuffix: ` (SSH: ${label})`,
                additionalArguments: ['--agy-backend=ssh'],
                builtInBrowser: false,
                navigationPolicy: (0, remoteWindowSecurity_1.remoteNavigationPolicy)(allowedOrigin, (action) => {
                    if (action === 'reconnect') {
                        this.reconnect(hostId, label, configFile, created).catch((err) => main_1.default.error(`[SSH] Could not reconnect to ${label}:`, err));
                    }
                    else {
                        created.close();
                    }
                }),
                // A copy would be an unregistered window on the remote's URL.
                onNewWindow: () => this.deps.openLocalWindow(),
            });
            win = created;
            // Registered first: whatever fails next, it never passes for local.
            (0, windowBackends_1.registerRemoteWindow)(created, { kind: 'ssh', hostId, label });
            (0, remoteWindowSecurity_1.hardenRemoteWindow)(created);
        }
        catch (err) {
            main_1.default.error(`[SSH] Could not open a window on ${label}:`, err);
            if (win && !win.isDestroyed()) {
                win.destroy();
            }
            // Nothing else would close a connection without windows.
            if ((0, windowBackends_1.windowsForHost)(hostId).length === 0) {
                void this.disposeHost(entry);
            }
            throw err;
        }
        win.on('closed', () => {
            const e = current();
            if (e && (0, windowBackends_1.windowsForHost)(hostId).length === 0) {
                void this.disposeHost(e);
            }
        });
        main_1.default.info(`[SSH] Opened a window on ${label}.`);
        return win;
    }
    /** The Disconnected page's Reconnect button, in `win`. */
    async reconnect(hostId, label, configFile, win) {
        if ((0, windowBackends_1.windowsForHost)(hostId).length === 0) {
            return;
        }
        const entry = this.hosts.get(hostId) ?? this.entryFor(label, configFile);
        if (entry.session) {
            return; // Connected meanwhile (e.g. from a local window).
        }
        this.showPage(entry, { state: 'connecting' });
        try {
            // onConnected reloads the host's windows.
            await this.connectEntry(entry, { promptParent: win });
        }
        catch (err) {
            const remoteErr = (0, sshConnection_1.toRemoteError)(err);
            // Cancelled by a teardown, not at a prompt.
            if (entry.disposed ||
                (remoteErr.code === 'CANCELLED' && !remoteErr.userCancelled)) {
                return;
            }
            this.logError(remoteErr, entry.label, 'Reconnect failed');
            this.showPage(entry, {
                state: 'disconnected',
                detail: (0, sshErrorText_1.userMessage)(remoteErr, entry.label),
            });
        }
    }
    /** Like Reconnect, but it only attaches, and retries network failures. */
    reconnectLater(entry) {
        clearTimeout(entry.reconnectTimer);
        const delay = Math.min(FIRST_RECONNECT_DELAY_MS * 2 ** entry.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
        entry.reconnectAttempts++;
        entry.reconnectTimer = setTimeout(() => {
            this.connectEntry(entry, { attachOnly: true }).catch((err) => {
                const remoteErr = (0, sshConnection_1.toRemoteError)(err);
                // Cancelled by a teardown: the host was disposed (window closed, Stop,
                // or quit). A prompt's Cancel, in a connect it joined, shows.
                if (entry.disposed ||
                    (remoteErr.code === 'CANCELLED' && !remoteErr.userCancelled)) {
                    return;
                }
                this.logError(remoteErr, entry.label, 'Reconnect failed');
                if (remoteErr.retryable &&
                    entry.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    this.reconnectLater(entry);
                }
                else {
                    this.showPage(entry, {
                        state: 'disconnected',
                        detail: (0, sshErrorText_1.userMessage)(remoteErr, entry.label),
                    });
                }
            });
        }, delay);
    }
    onDisconnected(entry, conn, err) {
        // Before the session is up, the connect in flight reports the drop.
        if (entry.connection !== conn || entry.disposed || !entry.session) {
            return;
        }
        main_1.default.warn(`[SSH] Lost connection to ${entry.label}: ${(0, types_1.sanitizeRemoteText)(err.message)}`);
        entry.connection = undefined;
        entry.session = undefined;
        this.trackDisposal(conn.dispose());
        if (entry.stopPhase === 'stopping' && err.code === 'LS_STOPPED') {
            return; // The stop worked: confirmAndStopServer closes the windows.
        }
        if ((0, windowBackends_1.windowsForHost)(entry.hostId).length === 0) {
            void this.disposeHost(entry);
            return;
        }
        // A host that keeps dropping right after connecting gets no new budget.
        if (Date.now() - entry.connectedAt >= STABLE_SESSION_MS) {
            entry.reconnectAttempts = 0;
        }
        // Attach only: a server that went away may have been stopped on purpose.
        if (err.retryable && entry.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            this.showPage(entry, { state: 'connecting' });
            this.reconnectLater(entry);
            return;
        }
        this.showPage(entry, {
            state: 'disconnected',
            detail: (0, types_1.sanitizeRemoteText)(err.message, MAX_PAGE_DETAIL_CHARS),
        });
    }
    showPage(entry, page) {
        for (const win of (0, windowBackends_1.windowsForHost)(entry.hostId)) {
            (0, disconnectedPage_1.showDisconnectedPage)(win, {
                ...page,
                label: entry.label,
                dark: !(0, utils_1.isLightTheme)(),
            });
        }
    }
    /** Confirms, stops the host's server and agents, and closes its windows. */
    async confirmAndStopServer(win) {
        const info = (0, windowBackends_1.remoteBackendOfWindow)(win);
        const entry = info && this.hosts.get(info.hostId);
        if (!entry || entry.disposed || entry.stopPhase) {
            return;
        }
        // Checked after each await: a drop replaces it and takes its own path.
        const conn = entry.connection;
        if (!conn || !entry.session) {
            await this.tellNotConnected(win, entry.label);
            return;
        }
        entry.stopPhase = 'asking';
        let response;
        try {
            ({ response } = await electron_1.dialog.showMessageBox(win, {
                type: 'warning',
                buttons: ['停止服务端', '取消'],
                defaultId: 1,
                cancelId: 1,
                title: '停止 SSH 服务端',
                message: `停止 ${entry.label} 上的 Antigravity 服务端？`,
                detail: 'Agents running on this host will stop and its window will close. ' +
                    'The server starts again the next time you connect.',
                // A drop closes it as Cancel.
                signal: conn.closedSignal,
            }));
        }
        finally {
            entry.stopPhase = undefined;
        }
        if (response !== 0 || entry.disposed) {
            return;
        }
        if (entry.connection !== conn) {
            await this.tellNotConnected(win, entry.label);
            return;
        }
        entry.stopPhase = 'stopping';
        try {
            await conn.stopRemoteServer();
        }
        catch (err) {
            // After a drop, its own path already reconnects or shows the page.
            if (!entry.disposed && entry.connection === conn) {
                this.reportError(err, entry.label, 'Could not stop the SSH server', win);
            }
            return;
        }
        finally {
            entry.stopPhase = undefined;
        }
        main_1.default.info(`[SSH] Stopped the remote server on ${entry.label}.`);
        const windows = (0, windowBackends_1.windowsForHost)(entry.hostId);
        // Dispose first, so nothing shows the Disconnected page for it.
        await this.disposeHost(entry);
        for (const w of windows) {
            if (!w.isDestroyed()) {
                w.close();
            }
        }
    }
    tellNotConnected(win, label) {
        return this.showSheet(win, {
            type: 'info',
            title: '停止 SSH 服务端',
            message: `未连接到 ${label}`,
            detail: '请先重新连接，然后再停止其服务端。',
        });
    }
    /** Logs `err`, and shows it in a sheet on `parent` unless it's CANCELLED. */
    reportError(err, label, title, parent) {
        const remoteErr = (0, sshConnection_1.toRemoteError)(err);
        if (remoteErr.code === 'CANCELLED') {
            return;
        }
        this.logError(remoteErr, label, title);
        void this.showSheet(parent, {
            type: 'error',
            title,
            message: (0, sshErrorText_1.detailOf)(remoteErr, label),
            detail: (0, sshErrorText_1.codeAndLogs)(remoteErr),
        });
    }
    /** One sheet at a time per window: a host can send errors endlessly. */
    async showSheet(parent, options) {
        if (parent.isDestroyed() || this.openSheets.has(parent)) {
            return;
        }
        this.openSheets.add(parent);
        try {
            await electron_1.dialog.showMessageBox(parent, options);
        }
        catch (err) {
            main_1.default.warn(`[SSH] Could not show "${options.title}":`, err);
        }
        finally {
            this.openSheets.delete(parent);
        }
    }
    /**
     * ssh's prompt on the newest open window of `parents` as its turn comes,
     * after that window's earlier ones; Cancel if none is open.
     */
    askOn(parents, label, prompt) {
        const newest = () => [...parents]
            .reverse()
            .find((w) => !w.isDestroyed() && !this.closingWindows.has(w));
        const parent = newest();
        if (!parent) {
            return Promise.resolve({ kind: 'cancel' });
        }
        const closing = () => this.closingWindows.add(parent);
        parent.once('close', closing);
        // Picked again at its turn (the window may be closing or gone, or a
        // caller joined); a prompt that moves frees the window's slot first.
        const shown = (this.promptChains.get(parent) ?? Promise.resolve()).then(() => (newest() === parent ? (0, sshPrompts_1.askOnWindow)(parent, label, prompt) : null));
        const done = () => undefined;
        this.promptChains.set(parent, shown.then(done, done));
        return shown
            .then((answer) => answer ?? this.askOn(parents, label, prompt))
            .finally(() => parent.off('close', closing));
    }
    logError(err, label, title) {
        main_1.default.error(`[SSH] ${label}: ${title}: ${err.code} ${(0, types_1.sanitizeRemoteText)(err.message)}`);
    }
    /** Unlike Google's, its IdP may sign in without a click, for the host. */
    async confirmOrganizationSignIn(entry, provider, // Pinned by SshConnection to a workforce provider.
    signal) {
        const [parent] = (0, windowBackends_1.windowsForHost)(entry.hostId);
        // No window, no question: an app-modal one would block every window.
        if (entry.disposed || !parent) {
            return false;
        }
        const names = WORKFORCE_PROVIDER_RE.exec(provider);
        const { response } = await electron_1.dialog.showMessageBox(parent, {
            type: 'question',
            buttons: ['登录', '取消'],
            // The host decides when this shows: a Return meant for it mustn't accept.
            defaultId: 1,
            cancelId: 1,
            title: '登录',
            message: `为 ${entry.label} 登录到您的组织？`,
            detail: 'Continue only if you just chose to sign in with your organization ' +
                `in this window. ${entry.label} will get access to your ` +
                "organization's Google Cloud account.\n" +
                (names
                    ? `Workforce pool: ${names[1]}  Provider: ${names[2]}`
                    : `Identity provider: ${provider}`),
            // Closes with its connection: a later yes would open nothing.
            signal,
        });
        return response === 0;
    }
    logBlockedRequest(entry, url) {
        const n = ++entry.blockedRequests;
        if (n <= 20 || n % 100 === 0) {
            let where = url;
            try {
                const u = new URL(url);
                where = `${u.protocol}//${u.host}`;
            }
            catch {
                // Keep the raw (sanitized) text.
            }
            main_1.default.warn(`[SSH] Blocked a request from the ${entry.label} window to ${(0, types_1.sanitizeRemoteText)(where, 200)} (${n} so far).`);
        }
    }
    entryFor(input, configFile) {
        const { destination } = (0, sshDestination_1.parseSshDestination)(input);
        const label = input.trim();
        const hostId = (0, sshDestination_1.hostIdFor)(destination, configFile);
        let entry = this.hosts.get(hostId);
        if (!entry || entry.disposed) {
            entry = {
                hostId,
                destination,
                configFile,
                label,
                statusListeners: new Set(),
                reconnectAttempts: 0,
                connectedAt: 0,
                disposed: false,
                blockedRequests: 0,
            };
            this.hosts.set(hostId, entry);
        }
        return entry;
    }
    /**
     * Marks every host closed (window closes and drops then do nothing) and
     * signals ssh, then waits for it. On quit, call it before destroying windows.
     */
    async disposeAll() {
        // First: main.ts destroys every window next, parents first, and a modal
        // child destroyed after its parent crashes Electron.
        (0, sshPrompts_1.destroyPromptWindows)();
        for (const entry of [...this.hosts.values()]) {
            void this.disposeHost(entry);
        }
        await Promise.allSettled([...this.disposals]);
    }
    disposeHost(entry) {
        entry.disposed = true;
        clearTimeout(entry.reconnectTimer);
        if (this.hosts.get(entry.hostId) === entry) {
            this.hosts.delete(entry.hostId);
        }
        const connection = entry.connection;
        entry.connection = undefined;
        entry.session = undefined;
        const disposing = connection?.dispose() ?? Promise.resolve();
        this.trackDisposal(disposing);
        return disposing;
    }
    trackDisposal(disposing) {
        this.disposals.add(disposing);
        const forget = () => this.disposals.delete(disposing);
        // Not finally(): it re-rejects.
        void disposing.then(forget, forget);
    }
}
exports.RemoteManager = RemoteManager;
function partitionFor(hostId) {
    return `persist:ssh-${hostId}`;
}
