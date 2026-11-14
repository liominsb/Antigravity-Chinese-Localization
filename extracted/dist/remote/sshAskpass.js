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
exports.AskpassRelay = void 0;
exports.canPrompt = canPrompt;
exports.promptKind = promptKind;
/**
 * Answers ssh's prompts for one ssh run: ssh runs SSH_ASKPASS, a helper that
 * relays each prompt to the Hub over a unix socket in a private directory.
 */
const crypto = __importStar(require("crypto"));
const events_1 = require("events");
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const path = __importStar(require("path"));
const nodeWrapper_1 = require("../nodeWrapper");
const privateDir_1 = require("./privateDir");
const types_1 = require("./types");
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_PROMPT_CHARS = 2000;
/** ssh reads no more of an answer. */
const MAX_ANSWER_BYTES = 1023;
/** macOS's sun_path holds 104 bytes, with the NUL. */
const MAX_SOCKET_PATH_BYTES = 103;
/** For the helper's request line, which it sends at once. */
const REQUEST_TIMEOUT_MS = 10000;
/** One request per run; prints the answer, or exits 1. */
const HELPER = `'use strict';
const socket = require('net').connect(process.env.ANTIGRAVITY_SSH_ASKPASS_SOCKET);
let reply = '';
socket.setEncoding('utf8');
socket.on('connect', () =>
  socket.write(JSON.stringify({
    token: process.env.ANTIGRAVITY_SSH_ASKPASS_TOKEN,
    message: process.argv[2] || '',
    kind: process.env.SSH_ASKPASS_PROMPT || '',
    ppid: process.ppid,
  }) + '\\n'));
socket.on('data', (chunk) => {
  reply += chunk;
  const end = reply.indexOf('\\n');
  if (end < 0) return;
  socket.destroy();
  let answer;
  try { answer = JSON.parse(reply.slice(0, end)).answer; } catch {}
  if (typeof answer === 'string') process.stdout.write(answer + '\\n');
  else process.exitCode = 1;
});
socket.on('error', () => (process.exitCode = 1));
socket.on('close', () => { if (!reply.includes('\\n')) process.exitCode = 1; });
`;
/** SSH_ASKPASS must name a program: on Windows a follow-up. */
function canPrompt() {
    return process.platform !== 'win32';
}
/** SSH_ASKPASS_PROMPT and ssh's raw text: what kind of question it is. */
function promptKind(hint, message) {
    if (hint === 'none') {
        return 'notice';
    }
    return hint === 'confirm' ||
        /\(yes\/no(?:\/\[fingerprint\])?\)[?:]\s*$/.test(message)
        ? 'confirm'
        : 'secret';
}
const cantPrompt = (why) => new types_1.RemoteError('UNKNOWN', `Can't answer ssh's prompts: ${why}`);
/**
 * Writes the helper and its sh wrapper into `userDataDir`/bin unless they're
 * there already; returns the wrapper, ssh's SSH_ASKPASS. ssh runs what's
 * there, so only you may write to that dir or to userData.
 */
async function installAskpass(userDataDir, nodeBinary) {
    const { real, why } = await (0, privateDir_1.checkPrivate)(userDataDir);
    if (why) {
        throw cantPrompt(`${userDataDir}: ${why}.`);
    }
    const binDir = path.join(real, 'bin');
    const helper = path.join(binDir, 'agy-askpass.js');
    const wrapper = path.join(binDir, 'agy-askpass');
    await fs.promises.mkdir(binDir, { recursive: true, mode: 0o700 });
    const stat = await fs.promises.lstat(binDir);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.()) {
        throw cantPrompt(`${binDir} must be a folder of yours.`);
    }
    // E.g. made under umask 002.
    if ((stat.mode & 0o022) !== 0) {
        await fs.promises.chmod(binDir, stat.mode & 0o7755);
    }
    try {
        await writeIfChanged(helper, HELPER, 0o600);
        await writeIfChanged(wrapper, (0, nodeWrapper_1.nodeWrapperScript)(nodeBinary, helper), 0o700);
    }
    catch (err) {
        // E.g. a folder in the way (EISDIR).
        const why = err instanceof Error && 'code' in err ? err.code : err;
        throw cantPrompt(`couldn't write the helper in ${binDir} (${String(why)}).`);
    }
    // E.g. userData on a noexec mount: ssh would get no answers.
    await fs.promises.access(wrapper, fs.constants.X_OK).catch(() => {
        throw cantPrompt(`${wrapper} can't run (is its folder mounted noexec?).`);
    });
    return wrapper;
}
/**
 * By rename, as ssh may be running the old file; chmod, as umask applies.
 * Keeps only a regular file of yours: a link, say, is replaced.
 */
