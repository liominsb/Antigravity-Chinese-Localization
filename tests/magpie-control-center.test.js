'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const execFile = require('util').promisify(require('child_process').execFile);
const { runRestoreWorkflow } = require('../localize');
const { setTimeout: delay } = require('timers/promises');
const { createReleaseManager } = require('../release-manager');
const { createControlCenter, startControlCenter } = require('../integrations/magpie/control-center');
const { loadSessionToken } = require('../integrations/magpie/session-state');
const manifest = require('../integrations/magpie/package.json');

const repo = 'antigravity-cn-community/Antigravity-Chinese-Localization';

function archive(version) {
  const metadata = Buffer.from(JSON.stringify({ version }));
  const json = Buffer.from(JSON.stringify({ files: { 'package.json': { offset: '0', size: metadata.length } } }));
  const padded = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(16 + padded);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(8 + padded, 4);
  header.writeUInt32LE(4 + padded, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  return Buffer.concat([header, metadata]);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-magpie-test-'));
}

async function removeWorkspace(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^antigravity-magpie-test-/);
  await fs.rm(resolved, { recursive: true, force: true });
}

test('Magpie shows the real ASAR versions and downloads the latest release without touching the client', async t => {
  const workspaceDir = await tempWorkspace();
  const resources = path.join(workspaceDir, 'client', 'resources');
  const official = archive('2.33.0');
  const patch = archive('2.32.2');
  const asarPath = path.join(resources, 'app.asar');
  await fs.mkdir(resources, { recursive: true });
  await fs.writeFile(asarPath, official);

  const downloadPath = `/${repo}/releases/download/v2.33.0/app.asar.ready`;
  const upstream = http.createServer((req, res) => {
    if (req.url === `/repos/${repo}/releases/latest`) {
      return res.end(JSON.stringify({
        id: 123, tag_name: 'v2.33.0',
        assets: [{
          name: 'app.asar.ready', size: patch.length,
          digest: 'sha256:' + crypto.createHash('sha256').update(patch).digest('hex'),
          browser_download_url: 'https://github.com' + downloadPath,
        }],
      }));
    }
    if (req.url === downloadPath) return res.end(patch);
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);
  const releaseManager = createReleaseManager({
    workspaceDir,
    request(url, options, callback) {
      return http.request({
        host: '127.0.0.1', port: upstreamPort, path: url.pathname, ...options,
      }, callback);
    },
  });
  const opened = [];
  const app = createControlCenter({ appDir: path.dirname(resources), workspaceDir, releaseManager,
    openFolder: async directory => { opened.push(directory); } });
  const origin = 'http://127.0.0.1:' + await listen(app);
  t.after(async () => {
    await Promise.all([close(app), close(upstream)]);
    await removeWorkspace(workspaceDir);
  });

  const page = await (await fetch(origin + '/')).text();
  const [, token] = /name="localizer-token" content="([a-f0-9]{48})"/.exec(page);
  assert.match(page, new RegExp('name="magpie-service-port" content="' + manifest.magpie.page.service.port + '"'));
  const headers = { Origin: 'null', 'X-Localizer-Token': token };
  const call = (route, method = 'GET', override = headers) => fetch(origin + '/api/' + route, { method, headers: override });
  assert.equal((await call('status', 'GET', {})).status, 403);
  assert.equal((await call('download', 'POST', { Origin: 'null' })).status, 403);
  assert.equal((await call('latest', 'GET', { ...headers, Origin: 'https://example.invalid' })).status, 403);
  const preflight = await call('download', 'OPTIONS', { Origin: 'null' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'null');
  assert.equal((await call('install', 'POST')).status, 404);

  const before = await (await call('status')).json();
  assert.equal(before.client.version, '2.33.0');
  assert.equal(before.client.isLocalized, false);
  assert.equal(before.cached, null);
  assert.equal(before.download.status, 'idle');
  assert.equal(before.folders.install.available, true);
  assert.equal(before.folders.cache.available, false);
  assert.equal((await call('open/install', 'POST', { Origin: 'null' })).status, 403);
  assert.equal((await call('open/install')).status, 405);
  assert.equal((await call('open/unknown', 'POST')).status, 404);
  assert.equal((await call('open/cache', 'POST')).status, 404);
  assert.equal((await call('open/install', 'POST')).status, 200);
  assert.deepEqual(opened, [path.dirname(resources)]);
  assert.equal((await (await call('latest')).json()).tag, 'v2.33.0');
  assert.equal((await call('download', 'POST')).status, 202);

  const deadline = Date.now() + 4000;
  let download;
  do {
    download = await (await call('download')).json();
    if (download.status !== 'downloading') break;
    await delay(20);
  } while (Date.now() < deadline);
  assert.equal(download.verified, true, download.error);
  const after = await (await call('status')).json();
  assert.equal(after.cached.version, '2.32.2');
  assert.equal(after.folders.cache.available, true);
  assert.equal((await call('open/cache', 'POST')).status, 200);
  assert.equal(opened[1], path.join(workspaceDir, 'downloads'));
  assert.equal(after.cached.matchesClient, false, 'the archive version is authoritative, not the release tag');
  assert.equal((await call('apply', 'POST')).status, 409);
  assert.deepEqual(await fs.readFile(after.cached.path), patch);
  assert.deepEqual(await fs.readFile(asarPath), official);
});

test('Magpie applies a matching cached patch and restores the original bytes offline', async t => {
  const workspaceDir = await tempWorkspace();
  const appDir = path.join(workspaceDir, 'client');
  const resources = path.join(appDir, 'resources');
  const installed = path.join(resources, 'app.asar');
  const downloads = path.join(workspaceDir, 'downloads');
  const official = archive('2.33.0');
  const patch = Buffer.concat([official, Buffer.from('menuTranslationMap')]);
  await fs.mkdir(resources, { recursive: true });
  await fs.mkdir(downloads);
  await fs.writeFile(installed, official);
  const cached = { cacheId: 'matching', path: path.join(downloads, 'patch'), tag: 'v2.33.0',
    sha256: crypto.createHash('sha256').update(patch).digest('hex') };
  await fs.writeFile(cached.path, patch);
  const other = { cacheId: 'other', path: path.join(downloads, 'newer'), tag: 'v2.34.0' };
  await fs.writeFile(other.path, archive('2.34.0'));
  let running = true;
  const token = 'a'.repeat(48);
  const server = createControlCenter({ workspaceDir, appDir, token, isAppRunning: () => running,
    releaseManager: {
      listFiles: async () => [other, cached],
      getDownload: () => ({ status: 'idle' }),
      withCachedFile: async (id, use) => {
        assert.equal(id, cached.cacheId);
        return use(cached);
      },
    },
  });
  t.after(async () => { await close(server); await removeWorkspace(workspaceDir); });
  const origin = 'http://127.0.0.1:' + await listen(server);
  const post = (action, credential = token) => fetch(origin + '/api/' + action, {
    method: 'POST', headers: { Origin: 'null', 'X-Localizer-Token': credential },
  });
  assert.equal((await post('apply', '')).status, 403);
  assert.equal((await post('apply')).status, 409);
  assert.deepEqual(await fs.readFile(installed), official);
  running = false;
  const applied = await post('apply');
  const state = await applied.json();
  assert.equal(applied.status, 200, state.error);
  assert.equal(state.client.isLocalized, true);
  assert.equal(state.client.hasBackup, true);
  assert.deepEqual(await fs.readFile(installed), patch);
  running = true;
  assert.equal((await post('restore')).status, 409);
  assert.deepEqual(await fs.readFile(installed), patch);
  running = false;
  const restored = await post('restore');
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).client.isLocalized, false);
  assert.deepEqual(await fs.readFile(installed), official);
  assert.deepEqual(await fs.readFile(cached.path), patch);
  assert.equal((await post('apply')).status, 200);
  const backup = (await fs.readdir(resources)).find(name => name.startsWith('app.asar.backup-'));
  await fs.unlink(path.join(resources, backup));
  assert.equal((await post('restore')).status, 409);
  assert.deepEqual(await fs.readFile(installed), patch);
});

