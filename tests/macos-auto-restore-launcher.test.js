'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Windows 不执行 macOS shell 入口；恢复核心仍由跨平台测试覆盖。
const launcherTest = (name, fn) => test(name, { skip: process.platform === 'win32' }, fn);

function runLauncher(t, { result = 0, input = 'y\n\n', versionResult = 0 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-macos-launcher-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'release with spaces');
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(project); fs.mkdirSync(bin);
  const launcher = path.join(project, '一键更新汉化.command');
  fs.copyFileSync(path.join(__dirname, '..', '一键更新汉化.command'), launcher);
  const calls = path.join(directory, 'calls');
  // Substitute only child commands: never run the real client or installer.
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/bash\nif [ "$1" = "-e" ]; then exit "$VERSION_RESULT"; fi\nprintf "node:%s:%s\\n" "$1" "$2" >> "$CALLS"\nexit "$RESTORE_RESULT"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'open'), '#!/bin/bash\nprintf "open:%s:%s\\n" "$1" "$2" >> "$CALLS"\n', { mode: 0o755 });
  const child = spawnSync('bash', [launcher], { cwd: directory, input, encoding: 'utf8',
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, CALLS: calls,
      RESTORE_RESULT: String(result), VERSION_RESULT: String(versionResult) } });
  return { ...child, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '', project };
}

launcherTest('从其他目录启动时使用同目录恢复脚本，成功才打开应用', t => {
  const result = runLauncher(t);
  assert.equal(result.status, 0);
  assert.equal(result.calls, `node:${path.join(result.project, 'localize.js')}:--auto-restore\nopen:-a:/Applications/Antigravity.app\n`);
});

launcherTest('用户取消时不执行恢复或打开应用', t => {
  const result = runLauncher(t, { input: 'n\n' });
  assert.equal(result.status, 0); assert.equal(result.calls, '');
});

for (const code of [1, 2]) {
  launcherTest(`恢复退出码 ${code} 被保留且不启动应用`, t => {
    const result = runLauncher(t, { result: code });
    assert.equal(result.status, code); assert.doesNotMatch(result.calls, /open:/);
  });
}

launcherTest('不支持的 Node.js 版本不执行安装', t => {
  const result = runLauncher(t, { versionResult: 1, input: '\n' });
  assert.equal(result.status, 1); assert.equal(result.calls, '');
});
