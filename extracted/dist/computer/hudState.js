"use strict";
/**
 * What the computer-use HUD shows for a computer actuator state: pure, so it
 * is unit tested without Electron (hud.ts renders it).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hudView = hudView;
const MAX_APP_NAME = 60;
function hudView(s) {
    const visible = s.agentActive || s.paused;
    if (s.paused) {
        // The agent's task has ended either way (the LS answers USER_TAKEOVER /
        // USER_STOP and the agent stops), so never claim a resumable pause.
        const text = s.pauseCause === 'user_takeover'
            ? '您已接管 — 智能体已停止'
            : '智能体已停止';
        return { state: 'paused', text, visible };
    }
    if (!s.agentActive) {
        return { state: 'idle', text: '智能体空闲', visible };
    }
    if (s.mode === 'background') {
        const name = (s.appName ?? '').trim().slice(0, MAX_APP_NAME);
        return {
            state: 'background',
            text: name
                ? `AGY 正在后台操作 ${name}`
                : 'AGY 正在后台运行',
            visible,
        };
    }
    return { state: 'running', text: 'AGY 正在控制您的 Mac', visible };
}
