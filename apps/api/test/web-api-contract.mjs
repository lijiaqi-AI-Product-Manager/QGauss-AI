/**
 * 前端 ↔ 后端 接口契约检查
 *
 * 目的：页面里写的每个商业化接口路径，后端必须真的存在。
 * 这类错（少写一层 /crami/stats vs /crami/stat）在浏览器里通常表现为
 * 「点了没反应」，很难在 code review 里看出来，所以用脚本卡住。
 *
 * 只检查商业化前缀（/balance /signin /crami /order /pay /sales），
 * 其它模块的接口不在本脚本职责内。
 *
 * 运行：node test/web-api-contract.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(here, '..', '..', 'web', 'src');

/** 后端实际存在的商业化路由（与 commerce.e2e.mjs 的 COMMERCE_ROUTES 保持一致） */
const ROUTES = new Set([
  'GET /balance/query',
  'GET /balance/consumeLog',
  'GET /balance/rechargeLog',
  'GET /balance/accountLog',
  'GET /balance/getVisitorCount',
  'POST /balance/inheritVisitorData',
  'POST /balance/upgradeBalance',
  'GET /signin/signinLog',
  'POST /signin/sign',
  'GET /crami/packages',
  'POST /crami/package/create',
  'GET /crami/package/list',
  'PATCH /crami/package/x',
  'DELETE /crami/package/x',
  'POST /crami/create',
  'GET /crami/list',
  'GET /crami/stats',
  'DELETE /crami/x',
  'POST /crami/exchange',
  'GET /crami/myLog',
  'POST /order/create',
  'GET /order/list',
  'GET /order/manage',
  'GET /order/detail/x',
  'POST /order/close/x',
  'POST /pay/prepare/x',
  'GET /pay/status/x',
  'POST /pay/mock/x',
  'POST /pay/notify/mock',
  'POST /sales/apply',
  'GET /sales/info',
  'GET /sales/records',
  'GET /sales/withdrawals',
  'POST /sales/withdraw',
  'GET /sales/manage',
  'PATCH /sales/manage/x',
  'GET /sales/audit',
  'POST /sales/audit/x',
]);

const PREFIXES = ['/balance', '/signin', '/crami', '/order', '/pay', '/sales'];
const METHOD = { get: 'GET', post: 'POST', patch: 'PATCH', put: 'PUT', del: 'DELETE' };

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(vue|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** 把源码里的 api.xxx('path') 抽出来并归一化 */
function extract(source) {
  const found = [];
  const re = /api\.(get|post|patch|put|del)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const method = METHOD[m[1]];
    let path = m[2];
    path = path.split('?')[0];
    path = path.replace(/\$\{[^}]*\}/g, 'x'); // 模板变量归一化
    found.push({ method, path });
  }
  return found;
}

let checked = 0;
const problems = [];
for (const file of walk(WEB_SRC)) {
  const rel = relative(join(here, '..', '..'), file).split('\\').join('/');
  for (const call of extract(readFileSync(file, 'utf8'))) {
    if (!PREFIXES.some((p) => call.path.startsWith(p))) continue;
    checked += 1;
    const key = `${call.method} ${call.path}`;
    const ok = ROUTES.has(key) || [...ROUTES].some((r) => r === key);
    if (!ok) problems.push(`${rel}: ${key}`);
  }
}

console.log(`商业化接口调用共 ${checked} 处`);
if (problems.length === 0) {
  console.log('✔ 全部命中后端路由');
  process.exit(0);
}
console.error(`✘ ${problems.length} 处没有对应的后端路由：`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
