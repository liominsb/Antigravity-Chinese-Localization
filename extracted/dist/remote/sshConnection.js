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
exports.SshConnection = exports.PROMPT_CANCELLED = void 0;
exports.readLines = readLines;
exports.describeStatus = describeStatus;
exports.toRemoteError = toRemoteError;
exports.getFreeLoopbackPort = getFreeLoopbackPort;
/**
 * One SSH remote: the user's `ssh -D` with the bootstrap on stdin, the remote
 * language server (LS) checked through its SOCKS tunnel, and the LS's
 * sign-ins. The LS (--persistent_mode) outlives the connection, and the next
 * one re-attaches. Everything the remote sends is untrusted.
 * TODO(nathanjuan): Share the ssh spawning with the IDE's SSH extension
 * (Exafunction antigravity/extensions/antigravity-remote-openssh).
 */
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const events_1 = require("events");
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const path = __importStar(require("path"));
const stream_1 = require("stream");
const promises_1 = require("stream/promises");
const zlib = __importStar(require("zlib"));
const redirects_1 = require("../redirects");
const bootstrapScript_1 = require("./bootstrapScript");
const bootstrapProtocol_1 = require("./bootstrapProtocol");
const localNetwork_1 = require("./localNetwork");
const pausableTimeout_1 = require("./pausableTimeout");
const privateDir_1 = require("./privateDir");
const remoteLsArgs_1 = require("./remoteLsArgs");
const signInCallback_1 = require("./signInCallback");
const signInUrls_1 = require("./signInUrls");
const sshArgs_1 = require("./sshArgs");
const sshAskpass_1 = require("./sshAskpass");
const sshConfigHosts_1 = require("./sshConfigHosts");
const sshDestination_1 = require("./sshDestination");
const remoteSidecars_1 = require("./remoteSidecars");
const types_1 = require("./types");
/** Long enough for a slow first download. */
const DEFAULT_CONNECT_TIMEOUT_MS = types_1.REMOTE_CONNECT_TIMEOUT_SEC * 1000;
/** ssh's login (ProxyJump, ProxyCommand) and rc files, to the first line. */
const FIRST_LINE_TIMEOUT_MS = 60000;
const HEALTH_TIMEOUT_MS = 20000;
/** For the Exit RPC, then again for the bootstrap to end. */
const STOP_TIMEOUT_MS = 10000;
/** The LS's own login times out at 5 min. */
const SIGN_IN_CALLBACK_TTL_MS = 5 * 60000;
const SIGN_IN_RELAY_TIMEOUT_MS = 15000;
/** The same sign-in URL opens at most this often. */
const SIGN_IN_REOPEN_MS = 30000;
const MAX_SIGN_INS_PER_MINUTE = 5;
/** Window of MAX_SIGN_INS_PER_MINUTE. */
const SIGN_IN_RATE_WINDOW_MS = 60000;
const STDERR_TAIL_BYTES = 64 * 1024;
const MAX_LOGGED_STDERR_LINES = 100;
const MAX_LINE_CHARS = 64 * 1024;
/** After ssh exits: a ProxyCommand helper may hold its stdio open. */
const CLOSE_GRACE_MS = 2000;
/** The LS binds "localhost". */
const REMOTE_LOOPBACK = '127.0.0.1';
/** A CANCELLED error's message when the user cancelled one of ssh's prompts. */
exports.PROMPT_CANCELLED = 'Sign-in cancelled.';
/** ssh pastes -F unquoted into a ProxyJump's sh -c command, %-expanding it. */
const PLAIN_PATH = /^[A-Za-z0-9._/+@=:,-]+$/;
/** For `ssh -G`, which may run the config's Match exec commands. */
const PROXY_CHECK_TIMEOUT_MS = 5000;
/** `ssh -G` prints a few KiB; a longer dump counts as no answer. */
const MAX_CONFIG_DUMP_CHARS = 1024 * 1024;
const liveChildren = new Set();
/** Children spawned detached, so each leads its own process group. */
const groupLeaders = new WeakSet();
let exitHookInstalled = false;
/** Signals the child, and its process group if it leads one and runs. */
function signalChild(child, signal) {
    // Once it's reaped, its group id could name another group.
    const running = child.exitCode === null && child.signalCode === null;
    try {
        if (running && groupLeaders.has(child) && child.pid !== undefined) {
            process.kill(-child.pid, signal);
        }
        else {
            child.kill(signal);
        }
    }
    catch {
        // Already gone.
    }
}
function trackChild(child, detached) {
    const pid = child.pid;
    if (detached && pid !== undefined) {
        groupLeaders.add(child);
        // Once, as it exits: a ProxyJump child it left behind may still ask.
        child.once('exit', () => {
            try {
                process.kill(-pid, 'SIGTERM');
            }
            catch {
                // None left.
            }
        });
    }
    liveChildren.add(child);
    const forget = () => liveChildren.delete(child);
    child.once('exit', forget);
    // A child that could not be spawned emits 'error', and never 'exit'.
    child.once('error', forget);
    if (!exitHookInstalled) {
        exitHookInstalled = true;
        // Last resort (quit without dispose): an orphaned ssh would keep its
        // unauthenticated SOCKS port open.
        process.on('exit', () => {
            for (const c of liveChildren) {
                signalChild(c, 'SIGTERM');
            }
        });
    }
}
// Which connection handles each OAuth callback port: two connections to one
// LS ("devbox" and "me@devbox") both see its sign-ins.
const callbackPortOwners = new Map();
// Callback ports of organization sign-ins being asked about: one question
// per sign-in, also across connections.
const callbackPortsAsking = new Set();
/**
 * Events: `status` (text) while connecting; `disconnected` (RemoteError) when
 * a ready connection ends (LS_STOPPED if the LS went away; else it keeps
 * running: connect again to re-attach); `signInError` (RemoteError) for a
 * sign-in URL it can't handle.
 */
