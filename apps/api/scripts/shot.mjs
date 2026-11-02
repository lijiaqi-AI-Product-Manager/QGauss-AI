#!/usr/bin/env node
/**
 * 前端截图：用系统自带的 Edge（Chromium）以 headless 模式驱动，走 CDP 协议。
 *
 * 为什么不用 puppeteer/playwright：本机没有网络也无法装依赖；
 * 而 Node 22+ 自带全局 WebSocket，直接说 CDP 就够用了。
 *
 * 用法（需先起 API，且 apps/web/dist 已构建）：
 *   node scripts/shot.mjs            # 输出到 artifacts/screenshots/
 *   SHOT_API=http://127.0.0.1:9520 node scripts/shot.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const OUT = process.env.SHOT_OUT ?? join(repo, 'artifacts', 'screenshots');
/** 截图主题：默认深色；SHOT_THEME=light 出浅色一套 */
const THEME = process.env.SHOT_THEME === 'light' ? 'light' : 'dark';
const API = process.env.SHOT_API ?? 'http://127.0.0.1:9520';
const EDGE =
  process.env.SHOT_BROWSER ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.SHOT_CDP_PORT ?? 9333);
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1440);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 900);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, data: json?.data ?? json, raw: text };
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg.id) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30_000);
    });
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return cdp;
}

async function evaluate(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) throw new Error(`页面脚本报错: ${res.exceptionDetails.text}`);
  return res.result?.value;
}

async function goto(cdp, url, { settle = 1100 } = {}) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await evaluate(cdp, 'document.readyState')) === 'complete') break;
    } catch {
      /* 导航中 */
    }
    await sleep(120);
  }
  await sleep(settle);
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  ✔ ${name}.png`);
  return file;
}

async function waitCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 端口 30s 内未就绪');
}

/** 准备一份「看起来有内容」的数据：开关、套餐、卡密、余额、订单 */
async function prepare(token) {
  const settings = [
    { key: 'commerce.enabled', value: true },
    { key: 'commerce.rechargeEnabled', value: true },
    { key: 'commerce.signinEnabled', value: true },
  ];
  await call('/settings', { method: 'PUT', token, body: { settings } });

  const existing = await call('/crami/package/list', { token });
  if ((existing.data?.total ?? 0) === 0) {
    const pkgs = [
      { name: '入门体验包', priceYuan: '9.90', days: 7, model3Count: 200, model4Count: 50, des: '适合先试一下' },
      { name: '专业月卡', priceYuan: '59.00', days: 30, model3Count: 2000, model4Count: 500, drawMjCount: 100, des: '最受欢迎' },
    ];
    for (const p of pkgs) await call('/crami/package/create', { method: 'POST', token, body: p });
  }

  const pkgs = await call('/crami/package/list', { token });
  const first = pkgs.data?.items?.[0];
  if (first) {
    const cramis = await call('/crami/list', { token });
    if ((cramis.data?.total ?? 0) === 0) {
      await call('/crami/create', {
        method: 'POST',
        token,
        body: { packageId: first.id, count: 8, cramiType: 1 },
      });
    }

    const orders = await call('/order/list', { token });
    if ((orders.data?.total ?? 0) === 0) {
      await call('/order/create', {
        method: 'POST',
        token,
        body: { goodsType: 'package', goodsId: first.id },
      });
    }
  }

  await call('/balance/upgradeBalance', {
    method: 'POST',
    token,
    body: {
      userId: (await call('/auth/me', { token })).data?.id,
      amountYuan: '88.00',
      // 四池点数，顶栏「N 积分」才有真实数字可看
      model3Count: 320,
      model4Count: 40,
      drawMjCount: 12,
      agentCount: 6,
      remark: '截图演示',
    },
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const login = await call('/auth/login', {
    method: 'POST',
    body: { account: 'admin', password: process.env.SHOT_PASSWORD ?? 'admin123456' },
  });
  if (login.status !== 200 && login.status !== 201) {
    throw new Error(`登录失败 ${login.status}: ${login.raw.slice(0, 200)}`);
  }
  const token = login.data.accessToken;
  const refresh = login.data.refreshToken;
  console.log('已登录 admin，开始准备演示数据');
  await prepare(token);

  const profile = join(tmpdir(), `qg-edge-${Date.now()}`);
  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const wsUrl = await waitCdp();
    const cdp = await connect(wsUrl);

    // 登录页（先清掉本地令牌，否则会被重定向到 /chat）
    await goto(cdp, `${API}/login`);
    await evaluate(cdp, 'localStorage.clear()');
    await goto(cdp, `${API}/login`);
    await shot(cdp, '01-login');

    // 写入 refreshToken，让 bootstrap() 自动换到已登录态
    await evaluate(cdp, `localStorage.setItem('qg:refresh', ${JSON.stringify(refresh)})`);
    // 截图统一用深色主题；最后补浅色
    await evaluate(cdp, `localStorage.setItem('qg:theme', ${JSON.stringify(THEME)})`);

    const pages = [
      ['02-chat', '/chat'],
      ['02b-plaza', '/plaza'],
      ['03-image', '/image'],
      ['03b-painting', '/painting'],
      ['04-recharge', '/recharge'],
      ['05-wallet', '/wallet'],
      ['06-sales', '/sales'],
      ['07-admin-crami', '/admin/crami'],
      ['08-admin-orders', '/admin/orders'],
      ['09-admin-sales', '/admin/sales'],
      ['10-admin-models', '/models/list'],
    ];
    for (const [name, path] of pages) {
      await goto(cdp, `${API}${path}`);
      await shot(cdp, name);
    }
    cdp.ws.close();
  } finally {
    edge.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
  console.log(`截图输出目录：${OUT}`);
}

main().catch((err) => {
  console.error('截图失败:', err.message);
  process.exit(1);
});
