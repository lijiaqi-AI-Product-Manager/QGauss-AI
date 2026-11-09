/** Real SQLite and chat orchestration, with only the upstream stream replaced by a controlled local producer. */
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {SqliteClient as PrismaClient} from '../dist/common/prisma/sqlite-client.js';
import { LedgerService } from '../dist/modules/commerce/ledger.service.js';
import { ChatAccountingService } from '../dist/modules/chat/chat-accounting.service.js';
import { ChatService } from '../dist/modules/chat/chat.service.js';
import { ConversationsService } from '../dist/modules/conversations/conversations.service.js';

const here = dirname(fileURLToPath(import.meta.url)), directory = mkdtempSync(join(tmpdir(), 'qgauss-chat-accounting-'));
const database = join(directory, 'chat.db');
execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: database }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + database.replace(/\\/g, '/') } } });
const fixtures = new Set();
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const status = expected => error => { assert.equal(error.getStatus(), expected); return true; };
class Response extends EventEmitter {
  writableEnded = false; destroyed = false; packets = []; ready = defer();
  setHeader() {} flushHeaders() {}
  write(wire) { const event = wire.match(/^event: (.+)/m)?.[1], json = wire.match(/^data: (.+)/m)?.[1]; if (json) { const packet = { event, data: JSON.parse(json) }; this.packets.push(packet); if (event === 'meta') this.ready.resolve(packet.data); } return true; }
  end(wire) { if (wire) this.write(wire); this.writableEnded = true; }
}
async function fixture(grant = { model3Count: 10 }) {
  const id = randomUUID(), user = await prisma.user.create({ data: { email: id + '@qgauss.test', username: id, passwordHash: 'local isolated fixture' } });
  const model = await prisma.aiModel.create({ data: { name: 'chat-' + id, displayName: 'QGauss 次数验收', countPool: 'model3', countCost: 2, priceInPerM: 1000000, priceOutPerM: 1000000 } });
  const ledger = new LedgerService(prisma); await ledger.grant(user.id, { ...grant, rechargeType: 'admin' });
  const accounting = new ChatAccountingService(prisma, ledger);
  const config = { 'commerce.enabled': true, 'demo.siteEnabled': false, 'chat.maxConcurrentStreams': 4, 'chat.runDetachedTimeoutMs': 120000 };
  const settings = { get: async key => config[key] }, controls = [], pending = [];
  const service = new ChatService(prisma, { resolveRoute: async () => ({ model: { ...model }, channels: [{ id: id + '-channel', type: 'MOCK', name: 'local controlled stream' }] }) }, settings,
    { isAvailable: () => true, tryAcquire: () => true, recordSuccess() {}, recordFailure() {}, coolDown() {} },
    { assertWithinQuota: async () => {} }, { check: async () => null }, {}, { tryConsume: () => true }, accounting, {}, { hasAttachments: () => false });
  service.streamMock = async (_prompt, _system, run, signal, first) => {
    const wait = defer(); controls.push({ release: wait.resolve, fail: () => wait.reject(new Error('local upstream failure')) });
    first(); run.emit('delta', { v: '已产生的回复内容' });
    const abort = () => wait.resolve(); signal.addEventListener('abort', abort, { once: true });
    try { await wait.promise; } finally { signal.removeEventListener('abort', abort); }
    return { text: run.content };
  };
  const send = extra => {
    const response = new Response();
    const done = service.completions(user.id, { model: model.name, clientMsgId: randomUUID(), messages: [{ role: 'user', content: '检查次数和回复是否一致' }], ...extra }, response);
    pending.push(done); done.catch(() => {});
    return { response, done, started: Promise.race([response.ready.promise, done.then(() => { throw new Error('closed before meta'); })]) };
  };
  const start = async extra => { const request = send(extra); const meta = await request.started; return { ...request, meta }; };
  const view = () => ledger.view(user.id), logs = refId => prisma.balanceConsumeLog.findMany({ where: { refId } });
  const conversation = new ConversationsService(prisma, service);
  const f = { user, model, ledger, accounting, config, settings, service, controls, pending, send, start, view, logs, conversation };
  fixtures.add(f); return f;
}
afterEach(async () => { for (const f of fixtures) { f.service.onModuleDestroy(); for (const control of f.controls) control.release(); await Promise.allSettled(f.pending); } fixtures.clear(); });
after(async () => { await prisma.$disconnect(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'qgauss-chat-accounting-')); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('an older admission keeps a newer saved model choice while billing the submitted model exactly once', async () => {
  const f=await fixture(),conv=await prisma.conversation.create({data:{userId:f.user.id,title:'原对话'}}),next=await prisma.aiModel.create({data:{name:'next-'+randomUUID(),displayName:'下一轮模型',channels:{create:{upstreamName:'qgauss-next',channel:{create:{name:randomUUID(),type:'MOCK',baseUrl:'mock://local'}}}}}}),entered=defer(),resume=defer();
  let produced=0;f.service.streamMock=async (_prompt,_system,run,_signal,first)=>{produced++;first();run.emit('delta',{v:'原请求的回答'});return{text:run.content};};
  f.settings.get=async key=>{if(key==='chat.runDetachedTimeoutMs'){entered.resolve();await resume.promise;}return f.config[key];};
  const opening=f.start({conversationId:conv.id});await Promise.race([entered.promise,opening.then(()=>{throw Error('request passed the admission gate unexpectedly');}),new Promise((_,reject)=>{const timer=setTimeout(()=>{resume.resolve();reject(Error('admission gate was not reached'));},4000);timer.unref();})]);
  await f.conversation.update(f.user.id,conv.id,{modelId:next.id,expectedVersion:1});resume.resolve();
  const request=await opening,meta=request.meta;await request.done;
  const saved=await prisma.conversation.findUnique({where:{id:conv.id}}),answer=await prisma.message.findUnique({where:{id:meta.messageId}});
  assert.equal(saved.modelId,next.id);assert.equal(saved.version,3);assert.equal(answer.modelName,f.model.name);assert.equal((await f.view()).used.model3,2);assert.equal(produced,1);
});

test('admission preserves a renamed and pinned conversation and replay leaves its confirmed history version unchanged', async () => {
  const f=await fixture(),conv=await prisma.conversation.create({data:{userId:f.user.id,modelId:f.model.id}}),entered=defer(),resume=defer();
  let produced=0;f.service.streamMock=async (_prompt,_system,run,_signal,first)=>{produced++;first();run.emit('delta',{v:'原请求的回答'});return{text:run.content};};
  f.settings.get=async key=>{if(key==='chat.runDetachedTimeoutMs'){entered.resolve();await resume.promise;}return f.config[key];};
  const opening=f.start({conversationId:conv.id,clientMsgId:'same-original-question'});await Promise.race([entered.promise,opening.then(()=>{throw Error('request passed the admission gate unexpectedly');}),new Promise((_,reject)=>{const timer=setTimeout(()=>{resume.resolve();reject(Error('admission gate was not reached'));},4000);timer.unref();})]);
  await f.conversation.update(f.user.id,conv.id,{title:'本人保存的标题 {count} $&',pinned:true,expectedVersion:1});resume.resolve();
  const request=await opening;await request.done;
  const before=await prisma.conversation.findUnique({where:{id:conv.id}});assert.equal(before.title,'本人保存的标题 {count} $&');assert.ok(before.pinnedAt);assert.equal(before.version,3);
  const replay=await f.start({conversationId:conv.id,clientMsgId:'same-original-question'});await replay.done;const after=await prisma.conversation.findUnique({where:{id:conv.id}});
  assert.equal(after.version,before.version);assert.equal(after.lastMessageAt.getTime(),before.lastMessageAt.getTime());assert.equal(after.title,before.title);assert.equal(produced,1);assert.equal((await f.view()).used.model3,2);
});

test('0022 upgrade preserves legacy reply content and status without charging historical answers', () => {
  const file = join(directory, 'legacy.db'), migrations = join(here, '../prisma/migrations'), db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL,appliedAt DATETIME NOT NULL)');
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql') && name < '0023').sort()) { db.exec(readFileSync(join(migrations, name), 'utf8')); db.prepare('INSERT INTO _migrations VALUES (?,?)').run(name, new Date().toISOString()); }
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users(id,email,username,passwordHash,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run('old-user', 'legacy@qgauss.test', 'legacy-owner', 'isolated fixture', now, now);
    db.prepare('INSERT INTO conversations(id,userId,lastMessageAt,createdAt,updatedAt) VALUES (?,?,?,?,?)').run('old-conversation', 'old-user', now, now, now);
    db.prepare('INSERT INTO messages(id,conversationId,role,status,content,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)').run('old-answer', 'old-conversation', 'ASSISTANT', 'COMPLETED', '原回复完整保留', new Date().toISOString(), new Date().toISOString());
  } finally { db.close(); }
  execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: file }, stdio: 'pipe' });
  const upgraded = new DatabaseSync(file);
  try { const row = upgraded.prepare('SELECT * FROM messages WHERE id=?').get('old-answer'); assert.equal(row.content, '原回复完整保留'); assert.equal(row.status, 'COMPLETED'); assert.equal(row.billingState, 'LEGACY'); assert.equal(row.reservedAmount, 0); assert.equal(upgraded.prepare('SELECT count(*) n FROM count_reservations').get().n, 0); assert.equal(Object.values(upgraded.prepare('pragma integrity_check').get())[0], 'ok'); } finally { upgraded.close(); }
});

