'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');
const { isLocalizedAsar } = require('../auto-restore');

const ROOT_DIR = path.resolve(__dirname, '..');
const readyAsarPath = path.join(ROOT_DIR, 'app.asar.ready');
const localizeSource = fs.readFileSync(path.join(ROOT_DIR, 'localize.js'), 'utf-8');

function extractFileFromAsar(asarPath, relPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const pre = Buffer.alloc(16);
    fs.readSync(fd, pre, 0, 16, 0);
    const headerSize = pre.readUInt32LE(4);
    const jsonLen = pre.readUInt32LE(12);
    const headerBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, headerBuf, 0, jsonLen, 16);
    const header = JSON.parse(headerBuf.toString('utf-8'));
    const baseOffset = 8 + headerSize;
    const segments = relPath.split('/').filter(Boolean);
    let node = header;
    for (const seg of segments) {
      assert.ok(node && node.files && node.files[seg], `ASAR missing path segment "${seg}" in "${relPath}"`);
      node = node.files[seg];
    }
    const size = Number(node.size);
    const offset = baseOffset + Number(node.offset);
    const out = Buffer.alloc(size);
    fs.readSync(fd, out, 0, size, offset);
    return out.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

console.log('=== 开始 app.asar.ready 预编译包完整性与规格验收 ===\n');

assert.ok(fs.existsSync(readyAsarPath), '未找到 app.asar.ready');
const stat = fs.statSync(readyAsarPath);
console.log(`1. 文件体积: ${stat.size} 字节 (${(stat.size / 1024 / 1024).toFixed(2)} MiB)`);
assert.ok(stat.size > 3 * 1024 * 1024 && stat.size < 10 * 1024 * 1024, `app.asar.ready 体积异常 (${stat.size})，应符合轻量级规范 (<10 MiB)`);

const versionMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
assert.ok(versionMatch, '未能在 localize.js 中读取 CURRENT_VERSION');
const asarVer = readAsarPackageVersion(readyAsarPath);
console.log(`2. 归档包版本: ${asarVer} (预期 CURRENT_VERSION: ${versionMatch[1]})`);
assert.strictEqual(asarVer, versionMatch[1], 'app.asar.ready 内部 package.json 版本必须与 CURRENT_VERSION 一致');

const localized = isLocalizedAsar(readyAsarPath);
console.log(`3. isLocalizedAsar 指纹识别: ${localized}`);
assert.strictEqual(localized, true, 'isLocalizedAsar(app.asar.ready) 必须返回 true');

const preloadStr = extractFileFromAsar(readyAsarPath, 'dist/preload.js');
const wizardPreloadStr = extractFileFromAsar(readyAsarPath, 'dist/ideInstall/wizardPreload.js');
const menuStr = extractFileFromAsar(readyAsarPath, 'dist/menu.js');
const ipcStr = extractFileFromAsar(readyAsarPath, 'dist/ipcHandlers.js');
const trayStr = extractFileFromAsar(readyAsarPath, 'dist/tray.js');
const updaterStr = extractFileFromAsar(readyAsarPath, 'dist/updater.js');

assert.ok(preloadStr.includes('// Antigravity 2.0 Chinese Localization Engine'), 'dist/preload.js 缺少 DOM 汉化引擎注入标记');
assert.ok(wizardPreloadStr.includes('// Antigravity 2.0 Chinese Localization Engine'), 'dist/ideInstall/wizardPreload.js 缺少 DOM 汉化引擎注入标记');
assert.ok(menuStr.includes('const menuTranslationMap = {'), 'dist/menu.js 缺少原生菜单翻译映射');
assert.ok(ipcStr.includes('const contextMenuTranslationMap = {'), 'dist/ipcHandlers.js 缺少原生右键菜单翻译映射');
assert.ok(trayStr.includes('退出'), 'dist/tray.js 缺少系统托盘汉化文案');
assert.ok(updaterStr.includes('检查更新') && updaterStr.includes('重启以应用更新'), 'dist/updater.js 缺少更新菜单状态机汉化映射');

console.log('\n验收 100% 通过：app.asar.ready 版本、轻量体积与核心汉化注入层全部完整有效！');
