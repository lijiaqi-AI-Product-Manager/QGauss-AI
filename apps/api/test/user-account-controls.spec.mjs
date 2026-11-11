import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {withAuthSession} from '../dist/common/decorators/current-user.decorator.js';
import {UserAccountControlsService} from '../dist/modules/users/account-controls.service.js';
import {managementInput,sessionActionInput,sessionQuery} from '../dist/modules/users/account-controls.query.js';
import {UsersService} from '../dist/modules/users/users.service.js';
import {UsersController} from '../dist/modules/users/users.controller.js';
import {JwtStrategy} from '../dist/modules/auth/jwt.strategy.js';
import {AuthService} from '../dist/modules/auth/auth.service.js';
import {SalesService} from '../dist/modules/commerce/sales.service.js';

const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-account-controls-')),base=join(folder,'base.db');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe',windowsHide:true});
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
const rejects=status=>error=>error.getStatus?.()===status;
const profile=value=>({id:value.id,email:value.email,username:value.username,role:value.role});
async function fixture(t){
  const path=join(folder,randomUUID()+'.db');copyFileSync(base,path);const db=new SqliteClient({datasources:{db:{url:'file:'+path}}});await db.$connect();t.after(()=>db.$disconnect());
  const admin=await db.user.create({data:{username:'operator',email:'operator@qgauss.test',role:'ADMIN',passwordHash:'private hash'}}),user=await db.user.create({data:{username:'reader',email:'reader@qgauss.test',passwordHash:'private hash',inviteCode:'KEEPINVITE',invitedBy:'keep-inviter',updatedAt:new Date('2026-01-01T00:00:00.000Z')}});
  const adminFamily=randomUUID();await db.refreshToken.create({data:{userId:admin.id,familyId:adminFamily,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+3600_000)}});
  const actor=withAuthSession(profile(admin),{tokenVersion:admin.tokenVersion,familyId:adminFamily,expiresAt:Date.now()+60000}),service=new UserAccountControlsService(db),users=new UsersService(db,{tryConsume:()=>true});
  const token=async(familyId=randomUUID(),extra={})=>db.refreshToken.create({data:{userId:user.id,familyId,tokenHash:'private-'+randomUUID(),createdAt:new Date(Date.now()-30000),expiresAt:new Date(Date.now()+3600_000),ip:'192.0.2.10',userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',...extra}});
  return{db,path,admin,user,actor,adminFamily,service,users,token,metadata:(extra={})=>({expectedUpdatedAt:user.updatedAt.toISOString(),requestKey:randomUUID(),adminNote:'Follow up',...extra}),sessions:()=>service.sessions(user.id,{pageSize:'8'},actor)};
}
const request=(page,extra={})=>({expectedUpdatedAt:page.user.updatedAt,requestKey:randomUUID(),scope:'all',expectedRevision:page.revision,...extra});
const jwt=(f,who,familyId,tokenVersion=who.tokenVersion)=>new JwtStrategy({getOrThrow:()=> 'test-signing-key'},f.db).validate({sub:who.id,email:who.email,username:who.username,role:who.role,tv:tokenVersion,sid:familyId,type:'access'});

test('management input rejects extra fields, coercion, missing intent and invalid versions',()=>{
  const valid={expectedUpdatedAt:'2026-01-01T00:00:00.000Z',requestKey:randomUUID(),adminNote:' note\r\n next '};assert.equal(managementInput(valid).adminNote,'note\n next');
  for(const delta of [{adminNote:null},{adminNote:3},{adminNote:'x'.repeat(2001)},{adminNote:'a\0b'},{isDistribution:'false'},{isDistribution:null},{passwordHash:'x'},{expectedUpdatedAt:'2026-02-30T00:00:00.000Z'},{requestKey:'short'}])assert.throws(()=>managementInput({...valid,...delta}),rejects(400));
  assert.throws(()=>managementInput({expectedUpdatedAt:valid.expectedUpdatedAt,requestKey:valid.requestKey}),rejects(400));
  const action={expectedUpdatedAt:valid.expectedUpdatedAt,requestKey:randomUUID(),scope:'one',sessionId:'family-one',expectedRevision:'a'.repeat(64)};assert.equal(sessionActionInput(action).scope,'one');
  for(const delta of [{scope:'other'},{sessionId:null},{scope:'all'},{scope:'others'},{expectedRevision:'A'.repeat(64)},{userId:'another-user'}])assert.throws(()=>sessionActionInput({...action,...delta}),rejects(400));
  for(const q of [{page:1},{page:'1e2'},{pageSize:'51'},{asOf:'9999-01-01T00:00:00.000Z'},{kind:'logins'},{userId:'another-user'}])assert.throws(()=>sessionQuery(q),rejects(400));
});

test('management details and receipt commit once while invitations and balances stay intact',async t=>{
  const f=await fixture(t);await f.db.balance.create({data:{userId:f.user.id,balanceCents:4200}});const input=f.metadata({adminNote:'  First\r\nSecond  ',isDistribution:true});
  const one=await f.service.updateManagement(f.user.id,input,f.actor),two=await f.service.updateManagement(f.user.id,{...input,adminNote:'First\nSecond'},f.actor);assert.equal(two.id,one.id);assert.equal(one.kind,'metadata');assert.equal(one.after.adminNote,'First\nSecond');assert.equal(one.after.isDistribution,true);assert.equal(await f.db.userAccountOperation.count(),1);
  const user=await f.db.user.findUnique({where:{id:f.user.id}});assert.equal(user.inviteCode,'KEEPINVITE');assert.equal(user.invitedBy,'keep-inviter');assert.equal((await f.db.balance.findUnique({where:{userId:f.user.id}})).balanceCents,4200);assert.ok(user.updatedAt>f.user.updatedAt);
  assert.equal((await f.users.profile(f.user.id)).adminNote,undefined);assert.equal(new AuthService().strip(user).adminNote,undefined);assert.equal((await f.users.detail(f.user.id)).adminNote,'First\nSecond');
});

test('enabling referral access prepares an account at the configured rate and preserves an existing pause',async t=>{
  const f=await fixture(t);await f.db.globalConfig.upsert({where:{key:'commerce.defaultCommissionBps'},create:{key:'commerce.defaultCommissionBps',value:'1234'},update:{value:'1234'}});
  const first=await f.service.updateManagement(f.user.id,f.metadata({isDistribution:true}),f.actor);assert.equal(first.referralAccountCreated,true);let sales=await f.db.salesUser.findUnique({where:{userId:f.user.id}});assert.equal(sales.performanceBps,1234);
  await f.db.salesUser.update({where:{userId:f.user.id},data:{enabled:false,performanceBps:765,distributionCents:4400,totalCents:5500}});await f.db.user.update({where:{id:f.user.id},data:{isDistribution:false}});const before=await f.db.salesUser.findUnique({where:{userId:f.user.id}}),user=await f.db.user.findUnique({where:{id:f.user.id}});
  await f.service.updateManagement(f.user.id,f.metadata({expectedUpdatedAt:user.updatedAt.toISOString(),isDistribution:true}),f.actor);sales=await f.db.salesUser.findUnique({where:{userId:f.user.id}});assert.deepEqual(sales,before);assert.equal(sales.enabled,false);assert.equal(sales.performanceBps,765);
  const info=await new SalesService(f.db,{get:async()=>1000},{tryConsume:()=>true}).info(f.user.id);assert.equal(info.enabled,false);assert.equal(info.distributionCents,4400);
});

test('referral deactivation preserves the account and accepted withdrawal receipts',async t=>{
  const f=await fixture(t);await f.db.user.update({where:{id:f.user.id},data:{isDistribution:true}});await f.db.salesUser.create({data:{userId:f.user.id,performanceBps:900,totalCents:5100,distributionCents:3100}});const sales=new SalesService(f.db,{get:async key=>key==='commerce.minWithdrawalCents'?100:5},{tryConsume:()=>true});
  const original=await sales.withdraw(f.user.id,{amountCents:1000,channels:1,contact:'sample-account',requestKey:randomUUID()}),before=await f.db.salesUser.findUnique({where:{userId:f.user.id}}),user=await f.db.user.findUnique({where:{id:f.user.id}});
  await f.service.updateManagement(f.user.id,f.metadata({expectedUpdatedAt:user.updatedAt.toISOString(),isDistribution:false}),f.actor);assert.deepEqual(await f.db.salesUser.findUnique({where:{userId:f.user.id}}),before);await assert.rejects(()=>sales.info(f.user.id),rejects(403));assert.equal((await sales.withdrawals(f.user.id,{})).items[0].id,original.id);assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).inviteCode,'KEEPINVITE');
});

