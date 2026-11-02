import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { rollup } from 'rollup';
import { richAssets } from '../../../scripts/web/rich-assets.mjs';

async function build() {
  const bundle = await rollup({
    input: 'entry',
    plugins: [
      { name: 'test-entry', resolveId(id) { if (id === 'entry' || id === 'math') return '\0' + id; }, load(id) { if (id === '\0entry') return "export const loadMath = () => import('math');"; if (id === '\0math') return "export { default } from 'qgauss:math-style';"; } },
      richAssets(),
    ],
  });
  try { return (await bundle.generate({ format: 'es', dir: 'qgauss-rich-output' })).output; }
  finally { await bundle.close(); }
}
test('KaTeX 样式中的每个字体 URL 都对应实际产物，woff 与 woff2 不互相覆盖', async () => {
  const output = await build(), files = new Set(output.map(item => item.fileName));
  const css = output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
  const urls = [...css.source.matchAll(/url\(["']?([^)"']+)["']?\)/g)].map(match => match[1]);
  assert.ok(urls.length >= 60);
  for (const url of urls) assert.ok(files.has(posix.join(posix.dirname(css.fileName), url)), url);
  assert.ok(urls.some(url => url.endsWith('.woff2')));
  assert.ok(urls.some(url => url.endsWith('.woff')));
  assert.ok(urls.some(url => url.endsWith('.ttf')));
  for (const name of ['rich/katex-license.txt', 'rich/mermaid-license.txt']) assert.match(output.find(item => item.fileName === name)?.source || '', /Copyright/i);
});
test('公式样式 URL 留在动态分块，初始入口不提前载入 CSS 或字体', async () => {
  const output = await build(), entry = output.find(item => item.type === 'chunk' && item.isEntry);
  assert.equal(entry.imports.length, 0);
  assert.equal(entry.dynamicImports.length, 1);
  assert.ok(!/katex|fonts|stylesheet/.test(entry.code));
  const deferred = output.find(item => item.type === 'chunk' && !item.isEntry);
  assert.match(deferred.code, /katex-[\da-f]+\.css/);
});
