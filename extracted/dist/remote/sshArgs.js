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
exports.LINUX_HOST_NEEDED = void 0;
exports.resolveSshBinary = resolveSshBinary;
exports.buildControlSshArgs = buildControlSshArgs;
exports.usesProxy = usesProxy;
exports.sshConfigProblem = sshConfigProblem;
exports.classifySshFailure = classifySshFailure;
exports.windowsShellLine = windowsShellLine;
exports.isWindowsShellLine = isWindowsShellLine;
exports.otherForwardFailed = otherForwardFailed;
exports.socksListenFailed = socksListenFailed;
exports.describeRemoteError = describeRemoteError;
// TODO(nathanjuan): Share the ssh argv and its failure handling with the IDE's
// SSH extension (antigravity-remote-openssh, src/resolver.ts) via a shared
// package, which should also pick which ssh.exe to run on Windows.
const path = __importStar(require("path"));
const sshDestination_1 = require("./sshDestination");
const types_1 = require("./types");
/** `ANTIGRAVITY_SSH_BIN` (a dev and test override), else `ssh` from PATH. */
function resolveSshBinary(env = process.env) {
    // '||': an empty value means unset.
    return env.ANTIGRAVITY_SSH_BIN || 'ssh';
}
/**
 * ssh's argv for a host's one connection. Unlike the IDE's SSH extension,
 * RemoteCommand=none is always set: Match blocks can't be evaluated
 * beforehand. Throws for a bad socksPort, a non-canonical destination or a
 * configFile that isn't an absolute path on one line.
 */
function buildControlSshArgs({ destination, socksPort, exitOnForwardFailure = true, batchMode = true, connectTimeout = true, configFile, }) {
    if (!Number.isInteger(socksPort) || socksPort < 1 || socksPort > 65535) {
        throw new RangeError(`Invalid SOCKS port: ${socksPort}`);
    }
    if (configFile !== undefined &&
        (!path.isAbsolute(configFile) || /[\0\r\n]/.test(configFile))) {
        throw new types_1.RemoteError('INVALID_DESTINATION', 'SSH 配置文件无效。');
    }
    const target = (0, sshDestination_1.toSshTarget)(destination);
    return [
        ...(configFile === undefined ? [] : ['-F', configFile]),
        '-T',
        '-D',
        `127.0.0.1:${socksPort}`,
        // ssh exits rather than leave the window a SOCKS port another process
        // holds. A failed forward from the user's config gets one retry without.
        '-o',
        `ExitOnForwardFailure=${exitOnForwardFailure ? 'yes' : 'no'}`,
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=3',
        ...(connectTimeout ? ['-o', 'ConnectTimeout=15'] : []),
        ...(batchMode ? ['-o', 'BatchMode=yes'] : []),
        // ssh takes the first value it sees, so these override the user's config:
        // the remote agents mustn't get the laptop's ssh-agent, and a configured
        // RemoteCommand would make ssh refuse ours.
        '-o',
        'ForwardAgent=no',
        '-o',
        'ForwardX11=no',
        '-o',
        'ForwardX11Trusted=no',
        '-o',
        'RemoteCommand=none',
        // Not the user's ControlMaster: its sessions would die with ours, or it
        // would keep our SOCKS listener.
        '-o',
        'ControlMaster=no',
        '-o',
        'ControlPath=none',
        // ssh's messages are its errors' detail, even if the config says QUIET.
        // INFO, not ERROR: OpenSSH logs server timeouts at INFO.
        '-o',
        'LogLevel=INFO',
        ...target.options,
        '--',
        target.destination,
        'sh',
        '-s',
    ];
}
/**
 * A Windows host's own shell (cmd.exe, PowerShell) saying it has no sh,
 * lowercased: as ssh's stderr has it, or after "ssh exited (…): ".
 */
const WINDOWS_SHELL_HAS_NO_SH = [
    /(?:^|: )'sh' is not recognized as an internal or external command/m,
    /the term 'sh' is not recognized as (?:the|a) name of a cmdlet/,
];
/** Whether `ssh -G`'s output sets a ProxyJump or ProxyCommand. */
function usesProxy(configDump) {
    return /^(?:proxyjump|proxycommand) (?!none\r?$)/m.test(configDump);
}
/**
 * ssh's lines when it refuses its config files, lowercased. It then exits
 * 255 before it connects anywhere. `-o` options' lines say "command-line":
 * those are the Hub's own, not the user's config.
 */
const SSH_CONFIG_REFUSED = [
    /^(?!command-line:).+: terminating, \d+ bad configuration options$/,
    /^can't open user config file /,
    /^bad owner or permissions on /,
];
/**
 * ssh's lines naming the problem, best first. The first is "<file>: line N:
 * Bad configuration option: <word>".
 */
