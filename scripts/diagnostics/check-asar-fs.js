'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isLocalizedAsar } = require('../../auto-restore');

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const resourcesDir = process.platform === 'win32'
  ? path.join(localAppData, 'Programs', 'antigravity', 'resources')
  : (process.platform === 'darwin'
    ? '/Applications/Antigravity.app/Contents/Resources'
    : path.join(os.homedir(), 'Antigravity', 'resources'));

for (const name of ['app.asar', 'app.asar.bak']) {
  const fp = path.join(resourcesDir, name);
  if (fs.existsSync(fp)) {
    const stat = fs.statSync(fp);
    console.log(`${name}: size=${stat.size}, localized=${isLocalizedAsar(fp)}`);
  } else {
    console.log(`${name}: not found (${fp})`);
  }
}
