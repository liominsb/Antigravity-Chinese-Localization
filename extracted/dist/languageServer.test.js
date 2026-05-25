"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const child_process_1 = require("child_process");
vitest_1.vi.mock('electron', () => ({
    app: {
        isPackaged: false,
    },
}));
vitest_1.vi.mock('child_process', async () => {
    return {
        execFile: vitest_1.vi.fn(),
        spawn: vitest_1.vi.fn(),
    };
});
const languageServer_1 = require("./languageServer");
(0, vitest_1.describe)('extractCrashStackTrace', () => {
    (0, vitest_1.it)('should extract lines after "running GoogleExitFunction"', () => {
        const stderr = [
            'INFO: server starting',
            'INFO: listening on port 5387',
            'running GoogleExitFunction',
            'goroutine 1 [running]:',
            'main.main()',
        ].join('\n');
        const result = (0, languageServer_1.extractCrashStackTrace)(stderr);
        (0, vitest_1.expect)(result).toContain('running GoogleExitFunction');
        (0, vitest_1.expect)(result).toContain('goroutine 1 [running]:');
        (0, vitest_1.expect)(result).toContain('main.main()');
        (0, vitest_1.expect)(result).not.toContain('server starting');
    });
    (0, vitest_1.it)('should extract lines after "http2: panic serving"', () => {
        const stderr = [
            'INFO: normal log',
            'http2: panic serving 127.0.0.1:443',
            'runtime error: invalid memory address',
        ].join('\n');
        const result = (0, languageServer_1.extractCrashStackTrace)(stderr);
        (0, vitest_1.expect)(result).toContain('http2: panic serving');
        (0, vitest_1.expect)(result).toContain('runtime error');
        (0, vitest_1.expect)(result).not.toContain('normal log');
    });
    (0, vitest_1.it)('should return undefined when no crash trigger is found', () => {
        const stderr = [
            'INFO: server starting',
            'INFO: listening on port 5387',
            'INFO: server shutting down',
        ].join('\n');
        const result = (0, languageServer_1.extractCrashStackTrace)(stderr);
        (0, vitest_1.expect)(result).toBeUndefined();
    });
    (0, vitest_1.it)('should return undefined for empty stderr', () => {
        (0, vitest_1.expect)((0, languageServer_1.extractCrashStackTrace)('')).toBeUndefined();
    });
});
(0, vitest_1.describe)('getLsCL', () => {
    (0, vitest_1.it)('should return CL number when stamp output contains it', async () => {
        const mockExecFile = child_process_1.execFile;
        mockExecFile.mockImplementation((file, args, callback) => {
            callback(null, 'Built at CL: 12345\n', '');
        });
        const cl = await (0, languageServer_1.getLsCL)();
        (0, vitest_1.expect)(cl).toBe('12345');
    });
    (0, vitest_1.it)('should return empty string when stamp output does not contain CL', async () => {
        const mockExecFile = child_process_1.execFile;
        mockExecFile.mockImplementation((file, args, callback) => {
            callback(null, 'Built on: today\n', '');
        });
        const cl = await (0, languageServer_1.getLsCL)();
        (0, vitest_1.expect)(cl).toBe('');
    });
    (0, vitest_1.it)('should return empty string when execFile fails', async () => {
        const mockExecFile = child_process_1.execFile;
        mockExecFile.mockImplementation((file, args, callback) => {
            callback(new Error('fail'), '', '');
        });
        const cl = await (0, languageServer_1.getLsCL)();
        (0, vitest_1.expect)(cl).toBe('');
    });
});
