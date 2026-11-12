'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const {
  isLocalizedAsar,
  hashFile,
  findAvailablePatch,
  checkClientStatus,
  executeAutoRestore
} = require('../auto-restore');

function archive(tree, data = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(tree), 'utf8');
  const headerSize = 8 + Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(headerSize - 4, 0);
  header.writeInt32LE(json.length, 4);
  json.copy(header, 8);
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  return Buffer.concat([prefix, header, data]);
}

function packedOfficial(version = '2.23.1') {
  const metadata = Buffer.from(JSON.stringify({ name: 'antigravity-client', version }));
  const preceding = Buffer.from('official_binary_data');
  const entry = { size: metadata.length, offset: String(preceding.length) };
  return archive(
    { files: { 'official.bin': { offset: '0', size: preceding.length }, 'package.json': entry } },
    Buffer.concat([preceding, metadata])
  );
}

function packedLocalized(version = '2.23.1') {
  const metadata = Buffer.from(JSON.stringify({
    name: 'antigravity-client',
    version,
    description: '// Antigravity 2.0 Chinese Localization Engine'
  }));
  const preceding = Buffer.from('localized_binary_data');
  const entry = { size: metadata.length, offset: String(preceding.length) };
  return archive(
    { files: { 'localized.bin': { offset: '0', size: preceding.length }, 'package.json': entry } },
    Buffer.concat([preceding, metadata])
  );
}

async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-auto-restore-test-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^antigravity-auto-restore-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('isLocalizedAsar 准确区分官方原版与已汉化包', async t => {
  const dir = await workspace(t);
  const officialFile = path.join(dir, 'official.asar');
  const localizedFile = path.join(dir, 'localized.asar');

  await fs.writeFile(officialFile, packedOfficial('2.23.1'));
  await fs.writeFile(localizedFile, packedLocalized('2.23.1'));

  assert.equal(isLocalizedAsar(officialFile), false, '官方原版不应被识别为已汉化');
  assert.equal(isLocalizedAsar(localizedFile), true, '包含汉化特征的包应被准确识别');
  assert.equal(isLocalizedAsar(path.join(dir, 'non-existent.asar')), false, '不存在的文件返回 false');
});

test('checkClientStatus 准确探测官方更新覆盖（未汉化）与已汉化状态', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resDir = path.join(appDir, 'resources');
  await fs.mkdir(resDir, { recursive: true });
  const asarPath = path.join(resDir, 'app.asar');

  // 1. 未安装
  const notInstalled = await checkClientStatus({ appDir });
  assert.equal(notInstalled.isInstalled, false);

  // 2. 官方原版（更新覆盖后）
  await fs.writeFile(asarPath, packedOfficial('2.23.1'));
  const officialStatus = await checkClientStatus({ appDir });
  assert.equal(officialStatus.isInstalled, true);
  assert.equal(officialStatus.isLocalized, false);
  assert.equal(officialStatus.isUpdateOverwritten, true);
  assert.equal(officialStatus.appVersion, '2.23.1');

  // 3. 已汉化状态
  await fs.writeFile(asarPath, packedLocalized('2.23.1'));
  const localizedStatus = await checkClientStatus({ appDir });
  assert.equal(localizedStatus.isInstalled, true);
  assert.equal(localizedStatus.isLocalized, true);
  assert.equal(localizedStatus.isUpdateOverwritten, false);
});

test('findAvailablePatch 优先从 ready 文件及缓存中查找匹配补丁', async t => {
  const dir = await workspace(t);
  const readyPath = path.join(dir, 'app.asar.ready');
  await fs.writeFile(readyPath, packedLocalized('2.23.1'));

  // 匹配相同版本
  const match = await findAvailablePatch({ workspaceDir: dir, targetVersion: '2.23.1' });
  assert.ok(match);
  assert.equal(match.version, '2.23.1');
  assert.equal(match.isMatch, true);
  assert.equal(match.path, readyPath);

  // 版本不匹配时标记 isMatch: false
  const mismatch = await findAvailablePatch({ workspaceDir: dir, targetVersion: '2.24.0' });
  assert.ok(mismatch);
  assert.equal(mismatch.isMatch, false);
});

