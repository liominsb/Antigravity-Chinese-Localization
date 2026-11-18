"use strict";
/**
 * @fileoverview The sandbox gate of script mode (rt-security #1903 P3 i):
 * before the Hub advertises supports_script it runs `agy-desktop-script
 * selftest` once per binary (cached by its SHA-256) and requires every
 * probe to be denied after the child's lockdown. A macOS update that
 * loosens the pure-computation profile then turns script mode off instead
 * of running unconfined JavaScript.
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
exports.SELFTEST_PROBES = void 0;
exports.selftestPassed = selftestPassed;
exports.scriptSandboxVerified = scriptSandboxVerified;
exports.resetScriptSandboxVerdicts = resetScriptSandboxVerdicts;
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
/** How many probes the selftest reports (desktop-script/main.swift). */
exports.SELFTEST_PROBES = 9;
const SELFTEST_TIMEOUT_MS = 15000;
const MAX_SELFTEST_OUTPUT = 64 * 1024;
/**
 * Whether the selftest's last stdout line shows a locked-down child: every
 * probe denied (non-zero), network-outbound denied, no inherited descriptor,
 * no foreign environment, and JavaScript working with frozen intrinsics
 * and no WebAssembly.
 */
function selftestPassed(stdout) {
    const lines = stdout.trim().split('\n');
    let rep;
    try {
        rep = JSON.parse(lines[lines.length - 1] ?? '');
    }
    catch (_e) {
        return false;
    }
    if (!rep || typeof rep !== 'object') {
        return false;
    }
    const probes = rep['probes'];
    if (!probes || typeof probes !== 'object' || Array.isArray(probes)) {
        return false;
    }
    const values = Object.values(probes);
    if (values.length < exports.SELFTEST_PROBES ||
        !values.every((v) => typeof v === 'number' && v !== 0)) {
        return false;
    }
    const fds = rep['fds_open_after_close'];
    if (rep['network_outbound_denied'] !== true ||
        !Array.isArray(fds) ||
        fds.length !== 0 ||
        rep['env_foreign'] !== 0) {
        return false;
    }
    let js;
    try {
        js = JSON.parse(String(rep['js'] ?? ''));
    }
    catch (_e) {
        return false;
    }
    return (!!js &&
        js['frozen_object_prototype'] === true &&
        js['frozen_global'] === true &&
        js['strict_write_throws'] === true &&
        js['wasm_absent'] === true);
}
const defaultRun = (binaryPath) => new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (code) => {
        if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ code, stdout });
        }
    };
    let child;
    try {
        // Like a script run: no arguments but the mode, an empty environment.
        child = (0, child_process_1.spawn)(binaryPath, ['selftest'], {
            stdio: ['ignore', 'pipe', 'ignore'],
            env: {},
        });
    }
    catch (_e) {
        resolve({ code: null, stdout: '' });
        return;
    }
    const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done(null);
    }, SELFTEST_TIMEOUT_MS);
    child.stdout?.on('data', (d) => {
        if (stdout.length < MAX_SELFTEST_OUTPUT) {
            stdout += d.toString('utf8');
        }
    });
    child.on('error', () => done(null));
    child.on('close', (code) => done(code));
});
/** Verdicts by binary SHA-256, for the life of the process. */
const verdicts = new Map();
/**
 * Runs the selftest of the binary at `binaryPath` (once per content hash)
 * and resolves whether it passed. Never rejects: any failure is false.
 */
function scriptSandboxVerified(binaryPath, o = {}) {
    let hash;
    try {
        hash = (0, crypto_1.createHash)('sha256')
            .update(fs.readFileSync(binaryPath))
            .digest('hex');
    }
    catch (_e) {
        return Promise.resolve(false);
    }
    const cached = verdicts.get(hash);
    if (cached) {
        return cached;
    }
    const v = (o.run ?? defaultRun)(binaryPath).then(({ code, stdout }) => {
        const ok = code === 0 && selftestPassed(stdout);
        o.log?.(`[ComputerUse] script sandbox selftest ${ok ? 'passed' : 'FAILED'} sha=${hash.slice(0, 12)} exit=${String(code)}`);
        return ok;
    }, () => false);
    verdicts.set(hash, v);
    return v;
}
/** Test hook: forget the cached verdicts. */
function resetScriptSandboxVerdicts() {
    verdicts.clear();
}
