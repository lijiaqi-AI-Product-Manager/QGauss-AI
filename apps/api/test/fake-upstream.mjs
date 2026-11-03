/**
 * fake-upstream · 可控剧本的 OpenAI 兼容上游
 *
 * 用途：在没有真实 API Key 的情况下，把"异常路径"变成可重复验证的用例。
 * 这是整个测试体系里最值钱的一个文件——流式状态机、渠道熔断、错误分类，
 * 全部靠它来制造场景。
 *
 * 启动：node test/fake-upstream.mjs   （默认端口 9899）
 *
 * 剧本选择优先级：请求头 x-scenario > 模型名后缀（fake-500 → 500）
 *
 * 支持剧本：
 *   normal          正常流式（默认）
 *   slow-first-token 3 秒后才发第一个 token
 *   mid-stream-error 先发 3 个 delta，再发 error 事件
 *   http-429 / http-500 / http-401 / http-404   直接返回状态码
 *   malformed-json  发一段非法 JSON
 *   split-utf8      把中文按字节切开，跨 chunk 发送（验证 TextDecoder stream 模式）
 *   no-done         正常发完内容但没有 [DONE]
 *   hang            收下请求但永不响应
 *   length          以 finish_reason=length 结束
 *   reasoning       先发 reasoning_content 再发 content
 */
import { createServer } from 'node:http';
import { nativeUpstreamFixture } from './native-upstream-fixture.mjs';
import { cozeUpstreamFixture } from './coze-upstream-fixture.mjs';
import { voiceUpstreamFixture } from './voice-upstream-fixture.mjs';
import { imageEditUpstream } from './image-edit-upstream.mjs';
import { mjUpstreamFixture } from './mj-upstream-fixture.mjs';
import { videoUpstreamFixture } from './video-upstream-fixture.mjs';
import {videoToolsUpstream} from './video-tools-upstream-fixture.mjs';

const PORT = Number(process.env.FAKE_UPSTREAM_PORT ?? 9899);

const SCRIPT = {
  normal: 'normal',
  hold: 'run-hold',
  slow: 'slow-first-token',
  midError: 'mid-stream-error',
  bad429: 'http-429',
  bad500: 'http-500',
  bad401: 'http-401',
  bad404: 'http-404',
  malformed: 'malformed-json',
  splitUtf8: 'split-utf8',
  noDone: 'no-done',
  hang: 'hang',
  length: 'length',
  reasoning: 'reasoning',
  crlf: 'crlf',
};

function pickScenario(req, body) {
  const header = req.headers['x-scenario'];
  if (typeof header === 'string' && header) return header;

  const model = typeof body?.model === 'string' ? body.model : '';
  const map = {
    'fake-normal': SCRIPT.normal,
    'qgauss-run-hold': SCRIPT.hold,
    'fake-slow': SCRIPT.slow,
    'fake-mid-error': SCRIPT.midError,
    'fake-429': SCRIPT.bad429,
    'fake-500': SCRIPT.bad500,
    'fake-401': SCRIPT.bad401,
    'fake-404': SCRIPT.bad404,
    'fake-malformed': SCRIPT.malformed,
    'fake-split-utf8': SCRIPT.splitUtf8,
    'fake-no-done': SCRIPT.noDone,
    'fake-hang': SCRIPT.hang,
    'fake-length': SCRIPT.length,
    'fake-reasoning': SCRIPT.reasoning,
    'fake-crlf': SCRIPT.crlf,
  };
  return map[model] ?? SCRIPT.normal;
}

function sse(res, payload) {
  res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
}

