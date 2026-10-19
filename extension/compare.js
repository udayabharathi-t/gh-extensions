/* Compare through the same read-only GitHub pages as the signed-in browser. */
globalThis.GHECompare = (() => {
  const SHA = /^[a-f0-9]{40,64}$/i;
  const origin = 'https://github.com';
  const prefix = context => `/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}`;
  const routeData = new WeakMap();
  function parse(html) {
    // Firefox can sanitize script elements when DOMParser is called from an
    // extension. Read JSON as inert text before parsing the page's markup.
    const data = [];
    for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      try { const value = JSON.parse(match[1]); data.push(value.payload || value.props?.initialPayload || value.props?.payload || value); } catch { /* Ignore unrelated or invalid JSON. */ }
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    routeData.set(doc, data);
    return doc;
  }
  function payloads(doc) {
    if (routeData.has(doc)) return routeData.get(doc);
    const result = [];
    for (const node of doc.querySelectorAll('script[type="application/json"]')) {
      try { const value = JSON.parse(node.textContent); if (value.payload) result.push(value.payload); } catch { /* Non-route JSON is ignored. */ }
    }
    return result;
  }
  function pageError(doc) {
    if (doc.querySelector('form[action="/session"], input[name="login"]')) throw new Error('Sign in to GitHub in this tab, then retry.');
    if (doc.querySelector('title')?.textContent.includes('Single sign-on')) throw new Error('Complete your organization’s GitHub SSO sign-in, then retry.');
  }
  function safeURL(value, context, kind) {
    const url = new URL(value, origin);
    const root = prefix(context);
    const allowed = kind === 'feed' ? url.pathname === `${root}/compare/commit-list`
      : kind === 'pull' ? new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/\\d+$`).test(url.pathname)
        : url.pathname.startsWith(`${root}/`);
    if (url.origin !== origin || url.username || url.password || !allowed) throw new Error('GitHub returned an unexpected page link.');
    url.hash = '';
    return url;
  }
  function parseRef(html, fragment = false) {
    const doc = parse(html); pageError(doc);
    for (const p of payloads(doc)) {
      const oid = p.codeViewTreeRoute?.refInfo?.currentOid || p.codeViewLayoutRoute?.refInfo?.currentOid || p.codeViewRepoRoute?.refInfo?.currentOid || p.refInfo?.currentOid;
      if (SHA.test(oid || '')) return oid;
    }
    // GitHub still serves classic repository pages to some signed-in sessions.
    for (const link of doc.querySelectorAll(fragment ? 'a[href*="/commit/"]' : '.commit-tease a[href*="/commit/"], .Box-header a[href*="/commit/"], [data-testid="latest-commit"] a[href*="/commit/"], a[data-test-selector="commit-tease-commit-message"]')) {
      const sha = /\/commit\/([a-f0-9]{40,64})(?:$|[?#])/.exec(link.getAttribute('href') || '')?.[1];
      if (sha) return sha;
    }
    const deferred = doc.querySelector('include-fragment[src*="/tree-commit/"], include-fragment[src*="/latest-commit/"]');
    if (deferred) return { next: deferred.getAttribute('src') };
    throw new Error('Could not resolve the ref from GitHub’s page. Check access and try again.');
  }
  function parseCompare(html, context) {
    const doc = parse(html); pageError(doc);
    const count = doc.querySelector('a[href="#commits_bucket"]');
    const text = count?.textContent.trim().replaceAll(',', '') || '';
    let total = /([\d]+)\s*$/.exec(text)?.[1];
    const bucket = doc.querySelector('#commits_bucket');
    if (total === undefined && bucket) {
      const summary = bucket.previousElementSibling?.querySelector('.octicon-git-commit')?.closest('li');
      total = summary?.querySelector('.text-emphasized')?.textContent.trim().replaceAll(',', '');
    }
    const fragment = doc.querySelector('#commits_bucket include-fragment[src]');
    if (fragment) {
      if (total === undefined) throw new Error('GitHub’s commit count was not recognized. Refresh and retry.');
      return { total: Number(total), next: safeURL(fragment.getAttribute('src'), context, 'feed').href };
    }
    if (bucket?.querySelector('.js-commits-list-item') && /^\d+$/.test(total || '')) return { total: Number(total), next: null, inline: bucket.innerHTML };
    if (total === '0' || /There (?:isn[’']t|is nothing|are no commits|is nothing) (?:anything )?to compare[.!]?/i.test(doc.body.textContent)) return { total: 0, next: null };
    throw new Error('GitHub’s compare layout was not recognized. Check repository access and refresh.');
  }
  function pullLinks(root, context) {
    const result = new Set();
    for (const link of root.querySelectorAll('a[href]')) {
      try { result.add(safeURL(link.getAttribute('href'), context, 'pull').href); } catch { /* Ignore unrelated links. */ }
    }
    return [...result];
  }
  function parseList(html, context) {
    const doc = parse(html); pageError(doc);
    const commits = [];
    for (const row of doc.querySelectorAll('.js-commits-list-item')) {
      const link = row.querySelector('a.markdown-title, a[href*="/commit/"]');
      const url = link && safeURL(link.getAttribute('href'), context);
      const sha = url?.pathname.split('/commit/')[1];
      if (!SHA.test(sha || '')) throw new Error('GitHub returned a commit without a recognized SHA.');
      // Use the complete title paragraph: GitHub splits #PR links out of the
      // markdown-title anchor, e.g. "Merge pull request" + "#123" + branch.
      const title = link.closest('p')?.cloneNode(true) || link.cloneNode(true);
      title.querySelectorAll('button, .hidden-text-expander').forEach(node => node.remove());
      commits.push({ sha, commit: { message: title.textContent.trim().replace(/\s+/g, ' ') }, pullUrls: pullLinks(row, context) });
    }
    let next = null;
    const form = doc.querySelector('form.js-ajax-pagination, form.ajax-pagination-form');
    if (form) {
      if ((form.getAttribute('method') || 'get').toLowerCase() !== 'get') throw new Error('Unsupported GitHub pagination method.');
      const url = safeURL(form.getAttribute('action'), context, 'feed');
      for (const input of form.querySelectorAll('input[name]')) {
        if (['page', 'range', 'after', 'before'].includes(input.name)) url.searchParams.set(input.name, input.value);
      }
      next = url.href;
    } else {
      const link = doc.querySelector('a[rel="next"], a.next_page');
      if (link) next = safeURL(link.getAttribute('href'), context, 'feed').href;
    }
    return { commits, next };
  }
  function parseCommit(html, context, expectedSHA) {
    const doc = parse(html); pageError(doc);
    for (const p of payloads(doc)) {
      const commit = p.commitRoute?.commit || p.commit;
      if (!commit || commit.oid !== expectedSHA || !Array.isArray(commit.parents) || commit.parents.some(sha => !SHA.test(sha))) continue;
      const title = parse(commit.shortMessageMarkdown || '').body;
      return { parents: commit.parents, pullUrls: [...new Set([...pullLinks(doc, context), ...pullLinks(title, context)])] };
    }
    // Classic commit pages expose their parent links in the SHA summary.
    const parent = doc.querySelector('.sha-block');
    const links = parent && [...parent.querySelectorAll('a[href*="/commit/"]')];
    if (links?.length && /parent/.test(parent.textContent)) return { parents: links.map(link => safeURL(link.getAttribute('href'), context).pathname.split('/commit/')[1]).filter(sha => SHA.test(sha)), pullUrls: pullLinks(doc, context) };
    throw new Error('Could not read commit parents from GitHub. Results were not silently filtered.');
  }
  function parsePull(html) {
    const doc = parse(html); pageError(doc);
    for (const p of payloads(doc)) {
      const pr = p.pullRequestsLayoutRoute?.pullRequest || p.pullRequest;
      if (pr && typeof pr.state === 'string') return { merged: pr.state === 'MERGED', sha: pr.mergeCommitSha };
    }
    for (const event of doc.querySelectorAll('.TimelineItem')) {
      if (!/merged commit/.test(event.textContent)) continue;
      const path = event.querySelector('a[href*="/commit/"]')?.getAttribute('href') || '';
      const sha = /\/commit\/([a-f0-9]{40,64})(?:$|[?#])/.exec(path)?.[1];
      if (sha) return { merged: true, sha };
    }
    if (doc.querySelector('.State--open, .State--closed')) return { merged: false, sha: null };
    throw new Error('Could not verify a linked PR’s merge information from GitHub.');
  }
  async function load(context, { reverse = false, integrationOnly = true, progress = () => {}, signal } = {}, fetchPage = globalThis.fetch) {
    const operation = new AbortController();
    signal = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
    const root = prefix(context);
    const cache = new Map();
    async function get(value) {
      signal?.throwIfAborted();
      const url = safeURL(value, context);
      if (cache.has(url.href)) return cache.get(url.href);
      const request = (async () => {
        // MV3 content-script requests use the page origin. The browser supplies
        // existing session cookies; the extension never reads or stores them.
        const response = await fetchPage(url.href, { method: 'GET', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', headers: { Accept: 'text/html' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) throw new Error('GitHub page access failed. Sign in, complete organization SSO if needed, and check the repository/ref.');
          if (response.status === 429) throw new Error('GitHub temporarily limited page requests. Wait a little, then retry.');
          throw new Error(`GitHub page returned ${response.status}. Retry later.`);
        }
        return response.text();
      })();
      cache.set(url.href, request);
      return request;
    }
    const refs = reverse ? [context.head, context.base] : [context.base, context.head];
    progress('Resolving comparison refs using your GitHub session…');
    async function resolve(ref) {
      if (SHA.test(ref)) return ref;
      let url = `${root}/tree/${encodeURIComponent(ref)}`;
      for (let hop = 0; hop < 4; hop++) {
        const result = parseRef(await get(url), hop > 0);
        if (typeof result === 'string') return result;
        const fragment = safeURL(result.next, context);
        if (!fragment.pathname.startsWith(`${root}/tree-commit/`) && !fragment.pathname.startsWith(`${root}/latest-commit/`)) throw new Error('Unexpected GitHub ref metadata link.');
        url = fragment.href;
      }
      throw new Error('GitHub ref metadata did not finish loading. Refresh and retry.');
    }
    const [base, head] = await Promise.all(refs.map(resolve));
    const page = parseCompare(await get(`${root}/compare/${base}...${head}`), context);
    const commits = new Map();
    const visited = new Set();
    let next = page.next;
    let pages = 0;
    if (page.inline) {
      const data = parseList(page.inline, context);
      for (const commit of data.commits) commits.set(commit.sha, commit);
      next = data.next; pages++;
    }
    while (next) {
      if (visited.has(next)) throw new Error('GitHub repeated a pagination link. Refresh and retry.');
      visited.add(next);
      const data = parseList(await get(next), context);
      const previous = commits.size;
      for (const commit of data.commits) commits.set(commit.sha, commit);
      pages++;
      progress(`Loaded ${commits.size} / ${page.total} commits · ${pages} page${pages === 1 ? '' : 's'}…`);
      if (commits.size === previous && (page.total > previous || data.next)) throw new Error('GitHub pagination stopped before the comparison was complete.');
      next = data.next;
    }
    if (commits.size !== page.total) throw new Error(`GitHub exposed ${commits.size} of ${page.total} commits. The complete list could not be verified; refresh and retry.`);
    const rows = [...commits.values()];
    if (!integrationOnly) return rows;
    let cursor = 0;
    let finished = 0;
    try { await Promise.all(Array.from({ length: Math.min(2, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        const detail = parseCommit(await get(`${root}/commit/${row.sha}`), context, row.sha);
        row.kind = detail.parents.length > 1 ? 'merge' : 'ordinary';
        if (row.kind === 'ordinary') {
          for (const url of new Set([...row.pullUrls, ...detail.pullUrls])) {
            const pr = parsePull(await get(url));
            if (pr.merged && pr.sha === row.sha) { row.kind = 'squash'; break; }
          }
        }
        progress(`Checking merge / squash evidence · ${++finished} / ${rows.length} commits…`);
      }
    })); } catch (error) { operation.abort(); throw error; }
    return rows;
  }
  return { load, parseRef, parseCompare, parseList, parseCommit, parsePull, safeURL };
})();
