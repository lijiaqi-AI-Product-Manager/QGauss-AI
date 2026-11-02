import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createArtworkAssets } from '../src/lib/artwork-assets.js';
import { fetchBlob, uploadFile, setAccessToken, setRefreshHandler } from '../src/api/client.js';

const originalFetch = globalThis.fetch, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
const caches = [];
const result = { fileId: 'image', url: '/api/image/tasks/art/results/image' };
const image = () => new Response(new Blob(['qgauss-image'], { type: 'image/png' }), { headers: { 'Content-Type': 'image/png' } });
const cache = (isCurrent = () => true) => { const value = createArtworkAssets(isCurrent); caches.push(value); return value; };
afterEach(() => { for (const value of caches.splice(0)) value.close(); globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; setAccessToken(''); setRefreshHandler(null); });

test('轮询、列表和详情共享同一图片请求与 URL，释放后撤销', async () => {
  let resolve, requests = 0; const revoked = [];
  globalThis.fetch = async () => { requests += 1; return new Promise(done => { resolve = done; }); };
  URL.revokeObjectURL = url => { revoked.push(url); originalRevoke(url); };
  const assets = cache(); const first = assets.load(result), second = assets.load(result);
  assert.equal(first, second); resolve(image()); const entry = await first;
  assert.ok(entry.url.startsWith('blob:')); assert.equal(requests, 1);
  assert.equal(await assets.load(result), entry); assert.equal(requests, 1);
  assets.retain(new Set()); assert.deepEqual(revoked, [entry.url]); assert.equal(assets.urls.size, 0);
});

test('离页或翻页释放后，迟到图片不能重新创建 URL', async () => {
  let resolve, signal, created = 0;
  globalThis.fetch = async (_url, init) => { signal = init.signal; return new Promise(done => { resolve = done; }); };
  URL.createObjectURL = () => { created += 1; return 'blob:unexpected'; };
  const assets = cache(), pending = assets.load(result); assets.retain(new Set());
  assert.equal(signal.aborted, true); resolve(image()); assert.equal(await pending, null);
  assert.equal(created, 0); assert.equal(assets.urls.size, 0);
});

test('错误图片保留重试入口，不在每次渲染或轮询时反复请求', async () => {
  let requests = 0; globalThis.fetch = async () => ++requests === 1 ? new Response('', { status: 503 }) : image();
  const assets = cache(); assert.equal(await assets.load(result), null); assert.equal(assets.errors.size, 1);
  assert.equal(await assets.load(result), null); assert.equal(requests, 1);
  assert.ok(await assets.load(result, true)); assert.equal(requests, 2); assert.equal(assets.errors.size, 0);
});

test('账号已切换或缓存已关闭，不挂回旧用户图片，也不向外部地址附带令牌', async () => {
  let current = true, resolve, requests = 0;
  globalThis.fetch = async () => { requests += 1; return new Promise(done => { resolve = done; }); };
  const assets = cache(() => current), pending = assets.load(result); current = false; resolve(image());
  assert.equal(await pending, null); assert.equal(assets.urls.size, 0);
  current = true; await assets.load({ url: 'https://untrusted.test/image' }); assert.equal(requests, 1);
  assets.close(); await assets.load(result); assert.equal(requests, 1);
});

test('私有图片 401 时静默刷新一次，保留取消信号', async () => {
  setAccessToken('old','asset-session'); const controller = new AbortController(), sent = []; let refreshes = 0;
  setRefreshHandler(async () => { refreshes += 1; setAccessToken('new','asset-session'); return true; });
  globalThis.fetch = async (url, init) => { sent.push({ url, ...init }); return sent.length === 1 ? new Response('', { status: 401 }) : image(); };
  assert.equal((await fetchBlob(result.url, { signal: controller.signal })).type, 'image/png');
  assert.equal(refreshes, 1); assert.equal(sent[1].headers.Authorization, 'Bearer new'); assert.equal(sent[1].signal, controller.signal);
});

test('旧账号的文件 401 不刷新新账号，也不重放旧文件请求', async () => {
  setAccessToken('account-a'); let resolve, refreshes = 0, requests = 0;
  setRefreshHandler(async () => { refreshes += 1; return true; });
  globalThis.fetch = async () => { requests += 1; return new Promise(done => { resolve = done; }); };
  const pending = fetchBlob(result.url); setAccessToken('account-b'); resolve(new Response('', { status: 401 }));
  await assert.rejects(pending, error => error.status === 401); assert.equal(requests, 1); assert.equal(refreshes, 0);
});

test('参考图上传刷新时保留文件与信号，账号切换后不把旧图上传到新账号', async () => {
  const file = new Blob(['image bytes'], { type: 'image/png' }); file.name = 'qgauss.png';
  const controller = new AbortController(), sent = []; setAccessToken('old','asset-session');
  setRefreshHandler(async () => { setAccessToken('new','asset-session'); return true; });
  globalThis.fetch = async (_url, init) => { sent.push(init); return sent.length === 1 ? new Response('{}', { status: 401 }) : new Response('{"code":0,"data":{"id":"ref-1"}}'); };
  assert.equal((await uploadFile(file, { signal: controller.signal })).id, 'ref-1');
  assert.equal(sent[1].signal, controller.signal); assert.equal(sent[1].headers.Authorization, 'Bearer new'); assert.equal(await sent[1].body.get('file').text(), 'image bytes');
  let resolve; setAccessToken('account-a'); sent.length = 0;
  globalThis.fetch = async (_url, init) => { sent.push(init); return new Promise(done => { resolve = done; }); };
  const pending = uploadFile(file); setAccessToken('account-b'); resolve(new Response('{}', { status: 401 }));
  await assert.rejects(pending, error => error.status === 401); assert.equal(sent.length, 1);
});
