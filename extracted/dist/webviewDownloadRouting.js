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
exports.AGENT_CONTROL_TOMBSTONE_TTL_MS = exports.IN_FLIGHT_RESERVATION_TTL_MS = exports.AGENT_DOWNLOAD_APPROVAL_TIMEOUT_MS = exports.AGENT_POPUP_REVEAL_GRACE_MS = exports.HUMAN_DOWNLOAD_DIR_STORAGE_KEY = exports.DEFAULT_DOWNLOAD_FILENAME = exports.MAX_DOWNLOAD_FILENAME_LENGTH = void 0;
exports.sanitizeDownloadFilename = sanitizeDownloadFilename;
exports.sanitizeHumanDownloadFilename = sanitizeHumanDownloadFilename;
exports.isSafeExistingRegularFile = isSafeExistingRegularFile;
exports.isExecutableDownloadPath = isExecutableDownloadPath;
exports.isBlockedAgentDownloadFormat = isBlockedAgentDownloadFormat;
exports.readConfiguredHumanDownloadsDir = readConfiguredHumanDownloadsDir;
exports.validateBrainDownloadsDir = validateBrainDownloadsDir;
exports.setGuestDownloadDirectoryForWc = setGuestDownloadDirectoryForWc;
exports.recordAgentControlTombstone = recordAgentControlTombstone;
exports.hasRecentAgentControlTombstone = hasRecentAgentControlTombstone;
exports.getAgentControlReleasedAtMs = getAgentControlReleasedAtMs;
exports.clearAgentControlTombstonesForTesting = clearAgentControlTombstonesForTesting;
exports.setGuestAgentControlledForWc = setGuestAgentControlledForWc;
exports.isGuestMarkedAgentControlled = isGuestMarkedAgentControlled;
exports.clearAgentControlledGuestsForTesting = clearAgentControlledGuestsForTesting;
exports.getArmedGuestDownloadDirectory = getArmedGuestDownloadDirectory;
exports.trackChildPopupDownloadLifecycle = trackChildPopupDownloadLifecycle;
exports.prepareChildPopupDownloadCleanup = prepareChildPopupDownloadCleanup;
exports.resolveOpenerWebContents = resolveOpenerWebContents;
exports.resolveSynchronousDownloadTarget = resolveSynchronousDownloadTarget;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const guestAgentControl_1 = require("./guestAgentControl");
/** Maximum byte/character length of a sanitized download filename. */
exports.MAX_DOWNLOAD_FILENAME_LENGTH = 128;
/** Fallback filename used when a raw download name has no safe characters. */
exports.DEFAULT_DOWNLOAD_FILENAME = 'download.bin';
/** App storage key storing the user-configured built-in browser download folder. */
exports.HUMAN_DOWNLOAD_DIR_STORAGE_KEY = 'builtinBrowserDownloadDir';
/**
 * Grace window (ms) after `did-navigate` before revealing an agent-armed child
 * popup via `showInactive()`, so HTML-landing + JS/meta-refresh export popups
 * trigger `will-download` without ever flashing on screen.
 */
exports.AGENT_POPUP_REVEAL_GRACE_MS = 750;
/**
 * How long an agent download may wait for the user's approval before it is
 * cancelled (fail closed). Re-exported by `webviewBrowser`.
 */
exports.AGENT_DOWNLOAD_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * How long a reserved save path stays reserved before Chromium creates the
 * file. It outlives the approval wait so a second download cannot pick the
 * same path while the first is paused awaiting approval.
 */
exports.IN_FLIGHT_RESERVATION_TTL_MS = exports.AGENT_DOWNLOAD_APPROVAL_TIMEOUT_MS + 5 * 60000;
/**
 * How long a guest stays treated as agent-associated after it was disarmed
 * or destroyed, so late `will-download` events never fall back to the
 * default downloads folder.
 */
exports.AGENT_CONTROL_TOMBSTONE_TTL_MS = 60000;
const MAX_COLLISION_ATTEMPTS = 1000;
const SAFE_CASCADE_ID_RE = /^[A-Za-z0-9._-]+$/;
const WINDOWS_RESERVED_STEM_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
const SAFE_EXTENSION_RE = /(\.[A-Za-z0-9]{1,16})$/;
const EXECUTABLE_DOWNLOAD_EXTENSIONS = new Set([
    '.app',
    '.appimage',
    '.applescript',
    '.appx',
    '.bash',
    '.bat',
    '.chm',
    '.cmd',
    '.com',
    '.command',
    '.cpl',
    '.csh',
    '.desktop',
    '.dmg',
    '.exe',
    '.hta',
    '.img',
    '.iso',
    '.jar',
    '.js',
    '.jse',
    '.ksh',
    '.lnk',
    '.mpkg',
    '.msc',
    '.msi',
    '.msix',
    '.pif',
    '.pkg',
    '.ps1',
    '.psm1',
    '.reg',
    '.run',
    '.scpt',
    '.scr',
    '.sh',
    '.terminal',
    '.tool',
    '.url',
    '.vbe',
    '.vbs',
    '.vhd',
    '.vhdx',
    '.webloc',
    '.workflow',
    '.wsf',
    '.wsh',
    '.zsh',
]);
/**
 * Extra native-code and script formats blocked for agent downloads on top of
 * {@link EXECUTABLE_DOWNLOAD_EXTENSIONS}.
 */
