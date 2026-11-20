'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { withInstallLock } = require('./src/install-lock');
const { readAsarPackageVersion } = require('./asar-version');
const { normalizeVersion } = require('./src/backup-utils');
const {
  verifySameOriginAndToken,
  readJsonBody,
  sanitizeSingleSegmentUsername
} = require('./src/http-security');

function failure(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function statusFor(error) {
  return error.statusCode || (error.code === 'ENOENT' ? 404 : ['EBUSY', 'EPERM', 'EACCES'].includes(error.code) ? 409 : 500);
}

const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
function within(parent, child) {
  const relative = path.relative(comparable(parent), comparable(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Check only the target directory and intermediate subdirectories up to rootBoundary
// (never walking up to '/' where macOS /var -> private/var or symlinked /home would false-positive) [H-02].
async function directoryWithoutLinks(directory, rootBoundary = directory) {
  const boundary = path.resolve(rootBoundary);
  let curr = path.resolve(directory);
  const initialStat = await fsp.lstat(curr);
  if (!initialStat.isDirectory() || initialStat.isSymbolicLink()) {
    throw failure('目标安装目录不允许使用符号链接或目录联接', 400);
  }
  while (within(boundary, curr)) {
    const stat = await fsp.lstat(curr);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw failure('目标安装目录不允许使用符号链接或目录联接', 400);
    }
    if (comparable(curr) === comparable(boundary)) break;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
}

async function regularFile(filePath) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw failure('安装文件不允许使用符号链接或特殊文件', 400);
  return stat;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function assertCompatiblePackageVersion(targetAsarPath, candidatePath) {
  const v1 = readAsarPackageVersion(targetAsarPath);
  const v2 = readAsarPackageVersion(candidatePath);
  if (v1 !== null && v2 !== null && normalizeVersion(v1) !== normalizeVersion(v2)) {
    throw failure(`汉化包版本 (v${v2}) 与当前客户端版本 (v${v1}) 不一致，已阻止跨版本覆盖`, 409);
  }
}

async function findMatchingBackup(resourcesDir, size, sha256) {
  const names = (await fsp.readdir(resourcesDir))
    .filter(name => name === 'app.asar.bak' || name.startsWith('app.asar.backup-') || name.startsWith('app.asar.bak.')).sort();
  for (const name of names) {
    const filePath = path.join(resourcesDir, name);
    // Older timestamped backups are eligible too. Never trust the filename
    // alone, and never follow a link when looking for reusable contents.
    try {
      const stat = await fsp.lstat(filePath);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size === size &&
          await hashFile(filePath) === sha256) return filePath;
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  return null;
}

function createPackageInstaller({
  workspaceDir,
  releaseManager,
  getAppDir,
  getResourcesDir,
  isAppRunning,
  stopProcesses,
  stopTimeoutMs = 3000,
  securityToken,
  writeLock
} = {}) {
  if (!workspaceDir || !releaseManager || typeof releaseManager.withCachedFile !== 'function' ||
      typeof getAppDir !== 'function' || typeof getResourcesDir !== 'function' || typeof isAppRunning !== 'function') {
    throw new Error('Package installer dependencies are required');
  }
  const downloadsDir = path.resolve(workspaceDir, 'downloads');

  async function checkRunning() {
    try { return await isAppRunning(); }
    catch (_) { throw failure('无法确认客户端是否已退出，暂不安装', 503); }
  }

  async function requireStopped() {
    if (await checkRunning()) throw failure('Antigravity 或后台服务仍在运行，请退出后重试', 409);
  }

  async function stopBeforeInstall(allowed) {
    if (!await checkRunning()) return;
    if (!allowed) throw failure('Antigravity 或后台服务仍在运行，请确认结束进程后再安装', 409);
    if (typeof stopProcesses !== 'function') throw failure('当前服务不支持自动结束进程，请退出客户端后重试', 503);
    try { await stopProcesses(); }
    catch (_) { throw failure('无法结束 Antigravity 或后台服务，请检查权限或手动退出后重试', 409); }
    // A stop command may only signal the process. Wait briefly for the actual
    // exit, and use strict detection rather than trusting the command result.
    const deadline = Date.now() + stopTimeoutMs;
    while (await checkRunning()) {
      if (Date.now() >= deadline) throw failure('Antigravity 或后台服务未能退出，请检查权限或手动退出后重试', 409);
      await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
    }
  }

  async function install(cache, params) {
    const cleanUsername = params.username !== undefined ? sanitizeSingleSegmentUsername(params.username) : '';
    const appDir = path.resolve(getAppDir(cleanUsername, params.useDefault !== false, params.customPath || ''));
    const resourcesDir = path.resolve(getResourcesDir(appDir));
    if (!within(appDir, resourcesDir) || resourcesDir === appDir ||
        within(downloadsDir, resourcesDir) || within(resourcesDir, downloadsDir) || within(resourcesDir, cache.path)) {
      throw failure('安装目标与下载缓存重叠或不属于目标程序目录', 400);
    }
    await directoryWithoutLinks(appDir);
    await directoryWithoutLinks(resourcesDir, appDir);
    const asarPath = path.join(resourcesDir, 'app.asar');
    await regularFile(asarPath);
    const skippedResult = { tag: cache.tag, asarPath, backupPath: null, sha256: cache.sha256,
      skipped: true, backupReused: false };
    // An identical package needs no writes and should not close a running app.
    if (await hashFile(asarPath) === cache.sha256) return skippedResult;
    return withInstallLock(resourcesDir, () => installAtTarget(cache, params, appDir, resourcesDir, skippedResult));
  }

  async function installAtTarget(cache, params, appDir, resourcesDir, skippedResult) {
    const { asarPath } = skippedResult;
    // Block cross-version archive overwrites before stopping any active client [H-01].
    assertCompatiblePackageVersion(asarPath, cache.path);
    await stopBeforeInstall(params.forceStop === true);
    await directoryWithoutLinks(appDir);
    await directoryWithoutLinks(resourcesDir, appDir);
    const originalStat = await regularFile(asarPath);
    const originalHash = await hashFile(asarPath);
    if (originalHash === cache.sha256) {
      return skippedResult;
    }
    assertCompatiblePackageVersion(asarPath, cache.path);
    const token = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const stagePath = path.join(resourcesDir, `.app.asar.install-${token}.stage`);
    const rollbackPath = path.join(resourcesDir, `.app.asar.rollback-${token}.stage`);
    let backupPath;
    let backupReused = false;
    let stageCreated = false;
    let rollbackCreated = false;
    let commitAttempted = false;
    try {
      // COPYFILE_EXCL ensures even an unexpected name collision cannot replace
      // an existing file or follow a pre-existing staging-file link.
      await fsp.copyFile(cache.path, stagePath, fs.constants.COPYFILE_EXCL);
      stageCreated = true;
      await regularFile(stagePath);
      if (await hashFile(stagePath) !== cache.sha256) throw failure('安装暂存包 SHA256 校验失败', 400);
      backupPath = await findMatchingBackup(resourcesDir, originalStat.size, originalHash);
      backupReused = Boolean(backupPath);
      if (!backupPath) {
        backupPath = path.join(resourcesDir, `app.asar.backup-${originalHash.slice(0, 16)}-${token}`);
        await fsp.copyFile(asarPath, backupPath, fs.constants.COPYFILE_EXCL);
      }
      await regularFile(backupPath);
      if (await hashFile(backupPath) !== originalHash) throw failure('备份期间原文件发生变化，已暂停安装', 409);
      // Recheck immediately before commit: preparation may take time, during
      // which the user or the official updater can start another operation.
      await directoryWithoutLinks(appDir);
      await directoryWithoutLinks(resourcesDir, appDir);
      await regularFile(asarPath);
      await regularFile(backupPath);
      if (await hashFile(backupPath) !== originalHash) throw failure('安装前备份校验失败，已暂停安装', 409);
      await requireStopped();
      if (await hashFile(asarPath) !== originalHash) throw failure('官方 app.asar 在准备期间发生变化，已暂停安装', 409);
      assertCompatiblePackageVersion(asarPath, stagePath);
      commitAttempted = true;
      await fsp.rename(stagePath, asarPath);
      stageCreated = false;
      await regularFile(asarPath);
      if (await hashFile(asarPath) !== cache.sha256) throw failure('安装提交后的 SHA256 校验失败');
      return { tag: cache.tag, asarPath, backupPath, sha256: cache.sha256,
        skipped: false, backupReused };
    } catch (error) {
      if (commitAttempted) {
        const currentFingerprint = async () => {
          try { await regularFile(asarPath); return await hashFile(asarPath); }
          catch (checkError) { if (checkError.code === 'ENOENT') return null; throw checkError; }
        };
        let currentHash;
        try { currentHash = await currentFingerprint(); }
        catch (checkError) {
          throw failure(`安装失败，无法确认目标当前状态，已停止覆盖。本次备份：${backupPath}；原因：${checkError.message}`, statusFor(checkError));
        }
        if (currentHash !== null && currentHash !== originalHash && currentHash !== cache.sha256) {
          throw failure(`安装失败，目标已被其它程序修改，已保留当前文件。本次备份：${backupPath}`, 409);
        }
        try {
          // A rejected atomic rename usually leaves the original intact. Avoid
          // writing it again when it already has the pre-install fingerprint.
          if (currentHash !== originalHash) {
            await directoryWithoutLinks(appDir);
            await directoryWithoutLinks(resourcesDir, appDir);
            await regularFile(backupPath);
            if (await hashFile(backupPath) !== originalHash) throw failure('本次备份校验失败');
            await fsp.copyFile(backupPath, rollbackPath, fs.constants.COPYFILE_EXCL);
            rollbackCreated = true;
            if (await hashFile(rollbackPath) !== originalHash) throw failure('回滚暂存文件校验失败');
            await requireStopped();
            const beforeRollback = await currentFingerprint();
            if (beforeRollback !== null && beforeRollback !== originalHash && beforeRollback !== cache.sha256) {
              throw failure('目标在回滚准备期间被其它程序修改，已停止覆盖', 409);
            }
            if (beforeRollback !== originalHash) {
              await fsp.rename(rollbackPath, asarPath);
              rollbackCreated = false;
            }
            if (await hashFile(asarPath) !== originalHash) throw failure('回滚后原文件校验失败');
          }
        } catch (rollbackError) {
          throw failure(`安装失败且无法完成自动恢复。请使用本次备份：${backupPath}；原因：${rollbackError.message}`, statusFor(rollbackError));
        }
        throw failure(`安装失败，本次原文件已保留或恢复。备份：${backupPath}；原因：${error.message}`, statusFor(error));
      }
      throw error;
    } finally {
      // Backups and downloaded packages are never removed automatically.
      for (const [filePath, created] of [[stagePath, stageCreated], [rollbackPath, rollbackCreated]]) {
        if (!created) continue;
        try { await fsp.unlink(filePath); } catch (_) {}
      }
    }
  }

  function checkOrigin(req) {
    verifySameOriginAndToken(req, {
      securityToken,
      requireToken: Boolean(securityToken)
    });
  }

  async function readBody(req) {
    const body = await readJsonBody(req, { maxBytes: 16384, allowEmpty: false });
    if (typeof body.cacheId !== 'string' ||
        (body.username !== undefined && typeof body.username !== 'string') ||
        (body.useDefault !== undefined && typeof body.useDefault !== 'boolean') ||
        (body.forceStop !== undefined && typeof body.forceStop !== 'boolean') ||
        (body.customPath !== undefined && typeof body.customPath !== 'string') ||
        (body.useDefault === false && !String(body.customPath || '').trim())) {
      throw failure('请选择有效缓存版本和目标安装目录', 400);
    }
    if (body.username !== undefined) {
      sanitizeSingleSegmentUsername(body.username);
    }
    return body;
  }

  function installCached(params) {
    const run = () => releaseManager.withCachedFile(params.cacheId, cache => install(cache, params));
    return typeof writeLock?.tryRun === 'function' ? writeLock.tryRun(run, {
      owner: 'release-install',
      conflictMessage: '已有汉化、恢复或安装操作正在进行，请等待完成后重试'
    }) : run();
  }

  function handleRequest(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { return false; }
    if (url.pathname !== '/api/release-install') return false;
    void (async () => {
      if (req.method !== 'POST') throw failure('此接口仅支持 POST', 405);
      checkOrigin(req);
      const params = await readBody(req);
      return installCached(params);
    })().then(installed => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: true, installed }));
    }).catch(error => {
      if (res.destroyed || res.writableEnded) return;
      const status = statusFor(error);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: false, error: error.message || '安装失败' }));
    });
    return true;
  }

  return { handleRequest, installCached };
}

module.exports = { createPackageInstaller };
