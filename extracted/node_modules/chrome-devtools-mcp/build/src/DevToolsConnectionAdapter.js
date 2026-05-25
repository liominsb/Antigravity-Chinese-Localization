/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CDPSessionEvent } from './third_party/index.js';
/**
 * This class makes a puppeteer connection look like DevTools CDPConnection.
 *
 * Since we connect "root" DevTools targets to specific pages, we scope everything to a puppeteer CDP session.
 *
 * We don't have to recursively listen for 'sessionattached' as the "root" CDP session sees all child session attached
 * events, regardless how deeply nested they are.
 */
export class PuppeteerDevToolsConnection {
    #connection;
    #observers = new Set();
    #sessionEventHandlers = new Map();
    constructor(session) {
        this.#connection = session.connection();
        session.on(CDPSessionEvent.SessionAttached, this.#startForwardingCdpEvents.bind(this));
        session.on(CDPSessionEvent.SessionDetached, this.#stopForwardingCdpEvents.bind(this));
        this.#startForwardingCdpEvents(session);
    }
    send(method, params, sessionId) {
        if (sessionId === undefined) {
            throw new Error('Attempting to send on the root session. This must not happen');
        }
        const session = this.#connection.session(sessionId);
        if (!session) {
            throw new Error('Unknown session ' + sessionId);
        }
        // Rolled protocol version between puppeteer and DevTools doesn't necessarily match
        /* eslint-disable @typescript-eslint/no-explicit-any */
        return session
            .send(method, params)
            .then(result => ({ result }))
            .catch(error => ({ error }));
        /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    observe(observer) {
        this.#observers.add(observer);
    }
    unobserve(observer) {
        this.#observers.delete(observer);
    }
    #startForwardingCdpEvents(session) {
        const handler = this.#handleEvent.bind(this, session.id());
        this.#sessionEventHandlers.set(session.id(), handler);
        session.on('*', handler);
    }
    #stopForwardingCdpEvents(session) {
        const handler = this.#sessionEventHandlers.get(session.id());
        if (handler) {
            session.off('*', handler);
        }
    }
    #handleEvent(sessionId, type, event) {
        if (typeof type === 'string' &&
            type !== CDPSessionEvent.SessionAttached &&
            type !== CDPSessionEvent.SessionDetached) {
            this.#observers.forEach(observer => observer.onEvent({
                method: type,
                sessionId,
                params: event,
            }));
        }
    }
}
