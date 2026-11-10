"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPUTE_OWNER_PATH_AND_RECT_FN = exports.EMPTY_FRAME_TREE = exports.PAGE_AGENT_ISOLATED_WORLD_NAME = void 0;
exports.isOpaqueOrigin = isOpaqueOrigin;
exports.extractFrameOrigin = extractFrameOrigin;
exports.isProtectedIdpFrameUrl = isProtectedIdpFrameUrl;
exports.redactFrameUrl = redactFrameUrl;
exports.normalizeExpectedOrigin = normalizeExpectedOrigin;
exports.buildFrameGuardPrelude = buildFrameGuardPrelude;
exports.isValidDomPath = isValidDomPath;
exports.composeFrameViewportRect = composeFrameViewportRect;
exports.PAGE_AGENT_ISOLATED_WORLD_NAME = 'agy_page_agent';
exports.EMPTY_FRAME_TREE = {
    mainFrameId: '',
    mainUrl: '',
    mainOrigin: '',
    frames: [],
};
const IDP_EXACT_CSV = 'accounts.google.com,myaccount.google.com,accounts.youtube.com,gds.google.com,login.corp.google.com,uberproxy-pen-redirect.corp.google.com,login.microsoftonline.com,login.live.com,appleid.apple.com';
const IDP_SUFFIX_CSV = '.okta.com,.oktapreview.com,.okta-emea.com,.auth0.com';
const IDP_PUBLIC_CSV = 'developer.okta.com,docs.okta.com,help.okta.com,support.okta.com,status.okta.com,docs.auth0.com,developer.auth0.com,help.auth0.com,support.auth0.com,community.auth0.com,status.auth0.com';
const IDP_EXACT = IDP_EXACT_CSV.split(',');
const IDP_SUFFIXES = IDP_SUFFIX_CSV.split(',');
const IDP_PUBLIC = IDP_PUBLIC_CSV.split(',');
// Runs inside the owner frame's isolated world with `this` bound to the frame
// owner element. Returns the owner DOM path and the frame's content box in the
// viewport of the topmost same-process document. Frames under a non-translate
// transform (scale/rotate/skew/perspective) are reported as not visible because
// a single axis-aligned rect cannot map their coordinates. Visibility also
// accounts for ancestor overflow clipping and each document's viewport.
exports.COMPUTE_OWNER_PATH_AND_RECT_FN = `function() {
  const el = this;
  if (!el || el.nodeType !== 1 || !el.isConnected) return null;
  const num = (v) => (v ? parseFloat(v) || 0 : 0);
  const near = (a, b) => Math.abs(a - b) <= 1e-3;
  const win0 = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  const styleOf = (node) => {
    const w = (node.ownerDocument && node.ownerDocument.defaultView) || win0;
    return w && typeof w.getComputedStyle === 'function' ? w.getComputedStyle(node) : null;
  };
  const isTranslateOnly = (st) => {
    if (!st) return true;
    const sc = String(st.scale || 'none').trim();
    if (sc !== 'none' && sc.split(/\\s+/).some((x) => !near(num(x), 1))) return false;
    const ro = String(st.rotate || 'none').trim();
    if (ro !== 'none' && !/^(0|0?\\.0+)(deg|rad|grad|turn)?$/.test(ro)) return false;
    const t = String(st.transform || 'none').trim();
    if (t === 'none') return true;
    const m = /^matrix(3d)?\\(([^)]*)\\)$/.exec(t);
    if (!m) return false;
    const v = m[2].split(',').map((x) => parseFloat(x));
    if (v.some((x) => !Number.isFinite(x))) return false;
    if (!m[1]) return v.length === 6 && near(v[0], 1) && near(v[1], 0) && near(v[2], 0) && near(v[3], 1);
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, null, null, null, 1];
    return v.length === 16 && id.every((x, i) => x === null || near(v[i], x));
  };
  const isScaled = (node, r) =>
    (node.offsetWidth > 0 && Math.abs(r.width - node.offsetWidth) > 1) ||
    (node.offsetHeight > 0 && Math.abs(r.height - node.offsetHeight) > 1);
  const r0 = el.getBoundingClientRect();
  const st0 = styleOf(el);
  const padL0 = num(st0 && st0.paddingLeft), padR0 = num(st0 && st0.paddingRight), padT0 = num(st0 && st0.paddingTop), padB0 = num(st0 && st0.paddingBottom);
  const bL0 = el.clientLeft || num(st0 && st0.borderLeftWidth), bR0 = num(st0 && st0.borderRightWidth), bT0 = el.clientTop || num(st0 && st0.borderTopWidth), bB0 = num(st0 && st0.borderBottomWidth);
  let cx = r0.left + bL0 + padL0, cy = r0.top + bT0 + padT0;
  const baseW = el.clientWidth > 0 ? el.clientWidth : Math.max(0, r0.width - bL0 - bR0);
  const baseH = el.clientHeight > 0 ? el.clientHeight : Math.max(0, r0.height - bT0 - bB0);
  const cw = Math.max(0, baseW - padL0 - padR0), ch = Math.max(0, baseH - padT0 - padB0);
  let visible = cw >= 1 && ch >= 1 && !isScaled(el, r0);
  let vx0 = cx, vy0 = cy, vx1 = cx + cw, vy1 = cy + ch;
  let escape = 'none';
  const rev = [];
  for (let guard = 0, curr = el; guard < 512 && curr; guard++) {
    if (curr.nodeType === 1) {
      if (curr.hidden) visible = false;
      const cst = styleOf(curr);
      if (cst && (cst.display === 'none' || cst.visibility === 'hidden')) visible = false;
      if (!isTranslateOnly(cst)) visible = false;
      const pos = (cst && cst.position) || 'static';
      const doc = curr.ownerDocument;
      const isRoot = !!doc && (curr === doc.documentElement || curr === doc.body);
      if (curr !== el && cst && !isRoot) {
        const applies = escape === 'none' || (escape === 'abs' && pos !== 'static');
        if (escape === 'abs' && pos !== 'static') escape = 'none';
        if (applies && cst.display !== 'inline' && cst.display !== 'contents') {
          const cr = curr.getBoundingClientRect();
          const l = cr.left + (curr.clientLeft || 0), t = cr.top + (curr.clientTop || 0);
          if (cst.overflowX && cst.overflowX !== 'visible') { vx0 = Math.max(vx0, l); vx1 = Math.min(vx1, l + (curr.clientWidth || 0)); }
          if (cst.overflowY && cst.overflowY !== 'visible') { vy0 = Math.max(vy0, t); vy1 = Math.min(vy1, t + (curr.clientHeight || 0)); }
        }
      }
      if (pos === 'fixed') escape = 'fixed';
      else if (pos === 'absolute' && escape !== 'fixed') escape = 'abs';
    }
    const p = curr.parentNode;
    if (p) {
      const idx = Array.prototype.indexOf.call(p.childNodes, curr);
      if (idx < 0) return null;
      rev.push({kind: 'child', index: idx});
      curr = p;
      continue;
    }
    if (curr.host) { rev.push({kind: 'shadow'}); curr = curr.host; continue; }
    const dWin = curr.defaultView;
    if (!dWin) return null;
    vx0 = Math.max(vx0, 0); vy0 = Math.max(vy0, 0);
    vx1 = Math.min(vx1, num(dWin.innerWidth)); vy1 = Math.min(vy1, num(dWin.innerHeight));
    let frameEl = null;
    try { frameEl = dWin === dWin.top ? null : dWin.frameElement; } catch { frameEl = null; }
    if (!frameEl) {
      visible = visible && vx1 - vx0 >= 1 && vy1 - vy0 >= 1;
      return {domPath: rev.reverse(), rect: {x: cx, y: cy, width: cw, height: ch, visible}};
    }
    const fr = frameEl.getBoundingClientRect();
    const fst = styleOf(frameEl);
    if (fr.width < 1 || fr.height < 1 || isScaled(frameEl, fr)) visible = false;
    const dx = fr.left + (frameEl.clientLeft || num(fst && fst.borderLeftWidth)) + num(fst && fst.paddingLeft);
    const dy = fr.top + (frameEl.clientTop || num(fst && fst.borderTopWidth)) + num(fst && fst.paddingTop);
    cx += dx; cy += dy; vx0 += dx; vx1 += dx; vy0 += dy; vy1 += dy;
    escape = 'none';
    rev.push({kind: 'frame'});
    curr = frameEl;
  }
  return null;
}`;
function isOpaqueOrigin(raw) {
    const s = (raw ?? '').trim().toLowerCase();
    return s === 'null' || s === '://';
}
function parseHttpUrl(raw, unwrapPen) {
    let cur = (raw ?? '').trim();
    if (!cur || isOpaqueOrigin(cur) || /^about:/i.test(cur)) {
        return null;
    }
    for (let depth = 0; depth < 8; depth++) {
        try {
            const u = new URL(cur);
            const host = u.hostname.toLowerCase().replace(/\.+$/, '');
            if (unwrapPen &&
                u.protocol === 'https:' &&
                host === 'uberproxy-pen-redirect.corp.google.com' &&
                u.pathname === '/uberproxy/pen') {
                const target = u.searchParams.get('url');
                if (target && /^https?:\/\//i.test(target) && target !== cur) {
                    cur = target;
                    continue;
                }
            }
            const inner = u.protocol === 'blob:' ? new URL(u.pathname) : u;
            const isHttp = inner.protocol === 'http:' || inner.protocol === 'https:';
            return isHttp ? inner : null;
        }
        catch {
            return null;
        }
    }
    return null;
}
function extractFrameOrigin(securityOrigin, rawUrl) {
    if (isOpaqueOrigin(securityOrigin)) {
        return '';
    }
    // Never unwrap the PEN redirect here: a frame on the PEN host must report
    // the PEN origin, not the origin of its `url` target.
    const parsed = parseHttpUrl(securityOrigin, false) ?? parseHttpUrl(rawUrl, false);
    return parsed && parsed.origin !== 'null' ? parsed.origin.toLowerCase() : '';
}
function isProtectedIdpFrameUrl(rawUrl) {
    const parsed = parseHttpUrl(rawUrl, true);
    if (!parsed) {
        return false;
    }
    const bare = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const host = bare.replace(/\.+$/, '').replace(/^www\./, '');
    if (!host || IDP_PUBLIC.some((p) => host === p || host.endsWith(`.${p}`))) {
        return false;
    }
    const exact = IDP_EXACT.some((d) => host === d || host.endsWith(`.${d}`));
    return exact || IDP_SUFFIXES.some((s) => host.endsWith(s));
}
/**
 * Reduces a frame URL to what the host needs to identify the frame, dropping
 * query strings and fragments that can carry OAuth, 3DS or payment tokens.
 */
