"use strict";
/**
 * @fileoverview `ActuatorClient`: the one TypeScript client of the Language
 * Server's `ActuatorService` (actuator contract §4). It holds one Subscribe
 * stream per registered actuator type, pairs every `ActuatorRequest` with
 * exactly one Fulfill, and replays actuator status after every resubscribe.
 *
 * Platform-free: the transport is injected, so the same code runs in the Hub
 * renderer (connect-web), the Jetski Web tab and the Hub main process
 * (connect-node). deps_test.ts enforces the import allowlist.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActuatorClient = exports.ACTUATOR_PROTOCOL_VERSION = void 0;
const protobuf_1 = require("@bufbuild/protobuf"); // from //third_party/javascript/bufbuild_protobuf
const wkt_1 = require("@bufbuild/protobuf/wkt"); // from //third_party/javascript/bufbuild_protobuf
const connect_1 = require("@connectrpc/connect"); // from //third_party/javascript/connectrpc_connect
const actuator_pb_1 = require("../../proto/actuator_pb"); // from //third_party/jetski/actuator_pb:actuator_ts_proto
const backoff_1 = require("./backoff");
const limits_1 = require("./limits");
/** Envelope version this SDK speaks (`SubscribeRequest.protocol_version`). */
exports.ACTUATOR_PROTOCOL_VERSION = 1;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45000;
const DEFAULT_UPDATE_DEBOUNCE_MS = 250;
/**
 * How long an undelivered outcome is kept to answer a redispatch of the same
 * id.
 */
const FULFILLED_CACHE_TTL_MS = 30000;
const FULFILLED_CACHE_MAX = 64;
/** Delivery deadline for a request the LS sent without one. */
const MISSING_DEADLINE_MS = 120000;
/** How long past its deadline an unfulfilled request is still tracked. */
const UNFULFILLED_RETENTION_MS = 30000;
/** Per-call timeout of a Fulfill RPC (delivery retries until the deadline). */
const FULFILL_RPC_TIMEOUT_MS = 30000;
/** Per-call timeout of Update and ReportStatus RPCs. */
const CONTROL_RPC_TIMEOUT_MS = 10000;
/** Per-call timeout of a replayed ReportStatus (it must not block live ones). */
const REPLAY_RPC_TIMEOUT_MS = 3000;
/** `SubscribeRequest.initial_pauses` cap (§1.4). */
const MAX_INITIAL_PAUSES = 256;
/** How long shutdown waits for a pending SubscribeAck to send GOING_AWAY. */
const SHUTDOWN_ACK_WAIT_MS = 2000;
const PREFIX = '[ActuatorClient]';
const CONSOLE_LOGGER = {
    debug: (message, ...args) => {
        console.debug(`${PREFIX} ${message}`, ...args);
    },
    info: (message, ...args) => {
        console.info(`${PREFIX} ${message}`, ...args);
    },
    warn: (message, ...args) => {
        console.warn(`${PREFIX} ${message}`, ...args);
    },
    error: (message, ...args) => {
        console.error(`${PREFIX} ${message}`, ...args);
    },
};
/**
 * Milliseconds on a clock that never steps back within this page or process
 * (`performance.timeOrigin + performance.now()`), so the LS can order one
 * client instance's reports even if the wall clock moves.
 */
function monotonicNowMs() {
    const perf = globalThis.performance;
    if (perf && typeof perf.now === 'function' && perf.timeOrigin > 0) {
        return Math.floor(perf.timeOrigin + perf.now());
    }
    return Date.now();
}
/** A random UUID (v4) identifying one ActuatorClient lifetime. */
function newInstanceId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) {
        return uuid;
    }
    const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Throws unless `value` fits `SubscribeRequest`'s 64-byte client fields. */
function validateClientField(field, value) {
    const bytes = (0, limits_1.utf8Length)(value);
    if (bytes > limits_1.ENVELOPE_LIMITS.maxClientFieldBytes) {
        throw new limits_1.ActuatorLimitError(`${field} is ${bytes} bytes; the limit is ${limits_1.ENVELOPE_LIMITS.maxClientFieldBytes}`);
    }
}
function errorMessage(e) {
    return e instanceof Error ? e.message : String(e);
}
/** Packs `value` (a message of `schema`) into an Any. */
function pack(schema, value) {
    return (0, wkt_1.anyPack)(schema, value);
}
/**
 * The request's delivery deadline on this client's clock. `skewMs` is the LS
 * clock minus this client's (from `SubscribeAck.server_time_unix_ms`), so an
 * LS deadline converts to `deadline - skewMs`.
 */
function effectiveDeadlineMs(req, skewMs = 0) {
    const deadline = Number(req.deadlineUnixMs);
    return deadline > 0 ? deadline - skewMs : Date.now() + MISSING_DEADLINE_MS;
}
function errorOutcome(code, message) {
    return { case: 'error', value: (0, protobuf_1.create)(actuator_pb_1.ActuatorErrorSchema, { code, message }) };
}
/** HEALTHY/DEGRADED and the user-control statuses are replayed independently. */
function statusDimension(status) {
    switch (status) {
        case actuator_pb_1.ActuatorStatus.HEALTHY:
        case actuator_pb_1.ActuatorStatus.DEGRADED:
            return 'health';
        case actuator_pb_1.ActuatorStatus.USER_TAKEOVER:
        case actuator_pb_1.ActuatorStatus.USER_STOP:
        case actuator_pb_1.ActuatorStatus.USER_RESUME:
            return 'control';
        default:
            return undefined;
    }
}
function isPauseStatus(status) {
    return (status === actuator_pb_1.ActuatorStatus.USER_TAKEOVER ||
        status === actuator_pb_1.ActuatorStatus.USER_STOP);
}
/** One in-flight request: the handler's `RequestContext`. */
class RequestEntry {
    constructor(requestId, sessionToken, deadlineMs, sender) {
        this.requestId = requestId;
        this.sessionToken = sessionToken;
        this.deadlineMs = deadlineMs;
        this.sender = sender;
        this.settled = false;
        this.abandonedFlag = false;
        this.controller = new AbortController();
        this.timers = [];
        const remaining = Math.max(0, deadlineMs - Date.now());
        this.timers.push(setTimeout(() => {
            this.abandon('request deadline exceeded');
        }, remaining), setTimeout(() => {
            if (!this.settled) {
                this.sender.expire(this);
            }
        }, remaining + UNFULFILLED_RETENTION_MS));
    }
    get isSettled() {
        return this.settled;
    }
    get abandoned() {
        return this.abandonedFlag;
    }
    get signal() {
        return this.controller.signal;
    }
    fulfill(result, blobs = []) {
        this.claim();
        return this.sender.result(this, result, blobs);
    }
    fail(code, message) {
        this.claim();
        return this.sender.error(this, code, message);
    }
    /** The request was resent on a newer stream; replies go out on its token. */
    markRedispatched(sessionToken) {
        this.sessionToken = sessionToken;
    }
    /**
     * Gives up on the run: past the deadline, stop(), or ACTUATOR_REPLACED.
     * Sets `abandoned` and aborts `signal` together; a later fulfill still goes out.
     * A settled request is never abandoned.
     */
    abandon(reason) {
        if (this.abandonedFlag || this.settled) {
            return;
        }
        this.abandonedFlag = true;
        this.controller.abort(new Error(reason));
    }
    dispose() {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
    }
    claim() {
        if (this.settled) {
            throw new Error(`request ${this.requestId} was already fulfilled`);
        }
        this.settled = true;
        this.dispose();
    }
}
/**
 * One actuator type on one ActuatorClient: its stream loop, requests and
 * status.
 */
