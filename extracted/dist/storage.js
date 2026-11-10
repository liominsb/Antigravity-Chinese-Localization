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
const events_1 = require("events");
const utils_1 = require("./utils");
/**
 * Manages persistent storage for the application.
 * Stores key-value pairs.
 */
class StorageManager {
    constructor(storagePath, defaults) {
        this.storagePath = storagePath;
        this.defaults = defaults;
        this.emitter = new events_1.EventEmitter();
        this.writeChain = Promise.resolve();
        this.writeSeq = 0;
        this.onDidChange = (listener) => {
            this.emitter.on('changed', listener);
            return {
                dispose: () => this.emitter.off('changed', listener),
            };
        };
    }
    /**
     * Gets raw items from the storage file. `corrupt` is true when the file
     * exists but is not a JSON object (unparseable, `null`, an array, ...).
     */
    async readRawItems() {
        try {
            if (!(0, fs_1.existsSync)(this.storagePath)) {
                return { items: {}, corrupt: false };
            }
            const content = await fs.readFile(this.storagePath, 'utf-8');
            if (!content || content.trim() === '') {
                return { items: {}, corrupt: false };
            }
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return { items: parsed, corrupt: false };
            }
            console.error('Storage file is not a JSON object:', this.storagePath);
        }
        catch (e) {
            console.error('Error reading storage items:', e);
        }
        return { items: {}, corrupt: true };
    }
    async getRawItems() {
        return (await this.readRawItems()).items;
    }
    withDefaults(items) {
        const merged = { ...items };
        this.defaults?.forEach((v, k) => (merged[k] ?? (merged[k] = String(v))));
        return merged;
    }
    /**
     * Gets all items from the storage, with defaults applied.
     *
     * @returns A record of key-value pairs.
     */
    async getItems() {
        return this.withDefaults(await this.getRawItems());
    }
    getItemsSync() {
        try {
            const s = (0, fs_1.existsSync)(this.storagePath)
                ? (0, fs_1.readFileSync)(this.storagePath, 'utf-8').trim()
                : '';
            const p = s ? JSON.parse(s) : null;
            return this.withDefaults(p && typeof p === 'object' && !Array.isArray(p)
                ? p
                : {});
        }
        catch (e) {
            console.error('Error reading storage items synchronously:', e);
            return this.withDefaults({});
        }
    }
    /**
     * Updates items in the storage.
     *
     * @param changes A record of key-value pairs to update. If a value is null, the key will be deleted.
     */
    async updateItems(changes) {
        const prev = this.writeChain;
        let done;
        this.writeChain = new Promise((r) => (done = r));
        await prev;
        try {
            const { items: currentItems, corrupt } = await this.readRawItems();
            if (corrupt) {
                // Keep the unreadable file for recovery instead of silently replacing
                // every other key with just `changes`.
                const backup = `${this.storagePath}.corrupt-${Date.now()}.bak`;
                await fs.copyFile(this.storagePath, backup);
                console.error('Backed up corrupt storage file to', backup);
            }
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
            const tmp = `${this.storagePath}.${process.pid}.${++this.writeSeq}.tmp`;
            try {
                await fs.writeFile(tmp, JSON.stringify(currentItems, null, 2), 'utf-8');
                await fs.rename(tmp, this.storagePath);
            }
            catch (e) {
                await fs.unlink(tmp).catch(() => undefined);
                throw e;
            }
            for (const win of (0, utils_1.getHubWindows)()) {
                const hubContents = (0, utils_1.getHubWebContents)(win);
                if (hubContents && !hubContents.isDestroyed?.()) {
                    hubContents.send('storage:changed', changes);
                }
            }
            this.emitter.emit('changed', changes);
        }
        catch (e) {
            console.error('Error updating storage items:', e);
            throw e;
        }
        finally {
            done();
        }
    }
}
exports.StorageManager = StorageManager;