test('executeAutoRestore 当客户端已汉化时直接跳过无需重复安装', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resDir = path.join(appDir, 'resources');
  await fs.mkdir(resDir, { recursive: true });
  const asarPath = path.join(resDir, 'app.asar');

  const localizedBytes = packedLocalized('2.23.1');
  await fs.writeFile(asarPath, localizedBytes);

  const result = await executeAutoRestore({
    appDir,
    workspaceDir: dir
  });

  assert.equal(result.success, true);
  assert.equal(result.code, 'ALREADY_LOCALIZED');
  // 确认内容未被改动
  const currentBytes = await fs.readFile(asarPath);
  assert.deepEqual(currentBytes, localizedBytes);
});

test('executeAutoRestore 官方更新覆盖后自动完成安全备份与原子汉化恢复', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resDir = path.join(appDir, 'resources');
  await fs.mkdir(resDir, { recursive: true });
  const asarPath = path.join(resDir, 'app.asar');
  const backupPath = path.join(resDir, 'app.asar.bak');

  // 准备官方原版 asar（模拟官方自动更新覆盖）
  const officialBytes = packedOfficial('2.23.1');
  await fs.writeFile(asarPath, officialBytes);

  // 准备本地匹配补丁包
  const readyPath = path.join(dir, 'app.asar.ready');
  const patchBytes = packedLocalized('2.23.1');
  await fs.writeFile(readyPath, patchBytes);

  let stoppedCalled = false;
  const result = await executeAutoRestore({
    appDir,
    workspaceDir: dir,
    isAppRunning: async () => false,
    stopProcesses: async () => { stoppedCalled = true; }
  });

  assert.equal(result.success, true);
  assert.equal(result.code, 'RESTORED');
  assert.equal(result.appVersion, '2.23.1');
  assert.equal(result.patchVersion, '2.23.1');

  // 验证原版已安全备份且内容一致
  assert.ok(await fs.stat(backupPath));
  assert.deepEqual(await fs.readFile(backupPath), officialBytes);

  // 验证目标 asar 已原子更新为汉化版
  const currentBytes = await fs.readFile(asarPath);
  assert.deepEqual(currentBytes, patchBytes);
  assert.equal(isLocalizedAsar(asarPath), true);
});

test('executeAutoRestore 遭遇官方大版本更新时拦截不兼容覆盖保护客户端', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resDir = path.join(appDir, 'resources');
  await fs.mkdir(resDir, { recursive: true });
  const asarPath = path.join(resDir, 'app.asar');

  // 官方客户端已升级到 2.24.0
  const officialNewBytes = packedOfficial('2.24.0');
  await fs.writeFile(asarPath, officialNewBytes);

  // 本地补丁依然是老版本 2.23.1
  const readyPath = path.join(dir, 'app.asar.ready');
  await fs.writeFile(readyPath, packedLocalized('2.23.1'));

  const result = await executeAutoRestore({
    appDir,
    workspaceDir: dir
  });

  // 必须安全拦截！
  assert.equal(result.success, false);
  assert.equal(result.code, 'VERSION_MISMATCH');
  assert.equal(result.appVersion, '2.24.0');
  assert.equal(result.patchVersion, '2.23.1');
  assert.match(result.message, /安全拦截/);

  // 确认原文件毫发无损
  assert.deepEqual(await fs.readFile(asarPath), officialNewBytes);
});

test('index.html 包含 update-banner 与 triggerAutoRestore 完整前端支持', async () => {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const content = await fs.readFile(indexPath, 'utf8');

  assert.ok(content.includes('id="update-banner"'), 'index.html 必须包含 update-banner 容器');
  assert.ok(content.includes('id="btn-auto-restore"'), 'index.html 必须包含 btn-auto-restore 操作按钮');
  assert.ok(content.includes('triggerAutoRestore'), 'index.html 必须实现 triggerAutoRestore 函数');
  assert.ok(content.includes('/api/auto-restore'), 'index.html 必须请求 /api/auto-restore 端点');
  assert.ok(content.includes('isUpdateOverwritten'), 'index.html 必须处理 isUpdateOverwritten 状态');
});

