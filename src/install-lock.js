'use strict';

const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const { httpError } = require('./http-security');

// 每次操作先独占创建自己的声明，再检查其他声明。两个同时到达的写入者可以
// 都返回冲突，但不能同时进入。随机文件名确保清理失效声明不会误删新持有者。
async function withInstallLock(resourcesDir, operation) {
  const prefix = '.antigravity-localizer-lock-';
  const name = prefix + process.pid + '-' + randomUUID();
  const claim = path.join(resourcesDir, name);
  await fs.writeFile(claim, '', { flag: 'wx', mode: 0o600 });
  try {
    for (const entry of await fs.readdir(resourcesDir)) {
      if (entry === name || !entry.startsWith(prefix)) continue;
      const match = /^(\d+)-[a-f0-9-]{36}$/.exec(entry.slice(prefix.length));
      if (!match) continue;
      try {
        process.kill(Number(match[1]), 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          await fs.rm(path.join(resourcesDir, entry), { force: true });
          continue;
        }
        if (error.code !== 'EPERM') throw error;
      }
      throw httpError('此安装目录正在被另一个汉化或还原任务使用，请稍后重试', 409);
    }
    return await operation();
  } finally {
    await fs.unlink(claim);
  }
}

module.exports = { withInstallLock };
