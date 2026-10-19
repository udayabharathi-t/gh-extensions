import { test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const source = name => readFileSync(new URL(`../extension/${name}.js`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
async function setup(path, handler) {
  const dom = new JSDOM('<meta name="user-login" content="alice"><main><div class="review-thread" id="mine"><a class="author" href="/alice">alice</a><p>My root</p></div><div class="review-thread" id="other"><a class="author" href="/bob">bob</a><p>Other root</p></div></main>', { url: `https://github.com/o/r/${path}`, runScripts: 'outside-only' });
  let prefs = { mode: 'all', users: '' };
  dom.window.chrome = { runtime: { sendMessage: async message => {
    if (message.type === 'prefs') return { data: prefs };
    if (message.type === 'savePrefs') { prefs = message.prefs; return { data: prefs }; }
    return handler?.(message) || { data: {} };
  } } };
  for (const file of ['core', 'review', 'content']) dom.window.eval(source(file));
  await tick();
  return dom;
}
test('Only mine applies the filter and Reset restores the page', async () => {
  const dom = await setup('pull/1');
  try {
    const document = dom.window.document;
    [...document.querySelectorAll('button')].find(e => e.textContent === 'Only mine').click();
    await tick();
    expect(document.querySelector('#other').hasAttribute('data-ghe-hidden')).toBe(true);
    expect(document.querySelector('#mine').hasAttribute('data-ghe-hidden')).toBe(false);
    [...document.querySelectorAll('button')].find(e => e.textContent === 'Reset').click();
    await tick();
    expect(document.querySelectorAll('[data-ghe-hidden]')).toHaveLength(0);
  } finally { dom.window.close(); }
});
test('reverse button sends reverse=true, renders all results safely, and links the reverse file diff', async () => {
  let request;
  const dom = await setup('compare/a...b', message => {
    request = message;
    return { data: [{ sha: 'abc', kind: 'merge', commit: { message: '<img src=x onerror=alert(1)>' } }] };
  });
  try {
    [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Check reverse')).click();
    await tick();
    expect(request).toMatchObject({ reverse: true, integrationOnly: true });
    expect(dom.window.document.querySelector('.ghe-commits').textContent).toContain('<img');
    expect(dom.window.document.querySelector('.ghe-commits img')).toBeNull();
    expect(dom.window.document.querySelector('a[href$="/compare/b...a"]')).not.toBeNull();
  } finally { dom.window.close(); }
});
test('compare API failure is shown with an enabled retry button', async () => {
  const dom = await setup('compare/a...b', () => ({ error: 'Repository access requires a token' }));
  try {
    const button = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent.includes('Load A'));
    button.click(); await tick();
    expect(dom.window.document.querySelector('[role="status"]').textContent).toContain('requires a token');
    expect(button.disabled).toBe(false);
  } finally { dom.window.close(); }
});
test('SPA navigation clears old filters and mounts the new feature', async () => {
  const dom = await setup('pull/1');
  try {
    [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === 'Only mine').click(); await tick();
    dom.window.history.pushState({}, '', '/o/r/compare/a...b');
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:load')); await tick();
    expect(dom.window.document.querySelectorAll('[data-ghe-hidden]')).toHaveLength(0);
    expect(dom.window.document.querySelector('#gh-extensions').textContent).toContain('Compare focus');
    expect(dom.window.document.querySelectorAll('#gh-extensions')).toHaveLength(1);
  } finally { dom.window.close(); }
});
