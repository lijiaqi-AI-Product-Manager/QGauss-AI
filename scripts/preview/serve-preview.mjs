#!/usr/bin/env node
/** 只监听本机的真实页面视觉夹具；构建输出放在外部参考目录，不进入生产包。 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat, copyFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import vue from 'rollup-plugin-vue';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import postcss from 'rollup-plugin-postcss';
import { richAssets } from '../web/rich-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
if (!process.env.QGAUSS_PREVIEW_DIR) throw new Error('请设置 QGAUSS_PREVIEW_DIR');
const output = resolve(process.env.QGAUSS_PREVIEW_DIR);
const port = Number(process.env.PREVIEW_PORT ?? 9433);
await mkdir(output, { recursive: true });
if (!process.argv.includes('--serve-only')) {
await copyFile(join(repo, 'apps/api/test/fixtures/qgauss-video.mp4'), join(output, 'qgauss-motion-fixture.mp4'));
await copyFile(join(repo,'apps/api/test/fixtures/qgauss-reference-video.mp4'),join(output,'qgauss-film-material.mp4'));
await copyFile(join(repo,'apps/api/test/fixtures/qgauss-reference-upscaled.mp4'),join(output,'qgauss-film-upscaled.mp4'));
await copyFile(join(repo,'apps/api/test/fixtures/qgauss-reference-lipsync.mp4'),join(output,'qgauss-film-lipsync.mp4'));
const filmWave=Buffer.alloc(44+3*32000);filmWave.write('RIFF');filmWave.writeUInt32LE(filmWave.length-8,4);filmWave.write('WAVEfmt ',8);filmWave.writeUInt32LE(16,16);filmWave.writeUInt16LE(1,20);filmWave.writeUInt16LE(1,22);filmWave.writeUInt32LE(16000,24);filmWave.writeUInt32LE(32000,28);filmWave.writeUInt16LE(2,32);filmWave.writeUInt16LE(16,34);filmWave.write('data',36);filmWave.writeUInt32LE(filmWave.length-44,40);await writeFile(join(output,'qgauss-film-voice.wav'),filmWave);

await copyFile(join(repo, 'apps/api/test/fixtures/qgauss-video-poster.png'), join(output, 'qgauss-motion-poster.png'));
await copyFile(join(here, 'video-poster.svg'), join(output, 'qgauss-motion-poster.svg'));
await copyFile(join(here, 'video-poster-lime.svg'), join(output, 'qgauss-motion-poster-lime.svg'));
await copyFile(join(here, 'midjourney-grid.svg'), join(output, 'qgauss-mj-grid.svg'));
const bundle = await rollup({
  input: join(here, 'preview-entry.mjs'),
  plugins: [
    replace({ preventAssignment: true, 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' }),
    vue({ css: false }), richAssets(), postcss({ extract: 'preview.css' }), nodeResolve({ browser: true, extensions: ['.mjs', '.js', '.vue'] }), commonjs(),
  ],
  onwarn(warning, warn) { if (!['CIRCULAR_DEPENDENCY', 'THIS_IS_UNDEFINED'].includes(warning.code)) warn(warning); },
});
await bundle.write({ dir: output, format: 'es', entryFileNames: 'preview.js', chunkFileNames: 'chunks/[name]-[hash].js' });
await bundle.close();
await writeFile(join(output, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>QGauss AI · 独立视觉观察（数据夹具）</title><link rel="stylesheet" href="/preview.css"></head><body><aside style="position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;padding:3px 12px;border-radius:0 0 9px 9px;background:#363044;color:#fff;font:9px/1.6 sans-serif;pointer-events:none">本地视觉样例 · 演示数据</aside><div id="app"></div><script type="module" src="/preview.js"></script></body></html>');
}
if (process.argv.includes('--build-only')) { console.log('QGauss readonly preview rebuilt'); process.exit(0); }
const publicRoot = join(repo, 'apps/web/public');
const types = { '.mp4': 'video/mp4', '.wav':'audio/wav', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-QGauss-Reference-Fixture', 'client-preview');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'none'");
    const requested = decodeURIComponent(url.pathname);
    const pathname = /^\/api\/(video|mj)\/media\/qg-gallery-\d+(?:\/(?:\d+|video|poster))?$/.test(requested) ? '/qgauss-motion-fixture.mp4' : requested;
    const root = /^\/(fonts|brand|agreement|art)\//.test(pathname) ? publicRoot : output;
    const target = resolve(root, `.${pathname}`), within = relative(root, target);
    if (within.startsWith('..') || /^[A-Za-z]:|^\//.test(within)) { res.statusCode = 403; return res.end(); }
    let file = target;
    try { if (!(await stat(file)).isFile()) file = join(output, 'index.html'); }
    catch { if (extname(pathname)) { res.statusCode = 404; return res.end(); } file = join(output, 'index.html'); }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 500; res.end('QGauss preview error'); }
});
server.listen(port, '127.0.0.1', () => console.log(`QGauss client preview (fixtures only) → http://127.0.0.1:${port}/chat?new=1`));
