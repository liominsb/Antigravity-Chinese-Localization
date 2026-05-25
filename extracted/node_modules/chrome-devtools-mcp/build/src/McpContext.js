/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { UniverseManager } from './DevtoolsUtils.js';
import { HeapSnapshotManager } from './HeapSnapshotManager.js';
import { McpPage } from './McpPage.js';
import { NetworkCollector, ConsoleCollector, } from './PageCollector.js';
import { Locator } from './third_party/index.js';
import { PredefinedNetworkConditions } from './third_party/index.js';
import { listPages } from './tools/pages.js';
import { CLOSE_PAGE_ERROR } from './tools/ToolDefinition.js';
import { ensureExtension, saveTemporaryFile } from './utils/files.js';
import { getNetworkMultiplierFromString } from './WaitForHelper.js';
const DEFAULT_TIMEOUT = 5_000;
const NAVIGATION_TIMEOUT = 10_000;
export class McpContext {
    browser;
    logger;
    // Maps LLM-provided isolatedContext name → Puppeteer BrowserContext.
    #isolatedContexts = new Map();
    // Auto-generated name counter for when no name is provided.
    #nextIsolatedContextId = 1;
    #pages = [];
    #extensionServiceWorkers = [];
    #mcpPages = new Map();
    #selectedPage;
    #networkCollector;
    #consoleCollector;
    #devtoolsUniverseManager;
    #isRunningTrace = false;
    #screenRecorderData = null;
    #nextPageId = 1;
    #extensionPages = new WeakMap();
    #extensionServiceWorkerMap = new WeakMap();
    #nextExtensionServiceWorkerId = 1;
    #traceResults = [];
    #locatorClass;
    #options;
    #heapSnapshotManager = new HeapSnapshotManager();
    constructor(browser, logger, options, locatorClass) {
        this.browser = browser;
        this.logger = logger;
        this.#locatorClass = locatorClass;
        this.#options = options;
        this.#networkCollector = new NetworkCollector(this.browser);
        this.#consoleCollector = new ConsoleCollector(this.browser, collect => {
            return {
                console: event => {
                    collect(event);
                },
                uncaughtError: event => {
                    collect(event);
                },
                devtoolsAggregatedIssue: event => {
                    collect(event);
                },
            };
        });
        this.#devtoolsUniverseManager = new UniverseManager(this.browser);
    }
    async #init() {
        const pages = await this.createPagesSnapshot();
        await this.createExtensionServiceWorkersSnapshot();
        await this.#networkCollector.init(pages);
        await this.#consoleCollector.init(pages);
        await this.#devtoolsUniverseManager.init(pages);
    }
    dispose() {
        this.#networkCollector.dispose();
        this.#consoleCollector.dispose();
        this.#devtoolsUniverseManager.dispose();
        for (const mcpPage of this.#mcpPages.values()) {
            mcpPage.dispose();
        }
        this.#mcpPages.clear();
        // Isolated contexts are intentionally not closed here.
        // Either the entire browser will be closed or we disconnect
        // without destroying browser state.
        this.#isolatedContexts.clear();
    }
    static async from(browser, logger, opts, 
    /* Let tests use unbundled Locator class to avoid overly strict checks within puppeteer that fail when mixing bundled and unbundled class instances */
    locatorClass = Locator) {
        const context = new McpContext(browser, logger, opts, locatorClass);
        await context.#init();
        return context;
    }
    resolveCdpRequestId(page, cdpRequestId) {
        if (!cdpRequestId) {
            this.logger('no network request');
            return;
        }
        const request = this.#networkCollector.find(page.pptrPage, request => {
            // @ts-expect-error id is internal.
            return request.id === cdpRequestId;
        });
        if (!request) {
            this.logger('no network request for ' + cdpRequestId);
            return;
        }
        return this.#networkCollector.getIdForResource(request);
    }
    getNetworkRequests(page, includePreservedRequests) {
        return this.#networkCollector.getData(page.pptrPage, includePreservedRequests);
    }
    getConsoleData(page, includePreservedMessages) {
        return this.#consoleCollector.getData(page.pptrPage, includePreservedMessages);
    }
    getDevToolsUniverse(page) {
        return this.#devtoolsUniverseManager.get(page.pptrPage);
    }
    getConsoleMessageStableId(message) {
        return this.#consoleCollector.getIdForResource(message);
    }
    getConsoleMessageById(page, id) {
        return this.#consoleCollector.getById(page.pptrPage, id);
    }
    async newPage(background, isolatedContextName) {
        let page;
        if (isolatedContextName !== undefined) {
            let ctx = this.#isolatedContexts.get(isolatedContextName);
            if (!ctx) {
                ctx = await this.browser.createBrowserContext();
                this.#isolatedContexts.set(isolatedContextName, ctx);
            }
            page = await ctx.newPage();
        }
        else {
            page = await this.browser.newPage({ background });
        }
        await this.createPagesSnapshot();
        this.selectPage(this.#getMcpPage(page));
        this.#networkCollector.addPage(page);
        this.#consoleCollector.addPage(page);
        return this.#getMcpPage(page);
    }
    async closePage(pageId) {
        if (this.#pages.length === 1) {
            throw new Error(CLOSE_PAGE_ERROR);
        }
        const page = this.getPageById(pageId);
        if (page) {
            page.dispose();
            this.#mcpPages.delete(page.pptrPage);
        }
        await page.pptrPage.close({ runBeforeUnload: false });
    }
    getNetworkRequestById(page, reqid) {
        return this.#networkCollector.getById(page.pptrPage, reqid);
    }
    async restoreEmulation(page) {
        const currentSetting = page.emulationSettings;
        await this.emulate(currentSetting, page.pptrPage);
    }
    async emulate(options, targetPage) {
        const page = targetPage ?? this.getSelectedPptrPage();
        const mcpPage = this.#getMcpPage(page);
        const newSettings = { ...mcpPage.emulationSettings };
        if (!options.networkConditions) {
            await page.emulateNetworkConditions(null);
            delete newSettings.networkConditions;
        }
        else if (options.networkConditions === 'Offline') {
            await page.emulateNetworkConditions({
                offline: true,
                download: 0,
                upload: 0,
                latency: 0,
            });
            newSettings.networkConditions = 'Offline';
        }
        else if (options.networkConditions in PredefinedNetworkConditions) {
            const networkCondition = PredefinedNetworkConditions[options.networkConditions];
            await page.emulateNetworkConditions(networkCondition);
            newSettings.networkConditions = options.networkConditions;
        }
        if (!options.cpuThrottlingRate) {
            await page.emulateCPUThrottling(1);
            delete newSettings.cpuThrottlingRate;
        }
        else {
            await page.emulateCPUThrottling(options.cpuThrottlingRate);
            newSettings.cpuThrottlingRate = options.cpuThrottlingRate;
        }
        if (!options.geolocation) {
            await page.setGeolocation({ latitude: 0, longitude: 0 });
            delete newSettings.geolocation;
        }
        else {
            await page.setGeolocation(options.geolocation);
            newSettings.geolocation = options.geolocation;
        }
        if (!options.userAgent) {
            await page.setUserAgent({ userAgent: undefined });
            delete newSettings.userAgent;
        }
        else {
            await page.setUserAgent({ userAgent: options.userAgent });
            newSettings.userAgent = options.userAgent;
        }
        if (!options.colorScheme || options.colorScheme === 'auto') {
            await page.emulateMediaFeatures([
                { name: 'prefers-color-scheme', value: '' },
            ]);
            delete newSettings.colorScheme;
        }
        else {
            await page.emulateMediaFeatures([
                { name: 'prefers-color-scheme', value: options.colorScheme },
            ]);
            newSettings.colorScheme = options.colorScheme;
        }
        if (!options.viewport) {
            await page.setViewport(null);
            delete newSettings.viewport;
        }
        else {
            const defaults = {
                deviceScaleFactor: 1,
                isMobile: false,
                hasTouch: false,
                isLandscape: false,
            };
            const viewport = { ...defaults, ...options.viewport };
            await page.setViewport(viewport);
            newSettings.viewport = viewport;
        }
        mcpPage.emulationSettings = Object.keys(newSettings).length
            ? newSettings
            : {};
        this.#updateSelectedPageTimeouts();
    }
    setIsRunningPerformanceTrace(x) {
        this.#isRunningTrace = x;
    }
    isRunningPerformanceTrace() {
        return this.#isRunningTrace;
    }
    getScreenRecorder() {
        return this.#screenRecorderData;
    }
    setScreenRecorder(data) {
        this.#screenRecorderData = data;
    }
    isCruxEnabled() {
        return this.#options.performanceCrux;
    }
    getSelectedPptrPage() {
        const page = this.#selectedPage;
        if (!page) {
            throw new Error('No page selected');
        }
        if (page.pptrPage.isClosed()) {
            throw new Error(`The selected page has been closed. Call ${listPages().name} to see open pages.`);
        }
        return page.pptrPage;
    }
    getSelectedMcpPage() {
        const page = this.getSelectedPptrPage();
        return this.#getMcpPage(page);
    }
    getPageById(pageId) {
        const page = this.#mcpPages.values().find(mcpPage => mcpPage.id === pageId);
        if (!page) {
            throw new Error('No page found');
        }
        return page;
    }
    getPageId(page) {
        return this.#mcpPages.get(page)?.id;
    }
    #getMcpPage(page) {
        const mcpPage = this.#mcpPages.get(page);
        if (!mcpPage) {
            throw new Error('No McpPage found for the given page.');
        }
        return mcpPage;
    }
    #getSelectedMcpPage() {
        return this.#getMcpPage(this.getSelectedPptrPage());
    }
    isPageSelected(page) {
        return this.#selectedPage?.pptrPage === page;
    }
    selectPage(newPage) {
        this.#selectedPage = newPage;
        this.#updateSelectedPageTimeouts();
    }
    #updateSelectedPageTimeouts() {
        const page = this.#getSelectedMcpPage();
        // For waiters 5sec timeout should be sufficient.
        // Increased in case we throttle the CPU
        const cpuMultiplier = page.cpuThrottlingRate;
        page.pptrPage.setDefaultTimeout(DEFAULT_TIMEOUT * cpuMultiplier);
        // 10sec should be enough for the load event to be emitted during
        // navigations.
        // Increased in case we throttle the network requests
        const networkMultiplier = getNetworkMultiplierFromString(page.networkConditions);
        page.pptrPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT * networkMultiplier);
    }
    // Linear scan over per-page snapshots. The page count is small (typically
    // 2-10) so a reverse index isn't worthwhile given the uid-reuse lifecycle
    // complexity it would introduce.
    getAXNodeByUid(uid) {
        for (const mcpPage of this.#mcpPages.values()) {
            const node = mcpPage.textSnapshot?.idToNode.get(uid);
            if (node) {
                return node;
            }
        }
        return undefined;
    }
    /**
     * Creates a snapshot of the extension service workers.
     */
    async createExtensionServiceWorkersSnapshot() {
        const allTargets = await this.browser.targets();
        const serviceWorkers = allTargets.filter(target => {
            return (target.type() === 'service_worker' &&
                target.url().includes('chrome-extension://'));
        });
        for (const serviceWorker of serviceWorkers) {
            if (!this.#extensionServiceWorkerMap.has(serviceWorker)) {
                this.#extensionServiceWorkerMap.set(serviceWorker, 'sw-' + this.#nextExtensionServiceWorkerId++);
            }
        }
        this.#extensionServiceWorkers = serviceWorkers.map(serviceWorker => {
            return {
                target: serviceWorker,
                id: this.#extensionServiceWorkerMap.get(serviceWorker),
                url: serviceWorker.url(),
            };
        });
        return this.#extensionServiceWorkers;
    }
    async createPagesSnapshot() {
        const { pages: allPages, isolatedContextNames } = await this.#getAllPages();
        for (const page of allPages) {
            let mcpPage = this.#mcpPages.get(page);
            if (!mcpPage) {
                mcpPage = new McpPage(page, this.#nextPageId++);
                this.#mcpPages.set(page, mcpPage);
                // We emulate a focused page for all pages to support multi-agent workflows.
                void page.emulateFocusedPage(true).catch(error => {
                    this.logger('Error turning on focused page emulation', error);
                });
            }
            mcpPage.isolatedContextName = isolatedContextNames.get(page);
        }
        // Prune orphaned #mcpPages entries (pages that no longer exist).
        const currentPages = new Set(allPages);
        for (const [page, mcpPage] of this.#mcpPages) {
            if (!currentPages.has(page)) {
                mcpPage.dispose();
                this.#mcpPages.delete(page);
            }
        }
        this.#pages = allPages.filter(page => {
            return (this.#options.experimentalDevToolsDebugging ||
                !page.url().startsWith('devtools://'));
        });
        if ((!this.#selectedPage ||
            this.#pages.indexOf(this.#selectedPage.pptrPage) === -1) &&
            this.#pages[0]) {
            this.selectPage(this.#getMcpPage(this.#pages[0]));
        }
        await this.detectOpenDevToolsWindows();
        return this.#pages;
    }
    async #getAllPages() {
        const defaultCtx = this.browser.defaultBrowserContext();
        const allPages = await this.browser.pages(this.#options.experimentalIncludeAllPages);
        const allTargets = this.browser.targets();
        const extensionTargets = allTargets.filter(target => {
            return (target.url().startsWith('chrome-extension://') &&
                target.type() === 'page');
        });
        for (const target of extensionTargets) {
            // Right now target.page() returns null for popup and side panel pages.
            let page = await target.page();
            if (!page) {
                // We need to cache pages instances for targets because target.asPage()
                // returns a new page instance every time.
                page = this.#extensionPages.get(target) ?? null;
                if (!page) {
                    try {
                        page = await target.asPage();
                        this.#extensionPages.set(target, page);
                    }
                    catch (e) {
                        this.logger('Failed to get page for extension target', e);
                    }
                }
            }
            if (page && !allPages.includes(page)) {
                allPages.push(page);
            }
        }
        // Build a reverse lookup from BrowserContext instance → name.
        const contextToName = new Map();
        for (const [name, ctx] of this.#isolatedContexts) {
            contextToName.set(ctx, name);
        }
        // Auto-discover BrowserContexts not in our mapping (e.g., externally
        // created incognito contexts) and assign generated names.
        const knownContexts = new Set(this.#isolatedContexts.values());
        for (const ctx of this.browser.browserContexts()) {
            if (ctx !== defaultCtx && !ctx.closed && !knownContexts.has(ctx)) {
                const name = `isolated-context-${this.#nextIsolatedContextId++}`;
                this.#isolatedContexts.set(name, ctx);
                contextToName.set(ctx, name);
            }
        }
        // Map each page to its isolated context name (if any).
        const isolatedContextNames = new Map();
        for (const page of allPages) {
            const ctx = page.browserContext();
            const name = contextToName.get(ctx);
            if (name) {
                isolatedContextNames.set(page, name);
            }
        }
        return { pages: allPages, isolatedContextNames };
    }
    async detectOpenDevToolsWindows() {
        this.logger('Detecting open DevTools windows');
        const { pages } = await this.#getAllPages();
        await Promise.all(pages.map(async (page) => {
            const mcpPage = this.#mcpPages.get(page);
            if (!mcpPage) {
                return;
            }
            // Prior to Chrome 144.0.7559.59, the command fails,
            // Some Electron apps still use older version
            // Fall back to not exposing DevTools at all.
            try {
                if (await page.hasDevTools()) {
                    mcpPage.devToolsPage = await page.openDevTools();
                }
                else {
                    mcpPage.devToolsPage = undefined;
                }
            }
            catch {
                mcpPage.devToolsPage = undefined;
            }
        }));
    }
    getExtensionServiceWorkers() {
        return this.#extensionServiceWorkers;
    }
    getExtensionServiceWorkerId(extensionServiceWorker) {
        return this.#extensionServiceWorkerMap.get(extensionServiceWorker.target);
    }
    getPages() {
        return this.#pages;
    }
    getIsolatedContextName(page) {
        return this.#mcpPages.get(page)?.isolatedContextName;
    }
    async saveTemporaryFile(data, filename) {
        return await saveTemporaryFile(data, filename);
    }
    async saveFile(data, clientProvidedFilePath, extension) {
        try {
            const filePath = ensureExtension(path.resolve(clientProvidedFilePath), extension);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, data);
            return { filename: filePath };
        }
        catch (err) {
            this.logger(err);
            throw new Error('Could not save a file', { cause: err });
        }
    }
    storeTraceRecording(result) {
        // Clear the trace results because we only consume the latest trace currently.
        this.#traceResults = [];
        this.#traceResults.push(result);
    }
    recordedTraces() {
        return this.#traceResults;
    }
    getNetworkRequestStableId(request) {
        return this.#networkCollector.getIdForResource(request);
    }
    waitForTextOnPage(text, timeout, targetPage) {
        const page = targetPage ?? this.getSelectedPptrPage();
        const frames = page.frames();
        let locator = this.#locatorClass.race(frames.flatMap(frame => text.flatMap(value => [
            frame.locator(`aria/${value}`),
            frame.locator(`text/${value}`),
        ])));
        if (timeout) {
            locator = locator.setTimeout(timeout);
        }
        return locator.wait();
    }
    /**
     * We need to ignore favicon request as they make our test flaky
     */
    async setUpNetworkCollectorForTesting() {
        this.#networkCollector = new NetworkCollector(this.browser, collect => {
            return {
                request: req => {
                    if (req.url().includes('favicon.ico')) {
                        return;
                    }
                    collect(req);
                },
            };
        });
        const { pages } = await this.#getAllPages();
        await this.#networkCollector.init(pages);
    }
    async installExtension(extensionPath) {
        const id = await this.browser.installExtension(extensionPath);
        return id;
    }
    async uninstallExtension(id) {
        await this.browser.uninstallExtension(id);
    }
    async triggerExtensionAction(id) {
        const extensions = await this.browser.extensions();
        const extension = extensions.get(id);
        if (!extension) {
            throw new Error(`Extension with ID ${id} not found.`);
        }
        const page = this.getSelectedPptrPage();
        await extension.triggerAction(page);
    }
    listExtensions() {
        return this.browser.extensions();
    }
    async getExtension(id) {
        const pptrExtensions = await this.browser.extensions();
        return pptrExtensions.get(id);
    }
    async getHeapSnapshotAggregates(filePath) {
        return await this.#heapSnapshotManager.getAggregates(filePath);
    }
    async getHeapSnapshotStats(filePath) {
        return await this.#heapSnapshotManager.getStats(filePath);
    }
    async getHeapSnapshotStaticData(filePath) {
        return await this.#heapSnapshotManager.getStaticData(filePath);
    }
}
