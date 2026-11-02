import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { LedgerService, shanghaiDate } from '../dist/modules/commerce/ledger.service.js';
import { WalletService } from '../dist/modules/commerce/wallet.service.js';
import { SigninService } from '../dist/modules/commerce/signin.service.js';

const folder = mkdtempSync(join(tmpdir(), 'qgauss-wallet-energy-'));
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: join(folder, 'test.db') }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + join(folder, 'test.db').replace(/\\/g, '/') } } });
const ledger = new LedgerService(prisma);
const values = { 'commerce.signinEnabled': true, 'commerce.signinCount': 3, 'commerce.signinPool': 'model4', 'commerce.currency': 'CNY' };
const settings = { get: async key => values[key] };
const wallet = new WalletService(prisma, ledger, settings);
const signin = new SigninService(prisma, ledger, settings);
const user = () => prisma.user.create({ data: { email: randomUUID() + '@qgauss.test', username: randomUUID(), passwordHash: 'isolated fixture' } });
after(async () => { await prisma.$disconnect(); assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-wallet-energy-')); rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('wallet filters all history on the server, scopes ownership and uses a stable order at equal timestamps', async () => {
  const a = await user(), b = await user(), at = new Date('2026-10-30T00:00:00Z');
  for (let n = 0; n < 6; n++) await prisma.balanceConsumeLog.create({ data: { userId: a.id, direction: n < 4 ? 4 : 5, deductionType: n === 5 ? 'model3' : 'drawMj', amount: 1, balanceKey: 'drawMjCount', modelName: 'QGauss 作品', remark: '能量测试', refId: 'work-' + n, uid: randomUUID(), createdAt: at } });
  await prisma.balanceConsumeLog.create({ data: { userId: b.id, direction: 4, deductionType: 'drawMj', amount: 999, balanceKey: 'drawMjCount', remark: '能量测试', uid: randomUUID(), createdAt: at } });
  const filter = { pageSize: 2, deductionType: 'drawMj', direction: '4', keyword: '能量测试' };
  const first = await wallet.consumeLogs(a.id, filter), second = await wallet.consumeLogs(a.id, { ...filter, page: 2 });
  assert.equal(first.total, 4); assert.equal(second.total, 4);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 4);
  assert.ok([...first.items, ...second.items].every(row => row.userId === a.id && row.amount === 1 && row.direction === 4));
  assert.equal((await wallet.consumeLogs(a.id, { keyword: 'work-2' })).total, 1);
  assert.equal((await wallet.consumeLogs(a.id, { keyword: 'not-in-history' })).total, 0);
});
test('wallet rejects invalid pool/action/search filters before database queries', async () => {
  for (const query of [{ deductionType: 'draw' }, { deductionType: ['model3'] }, { direction: 0 }, { direction: true }, { direction: '1.0' }, { keyword: {} }, { keyword: 'x'.repeat(101) }]) await assert.rejects(() => wallet.consumeLogs('irrelevant', query), e => e.getStatus() === 400);
});
test('recent wallet data preserves reservation links so settlement cannot look like a second debit', async () => {
  const a = await user(); await ledger.grant(a.id, { drawMjCount: 6, rechargeType: 'admin' });
  const refId = randomUUID();
  await prisma.$transaction(tx => ledger.reserveCountTx(tx, a.id, { pool: 'drawMj', amount: 4, refId, bizType: 'draw' }));
  await prisma.$transaction(tx => ledger.settleCountReservationTx(tx, refId, 3));
  const overview = await wallet.overview(a.id);
  assert.equal(overview.counts.drawMj, 3);
  assert.ok(overview.recent.find(row => row.direction === 1).sourceLogId);
  assert.ok(overview.recent.every(row => row.refId === refId));
});
test('failed check-in reward rolls back both the day and ledger, allowing a safe retry', async () => {
  const a = await user();
  const failingLedger = { ensureTx: ledger.ensureTx.bind(ledger), grantTx: async (...args) => { await ledger.grantTx(...args); throw new Error('forced grant failure'); } };
  await assert.rejects(() => new SigninService(prisma, failingLedger, settings).sign(a.id), /forced grant failure/);
  assert.equal(await prisma.signin.count({ where: { userId: a.id } }), 0);
  assert.equal(await prisma.accountLog.count({ where: { userId: a.id } }), 0);
  assert.equal((await ledger.view(a.id)).counts.model4, 0);
  const result = await signin.sign(a.id);
  assert.equal(result.reward, 3); assert.equal(result.counts.model4, 3);
  assert.equal(await prisma.accountLog.count({ where: { userId: a.id, rechargeType: 'signin' } }), 1);
});
test('concurrent daily check-ins grant exactly once, and duplicate retries return 409', async () => {
  const a = await user(), outcomes = await Promise.allSettled([signin.sign(a.id), signin.sign(a.id)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(row => row.status === 'rejected').reason.getStatus(), 409);
  assert.equal((await ledger.view(a.id)).counts.model4, 3);
  assert.equal(await prisma.signin.count({ where: { userId: a.id, signInDate: shanghaiDate() } }), 1);
  assert.equal(await prisma.accountLog.count({ where: { userId: a.id } }), 1);
  await assert.rejects(() => signin.sign(a.id), e => e.getStatus() === 409);
});
test('closed, zero and invalid rewards do not fabricate an award or leave a half-written day', async () => {
  const a = await user();
  values['commerce.signinEnabled'] = false; await assert.rejects(() => signin.sign(a.id), e => e.getStatus() === 404);
  values['commerce.signinEnabled'] = true; values['commerce.signinCount'] = 2147483648;
  await assert.rejects(() => signin.sign(a.id), e => e.getStatus() === 400);
  assert.equal(await prisma.signin.count({ where: { userId: a.id } }), 0);
  values['commerce.signinCount'] = 0; const result = await signin.sign(a.id);
  assert.equal(result.reward, 0); assert.equal((await signin.log(a.id)).signedToday, true);
  assert.equal(await prisma.accountLog.count({ where: { userId: a.id } }), 0);
  values['commerce.signinCount'] = 3;
});
test('calendar remains bounded while a real streak longer than sixty days is counted accurately', async () => {
  const a = await user(), today = shanghaiDate(), cursor = new Date(today + 'T00:00:00Z');
  const dates = Array.from({ length: 66 }, (_, i) => ({ userId: a.id, signInDate: new Date(cursor.getTime() - i * 86400000).toISOString().slice(0, 10), reward: 0 }));
  await prisma.signin.createMany({ data: dates });
  let status = await signin.log(a.id); assert.equal(status.items.length, 60); assert.equal(status.streak, 66);
  await prisma.signin.deleteMany({ where: { userId: a.id, signInDate: dates[62].signInDate } });
  status = await signin.log(a.id); assert.equal(status.streak, 62);
});
