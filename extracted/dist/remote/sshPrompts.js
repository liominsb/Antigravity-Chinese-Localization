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
exports.promptTitle = promptTitle;
exports.sshMarksHostPrompts = sshMarksHostPrompts;
exports.destroyPromptWindows = destroyPromptWindows;
exports.askOnWindow = askOnWindow;
/**
 * ssh's prompts on a Hub window: a modal window for secrets, sheets for yes/no
 * questions and security key touches.
 */
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const main_1 = __importDefault(require("electron-log/main"));
const path = __importStar(require("path"));
const utils_1 = require("../utils");
const remoteWindowSecurity_1 = require("./remoteWindowSecurity");
const sshArgs_1 = require("./sshArgs");
const types_1 = require("./types");
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
const TOUCH_TITLE = '请轻触你的安全密钥';
/** Longer titles are cut: a host can name itself at length. */
const MAX_TITLE_CHARS = 100;
/** A path's last part: a key's file name. */
function baseName(file) {
    return (file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1) ||
        file);
}
/** `[host]:port`, as ssh names a host on another port, as host:port. */
function hostName(host) {
    const [, name, port] = /^\[([^\]]+)\]:(\d+)$/.exec(host) ?? [];
    return name && port ? `${name}:${port}` : host;
}
/** What's between `prefix` and `suffix`, if `text` is only that. */
function between(text, prefix, suffix) {
    return text.length > prefix.length + suffix.length &&
        text.startsWith(prefix) &&
        text.endsWith(suffix)
        ? text.slice(prefix.length, text.length - suffix.length)
        : undefined;
}
/** What `text` quotes right after `lead`. */
function quotedAfter(text, lead) {
    const start = text.indexOf(lead);
    const end = start < 0 ? -1 : text.indexOf("'", start + lead.length);
    return end < 0 ? undefined : text.slice(start + lead.length, end);
}
const isAccount = (who) => who.includes('@') && !/\s/.test(who);
/**
 * ssh's own secret prompts (sshconnect2.c, ssh-pkcs11.c): its prefix and
 * suffix, and what's asked for and whose, from what's between.
 */
const SSH_SECRETS = [
    [
        '',
        "'s password:",
        (who) => (isAccount(who) ? ['密码', who] : undefined),
    ],
    [
        'Enter ',
        "'s old password:",
        (who) => (isAccount(who) ? ['当前密码', who] : undefined),
    ],
    [
        'Enter ',
        "'s new password:",
        (who) => (isAccount(who) ? ['新密码', who] : undefined),
    ],
    [
        'Retype ',
        "'s new password:",
        (who) => (isAccount(who) ? ['确认新密码', who] : undefined),
    ],
    ["Enter passphrase for key '", "':", (key) => ['密钥口令', baseName(key)]],
    [
        'Enter PIN for ',
        ':',
        (what) => {
            // A PKCS#11 token's label, quoted.
            if (what.length > 2 && what.startsWith("'") && what.endsWith("'")) {
                return ['PIN 码', what.slice(1, -1)];
            }
            // A FIDO key's type and file.
            const key = what.indexOf(' key ');
            return key < 0 ? undefined : ['PIN 码', baseName(what.slice(key + 5))];
        },
    ],
];
/** What the first of SSH_SECRETS that `text` is asks for, and whose. */
function sshSecretAsked(text) {
    for (const [prefix, suffix, asked] of SSH_SECRETS) {
        const part = between(text, prefix, suffix);
        const found = part === undefined ? undefined : asked(part);
        if (found) {
            return found;
        }
    }
    return undefined;
}
/**
 * ssh's own yes/no questions (sshconnect.c, clientloop.c) as titles. Unless
 * `hostPromptsMarked`, none names a host: one of a host's prompts that ends
 * in "(yes/no)?" passes for ssh's question too.
 */
