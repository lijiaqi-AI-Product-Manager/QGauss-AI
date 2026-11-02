/** Real API, worker, storage and ledger; provider responses stay on loopback. */
import assert from 'node:assert/strict';
const API = process.env.E2E_API ?? 'http://127.0.0.1:9520/api';
const FAKE = process.env.E2E_FAKE ?? 'http://127.0.0.1:9899/v1';
const suffix = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let admin = '', passed = 0;
function check(name, fn) { fn(); passed += 1; console.log('  ✔ ' + name); }
async function json(path, method = 'GET', body, access = admin) {
  const response = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const raw = await response.json(); return { status: response.status, data: raw.data ?? raw, raw };
}
async function configure(values) { assert.equal((await json('/settings', 'PUT', { settings: Object.entries(values).map(([key, value]) => ({ key, value })) })).status, 200); }
async function account(tag) {
  const email = tag + '-' + suffix + '@qgauss.test', password = 'qgauss-image-test-123';
  assert.equal((await json('/auth/register', 'POST', { email, password, username: 'qgp' + tag + Math.random().toString(36).slice(2, 10) }, '')).status, 201);
  const login = await json('/auth/login', 'POST', { account: email, password }, '');
  return { token: login.data.accessToken, id: login.data.user.id };
}
async function model(channelId, name, upstreamName) {
  const created = await json('/models', 'POST', { name, displayName: 'QGauss 绘画验收', capabilities: 'image', maxContext: 32000, maxOutput: 1024 }); assert.equal(created.status, 201);
  assert.equal((await json('/models/' + created.data.id + '/channels', 'POST', { channelId, upstreamName })).status, 201);
  return { id: created.data.id, name };
}
async function settle(id, token) {
  // SUCCESS, its event and the ledger now commit together.
  for (let i = 0; i < 60; i += 1) { const row = (await json('/image/tasks/' + id, 'GET', undefined, token)).data; if (['FAILED', 'CANCELED'].includes(row.status) || (row.status === 'SUCCESS' && row.events?.some(event => event.status === 'SUCCESS'))) return row; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('Image task did not settle');
}
const imageRequest = (path, token) => fetch(new URL(path, API), { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(5000) });
async function imageStatus(path, access) { const response = await imageRequest(path, access); await response.arrayBuffer(); return response.status; }
async function imageStats(model) { return (await (await fetch(new URL('/stats', FAKE))).json()).images.filter(row => row.model === model); }
async function releaseImage(model) { const response = await fetch(new URL('/image-release', FAKE), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) }); assert.equal(response.status, 200); await response.json(); }
async function waitImage(model, predicate) { for (let i = 0; i < 50; i++) { const rows = await imageStats(model); if (predicate(rows)) return rows; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Image observation not reached: ' + model); }
const login = await json('/auth/login', 'POST', { account: process.env.E2E_ADMIN ?? 'admin', password: process.env.E2E_PASSWORD ?? 'admin123456' }, ''); admin = login.data.accessToken; assert.ok(admin);
const values = { 'security.loginRateLimit': 1000, 'security.registerRateLimit': 1000, 'security.registerEnabled': true, 'security.captchaEnabled': false, 'security.registerInviteCode': '', 'commerce.enabled': true, 'commerce.imageCost': 1, 'demo.siteEnabled': false, 'image.model': 'site-model-must-not-override-selection' };
const settings = (await json('/settings')).data;
const saved = Object.fromEntries(settings.filter(row => Object.hasOwn(values, row.key) || row.key === 'image.defaultChannel').map(row => [row.key, row.value]));
try {
  await configure(values);
  const owner = await account('a'), other = await account('b');
  await json('/balance/upgradeBalance', 'POST', { userId: owner.id, drawMjCount: 30 });
  const balance = async () => (await json('/balance/query', 'GET', undefined, owner.token)).data.counts.drawMj;
  const geminiChannel = await json('/models/channels', 'POST', { name: 'qgauss-image-gemini-' + suffix, type: 'GEMINI', baseUrl: new URL('/v1beta', FAKE).href, apiKey: 'fixture-key', timeoutMs: 10000 });
  const mockChannel = await json('/models/channels', 'POST', { name: 'qgauss-image-mock-' + suffix, type: 'MOCK', baseUrl: 'mock://image-fixture', timeoutMs: 1000 });
  const defaultChannel = await json('/models/channels', 'POST', { name: 'qgauss-image-default-' + suffix, type: 'OPENAI', baseUrl: FAKE, apiKey: 'fixture-key', timeoutMs: 1000 });
  await configure({ 'image.defaultChannel': defaultChannel.data.id });
  const upstream = 'gemini-qgauss-fixture-' + suffix;
  const selected = await model(geminiChannel.data.id, 'qgauss-image-selected-' + suffix, upstream);
  const mock = await model(mockChannel.data.id, 'qgauss-image-bill-' + suffix, 'qgauss-mock-image');
  const slow = await model(geminiChannel.data.id, 'qgauss-image-cancel-' + suffix, 'qgauss-image-slow-' + suffix);
  const options = (await json('/image/options', 'GET', undefined, owner.token)).data;
  check('绘画选项标识真实可用模型、画质能力与费用', () => { assert.equal(options.models.find(m => m.name === selected.name).ready, true); assert.deepEqual(options.models.find(m => m.name === selected.name).features.qualities, ['auto']); assert.equal(options.billing.costPerImage, 1); assert.equal(options.billing.qualityFactors.high, 2); });
  const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'qgauss-reference.png');
  const uploaded = await fetch(API + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + owner.token }, body: fd });
  const ref = (await uploaded.json()).data; assert.ok(ref?.id);
  const before = await balance();
  const created = await json('/image/tasks', 'POST', { prompt: 'QGauss local image integration', model: selected.name, versionName: 'untrusted name', mode: 'img2img', editOf: ref.id, ratio: '3:4', resolution: '1K', n: 2, seed: 0 }, owner.token);
  assert.equal(created.status, 201); const task = await settle(created.data.id, owner.token);
  check('创建响应冻结单张费用与预留上限', () => { assert.equal(created.data.billing.unitCost, 1); assert.equal(created.data.billing.limit, 2); assert.equal(task.billing.charged, 2); });
  check('绑定模型真正覆盖默认渠道，并生成两张图', () => { assert.equal(task.status, 'SUCCESS'); assert.equal(task.results.length, 2); assert.equal(task.meta.model, upstream); assert.equal(task.versionName, 'QGauss 绘画验收'); });
  const stats = await (await fetch(new URL('/stats', FAKE))).json(); const requests = stats.images.filter(r => r.model === upstream);
  check('上游实际收到所选模型、参考图、比例和零种子', () => { assert.equal(requests.length, 2); assert.ok(requests.every(r => r.hasImage && r.config.imageConfig.aspectRatio === '3:4')); assert.equal(requests[0].config.seed, 0); assert.equal(requests[1].config.seed, 1); });
  const after = await balance();
  check('两张自动画质仅扣两次', () => assert.equal(before - after, 2));
  const resultUrl = task.results[0].url;
  check('结果地址绑定作品，不再直接暴露私有上传路径', () => assert.equal(resultUrl, '/api/image/tasks/' + task.id + '/results/' + task.results[0].fileId));
  let raw = await imageRequest(resultUrl, owner.token); const ownerBytes = Buffer.from(await raw.arrayBuffer());
  check('作者可下载原始图片且不允许缓存授权结果', () => { assert.equal(raw.status, 200); assert.deepEqual(ownerBytes, png); assert.equal(raw.headers.get('cache-control'), 'private, no-store'); });
  const anonymousStatus = await imageStatus(resultUrl, ''), privateStatus = await imageStatus(resultUrl, other.token);
  check('匿名用户不能读取作品文件', () => assert.equal(anonymousStatus, 401));
  check('未发布作品拒绝其他用户', () => assert.equal(privateStatus, 404));
  assert.equal((await json('/image/tasks/' + task.id + '/publish', 'PATCH', { published: true }, owner.token)).status, 200);
  raw = await imageRequest(resultUrl, other.token); const publicBytes = Buffer.from(await raw.arrayBuffer());
  check('发布后其他用户可读取同一张图片', () => { assert.equal(raw.status, 200); assert.deepEqual(publicBytes, ownerBytes); });
  const publicDetail = (await json('/image/tasks/' + task.id, 'GET', undefined, other.token)).data;
  check('公开详情不泄露作者的参考图、费用或预留足迹', () => { assert.equal(publicDetail.mine, false); assert.equal(publicDetail.editOf, null); assert.equal(publicDetail.billing, undefined); assert.deepEqual(publicDetail.events, []); });
  const injectedStatus = await imageStatus('/api/image/tasks/' + task.id + '/results/' + ref.id, other.token), uploadStatus = await imageStatus(ref.url, other.token);
  check('公开作品不能借 result 路由读取作者参考图', () => assert.equal(injectedStatus, 404));
  check('原私有上传接口保持所有权限制', () => assert.equal(uploadStatus, 404));
  const download = await imageRequest(resultUrl + '?download=1', other.token); await download.arrayBuffer();
  check('作品支持带正确类型的附件下载', () => { assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /^attachment;/); assert.match(download.headers.get('content-type'), /^image\/png/); });
  const stolen = await json('/image/tasks', 'POST', { prompt: 'try reference', mode: 'img2img', editOf: ref.id }, other.token);
  check('做同款不能使用别人的私有参考图', () => assert.equal(stolen.status, 400));
  await json('/image/tasks/' + task.id + '/publish', 'PATCH', { published: false }, owner.token);
  const withdrawnStatus = await imageStatus(resultUrl, other.token);
  check('撤回发布后，新读取立即返回 404', () => assert.equal(withdrawnStatus, 404));
  const beforeHigh = await balance(); const high = await json('/image/tasks', 'POST', { prompt: 'high quality mock image', model: mock.name, quality: 'high', n: 2 }, owner.token); const highTask = await settle(high.data.id, owner.token); const afterHigh = await balance();
  check('高画质预检与实际结算使用同一倍率', () => { assert.equal(highTask.status, 'SUCCESS'); assert.equal(beforeHigh - afterHigh, 4); });
  raw = await imageRequest(highTask.results[0].url, owner.token); await raw.arrayBuffer();
  check('SVG 模拟结果保留沙箱与 nosniff', () => { assert.match(raw.headers.get('content-security-policy'), /sandbox/); assert.equal(raw.headers.get('x-content-type-options'), 'nosniff'); });
  const unsupported = await json('/image/tasks', 'POST', { prompt: 'quality not supported', model: selected.name, quality: 'high' }, owner.token);
  check('模型不支持的画质在排队前拒绝', () => assert.equal(unsupported.status, 400));
  await json('/models/' + selected.id, 'PATCH', { status: 'DISABLED' });
  const disabled = await json('/image/tasks', 'POST', { prompt: 'disabled', model: selected.name }, owner.token);
  check('已停用模型不悄悄换成站点默认模型', () => assert.ok([400, 404].includes(disabled.status)));
  const beforeCancel = await balance(), queued = await json('/image/tasks', 'POST', { prompt: 'cancel batch', model: slow.name, n: 4 }, owner.token);
  const canceled = await json('/image/tasks/' + queued.data.id + '/cancel', 'POST', undefined, owner.token);
  await new Promise(resolve => setTimeout(resolve, 700)); const canceledTask = (await json('/image/tasks/' + queued.data.id, 'GET', undefined, owner.token)).data; const afterCancel = await balance();
  check('取消任务不会被迟到结果覆盖，也不扣次数', () => { assert.equal(canceled.status, 201); assert.equal(canceledTask.status, 'CANCELED'); assert.equal(canceledTask.results.length, 0); assert.equal(beforeCancel, afterCancel); });
  await json('/image/tasks/' + task.id, 'DELETE', undefined, owner.token);
  const removedStatus = await imageStatus(resultUrl, owner.token);
  check('移入回收后作者也不能再次读取原作品地址', () => assert.equal(removedStatus, 404));

  const beforeQuote = (await json('/image/tasks', 'GET', undefined, owner.token)).data.total;
  const expiredQuote = await json('/image/tasks', 'POST', { prompt: 'stale quote', model: mock.name, expectedUnitCost: 0 }, owner.token);
  const afterQuote = (await json('/image/tasks', 'GET', undefined, owner.token)).data.total;
  check('过期报价返回 409 且不接受新费用或创建任务', () => { assert.equal(expiredQuote.status, 409); assert.equal(afterQuote, beforeQuote); });

  const poor = await account('limited'); await json('/balance/upgradeBalance', 'POST', { userId: poor.id, drawMjCount: 3 });
  const poorUpstream = 'qgauss-image-hold-limited-' + suffix;
  const poorModel = await model(geminiChannel.data.id, 'qgauss-image-limited-' + suffix, poorUpstream);
  const concurrent = await Promise.all([1, 2].map(i => json('/image/tasks', 'POST', { prompt: 'reserve race ' + i, model: poorModel.name, n: 2, expectedUnitCost: 1 }, poor.token)));
  check('并发任务不能重复占用同一份次数', () => assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 402]));
  const poorView = (await json('/balance/query', 'GET', undefined, poor.token)).data;
  check('钱包区分可用、预留与实际累计用量', () => { assert.equal(poorView.counts.drawMj, 1); assert.equal(poorView.reserved.drawMj, 2); assert.equal(poorView.used.drawMj, 0); });
  const heldTask = concurrent.find(r => r.status === 201).data;
  await json('/image/tasks/' + heldTask.id + '/cancel', 'POST', undefined, poor.token);
  await json('/image/tasks/' + heldTask.id + '/cancel', 'POST', undefined, poor.token);
  const poorReleased = (await json('/balance/query', 'GET', undefined, poor.token)).data;
  const poorLogs = (await json('/balance/consumeLog?pageSize=100', 'GET', undefined, poor.token)).data.items.filter(row => row.refId === heldTask.id);
  check('重复取消只释放一次，并保留预留和释放流水', () => { assert.equal(poorReleased.counts.drawMj, 3); assert.equal(poorReleased.reserved.drawMj, 0); assert.equal(poorLogs.filter(r => r.direction === 4).reduce((n, r) => n + r.amount, 0), 2); assert.equal(poorLogs.filter(r => r.direction === 5).reduce((n, r) => n + r.amount, 0), 2); });

  const paidUpstream = 'qgauss-image-hold-price-' + suffix;
  const paidModel = await model(geminiChannel.data.id, 'qgauss-image-price-' + suffix, paidUpstream);
  const beforeLocked = await balance();
  const locked = await json('/image/tasks', 'POST', { prompt: 'freeze accepted price', model: paidModel.name, n: 2, expectedUnitCost: 1 }, owner.token);
  await waitImage(paidUpstream, rows => rows.length > 0);
  await configure({ 'commerce.enabled': false, 'commerce.imageCost': 7 });
  await releaseImage(paidUpstream); const lockedDone = await settle(locked.data.id, owner.token);
  await configure({ 'commerce.enabled': true, 'commerce.imageCost': 1 }); const afterLocked = await balance();
  check('生成期间改价或关闭商业化不改变已接受的费用', () => { assert.equal(lockedDone.billing.unitCost, 1); assert.equal(lockedDone.billing.charged, 2); assert.equal(beforeLocked - afterLocked, 2); });

  const freeUpstream = 'qgauss-image-hold-free-' + suffix;
  const freeModel = await model(geminiChannel.data.id, 'qgauss-image-free-' + suffix, freeUpstream);
  const beforeFree = await balance(); await configure({ 'commerce.enabled': false });
  const free = await json('/image/tasks', 'POST', { prompt: 'accepted free creation', model: freeModel.name, n: 1, expectedUnitCost: 0 }, owner.token);
  await configure({ 'commerce.enabled': true }); await releaseImage(freeUpstream);
  const freeDone = await settle(free.data.id, owner.token), afterFree = await balance();
  check('已接受的免费创作不会因后来开启收费而补扣', () => { assert.equal(freeDone.billing.state, 'FREE'); assert.equal(freeDone.billing.charged, 0); assert.equal(beforeFree, afterFree); });

  const partialModel = await model(geminiChannel.data.id, 'qgauss-image-partial-' + suffix, 'qgauss-image-partial-' + suffix);
  const beforePartial = await balance(); const partial = await json('/image/tasks', 'POST', { prompt: 'partial completion', model: partialModel.name, n: 3 }, owner.token);
  const partialDone = await settle(partial.data.id, owner.token), afterPartial = await balance();
  check('部分成功仅结算实际张数并释放差额', () => { assert.equal(partialDone.status, 'SUCCESS'); assert.equal(partialDone.results.length, 1); assert.equal(partialDone.billing.charged, 1); assert.equal(partialDone.billing.returned, 2); assert.equal(beforePartial - afterPartial, 1); });

  const abortUpstream = 'qgauss-image-hold-abort-' + suffix;
  const abortModel = await model(geminiChannel.data.id, 'qgauss-image-abort-' + suffix, abortUpstream);
  const beforeAbort = await balance(); const active = await json('/image/tasks', 'POST', { prompt: 'cancel active connection', model: abortModel.name, n: 4 }, owner.token);
  await waitImage(abortUpstream, rows => rows.length === 1);
  assert.equal((await json('/image/tasks/' + active.data.id + '/cancel', 'POST', undefined, owner.token)).status, 201);
  const abortedRows = await waitImage(abortUpstream, rows => rows[0]?.aborted === true);
  const afterAbort = await balance(), activeDone = await settle(active.data.id, owner.token);
  check('取消关闭实际上游连接，不继续批量请求，也不扣次数', () => { assert.equal(abortedRows.length, 1); assert.equal(activeDone.status, 'CANCELED'); assert.equal(beforeAbort, afterAbort); });
} finally { await configure(saved); }
console.log('\n绘画工作台回归：' + passed + ' 通过 / 0 失败');
