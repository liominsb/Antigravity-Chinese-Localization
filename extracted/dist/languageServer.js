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
exports.LS_BINARY = void 0;
exports.getLsCL = getLsCL;
exports.getLsProcess = getLsProcess;
exports.getLsPort = getLsPort;
exports.clearLsProcess = clearLsProcess;
exports.extractCrashStackTrace = extractCrashStackTrace;
exports.startLanguageServer = startLanguageServer;
exports.setIntentionalTermination = setIntentionalTermination;
exports.startAndMonitorLanguageServer = startAndMonitorLanguageServer;
exports.killLanguageServer = killLanguageServer;
exports.setupLocalCertTrust = setupLocalCertTrust;
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const shell_env_1 = require("shell-env");
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const readline = __importStar(require("readline"));
const stream_1 = require("stream");
const paths_1 = require("./paths");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LS_STARTUP_TIMEOUT_MS = 60000;
// ---------------------------------------------------------------------------
// Crash Monitoring Constants
// ---------------------------------------------------------------------------
const RESTART_WINDOW_MS = 60000;
const MAX_RESTARTS = 3;
const RESTART_COOLDOWN_MS = 2000;
const MAX_STDERR_BUFFER = 100000;
const CRASH_TRIGGER_PHRASES = [
    'panic:',
    'fatal error:',
    'unexpected fault address',
    'runtime:',
    'running GoogleExitFunction',
    'panic serving',
];
const isWindows = process.platform === 'win32';
const binName = isWindows ? 'language_server.exe' : 'language_server';
exports.LS_BINARY = electron_1.app.isPackaged
    ? path_1.default.join(process.resourcesPath, 'bin', binName)
    : process.env.CODEIUM_LANGUAGE_SERVER_BIN ||
        path_1.default.join(__dirname, '..', 'bin', binName);
/**
 * Gets the build CL of the language server by running it with --stamp.
 */
function getLsCL() {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(exports.LS_BINARY, ['--stamp'], (error, stdout, _stderr) => {
            if (error) {
                console.error('Failed to get LS stamp:', error);
                resolve('');
                return;
            }
            const match = /Built at CL: (\d+)/.exec(stdout);
            if (match) {
                resolve(match[1]);
            }
            else {
                resolve('');
            }
        });
    });
}
// Pattern: "listening on <proto> port at <N> for HTTP or HTTPS"
const PORT_PATTERN = /listening on \w+ port at (\d+) for HTTP(S)?\b/i;
// Pattern: OAuth authorization URL
const AUTH_URL_PATTERN = /https:\/\/accounts\.google\.com\/o\/oauth2\/auth\S+/;
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let _lsProcess = null;
let _lsPort = 0;
let _intentionalTermination = false;
let _restartCount = 0;
let _lastRestartTime = 0;
/** Returns the active language server process, or null if not running. */
function getLsProcess() {
    return _lsProcess;
}
/** Returns the active language server port, or 0 if not running. */
function getLsPort() {
    return _lsPort;
}
/** Clears the language server process reference (call after killing it). */
function clearLsProcess() {
    _lsProcess = null;
}
// ---------------------------------------------------------------------------
// Crash log extraction
// ---------------------------------------------------------------------------
/**
 * Extract lines after a crash trigger phrase from a list of stderr lines.
 * Returns all lines from the first trigger phrase onwards.
 */
function getLinesAfterCrash(lines) {
    const crashLines = [];
    let foundTrigger = false;
    for (const line of lines) {
        if (CRASH_TRIGGER_PHRASES.some((phrase) => line.includes(phrase))) {
            foundTrigger = true;
        }
        if (foundTrigger) {
            crashLines.push(line);
        }
    }
    return crashLines;
}
/**
 * Best-effort extraction of the crash stack trace from buffered stderr.
 * Returns the stack trace string, or undefined if no trigger phrase was found.
 */
function extractCrashStackTrace(stderr) {
    const lines = stderr.split('\n');
    const crashLines = getLinesAfterCrash(lines);
    return crashLines.length > 0 ? crashLines.join('\n') : undefined;
}
/**
 * Sets environment variables for bundled node modules so the language
 * server can find them.
 *
 * NOTE: If you add a new module that needs to be executed this way:
 * 1. Add it to `asarUnpack` in `package.json` so it is available on the filesystem.
 * 2. Add it to `modules` in the callsite of setupNodeModules.
 */
