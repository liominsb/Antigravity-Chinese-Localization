"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComputerDriverError = void 0;
/** A failed driver call. Its message reaches the model as is. */
class ComputerDriverError extends Error {
    constructor(code, message, options) {
        super(message);
        this.code = code;
        this.name = 'ComputerDriverError';
        this.blockedHost = options?.blockedHost;
        this.appId = options?.appId;
        this.reason = options?.reason;
    }
}
exports.ComputerDriverError = ComputerDriverError;
