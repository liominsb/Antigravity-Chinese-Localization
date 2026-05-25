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
exports.StorageManager = void 0;
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const electron_1 = require("electron");
const events_1 = require("events");
/**
 * Manages persistent storage for the application.
 * Stores key-value pairs.
 */
class StorageManager {
    constructor(storagePath, defaults) {
        this.storagePath = storagePath;
        this.defaults = defaults;
        this.emitter = new events_1.EventEmitter();
        this.onDidChange = (listener) => {
            this.emitter.on('changed', listener);
            return {
                dispose: () => this.emitter.off('changed', listener),
            };
        };
    }
    /**
     * Gets raw items from the storage file.
     */
    async getRawItems() {
        try {
            if (!(0, fs_1.existsSync)(this.storagePath)) {
                return {};
            }
            const content = await fs.readFile(this.storagePath, 'utf-8');
            if (!content || content.trim() === '') {
                return {};
            }
            return JSON.parse(content);
        }
        catch (e) {
            console.error('Error reading storage items:', e);
            return {};
        }
    }
    /**
     * Gets all items from the storage, with defaults applied.
     *
     * @returns A record of key-value pairs.
     */
    async getItems() {
        const items = await this.getRawItems();
        const merged = { ...items };
        if (this.defaults) {
            for (const [key, value] of this.defaults.entries()) {
                if (merged[key] === undefined) {
                    merged[key] = String(value);
                }
            }
        }
        return merged;
    }
    /**
     * Updates items in the storage.
     *
     * @param changes A record of key-value pairs to update. If a value is null, the key will be deleted.
     */
    async updateItems(changes) {
        try {
            const currentItems = await this.getRawItems();
            for (const [key, value] of Object.entries(changes)) {
                if (value === null) {
                    delete currentItems[key];
                }
                else {
                    currentItems[key] = value;
                }
            }
            // Ensure directory exists
            const dir = path.dirname(this.storagePath);
            if (!(0, fs_1.existsSync)(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            await fs.writeFile(this.storagePath, JSON.stringify(currentItems, null, 2), 'utf-8');
            const windows = electron_1.BrowserWindow.getAllWindows();
            for (const win of windows) {
                win.webContents.send('storage:changed', changes);
            }
            this.emitter.emit('changed', changes);
        }
        catch (e) {
            console.error('Error updating storage items:', e);
            throw e;
        }
    }
}
exports.StorageManager = StorageManager;
