"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WCV_CATCHER_DRAG_CHANNEL = exports.WCV_CATCHER_SET_CURSOR_CHANNEL = exports.WCV_CATCHER_RESET_DRAG_CHANNEL = exports.WCV_CATCHER_PINCH_CHANNEL = exports.WCV_CATCHER_WHEEL_CHANNEL = exports.WCV_CATCHER_POINTER_LEAVE_CHANNEL = exports.WCV_CATCHER_POINTER_UP_CHANNEL = exports.WCV_CATCHER_POINTER_MOVE_CHANNEL = exports.WCV_CATCHER_POINTER_DOWN_CHANNEL = void 0;
exports.createMultiClickTrackerState = createMultiClickTrackerState;
exports.nextMultiClickCount = nextMultiClickCount;
exports.toCatcherMouseModifiers = toCatcherMouseModifiers;
exports.computePinchScaleFactor = computePinchScaleFactor;
exports.installCatcherInputBridge = installCatcherInputBridge;
const electron_1 = require("electron");
exports.WCV_CATCHER_POINTER_DOWN_CHANNEL = 'wcv:catcher-pointer-down';
exports.WCV_CATCHER_POINTER_MOVE_CHANNEL = 'wcv:catcher-pointer-move';
exports.WCV_CATCHER_POINTER_UP_CHANNEL = 'wcv:catcher-pointer-up';
exports.WCV_CATCHER_POINTER_LEAVE_CHANNEL = 'wcv:catcher-pointer-leave';
exports.WCV_CATCHER_WHEEL_CHANNEL = 'wcv:catcher-wheel';
exports.WCV_CATCHER_PINCH_CHANNEL = 'wcv:catcher-pinch';
exports.WCV_CATCHER_RESET_DRAG_CHANNEL = 'wcv:catcher-reset-drag';
exports.WCV_CATCHER_SET_CURSOR_CHANNEL = 'wcv:catcher-set-cursor';
exports.WCV_CATCHER_DRAG_CHANNEL = 'wcv:catcher-drag';
const MULTI_CLICK_MAX_INTERVAL_MS = 500;
const MULTI_CLICK_MAX_DISTANCE_DIP = 5;
const WHEEL_OPTS = { capture: true, passive: false };
const SUPPRESSED = ['mousedown', 'mouseup', 'auxclick', 'contextmenu'];
const BUTTONS = ['left', 'middle', 'right', 'back', 'forward'];
const resolveFilePath = (f) => typeof electron_1.webUtils?.getPathForFile === 'function'
    ? electron_1.webUtils.getPathForFile(f)
    : '';
