import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {ValidationPipe} from '@nestjs/common';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {SettingsService} from '../dist/modules/settings/settings.service.js';
import {StorageService} from '../dist/modules/storage/storage.service.js';
import {ModerationService} from '../dist/modules/moderation/moderation.service.js';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
import {VoiceAccountingService} from '../dist/modules/voice/voice-accounting.service.js';
import {VoiceService} from '../dist/modules/voice/voice.service.js';
import {VoiceLibraryService} from '../dist/modules/voice/voice-library.service.js';
import {VoiceConfigDto} from '../dist/modules/voice/voice.dto.js';
import {voiceExpiry,syncVoiceRecordingExpiry} from '../dist/modules/voice/voice-retention.js';
import {voiceSearchIds} from '../dist/modules/voice/voice-search.js';
import {encodeVoiceWav} from '../../web/src/lib/voice-recorder.js';

const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-voice-library-')),base=join(folder,'base.db'),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=code=>error=>error.getStatus?.()===code;

test('音色搜索同时识别简体、繁体、英文显示名和原有标识，不修改查询内容',()=>{
 for(const [input,expected]of [['晴空','alloy'],['Sky','alloy'],[' ＳＫＹ ','alloy'],['回聲','echo'],['暖叙','fable'],['暖敘','fable'],['Story','fable'],['Fable','fable'],['晨星','nova'],['Onyx','onyx'],['微光','shimmer'],['Glow','shimmer'],['Shimmer','shimmer']])assert.deepEqual(voiceSearchIds(input),[expected],input);
 for(const input of [null,undefined,{},'', 'unknown voice'])assert.deepEqual(voiceSearchIds(input),[]);
});

test('按显示音色搜索与原标签搜索取并集，同时排除其他账号、过期和已清理内容',async t=>{
 const f=await fixture(t),voice=await f.task({voice:'alloy',label:'属于我的晴空作品'}),title=await f.task({voice:'fable',label:'Sky'});
 await f.task({userId:f.other.id,voice:'alloy',label:'另一账号的 Sky'});
 await f.task({voice:'alloy',expiresAt:new Date(Date.now()-60000)});
 await f.task({voice:'alloy',purgedAt:new Date(),label:'已清理的 Sky'});
 for(const q of ['Sky','ＳＫＹ']){const row=await f.library.list(f.owner.id,{q});assert.deepEqual(new Set(row.items.map(item=>item.id)),new Set([voice.id,title.id]));assert.equal(row.total,2);assert.equal(row.counts.all,4);}assert.equal(f.providerCalls(),0);
 assert.equal((await f.db.voiceTask.findUnique({where:{id:title.id}})).label,'Sky');
});

test('简体繁体英文音色搜索保持同一原记录，读取不修改正文、音色、次数或状态',async t=>{
 const f=await fixture(t),task=await f.task({voice:'fable',label:'保存声音设置，是我自己的标题'}),before=hash(await f.db.voiceTask.findUnique({where:{id:task.id}}));
 for(const q of ['暖叙','暖敘','Story','ＦＡＢＬＥ']){const result=await f.library.list(f.owner.id,{q});assert.equal(result.total,1,q);assert.equal(result.items[0].id,task.id);assert.equal(result.items[0].label,task.label);assert.equal(result.items[0].voice,'fable');}
 assert.equal(hash(await f.db.voiceTask.findUnique({where:{id:task.id}})),before);assert.equal(f.providerCalls(),0);
});