test('一键更新汉化.bat 与 双击运行汉化.bat 接入自动恢复逻辑并保留兜底', async () => {
  const updateBatPath = path.join(__dirname, '..', '一键更新汉化.bat');
  const launcherBatPath = path.join(__dirname, '..', '双击运行汉化.bat');

  const updateBat = await fs.readFile(updateBatPath, 'utf8');
  assert.ok(updateBat.includes('--auto-restore'), '一键更新批处理必须调用 --auto-restore');
  assert.ok(updateBat.includes('where node'), '一键更新批处理必须检查 Node 环境');
  assert.ok(updateBat.includes('USE_LEGACY_FLOW'), '一键更新批处理必须保留无 Node 兜底流程');

  const launcherBat = await fs.readFile(launcherBatPath, 'utf8');
  assert.ok(launcherBat.includes('where node'), '双击运行批处理必须检查 Node 环境');
});

test('findAvailablePatch 准确识别 downloads 子目录中的缓存结构及 releaseManager.listFiles', async t => {
  const dir = await workspace(t);
  const cacheDir = path.join(dir, 'downloads', 'release-v2.23.1-hash');
  await fs.mkdir(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, 'app.asar.ready');
  await fs.writeFile(cacheFile, packedLocalized('2.23.1'));

  // 1. 直接通过目录结构扫描
  const patchFromDir = await findAvailablePatch({ workspaceDir: dir, targetVersion: '2.23.1' });
  assert.ok(patchFromDir, '应当能在 downloads 子目录下扫描到 app.asar.ready');
  assert.equal(patchFromDir.version, '2.23.1');
  assert.equal(patchFromDir.path, cacheFile);

  // 2. 通过 releaseManager.listFiles 扫描
  const fakeReleaseManager = {
    listFiles: async () => [{
      cacheId: 'release-v2.23.1-hash',
      tag: 'v2.23.1',
      path: cacheFile,
      modified: false,
      size: 100
    }]
  };
  const patchFromRM = await findAvailablePatch({ workspaceDir: dir, targetVersion: '2.23.1', releaseManager: fakeReleaseManager });
  assert.ok(patchFromRM, '应当通过 releaseManager 识别到缓存包');
  assert.equal(patchFromRM.version, '2.23.1');
});

test('executeAutoRestore 跨大版本更新时归档旧备份并为新版本创建安全备份', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resDir = path.join(appDir, 'resources');
  await fs.mkdir(resDir, { recursive: true });
  const asarPath = path.join(resDir, 'app.asar');
  const backupPath = path.join(resDir, 'app.asar.bak');

  // 原有旧版 2.22.0 的备份
  const oldBackupBytes = packedOfficial('2.22.0');
  await fs.writeFile(backupPath, oldBackupBytes);

  // 官方新版 2.23.1 的客户端原版
  const newOfficialBytes = packedOfficial('2.23.1');
  await fs.writeFile(asarPath, newOfficialBytes);

  // 本地 2.23.1 汉化补丁
  const readyPath = path.join(dir, 'app.asar.ready');
  const patchBytes = packedLocalized('2.23.1');
  await fs.writeFile(readyPath, patchBytes);

  const result = await executeAutoRestore({
    appDir,
    workspaceDir: dir
  });

  assert.equal(result.success, true);
  assert.equal(result.code, 'RESTORED');

  // 验证当前 app.asar.bak 已更新为 2.23.1 原版
  assert.deepEqual(await fs.readFile(backupPath), newOfficialBytes);

  // 验证旧版 2.22.0 备份已被安全归档保留
  const files = await fs.readdir(resDir);
  const archived = files.find(f => f.startsWith('app.asar.bak.2.22.0'));
  assert.ok(archived, '旧版备份必须归档保留，防止历史数据丢失');
  assert.deepEqual(await fs.readFile(path.join(resDir, archived)), oldBackupBytes);
});

