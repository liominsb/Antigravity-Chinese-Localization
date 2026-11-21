"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MacComputerSurfaceDriver = exports.MAX_PREVIEW_TARGETS = void 0;
exports.actorArgs = actorArgs;
exports.boundsOf = boundsOf;
exports.policyArgs = policyArgs;
exports.mouseOp = mouseOp;
exports.typeTimeoutMs = typeTimeoutMs;
const driver_1 = require("../computerActuator/driver");
/**
 * The AGY Hub's macOS computer surface (Layer 3 of the computer actuator):
 * implements the vendored ComputerSurfaceDriver contract on top of the
 * `agy-desktop-helper` Swift CLI (desktopHelper.ts supervises it). Each
 * primitive is one helper op; the helper stays authoritative for the deny
 * lists, the per-call allowed apps (§9), system hotkey denies, the browser page
 * policy (R3) and capture redaction, and it enforces the policy each input op
 * carries before posting any event.
 *
 * It also implements the optional background capability
 * (ComputerBackgroundDriver): bind_app, ax_snapshot, ax_press / ax_set_value /
 * ax_select / ax_scroll on snapshot refs, and window_screenshot, which the
 * helper serves without activating apps, moving the cursor or posting HID
 * events, each confined by the same per-call policy.
 *
 * Kept free of Electron imports so it can be unit tested.
 */
const INPUT_TIMEOUT_MS = 10000;
const FOCUS_APP_TIMEOUT_MS = 25000;
const CAPTURE_TIMEOUT_MS = 15000;
const FOCUSED_TIMEOUT_MS = 5000;
/** bind_app may launch the app (15 s) and wait for its first window (5 s). */
const BIND_APP_TIMEOUT_MS = 25000;
const AX_SNAPSHOT_TIMEOUT_MS = 10000;
const AX_ACTION_TIMEOUT_MS = 10000;
/** click_ref may focus the app first (like focus_app), then clicks. */
const CLICK_REF_TIMEOUT_MS = 25000;
const RESOLVE_APP_TIMEOUT_MS = 5000;
const WINDOW_CAPTURE_TIMEOUT_MS = 15000;
function geometryOf(g) {
    return {
        displayId: g.display_id,
        widthPoints: g.width_points,
        heightPoints: g.height_points,
        widthPixels: g.width_pixels,
        heightPixels: g.height_pixels,
        scaleFactor: g.scale_factor,
    };
}
function focusedOf(f) {
    if (!f) {
        return undefined;
    }
    return {
        appName: f.app_name ?? '',
        appId: f.bundle_id ?? '',
        pid: Number(f.pid ?? 0),
        windowTitle: f.window_title ?? '',
    };
}
/** A helper window report (global points). */
function windowOf(raw) {
    const w = (raw ?? {});
    return {
        windowId: Number(w.window_id ?? 0),
        title: String(w.title ?? ''),
        x: Number(w.x ?? 0),
        y: Number(w.y ?? 0),
        widthPoints: Number(w.width_points ?? 0),
        heightPoints: Number(w.height_points ?? 0),
        scaleFactor: Number(w.scale_factor ?? 0),
    };
}
/** The helper's page reports; verdicts pass through lowercased. */
function browserPagesOf(raw) {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    return raw.map((p) => ({
        appId: String(p.bundle_id ?? ''),
        host: String(p.host ?? ''),
        url: String(p.url ?? ''),
        // Unknown verdicts reach Layer 2 as is, which maps them to UNSPECIFIED.
        verdict: String(p.verdict ?? '').toLowerCase(),
        redacted: p.redacted === true,
    }));
}
/**
 * The agent as the helper's JSON args: {actor: {id, label?, color_index?}},
 * or nothing when the call names no agent. The helper namespaces the agent's
 * refs and fences by it.
 */
