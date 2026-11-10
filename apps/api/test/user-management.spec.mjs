import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {UsersService} from '../dist/modules/users/users.service.js';
import {UsersController} from '../dist/modules/users/users.controller.js';
import {userQuery,activityQuery} from '../dist/modules/users/users.query.js';
import {LedgerService,shanghaiDate} from '../dist/modules/commerce/ledger.service.js';
import {WalletService} from '../dist/modules/commerce/wallet.service.js';
const folder=mkdtempSync(join(tmpdir(),'qgauss-people-')),base=join(folder,'base.db'),here=dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe',windowsHide:true});
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
const rejects=status=>error=>error.getStatus?.()===status;
async function fixture(t){const path=join(folder,randomUUID()+'.db');copyFileSync(base,path);const db=new SqliteClient({datasources:{db:{url:'file:'+path}}});await db.$connect();t.after(()=>db.$disconnect());
 const admin=await db.user.create({data:{username:'operator',email:'operator@qgauss.test',role:'ADMIN',passwordHash:'private hash'}}),user=await db.user.create({data:{username:'reader',email:'reader@qgauss.test',passwordHash:'private hash',tokenVersion:8,updatedAt:new Date('2026-01-01T00:00:00Z')}});
 const ledger=new LedgerService(db),service=new UsersService(db,{tryConsume:()=>true}),wallet=new WalletService(db,ledger,{get:async()=>true});
 return {db,admin,user,ledger,service,wallet,payload:(extra={})=>({userId:user.id,model3Count:3,requestKey:randomUUID(),expectedUpdatedAt:user.updatedAt.toISOString(),...extra})};}

