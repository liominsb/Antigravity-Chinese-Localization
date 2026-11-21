"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserViewerTabDriver = exports.BrowserViewerTabDriver = exports.MAX_TAB_INPUT_QUEUE_DEPTH = void 0;
/**
 * Live-tab-gated per-tab CDP input, navigation, `STOP`, and `TakeControl`
 * driver for the `browser_viewer` actuator across RPCs and `'agy-browser'`
 * DataChannel messages.
 */
const protobuf_1 = require("@bufbuild/protobuf");
const browser_viewer_pb_1 = require("../proto/browser_viewer_pb");
const wcvBrowserRegistry_1 = require("../wcvBrowserRegistry");
const wcvIpcHandlers_1 = require("../wcvIpcHandlers");
const wcvZOrderController_1 = require("../wcvZOrderController");
const browserViewerTabSnapshot_1 = require("./browserViewerTabSnapshot");
const browserViewerUrlPolicy_1 = require("./browserViewerUrlPolicy");
const capturePage_1 = require("./capturePage");
/** Maximum queued non-`'stop'` DataChannel messages per tab before dropping. */
exports.MAX_TAB_INPUT_QUEUE_DEPTH = 64;
const LONE_SURROGATE_RE = /[\ud800-\udfff]/u;
const INVALID_REQ = 'ACTUATOR_ERROR_CODE_INVALID_REQUEST';
const errRes = browserViewerTabSnapshot_1.createBrowserViewerErrorResult;
const hasLoneSurrogate = (v) => v !== undefined && LONE_SURROGATE_RE.test(v);
const matchesConversationTab = (rootId, tabKey) => (0, browserViewerUrlPolicy_1.isValidRootConversationId)(rootId) &&
    (0, browserViewerUrlPolicy_1.parseConversationTabKey)(tabKey)?.rootConversationId === rootId;
function isValidViewerInputEvent(event) {
    if (event.kind === 'keydown') {
        return (!hasLoneSurrogate(event.key) &&
            !hasLoneSurrogate(event.code) &&
            !hasLoneSurrogate(event.text));
    }
    if (event.kind === 'keyup') {
        return !hasLoneSurrogate(event.key) && !hasLoneSurrogate(event.code);
    }
    if (event.kind === 'paste') {
        return (event.text.length > 0 &&
            !event.text.includes('\0') &&
            !hasLoneSurrogate(event.text));
    }
    return true;
}
function parseControlOperation(control) {
    const noExtra = control.url === '' && control.inputEvent === undefined;
    switch (control.action) {
        case browser_viewer_pb_1.BrowserViewerControlAction.STOP:
            return noExtra ? { kind: 'stop' } : null;
        case browser_viewer_pb_1.BrowserViewerControlAction.BACK:
        case browser_viewer_pb_1.BrowserViewerControlAction.FORWARD:
            return noExtra
                ? {
                    kind: 'history',
                    direction: control.action === browser_viewer_pb_1.BrowserViewerControlAction.BACK
                        ? 'back'
                        : 'forward',
                }
                : null;
        case browser_viewer_pb_1.BrowserViewerControlAction.RELOAD:
            return noExtra ? { kind: 'reload' } : null;
        case browser_viewer_pb_1.BrowserViewerControlAction.NAVIGATE:
            return control.inputEvent === undefined &&
                typeof control.url === 'string' &&
                (0, browserViewerUrlPolicy_1.validateBrowserViewerNavigateUrl)(control.url)
                ? { kind: 'navigate', url: control.url }
                : null;
        case browser_viewer_pb_1.BrowserViewerControlAction.INPUT_EVENT: {
            const parsed = control.url === '' ? (0, browserViewerUrlPolicy_1.validateProtoInputEvent)(control.inputEvent) : null;
            return parsed ? { kind: 'input', action: (0, browserViewerUrlPolicy_1.toCdpInputAction)(parsed) } : null;
        }
        default:
            return null;
    }
}
/**
 * Serializes per-tab navigation, CDP input, `STOP`, and `TakeControl`
 * operations on live conversation tabs without rehydrating evicted tabs.
 */