function actorArgs(o) {
    const a = o?.actor;
    if (!a || !a.id) {
        return {};
    }
    const actor = { id: a.id };
    if (a.label) {
        actor['label'] = a.label;
    }
    if (a.colorIndex !== undefined) {
        actor['color_index'] = a.colorIndex;
    }
    return { actor };
}
/** An abort scope as the actor argument (id only). */
function actorOf(o) {
    return o?.actorId ? { actor: { id: o.actorId } } : {};
}
/** A helper `bounds` reply (global points), if well formed. */
function boundsOf(raw) {
    const b = raw;
    if (!b || typeof b !== 'object') {
        return undefined;
    }
    const v = [b.x, b.y, b.width, b.height].map(Number);
    if (!v.every(Number.isFinite) || v[2] < 0 || v[3] < 0) {
        return undefined;
    }
    return { x: v[0], y: v[1], width: v[2], height: v[3] };
}
/** The policy as the helper's JSON args (always sends allowed_bundle_ids). */
function policyArgs(policy) {
    const args = {
        allowed_bundle_ids: [...policy.allowedAppIds],
    };
    if (policy.pagePolicy) {
        args['url_policy'] = {
            enforce: policy.pagePolicy.enforce,
            epoch: policy.pagePolicy.epoch,
            policy_blocked_domains: [...policy.pagePolicy.blockedDomains],
        };
    }
    return args;
}
/** The helper op and args of a pointer action. */
function mouseOp(a) {
    switch (a.type) {
        case 'click': {
            const op = a.button === 'right'
                ? 'right_click'
                : a.clickCount === 2
                    ? 'double_click'
                    : 'click';
            return { op, args: { x: a.x, y: a.y, modifiers: [...(a.modifiers ?? [])] } };
        }
        case 'move':
            return { op: 'move', args: { x: a.x, y: a.y } };
        case 'drag':
            return {
                op: 'drag',
                args: {
                    x: a.x,
                    y: a.y,
                    to_x: a.toX,
                    to_y: a.toY,
                    modifiers: [...(a.modifiers ?? [])],
                },
            };
        case 'scroll':
            return {
                op: 'scroll',
                args: {
                    ...(a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : {}),
                    dx: a.deltaXLines,
                    dy: a.deltaYLines,
                    modifiers: [...(a.modifiers ?? [])],
                },
            };
    }
}
/**
 * Typing timeout: ~60 ms per character, plus Return/Tab cost a key tap, a
 * 200 ms settle and two focus checks in the helper.
 */
function typeTimeoutMs(text) {
    return (INPUT_TIMEOUT_MS +
        60 * [...text].length +
        300 * (text.match(/[\n\r\t]/g)?.length ?? 0));
}
function failure(r) {
    const blocked = typeof r['blocked_host'] === 'string' && r['blocked_host']
        ? r['blocked_host']
        : undefined;
    // The app the op reached before it failed (F2, TARGET_CHANGED mapping).
    const app = typeof r['bundle_id'] === 'string' && r['bundle_id']
        ? r['bundle_id']
        : undefined;
    // A finer reason under error_code (e.g. SECURE_FIELD_REFUSED), if any.
    const reason = typeof r['reason'] === 'string' && /^[A-Z][A-Z_]{1,63}$/.test(r['reason'])
        ? r['reason']
        : undefined;
    const options = {};
    if (blocked) {
        options.blockedHost = blocked;
    }
    if (app) {
        options.appId = app;
    }
    if (reason) {
        options.reason = reason;
    }
    return new driver_1.ComputerDriverError((r.error_code ?? 'ACTION_FAILED'), r.error ?? 'ACTION_FAILED: unknown helper error', blocked || app || reason ? options : undefined);
}
/** Most preview targets remembered (oldest dropped first). */
exports.MAX_PREVIEW_TARGETS = 32;
const FOREGROUND_OPS = new Set([
    'screenshot',
    'click_ref',
    'click',
    'double_click',
    'right_click',
    'move',
    'drag',
    'scroll',
    'key',
    'type',
]);
const WINDOW_OPS = new Set([
    // Only via notePreviewTarget: the helper's bind_app carries no policy.
    'bind_app',
    'ax_snapshot',
    'ax_press',
    'ax_set_value',
    'ax_select',
    'ax_scroll',
    'window_screenshot',
]);
/** A positive integer window id, else 0. */
function windowIdOf(v) {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
}
/**
 * The window a window op reached: its reply's window, else the one it asked
 * for (when it was for the same app), else the agent's previous one there.
 */