function sshQuestionTitle(text, hostPromptsMarked) {
    if (text.startsWith("The authenticity of host '")) {
        // '%.200s (%s)': the host, then its address.
        const host = quotedAfter(text, "The authenticity of host '");
        return host && hostPromptsMarked
            ? `信任主机 ${hostName(host.split(' (')[0])}？`
            : undefined;
    }
    if (text.startsWith('Warning: the ') &&
        text.includes(' differs from the key for the IP address ')) {
        const host = quotedAfter(text, " host key for '");
        return host && hostPromptsMarked
            ? `仍要连接到 ${hostName(host)}？`
            : undefined;
    }
    if (text.startsWith('Accept updated hostkeys?')) {
        return '接受更新后的主机密钥？';
    }
    // 'Add key %s (%s) to agent?': the key's file, then its comment. Only ssh's
    // `confirm` hint makes it a question, so no host words it.
    const key = between(text, 'Add key ', ' to agent?');
    return key ? `将密钥 ${baseName(key.split(' (')[0])} 添加到 ssh-agent？` : undefined;
}
/**
 * For a one-time code, by its wording; no bare "code", which a host name
 * can hold. Linear: a host words it.
 */
const CODE_WORDS = /verif(?:y|ication)|one[- ]time|passcode|\botp\b|two[- ](?:factor|step)|\b2fa\b|authenticator|\btoken\b/i;
/** By its words alone: a host's prompt, or ssh's own in another wording. */
function wordedTitle(kind, text, who) {
    if (kind === 'confirm') {
        return `来自 ${who} 的询问`;
    }
    if (CODE_WORDS.test(text)) {
        return `${who} 的验证码`;
    }
    if (/password/i.test(text)) {
        return `${who} 的密码`;
    }
    return /\bpin\b/i.test(text) ? `${who} 的 PIN 码` : `登录到 ${who}`;
}
/**
 * The title for ssh's prompt `message` (sanitized): what it asks for, and
 * for whom, e.g. "Password for me@devbox". `label` (the host as the user gave
 * it) stands in when the prompt names no one. Unless `hostPromptsMarked`
 * (sshMarksHostPrompts), it also stands in for any key, account or host a
 * prompt in ssh's own words names: a host's prompt may pose as one.
 */
function promptTitle(kind, message, label, hostPromptsMarked) {
    if (kind === 'notice') {
        return TOUCH_TITLE;
    }
    const text = message.trim();
    // ssh's own `(user@host) ` before a keyboard-interactive prompt: the rest
    // is the host's.
    const prefix = hostPromptsMarked ? /^\(([^\s()]+)\) /.exec(text) : null;
    let title;
    if (prefix && prefix[1].includes('@')) {
        title = wordedTitle(kind, text.slice(prefix[0].length), prefix[1]);
    }
    else if (kind === 'confirm') {
        title =
            sshQuestionTitle(text, hostPromptsMarked) ??
                wordedTitle(kind, text, label);
    }
    else {
        const asked = sshSecretAsked(text);
        title = asked
            ? `${hostPromptsMarked ? asked[1] : label} 的${asked[0]}`
            : wordedTitle(kind, text, label);
    }
    return (0, types_1.sanitizeRemoteText)(title, MAX_TITLE_CHARS);
}
/** For `ssh -V`: then it's killed, and soon after taken as no answer. */
const VERSION_TIMEOUT_MS = 3000;
const VERSION_SETTLE_MS = VERSION_TIMEOUT_MS + 500;
/** `binary -V`'s OpenSSH version, [major, minor], if it tells in time. */
function openSshVersion(binary, env) {
    return new Promise((resolve) => {
        const settle = (output) => {
            clearTimeout(timer);
            const [, major, minor] = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/.exec(output) ?? [];
            resolve(major ? [Number(major), Number(minor)] : undefined);
        };
        // execFile calls back only once ssh's pipes close, which a stuck ssh (or
        // a child holding them) may never let happen.
        const timer = setTimeout(() => settle(''), VERSION_SETTLE_MS);
        try {
            (0, child_process_1.execFile)(binary, ['-V'], 
            // env's PATH finds `binary`, as it does for the connection.
            {
                env,
                timeout: VERSION_TIMEOUT_MS,
                killSignal: 'SIGKILL',
                windowsHide: true,
            }, (_error, stdout, stderr) => settle(`${stdout}${stderr}`));
        }
        catch {
            settle('');
        }
    });
}
/**
 * Whether the ssh that `env` runs (resolveSshBinary, found on its PATH) puts
 * its own `(user@host) ` before each keyboard-interactive prompt, which the
 * host words: OpenSSH 8.5 on does. An older ssh, or one whose `ssh -V`
 * doesn't tell in time, passes a host's prompt on as it is. Never rejects.
 *
 * TODO: a ProxyCommand that runs another, older ssh (by its path) asks
 * unmarked too. Trusting ssh's own words only in prompts from this ssh's pid
 * (the askpass helper sends its ppid) would cover it.
 */