test('音色检索不使用转写任务的默认音色字段，仍能匹配转写中的原有文字',async t=>{
 const f=await fixture(t),recording=await f.task({kind:'transcription',voice:'fable',label:'一段录音',transcript:'这是一份需要保留的原始转写。'});
 for(const q of ['Story','Fable','暖叙','暖敘'])assert.equal((await f.library.list(f.owner.id,{q})).total,0,q);
 await f.db.voiceTask.update({where:{id:recording.id},data:{transcript:'这份转写中，确实提到了 Story。'}});
 const result=await f.library.list(f.owner.id,{q:'Story'});assert.deepEqual(result.items.map(row=>row.id),[recording.id]);assert.equal(f.providerCalls(),0);
});
async function fixture(t){
 const database=join(folder,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database.replace(/\\/g,'/')}}});
 const [owner,other]=await Promise.all(['owner','other'].map(username=>db.user.create({data:{username,email:username+'@qgauss.test',passwordHash:'synthetic-only'}}))),settings=new SettingsService(db),ledger=new LedgerService(db),accounting=new VoiceAccountingService(db,ledger),rate=new RateLimitService();
 const channel=await db.channel.create({data:{name:'QGauss local voice fixture',type:'OPENAI',baseUrl:'http://127.0.0.1:19991/v1'}});await db.voiceConfig.create({data:{id:'site',enabled:true,speechChannelId:channel.id,transcriptionChannelId:channel.id,speechCost:2,transcriptionCost:2}});
 const storage=new StorageService(db,settings),blobs=new Map(),failures=new Set(),removals=[];let providerCalls=0;
 storage.driver={name:'local-unit',async put(key,data){blobs.set(key,Buffer.from(data));},async get(key){if(!blobs.has(key))throw Error('missing local fixture');return blobs.get(key);},async remove(key){removals.push(key);if(failures.has(key))throw Error('temporary storage failure');blobs.delete(key);},async exists(key){return blobs.has(key);}};
 const voice=new VoiceService(db,settings,storage,accounting,{async pick(){providerCalls++;throw Error('Unexpected provider call');},async reportFailure(){},reportSuccess(){}},{decrypt:value=>value},new ModerationService(db),rate),library=new VoiceLibraryService(db,storage,rate);
 t.after(async()=>{await library.onModuleDestroy();await voice.onModuleDestroy();await db.$disconnect();});
 async function file(scope='voice-result',userId=owner.id,extra={}){const buffer=scope==='voice-recording'?Buffer.from(await encodeVoiceWav([new Float32Array(16000)],16000).arrayBuffer()):Buffer.from('QGauss local synthetic audio');const row=await db.uploadFile.create({data:{userId,scope,mime:scope==='voice-recording'?'audio/wav':'audio/mpeg',filename:scope==='voice-recording'?'recording.wav':'voice.mp3',storedKey:'2026/11/'+randomUUID()+(scope==='voice-recording'?'.wav':'.mp3'),size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),...extra}});blobs.set(row.storedKey,buffer);return row;}
 async function task(extra={}){const kind=extra.kind||'speech',userId=extra.userId||owner.id,state=extra.status||'COMPLETED',completed=state==='COMPLETED';const data={userId,requestKey:randomUUID(),requestHash:'fixture',kind,sample:kind==='speech',voice:'fable',model:kind==='speech'?'tts-1':'whisper-1',channelId:channel.id,configVersion:1,status:state,progress:completed?100:5,label:kind==='speech'?'只属于我的一个好答案':'只属于我的一段灵感',segmentCount:1,completedSegments:completed?1:0,finishedAt:completed?new Date():null,transcript:kind==='transcription'&&completed?'私人转写：想把一个点子变成清楚的行动。':'',...extra};
  if(kind==='transcription'&&!Object.hasOwn(extra,'inputFileId'))data.inputFileId=(await file('voice-recording',userId)).id;
  if(kind==='speech'&&completed&&!Object.hasOwn(extra,'resultJson'))data.resultJson=JSON.stringify([{id:(await file('voice-result',userId)).id,mime:'audio/mpeg'}]);
  if(!Object.hasOwn(extra,'requestHash'))data.requestHash=hash(voice.intent({kind,...(kind==='speech'?{sample:data.sample,...(data.messageId?{messageId:data.messageId}:{}),voice:data.voice}:{fileId:data.inputFileId})}));
  return db.voiceTask.create({data});
 }
 async function message(content='一个完整的私人回答'){const conversation=await db.conversation.create({data:{userId:owner.id,title:'自己的对话'}}),row=await db.message.create({data:{conversationId:conversation.id,role:'ASSISTANT',status:'COMPLETED',content}});return{...row,conversation};}
 async function credit(){await db.$transaction(async tx=>{await ledger.ensureTx(tx,owner.id);await ledger.grantTx(tx,owner.id,{model3Count:20,extent:'voice-library-unit'});});}
 return{db,owner,other,storage,ledger,accounting,voice,library,settings,channel,file,task,message,credit,blobs,failures,removals,providerCalls:()=>providerCalls};
}
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-voice-library-'));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('voice history belongs to its owner and summary rows omit full transcripts, file IDs and configuration',async t=>{
 const f=await fixture(t),own=await f.task({kind:'transcription'});await f.task({userId:f.other.id});const list=await f.library.list(f.owner.id);assert.equal(list.total,1);assert.deepEqual(list.counts,{all:1,speech:0,transcription:1});assert.equal(list.items[0].id,own.id);for(const key of ['transcript','audio','inputFileId','userId','requestKey','requestHash','channelId','model','resultJson'])assert.equal(Object.hasOwn(list.items[0],key),false);const detail=await f.library.detail(f.owner.id,own.id);assert.match(detail.transcript,/私人转写/);await assert.rejects(()=>f.library.detail(f.other.id,own.id),status(404));assert.equal(f.providerCalls(),0);
});
test('pagination has deterministic ties, bounded sizes, strict scalar queries and private search',async t=>{
 const f=await fixture(t);for(let i=0;i<12;i++)await f.task({id:'history-'+String(i).padStart(2,'0'),createdAt:new Date(1000),label:i===3?'找到这个声音':'其他声音'});const a=await f.library.list(f.owner.id,{page:'1',pageSize:'5'}),b=await f.library.list(f.owner.id,{page:'2',pageSize:'5'});assert.equal(new Set([...a.items,...b.items].map(row=>row.id)).size,10);assert.equal(a.items[0].id,'history-11');assert.equal((await f.library.list(f.owner.id,{q:'找到这个'})).total,1);for(const query of [{kind:['speech']},{state:'other'},{page:'0'},{pageSize:'31'},{page:['1','2']},{q:'a'.repeat(101)}])await assert.rejects(()=>f.library.list(f.owner.id,query),status(400));
});
test('completed speech replays saved segments without reserving or charging another operation',async t=>{
 const f=await fixture(t);await f.credit();const row=await f.task(),before=await f.db.userBalance.findUnique({where:{userId:f.owner.id}}),logs=await f.db.accountLog.count();for(let i=0;i<3;i++){const detail=await f.library.detail(f.owner.id,row.id);assert.equal(detail.availability,'ready');assert.equal(detail.audio.length,1);assert.match(detail.audio[0].url,new RegExp(row.id));assert.ok((await f.voice.audio(f.owner.id,row.id,0)).buffer.length);}assert.deepEqual(await f.db.userBalance.findUnique({where:{userId:f.owner.id}}),before);assert.equal(await f.db.accountLog.count(),logs);assert.equal(await f.db.voiceTask.count(),1);assert.equal(f.providerCalls(),0);
});

