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
exports.SCRIPT_JAIL_PRELOAD_PATH = exports.MAX_SCRIPT_JAIL_ERROR_MESSAGE_LENGTH = exports.MAX_SCRIPT_JAIL_RESULT_BYTES = exports.SCRIPT_JAIL_RSS_POLL_INTERVAL_MS = exports.MAX_SCRIPT_JAIL_RSS_KB = exports.MAX_CONSECUTIVE_IDLE_DEATHS = exports.SCRIPT_JAIL_POOL_TARGET_IDLE = exports.MAX_QUEUED_JAILS_GLOBAL = exports.MAX_QUEUED_JAILS_PER_SENDER = exports.MAX_CONCURRENT_JAILS_GLOBAL = exports.MAX_CONCURRENT_JAILS_PER_SENDER = exports.SCRIPT_JAIL_ACQUIRE_TIMEOUT_MS = exports.MIN_SCRIPT_JAIL_TIMEOUT_MS = exports.MAX_SCRIPT_JAIL_TIMEOUT_MS = exports.DEFAULT_SCRIPT_JAIL_TIMEOUT_MS = exports.SCRIPT_JAIL_BLACKHOLE_PROXY_BYPASS_RULES = exports.SCRIPT_JAIL_BLACKHOLE_PROXY_RULES = exports.SCRIPT_JAIL_PARTITION = exports.SCRIPT_JAIL_PORT_MESSAGE_TYPE = exports.SCRIPT_JAIL_PORT_CHANNEL = exports.SCRIPT_JAIL_PROTOCOL_VERSION = void 0;
exports.isScriptJailSession = isScriptJailSession;
exports.getScriptJailPoolSnapshot = getScriptJailPoolSnapshot;
exports.waitForScriptJailPoolIdle = waitForScriptJailPoolIdle;
exports.resetScriptJailStateForTests = resetScriptJailStateForTests;
exports.resolveScriptJailTimeoutMs = resolveScriptJailTimeoutMs;
exports.assertAuthorizedJailSender = assertAuthorizedJailSender;
exports.hardenScriptJailSession = hardenScriptJailSession;
exports.hardenScriptJailWebContents = hardenScriptJailWebContents;
exports.buildScriptJailWorkerCode = buildScriptJailWorkerCode;
exports.buildScriptJailBootstrapCode = buildScriptJailBootstrapCode;
exports.warmScriptJail = warmScriptJail;
exports.abortScriptInJail = abortScriptInJail;
exports.runScriptInJail = runScriptInJail;
/**
 * Ephemeral, zero-egress Electron Script Jail (`runScriptInJail` / `abortScriptInJail` / `warmScriptJail`).
 *
 * Security & Consumer Contract (for AUIT `CL_0` callers, `scriptJailProtocol === 2`):
 * 1. **Hub-side global FIFO admission & Port-as-admission (`window.addEventListener('message', onPort)`)**:
 *    - Register the `message` listener BEFORE calling `electronNative.runScriptInJail(...)`.
 *    - `runScriptInJail` accepts requests into a main-process global FIFO queue (`QUEUED` state,
 *      bounded at `MAX_QUEUED_JAILS_PER_SENDER = 8` / `MAX_QUEUED_JAILS_GLOBAL = 32`) when the
 *      running caps (`MAX_CONCURRENT_JAILS_PER_SENDER = 4` / `MAX_CONCURRENT_JAILS_GLOBAL = 8`)
 *      are full, and only delivers the `MessagePort` on `agy-script-jail:port` once a jail is
 *      actually assigned (`RUNNING` state).
 *    - The per-script `timeoutMs` clock and `512 MB` RSS watchdog start at jail assignment,
 *      not while waiting in the queue. Callers should start their execution budget, capture
 *      page baselines, and mark active actuation upon receiving the `agy-script-jail-port` event.
 *    - Always verify `event.source === window`, `event.data?.type === 'agy-script-jail-port'`,
 *      `event.data?.jailId === jailId`, and `event.ports[0]` so embedded subframes cannot
 *      spoof the port handoff.
 *    - Generate a fresh random `jailId` (e.g. `crypto.randomUUID()`) per invocation.
 * 2. **Host-side RPC validation (`port.onmessage`)**:
 *    - Stage 1 (`pageFacadeBundle`) executes in the same untrusted Worker realm as Stage 2
 *      (`modelScript`) and is NOT a security boundary (Stage 2 can intercept
 *      `MessagePort.prototype.postMessage` and send arbitrary RPC messages).
 *    - The host handler MUST enforce an explicit per-method allowlist with param schemas
 *      (defined AUIT-side), enforce a per-script operation budget (`maxOps`),
 *      call `electronNative.abortScriptJail(jailId)` on the first fatal/schema/budget error,
 *      and call `port.close()` when the run finishes.
 *    - Host-side first failure wins: classify navigation, domain-gate, and takeover errors
 *      from host-side state rather than trusting `result.errorCode` from the jail.
 */
