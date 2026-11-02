/** Isolated, migrated SQLite only. Never reads the application's .env or live database. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { MailService } from '../dist/modules/mail/mail.service.js';
import { MailOperationsService } from '../dist/modules/mail/mail-operations.service.js';
import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';

const here = dirname(fileURLToPath(import.meta.url));
export function mailFixtures() {
  const folder = mkdtempSync(join(tmpdir(), 'qgauss-mail-')), base = join(folder, 'empty.db'), clients = [], services = [];
  execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: base }, stdio: 'pipe' });
  async function fixture(extra = {}) {
    const database = join(folder, randomUUID() + '.db'); copyFileSync(base, database);
    const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + database.replace(/\\/g, '/') } } }); clients.push(prisma);
    const user = await prisma.user.create({ data: { email: 'recipient@qgauss.test', username: 'mail_owner', passwordHash: 'synthetic hash only', role: 'ADMIN' } });
    const values = { 'site.name': 'QGauss AI', 'site.baseUrl': 'https://qgauss.test', ...extra }, settings = { get: async key => values[key] };
    const service = createService(prisma, settings);
    return { prisma, user, values, settings, service, database, operations: new MailOperationsService(prisma, service, settings, new RateLimitService()), secondClient() { const client = new PrismaClient({ datasources: { db: { url: 'file:' + database.replace(/\\/g, '/') } } }); clients.push(client); return client; } };
  }
  function createService(prisma, settings, env = {}) {
    const keys = Object.keys(process.env).filter(key => key.startsWith('MAIL_')), previous = Object.fromEntries([...new Set([...keys, ...Object.keys(env)])].map(key => [key, process.env[key]]));
    for (const key of keys) delete process.env[key]; Object.assign(process.env, env);
    let service;
    try { service = new MailService(prisma, settings); } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    services.push(service); return service;
  }
  async function close() {
    for (const service of services) service.onModuleDestroy();
    await Promise.all(clients.map(client => client.$disconnect()));
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-mail-')) throw Error('mail cleanup escaped');
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return { fixture, createService, close, folder, base };
}
export async function mailSettles(prisma, id, expected, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const row = await prisma.mailOutbox.findUniqueOrThrow({ where: { id } });
    if (expected.includes(row.status)) return row;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw Error('mail did not reach ' + expected.join('/'));
}
