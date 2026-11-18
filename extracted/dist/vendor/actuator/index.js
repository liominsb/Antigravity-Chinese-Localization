"use strict";
/**
 * @fileoverview Public surface of the platform-free ActuatorClient SDK.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fulfillLimitViolation = exports.RESULT_EXCEEDS_LIMITS = exports.ENVELOPE_LIMITS = exports.ActuatorLimitError = exports.isTerminalFulfillError = exports.decideReconnect = exports.connectErrorReason = exports.backoffDelayMs = exports.DEFAULT_UNIMPLEMENTED_RETRY_MS = exports.DEFAULT_TYPE_UNAVAILABLE_RETRY_MS = exports.DEFAULT_BACKOFF = exports.Backoff = exports.ActuatorErrorReason = exports.ActuatorClient = exports.ACTUATOR_PROTOCOL_VERSION = void 0;
var actuatorClient_1 = require("./actuatorClient");
Object.defineProperty(exports, "ACTUATOR_PROTOCOL_VERSION", { enumerable: true, get: function () { return actuatorClient_1.ACTUATOR_PROTOCOL_VERSION; } });
Object.defineProperty(exports, "ActuatorClient", { enumerable: true, get: function () { return actuatorClient_1.ActuatorClient; } });
var backoff_1 = require("./backoff");
Object.defineProperty(exports, "ActuatorErrorReason", { enumerable: true, get: function () { return backoff_1.ActuatorErrorReason; } });
Object.defineProperty(exports, "Backoff", { enumerable: true, get: function () { return backoff_1.Backoff; } });
Object.defineProperty(exports, "DEFAULT_BACKOFF", { enumerable: true, get: function () { return backoff_1.DEFAULT_BACKOFF; } });
Object.defineProperty(exports, "DEFAULT_TYPE_UNAVAILABLE_RETRY_MS", { enumerable: true, get: function () { return backoff_1.DEFAULT_TYPE_UNAVAILABLE_RETRY_MS; } });
Object.defineProperty(exports, "DEFAULT_UNIMPLEMENTED_RETRY_MS", { enumerable: true, get: function () { return backoff_1.DEFAULT_UNIMPLEMENTED_RETRY_MS; } });
Object.defineProperty(exports, "backoffDelayMs", { enumerable: true, get: function () { return backoff_1.backoffDelayMs; } });
Object.defineProperty(exports, "connectErrorReason", { enumerable: true, get: function () { return backoff_1.connectErrorReason; } });
Object.defineProperty(exports, "decideReconnect", { enumerable: true, get: function () { return backoff_1.decideReconnect; } });
Object.defineProperty(exports, "isTerminalFulfillError", { enumerable: true, get: function () { return backoff_1.isTerminalFulfillError; } });
var limits_1 = require("./limits");
Object.defineProperty(exports, "ActuatorLimitError", { enumerable: true, get: function () { return limits_1.ActuatorLimitError; } });
Object.defineProperty(exports, "ENVELOPE_LIMITS", { enumerable: true, get: function () { return limits_1.ENVELOPE_LIMITS; } });
Object.defineProperty(exports, "RESULT_EXCEEDS_LIMITS", { enumerable: true, get: function () { return limits_1.RESULT_EXCEEDS_LIMITS; } });
Object.defineProperty(exports, "fulfillLimitViolation", { enumerable: true, get: function () { return limits_1.fulfillLimitViolation; } });