const AGENT_BLOCKED_EXTRA_EXTENSIONS = new Set([
    '.apk',
    '.crx',
    '.deb',
    '.dll',
    '.dylib',
    '.ipa',
    '.pl',
    '.py',
    '.rb',
    '.rpm',
    '.so',
    '.wasm',
]);
/** Markup formats that run script when opened from local disk. */
const ACTIVE_HTML_DOWNLOAD_EXTENSIONS = new Set([
    '.htm',
    '.html',
    '.mht',
    '.mhtml',
    '.shtml',
    '.svg',
    '.svgz',
    '.xhtml',
    '.xml',
    '.xsl',
    '.xslt',
]);
/** MIME types identifying active markup or executables regardless of extension. */
const AGENT_BLOCKED_DOWNLOAD_MIME_TYPES = new Set([
    'application/java-archive',
    'application/vnd.microsoft.portable-executable',
    'application/x-apple-diskimage',
    'application/x-executable',
    'application/x-mach-binary',
    'application/x-msdos-program',
    'application/x-msdownload',
    'application/x-sh',
    'application/x-shellscript',
    'application/xhtml+xml',
    'image/svg+xml',
    'multipart/related',
    'text/html',
]);
const guestDownloadDirByWcId = new Map();
const trackedDestroyListeners = new WeakSet();
const inFlightReservedPaths = new Map();
const childPopupRecordByWc = new WeakMap();
const childPopupRecordByWcId = new Map();
/**
 * Sanitizes an untrusted download filename to `[A-Za-z0-9._-]` bounded to
 * {@link MAX_DOWNLOAD_FILENAME_LENGTH} characters, with leading/trailing
 * punctuation stripped and Windows reserved device names prefixed.
 *
 * Every output is a fixed point under Go's `SanitizeSandboxDownloadFilename`.
 */
function sanitizeDownloadFilename(rawFilename) {
    const trimmed = typeof rawFilename === 'string' ? rawFilename.trim() : '';
    const lastSlashIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    const rawBase = lastSlashIdx >= 0 ? trimmed.slice(lastSlashIdx + 1) : trimmed;
    let cleaned = rawBase
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^[._-]+|[._-]+$/g, '');
    if (!cleaned) {
        return exports.DEFAULT_DOWNLOAD_FILENAME;
    }
    if (WINDOWS_RESERVED_STEM_RE.test(cleaned)) {
        cleaned = `dl_${cleaned}`;
    }
    if (cleaned.length > exports.MAX_DOWNLOAD_FILENAME_LENGTH) {
        const extMatch = SAFE_EXTENSION_RE.exec(cleaned);
        const ext = extMatch && extMatch[1].length < exports.MAX_DOWNLOAD_FILENAME_LENGTH
            ? extMatch[1]
            : '';
        const stemBudget = exports.MAX_DOWNLOAD_FILENAME_LENGTH - ext.length;
        let stem = cleaned.slice(0, stemBudget).replace(/[._-]+$/g, '');
        if (WINDOWS_RESERVED_STEM_RE.test(stem)) {
            stem = `dl_${stem}`.slice(0, stemBudget).replace(/[._-]+$/g, '');
        }
        cleaned = stem ? `${stem}${ext}` : exports.DEFAULT_DOWNLOAD_FILENAME;
    }
    return cleaned;
}
function sliceUtf16Safe(input, maxUnits) {
    if (maxUnits <= 0 || input.length <= maxUnits) {
        return maxUnits <= 0 ? '' : input;
    }
    const sliced = input.slice(0, maxUnits);
    const lastCode = sliced.charCodeAt(sliced.length - 1);
    return lastCode >= 0xd800 && lastCode <= 0xdbff
        ? sliced.slice(0, -1)
        : sliced;
}
/**
 * Sanitizes an untrusted human download filename while preserving readable
 * spaces, parentheses, brackets, and Unicode characters. Strips path prefixes,
 * control/bidi-override code points, Windows/POSIX illegal filename characters,
 * leading/trailing dots or whitespace, and prefixes Windows reserved stems.
 */
