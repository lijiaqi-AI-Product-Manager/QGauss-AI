/** Real migrated SQLite transactions; no provider, SMTP or external storage. */
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { LedgerService } from '../dist/modules/commerce/ledger.service.js';
import { ImageAccountingService } from '../dist/modules/image/image-accounting.service.js';
import { ImageService } from '../dist/modules/image/image.service.js';
import { ImageWorker } from '../dist/modules/image/image.worker.js';
import { ImageRunsService } from '../dist/modules/image/image-runs.service.js';

const here = dirname(fileURLToPath(import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'qgauss-image-accounting-'));
const database = join(folder, 'test.db');
execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: database }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + database.replace(/\\/g, '/') } } });
afterEach(async () => {
  const cleanup = new ImageAccountingService(prisma, new LedgerService(prisma), {});
  for (const task of await prisma.imageTask.findMany({ where: { status: { in: ['QUEUED', 'RUNNING', 'SETTLING'] } } })) {
    await cleanup.stop(task.id, 'CANCELED', '隔离测试结束，释放未使用预留', undefined, true);
  }
});
after(async () => {
  await prisma.$disconnect();
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-image-accounting-')) throw new Error('Test cleanup escaped its temporary root');
  rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function fixture(grant = { drawMjCount: 30 }) {
  const id = randomUUID();
  const user = await prisma.user.create({ data: { email: id + '@qgauss.test', username: id, passwordHash: 'local fixture only' } });
  const ledger = new LedgerService(prisma);
  await ledger.grant(user.id, { ...grant, rechargeType: 'admin' });
  const config = { 'commerce.enabled': true, 'demo.siteEnabled': false, 'commerce.imageCost': 1 };
  const settings = { get: async key => config[key] };
  const accounting = new ImageAccountingService(prisma, ledger, settings);
  const runs = new ImageRunsService();
  const files = new Map(), removed = [];
  const storage = {
    read: async fileId => { if (!files.has(fileId)) { const error = new Error('missing file'); error.code = 'ENOENT'; throw error; } return { buffer: Buffer.from('local image'), mime: 'image/png' }; },
    remove: async fileId => { removed.push(fileId); files.delete(fileId); },
  };
  const models = { resolveRoute: async name => ({ model: { name, displayName: 'QGauss 事务测试', capabilities: 'image' }, channels: [{ type: 'MOCK', upstreamName: 'local-image' }] }) };
  const service = new ImageService(prisma, settings, accounting, { check: async () => null }, storage, models, runs);
  const create = async extra => service.create(user.id, { prompt: 'QGauss local transaction test', model: 'local-image', ...extra });
  const stage = async (id, count) => {
    const results = Array.from({ length: count }, () => { const fileId = randomUUID(); files.set(fileId, true); return { fileId, url: '/api/upload/' + fileId + '/raw', mime: 'image/png' }; });
    await prisma.imageTask.update({ where: { id }, data: { status: 'RUNNING' } });
    assert.equal(await accounting.stage(id, results), true);
    return results;
  };
  const logs = refId => prisma.balanceConsumeLog.findMany({ where: { refId } });
  return { user, ledger, accounting, service, settings, config, runs, storage, models, files, removed, create, stage, logs };
}

test('并发接受任务在同一事务预留次数，不透支，也不提前计入使用量', async () => {
  const f = await fixture({ drawMjCount: 6 });
  const answers = await Promise.allSettled([f.create({ n: 4 }), f.create({ n: 4 })]);
  assert.equal(answers.filter(r => r.status === 'fulfilled').length, 1);
  const denied = answers.find(r => r.status === 'rejected');
  assert.equal(denied.reason.getStatus(), 402);
  const view = await f.ledger.view(f.user.id);
  assert.equal(view.counts.drawMj, 2); assert.equal(view.reserved.drawMj, 4); assert.equal(view.used.drawMj, 0);
  assert.equal(await prisma.imageTask.count({ where: { userId: f.user.id } }), 1);
});

test('金额只扣一次，余额刚好够用不变负数，退款守恒且幂等', async () => {
  const f = await fixture({ amountCents: 300 });
  const refId = 'money-once-' + f.user.id;
  await f.ledger.consume(f.user.id, { cents: 300, bizType: 'chat', refId });
  assert.equal((await f.ledger.view(f.user.id)).balanceCents, 0);
  assert.equal((await f.logs(refId)).filter(row => row.direction === 1).reduce((n, row) => n + row.amount, 0), 300);
  await f.ledger.refundByRef(refId); await f.ledger.refundByRef(refId);
  assert.equal((await f.ledger.view(f.user.id)).balanceCents, 300);
});

test('并发金额消费不透支，次数与金额混合消费失败时全部回滚', async () => {
  const f = await fixture({ amountCents: 150, drawMjCount: 4 });
  const results = await Promise.allSettled([1, 2].map(i => f.ledger.consume(f.user.id, { cents: 100, bizType: 'chat', refId: 'money-race-' + f.user.id + i })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.getStatus(), 402);
  assert.equal((await f.ledger.view(f.user.id)).balanceCents, 50);
  const refId = 'mixed-rollback-' + f.user.id;
  await assert.rejects(f.ledger.consume(f.user.id, { pool: 'drawMj', amount: 2, cents: 60, bizType: 'chat', refId }), e => e.getStatus() === 402);
  const view = await f.ledger.view(f.user.id);
  assert.equal(view.counts.drawMj, 4); assert.equal(view.used.drawMj, 0); assert.equal(view.balanceCents, 50);
  assert.equal((await f.logs(refId)).length, 0);
});

test('创建后的异常回滚任务、预留、可用额度和预留流水', async () => {
  const f = await fixture({ drawMjCount: 8 });
  const original = f.ledger.reserveCountTx.bind(f.ledger);
  f.ledger.reserveCountTx = async (...args) => { await original(...args); throw new Error('injected create failure'); };
  await assert.rejects(f.create({ n: 2 }), /injected create failure/);
  assert.equal(await prisma.imageTask.count({ where: { userId: f.user.id } }), 0);
  assert.equal(await prisma.countReservation.count({ where: { userId: f.user.id } }), 0);
  assert.equal(await prisma.balanceConsumeLog.count({ where: { userId: f.user.id } }), 0);
  assert.equal((await f.ledger.view(f.user.id)).counts.drawMj, 8);
});

test('前端报价过期时拒绝接受新费用，不创建任务或占用次数', async () => {
  const f = await fixture({ drawMjCount: 8 });
  await assert.rejects(f.create({ expectedUnitCost: 0 }), e => e.getStatus() === 409);
  assert.equal(await prisma.imageTask.count({ where: { userId: f.user.id } }), 0);
  assert.equal((await f.ledger.view(f.user.id)).counts.drawMj, 8);
});

test('非法站点次数费用不会被当成免费或接受后再报错', async () => {
  const f = await fixture(); f.config['commerce.imageCost'] = 0.5;
  await assert.rejects(f.create({ quality: 'high' }), /费用配置无效/);
  assert.equal(await prisma.imageTask.count({ where: { userId: f.user.id } }), 0);
});

test('部分成功按锁定单价结算，未使用部分释放，重复完成不多记账', async () => {
  const f = await fixture(); f.config['commerce.imageCost'] = 3;
  const task = await f.create({ n: 3, quality: 'high' });
  assert.equal(task.billing.unitCost, 6); assert.equal(task.billing.reserved, 18);
  await f.stage(task.id, 2); await f.accounting.complete(task.id); await f.accounting.complete(task.id);
  const detail = await f.service.detail(f.user.id, task.id), view = await f.ledger.view(f.user.id), logs = await f.logs(task.id);
  assert.equal(detail.status, 'SUCCESS'); assert.equal(detail.billing.charged, 12); assert.equal(detail.billing.returned, 6);
  assert.equal(view.counts.drawMj, 18); assert.equal(view.reserved.drawMj, 0); assert.equal(view.used.drawMj, 12);
  assert.equal(logs.filter(l => l.direction === 1).reduce((n, l) => n + l.amount, 0), 12);
  assert.equal(logs.filter(l => l.direction === 5).reduce((n, l) => n + l.amount, 0), 6);
  assert.equal((await prisma.imageTaskEvent.findMany({ where: { taskId: task.id, status: 'SUCCESS' } })).length, 1);
});

test('结算中途失败时，成功状态、用量、流水与释放全部回滚，可继续原作品结算', async () => {
  const f = await fixture({ drawMjCount: 10 });
  const task = await f.create({ n: 3 }); await f.stage(task.id, 2);
  const original = f.ledger.settleCountReservationTx.bind(f.ledger);
  f.ledger.settleCountReservationTx = async (...args) => { await original(...args); throw new Error('injected settlement failure'); };
  await assert.rejects(f.accounting.complete(task.id), /injected settlement failure/);
  const pending = await f.service.detail(f.user.id, task.id), view = await f.ledger.view(f.user.id);
  assert.equal(pending.status, 'SETTLING'); assert.equal(pending.results.length, 0);
  assert.equal(view.counts.drawMj, 7); assert.equal(view.reserved.drawMj, 3); assert.equal(view.used.drawMj, 0);
  assert.equal((await f.logs(task.id)).filter(l => l.direction === 1 || l.direction === 5).length, 0);
  const file = JSON.parse((await prisma.imageTask.findUnique({ where: { id: task.id } })).resultJson)[0];
  await assert.rejects(f.service.result(f.user.id, task.id, file.fileId), e => e.getStatus() === 404);
  f.ledger.settleCountReservationTx = original;
  assert.equal(await f.accounting.complete(task.id), true);
  assert.equal((await f.ledger.view(f.user.id)).counts.drawMj, 8);
});

test('已接受任务的价格和免费状态不会被后续站点改价或开关改变', async () => {
  const f = await fixture({ drawMjCount: 20 });
  const paid = await f.create({ n: 2, quality: 'high' });
  f.config['commerce.enabled'] = false; f.config['commerce.imageCost'] = 9;
  await f.stage(paid.id, 1); await f.accounting.complete(paid.id);
  assert.equal((await f.service.detail(f.user.id, paid.id)).billing.charged, 2);
  const free = await f.create({ n: 2 });
  f.config['commerce.enabled'] = true;
  await f.stage(free.id, 2); await f.accounting.complete(free.id);
  assert.equal((await f.service.detail(f.user.id, free.id)).billing.state, 'FREE');
  assert.equal((await f.logs(free.id)).length, 0);
  assert.equal((await f.ledger.view(f.user.id)).counts.drawMj, 18);
});

test('失败和重复取消仅释放一次，已保存待结算作品不再接受取消', async () => {
  const f = await fixture({ drawMjCount: 8 });
  const canceled = await f.create({ n: 3 });
  await f.service.cancel(f.user.id, canceled.id);
  await assert.rejects(f.service.cancel(f.user.id, canceled.id), e => e.getStatus() === 400);
  assert.equal((await f.ledger.view(f.user.id)).counts.drawMj, 8);
  const failed = await f.create({ n: 2 }); await f.accounting.stop(failed.id, 'FAILED', 'local failure');
  assert.equal((await f.ledger.view(f.user.id)).counts.drawMj, 8);
  const settling = await f.create({ n: 2 }); await f.stage(settling.id, 2);
  await assert.rejects(f.service.cancel(f.user.id, settling.id), /正在保存与结算/);
  assert.equal((await f.ledger.view(f.user.id)).reserved.drawMj, 2);
});

test('跨北京时间午夜释放旧会员预留，不把旧额度加入新一天', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T15:59:59Z') });
  const f = await fixture({ drawMjCount: 5, days: 2, dailyDrawMjCount: 5 });
  const task = await f.create({ n: 4 });
  t.mock.timers.tick(2000);
  await f.service.cancel(f.user.id, task.id);
  const view = await f.ledger.view(f.user.id), detail = await f.service.detail(f.user.id, task.id);
  assert.equal(view.member.drawMj, 5); assert.equal(view.paid.drawMj, 5);
  assert.equal(detail.billing.expired, 4); assert.equal(detail.billing.returned, 0);
});

test('会员到期后仅返还预留的购买次数，不复活已到期会员额度', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T08:00:00Z') });
  const f = await fixture({ drawMjCount: 5, days: 1, dailyDrawMjCount: 2 });
  await prisma.userBalance.update({ where: { userId: f.user.id }, data: { expirationTime: new Date(Date.now() + 1000) } });
  const task = await f.create({ n: 4 });
  t.mock.timers.tick(2000); await f.service.cancel(f.user.id, task.id);
  const view = await f.ledger.view(f.user.id), detail = await f.service.detail(f.user.id, task.id);
  assert.equal(view.member.drawMj, 0); assert.equal(view.paid.drawMj, 5);
  assert.equal(detail.billing.expired, 2); assert.equal(detail.billing.returned, 2);
});

test('跨日并发查看、消费与新预留共享同一份每日额度', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T15:59:59Z') });
  const f = await fixture({ days: 2, dailyDrawMjCount: 4 });
  await f.create({ n: 2 }); t.mock.timers.tick(2000);
  await Promise.all([f.ledger.view(f.user.id), f.ledger.consume(f.user.id, { pool: 'drawMj', amount: 2, bizType: 'draw', refId: 'other-consumer-' + f.user.id }), f.create({ n: 2 })]);
  const final = await f.ledger.view(f.user.id);
  assert.equal(final.member.drawMj, 0); assert.equal(final.reserved.drawMj, 4); assert.equal(final.used.drawMj, 2);
});

