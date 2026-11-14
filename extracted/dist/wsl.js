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
exports.WSL_STATE_FILE = exports.PUBLIC_ARTIFACT_BASE_URL = exports.DEFAULT_UPDATER_BASE_URL = exports.WSL_EXE = void 0;
exports.serverInstallDir = serverInstallDir;
exports.serverBinaryPath = serverBinaryPath;
exports.isWslAvailable = isWslAvailable;
exports.decodeWslOutput = decodeWslOutput;
exports.parseWslListOutput = parseWslListOutput;
exports.isSupportedDevDistro = isSupportedDevDistro;
exports.listWslDistros = listWslDistros;
exports.setActiveWslDistro = setActiveWslDistro;
exports.getActiveWslDistro = getActiveWslDistro;
exports.readPersistedWslDistro = readPersistedWslDistro;
exports.persistWslDistro = persistWslDistro;
exports.windowsToDistroPath = windowsToDistroPath;
exports.distroToWindowsPath = distroToWindowsPath;
exports.getDistroHome = getDistroHome;
exports.wslShellArgs = wslShellArgs;
exports.buildInstallScript = buildInstallScript;
exports.resolveStableArtifactDir = resolveStableArtifactDir;
exports.resolveInsidersArtifactDir = resolveInsidersArtifactDir;
exports.linuxServerUrl = linuxServerUrl;
exports.resolveServerBinarySource = resolveServerBinarySource;
exports.ensureServerInstalled = ensureServerInstalled;
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const util_1 = require("util");
const js_yaml_1 = require("js-yaml");
exports.WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
/** Auto-updater service; /releases maps stable versions to build execution ids. */
exports.DEFAULT_UPDATER_BASE_URL = 'https://antigravity-hub-auto-updater-974169037036.us-central1.run.app';
/** Public GCS bucket (HTTPS view) where release artifacts are published. */
exports.PUBLIC_ARTIFACT_BASE_URL = 'https://storage.googleapis.com/antigravity-public';
/** POSIX path of the versioned server directory inside the distro. */
function serverInstallDir(version) {
    return `$HOME/.antigravity-server/bin/${version}`;
}
/** POSIX path of the server binary inside the distro. */
function serverBinaryPath(version) {
    return `${serverInstallDir(version)}/language_server`;
}
function isWslAvailable() {
    return process.platform === 'win32' && fs.existsSync(exports.WSL_EXE);
}
/**
 * Decodes wsl.exe output. wsl.exe's own messages (e.g. --list) are UTF-16LE
 * while output of Linux programs is UTF-8
 */
function decodeWslOutput(buf) {
    return buf.includes(0)
        ? buf.toString('utf16le').replace(/^\uFEFF/, '')
        : buf.toString('utf8');
}
/**
 * Parses `wsl.exe --list --verbose` output ("* Ubuntu  Running  2" rows);
 * the header row never matches (its last column is not a number).
 */
