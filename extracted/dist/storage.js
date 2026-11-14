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
exports.StorageManager = exports.StorageFullError = void 0;
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const events_1 = require("events");
const utils_1 = require("./utils");
/** Refuses an update too large for a store's limits (e.g. its maxBytes). */
class StorageFullError extends Error {
    constructor() {
        super('Storage is full');
        this.name = 'StorageFullError';
    }
}
exports.StorageFullError = StorageFullError;
/**
 * Error codes with which rename can refuse to replace an existing file, e.g.
 * on Windows while another program has it open.
 */
const REPLACE_REFUSED_CODES = new Set([
    'EPERM',
    'EACCES',
    'EBUSY',
]);
/**
 * Waits before each new try of a refused rename: on Windows, an antivirus
 * scanner or indexer that has the file open usually lets go soon.
 */
const RENAME_RETRY_DELAYS_MS = [50, 100, 150, 200];
function errnoCode(e) {
    return e instanceof Error && 'code' in e && typeof e.code === 'string'
        ? e.code
        : undefined;
}
/**
 * Manages persistent storage for the application.
 * Stores key-value pairs.
 */
class StorageManager {
    /**
     * @param scope The changes each window hears (default: all of them).
     * @param maxBytes Size cap: a larger update fails, but its deletions apply
     *   (so a full store can shrink).
     */
    constructor(storagePath, defaults, scope = (_win, changes) => changes, maxBytes = Infinity) {
        this.storagePath = storagePath;
        this.defaults = defaults;
        this.scope = scope;
        this.maxBytes = maxBytes;
        this.emitter = new events_1.EventEmitter();
        this.writeChain = Promise.resolve();
        this.writeSeq = 0;
        /** The last rename stayed refused through its retries. */
        this.renameRefused = false;
        this.onDidChange = (listener) => {
            this.emitter.on('changed', listener);
            return {
                dispose: () => this.emitter.off('changed', listener),
            };
        };
    }
    /**
     * Gets raw items from the storage file. `corrupt` is true when the file
     * was read but is not a JSON object (unparseable, `null`, an array, ...).
     * Throws when the file exists but can't be read.
     */
    async readRawItems() {
        if (!(0, fs_1.existsSync)(this.storagePath)) {
            return { items: {}, corrupt: false };
        }
        let content;
        try {
            content = await fs.readFile(this.storagePath, 'utf-8');
        }
        catch (e) {
            // Removed since existsSync: nothing stored.
            if (errnoCode(e) === 'ENOENT') {
                return { items: {}, corrupt: false };
            }
            throw e;
        }
        try {
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
            console.error('Error parsing storage items:', e);
        }
        return { items: {}, corrupt: true };
    }
    async getRawItems() {
        try {
            return (await this.readRawItems()).items;
        }
        catch (e) {
            console.error('Error reading storage items:', e);
            return {};
        }
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
            await this.applyChanges(changes);
        }
        finally {
            done();
        }
    }
    /** Only updateItems calls this, one update at a time. */
    async applyChanges(changes) {
        try {
            const { items: currentItems, corrupt } = await this.readRawItems();
            if (corrupt) {
                // Keep the unreadable file for recovery instead of silently replacing
                // every other key with just `changes`.
                const backup = `${this.storagePath}.corrupt-${Date.now()}.bak`;
                try {
                    await fs.copyFile(this.storagePath, backup);
                    console.error('Backed up corrupt storage file to', backup);
                }
                catch (e) {
                    // Failing the update would fail every later one too, so storage
                    // would stop working.
                    console.error(`Error copying ${this.storagePath} to ${backup}:`, e);
                }
            }
            for (const [key, value] of Object.entries(changes)) {
                if (value === null) {
                    delete currentItems[key];
                }
                else {
                    currentItems[key] = value;
                }
            }
            const data = JSON.stringify(currentItems, null, 2);
            if (Buffer.byteLength(data) > this.maxBytes &&
                Object.values(changes).some((value) => value !== null)) {
                const deletions = Object.entries(changes).filter(([, v]) => v === null);
                if (deletions.length > 0) {
                    await this.applyChanges(Object.fromEntries(deletions));
                }
                throw new StorageFullError();
            }
            // Ensure directory exists
            const dir = path.dirname(this.storagePath);
            if (!(0, fs_1.existsSync)(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            const tmp = `${this.storagePath}.${process.pid}.${++this.writeSeq}.tmp`;
            let replaced;
            try {
                await fs.writeFile(tmp, data, 'utf-8');
                replaced = await this.renameOver(tmp);
            }
            catch (e) {
                await fs.unlink(tmp).catch(() => undefined);
                throw e;
            }
            if (!replaced) {
                // In place, then. Not atomic: the next update backs up a file that a
                // crash left half-written.
                try {
                    await fs.writeFile(this.storagePath, data, 'utf-8');
                }
                catch (e) {
                    // The tmp file is then the only full copy.
                    console.error(`The new ${this.storagePath} stays in ${tmp}`);
                    throw e;
                }
                await fs.unlink(tmp).catch(() => undefined);
            }
            for (const win of (0, utils_1.getHubWindows)()) {
                const hubContents = (0, utils_1.getHubWebContents)(win);
                if (hubContents && !hubContents.isDestroyed?.()) {
                    // The update is saved: one window must not keep it from the others.
                    try {
                        const scoped = this.scope(win, changes);
                        if (scoped && Object.keys(scoped).length > 0) {
                            hubContents.send('storage:changed', scoped);
                        }
                    }
                    catch (e) {
                        console.error('Error sending storage changes to a window:', e);
                    }
                }
            }
            this.emitter.emit('changed', changes);
        }
        catch (e) {
            // A full store is expected (the caller is told), not an error to log.
            if (!(e instanceof StorageFullError)) {
                console.error('Error updating storage items:', e);
            }
            throw e;
        }
    }
    /**
     * Renames `tmp` over the store file, trying again for a while if that's
     * refused; false if it stays refused.
     */
    async renameOver(tmp) {
        // A refusal that outlasted the retries (an ACL, a handle kept open) isn't
        // a scanner's moment: until a rename works again, each update tries once,
        // or every update would wait half a second, one after the other.
        const delays = this.renameRefused ? [] : RENAME_RETRY_DELAYS_MS;
        for (const delayMs of [0, ...delays]) {
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            try {
                await fs.rename(tmp, this.storagePath);
                this.renameRefused = false;
                return true;
            }
            catch (e) {
                const code = errnoCode(e);
                if (code === undefined || !REPLACE_REFUSED_CODES.has(code)) {
                    throw e;
                }
            }
        }
        this.renameRefused = true;
        return false;
    }
}
exports.StorageManager = StorageManager;
