'use strict';

// Downloads are deliberately separate from installation. No Antigravity process
// or installed file is touched by this module.
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Transform, pipeline: streamPipeline } = require('stream');
const { promisify } = require('util');
const pipeline = promisify(streamPipeline);

const REPOSITORY = 'liominsb/Antigravity-Chinese-Localization';
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const USER_AGENT = 'Antigravity-Chinese-Localization-Console';
const FILE_NAME = 'app.asar.ready';
const META_NAME = 'download.json';
const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_API_BYTES = 4 * 1024 * 1024;
const MAX_SUMS_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const CACHE_ID_PATTERN = /^release-[A-Za-z0-9._-]{1,48}-[1-9]\d{0,15}-[a-f0-9]{64}$/;
const ASSET_HOSTS = new Set([
  'github.com', 'api.github.com', 'release-assets.githubusercontent.com',
  'objects.githubusercontent.com', 'github-releases.githubusercontent.com'
]);

function fail(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDigest(value) {
  const match = typeof value === 'string' && /^sha256:([a-f0-9]{64})$/i.exec(value);
  return match ? match[1].toLowerCase() : null;
}

function selectAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find(asset => asset.name === 'app.asar.ready') ||
    assets.find(asset => asset.name === 'app.asar') || null;
}

function makeCacheId(tag, releaseId, sha256) {
  const safeTag = String(tag || 'version').replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+|\.+$/g, '').slice(0, 48) || 'version';
  // Prefix avoids Windows reserved device names. Full hashes retain replaced
  // release assets without overwriting an older, completed download.
  return `release-${safeTag}-${releaseId}-${sha256}`;
}