test('preparing a legacy enabled qualification fills its missing referral account',async t=>{
  const f=await fixture(t),user=await f.db.user.update({where:{id:f.user.id},data:{isDistribution:true}});assert.equal((await f.users.detail(f.user.id)).distributionAccountReady,false);const receipt=await f.service.updateManagement(f.user.id,{expectedUpdatedAt:user.updatedAt.toISOString(),requestKey:randomUUID(),isDistribution:true},f.actor);assert.equal(receipt.referralAccountCreated,true);assert.equal(receipt.changed,true);assert.deepEqual(receipt.fields,['isDistribution']);assert.equal((await f.users.detail(f.user.id)).distributionAccountReady,true);assert.equal(await f.db.salesUser.count(),1);
});

test('same operation key cannot change payload, account or action kind',async t=>{
  const f=await fixture(t),input=f.metadata(),first=await f.service.updateManagement(f.user.id,input,f.actor),other=await f.db.user.create({data:{username:'second',email:'second@qgauss.test',passwordHash:'private'}});
  for(const delta of [{adminNote:'different'},{isDistribution:true},{expectedUpdatedAt:first.after.updatedAt}])await assert.rejects(()=>f.service.updateManagement(f.user.id,{...input,...delta},f.actor),rejects(409));
  await assert.rejects(()=>f.service.updateManagement(other.id,input,f.actor),rejects(409));const page=await f.sessions();await assert.rejects(()=>f.service.endSessions(f.user.id,request(page,{requestKey:input.requestKey}),f.actor),rejects(409));assert.equal(await f.db.userAccountOperation.count(),1);
});

