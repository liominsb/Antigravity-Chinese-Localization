"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSH_LS_REMOTE_PATH_ENV = exports.SSH_LS_VERSION_ENV = void 0;
exports.serverArtifactsWithoutLookup = serverArtifactsWithoutLookup;
exports.resolveRemoteServerArtifacts = resolveRemoteServerArtifacts;
/**
 * The language server build an SSH remote installs: the Hub's own version
 * from the public release bucket, as in WSL mode. Unreleased (dev) Hubs name
 * a release or a binary on the remote with the variables below.
 */
const wsl_1 = require("../wsl");
const types_1 = require("./types");
/** The release to install (dev Hubs report 0.0.0). */
exports.SSH_LS_VERSION_ENV = 'ANTIGRAVITY_SSH_LS_VERSION';
/** A server binary on the remote (absolute path) to run instead. */
exports.SSH_LS_REMOTE_PATH_ENV = 'ANTIGRAVITY_SSH_LS_REMOTE_PATH';
const VERSION_RE = /^[A-Za-z0-9._-]{1,128}$/;
/**
 * The version (and remote binary, if set) without download URLs: all an
 * attach-only connect needs.
 * @throws RemoteError INSTALL_FAILED for a bad version or remote path.
 */
function serverArtifactsWithoutLookup(opts) {
    const env = opts.env ?? process.env;
    // '||': an empty value means unset.
    const version = env[exports.SSH_LS_VERSION_ENV] || opts.appVersion;
    if (!VERSION_RE.test(version) || /^\.+$/.test(version)) {
        throw new types_1.RemoteError('INSTALL_FAILED', `无效的服务端版本：${JSON.stringify(version)}`);
    }
    const remotePath = env[exports.SSH_LS_REMOTE_PATH_ENV];
    if (!remotePath) {
        return { version, x64: {}, arm64: {} };
    }
    // eslint-disable-next-line no-control-regex
    if (!/^\/[^\u0000-\u001f\u007f]{0,4095}$/.test(remotePath)) {
        throw new types_1.RemoteError('INSTALL_FAILED', `${exports.SSH_LS_REMOTE_PATH_ENV} 必须是 SSH 主机上的绝对路径：${JSON.stringify(remotePath)}`);
    }
    return { version, x64: {}, arm64: {}, remotePath };
}
/**
 * Adds the release's download URLs.
 * @throws RemoteError INSTALL_FAILED for a bad version or remote path.
 */
async function resolveRemoteServerArtifacts(opts) {
    const artifacts = serverArtifactsWithoutLookup(opts);
    if (artifacts.remotePath) {
        return { artifacts };
    }
    const { version } = artifacts;
    let artifactDir;
    try {
        artifactDir = opts.isInsiders
            ? `${wsl_1.PUBLIC_ARTIFACT_BASE_URL}/insiders/${version}`
            : await (opts.resolveStableDir ?? wsl_1.resolveStableArtifactDir)(version);
    }
    catch (err) {
        return {
            artifacts,
            resolutionError: `找不到 Antigravity 服务端构建版本 ${version}：` +
                `${err instanceof Error ? err.message : String(err)}。开发版构建必须将环境变量 ` +
                `${exports.SSH_LS_VERSION_ENV} 设置为已发布的版本号。`,
        };
    }
    return {
        artifacts: {
            version,
            x64: { url: (0, wsl_1.linuxServerUrl)(artifactDir, 'x64') },
            arm64: { url: (0, wsl_1.linuxServerUrl)(artifactDir, 'arm64') },
        },
    };
}