test('重启收尾中断任务并恢复已保存作品的结算，不重复调用上游', async () => {
  const f = await fixture({ drawMjCount: 10 });
  const interrupted = await f.create({ n: 2 }); await prisma.imageTask.update({ where: { id: interrupted.id }, data: { status: 'RUNNING' } });
  const saved = await f.create({ n: 3 }); await f.stage(saved.id, 2);
  let providerCalls = 0;
  const worker = new ImageWorker(prisma, f.settings, f.storage, { generate: async () => { providerCalls++; throw new Error('Must not replay provider'); } }, {}, f.accounting, {}, f.models, f.runs);
  try {
    await worker.onModuleInit();
    for (let i = 0; i < 30; i++) {
      if ((await f.service.detail(f.user.id, saved.id)).status === 'SUCCESS') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await f.service.detail(f.user.id, interrupted.id)).status, 'FAILED');
    assert.equal((await f.service.detail(f.user.id, saved.id)).status, 'SUCCESS');
    assert.equal(providerCalls, 0);
    const view = await f.ledger.view(f.user.id);
    assert.equal(view.counts.drawMj, 8); assert.equal(view.used.drawMj, 2); assert.equal(view.reserved.drawMj, 0);
  } finally { await worker.onModuleDestroy(); }
});

test('已保存作品缺少实际文件时释放预留，不能公布成功结果', async () => {
  const f = await fixture({ drawMjCount: 5 });
  const task = await f.create({ n: 2 }); const files = await f.stage(task.id, 2); f.files.delete(files[0].fileId);
  const worker = new ImageWorker(prisma, f.settings, f.storage, {}, {}, f.accounting, {}, f.models, f.runs);
  await worker.resumeSettlement(task.id);
  assert.equal((await f.service.detail(f.user.id, task.id)).status, 'FAILED');
  assert.equal((await f.ledger.view(f.user.id)).counts.drawMj, 5);
});

