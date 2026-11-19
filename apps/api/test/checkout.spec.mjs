import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {SqliteClient as PrismaClient} from '../dist/common/prisma/sqlite-client.js';
import { OrderService } from '../dist/modules/commerce/order.service.js';
import { PayService } from '../dist/modules/commerce/pay.service.js';
import { CramiService } from '../dist/modules/commerce/crami.service.js';
import { LedgerService } from '../dist/modules/commerce/ledger.service.js';
import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';
import { PaymentStatementService } from '../dist/modules/commerce/payment-statement.service.js';
import { paymentStatementInput, paymentStatementPreview } from '../dist/modules/commerce/payment-statement-input.js';

const folder = mkdtempSync(join(tmpdir(), 'qgauss-checkout-'));
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: join(folder, 'test.db') }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + join(folder, 'test.db').replace(/\\/g, '/') } } });
const values = { 'commerce.orderTimeoutMinutes': 30, 'commerce.orderRateLimit': 9999, 'commerce.payProviders': 'mock', 'commerce.mockPayRateLimit': 9999, 'commerce.defaultCommissionBps': 0, 'site.baseUrl': 'https://qgauss.example', 'commerce.payNotifyBaseUrl': 'https://qgauss.example' };
const settings = { get: async key => values[key] }, rate = new RateLimitService(), ledger = new LedgerService(prisma), orders = new OrderService(prisma, settings, rate), pay = new PayService(prisma, settings, ledger, rate), crami = new CramiService(prisma, ledger, settings, rate);
const user = () => prisma.user.create({ data: { email: randomUUID() + '@qgauss.test', username: randomUUID(), passwordHash: 'isolated fixture' } });
const pkg = (extra = {}) => crami.createPackage({ name: '灵感补给 ' + randomUUID(), priceYuan: '19.90', days: 30, model3Count: 10, model4Count: 5, drawMjCount: 3, agentCount: 2, ...extra });
const intent = offer => ({ goodsType: 'package', goodsId: offer.id, expectedOfferRevision: offer.offerRevision, requestKey: randomUUID() });
const statementHeader = '记录类型,渠道流水号,订单号,交易号,发生时间,金额（分）,手续费（分）';
const statementFile = (...rows) => Buffer.from('\uFEFF' + [statementHeader, ...rows].join('\r\n') + '\r\n');
after(async () => { await prisma.$disconnect(); assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-checkout-')); rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('upgrade from migration twenty preserves legacy order amounts and leaves missing snapshots explicit', () => {
  const legacyFile=join(folder,'legacy.db'),db=new DatabaseSync(legacyFile),migrations=join(dirname(fileURLToPath(import.meta.url)),'../prisma/migrations');
  try {
  db.exec('CREATE TABLE "_migrations" ("name" TEXT PRIMARY KEY NOT NULL,"appliedAt" DATETIME NOT NULL)');
  for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')&&name<'0021').sort()){
    db.exec(readFileSync(join(migrations,file),'utf8'));
    db.prepare('INSERT INTO "_migrations" ("name","appliedAt") VALUES (?,?)').run(file,new Date().toISOString());
  }
  const at=new Date().toISOString();
  db.prepare('INSERT INTO "orders" ("id","orderId","userId","goodsId","goodsName","priceCents","totalCents","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)').run('legacy-id','legacy-public-order','legacy-user','legacy-offer','原订单',1990,1990,at,at);
  } finally { db.close(); }
  execFileSync(process.execPath,[join(dirname(fileURLToPath(import.meta.url)),'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:legacyFile},stdio:'pipe'});
  const upgraded=new DatabaseSync(legacyFile);
  try{
    const row=upgraded.prepare('SELECT * FROM "orders" WHERE "id"=?').get('legacy-id');
    assert.equal(row.totalCents,1990);assert.equal(row.goodsName,'原订单');assert.equal(row.requestKey,null);assert.equal(row.goodsSnapshot,'');assert.equal(row.expiresAt,null);
    assert.equal(upgraded.prepare('SELECT COUNT(*) n FROM "_migrations"').get().n,readdirSync(migrations).filter(name=>name.endsWith('.sql')).length);
    assert.equal(Object.values(upgraded.prepare('PRAGMA integrity_check').get())[0],'ok');
  }finally{upgraded.close();}
});

test('accepted package entitlements and name survive edits, delisting and physical package removal', async () => {
  const a = await user(), offer = await pkg(), order = await orders.create(a.id, intent(offer));
  assert.equal(order.entitlements.model3Count, 10); assert.equal(order.entitlements.days, 30); assert.equal(order.totalCents, 1990);
  await crami.updatePackage(offer.id, { priceYuan: '99.00', model3Count: 999, days: 3, name: '已更改套餐' });
  await crami.removePackage(offer.id); await prisma.cramiPackage.delete({ where: { id: offer.id } });
  assert.equal((await pay.mockPay(a.id, order.orderId)).status, 1);
  const balance = await ledger.view(a.id); assert.equal(balance.counts.model3, 10); assert.equal(balance.counts.model4, 5);
  const grant = await prisma.accountLog.findFirst({ where: { userId: a.id } });
  assert.equal(grant.pkgName, offer.name); assert.equal(grant.days, 30);
});
test('same client intent replays exactly one order across concurrent calls and later offer changes', async () => {
  const a = await user(), offer = await pkg(), request = intent(offer);
  const results = await Promise.all(Array.from({ length: 4 }, () => orders.create(a.id, request)));
  assert.equal(new Set(results.map(result => result.orderId)).size, 1);
  assert.equal(await prisma.order.count({ where: { userId: a.id } }), 1);
  await crami.updatePackage(offer.id, { model3Count: 99, priceYuan: '29.90' });
  const retry = await orders.create(a.id, request);
  assert.equal(retry.reused, true); assert.equal(retry.totalCents, 1990); assert.equal(retry.entitlements.model3Count, 10);
});
test('intent reuse cannot change the selection and the same key is isolated by account', async () => {
  const a = await user(), b = await user(), key = randomUUID();
  const request = { goodsType: 'money', amountYuan: '1.01', requestKey: key };
  const original = await orders.create(a.id, request);
  await assert.rejects(() => orders.create(a.id, { ...request, amountYuan: '9.00' }), e => e.getStatus() === 409);
  const other = await orders.create(b.id, request);
  assert.notEqual(original.orderId, other.orderId);
  await assert.rejects(() => orders.detail(b.id, original.orderId, false), e => e.getStatus() === 404);
  await assert.rejects(() => pay.prepare(b.id, original.orderId), e => e.getStatus() === 404);
});
test('changed entitlements at the same price require confirmation, without creating a stray order', async () => {
  const a = await user(), offer = await pkg(), request = intent(offer);
  await crami.updatePackage(offer.id, { days: 7, model3Count: 1 });
  await assert.rejects(() => orders.create(a.id, request), e => e.getStatus() === 409);
  assert.equal(await prisma.order.count({ where: { userId: a.id } }), 0);
  const latest = (await crami.publicPackages()).items.find(row => row.id === offer.id);
  const accepted = await orders.create(a.id, intent(latest));
  assert.equal(accepted.entitlements.days, 7); assert.equal(accepted.entitlements.model3Count, 1);
});
test('zero, overflowing and malformed orders reject at the boundary before persistence', async () => {
  const a = await user(), offer = await pkg({ priceCents: 100000000, priceYuan: '' });
  for (const request of [{ goodsType: 'money', amountYuan: '0' }, { goodsType: 'money', amountYuan: '21474836.48' }, { goodsType: 'money', amountYuan: '1.001' }, { goodsType: 'money', amountYuan: '1', requestKey: null }, { ...intent(offer), expectedOfferRevision: false }, { ...intent(offer), count: 99 }]) await assert.rejects(() => orders.create(a.id, request), e => e.getStatus() === 400);
  assert.equal(await prisma.order.count({ where: { userId: a.id } }), 0);
});
test('a persisted deadline is unaffected by settings changes and status reads close expired orders', async () => {
  const a = await user(), order = await orders.create(a.id, { goodsType: 'money', amountYuan: '2.00' });
  const expiry = new Date(order.expiresAt).getTime(); values['commerce.orderTimeoutMinutes'] = 1;
  assert.equal(new Date((await orders.detail(a.id, order.orderId, false)).expiresAt).getTime(), expiry);
  await prisma.order.update({ where: { orderId: order.orderId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await pay.status(a.id, order.orderId, false)).status, 3);
  await assert.rejects(() => pay.prepare(a.id, order.orderId), e => e.getStatus() === 409);
  await assert.rejects(() => pay.mockPay(a.id, order.orderId), e => e.getStatus() === 409);
  assert.equal((await ledger.view(a.id)).balanceCents, 0); values['commerce.orderTimeoutMinutes'] = 30;
});
test('expiration is checked inside fulfillment even when payment was prepared before the deadline', async () => {
  const a = await user(), order = await orders.create(a.id, { goodsType: 'money', amountYuan: '2.00' });
  await pay.prepare(a.id, order.orderId);
  const row = await prisma.order.update({ where: { orderId: order.orderId }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal(await pay.fulfill(row, 'mock', 'TEST-EXPIRED'), false);
  assert.equal((await pay.status(a.id, order.orderId, false)).status, 3);
  assert.equal(await prisma.accountLog.count({ where: { userId: a.id } }), 0);
});
test('grant failures roll back paid status, balance and receipts, then a retry grants only the frozen amount', async () => {
  const a = await user(), offer = await pkg(), order = await orders.create(a.id, intent(offer));
  const row = await prisma.order.findUnique({ where: { orderId: order.orderId } });
  const failingLedger = { ensureTx: ledger.ensureTx.bind(ledger), grantTx: async (...args) => { await ledger.grantTx(...args); throw new Error('forced fulfillment failure'); } };
  const faulty = new PayService(prisma, settings, failingLedger, rate);
  await assert.rejects(() => faulty.fulfill(row, 'mock', 'TEST-FAIL'), /forced fulfillment failure/);
  assert.equal((await orders.detail(a.id, order.orderId, false)).status, 0);
  assert.equal(await prisma.accountLog.count({ where: { userId: a.id } }), 0);
  assert.equal((await ledger.view(a.id)).counts.model3, 0);
  assert.equal(await pay.fulfill(row, 'mock', 'TEST-RETRY'), true);
  assert.equal(await pay.fulfill(row, 'mock', 'TEST-AGAIN'), false);
  assert.equal((await ledger.view(a.id)).counts.model3, 10);
});
test('corrupt nonlegacy snapshots fail closed, while legacy orders are clearly identified', async () => {
  const a = await user(), offer = await pkg(), order = await orders.create(a.id, intent(offer));
  const corrupted = await prisma.order.update({ where: { orderId: order.orderId }, data: { goodsSnapshot: '{"version":9}' } });
  await assert.rejects(() => pay.fulfill(corrupted, 'mock', 'TEST-CORRUPT'), e => e.getStatus() === 500);
  assert.equal((await prisma.order.findUnique({ where: { orderId: order.orderId } })).status, 0);
  await prisma.order.update({ where: { orderId: order.orderId }, data: { goodsSnapshot: '' } });
  const legacy = await orders.detail(a.id, order.orderId, false);
  assert.equal(legacy.legacyEntitlements, true); assert.equal(legacy.entitlements, null);
  assert.equal((await pay.mockPay(a.id, order.orderId)).paid, true);
});

test('verified notices remain traceable and duplicate confirmations record one delivery', async () => {
  const buyer = await user();
  const created = await orders.create(buyer.id, { goodsType: 'money', amountYuan: '13.50' });
  const { orderId } = created;
  const event = { ok: true, orderId, tradeId: 'sample-receipt', amountCents: 1350 };
  let incoming = event;
  const service = new PayService(prisma, settings, ledger, rate);
  service.verify = async () => incoming;

  const send = () => service.notify('epay', { sample: 'internal fixture metadata' }, '192.0.2.15');
  const results = await Promise.all([send(), send(), send()]);
  assert.equal(results.filter(result => result.fulfilled).length, 1);
  assert.ok(results.every(result => result.ok));
  assert.equal((await ledger.view(buyer.id)).balanceCents, 1350);

  let review = await orders.review(orderId);
  assert.equal(review.state, 'matched');
  assert.equal(review.matchedNotification, true);
  assert.equal(review.grants.length, 1);
  assert.deepEqual(review.expectedGrant, { amountCents: 1350 });
  assert.ok(review.notices.every(notice => notice.verified && notice.handled));
  assert.ok(review.notices.every(notice => !('raw' in notice) && !('ip' in notice) && !('error' in notice)));

  incoming = { ...event, amountCents: 1500 };
  assert.equal((await send()).ok, false);
  assert.equal(await prisma.payNotify.count({ where: { orderId, amountCents: 1500, verified: true, handled: false } }), 1);
  assert.equal((await ledger.view(buyer.id)).balanceCents, 1350);

  // Archived events can disagree with the stored order, even outside the displayed window.
  const source = { orderId, tradeId: 'archived-receipt', provider: 'epay', amountCents: 1350, verified: true };
  await prisma.payNotify.create({ data: { ...source, createdAt: new Date('2024-01-01T00:00:00Z') } });
  await prisma.payNotify.createMany({
    data: Array.from({ length: 15 }, () => ({
      ...source, verified: false, raw: 'private fixture', ip: '192.0.2.20', createdAt: new Date(Date.now() + 1000),
    })),
  });
  review = await orders.review(orderId);
  assert.equal(review.state, 'attention');
  assert.match(review.findings.join(' '), /交易号不符/);
  assert.equal(review.matchedNotification, true);
  assert.equal(review.notices.length, 12);
  assert.equal(review.moreNotices, true);
  assert.ok(review.notices.every(notice => notice.amountCents === null && notice.tradeId === null));
});

test('verified notice for an expired order is available for review without granting anything', async () => {
  const buyer = await user();
  const { orderId } = await orders.create(buyer.id, { goodsType: 'money', amountYuan: '2.00' });
  await prisma.order.update({ where: { orderId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const service = new PayService(prisma, settings, ledger, rate);
  service.verify = async () => ({ ok: true, orderId, tradeId: 'expired-receipt', amountCents: 200 });
  const confirmation = await service.notify('epay', {}, '192.0.2.16');
  assert.equal(confirmation.ok, false);
  const review = await orders.review(orderId);
  assert.equal(review.order.status, 3);
  assert.equal(review.state, 'attention');
  assert.equal(review.grants.length, 0);
  assert.match(review.findings.join(' '), /尚未记为已支付/);
  assert.deepEqual(review.notices.map(({ verified, handled, amountCents }) => ({ verified, handled, amountCents })), [
    { verified: true, handled: false, amountCents: 200 },
  ]);
});

test('order review detects missing historical evidence and does not hide a damaged snapshot', async () => {
  const buyer = await user();
  const product = await pkg();
  const { orderId } = await orders.create(buyer.id, intent(product));
  await pay.mockPay(buyer.id, orderId);
  assert.equal((await orders.review(orderId)).state, 'demo');

  await prisma.accountLog.updateMany({ where: { userId: buyer.id }, data: { model3Count: 1 } });
  assert.match((await orders.review(orderId)).findings.join(' '), /实际到账与下单权益不符/);
  await prisma.order.update({ where: { orderId }, data: { status: 4, goodsSnapshot: '' } });
  const legacy = await orders.review(orderId);
  assert.equal(legacy.order.legacyEntitlements, true);
  assert.match(legacy.findings.join(' '), /旧订单缺少下单权益快照.*退款凭证/);

  await prisma.order.update({ where: { orderId }, data: { goodsSnapshot: '{' } });
  const damaged = await orders.review(orderId);
  assert.match(damaged.findings.join(' '), /快照无法读取/);
  const list = await orders.manage({ keyword: orderId });
  assert.equal(list.items[0].orderId, orderId);
  assert.equal(list.items[0].entitlements, null);
});

test('admin order totals use the complete date and platform filter and separate demo collections', async () => {
  const buyer = await user();
  const records = [
    ['before', '2026-04-08T15:59:59Z', 'epay', 1, 1499],
    ['opening', '2026-04-08T16:00:00Z', 'epay', 1, 2250],
    ['end', '2026-04-09T15:59:59Z', 'hupi', 1, 3000],
    ['demo', '2026-04-09T10:00:00Z', 'mock', 1, 731],
    ['after', '2026-04-09T16:00:00Z', 'epay', 1, 999],
  ];
  const prefix = randomUUID();
  await prisma.order.createMany({
    data: records.map(([suffix, createdAt, payPlatform, status, totalCents]) => ({
      orderId: prefix + '-' + suffix, userId: buyer.id, goodsId: 'fixture', goodsType: 'money',
      createdAt: new Date(createdAt), payPlatform, status, totalCents, priceCents: totalCents,
    })),
  });
  const filters = { fromDay: '2026-04-09', throughDay: '2026-04-09', userId: buyer.id };
  const list = await orders.manage({ ...filters, pageSize: 1 });
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].orderId, prefix + '-end');
  assert.equal(list.total, 3);
  assert.deepEqual(list.overview, { paidCents: 5250, demoCents: 731, waitingCount: 0 });
  const onlyDemo = await orders.manage({ ...filters, platform: 'mock', status: '1' });
  assert.equal(onlyDemo.total, 1);
  assert.deepEqual(onlyDemo.overview, { paidCents: 0, demoCents: 731, waitingCount: 0 });
  await assert.rejects(() => orders.manage({ fromDay: '2026-02-30' }), error => error.getStatus() === 400);
  await assert.rejects(() => orders.manage({ ...filters, throughDay: '2026-04-08' }), error => error.getStatus() === 400);

  const highValue = await user();
  await prisma.order.createMany({ data: [1, 2].map(number => ({
    orderId: prefix + '-large-' + number, userId: highValue.id, goodsId: 'fixture', goodsType: 'money',
    priceCents: 1_200_000_000, totalCents: 1_200_000_000, status: 1, payPlatform: 'epay',
  })) });
  const largeTotals = await orders.manage({ userId: highValue.id });
  assert.equal(largeTotals.overview.paidCents, 2_400_000_000);
});

test('gateway URLs preserve signed Unicode and ampersands, return to the exact order, and reject unsafe schemes', async () => {
  const old = Object.fromEntries(['PAY_EPAY_GATEWAY','PAY_EPAY_PID','PAY_EPAY_KEY'].map(key => [key, process.env[key]]));
  const a = await user(), offer = await pkg({ name: '写作 & 绘画 + 灵感' }), order = await orders.create(a.id, intent(offer));
  values['commerce.payProviders'] = 'epay';
  process.env.PAY_EPAY_GATEWAY = 'https://gateway.qgauss.example/pay'; process.env.PAY_EPAY_PID = 'fixture'; process.env.PAY_EPAY_KEY = 'local-fixture-signing-key';
  try {
    const prep = await pay.prepare(a.id, order.orderId), url = new URL(prep.payUrl);
    assert.equal(url.searchParams.get('name'), offer.name);
    assert.equal(new URL(url.searchParams.get('return_url')).searchParams.get('order'), order.orderId);
    const pairs = [...url.searchParams.entries()].filter(([key]) => !['sign','sign_type'].includes(key)).sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => key+'='+value).join('&');
    assert.equal(url.searchParams.get('sign'), createHash('md5').update(pairs + process.env.PAY_EPAY_KEY).digest('hex'));
    process.env.PAY_EPAY_GATEWAY = 'javascript:alert(1)'; await assert.rejects(() => pay.prepare(a.id, order.orderId), e => e.getStatus() === 503);
  } finally { values['commerce.payProviders'] = 'mock'; for (const [key,value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('merchant statement parsing preserves exact reference strings and Beijing calendar boundaries', () => {
  const fields = { provider: 'epay', fromDay: '2026-06-13', throughDay: '2026-06-13' };
  const first = '收款,receipt-1,order-1,"12345678901234567890","2026-06-13 00:00:00",1990,20';
  const final = '退款,refund-1,order-1,12345678901234567890,2026-06-13 23:59:59,190,-2';
  const input = paymentStatementInput(statementFile(first, final), fields);
  assert.equal(input.rows[0].tradeRef, '12345678901234567890');
  assert.equal(input.rows[0].occurredAt.toISOString(), '2026-06-12T16:00:00.000Z');
  assert.equal(input.rows[1].occurredAt.toISOString(), '2026-06-13T15:59:59.000Z');
  assert.equal(input.rows[1].feeCents, -2);
  assert.equal(input.contentHash, paymentStatementInput(statementFile(final, first), fields).contentHash);
  assert.equal(paymentStatementInput(statementFile(), fields).rows.length, 0);
  assert.throws(() => paymentStatementInput(statementFile(first, first), fields), /重复/);
  assert.throws(() => paymentStatementInput(statementFile(first.replace('1990', '19.90')), fields), /整数分/);
  assert.throws(() => paymentStatementInput(statementFile(first.replace('00:00:00', '24:00:00')), fields), /北京时间/);
  assert.throws(() => paymentStatementInput(statementFile(first.replace('2026-06-13', '2026-06-14')), fields), /超出/);
  assert.throws(() => paymentStatementInput(statementFile(first.replace('receipt-1', '"receipt-1')), fields), /引号/);
  assert.throws(() => paymentStatementInput(Buffer.from([0xff]), fields), /编码/);
  assert.throws(() => paymentStatementInput(statementFile(first), { ...fields, throughDay: '2026-07-14' }), /31 天/);
  assert.throws(() => paymentStatementInput(statementFile(first), { ...fields, provider: 'mock' }), /通道/);
  assert.throws(() => paymentStatementInput(statementFile(), { provider: 'epay' }), /没有交易记录/);
});

test('merchant statements retain both sides of differences and preserve order and ledger data during review', async () => {
  const operator = await user();
  const buyer = await user();
  const statement = new PaymentStatementService(prisma);
  const period = { provider: 'epay', fromDay: '2026-06-13', throughDay: '2026-06-13' };
  const local = [
    ['bill-matched', 'trade-1', 'epay', 1, 1990, '2026-06-12T16:02:00Z'],
    ['bill-different', 'trade-2', 'epay', 1, 2600, '2026-06-12T16:04:00Z'],
    ['bill-site-only', 'trade-3', 'epay', 4, 3100, '2026-06-13T15:59:59Z'],
    ['bill-out-of-period', 'trade-4', 'epay', 1, 4490, '2026-06-13T16:00:00Z'],
    ['bill-fixture', 'trade-5', 'mock', 1, 6990, '2026-06-12T16:06:00Z'],
    ['bill-ambiguous-a', 'trade-6', 'hupi', 1, 5200, '2026-06-12T16:06:00Z'],
    ['bill-ambiguous-b', 'trade-6', 'hupi', 1, 5200, '2026-06-12T16:07:00Z'],
  ];
  await prisma.order.createMany({ data: local.map(([orderId, tradeId, payPlatform, status, totalCents, date]) => ({
    orderId, tradeId, payPlatform, status, totalCents, priceCents: totalCents, userId: buyer.id,
    goodsId: 'sample', goodsType: 'money', paydAt: new Date(date),
  })) });
  const orderWhere = { userId: buyer.id };
  const before = await prisma.order.findMany({ where: orderWhere, orderBy: { id: 'asc' } });
  const ledgerBefore = await prisma.accountLog.count({ where: orderWhere });
  const records = [
    '收款,channel-1,,trade-1,2026-06-13 00:02:00,1990,20',
    '收款,channel-2,bill-different,trade-2,2026-06-13 00:04:00,2700,',
    '收款,channel-unique,missing-order,,2026-06-13 00:05:00,1630,15',
    '退款,channel-refund,bill-matched,trade-1,2026-06-13 01:00:00,900,-5',
    '退款,channel-refund-2,bill-matched,trade-1,2026-06-13 01:05:00,1200,-7',
  ];
  const [batch, retry] = await Promise.all([
    statement.importStatement(operator.id, '六月账单.csv', statementFile(...records), period),
    statement.importStatement(operator.id, '重复文件.csv', statementFile(...records.toReversed()), period),
  ]);
  assert.equal(batch.id, retry.id);
  assert.notEqual(batch.reused, retry.reused);
  assert.equal(batch.importedCount, 5);
  assert.equal(batch.matchedCount, 1);
  assert.equal(batch.missingCount, 1);
  assert.equal(batch.openCount, 5);
  assert.equal(batch.paymentCents, 6320);
  assert.equal(batch.refundCents, 2100);
  assert.equal(batch.feeCents, null);

  const details = await statement.detail(batch.id, { pageSize: 1, state: 'open' });
  assert.equal(details.total, 5);
  const first = details.items[0];
  assert.equal(first.orderRef, 'bill-different');
  assert.match(first.findings.join(' '), /账单金额/);
  const all = await statement.detail(batch.id, { pageSize: 1 }, true);
  assert.equal(all.items.length, 6);
  assert.equal(all.items.filter(row => row.kind === 'site-only')[0].localOrderId, 'bill-site-only');
  assert.match(all.items.find(row => row.eventRef === 'channel-unique').findings.join(' '), /未找到/);
  assert.ok(all.items.filter(row => row.kind === 'refund').every(row => row.findings.join(' ').includes('累计退款')));

  const decision = { state: 'reviewed', note: '已查阅渠道凭证，登记金额差异。', revision: first.revision };
  const [applied, replay] = await Promise.all([
    statement.decide(batch.id, first.id, operator.id, decision),
    statement.decide(batch.id, first.id, operator.id, decision),
  ]);
  assert.equal(applied.revision, 1);
  assert.equal(replay.revision, 1);
  await assert.rejects(() => statement.decide(batch.id, first.id, buyer.id, decision), e => e.getStatus() === 409);
  assert.equal((await statement.list({})).items.find(item => item.id === batch.id).reviewedCount, 1);
  const reopened = await statement.decide(batch.id, first.id, operator.id, { state: 'open', note: '补充渠道记录后再次复核。', revision: 1 });
  assert.equal(reopened.revision, 2);
  assert.deepEqual(reopened.decisions.map(row => row.state), ['open', 'reviewed']);
  assert.deepEqual(reopened.findings, first.findings);

  const ambiguous = await statement.importStatement(operator.id, '另一通道.csv',
    statementFile('收款,ambiguous,,trade-6,2026-06-13 00:06:00,5200,0'), { provider: 'hupi' });
  const ambiguousRow = (await statement.detail(ambiguous.id, {})).items[0];
  assert.match(ambiguousRow.findings.join(' '), /多笔订单/);
  assert.equal(ambiguousRow.localOrderId, '');

  const zeroRecord = await statement.importStatement(operator.id, '零交易账单.csv', statementFile(), period);
  assert.equal(zeroRecord.importedCount, 0);
  assert.equal(zeroRecord.missingCount, 3);
  assert.deepEqual(await prisma.order.findMany({ where: orderWhere, orderBy: { id: 'asc' } }), before);
  assert.equal(await prisma.accountLog.count({ where: orderWhere }), ledgerBefore);
});

test('native transaction CSV keeps merchant order references and converts gross amounts exactly', () => {
  const header = [
    '交易时间', '微信订单号', '商户订单号', '交易状态', '货币种类', '应结订单金额', '退款金额',
    '微信退款单号', '退款状态', '退款成功时间', '订单金额', '申请退款金额', '手续费',
  ].join(',');
  const stamped = '2026-06-13 09:30:00';
  const day = '2026-06-14 01:10:04';
  const row = (...values) => values.map(value => '\u0060' + value).join(',');
  const text = [
    header,
    row(stamped, '4200000008201712143733500001', 'QG-order-1', 'SUCCESS', 'CNY', '18.20', '0.00', '0', '', '', '19.90', '0.00', '0.12'),
    row(stamped, '4200000008201712143733500001', 'QG-order-1', 'REFUND', 'CNY', '0.00', '3.20', '50401010122021000000038202001', 'SUCCESS', day, '0.00', '3.50', '-0.02'),
    row(stamped, '4200000008201712143733500002', 'QG-order-2', 'REFUND', 'CNY', '0.00', '2.10', '50401010122021000000038202002', 'PROCESSING', '', '0.00', '2.10', '0.00'),
    row(stamped, '4200000008201712143733500003', 'QG-order-3', 'REVOKED', 'CNY', '0.00', '2.00', '50401010122021000000038202003', 'SUCCESS', '', '0.00', '2.00', '0.00'),
    '总交易单数,手续费总金额',
    row('4', '0.10'),
  ].join('\r\n');
  const file = Buffer.from(text);
  const fields = { provider: 'epay' };
  const preview = paymentStatementPreview(file, fields);
  assert.equal(preview.format, 'wechat');
  assert.deepEqual(preview.totals, { paymentCents: 1990, refundCents: 350, feeCents: 10, paymentCount: 1, refundCount: 1 });
  assert.deepEqual(preview.excluded, { revoked: 1, unfinishedRefunds: 1 });
  assert.deepEqual(preview.examples.map(entry => [entry.orderRef, entry.tradeRef, entry.sourceLine]), [['QG-order-1', '', 2], ['QG-order-1', '', 3]]);
  assert.equal(preview.examples[1].occurredAt.toISOString(), '2026-06-13T17:10:04.000Z');
  assert.throws(() => paymentStatementInput(file, fields), /重新预览/);
  assert.throws(() => paymentStatementInput(Buffer.from(text + '\n'), { ...fields, previewToken: preview.previewToken }), /重新预览/);
  assert.throws(() => paymentStatementInput(file, { ...fields, fromDay: '2026-06-13', throughDay: '2026-06-13' }), /标准模板/);
  const confirmed = paymentStatementInput(file, { ...fields, previewToken: preview.previewToken });
  const equivalent = statementFile(
    '收款,4200000008201712143733500001,QG-order-1,,' + stamped + ',1990,12',
    '退款,50401010122021000000038202001,QG-order-1,,' + day + ',350,-2',
  );
  assert.equal(confirmed.contentHash, paymentStatementInput(equivalent, fields).contentHash);
  assert.match(paymentStatementPreview(Buffer.from(text.replace(row('4', '0.10'), row('3', '0.10'))), fields).issues[0].message, /汇总/);
  const extra = paymentStatementPreview(Buffer.from(text + '\n' + row(stamped, 'unexpected')), fields);
  assert.equal(extra.previewToken, null);
  assert.match(extra.issues[0].message, /多余/);
});

test('custom CSV preview handles encoded headers, quoted line breaks and line-level corrections', () => {
  const fields = { provider: 'hupi' };
  const file = Buffer.concat([
    Buffer.from('# export\r\nout_trade_no,event_id,occurred_at,'),
    Buffer.from('bdf0b6ee', 'hex'),
    Buffer.from(',currency,description\r\nQG-one,event-001,2026-06-13 07:06:05,-0.29,CNY,"sample,\r\ntext"\r\n' +
      'QG-two,event-002,2026-06-13 07:06:05,-0.10,USD,foreign\r\n' +
      'QG-three,event-003,2026-06-13 07:06:05,0.001,CNY,precision\r\n' +
      'QG-four,event-001,2026-06-13 07:06:05,-1,CNY,duplicate\r\n'),
  ]);
  const first = paymentStatementPreview(file, fields);
  assert.equal(first.format, 'columns');
  assert.equal(first.mappingRequired, true);
  assert.equal(first.columns[3], '金额');
  assert.deepEqual(first.suggested, { eventRef: 1, orderRef: 0, occurredAt: 2, amount: 3, currency: 4 });
  const mapping = { ...first.suggested, unit: 'yuan', rowKind: 'refund' };
  const mapped = { ...fields, columns: JSON.stringify(mapping) };
  const preview = paymentStatementPreview(file, mapped);
  assert.equal(preview.previewToken, null);
  assert.equal(preview.issueCount, 3);
  assert.deepEqual(preview.issues.map(issue => issue.line), [5, 6, 7]);
  assert.match(preview.issues[0].message, /人民币/);
  assert.match(preview.issues[1].message, /两位小数/);
  assert.match(preview.issues[2].message, /重复/);
  assert.equal(preview.examples[0].amountCents, 29);
  assert.throws(() => paymentStatementInput(file, mapped), /第 5 行/);
  assert.throws(() => paymentStatementPreview(file, { ...mapped, columns: JSON.stringify({ ...mapping, fee: 3 }) }), /同一列/);
  const clean = file.subarray(0, file.indexOf('QG-two'));
  const ready = paymentStatementPreview(clean, mapped);
  assert.ok(ready.previewToken);
  assert.equal(ready.totals.feeCents, null);
  assert.throws(() => paymentStatementInput(clean, { ...mapped, provider: 'epay', previewToken: ready.previewToken }), /重新预览/);
  assert.throws(() => paymentStatementInput(clean, {
    ...mapped, previewToken: ready.previewToken, columns: JSON.stringify({ ...mapping, currency: undefined }),
  }), /重新预览/);
  assert.equal(paymentStatementInput(clean, { ...mapped, previewToken: ready.previewToken }).rows[0].amountCents, 29);
});

test('statement totals stay exact beyond the maximum amount of a single order', async () => {
  const operator = await user();
  const statement = new PaymentStatementService(prisma);
  const lines = [1, 2].map(index => '收款,total-' + index + ',total-order-' + index + ',,2026-06-13 00:08:00,2000000000,100');
  const result = await statement.importStatement(operator.id, '大额汇总.csv', statementFile(...lines), { provider: 'epay' });
  assert.equal(result.paymentCents, 4_000_000_000);
  assert.equal(result.feeCents, 200);
  assert.equal(result.openCount, 2);
});
