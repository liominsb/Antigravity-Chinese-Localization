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
exports.PipeChromiumEngine = exports.GUEST_EVENT_CHANNEL = exports.FRAME_CHANNEL = void 0;
exports.httpOrigin = httpOrigin;
exports.windowBoundsFor = windowBoundsFor;
exports.isScreencastFrameStale = isScreencastFrameStale;
exports.browserProfileDir = browserProfileDir;
exports.chromeLaunchArgs = chromeLaunchArgs;
exports.closeAllBrowserSessions = closeAllBrowserSessions;
exports.resolveBrowserEngine = resolveBrowserEngine;
exports.clampInt = clampInt;
exports.clampDpr = clampDpr;
exports.jpegDimensions = jpegDimensions;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const cdpPipe_1 = require("./cdpPipe");
const chromeDiscovery_1 = require("./chromeDiscovery");
exports.FRAME_CHANNEL = 'standalone-browser:frame';
exports.GUEST_EVENT_CHANNEL = 'standalone-browser:guest-event';
function httpOrigin(url) {
    const p = URL.canParse(url) ? new URL(url) : undefined;
    return p?.protocol === 'http:' || p?.protocol === 'https:' ? p.origin : '';
}
function windowBoundsFor(vp) {
    return {
        width: Math.max(500, vp.width + 64),
        height: Math.max(500, vp.height + 200),
    };
}
function isScreencastFrameStale(vp, data, meta) {
    const dw = meta?.deviceWidth;
    const dh = meta?.deviceHeight;
    if (typeof dw === 'number' && dw > 0 && Math.abs(dw - vp.width) > 2) {
        return true;
    }
    if (typeof dh === 'number' && dh > 0 && Math.abs(dh - vp.height) > 2) {
        return true;
    }
    const dims = jpegDimensions(data);
    if (!dims) {
        return false;
    }
    const expW = Math.round(vp.width * vp.deviceScaleFactor);
    const expH = Math.round(vp.height * vp.deviceScaleFactor);
    return Math.abs(dims.w - expW) > 6 || Math.abs(dims.h - expH) > 6;
}
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const READY_TIMEOUT_MS = 30000;
const CLOSE_GRACE_MS = 5000;
/**
 * Returns the dedicated profile directory for `profileId`. Chrome 136+ refuses
 * remote debugging on the OS default user-data-dir, and a dedicated directory
 * also keeps agent browsing out of the user's everyday profile.
 */
function browserProfileDir(appDataDir, profileId) {
    if (!PROFILE_ID_PATTERN.test(profileId)) {
        throw new Error(`Invalid browser profile id: ${JSON.stringify(profileId)}`);
    }
    return path.join(appDataDir, 'browser-profiles', profileId);
}
/**
 * Chrome switches for an invisible (`--headless=new`), agent-drivable,
 * port-less browser. The pipe alone turns on Blink's AutomationControlled
 * feature (navigator.webdriver), which Google sign-in rejects, so it is always
 * paired with the disable switch. Passing `--force-device-scale-factor` when
 * the host display is HiDPI/Retina ensures headless Metal/IOSurface backing
 * buffers match `Emulation.setDeviceMetricsOverride` without `1x <-> 2x`
 * surface stride mismatches. On Linux without an active desktop keyring (such
 * as Xvfb or remote SSH), `--password-store=basic` avoids a 25s
 * org.freedesktop.secrets D-Bus stall.
 */
function chromeLaunchArgs(profileDir, platform = process.platform, env = process.env, deviceScaleFactor = 1) {
    const args = [
        '--headless=new',
        '--remote-debugging-pipe',
        '--disable-blink-features=AutomationControlled',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
    ];
    if (Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 1) {
        const scale = Math.min(3, Math.max(1, Number(deviceScaleFactor.toFixed(2))));
        args.push(`--force-device-scale-factor=${scale}`);
    }
    if (platform === 'linux' && !env.XDG_CURRENT_DESKTOP) {
        args.push('--password-store=basic');
    }
    args.push('about:blank');
    return args;
}
const liveSessions = new Set();
/** Closes every browser launched by this process; call on app quit. */
async function closeAllBrowserSessions() {
    await Promise.all([...liveSessions].map((session) => session.close()));
}
/**
 * Returns the engine to use on this machine, or undefined if none is
 * available. Prefers the installed Official Google Chrome and falls back to an
 * optional managed Chromium binary under the same pipe launch contract.
 */
