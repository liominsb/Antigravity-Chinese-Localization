"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WINDOW_URL = void 0;
exports.silenceConsole = silenceConsole;
/**
 * Shared test helpers and utilities.
 *
 * For module mocks (electron, electron-updater), use the auto-mock files
 * in `src/__mocks__/` instead. This file is for runtime helpers that
 * are called in beforeEach/afterEach blocks.
 */
const vitest_1 = require("vitest");
const constants_1 = require("../constants");
exports.DEFAULT_WINDOW_URL = `${constants_1.WINDOW_ORIGIN}:${constants_1.DYNAMIC_PORT}/`;
/**
 * Silence console output during tests. Call in `beforeEach`.
 * Restoring is handled by `vi.restoreAllMocks()` in `afterEach`.
 */
function silenceConsole() {
    vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
    vitest_1.vi.spyOn(console, 'warn').mockImplementation(() => { });
    vitest_1.vi.spyOn(console, 'error').mockImplementation(() => { });
}
