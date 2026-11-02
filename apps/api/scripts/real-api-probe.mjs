#!/usr/bin/env node
/**
 * 真实供应商探针：从 Node 发起真实请求，验证「能连、协议对、字段对」。
 *
 * 为什么必须有这个脚本：本项目其它所有 e2e 都打在 fake-upstream 上，
 * 只能证明「我们的解析器能处理假数据」，不能证明「真实供应商真的这么返回」。
 *
 * 凭据从 apps/api/.env.realapi 读（已 gitignore），不落库、不进日志。
 * 用法：node scripts/real-api-probe.mjs [chat|image|all]
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env.realapi');

function loadEnv() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();
const mask = (k) => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '(空)');

function hr(title) {
  console.log(`\n=== ${title} ===`);
}

async function probeChat() {
  hr('DeepSeek / OpenRouter 兼容 chat');
  const base = (env.REAL_API_BASE ?? '').replace(/\/+$/, '');
  const key = env.REAL_API_KEY ?? '';
  const model = env.REAL_API_MODEL ?? 'deepseek-chat';
  console.log(`base=${base} model=${model} key=${mask(key)}`);
  if (!base || !key) {
    console.log('✘ 缺少 REAL_API_BASE / REAL_API_KEY');
    return false;
  }

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 32,
        messages: [{ role: 'user', content: '只回复两个字：收到' }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    console.log(`✘ 请求失败：${e.message}`);
    return false;
  }

  console.log(`HTTP ${res.status} ${res.headers.get('content-type') ?? ''}（首包 ${Date.now() - t0}ms）`);
  if (!res.ok) {
    console.log(`✘ body: ${(await res.text()).slice(0, 300)}`);
    return false;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let chunks = 0;
  let text = '';
  let usage = null;
  let firstTokenMs = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split(/\r?\n\r?\n/);
    buf = parts.pop() ?? '';
    for (const part of parts) {
      for (const line of part.split(/\r?\n/)) {
        if (!line.trimStart().startsWith('data:')) continue;
        const payload = line.slice(line.indexOf('data:') + 5).trim();
        if (!payload || payload === '[DONE]') continue;
        chunks += 1;
        if (!firstTokenMs) firstTokenMs = Date.now() - t0;
        try {
          const obj = JSON.parse(payload);
          const delta = obj.choices?.[0]?.delta?.content ?? '';
          if (delta) text += delta;
          if (obj.usage) usage = obj.usage;
        } catch {
          console.log(`  ! 无法解析的分片：${payload.slice(0, 80)}`);
        }
      }
    }
  }

  console.log(`分片 ${chunks} 个，首 token ${firstTokenMs}ms，总耗时 ${Date.now() - t0}ms`);
  console.log(`内容：「${text.trim().slice(0, 60)}」`);
  console.log(`usage：${usage ? JSON.stringify(usage) : '✘ 无（说明该端点不返回 usage，计费需另算）'}`);
  const ok = chunks > 0 && text.length > 0;
  console.log(ok ? '✔ 真实聊天链路可用' : '✘ 未收到内容');
  return ok;
}

async function probeImage() {
  hr('图像生成端点');
  const rawBase = env.REAL_IMAGE_BASE ?? '';
  const key = env.REAL_IMAGE_KEY ?? '';
  const model = env.REAL_IMAGE_MODEL ?? '';
  console.log(`base=${rawBase} model=${model} key=${mask(key)}`);
  if (!rawBase) {
    console.log('· 未配置，跳过');
    return true;
  }

  // 先探路径：同一个 host 下试几个常见入口，看哪个返回「不是 404」
  const u = new URL(rawBase);
  const candidates = [rawBase, `${u.origin}/v1/images/generations`, `${u.origin}/v1/api/generate`];
  for (const url of [...new Set(candidates)]) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, prompt: 'a red dot', n: 1, size: '1024x1024' }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await r.text();
      console.log(`  POST ${url} → ${r.status} ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
      if (r.ok) {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          /* 非 JSON */
        }
        const item = parsed?.data?.[0];
        const kind = item?.url ? `url(${item.url.slice(0, 60)}…)` : item?.b64_json ? `b64(${item.b64_json.length} chars)` : '未知结构';
        console.log(`  ✔ 出图成功：${kind}`);
        return true;
      }
    } catch (e) {
      console.log(`  POST ${url} → 异常 ${e.message}`);
    }
  }
  console.log('✘ 所有候选路径均失败');
  return false;
}

const which = process.argv[2] ?? 'all';
let ok = true;
if (which === 'chat' || which === 'all') ok = (await probeChat()) && ok;
if (which === 'image' || which === 'all') ok = (await probeImage()) && ok;
process.exit(ok ? 0 : 1);
