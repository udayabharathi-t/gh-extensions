/* global GHECore, importScripts, browser, chrome */
if (!globalThis.GHECore) importScripts('core.js');
const api = globalThis.browser || globalThis.chrome;
// Chrome: credentials stay inaccessible to content scripts. Firefox storage is
// still extension-only and nothing forwards credentials to the page.
api.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
const cache = new Map();
api.action.onClicked.addListener(() => api.runtime.openOptionsPage());

async function get(path) {
  if (!/^\/repos\/[^/]+\/[^/]+\/(?:commits\/[^/?]+|(?:compare\/[^?]+|commits\/[^/]+\/pulls)\?per_page=100&page=\d+)$/.test(path)) {
    throw new Error('Unsupported GitHub API request.');
  }
  const { token = '' } = await api.storage.local.get('token');
  const key = `${token ? 'authenticated' : 'public'}:${path}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, {
    headers, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    if (response.status === 401) throw new Error('GitHub token is invalid or expired. Update it in extension settings.');
    if (response.status === 404) throw new Error('Repository or ref is unavailable. For private repositories, add a token with access and authorize organization SSO in extension settings.');
    if (response.status === 403 || response.status === 429) throw new Error(`GitHub denied the request or rate-limited it. Check token permissions/SSO, or retry ${retry ? `after ${retry} seconds` : 'later'}.`);
    throw new Error(`GitHub API returned ${response.status}. Try again later.`);
  }
  const data = await response.json();
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(key, { data, expires: Date.now() + 60000 });
  return data;
}

api.storage.onChanged.addListener(() => cache.clear());
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== api.runtime.id || !sender.url?.startsWith('https://github.com/')) return false;
  (async () => {
    switch (message.type) {
      case 'settings': await api.runtime.openOptionsPage(); return {};
      case 'prefs': return (await api.storage.local.get('reviewPrefs')).reviewPrefs || { mode: 'all', users: '' };
      case 'savePrefs': {
        const prefs = { mode: ['include', 'exclude'].includes(message.prefs?.mode) ? message.prefs.mode : 'all', users: GHECore.users(message.prefs?.users).join(', ') };
        await api.storage.local.set({ reviewPrefs: prefs });
        return prefs;
      }
      case 'compare': {
        const context = GHECore.route(sender.tab?.url || sender.url);
        if (context?.kind !== 'compare') throw new Error('Open a GitHub compare page first.');
        const commits = await GHECore.compare(get, context, Boolean(message.reverse));
        return message.integrationOnly ? GHECore.classify(get, context, commits) : commits;
      }
      default: throw new Error('Unknown extension request.');
    }
  })().then(data => respond({ data }), error => respond({ error: error.message || 'Request failed.' }));
  return true;
});
