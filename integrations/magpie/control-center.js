'use strict';

const http = require('http');
const path = require('path');
const { readFile, stat } = require('fs').promises;
const { homedir } = require('os');
const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const { createReleaseManager } = require('../../release-manager');
const { checkClientStatus, normalizeVersion } = require('../../auto-restore');
const { readAsarPackageVersion } = require('../../asar-version');
const { getAppDir, getResourcesDir, runRestoreWorkflow, writeLock } = require('../../localize');
const { createPackageInstaller } = require('../../package-installer');
const { isAppRunningStrict } = require('../../process-check');
const { httpError, safeEqualToken, verifySameOriginAndToken } = require('../../src/http-security');
const { loadSessionToken, sessionFingerprint } = require('./session-state');
const { service } = require('./package.json').magpie.page;

const workspace = path.join(__dirname, '..', '..', 'work', 'magpie');
const folderNames = ['cache', 'install', 'config', 'agent'];
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/icon.png', ['icon.png', 'image/png']],
]);
const apiMethods = new Map([
  ['/api/status', 'GET'],
  ['/api/latest', 'GET'],
  ['/api/download', 'GET, POST'],
  ['/api/apply', 'POST'],
  ['/api/restore', 'POST'],
  ...folderNames.map(name => ['/api/open/' + name, 'POST']),
]);

function clientConfigDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'Antigravity');
  }
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Antigravity');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'Antigravity');
}

async function directoryExists(directory) {
  return stat(directory).then(info => info.isDirectory(), () => false);
}

function openSystemFolder(directory) {
  const program = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'explorer.exe')
    : process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(program, [directory], { stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(httpError('无法启动系统文件管理器', 503)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

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
  workspaceDir = workspace,
  releaseManager = createReleaseManager({ workspaceDir }),
  isAppRunning = isAppRunningStrict,
  openFolder = openSystemFolder,
  token = randomBytes(24).toString('hex'),
} = {}) {
  const fingerprint = sessionFingerprint(token);
  const folderPaths = {
    cache: path.resolve(workspaceDir, 'downloads'),
    install: path.resolve(appDir),
    config: clientConfigDir(),
    agent: path.join(homedir(), '.gemini', 'antigravity'),
  };
  const installer = createPackageInstaller({
    workspaceDir, releaseManager, getAppDir: () => appDir, getResourcesDir, isAppRunning, writeLock,
  });
  const server = http.createServer((req, res) => {
    route(req, res).catch(error => {
      if (!res.destroyed && !res.writableEnded) sendJson(res, error.statusCode || 500, {
        error: error.statusCode ? error.message : '本机操作失败，请检查文件和进程访问权限',
      });
    });
  });

  async function status() {
    const client = await checkClientStatus({ appDir, getResourcesDir });
    let cached = null;
    for (const file of await releaseManager.listFiles()) {
      const version = file.modified ? null : readAsarPackageVersion(file.path);
      const matchesClient = Boolean(version && normalizeVersion(version) === normalizeVersion(client.appVersion));
      if (!cached || matchesClient) {
        cached = { cacheId: file.cacheId, tag: file.tag, path: file.path, version, modified: file.modified, matchesClient };
      }
      if (matchesClient) break;
    }
    return {
      client: {
        isInstalled: client.isInstalled,
        isLocalized: client.isLocalized,
        hasBackup: client.hasBackup,
        version: client.appVersion,
        path: client.appDir,
      },
      cached: cached || null,
      folders: Object.fromEntries(await Promise.all(folderNames.map(async name => [
        name, { path: folderPaths[name], available: await directoryExists(folderPaths[name]) },
      ]))),
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

    if (req.method === 'HEAD' && req.url === '/') {
      res.writeHead(204, { 'X-Localizer-Session': fingerprint });
      return res.end();
    }

    if (req.method === 'GET' && assets.has(req.url)) {
      const [file, type] = assets.get(req.url);
      const source = await readFile(path.join(__dirname, 'page', file));
      // Magpie Web 会把 'self' 映射到它自己的插件服务路径。
      const own = "'self' " + origin;
      const csp = [
        "default-src 'none'", 'script-src ' + own, 'style-src ' + own, 'connect-src ' + own, 'img-src ' + own,
        "base-uri 'none'", "form-action 'none'",
        "frame-ancestors 'self' http://wails.localhost https://wails.localhost wails://wails.localhost wails://localhost",
      ].join('; ');
      res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': csp });
      return res.end(file === 'index.html' ? source.toString('utf8').replace('__LOCALIZER_TOKEN__', token) : source);
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
    if (req.url.startsWith('/api/open/')) {
      const directory = folderPaths[req.url.slice('/api/open/'.length)];
      if (!await directoryExists(directory)) throw httpError('目录尚未创建或无法访问，请刷新后重试', 404);
      await openFolder(directory);
      return sendJson(res, 200, { opened: true });
    }
    if (req.url === '/api/apply') {
      const { client, cached } = await status();
      if (client.isLocalized) throw httpError('客户端已汉化', 409);
      if (!cached?.matchesClient) throw httpError('请先下载与本机客户端版本匹配的汉化包', 409);
      await installer.installCached({ cacheId: cached.cacheId, forceStop: false });
      return sendJson(res, 200, await status());
    }
    if (req.url === '/api/restore') {
      const client = await checkClientStatus({ appDir, getResourcesDir });
      if (!client.isLocalized) throw httpError('当前客户端未加载汉化', 409);
      if (!client.appVersion || !client.hasBackup) throw httpError('未找到与当前客户端版本匹配的原版备份', 409);
      await runRestoreWorkflow(appDir, { forceStop: false, isAppRunning });
      return sendJson(res, 200, await status());
    }
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

async function startControlCenter({ port, appDir } = {}, profileDirectory) {
  const selectedPort = portOption(port);
  const directory = getAppDir('', !appDir, appDir);
  const token = await loadSessionToken(profileDirectory, directory, selectedPort);
  const fingerprint = sessionFingerprint(token);
  const server = createControlCenter({ appDir: directory, token });

  function listen() {
    return new Promise((resolve, reject) => {
      const failed = error => {
        server.off('error', failed);
        server.off('listening', listening);
        reject(error);
      };
      const listening = () => {
        server.off('error', failed);
        resolve();
      };
      server.once('error', failed);
      server.once('listening', listening);
      try { server.listen(selectedPort, '127.0.0.1'); }
      catch (error) { failed(error); }
    });
  }

  async function bind() {
    try {
      await listen();
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      const response = await fetch('http://127.0.0.1:' + selectedPort + '/', {
        method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(800),
      }).catch(() => null);
      if (!response) {
        // 旧宿主可能恰好在端口探测前退出。
        return listen();
      }
      if (!safeEqualToken(response.headers.get('x-localizer-session'), fingerprint)) throw error;
      setTimeout(() => {
        void bind().catch(failure => console.warn('Antigravity 汉化服务无法接管端口：' + failure.message));
      }, 350).unref();
    }
  }

  await bind();
  return server;
}

module.exports = { createControlCenter, startControlCenter };
