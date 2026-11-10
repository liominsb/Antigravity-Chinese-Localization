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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDE_BACKUP_DATA_DIR = exports.IDE_NEW_DATA_DIR = exports.IDE_OLD_DATA_DIR = void 0;
exports.getAppDataDirName = getAppDataDirName;
exports.getAppDataDir = getAppDataDir;
exports.getSettingsPbPath = getSettingsPbPath;
exports.getAppStoragePath = getAppStoragePath;
exports.getWindowStatePath = getWindowStatePath;
exports.getActivePortFilePath = getActivePortFilePath;
exports.tightenActivePortPermissions = tightenActivePortPermissions;
exports.getLsLogPath = getLsLogPath;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const constants_1 = require("./constants");
function getAppDataDirName() {
    if (!electron_1.app.isPackaged) {
        return 'antigravity-dev';
    }
    return electron_1.app.getName().toLowerCase().replace(/\s+/g, '');
}
function getAppDataDir() {
    return path_1.default.join(os_1.default.homedir(), '.gemini', getAppDataDirName());
}
function getSettingsPbPath() {
    return path_1.default.join(os_1.default.homedir(), '.gemini', 'config', 'config.json');
}
/**
 * Returns the path to the persistent app storage file.
 * This is used to back a lightweight key-value store for UI state,
 * and is not used for e.g. settings or other "core" app state.
 */
function getAppStoragePath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'app_storage.json');
}
/**
 * Returns the path to the persistent window geometry and state file.
 */
function getWindowStatePath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'window_state.json');
}
/**
 * Returns the path to the file used to communicate AGY Hub's remote debugging port.
 * Used by recording encoder.
 */
function getActivePortFilePath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'DevToolsActivePort');
}
/**
 * Best-effort POSIX hardening of `DevToolsActivePort`, which holds the CDP
 * WebSocket secret: restricts `userDataDir` to `0o700` and `activePortFile` to
 * `0o600`, each only if it exists, is owned by the current user, and is looser.
 * Never throws.
 */
function tightenActivePortPermissions(userDataDir, activePortFile) {
    if (process.platform === 'win32') {
        return;
    }
    for (const [target, mode] of [
        [userDataDir, 0o700],
        [activePortFile, 0o600],
    ]) {
        try {
            const st = fs.statSync(target);
            if (st.uid === process.getuid?.() && st.mode & 0o777 & ~mode) {
                fs.chmodSync(target, st.mode & mode);
            }
        }
        catch {
            // Missing path or foreign filesystem: leave as is.
        }
    }
}
function getLsLogPath() {
    return path_1.default.join(electron_1.app.getPath('logs'), constants_1.LS_LOG_FILE_NAME);
}
/** User data dir for the old IDE (source for copy). */
exports.IDE_OLD_DATA_DIR = path_1.default.join(os_1.default.homedir(), '.gemini', 'antigravity');
/** User data dir for the separately installed IDE (destination for copy). */
exports.IDE_NEW_DATA_DIR = path_1.default.join(os_1.default.homedir(), '.gemini', 'antigravity-ide');
/** User data dir for backup (destination for backup copy). */
exports.IDE_BACKUP_DATA_DIR = path_1.default.join(os_1.default.homedir(), '.gemini', 'antigravity-backup');
