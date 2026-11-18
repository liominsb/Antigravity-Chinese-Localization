"use strict";
/**
 * @fileoverview The computer action layer (Layer 2): register a computer
 * surface as the `computer` actuator. See registerComputerActuator.ts.
 * Hosts get registerComputerActuator and plain types only; the handler class
 * (its mutable state, execute()) stays inside the package.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptRunner = exports.registerComputerActuator = exports.agentColorIndex = exports.HANDLER_CONFINEMENT_VERSION = exports.FOREGROUND_CONFINEMENT_VERSION = exports.COMPUTER_ACTUATOR_TYPE_VERSION = exports.COMPUTER_ACTUATOR_TYPE = exports.BACKGROUND_CONFINEMENT_VERSION = exports.AGENT_COLOR_COUNT = void 0;
var computerOps_1 = require("./computerOps");
Object.defineProperty(exports, "AGENT_COLOR_COUNT", { enumerable: true, get: function () { return computerOps_1.AGENT_COLOR_COUNT; } });
Object.defineProperty(exports, "BACKGROUND_CONFINEMENT_VERSION", { enumerable: true, get: function () { return computerOps_1.BACKGROUND_CONFINEMENT_VERSION; } });
Object.defineProperty(exports, "COMPUTER_ACTUATOR_TYPE", { enumerable: true, get: function () { return computerOps_1.COMPUTER_ACTUATOR_TYPE; } });
Object.defineProperty(exports, "COMPUTER_ACTUATOR_TYPE_VERSION", { enumerable: true, get: function () { return computerOps_1.COMPUTER_ACTUATOR_TYPE_VERSION; } });
Object.defineProperty(exports, "FOREGROUND_CONFINEMENT_VERSION", { enumerable: true, get: function () { return computerOps_1.FOREGROUND_CONFINEMENT_VERSION; } });
Object.defineProperty(exports, "HANDLER_CONFINEMENT_VERSION", { enumerable: true, get: function () { return computerOps_1.HANDLER_CONFINEMENT_VERSION; } });
Object.defineProperty(exports, "agentColorIndex", { enumerable: true, get: function () { return computerOps_1.agentColorIndex; } });
var registerComputerActuator_1 = require("./registerComputerActuator");
Object.defineProperty(exports, "registerComputerActuator", { enumerable: true, get: function () { return registerComputerActuator_1.registerComputerActuator; } });
var scriptRunner_1 = require("./scriptRunner");
Object.defineProperty(exports, "ScriptRunner", { enumerable: true, get: function () { return scriptRunner_1.ScriptRunner; } });