function sanitizeHumanDownloadFilename(rawFilename) {
    const trimmed = typeof rawFilename === 'string' ? rawFilename.trim() : '';
    const lastSlashIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    const rawBase = lastSlashIdx >= 0 ? trimmed.slice(lastSlashIdx + 1) : trimmed;
    let cleaned = rawBase
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]+/g, '')
        .replace(/[<>:"/\\|?*]+/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+|[.\s]+$/g, '');
    if (!cleaned) {
        return exports.DEFAULT_DOWNLOAD_FILENAME;
    }
    const stemBeforeDot = cleaned.split('.')[0]?.trim() ?? '';
    if (WINDOWS_RESERVED_STEM_RE.test(cleaned) ||
        WINDOWS_RESERVED_STEM_RE.test(stemBeforeDot)) {
        cleaned = `dl_${cleaned}`;
    }
    if (cleaned.length > exports.MAX_DOWNLOAD_FILENAME_LENGTH) {
        const extMatch = SAFE_EXTENSION_RE.exec(cleaned);
        const ext = extMatch && extMatch[1].length < exports.MAX_DOWNLOAD_FILENAME_LENGTH
            ? extMatch[1]
            : '';
        const stemBudget = exports.MAX_DOWNLOAD_FILENAME_LENGTH - ext.length;
        let stem = sliceUtf16Safe(cleaned, stemBudget).replace(/[.\s]+$/g, '');
        const truncatedStemBeforeDot = stem.split('.')[0]?.trim() ?? '';
        if (WINDOWS_RESERVED_STEM_RE.test(stem) ||
            WINDOWS_RESERVED_STEM_RE.test(truncatedStemBeforeDot)) {
            stem = sliceUtf16Safe(`dl_${stem}`, stemBudget).replace(/[.\s]+$/g, '');
        }
        cleaned = stem ? `${stem}${ext}` : exports.DEFAULT_DOWNLOAD_FILENAME;
    }
    return cleaned;
}
/**
 * Returns `true` when `targetPath` is an absolute path to an existing regular
 * non-symlink file on disk.
 */
function isSafeExistingRegularFile(targetPath) {
    if (typeof targetPath !== 'string' ||
        targetPath.length === 0 ||
        targetPath.includes('\0') ||
        !path.isAbsolute(targetPath)) {
        return false;
    }
    try {
        const st = fs.lstatSync(targetPath, { throwIfNoEntry: false });
        return Boolean(st && !st.isSymbolicLink() && st.isFile());
    }
    catch {
        return false;
    }
}
/**
 * Returns `true` when `targetPath` carries an OS executable, script, or
 * shortcut extension that should be revealed in the file manager rather than
 * launched directly via `shell.openPath`.
 */
function isExecutableDownloadPath(targetPath) {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        return false;
    }
    const normalized = targetPath.trim().replace(/[.\s]+$/g, '');
    const ext = path.extname(normalized).toLowerCase();
    return EXECUTABLE_DOWNLOAD_EXTENSIONS.has(ext);
}
/**
 * Returns `true` when an agent-initiated download must be refused because its
 * filename extension or MIME type identifies an executable, script, installer,
 * or active local markup (HTML/SVG/XML) format.
 */
