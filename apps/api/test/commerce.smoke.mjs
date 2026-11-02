// 商业内核冒烟脚本（临时，验证后删除）
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:9520/api';

async function req(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, body: json };
}

async function waitReady() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(API + '/health');
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API 未就绪');
}

const fails = [];
function check(name, cond, extra) {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    console.log(`  ✘ ${name}${extra ? ' :: ' + JSON.stringify(extra) : ''}`);
    fails.push(name);
  }
}

await waitReady();
console.log('API ready');

const login = await req('POST', '/auth/login', { account: 'admin@local.dev', password: 'admin123456' });
check('admin 登录', login.status === 200 || login.status === 201 && !!login.body?.data?.accessToken, login);
const token = login.body.data.accessToken;

const off = await req('GET', '/balance/query', undefined, token);
check('关闭时 /balance/query = 404', off.status === 404, off);

const set = await req(
  'PUT',
  '/settings',
  {
    settings: [
      { key: 'commerce.enabled', value: true },
      { key: 'commerce.signinEnabled', value: true },
      { key: 'commerce.signinCount', value: 3 },
      { key: 'commerce.signinPool', value: 'model3' },
    ],
  },
  token,
);
check('开启商业化', set.status === 200, set);

const before = await req('GET', '/balance/query', undefined, token);
check('开启后 /balance/query = 200', before.status === 200, before);
check('初始 model3 = 0', before.body?.data?.counts?.model3 === 0, before.body?.data?.counts);
check('初始 balanceYuan = 0.00', before.body?.data?.balanceYuan === '0.00', before.body?.data?.balanceYuan);

const sign = await req('POST', '/signin/sign', {}, token);
check('签到成功', sign.status === 201 || sign.status === 200, sign);
check('签到奖励 3', sign.body?.data?.reward === 3, sign.body?.data);
check('签到后 model3 = 3', sign.body?.data?.counts?.model3 === 3, sign.body?.data?.counts);

const again = await req('POST', '/signin/sign', {}, token);
check('重复签到 409', again.status === 409, again);
check('重复签到业务码 8008', again.body?.code === 8008, again.body);

const log = await req('GET', '/signin/signinLog', undefined, token);
check('签到日志 signedToday', log.body?.data?.signedToday === true, log.body?.data);
check('签到连续天数 1', log.body?.data?.streak === 1, log.body?.data?.streak);

const recharge = await req('GET', '/balance/rechargeLog', undefined, token);
check('充值流水 1 条', recharge.body?.data?.total >= 1, recharge.body?.data);
check('充值类型 signin', recharge.body?.data?.items?.[0]?.rechargeType === 'signin', recharge.body?.data?.items?.[0]);

const me = await req('GET', '/auth/me', undefined, token);
const adminId = me.body?.data?.id ?? me.body?.data?.user?.id;
const grant = await req(
  'POST',
  '/balance/upgradeBalance',
  { userId: adminId, model4Count: 5, amountYuan: '10.00', remark: '冒烟测试' },
  token,
);
check('手工发放成功', grant.status === 201 || grant.status === 200, grant);

const after = await req('GET', '/balance/query', undefined, token);
check('发放后 model4 = 5', after.body?.data?.counts?.model4 === 5, after.body?.data?.counts);
check('发放后余额 10.00', after.body?.data?.balanceYuan === '10.00', after.body?.data?.balanceYuan);

const account = await req('GET', '/balance/accountLog', undefined, token);
check('管理员可见消费流水', account.status === 200, account);

const bad = await req('POST', '/balance/upgradeBalance', { userId: adminId, amountYuan: '1.234' }, token);
check('非法金额 400', bad.status === 400, bad);

const reset = await req('PUT', '/settings', { settings: [{ key: 'commerce.enabled', value: false }] }, token);
check('关闭商业化', reset.status === 200, reset);
const off2 = await req('GET', '/balance/query', undefined, token);
check('再次关闭后 404', off2.status === 404, off2);

console.log(fails.length === 0 ? '\n全部通过' : `\n失败 ${fails.length} 项: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
