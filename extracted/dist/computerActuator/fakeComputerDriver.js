"use strict";
/**
 * @fileoverview Scriptable in-memory ComputerSurfaceDrivers for tests of the
 * computer action layer and of hosts that use it: a foreground-only surface
 * and one with the background capability. Framework-free (no jasmine or
 * vitest APIs), so any test runner can use them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeBackgroundComputerDriver = exports.FAKE_BOUND = exports.FAKE_WINDOW = exports.FakeComputerDriver = exports.FAKE_FOCUSED = exports.FAKE_PNG = exports.FAKE_DISPLAY = void 0;
const driver_1 = require("./driver");
/** The main display the fake reports unless a test changes it. */
exports.FAKE_DISPLAY = {
    displayId: 3,
    widthPoints: 1512,
    heightPoints: 982,
    widthPixels: 3024,
    heightPixels: 1964,
    scaleFactor: 2,
};
/** The PNG signature the fake captures return. */
exports.FAKE_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** The frontmost app the fake reports. */
exports.FAKE_FOCUSED = {
    appName: 'TextEdit',
    appId: 'com.apple.TextEdit',
    pid: 42,
    windowTitle: 'Untitled',
};
const META_OPS = new Set([
    'describe',
    'screenshot',
    'focused',
    'arm_takeover',
    'abort',
    'clear_abort',
]);
/**
 * Records every call under the op names of the AGY Hub's helper protocol
 * (`click`, `double_click`, `right_click`, `move`, `drag`, `scroll`, `key`,
 * `type`, `focus_app`, `screenshot`, ...). A test can fail an op
 * (`failures`), override the capture (`nextCapture`), run code when an op
 * starts (`hooks`), or hold one op until the next abort (`gateOp`).
 */
