import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { OrderService } from '../dist/modules/commerce/order.service.js';
import { PayService } from '../dist/modules/commerce/pay.service.js';
import { CramiService } from '../dist/modules/commerce/crami.service.js';
import { LedgerService } from '../dist/modules/commerce/ledger.service.js';
import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';

const folder = mkdtempSync(join(tmpdir(), 'qgauss-checkout-'));
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: join(folder, 'test.db') }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + join(folder, 'test.db').replace(/\\/g, '/') } } });
const values = { 'commerce.orderTimeoutMinutes': 30, 'commerce.orderRateLimit': 9999, 'commerce.payProviders': 'mock', 'commerce.mockPayRateLimit': 9999, 'commerce.defaultCommissionBps': 0, 'site.baseUrl': 'https://qgauss.example', 'commerce.payNotifyBaseUrl': 'https://qgauss.example' };
const settings = { get: async key => values[key] }, rate = new RateLimitService(), ledger = new LedgerService(prisma), orders = new OrderService(prisma, settings, rate), pay = new PayService(prisma, settings, ledger, rate), crami = new CramiService(prisma, ledger, settings, rate);
const user = () => prisma.user.create({ data: { email: randomUUID() + '@qgauss.test', username: randomUUID(), passwordHash: 'isolated fixture' } });
const pkg = (extra = {}) => crami.createPackage({ name: '灵感补给 ' + randomUUID(), priceYuan: '19.90', days: 30, model3Count: 10, model4Count: 5, drawMjCount: 3, agentCount: 2, ...extra });
const intent = offer => ({ goodsType: 'package', goodsId: offer.id, expectedOfferRevision: offer.offerRevision, requestKey: randomUUID() });
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
