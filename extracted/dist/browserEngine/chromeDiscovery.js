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
exports.officialChromeCandidates = officialChromeCandidates;
exports.findOfficialChrome = findOfficialChrome;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/**
 * Candidate install locations of Official Google Chrome (stable channel),
 * most specific first. Only stable is listed: Beta/Dev/Canary auto-update to
 * versions the policy proxy has not been validated against.
 */
function officialChromeCandidates(platform, _env, homedir) {
    switch (platform) {
        case 'darwin': {
            const bundle = path.posix.join('Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
            return [
                path.posix.join('/Applications', bundle),
                path.posix.join(homedir, 'Applications', bundle),
            ];
        }
        case 'linux':
            return [
                '/usr/bin/google-chrome-stable',
                '/usr/bin/google-chrome',
                '/opt/google/chrome/chrome',
            ];
        case 'win32':
            // Chrome's --remote-debugging-pipe on stdio fds 3/4 is not supported on Windows.
            return [];
        default:
            return [];
    }
}
/** Returns the first installed Official Google Chrome binary, or undefined. */
function findOfficialChrome(discovery = defaultDiscoveryEnv()) {
    return officialChromeCandidates(discovery.platform, discovery.env, discovery.homedir).find((candidate) => discovery.isExecutable(candidate));
}
function defaultDiscoveryEnv() {
    return {
        platform: process.platform,
        env: process.env,
        homedir: os.homedir(),
        isExecutable: (file) => {
            try {
                fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
                return true;
            }
            catch {
                return false;
            }
        },
    };
}