function redactFrameUrl(rawUrl) {
    try {
        const u = new URL((rawUrl ?? '').trim());
        if (u.protocol === 'http:' || u.protocol === 'https:') {
            return `${u.origin}${u.pathname}`;
        }
        if (u.protocol === 'about:') {
            return `about:${u.pathname}`;
        }
        if (u.protocol === 'blob:') {
            const inner = parseHttpUrl(rawUrl, false);
            return inner ? `blob:${inner.origin}` : 'blob:';
        }
        return u.protocol;
    }
    catch {
        return '';
    }
}
/** Normalizes a caller-supplied expected origin; empty means "no check". */
function normalizeExpectedOrigin(raw) {
    if (raw === undefined || raw === null) {
        return undefined;
    }
    if (typeof raw !== 'string') {
        throw new Error('expectedOrigin must be a string');
    }
    const s = raw.trim().toLowerCase().replace(/\/+$/, '');
    return s || undefined;
}
/**
 * Builds a statement block that runs first inside the target frame's isolated
 * world and throws when the document that will actually run the agent code is
 * a protected IdP (including about:blank/srcdoc documents that inherit an IdP
 * origin) or no longer matches `expectedOrigin`. Doing this in-context closes
 * the gap between the host-side frame-tree check and execution, since CDP frame
 * ids survive navigation. The block completes with `undefined`, so the
 * completion value of the code that follows it is unchanged.
 */
