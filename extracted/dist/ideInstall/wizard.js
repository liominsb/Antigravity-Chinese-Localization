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
exports.showIdeInstallWizard = showIdeInstallWizard;
exports.maybeShowIdeInstallWizard = maybeShowIdeInstallWizard;
/**
 * IDE Install Wizard — Window orchestration and IPC handlers.
 */
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const main_1 = __importDefault(require("electron-log/main"));
const constants_1 = require("./constants");
const paths_1 = require("../paths");
const service_1 = require("./service");
const wizardHtml_1 = require("./wizardHtml");
/**
 * Shows the IDE install wizard as a modal window.
 * Returns a promise that resolves when the wizard is dismissed.
 */
function showIdeInstallWizard() {
    return new Promise((resolve) => {
        const wizardWindow = new electron_1.BrowserWindow({
            width: 720,
            height: 580,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            titleBarStyle: 'hidden',
            trafficLightPosition: { x: 12, y: 12 },
            backgroundColor: '#0D0D0D',
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'wizardPreload.js'),
            },
        });
        const iconPath = path.join(__dirname, '..', '..', 'icon.png');
        let iconBase64 = '';
        try {
            if (fs.existsSync(iconPath)) {
                iconBase64 = fs.readFileSync(iconPath).toString('base64');
            }
            else {
                main_1.default.warn(`[IDE Wizard] Icon not found at ${iconPath}`);
            }
        }
        catch (e) {
            main_1.default.error(`[IDE Wizard] Failed to read icon: ${e}`);
        }
        const html = (0, wizardHtml_1.getWizardHtml)(iconBase64);
        let isResolved = false;
        const cleanup = () => {
            if (isResolved) {
                return;
            }
            isResolved = true;
            electron_1.ipcMain.removeHandler('wizard:complete');
            resolve();
        };
        electron_1.ipcMain.handle('wizard:complete', async (_event, shouldDownload) => {
            cleanup();
            wizardWindow.close();
            if (shouldDownload) {
                main_1.default.info('[IDE Wizard] Background download requested. Starting installation in background...');
                void (0, service_1.downloadAndInstallIde)().catch((err) => {
                    main_1.default.error(`[IDE Wizard] Background download/install failed: ${err}`);
                });
            }
        });
        wizardWindow.on('closed', () => {
            cleanup();
        });
        const doSetup = async () => {
            // If the old Antigravity user data directory exists, copy it to the new IDE
            // data dir and to a backup directory.
            if (fs.existsSync(paths_1.IDE_OLD_DATA_DIR)) {
                if (!fs.existsSync(paths_1.IDE_NEW_DATA_DIR)) {
                    try {
                        await (0, service_1.copyUserData)(paths_1.IDE_OLD_DATA_DIR, paths_1.IDE_NEW_DATA_DIR);
                    }
                    catch (err) {
                        main_1.default.error(`[IDE Wizard] Failed to copy to new IDE data dir: ${err}`);
                    }
                }
                if (!fs.existsSync(paths_1.IDE_BACKUP_DATA_DIR)) {
                    try {
                        await (0, service_1.copyUserData)(paths_1.IDE_OLD_DATA_DIR, paths_1.IDE_BACKUP_DATA_DIR);
                    }
                    catch (err) {
                        main_1.default.error(`[IDE Wizard] Failed to copy to backup IDE data dir: ${err}`);
                    }
                }
            }
            if (!wizardWindow.isDestroyed()) {
                wizardWindow.webContents.send('wizard:setup-complete');
            }
        };
        wizardWindow.once('ready-to-show', () => {
            wizardWindow.show();
            void doSetup();
        });
        void wizardWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    });
}
/**
 * Checks conditions and shows the IDE install wizard if appropriate.
 * This should be called early in the app lifecycle, before the LS starts.
 * Returns true if the wizard was shown, false otherwise.
 */
async function maybeShowIdeInstallWizard(storageManager) {
    const shouldShow = await (0, constants_1.shouldShowIdeInstallWizard)(storageManager);
    if (!shouldShow) {
        return false;
    }
    await showIdeInstallWizard();
    return true;
}
