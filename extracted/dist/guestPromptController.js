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
exports.guestPromptController = exports.GuestPromptController = exports.DEFAULT_HUMAN_PROMPT_TIMEOUT_MS = exports.MAX_HUMAN_PROMPT_TEXT_LENGTH = exports.WEBVIEW_PROMPT_SUBSCRIBER_STATE_CHANNEL = exports.WEBVIEW_PROMPT_RESPONSE_CHANNEL = exports.WEBVIEW_PROMPT_REQUEST_CHANNEL = exports.WEBVIEW_PROMPT_PRELOAD_PATH = void 0;
exports.configureSessionPromptPreload = configureSessionPromptPreload;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const guestAgentControl_1 = require("./guestAgentControl");
exports.WEBVIEW_PROMPT_PRELOAD_PATH = path.join(__dirname, 'webviewPromptPreload.js');
exports.WEBVIEW_PROMPT_REQUEST_CHANNEL = 'webview:prompt-request';
exports.WEBVIEW_PROMPT_RESPONSE_CHANNEL = 'webview:prompt-response';
exports.WEBVIEW_PROMPT_SUBSCRIBER_STATE_CHANNEL = 'webview:prompt-subscriber-state';
exports.MAX_HUMAN_PROMPT_TEXT_LENGTH = 2000;
exports.DEFAULT_HUMAN_PROMPT_TIMEOUT_MS = 5 * 60000;
const GUEST_ABORT_EVENTS = [
    'did-navigate',
    'render-process-gone',
    'destroyed',
];
const configuredPromptSessions = new WeakSet();
/** Registers `webviewPromptPreload.js` once on non-default browser guest sessions. */
function configureSessionPromptPreload(targetSession, defaultSession = electron_1.session?.defaultSession) {
    if (!targetSession ||
        typeof targetSession !== 'object' ||
        targetSession === defaultSession ||
        configuredPromptSessions.has(targetSession) ||
        typeof targetSession.registerPreloadScript !== 'function') {
        return;
    }
    configuredPromptSessions.add(targetSession);
    try {
        targetSession.registerPreloadScript({
            type: 'frame',
            filePath: exports.WEBVIEW_PROMPT_PRELOAD_PATH,
        });
    }
    catch (err) {
        console.warn('[Prompt] Failed to register guest prompt preload:', err);
    }
}
function clampText(raw) {
    return typeof raw === 'string'
        ? raw.slice(0, exports.MAX_HUMAN_PROMPT_TEXT_LENGTH)
        : '';
}
function deriveVerifiedOrigin(frameOrigin, url) {
    for (const candidate of [frameOrigin, url]) {
        if (!candidate || candidate === 'null') {
            continue;
        }
        try {
            const parsed = new URL(candidate);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.origin;
            }
            if (candidate === url) {
                return parsed.protocol.replace(/:$/, '') || 'unknown';
            }
        }
        catch {
            // Fall through.
        }
    }
    return 'unknown';
}
function isSameHost(a, b) {
    return a === b || (a.id !== undefined && a.id === b.id);
}
/**
 * Coordinates synchronous guest `window.prompt()` requests for human-controlled
 * browser tabs, pausing only the requesting guest renderer while forwarding an
 * asynchronous prompt card lifecycle to the owning Hub host renderer.
 */
