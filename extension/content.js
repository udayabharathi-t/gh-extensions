/* global GHECore, GHEReview */
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const send = async message => {
    const result = await api.runtime.sendMessage(message);
    if (!result || result.error) throw new Error(result?.error || 'Extension disconnected. Reload this page.');
    return result.data;
  };
  let href = '';
  let context;
  let panel;
  let prefs = { mode: 'all', users: '' };
  let generation = 0;
  let observer;
  const el = (tag, text, attrs = {}) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  function button(text, action) {
    const node = el('button', text, { type: 'button' });
    node.addEventListener('click', action);
    return node;
  }
  function review() {
    if (context?.kind !== 'pull' || !panel?.isConnected) return;
    // Ignore our own visibility mutations and status text changes.
    observer.disconnect();
    const result = GHEReview.apply(document, prefs);
    panel.querySelector('[data-status]').textContent = prefs.mode === 'all'
      ? 'All conversations visible.'
      : `${result.hidden} discussion${result.hidden === 1 ? '' : 's'} hidden · ${result.recognized} recognized. Applies to loaded comments; expand or load more to include additional threads.`;
    observe();
  }
  function observe() {
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function reviewUI() {
    const controls = el('div', '', { class: 'ghe-controls' });
    const mode = el('select', '', { 'aria-label': 'Comment filter mode' });
    for (const [value, name] of [['all', 'Show everyone'], ['include', 'Only these authors'], ['exclude', 'Hide these authors']]) mode.append(el('option', name, { value }));
    mode.value = prefs.mode;
    const users = el('input', '', { type: 'text', 'aria-label': 'GitHub usernames', placeholder: 'username, another-user', autocomplete: 'off' });
    users.value = prefs.users;
    async function apply(next) {
      try {
        prefs = await send({ type: 'savePrefs', prefs: next });
        mode.value = prefs.mode; users.value = prefs.users; review();
      } catch (error) { panel.querySelector('[data-status]').textContent = error.message; }
    }
    const applyButton = button('Apply', () => apply({ mode: mode.value, users: users.value }));
    users.addEventListener('keydown', event => { if (event.key === 'Enter') applyButton.click(); });
    controls.append(mode, users, applyButton, button('Only mine', () => {
      const login = document.querySelector('meta[name="user-login"]')?.content;
      if (login) apply({ mode: 'include', users: login });
      else panel.querySelector('[data-status]').textContent = 'Enter your GitHub username, select Only these authors, then Apply.';
    }), button('Reset', () => apply({ mode: 'all', users: '' })));
    panel.append(controls, el('p', 'Include keeps threads started by these authors, with all replies. Exclude hides their threads and individual replies elsewhere. Your PR description and comment editors stay visible.', { class: 'ghe-note' }), el('p', '', { 'data-status': '', role: 'status' }));
    review();
  }
  function compareUI() {
    const controls = el('div', '', { class: 'ghe-controls' });
    const label = el('label');
    const check = el('input', '', { type: 'checkbox' }); check.checked = true;
    label.append(check, document.createTextNode(' Merge / squash commits only'));
    const results = el('div', '', { class: 'ghe-results' });
    let busy = false;
    let run = 0;
    const forward = button('Load A → B', () => load(false));
    const reverse = button('Check reverse B → A', () => load(true));
    const reset = button('Clear results', () => { run++; results.replaceChildren(); });
    check.addEventListener('change', () => { run++; results.replaceChildren(); });
    async function load(backwards) {
      if (busy) return;
      busy = true; forward.disabled = reverse.disabled = true;
      const currentRun = ++run;
      const currentGeneration = generation;
      const integrationOnly = check.checked;
      const section = el('section');
      const status = el('p', 'Fetching every page from GitHub…', { role: 'status' });
      section.append(el('h3', backwards ? 'B → A · commits in A, absent from B' : 'A → B · commits in B, absent from A'), status);
      results.replaceChildren(section);
      try {
        const commits = await send({ type: 'compare', reverse: backwards, integrationOnly });
        if (currentRun !== run || currentGeneration !== generation) return;
        const shown = integrationOnly ? commits.filter(commit => commit.kind !== 'ordinary') : commits;
        status.textContent = `${shown.length} shown / ${commits.length} commit${commits.length === 1 ? '' : 's'} across all pages${integrationOnly ? ' · merge / squash filter applied' : ''}.`;
        section.append(el('a', backwards ? 'Open reverse file diff ↗' : 'Open full file diff ↗', { href: `https://github.com/${context.owner}/${context.repo}/compare/${encodeURIComponent(backwards ? context.head : context.base)}...${encodeURIComponent(backwards ? context.base : context.head)}`, target: '_blank', rel: 'noopener noreferrer' }));
        if (backwards) section.append(el('p', 'These are ancestry differences, not proof of missing code: cherry-picks and rebased changes may have different SHAs.', { class: 'ghe-note' }));
        if (integrationOnly) section.append(el('p', 'Squash detection matches the PR’s recorded merge SHA. GitHub also uses this field for the final rebased commit, so those can appear here.', { class: 'ghe-note' }));
        if (!shown.length) section.append(el('p', 'No matching commits.'));
        const list = el('ol', '', { class: 'ghe-commits' });
        for (const commit of shown) {
          const item = el('li');
          const link = el('a', commit.commit.message.split('\n')[0], { href: `https://github.com/${context.owner}/${context.repo}/commit/${encodeURIComponent(commit.sha)}`, target: '_blank', rel: 'noopener noreferrer' });
          item.append(link, el('small', `${commit.sha.slice(0, 7)}${commit.kind ? ` · ${commit.kind === 'squash' ? 'squash / PR integration' : commit.kind}` : ''}`));
          list.append(item);
        }
        section.append(list);
      } catch (error) {
        if (currentRun === run && currentGeneration === generation) status.textContent = error.message;
      } finally {
        busy = false; forward.disabled = reverse.disabled = false;
      }
    }
    controls.append(label, forward, reverse, reset);
    panel.append(el('p', `A: ${context.base} → B: ${context.head}`, { class: 'ghe-refs' }), controls, el('p', 'Load the complete commit list here. GitHub’s native diff stays available below.', { class: 'ghe-note' }), results);
  }
  async function mount() {
    if (href === location.href && panel?.isConnected) return;
    href = location.href; generation++;
    const current = generation;
    GHEReview.restore(); panel?.remove(); panel = null;
    try { context = GHECore.route(href); } catch { context = null; }
    if (!context) return;
    const main = document.querySelector('main, [role="main"], #repo-content-pjax-container');
    if (!main) { href = ''; return; }
    const host = el('aside', '', { id: 'gh-extensions', 'aria-label': 'GH Extensions' });
    panel = host;
    const header = el('div', '', { class: 'ghe-heading' });
    header.append(el('strong', 'GH Extensions'), el('span', context.kind === 'compare' ? 'Compare focus' : 'Review focus'), button('Settings', () => send({ type: 'settings' }).catch(error => { header.lastElementChild.textContent = error.message; })));
    panel.append(header);
    main.prepend(panel);
    if (context.kind === 'compare') compareUI();
    else {
      try { prefs = await send({ type: 'prefs' }); } catch { /* Defaults work without saved settings. */ }
      if (generation === current && host.isConnected) reviewUI();
    }
  }
  let scheduled;
  observer = new MutationObserver(records => {
    if (records.every(record => panel?.contains(record.target))) return;
    clearTimeout(scheduled);
    scheduled = setTimeout(async () => { await mount(); review(); }, 120);
  });
  observe();
  document.addEventListener('turbo:load', mount);
  document.addEventListener('pjax:end', mount);
  window.addEventListener('popstate', mount);
  // Detect pushState navigation without injecting code into GitHub's page world.
  setInterval(mount, 1000);
  mount();
})();
