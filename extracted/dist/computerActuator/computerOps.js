"use strict";
/**
 * @fileoverview Pure helpers of the computer action layer (Layer 2): the
 * `computer` actuator type's constants and model-facing error texts, and the
 * mappings between the wire messages (computerpb, actuator_pb) and the Layer 3
 * driver's plain types: Hello and health from a surface's description, the
 * geometry fence, the per-call confinement policy, driver calls for wire
 * actions, and browser-page / focused-app reports.
 *
 * Platform-free: no DOM, React, Electron or Node built-ins (deps_test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ACTOR_LABEL_BYTES = exports.AGENT_COLOR_COUNT = exports.ERR_TEXT = exports.MAX_BROWSER_PAGES = exports.MAX_SCROLL_LINES = exports.MAX_TEXT_RUNES = exports.MAX_ACTIONS = exports.MAX_SETTLE_MS = exports.MAX_WAIT_MS = exports.MAX_LONG_EDGE_PX = exports.MIN_LONG_EDGE_PX = exports.DEFAULT_LONG_EDGE_PX = exports.MAX_VERSION_BYTES = exports.MAX_FOCUSED_BYTES = exports.MAX_TITLE_BYTES = exports.AX_SNAPSHOT_TRUNCATED_NOTICE = exports.MAX_AX_SNAPSHOT_BYTES = exports.BACKGROUND_CONFINEMENT_VERSION = exports.FOREGROUND_CONFINEMENT_VERSION = exports.HANDLER_CONFINEMENT_VERSION = exports.COMPUTER_ACTUATOR_TYPE_VERSION = exports.COMPUTER_ACTUATOR_TYPE = void 0;
exports.truncateUtf8 = truncateUtf8;
exports.truncateSnapshot = truncateSnapshot;
exports.clamp = clamp;
exports.toProtoGeometry = toProtoGeometry;
exports.confinementVersion = confinementVersion;
exports.buildHello = buildHello;
exports.advertKey = advertKey;
exports.healthOf = healthOf;
exports.toStatusReport = toStatusReport;
exports.healthKey = healthKey;
exports.isPointerAction = isPointerAction;
exports.geometryChanged = geometryChanged;
exports.toDriverPolicy = toDriverPolicy;
exports.isForegroundAction = isForegroundAction;
exports.isBackgroundAction = isBackgroundAction;
exports.isForegroundBatch = isForegroundBatch;
exports.hasBackgroundAction = hasBackgroundAction;
exports.requiredConfinement = requiredConfinement;
exports.agentColorIndex = agentColorIndex;
exports.actionKind = actionKind;
exports.toProtoRect = toProtoRect;
exports.toProtoWindowGeometry = toProtoWindowGeometry;
exports.driverCallFor = driverCallFor;
exports.toProtoBrowserPages = toProtoBrowserPages;
exports.setFocused = setFocused;
const protobuf_1 = require("@bufbuild/protobuf"); // from //third_party/javascript/bufbuild_protobuf
const actuator_pb_1 = require("../proto/actuator_pb"); // from //third_party/jetski/actuator_pb:actuator_ts_proto
const computer_payload_pb_1 = require("../proto/computer_payload_pb"); // from //third_party/jetski/cortex/ext/plugins/computer/computerpb:computer_payload_ts_proto
/** The wire actuator type (actuator_pb `actuator_type`). */
exports.COMPUTER_ACTUATOR_TYPE = 'computer';
/** The wire actuator type version (actuator_pb `actuator_type_version`). */
exports.COMPUTER_ACTUATOR_TYPE_VERSION = 1;
/**
 * App-confinement level this layer forwards (R4): 1 = allowed apps (§9 lock)
 * plus WINDOW_OFF_DISPLAY; 2 = 1 + the browser page policy (R3 minimal) and
 * browser_pages / blocked_host back; 3 = 2 + background actions (bind_app,
 * AX snapshot/actions, window capture), each confined like input. The Hello
 * advertises min(surface, this).
 */
