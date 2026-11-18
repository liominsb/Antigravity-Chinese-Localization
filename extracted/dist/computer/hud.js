"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopHud = exports.browserWindowFocusSource = exports.HUD_RESHOW_DELAY_MS = void 0;
const electron_1 = require("electron");
const hudAgents_1 = require("./hudAgents");
const hudState_1 = require("./hudState");
const hubWindows_1 = require("../hubWindows");
const HUD_WIDTH = 380;
const HUD_HEIGHT = 56;
const AGENT_ROW_HEIGHT = 30;
/**
 * After the Hub's Agents pane stops covering the HUD (focus left, or the
 * pane's preview closed), the HUD shows again only once that has held this
 * long: a sub-second viewer swap never flashes it. Hiding is immediate.
 */
exports.HUD_RESHOW_DELAY_MS = 1000;
const MSG_STOP = 'agy-hud:stop';
const MSG_RESUME = 'agy-hud:resume';
/** Window height for `rows` agent rows. */
function hudHeight(rows) {
    return HUD_HEIGHT + (rows > 0 ? 6 + rows * AGENT_ROW_HEIGHT : 0);
}
const HUD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AGY Desktop HUD</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html,body{margin:0;height:100%;background:transparent;font:13px -apple-system,system-ui,sans-serif;-webkit-user-select:none}
  #bar{box-sizing:border-box;height:${HUD_HEIGHT}px;display:flex;align-items:center;gap:10px;padding:0 12px;
       border-radius:12px;background:rgba(28,28,30,.92);color:#fff;border:1px solid rgba(255,255,255,.15);
       -webkit-app-region:drag}
  #dot{width:10px;height:10px;border-radius:50%;background:#34c759;box-shadow:0 0 8px #34c759;flex:none}
  body.background #dot{background:#0a84ff;box-shadow:0 0 8px #0a84ff}
  body.paused #dot{background:#ff9f0a;box-shadow:0 0 8px #ff9f0a}
  #status{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  button{border:0;border-radius:7px;padding:6px 12px;font:600 12px -apple-system,system-ui;cursor:pointer;
         -webkit-app-region:no-drag}
  #stop{background:#ff3b30;color:#fff}
  #resume{background:#0a84ff;color:#fff;display:none}
  body.paused #stop{display:none}
  body.paused #resume{display:inline-block}
  #agents{margin-top:6px;border-radius:10px;background:rgba(28,28,30,.92);color:#fff;border:1px solid rgba(255,255,255,.15);overflow:hidden;
          -webkit-app-region:drag}
  #agents:empty{display:none}
  .agent{box-sizing:border-box;height:${AGENT_ROW_HEIGHT - 1}px;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;font-size:12px}
  .agent+.agent{border-top:1px solid rgba(255,255,255,.08)}
  .swatch{width:9px;height:9px;border-radius:50%;flex:none}
  .agent .text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stop-agent{padding:3px 9px;font-size:11px;background:rgba(255,59,48,.85);color:#fff}
  .agent.stopped .swatch,.agent.stopped .text{opacity:.45}
  .stopped-tag{font-size:11px;color:rgba(255,255,255,.6);padding:3px 4px}
</style></head>
<body><div id="bar"><div id="dot"></div><div id="status">AGY 正在控制您的 Mac</div>
<button id="stop">停止</button><button id="resume">继续</button></div>
<div id="agents"></div>
<script>
  document.getElementById('stop').addEventListener('click', () => console.log('${MSG_STOP}'));
  document.getElementById('resume').addEventListener('click', () => console.log('${MSG_RESUME}'));
  window.__agyHudSetState = (paused, text, state) => {
    document.body.dataset.state = state;
    document.body.classList.toggle('paused', paused);
    document.body.classList.toggle('background', state === 'background');
    document.getElementById('status').textContent = text;
  };
  // rows: [{token, text, color, stopped}]; text only via textContent.
  window.__agyHudSetAgents = (rows) => {
    const box = document.getElementById('agents');
    box.replaceChildren();
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = r.stopped ? 'agent stopped' : 'agent';
      row.dataset.token = String(r.token);
      const sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.background = /^#[0-9a-f]{6}$/.test(r.color) ? r.color : '#888888';
      const t = document.createElement('div');
      t.className = 'text';
      t.textContent = r.text;
      let end;
      if (r.stopped) {
        end = document.createElement('span');
        end.className = 'stopped-tag';
        end.textContent = '已停止';
      } else {
        end = document.createElement('button');
        end.className = 'stop-agent';
        end.textContent = '停止';
        end.addEventListener('click', () => console.log('agy-hud:stop-agent:' + r.token));
      }
      row.append(sw, t, end);
      box.append(row);
    }
  };
