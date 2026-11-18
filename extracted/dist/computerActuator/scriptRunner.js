"use strict";
/**
 * @fileoverview Zone B process supervisor for the untrusted CUA Script Mode
 * child `bin/agy-desktop-script` (Zone C: Swift + JavaScriptCore under
 * Seatbelt).
 *
 * The runner spawns the child with no arguments, an empty environment and
 * three pipes, sends one `{"type":"run","source":...}` line on stdin, then
 * speaks the newline-delimited JSON protocol on stdout/stdin:
 *
 *   child -> host  {"type":"rpc","id":N,"method":"...","params":{...}}
 *   host -> child  {"type":"reply","id":N,"result":{...}}
 *                  {"type":"reply","id":N,"error":{"code":"...","message":"..."}}
 *   child -> host  {"type":"done","ok":true,"value":...}
 *                  {"type":"done","ok":false,"error":{"code","message","stack"?}}
 *
 * Everything the child sends is untrusted. Any framing or protocol breach,
 * the wall-clock timeout, the RSS watchdog, an abort (USER_STOP,
 * USER_TAKEOVER, AGENT_PAUSED) or a `{kill}` from the RPC handler SIGKILLs the
 * child at once and resolves the run. `run()` never throws on child behavior
 * and its promise resolves exactly once.
 *
 * A child that exits without `done` ends the run with SCRIPT_CRASHED (exit
 * code or signal in the message), not PROTOCOL_VIOLATION, so a Zone C
 * lockdown failure (`exit(1)`) is distinguishable from a misbehaving script.
 *
 * Logging (SM-7): the runner never logs script source, RPC params, typed text,
 * return values, error messages or stderr contents. It logs lengths, counts,
 * codes and a sha256 prefix of the source only. Host-generated failure
 * messages never echo child-controlled text either.
 *
 * Node-only: no Electron imports.
 */
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
exports.ScriptRunner = exports.DEFAULT_SCRIPT_ERROR_CODES = exports.ScriptRunnerCode = exports.MAX_RPC_METHOD_LENGTH = exports.EXIT_CLOSE_GRACE_MS = exports.MAX_SCRIPT_RSS_BYTES = exports.RSS_POLL_INTERVAL_MS = exports.MAX_SCRIPT_TIMEOUT_MS = exports.DEFAULT_SCRIPT_TIMEOUT_MS = exports.MAX_SCRIPT_ERROR_TEXT_BYTES = exports.STDERR_HEAD_BYTES = exports.MAX_STDERR_BYTES = exports.MAX_STDOUT_LINE_BYTES = void 0;
exports.defaultRssBytes = defaultRssBytes;
exports.truncateUtf8 = truncateUtf8;
const node_child_process_1 = require("node:child_process");
const crypto = __importStar(require("node:crypto"));
/** Maximum stdout line length in bytes, excluding the newline (P1-1). */
exports.MAX_STDOUT_LINE_BYTES = 4 * 1024 * 1024;
/** Maximum total stderr bytes before the child is killed (P1-1). */
exports.MAX_STDERR_BYTES = 64 * 1024;
/** Number of leading stderr bytes kept for diagnostics. */
exports.STDERR_HEAD_BYTES = 2 * 1024;
/** Cap for `message` and `stack` of a script error, in UTF-8 bytes. */
exports.MAX_SCRIPT_ERROR_TEXT_BYTES = 2 * 1024;
/** Default wall-clock limit for one script. */
exports.DEFAULT_SCRIPT_TIMEOUT_MS = 30000;
/** Upper bound for the wall-clock limit (SM-4). */
exports.MAX_SCRIPT_TIMEOUT_MS = 120000;
/** RSS watchdog poll interval (P1-1). */
exports.RSS_POLL_INTERVAL_MS = 150;
/** RSS limit for the child (P1-1). */
exports.MAX_SCRIPT_RSS_BYTES = 256 * 1024 * 1024;
/**
 * How long to wait for `close` (all stdio drained) after `exit` before
 * treating the child as crashed anyway.
 */