async function writeIfChanged(file, content, mode) {
    const stat = await fs.promises.lstat(file).catch(() => undefined);
    const current = stat?.isFile() && stat.uid === process.getuid?.()
        ? await fs.promises.readFile(file, 'utf8').catch(() => null)
        : null;
    if (current !== content) {
        const temp = `${file}.${crypto.randomBytes(6).toString('hex')}`;
        try {
            await fs.promises.writeFile(temp, content, { mode, flag: 'wx' });
            await fs.promises.rename(temp, file);
        }
        finally {
            await fs.promises.rm(temp, { force: true });
        }
    }
    await fs.promises.chmod(file, mode);
}
/** What ssh reads as the answer to a `kind` prompt; undefined for Cancel. */
function answerText(kind, answer) {
    if (answer.kind === 'confirm' && kind === 'confirm') {
        return answer.yes ? 'yes' : 'no';
    }
    if (answer.kind === 'secret' &&
        kind === 'secret' &&
        Buffer.byteLength(answer.text) <= MAX_ANSWER_BYTES &&
        !/[\r\n\0]/.test(answer.text)) {
        return answer.text;
    }
    return undefined;
}
function reply(socket, answer) {
    socket.end(`${JSON.stringify(answer)}\n`);
}
/**
 * Events: `prompt` (true as one opens, false as it closes) and `cancel` (a
 * prompt got no answer: true if the user cancelled it, false if it couldn't
 * show or its answer was refused; it comes before ssh hears of it).
 */
