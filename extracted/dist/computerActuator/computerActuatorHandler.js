"use strict";
/**
 * @fileoverview The computer action layer's (Layer 2) actuator handler: serves
 * actuator_type "computer" on a Layer 1 ActuatorClient by driving a Layer 3
 * ComputerSurfaceDriver. It owns the wire (computerpb, actuator_pb): the Hello
 * from the surface's description, each ComputerRequest run through the driver
 * (geometry fence, pause and abandonment checks between actions, fail-closed
 * confinement, the page policy, PNG blob), takeover / Stop / Resume status,
 * health, and the lease state a host shows (e.g. a HUD).
 *
 * Platform-free: no DOM, React, Electron or Node built-ins (deps_test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComputerActuatorHandler = void 0;
exports.hintedPlacement = hintedPlacement;
const protobuf_1 = require("@bufbuild/protobuf"); // from //third_party/javascript/bufbuild_protobuf
const actuator_pb_1 = require("../proto/actuator_pb"); // from //third_party/jetski/actuator_pb:actuator_ts_proto
const computer_payload_pb_1 = require("../proto/computer_payload_pb"); // from //third_party/jetski/cortex/ext/plugins/computer/computerpb:computer_payload_ts_proto
const scriptMediator_1 = require("./scriptMediator");
const computerOps_1 = require("./computerOps");
const driver_1 = require("./driver");
/** An action on an element of an app's tree (refs from ax_snapshot). */
function isElementCall(call) {
    return (call.kind === 'axPress' ||
        call.kind === 'axSetValue' ||
        call.kind === 'axSelect' ||
        call.kind === 'axScroll');
}
/**
 * The app a failed element action's ref belongs to, for the snapshot after
 * it: the app of the batch's snapshot that minted the ref (refs are
 * `s<epoch>:e<N>`, namespaced per agent on a multi-agent surface, e.g.
 * `a3.s12:e5`), else the only allowed app, else '' (no snapshot beats one of
 * the wrong app, whose refs the LS would attribute to this action's app).
 */
function appOfRef(ref, snapApps, allowed) {
    const m = /^(?:[A-Za-z0-9_-]+\.)?s(\d+):e\d+$/.exec(ref);
    const app = m ? snapApps.get(Number(m[1])) : undefined;
    if (app) {
        return app;
    }
    return allowed.size === 1 ? [...allowed][0] : '';
}
/** The LS's cap on a script screenshot's app_id (UTF-8 bytes). */
const MAX_SCRIPT_SHOT_APP_ID_BYTES = 255;
/**
 * Whether `entry` was handed back again while its fence lift ran (read
 * after an await, where the state may have changed since it was set).
 */
function handBackRestarted(entry) {
    return entry.state === 'restart';
}
/** Script fences that show nothing of the desktop afterwards (P0-3). */
const SCRIPT_NO_FRAME = new Set([
    'USER_STOP',
    'USER_TAKEOVER',
    'AGENT_PAUSED',
    'AGENT_STOPPED',
    'SCREEN_LOCKED',
    'URL_POLICY_BLOCKED',
    'URL_UNREADABLE',
    'TCC_REVOKED',
]);
const SCRIPT_TIMEOUT_MS = 30000;
const MAX_SCRIPT_TIMEOUT_MS = 120000;
/** How often a running script checks for a pause, a stop or abandonment. */
const SCRIPT_FENCE_POLL_MS = 50;
/**
 * How long a script's end waits, under the agent's helper fence, for the
 * call it cut short to return before the result goes out without it.
 */
const SCRIPT_DRAIN_MS = 3000;
/** How long a script reuses the surface description (rt P3-2). */
const SCRIPT_DESCRIBE_TTL_MS = 5000;
/**
 * What a script's end needs before the LS deadline (rt #1915 P2-3): the
 * drain, the final frame and the AX snapshot, so the result (and its
 * ledger) always arrives while the LS still waits for it.
 */
const SCRIPT_END_RESERVE_MS = 12000;
/** Below this much time before the deadline, no final AX snapshot. */
const SCRIPT_SNAPSHOT_MIN_MS = 6000;
/** Below this much time before the deadline, no final frame either. */
const SCRIPT_FRAME_MIN_MS = 3000;
/** The LS's Fulfill cap when its SubscribeAck had none (actuatorserver). */
const MAX_FULFILL_FALLBACK_BYTES = 24 << 20;
const STALE_ECHO_MS = 3000;
const MAX_STOPPED_AGENTS = 64;
/** Agents whose cascade id is remembered for scoped pause reports. */
const MAX_KNOWN_CASCADES = 256;
/** The app name a per-agent pause report carries (LS model text). */
const MAX_PAUSE_DETAIL_BYTES = 64;
const MAX_APP_NAME_BYTES = 128;
function sleepReal(ms) {
    return new Promise((r) => {
        setTimeout(r, ms);
    });
}
/**
 * Serves actuator_type "computer". Register with {@link register}; the host
 * forwards the user's Stop / Resume ({@link userStop}, {@link userResume}),
 * health changes ({@link reportHealth}) and re-advertisements
 * ({@link refreshHello}).
 */