function isBlockedAgentDownloadFormat(filename, mimeType) {
    const base = (typeof filename === 'string' ? filename : '')
        .trim()
        .replace(/[.\s]+$/g, '')
        .split(/[\\/]/)
        .pop();
    const ext = path.extname(base).toLowerCase();
    if (EXECUTABLE_DOWNLOAD_EXTENSIONS.has(ext) ||
        AGENT_BLOCKED_EXTRA_EXTENSIONS.has(ext) ||
        ACTIVE_HTML_DOWNLOAD_EXTENSIONS.has(ext)) {
        return true;
    }
    const mime = (typeof mimeType === 'string' ? mimeType : '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    return AGENT_BLOCKED_DOWNLOAD_MIME_TYPES.has(mime);
}
/**
 * Synchronously reads the user-configured human download directory from
 * `<userData>/app_storage.json` (`builtinBrowserDownloadDir`), returning
 * `undefined` when unset, empty, relative, or unreadable.
 */
function readConfiguredHumanDownloadsDir(userDataDir, platform = process.platform) {
    try {
        const resolvedUserData = userDataDir ?? electron_1.app.getPath('userData');
        if (typeof resolvedUserData !== 'string' || resolvedUserData.length === 0) {
            return undefined;
        }
        const raw = fs.readFileSync(path.join(resolvedUserData, 'app_storage.json'), 'utf8');
        if (!raw || !raw.trim()) {
            return undefined;
        }
        const parsed = JSON.parse(raw);
        const configured = parsed?.[exports.HUMAN_DOWNLOAD_DIR_STORAGE_KEY];
        if (typeof configured !== 'string') {
            return undefined;
        }
        const trimmed = configured.trim();
        const targetPath = platform === 'win32' ? path.win32 : path.posix;
        if (!trimmed ||
            trimmed.includes('\0') ||
            (platform === 'win32' && /^[\\/](?![\\/])/.test(trimmed)) ||
            !targetPath.isAbsolute(trimmed) ||
            trimmed.split(/[\\/]+/).some((seg) => seg === '..')) {
            return undefined;
        }
        return targetPath.resolve(trimmed);
    }
    catch {
        return undefined;
    }
}
function buildCollisionFilename(safeFilename, attempt, isAgentDownload) {
    const suffix = isAgentDownload ? `_${attempt}` : ` (${attempt})`;
    const extMatch = SAFE_EXTENSION_RE.exec(safeFilename);
    const ext = extMatch &&
        extMatch[1].length + suffix.length < exports.MAX_DOWNLOAD_FILENAME_LENGTH
        ? extMatch[1]
        : '';
    const rawStem = ext ? safeFilename.slice(0, -ext.length) : safeFilename;
    const maxStemLen = Math.max(1, exports.MAX_DOWNLOAD_FILENAME_LENGTH - suffix.length - ext.length);
    const stem = sliceUtf16Safe(rawStem, maxStemLen).replace(isAgentDownload ? /[._-]+$/g : /[.\s]+$/g, '') || 'dl';
    return `${stem}${suffix}${ext}`;
}
function splitPathSegments(targetPath) {
    return targetPath.split(/[\\/]+/).filter(Boolean);
}
function assertTrailingSandboxSegments(targetPath, expected) {
    const segments = splitPathSegments(targetPath);
    if (segments.length >= 4 &&
        segments[segments.length - 4] === 'brain' &&
        segments[segments.length - 2] === 'browser_sandbox' &&
        segments[segments.length - 1] === 'downloads') {
        const cascadeId = segments[segments.length - 3];
        if (SAFE_CASCADE_ID_RE.test(cascadeId) &&
            cascadeId !== '.' &&
            cascadeId !== '..' &&
            (!expected ||
                (cascadeId === expected.cascadeId &&
                    expected.kind === 'sandbox-downloads'))) {
            const sandboxDir = path.dirname(targetPath);
            const cascadeDir = path.dirname(sandboxDir);
            const brainDir = path.dirname(cascadeDir);
            return {
                cascadeId,
                kind: 'sandbox-downloads',
                hierarchyDirs: [brainDir, cascadeDir, sandboxDir, targetPath],
            };
        }
    }
    else if (segments.length >= 3 &&
        segments[segments.length - 3] === 'brain' &&
        segments[segments.length - 1] === 'scratch') {
        const cascadeId = segments[segments.length - 2];
        if (SAFE_CASCADE_ID_RE.test(cascadeId) &&
            cascadeId !== '.' &&
            cascadeId !== '..' &&
            (!expected ||
                (cascadeId === expected.cascadeId && expected.kind === 'scratch'))) {
            const cascadeDir = path.dirname(targetPath);
            const brainDir = path.dirname(cascadeDir);
            return {
                cascadeId,
                kind: 'scratch',
                hierarchyDirs: [brainDir, cascadeDir, targetPath],
            };
        }
    }
    throw new Error(`Invalid brainDownloadsDir "${targetPath}": path must end with brain/<cascadeId>/browser_sandbox/downloads or brain/<cascadeId>/scratch`);
}
/**
 * Validates that `rawDir` is an absolute, non-traversal, non-symlinked
 * `.../brain/<cascadeId>/browser_sandbox/downloads` or
 * `.../brain/<cascadeId>/scratch` directory path and returns its normalized path.
 */
function validateBrainDownloadsDir(rawDir) {
    if (typeof rawDir !== 'string' || rawDir.length === 0) {
        throw new Error('brainDownloadsDir must be a non-empty string');
    }
    if (rawDir.includes('\0')) {
        throw new Error('brainDownloadsDir must not contain NUL bytes');
    }
    if (!path.isAbsolute(rawDir)) {
        throw new Error(`brainDownloadsDir must be an absolute path: "${rawDir}"`);
    }
    const rawSegments = rawDir.split(/[\\/]+/);
    if (rawSegments.some((seg) => seg === '.' || seg === '..')) {
        throw new Error(`brainDownloadsDir must not contain relative traversal segments: "${rawDir}"`);
    }
    const normalized = path.resolve(rawDir);
    const { hierarchyDirs } = assertTrailingSandboxSegments(normalized);
    // None of the brain hierarchy levels may be a symbolic link or a regular file.
    for (const levelDir of hierarchyDirs) {
        const st = fs.lstatSync(levelDir, { throwIfNoEntry: false });
        if (st) {
            if (st.isSymbolicLink()) {
                throw new Error(`brainDownloadsDir rejects symbolic link segment: "${levelDir}"`);
            }
            if (!st.isDirectory()) {
                throw new Error(`brainDownloadsDir segment is not a directory: "${levelDir}"`);
            }
        }
    }
    return normalized;
}
/**
 * Arms or clears the per-guest sandbox download directory for `wc`.
 * Passing `null` clears any armed directory and restores default routing.
 */
function setGuestDownloadDirectoryForWc(wc, downloadDir) {
    if (!wc ||
        typeof wc.id !== 'number' ||
        !Number.isInteger(wc.id) ||
        wc.id <= 0) {
        throw new Error('Invalid guest WebContents for download directory');
    }
    if (downloadDir === null) {
        if (guestDownloadDirByWcId.delete(wc.id)) {
            recordAgentControlTombstone(wc.id);
        }
        return null;
    }
    const validated = validateBrainDownloadsDir(downloadDir);
    const wcId = wc.id;
    guestDownloadDirByWcId.set(wcId, validated);
    if (typeof wc.once === 'function' && !trackedDestroyListeners.has(wc)) {
        trackedDestroyListeners.add(wc);
        wc.once('destroyed', () => {
            if (guestDownloadDirByWcId.delete(wcId)) {
                recordAgentControlTombstone(wcId);
            }
        });
    }
    return validated;
}
const agentControlTombstoneUntilByWcId = new Map();
/**
 * Remembers for {@link AGENT_CONTROL_TOMBSTONE_TTL_MS} that `webContentsId`
 * was armed or agent-controlled (called on disarm and on destruction).
 */
function recordAgentControlTombstone(webContentsId, nowMs = Date.now()) {
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
        return;
    }
    agentControlTombstoneUntilByWcId.set(webContentsId, nowMs + exports.AGENT_CONTROL_TOMBSTONE_TTL_MS);
}
/** Whether `webContentsId` was armed/agent-controlled within the last 60s. */
function hasRecentAgentControlTombstone(webContentsId, nowMs = Date.now()) {
    for (const [id, until] of agentControlTombstoneUntilByWcId) {
        if (until <= nowMs) {
            agentControlTombstoneUntilByWcId.delete(id);
        }
    }
    return agentControlTombstoneUntilByWcId.has(webContentsId);
}
/**
 * When `webContentsId` last stopped being armed/agent-controlled, if that was
 * within the last {@link AGENT_CONTROL_TOMBSTONE_TTL_MS}.
 */
