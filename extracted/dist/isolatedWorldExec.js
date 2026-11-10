"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POPUP_GUARD_ISOLATED_WORLD_ID = void 0;
exports.waitForWebContentsCanExecuteJs = waitForWebContentsCanExecuteJs;
exports.executeJavaScriptInIsolatedWorldWhenReady = executeJavaScriptInIsolatedWorldWhenReady;
exports.executeJavaScriptWhenReady = executeJavaScriptWhenReady;
exports.runGuestPopupDismissalInDocument = runGuestPopupDismissalInDocument;
exports.buildGuestPopupDismissalScript = buildGuestPopupDismissalScript;
exports.dismissNativeGuestPopups = dismissNativeGuestPopups;
const pendingCanExecuteWaiters = new WeakMap();
function needsCanExecuteWait(wc) {
    // Match Electron's internal `waitTillCanExecuteJavaScript(wc)` predicate
    // (`Boolean(wc.getURL()) && !wc.isLoadingMainFrame()`): whenever that
    // condition is false, Electron attaches a fresh `wc.once('did-stop-loading')`
    // listener on every `executeJavaScript` / `executeJavaScriptInIsolatedWorld` call.
    const missingUrl = typeof wc.getURL === 'function' && !wc.getURL();
    const loadingMain = typeof wc.isLoadingMainFrame === 'function' &&
        Boolean(wc.isLoadingMainFrame());
    return missingUrl || loadingMain;
}
/**
 * Resolves once `wc` can execute main-frame JavaScript without Electron's
 * internal `waitTillCanExecuteJavaScript` registering per-call
 * `did-stop-loading` listeners, or once `wc` is destroyed.
 *
 * Concurrent callers targeting the same `WebContents` share a single
 * `{did-stop-loading, destroyed}` listener pair that symmetrically removes both
 * listeners on settlement so neither `did-stop-loading` nor `destroyed`
 * accumulates listeners across concurrent calls or repeated navigations.
 */
function waitForWebContentsCanExecuteJs(wc) {
    if (!wc || wc.isDestroyed?.() || !needsCanExecuteWait(wc)) {
        return Promise.resolve();
    }
    const canListen = typeof wc.on === 'function' || typeof wc.once === 'function';
    if (!canListen) {
        return Promise.resolve();
    }
    const existing = pendingCanExecuteWaiters.get(wc);
    if (existing) {
        return existing;
    }
    const remove = (event, fn) => {
        if (typeof wc.removeListener === 'function') {
            wc.removeListener(event, fn);
        }
        else if (typeof wc.off === 'function') {
            wc.off(event, fn);
        }
    };
    const add = (event, fn) => {
        if (typeof wc.on === 'function') {
            wc.on(event, fn);
        }
        else if (typeof wc.once === 'function') {
            wc.once(event, fn);
        }
    };
    let settled = false;
    const waiter = new Promise((resolve) => {
        const settle = () => {
            if (settled) {
                return;
            }
            settled = true;
            remove('did-stop-loading', settle);
            remove('destroyed', settle);
            pendingCanExecuteWaiters.delete(wc);
            resolve();
        };
        add('did-stop-loading', settle);
        add('destroyed', settle);
        if (wc.isDestroyed?.() || !needsCanExecuteWait(wc)) {
            settle();
        }
    });
    if (!settled) {
        pendingCanExecuteWaiters.set(wc, waiter);
    }
    return waiter;
}
/**
 * Evaluates `scripts` in `worldId` on `wc`, coalescing concurrent waits while
 * `wc` has not yet committed a URL or is loading its main frame onto a single
 * shared `did-stop-loading` listener and rejecting cleanly if `wc` is destroyed
 * before execution can begin.
 */
async function executeJavaScriptInIsolatedWorldWhenReady(wc, worldId, scripts, userGesture) {
    const canListen = typeof wc.on === 'function' || typeof wc.once === 'function';
    while (!wc.isDestroyed?.() && canListen && needsCanExecuteWait(wc)) {
        await waitForWebContentsCanExecuteJs(wc);
    }
    if (wc.isDestroyed?.()) {
        throw new Error('WebContents was destroyed before isolated-world script could execute');
    }
    return userGesture === undefined
        ? wc.executeJavaScriptInIsolatedWorld(worldId, scripts)
        : wc.executeJavaScriptInIsolatedWorld(worldId, scripts, userGesture);
}
/**
 * Evaluates `code` in the main world on `wc`, coalescing concurrent waits while
 * `wc` has not yet committed a URL or is loading its main frame onto the shared
 * `waitForWebContentsCanExecuteJs` listener and rejecting cleanly if `wc` is
 * destroyed before execution can begin.
 */
