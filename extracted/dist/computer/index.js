"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUNDLED_HELPER_CONFINEMENT = exports.BUNDLED_HELPER_VERSION = exports.BUNDLED_HELPER_PROTOCOL = exports.persistedActuatorId = exports.makeActuatorId = exports.killSwitchEngaged = exports.KILL_SWITCH_FILE = exports.filePauseStore = exports.confinementCap = void 0;
exports.computerUseEnabledAtStartup = computerUseEnabledAtStartup;
exports.previewSlotsAtStartup = previewSlotsAtStartup;
exports.electronHelperProbe = electronHelperProbe;
exports.idleHelperProbe = idleHelperProbe;
exports.desktopHelperPath = desktopHelperPath;
exports.desktopScriptPath = desktopScriptPath;
exports.desktopRtcPath = desktopRtcPath;
exports.previewEnabled = previewEnabled;
exports.previewSidecarInstalled = previewSidecarInstalled;
exports.previewSidecarMissing = previewSidecarMissing;
exports.configurePreviewWebRtc = configurePreviewWebRtc;
exports.remoteViewEnabled = remoteViewEnabled;
exports.computerPreview = computerPreview;
exports.stopAllComputerAgents = stopAllComputerAgents;
exports.stopComputerAgent = stopComputerAgent;
exports.registerComputerUse = registerComputerUse;
exports.refreshComputerHello = refreshComputerHello;
exports.unregisterComputerUse = unregisterComputerUse;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const mainClient_1 = require("../actuator/mainClient");
const config_1 = require("../desktopHost/config");
const paths_1 = require("../paths");
const storage_1 = require("../storage");
const utils_1 = require("../utils");
const desktopHelper_1 = require("./desktopHelper");
const gate_1 = require("./gate");
const host_1 = require("../desktopHost/host");
const hud_1 = require("./hud");
const hudAgents_1 = require("./hudAgents");
const previewViewers_1 = require("./previewViewers");
const screenLock_1 = require("./screenLock");
var config_2 = require("../desktopHost/config");
Object.defineProperty(exports, "confinementCap", { enumerable: true, get: function () { return config_2.confinementCap; } });
Object.defineProperty(exports, "filePauseStore", { enumerable: true, get: function () { return config_2.filePauseStore; } });
Object.defineProperty(exports, "KILL_SWITCH_FILE", { enumerable: true, get: function () { return config_2.KILL_SWITCH_FILE; } });
Object.defineProperty(exports, "killSwitchEngaged", { enumerable: true, get: function () { return config_2.killSwitchEngaged; } });
Object.defineProperty(exports, "makeActuatorId", { enumerable: true, get: function () { return config_2.makeActuatorId; } });
Object.defineProperty(exports, "persistedActuatorId", { enumerable: true, get: function () { return config_2.persistedActuatorId; } });
/** The overrides computer use reads: none (no AGY_*) in a packaged app. */
function env() {
    return (0, gate_1.cuaEnv)(process.env, electron_1.app.isPackaged);
}
/**
 * Whether computer use starts in this run (src/computer/gate.ts): the
 * `enable-agy-hub-cua-macos` override in app storage, or AGY_ENABLE_CUA=1
 * in an unpackaged build. Synchronous, so it can gate the pre-ready WebRTC
 * switch; read once per run.
 */
function computerUseEnabledAtStartup() {
    // The helper needs macOS 14 (ScreenCaptureKit APIs; the build target).
    if (process.platform !== 'darwin' || macOSMajor() < 14) {
        return false;
    }
    return (0, gate_1.isComputerUseEnabled)(appItems(), process.env, electron_1.app.isPackaged);
}
/** The app storage items (the startup settings), {} if unreadable. */
function appItems() {
    try {
        return new storage_1.StorageManager((0, paths_1.getAppStoragePath)()).getItemsSync();
    }
    catch (err) {
        console.error('[ComputerUse] could not read app storage:', err);
        return {};
    }
}
/**
 * Windows the live preview shows at once: `computer.maxPreviewSlots`
 * (1..12, default 6), read at startup.
 */
