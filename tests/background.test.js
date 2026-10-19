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
    storage: { local: { setAccessLevel: vi.fn(), remove: vi.fn(async key => { delete data[key]; }), get: async key => ({ [key]: data[key] }), set: async next => Object.assign(data, next) }, onChanged: { addListener: vi.fn() } },
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
test('preferences never return legacy credentials and old tokens are deleted', async () => {
  const fetch = vi.fn();
  const { message, browser } = setup(fetch, 'legacy-test-credential');
  const prefs = await message({ type: 'prefs' });
  expect(JSON.stringify(prefs)).not.toContain('legacy-test-credential');
  expect(browser.storage.local.remove).toHaveBeenCalledWith('token');
  expect((await message({ type: 'compare' })).error).toBe('Unknown extension request.');
  expect(fetch).not.toHaveBeenCalled();
});
test('rejects messages from other extensions and non-GitHub pages', async () => {
  const { message, sender } = setup(vi.fn());
  expect(await message({ type: 'prefs' }, { ...sender, id: 'other' })).toBeNull();
  expect(await message({ type: 'prefs' }, { ...sender, url: 'https://evil.example' })).toBeNull();
});