test('executeAutoRestore 进程退出超时后若仍在运行则安全中断拒绝写入', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resDir = path.join(appDir, 'resources');
  await fs.mkdir(resDir, { recursive: true });
  const asarPath = path.join(resDir, 'app.asar');

  const officialBytes = packedOfficial('2.23.1');
  await fs.writeFile(asarPath, officialBytes);

  const readyPath = path.join(dir, 'app.asar.ready');
  await fs.writeFile(readyPath, packedLocalized('2.23.1'));

  // 模拟进程一直卡死运行
  const result = await executeAutoRestore({
    appDir,
    workspaceDir: dir,
    isAppRunning: async () => true,
    stopProcesses: async () => {},
    stopTimeoutMs: 50
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'APP_RUNNING');
  assert.match(result.message, /未能成功退出/);

  // 目标文件必须未被改动
  assert.deepEqual(await fs.readFile(asarPath), officialBytes);
});



test('未知客户端或补丁版本不应被标记兼容，也不得停止进程或写入备份', async t => {
  for (const invalidClient of [false, true]) {
    const dir = await workspace(t);
    const appDir = path.join(dir, 'app');
    const resources = path.join(appDir, 'resources');
    await fs.mkdir(resources, { recursive: true });
    const target = path.join(resources, 'app.asar');
    const original = invalidClient ? Buffer.from('invalid client archive') : packedOfficial('2.31.0');
    await fs.writeFile(target, original);
    await fs.writeFile(path.join(dir, 'app.asar.ready'), invalidClient ? packedLocalized('2.31.0') : Buffer.from('invalid patch archive'));
    const patch = await findAvailablePatch({ workspaceDir: dir, targetVersion: invalidClient ? null : '2.31.0' });
    assert.equal(patch.isMatch, false);
    let checkedProcesses = false;
    const result = await executeAutoRestore({ appDir, workspaceDir: dir,
      isAppRunning() { checkedProcesses = true; return true; } });
    assert.equal(result.success, false);
    assert.equal(result.code, 'VERSION_UNKNOWN');
    assert.equal(checkedProcesses, false);
    assert.deepEqual(await fs.readFile(target), original);
    assert.deepEqual(await fs.readdir(resources), ['app.asar']);
  }
});

test('指定候选包以实际归档版本为准，不接受缓存标签或调用方声明', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resources = path.join(appDir, 'resources');
  await fs.mkdir(resources, { recursive: true });
  const target = path.join(resources, 'app.asar');
  const original = packedOfficial('2.31.2');
  await fs.writeFile(target, original);
  const patch = path.join(dir, 'app.asar.ready');
  await fs.writeFile(patch, packedLocalized('2.31.0'));
  const result = await executeAutoRestore({ appDir, workspaceDir: dir,
    candidatePatch: { path: patch, version: '2.31.2' } });
  assert.equal(result.code, 'VERSION_MISMATCH');
  assert.equal(result.patchVersion, '2.31.0');
  assert.deepEqual(await fs.readFile(target), original);
  assert.deepEqual(await fs.readdir(resources), ['app.asar']);
});

test('缓存标签不能让版本不可读的归档被标记为匹配', async t => {
  const dir = await workspace(t);
  const cached = path.join(dir, 'cached.asar');
  await fs.writeFile(cached, 'invalid cached archive');
  const patch = await findAvailablePatch({ workspaceDir: dir, targetVersion: '2.31.0',
    releaseManager: { listFiles: async () => [{ path: cached, tag: 'v2.31.0', modified: false, size: 22 }] } });
  assert.equal(patch.version, null);
  assert.equal(patch.isMatch, false);
});

test('等待退出期间补丁被换成其他版本时不得安装', async t => {
  const dir = await workspace(t);
  const appDir = path.join(dir, 'app');
  const resources = path.join(appDir, 'resources');
  await fs.mkdir(resources, { recursive: true });
  const target = path.join(resources, 'app.asar');
  const original = packedOfficial('2.31.0');
  await fs.writeFile(target, original);
  const patch = path.join(dir, 'app.asar.ready');
  await fs.writeFile(patch, packedLocalized('2.31.0'));
  let running = true;
  const result = await executeAutoRestore({ appDir, workspaceDir: dir,
    isAppRunning: () => running,
    stopProcesses: async () => { running = false; await fs.writeFile(patch, packedLocalized('2.32.0')); } });
  assert.equal(result.success, false);
  assert.equal(result.code, 'INSTALL_FAILED');
  assert.deepEqual(await fs.readFile(target), original);
});