test('one affordable conversation wins concurrent admission; denied request never invokes upstream', async () => {
  const f = await fixture({ model3Count: 2 });
  const results = await Promise.allSettled([f.start(), f.start()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.getStatus(), 402);
  const accepted = results.find(r => r.status === 'fulfilled').value;
  assert.equal(f.controls.length, 1); assert.equal((await f.view()).counts.model3, 0); assert.equal((await f.view()).reserved.model3, 2); assert.equal((await f.view()).used.model3, 0);
  assert.equal(await prisma.conversation.count({ where: { userId: f.user.id } }), 1, 'denied admission must not leave an empty conversation');
  f.controls[0].release(); await accepted.done;
  assert.equal((await f.view()).used.model3, 2); assert.equal(await prisma.message.count({ where: { conversation: { userId: f.user.id }, role: 'ASSISTANT' } }), 1);
});

test('same client message concurrent retry creates one parent, answer and reservation', async () => {
  const f = await fixture(), conv = await f.conversation.create(f.user.id, f.model.id);
  const results = await Promise.allSettled([1, 2].map(() => f.start({ conversationId: conv.id, clientMsgId: 'same-request' })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.getStatus(), 409);
  assert.equal(await prisma.message.count({ where: { conversationId: conv.id } }), 2); assert.equal(await prisma.countReservation.count({ where: { userId: f.user.id } }), 1);
});

test('accepted price survives model changes and commerce shutdown; completion and usage commit once', async () => {
  const f = await fixture(), request = await f.start();
  assert.deepEqual(request.meta.billing, { state: 'RESERVED', pool: 'model3', limit: 2, reserved: 2, charged: 0, returned: 0, expired: 0 });
  f.model.countCost = 9; f.config['commerce.enabled'] = false; f.controls[0].release(); await request.done;
  await f.accounting.complete(request.meta.messageId); await f.accounting.recover(request.meta.messageId);
  const row = await prisma.message.findUnique({ where: { id: request.meta.messageId } });
  assert.equal(row.status, 'COMPLETED'); assert.equal(row.chargedAmount, 2); assert.equal(row.settlementJson, null); assert.equal((await f.view()).counts.model3, 8);
  assert.equal(await prisma.usageRecord.count({ where: { messageId: row.id } }), 1); assert.equal((await f.logs(row.id)).filter(x => x.direction === 1).reduce((sum, x) => sum + x.amount, 0), 2);
});

test('accepted free response never acquires a later charge', async () => {
  const f = await fixture({ model3Count: 0 }); f.config['commerce.enabled'] = false;
  const request = await f.start(); f.config['commerce.enabled'] = true; f.controls[0].release(); await request.done;
  const row = await prisma.message.findUnique({ where: { id: request.meta.messageId } }); assert.equal(row.billingState, 'FREE'); assert.equal(row.chargedAmount, 0); assert.equal((await f.logs(row.id)).length, 0);
});

test('explicit cancellation and upstream failure release once, preserve partial text and never count as completed usage', async () => {
  const f = await fixture({ model3Count: 4 }), stopped = await f.start();
  assert.equal((await f.service.cancel(f.user.id, stopped.meta.messageId)).cancelRequested, true); await stopped.done;
  assert.equal((await f.service.cancel(f.user.id, stopped.meta.messageId)).cancelRequested, false);
  const failed = await f.start(); f.controls[1].fail(); await failed.done;
  for (const id of [stopped.meta.messageId, failed.meta.messageId]) { const row = await prisma.message.findUnique({ where: { id } }); assert.equal(row.billingState, 'RELEASED'); assert.equal(row.returnedAmount, 2); assert.match(row.content, /已产生/); assert.equal(row.chargedAmount, 0); }
  const view = await f.view(); assert.equal(view.counts.model3, 4); assert.equal(view.used.model3, 0); assert.equal(view.reserved.model3, 0);
});

test('replaying a completed answer works at zero availability and does not reserve or invoke upstream again', async () => {
  const f = await fixture({ model3Count: 2 }), conv = await f.conversation.create(f.user.id, f.model.id);
  const first = await f.start({ conversationId: conv.id, clientMsgId: 'replay' }); f.controls[0].release(); await first.done;
  const replay = await f.start({ conversationId: conv.id, clientMsgId: 'replay' }); await replay.done;
  assert.equal(replay.meta.messageId, first.meta.messageId); assert.equal(replay.meta.replay, true); assert.equal(f.controls.length, 1); assert.equal((await f.view()).counts.model3, 0);
});

test('failure after reservation creation rolls admission, messages and ledger back together', async () => {
  const f = await fixture(); const original = f.accounting.acceptTx.bind(f.accounting);
  f.accounting.acceptTx = async (...args) => { await original(...args); throw new Error('injected admission failure'); };
  await assert.rejects(f.start(), /injected admission/); assert.equal((await f.view()).counts.model3, 10); assert.equal(await prisma.countReservation.count({ where: { userId: f.user.id } }), 0); assert.equal(await prisma.message.count({ where: { conversation: { userId: f.user.id } } }), 0); assert.equal(f.controls.length, 0);
  assert.equal(await prisma.conversation.count({ where: { userId: f.user.id } }), 0);
});

test('settlement failure cannot announce completion; saved result settles later without a second generation', async () => {
  const f = await fixture(), request = await f.start(), original = f.ledger.settleCountReservationTx.bind(f.ledger);
  f.ledger.settleCountReservationTx = async (...args) => { await original(...args); throw new Error('injected settlement failure'); };
  f.controls[0].release(); await request.done;
  const staged = await prisma.message.findUnique({ where: { id: request.meta.messageId } });
  assert.equal(staged.status, 'SETTLING'); assert.match(staged.content, /已产生/); assert.ok(staged.settlementJson); assert.equal(request.response.packets.some(x => x.event === 'done'), false);
  assert.equal((await f.view()).used.model3, 0); assert.equal((await f.logs(staged.id)).filter(x => x.direction === 1).length, 0); assert.equal(await prisma.usageRecord.count({ where: { messageId: staged.id } }), 0);
  f.ledger.settleCountReservationTx = original; await Promise.all([f.accounting.complete(staged.id), f.accounting.complete(staged.id)]);
  assert.equal((await f.view()).used.model3, 2); assert.equal(f.controls.length, 1); assert.equal(await prisma.usageRecord.count({ where: { messageId: staged.id } }), 1);
});

test('failure to write usage rolls back settled counts and completed state', async () => {
  const f = await fixture(), request = await f.start(); f.controls[0].release(); await request.done;
  // Create a separate accepted message with a conflicting usage record, provoking a real unique-key failure.
  const msg = await prisma.message.create({ data: { conversationId: request.meta.conversationId, role: 'ASSISTANT', status: 'PENDING', modelName: f.model.name } });
  await prisma.$transaction(tx => f.accounting.acceptTx(tx, f.user.id, msg, { pool: 'model3', amount: 2 }));
  const outcome = { status: 'COMPLETED', content: '已保存的完整回复', reasoning: null, promptTokens: 5, completionTokens: 4, finishReason: 'stop', errorCode: null, ttfbMs: 1, durationMs: 10, channelId: null, usage: { userId: f.user.id, modelName: f.model.name, priceInPerM: 0, priceOutPerM: 0, costMicros: 0 } };
  await f.accounting.stage(msg.id, outcome); await prisma.usageRecord.create({ data: { userId: f.user.id, messageId: msg.id, modelName: f.model.name } });
  await assert.rejects(f.accounting.complete(msg.id));
  assert.equal((await prisma.message.findUnique({ where: { id: msg.id } })).status, 'SETTLING'); assert.equal((await prisma.countReservation.findUnique({ where: { refId: msg.id } })).status, 'HELD'); assert.equal((await f.logs(msg.id)).filter(x => x.direction === 1).length, 0);
  await prisma.usageRecord.delete({ where: { messageId: msg.id } }); await f.accounting.complete(msg.id); assert.equal((await f.view()).used.model3, 4);
});

test('old interrupted generation releases its reservation, while legacy rows are never retroactively charged', async () => {
  const f = await fixture(), conv = await f.conversation.create(f.user.id, f.model.id);
  const interrupted = await prisma.message.create({ data: { conversationId: conv.id, role: 'ASSISTANT', status: 'STREAMING', content: '重启前的部分文字', modelName: f.model.name } });
  await prisma.$transaction(tx => f.accounting.acceptTx(tx, f.user.id, interrupted, { pool: 'model3', amount: 2 }));
  const legacy = await prisma.message.create({ data: { conversationId: conv.id, role: 'ASSISTANT', status: 'STREAMING', content: '旧消息' } });
  await f.accounting.recover(interrupted.id); await f.accounting.recover(interrupted.id); await f.accounting.recover(legacy.id);
  const row = await prisma.message.findUnique({ where: { id: interrupted.id } }); assert.equal(row.status, 'FAILED'); assert.equal(row.errorCode, 'server_interrupted'); assert.equal(row.returnedAmount, 2); assert.equal(row.content, '重启前的部分文字'); assert.equal((await f.view()).counts.model3, 10); assert.equal((await f.logs(legacy.id)).length, 0);
});

test('interrupted search preserves safe sources after restart, releases once and never replays the provider', async () => {
  const f = await fixture(), conv = await f.conversation.create(f.user.id, f.model.id);
  const message = await prisma.message.create({ data: { conversationId: conv.id, role: 'ASSISTANT', status: 'STREAMING', content: '已保存的检索片段', modelName: f.model.name, searchJson: JSON.stringify({requested:true,status:'searching',sources:[{url:'https://sources.qgauss.test/recovered',title:'重启前的资料',encrypted_content:'private-result'}],citations:[{url:'https://sources.qgauss.test/recovered',start:2,end:2}]}) } });
  await prisma.$transaction(tx => f.accounting.acceptTx(tx, f.user.id, message, {pool:'model3',amount:2}));
  await f.accounting.recover(message.id); await f.accounting.recover(message.id);
  const saved = await f.conversation.getMessage(f.user.id,conv.id,message.id);
  assert.equal(saved.status,'FAILED');assert.equal(saved.webSearch.status,'interrupted');assert.equal(saved.webSearch.sources.length,1);assert.equal(saved.webSearch.citations.length,1);assert.equal(saved.content,'已保存的检索片段');assert.equal('searchJson' in saved,false);assert.doesNotMatch(JSON.stringify(saved.webSearch),/encrypted|private-result/);
  assert.equal((await f.view()).counts.model3,10);assert.equal((await f.view()).reserved.model3,0);assert.equal(f.controls.length,0);
});

test('saved search result completes settlement after recovery without altering citations or charging twice', async () => {
  const f = await fixture(), conv = await f.conversation.create(f.user.id,f.model.id), message = await prisma.message.create({data:{conversationId:conv.id,role:'ASSISTANT',status:'PENDING',modelName:f.model.name}});
  await prisma.$transaction(tx=>f.accounting.acceptTx(tx,f.user.id,message,{pool:'model3',amount:2}));
  const webSearch={requested:true,status:'complete',sources:[{url:'https://sources.qgauss.test/saved',title:'完整资料'}],citations:[{url:'https://sources.qgauss.test/saved',start:4,end:4}]};
  await f.accounting.stage(message.id,{status:'COMPLETED',content:'完整回答',reasoning:null,promptTokens:4,completionTokens:4,finishReason:'stop',errorCode:null,ttfbMs:1,durationMs:2,channelId:null,usage:null,webSearch});
  await f.accounting.recover(message.id);await f.accounting.recover(message.id);
  const saved=await f.conversation.getMessage(f.user.id,conv.id,message.id);assert.equal(saved.status,'COMPLETED');assert.deepEqual(saved.webSearch,webSearch);assert.equal((await f.view()).used.model3,2);assert.equal(f.controls.length,0);
});

test('clearing a running conversation hides messages, cancels upstream and retains authorization until release', async () => {
  const f = await fixture(), request = await f.start(); await f.conversation.clearMessages(f.user.id, request.meta.conversationId); await request.done;
  assert.equal((await f.conversation.detail(f.user.id, request.meta.conversationId)).messages.length, 0); assert.equal((await f.view()).counts.model3, 10); assert.equal((await f.view()).reserved.model3, 0);
  const row = await prisma.message.findUnique({ where: { id: request.meta.messageId } }); assert.ok(row.deletedAt); assert.equal(row.billingState, 'RELEASED');
});

test('cross-account reads stay forbidden and client history never includes settlement snapshots', async () => {
  const f = await fixture(), request = await f.start(), other = await fixture();
  await assert.rejects(f.service.events(other.user.id, request.meta.messageId, null, new Response()), status(404));
  await assert.rejects(f.service.cancel(other.user.id, request.meta.messageId), status(404));
  assert.equal((await f.conversation.detail(f.user.id, request.meta.conversationId)).messages.some(x => 'settlementJson' in x), false);
});

test('midnight cancellation does not restore old member allowance into a new day', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T15:59:59Z') });
  const f = await fixture({ model3Count: 3, days: 2, dailyModel3Count: 2 }), request = await f.start();
  t.mock.timers.tick(2000); await f.service.cancel(f.user.id, request.meta.messageId); await request.done;
  const view = await f.view(), row = await prisma.message.findUnique({ where: { id: request.meta.messageId } });
  assert.equal(view.member.model3, 2); assert.equal(view.paid.model3, 3); assert.equal(row.expiredAmount, 2); assert.equal(row.returnedAmount, 0);
});

test('a pending reply cannot be regenerated, and a cleared parent cannot be reused by retry', async () => {
  const f = await fixture(), conv = await f.conversation.create(f.user.id, f.model.id), request = await f.start({ conversationId: conv.id, clientMsgId: 'cleared-parent' });
  await assert.rejects(f.start({ conversationId: conv.id, regenerateOf: request.meta.messageId }), status(409));
  await f.conversation.clearMessages(f.user.id, conv.id); await request.done;
  await assert.rejects(f.start({ conversationId: conv.id, clientMsgId: 'cleared-parent' }), status(409));
  assert.equal((await f.view()).counts.model3, 10); assert.equal((await f.conversation.detail(f.user.id, conv.id)).messages.length, 0);
});

test('fresh admission cannot be mistaken for a dead process when a second observer arrives', async () => {
  const f = await fixture(), conv = await f.conversation.create(f.user.id, f.model.id), message = await prisma.message.create({ data: { conversationId: conv.id, role: 'ASSISTANT', status: 'PENDING', modelName: f.model.name } });
  await prisma.$transaction(tx => f.accounting.acceptTx(tx, f.user.id, message, { pool: 'model3', amount: 2 }));
  const observer = new Response(); await f.service.events(f.user.id, message.id, null, observer);
  assert.equal(observer.packets[0].data.status, 'PENDING'); assert.equal((await f.view()).reserved.model3, 2);
  await f.accounting.recover(message.id); assert.equal((await f.view()).reserved.model3, 0);
});

test('transient output-save failure retries the same saved result without extra provider calls or charges', async () => {
  const f = await fixture(), request = await f.start(), original = f.accounting.stage.bind(f.accounting); let attempts = 0;
  f.accounting.stage = async (...args) => { if (++attempts === 1) throw new Error('transient save fixture'); return original(...args); };
  f.controls[0].release(); await request.done;
  assert.equal(attempts, 2); assert.equal(f.controls.length, 1); assert.equal(request.response.packets.at(-1).data.status, 'COMPLETED'); assert.equal((await f.view()).used.model3, 2); assert.equal((await f.view()).reserved.model3, 0);
});
