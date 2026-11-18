"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ACTIVE_AGENT_IDS = void 0;
exports.isHubUiUrl = isHubUiUrl;
exports.previewPolicyFor = previewPolicyFor;
exports.isPreviewViewer = isPreviewViewer;
exports.configurePreviewWebRtc = configurePreviewWebRtc;
exports.previewAgentsActive = previewAgentsActive;
exports.setPreviewAgentsActive = setPreviewAgentsActive;
exports.activeAgentIds = activeAgentIds;
exports.previewActiveAgents = previewActiveAgents;
exports.setPreviewActiveAgents = setPreviewActiveAgents;
exports.registerPreviewViewer = registerPreviewViewer;
/**
 * Which WebContents may use loopback WebRTC (the computer pane's preview,
 * P3-1). `--allow-loopback-in-peer-connection` is process-wide, so it is
 * paired with an allowlist (rt-security P2-SEC-P3H-1):
 *
 * - every WebContents starts on `default_public_interface_only` (no loopback
 *   or LAN candidates): popups, webview guests, views, offscreen pages;
 * - only a Hub UI window registered at creation (utils.createWindow) gets
 *   `default`, and only while its main frame shows the Hub UI origin; any
 *   other navigation puts it back first;
 * - the preview IPC accepts only those WebContents (previewIpc.ts).
 */
const electron_1 = require("electron");
const constants_1 = require("../constants");
const RESTRICTED = 'default_public_interface_only';
const viewers = new Set();
let configured = false;
/** The LS port the Hub UI is served on (0 while unknown). */
let lsPort = () => 0;
/**
 * True for the Hub UI: https://127.0.0.1:<the LS port>/ (the LS-served app;
 * no other local TLS server qualifies, and nothing does while the port is
 * unknown), or the DEV_URL origin in development.
 */
function isHubUiUrl(url, devUrl = process.env.DEV_URL, port = lsPort()) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return false;
    }
    if (devUrl) {
        try {
            if (u.origin === new URL(devUrl).origin) {
                return true;
            }
        }
        catch {
            // a bad DEV_URL allows nothing extra
        }
    }
    const hub = new URL(constants_1.WINDOW_ORIGIN);
    return (u.protocol === hub.protocol &&
        u.hostname === hub.hostname &&
        Number.isInteger(port) &&
        port > 0 &&
        u.port === String(port));
}
/** The WebRTC IP handling policy a WebContents gets. */
function previewPolicyFor(registered, url, devUrl, port) {
    return registered && isHubUiUrl(url, devUrl, port) ? 'default' : RESTRICTED;
}
/** May this WebContents signal with the desktop host? */
function isPreviewViewer(wc) {
    return (configured &&
        !wc.isDestroyed() &&
        viewers.has(wc.id) &&
        wc.getType() === 'window' &&
        isHubUiUrl(wc.getURL()));
}
/**
 * Turns loopback WebRTC on for the Hub UI only. Call before the app is
 * ready; darwin with the preview on.
 */
function configurePreviewWebRtc(enabled, currentLsPort) {
    if (process.platform !== 'darwin' || !enabled || configured) {
        return;
    }
    configured = true;
    lsPort = currentLsPort;
    electron_1.app.commandLine.appendSwitch('allow-loopback-in-peer-connection');
    electron_1.app.on('web-contents-created', (_event, wc) => {
        wc.setWebRTCIPHandlingPolicy(RESTRICTED);
    });
}
let agentsActive = false;
/** Whether some agent works on the computer now (for the pane's auto-open). */
function previewAgentsActive() {
    return agentsActive;
}
/**
 * Tells the Hub UI windows whether some agent works on the computer now
 * (`computer-preview:active`), so the Agents pane can auto-open without a
 * session. Sent on change only, to registered windows showing the Hub UI.
 */
function setPreviewAgentsActive(active) {
    if (active === agentsActive) {
        return;
    }
    agentsActive = active;
    if (!configured) {
        return;
    }
    for (const wc of electron_1.webContents.getAllWebContents()) {
        if (isPreviewViewer(wc)) {
            wc.send('computer-preview:active', active);
        }
    }
}
/** Most actor ids sent to the UI (the LS caps concurrent agents far lower). */
exports.MAX_ACTIVE_AGENT_IDS = 32;
const ACTOR_ID = /^[\x21-\x7e]{1,128}$/;
/** Well-formed actor ids, de-duplicated, sorted and capped. */
function activeAgentIds(ids) {
    return [
        ...new Set(ids.filter((x) => typeof x === 'string' && ACTOR_ID.test(x))),
    ]
        .sort()
        .slice(0, exports.MAX_ACTIVE_AGENT_IDS);
}
let activeAgents = [];
/** The agents holding a computer lease that the user did not stop. */
function previewActiveAgents() {
    return [...activeAgents];
}
/**
 * Tells the Hub UI windows which agents hold a computer lease and were not
 * stopped (`computer-preview:active-agents`), so the Agents pane can auto-open
 * per new agent without a session. Sent on change only, to registered windows
 * showing the Hub UI.
 */
function setPreviewActiveAgents(ids) {
    const next = activeAgentIds(ids);
    if (next.join('\n') === activeAgents.join('\n')) {
        return;
    }
    activeAgents = next;
    if (!configured) {
        return;
    }
    for (const wc of electron_1.webContents.getAllWebContents()) {
        if (isPreviewViewer(wc)) {
            wc.send('computer-preview:active-agents', [...next]);
        }
    }
}
/** Registers a Hub UI window's WebContents (from utils.createWindow). */
function registerPreviewViewer(wc) {
    if (!configured) {
        return;
    }
    const id = wc.id;
    viewers.add(id);
    const apply = (url) => {
        if (!wc.isDestroyed()) {
            wc.setWebRTCIPHandlingPolicy(previewPolicyFor(viewers.has(id), url));
        }
    };
    // Restrict before a main-frame navigation leaves the Hub UI; re-check once
    // it committed.
    wc.on('did-start-navigation', (details) => {
        if (details.isMainFrame) {
            apply(details.url);
        }
    });
    wc.on('did-navigate', (_e, url) => apply(url));
    wc.once('destroyed', () => viewers.delete(id));
    apply(wc.getURL());
}
