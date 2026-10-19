import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
for (const target of ['chrome', 'firefox']) {
  const directory = new URL(`../dist/${target}/`, import.meta.url);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp(new URL('../extension/', import.meta.url), directory, { recursive: true });
  const manifest = {
    manifest_version: 3, name: 'GH Extensions', version,
    description: 'Complete GitHub comparisons, reverse commit checks, and PR review focus by thread author.',
    permissions: ['storage'], host_permissions: ['https://api.github.com/*'],
    content_scripts: [{ matches: ['https://github.com/*'], js: ['core.js', 'review.js', 'content.js'], css: ['content.css'], run_at: 'document_idle' }],
    options_ui: { page: 'options.html', open_in_tab: true },
    action: { default_title: 'GH Extensions settings' },
    icons: { 48: 'icons/48.png', 128: 'icons/128.png' },
    ...(target === 'chrome' ? {
      minimum_chrome_version: '120', background: { service_worker: 'background.js' },
    } : {
      background: { scripts: ['core.js', 'background.js'] },
      browser_specific_settings: { gecko: { id: 'gh-extensions@udayabharathi-t.github.io', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } },
    }),
  };
  await writeFile(new URL('manifest.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log('Built dist/chrome and dist/firefox');
