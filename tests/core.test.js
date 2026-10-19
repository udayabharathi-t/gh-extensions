import { describe, test, expect, vi } from 'vitest';
import '../extension/core.js';
const { route, visible, users, compare, classify } = globalThis.GHECore;
const context = { owner: 'octo', repo: 'example', base: 'release/one', head: 'release/two' };
const commit = (sha, parents = 1) => ({ sha, parents: Array.from({ length: parents }, () => ({})), commit: { message: sha } });
function fixture(pages, total, calls = []) {
  return async path => {
    calls.push(path);
    if (!path.includes('/compare/')) return { sha: path.includes('one') ? 'a'.repeat(40) : 'b'.repeat(40) };
    return { total_commits: total, commits: pages[Number(new URL(`https://api.github.com${path}`).searchParams.get('page')) - 1] || [] };
  };
}
describe('routes and user matching', () => {
  test('encoded and slash-containing refs, query strings, changes view', () => {
    expect(route('https://github.com/o/r/compare/release%2Fone...release/two?expand=1')).toMatchObject({ base: 'release/one', head: 'release/two' });
    expect(route('https://github.com/o/r/pull/123/changes')).toMatchObject({ kind: 'pull', number: '123' });
    expect(route('https://github.com/o/r/pull/123/files/abcdef')).toMatchObject({ number: '123' });
    expect(route('https://evil.example/o/r/compare/a...b')).toBeNull();
    expect(route('https://github.com/o/r/issues/123')).toBeNull();
  });
  test('normalizes usernames and matches exact names', () => {
    expect(users('@Alice, ALICE; bob\ncarol')).toEqual(['alice', 'bob', 'carol']);
    expect(visible('ALICE', { mode: 'include', users: '@alice' })).toBe(true);
    expect(visible('alice-bot', { mode: 'include', users: 'alice' })).toBe(false);
    expect(visible('bob', { mode: 'exclude', users: 'bob' })).toBe(false);
    expect(visible(null, { mode: 'include', users: 'alice' })).toBe(true);
  });
});
describe('complete comparisons', () => {
  test('collects more than 250 commits and pins refs for every page', async () => {
    const commits = Array.from({ length: 321 }, (_, i) => commit(String(i)));
    const calls = [];
    expect(await compare(fixture([commits.slice(0, 100), commits.slice(100, 200), commits.slice(200, 300), commits.slice(300)], 321, calls), context)).toHaveLength(321);
    expect(calls.filter(p => p.includes('/compare/'))).toHaveLength(4);
    expect(calls[2]).toContain(`${'a'.repeat(40)}...${'b'.repeat(40)}`);
  });
  test('reverse resolves B then A and queries B...A', async () => {
    const calls = [];
    await compare(fixture([[commit('missed')]], 1, calls), context, true);
    expect(calls[0]).toContain('release%2Ftwo');
    expect(calls[2]).toContain(`${'b'.repeat(40)}...${'a'.repeat(40)}`);
  });
  test('empty reverse results are successful', async () => {
    expect(await compare(fixture([[]], 0), context, true)).toEqual([]);
  });
  test('does not silently accept incomplete pagination or duplicate pages', async () => {
    await expect(compare(fixture([[commit('same')], [commit('same')]], 10), context)).rejects.toThrow('pagination stopped early');
  });
});
describe('merge and squash classification', () => {
  test('uses parent counts and merged PR SHA, not commit-title guesses', async () => {
    const get = vi.fn(async path => path.includes('/squashed/') ? [{ merged_at: '2026-01-01', merge_commit_sha: 'squashed' }] : [{ merged_at: null, merge_commit_sha: 'work' }]);
    const rows = await classify(get, context, [commit('merged', 2), commit('squashed'), commit('work')]);
    expect(rows.map(row => row.kind)).toEqual(['merge', 'squash', 'ordinary']);
    expect(get).toHaveBeenCalledTimes(2);
  });
  test('a commit associated with an ordinary merged PR is not automatically squash', async () => {
    const rows = await classify(async () => [{ merged_at: 'date', merge_commit_sha: 'different' }], context, [commit('work')]);
    expect(rows[0].kind).toBe('ordinary');
  });
  test('follows all associated PR pages', async () => {
    const rows = await classify(async path => path.endsWith('page=1') ? Array.from({ length: 100 }, () => ({ merged_at: null })) : [{ merged_at: 'date', merge_commit_sha: 's' }], context, [commit('s')]);
    expect(rows[0].kind).toBe('squash');
  });
  test('lookup errors stay visible instead of hiding possible squash commits', async () => {
    await expect(classify(async () => { throw new Error('Rate limited'); }, context, [commit('a')])).rejects.toThrow('Rate limited');
  });
});
