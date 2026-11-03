import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {BreakerRegistry} from '../dist/common/llm/breaker.js';
import {SettingsService} from '../dist/modules/settings/settings.service.js';
import {ModelsService} from '../dist/modules/models/models.service.js';
import {KeyPoolService} from '../dist/modules/models/key-pool.service.js';
import {ModerationService} from '../dist/modules/moderation/moderation.service.js';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
import {MindmapDocumentsService} from '../dist/modules/mindmap/mindmap-documents.service.js';
import {MindmapAccountingService} from '../dist/modules/mindmap/mindmap-accounting.service.js';
import {MindmapGenerationsService} from '../dist/modules/mindmap/mindmap-generations.service.js';

const here=dirname(fileURLToPath(import.meta.url)),directory=mkdtempSync(join(tmpdir(),'qgauss-mindmap-')),base=join(directory,'base.db');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=code=>error=>error.getStatus?.()===code;
const outline='# QGauss 周末花园\n## 植物\n- 薄荷\n- 迷迭香\n## 光线\n- 清晨柔光';
const oldEnvironment={UPSTREAM_PORT_ALLOWLIST:process.env.UPSTREAM_PORT_ALLOWLIST,UPSTREAM_PRIVATE_ALLOWLIST:process.env.UPSTREAM_PRIVATE_ALLOWLIST};
after(()=>{for(const[key,value]of Object.entries(oldEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep+'qgauss-mindmap-'));rmSync(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

async function waitFor(read,predicate,description='task state'){
 const deadline=Date.now()+8000;let value;while(Date.now()<deadline){value=await read();if(predicate(value))return value;await delay(15);}assert.fail('Timed out waiting for '+description+': '+JSON.stringify(value));
}

async function fixture(t,{commerce=true}={}){
 const file=join(directory,randomUUID()+'.db');copyFileSync(base,file);const db=new SqliteClient({datasources:{db:{url:'file:'+file.replace(/\\/g,'/')}}});
 const [owner,other]=await Promise.all(['owner','other'].map(username=>db.user.create({data:{username,email:username+'@qgauss.test',passwordHash:'synthetic-only'}})));
 let mode='complete',release,held=Promise.resolve();const requests=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({url:req.url,body:JSON.parse(raw||'{}')});if(mode==='held')await held;
  if(res.destroyed)return;if(mode==='http-error'){res.writeHead(503,{'content-type':'text/plain'});res.end('PRIVATE-UPSTREAM-DETAIL');return;}
  res.writeHead(200,{'content-type':'text/event-stream'});const text=mode==='invalid'?'只有一个没有层级的标题':outline;
  res.write('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})+'\n\n');
  if(mode!=='partial')res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:mode==='length'?'length':'stop'}],usage:{prompt_tokens:120,completion_tokens:80}})+'\n\ndata: [DONE]\n\n');res.end();
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const port=server.address().port;process.env.UPSTREAM_PORT_ALLOWLIST='443,80,'+port;process.env.UPSTREAM_PRIVATE_ALLOWLIST='127.0.0.1:'+port;
 const settings=new SettingsService(db),ledger=new LedgerService(db),rate=new RateLimitService(),breaker=new BreakerRegistry(),box={encrypt:value=>value,decrypt:value=>value},models=new ModelsService(db,box),keys=new KeyPoolService(db,box),moderation=new ModerationService(db),accounting=new MindmapAccountingService(db,ledger),documents=new MindmapDocumentsService(db,rate);
 const service=new MindmapGenerationsService(db,models,keys,breaker,ledger,accounting,moderation,rate);
 const channel=await db.channel.create({data:{name:'QGauss local outline fixture',type:'OPENAI',baseUrl:'http://127.0.0.1:'+port+'/v1',timeoutMs:5000}}),model=await db.aiModel.create({data:{name:'qgauss-outline',displayName:'QGauss 思路搭档',maxContext:16384,maxOutput:2048,countPool:'model3',countCost:2,priceInPerM:1000,priceOutPerM:2000}});
 await db.modelChannel.create({data:{modelId:model.id,channelId:channel.id,upstreamName:'qgauss-outline-local'}});await settings.set('commerce.enabled',commerce);await settings.set('upstream.allowHttp',true);await ledger.grant(owner.id,{model3Count:20,rechargeType:'admin',remark:'QGauss local outline fixture'});
 t.after(async()=>{release?.();await service.onModuleDestroy();server.closeAllConnections();await new Promise(done=>server.close(done));await db.$disconnect();});
 const quote=async(extra={})=>service.quote(owner.id,{modelId:model.id,prompt:'整理一份阳台花园计划',context:'',...extra});
 const accept=async(extra={})=>{const input={modelId:model.id,prompt:'整理一份阳台花园计划',context:'',...extra},price=await service.quote(owner.id,input);return service.create(owner.id,{...input,quoteRevision:price.revision,requestKey:randomUUID()});};
 const completed=id=>waitFor(()=>service.get(owner.id,id),row=>!['QUEUED','RUNNING','SETTLING'].includes(row.status));
 const balance=async()=>(await db.userBalance.findUniqueOrThrow({where:{userId:owner.id}})).model3Count;
 const freshService=()=>new MindmapGenerationsService(db,models,keys,breaker,ledger,accounting,moderation,rate);
 return{db,owner,other,documents,service,accounting,ledger,breaker,model,channel,settings,requests,quote,accept,completed,balance,freshService,setMode(value){mode=value;if(value==='held')held=new Promise(done=>release=done);},release:()=>release?.()};
}

