"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STOP_CHANNELS = void 0;
exports.registerComputerStopIpc = registerComputerStopIpc;
exports.previewUnavailable = previewUnavailable;
exports.previewOpenFailed = previewOpenFailed;
exports.registerComputerPreviewIpc = registerComputerPreviewIpc;
/**
 * Local signaling for the computer pane's live preview (P3-1): the renderer
 * (preload `window.agyComputerPreview`) opens a WebRTC session with the
 * embedded desktop host over IPC. Renderer <-> main only; media never
 * touches IPC.
 *
 * Only the top frame of a registered local Hub UI window showing the Hub UI
 * may call it (previewViewers.ts; not SSH windows, popups, webview guests or
 * subframes), and
 * a session belongs to the webContents that opened it: only
 * it can answer, renew or close it, and its sessions close when it goes
 * away. SDP is never logged.
 *
 * Stop all / Stop agent (`computer-preview:stop-all`, `:stop-agent`) take the
 * same host path as the viewer's DataChannel messages but need no session,
 * so the Agents pane can stop agents while the preview is down.
 */
const electron_1 = require("electron");
const remoteWindowSecurity_1 = require("../remote/remoteWindowSecurity");
const protocol_1 = require("../desktopHost/protocol");
const index_1 = require("./index");
const permissionsIpc_1 = require("./permissionsIpc");
const previewViewers_1 = require("./previewViewers");
const owners = new Map();
const watched = new Set();
/** Previews whose session closes we already listen to (owner cleanup). */
const hooked = new WeakSet();
function checkSender(e) {
    const wc = e.sender;
    if (wc.getType() !== 'window' ||
        e.senderFrame !== wc.mainFrame ||
        // An SSH window shows another computer's Hub, never this desktop.
        (0, remoteWindowSecurity_1.isRemoteContents)(wc) ||
        !(0, previewViewers_1.isPreviewViewer)(wc)) {
        throw new Error('computer preview: not allowed from this frame');
    }
    return wc;
}
function owned(e, sessionId) {
    const wc = checkSender(e);
    if (typeof sessionId !== 'string' || owners.get(sessionId) !== wc.id) {
        throw new Error('computer preview: unknown session');
    }
    return sessionId;
}
function preview() {
    const p = (0, index_1.computerPreview)();
    if (!p) {
        throw new Error('computer preview is not available');
    }
    return p;
}
exports.STOP_CHANNELS = Object.freeze({
    stopAll: 'computer-preview:stop-all',
    stopAgent: 'computer-preview:stop-agent',
});
/**
 * Stop all / Stop agent for the Hub UI. With computer use off they resolve
 * as no-ops (nothing can run), so the Agents pane's Stop never errors.
 */
function registerComputerStopIpc(computerUseOn) {
    if (!computerUseOn) {
        electron_1.ipcMain.handle(exports.STOP_CHANNELS.stopAll, () => { });
        electron_1.ipcMain.handle(exports.STOP_CHANNELS.stopAgent, () => { });
        return;
    }
    electron_1.ipcMain.handle(exports.STOP_CHANNELS.stopAll, async (e) => {
        checkSender(e);
        await (0, index_1.stopAllComputerAgents)('Agents pane Stop');
    });
    electron_1.ipcMain.handle(exports.STOP_CHANNELS.stopAgent, (e, actorId) => {
        checkSender(e);
        if (!(0, protocol_1.isActorId)(actorId)) {
            throw new Error('computer preview: bad actor id');
        }
        (0, index_1.stopComputerAgent)(actorId);
    });
}
/** The failure for an open with no preview running. */
function previewUnavailable(sidecarMissing) {
    return sidecarMissing
        ? {
            ok: false,
            error: {
                code: 'SIDECAR_MISSING',
                message: 'live preview unavailable: agy-desktop-rtc is not installed',
            },
        }
        : {
            ok: false,
            error: {
                code: 'UNAVAILABLE',
                message: 'computer preview is not available',
            },
        };
}
/** The failure for an open that threw (never SDP: an error message only). */
function previewOpenFailed(err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    // DesktopHelper fails what waits on a child that never spawned this way.
    const code = /helper spawn error/.test(message)
        ? 'SPAWN_FAILED'
        : 'OPEN_FAILED';
    return { ok: false, error: { code, message } };
}
function registerComputerPreviewIpc() {
    // The permission onboarding card (macOS TCC); works with the preview off.
    (0, permissionsIpc_1.registerComputerPermissionsIpc)();
    electron_1.ipcMain.handle('computer-preview:open', async (e) => {
        const wc = checkSender(e);
        const p = (0, index_1.computerPreview)();
        if (!p) {
            return previewUnavailable((0, index_1.previewSidecarMissing)());
        }
        if (!hooked.has(p)) {
            hooked.add(p);
            // TTL expiry, PC failure, DataChannel close: forget the owner too.
            p.onClosed((sid) => owners.delete(sid));
        }
        let offer;
        try {
            offer = await p.open();
        }
        catch (err) {
            console.warn('[ComputerUse] preview open failed:', err);
            return previewOpenFailed(err);
        }
        if (wc.isDestroyed()) {
            // The window went away while the offer was gathered.
            p.close(offer.sessionId);
            throw new Error('computer preview: the window closed');
        }
        owners.set(offer.sessionId, wc.id);
        if (!watched.has(wc.id)) {
            watched.add(wc.id);
            const id = wc.id;
            wc.once('destroyed', () => {
                watched.delete(id);
                for (const [sid, owner] of [...owners]) {
                    if (owner === id) {
                        owners.delete(sid);
                        (0, index_1.computerPreview)()?.close(sid);
                    }
                }
            });
        }
        return { ok: true, ...offer };
    });
    electron_1.ipcMain.handle('computer-preview:get-active', (e) => {
        checkSender(e);
        return (0, previewViewers_1.previewAgentsActive)();
    });
    electron_1.ipcMain.handle('computer-preview:get-active-agents', (e) => {
        checkSender(e);
        return (0, previewViewers_1.previewActiveAgents)();
    });
    electron_1.ipcMain.handle('computer-preview:answer', async (e, sessionId, sdp) => {
        await preview().answer(owned(e, sessionId), sdp);
    });
    electron_1.ipcMain.handle('computer-preview:renew', (e, sessionId) => {
        const id = owned(e, sessionId);
        const ok = preview().renew(id);
        if (!ok) {
            owners.delete(id);
        }
        return ok;
    });
    electron_1.ipcMain.handle('computer-preview:close', (e, sessionId) => {
        let id;
        try {
            id = owned(e, sessionId);
        }
        catch {
            return; // closing something unknown is a no-op
        }
        owners.delete(id);
        (0, index_1.computerPreview)()?.close(id);
    });
}
