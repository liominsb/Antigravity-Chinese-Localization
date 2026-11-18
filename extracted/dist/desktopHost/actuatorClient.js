"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNodeActuatorClient = createNodeActuatorClient;
/**
 * A Node-only Layer 1 ActuatorClient dialing the local language server (the
 * transport of actuator contract §4.1), shared by the Hub's main-process
 * client (src/actuator/mainClient.ts) and the headless desktop host.
 */
const actuator_1 = require("../vendor/actuator");
const nodeTransport_1 = require("../actuator/nodeTransport");
function createNodeActuatorClient(o) {
    const tag = `[ActuatorClient:${o.clientName}]`;
    const logger = {
        debug: () => { },
        info: (m, ...a) => console.log(`${tag} ${m}`, ...a),
        warn: (m, ...a) => console.warn(`${tag} ${m}`, ...a),
        error: (m, ...a) => console.error(`${tag} ${m}`, ...a),
    };
    const transports = (0, nodeTransport_1.nodeTransportFactory)({
        getPort: () => {
            const c = o.connection();
            if (!c) {
                throw new Error('language server is not running');
            }
            return c.port;
        },
        getCsrfToken: () => o.connection()?.csrf ?? '',
        log: (m) => console.warn(m),
    });
    const client = new actuator_1.ActuatorClient({
        clientName: o.clientName,
        clientVersion: o.clientVersion,
        logger,
        transportFactory: transports,
    });
    return { client, transports };
}