exports.HANDLER_CONFINEMENT_VERSION = 3;
/** The level a batch with only foreground (or neutral) actions needs. */
exports.FOREGROUND_CONFINEMENT_VERSION = 2;
/** The level a batch with any background action needs. */
exports.BACKGROUND_CONFINEMENT_VERSION = 3;
/** Cap on a result's ax_snapshot_text. */
exports.MAX_AX_SNAPSHOT_BYTES = 32 * 1024;
/** The last line of an ax_snapshot_text that {@link truncateSnapshot} cut. */
exports.AX_SNAPSHOT_TRUNCATED_NOTICE = '[AX snapshot truncated at 32 KiB: later elements were omitted; snapshot one window (window_id) to see them]';
// The result and Hello caps below mirror the language server's checks; a
// value over them fails every result (INVALID_DESKTOP_RESPONSE) or the Hello.
// LINT.IfChange(wire_caps)
/** Cap on the focused window title in a result. */
exports.MAX_TITLE_BYTES = 512;
/** Cap on the focused app name / id in a result. */
exports.MAX_FOCUSED_BYTES = 512;
/** The language server's cap on ComputerHello.os_version / helper_version. */
exports.MAX_VERSION_BYTES = 128;
/** Screenshot long edge when the request names none. */
exports.DEFAULT_LONG_EDGE_PX = 1440;
/** Smallest screenshot long edge a request may ask for. */
exports.MIN_LONG_EDGE_PX = 256;
/** Largest screenshot long edge a request may ask for. */
exports.MAX_LONG_EDGE_PX = 2048;
/** Longest WAIT action. */
exports.MAX_WAIT_MS = 5000;
/** Longest settle before the final capture. */
exports.MAX_SETTLE_MS = 5000;
/** Most actions in one request. */
exports.MAX_ACTIONS = 20;
/** Longest TYPE text, in characters. */
exports.MAX_TEXT_RUNES = 2000;
/** Largest scroll per action, in lines per axis. */
exports.MAX_SCROLL_LINES = 20;
/** Most browser page reports in one result. */
exports.MAX_BROWSER_PAGES = 16;
// LINT.ThenChange(
//     //depot/google3/third_party/jetski/cortex/ext/plugins/computer/validate.go:response_caps,
//     //depot/google3/third_party/jetski/cortex/ext/plugins/computer/actuatorhost/backend.go:hello_caps
// )
/** Request-level texts the model reads (unchanged from the desktop Kind). */
exports.ERR_TEXT = {
    USER_TAKEOVER: 'USER_TAKEOVER: the user took control of the Mac (real mouse/keyboard input or the Stop button). Stop now and return control to the parent agent; do not retry until the user resumes.',
    USER_STOP: 'USER_STOP: the user pressed Stop in the AGY HUD. Stop now and return control to the parent agent; do not retry until the user resumes.',
    GEOMETRY_CHANGED: 'GEOMETRY_CHANGED: the display changed since your last screenshot; take a new screenshot before acting.',
    ABANDONED: 'ACTION_FAILED: the language server abandoned this request (cancelled, timed out, disconnected or superseded); remaining actions were not run.',
    TARGET_CHANGED_LOCKED: 'TARGET_CHANGED: that input would reach an app this batch does not hold (another agent may be working in it); call focus_app on the app you need first, then take a fresh screenshot.',
    AGENT_STOPPED: 'AGENT_STOPPED: the user stopped this agent in the AGY HUD. Stop now and return control to the parent agent; other agents may continue.',
    AGENT_PAUSED: "AGENT_PAUSED: the user took over this agent's app in the AGY Hub. Stop now and return control to the parent agent; you can be re-invoked after the user hands it back.",
    POINTER_BUSY: 'POINTER_BUSY: another computer subagent is using the mouse and keyboard. Do this step with background actions (bind_app, ax_snapshot, ax_*) if they can do it; otherwise stop and report back to the parent agent instead of retrying.',
};
const utf8 = new TextEncoder();
/** Truncates to at most `maxBytes` UTF-8 bytes without splitting a character. */
function truncateUtf8(s, maxBytes) {
    const bytes = utf8.encode(s);
    if (bytes.length <= maxBytes) {
        return s;
    }
    // One encode, then step back over UTF-8 continuation bytes (10xxxxxx).
    let end = Math.max(0, maxBytes);
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end--;
    }
    return new TextDecoder().decode(bytes.subarray(0, end));
}
/**
 * Caps an accessibility snapshot at `maxBytes` UTF-8 bytes on a line boundary
 * (a cut inside a line could turn a ref like s1:e123 into the valid ref
 * s1:e12 of another element) and ends a cut snapshot with
 * {@link AX_SNAPSHOT_TRUNCATED_NOTICE}.
 */
