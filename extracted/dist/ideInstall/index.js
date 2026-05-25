"use strict";
/**
 * IDE Install — Public API.
 *
 * Re-exports the public surface from the sub-modules so consumers
 * can simply `import { … } from './ideInstall'`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.showIdeInstallWizard = exports.maybeShowIdeInstallWizard = exports.downloadAndInstallIde = exports.copyUserData = exports.extractIde = exports.downloadFile = exports.shouldShowIdeInstallWizard = exports.getIdeInstallPath = exports.getPlatformKey = exports.fetchIdeDownloadUrl = exports.WIZARD_SHOWN_KEY = exports.IDE_BACKUP_DATA_DIR = exports.IDE_NEW_DATA_DIR = exports.IDE_OLD_DATA_DIR = void 0;
// Constants, platform helpers, condition checks
var paths_1 = require("../paths");
Object.defineProperty(exports, "IDE_OLD_DATA_DIR", { enumerable: true, get: function () { return paths_1.IDE_OLD_DATA_DIR; } });
Object.defineProperty(exports, "IDE_NEW_DATA_DIR", { enumerable: true, get: function () { return paths_1.IDE_NEW_DATA_DIR; } });
Object.defineProperty(exports, "IDE_BACKUP_DATA_DIR", { enumerable: true, get: function () { return paths_1.IDE_BACKUP_DATA_DIR; } });
var constants_1 = require("./constants");
Object.defineProperty(exports, "WIZARD_SHOWN_KEY", { enumerable: true, get: function () { return constants_1.WIZARD_SHOWN_KEY; } });
Object.defineProperty(exports, "fetchIdeDownloadUrl", { enumerable: true, get: function () { return constants_1.fetchIdeDownloadUrl; } });
Object.defineProperty(exports, "getPlatformKey", { enumerable: true, get: function () { return constants_1.getPlatformKey; } });
Object.defineProperty(exports, "getIdeInstallPath", { enumerable: true, get: function () { return constants_1.getIdeInstallPath; } });
Object.defineProperty(exports, "shouldShowIdeInstallWizard", { enumerable: true, get: function () { return constants_1.shouldShowIdeInstallWizard; } });
var service_1 = require("./service");
Object.defineProperty(exports, "downloadFile", { enumerable: true, get: function () { return service_1.downloadFile; } });
Object.defineProperty(exports, "extractIde", { enumerable: true, get: function () { return service_1.extractIde; } });
Object.defineProperty(exports, "copyUserData", { enumerable: true, get: function () { return service_1.copyUserData; } });
Object.defineProperty(exports, "downloadAndInstallIde", { enumerable: true, get: function () { return service_1.downloadAndInstallIde; } });
// Wizard window
var wizard_1 = require("./wizard");
Object.defineProperty(exports, "maybeShowIdeInstallWizard", { enumerable: true, get: function () { return wizard_1.maybeShowIdeInstallWizard; } });
Object.defineProperty(exports, "showIdeInstallWizard", { enumerable: true, get: function () { return wizard_1.showIdeInstallWizard; } });
