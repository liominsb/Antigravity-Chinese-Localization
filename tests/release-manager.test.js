'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createReleaseManager } = require('../release-manager');

const REPO = 'antigravity-cn-community/Antigravity-Chinese-Localization';
const API = `/repos/${REPO}/releases`;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function makeRelease(id, bytes, { tag = `v${id}`, assetName = 'app.asar.ready', digest = sha256(bytes) } = {}) {
  return { id, tag_name: tag, name: `Release ${id}`, published_at: '2026-10-15T00:00:00Z',
    draft: false, prerelease: false, html_url: `https://github.com/${REPO}/releases/tag/${tag}`, body: 'Release notes',
    assets: [{ name: assetName, size: bytes.length, digest: digest ? `sha256:${digest}` : null,
      browser_download_url: `https://github.com/${REPO}/releases/download/v${id}/${assetName}` }] };
}

function json(res, value, headers = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

async function fixture(t, serve, options = {}) {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-release-test-'));
  const upstream = http.createServer((req, res) => {
    Promise.resolve(serve(req, res)).catch(error => {
      if (!res.headersSent) res.writeHead(500);
      res.end(error.message);
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  // The production URL validator still runs. Only transport is mapped to this
  // isolated mock HTTP server; no request reaches GitHub or an installed app.
  const manager = createReleaseManager({ workspaceDir, requestTimeoutMs: options.requestTimeoutMs || 1000,
    request(url, config, callback) {
      assert.equal(url.protocol, 'https:');
      return http.request({ host: '127.0.0.1', port: upstreamPort, path: url.pathname + url.search,
        headers: { ...config.headers, 'x-test-host': url.hostname } }, callback);
    } });
  const app = http.createServer((req, res) => {
    if (!manager.handleRequest(req, res)) { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const port = app.address().port;
  t.after(async () => {
    upstream.closeAllConnections();
    app.closeAllConnections();
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => app.close(resolve))]);
    const resolved = path.resolve(workspaceDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^antigravity-release-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  async function call(route, method = 'GET', body, origin) {
    return new Promise((resolve, reject) => {
      const headers = {};
      const payload = body === undefined ? undefined : JSON.stringify(body);
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (origin !== undefined) headers.Origin = origin;
      const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch (error) { reject(error); }
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  async function waitFor(predicate) {
    const end = Date.now() + 5000;
    do {
      const state = (await call('/api/release-download')).body.download;
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < end);
    throw new Error('Download did not reach the expected state');
  }
  return { call, waitFor, workspaceDir, port, manager };
}

test('release list filters drafts, prefers ready, supports fallback and caches pagination', async t => {
  let requests = 0;
  const bytes = Buffer.from('archive');
  const ready = makeRelease(1, bytes);
  ready.assets.unshift({ ...ready.assets[0], name: 'app.asar' });
  const fallback = makeRelease(2, bytes, { assetName: 'app.asar', digest: null });
  const draft = { ...makeRelease(3, bytes), draft: true };
  const unrelated = { ...makeRelease(4, bytes), assets: [{ name: 'default.zip' }] };
  const f = await fixture(t, (req, res) => {
    requests++;
    assert.equal(req.url, `${API}?per_page=20&page=1`);
    assert.equal(req.headers['user-agent'], 'Antigravity-Chinese-Localization-Console');
    json(res, [ready, fallback, draft, unrelated], { Link: '<https://api.github.com/next>; rel="next"' });
  });
  const first = await f.call('/api/releases?page=1');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.releases.map(item => [item.id, item.asset.name]), [[1, 'app.asar.ready'], [2, 'app.asar']]);
  assert.equal(first.body.releases[0].asset.sha256, sha256(bytes));
  assert.equal(first.body.releases[1].asset.sha256, null);
  assert.equal(first.body.hasMore, true);
  assert.equal(first.body.page, 1);
  await f.call('/api/releases');
  assert.equal(requests, 1);
  for (const page of ['0', '1.5', 'abc', '1001']) assert.equal((await f.call(`/api/releases?page=${page}`)).status, 400);
  assert.equal((await f.call('/not-managed')).status, 404);
});

test('streamed redirects, checksum fallback, hash reuse and explicit deletion retain other versions', async t => {
  const oldBytes = Buffer.from('old release bytes'.repeat(200));
  const newBytes = Buffer.from('new release bytes'.repeat(300));
  const oldRelease = makeRelease(101, oldBytes, { tag: '../../CON', digest: null });
  oldRelease.assets.push({ name: 'SHA256SUMS.txt', size: 200,
    browser_download_url: `https://github.com/${REPO}/releases/download/v101/SHA256SUMS.txt` });
  const newRelease = makeRelease(102, newBytes, { assetName: 'app.asar' });
  let payloadRequests = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === `${API}/101`) return json(res, oldRelease);
    if (req.url === `${API}/102`) return json(res, newRelease);
    if (req.url.endsWith('/SHA256SUMS.txt')) return res.end(`${'0'.repeat(64)}  app.asar\n${sha256(oldBytes)} *app.asar.ready\n`);
    if (req.headers['x-test-host'] === 'github.com') {
      res.writeHead(302, { Location: `https://release-assets.githubusercontent.com/payload/${req.url.includes('v101') ? '101' : '102'}` });
      return res.end();
    }
    payloadRequests++;
    const bytes = req.url.endsWith('101') ? oldBytes : newBytes;
    res.writeHead(200, { 'Content-Length': bytes.length });
    res.write(bytes.subarray(0, 100));
    setTimeout(() => res.end(bytes.subarray(100)), 30);
  });
  assert.equal((await f.call('/api/release-download', 'POST', { releaseId: 101, url: 'https://evil.invalid/ignored' })).status, 202);
  const oldState = await f.waitFor(state => state.status === 'completed');
  assert.equal(oldState.verified, true);
  assert.equal(oldState.sha256, sha256(oldBytes));
  assert.equal(oldState.percent, 100);
  assert.equal(oldState.receivedBytes, oldBytes.length);
  assert.equal(path.basename(oldState.path), 'app.asar.ready');
  assert.equal(path.dirname(path.dirname(oldState.path)), path.join(f.workspaceDir, 'downloads'));
  assert.deepEqual(await fs.readFile(oldState.path), oldBytes);
  assert.equal((await fs.readdir(path.dirname(oldState.path))).some(name => name.endsWith('.part')), false);
  await f.call('/api/release-download', 'POST', { releaseId: 102 });
  const newState = await f.waitFor(state => state.status === 'completed');
  let cached = (await f.call('/api/release-cache')).body.files;
  assert.equal(cached.length, 2);
  assert.deepEqual(await fs.readFile(oldState.path), oldBytes);
  await f.call('/api/release-download', 'POST', { releaseId: 102 });
  await f.waitFor(state => state.status === 'completed');
  assert.equal(payloadRequests, 2, 'a verified cache is hashed again and reused');
  const cachedAfterReuse = (await f.call('/api/release-cache')).body.files;
  assert.equal(cachedAfterReuse.find(item => item.releaseId === 102).downloadedAt, cached.find(item => item.releaseId === 102).downloadedAt);
  // Unknown files in a controlled directory must survive explicit cache deletion.
  const unrelatedFile = path.join(path.dirname(newState.path), 'keep-me.txt');
  await fs.writeFile(unrelatedFile, 'unrelated');
  assert.equal((await f.call('/api/release-cache', 'DELETE', { cacheId: newState.cacheId })).status, 200);
  assert.equal(await fs.readFile(unrelatedFile, 'utf8'), 'unrelated');
  assert.equal((await f.call('/api/release-download')).body.download.status, 'idle');
  cached = (await f.call('/api/release-cache')).body.files;
  assert.equal(cached.length, 1);
  assert.equal(cached[0].releaseId, 101);
  assert.deepEqual(await fs.readFile(oldState.path), oldBytes);
});

test('single active download, same-cache delete conflict and cross-origin writes are rejected', async t => {
  const bytes = Buffer.from('concurrent payload');
  const release = makeRelease(201, bytes);
  let heldResponse;
  const f = await fixture(t, (req, res) => {
    if (req.url === `${API}/201`) return json(res, release);
    heldResponse = res;
  });
  assert.equal((await f.call('/api/release-download', 'POST', { releaseId: 201 }, 'https://evil.example')).status, 403);
  const start = await f.call('/api/release-download', 'POST', { releaseId: 201 }, `http://127.0.0.1:${f.port}`);
  assert.equal(start.status, 202);
  const active = await f.waitFor(state => state.cacheId !== '');
  assert.equal(active.status, 'downloading');
  assert.equal((await f.call('/api/release-download', 'POST', { releaseId: 202 })).status, 409);
  assert.equal((await f.call('/api/release-cache', 'DELETE', { cacheId: active.cacheId })).status, 409);
  while (!heldResponse) await new Promise(resolve => setTimeout(resolve, 5));
  heldResponse.end(bytes);
  const completed = await f.waitFor(state => state.status === 'completed');
  assert.equal((await f.call('/api/release-cache', 'DELETE', { cacheId: completed.cacheId }, 'null')).status, 403);
  assert.deepEqual(await fs.readFile(completed.path), bytes);
  for (const id of ['201', 0, -1, 1.5, '../../123', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await f.call('/api/release-download', 'POST', { releaseId: id })).status, 400);
  }
});

test('hash mismatch, missing checksums, failed streams, size limits and unsafe redirects never complete', async t => {
  const bytes = Buffer.from('expected payload');
  const releases = new Map();
  releases.set(301, makeRelease(301, bytes, { digest: '0'.repeat(64) }));
  releases.set(302, makeRelease(302, bytes, { digest: null }));
  releases.set(303, makeRelease(303, bytes));
  const tooLarge = makeRelease(304, bytes); tooLarge.assets[0].size = 129 * 1024 * 1024; releases.set(304, tooLarge);
  releases.set(305, makeRelease(305, bytes));
  releases.set(306, makeRelease(306, bytes));
  releases.set(307, makeRelease(307, bytes));
  const untrusted = makeRelease(308, bytes); untrusted.assets[0].browser_download_url = 'https://evil.example/file'; releases.set(308, untrusted);
  let loopRequests = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url.startsWith(API)) {
      const release = releases.get(Number(req.url.split('/').pop()));
      if (!release) { res.writeHead(404); return res.end(); }
      return json(res, release);
    }
    if (req.url.includes('/v303/')) {
      res.writeHead(200, { 'Content-Length': bytes.length });
      res.write(bytes.subarray(0, 3));
      setTimeout(() => res.destroy(), 10);
      return;
    }
    if (req.url.includes('/v305/')) { res.writeHead(302, { Location: 'http://evil.example/asset' }); return res.end(); }
    if (req.url.includes('/v306/') || req.url === '/loop') {
      loopRequests++;
      res.writeHead(302, { Location: 'https://release-assets.githubusercontent.com/loop' }); return res.end();
    }
    if (req.url.includes('/v307/')) return res.end(Buffer.concat([bytes, Buffer.from('too many bytes')]));
    res.end(bytes);
  });
  for (const [id, message] of [[301, /SHA256/], [302, /校验信息/], [303, /aborted|中断|关闭/i],
    [304, /128 MB/], [305, /HTTPS/], [306, /重定向/], [307, /大小/], [308, /主机|指定仓库/], [999, /HTTP 404/]]) {
    assert.equal((await f.call('/api/release-download', 'POST', { releaseId: id })).status, 202);
    const state = await f.waitFor(value => value.status === 'failed');
    assert.equal(state.verified, false);
    assert.equal(state.path, '');
    assert.match(state.error, message);
    assert.equal((await f.call('/api/release-cache')).body.files.length, 0);
  }
  assert.ok(loopRequests <= 6);
  const directories = await fs.readdir(path.join(f.workspaceDir, 'downloads'));
  for (const directory of directories) {
    assert.deepEqual(await fs.readdir(path.join(f.workspaceDir, 'downloads', directory)), []);
  }
});

test('replaced assets preserve old downloads, tampered caches are rehashed, deletion cannot traverse or follow junctions', async t => {
  let bytes = Buffer.from('version one');
  let release = makeRelease(401, bytes);
  const f = await fixture(t, (req, res) => req.url === `${API}/401` ? json(res, release) : res.end(bytes));
  await f.call('/api/release-download', 'POST', { releaseId: 401 });
  const original = await f.waitFor(state => state.status === 'completed');
  bytes = Buffer.from('version two');
  release = makeRelease(401, bytes);
  await f.call('/api/release-download', 'POST', { releaseId: 401 });
  const replaced = await f.waitFor(state => state.status === 'completed');
  assert.notEqual(original.cacheId, replaced.cacheId);
  assert.equal((await f.call('/api/release-cache')).body.files.length, 2);
  assert.equal(await fs.readFile(original.path, 'utf8'), 'version one');
  await fs.writeFile(replaced.path, 'changed!!!');
  const damaged = (await f.call('/api/release-cache')).body.files.find(item => item.cacheId === replaced.cacheId);
  assert.equal(damaged.modified, true);
  assert.equal(damaged.size, Buffer.byteLength('changed!!!'));
  await f.call('/api/release-download', 'POST', { releaseId: 401 });
  const corrupt = await f.waitFor(state => state.status === 'failed');
  assert.match(corrupt.error, /校验失败/);
  assert.equal(await fs.readFile(replaced.path, 'utf8'), 'changed!!!');
  for (const cacheId of ['../outside', original.path, 'C:\\Windows', 'not-a-cache']) {
    assert.equal((await f.call('/api/release-cache', 'DELETE', { cacheId })).status, 400);
  }
  // Junctions work on Windows without symlink privilege. The target is another
  // isolated test directory, never the user's Antigravity installation.
  const outside = path.join(f.workspaceDir, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'app.asar.ready'), 'keep outside');
  const fakeId = `release-safe-999-${'a'.repeat(64)}`;
  await fs.symlink(outside, path.join(f.workspaceDir, 'downloads', fakeId), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await f.call('/api/release-cache', 'DELETE', { cacheId: fakeId })).status, 400);
  assert.equal(await fs.readFile(path.join(outside, 'app.asar.ready'), 'utf8'), 'keep outside');
  assert.equal((await f.call('/api/release-cache', 'DELETE', { cacheId: replaced.cacheId })).status, 200);
  assert.equal(await fs.readFile(original.path, 'utf8'), 'version one');
});

test('stalled metadata requests time out and become a failed download', async t => {
  const f = await fixture(t, () => {}, { requestTimeoutMs: 40 });
  assert.equal((await f.call('/api/release-download', 'POST', { releaseId: 501 })).status, 202);
  const state = await f.waitFor(value => value.status === 'failed');
  assert.match(state.error, /超时/);
  assert.equal(state.verified, false);
});

test('download and explicit deletion share a write lock, including metadata-fetch time', async t => {
  const bytes = Buffer.from('write lock payload');
  let heldMetadata;
  const f = await fixture(t, (req, res) => {
    if (req.url === `${API}/601`) return json(res, makeRelease(601, bytes));
    if (req.url === `${API}/602`) { heldMetadata = res; return; }
    res.end(bytes);
  });
  await f.call('/api/release-download', 'POST', { releaseId: 601 });
  const cached = await f.waitFor(state => state.status === 'completed');
  const unlink = fs.unlink;
  let releaseDeletion;
  let enteredDeletion;
  const releaseGate = new Promise(resolve => { releaseDeletion = resolve; });
  const enteredGate = new Promise(resolve => { enteredDeletion = resolve; });
  fs.unlink = async file => {
    if (file === cached.path) { enteredDeletion(); await releaseGate; }
    return unlink(file);
  };
  try {
    const deletion = f.call('/api/release-cache', 'DELETE', { cacheId: cached.cacheId });
    await enteredGate;
    assert.equal((await f.call('/api/release-download', 'POST', { releaseId: 602 })).status, 409);
    releaseDeletion();
    assert.equal((await deletion).status, 200);
  } finally {
    releaseDeletion();
    fs.unlink = unlink;
  }
  assert.equal((await f.call('/api/release-download', 'POST', { releaseId: 602 })).status, 202);
  const waiting = await f.waitFor(state => state.status === 'downloading');
  assert.equal(waiting.cacheId, '');
  assert.equal((await f.call('/api/release-cache', 'DELETE', { cacheId: cached.cacheId })).status, 409);
  while (!heldMetadata) await new Promise(resolve => setTimeout(resolve, 5));
  json(heldMetadata, makeRelease(602, bytes));
  const completed = await f.waitFor(state => state.status === 'completed');
  assert.deepEqual(await fs.readFile(completed.path), bytes);
});

test('a deleted main cache file is reported accurately even if metadata cleanup fails', async t => {
  const bytes = Buffer.from('cleanup payload');
  const f = await fixture(t, (req, res) => req.url === `${API}/701` ? json(res, makeRelease(701, bytes)) : res.end(bytes));
  await f.call('/api/release-download', 'POST', { releaseId: 701 });
  const cached = await f.waitFor(state => state.status === 'completed');
  const unlink = fs.unlink;
  fs.unlink = async file => {
    if (file === path.join(path.dirname(cached.path), 'download.json')) {
      const error = new Error('Mock permission failure');
      error.code = 'EACCES';
      throw error;
    }
    return unlink(file);
  };
  try {
    const deleted = await f.call('/api/release-cache', 'DELETE', { cacheId: cached.cacheId });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.success, true);
    assert.match(deleted.body.warning, /已删除.*元数据/);
    assert.equal((await f.call('/api/release-download')).body.download.status, 'idle');
    await assert.rejects(fs.stat(cached.path), { code: 'ENOENT' });
  } finally { fs.unlink = unlink; }
});
