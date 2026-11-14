"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionInputs = void 0;
/**
 * What each SSH connection needs from this computer, each looked up once: the
 * login shell's environment and the server to install.
 */
const electron_1 = require("electron");
const loginShellEnvReads_1 = require("../loginShellEnvReads");
const wsl_1 = require("../wsl");
const serverArtifacts_1 = require("./serverArtifacts");
const RELEASE_LOOKUP_TIMEOUT_MS = 10000;
class ConnectionInputs {
    constructor(app) {
        this.app = app;
        this.loginEnv = new loginShellEnvReads_1.LoginShellEnvReads(true);
    }
    /** ssh needs the login shell's PATH and SSH_AUTH_SOCK, even from the Dock. */
    loginShellEnv() {
        return this.loginEnv.take();
    }
    /** An attach installs nothing: it needs no release lookup. */
    async serverFor(attachOnly) {
        if (attachOnly) {
            return {
                artifacts: (0, serverArtifacts_1.serverArtifactsWithoutLookup)({
                    appVersion: this.app.appVersion,
                    env: process.env,
                }),
            };
        }
        return this.resolveArtifacts();
    }
    /**
     * Kept once found. A failed lookup isn't fatal (a running server is
     * attached), and the next connect looks again.
     */
    resolveArtifacts() {
        if (this.artifacts) {
            return this.artifacts;
        }
        const pending = (0, serverArtifacts_1.resolveRemoteServerArtifacts)({
            appVersion: this.app.appVersion,
            isInsiders: this.app.isInsiders,
            env: process.env,
            // Electron's fetch: it honors the system proxy.
            resolveStableDir: (version) => (0, wsl_1.resolveStableArtifactDir)(version, (url) => electron_1.net.fetch(url, {
                signal: AbortSignal.timeout(RELEASE_LOOKUP_TIMEOUT_MS),
            })),
        });
        this.artifacts = pending;
        const forget = () => {
            if (this.artifacts === pending) {
                this.artifacts = undefined;
            }
        };
        void pending.then((r) => {
            if (r.resolutionError) {
                forget();
            }
        }, forget);
        return pending;
    }
}
exports.ConnectionInputs = ConnectionInputs;
