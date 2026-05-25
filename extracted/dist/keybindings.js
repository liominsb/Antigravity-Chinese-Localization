"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKeybindings = registerKeybindings;
const utils_1 = require("./utils");
function registerKeybindings(win, actions) {
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown') {
            const isCmdOrCtrl = (0, utils_1.isMacOS)() ? input.meta : input.control;
            if (isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'n') {
                actions.createNewWindow();
                event.preventDefault();
            }
            if (isCmdOrCtrl && input.key.toLowerCase() === 'q') {
                actions.onQuitRequested();
                event.preventDefault();
            }
        }
    });
}