test('user filters reject structured values, unsupported fields, invalid dates and unsafe paging',()=>{
 for(const q of [{keyword:['a','b']},{email:null},{role:'SUPER'},{status:'PENDING'},{distribution:'1'},{page:'1e3'},{page:2},{pageSize:'101'},{from:'2026-02-31'},{from:'2026-02-01',to:'2026-01-01'},{asOf:'9999-01-01'},{passwordHash:'x'}])assert.throws(()=>userQuery(q),rejects(400));
 for(const q of [{kind:'private'},{kind:['logins']},{pageSize:'51'},{unknown:'x'}])assert.throws(()=>activityQuery(q),rejects(400));
 assert.equal(userQuery({keyword:'  100%_  '}).keyword,'100%_');
});
test('keyword, independent identity filters, role, status and distribution intersect literally',async t=>{
 const f=await fixture(t);await f.db.user.update({where:{id:f.user.id},data:{displayName:'100%_ready',isDistribution:true}});await f.db.user.create({data:{username:'reader-two',email:'other@qgauss.test',passwordHash:'private hash',displayName:'100XXready',status:'DISABLED'}});
 const result=await f.service.list({keyword:'100%_',username:'read',email:'reader@',role:'USER',status:'ACTIVE',distribution:'true'});
 assert.deepEqual(result.items.map(row=>row.id),[f.user.id]);assert.equal(result.total,1);assert.equal(result.active,1);assert.equal(result.admins,0);
 assert.equal((await f.service.list({keyword:'reader',status:'DISABLED',email:'reader@'})).total,0);assert.equal((await f.service.list({keyword:'missing@qgauss.test'})).total,0);
 assert.ok(!('passwordHash' in result.items[0]));assert.ok(!('tokenVersion' in result.items[0]));
});
test('equal timestamps have stable pages, exclude deleted users and preserve the initial creation bound',async t=>{
 const f=await fixture(t),createdAt=new Date('2026-01-01T00:00:00Z');for(const id of ['person-a','person-d','person-b','person-c'])await f.db.user.create({data:{id,username:id,email:id+'@qgauss.test',passwordHash:'x',createdAt}});
 await f.db.user.update({where:{id:'person-c'},data:{deletedAt:new Date()}});
 const first=await f.service.list({keyword:'person-',pageSize:'2'});await f.db.user.create({data:{id:'person-new',username:'person-new',email:'new@qgauss.test',passwordHash:'x',createdAt:new Date(Date.parse(first.asOf)+1000)}});
 const second=await f.service.list({keyword:'person-',pageSize:'2',page:'2',asOf:first.asOf});assert.deepEqual([...first.items,...second.items].map(row=>row.id),['person-d','person-b','person-a']);assert.equal(second.total,3);
});
test('details are read-only, show effective daily membership and omit secrets and private snapshots',async t=>{
 const f=await fixture(t);await f.ledger.grant(f.user.id,{model3Count:7,days:3,dailyModel3Count:5,extent:'private package snapshot',rechargeType:'admin'});await f.db.userBalance.update({where:{userId:f.user.id},data:{memberResetOn:'2000-01-01',memberModel3Count:1}});
 const before=await f.db.userBalance.findUnique({where:{userId:f.user.id}}),result=await f.service.detail(f.user.id);assert.equal(result.counts.model3.paid,7);assert.equal(result.counts.model3.member,5);assert.equal(result.balanceCents,0);assert.equal(result.activity.grants,1);assert.equal(result.isMember,true);
 assert.deepEqual(await f.db.userBalance.findUnique({where:{userId:f.user.id}}),before);for(const key of ['passwordHash','tokenVersion','extent','refreshTokens'])assert.ok(!(key in result));
 const record=(await f.service.activity(f.user.id,{kind:'grants'})).items[0];assert.ok(!('extent' in record));assert.equal(record.model3Count,7);
});
test('all detail sections are paged, scoped to the selected user and retain escaped literal content',async t=>{
 const f=await fixture(t);await f.db.userLoginLog.create({data:{userId:f.user.id,account:'private account',success:false,reason:'private reason',ip:'127.0.0.1',userAgent:'QGauss <script>literal</script>'}});await f.db.userLoginLog.create({data:{userId:f.admin.id,account:'operator',success:true}});
 const conversation=await f.db.conversation.create({data:{userId:f.user.id,title:'<img src=x onerror=alert(1)>',systemPrompt:'private instruction',params:'private parameters'}});
 const logs=await f.service.activity(f.user.id,{kind:'logins',pageSize:'1'});assert.equal(logs.total,1);assert.equal(logs.items.length,1);assert.ok(!('account' in logs.items[0]));assert.ok(!('reason' in logs.items[0]));
 const conversations=await f.service.activity(f.user.id,{kind:'conversations'});assert.equal(conversations.items[0].id,conversation.id);assert.equal(conversations.items[0].title,conversation.title);assert.ok(!('systemPrompt' in conversations.items[0]));assert.ok(!('params' in conversations.items[0]));
 await f.db.user.update({where:{id:f.user.id},data:{deletedAt:new Date()}});await assert.rejects(()=>f.service.detail(f.user.id),rejects(404));await assert.rejects(()=>f.service.activity(f.user.id),rejects(404));
});
test('new administrative detail and activity endpoints require the administrator role',()=>{
 for(const method of ['detail','activity','list','setStatus'])assert.deepEqual(Reflect.getMetadata('roles',UsersController.prototype[method]),['ADMIN']);
});
test('activity creation bounds keep new sign-ins from displacing subsequent pages',async t=>{
 const f=await fixture(t);for(const id of ['login-a','login-b','login-c'])await f.db.userLoginLog.create({data:{id,userId:f.user.id,account:'reader',success:true,createdAt:new Date('2026-01-01T00:00:00Z')}});
 const first=await f.service.activity(f.user.id,{kind:'logins',pageSize:'2'});await f.db.userLoginLog.create({data:{id:'login-new',userId:f.user.id,account:'reader',success:true,createdAt:new Date(Date.parse(first.asOf)+1000)}});
 const second=await f.service.activity(f.user.id,{kind:'logins',pageSize:'2',page:'2',asOf:first.asOf});assert.deepEqual([...first.items,...second.items].map(row=>row.id),['login-c','login-b','login-a']);assert.equal(second.total,3);
});
test('status confirmation preserves self protection, revokes credentials once and supports the original retry',async t=>{
 const f=await fixture(t);await f.db.refreshToken.create({data:{userId:f.user.id,familyId:'family',tokenHash:'hash',expiresAt:new Date(Date.now()+60000)}});
 await assert.rejects(()=>f.service.setStatus(f.admin.id,'DISABLED',f.admin.id),rejects(400));
 const changed=await f.service.setStatus(f.user.id,'DISABLED',f.admin.id,f.user.updatedAt.toISOString());assert.equal(changed.status,'DISABLED');assert.ok(!('tokenVersion' in changed));assert.ok((await f.db.refreshToken.findFirst()).revokedAt);
 const retry=await f.service.setStatus(f.user.id,'DISABLED',f.admin.id,f.user.updatedAt.toISOString());assert.equal(retry.status,'DISABLED');assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).tokenVersion,9);
 await assert.rejects(()=>f.service.setStatus(f.user.id,'ACTIVE',f.admin.id,f.user.updatedAt.toISOString()),rejects(409));
 await f.service.setStatus(f.user.id,'ACTIVE',f.admin.id,changed.updatedAt.toISOString());assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).status,'ACTIVE');
});
test('a failure while invalidating credentials rolls back the account status too',async t=>{
 const f=await fixture(t),proxy=new Proxy(f.db,{get(target,key){if(key==='$transaction')return callback=>target.$transaction(tx=>callback(new Proxy(tx,{get(inner,name){return name==='refreshToken'?{updateMany:async()=>{throw Error('forced revocation failure');}}:inner[name];}})));const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(()=>new UsersService(proxy,{}).setStatus(f.user.id,'DISABLED',f.admin.id),/forced revocation failure/);assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).status,'ACTIVE');assert.equal((await f.db.user.findUnique({where:{id:f.user.id}})).tokenVersion,8);
});
test('concurrent and repeated grant requests return one receipt and change every pool only once',async t=>{
 const f=await fixture(t),payload=f.payload({model4Count:4,drawMjCount:5,agentCount:6,days:7,amountYuan:'12.34',remark:'清晰的发放记录'});
 const results=await Promise.all([f.wallet.manualGrant(f.admin.id,payload),f.wallet.manualGrant(f.admin.id,payload)]);assert.equal(results[0].id,results[1].id);assert.equal(await f.db.accountLog.count(),1);
 const view=await f.ledger.view(f.user.id);assert.equal(view.paid.model3,3);assert.equal(view.paid.model4,4);assert.equal(view.paid.drawMj,5);assert.equal(view.paid.agent,6);assert.equal(view.balanceCents,1234);
 assert.equal((await f.wallet.manualGrant(f.admin.id,{...payload,amountYuan:12.34})).id,results[0].id);
});
test('a reused grant request cannot change recipient, counts, amount, membership or note',async t=>{
 const f=await fixture(t),payload=f.payload();await f.wallet.manualGrant(f.admin.id,payload);
 for(const delta of [{userId:f.admin.id},{model3Count:4},{amountYuan:'1.00'},{days:1},{remark:'different'},{extent:'different'},{packageId:'different'}])await assert.rejects(()=>f.wallet.manualGrant(f.admin.id,{...payload,...delta}),rejects(409));assert.equal(await f.db.accountLog.count(),1);
});
test('separate service processes share the same durable grant receipt and never duplicate credit',async t=>{
 const f=await fixture(t),file=(await f.db.$queryRawUnsafe('PRAGMA database_list')).find(row=>row.name==='main').file,payload=f.payload();
 const code=`const {SqliteClient}=await import(process.argv[1]),{LedgerService}=await import(process.argv[2]),{WalletService}=await import(process.argv[3]);const db=new SqliteClient({datasources:{db:{url:'file:'+process.argv[4]}}});try{const result=await new WalletService(db,new LedgerService(db),{}).manualGrant(process.argv[5],JSON.parse(process.argv[6]));process.stdout.write(JSON.stringify({id:result.id,uid:result.uid}));}finally{await db.$disconnect();}`;
 const args=['--input-type=module','-e',code,...['common/prisma/sqlite-client.js','modules/commerce/ledger.service.js','modules/commerce/wallet.service.js'].map(path=>pathToFileURL(resolve(here,'../dist',path)).href),file,f.admin.id,JSON.stringify(payload)];
 const run=()=>new Promise((done,fail)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();fail(Error('isolated grant worker timed out'));},30000);child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>err+=value);child.once('error',error=>{clearTimeout(timer);fail(error);});child.once('exit',code=>{clearTimeout(timer);if(code===0){try{done(JSON.parse(out));}catch(error){fail(error);}}else fail(Error('isolated grant worker failed: '+err));});});
 const [one,two]=await Promise.all([run(),run()]);assert.equal(one.id,two.id);assert.equal(one.uid,two.uid);assert.equal(await f.db.accountLog.count(),1);assert.equal((await f.ledger.view(f.user.id)).paid.model3,3);
});
test('receipt recovery survives profile changes and a disabled recipient but never a revoked administrator',async t=>{
 const f=await fixture(t),payload=f.payload(),log=await f.wallet.manualGrant(f.admin.id,payload);await f.db.user.update({where:{id:f.user.id},data:{displayName:'changed',status:'DISABLED'}});
 assert.equal((await f.wallet.manualGrant(f.admin.id,payload)).id,log.id);await f.db.user.update({where:{id:f.admin.id},data:{role:'USER'}});await assert.rejects(()=>f.wallet.manualGrant(f.admin.id,payload),rejects(403));assert.equal(await f.db.accountLog.count(),1);
});
test('new grants reject a changed, removed or disabled recipient before making a ledger change',async t=>{
 const f=await fixture(t),payload=f.payload();await f.db.user.update({where:{id:f.user.id},data:{displayName:'changed',updatedAt:new Date(f.user.updatedAt.getTime()+1000)}});await assert.rejects(()=>f.wallet.manualGrant(f.admin.id,payload),rejects(409));
 await f.db.user.update({where:{id:f.user.id},data:{status:'DISABLED'}});await assert.rejects(()=>f.wallet.manualGrant(f.admin.id,f.payload({expectedUpdatedAt:undefined})),rejects(409));
 await f.db.user.update({where:{id:f.user.id},data:{deletedAt:new Date()}});await assert.rejects(()=>f.wallet.manualGrant(f.admin.id,f.payload()),rejects(404));assert.equal(await f.db.accountLog.count(),0);assert.equal(await f.db.userBalance.count(),0);
});
test('grant validation and account limits cannot produce empty, negative, fractional or overflowing credits',async t=>{
 const f=await fixture(t);for(const delta of [{model3Count:0},{model3Count:-1},{model3Count:1.1},{model3Count:'3'},{days:-2},{days:36501},{amountYuan:'0.001'},{requestKey:'tiny'},{remark:{}},{unexpected:true}])await assert.rejects(()=>f.wallet.manualGrant(f.admin.id,f.payload(delta)),rejects(400));
 await f.ledger.ensure(f.user.id);await f.db.userBalance.update({where:{userId:f.user.id},data:{model3Count:2147483647}});await assert.rejects(()=>f.wallet.manualGrant(f.admin.id,f.payload()),rejects(400));assert.equal(await f.db.accountLog.count(),0);assert.equal((await f.db.userBalance.findUnique({where:{userId:f.user.id}})).model3Count,2147483647);
});
test('failed grant transactions leave no partial balance or receipt and the same request can be retried',async t=>{
 const f=await fixture(t),payload=f.payload(),failing={ensureTx:f.ledger.ensureTx.bind(f.ledger),grantTx:async(...args)=>{await f.ledger.grantTx(...args);throw Error('forced grant failure');}};
 await assert.rejects(()=>new WalletService(f.db,failing,{}).manualGrant(f.admin.id,payload),/forced grant failure/);assert.equal(await f.db.accountLog.count(),0);assert.equal(await f.db.userBalance.count(),0);
 await f.wallet.manualGrant(f.admin.id,payload);assert.equal(await f.db.accountLog.count(),1);assert.equal((await f.ledger.view(f.user.id)).paid.model3,3);
});
test('grants without a request key remain compatible and positive days preserve an existing lifetime term',async t=>{
 const f=await fixture(t);await f.wallet.manualGrant(f.admin.id,f.payload({requestKey:undefined,days:-1}));await f.wallet.manualGrant(f.admin.id,f.payload({requestKey:undefined,days:30}));
 assert.equal((await f.db.userBalance.findUnique({where:{userId:f.user.id}})).expirationTime.toISOString(),'9999-12-31T00:00:00.000Z');assert.equal(await f.db.accountLog.count(),2);assert.equal((await f.service.detail(f.user.id)).counts.model3.paid,6);
});