test('旧排队任务在调用上游前冻结首次价格，历史成功作品不补扣', async () => {
  const f = await fixture({ drawMjCount: 10 });
  const legacy = await prisma.imageTask.create({ data: { userId: f.user.id, prompt: 'legacy', status: 'RUNNING', n: 2 } });
  const prepared = await f.accounting.prepare(legacy.id);
  assert.equal(prepared.billingUnitCost, 1); assert.equal(prepared.reservedAmount, 2);
  const historical = await prisma.imageTask.create({ data: { userId: f.user.id, prompt: 'historical', status: 'SUCCESS' } });
  assert.equal((await f.accounting.prepare(historical.id)).billingState, 'LEGACY');
  assert.equal((await f.logs(historical.id)).length, 0);
});

test('0020 升级保留旧作品、余额和账本，重复执行迁移不重复修改', () => {
  const legacyFile = join(folder, 'legacy.db'), migrations = join(here, '../prisma/migrations');
  let db = new DatabaseSync(legacyFile);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL, appliedAt DATETIME NOT NULL)');
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql') && name < '0020').sort()) {
    db.exec(readFileSync(join(migrations, file), 'utf8'));
    db.prepare('INSERT INTO _migrations(name,appliedAt) VALUES (?,?)').run(file, new Date().toISOString());
  }
  const at = new Date().toISOString();
  db.prepare('INSERT INTO users(id,email,username,passwordHash,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run('old-owner', 'upgrade@qgauss.test', 'qgauss-upgrade', 'fixture', at, at);
  db.prepare('INSERT INTO image_tasks(id,userId,prompt,status,n,resultJson,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('old-art', 'old-owner', 'QGauss 旧作品', 'SUCCESS', 2, '[{"fileId":"old-output"}]', at, at);
  db.prepare('INSERT INTO user_balances(id,userId,drawMjCount,createdAt,updatedAt) VALUES (?,?,?,?,?)').run('old-balance', 'old-owner', 12, at, at);
  db.prepare('INSERT INTO balance_consume_logs(id,userId,deductionType,amount,balanceKey,refId,uid,createdAt) VALUES (?,?,?,?,?,?,?,?)').run('old-log', 'old-owner', 'drawMj', 2, 'drawMjCount', 'old-art', 'old-uid', at);
  db.close();
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: legacyFile }, stdio: 'pipe' });
  db = new DatabaseSync(legacyFile);
  try {
    const art = db.prepare('SELECT * FROM image_tasks WHERE id=?').get('old-art');
    assert.equal(art.prompt, 'QGauss 旧作品'); assert.equal(art.resultJson, '[{"fileId":"old-output"}]');
    assert.equal(art.billingState, 'LEGACY'); assert.equal(art.billingUnitCost, null);
    assert.equal(db.prepare('SELECT drawMjCount AS n FROM user_balances').get().n, 12);
    assert.equal(db.prepare('SELECT amount,refId FROM balance_consume_logs').get().amount, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM count_reservations').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n, readdirSync(migrations).filter(name => name.endsWith('.sql')).length);
  } finally { db.close(); }
});
