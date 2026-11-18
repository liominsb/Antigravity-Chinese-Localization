"use strict";
/**
 * @fileoverview Script mode, Zone B: the mediator between the untrusted
 * script (Zone C, `agy-desktop-script`, which can only send JSON-RPC calls on
 * its stdio) and the computer action layer. Every call is checked here
 * (method allowlist, arguments, op and screenshot budgets, the declared
 * foreground, the request's apps) and then run as a one-action batch through
 * the same Layer 2 path as any batch action (`exec`), so every fence, policy
 * and confinement check of batch mode applies unchanged (rt SM-1). Nothing a
 * script does widens what the request allows (SM-2).
 *
 * Outcomes are classified (review P0-4): a UI miss is answered as a
 * catchable error the script can handle; anything else (a human fence,
 * consent, policy, confinement, contention, a budget) kills the script, and
 * the request's result carries the ledger of the calls made so far (P0-3).
 *
 * Pure apart from `exec`; never logs script source, text or values (SM-7).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptRpcMediator = exports.INTERRUPTED = exports.CATCHABLE_CODES = exports.SCRIPT_LIMITS = void 0;
exports.scriptCode = scriptCode;
const protobuf_1 = require("@bufbuild/protobuf");
const computer_payload_pb_1 = require("../proto/computer_payload_pb");
const computerOps_1 = require("./computerOps");
/** Script mode bounds (review P0-3, P1-1, P1-4; rt SM-4). */
exports.SCRIPT_LIMITS = {
    maxSourceBytes: 64 * 1024,
    maxOps: 64,
    maxScreenshots: 16,
    maxConsecutiveErrors: 8,
    ledgerSize: 24,
    maxValueBytes: 256 * 1024,
    maxTargetBytes: 128,
    maxSleepMs: 10000,
    /** Least time between two input calls (click/type/key/drag/scroll). */
    minInputGapMs: 30,
};
/** UI misses the script may catch (review P0-4). */
exports.CATCHABLE_CODES = new Set([
    'STALE_REF',
    'ELEMENT_NOT_FOUND',
    'AX_ACTION_FAILED',
    'ACTION_NOT_SUPPORTED',
    'SELECTION_UNCHANGED',
    'NO_WINDOW',
    'WINDOW_MINIMIZED_OR_CLOSED',
    'WINDOW_OFF_DISPLAY',
    'INVALID_ARGUMENT',
]);
const FOREGROUND_METHODS = new Set([
    'clickRef',
    'focusApp',
    'screenshot',
    'click',
    'doubleClick',
    'rightClick',
    'move',
    'drag',
    'typeText',
    'keyCombo',
    'scroll',
]);
const INPUT_METHODS = new Set([
    'clickRef',
    'click',
    'doubleClick',
    'rightClick',
    'move',
    'drag',
    'typeText',
    'keyCombo',
    'scroll',
]);
const ALL_METHODS = new Set([
    ...FOREGROUND_METHODS,
    'bindApp',
    'axSnapshot',
    'axPress',
    'axSetValue',
    'axSelect',
    'axScroll',
    'windowScreenshot',
    'sleep',
]);
/** A ref as the LS bounds it: 1..64 of [A-Za-z0-9._:-]. */
const REF_RE = /^[A-Za-z0-9._:-]{1,64}$/;
/** A bundle id (what the request's allowed apps hold). */
/**
 * An app as a script names it: a bundle id or a display name (resolved to a
 * bundle id before anything runs); no control or format characters.
 */
