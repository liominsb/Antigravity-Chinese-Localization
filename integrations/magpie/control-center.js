'use strict';

const http = require('http');
const path = require('path');
const { readFile } = require('fs').promises;
const { randomBytes } = require('crypto');
const { createReleaseManager } = require('../../release-manager');
const { checkClientStatus, normalizeVersion } = require('../../auto-restore');
const { readAsarPackageVersion } = require('../../asar-version');
const { getAppDir, getResourcesDir } = require('../../localize');
const { httpError, safeEqualToken, verifySameOriginAndToken } = require('../../src/http-security');
const { service } = require('./package.json').magpie.page;

const workspace = path.join(__dirname, '..', '..', 'work', 'magpie');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const apiMethods = new Map([
  ['/api/status', 'GET'],
  ['/api/latest', 'GET'],
  ['/api/download', 'GET, POST'],
]);

function portOption(value) {
  const port = typeof value === 'number' || (typeof value === 'string' && /^\+?\d+$/.test(value.trim()))
    ? Number(value) : 0;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : service.port;
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function createControlCenter({
  appDir = getAppDir('', true),
  releaseManager = createReleaseManager({ workspaceDir: workspace }),
} = {}) {
  const token = randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    route(req, res).catch(error => {
      if (!res.destroyed && !res.writableEnded) sendJson(res, error.statusCode || 500, {
        error: error.statusCode ? error.message : '无法读取本机状态或下载缓存',
      });
    });
  });

  async function status() {
    const client = await checkClientStatus({ appDir, getResourcesDir });
    const [file] = await releaseManager.listFiles();
    const cached = file && {
      tag: file.tag,
      path: file.path,
      version: file.modified ? null : readAsarPackageVersion(file.path),
      modified: file.modified,
    };
    if (cached) {
      cached.matchesClient = Boolean(cached.version && client.appVersion &&
        normalizeVersion(cached.version) === normalizeVersion(client.appVersion));
    }
    return {
      client: {
        isInstalled: client.isInstalled,
        isLocalized: client.isLocalized,
        version: client.appVersion,
        path: client.appDir,
      },
      cached: cached || null,
      download: releaseManager.getDownload(),
    };
  }

  async function route(req, res) {
    const port = server.address().port;
    const host = '127.0.0.1:' + port;
    const origin = 'http://' + host;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== host) throw httpError('仅允许本机回环请求', 403);

    if (req.method === 'GET' && assets.has(req.url)) {
      const [file, type] = assets.get(req.url);
      const source = await readFile(path.join(__dirname, 'page', file), 'utf8');
      // Magpie Web 会把 'self' 映射到它自己的插件服务路径。
      const own = "'self' " + origin;
      const csp = [
        "default-src 'none'", 'script-src ' + own, 'style-src ' + own, 'connect-src ' + own,
        "base-uri 'none'", "form-action 'none'",
        "frame-ancestors 'self' http://wails.localhost https://wails.localhost wails://wails.localhost wails://localhost",
      ].join('; ');
      res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': csp });
      return res.end(file === 'index.html' ? source.replace('__LOCALIZER_TOKEN__', token) : source);
    }

    const allowed = apiMethods.get(req.url);
    if (!allowed) throw httpError('接口不存在', 404);
    if (req.headers.origin === 'null') {
      // Magpie 的脚本沙箱使用不透明 Origin。只有持有当前页面令牌的请求可读写。
      res.setHeader('Access-Control-Allow-Origin', 'null');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': allowed,
          'Access-Control-Allow-Headers': 'x-localizer-token',
        });
        return res.end();
      }
      if (!safeEqualToken(req.headers['x-localizer-token'], token)) {
        throw httpError('页面令牌已失效，请重新连接', 403);
      }
    } else {
      verifySameOriginAndToken(req, { securityToken: token, requireToken: true, expectedPort: port });
    }

    if (!allowed.split(', ').includes(req.method)) {
      res.setHeader('Allow', allowed);
      throw httpError('此接口不支持该请求方法', 405);
    }
    if (req.url === '/api/status') return sendJson(res, 200, await status());
    if (req.url === '/api/latest') {
      const { tag, publishedAt, asset } = await releaseManager.getLatestRelease();
      return sendJson(res, 200, { tag, publishedAt, size: asset.size });
    }
    if (req.method === 'POST') {
      return sendJson(res, 202, await releaseManager.startLatestDownload());
    }
    return sendJson(res, 200, releaseManager.getDownload());
  }
  return server;
}

async function startControlCenter({ port, appDir } = {}) {
  const selectedPort = portOption(port);
  const server = createControlCenter({ appDir: getAppDir('', !appDir, appDir) });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(selectedPort, '127.0.0.1', resolve);
  });
  return server;
}

module.exports = { createControlCenter, startControlCenter };