test('accepted receipt is recoverable after target changes or deletion, while revoked actors are rejected',async t=>{
  const f=await fixture(t),input=f.metadata(),first=await f.service.updateManagement(f.user.id,input,f.actor);await f.db.user.update({where:{id:f.user.id},data:{status:'DISABLED',displayName:'Changed',deletedAt:new Date()}});assert.equal((await f.service.updateManagement(f.user.id,input,f.actor)).id,first.id);
  await f.db.user.update({where:{id:f.admin.id},data:{role:'USER'}});await assert.rejects(()=>f.service.updateManagement(f.user.id,input,f.actor),rejects(403));assert.equal(await f.db.userAccountOperation.count(),1);
});

function failWrite(db,table,method){const original=db.$transaction.bind(db);db.$transaction=callback=>original(tx=>callback(new Proxy(tx,{get(target,key){const value=Reflect.get(target,key);if(key===table)return new Proxy(value,{get(delegate,operation){if(operation===method)return async()=>{throw Error('deliberate storage failure');};const entry=Reflect.get(delegate,operation);return typeof entry==='function'?entry.bind(delegate):entry;}});return typeof value==='function'?value.bind(target):value;}})));return()=>{db.$transaction=original;};}

test('receipt storage failure rolls back note, referral flag and prepared referral account',async t=>{
  const f=await fixture(t),restore=failWrite(f.db,'userAccountOperation','create');await assert.rejects(()=>f.service.updateManagement(f.user.id,f.metadata({isDistribution:true}),f.actor),/deliberate storage failure/);restore();const user=await f.db.user.findUnique({where:{id:f.user.id}});assert.equal(user.adminNote,'');assert.equal(user.isDistribution,false);assert.equal(user.updatedAt.toISOString(),f.user.updatedAt.toISOString());assert.equal(await f.db.salesUser.count(),0);assert.equal(await f.db.userAccountOperation.count(),0);
});

