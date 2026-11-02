import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImageService, sizeOf } from '../dist/modules/image/image.service.js';
import { ImageWorker } from '../dist/modules/image/image.worker.js';
import { ImageRunsService } from '../dist/modules/image/image-runs.service.js';

test('公开图像详情保留文字与画面，来源身份和私有附加记录只对作者开放',async()=>{
 const f=fixture({status:'SUCCESS',published:true,parentId:'private-parent',metaJson:JSON.stringify({private:'private-generation-record'}),resultJson:'[]'}),publicRow=await f.service.detail('viewer','art-1'),owned=await f.service.detail('owner','art-1');
 assert.equal(publicRow.parentId,null);assert.equal(publicRow.meta,undefined);assert.equal(publicRow.billing,undefined);assert.equal(publicRow.prompt,owned.prompt);assert.equal(owned.parentId,'private-parent');assert.deepEqual(owned.meta,{private:'private-generation-record'});
});
test('图片结果入口拒绝把参考素材当作生成结果读取',async()=>{
 const f=fixture({status:'SUCCESS',resultJson:JSON.stringify([{fileId:'private-input',mime:'image/png'}])});f.storage.detail=async()=>({id:'private-input',scope:'chat'});await assert.rejects(f.service.result('owner','art-1','private-input'),error=>error.getStatus()===404);assert.equal(f.calls.reads.length,0);
});

function fixture(overrides = {}) {
  const task = { id: 'art-1', userId: 'owner', model: 'logical-image', versionName: 'QGauss Image', prompt: 'a glass studio', n: 2, ratio: '1:1', resolution: '1K', size: '1024x1024', quality: 'high', seed: 0, status: 'RUNNING', deletedAt: null, published: false, resultJson: null, ...overrides };
  const calls = { generated: [], saved: [], removed: [], charged: [], events: [], reads: [], created: [] };
  const settingsMap = { 'commerce.enabled': true, 'demo.siteEnabled': false, 'commerce.imageCost': 3, 'image.defaultChannel': 'site-default', 'image.model': 'site-upstream' };
  const settings = { get: async key => settingsMap[key] };
  const prisma = { user:{findFirst:async()=>({id:'owner'})}, imageTask: {
    findUnique: async () => ({ ...task }), findFirst: async () => ({ ...task }), count: async () => 0,
    create: async ({ data }) => { calls.created.push(data); return Object.assign(task, data); },
    update: async ({ data }) => Object.assign(task, data),
    updateMany: async ({ where, data }) => {
      const statuses = typeof where.status === 'string' ? [where.status] : where.status?.in;
      if ((statuses && !statuses.includes(task.status)) || (where.deletedAt === null && task.deletedAt)) return { count: 0 };
      Object.assign(task, data); return { count: 1 };
    },
  }, imageTaskEvent: { create: async ({ data }) => { calls.events.push(data); }, findMany: async () => calls.events }, aiModel: { findUnique: async () => null }, uploadFile: { findFirst: async () => null }, channel: { findFirst: async () => ({ id: 'site-default', type: 'MOCK', apiKeyEnc: '', baseUrl: 'mock://image', timeoutMs: 1000 }) } };
  prisma.$transaction = async fn => fn(prisma);
  const storage = {
    detail: async id=>({id,scope:'image'}),
    read: async (id, owner, role) => { calls.reads.push({ id, owner, role }); return { buffer: Buffer.from('image fixture'), mime: 'image/png', filename: 'qgauss.png' }; },
    saveBuffer: async (owner, buffer, options) => { const id = 'file-' + (calls.saved.length + 1); calls.saved.push({ id, owner, options }); await fixtureState.onSave?.(id); return { id, url: '/api/upload/' + id + '/raw', mime: options.mime }; },
    remove: async (id, owner, role) => { calls.removed.push({ id, owner, role }); },
  };
  const accounting = {
    quote: async quality => settingsMap['commerce.imageCost'] * (quality === 'high' ? 2 : 1),
    reserveTaskTx: async (tx, row, unitCost) => Object.assign(task, { billingUnitCost: unitCost, billingState: 'RESERVED', reservedAmount: unitCost * row.n }),
    prepare: async () => ({ ...task }),
    stage: async (id, saved, meta) => { const changed = await prisma.imageTask.updateMany({ where: { status: 'RUNNING', deletedAt: null }, data: { status: 'SETTLING', resultJson: JSON.stringify(saved), metaJson: JSON.stringify(meta || null) } }); return changed.count > 0; },
    complete: async () => { task.status = 'SUCCESS'; calls.charged.push({ owner: task.userId, amount: task.billingUnitCost * JSON.parse(task.resultJson).length, refId: task.id }); calls.events.push({ status: 'SUCCESS', message: JSON.parse(task.resultJson).length + ' / ' + task.n }); return true; },
    stop: async (id, status, message) => { const changed = await prisma.imageTask.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, data: { status } }); if (changed.count) calls.events.push({ status, message }); return changed.count > 0; },
  };
  task.billingUnitCost = settingsMap['commerce.imageCost'] * (task.quality === 'high' ? 2 : 1); task.billingState = 'RESERVED';
  const runs = new ImageRunsService();
  const channel = { id: 'selected-channel', type: 'OPENAI', apiKey: 'fixture-key', baseUrl: 'https://qgauss.test/v1', timeoutMs: 1000, upstreamName: 'gpt-image-fixture' };
  const models = { resolveRoute: async () => { if (fixtureState.routeError) throw fixtureState.routeError; return { model: { name: 'logical-image', displayName: 'QGauss Image', capabilities: 'image' }, channels: [channel] }; } };
  const provider = { generate: async (selected, input) => { calls.generated.push({ channel: selected, input }); await fixtureState.onGenerate?.(); return { images: Array.from({ length: fixtureState.outputCount }, () => ({ buffer: Buffer.from('image fixture'), mime: 'image/png' })) }; } };
  const moderation = { check: async () => null };
  const service = new ImageService(prisma, settings, accounting, moderation, storage, models, runs);
  const worker = new ImageWorker(prisma, settings, storage, provider, { decrypt: () => 'default-key' }, accounting, { pick: async () => null }, models, runs);
  const fixtureState = { task, calls, prisma, storage, models, channel, settingsMap, service, worker, outputCount: 2, onSave: null, onGenerate: null, routeError: null };
  return fixtureState;
}

