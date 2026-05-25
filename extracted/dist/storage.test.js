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
const storage_1 = require("./storage");
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const settingsService_1 = require("./services/settingsService");
vitest_1.vi.mock('fs/promises');
vitest_1.vi.mock('fs');
vitest_1.vi.mock('electron');
(0, vitest_1.describe)('StorageManager', () => {
    const mockPath = '/fake/path/storage.json';
    let storageManager;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        storageManager = new storage_1.StorageManager(mockPath, settingsService_1.DEFAULTS);
    });
    (0, vitest_1.describe)('getItems', () => {
        (0, vitest_1.it)('should return defaults if file does not exist', async () => {
            vitest_1.vi.mocked(fs_1.existsSync).mockReturnValue(false);
            const items = await storageManager.getItems();
            (0, vitest_1.expect)(items).toEqual({
                runInBackground: String(process.platform !== 'win32'),
                keepComputerAwake: 'false',
            });
            (0, vitest_1.expect)(fs_1.existsSync).toHaveBeenCalledWith(mockPath);
        });
        (0, vitest_1.it)('should return defaults if file is empty', async () => {
            vitest_1.vi.mocked(fs_1.existsSync).mockReturnValue(true);
            vitest_1.vi.mocked(fs.readFile).mockResolvedValue('');
            const items = await storageManager.getItems();
            (0, vitest_1.expect)(items).toEqual({
                runInBackground: String(process.platform !== 'win32'),
                keepComputerAwake: 'false',
            });
        });
        (0, vitest_1.it)('should return parsed JSON object merged with defaults if file contains valid JSON', async () => {
            vitest_1.vi.mocked(fs_1.existsSync).mockReturnValue(true);
            vitest_1.vi.mocked(fs.readFile).mockResolvedValue('{"key1": "value1"}');
            const items = await storageManager.getItems();
            (0, vitest_1.expect)(items).toEqual({
                key1: 'value1',
                runInBackground: String(process.platform !== 'win32'),
                keepComputerAwake: 'false',
            });
        });
        (0, vitest_1.it)('should handle JSON parse error and return defaults', async () => {
            vitest_1.vi.mocked(fs_1.existsSync).mockReturnValue(true);
            vitest_1.vi.mocked(fs.readFile).mockResolvedValue('invalid-json');
            const items = await storageManager.getItems();
            (0, vitest_1.expect)(items).toEqual({
                runInBackground: String(process.platform !== 'win32'),
                keepComputerAwake: 'false',
            });
        });
    });
    (0, vitest_1.describe)('updateItems', () => {
        (0, vitest_1.it)('should save updates merge with existing items', async () => {
            // Setup: file exists and has some data
            vitest_1.vi.mocked(fs_1.existsSync).mockReturnValue(true);
            vitest_1.vi.mocked(fs.readFile).mockResolvedValue('{"key1": "value1"}');
            vitest_1.vi.mocked(fs.writeFile).mockResolvedValue(undefined);
            await storageManager.updateItems({ key2: 'value2', key1: 'newValue1' });
            // Should write merged data
            (0, vitest_1.expect)(fs.writeFile).toHaveBeenCalledWith(mockPath, vitest_1.expect.stringContaining('"key1": "newValue1"'), 'utf-8');
            (0, vitest_1.expect)(fs.writeFile).toHaveBeenCalledWith(mockPath, vitest_1.expect.stringContaining('"key2": "value2"'), 'utf-8');
        });
        (0, vitest_1.it)('should create directory if it does not exist before writing', async () => {
            // Mock existsSync(file) as true for reading, but mock existsSync(dir) as false for mkdir
            vitest_1.vi.mocked(fs_1.existsSync).mockImplementation((path) => {
                if (path === mockPath) {
                    return true; // file exists for read
                }
                if (path === '/fake/path') {
                    return false; // dir doesn't exist
                }
                return false;
            });
            vitest_1.vi.mocked(fs.readFile).mockResolvedValue('{}');
            vitest_1.vi.mocked(fs.mkdir).mockResolvedValue(undefined);
            vitest_1.vi.mocked(fs.writeFile).mockResolvedValue(undefined);
            await storageManager.updateItems({ key: 'value' });
            (0, vitest_1.expect)(fs.mkdir).toHaveBeenCalledWith('/fake/path', { recursive: true });
            (0, vitest_1.expect)(fs.writeFile).toHaveBeenCalled();
        });
        (0, vitest_1.it)('should broadcast storage:changed to all windows', async () => {
            vitest_1.vi.mocked(fs_1.existsSync).mockReturnValue(true);
            vitest_1.vi.mocked(fs.readFile).mockResolvedValue('{"key1": "value1"}');
            vitest_1.vi.mocked(fs.writeFile).mockResolvedValue(undefined);
            const { BrowserWindow } = await Promise.resolve().then(() => __importStar(require('electron')));
            const mockWindows = BrowserWindow.getAllWindows();
            const mockWebContents = mockWindows[0].webContents;
            await storageManager.updateItems({ key2: 'value2' });
            (0, vitest_1.expect)(BrowserWindow.getAllWindows).toHaveBeenCalled();
            (0, vitest_1.expect)(mockWebContents.send).toHaveBeenCalledWith('storage:changed', {
                key2: 'value2',
            });
        });
        (0, vitest_1.it)('should emit changed event when items are updated', async () => {
            vitest_1.vi.mocked(fs_1.existsSync).mockReturnValue(true);
            vitest_1.vi.mocked(fs.readFile).mockResolvedValue('{}');
            vitest_1.vi.mocked(fs.writeFile).mockResolvedValue(undefined);
            const listener = vitest_1.vi.fn();
            storageManager.onDidChange(listener);
            await storageManager.updateItems({ key: 'value' });
            (0, vitest_1.expect)(listener).toHaveBeenCalledWith({ key: 'value' });
        });
    });
});
