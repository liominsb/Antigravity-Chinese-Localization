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
exports.DesktopHelper = exports.MAX_MEDIA_BACKLOG_BYTES = void 0;
exports.probeHelperOnce = probeHelperOnce;
const child_process_1 = require("child_process");
const events_1 = require("events");
const readline = __importStar(require("readline"));
const frames_1 = require("../desktopHost/frames");
const runFile = (file, args, o) => new Promise((resolve, reject) => {
    (0, child_process_1.execFile)(file, args, { timeout: o.timeoutMs, ...(o.env ? { env: o.env } : {}) }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});
const ONE_SHOT_PROBE_TIMEOUT_MS = 5000;
/**
 * Runs `agy-desktop-helper probe` once and parses its JSON line: the TCC
 * grants as the actuating binary reads them (the code path `serve` uses),
 * fresh rather than a long-lived process's cached
 * CGPreflightScreenCaptureAccess(). Read-only (it never prompts, activates
 * or takes input).
 */
async function probeHelperOnce(binaryPath, env, run = runFile) {
    const out = await run(binaryPath, ['probe'], {
        env,
        timeoutMs: ONE_SHOT_PROBE_TIMEOUT_MS,
    });
    const line = out.trim().split('\n').pop() ?? '';
    const p = JSON.parse(line);
    if (typeof p.grants?.accessibility !== 'boolean' ||
        typeof p.grants?.screen_recording !== 'boolean') {
        throw new Error('helper probe: no grants in its output');
    }
    return { ...p, ok: true };
}
/** Media fd backlog above which writeMedia drops instead of buffering. */
exports.MAX_MEDIA_BACKLOG_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_RESTART_DELAY_MS = 10000;
class DesktopHelper extends events_1.EventEmitter {
    constructor(binaryPath, log = (m) => console.log(m), 
    /** Extra `serve` args, e.g. ['--hub-pid', '123', '--hub-path', '/x.app']. */
    serveArgs = [], opts = {}) {
        super();
        this.binaryPath = binaryPath;
        this.log = log;
        this.serveArgs = serveArgs;
        this.opts = opts;
        this.proc = null;
        this.nextId = 1;
        this.pending = new Map();
        this.stopped = false;
        this.restartDelay = 500;
        this.restartTimer = null;
        this.everStarted = false;
    }
    onTakeover(cb) {
        this.on('takeover', cb);
    }
    onReady(cb) {
        this.on('ready', cb);
    }
    onExit(cb) {
        this.on('helper_exit', cb);
    }
    onFrame(cb) {
        this.on('frame', cb);
    }
    onEvent(name, cb) {
        this.on(name, cb);
    }
    /**
     * Writes bytes to the child's fd 3 (`mediaOut`). False, and nothing
     * written, when the child isn't running or its pipe is backed up: media is
     * dropped rather than queued.
     */
    writeMedia(buf) {
        const out = this.mediaPipe;
        if (!out || out.destroyed || !out.writable) {
            return false;
        }
        if (out.writableLength > exports.MAX_MEDIA_BACKLOG_BYTES) {
            return false;
        }
        out.write(buf);
        return true;
    }
    /**
     * A fire-and-forget request (no `id`, no reply), only to a running child;
     * never starts one.
     */
    notify(op, args = {}) {
        const proc = this.proc;
        if (this.stopped || !proc || proc.exitCode !== null || proc.killed) {
            return;
        }
        proc.stdin?.write(JSON.stringify({ ...args, op }) + '\n');
    }
    /** True once the child was spawned (see DesktopHelperLike.started). */
    get started() {
        return this.everStarted;
    }
    /** True while the child process runs. */
    get running() {
        return !!this.proc && this.proc.exitCode === null && !this.proc.killed;
    }
    /** Starts the child now (otherwise the first call starts it). */
    start() {
        if (!this.stopped) {
            this.ensureStarted();
        }
    }
    get tag() {
        return `[${this.opts.name ?? 'DesktopHelper'}]`;
    }
    /** Starts the helper if it is not running. Idempotent. */
    ensureStarted() {
        if (this.proc && this.proc.exitCode === null && !this.proc.killed) {
            return this.proc;
        }
        this.log(`${this.tag} spawning ${this.binaryPath} serve`);
        this.everStarted = true;
        const proc = (0, child_process_1.spawn)(this.binaryPath, ['serve', ...this.serveArgs], {
            ...(this.opts.env ? { env: this.opts.env } : {}),
            stdio: this.opts.framePipe || this.opts.mediaOut
                ? ['pipe', 'pipe', 'pipe', 'pipe']
                : ['pipe', 'pipe', 'pipe'],
        });
        this.proc = proc;
        if (this.opts.mediaOut) {
            const out = proc.stdio[3];
            this.mediaPipe = out ?? undefined;
            out?.on('error', (err) => {
                this.log(`${this.tag} media pipe error: ${err.message}`);
            });
        }
        if (this.opts.framePipe) {
            // One parser per process: a restart never continues a partial record.
            const parser = new frames_1.FrameParser((r) => this.emit('frame', r), (m) => this.log(m));
            const frames = proc.stdio[3];
            frames?.on('data', (d) => parser.push(d));
            frames?.on('error', (err) => {
                this.log(`${this.tag} frame pipe error: ${err.message}`);
            });
        }
        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', (line) => this.onLine(line));
        proc.stderr.on('data', (d) => {
            const s = d.toString().trim();
            if (s) {
                this.log(`${this.tag} ${s}`);
            }
        });
        // A write after the child died fails with EPIPE here, not as an uncaught
        // exception; the exit (or the call's timeout) reports it.
        proc.stdin?.on('error', (err) => {
            this.log(`${this.tag} stdin error: ${err.message}`);
        });
        proc.on('error', (err) => {
            this.log(`${this.tag} spawn error: ${err.message}`);
            // A failed spawn (ENOENT, EACCES) emits no 'exit': forget the process
            // so the next call spawns again, and fail what waits on it.
            if (this.proc === proc &&
                (proc.pid === undefined || proc.exitCode !== null)) {
                this.proc = null;
                this.mediaPipe = undefined;
                this.failAll(`helper spawn error: ${err.message}`);
            }
        });
        proc.on('exit', (code, signal) => {
            // A superseded process (killed on a timeout, or stopped) must not fail
            // the calls of the one that replaced it or schedule another restart.
            if (this.proc !== proc) {
                return;
            }
            this.proc = null;
            this.mediaPipe = undefined;
            this.failAll(`helper exited (code=${code}, signal=${signal})`);
            if (!this.stopped) {
                this.emit('helper_exit', `code=${code}, signal=${signal}`);
                this.log(`${this.tag} exited (code=${code}, signal=${signal}); restarting in ${this.restartDelay}ms`);
                if (this.restartTimer) {
                    clearTimeout(this.restartTimer);
                }
                this.restartTimer = setTimeout(() => {
                    this.restartTimer = null;
                    if (!this.stopped) {
                        this.ensureStarted();
                    }
                }, this.restartDelay);
                this.restartDelay = Math.min(this.restartDelay * 2, MAX_RESTART_DELAY_MS);
            }
        });
        return proc;
    }
    onLine(line) {
        let msg;
        try {
            const parsed = JSON.parse(line);
            if (!parsed || typeof parsed !== 'object') {
                this.log(`${this.tag} non-object line: ${line.slice(0, 200)}`);
                return;
            }
            msg = parsed;
        }
        catch {
            this.log(`${this.tag} bad line: ${line.slice(0, 200)}`);
            return;
        }
        if (typeof msg.event === 'string') {
            if (msg.event === 'ready') {
                this.restartDelay = 500;
            }
            // An 'error' event without a listener would throw out of emit().
            if (msg.event === 'error' && this.listenerCount('error') === 0) {
                this.log(`${this.tag} helper error event: ${line.slice(0, 200)}`);
                return;
            }
            this.emit(msg.event, msg);
            return;
        }
        const id = typeof msg.id === 'number' ? msg.id : -1;
        const p = this.pending.get(id);
        if (!p) {
            return;
        }
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.resolve(msg);
    }
    failAll(reason) {
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.resolve({
                ok: false,
                error_code: 'ACTION_FAILED',
                error: `ACTION_FAILED: ${reason}`,
            });
            this.pending.delete(id);
        }
    }
    call(op, args = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
        if (this.stopped) {
            return Promise.resolve({
                ok: false,
                error_code: 'ACTION_FAILED',
                error: 'ACTION_FAILED: desktop helper stopped',
            });
        }
        const proc = this.ensureStarted();
        const id = this.nextId++;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve({
                    ok: false,
                    error_code: 'ACTION_FAILED',
                    error: `ACTION_FAILED: helper op '${op}' timed out after ${timeoutMs}ms`,
                });
                // A wedged helper would serialize every later op behind this one.
                proc.kill('SIGKILL');
            }, timeoutMs);
            this.pending.set(id, { resolve, timer });
            proc.stdin.write(JSON.stringify({ ...args, id, op }) + '\n');
        });
    }
    async probe() {
        const r = await this.call('probe', {}, 10000);
        if (!r.ok) {
            throw new Error(r.error ?? 'helper probe failed');
        }
        return r;
    }
    stop() {
        this.stopped = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        this.failAll('desktop helper stopped');
        if (this.proc) {
            this.proc.stdin?.end();
            this.proc.kill('SIGTERM');
            this.proc = null;
            this.mediaPipe = undefined;
        }
    }
}
exports.DesktopHelper = DesktopHelper;
