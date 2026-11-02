#!/usr/bin/env node
/**
 * 把「导出但只在文件内使用」的符号收回模块私有。
 *
 * 为什么要做：多余导出会扩大模块的对外承诺面。别人看到 export 会以为它是
 * 稳定接口，于是依赖它；改的时候才发现其实谁都没在用，但已经不敢删了。
 *
 * 只处理 function / const / class；类型导出不动（跨文件 0 引用对 interface 很常见）。
 * 用法：node scripts/trim-internal-exports.mjs [--apply]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');
const roots = [join(apiRoot, 'src'), join(apiRoot, 'test')];
const EXTS = ['.ts', '.js', '.mjs', '.vue'];
const SKIP = ['node_modules', 'dist', '.git'];
const apply = process.argv.includes('--apply');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const files = roots.flatMap((r) => walk(r));
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const EXPORT_RE = /^export\s+(?:async\s+)?(function|const|class)\s+([A-Za-z_$][\w$]*)/gm;
const decls = [];
for (const [file, src] of sources) {
  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(src)) !== null) decls.push({ file, kind: m[1], name: m[2] });
}

const candidates = [];
for (const { file, kind, name } of decls) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let refs = 0;
  for (const [other, src] of sources) {
    if (other === file) continue;
    refs += (src.match(re) ?? []).length;
  }
  if (refs > 0) continue;
  const selfUses = (sources.get(file).match(re) ?? []).length;
  // 只用了一次 = 只有声明本身，说明连文件内都没调用，交给 deadcode 处理
  if (selfUses <= 1) continue;
  candidates.push({ file, kind, name });
}

console.log(`仅文件内自用（可收回私有）：${candidates.length} 个`);
for (const c of candidates) console.log(`  ${relative(apiRoot, c.file).padEnd(58)} ${c.name}`);

if (!apply) {
  console.log('\n（未改动；加 --apply 执行）');
  process.exit(0);
}

let changed = 0;
const perFile = new Map();
for (const c of candidates) perFile.set(c.file, [...(perFile.get(c.file) ?? []), c.name]);

for (const [file, names] of perFile) {
  let src = sources.get(file);
  for (const name of names) {
    const re = new RegExp(`^export\\s+((?:async\\s+)?(?:function|const|class)\\s+${name}\\b)`, 'm');
    if (!re.test(src)) {
      console.error(`  ! 跳过 ${relative(apiRoot, file)} → ${name}（找不到声明行）`);
      continue;
    }
    src = src.replace(re, '$1');
    changed += 1;
  }
  writeFileSync(file, src, 'utf8');
}
console.log(`\u2714 已收回 ${changed} 个导出`);
