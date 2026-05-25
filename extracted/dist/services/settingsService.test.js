"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const settingsService_1 = require("./settingsService");
const utils_1 = require("../utils");
vitest_1.vi.mock('../storage');
vitest_1.vi.mock('../utils');
(0, vitest_1.describe)('SettingsService', () => {
    let settingsService;
    let mockStorageManager;
    let mockSleepBlocker;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mockStorageManager = {
            getItems: vitest_1.vi.fn().mockResolvedValue({
                runInBackground: String(process.platform !== 'win32'),
                keepComputerAwake: 'false',
            }),
            onDidChange: vitest_1.vi.fn().mockReturnValue({ dispose: vitest_1.vi.fn() }),
        };
        mockSleepBlocker = {
            shouldKeepComputerAwake: vitest_1.vi.fn(),
        };
        vitest_1.vi.mocked(utils_1.SleepBlocker.getInstance).mockReturnValue(mockSleepBlocker);
        settingsService = new settingsService_1.SettingsService(mockStorageManager);
    });
    (0, vitest_1.it)('should return defaults when storage is empty', async () => {
        (0, vitest_1.expect)(await settingsService.getSetting(settingsService_1.SettingKey.RUN_IN_BACKGROUND)).toBe(true);
        (0, vitest_1.expect)(await settingsService.getSetting(settingsService_1.SettingKey.KEEP_COMPUTER_AWAKE)).toBe(false);
    });
    (0, vitest_1.it)('should return values from storage', async () => {
        mockStorageManager.getItems.mockResolvedValue({
            runInBackground: 'false',
            keepComputerAwake: 'true',
        });
        (0, vitest_1.expect)(await settingsService.getSetting(settingsService_1.SettingKey.RUN_IN_BACKGROUND)).toBe(false);
        (0, vitest_1.expect)(await settingsService.getSetting(settingsService_1.SettingKey.KEEP_COMPUTER_AWAKE)).toBe(true);
    });
    (0, vitest_1.it)('should return updated value after storage change', async () => {
        mockStorageManager.getItems.mockResolvedValue({
            [settingsService_1.SettingKey.RUN_IN_BACKGROUND]: 'false',
        });
        (0, vitest_1.expect)(await settingsService.getSetting(settingsService_1.SettingKey.RUN_IN_BACKGROUND)).toBe(false);
    });
    (0, vitest_1.it)('should trigger SleepBlocker on keepComputerAwake change', async () => {
        let changeListener;
        mockStorageManager.onDidChange.mockImplementation((listener) => {
            changeListener = listener;
            return { dispose: vitest_1.vi.fn() };
        });
        // Instantiate again to trigger constructor with the new mock
        settingsService = new settingsService_1.SettingsService(mockStorageManager);
        // Simulate change
        changeListener({ keepComputerAwake: 'true' });
        (0, vitest_1.expect)(mockSleepBlocker.shouldKeepComputerAwake).toHaveBeenCalledWith(true);
    });
    (0, vitest_1.it)('should trigger initial SleepBlocker state', async () => {
        mockStorageManager.getItems.mockResolvedValue({
            keepComputerAwake: 'true',
        });
        settingsService = new settingsService_1.SettingsService(mockStorageManager);
        await new Promise(process.nextTick);
        (0, vitest_1.expect)(mockSleepBlocker.shouldKeepComputerAwake).toHaveBeenCalledWith(true);
    });
});
