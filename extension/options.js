const api = globalThis.browser || globalThis.chrome;
const status = document.querySelector('#status');
api.storage.local.remove('token').then(() => {
  status.textContent = 'No token configuration is needed. Any credential saved by an earlier version has been removed.';
}).catch(() => { status.textContent = 'Could not clear old settings. Remove and reload the add-on to clear its old data.'; });