test('document receipts replay once, remain owner scoped and expose the current document after later edits',async t=>{
 const f=await fixture(t),input={requestKey:randomUUID(),kind:'create',title:'我的花园',outline};const results=await Promise.all(Array.from({length:6},()=>f.documents.mutate(f.owner.id,input))),first=results[0];assert.ok(results.every(row=>row.documentId===first.documentId));assert.equal(await f.db.mindmapDocument.count(),1);
 await assert.rejects(f.documents.mutate(f.owner.id,{...input,outline:outline+'\n- 另一个版本'}),status(409));await assert.rejects(f.documents.get(f.other.id,first.documentId),status(404));await assert.rejects(f.documents.operation(f.other.id,input.requestKey),status(404));assert.equal((await f.documents.list(f.other.id,{page:1,pageSize:6})).total,0);
 const edit=await f.documents.mutate(f.owner.id,{requestKey:randomUUID(),kind:'edit',documentId:first.documentId,expectedVersion:1,title:'',outline:outline+'\n- 薰衣草'});assert.equal(edit.version,2);assert.equal(edit.document.title,'QGauss 周末花园');const recovered=await f.documents.operation(f.owner.id,input.requestKey);assert.equal(recovered.version,1);assert.equal(recovered.document.version,2);
 const ownOther=await f.documents.mutate(f.other.id,input);assert.notEqual(ownOther.documentId,first.documentId);
});

test('document version conflicts preserve the winner; archive, search and restore use the same ownership boundary',async t=>{
 const f=await fixture(t),created=await f.documents.mutate(f.owner.id,{requestKey:randomUUID(),kind:'create',title:'雾里花',outline}),documentId=created.documentId;
 const results=await Promise.allSettled(['A','B'].map(title=>f.documents.mutate(f.owner.id,{requestKey:randomUUID(),kind:'edit',documentId,expectedVersion:1,title,outline})));assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected'&&status(409)(row.reason)).length,1);
 await assert.rejects(f.documents.mutate(f.other.id,{requestKey:randomUUID(),kind:'archive',documentId,expectedVersion:2}),status(404));const archived=await f.documents.mutate(f.owner.id,{requestKey:randomUUID(),kind:'archive',documentId,expectedVersion:2});assert.equal(archived.version,3);assert.ok(archived.document.archivedAt);assert.equal((await f.documents.list(f.owner.id,{page:1,pageSize:6,view:'active'})).total,0);assert.equal((await f.documents.list(f.owner.id,{page:1,pageSize:6,view:'trash',q:'薄荷'})).total,1);
 await assert.rejects(f.documents.mutate(f.owner.id,{requestKey:randomUUID(),kind:'edit',documentId,expectedVersion:3,title:'不能覆盖',outline}),status(409));const restored=await f.documents.mutate(f.owner.id,{requestKey:randomUUID(),kind:'restore',documentId,expectedVersion:3});assert.equal(restored.version,4);assert.equal(restored.document.archivedAt,null);
});

test('ending unknown document writes creates durable fences and racing acknowledgements never create a ghost document',async t=>{
 const f=await fixture(t),key=randomUUID();assert.equal((await f.documents.end(f.owner.id,key,{kind:'create'})).state,'ENDED');assert.equal((await f.documents.mutate(f.owner.id,{requestKey:key,kind:'create',title:'迟到',outline})).state,'ENDED');assert.equal(await f.db.mindmapDocument.count(),0);
 for(let i=0;i<8;i++){const requestKey=randomUUID(),[saved,ended]=await Promise.all([f.documents.mutate(f.owner.id,{requestKey,kind:'create',title:'想法 '+i,outline}),f.documents.end(f.owner.id,requestKey,{kind:'create'})]);assert.equal(saved.state,ended.state);if(saved.state==='APPLIED')assert.equal(saved.documentId,ended.documentId);}
 const fresh=new MindmapDocumentsService(f.db,new RateLimitService());assert.equal((await fresh.operation(f.owner.id,key)).state,'ENDED');
});