const electron_1 = require("electron");
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
const isolatedWorldExec_1 = require("./isolatedWorldExec");
exports.SCRIPT_JAIL_PROTOCOL_VERSION = 2;
exports.SCRIPT_JAIL_PORT_CHANNEL = 'agy-script-jail:port';
exports.SCRIPT_JAIL_PORT_MESSAGE_TYPE = 'agy-script-jail-port';
/** Random per-process non-persistent partition so no `<webview partition="...">` can guess it. */
exports.SCRIPT_JAIL_PARTITION = `agy-script-jail-${crypto.randomUUID()}`;
/** Blackhole proxy routing all proxyable traffic to dead loopback port 9 without localhost bypass. */
exports.SCRIPT_JAIL_BLACKHOLE_PROXY_RULES = 'http://127.0.0.1:9';
exports.SCRIPT_JAIL_BLACKHOLE_PROXY_BYPASS_RULES = '<-loopback>';
// Matches the agent browser's 30 s per-script budget.
exports.DEFAULT_SCRIPT_JAIL_TIMEOUT_MS = 30000;
exports.MAX_SCRIPT_JAIL_TIMEOUT_MS = 30000;
exports.MIN_SCRIPT_JAIL_TIMEOUT_MS = 50;
exports.SCRIPT_JAIL_ACQUIRE_TIMEOUT_MS = 10000;
exports.MAX_CONCURRENT_JAILS_PER_SENDER = 4;
exports.MAX_CONCURRENT_JAILS_GLOBAL = 8;
exports.MAX_QUEUED_JAILS_PER_SENDER = 8;
exports.MAX_QUEUED_JAILS_GLOBAL = 32;
exports.SCRIPT_JAIL_POOL_TARGET_IDLE = 2;
exports.MAX_CONSECUTIVE_IDLE_DEATHS = 3;
exports.MAX_SCRIPT_JAIL_RSS_KB = 512 * 1024;
exports.SCRIPT_JAIL_RSS_POLL_INTERVAL_MS = 200;
exports.MAX_SCRIPT_JAIL_RESULT_BYTES = 1024 * 1024;
exports.MAX_SCRIPT_JAIL_ERROR_MESSAGE_LENGTH = 4096;
exports.SCRIPT_JAIL_PRELOAD_PATH = path.join(__dirname, 'scriptJailPreload.js');
const WORKER_ERROR_CODES = new Set([
    'FACADE_ERROR',
    'SYNTAX_ERROR',
    'RUNTIME_ERROR',
    'SERIALIZATION_ERROR',
]);
class JailSpawnError extends Error {
}
const queuedJails = new Map();
const activeJails = new Map();
const senderWatchers = new Map();
const idleWarmJails = [];
const inFlightWarmups = new Set();
/**
 * Strong reference anchor for every live detached `WebContentsView` (warming, idle,
 * running, or orphaned acquire). Because jail views are never attached to a window,
 * dropping the JS `WebContentsView` reference while `webContents` is in use allows V8
 * GC to finalize the C++ view and destroy its `webContents` mid-run.
 */
