import './build.mjs';
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
for (const browser of ['chrome', 'firefox']) {
  const file = new URL(`../artifacts/gh-extensions-${browser}.zip`, import.meta.url);
  await rm(file, { force: true });
  execFileSync('zip', ['-qr', file.pathname, '.'], { cwd: new URL(`../dist/${browser}/`, import.meta.url) });
}
console.log('Created artifacts/gh-extensions-{chrome,firefox}.zip');
