"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPrivate = checkPrivate;
exports.makePrivateDir = makePrivateDir;
/**
 * Private dirs for one connection's files (askpass's socket, a copy of an SSH
 * config file), in a base where only this user can add entries: shared /tmp
 * isn't one.
 */
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const types_1 = require("./types");
/** Why `base`, whose real path is `real` ('' if none), can't be a base. */
async function unfitBase(base, real) {
    if (!path.isAbsolute(base)) {
        return 'not an absolute path';
    }
    const stat = real
        ? await fs.promises.stat(real).catch(() => undefined)
        : undefined;
    if (!stat?.isDirectory()) {
        return 'missing, or not a folder';
    }
    if (stat.uid !== process.getuid?.()) {
        return 'not yours';
    }
    return (stat.mode & 0o022) === 0 ? undefined : 'others can write to it';
}
/**
 * `dir`'s real path ('' if none), and why it isn't private, if it isn't: a
 * folder of this user's that no one else can add entries to.
 */
async function checkPrivate(dir) {
    // Its entries then go where the checks looked, not through a link.
    const real = path.isAbsolute(dir)
        ? await fs.promises.realpath(dir).catch(() => '')
        : '';
    return { real, why: await unfitBase(dir, real) };
}
/**
 * A new 0700 dir in the first private base (XDG_RUNTIME_DIR, then macOS's
 * per-user temp dir, then `userDataDir`) where `misfit`, given the new dir's
 * path, finds nothing wrong. Rejects with a RemoteError saying it can't do
 * `purpose`, and why it skipped each base.
 */
async function makePrivateDir(userDataDir, purpose, misfit) {
    const skipped = [];
    for (const base of [
        process.env.XDG_RUNTIME_DIR,
        process.platform === 'darwin' ? os.tmpdir() : undefined,
        userDataDir,
    ]) {
        if (!base) {
            continue;
        }
        const checked = await checkPrivate(base);
        const { real } = checked;
        // mkdtemp replaces the Xs with as many letters and digits.
        const why = checked.why ?? misfit(path.join(real, 'agy-ssh-XXXXXX'));
        if (why === undefined) {
            return fs.promises.mkdtemp(path.join(real, 'agy-ssh-'));
        }
        skipped.push(`${base}: ${why}`);
    }
    throw new types_1.RemoteError('UNKNOWN', `Can't ${purpose}: no private folder to use (${skipped.join('; ')}).`);
}
