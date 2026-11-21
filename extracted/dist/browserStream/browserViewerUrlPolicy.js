"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BLOB_BYTES = exports.MAX_BLOB_DIMENSION_PX = exports.MAX_INPUT_TEXT_BYTES = exports.MAX_INPUT_KEY_BYTES = exports.MAX_INPUT_MODIFIERS = exports.MAX_INPUT_CLICK_COUNT = exports.MAX_INPUT_BUTTONS = exports.MAX_INPUT_COORD = exports.MAX_ICE_CREDENTIAL_BYTES = exports.MAX_ICE_SERVER_URLS = exports.MAX_ICE_SERVERS = exports.MAX_URL_BYTES = exports.MAX_SDP_BYTES = exports.MIN_CONTROL_TOKEN_BYTES = exports.MAX_VIEWER_SESSION_ID_BYTES = exports.MAX_TAB_KEY_BYTES = void 0;
exports.isValidRootConversationId = isValidRootConversationId;
exports.parseConversationTabKey = parseConversationTabKey;
exports.isValidViewerSessionId = isValidViewerSessionId;
exports.isValidControlToken = isValidControlToken;
exports.validateBrowserViewerSdp = validateBrowserViewerSdp;
exports.validateBrowserViewerIceServers = validateBrowserViewerIceServers;
exports.validateBrowserViewerNavigateUrl = validateBrowserViewerNavigateUrl;
exports.validateProtoInputEvent = validateProtoInputEvent;
exports.toCdpInputAction = toCdpInputAction;
exports.parseJpegDimensions = parseJpegDimensions;
/**
 * Stateless protocol limit constants, boundary validators, and wire/CDP codecs
 * for the `browser_viewer` actuator.
 */