test('restore rejects a concurrent CLI writer and preserves an intervening official update', async t => {
  const appDir = await tempWorkspace();
  t.after(() => removeWorkspace(appDir));
  const resources = path.join(appDir, 'resources');
  const target = path.join(resources, 'app.asar');
  const official = archive('2.33.0');
  const updated = archive('2.34.0');
  await fs.mkdir(resources);
  await fs.writeFile(path.join(resources, 'app.asar.bak'), official);
  await fs.writeFile(target, Buffer.concat([official, Buffer.from('menuTranslationMap')]));

  // 父进程已经选好了备份。另一个进程走相同的 CLI/HTTP 还原入口，必须收到冲突。
  const cli = `require('./localize').runRestoreWorkflow(process.argv[1], {
    forceStop: false, isAppRunning: () => false
  }).catch(e => { console.log(e.statusCode); process.exitCode = e.statusCode === 409 ? 0 : 1; })`;
  let checks = 0;
  await assert.rejects(runRestoreWorkflow(appDir, {
    forceStop: false,
    async isAppRunning() {
      if (++checks === 1) {
        const { stdout } = await execFile(process.execPath, ['-e', cli, appDir], {
          cwd: path.resolve(__dirname, '..'), windowsHide: true,
        });
        assert.match(stdout, /409/);
      } else {
        await fs.writeFile(target, updated);
      }
      return false;
    },
  }), { statusCode: 409 });
  assert.equal(checks, 2);
  assert.deepEqual(await fs.readFile(target), updated);
  assert.deepEqual((await fs.readdir(resources)).sort(), ['app.asar', 'app.asar.bak']);
});