exports.EXIT_CLOSE_GRACE_MS = 500;
/** Maximum length of an RPC method name. */
exports.MAX_RPC_METHOD_LENGTH = 64;
/** Failure codes produced by the runner itself. */
exports.ScriptRunnerCode = {
    PROTOCOL_VIOLATION: 'PROTOCOL_VIOLATION',
    SCRIPT_TIMEOUT: 'SCRIPT_TIMEOUT',
    MEMORY_LIMIT_EXCEEDED: 'MEMORY_LIMIT_EXCEEDED',
    /** The child exited (or was killed by someone else) without `done`. */
    SCRIPT_CRASHED: 'SCRIPT_CRASHED',
    SCRIPT_SPAWN_FAILED: 'SCRIPT_SPAWN_FAILED',
    SCRIPT_ERROR: 'SCRIPT_ERROR',
    /** The injected `onRpc` handler threw, rejected or returned garbage. */
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    /** `run()` was called while another run is active on this runner. */
    RUNNER_BUSY: 'RUNNER_BUSY',
    /** AbortSignal fired without a `{code}` reason. */
    ABORTED: 'ABORTED',
};
/**
 * Error codes a script may report in `done ok:false`. These are the catchable
 * UI misses (P0-4) plus SCRIPT_ERROR. Any other code reported by the child is
 * replaced by SCRIPT_ERROR so that an untrusted script cannot impersonate a
 * host fence such as USER_STOP or APP_NEEDS_PERMISSION.
 */
exports.DEFAULT_SCRIPT_ERROR_CODES = new Set([
    'SCRIPT_ERROR',
    'STALE_REF',
    'ELEMENT_NOT_FOUND',
    'AX_ACTION_FAILED',
    'ACTION_NOT_SUPPORTED',
    'SELECTION_UNCHANGED',
    'NO_WINDOW',
    'WINDOW_OFF_DISPLAY',
]);
/** Default RSS probe: `ps -o rss= -p <pid>` (KiB), undefined on any error. */
function defaultRssBytes(pid) {
    return new Promise((resolve) => {
        try {
            (0, node_child_process_1.execFile)('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 1000 }, (err, stdout) => {
                if (err) {
                    resolve(undefined);
                    return;
                }
                const kib = Number.parseInt(String(stdout).trim(), 10);
                resolve(Number.isFinite(kib) && kib >= 0 ? kib * 1024 : undefined);
            });
        }
        catch (_e) {
            resolve(undefined);
        }
    });
}
const defaultSpawn = (command, args, options) => (0, node_child_process_1.spawn)(command, args, options);
/**
 * Supervises one `agy-desktop-script` child at a time. Reusable: once a run
 * settles, `run()` may be called again.
 */
