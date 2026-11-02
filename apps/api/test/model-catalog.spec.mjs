import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { ModelsService } from '../dist/modules/models/models.service.js';
import { ModelCatalogService } from '../dist/modules/models/model-catalog.service.js';
import { CreateModelDto, UpdateModelDto } from '../dist/modules/models/dto/model.dto.js';
import { ChatService } from '../dist/modules/chat/chat.service.js';
import { LedgerService } from '../dist/modules/commerce/ledger.service.js';

const folder = mkdtempSync(join(tmpdir(), 'qgauss-model-catalog-'));
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: join(folder, 'test.db') }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + join(folder, 'test.db').replace(/\\/g, '/') } } });
const models = new ModelsService(prisma, { encrypt: value => value, decrypt: value => value });
const values = { 'commerce.enabled': true, 'demo.siteEnabled': false };
const settings = { get: async key => values[key] };
const catalog = new ModelCatalogService(models, settings);
const modelFixture = (extra = {}) => models.createModel({ name: 'catalog-' + randomUUID(), displayName: '观测测试模型', vendor: '  QGauss  ', maxContext: 128000, maxOutput: 4096, priceInPerM: 3, priceOutPerM: 1200000, capabilities: 'chat, vision, vision ,reasoning', ...extra });
after(async () => { await prisma.$disconnect(); if (!resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-model-catalog-')) throw new Error('Cleanup escaped temporary root'); rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('catalog preserves exact limits and micro-costs, normalizes capabilities and excludes channel secrets', async () => {
  const model = await modelFixture({ countPool: 'model4', countCost: 3 });
  const channel = await models.createChannel({ name: randomUUID(), type: 'MOCK', baseUrl: 'mock://private-catalog', apiKey: 'private-catalog-key' });
  await models.bindChannel(model.id, { channelId: channel.id, upstreamName: 'private-upstream' });
  const entry = (await catalog.available()).find(row => row.id === model.id);
  assert.equal(entry.vendor, 'QGauss'); assert.deepEqual(entry.capabilities, ['chat', 'vision', 'reasoning']); assert.equal(entry.priceInPerM, 3); assert.equal(entry.maxOutput, 4096);
  assert.deepEqual(entry.billing, { mode: 'count', pool: 'model4', amount: 3, reason: 'configured' });
  assert.equal(entry.ready, true); assert.equal(Object.hasOwn(entry, 'channels'), false);
  assert.equal(JSON.stringify(entry).includes('private-'), false);
  assert.equal((await catalog.plaza()).models.find(row => row.id === model.id).billing.amount, 3);
});

test('catalog availability follows binding, channel and model status, preserving comparison metadata only for enabled models', async () => {
  const model = await modelFixture(); const channel = await models.createChannel({ name: randomUUID(), type: 'MOCK', baseUrl: 'mock://catalog-status' });
  await models.bindChannel(model.id, { channelId: channel.id, upstreamName: 'catalog-status', enabled: false });
  assert.equal((await catalog.available()).find(row => row.id === model.id).ready, false);
  await models.bindChannel(model.id, { channelId: channel.id, upstreamName: 'catalog-status', enabled: true });
  assert.equal((await catalog.available()).find(row => row.id === model.id).ready, true);
  await models.updateChannel(channel.id, { status: 'DISABLED' });
  assert.equal((await catalog.available()).find(row => row.id === model.id).ready, false);
  await models.updateModel(model.id, { status: 'DISABLED' });
  assert.equal((await catalog.available()).some(row => row.id === model.id), false);
  await models.removeModel(model.id); await assert.rejects(() => models.resolveRoute(model.name));
});

test('public count rules agree with accepted chat quote; count reservation enforces availability atomically', async () => {
  const user = await prisma.user.create({ data: { username: randomUUID(), email: randomUUID() + '@qgauss.test', passwordHash: 'isolated fixture' } });
  const ledger = new LedgerService(prisma); await ledger.grant(user.id, { model4Count: 7, rechargeType: 'admin' });
  const model = await modelFixture({ countPool: 'model4', countCost: 3 });
  const preflight = () => ChatService.prototype.resolveCharge.call({ settings }, model, values['demo.siteEnabled']);
  assert.deepEqual(await preflight(), { pool: 'model4', amount: 3 });
  assert.equal((await catalog.available()).find(row => row.id === model.id).billing.amount, 3);
  assert.equal((await ledger.view(user.id)).counts.model4, 7);
  values['commerce.enabled'] = false; assert.equal(await preflight(), null);
  assert.equal((await catalog.available()).find(row => row.id === model.id).billing.reason, 'commerce-disabled');
  values['commerce.enabled'] = true; values['demo.siteEnabled'] = true; assert.equal(await preflight(), null);
  assert.equal((await catalog.available()).find(row => row.id === model.id).billing.reason, 'demo');
  values['demo.siteEnabled'] = false;
  const costOnly = await modelFixture({ countPool: '', countCost: 0 });
  assert.equal((await catalog.available()).find(row => row.id === costOnly.id).billing.mode, 'none');
  const quote = await ChatService.prototype.resolveCharge.call({ settings }, { ...model, countCost: 8 }, false);
  assert.deepEqual(quote, { pool: 'model4', amount: 8 });
  await assert.rejects(() => prisma.$transaction(tx => ledger.reserveCountTx(tx, user.id, { ...quote, refId: 'catalog-insufficient-' + user.id, bizType: 'chat' })), error => error.getStatus() === 402);
  assert.equal((await ledger.view(user.id)).counts.model4, 7);
});

test('legacy spaced capabilities agree between public discovery and routed model without rewriting stored data', async () => {
  const model = await modelFixture(); const channel = await models.createChannel({ name: randomUUID(), type: 'MOCK', baseUrl: 'mock://legacy-caps' });
  await models.bindChannel(model.id, { channelId: channel.id, upstreamName: 'legacy-caps' });
  await prisma.aiModel.update({ where: { id: model.id }, data: { capabilities: 'chat, vision, vision, custom-tool ' } });
  assert.deepEqual((await catalog.available()).find(row => row.id === model.id).capabilities, ['chat', 'vision', 'custom-tool']);
  assert.equal((await models.resolveRoute(model.name)).model.capabilities, 'chat,vision,custom-tool');
  assert.equal((await prisma.aiModel.findUnique({ where: { id: model.id } })).capabilities, 'chat, vision, vision, custom-tool ');
});

test('production DTO validation rejects negative, null and overflowing cost references and keeps exact micro values', async () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  for (const metatype of [CreateModelDto, UpdateModelDto]) {
    for (const price of [-1, null, 2147483648, 0.5]) await assert.rejects(() => pipe.transform({ name: 'validation-model', displayName: '验证', priceInPerM: price }, { type: 'body', metatype }), error => error.getStatus() === 400);
    for (const price of [0, 3, 2147483647]) assert.equal((await pipe.transform({ name: 'validation-model', displayName: '验证', priceInPerM: price }, { type: 'body', metatype })).priceInPerM, price);
  }
});
