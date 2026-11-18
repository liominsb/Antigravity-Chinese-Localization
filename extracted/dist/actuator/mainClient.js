"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMainActuatorClient = getMainActuatorClient;
exports.startMainActuatorClient = startMainActuatorClient;
exports.mainActuatorClientPortChanged = mainActuatorClientPortChanged;
exports.stopMainActuatorClient = stopMainActuatorClient;
exports.resetMainActuatorClientForTest = resetMainActuatorClientForTest;
/**
 * The Hub main process's ActuatorClient (actuator contract §4.1, D2).
 *
 * Main-process actuator types (e.g. computer use) only call
 * `getMainActuatorClient().register(handler)`. main.ts drives the lifecycle:
 * `startMainActuatorClient` once the LS port and CSRF token are known,
 * `mainActuatorClientPortChanged` on every LS port change, and
 * `stopMainActuatorClient` on LS shutdown / app quit (GOING_AWAY per type).
 */
const electron_1 = require("electron");
const actuatorClient_1 = require("../desktopHost/actuatorClient");
let client;
let transports;
let connection;
let started = false;
/**
 * The lazy, process-wide main-process client (`clientName: 'hub-main'`).
 * Kinds may register before the LS is up; nothing dials until
 * {@link startMainActuatorClient}.
 */
function getMainActuatorClient() {
    if (!client) {
        const c = (0, actuatorClient_1.createNodeActuatorClient)({
            clientName: 'hub-main',
            clientVersion: electron_1.app.getVersion(),
            connection: () => connection,
        });
        client = c.client;
        transports = c.transports;
    }
    return client;
}
/** Starts dialing the LS. Safe to call again (e.g. after an LS restart). */
function startMainActuatorClient(port, csrf) {
    connection = { port, csrf };
    const c = getMainActuatorClient();
    if (!started) {
        started = true;
        c.start();
    }
    else {
        c.onPortChanged();
    }
}
/** Tears down every stream and resubscribes against the new port. */
function mainActuatorClientPortChanged(port) {
    if (!connection) {
        return;
    }
    connection = { ...connection, port };
    if (started) {
        getMainActuatorClient().onPortChanged();
    }
}
/** Sends GOING_AWAY for every actuator type and stops. Never throws. */
async function stopMainActuatorClient() {
    if (!client || !started) {
        return;
    }
    started = false;
    try {
        await client.stop();
    }
    catch (err) {
        console.error('[ActuatorClient:hub-main] stop failed:', err);
    }
    finally {
        // GOING_AWAY has been sent; release the HTTP/2 session and its pings.
        transports?.close();
    }
}
/** Test hook. */
function resetMainActuatorClientForTest() {
    client = undefined;
    transports = undefined;
    connection = undefined;
    started = false;
}
