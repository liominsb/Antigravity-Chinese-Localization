/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ConsoleFormatter } from './formatters/ConsoleFormatter.js';
import { HeapSnapshotFormatter } from './formatters/HeapSnapshotFormatter.js';
import { IssueFormatter } from './formatters/IssueFormatter.js';
import { NetworkFormatter } from './formatters/NetworkFormatter.js';
import { SnapshotFormatter } from './formatters/SnapshotFormatter.js';
import { UncaughtError } from './PageCollector.js';
import { TextSnapshot } from './TextSnapshot.js';
import { DevTools } from './third_party/index.js';
import { handleDialog } from './tools/pages.js';
import { getInsightOutput, getTraceSummary } from './trace-processing/parse.js';
import { paginate } from './utils/pagination.js';
export function replaceHtmlElementsWithUids(schema) {
    if (typeof schema === 'boolean') {
        return;
    }
    let isHtmlElement = false;
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'x-mcp-type' && value === 'HTMLElement') {
            isHtmlElement = true;
            break;
        }
    }
    if (isHtmlElement) {
        schema.properties = { uid: { type: 'string' } };
        schema.required = ['uid'];
    }
    if (schema.properties) {
        for (const key of Object.keys(schema.properties)) {
            replaceHtmlElementsWithUids(schema.properties[key]);
        }
    }
    if (schema.items) {
        if (Array.isArray(schema.items)) {
            for (const item of schema.items) {
                replaceHtmlElementsWithUids(item);
            }
        }
        else {
            replaceHtmlElementsWithUids(schema.items);
        }
    }
    if (schema.anyOf) {
        for (const s of schema.anyOf) {
            replaceHtmlElementsWithUids(s);
        }
    }
    if (schema.allOf) {
        for (const s of schema.allOf) {
            replaceHtmlElementsWithUids(s);
        }
    }
    if (schema.oneOf) {
        for (const s of schema.oneOf) {
            replaceHtmlElementsWithUids(s);
        }
    }
}
async function getToolGroup(page) {
    // Check if there is a `devtoolstooldiscovery` event listener
    const windowHandle = await page.pptrPage.evaluateHandle(() => window);
    // @ts-expect-error internal API
    const client = page.pptrPage._client();
    const { listeners } = await client.send('DOMDebugger.getEventListeners', {
        objectId: windowHandle.remoteObject().objectId,
    });
    if (listeners.find(l => l.type === 'devtoolstooldiscovery') === undefined) {
        return;
    }
    const toolGroup = await page.pptrPage.evaluate(() => {
        return new Promise(resolve => {
            const event = new CustomEvent('devtoolstooldiscovery');
            // @ts-expect-error Adding custom property
            event.respondWith = (toolGroup) => {
                if (!window.__dtmcp) {
                    window.__dtmcp = {};
                }
                window.__dtmcp.toolGroup = toolGroup;
                // When receiving a toolGroup for the first time, expose a simple execution helper
                if (!window.__dtmcp.executeTool) {
                    window.__dtmcp.executeTool = async (toolName, args) => {
                        if (!window.__dtmcp?.toolGroup) {
                            throw new Error('No tools found on the page');
                        }
                        const tool = window.__dtmcp.toolGroup.tools.find(t => t.name === toolName);
                        if (!tool) {
                            throw new Error(`Tool ${toolName} not found`);
                        }
                        return await tool.execute(args);
                    };
                }
                resolve(toolGroup);
            };
            window.dispatchEvent(event);
            // If the page does not synchronously call `event.respondWith`, return instead of timing out
            setTimeout(() => {
                resolve(undefined);
            }, 0);
        });
    });
    for (const tool of toolGroup?.tools ?? []) {
        replaceHtmlElementsWithUids(tool.inputSchema);
    }
    return toolGroup;
}
export class McpResponse {
    #includePages = false;
    #includeExtensionServiceWorkers = false;
    #includeExtensionPages = false;
    #snapshotParams;
    #attachedNetworkRequestId;
    #attachedNetworkRequestOptions;
    #attachedConsoleMessageId;
    #attachedTraceSummary;
    #attachedTraceInsight;
    #attachedLighthouseResult;
    #textResponseLines = [];
    #images = [];
    #heapSnapshotOptions;
    #networkRequestsOptions;
    #consoleDataOptions;
    #listExtensions;
    #listInPageTools;
    #listWebMcpTools;
    #devToolsData;
    #tabId;
    #args;
    #page;
    #redactNetworkHeaders = true;
    constructor(args) {
        this.#args = args;
    }
    setPage(page) {
        this.#page = page;
    }
    setRedactNetworkHeaders(value) {
        this.#redactNetworkHeaders = value;
    }
    attachDevToolsData(data) {
        this.#devToolsData = data;
    }
    setTabId(tabId) {
        this.#tabId = tabId;
    }
    setIncludePages(value) {
        this.#includePages = value;
        if (this.#args.categoryExtensions) {
            this.#includeExtensionServiceWorkers = value;
            this.#includeExtensionPages = value;
        }
    }
    includeSnapshot(params) {
        this.#snapshotParams = params ?? {
            verbose: false,
        };
    }
    setListExtensions() {
        this.#listExtensions = true;
    }
    setListInPageTools() {
        if (this.#args.categoryInPageTools) {
            this.#listInPageTools = true;
        }
    }
    setListWebMcpTools() {
        this.#listWebMcpTools = true;
    }
    setIncludeNetworkRequests(value, options) {
        if (!value) {
            this.#networkRequestsOptions = undefined;
            return;
        }
        this.#networkRequestsOptions = {
            include: value,
            pagination: options?.pageSize || options?.pageIdx
                ? {
                    pageSize: options.pageSize,
                    pageIdx: options.pageIdx,
                }
                : undefined,
            resourceTypes: options?.resourceTypes,
            includePreservedRequests: options?.includePreservedRequests,
            networkRequestIdInDevToolsUI: options?.networkRequestIdInDevToolsUI,
        };
    }
    setIncludeConsoleData(value, options) {
        if (!value) {
            this.#consoleDataOptions = undefined;
            return;
        }
        this.#consoleDataOptions = {
            include: value,
            pagination: options?.pageSize || options?.pageIdx
                ? {
                    pageSize: options.pageSize,
                    pageIdx: options.pageIdx,
                }
                : undefined,
            types: options?.types,
            includePreservedMessages: options?.includePreservedMessages,
        };
    }
    attachNetworkRequest(reqId, options) {
        this.#attachedNetworkRequestId = reqId;
        this.#attachedNetworkRequestOptions = options;
    }
    attachConsoleMessage(msgid) {
        this.#attachedConsoleMessageId = msgid;
    }
    attachTraceSummary(result) {
        this.#attachedTraceSummary = result;
    }
    attachTraceInsight(trace, insightSetId, insightName) {
        this.#attachedTraceInsight = {
            trace,
            insightSetId,
            insightName,
        };
    }
    attachLighthouseResult(result) {
        this.#attachedLighthouseResult = result;
    }
    get includePages() {
        return this.#includePages;
    }
    get attachedTraceSummary() {
        return this.#attachedTraceSummary;
    }
    get attachedTracedInsight() {
        return this.#attachedTraceInsight;
    }
    get attachedLighthouseResult() {
        return this.#attachedLighthouseResult;
    }
    get includeNetworkRequests() {
        return this.#networkRequestsOptions?.include ?? false;
    }
    get includeConsoleData() {
        return this.#consoleDataOptions?.include ?? false;
    }
    get attachedNetworkRequestId() {
        return this.#attachedNetworkRequestId;
    }
    get networkRequestsPageIdx() {
        return this.#networkRequestsOptions?.pagination?.pageIdx;
    }
    get consoleMessagesPageIdx() {
        return this.#consoleDataOptions?.pagination?.pageIdx;
    }
    get consoleMessagesTypes() {
        return this.#consoleDataOptions?.types;
    }
    appendResponseLine(value) {
        this.#textResponseLines.push(value);
    }
    setHeapSnapshotAggregates(aggregates, options) {
        this.#heapSnapshotOptions = {
            ...this.#heapSnapshotOptions,
            include: true,
            aggregates,
            pagination: options,
        };
    }
    setHeapSnapshotStats(stats, staticData) {
        this.#heapSnapshotOptions = {
            ...this.#heapSnapshotOptions,
            include: true,
            stats,
            staticData,
        };
    }
    attachImage(value) {
        this.#images.push(value);
    }
    get responseLines() {
        return this.#textResponseLines;
    }
    get images() {
        return this.#images;
    }
    get snapshotParams() {
        return this.#snapshotParams;
    }
    get listWebMcpTools() {
        return this.#listWebMcpTools;
    }
    async handle(toolName, context) {
        if (this.#includePages) {
            await context.createPagesSnapshot();
        }
        if (this.#includeExtensionServiceWorkers) {
            await context.createExtensionServiceWorkersSnapshot();
        }
        let snapshot;
        if (this.#snapshotParams) {
            if (!this.#page) {
                throw new Error('Response must have a page');
            }
            this.#page.textSnapshot = await TextSnapshot.create(this.#page, {
                verbose: this.#snapshotParams.verbose,
                devtoolsData: this.#devToolsData,
            });
            const textSnapshot = this.#page.textSnapshot;
            if (textSnapshot) {
                const formatter = new SnapshotFormatter(textSnapshot);
                if (this.#snapshotParams.filePath) {
                    const result = await context.saveFile(new TextEncoder().encode(formatter.toString()), this.#snapshotParams.filePath, '.txt');
                    snapshot = result.filename;
                }
                else {
                    snapshot = formatter;
                }
            }
        }
        let detailedNetworkRequest;
        if (this.#attachedNetworkRequestId) {
            if (!this.#page) {
                throw new Error(`Response must have an McpPage`);
            }
            const request = context.getNetworkRequestById(this.#page, this.#attachedNetworkRequestId);
            const formatter = await NetworkFormatter.from(request, {
                requestId: this.#attachedNetworkRequestId,
                requestIdResolver: req => context.getNetworkRequestStableId(req),
                fetchData: true,
                requestFilePath: this.#attachedNetworkRequestOptions?.requestFilePath,
                responseFilePath: this.#attachedNetworkRequestOptions?.responseFilePath,
                saveFile: (data, filename, extension) => context.saveFile(data, filename, extension),
                redactNetworkHeaders: this.#redactNetworkHeaders,
            });
            detailedNetworkRequest = formatter;
        }
        let detailedConsoleMessage;
        if (this.#attachedConsoleMessageId) {
            if (!this.#page) {
                throw new Error(`Response must have an McpPage`);
            }
            const message = context.getConsoleMessageById(this.#page, this.#attachedConsoleMessageId);
            const consoleMessageStableId = this.#attachedConsoleMessageId;
            if ('args' in message || message instanceof UncaughtError) {
                const consoleMessage = message;
                const devTools = context.getDevToolsUniverse(this.#page);
                detailedConsoleMessage = await ConsoleFormatter.from(consoleMessage, {
                    id: consoleMessageStableId,
                    fetchDetailedData: true,
                    devTools: devTools ?? undefined,
                });
            }
            else if (message instanceof DevTools.AggregatedIssue) {
                const formatter = new IssueFormatter(message, {
                    id: consoleMessageStableId,
                    requestIdResolver: context.resolveCdpRequestId.bind(context, this.#page),
                    elementIdResolver: this.#page.resolveCdpElementId.bind(this.#page),
                });
                if (!formatter.isValid()) {
                    throw new Error("Can't provide details for the msgid " + consoleMessageStableId);
                }
                detailedConsoleMessage = formatter;
            }
        }
        let extensions;
        if (this.#listExtensions) {
            extensions = await context.listExtensions();
        }
        let inPageTools;
        if (this.#listInPageTools) {
            const page = this.#page ?? context.getSelectedMcpPage();
            inPageTools = await getToolGroup(page);
            page.inPageTools = inPageTools;
        }
        let webmcpTools;
        if (this.#listWebMcpTools && this.#args.experimentalWebmcp) {
            const page = this.#page ?? context.getSelectedMcpPage();
            webmcpTools = page.getWebMcpTools();
        }
        let consoleMessages;
        if (this.#consoleDataOptions?.include) {
            if (!this.#page) {
                throw new Error(`Response must have an McpPage`);
            }
            const page = this.#page;
            let messages = context.getConsoleData(this.#page, this.#consoleDataOptions.includePreservedMessages);
            if (this.#consoleDataOptions.types?.length) {
                const normalizedTypes = new Set(this.#consoleDataOptions.types);
                messages = messages.filter(message => {
                    if ('type' in message) {
                        return normalizedTypes.has(message.type());
                    }
                    if (message instanceof DevTools.AggregatedIssue) {
                        return normalizedTypes.has('issue');
                    }
                    return normalizedTypes.has('error');
                });
            }
            consoleMessages = (await Promise.all(messages.map(async (item) => {
                const consoleMessageStableId = context.getConsoleMessageStableId(item);
                if ('args' in item || item instanceof UncaughtError) {
                    const consoleMessage = item;
                    const devTools = context.getDevToolsUniverse(page);
                    return await ConsoleFormatter.from(consoleMessage, {
                        id: consoleMessageStableId,
                        fetchDetailedData: false,
                        devTools: devTools ?? undefined,
                    });
                }
                if (item instanceof DevTools.AggregatedIssue) {
                    const formatter = new IssueFormatter(item, {
                        id: consoleMessageStableId,
                    });
                    if (!formatter.isValid()) {
                        return null;
                    }
                    return formatter;
                }
                return null;
            }))).filter(item => item !== null);
        }
        let networkRequests;
        if (this.#networkRequestsOptions?.include) {
            if (!this.#page) {
                throw new Error(`Response must have an McpPage`);
            }
            let requests = context.getNetworkRequests(this.#page, this.#networkRequestsOptions?.includePreservedRequests);
            // Apply resource type filtering if specified
            if (this.#networkRequestsOptions.resourceTypes?.length) {
                const normalizedTypes = new Set(this.#networkRequestsOptions.resourceTypes);
                requests = requests.filter(request => {
                    const type = request.resourceType();
                    return normalizedTypes.has(type);
                });
            }
            if (requests.length) {
                networkRequests = await Promise.all(requests.map(request => NetworkFormatter.from(request, {
                    requestId: context.getNetworkRequestStableId(request),
                    selectedInDevToolsUI: context.getNetworkRequestStableId(request) ===
                        this.#networkRequestsOptions?.networkRequestIdInDevToolsUI,
                    fetchData: false,
                    saveFile: (data, filename, extension) => context.saveFile(data, filename, extension),
                    redactNetworkHeaders: this.#redactNetworkHeaders,
                })));
            }
        }
        return this.format(toolName, context, {
            detailedConsoleMessage,
            consoleMessages,
            snapshot,
            detailedNetworkRequest,
            networkRequests,
            traceInsight: this.#attachedTraceInsight,
            traceSummary: this.#attachedTraceSummary,
            extensions,
            lighthouseResult: this.#attachedLighthouseResult,
            inPageTools,
            webmcpTools,
        });
    }
    format(toolName, context, data) {
        const structuredContent = {};
        const response = [];
        if (this.#textResponseLines.length) {
            structuredContent.message = this.#textResponseLines.join('\n');
            response.push(...this.#textResponseLines);
        }
        const networkConditions = this.#page?.networkConditions;
        if (networkConditions) {
            const timeout = this.#page.pptrPage.getDefaultNavigationTimeout();
            response.push(`Emulating network conditions: ${networkConditions}`);
            response.push(`Default navigation timeout set to ${timeout} ms`);
            structuredContent.networkConditions = networkConditions;
            structuredContent.navigationTimeout = timeout;
        }
        const viewport = this.#page?.viewport;
        if (viewport) {
            response.push(`Emulating viewport: ${JSON.stringify(viewport)}`);
            structuredContent.viewport = viewport;
        }
        const userAgent = this.#page?.userAgent;
        if (userAgent) {
            response.push(`Emulating user agent: ${userAgent}`);
            structuredContent.userAgent = userAgent;
        }
        const cpuThrottlingRate = this.#page?.cpuThrottlingRate ?? 1;
        if (cpuThrottlingRate > 1) {
            response.push(`Emulating CPU throttling: ${cpuThrottlingRate}x slowdown`);
            structuredContent.cpuThrottlingRate = cpuThrottlingRate;
        }
        const colorScheme = this.#page?.colorScheme;
        if (colorScheme) {
            response.push(`Emulating color scheme: ${colorScheme}`);
            structuredContent.colorScheme = colorScheme;
        }
        const dialog = this.#page?.getDialog();
        if (dialog) {
            const defaultValueIfNeeded = dialog.type() === 'prompt'
                ? ` (default value: "${dialog.defaultValue()}")`
                : '';
            response.push(`# Open dialog
${dialog.type()}: ${dialog.message()}${defaultValueIfNeeded}.
Call ${handleDialog.name} to handle it before continuing.`);
            structuredContent.dialog = {
                type: dialog.type(),
                message: dialog.message(),
                defaultValue: dialog.defaultValue(),
            };
        }
        if (this.#includePages) {
            const allPages = context.getPages();
            const { regularPages, extensionPages } = allPages.reduce((acc, page) => {
                if (page.url().startsWith('chrome-extension://')) {
                    acc.extensionPages.push(page);
                }
                else {
                    acc.regularPages.push(page);
                }
                return acc;
            }, { regularPages: [], extensionPages: [] });
            if (regularPages.length) {
                const parts = [`## Pages`];
                const structuredPages = [];
                for (const page of regularPages) {
                    const isolatedContextName = context.getIsolatedContextName(page);
                    const contextLabel = isolatedContextName
                        ? ` isolatedContext=${isolatedContextName}`
                        : '';
                    parts.push(`${context.getPageId(page)}: ${page.url()}${context.isPageSelected(page) ? ' [selected]' : ''}${contextLabel}`);
                    structuredPages.push(createStructuredPage(page, context));
                }
                response.push(...parts);
                structuredContent.pages = structuredPages;
            }
            if (this.#includeExtensionPages) {
                if (extensionPages.length) {
                    response.push(`## Extension Pages`);
                    const structuredExtensionPages = [];
                    for (const page of extensionPages) {
                        const isolatedContextName = context.getIsolatedContextName(page);
                        const contextLabel = isolatedContextName
                            ? ` isolatedContext=${isolatedContextName}`
                            : '';
                        response.push(`${context.getPageId(page)}: ${page.url()}${context.isPageSelected(page) ? ' [selected]' : ''}${contextLabel}`);
                        structuredExtensionPages.push(createStructuredPage(page, context));
                    }
                    structuredContent.extensionPages = structuredExtensionPages;
                }
            }
        }
        if (this.#includeExtensionServiceWorkers) {
            if (context.getExtensionServiceWorkers().length) {
                response.push(`## Extension Service Workers`);
            }
            for (const extensionServiceWorker of context.getExtensionServiceWorkers()) {
                response.push(`${extensionServiceWorker.id}: ${extensionServiceWorker.url}`);
            }
            structuredContent.extensionServiceWorkers = context
                .getExtensionServiceWorkers()
                .map(extensionServiceWorker => {
                return {
                    id: extensionServiceWorker.id,
                    url: extensionServiceWorker.url,
                };
            });
        }
        if (this.#tabId) {
            structuredContent.tabId = this.#tabId;
        }
        if (data.traceSummary) {
            const summary = getTraceSummary(data.traceSummary);
            response.push(summary);
            structuredContent.traceSummary = summary;
            structuredContent.traceInsights = [];
            for (const insightSet of data.traceSummary.insights?.values() ?? []) {
                for (const [insightName, model] of Object.entries(insightSet.model)) {
                    structuredContent.traceInsights.push({
                        insightName,
                        insightKey: model.insightKey,
                    });
                }
            }
        }
        if (data.traceInsight) {
            const insightOutput = getInsightOutput(data.traceInsight.trace, data.traceInsight.insightSetId, data.traceInsight.insightName);
            if ('error' in insightOutput) {
                response.push(insightOutput.error);
            }
            else {
                response.push(insightOutput.output);
            }
        }
        if (data.lighthouseResult) {
            structuredContent.lighthouseResult = data.lighthouseResult;
            const { summary, reports } = data.lighthouseResult;
            response.push('## Lighthouse Audit Results');
            response.push(`Mode: ${summary.mode}`);
            response.push(`Device: ${summary.device}`);
            response.push(`URL: ${summary.url}`);
            response.push('### Category Scores');
            for (const score of summary.scores) {
                response.push(`- ${score.title}: ${(score.score ?? 0) * 100} (${score.id})`);
            }
            response.push('### Audit Summary');
            response.push(`Passed: ${summary.audits.passed}`);
            response.push(`Failed: ${summary.audits.failed}`);
            response.push(`Total Timing: ${summary.timing.total}ms`);
            response.push('### Reports');
            for (const report of reports) {
                response.push(`- ${report}`);
            }
        }
        if (data.snapshot) {
            if (typeof data.snapshot === 'string') {
                response.push(`Saved snapshot to ${data.snapshot}.`);
                structuredContent.snapshotFilePath = data.snapshot;
            }
            else {
                response.push('## Latest page snapshot');
                response.push(data.snapshot.toString());
                structuredContent.snapshot = data.snapshot.toJSON();
            }
        }
        if (this.#heapSnapshotOptions?.include) {
            response.push('## Heap Snapshot Data');
            const stats = this.#heapSnapshotOptions.stats;
            const staticData = this.#heapSnapshotOptions.staticData;
            if (stats) {
                response.push(`Statistics: ${JSON.stringify(stats, null, 2)}`);
                structuredContent.heapSnapshot = structuredContent.heapSnapshot || {};
                structuredContent.heapSnapshot.stats = stats;
            }
            if (staticData) {
                response.push(`Static Data: ${JSON.stringify(staticData, null, 2)}`);
                structuredContent.heapSnapshot = structuredContent.heapSnapshot || {};
                structuredContent.heapSnapshot.staticData = staticData;
            }
            const aggregates = this.#heapSnapshotOptions.aggregates;
            if (aggregates) {
                const sortedEntries = HeapSnapshotFormatter.sort(aggregates);
                const paginationData = this.#dataWithPagination(sortedEntries, this.#heapSnapshotOptions.pagination);
                structuredContent.pagination = paginationData.pagination;
                response.push(...paginationData.info);
                const paginatedRecord = Object.fromEntries(paginationData.items);
                const formatter = new HeapSnapshotFormatter(paginatedRecord);
                response.push(formatter.toString());
                structuredContent.heapSnapshotData = formatter.toJSON();
            }
        }
        if (data.detailedNetworkRequest) {
            response.push(data.detailedNetworkRequest.toStringDetailed());
            structuredContent.networkRequest =
                data.detailedNetworkRequest.toJSONDetailed();
        }
        if (data.detailedConsoleMessage) {
            response.push(data.detailedConsoleMessage.toStringDetailed());
            structuredContent.consoleMessage =
                data.detailedConsoleMessage.toJSONDetailed();
        }
        if (data.extensions) {
            const extensionArray = Array.from(data.extensions.values());
            structuredContent.extensions = extensionArray;
            response.push('## Extensions');
            if (extensionArray.length === 0) {
                response.push('No extensions installed.');
            }
            else {
                const extensionsMessage = extensionArray
                    .map(extension => {
                    return `id=${extension.id} "${extension.name}" v${extension.version} ${extension.enabled ? 'Enabled' : 'Disabled'}`;
                })
                    .join('\n');
                response.push(extensionsMessage);
            }
        }
        if (this.#listInPageTools) {
            structuredContent.inPageTools = data.inPageTools ?? undefined;
            response.push('## In-page tools');
            if (!data.inPageTools || !data.inPageTools.tools) {
                response.push('No in-page tools available.');
            }
            else {
                const toolGroup = data.inPageTools;
                response.push(`${toolGroup.name}: ${toolGroup.description}`);
                response.push('Available tools:');
                const toolDefinitionsMessage = toolGroup.tools
                    .map(tool => {
                    return `name="${tool.name}", description="${tool.description}", inputSchema=${JSON.stringify(tool.inputSchema)}`;
                })
                    .join('\n');
                response.push(toolDefinitionsMessage);
            }
        }
        if (this.#listWebMcpTools && data.webmcpTools) {
            structuredContent.webmcpTools = data.webmcpTools.map(({ name, description, inputSchema, annotations }) => ({
                name,
                description,
                inputSchema,
                annotations,
            }));
            response.push('## WebMCP tools');
            if (data.webmcpTools.length === 0) {
                response.push('No WebMCP tools available.');
            }
            else {
                const webmcpToolsMessage = data.webmcpTools
                    .map(tool => {
                    return `name="${tool.name}", description="${tool.description}", inputSchema=${JSON.stringify(tool.inputSchema)}, annotations=${JSON.stringify(tool.annotations)}`;
                })
                    .join('\n');
                response.push(webmcpToolsMessage);
            }
        }
        if (this.#networkRequestsOptions?.include && data.networkRequests) {
            const requests = data.networkRequests;
            response.push('## Network requests');
            if (requests.length) {
                const paginationData = this.#dataWithPagination(requests, this.#networkRequestsOptions.pagination);
                structuredContent.pagination = paginationData.pagination;
                response.push(...paginationData.info);
                if (data.networkRequests) {
                    structuredContent.networkRequests = [];
                    for (const formatter of paginationData.items) {
                        response.push(formatter.toString());
                        structuredContent.networkRequests.push(formatter.toJSON());
                    }
                }
            }
            else {
                response.push('No requests found.');
            }
        }
        if (this.#consoleDataOptions?.include) {
            const messages = data.consoleMessages ?? [];
            response.push('## Console messages');
            if (messages.length) {
                const paginationData = this.#dataWithPagination(messages, this.#consoleDataOptions.pagination);
                structuredContent.pagination = paginationData.pagination;
                response.push(...paginationData.info);
                response.push(...paginationData.items.map(message => message.toString()));
                structuredContent.consoleMessages = paginationData.items.map(message => message.toJSON());
            }
            else {
                response.push('<no console messages found>');
            }
        }
        const text = {
            type: 'text',
            text: response.join('\n'),
        };
        const images = this.#images.map(imageData => {
            return {
                type: 'image',
                ...imageData,
            };
        });
        return {
            content: [text, ...images],
            structuredContent,
        };
    }
    #dataWithPagination(data, pagination) {
        const response = [];
        const paginationResult = paginate(data, pagination);
        if (paginationResult.invalidPage) {
            response.push('Invalid page number provided. Showing first page.');
        }
        const { startIndex, endIndex, currentPage, totalPages } = paginationResult;
        response.push(`Showing ${startIndex + 1}-${endIndex} of ${data.length} (Page ${currentPage + 1} of ${totalPages}).`);
        if (pagination) {
            if (paginationResult.hasNextPage) {
                response.push(`Next page: ${currentPage + 1}`);
            }
            if (paginationResult.hasPreviousPage) {
                response.push(`Previous page: ${currentPage - 1}`);
            }
        }
        return {
            info: response,
            items: paginationResult.items,
            pagination: {
                currentPage: paginationResult.currentPage,
                totalPages: paginationResult.totalPages,
                hasNextPage: paginationResult.hasNextPage,
                hasPreviousPage: paginationResult.hasPreviousPage,
                startIndex: paginationResult.startIndex,
                endIndex: paginationResult.endIndex,
                invalidPage: paginationResult.invalidPage,
            },
        };
    }
    resetResponseLineForTesting() {
        this.#textResponseLines = [];
    }
}
function createStructuredPage(page, context) {
    const isolatedContextName = context.getIsolatedContextName(page);
    const entry = {
        id: context.getPageId(page),
        url: page.url(),
        selected: context.isPageSelected(page),
    };
    if (isolatedContextName) {
        entry.isolatedContext = isolatedContextName;
    }
    return entry;
}
