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
exports.destroyPromptWindows = destroyPromptWindows;
exports.askOnWindow = askOnWindow;
/**
 * ssh's prompts on a Hub window: a modal window for secrets, sheets for yes/no
 * questions and security key touches.
 */
const electron_1 = require("electron");
const main_1 = __importDefault(require("electron-log/main"));
const path = __importStar(require("path"));
const utils_1 = require("../utils");
const remoteWindowSecurity_1 = require("./remoteWindowSecurity");
const LOGGED = {
    secret: 'asked for a password',
    confirm: 'asked a yes/no question',
    notice: 'asked for a security key touch',
};
const CANCEL = { kind: 'cancel' };
/** In memory: the page stores nothing. */
const PROMPT_PARTITION = 'ssh-prompt';
/** The secret windows open now. */
const promptWindows = new Set();
/** The Hub's colors (utils.ts's createWindow). */
const COLORS = {
    dark: { background: '#131313', text: '#FAFAFA' },
    light: { background: '#FAFAFA', text: '#383A42' },
};
/** In the Hub's theme, not the OS's: the page has it as it first paints. */
const page = (dark) => `<!doctype html>
<html${dark ? ' class="dark"' : ''}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root { color-scheme: light; background: ${COLORS.light.background};
  color: ${COLORS.light.text}; font: 13px system-ui, sans-serif; }
:root.dark { color-scheme: dark; background: ${COLORS.dark.background};
  color: ${COLORS.dark.text}; }
body { margin: 0; padding: 16px 20px; box-sizing: border-box; height: 100vh;
  display: flex; flex-direction: column; gap: 8px; }
#message { flex: 1; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.note { color: #c5221f; }
.dark .note { color: #f28b82; }
input { font: inherit; padding: 4px 6px; }
.buttons { display: flex; justify-content: flex-end; gap: 8px; }
</style>
</head>
<body>
<strong id="asks"></strong>
<div id="message"></div>
<div id="retry" class="note" hidden>再次提示：上一次输入的密码或凭据可能不正确。</div>
<div id="long" class="note" hidden>内容过长。</div>
<input id="answer" type="password" maxlength="1023" autocomplete="off" aria-labelledby="asks">
<div class="buttons"><button id="cancel">取消</button><button id="continue">继续</button></div>
</body>
</html>`;
/**
 * Destroys the open secret windows: their prompts end as Cancel. On quit, call
 * it before destroying the other windows: a modal child destroyed right after
 * its parent crashes Electron.
 */
function destroyPromptWindows() {
    for (const win of promptWindows) {
        win.destroy();
    }
}
/**
 * Shows `prompt` on `parent`; a parent that's gone, or starts to close, means
 * Cancel. Rejects if the prompt can't show.
 */
async function askOnWindow(parent, label, { kind, message, retry, signal }) {
    main_1.default.info(`[SSH] ${label} ${LOGGED[kind]}.`);
    if (parent.isDestroyed() || signal.aborted) {
        return CANCEL;
    }
    // It needs an answer: a hidden (Cmd+H) or minimized parent comes back.
    if (parent.isMinimized()) {
        parent.restore();
    }
    parent.show();
    parent.focus();
    if (kind === 'secret') {
        const text = await askSecret(parent, { label, message, retry }, signal);
        return text === null ? CANCEL : { kind: 'secret', text };
    }
    // A message box may outlive its parent.
    const stop = new AbortController();
    const onStop = () => stop.abort();
    parent.once('closed', onStop);
    signal.addEventListener('abort', onStop);
    try {
        const confirm = kind === 'confirm';
        const { response } = await electron_1.dialog.showMessageBox(parent, {
            type: confirm ? 'question' : 'info',
            title: `SSH: ${label}`,
            message: confirm ? `${label} 询问：` : '请轻触你的安全密钥',
            detail: message,
            buttons: confirm ? ['是', '否'] : ['取消'],
            defaultId: confirm ? 1 : 0,
            cancelId: confirm ? 1 : 0,
            // Also closes it once ssh no longer waits (e.g. after the touch).
            signal: stop.signal,
        });
        return confirm && !parent.isDestroyed()
            ? { kind: 'confirm', yes: response === 0 }
            : CANCEL;
    }
    finally {
        parent.off('closed', onStop);
        signal.removeEventListener('abort', onStop);
    }
}
function askSecret(parent, text, signal) {
    const ses = electron_1.session.fromPartition(PROMPT_PARTITION);
    // Before the window: the app's session hooks add theirs to each session,
    // and a throw now leaves no window behind.
    (0, remoteWindowSecurity_1.removeSessionPreloads)(ses);
    const dark = !(0, utils_1.isLightTheme)();
    const win = new electron_1.BrowserWindow({
        parent,
        modal: true,
        show: false,
        width: 440,
        height: 260,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        title: `SSH: ${text.label}`,
        backgroundColor: COLORS[dark ? 'dark' : 'light'].background,
        webPreferences: {
            preload: path.join(__dirname, 'sshPromptPreload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            devTools: false,
            session: ses,
        },
    });
    promptWindows.add(win);
    win.once('closed', () => promptWindows.delete(win));
    // Not a Hub window: no Hub zoom, quit sheet or storage events.
    (0, utils_1.markWebviewPopupWindow)(win);
    const contents = win.webContents;
    win.removeMenu();
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    return new Promise((resolve, reject) => {
        let answer = null;
        let done = false;
        let failed = false;
        const finish = (value) => {
            if (!done) {
                done = true;
                answer = value;
                if (!win.isDestroyed()) {
                    win.close();
                }
            }
        };
        const cancel = () => finish(null);
        // As its parent starts to close: a modal child closed during or after its
        // parent's teardown crashes Electron.
        const destroy = () => {
            done = true;
            if (!win.isDestroyed()) {
                win.destroy();
            }
        };
        // Handlers on the window's own ipc: invokes, unlike sends, go no further.
        contents.ipc.handle('ssh-prompt:submit', (_event, value) => finish(typeof value === 'string' ? value : null));
        contents.ipc.handle('ssh-prompt:cancel', cancel);
        // Also after a reload, which empties the page.
        contents.on('did-finish-load', () => {
            contents.send('ssh-prompt:show', text);
            win.show();
        });
        signal.addEventListener('abort', cancel);
        parent.once('close', destroy);
        win.once('closed', () => {
            signal.removeEventListener('abort', cancel);
            parent.off('close', destroy);
            if (failed) {
                reject(new Error("The ssh prompt window didn't load."));
            }
            else {
                resolve(answer);
            }
        });
        win
            .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(dark))}`)
            .catch(() => {
            // It couldn't show: no answer, but no Cancel of the user's either.
            failed = !done;
            cancel();
        });
    });
}
