"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guestWebMcpController = exports.GuestWebMcpController = void 0;
const guestDebugger_1 = require("./guestDebugger");
const guestFileAttachment_1 = require("./guestFileAttachment");
const guestFramePolicy_1 = require("./guestFramePolicy");
const webviewUploadValidation_1 = require("./webviewUploadValidation");
const MAX_PAYLOAD_BYTES = 64 * 1024;
const DISABLED = 'WebMCP is disabled';
const BLOCKED_MSG = 'WebMCP is blocked on identity provider and payment pages';
const IPV4_LOOPBACK_RE = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const UNSAFE_NAME_CHAR_RE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const UNSAFE_DESC_CHARS_RE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const PROTECTED_PAYMENT_HOSTS = [
    'stripe.com,m.stripe.network,paypal.com,paypalobjects.com,adyen.com',
    'braintreegateway.com,braintree-api.com,js.checkout.com,pay.checkout.com',
    'squareup.com,squareupsandbox.com,square.site,klarna.com,affirm.com',
    'pay.google.com,payments.google.com,wallet.google.com,afterpay.com',
    'pay.amazon.com,payments.amazon.com,shopifycs.com,shop.app',
    'checkout.shopify.com',
].flatMap((row) => row.split(','));
const noop = () => undefined;
const err = (errorCode, error) => ({
    ok: false,
    errorCode,
    error,
});
const utf8Bytes = (s) => Buffer.byteLength(s, 'utf8');
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Stops at the cap, so hostile nesting cannot overflow the stack. */
const depthOk = (v, depth = 1) => typeof v !== 'object' ||
    v === null ||
    (depth <= 32 && Object.values(v).every((c) => depthOk(c, depth + 1)));
const sendCancel = (wc, invocationId) => void wc.debugger
    .sendCommand('WebMCP.cancelInvocation', { invocationId })
    .catch(noop);
const normHost = (u) => (u?.hostname ?? '')
    .replace(/^\[|\]$|\.+$/g, '')
    .replace(/%.*$/, '')
    .toLowerCase();
function unwrapHttpUrl(raw) {
    const s = (raw || '').trim();
    const skip = !s || s.toLowerCase() === 'null' || /^about:/i.test(s);
    try {
        const outer = skip ? null : new URL(s);
        const u = outer?.protocol === 'blob:' ? new URL(outer.pathname) : outer;
        return u && /^https?:$/.test(u.protocol) ? u : null;
    }
    catch {
        return null;
    }
}
function isSecureWebMcpUrl(raw) {
    const u = unwrapHttpUrl(raw);
    const h = normHost(u);
    const loop = h === 'localhost' ||
        h.endsWith('.localhost') ||
        h === '::1' ||
        IPV4_LOOPBACK_RE.test(h);
    return Boolean(u && h && (u.protocol === 'https:' || loop));
}
function isProtectedUrl(raw) {
    const s = raw || '';
    const h = normHost(unwrapHttpUrl(s)).replace(/^www\./, '');
    return ((0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(s) ||
        (0, guestFramePolicy_1.isProtectedIdpFrameUrl)(s) ||
        (h !== '' &&
            PROTECTED_PAYMENT_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))));
}
// TODO(b/581816623): Calibrate passive widgets vs active checkout/auth subframes.
function isGuestOnProtectedSurface(wc) {
    const sub = wc.mainFrame?.framesInSubtree;
    const frames = [wc.mainFrame, ...(Array.isArray(sub) ? sub : [])];
    return ((0, webviewUploadValidation_1.isGuestOnProtectedIdp)(wc) ||
        isProtectedUrl(wc.getURL?.()) ||
        frames.some((f) => !f?.isDestroyed?.() &&
            (isProtectedUrl(f?.url) || isProtectedUrl(f?.origin))));
}
function hasProtectedCdpFrame(node) {
    const n = isObject(node) ? node : null;
    const f = isObject(n?.frame) ? n.frame : null;
    const kids = Array.isArray(n?.childFrames) ? n.childFrames : [];
    return ((typeof f?.url === 'string' && isProtectedUrl(f.url)) ||
        (typeof f?.securityOrigin === 'string' &&
            isProtectedUrl(f.securityOrigin)) ||
        kids.some(hasProtectedCdpFrame));
}
const cleanText = (s) => s.replace(/[\r\n\t]/g, ' ').replace(UNSAFE_DESC_CHARS_RE, '');
function scrubSchema(v) {
    if (typeof v === 'string') {
        return cleanText(v);
    }
    if (Array.isArray(v)) {
        return v.map(scrubSchema);
    }
    return isObject(v)
        ? Object.fromEntries(Object.entries(v)
            .map(([k, val]) => [cleanText(k), scrubSchema(val)])
            .filter(([k]) => k !== '__proto__'))
        : v;
}
function sanitizeDescription(raw) {
    const s = typeof raw === 'string' ? cleanText(raw) : '';
    if (utf8Bytes(s) <= 4096) {
        return s;
    }
    let bytes = 0;
    let end = 0;
    for (const ch of s) {
        if ((bytes += utf8Bytes(ch)) > 4096) {
            break;
        }
        end += ch.length;
    }
    return s.slice(0, end);
}
function parseArgs(json) {
    if (typeof json !== 'string' || utf8Bytes(json) > MAX_PAYLOAD_BYTES) {
        return null;
    }
    try {
        const v = JSON.parse(json);
        return isObject(v) && depthOk(v) ? v : null;
    }
    catch {
        return null;
    }
}
/**
 * Sanitizes a guest-registered tool descriptor (`readOnlyHint` is untrusted
 * page metadata and must never bypass URL policy, permissions, or consent).
 */