function truncateSnapshot(text, maxBytes) {
    if (utf8.encode(text).length <= maxBytes) {
        return text;
    }
    const notice = `\n${exports.AX_SNAPSHOT_TRUNCATED_NOTICE}`;
    const head = truncateUtf8(text, Math.max(0, maxBytes - utf8.encode(notice).length));
    const cut = head.lastIndexOf('\n');
    return cut < 0 ? exports.AX_SNAPSHOT_TRUNCATED_NOTICE : head.slice(0, cut) + notice;
}
/**
 * Truncates `v` to an integer within [lo, hi]. NaN counts as 0 before the
 * clamp (an invalid scroll delta scrolls nothing).
 */
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, Math.trunc(v) || 0));
}
/** A driver display as the wire geometry. */
function toProtoGeometry(d) {
    return {
        displayId: d.displayId,
        widthPoints: d.widthPoints,
        heightPoints: d.heightPoints,
        widthPixels: d.widthPixels,
        heightPixels: d.heightPixels,
        scaleFactor: d.scaleFactor,
    };
}
/**
 * min(surface, layer) confinement level; anything but a positive integer from
 * the surface counts as 0. `max` (a host test hook) can only lower it.
 */
function confinementVersion(info, max) {
    const surface = info.appConfinementVersion;
    let v = Math.min(Number.isInteger(surface) && surface > 0 ? surface : 0, exports.HANDLER_CONFINEMENT_VERSION);
    if (max !== undefined && Number.isInteger(max) && max >= 0) {
        v = Math.min(v, max);
    }
    return v;
}
/**
 * The Hello the actuator advertises for a surface at confinement `level`;
 * `concurrentAgents` when it runs different agents' batches concurrently.
 */
function buildHello(info, level, concurrentAgents = false) {
    return (0, protobuf_1.create)(computer_payload_pb_1.ComputerHelloSchema, {
        appConfinementVersion: level,
        concurrentAgents,
        mainDisplay: toProtoGeometry(info.mainDisplay),
        grants: {
            accessibility: info.permissions.accessibility,
            screenRecording: info.permissions.screenCapture,
        },
        // The language server rejects a Hello with either over 128 bytes.
        osVersion: truncateUtf8(String(info.osVersion ?? ''), exports.MAX_VERSION_BYTES),
        helperVersion: truncateUtf8(String(info.executorVersion ?? ''), exports.MAX_VERSION_BYTES),
    });
}
/** What the Hello advertises, as a comparable key (re-advertise on change). */
function advertKey(info, level, concurrentAgents = false) {
    const d = info.mainDisplay;
    return [
        d.displayId,
        d.widthPoints,
        d.heightPoints,
        d.widthPixels,
        d.heightPixels,
        d.scaleFactor,
        info.permissions.accessibility,
        info.permissions.screenCapture,
        level,
        info.osVersion,
        info.executorVersion,
        concurrentAgents ? 'agents' : '',
    ].join('|');
}
/** The wire degraded reason of `reason` (UNSPECIFIED for an unknown one). */
function toDegradedReason(reason) {
    switch (reason) {
        case 'permission_missing':
            return actuator_pb_1.DegradedReason.PERMISSION_MISSING;
        case 'executor_crashed':
            return actuator_pb_1.DegradedReason.EXECUTOR_CRASHED;
        case 'executor_not_installed':
            return actuator_pb_1.DegradedReason.EXECUTOR_NOT_INSTALLED;
        default:
            return actuator_pb_1.DegradedReason.UNSPECIFIED;
    }
}
/** The surface's health from its permissions. */
function healthOf(info) {
    const missing = [
        info.permissions.accessibility ? '' : 'Accessibility',
        info.permissions.screenCapture ? '' : 'Screen Recording',
    ].filter(Boolean);
    return missing.length === 0
        ? { healthy: true }
        : {
            healthy: false,
            reason: 'permission_missing',
            detail: `missing macOS grant: ${missing.join(', ')}`,
        };
}
/** The actuator status report of `health`. */
function toStatusReport(health) {
    const report = health.healthy
        ? { status: actuator_pb_1.ActuatorStatus.HEALTHY }
        : {
            status: actuator_pb_1.ActuatorStatus.DEGRADED,
            degradedReason: health.reason
                ? toDegradedReason(health.reason)
                : actuator_pb_1.DegradedReason.UNSPECIFIED,
        };
    if (health.detail !== undefined) {
        report.detail = health.detail;
    }
    return report;
}
/**
 * A comparable key of `health` (report only changes). The detail counts: a
 * surface that gets one of two missing grants reports the one still missing.
 */
