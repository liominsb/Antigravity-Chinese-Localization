"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureSessionDeviceChooser = exports.deviceChooserController = exports.CHOOSER_SAFETY_TIMEOUT_MS = exports.CLAIM_TIMEOUT_MS = exports.WEBVIEW_DEVICE_CHOOSER_SUBSCRIBER_STATE_CHANNEL = exports.WEBVIEW_DEVICE_CHOOSER_RESPONSE_CHANNEL = exports.WEBVIEW_DEVICE_CHOOSER_EVENT_CHANNEL = void 0;
exports.createDeviceChooserController = createDeviceChooserController;
exports.createDeviceChooserSessionConfigurator = createDeviceChooserSessionConfigurator;
const electron_1 = require("electron");
const utils_1 = require("./utils");
exports.WEBVIEW_DEVICE_CHOOSER_EVENT_CHANNEL = 'webview:device-chooser-event';
exports.WEBVIEW_DEVICE_CHOOSER_RESPONSE_CHANNEL = 'webview:device-chooser-response';
exports.WEBVIEW_DEVICE_CHOOSER_SUBSCRIBER_STATE_CHANNEL = 'webview:device-chooser-subscriber-state';
exports.CLAIM_TIMEOUT_MS = 500;
exports.CHOOSER_SAFETY_TIMEOUT_MS = 5 * 60000;
const KIND_NOUNS = {
    hid: 'HID 设备',
    usb: 'USB 设备',
    serial: '串行端口',
};
const hex4 = (n) => n.toString(16).padStart(4, '0');
const hidItem = (d) => ({
    id: d.deviceId,
    label: `${d.name?.trim() || 'Unknown device'} (${hex4(d.vendorId)}:${hex4(d.productId)})`,
});
const usbItem = (d) => ({
    id: d.deviceId,
    label: `${d.productName ?? 'Unknown device'} (${hex4(d.vendorId)}:${hex4(d.productId)})`,
});
const serialItem = (p) => ({
    id: p.portId,
    label: p.displayName ?? p.portName,
});
const matchesHost = (a, b) => Boolean(a && b && (a === b || (typeof b.id === 'number' && a.id === b.id)));
function sendEvent(host, payload) {
    if (host && !host.isDestroyed()) {
        try {
            host.send(exports.WEBVIEW_DEVICE_CHOOSER_EVENT_CHANNEL, payload);
        }
        catch {
            // Ignore dead renderer frames during teardown.
        }
    }
}
function subscribeHotPlug(s, kind, ownerId, fromFrame, onChange) {
    if (kind === 'hid') {
        const fn = (present) => (_e, d) => {
            if (d.frame && fromFrame(d.frame)?.id === ownerId) {
                onChange(hidItem(d.device), present);
            }
        };
        const [add, rem] = [fn(true), fn(false)];
        s.on('hid-device-added', add);
        s.on('hid-device-removed', rem);
        return () => {
            s.off('hid-device-added', add);
            s.off('hid-device-removed', rem);
        };
    }
    if (kind === 'usb') {
        const fn = (present) => (_e, d, wc) => {
            if (wc?.id === ownerId) {
                onChange(usbItem(d), present);
            }
        };
        const [add, rem] = [fn(true), fn(false)];
        s.on('usb-device-added', add);
        s.on('usb-device-removed', rem);
        return () => {
            s.off('usb-device-added', add);
            s.off('usb-device-removed', rem);
        };
    }
    const fn = (present) => (_e, p, wc) => {
        if (wc?.id === ownerId) {
            onChange(serialItem(p), present);
        }
    };
    const [add, rem] = [fn(true), fn(false)];
    s.on('serial-port-added', add);
    s.on('serial-port-removed', rem);
    return () => {
        s.off('serial-port-added', add);
        s.off('serial-port-removed', rem);
    };
}
/**
 * Coordinates WebHID, WebUSB, and Web Serial selection across subscribed Hub
 * renderers, falling back to a native message box when unclaimed.
 */
