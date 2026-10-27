const { execSync } = require('child_process');
const path = require('path');

const tests = [
  'ticket-03-workflow-safety.test.js',
  'ticket-04-slash-commands.test.js',
  'ticket-05-at-mentions.test.js',
  'ticket-06-project-and-copy.test.js',
  'ticket-07-v213-features.test.js',
  'ticket-08-split-and-menus.test.js',
  'ticket-09-v214-features.test.js',
  'ticket-10-v215-features.test.js',
  'ticket-11-v2151-features.test.js',
  'ticket-12-v2170-features.test.js',
  'ticket-13-v2181-features.test.js',
  'ticket-14-v2191-features.test.js',
  'ticket-15-v2210-features.test.js',
  'ticket-16-v2210-refinements.test.js',
  'ticket-17-v2211-features.test.js',
  'ticket-18-agent-execution-labels.test.js',
  'ticket-19-v2220-features.test.js',
  'ticket-20-v2230-features.test.js',
  'ticket-21-v2231-features.test.js',
  'ticket-22-auto-restore-on-update.test.js',
  'ticket-23-v2240-features.test.js',
  'ticket-24-v2250-features.test.js',
  'ticket-25-v2260-features.test.js',
  'asar-version.test.js',
  'process-check.test.js',
  'package-installer.test.js',
  'release-manager.test.js',
  'release-zip.test.js'
];

console.log('================ 全套 TDD 回归测试套件 ================\n');

let allPassed = true;

for (const test of tests) {
  const testPath = path.join(__dirname, test);
  console.log(`\n>>> [RUNNING TEST]: ${test}`);
  try {
    const output = execSync(`node "${testPath}"`, { encoding: 'utf-8' });
    console.log(output);
  } catch (e) {
    console.error(`\n>>> [FAILED TEST]: ${test}`);
    console.error(e.stdout || e.message);
    allPassed = false;
  }
}

if (!allPassed) {
  console.error('\n❌ 测试套件存在未通过用例！');
  process.exit(1);
} else {
  console.log('🎉 恭喜！全套 TDD 测试用例 100% 全部通过 (ALL GREEN)！');
  process.exit(0);
}