function healthKey(health) {
    const detail = health.detail ? `:${health.detail}` : '';
    return health.healthy
        ? `healthy${detail}`
        : `degraded:${health.reason ?? ''}${detail}`;
}
/** Whether the action targets display coordinates (needs a geometry fence). */
function isPointerAction(a) {
    switch (a.type) {
        case computer_payload_pb_1.ComputerActionType.CLICK:
        case computer_payload_pb_1.ComputerActionType.DOUBLE_CLICK:
        case computer_payload_pb_1.ComputerActionType.RIGHT_CLICK:
        case computer_payload_pb_1.ComputerActionType.MOVE:
        case computer_payload_pb_1.ComputerActionType.DRAG:
            return true;
        case computer_payload_pb_1.ComputerActionType.SCROLL:
            return a.hasPoint;
        default:
            return false;
    }
}
/** True if the live display no longer matches what the LS scaled against. */
function geometryChanged(req, live) {
    if (!req.expectedWidthPoints &&
        !req.expectedHeightPoints &&
        !req.expectedDisplayId) {
        // No cached geometry is fine only for a batch without pointer actions
        // (e.g. the first screenshot); pointer coordinates need a fence.
        return req.actions.some(isPointerAction);
    }
    if (req.expectedDisplayId && req.expectedDisplayId !== live.displayId) {
        return true;
    }
    return (Math.abs(req.expectedWidthPoints - live.widthPoints) > 0.5 ||
        Math.abs(req.expectedHeightPoints - live.heightPoints) > 0.5);
}
/**
 * The confinement policy of one call: the allowed apps (always sent, [] when
 * the LS sent none: fail closed) and the batch's browser page policy.
 */
function toDriverPolicy(allowedAppIds, urlPolicy) {
    const policy = { allowedAppIds: [...allowedAppIds] };
    if (urlPolicy) {
        policy.pagePolicy = {
            enforce: urlPolicy.enforce,
            epoch: Number(urlPolicy.epoch),
            blockedDomains: [...urlPolicy.policyBlockedDomains],
        };
    }
    return policy;
}
/**
 * Foreground actions take over the screen, cursor or keyboard (and so need
 * control_desktop consent and arm takeover detection): FOCUS_APP, the pointer
 * actions, TYPE, KEY, SCROLL and SCREENSHOT. Background actions work through
 * an app's accessibility tree and window capture. WAIT is neutral. Any other
 * type (unspecified, or one this layer doesn't know) counts as foreground, so
 * it can only arm. The language server's computeriface uses the same table.
 */
function isForegroundAction(a) {
    return a.type !== computer_payload_pb_1.ComputerActionType.WAIT && !isBackgroundAction(a);
}
/** See {@link isForegroundAction}. */
function isBackgroundAction(a) {
    switch (a.type) {
        case computer_payload_pb_1.ComputerActionType.BIND_APP:
        case computer_payload_pb_1.ComputerActionType.AX_SNAPSHOT:
        case computer_payload_pb_1.ComputerActionType.AX_PRESS:
        case computer_payload_pb_1.ComputerActionType.AX_SET_VALUE:
        case computer_payload_pb_1.ComputerActionType.AX_SELECT:
        case computer_payload_pb_1.ComputerActionType.AX_SCROLL:
        case computer_payload_pb_1.ComputerActionType.WINDOW_SCREENSHOT:
            return true;
        default:
            return false;
    }
}
/**
 * Whether takeover detection may be armed for the batch: the LS's
 * `foreground` bit OR any foreground action here (a disagreement can only
 * arm, never disarm).
 */
