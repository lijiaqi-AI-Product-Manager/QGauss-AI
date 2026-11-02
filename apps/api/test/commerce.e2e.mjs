/**
 * 商业化域 e2e（HTTP 层）
 *
 * 前置：
 *   1. npm run build && node dist/main.js（API 默认 9520）
 *   2. .env 里 DATABASE_URL 指向一个可写的库
 * 运行：node test/commerce.e2e.mjs
 *      或 E2E_API=http://127.0.0.1:9521/api node test/commerce.e2e.mjs
 *
 * 这个脚本会自己创建用户/套餐/卡密，也会临时改配置；
 * 结束时把 commerce.enabled 复原为 false（try/finally 保证异常也复原）。
 */
import { randomUUID } from 'node:crypto';
const API = process.env.E2E_API ?? 'http://127.0.0.1:9520/api';
// 夹具命名工具：必须真唯一。
// 早先若干处写成 `Date.now() % 1000`，只有 1000 种取值，
// 开发库长期复用后生日悖论必然生效——重名会把一条本该绿的用例拖红（真实发生过）。
const uniqName = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
/** 用户名有 3-20 位且只允许字母数字下划线短横线的限制，用短版 */
const uniqUser = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

const ADMIN = {
  account: process.env.E2E_ADMIN ?? 'admin',
  password: process.env.E2E_PASSWORD ?? 'admin123456',
};

let token = '';
let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  \u2714 ${name}`);
  } else {
    failed += 1;
    console.log(`  \u2718 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}

const isOk = (status) => status === 200 || status === 201;

/**
 * 商业化路由清单。
 * 这张表就是「契约」：改路由名/删路由/漏挂 CommerceGuard 都会在这里红。
 */
const COMMERCE_ROUTES = [
  // 账户与余额
  ['GET', '/balance/query'],
  ['GET', '/balance/consumeLog'],
  ['GET', '/balance/rechargeLog'],
  ['GET', '/balance/accountLog'],
  ['GET', '/balance/getVisitorCount'],
  ['POST', '/balance/inheritVisitorData'],
  ['POST', '/balance/upgradeBalance'],
  // 签到
  ['GET', '/signin/signinLog'],
  ['POST', '/signin/sign'],
  // 卡密与套餐
  ['GET', '/crami/packages'],
  ['POST', '/crami/package/create'],
  ['GET', '/crami/package/list'],
  ['PATCH', '/crami/package/x'],
  ['DELETE', '/crami/package/x'],
  ['POST', '/crami/create'],
  ['GET', '/crami/list'],
  ['GET', '/crami/stats'],
  ['DELETE', '/crami/x'],
  ['POST', '/crami/exchange'],
  ['GET', '/crami/myLog'],
  // 订单
  ['POST', '/order/create'],
  ['GET', '/order/list'],
  ['GET', '/order/manage'],
  ['GET', '/order/detail/x'],
  ['POST', '/order/close/x'],
  // 支付
  ['POST', '/pay/prepare/x'],
  ['GET', '/pay/status/x'],
  ['POST', '/pay/mock/x'],
  ['POST', '/pay/notify/mock'],
  // 分销
  ['POST', '/sales/apply'],
  ['GET', '/sales/info'],
  ['GET', '/sales/records'],
  ['GET', '/sales/withdrawals'],
  ['POST', '/sales/withdraw'],
  ['GET', '/sales/manage'],
  ['PATCH', '/sales/manage/x'],
  ['GET', '/sales/audit'],
  ['POST', '/sales/audit/x'],
].map(([method, path]) => ({ method, path }));

/**
 * 区分「路由不存在」（框架级 404，没有业务 code）与「业务 404」。
 * 商业化里的 404 常常是业务语义（订单不存在/卡密不存在），不能算路由缺失。
 */
function isRouteMissing(raw, status) {
  if (status !== 404) return false;
  if (!raw || raw.code === undefined) return true;
  return false;
}

async function probe(route) {
  return api(route.path, {
    method: route.method,
    ...(route.method === 'GET' ? {} : { body: {} }),
  });
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json?.data ?? json, raw: json, text };
}