function getAgentControlReleasedAtMs(webContentsId, nowMs = Date.now()) {
    if (!hasRecentAgentControlTombstone(webContentsId, nowMs)) {
        return undefined;
    }
    return (agentControlTombstoneUntilByWcId.get(webContentsId) -
        exports.AGENT_CONTROL_TOMBSTONE_TTL_MS);
}
/** Clears agent-control tombstones for hermetic unit tests. */
function clearAgentControlTombstonesForTesting() {
    agentControlTombstoneUntilByWcId.clear();
}
/**
 * Guests the host renderer reported as under agent control (e.g. legacy
 * `<webview>` tabs driven by JSON actions that never arm a download dir).
 */
const agentControlledGuestIds = new Set();
const trackedAgentControlDestroyListeners = new WeakSet();
/**
 * Marks guest `wc` as agent-controlled (`active = true`) or not. Clearing an
 * active mark, or destroying a marked guest, records a 60s agent-control
 * tombstone so late downloads never fall back to the default folder.
 */
function setGuestAgentControlledForWc(wc, active) {
    if (!wc ||
        typeof wc.id !== 'number' ||
        !Number.isInteger(wc.id) ||
        wc.id <= 0 ||
        typeof active !== 'boolean') {
        return false;
    }
    const wcId = wc.id;
    if (!active) {
        if (agentControlledGuestIds.delete(wcId)) {
            recordAgentControlTombstone(wcId);
        }
        return true;
    }
    agentControlledGuestIds.add(wcId);
    if (typeof wc.once === 'function' &&
        !trackedAgentControlDestroyListeners.has(wc)) {
        trackedAgentControlDestroyListeners.add(wc);
        wc.once('destroyed', () => {
            if (agentControlledGuestIds.delete(wcId)) {
                recordAgentControlTombstone(wcId);
            }
        });
    }
    return true;
}
/** Whether the host renderer marked `webContentsId` as agent-controlled. */
function isGuestMarkedAgentControlled(webContentsId) {
    return agentControlledGuestIds.has(webContentsId);
}
/** Clears renderer-reported agent-control marks for hermetic unit tests. */
function clearAgentControlledGuestsForTesting() {
    agentControlledGuestIds.clear();
}
(0, guestAgentControl_1.registerGuestAgentControlPredicate)(isGuestMarkedAgentControlled);
/** Returns the currently armed download directory for `webContentsId`, if any. */
function getArmedGuestDownloadDirectory(webContentsId) {
    return guestDownloadDirByWcId.get(webContentsId);
}
(0, guestAgentControl_1.registerGuestAgentControlPredicate)((webContentsId) => Boolean(getArmedGuestDownloadDirectory(webContentsId)));
function getTrackedChildPopupRecord(wc) {
    if (!wc || typeof wc !== 'object') {
        return undefined;
    }
    const byRef = childPopupRecordByWc.get(wc);
    if (byRef) {
        return byRef;
    }
    const wcId = wc.id;
    if (typeof wcId === 'number' && Number.isInteger(wcId) && wcId > 0) {
        return childPopupRecordByWcId.get(wcId);
    }
    return undefined;
}
function clearChildPopupRevealTimer(record) {
    if (record.revealTimer !== undefined) {
        clearTimeout(record.revealTimer);
        record.revealTimer = undefined;
    }
}
/**
 * Tracks a child popup `BrowserWindow` opened by `openerContents` so:
 * 1. Child-popup downloads deterministically attribute `openerWebContentsId`
 *    even when `COOP` or `noopener` clears `window.opener`.
 * 2. Popups spawned while `openerContents` is agent-armed defer `showInactive()`
 *    by {@link AGENT_POPUP_REVEAL_GRACE_MS} after `did-navigate` (cancelling the
 *    reveal if `will-download` fires first) and auto-close once all downloads
 *    triggered by that popup reach a terminal state, even if a landing HTML
 *    page (`"Preparing download..."`) committed before redirecting to the file.
 */
