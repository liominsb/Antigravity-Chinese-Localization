"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecentSshHosts = void 0;
/** Recently connected SSH hosts, kept in the app's main store. */
const main_1 = __importDefault(require("electron-log/main"));
/** Main store: the recent connections, newest first, each a RecentSshHost. */
const RECENT_KEY = 'ssh.recentConnections';
/** Main store: their labels, once each, as Hubs before RECENT_KEY read them. */
const RECENT_HOSTS_KEY = 'ssh.recentHosts';
/** Main store, before RECENT_KEY: label → the config file it last used. */
const RECENT_CONFIG_FILES_KEY = 'ssh.recentConfigFiles';
const MAX_RECENT = 10;
/** A copy of a stored entry, or undefined if it isn't one. */
function toRecent(entry) {
    if (typeof entry !== 'object' ||
        entry === null ||
        !('host' in entry) ||
        typeof entry.host !== 'string') {
        return undefined;
    }
    const file = 'configFile' in entry ? entry.configFile : undefined;
    if (file === undefined) {
        return { host: entry.host };
    }
    return typeof file === 'string'
        ? { host: entry.host, configFile: file }
        : undefined;
}
/** The first entry for each host and file, at most MAX_RECENT. */
function dedupe(entries) {
    const seen = new Set();
    return entries
        .filter((e) => {
        const key = JSON.stringify([e.host, e.configFile ?? null]);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    })
        .slice(0, MAX_RECENT);
}
/** One entry per host and config file, newest first. */
class RecentSshHosts {
    constructor(storage) {
        this.storage = storage;
        this.saving = Promise.resolve();
    }
    /**
     * The recent connections; for older toolkits, also their hosts once each
     * and the config file each was last connected with, if any.
     */
    async list() {
        const recent = await this.read();
        const recentHosts = [...new Set(recent.map((r) => r.host))];
        const recentConfigFiles = {};
        for (const host of recentHosts) {
            const file = recent.find((r) => r.host === host)?.configFile;
            if (file !== undefined) {
                recentConfigFiles[host] = file;
            }
        }
        return { recent, recentHosts, recentConfigFiles };
    }
    async read() {
        const items = await this.storage.getItems();
        const parse = (key) => {
            try {
                return JSON.parse(items[key] ?? 'null');
            }
            catch (err) {
                main_1.default.warn(`[SSH] Ignoring the unreadable ${key}:`, err);
                return undefined;
            }
        };
        const stored = parse(RECENT_KEY);
        if (Array.isArray(stored)) {
            return dedupe(stored.flatMap((e) => toRecent(e) ?? []));
        }
        // Saved before RECENT_KEY: labels, each with the file it last used.
        const hosts = parse(RECENT_HOSTS_KEY);
        const files = parse(RECENT_CONFIG_FILES_KEY);
        const known = new Map(typeof files === 'object' && files !== null ? Object.entries(files) : []);
        return dedupe((Array.isArray(hosts) ? hosts : []).flatMap((host) => {
            const file = typeof host === 'string' ? known.get(host) : undefined;
            const entry = typeof file === 'string' ? { host, configFile: file } : { host };
            return toRecent(entry) ?? [];
        }));
    }
    remember(label, configFile) {
        const save = async () => {
            const entry = configFile === undefined ? { host: label } : { host: label, configFile };
            const recent = dedupe([entry, ...(await this.read())]);
            await this.storage.updateItems({
                [RECENT_KEY]: JSON.stringify(recent),
                [RECENT_HOSTS_KEY]: JSON.stringify([
                    ...new Set(recent.map((r) => r.host)),
                ]),
            });
        };
        // Serialized: each reads, then writes back. The catch keeps the chain
        // going after a failed save.
        this.saving = this.saving
            .then(save)
            .catch((err) => main_1.default.warn('[SSH] Could not save the recent hosts:', err));
    }
}
exports.RecentSshHosts = RecentSshHosts;
