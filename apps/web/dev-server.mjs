/**
 * 极简开发服务器：静态资源 + SPA 回退 + /api 反向代理
 *
 * 为什么不用 vite dev：Vite 依赖 esbuild 子进程，在受限环境下不可用。
 * 这里用纯 node:http 实现，功能足够（无 HMR，改完刷新即可）。
 */
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, 'dist');
const PORT = Number(process.env.WEB_PORT ?? 5173);
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:9520';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function serveFile(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- API 反向代理 ----
  if (url.pathname.startsWith('/api/')) {
    const target = new URL(url.pathname + url.search, API_TARGET);
    const proxy = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 5020, message: `API 不可达: ${e.message}` }));
    });
    req.pipe(proxy);
    return;
  }

  // ---- 静态资源 ----
  if (url.pathname.startsWith('/assets/')) {
    const filePath = normalize(join(DIST, url.pathname));
    if (filePath.startsWith(DIST) && existsSync(filePath) && statSync(filePath).isFile()) {
      serveFile(res, filePath);
      return;
    }
    res.writeHead(404).end('not found');
    return;
  }

  // ---- SPA 回退 ----
  const index = join(DIST, 'index.html');
  if (existsSync(index)) {
    serveFile(res, index);
  } else {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建，请先运行 npm run build -w @qgauss/web');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`QGauss AI web → http://127.0.0.1:${PORT}  (proxy /api → ${API_TARGET})`);
  console.log(`静态目录: ${DIST}`);
});
