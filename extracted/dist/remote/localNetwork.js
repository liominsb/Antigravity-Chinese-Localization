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
exports.isWebUrl = isWebUrl;
exports.isRemoteOpenableUrl = isRemoteOpenableUrl;
exports.parseIPv6 = parseIPv6;
exports.isLocalNetworkHost = isLocalNetworkHost;
/**
 * Address classification for content served by an SSH remote: which hosts
 * count as the laptop's own loopback or private network. Pure (no
 * Electron); SshConnection uses it for the URLs the remote asks to open.
 */
const net = __importStar(require("net"));
function isWebUrl(url) {
    try {
        const { protocol } = new URL(url);
        return protocol === 'https:' || protocol === 'http:';
    }
    catch {
        return false;
    }
}
/** Never local: the browser would take its cookies to laptop/LAN services. */
function isRemoteOpenableUrl(url) {
    return isWebUrl(url) && !isLocalNetworkHost(new URL(url).hostname);
}
/** Parses an IPv6 literal (no brackets) into eight 16-bit groups. */
function parseIPv6(text) {
    let s = text.toLowerCase();
    const zone = s.indexOf('%');
    if (zone >= 0) {
        s = s.slice(0, zone);
    }
    if (!net.isIPv6(s)) {
        return undefined;
    }
    // A trailing dotted IPv4 part stands for the last two groups.
    const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (dotted) {
        const v4 = parseIPv4(dotted[1]);
        if (!v4) {
            return undefined;
        }
        s =
            s.slice(0, dotted.index) +
                ((v4[0] << 8) | v4[1]).toString(16) +
                ':' +
                ((v4[2] << 8) | v4[3]).toString(16);
    }
    const halves = s.split('::');
    if (halves.length > 2) {
        return undefined;
    }
    const toGroups = (part) => part === '' ? [] : part.split(':').map((g) => parseInt(g, 16));
    const head = toGroups(halves[0]);
    const tail = halves.length === 2 ? toGroups(halves[1]) : [];
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
    if (fill < 0) {
        return undefined;
    }
    const groups = [...head, ...new Array(fill).fill(0), ...tail];
    return groups.length === 8 &&
        groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
        ? groups
        : undefined;
}
function parseIPv4(text) {
    if (!net.isIPv4(text)) {
        return undefined;
    }
    return text.split('.').map((o) => Number(o));
}
function isLocalIPv4([a, b]) {
    return (a === 0 || // "this network"; 0.0.0.0 reaches the local host
        a === 127 || // loopback
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) || // link-local, cloud metadata
        (a === 100 && b >= 64 && b <= 127) || // CGNAT (e.g. Tailscale)
        a >= 224 // multicast 224/4, reserved 240/4, broadcast
    );
}
/**
 * Whether a `URL.hostname` is loopback, private, link-local, CGNAT, multicast
 * or reserved. Not resolved: the browser resolves it again (rebinding).
 */
function isLocalNetworkHost(hostname) {
    let h = hostname.toLowerCase();
    if (h.endsWith('.')) {
        h = h.slice(0, -1);
    }
    if (h === 'localhost' || h.endsWith('.localhost')) {
        return true;
    }
    const v4 = parseIPv4(h);
    if (v4) {
        return isLocalIPv4(v4);
    }
    if (!(h.startsWith('[') && h.endsWith(']'))) {
        return false;
    }
    const g = parseIPv6(h.slice(1, -1));
    if (!g) {
        return true; // Unparsable literal: fail closed.
    }
    const embeddedV4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
    const zeros = (n) => g.slice(0, n).every((x) => x === 0);
    if (zeros(8)) {
        return true; // ::
    }
    if (zeros(7) && g[7] === 1) {
        return true; // ::1
    }
    if (zeros(5) && g[5] === 0xffff) {
        return isLocalIPv4(embeddedV4); // ::ffff:a.b.c.d
    }
    if (zeros(6)) {
        return isLocalIPv4(embeddedV4); // ::a.b.c.d (deprecated)
    }
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => !x)) {
        return isLocalIPv4(embeddedV4); // NAT64 64:ff9b::a.b.c.d
    }
    if (g[0] === 0x2002) {
        // 6to4 2002:aabb:ccdd::/48 carries a.b.c.d.
        return isLocalIPv4([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]);
    }
    // fec0::/10 isn't local: RFC 3879 made it global unicast.
    return ((g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
        (g[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
        (g[0] & 0xff00) === 0xff00 // multicast ff00::/8
    );
}
