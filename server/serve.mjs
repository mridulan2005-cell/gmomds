// Production server: serves the built app (dist/) and the /api routes.
// Usage: npm run build && ANTHROPIC_API_KEY=... npm start
// iPad camera access needs HTTPS: put this behind an HTTPS proxy, or use `npm run preview`.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiMiddleware } from './api.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 8080);
const api = apiMiddleware();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

http.createServer((req, res) => {
  api(req, res, async () => {
    let p = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, p);
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
    catch { file = join(root, 'index.html'); }
    try {
      const buf = await readFile(file);
      res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
      res.end(buf);
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
}).listen(port, () => console.log(`Dadi's Map on http://localhost:${port}`));