const liveJailViews = new Set();
let poolActivated = false;
let consecutiveIdleDeaths = 0;
let preloadEpoch = 0;
let jailSessionInstance = null;
/** Returns `true` if `targetSession` is the dedicated script-jail session. */
function isScriptJailSession(targetSession) {
    return Boolean(targetSession && targetSession === jailSessionInstance);
}
/** Returns a read-only snapshot of the script-jail pool and admission queue. */
function getScriptJailPoolSnapshot() {
    const liveWarmIds = [];
    for (const entry of idleWarmJails) {
        if (!entry.jailContents.isDestroyed()) {
            liveWarmIds.push(entry.jailContents.id);
        }
    }
    return {
        poolActivated,
        idleWarmJails: liveWarmIds.length,
        idleWarmWebContentsIds: liveWarmIds,
        warmingJails: inFlightWarmups.size,
        runningJails: activeJails.size,
        runningIds: [...activeJails.keys()],
        queuedJails: queuedJails.size,
        queuedIds: [...queuedJails.keys()],
    };
}
/** Waits for all in-flight background pool warmup tasks to settle. */
async function waitForScriptJailPoolIdle() {
    while (inFlightWarmups.size > 0) {
        await Promise.allSettled([...inFlightWarmups]);
    }
    return getScriptJailPoolSnapshot();
}
function closeJailView(jailView, jailContents) {
    if (jailView) {
        liveJailViews.delete(jailView);
    }
    if (jailContents && !jailContents.isDestroyed()) {
        jailContents.close();
    }
}
function closeAllIdleWarmJails() {
    while (idleWarmJails.length > 0) {
        const entry = idleWarmJails.shift();
        entry.detachIdleListeners();
        closeJailView(entry.jailView, entry.jailContents);
    }
}
/** Resets pool and queue state (closing any idle warm jails). Intended for shutdown and unit tests. */
function resetScriptJailStateForTests() {
    poolActivated = false;
    consecutiveIdleDeaths = 0;
    preloadEpoch = 0;
    closeAllIdleWarmJails();
    liveJailViews.clear();
    for (const entry of [...queuedJails.values()]) {
        entry.settleQueued(failResult('SCRIPT_ABORTED', 'Script jail state reset'));
    }
    queuedJails.clear();
}
function failResult(errorCode, errorMessage) {
    return {
        ok: false,
        errorCode,
        errorMessage: errorMessage.slice(0, exports.MAX_SCRIPT_JAIL_ERROR_MESSAGE_LENGTH),
    };
}
function resolveScriptJailTimeoutMs(req) {
    const candidate = req?.timeoutMs;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        return exports.DEFAULT_SCRIPT_JAIL_TIMEOUT_MS;
    }
    return Math.min(exports.MAX_SCRIPT_JAIL_TIMEOUT_MS, Math.max(exports.MIN_SCRIPT_JAIL_TIMEOUT_MS, Math.floor(candidate)));
}
function isValidJailId(rawJailId) {
    return (typeof rawJailId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(rawJailId));
}
function getRunningCountForSender(senderId) {
    let count = 0;
    for (const entry of activeJails.values()) {
        if (entry.senderId === senderId) {
            count++;
        }
    }
    return count;
}
function getQueuedCountForSender(senderId) {
    let count = 0;
    for (const entry of queuedJails.values()) {
        if (entry.senderId === senderId) {
            count++;
        }
    }
    return count;
}
function registerSenderAbortCallback(sender, cb) {
    let watcher = senderWatchers.get(sender);
    if (!watcher) {
        const callbacks = new Set();
        const fireAll = (res) => {
            for (const fn of [...callbacks]) {
                fn(res);
            }
        };
        const onDestroyed = () => fireAll(failResult('SCRIPT_ABORTED', 'Requesting sender WebContents was destroyed'));
        const onGone = () => fireAll(failResult('SCRIPT_ABORTED', 'Requesting sender renderer process exited'));
        const onNavigate = (details) => {
            if (details?.isMainFrame && !details.isSameDocument) {
                fireAll(failResult('SCRIPT_ABORTED', 'Requesting sender WebContents navigated'));
            }
        };
        sender.on('destroyed', onDestroyed);
        sender.on('render-process-gone', onGone);
        sender.on('did-start-navigation', onNavigate);
        watcher = { sender, callbacks, onDestroyed, onGone, onNavigate };
        senderWatchers.set(sender, watcher);
    }
    watcher.callbacks.add(cb);
    let removed = false;
    return () => {
        if (removed) {
            return;
        }
        removed = true;
        const current = senderWatchers.get(sender);
        if (!current) {
            return;
        }
        current.callbacks.delete(cb);
        if (current.callbacks.size === 0) {
            senderWatchers.delete(sender);
            sender.removeListener('destroyed', current.onDestroyed);
            sender.removeListener('render-process-gone', current.onGone);
            sender.removeListener('did-start-navigation', current.onNavigate);
        }
    };
}
/** Verifies `sender` belongs to the main frame of an active Hub `BrowserWindow`. */
function assertAuthorizedJailSender(sender, senderFrame) {
    if (!sender || sender.isDestroyed()) {
        throw new Error('Unauthorized script-jail sender: WebContents is missing or destroyed');
    }
    if (sender.getType() !== 'window') {
        throw new Error(`Unauthorized script-jail sender: expected type "window", got "${sender.getType()}"`);
    }
    if (senderFrame?.parent) {
        throw new Error('Unauthorized script-jail sender: subframe cannot invoke script jail');
    }
    const matchingHubWindow = (0, utils_1.getHubWindows)().find((win) => {
        if (!win || win.isDestroyed()) {
            return false;
        }
        const hubContents = (0, utils_1.getHubWebContents)(win);
        return (hubContents === sender ||
            (typeof sender.id === 'number' && hubContents?.id === sender.id));
    });
    if (!matchingHubWindow) {
        throw new Error('Unauthorized script-jail sender: WebContents is not an active Hub BrowserWindow');
    }
}
function scrubAndAssertZeroSessionPreloads(jailSession) {
    const modernPreloads = jailSession.getPreloadScripts();
    for (const script of modernPreloads) {
        jailSession.unregisterPreloadScript(script.id);
    }
    const legacySession = jailSession;
    const legacyPreloadCount = typeof legacySession.getPreloads === 'function'
        ? legacySession.getPreloads().length
        : 0;
    if (legacyPreloadCount > 0 &&
        typeof legacySession.setPreloads === 'function') {
        legacySession.setPreloads([]);
    }
    const remainingModern = jailSession.getPreloadScripts().length;
    const remainingLegacy = typeof legacySession.getPreloads === 'function'
        ? legacySession.getPreloads().length
        : 0;
    if (remainingModern !== 0 || remainingLegacy !== 0) {
        throw new Error('Script jail session has unexpected preload scripts registered');
    }
    const removedCount = modernPreloads.length + legacyPreloadCount;
    if (removedCount > 0) {
        preloadEpoch++;
        closeAllIdleWarmJails();
    }
    return removedCount;
}
/**
 * Re-asserts full fail-closed hardening on the script-jail `Session` before each run.
 *
 * Actively strips any session-level preload scripts (such as `electron-log-preload`
 * injected by `electron-log`'s `app.on('session-created')` listener via
 * `registerPreloadScript`, or legacy `setPreloads` entries) so only
 * `SCRIPT_JAIL_PRELOAD_PATH` runs in the jail, then asserts zero session preloads
 * remain (failing closed if removal did not stick). Returns the number of preloads removed.
 */
