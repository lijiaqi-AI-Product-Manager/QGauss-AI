/** Real SQLite installation, ownership, seed and password boundaries. All credentials are synthetic. */
import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { InstallationService, isLoopbackAddress } from '../dist/modules/installation/installation.service.js';
import { InstallationGate, InstallationOwnerGuard, secureInstallationRequest } from '../dist/modules/installation/installation.guards.js';
import { InitializeDto } from '../dist/modules/installation/installation.dto.js';
import { InstallationController } from '../dist/modules/installation/installation.controller.js';
import { seedAdministrator } from '../dist/modules/installation/seed-administrator.js';
import { SettingsService } from '../dist/modules/settings/settings.service.js';
import { ModelsService } from '../dist/modules/models/models.service.js';
import { ModelCatalogService } from '../dist/modules/models/model-catalog.service.js';
import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';
import { MailService } from '../dist/modules/mail/mail.service.js';
import { MailOperationsService } from '../dist/modules/mail/mail-operations.service.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { RegisterDto } from '../dist/modules/auth/dto/register.dto.js';
import { UsersService } from '../dist/modules/users/users.service.js';
import { validateEnvironment } from '../dist/common/config/env.check.js';
import { prepareGuidedEnvironment } from '../../../scripts/setup/guided.mjs';

