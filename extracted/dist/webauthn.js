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
exports.configureSessionWebAuthn = exports.WEBVIEW_WEBAUTHN_PRELOAD_PATH = void 0;
exports.configurePlatformWebAuthn = configurePlatformWebAuthn;
exports.attachWebviewWebAuthnUserActivationTracking = attachWebviewWebAuthnUserActivationTracking;
exports.formatWebAuthnAccountLabel = formatWebAuthnAccountLabel;
exports.createWebAuthnSessionConfigurator = createWebAuthnSessionConfigurator;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const cablev2_1 = require("./cablev2");
const utils_1 = require("./utils");
/** Absolute path to the compiled `<webview>` WebAuthn frame preload script. */
exports.WEBVIEW_WEBAUTHN_PRELOAD_PATH = path.join(__dirname, 'webviewWebAuthnPreload.js');
/**
 * Configures macOS `caBLEv2` Hybrid Transport IPC handlers for WebAuthn
 * requests (`navigator.credentials.get`). No-op on non-macOS platforms.
 *
 * Note: macOS Touch ID / Secure Enclave (`app.configureWebAuthn`) is not
 * enabled because `keychain-access-groups` is a restricted Apple entitlement
 * enforced by AMFI against an embedded `.provisionprofile`, which terminates
 * Developer-ID-signed desktop distributions that do not bundle a provisioning
 * profile.
 */
function configurePlatformWebAuthn(options) {
    const platform = options?.platform ?? process.platform;
    if (platform !== 'darwin') {
        return;
    }
    const registerCableIpc = options?.registerCableIpc ?? cablev2_1.registerCableWebAuthnIpcHandlers;
    registerCableIpc();
}
/**
 * Attaches user-activation listeners (`before-input-event` and `input-event`)
 * to a `<webview>` guest `WebContents` so main-process `caBLEv2` IPC handlers
 * can enforce recent user interaction before presenting the passkey QR modal.
 */
function attachWebviewWebAuthnUserActivationTracking(contents) {
    if (!contents || typeof contents.on !== 'function') {
        return;
    }
    contents.on('before-input-event', () => {
        (0, cablev2_1.recordWebviewUserActivation)(contents.id);
    });
    contents.on('input-event', (_event, inputEvent) => {
        const type = inputEvent?.type;
        if (!type ||
            type === 'mouseDown' ||
            type === 'mouseUp' ||
            type === 'rawKeyDown' ||
            type === 'keyDown' ||
            type === 'char' ||
            type === 'gestureTap') {
            (0, cablev2_1.recordWebviewUserActivation)(contents.id);
        }
    });
}
/**
 * Formats a human-readable label for a discoverable WebAuthn credential in the
 * account selection dialog.
 */
function formatWebAuthnAccountLabel(account, index) {
    const name = account.name?.trim();
    const displayName = account.displayName?.trim();
    if (displayName && name && displayName !== name) {
        return `${displayName} (${name})`;
    }
    if (name) {
        return name;
    }
    if (displayName) {
        return displayName;
    }
    return `账户 ${index + 1}`;
}
/**
 * Resolves the owning `BrowserWindow` for a `select-webauthn-account` event's
 * originating `WebFrameMain`, traversing `<webview>` `hostWebContents` when
 * the request originates inside an embedded `<webview>`.
 */
function resolveWindowFromWebAuthnFrame(frame) {
    if (!frame || typeof frame !== 'object') {
        return null;
    }
    const frameContents = frame.webContents;
    if (!frameContents) {
        return null;
    }
    const resolved = (0, utils_1.resolveHubWindowFromWebContents)(frameContents);
    if (resolved) {
        return resolved;
    }
    const hostContents = frameContents.hostWebContents ?? frameContents;
    if (typeof electron_1.BrowserWindow?.fromWebContents === 'function') {
        return (electron_1.BrowserWindow.fromWebContents(hostContents) ??
            electron_1.BrowserWindow.fromWebContents(frameContents) ??
            null);
    }
    return null;
}
/**
 * Creates an idempotent `Session` configurator that registers a
 * `'select-webauthn-account'` listener and (for non-default `<webview>`
 * sessions) registers the frame WebAuthn preload script at most once per
 * `Session` instance.
 */
