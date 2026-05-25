/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PuppeteerDevToolsConnection } from './DevToolsConnectionAdapter.js';
import { Mutex } from './Mutex.js';
import { DevTools } from './third_party/index.js';
/**
 * A mock implementation of an issues manager that only implements the methods
 * that are actually used by the IssuesAggregator
 */
export class FakeIssuesManager extends DevTools.Common.ObjectWrapper
    .ObjectWrapper {
    issues() {
        return [];
    }
}
// DevTools CDP errors can get noisy.
DevTools.ProtocolClient.InspectorBackend.test.suppressRequestErrors = true;
DevTools.I18n.DevToolsLocale.DevToolsLocale.instance({
    create: true,
    data: {
        navigatorLanguage: 'en-US',
        settingLanguage: 'en-US',
        lookupClosestDevToolsLocale: l => l,
    },
});
DevTools.I18n.i18n.registerLocaleDataForTest('en-US', {});
DevTools.Formatter.FormatterWorkerPool.FormatterWorkerPool.instance({
    forceNew: true,
    entrypointURL: import.meta
        .resolve('./third_party/devtools-formatter-worker.js'),
});
export class UniverseManager {
    #browser;
    #createUniverseFor;
    #universes = new WeakMap();
    /** Guard access to #universes so we don't create unnecessary universes */
    #mutex = new Mutex();
    constructor(browser, factory = DEFAULT_FACTORY) {
        this.#browser = browser;
        this.#createUniverseFor = factory;
    }
    async init(pages) {
        try {
            await this.#mutex.acquire();
            const promises = [];
            for (const page of pages) {
                promises.push(this.#createUniverseFor(page).then(targetUniverse => this.#universes.set(page, targetUniverse)));
            }
            this.#browser.on('targetcreated', this.#onTargetCreated);
            this.#browser.on('targetdestroyed', this.#onTargetDestroyed);
            await Promise.all(promises);
        }
        finally {
            this.#mutex.release();
        }
    }
    get(page) {
        return this.#universes.get(page) ?? null;
    }
    dispose() {
        this.#browser.off('targetcreated', this.#onTargetCreated);
        this.#browser.off('targetdestroyed', this.#onTargetDestroyed);
    }
    #onTargetCreated = async (target) => {
        const page = await target.page();
        try {
            await this.#mutex.acquire();
            if (!page || this.#universes.has(page)) {
                return;
            }
            this.#universes.set(page, await this.#createUniverseFor(page));
        }
        finally {
            this.#mutex.release();
        }
    };
    #onTargetDestroyed = async (target) => {
        const page = await target.page();
        try {
            await this.#mutex.acquire();
            if (!page || !this.#universes.has(page)) {
                return;
            }
            this.#universes.delete(page);
        }
        finally {
            this.#mutex.release();
        }
    };
}
const DEFAULT_FACTORY = async (page) => {
    const settingStorage = new DevTools.Common.Settings.SettingsStorage({});
    const universe = new DevTools.Foundation.Universe.Universe({
        settingsCreationOptions: {
            syncedStorage: settingStorage,
            globalStorage: settingStorage,
            localStorage: settingStorage,
            settingRegistrations: DevTools.Common.SettingRegistration.getRegisteredSettings(),
        },
        overrideAutoStartModels: new Set([DevTools.DebuggerModel]),
    });
    const session = await page.createCDPSession();
    const connection = new PuppeteerDevToolsConnection(session);
    const targetManager = universe.context.get(DevTools.TargetManager);
    targetManager.observeModels(DevTools.DebuggerModel, SKIP_ALL_PAUSES);
    const target = targetManager.createTarget('main', '', 'frame', // eslint-disable-line @typescript-eslint/no-explicit-any
    /* parentTarget */ null, session.id(), undefined, connection);
    return { target, universe };
};
// We don't want to pause any DevTools universe session ever on the MCP side.
//
// Note that calling `setSkipAllPauses` only affects the session on which it was
// sent. This means DevTools can still pause, step and do whatever. We just won't
// see the `Debugger.paused`/`Debugger.resumed` events on the MCP side.
const SKIP_ALL_PAUSES = {
    modelAdded(model) {
        void model.agent.invoke_setSkipAllPauses({ skip: true });
    },
    modelRemoved() {
        // Do nothing.
    },
};
/**
 * Constructed from Runtime.ExceptionDetails of an uncaught error.
 *
 * TODO: Also construct from a RemoteObject of subtype 'error'.
 *
 * Consists of the message, a fully resolved stack trace and a fully resolved 'cause' chain.
 */
