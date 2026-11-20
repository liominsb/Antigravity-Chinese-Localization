'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { setTimeout: delay } = require('timers/promises');
const { createReleaseManager } = require('../release-manager');
const { createControlCenter } = require('../integrations/magpie/control-center');
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

test('Magpie shows the real ASAR versions and downloads the latest release without touching the client', async t => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-magpie-test-'));
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
  const app = createControlCenter({ appDir: path.dirname(resources), releaseManager });
  const origin = 'http://127.0.0.1:' + await listen(app);
  t.after(async () => {
    for (const server of [app, upstream]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    const resolved = path.resolve(workspaceDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^antigravity-magpie-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
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
  assert.equal(after.cached.matchesClient, false, 'the archive version is authoritative, not the release tag');
  assert.deepEqual(await fs.readFile(after.cached.path), patch);
  assert.deepEqual(await fs.readFile(asarPath), official);
});
