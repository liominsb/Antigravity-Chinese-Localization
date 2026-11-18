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
exports.RemoteManager = exports.MAX_PENDING_SIGN_IN_RETURNS = void 0;
exports.redactUiTokensInLog = redactUiTokensInLog;
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
const hostQuestions_1 = require("./hostQuestions");
const remoteWindowSecurity_1 = require("./remoteWindowSecurity");
const connectionInputs_1 = require("./connectionInputs");
const remoteSidecars_1 = require("./remoteSidecars");
const serverArtifacts_1 = require("./serverArtifacts");
const serverVersion_1 = require("./serverVersion");
const signInReturn_1 = require("./signInReturn");
const signInUrls_1 = require("./signInUrls");
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
/**
 * Automatic reconnects that land on another machine of a pool sharing the
 * home (the server's lease is live there) stop after this many: the next
 * pick may be the machine that runs it, but it needn't ever be.
 */
const POOL_RECONNECT_ATTEMPTS = 5;
/**
 * After the computer wakes, how long each session gets to answer through its
 * tunnel. Wi-Fi is usually back within it; ssh's ServerAlive takes ~45 s.
 */
const RESUME_CHECK_TIMEOUT_MS = 8000;
/** SSH sign-ins kept awaiting their link back (takeSignInReturn). */
exports.MAX_PENDING_SIGN_IN_RETURNS = 8;
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
        /**
         * Each window's prompts, one at a time, keyed by the window. The windows
         * reopened at startup also take turns with each other (keyed by
         * `reopening`): one shown while the user types into another would take the
         * focus, and the rest of a password with it. No chain holds an answer.
         */
        this.promptChains = new WeakMap();
        /** Windows reopened at startup, until their first connect settles. */
        this.reopening = new WeakSet();
        /** Prompt parents that started to close: no prompt goes there any more. */
        this.closingWindows = new WeakSet();
        /** Prompt parents whose 'close' adds them to closingWindows. */
        this.watchedParents = new WeakSet();
        /** Each window's latest intent from connect(), until its page takes it. */
        this.pendingIntents = new WeakMap();
        /**
         * Per host, the older server kept until the app quits: the user said Later
         * (replaced then only once it has nothing loaded and no terminal open), or
         * replacing it failed (never again).
         */
        this.keptServers = new Map();
        /**
         * SSH windows' sign-ins awaiting their link back (takeSignInReturn), oldest
         * first, timed by performance.now(): a clock that goes back can't age them.
         */
        this.signInReturns = [];
        /**
         * Every sheet on an SSH window goes through it, one at a time; the host's
         * questions (e.g. a sign-in) also take no answer as they show.
         */
        this.hostQuestions = new hostQuestions_1.HostQuestions({
            isClosing: (win) => this.closingWindows.has(win),
        });
        /**
         * Each host's answer to its microphone question (true: Allow), until the
         * app quits. No answer (e.g. a click within the arming time) isn't kept.
         */
        this.microphoneAnswers = new Map();
        /** Each host's open microphone question: requests meanwhile share it. */
        this.microphoneQuestions = new Map();
        /**
         * After the computer wakes: a waiting automatic reconnect runs now, with
         * its back-off started over, and each session must answer through its
         * tunnel within RESUME_CHECK_TIMEOUT_MS, else it's dropped and reconnected
         * like any drop.
         */
        this.onResume = () => {
            for (const entry of this.hosts.values()) {
                if (entry.disposed || entry.attempt) {
                    continue;
                }
                if (entry.reconnectTimer !== undefined) {
                    // A wake is a new network: if Wi-Fi isn't back yet, retry soon.
                    entry.reconnectAttempts = 0;
                    this.reconnectNow(entry);
                    continue;
                }
                const conn = entry.connection;
                if (!conn || !entry.session) {
                    continue;
                }
                void conn
                    .isResponsive(RESUME_CHECK_TIMEOUT_MS)
                    .then((responsive) => {
                    // A drop meanwhile was handled: onDisconnected ignores this one.
                    if (!responsive) {
                        this.onDisconnected(entry, conn, new types_1.RemoteError('CONNECTION_CLOSED', `本机唤醒后 ${entry.label} 未响应。`, { retryable: true }));
                    }
                })
                    .catch((err) => {
                    main_1.default.warn(`[SSH] Could not check ${entry.label} after waking:`, err);
                });
            }
        };
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
    /**
     * Opens a web URL off the local network (openRemoteUrl checked it) that an
     * SSH window asked to open: through its host's connection, which relays
     * sign-in callbacks to the host.
     */
    openUrlFrom(sender, url) {
        const own = (0, windowBackends_1.remoteBackendOf)(sender);
        if (own) {
            this.openUrlForHost(own.hostId, url);
        }
        else {
            this.openUnrelayed(url);
        }
    }
    openUrlForHost(hostId, url) {
        const entry = this.hosts.get(hostId);
        const connection = entry?.session && !entry.disposed && entry.connection;
        if (connection) {
            connection
                .openFromWindow(url)
                .catch((err) => main_1.default.warn('[SSH] Could not open a link from an SSH window:', err));
        }
        else {
            this.openUnrelayed(url);
        }
    }
    /** With no connection to relay a sign-in's callback to its host. */
    openUnrelayed(url) {
        if ((0, signInUrls_1.redirectsToLocalNetwork)(new URL(url))) {
            // Its code would reach whatever listens on that port here.
            main_1.default.warn(`[SSH] Not opening a sign-in from an SSH window with no connection: ${(0, types_1.sanitizeRemoteText)(new URL(url).origin, 200)}.`);
        }
        else {
            void (0, externalUrl_1.openExternalSafely)(url, 'unconfirmed');
        }
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
    async forgetRecentHost({ host, configFile }) {
        await this.recentHosts.forget(host, configFile);
        // So its next mic request asks again.
        this.forgetMicrophoneAnswer(host, configFile);
    }
    async connect(sender, host, onProgress, { intent, configFile } = {}) {
        const label = host.trim();
        try {
            // Only a window that's already open takes the intent: a window this
            // connect opens just opens on the host, with no folder picker.
            const openBefore = new Set(electron_1.BrowserWindow.getAllWindows());
            const win = await this.connectAndOpenWindow(host, {
                onStatus: onProgress,
                configFile: configFile === undefined
                    ? undefined
                    : await (0, sshConfigHosts_1.resolveSshConfigFile)(configFile),
                promptParent: (0, utils_1.resolveHubWindowFromWebContents)(sender),
            });
            if (intent && openBefore.has(win)) {
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
        let defaultPath = (await fs.promises.stat(sshDir).catch(() => undefined))
            ? sshDir
            : os.homedir();
        for (;;) {
            const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(parent, {
                title: '选择 SSH 配置文件',
                defaultPath,
                properties: ['openFile', 'showHiddenFiles'],
            });
            const [picked] = filePaths;
            if (canceled || picked === undefined) {
                return null;
            }
            // Said now, not when ssh refuses it (e.g. known_hosts, a sibling), with
            // listHosts() and connect()'s other checks.
            const name = path.basename(picked);
            const problem = await (0, sshConfigHosts_1.sshConfigFileProblem)(picked);
            let refusal;
            if (problem) {
                refusal = {
                    message: `${name} ${problem.what}`,
                    detail: `${problem.why[0].toUpperCase()}${problem.why.slice(1)}。${problem.fix}`,
                };
            }
            else {
                try {
                    const configFile = await (0, sshConfigHosts_1.resolveSshConfigFile)(picked);
                    return configFile === undefined ? {} : { configFile };
                }
                catch (err) {
                    if (!(err instanceof types_1.RemoteError)) {
                        throw err;
                    }
                    refusal = {
                        message: `无法将 ${name} 用作 SSH 配置文件`,
                        detail: err.message,
                    };
                }
            }
            // It may have closed while the file was read.
            if (parent.isDestroyed()) {
                return null;
            }
            const { response } = await electron_1.dialog.showMessageBox(parent, {
                type: 'warning',
                title: '选择其他 SSH 配置文件',
                ...refusal,
                buttons: ['选择其他文件…', '取消'],
                defaultId: 0,
                cancelId: 1,
                noLink: true,
            });
            if (response !== 0 || parent.isDestroyed()) {
                return null;
            }
            defaultPath = path.dirname(picked);
        }
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
                title: 'SSH 连接失败',
                message: (0, sshErrorText_1.explanationOf)(remoteErr, label),
                detail: [detail, (0, sshErrorText_1.codeAndLogs)(remoteErr)].filter(Boolean).join('\n'),
            });
        }
    }
    /**
     * For deep link `url` (main.ts): whether it is the sign-in success page's
     * link back after an SSH window's sign-in, so no local window comes up or
     * opens for it. That window comes up if the link came within
     * SIGN_IN_RETURN_MS; a later one (its browser prompt was left up), or one
     * whose window is gone, raises nothing. Once per sign-in, and within
     * SIGN_IN_CALLBACK_TTL_MS: a local window takes any other link.
     */
    takeSignInReturn(url) {
        if (!(0, signInReturn_1.isOAuthSuccessLink)(url, (0, signInReturn_1.protocolSchemeFor)(electron_1.app.getName()))) {
            return false;
        }
        const now = performance.now();
        this.signInReturns = this.signInReturns.filter(({ at }) => now - at <= sshConnection_1.SIGN_IN_CALLBACK_TTL_MS);
        // Each sign-in's link back takes one, the latest first.
        const pending = this.signInReturns.pop();
        if (!pending) {
            return false;
        }
        const age = now - pending.at;
        const [win] = (0, windowBackends_1.windowsForHost)(pending.hostId);
        if (age > signInReturn_1.SIGN_IN_RETURN_MS || !win || win.isDestroyed()) {
            return true;
        }
        // The app first: on Linux, app.focus() focuses its first visible window.
        electron_1.app.focus({ steal: true });
        if (win.isMinimized()) {
            win.restore();
        }
        win.show();
        win.focus();
        return true;
    }
    /**
     * Reopens a window that was open on `host` when the app quit: at once, on
     * the Reconnecting page, then connects as the Disconnected page's Reconnect
     * does (not attach-only, so it may start or replace the server). A failure
     * shows on the Disconnected page, never in a sheet. Returns the window.
     */
    restoreWindow(host, { configFile, bounds, inactive } = {}) {
        const entry = this.entryFor(host, configFile);
        const [existing] = (0, windowBackends_1.windowsForHost)(entry.hostId);
        if (existing) {
            return existing;
        }
        const win = this.openWindow(entry, 'about:blank', bounds, inactive);
        if (entry.session) {
            // Connected meanwhile: its session, as onConnected loads it.
            void this.loadSession(entry, entry.session, win);
        }
        else {
            this.reopening.add(win);
            this.reconnect(entry.hostId, entry.label, entry.configFile, win)
                .finally(() => this.reopening.delete(win))
                .catch((err) => main_1.default.error(`[SSH] Could not reconnect to ${entry.label}:`, err));
        }
        return win;
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
            sshSession = await this.connectOrTakeOver(entry, {
                onStatus,
                promptParent,
            });
            // Only here, where the user connects (the picker, --ssh-host):
            // Reconnect, a window restored at startup and automatic reconnects
            // leave a host the user removed from Recent out of it.
            this.recentHosts.remember(entry.label, entry.configFile);
        }
        catch (err) {
            // Forget a host that never connected, so its next spelling starts over.
            if (!entry.attempt &&
                !entry.session &&
                !entry.question &&
                (0, windowBackends_1.windowsForHost)(entry.hostId).length === 0) {
                void this.disposeHost(entry);
            }
            throw err;
        }
        if (entry.disposed) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        const win = await this.hostWindow(entry, sshSession);
        void this.afterConnect(entry);
        return win;
    }
    /** The host's window, focused, or a new one on the session. */
    async hostWindow(entry, sshSession) {
        const [existing] = (0, windowBackends_1.windowsForHost)(entry.hostId);
        if (existing) {
            return focused(existing);
        }
        let url;
        let failed;
        try {
            url = await this.uiUrl(entry, sshSession);
        }
        catch (err) {
            failed = (0, sshConnection_1.toRemoteError)(err);
            if (failed.code === 'CANCELLED') {
                throw failed;
            }
        }
        if (entry.disposed) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        // Another connect that joined may have opened it meanwhile.
        const [opened] = (0, windowBackends_1.windowsForHost)(entry.hostId);
        if (opened) {
            return focused(opened);
        }
        // Opened without a token too: it says why, and the session stays, so
        // its page can mint again (Reconnect) or stop the server.
        const win = this.openWindow(entry, url ?? 'about:blank');
        if (failed) {
            this.failLoad(entry, sshSession, win, failed);
        }
        return win;
    }
    /**
     * connectEntry, offering on its prompt parent to take the server over when
     * another host that shares the home directory runs it.
     */
    async connectOrTakeOver(entry, options) {
        try {
            return await this.connectEntry(entry, options);
        }
        catch (err) {
            const { code, otherHost } = (0, sshConnection_1.toRemoteError)(err);
            const parent = options.promptParent;
            if (code !== 'SHARED_HOME_UNSUPPORTED' ||
                !otherHost ||
                !parent ||
                entry.disposed) {
                throw err;
            }
            const { host, pid } = otherHost;
            const displace = { kind: 'takeOver', server: { host, pid } };
            const onHostWindow = (0, windowBackends_1.windowsForHost)(entry.hostId).includes(parent);
            const yes = await this.askOnce(entry, displace, parent, takeOverSheet(entry, otherHost, onHostWindow));
            if (entry.disposed) {
                throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
            }
            // Another connect reached the server meanwhile (that closed the sheet).
            if (entry.session) {
                return entry.session;
            }
            if (!yes) {
                throw err;
            }
            return await this.connectEntry(entry, { ...options, displace });
        }
    }
    /**
     * Whether to stop that server for ours, asked on `win` as a host question
     * (armed, after the window's other sheets) once for every caller that hits
     * it. Undefined: no answer (see HostQuestions.ask), e.g. a session, the
     * host's disposal or `closeWith` closed it.
     */
    askOnce(entry, displace, win, options, closeWith) {
        const key = displaceKey(displace);
        if (entry.question?.key === key) {
            return entry.question.answer;
        }
        // One about another server is moot now.
        entry.question?.close.abort();
        const close = new AbortController();
        const signal = closeWith
            ? AbortSignal.any([close.signal, closeWith])
            : close.signal;
        const answer = this.hostQuestions.ask(win, { ...options, signal }).then((box) => (box ? box.response === 0 : undefined), (err) => {
            main_1.default.warn(`[SSH] Could not ask "${options.title}":`, err);
            return undefined;
        });
        const question = { key, answer, close };
        entry.question = question;
        void answer.finally(() => {
            if (entry.question === question) {
                entry.question = undefined;
            }
        });
        return answer;
    }
    /** The host's session: connects, or joins the connect in flight. */
    async connectEntry(entry, { onStatus, attachOnly = false, promptParent, displace, } = {}) {
        if (entry.session) {
            return entry.session;
        }
        if (onStatus) {
            entry.statusListeners.add(onStatus);
        }
        try {
            const attempt = this.joinAttempt(entry, attachOnly, (0, sshAskpass_1.canPrompt)() ? promptParent : undefined, displace);
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
    joinAttempt(entry, attachOnly, promptParent, displace) {
        if (promptParent && !this.watchedParents.has(promptParent)) {
            // Also before askOn picks it, e.g. while ssh -V runs.
            this.watchedParents.add(promptParent);
            promptParent.once('close', () => this.closingWindows.add(promptParent));
        }
        // Stopping a server is its own run, which only one for the same joins.
        const current = !displace ||
            (entry.attempt?.displace &&
                displaceKey(entry.attempt.displace) === displaceKey(displace))
            ? entry.attempt
            : undefined;
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
            : this.openConnection(entry, attachOnly, promptParents, displace);
        const attempt = {
            session: session.finally(() => {
                if (entry.attempt === attempt) {
                    entry.attempt = undefined;
                }
            }),
            attachOnly,
            promptParents,
            displace,
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
    /**
     * Connects. If replacing a server fails (its own error), it attaches to
     * that server, or starts ours if it's gone, and tells the user once the
     * window shows (afterConnect).
     */
    async openConnection(entry, attachOnly, promptParents, displace) {
        if (displace?.kind !== 'replace') {
            return this.connectOnce(entry, attachOnly, promptParents, displace);
        }
        const replace = displace.server;
        try {
            return await this.connectOnce(entry, false, promptParents, displace);
        }
        catch (err) {
            const remoteErr = (0, sshConnection_1.toRemoteError)(err);
            if (entry.disposed || remoteErr.code === 'CANCELLED') {
                throw err;
            }
            this.logError(remoteErr, entry.label, 'Could not restart the SSH server');
            // Not again for this server while the app runs.
            this.keepServer(entry, replace, 'failed');
            const sshSession = await this.connectOnce(entry, false, promptParents);
            if (sshSession.discovery.lsVersion !== sshSession.expectedVersion) {
                entry.replaceFailure = { server: replace, error: remoteErr };
            }
            return sshSession;
        }
    }
    async connectOnce(entry, attachOnly, promptParents, displace) {
        // In parallel: on the first connect each can take seconds.
        const [loginEnv, artifacts] = await Promise.all([
            this.inputs.loginShellEnv(),
            this.inputs.serverFor(attachOnly),
        ]);
        if (entry.disposed) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        // ssh runs with it.
        const env = { ...process.env, ...loginEnv };
        // Off the prompt path: ssh -V runs while ssh starts.
        const hostPromptsMarked = promptParents
            ? (0, sshPrompts_1.sshMarksHostPrompts)(env)
            : Promise.resolve(false);
        const conn = new sshConnection_1.SshConnection({
            destination: entry.destination,
            configFile: entry.configFile,
            label: entry.label,
            server: artifacts,
            attachOnly,
            displace,
            askpass: promptParents && {
                nodeBinary: (0, nodeWrapper_1.electronNodeBinary)(),
                // Awaited before askOn picks a window: askOnWindow runs on to its
                // close guard with nothing awaited.
                ask: async (prompt) => this.askOn(promptParents, entry.label, {
                    ...prompt,
                    hostPromptsMarked: await hostPromptsMarked,
                }),
            },
            userDataDir: electron_1.app.getPath('userData'),
            appDataDirName: (0, paths_1.getAppDataDirName)(),
            createTransport: (socksPort) => (0, transport_1.openTransport)(entry.hostId, socksPort),
            openExternal: (url) => (0, externalUrl_1.openExternalSafely)(url, 'unconfirmed'),
            confirmOrganizationSignIn: (provider, signal) => this.confirmOrganizationSignIn(entry, provider, signal),
            confirmLoopbackSignIn: (origin, signal) => this.confirmLoopbackSignIn(entry, origin, signal),
            // As after a local sign-in; its link back brings up this host's window.
            signInSuccessUrl: (0, signInReturn_1.authSuccessUrl)((0, signInReturn_1.protocolSchemeFor)(electron_1.app.getName())),
            onSignedIn: () => {
                const at = performance.now();
                this.signInReturns = [
                    // A few at most: each needs its own sign-in, which asks first.
                    ...this.signInReturns.slice(-(exports.MAX_PENDING_SIGN_IN_RETURNS - 1)),
                    { hostId: entry.hostId, at },
                ];
            },
            env,
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
                this.reportError(err, entry.label, '登录失败', win);
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
            const older = attachOnly || displace?.kind === 'replace'
                ? undefined
                : this.olderServer(entry, sshSession, artifacts);
            if (older) {
                // Replaced at once only with nothing loaded and no terminal open (any
                // may run an agent, a task or a job); else the user decides, once the
                // window shows (afterConnect). Never on an automatic reconnect.
                const { trajectories, terminals } = await conn.remoteActivity();
                if (entry.disposed || entry.connection !== conn) {
                    throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
                }
                if (dropped) {
                    throw dropped;
                }
                if (trajectories === 0 && terminals === 0) {
                    main_1.default.info(`[SSH] ${entry.label} runs an older Antigravity server (${(0, types_1.sanitizeRemoteText)(older.version, 64)}) with no conversations or terminals; restarting it with ${sshSession.expectedVersion}.`);
                    entry.connection = undefined;
                    this.trackDisposal(conn.dispose());
                    return await this.openConnection(entry, false, promptParents, {
                        kind: 'replace',
                        server: older,
                    });
                }
                entry.replaceOffer = { server: older, terminals };
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
        entry.lastServerPid = sshSession.discovery.pid;
        entry.poolMisses = 0;
        // A question about the server that's up is moot now.
        entry.question?.close.abort();
        clearTimeout(entry.reconnectTimer); // E.g. connected from a local window.
        entry.reconnectTimer = undefined;
        main_1.default.info(`[SSH] Connected to ${entry.label} at ${sshSession.url}`);
        const running = sshSession.discovery.lsVersion;
        if (running !== sshSession.expectedVersion) {
            main_1.default.info(`[SSH] ${entry.label} runs Antigravity server ${(0, types_1.sanitizeRemoteText)(running, 64)}; this app uses ${sshSession.expectedVersion}.`);
        }
        for (const win of (0, windowBackends_1.windowsForHost)(entry.hostId)) {
            void this.loadSession(entry, sshSession, win);
        }
    }
    /** Loads the session in `win`, unless a drop or another session came first. */
    async loadSession(entry, sshSession, win) {
        let url;
        try {
            url = await this.uiUrl(entry, sshSession);
        }
        catch (err) {
            this.failLoad(entry, sshSession, win, (0, sshConnection_1.toRemoteError)(err));
            return;
        }
        if (entry.session !== sshSession || win.isDestroyed()) {
            return;
        }
        // E.g. ERR_ABORTED: the window closed or navigated during the load.
        win
            .loadURL(url)
            .catch((err) => main_1.default.warn(`[SSH] Could not load ${entry.label} in its window:`, withoutUiToken(err)));
    }
    /**
     * The session's URL for one load, with a one-time token (#t=) that the
     * page trades for the LS's CSRF token: then the LS gives the token to no
     * one who just loads its page. Without one (an older LS), the plain URL:
     * such an LS puts the token in the page.
     * @throws RemoteError CANCELLED once the session ended or another came;
     *   else why its server gave no token, twice in a row
     */
    async uiUrl(entry, sshSession) {
        const conn = entry.connection;
        const current = () => !entry.disposed &&
            entry.connection === conn &&
            entry.session === sshSession;
        if (!conn || !current()) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        let token;
        try {
            token = await conn.mintUiBootstrapToken();
        }
        catch (err) {
            // Once more, unless the session ended meanwhile.
            if ((0, sshConnection_1.toRemoteError)(err).code === 'CANCELLED' || !current()) {
                throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
            }
            token = await conn.mintUiBootstrapToken();
        }
        if (token === undefined) {
            return sshSession.url;
        }
        // From the first token on, so a Hub without SSH windows logs as before.
        if (!main_1.default.hooks.includes(redactUiTokensInLog)) {
            main_1.default.hooks.push(redactUiTokensInLog);
        }
        return `${sshSession.url}#t=${encodeURIComponent(token)}`;
    }
    /**
     * Shows in `win` why it can't load the session (its server gave no UI
     * token). The session stays: the page's Reconnect mints again, and its Stop
     * Server stands in for the toolkit's Stop SSH Server, which can't load.
     */
    failLoad(entry, sshSession, win, err) {
        // A drop or another session came first, and shows its own page.
        if (err.code === 'CANCELLED' || entry.session !== sshSession) {
            return;
        }
        this.logError(err, entry.label, 'Could not load its window');
        (0, disconnectedPage_1.showDisconnectedPage)(win, {
            state: 'disconnected',
            detail: (0, sshErrorText_1.userMessage)(err, entry.label),
            canStop: true,
            label: entry.label,
            dark: !(0, utils_1.isLightTheme)(),
        });
    }
    openWindow(entry, initialUrl, initialState, inactive = false) {
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
                askMicrophone: (contents) => this.askMicrophone(hostId, label, contents),
                microphoneRefused: () => this.microphoneAnswers.get(hostId) === false,
            });
            // Sidecar UIs: the host's current session routes and fetches them.
            (0, remoteSidecars_1.installRemoteSidecarProtocol)(ses, () => current()?.connection);
            const created = (0, utils_1.createWindow)(initialUrl, this.deps.mainStorage, {
                cascade: true,
                initialState,
                inactive,
                // Its own bounds are kept by sshWindowRestore: it mustn't set where
                // the local window opens next time.
                persistBounds: false,
                partition,
                titleSuffix: ` (SSH: ${label})`,
                additionalArguments: ['--agy-backend=ssh'],
                builtInBrowser: false,
                navigationPolicy: (0, remoteWindowSecurity_1.remoteNavigationPolicy)(allowedOrigin, (action) => {
                    if (action === 'reconnect') {
                        this.reconnect(hostId, label, configFile, created).catch((err) => main_1.default.error(`[SSH] Could not reconnect to ${label}:`, err));
                    }
                    else if (action === 'stop') {
                        this.confirmAndStopServer(created).catch((err) => main_1.default.error(`[SSH] Could not stop the server on ${label}:`, err));
                    }
                    else {
                        created.close();
                    }
                }, (url) => this.openUrlForHost(hostId, url)),
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
        this.deps.onWindowOpened?.(win, { host: label, configFile });
        return win;
    }
    /** The Disconnected page's Reconnect button, in `win`. */
    async reconnect(hostId, label, configFile, win) {
        if ((0, windowBackends_1.windowsForHost)(hostId).length === 0) {
            return;
        }
        const entry = this.hosts.get(hostId) ?? this.entryFor(label, configFile);
        if (entry.session) {
            // Up, but this window's load failed (no UI token), or connected
            // meanwhile (e.g. from a local window): load it again, newly minted.
            (0, disconnectedPage_1.showDisconnectedPage)(win, {
                state: 'connecting',
                label: entry.label,
                dark: !(0, utils_1.isLightTheme)(),
            });
            await this.loadSession(entry, entry.session, win);
            return;
        }
        this.showPage(entry, { state: 'connecting' });
        // A replace or take-over stops the server, and its agents.
        const stopping = ['replacing', 'taking over'].map((s) => (0, sshConnection_1.describeStatus)(s, entry.label));
        try {
            // onConnected reloads the host's windows.
            await this.connectOrTakeOver(entry, {
                promptParent: win,
                onStatus: (text) => {
                    if (stopping.includes(text)) {
                        this.showPage(entry, { state: 'restarting' });
                    }
                },
            });
            void this.afterConnect(entry);
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
    /**
     * The running server, if this app replaces it: a release older than ours
     * (serverVersion.ts), which we can install, and not one whose replacing
     * failed while the app runs.
     */
    olderServer(entry, sshSession, { resolutionError }) {
        const server = serverOf(sshSession);
        if (!(0, serverVersion_1.isNewerRelease)(sshSession.expectedVersion, server.version)) {
            return undefined;
        }
        const kept = this.keptServers.get(entry.hostId);
        if (kept?.key === serverKey(server) && kept.why === 'failed') {
            return undefined;
        }
        if (resolutionError) {
            main_1.default.info(`[SSH] Not replacing the older server on ${entry.label}: ${resolutionError}`);
            return undefined;
        }
        return server;
    }
    keepServer(entry, server, why) {
        this.keptServers.set(entry.hostId, { key: serverKey(server), why });
    }
    /**
     * Once the host's window shows the new session: reports a failed restart,
     * or asks whether to restart an older server that's busy (or might be).
     */
    async afterConnect(entry) {
        const { replaceFailure: failure, replaceOffer: offer } = entry;
        entry.replaceFailure = undefined;
        entry.replaceOffer = undefined;
        const [win] = (0, windowBackends_1.windowsForHost)(entry.hostId);
        if (!win || entry.disposed || !entry.session) {
            return;
        }
        if (failure) {
            const running = (0, types_1.sanitizeRemoteText)(failure.server.version, 64);
            await this.showSheet(win, {
                type: 'warning',
                title: '无法重启 SSH 服务端',
                message: `${entry.label} 仍在运行 Antigravity 服务端 ${running}。`,
                detail: [
                    (0, sshErrorText_1.detailOf)(failure.error, entry.label),
                    (0, sshErrorText_1.codeAndLogs)(failure.error),
                ].join('\n'),
            });
            return;
        }
        if (offer) {
            await this.askToRestart(entry, offer, win);
        }
    }
    async askToRestart(entry, offer, win) {
        const { connection: conn, session: sshSession } = entry;
        const { server } = offer;
        if (!conn ||
            !sshSession ||
            serverKey(serverOf(sshSession)) !== serverKey(server) ||
            this.keptServers.get(entry.hostId)?.key === serverKey(server)) {
            return;
        }
        const sheet = restartSheet(entry.label, offer, sshSession.expectedVersion);
        // A drop closes it, which isn't an answer.
        const restart = await this.askOnce(entry, { kind: 'replace', server }, win, sheet, conn.closedSignal);
        if (restart === false) {
            // Later: asked again after the app restarts, replaced meanwhile only
            // once it has nothing loaded or open.
            this.keepServer(entry, server, 'later');
        }
        if (!restart ||
            entry.disposed ||
            entry.connection !== conn ||
            entry.session !== sshSession ||
            entry.attempt ||
            entry.stopPhase) {
            return; // Changed meanwhile: its own path shows it.
        }
        await this.restartServer(entry, server, win);
    }
    /** Replaces the host's server with ours, the window showing progress. */
    async restartServer(entry, server, win) {
        const old = entry.connection;
        // Detached first: its end is ours, not a drop to reconnect from.
        entry.connection = undefined;
        entry.session = undefined;
        if (old) {
            this.trackDisposal(old.dispose());
        }
        this.showPage(entry, { state: 'restarting' });
        try {
            // onConnected loads the new session in the host's windows.
            await this.connectEntry(entry, {
                promptParent: win,
                displace: { kind: 'replace', server },
            });
            void this.afterConnect(entry);
        }
        catch (err) {
            const remoteErr = (0, sshConnection_1.toRemoteError)(err);
            if (entry.disposed ||
                (remoteErr.code === 'CANCELLED' && !remoteErr.userCancelled)) {
                return;
            }
            this.logError(remoteErr, entry.label, 'Restart failed');
            this.showPage(entry, {
                state: 'disconnected',
                detail: (0, sshErrorText_1.userMessage)(remoteErr, entry.label),
            });
        }
    }
    /** Like Reconnect, but it only attaches, and retries network failures. */
    reconnectLater(entry) {
        clearTimeout(entry.reconnectTimer);
        // ±25%, so that clients a host blip dropped come back apart, not all at
        // once against sshd's MaxStartups.
        const delay = Math.min(FIRST_RECONNECT_DELAY_MS * 2 ** entry.reconnectAttempts, MAX_RECONNECT_DELAY_MS) *
            (0.75 + Math.random() / 2);
        entry.reconnectAttempts++;
        entry.reconnectTimer = setTimeout(() => this.reconnectNow(entry), delay);
    }
    /** reconnectLater's attempt, when its wait is over (or cut short). */
    reconnectNow(entry) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = undefined;
        this.connectEntry(entry, { attachOnly: true }).catch((err) => {
            const remoteErr = (0, sshConnection_1.toRemoteError)(err);
            // Cancelled by a teardown: the host was disposed (window closed, Stop,
            // or quit). A prompt's Cancel, in a connect it joined, shows.
            if (entry.disposed ||
                (remoteErr.code === 'CANCELLED' && !remoteErr.userCancelled)) {
                return;
            }
            this.logError(remoteErr, entry.label, 'Reconnect failed');
            // Another machine sharing the home answered: its own budget, so that
            // the network's failures before it don't use it up.
            const miss = remoteErr.code === 'SHARED_HOME_UNSUPPORTED';
            if (miss) {
                entry.poolMisses++;
            }
            // It names another server than this window's: that one stopped, and
            // its agents with it (taken over from there).
            const moved = miss &&
                remoteErr.otherHost !== undefined &&
                remoteErr.otherHost.pid !== entry.lastServerPid;
            if (remoteErr.retryable &&
                entry.reconnectAttempts < MAX_RECONNECT_ATTEMPTS &&
                (!miss || entry.poolMisses < POOL_RECONNECT_ATTEMPTS)) {
                if (moved) {
                    this.showPage(entry, { state: 'connecting', serverStopped: true });
                }
                this.reconnectLater(entry);
            }
            else {
                this.showPage(entry, {
                    state: 'disconnected',
                    detail: (0, sshErrorText_1.userMessage)(remoteErr, entry.label),
                    serverStopped: remoteErr.code === 'LS_STOPPED' || moved,
                });
            }
        });
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
            serverStopped: err.code === 'LS_STOPPED',
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
            ({ response } = await this.hostQuestions.queue(win, async () => {
                // Cancel for a window that closed while earlier sheets were up.
                if (win.isDestroyed()) {
                    return { response: 1, checkboxChecked: false };
                }
                return electron_1.dialog.showMessageBox(win, {
                    type: 'warning',
                    buttons: ['停止服务端', '取消'],
                    defaultId: 1,
                    cancelId: 1,
                    title: '停止 SSH 服务端',
                    message: `停止 ${entry.label} 上的 Antigravity 服务端？`,
                    detail: '在此主机上运行的智能体将停止，且其窗口将关闭。下次连接时服务端将重新启动。',
                    // A drop closes it as Cancel.
                    signal: conn.closedSignal,
                });
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
                this.reportError(err, entry.label, '无法停止 SSH 服务端', win);
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
    /**
     * After the window's other sheets. One of these at a time per window, and
     * none queued behind it: a host can send errors endlessly.
     */
    async showSheet(parent, options) {
        if (parent.isDestroyed() || this.openSheets.has(parent)) {
            return;
        }
        this.openSheets.add(parent);
        try {
            await this.hostQuestions.queue(parent, async () => {
                if (!parent.isDestroyed()) {
                    await electron_1.dialog.showMessageBox(parent, options);
                }
            });
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
     * after that window's earlier ones, and for a window reopened at startup
     * after the other reopened windows' too; Cancel if none is open.
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
        const turns = parents.some((w) => this.reopening.has(w))
            ? [parent, this.reopening]
            : [parent];
        // Picked again at its turn (the window may be closing or gone, or a
        // caller joined); a prompt that moves frees its slots first.
        const shown = Promise.all(turns.map((t) => this.promptChains.get(t))).then(() => (newest() === parent ? (0, sshPrompts_1.askOnWindow)(parent, label, prompt) : null));
        const done = () => undefined;
        for (const turn of turns) {
            this.promptChains.set(turn, shown.then(done, done));
        }
        return shown
            .then((answer) => answer ?? this.askOn(parents, label, prompt))
            .finally(() => parent.off('close', closing));
    }
    logError(err, label, title) {
        main_1.default.error(`[SSH] ${label}: ${title}: ${err.code} ${(0, types_1.sanitizeRemoteText)(err.message)}`);
    }
    /**
     * Forgets the user's microphone answer for a host, so its next request
     * asks again: for the host picker's Forget host.
     */
    forgetMicrophoneAnswer(host, configFile) {
        try {
            // As entryFor() keys the host.
            this.microphoneAnswers.delete((0, sshDestination_1.hostIdFor)((0, sshDestination_1.parseSshDestination)(host).destination, configFile));
        }
        catch {
            // No host this app could have connected to: no answer.
        }
    }
    /**
     * Whether `contents`' host may use the microphone (a getUserMedia for it
     * alone, from that window's own page): asks once per host, on that window
     * while it's focused, as a host question. False for no, or no answer.
     */
    askMicrophone(hostId, label, contents) {
        const known = this.microphoneAnswers.get(hostId);
        if (known !== undefined) {
            return Promise.resolve(known);
        }
        const open = this.microphoneQuestions.get(hostId);
        if (open) {
            return open;
        }
        const win = electron_1.BrowserWindow.fromWebContents(contents);
        // The page decides when it asks: never while you're in another window.
        if (!win || win.isDestroyed() || !win.isFocused()) {
            return Promise.resolve(false);
        }
        const question = this.hostQuestions
            .ask(win, {
            type: 'question',
            buttons: ['允许', '不允许'],
            // The host decides when this shows: a Return meant for it mustn't allow.
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: '麦克风访问权限',
            message: `允许 ${label} 使用您的麦克风吗？`,
            detail: `此窗口中的页面来自 ${label}。如果允许，只要该主机的任一窗口处于打开状态，该主机即可使用本机的麦克风进行语音交互。退出 Antigravity 后将重新询问。`,
            signal: this.hosts.get(hostId)?.connection?.closedSignal,
        })
            .then((answer) => {
            if (answer === undefined) {
                return false; // No answer: nothing to remember.
            }
            const allowed = answer.response === 0;
            this.microphoneAnswers.set(hostId, allowed);
            return allowed;
        }, () => false)
            .finally(() => this.microphoneQuestions.delete(hostId));
        this.microphoneQuestions.set(hostId, question);
        return question;
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
        const answer = await this.hostQuestions.ask(parent, {
            type: 'question',
            buttons: ['登录', '取消'],
            // The host decides when this shows: a Return meant for it mustn't accept.
            defaultId: 1,
            cancelId: 1,
            title: '登录',
            message: `为 ${entry.label} 登录到您的组织？`,
            detail: '仅当您刚刚在此窗口中选择使用组织账号登录时才继续。' +
                `${entry.label} 将获得您组织的 Google Cloud 账户访问权限。\n` +
                (names
                    ? `员工池：${names[1]}  提供商：${names[2]}`
                    : `身份提供商：${provider}`),
            // Closes with its connection: a later yes would open nothing.
            signal,
        });
        return answer?.response === 0;
    }
    /**
     * Before a sign-in the host's window opened (e.g. a plugin's) sends its
     * callback to the host: the host's own loopback gets the code, so a host
     * that opened it unasked would get an account the user once allowed.
     */
    async confirmLoopbackSignIn(entry, origin, // An https origin, checked by SshConnection.
    signal) {
        const [parent] = (0, windowBackends_1.windowsForHost)(entry.hostId);
        // No window, no question: an app-modal one would block every window.
        if (entry.disposed || !parent) {
            return false;
        }
        const answer = await this.hostQuestions.ask(parent, {
            type: 'question',
            buttons: ['继续', '取消'],
            // The host decides when this shows: a Return meant for it mustn't accept.
            defaultId: 1,
            cancelId: 1,
            title: '登录',
            message: `在 ${entry.label} 上完成此次登录？`,
            detail: `仅当您刚刚在 ${entry.label} 窗口中发起登录时才继续。您的浏览器将打开登录页面；完成登录后，${entry.label} 将获得该账户的访问权限。\n` +
                `登录页面：${(0, types_1.sanitizeRemoteText)(new URL(origin).host, 200)}`,
            signal,
        });
        return answer?.response === 0;
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
                poolMisses: 0,
                connectedAt: 0,
                disposed: false,
                blockedRequests: 0,
            };
            this.hosts.set(hostId, entry);
            // Wakes matter from the first host on. Electron makes its power monitor
            // on the first listener, with an OS sleep hook (on Linux, a logind
            // inhibitor), so a Hub that never uses SSH gets none.
            if (!electron_1.powerMonitor.listeners('resume').includes(this.onResume)) {
                electron_1.powerMonitor.on('resume', this.onResume);
            }
        }
        return entry;
    }
    /**
     * Marks every host closed (window closes and drops then do nothing) and
     * signals ssh, then waits for it. On quit, call it before destroying windows.
     */
    async disposeAll() {
        electron_1.powerMonitor.removeListener('resume', this.onResume);
        // First: main.ts destroys every window next, parents first, and a modal
        // child destroyed after its parent crashes Electron.
        (0, sshPrompts_1.destroyPromptWindows)();
        this.signInReturns = [];
        for (const entry of [...this.hosts.values()]) {
            void this.disposeHost(entry);
        }
        await Promise.allSettled([...this.disposals]);
    }
    disposeHost(entry) {
        entry.disposed = true;
        clearTimeout(entry.reconnectTimer);
        entry.question?.close.abort();
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
function focused(win) {
    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();
    return win;
}
/** A one-time UI token in a URL (`#t=…`), wherever text carries it. */
const UI_TOKEN_IN_TEXT = /#t=[^\s'"]*/g;
function redactUiTokens(text) {
    return text.replace(UI_TOKEN_IN_TEXT, '#t=<redacted>');
}
/** `err`, or a copy without the one-time UI token a load's error may show. */
function withoutUiToken(err) {
    return err instanceof Error && err.message.includes('#t=')
        ? new Error(redactUiTokens(err.message))
        : err;
}
/**
 * An electron-log hook that keeps one-time UI tokens out of every log line,
 * e.g. out of the "Failed to load URL: …#t=…" warning Electron emits for a
 * failed load, which reaches the log through console.error.
 */
function redactUiTokensInLog(message) {
    return {
        ...message,
        data: message.data.map((item) => typeof item === 'string' ? redactUiTokens(item) : withoutUiToken(item)),
    };
}
function serverOf({ discovery }) {
    return { version: discovery.lsVersion, pid: discovery.pid };
}
/** Which server it stops: connects and questions for the same one are one. */
function displaceKey(d) {
    return d.kind === 'replace'
        ? `replace ${serverKey(d.server)}`
        : `takeOver ${d.server.host} ${d.server.pid}`;
}
/**
 * Whether to take the server over from `other` (row 18). `onHostWindow`:
 * asked on one of the host's windows, whose server this connect, in a pool,
 * may just have missed.
 */
function takeOverSheet({ label, lastServerPid }, { host, here, pid, state }, onHostWindow) {
    const live = state === 'live';
    const own = live && pid === lastServerPid && onHostWindow;
    return {
        type: 'warning',
        buttons: ['接管', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: '共享主目录冲突',
        message: own
            ? `此窗口对应的 Antigravity 服务端正在与您共享主目录的另一台机器 ${host} 上运行。`
            : live
                ? `您的 Antigravity 服务端正在与您共享主目录的另一台机器 ${host} 上运行。`
                : `与您共享主目录的另一台机器 ${host} 启动了您的 Antigravity 服务端。`,
        detail: own
            ? `本次 ${label} 连接到了 ${here}。点击“取消”并重新连接可再次尝试连接 ${host}；或选择“接管”以停止 ${host} 上的服务端及其智能体，并改为在 ${here} 上运行。`
            : live
                ? `${label} 连接到了 ${here}。选择“接管”将停止 ${host} 上的服务端及其智能体，并改为在 ${here} 上运行。若要保持其继续运行，请直接连接到 ${host}。`
                : `${label} 连接到了 ${here}。请仅在确认原服务端已停止运行（例如 ${host} 已关机或被替换）时才选择“接管”：若原服务端仍在运行，两个服务端将同时写入同一批文件。如需核实，请连接到 ${host}。`,
    };
}
/** Whether to restart an older server that's busy, or might be. */
function restartSheet(label, { server, terminals }, expected) {
    const running = (0, types_1.sanitizeRemoteText)(server.version, 64);
    // Any may run agents, tasks or jobs: the LS doesn't say which.
    const what = terminals === 0 ? '智能体或后台任务' : '智能体、后台任务或终端会话';
    return {
        type: 'question',
        buttons: ['立即重启', '稍后'],
        // Shows by itself: a Return meant for the page mustn't restart.
        defaultId: 1,
        cancelId: 1,
        title: '重启 SSH 服务端',
        message: `${label} 当前运行的服务端版本为 ${running}，而本应用版本为 ${expected}。是否立即重启服务端？`,
        detail: `其上仍在运行的任何${what}都将停止，随后服务端将以本应用的版本重新启动。`,
    };
}
/** One server process: its version and pid. */
function serverKey({ version, pid }) {
    return `${version}/${pid}`;
}
