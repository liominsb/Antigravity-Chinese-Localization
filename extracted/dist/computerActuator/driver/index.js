"use strict";
/**
 * @fileoverview The computer surface driver (Layer 3). See computerDriver.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComputerDriverError = exports.supportsMultiAgent = exports.supportsBackground = void 0;
var backgroundDriver_1 = require("./backgroundDriver");
Object.defineProperty(exports, "supportsBackground", { enumerable: true, get: function () { return backgroundDriver_1.supportsBackground; } });
Object.defineProperty(exports, "supportsMultiAgent", { enumerable: true, get: function () { return backgroundDriver_1.supportsMultiAgent; } });
var errors_1 = require("./errors");
Object.defineProperty(exports, "ComputerDriverError", { enumerable: true, get: function () { return errors_1.ComputerDriverError; } });