const APP_RE = /^[^\p{Cc}\p{Cf}]{1,255}$/u;
const NAME_RE = /^[A-Za-z0-9 _.:-]{1,64}$/;
const MODIFIERS = new Set([
    'cmd',
    'shift',
    'option',
    'ctrl',
    'fn',
]);
/** The ledger status of a call the script's end cut short. */
exports.INTERRUPTED = 'INTERRUPTED';
const ENDED = {
    kill: { code: exports.INTERRUPTED, message: 'INTERRUPTED: the script ended' },
};
class Invalid extends Error {
}
function str(v, what, re) {
    if (typeof v !== 'string' || (re && !re.test(v))) {
        throw new Invalid(`${what} must be a valid string`);
    }
    return v;
}
function optStr(v, what, re) {
    return v === undefined || v === null ? undefined : str(v, what, re);
}
function num(v, what, min, max) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
        throw new Invalid(`${what} must be a number in ${min}..${max}`);
    }
    return v;
}
function int(v, what, min, max) {
    const n = num(v, what, min, max);
    if (!Number.isInteger(n)) {
        throw new Invalid(`${what} must be an integer`);
    }
    return n;
}
function mods(v) {
    if (v === undefined || v === null) {
        return [];
    }
    if (!Array.isArray(v) || v.length > 5) {
        throw new Invalid('modifiers must be a list of cmd, shift, option, ctrl, fn');
    }
    return v.map((m) => {
        if (typeof m !== 'string' || !MODIFIERS.has(m)) {
            throw new Invalid('modifiers must be a list of cmd, shift, option, ctrl, fn');
        }
        return m;
    });
}
/** Bytes of `s` (UTF-8), capped to `max` on a code point boundary. */
function capUtf8(s, max) {
    if (Buffer.byteLength(s, 'utf8') <= max) {
        return s;
    }
    let out = '';
    for (const ch of s) {
        if (Buffer.byteLength(out + ch, 'utf8') > max) {
            break;
        }
        out += ch;
    }
    return out;
}
/**
 * Maps a one-action batch failure to the script-mode code: the surface's
 * finer reason when it gave one (carried as the action's error code in
 * script mode), and the known texts of refusals older helpers report only as
 * ACTION_FAILED. An ACTION_FAILED of an element action is an AX miss; any
 * other unknown failure fails closed (uncatchable).
 */
