import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,copyFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {ValidationPipe} from '@nestjs/common';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {AppShareViewsService} from '../dist/modules/apps/app-share-views.service.js';
import {AppShareVisitDto} from '../dist/modules/apps/dto/app-share-visit.dto.js';
import {AppsService} from '../dist/modules/apps/apps.service.js';
import {AppCreatorService} from '../dist/modules/apps/app-creator.service.js';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
import {ModerationService} from '../dist/modules/moderation/moderation.service.js';

const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-app-visits-')),base=join(folder,'base.db'),migrate=join(here,'../prisma/migrate.mjs');
execFileSync(process.execPath,[migrate],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=n=>e=>e.getStatus?.()===n;
async function fixture(t){
 const database=join(folder,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database.replaceAll('\\','/')}}}),service=new AppShareViewsService(db,new RateLimitService()),catalog=new AppsService(db);
 t.after(async()=>{await service.onModuleDestroy();await db.$disconnect();});
 const app=(data={})=>db.app.create({data:{name:'Public partner',systemPrompt:'Private instructions stay on the server',shareId:randomUUID(),...data}});
 return{db,service,catalog,app,database};
}
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-app-visits-'));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('catalog, details and share count reads do not record a visit or expose private settings',async t=>{
 const f=await fixture(t),app=await f.app();
 for(let n=0;n<3;n++){assert.deepEqual(await f.service.read(app.shareId),{id:app.id,shareViewCount:0});assert.equal((await f.catalog.listPublished())[0].shareViewCount,0);const detail=await f.catalog.detail(app.id);assert.equal(detail.shareViewCount,0);assert.equal(detail.systemPrompt,undefined);}
 assert.equal(await f.db.appShareVisit.count(),0);assert.equal((await f.db.app.findUnique({where:{id:app.id}})).updatedAt.getTime(),app.updatedAt.getTime());
});
test('parallel retries and legacy share aliases record the same page visit only once',async t=>{
 const f=await fixture(t),app=await f.app(),key=randomUUID(),rows=await Promise.all(Array.from({length:12},(_,n)=>f.service.record(n%2?app.shareId:app.id,n%3?key:key.toUpperCase(),'visitor')));
 assert.equal(rows.filter(row=>row.counted).length,1);assert.ok(rows.every(row=>row.id===app.id&&row.shareViewCount===1));assert.equal(await f.db.appShareVisit.count(),1);
 assert.deepEqual(Object.keys(rows[0]).sort(),['counted','id','shareViewCount']);
});
test('independent page visits accumulate without changing app version, edit date, settings or rewards',async t=>{
 const f=await fixture(t),app=await f.app(),before=await f.db.app.findUnique({where:{id:app.id}});
 await Promise.all(Array.from({length:9},()=>f.service.record(app.shareId,randomUUID(),'visitor')));
 const after=await f.db.app.findUnique({where:{id:app.id}});assert.equal(after.shareViewCount,9);delete after.shareViewCount;delete before.shareViewCount;assert.deepEqual(after,before);
 assert.equal((await f.catalog.listPublished())[0].shareViewCount,9);assert.equal((await f.catalog.detail(app.id)).shareViewCount,9);
});
test('the same request key is scoped to an app and does not confuse two shared apps',async t=>{
 const f=await fixture(t),a=await f.app(),b=await f.app(),key=randomUUID();
 assert.equal((await f.service.record(a.shareId,key,'a')).shareViewCount,1);assert.equal((await f.service.record(b.shareId,key,'b')).shareViewCount,1);assert.equal(await f.db.appShareVisit.count(),2);
});
test('private, pending, withdrawn, recycled and inactive-owner apps do not expose or increase share counts',async t=>{
 const f=await fixture(t),owner=await f.db.user.create({data:{username:'owner',email:'owner@qgauss.test',passwordHash:'fixture-only',status:'DISABLED'}});
 const values=[{published:false},{deletedAt:new Date()},{origin:'USER',ownerId:owner.id,reviewStatus:'APPROVED'},{origin:'USER',ownerId:owner.id,reviewStatus:'PENDING'}];
 for(const data of values){const app=await f.app(data);await assert.rejects(()=>f.service.read(app.shareId),status(404));await assert.rejects(()=>f.service.record(app.shareId,randomUUID(),'viewer'),status(404));assert.equal((await f.db.app.findUnique({where:{id:app.id}})).shareViewCount,0);}
 assert.equal(await f.db.appShareVisit.count(),0);
});
test('withdrawal blocks replay of an existing receipt and publication keeps the previous total',async t=>{
 const f=await fixture(t),app=await f.app(),key=randomUUID();await f.service.record(app.shareId,key,'viewer');await f.db.app.update({where:{id:app.id},data:{published:false}});
 await assert.rejects(()=>f.service.read(app.shareId),status(404));await assert.rejects(()=>f.service.record(app.shareId,key,'viewer'),status(404));await f.db.app.update({where:{id:app.id},data:{published:true}});
 assert.equal((await f.service.record(app.shareId,key,'viewer')).counted,false);assert.equal((await f.service.record(app.shareId,randomUUID(),'viewer')).shareViewCount,2);
});
test('creator records keep their accumulated public visits when the app becomes private',async t=>{
 const f=await fixture(t),owner=await f.db.user.create({data:{username:'creator',email:'creator@qgauss.test',passwordHash:'fixture-only'}}),app=await f.app({origin:'USER',ownerId:owner.id,reviewStatus:'APPROVED'});
 await f.service.record(app.shareId,randomUUID(),'reader');await f.db.app.update({where:{id:app.id},data:{published:false,reviewStatus:'DRAFT'}});
 const creator=new AppCreatorService(f.db,new LedgerService(f.db),new ModerationService(f.db),new RateLimitService());assert.equal((await creator.mine(owner.id,app.id)).shareViewCount,1);assert.equal((await creator.listMine(owner.id,'active')).items[0].shareViewCount,1);
});
test('expired deduplication receipts are cleaned without reducing totals or removing recent receipts',async t=>{
 const f=await fixture(t),app=await f.app(),old=randomUUID(),recent=randomUUID();await f.service.record(app.shareId,old,'reader');await f.service.record(app.shareId,recent,'reader');
 await f.db.appShareVisit.update({where:{appId_requestKey:{appId:app.id,requestKey:old}},data:{createdAt:new Date(Date.now()-8*86400000)}});
 assert.equal(await f.service.prune(),1);assert.equal(await f.service.prune(),0);assert.equal(await f.db.appShareVisit.count(),1);assert.equal((await f.service.read(app.shareId)).shareViewCount,2);assert.equal((await f.service.record(app.shareId,recent,'reader')).counted,false);
});
test('counter saturation stays within the database integer range',async t=>{
 const f=await fixture(t),app=await f.app({shareViewCount:2147483646});assert.equal((await f.service.record(app.shareId,randomUUID(),'reader')).shareViewCount,2147483647);const capped=await f.service.record(app.shareId,randomUUID(),'reader');assert.equal(capped.shareViewCount,2147483647);assert.equal(capped.counted,false);
 await assert.rejects(()=>f.db.app.update({where:{id:app.id},data:{shareViewCount:-1}}));
});
test('request validation rejects malformed keys and the write rate limit cannot affect count reads',async t=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}),metadata={type:'body',metatype:AppShareVisitDto};
 for(const key of [null,undefined,1,[],{},'bad','../path',randomUUID().replace(/-/g,'')])await assert.rejects(()=>pipe.transform({requestKey:key},metadata),status(400));
 const f=await fixture(t),app=await f.app();for(let n=0;n<120;n++)await f.service.record(app.shareId,randomUUID(),'one-reader');await assert.rejects(()=>f.service.record(app.shareId,randomUUID(),'one-reader'),status(429));assert.equal((await f.service.read(app.shareId)).shareViewCount,120);assert.equal((await f.service.record(app.shareId,randomUUID(),'another-reader')).shareViewCount,121);
 await f.service.onModuleDestroy();await assert.rejects(()=>f.service.record(app.shareId,randomUUID(),'reader'),status(503));
});
test('separate worker processes sharing the database still record one retry receipt',async t=>{
 const f=await fixture(t),app=await f.app(),key=randomUUID(),worker=join(here,'app-share-visit-worker.mjs');
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[worker,f.database,app.shareId,key],{windowsHide:true,stdio:['ignore','pipe','pipe']}),out=[],err=[];child.stdout.on('data',s=>out.push(s));child.stderr.on('data',s=>err.push(s));child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(Buffer.concat(out).toString())):reject(Error(Buffer.concat(err).toString())));});
 const rows=await Promise.all(Array.from({length:4},run));assert.equal(rows.filter(row=>row.counted).length,1);assert.ok(rows.every(row=>row.shareViewCount===1));assert.equal((await f.service.read(app.shareId)).shareViewCount,1);
});
test('the migration preserves existing apps and starts historical counters at zero',()=>{
 const database=join(folder,'upgrade.db'),db=new DatabaseSync(database),migrations=join(here,'../prisma/migrations');
 db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL,appliedAt DATETIME NOT NULL);');
 for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')&&name<'0038').sort()){db.exec(readFileSync(join(migrations,file),'utf8'));db.prepare('INSERT INTO _migrations VALUES(?,?)').run(file,new Date().toISOString());}
 db.prepare('INSERT INTO apps(id,name,systemPrompt,createdAt,updatedAt) VALUES(?,?,?,?,?)').run('legacy-partner','保留原名','Private original instructions','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z');const before=db.prepare('SELECT * FROM apps').get();db.close();
 execFileSync(process.execPath,[migrate],{env:{...process.env,DATABASE_FILE:database},stdio:'pipe'});const current=new DatabaseSync(database);try{const row=current.prepare('SELECT * FROM apps').get();assert.equal(row.shareViewCount,0);delete row.shareViewCount;assert.deepEqual(row,before);assert.equal(current.prepare('SELECT count(*) n FROM app_share_visits').get().n,0);assert.equal(current.prepare('SELECT count(*) n FROM _migrations').get().n,readdirSync(migrations).filter(name=>name.endsWith('.sql')).length);assert.equal(current.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(current.prepare('PRAGMA foreign_key_check').all(),[]);}finally{current.close();}
});
