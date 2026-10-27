'use strict';

// 发布打包器：生成 Release 用的 default.zip。
//
// 背景：app.asar.ready 是构建产物，被 .gitignore 的 `app.asar*` 排除，
// 因此 git clone / GitHub "Download ZIP" 拿到的源码包永远不含它。
// 本脚本在打包时把根目录已构建好的 app.asar.ready 一并塞进 default.zip，
// 保证用户下载解压后，双击 bat 就能直接安装（含无 Node 的纯批处理分支）。
//
// 用法：
//   node build-release-zip.js                  # 自动读取 app.asar.ready 内版本号
//   node build-release-zip.js --version 2.26.0 # 强校验版本，不一致直接失败
//   node build-release-zip.js --out some.zip
//
// 零第三方依赖，只用 Node 内置模块。

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const https = require('https');
const { readAsarPackageVersion } = require('./asar-version');
const { makeCacheId, CACHE_ID_PATTERN } = require('./release-manager');

const WORKSPACE = __dirname;
const READY_NAME = 'app.asar.ready';
const DEFAULT_OUT = path.join(WORKSPACE, 'release-assets', 'default.zip');
const MAX_ENTRIES = 60000;
const MAX_ENTRY_BYTES = 0x7fffffff;
const REPOSITORY = 'liominsb/Antigravity-Chinese-Localization';
const CACHE_META_NAME = 'download.json';

// 打进包里的根级文件（与历史 default.zip 对齐，避免误带 downloads/ 缓存或 .git）
const ROOT_FILES = [
  'asar-version.js',
  'auto-restore.js',
  'build-release-zip.js',
  'CHANGELOG.en.md',
  'CHANGELOG.md',
  'index.html',
  'LICENSE',
  'localize.js',
  'package-installer.js',
  'process-check.js',
  'README.en.md',
  'README.md',
  'release-manager.js',
  '一键更新汉化.bat',
  '双击运行汉化.bat',
  '运行汉化.sh'
];

// 需要整棵目录树打包的根级目录
const ROOT_DIRS = ['extracted', 'tests'];

// 递归打包时跳过的纯垃圾条目。注意：不能排除 node_modules，
// extracted/ 内的 node_modules 是解包后的官方依赖，属于发布包正常内容。
const SKIP_NAMES = new Set(['.git', '.DS_Store', 'Thumbs.db']);
const SKIP_SUFFIXES = ['.log'];

function fail(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

function parseArgs(argv) {
  const options = { version: '', out: DEFAULT_OUT, tag: '', releaseId: 0, preloadCache: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version') {
      options.version = String(argv[++i] || '').trim().replace(/^[vV]/, '');
      if (!options.version) throw fail('--version 需要指定版本号，例如 --version 2.26.0');
    } else if (arg === '--tag') {
      options.tag = String(argv[++i] || '').trim();
      if (!options.tag) throw fail('--tag 需要指定 Release 标签，例如 --tag v2.26.0');
    } else if (arg === '--release-id') {
      const raw = String(argv[++i] || '').trim();
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) throw fail('--release-id 需要指定正整数，例如 --release-id 422504512');
      options.releaseId = parsed;
    } else if (arg === '--no-cache') {
      // 不预置 downloads/ 缓存，"已下载版本"列表将为空
      options.preloadCache = false;
    } else if (arg === '--out') {
      const value = argv[++i];
      if (!value) throw fail('--out 需要指定输出路径');
      options.out = path.resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw fail(`无法识别的参数: ${arg}`);
    }
  }
  return options;
}

// ---------- ZIP 写入（deflate + UTF-8 文件名标志位） ----------

const CRC_TABLE = (function buildCrcTable() {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

// ZIP 使用 MS-DOS 时间格式：日期从 1980 年起算，秒只有 2 秒精度
function toDosDateTime(date) {
  const valid = date instanceof Date && !Number.isNaN(date.getTime());
  const d = valid ? date : new Date();
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

function makeLocalHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);              // 解压所需版本 2.0
  header.writeUInt16LE(0x0800, 6);          // bit 11：文件名是 UTF-8（中文名不乱码）
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedLength, 18);
  header.writeUInt32LE(entry.length, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  header.writeUInt16LE(0, 28);              // 无 extra field
  return header;
}

function makeCentralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  // 宿主标记为 Unix (3)，版本 3.0：解压工具据此按 external attributes 高 16 位
  // 还原 Unix 权限，Linux/macOS 解压后 运行汉化.sh 才带可执行位。
  header.writeUInt16LE(0x031e, 4);
  header.writeUInt16LE(20, 6);              // 解压所需版本
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedLength, 20);
  header.writeUInt32LE(entry.length, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(0, 30);              // extra
  header.writeUInt16LE(0, 32);              // comment
  header.writeUInt16LE(0, 34);              // 起始磁盘号
  header.writeUInt16LE(0, 36);              // 内部属性
  // 高 16 位 = Unix mode，低 16 位 = MS-DOS 属性（0x10 目录 / 0x20 归档），两边都认得
  header.writeUInt32LE(entry.externalAttributes, 38);
  header.writeUInt32LE(entry.offset, 42);
  return header;
}

