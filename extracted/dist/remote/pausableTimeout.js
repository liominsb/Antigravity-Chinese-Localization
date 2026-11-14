"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PausableTimeout = void 0;
/** A timeout whose clock stops while paused. */
class PausableTimeout {
    constructor(fire, left) {
        this.fire = fire;
        this.left = left;
        this.since = 0;
        this.done = false;
        this.resume();
    }
    pause() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
            // The clock setTimeout uses: wall-clock steps don't count.
            this.left -= performance.now() - this.since;
        }
    }
    resume() {
        if (!this.timer && !this.done) {
            this.since = performance.now();
            this.timer = setTimeout(() => {
                this.clear();
                this.fire();
            }, this.left);
        }
    }
    clear() {
        this.done = true;
        clearTimeout(this.timer);
        this.timer = undefined;
    }
}
exports.PausableTimeout = PausableTimeout;
