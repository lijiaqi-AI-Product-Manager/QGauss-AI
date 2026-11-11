import {historicalSnapshot} from './historical-database.mjs';
import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {crc32} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import sharp from 'sharp';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {StorageService} from '../dist/modules/storage/storage.service.js';
import {UserAvatarService} from '../dist/modules/users/avatar.service.js';
import {UsersService} from '../dist/modules/users/users.service.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {AllExceptionsFilter} from '../dist/common/filters/all-exceptions.filter.js';
import {withAuthSession,authSession} from '../dist/common/decorators/current-user.decorator.js';
import {AVATAR_PREFIX,avatarCrop,normalizeAvatar} from '../dist/modules/users/avatar-image.js';

const folder=mkdtempSync(join(tmpdir(),'qgauss-profile-photo-')),base=join(folder,'base.db');
execFileSync(process.execPath,[resolve('prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=n=>e=>e.getStatus?.()===n,crop={x:2,y:0,size:8,width:12,height:8};
const bytes=await sharp({create:{width:12,height:8,channels:3,background:'#b28fff'}}).jpeg().withExif({IFD0:{Artist:'private-photo-owner'}}).toBuffer();
const file=(buffer=bytes)=>({buffer,size:buffer.length,mimetype:'image/jpeg',originalname:'personal-original-name.jpg'});
async function fixture(t){
 const database=join(folder,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasourceUrl:'file:'+database.replaceAll('\\','/')});
 const old=process.env.STORAGE_DIR;process.env.STORAGE_DIR=join(folder,randomUUID());const storage=new StorageService(db,{get:async()=>''});if(old===undefined)delete process.env.STORAGE_DIR;else process.env.STORAGE_DIR=old;
 const owner=await db.user.create({data:{username:'owner',email:'owner@qgauss.test',passwordHash:'synthetic',displayName:'星间',signature:'原签名',avatar:'qgauss:violet',adminNote:'private administrative note'}}),other=await db.user.create({data:{username:'other',email:'other@qgauss.test',passwordHash:'synthetic'}});
 const familyId=randomUUID();await db.refreshToken.create({data:{userId:owner.id,familyId,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+DAY)}});
 const actor=withAuthSession({...owner},{tokenVersion:0,familyId,expiresAt:Date.now()+3600000}),avatars=new UserAvatarService(db,storage),users=new UsersService(db,new RateLimitService());
 t.after(async()=>{await avatars.onModuleDestroy();await db.$disconnect();});
 return{db,storage,owner,other,actor,avatars,users,upload:(key=randomUUID(),c=crop,f=file(),version=0)=>avatars.upload(actor,key,version,JSON.stringify(c),f)};
}
const DAY=86400000;
test('unexpected server failures show a readable message without exposing internal details',()=>{
 let body,code;const response={headersSent:false,status(value){code=value;return this;},json(value){body=value;}},host={switchToHttp:()=>({getRequest:()=>({method:'POST',url:'/api/users/me/avatar/uploads/sample',headers:{}}),getResponse:()=>response})};
 new AllExceptionsFilter().catch(Error('Synthetic private storage detail'),host);assert.equal(code,500);assert.equal(body.code,5000);assert.equal(body.message,'服务器开小差了，请稍后再试');assert.ok(!JSON.stringify(body).includes('private storage detail'));
});
after(()=>{const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+sep+'qgauss-profile-photo-'));rmSync(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
async function ready(f,key){for(let i=0;i<200;i++){const row=await f.avatars.read(f.actor,key);if(row.status!=='processing')return row;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Photo preparation did not finish');}
async function prepared(f){const key=randomUUID();await f.upload(key);const row=await ready(f,key);assert.equal(row.status,'ready');return{key,...row};}

test('cropping produces a metadata-free square with the reviewed dimensions',async()=>{
 const image=await normalizeAvatar(file(),avatarCrop(JSON.stringify(crop))),metadata=await sharp(image.buffer).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert.equal(metadata.format,'png');assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);
 const rotated=await sharp({create:{width:12,height:8,channels:3,background:'#90aaff'}}).jpeg().withMetadata({orientation:6}).toBuffer();assert.equal((await sharp((await normalizeAvatar(file(rotated),{x:0,y:2,size:8,width:8,height:12})).buffer).metadata()).width,512);
 await assert.rejects(()=>normalizeAvatar(file(),{...crop,width:13}),status(400));assert.throws(()=>avatarCrop(JSON.stringify({...crop,size:20})),status(400));await assert.rejects(()=>normalizeAvatar(file(Buffer.alloc(12*1024*1024+1)),crop),status(413));await assert.rejects(()=>normalizeAvatar(file(Buffer.from('<svg/>')),crop),status(400));
});
test('GIF and WebP keep frame colors, timing and loop behavior after cropping',async()=>{
 const raw=Buffer.alloc(12*8*2*4);for(let frame=0;frame<2;frame++)for(let i=0;i<12*8;i++){const at=(frame*12*8+i)*4;raw[at+(frame?2:0)]=255;raw[at+3]=255;}
 for(const format of ['gif','webp']){const pipeline=sharp(raw,{raw:{width:12,height:16,channels:4,pageHeight:8}}),input=await pipeline[format]({delay:[70,140],loop:3,lossless:true}).toBuffer(),image=await normalizeAvatar(file(input),crop),metadata=await sharp(image.buffer,{animated:true}).metadata();assert.equal(metadata.pages,2);assert.equal(metadata.pageHeight,512);assert.deepEqual(metadata.delay,[70,140]);assert.equal(metadata.loop,3);for(let page=0;page<2;page++){const pixel=await sharp(image.buffer,{page,pages:1}).extract({left:250,top:250,width:1,height:1}).removeAlpha().raw().toBuffer();assert.equal(pixel[page?2:0],255);assert.equal(pixel[page?0:2],0);}}
});
const chunk=(type,data)=>{const kind=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data]))>>>0);return Buffer.concat([length,kind,data,crc]);};
async function apng(){
 const frames=[{w:4,h:4,x:0,y:0,color:'#ff0000',dispose:0},{w:2,h:2,x:1,y:1,color:'#0000ff',dispose:2},{w:1,h:1,x:0,y:0,color:'#00ff00',dispose:0}],parts=[Buffer.from([137,80,78,71,13,10,26,10])];let seq=0;
 for(let i=0;i<frames.length;i++){const f=frames[i],png=await sharp({create:{width:f.w,height:f.h,channels:4,background:f.color}}).png().toBuffer();let header,compressed=[];for(let p=8;p+12<=png.length;){const n=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8),data=png.subarray(p+8,p+8+n);if(type==='IHDR')header=data;if(type==='IDAT')compressed.push(data);p+=n+12;}
  if(!i){parts.push(chunk('IHDR',header));const animation=Buffer.alloc(8);animation.writeUInt32BE(3);animation.writeUInt32BE(2,4);parts.push(chunk('acTL',animation));}const control=Buffer.alloc(26);control.writeUInt32BE(seq++);control.writeUInt32BE(f.w,4);control.writeUInt32BE(f.h,8);control.writeUInt32BE(f.x,12);control.writeUInt32BE(f.y,16);control.writeUInt16BE(i+1,20);control.writeUInt16BE(10,22);control[24]=f.dispose;parts.push(chunk('fcTL',control));for(const data of compressed){if(!i)parts.push(chunk('IDAT',data));else{const sequence=Buffer.alloc(4);sequence.writeUInt32BE(seq++);parts.push(chunk('fdAT',Buffer.concat([sequence,data])));}}
 }parts.push(chunk('IEND',Buffer.alloc(0)));return Buffer.concat(parts);
}
test('animated PNG composites offset frames and restores the previous canvas',async()=>{
 const input=await apng(),out=await normalizeAvatar(file(input),{x:0,y:0,size:4,width:4,height:4}),metadata=await sharp(out.buffer,{animated:true}).metadata();assert.equal(metadata.pages,3);assert.deepEqual(metadata.delay,[100,200,300]);assert.equal(metadata.loop,2);
 for(const[page,x,y,color]of [[0,250,250,[255,0,0]],[1,250,250,[0,0,255]],[2,450,450,[255,0,0]],[2,20,20,[0,255,0]]])assert.deepEqual([...await sharp(out.buffer,{page,pages:1}).extract({left:x,top:y,width:1,height:1}).removeAlpha().raw().toBuffer()],color);
 const damaged=Buffer.from(input);damaged[60]^=1;await assert.rejects(()=>normalizeAvatar(file(damaged),{x:0,y:0,size:4,width:4,height:4}),status(400));
});
test('preparation preserves the saved profile and retries return the same photo',async t=>{
 const f=await fixture(t),before=await f.users.profile(f.owner.id),row=await prepared(f),retry=await f.upload(row.key);assert.equal(retry.avatar,row.avatar);assert.equal(await f.db.uploadFile.count({where:{scope:'user-avatar'}}),1);assert.equal((await f.avatars.policy(f.actor)).remaining,9);const after=await f.users.profile(f.owner.id);assert.equal(after.updatedAt.toISOString(),before.updatedAt.toISOString());assert.equal(after.avatar,'qgauss:violet');assert.equal(after.signature,'原签名');
 const stored=await f.db.uploadFile.findUniqueOrThrow({where:{id:row.avatar.slice(AVATAR_PREFIX.length)}});assert.equal(stored.filename,'QGauss-avatar.png');assert.ok(!JSON.stringify(row).includes('stageJson'));assert.ok(!JSON.stringify(row).includes('inputHash'));await assert.rejects(()=>f.upload(row.key,{...crop,x:1}),status(409));
});
test('saving binds only the owned reviewed photo and preserves other account fields',async t=>{
 const f=await fixture(t),row=await prepared(f),before=await f.users.profile(f.owner.id),saved=await f.users.updateProfile(f.owner.id,{avatar:row.avatar,displayName:'新昵称',signature:'新签名',expectedUpdatedAt:before.updatedAt.toISOString()},f.actor);assert.equal(saved.avatar,row.avatar);assert.equal(saved.signature,'新签名');assert.equal(saved.displayName,'新昵称');assert.equal((await f.db.user.findUniqueOrThrow({where:{id:f.owner.id}})).adminNote,'private administrative note');assert.equal((await f.db.uploadFile.findUniqueOrThrow({where:{id:row.avatar.slice(AVATAR_PREFIX.length)}})).expiresAt,null);assert.equal((await f.avatars.close(f.actor,row.key,row.version)).current,true);assert.equal((await f.users.profile(f.owner.id)).avatar,row.avatar);
 await assert.rejects(()=>f.users.updateProfile(f.other.id,{avatar:row.avatar}),status(409));await assert.rejects(()=>f.users.updateProfile(f.owner.id,{avatar:'qgauss:avatar:invalid'}),status(400));
});
test('private photos cannot be downloaded through generic files or attached to chat',async t=>{
 const f=await fixture(t),row=await prepared(f),id=row.avatar.slice(AVATAR_PREFIX.length),image=await f.avatars.image(f.actor,id);assert.equal(image.mime,'image/png');await assert.rejects(()=>f.storage.read(id,f.owner.id,'USER'),status(404));await assert.rejects(()=>f.storage.read(id,f.other.id,'ADMIN'),status(404));await assert.rejects(()=>f.storage.remove(id,f.owner.id,'USER'),status(404));assert.equal((await f.storage.listMine(f.owner.id)).total,0);assert.equal((await f.storage.checkAttachments(f.owner.id,[id])).items[0].status,'unavailable');
});
test('closing a missing preparation fences a late upload without changing the saved avatar',async t=>{
 const f=await fixture(t),key=randomUUID(),closed=await f.avatars.close(f.actor,key,0);assert.equal(closed.status,'closed');assert.equal((await f.upload(key)).status,'closed');assert.equal(await f.db.uploadFile.count({where:{scope:'user-avatar'}}),0);assert.equal((await f.avatars.policy(f.actor)).remaining,10);assert.equal((await f.users.profile(f.owner.id)).avatar,'qgauss:violet');
});
test('a close during storage fences the delayed write and removes its unused result',async t=>{
 const f=await fixture(t),key=randomUUID(),put=f.storage.putArtifact.bind(f.storage);let resume,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>resume=resolve);f.storage.putArtifact=async(stage,buffer)=>{entered();await gate;await put(stage,buffer);};const initial=await f.upload(key);await started;const closed=await f.avatars.close(f.actor,key,initial.version);assert.equal(closed.status,'closed');resume();await f.avatars.onModuleDestroy();assert.equal(await f.db.uploadFile.count({where:{scope:'user-avatar'}}),0);assert.equal((await f.avatars.read(f.actor,key)).status,'closed');assert.equal((await f.users.profile(f.owner.id)).avatar,'qgauss:violet');
});
test('a lost storage acknowledgement is recovered without a second preparation',async t=>{
 const f=await fixture(t),put=f.storage.putArtifact.bind(f.storage);let puts=0;f.storage.putArtifact=async(stage,buffer)=>{puts++;await put(stage,buffer);throw Error('Synthetic lost acknowledgement');};const row=await prepared(f);assert.equal(puts,1);assert.equal((await f.upload(row.key)).avatar,row.avatar);assert.equal((await f.avatars.policy(f.actor)).remaining,9);
});
test('revoking the login before storage finishes prevents the photo from becoming ready',async t=>{
 const f=await fixture(t),put=f.storage.putArtifact.bind(f.storage);let resume,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>resume=resolve);f.storage.putArtifact=async(stage,buffer)=>{entered();await gate;await put(stage,buffer);};const key=randomUUID();await f.upload(key);await started;await f.db.refreshToken.updateMany({where:{userId:f.owner.id},data:{revokedAt:new Date()}});resume();await f.avatars.onModuleDestroy();assert.equal((await f.db.userAvatarUpload.findFirstOrThrow({where:{requestKey:key}})).status,'FAILED');assert.equal(await f.db.uploadFile.count({where:{scope:'user-avatar'}}),0);await assert.rejects(()=>f.avatars.policy(f.actor),status(403));
});
test('daily quota counts successful preparations, reserves concurrent slots and excludes failed photos',async t=>{
 const f=await fixture(t);for(let i=0;i<9;i++){const row=await prepared(f);await f.avatars.close(f.actor,row.key,row.version);}assert.equal((await f.avatars.policy(f.actor)).remaining,1);const keys=[randomUUID(),randomUUID()],results=await Promise.allSettled(keys.map(key=>f.upload(key)));assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected'&&row.reason.getStatus()===429).length,1);await f.avatars.onModuleDestroy();assert.equal((await f.avatars.policy(f.actor)).remaining,0);
 const fresh=await fixture(t),key=randomUUID();await fresh.upload(key,crop,file(Buffer.from('invalid')));assert.equal((await ready(fresh,key)).status,'failed');assert.equal((await fresh.avatars.policy(fresh.actor)).remaining,10);
});
test('stale profile reviews cannot pin a photo, and replacing a bound photo starts its grace period',async t=>{
 const f=await fixture(t),one=await prepared(f),two=await prepared(f),before=await f.users.profile(f.owner.id);await f.users.updateProfile(f.owner.id,{signature:'changed elsewhere',expectedUpdatedAt:before.updatedAt.toISOString()},f.actor);await assert.rejects(()=>f.users.updateProfile(f.owner.id,{avatar:one.avatar,expectedUpdatedAt:before.updatedAt.toISOString()},f.actor),status(409));assert.ok((await f.db.uploadFile.findUniqueOrThrow({where:{id:one.avatar.slice(AVATAR_PREFIX.length)}})).expiresAt);let profile=await f.users.profile(f.owner.id);profile=await f.users.updateProfile(f.owner.id,{avatar:one.avatar,expectedUpdatedAt:profile.updatedAt.toISOString()},f.actor);await f.users.updateProfile(f.owner.id,{avatar:two.avatar,expectedUpdatedAt:profile.updatedAt.toISOString()},f.actor);const old=await f.db.uploadFile.findUniqueOrThrow({where:{id:one.avatar.slice(AVATAR_PREFIX.length)}});assert.ok(old.expiresAt>Date.now());await f.db.uploadFile.update({where:{id:old.id},data:{expiresAt:new Date(Date.now()-1)}});await f.avatars.cleanup();assert.ok((await f.db.uploadFile.findUniqueOrThrow({where:{id:old.id}})).purgedAt);assert.equal((await f.db.uploadFile.findUniqueOrThrow({where:{id:two.avatar.slice(AVATAR_PREFIX.length)}})).expiresAt,null);
});