test('session pages group rotated credentials and omit private fields and expired or revoked logins',async t=>{
  const f=await fixture(t),family=randomUUID(),root=await f.token(family,{createdAt:new Date(Date.now()-60000),usedAt:new Date(Date.now()-1000)}),child=await f.token(family);await f.token(randomUUID(),{expiresAt:new Date(Date.now()-1000)});await f.token(randomUUID(),{revokedAt:new Date()});
  const page=await f.sessions();assert.equal(page.total,1);assert.equal(page.activeTotal,1);assert.equal(page.items[0].id,family);assert.equal(page.items[0].createdAt,root.createdAt.toISOString());assert.equal(page.items[0].lastSeenAt,root.usedAt.toISOString());assert.equal(page.items[0].isCurrent,false);
  const json=JSON.stringify(page);for(const value of ['passwordHash','tokenHash','tokenVersion','signature','adminNote',root.id,child.id,root.tokenHash])assert.equal(json.includes(value),false,value);
});

test('session paging holds its creation bound and reports newly established logins separately',async t=>{
  const f=await fixture(t);await f.token('family-a');await f.token('family-b');const first=await f.service.sessions(f.user.id,{pageSize:'1'},f.actor),second=await f.service.sessions(f.user.id,{page:'2',pageSize:'1',asOf:first.asOf},f.actor);assert.notEqual(first.items[0].id,second.items[0].id);assert.equal(first.total,2);
  await f.token('family-c',{createdAt:new Date(Date.parse(first.asOf)+1000)});const again=await f.service.sessions(f.user.id,{pageSize:'1',asOf:first.asOf},f.actor);assert.equal(again.total,2);assert.equal(again.activeTotal,3);assert.equal(again.items[0].id,first.items[0].id);assert.notEqual(again.revision,first.revision);
});

test('default reads include committed millisecond-ahead timestamps while explicit cutoffs stay exact',async t=>{
  const f=await fixture(t),future=new Date(Date.now()+100),past=new Date(Date.now()-1000).toISOString(),conversation=await f.db.conversation.create({data:{userId:f.user.id,title:'Just committed',createdAt:future}});await f.token('just-established',{createdAt:future});
  const activity=await f.users.activity(f.user.id,{kind:'conversations'});assert.equal(activity.items[0].id,conversation.id);assert.ok(Date.parse(activity.asOf)>=future.getTime());assert.equal((await f.users.activity(f.user.id,{kind:'conversations',asOf:past})).total,0);const detail=await f.users.detail(f.user.id);assert.equal(detail.activity.conversations,1);assert.equal((await f.users.activity(f.user.id,{kind:'conversations',asOf:detail.readAt})).total,1);
  const page=await f.sessions();assert.equal(page.total,1);assert.equal((await f.service.sessions(f.user.id,{asOf:past},f.actor)).total,0);
  const user=await f.db.user.create({data:{username:'just-created',email:'just-created@qgauss.test',passwordHash:'private',createdAt:future}});assert.equal((await f.users.list({keyword:user.username})).total,1);assert.equal((await f.users.list({keyword:user.username,asOf:past})).total,0);
});