async function sshMarksHostPrompts(env) {
    const version = await openSshVersion((0, sshArgs_1.resolveSshBinary)(env), env);
    if (!version) {
        return false;
    }
    const [major, minor] = version;
    return major > 8 || (major === 8 && minor >= 5);
}
/**
 * The Hub's design tokens as its dialogs use them: the window is the dialog,
 * on --card. They're the toolkit's Onyx theme (agent_ui_toolkit's
 * themeUtils.ts), the Hub's default, but for two that the page needs to
 * read: --border is Onyx's stronger-contrast one, so the one field shows, and
 * light --error is the toolkit's red-600. Text has 4.5:1 or more on --card.
 */
const TOKENS = {
    light: {
        '--card': '#FFFFFF',
        '--background': '#FFFFFF',
        '--foreground': '#0A0A0C',
        '--secondary-foreground': '#3F3F46',
        '--muted-foreground': '#71717A',
        '--primary': '#2F75C3',
        '--primary-foreground': '#FFFFFF',
        '--secondary': 'rgb(10 10 12 / 0.06)',
        '--border': 'rgb(10 10 12 / 0.11)',
        '--error': '#CB3D3D',
    },
    dark: {
        '--card': '#131317',
        '--background': '#070708',
        '--foreground': '#FFFFFF',
        '--secondary-foreground': '#BCBDC6',
        '--muted-foreground': '#87888F',
        '--primary': '#2F71E3',
        '--primary-foreground': '#FFFFFF',
        '--secondary': 'rgb(255 255 255 / 0.075)',
        '--border': 'rgb(255 255 255 / 0.11)',
        '--error': '#DE5555',
    },
};
const cssVars = (tokens) => Object.entries(tokens)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
/** In the Hub's theme, not the OS's: the page has it as it first paints. */
const page = (dark) => `<!doctype html>
<html lang="en"${dark ? ' class="dark"' : ''}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root { color-scheme: light; ${cssVars(TOKENS.light)}
  --focus-ring: color-mix(in srgb, var(--primary) 55%, transparent); }
:root.dark { color-scheme: dark; ${cssVars(TOKENS.dark)} }
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; padding: 20px 24px; display: flex;
  flex-direction: column; background: var(--card); color: var(--foreground);
  font: 14px/20px ${FONT}; -webkit-font-smoothing: antialiased; }
.context { flex: none; margin: 0 0 2px; font-size: 12px; line-height: 16px;
  color: var(--muted-foreground); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
h1 { flex: none; margin: 0; font-size: 16px; line-height: 22px;
  font-weight: 600; overflow-wrap: anywhere; }
#message { margin-top: 6px; min-height: 0; overflow: auto; font-size: 13px;
  line-height: 18px; color: var(--secondary-foreground); white-space: pre-wrap;
  overflow-wrap: anywhere; }
input { flex: none; margin-top: 16px; height: 32px; padding: 0 12px;
  border: 1px solid var(--border); border-radius: 9999px;
  background: var(--background); color: var(--foreground); font: inherit; }
.note { flex: none; margin-top: 8px; font-size: 12px; line-height: 16px;
  color: var(--error); }
.buttons { flex: none; margin-top: auto; padding-top: 20px; display: flex;
  justify-content: flex-end; gap: 8px; }
button { min-width: 76px; height: 32px; padding: 0 14px; border: 0;
  border-radius: 9999px; font: 500 14px/20px ${FONT}; }
.primary { background: var(--primary); color: var(--primary-foreground);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
.primary:hover { opacity: 0.9; }
.secondary { background: var(--secondary); color: var(--secondary-foreground); }
.secondary:hover { color: var(--foreground); }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
</style>
</head>
<body>
<p class="context">正在连接到 <span id="label"></span></p>
<h1 id="title"></h1>
<div id="message"></div>
<input id="answer" type="password" maxlength="1023" autocomplete="off" aria-labelledby="title" aria-describedby="message">
<div id="retry" class="note" hidden>再次提示：上一次输入的密码或凭据可能不正确。</div>
<div id="long" class="note" role="alert" hidden>内容过长。</div>
<div class="buttons"><button id="cancel" class="secondary">取消</button><button id="continue" class="primary">继续</button></div>
</body>
</html>`;
/** The page's width; its height fits ssh's text (pageHeight). */
const PAGE_WIDTH = 440;
/** Past it, ssh's text scrolls. */
const MAX_PAGE_HEIGHT = 420;
/** East Asian wide and fullwidth characters: two columns each. */
const WIDE_CHARS = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/g;
/**
 * Lines `text` takes at `perLine` columns a line, wrapped as the page wraps
 * it: at spaces, and a word too long for a line (a key's path, say) on lines
 * of its own, broken anywhere.
 */
