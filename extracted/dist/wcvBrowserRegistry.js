"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wcvBrowserRegistry = exports.WcvBrowserRegistry = exports.NO_DRAG_USER_CSS = exports.WCV_GUEST_EVENT_CHANNEL = exports.DEFAULT_HIDDEN_WCV_BOUNDS = exports.FALLBACK_HIDDEN_WCV_MEMORY_BYTES = exports.DEFAULT_HIDDEN_WCV_MEMORY_BUDGET_BYTES = exports.DEFAULT_MIN_HIDDEN_WCV_TABS = exports.MAX_HIDDEN_WCV_TABS = void 0;
exports.computeGuestMemoryBytesByWebContentsId = computeGuestMemoryBytesByWebContentsId;
const electron_1 = require("electron");
const beyondcorpPac_1 = require("./beyondcorpPac");
const utils_1 = require("./utils");
const webauthn_1 = require("./webauthn");
const webviewBrowser_1 = require("./webviewBrowser");
exports.MAX_HIDDEN_WCV_TABS = 20;
exports.DEFAULT_MIN_HIDDEN_WCV_TABS = 3;
exports.DEFAULT_HIDDEN_WCV_MEMORY_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;
exports.FALLBACK_HIDDEN_WCV_MEMORY_BYTES = 50 * 1024 * 1024;
/**
 * Computes physical working-set memory in bytes per guest `webContentsId` from
 * Electron `app.getAppMetrics()` (`workingSetSize` is reported in KB), dividing
 * shared renderer OS PIDs evenly across guests sharing that PID so physical RAM
 * is not double-counted.
 */
function computeGuestMemoryBytesByWebContentsId(guests, metrics) {
    const result = new Map();
    if (!Array.isArray(metrics) || metrics.length === 0 || guests.length === 0) {
        return result;
    }
    const bytesByPid = new Map();
    for (const metric of metrics) {
        const pid = metric?.pid;
        const kb = metric?.memory?.workingSetSize;
        if (typeof pid === 'number' &&
            pid > 0 &&
            typeof kb === 'number' &&
            Number.isFinite(kb) &&
            kb >= 0) {
            bytesByPid.set(pid, Math.round(kb * 1024));
        }
    }
    const uniqueGuests = [];
    const seenIds = new Set();
    for (const guest of guests) {
        if (!seenIds.has(guest.webContentsId)) {
            seenIds.add(guest.webContentsId);
            uniqueGuests.push(guest);
        }
    }
    const pidCounts = new Map();
    for (const guest of uniqueGuests) {
        if (typeof guest.pid === 'number' && bytesByPid.has(guest.pid)) {
            pidCounts.set(guest.pid, (pidCounts.get(guest.pid) ?? 0) + 1);
        }
    }
    for (const guest of uniqueGuests) {
        if (typeof guest.pid !== 'number') {
            continue;
        }
        const pidBytes = bytesByPid.get(guest.pid);
        const sharedCount = pidCounts.get(guest.pid) ?? 1;
        if (pidBytes !== undefined) {
            result.set(guest.webContentsId, Math.round(pidBytes / sharedCount));
        }
    }
    return result;
}
exports.DEFAULT_HIDDEN_WCV_BOUNDS = {
    x: 0,
    y: 0,
    width: 1280,
    height: 800,
};
exports.WCV_GUEST_EVENT_CHANNEL = 'wcv:guest-event';
exports.NO_DRAG_USER_CSS = '*, *::before, *::after { -webkit-app-region: no-drag !important; app-region: no-drag !important; }';
const VALID_PARTITION_RE = /^persist:hub-browser-[a-zA-Z0-9_-]+$/;
const contentViewOf = (win) => !win || win.isDestroyed?.()
    ? undefined
    : win.contentView;