test('overlapping Magpie hosts hand over the port without invalidating an open page', async t => {
  const profile = await tempWorkspace();
  const appDir = path.join(profile, 'client');
  const other = http.createServer((_req, res) => res.writeHead(204).end());
  const port = await listen(other);
  let oldHost, newHost;
  t.after(async () => {
    await close(other);
    await close(oldHost);
    await close(newHost);
    await removeWorkspace(profile);
  });

  const [token, concurrentToken] = await Promise.all([
    loadSessionToken(profile, appDir, port),
    loadSessionToken(profile, appDir, port),
  ]);
  assert.equal(token, concurrentToken);
  assert.notEqual(token, await loadSessionToken(profile, path.join(profile, 'another-client'), port));
  await assert.rejects(startControlCenter({ port, appDir }, profile), { code: 'EADDRINUSE' });
  await close(other);

  const origin = 'http://127.0.0.1:' + port;
  const call = value => fetch(origin + '/api/download', {
    headers: { Origin: 'null', 'X-Localizer-Token': value },
  });
  oldHost = await startControlCenter({ port, appDir }, profile);
  const page = await (await fetch(origin + '/')).text();
  const [, openPageToken] = /name="localizer-token" content="([a-f0-9]{48})"/.exec(page);
  assert.equal(openPageToken, token);
  assert.equal((await call(openPageToken)).status, 200);

  newHost = await startControlCenter({ port, appDir }, profile);
  assert.equal(newHost.listening, false);
  await close(oldHost);
  const deadline = Date.now() + 4000;
  while (!newHost.listening && Date.now() < deadline) await delay(50);
  assert.equal(newHost.listening, true);
  assert.equal((await call(openPageToken)).status, 200);
  assert.equal((await call('0'.repeat(48))).status, 403);
});

