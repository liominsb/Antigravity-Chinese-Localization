"use strict";
// Shared types for "Connect to SSH Host". The Hub runs the user's own ssh,
// one connection per host (`ssh -T -D 127.0.0.1:<socks> … -- <host> sh -s`),
// and SSH windows reach the remote language server through that SOCKS proxy.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REMOTE_LS_WORKSPACE_ID = exports.REMOTE_INSTALL_ROOT = exports.REMOTE_UPLOAD_TIMEOUT_SEC = exports.REMOTE_CONNECT_TIMEOUT_SEC = exports.RemoteError = void 0;
exports.sanitizeRemoteText = sanitizeRemoteText;
class RemoteError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.code = code;
        this.name = 'RemoteError';
        this.reportedByRemote = options.reportedByRemote ?? false;
        this.retryable = options.retryable ?? false;
        this.userCancelled = options.userCancelled ?? false;
        this.couldPrompt = options.couldPrompt ?? false;
        this.explainsItself = options.explainsItself ?? false;
    }
}
exports.RemoteError = RemoteError;
/** The Hub's connect timeout; the host's install-lock wait ends before it. */
exports.REMOTE_CONNECT_TIMEOUT_SEC = 15 * 60;
/** An upload's limit on the host; the Hub's connect deadline moves by it. */
exports.REMOTE_UPLOAD_TIMEOUT_SEC = 15 * 60;
/** Install root on the remote, relative to $HOME. */
exports.REMOTE_INSTALL_ROOT = '.antigravity-hub-server';
/** C0/C1, bidi, line separators, zero-width and other invisibles, BOM. */
const UNSAFE_TEXT = 
// eslint-disable-next-line no-control-regex
/[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
/**
 * Strips control, bidi and invisible characters, keeping line breaks as \n
 * with keepNewlines; cuts at `max`.
 */
function sanitizeRemoteText(text, max = 500, { keepNewlines = false } = {}) {
    const clean = keepNewlines
        ? text
            .split(/\r\n|\r|\n/)
            .map((line) => line.replace(UNSAFE_TEXT, ' '))
            .join('\n')
        : text.replace(UNSAFE_TEXT, ' ');
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
/** Fixed --workspace_id for the persistent remote LS (one per user+app). */
exports.REMOTE_LS_WORKSPACE_ID = 'agy-hub-ssh';
