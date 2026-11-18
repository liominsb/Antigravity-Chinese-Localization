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
exports.MENDEL_EMPTY_RETRY_DELAY_MS = exports.MENDEL_POLL_INTERVAL_MS = exports.MENDEL_POLL_TIMEOUT_MS = void 0;
exports.parseMendelBoolFlag = parseMendelBoolFlag;
exports.startMendelFlagSync = startMendelFlagSync;
const https = __importStar(require("node:https"));
const constants_1 = require("./constants");
/** Wall-clock deadline in milliseconds for a single GetMendelFlags loopback RPC. */
exports.MENDEL_POLL_TIMEOUT_MS = 15000;
/** Interval in milliseconds between background GetMendelFlags loopback polls. */
exports.MENDEL_POLL_INTERVAL_MS = 60000;
/**
 * Delay in milliseconds before one follow-up poll when an explicit `refresh()`
 * observes an empty snapshot. Set deliberately just above the Language
 * Server's on-demand Mendel retry cooldown (`onDemandRetryCooldown`, 3s, in
 * google3 `third_party/jetski/experiments/mendel_state_cache.go`); the two
 * values must change together.
 */
exports.MENDEL_EMPTY_RETRY_DELAY_MS = 3500;
const GET_MENDEL_FLAGS_PATH = '/exa.language_server_pb.LanguageServerService/GetMendelFlags';
const REQUEST_BODY = '{}';
const MAX_RESPONSE_BYTES = 1024 * 1024;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
/**
 * Evaluates `flagKey` against a decoded `GetMendelFlags` JSON response payload.
 * Returns `undefined` when `experimentConfig.experiments` is absent or empty so
 * callers preserve prior persisted state until a non-empty snapshot arrives.
 */
function parseMendelBoolFlag(body, flagKey) {
    const config = isRecord(body) ? body.experimentConfig : undefined;
    const experiments = isRecord(config) ? config.experiments : undefined;
    if (!Array.isArray(experiments) || experiments.length === 0) {
        return undefined;
    }
    return experiments.some((entry) => isRecord(entry) &&
        entry.keyString === flagKey &&
        (entry.disabled === undefined || entry.disabled === false));
}
function fetchMendelFlags(port, csrfToken, requestImpl, setAbort) {
    return new Promise((resolve) => {
        let settled = false;
        let hasResponse = false;
        let req;
        let activeRes;
        const destroyStreams = () => {
            for (const stream of [activeRes, req]) {
                try {
                    stream?.destroy();
                }
                catch {
                    // Ignore teardown errors on already-closed streams.
                }
            }
        };
        const timer = setTimeout(() => {
            settle(undefined);
            destroyStreams();
        }, exports.MENDEL_POLL_TIMEOUT_MS);
        timer.unref?.();
        function settle(value) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            setAbort(undefined);
            resolve(value);
        }
        setAbort(() => {
            settle(undefined);
            destroyStreams();
        });
        try {
            req = requestImpl({
                hostname: '127.0.0.1',
                port,
                path: GET_MENDEL_FLAGS_PATH,
                method: 'POST',
                // Mirrors setupLocalCertTrust (src/languageServer.ts) for 127.0.0.1:
                // the Language Server embeds its rotated self-signed certificate in
                // the Go binary rather than shipping a PEM file to Hub, and
                // authenticates loopback callers via x-codeium-csrf-token.
                rejectUnauthorized: false,
                // Disable global keep-alive pooling across LS restarts and quit.
                agent: false,
                headers: {
                    'content-type': 'application/json',
                    'connect-protocol-version': '1',
                    'x-codeium-csrf-token': csrfToken,
                    'content-length': '2',
                },
            }, (res) => {
                hasResponse = true;
                activeRes = res;
                res.on('error', () => settle(undefined));
                res.on('close', () => settle(undefined));
                if (res.statusCode !== 200) {
                    res.resume();
                    settle(undefined);
                    return;
                }
                const chunks = [];
                let totalBytes = 0;
                res.on('data', (chunk) => {
                    if (settled) {
                        return;
                    }
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    totalBytes += buf.length;
                    if (totalBytes > MAX_RESPONSE_BYTES) {
                        settle(undefined);
                        destroyStreams();
                        return;
                    }
                    chunks.push(buf);
                });
                res.on('end', () => {
                    if (settled || res.complete === false) {
                        settle(undefined);
                        return;
                    }
                    try {
                        const raw = Buffer.concat(chunks, totalBytes).toString('utf8');
                        settle(raw ? JSON.parse(raw) : undefined);
                    }
                    catch {
                        settle(undefined);
                    }
                });
            });
            req.on('error', () => settle(undefined));
            req.on('close', () => {
                if (!hasResponse) {
                    settle(undefined);
                }
            });
            if (settled) {
                destroyStreams();
                return;
            }
            req.end(REQUEST_BODY);
        }
        catch {
            settle(undefined);
            destroyStreams();
        }
    });
}
/**
 * Polls the local Language Server's `GetMendelFlags` endpoint on startup, port
 * transitions, explicit refreshes, and a background interval, persisting changes
 * to `WCV_THREE_LAYER_STACK_FLAG` in `storageManager`.
 */