test('generic upload endpoints cannot give another account administrative access to private voice files',async t=>{
 const f=await fixture(t);for(const scope of ['voice-recording','voice-result']){const file=await f.file(scope);await assert.rejects(()=>f.storage.read(file.id,f.other.id,'ADMIN'),status(404));await assert.rejects(()=>f.storage.detail(file.id,f.other.id,'ADMIN'),status(404));await assert.rejects(()=>f.storage.remove(file.id,f.other.id,'ADMIN'),status(404));assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).deletedAt,null);}const ordinary=await f.file('chat');assert.ok((await f.storage.read(ordinary.id,f.other.id,'ADMIN')).buffer.length);
});
test('expiry blocks text, labels, voice playback and generic file reads before cleanup runs',async t=>{
 const f=await fixture(t),record=await f.file('voice-recording',f.owner.id,{expiresAt:new Date(1000)}),row=await f.task({kind:'transcription',inputFileId:record.id,retentionDays:1,expiresAt:new Date(1000),label:'过期私人标题',chargedAmount:2,billingState:'SETTLED'}),detail=await f.library.detail(f.owner.id,row.id);assert.equal(detail.availability,'expired');assert.equal(detail.transcript,'');assert.equal(detail.label,'');assert.deepEqual(detail.audio,[]);assert.equal(detail.billing.charged,2);await assert.rejects(()=>f.voice.detail(f.owner.id,row.id),status(404));await assert.rejects(()=>f.storage.read(record.id,f.owner.id,'USER'),status(404));assert.equal((await f.library.list(f.owner.id,{state:'expired'})).total,1);assert.equal((await f.library.list(f.owner.id,{q:'私人'})).total,0);
});
test('removed original conversations and recordings do not leak their saved text through history',async t=>{
 const f=await fixture(t),message=await f.message('已经移除的回答'),speech=await f.task({sample:false,messageId:message.id}),transcription=await f.task({kind:'transcription'});await f.db.conversation.update({where:{id:message.conversationId},data:{deletedAt:new Date()}});await f.db.uploadFile.update({where:{id:transcription.inputFileId},data:{deletedAt:new Date()}});for(const row of [speech,transcription]){const detail=await f.library.detail(f.owner.id,row.id);assert.equal(detail.availability,'unavailable');assert.equal(detail.label,'');assert.equal(detail.transcript,'');assert.equal(detail.conversationId,null);assert.deepEqual(detail.audio,[]);await assert.rejects(()=>f.voice.detail(f.owner.id,row.id),status(404));}
});
test('running and settling tasks cannot be removed or purged and keep their accounting untouched',async t=>{
 const f=await fixture(t);for(const state of ['QUEUED','RUNNING','SETTLING']){const row=await f.task({status:state,expiresAt:new Date(1000)});await assert.rejects(()=>f.library.remove(f.owner.id,row.id),status(409));await f.library.sweep();const saved=await f.db.voiceTask.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.deletedAt,null);assert.equal(saved.purgedAt,null);assert.equal(saved.status,state);}
});
test('cleanup withdraws a completed record, wipes its content and retains the billing receipt',async t=>{
 const f=await fixture(t),row=await f.task({kind:'transcription',chargedAmount:2,billingState:'SETTLED'}),logs=await f.db.accountLog.count();assert.equal((await f.library.remove(f.owner.id,row.id)).removed,true);await f.library.onModuleDestroy();const saved=await f.db.voiceTask.findUniqueOrThrow({where:{id:row.id}});assert.ok(saved.deletedAt);assert.ok(saved.purgedAt);assert.equal(saved.transcript,'');assert.equal(saved.label,'');assert.equal(saved.resultJson,'[]');assert.equal(saved.chargedAmount,2);assert.equal(saved.billingState,'SETTLED');assert.equal(saved.requestKey,row.requestKey);await assert.rejects(()=>f.library.detail(f.owner.id,row.id),status(404));await assert.rejects(()=>f.voice.byRequest(f.owner.id,row.requestKey),status(404));assert.equal((await f.library.list(f.owner.id)).total,0);assert.equal(await f.db.accountLog.count(),logs);
});
test('repeated and parallel removal is idempotent and never creates a new voice request',async t=>{
 const f=await fixture(t),row=await f.task();const results=await Promise.all(Array.from({length:6},()=>f.library.remove(f.owner.id,row.id)));assert.ok(results.every(row=>row.removed));await f.library.onModuleDestroy();assert.equal(await f.db.voiceTask.count(),1);assert.equal(f.providerCalls(),0);await assert.rejects(()=>f.voice.create(f.owner.id,{kind:'speech',sample:true,voice:'fable',requestKey:row.requestKey,quoteRevision:'a'.repeat(64)}),status(404));assert.equal(await f.db.voiceTask.count(),1);
});
test('foreign owners, unrelated scopes and invalid result links cannot cause another file to be removed',async t=>{
 const f=await fixture(t),foreign=await f.file('voice-result',f.other.id),unrelated=await f.file('chat'),own=await f.file(),row=await f.task({resultJson:JSON.stringify([foreign,unrelated,own].map(file=>({id:file.id,mime:'audio/mpeg'})))});await assert.rejects(()=>f.library.remove(f.other.id,row.id),status(404));await f.library.remove(f.owner.id,row.id);await f.library.onModuleDestroy();assert.equal((await f.db.uploadFile.findUnique({where:{id:foreign.id}})).deletedAt,null);assert.equal((await f.db.uploadFile.findUnique({where:{id:unrelated.id}})).deletedAt,null);assert.ok((await f.db.uploadFile.findUnique({where:{id:own.id}})).deletedAt);
});
test('a shared source recording is kept for another live task and withdrawn after the last record is removed',async t=>{
 const f=await fixture(t),file=await f.file('voice-recording'),a=await f.task({kind:'transcription',inputFileId:file.id}),b=await f.task({kind:'transcription',inputFileId:file.id});await f.library.remove(f.owner.id,a.id);await f.library.onModuleDestroy();assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).deletedAt,null);assert.equal((await f.library.detail(f.owner.id,b.id)).availability,'ready');await f.library.remove(f.owner.id,b.id);assert.ok((await f.db.uploadFile.findUnique({where:{id:file.id}})).deletedAt);
});
test('inactive accounts cannot remove records after their token was issued',async t=>{
 const f=await fixture(t),row=await f.task();await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});await assert.rejects(()=>f.library.remove(f.owner.id,row.id),status(403));assert.equal((await f.db.voiceTask.findUnique({where:{id:row.id}})).deletedAt,null);
});
test('retention is frozen on acceptance and starts when a complete result is settled',async t=>{
 const f=await fixture(t);await f.credit();const file=await f.file('voice-result',f.owner.id,{expiresAt:new Date(Date.now()+86400000)}),row=await f.task({status:'RUNNING',retentionDays:2,completedSegments:1,resultJson:JSON.stringify([{id:file.id,mime:'audio/mpeg'}])});await f.db.$transaction(tx=>f.accounting.reserveTx(tx,row,2));await f.db.voiceConfig.update({where:{id:'site'},data:{retentionDays:7,version:2}});assert.equal(await f.accounting.stage(row.id,'',[{id:file.id,mime:'audio/mpeg'}]),true);assert.equal(await f.accounting.complete(row.id),true);assert.equal(await f.accounting.complete(row.id),false);const final=await f.db.voiceTask.findUniqueOrThrow({where:{id:row.id}});assert.equal(final.expiresAt.getTime()-final.finishedAt.getTime(),2*86400000);assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).expiresAt.getTime(),final.expiresAt.getTime());assert.equal(final.chargedAmount,2);assert.equal((await f.db.userBalance.findUnique({where:{userId:f.owner.id}})).model3Count,18);
});
test('failed operations release counts and receive their own frozen retention deadline',async t=>{
 const f=await fixture(t);await f.credit();const row=await f.task({kind:'transcription',status:'RUNNING',retentionDays:3});await f.db.$transaction(tx=>f.accounting.reserveTx(tx,row,2));assert.equal(await f.accounting.stop(row.id,'FAILED','synthetic','本地模拟中断'),true);assert.equal(await f.accounting.stop(row.id,'FAILED','synthetic','重复停止'),false);const final=await f.db.voiceTask.findUniqueOrThrow({where:{id:row.id}});assert.equal(final.expiresAt.getTime()-final.finishedAt.getTime(),3*86400000);assert.equal((await f.db.uploadFile.findUnique({where:{id:row.inputFileId}})).expiresAt.getTime(),final.expiresAt.getTime());assert.equal(final.chargedAmount,0);assert.equal(final.returnedAmount,2);assert.equal((await f.db.userBalance.findUnique({where:{userId:f.owner.id}})).model3Count,20);
});
test('indefinite records survive cleanup and protect a shared recording from shorter deadlines',async t=>{
 const f=await fixture(t),file=await f.file('voice-recording'),indefinite=await f.task({kind:'transcription',inputFileId:file.id}),expired=await f.task({kind:'transcription',inputFileId:file.id,retentionDays:1,expiresAt:new Date(1000)});await f.db.$transaction(tx=>syncVoiceRecordingExpiry(tx,f.owner.id,file.id));await f.library.sweep();assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).expiresAt,null);assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).deletedAt,null);assert.equal((await f.library.detail(f.owner.id,indefinite.id)).availability,'ready');assert.ok((await f.db.voiceTask.findUnique({where:{id:expired.id}})).purgedAt);
});
test('physical storage failures keep durable cleanup work and succeed on a later pass',async t=>{
 const f=await fixture(t),file=await f.file('voice-result',f.owner.id,{expiresAt:new Date(1000)}),row=await f.task({retentionDays:1,expiresAt:new Date(1000),resultJson:JSON.stringify([{id:file.id,mime:'audio/mpeg'}])});f.failures.add(file.storedKey);await f.library.sweep();let saved=await f.db.uploadFile.findUniqueOrThrow({where:{id:file.id}});assert.ok(saved.deletedAt);assert.equal(saved.purgedAt,null);assert.ok(f.blobs.has(file.storedKey));assert.equal((await f.library.detail(f.owner.id,row.id)).availability,'expired');f.failures.delete(file.storedKey);await f.library.sweep();saved=await f.db.uploadFile.findUniqueOrThrow({where:{id:file.id}});assert.ok(saved.purgedAt);assert.equal(f.blobs.has(file.storedKey),false);
});
test('cleanup advances past a failing batch instead of starving later files',async t=>{
 const f=await fixture(t),files=[];for(let i=0;i<13;i++){const row=await f.file('voice-result',f.owner.id,{id:'cleanup-'+String(i).padStart(2,'0'),deletedAt:new Date(1000)});files.push(row);if(i<12)f.failures.add(row.storedKey);}await f.library.sweep();assert.equal((await f.db.uploadFile.findUnique({where:{id:files[12].id}})).purgedAt,null);await f.library.sweep();assert.ok((await f.db.uploadFile.findUnique({where:{id:files[12].id}})).purgedAt);assert.equal((await f.db.uploadFile.findUnique({where:{id:files[0].id}})).purgedAt,null);
});
test('abandoned temporary voice files expire without touching other file scopes',async t=>{
 const f=await fixture(t),recording=await f.file('voice-recording',f.owner.id,{expiresAt:new Date(1000)}),orphan=await f.file('voice-result',f.owner.id,{expiresAt:new Date(1000)}),ordinary=await f.file('chat',f.owner.id,{expiresAt:new Date(1000)});await f.library.sweep();for(const file of [recording,orphan])assert.ok((await f.db.uploadFile.findUnique({where:{id:file.id}})).purgedAt);assert.equal((await f.db.uploadFile.findUnique({where:{id:ordinary.id}})).deletedAt,null);assert.equal(f.blobs.has(ordinary.storedKey),true);
});
test('active accepted tasks protect their recording and temporary output from cleanup',async t=>{
 const f=await fixture(t),input=await f.file('voice-recording',f.owner.id,{expiresAt:new Date(1000)}),output=await f.file('voice-result',f.owner.id,{expiresAt:new Date(1000)}),row=await f.task({kind:'transcription',status:'RUNNING',inputFileId:input.id});await f.library.sweep();assert.equal((await f.db.uploadFile.findUnique({where:{id:input.id}})).deletedAt,null);assert.equal((await f.db.uploadFile.findUnique({where:{id:input.id}})).expiresAt,null);assert.equal((await f.db.uploadFile.findUnique({where:{id:output.id}})).deletedAt,null);assert.equal((await f.db.voiceTask.findUnique({where:{id:row.id}})).status,'RUNNING');
});
test('retention settings preserve JSON types, allow omission by older callers and bound the duration',async()=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}),body={version:1,enabled:false,speechChannelId:'',transcriptionChannelId:'',speechModel:'tts-1',transcriptionModel:'whisper-1',speechCost:0,transcriptionCost:0,pool:'model3',maxSpeechChars:16000},transform=value=>pipe.transform({...body,...value},{type:'body',metatype:VoiceConfigDto});assert.equal((await transform({})).retentionDays,undefined);assert.equal((await transform({retentionDays:7})).retentionDays,7);for(const value of ['7',null,true,1.5,-1,3651])await assert.rejects(()=>transform({retentionDays:value}),status(400));assert.equal(voiceExpiry(0,new Date()),null);assert.equal(voiceExpiry(1,new Date(1000)).getTime(),86401000);
});
test('source changes between quotation and acceptance are rejected before any task or reservation',async t=>{
 const f=await fixture(t),message=await f.message('第一次确认的回答'),payload={kind:'speech',messageId:message.id,voice:'fable'},offer=await f.voice.quote(f.owner.id,payload),prepare=f.voice.prepare.bind(f.voice);f.voice.prepare=async(...args)=>{const plan=await prepare(...args);await f.db.message.update({where:{id:message.id},data:{content:'确认后已经改过的内容'}});return plan;};await assert.rejects(()=>f.voice.create(f.owner.id,{...payload,requestKey:randomUUID(),quoteRevision:offer.revision}),status(409));assert.equal(await f.db.voiceTask.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.equal(f.providerCalls(),0);
});
test('a recording expiring between quotation and acceptance is rejected before a reservation',async t=>{
 const f=await fixture(t),file=await f.file('voice-recording'),payload={kind:'transcription',fileId:file.id},offer=await f.voice.quote(f.owner.id,payload),prepare=f.voice.prepare.bind(f.voice);f.voice.prepare=async(...args)=>{const plan=await prepare(...args);await f.db.uploadFile.update({where:{id:file.id},data:{expiresAt:new Date(1000)}});return plan;};await assert.rejects(()=>f.voice.create(f.owner.id,{...payload,requestKey:randomUUID(),quoteRevision:offer.revision}),status(409));assert.equal(await f.db.voiceTask.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.equal(f.providerCalls(),0);
});

test('the retention migration preserves every pre-existing column and leaves old records indefinite',async()=>{
 const database=join(folder,'legacy-'+randomUUID()+'.db'),db=new DatabaseSync(database),migrations=join(here,'../prisma/migrations');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL,appliedAt DATETIME NOT NULL)');for(const name of readdirSync(migrations).filter(name=>name.endsWith('.sql')&&name<'0033')){db.exec(readFileSync(join(migrations,name),'utf8'));db.prepare('INSERT INTO _migrations VALUES(?,?)').run(name,new Date().toISOString());}db.prepare('INSERT INTO users(id,email,username,passwordHash,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('legacy-owner','legacy@qgauss.test','legacy','synthetic',1000,1000);db.prepare('INSERT INTO voice_tasks(id,userId,requestKey,requestHash,kind,model,channelId,configVersion,status,transcript,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('legacy-voice','legacy-owner','legacy-request','hash','transcription','whisper-1','legacy-channel',1,'COMPLETED','旧转写内容',1000);const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_migrations' ORDER BY name").all().map(({name})=>({name,columns:db.prepare('PRAGMA table_info("'+name+'")').all().map(row=>row.name),rows:db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()}));db.close();execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:database},stdio:'pipe'});const read=new DatabaseSync(database,{readOnly:true});for(const table of tables)assert.deepEqual(read.prepare('SELECT '+table.columns.map(name=>'"'+name+'"').join(',')+' FROM "'+table.name+'" ORDER BY rowid').all(),table.rows);const row=read.prepare('SELECT retentionDays,expiresAt,deletedAt,purgedAt,transcript FROM voice_tasks WHERE id=?').get('legacy-voice');assert.deepEqual({...row},{retentionDays:0,expiresAt:null,deletedAt:null,purgedAt:null,transcript:'旧转写内容'});read.close();
});
