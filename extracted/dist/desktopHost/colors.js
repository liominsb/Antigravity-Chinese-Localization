"use strict";
/**
 * Agent colors, assigned by the host (#1275): each agent gets a palette slot
 * on first appearance and keeps it while it is in the lease. The slot is the
 * least-used one among the agents present, ties broken by the agent id's
 * FNV-1a hash (the old fixed color), so colors stay distinct while there are
 * at most as many agents as palette entries, and deterministic. A slot is
 * released when its agent leaves.
 *
 * Every surface takes the color from here: the overlay ops (color_index), the
 * HUD rows and the viewer's agents / activity / streams / frame_meta
 * (colorIndex). Surfaces fall back to the hash only when no index is sent.
 *
 * Node-only, no Electron.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentColors = void 0;
const overlay_1 = require("../computer/overlay");
class AgentColors {
    constructor(size = overlay_1.OVERLAY_PALETTE.length) {
        this.size = size;
        this.byActor = new Map();
    }
    /**
     * The agents present now: the others' slots are released, new ones get a
     * slot in the given order.
     */
    sync(actorIds) {
        const ids = [...actorIds];
        const present = new Set(ids);
        for (const id of [...this.byActor.keys()]) {
            if (!present.has(id)) {
                this.byActor.delete(id);
            }
        }
        for (const id of ids) {
            this.of(id);
        }
    }
    /** An agent's slot, assigning one if it has none yet. */
    of(actorId) {
        const have = this.byActor.get(actorId);
        if (have !== undefined) {
            return have;
        }
        const used = new Array(this.size).fill(0);
        for (const c of this.byActor.values()) {
            used[c]++;
        }
        const least = Math.min(...used);
        const start = (0, overlay_1.overlayHash)(actorId) % this.size;
        let pick = start;
        for (let k = 0; k < this.size; k++) {
            const i = (start + k) % this.size;
            if (used[i] === least) {
                pick = i;
                break;
            }
        }
        this.byActor.set(actorId, pick);
        return pick;
    }
    /** A copy of `x` whose actor carries its assigned colorIndex. */
    recolor(x) {
        return { ...x, actor: { ...x.actor, colorIndex: this.of(x.actor.id) } };
    }
}
exports.AgentColors = AgentColors;
