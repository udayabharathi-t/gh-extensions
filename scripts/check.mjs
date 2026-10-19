import './build.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const source = new URL('../extension/', import.meta.url);
for (const file of await readdir(source)) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', new URL(file, source).pathname]);
}
for (const browser of ['chrome', 'firefox']) {
  const dir = new URL(`../dist/${browser}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', dir)));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
  const files = [...manifest.content_scripts.flatMap(script => [...script.js, ...script.css]), ...Object.values(manifest.icons), manifest.options_ui.page];
  files.push(...(browser === 'chrome' ? [manifest.background.service_worker] : manifest.background.scripts));
  await Promise.all(files.map(file => readFile(new URL(file, dir))));
  assert.equal(Boolean(manifest.background.service_worker), browser === 'chrome');
}
console.log('JavaScript syntax and both generated manifests verified.');
