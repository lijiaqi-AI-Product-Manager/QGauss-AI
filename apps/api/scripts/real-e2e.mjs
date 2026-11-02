#!/usr/bin/env node
/**
 * 真实供应商全链路测试：不碰 fake-upstream，直接把真实端点接进应用。
 *
 * 验证的是「供应商适配 + 流式解析 + 用量统计 + 图像结果解析」四件事同时成立，
 * 而不是「curl 能连通」。
 *
 * 前置：API 已在 9520 起好（node dist/main.js），且 apps/api/.env.realapi 有凭据。
 * 用法：node scripts/real-e2e.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.REAL_API ?? 'http://127.0.0.1:9520/api';
const envPath = join(here, '..', '.env.realapi');
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
}

let token = '';
let passed = 0;
let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`\u2714 ${name}`);
  } else {
    failed += 1;
    console.error(`\u2718 ${name}${detail ? `\n  ${detail}` : ''}`);
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let raw = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, raw, text, data: raw?.data };
}

const listOf = (r) => r.data?.items ?? r.data ?? [];

async function login() {
  const r = await api('/auth/login', {
    method: 'POST',
    body: { account: 'admin', password: process.env.E2E_PASSWORD ?? 'admin123456' },
  });
  token = r.data?.accessToken ?? '';
  ok('管理员登录', !!token, r.text.slice(0, 120));
}

async function ensureChannel(name, baseUrl, apiKey) {
  const found = listOf(await api('/models/channels')).find?.((c) => c.name === name);
  if (found) {
    await api(`/models/channels/${found.id}`, { method: 'PATCH', body: { baseUrl, apiKey } });
    return found.id;
  }
  const r = await api('/models/channels', {
    method: 'POST',
    body: { name, type: 'OPENAI', baseUrl, apiKey, timeoutMs: 180000, priority: 50 },
  });
  ok(`创建渠道 ${name}`, !!r.data?.id, r.text.slice(0, 200));
  return r.data?.id;
}

/**
 * upstreamName 必须是「供应商认识的名字」（比如 deepseek-chat），
 * 不能是本站的逻辑名——这里最容易踩坑：绑错就成了 400 model not found。
 */
async function ensureModel(name, channelId, upstreamName, priceIn, priceOut) {
  const found = listOf(await api('/models')).find?.((m) => m.name === name);
  const id =
    found?.id ??
    (
      await api('/models', {
        method: 'POST',
        body: {
          name,
          displayName: name,
          maxContext: 64000,
          maxOutput: 4096,
          priceInPerM: priceIn,
          priceOutPerM: priceOut,
        },
      })
    ).data?.id;
  ok(`模型 ${name} 就绪（upstream=${upstreamName}）`, !!id);
  await api(`/models/${id}/channels`, { method: 'POST', body: { channelId, upstreamName, weight: 1 } });
  return id;
}

