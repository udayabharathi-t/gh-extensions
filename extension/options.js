const api = globalThis.browser || globalThis.chrome;
const token = document.querySelector('#token');
const status = document.querySelector('#status');
api.storage.local.get('token').then(saved => {
  status.textContent = saved.token ? 'A token is saved. Paste a new one to replace it.' : 'No token saved.';
}).catch(() => { status.textContent = 'Could not read settings.'; });
document.querySelector('#settings').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (!token.value.trim()) { status.textContent = 'Paste a token, or use Remove token.'; return; }
    await api.storage.local.set({ token: token.value.trim() });
    token.value = '';
    status.textContent = 'Token saved. Retry your comparison on GitHub.';
  } catch { status.textContent = 'Could not save the token.'; }
});
document.querySelector('#remove').addEventListener('click', async () => {
  try {
    await api.storage.local.remove('token'); token.value = '';
    status.textContent = 'Token removed.';
  } catch { status.textContent = 'Could not remove the token.'; }
});
