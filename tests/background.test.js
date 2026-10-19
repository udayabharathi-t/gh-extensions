import { test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = name => readFileSync(new URL(`../extension/${name}.js`, import.meta.url), 'utf8');
function setup(fetch, token = '') {
  let listener;
  const data = { token };
  const browser = {
    runtime: { id: 'test-extension', onMessage: { addListener: fn => { listener = fn; } }, openOptionsPage: vi.fn() },
    action: { onClicked: { addListener: vi.fn() } },
    storage: { local: { setAccessLevel: vi.fn(), get: async key => ({ [key]: data[key] }), set: async next => Object.assign(data, next) }, onChanged: { addListener: vi.fn() } },
  };
  const scope = vm.createContext({ browser, fetch, AbortSignal, URL, console });
  vm.runInContext(source('core'), scope);
  vm.runInContext(source('background'), scope);
  const sender = { id: 'test-extension', url: 'https://github.com/o/r/compare/a...b' };
  const message = (request, from = sender) => new Promise(resolve => {
    if (!listener(request, from, resolve)) resolve(null);
  });
  return { message, browser, data, sender };
}
test('API calls stay on GitHub, use authorization, and never return tokens', async () => {
  const fetch = vi.fn(async url => ({ ok: true, json: async () => url.includes('/compare/') ? { total_commits: 0, commits: [] } : { sha: 'a'.repeat(40) } }));
  const { message } = setup(fetch, 'secret-test-token');
  const prefs = await message({ type: 'prefs' });
  expect(JSON.stringify(prefs)).not.toContain('secret-test-token');
  expect((await message({ type: 'compare' })).data).toEqual([]);
  for (const [url, options] of fetch.mock.calls) {
    expect(url.startsWith('https://api.github.com/repos/o/r/')).toBe(true);
    expect(options.headers.Authorization).toBe('Bearer secret-test-token');
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
  }
});
test('rejects messages from other extensions and non-GitHub pages', async () => {
  const { message, sender } = setup(vi.fn());
  expect(await message({ type: 'prefs' }, { ...sender, id: 'other' })).toBeNull();
  expect(await message({ type: 'prefs' }, { ...sender, url: 'https://evil.example' })).toBeNull();
});
test.each([401, 403, 404, 429, 500])('API %i is an explicit error, not an empty successful result', async status => {
  const { message } = setup(async () => ({ ok: false, status, headers: new Headers() }));
  const result = await message({ type: 'compare' });
  expect(result.error).toBeTruthy(); expect(result.data).toBeUndefined();
});
test('uses current tab URL after GitHub SPA navigation', async () => {
  const fetch = vi.fn(async url => ({ ok: true, json: async () => url.includes('/compare/') ? { total_commits: 0, commits: [] } : { sha: 'b'.repeat(40) } }));
  const { message, sender } = setup(fetch);
  await message({ type: 'compare' }, { ...sender, tab: { url: 'https://github.com/new/repo/compare/c...d' } });
  expect(fetch.mock.calls[0][0]).toContain('/repos/new/repo/');
});
