'use strict';

const fs = require('fs');
const path = require('path');
const { readAsarPackageVersion } = require('../asar-version');

const DEFAULT_CACHE_MAX = 128;
const defaultLocalizedCache = new Map();
const MARKER_ENGINE = Buffer.from('// Antigravity 2.0 Chinese Localization Engine');
const MARKER_MENU = Buffer.from('menuTranslationMap');
const MARKER_DOM = Buffer.from('DOM_TRANSLATOR_INJECTION');

function normalizeVersion(ver) {
  if (!ver || typeof ver !== 'string') return '';
  return ver.trim().replace(/^[vV]/, '');
}

function defaultIsLocalizedAsar(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const resolved = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return false;
    const cached = defaultLocalizedCache.get(resolved);
    if (cached &&
        cached.size === stat.size &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.ctimeMs === stat.ctimeMs) {
      defaultLocalizedCache.delete(resolved);
      defaultLocalizedCache.set(resolved, cached);
      return cached.localized;
    }
    const buf = fs.readFileSync(resolved);
    const localized = buf.includes(MARKER_ENGINE) ||
                      buf.includes(MARKER_MENU) ||
                      buf.includes(MARKER_DOM);
    if (defaultLocalizedCache.has(resolved)) {
      defaultLocalizedCache.delete(resolved);
    } else if (defaultLocalizedCache.size >= DEFAULT_CACHE_MAX) {
      defaultLocalizedCache.delete(defaultLocalizedCache.keys().next().value);
    }
    defaultLocalizedCache.set(resolved, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      localized
    });
    return localized;
  } catch (_) {
    defaultLocalizedCache.delete(resolved);
    return false;
  }
}

function isBackupFilename(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.endsWith('.stage') || name.endsWith('.part')) return false;
  return name === 'app.asar.bak' ||
         name.startsWith('app.asar.backup-') ||
         name.startsWith('app.asar.bak.');
}

function kindOfBackup(name) {
  if (name === 'app.asar.bak') return 'primary';
  if (name.startsWith('app.asar.backup-')) return 'installer-backup';
  return 'archived-bak';
}

function kindRank(kind) {
  if (kind === 'primary') return 0;
  if (kind === 'installer-backup') return 1;
  return 2;
}

function compareNormalizedVersionsDesc(normA, normB) {
  if (normA && !normB) return -1;
  if (!normA && normB) return 1;
  if (!normA && !normB) return 0;
  const partsA = normA.split(/[.-]/).map(s => (/^\d+$/.test(s) ? Number(s) : s));
  const partsB = normB.split(/[.-]/).map(s => (/^\d+$/.test(s) ? Number(s) : s));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const a = partsA[i] !== undefined ? partsA[i] : 0;
    const b = partsB[i] !== undefined ? partsB[i] : 0;
    if (typeof a === 'number' && typeof b === 'number') {
      if (a !== b) return b - a;
    } else {
      const cmp = String(b).localeCompare(String(a));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/**
 * 扫描 resourcesDir 下所有合法的官方原版备份候选文件：
 * 覆盖 app.asar.bak、app.asar.backup-* 与 app.asar.bak.*，
 * 自动跳过符号链接/目录联接 (lstat) 与已被汉化污染的归档 (isLocalizedAsar)。
 */
function listBackupCandidates(resourcesDir, options = {}) {
  let targetDir = resourcesDir;
  let checkLocalized = options && options.isLocalizedAsar;
  if (resourcesDir && typeof resourcesDir === 'object') {
    targetDir = resourcesDir.resourcesDir;
    checkLocalized = resourcesDir.isLocalizedAsar;
  }
  if (typeof targetDir !== 'string' || !targetDir) return [];
  const isLocalizedFn = typeof checkLocalized === 'function' ? checkLocalized : defaultIsLocalizedAsar;
  const resolvedDir = path.resolve(targetDir);

  let names;
  try {
    const dirStat = fs.lstatSync(resolvedDir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return [];
    names = fs.readdirSync(resolvedDir);
  } catch (_) {
    return [];
  }

  const candidates = [];
  for (const name of names) {
    if (!isBackupFilename(name)) continue;
    const filePath = path.join(resolvedDir, name);
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) continue;
      if (isLocalizedFn(filePath)) continue;
      const version = readAsarPackageVersion(filePath);
      const normalizedVersion = normalizeVersion(version);
      const kind = kindOfBackup(name);
      candidates.push({
        name,
        path: filePath,
        version,
        normalizedVersion,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        kind
      });
    } catch (_) {
      // 忽略并发删除或无权限读取的损坏条目
    }
  }

  candidates.sort((a, b) => {
    const verCmp = compareNormalizedVersionsDesc(a.normalizedVersion, b.normalizedVersion);
    if (verCmp !== 0) return verCmp;
    const rankCmp = kindRank(a.kind) - kindRank(b.kind);
    if (rankCmp !== 0) return rankCmp;
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.name.localeCompare(a.name);
  });

  return candidates;
}

/**
 * 查找可用于安全还原的官方原版备份：
 * - 当传入有效 targetVersion 时，严格要求备份版本与 normalizeVersion(targetVersion) 完全一致；
 *   若仅存在旧版本备份，返回 { match: null, staleBackups: [...] } 以防跨版本还原导致客户端白屏。
 * - 当未传 targetVersion 时，按最高版本 -> app.asar.bak 优先 -> 最新修改时间返回首个官方原版备份。
 */
function findValidOfficialBackup({ resourcesDir, targetVersion, isLocalizedAsar } = {}) {
  const candidates = listBackupCandidates(resourcesDir, { isLocalizedAsar });
  if (candidates.length === 0) {
    return { match: null, staleBackups: [], candidates: [] };
  }

  const normTarget = normalizeVersion(targetVersion);
  if (normTarget) {
    const matching = candidates.filter(c => c.normalizedVersion === normTarget);
    const staleBackups = candidates.filter(c => c.normalizedVersion !== normTarget);
    if (matching.length > 0) {
      return { match: matching[0], staleBackups, candidates };
    }
    return { match: null, staleBackups, candidates };
  }

  return {
    match: candidates[0],
    staleBackups: candidates.slice(1),
    candidates
  };
}

module.exports = {
  normalizeVersion,
  isBackupFilename,
  listBackupCandidates,
  findValidOfficialBackup
};