function toToolInfo(t) {
    const { name, description, inputSchema: s } = t;
    const okSchema = s === undefined ||
        (isObject(s) && depthOk(s) && utf8Bytes(JSON.stringify(s)) <= 16384);
    if (typeof name !== 'string' ||
        !name.trim() ||
        name.length > 128 ||
        UNSAFE_NAME_CHAR_RE.test(name) ||
        !okSchema) {
        return null;
    }
    const ro = t.annotations?.readOnly;
    const schema = s && scrubSchema(s);
    return {
        name,
        description: sanitizeDescription(description),
        ...(schema ? { inputSchema: schema } : {}),
        ...(typeof ro === 'boolean' ? { readOnlyHint: ro } : {}),
    };
}
function toCallResult(r) {
    if (r.status === 'Canceled') {
        return err('CANCELLED', 'Tool invocation was cancelled');
    }
    if (r.status !== 'Completed') {
        const msg = typeof r.errorText === 'string' && r.errorText
            ? r.errorText
            : 'Tool execution failed';
        return err('TOOL_EXECUTION_ERROR', msg.slice(0, 2048));
    }
    // Chromium caps CDP JSON nesting, so stringify cannot overflow the stack.
    const json = JSON.stringify(r.output ?? null);
    return utf8Bytes(json) <= MAX_PAYLOAD_BYTES
        ? { ok: true, resultJson: json }
        : err('INVALID_RESULT', 'Tool result exceeds 64 KiB');
}
const clampTimeout = (ms) => typeof ms === 'number' && Number.isFinite(ms)
    ? Math.min(120000, Math.max(1, Math.trunc(ms)))
    : 30000;
/**
 * Bridges the host renderer to Chromium's native WebMCP in guest tabs over the
 * shared CDP session, sending `WebMCP.enable` only on tabs the agent lists or
 * calls tools on. Nothing is injected into guests.
 */