class Registration {
    constructor(host, handler) {
        this.host = host;
        this.handler = handler;
        this.stateValue = 'stopped';
        this.active = false;
        this.unsubscribed = false;
        this.looping = false;
        /** start()/resubscribe() arrived while the old loop was exiting. */
        this.restartLoop = false;
        /** Bumped on start(), resubscribe() and shutdown() to fence stale shutdowns. */
        this.generation = 0;
        this.shuttingDown = false;
        /** A Subscribe RPC is open and its ack hasn't arrived. */
        this.awaitingAck = false;
        this.ackWaiters = [];
        /** Pending ReportStatus calls, sent one at a time (see sendStatus). */
        this.statusJobs = [];
        this.statusPumping = false;
        this.forceReconnect = false;
        this.sessionToken = '';
        /** LS clock minus this client's, from the latest SubscribeAck (0 if unsent). */
        this.clockSkewMs = 0;
        this.pauses = [];
        this.loggedUnimplemented = false;
        /** Latest report per (dimension, scope), in send order. */
        this.statuses = new Map();
        /**
         * Set once >256 active pauses collapse fail-closed into one whole-actuator
         * pause (root ""). A scoped USER_RESUME cannot lift a collapsed pause; only a
         * global USER_RESUME("") clears it.
         */
        this.collapsedPause = false;
        this.lastObservedMs = 0;
        this.updateSeq = 0;
        this.latestHelloSeq = 0;
        this.latestConvSeq = 0;
        this.inFlight = new Map();
        /**
         * Outcomes whose Fulfill was not delivered (rejected, expired or stopped),
         * kept with their blobs for a redispatch after a reconnect. The LS never
         * redispatches a delivered Fulfill, so delivered outcomes are not kept.
         */
        this.fulfilled = new Map();
        this.backoff = new backoff_1.Backoff(host.opts.backoff, host.opts.random);
        this.sender = {
            result: (entry, result, blobs) => this.settle(entry, () => ({
                case: 'payload',
                value: pack(this.handler.schemas.result, result),
            }), blobs),
            error: (entry, code, message) => this.settle(entry, () => errorOutcome(code, message), []),
            expire: (entry) => {
                if (this.inFlight.get(entry.requestId) === entry) {
                    this.inFlight.delete(entry.requestId);
                    entry.dispose();
                    this.host.logger.warn(`${this.label()} request ${entry.requestId} was never fulfilled`);
                }
            },
        };
    }
    get actuatorType() {
        return this.handler.actuatorType;
    }
    get actuatorId() {
        return this.handler.actuatorId;
    }
    get state() {
        return this.stateValue;
    }
    get activePauses() {
        return this.pauses;
    }
    // ---------------------------------------------------------------------------
    // Lifecycle
    start() {
        if (this.unsubscribed || !this.host.running) {
            return;
        }
        if (!this.active) {
            this.active = true;
            this.generation++;
            this.shutdownPromise = undefined;
            this.streamAbort?.abort();
            this.wake?.abort();
            this.releaseAckWaiters();
        }
        this.ensureLoop();
    }
    resubscribe() {
        if (this.unsubscribed) {
            // Revive after unsubscribe() (the kill switch clearing, contract v1.19):
            // same handler, actuator_id and client instance; the new Subscribe
            // carries the latest fences as initial_pauses.
            if (!this.host.add(this)) {
                this.host.logger.warn(`${this.label()} was registered again; not reviving this registration`);
                return;
            }
            this.unsubscribed = false;
            this.generation++;
            this.shutdownPromise = undefined;
        }
        if (!this.host.running) {
            return;
        }
        this.backoff.reset();
        if (!this.active) {
            this.start();
            return;
        }
        this.forceReconnect = true;
        this.streamAbort?.abort();
        this.wake?.abort();
    }
    async unsubscribe() {
        if (this.unsubscribed) {
            await this.shutdownPromise;
            return;
        }
        this.unsubscribed = true;
        this.host.remove(this);
        this.dropFulfilled();
        await this.shutdown();
    }
    shutdown() {
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }
        this.active = false;
        this.shuttingDown = true;
        const gen = ++this.generation;
        const promise = this.doShutdown(gen).finally(() => {
            if (this.shutdownPromise === promise) {
                this.shutdownPromise = undefined;
            }
        });
        this.shutdownPromise = promise;
        return promise;
    }
    async doShutdown(gen) {
        if (!this.sessionToken && this.awaitingAck) {
            // The LS may already hold this stream; wait briefly for its ack so
            // GOING_AWAY can skip the reconnect grace.
            await Promise.race([
                new Promise((resolve) => {
                    this.ackWaiters.push(resolve);
                }),
                (0, backoff_1.sleep)(SHUTDOWN_ACK_WAIT_MS),
            ]);
            if (this.generation !== gen) {
                return;
            }
        }
        if (this.sessionToken) {
            await this.sendStatus(this.toReport({ status: actuator_pb_1.ActuatorStatus.GOING_AWAY }), 
            /* replay= */ false, this.sessionToken);
            if (this.generation !== gen) {
                return;
            }
        }
        this.streamAbort?.abort();
        this.wake?.abort();
        this.stateValue = 'stopped';
        this.resolveAllWaiters();
    }
    abortRequests(reason) {
        for (const entry of this.inFlight.values()) {
            entry.abandon(reason);
            entry.dispose();
        }
        this.inFlight.clear();
    }
    ensureLoop() {
        if (this.looping) {
            this.restartLoop = true;
            return;
        }
        this.looping = true;
        this.restartLoop = false;
        void this.runLoop().finally(() => {
            this.looping = false;
            if (this.restartLoop && this.active && this.host.running) {
                this.ensureLoop();
                return;
            }
            if (!this.active) {
                this.stateValue = 'stopped';
            }
        });
    }
    async runLoop() {
        while (this.active && this.host.running) {
            this.restartLoop = false;
            const next = await this.runStreamOnce();
            if (next === 'inactive' || !this.active || !this.host.running) {
                return;
            }
            if (next === 'immediate') {
                continue;
            }
            if (next.action === 'stop') {
                // Another client owns the actuator now; its requests are not ours.
                this.abortRequests(next.reason);
                if (this.forceReconnect) {
                    this.backoff.reset();
                    continue;
                }
                this.host.logger.warn(`${this.label()} stream ended with ${next.reason}; not reconnecting`);
                this.active = false;
                this.rejectAllWaiters(next.reason);
                return;
            }
            if (this.forceReconnect) {
                // resubscribe() ran while this stream was ending (e.g. from onStreamLost).
                this.backoff.reset();
                continue;
            }
            this.stateValue = next.state;
            if (next.state === 'unimplemented') {
                this.rejectAllWaiters(next.reason);
                if (!this.loggedUnimplemented) {
                    this.loggedUnimplemented = true;
                    this.host.logger.warn(`${this.label()} the language server has no ActuatorService; retrying every ${next.delayMs} ms`);
                }
            }
            else {
                this.host.logger.info(`${this.label()} stream lost (${next.reason}); reconnecting in ${next.delayMs} ms`);
            }
            this.callHandler('onSubscribeFailed', () => {
                this.handler.onSubscribeFailed?.({
                    reason: next.reason,
                    state: next.state,
                    acked: next.acked,
                });
            });
            if (!this.active || !this.host.running || this.forceReconnect) {
                continue;
            }
            const wake = new AbortController();
            this.wake = wake;
            await (0, backoff_1.sleep)(next.delayMs, wake.signal);
            if (this.wake === wake) {
                this.wake = undefined;
            }
        }
    }
    /** Runs one Subscribe stream to its end and says what to do next. */
    async runStreamOnce() {
        this.forceReconnect = false;
        this.shuttingDown = false;
        const abort = new AbortController();
        this.streamAbort = abort;
        this.stateValue = 'connecting';
        let heartbeatLost = false;
        let watchdog;
        const arm = () => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => {
                heartbeatLost = true;
                abort.abort();
            }, this.host.opts.heartbeatTimeoutMs);
        };
        let acked = false;
        let error = undefined;
        try {
            const hello = await this.helloOrFail(abort.signal);
            if (abort.signal.aborted || !this.active) {
                throw new connect_1.ConnectError('aborted before subscribe', connect_1.Code.Canceled);
            }
            const req = this.buildSubscribeRequest(hello);
            arm();
            const stream = this.host.rpc().subscribe(req, { signal: abort.signal });
            this.awaitingAck = true;
            for await (const msg of stream) {
                arm();
                const m = msg.message;
                switch (m.case) {
                    case 'ack':
                        acked = true;
                        this.awaitingAck = false;
                        this.onAck(m.value);
                        break;
                    case 'request':
                        if (acked) {
                            this.onRequest(m.value);
                        }
                        else {
                            this.host.logger.warn(`${this.label()} request before SubscribeAck ignored`);
                        }
                        break;
                    case 'notice':
                        this.onNotice(m.value);
                        break;
                    default:
                        break;
                }
            }
        }
        catch (e) {
            error = e;
        }
        finally {
            clearTimeout(watchdog);
            if (this.streamAbort === abort) {
                this.streamAbort = undefined;
            }
            if (this.carried) {
                const carried = this.carried;
                this.carried = undefined;
                this.requeue(carried, /* schedule= */ false);
            }
            this.awaitingAck = false;
            this.releaseAckWaiters();
        }
        this.sessionToken = '';
        if (!this.active) {
            return 'inactive';
        }
        if (this.shuttingDown) {
            return 'immediate';
        }
        const forced = this.forceReconnect;
        let reason;
        if (forced) {
            reason = 'resubscribe';
        }
        else if (heartbeatLost) {
            reason = `no message for ${this.host.opts.heartbeatTimeoutMs} ms`;
        }
        else if (error === undefined) {
            reason = 'stream closed by server';
        }
        else {
            reason = errorMessage(error);
        }
        if (acked) {
            this.callHandler('onStreamLost', () => {
                this.handler.onStreamLost?.(reason);
            });
        }
        if (forced) {
            return 'immediate';
        }
        this.host.invalidateTransport();
        if (heartbeatLost) {
            return {
                action: 'retry',
                state: 'backoff',
                delayMs: this.backoff.next(),
                reason,
                acked,
            };
        }
        if (error instanceof limits_1.ActuatorLimitError) {
            this.host.logger.error(`${this.label()} cannot subscribe: ${reason}`);
            return {
                action: 'retry',
                state: 'backoff',
                delayMs: this.backoff.next(),
                reason,
                acked,
            };
        }
        return {
            ...(0, backoff_1.decideReconnect)(error, {
                backoff: this.backoff,
                unimplementedRetryMs: this.host.opts.unimplementedRetryMs,
                typeUnavailableRetryMs: this.host.opts.typeUnavailableRetryMs,
            }),
            acked,
        };
    }
    /**
     * The handler's Hello for a Subscribe. A hello() that doesn't settle within
     * the heartbeat timeout fails the attempt with DEADLINE_EXCEEDED (which
     * backs off and retries), and an abort of the attempt (stop(),
     * resubscribe(), shutdown) fails it at once, so a hung handler never keeps
     * the registration in 'connecting'.
     */
    helloOrFail(signal) {
        const timeoutMs = this.host.opts.heartbeatTimeoutMs;
        return new Promise((resolve, reject) => {
            let timer;
            const onAbort = () => {
                done();
                reject(new connect_1.ConnectError('aborted before subscribe', connect_1.Code.Canceled));
            };
            const done = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
            };
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => {
                done();
                reject(new connect_1.ConnectError(`handler hello() did not settle within ${timeoutMs} ms`, connect_1.Code.DeadlineExceeded));
            }, timeoutMs);
            Promise.resolve()
                .then(() => this.handler.hello())
                .then((hello) => {
                done();
                resolve(hello);
            }, (e) => {
                done();
                reject(e);
            });
        });
    }
    buildSubscribeRequest(h) {
        const pending = this.pending;
        const hello = pending?.hello !== undefined ? pending.hello : h.hello;
        const conversationIds = pending?.conversationIds !== undefined
            ? pending.conversationIds
            : h.conversationIds;
        const helloAny = pack(this.handler.schemas.hello, hello);
        (0, limits_1.checkHelloBytes)(helloAny.value.length, this.limits);
        if (pending) {
            clearTimeout(pending.timer);
            this.pending = undefined;
            this.carried = pending;
        }
        const clamped = this.clampIds(conversationIds);
        // A health report made through reportStatus() is newer than the Hello's
        // default, so it wins.
        let initialStatus = this.statuses.get('health\0');
        if (!initialStatus &&
            h.initialStatus &&
            statusDimension(h.initialStatus.status) === 'health') {
            initialStatus = this.toReport(h.initialStatus);
        }
        this.initialSent = initialStatus;
        // Fences this actuator set that the LS may not know (made while the stream
        // was down, or lost by an LS restart); applied atomically in Subscribe.
        const initialPauses = [...this.statuses.values()]
            .filter((r) => isPauseStatus(r.status))
            .slice(-MAX_INITIAL_PAUSES);
        return (0, protobuf_1.create)(actuator_pb_1.SubscribeRequestSchema, {
            protocolVersion: exports.ACTUATOR_PROTOCOL_VERSION,
            actuatorType: this.handler.actuatorType,
            actuatorId: this.handler.actuatorId,
            actuatorTypeVersion: this.handler.actuatorTypeVersion,
            hello: helloAny,
            conversationIds: clamped,
            initialStatus,
            clientName: this.host.opts.clientName,
            clientVersion: this.host.opts.clientVersion,
            clientInstanceId: this.host.clientInstanceId,
            initialPauses,
        });
    }
    onAck(ack) {
        this.sessionToken = ack.sessionToken;
        const serverNowMs = Number(ack.serverTimeUnixMs);
        this.clockSkewMs = serverNowMs > 0 ? serverNowMs - Date.now() : 0;
        if (ack.limits) {
            this.limits = ack.limits;
        }
        this.pauses = ack.activePauses;
        this.stateValue = 'subscribed';
        this.backoff.reset();
        if (!ack.actuatorTypeCompatible) {
            this.host.logger.warn(`${this.label()} actuator_type_version ${this.handler.actuatorTypeVersion} is outside the LS range ${ack.actuatorTypeVersionMin}..${ack.actuatorTypeVersionMax}`);
        }
        const carried = this.carried;
        this.carried = undefined;
        if (carried) {
            for (const waiter of carried.waiters) {
                waiter.resolve();
            }
        }
        this.releaseAckWaiters();
        // The same set replayStatuses() sends.
        const replaying = [...this.statuses.values()].filter((r) => r !== this.initialSent);
        this.callHandler('onSubscribed', () => {
            this.handler.onSubscribed?.(ack, replaying);
        });
        void this.replayStatuses(ack.sessionToken);
        if (this.pending) {
            this.scheduleUpdate();
        }
    }
    // ---------------------------------------------------------------------------
    // Requests and Fulfill
    onRequest(req) {
        const token = this.sessionToken;
        const id = req.requestId;
        const running = this.inFlight.get(id);
        if (running) {
            running.markRedispatched(token);
            this.host.logger.debug(`${this.label()} redispatch of running request ${id} (attempt ${req.attempt}); not re-run`);
            return;
        }
        this.pruneFulfilled();
        const cached = this.fulfilled.get(id);
        if (cached) {
            this.host.logger.debug(`${this.label()} redispatch of fulfilled request ${id}; re-sending its outcome`);
            // Read the live token: a retry after a reconnect goes out on the new
            // stream's session, while keeping the last known token across the gap
            // before the next SubscribeAck arrives.
            let lastToken = token;
            void this.deliver({
                token: () => {
                    if (this.sessionToken) {
                        lastToken = this.sessionToken;
                    }
                    return lastToken;
                },
                deadlineMs: effectiveDeadlineMs(req, this.clockSkewMs),
            }, cached.request).then((result) => {
                // Once delivered, the LS won't redispatch it again: drop the outcome,
                // its blobs and its eviction timer.
                if (result.status === 'delivered' &&
                    this.fulfilled.get(id) === cached) {
                    this.forgetFulfilled(id);
                }
            });
            return;
        }
        const entry = new RequestEntry(id, token, effectiveDeadlineMs(req, this.clockSkewMs), this.sender);
        this.inFlight.set(id, entry);
        let payload;
        try {
            payload = req.payload
                ? (0, wkt_1.anyUnpack)(req.payload, this.handler.schemas.request)
                : undefined;
        }
        catch (e) {
            void entry.fail(actuator_pb_1.ActuatorErrorCode.INVALID_REQUEST, `undecodable ${this.handler.schemas.request.typeName}: ${errorMessage(e)}`);
            return;
        }
        if (payload === undefined) {
            void entry.fail(actuator_pb_1.ActuatorErrorCode.INVALID_REQUEST, `payload is not ${this.handler.schemas.request.typeName}`);
            return;
        }
        const incoming = {
            requestId: id,
            rootConversationId: req.rootConversationId,
            cascadeId: req.cascadeId,
            deadlineUnixMs: Number(req.deadlineUnixMs),
            redispatchable: req.redispatchable,
            attempt: req.attempt,
            payload: payload,
        };
        try {
            const done = this.handler.onRequest(incoming, entry);
            if (done) {
                done.catch((e) => {
                    this.onHandlerError(entry, e);
                });
            }
        }
        catch (e) {
            this.onHandlerError(entry, e);
        }
    }
    onHandlerError(entry, e) {
        this.host.logger.error(`${this.label()} handler failed on ${entry.requestId}`, e);
        if (!entry.isSettled) {
            void entry.fail(actuator_pb_1.ActuatorErrorCode.INTERNAL, errorMessage(e));
        }
    }
    async settle(entry, makeOutcome, blobs) {
        const errorRequest = (message) => (0, protobuf_1.create)(actuator_pb_1.FulfillRequestSchema, {
            requestId: entry.requestId,
            actuatorType: this.handler.actuatorType,
            actuatorId: this.handler.actuatorId,
            outcome: errorOutcome(actuator_pb_1.ActuatorErrorCode.INTERNAL, (0, limits_1.clampErrorMessage)(message, this.limits)),
        });
        let request;
        let violation;
        try {
            const outcome = makeOutcome();
            const blobList = blobs.map((b) => (0, protobuf_1.create)(actuator_pb_1.BlobSchema, b));
            if (outcome.case === 'error') {
                outcome.value.message = (0, limits_1.clampErrorMessage)(outcome.value.message, this.limits);
            }
            request = (0, protobuf_1.create)(actuator_pb_1.FulfillRequestSchema, {
                requestId: entry.requestId,
                actuatorType: this.handler.actuatorType,
                actuatorId: this.handler.actuatorId,
                outcome,
                blobs: blobList,
            });
            // Encode once up front, so an invalid field (e.g. a fractional uint32
            // blob dimension) throws here instead of failing every delivery try.
            const encodedBytes = (0, protobuf_1.toBinary)(actuator_pb_1.FulfillRequestSchema, request).length;
            violation = (0, limits_1.fulfillLimitViolation)(request, this.limits, encodedBytes);
        }
        catch (e) {
            this.host.logger.error(`${this.label()} cannot encode result`, e);
            request = errorRequest(`cannot encode result: ${errorMessage(e)}`);
        }
        if (violation) {
            this.host.logger.warn(`${this.label()} ${entry.requestId}: ${violation}; sending ${limits_1.RESULT_EXCEEDS_LIMITS}`);
            request = (0, protobuf_1.create)(actuator_pb_1.FulfillRequestSchema, {
                requestId: entry.requestId,
                actuatorType: this.handler.actuatorType,
                actuatorId: this.handler.actuatorId,
                outcome: errorOutcome(actuator_pb_1.ActuatorErrorCode.INTERNAL, limits_1.RESULT_EXCEEDS_LIMITS),
            });
        }
        let delivered = false;
        let stopped = false;
        try {
            const result = await this.deliver({ token: () => entry.sessionToken, deadlineMs: entry.deadlineMs }, request);
            delivered = result.status === 'delivered';
            stopped = result.status === 'stopped';
            return violation ? { ...result, limitExceeded: true } : result;
        }
        finally {
            entry.dispose();
            if (this.inFlight.get(entry.requestId) === entry) {
                this.inFlight.delete(entry.requestId);
            }
            this.forgetFulfilled(entry.requestId);
            if (!delivered &&
                !stopped &&
                !this.unsubscribed &&
                !this.host.stopSignal.aborted) {
                this.cacheFulfilled(entry.requestId, request);
            }
        }
    }
    cacheFulfilled(id, request) {
        const evict = setTimeout(() => {
            if (this.fulfilled.get(id)?.evict === evict) {
                this.fulfilled.delete(id);
            }
        }, FULFILLED_CACHE_TTL_MS);
        this.fulfilled.set(id, { request, at: Date.now(), evict });
        this.pruneFulfilled();
    }
    forgetFulfilled(id) {
        clearTimeout(this.fulfilled.get(id)?.evict);
        this.fulfilled.delete(id);
    }
    /**
     * Drops every cached outcome and its eviction timer; called on stop() and
     * unsubscribe().
     */
    dropFulfilled() {
        for (const { evict } of this.fulfilled.values()) {
            clearTimeout(evict);
        }
        this.fulfilled.clear();
    }
    /** Sends one Fulfill, retrying transient failures until the deadline. */
    async deliver(target, request) {
        // stop() ends the retries but never aborts a call already on the wire;
        // each call is bounded by its own timeout.
        const stop = this.host.stopSignal;
        const backoff = new backoff_1.Backoff(this.host.opts.backoff, this.host.opts.random);
        for (;;) {
            const sentToken = target.token();
            request.sessionToken = sentToken;
            try {
                await this.host.rpc().fulfill(request, {
                    // A large result on a slow link may need the whole deadline.
                    timeoutMs: Math.max(this.host.opts.fulfillRpcTimeoutMs, target.deadlineMs - Date.now()),
                });
                return { status: 'delivered' };
            }
            catch (e) {
                const err = connect_1.ConnectError.from(e);
                if (stop.aborted) {
                    return { status: 'stopped' };
                }
                const currentToken = target.token();
                if (currentToken && currentToken !== sentToken) {
                    continue;
                }
                if ((0, backoff_1.isTerminalFulfillError)(err)) {
                    const reason = (0, backoff_1.connectErrorReason)(err);
                    this.host.logger.warn(`${this.label()} Fulfill ${request.requestId} rejected (${connect_1.Code[err.code]} ${reason}); not retrying`);
                    return { status: 'rejected', code: err.code, reason };
                }
                const delayMs = backoff.next();
                if (Date.now() + delayMs > target.deadlineMs) {
                    this.host.logger.warn(`${this.label()} Fulfill ${request.requestId} not delivered before its deadline`, err);
                    return { status: 'expired' };
                }
                this.host.logger.debug(`${this.label()} Fulfill ${request.requestId} failed (${err.message}); retrying in ${delayMs} ms`);
                await (0, backoff_1.sleep)(delayMs, stop);
                if (stop.aborted) {
                    return { status: 'stopped' };
                }
            }
        }
    }
    pruneFulfilled() {
        const cutoff = Date.now() - FULFILLED_CACHE_TTL_MS;
        for (const [id, { at }] of this.fulfilled) {
            if (at < cutoff || this.fulfilled.size > FULFILLED_CACHE_MAX) {
                this.forgetFulfilled(id);
            }
        }
    }
    onNotice(notice) {
        const n = notice.notice;
        if (n.case === 'leaseStatus') {
            const leaseStatus = n.value;
            this.callHandler('onNotice', () => {
                this.handler.onNotice?.({ leaseStatus });
            });
        }
        else if (n.case === 'payload') {
            const schema = this.handler.schemas.notice;
            if (!schema) {
                this.host.logger.debug(`${this.label()} notice payload ignored`);
                return;
            }
            let payload;
            try {
                payload = (0, wkt_1.anyUnpack)(n.value, schema);
            }
            catch (e) {
                this.host.logger.warn(`${this.label()} undecodable notice payload`, e);
                return;
            }
            if (payload === undefined) {
                this.host.logger.warn(`${this.label()} notice payload ${n.value.typeUrl} is not ${schema.typeName}`);
                return;
            }
            this.callHandler('onNotice', () => {
                this.handler.onNotice?.({ payload: payload });
            });
        }
    }
    // ---------------------------------------------------------------------------
    // Update
    update(next) {
        if (this.unsubscribed) {
            return Promise.reject(new Error(`${this.label()} is unsubscribed`));
        }
        if (next.hello !== undefined) {
            try {
                (0, limits_1.checkHelloBytes)(pack(this.handler.schemas.hello, next.hello).value.length, this.limits);
            }
            catch (e) {
                return Promise.reject(e instanceof Error ? e : new Error(String(e)));
            }
        }
        const seq = ++this.updateSeq;
        const pending = this.pending ?? { waiters: [] };
        this.pending = pending;
        if (next.hello !== undefined) {
            pending.hello = next.hello;
            pending.helloSeq = seq;
            this.latestHelloSeq = seq;
        }
        if (next.conversationIds !== undefined) {
            pending.conversationIds = [...next.conversationIds];
            pending.convSeq = seq;
            this.latestConvSeq = seq;
        }
        const promise = new Promise((resolve, reject) => {
            pending.waiters.push({ resolve, reject });
        });
        this.scheduleUpdate();
        return promise;
    }
    scheduleUpdate() {
        const pending = this.pending;
        if (!pending || !this.sessionToken || this.inFlightUpdate) {
            return;
        }
        clearTimeout(pending.timer);
        pending.timer = setTimeout(() => {
            void this.flushUpdate();
        }, this.host.opts.updateDebounceMs);
    }
    async flushUpdate() {
        const pending = this.pending;
        if (!pending) {
            return;
        }
        this.pending = undefined;
        clearTimeout(pending.timer);
        const token = this.sessionToken;
        if (!token) {
            this.requeue(pending);
            return;
        }
        const conversationIds = pending.conversationIds !== undefined
            ? this.clampIds(pending.conversationIds)
            : undefined;
        this.inFlightUpdate = pending;
        try {
            await this.host.rpc().update((0, protobuf_1.create)(actuator_pb_1.UpdateRequestSchema, {
                actuatorType: this.handler.actuatorType,
                actuatorId: this.handler.actuatorId,
                sessionToken: token,
                hello: pending.hello !== undefined
                    ? pack(this.handler.schemas.hello, pending.hello)
                    : undefined,
                replaceConversationIds: conversationIds !== undefined,
                conversationIds: conversationIds ?? [],
            }), { timeoutMs: CONTROL_RPC_TIMEOUT_MS });
            for (const waiter of pending.waiters) {
                waiter.resolve();
            }
        }
        catch (e) {
            const err = connect_1.ConnectError.from(e);
            if (!this.active ||
                !this.host.running ||
                this.sessionToken !== token ||
                err.code === connect_1.Code.NotFound) {
                // The stream went away. Keep the values for the next Subscribe and
                // don't re-send until a new ack (no 250 ms Update loop), unless a new
                // stream has already been acked.
                this.inFlightUpdate = undefined;
                if (pending.waiters.length > 0) {
                    this.requeue(pending, 
                    /* schedule= */ Boolean(this.active &&
                        this.host.running &&
                        this.sessionToken &&
                        this.sessionToken !== token));
                }
                return;
            }
            this.host.logger.warn(`${this.label()} Update failed`, err);
            for (const waiter of pending.waiters) {
                waiter.reject(err);
            }
        }
        finally {
            this.inFlightUpdate = undefined;
        }
        // An update that arrived during the call goes out now, in order.
        this.scheduleUpdate();
    }
    /** Puts an unsent update back under any newer one. */
    requeue(older, schedule = true) {
        const hello = older.hello !== undefined && older.helloSeq === this.latestHelloSeq
            ? older.hello
            : undefined;
        const helloSeq = hello !== undefined ? older.helloSeq : undefined;
        const conversationIds = older.conversationIds !== undefined &&
            older.convSeq === this.latestConvSeq
            ? older.conversationIds
            : undefined;
        const convSeq = conversationIds !== undefined ? older.convSeq : undefined;
        const superseded = hello === undefined &&
            conversationIds === undefined &&
            (older.hello !== undefined || older.conversationIds !== undefined);
        const newer = this.pending;
        if (newer) {
            if (hello !== undefined) {
                newer.hello = hello;
                newer.helloSeq = helloSeq;
            }
            if (conversationIds !== undefined) {
                newer.conversationIds = conversationIds;
                newer.convSeq = convSeq;
            }
            newer.waiters.unshift(...older.waiters);
        }
        else if (superseded) {
            if (this.carried) {
                this.carried.waiters.unshift(...older.waiters);
            }
            else {
                for (const waiter of older.waiters) {
                    waiter.resolve();
                }
            }
            return;
        }
        else {
            this.pending = {
                hello,
                helloSeq,
                conversationIds,
                convSeq,
                waiters: [...older.waiters],
            };
        }
        if (schedule) {
            this.scheduleUpdate();
        }
    }
    /** Fails update() callers when the stream won't come back on its own. */
    rejectAllWaiters(reason) {
        const waiters = [
            ...(this.carried?.waiters ?? []),
            ...(this.inFlightUpdate?.waiters.splice(0) ?? []),
            ...(this.pending?.waiters ?? []),
        ];
        clearTimeout(this.pending?.timer);
        this.pending = undefined;
        this.carried = undefined;
        const err = new Error(`${this.label()} is not subscribed: ${reason}`);
        for (const waiter of waiters) {
            waiter.reject(err);
        }
    }
    releaseAckWaiters() {
        const waiters = this.ackWaiters;
        this.ackWaiters = [];
        for (const resolve of waiters) {
            resolve();
        }
    }
    resolveAllWaiters() {
        const waiters = [
            ...(this.carried?.waiters ?? []),
            ...(this.inFlightUpdate?.waiters.splice(0) ?? []),
            ...(this.pending?.waiters ?? []),
        ];
        clearTimeout(this.pending?.timer);
        this.pending = undefined;
        this.carried = undefined;
        for (const waiter of waiters) {
            waiter.resolve();
        }
    }
    clampIds(ids) {
        const clamped = (0, limits_1.clampConversationIds)(ids, this.limits);
        if (clamped.dropped > 0) {
            this.host.logger.warn(`${this.label()} dropped ${clamped.dropped} conversation id(s) over the limits`);
        }
        return clamped.ids;
    }
    // ---------------------------------------------------------------------------
    // Status
    async reportStatus(init) {
        if (this.unsubscribed) {
            return;
        }
        const report = this.rememberStatus(this.toReport(init));
        if (report && this.sessionToken) {
            await this.sendStatus(report);
        }
    }
    toReport(init) {
        const now = Math.max(monotonicNowMs(), this.lastObservedMs + 1);
        this.lastObservedMs = now;
        return (0, protobuf_1.create)(actuator_pb_1.ActuatorStatusReportSchema, {
            status: init.status,
            rootConversationId: init.rootConversationId ?? '',
            degradedReason: init.degradedReason ?? actuator_pb_1.DegradedReason.UNSPECIFIED,
            detail: (0, limits_1.clampDetail)(init.detail ?? '', this.limits),
            observedAtUnixMs: BigInt(now),
        });
    }
    rememberStatus(report) {
        const dimension = statusDimension(report.status);
        if (!dimension) {
            return report;
        }
        const scope = report.rootConversationId;
        if (report.status === actuator_pb_1.ActuatorStatus.USER_RESUME) {
            if (scope === '') {
                this.collapsedPause = false;
                for (const key of [...this.statuses.keys()]) {
                    if (key.startsWith('control\0')) {
                        this.statuses.delete(key);
                    }
                }
            }
            else if (this.collapsedPause) {
                return undefined;
            }
        }
        const prevCollapsed = this.collapsedPause
            ? this.statuses.get('control\0')
            : undefined;
        const key = `${dimension}\0${scope}`;
        this.statuses.delete(key);
        this.statuses.set(key, report);
        if (dimension === 'control') {
            const resumeKeys = [];
            const pauses = [];
            if (prevCollapsed && isPauseStatus(prevCollapsed.status)) {
                pauses.push(['control\0', prevCollapsed]);
            }
            for (const [k, r] of this.statuses) {
                if (!k.startsWith('control\0')) {
                    continue;
                }
                if (isPauseStatus(r.status)) {
                    pauses.push([k, r]);
                }
                else {
                    resumeKeys.push(k);
                }
            }
            while (resumeKeys.length > 0 &&
                resumeKeys.length + pauses.length > MAX_INITIAL_PAUSES) {
                this.statuses.delete(resumeKeys.shift());
            }
            if (pauses.length > MAX_INITIAL_PAUSES) {
                this.collapsedPause = true;
            }
            if (this.collapsedPause && isPauseStatus(report.status)) {
                let newestAt = report.observedAtUnixMs;
                let status = report.status;
                for (const [, r] of pauses) {
                    if (r.observedAtUnixMs > newestAt) {
                        newestAt = r.observedAtUnixMs;
                    }
                    if (r.status === actuator_pb_1.ActuatorStatus.USER_STOP) {
                        status = actuator_pb_1.ActuatorStatus.USER_STOP;
                    }
                }
                for (const [k] of pauses) {
                    this.statuses.delete(k);
                }
                for (const k of resumeKeys) {
                    this.statuses.delete(k);
                }
                const collapsed = (0, protobuf_1.create)(actuator_pb_1.ActuatorStatusReportSchema, {
                    status,
                    rootConversationId: '',
                    degradedReason: report.degradedReason,
                    detail: report.detail,
                    observedAtUnixMs: newestAt,
                });
                this.statuses.set('control\0', collapsed);
                return collapsed;
            }
        }
        return report;
    }
    async replayStatuses(token) {
        for (const report of [...this.statuses.values()]) {
            if (this.sessionToken !== token || !this.active) {
                return;
            }
            if (report === this.initialSent) {
                continue;
            }
            await this.sendStatus(report, /* replay= */ true);
        }
    }
    statusKey(report) {
        const dimension = statusDimension(report.status);
        return dimension ? `${dimension}\0${report.rootConversationId}` : undefined;
    }
    /**
     * Queues one ReportStatus. Live reports go out in order, ahead of replayed
     * ones that haven't started, so a RESUME or GOING_AWAY never waits behind a
     * replay. A replayed report is skipped if a newer one replaced it, or once
     * shutdown has begun, and gets a short timeout.
     */
    sendStatus(report, replay = false, token) {
        return new Promise((resolve) => {
            const job = { report, replay, token, done: resolve };
            if (replay) {
                this.statusJobs.push(job);
            }
            else {
                const firstReplay = this.statusJobs.findIndex((j) => j.replay);
                if (firstReplay < 0) {
                    this.statusJobs.push(job);
                }
                else {
                    this.statusJobs.splice(firstReplay, 0, job);
                }
            }
            void this.pumpStatuses();
        });
    }
    async pumpStatuses() {
        if (this.statusPumping) {
            return;
        }
        this.statusPumping = true;
        try {
            for (;;) {
                const job = this.statusJobs.shift();
                if (!job) {
                    return;
                }
                try {
                    await this.deliverStatus(job);
                }
                finally {
                    job.done();
                }
            }
        }
        finally {
            this.statusPumping = false;
        }
    }
    async deliverStatus(job) {
        const { report, replay } = job;
        const key = this.statusKey(report);
        if (replay &&
            (!this.active || (key !== undefined && this.statuses.get(key) !== report))) {
            return;
        }
        if (job.token !== undefined &&
            (this.active || this.sessionToken !== job.token)) {
            return;
        }
        const token = job.token ?? this.sessionToken;
        if (!token) {
            return;
        }
        try {
            await this.host.rpc().reportStatus((0, protobuf_1.create)(actuator_pb_1.ReportStatusRequestSchema, {
                actuatorType: this.handler.actuatorType,
                actuatorId: this.handler.actuatorId,
                sessionToken: token,
                status: report,
            }), { timeoutMs: replay ? REPLAY_RPC_TIMEOUT_MS : CONTROL_RPC_TIMEOUT_MS });
            // A delivered RESUME has cleared the fence; it needs no replay.
            if (report.status === actuator_pb_1.ActuatorStatus.USER_RESUME &&
                this.sessionToken === token &&
                key !== undefined &&
                this.statuses.get(key) === report) {
                this.statuses.delete(key);
            }
        }
        catch (e) {
            this.host.logger.warn(`${this.label()} ReportStatus(${actuator_pb_1.ActuatorStatus[report.status]}) failed; it is replayed after the next subscribe`, e);
        }
    }
    // ---------------------------------------------------------------------------
    callHandler(name, fn) {
        try {
            fn();
        }
        catch (e) {
            this.host.logger.error(`${this.label()} ${name} threw`, e);
        }
    }
    label() {
        return `${this.handler.actuatorType}/${this.handler.actuatorId}`;
    }
}
/**
 * Client of `ActuatorService`. Register one handler per actuator type, then
 * `start()`.
 */
