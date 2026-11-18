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
exports.SshWindowRestore = exports.UPDATE_QUIT_GRACE_MS = exports.MAX_CHECK_MISSES = exports.CONFIG_CHECK_BUDGET_MS = exports.MAX_RESTORED_WINDOWS = exports.SSH_WINDOWS_FILE = void 0;
exports.readSavedWindows = readSavedWindows;
const main_1 = __importDefault(require("electron-log/main"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const windowState_1 = require("../windowState");
const sshConfigHosts_1 = require("./sshConfigHosts");
const sshDestination_1 = require("./sshDestination");
const types_1 = require("./types");
/** In the app's userData directory. */
exports.SSH_WINDOWS_FILE = 'ssh_windows.json';
const FILE_VERSION = 1;
/** Plenty for real use; a damaged file can't open windows without end. */
exports.MAX_RESTORED_WINDOWS = 20;
/** Coalesces a drag's moves and a restore's windows into one write. */
const SAVE_DELAY_MS = 250;
/** As listSshConfigHosts' READ_BUDGET_MS: a hung mount can't hold back the rest. */
exports.CONFIG_CHECK_BUDGET_MS = 2000;
/**
 * Starts in a row a window isn't reopened (its config file check fails or
 * runs out of time, or it fails to open) before it's forgotten: a volume
 * mounted late keeps its window; a deleted file stops coming back.
 */
exports.MAX_CHECK_MISSES = 3;
/** An update's quit that hasn't come this long after it began failed. */
exports.UPDATE_QUIT_GRACE_MS = 60000;
/** Window events after which its bounds may have changed. */
const BOUNDS_EVENTS = [
    'move',
    'resize',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen',
];
class SshWindowRestore {
    constructor(file) {
        this.file = file;
        /**
         * The open windows, least recently focused first.
         * TODO: this mirrors RemoteManager's SSH windows through their events;
         * listing those when saving would keep one registry.
         */
        this.tracked = [];
        /**
         * The windows closing now stay listed: the app quits ('quit', for good),
         * or an update's quit began ('update', until UPDATE_QUIT_GRACE_MS).
         */
        this.frozen = false;
        this.pending = readSavedWindows(file);
    }
    /**
     * Reopens the last session's windows with `open` (restoreWindow): those
     * without a config file at once, the others as their file passes the
     * checks connect() makes, each within CONFIG_CHECK_BUDGET_MS (so a hung
     * mount holds back only its own windows). Then the one focused last comes
     * to the front, unless `focus` is false (a deep link's window keeps it).
     * One whose check fails, or that fails to open, stays saved (see
     * MAX_CHECK_MISSES).
     */
    async restore(open, { focus = true } = {}) {
        const queued = this.pending;
        // Once per file: windows on one hung mount don't each hold a thread.
        const checks = new Map();
        const opened = new Map();
        await Promise.all(queued.map(async (saved) => {
            let configFile;
            let why;
            if (saved.configFile !== undefined) {
                const check = checks.get(saved.configFile) ?? checkConfigFile(saved.configFile);
                checks.set(saved.configFile, check);
                try {
                    configFile = await check;
                }
                catch (err) {
                    why = (0, types_1.sanitizeRemoteText)(String(err?.message ?? err), 300);
                }
            }
            if (this.frozen) {
                return; // Quitting: it stays saved for the next start.
            }
            if (why !== undefined) {
                this.missed(saved, why);
                return;
            }
            const reopen = { host: saved.host, configFile, bounds: saved.bounds };
            let win;
            try {
                win = open(reopen);
            }
            catch (err) {
                main_1.default.warn(`[SSH] Could not reopen the window on ${(0, types_1.sanitizeRemoteText)(saved.host, 200)}:`, err);
                this.missed(saved, 'its window failed to open');
                return;
            }
            this.track(win, reopen); // Unless onWindowOpened already did.
            this.pending = this.pending.filter((p) => p !== saved);
            opened.set(saved, win);
        }));
        const front = [...queued].reverse().find((s) => opened.has(s));
        const win = front && opened.get(front);
        if (focus && win && !win.isDestroyed() && !this.frozen) {
            win.focus();
        }
        this.scheduleSave();
    }
    /** Keeps `win` in the list until the user closes it. */
    track(win, { host, configFile }) {
        if (this.frozen === 'quit' || this.tracked.some((t) => t.win === win)) {
            return;
        }
        const entry = { win, saved: { host, configFile } };
        this.tracked.push(entry);
        // It replaces a saved window of the same host and file (e.g. one a
        // failed update's thaw kept): the user's close forgets that one too.
        this.pending = this.pending.filter((p) => p.host !== host || p.configFile !== configFile);
        const changed = () => this.scheduleSave();
        for (const event of BOUNDS_EVENTS) {
            win.on(event, changed);
        }
        win.on('focus', () => {
            // Last: the one in front at the next start.
            const i = this.tracked.indexOf(entry);
            if (i >= 0 && i < this.tracked.length - 1) {
                this.tracked.push(...this.tracked.splice(i, 1));
                changed();
            }
        });
        // Windows: a shutdown or sign-out closes the windows, without 'before-quit'.
        win.on('session-end', () => this.freeze());
        win.once('closed', () => {
            // By the user: one a quit or an update closes reopens.
            const i = this.tracked.indexOf(entry);
            if (!this.frozen && i >= 0) {
                this.tracked.splice(i, 1);
                changed();
            }
        });
        changed();
    }
    /**
     * Saves the windows as they are now, and keeps that list for good: call
     * it before a quit closes them.
     */
    freeze() {
        clearTimeout(this.thawTimer);
        if (!this.frozen) {
            this.save();
        }
        this.frozen = 'quit';
    }
    /**
     * As freeze(), when an update's quit begins: on macOS it closes every
     * window before 'before-quit'. That quit may never come (e.g. Squirrel
     * fails after closing them): then, UPDATE_QUIT_GRACE_MS later, the windows
     * it closed stay saved for the next start, and the list follows the
     * windows again.
     */
    freezeForUpdate() {
        if (this.frozen) {
            return;
        }
        this.save();
        this.frozen = 'update';
        this.thawTimer = setTimeout(() => {
            this.frozen = false; // freeze() clears this timer.
            for (const closed of this.tracked.filter((t) => t.win.isDestroyed())) {
                this.tracked.splice(this.tracked.indexOf(closed), 1);
                this.pending.push(closed.saved);
            }
            this.scheduleSave();
        }, exports.UPDATE_QUIT_GRACE_MS);
    }
    /**
     * A window not reopened this start (its check failed or was slow, or it
     * failed to open): kept, unless that happened too many starts in a row.
     */
    missed(saved, why) {
        saved.misses = (saved.misses ?? 0) + 1;
        const forgotten = saved.misses >= exports.MAX_CHECK_MISSES;
        if (forgotten) {
            this.pending = this.pending.filter((p) => p !== saved);
        }
        const host = (0, types_1.sanitizeRemoteText)(saved.host, 200);
        const when = forgotten ? 'any more' : 'this time';
        main_1.default.warn(`[SSH] Not reopening the window on ${host} ${when}: ${why}`);
    }
    scheduleSave() {
        if (this.frozen) {
            return;
        }
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
    }
    save() {
        clearTimeout(this.saveTimer);
        for (const { win, saved } of this.tracked) {
            saved.bounds = boundsOf(win) ?? saved.bounds;
        }
        const windows = [...this.pending, ...this.tracked.map((t) => t.saved)];
        // A Hub that never had an SSH window to keep writes no file.
        if (windows.length > 0 || fs.existsSync(this.file)) {
            writeSavedWindows(this.file, dedupe(windows));
        }
    }
}
exports.SshWindowRestore = SshWindowRestore;
/** The window's normal bounds, and whether it's maximized or full screen. */
function boundsOf(win) {
    // Never throws: it runs in before-quit, ahead of the teardown.
    try {
        if (win.isDestroyed()) {
            return undefined;
        }
        const { x, y, width, height } = win.getNormalBounds();
        const isMaximized = win.isMaximized();
        return { x, y, width, height, isMaximized, isFullScreen: win.isFullScreen() };
    }
    catch {
        return undefined;
    }
}
/**
 * The file's canonical path (undefined for ~/.ssh/config), as connect()
 * checks a chosen file, within CONFIG_CHECK_BUDGET_MS. Before the window
 * opens: only a checked path reaches `ssh -F` (on Windows nothing else
 * checks it, and a share's path would send it this computer's credentials).
 */
function checkConfigFile(file) {
    let timer;
    const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('its SSH config file took too long to check.')), exports.CONFIG_CHECK_BUDGET_MS);
    });
    return Promise.race([(0, sshConfigHosts_1.resolveSshConfigFile)(file), late]).finally(() => clearTimeout(timer));
}
/** The last entry of each host and config file, at most MAX_RESTORED_WINDOWS. */
function dedupe(windows) {
    const seen = new Set();
    const kept = [];
    for (const w of [...windows].reverse()) {
        const key = JSON.stringify([w.host, w.configFile ?? null]);
        if (!seen.has(key) && kept.length < exports.MAX_RESTORED_WINDOWS) {
            seen.add(key);
            kept.push(w);
        }
    }
    return kept.reverse();
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** A copy of a saved entry, or undefined if it isn't one restoreWindow takes. */
function toSavedWindow(entry) {
    if (!isRecord(entry) || typeof entry.host !== 'string') {
        return undefined;
    }
    const { configFile, bounds, misses } = entry;
    const host = entry.host.trim();
    if (configFile !== undefined && typeof configFile !== 'string') {
        return undefined;
    }
    try {
        (0, sshDestination_1.parseSshDestination)(host); // restoreWindow would throw.
    }
    catch {
        return undefined;
    }
    const counted = typeof misses === 'number' &&
        Number.isInteger(misses) &&
        misses > 0 &&
        misses < exports.MAX_CHECK_MISSES;
    return {
        host,
        configFile,
        bounds: isRecord(bounds) ? (0, windowState_1.parseWindowState)(bounds) : undefined,
        misses: counted ? misses : undefined,
    };
}
/** The saved windows; none if the file is missing or damaged. */
function readSavedWindows(file) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch (err) {
        if (err?.code !== 'ENOENT') {
            main_1.default.warn(`[SSH] Could not read the SSH windows to reopen:`, err);
        }
        return [];
    }
    if (!isRecord(parsed) ||
        parsed.version !== FILE_VERSION ||
        !Array.isArray(parsed.windows)) {
        main_1.default.warn(`[SSH] Ignoring ${file}: not a list of SSH windows.`);
        return [];
    }
    const windows = parsed.windows
        .map(toSavedWindow)
        .filter((w) => w !== undefined);
    return dedupe(windows);
}
/**
 * Replaces the file in one step, so a crash leaves the old or the new list.
 * Synchronous: it also runs in before-quit and before-quit-for-update, whose
 * quit doesn't wait for promises.
 */
function writeSavedWindows(file, windows) {
    const data = JSON.stringify({ version: FILE_VERSION, windows }, null, 2);
    const temp = `${file}.${process.pid}.tmp`;
    const write = (target) => fs.writeFileSync(target, data, { encoding: 'utf-8', mode: 0o600 });
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        write(temp);
        try {
            fs.renameSync(temp, file);
            return;
        }
        catch {
            write(file); // E.g. Windows, while a scanner has the file open.
        }
    }
    catch (err) {
        main_1.default.warn('[SSH] Could not save the open SSH windows:', err);
    }
    try {
        fs.rmSync(temp, { force: true });
    }
    catch {
        // Best effort: the next save uses the same name.
    }
}
