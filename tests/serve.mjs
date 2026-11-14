// Tiny static server for tests: serves the repo at /logic-lane/, like GitHub Pages. No dependencies.
// Usage: node tests/serve.mjs [port]   (default 4173, localhost only)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = '/logic-lane/';
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname === '/logic-lane') {
    res.writeHead(301, { Location: BASE });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname.slice(BASE.length));
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, rel);
  const insideRepo = file.startsWith(ROOT) && !rel.split('/').some((p) => p.startsWith('.') || p === 'node_modules');
  if (!insideRepo || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const headers = {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  };

  // Test hook: a browser with the cookie "test-sw-version=<v>" gets sw.js with VERSION = '<v>', as if a new
  // version had been deployed. Cookies are per browser context, so other tests aren't affected.
  const override = /(?:^|;\s*)test-sw-version=([a-z0-9-]{1,40})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
  if (rel === 'sw.js' && override) {
    const body = fs.readFileSync(file, 'utf8').replace("const VERSION = 'dev';", `const VERSION = '${override}';`);
    res.writeHead(200, headers);
    res.end(body);
    return;
  }

  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, 'localhost', () => {
  console.log(`Logic Lane test server: http://localhost:${PORT}${BASE}`);
});
