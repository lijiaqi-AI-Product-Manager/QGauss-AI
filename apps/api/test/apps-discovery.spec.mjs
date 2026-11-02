/** Application discovery and favorite writes against a fully migrated, isolated SQLite database. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {SqliteClient as PrismaClient} from '../dist/common/prisma/sqlite-client.js';
import { AppsService } from '../dist/modules/apps/apps.service.js';
import { FavoriteAppDto } from '../dist/modules/apps/dto/app.dto.js';
import { ValidationPipe } from '@nestjs/common';

const here = dirname(fileURLToPath(import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'qgauss-app-discovery-'));
execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: join(folder, 'test.db') }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + join(folder, 'test.db').replace(/\\/g, '/') } } });
const service = new AppsService(prisma);
before(async () => { for (const id of ['alice', 'bob', 'retry-user', 'parallel', 'other', 'withdraw-user']) await prisma.user.create({ data: { id, username: id, email: id + '@qgauss.test', passwordHash: 'isolated test only' } }); });
const appFixture = (data = {}) => service.create({ name: randomUUID(), systemPrompt: 'Private application instructions', greeting: '一起开始吧。', defaultModel: 'mock-chat', ...data });
after(async () => { await prisma.$disconnect(); if (!resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-app-discovery-')) throw new Error('Cleanup escaped its temporary root'); rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('favorite input preserves JSON booleans and rejects coercible strings, numbers and null under the production validation options', async () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const metadata = { type: 'body', metatype: FavoriteAppDto };
  for (const favorited of [true, false]) assert.equal((await pipe.transform({ favorited }, metadata)).favorited, favorited);
  assert.equal((await pipe.transform({}, metadata)).favorited, undefined);
  for (const favorited of ['yes', 'false', 0, 1, null, [], {}]) await assert.rejects(() => pipe.transform({ favorited }, metadata), error => error.getStatus() === 400);
});

test('discovery exposes greeting and category, keeps private instructions on the server and separates favorites by user', async () => {
  const category = await service.createCategory(randomUUID());
  const app = await appFixture({ categoryId: category.id });
  await service.toggleFavorite('alice', app.id, true);
  const rows = await service.listPublished('alice', category.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].greeting, app.greeting); assert.equal(rows[0].category.name, category.name); assert.equal(rows[0].favorited, true);
  assert.equal(Object.hasOwn(rows[0], 'systemPrompt'), false);
  const own = await service.detail(app.id, 'alice'), other = await service.detail(app.id, 'bob');
  assert.equal(own.favorited, true); assert.equal(other.favorited, false);
  assert.equal(Object.hasOwn(own, 'systemPrompt'), false); assert.equal(Object.hasOwn(own, 'createdBy'), false);
});

test('explicit favorite state survives retries without toggling or changing application metadata', async () => {
  const app = await appFixture();
  assert.deepEqual(await service.toggleFavorite('retry-user', app.id, true), { favorited: true });
  const first = await prisma.appFavorite.findUnique({ where: { userId_appId: { userId: 'retry-user', appId: app.id } } });
  assert.deepEqual(await service.toggleFavorite('retry-user', app.id, true), { favorited: true });
  const second = await prisma.appFavorite.findUnique({ where: { userId_appId: { userId: 'retry-user', appId: app.id } } });
  assert.deepEqual(second, first);
  assert.equal((await prisma.app.findUnique({ where: { id: app.id } })).updatedAt.getTime(), app.updatedAt.getTime());
  assert.deepEqual(await service.toggleFavorite('retry-user', app.id, false), { favorited: false });
  assert.deepEqual(await service.toggleFavorite('retry-user', app.id, false), { favorited: false });
  assert.equal(await prisma.appFavorite.count({ where: { appId: app.id } }), 0);
});

test('concurrent explicit favorites create one row, older toggle calls serialize, and another user remains independent', async () => {
  const app = await appFixture();
  const responses = await Promise.all(Array.from({ length: 8 }, () => service.toggleFavorite('parallel', app.id, true)));
  assert.ok(responses.every(result => result.favorited)); assert.equal(await prisma.appFavorite.count({ where: { appId: app.id } }), 1);
  const toggles = await Promise.all([service.toggleFavorite('parallel', app.id), service.toggleFavorite('parallel', app.id)]);
  assert.deepEqual(toggles.map(value => value.favorited).sort(), [false, true]);
  await service.toggleFavorite('other', app.id, true); await service.toggleFavorite('parallel', app.id, false);
  assert.equal((await service.detail(app.id, 'other')).favorited, true);
  assert.equal((await service.detail(app.id, 'parallel')).favorited, false);
});

test('withdrawn and removed applications disappear from discovery, details, favorites and chat eligibility', async () => {
  const app = await appFixture();
  await service.toggleFavorite('withdraw-user', app.id, true); await service.update(app.id, { published: false });
  assert.equal((await service.listPublished('withdraw-user')).some(value => value.id === app.id), false);
  assert.equal((await service.listFavorites('withdraw-user')).some(value => value.id === app.id), false);
  for (const read of [() => service.detail(app.id, 'withdraw-user'), () => service.getForChat(app.id), () => service.toggleFavorite('withdraw-user', app.id, true)]) await assert.rejects(read, error => error.getStatus() === 404);
  await service.update(app.id, { published: true }); await service.remove(app.id);
  await assert.rejects(() => service.detail(app.id, 'withdraw-user'), error => error.getStatus() === 404);
  await assert.rejects(() => service.toggleFavorite('withdraw-user', app.id, false), error => error.getStatus() === 404);
});
