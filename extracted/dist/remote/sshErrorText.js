"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeAndLogs = codeAndLogs;
exports.detailOf = detailOf;
exports.explanationOf = explanationOf;
exports.userMessage = userMessage;
/** The Hub's words for a failed connection: what went wrong, what to do. */
const main_1 = __importDefault(require("electron-log/main"));
const sshArgs_1 = require("./sshArgs");
const sshAskpass_1 = require("./sshAskpass");
const types_1 = require("./types");
function logPath() {
    return main_1.default.transports.file.getFile().path;
}
function codeAndLogs(err) {
    return `错误代码：${err.code}\n日志：${logPath()}`;
}
function detailOf(err, label) {
    const text = (0, types_1.sanitizeRemoteText)(err.message);
    return err.reportedByRemote ? `${label} 报告：${text}` : text;
}
/**
 * `uname -s` on Windows: its POSIX layers (Cygwin, MSYS2, Git Bash) and
 * busybox-w32.
 */
const WINDOWS_UNAME = /\b(?:CYGWIN|MINGW|MSYS)\w*_NT\b|\bWindows_NT\b/;
/** Automatic reconnects can't ask, but Reconnect can; Windows can't yet. */
function promptSupportOf(err) {
    if (!(0, sshAskpass_1.canPrompt)()) {
        return 'no';
    }
    return err.couldPrompt ? 'yes' : 'onReconnect';
}
/** The Hub's own words: what went wrong, and what to do. */
function explanationOf(err, label) {
    if (err.code === 'CANCELLED') {
        // A prompt's Cancel says so; else the connect was closed under the caller.
        return err.userCancelled
            ? err.message
            : '连接在完成前已关闭。';
    }
    if (err.explainsItself) {
        return detailOf(err, label);
    }
    // The host is Windows: its uname says so (a POSIX layer), or its own shell
    // (cmd.exe, PowerShell, as Windows' OpenSSH server runs) has no sh. Say
    // just that: its words stay the detail.
    const windows = err.reportedByRemote
        ? WINDOWS_UNAME.test(err.message)
        : (0, sshArgs_1.isWindowsShellLine)(err.message);
    if (err.code === 'UNSUPPORTED_HOST' && windows) {
        return `暂不支持 Windows SSH 主机。${sshArgs_1.LINUX_HOST_NEEDED}`;
    }
    return (0, sshArgs_1.describeRemoteError)(err.code, promptSupportOf(err));
}
function userMessage(err, label) {
    const what = explanationOf(err, label);
    if (err.code === 'CANCELLED') {
        return what;
    }
    const detail = detailOf(err, label);
    const text = detail && detail !== what ? `${what}\n${detail}` : what;
    // For ssh's own config errors, the log has all of ssh's lines; the
    // detail only one.
    const pointsToLog = err.code === 'UNKNOWN' ||
        (err.code === 'SSH_CONFIG_INVALID' && !err.explainsItself);
    return pointsToLog ? `${text}\n日志：${logPath()}` : text;
}
