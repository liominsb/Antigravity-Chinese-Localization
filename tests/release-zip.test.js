'use strict';

const assert = require('assert');
const zlib = require('zlib');
const crypto = require('crypto');
const { buildZip, verifyZip, crc32, buildCacheEntries } = require('../build-release-zip');

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    failed++;
    console.error(`  [FAIL] ${name}\n         期望: ${JSON.stringify(expected)}\n         实际: ${JSON.stringify(actual)}`);
  }
}

function throws(name, fn, matcher) {
  try {
    fn();
    failed++;
    console.error(`  [FAIL] ${name} (未抛出异常)`);
  } catch (e) {
    if (matcher && !matcher.test(e.message)) {
      failed++;
      console.error(`  [FAIL] ${name} (异常信息不匹配: ${e.message})`);
      return;
    }
    passed++;
    console.log(`  [PASS] ${name}`);
  }
}

// 解析中央目录，取出条目用于验证压缩内容与文件名编码
function readEntries(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, '应能找到 EOCD');
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const madeBy = zip.readUInt16LE(cursor + 4);
    const method = zip.readUInt16LE(cursor + 10);
    const compressedLength = zip.readUInt32LE(cursor + 20);
    const length = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const externalAttributes = zip.readUInt32LE(cursor + 38);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = zip.subarray(dataStart, dataStart + compressedLength);
    const data = method === 0 ? Buffer.from(payload) : zlib.inflateRawSync(payload);
    out.push({ name, method, length, data, madeBy, unixMode: externalAttributes >>> 16 });
    cursor += 46 + nameLength;
  }
  return out;
}

console.log('=== 发布打包器 (build-release-zip.js) 单元测试 ===\n');

