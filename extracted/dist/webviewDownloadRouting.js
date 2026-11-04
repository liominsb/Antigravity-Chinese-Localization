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
exports.AGENT_POPUP_REVEAL_GRACE_MS = exports.DEFAULT_DOWNLOAD_FILENAME = exports.MAX_DOWNLOAD_FILENAME_LENGTH = void 0;
exports.sanitizeDownloadFilename = sanitizeDownloadFilename;
exports.validateBrainDownloadsDir = validateBrainDownloadsDir;
exports.setGuestDownloadDirectoryForWc = setGuestDownloadDirectoryForWc;
exports.getArmedGuestDownloadDirectory = getArmedGuestDownloadDirectory;
exports.trackChildPopupDownloadLifecycle = trackChildPopupDownloadLifecycle;
exports.prepareChildPopupDownloadCleanup = prepareChildPopupDownloadCleanup;
exports.resolveOpenerWebContents = resolveOpenerWebContents;
exports.resolveSynchronousDownloadTarget = resolveSynchronousDownloadTarget;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/** Maximum byte/character length of a sanitized download filename. */
exports.MAX_DOWNLOAD_FILENAME_LENGTH = 128;
/** Fallback filename used when a raw download name has no safe characters. */
exports.DEFAULT_DOWNLOAD_FILENAME = 'download.bin';
/**
 * Grace window (ms) after `did-navigate` before revealing an agent-armed child
 * popup via `showInactive()`, so HTML-landing + JS/meta-refresh export popups
 * trigger `will-download` without ever flashing on screen.
 */
exports.AGENT_POPUP_REVEAL_GRACE_MS = 750;
const IN_FLIGHT_RESERVATION_TTL_MS = 5 * 60000;
const MAX_COLLISION_ATTEMPTS = 1000;
const SAFE_CASCADE_ID_RE = /^[A-Za-z0-9._-]+$/;
const WINDOWS_RESERVED_STEM_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
const SAFE_EXTENSION_RE = /(\.[A-Za-z0-9]{1,16})$/;
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
function buildCollisionFilename(safeFilename, attempt) {
    const suffix = `_${attempt}`;
    const extMatch = SAFE_EXTENSION_RE.exec(safeFilename);
    const ext = extMatch &&
        extMatch[1].length + suffix.length < exports.MAX_DOWNLOAD_FILENAME_LENGTH
        ? extMatch[1]
        : '';
    const rawStem = ext ? safeFilename.slice(0, -ext.length) : safeFilename;
    const maxStemLen = Math.max(1, exports.MAX_DOWNLOAD_FILENAME_LENGTH - suffix.length - ext.length);
    const stem = rawStem.slice(0, maxStemLen).replace(/[._-]+$/g, '') || 'dl';
    return `${stem}${suffix}${ext}`;
}
function splitPathSegments(targetPath) {
    return targetPath.split(/[\\/]+/).filter(Boolean);
}
function assertTrailingSandboxSegments(targetPath, expectedCascadeId) {
    const segments = splitPathSegments(targetPath);
    if (segments.length < 4) {
        throw new Error(`Invalid brainDownloadsDir "${targetPath}": missing brain/<cascadeId>/browser_sandbox/downloads hierarchy`);
    }
    const brainIdx = segments.length - 4;
    const brainSeg = segments[brainIdx];
    const cascadeId = segments[brainIdx + 1];
    const sandboxSeg = segments[brainIdx + 2];
    const downloadsSeg = segments[brainIdx + 3];
    if (brainSeg !== 'brain' ||
        sandboxSeg !== 'browser_sandbox' ||
        downloadsSeg !== 'downloads' ||
        !SAFE_CASCADE_ID_RE.test(cascadeId) ||
        cascadeId === '.' ||
        cascadeId === '..' ||
        (expectedCascadeId !== undefined && cascadeId !== expectedCascadeId)) {
        throw new Error(`Invalid brainDownloadsDir "${targetPath}": path must end with brain/<cascadeId>/browser_sandbox/downloads`);
    }
    return cascadeId;
}
/**
 * Validates that `rawDir` is an absolute, non-traversal, non-symlinked
 * `.../brain/<cascadeId>/browser_sandbox/downloads` directory path and returns
 * its normalized path.
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
    assertTrailingSandboxSegments(normalized);
    const sandboxDir = path.dirname(normalized);
    const cascadeDir = path.dirname(sandboxDir);
    const brainDir = path.dirname(cascadeDir);
    // None of the four sandbox levels may be a symbolic link or a regular file.
    for (const levelDir of [brainDir, cascadeDir, sandboxDir, normalized]) {
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
        guestDownloadDirByWcId.delete(wc.id);
        return null;
    }
    const validated = validateBrainDownloadsDir(downloadDir);
    const wcId = wc.id;
    guestDownloadDirByWcId.set(wcId, validated);
    if (typeof wc.once === 'function' && !trackedDestroyListeners.has(wc)) {
        trackedDestroyListeners.add(wc);
        wc.once('destroyed', () => {
            guestDownloadDirByWcId.delete(wcId);
        });
    }
    return validated;
}
/** Returns the currently armed download directory for `webContentsId`, if any. */
function getArmedGuestDownloadDirectory(webContentsId) {
    return guestDownloadDirByWcId.get(webContentsId);
}
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
function allocateCollisionFreeSavePath(targetDir, realTargetDir, rawFilename, nowMs) {
    pruneExpiredReservations(nowMs);
    const safeBase = sanitizeDownloadFilename(rawFilename);
    for (let attempt = 0; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
        const candidateName = attempt === 0
            ? safeBase
            : attempt < MAX_COLLISION_ATTEMPTS
                ? buildCollisionFilename(safeBase, attempt)
                : buildCollisionFilename(safeBase, nowMs);
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
        inFlightReservedPaths.set(canonicalPath, nowMs + IN_FLIGHT_RESERVATION_TTL_MS);
        let released = false;
        return {
            savePath,
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
        const expectedCascadeId = assertTrailingSandboxSegments(validatedDir);
        fs.mkdirSync(validatedDir, { recursive: true });
        validateBrainDownloadsDir(validatedDir);
        const realTargetDir = fs.realpathSync(validatedDir);
        assertTrailingSandboxSegments(realTargetDir, expectedCascadeId);
        return allocateCollisionFreeSavePath(validatedDir, realTargetDir, rawFilename, nowMs);
    }
    catch {
        return null;
    }
}
function resolveDefaultDownloadTarget(rawFilename, getDefaultDownloadsDir, nowMs) {
    const candidates = [];
    try {
        const primary = (getDefaultDownloadsDir ?? (() => electron_1.app.getPath('downloads')))();
        if (typeof primary === 'string' && primary.length > 0) {
            candidates.push({ dir: primary, isSharedTmpFallback: false });
        }
    }
    catch {
        // Fall through to os.tmpdir() fallback below.
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
    for (const { dir: rawDir, isSharedTmpFallback } of candidates) {
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
                fs.mkdirSync(targetDir, { recursive: true });
                const st = fs.statSync(targetDir, { throwIfNoEntry: false });
                if (!st || !st.isDirectory()) {
                    continue;
                }
            }
            const realTargetDir = fs.realpathSync(targetDir);
            return allocateCollisionFreeSavePath(targetDir, realTargetDir, rawFilename, nowMs);
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
            : undefined);
    if (armedDir !== undefined) {
        return resolveArmedDownloadTarget(armedDir, params.rawFilename, nowMs);
    }
    return resolveDefaultDownloadTarget(params.rawFilename, params.getDefaultDownloadsDir, nowMs);
}
