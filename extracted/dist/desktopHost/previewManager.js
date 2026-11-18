"use strict";
/**
 * Starts and stops the helper's live preview streams (P3 contract §1) for
 * what the agents work in, while at least one viewer is connected:
 *
 * - window mode: one stream per app an agent worked in (its latest AX /
 *   window op), most recent first;
 * - display mode: at most one, while an agent is in its foreground turn.
 *
 * At most `maxStreams` streams (the `computer.maxPreviewSlots` setting,
 * {@link MAX_PREVIEW_STREAMS} by default, 1..12), each in a fixed video slot,
 * sized by {@link previewBudget} for how many are wanted.
 * Nothing runs without a viewer, while the actuator is paused, or for an
 * agent the user stopped. Every start passes the policy that agent's latest
 * call carried (MacComputerSurfaceDriver.previewTargets); the helper enforces
 * it, the deny list and R3 redaction on every frame.
 *
 * Node-only, no Electron.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreviewManager = exports.PREVIEW_HOLD_FRAMES = exports.PREVIEW_RETRY_MS = exports.CROWDED_LONG_EDGE_PX = exports.PREVIEW_BUDGET_TIERS = exports.MAX_PREVIEW_STREAMS = void 0;
exports.previewBudget = previewBudget;
exports.previewPolicyKey = previewPolicyKey;
const frames_1 = require("./frames");
const protocol_1 = require("./protocol");
/** The default number of streams (and video slots). */
exports.MAX_PREVIEW_STREAMS = protocol_1.DEFAULT_VIDEO_SLOTS;
/**
 * The capture and H.264 budget per stream by how many streams are wanted
 * (K), so the total stays near 4 x 1280 px at 30 fps:
 * K <= 4: 1280 px at 30 fps; K 5..8: 960 px at 24 fps; K 9..12: 640 px at
 * 15 fps.
 */
exports.PREVIEW_BUDGET_TIERS = Object.freeze([
    { maxStreams: 4, longEdgePx: 1280, fps: 30 },
    { maxStreams: 8, longEdgePx: 960, fps: 24 },
    { maxStreams: Infinity, longEdgePx: 640, fps: 15 },
]);
/** The long edge of the 5..8-stream tier (the old "crowded" cap). */
exports.CROWDED_LONG_EDGE_PX = 960;
/** The budget tier for `wanted` streams. */
function previewBudget(wanted) {
    const t = exports.PREVIEW_BUDGET_TIERS.find((x) => wanted <= x.maxStreams) ??
        exports.PREVIEW_BUDGET_TIERS[exports.PREVIEW_BUDGET_TIERS.length - 1];
    return { longEdgePx: t.longEdgePx, fps: t.fps };
}
const START_TIMEOUT_MS = 10000;
const STOP_TIMEOUT_MS = 5000;
/** After a failed start or an ended stream, wait before trying that again. */
exports.PREVIEW_RETRY_MS = 5000;
/**
 * The helper's PreviewGate keeps the first frames of every live period black
 * (kPreviewQueueDepth, Preview.swift): that many redacted frames after a start
 * or a minimized spell read as 'starting', not as a policy verdict.
 */
exports.PREVIEW_HOLD_FRAMES = 3;
/** Sorted, de-duplicated strings of an array (non-strings dropped). */
function sortedStrings(v) {
    if (!Array.isArray(v)) {
        return [];
    }
    return [
        ...new Set(v.filter((x) => typeof x === 'string')),
    ].sort();
}
/**
 * What a stream's policy means, as a stable string: the allowed apps and the
 * page policy's enforce flag and blocked domains, order-free. Volatile per-call
 * fields (the page policy's epoch rises on every call) are left out, so an
 * agent's next call with the same policy keeps its stream; only a real change
 * restarts it. A missing allow list stays distinct from an empty one.
 * Every policy field the helper enforces on frames belongs in this key: a
 * field left out here never restarts a stream when it changes.
 */