</script></body></html>`;
/** Whether `w` is a main Hub UI window (not the HUD or another aux window). */
function mainHubFocused(w) {
    return !!w && !w.isDestroyed() && !(0, hubWindows_1.isAuxWindow)(w);
}
/**
 * BrowserWindow focus events. The Hub's BaseWindow-based windows need their
 * own source (index.ts passes utils.ts's onHubWindowFocusChange).
 */
exports.browserWindowFocusSource = {
    isHubFocused: () => mainHubFocused(electron_1.BrowserWindow.getFocusedWindow()),
    onChange: (cb) => {
        electron_1.app.on('browser-window-focus', cb);
        electron_1.app.on('browser-window-blur', cb);
        return () => {
            electron_1.app.removeListener('browser-window-focus', cb);
            electron_1.app.removeListener('browser-window-blur', cb);
        };
    },
};
class DesktopHud {
    constructor(focus = exports.browserWindowFocusSource) {
        this.focus = focus;
        this.win = null;
        /** Whether the window's page has loaded (did-finish-load) and rendered. */
        this.loaded = false;
        this.stopCbs = [];
        this.resumeCbs = [];
        this.stopAgentCbs = [];
        this.rows = [];
        this.tokens = new hudAgents_1.HudAgentTokens();
        this.state = { agentActive: false, paused: false };
        this.destroyed = false;
        /** A local Agents pane preview session is connected. */
        this.localViewer = false;
        /** When the pane last stopped covering the HUD (ms; 0: not recently). */
        this.uncoveredAt = 0;
        this.wasCovered = false;
        this.coveredCbs = [];
        this.hubFocused = focus.isHubFocused();
        // Re-read on every change: focus may already have moved to another Hub
        // window when one blurs.
        this.unsubscribeFocus = focus.onChange(() => this.setHubFocused(this.focus.isHubFocused()));
    }
    setLocalViewer(open) {
        if (this.destroyed || open === this.localViewer) {
            return;
        }
        this.localViewer = open;
        this.applyVisibility();
    }
    setHubFocused(focused) {
        if (this.destroyed || focused === this.hubFocused) {
            return;
        }
        this.hubFocused = focused;
        this.applyVisibility();
    }
    /**
     * Shows (inactive) or hides the existing window per state and focus:
     * hides at once while covered, shows again HUD_RESHOW_DELAY_MS after the
     * cover ends (at once if it was never covered).
     */
    applyVisibility() {
        const covered = this.hubFocused && this.localViewer;
        const now = Date.now();
        if (covered !== this.wasCovered) {
            // The state first, so a listener (or one that throws) sees it settled.
            this.wasCovered = covered;
            this.uncoveredAt = covered ? 0 : now;
            for (const cb of this.coveredCbs) {
                try {
                    cb(covered);
                }
                catch (err) {
                    console.error('HUD covered listener failed:', err);
                }
            }
        }
        const win = this.win;
        if (!win || win.isDestroyed()) {
            return;
        }
        const show = (0, hudState_1.hudView)(this.state).visible && !covered;
        if (!show) {
            this.clearReshow();
            if (win.isVisible()) {
                win.hide();
            }
            return;
        }
        if (win.isVisible()) {
            return;
        }
        const wait = this.uncoveredAt + exports.HUD_RESHOW_DELAY_MS - now;
        if (this.uncoveredAt > 0 && wait > 0) {
            if (!this.reshowTimer) {
                this.reshowTimer = setTimeout(() => {
                    this.reshowTimer = undefined;
                    if (!this.destroyed) {
                        this.applyVisibility();
                    }
                }, wait);
            }
            return;
        }
        if (!this.loaded) {
            return; // shown once its page has loaded and rendered (did-finish-load)
        }
        this.clearReshow();
        win.showInactive();
    }
    clearReshow() {
        if (this.reshowTimer) {
            clearTimeout(this.reshowTimer);
            this.reshowTimer = undefined;
        }
    }
    onStop(cb) {
        this.stopCbs.push(cb);
    }
    onCoveredChange(cb) {
        this.coveredCbs.push(cb);
    }
    onResume(cb) {
        this.resumeCbs.push(cb);
    }
    onStopAgent(cb) {
        this.stopAgentCbs.push(cb);
    }
    ensureWindow() {
        if (this.win && !this.win.isDestroyed()) {
            return this.win;
        }
        const area = electron_1.screen.getPrimaryDisplay().workArea;
        const win = new electron_1.BrowserWindow({
            width: HUD_WIDTH,
            height: hudHeight(this.rows.length),
            x: Math.round(area.x + (area.width - HUD_WIDTH) / 2),
            y: area.y + 8,
            frame: false,
            transparent: true,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            focusable: false,
            skipTaskbar: true,
            hasShadow: true,
            alwaysOnTop: true,
            show: false,
            title: 'AGY Desktop HUD',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
            },
        });
        // Not a Hub UI window: never reloaded with the Hub URL or targeted by
        // window commands (hubWindows.ts).
        (0, hubWindows_1.registerAuxWindow)(win);
        win.setAlwaysOnTop(true, 'screen-saver');
        // visibleOnFullScreen alone makes Electron transform the whole process
        // into a UIElement (no Dock icon, no Cmd-Tab: #1509); skip that, and put
        // a regular policy back if it was lost anyway.
        const wasRegular = process.platform === 'darwin' && electron_1.app.dock?.isVisible() === true;
        win.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true,
            skipTransformProcessType: true,
        });
        if (wasRegular && electron_1.app.dock?.isVisible() === false) {
            electron_1.app.setActivationPolicy('regular');
        }
        // Keep the HUD out of the agent's screenshots.
        win.setContentProtection(true);
        // Electron >= 35 passes one event object; older versions pass
        // (event, level, message, ...). Accept both.
        const onConsole = (...args) => {
            const ev = args[0];
            const message = typeof ev?.message === 'string' ? ev.message : String(args[2] ?? '');
            if (message === MSG_STOP) {
                this.stopCbs.forEach((cb) => cb());
            }
            else if (message === MSG_RESUME) {
                this.resumeCbs.forEach((cb) => cb());
            }
            else {
                const token = (0, hudAgents_1.stopAgentToken)(message);
                const actorId = token === undefined
                    ? undefined
                    : this.tokens.actorFor(token, this.rows);
                if (actorId !== undefined) {
                    this.stopAgentCbs.forEach((cb) => cb(actorId));
                }
            }
        };
        win.webContents.on('console-message', onConsole);
        this.loaded = false;
        // Never shown before the page rendered this state (no flash of the
        // default green, e.g. when paused or in the background).
        win.webContents.on('did-finish-load', () => {
            if (this.win !== null && this.win !== win) {
                return;
            }
            this.loaded = true;
            this.render();
            this.applyVisibility();
        });
        // A crashed HUD page: drop the window and build a fresh one.
        win.webContents.on('render-process-gone', () => {
            if (this.win !== win) {
                return;
            }
            this.win = null;
            this.loaded = false;
            if (!win.isDestroyed()) {
                win.destroy();
            }
            if (!this.destroyed) {
                this.setState(this.state);
            }
        });
        void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HUD_HTML));
        this.win = win;
        return win;
    }
    render() {
        if (!this.win || this.win.isDestroyed()) {
            return;
        }
        // data-state on <body> is for E2E checks.
        const view = (0, hudState_1.hudView)(this.state);
        const state = view.state;
        const text = (0, hudAgents_1.hudAgentsHeadline)(view.text, this.rows);
        const rows = this.rows.map((r) => ({
            token: this.tokens.token(r.actorId),
            text: r.text,
            color: r.color,
            stopped: r.stopped,
        }));
        void this.win.webContents
            .executeJavaScript(`window.__agyHudSetState && window.__agyHudSetState(${this.state.paused}, ${JSON.stringify(text)}, ${JSON.stringify(state)}); ` +
            `window.__agyHudSetAgents && window.__agyHudSetAgents(${JSON.stringify(rows)})`)
            .catch(() => { });
        const [w, h] = this.win.getSize();
        const want = hudHeight(this.rows.length);
        if (h !== want) {
            this.win.setSize(w, want);
        }
    }
    setAgents(rows) {
        if (this.destroyed) {
            return;
        }
        this.rows = [...rows];
        this.render();
    }
    setState(state) {
        if (this.destroyed) {
            return;
        }
        this.state = {
            agentActive: state.agentActive,
            paused: state.paused,
            mode: state.mode,
            appName: state.appName,
        };
        if (!(0, hudState_1.hudView)(this.state).visible) {
            // Nothing to show again: a pending reshow would only fire for nothing.
            this.clearReshow();
            if (this.win && !this.win.isDestroyed()) {
                // Keep the (hidden) DOM in sync too, so it never shows a stale state.
                this.render();
                this.win.hide();
            }
            return;
        }
        this.hubFocused = this.focus.isHubFocused();
        this.ensureWindow();
        // The DOM stays current while hidden behind the focused Hub's pane.
        this.render();
        this.applyVisibility();
    }
    destroy() {
        this.destroyed = true;
        this.clearReshow();
        this.unsubscribeFocus();
        if (this.win && !this.win.isDestroyed()) {
            this.win.destroy();
        }
        this.win = null;
    }
}
exports.DesktopHud = DesktopHud;
