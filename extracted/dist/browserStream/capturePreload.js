"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROWSER_STREAM_EVENT_CHANNEL = exports.BROWSER_STREAM_ACK_CHANNEL = exports.BROWSER_STREAM_COMMAND_CHANNEL = void 0;
exports.createCapturePreloadBridge = createCapturePreloadBridge;
/**
 * Sandboxed preload bridge for `agy-browser-stream://capture/`.
 * Uses `import type` only from `./capturePage` so CommonJS emits zero relative
 * `require` calls under `sandbox: true`.
 */
const electron_1 = require("electron");
exports.BROWSER_STREAM_COMMAND_CHANNEL = 'agy-browser-stream:command';
exports.BROWSER_STREAM_ACK_CHANNEL = 'agy-browser-stream:ack';
exports.BROWSER_STREAM_EVENT_CHANNEL = 'agy-browser-stream:event';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Builds the `window.agyBrowserCapture` bridge over narrow IPC channels. */
function createCapturePreloadBridge(ipc) {
    return {
        onCommand: (handler) => {
            if (typeof handler !== 'function') {
                return () => { };
            }
            let active = true;
            const fn = (_e, p) => {
                if (active && isObj(p)) {
                    handler(p);
                }
            };
            ipc.on(exports.BROWSER_STREAM_COMMAND_CHANNEL, fn);
            return () => {
                if (active) {
                    active = false;
                    ipc.removeListener(exports.BROWSER_STREAM_COMMAND_CHANNEL, fn);
                }
            };
        },
        ackCommand: (ack) => {
            if (isObj(ack)) {
                ipc.send(exports.BROWSER_STREAM_ACK_CHANNEL, ack);
            }
        },
        sendEvent: (event) => {
            if (isObj(event)) {
                ipc.send(exports.BROWSER_STREAM_EVENT_CHANNEL, event);
            }
        },
    };
}
const win = globalThis.window;
if ((process.type === 'renderer' ||
    (typeof win === 'object' && win !== null)) &&
    typeof electron_1.contextBridge?.exposeInMainWorld === 'function' &&
    typeof electron_1.ipcRenderer?.on === 'function' &&
    typeof electron_1.ipcRenderer?.removeListener === 'function' &&
    typeof electron_1.ipcRenderer?.send === 'function') {
    electron_1.contextBridge.exposeInMainWorld('agyBrowserCapture', createCapturePreloadBridge({
        on: electron_1.ipcRenderer.on.bind(electron_1.ipcRenderer),
        removeListener: electron_1.ipcRenderer.removeListener.bind(electron_1.ipcRenderer),
        send: electron_1.ipcRenderer.send.bind(electron_1.ipcRenderer),
    }));
}