test('ending one login revokes its complete rotation chain while other sign-ins remain valid',async t=>{
  const f=await fixture(t),family=randomUUID();await f.token(family);await f.token(family,{createdAt:new Date(Date.now()-1000)});const other=await f.token(),page=await f.sessions(),row=page.items.find(x=>x.id===family),input=request(page,{scope:'one',sessionId:family,expectedRevision:row.revision});
  const result=await f.service.endSessions(f.user.id,input,f.actor);assert.equal(result.endedCount,1);assert.equal(result.kind,'session');assert.equal(await f.db.refreshToken.count({where:{userId:f.user.id,familyId:family,revokedAt:null}}),0);assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).tokenVersion,f.user.tokenVersion);
  await assert.rejects(()=>jwt(f,f.user,family),rejects(401));await jwt(f,f.user,other.familyId);await jwt(f,f.admin,f.adminFamily);assert.equal((await f.service.endSessions(f.user.id,input,f.actor)).id,result.id);
});

test('replaying an accepted all-sign-ins action never logs out a new login',async t=>{
  const f=await fixture(t);await f.token();await f.token();const page=await f.sessions(),input=request(page),one=await f.service.endSessions(f.user.id,input,f.actor);assert.equal(one.endedCount,2);let user=await f.db.user.findUnique({where:{id:f.user.id}});assert.equal(user.tokenVersion,f.user.tokenVersion+1);assert.equal(user.status,'ACTIVE');
  const fresh=await f.token();await f.db.user.update({where:{id:f.user.id},data:{displayName:'After action'}});const two=await f.service.endSessions(f.user.id,input,f.actor);assert.equal(two.id,one.id);assert.equal((await f.db.refreshToken.findUnique({where:{id:fresh.id}})).revokedAt,null);user=await f.db.user.findUnique({where:{id:f.user.id}});await jwt(f,user,fresh.familyId);assert.equal(await f.db.userAccountOperation.count(),1);
});

test('rotation or a new login after review rejects the old scope before any revocation',async t=>{
  const f=await fixture(t),token=await f.token(),page=await f.sessions(),row=page.items[0];await f.token(token.familyId,{createdAt:new Date()});await assert.rejects(()=>f.service.endSessions(f.user.id,request(page,{scope:'one',sessionId:row.id,expectedRevision:row.revision}),f.actor),rejects(409));
  const fresh=await f.sessions();await f.token();await assert.rejects(()=>f.service.endSessions(f.user.id,request(fresh),f.actor),rejects(409));assert.equal(await f.db.refreshToken.count({where:{userId:f.user.id,revokedAt:null}}),3);assert.equal(await f.db.userAccountOperation.count(),0);
});

test('own sign-ins allow ending other logins while retaining the current login',async t=>{
  const f=await fixture(t),current=await f.token(),other=await f.token(),owner=withAuthSession(profile(f.user),{tokenVersion:f.user.tokenVersion,familyId:current.familyId,expiresAt:Date.now()+60000}),page=await f.service.sessions(f.user.id,{pageSize:'8'},owner,true);
  assert.equal(page.items.find(x=>x.id===current.familyId).isCurrent,true);assert.equal(page.otherTotal,1);const input=request(page,{scope:'others',expectedRevision:page.otherRevision}),receipt=await f.service.endSessions(f.user.id,input,owner,true);assert.equal(receipt.kind,'others');assert.equal(receipt.endedCount,1);assert.equal((await f.db.refreshToken.findUnique({where:{id:current.id}})).revokedAt,null);assert.ok((await f.db.refreshToken.findUnique({where:{id:other.id}})).revokedAt);await jwt(f,f.user,current.familyId);
  const newLogin=await f.token();assert.equal((await f.service.endSessions(f.user.id,input,owner,true)).id,receipt.id);assert.equal((await f.db.refreshToken.findUnique({where:{id:newLogin.id}})).revokedAt,null);
});

test('current login, current administrator and protected accounts cannot be forcibly ended',async t=>{
  const f=await fixture(t),page=await f.service.sessions(f.admin.id,{pageSize:'8'},f.actor),row=page.items[0];await assert.rejects(()=>f.service.endSessions(f.admin.id,request(page),f.actor),rejects(422));await assert.rejects(()=>f.service.endSessions(f.admin.id,request(page,{scope:'one',sessionId:row.id,expectedRevision:row.revision}),f.actor),rejects(422));await assert.rejects(()=>f.service.kickOffline(f.admin.id,f.actor),rejects(422));
  await f.db.user.update({where:{id:f.user.id},data:{role:'SUPER'}});await assert.rejects(()=>f.service.kickOffline(f.user.id,f.actor),rejects(403));await assert.rejects(()=>f.service.updateManagement(f.user.id,f.metadata(),f.actor),rejects(403));
});

