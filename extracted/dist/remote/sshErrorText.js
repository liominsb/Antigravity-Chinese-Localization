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
const paths_1 = require("../paths");
const bootstrapProtocol_1 = require("./bootstrapProtocol");
const sshArgs_1 = require("./sshArgs");
const sshAskpass_1 = require("./sshAskpass");
const types_1 = require("./types");
function logPath() {
    return main_1.default.transports.file.getFile().path;
}
function codeAndLogs(err) {
    return `Error code: ${err.code}\nLogs: ${logPath()}`;
}
function detailOf(err, label) {
    const text = (0, types_1.sanitizeRemoteText)(err.message);
    return err.reportedByRemote ? `${label} reported: ${text}` : text;
}
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
            : 'The connection was closed before it finished.';
    }
    if (err.explainsItself) {
        return detailOf(err, label);
    }
    const what = (0, sshArgs_1.describeRemoteError)(err.code, promptSupportOf(err));
    if (err.code !== 'SHARED_HOME_UNSUPPORTED') {
        return what;
    }
    // Named here, not by the host: its text could name any file.
    const note = `~/.gemini/${(0, paths_1.getAppDataDirName)()}/daemon/${(0, bootstrapProtocol_1.discoveryFileNameFor)(types_1.REMOTE_LS_WORKSPACE_ID)}.host`;
    return `${what}\nFile: ${note} on ${label}`;
}
function userMessage(err, label) {
    const what = explanationOf(err, label);
    if (err.code === 'CANCELLED') {
        return what;
    }
    const detail = detailOf(err, label);
    const text = detail && detail !== what ? `${what}\n${detail}` : what;
    return err.code === 'UNKNOWN' ? `${text}\nLogs: ${logPath()}` : text;
}
