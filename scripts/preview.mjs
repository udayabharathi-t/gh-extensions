import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const file = path === '/' ? 'dev/preview.html' : path.slice(1);
  if (!/^(dev\/[a-z-]+\.html|extension\/[a-z-]+\.(?:js|css)|extension\/icons\/(?:48|128)\.png)$/.test(file)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const mime = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript';
    response.writeHead(200, { 'Content-Type': mime }); response.end(await readFile(new URL(file, root)));
  } catch { response.writeHead(404); response.end(); }
}).listen(8765, '127.0.0.1', () => console.log('Synthetic-data preview: http://127.0.0.1:8765'));
