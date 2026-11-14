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
exports.MARKER_PATTERN = void 0;
exports.newMarker = newMarker;
exports.discoveryFileNameFor = discoveryFileNameFor;
exports.parseBootstrapLine = parseBootstrapLine;
/**
 * Parser for the bootstrap script's stdout: `<marker> <EVENT> <payload>`
 * lines, with a secret marker per connection, so other output (rc files,
 * MOTD) can't forge events. The marker may start mid-line: rc output without
 * a trailing newline can glue onto a protocol line.
 */
const crypto = __importStar(require("crypto"));
/** The codes the script reports (agy_fail); any other is UNKNOWN. */
const BOOTSTRAP_ERROR_CODES = [
    'UNSUPPORTED_HOST',
    'SHARED_HOME_UNSUPPORTED',
    'INSTALL_FAILED',
    'LS_START_FAILED',
    'LS_STOPPED',
];
/** Markers accepted by buildBootstrapScript(); newMarker() produces them. */
exports.MARKER_PATTERN = /^[a-f0-9]{16,128}$/;
function newMarker() {
    return crypto.randomBytes(12).toString('hex');
}
/** Must match writeDiscoveryFile in the language server (server.go). */
function discoveryFileNameFor(workspaceId) {
    const hash = crypto.createHash('sha256').update(workspaceId, 'utf8');
    return `ls_${hash.digest('hex').slice(0, 16)}.json`;
}
/**
 * Null for non-protocol lines, unknown events, OPEN_URL payloads that aren't
 * one token and NEED_UPLOAD without `<x64|arm64> <reason>`. A bad READY's
 * error never echoes it: it has the token.
 */
function parseBootstrapLine(line, marker) {
    const prefix = `${marker} `;
    const at = marker ? line.indexOf(prefix) : -1;
    if (at < 0) {
        return null;
    }
    const rest = line.slice(at + prefix.length).replace(/[\r\n]+$/, '');
    const space = rest.indexOf(' ');
    const event = space < 0 ? rest : rest.slice(0, space);
    const payload = space < 0 ? '' : rest.slice(space + 1);
    switch (event) {
        case 'STATUS':
            return { type: 'status', text: payload };
        case 'NEED_UPLOAD': {
            const [, arch, reason = ''] = /^(\S+) (.*)$/.exec(payload) ?? [];
            return arch === 'x64' || arch === 'arm64'
                ? { type: 'needUpload', arch, reason }
                : null;
        }
        case 'READY':
            return parseReady(payload);
        case 'OPEN_URL':
            return /^\S+$/.test(payload) ? { type: 'openUrl', url: payload } : null;
        case 'ERROR':
            return parseError(payload);
        default:
            return null;
    }
}
function readyError(message) {
    return { type: 'error', code: 'UNKNOWN', message: `READY: ${message}` };
}
function intInRange(v, min, max) {
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
        ? v
        : undefined;
}
function nonEmptyString(v) {
    return typeof v === 'string' && v !== '' ? v : undefined;
}
function parseReady(payload) {
    let parsed;
    try {
        parsed = JSON.parse(payload);
    }
    catch {
        return readyError('discovery data is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return readyError('discovery data is not a JSON object');
    }
    const d = parsed;
    const fields = {
        pid: intInRange(d.pid, 1, 0x7fffffff),
        httpsPort: intInRange(d.httpsPort, 1, 65535),
        httpPort: intInRange(d.httpPort, 0, 65535),
        lspPort: intInRange(d.lspPort, 0, 65535),
        lsVersion: nonEmptyString(d.lsVersion),
        csrfToken: nonEmptyString(d.csrfToken),
    };
    const { pid, httpsPort, httpPort, lspPort, lsVersion, csrfToken } = fields;
    if (pid !== undefined &&
        httpsPort !== undefined &&
        httpPort !== undefined &&
        lspPort !== undefined &&
        lsVersion !== undefined &&
        csrfToken !== undefined) {
        return {
            type: 'ready',
            discovery: { pid, httpsPort, httpPort, lspPort, lsVersion, csrfToken },
        };
    }
    const invalid = Object.entries(fields)
        .filter(([, value]) => value === undefined)
        .map(([name]) => name);
    return readyError(`invalid ${invalid.join(', ')}`);
}
function parseError(payload) {
    const m = /^code=(\S+)(?: (.*))?$/.exec(payload);
    if (!m) {
        return { type: 'error', code: 'UNKNOWN', message: payload };
    }
    const [, code, message = ''] = m;
    const known = BOOTSTRAP_ERROR_CODES.find((c) => c === code);
    if (known !== undefined) {
        return { type: 'error', code: known, message };
    }
    // Keep the unrecognized code visible for debugging.
    return {
        type: 'error',
        code: 'UNKNOWN',
        message: message ? `${code}: ${message}` : code,
    };
}
