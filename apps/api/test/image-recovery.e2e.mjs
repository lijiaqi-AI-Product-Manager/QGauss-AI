/** Crash actual child APIs against one private DB; all image responses remain on loopback. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { upgradeIsolatedDatabase } from './isolated-migrations.mjs';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(join(tmpdir(), 'qgauss-image-recovery-'));
const database = join(directory, 'recovery.db');
const snapshot = new DatabaseSync(join(root,'prisma/dev.db'),{readOnly:true});
try { await backup(snapshot,database); } finally { snapshot.close(); }
await upgradeIsolatedDatabase(database);
const FAKE = process.env.E2E_FAKE || 'http://127.0.0.1:9899/v1';
const upstream = 'qgauss-image-hold-recovery-' + randomBytes(6).toString('hex');
const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#9aacee' } }).png().toBuffer();
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = 'http://127.0.0.1:' + port + '/api';
const env = { ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_URL: 'file:' + database.replace(/\\/g, '/'), MAIL_SMTP_HOST: '', STORAGE_DRIVER: 'local', STORAGE_DIR: join(directory, 'files'), JWT_SECRET: randomBytes(48).toString('hex'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), TRUST_PROXY: 'false', ALLOW_HTTP_UPSTREAM: '1', UPSTREAM_PORT_ALLOWLIST: new URL(FAKE).port, UPSTREAM_PRIVATE_ALLOWLIST: new URL(FAKE).host };
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
let child, logs = '', admin = '', passed = 0;
const children = new Set();
process.on('exit', () => { for (const process of children) if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL'); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, fn) { fn(); passed++; console.log('  ✔ ' + name); }
async function api(path, method = 'GET', body, token = admin) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  const raw = await res.json(); return { status: res.status, data: raw.data ?? raw };
}
async function start() {
  logs = '';
  child = spawn(process.execPath, ['dist/main.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  child.stdout.on('data', part => { logs = (logs + part).slice(-15000); });
  child.stderr.on('data', part => { logs = (logs + part).slice(-15000); });
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Recovery API stopped during startup: ' + logs);
    try { const health = await fetch(base + '/health', { signal: AbortSignal.timeout(500) }); if (health.ok) return; } catch {}
    await pause(250);
  }
  throw new Error('Recovery API did not become healthy: ' + logs);
}
async function crash() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
}
async function observations() { return (await (await fetch(new URL('/stats', FAKE))).json()).images.filter(row => row.model === upstream); }
async function awaitTask(id, token, status) {
  for (let i = 0; i < 80; i++) { const task = (await api('/image/tasks/' + id, 'GET', undefined, token)).data; if (task.status === status) return task; await pause(100); }
  throw new Error('Task did not reach ' + status);
}
try {
  await start();
  const login = await api('/auth/login', 'POST', { account: process.env.E2E_ADMIN || 'admin', password: process.env.E2E_PASSWORD || 'admin123456' }, ''); admin = login.data.accessToken; assert.ok(admin);
  const settings = { 'security.registerEnabled': true, 'security.registerRateLimit': 1000, 'security.registerInviteCode': '', 'security.captchaEnabled': false, 'commerce.enabled': true, 'commerce.imageCost': 1, 'demo.siteEnabled': false };
  assert.equal((await api('/settings', 'PUT', { settings: Object.entries(settings).map(([key, value]) => ({ key, value })) })).status, 200);
  const account = randomBytes(6).toString('hex');
  assert.equal((await api('/auth/register', 'POST', { email: account + '@qgauss.test', username: 'qgr' + account, password: 'qgauss-recovery-123' }, '')).status, 201);
  const signed = (await api('/auth/login', 'POST', { account: account + '@qgauss.test', password: 'qgauss-recovery-123' }, '')).data;
  const token = signed.accessToken;
  await api('/balance/upgradeBalance', 'POST', { userId: signed.user.id, drawMjCount: 10 });
  const channel = (await api('/models/channels', 'POST', { name: upstream, type: 'GEMINI', baseUrl: new URL('/v1beta', FAKE).href, apiKey: 'local-recovery-key', timeoutMs: 30000 })).data;
  const model = (await api('/models', 'POST', { name: upstream, displayName: 'QGauss 重启验收', capabilities: 'image', maxContext: 32000, maxOutput: 1024 })).data;
  await api('/models/' + model.id + '/channels', 'POST', { channelId: channel.id, upstreamName: upstream });
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'QGauss-recovery-output.png');
  const uploaded = await fetch(base + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
  const file = (await uploaded.json()).data; assert.ok(file.id);
  const outputForm=new FormData();outputForm.append('scope','image');outputForm.append('file',new Blob([png],{type:'image/png'}),'QGauss-staged-output.png');
  const outputResponse=await fetch(base+'/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:outputForm}),outputFile=(await outputResponse.json()).data;assert.ok(outputFile.id);assert.equal(outputFile.scope,'image');
  const running = (await api('/image/tasks', 'POST', { prompt: 'interrupt a real upstream call', model: upstream, mode: 'img2img', referenceIds: [file.id], n: 4, expectedUnitCost: 1 }, token)).data;
  await awaitTask(running.id, token, 'RUNNING');
  for (let i = 0; i < 60 && !(await observations()).length; i++) await pause(50);
  assert.ok((await observations()).length > 0);
  const saved = (await api('/image/tasks', 'POST', { prompt: 'durable staged fixture', model: upstream, n: 2, expectedUnitCost: 1 }, token)).data;
  await crash();
  check('实际 API 在请求上游期间被强制结束，预留和任务仍持久化', () => assert.ok(child.signalCode || child.exitCode !== null));
  // A deliberately constructed durable-output fixture replaces only this test-owned task.
  await prisma.imageTask.update({ where: { id: saved.id }, data: { status: 'SETTLING', progress: 95, resultJson: JSON.stringify([{ fileId: outputFile.id, mime: 'image/png', url: outputFile.url }]) } });
  const persisted = await prisma.countReservation.findUnique({ where: { refId: running.id } });
  const inputSnapshot = await prisma.imageTask.findUnique({ where: { id: running.id } });
  check('进程消失不会丢失已预留的次数、费用与参考图快照', () => { assert.equal(persisted.status, 'HELD'); assert.equal(persisted.amount, 4); assert.equal(JSON.parse(inputSnapshot.inputJson).references[0].id, file.id); });
  await prisma.$disconnect();
  const priorRequests = (await observations()).length;
  await start();
  const stopped = await awaitTask(running.id, token, 'FAILED');
  const complete = await awaitTask(saved.id, token, 'SUCCESS');
  const view = (await api('/balance/query', 'GET', undefined, token)).data;
  check('重启将中断生成标为失败并释放预留，不重新调用上游', () => { assert.equal(stopped.billing.returned, 4); assert.equal(stopped.billing.charged, 0); });
  check('已保存作品重启后继续结算，只扣实际张数并释放差额', () => { assert.equal(complete.results[0].fileId, outputFile.id); assert.equal(complete.billing.charged, 1); assert.equal(complete.billing.returned, 1); assert.equal(view.counts.drawMj, 9); assert.equal(view.reserved.drawMj, 0); });
  const requestsAfter = (await observations()).length;
  check('恢复结算没有新增图像请求，作品仍可下载原始字节', () => assert.equal(requestsAfter, priorRequests));
  const image = await fetch(new URL(complete.results[0].url, base), { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  await crash(); await start();
  const secondView = (await api('/balance/query', 'GET', undefined, token)).data;
  const expense = (await api('/balance/consumeLog?pageSize=100', 'GET', undefined, token)).data.items.filter(row => row.refId === saved.id && row.direction === 1);
  const finalRequests = (await observations()).length;
  check('再次重启不重复扣次、不重复写消费流水，也不重新生成', () => { assert.equal(secondView.counts.drawMj, 9); assert.equal(expense.reduce((n, row) => n + row.amount, 0), 1); assert.equal(finalRequests, priorRequests); });
} finally {
  await crash(); await prisma.$disconnect();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'qgauss-image-recovery-')) throw new Error('Recovery cleanup escaped its temporary root');
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log('\n绘画进程恢复：' + passed + ' 通过 / 0 失败');