class AskpassRelay extends events_1.EventEmitter {
    constructor(
    /** The wrapper: ssh's SSH_ASKPASS. */
    program, dir, ask) {
        super();
        this.program = program;
        this.dir = dir;
        this.ask = ask;
        this.token = crypto.randomBytes(32).toString('hex');
        this.server = net.createServer((socket) => this.accept(socket));
        this.sockets = new Set();
        /** One prompt at a time. */
        this.queue = Promise.resolve();
        /** Each asking ssh process's last secret prompt. */
        this.lastSecrets = new Map();
    }
    /**
     * Installs the helper in `userDataDir`/bin, and listens in a new private
     * dir.
     */
    static async start({ nodeBinary, ask }, userDataDir) {
        const program = await installAskpass(userDataDir, nodeBinary);
        const dir = await (0, privateDir_1.makePrivateDir)(userDataDir, "answer ssh's prompts", (d) => Buffer.byteLength(path.join(d, 's')) > MAX_SOCKET_PATH_BYTES
            ? `too long a path for a socket (over ${MAX_SOCKET_PATH_BYTES} bytes)`
            : undefined);
        const relay = new AskpassRelay(program, dir, ask);
        try {
            await new Promise((resolve, reject) => {
                relay.server.once('error', reject);
                relay.server.listen(relay.socketPath, () => {
                    relay.server.off('error', reject);
                    resolve();
                });
            });
        }
        catch (err) {
            await relay.dispose();
            throw err;
        }
        // E.g. EMFILE on accept: it costs that helper, whose ssh gets no answer.
        relay.server.on('error', () => { });
        return relay;
    }
    get socketPath() {
        return path.join(this.dir, 's');
    }
    /** `base` plus what makes ssh ask through the helper. */
    env(base) {
        const env = {
            ...base,
            SSH_ASKPASS: this.program,
            SSH_ASKPASS_REQUIRE: 'force',
            // OpenSSH before 8.4 asks only with a DISPLAY; macOS has later ones.
            ...(process.platform === 'linux' && base.DISPLAY === undefined
                ? { DISPLAY: '.' }
                : {}),
            ANTIGRAVITY_SSH_ASKPASS_SOCKET: this.socketPath,
            ANTIGRAVITY_SSH_ASKPASS_TOKEN: this.token,
        };
        // ssh sets it only for some prompts: an inherited one would misname the
        // rest.
        delete env.SSH_ASKPASS_PROMPT;
        return env;
    }
    /** Cancels the prompts, closes the socket and deletes its dir. */
    dispose() {
        this.disposing ?? (this.disposing = (async () => {
            // Each prompt ends with its helper's connection.
            for (const socket of this.sockets) {
                socket.destroy();
            }
            await new Promise((resolve) => this.server.close(() => resolve()));
            await fs.promises
                .rm(this.dir, { recursive: true, force: true })
                .catch(() => { });
        })());
        return this.disposing;
    }
    accept(socket) {
        if (this.disposing) {
            socket.destroy();
            return;
        }
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        // E.g. ECONNRESET: a helper that died before reading its answer.
        socket.on('error', () => { });
        socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
        let request = Buffer.alloc(0);
        const onData = (chunk) => {
            request = Buffer.concat([request, chunk]);
            const end = request.indexOf('\n');
            if ((end < 0 ? request.length : end) > MAX_REQUEST_BYTES) {
                socket.destroy();
            }
            else if (end >= 0) {
                socket.off('data', onData);
                socket.setTimeout(0);
                this.receive(socket, request.subarray(0, end).toString('utf8'));
            }
        };
        socket.on('data', onData);
    }
    receive(socket, line) {
        let request;
        try {
            request = JSON.parse(line);
        }
        catch {
            request = undefined;
        }
        const field = (name) => typeof request === 'object' && request !== null && name in request
            ? Reflect.get(request, name)
            : undefined;
        const token = field('token');
        const expected = Buffer.from(this.token);
        const given = Buffer.from(typeof token === 'string' ? token : '');
        if (given.length !== expected.length ||
            !crypto.timingSafeEqual(given, expected)) {
            socket.destroy();
            return;
        }
        const raw = field('message');
        const text = typeof raw === 'string' ? raw : '';
        const ppid = field('ppid');
        // Before capping: a long host key prompt still ends with its question.
        const kind = promptKind(field('kind'), text);
        const message = (0, types_1.sanitizeRemoteText)(text, MAX_PROMPT_CHARS, {
            keepNewlines: true,
        });
        const asker = typeof ppid === 'number' ? ppid : undefined;
        this.queue = this.queue
            .then(() => this.prompt(socket, kind, message, asker))
            .catch(() => void socket.destroy());
    }
    async prompt(socket, kind, message, asker) {
        if (this.disposing || socket.destroyed) {
            return;
        }
        const retry = kind === 'secret' && this.lastSecrets.get(asker) === message;
        if (kind === 'secret') {
            this.lastSecrets.set(asker, message);
        }
        const ended = new AbortController();
        const onGone = () => ended.abort();
        socket.once('close', onGone);
        // Unset if the prompt couldn't show.
        let answer;
        try {
            this.emit('prompt', true);
            answer = await this.ask({ kind, message, retry, signal: ended.signal });
        }
        catch {
            // Answered below as a cancel, but not the user's.
        }
        finally {
            socket.off('close', onGone);
            this.emit('prompt', false);
        }
        if (ended.signal.aborted) {
            return;
        }
        const text = answer && answerText(kind, answer);
        if (text === undefined) {
            // First, so ssh is stopped before it acts on it (an empty password).
            this.emit('cancel', answer?.kind === 'cancel');
            reply(socket, { cancel: true });
            return;
        }
        reply(socket, { answer: text });
    }
}
exports.AskpassRelay = AskpassRelay;
