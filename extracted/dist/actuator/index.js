"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeTransportFactory = exports.CSRF_HEADER = exports.stopMainActuatorClient = exports.startMainActuatorClient = exports.mainActuatorClientPortChanged = exports.getMainActuatorClient = void 0;
/**
 * Hub main-process actuator plumbing (actuator contract §4.1): the
 * ActuatorService transport and the `hub-main` ActuatorClient.
 */
var mainClient_1 = require("./mainClient");
Object.defineProperty(exports, "getMainActuatorClient", { enumerable: true, get: function () { return mainClient_1.getMainActuatorClient; } });
Object.defineProperty(exports, "mainActuatorClientPortChanged", { enumerable: true, get: function () { return mainClient_1.mainActuatorClientPortChanged; } });
Object.defineProperty(exports, "startMainActuatorClient", { enumerable: true, get: function () { return mainClient_1.startMainActuatorClient; } });
Object.defineProperty(exports, "stopMainActuatorClient", { enumerable: true, get: function () { return mainClient_1.stopMainActuatorClient; } });
var nodeTransport_1 = require("./nodeTransport");
Object.defineProperty(exports, "CSRF_HEADER", { enumerable: true, get: function () { return nodeTransport_1.CSRF_HEADER; } });
Object.defineProperty(exports, "nodeTransportFactory", { enumerable: true, get: function () { return nodeTransport_1.nodeTransportFactory; } });
