"use strict";
/**
 * IDE Install Service — Download, extract, copy, and launch logic.
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadFile = downloadFile;
exports.extractIde = extractIde;
exports.copyUserData = copyUserData;
exports.downloadAndInstallIde = downloadAndInstallIde;
const fs = __importStar(require("fs"));
const fsPromises = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const main_1 = __importDefault(require("electron-log/main"));
const constants_1 = require("./constants");
const paths_1 = require("../paths");
// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
function downloadFile(url, destPath, onProgress, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            reject(new Error('Too many redirects'));
            return;
        }
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, (res) => {
            if (res.statusCode &&
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location) {
                const redirectUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).toString();
                downloadFile(redirectUrl, destPath, onProgress, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }
            const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;
            const dir = path.dirname(destPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const fileStream = fs.createWriteStream(destPath);
            res.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0 && onProgress) {
                    onProgress(Math.round((downloadedBytes / totalBytes) * 100));
                }
            });
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });
            fileStream.on('error', (err) => {
                fs.unlinkSync(destPath);
                reject(err);
            });
        });
        req.on('error', reject);
    });
}
// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------
async function extractIde(archivePath, installPath) {
    const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
    const { promisify } = await Promise.resolve().then(() => __importStar(require('util')));
    const execFileAsync = promisify(execFile);
    if (!fs.existsSync(path.dirname(installPath))) {
        await fsPromises.mkdir(path.dirname(installPath), { recursive: true });
    }
    switch (process.platform) {
        case 'darwin': {
            const tempDir = path.join(os.tmpdir(), 'antigravity-ide-extract');
            if (fs.existsSync(tempDir)) {
                await execFileAsync('rm', ['-rf', tempDir]);
            }
            await fsPromises.mkdir(tempDir, { recursive: true });
            await execFileAsync('unzip', ['-o', '-q', archivePath, '-d', tempDir]);
            const entries = await fsPromises.readdir(tempDir);
            const appBundle = entries.find((e) => e.endsWith('.app'));
            if (!appBundle) {
                throw new Error('No .app bundle found in the downloaded archive');
            }
            if (fs.existsSync(installPath)) {
                await execFileAsync('rm', ['-rf', installPath]);
            }
            await execFileAsync('mv', [path.join(tempDir, appBundle), installPath]);
            if (fs.existsSync(tempDir)) {
                await execFileAsync('rm', ['-rf', tempDir]);
            }
            break;
        }
        case 'linux': {
            if (!fs.existsSync(installPath)) {
                await fsPromises.mkdir(installPath, { recursive: true });
            }
            await execFileAsync('tar', [
                '-xzf',
                archivePath,
                '-C',
                installPath,
                '--strip-components=1',
            ]);
            break;
        }
        case 'win32': {
            await execFileAsync(archivePath, ['/VERYSILENT', '/MERGETASKS=!runcode']);
            break;
        }
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}
// ---------------------------------------------------------------------------
// Copy User Data
// ---------------------------------------------------------------------------
async function copyUserData(sourcePath, destPath) {
    if (!fs.existsSync(sourcePath)) {
        main_1.default.warn(`[IDE Wizard] Source path does not exist: ${sourcePath}`);
        return;
    }
    await fsPromises.cp(sourcePath, destPath, { recursive: true, force: true });
    main_1.default.info(`[IDE Wizard] Copied user data: ${sourcePath} → ${destPath}`);
}
// ---------------------------------------------------------------------------
// Download & Install (orchestrator)
// ---------------------------------------------------------------------------
async function downloadAndInstallIde() {
    const platformKey = (0, constants_1.getPlatformKey)();
    const downloadUrl = await (0, constants_1.fetchIdeDownloadUrl)(platformKey);
    const ext = process.platform === 'win32'
        ? '.exe'
        : process.platform === 'linux'
            ? '.tar.gz'
            : '.zip';
    const tempFile = path.join(os.tmpdir(), `antigravity-ide-download${ext}`);
    main_1.default.info(`[IDE Wizard] Downloading IDE from ${downloadUrl}…`);
    await downloadFile(downloadUrl, tempFile);
    const installPath = (0, constants_1.getIdeInstallPath)();
    main_1.default.info(`[IDE Wizard] Installing IDE to ${installPath}…`);
    await extractIde(tempFile, installPath);
    main_1.default.info(`[IDE Wizard] Copying user data…`);
    await copyUserData(paths_1.IDE_OLD_DATA_DIR, paths_1.IDE_NEW_DATA_DIR);
    try {
        await fsPromises.unlink(tempFile);
    }
    catch {
        /* ignore */
    }
}