async function executeJavaScriptWhenReady(wc, code, userGesture) {
    const canListen = typeof wc.on === 'function' || typeof wc.once === 'function';
    while (!wc.isDestroyed?.() && canListen && needsCanExecuteWait(wc)) {
        await waitForWebContentsCanExecuteJs(wc);
    }
    if (wc.isDestroyed?.()) {
        throw new Error('WebContents was destroyed before main-world script could execute');
    }
    return userGesture === undefined
        ? wc.executeJavaScript(code)
        : wc.executeJavaScript(code, userGesture);
}
/**
 * Isolated V8 world ID used to guard and dismiss native OS/Chromium guest
 * popup widgets (`<datalist>`, `<select>`, date/time/color/file pickers)
 * without touching main-world globals or DOM prototypes.
 */
exports.POPUP_GUARD_ISOLATED_WORLD_ID = 9997;
/**
 * Blurs the deepest focused element (piercing open Shadow DOM roots and
 * same-origin `<iframe>` `contentDocument`s) in `doc` when `onlyPopupControls`
 * is `false` (tab hidden, collapsed, or disposed) or when the focused leaf is a
 * native-popup-capable control (single-select `<select>`, `<input list="...">`,
 * or date/time/color/file `<input>`).
 *
 * Plain text inputs (`<input type="text">` without `list`), inline multi-row
 * `<select multiple>` / `<select size="...">` listboxes, `<textarea>`, and
 * `[contenteditable]` editors remain focused when `onlyPopupControls` is `true`
 * so multi-step agent typing (`click` -> `keyboard.type`) and in-page editor
 * state survive across `setAgentControlling(false)` and `z=1 -> z=0` demotions
 * without stealing OS/window focus from `hubWcv`.
 */
function runGuestPopupDismissalInDocument(doc, onlyPopupControls) {
    if (!doc) {
        return false;
    }
    let leaf = doc.activeElement ?? null;
    if (!leaf || leaf === doc.body || leaf === doc.documentElement) {
        return false;
    }
    const seen = new Set();
    while (leaf && !seen.has(leaf)) {
        seen.add(leaf);
        const shadowActive = leaf.shadowRoot?.activeElement ?? null;
        if (shadowActive && shadowActive !== leaf) {
            leaf = shadowActive;
            continue;
        }
        let frameDoc = null;
        try {
            frameDoc = leaf.contentDocument ?? null;
        }
        catch {
            frameDoc = null;
        }
        const frameActive = frameDoc?.activeElement ?? null;
        if (frameDoc &&
            frameActive &&
            frameActive !== leaf &&
            frameActive !== frameDoc.body &&
            frameActive !== frameDoc.documentElement) {
            leaf = frameActive;
            continue;
        }
        break;
    }
    if (!leaf || typeof leaf.blur !== 'function') {
        return false;
    }
    if (onlyPopupControls) {
        const tag = typeof leaf.tagName === 'string' ? leaf.tagName.toUpperCase() : '';
        let isPopupControl = tag === 'SELECT' &&
            !leaf.multiple &&
            !(typeof leaf.size === 'number' && leaf.size > 1);
        if (!isPopupControl && tag === 'INPUT') {
            const hasDatalist = Boolean(leaf.hasAttribute?.('list')) || Boolean(leaf.list);
            const inputType = typeof leaf.type === 'string' ? leaf.type.toLowerCase() : '';
            const isPickerType = inputType === 'date' ||
                inputType === 'time' ||
                inputType === 'datetime-local' ||
                inputType === 'month' ||
                inputType === 'week' ||
                inputType === 'color' ||
                inputType === 'file';
            isPopupControl = hasDatalist || isPickerType;
        }
        if (!isPopupControl) {
            return false;
        }
    }
    leaf.blur();
    return true;
}
/** Builds the self-contained isolated-world script invoking `runGuestPopupDismissalInDocument`. */
function buildGuestPopupDismissalScript(onlyPopupControls) {
    return `(${runGuestPopupDismissalInDocument.toString()})(typeof document !== 'undefined' ? document : null, ${onlyPopupControls ? 'true' : 'false'})`;
}
const pendingPopupDismissals = new WeakMap();
function mergeDismissGuards(prev, next) {
    if (!prev || !next) {
        return undefined;
    }
    if (prev === next) {
        return prev;
    }
    return () => prev() || next();
}
function runIsolatedDismissNow(wc, worldId, onlyPopupControls) {
    if (typeof wc.executeJavaScriptInIsolatedWorld !== 'function') {
        return;
    }
    const script = buildGuestPopupDismissalScript(onlyPopupControls);
    try {
        void executeJavaScriptInIsolatedWorldWhenReady(wc, worldId, [{ code: script }]).catch(() => undefined);
    }
    catch {
        // Ignore synchronously torn-down WebContents.
    }
}
/**
 * Dismisses any open native Chromium/Electron popup widget (`<datalist>`
 * `AutofillPopupView`, `<select>`, or date/time/color `PagePopup`) on `wc`
 * (including nested open Shadow DOM roots and same-origin `<iframe>`s) in
 * isolated world `worldId`, coalescing calls while `isLoadingMainFrame()` is
 * true onto the shared `waitForWebContentsCanExecuteJs` listener (`O(1)`
 * listeners) and never stealing focus from `hubWcv`.
 */
