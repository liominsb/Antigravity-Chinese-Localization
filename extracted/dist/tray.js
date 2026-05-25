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
exports.createTray = createTray;
exports.updateTrayAgentCount = updateTrayAgentCount;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const utils_1 = require("./utils");
// Keep tray as a global variable to prevent it from being garbage collected.
let tray = null;
let contextMenu = null;
/**
 * Creates a system tray icon with a context menu to focus a window or quit the app.
 *
 * For macOS it uses a template image to automatically handle light/dark mode.
 * Other platforms use the normal app icon.
 */
function createTray(actions) {
    // On macOS use a template image (auto-inverts for dark/light menu bar).
    // Otherwise use a full-color icon since template images are unsupported
    // and a solid-black glyph can be invisible on dark panels.
    const iconFile = (0, utils_1.isMacOS)() ? 'trayTemplate.png' : 'icon.png';
    const icon = electron_1.nativeImage.createFromPath(path.join(__dirname, '..', iconFile));
    if ((0, utils_1.isMacOS)()) {
        icon.setTemplateImage(true);
    }
    tray = new electron_1.Tray(icon);
    tray.setToolTip(electron_1.app.getName());
    const translatedActions = actions.map(action => {
        if (action.label === 'No agents running') action.label = '没有智能体在运行';
        if (action.label && action.label.startsWith('Open ')) action.label = '打开 Antigravity';
        if (action.label === 'Quit') action.label = '退出';
        return action;
    });
    contextMenu = electron_1.Menu.buildFromTemplate(translatedActions);
    tray.setContextMenu(contextMenu);
}
/**
 * Updates the active agents count in the tray menu.
 */
function updateTrayAgentCount(count) {
    if (tray && contextMenu) {
        const countItem = contextMenu.items.find((item) => item.id === 'running-agents');
        if (countItem) {
            countItem.label = count > 0 ? `${count} 个智能体运行中` : '没有智能体在运行';
            tray.setContextMenu(contextMenu);
        }
    }
}
