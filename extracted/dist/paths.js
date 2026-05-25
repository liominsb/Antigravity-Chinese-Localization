"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDE_BACKUP_DATA_DIR = exports.IDE_NEW_DATA_DIR = exports.IDE_OLD_DATA_DIR = void 0;
exports.getAppDataDirName = getAppDataDirName;
exports.getAppDataDir = getAppDataDir;
exports.getSettingsPbPath = getSettingsPbPath;
exports.getAppStoragePath = getAppStoragePath;
exports.getActivePortFilePath = getActivePortFilePath;
exports.getLsLogPath = getLsLogPath;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const constants_1 = require("./constants");
function getAppDataDirName() {
    return `antigravity${electron_1.app.isPackaged ? '' : '-dev'}`;
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
 * Returns the path to the file used to communicate AGY Hub's remote debugging port.
 * Used by recording encoder.
 */
function getActivePortFilePath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'DevToolsActivePort');
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
