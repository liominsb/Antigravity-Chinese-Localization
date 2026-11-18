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
exports.systemSshConfigPath = systemSshConfigPath;
exports.listSshConfigHosts = listSshConfigHosts;
exports.canonicalSshConfigFile = canonicalSshConfigFile;
exports.describeSshConfigProblem = describeSshConfigProblem;
exports.sshConfigProblemOfText = sshConfigProblemOfText;
exports.sshConfigProblemOfBytes = sshConfigProblemOfBytes;
exports.sshConfigFileProblem = sshConfigFileProblem;
exports.resolveSshConfigFile = resolveSshConfigFile;
exports.readSshConfigFile = readSshConfigFile;
// TODO(nathanjuan): Share with the IDE's SSH extension (Exafunction repo:
// antigravity/extensions/antigravity-remote-openssh, src/ssh/sshConfig.ts).
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const sshDestination_1 = require("./sshDestination");
const types_1 = require("./types");
/** Include levels below the top-level file (OpenSSH allows 16). */
const MAX_INCLUDE_DEPTH = 5;
/** Larger files are skipped: no real ssh config comes close. */
const MAX_CONFIG_FILE_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
/** Generous: the dialog filters as the user types. */
const MAX_CONFIG_HOSTS = 1000;
/** Then it returns the hosts read so far: a hung Include can't stall them. */
const READ_BUDGET_MS = 2000;
const TRAILING_BLANKS = ' \t\r\f\v';
/** Splits arguments like OpenSSH's argv_split(); null for unbalanced quotes. */
function splitArgs(s) {
    const args = [];
    let i = 0;
    while (i < s.length) {
        if (s[i] === ' ' || s[i] === '\t') {
            i++;
            continue;
        }
        if (s[i] === '#') {
            break;
        }
        let arg = '';
        let quote = '';
        for (; i < s.length; i++) {
            const ch = s[i];
            const next = s[i + 1];
            if (ch === '\\') {
                if (next === '"' ||
                    next === "'" ||
                    next === '\\' ||
                    (quote === '' && next === ' ')) {
                    arg += next;
                    i++;
                }
                else {
                    arg += ch;
                }
            }
            else if (quote === '' && (ch === ' ' || ch === '\t')) {
                break;
            }
            else if (quote === '' && (ch === '"' || ch === "'")) {
                quote = ch;
            }
            else if (quote !== '' && ch === quote) {
                quote = '';
            }
            else {
                arg += ch;
            }
        }
        if (quote !== '') {
            return null;
        }
        args.push(arg);
    }
    return args;
}
/** `Keyword args` or `Keyword = args`; null for lines without arguments. */
function parseConfigLine(line) {
    // A loop: a regex for this backtracks quadratically on long blank runs.
    let end = line.length;
    while (end > 0 && TRAILING_BLANKS.includes(line[end - 1])) {
        end--;
    }
    const m = /^[ \t]*([^ \t="]+)[ \t]*(?:=[ \t]*)?(.*)$/s.exec(line.slice(0, end));
    if (!m || m[1].startsWith('#')) {
        return null;
    }
    const args = splitArgs(m[2]);
    if (!args || args.length === 0) {
        return null;
    }
    return { keyword: m[1].toLowerCase(), args };
}
/**
 * Stringified missing values, never hosts. For example, the IDE's "Add
 * Cloudtop URL" command, run from the command palette, appends `Host
 * undefined` (with `HostName undefined`) to ~/.ssh/config.
 */
const MISSING_VALUE_ALIASES = new Set([
    'undefined',
    'null',
]);
/** True for patterns usable as-is as a destination (no wildcards etc.). */
function isConcreteAlias(pattern) {
    if (/[*?!]/.test(pattern) ||
        pattern.includes('@') ||
        MISSING_VALUE_ALIASES.has(pattern)) {
        return false;
    }
    try {
        // Skip anything ssh wouldn't take verbatim as a host (e.g. "a:22").
        return (0, sshDestination_1.parseSshDestination)(pattern).destination === pattern;
    }
    catch {
        return false;
    }
}
function hasGlob(s) {
    return /[*?]/.test(s);
}
function globToRegExp(glob) {
    const body = glob
        .split('')
        .map((ch) => {
        if (ch === '*') {
            return '.*';
        }
        if (ch === '?') {
            return '.';
        }
        return ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
    })
        .join('');
    return new RegExp(`^${body}$`, 's');
}
/**
 * One Include argument's files in lexical order, relative to `includeDir`;
 * `*` and `?` only in the last segment (dot files only for a leading `.`, as
 * glob(7)); `[` is literal. `~user` yields nothing.
 */
async function resolveInclude(spec, homeDir, includeDir) {
    let p = spec;
    if (p === '~' || p.startsWith('~/') || p.startsWith(`~${path.sep}`)) {
        p = path.join(homeDir, p.slice(1));
    }
    else if (p.startsWith('~')) {
        return [];
    }
    if (!path.isAbsolute(p)) {
        p = path.join(includeDir, p);
    }
    const dir = path.dirname(p);
    const base = path.basename(p);
    if (hasGlob(dir)) {
        return [];
    }
    if (!hasGlob(base)) {
        return [p];
    }
    let names;
    try {
        names = await fs.promises.readdir(dir);
    }
    catch {
        return []; // Unreadable: includes nothing, like ssh.
    }
    const re = globToRegExp(base);
    return names
        .filter((n) => re.test(n) && (base.startsWith('.') || !n.startsWith('.')))
        .sort()
        .map((n) => path.join(dir, n));
}
/**
 * `handle`'s bytes to its end, or null past MAX_CONFIG_FILE_BYTES: read in
 * chunks, as sizes can lie (procfs reports 0).
 */
async function readCapped(handle) {
    const chunks = [];
    let total = 0;
    for (;;) {
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(READ_CHUNK_BYTES), 0, READ_CHUNK_BYTES, null);
        if (bytesRead === 0) {
            return Buffer.concat(chunks, total);
        }
        total += bytesRead;
        if (total > MAX_CONFIG_FILE_BYTES) {
            return null;
        }
        // A copy: a short read mustn't keep the whole chunk.
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
}
/** A regular file's text; null if it isn't one, can't be read or is too big. */
async function readConfigFile(file) {
    let handle;
    try {
        // A FIFO mustn't block the walk.
        handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        if (!(await handle.stat()).isFile()) {
            return null;
        }
        return (await readCapped(handle))?.toString('utf8') ?? null;
    }
    catch {
        return null; // Unreadable: skipped, like ssh.
    }
    finally {
        await handle?.close().catch(() => { });
    }
}
function walkDone(state) {
    return state.hosts.size >= MAX_CONFIG_HOSTS || Date.now() >= state.deadline;
}
async function walkConfig(file, depth, state, includeDir) {
    if (walkDone(state)) {
        return;
    }
    let real;
    try {
        real = await fs.promises.realpath(file);
    }
    catch {
        return; // Missing files are ignored, like ssh does.
    }
    // Cycle-safe: re-read only from a shallower depth, where more Includes fit.
    const seen = state.seenDepth.get(real);
    if (seen !== undefined && seen <= depth) {
        return;
    }
    state.seenDepth.set(real, depth);
    const text = await readConfigFile(real);
    if (text === null) {
        return;
    }
    // Only Includes outside Match blocks and Host blocks other than `Host *`:
    // ssh reads the others only for the hosts they match (ssh_config(5)).
    let conditional = false;
    for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
        const line = parseConfigLine(raw);
        if (!line) {
            continue;
        }
        if (line.keyword === 'host') {
            conditional = line.args.some((pattern) => pattern !== '*');
            for (const pattern of line.args) {
                if (state.hosts.size >= MAX_CONFIG_HOSTS) {
                    return;
                }
                if (isConcreteAlias(pattern)) {
                    state.hosts.add(pattern);
                }
            }
        }
        else if (line.keyword === 'match') {
            // A Match block runs until the next Host/Match line.
            conditional = true;
        }
        else if (line.keyword === 'include' &&
            !conditional &&
            depth < MAX_INCLUDE_DEPTH) {
            for (const spec of line.args) {
                if (walkDone(state)) {
                    break;
                }
                for (const included of await resolveInclude(spec, state.homeDir, includeDir)) {
                    await walkConfig(included, depth + 1, state, includeDir);
                }
            }
        }
    }
}
/** Where OpenSSH reads its system config: on Windows, under %PROGRAMDATA%. */
function systemSshConfigPath(platform = process.platform, env = process.env) {
    return platform === 'win32'
        ? // '||': an empty value means unset.
            path.join(env.PROGRAMDATA || 'C:\\ProgramData', 'ssh', 'ssh_config')
        : '/etc/ssh/ssh_config';
}
/**
 * The first MAX_CONFIG_HOSTS concrete `Host` aliases of the user's ssh config,
 * then the system one, in first-seen order, as read within READ_BUDGET_MS;
 * each passes parseSshDestination as is. Never throws.
 */
async function listSshConfigHosts(opts = {}) {
    const homeDir = opts.homeDir ?? os.homedir();
    const configPath = path.resolve(opts.configPath ?? path.join(homeDir, '.ssh', 'config'));
    // Not '??': null skips it.
    const systemPath = opts.systemConfigPath === undefined
        ? systemSshConfigPath()
        : opts.systemConfigPath;
    const state = {
        homeDir,
        hosts: new Set(),
        seenDepth: new Map(),
        deadline: Date.now() + READ_BUDGET_MS,
    };
    const walk = async () => {
        await walkConfig(configPath, 0, state, path.join(homeDir, '.ssh'));
        if (systemPath !== null) {
            const resolved = path.resolve(systemPath);
            await walkConfig(resolved, 0, state, path.dirname(resolved));
        }
    };
    // Raced too: the deadline can't end an fs call that hangs (e.g. on NFS).
    let timer;
    await Promise.race([
        walk(),
        new Promise((resolve) => {
            timer = setTimeout(resolve, READ_BUDGET_MS);
        }),
    ]);
    clearTimeout(timer);
    return [...state.hosts];
}
/**
 * The real path (symlinks resolved) of a config file for a host, or undefined
 * if it's the default ~/.ssh/config: ssh then also reads the system config.
 */
async function canonicalSshConfigFile(file, homeDir = os.homedir()) {
    const real = (p) => fs.promises.realpath(p).catch(() => path.resolve(p));
    const [configFile, defaultFile] = await Promise.all([
        real(file),
        real(path.join(homeDir, '.ssh', 'config')),
    ]);
    return configFile === defaultFile ? undefined : configFile;
}
/** Not "That SSH host isn't valid": the host is fine. */
const invalid = (problem) => new types_1.RemoteError('INVALID_DESTINATION', `SSH 配置文件${problem}`, {
    explainsItself: true,
});
/**
 * A Windows drive's path: a UNC, \\?\ or \??\ path could reach a server,
 * sending it this computer's credentials.
 */
const DRIVE_PATH = /^[A-Za-z]:\\/;
/**
 * As ssh checks ~/.ssh/config (it doesn't check -F files): a regular file
 * only you or root can change. Not on Windows, which has no such owners.
 */
function checkConfigStat(stat, shown) {
    if (!stat.isFile()) {
        throw invalid(` ${shown} 不是常规文件。`);
    }
    if (process.platform !== 'win32' &&
        ((stat.uid !== 0 && stat.uid !== process.getuid?.()) ||
            (stat.mode & 0o022) !== 0)) {
        throw invalid(` ${shown} 可被其他用户修改：该文件必须归您本人或 root 所有，且不可对用户组或其他用户开放写权限。`);
    }
}
const NOT_CONFIG = '不是有效的 SSH 配置文件';
const CHOOSE_CONFIG = '请选择包含 ssh 配置项的文件（例如 ~/.ssh/config）。';
const UNREADABLE = '的保存格式无法被 ssh 读取';
const SAVE_AS_UTF8 = '请将其另存为不带 BOM 的 UTF-8 编码格式。';
const notConfig = (why) => ({
    what: NOT_CONFIG,
    why,
    fix: CHOOSE_CONFIG,
});
const BINARY = notConfig('这是一个二进制文件');
const KEY = notConfig('该文件包含私钥或证书内容');
const PUBLIC_KEYS = notConfig('该文件包含 SSH 公钥（例如 .pub 或 authorized_keys 文件）');
const HOST_KEYS = notConfig('该文件记录的是 SSH 主机密钥（例如 known_hosts）');
// OpenSSH reads a byte-order mark as part of the first keyword.
const BOM = {
    what: UNREADABLE,
    why: '文件开头包含字节顺序标记 (BOM)',
    fix: SAVE_AS_UTF8,
};
const UTF16 = {
    what: UNREADABLE,
    why: '文件保存为了 UTF-16 编码',
    fix: SAVE_AS_UTF8,
};
/** "<file> <what>: <why>. <fix>" */
function describeSshConfigProblem(file, { what, why, fix }) {
    return `${file} ${what}：${why}。${fix}`;
}
/** How much of a file sshConfigFileProblem reads. */
const SNIFF_BYTES = 64 * 1024;
/**
 * An SSH key type, as known_hosts, authorized_keys and .pub files name it. A
 * certificate's adds -cert-v01, before a security key's @openssh.com.
 */
const KEY_TYPE = '(?:(?:ssh-(?:rsa|dss|ed25519|ed448)|ecdsa-sha2-nistp\\d+)(?:-cert-v01@openssh\\.com)?|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)(?:-cert-v01)?@openssh\\.com)';
/** A key type and its key; the base64 starts AAAA (a length prefix). */
const KEY_AND_BLOB = `${KEY_TYPE}[ \\t]+AAAA[0-9A-Za-z+/]`;
const PUBLIC_KEY_LINE = new RegExp(`^${KEY_AND_BLOB}`);
/** An authorized_keys option, as sshd(8) lists them, maybe with a value. */
const AUTHORIZED_KEY_OPTION = '(?:agent-forwarding|cert-authority|command|environment|expiry-time|from|no-agent-forwarding|no-port-forwarding|no-pty|no-touch-required|no-user-rc|no-x11-forwarding|permitlisten|permitopen|port-forwarding|principals|pty|restrict|tunnel|user-rc|verify-required|x11-forwarding)(?:="(?:[^"\\\\]|\\\\.)*")?';
/** A key after authorized_keys options, which are comma-separated. */
const AUTHORIZED_KEY_LINE = new RegExp(`^${AUTHORIZED_KEY_OPTION}(?:,${AUTHORIZED_KEY_OPTION})*[ \\t]+${KEY_AND_BLOB}`, 'i');
/** `[@marker] hosts key-type key`, or a hashed `|1|salt|hash` entry. */
const KNOWN_HOSTS_LINE = new RegExp(`^(?:\\|1\\||(?:@(?:cert-authority|revoked)[ \\t]+)?[^ \\t]+[ \\t]+${KEY_AND_BLOB})`);
/** PEM, OpenSSH and RFC 4716 armor, or a PuTTY key. */
const KEY_ARMOR = /^(?:-{4,5} ?BEGIN [A-Z0-9 ]+-{4,5}$|PuTTY-User-Key-File-\d+: )/;
/** C0 controls but whitespace, and DEL: no ssh setting has them. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\x00-\x08\x0e-\x1f\x7f]/;
/**
 * Why ssh can't use `text` (a file's start) as its config, or undefined if
 * it may. Judged by the first line that isn't blank or a comment, cut at a
 * NUL as ssh cuts it: ssh would refuse key material or binary there as
 * unknown options, as it did for a chosen known_hosts.
 */
function sshConfigProblemOfText(text) {
    if (text.startsWith('\uFEFF')) {
        return BOM;
    }
    for (const raw of text.split('\n')) {
        const line = raw.split('\0', 1)[0].trim();
        if (line === '' || line.startsWith('#')) {
            continue;
        }
        if (CONTROL_CHAR.test(line)) {
            return BINARY;
        }
        if (KEY_ARMOR.test(line)) {
            return KEY;
        }
        if (PUBLIC_KEY_LINE.test(line) || AUTHORIZED_KEY_LINE.test(line)) {
            return PUBLIC_KEYS;
        }
        if (KNOWN_HOSTS_LINE.test(line)) {
            return HOST_KEYS;
        }
        return undefined;
    }
    return undefined;
}
/** Leading bytes of binary formats a file picker often lands on. */
const BINARY_MAGIC = [
    [0x4d, 0x5a], // MZ: a Windows executable, such as ssh.exe
    [0x7f, 0x45, 0x4c, 0x46], // ELF
    [0xfe, 0xed, 0xfa, 0xce], // Mach-O
    [0xfe, 0xed, 0xfa, 0xcf],
    [0xce, 0xfa, 0xed, 0xfe],
    [0xcf, 0xfa, 0xed, 0xfe],
    [0xca, 0xfe, 0xba, 0xbe], // a universal Mach-O
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0xff, 0xd8, 0xff], // JPEG
    [0x47, 0x49, 0x46, 0x38], // GIF8
    [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
    [0x50, 0x4b, 0x03, 0x04], // zip
    [0x1f, 0x8b], // gzip
    [...Buffer.from('SQLite format 3\0')],
].map((bytes) => Buffer.from(bytes));
/**
 * Whether `bytes` start as UTF-16 text (a BOM, or ASCII with every other byte
 * NUL), as PowerShell 5's `>` writes it: ssh reads only UTF-8.
 */
function isUtf16(bytes) {
    if (bytes.length >= 2 &&
        ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
            (bytes[0] === 0xfe && bytes[1] === 0xff))) {
        return true;
    }
    const pairs = Math.min(bytes.length, 64) >> 1;
    if (pairs < 2) {
        return false;
    }
    let le = true;
    let be = true;
    for (let i = 0; i < pairs * 2; i += 2) {
        le && (le = bytes[i] !== 0 && bytes[i + 1] === 0);
        be && (be = bytes[i] === 0 && bytes[i + 1] !== 0);
    }
    return le || be;
}
/** sshConfigProblemOfText of a file's first bytes, which may not be UTF-8. */
function sshConfigProblemOfBytes(bytes) {
    if (isUtf16(bytes)) {
        return UTF16;
    }
    if (BINARY_MAGIC.some((magic) => bytes.subarray(0, magic.length).equals(magic))) {
        return BINARY;
    }
    return sshConfigProblemOfText(bytes.toString('utf8'));
}
/**
 * sshConfigProblemOfBytes of a file's first 64 KiB; undefined if it can't
 * be read (other checks report that).
 */
