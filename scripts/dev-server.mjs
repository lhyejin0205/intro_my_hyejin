// [개발] 로컬에서 정적 파일과 /api 함수를 함께 띄우는 작은 서버 (Vercel 없이 확인용)
// 실행: node scripts/dev-server.mjs   → http://localhost:3000
// 기본은 메모리 저장소(T08_DB=memory). 실제 Supabase로 시험하려면 T08_DB를 비우고
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수를 넣고 실행한다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.T08_DB === undefined) process.env.T08_DB = 'memory';
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const routes = {
  '/api/passkey': (await import('../api/passkey.js')).default,
  '/api/private': (await import('../api/private.js')).default,
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handler = routes[url.pathname];
  if (handler) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    req.query = Object.fromEntries(url.searchParams);
    req.body = raw && /json/.test(req.headers['content-type'] || '') ? raw : undefined;
    return handler(req, res);
  }
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([/\\])+/, '');
  if (rel.startsWith('..') || /^(api|lib|test|scripts|node_modules|supabase)[/\\]/.test(rel)) { res.statusCode = 404; return res.end('not found'); }
  try {
    const body = await readFile(join(root, rel));
    res.setHeader('Content-Type', types[extname(rel)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(port, () => console.log(`dev server http://localhost:${port} (db: ${process.env.T08_DB || 'supabase'})`));