function previewPolicyKey(args) {
    const key = {
        allowed: Array.isArray(args['allowed_bundle_ids'])
            ? sortedStrings(args['allowed_bundle_ids'])
            : null,
    };
    const u = args['url_policy'];
    if (u && typeof u === 'object') {
        const up = u;
        key['url'] = {
            enforce: up['enforce'] === true,
            blocked: sortedStrings(up['policy_blocked_domains']),
        };
    }
    return JSON.stringify(key);
}
class PreviewManager {
    constructor(helper, sink, opts = {}) {
        this.helper = helper;
        this.sink = sink;
        /** Local viewers (the Hub's own pane): every agent, display mode too. */
        this.viewers = 0;
        /** Roots with a remote viewer: their agents' windows only (P3-2 R3). */
        this.remoteRoots = new Set();
        this.targets = [];
        this.agents = new Map();
        /** The actuator is paused (a takeover, or Stop until the lease ends). */
        this.paused = false;
        /** The user pressed Stop (HUD / viewer Stop all): nothing streams. */
        this.userStopped = false;
        this.stopped = false;
        /** The helper rejected preview_user_control (an older helper). */
        this.noUserControlOp = false;
        /** The helper lacks preview_configure (an older helper). */
        this.noConfigureOp = false;
        /** By stream key. */
        this.streams = new Map();
        /** The policy each stream was started with, by stream key. */
        this.policies = new Map();
        /**
         * Stream id -> redacted frames still read as the helper's initial hold
         * (set on start and after a minimized spell, cleared by a live frame).
         */
        this.holdLeft = new Map();
        /** Stream key -> host time before which it is not started again. */
        this.retryAfter = new Map();
        /** Streams already dropped from `streams` whose helper stop is queued. */
        this.pendingStops = [];
        this.running = Promise.resolve();
        this.dirty = false;
        this.maxFps = opts.maxFps ?? 30;
        this.maxLongEdgePx = opts.maxLongEdgePx ?? 1280;
        this.maxStreams = (0, protocol_1.clampVideoSlots)(opts.maxStreams ?? exports.MAX_PREVIEW_STREAMS);
        this.log = opts.log ?? (() => { });
        this.now = opts.now ?? (() => Date.now());
        helper.onFrame?.((r) => this.onFrame(r));
        helper.onEvent?.('preview_state', (m) => this.onState(m));
        helper.onExit?.(() => {
            // The next helper may be another build: probe it again.
            this.configureProbe = undefined;
            this.noConfigureOp = false;
            // The helper's streams died with it; start over after its restart.
            if (this.streams.size) {
                this.streams.clear();
                this.policies.clear();
                this.emitStreams();
            }
            this.schedule();
        });
    }
    /** The number of connected local viewers. */
    setViewers(n) {
        this.setDemand(n, [...this.remoteRoots]);
    }
    /**
     * Who is watching: local viewers see every agent (and the display during a
     * foreground turn); remote viewers only their roots' agents' windows.
     * Nobody watching stops every stream.
     */
    setDemand(localViewers, remoteRoots) {
        this.viewers = Math.max(0, localViewers);
        this.remoteRoots = new Set(remoteRoots.filter((r) => !!r));
        this.prune();
        this.schedule();
    }
    /**
     * What the agents work in (most recent first) and who they are. `paused`
     * (a takeover) keeps the streams with the user in control; `userStopped`
     * (the user's Stop) ends them.
     */
    update(targets, agents, paused, userStopped = false) {
        this.targets = [...targets];
        this.agents = new Map(agents.map((a) => [a.actorId, a]));
        this.paused = paused;
        this.userStopped = userStopped;
        this.prune();
        this.applyUserControl();
        this.schedule();
    }
    /** Asks every live stream for an IDR (a viewer or slot just started). */
    requestKeyframes() {
        for (const s of this.streams.values()) {
            if (s.streamId) {
                void this.helper.call('preview_keyframe', { stream_id: s.streamId }, STOP_TIMEOUT_MS);
            }
        }
    }
    /** Asks one running stream for an IDR (a viewer's tile remounted). */
    requestKeyframe(streamId) {
        if (this.byStreamId(streamId)) {
            void this.helper.call('preview_keyframe', { stream_id: streamId }, STOP_TIMEOUT_MS);
        }
    }
    current() {
        return [...this.streams.values()].sort((a, b) => a.slot - b.slot);
    }
    /** Stops every stream; the manager is unusable afterwards. */
    async stop() {
        this.stopped = true;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
        this.prune();
        await this.running;
        const stops = this.pendingStops;
        this.pendingStops = [];
        for (const id of stops) {
            await this.helper.call('preview_stop', { stream_id: id }, STOP_TIMEOUT_MS);
        }
        await this.stopAll();
    }
    /** What should run now. */
    desired() {
        if (this.stopped ||
            this.userStopped ||
            (this.viewers === 0 && this.remoteRoots.size === 0)) {
            return [];
        }
        const out = [];
        const seen = new Set();
        for (const t of this.targets) {
            const agent = t.actorId ? this.agents.get(t.actorId) : undefined;
            // Only named agents of the current lease that the user did not stop
            // (P3-SEC-PV-3: never a stream without an actor); one the user took
            // over keeps its stream.
            if (!agent || (agent.stopped && !agent.userControl)) {
                continue;
            }
            if (t.mode === 'display' && agent.mode !== 'foreground') {
                continue;
            }
            // Without a local viewer, only remote roots' windows (never display).
            if (this.viewers === 0 &&
                (t.mode !== 'window' || !this.remoteRoots.has(agent.root ?? ''))) {
                continue;
            }
            const key = t.mode === 'display' ? 'display' : `window:${t.appId}`;
            if (seen.has(key)) {
                continue; // the most recent agent in that app wins
            }
            seen.add(key);
            out.push({ key, target: t, policyJson: previewPolicyKey(t.policyArgs) });
            if (out.length >= this.maxStreams) {
                break;
            }
        }
        return out;
    }
    /**
     * Drops streams that are no longer wanted (or wanted with another policy)
     * at once, so none of their frames is forwarded from now on; only the
     * helper's preview_stop waits for the serialized reconcile.
     */
    prune() {
        const wanted = new Map(this.desired().map((d) => [d.key, d]));
        let changed = false;
        for (const [key, s] of [...this.streams]) {
            if (this.outdated(s, wanted.get(key))) {
                this.streams.delete(key);
                this.policies.delete(key);
                this.pendingStops.push(s.streamId);
                changed = true;
            }
        }
        if (changed) {
            this.emitStreams();
        }
    }
    /**
     * Whether a running stream no longer matches what is wanted for its key:
     * not wanted, another policy, or another agent (the most recent agent in
     * an app wins, and a stream is bound to its agent's fence, user control
     * and root).
     */
    outdated(s, d) {
        return (!d ||
            d.policyJson !== this.policies.get(s.key) ||
            d.target.actorId !== s.actorId ||
            this.rootOf(d.target.actorId) !== s.root);
    }
    /** The root conversation of an agent ('' if unknown). */
    rootOf(actorId) {
        return this.agents.get(actorId)?.root ?? '';
    }
    schedule() {
        // After stop(), late callbacks (helper exit, retry timer) do nothing.
        if (this.dirty || this.stopped) {
            return;
        }
        this.dirty = true;
        this.running = this.running.then(async () => {
            this.dirty = false;
            try {
                await this.reconcile();
            }
            catch (err) {
                this.log(`[DesktopHost] preview reconcile failed: ${String(err)}`);
            }
        });
    }
    async reconcile() {
        const stops = this.pendingStops;
        this.pendingStops = [];
        for (const id of stops) {
            await this.helper.call('preview_stop', { stream_id: id }, STOP_TIMEOUT_MS);
        }
        const want = this.desired();
        const wanted = new Map(want.map((d) => [d.key, d]));
        // Stop what is no longer wanted, or was started with another policy or
        // for another agent.
        for (const [key, s] of [...this.streams]) {
            if (this.outdated(s, wanted.get(key))) {
                await this.stopStream(s);
            }
        }
        // The agent moved to another window of the same app: retarget in place
        // (same stream id and slot), never stop + start.
        for (const d of want) {
            const s = this.streams.get(d.key);
            const wid = d.target.windowId ?? 0;
            if (s && s.mode === 'window' && wid && wid !== s.targetWindowId) {
                await this.retargetStream(s, wid);
            }
        }
        // A tier step down (more streams) applies before the new starts, so the
        // encoders never run over budget meanwhile; a step up after them (rt
        // #2070 P3-8).
        const tierNow = this.budgetFor(this.streams.size);
        const tierNext = this.budgetFor(want.length);
        if (tierNext.longEdgePx < tierNow.longEdgePx ||
            tierNext.fps < tierNow.fps) {
            await this.rebudget(want.length);
        }
        const now = this.now();
        let nextRetry = Infinity;
        for (const d of want) {
            if (this.streams.has(d.key)) {
                continue;
            }
            const until = this.retryAfter.get(d.key) ?? 0;
            if (until > now) {
                nextRetry = Math.min(nextRetry, until);
                continue;
            }
            const slot = this.freeSlot();
            if (slot < 0) {
                break;
            }
            await this.startStream(d, slot, this.budgetFor(want.length));
        }
        // The tier follows how many are wanted (4 <-> 5, 8 <-> 9).
        await this.rebudget(want.length);
        if (nextRetry < Infinity && !this.retryTimer && !this.stopped) {
            this.retryTimer = setTimeout(() => {
                this.retryTimer = undefined;
                this.schedule();
            }, Math.max(0, nextRetry - now));
        }
    }
    /** The budget for `wanted` streams, within the host's caps. */
    budgetFor(wanted) {
        const b = previewBudget(wanted);
        return {
            fps: Math.min(b.fps, this.maxFps),
            longEdgePx: Math.min(b.longEdgePx, this.maxLongEdgePx),
        };
    }
    /**
     * Moves the running streams to the budget for `wanted` streams in place
     * (same stream id and slot) when the tier changed; an older helper without
     * preview_configure keeps the budget each stream started with.
     */
    async rebudget(wanted) {
        const b = this.budgetFor(wanted);
        const stale = [...this.streams.values()].filter((s) => s.budget?.fps !== b.fps || s.budget?.longEdgePx !== b.longEdgePx);
        if (stale.length === 0 || this.noConfigureOp) {
            return;
        }
        // Feature-detect from the probe (an older helper would queue the unknown
        // op behind its foreground work, rt #2070 P3-9).
        const supported = this.helper.probe
            ? await this.configureSupported()
            : true;
        if (supported === undefined) {
            return;
        }
        if (!supported) {
            this.noConfigureOp = true;
            this.log('[DesktopHost] the helper has no preview_configure: streams keep their start budget');
            return;
        }
        for (const s of stale) {
            if (this.noConfigureOp) {
                return;
            }
            const cur = s.budget;
            if (cur && cur.fps === b.fps && cur.longEdgePx === b.longEdgePx) {
                continue;
            }
            // Asked once per tier change, whatever the reply.
            s.budget = { ...b };
            const r = await this.helper.call('preview_configure', { stream_id: s.streamId, max_fps: b.fps, max_long_edge_px: b.longEdgePx }, STOP_TIMEOUT_MS);
            if (!r.ok && /unknown op|unsupported|no such op/i.test(r.error ?? '')) {
                this.noConfigureOp = true;
                this.log(`[DesktopHost] preview_configure refused (${r.error ?? ''}): streams keep their start budget`);
            }
            else if (!r.ok && this.streams.get(s.key) === s) {
                this.log(`[DesktopHost] preview_configure ${s.key} refused: ${r.error_code ?? ''} ${r.error ?? ''}`);
            }
        }
    }
    /** Whether the helper has preview_configure; undefined if it couldn't say. */
    async configureSupported() {
        this.configureProbe ?? (this.configureProbe = this.helper.probe().then((p) => p['preview_configure'] === true));
        try {
            return await this.configureProbe;
        }
        catch {
            // A failed probe isn't a verdict: ask again on the next tier change.
            this.configureProbe = undefined;
            return undefined;
        }
    }
    freeSlot() {
        const used = new Set([...this.streams.values()].map((s) => s.slot));
        for (let i = 0; i < this.maxStreams; i++) {
            if (!used.has(i)) {
                return i;
            }
        }
        return -1;
    }
    async startStream(d, slot, budget) {
        const t = d.target;
        const args = {
            mode: t.mode,
            max_fps: budget.fps,
            max_long_edge_px: budget.longEdgePx,
            actor: { id: t.actorId },
            ...t.policyArgs,
        };
        if (t.mode === 'window') {
            args['app'] = t.appId;
            if (t.windowId) {
                args['window_id'] = t.windowId;
            }
        }
        let r = await this.helper.call('preview_start', args, START_TIMEOUT_MS);
        if (!r.ok && args['window_id'] !== undefined) {
            if (/window_app_mismatch/.test(r.error ?? '')) {
                // The helper says that window is another app's: the host's window
                // tracking is wrong (it must never cross agents or apps).
                this.log(`[DesktopHost] BUG preview_start ${d.key} window_id ${String(args['window_id'])} is not a window of that app: ${r.error ?? ''}`);
            }
            // That window is gone (closed since the agent's call): the app's.
            delete args['window_id'];
            r = await this.helper.call('preview_start', args, START_TIMEOUT_MS);
        }
        if (!r.ok || typeof r['stream_id'] !== 'string' || !r['stream_id']) {
            this.retryAfter.set(d.key, this.now() + exports.PREVIEW_RETRY_MS);
            this.log(`[DesktopHost] preview_start ${d.key} refused: ${r.error_code ?? ''} ${r.error ?? ''}`);
            return;
        }
        const s = {
            key: d.key,
            streamId: r['stream_id'],
            slot,
            mode: t.mode,
            appId: t.appId,
            bundleId: typeof r['bundle_id'] === 'string' ? r['bundle_id'] : t.appId,
            actorId: t.actorId,
            root: this.rootOf(t.actorId),
            // Not 'live' before a frame says so: the helper's gate holds the first
            // frames black (PREVIEW_HOLD_FRAMES), and a static window may send none.
            state: r['minimized'] === true ? 'minimized' : 'redacted',
            targetWindowId: t.mode === 'window' ? (t.windowId ?? 0) : 0,
            budget: { ...budget },
        };
        if (s.state === 'redacted') {
            s.redactReason = protocol_1.REDACT_STARTING;
        }
        const w = (0, frames_1.frameWindowOf)(r['window']);
        if (w) {
            s.window = w;
        }
        const still = this.desired().find((x) => x.key === d.key);
        if (this.stopped ||
            !still ||
            still.policyJson !== d.policyJson ||
            still.target.actorId !== t.actorId ||
            this.rootOf(t.actorId) !== s.root) {
            // Things changed while it started.
            await this.helper.call('preview_stop', { stream_id: s.streamId }, STOP_TIMEOUT_MS);
            this.schedule();
            return;
        }
        this.streams.set(d.key, s);
        this.policies.set(d.key, d.policyJson);
        this.holdLeft.set(s.streamId, exports.PREVIEW_HOLD_FRAMES);
        this.applyUserControl();
        this.emitStreams();
        // Its first IDR may have arrived before it was registered (and been
        // dropped): ask for another rather than wait for the 2 s cadence.
        void this.helper.call('preview_keyframe', { stream_id: s.streamId }, STOP_TIMEOUT_MS);
    }
    /** Whether the user is in control of a stream's agent now. */
    userControlOf(s) {
        if (this.userStopped || this.stopped) {
            return false; // its streams are about to stop: never lift the fence
        }
        return this.paused || this.agents.get(s.actorId)?.userControl === true;
    }
    /**
     * Marks each stream with whether the user is in control, and tells the
     * helper to keep capturing it through the takeover / agent-stop fence
     * (preview_user_control; without it the helper freezes its frames).
     */
    applyUserControl() {
        let changed = false;
        for (const s of this.streams.values()) {
            const gated = this.paused ||
                this.userStopped ||
                this.stopped ||
                this.agents.get(s.actorId)?.userControl === true;
            if ((s.remoteGated ?? false) !== gated) {
                changed = true;
                if (gated) {
                    s.remoteGated = true;
                }
                else {
                    delete s.remoteGated;
                }
            }
            const on = this.userControlOf(s);
            if ((s.userControl ?? false) === on) {
                continue;
            }
            changed = true;
            if (on) {
                s.userControl = true;
            }
            else {
                delete s.userControl;
            }
            if (this.noUserControlOp) {
                continue;
            }
            void this.helper
                .call('preview_user_control', { stream_id: s.streamId, on }, STOP_TIMEOUT_MS)
                .then((r) => {
                if (r.ok && !on) {
                    // Remote viewers resume at an IDR.
                    void this.helper.call('preview_keyframe', { stream_id: s.streamId }, STOP_TIMEOUT_MS);
                }
                if (!r.ok && !this.noUserControlOp) {
                    this.noUserControlOp = true;
                    this.log(`[DesktopHost] preview_user_control refused (${r.error ?? ''}): frames freeze while the user is in control`);
                }
            });
        }
        if (changed) {
            this.emitStreams();
        }
    }
    async retargetStream(s, windowId) {
        // Asked once per target change, whatever the reply (no retry storm).
        s.targetWindowId = windowId;
        // The old window's bounds no longer describe what the stream shows.
        delete s.window;
        const r = await this.helper.call('preview_retarget', { stream_id: s.streamId, window_id: windowId }, START_TIMEOUT_MS);
        if (this.streams.get(s.key) !== s) {
            return; // stopped meanwhile
        }
        if (!r.ok) {
            const bug = /window_app_mismatch/.test(r.error ?? '') ? 'BUG ' : '';
            this.log(`[DesktopHost] ${bug}preview_retarget ${s.key} refused: ${r.error_code ?? ''} ${r.error ?? ''}`);
            return;
        }
        // The helper resets user control on a retarget (P3-SEC-UC-1): turn it
        // back on if the user is still in control.
        if (s.userControl && !this.noUserControlOp) {
            void this.helper.call('preview_user_control', { stream_id: s.streamId, on: true }, STOP_TIMEOUT_MS);
        }
        // The helper's gate starts over on the new window.
        this.holdLeft.set(s.streamId, exports.PREVIEW_HOLD_FRAMES);
        s.state = r['minimized'] === true ? 'minimized' : 'redacted';
        if (s.state === 'redacted') {
            s.redactReason = protocol_1.REDACT_STARTING;
        }
        else {
            delete s.redactReason;
        }
        // The new window's bounds, as on a start (until its first frame record).
        const w = (0, frames_1.frameWindowOf)(r['window']);
        if (w) {
            s.window = w;
        }
        this.emitStreams();
        void this.helper.call('preview_keyframe', { stream_id: s.streamId }, STOP_TIMEOUT_MS);
    }
    async stopStream(s) {
        this.streams.delete(s.key);
        this.policies.delete(s.key);
        this.emitStreams();
        await this.helper.call('preview_stop', { stream_id: s.streamId }, STOP_TIMEOUT_MS);
    }
    async stopAll() {
        for (const s of [...this.streams.values()]) {
            await this.stopStream(s);
        }
    }
    byStreamId(id) {
        for (const s of this.streams.values()) {
            if (s.streamId === id) {
                return s;
            }
        }
        return undefined;
    }
    onFrame(r) {
        const s = this.byStreamId(r.streamId);
        if (!s) {
            return; // stopped, or not ours
        }
        let state = 'redacted';
        let reason;
        if (r.minimized) {
            state = 'minimized';
            this.holdLeft.set(s.streamId, exports.PREVIEW_HOLD_FRAMES);
        }
        else if (!r.redacted) {
            state = 'live';
            this.holdLeft.delete(s.streamId);
        }
        else if (r.redactReason === protocol_1.REDACT_STARTING ||
            r.redactReason === 'hold') {
            reason = protocol_1.REDACT_STARTING;
        }
        else if (r.redactReason) {
            reason = r.redactReason;
            this.holdLeft.delete(s.streamId);
        }
        else {
            // A helper without redact_reason: the first frames of a live period
            // are its gate's hold; black after that is a verdict.
            const left = this.holdLeft.get(s.streamId) ?? 0;
            if (left > 0 && r.payload.length > 0) {
                this.holdLeft.set(s.streamId, left - 1);
            }
            reason = left > 0 ? protocol_1.REDACT_STARTING : protocol_1.REDACT_POLICY;
        }
        let changed = state !== s.state || reason !== s.redactReason;
        s.state = state;
        if (reason) {
            s.redactReason = reason;
        }
        else {
            delete s.redactReason;
        }
        if (r.window) {
            changed =
                changed || JSON.stringify(r.window) !== JSON.stringify(s.window);
            s.window = r.window;
        }
        if (changed) {
            this.emitStreams();
        }
        this.sink.onFrame(s, r);
    }
    onState(m) {
        const s = this.byStreamId(m['stream_id']);
        if (!s) {
            return;
        }
        const state = m['state'];
        if (state === 'ended') {
            this.log(`[DesktopHost] preview ${s.key} ended: ${String(m['reason'] ?? '')}`);
            this.streams.delete(s.key);
            this.policies.delete(s.key);
            this.retryAfter.set(s.key, this.now() + exports.PREVIEW_RETRY_MS);
            this.emitStreams();
            this.schedule();
            return;
        }
        if (state === 'live' || state === 'minimized' || state === 'redacted') {
            // The gate's hold reports 'redacted' too: the frames name the reason.
            if (state === 'minimized') {
                this.holdLeft.set(s.streamId, exports.PREVIEW_HOLD_FRAMES);
            }
            if (s.state !== state) {
                s.state = state;
                if (state === 'redacted') {
                    s.redactReason =
                        (this.holdLeft.get(s.streamId) ?? 0) > 0
                            ? protocol_1.REDACT_STARTING
                            : (s.redactReason ?? protocol_1.REDACT_POLICY);
                }
                else {
                    delete s.redactReason;
                }
                this.emitStreams();
            }
        }
    }
    emitStreams() {
        const live = new Set([...this.streams.values()].map((x) => x.streamId));
        for (const id of [...this.holdLeft.keys()]) {
            if (!live.has(id)) {
                this.holdLeft.delete(id);
            }
        }
        try {
            this.sink.onStreams(this.current());
        }
        catch (err) {
            this.log(`[DesktopHost] preview sink failed: ${String(err)}`);
        }
    }
}
exports.PreviewManager = PreviewManager;