class ComputerActuatorHandler {
    /** Some agent is in foreground mode (takeover detection may be armed). */
    get foregroundMode() {
        return this.foregroundActors.size > 0;
    }
    constructor(opts) {
        this.opts = opts;
        this.actuatorType = computerOps_1.COMPUTER_ACTUATOR_TYPE;
        this.actuatorTypeVersion = computerOps_1.COMPUTER_ACTUATOR_TYPE_VERSION;
        this.schemas = {
            hello: computer_payload_pb_1.ComputerHelloSchema,
            request: computer_payload_pb_1.ComputerRequestSchema,
            result: computer_payload_pb_1.ComputerResultSchema,
        };
        this.unsubscribers = [];
        this.reg = null;
        /**
         * Per agent (actor id), on any surface: the chain of its runs and the
         * running one. On a single-agent surface a run also waits for every other
         * agent's chain (see onRequest), so one queue per agent never lets a run
         * skip its own agent's unwinding run when multiAgent() changes.
         */
        this.queues = new Map();
        this.currents = new Map();
        this.execSeq = 0;
        this.runs = new Map();
        /**
         * The surface runs agents concurrently (ComputerMultiAgentDriver), so each
         * agent gets its own queue, supersede and fence, and the Hello says
         * concurrent_agents. Read at every (re)advertisement and when a restarted
         * executor comes back (its multiAgent() may have changed), so fences and
         * queues follow the surface as it is now.
         */
        this.multi = false;
        this.lastLocalResumeAt = 0;
        /** A local Resume not yet seen by the LS (it is replayed after the ack). */
        this.pendingResume = false;
        this.lastAdvert = '';
        this.lastHealth = '';
        /** Bumped by every executor exit; a probe older than it is stale. */
        this.healthEpoch = 0;
        /**
         * Bumped whenever `multi` / `lastAdvert` are set from a fresh read (a
         * restarted executor, a (re)subscribe Hello): a refresh that started before
         * must not record its older advertisement over them.
         */
        this.advertEpoch = 0;
        this.enabled = true;
        /** We called unsubscribe() and have not resubscribed since. */
        this.unsubscribed = false;
        /** The disable (unsubscribe) in progress; re-enable only after it. */
        this.unsubscribing = Promise.resolve();
        /**
         * The latest status report. The SDK sends live reports in order, so once
         * this settles every earlier report has too.
         */
        this.lastReport = Promise.resolve();
        /** True while the SDK stream is subscribed. */
        this.connected = false;
        /** Locally paused by takeover / Stop until the user presses Resume. */
        this.paused = false;
        /** Some agent holds the lease (LeaseStatus.agent_active, per owner). */
        this.agentActive = false;
        this.lastLeaseStatus = null;
        /** LeaseStatus.agent_active per owner (subagent cascade; '' = unnamed). */
        this.ownersActive = new Map();
        /**
         * Agents in foreground mode. Sticky per agent: set by its batch with a
         * foreground action, cleared by its background-only batch, its lease
         * ending or a pause. Takeover detection is armed only while some agent is
         * in foreground mode (background work leaves the user's input alone, so
         * the user's typing is no takeover).
         */
        this.foregroundActors = new Set();
        /**
         * Agents the user stopped: their batches answer AGENT_STOPPED until
         * resumeAgent, also after their lease ended (defense in depth: a stopped
         * agent that simply calls again gets a new lease from the LS). At most
         * MAX_STOPPED_AGENTS, oldest dropped first.
         */
        this.stoppedActors = new Set();
        /**
         * Agents the user took over (per-agent pause), by actor id, with the scope
         * their pause was reported under (their cascade id; '' if unknown, then it
         * is local only). Their batches answer AGENT_PAUSED until resumeAgent; a
         * stop wins. At most MAX_STOPPED_AGENTS.
         */
        this.pausedActors = new Map();
        /** The cascade id each agent came with (actorOf uses it as the id). */
        this.cascadeOf = new Map();
        /** Why `paused` is set (meaningful only while paused). */
        this.pauseOrigin = 'user_takeover';
        /**
         * The run whose batch has input actions (foreground actions other than
         * SCREENSHOT, like the LS's needsPointer in scope.go) owns the pointer and
         * keyboard (claimed in execute, released when it returns). Defense in depth
         * on top of the LS's pointer lock: two agents' input never interleaves even
         * if that lock lapses. Claimed on any surface: a run started on a
         * single-agent surface still holds it after a restarted executor turned
         * multi-agent. A display capture alone takes no pointer (the LS runs it
         * beside another agent's input).
         */
        /** Running scripts: their kill switch and run (rt P2-1). */
        this.scriptRuns = new Map();
        /** The LS's per-Fulfill byte cap (SubscribeAck limits; 0 = unknown). */
        this.maxFulfillBytes = 0;
        /** The app the agent last worked in, for the host's state. */
        this.appName = '';
        /** The agents of this lease, by actor id (insertion order = first seen). */
        this.agents = new Map();
        /** Bound apps' display names by bundle id (an agent's row shows these). */
        this.appNames = new Map();
        /**
         * The hand backs ({@link resumeAgent}) in progress, by actor id: one per
         * agent, which a takeover cancels and a later hand back restarts.
         */
        this.handBacks = new Map();
        /**
         * Taken-over agents whose lease ended: their row stays for the hand back
         * and goes once they are handed back or stopped.
         */
        this.leaseEndedWhilePaused = new Set();
        /**
         * Why we are paused: the user's Stop (results say USER_STOP) or anything
         * else (USER_TAKEOVER, also for a restored pause of unknown cause). Always
         * the status reported to the LS for this pause.
         */
        this.pauseCause = actuator_pb_1.ActuatorStatus.USER_TAKEOVER;
        this.driver = opts.driver;
        this.actuatorId = opts.driver.surfaceId;
        this.paused = opts.initialPaused ?? false;
        if (this.paused) {
            // The user's Stop, persisted by the host (reported as USER_STOP).
            this.pauseCause = actuator_pb_1.ActuatorStatus.USER_STOP;
            this.pauseOrigin = 'user_stop';
        }
        this.log =
            opts.log ??
                ((m) => {
                    console.log(m);
                });
        this.sleep = opts.sleep ?? sleepReal;
        this.now = opts.now ?? (() => Date.now());
        this.unsubscribers.push(this.driver.onUserInput((ev) => this.onUserInput(ev)));
        const off = this.driver.onExecutorEvent?.((ev) => {
            this.onExecutorEvent(ev);
        });
        if (off) {
            this.unsubscribers.push(off);
        }
        if (this.paused) {
            this.driver.abort();
        }
    }
    /** Registers with the client (call before `client.start()`). */
    register(client) {
        this.reg = client.register(this);
        if (this.paused) {
            // A persisted pause goes into the first Subscribe's initial_pauses.
            void this.report({
                status: actuator_pb_1.ActuatorStatus.USER_STOP,
                detail: 'paused at start',
            });
        }
        this.pushState();
        this.log(`[ComputerActuator] registered as ${this.actuatorId}${this.paused ? ' (paused)' : ''}`);
        return this.reg;
    }
    /**
     * Abandons runs, unsubscribes (GOING_AWAY) and drops the listeners. Resolves
     * once the running request has settled, so nothing reaches the driver or
     * the host after it.
     */
    async dispose() {
        this.abandonAll('disposed');
        this.agentActive = false;
        this.syncArm();
        for (const off of this.unsubscribers.splice(0)) {
            off();
        }
        // Detach before awaiting the unsubscribe: a refresh or a pending
        // setEnabled(true) that resumes meanwhile finds no registration.
        this.enabled = false;
        this.connected = false;
        const reg = this.reg;
        this.reg = null;
        await reg?.unsubscribe();
        // The abandoned runs stop their primitives and fulfill (ABANDONED);
        // their last syncArm/pushState runs before dispose resolves.
        await Promise.all([...this.queues.values()]);
    }
    /**
     * Turns the actuator off (unsubscribe = GOING_AWAY, e.g. a kill switch) or
     * back on (resubscribe revives the registration with its pauses).
     */
    async setEnabled(on) {
        if (!this.reg || on === this.enabled) {
            return;
        }
        this.enabled = on;
        if (!on) {
            this.log('[ComputerActuator] disabled; unsubscribing (GOING_AWAY)');
            this.abandonAll('disabled');
            this.connected = false;
            this.agentActive = false;
            this.ownersActive.clear();
            this.foregroundActors.clear();
            this.forgetAgentRows();
            this.syncArm();
            this.pushState();
            if (!this.unsubscribed) {
                this.unsubscribed = true;
                this.unsubscribing = this.reg.unsubscribe();
            }
            await this.unsubscribing;
            return;
        }
        this.log('[ComputerActuator] enabled; resubscribing');
        await this.unsubscribing;
        if (!this.enabled || !this.unsubscribed || !this.reg) {
            return; // disabled or disposed meanwhile, or already resubscribed
        }
        this.unsubscribed = false;
        this.reg.resubscribe();
    }
    // ---- ActuatorHandler ----
    async hello() {
        // Taken before describe(): an executor exit while it runs wins.
        const epoch = this.healthEpoch;
        const info = await this.driver.describe();
        const level = this.level(info);
        this.multi = (0, driver_1.supportsMultiAgent)(this.driver);
        this.lastAdvert = this.advert(info, level, this.multi);
        this.advertEpoch++;
        const health = this.currentHealth(info);
        // The SDK's initial_status is the last health sent through reportStatus()
        // if there is one (it wins over the Hello's). If that differs from the
        // live health (e.g. a stale EXECUTOR_CRASHED), report the live health
        // first; reports are queued in order, so it is the SDK's latest when the
        // Subscribe is built.
        const key = (0, computerOps_1.healthKey)(health);
        if (epoch === this.healthEpoch &&
            this.lastHealth !== '' &&
            this.lastHealth !== key) {
            this.log(`[ComputerActuator] health ${key} at (re)subscribe (was ${this.lastHealth})`);
            await this.report((0, computerOps_1.toStatusReport)(health));
        }
        if (epoch === this.healthEpoch) {
            this.lastHealth = key; // else the executor exited meanwhile
        }
        // Computer actuators are routed by lease pin; they serve no conversations.
        const hello = (0, computerOps_1.buildHello)(info, level, this.multi);
        hello.supportsScript = this.scriptAvailable();
        return {
            hello,
            conversationIds: [],
            initialStatus: (0, computerOps_1.toStatusReport)(health),
        };
    }
    onSubscribed(ack) {
        this.connected = true;
        this.maxFulfillBytes = ack?.limits?.maxFulfillBytes ?? 0;
        // Computer takeover is actuator-wide: the fence is the empty scope.
        const corePaused = (ack?.activePauses ?? []).some((p) => !p.rootConversationId &&
            (p.status === actuator_pb_1.ActuatorStatus.USER_TAKEOVER ||
                p.status === actuator_pb_1.ActuatorStatus.USER_STOP));
        this.log(`[ComputerActuator] subscribed${corePaused ? ' (LS fence active)' : ''}`);
        if (corePaused) {
            if (this.pendingResume && !this.paused) {
                // The user resumed while we were disconnected; that USER_RESUME is
                // replayed right after this ack, so don't re-pause on the stale fence.
                this.pendingResume = false;
                this.pushState();
                return;
            }
            // The LS still fences this actuator (e.g. after a host restart):
            // restore the paused state so the user can Resume.
            if (!this.paused) {
                const stopped = (ack?.activePauses ?? []).every((p) => p.rootConversationId || p.status !== actuator_pb_1.ActuatorStatus.USER_TAKEOVER);
                this.setPaused(true, stopped ? actuator_pb_1.ActuatorStatus.USER_STOP : actuator_pb_1.ActuatorStatus.USER_TAKEOVER, 'ls_fence');
                this.driver.abort();
                this.syncArm();
                // Keep the pause in the SDK's replay set (initial_pauses next time).
                // A pause we already had is there (with its own detail) already.
                void this.report({
                    status: this.pauseCause,
                    detail: 'paused by the language server fence',
                });
            }
            this.pushState();
            return;
        }
        this.pendingResume = false;
        // The user stopped the agent and hasn't resumed, but the LS has no fence
        // (e.g. a fresh LS): pause the new lease too.
        if (this.paused) {
            void this.report({
                status: this.pauseCause,
                detail: 'still paused after reconnect',
            });
        }
        this.pushState();
    }
    onStreamLost(reason) {
        this.connected = false;
        this.log(`[ComputerActuator] stream lost: ${reason}`);
        // Runs the SDK marks abandoned (not redispatchable) are dead; a
        // redispatchable one keeps running and its Fulfill pairs with the copy.
        for (const run of this.runs.values()) {
            if (run.ctx.abandoned) {
                this.abandon(run, 'stream lost');
            }
        }
        this.agentActive = false;
        this.ownersActive.clear();
        this.foregroundActors.clear();
        this.forgetAgentRows();
        this.syncArm();
        this.pushState();
        this.opts.onStreamLost?.(reason);
    }
    onNotice(n) {
        const ls = n.leaseStatus;
        if (!ls) {
            return;
        }
        this.lastLeaseStatus = ls;
        // Lease notices are per owner (a subagent's cascade); one without an
        // owner speaks for every agent.
        const owner = ls.ownerConversationId;
        if (ls.agentActive) {
            this.ownersActive.set(owner, true);
        }
        else if (owner) {
            this.ownersActive.delete(owner);
        }
        else {
            this.ownersActive.clear();
        }
        this.agentActive = [...this.ownersActive.values()].some(Boolean);
        const ended = (id) => !ls.agentActive && (!owner || id === owner);
        if (ls.agentActive && owner) {
            this.leaseEndedWhilePaused.delete(owner);
        }
        // Taken-over agents count even before their first batch gave them a
        // row: one that a refused batch adds later goes with the hand back.
        for (const id of this.agentAndPausedIds()) {
            if (!ended(id)) {
                continue;
            }
            if (this.pausedActors.has(id)) {
                // A taken-over agent keeps its row so the host can still hand it
                // back; it goes with the hand back or a Stop.
                this.leaseEndedWhilePaused.add(id);
            }
            else {
                this.agents.delete(id);
            }
        }
        // 3. A lease notice names the owner's cascade: an agent taken over
        // before its first request gets its scope now.
        if (owner && this.pausedActors.get(owner) === '') {
            this.backfillPauseScope(owner, owner);
        }
        for (const id of [...this.foregroundActors]) {
            if (ended(id)) {
                this.foregroundActors.delete(id);
            }
        }
        if (!this.agentActive) {
            // A new lease starts without the last session's app.
            this.setAppName('');
        }
        if (!ls.agentActive && !ls.pausedByUser && !this.paused) {
            // The LS only reports inactive once nothing is in flight on its side,
            // so anything of that owner still running or queued here was
            // abandoned. (A pause is different: the LS still waits for the
            // in-flight request, which the takeover path stops and fulfills as
            // USER_TAKEOVER.)
            for (const run of this.runs.values()) {
                if (ended(run.actor.id)) {
                    this.abandon(run, 'lease ended');
                }
            }
        }
        // A paused_by_user=true right after a local Resume is the stale echo of
        // the Stop; don't make the user press Resume twice.
        const staleEcho = this.now() - this.lastLocalResumeAt < STALE_ECHO_MS;
        if (ls.pausedByUser && !this.paused && !staleEcho) {
            this.setPaused(true, actuator_pb_1.ActuatorStatus.USER_STOP, 'user_stop');
            this.driver.abort();
            // Keep the pause in the SDK's replay set (initial_pauses next time).
            void this.report({
                status: actuator_pb_1.ActuatorStatus.USER_STOP,
                detail: 'paused by the language server fence',
            });
        }
        this.syncArm();
        this.pushState();
    }
    onRequest(req, ctx) {
        const actor = actorOf(req);
        if (req.cascadeId) {
            this.cascadeOf.delete(actor.id);
            this.cascadeOf.set(actor.id, req.cascadeId);
            for (const old of this.cascadeOf.keys()) {
                if (this.cascadeOf.size <= MAX_KNOWN_CASCADES) {
                    break;
                }
                this.cascadeOf.delete(old);
            }
            if (this.pausedActors.get(actor.id) === '') {
                this.backfillPauseScope(actor.id, req.cascadeId);
            }
        }
        const singleAgent = !this.multi;
        // The LS dispatches one computer request at a time per agent (one at a
        // time overall without concurrent_agents), so a new one means it gave up
        // on whatever that agent (on a single-agent surface: any single-agent
        // run) still has running or queued. (The SDK never hands us a
        // redispatched copy of a request that is still running.)
        for (const r of this.runs.values()) {
            if ((singleAgent && r.singleAgent) || r.actor.id === actor.id) {
                this.abandon(r, `superseded by ${req.requestId}`);
            }
        }
        const run = {
            token: ++this.execSeq,
            requestId: req.requestId,
            ctx,
            abandoned: false,
            // A request that arrives while paused is fenced from the start.
            fenced: this.paused,
            actor,
            rootConversationId: req.rootConversationId,
            deadlineMs: Number(req.deadlineUnixMs) || 0,
            singleAgent,
        };
        // Likewise for a request of an agent the user stopped or took over: it
        // stays fenced even if the agent is handed back before it runs.
        if (this.stoppedActors.has(actor.id)) {
            run.agentFence = 'stopped';
        }
        else if (this.pausedActors.has(actor.id)) {
            run.agentFence = 'paused';
        }
        this.runs.set(run.token, run);
        // The SDK sets ctx.abandoned and aborts ctx.signal together (deadline,
        // stream loss without redispatch, stop); a running action stops here.
        ctx.signal.addEventListener('abort', () => {
            this.abandon(run, 'abandoned by the SDK');
        });
        // The mode follows the batch only once execute() accepts it.
        this.syncArm();
        this.pushState();
        // A run always waits for its agent's earlier runs (also one accepted
        // before a restarted executor changed multiAgent()). On a single-agent
        // surface it waits for every agent's: two agents' batches never overlap
        // there. (Another agent's run accepted while the surface was
        // single-agent runs beside a per-agent one: the surface keeps them apart
        // now, and the pointer check refuses overlapping input.)
        const key = actor.id;
        const before = singleAgent
            ? Promise.all([...this.queues.values()])
            : (this.queues.get(key) ?? Promise.resolve());
        const next = before
            .then(() => this.serve(req, run))
            .finally(() => {
            this.runs.delete(run.token);
            if (this.queues.get(key) === next) {
                this.queues.delete(key);
            }
            this.syncArm();
            this.pushState();
        })
            // The queue never rejects: one request's failure (e.g. a throwing host
            // callback) must not stall the requests after it.
            .catch((err) => {
            this.log(`[ComputerActuator] request ${req.requestId}: ${String(err)}`);
        });
        this.queues.set(key, next);
    }
    // ---- host API ----
    /** Takeover or the user's Stop: pause locally first, then tell the LS. */
    async userStop(status, detail, observedAtMs = this.now()) {
        if (this.paused) {
            return;
        }
        this.setPaused(true, status, status === actuator_pb_1.ActuatorStatus.USER_STOP ? 'user_stop' : 'user_takeover');
        this.agentActive = false;
        this.ownersActive.clear();
        this.pendingResume = false;
        // Fence the surface first: it also stops a primitive that is running.
        this.driver.abort();
        this.log(`[ComputerActuator] paused: ${actuator_pb_1.ActuatorStatus[status]} (${detail})`);
        this.driver.setTakeoverArmed(false);
        this.pushState();
        // The SDK stamps observed_at itself; keep the surface's time in the detail.
        await this.report({ status, detail: `${detail} @${observedAtMs}` });
    }
    /** The user's Resume. */
    async userResume() {
        if (!this.paused) {
            return;
        }
        this.setPaused(false);
        this.lastLocalResumeAt = this.now();
        this.pendingResume = true;
        // Update the host first: clearAbort waits for a running primitive.
        this.pushState();
        await this.driver.clearAbort();
        if (this.paused) {
            return; // a takeover or Stop landed meanwhile: it wins
        }
        this.syncArm(); // the lease may still be active: detect takeovers again
        this.log('[ComputerActuator] resumed by user');
        const live = this.connected;
        await this.report({
            status: actuator_pb_1.ActuatorStatus.USER_RESUME,
            detail: 'user Resume',
        });
        if (live && this.connected && !this.paused) {
            // Delivered on a live stream: the SDK dropped it from its replay set,
            // so a later ack's fence is a new one, not this Resume's stale echo.
            this.pendingResume = false;
        }
    }
    /**
     * The user's per-agent Stop: that agent's running action stops (only its
     * own on a multi-agent surface) and its batches answer AGENT_STOPPED for
     * the rest of the lease ({@link resumeAgent} never lifts it); other agents
     * continue. The language server releases that agent when it sees
     * AGENT_STOPPED; an agent the user had taken over is reported stopped
     * (scoped USER_STOP), which also ends a call the LS holds for it.
     */
    stopAgent(actorId) {
        if (!actorId || this.stoppedActors.has(actorId)) {
            return;
        }
        const handBack = this.handBacks.get(actorId);
        if (handBack) {
            // A Stop during a hand back ends it: no second fence lift.
            handBack.state = 'cancelled';
        }
        const held = this.pausedActors.get(actorId);
        const pausedScope = held === undefined ? '' : held || this.cascadeOf.get(actorId) || '';
        this.pausedActors.delete(actorId);
        this.fenceRuns(actorId, 'stopped');
        if (pausedScope) {
            void this.reportScoped({ status: actuator_pb_1.ActuatorStatus.USER_STOP, detail: 'user Stop after takeover' }, pausedScope);
        }
        this.stoppedActors.add(actorId);
        for (const old of this.stoppedActors) {
            if (this.stoppedActors.size <= MAX_STOPPED_AGENTS) {
                break;
            }
            this.stoppedActors.delete(old);
        }
        this.foregroundActors.delete(actorId);
        this.dropEndedRow(actorId);
        this.log(`[ComputerActuator] agent ${actorId} stopped by the user`);
        this.abortAgent(actorId);
        this.syncArm();
        this.pushState();
    }
    /**
     * The user took over one agent's app (Take over in the Agents pane): that
     * agent's running action stops (only its own on a multi-agent surface),
     * its batches answer AGENT_PAUSED until {@link resumeAgent}, and the LS is
     * told (scoped USER_TAKEOVER: it releases that agent's locks and holds its
     * next call). Other agents continue. No-op for a stopped or already paused
     * agent. The report is scoped to the agent's cascade id; an agent that came
     * without one is paused locally only (never as the whole actuator).
     */
    pauseAgent(actorId) {
        if (!actorId || this.stoppedActors.has(actorId)) {
            return;
        }
        if (this.pausedActors.has(actorId)) {
            const handBack = this.handBacks.get(actorId);
            if (handBack) {
                // Taken over again while being handed back: the takeover wins.
                handBack.state = 'cancelled';
                this.fenceRuns(actorId, 'paused');
                this.abortAgent(actorId);
                this.pushState();
            }
            return;
        }
        // An agent's id is its cascade id when it has one (a lease owner).
        const scope = this.cascadeOf.get(actorId) ??
            (this.ownersActive.has(actorId) ? actorId : '');
        this.pausedActors.set(actorId, scope);
        this.fenceRuns(actorId, 'paused');
        // Past the cap the oldest taken-over agent is stopped (reported), never
        // silently un-paused.
        for (const old of [...this.pausedActors.keys()]) {
            if (this.pausedActors.size <= MAX_STOPPED_AGENTS) {
                break;
            }
            this.stopAgent(old);
        }
        this.foregroundActors.delete(actorId);
        this.log(`[ComputerActuator] agent ${actorId} taken over by the user`);
        this.abortAgent(actorId);
        this.syncArm();
        this.pushState();
        if (scope) {
            void this.reportScoped({
                status: actuator_pb_1.ActuatorStatus.USER_TAKEOVER,
                detail: this.takeoverDetail(actorId),
            }, scope);
        }
    }
    /** The scoped USER_TAKEOVER detail of an agent: the app it worked in. */
    takeoverDetail(actorId) {
        const app = (this.agents.get(actorId)?.appName ?? '')
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim();
        return (0, computerOps_1.truncateUtf8)(app, MAX_PAUSE_DETAIL_BYTES);
    }
    /**
     * An agent paused before its cascade id was known learned it: report the
     * takeover now, so the LS holds its call and a later hand back or Stop
     * reaches it.
     */
    backfillPauseScope(actorId, scope) {
        this.pausedActors.set(actorId, scope);
        void this.reportScoped({
            status: actuator_pb_1.ActuatorStatus.USER_TAKEOVER,
            detail: this.takeoverDetail(actorId),
        }, scope);
    }
    /**
     * Stops `actorId`'s running action: its own fence on a multi-agent
     * surface, else the surface's when that agent has a run running.
     */
    abortAgent(actorId) {
        if (this.multi) {
            this.driver.abort({ actorId });
        }
        else if (this.currents.has(actorId)) {
            this.driver.abort();
        }
    }
    /** Drops the row of an agent whose lease ended while it was paused. */
    dropEndedRow(actorId) {
        if (this.leaseEndedWhilePaused.delete(actorId)) {
            this.agents.delete(actorId);
        }
    }
    /** Marks `actorId`'s runs (in flight or queued) with a sticky agent fence. */
    fenceRuns(actorId, fence) {
        for (const run of this.runs.values()) {
            if (run.actor.id === actorId && run.agentFence !== 'stopped') {
                run.agentFence = fence;
            }
        }
    }
    /**
     * The user handed a taken-over agent back: lifts {@link pauseAgent} (and
     * tells the LS, scoped USER_RESUME). Never lifts a stop, and never the
     * whole-actuator pause (a takeover or the user's Stop): the agent stays
     * refused while either holds.
     */
    async resumeAgent(actorId) {
        const held = this.pausedActors.get(actorId);
        if (held === undefined || this.stoppedActors.has(actorId)) {
            return;
        }
        const running = this.handBacks.get(actorId);
        if (running) {
            // Handed back again while a hand back runs (after a takeover
            // cancelled it): that one lifts the fence once more and completes,
            // and this call settles with it.
            running.state = 'restart';
            return running.promise;
        }
        const entry = { promise: Promise.resolve(), state: 'clearing' };
        this.handBacks.set(actorId, entry);
        entry.promise = this.handBack(actorId, held, entry);
        return entry.promise;
    }
    /** Runs {@link resumeAgent}'s hand back of `actorId`, tracked by `entry`. */
    async handBack(actorId, held, entry) {
        let cancelled = false;
        try {
            // The agent stays paused until the surface lifted its fence: a run
            // still unwinding from the takeover answers AGENT_PAUSED.
            do {
                entry.state = 'clearing';
                if (this.multi) {
                    await this.driver.clearAbort({ actorId });
                }
                else if (!this.paused) {
                    await this.driver.clearAbort();
                }
            } while (handBackRestarted(entry));
        }
        finally {
            cancelled = entry.state === 'cancelled';
            this.handBacks.delete(actorId);
        }
        const scope = this.pausedActors.get(actorId) || held || this.cascadeOf.get(actorId);
        // A Stop that landed during the await wins (and reported USER_STOP for
        // the taken-over agent): no RESUME for a stopped agent, and the fence
        // the clearAbort may have lifted is set again.
        if (this.stoppedActors.has(actorId)) {
            this.abortAgent(actorId);
            return;
        }
        if (!this.pausedActors.has(actorId)) {
            return;
        }
        if (cancelled) {
            // Taken over again meanwhile: it stays paused, and the fence the
            // clearAbort may have lifted is set again.
            this.abortAgent(actorId);
            return;
        }
        this.pausedActors.delete(actorId);
        this.dropEndedRow(actorId);
        this.log(`[ComputerActuator] agent ${actorId} handed back by the user`);
        this.pushState();
        if (scope) {
            await this.reportScoped({ status: actuator_pb_1.ActuatorStatus.USER_RESUME, detail: 'user hand back' }, scope);
        }
    }
    /** Reports a health change the host knows of (wire-free). */
    async reportHealth(health) {
        const epoch = this.healthEpoch;
        await this.report((0, computerOps_1.toStatusReport)(health));
        if (epoch === this.healthEpoch) {
            this.lastHealth = (0, computerOps_1.healthKey)(health);
        }
    }
    /**
     * Re-advertises the Hello when geometry, permissions or the confinement
     * level changed, and reports a health change. Call on a timer or a host
     * event.
     */
    async refreshHello() {
        if (!this.connected || !this.reg) {
            return;
        }
        try {
            const epoch = this.healthEpoch;
            const advertEpoch = this.advertEpoch;
            const info = await this.driver.describe();
            // Disposed, disabled or disconnected while describe() ran.
            const reg = this.reg;
            if (!this.connected || !reg) {
                return;
            }
            if (advertEpoch !== this.advertEpoch) {
                // The executor restarted (or the stream resubscribed) meanwhile:
                // this description may be the old executor's. The restart's own
                // refresh (or the Hello) advertises the live one.
                return;
            }
            const level = this.level(info);
            const multi = (0, driver_1.supportsMultiAgent)(this.driver);
            const key = this.advert(info, level, multi);
            if (key !== this.lastAdvert) {
                // Record it only once the LS has it, so a failed update (e.g. mid
                // reconnect) is retried by the next refresh.
                const hello = (0, computerOps_1.buildHello)(info, level, multi);
                hello.supportsScript = this.scriptAvailable();
                await reg.update({ hello });
                if (advertEpoch !== this.advertEpoch) {
                    // The executor restarted while the update was on its way: what it
                    // advertised may be stale, and must not overwrite the live
                    // `multi`. Re-advertise from a fresh read.
                    this.lastAdvert = '';
                    void this.refreshHello();
                    return;
                }
                this.multi = multi;
                this.lastAdvert = key;
                this.log(`[ComputerActuator] re-advertised ${key}`);
            }
            const health = this.currentHealth(info);
            // A probe that started before an executor exit must not overwrite the
            // EXECUTOR_CRASHED that exit reported.
            if ((0, computerOps_1.healthKey)(health) !== this.lastHealth && epoch === this.healthEpoch) {
                await this.reportHealth(health);
            }
        }
        catch (err) {
            this.log(`[ComputerActuator] refresh failed: ${String(err)}`);
        }
    }
    /** The state a host shows. */
    state() {
        const st = {
            // A paused surface shows no agent at work, even if a paused lease
            // notice still says agent_active.
            agentActive: this.active() && !this.paused,
            paused: this.paused,
            connected: this.connected,
            mode: this.foregroundMode ? 'foreground' : 'background',
            appName: this.appName,
            agents: [...this.agents.values()].map((a) => ({
                ...a,
                actor: { ...a.actor },
                stopped: this.stoppedActors.has(a.actor.id),
                paused: this.pausedActors.has(a.actor.id),
            })),
        };
        if (this.paused) {
            st.pauseCause = this.pauseOrigin;
        }
        return st;
    }
    // ---- surface events ----
    onUserInput(ev) {
        if (this.active() && !this.paused && this.foregroundMode) {
            void this.userStop(actuator_pb_1.ActuatorStatus.USER_TAKEOVER, `real input: ${ev.reason}`, ev.observedAtMs);
        }
        else if (!this.paused) {
            // The surface fences itself when it reports user input. This one raced
            // with the lease ending or a switch to background mode, so there is
            // nothing to stop: lift the fence.
            void this.driver.clearAbort();
        }
    }
    onExecutorEvent(ev) {
        if (ev.state === 'exited') {
            this.healthEpoch++;
            this.lastHealth = (0, computerOps_1.healthKey)({ healthy: false, reason: 'executor_crashed' });
            void this.report((0, computerOps_1.toStatusReport)({
                healthy: false,
                reason: 'executor_crashed',
                detail: `computer executor exited (${ev.reason}); restarting`,
            }));
            return;
        }
        // A restarted executor comes back unfenced and disarmed; restore both,
        // then report its health (even while disconnected: the SDK keeps it as
        // the next initial status) and re-advertise if it changed.
        if (this.paused) {
            this.driver.abort();
        }
        // The restarted executor may run agents concurrently or not any more:
        // fence for the surface as it is now (a single-agent one would take a
        // per-agent abort as the whole surface's and stop every agent).
        this.multi = (0, driver_1.supportsMultiAgent)(this.driver);
        this.advertEpoch++;
        if (this.multi) {
            // Each stopped or taken-over agent stays fenced on the new executor,
            // also under the whole-actuator pause (it outlives that pause).
            for (const actorId of [
                ...this.stoppedActors,
                ...this.pausedActors.keys(),
            ]) {
                this.driver.abort({ actorId });
            }
        }
        this.syncArm();
        void this.recovered().then(() => this.refreshHello());
    }
    async recovered() {
        const epoch = this.healthEpoch;
        try {
            const health = this.currentHealth(await this.driver.describe());
            if (epoch === this.healthEpoch) {
                await this.reportHealth(health);
            }
        }
        catch (err) {
            this.log(`[ComputerActuator] recovery probe failed: ${String(err)}`);
        }
    }
    // ---- internals ----
    /**
     * The level advertised and enforced: a surface without the background
     * capability serves foreground batches only, whatever it claims.
     */
    level(info) {
        const v = (0, computerOps_1.confinementVersion)(info, this.opts.maxConfinementVersion?.());
        return (0, driver_1.supportsBackground)(this.driver)
            ? v
            : Math.min(v, computerOps_1.FOREGROUND_CONFINEMENT_VERSION);
    }
    /** The health to report: the host's (e.g. not installed), else the surface's. */
    currentHealth(info) {
        return this.opts.initialHealth?.() ?? (0, computerOps_1.healthOf)(info);
    }
    setPaused(p, cause = actuator_pb_1.ActuatorStatus.USER_TAKEOVER, origin = 'user_takeover') {
        this.paused = p;
        if (p) {
            this.pauseCause = cause;
            this.pauseOrigin = origin;
            this.foregroundActors.clear();
            for (const run of this.runs.values()) {
                run.fenced = true;
            }
        }
        this.opts.onPausedChanged?.(p);
    }
    /**
     * The handler is paused, or a pause landed while `run` was in flight: a
     * fenced run stops with USER_TAKEOVER even if the user has resumed since.
     */
    isPaused(run) {
        return this.paused || Boolean(run?.fenced);
    }
    /** The agent holds the lease or a run is still live (not abandoned or fenced). */
    active() {
        if (this.agentActive) {
            return true;
        }
        for (const run of this.runs.values()) {
            if (!this.isAbandoned(run) && !run.fenced) {
                return true;
            }
        }
        return false;
    }
    /** The result of a batch the pause stopped: USER_STOP after a Stop. */
    pausedResult() {
        return this.pauseCause === actuator_pb_1.ActuatorStatus.USER_STOP
            ? { code: 'USER_STOP', text: computerOps_1.ERR_TEXT.USER_STOP }
            : { code: 'USER_TAKEOVER', text: computerOps_1.ERR_TEXT.USER_TAKEOVER };
    }
    syncArm() {
        this.driver.setTakeoverArmed(this.enabled && this.active() && !this.paused && this.foregroundMode);
    }
    pushState() {
        // Every pause, stop, takeover and abandonment passes here: end the
        // agent's running script now rather than at the next fence poll.
        this.abortFencedScripts();
        this.opts.onState?.(this.state());
    }
    /** advertKey plus supports_script (it can turn on after the selftest). */
    advert(info, level, multi) {
        return `${(0, computerOps_1.advertKey)(info, level, multi)}|${this.scriptAvailable() ? 'script' : ''}`;
    }
    scriptAvailable() {
        const r = this.opts.script;
        return !!r && (r.available?.() ?? true);
    }
    /** Whether `run` is fenced: paused, its agent stopped, or abandoned. */
    scriptFenced(run) {
        return this.isPaused(run) || this.isStopped(run) || this.isAbandoned(run);
    }
    abortFencedScripts() {
        for (const [ac, run] of this.scriptRuns) {
            if (!ac.signal.aborted && this.scriptFenced(run)) {
                ac.abort();
            }
        }
    }
    isAbandoned(run) {
        return !!run && (run.abandoned || run.ctx.abandoned);
    }
    abandon(run, reason) {
        if (run.abandoned) {
            return;
        }
        run.abandoned = true;
        this.log(`[ComputerActuator] abandoning ${run.requestId}: ${reason}`);
        if (this.currents.get(run.actor.id) === run) {
            // Out-of-band: also stops a primitive that is already running (only
            // this agent's on a multi-agent surface).
            this.abortFor(run);
        }
    }
    /** Fences the surface for `run`'s agent (the whole surface if single). */
    abortFor(run) {
        if (this.multi) {
            this.driver.abort({ actorId: run.actor.id });
        }
        else {
            this.driver.abort();
        }
        // An abandoned run no longer counts as agent activity.
        this.syncArm();
        this.pushState();
    }
    /** The user stopped or took over `run`'s agent (its batches are refused). */
    isStopped(run) {
        return (!!run &&
            (run.agentFence !== undefined ||
                this.stoppedActors.has(run.actor.id) ||
                this.pausedActors.has(run.actor.id)));
    }
    /** What a stopped (AGENT_STOPPED wins) or taken-over agent's batch says. */
    agentFenceResult(run) {
        const stopped = !run ||
            run.agentFence === 'stopped' ||
            this.stoppedActors.has(run.actor.id);
        const paused = !!run &&
            (run.agentFence === 'paused' || this.pausedActors.has(run.actor.id));
        return !stopped && paused
            ? { code: 'AGENT_PAUSED', text: computerOps_1.ERR_TEXT.AGENT_PAUSED }
            : { code: 'AGENT_STOPPED', text: computerOps_1.ERR_TEXT.AGENT_STOPPED };
    }
    abandonAll(reason) {
        for (const run of this.runs.values()) {
            this.abandon(run, reason);
        }
    }
    /**
     * Sends a status report. Resolves once the SDK delivered it (or, while
     * disconnected, remembered it for the next Subscribe). Never rejects.
     */
    report(r) {
        if (!this.reg) {
            return Promise.resolve();
        }
        const p = this.reg
            .reportStatus({
            ...r,
            rootConversationId: '', // computer scope is the whole actuator
            detail: (0, computerOps_1.truncateUtf8)(r.detail ?? '', 256),
        })
            .catch((err) => {
            this.log(`[ComputerActuator] reportStatus failed: ${String(err)}`);
        });
        this.lastReport = p;
        return p;
    }
    /**
     * Sends a status report scoped to one agent (`scope` = its cascade id,
     * never ''): the per-agent pause contract. Never rejects.
     */
    reportScoped(r, scope) {
        if (!this.reg || !scope) {
            return Promise.resolve();
        }
        const p = this.reg
            .reportStatus({
            ...r,
            rootConversationId: scope,
            detail: (0, computerOps_1.truncateUtf8)(r.detail ?? '', 256),
        })
            .catch((err) => {
            this.log(`[ComputerActuator] reportStatus failed: ${String(err)}`);
        });
        this.lastReport = p;
        return p;
    }
    /** Executes one request and fulfills it exactly once. Never throws. */
    async serve(req, run) {
        let out;
        this.currents.set(run.actor.id, run);
        try {
            if (!this.isAbandoned(run) &&
                !this.isPaused(run) &&
                !this.isStopped(run)) {
                // Lift a fence left by an abandoned predecessor (of this agent, on a
                // multi-agent surface). A takeover event in flight is processed
                // before this resolves, so `paused` is re-checked inside execute.
                await (this.multi
                    ? this.driver.clearAbort({ actorId: run.actor.id })
                    : this.driver.clearAbort());
            }
            out = await this.execute(req.payload, run);
        }
        catch (err) {
            // A pause or this agent's stop / takeover that landed meanwhile wins
            // over the failure (e.g. clearAbort or describe rejecting): the LS
            // releases a stopped agent only on AGENT_STOPPED.
            const fence = this.isPaused(run)
                ? this.pausedResult()
                : this.isStopped(run)
                    ? this.agentFenceResult(run)
                    : { code: 'ACTION_FAILED', text: `ACTION_FAILED: ${String(err)}` };
            out = {
                result: (0, protobuf_1.create)(computer_payload_pb_1.ComputerResultSchema, {
                    ok: false,
                    errorCode: fence.code,
                    error: fence.text,
                }),
            };
        }
        if (this.currents.get(run.actor.id) === run) {
            this.currents.delete(run.actor.id);
        }
        if (this.pointerHolder === run) {
            this.pointerHolder = undefined;
        }
        if (out.result.errorCode === 'USER_TAKEOVER' &&
            !this.isPaused(run) &&
            !this.isAbandoned(run)) {
            void this.userStop(actuator_pb_1.ActuatorStatus.USER_TAKEOVER, 'the surface reported a takeover during the batch');
        }
        if (out.result.errorCode === 'USER_TAKEOVER' ||
            out.result.errorCode === 'AGENT_PAUSED' ||
            this.isPaused(run)) {
            // ReportStatus(USER_TAKEOVER/STOP) must reach the LS before this
            // Fulfill, so its takeover count has moved when the result arrives.
            // The SDK sends reports in order but doesn't order a Fulfill after them.
            await this.lastReport;
        }
        let outcome;
        try {
            if (this.isAbandoned(run) &&
                !this.isPaused(run) &&
                !this.isStopped(run)) {
                // The LS already released this request; a paused (or stopped) run
                // always fulfills its pause result (USER_TAKEOVER / USER_STOP /
                // AGENT_STOPPED) instead.
                this.log(`[ComputerActuator] ${req.requestId} abandoned (${out.result.error})`);
                outcome = await run.ctx.fail(actuator_pb_1.ActuatorErrorCode.ABANDONED, computerOps_1.ERR_TEXT.ABANDONED);
            }
            else {
                outcome = await run.ctx.fulfill(out.result, 
                // Blob 0 is the final frame when there is one; the script's
                // screenshots follow (from blob 0 without a frame).
                [...(out.blob ? [out.blob] : []), ...(out.extraBlobs ?? [])]);
            }
            if (outcome && outcome.status !== 'delivered') {
                this.log(`[ComputerActuator] Fulfill ${req.requestId}: ${JSON.stringify(outcome)}`);
            }
        }
        catch (err) {
            this.log(`[ComputerActuator] Fulfill ${req.requestId} failed: ${String(err)}`);
        }
    }
    /**
     * Runs a request through the driver and builds the result. `script` marks a
     * script's one-action call (Zone B): the surface description is reused, a
     * failure carries the surface's finer reason, and no `done` activity or
     * focused-app read follows it.
     */
    async execute(req, run, script) {
        const result = (0, protobuf_1.create)(computer_payload_pb_1.ComputerResultSchema, { ok: true });
        const out = { result };
        const fail = (code, text) => {
            result.ok = false;
            result.errorCode = code;
            result.error = text;
        };
        const failPaused = () => {
            const { code, text } = this.pausedResult();
            fail(code, text);
        };
        const stopped = () => this.isStopped(run);
        const failStopped = () => {
            const { code, text } = this.agentFenceResult(run);
            fail(code, text);
        };
        if (this.isPaused(run)) {
            failPaused();
            return out;
        }
        if (run &&
            !this.isAbandoned(run) &&
            !this.stoppedActors.has(run.actor.id) &&
            run.agentFence !== 'stopped' &&
            !(run.agentFence === 'paused' && !this.pausedActors.has(run.actor.id))) {
            // The agent shows from its first batch on, also one refused because
            // the user took it over (the host offers its hand back), but not a
            // batch fenced by a takeover that was handed back since (its row may
            // have gone with the hand back).
            this.noteAgent(run, req);
        }
        if (stopped()) {
            failStopped();
            return out;
        }
        if (this.isAbandoned(run)) {
            fail('ACTION_FAILED', computerOps_1.ERR_TEXT.ABANDONED);
            return out;
        }
        if (req.script && !script) {
            return this.executeScript(req, run);
        }
        // A batch without foreground actions never captures the display (it
        // would show the user's screen) nor reads the frontmost app.
        const foreground = (0, computerOps_1.isForegroundBatch)(req) || !!script?.clickRef;
        // Screenshot-only batches don't claim the pointer (needsPointer in the
        // LS scope.go); a script's clickRef does.
        const claimsPointer = !!script?.clickRef ||
            req.actions.some((a) => (0, computerOps_1.isForegroundAction)(a) && a.type !== computer_payload_pb_1.ComputerActionType.SCREENSHOT);
        if (claimsPointer && run) {
            // One agent's input batch at a time. A holder that was abandoned,
            // paused/fenced, or stopped is fenced (its input is dropped), so it no
            // longer counts.
            const holder = this.pointerHolder;
            if (holder &&
                holder !== run &&
                !this.isAbandoned(holder) &&
                !this.isPaused(holder) &&
                !this.isStopped(holder)) {
                fail('POINTER_BUSY', computerOps_1.ERR_TEXT.POINTER_BUSY);
                return out;
            }
            this.pointerHolder = run;
        }
        let capture = foreground && req.captureAfter;
        // §9 fail closed: a missing field is an empty set, and the policy always
        // goes with every input call, so "no enforcement" is unreachable here.
        const allowed = new Set(req.allowedBundleIds);
        // C13: with concurrent agents, foreground input is confined to the apps
        // this batch holds the LS's locks on (lowercased bundle ids), so it can't
        // reach an app another agent holds. Empty: no lock information.
        const locked = new Set(req.lockedBundleIds.map((b) => b.toLowerCase()));
        const confineToLocks = this.multi && locked.size > 0;
        const inputPolicy = () => {
            const p = (0, computerOps_1.toDriverPolicy)(allowed, req.urlPolicy);
            if (confineToLocks) {
                p.allowedAppIds = p.allowedAppIds.filter((id) => locked.has(id.toLowerCase()));
            }
            return p;
        };
        let ranInput = false;
        let settled = false;
        // USER_TAKEOVER / PERMISSION_MISSING / SCREEN_LOCKED / abandoned
        let noScreenshot = false;
        /** SCREENSHOT actions run: their activity follows the capture. */
        let shotsRun = 0;
        /** Whether the display capture succeeded (undefined: not attempted). */
        let captured;
        let windowShot = false; // a WINDOW_SCREENSHOT supplies the blob
        /** The agent, for every surface call (absent when run directly). */
        const actorOpt = run ? { actor: run.actor } : {};
        /** The app of the last background action, for ax_snapshot_after. */
        let lastApp = '';
        /** The app of each snapshot epoch this batch took. */
        const snapApps = new Map();
        const bg = (0, driver_1.supportsBackground)(this.driver) ? this.driver : null;
        const background = () => {
            if (!bg) {
                throw new driver_1.ComputerDriverError('ACTION_FAILED', 'ACTION_FAILED: this surface has no background capability');
            }
            return bg;
        };
        // A takeover or abandonment ends the settle early.
        const settle = async () => {
            if (ranInput && !settled && req.settleMs > 0) {
                settled = true;
                await this.interruptibleWait(Math.min(req.settleMs, computerOps_1.MAX_SETTLE_MS), run);
            }
        };
        const toFailure = (err, what) => {
            if (err instanceof driver_1.ComputerDriverError) {
                fail(err.code, err.message);
            }
            else {
                fail('ACTION_FAILED', `ACTION_FAILED: ${what} failed: ${String(err)}`);
            }
        };
        if (req.actions.length > computerOps_1.MAX_ACTIONS) {
            fail('ACTION_FAILED', `ACTION_FAILED: batch has ${req.actions.length} actions (max ${computerOps_1.MAX_ACTIONS})`);
            return out;
        }
        const info = script?.info ?? (await this.driver.describe({ signal: run?.ctx.signal }));
        const level = this.level(info);
        const need = (0, computerOps_1.requiredConfinement)(req);
        // Only an accepted batch moves the mode (and takeover detection), and
        // not one a pause, stop or abandonment ended while describe() ran.
        if (level >= need &&
            !this.isPaused(run) &&
            !stopped() &&
            !this.isAbandoned(run)) {
            this.followMode(req, run);
        }
        if (level < need) {
            noScreenshot = true;
            // The surface (e.g. restarted from an older executor) enforces less
            // than this batch needs; never send it input before the LS sees the
            // new Hello.
            void this.refreshHello();
            fail('CONFINEMENT_OUTDATED', `CONFINEMENT_OUTDATED: the AGY Hub desktop helper enforces app-confinement v${level}, but this request requires v${need}; update the client (AGY Hub and its desktop helper), then retry. Report this to the parent agent.`);
        }
        else if (foreground && (0, computerOps_1.geometryChanged)(req, info.mainDisplay)) {
            // Background-only batches address elements and windows, not display
            // coordinates: no fence.
            fail('GEOMETRY_CHANGED', computerOps_1.ERR_TEXT.GEOMETRY_CHANGED);
            capture = true;
        }
        else {
            for (let i = 0; i < req.actions.length; i++) {
                if (this.isPaused(run)) {
                    failPaused();
                    noScreenshot = true;
                    break;
                }
                if (stopped()) {
                    failStopped();
                    noScreenshot = true;
                    break;
                }
                if (this.isAbandoned(run)) {
                    fail('ACTION_FAILED', computerOps_1.ERR_TEXT.ABANDONED);
                    noScreenshot = true;
                    break;
                }
                if (script?.ended?.()) {
                    fail('INTERRUPTED', 'INTERRUPTED: the script ended');
                    noScreenshot = true;
                    break;
                }
                const a = req.actions[i];
                const r1 = { index: i, ok: true };
                if ((0, computerOps_1.isForegroundAction)(a) && windowShot) {
                    // A SCREENSHOT or foreground action makes an earlier window capture
                    // of the batch stale: the display capture after it (if any) is the
                    // batch's screenshot.
                    windowShot = false;
                    delete out.blob;
                    result.screenshotWidthPx = 0;
                    result.screenshotHeightPx = 0;
                    result.windowGeometry = undefined;
                    result.browserPages = [];
                }
                /** The element's window frame, for placing a visual hint (display only). */
                let windowBounds;
                /** F2/F8: the app and frame an AX action reached. */
                const reached = (t) => {
                    if (t.appId) {
                        r1.resolvedBundleId = (0, computerOps_1.truncateUtf8)(t.appId, 256);
                    }
                    if (t.bounds) {
                        r1.targetBounds = (0, computerOps_1.toProtoRect)(t.bounds);
                    }
                    if (t.windowBounds) {
                        windowBounds = { ...t.windowBounds };
                    }
                    return t.appId;
                };
                if (a.type === computer_payload_pb_1.ComputerActionType.SCREENSHOT) {
                    capture = true;
                    shotsRun++;
                }
                else if (a.type === computer_payload_pb_1.ComputerActionType.WAIT) {
                    await this.interruptibleWait(Math.min(a.waitMs, computerOps_1.MAX_WAIT_MS), run, script?.ended);
                    // A script's sleep is only a sleep: no display capture after it.
                    capture = foreground && !script;
                }
                else {
                    const call = (0, computerOps_1.driverCallFor)(a);
                    if (a.type === computer_payload_pb_1.ComputerActionType.TYPE &&
                        [...a.text].length > computerOps_1.MAX_TEXT_RUNES) {
                        r1.ok = false;
                        r1.errorCode = 'ACTION_FAILED';
                        r1.error = `ACTION_FAILED: text has ${[...a.text].length} characters (max ${computerOps_1.MAX_TEXT_RUNES})`;
                    }
                    else if (!call) {
                        r1.ok = false;
                        r1.errorCode = 'ACTION_FAILED';
                        r1.error = `ACTION_FAILED: unsupported action type ${a.type}`;
                    }
                    else {
                        ranInput = true;
                        const o = {
                            policy: (0, computerOps_1.toDriverPolicy)(allowed, req.urlPolicy),
                            signal: run?.ctx.signal,
                            ...actorOpt,
                        };
                        if (isElementCall(call)) {
                            // A failed element action must never re-snapshot an earlier
                            // action's app (its refs would be attributed to this one).
                            lastApp = '';
                        }
                        /** Foreground input: also confined to the batch's locks. */
                        const io = { ...o, policy: inputPolicy() };
                        try {
                            switch (call.kind) {
                                case 'mouse':
                                    await this.driver.mouse(call.action, io);
                                    break;
                                case 'key':
                                    await this.driver.key(call.keys, io);
                                    break;
                                case 'text':
                                    await this.driver.text(call.text, io);
                                    break;
                                case 'focusApp': {
                                    const { appId } = await this.driver.focusApp(call.app, {
                                        signal: o.signal,
                                        ...actorOpt,
                                    });
                                    // A focus_app is only sent after its card was approved, so
                                    // the resolved app joins the allowed set for the rest of
                                    // the batch.
                                    if (appId) {
                                        allowed.add(appId);
                                        // The LS locked the app it named; input to it stays
                                        // inside this batch's locks.
                                        locked.add(appId.toLowerCase());
                                        r1.resolvedBundleId = appId;
                                    }
                                    this.setAppName(appId || call.app);
                                    break;
                                }
                                case 'bindApp': {
                                    const b = await background().bindApp(call.app, {
                                        signal: o.signal,
                                        ...actorOpt,
                                    });
                                    // Like focus_app, a bind_app is only sent after its card
                                    // was approved: the app joins the allowed set.
                                    if (b.appId) {
                                        allowed.add(b.appId);
                                        r1.resolvedBundleId = (0, computerOps_1.truncateUtf8)(b.appId, 256);
                                        lastApp = b.appId;
                                    }
                                    this.setAppName(b.appName || b.appId);
                                    break;
                                }
                                case 'axSnapshot': {
                                    const so = {
                                        appId: call.appId,
                                        includeMenubar: call.includeMenubar,
                                        ...o,
                                    };
                                    if (call.windowId !== undefined) {
                                        so.windowId = call.windowId;
                                    }
                                    const snap = await background().axSnapshot(so);
                                    result.axSnapshotText = (0, computerOps_1.truncateSnapshot)(snap.text, computerOps_1.MAX_AX_SNAPSHOT_BYTES);
                                    out.axTruncated =
                                        snap.truncated === true ||
                                            result.axSnapshotText !== snap.text;
                                    if (snap.appId) {
                                        r1.resolvedBundleId = (0, computerOps_1.truncateUtf8)(snap.appId, 256);
                                    }
                                    lastApp = snap.appId || call.appId;
                                    snapApps.set(snap.epoch, lastApp);
                                    break;
                                }
                                case 'axPress': {
                                    if (!script?.clickRef) {
                                        lastApp = reached(await background().axPress(call.ref, o));
                                        break;
                                    }
                                    // Script mode's clickRef: confined like AX_PRESS (the
                                    // ref's app) and like foreground input (the batch's locks).
                                    const b = background();
                                    if (!b.clickRef) {
                                        throw new driver_1.ComputerDriverError('ACTION_FAILED', 'ACTION_FAILED: this surface has no clickRef; use axPress', { reason: 'ACTION_NOT_SUPPORTED' });
                                    }
                                    lastApp = reached(await b.clickRef(call.ref, io));
                                    break;
                                }
                                case 'axSetValue':
                                    lastApp = reached(await background().axSetValue(call.ref, call.text, {
                                        ...o,
                                        confirm: call.confirm,
                                    }));
                                    break;
                                case 'axSelect':
                                    lastApp = reached(await background().axSelect(call.ref, o));
                                    break;
                                case 'axScroll':
                                    lastApp = reached(await background().axScroll(call.ref, {
                                        deltaXLines: call.deltaXLines,
                                        deltaYLines: call.deltaYLines,
                                    }, o));
                                    break;
                                case 'windowScreenshot': {
                                    const wo = {
                                        appId: call.appId,
                                        maxLongEdgePx: (0, computerOps_1.clamp)(req.maxScreenshotLongEdgePx || computerOps_1.DEFAULT_LONG_EDGE_PX, computerOps_1.MIN_LONG_EDGE_PX, computerOps_1.MAX_LONG_EDGE_PX),
                                        ...o,
                                    };
                                    if (call.windowId !== undefined) {
                                        wo.windowId = call.windowId;
                                    }
                                    const shot = await background().windowScreenshot(wo);
                                    out.blob = {
                                        name: 'window_screenshot',
                                        mimeType: 'image/png',
                                        data: shot.png,
                                        widthPx: shot.widthPx,
                                        heightPx: shot.heightPx,
                                    };
                                    result.screenshotWidthPx = shot.widthPx;
                                    result.screenshotHeightPx = shot.heightPx;
                                    // The window's own app (resolved by the surface) over the
                                    // request's string, which may be a display name.
                                    result.windowGeometry = (0, protobuf_1.create)(computer_payload_pb_1.ComputerWindowGeometrySchema, (0, computerOps_1.toProtoWindowGeometry)(shot.appId || call.appId, shot.targetWindow));
                                    result.browserPages = (0, computerOps_1.toProtoBrowserPages)(shot.browserPages);
                                    windowShot = true;
                                    if (shot.appId) {
                                        r1.resolvedBundleId = (0, computerOps_1.truncateUtf8)(shot.appId, 256);
                                    }
                                    r1.targetBounds = (0, computerOps_1.toProtoRect)({
                                        x: shot.targetWindow.x,
                                        y: shot.targetWindow.y,
                                        width: shot.targetWindow.widthPoints,
                                        height: shot.targetWindow.heightPoints,
                                    });
                                    lastApp = shot.appId || call.appId;
                                    break;
                                }
                                default:
                                    break;
                            }
                        }
                        catch (err) {
                            r1.ok = false;
                            if (isElementCall(call)) {
                                // Snapshot the element's app for the recovery (e.g. after
                                // STALE_REF), if known.
                                lastApp = appOfRef(call.ref, snapApps, allowed);
                            }
                            if (err instanceof driver_1.ComputerDriverError) {
                                // A script classifies on the surface's finer reason.
                                r1.errorCode = (script && err.reason) || err.code;
                                r1.error = err.message;
                                if (err.blockedHost) {
                                    r1.blockedHost = (0, computerOps_1.truncateUtf8)(err.blockedHost, 253);
                                }
                                // F2: the app an attempted action reached, also on failure.
                                if (err.appId && !r1.resolvedBundleId) {
                                    r1.resolvedBundleId = (0, computerOps_1.truncateUtf8)(err.appId, 256);
                                }
                                if (err.appId && isElementCall(call)) {
                                    // The surface knows the element's app: snapshot that one.
                                    lastApp = err.appId;
                                }
                                // An allowed app the batch holds no lock on: another agent's.
                                const app = err.appId?.toLowerCase() ?? '';
                                if (confineToLocks &&
                                    err.code === 'APP_NOT_ALLOWED' &&
                                    ((0, computerOps_1.isForegroundAction)(a) || !!script?.clickRef) &&
                                    app &&
                                    !locked.has(app) &&
                                    [...allowed].some((id) => id.toLowerCase() === app)) {
                                    r1.errorCode = 'TARGET_CHANGED';
                                    r1.error = computerOps_1.ERR_TEXT.TARGET_CHANGED_LOCKED;
                                }
                            }
                            else {
                                r1.errorCode = 'ACTION_FAILED';
                                r1.error = `ACTION_FAILED: ${String(err)}`;
                            }
                        }
                    }
                }
                // No activity once the agent was paused, stopped, abandoned or
                // taken over: its row must not come back after it. A SCREENSHOT's
                // comes once the capture settled.
                if (a.type !== computer_payload_pb_1.ComputerActionType.SCREENSHOT &&
                    run &&
                    !this.isPaused(run) &&
                    !stopped() &&
                    !this.isAbandoned(run) &&
                    r1.errorCode !== 'USER_TAKEOVER') {
                    const aBounds = r1.targetBounds
                        ? {
                            x: Number(r1.targetBounds.xPoints ?? 0),
                            y: Number(r1.targetBounds.yPoints ?? 0),
                            width: Number(r1.targetBounds.widthPoints ?? 0),
                            height: Number(r1.targetBounds.heightPoints ?? 0),
                        }
                        : undefined;
                    // The agent's visual hint (display only, V-1..V-5): where the
                    // indicator goes in the element's window; never what is acted on.
                    const hinted = isElementAction(a)
                        ? hintedPlacement(a.visualHint, windowBounds, aBounds)
                        : undefined;
                    const ev = {
                        kind: script?.clickRef ? 'click_ref' : (0, computerOps_1.actionKind)(a),
                        // WAIT is mode-neutral: the agent's sticky mode.
                        mode: (0, computerOps_1.isForegroundAction)(a) ||
                            !!script?.clickRef ||
                            (a.type === computer_payload_pb_1.ComputerActionType.WAIT &&
                                this.foregroundActors.has(run.actor.id))
                            ? 'foreground'
                            : 'background',
                        ok: r1.ok !== false,
                    };
                    if (r1.resolvedBundleId) {
                        ev.appId = r1.resolvedBundleId;
                    }
                    if (hinted) {
                        ev.point = hinted.point;
                        if (hinted.bounds) {
                            ev.bounds = hinted.bounds;
                        }
                    }
                    else if (aBounds) {
                        ev.bounds = aBounds;
                    }
                    if ((0, computerOps_1.isPointerAction)(a)) {
                        ev.point =
                            a.type === computer_payload_pb_1.ComputerActionType.DRAG
                                ? { x: a.toXPoints, y: a.toYPoints }
                                : { x: a.xPoints, y: a.yPoints };
                    }
                    if (a.type === computer_payload_pb_1.ComputerActionType.SCROLL ||
                        a.type === computer_payload_pb_1.ComputerActionType.AX_SCROLL) {
                        ev.scroll = { dx: a.scrollDx, dy: a.scrollDy };
                    }
                    this.activity(run, ev);
                }
                // Abandonment that landed during this action wins over its result
                // (the surface reports the aborted primitive as USER_TAKEOVER).
                if (this.isAbandoned(run) && !this.isPaused(run)) {
                    result.results.push((0, protobuf_1.create)(computer_payload_pb_1.ComputerActionResultSchema, r1));
                    fail('ACTION_FAILED', computerOps_1.ERR_TEXT.ABANDONED);
                    noScreenshot = true;
                    break;
                }
                // A takeover (or this agent's stop) that landed during this action
                // wins over its result.
                if ((this.isPaused(run) || stopped()) && r1.ok) {
                    result.results.push((0, protobuf_1.create)(computer_payload_pb_1.ComputerActionResultSchema, r1));
                    result.completedActions++;
                    if (this.isPaused(run)) {
                        failPaused();
                    }
                    else {
                        failStopped();
                    }
                    noScreenshot = true;
                    break;
                }
                result.results.push((0, protobuf_1.create)(computer_payload_pb_1.ComputerActionResultSchema, r1));
                if (!r1.ok) {
                    fail(r1.errorCode, r1.error);
                    if (r1.errorCode === 'PERMISSION_MISSING' ||
                        r1.errorCode === 'SCREEN_LOCKED' ||
                        r1.errorCode === 'USER_TAKEOVER') {
                        noScreenshot = true;
                    }
                    break;
                }
                result.completedActions++;
            }
        }
        if (this.isAbandoned(run) && !this.isPaused(run)) {
            fail('ACTION_FAILED', computerOps_1.ERR_TEXT.ABANDONED);
            noScreenshot = true;
        }
        if (req.axSnapshotAfter &&
            lastApp &&
            bg &&
            !noScreenshot &&
            !this.isPaused(run) &&
            !stopped()) {
            await settle();
            try {
                if (!this.isPaused(run) && !this.isAbandoned(run) && !stopped()) {
                    const snap = await bg.axSnapshot({
                        appId: lastApp,
                        policy: (0, computerOps_1.toDriverPolicy)(allowed, req.urlPolicy),
                        signal: run?.ctx.signal,
                        ...actorOpt,
                    });
                    result.axSnapshotText = (0, computerOps_1.truncateSnapshot)(snap.text, computerOps_1.MAX_AX_SNAPSHOT_BYTES);
                }
            }
            catch (err) {
                if (err instanceof driver_1.ComputerDriverError &&
                    err.code === 'USER_TAKEOVER') {
                    // Like a takeover during the capture: it wins over an earlier
                    // action error, and nothing of the desktop is read after it.
                    fail('USER_TAKEOVER', computerOps_1.ERR_TEXT.USER_TAKEOVER);
                    noScreenshot = true;
                }
                else if (result.ok) {
                    if (err instanceof driver_1.ComputerDriverError &&
                        err.code === 'ACTION_FAILED') {
                        // The actions ran: a snapshot that failed only afterwards (e.g. the
                        // window they closed) is told in its place, not as a failed batch.
                        // Other codes (a fence, a lock, a policy refusal) still fail it.
                        result.axSnapshotText = (0, computerOps_1.truncateUtf8)(
                        // One line: the LS reads each line of the text as an element.
                        `(no accessibility snapshot after the actions: ${err.message.replace(/^ACTION_FAILED:\s*/, '').replace(/[\r\n]+/g, ' ')})`, computerOps_1.MAX_AX_SNAPSHOT_BYTES);
                    }
                    else {
                        toFailure(err, 'accessibility snapshot');
                    }
                }
            }
        }
        if (capture &&
            !windowShot &&
            !noScreenshot &&
            !this.isPaused(run) &&
            !stopped()) {
            await settle();
        }
        // Re-checked after the settle: no capture once paused, abandoned or
        // stopped.
        if (capture &&
            !windowShot &&
            !noScreenshot &&
            !this.isPaused(run) &&
            !this.isAbandoned(run) &&
            !stopped()) {
            try {
                const shot = await this.driver.capture({
                    maxLongEdgePx: (0, computerOps_1.clamp)(req.maxScreenshotLongEdgePx || computerOps_1.DEFAULT_LONG_EDGE_PX, computerOps_1.MIN_LONG_EDGE_PX, computerOps_1.MAX_LONG_EDGE_PX),
                    // Lets the surface report an allowed app's window that sits on a
                    // display it doesn't capture (it never moves windows on capture).
                    policy: (0, computerOps_1.toDriverPolicy)(allowed, req.urlPolicy),
                    signal: run?.ctx.signal,
                    ...actorOpt,
                });
                out.blob = {
                    name: 'screenshot',
                    mimeType: 'image/png',
                    data: shot.png,
                    widthPx: shot.widthPx,
                    heightPx: shot.heightPx,
                };
                result.screenshotWidthPx = shot.widthPx;
                result.screenshotHeightPx = shot.heightPx;
                // The LS needs the geometry with every screenshot to map points.
                result.geometry = (0, protobuf_1.create)(computer_payload_pb_1.ComputerGeometrySchema, (0, computerOps_1.toProtoGeometry)(shot.display ?? info.mainDisplay));
                (0, computerOps_1.setFocused)(result, shot.focused);
                if (shot.focused) {
                    this.setAppName(shot.focused.appName || shot.focused.appId);
                }
                result.browserPages = (0, computerOps_1.toProtoBrowserPages)(shot.browserPages);
                if (shot.windowOffDisplay && result.ok) {
                    fail('WINDOW_OFF_DISPLAY', (0, computerOps_1.truncateUtf8)(shot.windowOffDisplay, 1024));
                }
                captured = true;
            }
            catch (err) {
                captured = false;
                if (err instanceof driver_1.ComputerDriverError &&
                    err.code === 'USER_TAKEOVER') {
                    // The user took over during the capture: that wins over an earlier
                    // action error, and nothing of the desktop is read after it.
                    fail('USER_TAKEOVER', computerOps_1.ERR_TEXT.USER_TAKEOVER);
                    noScreenshot = true;
                }
                else if (result.ok) {
                    toFailure(err, 'screenshot');
                    if (err instanceof driver_1.ComputerDriverError &&
                        (err.code === 'PERMISSION_MISSING' || err.code === 'SCREEN_LOCKED')) {
                        noScreenshot = true;
                    }
                }
            }
        }
        // The SCREENSHOT actions' activity, with what the capture did (none if
        // it didn't run, or after a takeover, pause, stop or abandonment).
        if (captured !== undefined &&
            run &&
            !this.isPaused(run) &&
            !stopped() &&
            !this.isAbandoned(run) &&
            result.errorCode !== 'USER_TAKEOVER') {
            for (let i = 0; i < shotsRun; i++) {
                this.activity(run, {
                    kind: 'screenshot',
                    mode: 'foreground',
                    ok: captured,
                });
            }
        }
        // Never look at the desktop after a takeover, abandonment or stop: the
        // window in front may be the user's.
        if (foreground &&
            !script &&
            !noScreenshot &&
            !this.isPaused(run) &&
            !this.isAbandoned(run) &&
            !stopped() &&
            !result.focusedBundleId &&
            !result.focusedAppName) {
            try {
                const f = await this.driver.focused({ signal: run?.ctx.signal });
                (0, computerOps_1.setFocused)(result, f);
                if (f) {
                    this.setAppName(f.appName || f.appId);
                }
            }
            catch {
                // Best effort: the result stays without a focused app.
            }
        }
        if (this.isPaused(run) ||
            // A takeover the surface reported (not this agent's own stop).
            (result.errorCode === 'USER_TAKEOVER' && !stopped())) {
            // The pause's result wins over whatever the aborted primitive reported.
            if (this.isPaused(run) && result.errorCode !== this.pausedResult().code) {
                failPaused();
            }
            // No screenshot of what the user is doing now; that includes a window
            // capture or tree read just before the pause landed.
            delete out.blob;
            result.screenshotWidthPx = 0;
            result.screenshotHeightPx = 0;
            result.windowGeometry = undefined;
            result.axSnapshotText = '';
            result.focusedAppName = '';
            result.focusedBundleId = '';
            result.focusedPid = 0;
            result.focusedWindowTitle = '';
            result.browserPages = [];
        }
        else if (stopped()) {
            // This agent was stopped: its result says so, and shows nothing.
            if (result.errorCode !== this.agentFenceResult(run).code) {
                failStopped();
            }
            delete out.blob;
            result.screenshotWidthPx = 0;
            result.screenshotHeightPx = 0;
            result.windowGeometry = undefined;
            result.axSnapshotText = '';
            result.focusedAppName = '';
            result.focusedBundleId = '';
            result.focusedPid = 0;
            result.focusedWindowTitle = '';
            result.browserPages = [];
        }
        if (run &&
            !script &&
            !this.isPaused(run) &&
            !stopped() &&
            !this.isAbandoned(run) &&
            result.errorCode !== 'USER_TAKEOVER') {
            this.activity(run, {
                kind: 'done',
                mode: foreground ? 'foreground' : 'background',
                ok: result.ok,
            });
        }
        return out;
    }
    /**
     * Script mode (Zone B): runs ComputerRequest.script in its sandbox. Each
     * call the script makes is checked by a {@link ScriptRpcMediator} and run
     * as a one-action batch through {@link execute}, so batch mode's fences,
     * policy and confinement apply to every call (rt SM-1). A pause, a stop or
     * abandonment kills the script within SCRIPT_FENCE_POLL_MS (SM-4); every
     * outcome carries the ledger of the calls made (P0-3).
     */
    async executeScript(req, run) {
        const result = (0, protobuf_1.create)(computer_payload_pb_1.ComputerResultSchema, { ok: true });
        const out = { result };
        const fail = (code, text) => {
            result.ok = false;
            result.errorCode = code;
            result.error = (0, computerOps_1.truncateUtf8)(text, 4096);
        };
        const runner = this.opts.script;
        if (!runner || !this.scriptAvailable()) {
            fail('ACTION_FAILED', 'ACTION_FAILED: this AGY Hub does not run desktop scripts (supports_script is false)');
            return out;
        }
        if (req.actions.length > 0) {
            fail('ACTION_FAILED', 'ACTION_FAILED: a script request must not also carry actions');
            return out;
        }
        const bytes = Buffer.byteLength(req.script, 'utf8');
        if (bytes > scriptMediator_1.SCRIPT_LIMITS.maxSourceBytes) {
            fail('ACTION_FAILED', `ACTION_FAILED: the script is ${bytes} bytes (max ${scriptMediator_1.SCRIPT_LIMITS.maxSourceBytes})`);
            return out;
        }
        let info = await this.driver.describe({ signal: run?.ctx.signal });
        let infoAt = this.now();
        const level = this.level(info);
        if (level < computerOps_1.BACKGROUND_CONFINEMENT_VERSION) {
            void this.refreshHello();
            fail('CONFINEMENT_OUTDATED', `CONFINEMENT_OUTDATED: the AGY Hub desktop helper enforces app-confinement v${level}, but scripts require v${computerOps_1.BACKGROUND_CONFINEMENT_VERSION}; update the client (AGY Hub and its desktop helper), then retry. Report this to the parent agent.`);
            return out;
        }
        if (req.foreground && (0, computerOps_1.geometryChanged)(req, info.mainDisplay)) {
            fail('GEOMETRY_CHANGED', computerOps_1.ERR_TEXT.GEOMETRY_CHANGED);
            return out;
        }
        if (req.foreground && run && this.multi) {
            // A foreground script holds the pointer from its start (rt #1903 ii,
            // #1905), not from its first input: another agent can't take it
            // between two of its calls. serve() releases it. A paused/fenced
            // holder no longer counts, as for a batch.
            const holder = this.pointerHolder;
            if (holder &&
                holder !== run &&
                !this.isAbandoned(holder) &&
                !this.isPaused(holder) &&
                !this.isStopped(holder)) {
                fail('POINTER_BUSY', computerOps_1.ERR_TEXT.POINTER_BUSY);
                return out;
            }
            this.pointerHolder = run;
        }
        // A pause, stop or abandonment that landed during describe(): the
        // script never starts and the mode doesn't move.
        if (this.isPaused(run)) {
            const { code, text } = this.pausedResult();
            fail(code, text);
            return out;
        }
        if (this.isStopped(run)) {
            const { code, text } = this.agentFenceResult(run);
            fail(code, text);
            return out;
        }
        if (this.isAbandoned(run)) {
            fail('ACTION_FAILED', computerOps_1.ERR_TEXT.ABANDONED);
            return out;
        }
        // Accepted: the agent's mode (and takeover detection) follows it.
        this.followMode(req, run);
        // The display the script's pointer coordinates refer to: the LS's
        // expectation, then whatever the script's own screenshots showed.
        const geom = {
            displayId: req.expectedDisplayId,
            width: req.expectedWidthPoints,
            height: req.expectedHeightPoints,
        };
        /** Set once the runner settled: no sub-call starts after it. */
        let ended = false;
        const one = async (a, meta) => {
            // A TCC revoke, a confinement change or a display change shows within
            // seconds, not after the script's whole budget (rt P3-2).
            if (this.now() - infoAt > SCRIPT_DESCRIBE_TTL_MS) {
                info = await this.driver.describe({ signal: run?.ctx.signal });
                infoAt = this.now();
            }
            const sub = (0, protobuf_1.clone)(computer_payload_pb_1.ComputerRequestSchema, req);
            sub.script = '';
            sub.actions = [a];
            sub.captureAfter = false;
            sub.axSnapshotAfter = false;
            // No settle per call: one settle after the script, before its frame.
            sub.settleMs = 0;
            sub.expectedDisplayId = geom.displayId;
            sub.expectedWidthPoints = geom.width;
            sub.expectedHeightPoints = geom.height;
            const o = await this.execute(sub, run, {
                info,
                clickRef: meta?.clickRef,
                ended: () => ended,
            });
            const g = o.result.geometry;
            if (o.result.ok && a.type === computer_payload_pb_1.ComputerActionType.SCREENSHOT && g) {
                geom.displayId = g.displayId;
                geom.width = g.widthPoints;
                geom.height = g.heightPoints;
                // What the script saw is the display now: describe it again on the
                // next call, so pointer calls compare against it.
                infoAt = -Infinity;
            }
            return o;
        };
        let lastApp = '';
        /**
         * Input since the script's last screenshot: settle before the next
         * capture (the script's own or the final frame).
         */
        let inputSinceShot = false;
        const bg = (0, driver_1.supportsBackground)(this.driver) ? this.driver : undefined;
        const mediator = new scriptMediator_1.ScriptRpcMediator({
            allowedAppIds: req.allowedBundleIds,
            foreground: req.foreground,
            resolveApp: bg?.resolveApp ? (app) => bg.resolveApp(app) : undefined,
            exec: async (a, meta) => {
                const shot = a.type === computer_payload_pb_1.ComputerActionType.SCREENSHOT ||
                    a.type === computer_payload_pb_1.ComputerActionType.WINDOW_SCREENSHOT;
                if (shot && inputSinceShot && req.settleMs > 0) {
                    // A capture right after input shows the UI once it updated, as a
                    // batch's capture does (rt #1951 P3-7).
                    await this.interruptibleWait(Math.min(req.settleMs, computerOps_1.MAX_SETTLE_MS), run, () => ended);
                }
                const o = await one(a, meta);
                if (shot) {
                    inputSinceShot = false;
                }
                if (o.result.completedActions > 0 && isScriptInput(a)) {
                    inputSinceShot = true;
                }
                const app = o.result.results[0]?.resolvedBundleId;
                if (o.result.ok && app) {
                    lastApp = app;
                }
                return o;
            },
            now: () => this.now(),
            sleep: (ms) => this.sleep(ms),
        });
        // A pause, this agent's stop, or abandonment kills the script at once
        // (pushState -> abortFencedScripts); the poll is a backstop.
        const ac = new AbortController();
        const fenced = () => this.scriptFenced(run);
        this.scriptRuns.set(ac, run);
        const poll = setInterval(() => {
            if (fenced()) {
                ac.abort();
            }
        }, SCRIPT_FENCE_POLL_MS);
        const onAbandon = () => ac.abort();
        run?.ctx.signal.addEventListener('abort', onAbandon);
        // The time budget ends early enough for the end to fit before the LS
        // deadline (rt #1915 P2-3).
        const timeLeft = () => run?.deadlineMs ? run.deadlineMs - this.now() : Infinity;
        const timeoutMs = Math.min((0, computerOps_1.clamp)(this.opts.scriptTimeoutMs ?? SCRIPT_TIMEOUT_MS, 1000, MAX_SCRIPT_TIMEOUT_MS), timeLeft() - SCRIPT_END_RESERVE_MS);
        let outcome;
        try {
            if (timeoutMs < 1000) {
                throw new ScriptDeadlineError();
            }
            outcome = await runner.run(req.script, {
                timeoutMs,
                signal: ac.signal,
                onRpc: (method, params) => fenced()
                    ? Promise.resolve({
                        kill: { code: 'USER_STOP', message: computerOps_1.ERR_TEXT.USER_STOP },
                    })
                    : mediator.onRpc(method, params),
            });
        }
        catch (err) {
            outcome =
                err instanceof ScriptDeadlineError
                    ? {
                        ok: false,
                        code: 'SCRIPT_TIMEOUT',
                        message: 'SCRIPT_TIMEOUT: too little time was left before the request deadline to run the script; nothing ran',
                        killed: false,
                    }
                    : {
                        ok: false,
                        code: 'ACTION_FAILED',
                        message: `ACTION_FAILED: the script runner failed: ${String(err)}`,
                        killed: true,
                    };
        }
        finally {
            clearInterval(poll);
            run?.ctx.signal.removeEventListener('abort', onAbandon);
            this.scriptRuns.delete(ac);
        }
        // rt #1902 P1-1 / #1905: the runner may settle (its own kill: timeout,
        // protocol violation, memory, caps, crash) while a call is still
        // running. Nothing runs after this point, and a running call is stopped
        // through the agent's helper fence and awaited, so the ledger has it and
        // no action lands after the result.
        ended = true;
        mediator.close();
        let drained = true;
        if (mediator.busy()) {
            const selfFence = !fenced();
            if (selfFence) {
                this.fenceScript(run);
            }
            drained = await Promise.race([
                mediator.idle().then(() => true),
                this.sleep(SCRIPT_DRAIN_MS).then(() => false),
            ]);
            if (!drained) {
                // Listed as INTERRUPTED; the fence stays up, so whatever it was
                // doing can't act, and the agent's next request lifts it once the
                // primitive returned (serve -> clearAbort).
                mediator.abandonInflight();
                this.log(`[ComputerActuator] a script call did not return within ${SCRIPT_DRAIN_MS} ms of the script's end`);
            }
            else if (selfFence && !fenced()) {
                await this.unfenceScript(run);
            }
        }
        result.completedOps = mediator.completedOps();
        result.totalCompletedOps = mediator.totalOps();
        // The fence wins over whatever the killed script reported.
        if (this.isPaused(run)) {
            const { code, text } = this.pausedResult();
            fail(code, text);
        }
        else if (this.isStopped(run)) {
            const { code, text } = this.agentFenceResult(run);
            fail(code, text);
        }
        else if (this.isAbandoned(run)) {
            fail('ACTION_FAILED', computerOps_1.ERR_TEXT.ABANDONED);
        }
        else if (outcome.ok) {
            const n = Buffer.byteLength(outcome.valueJson, 'utf8');
            if (n > scriptMediator_1.SCRIPT_LIMITS.maxValueBytes) {
                fail('SCRIPT_ERROR', `SCRIPT_ERROR: the return value is ${n} bytes as JSON (max ${scriptMediator_1.SCRIPT_LIMITS.maxValueBytes}); return less`);
            }
            else {
                result.scriptValueJson = outcome.valueJson;
            }
        }
        else {
            const stack = outcome.stack
                ? `\n${(0, computerOps_1.truncateUtf8)(outcome.stack, 2048)}`
                : '';
            fail(outcome.code, `${outcome.message}${stack}`);
        }
        // The final frame (blob 0): never after a human, lock or policy fence.
        const showFrame = drained &&
            !(result.errorCode && SCRIPT_NO_FRAME.has(result.errorCode)) &&
            !this.isPaused(run) &&
            !this.isStopped(run) &&
            !this.isAbandoned(run);
        const T = computer_payload_pb_1.ComputerActionType;
        if (showFrame) {
            let frame;
            ended = false; // the host's own final calls (not the script's)
            const wantsFrame = req.captureAfter || req.axSnapshotAfter;
            const settle = Math.min(req.settleMs, computerOps_1.MAX_SETTLE_MS);
            if (wantsFrame &&
                inputSinceShot &&
                settle > 0 &&
                timeLeft() - settle >= SCRIPT_SNAPSHOT_MIN_MS) {
                // Like a batch: let the UI settle once after the script's input.
                await this.interruptibleWait(settle, run);
            }
            if (timeLeft() < SCRIPT_FRAME_MIN_MS) {
                // The result goes out without a frame rather than after the LS
                // stopped waiting.
            }
            else if (req.foreground && req.captureAfter) {
                frame = await one((0, protobuf_1.create)(computer_payload_pb_1.ComputerActionSchema, { type: T.SCREENSHOT }));
            }
            else if (req.captureAfter &&
                lastApp &&
                (0, driver_1.supportsBackground)(this.driver)) {
                // Only when asked for: a background script shows what it chose to
                // capture (windowScreenshot) and its AX snapshot after.
                frame = await one((0, protobuf_1.create)(computer_payload_pb_1.ComputerActionSchema, {
                    type: T.WINDOW_SCREENSHOT,
                    app: lastApp,
                }));
            }
            if (frame?.result.ok && frame.blob) {
                const f = frame.result;
                out.blob = frame.blob;
                result.screenshotWidthPx = f.screenshotWidthPx;
                result.screenshotHeightPx = f.screenshotHeightPx;
                result.geometry = f.geometry;
                result.windowGeometry = f.windowGeometry;
                result.browserPages = f.browserPages;
                result.focusedAppName = f.focusedAppName;
                result.focusedBundleId = f.focusedBundleId;
                result.focusedPid = f.focusedPid;
                result.focusedWindowTitle = f.focusedWindowTitle;
            }
            if (req.axSnapshotAfter &&
                lastApp &&
                (0, driver_1.supportsBackground)(this.driver) &&
                timeLeft() >= SCRIPT_SNAPSHOT_MIN_MS) {
                const snap = await one((0, protobuf_1.create)(computer_payload_pb_1.ComputerActionSchema, { type: T.AX_SNAPSHOT, app: lastApp }));
                if (snap.result.ok) {
                    result.axSnapshotText = snap.result.axSnapshotText;
                }
            }
            this.attachScriptScreenshots(out, mediator);
        }
        if (run && !this.isPaused(run) && !this.isStopped(run)) {
            this.activity(run, {
                kind: 'done',
                mode: req.foreground ? 'foreground' : 'background',
                ok: result.ok,
            });
        }
        return out;
    }
    /** The helper fence for `run`'s agent (all agents on a single surface). */
    fenceScript(run) {
        if (run && this.multi) {
            this.driver.abort({ actorId: run.actor.id });
        }
        else {
            this.driver.abort();
        }
    }
    /** Lifts {@link fenceScript} once the cut-short primitive returned. */
    async unfenceScript(run) {
        await (run && this.multi
            ? this.driver.clearAbort({ actorId: run.actor.id })
            : this.driver.clearAbort());
    }
    /**
     * The script's screenshots as extra blobs, within the LS's Fulfill size
     * (the oldest are dropped first, never the result). With a final frame
     * (blob 0, screenshot_width/height set) they are blobs 1..n; without one
     * they start at blob 0 and the result has no screenshot dimensions or
     * window geometry (the S4-1 wire rule).
     */
    attachScriptScreenshots(out, mediator) {
        const shots = [...mediator.screenshots];
        const result = out.result;
        const first = out.blob ? 1 : 0;
        if (!out.blob) {
            result.screenshotWidthPx = 0;
            result.screenshotHeightPx = 0;
            result.windowGeometry = undefined;
        }
        const cap = this.maxFulfillBytes || MAX_FULFILL_FALLBACK_BYTES;
        // The entries count toward the size too: they are in the result.
        const entries = () => shots.map((x, i) => (0, protobuf_1.create)(computer_payload_pb_1.ComputerNamedScreenshotSchema, {
            name: (0, computerOps_1.truncateUtf8)(x.name, 64),
            blobIndex: first + i,
            widthPx: x.blob.widthPx ?? 0,
            heightPx: x.blob.heightPx ?? 0,
            // The LS caps an app id at 255 UTF-8 bytes.
            appId: (0, computerOps_1.truncateUtf8)(x.appId, MAX_SCRIPT_SHOT_APP_ID_BYTES),
        }));
        const size = () => {
            result.extraScreenshots = entries();
            return ((0, protobuf_1.toBinary)(computer_payload_pb_1.ComputerResultSchema, result).length +
                [...(out.blob ? [out.blob] : []), ...shots.map((x) => x.blob)].reduce((n, b) => n + b.data.length + 256, 0));
        };
        while (shots.length > 0 && size() > cap) {
            shots.shift();
        }
        result.extraScreenshots = entries();
        out.extraBlobs = shots.map((x, i) => ({
            ...x.blob,
            name: `script_screenshot_${i + 1}`,
        }));
    }
    /**
     * Moves the agent's sticky mode with an accepted batch: foreground with a
     * foreground action, background with a background-only batch.
     */
    followMode(req, run) {
        const id = run?.actor.id ?? '';
        if ((0, computerOps_1.isForegroundBatch)(req)) {
            this.foregroundActors.add(id);
        }
        else if ((0, computerOps_1.hasBackgroundAction)(req)) {
            this.foregroundActors.delete(id);
        }
        this.syncArm();
        this.pushState();
    }
    /** Adds `run`'s agent to the host state if it isn't there yet. */
    noteAgent(run, req) {
        const id = run.actor.id;
        if (this.agents.has(id)) {
            return;
        }
        this.agents.set(id, {
            actor: run.actor,
            rootConversationId: run.rootConversationId,
            mode: (0, computerOps_1.isForegroundBatch)(req) ? 'foreground' : 'background',
            appName: '',
            lastActivityMs: this.now(),
            stopped: false,
            paused: false,
        });
        this.pushState();
    }
    /**
     * Forgets the agents' rows when every lease is gone (stream lost,
     * disabled), except taken-over agents': they stay for the hand back and
     * go with it or a Stop.
     */
    forgetAgentRows() {
        for (const id of this.agentAndPausedIds()) {
            if (this.pausedActors.has(id)) {
                this.leaseEndedWhilePaused.add(id);
            }
            else {
                this.agents.delete(id);
            }
        }
    }
    /** The ids of the agents with a row and of the taken-over agents. */
    agentAndPausedIds() {
        return [...new Set([...this.agents.keys(), ...this.pausedActors.keys()])];
    }
    /**
     * Records an agent's activity in the host state and reports it. A host
     * callback that throws never affects the batch.
     */
    activity(run, e) {
        const prev = this.agents.get(run.actor.id);
        // The agent's own app: the one its latest successful action reached,
        // by display name once some agent bound it.
        let appName = prev?.appName ?? '';
        if (e.ok && e.appId) {
            if (e.kind === 'bind_app') {
                this.appNames.delete(e.appId);
                this.appNames.set(e.appId, this.appName);
                for (const old of this.appNames.keys()) {
                    if (this.appNames.size <= MAX_KNOWN_CASCADES) {
                        break;
                    }
                    this.appNames.delete(old);
                }
            }
            appName = (0, computerOps_1.truncateUtf8)(this.appNames.get(e.appId) || e.appId, MAX_APP_NAME_BYTES);
        }
        this.agents.set(run.actor.id, {
            actor: run.actor,
            rootConversationId: run.rootConversationId,
            // The end of a batch and a WAIT are mode-neutral.
            mode: e.kind === 'done' || e.kind === 'wait'
                ? (prev?.mode ?? e.mode)
                : e.mode,
            appName,
            lastActivityMs: this.now(),
            stopped: false,
            paused: false,
        });
        this.pushState();
        try {
            this.opts.onAgentActivity?.({
                ...e,
                actor: { ...run.actor },
                rootConversationId: run.rootConversationId,
            });
        }
        catch (err) {
            this.log(`[ComputerActuator] onAgentActivity failed: ${String(err)}`);
        }
    }
    setAppName(name) {
        const n = (0, computerOps_1.truncateUtf8)(name, MAX_APP_NAME_BYTES);
        if (n !== this.appName) {
            this.appName = n;
            this.pushState();
        }
    }
    async interruptibleWait(ms, run, ended) {
        const step = 100;
        for (let t = 0; t < ms &&
            !this.isPaused(run) &&
            !this.isAbandoned(run) &&
            !this.isStopped(run) &&
            !ended?.(); t += step) {
            await this.sleep(Math.min(step, ms - t));
        }
    }
}
exports.ComputerActuatorHandler = ComputerActuatorHandler;
/** Whether a script call's action can change the UI (input or AX action). */
function isScriptInput(a) {
    switch (a.type) {
        case computer_payload_pb_1.ComputerActionType.SCREENSHOT:
        case computer_payload_pb_1.ComputerActionType.WAIT:
        case computer_payload_pb_1.ComputerActionType.AX_SNAPSHOT:
        case computer_payload_pb_1.ComputerActionType.WINDOW_SCREENSHOT:
        case computer_payload_pb_1.ComputerActionType.BIND_APP:
            return false;
        default:
            return true;
    }
}
/** A script request arrived too close to its deadline to run. */
class ScriptDeadlineError extends Error {
}
/** AX element actions: the ones a visual hint may come with. */
function isElementAction(a) {
    return (a.type === computer_payload_pb_1.ComputerActionType.AX_PRESS ||
        a.type === computer_payload_pb_1.ComputerActionType.AX_SELECT ||
        a.type === computer_payload_pb_1.ComputerActionType.AX_SET_VALUE ||
        a.type === computer_payload_pb_1.ComputerActionType.AX_SCROLL);
}
function clamp01(n) {
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}
/**
 * Where an agent's visual hint puts the indicator (display only): the point
 * at (u, v) of the window frame at action time (clamped to the window), and
 * the element's AX frame size re-centred there and kept inside the window
 * (no bounds when the surface didn't report the element's frame). Undefined
 * without a hint or a window frame.
 */
