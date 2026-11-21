"use strict";
/**
 * When computer use runs in the Hub, and which environment it reads.
 *
 * Computer use (the `computer` actuator, the desktop helper, the HUD and the
 * live preview) starts only if:
 * - the `enable-agy-hub-cua-macos` custom flag override is `true` (Hub
 *   Developer Settings, persisted as `jetski.developer.customFlagOverrides`;
 *   packaged dogfood and unpackaged builds), or
 * - in an unpackaged build only, AGY_ENABLE_CUA=1 (dev / E2E harness).
 *
 * The override is renderer-writable, so it is a convenience gate, not a
 * security boundary: the LS's own flag, per-app consent and the macOS TCC
 * grants stay authoritative. It is read once at startup.
 *
 * Node-only, no Electron (callers pass `app.isPackaged`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELPER_ENV_ALLOWLIST = exports.MAX_PREVIEW_SLOTS = exports.MIN_PREVIEW_SLOTS = exports.DEFAULT_PREVIEW_SLOTS = exports.MAX_PREVIEW_SLOTS_KEY = exports.CUSTOM_FLAG_OVERRIDES_KEY = exports.CUA_FLAG = void 0;
exports.cuaFlagOverride = cuaFlagOverride;
exports.resolveMaxPreviewSlots = resolveMaxPreviewSlots;
exports.isComputerUseEnabled = isComputerUseEnabled;
exports.cuaEnv = cuaEnv;
exports.helperEnv = helperEnv;
const constants_1 = require("../constants");
const protocol_1 = require("../desktopHost/protocol");
exports.CUA_FLAG = 'enable-agy-hub-cua-macos';
exports.CUSTOM_FLAG_OVERRIDES_KEY = constants_1.CUSTOM_FLAG_OVERRIDES_STORAGE_KEY;
/** The override's value: true / false when set to a boolean, else undefined. */
function cuaFlagOverride(items) {
    // A store that failed to load reads as no override.
    const raw = items?.[exports.CUSTOM_FLAG_OVERRIDES_KEY];
    if (typeof raw !== 'string' || !raw) {
        return undefined;
    }
    try {
        const o = JSON.parse(raw);
        if (!o || typeof o !== 'object' || Array.isArray(o)) {
            return undefined;
        }
        const v = o[exports.CUA_FLAG];
        return typeof v === 'boolean' ? v : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * How many windows the live preview shows at once: the single
 * `computer.maxPreviewSlots` setting (an app storage item, or a custom flag
 * override of that name in Developer Settings), 1..12, default 6. In an
 * unpackaged build AGY_MAX_PREVIEW_SLOTS wins (dev / E2E). Read at startup.
 */
exports.MAX_PREVIEW_SLOTS_KEY = 'computer.maxPreviewSlots';
exports.DEFAULT_PREVIEW_SLOTS = protocol_1.DEFAULT_VIDEO_SLOTS;
exports.MIN_PREVIEW_SLOTS = 1;
exports.MAX_PREVIEW_SLOTS = protocol_1.MAX_VIDEO_SLOTS;
function resolveMaxPreviewSlots(items, env, packaged) {
    if (!packaged && env.AGY_MAX_PREVIEW_SLOTS) {
        return (0, protocol_1.clampVideoSlots)(env.AGY_MAX_PREVIEW_SLOTS);
    }
    const direct = items[exports.MAX_PREVIEW_SLOTS_KEY];
    if (typeof direct === 'string' && direct.trim()) {
        // Stored by the renderer as JSON (a number or a numeric string).
        let v = direct;
        try {
            v = JSON.parse(direct);
        }
        catch {
            // a bare string
        }
        return (0, protocol_1.clampVideoSlots)(v);
    }
    const raw = items[exports.CUSTOM_FLAG_OVERRIDES_KEY];
    if (typeof raw === 'string' && raw) {
        try {
            const o = JSON.parse(raw);
            if (o && typeof o === 'object' && !Array.isArray(o)) {
                const v = o[exports.MAX_PREVIEW_SLOTS_KEY];
                if (v !== undefined) {
                    return (0, protocol_1.clampVideoSlots)(v);
                }
            }
        }
        catch {
            // ignore a bad overrides blob
        }
    }
    return exports.DEFAULT_PREVIEW_SLOTS;
}
/** Whether computer use starts (see the file comment). */
function isComputerUseEnabled(items, env, packaged) {
    if (!packaged && env.AGY_ENABLE_CUA === '1') {
        return true;
    }
    return cuaFlagOverride(items) === true;
}
/**
 * The environment computer use reads its overrides from: as is in an
 * unpackaged build; without any AGY_* variable in a packaged app.
 */
function cuaEnv(env, packaged) {
    if (!packaged) {
        return env;
    }
    const out = {};
    for (const [k, v] of Object.entries(env)) {
        if (!k.startsWith('AGY_')) {
            out[k] = v;
        }
    }
    return out;
}
/** The only variables a packaged app passes to its helper processes. */
exports.HELPER_ENV_ALLOWLIST = [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
];
/**
 * The environment of the desktop helper and the RTC sidecar: the full
 * environment in an unpackaged build (dev and E2E overrides), only
 * {@link HELPER_ENV_ALLOWLIST} in a packaged app (no AGY_*, DYLD_*, ...).
 */
function helperEnv(env, packaged) {
    if (!packaged) {
        return env;
    }
    const out = {};
    for (const k of exports.HELPER_ENV_ALLOWLIST) {
        if (env[k] !== undefined) {
            out[k] = env[k];
        }
    }
    return out;
}