console.log('[1] CRC32 标准校验值');
check('crc32("123456789") 等于 0xCBF43926', crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
check('crc32(空) 等于 0', crc32(Buffer.alloc(0)), 0);

console.log('\n[2] ZIP 结构与内容正确性');
const readyBytes = Buffer.from('fake-asar-payload-' + 'x'.repeat(4096));
const zipEntries = [
  { name: 'README.md', isDir: false, data: Buffer.from('# 标题\n中文内容'), mtime: new Date('2026-10-24T10:00:00Z') },
  { name: 'extracted/', isDir: true, data: Buffer.alloc(0), mtime: new Date('2026-10-24T10:00:00Z') },
  { name: 'extracted/main.js', isDir: false, data: Buffer.from('console.log(1)'.repeat(50)), mtime: new Date('2026-10-24T10:00:00Z') },
  { name: '一键更新汉化.bat', isDir: false, data: Buffer.from('@echo off\r\nchcp 65001\r\n'), mtime: new Date('2026-10-24T10:00:00Z') },
  { name: '运行汉化.sh', isDir: false, data: Buffer.from('#!/usr/bin/env bash\nnode localize.js\n'), mtime: new Date('2026-10-24T10:00:00Z') },
  { name: 'app.asar.ready', isDir: false, data: readyBytes, mtime: new Date('2026-10-24T10:00:00Z') }
];
const zip = buildZip(zipEntries);
const summary = verifyZip(zip, zipEntries);

check('条目数量一致', summary.count, zipEntries.length);
check('含 app.asar.ready', zip.includes(Buffer.from('app.asar.ready')), true);

const parsed = readEntries(zip);
check('解压后条目名顺序稳定', parsed.map(e => e.name), zipEntries.map(e => e.name));

const readyEntry = parsed.find(e => e.name === 'app.asar.ready');
check('app.asar.ready 内容逐字节一致', readyEntry.data.equals(readyBytes), true);
check('app.asar.ready 走了 deflate 压缩', readyEntry.method, 8);
check('app.asar.ready 未压缩长度正确', readyEntry.length, readyBytes.length);

const chineseEntry = parsed.find(e => e.name === '一键更新汉化.bat');
check('中文文件名 UTF-8 往返无损', Boolean(chineseEntry), true);
check('中文文件内容可正确解出', chineseEntry.data.toString('utf8'), '@echo off\r\nchcp 65001\r\n');

const dirEntry = parsed.find(e => e.name === 'extracted/');
check('目录条目仍被保留', Boolean(dirEntry), true);
check('目录条目长度为零', dirEntry.length, 0);

const chineseSh = parsed.find(e => e.name === '运行汉化.sh');
check('中文 sh 文件名 UTF-8 往返无损', Boolean(chineseSh), true);

console.log('\n[3] 跨平台兼容（Linux / macOS 解压）');
check('所有条目路径无反斜杠', parsed.every(e => !e.name.includes('\\')), true);
check('所有条目路径非绝对路径', parsed.every(e => !e.name.startsWith('/')), true);
check('.sh 具备可执行位 0755', (chineseSh.unixMode & 0o777).toString(8), '755');
check('普通文件为 0644', (parsed.find(e => e.name === 'README.md').unixMode & 0o777).toString(8), '644');
check('目录为 0755', (dirEntry.unixMode & 0o777).toString(8), '755');
check('宿主标记为 Unix (高字节 3)', parsed.every(e => (e.madeBy >>> 8) === 3), true);

throws('反斜杠路径会被自检拒绝', function () {
  const bad = [{ name: 'sub\\bad.js', isDir: false, data: Buffer.from('x'), mtime: new Date() }];
  verifyZip(buildZip(bad), bad);
}, /反斜杠路径/);

console.log('\n[4] 自检能拦截缺件与损坏');
throws('缺少 app.asar.ready 时自检报错', function () {
  const partial = zipEntries.slice(0, -1);
  verifyZip(buildZip(partial), zipEntries);
}, /缺少 app\.asar\.ready/);

throws('非法 ZIP（无 EOCD）自检报错', function () {
  verifyZip(Buffer.alloc(64), zipEntries);
}, /中央目录结束记录/);

console.log('\n[5] 不可压缩内容自动退回 store');
const randomish = Buffer.alloc(256);
for (let i = 0; i < randomish.length; i++) randomish[i] = (i * 73 + 11) & 0xff;
const storeZip = buildZip([{ name: 'r.bin', isDir: false, data: randomish, mtime: new Date() }]);
const storeParsed = readEntries(storeZip);
check('小文件解压内容保持一致', storeParsed[0].data.equals(randomish), true);

const stored = buildZip([{ name: 'same.bin', isDir: false, data: Buffer.from('ab'), mtime: new Date() }]);
check('压不动的文件 method 为 0 或 8 且可还原', readEntries(stored)[0].data.toString(), 'ab');

console.log('\n[6] 预置下载缓存（控制中心「已下载版本」）');
const readySha = crypto.createHash('sha256').update(readyBytes).digest('hex');
const cache = buildCacheEntries({ readyData: readyBytes, readySha256: readySha, tag: 'v2.26.0', releaseId: 1 });

check('缓存条目数量为 4（根目录 + 缓存目录 + ready + 元数据）', cache.entries.length, 4);
check('cacheId 符合控制中心命名规则', /^release-v2\.26\.0-1-[a-f0-9]{64}$/.test(cache.cacheId), true);
check('cacheId 由 makeCacheId 规则生成', cache.cacheId, `release-v2.26.0-1-${readySha}`);

const metaEntry = cache.entries.find(e => e.name.endsWith('/download.json'));
check('元数据条目存在', Boolean(metaEntry), true);
const metaParsed = JSON.parse(metaEntry.data.toString('utf8'));
check('元数据 format 为 1', metaParsed.format, 1);
check('元数据 cacheId 与目录名一致', metaParsed.cacheId, cache.cacheId);
check('元数据 releaseId 与传入的占位值一致', metaParsed.releaseId, 1);
check('元数据 tag 正确', metaParsed.tag, 'v2.26.0');
check('元数据 filename 正确', metaParsed.filename, 'app.asar.ready');
check('元数据 size 与内容一致', metaParsed.size, readyBytes.length);
check('元数据 sha256 与内容一致', metaParsed.sha256, readySha);
check('元数据 downloadedAt 是合法时间', Number.isFinite(Date.parse(metaParsed.downloadedAt)), true);

const cachedReady = cache.entries.find(e => e.name.endsWith('/app.asar.ready'));
check('缓存内 ready 与源文件逐字节一致', cachedReady.data.equals(readyBytes), true);
check('缓存内路径全部以 downloads/ 开头', cache.entries.every(e => e.name.startsWith('downloads/')), true);
check('缓存内路径无反斜杠', cache.entries.every(e => !e.name.includes('\\')), true);

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('🎉 发布打包器测试全部通过');
