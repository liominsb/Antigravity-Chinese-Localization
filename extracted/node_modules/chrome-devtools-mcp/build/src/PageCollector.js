/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { FakeIssuesManager } from './DevtoolsUtils.js';
import { logger } from './logger.js';
import { DevTools } from './third_party/index.js';
import { createIdGenerator, stableIdSymbol, } from './utils/id.js';
export class UncaughtError {
    details;
    targetId;
    constructor(details, targetId) {
        this.details = details;
        this.targetId = targetId;
    }
}
export class PageCollector {
    #browser;
    #listenersInitializer;
    #listeners = new WeakMap();
    maxNavigationSaved = 3;
    /**
     * This maps a Page to a list of navigations with a sub-list
     * of all collected resources.
     * The newer navigations come first.
     */
    storage = new WeakMap();
    constructor(browser, listeners) {
        this.#browser = browser;
        this.#listenersInitializer = listeners;
    }
    async init(pages) {
        for (const page of pages) {
            this.addPage(page);
        }
        this.#browser.on('targetcreated', this.#onTargetCreated);
        this.#browser.on('targetdestroyed', this.#onTargetDestroyed);
    }
    dispose() {
        this.#browser.off('targetcreated', this.#onTargetCreated);
        this.#browser.off('targetdestroyed', this.#onTargetDestroyed);
    }
    #onTargetCreated = async (target) => {
        try {
            const page = await target.page();
            if (!page) {
                return;
            }
            this.addPage(page);
        }
        catch (err) {
            logger('Error getting a page for a target onTargetCreated', err);
        }
    };
    #onTargetDestroyed = async (target) => {
        try {
            const page = await target.page();
            if (!page) {
                return;
            }
            this.cleanupPageDestroyed(page);
        }
        catch (err) {
            logger('Error getting a page for a target onTargetDestroyed', err);
        }
    };
    addPage(page) {
        this.#initializePage(page);
    }
    #initializePage(page) {
        if (this.storage.has(page)) {
            return;
        }
        const idGenerator = createIdGenerator();
        const storedLists = [[]];
        this.storage.set(page, storedLists);
        const listeners = this.#listenersInitializer(value => {
            const withId = value;
            withId[stableIdSymbol] = idGenerator();
            const navigations = this.storage.get(page) ?? [[]];
            navigations[0].push(withId);
        });
        listeners['framenavigated'] = (frame) => {
            // Only split the storage on main frame navigation
            if (frame !== page.mainFrame()) {
                return;
            }
            this.splitAfterNavigation(page);
        };
        for (const [name, listener] of Object.entries(listeners)) {
            page.on(name, listener);
        }
        this.#listeners.set(page, listeners);
    }
    splitAfterNavigation(page) {
        const navigations = this.storage.get(page);
        if (!navigations) {
            return;
        }
        // Add the latest navigation first
        navigations.unshift([]);
        navigations.splice(this.maxNavigationSaved);
    }
    cleanupPageDestroyed(page) {
        const listeners = this.#listeners.get(page);
        if (listeners) {
            for (const [name, listener] of Object.entries(listeners)) {
                page.off(name, listener);
            }
        }
        this.storage.delete(page);
    }
    getData(page, includePreservedData) {
        const navigations = this.storage.get(page);
        if (!navigations) {
            return [];
        }
        if (!includePreservedData) {
            return navigations[0];
        }
        const data = [];
        for (let index = this.maxNavigationSaved; index >= 0; index--) {
            if (navigations[index]) {
                data.push(...navigations[index]);
            }
        }
        return data;
    }
    getIdForResource(resource) {
        return resource[stableIdSymbol] ?? -1;
    }
    getById(page, stableId) {
        const navigations = this.storage.get(page);
        if (!navigations) {
            throw new Error('No requests found for selected page');
        }
        const item = this.find(page, item => item[stableIdSymbol] === stableId);
        if (item) {
            return item;
        }
        throw new Error('Request not found for selected page');
    }
    find(page, filter) {
        const navigations = this.storage.get(page);
        if (!navigations) {
            return;
        }
        for (const navigation of navigations) {
            const item = navigation.find(filter);
            if (item) {
                return item;
            }
        }
        return;
    }
}
export class ConsoleCollector extends PageCollector {
    #subscribedPages = new WeakMap();
    addPage(page) {
        super.addPage(page);
        if (!this.#subscribedPages.has(page)) {
            const subscriber = new PageEventSubscriber(page);
            this.#subscribedPages.set(page, subscriber);
            void subscriber.subscribe();
        }
    }
    cleanupPageDestroyed(page) {
        super.cleanupPageDestroyed(page);
        this.#subscribedPages.get(page)?.unsubscribe();
        this.#subscribedPages.delete(page);
    }
}
class PageEventSubscriber {
    #issueManager = new FakeIssuesManager();
    #issueAggregator = new DevTools.IssueAggregator(this.#issueManager);
    #seenKeys = new Set();
    #seenIssues = new Set();
    #page;
    #session;
    #targetId;
    constructor(page) {
        this.#page = page;
        // @ts-expect-error use existing CDP client (internal Puppeteer API).
        this.#session = this.#page._client();
        // @ts-expect-error use internal Puppeteer API to get target ID
        this.#targetId = this.#session.target()._targetId;
    }
    #resetIssueAggregator() {
        this.#issueManager = new FakeIssuesManager();
        if (this.#issueAggregator) {
            this.#issueAggregator.removeEventListener("AggregatedIssueUpdated" /* DevTools.IssueAggregatorEvents.AGGREGATED_ISSUE_UPDATED */, this.#onAggregatedIssue);
        }
        this.#issueAggregator = new DevTools.IssueAggregator(this.#issueManager);
        this.#issueAggregator.addEventListener("AggregatedIssueUpdated" /* DevTools.IssueAggregatorEvents.AGGREGATED_ISSUE_UPDATED */, this.#onAggregatedIssue);
    }
    async subscribe() {
        this.#resetIssueAggregator();
        this.#page.on('framenavigated', this.#onFrameNavigated);
        this.#page.on('issue', this.#onIssueAdded);
        this.#session.on('Runtime.exceptionThrown', this.#onExceptionThrown);
    }
    unsubscribe() {
        this.#seenKeys.clear();
        this.#seenIssues.clear();
        this.#page.off('framenavigated', this.#onFrameNavigated);
        this.#page.off('issue', this.#onIssueAdded);
        this.#session.off('Runtime.exceptionThrown', this.#onExceptionThrown);
        if (this.#issueAggregator) {
            this.#issueAggregator.removeEventListener("AggregatedIssueUpdated" /* DevTools.IssueAggregatorEvents.AGGREGATED_ISSUE_UPDATED */, this.#onAggregatedIssue);
        }
    }
    #onAggregatedIssue = (event) => {
        if (this.#seenIssues.has(event.data)) {
            return;
        }
        this.#seenIssues.add(event.data);
        this.#page.emit('devtoolsAggregatedIssue', event.data);
    };
    #onExceptionThrown = (event) => {
        this.#page.emit('uncaughtError', new UncaughtError(event.exceptionDetails, this.#targetId));
    };
    // On navigation, we reset issue aggregation.
    #onFrameNavigated = (frame) => {
        // Only split the storage on main frame navigation
        if (frame !== frame.page().mainFrame()) {
            return;
        }
        this.#seenKeys.clear();
        this.#seenIssues.clear();
        this.#resetIssueAggregator();
    };
    #onIssueAdded = (inspectorIssue) => {
        try {
            // DevTools currently defines this protocol issue code but has no
            // IssuesManager handler for it, so calling into the mapper only warns.
            if (String(inspectorIssue.code) === 'PerformanceIssue') {
                return;
            }
            const issue = DevTools.createIssuesFromProtocolIssue(null, 
            // @ts-expect-error Protocol types diverge.
            inspectorIssue)[0];
            if (!issue) {
                logger('No issue mapping for for the issue: ', inspectorIssue.code);
                return;
            }
            const primaryKey = issue.primaryKey();
            if (this.#seenKeys.has(primaryKey)) {
                return;
            }
            this.#seenKeys.add(primaryKey);
            this.#issueManager.dispatchEventToListeners("IssueAdded" /* DevTools.IssuesManagerEvents.ISSUE_ADDED */, {
                issue,
                // @ts-expect-error We don't care that issues model is null
                issuesModel: null,
            });
        }
        catch (error) {
            logger('Error creating a new issue', error);
        }
    };
}
export class NetworkCollector extends PageCollector {
    constructor(browser, listeners = collect => {
        return {
            request: req => {
                collect(req);
            },
        };
    }) {
        super(browser, listeners);
    }
    splitAfterNavigation(page) {
        const navigations = this.storage.get(page) ?? [];
        if (!navigations) {
            return;
        }
        const requests = navigations[0];
        const lastRequestIdx = requests.findLastIndex(request => {
            return request.frame() === page.mainFrame()
                ? request.isNavigationRequest()
                : false;
        });
        // Keep all requests since the last navigation request including that
        // navigation request itself.
        // Keep the reference
        if (lastRequestIdx !== -1) {
            const fromCurrentNavigation = requests.splice(lastRequestIdx);
            navigations.unshift(fromCurrentNavigation);
        }
        else {
            navigations.unshift([]);
        }
        navigations.splice(this.maxNavigationSaved);
    }
}