function previewSlotsAtStartup() {
    return (0, gate_1.resolveMaxPreviewSlots)(appItems(), process.env, electron_1.app.isPackaged);
}
/** The running macOS major version (Electron), 0 when unknown. */
function macOSMajor() {
    const v = typeof process.getSystemVersion === 'function'
        ? process.getSystemVersion()
        : '';
    return Number.parseInt(v.split('.')[0] ?? '', 10) || 0;
}
/** Bundled helper constants (desktop-helper/Common.swift, Confinement.swift). */
exports.BUNDLED_HELPER_PROTOCOL = 1;
exports.BUNDLED_HELPER_VERSION = '0.2.0';
exports.BUNDLED_HELPER_CONFINEMENT = 3;
/**
 * The surface info from Electron: the main display, the Hub process's TCC
 * grants and the bundled helper's versions. Only a fallback for
 * {@link idleHelperProbe}: the helper (the Hub's child, so charged to the
 * same responsible process) has the same grants, but Electron's Screen
 * Recording read is cached for the Hub's lifetime, so it goes stale.
 */
function electronHelperProbe() {
    const d = electron_1.screen.getPrimaryDisplay();
    const scale = d.scaleFactor || 1;
    return {
        ok: true,
        protocol_version: exports.BUNDLED_HELPER_PROTOCOL,
        helper_version: exports.BUNDLED_HELPER_VERSION,
        confinement_version: exports.BUNDLED_HELPER_CONFINEMENT,
        agent_queues: true,
        os_version: typeof process.getSystemVersion === 'function'
            ? `macOS ${process.getSystemVersion()}`
            : 'macOS',
        geometry: {
            display_id: d.id,
            width_points: d.bounds.width,
            height_points: d.bounds.height,
            width_pixels: Math.round(d.bounds.width * scale),
            height_pixels: Math.round(d.bounds.height * scale),
            scale_factor: scale,
        },
        grants: {
            accessibility: electron_1.systemPreferences.isTrustedAccessibilityClient(false),
            screen_recording: electron_1.systemPreferences.getMediaAccessStatus('screen') === 'granted',
        },
    };
}
let idleProbeInFlight;
let idleProbeFailing = false;
/**
 * The actuator Hello's surface info while the helper hasn't started: a
 * one-shot `agy-desktop-helper probe`, so the grants the LS gates on (before
 * any consent card) are the actuating binary's, read fresh on every Hello
 * refresh (registerComputerActuator's timer re-advertises a change). Falls
 * back to {@link electronHelperProbe} when the probe fails. Concurrent calls
 * share one probe.
 */
function idleHelperProbe(probeOnce = () => (0, desktopHelper_1.probeHelperOnce)(desktopHelperPath(), (0, gate_1.helperEnv)(process.env, electron_1.app.isPackaged))) {
    idleProbeInFlight ?? (idleProbeInFlight = probeOnce()
        .then((p) => {
        idleProbeFailing = false;
        return p;
    })
        .catch((err) => {
        if (!idleProbeFailing) {
            idleProbeFailing = true;
            console.warn('[ComputerUse] helper probe failed; reporting the Hub grants:', err);
        }
        return electronHelperProbe();
    })
        .finally(() => {
        idleProbeInFlight = undefined;
    }));
    return idleProbeInFlight;
}
/** Hub window focus for the HUD (Hub windows are BaseWindows). */
const hubFocusSource = {
    isHubFocused: () => !!(0, utils_1.getFocusedHubWindow)(),
    onChange: (cb) => (0, utils_1.onHubWindowFocusChange)(cb),
};
/**
 * Wires computer use into the Hub main process: the desktop host
 * (src/desktopHost: helper, Mac surface, Layer 2 on the shared main-process
 * ActuatorClient, overlay cursors, kill switch, persisted pause, and the P3
 * live preview) plus what needs Electron: the HUD (and its agent list), the
 * userData paths (main.ts tears it down on a confirmed quit). macOS only; a
 * no-op elsewhere.
 */