async function hardenScriptJailSession(jailSession) {
    const removedCount = scrubAndAssertZeroSessionPreloads(jailSession);
    jailSession.webRequest.onBeforeRequest((_details, callback) => {
        callback({ cancel: true });
    });
    jailSession.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(false);
    });
    jailSession.setPermissionCheckHandler(() => false);
    await jailSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: exports.SCRIPT_JAIL_BLACKHOLE_PROXY_RULES,
        proxyBypassRules: exports.SCRIPT_JAIL_BLACKHOLE_PROXY_BYPASS_RULES,
    });
    if (removedCount > 0 && poolActivated) {
        schedulePoolRefill();
    }
    return removedCount;
}
function hardenScriptJailWebContents(jailContents) {
    jailContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    jailContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    jailContents.on('will-navigate', (event) => event.preventDefault());
    jailContents.on('will-frame-navigate', (event) => event.preventDefault());
}
/** Builds the dedicated Worker script that executes Stage 1 and Stage 2 in `DedicatedWorkerGlobalScope`. */
function buildScriptJailWorkerCode() {
    return `(() => {
  'use strict';
  const formatErr = (err, fallback) =>
    err && typeof err === 'object' && typeof err.message === 'string' && err.message
      ? err.message
      : typeof err === 'string' && err
        ? err
        : fallback;

  let initialized = false;
  self.onmessage = (initEvent) => {
    const data = initEvent && initEvent.data;
    const port = initEvent && initEvent.ports && initEvent.ports[0];
    if (!data || data.type !== 'init' || initialized || !port) return;
    initialized = true;

    let nextRpcId = 1;
    let finished = false;
    const pendingRpcs = new Map();

    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      pendingRpcs.clear();
      self.postMessage(outcome);
    };

    port.addEventListener('message', (pEvent) => {
      const msg = pEvent && pEvent.data;
      if (!msg || msg.type !== 'rpc-result' || typeof msg.id !== 'number') return;
      const entry = pendingRpcs.get(msg.id);
      if (!entry) return;
      pendingRpcs.delete(msg.id);
      if (msg.ok) {
        entry.resolve(msg.value);
      } else {
        const errObj = msg.error && typeof msg.error === 'object' ? msg.error : {};
        const errMsg = typeof errObj.message === 'string' && errObj.message ? errObj.message : 'RPC call failed';
        entry.reject(new Error(errMsg));
      }
    });
    port.start();

    const callRpc = (method, params) => {
      if (finished) return Promise.reject(new Error('Script execution has already finished'));
      if (typeof method !== 'string' || !method) {
        return Promise.reject(new TypeError('callRpc: method must be a non-empty string'));
      }
      const id = nextRpcId++;
      const promise = new Promise((resolve, reject) => {
        pendingRpcs.set(id, {resolve, reject});
        port.postMessage({type: 'rpc', id, method, params});
      });
      promise.catch(() => {});
      return promise;
    };

    (async () => {
      let pageFacade;
      try {
        const createPageFacade = (0, eval)(data.pageFacadeBundle);
        if (typeof createPageFacade !== 'function') {
          throw new Error('pageFacadeBundle must evaluate to a createPageFacade function');
        }
        pageFacade = await createPageFacade({callRpc});
        if (!pageFacade || (typeof pageFacade !== 'object' && typeof pageFacade !== 'function')) {
          throw new Error('createPageFacade({callRpc}) must return a valid page facade');
        }
      } catch (facadeErr) {
        finish({ok: false, errorCode: 'FACADE_ERROR', errorMessage: formatErr(facadeErr, 'Failed to initialize pageFacadeBundle')});
        return;
      }

      let modelFn;
      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        modelFn = new AsyncFunction('page', 'console', "'use strict';\\n" + String(data.modelScript || '') + '\\n');
      } catch (syntaxErr) {
        finish({ok: false, errorCode: 'SYNTAX_ERROR', errorMessage: formatErr(syntaxErr, 'Failed to compile modelScript')});
        return;
      }

      try {
        const rawValue = await modelFn(pageFacade, console);
        if (rawValue === undefined) {
          finish({ok: true});
          return;
        }
        let serializedValue;
        try {
          const encoded = JSON.stringify(rawValue);
          if (encoded === undefined) throw new TypeError('script return value is not JSON-serializable');
          serializedValue = JSON.parse(encoded);
        } catch (serErr) {
          finish({
            ok: false,
            errorCode: 'SERIALIZATION_ERROR',
            errorMessage: 'script return value is not JSON-serializable: ' + formatErr(serErr, String(serErr)),
          });
          return;
        }
        finish({ok: true, value: serializedValue});
      } catch (runErr) {
        finish({ok: false, errorCode: 'RUNTIME_ERROR', errorMessage: formatErr(runErr, 'Script execution failed')});
      }
    })();
  };
})()`;
}
/** Builds the main-world bootstrap that spawns the dedicated Worker and enforces result/error size caps. */
function buildScriptJailBootstrapCode(params) {
    const serializedParams = JSON.stringify({
        pageFacadeBundle: params.pageFacadeBundle,
        modelScript: params.modelScript,
        portMessageType: exports.SCRIPT_JAIL_PORT_MESSAGE_TYPE,
        maxResultBytes: exports.MAX_SCRIPT_JAIL_RESULT_BYTES,
        maxErrorLength: exports.MAX_SCRIPT_JAIL_ERROR_MESSAGE_LENGTH,
        workerCode: buildScriptJailWorkerCode(),
    });
    return `(() => {
  'use strict';
  const __cfg = ${serializedParams};
  return new Promise((resolveBootstrap) => {
    const blobUrl = URL.createObjectURL(new Blob([__cfg.workerCode], {type: 'text/javascript'}));
    const worker = new Worker(blobUrl);
    let portTransferred = false;

    const cleanup = () => {
      window.removeEventListener('message', onWindowMessage);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };

    worker.onmessage = (event) => {
      cleanup();
      const data = event && event.data;
      if (!data || typeof data !== 'object') {
        resolveBootstrap({ok: false, errorCode: 'RUNTIME_ERROR', errorMessage: 'Invalid Worker outcome'});
        return;
      }
      if (data.ok === true) {
        if (data.value === undefined) {
          resolveBootstrap({ok: true});
          return;
        }
        let encoded;
        try {
          encoded = JSON.stringify(data.value);
        } catch (_err) {
          resolveBootstrap({ok: false, errorCode: 'SERIALIZATION_ERROR', errorMessage: 'Script return value is not JSON-serializable'});
          return;
        }
        if (typeof encoded === 'string' && encoded.length > __cfg.maxResultBytes) {
          resolveBootstrap({
            ok: false,
            errorCode: 'SERIALIZATION_ERROR',
            errorMessage: 'Script return value exceeded maximum size (' + __cfg.maxResultBytes + ' bytes)',
          });
          return;
        }
        resolveBootstrap({ok: true, value: JSON.parse(encoded)});
        return;
      }
      resolveBootstrap({
        ok: false,
        errorCode: typeof data.errorCode === 'string' ? data.errorCode : 'RUNTIME_ERROR',
        errorMessage: String(data.errorMessage || 'Script execution failed').slice(0, __cfg.maxErrorLength),
      });
    };

    worker.onerror = (err) => {
      if (err && typeof err.preventDefault === 'function') err.preventDefault();
      cleanup();
      resolveBootstrap({
        ok: false,
        errorCode: 'RUNTIME_ERROR',
        errorMessage: String((err && err.message) || 'Worker execution failed').slice(0, __cfg.maxErrorLength),
      });
    };

    const onWindowMessage = (event) => {
      const data = event && event.data;
      if (!data || data.type !== __cfg.portMessageType) return;
      const port = event.ports && event.ports[0];
      if (!port || portTransferred) return;
      portTransferred = true;
      window.removeEventListener('message', onWindowMessage);
      worker.postMessage(
        {type: 'init', pageFacadeBundle: __cfg.pageFacadeBundle, modelScript: __cfg.modelScript},
        [port]
      );
    };

    window.addEventListener('message', onWindowMessage);
    window.postMessage({type: 'agy-script-jail-ready'}, '*');
  });
})()`;
}
/**
 * Spawns and initializes a single hardened `WebContentsView` (`about:blank`) for either the
 * warm pool or an on-demand cold start. Closes the view on any initialization failure or timeout.
 */