async function sshConfigFileProblem(file) {
    let handle;
    try {
        // A FIFO mustn't block.
        handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
        return sshConfigProblemOfBytes(buffer.subarray(0, bytesRead));
    }
    catch {
        return undefined;
    }
    finally {
        await handle?.close().catch(() => { });
    }
}
/**
 * Checks a config file for a host (`ssh -F`): an absolute path on one line
 * (on Windows, on a drive and not on a share), naming a file checkConfigStat
 * takes, that ssh can read as its config (see sshConfigFileProblem). Returns
 * canonicalSshConfigFile's path. Rejects with INVALID_DESTINATION, or
 * SSH_CONFIG_INVALID for the file's contents, saying why.
 */
async function resolveSshConfigFile(file, homeDir = os.homedir()) {
    if (/[\0\r\n]/.test(file)) {
        throw invalid('路径必须位于单行内。');
    }
    const shown = (0, types_1.sanitizeRemoteText)(file, 200);
    const win32 = process.platform === 'win32';
    if (!(win32 ? path.win32 : path).isAbsolute(file)) {
        throw invalid(`必须是绝对路径（当前为 ${shown}）。`);
    }
    // Resolved first, so that what's opened is what's checked.
    const local = win32 ? path.win32.resolve(file) : file;
    if (win32 && !DRIVE_PATH.test(local)) {
        throw invalid(`必须位于本机磁盘驱动器上（当前为 ${shown}）。`);
    }
    const configFile = await canonicalSshConfigFile(local, homeDir);
    if (configFile === undefined) {
        return undefined;
    }
    // A mapped drive's real path is its share's.
    if (win32 && !DRIVE_PATH.test(configFile)) {
        throw invalid(`不能位于网络共享路径上 (${shown})。`);
    }
    let stat;
    try {
        stat = await fs.promises.stat(configFile);
    }
    catch {
        throw invalid(` ${shown} 不存在或无法读取。`);
    }
    checkConfigStat(stat, shown);
    const problem = await sshConfigFileProblem(configFile);
    if (problem !== undefined) {
        throw new types_1.RemoteError('SSH_CONFIG_INVALID', describeSshConfigProblem(shown, problem), { explainsItself: true });
    }
    return configFile;
}
/**
 * A host's config file (canonical), read through one fd that checkConfigStat
 * takes: ssh gets a copy of exactly what was checked, on every spawn.
 */
async function readSshConfigFile(file) {
    const shown = (0, types_1.sanitizeRemoteText)(file, 200);
    const unreadable = () => invalid(` ${shown} 不存在或无法读取。`);
    let handle;
    try {
        // The canonical path names the file itself; a FIFO mustn't block.
        handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    }
    catch (err) {
        // E.g. a dotfile manager's link: its target is another file, another host.
        throw err instanceof Error && 'code' in err && err.code === 'ELOOP'
            ? invalid(` ${shown} 已变为符号链接：请重新选择该文件。`)
            : unreadable();
    }
    try {
        checkConfigStat(await handle.stat(), shown);
        const bytes = await readCapped(handle).catch(() => {
            throw unreadable();
        });
        if (bytes === null) {
            throw invalid(` ${shown} 体积超过 4 MiB 上限。`);
        }
        return bytes;
    }
    finally {
        await handle.close();
    }
}
