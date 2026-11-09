import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ValidationPipe} from '@nestjs/common';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {StorageService} from '../dist/modules/storage/storage.service.js';
import {ArtifactSavesService} from '../dist/modules/agents/artifact-saves.service.js';
import {ArtifactSaveDto} from '../dist/modules/agents/agent.dto.js';
import {FileLibraryDto,FileVersionDto} from '../dist/modules/storage/file-library.dto.js';
import {safeAgentActivity} from '../dist/common/llm/agent-activity.js';
import {downloadArtifact} from '../dist/common/net/artifact-download.js';

const root=mkdtempSync(join(tmpdir(),'qgauss-files-')),base=join(root,'base.db'),here=dirname(fileURLToPath(import.meta.url)),png=Buffer.from('89504e470d0a1a0a00000000494741454e44','hex'),requests=[];
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
let delayed;
const server=createServer((req,res)=>{requests.push({url:req.url,headers:req.headers});
 if(req.url==='/slow'){delayed=()=>{res.writeHead(200);res.end(png);};return;}
 if(req.url==='/redirect'){res.writeHead(302,{location:'/file.png'});res.end();return;}
 if(req.url==='/private'){res.writeHead(302,{location:'http://169.254.169.254/latest'});res.end();return;}
 if(req.url==='/expired'){res.writeHead(410);res.end();return;}
 if(req.url==='/large'){res.writeHead(200,{'content-length':'30000000'});res.end();return;}
 if(req.url==='/chunked'){res.writeHead(200);res.write(Buffer.alloc(50,65));res.end(Buffer.alloc(50,66));return;}
 if(req.url==='/empty'){res.writeHead(200);res.end();return;}
 if(req.url==='/unknown'){res.writeHead(200);res.end(Buffer.from([0,1,2,3]));return;}
 if(req.url==='/file.txt'){res.writeHead(200,{'content-type':'text/plain'});res.end('QGauss 原始文件 {count} $&');return;}
 res.writeHead(200,{'content-type':'image/png'});res.end(png);
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,url=path=>`http://127.0.0.1:${port}${path}`,keys=['ALLOW_HTTP_UPSTREAM','UPSTREAM_PORT_ALLOWLIST','UPSTREAM_PRIVATE_ALLOWLIST'],old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
Object.assign(process.env,{ALLOW_HTTP_UPSTREAM:'1',UPSTREAM_PORT_ALLOWLIST:String(port)+',80',UPSTREAM_PRIVATE_ALLOWLIST:'127.0.0.1:'+port});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];rmSync(root,{recursive:true,force:true});});
const status=code=>error=>error.getStatus?.()===code;
const until=async read=>{for(let i=0;i<500;i++){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Receipt did not settle');};
async function fixture(t,path='/file.png',init=true){
 const database=join(root,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database}}});
 const owner=await db.user.create({data:{email:randomUUID()+'@qgauss.test',username:randomUUID(),passwordHash:'synthetic'}}),other=await db.user.create({data:{email:randomUUID()+'@qgauss.test',username:randomUUID(),passwordHash:'synthetic',role:'ADMIN'}}),conversation=await db.conversation.create({data:{userId:owner.id,title:'QGauss files'}});
 const report={kind:'agent',status:'completed',context:'fresh',steps:[],suggestions:[],artifacts:[{url:url(path),title:path.endsWith('.txt')?'原文件 {count} $&.txt':'QGauss-file.png',kind:path.endsWith('.txt')?'file':'image'}]},message=await db.message.create({data:{conversationId:conversation.id,role:'ASSISTANT',agentJson:JSON.stringify(report)}}),key=safeAgentActivity(report).artifacts[0].key;
 const config={'upload.maxSizeMb':10,'upload.allowedMime':'image/png,text/plain'},storage=new StorageService(db,{async get(key){return config[key];}}),blobs=new Map(),puts=[];
 storage.driver={name:'local',async put(key,buffer){puts.push(key);blobs.set(key,Buffer.from(buffer));},async get(key){if(!blobs.has(key))throw new Error('Missing object');return blobs.get(key);},async exists(key){return blobs.has(key);},async remove(key){blobs.delete(key);}};
 const saves=new ArtifactSavesService(db,storage);if(init)await saves.onModuleInit();t.after(async()=>{await saves.onModuleDestroy();await db.$disconnect();});
 const settled=()=>until(async()=>{const row=await db.agentArtifactSave.findFirst({where:{messageId:message.id}});return row&&!['QUEUED','FETCHING','STORING','VERIFYING'].includes(row.status)?row:null;});
 return{db,owner,other,conversation,message,key,storage,blobs,puts,config,saves,settled,report};
}
test('ten concurrent and delayed initial clicks save one original file without a new usage record',async t=>{
 const f=await fixture(t),before=requests.length;await Promise.all(Array.from({length:10},()=>f.saves.save(f.owner.id,f.message.id,f.key,0)));const row=await f.settled();assert.equal(row.status,'SAVED');await f.saves.save(f.owner.id,f.message.id,f.key,0);assert.equal(await f.db.agentArtifactSave.count(),1);assert.equal(await f.db.uploadFile.count(),1);assert.equal(await f.db.usageRecord.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.equal(requests.length-before,1);assert.equal(f.puts.length,1);const receipt=(await f.saves.list(f.owner.id,f.message.id)).items[0];assert.equal(receipt.status,'saved');assert.equal(receipt.version,1);assert.deepEqual((await f.storage.read(receipt.file.id,f.owner.id,'USER')).buffer,png);assert.equal(receipt.file.scope,'agent-result');assert.ok(!JSON.stringify(receipt).includes('sourceUrl'));assert.ok(!JSON.stringify(receipt).includes('storedKey'));
});
test('reading unsaved receipts does not retrieve a remote file and keys cannot select arbitrary URLs',async t=>{
 const f=await fixture(t),before=requests.length;for(let i=0;i<4;i++)assert.deepEqual((await f.saves.list(f.owner.id,f.message.id)).items,[{key:f.key,version:0,status:'unsaved'}]);assert.equal(requests.length,before);await assert.rejects(()=>f.saves.save(f.owner.id,f.message.id,'f'.repeat(64),0),status(404));assert.equal(await f.db.agentArtifactSave.count(),0);
});
test('other owners, including an administrator, cannot read or save this private result',async t=>{
 const f=await fixture(t);await assert.rejects(()=>f.saves.list(f.other.id,f.message.id),status(404));await assert.rejects(()=>f.saves.save(f.other.id,f.message.id,f.key,0),status(404));await f.saves.save(f.owner.id,f.message.id,f.key,0);const row=await f.settled();await assert.rejects(()=>f.storage.read(row.fileId,f.other.id,'ADMIN'),status(404));await assert.rejects(()=>f.storage.trashFile(f.other.id,row.fileId,1),status(404));assert.equal((await f.storage.listLibrary(f.other.id,{})).total,0);
});
test('a save accepted before a delayed response remains one task after repeated reads',async t=>{
 const f=await fixture(t,'/slow'),before=requests.length;await f.saves.save(f.owner.id,f.message.id,f.key,0);await until(()=>delayed);for(let i=0;i<4;i++)await f.saves.list(f.owner.id,f.message.id);await f.saves.save(f.owner.id,f.message.id,f.key,0);assert.equal(requests.length-before,1);delayed();delayed=null;assert.equal((await f.settled()).status,'SAVED');
});
test('an expired result can only retry with the current explicit receipt version',async t=>{
 const f=await fixture(t,'/expired'),before=requests.length;await f.saves.save(f.owner.id,f.message.id,f.key,0);assert.equal((await f.settled()).errorCode,'EXPIRED');await f.saves.save(f.owner.id,f.message.id,f.key,0);assert.equal(requests.length-before,1);await f.saves.save(f.owner.id,f.message.id,f.key,1);const row=await f.settled();assert.equal(row.version,2);assert.equal(requests.length-before,2);assert.equal(await f.db.uploadFile.count(),0);
});
test('redirects are validated at every hop and no provider authorization is sent',async()=>{
 const before=requests.length;assert.deepEqual(await downloadArtifact(url('/redirect'),1024),png);assert.equal(requests.length-before,2);for(const request of requests.slice(before)){assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.cookie,undefined);}await assert.rejects(()=>downloadArtifact(url('/private'),1024),error=>error.code==='ADDRESS');
});
test('declared length, streamed length, empty files, and unsupported content are bounded',async t=>{
 await assert.rejects(()=>downloadArtifact(url('/large'),1024),error=>error.code==='TOO_LARGE');await assert.rejects(()=>downloadArtifact(url('/chunked'),64),error=>error.code==='TOO_LARGE');await assert.rejects(()=>downloadArtifact(url('/empty'),1024),error=>error.code==='EMPTY');const f=await fixture(t,'/unknown');await f.saves.save(f.owner.id,f.message.id,f.key,0);assert.equal((await f.settled()).errorCode,'FORMAT');assert.equal(await f.db.uploadFile.count(),0);
});
test('site size and format settings apply to saved results while original messages remain unchanged',async t=>{
 const f=await fixture(t);f.config['upload.allowedMime']='text/plain';await f.saves.save(f.owner.id,f.message.id,f.key,0);assert.equal((await f.settled()).errorCode,'FORMAT');assert.equal((await f.db.message.findUnique({where:{id:f.message.id}})).agentJson,JSON.stringify(f.report));assert.equal(f.blobs.size,0);
});
test('trash blocks reads and attachment access; restoring keeps original bytes and invalidates old actions',async t=>{
 const f=await fixture(t,'/file.txt');await f.saves.save(f.owner.id,f.message.id,f.key,0);const row=await f.settled(),original=await f.storage.read(row.fileId,f.owner.id,'USER');await f.storage.trashFile(f.owner.id,row.fileId,1);assert.equal((await f.saves.list(f.owner.id,f.message.id)).items[0].status,'trashed');await assert.rejects(()=>f.storage.read(row.fileId,f.owner.id,'USER'),status(404));assert.equal((await f.storage.listLibrary(f.owner.id,{})).total,0);const trash=await f.storage.listLibrary(f.owner.id,{trash:'1'});assert.equal(trash.total,1);assert.equal(trash.items[0].version,2);await f.saves.save(f.owner.id,f.message.id,f.key,1);assert.equal(await f.db.uploadFile.count(),1);await f.storage.trashFile(f.owner.id,row.fileId,2,true);assert.deepEqual((await f.storage.read(row.fileId,f.owner.id,'USER')).buffer,original.buffer);assert.equal((await f.saves.list(f.owner.id,f.message.id)).items[0].status,'saved');await assert.rejects(()=>f.storage.trashFile(f.owner.id,row.fileId,1),status(409));assert.equal((await f.storage.detail(row.fileId,f.owner.id,'USER')).version,3);
});
test('permanent removal cannot be restored, and an explicit save creates one new copy',async t=>{
 const f=await fixture(t);await f.saves.save(f.owner.id,f.message.id,f.key,0);const row=await f.settled();await f.storage.remove(row.fileId,f.owner.id,'USER');assert.equal((await f.saves.list(f.owner.id,f.message.id)).items[0].status,'removed');await assert.rejects(()=>f.storage.trashFile(f.owner.id,row.fileId,2,true),status(409));await f.saves.save(f.owner.id,f.message.id,f.key,1);const next=await f.settled();assert.equal(next.version,2);assert.notEqual(next.fileId,row.fileId);assert.equal(f.blobs.size,1);
});
test('restarting after the object write recovers its local staged bytes without another remote fetch',async t=>{
 const f=await fixture(t,'/file.png',false),stage=await f.storage.prepareArtifact(png,'QGauss-file.png');await f.storage.putArtifact(stage,png);await f.db.agentArtifactSave.create({data:{userId:f.owner.id,messageId:f.message.id,artifactKey:f.key,sourceUrl:url('/file.png'),title:'QGauss-file.png',status:'STORING',stageJson:JSON.stringify(stage)}});const before=requests.length;await f.saves.onModuleInit();assert.equal((await f.settled()).status,'SAVED');assert.equal(requests.length,before);assert.equal(f.puts.length,1);assert.equal(await f.db.uploadFile.count(),1);
});
test('interrupted retrieval has an explicit failed receipt after restart and does not fetch automatically',async t=>{
 const f=await fixture(t,'/file.png',false);await f.db.agentArtifactSave.create({data:{userId:f.owner.id,messageId:f.message.id,artifactKey:f.key,sourceUrl:url('/file.png'),title:'QGauss-file.png',status:'FETCHING'}});const before=requests.length;await f.saves.onModuleInit();const row=await f.settled();assert.equal(row.status,'FAILED');assert.equal(row.errorCode,'INTERRUPTED');await f.saves.list(f.owner.id,f.message.id);assert.equal(requests.length,before);
});
test('a missing saved object is unavailable and explicit recovery withdraws its stale library row',async t=>{
 const f=await fixture(t);await f.saves.save(f.owner.id,f.message.id,f.key,0);const old=await f.settled(),file=await f.db.uploadFile.findUnique({where:{id:old.fileId}});f.blobs.delete(file.storedKey);assert.equal((await f.saves.list(f.owner.id,f.message.id)).items[0].status,'removed');await f.saves.save(f.owner.id,f.message.id,f.key,1);assert.equal((await f.settled()).status,'SAVED');assert.equal((await f.storage.listLibrary(f.owner.id,{})).total,1);assert.ok((await f.db.uploadFile.findUnique({where:{id:old.fileId}})).purgedAt);
});
test('a write that stored bytes before reporting an error reconciles the same staged object',async t=>{
 const f=await fixture(t),put=f.storage.driver.put;f.storage.driver.put=async(...args)=>{await put(...args);throw Error('Ambiguous storage reply');};await f.saves.save(f.owner.id,f.message.id,f.key,0);assert.equal((await f.settled()).status,'SAVED');assert.equal(f.puts.length,1);assert.equal(await f.db.uploadFile.count(),1);
});
test('corrupt staged bytes are never promoted into a saved file',async t=>{
 const f=await fixture(t,'/file.png',false),stage=await f.storage.prepareArtifact(png,'QGauss-file.png');f.blobs.set(stage.storedKey,Buffer.from('wrong bytes'));await f.db.agentArtifactSave.create({data:{userId:f.owner.id,messageId:f.message.id,artifactKey:f.key,sourceUrl:url('/file.png'),title:'QGauss-file.png',status:'STORING',stageJson:JSON.stringify(stage)}});const before=requests.length;await f.saves.onModuleInit();assert.equal((await f.settled()).errorCode,'INTEGRITY');assert.equal(await f.db.uploadFile.count(),0);assert.equal(requests.length,before);await f.saves.save(f.owner.id,f.message.id,f.key,1);assert.equal((await f.settled()).status,'SAVED');assert.equal(f.blobs.size,1);
});
test('library search filters image and document files without exposing internal storage or special-purpose files',async t=>{
 const f=await fixture(t,'/file.txt');await f.saves.save(f.owner.id,f.message.id,f.key,0);await f.settled();await f.db.uploadFile.create({data:{userId:f.owner.id,scope:'voice-result',filename:'Hidden voice',storedKey:'2026/11/'+randomUUID()+'.mp3',mime:'audio/mpeg',size:10,sha256:'a'.repeat(64)}});assert.equal((await f.storage.listLibrary(f.owner.id,{kind:'image'})).total,0);const result=await f.storage.listLibrary(f.owner.id,{kind:'file',q:'{count} $&'});assert.equal(result.total,1);assert.equal(result.items[0].filename,'原文件 {count} $&.txt');assert.equal(result.items[0].storedKey,undefined);assert.equal(result.items[0].sha256,undefined);
});
test('active replies and disabled owners cannot admit a new save',async t=>{
 const f=await fixture(t);await f.db.message.update({where:{id:f.message.id},data:{status:'STREAMING'}});await assert.rejects(()=>f.saves.save(f.owner.id,f.message.id,f.key,0),status(409));await f.db.message.update({where:{id:f.message.id},data:{status:'COMPLETED'}});await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});await assert.rejects(()=>f.saves.save(f.owner.id,f.message.id,f.key,0),status(403));assert.equal(await f.db.agentArtifactSave.count(),0);
});
test('receipt and file mutation versions preserve JSON types and queries enforce limits',async()=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}),body=(type,value)=>pipe.transform(value,{type:'body',metatype:type});assert.equal((await body(ArtifactSaveDto,{expectedVersion:0})).expectedVersion,0);assert.equal((await body(FileVersionDto,{expectedVersion:1})).expectedVersion,1);for(const value of ['1',null,true,1.5,-1])await assert.rejects(()=>body(ArtifactSaveDto,{expectedVersion:value}),status(400));await assert.rejects(()=>body(FileVersionDto,{expectedVersion:0}),status(400));for(const query of [{library:'yes'},{kind:'audio'},{q:'x'.repeat(101)},{page:0},{pageSize:101}])await assert.rejects(()=>pipe.transform(query,{type:'query',metatype:FileLibraryDto}),status(400));
});