class BrowserViewerTabDriver {
    constructor(opts = {}) {
        this.queues = new Map();
        const reg = opts.registry;
        this.registry = reg ?? wcvBrowserRegistry_1.wcvBrowserRegistry;
        this.snapshot =
            opts.snapshot ??
                (reg instanceof wcvBrowserRegistry_1.WcvBrowserRegistry
                    ? new browserViewerTabSnapshot_1.BrowserViewerTabSnapshotController({ registry: reg })
                    : browserViewerTabSnapshot_1.browserViewerTabSnapshot);
        this.controller = opts.controller ?? wcvZOrderController_1.wcvZOrderController;
        this.isControlLeaseActive = opts.isControlLeaseActive;
        const cReg = this.registry instanceof wcvBrowserRegistry_1.WcvBrowserRegistry ? this.registry : null;
        this.dispatchRemoteControlStop =
            opts.dispatchRemoteControlStop ??
                ((k) => cReg
                    ? (0, wcvIpcHandlers_1.dispatchWcvRemoteControlCommand)(k, 'STOP', cReg, wcvIpcHandlers_1.WCV_REMOTE_CONTROL_COMMAND_TIMEOUT_MS)
                    : Promise.resolve({
                        ok: false,
                        errorCode: 'FAILED_PRECONDITION',
                        error: 'Inactive',
                    }));
    }
    hasActiveControlLease(tabKey, callOpts) {
        if (this.isControlLeaseActive && !this.isControlLeaseActive(tabKey)) {
            return false;
        }
        return callOpts?.isControlLeaseActive
            ? callOpts.isControlLeaseActive()
            : true;
    }
    getOrCreateQueue(tabKey) {
        let q = this.queues.get(tabKey);
        if (!q) {
            q = {
                tail: Promise.resolve(),
                totalPending: 0,
                dcQueued: 0,
                dcStopQueued: false,
            };
            this.queues.set(tabKey, q);
        }
        return q;
    }
    enqueueTabTask(tabKey, queue, task) {
        queue.totalPending += 1;
        const prevTail = queue.tail;
        const run = (async () => {
            await prevTail;
            try {
                return await task();
            }
            finally {
                queue.totalPending -= 1;
                if (queue.totalPending === 0 && this.queues.get(tabKey) === queue) {
                    this.queues.delete(tabKey);
                }
            }
        })();
        queue.tail = run.then(() => undefined, () => undefined);
        return run;
    }
    tabGoneOrFailed(tabId, goneMsg, failMsg) {
        return !this.snapshot.getLiveOwnedEntry(tabId)
            ? errRes('TAB_NOT_FOUND', goneMsg)
            : errRes('FAILED_PRECONDITION', failMsg);
    }
    async runStopAndNotify(tabId) {
        let stopRes;
        try {
            stopRes = await this.dispatchRemoteControlStop(tabId);
        }
        catch (err) {
            const msg = err instanceof Error && err.message
                ? err.message
                : 'Failed to stop agent browser';
            stopRes = { ok: false, errorCode: 'FAILED_PRECONDITION', error: msg };
        }
        this.snapshot.notifyTabStateSubscribers(tabId);
        return stopRes.ok
            ? null
            : this.tabGoneOrFailed(tabId, 'Browser tab closed while stopping agent', stopRes.error || 'Failed to stop agent browser');
    }
    async dispatchInputAction(tabKey, action) {
        if (action.type === 'history') {
            this.controller.navigateGuestHistory(tabKey, action.direction);
        }
        else if (action.type === 'mouse') {
            await this.controller.dispatchMouseEvent(tabKey, action.params);
        }
        else if (action.type === 'key') {
            await this.controller.dispatchKeyEvent(tabKey, action.params);
        }
        else if (action.type === 'paste') {
            await this.controller.insertText(tabKey, action.text);
        }
    }
    async executeControlOperation(tabId, entry, op) {
        switch (op.kind) {
            case 'stop':
                return this.runStopAndNotify(tabId);
            case 'navigate':
                return (await this.controller.navigate(tabId, op.url))
                    ? null
                    : this.tabGoneOrFailed(tabId, 'Browser tab closed while navigating', 'Navigation rejected');
            case 'history':
                this.controller.navigateGuestHistory(tabId, op.direction);
                return null;
            case 'reload':
                entry.view.webContents.reload?.();
                return null;
            case 'input':
                await this.dispatchInputAction(tabId, op.action);
                return null;
        }
    }
    /**
     * Acquires remote control readiness on `tabId` by stopping/disowning any
     * active agent ownership (`USER_TAKEOVER`) and demoting local Hub elevation.
     */
    async takeControlTab(rootConversationId, tabId, onAcquired) {
        if (typeof tabId !== 'string' ||
            !matchesConversationTab(rootConversationId, tabId)) {
            return errRes(INVALID_REQ, 'Invalid takeControlTab request');
        }
        if (!this.snapshot.hasBrowserHost()) {
            return errRes('FAILED_PRECONDITION', 'No open local browser host');
        }
        const queue = this.getOrCreateQueue(tabId);
        return this.enqueueTabTask(tabId, queue, async () => {
            try {
                return await this.registry.withOperationPin(tabId, async () => {
                    const entry = this.snapshot.getLiveOwnedEntry(tabId);
                    if (!entry) {
                        return errRes('TAB_NOT_FOUND', 'Browser tab not found');
                    }
                    const needsStop = Boolean(entry.isAgentStepActive) ||
                        Boolean(this.registry.isGuestAgentOwned?.(entry.webContentsId));
                    if (needsStop) {
                        const stopErr = await this.runStopAndNotify(tabId);
                        if (stopErr) {
                            return stopErr;
                        }
                    }
                    const postEntry = this.snapshot.getLiveOwnedEntry(tabId);
                    if (!postEntry) {
                        return errRes('TAB_NOT_FOUND', 'Browser tab closed during takeControl');
                    }
                    if (postEntry.isAgentStepActive) {
                        return errRes('FAILED_PRECONDITION', 'Tab remains under active agent control');
                    }
                    this.controller.focusHub?.(tabId);
                    this.controller.demote?.(tabId, 'remote-control');
                    const tab = this.snapshot.buildBrowserTabInfo(postEntry, rootConversationId);
                    return onAcquired
                        ? await onAcquired(tab)
                        : (0, protobuf_1.create)(browser_viewer_pb_1.BrowserViewerResultSchema, { tab });
                });
            }
            catch (err) {
                const msg = err instanceof Error && err.message
                    ? err.message
                    : 'Take control failed';
                return this.tabGoneOrFailed(tabId, 'Browser tab closed during takeControl', msg);
            }
        });
    }
    /** Executes a `control_tab` RPC operation on a live conversation tab. */
    async controlTab(rootConversationId, control, callOpts) {
        if (!control ||
            typeof control !== 'object' ||
            typeof control.tabId !== 'string' ||
            !matchesConversationTab(rootConversationId, control.tabId)) {
            return errRes(INVALID_REQ, 'Invalid controlTab request');
        }
        const op = parseControlOperation(control);
        if (!op) {
            return errRes(INVALID_REQ, 'Invalid controlTab action or fields');
        }
        if (!this.snapshot.hasBrowserHost()) {
            return errRes('FAILED_PRECONDITION', 'No open local browser host');
        }
        const { tabId } = control;
        const queue = this.getOrCreateQueue(tabId);
        return this.enqueueTabTask(tabId, queue, async () => {
            try {
                return await this.registry.withOperationPin(tabId, async () => {
                    const entry = this.snapshot.getLiveOwnedEntry(tabId);
                    if (!entry) {
                        return errRes('TAB_NOT_FOUND', 'Browser tab not found');
                    }
                    if (op.kind !== 'stop') {
                        if (!this.hasActiveControlLease(tabId, callOpts)) {
                            return errRes('CONTROL_REQUIRED', 'Active control lease required');
                        }
                        if (entry.isAgentStepActive) {
                            return errRes('FAILED_PRECONDITION', 'Tab is under active agent control; stop the agent first');
                        }
                    }
                    const actionErr = await this.executeControlOperation(tabId, entry, op);
                    if (actionErr) {
                        return actionErr;
                    }
                    const postEntry = this.snapshot.getLiveOwnedEntry(tabId);
                    if (!postEntry) {
                        return errRes('TAB_NOT_FOUND', 'Browser tab closed during control action');
                    }
                    return (0, protobuf_1.create)(browser_viewer_pb_1.BrowserViewerResultSchema, {
                        tab: this.snapshot.buildBrowserTabInfo(postEntry, rootConversationId),
                    });
                });
            }
            catch (err) {
                const msg = err instanceof Error && err.message
                    ? err.message
                    : 'Browser control action failed';
                return this.tabGoneOrFailed(tabId, 'Browser tab closed during control action', msg);
            }
        });
    }
    /**
     * Validates and executes a viewer DataChannel message on a live conversation
     * tab's FIFO queue, coalescing `'stop'` frames and bounding queue depth.
     */
    async handleViewerMessage(rootConversationId, tabKey, message, callOpts) {
        if (typeof tabKey !== 'string' ||
            !matchesConversationTab(rootConversationId, tabKey) ||
            !message ||
            typeof message !== 'object') {
            return;
        }
        let rawJson;
        try {
            rawJson = JSON.stringify(message);
        }
        catch {
            return;
        }
        const normalized = typeof rawJson === 'string' ? (0, capturePage_1.parseCaptureViewerMessage)(rawJson) : null;
        const validMsg = normalized !== null &&
            (normalized.type === 'navigate'
                ? (0, browserViewerUrlPolicy_1.validateBrowserViewerNavigateUrl)(normalized.url)
                : normalized.type === 'input_event'
                    ? isValidViewerInputEvent(normalized.event)
                    : true);
        if (!normalized || !validMsg || !this.snapshot.hasBrowserHost()) {
            return;
        }
        const liveEntry = this.snapshot.getLiveOwnedEntry(tabKey);
        if (!liveEntry) {
            return;
        }
        if (normalized.type === 'stop') {
            const existingQueue = this.queues.get(tabKey);
            if (existingQueue?.dcStopQueued) {
                return;
            }
            const queue = existingQueue ?? this.getOrCreateQueue(tabKey);
            queue.dcStopQueued = true;
            await this.enqueueTabTask(tabKey, queue, async () => {
                queue.dcStopQueued = false;
                try {
                    await this.registry.withOperationPin(tabKey, async () => {
                        if (!this.snapshot.getLiveOwnedEntry(tabKey)) {
                            return;
                        }
                        try {
                            await this.dispatchRemoteControlStop(tabKey);
                        }
                        finally {
                            this.snapshot.notifyTabStateSubscribers(tabKey);
                        }
                    });
                }
                catch {
                    // Isolate DataChannel task errors so subsequent queued operations continue.
                }
            });
            return;
        }
        if (liveEntry.isAgentStepActive ||
            !this.hasActiveControlLease(tabKey, callOpts)) {
            return;
        }
        const existingQueue = this.queues.get(tabKey);
        if (existingQueue && existingQueue.dcQueued >= exports.MAX_TAB_INPUT_QUEUE_DEPTH) {
            return;
        }
        const queue = existingQueue ?? this.getOrCreateQueue(tabKey);
        queue.dcQueued += 1;
        await this.enqueueTabTask(tabKey, queue, async () => {
            queue.dcQueued -= 1;
            try {
                await this.registry.withOperationPin(tabKey, async () => {
                    const entry = this.snapshot.getLiveOwnedEntry(tabKey);
                    if (!entry ||
                        Boolean(entry.isAgentStepActive) ||
                        !this.hasActiveControlLease(tabKey, callOpts)) {
                        return;
                    }
                    if (normalized.type === 'navigate') {
                        await this.controller.navigate(tabKey, normalized.url);
                    }
                    else if (normalized.type === 'back' ||
                        normalized.type === 'forward') {
                        this.controller.navigateGuestHistory(tabKey, normalized.type);
                    }
                    else if (normalized.type === 'reload') {
                        entry.view.webContents.reload?.();
                    }
                    else {
                        await this.dispatchInputAction(tabKey, (0, browserViewerUrlPolicy_1.toCdpInputAction)(normalized.event));
                    }
                });
            }
            catch {
                // Isolate DataChannel task errors so subsequent queued operations continue.
            }
        });
    }
}
exports.BrowserViewerTabDriver = BrowserViewerTabDriver;
exports.browserViewerTabDriver = new BrowserViewerTabDriver();
