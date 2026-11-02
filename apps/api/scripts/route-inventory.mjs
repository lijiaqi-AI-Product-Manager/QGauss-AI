#!/usr/bin/env node
/**
 * 路由清单生成器：从源码里的 @Controller / @Get|@Post|... 抽出真实 API 面。
 *
 * 为什么不用「运行时扫描 Nest 元数据」：那要先启动整个 app（连数据库），
 * 而这份清单的价值恰恰是「不依赖运行环境也能核对接口面」。静态解析足够，
 * 代价是要求控制器写法保持朴素（本项目就是朴素的）。
 *
 * 输出：docs/API-ROUTES.md（按模块分组）+ 控制台统计
 * 用法：node scripts/route-inventory.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = join(root, 'src');
const OUT = join(root, '..', '..', 'docs', 'API-ROUTES.md');

const VERB = { Get: 'GET', Post: 'POST', Patch: 'PATCH', Put: 'PUT', Delete: 'DELETE' };

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const modules = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  const ctrl = src.match(/@Controller\(\s*['"`]([^'"`]*)['"`]\s*\)/);
  if (!ctrl) continue;
  const prefix = ctrl[1];

  // 逐个方法抓：装饰器行 + 紧跟的方法名
  const routes = [];
  const re = /@(Get|Post|Patch|Put|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = VERB[m[1]];
    const path = m[2] ?? '';
    // 取装饰器前后 200 字符判断守卫
    const before = src.slice(Math.max(0, m.index - 200), m.index);
    const isPublic = /@Public\(\)/.test(before);
    const roleMatch = before.match(/@Roles\(\s*'([^']+)'\s*\)\s*$/);
    routes.push({ method, path, isPublic, role: roleMatch?.[1] ?? '' });
  }

  modules.push({
    file: relative(root, file).split('\\').join('/'),
    prefix,
    routes,
  });
}

modules.sort((a, b) => a.prefix.localeCompare(b.prefix));

const total = modules.reduce((n, m) => n + m.routes.length, 0);

let md = `# API 路由清单\n\n`;
md += `> 由 \`apps/api/scripts/route-inventory.mjs\` 静态生成，不要手改。\n`;
md += `> 共 **${total}** 条路由，分布在 **${modules.length}** 个控制器。\n\n`;
md += `| 模块 | 路由数 | 控制器 |\n|---|---|---|\n`;
for (const m of modules) {
  md += `| \`/${m.prefix}\` | ${m.routes.length} | \`${m.file}\` |\n`;
}
md += `\n`;
for (const m of modules) {
  md += `## /${m.prefix}\n\n`;
  md += `| 方法 | 路径 | 权限 |\n|---|---|---|\n`;
  for (const r of m.routes) {
    const full = `/${m.prefix}${r.path ? `/${r.path}` : ''}`.replace(/\/$/, '');
    const perm = r.isPublic ? '公开' : r.role ? r.role : '登录';
    md += `| ${r.method} | \`${full}\` | ${perm} |\n`;
  }
  md += `\n`;
}

writeFileSync(OUT, md, 'utf8');

console.log(`路由总数 ${total}，控制器 ${modules.length} 个`);
for (const m of modules) console.log(`  /${m.prefix}`.padEnd(28) + `${m.routes.length}`);
console.log(`已写入 ${relative(process.cwd(), OUT)}`);

// 商业化面必须和 e2e 契约一致：这里是独立数法，两边对不上就说明有一边漏了
const commerce = modules.find((m) => m.prefix === 'pay')
  ? ['balance', 'signin', 'crami', 'order', 'pay', 'sales'].reduce(
      (n, p) => n + (modules.find((m) => m.prefix === p)?.routes.length ?? 0),
      0,
    )
  : 0;
console.log(`商业化路由 ${commerce} 条（契约清单里是 38 条）`);
if (commerce !== 38) {
  console.error('✘ 商业化路由数与契约清单不一致，检查新增/删除的路由');
  process.exit(1);
}
