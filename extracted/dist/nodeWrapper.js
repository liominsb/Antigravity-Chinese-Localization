"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.electronNodeBinary = electronNodeBinary;
exports.shellQuote = shellQuote;
exports.nodeWrapperScript = nodeWrapperScript;
/** Running Node scripts with the app's own binary (ELECTRON_RUN_AS_NODE=1). */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let nodeBinary;
/**
 * The binary to run Node scripts with: on macOS the Helper app's
 * (LSUIElement=true), so no Dock icon bounces.
 */
function electronNodeBinary() {
    nodeBinary ?? (nodeBinary = findNodeBinary());
    return nodeBinary;
}
function findNodeBinary() {
    if (process.platform !== 'darwin') {
        return process.execPath;
    }
    const appName = path.basename(process.execPath);
    const helperPath = path.join(path.dirname(process.execPath), '..', 'Frameworks', `${appName} Helper.app`, 'Contents', 'MacOS', `${appName} Helper`);
    return fs.existsSync(helperPath) ? helperPath : process.execPath;
}
/** A single-quoted sh word. */
function shellQuote(word) {
    return `'${word.replace(/'/g, "'\\''")}'`;
}
/** An sh script that runs `binary` as Node, with `args` before its own. */
function nodeWrapperScript(binary, ...args) {
    const words = [binary, ...args].map(shellQuote).join(' ');
    return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${words} "$@"\n`;
}
