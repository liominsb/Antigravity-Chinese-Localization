// Antigravity 2.0 Chinese Localization Engine Enhanced
(function() {
  // 2.29.1 扩展市场全量插件、提示词与生态卡片汉化
  const dictionary = /* __AGY_DICTIONARY__ */ {};

  const coreWords = /* __AGY_CORE_WORDS__ */ {};

  // 预先构建全小写词典索引 Map，将大小写不敏感匹配降为 O(1)
  const lowerDictionary = new Map();
  for (const k in dictionary) {
    if (Object.prototype.hasOwnProperty.call(dictionary, k)) {
      const lk = k.toLowerCase();
      if (!lowerDictionary.has(lk)) {
        lowerDictionary.set(lk, dictionary[k]);
      }
    }
  }

  // FIFO 有界字符串翻译缓存（彻底防止长期运行会话缓存锁死）
  const stringCache = new Map();
  const MAX_STRING_CACHE = 8000;

  function cacheSet(key, val) {
    if (stringCache.has(key)) {
      stringCache.delete(key);
    } else if (stringCache.size >= MAX_STRING_CACHE) {
      const oldestKey = stringCache.keys().next().value;
      if (oldestKey !== undefined) {
        stringCache.delete(oldestKey);
      }
    }
    stringCache.set(key, val);
  }

  // 安全首尾空白保留替换：使用 indexOf + slice 彻底根除 String.prototype.replace 的 $$ / $& 模板注入漏洞
  function replaceTrimmed(text, trimmed, fixed) {
    if (text === trimmed) return fixed;
    const idx = text.indexOf(trimmed);
    if (idx === -1) return fixed;
    return text.slice(0, idx) + fixed + text.slice(idx + trimmed.length);
  }

  // 统一配额重置时长格式化（严格附带单词边界 \b，修复 "3 天ays" 并支持秒级单位）
  function formatDurationCn(str) {
    return String(str).trim()
      .replace(/^<\s*1\s*m(?:in(?:ute)?s?)?$/i, '不到 1 分钟')
      .replace(/(\d+)\s*d(?:ays?)?\b/gi, '$1 天 ')
      .replace(/(\d+)\s*h(?:(?:ou)?rs?)?\b/gi, '$1 小时 ')
      .replace(/(\d+)\s*m(?:in(?:ute)?s?)?\b(?!\s*o)/gi, '$1 分钟 ')
      .replace(/(\d+)\s*s(?:ec(?:ond)?s?)?\b/gi, '$1 秒 ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 历史半中半英残片自愈映射表（保持 dictionary 100% 纯净英文键的同时兼容旧版残片自愈）
  const SELF_HEAL_MAP = {
    'Replace With 新建': '替换为新建',
    '移除 From Split': '从分屏中移除',
    'Split 终端': '拆分终端',
    '新建 Group': '新建分组',
    '创建 Group': '创建分组',
    '移动到 Group': '移动到分组',
    '重命名 Group': '重命名分组',
    '删除 Group': '删除分组',
    '从 Group 中移除': '从分组中移除',
    '向右 Split': '向右分屏',
    '向下 Split': '向下分屏',
    'Advanced 设置': '高级设置',
    'advanced 设置': '高级设置',
    'Developer 工具': '开发者工具',
    'Custom 智能体': '自定义智能体',
    'Ran 命令': '已运行命令',
    'Running 命令': '正在运行命令',
    'No 自动化 yet': '暂无自动化',
    '搜索 shortcuts...': '搜索快捷键...',
    '搜索 shortcuts': '搜索快捷键',
    '清除 and friendly': '清晰友好',
    '清除 and friendly.': '清晰友好。',
    '工具 Permissions': '工具权限',
    '命令 Palette': '命令面板',
    '命令 palette': '命令面板',
    '命令palette': '命令面板'
  };

  // Gemini Live 已知语音音色白名单（防止 Use Default / Use Existing / Use Sandbox 被误译）
  const VOICE_NAMES = new Set([
    'arlo', 'cleo', 'finn', 'fola', 'gero', 'lora', 'neno', 'olin', 'tari',
    'aoede', 'charon', 'fenrir', 'kore', 'leda', 'orus', 'puck', 'zephyr',
    'orbit', 'vale', 'pegasus', 'nova', 'dipper', 'ursa', 'vega', 'capella', 'sirius'
  ]);

  function formatShortcut(sc) {
    if (!sc) return '';
    return sc
      .split('+')
      .map(part => {
        const lp = part.toLowerCase();
        if (lp === 'ctrl') return 'Ctrl';
        if (lp === 'cmd') return 'Cmd';
        if (lp === 'shift') return 'Shift';
        if (lp === 'alt' || lp === 'opt') return part.charAt(0).toUpperCase() + lp.slice(1);
        return part.toUpperCase();
      })
      .join('+');
  }

  function translateString(text) {
    if (!text || typeof text !== 'string') return text;
    const trimmed = text.trim();
    if (!trimmed) return text;

    // 极速短路：完全不含英文字母的字符串直接返回
    if (!/[a-zA-Z]/.test(trimmed)) {
      return text;
    }

    // 1. O(1) FIFO 缓存命中
    if (stringCache.has(trimmed)) {
      return replaceTrimmed(text, trimmed, stringCache.get(trimmed));
    }

    // 2. 精确区分全大写角标 "NEW"（译为 "新"）与常规按钮 "New"（译为 "新建"）
    if (trimmed === 'NEW') {
      const fixed = '新';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 3. 前置精确词典查找（O(1)，彻底杜绝宽泛动态正则截胡已收录词典条目）
    if (Object.prototype.hasOwnProperty.call(dictionary, trimmed)) {
      const fixed = dictionary[trimmed];
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    const normalizedSpace = trimmed.replace(/\s+/g, ' ');
    if (normalizedSpace !== trimmed && Object.prototype.hasOwnProperty.call(dictionary, normalizedSpace)) {
      const fixed = dictionary[normalizedSpace];
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (Object.prototype.hasOwnProperty.call(SELF_HEAL_MAP, trimmed)) {
      const fixed = SELF_HEAL_MAP[trimmed];
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 4. 动态正则匹配管线（全部标准原生正则字面量，命中统一写入 stringCache）

    // ===== 首页问候语（3 组模板 × 有/无用户名） =====
    if (/^(?:Hey|Welcome back|Good to see you)/i.test(trimmed)) {
      const greetingRules = [
        [/^Hey there,\s*what should we build today\?$/i, () => '嘿，今天想构建点什么？'],
        [/^Hey\s+(.+?),\s*what should we build today\?$/i, (n) => '嘿，' + n + '，今天想构建点什么？'],
        [/^Welcome back,\s*(.+?)\.\s*Where should we pick up\?$/i, (n) => '欢迎回来，' + n + '。我们从哪里继续？'],
        [/^Welcome back\.\s*Where should we pick up\?$/i, () => '欢迎回来。我们从哪里继续？'],
        [/^Good to see you,\s*(.+?)\.\s*What's next\?$/i, (n) => '很高兴见到你，' + n + '。接下来做什么？'],
        [/^Good to see you\.\s*What's next\?$/i, () => '很高兴见到你。接下来做什么？']
      ];
      for (let gi = 0; gi < greetingRules.length; gi++) {
        if (greetingRules[gi][0].test(trimmed)) {
          const fixed = trimmed.replace(greetingRules[gi][0], (_m, n) => greetingRules[gi][1](n));
          cacheSet(trimmed, fixed);
          return replaceTrimmed(text, trimmed, fixed);
        }
      }
    }

    // ===== 账号方案提示（Your Plan: xxx） =====
    if (/^Your Plan:\s*(.+)$/i.test(trimmed)) {
      const planMap = { 'antigravity starter quota': 'Antigravity 入门配额' };
      const fixed = trimmed.replace(/^Your Plan:\s*(.+)$/i, (_m, p) => '当前方案：' + (planMap[p.trim().toLowerCase()] || p));
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 第三方模型访问与下线公告 =====
    if (/^Changes to third-party model access$/i.test(trimmed)) {
      const fixed = '第三方模型访问方式调整';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s+(?:is|are)\s+(?:now\s+)?available on paid Pro and Ultra plans\.\s*Third-party model access will no longer be available on your current plan starting on\s*(.+?)\.$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+(?:is|are)\s+(?:now\s+)?available on paid Pro and Ultra plans\.\s*Third-party model access will no longer be available on your current plan starting on\s*(.+?)\.$/i, (_m, models, d) => {
        const months = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
        const cn = (d || '').replace(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/, (_mm, mon, day, year) => {
          const idx = months[mon.toLowerCase()];
          return idx ? (year + ' 年 ' + idx + ' 月 ' + day + ' 日') : d;
        });
        const parts = models.split(/\s+and\s+/i);
        const modelsCn = parts.length === 2 ? parts.join(' 与 ') : parts.join('、');
        return modelsCn + ' 现已在付费 Pro 与 Ultra 方案中提供。自 ' + cn + '起，你当前方案将不再提供第三方模型访问。';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:(.+?)\s+)?will be removed(?:\s+from Antigravity)?\s+on\s+(.+?)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:(.+?)\s+)?will be removed(\s+from Antigravity)?\s+on\s+(.+?)\.?$/i, (_m, model, fromAgy, d) => {
        const months = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
        const cn = (d || '').replace(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/, (_mm, mon, day, year) => {
          const idx = months[mon.toLowerCase()];
          return idx ? (year + ' 年 ' + idx + ' 月 ' + day + ' 日 ') : (d + ' ');
        }).trim();
        const subj = !model ? '' : (/^this model$/i.test(model.trim()) ? '此模型' : (model.trim() + ' '));
        const suffix = fromAgy ? '从 Antigravity 移除。' : '移除。';
        return subj + '将于 ' + cn + suffix;
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^([A-Za-z0-9._ -]+?)\s+that\s+may\s+offload\s+routine\s+steps\s+to\s+([A-Za-z0-9._ -]+?)\.\s*Same\s+([A-Za-z0-9._ -]+?)-level\s+quality,\s*fewer\s+tokens\s+used\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(
        /^([A-Za-z0-9._ -]+?)\s+that\s+may\s+offload\s+routine\s+steps\s+to\s+([A-Za-z0-9._ -]+?)\.\s*Same\s+([A-Za-z0-9._ -]+?)-level\s+quality,\s*fewer\s+tokens\s+used\.?$/i,
        '由 $1 主导，可将常规步骤分流至 $2 执行。保持 $3 级输出质量，消耗更少 Token。'
      );
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Effort isn't adjustable for\s+(.+?)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Effort isn't adjustable for\s+(.+?)\.?$/i, '无法为 $1 调整思考档位。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Introducing\s+((?:Gemini|Claude|GPT|Gemma|Veo|Imagen)(?:\s+[A-Za-z0-9._-]+){1,5})([!.]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Introducing\s+((?:Gemini|Claude|GPT|Gemma|Veo|Imagen)(?:\s+[A-Za-z0-9._-]+){1,5})([!.]?)$/i, (_m, model, punc) => {
        return '全新推出 ' + model + (punc === '!' ? '！' : '');
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s+(?:is|are)\s+currently available to\s+(.+?)\s+subscribers?\.$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+(?:is|are)\s+currently available to\s+(.+?)\s+subscribers?\.$/i, (_m, models, audience) => {
        const a = String(audience)
          .replace(/\bUltra and paid Pro plans?\b/gi, 'Ultra 与付费 Pro 方案')
          .replace(/\bpaid Pro and Ultra plans?\b/gi, '付费 Pro 与 Ultra 方案')
          .replace(/\band\b/gi, '与')
          .replace(/\bpaid\b/gi, '付费')
          .replace(/\bplans?\b/gi, '方案');
        const lead = /^[A-Za-z0-9]/.test(a) ? ' ' : '';
        const tail = /[A-Za-z0-9]$/.test(a) ? ' ' : '';
        return models + ' 目前仅向' + lead + a + tail + '订阅用户提供。';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s+(?:is|are)\s+not available (?:on|in) your (?:current )?plan\.$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+(?:is|are)\s+not available (?:on|in) your (?:current )?plan\.$/i, (_m, model) => model + ' 在你当前方案中不可用。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 用量窗口与配额重置时间 =====
    if (/^(.+?),\s*resets?\s+in\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?),\s*resets?\s+in\s+(.+)$/i, (_m, label, t) => {
        const labelMap = {
          'weekly limit': '每周限额',
          'daily limit': '每日限额',
          'hourly limit': '每小时限额',
          'monthly limit': '每月限额',
          '5-hour limit': '5 小时限额',
          'five-hour limit': '5 小时限额',
          'five hour limit': '5 小时限额'
        };
        const labelCn = labelMap[label.trim().toLowerCase()] || translateString(label.trim());
        return labelCn + '，' + formatDurationCn(t) + '后重置';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Resets?\s+in\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Resets?\s+in\s+(.+)$/i, (_m, t) => formatDurationCn(t) + '后重置');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+(?:\.\d+)?)%\s*left$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+(?:\.\d+)?)%\s*left$/i, (_m, pct) => pct + '% 可用');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+(?:\.\d+)?)%\s+(?:remaining|left)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+(?:\.\d+)?)%\s+(?:remaining|left)$/i, (_m, pct) => pct + '% 剩余');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Available AI Credits:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Available AI Credits:\s*(.+)$/i, (_m, n) => '可用 AI 点数：' + n);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 声音选择弹窗按钮（严格限定已知语音音色白名单，防止误伤 Use Default / Use Sandbox） =====
    if (/^Use\s+([A-Za-z0-9_-]+)$/i.test(trimmed)) {
      const voiceCandidate = trimmed.replace(/^Use\s+/i, '');
      if (VOICE_NAMES.has(voiceCandidate.toLowerCase())) {
        const fixed = '使用 ' + voiceCandidate;
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    if (/^Use$/.test(trimmed)) {
      const fixed = '使用';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 键盘快捷键排队提示 =====
    if (/^(.+?)\s+Queues after the turn$/.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+Queues after the turn$/, (_m, key) => key + ' 在当前回合结束后排队');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s+Sends immediately$/.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+Sends immediately$/, (_m, key) => key + ' 立即发送');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s+On empty prompt, sends next in queue$/.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+On empty prompt, sends next in queue$/, (_m, key) => key + ' 输入框为空时，发送队列中的下一条');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 开发者设置 workspaceUri 说明 =====
    if (/^Sets the .workspaceUri. URL parameter and reloads, repointing the active workspace\./.test(trimmed)) {
      const fixed = '设置 workspaceUri URL 参数并重新加载，从而把当前工作区指向新的位置。可从已有项目中选择文件夹，或输入自定义 URI（例如 file:///path/to/workspace）。';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 对话区选中文本浮动引用按钮与 /btw 提问按钮（支持多修饰键如 Ctrl+Shift+L） =====
    if (/^Quote(?:\s+((?:Ctrl|Cmd)(?:\+[a-zA-Z0-9]+)+))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Quote(?:\s+((?:Ctrl|Cmd)(?:\+[a-zA-Z0-9]+)+))?$/i, (_m, shortcut) => {
        return shortcut ? ('引用 ' + formatShortcut(shortcut)) : '引用';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Ask(?:\s+|\s*\/\s*)btw(?:\s+((?:Ctrl|Cmd)(?:\+[a-zA-Z0-9]+)+))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ask(?:\s+|\s*\/\s*)btw(?:\s+((?:Ctrl|Cmd)(?:\+[a-zA-Z0-9]+)+))?$/i, (_m, shortcut) => {
        return shortcut ? ('通过 /btw 提问 ' + formatShortcut(shortcut)) : '通过 /btw 提问';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 置顶对话排序菜单动态双重保障 =====
    if (/^Sort By$/i.test(trimmed)) {
      const fixed = '排序方式';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^Last Updated$/i.test(trimmed)) {
      const fixed = '最近更新';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^Custom Order$/i.test(trimmed)) {
      const fixed = '自定义排序';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 扩展市场分类货架与自动化面板动态保障 =====
    if (/^Developer\s+(?:Tools|工具)$/i.test(trimmed)) {
      const fixed = '开发者工具';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^No\s+(?:automations?|自动化)\s+yet$/i.test(trimmed)) {
      const fixed = '暂无自动化';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Google does not control the availability or functionality of third party developer tools\..*found here:\s*$/i.test(trimmed)) {
      const fixed = 'Google 不控制第三方开发者工具的可用性或功能。连接到你的 Antigravity 实例的第三方开发者工具数据可能会与 Google 共享。Google 将根据 Google 隐私权政策保护此类数据，详情请参阅：';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Search customizations\.{1,3}$/i.test(trimmed)) {
      const fixed = '搜索自定义项...';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:Search|搜索)\s+shortcuts\.{1,3}$/i.test(trimmed)) {
      const fixed = '搜索快捷键...';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Configure\s+allowed\s+and\s+denied\s+URLs\s+for\s+the\s+browser\s+subagent\s*\(invoked\s+with\s+\/browser\)\.\s*Requires\s+Google\s+Chrome\.?$/i.test(trimmed)) {
      const fixed = '配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的 URL。需要 Google Chrome。';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Choose\s+Antigravity(?:'s)?\s+Voice$/i.test(trimmed)) {
      const fixed = '选择 Antigravity 的声音';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:Clear|清除)\s+and\s+friendly$/i.test(trimmed)) {
      const fixed = '清晰友好';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 设置面板与删除项目对话统计动态规则 =====
    if (/\bModified\s+in\s+([a-zA-Z0-9_\-/.]+)/i.test(trimmed)) {
      const fixed = trimmed.replace(/\bModified\s+in\s+([a-zA-Z0-9_\-/.]+)/gi, '已在 $1 中修改');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:Permanently delete|永久删除)\s+(.+?)\s+(?:including|包括|包含)\s+(\d+)\s+active\s+conversations?\s+and\s+(\d+)\s+archived\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:Permanently delete|永久删除)\s+(.+?)\s+(?:including|包括|包含)\s+(\d+)\s+active\s+conversations?\s+and\s+(\d+)\s+archived\s+conversations?([.。]?)$/i, '永久删除 $1，包含 $2 个活跃对话与 $3 个已归档对话。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:Permanently delete|永久删除)\s+(.+?)\s+(?:including|包括|包含)\s+(\d+)\s+active\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:Permanently delete|永久删除)\s+(.+?)\s+(?:including|包括|包含)\s+(\d+)\s+active\s+conversations?([.。]?)$/i, '永久删除 $1，包含 $2 个活跃对话。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:Permanently delete|永久删除)\s+(.+?)\s+(?:including|包括|包含)\s+(\d+)\s+archived\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:Permanently delete|永久删除)\s+(.+?)\s+(?:including|包括|包含)\s+(\d+)\s+archived\s+conversations?([.。]?)$/i, '永久删除 $1，包含 $2 个已归档对话。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:(?:including|包括|包含)\s+)?(\d+)\s+active\s+conversations?\s+and\s+(\d+)\s+archived\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(?:(?:including|包括|包含)\s+)?(\d+)\s+active\s+conversations?\s+and\s+(\d+)\s+archived\s+conversations?([.。]?)$/i, '包含 $1 个活跃对话与 $2 个已归档对话。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+active\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+active\s+conversations?([.。]?)$/i, '$1 个活跃对话。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+archived\s+conversations?([.。]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+archived\s+conversations?([.。]?)$/i, '$1 个已归档对话。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 远程 SSH 交互与连接状态动态保障（长句在前，防止被短句遮蔽） =====
    if (/^Reconnecting to (.+?)[.…⋯]?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Reconnecting to (.+?)[.…⋯]?$/i, '正在重新连接到 $1…');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Disconnected from (.+?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Disconnected from (.+?)$/i, '已断开与 $1 的连接');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Agents keep running on (.+?) unless its server stopped\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Agents keep running on (.+?) unless its server stopped\.?$/i, '智能体将在 $1 上继续运行（除非其服务端已停止）。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Agents keep running on (.+?)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Agents keep running on (.+?)\.?$/i, '智能体将在 $1 上继续运行。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Connect to Google Workspace, including Docs, Sheets, Slides, Drive, Calendar(?:, and Gmail)?[.…⋯]?$/i.test(trimmed)) {
      const fixed = '连接到 Google Workspace，包括 Google 文档、表格、幻灯片、云端硬盘、日历' + (trimmed.includes('Gmail') ? '和 Gmail。' : '。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Stop the Antigravity server on (.+?)\?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Stop the Antigravity server on (.+?)\?$/i, '停止 $1 上的 Antigravity 服务端？');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 对话排队发送、模型档位、侧边提问、Worktree 与工具动态匹配 =====
    if (/^Send\s+all\s*\((\d+)\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Send\s+all\s*\((\d+)\)$/i, '全部发送 ($1)');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Send\s+all$/i.test(trimmed)) {
      const fixed = '全部发送';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(Low|Medium|High|Extra|Max)\s*·\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(Low|Medium|High|Extra|Max)\s*·\s*(.+)$/i, (_m, tier, ctx) => {
        const tierMap = { low: '低', medium: '中', high: '高', xhigh: '极高', extra: '极高', max: '最高' };
        return (tierMap[tier.toLowerCase()] || tier) + ' · ' + ctx;
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+models\s+selected$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+models\s+selected$/i, '已选择 $1 个模型');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^\+(\d+)\s+attachments?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^\+(\d+)\s+attachments?$/i, '+$1 个附件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Send\s+now:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Send\s+now:\s*(.+)$/i, (_m, v) => '立即发送：' + v);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^View\s+Diff\s+for\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^View\s+Diff\s+for\s+(.+)$/i, (_m, v) => '查看 ' + v + ' 的差异');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^There was an error determining the code changes that this undo action will make:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^There was an error determining the code changes that this undo action will make:\s*(.+)$/i, (_m, v) => '确定此撤销操作将产生的代码更改时出错：' + v);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 自动化调度、分步向导与侧边提问动态保障（已修复全部单反斜杠漏转义） =====
    if (/^Step\s+(\d+)\s+of\s+(\d+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Step\s+(\d+)\s+of\s+(\d+)$/i, '第 $1 步，共 $2 步');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Edit side question title:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Edit side question title:\s*(.+)$/i, (_m, t) => '编辑侧边提问标题：' + t.trim());
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Reply to\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Reply to\s+(.+)$/i, (_m, t) => '回复 ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:New|Create)\s+(automation|scheduled task)$/i.test(trimmed)) {
      const isCreate = /^Create/i.test(trimmed);
      const isAuto = /automation$/i.test(trimmed);
      const fixed = (isCreate ? '创建' : '新建') + (isAuto ? '自动化' : '定时任务');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Next run (today|tomorrow) around (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Next run (today|tomorrow) around (.+)$/i, (_m, d, t) => '下次运行：' + (/today/i.test(d) ? '今天 ' : '明天 ') + t + ' 左右');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Next run on (.+?) around (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Next run on (.+?) around (.+)$/i, '下次运行：$1 $2 左右');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Every\s+(\d+)\s+(hours?|minutes?)(?:\s+on\s+(.+))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Every\s+(\d+)\s+(hours?|minutes?)(?:\s+on\s+(.+))?$/i, (_m, n, u, d) => '每 ' + n + (/hour/i.test(u) ? ' 小时' : ' 分钟') + (d ? '（' + d + '）' : ''));
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(Daily|Weekdays|Weekends) at (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(Daily|Weekdays|Weekends) at (.+)$/i, (_m, p, t) => {
        const map = { daily: '每天 ', weekdays: '每个工作日 ', weekends: '每个周末 ' };
        return (map[p.toLowerCase()] || p + ' ') + t;
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Monthly on the\s+(\d+)(?:st|nd|rd|th)\s+at\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Monthly on the\s+(\d+)(?:st|nd|rd|th)\s+at\s+(.+)$/i, '每月 $1 日 $2');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Not connected to (.+?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Not connected to (.+?)$/i, (_m, h) => '未连接到 ' + h);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 侧边栏、分支、浏览器与 Hooks 动态短语 =====
    if (/^Compacting\s*·\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Compacting\s*·\s*(.+)$/i, (_m, dur) => '正在压缩上下文 · ' + dur);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Model unavailable,\s*retrying(?:\s+in\s+(\d+s))?(?:\s*\(attempt\s+(\d+)\/(\d+)\))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(
        /^Model unavailable,\s*retrying(?:\s+in\s+(\d+s))?(?:\s*\(attempt\s+(\d+)\/(\d+)\))?$/i,
        (_m, waitSec, cur, max) => {
          const base = waitSec ? ('模型暂不可用，将在 ' + waitSec + ' 后重试') : '模型暂不可用，正在重试';
          return (cur && max) ? (base + '（第 ' + cur + '/' + max + ' 次尝试）') : base;
        }
      );
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Using browser\s*\((\d+s)\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Using browser\s*\((\d+s)\)$/i, '正在使用浏览器 ($1)');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Using browser\s*·\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Using browser\s*·\s*(.+)$/i, (_m, target) => {
        const t = target
          .replace(/^Thinking\s*\((\d+s)\)[.…]*$/i, '思考中 ($1)…')
          .replace(/^Thinking[.…]*$/i, '思考中…');
        return '正在使用浏览器 · ' + t;
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Marked\s+(\d+)\s+conversations?\s+as\s+read$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Marked\s+(\d+)\s+conversations?\s+as\s+read$/i, '已将 $1 个对话标为已读');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+pinned\s+conversations?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+pinned\s+conversations?$/i, '$1 个置顶对话');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Detached at\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Detached at\s+(.+)$/i, (_m, rev) => '游离于 ' + rev);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Branch,\s*current:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Branch,\s*current:\s*(.+)$/i, (_m, br) => '分支，当前：' + br);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^No handlers configured for\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^No handlers configured for\s+(.+)$/i, (_m, ev) => '尚未为 ' + ev + ' 配置处理程序');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Add New Handler to\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Add New Handler to\s+(.+)$/i, (_m, ev) => '向 ' + ev + ' 添加新处理程序');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Managed by the\s+(.+?)\s+(automation|plugin)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Managed by the\s+(.+?)\s+(automation|plugin)$/i, (_m, name, kind) => {
        return /automation/i.test(kind) ? ('由自动化任务 ' + name + ' 托管') : ('由插件 ' + name + ' 托管');
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 扩展市场通用模式匹配 =====
    if (/^(.+)\s+plugin for Antigravity$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+)\s+plugin for Antigravity$/i, 'Antigravity 的 $1 插件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^The first (.+) tool call opens a browser window to authorize your workspace[.。]?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^The first (.+) tool call opens a browser window to authorize your workspace[.。]?$/i, '首次调用 $1 工具时会打开浏览器窗口以授权你的工作区。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (trimmed.startsWith("Teamwork Graph CLI is Atlassian's agent-first interface")) {
      const fixed = "Teamwork Graph CLI 是 Atlassian 专为智能体打造的工作上下文接口：汇集 Jira 议题、Confluence 页面、Bitbucket PR 以及连接的第三方数据源。专为 Antigravity 等编码智能体量身定制，由 Atlassian 上下文图谱驱动。试试说：“根据此 PR 起草一个 Jira issue 并关联到史诗”。安装后运行 /twg-setup 将 Atlassian Teamwork Graph CLI 连接到 Antigravity。";
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^See\s+(\d+)\s+more$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^See\s+(\d+)\s+more$/i, '查看其余 $1 项');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^See\s+less$/i.test(trimmed)) {
      const fixed = '收起';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^See\s+more\s+in\s+(.+)$/i.test(trimmed)) {
      const rawGroup = trimmed.replace(/^See\s+more\s+in\s+/i, '').trim();
      const groupCn = translateString(rawGroup);
      const fixed = '在“' + groupCn + '”中查看更多';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^See\s+less\s+in\s+(.+)$/i.test(trimmed)) {
      const rawGroup = trimmed.replace(/^See\s+less\s+in\s+/i, '').trim();
      const groupCn = translateString(rawGroup);
      const fixed = '在“' + groupCn + '”中收起';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 收紧后的 Install / Uninstall 动态规则：仅允许宾语 <= 3 词且不含连词介词与句末标点
    if (/^Install\s+(.+)$/i.test(trimmed)) {
      const target = trimmed.replace(/^Install\s+/i, '').trim();
      const tWords = target.split(/\s+/);
      if (tWords.length <= 3 && !/\b(?:or|and|to|in|from|with|for|into|on|by)\b/i.test(target) && !/[.!?]$/.test(target)) {
        const fixed = '安装 ' + translateString(target);
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    if (/^Uninstall\s+(.+)$/i.test(trimmed)) {
      const target = trimmed.replace(/^Uninstall\s+/i, '').trim();
      const tWords = target.split(/\s+/);
      if (tWords.length <= 3 && !/\b(?:or|and|to|in|from|with|for|into|on|by)\b/i.test(target) && !/[.!?]$/.test(target)) {
        const fixed = '卸载 ' + translateString(target);
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    if (/^(\d+)\s+(?:tools?|工具)\s+enabled$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+(?:tools?|工具)\s+enabled$/i, '已启用 $1 个工具');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Loading (?:plugin|skill|bundle)[.…]*$/i.test(trimmed)) {
      const fixed = /bundle/i.test(trimmed) ? '正在加载插件组合包...' : (/skill/i.test(trimmed) ? '正在加载技能...' : '正在加载插件...');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:Last 提示词|Last Prompt)$/i.test(trimmed)) {
      const fixed = '最新提示词';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Last\s+(\d+)\s+days?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Last\s+(\d+)\s+days?$/i, '最近 $1 天');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Last\s+(\d+)\s+hours?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Last\s+(\d+)\s+hours?$/i, '最近 $1 小时');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Show\s+(\d+)\s+breakdowns?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Show\s+(\d+)\s+breakdowns?$/i, '显示 $1 项明细');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Hide\s+breakdowns?$/i.test(trimmed)) {
      const fixed = '隐藏明细';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 智能体执行标签、工具组与步骤状态动态匹配 =====
    if (/^Ran\s+命令:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\s+命令:\s*(.+)$/i, (_m, cmd) => '已运行命令: ' + cmd);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^Running\s+命令:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\s+命令:\s*(.+)$/i, (_m, cmd) => '正在运行命令: ' + cmd);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^Ran\s+(\d+)\s*(?:commands|命令)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\s+(\d+)\s*(?:commands|命令)$/i, '已运行 $1 条命令');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^Running\s+(\d+)\s*(?:commands|命令)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\s+(\d+)\s*(?:commands|命令)$/i, '正在运行 $1 条命令');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Explored\s+(\d+)\s+files?,\s*ran\s+(\d+)\s+commands?,\s*edited\s+(\d+)\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const isArt = /artifacts?$/i.test(trimmed);
      const fixed = trimmed.replace(/^Explored\s+(\d+)\s+files?,\s*ran\s+(\d+)\s+commands?,\s*edited\s+(\d+)\s+(?:files?|artifacts?)$/i,
        isArt ? '已探索 $1 个文件，已执行 $2 条命令，已编辑 $3 个工件' : '已探索 $1 个文件，已执行 $2 条命令，已编辑 $3 个文件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Exploring\s+(\d+)\s+files?,\s*running\s+(\d+)\s+commands?,\s*editing\s+(\d+)\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const isArt = /artifacts?$/i.test(trimmed);
      const fixed = trimmed.replace(/^Exploring\s+(\d+)\s+files?,\s*running\s+(\d+)\s+commands?,\s*editing\s+(\d+)\s+(?:files?|artifacts?)$/i,
        isArt ? '正在探索 $1 个文件，正在运行 $2 条命令，正在编辑 $3 个工件' : '正在探索 $1 个文件，正在运行 $2 条命令，正在编辑 $3 个文件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Explored\s+files?,\s*ran\s+commands?,\s*edited\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '已探索文件、已执行命令、已编辑工件' : '已探索文件、已执行命令、已编辑文件';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Exploring\s+files?,\s*running\s+commands?,\s*editing\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '正在探索文件、运行命令、编辑工件' : '正在探索文件、运行命令、编辑文件';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Explored\s+(\d+)\s+files?,\s*ran\s+(\d+)\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Explored\s+(\d+)\s+files?,\s*ran\s+(\d+)\s+commands?$/i, '已探索 $1 个文件，已执行 $2 条命令');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Exploring\s+(\d+)\s+files?,\s*running\s+(\d+)\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Exploring\s+(\d+)\s+files?,\s*running\s+(\d+)\s+commands?$/i, '正在探索 $1 个文件，正在运行 $2 条命令');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Explored\s+files?,\s*ran\s+commands?$/i.test(trimmed)) {
      const fixed = '已探索文件，已执行命令';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Exploring\s+files?,\s*running\s+commands?$/i.test(trimmed)) {
      const fixed = '正在探索文件，正在运行命令';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Running\s+commands?,\s*editing\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '正在运行命令、编辑工件' : '正在运行命令、编辑文件';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Ran\s+commands?,\s*edited\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '已执行命令、已编辑工件' : '已执行命令、已编辑文件';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Explored\s+files?,\s*edited\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '已探索文件、已编辑工件' : '已探索文件、已编辑文件';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Exploring\s+files?,\s*editing\s+(?:files?|artifacts?)$/i.test(trimmed)) {
      const fixed = /artifacts?$/i.test(trimmed) ? '正在探索文件、编辑工件' : '正在探索文件、编辑文件';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Ran\s+(\d+)\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\s+(\d+)\s+commands?$/i, '已运行 $1 条命令');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Running\s+(\d+)\s+commands?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\s+(\d+)\s+commands?$/i, '正在运行 $1 条命令');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Explored\s+(\d+)\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Explored\s+(\d+)\s+files?$/i, '已探索 $1 个文件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Exploring\s+(\d+)\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Exploring\s+(\d+)\s+files?$/i, '正在探索 $1 个文件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Edited\s+(\d+)\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Edited\s+(\d+)\s+files?$/i, '已编辑 $1 个文件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Editing\s+(\d+)\s+files?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Editing\s+(\d+)\s+files?$/i, '正在编辑 $1 个文件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Edited\s+(\d+)\s+artifacts?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Edited\s+(\d+)\s+artifacts?$/i, '已编辑 $1 个工件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Editing\s+(\d+)\s+artifacts?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Editing\s+(\d+)\s+artifacts?$/i, '正在编辑 $1 个工件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 具体工具步骤行模式 =====
    if (/^Ran\s+command:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Ran\s+command:\s*(.+)$/i, (_m, cmd) => '已运行命令: ' + cmd);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Running\s+command:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Running\s+command:\s*(.+)$/i, (_m, cmd) => '正在运行命令: ' + cmd);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Waiting for command completion \(up to (\d+) seconds\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Waiting for command completion \(up to (\d+) seconds\)$/i, '等待命令执行完成（最多 $1 秒）');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Rejected sending (?:termination request|input) to command$/i.test(trimmed)) {
      const fixed = /termination/i.test(trimmed) ? '已拒绝向命令发送终止请求' : '已拒绝向命令发送输入';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Sent (?:termination request|input) to command$/i.test(trimmed)) {
      const fixed = /termination/i.test(trimmed) ? '已向命令发送终止请求' : '已向命令发送输入';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Suggested sending (?:termination request|input) to command$/i.test(trimmed)) {
      const fixed = /termination/i.test(trimmed) ? '建议向命令发送终止请求' : '建议向命令发送输入';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Sending (?:termination request|input) to command$/i.test(trimmed)) {
      const fixed = /termination/i.test(trimmed) ? '正在向命令发送终止请求' : '正在向命令发送输入';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Error sending (?:termination request|input) to command$/i.test(trimmed)) {
      const fixed = /termination/i.test(trimmed) ? '向命令发送终止请求时出错' : '向命令发送输入时出错';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Canceled edit to (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Canceled edit to (.+)$/i, (_m, f) => '已取消对 ' + f + ' 的编辑');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Canceled creation of (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Canceled creation of (.+)$/i, (_m, f) => '已取消创建 ' + f);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Canceled deletion of (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Canceled deletion of (.+)$/i, (_m, f) => '已取消删除 ' + f);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Canceled\s+(.+)$/.test(trimmed)) {
      const fixed = trimmed.replace(/^Canceled\s+(.+)$/, (_m, cmd) => '已取消 ' + cmd);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Used MCP tool:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Used MCP tool:\s*(.+)$/i, (_m, t) => '调用 MCP 工具: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Used tool:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Used tool:\s*(.+)$/i, (_m, t) => '调用工具: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Generated image:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Generated image:\s*(.+)$/i, (_m, t) => '生成图像: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Browser task:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Browser task:\s*(.+)$/i, (_m, t) => '浏览器任务: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Opened browser:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Opened browser:\s*(.+)$/i, (_m, t) => '已打开浏览器: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Read URL:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Read URL:\s*(.+)$/i, (_m, t) => '读取 URL: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Searched web:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Searched web:\s*(.+)$/i, (_m, t) => '网页搜索: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Invoked subagent:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Invoked subagent:\s*(.+)$/i, (_m, t) => '调用子智能体: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Searched for files:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Searched for files:\s*(.+)$/i, (_m, t) => '搜索文件: ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Searched for\s+"([^"]+)"$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Searched for\s+"([^"]+)"$/i, (_m, q) => '搜索: "' + q + '"');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Code search:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Code search:\s*(.+)$/i, (_m, q) => '代码搜索: ' + q);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Internal search:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Internal search:\s*(.+)$/i, (_m, q) => '内部搜索: ' + q);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Listed directory\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Listed directory\s+(.+)$/i, (_m, d) => '列出目录: ' + d);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^No more older messages(?:,\s*showing\s+(\d+)\s+of\s+(\d+))?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^No more older messages(?:,\s*showing\s+(\d+)\s+of\s+(\d+))?$/i, (_m, a, b) => {
        return a && b ? ('已无更早的历史消息（共显示 ' + a + ' / ' + b + ' 条）') : '已无更早的历史消息';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Select model,\s*current:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Select model,\s*current:\s*(.+)$/i, (_m, m) => '选择模型，当前为: ' + m);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Opens external link:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Opens external link:\s*(.+)$/i, (_m, u) => '打开外部链接: ' + u);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Send feedback as\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Send feedback as\s+(.+)$/i, (_m, u) => '以 ' + u + ' 身份发送反馈');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^See all\s*\(([^)]+)\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^See all\s*\(([^)]+)\)$/i, (_m, n) => '查看全部 (' + n + ')');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(See all|Generation Steps|Show submitted|Show more|Send all|Show all)\s*\($/i.test(trimmed)) {
      const prefixMap = {
        'see all': '查看全部 (',
        'generation steps': '生成步骤 (',
        'show submitted': '显示已提交 (',
        'show more': '显示更多 (',
        'send all': '全部发送 (',
        'show all': '显示全部 ('
      };
      const keyLower = trimmed.replace(/\s*\($/, '').toLowerCase();
      if (prefixMap[keyLower]) {
        const fixed = prefixMap[keyLower];
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    if (/^Load older messages,\s*showing\s+(\d+)\s+of\s+(\d+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Load older messages,\s*showing\s+(\d+)\s+of\s+(\d+)$/i, '加载历史消息，正在显示 $1 / $2 条');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Fold lines\s+([0-9-]+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Fold lines\s+([0-9-]+)$/i, '折叠第 $1 行');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 远程控制二维码与 WSL 动态提示（严格首尾锚定） =====
    if (/^Continue your work from another device with Remote Control\.\s*Scan the QR code or open the link below\.?$/i.test(trimmed)) {
      const fixed = '借助远程控制从另一台设备继续工作。请扫描下方二维码或打开下方链接。';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Scan the QR code or open the link below\.?$/i.test(trimmed)) {
      const fixed = '扫描下方二维码或打开下方链接。';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Also\s+includes\s+(?:Global\s+Permissions|全局权限)\s+when\s+working\s+in\s+this\s+project\.?$/i.test(trimmed)) {
      const fixed = '在当前项目中工作时，亦继承全局权限配置。';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Setting up WSL:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Setting up WSL:\s*(.+)$/i, (_m, d) => '正在配置 WSL: ' + d);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Installing into\s*(.+?)[….]*$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Installing into\s*(.+?)[….]*$/i, (_m, d) => '正在安装到 ' + d + '…');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^This folder belongs to the WSL distro "([^"]+)", but this window is connected to "([^"]+)"\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^This folder belongs to the WSL distro "([^"]+)", but this window is connected to "([^"]+)"\.?$/i, '此文件夹属于 WSL 发行版“$1”，但当前窗口连接到“$2”。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^This location cannot be opened in WSL:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^This location cannot be opened in WSL:\s*(.+)$/i, (_m, loc) => '无法在 WSL 中打开此位置: ' + loc);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^The WSL distro "([^"]+)" is no longer installed\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^The WSL distro "([^"]+)" is no longer installed\.?$/i, 'WSL 发行版“$1”已不再安装。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Antigravity opened on Windows instead\.?$/i.test(trimmed)) {
      const fixed = 'Antigravity 已改为在 Windows 本地打开。';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Connected to WSL:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Connected to WSL:\s*(.+)$/i, (_m, d) => '已连接到 WSL: ' + d);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/% of the (?:customization )?budget is (?:available|used)/i.test(trimmed)) {
      let fixed = trimmed;
      if (/^%\s*of the (?:customization )?budget is available[.。]?$/i.test(trimmed)) {
        fixed = '% 的自定义额度可用。';
      } else if (/^%\s*of the (?:customization )?budget is used[.。]?$/i.test(trimmed)) {
        fixed = '% 的自定义额度已使用。';
      } else if (/available/i.test(trimmed)) {
        fixed = trimmed.replace(/(\d+(?:\.\d+)?)% of the (?:customization )?budget is available[.。]?/i, '自定义额度尚有 $1% 可用。');
      } else if (/used/i.test(trimmed)) {
        fixed = trimmed.replace(/(\d+(?:\.\d+)?)% of the (?:customization )?budget is used[.。]?/i, '已使用 $1% 的自定义额度。');
      }
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 思考耗时、文件统计与限额动态匹配 =====
    if (/^Thought (?:for|持续) (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Thought (?:for|持续) (.+)$/i, (_m, t) => '思考了 ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Thinking (?:for|持续) (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Thinking (?:for|持续) (.+)$/i, (_m, t) => '思考了 ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Thinking \((.+)\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Thinking \((.+)\)$/i, (_m, t) => '正在思考 (' + t + ')');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Worked (?:for|持续) (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Worked (?:for|持续) (.+)$/i, (_m, t) => '总耗时 ' + t);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^\d+ files? changed(.*)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+) files? changed(.*)$/i, (_m, n, rest) => n + ' 个文件已更改' + rest);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+searches?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+searches?$/i, '$1 次搜索');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Edited (.*) \+(\d+) -(\d+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Edited (.*) \+(\d+) -(\d+)$/i, (_m, f, a, d) => '编辑 ' + f + ' (+' + a + ' -' + d + ')');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 限额剩余标题动态匹配（补齐 Monthly Limit Remaining）
    if (/^(Weekly|Monthly|Five[- ]Hour|5[- ]Hour|Hourly|Daily)\s+Limit\s+Remaining$/i.test(trimmed)) {
      const lower = trimmed.toLowerCase();
      let fixed = '每周限额剩余';
      if (lower.includes('monthly')) fixed = '每月限额剩余';
      else if (lower.includes('five') || lower.includes('5')) fixed = '5 小时限额剩余';
      else if (lower.includes('hourly')) fixed = '每小时限额剩余';
      else if (lower.includes('daily')) fixed = '每日限额剩余';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s+(Weekly|Five[- ]Hour|5[- ]Hour|\d+[- ]?Hour|\d+h|Hourly|Daily|Monthly)\s+Limit(\s+Remaining)?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+(Weekly|Five[- ]Hour|5[- ]Hour|(\d+)[- ]?Hour|(\d+)h|Hourly|Daily|Monthly)\s+Limit(\s+Remaining)?$/i, (_m, prefix, period, h1, h2, rem) => {
        const pLower = period.toLowerCase();
        let periodCn = '每周限额';
        if (pLower.includes('five') || pLower === '5-hour' || pLower === '5 hour' || pLower === '5h') periodCn = '5 小时限额';
        else if (h1 || h2) periodCn = (h1 || h2) + ' 小时限额';
        else if (pLower.includes('hourly')) periodCn = '每小时限额';
        else if (pLower.includes('daily')) periodCn = '每日限额';
        else if (pLower.includes('monthly')) periodCn = '每月限额';
        const prefixTrim = prefix.trim();
        const prefixCn = dictionary[prefixTrim] || lowerDictionary.get(prefixTrim.toLowerCase()) || prefixTrim;
        return prefixCn + ' ' + periodCn + (rem ? '剩余' : '');
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Show\s+(\d+)\s+more\s+subagents?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Show\s+(\d+)\s+more\s+subagents?$/i, '显示其余 $1 个子智能体');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Show\s+less$/i.test(trimmed)) {
      const fixed = '收起';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 配额用量与完全刷新提示（支持 weekly/monthly/daily/hourly/5-hour，严格一次幂等，无双冒号与残留句点）
    if (/^(?:You have used some of your|您已使用了部分)\s*(?:weekly|monthly|5[- ]hour|five[- ]hour|hourly|daily|每周|每月|5\s*小时|五小时|每小时|每日)\s*(?:limit|限额)/i.test(trimmed)) {
      let fixed = trimmed
        .replace(/^(?:You have used some of your|您已使用了部分)\s*(?:weekly|每周)\s*(?:limit|限额)[.。]?/i, '您已使用了部分每周限额。')
        .replace(/^(?:You have used some of your|您已使用了部分)\s*(?:monthly|每月)\s*(?:limit|限额)[.。]?/i, '您已使用了部分每月限额。')
        .replace(/^(?:You have used some of your|您已使用了部分)\s*(?:5[- ]hour|five[- ]hour|5\s*小时|五小时)\s*(?:limit|限额)[.。]?/i, '您已使用了部分 5 小时限额。')
        .replace(/^(?:You have used some of your|您已使用了部分)\s*(?:hourly|每小时)\s*(?:limit|限额)[.。]?/i, '您已使用了部分每小时限额。')
        .replace(/^(?:You have used some of your|您已使用了部分)\s*(?:daily|每日)\s*(?:limit|限额)[.。]?/i, '您已使用了部分每日限额。');
      fixed = fixed.replace(/\s*(?:It will fully refresh in|它将在以下时间后完全刷新)[：:\s]*(.+?)[.。]?$/i, (_m, rest) => {
        return '它将在以下时间后完全刷新：' + formatDurationCn(rest);
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Within each group, models share/.test(trimmed)) {
      const fixed = '在每个分组中，模型共享每周限额和 5 小时限额。配额按 token 成本比例消耗。因此，较短的任务或使用更具性价比的模型时，限额可持续更长时间。5 小时限额用于平滑总需求，以便在所有用户间公平分配全球容量，而每周限额则与您的个人等级直接挂钩。';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)h\s+limit$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)h\s+limit$/i, '$1 小时限额');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+hours?\s+(\d+)\s+minutes?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+hours?\s+(\d+)\s+minutes?$/i, '$1 小时 $2 分钟');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^(\d+)\s+minutes?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+minutes?$/i, '$1 分钟');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^(\d+)\s+hours?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+hours?$/i, '$1 小时');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^(\d+)\s+days?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+days?$/i, '$1 天');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 收紧主语词数上限（<= 4 词且不含从句连词），避免误伤英文长提示句
    if (/^(.+)\s+does not exist\.?$/i.test(trimmed)) {
      const subj = trimmed.replace(/\s+does not exist\.?$/i, '').trim();
      if (subj.split(/\s+/).length <= 4 && !/\b(?:because|that|which|when|while)\b/i.test(subj)) {
        const fixed = subj + ' 不存在';
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    if (/^(.+)\s+was not found\.?$/i.test(trimmed)) {
      const subj = trimmed.replace(/\s+was not found\.?$/i, '').trim();
      if (subj.split(/\s+/).length <= 4 && !/\b(?:because|that|which|when|while)\b/i.test(subj)) {
        const fixed = subj + ' 未找到';
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    if (/^([A-Za-z]+)\s+not\s+found\.?$/i.test(trimmed)) {
      const noun = trimmed.replace(/\s+not\s+found\.?$/i, '');
      const nounLower = noun.toLowerCase();
      const nounCn = Object.prototype.hasOwnProperty.call(coreWords, nounLower)
        ? coreWords[nounLower]
        : (Object.prototype.hasOwnProperty.call(dictionary, noun) ? dictionary[noun] : lowerDictionary.get(nounLower));
      if (nounCn && /[\u4e00-\u9fa5]/.test(nounCn)) {
        const fixed = nounCn + '未找到' + (/\.$/.test(trimmed) ? '。' : '');
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    if (/^Step \d+ \([^)]+\):?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Step (\d+) \(([^)]+)\):?$/i, '步骤 $1 ($2)：');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^\d+ turns?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+) turns?$/i, '$1 回合');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Turn \d+$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Turn (\d+)$/i, '第 $1 回合');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Task id "[^"]+" finished with result:$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Task id "([^"]+)" finished with result:$/i, (_m, id) => '任务 "' + id + '" 执行完成：');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Tool is running as a background task with task id: (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Tool is running as a background task with task id: (.+)$/i, (_m, id) => '工具正在后台运行 (任务ID: ' + id + ')');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Version\s+(\d+.*)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Version\s+(\d+.*)$/i, (_m, v) => '版本 ' + v);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 收紧 Updated 时间戳正则：仅后接明确时间词或月份数字才译为 "更新于"
    if (/^Updated\s+(?:just now|today|yesterday|\d|a\s+(?:moment|few|minute|hour|day|week|month|year)|an\s+hour|last\s+|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Updated\s+(.+)$/i, (_m, rest) => '更新于 ' + rest)
        .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/gi, (_m, mon, day) => {
          const monMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
          return monMap[mon.toLowerCase()] + '月' + day + '日';
        });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 计划审核策略提示兼容形态
    if (/^(?:Type|输入)\s*\/\s*(?:and|并|和)?\s*(?:select|选择)?\s*['"]?plan['"]?\s*to\s+have\s+the\s+agent\s+generate\s+a\s+plan[。.]?$/i.test(trimmed)) {
      const fixed = /[。.]\s*$/.test(trimmed) ? '输入 / 并选择 plan 来让智能体生成计划。' : '输入 / 并选择 plan 来让智能体生成计划';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^(?:to\s+)?have\s+the\s+agent\s+generate\s+a\s+plan[。.]?$/i.test(trimmed)) {
      const fixed = /[。.]\s*$/.test(trimmed) ? '来让智能体生成计划。' : '来让智能体生成计划';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^plan\s+to\s+have\s+the\s+agent\s+generate\s+a\s+plan[。.]?$/i.test(trimmed)) {
      const fixed = /[。.]\s*$/.test(trimmed) ? 'plan 来让智能体生成计划。' : 'plan 来让智能体生成计划';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }
    if (/^(?:Type|输入)\s*\/\s*(?:and|并|和)(?:\s*(?:select|选择))?\s*$/i.test(trimmed)) {
      const fixed = /(?:select|选择)\s*$/i.test(trimmed) ? '输入 / 并选择' : '输入 / 并';
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Models within this group:\s*(.*)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Models within this group:\s*(.*)$/i, (_m, list) => '本组内的模型：' + list.trim());
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Select project, current: (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Select project, current: (.+)$/i, (_m, v) => '选择项目，当前：' + v);
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Agent permissions preset selector, current: (.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Agent permissions preset selector, current: (.+)$/i,
        (_m, v) => '智能体权限预设选择器，当前：' + v.replace(/Turbo/gi, '极速模式'));
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== v2.33.0 新增动态规则：Voices / Dictation / Computer Use / Browser Data / Shortcuts / Bundles / Step Plan / SSH =====
    if (/^([^,]+),\s*voice\s+(\d+)\s+of\s+(\d+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^([^,]+),\s*voice\s+(\d+)\s+of\s+(\d+)$/i, '$1，第 $2 / $3 个音色');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Retrying transcription \(attempt (\d+)\)[.…]*$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Retrying transcription \(attempt (\d+)\)[.…]*$/i, '正在重试转写（第 $1 次尝试）…');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // Computer Use / Agents Live 暂停接管横幅、窗口标题提示、游标胶囊与智能体状态芯片（长句在前，防 ^Agent: 短前缀截胡）
    if (/^(.+?)\s+is paused in\s+(.+?);\s*its view keeps playing here\.\s*Resume to let it continue\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+is paused in\s+(.+?);\s*its view keeps playing here\.\s*Resume to let it continue\.?$/i, (_m, who, app) => {
        const isGeneric = /^the agent$/i.test(who.trim());
        const whoCn = isGeneric ? '智能体' : translateString(who.trim());
        return whoCn + (isGeneric ? '已在 ' : ' 已在 ') + app + ' 中暂停；其画面仍在此处实时播放。点击“恢复”即可让其继续操作。';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s*·\s*(Agent:\s*.+?)\s*\((Focus this tile|Back to all agents)\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s*·\s*(Agent:\s*.+?)\s*\((Focus this tile|Back to all agents)\)$/i, (_m, title, ag, act) => {
        const actCn = /focus/i.test(act) ? '聚焦此视图' : '返回全部智能体';
        return title + ' · ' + translateString(ag) + '（' + actCn + '）';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Agent:\s*([^;\n]{1,60})$/i.test(trimmed)) {
      const rest = trimmed.replace(/^Agent:\s*/i, '');
      const parts = rest.split(/\s*·\s*/);
      const nameCn = parts[0].toLowerCase() === 'unnamed' ? '未命名' : parts[0];
      const intentMap = {
        'press': '点击',
        'select': '选择',
        'typing': '正在输入',
        'scroll ↕': '滚动 ↕',
        'scroll': '滚动',
        'pointer': '移动指针',
        'looking': '正在查看',
        'waiting for the pointer': '等待指针控制权'
      };
      const mapped = [
        '智能体：' + nameCn,
        ...parts.slice(1).map(p => intentMap[p.toLowerCase()] || p)
      ];
      const fixed = mapped.join(' · ');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^·\s*(?:(.+?)\s*·\s*)?(foreground|background|paused|stopped)$/i.test(trimmed)) {
      const stateMap = { foreground: '前台', background: '后台', paused: '已暂停', stopped: '已停止' };
      const fixed = trimmed.replace(/^·\s*(?:(.+?)\s*·\s*)?(foreground|background|paused|stopped)$/i, (_m, app, st) => {
        const stCn = stateMap[st.toLowerCase()] || st;
        return app ? ('· ' + app + ' · ' + stCn) : ('· ' + stCn);
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Hidden by policy \((.+)\)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Hidden by policy \((.+)\)\.?$/i, '已按策略隐藏（$1）。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 内置浏览器按站点 Cookie 管理、预览端口与文件体积限制
    if (/^(\d+)\s+cookies?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+cookies?$/i, '$1 个 Cookie');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Delete cookies for\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Delete cookies for\s+(.+)$/i, '删除 $1 的 Cookie');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Deleted cookies for\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Deleted cookies for\s+(.+)$/i, '已删除 $1 的 Cookie');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Showing latest\s+(\d+)\s+browser steps$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Showing latest\s+(\d+)\s+browser steps$/i, '正在显示最近 $1 个浏览器步骤');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^The preview did not respond on port\s+(\d+)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^The preview did not respond on port\s+(\d+)\.?$/i, '端口 $1 上的预览未响应。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Nothing is running on port\s+(\d+)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Nothing is running on port\s+(\d+)\.?$/i, '端口 $1 上没有正在运行的服务');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^File exceeds the\s+(\d+(?:\.\d+)?)MB display limit(?:\s*\((\d+(?:\.\d+)?)MB\))?,\s*so it can't be opened or downloaded here\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^File exceeds the\s+(\d+(?:\.\d+)?)MB display limit(?:\s*\((\d+(?:\.\d+)?)MB\))?,\s*so it can't be opened or downloaded here\.?$/i, (_m, lim, sz) => {
        return sz ? ('文件（' + sz + 'MB）超出 ' + lim + 'MB 显示上限，无法在此处打开或下载。') : ('文件超出 ' + lim + 'MB 显示上限，无法在此处打开或下载。');
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // 快捷键录制冲突提示（支持多条冲突通过 "; " 连接）
    if (/^Conflicts with "/i.test(trimmed)) {
      const parts = trimmed.split(/;\s*/);
      const translatedParts = parts.map(part => {
        if (/^Conflicts with "(.+)" \(press Enter to replace\)$/i.test(part)) {
          return part.replace(/^Conflicts with "(.+)" \(press Enter to replace\)$/i, '与“$1”冲突（按 Enter 替换）');
        }
        if (/^Conflicts with "(.+)" \(managed by application menu\)$/i.test(part)) {
          return part.replace(/^Conflicts with "(.+)" \(managed by application menu\)$/i, '与“$1”冲突（由应用程序菜单管理）');
        }
        if (/^Conflicts with "(.+)"$/i.test(part)) {
          return part.replace(/^Conflicts with "(.+)"$/i, '与“$1”冲突');
        }
        return part;
      });
      const fixed = translatedParts.join('；');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // Marketplace Bundles 与插件/技能源码安全审查提示
    

    if (/^No (plugin|skill|bundle) found for$/i.test(trimmed)) {
      const fixed = /bundle/i.test(trimmed) ? '未找到对应的插件组合包：' : (/skill/i.test(trimmed) ? '未找到对应的技能：' : '未找到对应的插件：');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Add bundle\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Add bundle\s+(.+)$/i, '添加组合包 $1');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Adding plugins from\s+(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Adding plugins from\s+(.+)$/i, '正在从 $1 添加插件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Added\s+(.+?)\s+and installed\s+(\d+)\s+plugins?\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Added\s+(.+?)\s+and installed\s+(\d+)\s+plugins?\.?$/i, '已添加 $1 并安装 $2 个插件。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+plugins?,\s*all already installed\.\s*Adding the bundle installs plugins it gains later\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+plugins?,\s*all already installed\.\s*Adding the bundle installs plugins it gains later\.?$/i, '共 $1 个插件，均已安装。添加此组合包后，未来新增的插件将自动安装。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+plugins?\.\s*Adding the bundle installs plugins it gains later\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+plugins?\.\s*Adding the bundle installs plugins it gains later\.?$/i, '共 $1 个插件。添加此组合包后，未来新增的插件将自动安装。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+plugins?\.\s*Add bundle installs (?:it|all of them)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+plugins?\.\s*Add bundle installs (?:it|all of them)\.?$/i, (_m, n) => {
        return Number(n) === 1 ? '共 1 个插件。点击“添加组合包”即可安装。' : ('共 ' + n + ' 个插件。点击“添加组合包”将全部安装。');
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+plugins?\.\s*Add bundle installs\s+(\d+);\s*the ones you already have stay as they are\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+plugins?\.\s*Add bundle installs\s+(\d+);\s*the ones you already have stay as they are\.?$/i, '共 $1 个插件。点击“添加组合包”将安装其余 $2 个；已安装的插件保持不变。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+plugins?\.\s*Disabling or removing the bundle applies only to the ones it installed\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+plugins?\.\s*Disabling or removing the bundle applies only to the ones it installed\.?$/i, '共 $1 个插件。禁用或移除组合包仅影响由该组合包安装的插件。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Review\s+(plugin|skill|bundle)\s+before\s+(?:installing|adding)$/i.test(trimmed)) {
      const fixed = /bundle/i.test(trimmed) ? '添加前审查组合包' : (/skill/i.test(trimmed) ? '安装前审查技能' : '安装前审查插件');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^This\s+(plugin|skill)'s source is in\s+(.+?),\s*which can have looser review standards than standard Google code\.\s*Review its contents before installing\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^This\s+(plugin|skill)'s source is in\s+(.+?),\s*which can have looser review standards than standard Google code\.\s*Review its contents before installing\.?$/i, (_m, kind, src) => {
        const kindCn = /skill/i.test(kind) ? '技能' : '插件';
        return '此' + kindCn + '的源码位于 ' + src + '，其代码审查标准可能比标准 Google 代码更宽松。请在安装前审查其内容。';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(?:This plugin|These plugins) in\s+(.+?)\s+may have looser code review\.\s*Review (?:its|their) contents before adding the bundle\.?$/i.test(trimmed)) {
      const isPlural = /^These/i.test(trimmed);
      const fixed = trimmed.replace(/^(?:This plugin|These plugins) in\s+(.+?)\s+may have looser code review\.\s*Review (?:its|their) contents before adding the bundle\.?$/i,
        isPlural ? '$1 中的以下插件代码审查可能较宽松，请在添加组合包前审查其内容。' : '$1 中的此插件代码审查可能较宽松，请在添加组合包前审查其内容。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(.+?)\s+may have looser code review\.\s*Review (?:its|their) contents before adding the bundle\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(.+?)\s+may have looser code review\.\s*Review (?:its|their) contents before adding the bundle\.?$/i, (_m, items) => {
        const itemsCn = items
          .replace(/\bPrototype\b/g, '原型')
          .replace(/\bExperimental\b/g, '实验性')
          .replace(/\bThird-party\b/g, '第三方');
        return itemsCn + ' 的代码审查可能较宽松，请在添加组合包前审查其内容。';
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // Step Plan 步骤计划进度条与折叠胶囊
    if (/^Plan,\s*(\d+)\s+of\s+(\d+)\s+steps done$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Plan,\s*(\d+)\s+of\s+(\d+)\s+steps done$/i, '计划：已完成 $1 / $2 步');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\/(\d+)\s+steps(?:\s*·\s*(\d+)\s+failed)?(?:\s*·\s*(\d+)\s+skipped)?(?:\.\s*(Show|Hide)\s+plan)?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\/(\d+)\s+steps(?:\s*·\s*(\d+)\s+failed)?(?:\s*·\s*(\d+)\s+skipped)?(?:\.\s*(Show|Hide)\s+plan)?$/i, (_m, d, t, fail, skip, toggle) => {
        let res = d + '/' + t + ' 步';
        if (fail) res += ' · ' + fail + ' 失败';
        if (skip) res += ' · ' + skip + ' 已跳过';
        if (toggle) res += '。' + (/hide/i.test(toggle) ? '隐藏计划' : '显示计划');
        return res;
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Side question \(conversation ([^)]+)\):\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Side question \(conversation ([^)]+)\):\s*(.+)$/i, '侧边提问（对话 $1）：$2');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // Remote SSH 新增登录归属、连接通知与远程 Chrome 调试引导
    if (/^You're signing in on\s+(.+?)\.\s*Your sign-in stays on that machine\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^You're signing in on\s+(.+?)\.\s*Your sign-in stays on that machine\.?$/i, '你正在 $1 上登录。登录状态将保存在该机器上。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Connected to\s+(?!WSL:)(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Connected to\s+(.+)$/i, '已连接到 $1');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Connecting to\s+(.+?)[.…]*$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Connecting to\s+(.+?)[.…]*$/i, '正在连接到 $1…');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^This window's agents, files, and terminals are on\s+(.+?)\.?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^This window's agents, files, and terminals are on\s+(.+?)\.?$/i, '此窗口的智能体、文件与终端均运行在 $1 上。');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^(\d+)\s+hidden\s+hosts?$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^(\d+)\s+hidden\s+hosts?$/i, '$1 个已隐藏的主机');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^SSH Config \((.+)\)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^SSH Config \((.+)\)$/i, 'SSH 配置 ($1)');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Browser tools run on\s+(.+?),\s*the SSH host this window is connected to,\s*and Chrome there isn't accepting remote debugging\.\s*Complete these steps on\s+(.+?),\s*not on this computer:$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Browser tools run on\s+(.+?),\s*the SSH host this window is connected to,\s*and Chrome there isn't accepting remote debugging\.\s*Complete these steps on\s+(.+?),\s*not on this computer:$/i,
        '浏览器工具运行在当前窗口连接的 SSH 主机 $1 上，而该主机上的 Chrome 尚未开启远程调试。请在 $2（而非本机）上完成以下步骤：');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Open Google Chrome on\s+(.+?)\.$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Open Google Chrome on\s+(.+?)\.$/i, (_m, h) => {
        const isGeneric = /^the ssh host$/i.test(h.trim());
        return isGeneric ? '在该 SSH 主机上打开 Google Chrome。' : ('在 ' + h + ' 上打开 Google Chrome。');
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^If\s+(.+?)\s+is a Cloudtop,\s*open it in$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^If\s+(.+?)\s+is a Cloudtop,\s*open it in$/i, (_m, h) => {
        const isGeneric = /^the ssh host$/i.test(h.trim());
        return isGeneric ? '如果该 SSH 主机是 Cloudtop，请通过以下入口打开：' : ('如果 ' + h + ' 是 Cloudtop，请通过以下入口打开：');
      });
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^Your Plan:\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Your Plan:\s*(.+)$/i, '您的计划：$1');
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    if (/^You(?:'re|\s+are)\s+subscribed\s+to\s+the\s+(?:best|highest|top(?:-tier)?)\s+(.+?)\s+plan([.!]?)$/i.test(trimmed)) {
      const fixed = trimmed.replace(
        /^You(?:'re|\s+are)\s+subscribed\s+to\s+the\s+(?:best|highest|top(?:-tier)?)\s+(.+?)\s+plan([.!]?)$/i,
        (_m, tier, punct) => '您已订阅最高等级的 ' + tier + ' 计划' + (punct ? '。' : '')
      );
      cacheSet(trimmed, fixed);
      return replaceTrimmed(text, trimmed, fixed);
    }

    // ===== 智能体权限作用域提示：<项目名> setting / Your Remote setting / Your This Computer setting =====
    if (/^(.{1,60}) setting$/.test(trimmed)) {
      const scopeKey = trimmed.slice(0, -8).trim();
      // 停用常见英文设置词，并为英文长句设置首词/大小写守卫，同时兼容 my-app 等小写项目文件夹名
      const scopeCommon = /^(?:proxy|system|display|environment|network|keyboard|editor|terminal|audio|video|browser|privacy|appearance|notification|account|billing|search|default|project|security|session|cookie|user|local|global|custom|theme|font|language|timezone|timeout|color|tab|spacing|indent|scale|cursor|permissions?|this|that|your|my|our|their|his|her|its|the|an?|some|any|each|every|one|same|other|new|old|current|previous|next|first|last)s?$/i;
      const scopeProseStarter = /^(?:configure|enable|disable|change|update|reset|set|use|keep|edit|select|choose|check|override|follow|apply|increase|decrease|adjust|modify|save|clear|delete|remove|find|see|try|need|want|make|too|no|not|all|any|some|each|every|your|this|that|the|an?|our|their|his|her|its)\b/i;
      let scopeCn = '';
      if (scopeKey === 'Your This Computer') {
        scopeCn = '沿用你在「本机」的设置';
      } else if (scopeKey === 'Your Remote') {
        scopeCn = '沿用你在「远程」的设置';
      } else if (scopeKey && !scopeCommon.test(scopeKey)) {
        const hasCjk = /[\u4e00-\u9fa5]/.test(scopeKey);
        const isSingleToken = !/\s/.test(scopeKey);
        const isSlugOrScoped = isSingleToken && (/^[A-Z]/.test(scopeKey) || /[-_.\d]/.test(scopeKey));
        const isTitlePhrase = /\s/.test(scopeKey)
          && !scopeProseStarter.test(scopeKey)
          && scopeKey.split(/\s+/).every(tok => /^[A-Z0-9]/.test(tok) || /^(?:of|for|and|in|on|to|v\d+)$/i.test(tok));
        if (hasCjk || isSlugOrScoped || isTitlePhrase) {
          scopeCn = '沿用「' + scopeKey + '」的设置';
        }
      }
      if (scopeCn) {
        cacheSet(trimmed, scopeCn);
        return replaceTrimmed(text, trimmed, scopeCn);
      }
    }

    // ===== 语音通话浮层：语速提示 / 静音 tooltip / 结束按钮 =====
    if (/^Voice speed, (.+)$/.test(trimmed)) {
      const speedCn = '语速，' + trimmed.replace(/^Voice speed, /, '');
      cacheSet(trimmed, speedCn);
      return replaceTrimmed(text, trimmed, speedCn);
    }

    if (/^(Unmute|Mute) (mic|Antigravity|Jetski) \(([^)]+)\)$/.test(trimmed)) {
      const muteMatch = trimmed.match(/^(Unmute|Mute) (mic|Antigravity|Jetski) \(([^)]+)\)$/);
      const muteTarget = muteMatch[2] === 'mic' ? '麦克风' : muteMatch[2];
      const muteCn = (muteMatch[1] === 'Mute' ? '静音' : '取消静音')
        + (muteTarget === '麦克风' ? '' : ' ')
        + muteTarget + ' (' + muteMatch[3] + ')';
      cacheSet(trimmed, muteCn);
      return replaceTrimmed(text, trimmed, muteCn);
    }

    // 通话栏结束按钮：只匹配首字母大写的独立 "End"，避免 lowerDictionary 误伤正文里的 end
    if (trimmed === 'End') {
      cacheSet(trimmed, '结束');
      return replaceTrimmed(text, trimmed, '结束');
    }

    // ===== 删除确认弹窗：资源名以 <strong> 插值，句子被拆成「前缀 + 名称 + 后缀」 =====
    // 前缀（Are you sure you want to delete / ... the）词典已收录，这里只补后缀片段
    if (/^\? This action cannot be undone\.$/.test(trimmed)) {
      cacheSet(trimmed, '吗？此操作无法撤销。');
      return replaceTrimmed(text, trimmed, '吗？此操作无法撤销。');
    }
    // ===== 归档提示：markdown 里的行内图标把句子切成「前缀 + 图标 + 后缀」 =====
    if (/^View archived in the sidebar \($/.test(trimmed)) {
      cacheSet(trimmed, '已归档内容可在侧边栏（');
      return replaceTrimmed(text, trimmed, '已归档内容可在侧边栏（');
    }

    if (/^menu\)\.$/.test(trimmed)) {
      cacheSet(trimmed, '菜单）中查看。');
      return replaceTrimmed(text, trimmed, '菜单）中查看。');
    }
    // 5. 大小写不敏感词典查找与末尾标点剥离重拼（O(1)，命中写入 stringCache）
    const caseInsensitiveHit = lowerDictionary.get(trimmed.toLowerCase());
    if (caseInsensitiveHit !== undefined) {
      cacheSet(trimmed, caseInsensitiveHit);
      return replaceTrimmed(text, trimmed, caseInsensitiveHit);
    }

    let core = trimmed;
    let trailPunc = '';
    let matchPunc = '';

    const puncRegex = /(\.\.\.|…|\.|\?|!|:|：|？|！|。)$/;
    const match = core.match(puncRegex);
    if (match) {
      matchPunc = match[0];
      core = core.slice(0, -matchPunc.length).trim();
      if (matchPunc === '.') trailPunc = '。';
      else if (matchPunc === '?') trailPunc = '？';
      else if (matchPunc === '!') trailPunc = '！';
      else if (matchPunc === ':') trailPunc = '：';
      else trailPunc = matchPunc;
    }

    if (core) {
      const coreTranslated = Object.prototype.hasOwnProperty.call(dictionary, core)
        ? dictionary[core]
        : lowerDictionary.get(core.toLowerCase());
      if (coreTranslated !== undefined && coreTranslated !== '') {
        const fixed = coreTranslated + trailPunc;
        cacheSet(trimmed, fixed);
        return replaceTrimmed(text, trimmed, fixed);
      }
    }

    // 6. coreWords 短词组合回退（严格 <= 3 词且 100% 英文单词命中守卫，彻底消灭半中半英夹生词）
    if (!core || /[\u4e00-\u9fa5]/.test(core) || /[-_\\/.]/.test(core)) {
      if (trimmed.length <= 200) cacheSet(trimmed, trimmed);
      return text;
    }

    const words = core.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 3) {
      if (trimmed.length <= 200) cacheSet(trimmed, trimmed);
      return text;
    }

    let replacedAny = false;
    const translatedTokens = [];
    for (let i = 0; i < words.length; i++) {
      const tok = words[i];
      if (!/[a-zA-Z]/.test(tok)) {
        translatedTokens.push(tok);
        continue;
      }
      if (!/^[a-zA-Z]+$/.test(tok)) {
        // 含数字或特殊符号的混合词（如 24m, 11h, 1mo）若未精确收录，立即放弃拼凑保持英文原样
        const exactTok = Object.prototype.hasOwnProperty.call(dictionary, tok)
          ? dictionary[tok]
          : lowerDictionary.get(tok.toLowerCase());
        if (exactTok === undefined) {
          cacheSet(trimmed, trimmed);
          return text;
        }
        if (exactTok !== tok) replacedAny = true;
        translatedTokens.push(exactTok);
        continue;
      }
      const lw = tok.toLowerCase();
      let wordCn;
      if (Object.prototype.hasOwnProperty.call(coreWords, lw)) {
        wordCn = coreWords[lw];
      } else if (Object.prototype.hasOwnProperty.call(dictionary, tok)) {
        wordCn = dictionary[tok];
      } else {
        wordCn = lowerDictionary.get(lw);
      }
      if (wordCn === undefined) {
        // 存在任何一个未知英文单词，立即放弃分词拼凑并返回干净原文
        cacheSet(trimmed, trimmed);
        return text;
      }
      if (wordCn !== tok) replacedAny = true;
      translatedTokens.push(wordCn);
    }

    if (!replacedAny) {
      cacheSet(trimmed, trimmed);
      return text;
    }

    let finalTranslated = translatedTokens.join(' ')
      .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
      .replace(/^Ran\s*命令$/i, '已运行命令')
      .replace(/^Running\s*命令$/i, '正在运行命令')
      .replace(/^Run\s*命令$/i, '运行命令')
      .replace(/Advanced\s*设置/gi, '高级设置')
      .replace(/继承\s*Global/gi, '继承全局');

    if (matchPunc) {
      finalTranslated += trailPunc;
    }
    cacheSet(trimmed, finalTranslated);
    return replaceTrimmed(text, trimmed, finalTranslated);
  }

  // 精确匹配代码编辑器、语法高亮及内置终端（xterm）容器类名
  const codeClassPattern = /(?:^|[\s_-])(monaco-editor|editor-instance|hljs|shiki|prism|codemirror|line-content|gutter|codeblock|code-block|code-line|view-line|xterm|xterm-rows|xterm-screen|xterm-accessibility)(?:$|[\s_-])/i;

  // 提及菜单 (@ Mentions) 分类白名单：放行汉化，同时保持斜杠命令 (/boost 等) 与代码文件名严格跳过
  const MENTION_CATEGORIES = new Set([
    'Rules', '规则',
    'Conversation', '对话',
    'PDF Document', 'PDF 文档',
    'MCP Resource', 'MCP 资源',
    'Browser Page', '浏览器页面',
    'Browser Text', '浏览器文本',
    'Directory', '目录',
    'Git Commit', 'Git 提交',
    'Git Diff', 'Git 差异'
  ]);

  const skipCache = new WeakMap();

  function shouldSkipNode(node) {
    if (!node) return true;

    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) return false;

    // 动态编辑态瞬时拦截（防止动态挂载 contenteditable 后命中旧缓存）
    if (element.isContentEditable || (element.getAttribute && (
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('role') === 'textbox' ||
      element.getAttribute('data-lexical-editor') === 'true'
    ))) {
      return true;
    }

    const upperTag = (element.tagName || '').toUpperCase();

    // 绝对禁止翻译的脚本/样式/矢量图/公式/行内代码/预格式化代码块标签
    const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'KBD', 'SAMP', 'VAR', 'SVG', 'MATH', 'CODE', 'PRE', 'INPUT', 'TEXTAREA'];
    if (skipTags.includes(upperTag)) {
      skipCache.set(element, true);
      return true;
    }

    // 斜杠命令与提及建议菜单触发词标签（动态复用节点，绝不写入 skipCache 防止缓存毒化）
    const isMenuOptionLabel = element.closest && element.closest('[data-testid="menu-option-label"]');
    if (isMenuOptionLabel) {
      const labelText = (isMenuOptionLabel.innerText || isMenuOptionLabel.textContent || '').trim();
      return !MENTION_CATEGORIES.has(labelText);
    }

    // 思考过程触发药丸按钮（如 "Thought for 4s"）：放行汉化
    const isThinkingTrigger = element.closest && element.closest('button[data-testid="thinking-collapsible-trigger"]');
    if (isThinkingTrigger) {
      skipCache.set(element, false);
      return false;
    }

    // 排队发送控制栏与用户消息操作栏（且不在用户正文 user-message-content 内）：放行汉化
    const isUserActionDecorator = element.closest && element.closest('[data-testid="queued-decorators"], [data-testid="user-message-actions"]');
    if (isUserActionDecorator && !(element.closest && element.closest('[data-testid="user-message-content"]'))) {
      skipCache.set(element, false);
      return false;
    }

    // 选中文本快捷引用气泡（Quote）及 /btw 提问气泡（Ask /btw）特权放行（依赖动态文本，不写 skipCache）
    const textContent = (element.innerText || element.textContent || '').trim();
    if (/^(?:Quote|Ask(?:\s+|\s*\/\s*)btw)(?:\s+(?:Ctrl|Cmd)(?:\+[a-zA-Z0-9]+)+)?$/i.test(textContent)) {
      return false;
    }

    // 执行步骤状态药丸（已在上方拦截 CODE/PRE，绝不误伤 Markdown 行内代码；依赖动态文本不写 skipCache）
    const isActionPill = textContent.length <= 40 && /^(Explored|Exploring|Ran|Run|Running|Viewed|Viewing|Edited|Editing|Thought|Thinking|Working|Done|Analyzed|Analyzing|Created|Creating|Deleted|Deleting|Waiting|Rejected|Errored|Completed|Used)(\s+(command|commands|files?|tools?|artifacts?))?$/i.test(textContent);
    if (isActionPill) {
      let inProtectedAncestor = false;
      let checkCur = element;
      while (checkCur && checkCur !== document.body) {
        const curTag = (checkCur.tagName || '').toUpperCase();
        if (curTag === 'CODE' || curTag === 'PRE' || curTag === 'SVG' || curTag === 'MATH') {
          inProtectedAncestor = true;
          break;
        }
        if (checkCur.getAttribute && (
          checkCur.getAttribute('data-testid') === 'user-message-content' ||
          checkCur.getAttribute('contenteditable') === 'true' ||
          checkCur.getAttribute('role') === 'textbox' ||
          checkCur.getAttribute('data-lexical-editor') === 'true'
        )) {
          inProtectedAncestor = true;
          break;
        }
        if (checkCur.classList && (
          checkCur.classList.contains('group/user-input-step') ||
          checkCur.classList.contains('user-message') ||
          checkCur.classList.contains('thought-content') ||
          checkCur.classList.contains('thinking-content') ||
          checkCur.classList.contains('thought-box') ||
          checkCur.classList.contains('cursor-edit') ||
          checkCur.classList.contains('katex') ||
          checkCur.classList.contains('mjx-container')
        )) {
          inProtectedAncestor = true;
          break;
        }
        if (checkCur.className && typeof checkCur.className === 'string' && codeClassPattern.test(checkCur.className)) {
          inProtectedAncestor = true;
          break;
        }
        if (checkCur.parentElement && checkCur.parentElement.querySelector) {
          const trigger = checkCur.parentElement.querySelector(':scope > button[data-testid="thinking-collapsible-trigger"]');
          if (trigger && checkCur !== trigger && !trigger.contains(checkCur)) {
            inProtectedAncestor = true;
            break;
          }
        }
        checkCur = checkCur.parentElement;
      }
      if (!inProtectedAncestor) {
        return false;
      }
    }

    // 静态结构缓存查询
    if (skipCache.has(element)) {
      return skipCache.get(element);
    }

    if (element.getAttribute && (
      element.getAttribute('data-language') ||
      element.getAttribute('data-code') ||
      element.getAttribute('data-line') ||
      element.getAttribute('data-line-number')
    )) {
      skipCache.set(element, true);
      return true;
    }

    // 向上递归检查祖先容器（用户消息正文、思考链、代码区、终端 xterm、公式 katex/mjx）
    let cur = element;
    let shouldSkip = false;
    while (cur && cur !== document.body) {
      if (skipCache.has(cur)) {
        shouldSkip = skipCache.get(cur);
        break;
      }

      const curTag = (cur.tagName || '').toUpperCase();
      if (curTag === 'PRE' || curTag === 'CODE' || curTag === 'SVG' || curTag === 'MATH' || curTag === 'MJX-CONTAINER') {
        shouldSkip = true;
        break;
      }

      if (cur.classList && (
        cur.classList.contains('cursor-edit') ||
        cur.classList.contains('thought-content') ||
        cur.classList.contains('thinking-content') ||
        cur.classList.contains('thought-box') ||
        cur.classList.contains('katex') ||
        cur.classList.contains('katex-display') ||
        cur.classList.contains('katex-html') ||
        cur.classList.contains('mjx-container')
      )) {
        shouldSkip = true;
        break;
      }

      if (cur.parentElement && cur.parentElement.querySelector) {
        const trigger = cur.parentElement.querySelector(':scope > button[data-testid="thinking-collapsible-trigger"]');
        if (trigger && cur !== trigger && !trigger.contains(cur)) {
          shouldSkip = true;
          break;
        }
      }

      if (cur.getAttribute && (
        cur.getAttribute('data-testid') === 'user-message-content' ||
        cur.getAttribute('contenteditable') === 'true' ||
        cur.getAttribute('role') === 'textbox' ||
        cur.getAttribute('data-lexical-editor') === 'true' ||
        cur.getAttribute('data-language') ||
        cur.getAttribute('data-code') ||
        cur.getAttribute('data-line') ||
        cur.getAttribute('data-line-number') ||
        cur.getAttribute('role') === 'code'
      )) {
        shouldSkip = true;
        break;
      }

      if (cur.classList && (
        cur.classList.contains('group/user-input-step') ||
        cur.classList.contains('user-message') ||
        cur.classList.contains('cursor-text') ||
        cur.classList.contains('monaco-editor') ||
        cur.classList.contains('editor-instance') ||
        cur.classList.contains('input-area') ||
        cur.classList.contains('chat-input')
      )) {
        shouldSkip = true;
        break;
      }

      if (cur.className && typeof cur.className === 'string') {
        const lowerClass = cur.className.toLowerCase();
        if (
          lowerClass.includes('code-line') ||
          lowerClass.includes('view-line') ||
          codeClassPattern.test(cur.className)
        ) {
          shouldSkip = true;
          break;
        }
      }

      cur = cur.parentElement;
    }

    skipCache.set(element, shouldSkip);
    return shouldSkip;
  }

  // 已处理文本节点记忆化 WeakMap（记录 node -> 上次处理后的 nodeValue，消除窗口 focus 时未变化英文段落重复扫描）
  const translatedNodes = new WeakMap();

  // 组合句翻译兜底（支持原英文锚点与已翻译内联锚点双向定位，不增删任何 Element 节点）
  function tryCombinedSentenceTranslation(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const children = Array.prototype.slice.call(element.childNodes);
    if (children.length < 2) return false;

    const slots = [];
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.nodeValue.trim()) {
          slots.push({ type: 'space', node: child });
          continue;
        }
        slots.push({ type: 'text', node: child });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!child.childNodes || child.childNodes.length !== 1 || child.firstChild.nodeType !== Node.TEXT_NODE) {
          return false;
        }
        slots.push({ type: 'anchor', node: child, anchorText: child.firstChild.nodeValue.trim() });
      } else {
        return false;
      }
    }

    const anchors = slots.filter(s => s.type === 'anchor');
    if (!anchors.length) return false;

    let fullText = '';
    for (const child of children) {
      fullText += child.nodeType === Node.TEXT_NODE ? child.nodeValue : (child.textContent || '');
    }
    const key = fullText.trim();
    if (!key || !/[A-Za-z]/.test(key)) return false;

    let translated = Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : lowerDictionary.get(key.toLowerCase());
    if (!translated) translated = translateString(key);
    if (!translated || translated === key) return false;

    let probe = 0;
    for (const a of anchors) {
      if (!a.anchorText || a.anchorText.length < 2) return false;
      let idx = translated.indexOf(a.anchorText, probe);
      let matchedText = a.anchorText;
      let shouldTranslateAnchor = false;
      if (idx < 0) {
        const anchorCn = translateString(a.anchorText);
        if (anchorCn && anchorCn !== a.anchorText && anchorCn.length >= 2) {
          idx = translated.indexOf(anchorCn, probe);
          if (idx >= 0) {
            matchedText = anchorCn;
            shouldTranslateAnchor = true;
          }
        }
      }
      if (idx < 0) return false;
      a.start = idx;
      a.end = idx + matchedText.length;
      a.newAnchorText = shouldTranslateAnchor ? matchedText : null;
      probe = a.end;
    }

    let anchorIdx = 0;
    let consumed = 0;
    for (const s of slots) {
      if (s.type === 'anchor') {
        const anc = anchors[anchorIdx];
        if (anc.newAnchorText) {
          s.node.firstChild.nodeValue = anc.newAnchorText;
          translatedNodes.set(s.node.firstChild, anc.newAnchorText);
        }
        consumed = anc.end;
        anchorIdx++;
        continue;
      }
      if (s.type === 'space') {
        s.node.nodeValue = '';
        translatedNodes.set(s.node, '');
        continue;
      }
      const segEnd = anchorIdx < anchors.length ? anchors[anchorIdx].start : translated.length;
      const segVal = translated.slice(consumed, segEnd);
      s.node.nodeValue = segVal;
      translatedNodes.set(s.node, segVal);
      consumed = segEnd;
    }
    return true;
  }

  // 收集元素下安全的叶子文本节点（排除 SVG / STYLE / SCRIPT / MATH，绝不触碰 Element 结构）
  function collectSafeLeafTextNodes(rootEl, out) {
    if (!rootEl || !rootEl.childNodes) return;
    for (let i = 0; i < rootEl.childNodes.length; i++) {
      const ch = rootEl.childNodes[i];
      if (ch.nodeType === Node.TEXT_NODE) {
        if (ch.nodeValue && ch.nodeValue.trim()) {
          out.push(ch);
        }
      } else if (ch.nodeType === Node.ELEMENT_NODE) {
        const tag = (ch.tagName || '').toUpperCase();
        if (tag === 'SVG' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'MATH' || tag === 'CODE' || tag === 'PRE') {
          continue;
        }
        collectSafeLeafTextNodes(ch, out);
      }
    }
  }

  // 判定文本节点是否位于非按钮类角标胶囊内（如模型选择器 tagTitle 或步骤前缀 "New"）
  function isNewBadgeTextNode(node) {
    const parent = node && node.parentElement;
    if (!parent || typeof parent.closest !== 'function') return false;
    if (parent.closest('[data-testid="sidecar-new-button"]')) return false;
    const badgeEl = parent.closest('.rounded-full, .bg-secondary.rounded');
    if (!badgeEl) return false;
    const role = badgeEl.getAttribute ? badgeEl.getAttribute('role') : null;
    if ((badgeEl.tagName || '').toUpperCase() === 'BUTTON' || role === 'button') return false;
    return true;
  }

  function translateTextNode(node) {
    const original = node.nodeValue;
    if (!original || !original.trim()) return;
    if (translatedNodes.get(node) === original) return;
    const trimmed = original.trim();
    const translated = (trimmed === 'New' && isNewBadgeTextNode(node))
      ? replaceTrimmed(original, trimmed, '新')
      : translateString(original);
    if (original !== translated) {
      node.nodeValue = translated;
      translatedNodes.set(node, translated);
    } else {
      translatedNodes.set(node, original);
    }
  }

  function translateNode(node) {
    if (!node) return;

    // 针对 INPUT / TEXTAREA：在确认其父容器不处于受保护代码区/用户消息区后，仅翻译其静态提示属性并立即返回
    if (node.nodeType === Node.ELEMENT_NODE) {
      const upperTag = (node.tagName || '').toUpperCase();
      if (upperTag === 'INPUT' || upperTag === 'TEXTAREA') {
        if (!node.parentElement || !shouldSkipNode(node.parentElement)) {
          ['placeholder', 'title', 'aria-label'].forEach(attr => {
            if (node.hasAttribute && node.hasAttribute(attr)) {
              const original = node.getAttribute(attr);
              if (original) {
                const translated = translateString(original);
                if (original !== translated) {
                  node.setAttribute(attr, translated);
                }
              }
            }
          });
        }
        return;
      }
    }

    if (shouldSkipNode(node)) return;

    if (node.nodeType === Node.TEXT_NODE) {
      translateTextNode(node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // 普通元素通过 shouldSkipNode 后仅执行一次属性汉化（彻底消除原先重复两遍的属性扫描）
      ['placeholder', 'title', 'aria-label', 'value'].forEach(attr => {
        if (node.hasAttribute && node.hasAttribute(attr)) {
          const original = node.getAttribute(attr);
          if (original) {
            const translated = translateString(original);
            if (original !== translated) {
              node.setAttribute(attr, translated);
            }
          }
        }
      });

      // 空状态提示收敛（纯叶子 TEXT_NODE 改写，严禁赋值 ELEMENT_NODE.textContent，保留 <svg> 与全部 React Fiber 子元素引用）
      const leafTexts = [];
      collectSafeLeafTextNodes(node, leafTexts);
      if (leafTexts.length >= 1 && leafTexts.length <= 8) {
        const joinedLeafText = leafTexts.map(t => t.nodeValue).join('').trim();
        const emptyStateMatch = joinedLeafText.match(/^No\s+(automations?|automation|自动化|conversations?|conversation|对话|groups?|group|分组)\s+yet[.。]?$/i);
        if (emptyStateMatch) {
          const emptyStateMap = {
            automations: '暂无自动化',
            automation: '暂无自动化',
            '自动化': '暂无自动化',
            conversations: '暂无对话',
            conversation: '暂无对话',
            '对话': '暂无对话',
            groups: '暂无分组',
            group: '暂无分组',
            '分组': '暂无分组'
          };
          const targetText = emptyStateMap[emptyStateMatch[1].toLowerCase()] || '暂无自动化';
          leafTexts[0].nodeValue = targetText;
          translatedNodes.set(leafTexts[0], targetText);
          for (let i = 1; i < leafTexts.length; i++) {
            leafTexts[i].nodeValue = '';
            translatedNodes.set(leafTexts[i], '');
          }
          return;
        }
      }

      // 组合句翻译兜底：React 片段化导致整句词典条目被内联标签切碎时启用
      tryCombinedSentenceTranslation(node);

      if (node.shadowRoot) {
        observeRoot(node.shadowRoot);
        translateNode(node.shadowRoot);
      }
      if (node.childNodes) {
        for (let i = 0; i < node.childNodes.length; i++) {
          translateNode(node.childNodes[i]);
        }
      }
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      if (node.childNodes) {
        for (let i = 0; i < node.childNodes.length; i++) {
          translateNode(node.childNodes[i]);
        }
      }
    }
  }

  const observerConfig = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'title', 'aria-label', 'value']
  };

  const observedRoots = new WeakSet();
  let isTranslating = false;
  let batchRafHandle = null;
  const pendingAddedNodes = new Set();
  const pendingTextNodes = new Set();
  const pendingAttrNodes = new Map();

  const scheduleBatchFrame = (fn) => {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(fn);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(fn);
    } else {
      setTimeout(fn, 0);
    }
  };

  function scheduleBatchTranslation() {
    if (batchRafHandle !== null) return;
    batchRafHandle = true;
    scheduleBatchFrame(processBatchTranslation);
  }

  function processBatchTranslation() {
    batchRafHandle = null;
    if (isTranslating) return;
    isTranslating = true;

    try {
      // 1. 批量处理属性变更（严格遵守 shouldSkipNode 保护边界）
      if (pendingAttrNodes.size > 0) {
        for (const [target, attrs] of pendingAttrNodes) {
          const upperTag = (target.tagName || '').toUpperCase();
          const isInputLike = upperTag === 'INPUT' || upperTag === 'TEXTAREA';
          const canTranslateAttrs = isInputLike
            ? (!target.parentElement || !shouldSkipNode(target.parentElement))
            : !shouldSkipNode(target);
          if (!canTranslateAttrs) continue;

          for (const attrName of attrs) {
            if (attrName === 'value' && isInputLike) continue;
            const original = target.getAttribute ? target.getAttribute(attrName) : null;
            if (original) {
              const translated = translateString(original);
              if (original !== translated) {
                target.setAttribute(attrName, translated);
              }
            }
          }
        }
        pendingAttrNodes.clear();
      }

      // 2. 批量处理文本变更 (characterData)
      if (pendingTextNodes.size > 0) {
        for (const node of pendingTextNodes) {
          if (!shouldSkipNode(node)) {
            translateTextNode(node);
          }
        }
        pendingTextNodes.clear();
      }

      // 3. 批量处理新增节点（祖先包含剪枝，消除嵌套重复递归）
      if (pendingAddedNodes.size > 0) {
        const rootNodes = [];
        for (const node of pendingAddedNodes) {
          let hasAncestor = false;
          let p = node.parentElement;
          while (p) {
            if (pendingAddedNodes.has(p)) {
              hasAncestor = true;
              break;
            }
            p = p.parentElement;
          }
          if (!hasAncestor) {
            rootNodes.push(node);
          }
        }
        pendingAddedNodes.clear();

        for (let i = 0; i < rootNodes.length; i++) {
          const node = rootNodes[i];
          if (node.shadowRoot) {
            observeRoot(node.shadowRoot);
          }
          translateNode(node);
        }
      }
    } catch (e) {
      console.error('Batch translation error:', e);
    } finally {
      isTranslating = false;
    }
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);

    const observer = new MutationObserver((mutations) => {
      let needsSchedule = false;
      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];
        if (mutation.type === 'childList') {
          const added = mutation.addedNodes;
          for (let j = 0; j < added.length; j++) {
            const node = added[j];
            if (node.shadowRoot) {
              observeRoot(node.shadowRoot);
            }
            pendingAddedNodes.add(node);
            needsSchedule = true;
          }
        } else if (mutation.type === 'characterData') {
          translatedNodes.delete(mutation.target);
          pendingTextNodes.add(mutation.target);
          needsSchedule = true;
        } else if (mutation.type === 'attributes') {
          const target = mutation.target;
          let attrSet = pendingAttrNodes.get(target);
          if (!attrSet) {
            attrSet = new Set();
            pendingAttrNodes.set(target, attrSet);
          }
          attrSet.add(mutation.attributeName);
          needsSchedule = true;
        }
      }

      if (needsSchedule) {
        scheduleBatchTranslation();
      }
    });

    observer.observe(root, observerConfig);
  }

  if (typeof Element !== 'undefined' && Element.prototype && Element.prototype.attachShadow) {
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function() {
      const shadowRoot = originalAttachShadow.apply(this, arguments);
      observeRoot(shadowRoot);
      return shadowRoot;
    };
  }

  function safeScan() {
    if (document.body) {
      try {
        translateNode(document.body);
      } catch (e) {
        console.error('Translation scan error:', e);
      }
      observeRoot(document.body);
    }
  }

  function startObserver() {
    safeScan();

    [50, 150, 400, 1000, 2500].forEach(delay => {
      setTimeout(safeScan, delay);
    });

    window.addEventListener('focus', safeScan);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        safeScan();
      }
    });

    try {
      const origPushState = history.pushState;
      history.pushState = function() {
        const ret = origPushState.apply(this, arguments);
        setTimeout(safeScan, 50);
        return ret;
      };
      const origReplaceState = history.replaceState;
      history.replaceState = function() {
        const ret = origReplaceState.apply(this, arguments);
        setTimeout(safeScan, 50);
        return ret;
      };
      window.addEventListener('popstate', () => setTimeout(safeScan, 50));
    } catch (_) {}

    setupSidebarProjectDragFix();
  }

  const NON_PROJECT_DROP_IDS = new Set(['all', 'main-section-header', 'pinned', 'section-coordinator', 'standalone']);

  function isProjectSectionWrapper(el) {
    if (!el || typeof el.hasAttribute !== 'function' || !el.hasAttribute('data-sidebar-section-drop-id') || !el.hasAttribute('data-index')) {
      return false;
    }
    const dropId = el.getAttribute('data-sidebar-section-drop-id') || '';
    if (!dropId || NON_PROJECT_DROP_IDS.has(dropId) || dropId.startsWith('convgroup:')) {
      return false;
    }
    if (el.hasAttribute('data-sidebar-row-id')) {
      return false;
    }
    if (typeof el.querySelector === 'function' && !el.querySelector('button[data-project-card="true"], div.border-dashed')) {
      return false;
    }
    return true;
  }

  // 仅当虚拟滚动器基础定位 translateY(...) 后紧跟拖拽附加变换时才提取额外偏移，防止误减独立单变换布局坐标
  function getExtraDragTranslateY(transformStr) {
    if (!transformStr) return 0;
    const m3dAfterY = transformStr.match(/translateY\([^)]+\)\s+translate3d\([^,]+,\s*([-+\d.]+)px/i);
    if (m3dAfterY) return parseFloat(m3dAfterY[1]) || 0;
    const allY = [];
    const reY = /translateY\(\s*([-+\d.]+)px\s*\)/gi;
    let m;
    while ((m = reY.exec(transformStr)) !== null) {
      allY.push(parseFloat(m[1]) || 0);
    }
    return allY.length >= 2 ? allY[allY.length - 1] : 0;
  }

  // 修复官方左侧边栏项目拖拽排序错位（u2c/t2c 展开态测量竞态与首项 topBound 偏移）：
  // 1) 全程返回合法有限数值 DOMRect（firstTop + rank * slotHeight），绝不返回 top: undefined 引发虚拟列表 NaN；
  // 2) pointerup / pointercancel / dragend / blur 统一使用捕获阶段 true + >= 4px 阈值 + buttons === 0 兜底，根除拖拽态锁死。
  function setupSidebarProjectDragFix() {
    if (typeof window === 'undefined' || typeof Element === 'undefined' || window.__agySidebarDragFixInstalled) return;
    window.__agySidebarDragFixInstalled = true;

    let isProjectPointerDown = false;
    let hasProjectPointerMoved = false;
    let downX = 0;
    let downY = 0;

    const clearDragState = () => {
      isProjectPointerDown = false;
      hasProjectPointerMoved = false;
    };

    window.addEventListener('pointerdown', (e) => {
      if (e && e.button === 0 && e.target && typeof e.target.closest === 'function') {
        const projectBtn = e.target.closest('button[data-project-card="true"][data-testid="project-header"]');
        if (projectBtn && projectBtn.closest('[data-sidebar-scroll-container="true"]')) {
          isProjectPointerDown = true;
          hasProjectPointerMoved = false;
          downX = typeof e.clientX === 'number' ? e.clientX : 0;
          downY = typeof e.clientY === 'number' ? e.clientY : 0;
        }
      }
    }, true);

    window.addEventListener('pointermove', (e) => {
      if (!isProjectPointerDown) return;
      if (e && typeof e.buttons === 'number' && e.buttons === 0) {
        clearDragState();
        return;
      }
      if (!hasProjectPointerMoved && e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 4) {
          hasProjectPointerMoved = true;
        }
      }
    }, true);

    window.addEventListener('pointerup', clearDragState, true);
    window.addEventListener('pointercancel', clearDragState, true);
    window.addEventListener('dragend', clearDragState, true);
    window.addEventListener('blur', clearDragState, true);

    const origGetBCR = Element.prototype.getBoundingClientRect;
    if (typeof origGetBCR !== 'function') return;

    Element.prototype.getBoundingClientRect = function() {
      const rect = origGetBCR.call(this);
      if (!isProjectPointerDown || !hasProjectPointerMoved || !isProjectSectionWrapper(this)) {
        return rect;
      }
      const parent = this.parentElement;
      if (!parent || !parent.children) return rect;

      const myIdx = parseInt(this.getAttribute('data-index') || '', 10);
      if (Number.isNaN(myIdx)) return rect;

      const projectWrappers = [];
      const children = parent.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (isProjectSectionWrapper(child)) {
          const idx = parseInt(child.getAttribute('data-index') || '', 10);
          if (!Number.isNaN(idx)) {
            projectWrappers.push({ el: child, idx });
          }
        }
      }
      if (projectWrappers.length === 0) return rect;
      projectWrappers.sort((a, b) => a.idx - b.idx);

      const firstEntry = projectWrappers[0];
      const firstRawRect = firstEntry.el === this ? rect : origGetBCR.call(firstEntry.el);
      const firstExtraY = getExtraDragTranslateY(firstEntry.el.style && firstEntry.el.style.transform);
      const baseFirstTop = firstRawRect.top - firstExtraY;
      const slotHeight = firstRawRect.height > 0 ? firstRawRect.height : (rect.height > 0 ? rect.height : 37);

      const rank = projectWrappers.findIndex(w => w.idx === myIdx);
      if (rank <= 0) {
        if (firstExtraY !== 0) {
          return {
            x: rect.x,
            y: baseFirstTop,
            width: rect.width,
            height: rect.height,
            top: baseFirstTop,
            right: rect.right,
            bottom: baseFirstTop + rect.height,
            left: rect.left,
            toJSON: () => (typeof rect.toJSON === 'function' ? rect.toJSON() : rect)
          };
        }
        return rect;
      }

      const syntheticTop = baseFirstTop + rank * slotHeight;
      return {
        x: rect.x,
        y: syntheticTop,
        width: rect.width,
        height: slotHeight,
        top: syntheticTop,
        right: rect.right,
        bottom: syntheticTop + slotHeight,
        left: rect.left,
        toJSON: () => (typeof rect.toJSON === 'function' ? rect.toJSON() : rect)
      };
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
