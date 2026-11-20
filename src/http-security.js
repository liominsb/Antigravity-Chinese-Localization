'use strict';

const crypto = require('crypto');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeEqualToken(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || !expected) return false;
  const bufA = Buffer.from(supplied, 'utf8');
  const bufB = Buffer.from(expected, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 安全解析并校验 HTTP Host 请求头是否属于本机回环地址（防止畸形 Host 触发 ERR_INVALID_URL 崩服及 DNS Rebinding）。
 */
function isValidLoopbackHostHeader(hostHeader, expectedPort) {
  if (typeof hostHeader !== 'string') return false;
  const trimmed = hostHeader.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (/[\x00-\x20\x7f/?#@\\]/.test(trimmed)) return false;

  let parsed;
  try {
    parsed = new URL(`http://${trimmed}`);
  } catch (_) {
    return false;
  }

  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return false;
  }

  if (expectedPort !== undefined && expectedPort !== null && expectedPort !== '') {
    const exp = Number(expectedPort);
    if (!Number.isInteger(exp) || exp < 1 || exp > 65535) return false;
    if (parsed.port !== '') {
      if (Number(parsed.port) !== exp) return false;
    } else {
      // 处理 http 默认端口 80 被 URL 归一化为空串的场景（如 Host: localhost:80 而 expectedPort 为 3388）
      const explicitPortMatch = !trimmed.endsWith(']') && /:(\d+)$/.exec(trimmed);
      if (explicitPortMatch && Number(explicitPortMatch[1]) !== exp) return false;
    }
  }

  return true;
}

/**
 * 统一校验本机回环 Host、同源 Origin 与可选状态变更安全令牌 x-localizer-token。
 */
function verifySameOriginAndToken(req, { securityToken, requireToken = false, expectedPort } = {}) {
  const headers = (req && req.headers) || {};
  const hostHeader = headers.host;

  if (!isValidLoopbackHostHeader(hostHeader, expectedPort)) {
    throw httpError('拒绝非本机回环 Host 请求', 403);
  }

  if (headers.origin !== undefined) {
    let sameOrigin = false;
    try {
      const scheme = req && req.socket && req.socket.encrypted ? 'https' : 'http';
      const own = new URL(`${scheme}://${hostHeader.trim()}`);
      const supplied = new URL(String(headers.origin));
      sameOrigin = LOOPBACK_HOSTS.has(own.hostname.toLowerCase()) && supplied.origin === own.origin;
    } catch (_) {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      throw httpError('操作只允许来自本机同源控制中心', 403);
    }
  }

  if (headers['sec-fetch-site'] && String(headers['sec-fetch-site']).toLowerCase() === 'cross-site') {
    throw httpError('拒绝跨站请求，操作只允许来自本机同源控制中心', 403);
  }

  if (securityToken && requireToken === true) {
    const suppliedToken = headers['x-localizer-token'];
    if (!safeEqualToken(suppliedToken, securityToken)) {
      throw httpError('安全令牌缺失或校验失败，请刷新控制中心页面后重试', 403);
    }
  }
}

/**
 * 安全读取并解析 JSON 请求体：校验 Content-Type: application/json，限制最大 16KB 防止内存耗尽。
 */
async function readJsonBody(req, { maxBytes = 16384, allowEmpty = true } = {}) {
  const headers = (req && req.headers) || {};
  const contentType = headers['content-type'] || '';
  const isJsonContentType = /^application\/json(?:\s*;|$)/i.test(contentType);

  if (!allowEmpty && !isJsonContentType) {
    throw httpError('请求必须使用 application/json', 415);
  }

  if (headers['content-length'] !== undefined) {
    const declared = Number(headers['content-length']);
    if (!Number.isFinite(declared) || declared < 0) {
      throw httpError('Content-Length 请求头无效', 400);
    }
    if (declared > maxBytes) {
      throw httpError('请求正文过大', 413);
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw httpError('请求正文过大', 413);
    }
    chunks.push(buf);
  }

  if (size === 0) {
    if (allowEmpty) return {};
    throw httpError('请求正文必须是有效 JSON 对象', 400);
  }

  if (!isJsonContentType) {
    throw httpError('请求必须使用 application/json', 415);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (allowEmpty && !raw.trim()) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw httpError('请求正文必须是有效 JSON 对象', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpError('请求正文必须是有效 JSON 对象', 400);
  }
  return parsed;
}

/**
 * 跨模块异步互斥写锁：支持串行等待执行 (runExclusive) 与非阻塞冲突快速拒绝 409 (tryRun / wait: false)。
 */
function createAsyncWriteLock() {
  let activeCount = 0;
  let currentOwner = null;
  let tail = Promise.resolve();

  function isLocked() {
    return activeCount > 0;
  }

  function acquire({
    owner = 'write-operation',
    wait = true,
    conflictMessage = '已有汉化、恢复或安装操作正在进行，请等待完成后重试'
  } = {}) {
    if (!wait && activeCount > 0) {
      return Promise.reject(httpError(conflictMessage, 409));
    }
    activeCount++;
    let releaseCurrent;
    const currentDone = new Promise(resolve => { releaseCurrent = resolve; });
    const previous = tail;
    tail = previous.then(() => currentDone);

    return previous.then(() => {
      currentOwner = owner;
      let released = false;
      return function release() {
        if (released) return;
        released = true;
        if (currentOwner === owner) currentOwner = null;
        activeCount--;
        releaseCurrent();
      };
    });
  }

  async function runExclusive(task, options = {}) {
    const wait = options.wait !== undefined ? options.wait : true;
    const release = await acquire({ ...options, wait });
    try {
      return await task();
    } finally {
      release();
    }
  }

  async function tryRun(task, options = {}) {
    return runExclusive(task, { ...options, wait: false });
  }

  return {
    isLocked,
    get currentOwner() { return currentOwner; },
    acquire,
    runExclusive,
    tryRun
  };
}

/**
 * 单段系统用户名清洗：校验字符串类型，去除首尾空白后禁止路径分隔符、..、: 与控制字符（非法抛 400）。
 */
function sanitizeSingleSegmentUsername(username, { allowEmpty = true } = {}) {
  if (typeof username !== 'string') {
    throw httpError('username 参数必须是字符串', 400);
  }
  const trimmed = username.trim();
  if (!trimmed) {
    if (allowEmpty) return '';
    throw httpError('username 不能为空', 400);
  }
  if (trimmed.length > 256 ||
      trimmed === '.' ||
      trimmed.includes('..') ||
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      trimmed.includes(':') ||
      /[\x00-\x1f\x7f]/.test(trimmed)) {
    throw httpError('username 包含非法路径字符或控制字符', 400);
  }
  return trimmed;
}

module.exports = {
  LOOPBACK_HOSTS,
  httpError,
  safeEqualToken,
  isValidLoopbackHostHeader,
  verifySameOriginAndToken,
  readJsonBody,
  createAsyncWriteLock,
  sanitizeSingleSegmentUsername
};