const safeStr = (fn) => {
    try {
        const v = fn();
        return typeof v === 'string' ? v : null;
    }
    catch {
        return null;
    }
};
/** Creates an initialized multi-click state record with zero prior presses. */
function createMultiClickTrackerState() {
    return { lastTimeMs: -Infinity, lastX: 0, lastY: 0, lastButton: -1, count: 0 };
}
/** Updates `state` and returns the 1-to-3 multi-click count within `500 ms` and `5 DIP` on `button`. */
function nextMultiClickCount(s, nowMs, x, y, btn) {
    const dt = nowMs - s.lastTimeMs;
    const ok = s.count > 0 &&
        btn === s.lastButton &&
        dt >= 0 &&
        dt <= MULTI_CLICK_MAX_INTERVAL_MS &&
        Math.hypot(x - s.lastX, y - s.lastY) <= MULTI_CLICK_MAX_DISTANCE_DIP;
    s.count = ok ? (s.count % 3) + 1 : 1;
    Object.assign(s, { lastTimeMs: nowMs, lastX: x, lastY: y, lastButton: btn });
    return s.count;
}
/** Encodes DOM modifier flags into the CDP mouse bitmask (`Alt=1 | Ctrl=2 | Meta=4 | Shift=8`). */
function toCatcherMouseModifiers(ev) {
    const { altKey: a, ctrlKey: c, metaKey: m, shiftKey: s } = ev;
    return (a ? 1 : 0) | (c ? 2 : 0) | (m ? 4 : 0) | (s ? 8 : 0);
}
/** Normalizes wheel `deltaY` by `deltaMode` and maps `ctrlKey` wheel ticks into a pinch scale factor clamped to `[1 / 1.2, 1.2]`. */
function computePinchScaleFactor(deltaY, deltaMode = 0) {
    const raw = typeof deltaY === 'number' && Number.isFinite(deltaY) ? deltaY : 0;
    const d = deltaMode === 1 ? raw * 40 : deltaMode === 2 ? raw * 800 : raw;
    return Math.max(1 / 1.2, Math.min(1.2, Math.exp(-d * 0.01)));
}
function mapRawMouseButton(rawButton) {
    return Number.isInteger(rawButton) && rawButton >= 0 && rawButton <= 4
        ? BUTTONS[rawButton]
        : null;
}
const installedTargets = new WeakSet();
/** Attaches pointer, pointer-capture drag, wheel/pinch, and DOM drag IPC listeners to `g`, returning an idempotent teardown callback. */
function installCatcherInputBridge(g, ipc, now = () => Date.now(), getPathForFile = resolveFilePath) {
    if (!g ||
        typeof g !== 'object' ||
        typeof g.addEventListener !== 'function' ||
        typeof ipc?.send !== 'function' ||
        installedTargets.has(g)) {
        return () => { };
    }
    installedTargets.add(g);
    const clicks = createMultiClickTrackerState();
    let nextPressId = 0;
    let activeDrag = null;
    let lastDragKey = null;
    const emit = (ch, p) => ipc.send(ch, p);
    const toCoord = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v || 0 : fallback;
    const isOut = (x, y) => {
        const w = toCoord(g.innerWidth);
        const h = toCoord(g.innerHeight);
        return w <= 0 || h <= 0
            ? x < 0 || y < 0
            : x < 0 || y < 0 || x >= w || y >= h;
    };
    const isForeign = (ev) => activeDrag !== null &&
        activeDrag.pointerId !== null &&
        typeof ev.pointerId === 'number' &&
        ev.pointerId !== activeDrag.pointerId;
    const clearDrag = (rel) => {
        const prev = activeDrag;
        activeDrag = null;
        if (prev && rel && prev.pointerId !== null) {
            try {
                prev.capEl?.releasePointerCapture?.(prev.pointerId);
            }
            catch {
                // Pointer capture may already have been revoked by Chromium.
            }
        }
        return prev;
    };
    const emitUp = (x, y, m, out, r = true) => {
        const prev = clearDrag(r);
        if (prev) {
            const { pressId, button, clickCount } = prev;
            const p = { pressId, x, y, button, clickCount, modifiers: m };
            emit(exports.WCV_CATCHER_POINTER_UP_CHANNEL, { ...p, outOfBounds: out });
        }
    };
    const releaseEv = (ev, forceOut, rel) => {
        if (activeDrag !== null) {
            const x = toCoord(ev.clientX, activeDrag.x);
            const y = toCoord(ev.clientY, activeDrag.y);
            emitUp(x, y, toCatcherMouseModifiers(ev), forceOut || isOut(x, y), rel);
        }
    };
    const onResetDrag = () => ((lastDragKey = null), void clearDrag(true));
    const applyCursor = (cursor) => {
        if (g.document?.documentElement?.style) {
            g.document.documentElement.style.cursor = cursor;
        }
        if (g.document?.body?.style) {
            g.document.body.style.cursor = cursor;
        }
    };
    const onSetCursor = (_ev, rawCursor) => {
        const next = typeof rawCursor === 'string' && rawCursor.trim()
            ? rawCursor.trim()
            : 'default';
        applyCursor(next);
    };
    const onPointerDown = (ev) => {
        ev.preventDefault?.();
        if (isForeign(ev)) {
            return;
        }
        const rawButton = typeof ev.button === 'number' ? ev.button : 0;
        const button = mapRawMouseButton(rawButton);
        if (!button) {
            return;
        }
        const x = toCoord(ev.clientX);
        const y = toCoord(ev.clientY);
        const modifiers = toCatcherMouseModifiers(ev);
        // Chorded buttons on an already-depressed mouse fire `pointermove`, never
        // `pointerdown` (W3C Pointer Events §10), so a new `pointerdown` while
        // `activeDrag` is non-null means the prior release was missed.
        if (activeDrag !== null) {
            emitUp(x, y, modifiers, isOut(x, y));
        }
        const pressId = ++nextPressId;
        if (button === 'back' || button === 'forward') {
            clicks.count = 0;
            const p = { pressId, x, y, button, rawButton, clickCount: 1, modifiers };
            emit(exports.WCV_CATCHER_POINTER_DOWN_CHANNEL, p);
            return;
        }
        const clickCount = nextMultiClickCount(clicks, now(), x, y, rawButton);
        const pointerId = typeof ev.pointerId === 'number' ? ev.pointerId : null;
        const doc = pointerId === null ? null : g.document;
        const capEl = doc?.documentElement ?? doc?.body ?? null;
        if (capEl && pointerId !== null) {
            try {
                capEl.setPointerCapture?.(pointerId);
            }
            catch {
                // Synthetic events may carry a pointerId without an active OS pointer.
            }
        }
        activeDrag = { pressId, pointerId, capEl, button, clickCount, x, y };
        const p = { pressId, x, y, button, rawButton, clickCount, modifiers };
        emit(exports.WCV_CATCHER_POINTER_DOWN_CHANNEL, p);
    };
    const onPointerMove = (ev) => {
        if (isForeign(ev)) {
            return;
        }
        const x = toCoord(ev.clientX, activeDrag ? activeDrag.x : 0);
        const y = toCoord(ev.clientY, activeDrag ? activeDrag.y : 0);
        const modifiers = toCatcherMouseModifiers(ev);
        if (activeDrag !== null && ev.buttons === 0) {
            const out = isOut(x, y);
            emitUp(x, y, modifiers, out);
            if (out) {
                return;
            }
        }
        if (activeDrag !== null) {
            activeDrag.x = x;
            activeDrag.y = y;
            const d = Math.hypot(x - clicks.lastX, y - clicks.lastY);
            if (d > MULTI_CLICK_MAX_DISTANCE_DIP) {
                clicks.count = 0;
            }
        }
        const isDragging = activeDrag !== null;
        const pressId = activeDrag ? activeDrag.pressId : null;
        const button = activeDrag ? activeDrag.button : 'none';
        const p = { pressId, isDragging, x, y, button, modifiers };
        emit(exports.WCV_CATCHER_POINTER_MOVE_CHANNEL, p);
    };
    const finishPointerDrag = (ev) => {
        if (isForeign(ev)) {
            return;
        }
        if (ev.button === 3 || ev.button === 4) {
            // Chromium fires `pointerup` only when all held buttons on the shared
            // mouse `pointerId` reach `buttons === 0`, so prevent default history
            // navigation without aborting release of a chorded primary drag.
            ev.preventDefault?.();
        }
        releaseEv(ev, ev.type === 'pointercancel', true);
    };
    const onLostCapture = (ev) => {
        if (!isForeign(ev)) {
            releaseEv(ev, true, false);
        }
    };
    const onPointerLeave = () => {
        if (activeDrag === null) {
            ipc.send(exports.WCV_CATCHER_POINTER_LEAVE_CHANNEL);
        }
    };
    const onWheel = (ev) => {
        if (ev.isTrusted === false) {
            return;
        }
        const x = toCoord(ev.clientX);
        const y = toCoord(ev.clientY);
        const deltaY = toCoord(ev.deltaY);
        if (ev.ctrlKey) {
            ev.preventDefault?.();
            const scaleFactor = computePinchScaleFactor(deltaY, ev.deltaMode);
            emit(exports.WCV_CATCHER_PINCH_CHANNEL, { x, y, scaleFactor });
            return;
        }
        const deltaX = toCoord(ev.deltaX);
        const modifiers = toCatcherMouseModifiers(ev);
        emit(exports.WCV_CATCHER_WHEEL_CHANNEL, { x, y, deltaX, deltaY, modifiers });
    };
    const readDrag = (ev) => {
        const dt = ev.dataTransfer;
        const types = Array.from(dt?.types ?? []).filter((t) => typeof t === 'string' && t.length > 0);
        const hasFiles = types.includes('Files') ||
            Array.from(dt?.items ?? []).some((it) => it?.kind === 'file') ||
            Array.from(dt?.files ?? []).length > 0;
        const [x, y] = [toCoord(ev.clientX), toCoord(ev.clientY)];
        return { x, y, modifiers: toCatcherMouseModifiers(ev), types, hasFiles };
    };
    const onDrag = (phase) => (ev) => {
        if (ev.isTrusted !== false) {
            ev.preventDefault?.();
            const b = readDrag(ev);
            const k = `${phase}:${b.x}:${b.y}:${b.modifiers}:${b.hasFiles ? 1 : 0}:${b.types.join('\0')}`;
            if (phase !== 'over' || k !== lastDragKey) {
                lastDragKey = k;
                emit(exports.WCV_CATCHER_DRAG_CHANNEL, { phase, ...b });
            }
        }
    };
    const onDragLeave = (ev) => {
        const out = ev.relatedTarget === null || ev.relatedTarget === undefined;
        if (ev.isTrusted !== false && out) {
            lastDragKey = null;
            emit(exports.WCV_CATCHER_DRAG_CHANNEL, { phase: 'leave', ...readDrag(ev) });
        }
    };
    const onDrop = (ev) => {
        if (ev.isTrusted === false) {
            return;
        }
        ev.preventDefault?.();
        lastDragKey = null;
        const [dt, b] = [ev.dataTransfer, readDrag(ev)];
        const files = Array.from(dt?.files ?? [])
            .map((f) => safeStr(() => getPathForFile(f)) ?? '')
            .filter(Boolean);
        const items = [];
        const getData = dt?.getData;
        if (typeof getData === 'function') {
            for (const mimeType of b.types.filter((t) => t !== 'Files')) {
                const data = safeStr(() => getData.call(dt, mimeType));
                if (data !== null) {
                    items.push({ mimeType, data });
                }
            }
        }
        const hasFiles = b.hasFiles || files.length > 0;
        const p = { phase: 'drop', ...b, hasFiles, files, items };
        emit(exports.WCV_CATCHER_DRAG_CHANNEL, p);
    };
    const noDefault = (ev) => void ev.preventDefault?.();
    const winEvents = [
        ['pointerdown', onPointerDown, true],
        ['pointermove', onPointerMove, true],
        ['pointerup', finishPointerDrag, true],
        ['pointercancel', finishPointerDrag, true],
        ['lostpointercapture', onLostCapture, true],
        ['wheel', onWheel, WHEEL_OPTS],
        ['dragenter', onDrag('enter'), true],
        ['dragover', onDrag('over'), true],
        ['dragleave', onDragLeave, true],
        ['drop', onDrop, true],
        ...SUPPRESSED.map((t) => [t, noDefault, true]),
    ];
    // Omit `window` `'blur'`: focusing the guest shortly after `pointerdown`
    // blurs the catcher window mid-click while OS pointer capture stays active.
    for (const [t, fn, opts] of winEvents) {
        g.addEventListener(t, fn, opts);
    }
    // Target-phase `pointerleave` on `document` works at `document_start` before
    // `documentElement` exists and ignores internal `<body>` crossings.
    const docTarget = typeof g.document?.addEventListener === 'function' ? g.document : g;
    docTarget.addEventListener?.('pointerleave', onPointerLeave);
    ipc.on?.(exports.WCV_CATCHER_RESET_DRAG_CHANNEL, onResetDrag);
    ipc.on?.(exports.WCV_CATCHER_SET_CURSOR_CHANNEL, onSetCursor);
    let tornDown = false;
    return () => {
        if (tornDown) {
            return;
        }
        tornDown = true;
        lastDragKey = null;
        clearDrag(true);
        ipc.removeListener?.(exports.WCV_CATCHER_RESET_DRAG_CHANNEL, onResetDrag);
        ipc.removeListener?.(exports.WCV_CATCHER_SET_CURSOR_CHANNEL, onSetCursor);
        applyCursor('');
        for (const [t, fn, opts] of winEvents) {
            g.removeEventListener?.(t, fn, opts);
        }
        docTarget.removeEventListener?.('pointerleave', onPointerLeave);
        installedTargets.delete(g);
    };
}
const defaultWin = globalThis.window ?? null;
if (typeof defaultWin?.addEventListener === 'function' &&
    typeof electron_1.ipcRenderer?.send === 'function') {
    const bind = (fn) => typeof fn === 'function' ? fn.bind(electron_1.ipcRenderer) : undefined;
    installCatcherInputBridge(defaultWin, {
        send: electron_1.ipcRenderer.send.bind(electron_1.ipcRenderer),
        on: bind(electron_1.ipcRenderer.on),
        removeListener: bind(electron_1.ipcRenderer.removeListener),
    });
}
