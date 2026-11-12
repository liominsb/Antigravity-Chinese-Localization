'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { readAsarPackageVersion } = require('./asar-version');

// 特征指纹检测：判断 asar 文件是否已经注入汉化代码
function isLocalizedAsar(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const buf = fs.readFileSync(filePath);
    return buf.includes(Buffer.from('// Antigravity 2.0 Chinese Localization Engine')) ||
           buf.includes(Buffer.from('menuTranslationMap')) ||
           buf.includes(Buffer.from('DOM_TRANSLATOR_INJECTION'));
  } catch (_) {
    return false;
  }
}

// 计算文件的 SHA256 哈希
async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// 标准化版本字符串（移除前缀 v/V 与空白）
function normalizeVersion(ver) {
  if (!ver || typeof ver !== 'string') return '';
  return ver.trim().replace(/^[vV]/, '');
}

/**
 * 寻找本地可用的汉化补丁包
 * 优先级：
 * 1. 根目录的 app.asar.ready（离线完整包或就绪包）
 * 2. releaseManager 缓存目录 downloads/ 中的已验证包
 */
async function findAvailablePatch({ workspaceDir, targetVersion, releaseManager } = {}) {
  const wsDir = workspaceDir || path.resolve(__dirname);
  const candidates = [];

  // 1. 根目录 app.asar.ready
  const readyPath = path.join(wsDir, 'app.asar.ready');
  if (fs.existsSync(readyPath)) {
    try {
      const stat = await fsp.stat(readyPath);
      if (stat.isFile() && stat.size > 0) {
        const patchVersion = readAsarPackageVersion(readyPath);
        candidates.push({
          source: 'ready-file',
          path: readyPath,
          version: patchVersion,
          size: stat.size
        });
      }
    } catch (_) {}
  }

  // 2. downloads/ 缓存目录中由 releaseManager 下载的补丁包
  if (releaseManager && typeof releaseManager.listFiles === 'function') {
    try {
      const cached = await releaseManager.listFiles();
      for (const item of cached) {
        if (!item.modified && item.path && fs.existsSync(item.path)) {
          const patchVersion = readAsarPackageVersion(item.path);
          candidates.push({
            source: 'download-cache',
            cacheId: item.cacheId,
            tag: item.tag,
            path: item.path,
            version: patchVersion,
            size: item.size,
            sha256: item.sha256
          });
        }
      }
    } catch (_) {}
  } else {
    // 即使未注入 releaseManager，也可直接扫描 downloads 目录（支持平铺文件与子目录）
    const downloadsDir = path.join(wsDir, 'downloads');
    if (fs.existsSync(downloadsDir)) {
      try {
        const entries = await fsp.readdir(downloadsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith('.asar') || entry.name.endsWith('.ready'))) {
            const fullPath = path.join(downloadsDir, entry.name);
            try {
              const stat = await fsp.stat(fullPath);
              if (stat.size > 0) {
                candidates.push({
                  source: 'downloads-dir',
                  path: fullPath,
                  version: readAsarPackageVersion(fullPath),
                  size: stat.size
                });
              }
            } catch (_) {}
          } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
            // 兼容 releaseManager 创建的 downloads/<cacheId>/app.asar.ready 结构
            const subDir = path.join(downloadsDir, entry.name);
            const candidateNames = ['app.asar.ready', 'app.asar'];
            for (const candName of candidateNames) {
              const subFile = path.join(subDir, candName);
              if (fs.existsSync(subFile)) {
                try {
                  const stat = await fsp.stat(subFile);
                  if (stat.isFile() && stat.size > 0) {
                    candidates.push({
                      source: 'downloads-sub-dir',
                      path: subFile,
                      version: readAsarPackageVersion(subFile),
                      size: stat.size
                    });
                    break;
                  }
                } catch (_) {}
              }
            }
          }
        }
      } catch (_) {}
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const normTarget = normalizeVersion(targetVersion);

  // 如果目标版本明确，优先查找版本精确匹配的补丁
  if (normTarget) {
    const exactMatch = candidates.find(c => normalizeVersion(c.version) === normTarget);
    if (exactMatch) {
      return { ...exactMatch, isMatch: true };
    }
  }

  // 若无精确匹配，按优先级返回第一个候选（并标记是否匹配）
  const primary = candidates[0];
  const primaryNorm = normalizeVersion(primary.version);
  const isMatch = Boolean(normTarget && primaryNorm && normTarget === primaryNorm);

  return { ...primary, isMatch };
}

