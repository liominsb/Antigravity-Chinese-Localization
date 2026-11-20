'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const refreshButton = byId('refresh');
  const downloadButton = byId('download');
  const reconnectButton = byId('reconnect');
  const status = byId('status');
  const progress = byId('progress');
  const applyButton = byId('apply');
  const restoreButton = byId('restore');
  const dialog = byId('confirm-action');
  let canApply = false;
  let canRestore = false;
  const token = document.querySelector('meta[name="localizer-token"]').content;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  let latestTag = '';
  let latestPending = false;
  let lastLocal = null;
  let folderState = {};
  const folders = ['cache', 'install', 'config', 'agent'];
  let localStatusLoaded = false;
  let busy = false;

  function setTheme(dark) {
    if (typeof dark === 'boolean') document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function entryUrl(value) {
    try {
      const url = new URL(value);
      const localApp = ['wails.localhost', 'localhost', '127.0.0.1'].includes(url.hostname);
      if ((!localApp && url.origin !== location.origin) ||
          !['http:', 'https:', 'wails:'].includes(url.protocol) || url.username || url.password ||
          !/^\/_magpie\/plugin\/[a-f0-9]{32}\/index\.html$/.test(url.pathname)) return null;
      url.hash = '';
      return url;
    } catch (_) {
      return null;
    }
  }

  function askMagpie(id, method) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', receive);
        reject(new Error('等待 Magpie 页面服务超时'));
      }, 8000);
      function receive(event) {
        const reply = event.data;
        if (event.source !== parent || reply?.magpie !== 1 || reply.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener('message', receive);
        if (reply.error) reject(new Error(String(reply.error)));
        else resolve(reply.result || {});
      }
      window.addEventListener('message', receive);
      parent.postMessage({ magpie: 1, id, method }, '*');
    });
  }

  async function connect() {
    if (parent === window) throw new Error('请从 Magpie 侧栏打开插件');
    const theme = await askMagpie(34801, 'hello');
    const options = theme.service ? {} : await askMagpie(34802, 'options.get');
    const defaultPort = document.querySelector('meta[name="magpie-service-port"]').content;
    const port = typeof options.port === 'number' || (typeof options.port === 'string' && /^\+?\d+$/.test(options.port.trim()))
      ? Number(options.port) : 0;
    const selectedPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : defaultPort;
    const target = new URL(theme.service || 'http://127.0.0.1:' + selectedPort + '/', location.href);
    const entry = entryUrl(location.href);
    const params = new URLSearchParams();
    if (entry) params.set('entry', entry.href);
    if (typeof theme?.dark === 'boolean') params.set('theme', theme.dark ? 'dark' : 'light');
    target.hash = params.toString();
    location.replace(target.href);
  }

  if (!/^[a-f0-9]{48}$/.test(token)) {
    void connect().catch(error => { status.textContent = error.message; });
    return;
  }

  if (fragment.has('theme')) setTheme(fragment.get('theme') === 'dark');
  else setTheme(matchMedia('(prefers-color-scheme: dark)').matches);
  if (parent !== window) {
    window.addEventListener('message', event => {
      if (event.source !== parent || event.data?.magpie !== 1) return;
      if (event.data.event === 'theme') setTheme(event.data.data?.dark);
      if (event.data.id === 34801) setTheme(event.data.result?.dark);
    });
    parent.postMessage({ magpie: 1, id: 34801, method: 'hello' }, '*');
  }
  const entry = entryUrl(fragment.get('entry'));
  reconnectButton.onclick = () => location.replace(entry ? entry.href : location.href);

  const sections = ['settings', 'resources'];
  function selectSection(selected) {
    for (const name of sections) {
      const active = name === selected;
      const tab = byId(name + '-tab');
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      byId(name + '-panel').hidden = !active;
    }
  }
  for (const name of sections) {
    const tab = byId(name + '-tab');
    tab.onclick = () => selectSection(name);
    tab.onkeydown = event => {
      let next;
      if (event.key === 'Home') next = sections[0];
      else if (event.key === 'End') next = sections[1];
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = sections.find(value => value !== name);
      else return;
      event.preventDefault();
      selectSection(next);
      byId(next + '-tab').focus();
    };
  }

  function setBusy(active) {
    busy = active;
    refreshButton.disabled = active || latestPending || !reconnectButton.hidden;
    downloadButton.disabled = active || !latestTag || !reconnectButton.hidden;
    applyButton.disabled = active || !canApply || !reconnectButton.hidden;
    restoreButton.disabled = active || !canRestore || !reconnectButton.hidden;
    for (const name of folders) {
      byId('open-' + name).disabled = !folderState[name]?.available || !reconnectButton.hidden;
    }
  }

  async function api(name, method = 'GET') {
    let failure;
    // 宿主短暂重载时，读取可重试。重复的下载请求会复用已有任务或校验缓存。
    const changesClient = name === 'apply' || name === 'restore';
    const opensFolder = name.startsWith('open/');
    for (const delay of changesClient || opensFolder ? [0] : [0, 220, 450, 850, 1500]) {
      if (delay) await wait(delay);
      const signal = AbortSignal.timeout(25000);
      let response, data;
      try {
        response = await fetch(new URL('./api/' + name, location.href), {
          method, credentials: 'omit', cache: 'no-store',
          headers: { 'x-localizer-token': token }, signal,
        });
        if (response.status === 403 && name !== 'latest') throw connectionError();
        data = await response.json();
      } catch (error) {
        if (response?.status === 403) throw error;
        if (opensFolder) throw new Error('未收到打开结果，请检查文件管理器');
        if (changesClient) {
          reconnectButton.hidden = false;
          throw new Error('未收到操作结果，请重新连接并核对客户端的汉化状态');
        }
        if (signal.aborted) throw new Error('请求超时，请稍后重试', { cause: error });
        failure = error;
        continue;
      }
      if (response.status === 409 && name === 'download' && method === 'POST') return api('download');
      if (!response.ok) throw new Error(data.error || '操作失败');
      return data;
    }
    if (name === 'latest') throw new Error('暂时无法查询社区版本，请稍后刷新', { cause: failure });
    throw connectionError(failure);
  }

  function connectionError(cause) {
    reconnectButton.hidden = false;
    return new Error('插件连接已中断，请重新连接', { cause });
  }

  function showStatus(local) {
    lastLocal = local;
    const { client, cached, folders: locations } = local;
    localStatusLoaded = true;
    canApply = client.isInstalled && !client.isLocalized && cached?.matchesClient;
    canRestore = client.isLocalized && client.version && client.hasBackup;
    byId('client-version').textContent = client.version || '—';
    byId('client-state').textContent = client.isInstalled
      ? (client.isLocalized ? (canRestore ? '已汉化' : '已汉化 · 缺少同版本原版备份') : '未汉化')
      : '未找到 Antigravity';
    folderState = locations || {};
    for (const name of folders) {
      const item = folderState[name];
      byId(name + '-path').textContent = item?.path || '—';
      byId('open-' + name).textContent = item && !item.available ? '目录不可用' : '打开文件夹';
    }
    const hint = byId('apply-hint');
    const latestMismatch = cached?.tag === latestTag && cached.version && !cached.modified && !cached.matchesClient;
    let next = '';
    if (!client.isInstalled) hint.textContent = '请先安装 Antigravity。自定义安装目录可在喜鹊插件选项中设置。';
    else if (client.isLocalized) {
      hint.textContent = canRestore ? '已启用中文。如需恢复，先退出 Antigravity，再点「还原官方版」。' : '已启用中文。还原需要同版本的原版备份。';
      if (canRestore) next = 'restore';
    } else if (canApply) {
      hint.textContent = '汉化包已就绪。退出 Antigravity 后，点「应用汉化」。';
      next = 'apply';
    } else if (latestMismatch) {
      hint.textContent = '最新汉化包与本机版本不匹配。请在版本更新后刷新。';
    } else if (!latestTag) {
      hint.textContent = latestPending ? '正在查询可下载的汉化包…' : '本机没有可用的汉化包。请刷新版本后下载。';
    } else {
      hint.textContent = cached ? '本地汉化包不可用，请先下载最新版。' : '首次使用请先点「下载最新版」，校验通过后即可应用汉化。';
      next = 'download';
    }
    downloadButton.className = next === 'download' ? 'primary' : '';
    downloadButton.textContent = cached && cached.tag === latestTag && !cached.modified ? '重新下载' : '下载最新版';
    applyButton.className = next === 'apply' ? 'primary' : '';
    restoreButton.className = next === 'restore' ? 'primary' : '';
    const detail = byId('cache-detail');
    if (!cached) {
      detail.textContent = '暂无已下载的补丁';
    } else if (cached.modified || !cached.version) {
      detail.textContent = cached.tag + ' · 缓存文件无法识别';
    } else {
      detail.textContent = cached.matchesClient ? cached.tag + '（版本匹配）' : cached.tag + '（适用于 ' + cached.version + '）';
    }
  }

  function showLatest(release) {
    byId('release-version').textContent = release.tag;
    const date = new Date(release.publishedAt || '');
    const size = release.size ? (release.size / 1024 / 1024).toFixed(1) + ' MiB' : '';
    byId('release-detail').textContent = [
      Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '',
      size,
    ].filter(Boolean).join(' · ') || '可下载';
  }

  function completionMessage(download) {
    if (download.status === 'completed' && download.verified) return '下载完成，SHA-256 校验通过';
    if (download.status === 'failed') return download.error || '下载失败';
    return '';
  }

  async function trackDownload(download) {
    let resumes = 0;
    status.textContent = '正在下载并校验…';
    byId('apply-hint').hidden = true;
    progress.removeAttribute('value');
    progress.hidden = false;
    try {
      while (download.status === 'downloading' || (download.status === 'idle' && resumes < 2)) {
        if (download.status === 'idle') {
          resumes++;
          progress.removeAttribute('value');
          status.textContent = '正在恢复下载并校验…';
          download = await api('download', 'POST');
          continue;
        }
        if (download.totalBytes > 0) progress.value = download.percent;
        else progress.removeAttribute('value');
        await wait(650);
        download = await api('download');
      }
      if (download.status === 'completed') showStatus(await api('status'));
      status.textContent = download.status === 'idle'
        ? '宿主反复重载，下载已暂停。可以重新下载。'
        : (completionMessage(download) || '可通过刷新查看下载状态');
    } finally {
      progress.hidden = true;
      byId('apply-hint').hidden = false;
    }
  }

  async function refreshLatest() {
    latestPending = true;
    latestTag = '';
    byId('release-version').textContent = '—';
    byId('release-detail').textContent = '正在查询…';
    try {
      const release = await api('latest');
      latestTag = release.tag;
      showLatest(release);
    } catch (error) {
      byId('release-detail').textContent = error.message;
    } finally {
      latestPending = false;
      if (lastLocal) showStatus(lastLocal);
      setBusy(busy);
    }
  }

  async function refresh() {
    if (busy || latestPending) return;
    setBusy(true);
    void refreshLatest();
    status.textContent = '正在读取本机状态…';
    try {
      const local = await api('status');
      showStatus(local);
      if (local.download.status === 'downloading') await trackDownload(local.download);
      else status.textContent = completionMessage(local.download);
    } catch (error) {
      lastLocal = null;
      canApply = false;
      canRestore = false;
      folderState = {};
      byId('apply-hint').textContent = '读取客户端状态失败，请刷新后重试。';
      if (!localStatusLoaded) byId('client-state').textContent = error.message;
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  refreshButton.onclick = refresh;
  for (const name of folders) {
    const button = byId('open-' + name);
    button.onclick = async () => {
      button.disabled = true;
      try { await api('open/' + name, 'POST'); }
      catch (error) { status.textContent = error.message; }
      finally { button.disabled = !folderState[name]?.available || !reconnectButton.hidden; }
    };
  }
  function confirmChange(name, label, description) {
    byId('confirm-title').textContent = label;
    byId('confirm-detail').textContent = description;
    const accept = byId('accept-action');
    accept.textContent = label;
    accept.onclick = async () => {
      dialog.close();
      if (busy) return;
      setBusy(true);
      status.textContent = name === 'apply' ? '正在备份并应用汉化…' : '正在还原官方版…';
      try {
        const result = await api(name, 'POST');
        showStatus(result);
        if (result.client.isLocalized !== (name === 'apply')) {
          throw new Error('检测到的客户端状态与操作结果不符，请刷新核对');
        }
        status.textContent = result.client.isLocalized ? '已应用汉化，可以启动 Antigravity' : '已还原官方版，可以启动 Antigravity';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        setBusy(false);
      }
    };
    dialog.showModal();
  }
  applyButton.onclick = () => confirmChange('apply', '应用汉化', '请先退出 Antigravity。插件会备份当前原版并应用已下载的汉化包，下次打开即为中文。');
  restoreButton.onclick = () => confirmChange('restore', '还原官方版', '请先退出 Antigravity。插件会从本机同版本备份还原，下次打开即为官方版。');
  byId('cancel-action').onclick = () => dialog.close();
  downloadButton.onclick = async () => {
    if (busy) return;
    setBusy(true);
    status.textContent = '正在准备下载…';
    try {
      await trackDownload(await api('download', 'POST'));
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  };
  void refresh();
})();