function createDeviceChooserController(options) {
    const configuredSessions = new WeakSet();
    const subscribedHosts = new Map();
    const activeByRequestId = new Map();
    const activeByOwnerId = new Map();
    let nextSeq = 0;
    let hostResolver = options?.hostResolver;
    const isHeadless = options?.isHeadless ??
        (() => process.env.ELECTRON_OZONE_PLATFORM_HINT === 'headless');
    const getParentWindow = options?.getParentWindow ??
        (() => (0, utils_1.getFocusedHubWindow)() ?? (0, utils_1.getHubWindows)()[0] ?? null);
    const showMessageBox = options?.showMessageBox ??
        ((win, boxOpts) => electron_1.dialog.showMessageBox(win, boxOpts));
    const fromFrame = options?.webContentsFromFrame ??
        ((frame) => {
            try {
                return electron_1.webContents.fromFrame(frame);
            }
            catch {
                return undefined;
            }
        });
    const claimTimeoutMs = options?.claimTimeoutMs ?? exports.CLAIM_TIMEOUT_MS;
    const safetyTimeoutMs = options?.safetyTimeoutMs ?? exports.CHOOSER_SAFETY_TIMEOUT_MS;
    const dropHost = (host, notifyClose) => {
        const rec = subscribedHosts.get(host.id);
        if (rec) {
            subscribedHosts.delete(host.id);
            rec.detach();
        }
        for (const entry of [...activeByRequestId.values()]) {
            if (matchesHost(entry.hostSender, host)) {
                entry.settle(undefined, notifyClose);
            }
        }
    };
    const setHostSubscribed = (host, subscribed) => {
        if (!host) {
            return;
        }
        if (!subscribed) {
            dropHost(host, true);
            return;
        }
        if (host.isDestroyed() || subscribedHosts.get(host.id)?.sender === host) {
            return;
        }
        subscribedHosts.get(host.id)?.detach();
        const onLost = () => dropHost(host, false);
        host.on?.('destroyed', onLost);
        host.on?.('render-process-gone', onLost);
        host.on?.('did-navigate', onLost);
        subscribedHosts.set(host.id, {
            sender: host,
            detach: () => {
                host.removeListener?.('destroyed', onLost);
                host.removeListener?.('render-process-gone', onLost);
                host.removeListener?.('did-navigate', onLost);
            },
        });
    };
    const cancelForGuest = (webContentsId) => {
        activeByOwnerId.get(webContentsId)?.settle(undefined, true);
    };
    const startRequest = (targetSession, kind, owner, origin, devices, respondToElectron) => {
        const wcv = hostResolver?.(owner.id) ?? null;
        if (wcv && (!wcv.visible || wcv.isAgentStepActive)) {
            cancelForGuest(owner.id);
            respondToElectron(undefined);
            return;
        }
        const hostCtx = wcv
            ? { hostSender: wcv.hostSender, tabKey: wcv.tabKey }
            : owner.hostWebContents && !owner.hostWebContents.isDestroyed()
                ? { hostSender: owner.hostWebContents, tabKey: undefined }
                : null;
        cancelForGuest(owner.id);
        const requestId = `device-chooser-${++nextSeq}`;
        const pending = [...devices];
        let settled = false;
        let inFallback = false;
        let refreshRequested = false;
        let fallbackController = new AbortController();
        let claimTimer;
        let safetyTimer;
        const inPaneHost = hostCtx &&
            !hostCtx.hostSender.isDestroyed() &&
            subscribedHosts.has(hostCtx.hostSender.id)
            ? hostCtx.hostSender
            : undefined;
        let unsubscribeHotPlug = () => { };
        const clearTimers = () => {
            clearTimeout(claimTimer);
            clearTimeout(safetyTimer);
            claimTimer = safetyTimer = undefined;
        };
        const hasOwnerOn = typeof owner.on === 'function';
        const onOwnerAbort = () => settle(undefined, true);
        function settle(deviceId, notifyHostClose = false) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimers();
            const wasInPane = activeByRequestId.delete(requestId);
            if (activeByOwnerId.get(owner.id) === entry) {
                activeByOwnerId.delete(owner.id);
            }
            unsubscribeHotPlug();
            owner.removeListener('destroyed', onOwnerAbort);
            if (hasOwnerOn) {
                owner.removeListener('did-navigate', onOwnerAbort);
                owner.removeListener('render-process-gone', onOwnerAbort);
            }
            fallbackController.abort();
            if (notifyHostClose && wasInPane) {
                sendEvent(inPaneHost, { type: 'close', requestId });
            }
            respondToElectron(deviceId);
        }
        const runNativeFallback = async () => {
            if (settled) {
                return;
            }
            const win = (0, utils_1.resolveHubWindowFromWebContents)(owner) ?? getParentWindow();
            if (!win || win.isDestroyed?.()) {
                settle(undefined, false);
                return;
            }
            inFallback = true;
            try {
                for (;;) {
                    const snapshot = Object.freeze([...pending]);
                    refreshRequested = false;
                    fallbackController = new AbortController();
                    const cancelId = snapshot.length;
                    const { response } = await showMessageBox(win, {
                        type: 'question',
                        title: '连接设备',
                        message: `${origin} wants to connect to a ${KIND_NOUNS[kind]}`,
                        detail: cancelId
                            ? 'Select a device:'
                            : 'No compatible devices found.',
                        buttons: [...snapshot.map(({ label }) => label), '取消'],
                        cancelId,
                        defaultId: cancelId,
                        signal: fallbackController.signal,
                    });
                    if (settled) {
                        return;
                    }
                    if (refreshRequested &&
                        response === cancelId &&
                        !owner.isDestroyed() &&
                        !win.isDestroyed?.()) {
                        continue;
                    }
                    settle(snapshot[response]?.id, false);
                    return;
                }
            }
            catch (err) {
                if (!settled) {
                    console.warn('[DeviceChooser] Failed to choose a device:', err);
                    settle(undefined, false);
                }
            }
        };
        const entry = {
            hostSender: inPaneHost,
            claimed: false,
            pending,
            clearClaimTimer: () => {
                clearTimeout(claimTimer);
                claimTimer = undefined;
            },
            severToFallback: () => {
                if (settled || !activeByRequestId.delete(requestId)) {
                    return;
                }
                clearTimers();
                sendEvent(inPaneHost, { type: 'close', requestId });
                void runNativeFallback();
            },
            settle,
        };
        unsubscribeHotPlug = subscribeHotPlug(targetSession, kind, owner.id, fromFrame, (device, present) => {
            if (settled) {
                return;
            }
            const idx = pending.findIndex(({ id }) => id === device.id);
            if (!present && idx < 0) {
                return;
            }
            if (present) {
                if (idx >= 0) {
                    pending[idx] = device;
                }
                else {
                    pending.push(device);
                }
            }
            else {
                pending.splice(idx, 1);
            }
            if (activeByRequestId.has(requestId)) {
                sendEvent(inPaneHost, {
                    type: 'update',
                    requestId,
                    devices: [...pending],
                });
            }
            else if (inFallback) {
                refreshRequested = true;
                fallbackController.abort();
            }
        });
        owner.once('destroyed', onOwnerAbort);
        if (hasOwnerOn) {
            owner.on('did-navigate', onOwnerAbort);
            owner.on('render-process-gone', onOwnerAbort);
        }
        if (settled) {
            return;
        }
        activeByOwnerId.set(owner.id, entry);
        if (inPaneHost && hostCtx) {
            activeByRequestId.set(requestId, entry);
            sendEvent(inPaneHost, {
                type: 'open',
                requestId,
                webContentsId: owner.id,
                ...(hostCtx.tabKey ? { tabKey: hostCtx.tabKey } : {}),
                kind,
                origin,
                devices: [...pending],
            });
            claimTimer = setTimeout(() => {
                if (!entry.claimed) {
                    entry.severToFallback();
                }
            }, claimTimeoutMs);
            safetyTimer = setTimeout(() => settle(undefined, true), safetyTimeoutMs);
            return;
        }
        void runNativeFallback();
    };
    const configureSession = (targetSession) => {
        if (!targetSession ||
            typeof targetSession.on !== 'function' ||
            configuredSessions.has(targetSession)) {
            return;
        }
        configuredSessions.add(targetSession);
        const onFrameDevice = (details, cb, kind, toItem) => {
            const owner = details.frame ? fromFrame(details.frame) : undefined;
            if (!details.frame || !owner || owner.isDestroyed() || isHeadless()) {
                cb();
                return;
            }
            startRequest(targetSession, kind, owner, details.frame.origin, details.deviceList.map(toItem), (id) => (id === undefined ? cb() : cb(id)));
        };
        targetSession.on('select-hid-device', (event, details, cb) => {
            event.preventDefault();
            onFrameDevice(details, cb, 'hid', hidItem);
        });
        targetSession.on('select-usb-device', (event, details, cb) => {
            event.preventDefault();
            onFrameDevice(details, cb, 'usb', usbItem);
        });
        targetSession.on('select-serial-port', (event, portList, owner, cb) => {
            event.preventDefault();
            if (!owner || owner.isDestroyed() || !owner.mainFrame || isHeadless()) {
                cb('');
                return;
            }
            startRequest(targetSession, 'serial', owner, owner.mainFrame.origin, portList.map(serialItem), (id) => cb(id ?? ''));
        });
    };
    return {
        configureSession,
        setHostSubscribed,
        respond: (callerSender, requestId, resolution) => {
            const entry = activeByRequestId.get(requestId);
            if (!entry || !matchesHost(entry.hostSender, callerSender)) {
                return false;
            }
            if (resolution.action === 'claim') {
                entry.clearClaimTimer();
                entry.claimed = true;
                return true;
            }
            if (resolution.action === 'unclaimed') {
                if (entry.claimed) {
                    return false;
                }
                entry.severToFallback();
                return true;
            }
            if (resolution.action === 'cancel') {
                entry.settle(undefined, false);
                return true;
            }
            if (resolution.action === 'select' &&
                typeof resolution.deviceId === 'string' &&
                resolution.deviceId.length > 0) {
                const matched = entry.pending.some(({ id }) => id === resolution.deviceId);
                entry.settle(matched ? resolution.deviceId : undefined, false);
                return matched;
            }
            return false;
        },
        cancelForGuest,
        setHostResolver: (resolver) => {
            hostResolver = resolver;
        },
    };
}
function createDeviceChooserSessionConfigurator(options) {
    return createDeviceChooserController(options).configureSession;
}
exports.deviceChooserController = createDeviceChooserController();
exports.configureSessionDeviceChooser = exports.deviceChooserController.configureSession;
