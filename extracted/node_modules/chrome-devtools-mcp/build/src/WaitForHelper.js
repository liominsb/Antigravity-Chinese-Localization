/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger } from './logger.js';
export class WaitForHelper {
    #abortController = new AbortController();
    #page;
    #stableDomTimeout;
    #stableDomFor;
    #expectNavigationIn;
    #navigationTimeout;
    constructor(page, cpuTimeoutMultiplier, networkTimeoutMultiplier) {
        this.#stableDomTimeout = 3000 * cpuTimeoutMultiplier;
        this.#stableDomFor = 100 * cpuTimeoutMultiplier;
        this.#expectNavigationIn = 100 * cpuTimeoutMultiplier;
        this.#navigationTimeout = 3000 * networkTimeoutMultiplier;
        this.#page = page;
    }
    /**
     * A wrapper that executes a action and waits for
     * a potential navigation, after which it waits
     * for the DOM to be stable before returning.
     */
    async waitForStableDom() {
        const stableDomObserver = await this.#page.evaluateHandle(timeout => {
            let timeoutId;
            function callback() {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    domObserver.resolver.resolve();
                    domObserver.observer.disconnect();
                }, timeout);
            }
            const domObserver = {
                resolver: Promise.withResolvers(),
                observer: new MutationObserver(callback),
            };
            // It's possible that the DOM is not gonna change so we
            // need to start the timeout initially.
            callback();
            domObserver.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
            });
            return domObserver;
        }, this.#stableDomFor);
        this.#abortController.signal.addEventListener('abort', async () => {
            try {
                await stableDomObserver.evaluate(observer => {
                    observer.observer.disconnect();
                    observer.resolver.resolve();
                });
                await stableDomObserver.dispose();
            }
            catch {
                // Ignored cleanup errors
            }
        });
        return Promise.race([
            stableDomObserver.evaluate(async (observer) => {
                return await observer.resolver.promise;
            }),
            this.timeout(this.#stableDomTimeout).then(() => {
                throw new Error('Timeout');
            }),
        ]);
    }
    async waitForNavigationStarted() {
        // Currently Puppeteer does not have API
        // For when a navigation is about to start
        const navigationStartedPromise = new Promise(resolve => {
            const listener = (event) => {
                if ([
                    'historySameDocument',
                    'historyDifferentDocument',
                    'sameDocument',
                ].includes(event.navigationType)) {
                    resolve(false);
                    return;
                }
                resolve(true);
            };
            this.#page._client().on('Page.frameStartedNavigating', listener);
            this.#abortController.signal.addEventListener('abort', () => {
                resolve(false);
                this.#page._client().off('Page.frameStartedNavigating', listener);
            });
        });
        return await Promise.race([
            navigationStartedPromise,
            this.timeout(this.#expectNavigationIn).then(() => false),
        ]);
    }
    timeout(time) {
        return new Promise(res => {
            const id = setTimeout(res, time);
            this.#abortController.signal.addEventListener('abort', () => {
                res();
                clearTimeout(id);
            });
        });
    }
    async waitForEventsAfterAction(action, options) {
        if (options?.handleDialog) {
            const dialogHandler = (dialog) => {
                if (options.handleDialog === 'dismiss') {
                    void dialog.dismiss();
                }
                else if (options.handleDialog === 'accept') {
                    void dialog.accept();
                }
                else {
                    void dialog.accept(options.handleDialog);
                }
            };
            this.#page.on('dialog', dialogHandler);
            this.#abortController.signal.addEventListener('abort', () => {
                this.#page.off('dialog', dialogHandler);
            });
        }
        const navigationFinished = this.waitForNavigationStarted()
            .then(navigationStated => {
            if (navigationStated) {
                return this.#page.waitForNavigation({
                    timeout: options?.timeout ?? this.#navigationTimeout,
                    signal: this.#abortController.signal,
                });
            }
            return;
        })
            .catch(error => logger(error));
        try {
            await action();
        }
        catch (error) {
            // Clear up pending promises
            this.#abortController.abort();
            throw error;
        }
        try {
            await navigationFinished;
            // Wait for stable dom after navigation so we execute in
            // the correct context
            await this.waitForStableDom();
        }
        catch (error) {
            logger(error);
        }
        finally {
            this.#abortController.abort();
        }
    }
}
export function getNetworkMultiplierFromString(condition) {
    const puppeteerCondition = condition;
    switch (puppeteerCondition) {
        case 'Fast 4G':
            return 1;
        case 'Slow 4G':
            return 2.5;
        case 'Fast 3G':
            return 5;
        case 'Slow 3G':
            return 10;
    }
    return 1;
}