function trackChildPopupDownloadLifecycle(params) {
    const { childWindow, openerContents, isBlankPopupUrl, hasCommittedNavigation, revealGraceMs = exports.AGENT_POPUP_REVEAL_GRACE_MS, } = params;
    const popupWc = childWindow?.webContents;
    const openedWhileAgentArmed = Boolean(getArmedGuestDownloadDirectory(openerContents.id));
    const record = {
        childWindow,
        openerContents,
        openedWhileAgentArmed,
        hasCommittedNonBlankNavigation: Boolean(hasCommittedNavigation?.()),
        hasCommittedNavigation,
        totalDownloadCount: 0,
        inFlightDownloadCount: 0,
        revealed: false,
    };
    const popupWcId = popupWc &&
        typeof popupWc.id === 'number' &&
        Number.isInteger(popupWc.id) &&
        popupWc.id > 0
        ? popupWc.id
        : 0;
    if (popupWc && typeof popupWc === 'object') {
        childPopupRecordByWc.set(popupWc, record);
    }
    if (popupWcId > 0) {
        childPopupRecordByWcId.set(popupWcId, record);
    }
    let onDidNavigate;
    const cleanup = () => {
        clearChildPopupRevealTimer(record);
        if (onDidNavigate) {
            popupWc?.removeListener?.('did-navigate', onDidNavigate);
            onDidNavigate = undefined;
        }
        if (popupWcId > 0 && childPopupRecordByWcId.get(popupWcId) === record) {
            childPopupRecordByWcId.delete(popupWcId);
        }
    };
    childWindow.once?.('closed', cleanup);
    popupWc?.once?.('destroyed', cleanup);
    if (openedWhileAgentArmed) {
        onDidNavigate = (_event, navigationUrl) => {
            if (typeof navigationUrl !== 'string' || isBlankPopupUrl(navigationUrl)) {
                return;
            }
            record.hasCommittedNonBlankNavigation = true;
            if (onDidNavigate) {
                popupWc?.removeListener?.('did-navigate', onDidNavigate);
                onDidNavigate = undefined;
            }
            if (!record.revealed &&
                record.totalDownloadCount === 0 &&
                !childWindow.isDestroyed?.()) {
                clearChildPopupRevealTimer(record);
                const timer = setTimeout(() => {
                    record.revealTimer = undefined;
                    if (!record.revealed &&
                        record.totalDownloadCount === 0 &&
                        !childWindow.isDestroyed?.() &&
                        !popupWc?.isCrashed?.()) {
                        record.revealed = true;
                        try {
                            if (childWindow.isVisible?.() !== true) {
                                if (typeof childWindow.showInactive === 'function') {
                                    childWindow.showInactive();
                                }
                                else {
                                    childWindow.show?.();
                                }
                            }
                        }
                        catch {
                            // Ignore asynchronous BrowserWindow destruction races.
                        }
                    }
                }, Math.max(0, revealGraceMs));
                timer.unref?.();
                record.revealTimer = timer;
            }
        };
        popupWc?.on?.('did-navigate', onDidNavigate);
    }
}
function isPopupDocumentCommitted(record) {
    return (record.hasCommittedNonBlankNavigation ||
        Boolean(record.hasCommittedNavigation?.()));
}
/**
 * Marks a tracked child popup on `will-download`, cancels any pending deferred
 * reveal timer, hides the popup window, and returns an idempotent callback that
 * closes the popup once all of its in-flight downloads terminate (for any
 * agent-armed child popup, or for an unarmed initial-blank download-only popup).
 */