async function realChat(model) {
  const t0 = Date.now();
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '用一句话介绍你自己，不超过 20 字' }],
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    ok('真实对话 HTTP 200', false, `${res.status} ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let done = null;
  let events = 0;
  for (;;) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split(/\r?\n\r?\n/);
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split(/\r?\n/).find((l) => l.trimStart().startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(line.indexOf('data:') + 5).trim();
      if (!payload || payload === '[DONE]') continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      events += 1;
      // 本项目 SSE 的增量字段是 v（为省带宽用了短名）；兼容 OpenAI 原生写法
      const piece = obj.v ?? obj.content ?? obj.delta ?? '';
      if (typeof piece === 'string') content += piece;
      if (obj.status) done = obj;
    }
  }
  ok('真实对话收到内容', content.length > 0, `content="${content.slice(0, 80)}" events=${events}`);
  ok(
    '真实 usage 落账（prompt/completion tokens > 0）',
    (done?.promptTokens ?? 0) > 0 && (done?.completionTokens ?? 0) > 0,
    JSON.stringify(done ?? {}).slice(0, 240),
  );
  ok('对话状态 COMPLETED', done?.status === 'COMPLETED', `status=${done?.status}`);
  console.log(`  真实对话耗时 ${Date.now() - t0}ms，内容：「${content.trim().slice(0, 40)}」`);
}

/**
 * 快照/恢复全局配置：真实联调会改 image.*，跑完必须还原。
 * 否则 dev.db 里 image.defaultChannel 一直指向真实渠道，
 * 下次跑 mock 的 e2e 就会打到真上游，变成难查的假红。
 */
async function snapshotSettings(keys) {
  const r = await api('/settings');
  const arr = Array.isArray(r.data) ? r.data : r.data?.items ?? [];
  const m = new Map(arr.map((x) => [x.key, x.value]));
  return Object.fromEntries(keys.map((k) => [k, m.get(k)]));
}

async function restoreSettings(snap) {
  const settings = Object.entries(snap).map(([key, value]) => ({ key, value }));
  await api('/settings', { method: 'PUT', body: { settings } });
}

async function realImage(channelId) {
  // SaveConfigDto = { settings: [{ key, value }] }。
  // 形状写错会 400 且**不生效**，worker 继续用 seed 的默认渠道（mock），
  // 看起来「出图成功」其实是 741 字节的占位 SVG——这条断言就是为了不让自己被骗。
  const saved = await api('/settings', {
    method: 'PUT',
    body: {
      settings: [
        { key: 'image.defaultChannel', value: channelId },
        // 中转网关要求显式 model，不配就是 400 model not register
        ...(env.REAL_IMAGE_MODEL ? [{ key: 'image.model', value: env.REAL_IMAGE_MODEL }] : []),
      ],
    },
  });
  ok('切换绘图默认渠道', saved.status === 200, saved.text.slice(0, 160));
  const created = await api('/image/tasks', {
    method: 'POST',
    body: { prompt: '一个纯红色的圆形，极简风格，白色背景', n: 1, size: '1024x1024' },
  });
  ok('提交真实绘图任务', !!created.data?.id, created.text.slice(0, 200));
  const id = created.data?.id;
  if (!id) return;

  const deadline = Date.now() + 180_000;
  let task = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    task = (await api(`/image/tasks/${id}`)).data;
    if (task?.status === 'SUCCESS' || task?.status === 'FAILED') break;
  }
  ok('绘图任务成功', task?.status === 'SUCCESS', `status=${task?.status} err=${task?.errorMessage ?? ''}`);
  ok('走的是真实供应商（不是 mock）', task?.provider && task.provider !== 'mock', `provider=${task?.provider}`);
  const results = task?.results ?? [];
  ok('产出了真实图片', results.length > 0, JSON.stringify(results).slice(0, 240));
  if (results[0]?.url) {
    const raw = results[0].url;
    const url = raw.startsWith('http') ? raw : `http://127.0.0.1:9520${raw}`;
    const img = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await img.arrayBuffer());
    const head = buf.subarray(0, 16).toString('hex');
    console.log(`  url=${raw}`);
    console.log(`  content-type=${img.headers.get('content-type')} bytes=${buf.length} head=${head}`);
    ok('图片可回源且非空', img.ok && buf.length > 1000, `status=${img.status} bytes=${buf.length}`);
    console.log(`  图片字节：${buf.length}`);
  }
}

async function main() {
  if (!env.REAL_API_KEY) {
    console.error('缺少 .env.realapi');
    process.exit(1);
  }
  await login();
  if (!token) process.exit(1);

  const snap = await snapshotSettings(['image.defaultChannel', 'image.model']);
  try {
  const chatCh = await ensureChannel('real-deepseek', env.REAL_API_BASE, env.REAL_API_KEY);
  await ensureModel('real-chat', chatCh, env.REAL_API_MODEL ?? 'deepseek-chat', 1_000_000, 2_000_000);
  await realChat('real-chat');

  if (env.REAL_IMAGE_KEY) {
    const imgCh = await ensureChannel('real-image', env.REAL_IMAGE_BASE, env.REAL_IMAGE_KEY);
    await realImage(imgCh);
  } else {
    console.log('· 未配置图像凭据，跳过绘图');
  }

  } finally {
    await restoreSettings(snap).catch((err) => console.error('恢复配置失败:', err.message));
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('真实测试异常：', e);
  process.exit(1);
});