class GuestWebMcpController {
    constructor() {
        this.enabled = false;
        this.tabs = new Map();
        this.blinkState = new Map();
    }
    isEnabled() {
        return this.enabled;
    }
    /** Records or clears whether guest `wcId` was created with Blink `WebMCP`. */
    noteGuestCreated(wcId, blinkWebMcpEnabled) {
        this.blinkState.set(wcId, blinkWebMcpEnabled);
    }
    noteGuestDisposed(wcId) {
        this.blinkState.delete(wcId);
    }
    /**
     * Updates the WebMCP gate; `enableBlinkFeatures` is fixed at view creation,
     * while `false` immediately disables CDP and settles calls on open tabs.
     */
    setEnabled(enabled) {
        if (enabled === this.enabled) {
            return;
        }
        this.enabled = enabled;
        for (const tab of enabled ? [] : this.tabs.values()) {
            [...tab.inflight.values()].forEach((p) => this.cancel(tab, p, 'OUTCOME_UNKNOWN', DISABLED));
            if (tab.everEnabled) {
                tab.everEnabled = false;
                void tab.wc.debugger.sendCommand('WebMCP.disable').catch(noop);
            }
            this.reset(tab, err('OUTCOME_UNKNOWN', DISABLED));
        }
    }
    async listTools(wc, origin) {
        const tab = await this.ready(wc, origin);
        if (tab === 'blank') {
            return { ok: true, nativeAvailable: false, tools: [] };
        }
        return 'ok' in tab
            ? tab
            : { ok: true, nativeAvailable: true, tools: [...tab.tools.values()] };
    }
    async callTool(wc, sender, origin, params) {
        const tab = await this.ready(wc, origin);
        if (tab !== 'blank' && 'ok' in tab) {
            return tab;
        }
        const args = parseArgs(params?.argsJson);
        const callId = params?.callId;
        const name = params?.name;
        if (!args ||
            typeof callId !== 'string' ||
            !callId ||
            typeof name !== 'string') {
            return err('INVALID_ARGS', 'Invalid tool call parameters');
        }
        if (tab === 'blank' || !tab.tools.has(name)) {
            return err('TOOL_NOT_FOUND', `Tool "${name}" not found`);
        }
        if (tab.inflight.has(callId)) {
            return err('INVALID_ARGS', 'Duplicate callId');
        }
        return new Promise((resolve) => {
            const p = {
                callId,
                owner: sender.id,
                epoch: tab.epoch,
                resolve,
                settled: false,
                cancelRequested: false,
            };
            tab.inflight.set(callId, p);
            const timeout = () => this.cancel(tab, p, 'TIMEOUT', 'Tool timed out');
            p.timer = setTimeout(timeout, clampTimeout(params.timeoutMs));
            p.timer.unref?.();
            tab.awaitingInvoke++;
            const invoke = { frameId: tab.topMainFrameId, toolName: name, input: args };
            tab.wc.debugger.sendCommand('WebMCP.invokeTool', invoke).then((r) => this.onInvoked(tab, p, r?.invocationId), () => this.onInvoked(tab, p, undefined));
        });
    }
    /** Cancels `callId` on guest `wcId` if `senderId` started it. */
    cancelToolCall(wcId, callId, senderId) {
        const tab = typeof callId === 'string' ? this.tabs.get(wcId) : undefined;
        const p = callId ? tab?.inflight.get(callId) : undefined;
        if (!tab || !p || p.owner !== senderId) {
            return false;
        }
        this.cancel(tab, p, 'CANCELLED', 'Tool call cancelled');
        return true;
    }
    gate(wc, origin) {
        if (!this.enabled) {
            return err('WEBMCP_DISABLED', DISABLED);
        }
        if (wc.isDestroyed()) {
            return err('GUEST_UNAVAILABLE', 'Guest is unavailable');
        }
        if ((0, guestFileAttachment_1.isGuestOnBlankOrEmptyUrl)(wc)) {
            return 'blank';
        }
        // Opaque, `null`, and `about:` origins normalize to '' and never match.
        const mainUrl = wc.mainFrame?.url || wc.getURL?.() || '';
        const guestOrigin = (0, guestFileAttachment_1.getGuestMainOrigin)(wc);
        const want = typeof origin === 'string' ? (0, guestFileAttachment_1.extractComparableOrigin)(origin) : '';
        if (!want || want !== guestOrigin) {
            return err('ORIGIN_MISMATCH', 'Guest origin does not match');
        }
        const urls = [mainUrl, wc.getURL?.() || mainUrl, guestOrigin];
        if (!urls.every(isSecureWebMcpUrl)) {
            return err('INSECURE_CONTEXT', 'WebMCP requires https or loopback http');
        }
        return isGuestOnProtectedSurface(wc)
            ? err('IDP_OR_PAYMENT_BLOCKED', BLOCKED_MSG)
            : null;
    }
    /** Gates, syncs, then re-gates against the synced document. */
    async ready(wc, origin) {
        const pre = this.gate(wc, origin);
        if (pre || this.blinkState.get(wc.id) !== true) {
            return pre ?? 'blank';
        }
        const tab = this.tabFor(wc);
        tab.syncing ?? (tab.syncing = tab.synced
            ? undefined
            : this.sync(tab, 1).finally(() => (tab.syncing = undefined)));
        const syncErr = tab.syncing ? await tab.syncing : null;
        return syncErr ?? this.gate(wc, origin) ?? tab;
    }
    /** Re-enables the domain so Chromium replays the document's tools. */
    async sync(tab, retries) {
        const epoch = tab.epoch;
        const stale = () => tab.epoch !== epoch;
        const dbg = tab.wc.debugger;
        const unavailable = () => this.enabled
            ? err('GUEST_UNAVAILABLE', 'WebMCP is unavailable in this guest')
            : err('WEBMCP_DISABLED', DISABLED);
        if (!this.enabled || !(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
            return unavailable();
        }
        try {
            if (tab.everEnabled) {
                await dbg.sendCommand('WebMCP.disable').catch(noop);
            }
            const tree = stale() ? null : await dbg.sendCommand('Page.getFrameTree');
            const root = tree?.frameTree;
            if (!stale() && hasProtectedCdpFrame(root)) {
                return err('IDP_OR_PAYMENT_BLOCKED', BLOCKED_MSG);
            }
            const id = root?.frame?.id;
            if (!stale() && typeof id === 'string') {
                tab.topMainFrameId = id;
                tab.tools.clear();
                tab.everEnabled = true;
                await dbg.sendCommand('WebMCP.enable');
                tab.synced = !stale();
            }
        }
        catch {
            // The domain is missing or the session went away.
        }
        if (tab.synced) {
            return null;
        }
        return this.enabled && stale() && retries > 0
            ? this.sync(tab, retries - 1)
            : unavailable();
    }
    tabFor(wc) {
        const found = this.tabs.get(wc.id);
        if (found) {
            return found;
        }
        const tab = {
            wc,
            epoch: 0,
            synced: false,
            everEnabled: false,
            topMainFrameId: '',
            tools: new Map(),
            inflight: new Map(),
            byInvocation: new Map(),
            awaitingInvoke: 0,
            early: new Map(),
        };
        const lost = (error) => () => this.reset(tab, err('OUTCOME_UNKNOWN', error));
        // Listeners die with the guest, so `destroyed` only drops per-tab maps.
        wc.on('did-navigate', () => this.reset(tab, err('NAVIGATED', 'Guest navigated during tool call')));
        wc.on('render-process-gone', lost('Guest exited'));
        wc.on('destroyed', () => {
            lost('Guest destroyed')();
            this.tabs.delete(wc.id);
            this.blinkState.delete(wc.id);
        });
        wc.debugger.on('detach', () => {
            tab.everEnabled = false;
            lost('Guest debugger detached')();
        });
        wc.debugger.on('message', (_e, method, params) => this.onMessage(tab, method, params));
        this.tabs.set(wc.id, tab);
        return tab;
    }
    onMessage(tab, method, params) {
        const r = (params ?? {});
        if (method === 'WebMCP.toolResponded' &&
            typeof r.invocationId === 'string') {
            const p = tab.byInvocation.get(r.invocationId);
            if (p) {
                this.settle(tab, p, toCallResult(r));
            }
            else if (tab.awaitingInvoke > 0) {
                tab.early.set(r.invocationId, r);
            }
            return;
        }
        if (method !== 'WebMCP.toolsAdded' && method !== 'WebMCP.toolsRemoved') {
            return;
        }
        for (const raw of (Array.isArray(r.tools) ? r.tools : [])) {
            if (raw?.frameId !== tab.topMainFrameId) {
                continue;
            }
            if (method === 'WebMCP.toolsRemoved') {
                if (typeof raw.name === 'string') {
                    tab.tools.delete(raw.name);
                }
                continue;
            }
            const info = toToolInfo(raw);
            if (!info || (!tab.tools.has(info.name) && tab.tools.size >= 64)) {
                continue;
            }
            const next = [...new Map(tab.tools).set(info.name, info).values()];
            if (utf8Bytes(JSON.stringify(next)) <= 256 * 1024) {
                tab.tools.set(info.name, info);
            }
        }
    }
    /** Runs synchronously on the `invokeTool` reply so no event interleaves. */
    onInvoked(tab, p, id) {
        if (typeof id !== 'string') {
            this.settle(tab, p, err('TOOL_EXECUTION_ERROR', 'Invocation failed'));
        }
        else if (p.settled || p.epoch !== tab.epoch) {
            tab.early.delete(id);
            // Only an explicit cancel reaches the page; navigation does not.
            if (p.cancelRequested) {
                sendCancel(tab.wc, id);
            }
        }
        else {
            p.invocationId = id;
            tab.byInvocation.set(id, p);
            const early = tab.early.get(id);
            if (early) {
                tab.early.delete(id);
                this.settle(tab, p, toCallResult(early));
            }
        }
        if (--tab.awaitingInvoke === 0) {
            tab.early.clear();
        }
    }
    cancel(tab, p, code, message) {
        if (p.settled) {
            return;
        }
        p.cancelRequested = true;
        if (p.invocationId !== undefined) {
            sendCancel(tab.wc, p.invocationId);
        }
        this.settle(tab, p, err(code, message));
    }
    settle(tab, p, result) {
        if (p.settled) {
            return;
        }
        p.settled = true;
        clearTimeout(p.timer);
        tab.inflight.delete(p.callId);
        tab.byInvocation.delete(p.invocationId ?? '');
        p.resolve(result);
    }
    /** Starts a new epoch and settles every in-flight call without CDP traffic. */
    reset(tab, result) {
        tab.epoch++;
        tab.synced = false;
        tab.tools.clear();
        tab.early.clear();
        [...tab.inflight.values()].forEach((p) => this.settle(tab, p, result));
    }
}
exports.GuestWebMcpController = GuestWebMcpController;
exports.guestWebMcpController = new GuestWebMcpController();
