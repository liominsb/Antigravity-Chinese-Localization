const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. 读取当前 localize.js 源码与 extracted/package.json
const { getCombinedSource, compareSemver } = require('./helpers/translator-loader');
const localizeSource = getCombinedSource();
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extracted', 'package.json'), 'utf-8'));

let passed = 0;
let total = 0;

function check(desc, actual, expected) {
  total++;
  try {
    assert.strictEqual(actual, expected);
    console.log(`PASS [${total}]: ${desc} => "${actual}"`);
    passed++;
  } catch (err) {
    console.error(`FAIL [${total}]: ${desc}`);
    console.error(`   期望: "${expected}"`);
    console.error(`   实际: "${actual}"`);
  }
}

console.log('=== 开始 Ticket-09 Antigravity 2.14.0 核心版本与特性专项测试 ===\n');

// 1. 版本号校验
console.log('--- 2.14.0 版本元数据校验 ---');
const versionMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
check('localize.js CURRENT_VERSION 版本号有效且 >= 2.14.0', Boolean(versionMatch && compareSemver(versionMatch[1], '2.14.0') >= 0), true);
check('extracted/package.json version 有效且 >= 2.14.0', Boolean(packageJson.version && compareSemver(packageJson.version, '2.14.0') >= 0), true);

// 2. 核心文件完备性
console.log('\n--- 核心注入文件完备性测试 ---');
const distDir = path.join(__dirname, '..', 'extracted', 'dist');
check('preload.js 存在', fs.existsSync(path.join(distDir, 'preload.js')), true);
check('wizardPreload.js 存在', fs.existsSync(path.join(distDir, 'ideInstall', 'wizardPreload.js')), true);
check('menu.js 存在', fs.existsSync(path.join(distDir, 'menu.js')), true);
check('tray.js 存在', fs.existsSync(path.join(distDir, 'tray.js')), true);
check('loadingOverlay.js 存在', fs.existsSync(path.join(distDir, 'loadingOverlay.js')), true);

// 3. 原生菜单映射校验
console.log('\n--- 原生菜单分屏与派生映射测试 ---');
const menuSource = fs.readFileSync(path.join(distDir, 'menu.js'), 'utf-8');
check('menu.js 包含 Split 汉化映射', menuSource.includes("'Split': '分屏'"), true);
check('menu.js 包含 Split Right 汉化映射', menuSource.includes("'Split Right': '向右分屏'"), true);
check('menu.js 包含 Split Down 汉化映射', menuSource.includes("'Split Down': '向下分屏'"), true);
check('menu.js 包含 Replace With New 汉化映射', menuSource.includes("'Replace With New': '替换为新建'"), true);
check('menu.js 包含 Remove From Split 汉化映射', menuSource.includes("'Remove From Split': '从分屏中移除'"), true);
check('menu.js 包含 Fork 汉化映射', menuSource.includes("'Fork': '派生'"), true);

// 4. 远程控制 (Remote Control) 汉化校验
console.log('\n--- 远程控制 (Remote Control) 汉化校验 ---');
const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');
check('preload.js 包含 Open in Remote Control 汉化', preloadSource.includes('"Open in Remote Control": "在远程控制中打开"'), true);
check('preload.js 包含 Continue your work 汉化', preloadSource.includes('借助远程控制从另一台设备继续工作'), true);
check('localize.js 包含 Open in Remote Control 汉化', localizeSource.includes('"Open in Remote Control": "在远程控制中打开"'), true);
check('localize.js 包含 Continue your work 汉化', localizeSource.includes('借助远程控制从另一台设备继续工作'), true);


console.log('\n========================================');
console.log(`测试完成: ${passed}/${total} 通过 (${passed === total ? 'ALL PASS' : 'FAILED'})`);
console.log('========================================');

if (passed !== total) {
  process.exit(1);
}
