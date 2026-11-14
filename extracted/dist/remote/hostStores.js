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
exports.HostStores = exports.mainStoreScope = exports.STORAGE_CALLS_PER_SECOND = exports.STORAGE_CALL_BURST = exports.MAX_HOST_STORE_BYTES = exports.MAX_HOST_ENTRY_BYTES = void 0;
exports.hostStoreScope = hostStoreScope;
/**
 * Per-host stores for SSH windows, so UI state never leaks between backends or
 * hosts. The app settings stay in the main store, where SettingsService acts.
 */
const path = __importStar(require("path"));
const settingsService_1 = require("../services/settingsService");
const storage_1 = require("../storage");
const windowBackends_1 = require("./windowBackends");
const APP_SETTINGS = new Set(Object.values(settingsService_1.SettingKey));
/** Size limits (UTF-8 bytes) of a host store's entries and of the store. */
exports.MAX_HOST_ENTRY_BYTES = 256 * 1024;
exports.MAX_HOST_STORE_BYTES = 1024 * 1024;
/**
 * Storage calls per SSH window, at once and then per second: each reads (or
 * rewrites) a whole store on the main thread. The toolkit stays far below.
 */
exports.STORAGE_CALL_BURST = 20;
exports.STORAGE_CALLS_PER_SECOND = 10;
/** Local windows hear all main-store changes; others only the app settings. */
const mainStoreScope = (win, changes) => {
    if ((0, windowBackends_1.isLocalAppWindow)(win)) {
        return changes;
    }
    const app = Object.entries(changes).filter(([key]) => APP_SETTINGS.has(key));
    return app.length > 0 ? Object.fromEntries(app) : null;
};
exports.mainStoreScope = mainStoreScope;
function hostStoreScope(hostId) {
    return (win, changes) => (0, windowBackends_1.remoteBackendOfWindow)(win)?.hostId === hostId ? changes : null;
}
/** hostIdFor's output: the store's file name is built from it. */
const HOST_ID_RE = /^[a-f0-9]{12}$/;
class HostStores {
    constructor(dir, main) {
        this.dir = dir;
        this.main = main;
        this.stores = new Map();
        /** The storage calls each SSH window has left (a token bucket). */
        this.budgets = new WeakMap();
    }
    /** The store of `hostId` (see sshDestination.ts's hostIdFor). */
    get(hostId) {
        if (!HOST_ID_RE.test(hostId)) {
            throw new Error(`Invalid SSH host id: ${JSON.stringify(hostId)}`);
        }
        let store = this.stores.get(hostId);
        if (!store) {
            store = new storage_1.StorageManager(path.join(this.dir, `app_storage.ssh-${hostId}.json`), undefined, hostStoreScope(hostId), exports.MAX_HOST_STORE_BYTES);
            this.stores.set(hostId, store);
        }
        return store;
    }
    /** Counts a storage call of `sender`; throws when it has none left. */
    spend(sender) {
        const now = Date.now();
        const budget = this.budgets.get(sender) ?? {
            calls: exports.STORAGE_CALL_BURST,
            at: now,
        };
        budget.calls = Math.min(exports.STORAGE_CALL_BURST, budget.calls +
            (Math.max(0, now - budget.at) * exports.STORAGE_CALLS_PER_SECOND) / 1000);
        budget.at = now;
        this.budgets.set(sender, budget);
        if (budget.calls < 1) {
            throw new Error('Too many storage calls');
        }
        budget.calls -= 1;
    }
    /**
     * An SSH window's store, also while disconnected: its host's, plus the main
     * store's app settings, which it may set only to 'true', 'false' or null,
     * never autoCheckForUpdates (else ignored). Undefined for other senders.
     */
    forSender(sender) {
        const info = (0, windowBackends_1.remoteBackendOf)(sender);
        if (!info) {
            return undefined;
        }
        const host = this.get(info.hostId);
        return {
            getItems: async () => {
                this.spend(sender);
                const [items, main] = await Promise.all([
                    host.getItems(),
                    this.main.getItems(),
                ]);
                // Main-store app settings win (an older host store may have its own).
                for (const key of APP_SETTINGS) {
                    if (main[key] !== undefined) {
                        items[key] = main[key];
                    }
                    else {
                        delete items[key];
                    }
                }
                return items;
            },
            updateItems: async (changes) => {
                this.spend(sender);
                const own = {};
                const app = {};
                let bytes = 0;
                for (const [key, value] of Object.entries(changes)) {
                    // From the page: anything may come over IPC.
                    if (value !== null && typeof value !== 'string') {
                        throw new Error('Invalid storage value');
                    }
                    if (!APP_SETTINGS.has(key)) {
                        const size = value === null
                            ? 0
                            : Buffer.byteLength(key) + Buffer.byteLength(value);
                        bytes += size;
                        // Refused before it is stringified or queued.
                        if (size > exports.MAX_HOST_ENTRY_BYTES || bytes > exports.MAX_HOST_STORE_BYTES) {
                            throw new storage_1.StorageFullError();
                        }
                        own[key] = value;
                    }
                    else if (key !== settingsService_1.SettingKey.AUTO_CHECK_FOR_UPDATES &&
                        [null, 'true', 'false'].includes(value)) {
                        app[key] = value;
                    }
                }
                // Independent: app settings may apply even if the host's entries fail.
                const updates = [];
                if (Object.keys(app).length > 0) {
                    updates.push(this.main.updateItems(app));
                }
                if (Object.keys(own).length > 0) {
                    updates.push(host.updateItems(own));
                }
                try {
                    await Promise.all(updates);
                }
                catch (err) {
                    // Node's I/O errors name the laptop's files.
                    throw err instanceof storage_1.StorageFullError
                        ? err
                        : new Error("Couldn't save");
                }
            },
        };
    }
}
exports.HostStores = HostStores;
