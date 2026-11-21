"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HudAgentTokens = exports.MAX_HUD_AGENTS = void 0;
exports.hudAgentRows = hudAgentRows;
exports.hudAgentsHeadline = hudAgentsHeadline;
exports.stopAgentToken = stopAgentToken;
const overlay_1 = require("./overlay");
exports.MAX_HUD_AGENTS = 6;
function appLabel(raw) {
    return raw && raw.trim() ? (0, overlay_1.overlayLabel)(raw) : '';
}
function row(actor, appName, mode, stopped = false, paused = false) {
    const id = actor.id.trim().slice(0, 128);
    const label = (0, overlay_1.overlayLabel)(actor.label ?? '');
    const app = appLabel(appName);
    const m = mode === 'foreground' ? 'foreground' : 'background';
    return {
        actorId: id,
        label,
        color: (0, overlay_1.overlayColorHex)((0, overlay_1.overlayColorIndex)(id, actor.colorIndex)),
        appName: app,
        mode: m,
        stopped,
        text: `${(0, overlay_1.overlayDisplayName)(label)} · ${app || '正在启动'} · ${stopped ? '已停止' : paused ? '已暂停' : (m === 'foreground' ? '前台' : '后台')}`,
    };
}
/**
 * The rows to show: none while fenced (the HUD offers "Allow again");
 * Layer 2's agents when it reports them (working ones first, then stopped
 * ones; most recent first within each; deduplicated; at most
 * {@link MAX_HUD_AGENTS}); otherwise one row for the single agent while it is
 * active (Phase 2a). Layer 2 drops an agent when its lease ends.
 */
function hudAgentRows(s) {
    if (s.paused) {
        return [];
    }
    if (s.agents) {
        const seen = new Set();
        return [...s.agents]
            .filter((a) => a && a.actor && typeof a.actor.id === 'string' && a.actor.id.trim())
            .sort((a, b) => Number(a.stopped === true) - Number(b.stopped === true) ||
            (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0) ||
            a.actor.id.localeCompare(b.actor.id))
            .filter((a) => {
            const id = a.actor.id.trim();
            if (seen.has(id)) {
                return false;
            }
            seen.add(id);
            return true;
        })
            .slice(0, exports.MAX_HUD_AGENTS)
            .map((a) => row(a.actor, a.appName, a.mode, a.stopped === true, a.paused === true));
    }
    return s.agentActive ? [row(overlay_1.DEFAULT_ACTOR, s.appName, s.mode)] : [];
}
/**
 * The HUD status text, counting only working agents: "n AGY agents working"
 * for several, the normal text for one (plus "(+k stopped)"), and "Agent
 * stopped" / "k agents stopped" when every listed agent is stopped.
 */
function hudAgentsHeadline(text, rows) {
    const working = rows.filter((r) => !r.stopped).length;
    const stopped = rows.length - working;
    if (working > 1) {
        return `${working} 个 AGY 智能体正在运行`;
    }
    if (working === 0 && stopped > 0) {
        return stopped === 1 ? '智能体已停止' : `${stopped} 个智能体已停止`;
    }
    return stopped > 0 ? `${text}（另有 ${stopped} 个已停止）` : text;
}
/**
 * Stable small integer tokens for the per-agent Stop buttons, so the HUD page
 * never sends an actor id back: a click names a token, and only a token of a
 * row on screen right now resolves (a stale click on a row that is gone does
 * nothing rather than stopping whoever took its place).
 */
class HudAgentTokens {
    constructor() {
        this.next = 1;
        this.byId = new Map();
    }
    token(actorId) {
        let t = this.byId.get(actorId);
        if (t === undefined) {
            t = this.next++;
            this.byId.set(actorId, t);
        }
        return t;
    }
    /** The actor of `token` among `rows`, if it is still shown and working. */
    actorFor(token, rows) {
        return rows.find((r) => !r.stopped && this.byId.get(r.actorId) === token)
            ?.actorId;
    }
}
exports.HudAgentTokens = HudAgentTokens;
const STOP_AGENT = /^agy-hud:stop-agent:(\d{1,9})$/;
/** The token of a per-agent Stop console message, or undefined. */
function stopAgentToken(message) {
    const m = STOP_AGENT.exec(message);
    return m ? Number(m[1]) : undefined;
}
