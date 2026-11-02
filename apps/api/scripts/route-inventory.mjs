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
import ts from 'typescript';

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
const decorators=node=>(ts.canHaveDecorators(node)?ts.getDecorators(node)||[]:[]).map(d=>d.expression).filter(ts.isCallExpression);
const named=(items,name)=>items.find(item=>ts.isIdentifier(item.expression)&&item.expression.text===name);
const literal=node=>node&&ts.isStringLiteralLike(node)?node.text:'';
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  const source=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  for(const declaration of source.statements.filter(ts.isClassDeclaration)){
    const shared=decorators(declaration),ctrl=named(shared,'Controller');if(!ctrl)continue;
    const prefix=literal(ctrl.arguments[0]),routes=[];
    for(const member of declaration.members){
      if(!ts.isMethodDeclaration(member))continue;const own=decorators(member),all=[...own,...shared];
      const route=own.find(item=>ts.isIdentifier(item.expression)&&VERB[item.expression.text]);if(!route)continue;
      routes.push({method:VERB[route.expression.text],path:literal(route.arguments[0]),isPublic:!!named(all,'Public'),optional:!!named(all,'OptionalAuth'),role:literal(named(all,'Roles')?.arguments[0])});
    }
    modules.push({file:relative(root,file).split('\\').join('/'),prefix,routes});
  }
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
    const perm = r.isPublic ? '公开' : r.role ? r.role : r.optional?'访客可读，携带凭据时校验身份':'登录';
    md += `| ${r.method} | \`${full}\` | ${perm} |\n`;
  }
  md += `\n`;
}

writeFileSync(OUT, md.trimEnd()+'\n', 'utf8');

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
