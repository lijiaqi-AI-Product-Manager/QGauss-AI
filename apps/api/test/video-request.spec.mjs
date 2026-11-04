import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {VideoService} from '../dist/modules/video/video.service.js';
import {VideoAccountingService} from '../dist/modules/video/video-accounting.service.js';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {videoRequest} from '../dist/modules/video/video-request.js';

const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-video-request-')),base=join(folder,'base.db');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=n=>e=>e.getStatus?.()===n,deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-video-request-'));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
async function fixture(t){
 const database=join(folder,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database.replaceAll('\\','/')}}});t.after(()=>db.$disconnect());
 const owner=await db.user.create({data:{username:'owner',email:'owner@qgauss.test',passwordHash:'fixture-only'}}),other=await db.user.create({data:{username:'other',email:'other@qgauss.test',passwordHash:'fixture-only'}}),ledger=new LedgerService(db);
 for(const user of[owner,other])await db.$transaction(async tx=>{await ledger.ensureTx(tx,user.id);await ledger.grantTx(tx,user.id,{drawMjCount:100,extent:'video-request-fixture'});});
 const preset=await db.videoPreset.create({data:{name:'QGauss request test',profile:'ARK_2_5',baseCost:2,perSecondCost:1,pool:'drawMj',maxWaitMinutes:5}}),aborted=[];
 const makeService=client=>new VideoService(client,{get:async()=>1000},{},{},new VideoAccountingService(client,new LedgerService(client)),{},{abort:id=>aborted.push(id)},new RateLimitService(),{});
 const service=makeService(db),plan=dto=>({preset,intent:{mode:'text',prompt:dto.prompt.trim(),ratio:'adaptive',seconds:5,resolution:'720p'},inputs:null,revision:'a'.repeat(64),cost:7});service.prepare=async(user,dto)=>plan(dto);
 const body=(requestKey=randomUUID())=>({requestKey,presetId:preset.id,prompt:'同一个画面，只开机一次。',mode:'text',ratio:'adaptive',seconds:5,resolution:'720p',quoteRevision:'a'.repeat(64)}),balance=()=>db.userBalance.findUniqueOrThrow({where:{userId:owner.id}});
 return{db,database,owner,other,preset,service,makeService,plan,body,balance,aborted};
}

