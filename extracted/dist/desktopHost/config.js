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
exports.KILL_SWITCH_POLL_MS = exports.KILL_SWITCH_FILE = void 0;
exports.makeActuatorId = makeActuatorId;
exports.persistedActuatorId = persistedActuatorId;
exports.filePauseStore = filePauseStore;
exports.killSwitchEngaged = killSwitchEngaged;
exports.confinementCap = confinementCap;
/**
 * Desktop host configuration helpers (moved from src/computer/index.ts so the
 * headless host can use them without Electron): the persisted actuator id,
 * the persisted pause, the kill switch and the confinement cap.
 */
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
/** While this file exists the actuator is unsubscribed (GOING_AWAY). */
exports.KILL_SWITCH_FILE = '/tmp/agy_desktop_endpoint_off';
exports.KILL_SWITCH_POLL_MS = 2000;
/** "desktop-" + first 8 hex chars of sha256(hostname). */
function makeActuatorId(hostname = os.hostname()) {
    return ('desktop-' +
        crypto.createHash('sha256').update(hostname).digest('hex').slice(0, 8));
}
/**
 * The actuator id, fixed at first use: the LS keys the pause fence by
 * (actuator_type, actuator_id), so it must not follow hostname changes
 * (rt P3-20). Kept as "desktop-<sha8>" so paired LSs see the same actuator.
 */
function persistedActuatorId(file) {
    try {
        const id = fs.readFileSync(file, 'utf8').trim();
        if (/^desktop-[0-9a-f]{8}$/.test(id)) {
            return id;
        }
    }
    catch {
        // first run
    }
    const id = makeActuatorId();
    try {
        fs.writeFileSync(file, id);
    }
    catch (err) {
        console.warn(`[ComputerUse] could not persist actuator id: ${String(err)}`);
    }
    return id;
}
/** A JSON file store, e.g. in the Hub userData directory. */
function filePauseStore(file) {
    return {
        load: () => {
            try {
                return (JSON.parse(fs.readFileSync(file, 'utf8'))
                    .paused === true);
            }
            catch {
                return false;
            }
        },
        save: (paused) => {
            try {
                fs.writeFileSync(file, JSON.stringify({ paused }));
            }
            catch (err) {
                console.warn(`[ComputerUse] could not persist pause: ${String(err)}`);
            }
        },
    };
}
/** True if the kill switch (env or file) is engaged. */
function killSwitchEngaged(env = process.env, file = exports.KILL_SWITCH_FILE) {
    if (env.AGY_DESKTOP_ENDPOINT === '0') {
        return true;
    }
    try {
        return fs.existsSync(file);
    }
    catch {
        return false;
    }
}
/**
 * AGY_DESKTOP_CONFINEMENT_MAX: a test hook (CU-16) that can only lower the
 * advertised app-confinement level; undefined when unset or invalid.
 */
function confinementCap(env = process.env) {
    const raw = env.AGY_DESKTOP_CONFINEMENT_MAX;
    if (raw === undefined || raw === '') {
        return undefined;
    }
    const max = Number(raw);
    return Number.isInteger(max) && max >= 0 ? max : undefined;
}
