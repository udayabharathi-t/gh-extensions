// @vitest-environment jsdom
import { beforeEach, describe, test, expect } from 'vitest';
import '../extension/core.js';
import '../extension/review.js';
const { apply, restore } = globalThis.GHEReview;
const author = name => `<a class="author" href="/${name}">${name}</a>`;
const classicThread = (id, first, reply) => `<review-thread-collapsible id="${id}" class="js-resolvable-timeline-thread-container"><div class="js-comment">${author(first)}<p>Root</p></div><div class="js-comment">${author(reply)}<p>Reply</p></div><textarea></textarea></review-thread-collapsible>`;
beforeEach(() => {
  restore();
  document.body.innerHTML = `<div id="pullrequest-123" class="timeline-comment">${author('excluded')}<p>PR description</p></div>${classicThread('mine', 'alice', 'excluded')}${classicThread('other', 'excluded', 'alice')}<div id="standalone" class="timeline-comment">${author('excluded')}<p>Standalone</p></div><div class="timeline-comment" id="unknown">Unknown author</div><form id="editor"><textarea></textarea></form>`;
});
describe('thread-based review focus', () => {
  test('include keeps all replies to my threads; my replies do not include someone else’s thread', () => {
    apply(document, { mode: 'include', users: 'alice' });
    expect(document.querySelector('#mine').hasAttribute('data-ghe-hidden')).toBe(false);
    expect(document.querySelectorAll('#mine [data-ghe-hidden]')).toHaveLength(0);
    expect(document.querySelector('#other').hasAttribute('data-ghe-hidden')).toBe(true);
    expect(document.querySelector('#standalone').hasAttribute('data-ghe-hidden')).toBe(true);
  });
  test('exclude hides entire excluded threads and excluded replies elsewhere', () => {
    apply(document, { mode: 'exclude', users: 'excluded' });
    expect(document.querySelector('#other').hasAttribute('data-ghe-hidden')).toBe(true);
    expect(document.querySelector('#mine').hasAttribute('data-ghe-hidden')).toBe(false);
    expect(document.querySelector('#mine .js-comment:last-of-type').hasAttribute('data-ghe-hidden')).toBe(true);
  });
  test('description, unknown layouts, and editors remain visible', () => {
    apply(document, { mode: 'include', users: 'alice' });
    for (const id of ['pullrequest-123', 'unknown', 'editor']) expect(document.getElementById(id).hasAttribute('data-ghe-hidden')).toBe(false);
  });
  test('reset restores every hidden element', () => {
    apply(document, { mode: 'include', users: 'alice' });
    apply(document, { mode: 'all', users: '' });
    expect(document.querySelectorAll('[data-ghe-hidden]')).toHaveLength(0);
  });
  test('newly loaded comments get the existing filter', () => {
    apply(document, { mode: 'include', users: 'alice' });
    document.body.insertAdjacentHTML('beforeend', classicThread('lazy', 'bob', 'alice'));
    apply(document, { mode: 'include', users: 'alice' });
    expect(document.querySelector('#lazy').hasAttribute('data-ghe-hidden')).toBe(true);
  });
  test('React Files changed threads use the starter and retain nested replies', () => {
    document.body.innerHTML = `<div data-testid="review-thread" id="react"><div data-first-thread-comment="true"><div data-testid="comment-header"><a href="/alice" data-hovercard-type="user">Alice</a></div></div><div data-testid="review-comment"><div data-testid="comment-header"><a href="/bob" data-hovercard-type="user">Bob</a></div>Reply</div></div>`;
    apply(document, { mode: 'include', users: 'alice' });
    expect(document.querySelectorAll('[data-ghe-hidden]')).toHaveLength(0);
    apply(document, { mode: 'exclude', users: 'alice' });
    expect(document.getElementById('react').hasAttribute('data-ghe-hidden')).toBe(true);
  });
  test('nested adapters do not split a retained thread into individual comments', () => {
    document.body.innerHTML = `<div class="review-thread" id="outer"><div data-testid="review-thread">${author('alice')}<div class="js-comment">${author('bob')}</div></div></div>`;
    apply(document, { mode: 'include', users: 'alice' });
    expect(document.querySelectorAll('[data-ghe-hidden]')).toHaveLength(0);
  });
});