test('ending an unaccepted request is durable and cannot create a task or reserve credits',async t=>{
 const f=await fixture(t),dto=f.body(),before=await f.balance();let prepared=0;f.service.prepare=async()=>{prepared++;throw Error('must not prepare');};
 for(let n=0;n<3;n++)assert.deepEqual(await f.service.endRequest(f.owner.id,dto.requestKey),{ended:true,requestKey:dto.requestKey});
 await assert.rejects(f.service.create(f.owner.id,dto),status(410));await assert.rejects(f.service.byRequest(f.owner.id,dto.requestKey),status(410));assert.equal(prepared,0);assert.equal(await f.db.videoTask.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.equal(await f.db.videoRequest.count(),1);assert.deepEqual(await f.balance(),before);
});
test('ending through another connection during preparation fences the late original admission',async t=>{
 const f=await fixture(t),dto=f.body(),entered=deferred(),release=deferred(),second=new SqliteClient({datasources:{db:{url:'file:'+f.database.replaceAll('\\','/')}}});t.after(()=>second.$disconnect());const otherService=f.makeService(second),before=await f.balance();
 f.service.prepare=async(user,body)=>{entered.resolve();await release.promise;return f.plan(body);};const submitted=f.service.create(f.owner.id,dto),rejected=assert.rejects(submitted,status(410));await entered.promise;assert.equal((await otherService.endRequest(f.owner.id,dto.requestKey)).ended,true);release.resolve();await rejected;assert.equal(await f.db.videoTask.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.deepEqual(await f.balance(),before);
});
test('accepted work remains the original task when ending or replaying; nothing is canceled implicitly',async t=>{
 const f=await fixture(t),dto=f.body(),task=await f.service.create(f.owner.id,dto),row=await f.db.videoTask.findUniqueOrThrow({where:{id:task.id}}),before=await f.balance();
 for(let n=0;n<3;n++){const result=await f.service.endRequest(f.owner.id,dto.requestKey);assert.equal(result.ended,false);assert.equal(result.task.id,task.id);assert.equal(result.task.mine,true);assert.equal(result.task.billing.reserved,7);assert.equal((await f.service.create(f.owner.id,dto)).id,task.id);}
 assert.deepEqual(await f.db.videoTask.findUniqueOrThrow({where:{id:task.id}}),row);assert.deepEqual(await f.balance(),before);assert.equal(before.drawMjCount,93);assert.equal(await f.db.countReservation.count(),1);assert.equal(await f.db.videoTask.count(),1);assert.deepEqual(f.aborted,[]);
});
test('parallel matching submissions share one task, one request marker and one reservation',async t=>{
 const f=await fixture(t),dto=f.body(),rows=await Promise.all(Array.from({length:12},()=>f.service.create(f.owner.id,{...dto})));
 assert.ok(rows.every(row=>row.id===rows[0].id));assert.equal(await f.db.videoTask.count(),1);assert.equal(await f.db.videoRequest.count(),1);assert.equal(await f.db.countReservation.count(),1);assert.equal((await f.balance()).drawMjCount,93);
});
test('a late stale quote resolves an already accepted matching request before rejecting its old price',async t=>{
 const f=await fixture(t),dto=f.body(),entered=deferred(),release=deferred();let calls=0;
 f.service.prepare=async(user,body)=>{if(++calls===1){entered.resolve();await release.promise;return{...f.plan(body),revision:'b'.repeat(64)};}return f.plan(body);};
 const early=f.service.create(f.owner.id,dto);await entered.promise;const accepted=await f.service.create(f.owner.id,dto);release.resolve();assert.equal((await early).id,accepted.id);assert.equal(await f.db.videoTask.count(),1);assert.equal((await f.balance()).drawMjCount,93);
});
test('a preparation failure after another attempt was accepted returns the original task',async t=>{
 const f=await fixture(t),dto=f.body(),entered=deferred(),release=deferred();let calls=0;
 f.service.prepare=async(user,body)=>{if(++calls===1){entered.resolve();await release.promise;throw Error('connection changed');}return f.plan(body);};const early=f.service.create(f.owner.id,dto);await entered.promise;const accepted=await f.service.create(f.owner.id,dto);release.resolve();assert.equal((await early).id,accepted.id);assert.equal(await f.db.countReservation.count(),1);
});
test('a rejected reservation rolls back admission, then safe ending prevents later retries',async t=>{
 const f=await fixture(t),dto=f.body(),before=await f.balance();f.service.prepare=async(user,body)=>({...f.plan(body),cost:101});await assert.rejects(f.service.create(f.owner.id,dto),status(402));assert.equal(await f.db.videoTask.count(),0);assert.equal(await f.db.videoRequest.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.deepEqual(await f.balance(),before);
 assert.equal((await f.service.endRequest(f.owner.id,dto.requestKey)).ended,true);f.service.prepare=async(user,body)=>f.plan(body);await assert.rejects(f.service.create(f.owner.id,dto),status(410));assert.deepEqual(await f.balance(),before);
});
test('saving, settling and completed work keeps its result and agreed accounting when ending is requested',async t=>{
 const f=await fixture(t),dto=f.body(),task=await f.service.create(f.owner.id,dto),accounting=new VideoAccountingService(f.db,new LedgerService(f.db));
 await f.db.videoTask.update({where:{id:task.id},data:{status:'SAVING'}});for(const state of['SAVING','SETTLING','SUCCESS']){
  if(state==='SETTLING')await accounting.stage(task.id,{videoFileId:'qgauss-owned-saved-result',duration:5});if(state==='SUCCESS')await accounting.complete(task.id);
  const before=await f.db.videoTask.findUniqueOrThrow({where:{id:task.id}}),balance=await f.balance(),result=await f.service.endRequest(f.owner.id,dto.requestKey);assert.equal(result.ended,false);assert.equal(result.task.status,state);assert.deepEqual(await f.db.videoTask.findUniqueOrThrow({where:{id:task.id}}),before);assert.deepEqual(await f.balance(),balance);
 }assert.equal((await f.balance()).useDrawMjToken,7);assert.deepEqual(f.aborted,[]);
});
test('explicit cancellation still releases once and every later request returns that same receipt',async t=>{
 const f=await fixture(t),dto=f.body(),task=await f.service.create(f.owner.id,dto);await f.service.endRequest(f.owner.id,dto.requestKey);const canceled=await f.service.cancel(f.owner.id,task.id);assert.equal(canceled.billing.returned,7);assert.equal((await f.service.endRequest(f.owner.id,dto.requestKey)).task.id,task.id);assert.equal((await f.service.create(f.owner.id,dto)).status,'CANCELED');assert.equal((await f.balance()).drawMjCount,100);assert.equal(await f.db.countReservation.count(),1);assert.deepEqual(f.aborted,[task.id]);
});
test('recycled and purged history never reopens a request for another creation',async t=>{
 const f=await fixture(t),dto=f.body(),task=await f.service.create(f.owner.id,dto);await f.service.cancel(f.owner.id,task.id);await f.db.videoTask.update({where:{id:task.id},data:{deletedAt:new Date()}});assert.equal((await f.service.endRequest(f.owner.id,dto.requestKey)).ended,true);await assert.rejects(f.service.create(f.owner.id,dto),status(404));await assert.rejects(f.service.byRequest(f.owner.id,dto.requestKey),status(410));await f.db.videoTask.delete({where:{id:task.id}});assert.equal((await videoRequest(f.db,f.owner.id,dto.requestKey)).taskId,null);await assert.rejects(f.service.create(f.owner.id,dto),status(410));assert.equal((await f.balance()).drawMjCount,100);
});
test('keys are isolated by owner and a mismatched creative payload cannot replace accepted work',async t=>{
 const f=await fixture(t),dto=f.body(),task=await f.service.create(f.owner.id,dto);await assert.rejects(f.service.create(f.owner.id,{...dto,prompt:'另一条内容'}),status(409));const foreign=await f.service.endRequest(f.other.id,dto.requestKey);assert.deepEqual(foreign,{ended:true,requestKey:dto.requestKey});assert.equal((await f.service.byRequest(f.owner.id,dto.requestKey)).id,task.id);await assert.rejects(f.service.byRequest(f.other.id,dto.requestKey),status(410));assert.equal((await f.db.videoTask.findUniqueOrThrow({where:{id:task.id}})).status,'QUEUED');assert.equal(await f.db.videoRequest.count(),2);
});
test('malformed keys and inactive accounts cannot create request markers or admit work',async t=>{
 const f=await fixture(t);for(const key of['','short','bad/key/value','x'.repeat(101),null]){await assert.rejects(f.service.endRequest(f.owner.id,key),status(400));await assert.rejects(f.service.byRequest(f.owner.id,key),status(400));}
 await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});const dto=f.body();await assert.rejects(f.service.endRequest(f.owner.id,dto.requestKey),status(403));await assert.rejects(f.service.create(f.owner.id,dto),status(403));assert.equal(await f.db.videoRequest.count(),0);assert.equal(await f.db.videoTask.count(),0);
});
test('migration backfills owned legacy work and recycled history without losing orphaned old rows',async t=>{
 const f=await fixture(t),dto=f.body(),task=await f.service.create(f.owner.id,dto);await f.service.cancel(f.owner.id,task.id);const recycled=await f.service.create(f.owner.id,f.body());await f.service.cancel(f.owner.id,recycled.id);await f.db.videoTask.update({where:{id:recycled.id},data:{deletedAt:new Date()}});const old=await f.db.videoTask.findUniqueOrThrow({where:{id:task.id}}),{id,...copy}=old;await f.db.videoTask.create({data:{...copy,userId:'removed-account',requestKey:randomUUID()}});
 const raw=new DatabaseSync(f.database);try{raw.exec('PRAGMA foreign_keys=ON');raw.exec('DROP TABLE video_requests');raw.exec(readFileSync(join(here,'../prisma/migrations/0039_video_requests.sql'),'utf8'));assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length,0);}finally{raw.close();}
 assert.equal(await f.db.videoRequest.count(),2);assert.equal(await f.db.videoTask.count(),3);assert.equal((await f.service.create(f.owner.id,dto)).id,task.id);assert.equal((await videoRequest(f.db,f.owner.id,recycled.requestKey)).state,'ACCEPTED');await f.db.videoTask.delete({where:{id:task.id}});await assert.rejects(f.service.create(f.owner.id,dto),status(409));assert.equal((await f.service.endRequest(f.owner.id,dto.requestKey)).ended,true);await assert.rejects(f.service.create(f.owner.id,dto),status(410));
});