/**
 * 诊断客户端当前状态
 */
async function checkClientStatus({ appDir, getResourcesDir } = {}) {
  if (!appDir) {
    throw new Error('appDir 参数必填');
  }
  const resDirFn = getResourcesDir || (dir => path.join(dir, 'resources'));
  const resourcesDir = path.resolve(resDirFn(appDir));
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.bak');

  const isInstalled = fs.existsSync(asarPath);
  if (!isInstalled) {
    return {
      isInstalled: false,
      appDir,
      resourcesDir,
      asarPath,
      appVersion: null,
      isLocalized: false,
      hasBackup: false,
      isUpdateOverwritten: false
    };
  }

  const appVersion = readAsarPackageVersion(asarPath);
  const isLocalized = isLocalizedAsar(asarPath);
  const hasBackup = fs.existsSync(backupPath) && !isLocalizedAsar(backupPath);
  // 当程序已安装但未汉化时，说明是官方原版安装或官方更新覆盖
  const isUpdateOverwritten = !isLocalized;

  return {
    isInstalled: true,
    appDir,
    resourcesDir,
    asarPath,
    backupPath,
    appVersion,
    isLocalized,
    hasBackup,
    isUpdateOverwritten
  };
}

/**
 * 执行自动恢复与安全安装
 */