function parseWslListOutput(output) {
    const distros = [];
    for (const line of output.split(/\r?\n/)) {
        const m = /^(\*?)\s*(\S+)\s+\S+\s+(\d+)\s*$/.exec(line);
        if (m) {
            distros.push({
                isDefault: m[1] === '*',
                name: m[2],
                version: parseInt(m[3], 10),
            });
        }
    }
    return distros;
}
/** True for WSL 2 distros that aren't container runtimes (docker/rancher/podman). */
function isSupportedDevDistro(d) {
    return d.version === 2 && !/^(docker-desktop|rancher-|podman-)/i.test(d.name);
}
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function execWsl(args) {
    try {
        const { stdout } = await execFileAsync(exports.WSL_EXE, args, {
            encoding: 'buffer',
            timeout: 30000,
        });
        return decodeWslOutput(stdout);
    }
    catch (err) {
        const e = err;
        const stderr = e.stderr ? `\n${decodeWslOutput(e.stderr)}` : '';
        throw new Error(`wsl.exe ${args.join(' ')} failed: ${e.message}${stderr}`);
    }
}
/** Lists installed distros suitable as dev environments. */
async function listWslDistros() {
    const output = await execWsl(['--list', '--verbose']);
    return parseWslListOutput(output).filter(isSupportedDevDistro);
}
// ---------------------------------------------------------------------------
// Active session state and path translation
// ---------------------------------------------------------------------------
let _activeDistro = '';
/** Marks the distro this app instance's LS runs in ('' = local mode). */
function setActiveWslDistro(distro) {
    _activeDistro = distro;
}
/** The distro this app instance's LS runs in, or '' in local mode. */
function getActiveWslDistro() {
    return _activeDistro;
}
/** userData file persisting the distro choice across relaunches that drop switches. */
exports.WSL_STATE_FILE = 'wsl_state.json';
/** Reads the persisted distro choice ('' = local mode or no/invalid state). */
function readPersistedWslDistro(stateFilePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
        const distro = parsed.distro;
        return typeof distro === 'string' ? distro : '';
    }
    catch {
        return '';
    }
}
/** Persists the distro choice ('' = local mode). Best-effort: logs failures, never throws. */
function persistWslDistro(stateFilePath, distro) {
    try {
        fs.writeFileSync(stateFilePath, JSON.stringify({ distro }), 'utf-8');
    }
    catch (err) {
        console.error('Failed to persist WSL distro choice:', err);
    }
}
/**
 * Translates a path picked in a Windows dialog into the distro's view.
 * Handles \\wsl.localhost\ and legacy \\wsl$\ UNC paths, drive letters
 * (mapped to /mnt/<drive> with a performance warning), and passes through
 * POSIX paths. Paths in a different distro are rejected.
 */
function windowsToDistroPath(winPath, distro) {
    const p = winPath.trim();
    if (p.startsWith('/')) {
        return { path: p };
    }
    const unc = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i.exec(p);
    if (unc) {
        if (unc[1].toLowerCase() !== distro.toLowerCase()) {
            return {
                error: `此文件夹属于 WSL 发行版 "${unc[1]}"，但当前窗口连接到 "${distro}"。`,
            };
        }
        const rest = (unc[2] || '/').replace(/\\/g, '/');
        return { path: rest === '' ? '/' : rest };
    }
    const drive = /^([A-Za-z]):([\\/].*)?$/.exec(p);
    if (drive) {
        const rest = (drive[2] || '/').replace(/\\/g, '/');
        return {
            path: `/mnt/${drive[1].toLowerCase()}${rest}`,
            warning: '此文件夹位于 Windows 文件系统。从 WSL 访问（通过 /mnt）可能较慢 — 为获得最佳性能，建议将项目保留在 WSL 文件系统中。',
        };
    }
    return { error: `无法在 WSL 中打开此位置: ${winPath}` };
}
/** Maps a POSIX path inside the distro to its \\wsl.localhost UNC view. */
function distroToWindowsPath(posixPath, distro) {
    return `\\\\wsl.localhost\\${distro}${posixPath.replace(/\//g, '\\')}`;
}
/** Returns $HOME inside the distro. */
async function getDistroHome(distro) {
    const home = (await execWsl(wslShellArgs(distro, 'echo "$HOME"'))).trim();
    if (!home.startsWith('/')) {
        throw new Error(`Could not resolve $HOME in distro ${distro}: "${home}"`);
    }
    return home;
}
/**
 * Runs `sh -c <script>` in the distro. LS args are passed as positional
 * parameters to avoid quoting issues. Uses --exec so no intermediate shell
 * reinterprets the arguments.
 */
function wslShellArgs(distro, script, positional = []) {
    return ['-d', distro, '--exec', 'sh', '-c', script, 'sh', ...positional];
}
/** True if the given server version is already installed in the distro. */
async function isServerInstalled(distro, version) {
    try {
        await execWsl(wslShellArgs(distro, `test -x "${serverBinaryPath(version)}"`));
        return true;
    }
    catch {
        return false;
    }
}
/** Builds the interruption-safe install script run inside the distro. */
function buildInstallScript(version, sha256) {
    const dir = serverInstallDir(version);
    return [
        'set -e',
        `dir="${dir}"`,
        'mkdir -p "$dir"',
        'tmp="$dir/.language_server.partial.$$"',
        'trap \'rm -f "$tmp"\' EXIT',
        'cat > "$tmp"',
        `echo "${sha256}  $tmp" | sha256sum -c - >/dev/null`,
        'chmod +x "$tmp"',
        'mv -f "$tmp" "$dir/language_server"',
        'trap - EXIT',
    ].join('; ');
}
/**
 * Writes a Linux language server binary into the distro's versioned install
 * dir. Skips the copy when already installed.
 */
