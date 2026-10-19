// @vitest-environment jsdom
import { describe, test, expect, vi } from 'vitest';
import '../extension/compare.js';
const { parseCompare, parseList, parseCommit, parsePull, parseRef, safeURL, load } = globalThis.GHECompare;
const context = { owner: 'octo', repo: 'example', base: 'release/one', head: 'release/two' };
const A = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40), S = 'd'.repeat(40), W = 'e'.repeat(40);
const payload = value => `<script type="application/json">${JSON.stringify({ payload: value })}</script>`;
const commitPage = (sha, parents = [A], pr = '') => payload({ commitRoute: { commit: { oid: sha, parents, shortMessageMarkdown: pr ? `<div><a href="/octo/example/pull/${pr}">#${pr}</a></div>` : '<div>Work</div>' } } });
const pullPage = (sha, state = 'MERGED') => payload({ pullRequestsLayoutRoute: { pullRequest: { state, mergeCommitSha: sha } } });
const refPage = sha => payload({ codeViewTreeRoute: { refInfo: { currentOid: sha } } });
const comparePage = count => `<a href="#commits_bucket">Commits <span>${count.toLocaleString('en-US')}</span></a><div id="commits_bucket"><include-fragment src="/octo/example/compare/commit-list?range=${A}...${B}"></include-fragment></div>`;
const listPage = (shas, next = null) => shas.map(sha => `<li class="js-commits-list-item"><p><a class="markdown-title" href="/octo/example/commit/${sha}">Title ${sha.slice(0, 7)}</a><button>…</button></p></li>`).join('') + (next ? `<form class="js-ajax-pagination" method="get" action="/octo/example/compare/commit-list?range=${A}...${B}"><input name="page" value="${next}"></form>` : '');
const response = html => ({ ok: true, status: 200, text: async () => html });
function makeFetch(pages, count, details = {}) {
  return vi.fn(async (value, options) => {
    const url = new URL(value);
    if (url.pathname.includes('/tree/')) return response(refPage(url.pathname.includes('one') ? A : B));
    if (url.pathname.includes('/compare/commit-list')) return response(pages[Number(url.searchParams.get('page') || 1) - 1] || '');
    if (url.pathname.includes('/compare/')) return response(comparePage(count));
    if (details[url.pathname]) return response(details[url.pathname]);
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  });
}
describe('GitHub page adapters', () => {
  test('reads real-shaped ref, compare count, and read-only pagination', () => {
    expect(parseRef(refPage(A))).toBe(A);
    expect(parseCompare(comparePage(1234), context).total).toBe(1234);
    expect(new URL(parseList(listPage([M], 2), context).next).searchParams.get('page')).toBe('2');
  });
  test('reads inert route JSON even if Firefox sanitizes script tags from parsed DOM', () => {
    const OriginalParser = globalThis.DOMParser;
    globalThis.DOMParser = class {
      parseFromString(html, type) {
        const doc = new OriginalParser().parseFromString(html, type);
        doc.querySelectorAll('script').forEach(node => node.remove());
        return doc;
      }
    };
    try {
      expect(parseRef(refPage(A))).toBe(A);
      expect(parseCommit(commitPage(M, [A, B]), context, M).parents).toHaveLength(2);
      expect(parsePull(pullPage(S))).toEqual({ merged: true, sha: S });
    } finally { globalThis.DOMParser = OriginalParser; }
  });
  test('supports signed-in classic tree pages with the latest commit in the header', () => {
    expect(parseRef(`<div class="Box-header"><a href="/octo/example/commit/${A}">Latest change</a></div><a href="/octo/example/commit/${B}">README link</a>`)).toBe(A);
  });
  test('follows deferred latest-commit metadata on classic pages', async () => {
    const fetch = vi.fn(async value => {
      if (value.includes('/tree/')) return response('<include-fragment src="/octo/example/tree-commit/ref"></include-fragment>');
      if (value.includes('/tree-commit/')) return response(`<a href="/octo/example/commit/${A}">latest SHA</a>`);
      return response('<p>There isn’t anything to compare.</p>');
    });
    expect(await load(context, { integrationOnly: false }, fetch)).toEqual([]);
    expect(fetch.mock.calls.some(([url]) => url.includes('/tree-commit/'))).toBe(true);
  });
  test('preserves title text that GitHub splits into separate PR links', () => {
    const html = `<li class="js-commits-list-item"><p><a class="markdown-title" href="/octo/example/commit/${M}">Merge pull request</a> <a href="/octo/example/pull/123">#123</a> from branch<button>…</button></p></li>`;
    const row = parseList(html, context).commits[0];
    expect(row.commit.message).toBe('Merge pull request #123 from branch');
    expect(row.pullUrls).toEqual(['https://github.com/octo/example/pull/123']);
  });
  test('recognizes empty reverse comparisons, not arbitrary empty pages', () => {
    expect(parseCompare('<p>There isn’t anything to compare.</p>', context)).toEqual({ total: 0, next: null });
    expect(() => parseCompare('<p>Loading…</p>', context)).toThrow('layout was not recognized');
  });
  test('supports small comparisons with inline commits and a summary count', async () => {
    const html = `<div><ul><li><svg class="octicon-git-commit"></svg><span class="text-emphasized">1</span> commit</li></ul></div><div id="commits_bucket">${listPage([M])}</div>`;
    expect(parseCompare(html, context).total).toBe(1);
    const fetch = vi.fn(async value => response(value.includes('/tree/') ? refPage(value.includes('one') ? A : B) : html));
    expect(await load(context, { integrationOnly: false }, fetch)).toHaveLength(1);
    expect(fetch.mock.calls).toHaveLength(3);
  });
  test('does not mistake a login page for a successful empty comparison', () => {
    expect(() => parseCompare('<form action="/session"><input name="login"></form>', context)).toThrow('Sign in');
  });
  test('checks exact commit SHA and parents; reads merged PR SHA', () => {
    expect(parseCommit(commitPage(M, [A, B]), context, M).parents).toHaveLength(2);
    expect(() => parseCommit(commitPage(W), context, M)).toThrow('commit parents');
    expect(parsePull(pullPage(S))).toEqual({ merged: true, sha: S });
    expect(parsePull(pullPage(S, 'OPEN')).merged).toBe(false);
  });
  test('rejects cross-origin, cross-repository, and write pagination links', () => {
    expect(() => safeURL('https://evil.example/octo/example/compare/commit-list', context, 'feed')).toThrow();
    expect(() => safeURL('/other/repo/compare/commit-list', context, 'feed')).toThrow();
    expect(() => parseList('<form class="js-ajax-pagination" action="/octo/example/compare/commit-list" method="post"></form>', context)).toThrow('pagination method');
    expect(() => safeURL('https://token@github.com/octo/example/pull/1', context, 'pull')).toThrow();
  });
});
describe('session-based complete comparisons', () => {
  test('loads more than 250 commits and pins refs before following all pages', async () => {
    const shas = Array.from({ length: 321 }, (_, i) => i.toString(16).padStart(40, '0'));
    const fetch = makeFetch([listPage(shas.slice(0, 100), 2), listPage(shas.slice(100, 200), 3), listPage(shas.slice(200, 300), 4), listPage(shas.slice(300))], 321);
    expect(await load(context, { integrationOnly: false }, fetch)).toHaveLength(321);
    expect(fetch.mock.calls[2][0]).toContain(`/compare/${A}...${B}`);
    expect(fetch.mock.calls.filter(([url]) => url.includes('/commit-list'))).toHaveLength(4);
    for (const [url, options] of fetch.mock.calls) {
      expect(new URL(url).origin).toBe('https://github.com');
      expect(options).toMatchObject({ credentials: 'same-origin', mode: 'same-origin', method: 'GET', redirect: 'error' });
      expect(Object.keys(options.headers)).toEqual(['Accept']);
    }
  });
  test('reverse compares B...A using the same session', async () => {
    const fetch = makeFetch([listPage([M])], 1);
    await load(context, { reverse: true, integrationOnly: false }, fetch);
    expect(fetch.mock.calls[0][0]).toContain('release%2Ftwo');
    expect(fetch.mock.calls[2][0]).toContain(`/compare/${B}...${A}`);
  });
  test('detects merge parents, verified squash links, and ordinary work', async () => {
    const fragment = listPage([M, S, W]).replace(`Title ${S.slice(0, 7)}</a>`, `Title ${S.slice(0, 7)}</a> <a href="/octo/example/pull/42">#42</a>`);
    const fetch = makeFetch([fragment], 3, { [`/octo/example/commit/${M}`]: commitPage(M, [A, B]), [`/octo/example/commit/${S}`]: commitPage(S), [`/octo/example/commit/${W}`]: commitPage(W), '/octo/example/pull/42': pullPage(S) });
    const rows = await load(context, {}, fetch);
    expect(rows.map(row => row.kind)).toEqual(['merge', 'squash', 'ordinary']);
  });
  test('does not classify an in-between commit as squash just because it links a PR', async () => {
    const fetch = makeFetch([listPage([W])], 1, { [`/octo/example/commit/${W}`]: commitPage(W, [A], '42'), '/octo/example/pull/42': pullPage(S) });
    expect((await load(context, {}, fetch))[0].kind).toBe('ordinary');
  });
  test('fails visibly on incomplete or looping pagination', async () => {
    await expect(load(context, { integrationOnly: false }, makeFetch([listPage([M])], 2))).rejects.toThrow('1 of 2');
    await expect(load(context, { integrationOnly: false }, makeFetch([listPage([M], 2), listPage([M], 2)], 3))).rejects.toThrow('pagination stopped');
  });
  test.each([401, 403, 404, 429, 500])('HTTP %i cannot look like an empty comparison', async status => {
    await expect(load(context, {}, async () => ({ ok: false, status }))).rejects.toThrow();
  });
  test('aborts requests on navigation or clear', async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn();
    await expect(load(context, { signal: controller.signal }, fetch)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