const here = dirname(fileURLToPath(import.meta.url)), folder = mkdtempSync(join(tmpdir(), 'qgauss-installation-'));
const base = join(folder, 'empty.db');
execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: base }, stdio: 'pipe' });
const clients = [];
const password = 'SyntheticAdminPass-819';
const input = (extra = {}) => ({ requestKey: randomUUID(), email: 'owner@qgauss.test', username: 'space_owner', displayName: '创作负责人', password, siteBaseUrl: 'https://space.qgauss.test', openRegistration: false, ...extra });
async function fixture(extra = {}) {
  const dbPath = join(folder, randomUUID() + '.db'); copyFileSync(base, dbPath);
  const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + dbPath.replace(/\\/g, '/') } } }); clients.push(prisma);
  const values = { NODE_ENV: 'development', QGAUSS_SETUP_TOKEN: randomBytes(32).toString('base64url'), ...extra };
  const config = { get: key => values[key] }, settings = new SettingsService(prisma);
  const catalog = new ModelCatalogService(new ModelsService(prisma, null), settings);
  const mail = new MailOperationsService(prisma, new MailService(prisma, settings), settings, new RateLimitService());
  return { prisma, settings, config, values, catalog, mail, service: new InstallationService(prisma, config, settings, catalog, mail), dbPath };
}
const rawUser = async (db, extra = {}) => db.user.create({ data: { email: randomUUID() + '@qgauss.test', username: randomUUID(), passwordHash: await bcrypt.hash(password, 4), ...extra } });
const rejection = status => error => error.getStatus?.() === status;
const context = (handler, req = {}) => ({ getHandler: () => handler, getClass: () => InstallationController, switchToHttp: () => ({ getRequest: () => req }) });
after(async () => { await Promise.all(clients.map(client => client.$disconnect())); const absolute = resolve(folder); if (!absolute.startsWith(resolve(tmpdir()) + sep + 'qgauss-installation-')) throw Error('cleanup escaped'); rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('fresh installation has no implicit administrator and production requires an owner credential', async () => {
  const f = await fixture({ NODE_ENV: 'production', QGAUSS_SETUP_TOKEN: undefined });
  assert.deepEqual(await f.service.status(true), { required: true, canInitialize: false, needsSecureConnection: false });
  await assert.rejects(() => f.service.onModuleInit(), /QGAUSS_SETUP_TOKEN/);
  assert.equal(await f.prisma.user.count(), 0);
});

test('existing members, including deleted or disabled members, permanently close public installation', async () => {
  for (const extra of [{ role: 'USER' }, { role: 'ADMIN', status: 'DISABLED' }, { role: 'ADMIN', deletedAt: new Date() }]) {
    const f = await fixture(); await rawUser(f.prisma, extra);
    assert.equal((await f.service.status(true)).required, false);
    await assert.rejects(() => f.service.initialize(input()), rejection(409));
    assert.equal(await f.prisma.user.count(), 1);
    await f.prisma.user.deleteMany();
    assert.equal((await new InstallationService(f.prisma, f.config, f.settings, f.catalog).status(true)).required, false);
  }
});

test('production history without an active administrator requires controlled recovery', async () => {
  const f = await fixture({ NODE_ENV: 'production' }); await rawUser(f.prisma);
  await assert.rejects(() => f.service.onModuleInit(), /受控账户恢复/);
  assert.equal((await f.service.status(true)).required, false);
});

test('malformed lifecycle data fails closed instead of guessing an empty site', async () => {
  const f = await fixture(); await f.prisma.globalConfig.create({ data: { key: 'installation.state', value: '{broken' } });
  await assert.rejects(() => f.service.status(true), rejection(503));
  await assert.rejects(() => f.service.initialize(input()), rejection(503));
  assert.equal(await f.prisma.user.count(), 0);
});

test('initialization commits one administrator, closed registration, disabled commerce and working menus', async () => {
  const f = await fixture(); const data = input();
  await f.settings.set('security.registerEnabled', true);
  assert.equal(await f.settings.get('security.registerEnabled'), true);
  assert.deepEqual(await f.service.initialize(data), { initialized: true, next: '/login?redirect=/welcome' });
  const admin = await f.prisma.user.findFirst();
  assert.equal(admin.role, 'ADMIN'); assert.equal(await bcrypt.compare(password, admin.passwordHash), true);
  assert.equal(await f.settings.get('security.registerEnabled'), false); assert.equal(await f.settings.get('commerce.enabled'), false);
  assert.equal(await f.prisma.refreshToken.count(), 0); assert.equal(await f.prisma.channel.count(), 0);
  assert.ok(await f.prisma.menu.findFirst({ where: { path: '/welcome', roles: 'ADMIN' } }));
  const marker = (await f.prisma.globalConfig.findUnique({ where: { key: 'installation.state' } })).value;
  assert.equal(marker.includes(password), false); assert.equal(marker.includes(f.values.QGAUSS_SETUP_TOKEN), false);
  assert.equal((await f.settings.adminList()).some(row => row.key === 'installation.state'), false);
  assert.equal(Object.hasOwn(await f.settings.publicConfig(), 'installation.state'), false);
});

test('a lost response can confirm the identical request but never replace its accepted identity', async () => {
  const f = await fixture(), data = input();
  await f.service.initialize(data); await f.service.initialize(data);
  await assert.rejects(() => f.service.initialize({ ...data, email: 'different@qgauss.test' }), rejection(409));
  await assert.rejects(() => f.service.initialize({ ...data, password: 'AnotherSynthetic-715' }), rejection(409));
  await assert.rejects(() => f.service.initialize(input()), rejection(409));
  assert.equal(await f.prisma.user.count(), 1);
});

test('separate database clients racing first administrator creation accept only one identity', async () => {
  const f = await fixture(), other = new PrismaClient({ datasources: { db: { url: 'file:' + f.dbPath.replace(/\\/g, '/') } } }); clients.push(other);
  const settings = new SettingsService(other), second = new InstallationService(other, f.config, settings, f.catalog);
  const result = await Promise.allSettled([f.service.initialize(input()), second.initialize(input({ email: 'second@qgauss.test', username: 'second_owner' }))]);
  assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(result.find(value => value.status === 'rejected').reason.getStatus(), 409);
  assert.equal(await f.prisma.user.count(), 1);
});

test('a member appearing after the waiting screen closes installation without a rollback reopening it', async () => {
  const f = await fixture(); assert.equal((await f.service.status(true)).required, true);
  await rawUser(f.prisma);
  await assert.rejects(() => f.service.initialize(input()), rejection(409));
  assert.equal(JSON.parse((await f.prisma.globalConfig.findUnique({ where: { key: 'installation.state' } })).value).phase, 'legacy');
});

test('an interrupted navigation write rolls back the whole account and accepted settings', async () => {
  const f = await fixture(); await f.service.status(true);
  const db = new Proxy(f.prisma, { get(target, key) { if (key === '$transaction') return action => target.$transaction(tx => action(new Proxy(tx, { get(current, field) { if (field === 'menu') return { create: () => { throw Error('synthetic menu write failure'); } }; const value = current[field]; return typeof value === 'function' ? value.bind(current) : value; } }))); const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  await assert.rejects(() => new InstallationService(db, f.config, f.settings, f.catalog).initialize(input()), /synthetic menu/);
  assert.equal(await f.prisma.user.count(), 0); assert.equal(await f.prisma.globalConfig.count(), 1);
  assert.equal((await f.service.status(true)).required, true);
});

test('owner validation precedes body handling, uses trusted connection facts and limits attempts', async () => {
  const f = await fixture({ NODE_ENV: 'production' }), limiter = new RateLimitService(), guard = new InstallationOwnerGuard(f.service, limiter);
  const req = { ip: '198.51.100.17', secure: false, headers: { 'x-forwarded-proto': 'https', 'x-qgauss-install-token': f.values.QGAUSS_SETUP_TOKEN } };
  assert.equal(secureInstallationRequest(req), false); assert.throws(() => guard.canActivate(context(null, req)), rejection(403));
  req.secure = true; assert.equal(guard.canActivate(context(null, req)), true);
  req.headers['x-qgauss-install-token'] = 'invalid';
  for (let i = 0; i < 3; i++) assert.throws(() => guard.canActivate(context(null, req)), rejection(403));
  assert.throws(() => guard.canActivate(context(null, req)), rejection(429));
  for (const address of ['127.0.0.1', '127.2.3.4', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(address), true);
  for (const address of ['127.evil.test', '127.0.0.1.evil', '198.51.100.2', '::ffff:198.51.100.2']) assert.equal(isLoopbackAddress(address), false);
});

test('pending gate exempts only explicitly allowed handlers and blocks ordinary public authentication', async () => {
  const f = await fixture(), gate = new InstallationGate(new Reflector(), f.service);
  assert.equal(await gate.canActivate(context(InstallationController.prototype.status)), true);
  await assert.rejects(() => gate.canActivate(context(() => {})), rejection(503));
  await f.service.initialize(input()); assert.equal(await gate.canActivate(context(() => {})), true);
});

test('initialization preserves raw JSON types and enforces a bounded independent administrator password', async () => {
  const f = await fixture(), pipe = new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } });
  for (const extra of [{ password: 123456789012 }, { username: 1234 }, { openRegistration: 'false' }, { openRegistration: null }, { siteBaseUrl: 127 }, { displayName: null }]) await assert.rejects(() => pipe.transform(input(extra), { type: 'body', metatype: InitializeDto }), rejection(400));
  for (const extra of [{ password: 'admin123456' }, { password: 'ExampleOnlyLetters' }, { password: 'A1' + '😀'.repeat(20) }, { siteBaseUrl: 'https://space.qgauss.test/path' }, { siteBaseUrl: 'https://user:secret@space.qgauss.test' }]) await assert.rejects(() => f.service.initialize(input(extra)), rejection(422));
  const prod = await fixture({ NODE_ENV: 'production' }); await assert.rejects(() => prod.service.initialize(input({ siteBaseUrl: 'http://space.qgauss.test' })), rejection(422));
  assert.equal(await f.prisma.user.count(), 0);
});

test('readiness reports facts without claiming delivery or real provider verification', async () => {
  const f = await fixture({ MAIL_SMTP_HOST: 'synthetic.mail', MAIL_FROM: 'sender@qgauss.test' }); await f.service.initialize(input());
  const admin = await f.prisma.user.findFirst(), before = await f.service.readiness(admin.id);
  assert.equal(before.canEnableDemo, true); assert.equal(before.checks.find(item => item.id === 'mail').state, 'optional');
  assert.equal(before.checks.find(item => item.id === 'mail').action.path, '/mail');
  f.mail.mail.transporter = { sendMail: async () => ({ accepted: [] }), close() {} };
  assert.equal((await f.service.readiness(admin.id)).checks.find(item => item.id === 'mail').state, 'configured');
  assert.equal(before.checks.find(item => item.id === 'creation').state, 'action');
  await f.service.enableDemo(); const after = await f.service.readiness(admin.id);
  assert.equal(after.chatModel.demo, true); assert.equal(after.chatModel.billing.mode, 'none');
  assert.equal(after.checks.find(item => item.id === 'creation').state, 'action');
  await f.service.enableDemo(); assert.equal(await f.prisma.channel.count(), 1); assert.equal(await f.prisma.aiModel.count(), 1);
  assert.equal(await f.prisma.message.count(), 0);
});

test('local demo respects an existing mixed chat/image model and never replaces its configuration', async () => {
  const f = await fixture(); await rawUser(f.prisma, { role: 'ADMIN' }); await f.service.status(true);
  const channel = await f.prisma.channel.create({ data: { name: 'Configured service', type: 'CUSTOM', baseUrl: 'https://provider.qgauss.test' } });
  const model = await f.prisma.aiModel.create({ data: { name: 'existing-mixed', displayName: 'Existing mixed', capabilities: 'chat,image', channels: { create: { channelId: channel.id, upstreamName: 'existing' } } } });
  await assert.rejects(() => f.service.enableDemo(), rejection(409));
  const ready = await f.service.readiness((await f.prisma.user.findFirst()).id);
  assert.equal(ready.chatModel.name, model.name); assert.equal(ready.chatModel.demo, false); assert.equal(await f.prisma.aiModel.count(), 1);
});

test('repeat seeds preserve administrator hashes, never promote members or add default administrators to history', async () => {
  const f = await fixture(), seed = { email: 'seed@qgauss.test', username: 'seed_owner', password };
  const first = await seedAdministrator(f.prisma, seed), again = await seedAdministrator(f.prisma, { ...seed, password: 'DifferentSynthetic-819' });
  assert.equal(again.passwordHash, first.passwordHash);
  await assert.rejects(() => seedAdministrator(f.prisma, { ...seed, email: 'extra@qgauss.test' }), /已有账户/);
  const g = await fixture(), user = await rawUser(g.prisma, { email: seed.email });
  await assert.rejects(() => seedAdministrator(g.prisma, seed), /不会提升权限/); assert.equal((await g.prisma.user.findUnique({ where: { id: user.id } })).role, 'USER');
  const h = await fixture(); await assert.rejects(() => seedAdministrator(h.prisma, { ...seed, password: '😀'.repeat(20) }), /SEED_ADMIN_PASSWORD/); assert.equal(await h.prisma.user.count(), 0);
});

test('generated production environment contains independent credentials, no seed password, and is never overwritten', async () => {
  const path = mkdtempSync(join(folder, 'env-')); writeFileSync(join(path, '.env.example'), readFileSync(join(here, '../.env.example')));
  const result = await prepareGuidedEnvironment(path); validateEnvironment(result);
  assert.equal(result.NODE_ENV, 'production'); assert.equal(result.SEED_ADMIN_PASSWORD, undefined); assert.notEqual(result.QGAUSS_SETUP_TOKEN, result.JWT_SECRET);
  const before = readFileSync(join(path, '.env'));
  await assert.rejects(() => prepareGuidedEnvironment(path), /已存在/); assert.deepEqual(readFileSync(join(path, '.env')), before);
  for (const value of ['', 'a'.repeat(40), result.JWT_SECRET, 'change-me-placeholder-value-for-setup']) assert.throws(() => validateEnvironment({ ...result, QGAUSS_SETUP_TOKEN: value }), /QGAUSS_SETUP_TOKEN/);
});

test('new multibyte passwords cannot collide through bcrypt truncation, while legacy logins remain usable', async () => {
  const f = await fixture(), legacyPassword = '😀'.repeat(20), collision = '😀'.repeat(19) + '🚀';
  const legacyHash = await bcrypt.hash(legacyPassword, 4); assert.equal(await bcrypt.compare(collision, legacyHash), true);
  const member = await rawUser(f.prisma, { passwordHash: legacyHash });
  const jwtSecret = randomBytes(48).toString('base64url'), config = { get: key => key === 'JWT_SECRET' ? jwtSecret : undefined };
  const auth = new AuthService(f.prisma, new JwtService({ secret: jwtSecret }), config, {}, f.settings, {}, new RateLimitService());
  assert.equal((await auth.login({ account: member.email, password: legacyPassword }, {})).user.id, member.id);
  await assert.rejects(() => new UsersService(f.prisma, new RateLimitService()).changePassword(member.id, legacyPassword, collision), rejection(422));
  await new UsersService(f.prisma, new RateLimitService()).changePassword(member.id, legacyPassword, 'NewSyntheticPass-581');
  assert.equal(await bcrypt.compare('NewSyntheticPass-581', (await f.prisma.user.findUnique({ where: { id: member.id } })).passwordHash), true);
});

test('administrator change and email reset enforce the same stronger rule without consuming a rejected reset link', async () => {
  const f = await fixture(); await f.service.initialize(input());
  const admin = await f.prisma.user.findFirst(), users = new UsersService(f.prisma, new RateLimitService());
  await assert.rejects(() => users.changePassword(admin.id, password, 'Weakpass9'), rejection(422));
  const resetToken = randomBytes(24).toString('hex');
  const reset = await f.prisma.passwordReset.create({ data: { userId: admin.id, tokenHash: createHash('sha256').update(resetToken).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } });
  const auth = new AuthService(f.prisma, null, f.config, null, f.settings, null, new RateLimitService());
  await assert.rejects(() => auth.resetPassword(resetToken, 'Weakpass9'), rejection(422));
  assert.equal((await f.prisma.passwordReset.findUnique({ where: { id: reset.id } })).usedAt, null);
  await auth.resetPassword(resetToken, 'NewSyntheticAdmin-723');
  assert.equal(await bcrypt.compare('NewSyntheticAdmin-723', (await f.prisma.user.findUnique({ where: { id: admin.id } })).passwordHash), true);
});

test('registration rejects non-string and over-byte-limit passwords before creating a new member', async () => {
  const f = await fixture(), pipe = new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } });
  for (const password of [123456789012, '😀'.repeat(20)]) await assert.rejects(() => pipe.transform({ email: 'member@qgauss.test', username: 'new_member', password }, { type: 'body', metatype: RegisterDto }), rejection(400));
  await f.settings.set('security.registerEnabled', true);
  const auth = new AuthService(f.prisma, null, f.config, { verify: () => true }, f.settings, null, new RateLimitService());
  await assert.rejects(() => auth.register({ email: 'member@qgauss.test', username: 'new_member', password: '😀'.repeat(20) }), rejection(422));
  assert.equal(await f.prisma.user.count(), 0);
});
