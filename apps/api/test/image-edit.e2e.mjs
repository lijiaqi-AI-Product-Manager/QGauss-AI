/** Native multipart + full decoding + ownership + ledger, entirely on loopback. */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const API = process.env.E2E_API || 'http://127.0.0.1:9521/api', FAKE = new URL('/image-edit-fixture', process.env.E2E_FAKE || 'http://127.0.0.1:9901/v1').href;
const suffix = Date.now().toString(36), pause = ms => new Promise(done => setTimeout(done, ms));
let admin, passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ✔ ' + name); };
async function api(path, method = 'GET', body, token = admin) { const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); const raw = await res.json(); return { status: res.status, data: raw.data ?? raw }; }
async function configure(values) { assert.equal((await api('/settings', 'PUT', { settings: Object.entries(values).map(([key, value]) => ({ key, value })) })).status, 200); }
async function user(tag) { const account = 'edit-' + tag + suffix + '@qgauss.test', password = 'QGauss-local-edit-123'; assert.equal((await api('/auth/register', 'POST', { email: account, username: 'edit' + tag + suffix, password }, '')).status, 201); const signed = (await api('/auth/login', 'POST', { account, password }, '')).data; return { token: signed.accessToken, id: signed.user.id }; }
async function model(type, name, upstream) { const channel = (await api('/models/channels', 'POST', { name: name + suffix, type, baseUrl: FAKE + '/v1', apiKey: 'fixture-key', timeoutMs: 30000 })).data; const m = (await api('/models', 'POST', { name: name + suffix, displayName: 'QGauss 区域编辑', capabilities: 'image', maxContext: 32000, maxOutput: 1024 })).data; assert.ok(m.id); assert.equal((await api('/models/' + m.id + '/channels', 'POST', { channelId: channel.id, upstreamName: upstream })).status, 201); return m; }
async function upload(bytes, token, name = 'QGauss-reference.png') { const body = new FormData(); body.append('file', new Blob([bytes], { type: 'image/png' }), name); const res = await fetch(API + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body }); assert.equal(res.status, 201); return (await res.json()).data.id; }
async function settle(id, token) { for (let i = 0; i < 100; i++) { const row = (await api('/image/tasks/' + id, 'GET', undefined, token)).data; if (['SUCCESS', 'FAILED', 'CANCELED'].includes(row.status)) return row; await pause(100); } throw Error('task did not complete'); }
async function observations() { return (await fetch(FAKE + '/stats')).json(); }
async function waitObservation(predicate) { for (let i = 0; i < 100; i++) { const rows = await observations(); if (predicate(rows)) return rows; await pause(50); } throw Error('provider observation timeout'); }
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
admin = (await api('/auth/login', 'POST', { account: process.env.E2E_ADMIN || 'admin', password: process.env.E2E_PASSWORD || 'admin123456' }, '')).data.accessToken; assert.ok(admin);
const config = { 'security.registerEnabled': true, 'security.registerRateLimit': 1000, 'security.loginRateLimit': 1000, 'security.registerInviteCode': '', 'security.captchaEnabled': false, 'commerce.enabled': true, 'commerce.imageCost': 1, 'demo.siteEnabled': false };
const prior = Object.fromEntries((await api('/settings')).data.filter(row => Object.hasOwn(config, row.key)).map(row => [row.key, row.value]));
try {
  await configure(config);
  const owner = await user('a'), other = await user('b'); await api('/balance/upgradeBalance', 'POST', { userId: owner.id, drawMjCount: 50 });
  const balance = async () => (await api('/balance/query', 'GET', undefined, owner.token)).data;
  const first = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#246abc' } }).png().toBuffer(), second = await sharp(first).negate().png().toBuffer();
  const wireFirst = await sharp(first).rotate().png().toBuffer(), wireSecond = await sharp(second).rotate().png().toBuffer();
  const rawMask = Buffer.alloc(8 * 6 * 4, 255); rawMask[3] = 0; const mask = await sharp(rawMask, { raw: { width: 8, height: 6, channels: 4 } }).png().toBuffer();
  const a = await upload(first, owner.token), b = await upload(second, owner.token), selected = await upload(mask, owner.token), foreign = await upload(first, other.token), broken = await upload(first.subarray(0, 34), owner.token), opaque = await upload(first, owner.token), wrongSize = await upload(await sharp(mask).resize(4, 3).png().toBuffer(), owner.token);
  const native = await model('OPENAI', 'qg-edit-native-', 'gpt-image-qgauss-edit-' + suffix), gemini = await model('GEMINI', 'qg-edit-gemini-', 'gemini-3-pro-image'), legacy = await model('OPENAI', 'qg-edit-legacy-', 'dall-e-2');
  const features = (await api('/image/options', 'GET', undefined, owner.token)).data.models;
  check('实际模型能力区分八张参考、单图与透明选区', () => { assert.equal(features.find(x => x.name === native.name).features.maxReferences, 8); assert.equal(features.find(x => x.name === native.name).features.mask, true); assert.equal(features.find(x => x.name === gemini.name).features.mask, false); assert.equal(features.find(x => x.name === legacy.name).features.maxReferences, 1); });
  const payload = { prompt: 'replace only the selected corner with a little glass flower', mode: 'img2img', model: native.name, referenceIds: [a, b], editOf: a, maskId: selected, n: 2, expectedUnitCost: 1 };
  const before = await balance(), accepted = await api('/image/tasks', 'POST', payload, owner.token); assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  check('接受时冻结整次预留与有序参考信息', () => { assert.deepEqual(accepted.data.referenceIds, [a, b]); assert.equal(accepted.data.maskId, selected); assert.equal(accepted.data.billing.limit, 2); });
  const complete = await settle(accepted.data.id, owner.token), sent = (await observations()).find(x => x.model === 'gpt-image-qgauss-edit-' + suffix), after = await balance();
  check('原生 multipart 真正收到两张独立图片、正确顺序与透明区域', () => { assert.equal(sent.images.length, 2); assert.deepEqual(sent.images.map(x => x.sha256), [digest(wireFirst), digest(wireSecond)]); assert.equal(sent.mask.selected, true); assert.equal(sent.mask.retained, true); assert.equal(sent.mask.mime, 'image/png'); });
  check('结果保存后只按两张成功作品结算一次', () => { assert.equal(complete.status, 'SUCCESS'); assert.equal(complete.results.length, 2); assert.equal(complete.billing.charged, 2); assert.equal(before.counts.drawMj - after.counts.drawMj, 2); assert.equal(after.reserved.drawMj, 0); });
  await api('/image/tasks/' + complete.id + '/publish', 'PATCH', { published: true }, owner.token);
  const publicDetail = (await api('/image/tasks/' + complete.id, 'GET', undefined, other.token)).data;
  const publicList = (await api('/image/square', 'GET', undefined, other.token)).data.items.find(x => x.id === complete.id);
  check('公开作品的详情和广场均不泄露参考图、选区或摘要', () => { for (const row of [publicDetail, publicList]) { assert.equal(row.editOf, null); assert.equal(row.referenceIds, undefined); assert.equal(row.maskId, undefined); assert.equal(JSON.stringify(row).includes(digest(first)), false); } });
  const privateMask = await fetch(API + '/upload/' + selected + '/raw', { headers: { Authorization: 'Bearer ' + other.token } }); await privateMask.arrayBuffer();
  check('其他用户不能读取选区文件', () => assert.equal(privateMask.status, 404));
  const invalids = [
    ['拒绝别人的参考图', { referenceIds: [foreign], editOf: foreign, maskId: undefined }],
    ['拒绝别人的选区', { maskId: foreign }], ['拒绝损坏图片', { referenceIds: [broken], editOf: broken, maskId: undefined }],
    ['拒绝全不透明选区', { maskId: opaque }], ['拒绝不同尺寸选区', { maskId: wrongSize }], ['拒绝重复参考图', { referenceIds: [a, a] }],
    ['拒绝空参考列表', { referenceIds: [] }], ['拒绝超过八张', { referenceIds: Array.from({ length: 9 }, (_, i) => 'ref-' + i), editOf: undefined }],
    ['拒绝字符串数组伪装', { referenceIds: a }], ['拒绝主图顺序冲突', { referenceIds: [b, a] }],
    ['拒绝文字模式夹带选区', { mode: 'text2img' }], ['Gemini 不静默忽略选区', { model: gemini.name }], ['传统单图模型不静默忽略多图', { model: legacy.name, maskId: undefined }],
    ['拒绝没有主图的选区', { referenceIds: undefined, editOf: undefined }], ['拒绝用参考图充当选区', { maskId: a }],
  ];
  const callsBefore = (await observations()).length, fundsBefore = await balance();
  for (const [name, patch] of invalids) { const res = await api('/image/tasks', 'POST', { ...payload, ...patch }, owner.token); check(name, () => assert.equal(res.status, 400, JSON.stringify(res.data))); }
  const fundsAfter = await balance();
  check('所有无效输入均没有上游调用或次数变化', () => { assert.equal(fundsAfter.counts.drawMj, fundsBefore.counts.drawMj); assert.equal(fundsAfter.reserved.drawMj, 0); });
  assert.equal((await observations()).length, callsBefore);
  const hold1 = await model('OPENAI', 'qg-edit-hold1-', 'gpt-image-qgauss-edit-hold1-' + suffix), hold2 = await model('OPENAI', 'qg-edit-hold2-', 'gpt-image-qgauss-edit-hold2-' + suffix);
  const held = []; for (const m of [hold1, hold2]) { const r = await api('/image/tasks', 'POST', { ...payload, model: m.name, n: 1 }, owner.token); assert.equal(r.status, 201); held.push(r.data); }
  await waitObservation(rows => rows.filter(x => x.model.includes('-hold')).length === 2);
  const queued = await api('/image/tasks', 'POST', payload, owner.token); assert.equal(queued.status, 201); assert.equal(queued.data.status, 'QUEUED');
  assert.equal((await api('/upload/' + b, 'DELETE', undefined, owner.token)).status, 200);
  await fetch(FAKE + '/release', { method: 'POST' }); const missing = await settle(queued.data.id, owner.token);
  check('排队后参考图被删除，执行前再次验证并退回全部预留', () => { assert.equal(missing.status, 'FAILED'); assert.equal(missing.billing.charged, 0); assert.equal(missing.billing.returned, 2); });
  for (const row of held) assert.equal((await settle(row.id, owner.token)).status, 'SUCCESS');
  const afterQueueCalls = (await observations()).length;
  check('无效排队任务不会重新调用上游', () => assert.equal(afterQueueCalls, callsBefore + 2));
  const fresh = await upload(second, owner.token), cancelModel = await model('OPENAI', 'qg-edit-holdcancel-', 'gpt-image-qgauss-edit-holdcancel-' + suffix);
  const preCancel = await balance(), active = await api('/image/tasks', 'POST', { ...payload, referenceIds: [a, fresh], model: cancelModel.name }, owner.token); assert.equal(active.status, 201);
  await waitObservation(rows => rows.some(x => x.model.includes('-holdcancel')));
  assert.equal((await api('/image/tasks/' + active.data.id + '/cancel', 'POST', undefined, owner.token)).status, 201);
  await waitObservation(rows => rows.some(x => x.model.includes('-holdcancel') && x.aborted));
  const canceled = await settle(active.data.id, owner.token), postCancel = await balance();
  check('局部重绘取消关闭真实连接，完整释放预留且不落迟到作品', () => { assert.equal(canceled.status, 'CANCELED'); assert.equal(canceled.results.length, 0); assert.equal(canceled.billing.returned, 2); assert.equal(postCancel.counts.drawMj, preCancel.counts.drawMj); assert.equal(postCancel.reserved.drawMj, 0); });
} finally { await fetch(FAKE + '/release', { method: 'POST' }); await configure(prior); }
console.log('\n多图与局部重绘：' + passed + ' 通过 / 0 失败');
