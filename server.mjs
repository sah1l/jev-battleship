// Local preview: serves public/ and routes /api/shot to the same handler Vercel runs.
// A live TYPESAFE_API_KEY is required for Jev decisions.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(); } catch {}
const { default: shot } = await import('./api/shot.js');

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/shot') return shot(req, res);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    const data = await readFile(file);
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}  (${process.env.TYPESAFE_API_KEY ? 'live Jev' : 'API key required'})`));