class ScriptRunner {
    constructor(options) {
        this.options = options;
        this.active = null;
        this.diagnostics = null;
    }
    /** Runs `source` in a fresh child. Never rejects. */
    run(source, options) {
        if (this.active) {
            return Promise.resolve({
                ok: false,
                code: exports.ScriptRunnerCode.RUNNER_BUSY,
                message: 'another script is already running',
                killed: false,
            });
        }
        return new Promise((resolve) => {
            const run = new ScriptRun(this.options, String(source), options, (outcome, diagnostics) => {
                if (this.active === run) {
                    this.active = null;
                }
                this.diagnostics = diagnostics;
                resolve(outcome);
            });
            this.active = run;
            run.start();
        });
    }
    /**
     * SIGKILLs the active child synchronously and resolves its run with `code`.
     * Returns false if no run is active.
     */
    abort(code, message) {
        return this.active?.abort(code, message) ?? false;
    }
    /** True while a run is in progress. */
    get running() {
        return this.active !== null;
    }
    /** Diagnostics of the most recently settled run. */
    get lastDiagnostics() {
        return this.diagnostics;
    }
}
exports.ScriptRunner = ScriptRunner;
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function clampTimeout(timeoutMs) {
    if (typeof timeoutMs !== 'number' ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0) {
        return exports.DEFAULT_SCRIPT_TIMEOUT_MS;
    }
    return Math.max(1, Math.min(Math.floor(timeoutMs), exports.MAX_SCRIPT_TIMEOUT_MS));
}
/** Truncates `s` to at most `maxBytes` UTF-8 bytes on a code point boundary. */
function truncateUtf8(s, maxBytes) {
    if (Buffer.byteLength(s, 'utf8') <= maxBytes) {
        return s;
    }
    let out = '';
    let bytes = 0;
    for (const ch of s) {
        const n = Buffer.byteLength(ch, 'utf8');
        if (bytes + n > maxBytes) {
            break;
        }
        out += ch;
        bytes += n;
    }
    return out;
}
function errorCode(e) {
    if (typeof e === 'object' && e !== null) {
        const code = e.code;
        if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)) {
            return code;
        }
    }
    return 'unknown';
}
function abortReason(reason) {
    if (typeof reason === 'object' && reason !== null) {
        const { code, message } = reason;
        if (typeof code === 'string' && code.length > 0) {
            return {
                code,
                message: typeof message === 'string' ? message : 'script run aborted',
            };
        }
    }
    return { code: exports.ScriptRunnerCode.ABORTED, message: 'script run aborted' };
}
const noop = () => { };
/** State of one run. Every callback checks `settled` first. */
class ScriptRun {
    constructor(runnerOptions, source, runOptions, onSettle) {
        this.runnerOptions = runnerOptions;
        this.source = source;
        this.runOptions = runOptions;
        this.onSettle = onSettle;
        this.settled = false;
        this.child = null;
        this.exited = false;
        this.killSent = false;
        this.exitCode = null;
        this.exitSignal = null;
        this.stdoutChunks = [];
        this.stdoutBytes = 0;
        this.stderrBytes = 0;
        this.stderrHead = [];
        this.stderrHeadBytes = 0;
        this.pendingRpcId = null;
        this.lastRpcId = 0;
        this.rpcCount = 0;
        this.timeoutTimer = null;
        this.rssTimer = null;
        this.exitGraceTimer = null;
        this.rssPollInFlight = false;
        this.cleanups = [];
        this.startedAt = Date.now();
        this.timeoutMs = clampTimeout(runOptions.timeoutMs);
        this.sourceBytes = Buffer.byteLength(source, 'utf8');
        this.sourceSha256Prefix = crypto
            .createHash('sha256')
            .update(source, 'utf8')
            .digest('hex')
            .slice(0, 12);
        this.allowedErrorCodes =
            runnerOptions.allowedScriptErrorCodes ?? exports.DEFAULT_SCRIPT_ERROR_CODES;
    }
    start() {
        this.runnerOptions.log?.('script_run_start', {
            sourceBytes: this.sourceBytes,
            sourceSha256Prefix: this.sourceSha256Prefix,
            timeoutMs: this.timeoutMs,
        });
        const { signal } = this.runOptions;
        if (signal?.aborted) {
            const { code, message } = abortReason(signal.reason);
            this.fail(code, message, false);
            return;
        }
        let child;
        try {
            child = (this.runnerOptions.spawnFn ?? defaultSpawn)(this.runnerOptions.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
        }
        catch (e) {
            this.fail(exports.ScriptRunnerCode.SCRIPT_SPAWN_FAILED, `spawn failed: ${errorCode(e)}`, false);
            return;
        }
        this.child = child;
        const { stdin, stdout, stderr } = child;
        this.listen(child, 'error', (err) => {
            // After a successful spawn, 'error' only reports a failed kill/send;
            // 'exit'/'close' still decide the outcome.
            if (child.pid === undefined) {
                this.fail(exports.ScriptRunnerCode.SCRIPT_SPAWN_FAILED, `spawn failed: ${errorCode(err)}`, false);
            }
        });
        if (!stdin || !stdout || !stderr) {
            this.killAndFail(exports.ScriptRunnerCode.SCRIPT_SPAWN_FAILED, 'child is missing a stdio pipe');
            return;
        }
        this.listen(stdin, 'error', noop); // EPIPE once the child is gone.
        this.listen(stdout, 'error', noop);
        this.listen(stderr, 'error', noop);
        this.listen(stdout, 'data', (chunk) => this.onStdout(chunk));
        this.listen(stderr, 'data', (chunk) => this.onStderr(chunk));
        this.listen(child, 'exit', (code, sig) => this.onExit(code, sig));
        this.listen(child, 'close', (code, sig) => this.onClose(code, sig));
        if (signal) {
            const onAbort = () => {
                const { code, message } = abortReason(signal.reason);
                this.abort(code, message);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            this.cleanups.push(() => signal.removeEventListener('abort', onAbort));
        }
        this.timeoutTimer = setTimeout(() => {
            this.killAndFail(exports.ScriptRunnerCode.SCRIPT_TIMEOUT, `script exceeded its ${this.timeoutMs} ms wall-clock limit`);
        }, this.timeoutMs);
        this.rssTimer = setInterval(() => {
            void this.pollRss();
        }, exports.RSS_POLL_INTERVAL_MS);
        this.writeLine({ type: 'run', source: this.source });
    }
    abort(code, message) {
        if (this.settled) {
            return false;
        }
        this.killAndFail(String(code) || exports.ScriptRunnerCode.ABORTED, String(message ?? ''));
        return true;
    }
    listen(emitter, event, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn) {
        emitter.on(event, fn);
        this.cleanups.push(() => emitter.off(event, fn));
    }
    // ---- stdout framing -----------------------------------------------------
    onStdout(data) {
        if (this.settled) {
            return;
        }
        const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
        let start = 0;
        while (!this.settled) {
            const nl = chunk.indexOf(0x0a, start);
            if (nl === -1) {
                const rest = chunk.length - start;
                if (rest > 0) {
                    this.stdoutBytes += rest;
                    if (this.stdoutBytes > exports.MAX_STDOUT_LINE_BYTES) {
                        this.protocolViolation('stdout line exceeds 4 MiB');
                        return;
                    }
                    this.stdoutChunks.push(Buffer.from(chunk.subarray(start)));
                }
                return;
            }
            const lineBytes = this.stdoutBytes + (nl - start);
            if (lineBytes > exports.MAX_STDOUT_LINE_BYTES) {
                this.protocolViolation('stdout line exceeds 4 MiB');
                return;
            }
            const tail = chunk.subarray(start, nl);
            const line = this.stdoutChunks.length > 0
                ? Buffer.concat([...this.stdoutChunks, tail], lineBytes)
                : tail;
            this.stdoutChunks = [];
            this.stdoutBytes = 0;
            start = nl + 1;
            this.onLine(line);
        }
    }
    onLine(line) {
        let msg;
        try {
            msg = JSON.parse(line.toString('utf8'));
        }
        catch (_e) {
            this.protocolViolation('stdout line is not valid JSON');
            return;
        }
        if (!isPlainObject(msg) || typeof msg['type'] !== 'string') {
            this.protocolViolation('stdout message is not an object with a type');
            return;
        }
        switch (msg['type']) {
            case 'rpc':
                this.onRpcMessage(msg);
                return;
            case 'done':
                this.onDone(msg);
                return;
            default:
                this.protocolViolation('unexpected stdout message type');
        }
    }
    // ---- RPC ----------------------------------------------------------------
    onRpcMessage(msg) {
        const { id, method, params } = msg;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
            this.protocolViolation('rpc id must be a positive integer');
            return;
        }
        if (this.pendingRpcId !== null) {
            this.protocolViolation('rpc sent while another rpc is in flight');
            return;
        }
        if (id <= this.lastRpcId) {
            this.protocolViolation('rpc id is not strictly increasing');
            return;
        }
        if (typeof method !== 'string' ||
            method.length === 0 ||
            method.length > exports.MAX_RPC_METHOD_LENGTH) {
            this.protocolViolation('rpc method must be a non-empty string');
            return;
        }
        if (!isPlainObject(params)) {
            this.protocolViolation('rpc params must be an object');
            return;
        }
        this.lastRpcId = id;
        this.pendingRpcId = id;
        this.rpcCount++;
        let pending;
        try {
            pending = Promise.resolve(this.runOptions.onRpc(method, params, id));
        }
        catch (_e) {
            this.onRpcHandlerFailed(id);
            return;
        }
        pending.then((result) => this.onRpcResult(id, result), () => this.onRpcHandlerFailed(id));
    }
    onRpcResult(id, r) {
        if (this.settled || this.pendingRpcId !== id) {
            return; // Late result after settle: dropped.
        }
        this.pendingRpcId = null;
        if (isPlainObject(r) && isPlainObject(r['kill'])) {
            const { code, message } = r['kill'];
            this.killAndFail(typeof code === 'string' && code
                ? code
                : exports.ScriptRunnerCode.INTERNAL_ERROR, typeof message === 'string' ? message : '');
            return;
        }
        if (isPlainObject(r) && isPlainObject(r['error'])) {
            const { code, message } = r['error'];
            this.writeLine({
                type: 'reply',
                id,
                error: {
                    code: typeof code === 'string' ? code : exports.ScriptRunnerCode.SCRIPT_ERROR,
                    message: typeof message === 'string' ? message : '',
                },
            });
            return;
        }
        if (isPlainObject(r) && isPlainObject(r['result'])) {
            this.writeLine({ type: 'reply', id, result: r['result'] });
            return;
        }
        this.killAndFail(exports.ScriptRunnerCode.INTERNAL_ERROR, 'rpc handler returned a malformed result');
    }
    onRpcHandlerFailed(id) {
        if (this.settled || this.pendingRpcId !== id) {
            return;
        }
        this.pendingRpcId = null;
        this.killAndFail(exports.ScriptRunnerCode.INTERNAL_ERROR, 'rpc handler failed');
    }
    writeLine(obj) {
        let line;
        try {
            line = JSON.stringify(obj) + '\n';
        }
        catch (_e) {
            this.killAndFail(exports.ScriptRunnerCode.INTERNAL_ERROR, 'failed to serialize a message for the script');
            return;
        }
        try {
            this.child?.stdin?.write(line);
        }
        catch (_e) {
            // The child is gone; 'exit'/'close' decide the outcome.
        }
    }
    // ---- done ---------------------------------------------------------------
    onDone(msg) {
        if (this.pendingRpcId !== null) {
            this.protocolViolation('done sent while an rpc is in flight');
            return;
        }
        if (msg['ok'] === true) {
            const valueJson = JSON.stringify(msg['value']) ?? 'null';
            this.settle({ ok: true, valueJson });
            return;
        }
        if (msg['ok'] !== false) {
            this.protocolViolation('done.ok must be a boolean');
            return;
        }
        const err = msg['error'];
        if (!isPlainObject(err)) {
            this.protocolViolation('done.error must be an object');
            return;
        }
        // An uncaught DesktopError comes as SCRIPT_ERROR with its own code in
        // desktop_code: report that UI miss if it is an allowed one.
        const desktopCode = err['desktop_code'];
        const reported = typeof desktopCode === 'string' && desktopCode
            ? desktopCode
            : err['code'];
        const code = typeof reported === 'string' && this.allowedErrorCodes.has(reported)
            ? reported
            : exports.ScriptRunnerCode.SCRIPT_ERROR;
        const message = typeof err['message'] === 'string'
            ? truncateUtf8(err['message'], exports.MAX_SCRIPT_ERROR_TEXT_BYTES)
            : '';
        const outcome = { ok: false, code, message, killed: false };
        if (typeof err['stack'] === 'string') {
            outcome.stack = truncateUtf8(err['stack'], exports.MAX_SCRIPT_ERROR_TEXT_BYTES);
        }
        this.settle(outcome);
    }
    // ---- stderr, exit, watchdogs --------------------------------------------
    onStderr(data) {
        if (this.settled) {
            return;
        }
        const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
        this.stderrBytes += chunk.length;
        if (this.stderrHeadBytes < exports.STDERR_HEAD_BYTES) {
            const keep = chunk.subarray(0, exports.STDERR_HEAD_BYTES - this.stderrHeadBytes);
            this.stderrHead.push(Buffer.from(keep));
            this.stderrHeadBytes += keep.length;
        }
        if (this.stderrBytes > exports.MAX_STDERR_BYTES) {
            this.protocolViolation('stderr exceeds 64 KiB');
        }
    }
    onExit(code, sig) {
        if (this.settled) {
            return;
        }
        this.exited = true;
        this.exitCode = code;
        this.exitSignal = sig;
        // Normally 'close' follows once stdout is drained; don't wait forever if
        // a stray descriptor keeps a pipe open.
        this.exitGraceTimer ?? (this.exitGraceTimer = setTimeout(() => this.onClose(code, sig), exports.EXIT_CLOSE_GRACE_MS));
    }
    onClose(code, sig) {
        if (this.settled) {
            return;
        }
        if (!this.exited) {
            this.exited = true;
            this.exitCode = code;
            this.exitSignal = sig;
        }
        const how = this.exitSignal !== null
            ? `signal ${this.exitSignal}`
            : `exit code ${this.exitCode}`;
        this.fail(exports.ScriptRunnerCode.SCRIPT_CRASHED, `script exited without done (${how})`, false);
    }
    async pollRss() {
        const pid = this.child?.pid;
        if (this.settled || this.rssPollInFlight || pid === undefined) {
            return;
        }
        this.rssPollInFlight = true;
        let bytes;
        try {
            bytes = await (this.runnerOptions.rssBytes ?? defaultRssBytes)(pid);
        }
        catch (_e) {
            bytes = undefined;
        }
        finally {
            this.rssPollInFlight = false;
        }
        if (this.settled || bytes === undefined) {
            return;
        }
        if (bytes > exports.MAX_SCRIPT_RSS_BYTES) {
            this.killAndFail(exports.ScriptRunnerCode.MEMORY_LIMIT_EXCEEDED, `script RSS ${Math.round(bytes / (1024 * 1024))} MiB exceeds 256 MiB`);
        }
    }
    // ---- settle -------------------------------------------------------------
    protocolViolation(message) {
        this.killAndFail(exports.ScriptRunnerCode.PROTOCOL_VIOLATION, message);
    }
    killAndFail(code, message) {
        if (this.settled) {
            return;
        }
        this.kill();
        this.fail(code, message, true);
    }
    fail(code, message, killed) {
        this.settle({ ok: false, code, message, killed });
    }
    kill() {
        const child = this.child;
        if (!child || this.exited || this.killSent) {
            return;
        }
        this.killSent = true;
        try {
            child.kill('SIGKILL');
        }
        catch (_e) {
            // Already gone.
        }
    }
    settle(outcome) {
        if (this.settled) {
            return;
        }
        this.settled = true;
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
        }
        if (this.exitGraceTimer) {
            clearTimeout(this.exitGraceTimer);
        }
        if (this.rssTimer) {
            clearInterval(this.rssTimer);
        }
        this.timeoutTimer = null;
        this.exitGraceTimer = null;
        this.rssTimer = null;
        for (const cleanup of this.cleanups.splice(0)) {
            cleanup();
        }
        this.stdoutChunks = [];
        const child = this.child;
        if (child) {
            // Keep late stream/child errors from becoming uncaught exceptions.
            child.on('error', noop);
            for (const stream of [child.stdin, child.stdout, child.stderr]) {
                if (stream) {
                    stream.on('error', noop);
                    stream.destroy();
                }
            }
            this.kill(); // No-op if already killed or exited.
        }
        const diagnostics = {
            sourceBytes: this.sourceBytes,
            sourceSha256Prefix: this.sourceSha256Prefix,
            durationMs: Date.now() - this.startedAt,
            rpcCount: this.rpcCount,
            stderrBytes: this.stderrBytes,
            stderrHead: Buffer.concat(this.stderrHead).toString('utf8'),
            exitCode: this.exitCode,
            exitSignal: this.exitSignal,
        };
        const fields = {
            ok: outcome.ok,
            code: outcome.ok ? 'OK' : outcome.code,
            killed: outcome.ok ? false : outcome.killed,
            durationMs: diagnostics.durationMs,
            rpcCount: diagnostics.rpcCount,
            stderrBytes: diagnostics.stderrBytes,
            sourceSha256Prefix: this.sourceSha256Prefix,
        };
        if (outcome.ok) {
            fields['valueBytes'] = Buffer.byteLength(outcome.valueJson, 'utf8');
        }
        this.runnerOptions.log?.('script_run_end', fields);
        this.onSettle(outcome, diagnostics);
    }
}
