import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {SettingsService} from '../dist/modules/settings/settings.service.js';
import {StorageService} from '../dist/modules/storage/storage.service.js';
import {MjMediaService} from '../dist/modules/midjourney/mj-media.service.js';
import {VideoMediaService} from '../dist/modules/video/video-media.service.js';
import {GalleryService} from '../dist/modules/gallery/gallery.service.js';
import {saveGalleryPublication} from '../dist/modules/gallery/gallery-publication.js';
import {galleryPublicPage} from '../dist/modules/gallery/gallery-query.js';
import {ImageService} from '../dist/modules/image/image.service.js';
import {MjService} from '../dist/modules/midjourney/mj.service.js';
import {VideoService} from '../dist/modules/video/video.service.js';

const here=dirname(fileURLToPath(import.meta.url)),directory=mkdtempSync(join(tmpdir(),'qgauss-gallery-')),base=join(directory,'base.db');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=code=>error=>error.getStatus?.()===code;
const png=await sharp({create:{width:1280,height:960,channels:3,background:'#cbbadd'}}).png().toBuffer();
async function fixture(t){
 const database=join(directory,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database.replace(/\\/g,'/')}}});
 const [owner,viewer,admin]=await Promise.all(['owner','viewer','admin'].map(username=>db.user.create({data:{username,email:username+'@qgauss.test',passwordHash:'synthetic-only',role:username==='admin'?'ADMIN':'USER'}})));
 const settings=new SettingsService(db),storage=new StorageService(db,settings),rate=new RateLimitService(),blobs=new Map(),reads=[];let hold=null;
 storage.driver={name:'gallery-unit',async put(key,data){blobs.set(key,Buffer.from(data));},async get(key){reads.push(key);if(hold)await hold(key);if(!blobs.has(key))throw Error('Missing local gallery sample');return blobs.get(key);},async remove(key){blobs.delete(key);},async exists(key){return blobs.has(key);}};
 const tickets=new Map(),box={encrypt(value){const token='qgauss-local-ticket-'+randomUUID();tickets.set(token,value);return token;},decrypt(token){if(!tickets.has(token))throw Error('Invalid local ticket');return tickets.get(token);}};
 const mj=new MjMediaService(db,storage,box,rate),video=new VideoMediaService(db,storage,box,rate,{async readExpected(){throw Error('Unexpected private material read');}}),gallery=new GalleryService(db,storage,mj,video,rate);
 const cat=await db.creationCat.create({data:{name:'QGauss 光与材质'}});
 t.after(async()=>db.$disconnect());
 async function file(scope='image',userId=owner.id,extra={}){const buffer=scope==='video'?Buffer.from('QGauss local movie bytes'):png,mime=scope==='video'?'video/mp4':'image/png',storedKey='2026/11/'+randomUUID(),row=await db.uploadFile.create({data:{userId,scope,mime,filename:'QGauss-sample.'+(scope==='video'?'mp4':'png'),storedKey,size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),...extra}});blobs.set(storedKey,buffer);return row;}
 async function task(kind='image',extra={}){
  const userId=extra.userId||owner.id,output=await file(kind==='image'?'image':kind==='mj'?'mj-image':'video',userId),prompt='QGauss 公开的柔光拱门 '+randomUUID().slice(0,5),defaults={userId,status:'SUCCESS',published:true,catId:cat.id,publishedAt:new Date('2026-11-03T00:00:00Z')};
  if(kind==='image')return db.imageTask.create({data:{...defaults,prompt,model:'qgauss-image',metaJson:JSON.stringify({privateMarker:'PRIVATE-GALLERY-CONFIG'}),inputJson:JSON.stringify({references:[{id:'PRIVATE-REFERENCE'}]}),resultJson:JSON.stringify([{fileId:output.id,mime:output.mime}]),...extra}});
  const intent={presetId:'qgauss-preset',prompt,model:'mj',version:'7',ratio:'3:4',quality:1,mode:'text',resolution:'720p',seconds:6,imageIds:['PRIVATE-REFERENCE'],sourceTaskId:'PRIVATE-SOURCE'},result=kind==='mj'?{items:[{fileId:output.id,kind:'image',mime:output.mime,size:output.size,sha256:output.sha256}]}:{videoFileId:output.id};
  const data={...defaults,requestKey:randomUUID(),intentHash:'synthetic',presetId:'qgauss-preset',presetName:'QGauss 本地创作',profile:kind==='mj'?'PLUS':'ARK_2_5',presetJson:JSON.stringify({privateMarker:'PRIVATE-GALLERY-CONFIG',secret:'PRIVATE-GALLERY-SECRET'}),intentJson:JSON.stringify(intent),inputJson:JSON.stringify({privateMarker:'PRIVATE-REFERENCE'}),upstreamId:'PRIVATE-UPSTREAM',pool:'drawMj',totalCost:0,deadlineAt:new Date(Date.now()+60000),resultJson:JSON.stringify(result),...extra};
  return kind==='mj'?db.mjTask.create({data}):db.videoTask.create({data});
 }
 return{db,owner,viewer,admin,cat,storage,gallery,mj,video,blobs,reads,file,task,setHold:value=>{hold=value;}};
}
after(()=>{const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep+'qgauss-gallery-'));rmSync(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('gallery collects valid public outputs across three engines without private configuration or accounting data',async t=>{
 const f=await fixture(t);for(const kind of ['image','mj','video']){await f.task(kind);await f.task(kind,{published:false});await f.task(kind,{deletedAt:new Date()});}
 const options=await f.gallery.options(f.viewer.id),page=await f.gallery.list(f.viewer.id,{pageSize:'30'});assert.deepEqual(options.counts,{all:3,image:1,mj:1,video:1,favorites:0});assert.equal(page.total,3);assert.equal(page.items.length,3);assert.ok(page.items.every(row=>row.assets.length===1&&row.assets[0].url.endsWith('?thumb=1')));
 for(const row of page.items){const detail=await f.gallery.detail(f.viewer.id,row.kind,row.id),draft=await f.gallery.reuse(f.viewer.id,row.kind,row.id);assert.ok(detail.prompt.includes('公开'));assert.equal(detail.mine,false);assert.equal(draft.key,row.key);const text=JSON.stringify({row,detail,draft});for(const secret of ['PRIVATE-','requestKey','upstreamId','inputJson','presetJson','reservedAmount','videoFileId'])assert.equal(text.includes(secret),false,secret);}
 assert.equal(await f.db.countReservation.count(),0);assert.equal(await f.db.usageRecord.count(),0);assert.equal(await f.db.galleryFavorite.count(),0);
});
test('gallery filters and stable paging share the same visibility set, including missing files and disabled owners',async t=>{
 const f=await fixture(t),valid=[];for(let i=0;i<7;i++)valid.push(await f.task('image',{prompt:'QGauss 雾里花 '+i,createdAt:new Date('2026-11-01T00:00:00Z'),publishedAt:new Date('2026-11-03T00:00:00Z')}));
 const invalid=await f.task('image'),file=JSON.parse(invalid.resultJson)[0];await f.db.uploadFile.update({where:{id:file.fileId},data:{deletedAt:new Date()}});await f.task('image',{resultJson:'broken-json'});await f.task('image',{resultJson:'["not-an-object"]'});await f.task('video',{resultJson:'{"videoFileId":123}'});
 const blocked=await f.db.user.create({data:{username:'blocked',email:'blocked@qgauss.test',passwordHash:'synthetic',status:'DISABLED'}});await f.task('mj',{userId:blocked.id});
 const seen=[];for(let page=1;page<=3;page++){const value=await f.gallery.list(f.viewer.id,{q:'雾里花',catId:f.cat.id,page:String(page),pageSize:'3',sort:'newest'});assert.equal(value.total,7);seen.push(...value.items.map(row=>row.id));}assert.equal(new Set(seen).size,7);assert.deepEqual(seen,[...valid].sort((a,b)=>b.id.localeCompare(a.id)).map(row=>row.id));assert.equal((await f.gallery.options(f.viewer.id)).counts.all,7);
});
test('legacy public workbenches share the same active-owner, file and category rules as the gallery',async t=>{
 const f=await fixture(t);for(const kind of ['image','mj','video']){const first=await f.task(kind),second=await f.task(kind);await f.task(kind,{published:false});await f.db.$transaction(async tx=>{const page=await galleryPublicPage(tx,kind,1,1,f.cat.id),next=await galleryPublicPage(tx,kind,2,1,f.cat.id);assert.equal(page.total,2);assert.equal(next.total,2);assert.notEqual(page.ids[0],next.ids[0]);assert.deepEqual(new Set([...page.ids,...next.ids]),new Set([first.id,second.id]));});}await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});await f.db.$transaction(async tx=>{for(const kind of ['image','mj','video'])assert.equal((await galleryPublicPage(tx,kind,1,30)).total,0);});
});
test('legacy image, MJ and video pages keep chronological order across SQLite text and millisecond dates',async t=>{
 const f=await fixture(t);for(const [kind,table,Service]of [['image','image_tasks',ImageService],['mj','mj_tasks',MjService],['video','video_tasks',VideoService]]){const old=await f.task(kind,{createdAt:new Date('2001-01-01T00:00:00Z')}),recent=await f.task(kind,{createdAt:new Date('2030-01-01T00:00:00Z')});await f.db.$executeRawUnsafe('UPDATE "'+table+'" SET "createdAt"=? WHERE "id"=?','2001-01-01 00:00:00',old.id);const service=new Service(f.db),page=kind==='image'?await service.square({page:1,pageSize:30}):await service.list(f.viewer.id,true,1,30);assert.equal(page.total,2);assert.deepEqual(page.items.map(row=>row.id),[recent.id,old.id]);}
});
test('gallery desired-state favorites are isolated, concurrent and idempotent, and hidden cancellation still removes its own record',async t=>{
 const f=await fixture(t),work=await f.task();const results=await Promise.all(Array.from({length:5},()=>f.gallery.favorite(f.viewer.id,'image',work.id,true)));assert.ok(results.every(row=>row.favorite&&row.favoriteCount===1));assert.equal(await f.db.galleryFavorite.count(),1);assert.equal((await f.gallery.detail(f.owner.id,'image',work.id)).favorite,false);
 const saved=await f.db.galleryFavorite.findFirst();await f.gallery.favorite(f.viewer.id,'image',work.id,true);assert.equal((await f.db.galleryFavorite.findFirst()).createdAt.getTime(),saved.createdAt.getTime());
 await f.db.imageTask.update({where:{id:work.id},data:{published:false}});await assert.rejects(f.gallery.favorite(f.owner.id,'image',work.id,true),status(404));assert.equal((await f.gallery.favorite(f.viewer.id,'image',work.id,false)).favorite,false);assert.equal(await f.db.galleryFavorite.count(),0);
});
test('gallery MJ action outputs reuse the original public settings without inheriting private references or action identity',async t=>{
 const f=await fixture(t),work=await f.task('mj',{intentJson:JSON.stringify({kind:'action',sourceTaskId:'PRIVATE-PARENT',action:{kind:'upscale',id:'PRIVATE-ACTION'}}),presetJson:JSON.stringify({secret:'PRIVATE-KEY',sourceParams:{prompt:'QGauss 玻璃花园',model:'mj',version:'7',ratio:'16:9',quality:2,seed:0,negativePrompt:'文字',referenceIds:['PRIVATE-REFERENCE'],private:'PRIVATE-EXTRA'}})});
 const page=await f.gallery.list(f.viewer.id,{kind:'mj',q:'玻璃花园'}),detail=await f.gallery.detail(f.viewer.id,'mj',work.id),reuse=await f.gallery.reuse(f.viewer.id,'mj',work.id);assert.equal(page.total,1);assert.equal(detail.prompt,'QGauss 玻璃花园');assert.equal(detail.ratio,'16:9');assert.equal(reuse.draft.version,'7');assert.equal(reuse.draft.seed,0);assert.equal(reuse.draft.negativePrompt,'文字');assert.equal(JSON.stringify({page,detail,reuse}).includes('PRIVATE-'),false);
});
test('gallery thumbnails are bounded and cached while full reads and withdrawals retain their publication checks',async t=>{
 const f=await fixture(t),work=await f.task(),before=f.reads.length;
 const previews=await Promise.all([f.gallery.asset(f.viewer.id,'image',work.id,'0','1','test'),f.gallery.asset(f.viewer.id,'image',work.id,'0','1','test')]);assert.equal(previews[0].mime,'image/webp');const dimensions=await sharp(previews[0].buffer).metadata();assert.ok(dimensions.width<=640&&dimensions.height<=640);assert.equal(f.reads.length-before,1);
 const full=await f.gallery.asset(f.viewer.id,'image',work.id,'0',undefined,'test');assert.equal(full.mime,'image/png');assert.equal((await sharp(full.buffer).metadata()).width,1280);
 await saveGalleryPublication(f.db,f.owner.id,'image',work.id,false);await assert.rejects(f.gallery.asset(f.viewer.id,'image',work.id,'0','1','test'),status(404));
});
test('gallery rechecks publication after an in-flight storage read and never returns newly withdrawn bytes',async t=>{
 const f=await fixture(t),work=await f.task();let release,entered;const held=new Promise(done=>release=done),inside=new Promise(done=>entered=done);f.setHold(async()=>{entered();await held;});const reading=f.gallery.asset(f.viewer.id,'image',work.id,'0',undefined,'test');await inside;await saveGalleryPublication(f.db,f.owner.id,'image',work.id,false);release();await assert.rejects(reading,status(404));
});
test('gallery video leases and direct playback stop accepting a disabled owner, including previously issued tickets',async t=>{
 const f=await fixture(t),work=await f.task('video'),links=await f.gallery.playback(f.viewer.id,'video',work.id,'0'),url=new URL(links.videoUrl,'http://qgauss.test');assert.ok(url.pathname.endsWith('/video'));await f.video.access(work.id,'video',url.searchParams.get('ticket'),'playback','test');await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});await assert.rejects(f.gallery.detail(f.viewer.id,'video',work.id),status(404));await assert.rejects(f.video.access(work.id,'video',url.searchParams.get('ticket'),'playback','test'),status(404));
});
test('gallery publication preserves first accepted time on replay and a withdrawal invalidates stale publication confirmation',async t=>{
 const f=await fixture(t),work=await f.task('image',{published:false,publishedAt:null}),before=work.updatedAt.toISOString();await saveGalleryPublication(f.db,f.owner.id,'image',work.id,false);await assert.rejects(saveGalleryPublication(f.db,f.owner.id,'image',work.id,true,f.cat.id,before),status(409));const privateRow=await f.db.imageTask.findUnique({where:{id:work.id}});const accepted=await saveGalleryPublication(f.db,f.owner.id,'image',work.id,true,f.cat.id,privateRow.updatedAt.toISOString()),replayed=await saveGalleryPublication(f.db,f.owner.id,'image',work.id,true,f.cat.id,privateRow.updatedAt.toISOString());assert.equal(accepted.publishedAt.getTime(),replayed.publishedAt.getTime());assert.equal(accepted.updatedAt.getTime(),replayed.updatedAt.getTime());await assert.rejects(saveGalleryPublication(f.db,f.viewer.id,'image',work.id,false),status(404));
});
test('gallery rejects ambiguous queries and raw nonboolean writes, while curator access requires a current administrator',async t=>{
 const f=await fixture(t),work=await f.task();for(const query of [{kind:['image','video']},{page:'1.5'},{pageSize:'31'},{q:'x'.repeat(101)},{favorites:'true'},{sort:'saved'}])await assert.rejects(f.gallery.list(f.viewer.id,query),status(400));await assert.rejects(f.gallery.favorite(f.viewer.id,'image',work.id,'false'),status(400));await assert.rejects(f.gallery.feature(f.viewer.id,'image',work.id,true),status(403));assert.equal((await f.gallery.feature(f.admin.id,'image',work.id,true)).featured,true);assert.equal((await f.gallery.detail(f.viewer.id,'image',work.id)).featured,true);
});
