import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import sharp from 'sharp';
import {EventEmitter} from 'node:events';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {StorageService} from '../dist/modules/storage/storage.service.js';
import {AppImageService} from '../dist/modules/apps/app-image.service.js';
import {AppImageUploadGuard} from '../dist/modules/apps/app-image-upload.guard.js';
import {AppCreatorService} from '../dist/modules/apps/app-creator.service.js';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
import {ModerationService} from '../dist/modules/moderation/moderation.service.js';
import {appImageId,appImageRequestId} from '../dist/modules/apps/app-image.js';

const folder=mkdtempSync(join(tmpdir(),'qgauss-app-image-')),base=join(folder,'base.db');
execFileSync(process.execPath,[resolve('prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=n=>e=>e.getStatus?.()===n;
const crop={x:10,y:5,size:60,width:100,height:80};
const bytes=await sharp({create:{width:100,height:80,channels:3,background:'#9989df'}}).jpeg().withExif({IFD0:{Artist:'QGauss sample'}}).toBuffer();
const file=(buffer=bytes)=>({buffer,size:buffer.length,mimetype:'text/plain',originalname:'private-name.jpg'});
async function fixture(t){
 const database=join(folder,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database.replaceAll('\\','/')}}});
 const prior=process.env.STORAGE_DIR;process.env.STORAGE_DIR=join(folder,randomUUID());const storage=new StorageService(db,{get:async key=>key==='upload.maxSizeMb'?5:''});if(prior===undefined)delete process.env.STORAGE_DIR;else process.env.STORAGE_DIR=prior;
 const image=new AppImageService(db,storage),[owner,other,admin]=await Promise.all(['owner','other','admin'].map(name=>db.user.create({data:{username:name,email:name+'@qgauss.test',passwordHash:'local-fixture',role:name==='admin'?'ADMIN':'USER'}})));
 const creator=new AppCreatorService(db,new LedgerService(db),new ModerationService(db),new RateLimitService());
 const input=icon=>({name:'图片搭档',description:'用图片介绍自己',systemPrompt:'帮助用户整理想法',greeting:'一起开始吧',defaultModel:null,categoryId:null,icon,requestKey:randomUUID()});
 const act=(row,kind)=>creator.action(owner.id,row.id,{version:row.version,requestKey:randomUUID()},kind);
 t.after(async()=>{image.onModuleDestroy();await db.$disconnect();});
 return{db,storage,image,creator,owner,other,admin,input,act,upload:(key=randomUUID(),c=crop,f=file())=>image.upload(owner.id,key,JSON.stringify(c),f)};
}
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-app-image-'));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('image upload retains only the normalized square, removes source metadata and recovers by owner request',async t=>{
 const f=await fixture(t),key=randomUUID(),row=await f.upload(key),id=appImageId(row.icon),stored=await f.db.uploadFile.findUniqueOrThrow({where:{id}}),result=await f.image.privateImage(f.owner.id,id),meta=await sharp(result.buffer).metadata();
 assert.equal(stored.filename,'QGauss-app-image.png');assert.equal(stored.mime,'image/png');assert.deepEqual([meta.width,meta.height],[512,512]);assert.equal(meta.exif,undefined);assert.equal(meta.orientation,undefined);assert.ok(stored.expiresAt>new Date());assert.equal((await f.image.byRequest(f.owner.id,key)).icon,row.icon);assert.equal(row.fileId,undefined);
 await assert.rejects(()=>f.image.privateImage(f.other.id,id),status(404));await assert.rejects(()=>f.image.byRequest(f.other.id,key),status(404));await assert.rejects(()=>f.storage.read(id,f.admin.id,'ADMIN'),status(404));
});
test('parallel retries keep one immutable image and reject changed image bytes for the same request',async t=>{
 const f=await fixture(t),key=randomUUID(),rows=await Promise.all(Array.from({length:5},()=>f.upload(key)));assert.equal(new Set(rows.map(r=>r.icon)).size,1);assert.equal(await f.db.uploadFile.count(),1);
 const different=await sharp({create:{width:100,height:80,channels:3,background:'#42b9b2'}}).png().toBuffer();await assert.rejects(()=>f.upload(key,crop,file(different)),status(409));assert.equal(await f.db.uploadFile.count(),1);
});
test('crop is checked against oriented dimensions and output follows the selected pixels',async t=>{
 const f=await fixture(t),raw=Buffer.alloc(100*80*3);for(let y=0;y<80;y++)for(let x=0;x<100;x++){const p=(y*100+x)*3;raw[p]=x<50?255:0;raw[p+1]=x>=50?255:0;}
 const jpeg=await sharp(raw,{raw:{width:100,height:80,channels:3}}).jpeg().withMetadata({orientation:6}).toBuffer(),c={x:0,y:0,size:40,width:80,height:100},row=await f.upload(randomUUID(),c,file(jpeg));const result=await f.image.privateImage(f.owner.id,appImageId(row.icon));const stats=await sharp(result.buffer).stats();assert.ok(stats.channels[0].mean>240);assert.ok(stats.channels[1].mean<15);
 await assert.rejects(()=>f.upload(randomUUID(),crop,file(jpeg)),status(400));
});
test('invalid, animated, truncated and oversized sources and invalid crop keys are rejected before saving',async t=>{
 const f=await fixture(t);for(const c of [{...crop,x:-1},{...crop,x:90},{...crop,size:1.2},{...crop,width:'100'},{...crop,extra:true},null,[]])await assert.rejects(()=>f.upload(randomUUID(),c),status(400));
 for(const b of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"></svg>'),Buffer.from('GIF89a'),bytes.subarray(0,40)])await assert.rejects(()=>f.upload(randomUUID(),crop,file(b)),status(400));
 const pixels=Buffer.alloc(100*160*3,100);pixels.fill(200,100*80*3);const animated=await sharp(pixels,{raw:{width:100,height:160,channels:3,pageHeight:80}}).webp({loop:0,delay:[100,100]}).toBuffer();
 assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);await assert.rejects(()=>f.upload(randomUUID(),crop,file(animated)),status(400));
 await assert.rejects(()=>f.upload(randomUUID(),crop,file(Buffer.alloc(5*1024*1024+1))),status(413));await assert.rejects(()=>f.image.upload(f.owner.id,'bad',JSON.stringify(crop),file()),status(400));assert.equal(await f.db.uploadFile.count(),0);
});
test('private, review, public, withdrawn and archived image reads follow the exact app and image',async t=>{
 const f=await fixture(t),asset=await f.upload(),id=appImageId(asset.icon);let app=await f.creator.create(f.owner.id,f.input(asset.icon));assert.equal((await f.db.uploadFile.findUnique({where:{id}})).expiresAt,null);
 assert.ok((await f.image.appImage(app.id,id,{id:f.owner.id,role:'USER'})).buffer.length);for(const user of [undefined,{id:f.other.id,role:'USER'},{id:f.admin.id,role:'ADMIN'}])await assert.rejects(()=>f.image.appImage(app.id,id,user),status(404));
 app=await f.act(app,'submit');assert.ok((await f.image.appImage(app.id,id,{id:f.admin.id,role:'ADMIN'})).buffer.length);await assert.rejects(()=>f.image.appImage(app.id,id),status(404));const review=await f.creator.reviewDetail(app.id);app=await f.creator.review(f.admin.id,app.id,{version:review.version,requestKey:randomUUID(),decision:'APPROVE',note:'',offerRevision:review.rewardOffer.revision});assert.ok((await f.image.appImage(app.id,id)).buffer.length);
 app=await f.act(app,'withdraw');await assert.rejects(()=>f.image.appImage(app.id,id),status(404));await assert.rejects(()=>f.image.appImage(app.id,id,{id:f.other.id,role:'USER'}),status(404));app=await f.act(app,'trash');assert.ok((await f.image.appImage(app.id,id,{id:f.owner.id,role:'USER'})).buffer.length);await f.image.cleanup();assert.equal((await f.db.uploadFile.findUnique({where:{id}})).expiresAt,null);
});
test('source changes during a media read fail closed and cannot serve the previous image',async t=>{
 const f=await fixture(t),a=await f.upload(),id=appImageId(a.icon),app=await f.creator.create(f.owner.id,f.input(a.icon)),read=f.storage.read.bind(f.storage);f.storage.read=async(...args)=>{const value=await read(...args);await f.db.app.update({where:{id:app.id},data:{icon:'🧠',version:{increment:1}}});return value;};await assert.rejects(()=>f.image.appImage(app.id,id,{id:f.owner.id,role:'USER'}),status(404));
});
test('replaced images receive a cleanup window while shared references and current images remain retained',async t=>{
 const f=await fixture(t),asset=await f.upload(),id=appImageId(asset.icon),a=await f.creator.create(f.owner.id,f.input(asset.icon)),b=await f.creator.create(f.owner.id,f.input(asset.icon));
 await f.creator.update(f.owner.id,a.id,{...f.input('🧠'),version:a.version});await f.image.cleanup();assert.equal((await f.db.uploadFile.findUnique({where:{id}})).expiresAt,null);
 await f.creator.update(f.owner.id,b.id,{...f.input('🧠'),version:b.version});await f.image.cleanup();assert.ok((await f.db.uploadFile.findUnique({where:{id}})).expiresAt>new Date());
});
test('foreign images and external addresses cannot become a creator icon; generic uploads cannot forge or delete managed images',async t=>{
 const f=await fixture(t),a=await f.upload(),id=appImageId(a.icon);await assert.rejects(()=>f.creator.create(f.other.id,f.input(a.icon)),status(409));for(const icon of ['https://example.test/avatar.png','qgauss:app-icon:bad'])await assert.rejects(()=>f.creator.create(f.owner.id,f.input(icon)),status(400));await assert.rejects(()=>f.storage.upload(f.owner.id,file(),'app-icon'),status(400));await assert.rejects(()=>f.storage.remove(id,f.owner.id,'USER'),status(409));assert.equal((await f.storage.listMine(f.owner.id)).total,0);
});
test('unused images expire, remain recoverable only while valid, and cleanup keeps their retry tombstones',async t=>{
 const f=await fixture(t),key=randomUUID(),a=await f.upload(key),id=appImageId(a.icon),stored=await f.db.uploadFile.findUniqueOrThrow({where:{id}});await f.db.uploadFile.update({where:{id},data:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(()=>f.image.byRequest(f.owner.id,key),status(404));await f.image.cleanup();const purged=await f.db.uploadFile.findUniqueOrThrow({where:{id}});assert.ok(purged.deletedAt);assert.ok(purged.purgedAt);await assert.rejects(()=>f.upload(key),status(409));await assert.rejects(()=>f.creator.create(f.owner.id,f.input(a.icon)),status(409));assert.equal(await f.db.uploadFile.count(),1);
});
test('request IDs bind owner and UUID without exposing either identity',()=>{const key=randomUUID();assert.equal(appImageRequestId('one',key),appImageRequestId('one',key.toUpperCase()));assert.notEqual(appImageRequestId('one',key),appImageRequestId('two',key));assert.equal(appImageRequestId('one','not-a-key'),null);});
test('admission happens before multipart buffering and releases once on any terminal event',()=>{
 const guard=new AppImageUploadGuard(new RateLimitService()),open=(owner='owner',length='100')=>{const req=new EventEmitter(),res=new EventEmitter();Object.assign(req,{user:{id:owner},headers:{'content-length':length}});return{req,res,call:()=>guard.canActivate({switchToHttp:()=>({getRequest:()=>req,getResponse:()=>res})})};};
 const a=open(),b=open();assert.equal(a.call(),true);assert.equal(b.call(),true);assert.throws(()=>open().call(),status(429));a.req.emit('aborted');a.res.emit('close');a.res.emit('finish');const c=open();assert.equal(c.call(),true);assert.throws(()=>open('other',String(6*1024*1024)).call(),status(413));b.res.emit('finish');c.res.emit('finish');
});
