'use strict';

const path = require('path');
const fs = require('fs').promises;
const { createHash, randomBytes } = require('crypto');

function sessionFingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function assertDirectory(directory) {
  if (!(await fs.lstat(directory)).isDirectory()) {
    throw new Error('本地会话目录无效');
  }
}

async function readToken(directory) {
  await assertDirectory(directory);
  const file = path.join(directory, 'token');
  const info = await fs.lstat(file);
  if (!info.isFile() || info.size !== 48) throw new Error('本地会话令牌无效');
  const token = await fs.readFile(file, 'utf8');
  if (!/^[0-9a-f]{48}$/.test(token)) throw new Error('本地会话令牌无效');
  return token;
}

async function loadSessionToken(profileDirectory, appDir, port) {
  if (typeof profileDirectory !== 'string' || !path.isAbsolute(profileDirectory)) {
    throw new Error('未找到 Magpie 的本地配置目录');
  }
  const root = path.join(profileDirectory, 'antigravity-localization');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await assertDirectory(root);
  const session = path.join(root, sessionFingerprint(JSON.stringify([__dirname, appDir, port])).slice(0, 32));
  try {
    return await readToken(session);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // 整个目录一次发布，重叠启动的宿主会读取同一份完整令牌。
  const stage = await fs.mkdtemp(path.join(root, 'session-'));
  const stagedFile = path.join(stage, 'token');
  const token = randomBytes(24).toString('hex');
  try {
    await fs.writeFile(stagedFile, token, { flag: 'wx', mode: 0o600 });
    try {
      await fs.rename(stage, session);
      return token;
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      return await readToken(session);
    }
  } finally {
    await fs.unlink(stagedFile).catch(() => {});
    await fs.rmdir(stage).catch(() => {});
  }
}

module.exports = { loadSessionToken, sessionFingerprint };