const SSH_CONFIG_PROBLEM = [
    // Any word: JS's \S misses a BOM (U+FEFF), as in "\ufeffhost".
    /^(?!command-line:).+: line \d+: bad configuration option: ./,
    /^(?!command-line[: ]).+ line \d+: \S/,
    ...SSH_CONFIG_REFUSED,
];
/** Warnings in the same form, which don't stop ssh. */
const SSH_CONFIG_WARNING = / line \d+: (?:deprecated|unsupported) option /;
/**
 * What ssh refused in its config files, from the stderr of an `ssh -G` that
 * exited 255: the line naming the problem, or undefined if ssh didn't refuse
 * them. Only for `ssh -G`, which connects nowhere, so no host wrote any of it.
 */
function sshConfigProblem(stderr) {
    const lines = stderr
        .split(/\r\n|\r|\n/)
        .map((line) => ({ line, lower: line.toLowerCase() }))
        .filter(({ lower }) => !SSH_CONFIG_WARNING.test(lower));
    const refused = lines.some(({ lower }) => SSH_CONFIG_REFUSED.some((pattern) => pattern.test(lower)));
    if (!refused) {
        return undefined;
    }
    for (const pattern of SSH_CONFIG_PROBLEM) {
        const found = lines.find(({ lower }) => pattern.test(lower));
        if (found) {
            return found.line;
        }
    }
    return undefined;
}
/**
 * Patterns for the lowercased stderr; the first code with a match wins. Host
 * key before auth: a changed key also disables password auth. Auth and closed
 * connections match only ssh's own lines: a banner or rc file prints anything.
 * Linear patterns only: a host controls part of this text.
 */