class SshConnection extends events_1.EventEmitter {
    /** Recent stderr, redacted; restarts once the remote shell runs. */
    get stderrTail() {
        const raw = this.rawStderrTail;
        // Once full, its first line may be cut, maybe inside a secret.
        return this.redact(raw.length < STDERR_TAIL_BYTES ? raw : raw.slice(raw.indexOf('\n') + 1));
    }
    set stderrTail(text) {
        this.rawStderrTail = text;
    }
    constructor(opts) {
        super();
        this.opts = opts;
        this._state = 'idle';
        /** Serializes listener changes: sign-in URLs can overlap. */
        this.signInQueue = Promise.resolve();
        this.socksPort = 0;
        /** Whole lines, not redacted: read them as stderrTail. */
        this.rawStderrTail = '';
        this.stderrPartial = '';
        this.stderrLinesLogged = 0;
        this.stderrLinesNotLogged = 0;
        // Set at the first protocol line: later stderr comes from the remote
        // shell's rc files, so it never classifies a failure.
        this.sessionStarted = false;
        /** Off only for the retry after a config forward failed. */
        this.exitOnForwardFailure = true;
        this.disposed = false;
        /** connect() failed or timed out: late async steps must not leak. */
        this.aborted = false;
        /** connect()'s deadline: an upload moves it. */
        this.deadline = 0;
        this.secrets = new Set();
        /** Aborted on a drop or teardown: ends an upload or a sign-in question. */
        this.closing = new AbortController();
        this.askingSignIn = false;
        this.recentSignIns = [];
        this.mismatchReported = false;
        this.lastStatus = '';
        /** Writing the copy: teardown waits for it. */
        this.copying = Promise.resolve();
        /** The window's plugin:// routes, from this session's LS only. */
        this.sidecars = new remoteSidecars_1.RemoteSidecarRoutes(() => {
            const d = this.session?.discovery;
            const transport = this.transport;
            return d && transport && this._state === 'ready'
                ? { transport, httpPort: d.httpPort, csrfToken: d.csrfToken }
                : undefined;
        });
        const parsed = (0, sshDestination_1.parseSshDestination)(opts.destination);
        this.destination = parsed.destination;
        this.label = opts.label ?? parsed.label;
    }
    get state() {
        return this._state;
    }
    /** Aborts when the connection drops or is disposed. */
    get closedSignal() {
        return this.closing.signal;
    }
    /** Fetches for the window's sidecar pages while the session is up. */
    get sidecarFetch() {
        return this._state === 'ready' ? this.transport?.sidecars : undefined;
    }
    /** Once per instance; rejects with a {@link RemoteError}. */
    async connect() {
        if (this._state !== 'idle') {
            throw new Error('SshConnection.connect() can only be called once');
        }
        this._state = 'connecting';
        this.deadline =
            Date.now() + (this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
        let timer;
        try {
            const session = await Promise.race([
                this.attemptWithForwardRetry(),
                new Promise((_, reject) => {
                    const check = () => {
                        const left = this.deadline - Date.now();
                        if (left > 0) {
                            timer = setTimeout(check, left);
                            return;
                        }
                        reject(new types_1.RemoteError('CONNECTION_FAILED', `Timed out connecting to ${this.label}.`));
                    };
                    check();
                }),
            ]);
            if (this.disposed || this.aborted) {
                throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
            }
            return session;
        }
        catch (err) {
            // Disposed: the user cancelled; what the torn-down ssh said is moot.
            const remoteErr = this.disposed
                ? new types_1.RemoteError('CANCELLED', 'Connection cancelled.')
                : toRemoteError(err);
            this.fatal ?? (this.fatal = remoteErr);
            this.aborted = true;
            await this.teardown();
            this.session = undefined;
            this._state = this.disposed ? 'closed' : 'failed';
            throw remoteErr;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * What this run's ssh gets as -F: on macOS and Linux, a private copy of the
     * config file, checked as it's read (it may have changed since connect).
     */
    async configFileArg() {
        const file = this.opts.configFile;
        if (file === undefined || process.platform === 'win32') {
            return file;
        }
        // Not held for teardown: a read can hang (e.g. on NFS).
        const bytes = await (0, sshConfigHosts_1.readSshConfigFile)(file);
        this.throwIfCancelled();
        const copying = this.writeConfigCopy(bytes);
        this.copying = copying.catch(() => { });
        return copying;
    }
    async writeConfigCopy(bytes) {
        this.configDir ?? (this.configDir = await (0, privateDir_1.makePrivateDir)(this.opts.userDataDir, 'give ssh the SSH config file', (dir) => PLAIN_PATH.test(path.join(dir, 'config'))
            ? undefined
            : "ssh can't take its path"));
        const copy = path.join(this.configDir, 'config');
        await fs.promises.writeFile(copy, bytes, { mode: 0o600 });
        return copy;
    }
    async removeConfigCopy() {
        if (this.configDir) {
            await fs.promises
                .rm(this.configDir, { recursive: true, force: true })
                .catch(() => { });
        }
    }
    /**
     * Whether ssh reaches the host through a ProxyJump or ProxyCommand, as
     * `ssh -G` with the run's own argv says (Match can test its command); false
     * if it can't tell, as the run then shows any problem.
     */
    viaProxy(sshBin, args) {
        const { signal } = this.closing;
        return new Promise((resolve) => {
            // -G connects nowhere and runs no command, but runs Match exec commands:
            // in ssh's own process group, ended on the timeout or a teardown.
            const child = (0, child_process_1.spawn)(sshBin, ['-G', ...args], {
                stdio: ['ignore', 'pipe', 'ignore'],
                env: this.opts.env ?? process.env,
                detached: true,
                windowsHide: true,
            });
            trackChild(child, true);
            const stop = () => signalChild(child, 'SIGTERM');
            const timer = setTimeout(stop, this.opts.testOverrides?.proxyCheckTimeoutMs ?? PROXY_CHECK_TIMEOUT_MS);
            signal.addEventListener('abort', stop);
            let dump = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                dump += chunk;
                if (dump.length > MAX_CONFIG_DUMP_CHARS) {
                    stop();
                }
            });
            const done = (proxied) => {
                clearTimeout(timer);
                signal.removeEventListener('abort', stop);
                resolve(proxied);
            };
            child.once('error', () => done(false));
            child.once('close', (code) => done(code === 0 && dump.length <= MAX_CONFIG_DUMP_CHARS && (0, sshArgs_1.usesProxy)(dump)));
        });
    }
    /** Before each step: one started after a teardown would outlive it. */
    throwIfCancelled() {
        if (this.disposed || this.aborted) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
    }
    /**
     * Stops the remote LS, and its agents, with its Exit RPC. Resolves on HTTP
     * 200, or when the session ends with LS_STOPPED (the LS may exit first);
     * rejects with the drop's own error if it ends otherwise.
     */
    async stopRemoteServer() {
        const d = this.session?.discovery;
        const transport = this.transport;
        if (!d || !transport || this._state !== 'ready') {
            throw new types_1.RemoteError('CONNECTION_CLOSED', 'Not connected.');
        }
        // A real LS always has one.
        if (d.httpPort === 0) {
            throw new types_1.RemoteError('UNKNOWN', `The Antigravity server on ${this.label} has no HTTP port to stop it through.`);
        }
        const timeoutMs = this.opts.testOverrides?.stopTimeoutMs ?? STOP_TIMEOUT_MS;
        let ended;
        const onEnd = (err) => (ended = err);
        this.on('disconnected', onEnd);
        try {
            let status;
            let rpcError = '';
            try {
                const res = await transport.fetch(`http://${REMOTE_LOOPBACK}:${d.httpPort}/exa.language_server_pb.LanguageServerService/Exit`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'connect-protocol-version': '1',
                        'x-codeium-csrf-token': d.csrfToken,
                    },
                    body: '{}',
                    redirect: 'manual',
                    signal: AbortSignal.timeout(timeoutMs),
                });
                status = res.status;
                await res.body?.cancel().catch(() => { });
            }
            catch (err) {
                rpcError = errorMessage(err);
            }
            if (status === 200) {
                return;
            }
            if (status !== undefined) {
                throw new types_1.RemoteError('UNKNOWN', `The Antigravity server on ${this.label} refused to stop (HTTP ${status}).`);
            }
            // No answer: once the LS exits, the bootstrap ends within its tick.
            await this.untilClosed(timeoutMs);
            if (ended?.code === 'LS_STOPPED') {
                return;
            }
            if (ended) {
                throw ended;
            }
            if (this.disposed) {
                throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
            }
            throw new types_1.RemoteError('UNKNOWN', `Could not confirm that the Antigravity server on ${this.label} stopped` +
                (rpcError ? ` (${this.redact((0, types_1.sanitizeRemoteText)(rpcError))}).` : '.'));
        }
        finally {
            this.off('disconnected', onEnd);
        }
    }
    /** The remote LS keeps running. */
    dispose() {
        this.disposing ?? (this.disposing = (async () => {
            this.disposed = true;
            await this.teardown();
            // A listener still starting sees disposed, closes and frees its port.
            await this.signInQueue;
            if (this._state !== 'failed') {
                this._state = 'closed';
            }
            this.removeAllListeners();
        })());
        return this.disposing;
    }
    /** Late async steps stop once this is true. */
    get finished() {
        return (this.disposed ||
            this.aborted ||
            this._state === 'closed' ||
            this._state === 'failed');
    }
    async attempt() {
        this.status(`Connecting to ${this.label}…`);
        const { artifacts, resolutionError } = this.opts.server;
        if (resolutionError) {
            this.log(resolutionError);
        }
        const overrides = this.opts.testOverrides;
        // Taken by another process first? ssh exits (ExitOnForwardFailure=yes).
        this.socksPort = await getFreeLoopbackPort();
        const marker = (0, bootstrapProtocol_1.newMarker)();
        const csrfToken = crypto.randomUUID();
        this.secrets.add(csrfToken);
        const script = (0, bootstrapScript_1.buildBootstrapScript)({
            marker,
            version: artifacts.version,
            artifacts: {
                x64: { url: artifacts.x64.url },
                arm64: { url: artifacts.arm64.url },
            },
            serverPath: artifacts.remotePath,
            attachOnly: this.opts.attachOnly,
            appDataDir: this.opts.appDataDirName,
            discoveryFileName: (0, bootstrapProtocol_1.discoveryFileNameFor)(types_1.REMOTE_LS_WORKSPACE_ID),
            lsArgs: (0, remoteLsArgs_1.buildRemoteLsArgs)({
                version: artifacts.version,
                csrfToken,
                appDataDir: this.opts.appDataDirName,
            }),
            testOverrides: overrides && {
                allowInsecureArtifactUrls: overrides.allowInsecureArtifactUrls,
                skipServerBinaryCheck: overrides.skipServerBinaryCheck,
                tickSec: overrides.tickSec,
            },
        });
        const sshBin = this.opts.sshBin ?? (0, sshArgs_1.resolveSshBinary)(this.opts.env);
        // Each step starts only before a teardown, which waits for the copy and
        // ends ssh -G.
        this.throwIfCancelled();
        const configFile = await this.configFileArg();
        this.throwIfCancelled();
        const argsFor = (connectTimeout) => (0, sshArgs_1.buildControlSshArgs)({
            destination: this.destination,
            socksPort: this.socksPort,
            exitOnForwardFailure: this.exitOnForwardFailure,
            batchMode: !this.opts.askpass,
            connectTimeout,
            configFile,
        });
        // ConnectTimeout would also bound a proxy's login, which may ask.
        const args = argsFor(!this.opts.askpass || !(await this.viaProxy(sshBin, argsFor(true))));
        this.throwIfCancelled();
        const starting = this.opts.askpass &&
            sshAskpass_1.AskpassRelay.start(this.opts.askpass, this.opts.userDataDir);
        // Teardown disposes it too, even while it starts, closing a prompt.
        this.relay = starting;
        const relay = await starting;
        this.throwIfCancelled();
        this.log(`$ ${sshBin} ${args.join(' ')}`);
        const env = this.opts.env ?? process.env;
        const child = (0, child_process_1.spawn)(sshBin, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: relay ? relay.env(env) : env,
            // A process group that Cancel ends, ProxyJump included; and no tty, so
            // OpenSSH before 8.4 uses askpass too.
            detached: Boolean(relay),
            windowsHide: true,
        });
        this.child = child;
        trackChild(child, Boolean(relay));
        let firstLineTimer;
        return await new Promise((resolve, reject) => {
            let settled = false;
            let readySeen = false;
            let uploading = false;
            const settleReject = (err) => {
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            };
            const fail = (err) => {
                this.fatal ?? (this.fatal = err);
                settleReject(this.fatal);
                signalChild(child, 'SIGTERM');
            };
            // ssh's ConnectTimeout covers neither the login nor the rc files.
            const firstLineMs = overrides?.firstLineTimeoutMs ?? FIRST_LINE_TIMEOUT_MS;
            firstLineTimer = new pausableTimeout_1.PausableTimeout(() => {
                if (this.sessionStarted || settled) {
                    return;
                }
                fail(new types_1.RemoteError('CONNECTION_FAILED', `${this.label} did not start the setup within ${Math.round(firstLineMs / 1000)} s. ` +
                    'ssh (e.g. a ProxyCommand or ProxyJump login) or a command in ' +
                    'your shell startup files (e.g. ~/.bashrc) may be waiting for input.', 
                // The host just worked: on a reconnect, a stall is likely the network.
                { retryable: this.opts.attachOnly === true }));
            }, firstLineMs);
            // The user's time to answer doesn't count.
            relay?.on('prompt', (open) => {
                if (open) {
                    firstLineTimer?.pause();
                }
                else {
                    firstLineTimer?.resume();
                }
                if (!settled) {
                    this.emit('status', open ? 'Waiting for your answer…' : this.lastStatus);
                }
            });
            relay?.on('cancel', (byUser) => fail(byUser
                ? new types_1.RemoteError('CANCELLED', exports.PROMPT_CANCELLED, {
                    userCancelled: true,
                })
                : new types_1.RemoteError('UNKNOWN', "Couldn't answer ssh's prompt.")));
            child.on('error', (err) => {
                this.fatal ?? (this.fatal = err.code === 'ENOENT'
                    ? new types_1.RemoteError('UNKNOWN', `Could not run "${sshBin}". Install OpenSSH or set ANTIGRAVITY_SSH_BIN.`)
                    : new types_1.RemoteError('UNKNOWN', `Could not run ssh: ${err.message}`));
                settleReject(this.fatal);
            });
            // EPIPE when ssh exits early; the exit handler reports the real cause.
            child.stdin.on('error', () => { });
            child.stderr.on('data', (data) => {
                this.appendStderr(data);
                // Without ExitOnForwardFailure ssh carries on, and another process
                // could own our SOCKS port.
                if (!this.exitOnForwardFailure &&
                    !this.sessionStarted &&
                    (0, sshArgs_1.socksListenFailed)(this.stderrTail, this.socksPort)) {
                    fail(new types_1.RemoteError('UNKNOWN', `ssh could not listen on its SOCKS port ${this.socksPort}.`));
                }
            });
            this.stopReading = readLines(child.stdout, MAX_LINE_CHARS, (line) => {
                if (this.disposed || this.aborted) {
                    return;
                }
                const ev = (0, bootstrapProtocol_1.parseBootstrapLine)(line, marker);
                if (!ev) {
                    return; // MOTD, rc files or keep-alives.
                }
                if (!this.sessionStarted) {
                    this.sessionStarted = true;
                    this.stderrTail = '';
                    firstLineTimer?.clear();
                }
                switch (ev.type) {
                    case 'status': {
                        if (settled) {
                            break;
                        }
                        const text = describeStatus(ev.text, this.label);
                        if (text) {
                            this.status(text);
                        }
                        else {
                            this.log(`Not showing an unknown status: ${(0, types_1.sanitizeRemoteText)(ev.text, 200)}`);
                        }
                        break;
                    }
                    case 'needUpload':
                        // The script asks only while installing, which attachOnly skips.
                        if (this.opts.attachOnly || readySeen) {
                            fail(new types_1.RemoteError('UNKNOWN', `${this.label} asked for an upload it can't need.`));
                        }
                        else if (!settled && !uploading) {
                            uploading = true;
                            // The bootstrap's upload watchdog governs it.
                            this.deadline += types_1.REMOTE_UPLOAD_TIMEOUT_SEC * 1000;
                            this.upload(child.stdin, artifacts[ev.arch].url, ev.reason).catch((err) => fail(toRemoteError(err)));
                        }
                        break;
                    case 'ready':
                        if (readySeen) {
                            break;
                        }
                        readySeen = true;
                        this.secrets.add(ev.discovery.csrfToken);
                        this.onReady(ev.discovery, artifacts.version).then((session) => {
                            if (!settled && !this.aborted && !this.disposed) {
                                settled = true;
                                this.session = session;
                                this._state = 'ready';
                                resolve(session);
                            }
                        }, (err) => fail(toRemoteError(err)));
                        break;
                    case 'openUrl':
                        void this.handleOpenUrl(ev.url);
                        break;
                    case 'error':
                        this.log(`Remote error ${ev.code}: ${(0, types_1.sanitizeRemoteText)(ev.message)}`);
                        // No download URL: our reason explains it better.
                        this.fatal ?? (this.fatal = ev.code === 'INSTALL_FAILED' && resolutionError
                            ? new types_1.RemoteError('INSTALL_FAILED', resolutionError)
                            : new types_1.RemoteError(ev.code, (0, types_1.sanitizeRemoteText)(ev.message), {
                                reportedByRemote: true,
                            }));
                        settleReject(this.fatal);
                        break;
                }
            }, () => fail(new types_1.RemoteError('UNKNOWN', `${this.label} sent a line longer than ${MAX_LINE_CHARS} characters.`)));
            // On 'close', stdout is fully read, so a final ERROR line wins; 'exit'
            // plus CLOSE_GRACE_MS covers a helper still holding stdio.
            let finished = false;
            let graceTimer;
            const onFinished = (code, signal) => {
                if (finished) {
                    return;
                }
                finished = true;
                clearTimeout(graceTimer);
                firstLineTimer?.clear();
                if (this.child === child) {
                    this.child = undefined;
                }
                this.flushStderr();
                const err = this.fatal ?? this.exitError(code, signal);
                if (!settled) {
                    settleReject(err);
                }
                else if (!this.disposed && this._state === 'ready') {
                    this.handleDisconnect(err);
                }
            };
            child.on('exit', (code, signal) => {
                graceTimer = setTimeout(() => onFinished(code, signal), CLOSE_GRACE_MS);
                graceTimer.unref();
            });
            child.on('close', onFinished);
            child.stdin.write(script);
        }).finally(async () => {
            firstLineTimer?.clear();
            if (this.relay === starting) {
                this.relay = undefined;
            }
            // Once set up, ssh asks nothing more.
            await relay?.dispose();
        });
    }
    async attemptWithForwardRetry() {
        try {
            return await this.attempt();
        }
        catch (err) {
            if (!this.retryForwardFailure()) {
                throw err;
            }
            return this.attempt();
        }
    }
    /**
     * Once more without ExitOnForwardFailure if ssh stopped, before the
     * bootstrap's first line, over a forward other than our SOCKS port (e.g. a
     * LocalForward in the user's config whose port a terminal session holds).
     */
    retryForwardFailure() {
        if (!this.exitOnForwardFailure ||
            this.sessionStarted ||
            this.fatal ||
            this.finished ||
            !(0, sshArgs_1.otherForwardFailed)(this.stderrTail, this.socksPort)) {
            return false;
        }
        this.log('A port forward failed; trying again without ExitOnForwardFailure.');
        this.exitOnForwardFailure = false;
        this.stderrTail = '';
        return true;
    }
    /** Streams the server from `url`, gzipped, into the bootstrap's stdin. */
    async upload(stdin, url, reason) {
        this.log(`${this.label} could not download the server: ${(0, types_1.sanitizeRemoteText)(reason, 200)}`);
        this.status(`Uploading the Antigravity server to ${this.label}…`);
        const { signal } = this.closing;
        let failed;
        stdin.once('error', () => (failed ?? (failed = 'upload')));
        try {
            if (!url) {
                throw new Error('no download URL');
            }
            // No redirects: the host's own download allows none off https.
            const res = await this.opts.fetch(url, { signal, redirect: 'error' });
            if (!res.ok || !res.body) {
                await res.body?.cancel().catch(() => { });
                throw new Error(`HTTP ${res.status}`);
            }
            const body = stream_1.Readable.fromWeb(res.body);
            body.once('error', () => (failed ?? (failed = 'download')));
            await (0, promises_1.pipeline)(body, zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }), stdin, { signal });
        }
        catch (err) {
            // A write failed first: ssh or the bootstrap ended, and they report why.
            if (failed === 'upload' || this.finished) {
                this.log(`Upload stopped: ${errorMessage(err)}`);
                return;
            }
            throw new types_1.RemoteError('INSTALL_FAILED', `Neither ${this.label} nor this computer could download the Antigravity server: ${errorMessage(err)}`);
        }
    }
    exitError(code, signal) {
        if (this.sessionStarted) {
            // The bootstrap exits 0 by itself only when the LS it serves is gone.
            return code === 0
                ? new types_1.RemoteError('LS_STOPPED', `The Antigravity server on ${this.label} stopped.`)
                : new types_1.RemoteError('CONNECTION_CLOSED', `The connection to ${this.label} was lost: ${describeExit(code, signal, this.stderrTail)}`, { retryable: true });
        }
        const { code: kind, explained } = (0, sshArgs_1.classifySshFailure)(this.stderrTail, code);
        const network = kind === 'CONNECTION_FAILED' || kind === 'CONNECTION_CLOSED';
        // Unexplained: retried only on a reconnect, where it may be the network.
        return new types_1.RemoteError(kind, describeExit(code, signal, this.stderrTail), {
            retryable: network && (explained || this.opts.attachOnly === true),
            couldPrompt: Boolean(this.opts.askpass),
        });
    }
    async onReady(discovery, expectedVersion) {
        this.log(`Remote server ready (pid ${discovery.pid}, version ${(0, types_1.sanitizeRemoteText)(discovery.lsVersion, 64)}).`);
        this.status(`Connecting to the Antigravity server on ${this.label}…`);
        const transport = await this.opts.createTransport(this.socksPort);
        if (this.disposed || this.aborted) {
            await transport.close().catch(() => { });
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        this.transport = transport;
        if (discovery.httpPort > 0) {
            await this.waitHealthy(transport, discovery.httpPort);
        }
        return {
            url: `https://${REMOTE_LOOPBACK}:${discovery.httpsPort}/`,
            socksPort: this.socksPort,
            discovery,
            expectedVersion,
        };
    }
    async waitHealthy(transport, httpPort) {
        const timeoutMs = this.opts.testOverrides?.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        let lastErr = '';
        while (Date.now() < deadline && !this.disposed && !this.aborted) {
            try {
                const res = await transport.fetch(`http://${REMOTE_LOOPBACK}:${httpPort}/healthz`, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
                await res.body?.cancel().catch(() => { });
                if (res.status === 200) {
                    return;
                }
                lastErr = `HTTP ${res.status}`;
            }
            catch (err) {
                lastErr = errorMessage(err);
            }
            // OpenSSH reports a refused forward on stderr only.
            if (/administratively prohibited/i.test(this.stderrTail)) {
                throw new types_1.RemoteError('FORWARDING_PROHIBITED', 'The SSH server does not allow port forwarding (AllowTcpForwarding).');
            }
            await sleep(500);
        }
        if (this.disposed || this.aborted) {
            throw new types_1.RemoteError('CANCELLED', 'Connection cancelled.');
        }
        throw new types_1.RemoteError('LS_START_FAILED', `The Antigravity server on ${this.label} did not respond through the SSH tunnel (${(0, types_1.sanitizeRemoteText)(lastErr, 200)}).`);
    }
    /**
     * Opens only the LS's own sign-in URLs, as parsed, and only once it listens
     * for the callback: if that port is taken locally, nothing opens, so the
     * code can't reach an unrelated local service.
     */
    async handleOpenUrl(url) {
        if (this.finished) {
            return;
        }
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            return;
        }
        if (!(0, localNetwork_1.isRemoteOpenableUrl)(url)) {
            this.log(`Not opening ${(0, types_1.sanitizeRemoteText)(parsed.origin, 200)}: only web addresses outside the local network can be opened.`);
            return;
        }
        const signIn = (0, signInUrls_1.classifyOpenUrl)(parsed);
        if (!signIn) {
            this.log(`Not opening ${(0, types_1.sanitizeRemoteText)(parsed.origin, 200)}: it is not a sign-in URL.`);
            if ((0, signInUrls_1.isSignInOrigin)(parsed) && !this.mismatchReported) {
                // E.g. another server version. Once: the remote could repeat it.
                this.mismatchReported = true;
                this.emit('signInError', new types_1.RemoteError('UNKNOWN', `The sign-in request of the Antigravity server on ${this.label} doesn't match what this app expects, so it was not opened. ` +
                    'Update Antigravity, or restart the server on that host.'));
            }
            return;
        }
        const port = signIn.callbackPort;
        const handledElsewhere = () => {
            const owner = callbackPortOwners.get(port);
            if (owner && owner !== this) {
                this.log(`Sign-in callback port ${port} is handled by another connection.`);
                return true;
            }
            return false;
        };
        if (handledElsewhere()) {
            return;
        }
        if (!this.allowSignIn(parsed.href)) {
            return;
        }
        // Asked before listening: a declined sign-in gets nothing.
        if (signIn.provider !== undefined) {
            if (callbackPortsAsking.has(port)) {
                this.log(`Not asking again about the sign-in on callback port ${port}: an answer is pending.`);
                return;
            }
            callbackPortsAsking.add(port);
            let yes;
            try {
                yes = await this.confirmOrganizationSignIn(signIn.provider);
            }
            finally {
                callbackPortsAsking.delete(port);
            }
            if (!yes || this.finished || handledElsewhere()) {
                return;
            }
        }
        // No await since the check: a connection seeing it meanwhile backs off.
        callbackPortOwners.set(port, this);
        try {
            await this.ensureSignInCallback(port, signIn.state);
        }
        catch (err) {
            if (callbackPortOwners.get(port) === this) {
                callbackPortOwners.delete(port);
            }
            if (this.finished) {
                return;
            }
            const remoteErr = new types_1.RemoteError('UNKNOWN', `Local port ${port} is in use, so the sign-in callback can't ` +
                `reach ${this.label}. Close the program using it and sign in again. ` +
                `(${errorMessage(err)})`);
            this.log(remoteErr.message);
            this.emit('signInError', remoteErr);
            return;
        }
        if (this.finished) {
            return;
        }
        try {
            await this.opts.openExternal(parsed.href);
        }
        catch (err) {
            this.log(`Could not open the browser: ${errorMessage(err)}`);
        }
    }
    /** Only a yes is a yes; one question at a time. */
    async confirmOrganizationSignIn(provider) {
        if (this.askingSignIn) {
            this.log(`Not opening the organization sign-in for ${provider}: another one is waiting for an answer.`);
            return false;
        }
        this.askingSignIn = true;
        try {
            const yes = await this.opts.confirmOrganizationSignIn(provider, this.closing.signal);
            // Aborted: declined, even if the answer came first.
            return yes === true && !this.closing.signal.aborted;
        }
        catch (err) {
            this.log(`Could not ask about the organization sign-in: ${errorMessage(err)}`);
            return false;
        }
        finally {
            this.askingSignIn = false;
        }
    }
    /** So that the remote can't flood the browser or hold callback ports. */
    allowSignIn(href) {
        const now = Date.now();
        this.recentSignIns = this.recentSignIns.filter((s) => now - s.at < SIGN_IN_RATE_WINDOW_MS);
        if (this.recentSignIns.some((s) => s.href === href && now - s.at < SIGN_IN_REOPEN_MS)) {
            this.log('Not opening the same sign-in URL again so soon.');
            return false;
        }
        if (this.recentSignIns.length >= MAX_SIGN_INS_PER_MINUTE) {
            this.log(`Not opening more than ${MAX_SIGN_INS_PER_MINUTE} sign-in URLs a minute.`);
            return false;
        }
        this.recentSignIns.push({ href, at: now });
        return true;
    }
    /** One listener at a time: a new sign-in replaces the last one's. */
    ensureSignInCallback(port, state) {
        const run = this.signInQueue.then(() => this.replaceSignInCallback(port, state));
        this.signInQueue = run.catch(() => { });
        return run;
    }
    async replaceSignInCallback(port, state) {
        const existing = this.signIn;
        if (existing?.port === port && existing.state === state) {
            return; // The same sign-in again.
        }
        // The port stays this connection's while it replaces its listener there.
        await this.closeSignInCallback(port);
        const cancelled = () => new types_1.RemoteError('CANCELLED', 'The connection was closed.');
        if (this.finished) {
            throw cancelled();
        }
        this.log(`Listening for the sign-in callback on port ${port}.`);
        const overrides = this.opts.testOverrides;
        const callback = await (0, signInCallback_1.startSignInCallback)({
            port,
            state,
            // Browsers resolve "localhost" to either loopback: both must be ours,
            // or whoever holds [::1]:<port> could get the code.
            listenHosts: overrides?.callbackListenHosts ?? ['127.0.0.1', '::1'],
            ttlMs: overrides?.signInCallbackTtlMs ?? SIGN_IN_CALLBACK_TTL_MS,
            // Only the path and query, to the LS's listener on the same port.
            relay: async (pathAndQuery) => {
                const transport = this.transport;
                if (!transport) {
                    throw new types_1.RemoteError('CONNECTION_CLOSED', 'Not connected.');
                }
                let res;
                try {
                    res = await transport.fetch(`http://${REMOTE_LOOPBACK}:${port}${pathAndQuery}`, {
                        redirect: 'manual',
                        signal: AbortSignal.timeout(SIGN_IN_RELAY_TIMEOUT_MS),
                    });
                }
                catch (err) {
                    // The LS answers a good callback with a redirect (see Transport).
                    if ((0, redirects_1.isManualRedirect)(err)) {
                        return 302;
                    }
                    throw err;
                }
                await res.body?.cancel().catch(() => { });
                return (0, redirects_1.isManualRedirect)(res) ? 302 : res.status;
            },
            log: (line) => this.log(line),
        });
        // Closed meanwhile: nothing may keep listening for it.
        if (this.finished) {
            await callback.close();
            throw cancelled();
        }
        this.signIn = callback;
        callbackPortOwners.set(port, this);
        void callback.ended.then(() => {
            if (this.signIn === callback) {
                this.signIn = undefined;
                callbackPortOwners.delete(port);
            }
        });
        this.log(`Waiting for the sign-in callback on port ${port}.`);
    }
    async closeSignInCallback(keepPort) {
        const callback = this.signIn;
        if (!callback) {
            return;
        }
        this.signIn = undefined;
        try {
            await callback.close();
        }
        finally {
            // Released only once closed: another connection may listen there next.
            if (callback.port !== keepPort &&
                callbackPortOwners.get(callback.port) === this) {
                callbackPortOwners.delete(callback.port);
            }
        }
    }
    /** Resolves once the connection drops or is disposed, or after `ms`. */
    untilClosed(ms) {
        const { signal } = this.closing;
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            const done = () => {
                clearTimeout(timer);
                resolve();
            };
            if (signal.aborted) {
                done();
            }
            else {
                signal.addEventListener('abort', done, { once: true });
            }
        });
    }
    /** The connection ended after READY (synchronous state change). */
    handleDisconnect(err) {
        this.log(`Disconnected from ${this.label}: ${err.message}`);
        this.session = undefined;
        this.closing.abort();
        this._state = 'closed';
        void this.closeTransport();
        this.emit('disconnected', err);
    }
    async closeTransport() {
        await this.closeSignInCallback();
        const transport = this.transport;
        this.transport = undefined;
        await transport?.close().catch(() => { });
    }
    stopChild() {
        const child = this.child;
        this.child = undefined;
        this.stopReading?.();
        this.stopReading = undefined;
        if (!child ||
            // Never spawned (ENOENT).
            child.pid === undefined ||
            child.exitCode !== null ||
            child.signalCode !== null) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const killTimer = setTimeout(() => {
                signalChild(child, 'SIGKILL');
                resolve();
            }, 3000);
            child.once('exit', () => {
                clearTimeout(killTimer);
                resolve();
            });
            signalChild(child, 'SIGTERM');
        });
    }
    async teardown() {
        // Signal ssh first: if the app is quitting, this is what must happen.
        const stopped = this.stopChild();
        this.closing.abort();
        await Promise.all([
            this.closeTransport(),
            stopped,
            this.relay?.then((relay) => relay.dispose(), () => { }),
            // A copy being made goes once it exists.
            this.copying.then(() => this.removeConfigCopy()),
        ]);
    }
    status(text) {
        this.lastStatus = text;
        this.log(text);
        this.emit('status', text);
    }
    log(line) {
        this.opts.log?.(`[ssh ${this.label}] ${this.redact(line)}`);
    }
    redact(text) {
        let out = text;
        for (const secret of this.secrets) {
            if (secret) {
                out = out.split(secret).join('<redacted>');
            }
        }
        return out;
    }
    appendStderr(data) {
        const text = this.stderrPartial + data.toString('utf8');
        const end = text.lastIndexOf('\n') + 1;
        // A newline-free flood: keep only the end.
        this.stderrPartial = text.slice(end).slice(-STDERR_TAIL_BYTES);
        this.addStderrLines(text.slice(0, end));
    }
    /** At exit: the last line may lack a newline. */
    flushStderr() {
        if (this.stderrPartial) {
            const line = this.stderrPartial;
            this.stderrPartial = '';
            this.addStderrLines(`${line}\n`);
        }
        if (this.stderrLinesNotLogged > 0) {
            this.log(`ssh: ${this.stderrLinesNotLogged} more lines not logged.`);
            this.stderrLinesNotLogged = 0;
        }
    }
    /** Whole lines: one tail copy per chunk, not per line. */
    addStderrLines(lines) {
        if (!lines) {
            return;
        }
        if (!this.sessionStarted) {
            // Later stderr is the remote shell's: not worth logging.
            this.logStderrLines(lines);
        }
        this.rawStderrTail = (this.rawStderrTail + lines).slice(-STDERR_TAIL_BYTES);
    }
    logStderrLines(lines) {
        let start = 0;
        while (start < lines.length &&
            this.stderrLinesLogged < MAX_LOGGED_STDERR_LINES) {
            const end = lines.indexOf('\n', start);
            const line = this.redact(lines.slice(start, end).replace(/\r$/, ''));
            start = end + 1;
            if (line.trim()) {
                this.stderrLinesLogged++;
                this.log(`ssh: ${(0, types_1.sanitizeRemoteText)(line)}`);
            }
        }
        for (let i = lines.indexOf('\n', start); i >= 0;) {
            this.stderrLinesNotLogged++;
            i = lines.indexOf('\n', i + 1);
        }
    }
}
exports.SshConnection = SshConnection;
/**
 * Calls `onLine` per line (no line break), or `onOverflow` once, then stops,
 * for a line over `maxChars`. stop() also drops buffered lines and listeners.
 */
