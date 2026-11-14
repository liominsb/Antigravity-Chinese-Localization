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
exports.resolveSshBinary = resolveSshBinary;
exports.buildControlSshArgs = buildControlSshArgs;
exports.usesProxy = usesProxy;
exports.classifySshFailure = classifySshFailure;
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
        throw new types_1.RemoteError('INVALID_DESTINATION', 'Invalid SSH config file.');
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
/** Whether `ssh -G`'s output sets a ProxyJump or ProxyCommand. */
function usesProxy(configDump) {
    return /^(?:proxyjump|proxycommand) (?!none\r?$)/m.test(configDump);
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
            /bad configuration option/,
            /can't open user config file/,
            /bad owner or permissions on/,
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
function unknownCodeMessage(code) {
    return `Couldn't connect to the SSH host (${String(code)}).`;
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
                ? "The host's SSH key is unknown or has changed. Save it with ssh in a terminal. If it changed, ask the host's owner first: the connection may be intercepted."
                : "The host's SSH key has changed or isn't trusted. If it changed, ask the host's owner first: the connection may be intercepted.";
        case 'CONNECTION_FAILED':
            return `Couldn't connect to the SSH host. Check its name, your network and ssh config (e.g. a ProxyCommand), and that ssh to it works in a terminal${prompts === 'no' ? ' without a prompt' : ''}.`;
        case 'FORWARDING_PROHIBITED':
            return 'SSH 端口转发失败。请确认服务端已允许您的账户进行 TCP 转发 (AllowTcpForwarding)，然后重试。';
        case 'UNSUPPORTED_HOST':
            return "该 SSH 主机不受支持。Antigravity 需要搭载 glibc 2.26 或更新版本的 Linux x64 或 arm64 系统。";
        case 'SHARED_HOME_UNSUPPORTED':
            return '与此主目录共享的另一台主机正在运行 Antigravity 服务端。请改为连接该主机。';
        case 'INSTALL_FAILED':
            return "无法在 SSH 主机上安装 Antigravity 服务端。请确认该主机磁盘空间充足，且该主机或本计算机能够访问互联网下载。";
        case 'LS_START_FAILED':
            return `The Antigravity server failed to start on the SSH host. See its log in ~/${types_1.REMOTE_INSTALL_ROOT}/data on that host.`;
        case 'LS_STOPPED':
            return 'SSH 主机上的 Antigravity 服务端已停止。请重新连接以启动它。';
        case 'CONNECTION_CLOSED':
            return 'SSH 连接已断开。请检查网络连接后重新连接。';
        case 'CANCELLED':
            return '连接已取消。';
        case 'UNKNOWN':
            return "Couldn't connect to the SSH host. Try ssh to it in a terminal, and see the Antigravity log for details.";
        default:
            // Compile-time exhaustiveness check; also covers bad runtime values.
            return unknownCodeMessage(code);
    }
}