test('同一用户的图片解码不会并行堆积，验证失败后释放处理名额', async () => {
  const f = fixture(), arrived = Promise.withResolvers(), finish = Promise.withResolvers();
  f.storage.read = async () => { arrived.resolve(); await finish.promise; return { buffer: Buffer.from('broken'), mime: 'image/png' }; };
  const first = f.service.create('owner', { prompt: 'edit', referenceIds: ['a'] }); await arrived.promise;
  await assert.rejects(f.service.create('owner', { prompt: 'edit again', referenceIds: ['a'] }), /正在处理中/);
  finish.resolve(); await assert.rejects(first, /无法完整解码/);
  await assert.rejects(f.service.create('owner', { prompt: 'retry', referenceIds: ['a'] }), /无法完整解码/);
});

test('选中的逻辑模型决定实际渠道、上游模型与画质，按实际张数结算', async () => {
  const f = fixture(); f.outputCount = 1;
  await f.worker.process(f.task.id);
  assert.equal(f.calls.generated[0].channel.id, 'selected-channel');
  assert.equal(f.calls.generated[0].input.model, 'gpt-image-fixture');
  assert.equal(f.calls.generated[0].input.quality, 'high');
  assert.equal(f.calls.generated[0].input.seed, 0);
  assert.equal(f.task.status, 'SUCCESS');
  assert.equal(f.calls.charged[0].amount, 6); // 1 actual image × high 2 × site cost 3
  assert.equal(f.calls.charged[0].refId, f.task.id);
  assert.match(f.calls.events.at(-1).message, /1 \/ 2/);
});

test('上游多返回候选图也不超出用户请求张数保存或扣次', async () => {
  const f = fixture({ n: 1 }); f.outputCount = 4;
  await f.worker.process(f.task.id);
  assert.equal(f.calls.saved.length, 1);
  assert.equal(f.calls.charged[0].amount, 6);
  assert.match(f.calls.events.at(-1).message, /1 \/ 1/);
});

test('上游返回前取消，不保存图片也不扣次数', async () => {
  const f = fixture(); f.onGenerate = () => { f.task.status = 'CANCELED'; };
  await f.worker.process(f.task.id);
  assert.equal(f.task.status, 'CANCELED'); assert.equal(f.calls.saved.length, 0); assert.equal(f.calls.charged.length, 0);
});

test('存图与取消并发时，终态条件写入不能把取消覆盖为成功', async () => {
  const f = fixture(); f.onSave = () => { f.task.status = 'CANCELED'; };
  await f.worker.process(f.task.id);
  assert.equal(f.task.status, 'CANCELED'); assert.equal(f.calls.charged.length, 0);
  assert.equal(f.calls.removed.length, 2); assert.ok(f.calls.removed.every(file => file.owner === 'owner' && file.role === 'USER'));
  assert.equal(f.calls.events.some(event => event.status === 'SUCCESS'), false);
});

test('取消后的迟到异常不能改写为失败', async () => {
  const f = fixture(); f.onGenerate = () => { f.task.status = 'CANCELED'; throw Error('upstream failed late'); };
  await f.worker.process(f.task.id);
  assert.equal(f.task.status, 'CANCELED'); assert.equal(f.calls.events.some(event => event.status === 'FAILED'), false); assert.equal(f.calls.charged.length, 0);
});

