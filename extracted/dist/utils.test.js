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
const helpers_1 = require("./test/helpers");
vitest_1.vi.mock('electron');
vitest_1.vi.mock('path', () => {
    const join = vitest_1.vi.fn((...args) => args.join('/'));
    return {
        join,
        default: {
            join,
        },
    };
});
(0, vitest_1.describe)('utils', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        vitest_1.vi.useFakeTimers();
        (0, helpers_1.silenceConsole)();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.describe)('createWindow', () => {
        (0, vitest_1.it)('should ensure dock is initialized when a window is created', async () => {
            vitest_1.vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
            const { app } = await Promise.resolve().then(() => __importStar(require('electron')));
            const { createWindow } = await Promise.resolve().then(() => __importStar(require('./utils')));
            const dockShowSpy = vitest_1.vi.spyOn(vitest_1.vi.mocked(app).dock, 'show');
            createWindow('http://localhost:3000/');
            (0, vitest_1.expect)(dockShowSpy).toHaveBeenCalled();
            (0, vitest_1.expect)(vitest_1.vi.mocked(app).dock?.setIcon).toHaveBeenCalled();
        });
        (0, vitest_1.it)('should register before-input-event listener for keybindings', async () => {
            const { createWindow } = await Promise.resolve().then(() => __importStar(require('./utils')));
            const win = createWindow('http://localhost:3000/');
            (0, vitest_1.expect)(win.webContents.on).toHaveBeenCalledWith('before-input-event', vitest_1.expect.any(Function));
        });
    });
});