let host;
let hud;
let unwatchScreenLock;
/** Path of the Swift helper next to the language server binary. */
function desktopHelperPath() {
    return electron_1.app.isPackaged
        ? path.join(process.resourcesPath, 'bin', 'agy-desktop-helper')
        : path.join(__dirname, '..', '..', 'bin', 'agy-desktop-helper');
}
/**
 * Path of agy-desktop-script (script mode's sandboxed child), next to the
 * helper; undefined when it isn't there (supports_script stays off).
 */
function desktopScriptPath(exists = fs.existsSync) {
    const p = electron_1.app.isPackaged
        ? path.join(process.resourcesPath, 'bin', 'agy-desktop-script')
        : path.join(__dirname, '..', '..', 'bin', 'agy-desktop-script');
    return exists(p) ? p : undefined;
}
/**
 * Path of the agy-desktop-rtc sidecar (pion WebRTC, P3 d1), next to the
 * helper; AGY_DESKTOP_RTC overrides it.
 */
function desktopRtcPath(e = env()) {
    if (e.AGY_DESKTOP_RTC) {
        return e.AGY_DESKTOP_RTC;
    }
    return electron_1.app.isPackaged
        ? path.join(process.resourcesPath, 'bin', 'agy-desktop-rtc')
        : path.join(__dirname, '..', '..', 'bin', 'agy-desktop-rtc');
}
/**
 * AGY_DESKTOP_PREVIEW=0 turns the live preview (P3) off; it is on by
 * default in the Hub.
 */
function previewEnabled(e = env()) {
    return e.AGY_DESKTOP_PREVIEW !== '0';
}
/**
 * Whether the agy-desktop-rtc sidecar is at `rtcPath`. A checkout run
 * without scripts/install_desktop_rtc.sh has none: the host then starts
 * without the preview, logged here once, instead of every pane open failing
 * with a spawn ENOENT.
 */
function previewSidecarInstalled(rtcPath, exists = fs.existsSync, log = (m) => console.warn(m)) {
    if (exists(rtcPath)) {
        return true;
    }
    log(`[ComputerUse] live preview unavailable: no agy-desktop-rtc at ${rtcPath} (scripts/install_desktop_rtc.sh installs it)`);
    return false;
}
/** Set when the preview is on but its sidecar isn't installed. */
let rtcMissing = false;
/** Whether the preview is off because agy-desktop-rtc isn't installed. */
function previewSidecarMissing() {
    return rtcMissing;
}
/**
 * Lets the Hub UI (only) reach the desktop host over loopback WebRTC; see
 * previewViewers.ts. Call before the app is ready.
 */
function configurePreviewWebRtc(lsPort, e = env()) {
    (0, previewViewers_1.configurePreviewWebRtc)(previewEnabled(e), lsPort);
}
/**
 * AGY_DESKTOP_REMOTE_VIEW=1 turns remote viewing (P3-2, paired devices via
 * the LS) on; it is off by default and needs the preview.
 */
function remoteViewEnabled(e = env()) {
    return e.AGY_DESKTOP_REMOTE_VIEW === '1' && previewEnabled(e);
}
/** The live preview for the renderer's computer pane, if running. */
function computerPreview() {
    return host?.preview;
}
/**
 * The user's Stop all from the Hub UI: the same host path as the live
 * preview's `stopAll` viewer message, so it works without a preview session.
 * A no-op while computer use isn't running.
 */
async function stopAllComputerAgents(detail) {
    await host?.stopAll(detail);
}
/**
 * The user stopped one agent from the Hub UI: the same host path as the live
 * preview's `stopAgent` viewer message. A no-op while computer use isn't
 * running.
 */
function stopComputerAgent(actorId) {
    host?.stopAgent(actorId);
}
/**
 * Registers computer use with the main-process ActuatorClient (by default
 * `getMainActuatorClient()`), which owns the LS connection (port changes,
 * reconnects). Safe to call repeatedly.
 */