const browser_viewer_pb_1 = require("../proto/browser_viewer_pb");
const webviewBrowser_1 = require("../webviewBrowser");
exports.MAX_TAB_KEY_BYTES = 256;
exports.MAX_VIEWER_SESSION_ID_BYTES = 256;
exports.MIN_CONTROL_TOKEN_BYTES = 32;
exports.MAX_SDP_BYTES = 65536;
exports.MAX_URL_BYTES = 8192;
exports.MAX_ICE_SERVERS = 16;
exports.MAX_ICE_SERVER_URLS = 8;
exports.MAX_ICE_CREDENTIAL_BYTES = 512;
exports.MAX_INPUT_COORD = 100000;
exports.MAX_INPUT_BUTTONS = 31;
exports.MAX_INPUT_CLICK_COUNT = 16;
exports.MAX_INPUT_MODIFIERS = 15;
exports.MAX_INPUT_KEY_BYTES = 64;
exports.MAX_INPUT_TEXT_BYTES = 65536;
exports.MAX_BLOB_DIMENSION_PX = 8192;
exports.MAX_BLOB_BYTES = 8 * 1024 * 1024;
const TAB_KEY_PREFIX = 'builtin-browser:';
const RESERVED_SCOPE_RE = /^(?:global|home|newconversation|customview)$/i;
const SDP_CANDIDATE_PREFIX = 'a=candidate:';
// Explicit ASCII `[Ss][Hh][Aa]-256` avoids Unicode `U+017F` (`ſ`) case-folding.
const SDP_FINGERPRINT_RE = /^a=fingerprint:(?:[Ss][Hh][Aa]-256) ([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31})$/;
const ICE_SERVER_URL_RE = /^(?:[Ss][Tt][Uu][Nn][Ss]?|[Tt][Uu][Rr][Nn][Ss]?):(.+)$/;
const HTTP_SCHEME_RE = /^[Hh][Tt][Tt][Pp][Ss]?:\/\//;
const EXTRA_METADATA_HOST_RE = /^(?:metadata|instance-data|(?:.+\.)?instance-data\.ec2\.internal|192\.0\.0\.192|\[::(?:ffff:)?c000:c0\])$/;
const LONE_SURROGATE_RE = /[\ud800-\udfff]/u;
const BLINK_KEY_TEXT_CAP_UTF16 = 4;
const BUTTON_NAMES = ['left', 'middle', 'right', 'back', 'forward'];
const DRAG_BUTTONS = ['left', 'right', 'middle'];
function hasControlChar(s, allowLf = false) {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if ((c <= 0x1f && (!allowLf || c !== 0x0a)) || (c >= 0x7f && c <= 0x9f)) {
            return true;
        }
    }
    return false;
}
function isValidUtf8(s, min, max) {
    if (typeof s !== 'string' || LONE_SURROGATE_RE.test(s)) {
        return false;
    }
    const bytes = Buffer.byteLength(s, 'utf8');
    return bytes >= min && bytes <= max;
}
const isCtrlFree = (s, min, max) => typeof s === 'string' && isValidUtf8(s, min, max) && !hasControlChar(s);
const isToken = (s, min, max) => typeof s === 'string' && isCtrlFree(s, min, max) && !/\s/.test(s);
const isNulFree = (s, max) => typeof s === 'string' && isValidUtf8(s, 0, max) && !s.includes('\0');
const isIceUrl = (u) => isToken(u, 1, exports.MAX_URL_BYTES) && ICE_SERVER_URL_RE.test(u);
/** Validates a non-reserved conversation scope token (`1..256` UTF-8 bytes). */
function isValidRootConversationId(id) {
    return (isToken(id, 1, exports.MAX_TAB_KEY_BYTES) &&
        !id.includes(':') &&
        !RESERVED_SCOPE_RE.test(id));
}
/** Parses `builtin-browser:<rootConversationId>:<tabId>`, or `null` if invalid. */
function parseConversationTabKey(tabKey) {
    const ok = isToken(tabKey, 1, exports.MAX_TAB_KEY_BYTES) && tabKey.startsWith(TAB_KEY_PREFIX);
    const rest = ok ? tabKey.slice(TAB_KEY_PREFIX.length) : '';
    const sep = rest.indexOf(':');
    const rootConversationId = sep > 0 ? rest.slice(0, sep) : '';
    const tabId = sep > 0 ? rest.slice(sep + 1) : '';
    return isValidRootConversationId(rootConversationId) && tabId !== ''
        ? { rootConversationId, tabId }
        : null;
}
/** Validates a whitespace- and control-free viewer session ID (`1..256` bytes). */
function isValidViewerSessionId(sessionId) {
    return isToken(sessionId, 1, exports.MAX_VIEWER_SESSION_ID_BYTES);
}
/** Validates an unguessable remote-control lease token (`32..256` bytes). */
function isValidControlToken(token) {
    return isToken(token, exports.MIN_CONTROL_TOKEN_BYTES, exports.MAX_VIEWER_SESSION_ID_BYTES);
}
/** Validates a WebRTC SDP offer or answer (`v=0`, `<= 64 KiB`, `sha-256` DTLS). */
function validateBrowserViewerSdp(sdp, opts) {
    const norm = isValidUtf8(sdp, 1, exports.MAX_SDP_BYTES)
        ? sdp.replace(/\r\n/g, '\n')
        : '';
    const lines = norm && !hasControlChar(norm, true) ? norm.split('\n') : [];
    if (lines[0] !== 'v=0') {
        return false;
    }
    let hasCand = false;
    let fp = '';
    for (const line of lines) {
        hasCand || (hasCand = line.startsWith(SDP_CANDIDATE_PREFIX) &&
            line.length > SDP_CANDIDATE_PREFIX.length);
        if (line.toLowerCase().includes('a=fingerprint')) {
            const digest = SDP_FINGERPRINT_RE.exec(line)?.[1].toLowerCase() ?? '';
            if (!digest || (fp !== '' && fp !== digest)) {
                return false;
            }
            fp = digest;
        }
    }
    return fp !== '' && (!(opts?.requireCandidate ?? true) || hasCand);
}
/** Validates and clones up to 16 STUN/TURN server entries, or `null` if invalid. */
function validateBrowserViewerIceServers(servers) {
    if (!Array.isArray(servers) || servers.length > exports.MAX_ICE_SERVERS) {
        return null;
    }
    const out = [];
    for (const s of servers) {
        const raw = s && typeof s === 'object' && Array.isArray(s.urls) ? s.urls : null;
        const urls = raw && raw.length >= 1 && raw.length <= exports.MAX_ICE_SERVER_URLS
            ? [...raw]
            : [];
        if (urls.length === 0 ||
            !isCtrlFree(s?.username, 0, exports.MAX_ICE_CREDENTIAL_BYTES) ||
            !isCtrlFree(s?.credential, 0, exports.MAX_ICE_CREDENTIAL_BYTES) ||
            !urls.every(isIceUrl)) {
            return null;
        }
        out.push({
            urls,
            ...(s.username ? { username: s.username } : {}),
            ...(s.credential ? { credential: s.credential } : {}),
        });
    }
    return out;
}
/** Validates an `http:`/`https:` remote navigation URL against SSRF and OAuth rules. */
function validateBrowserViewerNavigateUrl(rawUrl) {
    if (!isCtrlFree(rawUrl, 1, exports.MAX_URL_BYTES) ||
        rawUrl !== rawUrl.trim() ||
        !HTTP_SCHEME_RE.test(rawUrl)) {
        return false;
    }
    const preQuery = rawUrl.split(/[?#]/, 1)[0];
    const rawAuth = preQuery.slice(preQuery.indexOf('://') + 3).split('/', 1)[0];
    if (preQuery.includes('\\') || rawAuth === '' || rawAuth.includes('@')) {
        return false;
    }
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return false;
    }
    const badLabels = !parsed.hostname.startsWith('[') &&
        (parsed.hostname.startsWith('.') || parsed.hostname.includes('..'));
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    return ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.username === '' &&
        parsed.password === '' &&
        host !== '' &&
        !badLabels &&
        !EXTRA_METADATA_HOST_RE.test(host) &&
        !(0, webviewBrowser_1.isExternalOnlyAuthUrl)(rawUrl) &&
        (0, webviewBrowser_1.validateWebviewNavigationUrl)(rawUrl, 'http://127.0.0.1').allowed);
}
const isCoord = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= exports.MAX_INPUT_COORD;
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const posInt = (n) => (n && n > 0 ? n : 0);
/** Validates a protobuf `BrowserViewerInputEvent` into a `CaptureInputEvent`. */
function validateProtoInputEvent(ev) {
    if (!ev ||
        typeof ev !== 'object' ||
        ![ev.x, ev.y, ev.deltaX, ev.deltaY].every(isCoord) ||
        !isInt(ev.kind, browser_viewer_pb_1.BrowserViewerInputEvent_Kind.POINTER_DOWN, browser_viewer_pb_1.BrowserViewerInputEvent_Kind.PASTE) ||
        !isInt(ev.button, browser_viewer_pb_1.BrowserViewerInputEvent_MouseButton.UNSPECIFIED, browser_viewer_pb_1.BrowserViewerInputEvent_MouseButton.FORWARD) ||
        !isInt(ev.buttons, 0, exports.MAX_INPUT_BUTTONS) ||
        !isInt(ev.clickCount, 0, exports.MAX_INPUT_CLICK_COUNT) ||
        !isInt(ev.modifiers, 0, exports.MAX_INPUT_MODIFIERS) ||
        !isInt(ev.keyCode, 0, 0x7fffffff) ||
        typeof ev.repeat !== 'boolean' ||
        ![ev.key, ev.code].every((k) => isNulFree(k, exports.MAX_INPUT_KEY_BYTES)) ||
        !isNulFree(ev.text, exports.MAX_INPUT_TEXT_BYTES) ||
        (ev.kind === browser_viewer_pb_1.BrowserViewerInputEvent_Kind.PASTE && ev.text.length === 0)) {
        return null;
    }
    const xy = { x: ev.x || 0, y: ev.y || 0 };
    const modOpt = ev.modifiers > 0 ? { modifiers: ev.modifiers } : {};
    const ptr = {
        ...xy,
        ...(ev.buttons > 0 ? { buttons: ev.buttons } : {}),
        ...modOpt,
    };
    const btn = BUTTON_NAMES[ev.button - browser_viewer_pb_1.BrowserViewerInputEvent_MouseButton.LEFT];
    switch (ev.kind) {
        case browser_viewer_pb_1.BrowserViewerInputEvent_Kind.POINTER_DOWN:
        case browser_viewer_pb_1.BrowserViewerInputEvent_Kind.POINTER_UP:
            return {
                ...ptr,
                kind: ev.kind === browser_viewer_pb_1.BrowserViewerInputEvent_Kind.POINTER_DOWN ? 'pointerdown' : 'pointerup',
                button: btn ?? 'left',
                clickCount: ev.clickCount || 1,
            };
        case browser_viewer_pb_1.BrowserViewerInputEvent_Kind.POINTER_MOVE:
            return {
                ...ptr,
                ...(ev.clickCount > 0 ? { clickCount: ev.clickCount } : {}),
                kind: 'pointermove',
                button: btn ?? 'none',
            };
        case browser_viewer_pb_1.BrowserViewerInputEvent_Kind.WHEEL:
            return {
                ...xy,
                ...modOpt,
                kind: 'wheel',
                deltaX: ev.deltaX || 0,
                deltaY: ev.deltaY || 0,
            };
        case browser_viewer_pb_1.BrowserViewerInputEvent_Kind.KEY_DOWN:
        case browser_viewer_pb_1.BrowserViewerInputEvent_Kind.KEY_UP: {
            const base = {
                key: ev.key,
                ...(ev.code ? { code: ev.code } : {}),
                ...(ev.keyCode > 0 ? { keyCode: ev.keyCode } : {}),
                ...(ev.repeat ? { repeat: true } : {}),
                ...modOpt,
            };
            return ev.kind === browser_viewer_pb_1.BrowserViewerInputEvent_Kind.KEY_UP
                ? { kind: 'keyup', ...base }
                : { kind: 'keydown', ...base, ...(ev.text ? { text: ev.text } : {}) };
        }
        case browser_viewer_pb_1.BrowserViewerInputEvent_Kind.PASTE:
            return { kind: 'paste', text: ev.text };
        default:
            return null;
    }
}
function resolveKeyDownText(ev, modifiers) {
    if (ev.kind !== 'keydown' || (modifiers & 7) !== 0) {
        return '';
    }
    if (ev.text &&
        ev.text.length < BLINK_KEY_TEXT_CAP_UTF16 &&
        !ev.text.includes('\0')) {
        return ev.text;
    }
    const ch = !ev.key.includes('\0') && [...ev.key].length === 1 ? ev.key : '';
    return ev.key === 'Enter' ? '\r' : ch;
}
/** Converts a `CaptureInputEvent` into a CDP or history host dispatch action. */
function toCdpInputAction(event) {
    if (event.kind === 'paste') {
        return { type: 'paste', text: event.text };
    }
    const modifiers = posInt(event.modifiers);
    const modOpt = modifiers > 0 ? { modifiers } : {};
    if (event.kind === 'keydown' || event.kind === 'keyup') {
        const text = resolveKeyDownText(event, modifiers);
        const vk = posInt(event.keyCode);
        return {
            type: 'key',
            params: {
                type: event.kind === 'keyup' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
                ...(event.key ? { key: event.key } : {}),
                ...(event.code ? { code: event.code } : {}),
                ...(text ? { text, unmodifiedText: text } : {}),
                ...(vk > 0 ? { windowsVirtualKeyCode: vk } : {}),
                ...modOpt,
                ...(event.repeat ? { autoRepeat: true } : {}),
            },
        };
    }
    const xy = { x: event.x || 0, y: event.y || 0 };
    if (event.kind === 'wheel') {
        return {
            type: 'mouse',
            params: {
                ...xy,
                ...modOpt,
                button: 'none',
                type: 'mouseWheel',
                deltaX: event.deltaX || 0,
                deltaY: event.deltaY || 0,
            },
        };
    }
    const buttons = posInt(event.buttons);
    const base = { ...xy, ...(buttons > 0 ? { buttons } : {}), ...modOpt };
    const click = posInt(event.clickCount);
    if (event.kind === 'pointermove') {
        const drag = DRAG_BUTTONS.find((_, i) => (buttons & (1 << i)) !== 0) ?? 'none';
        const b = event.button;
        const button = b === 'left' || b === 'middle' || b === 'right' ? b : drag;
        return {
            type: 'mouse',
            params: {
                ...base,
                ...(click > 0 ? { clickCount: click } : {}),
                type: 'mouseMoved',
                button,
            },
        };
    }
    if (event.button === 'back' || event.button === 'forward') {
        return event.kind === 'pointerdown'
            ? { type: 'history', direction: event.button }
            : { type: 'noop' };
    }
    return {
        type: 'mouse',
        params: {
            ...base,
            type: event.kind === 'pointerdown' ? 'mousePressed' : 'mouseReleased',
            button: event.button ?? 'left',
            clickCount: click || 1,
        },
    };
}
/** Extracts positive `(widthPx, heightPx)` from the first JPEG SOF segment. */
function parseJpegDimensions(data) {
    if (!(data instanceof Uint8Array) || data[0] !== 0xff || data[1] !== 0xd8) {
        return null;
    }
    let i = 2;
    while (i < data.byteLength) {
        let marker = data[i] === 0xff ? 0xff : 0x00;
        while (data[i] === 0xff) {
            i++;
        }
        marker = marker === 0xff && i < data.byteLength ? data[i++] : 0x00;
        if (marker === 0x00 || marker === 0xd9 || marker === 0xda) {
            return null;
        }
        if (marker === 0xd8 ||
            marker === 0x01 ||
            (marker >= 0xd0 && marker <= 0xd7)) {
            continue;
        }
        const segLen = i + 2 <= data.byteLength ? (data[i] << 8) | data[i + 1] : 0;
        if (segLen < 2 || i + segLen > data.byteLength) {
            return null;
        }
        if (marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc) {
            const nf = segLen >= 8 ? data[i + 7] : 0;
            const ok = nf > 0 && segLen === 8 + 3 * nf;
            const h = ok ? (data[i + 3] << 8) | data[i + 4] : 0;
            const w = ok ? (data[i + 5] << 8) | data[i + 6] : 0;
            return w >= 1 && h >= 1 ? { widthPx: w, heightPx: h } : null;
        }
        i += segLen;
    }
    return null;
}