function createReleaseManager({ workspaceDir, request = https.request, requestTimeoutMs = 20000 } = {}) {
  if (!workspaceDir) throw new Error('workspaceDir is required');
  const workspace = path.resolve(workspaceDir);
  const downloadsDir = path.join(workspace, 'downloads');
  const listCache = new Map();
  let writeBusy = false;
  let download = {
    status: 'idle', releaseId: null, tag: '', filename: FILE_NAME, cacheId: '',
    receivedBytes: 0, totalBytes: 0, percent: 0, path: '', error: '',
    sha256: '', verified: false
  };

  function send(res, statusCode, data) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  function validateUrl(input, isApi = false) {
    let url;
    try { url = new URL(input); } catch (_) { throw fail('下载地址无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
      throw fail('只允许 HTTPS GitHub 下载地址');
    }
    if (isApi) {
      if (url.hostname !== 'api.github.com' || !url.pathname.startsWith(`/repos/${REPOSITORY}/`)) {
        throw fail('GitHub API 地址不属于指定仓库');
      }
    } else if (!ASSET_HOSTS.has(url.hostname)) {
      throw fail('下载重定向到了不允许的主机');
    }
    return url;
  }

  function assetUrl(asset) {
    const url = validateUrl(asset && asset.browser_download_url);
    if (url.hostname !== 'github.com' || !url.pathname.startsWith(`/${REPOSITORY}/releases/download/`)) {
      throw fail('发布资产地址不属于指定仓库');
    }
    return url;
  }

  function openResponse(input, { isApi = false, redirects = 0 } = {}) {
    const url = validateUrl(input, isApi);
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = request(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: isApi ? 'application/vnd.github+json' : 'application/octet-stream' }
        }, res => {
          const code = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(code)) {
            res.on('error', () => {});
            res.resume();
            if (redirects >= MAX_REDIRECTS || !res.headers.location) {
              reject(fail('GitHub 下载重定向次数过多或地址缺失'));
              return;
            }
            try {
              const next = validateUrl(new URL(res.headers.location, url), isApi);
              resolve(openResponse(next, { isApi, redirects: redirects + 1 }));
            } catch (error) { reject(error); }
            return;
          }
          if (code < 200 || code >= 300) {
            res.on('error', () => {});
            res.resume();
            reject(fail(`GitHub 返回 HTTP ${code}`));
            return;
          }
          resolve(res);
        });
        req.once('error', error => reject(error.statusCode ? error : fail('GitHub 请求失败或连接中断')));
        req.setTimeout(requestTimeoutMs, () => req.destroy(fail('GitHub 请求超时')));
        const deadline = setTimeout(() => req.destroy(fail('GitHub 请求超过最大时限')), 5 * 60 * 1000);
        deadline.unref();
        req.once('close', () => clearTimeout(deadline));
        req.end();
      } catch (error) { reject(error); }
    });
  }

  async function readBuffer(url, maxBytes, isApi = false) {
    const res = await openResponse(url, { isApi });
    if (Number(res.headers['content-length']) > maxBytes) {
      res.destroy();
      throw fail('GitHub 响应超过允许大小');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        throw fail('GitHub 响应超过允许大小');
      }
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), headers: res.headers };
  }

  async function readApi(url) {
    const result = await readBuffer(url, MAX_API_BYTES, true);
    try { return { value: JSON.parse(result.buffer.toString('utf8')), headers: result.headers }; }
    catch (_) { throw fail('GitHub 发布数据不是有效 JSON'); }
  }

  async function listReleases(page) {
    const cached = listCache.get(page);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
      const { value, headers } = await readApi(`${API_ROOT}/releases?per_page=20&page=${page}`);
      if (!Array.isArray(value)) throw fail('GitHub 发布列表格式无效');
      const releases = value.filter(release => !release.draft && selectAsset(release))
        .map(release => {
          const asset = selectAsset(release);
          return {
            id: release.id, tag: release.tag_name, name: release.name || release.tag_name,
            publishedAt: release.published_at, prerelease: Boolean(release.prerelease),
            releaseUrl: release.html_url, body: release.body || '',
            asset: { name: asset.name, size: asset.size || 0, sha256: normalizeDigest(asset.digest) }
          };
        });
      return {
        success: true, releases, page,
        hasMore: headers.link ? /rel="next"/.test(headers.link) : value.length === 20
      };
    })();
    listCache.set(page, { expires: Date.now() + 30000, promise });
    if (listCache.size > 20) listCache.delete(listCache.keys().next().value);
    try { return await promise; }
    catch (error) { listCache.delete(page); throw error; }
  }

  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    try {
      const own = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`);
      const supplied = new URL(origin);
      const local = new Set(['localhost', '127.0.0.1', '[::1]']);
      if (local.has(own.hostname) && supplied.origin === own.origin) return;
    } catch (_) {}
    throw fail('下载缓存操作只允许来自本机同源控制中心', 403);
  }

  async function readBody(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      throw fail('请求必须使用 application/json', 415);
    }
    if (Number(req.headers['content-length']) > 16384) throw fail('请求正文过大', 413);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) throw fail('请求正文过大', 413);
      chunks.push(chunk);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch (_) { throw fail('请求正文必须是有效 JSON 对象', 400); }
  }

  function controlledPath(cacheId) {
    if (typeof cacheId !== 'string' || !CACHE_ID_PATTERN.test(cacheId)) throw fail('cacheId 无效', 400);
    const resolved = path.resolve(downloadsDir, cacheId);
    if (path.dirname(resolved) !== downloadsDir) throw fail('缓存路径越界', 400);
    return resolved;
  }

  async function checkDirectory(directory) {
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('缓存目录不允许使用符号链接', 400);
    const actual = await fsp.realpath(directory);
    const expected = path.join(await fsp.realpath(workspace), path.relative(workspace, directory));
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(actual) !== normalize(expected)) throw fail('缓存目录指向工作区之外', 400);
  }

  async function ensureCacheDirectory(cacheId) {
    await fsp.mkdir(downloadsDir, { recursive: true });
    await checkDirectory(downloadsDir);
    const directory = controlledPath(cacheId);
    await fsp.mkdir(directory, { recursive: true });
    await checkDirectory(directory);
    return directory;
  }

  async function regularFile(filePath) {
    try {
      const stat = await fsp.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw fail('缓存文件不允许使用符号链接或特殊文件', 400);
      return stat;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async function fileHash(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
  }

  async function metadataFor(cacheId, allowModified = false) {
    const directory = controlledPath(cacheId);
    await checkDirectory(downloadsDir);
    await checkDirectory(directory);
    const metaPath = path.join(directory, META_NAME);
    const metaStat = await regularFile(metaPath);
    if (!metaStat || metaStat.size > 16384) throw fail('下载缓存元数据不存在或无效', 404);
    let meta;
    try { meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')); }
    catch (_) { throw fail('下载缓存元数据无效', 404); }
    if (meta.format !== 1 || meta.cacheId !== cacheId || meta.filename !== FILE_NAME ||
        !Number.isSafeInteger(meta.releaseId) || meta.releaseId <= 0 ||
        typeof meta.tag !== 'string' || !/^[a-f0-9]{64}$/.test(meta.sha256 || '') ||
        makeCacheId(meta.tag, meta.releaseId, meta.sha256) !== cacheId ||
        !Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > MAX_ASSET_BYTES ||
        typeof meta.downloadedAt !== 'string' || !Number.isFinite(Date.parse(meta.downloadedAt))) {
      throw fail('下载缓存元数据无效', 404);
    }
    const filePath = path.join(directory, FILE_NAME);
    const fileStat = await regularFile(filePath);
    if (!fileStat || (!allowModified && fileStat.size !== meta.size)) throw fail('缓存文件缺失或大小不匹配', 404);
    return { meta, directory, filePath, metaPath, fileStat };
  }

  async function writeMetadata(directory, meta) {
    const target = path.join(directory, META_NAME);
    const temp = `${target}.part`;
    await regularFile(target);
    if (await regularFile(temp)) await fsp.unlink(temp);
    await fsp.writeFile(temp, JSON.stringify(meta, null, 2), { flag: 'wx' });
    await fsp.rename(temp, target);
  }

  async function expectedHash(release, asset) {
    const digest = normalizeDigest(asset.digest);
    if (digest) return digest;
    const sums = (release.assets || []).find(item => item.name === 'SHA256SUMS.txt');
    if (!sums) throw fail('发布包缺少 SHA256 校验信息，已停止下载');
    const { buffer } = await readBuffer(assetUrl(sums), MAX_SUMS_BYTES);
    for (const line of buffer.toString('utf8').split(/\r?\n/)) {
      const gnu = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
      const bsd = /^SHA256\s*\(([^)]+)\)\s*=\s*([a-f0-9]{64})\s*$/i.exec(line);
      if (gnu && gnu[2] === asset.name) return gnu[1].toLowerCase();
      if (bsd && bsd[1] === asset.name) return bsd[2].toLowerCase();
    }
    throw fail('SHA256SUMS.txt 未包含所选资产的有效校验值');
  }

  async function downloadRelease(releaseId) {
    let partPath;
    let metaPartPath;
    let finalDownload;
    try {
      const { value: release } = await readApi(`${API_ROOT}/releases/${releaseId}`);
      if (!release || release.id !== releaseId || release.draft) throw fail('所选发布版本不存在或不可下载');
      const asset = selectAsset(release);
      if (!asset) throw fail('此版本没有 app.asar.ready 或 app.asar 资产');
      if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ASSET_BYTES) {
        throw fail('发布资产大小无效或超过 128 MB 限制');
      }
      const url = assetUrl(asset);
      download.tag = String(release.tag_name || '');
      download.totalBytes = asset.size;
      const expected = await expectedHash(release, asset);
      const cacheId = makeCacheId(download.tag, releaseId, expected);
      download.cacheId = cacheId;
      const directory = await ensureCacheDirectory(cacheId);
      const filePath = path.join(directory, FILE_NAME);
      partPath = `${filePath}.part`;
      metaPartPath = path.join(directory, `${META_NAME}.part`);
      const existing = await regularFile(filePath);
      let actual;
      let reused = false;
      if (existing && existing.size === asset.size && await fileHash(filePath) === expected) {
        actual = expected;
        download.receivedBytes = existing.size;
        reused = true;
      } else {
        if (existing) throw fail('同一缓存目录中的旧文件校验失败；请手动删除该缓存后重试');
        if (await regularFile(partPath)) await fsp.unlink(partPath);
        const response = await openResponse(url);
        if (Number(response.headers['content-length']) > MAX_ASSET_BYTES) {
          response.destroy();
          throw fail('下载文件超过 128 MB 限制');
        }
        const hash = crypto.createHash('sha256');
        const meter = new Transform({
          transform(chunk, encoding, callback) {
            download.receivedBytes += chunk.length;
            if (download.receivedBytes > MAX_ASSET_BYTES || download.receivedBytes > asset.size) {
              callback(fail('下载文件超过允许大小或发布资产声明大小'));
              return;
            }
            hash.update(chunk);
            download.percent = Math.min(99, Math.round(download.receivedBytes * 100 / asset.size));
            callback(null, chunk);
          }
        });
        await pipeline(response, meter, fs.createWriteStream(partPath, { flags: 'wx' }));
        actual = hash.digest('hex');
        if (download.receivedBytes !== asset.size) throw fail('下载文件不完整，大小与发布资产不符');
        if (actual !== expected) throw fail('SHA256 校验失败，下载文件未保存为可用缓存');
        await fsp.rename(partPath, filePath);
      }
      let downloadedAt = new Date().toISOString();
      if (reused) {
        try { downloadedAt = (await metadataFor(cacheId)).meta.downloadedAt; } catch (_) {}
      }
      await writeMetadata(directory, {
        format: 1, cacheId, releaseId, tag: download.tag, filename: FILE_NAME,
        size: download.receivedBytes, sha256: actual, downloadedAt
      });
      finalDownload = { ...download, status: 'completed', percent: 100, path: filePath, sha256: actual, verified: true };
    } catch (error) {
      finalDownload = { ...download, status: 'failed', path: '', verified: false, error: error.message || '下载失败' };
    } finally {
      // Only our incomplete staging files are removed. Completed versions remain
      // until the user explicitly deletes a cache entry.
      for (const temporary of [partPath, metaPartPath]) {
        if (!temporary) continue;
        try { if (await regularFile(temporary)) await fsp.unlink(temporary); } catch (_) {}
      }
    }
    download = finalDownload;
  }

  async function listFiles() {
    let entries;
    try { await checkDirectory(downloadsDir); entries = await fsp.readdir(downloadsDir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const files = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !CACHE_ID_PATTERN.test(entry.name)) continue;
      try {
        const { meta, filePath, fileStat } = await metadataFor(entry.name, true);
        files.push({ cacheId: meta.cacheId, releaseId: meta.releaseId, tag: meta.tag, filename: FILE_NAME,
          size: fileStat.size, modified: fileStat.size !== meta.size,
          path: filePath, sha256: meta.sha256, downloadedAt: meta.downloadedAt });
      } catch (_) { /* Ignore unrelated, incomplete or unsafe directories. */ }
    }
    return files.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  }

  async function deleteFile(cacheId) {
    controlledPath(cacheId);
    if (download.status === 'downloading' && download.cacheId === cacheId) throw fail('该缓存正在下载中，暂时不能删除', 409);
    let cached;
    try { cached = await metadataFor(cacheId, true); }
    catch (error) { if (error.code === 'ENOENT') throw fail('缓存不存在', 404); throw error; }
    await fsp.unlink(cached.filePath);
    if (download.cacheId === cacheId && download.status !== 'downloading') {
      download = { status: 'idle', releaseId: null, tag: '', filename: FILE_NAME, cacheId: '',
        receivedBytes: 0, totalBytes: 0, percent: 0, path: '', error: '', sha256: '', verified: false };
    }
    const warnings = [];
    try { await fsp.unlink(cached.metaPath); }
    catch (error) { warnings.push(`缓存文件已删除，但元数据清理失败 (${error.code || 'I/O'})`); }
    try { await fsp.rmdir(cached.directory); }
    catch (error) {
      if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) warnings.push(`缓存文件已删除，但空目录清理失败 (${error.code || 'I/O'})`);
    }
    return warnings.length ? { warning: warnings.join('；') } : {};
  }

  async function withCachedFile(cacheId, operation) {
    controlledPath(cacheId);
    if (download.status === 'downloading' || writeBusy) throw fail('已有下载、安装或缓存操作正在进行', 409);
    writeBusy = true;
    try {
      const { meta, filePath, fileStat } = await metadataFor(cacheId);
      if (await fileHash(filePath) !== meta.sha256) throw fail('缓存 SHA256 校验失败，请重新下载后再安装', 400);
      return await operation({ cacheId, releaseId: meta.releaseId, tag: meta.tag, filename: FILE_NAME,
        path: filePath, size: fileStat.size, sha256: meta.sha256 });
    } finally { writeBusy = false; }
  }

  function handleRequest(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { return false; }
    if (!['/api/releases', '/api/release-download', '/api/release-cache'].includes(url.pathname)) return false;
    void (async () => {
      if (url.pathname === '/api/releases' && req.method === 'GET') {
        const page = Number(url.searchParams.get('page') || '1');
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw fail('page 必须是 1 到 1000 的整数', 400);
        send(res, 200, await listReleases(page));
      } else if (url.pathname === '/api/release-download' && req.method === 'GET') {
        send(res, 200, { success: true, download });
      } else if (url.pathname === '/api/release-download' && req.method === 'POST') {
        checkOrigin(req);
        const { releaseId } = await readBody(req);
        if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw fail('releaseId 必须是正整数', 400);
        if (download.status === 'downloading' || writeBusy) throw fail('已有下载、安装或缓存操作正在进行，请等待完成', 409);
        download = { status: 'downloading', releaseId, tag: '', filename: FILE_NAME, cacheId: '',
          receivedBytes: 0, totalBytes: 0, percent: 0, path: '', error: '', sha256: '', verified: false };
        send(res, 202, { success: true, download });
        void downloadRelease(releaseId);
      } else if (url.pathname === '/api/release-cache' && req.method === 'GET') {
        send(res, 200, { success: true, files: await listFiles() });
      } else if (url.pathname === '/api/release-cache' && req.method === 'DELETE') {
        checkOrigin(req);
        const { cacheId } = await readBody(req);
        if (download.status === 'downloading' || writeBusy) throw fail('已有下载、安装或缓存操作正在进行，暂时不能删除缓存', 409);
        // Reserve the writer before the first filesystem await, so a concurrent
        // POST cannot reuse a file while this request is deleting it.
        writeBusy = true;
        let result;
        try { result = await deleteFile(cacheId); }
        finally { writeBusy = false; }
        send(res, 200, { success: true, ...result });
      } else {
        throw fail('此接口不支持该请求方法', 405);
      }
    })().catch(error => send(res, error.statusCode || 500, { success: false, error: error.message || '操作失败' }));
    return true;
  }

  return { handleRequest, withCachedFile, listFiles };
}

// 缓存目录命名规则。打包器预置缓存时必须产出完全一致的 cacheId，
// 否则 listFiles/metadataFor 的复核会直接丢弃该目录，因此这里统一导出，
// 避免两处各写一份实现后发生漂移。
module.exports = { createReleaseManager, makeCacheId, CACHE_ID_PATTERN, FILE_NAME };
