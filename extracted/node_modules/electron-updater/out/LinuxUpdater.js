"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinuxUpdater = void 0;
const BaseUpdater_1 = require("./BaseUpdater");
class LinuxUpdater extends BaseUpdater_1.BaseUpdater {
    constructor(options, app) {
        super(options, app);
    }
    /**
     * Returns true if the current process is running as root.
     */
    isRunningAsRoot() {
        var _a;
        return ((_a = process.getuid) === null || _a === void 0 ? void 0 : _a.call(process)) === 0;
    }
    /**
     * Sanitizies the installer path for using with command line tools.
     */
    get installerPath() {
        var _a, _b;
        return (_b = (_a = super.installerPath) === null || _a === void 0 ? void 0 : _a.replace(/\\/g, "\\\\").replace(/ /g, "\\ ")) !== null && _b !== void 0 ? _b : null;
    }
    runCommandWithSudoIfNeeded(commandWithArgs) {
        if (this.isRunningAsRoot()) {
            this._logger.info("Running as root, no need to use sudo");
            return this.spawnSyncLog(commandWithArgs[0], commandWithArgs.slice(1));
        }
        const { name } = this.app;
        const installComment = `"${name} would like to update"`;
        const sudo = this.sudoWithArgs(installComment);
        this._logger.info(`Running as non-root user, using sudo to install: ${sudo}`);
        let wrapper = `"`;
        // some sudo commands dont want the command to be wrapped in " quotes
        if (/pkexec/i.test(sudo[0]) || sudo[0] === "sudo") {
            wrapper = "";
        }
        return this.spawnSyncLog(sudo[0], [...(sudo.length > 1 ? sudo.slice(1) : []), `${wrapper}/bin/bash`, "-c", `'${commandWithArgs.join(" ")}'${wrapper}`]);
    }
    sudoWithArgs(installComment) {
        const sudo = this.determineSudoCommand();
        const command = [sudo];
        if (/kdesudo/i.test(sudo)) {
            command.push("--comment", installComment);
            command.push("-c");
        }
        else if (/gksudo/i.test(sudo)) {
            command.push("--message", installComment);
        }
        else if (/pkexec/i.test(sudo)) {
            command.push("--disable-internal-agent");
        }
        return command;
    }
    hasCommand(cmd) {
        try {
            this.spawnSyncLog(`command`, ["-v", cmd]);
            return true;
        }
        catch {
            return false;
        }
    }
    determineSudoCommand() {
        const sudos = ["gksudo", "kdesudo", "pkexec", "beesu"];
        for (const sudo of sudos) {
            if (this.hasCommand(sudo)) {
                return sudo;
            }
        }
        return "sudo";
    }
    /**
     * Detects the package manager to use based on the available commands.
     * Allows overriding the default behavior by setting the ELECTRON_BUILDER_LINUX_PACKAGE_MANAGER environment variable.
     * If the environment variable is set, it will be used directly. (This is useful for testing each package manager logic path.)
     * Otherwise, it checks for the presence of the specified package manager commands in the order provided.
     * @param pms - An array of package manager commands to check for, in priority order.
     * @returns The detected package manager command or "unknown" if none are found.
     */
    detectPackageManager(pms) {
        var _a;
        const pmOverride = (_a = process.env.ELECTRON_BUILDER_LINUX_PACKAGE_MANAGER) === null || _a === void 0 ? void 0 : _a.trim();
        if (pmOverride) {
            return pmOverride;
        }
        // Check for the package manager in the order of priority
        for (const pm of pms) {
            if (this.hasCommand(pm)) {
                return pm;
            }
        }
        // return the first package manager in the list if none are found, this will throw upstream for proper logging
        this._logger.warn(`No package manager found in the list: ${pms.join(", ")}. Defaulting to the first one: ${pms[0]}`);
        return pms[0];
    }
}
exports.LinuxUpdater = LinuxUpdater;
//# sourceMappingURL=LinuxUpdater.js.map