function dismissNativeGuestPopups(wc, options) {
    if (!wc ||
        wc.isDestroyed?.() ||
        typeof wc.executeJavaScriptInIsolatedWorld !== 'function') {
        return;
    }
    const committedUrl = typeof wc.getURL === 'function'
        ? (wc.getURL() ?? '').trim()
        : 'about:blank';
    if (!committedUrl) {
        return;
    }
    const worldId = options?.worldId ?? exports.POPUP_GUARD_ISOLATED_WORLD_ID;
    const onlyPopupControls = options?.onlyPopupControls ?? false;
    const isLoadingMain = typeof wc.isLoadingMainFrame === 'function' &&
        Boolean(wc.isLoadingMainFrame());
    if (!isLoadingMain) {
        const pending = pendingPopupDismissals.get(wc);
        if (pending) {
            if (!onlyPopupControls || !pending.hasUnconditional) {
                pendingPopupDismissals.delete(wc);
            }
            else {
                pending.hasPopupOnly = false;
            }
        }
        runIsolatedDismissNow(wc, worldId, onlyPopupControls);
        return;
    }
    const canListen = typeof wc.on === 'function' || typeof wc.once === 'function';
    if (!canListen) {
        return;
    }
    let batch = pendingPopupDismissals.get(wc);
    const isNewBatch = !batch;
    if (!batch) {
        batch = {
            worldId,
            hasUnconditional: false,
            hasPopupOnly: false,
        };
        pendingPopupDismissals.set(wc, batch);
    }
    else {
        batch.worldId = worldId;
    }
    if (onlyPopupControls) {
        if (!batch.hasPopupOnly) {
            batch.hasPopupOnly = true;
            batch.popupOnlyGuard = options?.shouldStillDismiss;
        }
        else {
            batch.popupOnlyGuard = mergeDismissGuards(batch.popupOnlyGuard, options?.shouldStillDismiss);
        }
    }
    else {
        if (!batch.hasUnconditional) {
            batch.hasUnconditional = true;
            batch.unconditionalGuard = options?.shouldStillDismiss;
        }
        else {
            batch.unconditionalGuard = mergeDismissGuards(batch.unconditionalGuard, options?.shouldStillDismiss);
        }
    }
    if (!isNewBatch) {
        return;
    }
    void (async () => {
        while (!wc.isDestroyed?.() &&
            pendingPopupDismissals.get(wc) === batch &&
            typeof wc.isLoadingMainFrame === 'function' &&
            Boolean(wc.isLoadingMainFrame())) {
            await waitForWebContentsCanExecuteJs(wc);
        }
        if (pendingPopupDismissals.get(wc) !== batch) {
            return;
        }
        pendingPopupDismissals.delete(wc);
        if (wc.isDestroyed?.()) {
            return;
        }
        const postLoadUrl = typeof wc.getURL === 'function'
            ? (wc.getURL() ?? '').trim()
            : 'about:blank';
        if (!postLoadUrl) {
            return;
        }
        const runUnconditional = batch.hasUnconditional &&
            (!batch.unconditionalGuard || batch.unconditionalGuard());
        const runPopupOnly = !runUnconditional &&
            batch.hasPopupOnly &&
            (!batch.popupOnlyGuard || batch.popupOnlyGuard());
        if (!runUnconditional && !runPopupOnly) {
            return;
        }
        runIsolatedDismissNow(wc, batch.worldId, !runUnconditional);
    })().catch(() => {
        if (pendingPopupDismissals.get(wc) === batch) {
            pendingPopupDismissals.delete(wc);
        }
    });
}