class GuestPromptController {
    constructor(options) {
        this.pendingByPromptId = new Map();
        this.pendingByWcId = new Map();
        this.subscribedHosts = new Set();
        this.destroyHookedHosts = new WeakSet();
        this.nextPromptSeq = 1;
        this.timeoutMs = options?.timeoutMs ?? exports.DEFAULT_HUMAN_PROMPT_TIMEOUT_MS;
        this.requireHostSubscriber = options?.requireHostSubscriber ?? false;
        this.hostResolver = options?.hostResolver;
        this.onPromptVisibilityChange = options?.onPromptVisibilityChange;
    }
    setHostSubscribed(hostSender, subscribed) {
        if (!hostSender || hostSender.isDestroyed()) {
            return;
        }
        for (const existing of [...this.subscribedHosts]) {
            if (isSameHost(existing, hostSender)) {
                this.subscribedHosts.delete(existing);
            }
        }
        if (!subscribed) {
            this.cancelForHost(hostSender);
            return;
        }
        this.subscribedHosts.add(hostSender);
        if (!this.destroyHookedHosts.has(hostSender)) {
            this.destroyHookedHosts.add(hostSender);
            hostSender.once?.('destroyed', () => {
                for (const existing of [...this.subscribedHosts]) {
                    if (isSameHost(existing, hostSender)) {
                        this.subscribedHosts.delete(existing);
                    }
                }
                this.cancelForHost(hostSender);
            });
        }
    }
    isHostSubscribed(hostSender) {
        if (!hostSender || hostSender.isDestroyed()) {
            return false;
        }
        for (const existing of this.subscribedHosts) {
            if (!existing.isDestroyed() && isSameHost(existing, hostSender)) {
                return true;
            }
        }
        return false;
    }
    cancelForHost(hostSender) {
        for (const pending of [...this.pendingByPromptId.values()]) {
            if (isSameHost(pending.hostSender, hostSender)) {
                pending.settle(null, false);
            }
        }
    }
    setHostResolver(resolver) {
        this.hostResolver = resolver;
    }
    setPromptVisibilityListener(listener) {
        this.onPromptVisibilityChange = listener;
    }
    handleSyncPrompt(event, rawJson) {
        const guest = event?.sender;
        const resolved = guest &&
            typeof guest.id === 'number' &&
            guest.id > 0 &&
            !guest.isDestroyed?.() &&
            !(0, guestAgentControl_1.isGuestAgentControlled)(guest.id)
            ? this.resolveHostContext(guest)
            : null;
        if (!guest ||
            !resolved?.hostSender ||
            resolved.hostSender.isDestroyed() ||
            resolved.visible === false ||
            (this.requireHostSubscriber &&
                !this.isHostSubscribed(resolved.hostSender))) {
            event.returnValue = null;
            return;
        }
        let message = '';
        let defaultValue = '';
        if (typeof rawJson === 'string') {
            try {
                const parsed = JSON.parse(rawJson);
                message = clampText(parsed?.message);
                defaultValue = clampText(parsed?.defaultValue);
            }
            catch {
                // Ignore malformed guest JSON payloads.
            }
        }
        this.cancelForGuest(guest.id);
        const url = event.senderFrame?.url || guest.getURL?.() || '';
        const origin = deriveVerifiedOrigin(event.senderFrame?.origin, url);
        const promptId = `hprompt_${this.nextPromptSeq++}`;
        const { hostSender, tabKey } = resolved;
        const payloadBase = {
            promptId,
            webContentsId: guest.id,
            ...(tabKey ? { tabKey } : {}),
            origin,
            url,
            message,
            defaultValue,
        };
        let settled = false;
        const onDidStartNav = (navEv, _navUrl, isInPlace, isMainFrame) => {
            const sameDoc = typeof isInPlace === 'boolean'
                ? isInPlace
                : Boolean(navEv?.isSameDocument);
            const mainFrame = typeof isMainFrame === 'boolean'
                ? isMainFrame
                : navEv?.isMainFrame !== false;
            const callingFrame = Boolean(event.senderFrame && navEv?.frame === event.senderFrame);
            if (!sameDoc && (mainFrame || callingFrame)) {
                settle(null, true);
            }
        };
        const onGuestAbort = () => settle(null, true);
        const onHostDestroyed = () => settle(null, false);
        const timer = setTimeout(() => settle(null, true), this.timeoutMs);
        timer.unref?.();
        const settle = (value, notifyDismissed) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            this.pendingByPromptId.delete(promptId);
            if (this.pendingByWcId.get(guest.id)?.promptId === promptId) {
                this.pendingByWcId.delete(guest.id);
            }
            guest.removeListener?.('did-start-navigation', onDidStartNav);
            for (const ev of GUEST_ABORT_EVENTS) {
                guest.removeListener?.(ev, onGuestAbort);
            }
            hostSender.removeListener?.('destroyed', onHostDestroyed);
            if (tabKey) {
                this.onPromptVisibilityChange?.(tabKey, false);
            }
            if (notifyDismissed && !hostSender.isDestroyed()) {
                try {
                    hostSender.send(exports.WEBVIEW_PROMPT_REQUEST_CHANNEL, {
                        ...payloadBase,
                        dismissed: true,
                    });
                }
                catch {
                    // Ignore send errors on tearing-down host renderers.
                }
            }
            event.returnValue = typeof value === 'string' ? value : null;
        };
        const record = { promptId, hostSender, settle };
        this.pendingByPromptId.set(promptId, record);
        this.pendingByWcId.set(guest.id, record);
        guest.on?.('did-start-navigation', onDidStartNav);
        for (const ev of GUEST_ABORT_EVENTS) {
            guest.on?.(ev, onGuestAbort);
        }
        hostSender.once?.('destroyed', onHostDestroyed);
        if (tabKey) {
            this.onPromptVisibilityChange?.(tabKey, true);
        }
        try {
            hostSender.send(exports.WEBVIEW_PROMPT_REQUEST_CHANNEL, payloadBase);
        }
        catch {
            settle(null, false);
        }
    }
    respondPrompt(callerSenderId, promptId, value) {
        const pending = promptId ? this.pendingByPromptId.get(promptId) : undefined;
        if (!pending) {
            return false;
        }
        if (pending.hostSender.id !== undefined &&
            callerSenderId !== pending.hostSender.id) {
            throw new Error(`Prompt ${promptId} is not owned by the calling renderer`);
        }
        pending.settle(typeof value === 'string' ? clampText(value) : null, false);
        return true;
    }
    cancelForGuest(webContentsId) {
        const pending = this.pendingByWcId.get(webContentsId);
        pending?.settle(null, true);
        return Boolean(pending);
    }
    hasPendingForGuest(webContentsId) {
        return this.pendingByWcId.has(webContentsId);
    }
    resolveHostContext(guest) {
        return (this.hostResolver?.(guest) ??
            (guest.getType?.() === 'webview' && guest.hostWebContents
                ? { hostSender: guest.hostWebContents, visible: true }
                : null));
    }
}
exports.GuestPromptController = GuestPromptController;
exports.guestPromptController = new GuestPromptController({
    requireHostSubscriber: true,
});