test('ordinary users cannot target another person or use administrative scopes',async t=>{
  const f=await fixture(t),login=await f.token(),owner=withAuthSession(profile(f.user),{tokenVersion:0,familyId:login.familyId,expiresAt:Date.now()+60000}),page=await f.service.sessions(f.user.id,{},owner,true);await assert.rejects(()=>f.service.sessions(f.admin.id,{},owner,true),rejects(403));await assert.rejects(()=>f.service.sessions(f.admin.id,{},owner),rejects(403));await assert.rejects(()=>f.service.updateManagement(f.user.id,f.metadata(),owner),rejects(403));await assert.rejects(()=>f.service.endSessions(f.user.id,request(page),owner,true),rejects(403));await assert.rejects(()=>f.service.endSessions(f.user.id,request(page,{scope:'others',expectedRevision:page.otherRevision}),f.actor),rejects(403));
});

test('revoked or superseded actor credentials are rejected inside the write transaction',async t=>{
  const f=await fixture(t);await f.db.refreshToken.updateMany({where:{userId:f.admin.id},data:{revokedAt:new Date()}});await assert.rejects(()=>f.service.updateManagement(f.user.id,f.metadata(),f.actor),rejects(403));await f.db.refreshToken.updateMany({where:{userId:f.admin.id},data:{revokedAt:null}});await f.db.user.update({where:{id:f.admin.id},data:{tokenVersion:1}});await assert.rejects(()=>f.service.kickOffline(f.user.id,f.actor),rejects(403));assert.equal(await f.db.userAccountOperation.count(),0);
});

test('legacy all-sign-ins endpoint changes credentials atomically and rolls back on failure',async t=>{
  const f=await fixture(t),login=await f.token(),restore=failWrite(f.db,'refreshToken','updateMany');await assert.rejects(()=>f.service.kickOffline(f.user.id,f.actor),/deliberate storage failure/);restore();assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).tokenVersion,0);assert.equal((await f.db.refreshToken.findUnique({where:{id:login.id}})).revokedAt,null);assert.deepEqual(await f.service.kickOffline(f.user.id,f.actor),{ok:true});await assert.rejects(()=>jwt(f,f.user,login.familyId),rejects(401));
});

test('maintenance history is paged, bounded and excludes internal storage columns',async t=>{
  const f=await fixture(t),receipt=await f.service.updateManagement(f.user.id,f.metadata(),f.actor),detail=await f.users.detail(f.user.id),history=await f.users.activity(f.user.id,{kind:'management',pageSize:'1',asOf:detail.readAt});assert.equal(detail.activity.management,1);assert.equal(history.total,1);assert.equal(history.items[0].receipt.id,receipt.id);for(const field of ['payloadHash','resultJson','tokenVersion','passwordHash'])assert.equal(JSON.stringify(history).includes(field),false);
  const filtered=await f.users.list({adminNote:'Follow',distribution:'false'});assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,f.user.id);const empty=await f.users.activity(f.user.id,{kind:'management',asOf:'2025-01-01T00:00:00.000Z'});assert.equal(empty.total,0);
});

test('administrative routes are restricted while own session routes resolve before identity detail',()=>{
  for(const method of ['sessions','updateManagement','sessionAction','resolveAction','kick'])assert.deepEqual(Reflect.getMetadata('roles',UsersController.prototype[method]),['ADMIN']);
  for(const method of ['ownSessions','ownSessionAction','ownResolveAction'])assert.equal(Reflect.getMetadata('roles',UsersController.prototype[method]),undefined);
  assert.equal(Reflect.getMetadata('path',UsersController.prototype.ownSessions),'sessions');assert.equal(Reflect.getMetadata('path',UsersController.prototype.ownSessionAction),'session-actions');
});