class FakeComputerDriver {
    constructor() {
        this.surfaceId = 'computer-fake';
        this.calls = [];
        this.display = { ...exports.FAKE_DISPLAY };
        this.permissions = { accessibility: true, screenCapture: true };
        /** The confinement level `describe` reports. */
        this.confinement = 2;
        /** Ops that throw this error instead of succeeding. */
        this.failures = {};
        this.hooks = {};
        /** If set, this op blocks until abort(), then fails with USER_TAKEOVER. */
        this.gateOp = '';
        this.armed = false;
        this.fenced = false;
        /** The actor every call carried, in call order (absent: none). */
        this.actors = [];
        this.inputListeners = new Set();
        this.executorListeners = new Set();
    }
    async describe() {
        this.record('describe', {});
        if (this.describeError) {
            const err = this.describeError;
            this.describeError = undefined;
            throw err;
        }
        return {
            mainDisplay: { ...this.display },
            permissions: { ...this.permissions },
            osVersion: 'macOS 15.8.1',
            executorVersion: '0.1.0',
            appConfinementVersion: this.confinement,
        };
    }
    async capture(o) {
        this.noteActor('screenshot', o);
        await this.run('screenshot', {
            maxLongEdgePx: o.maxLongEdgePx,
            policy: o.policy,
        });
        const shot = {
            png: exports.FAKE_PNG,
            widthPx: 1440,
            heightPx: 935,
            display: { ...this.display },
            focused: exports.FAKE_FOCUSED,
            ...this.nextCapture,
        };
        this.nextCapture = undefined;
        return shot;
    }
    async mouse(action, o) {
        let op = action.type;
        if (action.type === 'click') {
            op =
                action.button === 'right'
                    ? 'right_click'
                    : action.clickCount === 2
                        ? 'double_click'
                        : 'click';
        }
        this.noteActor(op, o);
        await this.run(op, { ...action, policy: o.policy });
    }
    async key(keys, o) {
        this.noteActor('key', o);
        await this.run('key', { keys, policy: o.policy });
    }
    async text(text, o) {
        this.noteActor('type', o);
        await this.run('type', { text, policy: o.policy });
    }
    async focusApp(app, o) {
        this.noteActor('focus_app', o ?? {});
        await this.run('focus_app', { app });
        return { appId: exports.FAKE_FOCUSED.appId };
    }
    async focused() {
        this.record('focused', {});
        return { ...exports.FAKE_FOCUSED, appName: 'Finder' };
    }
    abort(o) {
        this.record('abort', o?.actorId ? { actorId: o.actorId } : {});
        if (!o?.actorId) {
            this.fenced = true;
        }
        this.releaseGate?.();
    }
    async clearAbort(o) {
        this.record('clear_abort', o?.actorId ? { actorId: o.actorId } : {});
        if (!o?.actorId) {
            this.fenced = false;
        }
    }
    setTakeoverArmed(armed) {
        this.record('arm_takeover', { armed });
        this.armed = armed;
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
    /** Simulates real user input (the surface fences itself first). */
    fireUserInput(reason = 'hid_input') {
        this.fenced = true;
        for (const l of [...this.inputListeners]) {
            l({ reason, observedAtMs: 1 });
        }
    }
    /** Simulates the executor exiting (and, with `ready`, coming back). */
    fireExecutor(e) {
        for (const l of [...this.executorListeners]) {
            l(e);
        }
    }
    /** The input ops in call order (no describe/capture/fence/arming). */
    inputOps() {
        return this.calls.map((c) => c.op).filter((op) => !META_OPS.has(op));
    }
    /** The args of the first call of `op`. */
    argsOf(op) {
        const c = this.calls.find((x) => x.op === op);
        if (!c) {
            throw new Error(`no ${op} call`);
        }
        return c.args;
    }
    noteActor(op, o) {
        this.actors.push(o?.actor ? { op, actor: { ...o.actor } } : { op });
    }
    record(op, args) {
        this.calls.push({ op, args });
    }
    async run(op, args) {
        this.record(op, args);
        this.hooks[op]?.();
        if (op === this.gateOp) {
            await new Promise((r) => {
                this.releaseGate = r;
            });
            throw new driver_1.ComputerDriverError('USER_TAKEOVER', 'aborted');
        }
        const err = this.failures[op];
        if (err) {
            throw err;
        }
    }
}
exports.FakeComputerDriver = FakeComputerDriver;
/** The window the background fake binds, snapshots and captures. */
exports.FAKE_WINDOW = {
    windowId: 77,
    title: 'Untitled',
    x: 100,
    y: 80,
    widthPoints: 800,
    heightPoints: 600,
    scaleFactor: 2,
};
/** The app the background fake binds. */
exports.FAKE_BOUND = {
    appId: 'com.apple.TextEdit',
    appName: 'TextEdit',
    pid: 42,
};
/**
 * A FakeComputerDriver with the background capability (confinement level 3).
 * Records `bind_app`, `ax_snapshot`, `ax_press`, `ax_set_value`, `ax_select`,
 * `ax_scroll` and `window_screenshot`; `failures` can fail any of them (e.g.
 * STALE_REF).
 */
class FakeBackgroundComputerDriver extends FakeComputerDriver {
    constructor() {
        super(...arguments);
        this.confinement = 3;
        /** Whether it reports per-agent state (ComputerMultiAgentDriver). */
        this.multi = true;
        /** notePreviewTarget calls, in order (not in `calls`: no surface op). */
        this.previewTargets = [];
        /** The text the next snapshots return. */
        this.snapshotText = 's1:e1 AXWindow "Untitled"\n  s1:e2 AXTextArea value=""';
        /** The app element actions report as the element's owner. */
        this.elementAppId = exports.FAKE_BOUND.appId;
        /** The window frame element actions report (undefined: unknown). */
        this.elementWindowBounds = undefined;
        /** The frame element actions report (undefined: the surface doesn't know). */
        this.elementBounds = {
            x: 120,
            y: 200,
            width: 80,
            height: 24,
        };
        this.window = { ...exports.FAKE_WINDOW };
        /** Display names resolveApp knows (bundle ids resolve to themselves). */
        this.appNames = {
            textedit: exports.FAKE_BOUND.appId,
            calculator: 'com.apple.calculator',
        };
    }
    multiAgent() {
        return this.multi;
    }
    async bindApp(app, o) {
        this.noteActor('bind_app', o);
        await this.run('bind_app', { app });
        return { ...exports.FAKE_BOUND };
    }
    notePreviewTarget(appId, o) {
        this.previewTargets.push({
            appId,
            allowedAppIds: [...o.policy.allowedAppIds],
            ...(o.actor ? { actorId: o.actor.id } : {}),
        });
    }
    async axSnapshot(o) {
        const args = {
            appId: o.appId,
            includeMenubar: o.includeMenubar === true,
            policy: o.policy,
        };
        if (o.windowId !== undefined) {
            args.windowId = o.windowId;
        }
        this.noteActor('ax_snapshot', o);
        await this.run('ax_snapshot', args);
        return {
            text: this.snapshotText,
            epoch: 1,
            nodeCount: this.snapshotText.split('\n').length,
            truncated: false,
            targetWindow: { ...this.window },
            appId: this.resolve(o.appId),
        };
    }
    async axPress(ref, o) {
        this.noteActor('ax_press', o);
        await this.run('ax_press', { ref, policy: o.policy });
        return this.target();
    }
    async resolveApp(app) {
        this.record('resolve_app', { app });
        return app.includes('.') ? app : this.appNames[app.toLowerCase()];
    }
    async clickRef(ref, o) {
        this.noteActor('click_ref', o);
        await this.run('click_ref', { ref, policy: o.policy });
        return this.target();
    }
    async axSetValue(ref, text, o) {
        this.noteActor('ax_set_value', o);
        await this.run('ax_set_value', {
            ref,
            text,
            confirm: o.confirm === true,
            policy: o.policy,
        });
        return this.target();
    }
    async axSelect(ref, o) {
        this.noteActor('ax_select', o);
        await this.run('ax_select', { ref, policy: o.policy });
        return this.target();
    }
    async axScroll(ref, delta, o) {
        this.noteActor('ax_scroll', o);
        await this.run('ax_scroll', { ref, ...delta, policy: o.policy });
        return this.target();
    }
    async windowScreenshot(o) {
        const args = {
            appId: o.appId,
            maxLongEdgePx: o.maxLongEdgePx,
            policy: o.policy,
        };
        if (o.windowId !== undefined) {
            args.windowId = o.windowId;
        }
        this.noteActor('window_screenshot', o);
        await this.run('window_screenshot', args);
        return {
            png: exports.FAKE_PNG,
            widthPx: 1600,
            heightPx: 1200,
            targetWindow: { ...this.window },
            appId: this.resolve(o.appId),
        };
    }
    /** What element actions resolve with. */
    target() {
        const t = { appId: this.elementAppId };
        if (this.elementBounds) {
            t.bounds = { ...this.elementBounds };
        }
        if (this.elementWindowBounds) {
            t.windowBounds = { ...this.elementWindowBounds };
        }
        return t;
    }
    /** A bundle id as is; a display name as the bound app's id. */
    resolve(app) {
        return app.includes('.') ? app : exports.FAKE_BOUND.appId;
    }
}
exports.FakeBackgroundComputerDriver = FakeBackgroundComputerDriver;