function prepareChildPopupDownloadCleanup(wc) {
    const record = getTrackedChildPopupRecord(wc);
    if (!record) {
        return undefined;
    }
    if (!record.openedWhileAgentArmed && isPopupDocumentCommitted(record)) {
        return undefined;
    }
    clearChildPopupRevealTimer(record);
    record.totalDownloadCount += 1;
    record.inFlightDownloadCount += 1;
    if (!record.childWindow.isDestroyed?.()) {
        try {
            record.childWindow.hide?.();
        }
        catch {
            // Ignore asynchronous BrowserWindow destruction races.
        }
    }
    let settled = false;
    return () => {
        if (settled) {
            return;
        }
        settled = true;
        record.inFlightDownloadCount = Math.max(0, record.inFlightDownloadCount - 1);
        if (record.inFlightDownloadCount > 0) {
            return;
        }
        const shouldClose = record.openedWhileAgentArmed
            ? record.totalDownloadCount > 0
            : !isPopupDocumentCommitted(record);
        if (shouldClose && !record.childWindow.isDestroyed?.()) {
            clearChildPopupRevealTimer(record);
            try {
                record.childWindow.close?.();
            }
            catch {
                // Ignore asynchronous BrowserWindow destruction races.
            }
        }
    };
}
/** Resolves the live opener `WebContents` for a child popup `wc`, if present. */
function resolveOpenerWebContents(wc) {
    if (!wc || typeof wc !== 'object') {
        return undefined;
    }
    const tracked = getTrackedChildPopupRecord(wc);
    if (tracked && !tracked.openerContents.isDestroyed?.()) {
        return tracked.openerContents;
    }
    const openerFrame = wc.mainFrame?.opener ??
        wc.opener;
    const fromFrame = electron_1.webContents?.fromFrame;
    if (!openerFrame || typeof fromFrame !== 'function') {
        return undefined;
    }
    try {
        const openerWc = fromFrame(openerFrame);
        return openerWc && !openerWc.isDestroyed?.() ? openerWc : undefined;
    }
    catch {
        return undefined;
    }
}
function pruneExpiredReservations(nowMs) {
    for (const [key, expiresAt] of inFlightReservedPaths) {
        if (expiresAt <= nowMs) {
            inFlightReservedPaths.delete(key);
        }
    }
}
function allocateCollisionFreeSavePath(targetDir, realTargetDir, rawFilename, nowMs, isAgentDownload) {
    pruneExpiredReservations(nowMs);
    const safeBase = isAgentDownload
        ? sanitizeDownloadFilename(rawFilename)
        : sanitizeHumanDownloadFilename(rawFilename);
    for (let attempt = 0; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
        const candidateName = attempt === 0
            ? safeBase
            : attempt < MAX_COLLISION_ATTEMPTS
                ? buildCollisionFilename(safeBase, attempt, isAgentDownload)
                : buildCollisionFilename(safeBase, nowMs, isAgentDownload);
        const savePath = path.join(targetDir, candidateName);
        const canonicalPath = path.join(realTargetDir, candidateName);
        // Ensure neither path escapes its directory root.
        if (path.dirname(savePath) !== targetDir ||
            path.dirname(canonicalPath) !== realTargetDir) {
            throw new Error(`Resolved download path escaped directory: ${savePath}`);
        }
        // Use lstatSync rather than existsSync so dangling symlinks are treated as
        // occupied entries and never followed when Chromium opens the target file.
        if (inFlightReservedPaths.has(canonicalPath) ||
            fs.lstatSync(savePath, { throwIfNoEntry: false }) !== undefined ||
            fs.lstatSync(canonicalPath, { throwIfNoEntry: false }) !== undefined) {
            continue;
        }
        // Chromium creates the destination file asynchronously after will-download
        // returns; reserve the canonical path so back-to-back downloads do not
        // select the same filename before the first file appears on disk.
        inFlightReservedPaths.set(canonicalPath, nowMs + exports.IN_FLIGHT_RESERVATION_TTL_MS);
        let released = false;
        return {
            savePath,
            isAgentDownload,
            release: () => {
                if (!released) {
                    released = true;
                    inFlightReservedPaths.delete(canonicalPath);
                }
            },
        };
    }
    throw new Error('Exhausted download filename collision attempts');
}
function resolveArmedDownloadTarget(armedDir, rawFilename, nowMs) {
    try {
        // Re-validate at download time to defeat TOCTOU symlink swaps after arming.
        const validatedDir = validateBrainDownloadsDir(armedDir);
        const expected = assertTrailingSandboxSegments(validatedDir);
        fs.mkdirSync(validatedDir, { recursive: true });
        validateBrainDownloadsDir(validatedDir);
        const realTargetDir = fs.realpathSync(validatedDir);
        assertTrailingSandboxSegments(realTargetDir, expected);
        return allocateCollisionFreeSavePath(validatedDir, realTargetDir, rawFilename, nowMs, true);
    }
    catch {
        return null;
    }
}
function resolveDefaultDownloadTarget(rawFilename, getDefaultDownloadsDir, getUserDataDir, nowMs) {
    // mustExist marks the user-configured folder: it is used only if it already
    // exists as a directory, so an unmounted volume path is never recreated on
    // the root disk.
    const candidates = [];
    if (getDefaultDownloadsDir) {
        try {
            const explicitDir = getDefaultDownloadsDir();
            if (typeof explicitDir === 'string' && explicitDir.length > 0) {
                candidates.push({ dir: explicitDir, isSharedTmpFallback: false });
            }
        }
        catch {
            // Fall through to fallbacks below.
        }
    }
    else {
        const configuredDir = readConfiguredHumanDownloadsDir(getUserDataDir?.());
        if (configuredDir) {
            candidates.push({
                dir: configuredDir,
                isSharedTmpFallback: false,
                mustExist: true,
            });
        }
        try {
            const systemDownloads = electron_1.app.getPath('downloads');
            if (typeof systemDownloads === 'string' && systemDownloads.length > 0) {
                candidates.push({ dir: systemDownloads, isSharedTmpFallback: false });
            }
        }
        catch {
            // Fall through to os.tmpdir() fallback below.
        }
    }
    try {
        const tmpBase = os.tmpdir();
        if (typeof tmpBase === 'string' && tmpBase.length > 0) {
            const uidSuffix = typeof process.getuid === 'function' ? `-${process.getuid()}` : '';
            candidates.push({
                dir: path.join(tmpBase, `antigravity-browser-downloads${uidSuffix}`),
                isSharedTmpFallback: true,
            });
        }
    }
    catch {
        // Ignore os.tmpdir() failure.
    }
    for (const { dir: rawDir, isSharedTmpFallback, mustExist } of candidates) {
        if (rawDir.includes('\0') || !path.isAbsolute(rawDir)) {
            continue;
        }
        try {
            const targetDir = path.resolve(rawDir);
            if (isSharedTmpFallback) {
                const preLstat = fs.lstatSync(targetDir, { throwIfNoEntry: false });
                if (preLstat &&
                    (preLstat.isSymbolicLink() || !preLstat.isDirectory())) {
                    continue;
                }
                fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
                const postLstat = fs.lstatSync(targetDir, { throwIfNoEntry: false });
                if (!postLstat ||
                    postLstat.isSymbolicLink() ||
                    !postLstat.isDirectory() ||
                    (typeof process.getuid === 'function' &&
                        postLstat.uid !== process.getuid())) {
                    continue;
                }
            }
            else {
                if (!mustExist) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                const st = fs.statSync(targetDir, { throwIfNoEntry: false });
                if (!st || !st.isDirectory()) {
                    continue;
                }
            }
            const realTargetDir = fs.realpathSync(targetDir);
            return allocateCollisionFreeSavePath(targetDir, realTargetDir, rawFilename, nowMs, false);
        }
        catch {
            continue;
        }
    }
    return null;
}
/**
 * Synchronously resolves a safe, collision-free save path for an Electron
 * `will-download` event so Chromium never opens a native modal save dialog.
 *
 * Returns `null` when an armed sandbox directory fails validation or filesystem
 * setup so the caller can cancel the download synchronously (`item.cancel()`).
 */
function resolveSynchronousDownloadTarget(params) {
    const nowMs = (params.now ?? Date.now)();
    const armedDir = (params.webContentsId > 0
        ? guestDownloadDirByWcId.get(params.webContentsId)
        : undefined) ??
        (params.openerWebContentsId && params.openerWebContentsId > 0
            ? guestDownloadDirByWcId.get(params.openerWebContentsId)
            : undefined) ??
        params.fallbackArmedDir;
    if (armedDir !== undefined) {
        return resolveArmedDownloadTarget(armedDir, params.rawFilename, nowMs);
    }
    return resolveDefaultDownloadTarget(params.rawFilename, params.getDefaultDownloadsDir, params.getUserDataDir, nowMs);
}