test('concluding an unapplied action records a final receipt and stops a delayed original request',async t=>{
  const f=await fixture(t),payload=f.metadata(),resolved=await f.service.resolveAction(f.user.id,{kind:'metadata',payload},f.actor);assert.equal(resolved.outcome,'NOT_APPLIED');assert.equal(resolved.changed,false);const delayed=await f.service.updateManagement(f.user.id,payload,f.actor);assert.equal(delayed.id,resolved.id);assert.equal(delayed.outcome,'NOT_APPLIED');assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).adminNote,'');assert.equal(await f.db.userAccountOperation.count(),1);
  await assert.rejects(()=>f.service.resolveAction(f.user.id,{kind:'metadata',payload:{...payload,adminNote:'Changed'}},f.actor),rejects(409));
});

test('concluding an applied action returns its original outcome without reapplying it',async t=>{
  const f=await fixture(t),payload=f.metadata(),applied=await f.service.updateManagement(f.user.id,payload,f.actor);await f.db.user.update({where:{id:f.user.id},data:{adminNote:'A later edit'}});const resolved=await f.service.resolveAction(f.user.id,{kind:'metadata',payload},f.actor);assert.equal(resolved.id,applied.id);assert.equal(resolved.outcome,'APPLIED');assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).adminNote,'A later edit');assert.equal(await f.db.userAccountOperation.count(),1);
});

test('own action conclusion protects a newly established login from the original delayed request',async t=>{
  const f=await fixture(t),current=await f.token(),owner=withAuthSession(profile(f.user),{tokenVersion:0,familyId:current.familyId,expiresAt:Date.now()+60000});await f.token();const page=await f.service.sessions(f.user.id,{},owner,true),payload=request(page,{scope:'others',expectedRevision:page.otherRevision}),resolved=await f.service.resolveAction(f.user.id,{kind:'others',payload},owner,true);assert.equal(resolved.outcome,'NOT_APPLIED');const recent=await f.token(),late=await f.service.endSessions(f.user.id,payload,owner,true);assert.equal(late.id,resolved.id);assert.equal(await f.db.refreshToken.count({where:{userId:f.user.id,revokedAt:null}}),3);await jwt(f,f.user,recent.familyId);
});

test('rate limits stop new actions while an existing original receipt remains recoverable',async t=>{
  const f=await fixture(t),payload=f.metadata(),receipt=await f.service.updateManagement(f.user.id,payload,f.actor),limited=new UserAccountControlsService(f.db,{tryConsume:()=>false});assert.equal((await limited.updateManagement(f.user.id,payload,f.actor)).id,receipt.id);assert.equal((await limited.resolveAction(f.user.id,{kind:'metadata',payload},f.actor)).id,receipt.id);const user=await f.db.user.findUnique({where:{id:f.user.id}});await assert.rejects(()=>limited.updateManagement(f.user.id,f.metadata({expectedUpdatedAt:user.updatedAt.toISOString()}),f.actor),rejects(429));assert.equal(await f.db.userAccountOperation.count(),1);
});

