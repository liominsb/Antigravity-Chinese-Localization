"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGuestAgentControlPredicate = registerGuestAgentControlPredicate;
exports.isGuestAgentControlled = isGuestAgentControlled;
const predicates = new Set();
/**
 * Registers a predicate consulted by {@link isGuestAgentControlled} and returns
 * an idempotent callback that removes the registration.
 */
function registerGuestAgentControlPredicate(predicate) {
    predicates.add(predicate);
    return () => {
        predicates.delete(predicate);
    };
}
/**
 * Returns `true` when `webContentsId` is a positive integer marked as
 * agent-controlled by at least one registered predicate.
 */
function isGuestAgentControlled(webContentsId) {
    if (typeof webContentsId !== 'number' ||
        !Number.isInteger(webContentsId) ||
        webContentsId <= 0) {
        return false;
    }
    for (const predicate of predicates) {
        try {
            if (predicate(webContentsId)) {
                return true;
            }
        }
        catch {
            // Ignore predicates throwing on tearing-down guests so remaining predicates still run.
        }
    }
    return false;
}