async function spawnJail() {
    jailSessionInstance ?? (jailSessionInstance = electron_1.session.fromPartition(exports.SCRIPT_JAIL_PARTITION, {
        cache: false,
    }));
    scrubAndAssertZeroSessionPreloads(jailSessionInstance);
    const spawnEpoch = preloadEpoch;
    const jailView = new electron_1.WebContentsView({
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            navigateOnDragDrop: false,
            partition: exports.SCRIPT_JAIL_PARTITION,
            preload: exports.SCRIPT_JAIL_PRELOAD_PATH,
        },
    });
    liveJailViews.add(jailView);
    const jailContents = jailView.webContents;
    jailContents.once('destroyed', () => {
        liveJailViews.delete(jailView);
    });
    hardenScriptJailWebContents(jailContents);
    let timer;
    let onDead;
    try {
        await Promise.race([
            jailContents.loadURL('about:blank'),
            new Promise((_, reject) => {
                onDead = () => reject(new JailSpawnError('Script jail renderer exited during initialization'));
                jailContents.once('render-process-gone', onDead);
                jailContents.once('destroyed', onDead);
                timer = setTimeout(() => reject(new JailSpawnError(`Script jail initialization timed out after ${exports.SCRIPT_JAIL_ACQUIRE_TIMEOUT_MS}ms`)), exports.SCRIPT_JAIL_ACQUIRE_TIMEOUT_MS);
            }),
        ]);
        if (jailContents.isDestroyed()) {
            throw new JailSpawnError('Script jail WebContents was destroyed during initialization');
        }
        return { jailView, jailContents, spawnEpoch };
    }
    catch (err) {
        closeJailView(jailView, jailContents);
        throw err instanceof JailSpawnError
            ? err
            : new JailSpawnError(err instanceof Error ? err.message : String(err));
    }
    finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
        if (onDead) {
            jailContents.removeListener('render-process-gone', onDead);
            jailContents.removeListener('destroyed', onDead);
        }
    }
}
async function createWarmJailEntry(attempt = 0) {
    try {
        const { jailView, jailContents, spawnEpoch } = await spawnJail();
        if (!poolActivated ||
            preloadEpoch !== spawnEpoch ||
            jailContents.isDestroyed()) {
            closeJailView(jailView, jailContents);
            return poolActivated && preloadEpoch !== spawnEpoch && attempt < 2
                ? createWarmJailEntry(attempt + 1)
                : null;
        }
        const onIdleDead = () => {
            const idx = idleWarmJails.indexOf(entryRef);
            if (idx !== -1) {
                idleWarmJails.splice(idx, 1);
            }
            entryRef.detachIdleListeners();
            closeJailView(jailView, jailContents);
            consecutiveIdleDeaths++;
            schedulePoolRefill();
        };
        const detachIdleListeners = () => {
            jailContents.removeListener('render-process-gone', onIdleDead);
            jailContents.removeListener('destroyed', onIdleDead);
        };
        const entryRef = {
            jailView,
            jailContents,
            detachIdleListeners,
        };
        jailContents.once('render-process-gone', onIdleDead);
        jailContents.once('destroyed', onIdleDead);
        return entryRef;
    }
    catch {
        return null;
    }
}
function schedulePoolRefill() {
    if (!poolActivated || consecutiveIdleDeaths > exports.MAX_CONSECUTIVE_IDLE_DEATHS) {
        return;
    }
    while (idleWarmJails.length + inFlightWarmups.size <
        exports.SCRIPT_JAIL_POOL_TARGET_IDLE) {
        const taskPromise = createWarmJailEntry()
            .then((entry) => {
            if (!entry) {
                return;
            }
            if (poolActivated &&
                idleWarmJails.length < exports.SCRIPT_JAIL_POOL_TARGET_IDLE &&
                !entry.jailContents.isDestroyed()) {
                idleWarmJails.push(entry);
            }
            else {
                entry.detachIdleListeners();
                closeJailView(entry.jailView, entry.jailContents);
            }
        })
            .finally(() => {
            inFlightWarmups.delete(taskPromise);
        });
        inFlightWarmups.add(taskPromise);
    }
}
async function ensurePoolReady() {
    jailSessionInstance ?? (jailSessionInstance = electron_1.session.fromPartition(exports.SCRIPT_JAIL_PARTITION, {
        cache: false,
    }));
    await hardenScriptJailSession(jailSessionInstance);
    poolActivated = true;
    consecutiveIdleDeaths = 0;
}
async function acquireJailForRun() {
    await ensurePoolReady();
    while (idleWarmJails.length > 0) {
        const warm = idleWarmJails.shift();
        warm.detachIdleListeners();
        if (!warm.jailContents.isDestroyed()) {
            schedulePoolRefill();
            return { jailView: warm.jailView, jailContents: warm.jailContents };
        }
        liveJailViews.delete(warm.jailView);
    }
    try {
        const { jailView, jailContents } = await spawnJail();
        return { jailView, jailContents };
    }
    finally {
        schedulePoolRefill();
    }
}
/**
 * Activates and pre-warms the disposable script-jail pool (`SCRIPT_JAIL_POOL_TARGET_IDLE = 2`).
 *
 * The pool is NOT warmed at Hub startup so flag-off users pay zero memory or process cost.
 * Once activated via `warmScriptJail` or the first `runScriptInJail` call, the pool maintains
 * 2 idle pre-warmed jails (with `about:blank` loaded) and refills asynchronously as jails are consumed.
 */
