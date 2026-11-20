'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const refreshButton = byId('refresh');
  const downloadButton = byId('download');
  const reconnectButton = byId('reconnect');
  const status = byId('status');
  const progress = byId('progress');
  const token = document.querySelector('meta[name="localizer-token"]').content;
  const fragment = new URLSearchParams(location.hash.slice(1));
  let latestAvailable = false;
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

  function setBusy(active) {
    busy = active;
    refreshButton.disabled = active || !reconnectButton.hidden;
    downloadButton.disabled = active || !latestAvailable || !reconnectButton.hidden;
  }

  async function api(name, method = 'GET') {
    let response;
    try {
      response = await fetch(new URL('./api/' + name, location.href), {
        method, credentials: 'omit', cache: 'no-store',
        headers: { 'x-localizer-token': token },
        signal: AbortSignal.timeout(25000),
      });
    } catch (_) {
      throw connectionError();
    }
    const data = await response.json().catch(() => null);
    if (!data || response.status === 403) throw connectionError();
    if (!response.ok) throw new Error(data.error || '操作失败');
    return data;
  }

  function connectionError() {
    reconnectButton.hidden = false;
    return new Error('插件连接已中断，请重新连接');
  }

  function setPath(id, value) {
    const element = byId(id);
    element.hidden = !value;
    element.textContent = value || '';
  }

  function showStatus({ client, cached }) {
    byId('client-version').textContent = client.version || '—';
    byId('client-state').textContent = client.isInstalled
      ? (client.isLocalized ? '已汉化' : '未汉化')
      : '未找到 Antigravity';
    setPath('client-path', client.path);
    const detail = byId('cache-detail');
    if (!cached) {
      detail.textContent = '暂无已下载的补丁';
    } else if (cached.modified || !cached.version) {
      detail.textContent = cached.tag + ' · 缓存文件无法识别';
    } else {
      const compatibility = client.version ? (cached.matchesClient ? ' · 与本机版本匹配' : ' · 与本机版本不匹配') : '';
      detail.textContent = cached.tag + ' · 适用于客户端 ' + cached.version + compatibility;
    }
    setPath('cache-path', cached?.path);
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
    if (download.status === 'idle') return '等待下载';
    return '';
  }

  async function trackDownload(download) {
    status.textContent = '正在下载并校验…';
    progress.hidden = false;
    try {
      while (download.status === 'downloading') {
        if (download.totalBytes > 0) progress.value = download.percent;
        else progress.removeAttribute('value');
        await new Promise(resolve => setTimeout(resolve, 650));
        download = await api('download');
      }
      if (download.status === 'completed') showStatus(await api('status'));
      status.textContent = completionMessage(download) || '可通过刷新查看下载状态';
    } finally {
      progress.hidden = true;
    }
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    status.textContent = '正在读取版本…';
    try {
      const [local, latest] = await Promise.allSettled([api('status'), api('latest')]);
      latestAvailable = latest.status === 'fulfilled';
      if (latestAvailable) showLatest(latest.value);
      else {
        byId('release-version').textContent = '—';
        byId('release-detail').textContent = latest.reason.message;
      }
      if (local.status === 'rejected') {
        byId('client-state').textContent = local.reason.message;
        throw local.reason;
      }
      showStatus(local.value);
      if (local.value.download.status === 'downloading') await trackDownload(local.value.download);
      else status.textContent = latestAvailable ? completionMessage(local.value.download) : '本机状态已刷新，暂未查到仓库版本';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  refreshButton.onclick = refresh;
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
