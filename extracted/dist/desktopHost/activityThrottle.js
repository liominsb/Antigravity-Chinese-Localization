"use strict";
/**
 * Caps how fast one agent's typing activity reaches the overlay and viewers
 * (#1459: per-chunk typing activities): at most one per
 * {@link ACTIVITY_MIN_INTERVAL_MS} per actor for a run of the same typing
 * kind, always keeping the latest (a trailing flush), so the caret ends where
 * the text ends. Any other activity (a press, the end of a batch) first
 * flushes what is pending and then passes at once, so order and the final
 * state are kept.
 *
 * Node-only, no Electron.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityThrottle = exports.THROTTLED_KINDS = exports.ACTIVITY_MIN_INTERVAL_MS = void 0;
/** About 15 activities per second per actor. */
exports.ACTIVITY_MIN_INTERVAL_MS = 66;
/**
 * The kinds that come in bursts (typing chunks). Every other kind (a press,
 * a click) always passes, so no step of a move is ever dropped.
 */
exports.THROTTLED_KINDS = new Set([
    'ax_set_value',
    'type',
]);
class ActivityThrottle {
    constructor(emit, now = () => Date.now(), minIntervalMs = exports.ACTIVITY_MIN_INTERVAL_MS) {
        this.emit = emit;
        this.now = now;
        this.minIntervalMs = minIntervalMs;
        this.actors = new Map();
    }
    push(a) {
        const id = a.actor.id;
        let st = this.actors.get(id);
        if (!st) {
            st = { lastAt: -Infinity, lastKind: '' };
            this.actors.set(id, st);
        }
        const t = this.now();
        if (!exports.THROTTLED_KINDS.has(a.kind) || a.kind !== st.lastKind) {
            this.flush(id);
            this.send(st, a, t);
            return;
        }
        if (t - st.lastAt >= this.minIntervalMs && !st.pending) {
            this.send(st, a, t);
            return;
        }
        // Same kind, too soon: keep only the latest, sent at the boundary.
        st.pending = a;
        if (!st.timer) {
            st.timer = setTimeout(() => this.flush(id), Math.max(0, st.lastAt + this.minIntervalMs - t));
        }
    }
    /** Sends an actor's pending activity now. */
    flush(actorId) {
        const st = this.actors.get(actorId);
        if (!st) {
            return;
        }
        if (st.timer) {
            clearTimeout(st.timer);
            st.timer = undefined;
        }
        const p = st.pending;
        if (p) {
            st.pending = undefined;
            this.send(st, p, this.now());
        }
    }
    /** Drops everything pending (the host stops). */
    clear() {
        for (const st of this.actors.values()) {
            if (st.timer) {
                clearTimeout(st.timer);
            }
        }
        this.actors.clear();
    }
    send(st, a, t) {
        st.lastAt = t;
        st.lastKind = a.kind;
        this.emit(a);
    }
}
exports.ActivityThrottle = ActivityThrottle;