function chunk(delta, finish = null) {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chatRequests = new Map();
const activeChats = new Map();
const imageRequests = [];
const heldImages = new Map(), releasedImages = new Set(), imageCallCounts = new Map();
const server = createServer(async (req, res) => {
  if(await mjUpstreamFixture(req,res))return;
  if(await videoToolsUpstream(req,res))return;
  if(await videoUpstreamFixture(req,res))return;
  if(await imageEditUpstream(req,res))return;
  if(await voiceUpstreamFixture(req,res))return;
  if(await cozeUpstreamFixture(req,res))return;
  if (await nativeUpstreamFixture(req, res)) return;
  if (req.method === 'POST' && req.url === '/image-release') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    let model = ''; try { model = JSON.parse(raw).model; } catch {}
    if (typeof model !== 'string' || !model.startsWith('qgauss-image-hold-')) { res.writeHead(400).end(); return; }
    releasedImages.add(model); if (releasedImages.size > 200) releasedImages.delete(releasedImages.values().next().value);
    const pending = heldImages.get(model), count = pending?.size || 0;
    for (const release of pending || []) release();
    heldImages.delete(model);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ released: count }));
    return;
  }
  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requests: Object.fromEntries(chatRequests), active: Object.fromEntries(activeChats), images: imageRequests }));
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, scenarios: Object.values(SCRIPT) }));
    return;
  }

  const isChat = req.url?.includes('/chat/completions');
  const isGenerate = req.url?.includes(':generateContent');
  if (req.method !== 'POST' || (!isChat && !isGenerate)) {
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  for await (const part of req) raw += part;
  let body = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    /* ignore */
  }

  const scenario = pickScenario(req, body);
  if (isChat) {
    const modelKey = String(body.model || '');
    chatRequests.set(modelKey, (chatRequests.get(modelKey) || 0) + 1);
    activeChats.set(modelKey, (activeChats.get(modelKey) || 0) + 1);
    res.once('close', () => activeChats.set(modelKey, Math.max(0, (activeChats.get(modelKey) || 1) - 1)));
  }

  // ---- 按 Key 决定结果：Key 池用例用 ----
  // 含 bad-key → 401（这把 Key 失效）；含 rate-key → 429（这把 Key 被限流）
  const auth = String(req.headers.authorization ?? '');
  if (isChat && /bad-key/.test(auth)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'invalid api key', type: 'fake' } }));
    return;
  }
  if (isChat && /rate-key/.test(auth)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rate limited', type: 'fake' } }));
    return;
  }

  // ---- Gemini / Nano Banana 兼容路由 ----
  if (req.url?.includes(':generateContent')) {
    const imageModel = decodeURIComponent(req.url.split('/models/')[1]?.split(':generateContent')[0] || '');
    const observation = { model: imageModel, hasImage: body?.contents?.[0]?.parts?.some(p => p.inline_data) || false, config: body?.generationConfig, aborted: false };
    imageRequests.push(observation);
    if (imageRequests.length > 200) imageRequests.shift();
    imageCallCounts.set(imageModel, (imageCallCounts.get(imageModel) || 0) + 1);
    res.once('close', () => { observation.aborted = !res.writableEnded; });
    if (imageModel.startsWith('qgauss-image-hold-') && !releasedImages.has(imageModel)) {
      await new Promise(resolve => {
        const pending = heldImages.get(imageModel) || new Set(); pending.add(resolve); heldImages.set(imageModel, pending);
        res.once('close', () => { pending.delete(resolve); if (!pending.size) heldImages.delete(imageModel); resolve(); });
      });
      if (res.destroyed) return;
    }
    if (req.url.includes('qgauss-image-slow')) await sleep(350);
    if (imageModel.startsWith('qgauss-image-partial-') && imageCallCounts.get(imageModel) > 1) { res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":{"message":"partial image fixture failure"}}'); return; }
    if (scenario === SCRIPT.bad401) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      return;
    }
    // 1x1 PNG
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const hasImage = Array.isArray(body?.contents?.[0]?.parts)
      ? body.contents[0].parts.some((p) => p?.inline_data)
      : false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: hasImage ? 'edited' : 'generated' },
                { inlineData: { mimeType: 'image/png', data: pngB64 } },
              ],
            },
          },
        ],
      }),
    );
    return;
  }

  if (scenario === SCRIPT.hang) return; // 永不响应

  const httpError = {
    [SCRIPT.bad429]: [429, 'rate limited'],
    [SCRIPT.bad500]: [500, 'internal error'],
    [SCRIPT.bad401]: [401, 'invalid api key'],
    [SCRIPT.bad404]: [404, 'model not found'],
  }[scenario];

  if (httpError) {
    res.writeHead(httpError[0], { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: httpError[1], type: 'fake' } }));
    return;
  }

  if (body.stream === false) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'QGauss local probe' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sys = Array.isArray(body?.messages)
    ? body.messages.find((m) => m && m.role === 'system')
    : null;
  // 附件回显：识图 parts 数、文档块文件名、文档里的 QG-MARK 标记（e2e 用来确认解析与注入）
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  let images = 0;
  let plain = '';
  for (const m of msgs) {
    if (Array.isArray(m?.content)) {
      for (const p of m.content) {
        if (p?.type === 'image_url') images += 1;
        if (p?.type === 'text') plain += `${p.text}\n`;
      }
    } else if (typeof m?.content === 'string') {
      plain += `${m.content}\n`;
    }
  }
  const docs = [...plain.matchAll(/【附件：([^】]+)】/g)].map((x) => x[1]);
  const marks = [...new Set(plain.match(/QG-MARK-[\w-]+/g) ?? [])];
  const att = images || docs.length ? `ATT:img=${images};doc=${docs.join(',')};marks=${marks.join(',')}|` : '';

  const text = body?.model === 'qgauss-mindmap-local' ? '# QGauss 花园计划\n## 植物\n- 薄荷\n- 迷迭香\n## 光线\n- 清晨柔光' :
    `SYS:${sys ? String(sys.content).slice(0, 30) : 'none'}|` +
    att +
    '这是一段用于验证流式解析与中文分片的中文回复，包含标点。';

  try {
    if (scenario === SCRIPT.hold) {
      sse(res, chunk({ content: '正在生成的部分内容。' }));
      const timer = setInterval(() => sse(res, chunk({ content: '继续。' })), 150);
      res.once('close', () => clearInterval(timer));
      return;
    }
    if (scenario === SCRIPT.slow) {
      await sleep(3000);
    }

    if (scenario === SCRIPT.reasoning) {
      for (const piece of ['先思考', '一下。']) {
        sse(res, chunk({ reasoning_content: piece }));
        await sleep(20);
      }
    }

    if (scenario === SCRIPT.malformed) {
      sse(res, '{"choices":[{"delta":');
      await sleep(20);
      sse(res, "{broken json}}}");
      res.end();
      return;
    }

    if (scenario === SCRIPT.splitUtf8) {
      // 把中文切成很小的 Buffer 片段，故意让多字节字符被拆到两个 chunk
      const buf = Buffer.from(chunk({ content: text }).toString().replace(/^/, 'data: ') + '\n\n', 'utf8');
      for (let i = 0; i < buf.length; i += 5) {
        res.write(buf.subarray(i, Math.min(i + 5, buf.length)));
        await sleep(5);
      }
      sse(res, chunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (scenario === SCRIPT.crlf) {
      // 1) 全部事件用 CRLF 分隔（SSE 规范允许，早期实现只认 \n\n 会整段吞掉）
      // 2) 同一事件里放两行 data（一行一个 JSON），验证多行 data 不被丢弃
      const crlfSse = (payload) => res.write(`data: ${JSON.stringify(payload)}\r\n`);
      crlfSse(chunk({ content: 'CRLF-' }));
      res.write('\r\n');
      await sleep(20);
      crlfSse(chunk({ content: 'A' }));
      crlfSse(chunk({ content: 'B' }));
      res.write('\r\n');
      await sleep(20);
      crlfSse(chunk({}, 'stop'));
      res.write('\r\n');
      res.write('data: [DONE]\r\n\r\n');
      res.end();
      return;
    }

    if (scenario === SCRIPT.midError) {
      for (let i = 0; i < 3; i += 1) {
        sse(res, chunk({ content: text.slice(i, i + 3) }));
        await sleep(30);
      }
      sse(res, { error: { message: 'upstream overloaded', type: 'fake_mid_stream' } });
      res.end();
      return;
    }

    for (let i = 0; i < text.length; i += 4) {
      sse(res, chunk({ content: text.slice(i, i + 4) }));
      await sleep(10);
    }

    sse(res, chunk({}, scenario === SCRIPT.length ? 'length' : 'stop'));
    sse(res, {
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    });
    if (scenario !== SCRIPT.noDone) res.write('data: [DONE]\n\n');
    res.end();
  } catch {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake-upstream listening on http://127.0.0.1:${PORT}/v1`);
  console.log(`scenarios: ${Object.values(SCRIPT).join(', ')}`);
});
