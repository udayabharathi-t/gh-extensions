/* Shared, dependency-free logic for both browsers and the test suite. */
globalThis.GHECore = (() => {
  function route(href) {
    const url = new URL(href);
    if (url.hostname !== 'github.com') return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(compare|pull)\/(.+)$/);
    if (!match) return null;
    const [, owner, repo, kind, rest] = match;
    if (kind === 'pull') {
      const pr = rest.match(/^(\d+)(?:\/(?:files|changes|commits)(?:\/.*)?)?\/?$/);
      return pr ? { owner, repo, kind, number: pr[1] } : null;
    }
    const refs = rest.split('...');
    if (refs.length !== 2 || refs.some(ref => !ref)) return null;
    return { owner, repo, kind, base: decodeURIComponent(refs[0]), head: decodeURIComponent(refs[1]) };
  }

  const users = value => [...new Set(String(value || '').split(/[\s,;]+/)
    .map(user => user.replace(/^@/, '').toLowerCase()).filter(Boolean))];

  function visible(author, prefs) {
    const login = String(author || '').toLowerCase();
    if (!login || prefs.mode === 'all') return true;
    const listed = users(prefs.users).includes(login);
    return prefs.mode === 'include' ? listed : !listed;
  }

  return { route, users, visible };
})();
