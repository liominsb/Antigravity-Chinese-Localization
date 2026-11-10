"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SET_PROMPT_FALLBACK_SYMBOL_KEY = exports.HUMAN_PROMPT_SYNC_CHANNEL = void 0;
exports.isProtectedIdentityProviderUrl = isProtectedIdentityProviderUrl;
exports.runWebviewPromptMainWorldBootstrap = runWebviewPromptMainWorldBootstrap;
exports.installWebviewPromptBridge = installWebviewPromptBridge;
const electron_1 = require("electron");
/** Synchronous guest-to-main IPC channel for human `window.prompt()` requests. */
exports.HUMAN_PROMPT_SYNC_CHANNEL = 'webview:human-prompt-sync';
/** Symbol key registering the human fallback on an armed `GuestDialogController` prompt wrapper. */
exports.SET_PROMPT_FALLBACK_SYMBOL_KEY = '__agy_set_prompt_fallback__';
const PROTECTED_IDP_EXACT_HOSTS = [
    'accounts.google.com',
    'myaccount.google.com',
    'accounts.youtube.com',
    'gds.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
];
const PROTECTED_IDP_WILDCARD_SUFFIXES = [
    '.okta.com',
    '.oktapreview.com',
    '.okta-emea.com',
    '.auth0.com',
];
const PROTECTED_IDP_PUBLIC_HOSTS = [
    'developer.okta.com',
    'docs.okta.com',
    'help.okta.com',
    'support.okta.com',
    'status.okta.com',
    'docs.auth0.com',
    'developer.auth0.com',
    'help.auth0.com',
    'support.auth0.com',
    'community.auth0.com',
    'status.auth0.com',
];
function extractNormalizedHostname(rawUrl) {
    let current = (rawUrl || '').trim();
    for (let depth = 0; depth < 8; depth++) {
        if (!current || current === 'null' || /^about:/i.test(current)) {
            return '';
        }
        try {
            const outer = new URL(current);
            const parsed = outer.protocol === 'blob:' ? new URL(outer.pathname) : outer;
            const host = parsed.hostname
                .replace(/^\[|\]$/g, '')
                .toLowerCase()
                .replace(/\.+$/, '')
                .replace(/^www\./, '');
            if (parsed.protocol === 'https:' &&
                host === 'uberproxy-pen-redirect.corp.google.com' &&
                parsed.pathname === '/uberproxy/pen') {
                const target = parsed.searchParams.get('url');
                if (target && /^https?:\/\//i.test(target) && target !== current) {
                    current = target;
                    continue;
                }
            }
            return host;
        }
        catch {
            return '';
        }
    }
    return '';
}
/**
 * Returns `true` when `rawUrl` resolves to a protected Identity Provider host
 * where main-world script injection must not run.
 */
