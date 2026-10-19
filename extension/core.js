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

  async function compare(get, context, reverse = false, progress = () => {}) {
    const prefix = `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}`;
    let base = reverse ? context.head : context.base;
    let head = reverse ? context.base : context.head;
    const resolved = await Promise.all([base, head].map(ref => get(`${prefix}/commits/${encodeURIComponent(ref)}`)));
    [base, head] = resolved.map(commit => commit.sha);
    if (!base || !head) throw new Error('Could not resolve comparison refs.');
    const commits = new Map();
    let total;
    for (let page = 1; ; page++) {
      const data = await get(`${prefix}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100&page=${page}`);
      total ??= data.total_commits;
      if (!Number.isSafeInteger(total) || !Array.isArray(data.commits)) throw new Error('Unexpected compare response from GitHub.');
      const previous = commits.size;
      for (const commit of data.commits) commits.set(commit.sha, commit);
      progress(commits.size, total);
      if (commits.size >= total) break;
      if (commits.size === previous || data.commits.length === 0) throw new Error('Comparison changed or pagination stopped early. Refresh and try again.');
    }
    return [...commits.values()];
  }

  async function classify(get, context, commits) {
    const prefix = `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}`;
    const output = new Array(commits.length);
    let cursor = 0;
    // Keep API concurrency low; one failed lookup fails the operation visibly.
    await Promise.all(Array.from({ length: Math.min(2, commits.length) }, async () => {
      while (cursor < commits.length) {
        const index = cursor++;
        const commit = commits[index];
        let kind = commit.parents?.length > 1 ? 'merge' : 'ordinary';
        if (kind === 'ordinary') {
          for (let page = 1; ; page++) {
            const pulls = await get(`${prefix}/commits/${encodeURIComponent(commit.sha)}/pulls?per_page=100&page=${page}`);
            if (!Array.isArray(pulls)) throw new Error('Unexpected PR response from GitHub.');
            if (pulls.some(pr => pr.merged_at && pr.merge_commit_sha === commit.sha)) {
              kind = 'squash';
              break;
            }
            if (pulls.length < 100) break;
          }
        }
        output[index] = { ...commit, kind };
      }
    }));
    return output;
  }
  return { route, users, visible, compare, classify };
})();