async function login(account, password) {
  // 上一次运行可能刚把登录桶打空（默认每 IP 每分钟 10 次），这里退避等一下
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const r = await api('/auth/login', { method: 'POST', body: { account, password } });
    if (isOk(r.status)) return r.body.accessToken ?? r.body.token;
    if (r.status !== 429) throw new Error(`登录失败: ${r.status} ${r.text.slice(0, 200)}`);
    if (attempt === 25) throw new Error('登录持续被限流，请等一分钟再跑');
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('登录失败');
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function registerUser(tag, inviteCode) {
  const email = `c-${tag}-${suffix}@example.com`;
  const username = `c${tag}${suffix}`.slice(0, 20);
  const r = await api('/auth/register', {
    method: 'POST',
    body: { email, username, password: 'commercetest123', ...(inviteCode ? { inviteCode } : {}) },
  });
  if (!isOk(r.status)) throw new Error(`注册 ${tag} 失败: ${r.status} ${r.text.slice(0, 200)}`);
  const next = await login(email, 'commercetest123');
  return { email, username, token: next };
}

async function setSettings(list) {
  const r = await api('/settings', { method: 'PUT', body: { settings: list } });
  if (!isOk(r.status)) throw new Error(`改配置失败: ${r.status} ${r.text.slice(0, 200)}`);
  return r;
}

async function main() {
  console.log(`\n=== 商业化 e2e (${API}) ===\n`);

  // -------------------------------------------------------------------------
  console.log('[1] 开关与登录');
  token = await login(ADMIN.account, ADMIN.password);
  ok('管理员登录', !!token);

  await setSettings([
    { key: 'commerce.enabled', value: true },
    { key: 'commerce.payProviders', value: 'mock' },
    { key: 'commerce.imageCost', value: 1 },
    { key: 'commerce.minWithdrawalCents', value: 100 },
    { key: 'commerce.defaultCommissionBps', value: 0 },
    { key: 'security.registerEnabled', value: true },
    { key: 'security.registerRateLimit', value: 0 },
    // 限流阈值设成 999：桶的上限一变就会重建，等于给本次运行发一套新令牌，
    // 上一次异常中止留下的计数不会污染这一次。
    { key: 'commerce.exchangeRateLimit', value: 999 },
    { key: 'commerce.orderRateLimit', value: 999 },
    { key: 'commerce.withdrawRateLimit', value: 999 },
    { key: 'commerce.mockPayRateLimit', value: 999 },
    // 运行期关掉登录限流：本脚本要登录 6+ 次，正常阈值会自己把自己挡在门外
    { key: 'security.loginRateLimit', value: 0 },
  ]);

  const me = await api('/balance/query');
  ok('开启后 /balance/query 可用', isOk(me.status) && me.body?.counts);
  ok(
    '余额视图含四个次数池',
    me.body?.counts?.model3 !== undefined && me.body?.counts?.drawMj !== undefined && me.body?.balanceCents !== undefined,
  );

  // -------------------------------------------------------------------------
  console.log('[1.5] 签到');
  const filteredWallet = await api('/balance/consumeLog?page=1&pageSize=1&deductionType=drawMj&direction=4');
  ok('钱包 HTTP 接受组合筛选并返回服务端总数', isOk(filteredWallet.status) && Number.isInteger(filteredWallet.body?.total));
  ok('钱包筛选返回条目符合类型与动作', Array.isArray(filteredWallet.body?.items) && filteredWallet.body.items.every(row => row.deductionType === 'drawMj' && row.direction === 4));
  const noMatchWallet = await api('/balance/consumeLog?keyword=' + encodeURIComponent('qgauss-no-such-receipt-' + Date.now()) + '&pageSize=1');
  ok('钱包无匹配搜索保持分页契约', isOk(noMatchWallet.status) && noMatchWallet.body?.total === 0 && noMatchWallet.body?.pageSize === 1 && noMatchWallet.body?.items.length === 0);
  for (const query of ['deductionType=invalid', 'direction=7', 'direction=1&direction=4', 'keyword=' + 'x'.repeat(101), 'deductionType=model3&deductionType=model4']) {
    const invalidFilter = await api('/balance/consumeLog?' + query);
    ok('钱包 HTTP 拒绝无效筛选 ' + query.slice(0, 55), invalidFilter.status === 400);
  }
  await setSettings([{ key: 'commerce.signinEnabled', value: true }]);

  const beforeSign = await api('/balance/query');
  const log0 = await api('/signin/signinLog');
  ok('签到日志可读', isOk(log0.status), log0.text.slice(0, 120));
  ok(
    'signinLog.reward 是数字（前端会直接插值）',
    typeof log0.body?.reward === 'number',
    `reward=${JSON.stringify(log0.body?.reward)}`,
  );

  const sign1 = await api('/signin/sign', { method: 'POST', body: {} });
  const signedOk = isOk(sign1.status);
  const alreadySigned = !signedOk && (sign1.status === 409 || sign1.status === 400);
  ok('签到成功或今日已签（可重复跑）', signedOk || alreadySigned, `status=${sign1.status}`);

  const afterSign = await api('/balance/query');
  const gained = (afterSign.body?.counts?.model3 ?? 0) - (beforeSign.body?.counts?.model3 ?? 0);
  ok('签到不会让次数变少', gained >= 0, `delta=${gained}`);

  const log1 = await api('/signin/signinLog');
  ok('日志标记今天已签', log1.body?.signedToday === true, `signedToday=${log1.body?.signedToday}`);
  ok('连续天数至少为 1', (log1.body?.streak ?? 0) >= 1, `streak=${log1.body?.streak}`);

  if (signedOk) {
    const dup = await api('/signin/sign', { method: 'POST', body: {} });
    ok('重复签到被拒（409）', dup.status === 409, `status=${dup.status}`);
    ok('重复签到业务码 8008', dup.raw?.code === 8008, `code=${dup.raw?.code}`);
  }

  // -------------------------------------------------------------------------
  console.log('[2] 套餐');
  const pkgName = `E2E 套餐 ${suffix}`;
  const createPkg = await api('/crami/package/create', {
    method: 'POST',
    body: { name: pkgName, priceYuan: '9.90', days: 30, model3Count: 10, model4Count: 2 },
  });
  ok('创建套餐', isOk(createPkg.status), createPkg.text.slice(0, 160));
  const pkg = createPkg.body ?? {};
  ok('价格按分存储', pkg.priceCents === 990, `priceCents=${pkg.priceCents}`);
  ok('价格同时给出元字符串', pkg.priceYuan === '9.90', `priceYuan=${pkg.priceYuan}`);

  const badPrice = await api('/crami/package/create', {
    method: 'POST',
    body: { name: 'bad', priceYuan: '1.234' },
  });
  ok('三位小数被拒绝', badPrice.status === 400, `status=${badPrice.status}`);

  const patch = await api(`/crami/package/${pkg.id}`, { method: 'PATCH', body: { priceYuan: '19.90' } });
  ok('改价生效', isOk(patch.status) && patch.body?.priceCents === 1990, `priceCents=${patch.body?.priceCents}`);

  const pub = await api('/crami/packages');
  const publicItem = (pub.body?.items ?? []).find((p) => p.id === pkg.id);
  ok('前台套餐列表可见新套餐', !!publicItem);
  ok('前台只下发上架套餐', publicItem?.status === 1, `status=${publicItem?.status}`);

  // -------------------------------------------------------------------------
  console.log('[3] 卡密');
  const gen = await api('/crami/create', { method: 'POST', body: { packageId: pkg.id, count: 2, cramiType: 1 } });
  ok('批量生成卡密', isOk(gen.status) && gen.body?.created === 2, `created=${gen.body?.created}`);

  const list = await api('/crami/list?packageId=' + encodeURIComponent(pkg.id));
  const cards = list.body?.items ?? [];
  ok('卡密列表返回 2 张', cards.length === 2, `len=${cards.length}`);
  ok('展示用码带分组横线', typeof cards[0]?.codeDisplay === 'string' && cards[0].codeDisplay.includes('-'));
  const card = cards[0];

  const userA = await registerUser('a');
  const savedToken = token;
  token = userA.token;
  const exchange = await api('/crami/exchange', { method: 'POST', body: { code: card.codeDisplay } });
  ok('核销卡密（带横线输入）', isOk(exchange.status), exchange.text.slice(0, 160));
  ok('核销后发放次数', exchange.body?.granted?.model3Count === 10, `granted=${JSON.stringify(exchange.body?.granted)}`);
  ok('核销返回最新余额', exchange.body?.balance?.counts?.model3 >= 10);

  const again = await api('/crami/exchange', { method: 'POST', body: { code: card.code } });
  ok('同码二次核销被拒（409）', again.status === 409, `status=${again.status}`);
  ok('拒绝时带业务码 8007', again.raw?.code === 8007, `code=${again.raw?.code}`);

  const badCode = await api('/crami/exchange', { method: 'POST', body: { code: 'ZZZZZZZZZZZZ' } });
  ok('不存在的卡密返回 404', badCode.status === 404, `status=${badCode.status}`);

  const myLog = await api('/crami/myLog');
  ok('我的核销记录有 1 条', myLog.body?.total === 1, `total=${myLog.body?.total}`);

  // 一人一次型卡密：同一用户只能核一次，别的用户可以
  token = savedToken;
  const gen2 = await api('/crami/create', { method: 'POST', body: { packageId: pkg.id, count: 1, cramiType: 2 } });
  ok('生成一人一次型卡密', isOk(gen2.status) && gen2.body?.created === 1);
  const list2 = await api('/crami/list?packageId=' + encodeURIComponent(pkg.id) + '&status=0');
  const shared = (list2.body?.items ?? []).find((c) => c.cramiType === 2);
  if (!shared) throw new Error('未找到一人一次型卡密: ' + list2.text.slice(0, 200));
  const sharedFirst = await api('/crami/exchange', { method: 'POST', body: { code: shared.code } });
  ok('一人一次：用户 A 首次核销成功', isOk(sharedFirst.status), sharedFirst.text.slice(0, 160));
  const sharedAgain = await api('/crami/exchange', { method: 'POST', body: { code: shared.code } });
  ok('一人一次：同一用户第二次被拒（409）', sharedAgain.status === 409, `status=${sharedAgain.status}`);

  const userB = await registerUser('b');
  token = userB.token;
  const sharedOther = await api('/crami/exchange', { method: 'POST', body: { code: shared.code } });
  ok('一人一次：另一个用户可以核销', isOk(sharedOther.status), sharedOther.text.slice(0, 160));
  token = savedToken;

  // -------------------------------------------------------------------------
  console.log('[4] 订单与支付');
  token = userA.token;
  const checkoutOffer = (await api('/crami/packages')).body?.items.find(item => item.id === pkg.id);
  ok('公开套餐包含确认版本', /^[a-f0-9]{64}$/.test(checkoutOffer?.offerRevision || ''));
  const checkoutRequest = { goodsType: 'package', goodsId: pkg.id, requestKey: uniqName('checkout'), expectedOfferRevision: checkoutOffer.offerRevision, goodsSnapshot: '{"model3Count":999999}' };
  const order = await api('/order/create', { method: 'POST', body: checkoutRequest });
  ok('下单成功', isOk(order.status), order.text.slice(0, 160));
  const orderId = order.body?.orderId;
  ok('订单金额 = 套餐价', order.body?.totalCents === 1990, `total=${order.body?.totalCents}`);
  ok('订单号是 32 位十六进制', typeof orderId === 'string' && /^[0-9a-f]{32}$/.test(orderId), orderId);

  ok('订单权益由服务器冻结，不采信客户端快照', order.body?.entitlements?.model3Count === 10 && order.body?.legacyEntitlements === false);
  ok('新订单返回固定有效期', new Date(order.body?.expiresAt).getTime() > new Date(order.body?.createdAt).getTime());
  const retries = await Promise.all([api('/order/create', { method: 'POST', body: checkoutRequest }), api('/order/create', { method: 'POST', body: checkoutRequest })]);
  ok('HTTP 并发重试返回同一订单', retries.every(result => isOk(result.status) && result.body?.orderId === orderId && result.body?.reused === true));
  const wrongReuse = await api('/order/create', { method: 'POST', body: { ...checkoutRequest, count: 2 } });
  ok('同一下单标识不接受不同选择', wrongReuse.status === 409);
  for (const body of [{ goodsType: 'money', amountYuan: '1', requestKey: null }, { goodsType: 'money', amountYuan: '1', requestKey: ['invalid'] }, { goodsType: 'package', goodsId: pkg.id, expectedOfferRevision: false }, { goodsType: 'money', amountYuan: '21474836.48' }]) {
    const invalidCheckout = await api('/order/create', { method: 'POST', body });
    ok('下单边界拒绝错误请求标识、确认版本或溢出金额', invalidCheckout.status === 400);
  }
  const checkoutBuyerToken = token;
  token = savedToken;
  await api('/crami/package/' + pkg.id, { method: 'PATCH', body: { priceYuan: '29.90', model3Count: 77 } });
  token = checkoutBuyerToken;
  const staleCheckout = await api('/order/create', { method: 'POST', body: { ...checkoutRequest, requestKey: uniqName('checkout-stale') } });
  ok('已查看套餐改价或改权益后需重新确认', staleCheckout.status === 409);
  const frozenReplay = await api('/order/create', { method: 'POST', body: checkoutRequest });
  ok('改套餐后仍可取回原订单与原价', frozenReplay.body?.orderId === orderId && frozenReplay.body?.totalCents === 1990);
  const frozenDetail = await api('/order/detail/' + orderId);
  ok('订单详情保留下单时权益与金额', frozenDetail.body?.entitlements?.model3Count === 10 && frozenDetail.body?.totalCents === 1990);
  const before = (await api('/balance/query')).body?.counts?.model3 ?? 0;
  const prepare = await api(`/pay/prepare/${orderId}`, { method: 'POST' });
  ok('mock 通道返回模拟支付提示', isOk(prepare.status) && prepare.body?.mock === true);

  const mock = await api(`/pay/mock/${orderId}`, { method: 'POST' });
  ok('模拟支付成功', isOk(mock.status) && mock.body?.paid === true, mock.text.slice(0, 160));

  const status = await api(`/pay/status/${orderId}`);
  ok('支付状态变已支付', status.body?.status === 1, `status=${status.body?.status}`);

  const after = (await api('/balance/query')).body?.counts?.model3 ?? 0;
  ok('支付后次数到账 10 次', after - before === 10, `before=${before} after=${after}`);

  const payTwice = await api(`/pay/mock/${orderId}`, { method: 'POST' });
  ok('重复支付被拒（409）', payTwice.status === 409, `status=${payTwice.status}`);

  token = savedToken;
  await api('/crami/package/' + pkg.id, { method: 'PATCH', body: { priceYuan: '19.90', model3Count: 10 } });
  token = checkoutBuyerToken;

  const moneyOrder = await api('/order/create', { method: 'POST', body: { goodsType: 'money', amountYuan: '5.00' } });
  ok('余额充值下单', isOk(moneyOrder.status) && moneyOrder.body?.totalCents === 500);
  await api(`/pay/mock/${moneyOrder.body.orderId}`, { method: 'POST' });
  const wallet = (await api('/balance/query')).body;
  ok('充值后钱包余额 5.00 元', wallet?.balanceYuan === '5.00', `balanceYuan=${wallet?.balanceYuan}`);

  const otherUserOrder = await api(`/pay/status/${moneyOrder.body.orderId}`);
  token = userB.token;
  const peek = await api(`/pay/status/${moneyOrder.body.orderId}`);
  ok('别人的订单查不到（404 不泄露存在性）', peek.status === 404, `status=${peek.status}`);
  ok('本人查自己的订单可以', isOk(otherUserOrder.status));
  token = savedToken;

  // -------------------------------------------------------------------------
  console.log('[5] 分销');
  token = userA.token;
  const apply = await api('/sales/apply', { method: 'POST', body: {} });
  ok('申请成为分销员', isOk(apply.status), apply.text.slice(0, 160));
  const inviteCode = apply.body?.inviteCode;
  ok('返回 8 位邀请码', typeof inviteCode === 'string' && inviteCode.length === 8, inviteCode);

  const applyAgain = await api('/sales/apply', { method: 'POST', body: {} });
  ok('重复申请是幂等的', isOk(applyAgain.status) && applyAgain.body?.inviteCode === inviteCode);
  token = savedToken;

  // 给 A 配 10% 佣金，再用邀请码注册 C，让 C 买单
  const meInfo = await api('/sales/manage?keyword=' + encodeURIComponent(userA.username));
  const row = (meInfo.body?.items ?? []).find((r) => r.userId);
  ok('后台能看到分销员', !!row, `items=${(meInfo.body?.items ?? []).length}`);
  const userIdA = row?.userId;
  const setBps = await api(`/sales/manage/${userIdA}`, { method: 'PATCH', body: { performanceBps: 1000 } });
  ok('设置佣金比例为 10%', isOk(setBps.status) && setBps.body?.performanceBps === 1000);

  const userC = await registerUser('c', inviteCode);
  token = userC.token;
  const cOrder = await api('/order/create', { method: 'POST', body: { goodsType: 'package', goodsId: pkg.id } });
  await api(`/pay/mock/${cOrder.body.orderId}`, { method: 'POST' });

  token = userA.token;
  const info = await api('/sales/info');
  ok('佣金到账 199 分（1990 × 10%，向下取整）', info.body?.distributionCents === 199, `distribution=${info.body?.distributionCents}`);
  ok('邀请人数为 1', info.body?.inviteeCount === 1, `invitee=${info.body?.inviteeCount}`);

  const records = await api('/sales/records');
  ok('佣金明细有 1 条', records.body?.total === 1, `total=${records.body?.total}`);
  ok('佣金明细金额正确', records.body?.items?.[0]?.commissionCents === 199);

  const tooMuch = await api('/sales/withdraw', { method: 'POST', body: { amountYuan: '9.99', contact: 'alipay:test' } });
  ok('提现超过可提现余额被拒', tooMuch.status === 400, `status=${tooMuch.status}`);

  const belowMin = await api('/sales/withdraw', { method: 'POST', body: { amountYuan: '0.50', contact: 'alipay:test' } });
  ok('低于最低提现额被拒', belowMin.status === 400, `status=${belowMin.status}`);

  const withdrawalIntent = { amountYuan: '1.99', contact: 'alipay:test', requestKey: randomUUID() };
  const withdraw = await api('/sales/withdraw', { method: 'POST', body: withdrawalIntent });
  ok('提现申请成功并冻结金额', isOk(withdraw.status), withdraw.text.slice(0, 160));
  const afterWithdraw = await api('/sales/info');
  ok('提现后可提现余额归零', afterWithdraw.body?.distributionCents === 0, `distribution=${afterWithdraw.body?.distributionCents}`);
  ok('冻结金额计入累计提现', afterWithdraw.body?.withdrawalCents === 199, `withdrawal=${afterWithdraw.body?.withdrawalCents}`);

  const dupWithdraw = await api('/sales/withdraw', { method: 'POST', body: { amountYuan: '1.00', contact: 'alipay:test' } });
  ok('余额不足时不能再提', dupWithdraw.status === 400, `status=${dupWithdraw.status}`);

  const duplicateIntents = await Promise.all(Array.from({length:3}, () => api('/sales/withdraw', {method:'POST',body:withdrawalIntent})));
  ok('同一提现请求并发重试返回原申请且不再冻结',duplicateIntents.every(r=>isOk(r.status)&&r.body?.id===withdraw.body?.id));
  const mismatchedIntent=await api('/sales/withdraw',{method:'POST',body:{...withdrawalIntent,amountYuan:'1.98'}});
  ok('相同提现标识不能更换金额',mismatchedIntent.status===409);
  const ownWithdrawal=await api('/sales/withdrawals?requestKey='+withdrawalIntent.requestKey);
  ok('可按本人请求标识读取原提现且不暴露指纹',ownWithdrawal.body?.total===1&&ownWithdrawal.body.items[0].id===withdraw.body.id&&!('requestHash' in ownWithdrawal.body.items[0])&&!('requestKey' in ownWithdrawal.body.items[0]));
  token=userB.token;
  const foreignWithdrawal=await api('/sales/withdrawals?id='+withdraw.body.id);
  ok('其他用户按申请编号不能读取收款信息',foreignWithdrawal.body?.total===0);
  token=userA.token;
  const pendingSummary=await api('/sales/info');
  ok('提现规则和待审核金额来自实际服务端',pendingSummary.body?.withdrawalPolicy?.minCents===100&&pendingSummary.body?.withdrawalSummary?.pendingCents===199&&pendingSummary.body?.withdrawalSummary?.paidCents===0);
  token = savedToken;
  const invalidAudit=await api('/sales/audit/'+withdraw.body.id,{method:'POST',body:{pass:'false'}});
  ok('字符串审核结果不被隐式当作驳回',invalidAudit.status===400);
  const auditList = await api('/sales/audit');
  ok('后台能看到提现申请', (auditList.body?.total ?? 0) >= 1, `total=${auditList.body?.total}`);
  const target = (auditList.body?.items ?? []).find((o) => o.orderStatus === 0);
  const reject = await api(`/sales/audit/${target.id}`, { method: 'POST', body: { pass: false, remark: 'e2e 驳回' } });
  ok('驳回提现申请', isOk(reject.status) && reject.body?.orderStatus === 2, reject.text.slice(0, 160));

  token = userA.token;
  const afterReject = await api('/sales/info');
  ok('驳回后金额退回可提现', afterReject.body?.distributionCents === 199, `distribution=${afterReject.body?.distributionCents}`);
  ok('驳回后不再计入冻结', afterReject.body?.withdrawalCents === 0, `withdrawal=${afterReject.body?.withdrawalCents}`);
  const rejectedReplay=await api('/sales/withdraw',{method:'POST',body:withdrawalIntent});
  ok('驳回后的原请求返回原状态且不重新冻结',rejectedReplay.body?.id===withdraw.body.id&&rejectedReplay.body?.orderStatus===2);
  token = savedToken;

  // -------------------------------------------------------------------------
  console.log('[5b] 并发支付下的分佣结算');
  token = userC.token;
  const raceOrders = [];
  for (let i = 0; i < 3; i += 1) {
    const o = await api('/order/create', { method: 'POST', body: { goodsType: 'package', goodsId: pkg.id } });
    raceOrders.push(o.body?.orderId);
  }
  ok('并发场景下单成功', raceOrders.every(Boolean), JSON.stringify(raceOrders));

  // 每单同时打两次支付：3 单 × 2 = 6 个并发请求，模拟回调重放与用户连点
  const racePays = await Promise.all(
    raceOrders.flatMap((id) => [api(`/pay/mock/${id}`, { method: 'POST' }), api(`/pay/mock/${id}`, { method: 'POST' })]),
  );
  // 并发的输家可能在状态检查前进门（拿到 201 + paid:false），也可能被挡在门外（409）；
  // 真正的闸门是 fulfill 里的 updateMany 认领，所以只数 paid === true
  const paidOk = racePays.filter((r) => isOk(r.status) && r.body?.paid === true).length;
  ok(
    '每单只履约一次',
    paidOk === 3,
    `paid=${paidOk} ${racePays.map((r) => `${r.status}:${r.body?.paid}`).join(',')}`,
  );

  token = userA.token;
  const raceInfo = await api('/sales/info');
  ok(
    '并发结算佣金不重不漏（199 + 3 × 199）',
    raceInfo.body?.distributionCents === 199 * 4,
    `distribution=${raceInfo.body?.distributionCents}`,
  );
  const raceRecords = await api('/sales/records');
  ok('佣金明细共 4 条', raceRecords.body?.total === 4, `total=${raceRecords.body?.total}`);

  console.log('[5c] 推广记录与打款登记');
  const matchedRecord=await api('/sales/records?keyword='+encodeURIComponent(cOrder.body.orderId)+'&pageSize=1');
  ok('佣金订单搜索在服务端完成且总数准确',matchedRecord.body?.total===1&&matchedRecord.body?.items?.[0]?.orderId===cOrder.body.orderId);
  for(const [label,path] of [['非法申请状态','/sales/withdrawals?stage=unknown'],['重复申请状态','/sales/withdrawals?stage=paid&stage=pending'],['重复订单搜索','/sales/records?keyword=a&keyword=b']]){
    const response=await api(path);
    ok(label+'返回400，不降格为空列表',response.status===400);
  }
  const malformedIntent=await api('/sales/withdraw',{method:'POST',body:{amountYuan:'1.00',contact:'合成测试账号',requestKey:null}});
  ok('显式空提现标识被拒绝',malformedIntent.status===400);
  const overflowWithdrawal=await api('/sales/withdraw',{method:'POST',body:{amountYuan:'1000000.01',contact:'合成测试账号'}});
  ok('提现上限在冻结前检查',overflowWithdrawal.status===400);
  const laterWithdrawal=await api('/sales/withdraw',{method:'POST',body:{amountYuan:'1.00',channels:2,contact:'合成微信账号',requestKey:randomUUID()}});
  ok('新申请等待审核而不是直接打款',isOk(laterWithdrawal.status)&&laterWithdrawal.body?.orderStatus===0&&laterWithdrawal.body?.paymentStatus===0);
  const beforePayment=await api('/sales/info');
  token=savedToken;
  const approval=await api('/sales/audit/'+laterWithdrawal.body.id,{method:'POST',body:{pass:true,paymentStatus:0}});
  ok('可明确只审核通过，暂不登记打款',isOk(approval.status)&&approval.body?.paymentStatus===0);
  token=userA.token;
  const approvedRows=await api('/sales/withdrawals?stage=approved');
  ok('前台区分审核通过待打款',approvedRows.body?.items?.some(row=>row.id===laterWithdrawal.body.id&&row.paymentStatus===0));
  token=savedToken;
  const registrations=await Promise.all(Array.from({length:2},()=>api('/sales/audit/'+laterWithdrawal.body.id,{method:'POST',body:{pass:true,paymentStatus:1}})));
  ok('并发登记同一已审核申请仅成功一次',registrations.filter(r=>isOk(r.status)).length===1&&registrations.some(r=>r.status===409));
  token=userA.token;
  const afterPayment=await api('/sales/info');
  ok('登记打款不再次扣减佣金',afterPayment.body?.distributionCents===beforePayment.body?.distributionCents&&afterPayment.body?.withdrawalCents===beforePayment.body?.withdrawalCents&&afterPayment.body?.withdrawalSummary?.paidCents===100);
  const paidRows=await api('/sales/withdrawals?stage=paid');
  ok('本人已登记打款记录有明确状态',paidRows.body?.items?.some(row=>row.id===laterWithdrawal.body.id&&row.paymentStatus===1));

  token = savedToken;

  // -------------------------------------------------------------------------
  console.log('[6] 绘图扣费与余额不足');
  const poor = await registerUser('d');
  token = poor.token;
  const noQuota = await api('/image/tasks', { method: 'POST', body: { prompt: 'a cat' } });
  ok('绘图片数为 0 时被拒（402）', noQuota.status === 402, `status=${noQuota.status}`);
  ok('拒绝时带业务码 8002', noQuota.raw?.code === 8002, `code=${noQuota.raw?.code}`);
  token = savedToken;

  token = poor.token;
  const poorId = (await api('/users/profile')).body?.id;
  ok('新用户能读到自己的 id', typeof poorId === 'string' && poorId.length > 10, String(poorId));
  token = savedToken;
  const grantDraw = await api('/balance/upgradeBalance', { method: 'POST', body: { userId: poorId, drawMjCount: 2 } });
  ok('管理员发放绘图片数', isOk(grantDraw.status), grantDraw.text.slice(0, 160));
  token = poor.token;
  const withQuota = await api('/image/tasks', { method: 'POST', body: { prompt: 'a cat' } });
  ok('发放绘图片数后可以排队', isOk(withQuota.status), withQuota.text.slice(0, 200));
  token = savedToken;

  // -------------------------------------------------------------------------
  console.log('[7] 对话扣费');
  const billModel = `bill-model-${suffix}`;
  const billCh = `bill-ch-${suffix}`;
  const FAKE = process.env.E2E_FAKE ?? 'http://127.0.0.1:9899/v1';

  const chRes = await api('/models/channels', {
    method: 'POST',
    body: { name: billCh, type: 'OPENAI', baseUrl: FAKE, timeoutMs: 15000, priority: 5 },
  });
  ok('创建计费测试渠道', isOk(chRes.status), chRes.text.slice(0, 160));

  const mRes = await api('/models', {
    method: 'POST',
    body: { name: billModel, displayName: billModel, maxContext: 32000, maxOutput: 1024 },
  });
  ok('创建计费测试模型', isOk(mRes.status), mRes.text.slice(0, 160));

  const bindRes = await api(`/models/${mRes.body.id}/channels`, {
    method: 'POST',
    body: { channelId: chRes.body.id, upstreamName: 'x' },
  });
  ok('绑定渠道', isOk(bindRes.status), bindRes.text.slice(0, 160));

  const priceRes = await api(`/models/${mRes.body.id}`, {
    method: 'PATCH',
    body: { countPool: 'model3', countCost: 1 },
  });
  ok('配置次数计费（model3 / 每次 1）', priceRes.body?.countPool === 'model3' && priceRes.body?.countCost === 1);

  const billUser = await registerUser('e');
  token = billUser.token;
  const billProfile = await api('/users/profile');
  token = savedToken;
  const grantChat = await api('/balance/upgradeBalance', {
    method: 'POST',
    body: { userId: billProfile.body?.id, model3Count: 1 },
  });
  ok('发放 1 次对话额度', isOk(grantChat.status), grantChat.text.slice(0, 160));

  token = billUser.token;
  const c1 = await api('/chat/completions', {
    method: 'POST',
    body: { model: billModel, messages: [{ role: 'user', content: '你好' }] },
  });
  ok('对话请求成功', isOk(c1.status), c1.text.slice(0, 160));

  const bal1 = (await api('/balance/query')).body;
  ok('对话完成后扣掉 1 次', bal1?.counts?.model3 === 0, `model3=${bal1?.counts?.model3}`);

  const c2 = await api('/chat/completions', {
    method: 'POST',
    body: { model: billModel, messages: [{ role: 'user', content: '再来一次' }] },
  });
  ok('次数用尽后对话被拒（402）', c2.status === 402, `status=${c2.status}`);
  ok('拒绝时带业务码 8002', c2.raw?.code === 8002, `code=${c2.raw?.code}`);
  token = savedToken;

  // -------------------------------------------------------------------------
  console.log('[8] 限流（防刷）');
  await setSettings([
    { key: 'commerce.exchangeRateLimit', value: 2 },
    { key: 'commerce.orderRateLimit', value: 1 },
    { key: 'commerce.withdrawRateLimit', value: 1 },
  ]);

  token = userB.token;
  const bad1 = await api('/crami/exchange', { method: 'POST', body: { code: 'AAAAAAAAAAAA' } });
  const bad2 = await api('/crami/exchange', { method: 'POST', body: { code: 'BBBBBBBBBBBB' } });
  ok(
    '限流前的两次核销按业务返回 404',
    bad1.status === 404 && bad2.status === 404,
    `${bad1.status}/${bad2.status}`,
  );
  const bad3 = await api('/crami/exchange', { method: 'POST', body: { code: 'CCCCCCCCCCCC' } });
  ok('超过限额后返回 429', bad3.status === 429, `status=${bad3.status}`);

  const o1 = await api('/order/create', { method: 'POST', body: { goodsType: 'package', goodsId: pkg.id } });
  ok('限额 1 时首单可下', isOk(o1.status), o1.text.slice(0, 120));
  const o2 = await api('/order/create', { method: 'POST', body: { goodsType: 'package', goodsId: pkg.id } });
  ok('第二次下单被限流（429）', o2.status === 429, `status=${o2.status}`);

  const w1 = await api('/sales/withdraw', { method: 'POST', body: { amountYuan: '1.00', contact: 'x' } });
  ok('未开通分销时首次提现是业务拒绝（403）', w1.status === 403, `status=${w1.status}`);
  const w2 = await api('/sales/withdraw', { method: 'POST', body: { amountYuan: '1.00', contact: 'x' } });
  ok('第二次提现被限流（429）', w2.status === 429, `status=${w2.status}`);

  // 复原要用管理员身份，先换回 token 再改配置
  token = savedToken;
  await setSettings([
    { key: 'commerce.exchangeRateLimit', value: 999 },
    { key: 'commerce.orderRateLimit', value: 999 },
    { key: 'commerce.withdrawRateLimit', value: 999 },
  ]);

  // -------------------------------------------------------------------------
  console.log('[9] 路由契约（' + COMMERCE_ROUTES.length + ' 条）');
  const missing = [];
  for (const route of COMMERCE_ROUTES) {
    const res = await probe(route);
    if (isRouteMissing(res.raw, res.status)) missing.push(`${route.method} ${route.path}`);
  }
  ok(
    `${COMMERCE_ROUTES.length} 条路由全部存在`,
    missing.length === 0,
    missing.join('; '),
  );

  // -------------------------------------------------------------------------
  console.log('[10] 关闭开关后全部 404');
  await setSettings([{ key: 'commerce.enabled', value: false }]);
  const closed = await api('/balance/query');
  ok('/balance/query 变 404', closed.status === 404, `status=${closed.status}`);
  ok('关闭态返回业务码 8001', closed.raw?.code === 8001, `code=${closed.raw?.code}`);

  const notGuarded = [];
  for (const route of COMMERCE_ROUTES) {
    const res = await probe(route);
    if (!(res.status === 404 && res.raw?.code === 8001)) {
      notGuarded.push(`${route.method} ${route.path} → ${res.status}/${res.raw?.code ?? '-'}`);
    }
  }
  ok(
    '关闭后 ' + COMMERCE_ROUTES.length + ' 条全部返回 8001/404',
    notGuarded.length === 0,
    notGuarded.slice(0, 5).join('; '),
  );

  // 还原登录限流（默认 10），不要把开发库留在"不限流"状态
  await setSettings([{ key: 'security.loginRateLimit', value: 10 }]);

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  if (failed > 0) process.exit(1);
}

main()
  .catch(async (e) => {
    console.error('commerce e2e 异常终止:', e);
    // 异常路径也要把开关关掉，避免污染后续测试
    try {
      await setSettings([{ key: 'commerce.enabled', value: false }]);
    } catch {
      /* ignore */
    }
    process.exit(1);
  })
  .finally(() => {
    /* 保持进程自然退出 */
  });
