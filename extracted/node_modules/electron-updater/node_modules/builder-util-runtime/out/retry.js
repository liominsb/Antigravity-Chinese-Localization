"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry = retry;
const CancellationToken_1 = require("./CancellationToken");
async function retry(task, options) {
    var _a;
    const { retries: retryCount, interval, backoff = 0, attempt = 0, shouldRetry, cancellationToken = new CancellationToken_1.CancellationToken() } = options;
    try {
        return await task();
    }
    catch (error) {
        if ((await Promise.resolve((_a = shouldRetry === null || shouldRetry === void 0 ? void 0 : shouldRetry(error)) !== null && _a !== void 0 ? _a : true)) && retryCount > 0 && !cancellationToken.cancelled) {
            await new Promise(resolve => setTimeout(resolve, interval + backoff * attempt));
            return await retry(task, { ...options, retries: retryCount - 1, attempt: attempt + 1 });
        }
        else {
            throw error;
        }
    }
}
//# sourceMappingURL=retry.js.map