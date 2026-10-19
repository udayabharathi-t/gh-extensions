/* global GHECore, importScripts, browser, chrome */
if (!globalThis.GHECore) importScripts('core.js');
const api = globalThis.browser || globalThis.chrome;
// Preferences are shared through validated background messages.
api.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
// Remove credentials left by versions before 0.2. No credential is read.
api.storage.local.remove('token');
api.action.onClicked.addListener(() => api.runtime.openOptionsPage());

api.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== api.runtime.id || !sender.url?.startsWith('https://github.com/')) return false;
  (async () => {
    switch (message.type) {
      case 'settings': await api.runtime.openOptionsPage(); return {};
      case 'prefs': return (await api.storage.local.get('reviewPrefs')).reviewPrefs || { mode: 'all', users: '' };
      case 'savePrefs': {
        const prefs = { mode: ['include', 'exclude'].includes(message.prefs?.mode) ? message.prefs.mode : 'all', users: GHECore.users(message.prefs?.users).join(', ') };
        await api.storage.local.set({ reviewPrefs: prefs });
        return prefs;
      }
      default: throw new Error('Unknown extension request.');
    }
  })().then(data => respond({ data }), error => respond({ error: error.message || 'Request failed.' }));
  return true;
});
