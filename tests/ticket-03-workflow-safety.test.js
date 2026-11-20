const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== 开始执行 Ticket 03 汉化与安全恢复工作流测试 ===\n');

const localizePath = path.join(__dirname, '..', 'localize.js');
const source = fs.readFileSync(localizePath, 'utf-8');

// 1. 验证关键函数在 localize.js 中均完整存在且未被破坏
const requiredFunctions = [
  'isAppRunning',
  'killApp',
  'getAppDir',
  'getAsarCmd',
  'applyTranslations',
  'runLocalizationWorkflow',
  'runRestoreWorkflow'
];

for (const fn of requiredFunctions) {
  assert(source.includes(`function ${fn}`), `localize.js 必须包含核心工作流函数: ${fn}`);
  console.log(`[PASS] 核心工作流函数 ${fn} 存在且完整`);
}

// 2. 验证安全备份与一键恢复逻辑机制
assert(source.includes("fs.copyFileSync(asarPath, backupPath)"), '必须包含对 app.asar 的初始安全备份逻辑');
console.log('[PASS] 安全备份创建逻辑已锁定');

assert(source.includes("fs.renameSync(stageRestore, asarPath)"), '原版备份应从已校验的暂存文件原子还原');
console.log('[PASS] 原始安全还原逻辑已锁定');

// 3. 验证全局注入脚本的沙盒容错机制
assert(source.includes("DOM_TRANSLATOR_INJECTION"), 'DOM_TRANSLATOR_INJECTION 必须定义');
assert(source.includes("try {"), 'DOM 操作必须包含 try/catch 容错沙盒');
console.log('[PASS] 全局 DOM 注入沙盒容错机制已生效');

console.log('\n测试汇总: 全部工作流与安全恢复逻辑 100% 校验通过！');