test('an open page retries a reset connection and resumes its download when the host reloads', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, { hidden: true, disabled: true, removeAttribute(name) { delete this[name]; } });
    }
    return elements.get(id);
  };
  const window = {};
  let latestAttempts = 0;
  let pendingLatest;
  let starts = 0;
  let applyAttempts = 0;
  let polls = 0;
  const document = {
    getElementById: element,
    querySelector: () => ({ content: '1'.repeat(48) }),
    documentElement: { dataset: {} },
  };
  const state = {
    client: { version: '2.33.0', isInstalled: true, isLocalized: false, path: '' },
    cached: null,
    download: { status: 'idle' },
  };
  const script = await fs.readFile(path.join(__dirname, '../integrations/magpie/page/app.js'), 'utf8');
  vm.runInNewContext(script, {
    document, window, parent: window, location: { href: 'http://127.0.0.1:33883/', hash: '' },
    URL, URLSearchParams, AbortSignal,
    matchMedia: () => ({ matches: false }),
    setTimeout: callback => setImmediate(callback),
    async fetch(url, options) {
      switch (url.pathname) {
        case '/api/status': return new Response(JSON.stringify(state));
        case '/api/latest':
          if (++latestAttempts === 1) throw new TypeError('connection reset');
          if (latestAttempts === 3) return new Promise(resolve => { pendingLatest = resolve; });
          return new Response(JSON.stringify({ tag: 'v2.33.0', size: 1 }));
        case '/api/apply':
          if (++applyAttempts === 1) return new Response(JSON.stringify({ error: '请先退出客户端' }), { status: 409 });
          if (applyAttempts === 2) {
            state.client.isLocalized = true;
            state.client.hasBackup = true;
            return new Response(JSON.stringify(state));
          }
          throw new TypeError('connection reset');
        case '/api/restore':
          state.client.isLocalized = false;
          return new Response(JSON.stringify(state));
        case '/api/download':
          if (options.method === 'POST') {
            starts++;
            return new Response(JSON.stringify({ status: 'downloading' }), { status: 202 });
          }
          if (++polls === 1) return new Response(JSON.stringify({ status: 'idle' }));
          state.cached = { tag: 'v2.33.0', version: '2.33.0', matchesClient: true };
          return new Response(JSON.stringify({ status: 'completed', verified: true }));
        default: throw new Error('Unexpected URL: ' + url.pathname);
      }
    },
  });

  const deadline = Date.now() + 1000;
  while (element('download').disabled && Date.now() < deadline) await delay(10);
  assert.equal(element('download').disabled, false);
  assert.equal(latestAttempts, 2);
  assert.equal(element('download').className, 'primary');
  assert.match(element('apply-hint').textContent, /首次使用/);
  assert.equal(element('apply').disabled, true);
  assert.equal(element('reconnect').hidden, true);
  await element('download').onclick();
  assert.equal(starts, 2);
  assert.equal(element('status').textContent, '下载完成，SHA-256 校验通过');
  assert.equal(element('reconnect').hidden, true);
  assert.equal(element('apply').className, 'primary');
  assert.equal(element('download').textContent, '重新下载');
  assert.equal(element('apply').disabled, false);
  assert.equal(element('restore').disabled, true);
  await element('refresh').onclick();
  assert.ok(pendingLatest);
  assert.equal(element('apply').disabled, false, 'local operations must not wait for GitHub');
  assert.equal(element('download').disabled, true);
  let open = false;
  element('confirm-action').showModal = () => { open = true; };
  element('confirm-action').close = () => { open = false; };
  element('apply').onclick();
  assert.equal(open, true);
  element('cancel-action').onclick();
  assert.equal(open, false);
  assert.equal(applyAttempts, 0);
  element('apply').onclick();
  await element('accept-action').onclick();
  assert.equal(element('status').textContent, '请先退出客户端');
  element('apply').onclick();
  await element('accept-action').onclick();
  assert.equal(element('restore').className, 'primary');
  assert.equal(element('apply').disabled, true);
  pendingLatest(new Response(JSON.stringify({ error: 'GitHub 请求超时' }), { status: 503 }));
  await delay(5);
  assert.equal(element('restore').disabled, false);
  assert.equal(element('restore').className, 'primary', 'a late reply must not restore stale client state');
  assert.match(element('release-detail').textContent, /超时/);
  element('restore').onclick();
  await element('accept-action').onclick();
  assert.equal(element('apply').className, 'primary');
  assert.equal(element('apply').disabled, false);
  element('apply').onclick();
  await element('accept-action').onclick();
  assert.equal(applyAttempts, 3, 'a lost reply must not replay an installation');
  assert.equal(element('reconnect').hidden, false);
});
