"use strict";
/**
 * What the Hub's two readers of a login shell's environment share: this
 * computer's (loginShellEnv.ts) and an SSH host's (bootstrapScript.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGIN_SHELLS_READING_STDIN = exports.LOGIN_SHELL_ENV_WAIT_SEC = exports.LOGIN_SHELL_DROPPED_VARS = exports.LOGIN_SHELL_INJECTED_ENV = void 0;
/**
 * Set for the login shell, and never taken from it. rc files can skip slow or
 * interactive work under ANTIGRAVITY_RESOLVING_ENVIRONMENT, as for the
 * language server's own reader (VS Code's VSCODE_RESOLVING_ENVIRONMENT);
 * oh-my-zsh neither updates itself nor starts tmux.
 */
exports.LOGIN_SHELL_INJECTED_ENV = {
    ANTIGRAVITY_RESOLVING_ENVIRONMENT: '1',
    DISABLE_AUTO_UPDATE: 'true',
    ZSH_TMUX_AUTOSTARTED: 'true',
    ZSH_TMUX_AUTOSTART: 'false',
};
/**
 * Never taken from the login shell: its own state, and SSH_CLIENT, with which
 * `bash -c` reads ~/.bashrc again.
 */
exports.LOGIN_SHELL_DROPPED_VARS = [
    'PWD',
    'OLDPWD',
    'SHLVL',
    '_',
    'PS1',
    'PS2',
    'PROMPT_COMMAND',
    'TERM',
    'COLUMNS',
    'LINES',
    'SSH_CLIENT',
];
/** How long a caller waits for the login shell's environment. */
exports.LOGIN_SHELL_ENV_WAIT_SEC = 10;
/**
 * Shells whose -l works only alone, and with -c makes no login shell: they
 * get -l and read the command on stdin. The others get -i -l -c.
 */
exports.LOGIN_SHELLS_READING_STDIN = ['csh', 'tcsh'];
