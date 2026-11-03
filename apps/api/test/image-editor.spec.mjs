import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {ValidationPipe} from '@nestjs/common';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {ImageEditorService} from '../dist/modules/image/image-editor.service.js';
import {ImageEditorInputDto} from '../dist/modules/image/image-editor.controller.js';
const here=dirname(fileURLToPath(import.meta.url)),directory=mkdtempSync(join(tmpdir(),'qgauss-image-editor-')),base=join(directory,'base.db');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
after(()=>{const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep+'qgauss-image-editor-'));rmSync(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
const status=code=>error=>error.getStatus?.()===code;
const source=await sharp({create:{width:64,height:48,channels:3,background:'#ac7ae4'}}).png().toBuffer(),otherSource=await sharp({create:{width:64,height:48,channels:3,background:'#7adb8a'}}).png().toBuffer();
async function alphaMask(width=64,height=48){const raw=Buffer.alloc(width*height*4,255);for(let y=0;y<height;y++)for(let x=0;x<width/2;x++)raw[(y*width+x)*4+3]=0;return sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();}
async function fixture(t){
 const database=join(directory,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database.replace(/\\/g,'/')}}}),blobs=new Map(),reads=[];let onRead;
 const [owner,other,admin]=await Promise.all(['owner','other','admin'].map(username=>db.user.create({data:{username,email:username+'@qgauss.test',passwordHash:'synthetic-only',role:username==='admin'?'ADMIN':'USER'}})));
 const storage={async read(id,userId,role){reads.push({id,userId,role});await onRead?.(id,reads.filter(row=>row.id===id).length);const row=await db.uploadFile.findUniqueOrThrow({where:{id}});if(row.userId!==userId||row.deletedAt||row.purgedAt)throw Error('Private file unavailable');return{buffer:blobs.get(id),mime:row.mime};}},service=new ImageEditorService(db,storage,new RateLimitService());
 async function file(buffer=source,mime='image/png',userId=owner.id,extra={}){const row=await db.uploadFile.create({data:{userId,mime,filename:'QGauss 私人图片.png',storedKey:'PRIVATE-STORAGE/'+randomUUID(),size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),...extra}});blobs.set(row.id,buffer);return row;}
 t.after(()=>db.$disconnect());return{db,owner,other,admin,service,file,blobs,reads,onRead:callback=>{onRead=callback;}};
}

test('image editor validates an owned image and mask without exposing storage, credentials or accounting',async t=>{
 const f=await fixture(t),image=await f.file(),mask=await f.file(await alphaMask()),result=await f.service.inputs(f.owner.id,image.id,mask.id);assert.equal(result.source.width,64);assert.equal(result.source.height,48);assert.equal(result.mask.id,mask.id);assert.equal(result.source.url,'/api/image/editor/files/'+image.id);assert.ok(f.reads.every(row=>row.role==='USER'));
 const serialized=JSON.stringify(result);for(const hidden of ['PRIVATE-STORAGE','storedKey','sha256','userId','apiKey','reservedAmount'])assert.equal(serialized.includes(hidden),false);assert.equal(await f.db.imageTask.count(),0);assert.equal(await f.db.countReservation.count(),0);assert.equal(await f.db.usageRecord.count(),0);const raw=await f.service.file(f.owner.id,image.id);assert.deepEqual(raw.buffer,source);assert.equal(raw.mime,'image/png');
});

test('foreign and missing files are indistinguishable and even an administrator cannot use another owner in the editor',async t=>{
 const f=await fixture(t),image=await f.file(),mask=await f.file(await alphaMask(),'image/png',f.other.id);for(const userId of [f.other.id,f.admin.id]){await assert.rejects(f.service.inputs(userId,image.id),status(404));await assert.rejects(f.service.file(userId,image.id),status(404));}await assert.rejects(f.service.inputs(f.owner.id,image.id,mask.id),status(404));await assert.rejects(f.service.inputs(f.owner.id,'qg-missing'),status(404));assert.equal(f.reads.length,0);
});

test('expired, deleted and purged inputs cannot be restored through a deep link',async t=>{
 const f=await fixture(t);for(const extra of [{expiresAt:new Date(Date.now()-1000)},{deletedAt:new Date()},{purgedAt:new Date()}]){const file=await f.file(source,'image/png',f.owner.id,extra);await assert.rejects(f.service.inputs(f.owner.id,file.id),status(404));await assert.rejects(f.service.file(f.owner.id,file.id),status(404));}assert.equal(f.reads.length,0);
});

test('orientation-aware dimensions agree with the visible image and require the same mask geometry',async t=>{
 const f=await fixture(t),jpeg=await sharp({create:{width:64,height:48,channels:3,background:'#eee5ff'}}).jpeg().withMetadata({orientation:6}).toBuffer(),image=await f.file(jpeg,'image/jpeg'),mask=await f.file(await alphaMask(48,64));const result=await f.service.inputs(f.owner.id,image.id,mask.id);assert.equal(result.source.width,48);assert.equal(result.source.height,64);const wrong=await f.file(await alphaMask());await assert.rejects(f.service.inputs(f.owner.id,image.id,wrong.id),status(400));assert.deepEqual((await f.service.file(f.owner.id,image.id)).buffer,jpeg);
});

test('invalid pictures, oversized bytes, mismatched and empty masks fail before a task or hold exists',async t=>{
 const f=await fixture(t),image=await f.file(),wrong=await f.file(await alphaMask(16,16)),opaque=await f.file(await sharp({create:{width:64,height:48,channels:4,background:'#fff'}}).png().toBuffer());for(const mask of [wrong,opaque])await assert.rejects(f.service.inputs(f.owner.id,image.id,mask.id),status(400));await assert.rejects(f.service.inputs(f.owner.id,image.id,image.id),status(400));
 for(const[buffer,mime]of [[Buffer.from('not a picture'),'image/png'],[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),'image/svg+xml'],[Buffer.alloc(10*1024*1024+1),'image/png']]){const file=await f.file(buffer,mime);await assert.rejects(f.service.inputs(f.owner.id,file.id),status(400));}assert.equal(await f.db.imageTask.count(),0);assert.equal(await f.db.countReservation.count(),0);
});

test('a withdrawal during file loading stops bytes that have not yet been returned',async t=>{
 const f=await fixture(t),image=await f.file();let entered,release;const inside=new Promise(done=>entered=done),held=new Promise(done=>release=done);f.onRead(async(id,count)=>{if(id===image.id&&count===2){entered();await held;}});const pending=f.service.file(f.owner.id,image.id);await inside;await f.db.uploadFile.update({where:{id:image.id},data:{deletedAt:new Date()}});release();await assert.rejects(pending,status(404));
});

test('changed storage bytes cannot be returned under an earlier validation snapshot',async t=>{
 const f=await fixture(t),image=await f.file();f.onRead(async(id,count)=>{if(id===image.id&&count===2)f.blobs.set(id,otherSource);});await assert.rejects(f.service.file(f.owner.id,image.id),status(409));
});

test('editor query validation rejects repeated values, implicit numeric conversion and path fragments',async()=>{
 const pipe=new ValidationPipe({transform:true,whitelist:true,transformOptions:{enableImplicitConversion:true}}),convert=value=>pipe.transform(value,{type:'query',metatype:ImageEditorInputDto});assert.equal((await convert({sourceId:'qg-file',maskId:'qg-mask'})).sourceId,'qg-file');for(const input of [{sourceId:['a','b']},{sourceId:12},{sourceId:'../private'},{sourceId:'qg-file',maskId:['a']},{sourceId:'qg-file',maskId:12}])await assert.rejects(convert(input),status(400));
});