test('upgrading an existing database preserves every legacy business field and default-private notes',async t=>{
  const f=await fixture(t);await f.db.balance.create({data:{userId:f.user.id,balanceCents:7315}});await f.db.userBalance.create({data:{userId:f.user.id,model3Count:23,memberModel3Count:7}});await f.db.salesUser.create({data:{userId:f.user.id,performanceBps:1250,totalCents:4000,distributionCents:3000}});await f.db.$disconnect();
  const database=new DatabaseSync(f.path),q=value=>'"'+value.replaceAll('"','""')+'"';database.exec('DROP TABLE "user_avatar_uploads"; DELETE FROM "_migrations" WHERE name=\'0046_user_avatar_uploads.sql\'; ALTER TABLE "users" DROP COLUMN "signature"; DELETE FROM "_migrations" WHERE name=\'0045_user_profile_signature.sql\'; DROP TABLE "user_account_operations"; ALTER TABLE "users" DROP COLUMN "adminNote"; DELETE FROM "_migrations" WHERE name=\'0044_user_account_controls.sql\';');
  const names=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_migrations' ORDER BY name").all().map(x=>x.name),columns=Object.fromEntries(names.map(name=>[name,database.prepare('PRAGMA table_info('+q(name)+')').all().map(row=>row.name)]));assert.equal(names.length,66);assert.equal(database.prepare('SELECT count(*) n FROM _migrations').get().n,43);
  const snapshot=db=>Object.fromEntries(names.map(name=>[name,createHash('sha256').update(JSON.stringify(db.prepare('SELECT '+columns[name].map(q).join(',')+' FROM '+q(name)+' ORDER BY rowid').all())).digest('hex')])),before=snapshot(database);database.close();
  execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:f.path},stdio:'pipe',windowsHide:true});const after=new DatabaseSync(f.path,{readOnly:true});try{assert.deepEqual(snapshot(after),before);assert.equal(after.prepare('SELECT count(*) n FROM _migrations').get().n,46);assert.equal(after.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_migrations'").get().n,68);assert.ok(after.prepare('SELECT adminNote FROM users').all().every(row=>row.adminNote===''));assert.equal(after.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(after.prepare('PRAGMA foreign_key_check').all().length,0);}finally{after.close();}
});

function worker(f,input,mode='apply'){
  const code=`const {SqliteClient}=await import(process.argv[1]),{UserAccountControlsService}=await import(process.argv[2]),{withAuthSession}=await import(process.argv[3]);const db=new SqliteClient({datasources:{db:{url:'file:'+process.argv[4]}}});try{const actor=withAuthSession(JSON.parse(process.argv[5]),JSON.parse(process.argv[6])),service=new UserAccountControlsService(db),payload=JSON.parse(process.argv[8]),result=process.argv[9]==='resolve'?await service.resolveAction(process.argv[7],{kind:'metadata',payload},actor):await service.updateManagement(process.argv[7],payload,actor);process.stdout.write(JSON.stringify({id:result.id,outcome:result.outcome}));}finally{await db.$disconnect();}`;
  const args=['--input-type=module','-e',code,...['common/prisma/sqlite-client.js','modules/users/account-controls.service.js','common/decorators/current-user.decorator.js'].map(path=>pathToFileURL(resolve(here,'../dist',path)).href),f.path,JSON.stringify(profile(f.admin)),JSON.stringify({tokenVersion:0,familyId:f.adminFamily,expiresAt:Date.now()+60000}),f.user.id,JSON.stringify(input),mode];
  return new Promise((done,fail)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();fail(Error('account worker timed out'));},30000);child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>err+=value);child.once('error',error=>{clearTimeout(timer);fail(error);});child.once('exit',code=>{clearTimeout(timer);if(code===0){try{done(JSON.parse(out));}catch(error){fail(error);}}else fail(Error('account worker failed: '+err));});});
}

test('separate service processes return one durable receipt for a concurrent management change',async t=>{
  const f=await fixture(t),input=f.metadata(),[one,two]=await Promise.all([worker(f,input),worker(f,input)]);assert.equal(one.id,two.id);assert.equal(await f.db.userAccountOperation.count(),1);assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).adminNote,'Follow up');
});

test('a concurrent action and conclusion across processes share exactly one final outcome',async t=>{
  const f=await fixture(t),input=f.metadata(),[one,two]=await Promise.all([worker(f,input),worker(f,input,'resolve')]);assert.deepEqual(one,two);assert.ok(['APPLIED','NOT_APPLIED'].includes(one.outcome));assert.equal(await f.db.userAccountOperation.count(),1);assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).adminNote,one.outcome==='APPLIED'?'Follow up':'');
});