const FAILURE_RULES = [
    [
        // ssh stops at once on these; its message, kept as the detail, says why.
        'UNKNOWN',
        [
            /unable to negotiate with/,
            /could not request (?:local|tunnel) forwarding/,
            /remote port forwarding failed/,
        ],
    ],
    [
        'HOSTKEY_REJECTED',
        [/host key verification failed/, /remote host identification has changed/],
    ],
    [
        'CONNECTION_FAILED',
        [
            // DNS, also as relayed by a ProxyJump host or ProxyCommand.
            /could not resolve hostname/,
            /name or service not known/,
            /nodename nor servname provided/,
            /temporary failure in name resolution/,
            /no address associated with hostname/,
            /connection refused/,
            /connection timed out/,
            /operation timed out/,
            /no route to host/,
            /network is unreachable/,
            /host is down/,
        ],
    ],
    [
        // E.g. a ProxyJump host with AllowTcpForwarding no.
        'FORWARDING_PROHIBITED',
        [/administratively prohibited/, /forwarding disabled/],
    ],
    [
        // A Windows host's own shell (cmd.exe, PowerShell) has no sh to run. It
        // ran, so the login worked: before AUTH_FAILED, whose "please try
        // again" a retried password leaves.
        'UNSUPPORTED_HOST',
        WINDOWS_SHELL_HAS_NO_SH,
    ],
    [
        'AUTH_FAILED',
        [
            // "user@host: Permission denied (publickey,password)."
            /(?:^|: )permission denied \([\w@.-]+(?:,[\w@.-]+)*\)\.$/m,
            /^permission denied, please try again\.$/m,
            /^received disconnect from .*: too many authentication failures/m,
            // Prompts, which BatchMode can't answer.
            /^(?:[^\s@]+@)+[^\s@']+'s password: /m,
            /^enter passphrase for /m,
            /^bad passphrase, try again for /m,
        ],
    ],
    [
        // Not "UNKNOWN port 65535", a ProxyCommand's pipe: a broken one closes too.
        'CONNECTION_CLOSED',
        [
            /^connection (?:closed|reset) by (?!unknown port)/m,
            /^connection to \S+ closed by remote host/m,
            /^timeout, server \S+ not responding/m,
            /(?:^|: )connection to (?!unknown port)\S+ port \d+: broken pipe$/m,
            /^client_loop: send disconnect: broken pipe$/m,
        ],
    ],
    [
        // Last: ssh -G reports real config errors before the run (checkConfig).
        // Here they're words a banner or rc file may print, or a config file
        // that changed since.
        'UNKNOWN',
        [
            /bad configuration option/,
            /can't open user config file/,
            /bad owner or permissions on/,
        ],
    ],
];
/**
 * Drops "channel N: open failed: connect failed" lines (a SOCKS target, not
 * the connection), unless "stdio forwarding failed": then a ProxyJump hop
 * couldn't reach the host, and they say why.
 */
function withoutChannelNoise(stderr) {
    if (/stdio forwarding failed/i.test(stderr)) {
        return stderr;
    }
    return stderr
        .split(/\r\n|\r|\n/)
        .filter((line) => !/^\s*channel \d+: open failed: connect failed:/i.test(line))
        .join('\n');
}
/**
 * Why an ssh run ended before the bootstrap's first line. `exitCode` is null
 * for a signal. Unexplained, ssh's own exit 255 is CONNECTION_FAILED: e.g. a
 * broken ProxyCommand.
 */
function classifySshFailure(stderr, exitCode) {
    const text = withoutChannelNoise(stderr).toLowerCase();
    for (const [code, patterns] of FAILURE_RULES) {
        if (patterns.some((pattern) => pattern.test(text))) {
            return { code, explained: true };
        }
    }
    return {
        code: exitCode === 255 ? 'CONNECTION_FAILED' : 'UNKNOWN',
        explained: false,
    };
}
/**
 * The line of `stderr` where a Windows host's shell says it has no sh, which
 * says more than the shell's last line ("operable program or batch file.").
 */
function windowsShellLine(stderr) {
    return stderr.split(/\r\n|\r|\n/).find((line) => isWindowsShellLine(line));
}
/** Whether `text` has a Windows shell's words for having no sh. */
function isWindowsShellLine(text) {
    const lower = text.toLowerCase();
    return WINDOWS_SHELL_HAS_NO_SH.some((pattern) => pattern.test(lower));
}
/** Whether a forward other than our SOCKS port failed (one in the config). */
function otherForwardFailed(stderr, socksPort) {
    return (/remote port forwarding failed/i.test(stderr) ||
        [...stderr.matchAll(/cannot listen to port: (\d+)/g)].some(([, port]) => Number(port) !== socksPort) ||
        // Unix-socket LocalForwards and Tunnel name no port; our -D does.
        (/could not request (?:local|tunnel) forwarding/i.test(stderr) &&
            !socksListenFailed(stderr, socksPort)));
}
/** Whether ssh couldn't listen on 127.0.0.1:`socksPort` (taken, or inet6). */
function socksListenFailed(stderr, socksPort) {
    return new RegExp(`cannot listen to port: ${socksPort}(?!\\d)|getaddrinfo\\(127\\.0\\.0\\.1\\)`).test(stderr);
}
/** What UNSUPPORTED_HOST's texts say a host needs. */
exports.LINUX_HOST_NEEDED = 'Antigravity 需要搭载 glibc 2.26 或更新版本的 Linux x64 或 arm64 系统。';
function unknownCodeMessage(code) {
    return `无法连接到 SSH 主机 (${String(code)})。`;
}
const AUTH_FAILED_TEXT = {
    yes: 'SSH 身份验证失败。请检查密码、动态验证码或密钥，然后重试。',
    onReconnect: 'SSH 身份验证失败。请点击重新连接以再次登录。',
    no: "SSH 身份验证失败。Antigravity 暂不支持在 Windows 下响应密码或动态码交互提示：请通过 ssh-agent 配置密钥免密登录后重试。",
};
/**
 * What an error code means to the user, and what to do about it; `prompts`
 * says whether ssh could ask for a password or about a new host key.
 */
function describeRemoteError(code, prompts) {
    switch (code) {
        case 'INVALID_DESTINATION':
            return "该 SSH 主机地址无效。请输入 SSH 配置中的别名或类似 user@host、user@host:2222 的格式。";
        case 'AUTH_FAILED':
            return AUTH_FAILED_TEXT[prompts];
        case 'HOSTKEY_REJECTED':
            return prompts === 'no'
                ? "该主机的 SSH 密钥未知或已发生变更。请在终端中使用 ssh 连接并保存它。如果密钥发生了变更，请先向主机管理员核实：连接可能遭到拦截。"
                : "该主机的 SSH 密钥已发生变更或不受信任。如果密钥发生了变更，请先向主机管理员核实：连接可能遭到拦截。";
        case 'CONNECTION_FAILED':
            return `无法连接到 SSH 主机。请检查主机名、网络连接与 ssh 配置（例如 ProxyCommand），并确认在终端中可${prompts === 'no' ? '免交互提示地' : ''}通过 ssh 正常连接。`;
        case 'SSH_CONFIG_INVALID':
            return "SSH 无法使用您的 SSH 配置文件。请修复 ssh 报告的问题，或选择其他配置文件。";
        case 'FORWARDING_PROHIBITED':
            return 'SSH 端口转发失败。请确认服务端已允许您的账户进行 TCP 转发 (AllowTcpForwarding)，然后重试。';
        case 'UNSUPPORTED_HOST':
            return `该 SSH 主机不受支持。${exports.LINUX_HOST_NEEDED}暂不支持 Windows 和 macOS 主机。`;
        case 'SHARED_HOME_UNSUPPORTED':
            return '与此主目录共享的另一台主机正在运行 Antigravity 服务端。请改为连接该主机，或重新连接并选择“接管”。';
        case 'INSTALL_FAILED':
            return "无法在 SSH 主机上安装 Antigravity 服务端。请确认该主机磁盘空间充足，且该主机或本计算机能够访问互联网下载。";
        case 'LS_START_FAILED':
            return `SSH 主机上的 Antigravity 服务端启动失败。请查看该主机上 ~/${types_1.REMOTE_INSTALL_ROOT}/data 目录中的日志。`;
        case 'LS_STOPPED':
            return 'SSH 主机上的 Antigravity 服务端已停止。请重新连接以启动它。';
        case 'CONNECTION_CLOSED':
            return 'SSH 连接已断开。请检查网络连接后重新连接。';
        case 'CANCELLED':
            return '连接已取消。';
        case 'UNKNOWN':
            return "无法连接到 SSH 主机。请尝试在终端中使用 ssh 连接，并查看 Antigravity 日志了解详情。";
        default:
            // Compile-time exhaustiveness check; also covers bad runtime values.
            return unknownCodeMessage(code);
    }
}
