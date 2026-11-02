/**
 * 压测 / 保护机制验证
 *
 * 分两段：
 *   A. 保护验证：并发上限设为 2，发 10 个并发 → 绝大多数应被 429 拦下，且不能出现 5xx 或挂死
 *   B. 吞吐验证：把上限调到压测并发数、关掉分钟限流 → 成功率应 ≥ 95%，输出 p50/p95
 *
 * 用法：
 *   node test/load.mjs
 *   CONCURRENCY=30 ROUNDS=3 node test/load.mjs
 *
 * 前置：API 已启动（mock-chat 可用）
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:9520/api';
const ADMIN = { account: process.env.E2E_ADMIN ?? 'admin', password: process.env.E2E_PASSWORD ?? 'admin123456' };
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const MODEL = process.env.LOAD_MODEL ?? 'mock-chat';

let token = '';
let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}${detail ? ' · ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${name} ${detail}`);
  }
}

async function apiCall(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: null };
  }
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const json = await res.json();
  token = json?.data?.accessToken;
  if (!token) throw new Error('登录失败');
}

async function setConfig(settings) {
  const res = await apiCall('/settings', { method: 'PUT', body: JSON.stringify({ settings }) });
  if (res.status >= 400) {
    throw new Error(`写配置失败 ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
  }
  return res;
}

async function oneChat(index) {
  const started = Date.now();
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: MODEL,
      clientMsgId: `load-${Date.now()}-${index}`,
      messages: [{ role: 'user', content: `压测消息 ${index}` }],
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, ms: Date.now() - started };
  }

  let chars = 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chars += decoder.decode(value, { stream: true }).length;
  }
  return { ok: true, status: 200, ms: Date.now() - started, chars };
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function phaseGuard() {
  console.log(`\n[A] 保护验证 · 上限 2 · ${CONCURRENCY} 并发`);
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => oneChat(`g-${i}`)));

  const success = results.filter((r) => r.ok).length;
  const throttled = results.filter((r) => r.status === 429).length;
  const serverErrors = results.filter((r) => r.status >= 500).length;
  const hung = results.filter((r) => r.ms > 30_000).length;

  ok('全部请求都有响应（无挂死）', hung === 0, `hung=${hung}`);
  ok('没有 5xx', serverErrors === 0, `5xx=${serverErrors}`);
  ok('超出并发上限的被 429 拦截', throttled >= CONCURRENCY - 3, `429=${throttled} 成功=${success}`);
  ok('放行数量不超过上限', success <= 2, `success=${success}`);
}

async function phaseThroughput() {
  console.log(`\n[B] 吞吐验证 · ${ROUNDS} 轮 × ${CONCURRENCY} 并发`);
  await setConfig([
    { key: 'chat.maxConcurrentStreams', value: CONCURRENCY },
    { key: 'security.chatRateLimit', value: 0 },
  ]);

  const latencies = [];
  let errors = 0;
  let empty = 0;

  for (let round = 1; round <= ROUNDS; round += 1) {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => oneChat(`t-${round}-${i}`)),
    );
    const elapsed = Date.now() - started;

    errors += results.filter((r) => !r.ok).length;
    empty += results.filter((r) => r.ok && r.chars < 10).length;
    latencies.push(...results.map((r) => r.ms));

    console.log(
      `  第 ${round} 轮: 成功 ${results.filter((r) => r.ok).length}/${CONCURRENCY} · ` +
        `墙钟 ${elapsed}ms · p95 ${percentile(results.map((r) => r.ms), 95)}ms`,
    );
  }

  const total = ROUNDS * CONCURRENCY;
  const okRatio = (total - errors) / total;
  ok('成功率 ≥ 95%', okRatio >= 0.95, `${Math.round(okRatio * 100)}%`);
  ok('无空流', empty === 0, `empty=${empty}`);
  console.log(`  整体 p50 ${percentile(latencies, 50)}ms · p95 ${percentile(latencies, 95)}ms · max ${Math.max(...latencies)}ms`);
}

async function main() {
  await login();
  console.log(`目标 ${API} · 模型 ${MODEL}`);

  // 先固定为"默认保护"配置，验证拦截；再放开跑吞吐；最后恢复
  await setConfig([
    { key: 'chat.maxConcurrentStreams', value: 2 },
    { key: 'security.chatRateLimit', value: 0 },
  ]);
  await phaseGuard();
  await phaseThroughput();

  await setConfig([
    { key: 'chat.maxConcurrentStreams', value: 2 },
    { key: 'security.chatRateLimit', value: 30 },
  ]);

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('压测异常:', e);
  process.exit(1);
});