async function executeAutoRestore({
  appDir,
  getResourcesDir,
  workspaceDir,
  releaseManager,
  isAppRunning,
  stopProcesses,
  forceStop = true,
  candidatePatch = null,
  stopTimeoutMs = 3000
} = {}) {
  const wsDir = workspaceDir || path.resolve(__dirname);
  const status = await checkClientStatus({ appDir, getResourcesDir });

  if (!status.isInstalled) {
    return {
      success: false,
      code: 'NOT_INSTALLED',
      message: `未在目标目录找到 Antigravity 程序：${appDir}`
    };
  }

  if (status.isLocalized) {
    return {
      success: true,
      code: 'ALREADY_LOCALIZED',
      appVersion: status.appVersion,
      message: `当前客户端 (v${status.appVersion || '未知'}) 已处于汉化状态，无需重复安装。`
    };
  }

  // 寻找或使用指定的补丁包
  const patch = candidatePatch || await findAvailablePatch({
    workspaceDir: wsDir,
    targetVersion: status.appVersion,
    releaseManager
  });

  if (!patch) {
    return {
      success: false,
      code: 'NO_PATCH_FOUND',
      appVersion: status.appVersion,
      message: '本地未找到可用的汉化补丁包 (app.asar.ready 或 downloads 缓存)，请启动控制中心下载。'
    };
  }

  const appNorm = normalizeVersion(status.appVersion);
  // 候选元数据和缓存标签可能过期，写入前以实际归档中的版本为准。
  const patchVersion = readAsarPackageVersion(patch.path);
  const patchNorm = normalizeVersion(patchVersion);

  if (!appNorm || !patchNorm) {
    return {
      success: false,
      code: 'VERSION_UNKNOWN',
      appVersion: status.appVersion,
      patchVersion,
      patchPath: patch.path,
      message: '[安全拦截] 无法读取客户端或汉化包版本，已阻止覆盖。请确认客户端和同版本汉化包完整后重试。'
    };
  }

  // 核心安全拦截：版本兼容性校验
  // 仅允许已确认版本相同的客户端与补丁，避免覆盖官方更新。
  if (appNorm !== patchNorm) {
    return {
      success: false,
      code: 'VERSION_MISMATCH',
      appVersion: status.appVersion,
      patchVersion,
      patchPath: patch.path,
      message: `[安全拦截] 客户端已由官方更新为 v${status.appVersion}，但本地补丁版本为 v${patchVersion}。为防止界面崩溃或白屏，已阻止覆盖。请通过控制中心下载对应 v${status.appVersion} 的汉化包。`
    };
  }

  // 检查并关闭运行中进程
  if (typeof isAppRunning === 'function') {
    let running = false;
    try {
      running = await isAppRunning();
    } catch (_) {}

    if (running) {
      if (!forceStop) {
        return {
          success: false,
          code: 'APP_RUNNING',
          message: 'Antigravity 正在运行中，请退出客户端后再执行恢复。'
        };
      }
      if (typeof stopProcesses === 'function') {
        try {
          await stopProcesses();
        } catch (_) {}
        const deadline = Date.now() + stopTimeoutMs;
        while (Date.now() < deadline) {
          try {
            if (!await isAppRunning()) break;
          } catch (_) { break; }
          await new Promise(r => setTimeout(r, 100));
        }
        try {
          if (await isAppRunning()) {
            return {
              success: false,
              code: 'APP_RUNNING',
              message: '未能成功退出 Antigravity 客户端，文件仍在被占用，请先手动退出后再执行恢复。'
            };
          }
        } catch (_) {}
      }
    }
  }

  // 执行安全备份
  const asarPath = status.asarPath;
  const resourcesDir = status.resourcesDir;
  let createdBackupPath = null;
  const standardBackup = path.join(resourcesDir, 'app.asar.bak');

  try {
    const backupExists = fs.existsSync(standardBackup);
    const backupLocalized = backupExists && isLocalizedAsar(standardBackup);
    const backupVersion = backupExists ? readAsarPackageVersion(standardBackup) : null;
    const isDifferentVersion = backupExists && status.appVersion && backupVersion && (status.appVersion !== backupVersion);

    // 如果备份不存在、已被汉化污染、或备份版本与当前官方原版不一致（官方更新覆盖了新版本原版）
    if (!backupExists || backupLocalized || isDifferentVersion) {
      if (backupExists && !backupLocalized) {
        const archivedName = `app.asar.bak.${backupVersion || 'old'}.${Date.now().toString().slice(-6)}`;
        try {
          await fsp.copyFile(standardBackup, path.join(resourcesDir, archivedName));
        } catch (_) {}
      }
      await fsp.copyFile(asarPath, standardBackup);
      createdBackupPath = standardBackup;
    }
  } catch (err) {
    // 备份若失败，不强行写目标
    return {
      success: false,
      code: 'BACKUP_FAILED',
      message: `创建安全原版备份失败: ${err.message}`
    };
  }

  // 原子安装补丁
  const token = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const stagePath = path.join(resourcesDir, `.app.asar.restore-${token}.stage`);
  try {
    // 1. 复制到同目录暂存文件
    await fsp.copyFile(patch.path, stagePath);
    // 2. 哈希比对确认复制完整性
    const patchHash = await hashFile(patch.path);
    const stageHash = await hashFile(stagePath);
    if (patchHash !== stageHash) {
      throw new Error('汉化包暂存写入校验失败，SHA256 不一致');
    }
    // 等待进程退出和复制期间文件可能变化，提交前再次核对实际版本。
    if (normalizeVersion(readAsarPackageVersion(stagePath)) !== appNorm ||
        normalizeVersion(readAsarPackageVersion(asarPath)) !== appNorm) {
      throw new Error('客户端或暂存汉化包版本已变化，已阻止覆盖，请重新检查后重试');
    }
    // 3. 原子重命名覆盖目标
    await fsp.rename(stagePath, asarPath);

    return {
      success: true,
      code: 'RESTORED',
      appVersion: status.appVersion,
      patchVersion,
      patchPath: patch.path,
      backupPath: createdBackupPath || standardBackup,
      message: `汉化补丁 (v${patchVersion}) 已成功安全恢复！`
    };
  } catch (err) {
    // 清理暂存文件
    try {
      if (fs.existsSync(stagePath)) await fsp.unlink(stagePath);
    } catch (_) {}
    return {
      success: false,
      code: 'INSTALL_FAILED',
      message: `覆盖汉化补丁失败: ${err.message}`
    };
  }
}

module.exports = {
  isLocalizedAsar,
  hashFile,
  normalizeVersion,
  findAvailablePatch,
  checkClientStatus,
  executeAutoRestore
};
