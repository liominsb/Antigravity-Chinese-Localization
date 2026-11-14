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
exports.parseShellEnvOutput = parseShellEnvOutput;
exports.readLoginShellEnv = readLoginShellEnv;
exports.loadLoginShellEnv = loadLoginShellEnv;
/**
 * Reads the environment of the user's login shell (PATH, SSH_AUTH_SOCK,
 * proxy settings, ...) so ssh behaves as it does in a terminal, also when the
 * app was started from the Dock or a desktop launcher.
 *
 * Like the shell-env package, but with a timeout and without execa's
 * process-wide exit/signal hooks: those reset Electron's SIGTERM and SIGINT
 * handling, after which a SIGTERM killed the app without cleanup.
 */
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const net_1 = require("net");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const loginShellPolicy_1 = require("./loginShellPolicy");
const DELIMITER = '_AGY_SHELL_ENV_DELIMITER_';
/** env by path: no alias or function named env, and csh has no `command`. */
const COMMAND = `echo -n "${DELIMITER}"; /usr/bin/env; echo -n "${DELIMITER}"; exit`;
/**
 * Most shell output read for the environment, which takes a few KiB: past
 * it without one, the read fails.
 */
const MAX_OUTPUT_CHARS = 1024 * 1024;
/**
 * How long a read may take, fallback shells included. It's longer than a
 * caller waits (loginShellEnvReads.ts): a slow rc file then answers the next
 * caller.
 */
const LOAD_BUDGET_MS = 60000;
/** Between the SIGHUP that ends a timed-out shell and the SIGKILL. */
const KILL_GRACE_MS = 1000;
/** Never taken from the shell. */
const SKIPPED_VARS = new Set([
    ...Object.keys(loginShellPolicy_1.LOGIN_SHELL_INJECTED_ENV),
    ...loginShellPolicy_1.LOGIN_SHELL_DROPPED_VARS,
]);
/* eslint-disable no-control-regex */
// Line-bounded: an unterminated sequence must not swallow later lines.
const OSC_SEQUENCE = /\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\)?/g;
const CSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
/* eslint-enable no-control-regex */
/** Strips ANSI escape sequences (prompts and rc files may print colors). */
function stripAnsi(text) {
    return text.replace(OSC_SEQUENCE, '').replace(CSI_SEQUENCE, '');
}
/**
 * Parses `env` output framed by the delimiter, without the variables the
 * shell isn't to give; undefined if the frame isn't closed yet, or holds no
 * variable (the shell failed, or couldn't run env).
 */
function parseShellEnvOutput(stdout) {
    // It ends at the first delimiter that starts a line: env prints one only as
    // dash's `_=<delimiter>` (the previous command's last argument), and what
    // rc files left running may print more after it.
    const start = stdout.indexOf(DELIMITER);
    const end = start < 0 ? -1 : stdout.indexOf(`\n${DELIMITER}`, start + DELIMITER.length);
    if (end < 0) {
        return undefined;
    }
    const env = {};
    let any = false;
    const frame = stdout.slice(start + DELIMITER.length, end);
    for (const line of stripAnsi(frame).split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) {
            any = true;
            const name = line.slice(0, eq);
            if (!SKIPPED_VARS.has(name)) {
                env[name] = line.slice(eq + 1);
            }
        }
    }
    return any ? env : undefined;
}
function defaultShell() {
    if (process.env.SHELL) {
        return process.env.SHELL;
    }
    try {
        const shell = os.userInfo().shell;
        if (shell) {
            return shell;
        }
    }
    catch {
        // No passwd entry.
    }
    return '/bin/sh';
}
/**
 * Tried in order when the default shell fails, as shell-env does (e.g. for a
 * non-POSIX login shell such as Nushell).
 */
const FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash'];
/** The fallback shells that exist and are not the same file as `shell`. */
function fallbackShells(shell) {
    const realPath = (file) => {
        try {
            return fs.realpathSync(file);
        }
        catch {
            return undefined;
        }
    };
    const seen = new Set([realPath(shell) ?? shell]);
    return FALLBACK_SHELLS.filter((candidate) => {
        const real = realPath(candidate);
        if (!real || seen.has(real)) {
            return false;
        }
        seen.add(real);
        return true;
    });
}
/** The default shell, then the fallbacks, looked up once it fails. */
function* candidateShells() {
    const first = defaultShell();
    yield first;
    yield* fallbackShells(first);
}
/** Process groups of the login shells still running. */
const runningShells = new Set();
let exitHookInstalled = false;
function signalGroup(pgid, signal) {
    try {
        process.kill(-pgid, signal);
    }
    catch {
        // Gone.
    }
}
/** Ends a shell's group as the app exits: a read may still be running. */
function trackShell(pgid) {
    runningShells.add(pgid);
    if (!exitHookInstalled) {
        exitHookInstalled = true;
        process.on('exit', () => {
            for (const group of runningShells) {
                signalGroup(group, 'SIGKILL');
            }
        });
    }
    return () => runningShells.delete(pgid);
}
/**
 * Runs the login shell interactively (`-ilc`, with stdin from /dev/null; csh
 * and tcsh with `-l` and the command on stdin) in its own session (no
 * terminal to grab), and returns the environment it ends up with. Rejects on
 * timeout, failure or unparsable output. On Windows resolves to an empty
 * object (nothing to read).
 */
function readLoginShellEnv(opts) {
    if (process.platform === 'win32') {
        return Promise.resolve({});
    }
    return new Promise((resolve, reject) => {
        const onStdin = loginShellPolicy_1.LOGIN_SHELLS_READING_STDIN.includes(path.basename(opts.shell));
        const child = (0, child_process_1.spawn)(opts.shell, onStdin ? ['-l'] : ['-ilc', COMMAND], {
            stdio: [onStdin ? 'pipe' : 'ignore', 'pipe', 'ignore'],
            detached: true,
            env: { ...process.env, ...loginShellPolicy_1.LOGIN_SHELL_INJECTED_ENV },
        });
        if (onStdin) {
            // A shell that exits without reading it must not fail the app (EPIPE).
            child.stdin?.on('error', () => { });
            child.stdin?.end(`${COMMAND}\n`);
        }
        // detached: the shell leads its own process group, rc helpers too.
        const pgid = child.pid;
        if (pgid !== undefined) {
            child.once('exit', trackShell(pgid));
        }
        let stdout = '';
        let done = false;
        const finish = (settle) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            // What rc files left running may keep stdout open: that must not keep
            // the app alive, nor fill memory.
            if (child.stdout instanceof net_1.Socket) {
                child.stdout.unref();
            }
            child.unref();
            settle();
        };
        const giveUp = (why) => {
            finish(() => reject(new Error(why)));
            if (pgid !== undefined) {
                // As a closed terminal would; then for good.
                signalGroup(pgid, 'SIGHUP');
                setTimeout(() => signalGroup(pgid, 'SIGKILL'), KILL_GRACE_MS).unref();
            }
        };
        const timer = setTimeout(() => giveUp(`timed out after ${opts.timeoutMs} ms`), opts.timeoutMs);
        timer.unref();
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            if (done) {
                return;
            }
            stdout += chunk;
            // Not at the end of a chunk only: rc files may leave background jobs
            // that hold stdout open, and print more right after the frame.
            const env = parseShellEnvOutput(stdout);
            if (env) {
                finish(() => resolve(env));
            }
            else if (stdout.length >= MAX_OUTPUT_CHARS) {
                // Not at the timeout: the fallback shells get the rest of the budget.
                giveUp(`no environment in ${MAX_OUTPUT_CHARS} characters of output`);
            }
        });
        child.on('error', (err) => finish(() => reject(err)));
        child.on('close', (code) => {
            const env = parseShellEnvOutput(stdout);
            finish(() => env
                ? resolve(env)
                : reject(new Error(`the login shell exited (code ${code}) without an environment`)));
        });
    });
}
/**
 * {@link readLoginShellEnv} of the default shell, then of /bin/zsh and
 * /bin/bash if it fails, all within `budgetMs`. Never rejects: undefined if
 * none worked (and it logs why), `{}` on Windows (nothing to read).
 */
async function loadLoginShellEnv(budgetMs = LOAD_BUDGET_MS) {
    const deadline = Date.now() + budgetMs;
    const errors = [];
    for (const shell of candidateShells()) {
        const timeoutMs = deadline - Date.now();
        if (timeoutMs <= 0) {
            break;
        }
        try {
            const env = await readLoginShellEnv({ timeoutMs, shell });
            if (errors.length > 0) {
                // A fallback's rc files aren't the login shell's: say so.
                console.warn(`Read the login shell environment with ${shell}, as ${errors.join('; ')}`);
            }
            return env;
        }
        catch (err) {
            errors.push(`${shell}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    console.warn(`Could not read the login shell environment: ${errors.join('; ')}`);
    return undefined;
}
