"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGuestAgentControlPredicate = registerGuestAgentControlPredicate;
exports.registerGuestAgentOwnershipPredicate = registerGuestAgentOwnershipPredicate;
exports.isGuestAgentOwned = isGuestAgentOwned;
exports.onGuestAgentControlArmed = onGuestAgentControlArmed;
exports.notifyGuestAgentControlArmed = notifyGuestAgentControlArmed;
exports.isGuestAgentControlled = isGuestAgentControlled;
const predicates = new Set();
const armedListeners = new Set();
function isValidWebContentsId(webContentsId) {
    return (typeof webContentsId === 'number' &&
        Number.isInteger(webContentsId) &&
        webContentsId > 0);
}
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
const ownershipPredicates = new Set();
/**
 * Registers a predicate consulted by {@link isGuestAgentOwned}: the guest
 * belongs to an agent, between steps too (for example a tab the agent pinned).
 * Returns an idempotent callback that removes the registration.
 */
function registerGuestAgentOwnershipPredicate(predicate) {
    ownershipPredicates.add(predicate);
    return () => {
        ownershipPredicates.delete(predicate);
    };
}
/**
 * Returns `true` when `webContentsId` is agent-controlled right now
 * ({@link isGuestAgentControlled}) or owned by an agent between its steps.
 * Policies that must hold for the agent's whole session (such as signing out
 * cross-site frames) use this; per-step policies use
 * {@link isGuestAgentControlled}.
 */
function isGuestAgentOwned(webContentsId) {
    if (isGuestAgentControlled(webContentsId)) {
        return true;
    }
    for (const predicate of ownershipPredicates) {
        try {
            if (predicate(webContentsId)) {
                return true;
            }
        }
        catch {
            // Ignore predicates throwing on tearing-down guests.
        }
    }
    return false;
}
/**
 * Subscribes to notifications emitted when active agent control is (re)asserted
 * on a guest; listeners must be idempotent. Returns an idempotent unsubscribe
 * callback.
 */
function onGuestAgentControlArmed(listener) {
    armedListeners.add(listener);
    return () => {
        armedListeners.delete(listener);
    };
}
/**
 * Notifies registered {@link onGuestAgentControlArmed} listeners that active
 * agent control is (re)asserted on guest `webContentsId`; listeners must be
 * idempotent.
 */
function notifyGuestAgentControlArmed(webContentsId) {
    if (!isValidWebContentsId(webContentsId)) {
        return;
    }
    for (const listener of [...armedListeners]) {
        try {
            listener(webContentsId);
        }
        catch {
            // Ignore listener errors so remaining subscribers still run.
        }
    }
}
/**
 * Returns `true` when `webContentsId` is a positive integer marked as
 * agent-controlled by at least one registered predicate.
 */
function isGuestAgentControlled(webContentsId) {
    if (!isValidWebContentsId(webContentsId)) {
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
