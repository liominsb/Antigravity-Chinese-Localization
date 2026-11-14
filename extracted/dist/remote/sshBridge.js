"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSH_INTENT_CHANNEL = void 0;
exports.registerSshBridgeIpc = registerSshBridgeIpc;
/**
 * Main-process side of window.sshRemote. preload.ts declares its API; the
 * toolkit mirrors it in src/features/sshRemote/sshRemoteBridge.ts.
 */
const electron_1 = require("electron");
const main_1 = __importDefault(require("electron-log/main"));
const utils_1 = require("../utils");
const remoteWindowSecurity_1 = require("./remoteWindowSecurity");
const types_1 = require("./types");
const windowBackends_1 = require("./windowBackends");
const SSH_CONNECT_INTENTS = ['newProject'];
/** Tells an SSH window that it has an intent to take (ssh:take-intent). */
exports.SSH_INTENT_CHANNEL = 'ssh:intent';
/** Same as sshDestination.ts's limit. */
const MAX_HOST_INPUT = 1024;
const MAX_CONFIG_FILE_INPUT = 4096;
const BAD_CONFIG_FILE = 'The SSH config file must be a path of at most 4 KiB.';
/** The page's `{configFile}` (null means none); undefined if it isn't one. */
function configFileOption(options) {
    const value = typeof options === 'object' && options !== null && 'configFile' in options
        ? options.configFile
        : undefined;
    if (value === undefined || value === null) {
        return {};
    }
    return typeof value === 'string' &&
        Buffer.byteLength(value) <= MAX_CONFIG_FILE_INPUT
        ? { configFile: value }
        : undefined;
}
function parseConnectOptions(options) {
    if (typeof options !== 'object' || options === null) {
        return {};
    }
    const value = 'intent' in options ? options.intent : undefined;
    const intent = SSH_CONNECT_INTENTS.find((i) => i === value);
    if (value !== undefined && !intent) {
        // A newer toolkit's: connect anyway. The value isn't logged (page input).
        main_1.default.warn('[SSH] Ignoring an unknown connect intent.');
    }
    const requestId = 'requestId' in options ? options.requestId : undefined;
    return typeof requestId === 'number' &&
        Number.isSafeInteger(requestId) &&
        requestId > 0
        ? { requestId, intent }
        : { intent };
}
function registerSshBridgeIpc(backend) {
    const localOnly = (channel, event) => {
        if (!(0, utils_1.isLocalHubTopFrame)(event)) {
            throw new Error(`${channel} is only available in local windows`);
        }
    };
    // Any frame of an SSH window may use these: its host serves them all.
    const sshOnly = (channel, event) => {
        if (!(0, windowBackends_1.remoteBackendOf)(event.sender)) {
            throw new Error(`${channel} is only available in SSH windows`);
        }
    };
    electron_1.ipcMain.handle('ssh:get-state', (event) => {
        // Remote contents get only their own host (RemoteManager.getState).
        if (!(0, remoteWindowSecurity_1.isRemoteContents)(event.sender)) {
            localOnly('ssh:get-state', event);
        }
        return backend.getState(event.sender);
    });
    electron_1.ipcMain.handle('ssh:list-hosts', (event, options) => {
        localOnly('ssh:list-hosts', event);
        const file = configFileOption(options);
        if (!file) {
            throw new types_1.RemoteError('INVALID_DESTINATION', BAD_CONFIG_FILE);
        }
        return backend.listHosts(file);
    });
    electron_1.ipcMain.handle('ssh:choose-config-file', (event) => {
        localOnly('ssh:choose-config-file', event);
        return backend.chooseConfigFile(event.sender);
    });
    electron_1.ipcMain.handle('ssh:connect', async (event, host, options) => {
        localOnly('ssh:connect', event);
        if (typeof host !== 'string' || host.length > MAX_HOST_INPUT) {
            return {
                ok: false,
                code: 'INVALID_DESTINATION',
                message: 'Enter an SSH host, for example "devbox" or "user@host".',
            };
        }
        const file = configFileOption(options);
        if (!file) {
            return {
                ok: false,
                code: 'INVALID_DESTINATION',
                message: BAD_CONFIG_FILE,
            };
        }
        const { requestId, intent } = parseConnectOptions(options);
        const sender = event.sender;
        const onProgress = (message) => {
            if (requestId !== undefined && !sender.isDestroyed()) {
                const progress = { requestId, message };
                try {
                    sender.send('ssh:progress', progress);
                }
                catch {
                    // The window is closing.
                }
            }
        };
        return backend.connect(sender, host, onProgress, { intent, ...file });
    });
    // Keyed by the sender: a window only ever gets its own intent.
    electron_1.ipcMain.handle('ssh:take-intent', (event) => {
        sshOnly('ssh:take-intent', event);
        return backend.takeIntent(event.sender);
    });
    electron_1.ipcMain.handle('ssh:stop-server', async (event) => {
        sshOnly('ssh:stop-server', event);
        await backend.stopServer(event.sender);
    });
    // Remote content mustn't pop up windows while you're elsewhere.
    electron_1.ipcMain.handle('ssh:open-local-window', (event) => {
        sshOnly('ssh:open-local-window', event);
        if (!electron_1.BrowserWindow.fromWebContents(event.sender)?.isFocused()) {
            throw new Error('ssh:open-local-window is only available while the window is focused');
        }
        backend.openLocalWindow();
    });
}