/** Main-process registry managing built-in browser `WebContentsView` instances keyed by `tabKey`. */
class WcvBrowserRegistry {
    constructor(options = {}) {
        this.options = options;
        this.entries = new Map();
        this.byWebContentsId = new Map();
        this.evicted = new Map();
        this.activeRequestedTabByWindow = new WeakMap();
        this.monitoredWindows = new WeakSet();
        this.userMutedTabs = new Set();
        this.bootstrappedBlankEntries = new WeakSet();
        this.externallyNavigatedEntries = new WeakSet();
    }
    now() {
        return this.options.now ? this.options.now() : Date.now();
    }
    async acquire(parentWindow, hubSender, request) {
        if (!request.tabKey || !VALID_PARTITION_RE.test(request.partition)) {
            throw new Error(`Invalid WCV tabKey or partition: ${request.tabKey}`);
        }
        const existing = this.entries.get(request.tabKey);
        if (existing &&
            !existing.view.webContents.isDestroyed() &&
            existing.partition === request.partition) {
            if (!existing.hubSender.isDestroyed() &&
                existing.hubSender.id !== hubSender.id &&
                existing.parentWindow !== parentWindow &&
                !existing.parentWindow.isDestroyed?.()) {
                throw new Error(`Tab ${request.tabKey} is already owned by another Hub window`);
            }
            existing.parentWindow = parentWindow;
            existing.hubSender = hubSender;
            existing.lastShownAt = this.now();
            return this.toSnapshot(existing);
        }
        const saved = this.evicted.get(request.tabKey);
        if (saved &&
            saved.hubSenderId !== hubSender.id &&
            saved.parentWindow !== parentWindow &&
            !saved.parentWindow.isDestroyed?.()) {
            throw new Error(`Tab ${request.tabKey} is already owned by another Hub window`);
        }
        const preservedUrl = existing?.lastUrl || saved?.url || '';
        const lastTitle = existing?.lastTitle || saved?.title || request.title || '';
        if (existing) {
            this.dispose(request.tabKey, false);
        }
        this.evicted.delete(request.tabKey);
        const view = this.options.createView
            ? this.options.createView(request.partition)
            : new electron_1.WebContentsView({
                webPreferences: {
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                    webviewTag: false,
                    navigateOnDragDrop: false,
                    focusOnNavigation: false,
                    backgroundThrottling: false,
                    partition: request.partition,
                },
            });
        const wc = view.webContents;
        const rawTargetUrl = preservedUrl && preservedUrl !== 'about:blank'
            ? preservedUrl
            : request.initialUrl || '';
        const isExternalAuth = (0, webviewBrowser_1.isExternalOnlyAuthUrl)(rawTargetUrl);
        const lastUrl = isExternalAuth ? '' : rawTargetUrl;
        const entry = {
            ...request,
            view,
            webContentsId: wc.id,
            parentWindow,
            hubSender,
            lastShownAt: this.now(),
            lastUrl,
            lastTitle,
        };
        this.entries.set(request.tabKey, entry);
        this.byWebContentsId.set(wc.id, entry);
        const openExternal = (url) => this.openExternalUrl(url);
        (0, utils_1.registerWindowWebContents)(parentWindow, wc);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (0, webauthn_1.configureSessionWebAuthn)(wc.session);
        (0, webauthn_1.attachWebviewWebAuthnUserActivationTracking)(wc);
        (0, webviewBrowser_1.configureWebviewBrowserContents)(wc, {
            allowWebContentsView: true,
            hostWebContents: hubSender,
            getParentWindow: () => parentWindow,
            openExternal,
        });
        wc.setAudioMuted?.(true);
        this.attachGuestListeners(entry);
        if (!this.monitoredWindows.has(parentWindow)) {
            this.monitoredWindows.add(parentWindow);
            parentWindow.once?.('closed', () => {
                this.disposeForWindow(parentWindow);
            });
        }
        this.parkHiddenView(entry);
        let guestNavigationStarted = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wcAny = wc;
        const onPreProxyNav = (details, url, _isInPlace, isMainFrame = true) => {
            const navUrl = (url ?? details?.url ?? '').trim();
            const mainFrame = (details?.isMainFrame ?? isMainFrame) !== false;
            if (mainFrame && navUrl && navUrl.toLowerCase() !== 'about:blank') {
                guestNavigationStarted = true;
            }
        };
        wcAny.on?.('did-start-navigation', onPreProxyNav);
        wcAny.on?.('will-navigate', onPreProxyNav);
        const configureProxy = this.options.configureProxy ?? beyondcorpPac_1.configureWebviewSessionProxy;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await configureProxy(wc.session);
        }
        finally {
            wcAny.removeListener?.('did-start-navigation', onPreProxyNav);
            wcAny.removeListener?.('will-navigate', onPreProxyNav);
        }
        if (!wc.isDestroyed()) {
            const currentLiveUrl = (wc.getURL?.() || '').trim();
            const hasConcurrentNavigation = guestNavigationStarted ||
                this.externallyNavigatedEntries.has(entry) ||
                Boolean(wc.isLoading?.()) ||
                (Boolean(currentLiveUrl) &&
                    currentLiveUrl.toLowerCase() !== 'about:blank') ||
                (Boolean(entry.lastUrl) && entry.lastUrl !== lastUrl);
            if (isExternalAuth && !hasConcurrentNavigation) {
                void openExternal(rawTargetUrl);
            }
            if (!hasConcurrentNavigation) {
                if (!isExternalAuth &&
                    (0, webviewBrowser_1.validateWebviewNavigationUrl)(lastUrl, 'http://127.0.0.1').allowed) {
                    await wc.loadURL(lastUrl).catch(() => undefined);
                }
                else {
                    this.bootstrappedBlankEntries.add(entry);
                    await wc.loadURL('about:blank').catch(() => undefined);
                }
            }
        }
        this.evictHiddenIfNeeded();
        return this.toSnapshot(entry);
    }
    show(tabKey, boundsDip, parentWindow) {
        const entry = this.entries.get(tabKey);
        const targetWindow = entry?.parentWindow ?? parentWindow;
        if (targetWindow) {
            this.activeRequestedTabByWindow.set(targetWindow, tabKey);
        }
        if (!entry || entry.view.webContents.isDestroyed()) {
            if (targetWindow) {
                this.detachVisibleSiblings(targetWindow);
            }
            return null;
        }
        entry.visible = true;
        entry.lastShownAt = this.now();
        entry.view.webContents.setAudioMuted?.(this.userMutedTabs.has(tabKey));
        this.setBounds(tabKey, boundsDip);
        const contentView = contentViewOf(entry.parentWindow);
        const hubView = (0, utils_1.getHubView)(entry.parentWindow);
        const children = contentView?.children;
        if (hubView && Array.isArray(children)) {
            const withoutEntry = children.filter((child) => child !== entry.view);
            const hubIdx = withoutEntry.indexOf(hubView);
            if (hubIdx >= 0) {
                contentView?.addChildView?.(entry.view, hubIdx);
            }
            else {
                contentView?.addChildView?.(entry.view);
                contentView?.addChildView?.(hubView);
            }
        }
        else {
            contentView?.addChildView?.(entry.view);
            if (hubView) {
                contentView?.addChildView?.(hubView);
            }
        }
        this.detachVisibleSiblings(entry.parentWindow, entry);
        return this.toSnapshot(entry);
    }
    getEvictedSenderId(tabKey) {
        return this.evicted.get(tabKey)?.hubSenderId;
    }
    hasEvicted(tabKey, hubSenderId) {
        const saved = this.evicted.get(tabKey);
        if (!saved) {
            return false;
        }
        return hubSenderId === undefined || saved.hubSenderId === hubSenderId;
    }
    async rehydrateEvictedAndShow(parentWindow, hubSender, tabKey, boundsDip) {
        const saved = this.evicted.get(tabKey);
        if (!saved || saved.hubSenderId !== hubSender.id) {
            return null;
        }
        this.activeRequestedTabByWindow.set(parentWindow, tabKey);
        this.detachVisibleSiblings(parentWindow);
        await this.acquire(parentWindow, hubSender, {
            tabKey,
            partition: saved.partition,
            initialUrl: saved.url,
            title: saved.title,
        });
        if (parentWindow.isDestroyed?.() ||
            this.activeRequestedTabByWindow.get(parentWindow) !== tabKey) {
            if (parentWindow.isDestroyed?.()) {
                this.dispose(tabKey);
            }
            return null;
        }
        return this.show(tabKey, boundsDip, parentWindow);
    }
    hide(tabKey) {
        this.mutate(tabKey, (entry) => {
            if (this.activeRequestedTabByWindow.get(entry.parentWindow) === tabKey) {
                this.activeRequestedTabByWindow.delete(entry.parentWindow);
            }
            this.detachView(entry);
        });
    }
    setBounds(tabKey, bounds) {
        const entry = this.entries.get(tabKey);
        if (!entry) {
            return;
        }
        const round = (value) => typeof value === 'number' && Number.isFinite(value)
            ? Math.round(value)
            : 0;
        entry.boundsDip = {
            x: round(bounds.x),
            y: round(bounds.y),
            width: Math.max(0, round(bounds.width)),
            height: Math.max(0, round(bounds.height)),
        };
        if (entry.boundsDip.width > 0 && entry.boundsDip.height > 0) {
            entry.lastNonZeroSize = {
                width: entry.boundsDip.width,
                height: entry.boundsDip.height,
            };
        }
        if (entry.visible && !entry.view.webContents.isDestroyed()) {
            entry.view.setBounds(entry.boundsDip);
        }
    }
    setPinned(tabKey, pinned) {
        this.mutate(tabKey, (entry) => (entry.pinned = pinned));
    }
    setAgentStepActive(tabKey, active) {
        this.mutate(tabKey, (entry) => (entry.isAgentStepActive = active));
    }
    setUserMuted(tabKey, muted) {
        if (muted) {
            this.userMutedTabs.add(tabKey);
        }
        else {
            this.userMutedTabs.delete(tabKey);
        }
        const entry = this.entries.get(tabKey);
        if (entry && !entry.view.webContents.isDestroyed()) {
            entry.view.webContents.setAudioMuted?.(muted || !entry.visible);
        }
    }
    isUserMuted(tabKey) {
        return this.userMutedTabs.has(tabKey);
    }
    openExternalUrl(url) {
        const fn = this.options.openExternal ??
            ((targetUrl) => electron_1.shell.openExternal(targetUrl));
        return fn(url);
    }
    /**
     * Records an explicit caller-initiated navigation for `tabKey` so an
     * in-flight `acquire()` awaiting `configureProxy` will not overwrite it with
     * an `about:blank` bootstrap or stale `initialUrl`.
     */
    noteExternalNavigation(tabKey, url) {
        const entry = this.entries.get(tabKey);
        if (!entry) {
            return;
        }
        this.externallyNavigatedEntries.add(entry);
        if (url && url !== 'about:blank') {
            entry.lastUrl = url;
        }
    }
    dispose(tabKey, clearEvicted = true) {
        if (clearEvicted) {
            this.evicted.delete(tabKey);
            this.userMutedTabs.delete(tabKey);
        }
        const entry = this.entries.get(tabKey);
        if (!entry) {
            return;
        }
        entry.visible = false;
        contentViewOf(entry.parentWindow)?.removeChildView?.(entry.view);
        this.entries.delete(tabKey);
        this.byWebContentsId.delete(entry.webContentsId);
        if (!entry.view.webContents.isDestroyed()) {
            entry.view.webContents.close?.();
        }
    }
    disposeForWindow(win) {
        for (const [tabKey, entry] of this.entries.entries()) {
            if (entry.parentWindow === win) {
                this.dispose(tabKey);
            }
        }
        for (const [tabKey, saved] of this.evicted.entries()) {
            if (saved.parentWindow === win) {
                this.evicted.delete(tabKey);
                this.userMutedTabs.delete(tabKey);
            }
        }
    }
    getEntry(tabKey) {
        return this.entries.get(tabKey);
    }
    computeGuestMemoryBytes(guests, metrics) {
        let resolved = metrics;
        if (resolved === undefined) {
            try {
                resolved = (this.options.getAppMetrics ?? (() => electron_1.app.getAppMetrics?.() ?? []))();
            }
            catch {
                resolved = [];
            }
        }
        return computeGuestMemoryBytesByWebContentsId(guests, resolved);
    }
    isRegisteredWcv(webContentsId) {
        const entry = this.byWebContentsId.get(webContentsId);
        return Boolean(entry && !entry.view.webContents.isDestroyed());
    }
    isOwnedBySender(webContentsId, senderId) {
        const entry = this.byWebContentsId.get(webContentsId);
        return Boolean(senderId !== undefined &&
            entry &&
            !entry.view.webContents.isDestroyed() &&
            entry.hubSender.id === senderId);
    }
    mutate(tabKey, fn) {
        const entry = this.entries.get(tabKey);
        if (entry) {
            fn(entry);
            this.evictHiddenIfNeeded();
        }
    }
    resolveHiddenBounds(entry) {
        const win = entry.parentWindow;
        const contentSize = win?.getContentSize?.();
        const winBounds = !contentSize ? win?.getBounds?.() : undefined;
        const maxW = contentSize?.[0] ?? winBounds?.width ?? exports.DEFAULT_HIDDEN_WCV_BOUNDS.width;
        const maxH = contentSize?.[1] ?? winBounds?.height ?? exports.DEFAULT_HIDDEN_WCV_BOUNDS.height;
        const desiredW = entry.lastNonZeroSize?.width ?? exports.DEFAULT_HIDDEN_WCV_BOUNDS.width;
        const desiredH = entry.lastNonZeroSize?.height ?? exports.DEFAULT_HIDDEN_WCV_BOUNDS.height;
        const width = Math.max(1, Math.min(desiredW, maxW > 0 ? maxW : desiredW));
        const height = Math.max(1, Math.min(desiredH, maxH > 0 ? maxH : desiredH));
        const bounds = entry.boundsDip;
        const rawX = bounds && bounds.width > 0 ? bounds.x : 0;
        const rawY = bounds && bounds.height > 0 ? bounds.y : 0;
        const x = maxW > 0
            ? Math.max(0, Math.min(rawX, Math.max(0, maxW - width)))
            : Math.max(0, rawX);
        const y = maxH > 0
            ? Math.max(0, Math.min(rawY, Math.max(0, maxH - height)))
            : Math.max(0, rawY);
        return { x, y, width, height };
    }
    /**
     * Moves hidden tab `tabKey` directly below the curtain so no other hidden
     * tab occludes it, keeping its compositor surface capturable.
     */
    prepareHiddenCapture(tabKey) {
        const entry = this.entries.get(tabKey);
        if (entry && !entry.visible && !entry.view.webContents.isDestroyed()) {
            this.parkHiddenView(entry);
        }
    }
    parkHiddenView(entry) {
        entry.visible = false;
        const contentView = contentViewOf(entry.parentWindow);
        if (entry.view.webContents.isDestroyed()) {
            contentView?.removeChildView?.(entry.view);
            return;
        }
        const curtainView = (0, utils_1.getHubCurtainView)(entry.parentWindow);
        if (!curtainView) {
            contentView?.removeChildView?.(entry.view);
            return;
        }
        entry.view.setBounds?.(this.resolveHiddenBounds(entry));
        // Insert directly below the curtain (above older hidden tabs) so that
        // stacked hidden tabs never occlude the most recently parked one. Index is
        // computed as if `entry.view` were already removed from `children`.
        const children = contentView?.children ?? [];
        const withoutEntry = children.filter((child) => child !== entry.view);
        const curtainIdx = withoutEntry.indexOf(curtainView);
        contentView?.addChildView?.(entry.view, Math.max(0, curtainIdx));
    }
    detachVisibleSiblings(parentWindow, exceptEntry) {
        for (const sibling of this.entries.values()) {
            if (sibling !== exceptEntry &&
                sibling.parentWindow === parentWindow &&
                sibling.visible) {
                this.detachView(sibling);
            }
        }
    }
    detachView(entry) {
        if (!entry.view.webContents.isDestroyed()) {
            entry.view.webContents.setAudioMuted?.(true);
        }
        this.parkHiddenView(entry);
    }
    evictHiddenIfNeeded() {
        const maxHidden = this.options.maxHiddenTabs ?? exports.MAX_HIDDEN_WCV_TABS;
        const minHidden = Math.min(maxHidden, this.options.minHiddenTabs ?? exports.DEFAULT_MIN_HIDDEN_WCV_TABS);
        const memoryBudget = this.options.memoryBudgetBytes ?? exports.DEFAULT_HIDDEN_WCV_MEMORY_BUDGET_BYTES;
        const fallbackBytes = this.options.fallbackGuestMemoryBytes ?? exports.FALLBACK_HIDDEN_WCV_MEMORY_BYTES;
        const idleHidden = [...this.entries.values()]
            .filter((e) => !e.visible && !e.pinned && !e.isAgentStepActive)
            .sort((a, b) => a.lastShownAt - b.lastShownAt);
        if (idleHidden.length === 0) {
            return;
        }
        const allGuests = [...this.entries.values()]
            .filter((entry) => !entry.view.webContents.isDestroyed())
            .map((entry) => {
            let pid;
            try {
                pid = entry.view.webContents.getOSProcessId?.();
            }
            catch {
                pid = undefined;
            }
            return { webContentsId: entry.webContentsId, pid };
        });
        const bytesByWcId = this.computeGuestMemoryBytes(allGuests);
        const memoryOf = (entry) => bytesByWcId.get(entry.webContentsId) ?? fallbackBytes;
        let totalMemory = idleHidden.reduce((sum, e) => sum + memoryOf(e), 0);
        while (idleHidden.length > 0) {
            const exceedsMaxCount = idleHidden.length > maxHidden;
            const exceedsMemoryBudget = idleHidden.length > minHidden && totalMemory > memoryBudget;
            if (!exceedsMaxCount && !exceedsMemoryBudget) {
                break;
            }
            const victim = idleHidden.shift();
            totalMemory -= memoryOf(victim);
            const snap = this.toSnapshot(victim);
            this.evicted.set(victim.tabKey, {
                url: snap.url,
                title: snap.title,
                partition: victim.partition,
                hubSenderId: victim.hubSender.id,
                parentWindow: victim.parentWindow,
            });
            this.dispose(victim.tabKey, false);
        }
    }
    attachGuestListeners(entry) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        const injectNoDragCss = () => {
            if (!wc.isDestroyed()) {
                void wc
                    .insertCSS?.(exports.NO_DRAG_USER_CSS, { cssOrigin: 'user' })
                    .catch(() => undefined);
            }
        };
        const emit = (type, extra) => {
            if (!entry.hubSender.isDestroyed()) {
                entry.hubSender.send(exports.WCV_GUEST_EVENT_CHANNEL, {
                    type,
                    ...this.toSnapshot(entry),
                    ...extra,
                });
            }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const on = (event, listener) => wc.on?.(event, listener);
        const forwardNavEvent = (type, resetError = false) => on(type, (details, url, isInPlace, isMainFrame = true) => {
            const navUrl = url ?? details?.url;
            const mainFrame = (details?.isMainFrame ?? isMainFrame) !== false;
            if (!mainFrame) {
                return;
            }
            const inPlace = Boolean(details?.isInPlace ?? isInPlace);
            const isSameDocument = Boolean(details?.isSameDocument ?? inPlace);
            const isRedirect = type === 'did-redirect-navigation';
            if (resetError &&
                !inPlace &&
                !isSameDocument &&
                navUrl &&
                !navUrl.startsWith('chrome-error://')) {
                entry.crashed = false;
                entry.lastLoadError = null;
                entry.lastHttpResponseCode = null;
            }
            emit(type, {
                url: navUrl,
                isInPlace: inPlace,
                isSameDocument,
                isRedirect,
                isMainFrame: true,
            });
        });
        forwardNavEvent('will-navigate');
        forwardNavEvent('did-start-navigation', true);
        forwardNavEvent('did-redirect-navigation');
        on('dom-ready', () => {
            injectNoDragCss();
            emit('dom-ready');
        });
        on('did-start-loading', () => emit('did-start-loading'));
        on('did-stop-loading', () => emit('did-stop-loading'));
        on('did-navigate', (_event, url, httpResponseCode, httpStatusText) => {
            if (!url?.startsWith('chrome-error://')) {
                entry.crashed = false;
                entry.lastLoadError = null;
                entry.lastHttpResponseCode =
                    typeof httpResponseCode === 'number' && httpResponseCode > 0
                        ? httpResponseCode
                        : null;
                if (url && url !== 'about:blank') {
                    entry.lastUrl = url;
                    if (this.bootstrappedBlankEntries.delete(entry)) {
                        wc.navigationHistory?.clear?.();
                    }
                }
            }
            injectNoDragCss();
            emit('did-navigate', {
                url,
                ...(typeof httpResponseCode === 'number'
                    ? { httpResponseCode }
                    : undefined),
                ...(typeof httpStatusText === 'string'
                    ? { httpStatusText }
                    : undefined),
            });
        });
        on('did-navigate-in-page', (_event, url, isMainFrame = true) => {
            if (isMainFrame && url) {
                entry.lastUrl = url;
                emit('did-navigate-in-page', { url });
            }
        });
        on('page-title-updated', (_event, title) => {
            entry.lastTitle = title;
            emit('page-title-updated', { title });
        });
        on('page-favicon-updated', (_event, favicons) => emit('page-favicon-updated', { favicons }));
        on('context-menu', (_event, params) => emit('context-menu', { params }));
        on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame = true) => {
            if (isMainFrame && errorCode !== -3) {
                if (validatedURL &&
                    validatedURL !== 'about:blank' &&
                    !validatedURL.startsWith('chrome-error://')) {
                    entry.lastUrl = validatedURL;
                }
                if (errorCode !== -379) {
                    entry.lastLoadError = { errorCode, errorDescription, validatedURL };
                }
                emit('did-fail-load', { errorCode, errorDescription, validatedURL });
            }
        });
        on('render-process-gone', (_e, details) => {
            entry.crashed = true;
            emit('render-process-gone', { reason: details?.reason ?? 'crashed' });
        });
        wc.once?.('destroyed', () => {
            this.byWebContentsId.delete(entry.webContentsId);
            if (this.entries.get(entry.tabKey) === entry) {
                this.entries.delete(entry.tabKey);
            }
        });
    }
    toSnapshot(entry) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = entry.view.webContents;
        const isAlive = !wc.isDestroyed();
        const liveUrl = isAlive ? wc.getURL?.() || '' : '';
        const hasValidLiveUrl = Boolean(liveUrl) &&
            liveUrl !== 'about:blank' &&
            !liveUrl.startsWith('chrome-error://');
        const history = isAlive ? wc.navigationHistory : null;
        return {
            tabKey: entry.tabKey,
            webContentsId: entry.webContentsId,
            url: !entry.lastLoadError && hasValidLiveUrl ? liveUrl : entry.lastUrl,
            title: (isAlive ? wc.getTitle?.() || '' : '') || entry.lastTitle,
            canGoBack: Boolean(history?.canGoBack?.() ?? (isAlive && wc.canGoBack?.())),
            canGoForward: Boolean(history?.canGoForward?.() ?? (isAlive && wc.canGoForward?.())),
            isLoading: Boolean(isAlive && wc.isLoading?.()),
            visible: Boolean(entry.visible),
            pinned: Boolean(entry.pinned),
            crashed: Boolean(entry.crashed),
            lastHttpResponseCode: entry.lastHttpResponseCode ?? null,
            lastLoadError: entry.lastLoadError ?? null,
        };
    }
}
exports.WcvBrowserRegistry = WcvBrowserRegistry;
exports.wcvBrowserRegistry = new WcvBrowserRegistry();