function registerComputerUse(opts = {}) {
    if (process.platform !== 'darwin' || host) {
        return;
    }
    try {
        const userData = electron_1.app.getPath('userData');
        // The helper denies the Hub itself by pid and bundle path.
        const bundlePath = path.resolve(process.execPath, '..', '..', '..');
        const h = opts.headless
            ? undefined
            : new hud_1.DesktopHud(hubFocusSource);
        hud = h;
        const e = env();
        const rtcPath = desktopRtcPath(e);
        // previewEnabled() alone still gates the viewer allowlist and the pane's
        // agents-active pushes, so the pane auto-opens and can say why.
        const preview = previewEnabled(e) && previewSidecarInstalled(rtcPath);
        rtcMissing = previewEnabled(e) && !preview;
        const started = (0, host_1.startDesktopHost)({
            client: opts.client ?? (0, mainClient_1.getMainActuatorClient)(),
            clientName: opts.client ? 'custom' : 'hub-main',
            helperPath: desktopHelperPath(),
            helperArgs: ['--hub-pid', String(process.pid), '--hub-path', bundlePath],
            // Packaged: PATH, HOME, TMPDIR and LANG only (no AGY_*, DYLD_*).
            helperEnv: (0, gate_1.helperEnv)(process.env, electron_1.app.isPackaged),
            // Script mode when the sandboxed child ships next to the helper.
            scriptPath: desktopScriptPath(),
            // The helper starts with the first desktop request, not here.
            idleProbe: idleHelperProbe,
            killSwitch: () => (0, config_1.killSwitchEngaged)(e),
            maxConfinementVersion: () => (0, config_1.confinementCap)(e),
            actuatorId: (0, config_1.persistedActuatorId)(path.join(userData, 'desktop_endpoint_id')),
            pauseStore: (0, config_1.filePauseStore)(path.join(userData, 'desktop_pause.json')),
            preview: preview
                ? { rtcPath, maxSlots: previewSlotsAtStartup() }
                : undefined,
            // Remote viewing needs the preview (startDesktopHost throws without).
            remoteView: preview && remoteViewEnabled(e)
                ? {
                    desktopLabel: electron_1.app.getName(),
                    pairingFile: path.join(userData, 'desktop_view_pairings.json'),
                }
                : undefined,
            onState: (s) => {
                h?.setState({
                    agentActive: s.agentActive,
                    paused: s.paused,
                    pauseCause: s.pauseCause,
                    mode: s.mode,
                    appName: s.appName,
                });
                h?.setAgents?.((0, hudAgents_1.hudAgentRows)(s));
                (0, previewViewers_1.setPreviewAgentsActive)(s.agentActive && !s.paused);
                (0, previewViewers_1.setPreviewActiveAgents)(s.agents.filter((a) => !a.stopped).map((a) => a.actor.id));
            },
            // The HUD hides behind a focused Hub only while its pane is viewing.
            onLocalViewers: (n) => h?.setLocalViewer?.(n > 0),
            log: (m) => console.log(m),
        });
        host = started;
        h?.onStop(() => void started.stopAll('HUD Stop button'));
        h?.onResume(() => void started.resume());
        h?.onStopAgent?.((actorId) => started.stopAgent(actorId));
        // The same cover hides the desktop overlay marks around the Hub.
        h?.onCoveredChange?.((c) => started.setOverlaySuppressed(c));
        // The Agents pane says agents wait for an unlock instead of "idle".
        unwatchScreenLock = (0, screenLock_1.watchScreenLock)(electron_1.powerMonitor, (l) => started.setScreenLocked(l));
        // main.ts's confirmed-quit path calls unregisterComputerUse() (rt P3-21):
        // a bare 'before-quit' hook would run before the Cmd+Q confirmation, so
        // Cancel would leave computer use torn down.
    }
    catch (err) {
        // Never let computer use break Hub startup.
        console.error('[ComputerUse] failed to register:', err);
    }
}
/**
 * Re-sends the computer actuator's Hello, e.g. after a TCC grant changed, so
 * the LS sees the new permission state at once. A no-op while computer use is
 * off.
 */
async function refreshComputerHello() {
    await host?.registration.refreshHello();
}
/** Unsubscribes (GOING_AWAY), stops the host and closes the HUD. */
async function unregisterComputerUse() {
    const h = host;
    host = undefined;
    unwatchScreenLock?.();
    unwatchScreenLock = undefined;
    await h?.stop();
    hud?.destroy();
    hud = undefined;
}