function resolveBrowserEngine(findChrome = chromeDiscovery_1.findOfficialChrome, findManagedChromium, deviceScaleFactor = 1) {
    const officialPath = findChrome();
    if (officialPath) {
        return new PipeChromiumEngine('official-chrome', officialPath, child_process_1.spawn, deviceScaleFactor);
    }
    const managedPath = findManagedChromium?.();
    return managedPath
        ? new PipeChromiumEngine('managed-chromium', managedPath, child_process_1.spawn, deviceScaleFactor)
        : undefined;
}
/** Launches a Chromium-family binary with CDP on fds 3 (in) and 4 (out). */
class PipeChromiumEngine {
    constructor(kind, executablePath, spawnProcess = child_process_1.spawn, deviceScaleFactor = 1) {
        this.kind = kind;
        this.executablePath = executablePath;
        this.spawnProcess = spawnProcess;
        this.deviceScaleFactor = deviceScaleFactor;
    }
    async launch(profileDir) {
        const dpr = typeof this.deviceScaleFactor === 'function'
            ? this.deviceScaleFactor()
            : this.deviceScaleFactor;
        const child = this.spawnProcess(this.executablePath, chromeLaunchArgs(profileDir, process.platform, process.env, dpr), { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
        const exited = new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
                resolve();
                return;
            }
            child.once('exit', () => resolve());
            child.once('error', () => resolve());
        });
        const toBrowser = child.stdio[3];
        const fromBrowser = child.stdio[4];
        if (!isWritableStream(toBrowser) || !isReadableStream(fromBrowser)) {
            child.kill('SIGKILL');
            throw new Error('Failed to create CDP pipe stdio streams');
        }
        const cdp = new cdpPipe_1.CdpPipeConnection(toBrowser, fromBrowser);
        let version;
        try {
            version = await withTimeout(cdp.send('Browser.getVersion'), READY_TIMEOUT_MS, 'Browser did not answer Browser.getVersion');
        }
        catch (err) {
            child.kill('SIGKILL');
            throw err;
        }
        const session = new PipeBrowserSession(this.kind, child, version, cdp, exited);
        liveSessions.add(session);
        void exited.then(() => liveSessions.delete(session));
        return session;
    }
}
exports.PipeChromiumEngine = PipeChromiumEngine;
class PipeBrowserSession {
    constructor(kind, child, version, cdp, exited) {
        this.kind = kind;
        this.child = child;
        this.version = version;
        this.cdp = cdp;
        this.exited = exited;
    }
    get pid() {
        return this.child.pid;
    }
    close() {
        this.closing ?? (this.closing = this.doClose());
        return this.closing;
    }
    async doClose() {
        // Browser.close usually loses its reply to the exit itself; the exit is
        // the signal that matters.
        this.cdp.send('Browser.close').catch(() => { });
        const timer = setTimeout(() => this.child.kill('SIGKILL'), CLOSE_GRACE_MS);
        await this.exited;
        clearTimeout(timer);
    }
}
function isWritableStream(stream) {
    return (typeof stream === 'object' &&
        stream !== null &&
        'write' in stream &&
        typeof stream.write === 'function');
}
function isReadableStream(stream) {
    return (typeof stream === 'object' &&
        stream !== null &&
        'read' in stream &&
        typeof stream.read === 'function');
}
/** Clamps finite numeric input `v` into `[min, max]`, rounded to an integer. */
function clampInt(v, min, max, fb) {
    return typeof v === 'number' && Number.isFinite(v)
        ? Math.max(min, Math.min(max, Math.round(v)))
        : fb;
}
/** Clamps device pixel ratio `v` into `[1, 3]`, falling back to `fb`. */
function clampDpr(v, fb) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0
        ? Math.max(1, Math.min(3, v))
        : fb;
}
/** Extracts pixel width and height from a base64 JPEG's `SOF0..SOF2` marker. */
function jpegDimensions(base64) {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length < 11 || buf[0] !== 0xff || buf[1] !== 0xd8) {
        return null;
    }
    let i = 2;
    while (i < buf.length - 9) {
        if (buf[i] !== 0xff) {
            i++;
            continue;
        }
        const m = buf[i + 1];
        if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
            return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) {
            i += 2;
            continue;
        }
        i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
}
function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
