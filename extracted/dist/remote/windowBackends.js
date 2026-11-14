"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRemoteWindow = registerRemoteWindow;
exports.remoteBackendOf = remoteBackendOf;
exports.remoteBackendOfWindow = remoteBackendOfWindow;
exports.windowsForHost = windowsForHost;
exports.isLocalAppWindow = isLocalAppWindow;
// Which windows show a remote (SSH) backend. Imports only Electron, so that
// utils, main and later modules can use it without import cycles.
const electron_1 = require("electron");
const byWebContentsId = new Map();
/** Marks `win` remote until it closes or its webContents is destroyed. */
function registerRemoteWindow(win, info) {
    const id = win.webContents.id;
    byWebContentsId.set(id, info);
    const forget = () => byWebContentsId.delete(id);
    win.once('closed', forget);
    win.webContents.once?.('destroyed', forget);
}
/** Remote backend of an IPC sender, or undefined for local windows. */
function remoteBackendOf(contents) {
    // No isDestroyed() check: the entry goes on 'destroyed', and callers that
    // must fail closed for a destroyed sender handle that.
    if (!contents || typeof contents.id !== 'number') {
        return undefined;
    }
    return byWebContentsId.get(contents.id);
}
function remoteBackendOfWindow(win) {
    // A closing window's webContents can be destroyed first; reading it throws.
    if (win.isDestroyed?.() || win.webContents?.isDestroyed?.()) {
        return undefined;
    }
    return remoteBackendOf(win.webContents);
}
function windowsForHost(hostId) {
    return electron_1.BrowserWindow.getAllWindows().filter((w) => remoteBackendOfWindow(w)?.hostId === hostId);
}
/** Whether Hub window `win` is on the local backend (not an SSH window). */
function isLocalAppWindow(win) {
    if (win.isDestroyed?.() || win.webContents?.isDestroyed?.()) {
        return false;
    }
    // Local app windows use the default session; SSH windows have their own.
    const ses = win.webContents?.session;
    if (ses && electron_1.session?.defaultSession && ses !== electron_1.session.defaultSession) {
        return false;
    }
    // BaseWindows have no webContents, and only local windows are BaseWindows.
    const id = win.webContents?.id;
    return id === undefined || !byWebContentsId.has(id);
}