function scriptCode(method, code, message) {
    switch (code) {
        case 'APP_NOT_ALLOWED':
            return 'APP_NEEDS_PERMISSION';
        case 'KEY_DENIED':
            return 'SYSTEM_HOTKEY_DENIED';
        case 'URL_BLOCKED':
        case 'URL_NEEDS_PERMISSION':
            return 'URL_POLICY_BLOCKED';
        case 'PERMISSION_MISSING':
            return 'TCC_REVOKED';
        case 'ACTION_FAILED': {
            if (/WINDOW_CONTROL:/.test(message)) {
                return 'WINDOW_CONTROL';
            }
            if (/password field|secure text field/i.test(message)) {
                return 'SECURE_FIELD_REFUSED';
            }
            if (/has no window|no window/i.test(message)) {
                return 'NO_WINDOW';
            }
            if (method === 'axPress' ||
                method === 'axSetValue' ||
                method === 'axSelect' ||
                method === 'axScroll') {
                if (/ignored the selection|nothing changed/i.test(message)) {
                    return 'SELECTION_UNCHANGED';
                }
                return 'AX_ACTION_FAILED';
            }
            return code;
        }
        default:
            return code;
    }
}
/** The mediator of one script run. */
class ScriptRpcMediator {
    constructor(opts) {
        this.opts = opts;
        this.ledger = [];
        this.total = 0;
        this.ops = 0;
        this.consecutiveErrors = 0;
        this.lastInputAt = -Infinity;
        /** Set when the script settled: no call runs after it (rt #1902, #1905). */
        this.closed = false;
        this.inflight = new Set();
        this.idleWaiters = [];
        this.screenshots = [];
        /** Names resolved to bundle ids in this script (found ones only). */
        this.resolved = new Map();
        this.allowed = new Set(opts.allowedAppIds.map((a) => a.toLowerCase()));
        this.now = opts.now ?? (() => Date.now());
        this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    }
    /** The last <= 24 calls, in order. */
    completedOps() {
        return [...this.ledger];
    }
    /** How many calls the script made. */
    totalOps() {
        return this.total;
    }
    /**
     * The script settled: every later or queued call is refused, and a call
     * still running records how it ended without answering (see
     * {@link abandonInflight}).
     */
    close() {
        this.closed = true;
    }
    /** Whether a call is between entry and its answer. */
    busy() {
        return this.inflight.size > 0;
    }
    /** Resolves once no call is in flight. */
    idle() {
        if (this.inflight.size === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => this.idleWaiters.push(resolve));
    }
    /**
     * Records each call still in flight as INTERRUPTED now (its own end is
     * then not recorded), so the ledger copied for the result lists it.
     */
    abandonInflight() {
        for (const c of this.inflight) {
            this.end(c, c.app, exports.INTERRUPTED);
        }
    }
    /** Writes `call`'s ledger entry once. */
    end(call, app, status) {
        if (!call.recorded) {
            call.recorded = true;
            this.record(call.method, app, call.target, status);
        }
    }
    record(method, app, target, status) {
        this.total++;
        this.ledger.push((0, protobuf_1.create)(computer_payload_pb_1.ComputerCompletedOpSchema, {
            seq: this.total,
            method,
            app: capUtf8(app, 255),
            target: capUtf8(target, exports.SCRIPT_LIMITS.maxTargetBytes),
            status,
        }));
        if (this.ledger.length > exports.SCRIPT_LIMITS.ledgerSize) {
            this.ledger.shift();
        }
    }
    /** `app`'s bundle id through resolveApp; `failed` if it couldn't tell. */
    async resolve(app) {
        const key = app.toLowerCase();
        const hit = this.resolved.get(key);
        if (hit) {
            return { bundleId: hit };
        }
        if (!this.opts.resolveApp) {
            return {};
        }
        try {
            const bundleId = (await this.opts.resolveApp(app)) || undefined;
            if (bundleId) {
                this.resolved.set(key, bundleId);
            }
            return { bundleId };
        }
        catch (_e) {
            return { failed: true };
        }
    }
    requireApp(app) {
        return this.allowed.has(app.toLowerCase()) ? undefined : app;
    }
    /** Handles one call; never throws. */
    async onRpc(method, params) {
        if (this.closed) {
            return ENDED;
        }
        const call = { method, app: '', target: '', recorded: false };
        this.inflight.add(call);
        try {
            return await this.handle(method, params, call);
        }
        finally {
            this.inflight.delete(call);
            if (this.inflight.size === 0) {
                const waiters = this.idleWaiters;
                this.idleWaiters = [];
                for (const w of waiters) {
                    w();
                }
            }
        }
    }
    async handle(method, params, call) {
        if (!ALL_METHODS.has(method)) {
            return {
                kill: {
                    code: 'PROTOCOL_VIOLATION',
                    message: 'PROTOCOL_VIOLATION: unknown script call',
                },
            };
        }
        const p = params && typeof params === 'object' && !Array.isArray(params)
            ? params
            : {};
        if (++this.ops > exports.SCRIPT_LIMITS.maxOps) {
            return {
                kill: {
                    code: 'OP_BUDGET_EXCEEDED',
                    message: `OP_BUDGET_EXCEEDED: a script may make at most ${exports.SCRIPT_LIMITS.maxOps} calls`,
                },
            };
        }
        if (FOREGROUND_METHODS.has(method) && !this.opts.foreground) {
            this.end(call, '', 'FOREGROUND_NOT_DECLARED');
            return {
                kill: {
                    code: 'FOREGROUND_NOT_DECLARED',
                    message: `FOREGROUND_NOT_DECLARED: ${method} needs foreground: true on the desktop call`,
                },
            };
        }
        let built;
        try {
            built = this.build(method, p);
        }
        catch (err) {
            if (err instanceof Invalid) {
                this.end(call, '', 'INVALID_ARGUMENT');
                return this.catchable('INVALID_ARGUMENT', `INVALID_ARGUMENT: ${method}: ${err.message}`);
            }
            throw err;
        }
        call.app = built.app;
        call.target = built.target;
        // SM-2: no app outside the request's (consented ∩ locked) apps. A name
        // is resolved to its bundle id first, and the call then names that
        // bundle id, so the surface acts on exactly the app that was checked.
        if (built.app && this.requireApp(built.app) !== undefined) {
            const r = await this.resolve(built.app);
            if (r.failed) {
                // Not a verdict on the app (e.g. the helper was busy): the script
                // may retry or use the bundle id (rt #1935 P2-4).
                this.end(call, built.app, 'APP_LOOKUP_FAILED');
                return this.catchable('APP_LOOKUP_FAILED', `APP_LOOKUP_FAILED: could not look up the app ${capUtf8(built.app, 255)} right now; retry, or name it by bundle id`);
            }
            const bundleId = r.bundleId;
            if (bundleId && this.requireApp(bundleId) === undefined) {
                built.action.app = bundleId;
                built.app = bundleId;
                call.app = bundleId;
            }
        }
        if (built.app) {
            const out = this.requireApp(built.app);
            if (out !== undefined) {
                this.end(call, built.app, 'APP_NEEDS_PERMISSION');
                return {
                    kill: {
                        code: 'APP_NEEDS_PERMISSION',
                        message: `APP_NEEDS_PERMISSION: ${capUtf8(out, 255)} is not one of this call's apps; pass it in apps on the next desktop call`,
                    },
                };
            }
        }
        if ((method === 'screenshot' || method === 'windowScreenshot') &&
            this.screenshots.length >= exports.SCRIPT_LIMITS.maxScreenshots) {
            this.end(call, built.app, 'SCREENSHOT_BUDGET_EXCEEDED');
            return {
                kill: {
                    code: 'SCREENSHOT_BUDGET_EXCEEDED',
                    message: `SCREENSHOT_BUDGET_EXCEEDED: a script may take at most ${exports.SCRIPT_LIMITS.maxScreenshots} screenshots`,
                },
            };
        }
        if (INPUT_METHODS.has(method)) {
            const wait = this.lastInputAt + exports.SCRIPT_LIMITS.minInputGapMs - this.now();
            if (wait > 0) {
                await this.sleep(wait);
            }
            this.lastInputAt = this.now();
        }
        // Nothing runs once the script settled, queued calls included (#1905 a).
        if (this.closed) {
            this.end(call, built.app, exports.INTERRUPTED);
            return ENDED;
        }
        let out;
        try {
            out = await this.opts.exec(built.action, method === 'clickRef' ? { clickRef: true } : undefined);
        }
        catch (err) {
            this.end(call, built.app, 'ACTION_FAILED');
            return {
                kill: {
                    code: 'ACTION_FAILED',
                    message: `ACTION_FAILED: ${method} failed: ${String(err)}`,
                },
            };
        }
        const r = out.result;
        const a = r.results[0];
        const app = a?.resolvedBundleId || built.app;
        if (!r.ok || (a && !a.ok)) {
            const raw = (a && !a.ok ? a.errorCode : r.errorCode) || 'ACTION_FAILED';
            const text = (a && !a.ok ? a.error : r.error) || raw;
            const code = scriptCode(method, raw, text);
            if (this.closed) {
                // The end's fence stops a running call; the surface reports that as
                // a takeover.
                this.end(call, app, code === 'USER_TAKEOVER' || code === exports.INTERRUPTED ? exports.INTERRUPTED : code);
                return ENDED;
            }
            this.end(call, app, code);
            if (exports.CATCHABLE_CODES.has(code)) {
                return this.catchable(code, text);
            }
            return { kill: { code, message: text } };
        }
        this.end(call, app, 'ok');
        if (this.closed) {
            // It ran (the ledger says so), but the script is gone: no reply, and a
            // late screenshot doesn't join the result.
            return ENDED;
        }
        // Only a fresh snapshot ends a run of failures (P1-4): a cheap success
        // (e.g. a sleep) between misses doesn't.
        if (method === 'axSnapshot') {
            this.consecutiveErrors = 0;
        }
        return { result: this.reply(method, p, out, app) };
    }
    catchable(code, message) {
        if (++this.consecutiveErrors > exports.SCRIPT_LIMITS.maxConsecutiveErrors) {
            return {
                kill: {
                    code: 'TOO_MANY_CONSECUTIVE_ERRORS',
                    message: `TOO_MANY_CONSECUTIVE_ERRORS: more than ${exports.SCRIPT_LIMITS.maxConsecutiveErrors} failed calls in a row; take a new axSnapshot and retry`,
                },
            };
        }
        return { error: { code, message } };
    }
    /** The one action of `method`; throws Invalid on a bad argument. */
    build(method, p) {
        const T = computer_payload_pb_1.ComputerActionType;
        const mk = (init) => (0, protobuf_1.create)(computer_payload_pb_1.ComputerActionSchema, init);
        switch (method) {
            case 'bindApp':
            case 'focusApp': {
                const app = str(p['app'], 'app', APP_RE);
                return {
                    action: mk({
                        type: method === 'bindApp' ? T.BIND_APP : T.FOCUS_APP,
                        app,
                    }),
                    app,
                    target: app,
                };
            }
            case 'axSnapshot': {
                const app = str(p['app'], 'app', APP_RE);
                const windowId = p['windowId'] === undefined
                    ? 0
                    : int(p['windowId'], 'windowId', 0, 0xffffffff);
                return {
                    action: mk({
                        type: T.AX_SNAPSHOT,
                        app,
                        windowId,
                        includeMenubar: p['includeMenubar'] === true,
                    }),
                    app,
                    target: app,
                };
            }
            case 'axPress':
            case 'axSelect':
            case 'clickRef': {
                const ref = str(p['ref'], 'ref', REF_RE);
                return {
                    action: mk({
                        type: method === 'axSelect' ? T.AX_SELECT : T.AX_PRESS,
                        ref,
                    }),
                    app: '',
                    target: ref,
                };
            }
            case 'axSetValue': {
                const ref = str(p['ref'], 'ref', REF_RE);
                const text = str(p['text'], 'text');
                if ([...text].length > computerOps_1.MAX_TEXT_RUNES) {
                    throw new Invalid(`text has more than ${computerOps_1.MAX_TEXT_RUNES} characters`);
                }
                return {
                    action: mk({
                        type: T.AX_SET_VALUE,
                        ref,
                        text,
                        confirm: p['confirm'] === true,
                    }),
                    app: '',
                    target: ref,
                };
            }
            case 'axScroll': {
                const ref = str(p['ref'], 'ref', REF_RE);
                return {
                    action: mk({
                        type: T.AX_SCROLL,
                        ref,
                        scrollDx: int(p['dx'] ?? 0, 'dx', -computerOps_1.MAX_SCROLL_LINES, computerOps_1.MAX_SCROLL_LINES),
                        scrollDy: int(p['dy'] ?? 0, 'dy', -computerOps_1.MAX_SCROLL_LINES, computerOps_1.MAX_SCROLL_LINES),
                    }),
                    app: '',
                    target: ref,
                };
            }
            case 'windowScreenshot': {
                const app = str(p['app'], 'app', APP_RE);
                optStr(p['name'], 'name', NAME_RE);
                const windowId = p['windowId'] === undefined
                    ? 0
                    : int(p['windowId'], 'windowId', 0, 0xffffffff);
                return {
                    action: mk({ type: T.WINDOW_SCREENSHOT, app, windowId }),
                    app,
                    target: app,
                };
            }
            case 'screenshot':
                optStr(p['name'], 'name', NAME_RE);
                return { action: mk({ type: T.SCREENSHOT }), app: '', target: 'display' };
            case 'click':
            case 'doubleClick':
            case 'rightClick':
            case 'move': {
                const x = num(p['x'], 'x', -100000, 100000);
                const y = num(p['y'], 'y', -100000, 100000);
                const type = {
                    click: T.CLICK,
                    doubleClick: T.DOUBLE_CLICK,
                    rightClick: T.RIGHT_CLICK,
                    move: T.MOVE,
                }[method];
                return {
                    action: mk({
                        type,
                        hasPoint: true,
                        xPoints: x,
                        yPoints: y,
                        modifiers: method === 'move' ? [] : mods(p['modifiers']),
                    }),
                    app: '',
                    target: `${Math.round(x)},${Math.round(y)}`,
                };
            }
            case 'drag': {
                const x = num(p['x'], 'x', -100000, 100000);
                const y = num(p['y'], 'y', -100000, 100000);
                const toX = num(p['toX'], 'toX', -100000, 100000);
                const toY = num(p['toY'], 'toY', -100000, 100000);
                return {
                    action: mk({
                        type: T.DRAG,
                        hasPoint: true,
                        xPoints: x,
                        yPoints: y,
                        toXPoints: toX,
                        toYPoints: toY,
                        modifiers: mods(p['modifiers']),
                    }),
                    app: '',
                    target: `${Math.round(x)},${Math.round(y)}->${Math.round(toX)},${Math.round(toY)}`,
                };
            }
            case 'scroll': {
                const hasPoint = p['x'] !== undefined || p['y'] !== undefined;
                return {
                    action: mk({
                        type: T.SCROLL,
                        hasPoint,
                        xPoints: hasPoint ? num(p['x'], 'x', -100000, 100000) : 0,
                        yPoints: hasPoint ? num(p['y'], 'y', -100000, 100000) : 0,
                        scrollDx: int(p['dx'] ?? 0, 'dx', -computerOps_1.MAX_SCROLL_LINES, computerOps_1.MAX_SCROLL_LINES),
                        scrollDy: int(p['dy'] ?? 0, 'dy', -computerOps_1.MAX_SCROLL_LINES, computerOps_1.MAX_SCROLL_LINES),
                        modifiers: mods(p['modifiers']),
                    }),
                    app: '',
                    target: 'scroll',
                };
            }
            case 'typeText': {
                const text = str(p['text'], 'text');
                if (!text || [...text].length > computerOps_1.MAX_TEXT_RUNES) {
                    throw new Invalid(`text must have 1..${computerOps_1.MAX_TEXT_RUNES} characters`);
                }
                // Never typed text in the ledger (SM-3).
                return {
                    action: mk({ type: T.TYPE, text }),
                    app: '',
                    target: `${[...text].length} chars`,
                };
            }
            case 'keyCombo': {
                const keys = str(p['keys'], 'keys', /^[A-Za-z0-9+_ ,.;'`\-=/\\[\]]{1,64}$/);
                return { action: mk({ type: T.KEY, keys }), app: '', target: keys };
            }
            case 'sleep': {
                const ms = int(p['ms'], 'ms', 0, exports.SCRIPT_LIMITS.maxSleepMs);
                return {
                    action: mk({ type: T.WAIT, waitMs: ms }),
                    app: '',
                    target: `${ms}ms`,
                };
            }
        }
    }
    /** What the script sees of a successful call (never the image bytes). */
    reply(method, p, out, app) {
        const r = out.result;
        const a = r.results[0];
        const bounds = a?.targetBounds
            ? {
                x: a.targetBounds.xPoints,
                y: a.targetBounds.yPoints,
                width: a.targetBounds.widthPoints,
                height: a.targetBounds.heightPoints,
            }
            : undefined;
        switch (method) {
            case 'axSnapshot':
                return {
                    text: r.axSnapshotText,
                    appId: app,
                    truncated: out.axTruncated === true ||
                        r.axSnapshotText.endsWith(computerOps_1.AX_SNAPSHOT_TRUNCATED_NOTICE),
                };
            case 'screenshot':
            case 'windowScreenshot': {
                if (!out.blob) {
                    return { appId: app };
                }
                const n = this.screenshots.length + 1;
                const name = typeof p['name'] === 'string' && p['name']
                    ? p['name']
                    : `script_screenshot_${n}`;
                this.screenshots.push({ name, blob: out.blob, appId: app });
                return {
                    name,
                    index: n,
                    widthPx: out.blob.widthPx ?? r.screenshotWidthPx,
                    heightPx: out.blob.heightPx ?? r.screenshotHeightPx,
                    appId: app,
                };
            }
            case 'bindApp':
            case 'focusApp':
                return { appId: app };
            case 'axPress':
            case 'axSetValue':
            case 'axSelect':
            case 'axScroll':
            case 'clickRef':
                return { appId: app, ...(bounds ? { bounds } : {}) };
            default:
                return {};
        }
    }
}
exports.ScriptRpcMediator = ScriptRpcMediator;