test('document paging has stable tie ordering and counts only the requested collection',async t=>{
 const f=await fixture(t);for(let i=0;i<9;i++)await f.documents.mutate(f.owner.id,{requestKey:randomUUID(),kind:'create',title:'QGauss 想法 '+i,outline});await f.db.mindmapDocument.updateMany({data:{updatedAt:new Date('2026-11-01T00:00:00Z')}});const seen=[];for(let page=1;page<=3;page++){const data=await f.documents.list(f.owner.id,{page,pageSize:3});assert.equal(data.total,9);seen.push(...data.items.map(row=>row.id));}assert.equal(new Set(seen).size,9);assert.deepEqual(seen,[...seen].sort((a,b)=>b.localeCompare(a)));
});

test('generation replays one accepted job and one charge without overwriting a document or leaking configuration',async t=>{
 const f=await fixture(t),price=await f.quote(),input={requestKey:randomUUID(),modelId:f.model.id,prompt:'整理一份阳台花园计划',context:'',quoteRevision:price.revision};assert.equal(price.cost,2);
 const accepted=await Promise.all(Array.from({length:6},()=>f.service.create(f.owner.id,input)));assert.ok(accepted.every(row=>row.id===accepted[0].id));const final=await f.completed(accepted[0].id);assert.equal(final.status,'COMPLETED');assert.equal(final.outline,outline);assert.deepEqual(final.billing,{pool:'model3',reserved:2,charged:2,returned:0,expired:0,state:'SETTLED'});assert.equal(await f.balance(),18);assert.equal(f.requests.length,1);assert.equal(await f.db.usageRecord.count(),1);assert.equal(await f.db.mindmapDocument.count(),0);assert.equal(f.requests[0].body.model,'qgauss-outline-local');
 await f.db.aiModel.update({where:{id:f.model.id},data:{countCost:9}});assert.equal((await f.service.create(f.owner.id,input)).id,final.id);assert.equal(await f.balance(),18);for(const secret of ['apiKey','baseUrl','routeRevision','PRIVATE-','context','priceInPerM'])assert.equal(JSON.stringify(final).includes(secret),false);
 await assert.rejects(f.service.get(f.other.id,final.id),status(404));await assert.rejects(f.service.byRequest(f.other.id,input.requestKey),status(404));await assert.rejects(f.service.cancel(f.other.id,final.id),status(404));assert.equal((await f.service.list(f.other.id,{page:1,pageSize:5})).total,0);
});

test('free generation follows the configured commerce policy and records actual reported use without a reservation',async t=>{
 const f=await fixture(t,{commerce:false}),price=await f.quote();assert.equal(price.cost,0);assert.equal(price.pool,null);const row=await f.accept(),final=await f.completed(row.id);assert.equal(final.status,'COMPLETED');assert.equal(final.billing.charged,0);assert.equal(await f.balance(),20);assert.equal(await f.db.countReservation.count(),0);const usage=await f.db.usageRecord.findFirst();assert.equal(usage.kind,'mindmap');assert.equal(usage.promptTokens,120);assert.equal(usage.completionTokens,80);assert.equal(usage.estimated,false);assert.equal(usage.costMicros,1);
});