test('avatar operations use the authenticated millisecond expiry and reject expired access',async t=>{const f=await fixture(t),row=await prepared(f),stored=await f.db.userAvatarUpload.findFirstOrThrow({where:{requestKey:row.key}});assert.ok(stored.accessExpiresAt.getTime()>Date.now());assert.ok(stored.accessExpiresAt.getTime()<Date.now()+3601000);const expired=withAuthSession({...f.owner},{...authSession(f.actor),expiresAt:Date.now()-1});await assert.rejects(()=>f.avatars.policy(expired),status(403));});

test('a restarted service verifies retained canonical bytes without requiring the original photo',async t=>{const f=await fixture(t),key=randomUUID(),image=await normalizeAvatar(file(),crop),stage=await f.storage.prepareAvatarArtifact(image.buffer,image.mime,image.extension),context=authSession(f.actor);await f.storage.putArtifact(stage,image.buffer);await f.db.userAvatarUpload.create({data:{userId:f.owner.id,requestKey:key,inputHash:'a'.repeat(64),stageJson:JSON.stringify(stage),acceptedDay:new Date(Date.now()+8*3600000).toISOString().slice(0,10),familyId:context.familyId,tokenVersion:context.tokenVersion,accessExpiresAt:new Date(context.expiresAt)}});const restarted=new UserAvatarService(f.db,f.storage);t.after(()=>restarted.onModuleDestroy());f.avatars=restarted;assert.equal((await ready(f,key)).status,'ready');assert.equal(await f.db.uploadFile.count({where:{scope:'user-avatar'}}),1);assert.equal((await f.users.profile(f.owner.id)).avatar,'qgauss:violet');});

test('avatar migration adds its own table while preserving all 67 existing tables and settings',async t=>{const f=await fixture(t);const path=(await f.db.$queryRawUnsafe('PRAGMA database_list')).find(row=>row.name==='main').file;await f.db.$disconnect();historicalSnapshot(path,45);let raw=new DatabaseSync(path);const quote=value=>'"'+value.replaceAll('"','""')+'"',tables=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='_migrations' ORDER BY name").all().map(row=>row.name),snapshot=tables.map(name=>{const columns=raw.prepare('PRAGMA table_info('+quote(name)+')').all().map(row=>row.name);return{name,columns,rows:raw.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(name)).all()}});assert.equal(tables.length,67);raw.close();execFileSync(process.execPath,[resolve('prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:path},stdio:'pipe'});raw=new DatabaseSync(path);try{for(const entry of snapshot)assert.deepEqual(raw.prepare('SELECT '+entry.columns.map(quote).join(',')+' FROM '+quote(entry.name)).all(),entry.rows,entry.name);assert.equal(raw.prepare('SELECT count(*) n FROM user_avatar_uploads').get().n,0);assert.equal(raw.prepare('SELECT count(*) n FROM _migrations').get().n,48);}finally{raw.close();}});
