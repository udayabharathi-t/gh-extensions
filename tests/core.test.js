import { describe, test, expect, vi } from 'vitest';
import '../extension/core.js';
const { route, visible, users } = globalThis.GHECore;
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
