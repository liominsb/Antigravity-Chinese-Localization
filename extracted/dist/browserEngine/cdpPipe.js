"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdpPipeConnection = exports.CdpError = void 0;
const events_1 = require("events");
/** Thrown for CDP error responses and for calls cut off by disconnect. */
class CdpError extends Error {
    constructor(method, message, code) {
        super(`${method}: ${message}`);
        this.method = method;
        this.code = code;
        this.name = 'CdpError';
    }
}
exports.CdpError = CdpError;
/**
 * JSON-RPC client for Chrome's `--remote-debugging-pipe` transport: Chrome
 * reads NUL-terminated JSON messages on fd 3 and writes them on fd 4. Uses
 * flattened sessions (`sessionId` on the envelope) so one pipe carries every
 * target; no TCP endpoint exists that another local process could attach to.
 *
 * Emits `event` (CdpEvent) and, once, `disconnect` when the read side ends.
 */
class CdpPipeConnection extends events_1.EventEmitter {
    constructor(toBrowser, fromBrowser) {
        super();
        this.toBrowser = toBrowser;
        this.nextId = 1;
        this.pending = new Map();
        this.readBuffer = [];
        this.closed = false;
        fromBrowser.on('data', (chunk) => this.onData(chunk));
        fromBrowser.on('close', () => this.onDisconnect());
        fromBrowser.on('end', () => this.onDisconnect());
        fromBrowser.on('error', () => this.onDisconnect());
        toBrowser.on('close', () => this.onDisconnect());
        toBrowser.on('error', () => this.onDisconnect());
    }
    get isClosed() {
        return this.closed;
    }
    send(method, params = {}, sessionId) {
        if (this.closed) {
            return Promise.reject(new CdpError(method, 'pipe disconnected'));
        }
        const id = this.nextId++;
        const message = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params });
        return new Promise((resolve, reject) => {
            this.pending.set(id, {
                method,
                resolve: resolve,
                reject,
            });
            this.toBrowser.write(`${message}\0`);
        });
    }
    onData(chunk) {
        let start = 0;
        let end = chunk.indexOf(0);
        while (end !== -1) {
            this.readBuffer.push(chunk.subarray(start, end));
            const raw = Buffer.concat(this.readBuffer).toString('utf8');
            this.readBuffer = [];
            this.dispatch(raw);
            start = end + 1;
            end = chunk.indexOf(0, start);
        }
        if (start < chunk.length) {
            this.readBuffer.push(chunk.subarray(start));
        }
    }
    dispatch(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            console.error('[browserEngine] dropped malformed CDP frame');
            return;
        }
        if (!message || typeof message !== 'object') {
            console.error('[browserEngine] dropped malformed CDP frame');
            return;
        }
        if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (!pending) {
                return;
            }
            this.pending.delete(message.id);
            if (message.error) {
                pending.reject(new CdpError(pending.method, message.error.message, message.error.code));
            }
            else {
                pending.resolve(message.result ?? {});
            }
            return;
        }
        if (message.method) {
            const event = {
                method: message.method,
                params: message.params ?? {},
            };
            if (message.sessionId) {
                event.sessionId = message.sessionId;
            }
            this.emit('event', event);
        }
    }
    onDisconnect() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const pending of this.pending.values()) {
            pending.reject(new CdpError(pending.method, 'pipe disconnected'));
        }
        this.pending.clear();
        this.emit('disconnect');
    }
}
exports.CdpPipeConnection = CdpPipeConnection;
