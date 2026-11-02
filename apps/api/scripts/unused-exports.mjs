#!/usr/bin/env node
/**
 * 未引用导出扫描：防止「写了一个工具函数，只在当时那个分支用过」这类腐烂。
 *
 * 判据：符号在定义文件之外出现 0 次 → 候选死代码。
 * 误报来源（所以只报告、不自动删）：
 *   - Nest 的模块装饰器、Vue 的自动注册（本项目的组件都是显式 import，风险低）
 *   - 字符串动态引用
 * 用法：node scripts/unused-exports.mjs [--web]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');
const roots = [join(apiRoot, 'src'), join(apiRoot, 'test')];
if (process.argv.includes('--web') || true) roots.push(join(apiRoot, '..', 'web', 'src'));

const EXTS = ['.ts', '.js', '.mjs', '.vue'];
const SKIP = ['node_modules', 'dist', '.git'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const files = roots.flatMap((r) => (statSync(r).isDirectory() ? walk(r) : []));
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

// 收集导出符号
const EXPORT_RE =
  /^export\s+(?:async\s+)?(function|const|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const decls = [];
for (const [file, src] of sources) {
  let m;
  while ((m = EXPORT_RE.exec(src)) !== null) {
    decls.push({ file, name: m[2], kind: m[1] });
  }
}

// 统计跨文件引用
const rows = [];
for (const { file, name, kind } of decls) {
  const re = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`, 'g');
  let refs = 0;
  for (const [other, src] of sources) {
    if (other === file) continue;
    refs += (src.match(re) ?? []).length;
  }
  // 同文件内再用一次也不算死代码（导出只是顺带）
  const selfRefs = ((sources.get(file).match(re) ?? []).length ?? 0) - 1;
  if (refs === 0) rows.push({ file: relative(apiRoot, file), name, selfRefs, kind });
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

if (rows.length === 0) {
  console.log(`\u2714 没有未引用导出（扫描 ${decls.length} 个导出 / ${files.length} 个文件）`);
  process.exit(0);
}

const TYPE_KINDS = ['interface', 'type'];
const dead = rows.filter((r) => !TYPE_KINDS.includes(r.kind) && r.selfRefs <= 0);
const internal = rows.filter((r) => !TYPE_KINDS.includes(r.kind) && r.selfRefs > 0);
const types = rows.filter((r) => TYPE_KINDS.includes(r.kind));

console.log(`扫描 ${decls.length} 个导出 / ${files.length} 个文件`);
console.log(`  真正死代码 ${dead.length} 个（跨文件 0 次、文件内也未用）`);
console.log(`  仅文件内自用 ${internal.length} 个（导出多余，但无害）`);
console.log(`  纯类型 ${types.length} 个（可忽略）\n`);

for (const r of dead) console.log(`  ✘ ${r.file} → ${r.name}`);
if (dead.length > 0) {
  console.log('\n请删除上面这些导出（或确认它们是被字符串/装饰器动态引用的）。');
  process.exit(1);
}
console.log('✔ 没有真正的死代码');
