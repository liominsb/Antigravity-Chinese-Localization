"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = exports.DEFAULTS = exports.SettingKey = void 0;
const utils_1 = require("../utils");
// Setting keys
var SettingKey;
(function (SettingKey) {
    SettingKey["RUN_IN_BACKGROUND"] = "runInBackground";
    SettingKey["KEEP_COMPUTER_AWAKE"] = "keepComputerAwake";
})(SettingKey || (exports.SettingKey = SettingKey = {}));
// Default values
exports.DEFAULTS = new Map([
    // The following setting is off by default for windows because the app
    // icon is not as discoverable in the bottom right corner menu bar as
    // it is on macOS and linux.
    [SettingKey.RUN_IN_BACKGROUND, process.platform !== 'win32'],
    [SettingKey.KEEP_COMPUTER_AWAKE, false],
]);
/**
 * A thin wrapper around StorageManager to listen for changes
 * in settings and apply their side effects.
 */
class SettingsService {
    constructor(storageManager) {
        this.storageManager = storageManager;
        this.storageManager.onDidChange((changes) => {
            this.applySideEffects(changes);
        });
        void this.initialize();
    }
    async initialize() {
        const items = await this.storageManager.getItems();
        this.applySideEffects(items);
    }
    applySideEffects(settings) {
        const val = settings[SettingKey.KEEP_COMPUTER_AWAKE];
        if (val !== undefined) {
            const preventSleep = val === null
                ? exports.DEFAULTS.get(SettingKey.KEEP_COMPUTER_AWAKE)
                : val === 'true';
            utils_1.SleepBlocker.getInstance().shouldKeepComputerAwake(preventSleep);
        }
    }
    async getSetting(key) {
        const items = await this.storageManager.getItems();
        return items[key] === 'true';
    }
}
exports.SettingsService = SettingsService;
