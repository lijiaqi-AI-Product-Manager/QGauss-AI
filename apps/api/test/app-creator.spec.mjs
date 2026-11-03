import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {ValidationPipe} from '@nestjs/common';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
import {ModerationService} from '../dist/modules/moderation/moderation.service.js';
import {SettingsService} from '../dist/modules/settings/settings.service.js';
import {AppCreatorService} from '../dist/modules/apps/app-creator.service.js';
import {AppsService} from '../dist/modules/apps/apps.service.js';
import {ConversationsService} from '../dist/modules/conversations/conversations.service.js';
import {CreateOwnedAppDto,UpdateOwnedAppDto,AppActionDto,ReviewOwnedAppDto} from '../dist/modules/apps/dto/creator-app.dto.js';

const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-app-creator-')),base=join(folder,'base.db');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const status=expected=>error=>error.getStatus?.()===expected;
async function fixture(t){
 const database=join(folder,randomUUID()+'.db');copyFileSync(base,database);
 const db=new SqliteClient({datasources:{db:{url:'file:'+database.replace(/\\/g,'/')}}});t.after(()=>db.$disconnect());
 const users=await Promise.all(['owner','other','admin','super'].map((name,index)=>db.user.create({data:{username:name,email:name+'@qgauss.test',passwordHash:'synthetic-only',role:index===3?'SUPER':index===2?'ADMIN':'USER'}})));
 const [owner,other,admin,superuser]=users,ledger=new LedgerService(db),moderation=new ModerationService(db),service=new AppCreatorService(db,ledger,moderation,new RateLimitService()),catalog=new AppsService(db);
 const input=(extra={})=>({name:'灵感搭档',description:'让复杂问题变得清楚',icon:'🪐',systemPrompt:'私人角色设定：先询问目标，再给出清晰建议。',greeting:'今天想一起解决什么？',defaultModel:null,categoryId:null,requestKey:randomUUID(),...extra});
 const create=(extra={})=>service.create(owner.id,input(extra)),intent=(row,extra={})=>({version:row.version,requestKey:randomUUID(),...extra});
 const act=(row,kind,extra={})=>service.action(owner.id,row.id,intent(row,extra),kind);
 async function rewards(counts){for(const [pool,count]of Object.entries(counts))await db.globalConfig.upsert({where:{key:'apps.reviewReward.'+pool},create:{key:'apps.reviewReward.'+pool,value:JSON.stringify(count)},update:{value:JSON.stringify(count)}});}
 async function approve(row,extra={}){const detail=await service.reviewDetail(row.id);return service.review(admin.id,row.id,{...intent(detail),decision:'APPROVE',note:'',offerRevision:detail.rewardOffer.revision,...extra});}
 return{db,owner,other,admin,superuser,ledger,moderation,service,catalog,input,create,intent,act,rewards,approve};
}
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-app-creator-'));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('owned creation stays private, summaries hide settings, and the owner receives a dedicated editor record',async t=>{
 const f=await fixture(t),row=await f.create();assert.equal(row.published,false);assert.equal(row.reviewStatus,'DRAFT');assert.equal(row.version,1);assert.ok(row.shareId);assert.match(row.systemPrompt,/私人角色设定/);
 const mine=await f.service.listMine(f.owner.id,'active');assert.deepEqual(mine.counts,{active:1,trash:0});assert.equal(mine.items[0].systemPrompt,undefined);assert.equal(mine.items[0].events,undefined);assert.equal(row.events[0].actorId,undefined);
 assert.equal((await f.catalog.listPublished(f.other.id)).length,0);assert.equal((await f.catalog.detail(row.id,f.owner.id)).systemPrompt,undefined);assert.equal((await f.catalog.getForChat(row.id,f.owner.id)).systemPrompt,row.systemPrompt);
 for(const read of [()=>f.service.mine(f.other.id,row.id),()=>f.service.byRequest(f.other.id,row.lastActionKey),()=>f.catalog.detail(row.id,f.other.id),()=>f.catalog.getForChat(row.id,f.other.id),()=>f.service.shared(f.owner.id,row.shareId)])await assert.rejects(read,status(404));
});
test('anonymous catalog and shared reads expose only approved active public records',async t=>{
 const f=await fixture(t);let row=await f.create();assert.equal((await f.catalog.listPublished(undefined)).length,0);await assert.rejects(()=>f.catalog.detail(row.id,undefined),status(404));await assert.rejects(()=>f.service.shared(undefined,row.shareId),status(404));row=await f.approve(await f.act(row,'submit'));await f.catalog.toggleFavorite(f.owner.id,row.id,true);assert.equal((await f.catalog.listPublished(undefined))[0].favorited,false);const publicRow=await f.catalog.detail(row.id,undefined);assert.equal(publicRow.systemPrompt,undefined);assert.equal(publicRow.ownerId,undefined);assert.equal(publicRow.lastActionKey,undefined);assert.equal(publicRow.favorited,false);assert.equal(publicRow.shareId,row.shareId);assert.equal((await f.service.shared(undefined,row.shareId)).id,row.id);await f.act(row,'withdraw');await assert.rejects(()=>f.catalog.detail(row.id,undefined),status(404));
});

