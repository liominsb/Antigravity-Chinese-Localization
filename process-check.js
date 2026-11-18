'use strict';

const { execFileSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 5000;

function isAppRunningStrict({ platform = process.platform, run = execFileSync } = {}) {
  if (platform === 'win32') {
    const output = run('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: DEFAULT_TIMEOUT_MS
    });
    const names = String(output).split(/\r?\n/).map(line => {
      const match = /^"([^"]+)"/.exec(line.trim());
      return match && match[1].toLowerCase();
    }).filter(Boolean);
    if (!names.length) throw new Error('无法解析 Windows 进程列表');
    return names.some(name => ['antigravity.exe', 'language_server.exe'].includes(name));
  }
  try {
    run('pgrep', ['-xi', 'antigravity|language_server'], {
      stdio: 'ignore',
      timeout: DEFAULT_TIMEOUT_MS
    });
    return true;
  } catch (error) {
    // pgrep uses exit 1 for no matches; execution and permission failures
    // must propagate so the installer cannot mistake them for an idle app.
    if (error && error.status === 1) return false;
    throw error;
  }
}

function stopAntigravityProcesses({ platform = process.platform, run = execFileSync } = {}) {
  if (platform === 'win32') {
    let firstError = null;
    for (const imageName of ['Antigravity.exe', 'language_server.exe']) {
      try {
        run('taskkill.exe', ['/F', '/IM', imageName], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: DEFAULT_TIMEOUT_MS
        });
      } catch (error) {
        // taskkill exit status 128 means the process image was not found (already stopped).
        if (error && error.status === 128) continue;
        if (!firstError) firstError = error;
      }
    }
    if (firstError) throw firstError;
    return;
  }

  try {
    run('pkill', ['-xi', 'antigravity|language_server'], {
      stdio: 'ignore',
      timeout: DEFAULT_TIMEOUT_MS
    });
    return;
  } catch (error) {
    // pkill exit status 1 means no matching processes were running.
    if (error && error.status === 1) return;
    if (error && (error.code === 'ENOENT' || error.code === 'ETIMEDOUT')) throw error;
  }

  // Fallback for Linux pkill variants without -i (case-insensitive) support [M-01].
  let fallbackError = null;
  for (const name of ['antigravity', 'Antigravity', 'language_server']) {
    try {
      run('pkill', ['-x', name], {
        stdio: 'ignore',
        timeout: DEFAULT_TIMEOUT_MS
      });
    } catch (error) {
      if (error && error.status === 1) continue;
      if (!fallbackError) fallbackError = error;
    }
  }
  if (fallbackError) throw fallbackError;
}

module.exports = { isAppRunningStrict, stopAntigravityProcesses };
