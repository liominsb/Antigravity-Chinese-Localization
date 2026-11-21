"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.watchScreenLock = watchScreenLock;
/**
 * Reports whether the Mac's screen is locked: now, then on every change.
 * Like the helper's screenLocked(), a session switched away from (fast user
 * switching) counts as locked. Returns the unsubscribe.
 */
function watchScreenLock(pm, onChange) {
    const listeners = [
        ['lock-screen', () => onChange(true)],
        ['unlock-screen', () => onChange(false)],
        ['user-did-resign-active', () => onChange(true)],
        // Switching back may land on the lock screen: unlocked only if it isn't.
        [
            'user-did-become-active',
            () => onChange(pm.getSystemIdleState(1) === 'locked'),
        ],
    ];
    for (const [e, l] of listeners) {
        pm.on(e, l);
    }
    onChange(pm.getSystemIdleState(1) === 'locked');
    return () => {
        for (const [e, l] of listeners) {
            pm.removeListener(e, l);
        }
    };
}