function startMendelFlagSync(options) {
    const { csrfToken, storageManager, requestImpl = https.request } = options;
    let activePort = 0;
    let epoch = 0;
    let disposed = false;
    let intervalHandle;
    let retryTimer;
    let inFlight;
    let trailingInFlight;
    let abortInFlight;
    function clearRetryTimer() {
        clearTimeout(retryTimer);
        retryTimer = undefined;
    }
    function resetCycle(nextPort) {
        epoch += 1;
        activePort = nextPort;
        clearInterval(intervalHandle);
        intervalHandle = undefined;
        clearRetryTimer();
        trailingInFlight = undefined;
        const abort = abortInFlight;
        abortInFlight = undefined;
        inFlight = undefined;
        abort?.();
    }
    async function runPoll(port, runEpoch, retryOnEmpty) {
        const body = await fetchMendelFlags(port, csrfToken, requestImpl, (abort) => {
            if (!disposed && runEpoch === epoch) {
                abortInFlight = abort;
            }
        });
        if (disposed || runEpoch !== epoch) {
            return;
        }
        const enabled = parseMendelBoolFlag(body, constants_1.WCV_THREE_LAYER_STACK_FLAG);
        if (enabled === undefined) {
            if (retryOnEmpty && retryTimer === undefined && activePort > 0) {
                retryTimer = setTimeout(() => {
                    retryTimer = undefined;
                    void launchPoll(false);
                }, exports.MENDEL_EMPTY_RETRY_DELAY_MS);
                retryTimer.unref?.();
            }
            return;
        }
        clearRetryTimer();
        const nextVal = enabled ? 'true' : 'false';
        try {
            const currentItems = await storageManager.getItems();
            if (disposed ||
                runEpoch !== epoch ||
                currentItems[constants_1.WCV_THREE_LAYER_STACK_FLAG] === nextVal) {
                return;
            }
            await storageManager.updateItems({
                [constants_1.WCV_THREE_LAYER_STACK_FLAG]: nextVal,
            });
        }
        catch {
            // Contain StorageFullError and transient disk errors so background polls
            // never emit unhandled rejections or wedge inFlight.
        }
    }
    function launchPoll(retryOnEmpty) {
        if (disposed || activePort <= 0) {
            return Promise.resolve();
        }
        if (inFlight) {
            return inFlight;
        }
        if (retryOnEmpty) {
            clearRetryTimer();
        }
        const runEpoch = epoch;
        const port = activePort;
        const runPromise = runPoll(port, runEpoch, retryOnEmpty).finally(() => {
            if (inFlight === runPromise) {
                inFlight = undefined;
            }
        });
        inFlight = runPromise;
        return runPromise;
    }
    function refresh() {
        if (disposed || activePort <= 0) {
            return Promise.resolve();
        }
        if (!inFlight) {
            return launchPoll(true);
        }
        if (!trailingInFlight) {
            const queuedEpoch = epoch;
            const trailing = inFlight.then(() => {
                if (trailingInFlight === trailing) {
                    trailingInFlight = undefined;
                }
                if (!disposed && queuedEpoch === epoch && activePort > 0) {
                    return launchPoll(true);
                }
            });
            trailingInFlight = trailing;
        }
        return trailingInFlight;
    }
    function onPortChanged(newPort) {
        if (disposed) {
            return;
        }
        resetCycle(newPort);
        if (newPort <= 0) {
            return;
        }
        void launchPoll(false);
        intervalHandle = setInterval(() => {
            void launchPoll(false);
        }, exports.MENDEL_POLL_INTERVAL_MS);
        intervalHandle.unref?.();
    }
    function dispose() {
        if (disposed) {
            return;
        }
        disposed = true;
        resetCycle(0);
    }
    onPortChanged(options.port);
    return { refresh, onPortChanged, dispose };
}
