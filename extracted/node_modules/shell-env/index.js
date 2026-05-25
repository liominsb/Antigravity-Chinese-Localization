import process from 'node:process';
import execa from 'execa';
import stripAnsi from 'strip-ansi';
import defaultShell from 'default-shell';

const args = [
	'-ilc',
	// Use the command builtin to avoid shell aliases or functions named `env`.
	'echo -n "_SHELL_ENV_DELIMITER_"; command env; echo -n "_SHELL_ENV_DELIMITER_"; exit',
];

const env = {
	// Disables Oh My Zsh auto-update thing that can block the process.
	DISABLE_AUTO_UPDATE: 'true',
	// Prevents the oh-my-zsh tmux plugin from auto-starting.
	ZSH_TMUX_AUTOSTARTED: 'true',
	ZSH_TMUX_AUTOSTART: 'false',
};

const parseEnv = env => {
	env = env.split('_SHELL_ENV_DELIMITER_')[1];
	const returnValue = {};

	for (const line of stripAnsi(env).split('\n').filter(Boolean)) {
		const [key, ...values] = line.split('=');
		returnValue[key] = values.join('=');
	}

	return returnValue;
};

// Fallback POSIX shells to try when the default shell fails (e.g., non-POSIX shells like Nushell).
// Exclude the default shell since it already failed.
const fallbackShells = ['/bin/zsh', '/bin/bash'].filter(shell => shell !== defaultShell);

async function tryFallbackShells() {
	for (const shell of fallbackShells) {
		try {
			const {stdout} = await execa(shell, args, {env});
			return parseEnv(stdout);
		} catch {
			// Ignore.
		}
	}

	return process.env;
}

function tryFallbackShellsSync() {
	for (const shell of fallbackShells) {
		try {
			const {stdout} = execa.sync(shell, args, {env});
			return parseEnv(stdout);
		} catch {
			// Ignore.
		}
	}

	return process.env;
}

export async function shellEnv(shell) {
	if (process.platform === 'win32') {
		return process.env;
	}

	try {
		const {stdout} = await execa(shell || defaultShell, args, {env});
		return parseEnv(stdout);
	} catch (error) {
		if (shell) {
			throw error;
		}

		return tryFallbackShells();
	}
}

export function shellEnvSync(shell) {
	if (process.platform === 'win32') {
		return process.env;
	}

	try {
		const {stdout} = execa.sync(shell || defaultShell, args, {env});
		return parseEnv(stdout);
	} catch (error) {
		if (shell) {
			throw error;
		}

		return tryFallbackShellsSync();
	}
}
