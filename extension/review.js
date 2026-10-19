/* global GHECore */
globalThis.GHEReview = (() => {
  // Keep adapters here: GitHub runs both classic and React PR views.
  const threadSelector = '.js-resolvable-timeline-thread, .js-resolvable-timeline-thread-container, .review-thread, [data-testid="review-thread"], [data-testid="review-thread-container"], [data-testid="comment-thread"], [data-thread-id]';
  const commentSelector = '.timeline-comment, .js-comment, [data-testid="issue-comment"], [data-testid="comment-container"], [data-testid="review-comment"], [data-testid="pull-request-review"], [data-marker-navigation-comment-id]';
  const hidden = new Set();
  function author(element) {
    const node = element.querySelector('.timeline-comment-header .author, .comment-header .author, a.author, [data-testid="comment-author"], [data-testid="comment-header"] a[data-hovercard-type="user"], a[data-hovercard-type="user"]');
    if (!node) return null;
    const href = node.getAttribute('href') || '';
    const match = href.match(/^(?:https:\/\/github.com)?\/([^/?#]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : node.textContent.trim().replace(/^@/, '');
  }
  function restore() {
    for (const element of hidden) element.removeAttribute('data-ghe-hidden');
    hidden.clear();
  }
  function apply(root, prefs) {
    restore();
    if (prefs.mode === 'all') return { hidden: 0, recognized: 0 };
    const threads = [...root.querySelectorAll(threadSelector)].filter(node => !node.parentElement?.closest(threadSelector));
    const comments = [...root.querySelectorAll(commentSelector)].filter(node =>
      (prefs.mode === 'exclude' || !node.closest(threadSelector)) && !node.parentElement?.closest(commentSelector) && !node.querySelector(threadSelector));
    // Never hide the PR's opening description or a comment editor.
    let recognized = 0;
    for (const element of [...threads, ...comments]) {
      if (element.parentElement?.closest('[data-ghe-hidden]')) continue;
      if (element.closest('#gh-extensions') || element.id.startsWith('pullrequest-') || element.matches('.js-issue-body, [data-testid="issue-body"], [data-testid="pr-description"]') || element.querySelector('.js-issue-body, [data-testid="issue-body"], [data-testid="pr-description"]')) continue;
      const login = author(element);
      if (!login) continue; // Leave unknown layouts visible, never guess authors.
      recognized++;
      if (!GHECore.visible(login, prefs)) {
        element.setAttribute('data-ghe-hidden', '');
        hidden.add(element);
      }
    }
    // Hide a review wrapper only when every nested discussion is hidden and its
    // own summary author is excluded. Retained threads survive excluded reviewers.
    for (const review of root.querySelectorAll('.js-pull-request-review')) {
      const nested = [...review.querySelectorAll(threadSelector)];
      if (nested.length && nested.every(node => node.closest('[data-ghe-hidden]')) && !GHECore.visible(author(review), prefs)) {
        review.setAttribute('data-ghe-hidden', ''); hidden.add(review);
      }
    }
    return { hidden: hidden.size, recognized };
  }
  return { apply, restore, author };
})();