function setupNodeModules(env, modules) {
    for (const mod of modules) {
        let entryPoint = '';
        if (!electron_1.app.isPackaged) {
            entryPoint = path_1.default.join(__dirname, '..', 'node_modules', mod.name, ...mod.relativePath);
        }
        else {
            entryPoint = path_1.default.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', mod.name, ...mod.relativePath);
        }
        env[mod.envVar] = entryPoint;
    }
}
/**
 * Spawn the language server and resolve with a LanguageServerHandle once
 * the LS reports its HTTP port. Rejects on timeout or unexpected exit
 * during startup.
 *
 * After resolving, callers should monitor `handle.exitPromise` to detect
 * crashes that occur after startup.
 */
function startLanguageServer(port, csrf, headless) {
    return new Promise((resolve, reject) => {
        const logStream = fs.createWriteStream((0, paths_1.getLsLogPath)(), { flags: 'w' });
        // We need to pass the override flags because the LS is running in standalone mode
        const args = [
            '--standalone',
            '--override_ide_name',
            'antigravity',
            '--subclient_type',
            'hub',
            '--override_ide_version',
            electron_1.app.getVersion(),
            '--override_user_agent_name',
            'antigravity',
            '--https_server_port',
            String(port),
            '--csrf_token',
            csrf,
            '--app_data_dir',
            (0, paths_1.getAppDataDirName)(),
            '--api_server_url',
            'https://generativelanguage.googleapis.com',
            '--cloud_code_endpoint',
            'https://daily-cloudcode-pa.googleapis.com',
            '--enable_sidecars',
        ];
        if (headless) {
            args.push('--headless');
        }
        console.log(`\nSpawning: ${exports.LS_BINARY} ${args.join(' ')}\n`);
        // Electron apps don't inherit shell environment variables when they are not launched through the terminal.
        // We need to load the shell env explicitly so the language server can discover tools in the user's environment.
        const env = { ...process.env, ...(0, shell_env_1.shellEnvSync)() };
        // We don't read the file to avoid adding start up latency.
        // LS will read when browser recording encoder is invoked.
        env['AGY_BROWSER_ACTIVE_PORT_FILE'] = (0, paths_1.getActivePortFilePath)();
        (0, utils_1.setupNodeWrapper)(env);
        setupNodeModules(env, [
            {
                name: 'chrome-devtools-mcp',
                envVar: 'CHROME_DEVTOOLS_MCP_JS',
                relativePath: ['build', 'src', 'bin', 'chrome-devtools-mcp.js'],
            },
        ]);
        _lsProcess = (0, child_process_1.spawn)(exports.LS_BINARY, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
        });
        if (!headless) {
            // Close stdin immediately — the LS may block waiting for metadata on stdin.
            _lsProcess.stdin.end();
        }
        const combined = new stream_1.PassThrough();
        _lsProcess.stdout.pipe(combined, { end: false });
        _lsProcess.stderr.pipe(combined, { end: false });
        // Buffer stderr for crash log extraction (ring buffer)
        const stderrChunks = [];
        let stderrLength = 0;
        _lsProcess.stderr.on('data', (data) => {
            const str = data.toString();
            stderrChunks.push(str);
            stderrLength += str.length;
            while (stderrChunks.length > 0 && stderrLength > MAX_STDERR_BUFFER) {
                stderrLength -= stderrChunks.shift().length;
            }
        });
        let resolved = false;
        let logStreamEnded = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Timeout: language server did not report its port within ${LS_STARTUP_TIMEOUT_MS / 1000}s`));
            }
        }, LS_STARTUP_TIMEOUT_MS);
        const rl = readline.createInterface({ input: combined, crlfDelay: Infinity });
        rl.on('close', () => {
            if (!logStreamEnded) {
                logStreamEnded = true;
                logStream.end();
            }
        });
        rl.on('line', (line) => {
            if (!logStreamEnded) {
                logStream.write(line + '\n');
            }
            if (!resolved) {
                const m = PORT_PATTERN.exec(line);
                if (m) {
                    resolved = true;
                    clearTimeout(timer);
                    const actualPort = parseInt(m[1], 10);
                    _lsPort = actualPort;
                    resolve({
                        port: actualPort,
                        process: _lsProcess,
                        exitPromise,
                    });
                }
            }
            const authMatch = AUTH_URL_PATTERN.exec(line);
            if (authMatch) {
                console.log('\n' + '='.repeat(60));
                console.log('  Please visit the following URL to authorize.');
                console.log('  After authorizing, paste the authorization code below.');
                console.log(`  ${authMatch[0]}`);
                console.log('='.repeat(60) + '\n');
            }
        });
        // Exit promise — resolves whenever the process exits (whether during
        // startup or after). Includes crash stack trace extraction.
        const exitPromise = new Promise((exitResolve) => {
            _lsProcess.on('exit', (code, signal) => {
                if (!logStreamEnded) {
                    logStreamEnded = true;
                    logStream.end();
                }
                const fullStderr = stderrChunks.join('');
                const crashStackTrace = extractCrashStackTrace(fullStderr);
                // If we haven't resolved the startup promise yet, reject it.
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    reject(new Error(`Language server exited unexpectedly (code=${code}, signal=${signal})`));
                }
                exitResolve({ code, signal, crashStackTrace });
            });
        });
    });
}
/** Sets whether the termination was intentional (suppresses crash reports). */
function setIntentionalTermination(value) {
    _intentionalTermination = value;
}
/**
 * Start the language server AND set up the restart monitoring loop.
 * Resolves with the handle on first successful startup.
 */
async function startAndMonitorLanguageServer(port, csrf, options = {}) {
    setIntentionalTermination(false); // Reset
    const handle = await startLanguageServer(port, csrf, options.headless);
    _lsPort = handle.port;
    if (options.onPortChanged) {
        options.onPortChanged(_lsPort);
    }
    monitorLsCrashInternal(handle, port, csrf, options);
    return handle;
}
function monitorLsCrashInternal(handle, port, csrf, options) {
    void handle.exitPromise.then(async (exitInfo) => {
        clearLsProcess();
        if (_intentionalTermination) {
            return;
        }
        const { code, signal, crashStackTrace } = exitInfo;
        const summary = signal
            ? `killed by signal ${signal}`
            : `exited with code ${code}`;
        console.error(`\nLanguage server crashed: ${summary}`);
        if (crashStackTrace) {
            console.error('--- Crash Stack Trace ---');
            console.error(crashStackTrace);
            console.error('--- End Crash Stack trace ---');
        }
        const now = Date.now();
        if (now - _lastRestartTime > RESTART_WINDOW_MS) {
            _restartCount = 0;
        }
        _lastRestartTime = now;
        if (_restartCount >= MAX_RESTARTS) {
            const msg = `Language server crashed ${MAX_RESTARTS} times in a row. Giving up.`;
            console.error(msg);
            return;
        }
        _restartCount++;
        console.log(`Attempting restart ${_restartCount}/${MAX_RESTARTS} in ${RESTART_COOLDOWN_MS / 1000}s...`);
        await sleep(RESTART_COOLDOWN_MS);
        if (_intentionalTermination) {
            return;
        }
        try {
            const newHandle = await startLanguageServer(port, csrf);
            _lsPort = newHandle.port;
            if (options.onPortChanged) {
                options.onPortChanged(_lsPort);
            }
            // Recurse
            monitorLsCrashInternal(newHandle, port, csrf, options);
        }
        catch (err) {
            console.error(`Failed to restart language server: ${err.message}`);
        }
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function killLanguageServer() {
    setIntentionalTermination(true);
    const proc = getLsProcess();
    if (proc) {
        const pid = proc.pid;
        console.log('Shutting down language server…');
        const exitPromise = new Promise((resolve) => {
            proc.once('exit', () => {
                resolve();
            });
        });
        proc.kill('SIGTERM');
        const result = await Promise.race([
            exitPromise.then(() => 'exited'),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
        ]);
        if (result === 'timeout' && pid !== undefined) {
            console.warn(`Language server (PID ${pid}) did not exit gracefully within 5s. Sending SIGKILL.`);
            try {
                process.kill(pid, 'SIGKILL');
            }
            catch {
                // Process already dead or exited
            }
        }
        clearLsProcess();
    }
}
/**
 * Sets up certificate verification in Electron to trust the local self-signed cert
 * used by the language server. It verifies that the certificate fingerprint matches
 * the hardcoded `LS_CERT_FINGERPRINT`.
 *
 * TODO: Generate the cert.pem file dynamically
 */
function setupLocalCertTrust() {
    electron_1.session.defaultSession.setCertificateVerifyProc((request, callback) => {
        if ((request.hostname === '127.0.0.1' || request.hostname === 'localhost') &&
            request.certificate.fingerprint === constants_1.LS_CERT_FINGERPRINT) {
            callback(0); // Accept
        }
        else {
            callback(-3); // Default validation
        }
    });
}