function createWebAuthnSessionConfigurator(options) {
    const configuredSessions = new WeakSet();
    const isHeadless = options?.isHeadless ??
        (() => process.env.ELECTRON_OZONE_PLATFORM_HINT === 'headless');
    const getParentWindow = options?.getParentWindow ??
        (() => {
            return (0, utils_1.getFocusedHubWindow)() ?? (0, utils_1.getHubWindows)()[0] ?? null;
        });
    const showMessageBox = options?.showMessageBox ??
        ((win, boxOptions) => electron_1.dialog.showMessageBox(win, boxOptions));
    return (targetSession) => {
        if (!targetSession ||
            typeof targetSession.on !== 'function' ||
            configuredSessions.has(targetSession)) {
            return;
        }
        configuredSessions.add(targetSession);
        const resolvedDefaultSession = options?.defaultSession !== undefined
            ? options.defaultSession
            : electron_1.session?.defaultSession;
        if (resolvedDefaultSession !== targetSession &&
            typeof targetSession.registerPreloadScript === 'function') {
            try {
                targetSession.registerPreloadScript({
                    type: 'frame',
                    filePath: exports.WEBVIEW_WEBAUTHN_PRELOAD_PATH,
                });
            }
            catch (err) {
                console.warn('[WebAuthn] Failed to register <webview> WebAuthn preload script:', err);
            }
        }
        targetSession.on('select-webauthn-account', (_event, details, callback) => {
            // Electron leaves the WebAuthn assertion pending until `callback` is
            // invoked and cancels with NotAllowedError if no listener responds.
            let settled = false;
            const respondOnce = (credentialId) => {
                if (settled) {
                    return;
                }
                settled = true;
                callback(credentialId ?? null);
            };
            void (async () => {
                let selectedCredentialId = null;
                try {
                    const accounts = details?.accounts ?? [];
                    if (accounts.length === 0) {
                        selectedCredentialId = null;
                        return;
                    }
                    if (accounts.length === 1) {
                        selectedCredentialId = accounts[0].credentialId;
                        return;
                    }
                    if (isHeadless()) {
                        selectedCredentialId = accounts[0].credentialId;
                        return;
                    }
                    const win = resolveWindowFromWebAuthnFrame(details?.frame) ?? getParentWindow();
                    if (!win || win.isDestroyed?.()) {
                        selectedCredentialId = null;
                        return;
                    }
                    const accountLabels = accounts.map((acc, idx) => formatWebAuthnAccountLabel(acc, idx));
                    const cancelIndex = accountLabels.length;
                    const rpLabel = details.relyingPartyId || '此站点';
                    const result = await showMessageBox(win, {
                        type: 'question',
                        title: '选择通行密钥',
                        message: `登录到 ${rpLabel}`,
                        detail: '请选择一个通行密钥账户以继续：',
                        buttons: [...accountLabels, '取消'],
                        defaultId: 0,
                        cancelId: cancelIndex,
                    });
                    if (result.response >= 0 && result.response < accounts.length) {
                        selectedCredentialId = accounts[result.response].credentialId;
                    }
                    else {
                        selectedCredentialId = null;
                    }
                }
                catch (err) {
                    console.warn('[WebAuthn] Failed to select WebAuthn account:', err);
                    selectedCredentialId = null;
                }
                finally {
                    respondOnce(selectedCredentialId);
                }
            })();
        });
    };
}
/**
 * Default `Session` WebAuthn configurator used by the main process.
 */
exports.configureSessionWebAuthn = createWebAuthnSessionConfigurator();
