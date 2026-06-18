#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Module = require('module');

const sourcePath = path.join(__dirname, 'localize.js');
if (!fs.existsSync(sourcePath)) {
  throw new Error(`找不到原始汉化脚本: ${sourcePath}`);
}

let source = fs.readFileSync(sourcePath, 'utf8');

source = source.replace(
  "function getAppDir(username, useDefault, customPath) {\n  if ((useDefault === false || useDefault === 'false') && customPath) {\n    return customPath.trim();\n  }\n  const isWin = process.platform === 'win32';\n  const defaultUser = getHostUsername();\n  const user = username ? username.trim() : defaultUser;\n  if (isWin) {\n    return `C:\\\\Users\\\\${user}\\\\AppData\\\\Local\\\\Programs\\\\antigravity`;\n  } else {\n    return `/home/${user}/Antigravity/Antigravity-x64`;\n  }\n}\n\n// Web UI DOM Localization engine injection payload",
  "function getAppDir(username, useDefault, customPath) {\n  if ((useDefault === false || useDefault === 'false') && customPath) {\n    return customPath.trim();\n  }\n  const isWin = process.platform === 'win32';\n  const isMac = process.platform === 'darwin';\n  const defaultUser = getHostUsername();\n  const user = username ? username.trim() : defaultUser;\n  if (isWin) {\n    return `C:\\\\Users\\\\${user}\\\\AppData\\\\Local\\\\Programs\\\\antigravity`;\n  }\n\n  if (isMac) {\n    const candidates = [\n      '/Applications/Antigravity.app',\n      `/Users/${user}/Applications/Antigravity.app`,\n    ];\n\n    for (const candidate of candidates) {\n      if (fs.existsSync(candidate)) return candidate;\n    }\n\n    return candidates[0];\n  }\n\n  return `/home/${user}/Antigravity/Antigravity-x64`;\n}\n\nfunction getResourcesDir(appDir) {\n  if (process.platform === 'darwin') {\n    const normalized = appDir.replace(/\\\/+$/, '');\n    if (normalized.endsWith(path.join('Contents', 'Resources'))) {\n      return normalized;\n    }\n    if (normalized.endsWith('.app')) {\n      return path.join(normalized, 'Contents', 'Resources');\n    }\n    return path.join(normalized, 'Contents', 'Resources');\n  }\n\n  return path.join(appDir, 'resources');\n}\n\n// Web UI DOM Localization engine injection payload"
);

source = source.split("path.join(appDir, 'resources', 'app.asar')").join("path.join(getResourcesDir(appDir), 'app.asar')");
source = source.split("path.join(appDir, 'resources', 'app.asar.bak')").join("path.join(getResourcesDir(appDir), 'app.asar.bak')");
source = source.split('pgrep -fl antigravity').join('pgrep -ifl antigravity');
source = source.split('pkill -f antigravity').join('pkill -fi antigravity');

source = source.replace(
  "        const exeName = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';\n        const appPath = path.join(appDir, exeName);\n        log(`正在尝试启动 Antigravity 2.0 (路径: ${appPath})...`);\n        if (fs.existsSync(appPath)) {\n          spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();\n          log('Antigravity 2.0 启动指令已发送。');\n          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });\n          res.end(JSON.stringify({ success: true, logs }));\n        } else {\n          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });\n          res.end(JSON.stringify({ success: false, error: '未找到可执行程序: ' + appPath, logs }));\n        }",
  "        const isMac = process.platform === 'darwin';\n        if (isMac) {\n          const appPath = appDir.endsWith('.app') ? appDir : `${appDir}.app`;\n          log(`正在尝试启动 Antigravity 2.0 (路径: ${appPath})...`);\n          if (fs.existsSync(appPath)) {\n            spawn('open', [appPath], { detached: true, stdio: 'ignore' }).unref();\n            log('Antigravity 2.0 启动指令已发送。');\n            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });\n            res.end(JSON.stringify({ success: true, logs }));\n          } else {\n            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });\n            res.end(JSON.stringify({ success: false, error: '未找到可执行程序: ' + appPath, logs }));\n          }\n        } else {\n          const exeName = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';\n          const appPath = path.join(appDir, exeName);\n          log(`正在尝试启动 Antigravity 2.0 (路径: ${appPath})...`);\n          if (fs.existsSync(appPath)) {\n            spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();\n            log('Antigravity 2.0 启动指令已发送。');\n            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });\n            res.end(JSON.stringify({ success: true, logs }));\n          } else {\n            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });\n            res.end(JSON.stringify({ success: false, error: '未找到可执行程序: ' + appPath, logs }));\n          }\n        }"
);

const m = new Module(sourcePath, module.parent);
m.filename = sourcePath;
m.paths = Module._nodeModulePaths(__dirname);
m._compile(source, sourcePath);
