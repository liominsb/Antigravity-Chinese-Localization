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
exports.WIZARD_SHOWN_KEY = void 0;
exports.fetchIdeDownloadUrl = fetchIdeDownloadUrl;
exports.getPlatformKey = getPlatformKey;
exports.getIdeInstallPath = getIdeInstallPath;
exports.shouldShowIdeInstallWizard = shouldShowIdeInstallWizard;
/**
 * IDE Install — Constants, platform helpers, and condition checks.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const main_1 = __importDefault(require("electron-log/main"));
const paths_1 = require("../paths");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
exports.WIZARD_SHOWN_KEY = 'ide-install-wizard-shown';
/**
 * Fetches the latest stable IDE download URL for a given platform.
 */
async function fetchIdeDownloadUrl(platformKey) {
    const url = `https://antigravity-ide-auto-updater-974169037036.us-central1.run.app/api/update/${platformKey}/stable/latest`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch IDE download URL: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json());
    if (!data.url) {
        throw new Error(`No download URL found in the auto-updater response for platform: ${platformKey}`);
    }
    return data.url;
}
// ---------------------------------------------------------------------------
// Platform Helpers
// ---------------------------------------------------------------------------
function getPlatformKey() {
    if (process.platform === 'darwin' && process.arch === 'x64') {
        return 'darwin';
    }
    let suffix = '';
    if (process.platform === 'win32') {
        suffix = '-user';
    }
    return `${process.platform}-${process.arch}${suffix}`;
}
/**
 * Returns the expected installation path for the IDE.
 */
function getIdeInstallPath() {
    switch (process.platform) {
        case 'darwin':
            return '/Applications/Antigravity IDE.app';
        case 'win32':
            return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Antigravity IDE');
        case 'linux':
            return path.join(os.homedir(), '.local', 'share', 'antigravity-ide');
        default:
            return path.join(os.homedir(), 'antigravity-ide');
    }
}
// ---------------------------------------------------------------------------
// Condition Checks
// ---------------------------------------------------------------------------
/**
 * Determines whether the IDE install wizard should be shown.
 *
 * Conditions (all must be true):
 * 1. Wizard has not been shown before (checked via storage)
 * 2. `~/.gemini/antigravity-ide` does NOT exist
 * 3. `~/.gemini/antigravity` DOES exist
 */
async function shouldShowIdeInstallWizard(storageManager) {
    // 1. Already shown?
    const items = await storageManager.getItems();
    if (items[exports.WIZARD_SHOWN_KEY] === 'true') {
        main_1.default.info('[IDE Wizard] Already shown, skipping.');
        return false;
    }
    // 1a. If not shown before, then now mark it as shown.
    await storageManager.updateItems({ [exports.WIZARD_SHOWN_KEY]: 'true' });
    // 2. IDE already installed separately?
    if (fs.existsSync(paths_1.IDE_NEW_DATA_DIR)) {
        main_1.default.info(`[IDE Wizard] ${paths_1.IDE_NEW_DATA_DIR} exists — IDE already installed, skipping.`);
        return false;
    }
    // 3. Old IDE data present (user was migrated)?
    if (!fs.existsSync(paths_1.IDE_OLD_DATA_DIR)) {
        main_1.default.info(`[IDE Wizard] ${paths_1.IDE_OLD_DATA_DIR} not found — user was not migrated, skipping.`);
        return false;
    }
    main_1.default.info('[IDE Wizard] All conditions met — will show wizard.');
    return true;
}
