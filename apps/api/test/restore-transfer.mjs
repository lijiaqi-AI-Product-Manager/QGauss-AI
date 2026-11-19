import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import bcrypt from 'bcryptjs';
import { SqliteClient } from '../dist/common/prisma/sqlite-client.js';
import { SecretBox } from '../dist/common/crypto/secret-box.js';

const api = fileURLToPath(new URL('../', import.meta.url));
const [phase, exchange] = process.argv.slice(2);
assert.ok(['backup', 'restore'].includes(phase) && exchange, 'Select backup or restore and an exchange directory');
const transfer = resolve(exchange);
const scratch = await mkdtemp(join(tmpdir(), 'qgauss-restore-transfer-'));
const backup = join(transfer, 'package/workspace.qgb');
const receiptPath = join(transfer, 'package/source.json');
const keyFile = join(transfer, 'check-key/transfer.key');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const host = digest(await readFile('/proc/sys/kernel/random/boot_id'));
const account = 'restore_trial_owner';
const password = 'QGauss-Synthetic28';
const title = '远山 · 恢复演练';
const content = '保留这次创作的原文和附件。\n第二行';
const attachment = Buffer.from('QGauss synthetic attachment');
const storageKey = '2026/11/trial-note.txt';

function ops(action, flags) {
  const args = Object.entries(flags).flatMap(([name, value]) => ['--' + name, value]);
  const output = execFileSync(process.execPath, [join(api, 'scripts/operations/cli.mjs'), action, ...args], {
    cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 40_000,
  });
  return JSON.parse(output);
}

if (phase === 'backup') {
  const database = join(scratch, 'source.db');
  const storage = join(scratch, 'storage');
  const sourceEnv = join(scratch, 'source.env');
  const databaseUrl = 'file:' + database;
  const config = {
    NODE_ENV: 'test', JWT_SECRET: randomBytes(48).toString('base64url'),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), DATABASE_URL: databaseUrl,
    DATABASE_FILE: database, STORAGE_DRIVER: 'local', STORAGE_DIR: storage,
    MAIL_SMTP_HOST: '', SMS_ENABLED: 'false', EXTERNAL_ENABLED: 'false',
  };
  await mkdir(join(storage, '2026/11'), { recursive: true });
  await writeFile(join(storage, storageKey), attachment, { flag: 'wx', mode: 0o600 });
  await writeFile(sourceEnv, Object.entries(config).map(([name, value]) => name + '=' + JSON.stringify(value)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  execFileSync(process.execPath, [join(api, 'prisma/migrate.mjs')], {
    cwd: scratch, env: { ...process.env, DATABASE_FILE: database, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 45_000,
  });
  const prisma = new SqliteClient({ datasources: { db: { url: databaseUrl } } });
  let owner, conversation, upload;
  try {
    owner = await prisma.user.create({ data: { username: account, email: 'restore-owner@qgauss.test',
      passwordHash: await bcrypt.hash(password, 10), passwordConfigured: true, role: 'ADMIN' } });
    await prisma.globalConfig.create({ data: { key: 'installation.state', value: '{"version":1,"phase":"legacy"}' } });
    conversation = await prisma.conversation.create({ data: { userId: owner.id, title,
      messages: { create: { role: 'USER', content } } } });
    upload = await prisma.uploadFile.create({ data: { userId: owner.id, storedKey: storageKey, filename: '恢复附件.txt',
      mime: 'text/plain', size: attachment.length, sha256: digest(attachment) } });
    const encrypted = new SecretBox(config.APP_ENCRYPTION_KEY).encrypt('synthetic-provider-key');
    await prisma.channel.create({ data: { name: 'QGauss recovery example', type: 'MOCK', baseUrl: 'mock://recovery', apiKeyEnc: encrypted } });
  } finally {
    await prisma.$disconnect();
  }
  await mkdir(join(transfer, 'package'), { recursive: true });
  await mkdir(join(transfer, 'check-key'), { recursive: true });
  ops('keygen', { 'key-file': keyFile });
  const result = ops('backup', { database, storage, 'env-file': sourceEnv, 'key-file': keyFile, output: backup });
  const verified = ops('verify', { input: backup, 'key-file': keyFile });
  assert.equal(verified.verified, true);
  assert.equal(verified.id, result.id);
  assert.equal(verified.summary.channelKeysChecked, 1);
  await writeFile(receiptPath, JSON.stringify({ host, id: verified.id, owner: owner.id,
    conversation: conversation.id, upload: upload.id }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('QGauss 已生成并核对合成站点备份');
} else {
  const source = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.notEqual(host, source.host, 'Recovery must run on a different host');
  const destination = join(scratch, '新站点 恢复');
  const recovered = ops('restore', { input: backup, 'key-file': keyFile, destination });
  assert.equal(recovered.id, source.id);
  assert.equal(recovered.summary.channelKeysChecked, 1);
  const prepared = ops('prepare-restore', { destination });
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.automaticStartup, false);
  const config = join(destination, prepared.file);
  const original = parseEnv(await readFile(join(destination, 'bundle/environment/original.env'), 'utf8'));
  const updated = parseEnv(await readFile(config, 'utf8'));
  assert.notEqual(updated.DATABASE_URL, original.DATABASE_URL);
  assert.equal(updated.DATABASE_FILE, join(destination, 'bundle/database/qgauss.db'));
  assert.equal(updated.STORAGE_DIR, join(destination, 'bundle/storage'));
  assert.equal(updated.APP_ENCRYPTION_KEY, original.APP_ENCRYPTION_KEY);

  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const preload = join(scratch, 'loopback.mjs');
  await writeFile(preload, `import { Server } from 'node:net';
const listen = Server.prototype.listen;
Server.prototype.listen = function (port, host, ...rest) {
  return listen.call(this, port, '127.0.0.1', ...rest);
};\n`, { flag: 'wx' });
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--env-file', config, join(api, 'dist/main.js')], {
    cwd: destination, env: { PATH: process.env.PATH, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true,
  });
  const ended = once(child, 'exit');
  const base = 'http://127.0.0.1:' + port + '/api';
  async function fetchData(path, options = {}, status = 200) {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(7000) });
    assert.equal(response.status, status, path);
    return (await response.json()).data;
  }
  try {
    let ready = false;
    const deadline = Date.now() + 35_000;
    while (!ready && Date.now() < deadline && child.exitCode === null) {
      try { ready = (await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (!ready) await delay(200);
    }
    assert.equal(ready, true, 'Recovered workspace did not start');
    const login = await fetchData('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account, password }) }, 201);
    const headers = { authorization: 'Bearer ' + login.accessToken };
    assert.equal(login.user.id, source.owner);
    assert.equal((await fetchData('/installation/status')).required, false);
    const history = await fetchData('/conversations/' + source.conversation, { headers });
    assert.equal(history.title, title);
    assert.equal(history.messages[0].content, content);
    const response = await fetch(base + '/upload/' + source.upload + '/raw', { headers, signal: AbortSignal.timeout(7000) });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), attachment);
    console.log('QGauss 已在独立机器验证原账户、对话全文和附件');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await ended;
  }
}
