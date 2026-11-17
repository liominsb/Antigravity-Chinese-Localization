const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readAsarPackageVersion } = require('../asar-version');

console.log('=== 开始 Ticket-39 Antigravity 2.32.2 官方版本特性、Robotics 插件、GitHub 细粒度策略与自动化计划编辑器专项测试 ===\n');

const root = path.join(__dirname, '..');
const localizePath = path.join(root, 'localize.js');
const localizeSource = fs.readFileSync(localizePath, 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'extracted', 'package.json'), 'utf-8'));
const indexPath = path.join(root, 'index.html');
const indexSource = fs.readFileSync(indexPath, 'utf-8');
const readmePath = path.join(root, 'README.md');
const readmeSource = fs.readFileSync(readmePath, 'utf-8');
const readmeEnPath = path.join(root, 'README.en.md');
const readmeEnSource = fs.readFileSync(readmeEnPath, 'utf-8');
const changelogPath = path.join(root, 'CHANGELOG.md');
const changelogSource = fs.readFileSync(changelogPath, 'utf-8');
const changelogEnPath = path.join(root, 'CHANGELOG.en.md');
const changelogEnSource = fs.readFileSync(changelogEnPath, 'utf-8');
const readyAsarPath = path.join(root, 'app.asar.ready');

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

// 1. 2.32.2 版本元数据校验
console.log('--- 1. 2.32.2 版本元数据校验 ---');
function isVerGte2322(v) {
  if (!v) return false;
  const parts = String(v).split('.').map(Number);
  if (parts[0] > 2) return true;
  if (parts[0] === 2 && parts[1] > 32) return true;
  if (parts[0] === 2 && parts[1] === 32 && parts[2] >= 2) return true;
  return false;
}
const currentVerMatch = localizeSource.match(/const CURRENT_VERSION = ['"]([^'"]+)['"];/);
check('localize.js CURRENT_VERSION >= 2.32.2', isVerGte2322(currentVerMatch ? currentVerMatch[1] : ''), true);
check('extracted/package.json version >= 2.32.2', isVerGte2322(packageJson.version), true);
check('index.html 控制中心显示 v2.32.2 或更高', /控制中心 v2\.(3[2-9]|[4-9]\d)\./.test(indexSource), true);
check('README.md 包含 v2.32.2+ 或更高', /Antigravity v2\.(3[2-9]|[4-9]\d)\./.test(readmeSource), true);
check('README.en.md 包含 v2.32.2+ 或更高', /Antigravity v2\.(3[2-9]|[4-9]\d)\./.test(readmeEnSource), true);
check('CHANGELOG.md 包含 v2.32.2 章节', changelogSource.includes('## v2.32.2 (2026-11-17)'), true);
check('CHANGELOG.en.md 包含 v2.32.2 章节', changelogEnSource.includes('## v2.32.2 (2026-11-17)'), true);
check('app.asar.ready package.json 版本 >= 2.32.2', isVerGte2322(readAsarPackageVersion(readyAsarPath)), true);

// 2. 2.32.2 原生模块补丁与 Robotics/GitHub/Coordinator/Automations 词条校验
console.log('\n--- 2. 原生模块补丁与 2.32.2 新增词条校验 ---');
const distDir = path.join(root, 'extracted', 'dist');
const preloadSource = fs.readFileSync(path.join(distDir, 'preload.js'), 'utf-8');
const ipcHandlersSource = fs.readFileSync(path.join(distDir, 'ipcHandlers.js'), 'utf-8');

check('ipcHandlers.js dialog:open-workspaces 标题已汉化为 打开工作区', !ipcHandlersSource.includes("title: 'Open workspaces'"), true);
check('ipcHandlers.js 包含 Copy Conversation Markdown 映射', ipcHandlersSource.includes("'Copy Conversation Markdown': '复制对话 Markdown'"), true);
check('ipcHandlers.js 包含 Remove From Split 映射', ipcHandlersSource.includes("'Remove From Split': '从分屏中移除'"), true);
check('ipcHandlers.js 包含 Open on phone 映射', ipcHandlersSource.includes("'Open on phone': '在手机上打开'"), true);

check('preload.js 包含官方 Robotics 插件描述汉化', preloadSource.includes('适用于各类机器人的专业技能套件：涵盖 3D 感知、无碰撞运动规划、视觉伺服'), true);
check('preload.js 包含 Robotics MuJoCo 轨迹规划提示词汉化', preloadSource.includes('在 MuJoCo 中规划无碰撞关节运动轨迹'), true);
check('preload.js 包含 GitHub 细粒度权限描述汉化', preloadSource.includes('启用 GitHub 细粒度权限，并定义智能体允许使用的组织、仓库和资源级访问权限。'), true);
check('preload.js 包含 GitHub 议题访问规则汉化', preloadSource.includes('对列出的议题编号授予所选操作权限'), true);
check('preload.js 包含 + 添加组织策略 汉化', preloadSource.includes('"+ Add Organization policy": "+ 添加组织策略"'), true);
check('preload.js 包含 + 添加工作流运行策略 汉化', preloadSource.includes('"+ Add workflow run policy": "+ 添加工作流运行策略"'), true);
check('preload.js 包含 新建协调器 汉化', preloadSource.includes('"New Coordinator": "新建协调器"'), true);
check('preload.js 包含 协调器设置 汉化', preloadSource.includes('"Coordinator settings": "协调器设置"'), true);
check('preload.js 包含 在其他设备上打开 汉化', preloadSource.includes('"Open on another device": "在其他设备上打开"'), true);
check('preload.js 包含 新建侧边提问 汉化', preloadSource.includes('"New Side Question": "新建侧边提问"'), true);
check('preload.js 包含 自动化分步向导 Step X of Y 动态正则', preloadSource.includes('第 $1 步，共 $2 步'), true);
check('preload.js 包含 自动化下次运行 Next run 动态正则', preloadSource.includes('下次运行：'), true);
check('preload.js 包含 侧边栏项目拖拽偏移热修复 setupSidebarProjectDragFix', preloadSource.includes('setupSidebarProjectDragFix'), true);

// 3. app.asar.ready 二进制产物验证
console.log('\n--- 3. app.asar.ready 打包产物验证 ---');
const asarBuf = fs.readFileSync(readyAsarPath);
const asarSource = asarBuf.toString('utf-8', 0, Math.min(asarBuf.length, 30000000));

check('app.asar.ready 包含 Robotics 插件汉化', asarSource.includes('适用于各类机器人的专业技能套件'), true);
check('app.asar.ready 包含 GitHub 细粒度权限汉化', asarSource.includes('对列出的议题编号授予所选操作权限'), true);
check('app.asar.ready 包含 新建协调器 汉化', asarSource.includes('新建协调器'), true);
check('app.asar.ready 包含 在手机上打开 汉化', asarSource.includes('在手机上打开'), true);

console.log(`\n测试汇总: 通过: ${passed}, 失败: ${total - passed}, 总计: ${total}\n`);

if (passed !== total) {
  console.error('Ticket-39 校验存在失败项！');
  process.exit(1);
} else {
  console.log('[成功] Ticket-39 2.32.2 官方版本特性专项测试全部通过！');
}