export class SymbolizedError {
    message;
    stackTrace;
    cause;
    constructor(message, stackTrace, cause) {
        this.message = message;
        this.stackTrace = stackTrace;
        this.cause = cause;
    }
    static async fromDetails(opts) {
        const message = SymbolizedError.#getMessage(opts.details);
        if (!opts.includeStackAndCause || !opts.devTools) {
            return new SymbolizedError(message, opts.resolvedStackTraceForTesting, opts.resolvedCauseForTesting);
        }
        let stackTrace;
        if (opts.resolvedStackTraceForTesting) {
            stackTrace = opts.resolvedStackTraceForTesting;
        }
        else if (opts.details.stackTrace) {
            try {
                stackTrace = await createStackTrace(opts.devTools, opts.details.stackTrace, opts.targetId);
            }
            catch {
                // ignore
            }
        }
        // TODO: Turn opts.details.exception into a JSHandle and retrieve the 'cause' property.
        //       If its an Error, recursively create a SymbolizedError.
        let cause;
        if (opts.resolvedCauseForTesting) {
            cause = opts.resolvedCauseForTesting;
        }
        else if (opts.details.exception) {
            try {
                const causeRemoteObj = await SymbolizedError.#lookupCause(opts.devTools, opts.details.exception, opts.targetId);
                if (causeRemoteObj) {
                    cause = await SymbolizedError.fromError({
                        devTools: opts.devTools,
                        error: causeRemoteObj,
                        targetId: opts.targetId,
                    });
                }
            }
            catch {
                // Ignore
            }
        }
        return new SymbolizedError(message, stackTrace, cause);
    }
    static async fromError(opts) {
        const details = await SymbolizedError.#getExceptionDetails(opts.devTools, opts.error, opts.targetId);
        if (details) {
            return SymbolizedError.fromDetails({
                details,
                devTools: opts.devTools,
                targetId: opts.targetId,
                includeStackAndCause: true,
            });
        }
        return new SymbolizedError(SymbolizedError.#getMessageFromException(opts.error));
    }
    static #getMessage(details) {
        // For Runtime.exceptionThrown with a present exception object, `details.text` will be "Uncaught" and
        // we have to manually parse out the error text from the exception description.
        // In the case of Runtime.getExceptionDetails, `details.text` has the Error.message.
        if (details.text === 'Uncaught' && details.exception) {
            return ('Uncaught ' +
                SymbolizedError.#getMessageFromException(details.exception));
        }
        return details.text;
    }
    static #getMessageFromException(error) {
        const messageWithRest = error.description?.split('\n    at ', 2) ?? [];
        return messageWithRest[0] ?? '';
    }
    static async #getExceptionDetails(devTools, error, targetId) {
        if (!devTools || (error.type !== 'object' && error.subtype !== 'error')) {
            return null;
        }
        const targetManager = devTools.universe.context.get(DevTools.TargetManager);
        const target = targetId
            ? targetManager.targetById(targetId) || devTools.target
            : devTools.target;
        const model = target.model(DevTools.RuntimeModel);
        return ((await model.getExceptionDetails(error.objectId)) ?? null);
    }
    static async #lookupCause(devTools, error, targetId) {
        if (!devTools || (error.type !== 'object' && error.subtype !== 'error')) {
            return null;
        }
        const targetManager = devTools.universe.context.get(DevTools.TargetManager);
        const target = targetId
            ? targetManager.targetById(targetId) || devTools.target
            : devTools.target;
        const properties = await target.runtimeAgent().invoke_getProperties({
            objectId: error.objectId,
        });
        if (properties.getError()) {
            return null;
        }
        return properties.result.find(prop => prop.name === 'cause')?.value ?? null;
    }
    static createForTesting(message, stackTrace, cause) {
        return new SymbolizedError(message, stackTrace, cause);
    }
}
export async function createStackTraceForConsoleMessage(devTools, consoleMessage) {
    const message = consoleMessage;
    const rawStackTrace = message._rawStackTrace();
    if (rawStackTrace) {
        return createStackTrace(devTools, rawStackTrace, message._targetId());
    }
    return undefined;
}
export async function createStackTrace(devTools, rawStackTrace, targetId) {
    const targetManager = devTools.universe.context.get(DevTools.TargetManager);
    const target = targetId
        ? targetManager.targetById(targetId) || devTools.target
        : devTools.target;
    const model = target.model(DevTools.DebuggerModel);
    // DevTools doesn't wait for source maps to attach before building a stack trace, rather it'll send
    // an update event once a source map was attached and the stack trace retranslated. This doesn't
    // work in the MCP case, so we'll collect all script IDs upfront and wait for any pending source map
    // loads before creating the stack trace. We might also have to wait for Debugger.ScriptParsed events if
    // the stack trace is created particularly early.
    const scriptIds = new Set();
    for (const frame of rawStackTrace.callFrames) {
        scriptIds.add(frame.scriptId);
    }
    for (let asyncStack = rawStackTrace.parent; asyncStack; asyncStack = asyncStack.parent) {
        for (const frame of asyncStack.callFrames) {
            scriptIds.add(frame.scriptId);
        }
    }
    const signal = AbortSignal.timeout(1_000);
    await Promise.all([...scriptIds].map(id => waitForScript(model, id, signal)
        .then(script => model.sourceMapManager().sourceMapForClientPromise(script))
        .catch()));
    const binding = devTools.universe.context.get(DevTools.DebuggerWorkspaceBinding);
    // DevTools uses branded types for ScriptId and others. Casting the puppeteer protocol type to the DevTools protocol type is safe.
    return binding.createStackTraceFromProtocolRuntime(rawStackTrace, target);
}
// Waits indefinitely for the script so pair it with Promise.race.
async function waitForScript(model, scriptId, signal) {
    while (true) {
        if (signal.aborted) {
            throw signal.reason;
        }
        const script = model.scriptForId(scriptId);
        if (script) {
            return script;
        }
        await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
                once: true,
            });
            void model
                .once('ParsedScriptSource')
                .then(resolve);
        });
    }
}