function readLines(stream, maxChars, onLine, onOverflow) {
    let partial = '';
    let stopped = false;
    stream.setEncoding('utf8');
    const onData = (chunk) => {
        if (stopped) {
            return;
        }
        let start = 0;
        for (;;) {
            const nl = chunk.indexOf('\n', start);
            if (nl < 0) {
                break;
            }
            const line = partial + chunk.slice(start, nl);
            partial = '';
            start = nl + 1;
            if (line.length > maxChars) {
                stopped = true;
                onOverflow();
                return;
            }
            onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
            if (stopped) {
                return;
            }
        }
        partial += chunk.slice(start);
        if (partial.length > maxChars) {
            stopped = true;
            partial = '';
            onOverflow();
        }
    };
    const onEnd = () => {
        if (!stopped && partial) {
            onLine(partial.endsWith('\r') ? partial.slice(0, -1) : partial);
        }
        partial = '';
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    return () => {
        stopped = true;
        partial = '';
        stream.off('data', onData);
        stream.off('end', onEnd);
    };
}
/** The bootstrap's STATUS texts; any other is the remote's, never shown. */
function describeStatus(text, label) {
    switch (text) {
        case 'checking':
            return `Checking ${label}…`;
        case 'waiting':
            return `Waiting for another window to finish installing on ${label}…`;
        case 'invalid binary removed':
            return `Replacing an invalid server binary on ${label}…`;
        case 'downloading':
            return `Downloading the Antigravity server on ${label}…`;
        case 'installed':
            return `Installed the Antigravity server on ${label}.`;
        case 'starting':
            return `Starting the Antigravity server on ${label}…`;
        case 'attached':
            return `Connecting to the running server on ${label}…`;
        default:
            return undefined;
    }
}
function describeExit(code, signal, stderr) {
    // Forwarded connections that failed say nothing about why ssh exited.
    const lastLine = stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^channel \d+: open failed/i.test(l))
        .pop() ?? '';
    const how = signal ? `signal ${signal}` : `exit code ${code}`;
    return lastLine
        ? `ssh exited (${how}): ${(0, types_1.sanitizeRemoteText)(lastLine, 300)}`
        : `ssh exited (${how}).`;
}
function toRemoteError(err) {
    if (err instanceof types_1.RemoteError) {
        return err;
    }
    return new types_1.RemoteError('UNKNOWN', errorMessage(err));
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function getFreeLoopbackPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => {
                if (typeof address !== 'object' || address === null) {
                    reject(new Error('Could not get a free loopback port.'));
                }
                else {
                    resolve(address.port);
                }
            });
        });
    });
}