function isForegroundBatch(req) {
    return req.foreground || req.actions.some(isForegroundAction);
}
/** Whether the batch has any background action. */
function hasBackgroundAction(req) {
    return req.actions.some(isBackgroundAction);
}
/** The confinement level the batch needs from the surface. */
function requiredConfinement(req) {
    return hasBackgroundAction(req)
        ? exports.BACKGROUND_CONFINEMENT_VERSION
        : exports.FOREGROUND_CONFINEMENT_VERSION;
}
/** Size of the agent color palette surfaces index with `colorIndex`. */
exports.AGENT_COLOR_COUNT = 8;
/** Longest agent label passed to a surface. */
exports.MAX_ACTOR_LABEL_BYTES = 64;
/** A stable palette index for an agent id (FNV-1a). */
function agentColorIndex(id) {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % exports.AGENT_COLOR_COUNT;
}
/** The activity name of a wire action, e.g. 'ax_press' or 'click'. */
function actionKind(a) {
    return (computer_payload_pb_1.ComputerActionType[a.type] ?? 'UNSPECIFIED').toLowerCase();
}
/** A surface's element or window frame as the wire rectangle (points). */
function toProtoRect(b) {
    return {
        xPoints: Number(b.x) || 0,
        yPoints: Number(b.y) || 0,
        widthPoints: Number(b.width) || 0,
        heightPoints: Number(b.height) || 0,
    };
}
/** A window capture's geometry for the result (window-local points). */
function toProtoWindowGeometry(appId, w) {
    return {
        windowId: w.windowId,
        bundleId: truncateUtf8(appId, 256),
        widthPoints: w.widthPoints,
        heightPoints: w.heightPoints,
        scaleFactor: w.scaleFactor,
    };
}
/**
 * The driver call of an input or background action; null for SCREENSHOT,
 * WAIT and unknown types.
 */
