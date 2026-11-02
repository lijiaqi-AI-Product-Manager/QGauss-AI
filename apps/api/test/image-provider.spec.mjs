/** Real HTTP protocol verification against a loopback receiver; never contacts a provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ImageProvider } from '../dist/modules/image/image.provider.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function receiver(t) {
  const received = [];
  let failAt = 0;
  let holding = false;
  const arrival = Promise.withResolvers(), disconnected = Promise.withResolvers();
  const server = createServer(async (req, res) => {
    res.once('close', () => disconnected.resolve());
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks), multipart = req.headers['content-type']?.startsWith('multipart/');
      const body = multipart ? await new Request('http://qgauss.test', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: raw }).formData() : JSON.parse(raw.toString('utf8'));
      received.push({ url: req.url, headers: req.headers, body, multipart });
      res.setHeader('Content-Type', 'application/json');
      arrival.resolve();
      if (holding) { res.writeHead(200); res.write('{"data":['); return; }
      if (received.length === failAt) { res.writeHead(503).end(JSON.stringify({ error: { message: 'fixture unavailable' } })); return; }
      if (req.url.includes(':generateContent')) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }));
      else { const n = multipart ? Number(body.get('n')) : body.n; res.end(JSON.stringify({ data: Array.from({ length: n || 1 }, () => ({ b64_json: png.toString('base64') })) })); }
    } catch (error) { res.writeHead(500).end(JSON.stringify({ error: { message: error.message } })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  const values = { ALLOW_HTTP_UPSTREAM: '1', UPSTREAM_PORT_ALLOWLIST: String(port), UPSTREAM_PRIVATE_ALLOWLIST: '127.0.0.1:' + port, NANO_BANANA_MODEL: 'fixture-default-must-not-override-selected' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); Object.assign(process.env, values);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  return { received, base: 'http://127.0.0.1:' + port, failAt(value) { failAt = value; }, hold() { holding = true; }, arrival: arrival.promise, disconnected: disconnected.promise };
}
const channel = (base, type = 'OPENAI') => ({ id: 'fixture', type, baseUrl: base, apiKey: 'fixture-key', timeoutMs: 2000 });
const input = extra => ({ prompt: 'a glass studio', model: 'gpt-image-fixture', n: 1, size: '1024x1024', quality: 'auto', ...extra });

test('GPT 图像生成保留模型、画质与尺寸，不发送旧 response_format', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider();
  const result = await provider.generate(channel(server.base + '/v1'), input({ n: 2, quality: 'high', negativePrompt: 'noise' }));
  assert.equal(server.received[0].url, '/v1/images/generations');
  assert.equal(server.received[0].body.model, 'gpt-image-fixture'); assert.equal(server.received[0].body.quality, 'high');
  assert.equal(server.received[0].body.size, '1024x1024'); assert.equal(Object.hasOwn(server.received[0].body, 'response_format'), false);
  assert.match(server.received[0].body.prompt, /Negative: noise/); assert.equal(result.images.length, 2); assert.deepEqual(result.images[0].buffer, png);
});

test('参考图通过 edits multipart 发送真实图片字节，生成端点正确切换', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider();
  await provider.generate(channel(server.base + '/v1/images/generations'), input({ quality: 'high', sourceImage: { buffer: png, mime: 'image/png' } }));
  const sent = server.received[0]; assert.equal(sent.url, '/v1/images/edits'); assert.equal(sent.multipart, true);
  assert.equal(sent.body.get('quality'), 'high'); assert.equal(sent.body.get('model'), 'gpt-image-fixture');
  assert.equal(sent.body.get('image[]').type, 'image/png'); assert.deepEqual(Buffer.from(await sent.body.get('image[]').arrayBuffer()), png);
  assert.equal(sent.body.has('response_format'), false);
});

test('Gemini 使用实际绑定模型、参考图、比例、分辨率与种子，并生成请求的张数', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider();
  const result = await provider.generate(channel(server.base + '/v1beta', 'GEMINI'), input({ model: 'gemini-3-pro-image', n: 2, ratio: '16:9', resolution: '2K', seed: 0, sourceImage: { buffer: png, mime: 'image/png' } }));
  assert.equal(server.received.length, 2); assert.equal(result.images.length, 2); assert.equal(result.meta.model, 'gemini-3-pro-image');
  assert.ok(server.received.every(sent => sent.url === '/v1beta/models/gemini-3-pro-image:generateContent'));
  assert.deepEqual(server.received[0].body.generationConfig.imageConfig, { aspectRatio: '16:9', imageSize: '2K' });
  assert.equal(server.received[0].body.generationConfig.seed, 0); assert.equal(server.received[1].body.generationConfig.seed, 1);
  assert.equal(server.received[0].body.contents[0].parts[1].inline_data.data, png.toString('base64'));
});

test('多参考图按顺序发送，PNG 透明选区通过独立 mask 字段传入', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider(), second = Buffer.from('second-owned-image'), mask = Buffer.from('owned-mask');
  await provider.generate(channel(server.base + '/v1'), input({ sourceImages: [{ buffer: png, mime: 'image/png' }, { buffer: second, mime: 'image/webp' }], maskImage: { buffer: mask, mime: 'image/png' } }));
  const sent = server.received[0]; assert.equal(sent.url, '/v1/images/edits');
  const images = sent.body.getAll('image[]'); assert.equal(images.length, 2);
  assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), png); assert.deepEqual(Buffer.from(await images[1].arrayBuffer()), second);
  assert.deepEqual(Buffer.from(await sent.body.get('mask').arrayBuffer()), mask); assert.equal(sent.body.get('mask').type, 'image/png');
});
test('Gemini 保留多图顺序，无法支持的选区或传统单图模型不静默忽略设置', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider(), sources = [{ buffer: png, mime: 'image/png' }, { buffer: Buffer.from('other-image'), mime: 'image/png' }];
  await provider.generate(channel(server.base, 'GEMINI'), input({ sourceImages: sources }));
  assert.deepEqual(server.received[0].body.contents[0].parts.slice(1).map(p => p.inline_data.data), sources.map(s => s.buffer.toString('base64')));
  await assert.rejects(provider.generate(channel(server.base, 'GEMINI'), input({ sourceImages: sources, maskImage: sources[0] })), /不支持/);
  await assert.rejects(provider.generate(channel(server.base), input({ model: 'legacy-image', sourceImages: sources })), /不支持/);
  assert.equal(server.received.length, 1);
});

test('Gemini 部分失败保留已成功图片，取消后不继续批量请求', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider(); server.failAt(2);
  const partial = await provider.generate(channel(server.base, 'GEMINI'), input({ model: 'gemini-2.5-flash-image', n: 3 }));
  assert.equal(partial.images.length, 1); assert.equal(partial.meta.partial, true);
  assert.equal(Object.hasOwn(server.received[0].body.generationConfig.imageConfig, 'imageSize'), false);
  let checks = 0; server.failAt(0); const before = server.received.length;
  const canceled = await provider.generate(channel(server.base, 'GEMINI'), input({ n: 3, shouldContinue: async () => checks++ === 0 }));
  assert.equal(server.received.length - before, 1); assert.equal(canceled.images.length, 1);
});

test('自定义 generate 入口不静默忽略参考图，兼容网关仍保留旧格式参数', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider();
  await assert.rejects(provider.generate(channel(server.base + '/api/generate'), input({ sourceImage: { buffer: png, mime: 'image/png' } })), /参考图需要/);
  assert.equal(server.received.length, 0);
  await provider.generate(channel(server.base + '/api/generate'), input({ model: 'gateway-image' }));
  assert.equal(server.received[0].body.response_format, 'b64_json');
});

for (const type of ['OPENAI', 'GEMINI']) test(type + ' 取消会关闭已经返回响应头的图像连接，不等待响应体完成', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider(), controller = new AbortController();
  server.hold();
  const pending = provider.generate(channel(server.base, type), input({ signal: controller.signal }));
  await server.arrival;
  controller.abort(new Error('QGauss image canceled'));
  await assert.rejects(pending, /cancel|abort/i);
  let deadline;
  try { await Promise.race([server.disconnected, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Upstream connection remained open')), 1500); })]); }
  finally { clearTimeout(deadline); }
  assert.equal(server.received.length, 1);
});

for (const type of ['OPENAI', 'GEMINI']) test(type + ' 图像超时也覆盖响应体，不会因已收到响应头而永久挂起', { timeout: 10000 }, async t => {
  const server = await receiver(t), provider = new ImageProvider(); server.hold();
  await assert.rejects(provider.generate({ ...channel(server.base, type), timeoutMs: 100 }, input()), /timeout|abort/i);
  let deadline;
  try { await Promise.race([server.disconnected, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Timed-out body stayed connected')), 1500); })]); }
  finally { clearTimeout(deadline); }
  assert.equal(server.received.length, 1);
});