function lineCount(text, perLine) {
    let lines = 0;
    for (const line of text.split('\n')) {
        lines += 1;
        let used = 0;
        for (const word of line.split(' ')) {
            const width = word.length + (word.match(WIDE_CHARS)?.length ?? 0);
            const needed = used === 0 ? width : used + 1 + width;
            if (needed <= perLine) {
                used = needed;
                continue;
            }
            const spans = Math.max(1, Math.ceil(width / perLine));
            lines += (used === 0 ? 0 : 1) + spans - 1;
            used = width - (spans - 1) * perLine;
        }
    }
    return lines;
}
/**
 * The page's height for `text`, from its CSS and a low estimate of the
 * columns a line holds: a long text gets room to spare rather than too
 * little, and what doesn't fit scrolls.
 */
function pageHeight({ title, message, retry }) {
    const rows = [
        20, // padding
        16 + 2, // "Connecting to"
        lineCount(title, 38) * 22,
        message ? 6 + lineCount(message, 52) * 18 : 0,
        16 + 32, // the field
        retry ? 8 + 16 : 0,
        20 + 32, // the buttons
        20, // padding
    ];
    return Math.min(rows.reduce((sum, row) => sum + row), MAX_PAGE_HEIGHT);
}
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
 * Cancel. Rejects if the prompt can't show. Nothing is awaited before a
 * secret's window guards against its parent's close.
 */
async function askOnWindow(parent, label, { kind, message, retry, signal, hostPromptsMarked }) {
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
    const title = promptTitle(kind, message, label, hostPromptsMarked);
    // ssh ends its prompts with a space, and a host its text with anything.
    const text = message.trim();
    if (kind === 'secret') {
        const answer = await askSecret(parent, { label, title, message: text, retry }, signal);
        return answer === null ? CANCEL : { kind: 'secret', text: answer };
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
            message: title,
            detail: text,
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
        width: PAGE_WIDTH,
        height: pageHeight(text),
        // The page's size, whatever frame the platform adds.
        useContentSize: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        title: `SSH: ${text.label}`,
        backgroundColor: TOKENS[dark ? 'dark' : 'light']['--card'],
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
