import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ValidationPipe} from '@nestjs/common';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {StorageService} from '../dist/modules/storage/storage.service.js';
import {ChatUploadsService} from '../dist/modules/storage/chat-uploads.service.js';
import {AttachmentsService} from '../dist/modules/chat/attachments.service.js';
import {ChatUploadKeyDto,ChatUploadBodyDto,CheckAttachmentsDto} from '../dist/modules/storage/chat-upload.dto.js';
import {translateError} from '../dist/common/i18n/messages.js';
import {BusinessException} from '../dist/common/exceptions/business.exception.js';

const root=mkdtempSync(join(tmpdir(),'qgauss-attachment-')),base=join(root,'base.db'),here=dirname(fileURLToPath(import.meta.url)),hash=buffer=>createHash('sha256').update(buffer).digest('hex');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5)),until=async read=>{for(let i=0;i<600;i++){const value=await read();if(value)return value;await tick();}throw Error('Upload receipt did not settle');},status=code=>error=>error.getStatus?.()===code;
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
const incoming=(text='QGauss original document {count} $&',name='QGauss 原文件.txt')=>({buffer:Buffer.from(text),originalname:name,mimetype:'text/plain',size:Buffer.byteLength(text)});
const intent=stage=>hash(JSON.stringify({sha256:stage.sha256,size:stage.size,mime:stage.mime,filename:stage.filename}));
async function fixture(t,initialize=true){
 const database=join(root,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database}}}),owner=await db.user.create({data:{username:randomUUID(),email:randomUUID()+'@qgauss.test',passwordHash:'synthetic'}}),other=await db.user.create({data:{username:randomUUID(),email:randomUUID()+'@qgauss.test',passwordHash:'synthetic',role:'ADMIN'}}),settings={async get(key){return({'upload.maxSizeMb':10,'upload.allowedMime':'text/plain,image/png,application/pdf','chat.maxAttachments':9,'chat.attachmentMaxChars':20000})[key];}},storage=new StorageService(db,settings),blobs=new Map(),puts=[],gets=[],removals=[];
 storage.driver={name:'local',async put(key,buffer){puts.push(key);blobs.set(key,Buffer.from(buffer));},async get(key){gets.push(key);if(!blobs.has(key))throw Error('Storage object is missing');return blobs.get(key);},async exists(key){return blobs.has(key);},async remove(key){removals.push(key);blobs.delete(key);}};
 const uploads=new ChatUploadsService(db,storage),attachments=new AttachmentsService(db,storage,settings);if(initialize)uploads.onModuleInit();t.after(async()=>{await uploads.onModuleDestroy();await db.$disconnect();});
 async function terminal(key,userId=owner.id){return until(async()=>{const row=await db.uploadReceipt.findUnique({where:{userId_requestKey:{userId,requestKey:key}}});return row&&['STORED','FAILED'].includes(row.status)?row:null;});}
 async function file(extra={}){const data=incoming(),id=randomUUID(),storedKey='2026/11/'+id+'.txt';blobs.set(storedKey,data.buffer);return db.uploadFile.create({data:{id,userId:owner.id,scope:'chat',filename:data.originalname,mime:'text/plain',size:data.size,sha256:hash(data.buffer),storedKey,...extra}});}
 async function staged(extra={}){const input=incoming(),stage=await storage.prepareChatUpload(input),key=randomUUID(),row=await db.uploadReceipt.create({data:{userId:owner.id,requestKey:key,inputHash:intent(stage),stageJson:JSON.stringify(stage),...extra}});return{stage,key,row,input};}
 return{db,owner,other,storage,uploads,attachments,blobs,puts,gets,removals,file,terminal,staged};
}
test('concurrent and delayed initial upload requests keep one receipt, one file and one write',async t=>{
 const f=await fixture(t),key=randomUUID(),input=incoming();await Promise.all(Array.from({length:10},()=>f.uploads.save(f.owner.id,key,0,input)));const row=await f.terminal(key);assert.equal(row.status,'STORED');await f.uploads.save(f.owner.id,key,0,input);const receipt=await f.uploads.read(f.owner.id,key);assert.equal(receipt.file.id,row.fileId);assert.equal(receipt.version,1);assert.equal(await f.db.uploadReceipt.count(),1);assert.equal(await f.db.uploadFile.count(),1);assert.equal(f.puts.length,1);assert.equal(await f.db.countReservation.count(),0);assert.equal(await f.db.usageRecord.count(),0);assert.deepEqual((await f.storage.read(row.fileId,f.owner.id,'USER')).buffer,input.buffer);assert.equal(JSON.stringify(receipt).includes('stageJson'),false);assert.equal(JSON.stringify(receipt).includes('storedKey'),false);
});
test('the same operation cannot replace its original bytes or filename',async t=>{
 const f=await fixture(t),key=randomUUID(),input=incoming();await f.uploads.save(f.owner.id,key,0,input);const row=await f.terminal(key);for(const replacement of[incoming('different'),incoming(undefined,'Different.txt')])await assert.rejects(()=>f.uploads.save(f.owner.id,key,1,replacement),status(409));assert.equal(f.puts.length,1);assert.equal((await f.uploads.read(f.owner.id,key)).file.id,row.fileId);
});
test('a lost storage response is reconciled from the same bytes without another write',async t=>{
 const f=await fixture(t),put=f.storage.driver.put;f.storage.driver.put=async(...args)=>{await put(...args);throw Error('Response lost after successful object write');};const key=randomUUID();await f.uploads.save(f.owner.id,key,0,incoming());assert.equal((await f.terminal(key)).status,'STORED');assert.equal(f.puts.length,1);assert.equal(await f.db.uploadFile.count(),1);
});
test('late initial requests do not retry a failed upload; explicit retry uses its current version',async t=>{
 const f=await fixture(t),put=f.storage.driver.put;let attempts=0;f.storage.driver.put=async(...args)=>{attempts++;if(attempts===1)throw Error('Write failed');return put(...args);};const key=randomUUID(),input=incoming();await f.uploads.save(f.owner.id,key,0,input);const failed=await f.terminal(key);assert.equal(failed.status,'FAILED');assert.equal(failed.version,1);await f.uploads.save(f.owner.id,key,0,input);assert.equal(attempts,1);await f.uploads.save(f.owner.id,key,1,input);const stored=await f.terminal(key);assert.equal(stored.version,2);assert.equal(stored.status,'STORED');assert.equal(attempts,2);assert.equal(await f.db.uploadFile.count(),1);assert.equal(f.blobs.size,1);
});
test('a status read in the gap after acceptance cannot mistake an active body for an interrupted upload',async t=>{
 const f=await fixture(t),accepted=deferred(),release=deferred(),transaction=f.db.$transaction.bind(f.db);let held=false;f.db.$transaction=async(...args)=>{const result=await transaction(...args);if(!held&&result?.row&&result.write){held=true;accepted.resolve();await release.promise;}return result;};const key=randomUUID(),saving=f.uploads.save(f.owner.id,key,0,incoming());await accepted.promise;assert.equal((await f.uploads.read(f.owner.id,key)).status,'storing');assert.equal(await f.db.uploadFile.count(),0);release.resolve();await saving;assert.equal((await f.terminal(key)).status,'STORED');assert.equal(f.puts.length,1);
});
test('accepted uploads recover after restart from verified staged bytes',async t=>{
 const f=await fixture(t,false),staged=await f.staged();await f.storage.putArtifact(staged.stage,staged.input.buffer);f.uploads.onModuleInit();const stored=await f.terminal(staged.key);assert.equal(stored.status,'STORED');assert.equal(stored.fileId,staged.stage.id);assert.equal(f.puts.length,1);assert.equal(await f.db.uploadFile.count(),1);
});
test('a restart before any bytes were stored leaves an explicit retryable failure',async t=>{
 const f=await fixture(t,false),staged=await f.staged();f.uploads.onModuleInit();const failed=await f.terminal(staged.key);assert.equal(failed.status,'FAILED');assert.equal(failed.errorCode,'INTERRUPTED');assert.equal(f.puts.length,0);assert.equal(await f.db.uploadFile.count(),0);await f.uploads.save(f.owner.id,staged.key,1,staged.input);assert.equal((await f.terminal(staged.key)).status,'STORED');
});
test('uncertain storage availability stays unconfirmed and can reconcile the original file later',async t=>{
 const f=await fixture(t,false),staged=await f.staged(),exists=f.storage.driver.exists;await f.storage.putArtifact(staged.stage,staged.input.buffer);f.storage.driver.exists=async()=>{throw Error('Temporary storage outage');};f.uploads.onModuleInit();await until(async()=>((await f.db.uploadReceipt.findUnique({where:{id:staged.row.id}})).status==='VERIFYING'));assert.equal((await f.uploads.read(f.owner.id,staged.key)).status,'verifying');f.storage.driver.exists=exists;await until(async()=>{await f.uploads.read(f.owner.id,staged.key);return(await f.db.uploadReceipt.findUnique({where:{id:staged.row.id}})).status==='STORED';});assert.equal(f.puts.length,1);assert.equal(await f.db.uploadFile.count(),1);
});
test('corrupt staged bytes are rejected and do not remain as an orphan file',async t=>{
 const f=await fixture(t,false),staged=await f.staged();f.blobs.set(staged.stage.storedKey,Buffer.from('wrong'));f.uploads.onModuleInit();const failed=await f.terminal(staged.key);assert.equal(failed.errorCode,'INTEGRITY');assert.equal(f.blobs.size,0);assert.equal(await f.db.uploadFile.count(),0);
});
test('owner and global bounds limit accepted writes while duplicate requests stay free',async t=>{
 const f=await fixture(t),hold=deferred(),put=f.storage.driver.put;f.storage.driver.put=async(...args)=>{await hold.promise;return put(...args);};const keys=[];for(const userId of[f.owner.id,f.other.id])for(let i=0;i<3;i++){const key=randomUUID();keys.push({key,userId});await f.uploads.save(userId,key,0,incoming());}await assert.rejects(()=>f.uploads.save(f.owner.id,randomUUID(),0,incoming()),status(429));assert.equal(await f.db.uploadReceipt.count(),6);hold.resolve();await Promise.all(keys.map(row=>f.terminal(row.key,row.userId)));assert.equal(await f.db.uploadFile.count(),6);
});
test('receipt keys are private per owner and cannot be used by another account or administrator',async t=>{
 const f=await fixture(t),key=randomUUID();await f.uploads.save(f.owner.id,key,0,incoming());const first=await f.terminal(key);await assert.rejects(()=>f.uploads.read(f.other.id,key),status(404));await f.uploads.save(f.other.id,key,0,incoming());const second=await f.terminal(key,f.other.id);assert.notEqual(first.fileId,second.fileId);const check=await f.attachments.preflight(f.other.id,[first.fileId]);assert.deepEqual(check.items,[{id:first.fileId,status:'unavailable'}]);
});
test('file removal never turns a receipt read or repeated upload into a restoration',async t=>{
 const f=await fixture(t),key=randomUUID(),input=incoming();await f.uploads.save(f.owner.id,key,0,input);const row=await f.terminal(key);await f.storage.trashFile(f.owner.id,row.fileId,1);assert.equal((await f.uploads.read(f.owner.id,key)).status,'unavailable');assert.equal((await f.uploads.save(f.owner.id,key,1,input)).status,'unavailable');assert.equal(f.puts.length,1);assert.ok((await f.db.uploadFile.findUnique({where:{id:row.fileId}})).trashedAt);
});
test('content sniffing and size limits apply before an upload receipt is accepted',async t=>{
 const f=await fixture(t);await assert.rejects(()=>f.uploads.save(f.owner.id,randomUUID(),0,{...incoming(),buffer:Buffer.from([0,1,2,3])}),status(415));await assert.rejects(()=>f.uploads.save(f.owner.id,randomUUID(),0,{...incoming(),buffer:Buffer.alloc(11*1024*1024,65)}),status(413));assert.equal(await f.db.uploadReceipt.count(),0);const key=randomUUID();await f.uploads.save(f.owner.id,key,0,{...incoming(),mimetype:'image/png'});await f.terminal(key);assert.equal((await f.uploads.read(f.owner.id,key)).file.mime,'text/plain');
});
test('preflight extracts an owned document without returning its content or reserving credits',async t=>{
 const f=await fixture(t),file=await f.file(),result=await f.attachments.preflight(f.owner.id,[file.id]);assert.equal(result.items[0].status,'available');assert.equal(JSON.stringify(result).includes('original document'),false);assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).extractedText,incoming().buffer.toString());assert.equal(f.gets.length,1);const resolved=await f.attachments.resolve(f.owner.id,[{role:'user',content:'keep my question',attachments:[file.id]}],{vision:false});assert.match(resolved.messages[0].content,/QGauss original document/);assert.ok(resolved.messages[0].content.endsWith('keep my question'));assert.equal(f.gets.length,1);assert.equal(await f.db.countReservation.count(),0);assert.equal(await f.db.usageRecord.count(),0);
});
test('expired, purged and deleted cached documents cannot be sent as a new question',async t=>{
 const f=await fixture(t);for(const extra of[{expiresAt:new Date(1000)},{purgedAt:new Date()},{deletedAt:new Date()}]){const file=await f.file({extractedText:'private cached text',...extra});assert.deepEqual((await f.attachments.preflight(f.owner.id,[file.id])).items,[{id:file.id,status:'unavailable'}]);await assert.rejects(()=>f.attachments.resolve(f.owner.id,[{role:'user',content:'new question',attachments:[file.id]}],{vision:false}),error=>error.bizCode===4011);}assert.equal(f.gets.length,0);
});
test('unavailable historical attachments become placeholders and do not block a new file-free question',async t=>{
 const f=await fixture(t),file=await f.file({deletedAt:new Date(),extractedText:'withdrawn private text'}),result=await f.attachments.resolve(f.owner.id,[{role:'user',content:'old question',attachments:[file.id]},{role:'assistant',content:'original reply'},{role:'user',content:'continue with no attachment'}],{vision:false});assert.match(result.messages[0].content,/较早的附件已不可用/);assert.equal(JSON.stringify(result).includes('withdrawn private text'),false);assert.equal(result.messages.at(-1).content,'continue with no attachment');assert.deepEqual(result.lastUserAttachments,[]);assert.equal(f.gets.length,0);
});
test('a document withdrawn during extraction cannot repopulate its cache or become ready',async t=>{
 const f=await fixture(t),file=await f.file(),read=f.storage.read.bind(f.storage);f.storage.read=async(...args)=>{const result=await read(...args);await f.db.uploadFile.update({where:{id:file.id},data:{deletedAt:new Date()}});return result;};assert.equal((await f.attachments.preflight(f.owner.id,[file.id])).items[0].status,'unavailable');assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).extractedText,null);
});
test('unreadable documents are identified during preflight instead of starting a reply with a placeholder',async t=>{
 const f=await fixture(t),file=await f.file({extractError:'The document is invalid'}),result=await f.attachments.preflight(f.owner.id,[file.id]);assert.equal(result.items[0].status,'unavailable');assert.equal(result.items[0].reason,'unreadable');await assert.rejects(()=>f.attachments.resolve(f.owner.id,[{role:'user',content:'use this file',attachments:[file.id]}],{vision:false}),error=>error.bizCode===4012);assert.equal(await f.db.countReservation.count(),0);
});
test('transient file storage failure remains unknown and does not poison the extraction cache',async t=>{
 const f=await fixture(t),file=await f.file(),get=f.storage.driver.get;f.storage.driver.get=async()=>{throw Error('temporary storage outage');};assert.equal((await f.attachments.preflight(f.owner.id,[file.id])).items[0].status,'unknown');assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).extractError,null);f.storage.driver.get=get;assert.equal((await f.attachments.preflight(f.owner.id,[file.id])).items[0].status,'available');
});
test('upload and preflight inputs enforce key format, body types and the attachment limit',async()=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}),body=(type,value)=>pipe.transform(value,{type:'body',metatype:type});assert.equal((await body(ChatUploadBodyDto,{expectedVersion:'0'})).expectedVersion,0);assert.equal((await body(ChatUploadBodyDto,{expectedVersion:1})).expectedVersion,1);for(const value of[' 1','1.5','',null,true,-1])await assert.rejects(()=>body(ChatUploadBodyDto,{expectedVersion:value}),status(400));await body(ChatUploadKeyDto,{key:randomUUID()});await assert.rejects(()=>body(ChatUploadKeyDto,{key:'../other-file'}),status(400));for(const ids of[[],['a','a'],Array.from({length:10},(_,i)=>String(i)),[{}],['x'.repeat(129)]])await assert.rejects(()=>body(CheckAttachmentsDto,{ids}),status(400));assert.match(translateError(4011,'en','fallback'),/Restore it or remove it/);assert.match(translateError(4012,'en','fallback'),/could not be read/);
});
test('preflight bounds repeated document work per account without using model credits',async t=>{
 const f=await fixture(t),file=await f.file();for(let i=0;i<30;i++)assert.equal((await f.attachments.preflight(f.owner.id,[file.id])).items[0].status,'available');await assert.rejects(()=>f.attachments.preflight(f.owner.id,[file.id]),status(429));assert.equal((await f.attachments.preflight(f.other.id,[file.id])).items[0].status,'unavailable');assert.equal(f.gets.length,1);assert.equal(await f.db.countReservation.count(),0);
});