function isProtectedIdentityProviderUrl(rawUrl) {
    const host = extractNormalizedHostname(rawUrl);
    if (!host ||
        PROTECTED_IDP_PUBLIC_HOSTS.some((p) => host === p || host.endsWith(`.${p}`))) {
        return false;
    }
    return (PROTECTED_IDP_EXACT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`)) || PROTECTED_IDP_WILDCARD_SUFFIXES.some((s) => host.endsWith(s)));
}
function isProtectedIdentityProviderWindow(win) {
    const readProtectedField = (getter) => {
        try {
            const val = getter();
            return typeof val === 'string' && isProtectedIdentityProviderUrl(val);
        }
        catch {
            return false;
        }
    };
    const frameWin = win;
    for (const candidate of [frameWin, frameWin?.parent, frameWin?.top]) {
        if (!candidate || typeof candidate !== 'object') {
            continue;
        }
        const w = candidate;
        if (readProtectedField(() => w.location?.href) ||
            readProtectedField(() => w.origin)) {
            return true;
        }
    }
    return false;
}
/**
 * Self-contained main-world bootstrap replacing Electron's unsupported
 * `window.prompt` stub with a synchronous human prompt bridge while leaving
 * native `window.alert` and `window.confirm` untouched.
 */
function runWebviewPromptMainWorldBootstrap(winRoot, requestEventType, responseEventType, setFallbackSymbolKey) {
    if (!winRoot || !winRoot.MessageEvent) {
        return;
    }
    const setFallbackSym = Symbol.for(setFallbackSymbolKey);
    const defProp = (winRoot.Object || Object).defineProperty;
    const fnBind = (winRoot.Function || Function).prototype.bind;
    const Str = winRoot.String || String;
    const toJson = JSON.stringify;
    const parseJson = JSON.parse;
    const MsgEv = winRoot.MessageEvent;
    const addEL = winRoot.addEventListener.bind(winRoot);
    const removeEL = winRoot.removeEventListener.bind(winRoot);
    const dispatch = winRoot.dispatchEvent.bind(winRoot);
    function prompt(message, defaultValue) {
        const msg = arguments.length > 0 && message !== undefined ? Str(message) : '';
        const def = arguments.length > 1 && defaultValue !== undefined
            ? Str(defaultValue)
            : '';
        let result = null;
        const onResponse = (ev) => {
            ev?.stopImmediatePropagation?.();
            try {
                const rawData = ev?.data;
                const parsed = parseJson(typeof rawData === 'string' ? rawData : 'null');
                result = typeof parsed === 'string' ? parsed : null;
            }
            catch {
                result = null;
            }
        };
        addEL(responseEventType, onResponse, { capture: true, once: true });
        try {
            dispatch(new MsgEv(requestEventType, {
                data: toJson({ message: msg, defaultValue: def }),
            }));
        }
        finally {
            removeEL(responseEventType, onResponse, { capture: true });
        }
        return result;
    }
    const nonConstructible = (...args) => prompt(...args);
    const nativePrompt = defProp(fnBind.call(nonConstructible, null), 'name', {
        value: 'prompt',
        configurable: true,
    });
    const registerFallback = winRoot.prompt?.[setFallbackSym];
    if (typeof registerFallback === 'function') {
        registerFallback(nativePrompt);
        return;
    }
    defProp(winRoot, 'prompt', {
        value: nativePrompt,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}
const installedPromptTargets = new WeakSet();
/** Installs the isolated-world synchronous `window.prompt()` relay in a guest frame. */
function installWebviewPromptBridge(options) {
    const frame = options?.frame !== undefined ? options.frame : electron_1.webFrame;
    const win = options?.win !== undefined
        ? options.win
        : (globalThis
            .window ?? null);
    if (!frame ||
        typeof frame.executeJavaScript !== 'function' ||
        !win ||
        typeof win.addEventListener !== 'function' ||
        typeof win.dispatchEvent !== 'function' ||
        installedPromptTargets.has(win) ||
        isProtectedIdentityProviderWindow(win)) {
        return false;
    }
    installedPromptTargets.add(win);
    const rand = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
    const reqType = `__agy_hpr_${rand()}`;
    const resType = `__agy_hps_${rand()}`;
    const sendSync = options?.sendSyncPrompt ??
        ((raw) => electron_1.ipcRenderer.sendSync(exports.HUMAN_PROMPT_SYNC_CHANNEL, raw));
    const createRes = options?.createResponseEvent ??
        ((type, data) => new MessageEvent(type, { data }));
    win.addEventListener(reqType, (event) => {
        event.stopImmediatePropagation?.();
        const rawData = event?.data;
        let reply = null;
        try {
            reply = sendSync(typeof rawData === 'string' ? rawData : '{}');
        }
        catch {
            reply = null;
        }
        const normalized = typeof reply === 'string' ? reply : null;
        win.dispatchEvent(createRes(resType, JSON.stringify(normalized)));
    }, { capture: true });
    try {
        Promise.resolve(frame.executeJavaScript(`(${runWebviewPromptMainWorldBootstrap.toString()})(typeof window!=='undefined'?window:undefined,${JSON.stringify(reqType)},${JSON.stringify(resType)},${JSON.stringify(exports.SET_PROMPT_FALLBACK_SYMBOL_KEY)});`)).catch(() => undefined);
        return true;
    }
    catch {
        return false;
    }
}
installWebviewPromptBridge();