test('已经结束或删除的任务不会再次调用上游；模型被停用也不换成站点默认', async () => {
  for (const status of ['SUCCESS', 'CANCELED']) { const f = fixture({ status }); await f.worker.process(f.task.id); assert.equal(f.calls.generated.length, 0); }
  const f = fixture(); f.routeError = Error('model disabled'); await f.worker.process(f.task.id);
  assert.equal(f.calls.generated.length, 0); assert.equal(f.task.status, 'FAILED'); assert.equal(f.calls.charged.length, 0);
});

test('旧默认 mock-image 任务仍沿用站点图像配置', async () => {
  const f = fixture({ model: 'mock-image', quality: 'auto' }); await f.worker.process(f.task.id);
  assert.equal(f.calls.generated[0].channel.id, 'site-default'); assert.equal(f.calls.generated[0].input.model, 'site-upstream');
});

test('完成已抢先提交时，取消接口不会返回虚假的取消成功', async () => {
  const f = fixture(); f.prisma.imageTask.updateMany = async () => { f.task.status = 'SUCCESS'; return { count: 0 }; };
  await assert.rejects(f.service.cancel('owner', f.task.id), error => error.getStatus() === 400);
  assert.equal(f.task.status, 'SUCCESS'); assert.equal(f.calls.events.length, 0);
});

test('私有作品与已删除作品对其他用户都是 404，且不读取文件', async () => {
  const f = fixture({ status: 'SUCCESS', resultJson: '[{"fileId":"result"}]' });
  await assert.rejects(f.service.result('reader', f.task.id, 'result'), error => error.getStatus() === 404);
  f.task.published = true; f.task.deletedAt = new Date();
  await assert.rejects(f.service.result('reader', f.task.id, 'result'), error => error.getStatus() === 404);
  assert.equal(f.calls.reads.length, 0);
});

test('公开作品只授权声明的输出，按作者身份读取，不放宽私有上传接口', async () => {
  const f = fixture({ status: 'SUCCESS', published: true, editOf: 'private-ref', resultJson: '[{"fileId":"result","url":"https://untrusted.test/"}]' });
  await f.service.result('reader', f.task.id, 'result');
  assert.deepEqual(f.calls.reads[0], { id: 'result', owner: 'owner', role: 'USER' });
  await assert.rejects(f.service.result('reader', f.task.id, 'private-ref'), error => error.getStatus() === 404);
  const detail = await f.service.detail('reader', f.task.id);
  assert.equal(detail.editOf, null); assert.equal(detail.mine, false);
  assert.equal(detail.billing, undefined); assert.deepEqual(detail.events, []);
  assert.equal(detail.results[0].url, '/api/image/tasks/art-1/results/result');
  f.task.published = false;
  await assert.rejects(f.service.result('reader', f.task.id, 'result'), error => error.getStatus() === 404);
});

test('损坏结果清单与非图片结果不会变成文件读取旁路', async () => {
  const f = fixture({ status: 'SUCCESS', published: true, resultJson: '{"fileId":"result"}' });
  await assert.rejects(f.service.result('reader', f.task.id, 'result'), error => error.getStatus() === 404);
  f.task.resultJson = '[{"fileId":"result"}]'; f.storage.read = async () => ({ mime: 'text/plain', buffer: Buffer.from('private') });
  await assert.rejects(f.service.result('reader', f.task.id, 'result'), error => error.getStatus() === 404);
});

test('参考图必须属于自己且为图片，缺少参考图的图生图在排队前拒绝', async () => {
  const f = fixture();
  await assert.rejects(f.service.create('owner', { prompt: 'test', mode: 'img2img' }), /参考图/);
  await assert.rejects(f.service.create('owner', { prompt: 'test', editOf: 'other-file' }), /参考图/);
  f.prisma.uploadFile.findFirst = async () => ({ id: 'file', mime: 'text/plain' });
  await assert.rejects(f.service.create('owner', { prompt: 'test', editOf: 'file' }), /参考文件/);
  assert.equal(f.calls.created.length, 0);
});

test('画质能力和模型能力在排队前验证，显示名来自实际模型记录', async () => {
  const f = fixture(); f.channel.type = 'GEMINI';
  await assert.rejects(f.service.create('owner', { prompt: 'test', model: 'logical-image', quality: 'high' }), /不支持此画质/);
  f.channel.type = 'OPENAI';
  await f.service.create('owner', { prompt: 'test', model: 'logical-image', versionName: 'spoofed', quality: 'auto' });
  assert.equal(f.calls.created[0].versionName, 'QGauss Image'); assert.equal(f.calls.created[0].model, 'logical-image');
});

test('画布两边按 16 像素对齐，匹配新图像接口的尺寸约束', () => {
  assert.equal(sizeOf('2:3', '1K'), '688x1024'); assert.equal(sizeOf('16:9', '1K'), '1024x576');
});