function driverCallFor(a) {
    const mods = { modifiers: [...a.modifiers] };
    switch (a.type) {
        case computer_payload_pb_1.ComputerActionType.CLICK:
            return {
                kind: 'mouse',
                action: { type: 'click', x: a.xPoints, y: a.yPoints, ...mods },
            };
        case computer_payload_pb_1.ComputerActionType.DOUBLE_CLICK:
            return {
                kind: 'mouse',
                action: {
                    type: 'click',
                    x: a.xPoints,
                    y: a.yPoints,
                    clickCount: 2,
                    ...mods,
                },
            };
        case computer_payload_pb_1.ComputerActionType.RIGHT_CLICK:
            return {
                kind: 'mouse',
                action: {
                    type: 'click',
                    x: a.xPoints,
                    y: a.yPoints,
                    button: 'right',
                    ...mods,
                },
            };
        case computer_payload_pb_1.ComputerActionType.MOVE:
            return {
                kind: 'mouse',
                action: { type: 'move', x: a.xPoints, y: a.yPoints },
            };
        case computer_payload_pb_1.ComputerActionType.DRAG:
            return {
                kind: 'mouse',
                action: {
                    type: 'drag',
                    x: a.xPoints,
                    y: a.yPoints,
                    toX: a.toXPoints,
                    toY: a.toYPoints,
                    ...mods,
                },
            };
        case computer_payload_pb_1.ComputerActionType.TYPE:
            return { kind: 'text', text: a.text };
        case computer_payload_pb_1.ComputerActionType.KEY:
            return { kind: 'key', keys: a.keys };
        case computer_payload_pb_1.ComputerActionType.SCROLL: {
            const action = {
                type: 'scroll',
                deltaXLines: clamp(a.scrollDx, -exports.MAX_SCROLL_LINES, exports.MAX_SCROLL_LINES),
                deltaYLines: clamp(a.scrollDy, -exports.MAX_SCROLL_LINES, exports.MAX_SCROLL_LINES),
                ...mods,
            };
            // Without a point the surface scrolls at the pointer: x/y stay absent.
            if (a.hasPoint) {
                action.x = a.xPoints;
                action.y = a.yPoints;
            }
            return { kind: 'mouse', action };
        }
        case computer_payload_pb_1.ComputerActionType.FOCUS_APP:
            return { kind: 'focusApp', app: a.app };
        case computer_payload_pb_1.ComputerActionType.BIND_APP:
            return { kind: 'bindApp', app: a.app };
        case computer_payload_pb_1.ComputerActionType.AX_SNAPSHOT: {
            const call = {
                kind: 'axSnapshot',
                appId: a.app,
                includeMenubar: a.includeMenubar,
            };
            if (a.windowId) {
                call.windowId = a.windowId;
            }
            return call;
        }
        case computer_payload_pb_1.ComputerActionType.AX_PRESS:
            return { kind: 'axPress', ref: a.ref };
        case computer_payload_pb_1.ComputerActionType.AX_SET_VALUE:
            return { kind: 'axSetValue', ref: a.ref, text: a.text, confirm: a.confirm };
        case computer_payload_pb_1.ComputerActionType.AX_SELECT:
            return { kind: 'axSelect', ref: a.ref };
        case computer_payload_pb_1.ComputerActionType.AX_SCROLL:
            return {
                kind: 'axScroll',
                ref: a.ref,
                deltaXLines: clamp(a.scrollDx, -exports.MAX_SCROLL_LINES, exports.MAX_SCROLL_LINES),
                deltaYLines: clamp(a.scrollDy, -exports.MAX_SCROLL_LINES, exports.MAX_SCROLL_LINES),
            };
        case computer_payload_pb_1.ComputerActionType.WINDOW_SCREENSHOT: {
            const call = {
                kind: 'windowScreenshot',
                appId: a.app,
            };
            if (a.windowId) {
                call.windowId = a.windowId;
            }
            return call;
        }
        default:
            return null;
    }
}
/** The wire verdict of `v` (UNSPECIFIED for an unknown one). */
function toPageVerdict(v) {
    switch (v) {
        case 'allowed':
            return computer_payload_pb_1.ComputerPageVerdict.ALLOWED;
        case 'neutral':
            return computer_payload_pb_1.ComputerPageVerdict.NEUTRAL;
        case 'needs_permission':
            return computer_payload_pb_1.ComputerPageVerdict.NEEDS_PERMISSION;
        case 'unreadable':
            return computer_payload_pb_1.ComputerPageVerdict.UNREADABLE;
        case 'policy_blocked':
            return computer_payload_pb_1.ComputerPageVerdict.POLICY_BLOCKED;
        default:
            return computer_payload_pb_1.ComputerPageVerdict.UNSPECIFIED;
    }
}
/** The capture's browser pages as wire reports (at most 16, truncated). */
function toProtoBrowserPages(pages) {
    return (pages ?? []).slice(0, exports.MAX_BROWSER_PAGES).map((p) => (0, protobuf_1.create)(computer_payload_pb_1.ComputerBrowserPageSchema, {
        bundleId: truncateUtf8(String(p.appId ?? ''), 256),
        host: truncateUtf8(String(p.host ?? ''), 253),
        url: truncateUtf8(String(p.url ?? ''), 2048),
        verdict: toPageVerdict(p.verdict),
        redacted: p.redacted === true,
    }));
}
/** Copies the focused app into the result, truncated. */
function setFocused(r, f) {
    if (!f) {
        return;
    }
    r.focusedAppName = truncateUtf8(String(f.appName ?? ''), exports.MAX_FOCUSED_BYTES);
    r.focusedBundleId = truncateUtf8(String(f.appId ?? ''), exports.MAX_FOCUSED_BYTES);
    r.focusedPid = Number(f.pid ?? 0);
    r.focusedWindowTitle = truncateUtf8(String(f.windowTitle ?? ''), exports.MAX_TITLE_BYTES);
}
