import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

test('升级保留历史内容与确定回执，旧未确定投递不自动补发；再次迁移不改记录', () => {
  const folder = mkdtempSync(join(tmpdir(), 'qgauss-mail-upgrade-')), file = join(folder, 'old.db'), prismaRoot = fileURLToPath(new URL('../prisma/', import.meta.url));
  let db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE _migrations (name TEXT PRIMARY KEY NOT NULL, appliedAt DATETIME NOT NULL)');
    for (const name of readdirSync(join(prismaRoot, 'migrations')).filter(name => name.endsWith('.sql') && name < '0024').sort()) {
      db.exec(readFileSync(join(prismaRoot, 'migrations', name), 'utf8'));
      db.prepare('INSERT INTO _migrations VALUES (?,?)').run(name, new Date().toISOString());
    }
    for (const status of ['sent','skipped','queued','failed']) db.prepare('INSERT INTO mail_outbox (id,"to",subject,template,payload,body,status,attempts,createdAt) VALUES (?,?,?,?,?,?,?,?,?)').run(status, 'synthetic@qgauss.test', 'historical', 'resetPassword', '{"private":"keep"}', 'historical private body', status, 1, new Date().toISOString());
    db.close(); db = null;
    const migrate = () => execFileSync(process.execPath, [join(prismaRoot, 'migrate.mjs')], { env: { ...process.env, DATABASE_FILE: file }, stdio: 'pipe' });
    migrate(); db = new DatabaseSync(file);
    const rows = db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();
    assert.equal(rows.find(row => row.id === 'sent').status, 'sent'); assert.equal(rows.find(row => row.id === 'skipped').status, 'skipped');
    for (const id of ['queued','failed']) { const row = rows.find(row => row.id === id); assert.equal(row.status, 'unknown'); assert.equal(row.error, 'LEGACY_UNCERTAIN'); }
    assert.ok(rows.every(row => row.body === 'historical private body' && row.payload === '{"private":"keep"}' && row.requestKey === null && row.confirmedAt === null));
    assert.equal(db.prepare('SELECT count(*) n FROM _migrations WHERE name=?').get('0024_mail_delivery.sql').n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM _migrations').get().n, readdirSync(join(prismaRoot,'migrations')).filter(name=>name.endsWith('.sql')).length);
    db.close(); db = null; migrate(); db = new DatabaseSync(file);
    assert.deepEqual(db.prepare('SELECT * FROM mail_outbox ORDER BY id').all(), rows);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db?.close(); if (!resolve(folder).startsWith(resolve(tmpdir()) + sep + 'qgauss-mail-upgrade-')) throw Error('upgrade cleanup escaped');
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
