"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OverlayFeed = exports.DEFAULT_ACTOR = exports.OVERLAY_TIMEOUT_MS = exports.OVERLAY_MAX_LABEL = exports.OVERLAY_PALETTE = void 0;
exports.overlayHash = overlayHash;
exports.overlayColorIndex = overlayColorIndex;
exports.overlayColorHex = overlayColorHex;
exports.overlayLabel = overlayLabel;
exports.overlayDisplayName = overlayDisplayName;
exports.overlayKindOf = overlayKindOf;
exports.actorOf = actorOf;
exports.overlayUpdateArgs = overlayUpdateArgs;
/**
 * Agent overlay cursors, Hub side (Phase 2a). The Swift helper draws them
 * (desktop-helper/Overlay.swift); this file turns per-agent activity into the
 * helper's additive `overlay_update` / `overlay_clear` ops:
 *
 * - Activity comes from Layer 2's `onAgentActivity` (C12b), wired in index.ts.
 * - Element bounds come from the ax_* results (F5 `bounds`, set once the Mac
 *   driver maps the helper's reply); without them the feed falls back to the
 *   app's last snapshot / window capture frame, so the cursor at least lands
 *   on the right window.
 *
 * The color index and the label rules mirror Overlay.swift exactly (FNV-1a %
 * palette, same sanitization), so the HUD row and the on-screen cursor of an
 * agent always match. Kept free of Electron imports so it can be unit tested.
 */
/** Agent colors (0xRRGGBB); mirrors kOverlayPalette in Overlay.swift. */
exports.OVERLAY_PALETTE = [
    0x0a84ff, 0xff375f, 0x30d158, 0xff9f0a, 0xbf5af2, 0x40c8e0, 0xffd60a,
    0xac8e68,
];
/** Mirrors kOverlayMaxLabel in Overlay.swift. */
exports.OVERLAY_MAX_LABEL = 32;
/**
 * Helper timeout for overlay ops. Long on purpose: an overlay op queues
 * behind the agent's next action in the helper, and DesktopHelper kills the
 * helper on a timeout, so an overlay op must never be the one that times out.
 */
exports.OVERLAY_TIMEOUT_MS = 60000;
/**
 * Used while Layer 2 does not identify agents yet (Phase 2a: one agent); the
 * label matches the language server's default actor_label.
 */
exports.DEFAULT_ACTOR = {
    id: 'agent',
    label: 'computer',
};
/**
 * 32-bit FNV-1a over the UTF-16 code units: Layer 2's agentColorIndex
 * (computerOps.ts) and overlayHash in Overlay.swift compute the same.
 */
function overlayHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}
/**
 * The palette slot of an actor: its explicit index (wrapped into range) if it
 * has one, else the hash of its id. Mirrors overlayColorIndex.
 */
function overlayColorIndex(actorId, explicit) {
    const n = exports.OVERLAY_PALETTE.length;
    if (explicit !== undefined && Number.isInteger(explicit)) {
        return ((explicit % n) + n) % n;
    }
    return overlayHash(actorId) % n;
}
/** "#rrggbb" of a palette slot. */
function overlayColorHex(index) {
    const n = exports.OVERLAY_PALETTE.length;
    const v = exports.OVERLAY_PALETTE[((Math.trunc(index) % n) + n) % n];
    return '#' + v.toString(16).padStart(6, '0');
}
const DROP = /[\p{Cf}\p{Co}\p{Cn}\p{Cs}]/gu;
const SPACES = /[\p{Cc}\p{White_Space}]+/gu;
/**
 * A display-safe one-line label; mirrors overlayLabel in Overlay.swift:
 * format / private-use / unassigned / surrogate code points are dropped
 * (bidi overrides, zero-width characters), controls and whitespace runs
 * become one space, trimmed, at most 32 code points (31 + "…"), and
 * "unnamed" if nothing is left. Shown only via {@link overlayDisplayName}.
 */
function overlayLabel(raw) {
    const s = raw.replace(DROP, '').replace(SPACES, ' ').trim();
    if (!s) {
        return 'unnamed';
    }
    const cps = [...s];
    if (cps.length <= exports.OVERLAY_MAX_LABEL) {
        return s;
    }
    return (cps
        .slice(0, exports.OVERLAY_MAX_LABEL - 1)
        .join('')
        .trimEnd() + '…');
}
/**
 * How a label is shown: always behind the fixed "Agent: " prefix, as plain
 * text, so a subagent name can't pose as UI text. Mirrors overlayDisplayName.
 */
function overlayDisplayName(label) {
    return `智能体：${label === 'unnamed' ? '未命名' : label}`;
}
const AX_KINDS = new Map([
    ['ax_press', 'press'],
    ['ax_select', 'select'],
    ['ax_set_value', 'set_value'],
    ['ax_scroll', 'scroll'],
]);
/** Background reads that locate the agent's window (cursor without feedback). */
const LOOK_KINDS = new Set(['bind_app', 'ax_snapshot', 'window_screenshot']);
/** Foreground ops: the agent holds the one real pointer. */
const POINTER_KINDS = new Set([
    'click',
    'double_click',
    'right_click',
    'move',
    'drag',
    'scroll',
    'key',
    'type',
    'focus_app',
]);
/**
 * The overlay kind of an activity, or undefined if it changes nothing on the
 * overlay (failed actions, screenshots, waits, reads without a frame).
 */