async function installServerBinary(distro, version, data) {
    if (await isServerInstalled(distro, version)) {
        console.log(`[WSL] Server ${version} already installed in ${distro}`);
        return;
    }
    const sha256 = crypto.hash('sha256', data, 'hex');
    const script = buildInstallScript(version, sha256);
    console.log(`[WSL] Installing server ${version} into ${distro}…`);
    await new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(exports.WSL_EXE, wslShellArgs(distro, script), {
            stdio: ['pipe', 'ignore', 'pipe'],
        });
        const stderrChunks = [];
        proc.stderr.on('data', (d) => stderrChunks.push(d));
        proc.stdin?.on('error', (err) => {
            if (err.code !== 'EPIPE') {
                reject(err);
            }
        });
        proc.stdin?.end(data);
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`WSL install failed (code=${code}): ${decodeWslOutput(Buffer.concat(stderrChunks))}`));
            }
        });
    });
    console.log(`[WSL] Installed server ${version} into ${distro}`);
}
/** URL of the GCS folder with stable `version` artifacts (antigravity-hub/<version>-<execution_id>/). */
async function resolveStableArtifactDir(version, fetchImpl = fetch) {
    const url = `${exports.DEFAULT_UPDATER_BASE_URL}/releases`;
    const res = await fetchImpl(url);
    if (!res.ok) {
        throw new Error(`Failed to list releases: HTTP ${res.status}`);
    }
    const releases = (await res.json());
    const release = releases.find((r) => r.version === version);
    if (!release) {
        throw new Error(`Release ${version} not found at ${url}`);
    }
    return `${exports.PUBLIC_ARTIFACT_BASE_URL}/antigravity-hub/${version}-${release.execution_id}`;
}
/** URL of the GCS folder for the latest insiders version, as published in the latest-<arch>-linux.yml channel file. */
async function resolveInsidersArtifactDir(arch) {
    const url = `${exports.PUBLIC_ARTIFACT_BASE_URL}/insiders/latest-${arch}-linux.yml`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch insiders channel file: HTTP ${res.status}`);
    }
    const match = (0, js_yaml_1.load)(await res.text());
    if (!match?.version) {
        throw new Error(`No version in insiders channel file at ${url}`);
    }
    return `${exports.PUBLIC_ARTIFACT_BASE_URL}/insiders/${String(match.version)}`;
}
/** URL of the raw Linux LS binary for `arch` in a release artifact folder. */
function linuxServerUrl(artifactDir, arch) {
    return `${artifactDir}/unsigned/language_server-linux-${arch}`;
}
/**
 * Returns the Linux LS binary from the same build as this Hub, downloaded
 * from the release bucket. ANTIGRAVITY_WSL_LS_PATH overrides (for dev).
 */
async function resolveServerBinarySource(version, isInsiders) {
    const override = process.env.ANTIGRAVITY_WSL_LS_PATH;
    if (override) {
        if (!fs.existsSync(override)) {
            throw new Error(`ANTIGRAVITY_WSL_LS_PATH does not exist: ${override}`);
        }
        return fs.promises.readFile(override);
    }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const artifactDir = isInsiders
        ? await resolveInsidersArtifactDir(arch)
        : await resolveStableArtifactDir(version);
    const url = linuxServerUrl(artifactDir, arch);
    console.log(`[WSL] Downloading server binary from ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to download WSL server binary: HTTP ${res.status}`);
    }
    // Readable.fromWeb(res.body) hangs with Electron's fetch; buffer instead.
    return Buffer.from(await res.arrayBuffer());
}
/** Installs the server into the distro if missing; returns its POSIX path. */
async function ensureServerInstalled(distro, version, isInsiders, onStatus) {
    if (!(await isServerInstalled(distro, version))) {
        onStatus?.('正在下载 Antigravity 二进制组件\u2026');
        const data = await resolveServerBinarySource(version, isInsiders);
        onStatus?.(`正在安装到 ${distro}\u2026`);
        await installServerBinary(distro, version, data);
    }
    return serverBinaryPath(version);
}
