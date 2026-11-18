"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNewerRelease = isNewerRelease;
/**
 * Whether `candidate` is a release strictly newer than the release `than`,
 * to decide whether this Hub replaces its SSH host's server. Releases are
 * dotted numbers, not all zero: dev builds' 0.0.0 and anything else (dev-*,
 * 1.2.3-beta) never compare.
 */
function isNewerRelease(candidate, than) {
    const a = releaseParts(candidate);
    const b = releaseParts(than);
    if (!a || !b) {
        return false;
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const order = (a[i] ?? 0n) - (b[i] ?? 0n);
        if (order !== 0n) {
            return order > 0n;
        }
    }
    return false;
}
/** Its numbers, if `version` is a release: BigInts, so no part rounds. */
function releaseParts(version) {
    if (!/^\d{1,32}(?:\.\d{1,32}){0,7}$/.test(version)) {
        return undefined;
    }
    const parts = version.split('.').map(BigInt);
    return parts.some((p) => p !== 0n) ? parts : undefined;
}
