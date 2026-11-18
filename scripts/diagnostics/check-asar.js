'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isLocalizedAsar } = require('../../auto-restore');
const { readAsarPackageVersion } = require('../../asar-version');

function resolveDefaultResourcesDir() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Programs', 'antigravity', 'resources');
  }
  if (process.platform === 'darwin') {
    return '/Applications/Antigravity.app/Contents/Resources';
  }
  return path.join(os.homedir(), 'Antigravity', 'resources');
}

const resourcesDir = resolveDefaultResourcesDir();
const asarPath = path.join(resourcesDir, 'app.asar');
const bakPath = path.join(resourcesDir, 'app.asar.bak');

console.log('=== ASAR 诊断检查 ===');
console.log('目标目录:', resourcesDir);
for (const [label, fp] of [['app.asar', asarPath], ['app.asar.bak', bakPath]]) {
  if (fs.existsSync(fp)) {
    console.log(`${label}: version=${readAsarPackageVersion(fp)}, isLocalized=${isLocalizedAsar(fp)}`);
  } else {
    console.log(`${label}: 不存在`);
  }
}
