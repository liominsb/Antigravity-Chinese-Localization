"use strict";
/**
 * Agents the user took over from their tile (#1352): stopped for input, but
 * their stream keeps going with the user in control until they are handed
 * back, stopped, leave the lease, or {@link TAKEOVER_MAX_MS} passes.
 *
 * The rules (rt-security UC-4..7):
 * - only a running agent of the lease can be taken over, never one the user
 *   stopped, so a hand-back (resumeAgent) can't un-stop it;
 * - Stop, the end of the lease or the timeout end a takeover for good: a
 *   later hand-back does nothing;
 * - take and hand back are idempotent.
 *
 * Node-only, no Electron.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Takeovers = exports.TAKEOVER_MAX_MS = void 0;
/** A takeover nobody hands back ends (the agent is stopped) after this. */
exports.TAKEOVER_MAX_MS = 15 * 60000;
class Takeovers {
    constructor(hooks, maxMs = exports.TAKEOVER_MAX_MS) {
        this.hooks = hooks;
        this.maxMs = maxMs;
        this.timers = new Map();
        /**
         * Taken-over agents whose lease ended (they returned on AGENT_STOPPED):
         * kept, as stopped, so the user's tile stays until hand-back, Stop or the
         * time limit.
         */
        this.retained = new Map();
    }
    has(actorId) {
        return this.timers.has(actorId);
    }
    ids() {
        return [...this.timers.keys()];
    }
    /**
     * Takes `agent` over if it is a running agent of the lease (undefined: not
     * one). True if it is now taken over by this call.
     */
    take(actorId, agent) {
        if (!agent || agent.stopped || this.timers.has(actorId)) {
            return false;
        }
        this.timers.set(actorId, setTimeout(() => {
            this.timers.delete(actorId);
            if (this.retained.delete(actorId)) {
                this.hooks.onReleased?.(actorId);
            }
            this.hooks.onExpired(actorId);
        }, this.maxMs));
        this.hooks.stopAgent(actorId);
        return true;
    }
    /**
     * Hands a takeover still in place back (resumes the agent). One that
     * already left the lease has nothing to resume: it is released.
     */
    async handBack(actorId) {
        const gone = this.retained.has(actorId);
        if (!this.end(actorId)) {
            return false;
        }
        if (!gone) {
            await this.hooks.resumeAgent(actorId);
        }
        return true;
    }
    /** Ends a takeover without resuming (Stop, the time limit). */
    end(actorId) {
        const t = this.timers.get(actorId);
        if (!t) {
            return false;
        }
        clearTimeout(t);
        this.timers.delete(actorId);
        if (this.retained.delete(actorId)) {
            this.hooks.onReleased?.(actorId);
        }
        return true;
    }
    /**
     * The lease's agents now: a taken-over agent that left is retained (true
     * returned), one that came back is no longer.
     */
    leftLease(agent) {
        if (!this.timers.has(agent.actor.id)) {
            return false;
        }
        this.retained.set(agent.actor.id, { ...agent, stopped: true });
        return true;
    }
    /** An agent is in the lease (again). */
    inLease(actorId) {
        this.retained.delete(actorId);
    }
    /** The lease's agents plus the retained taken-over ones. */
    view(agents) {
        const ids = new Set(agents.map((a) => a.actor.id));
        return [
            ...agents,
            ...[...this.retained.values()].filter((a) => !ids.has(a.actor.id)),
        ];
    }
    clear() {
        for (const id of this.ids()) {
            this.end(id);
        }
    }
}
exports.Takeovers = Takeovers;
