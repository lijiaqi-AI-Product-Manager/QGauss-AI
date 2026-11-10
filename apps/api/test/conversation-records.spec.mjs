import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import { SqliteClient } from '../dist/common/prisma/sqlite-client.js';
import { ChatLogService } from '../dist/modules/chatlog/chatlog.service.js';
import { ChatLogController } from '../dist/modules/chatlog/chatlog.controller.js';
import { parseChatLogQuery, recordPaging } from '../dist/modules/chatlog/chatlog.query.js';
const directory = mkdtempSync(join(tmpdir(), 'qgauss-records-')), base = join(directory, 'base.db'), here = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: base }, stdio: 'pipe', windowsHide: true });
after(() => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
const rejected = status => error => error.getStatus?.() === status;
async function fixture(t) {
  const path = join(directory, randomUUID() + '.db'); copyFileSync(base, path);
  const db = new SqliteClient({ datasources: { db: { url: 'file:' + path } } }); await db.$connect(); t.after(() => db.$disconnect());
  const admin = await db.user.create({ data: { username: 'operator', email: 'operator@qgauss.test', passwordHash: 'fixture', role: 'ADMIN' } });
  const user = await db.user.create({ data: { username: 'reader', email: 'reader@qgauss.test', passwordHash: 'fixture' } });
  const conversation = await db.conversation.create({ data: { userId: user.id, title: '灵感记录' } });
  const service = new ChatLogService(db), add = (extra = {}) => db.message.create({ data: { conversationId: conversation.id, role: 'ASSISTANT', content: '保留的回答', createdAt: new Date('2026-01-02T03:00:00.000Z'), ...extra } });
  return { db, admin, user, conversation, service, add };
}
function response() {
  const chunks = [], headers = new Map(), stream = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  stream.setHeader = (key, value) => headers.set(key.toLowerCase(), value); stream.on('error', () => {});
  return { stream, headers, chunks, buffer: () => Buffer.concat(chunks) };
}
async function workbook(f, query = {}, service = f.service) {
  const r = response(), count = await service.exportToStream(query, r.stream, f.admin.id), book = new ExcelJS.Workbook();
  await book.xlsx.load(r.buffer()); return { ...r, count, book, sheet: book.worksheets[0] };
}
function column(sheet, name) { return sheet.getRow(1).values.indexOf(name); }

test('query filters reject repeated, structured, oversized and unsupported values', () => {
  for (const value of [{ keyword: ['one','two'] }, { user: { contains: 'x' } }, { 'status[equals]': 'COMPLETED' }, { unknown: 'filter' }, { status: null }, { keyword: 'x'.repeat(401) }, { role: 'ADMIN' }, { kind: 'other' }, { scope: 'removed' }, { billingState: 'CHARGED' }]) assert.throws(() => parseChatLogQuery(value), rejected(400));
  assert.equal(parseChatLogQuery({ user: '  reader  ', keyword: '  100%_ready ' }).keyword, '100%_ready');
});
test('calendar dates, ordering and finite integral paging are checked before querying', () => {
  for (const query of [{ from: 'not-a-date' }, { from: '2026-02-31' }, { from: '2026-01-01T24:00:00Z' }, { from: '2026-02-01', to: '2026-01-01' }, { asOf: '9999-01-01T00:00:00Z' }]) assert.throws(() => parseChatLogQuery(query), rejected(400));
  for (const page of ['Infinity','1e4','1.5','-1','0','1000001',['2'],{}]) assert.throws(() => recordPaging({ page }), rejected(400));
  assert.throws(() => recordPaging({ pageSize: '201' }), rejected(400)); assert.deepEqual(recordPaging({}), { page: 1, pageSize: 20 });
});
test('equal timestamps use a stable id order and new records do not displace later pages', async t => {
  const f = await fixture(t); for (const id of ['record-a','record-d','record-b','record-c']) await f.add({ id });
  const first = await f.service.list({}, 1, 2); await f.add({ id: 'record-new', createdAt: new Date(Date.parse(first.asOf) + 1000) });
  const second = await f.service.list({ asOf: first.asOf }, 2, 2); assert.deepEqual([...first.items,...second.items].map(row => row.id), ['record-d','record-c','record-b','record-a']); assert.equal(second.total, 4);
});
test('user, exact model, role, billing and conversation filters intersect', async t => {
  const f = await fixture(t), selected = await f.add({ modelName: 'qgauss-chat', billingState: 'SETTLED', chargedAmount: 2 }); await f.add({ role: 'USER', modelName: 'qgauss-chat' }); await f.add({ modelName: 'qgauss-chat-plus' });
  const query = { user: 'reader@qgauss.test', modelName: 'qgauss-chat', role: 'ASSISTANT', billingState: 'SETTLED', conversationId: f.conversation.id };
  assert.deepEqual((await f.service.list(query)).items.map(row => row.id), [selected.id]); assert.equal((await f.service.list({ user: 'missing@qgauss.test' })).total, 0); assert.equal((await f.service.list({ userId: f.admin.id })).total, 0);
});
test('keyword and user search treat wildcard characters as literal text', async t => {
  const f = await fixture(t), selected = await f.add({ content: 'QGauss 100%_ready' }); await f.add({ content: 'QGauss 100XXready' });
  assert.deepEqual((await f.service.list({ keyword: '100%_' })).items.map(row => row.id), [selected.id]); assert.equal((await f.service.list({ user: '%' })).total, 0);
});
test('date filtering includes the last millisecond of a selected day', async t => {
  const f = await fixture(t); await f.add({ content: 'inside', createdAt: new Date('2026-01-02T23:59:59.999Z') }); await f.add({ content: 'outside', createdAt: new Date('2026-01-03T00:00:00Z') });
  assert.deepEqual((await f.service.list({ from:'2026-01-02T00:00:00Z',to:'2026-01-02T23:59:59.999Z' })).items.map(row => row.content), ['inside']);
});
test('trash is explicit and removed messages stay unavailable in every scope', async t => {
  const f = await fixture(t), active = await f.add(), trash = await f.db.conversation.create({ data: { userId: f.user.id, title: '已归档', deletedAt: new Date() } });
  const archived = await f.add({ conversationId: trash.id }); const removed = await f.add({ deletedAt: new Date() });
  assert.equal((await f.service.list({})).total, 2); assert.equal((await f.service.list({ scope:'active' })).items[0].id, active.id); assert.equal((await f.service.list({ scope:'trash' })).items[0].id, archived.id); await assert.rejects(() => f.service.detail(removed.id), rejected(404));
});
test('public rows retain unknown usage and public billing without settlement or channel fields', async t => {
  const f = await fixture(t); await f.add({ billingState:'SETTLING',reservedAmount:3,chargedAmount:0,settlementJson:'private-settlement-value',channelId:'private-channel',parts:'private-parts',agentJson:'private-agent' });
  const row = (await f.service.list({})).items[0], detail = await f.service.detail(row.id); assert.equal(row.promptTokens, null); assert.equal(row.billing.reserved, 3); assert.equal(row.billing.charged, 0);
  for (const value of [row,detail]) for (const forbidden of ['private-settlement-value','private-channel','private-parts','private-agent','settlementJson','channelId','reservedAmount']) assert.equal(JSON.stringify(value).includes(forbidden), false, forbidden);
  assert.equal(await f.db.usageRecord.count(), 0); assert.equal(await f.db.countReservation.count(), 0);
});
test('detail follows branches only inside the same conversation and excludes removed replies', async t => {
  const f = await fixture(t), parent = await f.add({ role:'USER',content:'原问题' }), reply = await f.add({ parentId:parent.id,reasoning:'保留的推理文本' }), alternate = await f.add({ parentId:parent.id });
  await f.add({ parentId:parent.id,deletedAt:new Date() }); const other = await f.db.conversation.create({ data:{userId:f.user.id,title:'另一会话'} }); await f.add({ conversationId:other.id,parentId:parent.id });
  const result = await f.service.detail(reply.id); assert.equal(result.parent.id,parent.id); assert.equal(result.reasoning,'保留的推理文本'); assert.equal(result.branchCount,2); assert.deepEqual(new Set(result.branches.map(row=>row.id)),new Set([reply.id,alternate.id]));
  assert.equal((await f.service.detail(parent.id)).branchCount,2); await assert.rejects(()=>f.service.detail('../invalid'),rejected(400));
});
test('long text and reasoning are reassembled exactly, including emoji at cell boundaries', async t => {
  const f = await fixture(t), content = 'x'.repeat(29999)+'🌈'+'文字'.repeat(20000), reasoning = 'y'.repeat(30001)+'💡'; const row = await f.add({ content,reasoning });
  const result = await workbook(f), contentColumn=column(result.sheet,'内容'),reasonColumn=column(result.sheet,'推理内容'); let restored='',restoredReason='';
  for(let index=2;index<=result.sheet.rowCount;index++){const line=result.sheet.getRow(index);assert.equal(line.getCell(column(result.sheet,'记录编号')).value,row.id);restored+=line.getCell(contentColumn).value||'';restoredReason+=line.getCell(reasonColumn).value||'';}
  assert.equal(restored,content);assert.equal(restoredReason,reasoning);assert.equal(result.count,1);assert.ok(result.book.worksheets.some(sheet=>sheet.name==='导出说明'));
});
test('export keeps formula-like content as plain strings and leaves unknown amounts blank', async t => {
  const f=await fixture(t);await f.add({content:'=HYPERLINK("https://qgauss.test","text")'});const result=await workbook(f),cell=result.sheet.getRow(2).getCell(column(result.sheet,'内容'));
  assert.equal(cell.type,ExcelJS.ValueType.String);assert.equal(result.sheet.getRow(2).getCell(column(result.sheet,'输入token')).value,null);assert.equal(result.sheet.getRow(2).getCell(column(result.sheet,'实扣')).value,null);assert.equal(result.headers.get('cache-control'),'no-store');
});
test('export shares filters, ordering and time boundary across multiple batches',async t=>{
  const f=await fixture(t);await f.db.message.createMany({data:Array.from({length:425},(_,i)=>({id:'row-'+String(i).padStart(4,'0'),conversationId:f.conversation.id,role:'ASSISTANT',content:'keep',modelName:i%2?'other':'qgauss-chat',createdAt:new Date('2026-01-02')}))});
  const query={modelName:'qgauss-chat'},listed=await f.service.list(query,1,200),next=await f.service.list({...query,asOf:listed.asOf},2,200),result=await workbook(f,{...query,asOf:listed.asOf});
  assert.equal(result.count,213);assert.deepEqual(Array.from({length:result.sheet.rowCount-1},(_,i)=>result.sheet.getRow(i+2).getCell(column(result.sheet,'记录编号')).value),[...listed.items,...next.items].map(row=>row.id));
});
test('export validates dates and role before writing any download headers',async t=>{
  const f=await fixture(t),one=response();await assert.rejects(()=>f.service.exportToStream({from:'bad'},one.stream,f.admin.id),rejected(400));assert.equal(one.headers.size,0);
  await f.db.user.update({where:{id:f.admin.id},data:{status:'DISABLED'}});const two=response();await assert.rejects(()=>f.service.exportToStream({},two.stream,f.admin.id),rejected(403));assert.equal(two.headers.size,0);
});
test('a broad export is refused before headers instead of returning a silently truncated file',async t=>{
  const f=await fixture(t),limited=new ChatLogService({user:f.db.user,$transaction:fn=>fn({$queryRaw:async()=>Array.from({length:20001},(_,i)=>({id:'row-'+i}))})}),r=response();
  await assert.rejects(()=>limited.exportToStream({},r.stream,f.admin.id),rejected(400));assert.equal(r.headers.size,0);
});
test('a disconnected download does not read message content or create a file',async t=>{
  const f=await fixture(t);await f.add();const r=response();r.stream.destroy();assert.equal(await f.service.exportToStream({},r.stream,f.admin.id),0);assert.equal(r.headers.size,0);assert.equal(r.buffer().length,0);
});
test('oversized text exports are refused before headers even when the record count fits',async t=>{
  const f=await fixture(t);let reads=0;const service=new ChatLogService({user:f.db.user,$transaction:fn=>fn({$queryRaw:async()=>++reads===1?[{id:'one'}]:[{bytes:64*1024*1024+1}]})}),r=response();await assert.rejects(()=>service.exportToStream({},r.stream,f.admin.id),rejected(400));assert.equal(r.headers.size,0);
});
test('revoking an administrator between export batches stops the response',async t=>{
  const f=await fixture(t);await f.add();let reads=0;const service=new ChatLogService({$transaction:f.db.$transaction.bind(f.db),user:{findFirst:async(...args)=>++reads===2?null:f.db.user.findFirst(...args)}}),r=response();
  await assert.rejects(()=>service.exportToStream({},r.stream,f.admin.id),rejected(403));assert.equal(r.stream.destroyed,true);assert.equal(await f.db.usageRecord.count(),0);
});
test('records created after membership is selected never enter the pending workbook',async t=>{
  const f=await fixture(t),original=await f.add();let reads=0;const service=new ChatLogService({$transaction:f.db.$transaction.bind(f.db),user:{findFirst:async(...args)=>{if(++reads===2)await f.add({id:'new-during-download'});return f.db.user.findFirst(...args);}}});const result=await workbook(f,{},service);assert.equal(result.count,1);assert.equal(result.sheet.getRow(2).getCell(column(result.sheet,'记录编号')).value,original.id);assert.equal(await f.db.message.count(),2);
});
test('all record controller routes require the administrator role',()=>{
  for(const method of ['list','detail','export'])assert.deepEqual(Reflect.getMetadata('roles',ChatLogController.prototype[method]),['ADMIN']);
});
