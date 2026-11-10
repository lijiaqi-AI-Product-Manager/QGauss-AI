import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectScope,reactive,ref} from 'vue';
import {useUserAccountControls} from '../src/composables/useUserAccountControls.js';
import {managementPayload,readManagementIntent,managementReceipt,loginSessionPage,deviceLabel} from '../src/lib/user-account-controls.js';
import {CONTROL_MESSAGES,controlText} from '../src/i18n/user-account-messages.js';

const at='2026-01-01T00:00:00.000Z',later='2026-01-01T00:00:01.000Z',version='a'.repeat(64),otherVersion='b'.repeat(64);
const person=(id='reader')=>({id,username:id,email:id+'@qgauss.test',updatedAt:at,adminNote:'Original context',isDistribution:false,distributionAccountReady:true});
function memory(){const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key),map};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function receipt(intent,extra={}){const result={id:'uma-receipt-0001',kind:intent.kind,requestKey:intent.payload.requestKey,userId:intent.target.id,target:intent.target,actor:{id:intent.actorId},createdAt:later,changed:true,outcome:'APPLIED',...extra};if(result.outcome==='NOT_APPLIED')return{...result,changed:false};return intent.kind==='metadata'?{...result,after:{adminNote:intent.payload.adminNote??intent.before.adminNote,isDistribution:intent.payload.isDistribution??intent.before.isDistribution,updatedAt:later}}:{...result,endedCount:intent.kind==='session'?1:intent.count,scope:intent.payload.scope,...(intent.kind==='session'?{sessionId:intent.payload.sessionId}:{})};}
function sessionPage(user,page=1,extra={}){return{userId:user.id,user:{id:user.id,username:user.username,email:user.email,updatedAt:user.updatedAt},page,pageSize:8,asOf:at,readAt:at,total:1,activeTotal:1,otherTotal:1,revision:version,otherRevision:otherVersion,items:[{id:'login-family',revision:version,createdAt:at,lastSeenAt:at,expiresAt:later,ip:'192.0.2.10',userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',isCurrent:false}],...extra};}
function fixture(t,options={}){
  const user=ref(options.person||person()),selectedId=ref(user.value.id),auth=options.auth||reactive({isLoggedIn:true,user:{id:options.self?user.value.id:'operator',role:options.role||'ADMIN'},identityRevision:1}),storage=options.storage||memory(),calls=[],changes=[],externalBusy=ref(false),externalPending=ref(false);let f,counter=0;
  const call=async(method,path,body,config)=>{calls.push({method,path,body:body&&structuredClone(body),signal:config?.signal});if(options.request)return options.request({method,path,body,config},f);if(method==='get'){const url=new URL(path,'https://qgauss.test');return sessionPage(user.value,Number(url.searchParams.get('page')||1));}return receipt(f.model.review.value,path.endsWith('/resolve')?{outcome:'NOT_APPLIED'}:{});};
  const client={get:(path,config)=>call('get',path,undefined,config),post:(path,body,config)=>call('post',path,body,config),patch:(path,body,config)=>call('patch',path,body,config)},scope=effectScope();
  const model=scope.run(()=>useUserAccountControls({user,selectedId,self:!!options.self,client,auth,storage,externalBusy,externalPending,key:()=> 'operation-key-'+String(++counter).padStart(5,'0'),openUser:async id=>{if(options.openUser)return options.openUser(id,f);if(user.value.id!==id)user.value=person(id);selectedId.value=id;return true;},onChanged:async id=>{changes.push(id);if(options.changed)await options.changed(id,f);}}));
  f={model,user,selectedId,auth,storage,calls,changes,scope,externalBusy,externalPending};t.after(()=>scope.stop());return f;
}
function reviewNote(f,value='New context'){assert.equal(f.model.openEditor(),true);f.model.draft.adminNote=value;assert.equal(f.model.reviewMetadata(),true);return f.model.review.value;}

test('operation payloads preserve false and empty notes while rejecting coercion and extra fields',()=>{
  const input={expectedUpdatedAt:at,requestKey:'operation-key-00001',adminNote:' ',isDistribution:false},body=managementPayload('metadata',input);assert.equal(body.adminNote,'');assert.equal(body.isDistribution,false);assert.equal(Object.isFrozen(body),true);
  for(const delta of [{adminNote:4},{adminNote:'x'.repeat(2001)},{adminNote:'x\0y'},{isDistribution:'false'},{role:'ADMIN'},{requestKey:'short'},{expectedUpdatedAt:'bad'}])assert.throws(()=>managementPayload('metadata',{...input,...delta}));
  const action={scope:'one',sessionId:'family',expectedRevision:version,expectedUpdatedAt:at,requestKey:input.requestKey};assert.equal(managementPayload('session',action).sessionId,'family');assert.throws(()=>managementPayload('all',action));assert.throws(()=>managementPayload('others',{...action,scope:'others'}));
});

test('saved reviews retain their original identity and values and never cross account boundaries',()=>{
  const intent={actorId:'operator',state:'uncertain',kind:'metadata',target:person(),before:{adminNote:'Before',isDistribution:true},payload:{expectedUpdatedAt:at,requestKey:'operation-key-00001',adminNote:'After'}},read=readManagementIntent(JSON.stringify(intent),'operator');assert.equal(read.before.adminNote,'Before');assert.equal(read.payload.adminNote,'After');assert.equal(readManagementIntent(intent,'another'),null);assert.equal(readManagementIntent({...intent,payload:{...intent.payload,extra:true}},'operator'),null);
  assert.equal(managementReceipt(receipt(read),read),true);for(const delta of [{userId:'another'},{target:{id:'another'}},{actor:{id:'another'}},{requestKey:'another-operation-key'},{outcome:'UNKNOWN'},{after:{adminNote:'wrong',updatedAt:later}}])assert.equal(managementReceipt({...receipt(read),...delta},read),false);assert.equal(managementReceipt(receipt(read,{outcome:'NOT_APPLIED'}),read),true);
});

test('session response checks protect identity, scope and required timestamps',()=>{
  const data=sessionPage(person());assert.equal(loginSessionPage(data,'reader',1),data);for(const delta of [{userId:'another'},{user:{...data.user,id:'another'}},{revision:'invalid'},{otherRevision:'invalid'},{otherTotal:2},{items:[{...data.items[0],isCurrent:1}]},{items:[{...data.items[0],expiresAt:''}]}])assert.throws(()=>loginSessionPage({...data,...delta},'reader',1));
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Edg/130.0'),'Edge · Windows');assert.equal(deviceLabel('Mozilla/5.0 (iPhone) Safari/17.0'),'Safari · iOS');assert.equal(deviceLabel(''), '');
});

test('new account controls have complete English and Traditional Chinese messages with matching placeholders',()=>{
  for(const [key,row]of Object.entries(CONTROL_MESSAGES)){assert.equal(row.length,2);for(const text of row){assert.ok(text.length);assert.deepEqual((text.match(/\{\w+\}/g)||[]).sort(),(key.match(/\{\w+\}/g)||[]).sort());}assert.equal(controlText('zh',key),key);}assert.equal(controlText('en','{count} 次有效登录',{count:3}),'3 active sign-ins');
});

test('editing and reviewing sends nothing until the frozen action is confirmed',async t=>{
  const f=fixture(t),intent=reviewNote(f);assert.equal(f.calls.length,0);f.model.draft.adminNote='Later unsaved edit';assert.equal(await f.model.confirm(),true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'patch');assert.equal(f.calls[0].body.adminNote,intent.payload.adminNote);assert.equal(f.model.pending.value,null);assert.equal(f.model.receipt.value.userId,'reader');assert.deepEqual(f.changes,['reader']);
});

test('an enabled qualification with a missing referral account can be reviewed for preparation',async t=>{
  const f=fixture(t,{person:{...person(),isDistribution:true,distributionAccountReady:false}});assert.equal(f.model.openEditor(),true);assert.equal(f.model.reviewMetadata(),true);assert.equal(f.model.review.value.payload.isDistribution,true);assert.equal(Object.hasOwn(f.model.review.value.payload,'adminNote'),false);assert.equal(await f.model.confirm(),true);
});

test('storage failure stops the write before the request is sent',async t=>{
  const f=fixture(t,{storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});reviewNote(f);assert.equal(await f.model.confirm(),false);assert.equal(f.calls.length,0);assert.equal(f.model.pending.value,null);assert.match(f.model.error.value,/浏览器存储/);
});

test('double confirmation submits once and stores the original intent before sending',async t=>{
  const waiting=deferred(),f=fixture(t,{request:()=>waiting.promise}),intent=reviewNote(f),one=f.model.confirm();assert.equal(f.model.busy.value,true);assert.equal(f.calls.length,1);assert.equal(readManagementIntent(f.storage.getItem('qg:user-management-action:operator'),'operator').payload.requestKey,intent.payload.requestKey);assert.equal(await f.model.confirm(),false);waiting.resolve(receipt(intent));assert.equal(await one,true);assert.equal(f.calls.length,1);
});

test('unknown results keep the original action after a later permission rejection',async t=>{
  let attempt=0;const f=fixture(t,{request:()=>{throw ++attempt===1?Error('connection lost'):Object.assign(Error('forbidden'),{status:403});}}),intent=reviewNote(f);assert.equal(await f.model.confirm(),false);assert.equal(f.model.pending.value.state,'uncertain');assert.equal(await f.model.confirm(),false);assert.equal(f.model.pending.value.state,'uncertain');assert.equal(await f.model.revise(),false);assert.equal(f.model.dismissRejected(),false);assert.deepEqual(f.calls[0].body,f.calls[1].body);assert.equal(f.model.pending.value.payload.requestKey,intent.payload.requestKey);
});

test('original reviews survive a remount and recover the accepted receipt',async t=>{
  const storage=memory(),first=fixture(t,{storage,request:()=>{throw Error('lost');}}),intent=reviewNote(first);await first.model.confirm();first.scope.stop();
  const second=fixture(t,{storage,person:{...person(),adminNote:'Already changed',updatedAt:later},request:()=>receipt(intent)});assert.equal(second.model.pending.value.payload.expectedUpdatedAt,at);await second.model.resume();assert.equal(second.model.review.value.before.adminNote,'Original context');assert.equal(await second.model.confirm(),true);assert.equal(second.calls[0].body.requestKey,intent.payload.requestKey);assert.equal(storage.getItem('qg:user-management-action:operator'),null);
});

test('a definitive conflict keeps only the edited fields when refreshing the baseline',async t=>{
  const f=fixture(t,{request:()=>{throw Object.assign(Error('conflict'),{status:409});},openUser:async(_id,target)=>{target.user.value={...person(),isDistribution:true,updatedAt:later};return true;}});reviewNote(f,'Keep my note');await f.model.confirm();assert.equal(f.model.pending.value.state,'rejected');assert.equal(await f.model.revise(),true);assert.equal(f.model.draft.adminNote,'Keep my note');assert.equal(f.model.draft.isDistribution,true);assert.equal(f.model.reviewMetadata(),true);assert.equal(f.model.review.value.payload.expectedUpdatedAt,later);assert.equal(Object.hasOwn(f.model.review.value.payload,'isDistribution'),false);
});

test('known success is retained even if refreshing the screen fails',async t=>{
  const f=fixture(t,{changed:()=>{throw Error('reload failed');}});reviewNote(f);assert.equal(await f.model.confirm(),true);assert.equal(f.model.pending.value,null);assert.equal(f.model.panel.value,'done');assert.equal(f.model.receipt.value.outcome,'APPLIED');
});

test('a late result cannot become a receipt for a different selected person',async t=>{
  const waiting=deferred(),f=fixture(t,{request:()=>waiting.promise}),intent=reviewNote(f),running=f.model.confirm();f.user.value=person('second');f.selectedId.value='second';waiting.resolve(receipt(intent));assert.equal(await running,true);assert.equal(f.model.receipt.value,null);assert.equal(f.model.panel.value,'closed');assert.deepEqual(f.changes,['reader']);
});

test('an identity change hides old results but keeps the original actor record recoverable',async t=>{
  const waiting=deferred(),f=fixture(t,{request:()=>waiting.promise}),intent=reviewNote(f),running=f.model.confirm();f.auth.user={id:'second-admin',role:'ADMIN'};f.auth.identityRevision++;waiting.resolve(receipt(intent));assert.equal(await running,false);assert.equal(f.model.receipt.value,null);assert.equal(f.model.pending.value,null);assert.ok(readManagementIntent(f.storage.getItem('qg:user-management-action:operator'),'operator'));assert.equal(f.storage.getItem('qg:user-management-action:second-admin'),null);
});

test('concluding an uncertain action sends its original payload and accepts only the matching outcome',async t=>{
  let first=true;const f=fixture(t,{request:({path},target)=>{if(first){first=false;throw Error('lost');}assert.ok(path.endsWith('/account-actions/resolve'));return receipt(target.model.review.value,{outcome:'NOT_APPLIED'});}}),intent=reviewNote(f);await f.model.confirm();f.model.draft.adminNote='Different draft';assert.equal(await f.model.finish(),true);assert.deepEqual(f.calls[1].body,{kind:'metadata',payload:intent.payload});assert.equal(f.model.pending.value,null);assert.equal(f.model.receipt.value.outcome,'NOT_APPLIED');assert.equal(f.model.receiptTarget.value.id,'reader');
});

test('concluding an already-applied action retains the original applied receipt',async t=>{
  let first=true;const f=fixture(t,{request:(_call,target)=>{if(first){first=false;throw Error('lost');}return receipt(target.model.review.value);}});reviewNote(f);await f.model.confirm();assert.equal(await f.model.finish(),true);assert.equal(f.model.receipt.value.outcome,'APPLIED');assert.equal(f.model.notice.value,'账户操作已完成，凭据已保存');
});

test('an incomplete receipt stays unresolved and cannot unlock a replacement action',async t=>{
  const f=fixture(t,{request:()=>({id:'wrong',outcome:'APPLIED'})});reviewNote(f);await f.model.confirm();assert.equal(f.model.pending.value.state,'uncertain');assert.equal(f.model.openEditor(),false);assert.equal(await f.model.openSessions(),false);assert.equal(f.calls.length,1);assert.equal(f.model.receipt.value,null);
});

test('stale session reads cannot overwrite the newly selected person',async t=>{
  const first=deferred(),second=deferred();let n=0;const f=fixture(t,{request:()=>++n===1?first.promise:second.promise}),old=f.model.openSessions();f.user.value=person('second');f.selectedId.value='second';const recent=f.model.openSessions();second.resolve(sessionPage(f.user.value));assert.equal(await recent,true);first.resolve(sessionPage(person()));assert.equal(await old,false);assert.equal(f.model.sessions.value.userId,'second');
});

test('failed session pages retain the displayed page and retry the actual failed page',async t=>{
  let fail=true;const f=fixture(t,{request:({path},target)=>{const page=Number(new URL(path,'https://qgauss.test').searchParams.get('page'));if(page===2&&fail){fail=false;throw Error('failed page');}return sessionPage(target.user.value,page,{total:10,activeTotal:10,otherTotal:10,items:page===1?Array.from({length:8},(_,i)=>({...sessionPage(person()).items[0],id:'family-'+i})): [{...sessionPage(person()).items[0],id:'family-nine'}]});}});await f.model.openSessions();assert.equal(await f.model.loadSessions(2),false);assert.equal(f.model.sessionPage.value,1);assert.equal(f.model.sessions.value.items[0].id,'family-0');assert.equal(await f.model.retrySessions(),true);assert.equal(f.model.sessionPage.value,2);assert.equal(f.model.sessions.value.items[0].id,'family-nine');
});

test('reviewing all sign-ins refreshes the scope before freezing its confirmation',async t=>{
  let reads=0;const f=fixture(t,{request:(_call,target)=>sessionPage(target.user.value,1,{activeTotal:++reads,otherTotal:reads,revision:reads===1?version:otherVersion})});await f.model.openSessions();assert.equal(await f.model.reviewAll(),true);assert.equal(f.model.review.value.count,2);assert.equal(f.model.review.value.payload.expectedRevision,otherVersion);assert.equal(f.calls.length,2);assert.ok(!new URL(f.calls[1].path,'https://qgauss.test').searchParams.has('asOf'));
});

test('own sign-ins use owner endpoints and cannot edit management data or end the current sign-in',async t=>{
  const f=fixture(t,{self:true,role:'USER',request:({method},target)=>method==='get'?sessionPage(target.user.value,1,{activeTotal:2,otherTotal:1,items:[{...sessionPage(person()).items[0],isCurrent:true}]}):receipt(target.model.review.value)});assert.equal(f.model.openEditor(),false);await f.model.openSessions();assert.ok(f.calls[0].path.startsWith('/users/sessions?'));assert.equal(f.model.reviewSession(f.model.sessions.value.items[0]),false);assert.equal(await f.model.reviewAll(),false);assert.equal(await f.model.reviewOthers(),true);assert.equal(f.model.review.value.payload.scope,'others');assert.equal(await f.model.confirm(),true);assert.equal(f.calls.at(-1).path,'/users/session-actions');assert.equal(f.model.receipt.value.kind,'others');
});

test('new actions respect other ongoing account operations and ordinary administrative access is denied',async t=>{
  const f=fixture(t);f.externalBusy.value=true;assert.equal(f.model.openEditor(),false);f.externalBusy.value=false;f.externalPending.value=true;assert.equal(f.model.openEditor(),false);const ordinary=fixture(t,{role:'USER'});assert.equal(ordinary.model.openEditor(),false);assert.equal(await ordinary.model.openSessions(),false);assert.equal(ordinary.calls.length,0);
});
