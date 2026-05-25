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
const vitest_1 = require("vitest");
vitest_1.vi.mock('electron');
(0, vitest_1.describe)('tray', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        vitest_1.vi.resetModules();
    });
    (0, vitest_1.it)('should create a tray with a context menu', async () => {
        const { Tray, Menu, nativeImage } = await Promise.resolve().then(() => __importStar(require('electron')));
        const { createTray } = await Promise.resolve().then(() => __importStar(require('./tray')));
        createTray([
            { label: 'Open App', click: vitest_1.vi.fn() },
            { type: 'separator' },
            { label: 'Quit', click: vitest_1.vi.fn() },
        ]);
        const trayInstance = vitest_1.vi.mocked(Tray).mock.results[0].value;
        (0, vitest_1.expect)(nativeImage.createFromPath).toHaveBeenCalled();
        (0, vitest_1.expect)(Tray).toHaveBeenCalled();
        (0, vitest_1.expect)(trayInstance.setToolTip).toHaveBeenCalled();
        (0, vitest_1.expect)(Menu.buildFromTemplate).toHaveBeenCalled();
        (0, vitest_1.expect)(trayInstance.setContextMenu).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should call openApp when Open is clicked', async () => {
        const { Menu } = await Promise.resolve().then(() => __importStar(require('electron')));
        const { createTray } = await Promise.resolve().then(() => __importStar(require('./tray')));
        const openApp = vitest_1.vi.fn();
        createTray([
            { label: 'Open App', click: openApp },
            { type: 'separator' },
            { label: 'Quit', click: vitest_1.vi.fn() },
        ]);
        const menuTemplate = vitest_1.vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
        const openItem = menuTemplate[0];
        openItem.click();
        (0, vitest_1.expect)(openApp).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should call quitApp when Quit is clicked', async () => {
        const { Menu } = await Promise.resolve().then(() => __importStar(require('electron')));
        const { createTray } = await Promise.resolve().then(() => __importStar(require('./tray')));
        const quitApp = vitest_1.vi.fn();
        createTray([
            { label: 'Open App', click: vitest_1.vi.fn() },
            { type: 'separator' },
            { label: 'Quit', click: quitApp },
        ]);
        const menuTemplate = vitest_1.vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
        // Quit is the third item (after separator)
        const quitItem = menuTemplate[2];
        quitItem.click();
        (0, vitest_1.expect)(quitApp).toHaveBeenCalled();
    });
});
