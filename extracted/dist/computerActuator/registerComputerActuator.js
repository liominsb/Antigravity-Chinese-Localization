"use strict";
/**
 * @fileoverview The computer action layer's (Layer 2) entry point for a
 * surface: registers it as the `computer` actuator on an ActuatorClient
 * (Layer 1) and serves each request through its Layer 3 driver. The host sees
 * only plain types: no computerpb or actuator_pb.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerComputerActuator = registerComputerActuator;
const actuator_pb_1 = require("../proto/actuator_pb"); // from //third_party/jetski/actuator_pb:actuator_ts_proto
const computerActuatorHandler_1 = require("./computerActuatorHandler");
/**
 * Registers the surface as the `computer` actuator on `o.client`. The Hello
 * advertises the surface's main display, permissions and min(surface, layer)
 * app-confinement level; real user input the surface reports pauses the
 * actuator (USER_TAKEOVER) until {@link ComputerActuatorRegistration.resume}.
 */
function registerComputerActuator(o) {
    const handler = new computerActuatorHandler_1.ComputerActuatorHandler({
        driver: o.driver,
        initialPaused: o.initialPaused,
        onPausedChanged: o.onPausedChanged,
        onState: o.onState,
        onStreamLost: o.onStreamLost,
        onAgentActivity: o.onAgentActivity,
        initialHealth: o.initialHealth,
        maxConfinementVersion: o.maxConfinementVersion,
        script: o.script,
        scriptTimeoutMs: o.scriptTimeoutMs,
        log: o.log,
    });
    handler.register(o.client);
    const intervalMs = o.refreshIntervalMs ?? 5000;
    let timer = intervalMs > 0
        ? setInterval(() => void handler.refreshHello(), intervalMs)
        : undefined;
    return {
        actuatorId: handler.actuatorId,
        stop: (detail = 'user Stop') => handler.userStop(actuator_pb_1.ActuatorStatus.USER_STOP, detail),
        resume: () => handler.userResume(),
        stopAgent: (actorId) => {
            handler.stopAgent(actorId);
        },
        pauseAgent: (actorId) => {
            handler.pauseAgent(actorId);
        },
        resumeAgent: (actorId) => handler.resumeAgent(actorId),
        reportHealth: (health) => handler.reportHealth(health),
        refreshHello: () => handler.refreshHello(),
        setEnabled: (on) => handler.setEnabled(on),
        state: () => handler.state(),
        dispose: async () => {
            if (timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
            }
            await handler.dispose();
        },
    };
}
