"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginShellEnvReads = void 0;
/**
 * Login shell environment reads (loginShellEnv.ts) that callers share. Each
 * caller waits at most LOGIN_SHELL_ENV_WAIT_SEC: a read still running then
 * answers a later caller. A failed read is read again by the next one.
 * TODO(nathanjuan): One reader for LS starts and SSH connects, kept until an
 * LS restart calls refresh(): one login shell at startup, not two.
 */
const loginShellEnv_1 = require("./loginShellEnv");
const loginShellPolicy_1 = require("./loginShellPolicy");
class LoginShellEnvReads {
    /**
     * @param keep Whether a read answers every later caller (SSH connects, so
     *   that no connect waits for the rc files again), or only the next one (LS
     *   starts, so that a restart picks up rc edits).
     */
    constructor(keep) {
        this.keep = keep;
    }
    /** Starts a read for the next caller, unless one is under way. */
    prefetch() {
        this.read ?? (this.read = this.start());
    }
    /** The environment; `{}` if it can't be read, or not within the wait. */
    async take() {
        const read = (this.read ?? (this.read = this.start()));
        const env = await waitAtMost(read.env);
        if (!this.keep && read.done && this.read === read) {
            this.read = undefined;
        }
        return env ?? {};
    }
    start() {
        const read = { env: (0, loginShellEnv_1.loadLoginShellEnv)(), done: false };
        void read.env.then((env) => {
            read.done = true;
            if (!env && this.read === read) {
                this.read = undefined;
            }
        });
        return read;
    }
}
exports.LoginShellEnvReads = LoginShellEnvReads;
async function waitAtMost(read) {
    let timer;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve('late'), loginShellPolicy_1.LOGIN_SHELL_ENV_WAIT_SEC * 1000);
    });
    try {
        const env = await Promise.race([read, late]);
        if (env !== 'late') {
            return env;
        }
        console.warn(`No login shell environment within ${loginShellPolicy_1.LOGIN_SHELL_ENV_WAIT_SEC} s: going on without it, and a later read may use it`);
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