test('stale quotes, overlong context and unavailable models fail before creating a hold or calling a provider',async t=>{
 const f=await fixture(t),price=await f.quote();await f.db.aiModel.update({where:{id:f.model.id},data:{countCost:3}});await assert.rejects(f.service.create(f.owner.id,{requestKey:randomUUID(),modelId:f.model.id,prompt:'整理一份阳台花园计划',context:'',quoteRevision:price.revision}),status(409));await assert.rejects(f.quote({context:'中文资料'.repeat(7000)}),status(400));await f.db.channel.update({where:{id:f.channel.id},data:{type:'MOCK'}});assert.equal((await f.service.options()).models[0].ready,false);await assert.rejects(f.quote(),status(400));assert.equal(await f.db.mindmapOperation.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.equal(f.requests.length,0);
});

test('generation fences prevent delayed acceptance, while ending an accepted intent returns its existing task',async t=>{
 const f=await fixture(t),price=await f.quote(),key=randomUUID();assert.equal((await f.service.end(f.owner.id,key)).state,'ENDED');await assert.rejects(f.service.create(f.owner.id,{requestKey:key,modelId:f.model.id,prompt:'整理一份阳台花园计划',quoteRevision:price.revision}),status(409));await assert.rejects(f.documents.mutate(f.owner.id,{requestKey:key,kind:'create',title:'冲突',outline}),status(409));assert.equal(f.requests.length,0);
 const task=await f.accept(),receipt=await f.service.end(f.owner.id,task.requestKey);assert.equal(receipt.state,'APPLIED');assert.equal(receipt.task.id,task.id);await f.completed(task.id);
});

for(const mode of ['http-error','partial','invalid','length'])test('failed '+mode+' generation releases its hold once and never automatically retries',async t=>{
 const f=await fixture(t);f.setMode(mode);const accepted=await f.accept(),final=await f.completed(accepted.id);assert.equal(final.status,'FAILED');assert.equal(final.outline,'');assert.equal(final.billing.charged,0);assert.equal(final.billing.returned,2);assert.equal(await f.balance(),20);assert.equal(f.requests.length,1);assert.equal(await f.db.usageRecord.count(),0);await f.service.recover(true);assert.equal(await f.balance(),20);assert.equal(f.requests.length,1);assert.equal(JSON.stringify(final).includes('PRIVATE-UPSTREAM'),false);
});

test('canceling an in-flight job releases the hold exactly once and late output cannot become a completed result',async t=>{
 const f=await fixture(t);f.setMode('held');const task=await f.accept();await waitFor(()=>f.requests.length,count=>count===1,'provider request');const results=await Promise.all(Array.from({length:5},()=>f.service.cancel(f.owner.id,task.id)));assert.ok(results.every(row=>row.status==='CANCELED'));f.release();await waitFor(()=>f.service.active.size,size=>size===0,'worker stop');const final=await f.service.get(f.owner.id,task.id);assert.equal(final.billing.returned,2);assert.equal(final.billing.charged,0);assert.equal(await f.balance(),20);assert.equal(await f.db.usageRecord.count(),0);assert.equal(f.requests.length,1);
});

test('a saved result survives a settlement interruption; restart settles it once without calling the provider again',async t=>{
 const f=await fixture(t),settle=f.ledger.settleCountReservationTx.bind(f.ledger);f.ledger.settleCountReservationTx=async(...args)=>{await settle(...args);throw Error('QGauss local settlement interruption');};const task=await f.accept();await waitFor(()=>f.service.get(f.owner.id,task.id),row=>row.status==='SETTLING');await waitFor(()=>f.service.active.size,size=>size===0,'staged worker stop');assert.equal(await f.balance(),18);assert.equal(await f.db.usageRecord.count(),0);assert.equal((await f.db.countReservation.findUnique({where:{refId:task.id}})).status,'HELD');assert.equal((await f.service.cancel(f.owner.id,task.id)).status,'SETTLING');f.ledger.settleCountReservationTx=settle;
 const recovered=f.freshService();await recovered.recover(true);await recovered.recover(true);const final=await f.service.get(f.owner.id,task.id);assert.equal(final.status,'COMPLETED');assert.equal(final.billing.charged,2);assert.equal(await f.balance(),18);assert.equal(await f.db.usageRecord.count(),1);assert.equal(f.requests.length,1);
});

test('restart ends interrupted queued and running work and releases holds without replaying provider requests',async t=>{
 const f=await fixture(t);f.service.launch=()=>{};for(const state of ['QUEUED','RUNNING']){const task=await f.accept();if(state==='RUNNING')await f.db.mindmapGeneration.update({where:{id:task.id},data:{status:'RUNNING',startedAt:new Date()}});assert.equal(await f.balance(),18);await f.freshService().recover(true);const final=await f.service.get(f.owner.id,task.id);assert.equal(final.status,'FAILED');assert.equal(final.billing.returned,2);assert.equal(await f.balance(),20);}assert.equal(f.requests.length,0);assert.equal(await f.db.usageRecord.count(),0);
});

test('insufficient balance, content restrictions and changed payloads leave no partial task or operation',async t=>{
 const f=await fixture(t),price=await f.quote();await f.ledger.consume(f.owner.id,{pool:'model3',amount:20,bizType:'mindmap-fixture',refId:randomUUID()});await assert.rejects(f.service.create(f.owner.id,{requestKey:randomUUID(),modelId:f.model.id,prompt:'整理一份阳台花园计划',quoteRevision:price.revision}),status(402));assert.equal(await f.db.mindmapGeneration.count(),0);assert.equal(await f.db.mindmapOperation.count(),0);assert.equal(await f.db.countReservation.count(),0);
 await f.db.sensitiveWord.create({data:{word:'本地受限示例',action:'block'}});await assert.rejects(f.quote({prompt:'本地受限示例'}),status(400));assert.equal(f.requests.length,0);
});