function overlayKindOf(a) {
    if (a.kind === 'done') {
        return 'done';
    }
    if (a.ok === false) {
        return undefined;
    }
    const ax = AX_KINDS.get(a.kind);
    if (ax) {
        return ax;
    }
    if (LOOK_KINDS.has(a.kind)) {
        return a.bounds ? 'move' : undefined;
    }
    return POINTER_KINDS.has(a.kind) ? 'pointer' : undefined;
}
function finite(...v) {
    return v.every((x) => typeof x === 'number' && Number.isFinite(x));
}
function boundsOk(b) {
    return (!!b && finite(b.x, b.y, b.width, b.height) && b.width >= 0 && b.height >= 0);
}
/** The actor an activity is attributed to, normalized. */
function actorOf(a) {
    const raw = a.actor && typeof a.actor.id === 'string' && a.actor.id.trim()
        ? a.actor
        : exports.DEFAULT_ACTOR;
    const id = raw.id.trim().slice(0, 128);
    return {
        id,
        label: overlayLabel(raw.label ?? ''),
        colorIndex: overlayColorIndex(id, raw.colorIndex),
    };
}
/** The helper's overlay_update args for an activity of overlay kind `kind`. */
function overlayUpdateArgs(a, kind) {
    const actor = actorOf(a);
    const args = {
        actor: { id: actor.id, label: actor.label, color_index: actor.colorIndex },
        kind,
    };
    if (a.appId) {
        args['app_id'] = a.appId;
    }
    if (boundsOk(a.bounds)) {
        const { x, y, width, height } = a.bounds;
        args['bounds'] = { x, y, width, height };
    }
    // The pointer's point, or an agent's visual hint (Layer 2 sets both point
    // and re-centred bounds): the cursor goes to the point when there is one.
    if (a.point && finite(a.point.x, a.point.y)) {
        args['point'] = { x: a.point.x, y: a.point.y };
    }
    if (a.scroll && finite(a.scroll.dx, a.scroll.dy)) {
        args['scroll'] = { dx: a.scroll.dx, dy: a.scroll.dy };
    }
    return args;
}
/**
 * Feeds agent activity to the helper's overlay. Never throws and never
 * blocks the caller: each op is fire-and-forget.
 */
class OverlayFeed {
    constructor(helper, log = () => { }) {
        /** Last window frame per app id (and overall), for results without bounds. */
        this.windows = new Map();
        /** Per agent: the window its last look (screenshot, snapshot) showed. */
        this.lastWindow = new Map();
        this.failures = 0;
        this.suppressed = false;
        this.helper = helper;
        this.log = log;
    }
    /**
     * While the user watches the agents in the Hub's Agents pane (a main Hub
     * window focused, its preview connected), desktop marks are redundant and
     * would draw around the Hub: every mark is cleared at once and activity is
     * not drawn until this is lifted (window frames are still remembered).
     */
    setSuppressed(suppressed) {
        if (suppressed === this.suppressed) {
            return;
        }
        this.suppressed = suppressed;
        if (suppressed) {
            this.sendClear();
        }
    }
    activity(a) {
        const kind = overlayKindOf(a);
        if (!kind) {
            return;
        }
        let act = a;
        if (LOOK_KINDS.has(a.kind) && boundsOk(a.bounds)) {
            this.lastWindow.set(a.actor?.id ?? exports.DEFAULT_ACTOR.id, a.bounds);
            if (a.appId) {
                this.windows.set(a.appId, a.bounds);
            }
        }
        else if (AX_KINDS.has(a.kind) && !boundsOk(a.bounds)) {
            // An op on a named app uses only that app's window; never another
            // agent's (or app's) last window.
            const w = a.appId
                ? this.windows.get(a.appId)
                : this.lastWindow.get(a.actor?.id ?? exports.DEFAULT_ACTOR.id);
            if (w) {
                act = { ...a, bounds: w };
            }
        }
        if (this.suppressed) {
            return;
        }
        this.send('overlay_update', overlayUpdateArgs(act, kind));
    }
    /** Removes one agent's mark, or every mark. */
    clear(actorId) {
        if (actorId) {
            this.lastWindow.delete(actorId);
        }
        else {
            this.windows.clear();
            this.lastWindow.clear();
        }
        this.sendClear(actorId);
    }
    /** Clears the marks only (frames stay remembered). */
    sendClear(actorId) {
        this.send('overlay_clear', actorId ? { actor: { id: actorId } } : {});
    }
    send(op, args) {
        // Nothing to clear on a helper that isn't running; never start one.
        if (op === 'overlay_clear' && this.helper.running === false) {
            return;
        }
        let p;
        try {
            p = this.helper.call(op, args, exports.OVERLAY_TIMEOUT_MS);
        }
        catch (err) {
            p = Promise.reject(err);
        }
        p.then((r) => {
            if (!r.ok) {
                this.note(`${op}: ${r.error ?? 'failed'}`);
            }
        }, (err) => this.note(`${op}: ${String(err)}`));
    }
    note(msg) {
        // A few lines are enough to diagnose; the overlay is cosmetic.
        if (this.failures++ < 3) {
            this.log(`[Overlay] ${msg}`);
        }
    }
}
exports.OverlayFeed = OverlayFeed;