function buildFrameGuardPrelude(expectedOrigin) {
    const lists = JSON.stringify({
        exact: IDP_EXACT,
        suffixes: IDP_SUFFIXES,
        pub: IDP_PUBLIC,
    });
    const expected = JSON.stringify(expectedOrigin ?? null);
    return `{
  const __agyOrigin = String(
    (typeof self !== 'undefined' && self.origin) || location.origin || ''
  ).toLowerCase();
  let __agyHost = '';
  try {
    __agyHost = __agyOrigin && __agyOrigin !== 'null' ? new URL(__agyOrigin).hostname : '';
  } catch (e) {}
  __agyHost = __agyHost.replace(/^\\[|\\]$/g, '').replace(/\\.+$/, '').replace(/^www\\./, '');
  const __agyIdp = ${lists};
  if (
    __agyHost &&
    !__agyIdp.pub.some((p) => __agyHost === p || __agyHost.endsWith('.' + p)) &&
    (__agyIdp.exact.some((d) => __agyHost === d || __agyHost.endsWith('.' + d)) ||
      __agyIdp.suffixes.some((x) => __agyHost.endsWith(x)))
  ) {
    throw new Error('IDP_BLOCKED: Protected Identity Provider frame');
  }
  const __agyExpected = ${expected};
  if (__agyExpected !== null && __agyOrigin !== __agyExpected) {
    throw new Error('FRAME_ORIGIN_CHANGED: Frame origin no longer matches the expected origin');
  }
};
`;
}
function isValidDomPath(steps) {
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > 512) {
        return false;
    }
    return steps.every((step) => {
        if (typeof step !== 'object' || step === null) {
            return false;
        }
        const r = step;
        if (r.kind === 'shadow' || r.kind === 'frame') {
            return true;
        }
        return (r.kind === 'child' &&
            typeof r.index === 'number' &&
            Number.isInteger(r.index) &&
            r.index >= 0);
    });
}
// Translates a frame-local rect into its scope's coordinates. No scaling is
// applied: frames under a non-translate transform are already reported as not
// visible by COMPUTE_OWNER_PATH_AND_RECT_FN, and that propagates via `visible`.
function composeFrameViewportRect(scope, local) {
    return {
        x: scope.x + local.x,
        y: scope.y + local.y,
        width: local.width,
        height: local.height,
        visible: scope.visible &&
            local.visible &&
            scope.width >= 1 &&
            scope.height >= 1 &&
            local.width >= 1 &&
            local.height >= 1 &&
            local.x + local.width > 0 &&
            local.y + local.height > 0 &&
            local.x < scope.width &&
            local.y < scope.height,
    };
}
