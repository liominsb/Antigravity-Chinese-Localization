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
exports.headlessConfig = headlessConfig;
exports.runHeadless = runHeadless;
/**
 * The headless desktop host (`node dist/desktopHost/main.js`): serves the
 * `computer` actuator on a machine that runs no Hub (P3 §7). No Electron.
 *
 * Configuration (env):
 * - AGY_LS_PORT / AGY_LS_CSRF: the language server's port and CSRF token
 *   (required);
 * - AGY_DESKTOP_HELPER / AGY_DESKTOP_RTC / AGY_DESKTOP_SCRIPT: paths of
 *   agy-desktop-helper, the agy-desktop-rtc sidecar and agy-desktop-script
 *   (default: ../../bin next to this file; script mode only when the script
 *   binary is there and its sandbox selftest passes);
 * - AGY_MAX_PREVIEW_SLOTS: windows the preview shows at once (1..12,
 *   default 6);
 * - AGY_DESKTOP_HOST_DIR: state (actuator id, pause; default
 *   ~/.agy-desktop-host);
 * - AGY_DESKTOP_ENDPOINT=0 or the kill-switch file: unsubscribed.
 *
 * The live preview needs a viewer to signal with: local signaling is the
 * Hub's IPC, remote signaling the `computer_viewer` actuator (P3-2). The
 * headless host serves remote viewers with AGY_DESKTOP_REMOTE_VIEW=1 (off by
 * default); AGY_DESKTOP_PREVIEW=1 alone runs the frame path for tests.
 */
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const actuatorClient_1 = require("./actuatorClient");
const config_1 = require("./config");
const host_1 = require("./host");
const protocol_1 = require("./protocol");
/** The config from the environment, or an error message. */
function headlessConfig(env = process.env) {
    const port = Number(env.AGY_LS_PORT);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return 'AGY_LS_PORT must be the language server port';
    }
    const csrf = env.AGY_LS_CSRF ?? '';
    if (!csrf) {
        return 'AGY_LS_CSRF must be the language server CSRF token';
    }
    return {
        port,
        csrf,
        helperPath: env.AGY_DESKTOP_HELPER ||
            path.join(__dirname, '..', '..', 'bin', 'agy-desktop-helper'),
        rtcPath: env.AGY_DESKTOP_RTC ||
            path.join(__dirname, '..', '..', 'bin', 'agy-desktop-rtc'),
        scriptPath: env.AGY_DESKTOP_SCRIPT ||
            path.join(__dirname, '..', '..', 'bin', 'agy-desktop-script'),
        stateDir: env.AGY_DESKTOP_HOST_DIR || path.join(os.homedir(), '.agy-desktop-host'),
        preview: env.AGY_DESKTOP_PREVIEW === '1' || env.AGY_DESKTOP_REMOTE_VIEW === '1',
        remoteView: env.AGY_DESKTOP_REMOTE_VIEW === '1',
        previewSlots: (0, protocol_1.clampVideoSlots)(env.AGY_MAX_PREVIEW_SLOTS),
    };
}
async function runHeadless(cfg) {
    fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
    const conn = { port: cfg.port, csrf: cfg.csrf };
    const { client, transports } = (0, actuatorClient_1.createNodeActuatorClient)({
        clientName: 'desktop-host',
        clientVersion: '0.0.0',
        connection: () => conn,
    });
    const host = (0, host_1.startDesktopHost)({
        client,
        clientName: 'desktop-host',
        helperPath: cfg.helperPath,
        scriptPath: fs.existsSync(cfg.scriptPath) ? cfg.scriptPath : undefined,
        actuatorId: (0, config_1.persistedActuatorId)(path.join(cfg.stateDir, 'desktop_endpoint_id')),
        pauseStore: (0, config_1.filePauseStore)(path.join(cfg.stateDir, 'desktop_pause.json')),
        preview: cfg.preview
            ? { rtcPath: cfg.rtcPath, maxSlots: cfg.previewSlots }
            : undefined,
        remoteView: cfg.remoteView
            ? {
                desktopLabel: os.hostname(),
                pairingFile: path.join(cfg.stateDir, 'desktop_view_pairings.json'),
            }
            : undefined,
    });
    client.start();
    return async () => {
        await host.stop();
        try {
            await client.stop();
        }
        finally {
            transports.close();
        }
    };
}
if (require.main === module) {
    const cfg = headlessConfig();
    if (typeof cfg === 'string') {
        console.error(`[DesktopHost] ${cfg}`);
        process.exit(2);
    }
    if (process.platform !== 'darwin') {
        console.error('[DesktopHost] macOS only');
        process.exit(2);
    }
    void runHeadless(cfg).then((stop) => {
        let stopping = false;
        const quit = () => {
            if (stopping) {
                return;
            }
            stopping = true;
            void stop().finally(() => process.exit(0));
        };
        process.on('SIGINT', quit);
        process.on('SIGTERM', quit);
    });
}