class ActuatorClient {
    constructor(opts) {
        this.registrations = [];
        this.running = false;
        this.stopController = new AbortController();
        this.stoppedOnce = false;
        this.stopGen = 0;
        this.pendingStopGen = 0;
        validateClientField('clientName', opts.clientName);
        validateClientField('clientVersion', opts.clientVersion);
        if (opts.clientInstanceId !== undefined) {
            validateClientField('clientInstanceId', opts.clientInstanceId);
        }
        this.transportFactory = opts.transportFactory;
        this.logger = opts.logger ?? CONSOLE_LOGGER;
        this.fixedInstanceId = opts.clientInstanceId;
        this.instanceId = opts.clientInstanceId ?? newInstanceId();
        this.opts = {
            clientName: opts.clientName,
            clientVersion: opts.clientVersion,
            backoff: opts.backoff ?? backoff_1.DEFAULT_BACKOFF,
            unimplementedRetryMs: opts.unimplementedRetryMs ?? backoff_1.DEFAULT_UNIMPLEMENTED_RETRY_MS,
            typeUnavailableRetryMs: opts.typeUnavailableRetryMs ?? backoff_1.DEFAULT_TYPE_UNAVAILABLE_RETRY_MS,
            heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
            updateDebounceMs: opts.updateDebounceMs ?? DEFAULT_UPDATE_DEBOUNCE_MS,
            fulfillRpcTimeoutMs: opts.fulfillRpcTimeoutMs ?? FULFILL_RPC_TIMEOUT_MS,
            random: opts.random ?? Math.random,
        };
        const instanceId = () => this.instanceId;
        const running = () => this.running;
        const stopSignal = () => this.stopController.signal;
        this.host = {
            opts: this.opts,
            logger: this.logger,
            get clientInstanceId() {
                return instanceId();
            },
            get running() {
                return running();
            },
            get stopSignal() {
                return stopSignal();
            },
            rpc: () => this.rpc(),
            invalidateTransport: () => {
                this.rpcClient = undefined;
            },
            remove: (reg) => {
                const i = this.registrations.indexOf(reg);
                if (i >= 0) {
                    this.registrations.splice(i, 1);
                }
            },
            add: (reg) => {
                if (this.registrations.includes(reg)) {
                    return true;
                }
                if (this.registrations.some((r) => r.actuatorType === reg.actuatorType &&
                    r.actuatorId === reg.actuatorId)) {
                    return false;
                }
                this.registrations.push(reg);
                return true;
            },
        };
    }
    /** Adds an actuator type. Several actuator types may share one client. */
    register(handler) {
        (0, limits_1.validateActuatorType)(handler.actuatorType);
        (0, limits_1.validateActuatorId)(handler.actuatorId);
        if (this.registrations.some((r) => r.actuatorType === handler.actuatorType &&
            r.actuatorId === handler.actuatorId)) {
            throw new Error(`actuator type "${handler.actuatorType}" actuator "${handler.actuatorId}" is already registered`);
        }
        const reg = new Registration(this.host, handler);
        this.registrations.push(reg);
        if (this.running) {
            reg.start();
        }
        return reg;
    }
    /** Opens a stream for every registered actuator type. */
    start() {
        if (this.running) {
            return;
        }
        if (this.pendingStopGen > 0) {
            this.finishStop();
        }
        if (this.stopController.signal.aborted) {
            this.stopController = new AbortController();
        }
        if (this.stoppedOnce && !this.fixedInstanceId) {
            // stop() abandoned this instance's requests; a restart is a new
            // instance, so the LS won't hand it a run the old one may still execute.
            this.instanceId = newInstanceId();
        }
        this.running = true;
        for (const reg of this.registrations) {
            reg.start();
        }
    }
    /**
     * Sends GOING_AWAY for every actuator type, closes the streams, aborts
     * in-flight request signals and ends pending Fulfill retries. A handler may
     * still fulfill afterwards; the LS accepts it while the request is pending.
     */
    async stop() {
        if (!this.running) {
            // A concurrent stop() resolves when the teardown in flight does.
            await this.stopping;
            return;
        }
        this.running = false;
        this.stoppedOnce = true;
        const gen = ++this.stopGen;
        this.pendingStopGen = gen;
        const stopping = (async () => {
            await Promise.all(this.registrations.map((r) => r.shutdown()));
            if (this.pendingStopGen === gen) {
                this.finishStop();
            }
        })();
        this.stopping = stopping;
        try {
            await stopping;
        }
        finally {
            if (this.stopping === stopping) {
                this.stopping = undefined;
            }
        }
    }
    finishStop() {
        this.pendingStopGen = 0;
        for (const reg of this.registrations) {
            reg.abortRequests('actuator client stopped');
            reg.dropFulfilled();
        }
        this.stopController.abort();
        this.rpcClient = undefined;
    }
    /** Tears down every stream, rebuilds the transport and resubscribes. */
    onPortChanged() {
        this.rpcClient = undefined;
        for (const reg of this.registrations) {
            reg.resubscribe();
        }
    }
    rpc() {
        if (!this.rpcClient) {
            this.rpcClient = (0, connect_1.createClient)(actuator_pb_1.ActuatorService, this.transportFactory());
        }
        return this.rpcClient;
    }
}
exports.ActuatorClient = ActuatorClient;