test('an account removed during a write leaves neither a file record nor an orphan object',async t=>{
 const f=await fixture(t),arrived=deferred(),release=deferred(),put=f.storage.driver.put;
 f.storage.driver.put=async(...args)=>{arrived.resolve();await release.promise;return put(...args);};
 try{await f.uploads.save(f.owner.id,randomUUID(),0,incoming());await arrived.promise;await f.db.user.delete({where:{id:f.owner.id}});release.resolve();await f.uploads.onModuleDestroy();assert.equal(await f.db.uploadReceipt.count(),0);assert.equal(await f.db.uploadFile.count(),0);assert.equal(f.blobs.size,0);assert.equal(f.puts.length,1);assert.equal(f.removals.length,1);}finally{release.resolve();}
});

test('a cached document whose stored bytes disappear cannot be sent or leak through historical context',async t=>{
 const f=await fixture(t),file=await f.file({extractedText:'private cached bytes'});f.blobs.delete(file.storedKey);
 await assert.rejects(()=>f.attachments.resolve(f.owner.id,[{role:'user',content:'new',attachments:[file.id]}],{vision:false}),error=>error.bizCode===4011);
 const result=await f.attachments.resolve(f.owner.id,[{role:'user',content:'old',attachments:[file.id]},{role:'assistant',content:'old reply'},{role:'user',content:'continue'}],{vision:false});assert.match(result.messages[0].content,/较早的附件已不可用/);assert.equal(JSON.stringify(result).includes('private cached bytes'),false);assert.equal(f.gets.length,0);
});

test('unknown cached file availability refuses admission and leaves its text cache intact',async t=>{
 const f=await fixture(t),file=await f.file({extractedText:'original cached text'});f.storage.driver.exists=async()=>{throw Error('Temporary storage outage');};
 await assert.rejects(()=>f.attachments.resolve(f.owner.id,[{role:'user',content:'new',attachments:[file.id]}],{vision:false}),error=>error.bizCode===4013&&error.getStatus()===503);assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).extractedText,'original cached text');assert.equal(await f.db.countReservation.count(),0);assert.match(translateError(4013,'en','fallback'),/could not be checked/);
});

test('a historical file removed immediately before reading does not block a new question',async t=>{
 const f=await fixture(t),file=await f.file();f.storage.read=async()=>{throw new BusinessException(1002,'File removed',404);};
 const result=await f.attachments.resolve(f.owner.id,[{role:'user',content:'old',attachments:[file.id]},{role:'assistant',content:'old reply'},{role:'user',content:'continue'}],{vision:false});assert.match(result.messages[0].content,/较早的附件已不可用/);assert.equal(result.messages.at(-1).content,'continue');assert.equal((await f.db.uploadFile.findUnique({where:{id:file.id}})).extractError,null);
});