async function warmScriptJail(sender, senderFrame) {
    assertAuthorizedJailSender(sender, senderFrame);
    if (electron_1.app.commandLine.hasSwitch('no-sandbox')) {
        return false;
    }
    try {
        await ensurePoolReady();
        schedulePoolRefill();
        await waitForScriptJailPoolIdle();
        return idleWarmJails.length > 0;
    }
    catch {
        return false;
    }
}
/** Aborts a queued or running script-jail execution owned by `sender`. */
function abortScriptInJail(sender, jailId, senderFrame) {
    assertAuthorizedJailSender(sender, senderFrame);
    if (!isValidJailId(jailId)) {
        return false;
    }
    const queued = queuedJails.get(jailId);
    if (queued) {
        if (queued.senderId !== sender.id) {
            return false;
        }
        queued.settleQueued(failResult('SCRIPT_ABORTED', 'Script aborted by host'));
        return true;
    }
    const active = activeJails.get(jailId);
    if (!active || active.senderId !== sender.id) {
        return false;
    }
    active.abort(failResult('SCRIPT_ABORTED', 'Script aborted by host'));
    return true;
}
function pumpJailQueue() {
    while (activeJails.size < exports.MAX_CONCURRENT_JAILS_GLOBAL) {
        let nextEntry;
        for (const entry of queuedJails.values()) {
            if (getRunningCountForSender(entry.senderId) <
                exports.MAX_CONCURRENT_JAILS_PER_SENDER) {
                nextEntry = entry;
                break;
            }
        }
        if (!nextEntry) {
            break;
        }
        queuedJails.delete(nextEntry.jailId);
        admitAndRunJailEntry(nextEntry);
    }
}
function admitAndRunJailEntry(entry) {
    const { jailId, sender: authorizedSender, req, timeoutMs, resolveRun } = entry;
    let earlyResult;
    let resolveEarlyResult;
    const earlyExitPromise = new Promise((resolve) => {
        resolveEarlyResult = (res) => {
            earlyResult ?? (earlyResult = res);
            resolve(earlyResult);
        };
    });
    entry.detachQueuedWatcher();
    const unregisterRunningSenderAbort = registerSenderAbortCallback(authorizedSender, (res) => resolveEarlyResult(res));
    activeJails.set(jailId, {
        senderId: authorizedSender.id,
        abort: (res) => resolveEarlyResult(res ?? failResult('SCRIPT_ABORTED', 'Script aborted by host')),
    });
    void (async () => {
        // Keep jailView anchored in the run closure (in addition to liveJailViews)
        // so V8 GC cannot finalize the detached WebContentsView while webContents is executing.
        let jailView;
        let jailContents;
        let port1;
        let port2;
        let timeoutHandle;
        let rssWatchdogHandle;
        try {
            let acquireTimeoutHandle;
            const acquirePromise = acquireJailForRun();
            const closeOrphanAcquire = () => {
                void acquirePromise.then((j) => {
                    closeJailView(j.jailView, j.jailContents);
                }, () => { });
            };
            try {
                const acquiredOrEarly = await Promise.race([
                    acquirePromise.then((jail) => ({ kind: 'acquired', jail })),
                    earlyExitPromise.then((res) => ({ kind: 'early', res })),
                    new Promise((_, reject) => {
                        acquireTimeoutHandle = setTimeout(() => reject(new JailSpawnError(`Script jail acquisition timed out after ${exports.SCRIPT_JAIL_ACQUIRE_TIMEOUT_MS}ms`)), exports.SCRIPT_JAIL_ACQUIRE_TIMEOUT_MS);
                    }),
                ]);
                if (acquiredOrEarly.kind === 'early') {
                    closeOrphanAcquire();
                    return acquiredOrEarly.res;
                }
                ({ jailView, jailContents } = acquiredOrEarly.jail);
            }
            catch (acquireErr) {
                closeOrphanAcquire();
                throw acquireErr;
            }
            finally {
                if (acquireTimeoutHandle !== undefined) {
                    clearTimeout(acquireTimeoutHandle);
                }
            }
            if (earlyResult) {
                return earlyResult;
            }
            // Start execution timeout at jail assignment (not while queued or acquiring a jail).
            timeoutHandle = setTimeout(() => {
                resolveEarlyResult(failResult('TIMEOUT', `Script execution timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            ({ port1, port2 } = new electron_1.MessageChannelMain());
            const bootstrapCode = buildScriptJailBootstrapCode({
                pageFacadeBundle: req.pageFacadeBundle,
                modelScript: req.modelScript,
            });
            jailContents.once('render-process-gone', (_event, details) => {
                resolveEarlyResult(failResult('JAIL_CRASHED', `Script jail renderer process exited (${details?.reason ?? 'unknown'})`));
            });
            jailContents.once('destroyed', () => {
                resolveEarlyResult(failResult('JAIL_CRASHED', 'Script jail WebContents was destroyed'));
            });
            rssWatchdogHandle = setInterval(() => {
                if (!jailContents || jailContents.isDestroyed()) {
                    return;
                }
                const pid = jailContents.getOSProcessId();
                if (typeof pid !== 'number' || pid <= 0) {
                    return;
                }
                const rssKB = electron_1.app.getAppMetrics().find((m) => m.pid === pid)?.memory
                    ?.workingSetSize ?? 0;
                if (rssKB > exports.MAX_SCRIPT_JAIL_RSS_KB) {
                    resolveEarlyResult(failResult('RESOURCE_LIMIT', `Script jail exceeded memory limit (${exports.MAX_SCRIPT_JAIL_RSS_KB / 1024} MB)`));
                    try {
                        process.kill(pid, 'SIGKILL');
                    }
                    catch {
                        // Ignore if process already exited.
                    }
                }
            }, exports.SCRIPT_JAIL_RSS_POLL_INTERVAL_MS);
            const execPromise = (0, isolatedWorldExec_1.executeJavaScriptWhenReady)(jailContents, bootstrapCode, false).then((rawOutcome) => {
                if (!rawOutcome || typeof rawOutcome !== 'object') {
                    return failResult('JAIL_CRASHED', 'Script jail returned an invalid bootstrap response');
                }
                const outcome = rawOutcome;
                if (outcome.ok === true) {
                    return outcome.value === undefined
                        ? { ok: true }
                        : { ok: true, value: outcome.value };
                }
                const mappedErrorCode = typeof outcome.errorCode === 'string' &&
                    WORKER_ERROR_CODES.has(outcome.errorCode)
                    ? outcome.errorCode
                    : 'RUNTIME_ERROR';
                return failResult(mappedErrorCode, typeof outcome.errorMessage === 'string' && outcome.errorMessage
                    ? outcome.errorMessage
                    : 'Script execution failed');
            }, (err) => failResult('JAIL_CRASHED', err instanceof Error ? err.message : String(err)));
            // Port-as-admission: deliver port2 to the requesting renderer ONLY when
            // a jail has been assigned and started.
            authorizedSender.postMessage(exports.SCRIPT_JAIL_PORT_CHANNEL, { jailId }, [port2]);
            jailContents.postMessage(exports.SCRIPT_JAIL_PORT_CHANNEL, null, [port1]);
            return await Promise.race([execPromise, earlyExitPromise]);
        }
        catch (err) {
            if (earlyResult) {
                return earlyResult;
            }
            const code = err instanceof JailSpawnError ? 'JAIL_CRASHED' : 'INTERNAL_ERROR';
            return failResult(code, err instanceof Error ? err.message : String(err));
        }
        finally {
            activeJails.delete(jailId);
            unregisterRunningSenderAbort();
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
            if (rssWatchdogHandle !== undefined) {
                clearInterval(rssWatchdogHandle);
            }
            try {
                port1?.close();
                port2?.close();
                closeJailView(jailView, jailContents);
            }
            finally {
                // A throwing teardown step must not stall the queue or the warm pool.
                pumpJailQueue();
                schedulePoolRefill();
            }
        }
    })().then(resolveRun, (err) => resolveRun(failResult('INTERNAL_ERROR', err instanceof Error ? err.message : String(err))));
}
/**
 * Enqueues or admits an untrusted agent script for execution inside a single-use,
 * zero-egress `WebContentsView` from the pre-warmed pool (or cold-started on demand).
 */
async function runScriptInJail(sender, req, senderFrame) {
    assertAuthorizedJailSender(sender, senderFrame);
    const authorizedSender = sender;
    if (electron_1.app.commandLine.hasSwitch('no-sandbox')) {
        return failResult('SANDBOX_UNAVAILABLE', 'Script jail requires Chromium OS sandboxing (--no-sandbox is active)');
    }
    if (!req || typeof req !== 'object') {
        return failResult('INVALID_REQUEST', 'Request payload must be an object');
    }
    if (!isValidJailId(req.jailId)) {
        return failResult('INVALID_REQUEST', 'jailId must be a valid non-empty identifier');
    }
    const jailId = req.jailId;
    if (activeJails.has(jailId) || queuedJails.has(jailId)) {
        return failResult('INVALID_REQUEST', `Duplicate active jailId: ${jailId}`);
    }
    if (typeof req.pageFacadeBundle !== 'string' ||
        req.pageFacadeBundle.trim() === '') {
        return failResult('INVALID_REQUEST', 'pageFacadeBundle must be a non-empty string');
    }
    if (typeof req.modelScript !== 'string') {
        return failResult('INVALID_REQUEST', 'modelScript must be a string');
    }
    const senderId = authorizedSender.id;
    const canAdmitImmediately = activeJails.size < exports.MAX_CONCURRENT_JAILS_GLOBAL &&
        getRunningCountForSender(senderId) < exports.MAX_CONCURRENT_JAILS_PER_SENDER &&
        getQueuedCountForSender(senderId) === 0;
    if (!canAdmitImmediately) {
        if (getQueuedCountForSender(senderId) >= exports.MAX_QUEUED_JAILS_PER_SENDER) {
            return failResult('RESOURCE_LIMIT', `Too many queued script jails for sender (max ${exports.MAX_QUEUED_JAILS_PER_SENDER})`);
        }
        if (queuedJails.size >= exports.MAX_QUEUED_JAILS_GLOBAL) {
            return failResult('RESOURCE_LIMIT', `Too many queued script jails globally (max ${exports.MAX_QUEUED_JAILS_GLOBAL})`);
        }
    }
    const timeoutMs = resolveScriptJailTimeoutMs(req);
    return new Promise((resolveRun) => {
        const detachQueuedWatcher = registerSenderAbortCallback(authorizedSender, (res) => entry.settleQueued(res));
        const entry = {
            jailId,
            sender: authorizedSender,
            senderId,
            req,
            timeoutMs,
            resolveRun,
            detachQueuedWatcher,
            settleQueued: (res) => {
                if (!queuedJails.delete(jailId)) {
                    return;
                }
                detachQueuedWatcher();
                resolveRun(res);
            },
        };
        queuedJails.set(jailId, entry);
        pumpJailQueue();
    });
}