function targetWindowId(appId, r, args, previous) {
    const w = r['window'];
    const replied = w && typeof w === 'object'
        ? windowIdOf(w['window_id'])
        : 0;
    const asked = args['app'] === appId ? windowIdOf(args['window_id']) : 0;
    return replied || asked || (previous?.windowId ?? 0);
}
/** The policy part of a helper request, copied. */
function policyPart(args) {
    const out = {};
    if (Array.isArray(args['allowed_bundle_ids'])) {
        out['allowed_bundle_ids'] = [...args['allowed_bundle_ids']];
    }
    if (args['url_policy'] && typeof args['url_policy'] === 'object') {
        out['url_policy'] = JSON.parse(JSON.stringify(args['url_policy']));
    }
    return out;
}
/** See the file overview. */
class MacComputerSurfaceDriver {
    constructor(helper, 
    /** The actuator_id (e.g. a persisted "desktop-<sha8>"). */
    surfaceId, opts = {}) {
        this.helper = helper;
        this.surfaceId = surfaceId;
        this.opts = opts;
        this.inputListeners = new Set();
        /** The last probe said the helper keeps per-agent state (agent_queues). */
        this.agentQueues = false;
        this.executorListeners = new Set();
        /** Preview targets by "<actor>\n<mode>\n<app>", insertion = recency. */
        this.targets = new Map();
        this.targetListeners = new Set();
        /** Host clock (tests). */
        this.now = () => Date.now();
        helper.onTakeover((ev) => {
            const e = { reason: ev.reason, observedAtMs: ev.observed_at_unix_ms };
            for (const l of [...this.inputListeners]) {
                l(e);
            }
        });
        helper.onReady(() => this.emitExecutor({ state: 'ready' }));
        helper.onExit?.((reason) => this.emitExecutor({ state: 'exited', reason }));
    }
    async describe() {
        const idle = this.opts.idleProbe;
        // Idle answers only for a helper that never started: one that crashed (in
        // restart backoff) is probed, so its failure isn't reported HEALTHY.
        const p = idle && this.helper.running === false && this.helper.started !== true
            ? await idle()
            : await this.helper.probe();
        const level = Number(p.confinement_version ?? 0);
        this.agentQueues = p.agent_queues === true;
        return {
            mainDisplay: geometryOf(p.geometry),
            permissions: {
                accessibility: p.grants.accessibility,
                screenCapture: p.grants.screen_recording,
            },
            osVersion: p.os_version,
            executorVersion: p.helper_version,
            appConfinementVersion: Number.isInteger(level) && level > 0 ? level : 0,
        };
    }
    async capture(o) {
        // Through input(): a display capture records the agent's display preview
        // target, and a failure keeps its blocked host and app like any input.
        const r = await this.input('screenshot', {
            max_long_edge_px: o.maxLongEdgePx,
            ...policyArgs(o.policy),
            ...actorArgs(o),
        }, CAPTURE_TIMEOUT_MS);
        const g = r['geometry'];
        const offDisplay = r['window_off_display'];
        return {
            png: new Uint8Array(Buffer.from(String(r['png_b64'] ?? ''), 'base64')),
            widthPx: Number(r['width_px'] ?? 0),
            heightPx: Number(r['height_px'] ?? 0),
            display: g ? geometryOf(g) : undefined,
            focused: focusedOf(r['focused']),
            browserPages: browserPagesOf(r['browser_pages']),
            windowOffDisplay: typeof offDisplay === 'string' && offDisplay ? offDisplay : undefined,
        };
    }
    async mouse(action, o) {
        const { op, args } = mouseOp(action);
        await this.input(op, { ...args, ...policyArgs(o.policy), ...actorArgs(o) }, INPUT_TIMEOUT_MS);
    }
    async key(keys, o) {
        await this.input('key', { keys, ...policyArgs(o.policy), ...actorArgs(o) }, INPUT_TIMEOUT_MS);
    }
    async text(text, o) {
        await this.input('type', { text, ...policyArgs(o.policy), ...actorArgs(o) }, typeTimeoutMs(text));
    }
    async focusApp(app, o) {
        // With the agent: its HUD Stop fences this op like its other input.
        const r = await this.input('focus_app', { app, ...actorArgs(o) }, FOCUS_APP_TIMEOUT_MS);
        return { appId: String(r['resolved_bundle_id'] ?? '') };
    }
    async focused() {
        const r = await this.helper.call('focused', {}, FOCUSED_TIMEOUT_MS);
        return r.ok
            ? focusedOf(r['focused'])
            : undefined;
    }
    // ---- background (ComputerBackgroundDriver) ----
    async bindApp(app, o) {
        const r = await this.input('bind_app', { app, ...actorArgs(o) }, BIND_APP_TIMEOUT_MS);
        return {
            appId: String(r['resolved_bundle_id'] ?? ''),
            appName: String(r['app_name'] ?? ''),
            pid: Number(r['pid'] ?? 0),
        };
    }
    async axSnapshot(o) {
        const args = {
            app: o.appId,
            include_menubar: o.includeMenubar === true,
            ...policyArgs(o.policy),
            ...actorArgs(o),
        };
        if (o.windowId !== undefined) {
            args['window_id'] = o.windowId;
        }
        if (o.interactiveOnly) {
            args['interactive_only'] = true;
        }
        if (o.maxDepth !== undefined) {
            args['max_depth'] = o.maxDepth;
        }
        if (o.maxNodes !== undefined) {
            args['max_nodes'] = o.maxNodes;
        }
        const r = await this.input('ax_snapshot', args, AX_SNAPSHOT_TIMEOUT_MS);
        const snap = {
            text: String(r['text'] ?? ''),
            epoch: Number(r['epoch'] ?? 0),
            nodeCount: Number(r['node_count'] ?? 0),
            truncated: r['truncated'] === true,
        };
        if (r['window']) {
            snap.targetWindow = windowOf(r['window']);
        }
        if (typeof r['bundle_id'] === 'string' && r['bundle_id']) {
            snap.appId = r['bundle_id'];
        }
        return snap;
    }
    axPress(ref, o) {
        return this.element('ax_press', { ref }, o);
    }
    axSetValue(ref, text, o) {
        return this.element('ax_set_value', { ref, text, confirm: o.confirm === true }, o);
    }
    axSelect(ref, o) {
        return this.element('ax_select', { ref }, o);
    }
    /**
     * Read-only (helper resolve_app): never launches or activates. Undefined
     * when no app matches; throws when the helper couldn't answer (e.g. a
     * timeout), which is not a verdict on the app.
     */
    async resolveApp(app) {
        const r = await this.helper.call('resolve_app', { app }, RESOLVE_APP_TIMEOUT_MS);
        if (!r.ok) {
            if (r['error_code'] === 'APP_NOT_FOUND') {
                return undefined;
            }
            throw failure(r);
        }
        const id = r['bundle_id'];
        return typeof id === 'string' && id ? id : undefined;
    }
    clickRef(ref, o) {
        return this.element('click_ref', { ref }, o, CLICK_REF_TIMEOUT_MS);
    }
    axScroll(ref, delta, o) {
        return this.element('ax_scroll', { ref, dx: delta.deltaXLines, dy: delta.deltaYLines }, o);
    }
    async windowScreenshot(o) {
        const args = {
            app: o.appId,
            max_long_edge_px: o.maxLongEdgePx,
            ...policyArgs(o.policy),
            ...actorArgs(o),
        };
        if (o.windowId !== undefined) {
            args['window_id'] = o.windowId;
        }
        const r = await this.input('window_screenshot', args, WINDOW_CAPTURE_TIMEOUT_MS);
        const shot = {
            png: new Uint8Array(Buffer.from(String(r['png_b64'] ?? ''), 'base64')),
            widthPx: Number(r['width_px'] ?? 0),
            heightPx: Number(r['height_px'] ?? 0),
            targetWindow: windowOf(r['window']),
        };
        const pages = browserPagesOf(r['browser_pages']);
        if (pages) {
            shot.browserPages = pages;
        }
        if (typeof r['bundle_id'] === 'string' && r['bundle_id']) {
            shot.appId = r['bundle_id'];
        }
        return shot;
    }
    // ---- fence, arming, events ----
    /** True while the helper runs agents concurrently (from the last probe). */
    multiAgent() {
        return this.agentQueues;
    }
    abort(o) {
        // A helper that isn't running has no op to stop and no fence to keep:
        // Layer 2 fences paused and stopped agents itself and fences a helper
        // again when it (re)starts. Never start one just to abort.
        if (this.helper.running === false) {
            return;
        }
        // Out of band in the helper: also stops an op that is already running.
        // With an actor, only that agent's (a helper without agent queues
        // ignores it and fences everything, which is safe).
        void this.helper.call('abort', actorArgs(actorOf(o)));
    }
    async clearAbort(o) {
        // A helper that isn't running starts unfenced.
        if (this.helper.running === false) {
            return;
        }
        // Queues behind the running helper op (that agent's, with an actor).
        await this.helper.call('clear_abort', actorArgs(actorOf(o)));
    }
    setTakeoverArmed(armed) {
        // A helper that isn't running starts disarmed; arming starts it.
        if (!armed && this.helper.running === false) {
            return;
        }
        void this.helper.call('arm_takeover', { armed });
    }
    onUserInput(listener) {
        this.inputListeners.add(listener);
        return () => {
            this.inputListeners.delete(listener);
        };
    }
    onExecutorEvent(listener) {
        this.executorListeners.add(listener);
        return () => {
            this.executorListeners.delete(listener);
        };
    }
    emitExecutor(e) {
        for (const l of [...this.executorListeners]) {
            l(e);
        }
    }
    /** An AX action on a ref: resolves with the element's app and frame. */
    async element(op, args, o, timeoutMs = AX_ACTION_TIMEOUT_MS) {
        const r = await this.input(op, { ...args, ...policyArgs(o.policy), ...actorArgs(o) }, timeoutMs);
        const t = { appId: String(r['bundle_id'] ?? '') };
        const b = boundsOf(r['bounds']);
        if (b) {
            t.bounds = b;
        }
        // The element's window frame at action time (display only: Layer 2
        // places an agent's visual hint in it, #1456).
        const w = boundsOf(r['window_bounds']);
        if (w && w.width > 0 && w.height > 0) {
            t.windowBounds = w;
        }
        return t;
    }
    async input(op, args, timeoutMs) {
        const r = await this.helper.call(op, args, timeoutMs);
        if (!r.ok) {
            throw failure(r);
        }
        this.recordTarget(op, args, r);
        return r;
    }
    // ---- preview targets (P3) ----
    /** The preview targets, most recent first. */
    previewTargets() {
        return [...this.targets.values()].reverse();
    }
    /** Called whenever the targets change. */
    onPreviewTargets(listener) {
        this.targetListeners.add(listener);
        return () => {
            this.targetListeners.delete(listener);
        };
    }
    /** Previews a just-bound app's window (recorded as a bind_app target). */
    notePreviewTarget(appId, o) {
        this.recordTarget('bind_app', { app: appId, ...policyArgs(o.policy), ...actorArgs(o) }, { ok: true });
    }
    /** Forgets an agent's targets (its lease ended or it was stopped). */
    forgetPreviewTargets(actorId) {
        let changed = false;
        for (const [k, t] of this.targets) {
            if (t.actorId === actorId) {
                this.targets.delete(k);
                changed = true;
            }
        }
        if (changed) {
            this.emitTargets();
        }
    }
    /**
     * Remembers what a successful policy-carrying call reached: the app of an
     * AX / window op (its reply's bundle_id, else the requested app) or, for a
     * foreground op, the display.
     */
    recordTarget(op, args, r) {
        if (!Array.isArray(args['allowed_bundle_ids'])) {
            return;
        }
        const actor = args['actor'];
        const actorId = typeof actor?.id === 'string' ? actor.id : '';
        let t;
        if (WINDOW_OPS.has(op)) {
            const replied = r['bundle_id'];
            const appId = typeof replied === 'string' && replied
                ? replied
                : typeof args['app'] === 'string'
                    ? args['app']
                    : '';
            if (!appId) {
                return;
            }
            t = {
                actorId,
                mode: 'window',
                appId,
                policyArgs: policyPart(args),
                atMs: 0,
            };
            const wid = targetWindowId(appId, r, args, this.targets.get(`${actorId}\nwindow\n${appId}`));
            if (wid) {
                t.windowId = wid;
            }
        }
        else if (FOREGROUND_OPS.has(op)) {
            t = {
                actorId,
                mode: 'display',
                appId: '',
                policyArgs: policyPart(args),
                atMs: 0,
            };
        }
        else {
            return;
        }
        t.atMs = this.now();
        const key = `${t.actorId}\n${t.mode}\n${t.appId}`;
        this.targets.delete(key);
        this.targets.set(key, t);
        while (this.targets.size > exports.MAX_PREVIEW_TARGETS) {
            const oldest = this.targets.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.targets.delete(oldest);
        }
        this.emitTargets();
    }
    emitTargets() {
        for (const l of [...this.targetListeners]) {
            try {
                l();
            }
            catch {
                // A listener never affects the call.
            }
        }
    }
}
exports.MacComputerSurfaceDriver = MacComputerSurfaceDriver;