function makeEndOfCentralDirectory(count, size, offset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function buildZip(files) {
  if (files.length > MAX_ENTRIES) throw fail(`文件条目过多 (${files.length})，超出非 ZIP64 上限`);

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const raw = file.data;
    if (raw.length > MAX_ENTRY_BYTES) throw fail(`文件过大: ${file.name}`);

    // 目录条目：零长度 + store，仅用于解压时创建空目录
    let method = 0;
    let payload = null;
    let compressed = raw.length;
    let length = raw.length;
    let crc = 0;

    if (!file.isDir) {
      const deflated = zlib.deflateRawSync(raw, { level: 9 });
      // 压不动就退回 store，避免"压缩后更大"的无效条目
      if (deflated.length < raw.length) {
        method = 8;
        payload = deflated;
        compressed = deflated.length;
      } else {
        payload = raw;
        compressed = raw.length;
      }
      crc = crc32(raw);
      length = raw.length;
    }

    const stamps = toDosDateTime(file.mtime);
    // 按扩展名固定 Unix 权限（不读源文件 mode：Windows 上读不到有意义的值，
    // 固定规则才能让三个平台产出的包保持一致）
    const unixMode = file.isDir ? 0o040755 : (file.name.endsWith('.sh') ? 0o100755 : 0o100644);
    const entry = {
      nameBytes, method, crc, length, compressedLength: compressed,
      dosTime: stamps.time, dosDate: stamps.date, isDir: Boolean(file.isDir), offset,
      externalAttributes: ((unixMode * 0x10000) | (file.isDir ? 0x10 : 0x20)) >>> 0
    };

    const localHeader = makeLocalHeader(entry);
    locals.push(localHeader, nameBytes);
    if (payload && payload.length) locals.push(payload);
    offset += localHeader.length + nameBytes.length + (payload ? payload.length : 0);
    centrals.push(makeCentralHeader(entry), nameBytes);
  }

  const centralBuffer = Buffer.concat(centrals);
  const localBuffer = Buffer.concat(locals);
  const eocd = makeEndOfCentralDirectory(files.length, centralBuffer.length, localBuffer.length);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

// ---------- 打包后自校验：重新解析中央目录，确认文件真的进了包 ----------

function verifyZip(zipBuffer, expectations) {
  const eocdSignature = 0x06054b50;
  let eocdPos = -1;
  for (let i = zipBuffer.length - 22; i >= 0 && i >= zipBuffer.length - 22 - 0xffff; i--) {
    if (zipBuffer.readUInt32LE(i) === eocdSignature) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw fail('打包自检失败：找不到 ZIP 中央目录结束记录');

  const count = zipBuffer.readUInt16LE(eocdPos + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdPos + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdPos + 16);
  if (cdOffset + cdSize > zipBuffer.length) throw fail('打包自检失败：中央目录越界');

  const seen = new Map();
  let cursor = cdOffset;
  for (let i = 0; i < count; i++) {
    if (zipBuffer.readUInt32LE(cursor) !== 0x02014b50) throw fail('打包自检失败：中央目录条目损坏');
    const flags = zipBuffer.readUInt16LE(cursor + 8);
    const method = zipBuffer.readUInt16LE(cursor + 10);
    const crc = zipBuffer.readUInt32LE(cursor + 16);
    const compressedLength = zipBuffer.readUInt32LE(cursor + 20);
    const length = zipBuffer.readUInt32LE(cursor + 24);
    const nameLength = zipBuffer.readUInt16LE(cursor + 28);
    const externalAttributes = zipBuffer.readUInt32LE(cursor + 38);
    const localOffset = zipBuffer.readUInt32LE(cursor + 42);
    const name = zipBuffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if ((flags & 0x0800) === 0) throw fail(`打包自检失败：${name} 缺少 UTF-8 文件名标志`);
    // 跨平台闸门：反斜杠路径在 Linux/macOS 上会被当成文件名的一部分，
    // 绝对路径则有解压越界风险，两者都不允许出现在发布包里。
    if (name.includes('\\')) throw fail(`打包自检失败：${name} 使用了反斜杠路径，Linux/macOS 解压会错乱`);
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw fail(`打包自检失败：${name} 是绝对路径`);
    if (name.endsWith('.sh')) {
      const unixMode = externalAttributes >>> 16;
      if ((unixMode & 0o111) === 0) {
        throw fail(`打包自检失败：${name} 缺少可执行位，Linux/macOS 解压后无法直接运行`);
      }
    }
    if (zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) throw fail(`打包自检失败：${name} 本地头缺失`);

    seen.set(name, { crc, method, compressedLength, length, localOffset });
    cursor += 46 + nameLength;
  }

  for (const item of expectations) {
    const record = seen.get(item.name);
    if (!record) throw fail(`打包自检失败：压缩包内缺少 ${item.name}`);
    if (!item.isDir && record.length !== item.data.length) {
      throw fail(`打包自检失败：${item.name} 长度不符`);
    }
  }
  if (seen.size !== expectations.length) {
    throw fail(`打包自检失败：条目数 ${seen.size} 与预期 ${expectations.length} 不一致`);
  }
  if (count !== expectations.length) {
    throw fail(`打包自检失败：中央目录条目数 ${count} 与预期 ${expectations.length} 不一致`);
  }
  return { count, bytes: zipBuffer.length };
}

// ---------- 预置下载缓存（控制中心「已下载版本」列表的数据源） ----------

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

// 缓存目录名里必须带真实的 GitHub releaseId：控制中心的"重新下载"会用它去
// 请求对应发布，填占位值会让该入口指向不存在的版本。
function fetchReleaseId(tag, timeoutMs = 15000) {
  return new Promise(function request(resolve, reject) {
    const url = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Antigravity-Chinese-Localization-Packer',
        Accept: 'application/vnd.github+json'
      }
    }, function onResponse(res) {
      const code = res.statusCode || 0;
      if (code !== 200) {
        res.resume();
        reject(new Error(`GitHub API 返回 HTTP ${code}（tag: ${tag}）`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', function onData(chunk) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) {
          req.destroy(new Error('GitHub API 响应过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function onEnd() {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (Number.isSafeInteger(data.id) && data.id > 0) resolve(data.id);
          else reject(new Error('GitHub API 响应缺少有效 release id'));
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, function onTimeout() { req.destroy(new Error('GitHub API 请求超时')); });
  });
}

/**
 * 生成预置缓存条目：downloads/<cacheId>/app.asar.ready + download.json
 * 结构必须与 release-manager 的 listFiles/metadataFor 严格对齐，
 * 否则控制中心会把目录当成无关垃圾直接丢弃。
 */
function buildCacheEntries({ readyData, readySha256, tag, releaseId }) {
  const cacheId = makeCacheId(tag, releaseId, readySha256);
  const directory = `downloads/${cacheId}`;
  const meta = {
    format: 1,
    cacheId,
    releaseId,
    tag,
    filename: READY_NAME,
    size: readyData.length,
    sha256: readySha256,
    downloadedAt: new Date().toISOString()
  };
  const now = new Date();
  return {
    cacheId,
    meta,
    entries: [
      { name: 'downloads/', isDir: true, data: Buffer.alloc(0), mtime: now },
      { name: `${directory}/`, isDir: true, data: Buffer.alloc(0), mtime: now },
      { name: `${directory}/${READY_NAME}`, isDir: false, data: readyData, mtime: now },
      { name: `${directory}/${CACHE_META_NAME}`, isDir: false, data: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, 'utf8'), mtime: now }
    ]
  };
}

// ---------- 收集文件 ----------

async function collectFiles() {
  const files = [];

  async function addPath(absolute, relative) {
    const stat = await fsp.lstat(absolute);
    if (stat.isSymbolicLink()) return; // 不跟随软链接，避免把外部文件带进发布包
    if (stat.isDirectory()) {
      files.push({ name: `${relative}/`, isDir: true, data: Buffer.alloc(0), mtime: stat.mtime });
      const entries = await fsp.readdir(absolute, { withFileTypes: true });
      entries.sort(function byName(a, b) { return a.name.localeCompare(b.name, 'en'); });
      for (const entry of entries) {
        if (SKIP_NAMES.has(entry.name)) continue;
        if (SKIP_SUFFIXES.some(function matchSuffix(suffix) { return entry.name.endsWith(suffix); })) continue;
        await addPath(path.join(absolute, entry.name), `${relative}/${entry.name}`);
      }
      return;
    }
    if (!stat.isFile()) return;
    files.push({ name: relative, isDir: false, data: await fsp.readFile(absolute), mtime: stat.mtime });
  }

  for (const name of ROOT_FILES) {
    const absolute = path.join(WORKSPACE, name);
    if (!fs.existsSync(absolute)) throw fail(`打包清单中的文件不存在: ${name}`);
    await addPath(absolute, name);
  }
  for (const name of ROOT_DIRS) {
    const absolute = path.join(WORKSPACE, name);
    if (!fs.existsSync(absolute)) throw fail(`打包清单中的目录不存在: ${name}`);
    await addPath(absolute, name);
  }
  return files;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法: node build-release-zip.js [--version 2.26.0] [--tag v2.26.0] [--release-id 422504512] [--no-cache] [--out 路径]');
    return 0;
  }

  const readyPath = path.join(WORKSPACE, READY_NAME);
  if (!fs.existsSync(readyPath)) {
    throw fail(`根目录缺少 ${READY_NAME}。请先构建汉化包再打包，否则用户下载后无法一键安装。`);
  }

  const readyStat = await fsp.stat(readyPath);
  if (!readyStat.isFile() || readyStat.size <= 0) throw fail(`${READY_NAME} 不是有效文件`);

  const readyVersion = readAsarPackageVersion(readyPath);
  if (!readyVersion) throw fail(`无法从 ${READY_NAME} 读取 package.json 版本，包可能损坏`);

  if (options.version && options.version !== readyVersion) {
    throw fail(`版本不一致：参数指定 v${options.version}，但 ${READY_NAME} 实际是 v${readyVersion}`);
  }

  console.log('=======================================================');
  console.log('  Antigravity 汉化发布打包器 (default.zip)');
  console.log('=======================================================');
  console.log(`就绪包版本  : v${readyVersion}`);
  console.log(`就绪包体积  : ${(readyStat.size / 1024 / 1024).toFixed(2)} MB`);

  const readyData = await fsp.readFile(readyPath);
  const files = await collectFiles();

  // 就绪包始终排在最后追加，保证清单里显式存在、且不会被排除规则漏掉
  files.push({
    name: READY_NAME,
    isDir: false,
    data: readyData,
    mtime: readyStat.mtime
  });

  // 预置 downloads/ 缓存，让解压后控制中心的「已下载版本」直接列出本版本
  let cacheInfo = null;
  if (options.preloadCache) {
    const tag = options.tag || `v${readyVersion}`;
    const readySha256 = await hashFile(readyPath);
    let releaseId = options.releaseId;
    if (!releaseId) {
      process.stdout.write(`查询 Release ID: ${tag} ... `);
      try {
        releaseId = await fetchReleaseId(tag);
        console.log(`id=${releaseId}`);
      } catch (error) {
        console.log('失败');
        throw fail(
          `无法从 GitHub 获取 ${tag} 的 release id（${error.message}）。\n` +
          '可通过 --release-id <id> 手动指定，或加 --no-cache 跳过预置下载缓存。'
        );
      }
    } else {
      console.log(`Release ID  : ${releaseId}（手动指定）`);
    }

    cacheInfo = buildCacheEntries({ readyData, readySha256, tag, releaseId });
    if (!CACHE_ID_PATTERN.test(cacheInfo.cacheId)) {
      throw fail(`生成的缓存目录名不符合控制中心规则: ${cacheInfo.cacheId}`);
    }
    files.push(...cacheInfo.entries);
  }

  const zipBuffer = buildZip(files);
  const summary = verifyZip(zipBuffer, files);

  await fsp.mkdir(path.dirname(options.out), { recursive: true });
  const tempPath = `${options.out}.part`;
  await fsp.writeFile(tempPath, zipBuffer);
  await fsp.rename(tempPath, options.out);

  const readyEntry = files.find(function findReady(file) { return file.name === READY_NAME; });
  console.log(`打包文件数  : ${summary.count}`);
  console.log(`输出路径    : ${options.out}`);
  console.log(`输出体积    : ${(summary.bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`内置 ready  : 是 (${readyEntry.data.length} 字节, v${readyVersion})`);
  if (cacheInfo) {
    console.log(`预置缓存    : ${cacheInfo.cacheId}`);
    console.log(`              「已下载版本」将直接列出 ${cacheInfo.meta.tag}`);
  } else {
    console.log('预置缓存    : 已跳过（--no-cache）');
  }
  console.log('\n[成功] default.zip 已生成，解压后双击 bat 即可离线安装。');
  return 0;
}

if (require.main === module) {
  main().then(function done(code) {
    process.exit(code || 0);
  }).catch(function onError(error) {
    console.error(`\n[失败] ${error.userFacing ? error.message : (error.stack || error.message)}`);
    process.exit(1);
  });
}

module.exports = { buildZip, verifyZip, crc32, collectFiles, buildCacheEntries, hashFile, fetchReleaseId };
