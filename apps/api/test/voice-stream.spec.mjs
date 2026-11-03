import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {SettingsService} from '../dist/modules/settings/settings.service.js';
import {StorageService} from '../dist/modules/storage/storage.service.js';
import {ModerationService} from '../dist/modules/moderation/moderation.service.js';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
import {VoiceAccountingService} from '../dist/modules/voice/voice-accounting.service.js';
import {VoiceService} from '../dist/modules/voice/voice.service.js';
import {VoiceStreamSession} from '../dist/modules/voice/voice-stream.js';
import {splitVoiceText} from '../dist/modules/voice/voice-protocol.js';
import {authSession,withAuthSession} from '../dist/common/decorators/current-user.decorator.js';
import {syntheticMp3} from './voice-upstream-fixture.mjs';
const folder=mkdtempSync(join(tmpdir(),'qgauss-voice-stream-')),base=join(folder,'base.db'),audio=syntheticMp3(),prefix=audio.subarray(0,Math.min(audio.length,2048));
execFileSync(process.execPath,[fileURLToPath(new URL('../prisma/migrate.mjs',import.meta.url))],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-voice-stream-'));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
const status=n=>error=>error?.getStatus?.()===n;
async function deadline(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('voice output did not arrive')),3000))]);}finally{clearTimeout(timer);}}
async function until(read,predicate){for(let n=0;n<200;n++){const row=await read();if(predicate(row))return row;await new Promise(r=>setTimeout(r,10));}throw Error('voice task did not settle');}
async function collect(iterator,first=[]){const chunks=[...first];for await(const chunk of iterator)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
async function fixture(t,{segments=1}={}){
 const file=join(folder,randomUUID()+'.db');copyFileSync(base,file);const db=new SqliteClient({datasourceUrl:'file:'+file});const [owner,other]=await Promise.all(['owner','other'].map(username=>db.user.create({data:{username,email:username+'@qgauss.test',passwordHash:'synthetic-only'}}))),settings=new SettingsService(db),ledger=new LedgerService(db),rate=new RateLimitService(),storage=new StorageService(db,settings),blobs=new Map(),responses=[];
 storage.driver={async put(key,data){blobs.set(key,Buffer.from(data));},async get(key){if(!blobs.has(key))throw Error('missing test voice');return blobs.get(key);},async remove(key){blobs.delete(key);}};
 const channel=await db.channel.create({data:{name:'QGauss synthetic voice',type:'OPENAI',baseUrl:'https://1.1.1.1/v1'}});await db.voiceConfig.create({data:{id:'site',enabled:true,speechChannelId:channel.id,speechCost:2,version:1}});for(const[key,value]of Object.entries({'commerce.enabled':true,'demo.siteEnabled':false}))await db.globalConfig.create({data:{key,value:JSON.stringify(value)}});await db.$transaction(async tx=>{await ledger.ensureTx(tx,owner.id);await ledger.grantTx(tx,owner.id,{model3Count:20,extent:'voice-stream-test'});});
 const accounting=new VoiceAccountingService(db,ledger),voice=new VoiceService(db,settings,storage,accounting,{async pick(){return{apiKey:'qgauss-synthetic-voice-main'};},reportSuccess(){},async reportFailure(){}},{decrypt:value=>value},new ModerationService(db),rate),previousFetch=globalThis.fetch;let calls=0,bodyClosed=false;
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://1.1.1.1/v1/audio/speech');calls++;assert.equal(JSON.parse(init.body).response_format,'mp3');if(segments>1&&calls===1)return new Response(audio,{headers:{'Content-Type':'audio/mpeg'}});return new Response(new ReadableStream({start(controller){responses.push(controller);controller.enqueue(prefix);},cancel(){bodyClosed=true;}}),{headers:{'Content-Type':'audio/mpeg'}});};
 t.after(async()=>{await voice.onModuleDestroy();globalThis.fetch=previousFetch;await db.$disconnect();});
 async function create(){const payload={kind:'speech',text:'一个可以尽早听到的完整回答。'.repeat(segments>1?450:1),title:'QGauss 渐进声音',voice:'fable'},quote=await voice.quote(owner.id,payload);return voice.create(owner.id,{...payload,requestKey:randomUUID(),quoteRevision:quote.revision});}
 const release=()=>{for(const response of responses.splice(0)){response.enqueue(audio.subarray(prefix.length));response.close();}};
 return{db,owner,other,voice,create,release,calls:()=>calls,bodyClosed:()=>bodyClosed};
}

test('声音流在服务方正文完成前输出有效音频，重复连接和重听只结算原任务一次',async t=>{
 const f=await fixture(t),task=await f.create(),firstController=new AbortController(),reader=(await f.voice.stream(f.owner.id,task.id,firstController.signal))[Symbol.asyncIterator](),head=await deadline(reader.next());assert.deepEqual(head.value,prefix);assert.equal(f.bodyClosed(),false);assert.equal((await f.voice.detail(f.owner.id,task.id)).status,'RUNNING');assert.equal((await f.voice.detail(f.owner.id,task.id)).billing.charged,0);
 const second=(await f.voice.stream(f.owner.id,task.id,new AbortController().signal))[Symbol.asyncIterator](),head2=await deadline(second.next());assert.deepEqual(head2.value,prefix);assert.equal(f.calls(),1);f.release();assert.deepEqual(await collect(reader,[head.value]),audio);assert.deepEqual(await collect(second,[head2.value]),audio);const completed=await until(()=>f.voice.detail(f.owner.id,task.id),row=>row.status==='COMPLETED');assert.equal(completed.billing.charged,2);assert.deepEqual(await collect(await f.voice.stream(f.owner.id,task.id,new AbortController().signal)),audio);assert.equal(f.calls(),1);assert.equal(await f.db.voiceTask.count(),1);assert.equal((await f.voice.detail(f.owner.id,task.id)).billing.charged,2);
});
test('断开播放不终止原生成，重新连接从原声音开始，不新增服务方请求',async t=>{
 const f=await fixture(t),task=await f.create(),controller=new AbortController(),reader=(await f.voice.stream(f.owner.id,task.id,controller.signal))[Symbol.asyncIterator]();await deadline(reader.next());const next=reader.next();controller.abort(Error('viewer disconnected'));await assert.rejects(next,/viewer disconnected/);assert.equal(f.bodyClosed(),false);const again=(await f.voice.stream(f.owner.id,task.id,new AbortController().signal))[Symbol.asyncIterator](),head=await deadline(again.next());f.release();assert.deepEqual(await collect(again,[head.value]),audio);assert.equal(f.calls(),1);
});
test('停止生成立即结束临时声音，退回原预留且不开放失败音频',async t=>{
 const f=await fixture(t),task=await f.create(),reader=(await f.voice.stream(f.owner.id,task.id,new AbortController().signal))[Symbol.asyncIterator]();await deadline(reader.next());const next=reader.next(),rejected=assert.rejects(next,/停止|移除/);const stopped=await f.voice.cancel(f.owner.id,task.id);await rejected;assert.equal(stopped.status,'CANCELED');assert.equal(stopped.billing.charged,0);assert.equal(stopped.billing.returned,2);await assert.rejects(f.voice.stream(f.owner.id,task.id,new AbortController().signal),status(404));assert.equal(f.calls(),1);
});
test('本人源内容与账号在连接期间继续核对，其他账号不能订阅声音',async t=>{
 const f=await fixture(t),task=await f.create();await assert.rejects(f.voice.stream(f.other.id,task.id,new AbortController().signal),status(404));const reader=(await f.voice.stream(f.owner.id,task.id,new AbortController().signal))[Symbol.asyncIterator]();await deadline(reader.next());await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});await assert.rejects(deadline(reader.next()),status(404));assert.equal(f.calls(),1);
});
test('不支持连续解码时可读取已保存的首段，停止后该临时分段停止开放',async t=>{
 const f=await fixture(t,{segments:2}),task=await f.create(),partial=await until(()=>f.voice.detail(f.owner.id,task.id),row=>row.audio.length===1);assert.equal(partial.status,'RUNNING');assert.deepEqual((await f.voice.audio(f.owner.id,task.id,0)).buffer,audio);await assert.rejects(f.voice.audio(f.other.id,task.id,0),status(404));const stopped=await f.voice.cancel(f.owner.id,task.id);assert.equal(stopped.billing.returned,2);await assert.rejects(f.voice.audio(f.owner.id,task.id,0),status(404));
});
test('音频前缀不足或无效时不开放临时字节，取消唤醒等待者',async()=>{
 const stream=new VoiceStreamSession(),controller=new AbortController(),reader=stream.read(async()=>audio,async()=>{},controller.signal)[Symbol.asyncIterator]();stream.append(0,audio.subarray(0,4));let settled=false;const pending=reader.next().finally(()=>{settled=true;}),rejected=assert.rejects(pending,/stopped/);await new Promise(r=>setTimeout(r,20));assert.equal(settled,false);controller.abort(Error('stopped'));await rejected;
});
test('分段提交与迟到订阅保持完整字节，不漏首段或重复拼接',async()=>{
 const stream=new VoiceStreamSession(),controller=new AbortController(),files=new Map(),reader=stream.read(async id=>files.get(id),async()=>{},controller.signal)[Symbol.asyncIterator]();stream.append(0,prefix);const head=await deadline(reader.next());stream.append(0,audio.subarray(prefix.length));files.set('first',audio);stream.commit(0,'first');stream.append(1,audio);files.set('second',audio);stream.commit(1,'second');stream.finish(true);assert.deepEqual(await collect(reader,[head.value]),Buffer.concat([audio,audio]));assert.deepEqual(await collect(stream.read(async id=>files.get(id),async()=>{},controller.signal)),Buffer.concat([audio,audio]));assert.equal(stream.readers,0);
});
test('首段尽早按句子输出，长正文和表情仍完整保留且后续片段遵循原上限',()=>{
 const text='一个清楚的小目标。🌊'.repeat(600),segments=splitVoiceText(text,4096,256);assert.ok(segments.length>2);assert.ok(segments[0].length<=256);assert.ok(segments[0].endsWith('。'));assert.equal(segments.join(''),text);assert.ok(segments.every(part=>part.length<=4096&&!/[\uD800-\uDBFF]$/.test(part)));for(const first of [1,4097,Infinity])assert.throws(()=>splitVoiceText(text,4096,first));
});
test('无效声音不会作为临时内容返回，失败唤醒全部读取并保留通用提示',async()=>{
 const stream=new VoiceStreamSession();stream.append(0,Buffer.from('private upstream credential must not become audio'));const reader=stream.read(async()=>Buffer.alloc(0),async()=>{},new AbortController().signal),pending=reader.next(),rejected=assert.rejects(pending,error=>/停止/.test(error.message)&&!error.message.includes('private'));stream.finish(false);await rejected;assert.equal(stream.readers,0);
});
test('声音连接期间登录版本撤回后停止交付，即使账号仍可用',async t=>{
 const f=await fixture(t),task=await f.create(),reader=(await f.voice.stream(f.owner.id,task.id,new AbortController().signal))[Symbol.asyncIterator]();await deadline(reader.next());await f.db.user.update({where:{id:f.owner.id},data:{tokenVersion:{increment:1}}});await assert.rejects(deadline(reader.next()),status(401));assert.equal(f.calls(),1);
});
test('单个登录退出或到期后结束原声音连接，不影响其他登录的读取',async t=>{
 const f=await fixture(t),task=await f.create(),familyId=randomUUID(),otherFamily=randomUUID();for(const family of [familyId,otherFamily])await f.db.refreshToken.create({data:{userId:f.owner.id,tokenHash:randomUUID(),familyId:family,expiresAt:new Date(Date.now()+60000)}});const context={tokenVersion:0,familyId,expiresAt:Date.now()+60000},reader=(await f.voice.stream(f.owner.id,task.id,new AbortController().signal,context))[Symbol.asyncIterator]();await deadline(reader.next());await f.db.refreshToken.updateMany({where:{familyId},data:{revokedAt:new Date()}});await assert.rejects(deadline(reader.next()),status(401));const otherContext={...context,familyId:otherFamily,expiresAt:Date.now()+1000},other=(await f.voice.stream(f.owner.id,task.id,new AbortController().signal,otherContext))[Symbol.asyncIterator]();assert.deepEqual((await deadline(other.next())).value,prefix);await assert.rejects(deadline(other.next()),status(401));await assert.rejects(f.voice.stream(f.owner.id,task.id,new AbortController().signal,{...otherContext,expiresAt:0}),status(401));assert.equal(f.calls(),1);
});
test('登录上下文仅供连接鉴权，不进入个人资料和 JSON 回执',()=>{
 const original={id:'owner',email:'owner@qgauss.test',username:'owner',role:'USER'},context={tokenVersion:7,familyId:'private-family',expiresAt:Date.now()+60000},user=withAuthSession({...original},context);assert.deepEqual(JSON.parse(JSON.stringify(user)),original);assert.deepEqual(Object.keys(user),Object.keys(original));assert.deepEqual(authSession(user),context);assert.equal(Object.isFrozen(authSession(user)),true);
});
