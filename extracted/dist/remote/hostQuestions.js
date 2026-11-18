"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostQuestions = exports.HOST_QUESTION_ARMING_MS = void 0;
/**
 * Sheets whose timing the SSH host controls (its sign-in, account and mic
 * questions), shown on its window one at a time. Electron stacks a second
 * message box on top of the first (Linux, Windows) or queues it until the
 * first closes (macOS sheets), so a click, double-click or held Return meant
 * for one would answer the next, in the same spot. So each question waits for
 * the window's earlier sheets, and takes no answer in its first
 * HOST_QUESTION_ARMING_MS, counted from when it shows.
 */
const electron_1 = require("electron");
/** As sshPromptPreload.ts: longer than a double-click or a key repeat. */
exports.HOST_QUESTION_ARMING_MS = 500;
class HostQuestions {
    constructor(deps = {}) {
        /** Each window's sheets, one at a time; it never holds an answer. */
        this.chains = new WeakMap();
        /**
         * When each window's latest sheet began showing (macOS). The page's own
         * alert() and confirm() are sheets too, outside the chain: a question
         * asked while one is up waits behind it and shows when it closes.
         */
        this.sheetBegan = new WeakMap();
        /** Questions waiting or showing, per window. */
        this.asking = new WeakMap();
        this.beforeAskListeners = new Set();
        this.showMessageBox =
            deps.showMessageBox ??
                ((win, options) => electron_1.dialog.showMessageBox(win, options));
        this.now = deps.now ?? (() => performance.now());
        this.isClosing = deps.isClosing ?? (() => false);
    }
    /**
     * Whether a host question waits or shows on `win`: e.g. a menu the page
     * pops up then could catch a click meant for it.
     */
    isBusy(win) {
        return (this.asking.get(win) ?? 0) > 0;
    }
    /**
     * Calls `listener` as each question is about to show on its window, e.g.
     * to close a menu the page popped up there. Returns its removal.
     */
    onBeforeAsk(listener) {
        this.beforeAskListeners.add(listener);
        return () => this.beforeAskListeners.delete(listener);
    }
    /**
     * Runs `show` (a sheet on `win`) once the window's earlier sheets are
     * done (at once if none is pending), and resolves or rejects as it does.
     */
    queue(win, show) {
        const pending = this.chains.get(win);
        const run = pending ? pending.then(show) : startNow(show);
        const settled = run.then(() => undefined, () => undefined);
        this.chains.set(win, settled);
        void settled.then(() => {
            if (this.chains.get(win) === settled) {
                this.chains.delete(win);
            }
        });
        return run;
    }
    /**
     * Asks `options` on `win` as its turn comes. Undefined means no answer:
     * the window was gone or closing, the signal aborted, or the answer came
     * within HOST_QUESTION_ARMING_MS of the question showing. A window that
     * starts to close, or the signal aborting, answers it at once, even while
     * it waits its turn. Rejects only if the message box does.
     */
    ask(win, options) {
        if (win.isDestroyed() ||
            this.isClosing(win) ||
            options.signal?.aborted === true) {
            return Promise.resolve(undefined);
        }
        this.asking.set(win, (this.asking.get(win) ?? 0) + 1);
        // While it waits or shows: a window that starts to close, or a drop, gets
        // no answer at once. Its turn, if still to come, then shows nothing.
        let answerNone = () => { };
        const noAnswer = new Promise((resolve) => {
            answerNone = () => resolve(undefined);
        });
        let closing = false;
        const onClose = () => {
            closing = true;
            answerNone();
        };
        win.on('close', onClose);
        options.signal?.addEventListener('abort', answerNone);
        const gone = () => closing ||
            win.isDestroyed() ||
            this.isClosing(win) ||
            options.signal?.aborted === true;
        const asked = this.queue(win, async () => {
            if (gone()) {
                return undefined;
            }
            this.followSheets(win);
            for (const listener of this.beforeAskListeners) {
                try {
                    listener(win);
                }
                catch {
                    // Its own problem: the question still shows.
                }
            }
            const askedAt = this.now();
            const answer = await this.showMessageBox(win, options);
            // It shows as it's asked, unless a sheet the page raised itself was up:
            // then it showed as a sheet began later (macOS).
            const shownAt = Math.max(askedAt, this.sheetBegan.get(win) ?? askedAt);
            // On Linux a message box outlives its window: not an answer for it.
            if (gone() || this.now() - shownAt < exports.HOST_QUESTION_ARMING_MS) {
                return undefined;
            }
            return answer;
        });
        return Promise.race([asked, noAnswer]).finally(() => {
            const left = (this.asking.get(win) ?? 1) - 1;
            if (left > 0) {
                this.asking.set(win, left);
            }
            else {
                this.asking.delete(win);
            }
            if (!win.isDestroyed()) {
                win.off('close', onClose);
            }
            options.signal?.removeEventListener('abort', answerNone);
        });
    }
    /** Notes when `win`'s sheets begin; only macOS reports them. */
    followSheets(win) {
        if (!this.sheetBegan.has(win)) {
            this.sheetBegan.set(win, -Infinity);
            win.on('sheet-begin', () => this.sheetBegan.set(win, this.now()));
        }
    }
}
exports.HostQuestions = HostQuestions;
/** Calls `show` now, with a throw as a rejection. */
function startNow(show) {
    try {
        return show();
    }
    catch (err) {
        return Promise.reject(err);
    }
}
