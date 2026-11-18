const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== 开始 Ticket-38 设置页与界面零散文案补充测试 ===\n');

const localizeSource = fs.readFileSync(path.join(__dirname, '..', 'localize.js'), 'utf-8');

function extractTranslator() {
  let injectionCode = require('./helpers/translator-loader').getInjectionCode();

  injectionCode = injectionCode.replace(
    'if (document.readyState === \'loading\')',
    'globalThis.__test_translateString = translateString;\n  if (typeof document !== "undefined" && document.readyState === "loading")'
  );

  const sandbox = {
    globalThis: {},
    document: { body: null, readyState: 'loading', addEventListener: () => {} },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
    Element: { prototype: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(injectionCode, sandbox);
  return sandbox.globalThis.__test_translateString;
}

const translateString = extractTranslator();

// 设置页 / 菜单 / 提示浮层等零散文案：原文 => 期望译文
const CASES = [
  ["Toggle Word Wrap", "切换自动换行"],
  ["Connect to SSH Host…", "连接到 SSH 主机…"],
  ["Stop SSH Server…", "停止 SSH 服务器…"],
  ["Switch to This Computer", "切换到本机"],
  ["Back 5s (←)", "后退 5 秒（←）"],
  ["Forward 5s (→)", "前进 5 秒（→）"],
  ["Comment", "评论"],
  ["Environments", "环境"],
  ["Custom…", "自定义…"],
  ["Developer: Reset Onboarding", "开发者：重置新手引导"],
  ["Developer: Reset NUX", "开发者：重置 NUX"],
  ["1. Accessibility", "1. 辅助功能"],
  ["2. Screen Recording", "2. 屏幕录制"],
  ["Browser downloads", "浏览器下载"],
  ["No coordinators", "无协调者"],
  ["SSH Host…", "SSH 主机…"],
  ["Recent", "最近"],
  ["Starting the conversation…", "正在开始对话…"],
  ["Resolving link…", "正在解析链接…"],
  ["Google One Referral", "Google One 推荐"],
  ["Project 4K interface without developer tooling.", "不含开发者工具的 Project 4K 界面。"],
  ["The full developer experience.", "完整的开发者体验。"],
  ["Controls whether terminal commands require your approval before running.\n\nNote: A change to this setting will only apply to new messages sent to the agent. In-progress responses will use the previous setting value.", "控制终端命令在执行前是否需要你的批准。\n\n注意：该设置的改动仅对之后发送给智能体的新消息生效，正在进行的回复仍沿用原有的设置值。"],
  ["Show how full the context window is next to the send button. Click it for a breakdown and to see your model quota.", "在发送按钮旁显示上下文窗口的占用情况。点击可查看明细与模型配额。"],
  ["Permanently delete your remote conversations, projects, scheduled tasks, connected plugins and settings. Data in the desktop app and your Google account are not affected.", "永久删除你的云端对话、项目、定时任务、已连接的插件与设置。桌面应用内的数据与你的 Google 账号不受影响。"],
  ["Share your referral link with friends", "与好友分享你的推荐链接"],
  ["Allow/deny agent browser file downloads from specific sites.", "允许或拒绝智能体浏览器从指定网站下载文件。"],
  ["Logs each telemetry event to the browser's DevTools console as it fires, with the click or key that caused it. Stays on across reloads until you turn it off.", "每当遥测事件触发时，将其连同触发它的点击或按键一并输出到浏览器 DevTools 控制台。开关会保持开启，直到你手动关闭。"],
  ["Uploaded project files and in-chat attachments are stored on Google servers and mounted into your cloud sandbox so your agent can read and work with them.", "上传的项目文件与对话内附件会存储在 Google 服务器上，并挂载到你的云端沙盒，供智能体读取和处理。"],
  ["Remove individual uploaded files or connected resources in Project Settings, or delete a project or conversation to remove its stored files.", "可在「项目设置」中移除单个已上传文件或已连接资源，也可删除项目或对话以清除其存储的文件。"],
  ["No plugin loads from this folder.", "此文件夹中的插件不会被加载。"],
  ["Open Blame in Code Search", "在代码搜索中查看 Blame"],
  ["Open in full conversation", "在完整对话中打开"],
  ["Send reply", "发送回复"],
  ["Playback speed (< / >)", "播放速度（< / >）"],
  ["Cookies and site data", "Cookie 与网站数据"],
  ["Resume comment draft", "继续编辑评论草稿"],
  ["Discard comment draft", "丢弃评论草稿"],
  ["Try out early-stage features before they ship. These may be changed or removed at any time. These features are experimental, and we make no guarantees about performance or functionality.", "抢先体验尚未正式发布的功能。这些功能可能随时变更或移除，属于实验性功能，我们不保证其性能或可用性。"],
  ["Optimized for you", "为你优化"],
  ["Failed to export artifact", "导出产物失败"],
  ["Uploading to Google Drive…", "正在上传到 Google 云端硬盘…"],
  ["Added", "已添加"],
  ["Untracked", "未跟踪"],
  ["Coordinators", "协调者"],
  ["Built to help, not hurt", "旨在帮助，而非伤害"],
  ["You are in control", "掌控权在你"],
  ["Stay up to date.", "保持最新状态。"],
  ["Customize Sections", "自定义分区"],
  ["Side Questions", "侧边提问"],
  ["Skills Used", "已使用的技能"],
  ["Search or enter a URL", "搜索或输入 URL"],
  ["Search tabs, files and more", "搜索标签页、文件及更多内容"],
  ["File not found", "文件未找到"],
  ["Failed to read file content", "读取文件内容失败"],
  ["Configure what the agent can do in local and remote conversations.", "配置智能体在本地和远程对话中的操作权限。"],
  ["Legacy Light", "经典浅色"],
  ["Legacy Dark", "经典深色"],
  ["Solarized Dark", "Solarized Dark（Solarized 深色）"],
  ["One Light", "One Light（One 浅色）"],
  ["Solarized Light", "Solarized Light（Solarized 浅色）"],
  ["One Dark Pro", "One Dark Pro（One 深色 Pro）"],
  ["Catppuccin", "Catppuccin（猫布奇诺）"],
  ["Everforest", "Everforest（森屿青）"],
  ["Gruvbox Material", "Gruvbox Material（复古暖棕）"],
  ["Dracula", "Dracula（德古拉）"],
  ["Monokai", "Monokai（莫奈高彩）"],
  ["Tokyo Night", "霓虹夜幕（深靛蓝）"],
  ["Vesper", "Vesper（暮星）"]
];

let passed = 0;
for (const [en, zh] of CASES) {
  try {
    assert.strictEqual(translateString(en), zh);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + JSON.stringify(en).slice(0, 70));
    console.error('    期望: ' + JSON.stringify(zh));
    console.error('    实际: ' + JSON.stringify(translateString(en)));
  }
}

console.log('=== Ticket-38 结果：' + passed + '/' + CASES.length + ' 通过 ===');

if (passed !== CASES.length) {
  console.error('❌ Ticket-38 存在未通过用例');
  process.exit(1);
}
console.log('✅ Ticket-38 全部通过');
