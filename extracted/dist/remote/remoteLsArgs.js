"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRemoteLsArgs = buildRemoteLsArgs;
/**
 * The SSH host's LS argv: baseLsArgs plus --persistent_mode, so the LS (and
 * its agents) outlives a dropped connection and the next one re-attaches, and
 * --enable_sidecars, which run on the host (their UIs reach SSH windows
 * through the host's plugin:// handler, remoteSidecars.ts).
 * No --exit_on_stdin_close (it would stop every agent on disconnect), and no
 * host bridge flags (the laptop can't be reached from the host).
 *
 * TODO(nathanjuan): The LS starts every enabled sidecar at once and keeps it
 * running: in persistent mode, start them for the first UI subscriber and
 * stop them when idle, and don't run another LS's on the same host twice.
 */
const lsDefaults_1 = require("../lsDefaults");
const types_1 = require("./types");
function buildRemoteLsArgs(opts) {
    return [
        ...(0, lsDefaults_1.baseLsArgs)({
            ideVersion: opts.version,
            httpsServerPort: 0,
            csrfToken: opts.csrfToken,
            appDataDir: opts.appDataDir,
        }),
        '--enable_sidecars',
        '--persistent_mode',
        '--workspace_id',
        types_1.REMOTE_LS_WORKSPACE_ID,
    ];
}
