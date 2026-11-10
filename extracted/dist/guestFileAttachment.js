"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idpBlockedErr = exports.actionErr = exports.MAX_VIRTUAL_UPLOAD_TOTAL_BYTES = exports.MAX_VIRTUAL_UPLOAD_FILE_BYTES = exports.WEBVIEW_FILE_CHOOSER_OPENED_CHANNEL = void 0;
exports.resolveGuestUploadFiles = resolveGuestUploadFiles;
exports.isGuestOnBlankOrEmptyUrl = isGuestOnBlankOrEmptyUrl;
exports.syncPopupGuardIsolatedFlag = syncPopupGuardIsolatedFlag;
exports.extractComparableOrigin = extractComparableOrigin;
exports.getGuestMainOrigin = getGuestMainOrigin;
exports.verifySameOriginChooserFrame = verifySameOriginChooserFrame;
exports.resolveConnectedDomPathForBackendNode = resolveConnectedDomPathForBackendNode;
exports.attachVirtualFilesToBackendNode = attachVirtualFilesToBackendNode;
exports.applyInterceptedChooserDecision = applyInterceptedChooserDecision;
exports.attachStagedFilesByDomPath = attachStagedFilesByDomPath;
const guestDebugger_1 = require("./guestDebugger");
const webviewUploadValidation_1 = require("./webviewUploadValidation");
exports.WEBVIEW_FILE_CHOOSER_OPENED_CHANNEL = 'webview:file-chooser-opened';
exports.MAX_VIRTUAL_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
exports.MAX_VIRTUAL_UPLOAD_TOTAL_BYTES = 25 * 1024 * 1024;
function resolveGuestUploadFiles(req) {
    return (0, webviewUploadValidation_1.resolveStagedUploadFilesMetadata)(req?.uploadsRoot, Array.isArray(req?.files) ? req.files : [], {
        expectedCascadeId: req?.expectedConversationId,
        maxFileCount: req?.maxFileCount,
        maxFileBytes: req?.maxFileBytes,
        maxTotalBytes: req?.maxTotalBytes,
    });
}
function isGuestOnBlankOrEmptyUrl(wc) {
    const url = (wc.getURL?.() ?? '').trim();
    return url === '' || /^about:blank(?:[?#].*)?$/i.test(url);
}
async function syncPopupGuardIsolatedFlag(wc, allow, isolatedWorldId = 9997) {
    if (wc.isDestroyed?.() || isGuestOnBlankOrEmptyUrl(wc)) {
        return;
    }
    const code = `window.__wcvAllowInterceptedFileChooser = ${allow ? 'true' : 'false'};`;
    const subframes = (wc.mainFrame?.framesInSubtree ?? []).filter((f) => f && f !== wc.mainFrame && !f.isDestroyed?.());
    await Promise.all([wc, ...subframes].map((t) => typeof t.executeJavaScriptInIsolatedWorld === 'function'
        ? Promise.resolve(t.executeJavaScriptInIsolatedWorld(isolatedWorldId, [{ code }])).catch(() => undefined)
        : Promise.resolve()));
}
const actionErr = (error) => ({
    ok: false,
    errorCode: 'ACTION_FAILED',
    error,
});
exports.actionErr = actionErr;
const idpBlockedErr = () => ({
    ok: false,
    errorCode: 'NAVIGATION_NEEDS_PERMISSION',
    error: 'File upload is blocked on protected authentication pages. Ask the user to complete sign-in directly in the browser pane.',
});
exports.idpBlockedErr = idpBlockedErr;
function isExplicitOpaqueOrigin(raw) {
    const s = (raw ?? '').trim().toLowerCase();
    return s === 'null' || s === '://';
}
const stripUrlFragment = (u) => u.replace(/#.*$/, '');
function extractComparableOrigin(securityOrigin, rawUrl) {
    const sec = (securityOrigin ?? '').trim();
    if (isExplicitOpaqueOrigin(sec)) {
        return '';
    }
    const candidates = sec ? [sec] : [rawUrl];
    for (const raw of candidates) {
        const s = (raw || '').trim();
        if (!s || s === 'null' || s === '://' || /^about:/i.test(s)) {
            continue;
        }
        if (/^file:\/\/\/?$/i.test(s)) {
            return 'file://';
        }
        try {
            const outer = new URL(s);
            if (outer.protocol === 'file:') {
                return 'file://';
            }
            const parsed = outer.protocol === 'blob:' ? new URL(outer.pathname) : outer;
            if (parsed.origin && parsed.origin !== 'null') {
                return parsed.origin.toLowerCase();
            }
        }
        catch {
            // Ignore opaque or unparseable origins.
        }
    }
    return '';
}
function getGuestMainOrigin(wc) {
    return extractComparableOrigin(wc.mainFrame?.origin, wc.getURL?.() || wc.mainFrame?.url);
}
function findFramePathInCdpTree(node, targetId) {
    if (!node?.frame) {
        return undefined;
    }
    if (node.frame.id === targetId) {
        return [node.frame];
    }
    for (const child of node.childFrames ?? []) {
        const subPath = findFramePathInCdpTree(child, targetId);
        if (subPath) {
            return [node.frame, ...subPath];
        }
    }
    return undefined;
}
/** Verifies `frameId` and every ancestor frame share the guest main frame's non-opaque, non-IdP origin. */
async function verifySameOriginChooserFrame(dbg, wc, frameId) {
    const rawMainFrameOrigin = (wc.mainFrame?.origin ?? '').trim();
    if (isExplicitOpaqueOrigin(rawMainFrameOrigin) ||
        (rawMainFrameOrigin !== '' && !extractComparableOrigin(rawMainFrameOrigin))) {
        return { allowed: false, mainOrigin: '' };
    }
    const wcOrigin = getGuestMainOrigin(wc);
    if ((0, webviewUploadValidation_1.isGuestOnProtectedIdp)(wc)) {
        return { allowed: false, mainOrigin: wcOrigin };
    }
    if (!dbg?.sendCommand) {
        return {
            allowed: !frameId && Boolean(wcOrigin),
            mainOrigin: wcOrigin,
            ...(wcOrigin ? { frameOrigin: wcOrigin } : {}),
            ...(wc.getURL?.() ? { frameUrl: wc.getURL() } : {}),
        };
    }
    try {
        const res = (await dbg.sendCommand('Page.getFrameTree'));
        const rootNode = res?.frameTree;
        const rootFrame = rootNode?.frame;
        if (!rootFrame?.id || isExplicitOpaqueOrigin(rootFrame.securityOrigin)) {
            return { allowed: false, mainOrigin: '' };
        }
        const mainOrigin = extractComparableOrigin(rootFrame.securityOrigin, rootFrame.url) ||
            wcOrigin;
        if (!mainOrigin ||
            (0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(rootFrame.url || '') ||
            (0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(rootFrame.securityOrigin || '')) {
            return { allowed: false, mainOrigin };
        }
        if (!frameId || frameId === rootFrame.id) {
            return {
                allowed: true,
                mainOrigin,
                frameOrigin: mainOrigin,
                ...(rootFrame.url ? { frameUrl: rootFrame.url } : {}),
            };
        }
        const framePath = findFramePathInCdpTree(rootNode, frameId);
        if (!framePath || framePath.length === 0) {
            return { allowed: false, mainOrigin };
        }
        const opaqueSubframeUrls = new Set();
        let hasOpaqueAboutSubframe = false;
        for (const wf of wc.mainFrame?.framesInSubtree ?? []) {
            if (wf && wf !== wc.mainFrame && !wf.isDestroyed?.()) {
                const wfOrig = (wf.origin ?? '').trim();
                if (isExplicitOpaqueOrigin(wfOrig) ||
                    (wfOrig !== '' && !extractComparableOrigin(wfOrig))) {
                    const wfUrl = (wf.url ?? '').trim();
                    if (!wfUrl || /^about:/i.test(wfUrl)) {
                        hasOpaqueAboutSubframe = true;
                    }
                    else {
                        opaqueSubframeUrls.add(wfUrl);
                        opaqueSubframeUrls.add(stripUrlFragment(wfUrl));
                    }
                }
            }
        }
        let leafUrl;
        for (let i = 1; i < framePath.length; i++) {
            const f = framePath[i];
            const fUrl = (f.url ?? '').trim();
            leafUrl = fUrl || leafUrl;
            const fUrlNoHash = stripUrlFragment(fUrl);
            const isOpaqueMatch = fUrl
                ? opaqueSubframeUrls.has(fUrl) || opaqueSubframeUrls.has(fUrlNoHash)
                : hasOpaqueAboutSubframe;
            if ((0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(fUrl) ||
                (0, webviewUploadValidation_1.isProtectedIdentityProviderOriginUrl)(f.securityOrigin || '') ||
                isOpaqueMatch ||
                (/^about:/i.test(fUrl) && hasOpaqueAboutSubframe)) {
                return { allowed: false, mainOrigin };
            }
            const fOrigin = extractComparableOrigin(f.securityOrigin, fUrl);
            if (!fOrigin || fOrigin !== mainOrigin) {
                return { allowed: false, mainOrigin };
            }
        }
        return {
            allowed: true,
            mainOrigin,
            frameOrigin: mainOrigin,
            ...(leafUrl ? { frameUrl: leafUrl } : {}),
        };
    }
    catch {
        return { allowed: false, mainOrigin: wcOrigin };
    }
}
const buildResolveDomPathExpr = (domPath, fileCount) => `(() => { const steps = ${JSON.stringify(domPath)}; let node = document; for (let i = 0; i < steps.length && node; i++) { const s = steps[i]; if (s.kind === 'child') node = node.childNodes && s.index < node.childNodes.length ? node.childNodes[s.index] : null; else if (s.kind === 'shadow') node = node.shadowRoot || null; else if (s.kind === 'frame') { try { node = node.contentDocument || null; } catch { node = null; } } else node = null; } if (!node || node.nodeType !== 1 || String(node.tagName || '').toUpperCase() !== 'INPUT' || String(node.type || '').toLowerCase() !== 'file') return 'ERR:element is not an <input type="file">'; if (node.disabled) return 'ERR:element is disabled'; if (${Number(fileCount) || 0} > 1 && !node.multiple && !node.hasAttribute('multiple')) return 'ERR:non-multiple file input accepts at most one file'; return node; })()`;
const COMPUTE_CONNECTED_DOM_PATH_FN = "function() { const el = this; if (!el || !el.isConnected) return null; const rev = []; for (let guard = 0, curr = el; guard < 512 && curr; guard++) { const p = curr.parentNode; if (p) { const idx = Array.prototype.indexOf.call(p.childNodes, curr); if (idx < 0) return null; rev.push({kind: 'child', index: idx}); curr = p; continue; } if (curr.host) { rev.push({kind: 'shadow'}); curr = curr.host; continue; } const win = curr.defaultView; if (!win) return null; if (win === win.top) return rev.reverse(); let frameEl = null; try { frameEl = win.frameElement; } catch { return null; } if (!frameEl) return null; rev.push({kind: 'frame'}); curr = frameEl; } return null; }";
const APPLY_VIRTUAL_FILES_FN = "function(entries) { const el = this; if (!el || String(el.tagName || '').toUpperCase() !== 'INPUT' || String(el.type || '').toLowerCase() !== 'file') return {ok: false, error: 'element is not an <input type=\"file\">'}; if (el.disabled) return {ok: false, error: 'element is disabled'}; const list = Array.isArray(entries) ? entries : []; if (list.length > 1 && !el.multiple && !el.hasAttribute('multiple')) return {ok: false, error: 'non-multiple file chooser accepts at most one file'}; const win = (el.ownerDocument && el.ownerDocument.defaultView) || window; const dt = new (win.DataTransfer || DataTransfer)(); const FileCtor = win.File || File; for (let i = 0; i < list.length; i++) { const bin = atob(list[i].base64 || ''); const bytes = new Uint8Array(bin.length); for (let b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b); dt.items.add(new FileCtor([bytes], list[i].name || 'file', {type: list[i].mimeType || 'application/octet-stream'})); } el.files = dt.files; const Ev = win.Event || Event; el.dispatchEvent(new Ev('input', {bubbles: true, composed: true})); el.dispatchEvent(new Ev('change', {bubbles: true})); return {ok: true}; }";
async function callFunctionOnBackendNode(dbg, frameId, backendNodeId, functionDeclaration, args, mapResult, fallback) {
    if (!dbg.sendCommand ||
        typeof backendNodeId !== 'number' ||
        backendNodeId <= 0) {
        return fallback;
    }
    let objectId;
    try {
        let targetFrameId = frameId;
        if (!targetFrameId) {
            const ft = (await dbg.sendCommand('Page.getFrameTree'));
            targetFrameId = ft?.frameTree?.frame?.id;
        }
        const w = targetFrameId
            ? (await dbg.sendCommand('Page.createIsolatedWorld', {
                frameId: targetFrameId,
                worldName: 'agy_file_upload',
                grantUniversalAccess: false,
            }))
            : undefined;
        const res = (await dbg.sendCommand('DOM.resolveNode', {
            backendNodeId,
            ...(typeof w?.executionContextId === 'number'
                ? { executionContextId: w.executionContextId }
                : {}),
        }));
        objectId = res?.object?.objectId;
        if (!objectId) {
            return fallback;
        }
        const callRes = (await dbg.sendCommand('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration,
            arguments: args,
            returnByValue: true,
        }));
        if (callRes?.exceptionDetails) {
            return fallback;
        }
        return mapResult(callRes?.result?.value);
    }
    catch {
        return fallback;
    }
    finally {
        if (objectId) {
            void dbg
                .sendCommand('Runtime.releaseObject', { objectId })
                .catch(() => undefined);
        }
    }
}
async function resolveConnectedDomPathForBackendNode(dbg, frameId, backendNodeId) {
    return callFunctionOnBackendNode(dbg, frameId, backendNodeId, COMPUTE_CONNECTED_DOM_PATH_FN, [], (val) => ((0, webviewUploadValidation_1.isValidDomPath)(val) ? [...val] : undefined), undefined);
}
async function attachVirtualFilesToBackendNode(dbg, frameId, backendNodeId, virtualFiles) {
    return callFunctionOnBackendNode(dbg, frameId, backendNodeId, APPLY_VIRTUAL_FILES_FN, [{ value: virtualFiles }], (val) => {
        const r = val;
        return r?.ok === true
            ? { ok: true }
            : (0, exports.actionErr)(r?.error || 'Failed to set virtual files');
    }, (0, exports.actionErr)('Intercepted file chooser did not expose a target input node'));
}
function validateVirtualUploadFiles(virtualFiles) {
    if (virtualFiles.length > webviewUploadValidation_1.MAX_UPLOAD_FILE_COUNT) {
        return {
            ok: false,
            errorCode: 'SCRIPT_ERROR',
            error: `Cannot attach more than ${webviewUploadValidation_1.MAX_UPLOAD_FILE_COUNT} virtual files in one call (got ${virtualFiles.length})`,
        };
    }
    const out = [];
    let totalBytes = 0;
    for (const item of virtualFiles) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return {
                ok: false,
                errorCode: 'SCRIPT_ERROR',
                error: 'Invalid virtual file entry',
            };
        }
        const r = item;
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        const mimeType = typeof r.mimeType === 'string' && r.mimeType
            ? r.mimeType
            : 'application/octet-stream';
        const base64 = typeof r.base64 === 'string' ? r.base64 : null;
        if (!name ||
            name.length > 255 ||
            /[\0/\\]/.test(name) ||
            name === '.' ||
            name === '..' ||
            mimeType.length > 255 ||
            mimeType.includes('\0') ||
            base64 === null ||
            base64.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
            return {
                ok: false,
                errorCode: 'SCRIPT_ERROR',
                error: `Invalid virtual file "${name || 'unknown'}"`,
            };
        }
        const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
        const decodedBytes = base64.length === 0 ? 0 : (base64.length * 3) / 4 - pad;
        if (decodedBytes > exports.MAX_VIRTUAL_UPLOAD_FILE_BYTES) {
            return {
                ok: false,
                errorCode: 'SCRIPT_ERROR',
                error: `Virtual file "${name}" (${decodedBytes} bytes) exceeds ${exports.MAX_VIRTUAL_UPLOAD_FILE_BYTES}-byte limit`,
            };
        }
        totalBytes += decodedBytes;
        if (totalBytes > exports.MAX_VIRTUAL_UPLOAD_TOTAL_BYTES) {
            return {
                ok: false,
                errorCode: 'SCRIPT_ERROR',
                error: `Total virtual upload size (${totalBytes} bytes) exceeds ${exports.MAX_VIRTUAL_UPLOAD_TOTAL_BYTES}-byte limit`,
            };
        }
        out.push({ name, mimeType, base64 });
    }
    return { ok: true, files: out };
}
/** Applies an intercepted `GuestFileChooserDecision` onto `pending.backendNodeId` (including `[]` clear). */
async function applyInterceptedChooserDecision(dbg, pending, decision, consumePending) {
    if (Array.isArray(decision.virtualFiles) &&
        decision.virtualFiles.length > 0) {
        const validatedVirt = validateVirtualUploadFiles(decision.virtualFiles);
        if (!validatedVirt.ok) {
            return validatedVirt;
        }
        if (!pending.multiple && validatedVirt.files.length > 1) {
            return (0, exports.actionErr)('non-multiple file chooser accepts at most one file');
        }
        consumePending();
        if (typeof pending.backendNodeId === 'number' &&
            pending.backendNodeId > 0) {
            await dbg
                .sendCommand?.('DOM.setFileInputFiles', {
                files: [],
                backendNodeId: pending.backendNodeId,
            })
                .catch(() => undefined);
        }
        return attachVirtualFilesToBackendNode(dbg, pending.frameId, pending.backendNodeId, validatedVirt.files);
    }
    const rawFiles = Array.isArray(decision.files) ? decision.files : [];
    if (!pending.multiple && rawFiles.length > 1) {
        return (0, exports.actionErr)('non-multiple file chooser accepts at most one file');
    }
    const validated = (0, webviewUploadValidation_1.resolveValidatedStagedUploadFiles)(decision.allowedUploadsDir, rawFiles, {
        expectedCascadeId: decision.expectedConversationId,
        maxFileCount: decision.maxFileCount,
        maxFileBytes: decision.maxFileBytes,
        maxTotalBytes: decision.maxTotalBytes,
    });
    if (!validated.ok) {
        return validated;
    }
    consumePending();
    if (typeof pending.backendNodeId !== 'number' || pending.backendNodeId <= 0) {
        return (0, exports.actionErr)('Intercepted file chooser did not expose a target input node');
    }
    if (validated.files.length === 0) {
        await dbg
            .sendCommand?.('DOM.setFileInputFiles', {
            files: [],
            backendNodeId: pending.backendNodeId,
        })
            .catch(() => undefined);
        return attachVirtualFilesToBackendNode(dbg, pending.frameId, pending.backendNodeId, []);
    }
    try {
        await dbg.sendCommand?.('DOM.setFileInputFiles', {
            files: validated.files,
            backendNodeId: pending.backendNodeId,
        });
        return { ok: true };
    }
    catch (err) {
        return (0, exports.actionErr)(err instanceof Error ? err.message : String(err));
    }
}
/** Validates staged `uploads/` files and attaches (or clears when `[]`) onto `request.domPath`. */
async function attachStagedFilesByDomPath(wc, request) {
    if ((0, webviewUploadValidation_1.isGuestOnProtectedIdp)(wc)) {
        return (0, exports.idpBlockedErr)();
    }
    if (!(0, webviewUploadValidation_1.isValidDomPath)(request?.domPath)) {
        return (0, exports.actionErr)('Invalid target DOM path for <input type="file">');
    }
    const validated = (0, webviewUploadValidation_1.resolveValidatedStagedUploadFiles)(request.allowedUploadsDir, Array.isArray(request.files) ? request.files : [], {
        expectedCascadeId: request.expectedConversationId,
        maxFileCount: request.maxFileCount,
        maxFileBytes: request.maxFileBytes,
        maxTotalBytes: request.maxTotalBytes,
    });
    if (!validated.ok) {
        return validated;
    }
    const dbg = wc.debugger;
    if (!dbg || wc.isDestroyed?.() || !(0, guestDebugger_1.ensureGuestDebuggerAttached)(dbg)) {
        return (0, exports.actionErr)('Guest debugger is unavailable for setInputFiles');
    }
    let objectId;
    try {
        const ft = (await dbg.sendCommand?.('Page.getFrameTree'));
        const mainFrameId = ft?.frameTree?.frame?.id;
        if (!mainFrameId) {
            return (0, exports.actionErr)('Unable to resolve guest main frame for setInputFiles');
        }
        const world = (await dbg.sendCommand?.('Page.createIsolatedWorld', {
            frameId: mainFrameId,
            worldName: 'agy_file_upload',
            grantUniversalAccess: false,
        }));
        if (typeof world?.executionContextId !== 'number') {
            return (0, exports.actionErr)('Unable to create isolated world for setInputFiles');
        }
        const evalRes = (await dbg.sendCommand?.('Runtime.evaluate', {
            contextId: world.executionContextId,
            expression: buildResolveDomPathExpr(request.domPath, validated.files.length),
            returnByValue: false,
        }));
        if (evalRes?.exceptionDetails) {
            return (0, exports.actionErr)(evalRes.exceptionDetails.text || 'Failed to resolve <input type="file">');
        }
        if (typeof evalRes?.result?.value === 'string' &&
            evalRes.result.value.startsWith('ERR:')) {
            return (0, exports.actionErr)(evalRes.result.value.slice('ERR:'.length));
        }
        objectId = evalRes?.result?.objectId;
        if (!objectId) {
            return (0, exports.actionErr)('Target <input type="file"> could not be resolved');
        }
        if (validated.files.length === 0) {
            const clearRes = (await dbg.sendCommand?.('Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: APPLY_VIRTUAL_FILES_FN,
                arguments: [{ value: [] }],
                returnByValue: true,
            }));
            const r = clearRes?.result?.value;
            return !clearRes?.exceptionDetails && r?.ok === true
                ? { ok: true }
                : (0, exports.actionErr)(clearRes?.exceptionDetails?.text ||
                    r?.error ||
                    'Failed to clear file input');
        }
        await dbg.sendCommand?.('DOM.setFileInputFiles', {
            objectId,
            files: validated.files,
        });
        return { ok: true };
    }
    catch (err) {
        return (0, exports.actionErr)(err instanceof Error ? err.message : String(err));
    }
    finally {
        if (objectId) {
            void dbg
                .sendCommand?.('Runtime.releaseObject', { objectId })
                .catch(() => undefined);
        }
    }
}