function hintedPlacement(hint, win, ax) {
    if (!hint || !win || !(win.width > 0) || !(win.height > 0)) {
        return undefined;
    }
    const x = win.x + clamp01(hint.u) * win.width;
    const y = win.y + clamp01(hint.v) * win.height;
    if (!ax) {
        return { point: { x, y } };
    }
    const w = Math.min(Math.max(ax.width, 0), win.width);
    const h = Math.min(Math.max(ax.height, 0), win.height);
    const bx = Math.min(Math.max(x - w / 2, win.x), win.x + win.width - w);
    const by = Math.min(Math.max(y - h / 2, win.y), win.y + win.height - h);
    return { point: { x, y }, bounds: { x: bx, y: by, width: w, height: h } };
}
/** The agent of a request: its cascade, labelled by the LS's actor_label. */
function actorOf(req) {
    const id = req.cascadeId || req.rootConversationId || req.requestId;
    const actor = { id, colorIndex: (0, computerOps_1.agentColorIndex)(id) };
    // Display only: no control or format characters (bidi overrides,
    // zero-width), so a label can't spoof other text in a host's HUD.
    const label = (0, computerOps_1.truncateUtf8)((req.payload.actorLabel ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim(), computerOps_1.MAX_ACTOR_LABEL_BYTES);
    if (label) {
        actor.label = label;
    }
    return actor;
}
