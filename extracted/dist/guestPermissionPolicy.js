"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_DENIED_PERMISSIONS = void 0;
exports.shouldDenyGuestPermission = shouldDenyGuestPermission;
exports.configureSessionAgentPermissionPolicy = configureSessionAgentPermissionPolicy;
const guestAgentControl_1 = require("./guestAgentControl");
/**
 * Permissions denied to built-in browser guests while they are under active
 * agent control. Fullscreen lets a page cover the Hub chrome (tab strip, URL
 * bar, agent overlay) so the model and the user lose the trusted UI; see
 * go/browser-use-agent-security.
 */
exports.AGENT_DENIED_PERMISSIONS = new Set([
    'fullscreen',
    'automatic-fullscreen',
]);
const configuredPermissionSessions = new WeakSet();
/**
 * Returns `true` when `permission` must be denied for `webContents` because the
 * guest is currently agent-controlled and the permission is in
 * {@link AGENT_DENIED_PERMISSIONS}.
 */
function shouldDenyGuestPermission(webContents, permission) {
    if (!exports.AGENT_DENIED_PERMISSIONS.has(permission)) {
        return false;
    }
    const id = webContents?.id;
    return typeof id === 'number' && (0, guestAgentControl_1.isGuestAgentControlled)(id);
}
/**
 * Installs (once per session) a permission request handler on a built-in
 * browser guest session that denies {@link AGENT_DENIED_PERMISSIONS} for
 * agent-controlled guests and grants every other request, matching Electron's
 * default behavior when no handler is installed. The decision is resolved per
 * requesting `WebContents` because user and agent tabs share a partition.
 *
 * No permission check handler is installed on purpose: Electron only consults
 * the request handler for fullscreen, and installing a check handler changes
 * defaults for unrelated permissions (e.g. File System Access grants).
 */
function configureSessionAgentPermissionPolicy(targetSession) {
    if (!targetSession ||
        typeof targetSession.setPermissionRequestHandler !== 'function' ||
        configuredPermissionSessions.has(targetSession)) {
        return;
    }
    configuredPermissionSessions.add(targetSession);
    targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(!shouldDenyGuestPermission(webContents, permission));
    });
}
