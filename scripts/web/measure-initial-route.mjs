/** Inspect emitted ESM without executing it. JS/CSS only; images, fonts and LCP are separate. */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'apps/web/dist');
const html = await readFile(join(dist, 'index.html'), 'utf8');
const roots = [...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
if (!roots.some(file => file.endsWith('.js'))) throw new Error('Build the frontend before measuring its entry.');
const visited = new Map(), dynamic = new Set();
async function visit(file) {
  if (!file.startsWith('assets/') || file.includes('..')) throw new Error(`Unexpected asset path: ${file}`);
  if (visited.has(file)) return;
  const source = await readFile(join(dist, file));
  let transfer = source, encoding = 'identity';
  try { transfer = await readFile(join(dist, `${file}.br`)); encoding = 'br'; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  visited.set(file, { file, bytes: transfer.length, encoding, rawBytes: source.length, sha256: createHash('sha256').update(source).digest('hex') });
  if (!file.endsWith('.js')) return;
  const ast = parse(source.toString('utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const imports = [];
  const imported = node => { if (node.source?.value?.startsWith('.')) imports.push(posix.normalize(posix.join(posix.dirname(file), node.source.value))); };
  simple(ast, {
    ImportDeclaration: imported, ExportNamedDeclaration: imported, ExportAllDeclaration: imported,
    ImportExpression(node) { if (typeof node.source.value === 'string' && node.source.value.startsWith('.')) dynamic.add(posix.normalize(posix.join(posix.dirname(file), node.source.value))); },
  });
  for (const dependency of imports) await visit(dependency);
}
for (const file of roots) await visit(file);
const chatRoutes = [...dynamic].filter(file => /\/Chat-[^/]+\.js$/.test(file));
if (chatRoutes.length !== 1) throw new Error(`Expected one Chat route, found ${chatRoutes.length}.`);
await visit(chatRoutes[0]);
const eagerFiles = [...visited.values()].sort((a, b) => a.file.localeCompare(b.file));
const totalBytes = eagerFiles.reduce((total, file) => total + file.bytes, 0);
const report = {
  schemaVersion: 1, measuredAt: new Date().toISOString(),
  scope: 'Brotli (or raw when no .br exists) JS/CSS for the HTML module/preload roots plus the Chat route static closure. Excludes images/fonts and is not an LCP or whole-page transfer measurement.',
  chatRoute: chatRoutes[0], eagerFiles, totalBytes,
  releaseBudget: { scope: 'Whole first page, including images/fonts', targetBytes: 400000, wholePageMeasured: false, codeCssAloneWithinBudget: totalBytes <= 400000 },
};
const outputIndex = process.argv.indexOf('--out');
if (outputIndex >= 0) {
  if (!process.argv[outputIndex + 1]) throw new Error('Provide a JSON output path after --out.');
  const output = resolve(process.argv[outputIndex + 1]);
  await stat(dirname(output));
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${eagerFiles.length} JS/CSS files: ${totalBytes} transfer bytes; wrote ${output}`);
} else console.log(JSON.stringify(report, null, 2));
