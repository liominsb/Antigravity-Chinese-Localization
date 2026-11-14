"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REMOTE_IPC_CHANNELS = void 0;
/**
 * The IPC invoke channels SSH windows may use: the ones the bridges of their
 * preload invoke (nativeNotifications, nativeStorage, agent, extensions,
 * sshRemote and part of electronNative). Content in SSH windows is served by the remote host, so
 * the main process refuses it every other channel registered by
 * registerIpcHandlers.
 *
 * A sandboxed preload can't import this module: the preload repeats them.
 */
exports.REMOTE_IPC_CHANNELS = new Set([
    // nativeNotifications
    'notification:send',
    // A fixed OS settings page, no arguments from the page: not rate-limited.
    'notification:open-system-preferences',
    // nativeStorage
    'storage:get-items',
    'storage:update-items',
    // agent (ignored)
    'agent:update-active-count',
    // electronNative, on the sender's own window, and web links
    'window:set-title-bar-overlay',
    'window:minimize',
    'window:maximize',
    'window:unmaximize',
    'window:is-maximized',
    'window:close',
    'window:toggle-devtools',
    'window:show-context-menu',
    'window:close-context-menu',
    'window:zoom-in',
    'window:zoom-out',
    'window:reset-zoom',
    'shell:open-external',
    // extensions: refreshes the host's own plugin:// map (remoteSidecars.ts)
    'extensions:send-authorities',
    // window.sshRemote (sshBridge.ts checks these senders itself)
    'ssh:get-state',
    'ssh:open-local-window',
    'ssh:stop-server',
    'ssh:take-intent',
]);
