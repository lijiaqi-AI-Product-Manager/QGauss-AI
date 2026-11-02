/** Kill real API processes; all data, storage and upstream calls belong to this isolated loopback test. */
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
import { LedgerService } from '../dist/modules/commerce/ledger.service.js';
import { ChatAccountingService } from '../dist/modules/chat/chat-accounting.service.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), directory = mkdtempSync(join(tmpdir(), 'qgauss-chat-recovery-'));
const database = join(directory, 'recovery.db');
const snapshot = new DatabaseSync(join(root,'prisma/dev.db'),{readOnly:true});
try { await backup(snapshot,database); } finally { snapshot.close(); }
await upgradeIsolatedDatabase(database);
const fake = process.env.E2E_FAKE || 'http://127.0.0.1:9899/v1', tag = randomBytes(6).toString('hex');
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = 'http://127.0.0.1:' + port + '/api';
const env = { ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_URL: 'file:' + database.replace(/\\/g, '/'), MAIL_SMTP_HOST: '', STORAGE_DRIVER: 'local', STORAGE_DIR: join(directory, 'files'), JWT_SECRET: randomBytes(48).toString('hex'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), TRUST_PROXY: 'false', ALLOW_HTTP_UPSTREAM: '1', UPSTREAM_PORT_ALLOWLIST: new URL(fake).port, UPSTREAM_PRIVATE_ALLOWLIST: new URL(fake).host };
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const ledger = new LedgerService(prisma), accounting = new ChatAccountingService(prisma, ledger);
let child, logs = '', admin = '', token = '', passed = 0;
const children = new Set(), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
process.on('exit', () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
function check(name, fn) { fn(); passed++; console.log('  ✔ ' + name); }
async function api(path, method = 'GET', body, access = admin) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  const json = await res.json(); return { status: res.status, data: json.data ?? json };
}
async function start() {
  logs = ''; child = spawn(process.execPath, ['dist/main.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); children.add(child);
  child.stdout.on('data', part => { logs = (logs + part).slice(-15000); }); child.stderr.on('data', part => { logs = (logs + part).slice(-15000); });
  for (let i = 0; i < 160; i++) { if (child.exitCode !== null || child.signalCode !== null) throw new Error('Chat recovery API exited: ' + logs); try { const res = await fetch(base + '/health', { signal: AbortSignal.timeout(500) }); if (res.ok) return; } catch {} await pause(250); }
  throw new Error('Chat recovery API not ready: ' + logs);
}
async function crash() { if (!child || child.exitCode !== null || child.signalCode !== null) return; const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; }
const requests = async () => (await (await fetch(new URL('/stats', fake))).json()).requests['qgauss-run-hold'] || 0;
try {
  await start();
  admin = (await api('/auth/login', 'POST', { account: process.env.E2E_ADMIN || 'admin', password: process.env.E2E_PASSWORD || 'admin123456' }, '')).data.accessToken; assert.ok(admin);
  const values = { 'security.registerEnabled': true, 'security.registerRateLimit': 1000, 'security.registerInviteCode': '', 'security.captchaEnabled': false, 'commerce.enabled': true, 'demo.siteEnabled': false, 'chat.maxConcurrentStreams': 3, 'chat.runDetachedTimeoutMs': 120000 };
  assert.equal((await api('/settings', 'PUT', { settings: Object.entries(values).map(([key, value]) => ({ key, value })) })).status, 200);
  assert.equal((await api('/auth/register', 'POST', { email: tag + '@qgauss.test', username: 'qgcr' + tag, password: 'qgauss-recovery-123' }, '')).status, 201);
  const signed = (await api('/auth/login', 'POST', { account: tag + '@qgauss.test', password: 'qgauss-recovery-123' }, '')).data; token = signed.accessToken;
  await api('/balance/upgradeBalance', 'POST', { userId: signed.user.id, model3Count: 10 });
  const channel = (await api('/models/channels', 'POST', { name: 'chat-recovery-' + tag, type: 'OPENAI', baseUrl: fake, timeoutMs: 30000 })).data;
  const model = (await api('/models', 'POST', { name: 'chat-recovery-' + tag, displayName: 'QGauss 对话恢复验收', countPool: 'model3', countCost: 2, capabilities: 'chat', maxContext: 32000, maxOutput: 1024 })).data;
  await api('/models/' + model.id + '/channels', 'POST', { channelId: channel.id, upstreamName: 'qgauss-run-hold' });
  const requestCountBefore = await requests();
  const response = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ model: model.name, messages: [{ role: 'user', content: '验证真实进程中断后的次数释放' }] }), signal: AbortSignal.timeout(30000) });
  assert.equal(response.ok, true); const reader = response.body.getReader(), decoder = new TextDecoder(); let wire = '', meta;
  while (!meta) { const part = await reader.read(); if (part.done) throw new Error('No chat metadata'); wire += decoder.decode(part.value); const data = wire.match(/event: meta\ndata: (.+)/)?.[1]; if (data) meta = JSON.parse(data); }
  for (let i = 0; i < 60 && (await requests()) === requestCountBefore; i++) await pause(50);
  assert.ok((await requests()) > requestCountBefore);
  const initialView = (await api('/balance/query', 'GET', undefined, token)).data;
  check('真实上游请求期间，次数已经预留且尚未计入实际消耗', () => { assert.equal(initialView.counts.model3, 8); assert.equal(initialView.reserved.model3, 2); assert.equal(initialView.used.model3, 0); });
  await crash(); void reader.cancel().catch(() => {});
  const held = await prisma.countReservation.findUnique({ where: { refId: meta.messageId } });
  check('强制结束实际 API 后，接受时的费用与预留仍在数据库', () => { assert.equal(held.status, 'HELD'); assert.equal(held.amount, 2); assert.equal(meta.billing.limit, 2); });
  // Construct only one test-owned saved-result fixture; the running request above was real HTTP.
  const staged = await prisma.message.create({ data: { conversationId: meta.conversationId, role: 'ASSISTANT', status: 'PENDING', modelName: model.name } });
  await prisma.$transaction(tx => accounting.acceptTx(tx, signed.user.id, staged, { pool: 'model3', amount: 2 }));
  await accounting.stage(staged.id, { status: 'COMPLETED', content: '本地构造的已保存完整回复', reasoning: null, promptTokens: 5, completionTokens: 10, finishReason: 'stop', errorCode: null, ttfbMs: 1, durationMs: 20, channelId: channel.id, usage: { userId: signed.user.id, modelName: model.name, priceInPerM: 0, priceOutPerM: 0, costMicros: 0 } });
  const beforeRequests = await requests();
  await start();
  const interrupted = (await api('/conversations/' + meta.conversationId + '/messages/' + meta.messageId, 'GET', undefined, token)).data;
  const completed = (await api('/conversations/' + meta.conversationId + '/messages/' + staged.id, 'GET', undefined, token)).data;
  const view = (await api('/balance/query', 'GET', undefined, token)).data;
  check('启动时立即标记中断回复并释放次数，不等待卡死清理时间', () => { assert.equal(interrupted.status, 'FAILED'); assert.equal(interrupted.billing.returned, 2); assert.equal(interrupted.billing.charged, 0); });
  check('已保存完整回复在重启后只继续结算，回复、用量与账本一致', () => { assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.content, '本地构造的已保存完整回复'); assert.equal(completed.billing.charged, 2); assert.equal(view.counts.model3, 8); assert.equal(view.reserved.model3, 0); assert.equal(view.used.model3, 2); });
  const afterRequests = await requests();
  check('恢复没有重发原问题或调用新的上游生成', () => assert.equal(afterRequests, beforeRequests));
  const snapshotResponse = await fetch(base + '/chat/runs/' + staged.id + '/events', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
  const snapshot = await snapshotResponse.text();
  check('数据库快照续接同时返回原回复和当时实际消耗', () => { assert.match(snapshot, /"charged":\{"pool":"model3","amount":2\}/); assert.match(snapshot, /本地构造的已保存完整回复/); });
  await crash(); await start();
  const second = (await api('/balance/query', 'GET', undefined, token)).data;
  const usage = await prisma.usageRecord.count({ where: { messageId: staged.id } });
  check('再次重启不重复扣费、不重复用量、没有遗留预留', () => { assert.equal(second.counts.model3, 8); assert.equal(second.used.model3, 2); assert.equal(second.reserved.model3, 0); assert.equal(usage, 1); });
} finally {
  await crash(); await prisma.$disconnect();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'qgauss-chat-recovery-')) throw new Error('Chat recovery cleanup escaped private directory');
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log('\n对话进程恢复：' + passed + ' 通过 / 0 失败');