test('parallel creation retries keep one record, and a reused save key cannot change its content',async t=>{
 const f=await fixture(t),body=f.input(),rows=await Promise.all(Array.from({length:8},()=>f.service.create(f.owner.id,body)));assert.ok(rows.every(row=>row.id===rows[0].id));assert.equal(await f.db.app.count(),1);
 assert.equal((await f.service.byRequest(f.owner.id,body.requestKey)).id,rows[0].id);await assert.rejects(()=>f.service.create(f.owner.id,{...body,name:'另一份内容'}),status(409));
});
test('accepted save and edit retries remain readable after the model or moderation rules change',async t=>{
 const f=await fixture(t);await f.db.aiModel.create({data:{name:'qg-chat',displayName:'QGauss chat',capabilities:'chat'}});const body=f.input({defaultModel:'qg-chat'}),row=await f.service.create(f.owner.id,body),update={...f.input({name:'已保存修改',defaultModel:'qg-chat'}),version:row.version};
 const saved=await f.service.update(f.owner.id,row.id,update);await f.db.aiModel.update({where:{name:'qg-chat'},data:{status:'DISABLED'}});await f.db.sensitiveWord.create({data:{word:'私人角色设定',action:'block'}});
 assert.equal((await f.service.create(f.owner.id,body)).id,row.id);assert.equal((await f.service.update(f.owner.id,row.id,update)).version,saved.version);await assert.rejects(()=>f.service.update(f.owner.id,row.id,{...update,version:saved.version,requestKey:randomUUID()}),status(400));
});
test('edits use a current version and concurrent different edits have one winner',async t=>{
 const f=await fixture(t),row=await f.create(),results=await Promise.allSettled(['甲','乙'].map(name=>f.service.update(f.owner.id,row.id,{...f.input({name}),version:row.version})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.getStatus(),409);assert.equal((await f.service.mine(f.owner.id,row.id)).version,2);
});
test('image-only, disabled and missing models cannot be selected for a character',async t=>{
 const f=await fixture(t);await f.db.aiModel.createMany({data:[{name:'qg-image',displayName:'Image',capabilities:'image'},{name:'qg-disabled',displayName:'Disabled',status:'DISABLED'}]});
 for(const defaultModel of ['qg-image','qg-disabled','missing'])await assert.rejects(()=>f.create({defaultModel}),status(400));assert.equal(await f.db.app.count(),0);
 const row=await f.create();await f.db.sensitiveWord.create({data:{word:'私人角色设定',action:'review'}});await assert.rejects(()=>f.act(row,'submit'),status(400));assert.equal((await f.service.mine(f.owner.id,row.id)).reviewStatus,'DRAFT');
});
test('active and retained limits cannot be bypassed with trash or restore',async t=>{
 const f=await fixture(t);await f.db.app.createMany({data:Array.from({length:20},(_,i)=>({id:'active-'+i,name:'搭档 '+i,systemPrompt:'私有设定',origin:'USER',ownerId:f.owner.id,reviewStatus:'DRAFT',published:false}))});await assert.rejects(()=>f.create(),status(409));
 const first=await f.service.mine(f.owner.id,'active-0'),trashed=await f.act(first,'trash'),created=await f.create();await assert.rejects(()=>f.act(trashed,'restore'),status(409));await f.act(created,'trash');const restored=await f.act(trashed,'restore');assert.equal(restored.reviewStatus,'DRAFT');assert.equal(restored.published,false);
 const g=await fixture(t);await g.db.app.createMany({data:Array.from({length:100},(_,i)=>({id:'retained-'+i,name:'旧搭档',systemPrompt:'私有设定',origin:'USER',ownerId:g.owner.id,reviewStatus:'DRAFT',published:false,deletedAt:new Date()}))});await assert.rejects(()=>g.create(),status(409));
});
test('submission locks editing and trash while explicit withdrawal restores private editing',async t=>{
 const f=await fixture(t),row=await f.create(),submit=f.intent(row),pending=await f.service.action(f.owner.id,row.id,submit,'submit');assert.equal(pending.reviewStatus,'PENDING');assert.equal((await f.service.action(f.owner.id,row.id,submit,'submit')).version,pending.version);
 await assert.rejects(()=>f.service.update(f.owner.id,row.id,{...f.input(),version:pending.version}),status(409));await assert.rejects(()=>f.act(pending,'trash'),status(409));assert.equal((await f.catalog.getForChat(row.id,f.owner.id)).id,row.id);
 const withdrawn=await f.act(pending,'withdraw');assert.equal(withdrawn.published,false);assert.equal(withdrawn.reviewStatus,'DRAFT');assert.equal((await f.service.update(f.owner.id,row.id,{...f.input({name:'继续打磨'}),version:withdrawn.version})).name,'继续打磨');
});
test('review approval publishes a safe detail and grants each configured pool only once',async t=>{
 const f=await fixture(t);await f.rewards({model3:3,model4:2,drawMj:1,agent:4});let row=await f.act(await f.create(),'submit');const detail=await f.service.reviewDetail(row.id),body={...f.intent(row),decision:'APPROVE',note:'欢迎加入',offerRevision:detail.rewardOffer.revision};
 const approved=await f.service.review(f.admin.id,row.id,body);assert.equal(approved.published,true);assert.equal(approved.rewardOffer.alreadyGranted,true);assert.equal((await f.service.review(f.admin.id,row.id,body)).version,approved.version);
 const balance=await f.db.userBalance.findUniqueOrThrow({where:{userId:f.owner.id}});for(const [field,value]of Object.entries({model3Count:3,model4Count:2,drawMjCount:1,agentCount:4}))assert.equal(balance[field],value);
 assert.equal(await f.db.accountLog.count({where:{extent:'app-review:'+row.id}}),1);const publicDetail=await f.catalog.detail(row.id,f.other.id);for(const field of ['systemPrompt','ownerId','eventsJson','rewardJson','lastActionSignature'])assert.equal(publicDetail[field],undefined);assert.equal((await f.service.shared(f.other.id,approved.shareId)).id,row.id);
 row=await f.act(approved,'withdraw');row=await f.act(row,'trash');row=await f.act(row,'restore');row=await f.act(row,'submit');await f.rewards({model3:99});await f.approve(row);assert.equal(await f.db.accountLog.count({where:{extent:'app-review:'+row.id}}),1);assert.equal((await f.db.userBalance.findUniqueOrThrow({where:{userId:f.owner.id}})).model3Count,3);
});
test('changed rewards invalidate approval and the refreshed offer is the one that gets granted',async t=>{
 const f=await fixture(t);await f.rewards({model3:2});const row=await f.act(await f.create(),'submit'),old=await f.service.reviewDetail(row.id);await f.rewards({model3:5});await assert.rejects(()=>f.approve(row,{offerRevision:old.rewardOffer.revision}),status(409));assert.equal(await f.db.accountLog.count(),0);assert.equal((await f.service.mine(f.owner.id,row.id)).published,false);await f.approve(row);assert.equal((await f.db.userBalance.findUniqueOrThrow({where:{userId:f.owner.id}})).model3Count,5);
});
test('grant failure rolls back publication, review metadata and balance changes together',async t=>{
 const f=await fixture(t);await f.rewards({model3:7});const row=await f.act(await f.create(),'submit'),detail=await f.service.reviewDetail(row.id),body={...f.intent(row),decision:'APPROVE',note:'',offerRevision:detail.rewardOffer.revision};
 const faulty=Object.create(f.ledger);faulty.grantTx=async(...args)=>{await f.ledger.grantTx(...args);throw Error('synthetic grant failure');};const service=new AppCreatorService(f.db,faulty,f.moderation,new RateLimitService());await assert.rejects(()=>service.review(f.admin.id,row.id,body),/synthetic grant failure/);
 const unchanged=await f.service.mine(f.owner.id,row.id);assert.equal(unchanged.version,row.version);assert.equal(unchanged.reviewStatus,'PENDING');assert.equal(unchanged.rewardGrantedAt,null);assert.equal(await f.db.accountLog.count(),0);assert.equal(await f.db.userBalance.count(),0);await f.service.review(f.admin.id,row.id,body);assert.equal(await f.db.accountLog.count(),1);
});
test('self-admin and zero-reward first approvals cannot create later reward loops',async t=>{
 const f=await fixture(t);await f.rewards({model3:9});const own=await f.service.create(f.admin.id,f.input()),submitted=await f.service.action(f.admin.id,own.id,f.intent(own),'submit');await f.approve(submitted);assert.equal(await f.db.accountLog.count(),0);
 const g=await fixture(t);let row=await g.act(await g.create(),'submit');row=await g.approve(row);assert.ok(row.rewardGrantedAt);await g.rewards({model3:9});row=await g.act(row,'withdraw');row=await g.act(row,'submit');await g.approve(row);assert.equal(await g.db.accountLog.count(),0);
});
test('return feedback is required, edits can be resubmitted, and inactive owners can be returned but not approved',async t=>{
 const f=await fixture(t);let row=await f.act(await f.create(),'submit');await assert.rejects(()=>f.service.review(f.admin.id,row.id,{...f.intent(row),decision:'REJECT',note:' '}),status(400));await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});await assert.rejects(()=>f.approve(row),status(409));
 row=await f.service.review(f.admin.id,row.id,{...f.intent(row),decision:'REJECT',note:'请补充帮助对象'});assert.equal(row.reviewStatus,'REJECTED');await f.db.user.update({where:{id:f.owner.id},data:{status:'ACTIVE'}});row=await f.service.update(f.owner.id,row.id,{...f.input({description:'面向刚入门的学习者'}),version:row.version});assert.equal(row.reviewNote,'请补充帮助对象');row=await f.act(row,'submit');assert.equal(row.reviewNote,null);await f.approve(row);
});
test('ordinary users cannot review or mutate another owner and legacy administration cannot publish user drafts',async t=>{
 const f=await fixture(t),row=await f.create();await assert.rejects(()=>f.service.update(f.other.id,row.id,{...f.input(),version:row.version}),status(404));await assert.rejects(()=>f.service.review(f.owner.id,row.id,{...f.intent(row),decision:'REJECT',note:'绕过'}),status(403));
 await assert.rejects(()=>f.catalog.update(row.id,{published:true}),status(409));await assert.rejects(()=>f.catalog.remove(row.id),status(409));await assert.rejects(()=>f.service.reviewDetail(row.id),status(404));assert.equal((await f.catalog.adminList()).length,0);
 const legacy=await f.db.app.create({data:{name:'站点精选',systemPrompt:'内部精选设定',createdBy:f.owner.id}});await assert.rejects(()=>f.service.mine(f.owner.id,legacy.id),status(404));assert.equal((await f.catalog.listPublished(f.other.id)).length,1);
});
test('withdrawn edits disappear from sharing, favorites and other users conversation metadata',async t=>{
 const f=await fixture(t);let row=await f.approve(await f.act(await f.create(),'submit'));await f.catalog.toggleFavorite(f.other.id,row.id,true);const conv=await f.db.conversation.create({data:{userId:f.other.id,appId:row.id,title:'之前的协作'}}),conversations=new ConversationsService(f.db,{});assert.equal((await conversations.detail(f.other.id,conv.id)).app.version,row.version);
 row=await f.act(row,'withdraw');row=await f.service.update(f.owner.id,row.id,{...f.input({name:'现在的私人名字',systemPrompt:'现在的私人角色设定'}),version:row.version});assert.equal((await f.catalog.listFavorites(f.other.id)).length,0);await assert.rejects(()=>f.service.shared(f.other.id,row.shareId),status(404));await assert.rejects(()=>f.catalog.getForChat(row.id,f.other.id),status(404));
 for(const response of [await conversations.detail(f.other.id,conv.id),await conversations.list(f.other.id)])assert.doesNotMatch(JSON.stringify(response),/现在的私人/);assert.equal((await conversations.detail(f.other.id,conv.id)).app,null);
});
test('disabled owners stop public availability and administrators can permanently stop that publication',async t=>{
 const f=await fixture(t);let row=await f.approve(await f.act(await f.create(),'submit'));await f.db.user.update({where:{id:f.owner.id},data:{status:'DISABLED'}});assert.equal((await f.catalog.listPublished(f.other.id)).length,0);await assert.rejects(()=>f.catalog.detail(row.id,f.other.id),status(404));
 row=await f.service.review(f.admin.id,row.id,{...f.intent(row),decision:'UNPUBLISH',note:'需要重新检查'});await f.db.user.update({where:{id:f.owner.id},data:{status:'ACTIVE'}});assert.equal(row.published,false);assert.equal((await f.catalog.listPublished(f.other.id)).length,0);
});
test('ending an unconfirmed edit fences late requests without changing content',async t=>{
 const f=await fixture(t),row=await f.create(),intent=f.intent(row),ended=await f.service.reconcile(f.owner.id,row.id,intent);assert.equal(ended.resolution,'not-applied');assert.equal(ended.app.version,row.version+1);assert.equal(ended.app.lastAction,'RECONCILE');assert.equal(ended.app.systemPrompt,row.systemPrompt);
 await assert.rejects(()=>f.service.update(f.owner.id,row.id,{...f.input({name:'迟到的修改'}),...intent}),status(409));assert.equal((await f.service.reconcile(f.owner.id,row.id,intent)).app.version,ended.app.version);assert.equal((await f.service.mine(f.owner.id,row.id)).name,row.name);
});
test('reconciliation recognizes committed actions and does not undo later owner work',async t=>{
 const f=await fixture(t),row=await f.create(),intent=f.intent(row),trashed=await f.service.action(f.owner.id,row.id,intent,'trash');const confirmed=await f.service.reconcile(f.owner.id,row.id,intent);assert.equal(confirmed.resolution,'applied');assert.equal(confirmed.app.version,trashed.version);const restored=await f.act(trashed,'restore'),changed=await f.service.reconcile(f.owner.id,row.id,intent);assert.equal(changed.resolution,'changed');assert.equal(changed.app.version,restored.version);await assert.rejects(()=>f.service.reconcile(f.other.id,row.id,intent),status(404));
});
test('ending an unconfirmed review prevents a late approval and its reward',async t=>{
 const f=await fixture(t);await f.rewards({model3:6});const row=await f.act(await f.create(),'submit'),detail=await f.service.reviewDetail(row.id),intent=f.intent(row),ended=await f.service.reconcile(f.admin.id,row.id,intent,true);assert.equal(ended.resolution,'not-applied');assert.equal(ended.app.reviewStatus,'PENDING');
 await assert.rejects(()=>f.service.review(f.admin.id,row.id,{...intent,decision:'APPROVE',note:'',offerRevision:detail.rewardOffer.revision}),status(409));assert.equal(await f.db.accountLog.count(),0);assert.equal((await f.service.reconcile(f.admin.id,row.id,intent,true)).app.version,ended.app.version);await f.approve(ended.app);assert.equal(await f.db.accountLog.count(),1);
});
test('review reconciliation reports an accepted approval without repeating the grant',async t=>{
 const f=await fixture(t);await f.rewards({agent:2});const row=await f.act(await f.create(),'submit'),detail=await f.service.reviewDetail(row.id),intent=f.intent(row);await f.service.review(f.admin.id,row.id,{...intent,decision:'APPROVE',note:'',offerRevision:detail.rewardOffer.revision});const result=await f.service.reconcile(f.admin.id,row.id,intent,true);assert.equal(result.resolution,'applied');assert.equal(await f.db.accountLog.count(),1);
});
test('query bounds reject duplicate values and deterministic pagination does not repeat equal-time rows',async t=>{
 const f=await fixture(t);for(const value of [['active'],null,'invalid'])await assert.rejects(()=>f.service.listMine(f.owner.id,value),status(400));for(const args of [[['PENDING'],undefined,undefined],['PENDING','0','15'],['PENDING','1','51'],['PENDING',['1'],'15']])await assert.rejects(()=>f.service.reviews(...args),status(400));
 await f.db.app.createMany({data:Array.from({length:17},(_,i)=>({id:'page-'+String(i).padStart(2,'0'),name:'等待审核',systemPrompt:'设定',ownerId:f.owner.id,origin:'USER',reviewStatus:'PENDING',published:false,updatedAt:new Date(100000)}))});const a=await f.service.reviews('PENDING','1','15'),b=await f.service.reviews('PENDING','2','15');assert.equal(a.total,17);assert.equal(new Set([...a.items,...b.items].map(row=>row.id)).size,17);assert.equal(a.items[0].systemPrompt,undefined);
});
test('creator input preserves JSON types and strips ownership, publication and reward overrides',async()=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}),transform=(body,metatype)=>pipe.transform(body,{type:'body',metatype}),body={name:'名字',description:'',icon:'🪐',systemPrompt:'角色设定',greeting:'',requestKey:randomUUID()};
 const safe=await transform({...body,ownerId:'other',published:true,reviewStatus:'APPROVED',rewardGrantedAt:new Date()},CreateOwnedAppDto);for(const key of ['ownerId','published','reviewStatus','rewardGrantedAt'])assert.equal(Object.hasOwn(safe,key),false);
 const image='qgauss:app-icon:ai_'+'a'.repeat(48);assert.equal((await transform({...body,icon:image},CreateOwnedAppDto)).icon,image);
 for(const extra of [{name:123},{description:null},{systemPrompt:[]},{icon:'<script>'},{defaultModel:123},{categoryId:{}},{greeting:123}])await assert.rejects(()=>transform({...body,...extra},CreateOwnedAppDto),status(400));
 for(const version of ['1',0,1.2,null,2147483647])await assert.rejects(()=>transform({version,requestKey:randomUUID()},AppActionDto),status(400));await assert.rejects(()=>transform({...body,version:'1'},UpdateOwnedAppDto),status(400));await assert.rejects(()=>transform({version:1,requestKey:randomUUID(),decision:'APPROVE',note:''},ReviewOwnedAppDto),status(400));
});
test('creator reward settings reject fractional counts and remain private',async t=>{
 const f=await fixture(t),settings=new SettingsService(f.db);await assert.rejects(()=>settings.set('apps.reviewReward.model3',1.5),status(400));await settings.set('apps.reviewReward.model3',4);assert.equal((await settings.publicConfig())['apps.reviewReward.model3'],undefined);
});
test('the ownership migration preserves legacy rows and never interprets the old creator text as ownership',async t=>{
 const database=join(folder,'legacy-'+randomUUID()+'.db'),db=new DatabaseSync(database);db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL,appliedAt DATETIME NOT NULL)');const names=readdirSync(join(here,'../prisma/migrations')).filter(name=>name.endsWith('.sql')&&name<'0032');for(const name of names){db.exec(readFileSync(join(here,'../prisma/migrations',name),'utf8'));db.prepare('INSERT INTO _migrations VALUES(?,?)').run(name,new Date().toISOString());}
 db.prepare('INSERT INTO apps(id,name,systemPrompt,createdBy,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('legacy-app','既有精选','保持原有角色设定','historical-text',1000,1000);const columns=db.prepare('PRAGMA table_info(apps)').all().map(row=>row.name),before=db.prepare('SELECT * FROM apps').all();db.close();execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:database},stdio:'pipe'});const read=new DatabaseSync(database,{readOnly:true});assert.deepEqual(read.prepare('SELECT '+columns.map(name=>'"'+name+'"').join(',')+' FROM apps').all(),before);assert.equal(read.prepare('SELECT count(*) n FROM _migrations').get().n,readdirSync(join(here,'../prisma/migrations')).filter(name=>name.endsWith('.sql')).length);assert.equal(read.prepare("SELECT count(*) n FROM _migrations WHERE name='0032_user_app_studio.sql'").get().n,1);read.close();
 const client=new SqliteClient({datasources:{db:{url:'file:'+database.replace(/\\/g,'/')}}});t.after(()=>client.$disconnect());const row=await client.app.findUniqueOrThrow({where:{id:'legacy-app'}});assert.equal(row.origin,'CURATED');assert.equal(row.ownerId,null);assert.equal(row.reviewStatus,'NONE');assert.equal(row.version,1);assert.equal(row.published,true);
});
