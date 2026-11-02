import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {SqliteClient as PrismaClient} from '../dist/common/prisma/sqlite-client.js';
import { SalesService } from '../dist/modules/commerce/sales.service.js';
import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';

const here = dirname(fileURLToPath(import.meta.url)), folder = mkdtempSync(join(tmpdir(), 'qgauss-referral-'));
execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: join(folder, 'test.db') }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + join(folder, 'test.db').replace(/\\/g, '/') } } });
const values = { 'commerce.defaultCommissionBps': 1250, 'commerce.minWithdrawalCents': 1000, 'commerce.withdrawRateLimit': 9999 };
const settings = { get: async key => values[key] }, sales = new SalesService(prisma, settings, new RateLimitService());
const user = extra => prisma.user.create({ data: { email: randomUUID() + '@qgauss.test', username: randomUUID(), passwordHash: 'isolated fixture', ...extra } });
async function affiliate(cents = 10000) { const a = await user(); await sales.apply(a.id, {}); await prisma.salesUser.update({ where: { userId: a.id }, data: { distributionCents: cents, totalCents: cents } }); return a; }
const choice = extra => ({ amountYuan: '10.00', channels: 1, contact: '合成收款账号-1234', requestKey: randomUUID(), ...extra });
const status = code => error => { assert.equal(error.getStatus(), code); return true; };
function faulty(model, method) {
  const db = new Proxy(prisma, { get(target, key) {
    if (key === '$transaction') return fn => target.$transaction(tx => fn(new Proxy(tx, { get(inner, prop) {
      if (prop === model) return new Proxy(inner[prop], { get(delegate, name) { if (name === method) return async () => { throw new Error('injected failure'); }; const value = delegate[name]; return typeof value === 'function' ? value.bind(delegate) : value; } });
      const value = inner[prop]; return typeof value === 'function' ? value.bind(inner) : value;
    } })));
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  return new SalesService(db, settings, new RateLimitService());
}
after(async () => { await prisma.$disconnect(); assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-referral-')); rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('upgrade from twenty-one retains legacy withdrawal identity, account, amount and state', () => {
  const path = join(folder, 'legacy.db'), migrations = join(here, '../prisma/migrations'), db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE "_migrations" ("name" TEXT PRIMARY KEY NOT NULL,"appliedAt" DATETIME NOT NULL)');
    for (const file of readdirSync(migrations).filter(x => x.endsWith('.sql') && x < '0022').sort()) { db.exec(readFileSync(join(migrations, file), 'utf8')); db.prepare('INSERT INTO "_migrations" VALUES (?,?)').run(file, new Date().toISOString()); }
    db.prepare('INSERT INTO sales_orders (id,userId,amountCents,contact,channels,orderStatus,paymentStatus,createdAt) VALUES (?,?,?,?,?,?,?,?)').run('legacy-referral', 'legacy-owner', 1234, '原合成账号', 3, 1, 0, new Date().toISOString());
  } finally { db.close(); }
  execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: path }, stdio: 'pipe' });
  const upgraded = new DatabaseSync(path);
  try { const row = upgraded.prepare('SELECT * FROM sales_orders WHERE id=?').get('legacy-referral'); assert.equal(row.amountCents, 1234); assert.equal(row.contact, '原合成账号'); assert.equal(row.orderStatus, 1); assert.equal(row.paymentStatus, 0); assert.equal(row.requestKey, null); assert.equal(row.requestHash, ''); assert.equal(upgraded.prepare('SELECT COUNT(*) n FROM _migrations').get().n, readdirSync(migrations).filter(x => x.endsWith('.sql')).length); assert.equal(Object.values(upgraded.prepare('PRAGMA integrity_check').get())[0], 'ok'); }
  finally { upgraded.close(); }
});
test('opening affiliate account is atomic, concurrent and retains a previously assigned rate or suspension', async () => {
  const a = await user();
  await assert.rejects(faulty('salesUser', 'upsert').apply(a.id, {}), /injected/);
  assert.equal((await prisma.user.findUnique({ where: { id: a.id } })).isDistribution, false);
  assert.equal(await prisma.salesUser.count({ where: { userId: a.id } }), 0);
  const results = await Promise.all(Array.from({ length: 4 }, () => sales.apply(a.id, {})));
  assert.equal(new Set(results.map(x => x.inviteCode)).size, 1); assert.equal(await prisma.salesUser.count({ where: { userId: a.id } }), 1);
  await prisma.salesUser.update({ where: { userId: a.id }, data: { performanceBps: 1234, enabled: false } });
  const replay = await sales.apply(a.id, {}); assert.equal(replay.performanceBps, 1234); assert.equal(replay.enabled, false);
});
test('concurrent identical intent freezes once and response retries work after rate limit or suspension', async () => {
  const a = await affiliate(), payload = choice();
  const rows = await Promise.all(Array.from({ length: 4 }, () => sales.withdraw(a.id, payload)));
  assert.equal(new Set(rows.map(x => x.id)).size, 1); assert.equal(await prisma.salesOrder.count({ where: { userId: a.id } }), 1);
  const account = await prisma.salesUser.findUnique({ where: { userId: a.id } }); assert.equal(account.distributionCents, 9000); assert.equal(account.withdrawalCents, 1000);
  assert.equal('requestKey' in rows[0], false); assert.equal('requestHash' in rows[0], false);
  await prisma.salesUser.update({ where: { userId: a.id }, data: { enabled: false } });
  const replay = await sales.withdraw(a.id, payload); assert.equal(replay.id, rows[0].id); assert.equal(replay.reused, true);
  const b = await affiliate(), limited = new SalesService(prisma, { get: async key => key === 'commerce.withdrawRateLimit' ? 1 : values[key] }, new RateLimitService()), key = choice();
  const first = await limited.withdraw(b.id, key); assert.equal((await limited.withdraw(b.id, key)).id, first.id);
  await assert.rejects(limited.withdraw(b.id, choice()), status(429));
});
test('distinct concurrent withdrawals never overdraw commission and preserve available plus committed amounts', async () => {
  const a = await affiliate(5000), results = await Promise.allSettled(Array.from({ length: 4 }, () => sales.withdraw(a.id, choice({ amountYuan: '30' }))));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); for (const result of results.filter(x => x.status === 'rejected')) assert.equal(result.reason.getStatus(), 400);
  const row = await prisma.salesUser.findUnique({ where: { userId: a.id } }); assert.equal(row.distributionCents, 2000); assert.equal(row.withdrawalCents, 3000); assert.equal(row.distributionCents + row.withdrawalCents, row.totalCents);
});
test('intent fingerprint binds the exact normalized choice and lookup is always scoped to its owner', async () => {
  const a = await affiliate(), b = await affiliate(), payload = choice(), first = await sales.withdraw(a.id, payload);
  for (const changed of [{ amountYuan: '11' }, { channels: 2 }, { contact: '另一合成账号' }, { remark: 'changed' }]) await assert.rejects(sales.withdraw(a.id, { ...payload, ...changed }), status(409));
  assert.equal((await sales.withdraw(a.id, { ...payload, amountYuan: 10, contact: '  ' + payload.contact + ' ' })).id, first.id);
  const other = await sales.withdraw(b.id, payload); assert.notEqual(other.id, first.id);
  assert.equal((await sales.withdrawals(a.id, { requestKey: payload.requestKey })).items[0].id, first.id);
  assert.equal((await sales.withdrawals(b.id, { id: first.id })).total, 0);
});
test('invalid money, overflow, malformed scalar fields and too-long accounts never freeze funds', async () => {
  const a = await affiliate();
  for (const bad of [{ amountYuan: '-1' }, { amountYuan: '0' }, { amountYuan: '1.001' }, { amountYuan: '1000000.01' }, { amountYuan: [10] }, { amountYuan: '9.99' }, { channels: [1] }, { channels: true }, { channels: 4 }, { contact: 'a'.repeat(121) }, { contact: 'a\nb' }, { contact: {} }, { requestKey: null }, { requestKey: 'short' }, { remark: ['note'] }]) await assert.rejects(sales.withdraw(a.id, choice(bad)), status(400));
  assert.equal(await prisma.salesOrder.count({ where: { userId: a.id } }), 0); assert.equal((await sales.info(a.id)).distributionCents, 10000);
});
test('withdrawal creation failure rolls back freeze and same-key retry can commit normally', async () => {
  const a = await affiliate(), payload = choice();
  await assert.rejects(faulty('salesOrder', 'create').withdraw(a.id, payload), /injected/);
  const row = await prisma.salesUser.findUnique({ where: { userId: a.id } }); assert.equal(row.distributionCents, 10000); assert.equal(row.withdrawalCents, 0); assert.equal(await prisma.salesOrder.count({ where: { userId: a.id } }), 0);
  assert.ok((await sales.withdraw(a.id, payload)).id);
});
test('audit requires a real boolean and competing rejections return frozen funds exactly once', async () => {
  const a = await affiliate(), first = await sales.withdraw(a.id, choice());
  for (const pass of [undefined, null, 'false', 'true', 0, 1, [], {}]) await assert.rejects(sales.audit(first.id, 'isolated-admin', { pass }), status(400));
  const results = await Promise.allSettled([sales.audit(first.id, 'isolated-admin', { pass: false }), sales.audit(first.id, 'isolated-admin', { pass: false })]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(results.find(x => x.status === 'rejected').reason.getStatus(), 409);
  const info = await sales.info(a.id); assert.equal(info.distributionCents, 10000); assert.equal(info.withdrawalCents, 0); assert.equal(info.withdrawalSummary.rejectedCents, 1000);
});
test('corrupt frozen balance rolls back rejection state instead of producing negative funds', async () => {
  const a = await affiliate(), first = await sales.withdraw(a.id, choice());
  await prisma.salesUser.update({ where: { userId: a.id }, data: { withdrawalCents: 0 } });
  await assert.rejects(sales.audit(first.id, 'isolated-admin', { pass: false }), status(500));
  assert.equal((await prisma.salesOrder.findUnique({ where: { id: first.id } })).orderStatus, 0);
  assert.equal((await prisma.salesUser.findUnique({ where: { userId: a.id } })).distributionCents, 9000);
  await prisma.salesUser.update({ where: { userId: a.id }, data: { withdrawalCents: 1000 } }); await sales.audit(first.id, 'isolated-admin', { pass: false });
});
test('summary separates review, approved unpaid, registered payment and rejection without rewriting legacy counters', async () => {
  const a = await affiliate(5000), rows = [];
  for (let i = 0; i < 4; i++) rows.push(await sales.withdraw(a.id, choice()));
  await sales.audit(rows[1].id, 'isolated-admin', { pass: true, paymentStatus: 0 }); await sales.audit(rows[2].id, 'isolated-admin', { pass: true, paymentStatus: 1 }); await sales.audit(rows[3].id, 'isolated-admin', { pass: false });
  const info = await sales.info(a.id); assert.deepEqual(info.withdrawalSummary, { pendingCents: 1000, approvedUnpaidCents: 1000, paidCents: 1000, rejectedCents: 1000 }); assert.equal(info.withdrawalCents, 3000); assert.equal(info.distributionCents, 2000); assert.deepEqual(info.withdrawalPolicy, { minCents: 1000, maxCents: 100000000 });
  for (const stage of ['pending', 'approved', 'paid', 'rejected']) assert.equal((await sales.withdrawals(a.id, { stage })).total, 1);
});
test('already approved requests can register payment once without moving commission again', async () => {
  const a = await affiliate(), row = await sales.withdraw(a.id, choice()); await sales.audit(row.id, 'isolated-admin', { pass: true, paymentStatus: 0 });
  const before = await prisma.salesUser.findUnique({ where: { userId: a.id } });
  const results = await Promise.allSettled(Array.from({ length: 2 }, () => sales.audit(row.id, 'isolated-admin', { pass: true, paymentStatus: 1 })));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(results.find(x => x.status === 'rejected').reason.getStatus(), 409);
  const after = await prisma.salesUser.findUnique({ where: { userId: a.id } }); assert.equal(after.distributionCents, before.distributionCents); assert.equal(after.withdrawalCents, before.withdrawalCents);
  assert.equal((await sales.withdrawals(a.id, { stage: 'paid' })).items[0].id, row.id);
});
test('full history pagination and search are stable beyond twenty rows, isolated, and reject malformed filters', async () => {
  const a = await affiliate(), b = await affiliate(), date = new Date('2026-10-01T00:00:00Z');
  const rows = Array.from({ length: 29 }, (_, i) => ({ id: 'referral-record-' + a.id + '-' + String(i).padStart(2, '0'), inviterUserId: a.id, inviteeUserId: b.id, orderId: i === 0 ? 'needle-at-the-end' : 'ordinary-' + i, orderCents: 1000, commissionCents: 100, commissionBps: 1000, createdAt: date }));
  await prisma.salesRecord.createMany({ data: rows }); await prisma.salesRecord.create({ data: { inviterUserId: b.id, inviteeUserId: a.id, orderId: 'needle-other-owner', orderCents: 1000, commissionCents: 100, commissionBps: 1000 } });
  const first = await sales.records(a.id, { pageSize: 6 }), second = await sales.records(a.id, { pageSize: 6, page: 2 }); assert.equal(first.total, 29); assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, 12); assert.equal(first.items[0].id, rows[28].id);
  const found = await sales.records(a.id, { keyword: 'needle', pageSize: 6 }); assert.equal(found.total, 1); assert.equal(found.items[0].orderId, 'needle-at-the-end');
  for (const q of [{ keyword: ['needle'] }, { keyword: 'x'.repeat(65) }, { page: Infinity }, { pageSize: {} }]) await assert.rejects(sales.records(a.id, q), status(400));
  for (const q of [{ stage: 'anything' }, { stage: ['paid'] }, { id: {} }, { requestKey: 'short' }, { requestKey: ['x'.repeat(16)] }]) await assert.rejects(sales.withdrawals(a.id, q), status(400));
});
test('disabled, deleted and unqualified accounts cannot create a new withdrawal', async () => {
  for (const field of ['enabled', 'deletedAt', 'isDistribution']) {
    const a = await affiliate();
    if (field === 'enabled') await prisma.salesUser.update({ where: { userId: a.id }, data: { enabled: false } });
    else await prisma.user.update({ where: { id: a.id }, data: { [field]: field === 'deletedAt' ? new Date() : false } });
    await assert.rejects(sales.withdraw(a.id, choice()), status(403)); assert.equal(await prisma.salesOrder.count({ where: { userId: a.id } }), 0);
  }
});
