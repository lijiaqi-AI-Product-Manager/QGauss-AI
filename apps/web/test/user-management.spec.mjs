import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectScope,reactive} from 'vue';
import {useUserManagement} from '../src/composables/useUserManagement.js';
import {USER_FILTERS,userSearch,grantPayload,grantCents,readGrant,userDetail} from '../src/lib/user-management.js';
import {USER_MESSAGES,userText} from '../src/i18n/user-messages.js';
const at='2026-01-02T00:00:00.000Z';
const person=(id='reader')=>({id,username:id,email:id+'@qgauss.test',displayName:'Literal <script>text</script>',role:'USER',status:'ACTIVE',createdAt:at,updatedAt:at});
const details=(id='reader')=>({...person(id),counts:Object.fromEntries(['model3','model4','drawMj','agent'].map(key=>[key,{paid:0,member:0,reserved:0}])),balanceCents:0,isMember:false,expirationTime:null,activity:{grants:0,logins:0,conversations:0},readAt:at});
const page=(items=[person()],number=1,total=items.length)=>({items,total,active:total,admins:0,page:number,pageSize:20,asOf:at});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const memory=()=>{const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
function fixture(t,options={}){
 const scope=effectScope(),auth=reactive({isLoggedIn:true,identityRevision:1,user:{id:'operator',role:'ADMIN'}}),storage=options.storage??memory(),calls=[];
 const standard=path=>{if(path.startsWith('/users?'))return page();const url=new URL(path,'https://qgauss.test'),parts=url.pathname.split('/');return parts[3]==='activity'?{items:[],total:0,page:Number(url.searchParams.get('page')),pageSize:10,kind:url.searchParams.get('kind'),userId:parts[2]}:details(parts[2]);};
 const client={get:async(path,settings)=>{calls.push({method:'GET',path,settings});return options.get?options.get(path,settings,standard):standard(path);},post:async(path,payload,settings)=>{calls.push({method:'POST',path,payload,settings});return options.post?options.post(path,payload,settings):{...payload,id:'receipt-one',uid:'admin-one',rechargeType:'admin',amountCents:grantCents(payload)};},patch:async(path,payload,settings)=>{calls.push({method:'PATCH',path,payload,settings});return options.patch?options.patch(path,payload,settings):{id:path.split('/')[2],...payload};}};
 const users=scope.run(()=>useUserManagement({client,auth,storage,key:options.key||(()=> 'original-request-0001')}));t.after(()=>scope.stop());return{scope,auth,storage,calls,users};
}
async function review(f){await f.users.openDetail('reader');assert.equal(f.users.editGrant(),true);f.users.grantForm.model3Count=3;f.users.grantForm.amountYuan='12.34';assert.equal(f.users.reviewGrant(),true);}

test('user search preserves literal wildcard text and whole local calendar days',()=>{
 const query=userSearch({...USER_FILTERS,keyword:' 100%_ ',from:'2026-01-02',to:'2026-01-02'});assert.equal(query.keyword,'100%_');assert.equal(new Date(query.from).getHours(),0);assert.equal(new Date(query.to).getMilliseconds(),999);assert.throws(()=>userSearch({...USER_FILTERS,from:'2026-02-31'}));assert.throws(()=>userSearch({...USER_FILTERS,from:'2026-02-02',to:'2026-02-01'}));
});
test('newest search wins while draft edits cannot change already applied pagination',async t=>{
 const one=deferred(),two=deferred();let count=0;const f=fixture(t,{get:path=>++count===1?one.promise:count===2?two.promise:page([person()],2,21)});
 const first=f.users.search();f.users.filters.keyword='applied';const second=f.users.search();two.resolve(page([person('new')],1,21));await second;one.resolve(page([person('old')]));await first;assert.equal(f.users.rows.value[0].id,'new');assert.equal(f.calls[0].settings.signal.aborted,true);
 f.users.filters.keyword='draft';assert.equal(f.users.dirty.value,true);await f.users.goPage(2);assert.equal(new URL(f.calls.at(-1).path,'https://qgauss.test').searchParams.get('keyword'),'applied');assert.equal(f.users.page.value,2);
});
test('failed user pagination keeps the visible results and retries the failed page',async t=>{
 let count=0;const f=fixture(t,{get:path=>{if(++count===2)throw Error('offline');return page([person()],Number(new URL(path,'https://qgauss.test').searchParams.get('page')),21);}});await f.users.search();await f.users.goPage(2);assert.equal(f.users.page.value,1);assert.equal(f.users.rows.value.length,1);assert.ok(f.users.error.value);await f.users.retry();assert.equal(f.users.page.value,2);
});
test('a shrinking list clamps to its last page without including users created after the search',async t=>{
 let count=0;const f=fixture(t,{get:path=>{const target=Number(new URL(path,'https://qgauss.test').searchParams.get('page'));return page(target===2?[]:[person()],target,++count===1?21:1);}});await f.users.search();await f.users.goPage(2);assert.equal(f.users.page.value,1);assert.equal(f.users.total.value,1);assert.equal(new URL(f.calls.at(-1).path,'https://qgauss.test').searchParams.get('asOf'),at);
});
test('closed or superseded person requests cannot populate another selected user',async t=>{
 const one=deferred(),two=deferred(),f=fixture(t,{get:(path,_settings,standard)=>path==='/users/one'?one.promise:path==='/users/two'?two.promise:standard(path)});
 const first=f.users.openDetail('one'),second=f.users.openDetail('two');two.resolve(details('two'));await second;one.resolve(details('one'));await first;assert.equal(f.users.detail.value.id,'two');f.users.closeDetail();assert.equal(f.users.detail.value,null);assert.equal(f.users.selectedId.value,'');
});
test('typed user detail refuses incomplete balance and identity data before a grant can be reviewed',async t=>{
 assert.throws(()=>userDetail({...details(),counts:{}},'reader'));const f=fixture(t,{get:()=>({...details(),id:'other'})});await f.users.openDetail('reader');assert.equal(f.users.detail.value,null);assert.equal(f.users.editGrant(),false);assert.ok(f.users.detailError.value);
});
test('a detail superseded during its activity read cannot trigger an edit for the next person',async t=>{
 const gate=deferred(),f=fixture(t,{get:(path,_settings,standard)=>path.startsWith('/users/one/activity')?gate.promise:standard(path)});
 const first=f.users.openDetail('one');await new Promise(done=>setImmediate(done));await f.users.openDetail('two');gate.resolve({items:[],total:0,page:1,pageSize:10,kind:'grants',userId:'one'});assert.equal(await first,false);assert.equal(f.users.detail.value.id,'two');
});
test('activity failure keeps the visible page and retries the failed target page',async t=>{
 let failed=false;const f=fixture(t,{get:(path,_settings,standard)=>{if(!path.includes('/activity'))return standard(path);const data=standard(path);if(data.page===2&&!failed){failed=true;throw Error('offline');}return{...data,total:11,items:[{id:'receipt-'+data.page}]};}});await f.users.openDetail('reader');await f.users.loadActivity('grants',2);assert.equal(f.users.activityPage.value,1);assert.ok(f.users.activityError.value);await f.users.retryActivity();assert.equal(f.users.activityPage.value,2);assert.equal(f.users.activity.value[0].id,'receipt-2');
});
test('activity kinds and pages keep the selected detail creation bound',async t=>{
 const f=fixture(t);await f.users.openDetail('reader');await f.users.loadActivity('logins',2);const calls=f.calls.filter(call=>call.path.includes('/activity?'));assert.ok(calls.length>=2);for(const call of calls)assert.equal(new URL(call.path,'https://qgauss.test').searchParams.get('asOf'),at);
});
test('late activity cannot replace a different kind or a different user',async t=>{
 const gate=deferred(),f=fixture(t,{get:(path,_settings,standard)=>path.includes('kind=logins')?gate.promise:standard(path)});await f.users.openDetail('reader');const request=f.users.loadActivity('logins');await f.users.loadActivity('conversations');gate.resolve({items:[{id:'private-login'}],total:1,userId:'reader',kind:'logins',page:1,pageSize:10});await request;assert.equal(f.users.activityKind.value,'conversations');assert.deepEqual(f.users.activity.value,[]);
});
test('grant amounts use integer cents, reject empty or fractional counts, and freeze the reviewed recipient',async t=>{
 const f=fixture(t);await review(f);const original=f.users.grantReview.value.payload;f.users.grantForm.model3Count=100;assert.equal(original.model3Count,3);assert.equal(grantCents(original),1234);assert.equal(Object.isFrozen(original),true);
 assert.throws(()=>grantPayload({...f.users.grantForm,model3Count:1.5},details()));assert.throws(()=>grantPayload({model3Count:0,model4Count:0,drawMjCount:0,agentCount:0,days:0,amountYuan:'0'},details()));
});
test('grant confirmation persists before sending and blocks duplicate clicks',async t=>{
 const gate=deferred();let sent;const f=fixture(t,{post:(_path,payload)=>{sent=payload;assert.equal(readGrant(f.storage.getItem('qg:user-grant:operator'),'operator').payload.requestKey,payload.requestKey);return gate.promise;}});await review(f);const pending=f.users.confirmGrant();assert.equal(await f.users.confirmGrant(),false);assert.equal(f.calls.filter(row=>row.method==='POST').length,1);gate.resolve({...sent,id:'receipt-one',uid:'admin-one',rechargeType:'admin',amountCents:1234});await pending;assert.equal(f.users.pending.value,null);assert.equal(f.users.receipt.value.uid,'admin-one');assert.equal(f.storage.getItem('qg:user-grant:operator'),null);
});
test('an uncertain grant survives a page remount and retries exactly the saved payload',async t=>{
 const storage=memory(),first=fixture(t,{storage,post:()=>{throw Error('network response lost');}});await review(first);const original={...first.users.grantReview.value.payload};await first.users.confirmGrant();assert.equal(first.users.pending.value.state,'uncertain');assert.equal(first.users.backToEdit(),false);first.scope.stop();
 const second=fixture(t,{storage});assert.deepEqual({...second.users.pending.value.payload},original);await second.users.resumeGrant();await second.users.confirmGrant();assert.deepEqual(second.calls.find(row=>row.method==='POST').payload,original);assert.equal(second.users.pending.value,null);
});
test('unavailable storage prevents sending and an invalid success response remains uncertain',async t=>{
 const blocked=fixture(t,{storage:{getItem:()=>null,setItem:()=>{throw Error('blocked');}}});await review(blocked);await blocked.users.confirmGrant();assert.equal(blocked.calls.filter(row=>row.method==='POST').length,0);
 const incomplete=fixture(t,{post:()=>({ok:true})});await review(incomplete);await incomplete.users.confirmGrant();assert.equal(incomplete.users.pending.value.state,'uncertain');assert.ok(incomplete.users.mutationError.value);
});
test('a completed grant cannot appear in another person detail opened while the request was pending',async t=>{
 const gate=deferred();let payload;const f=fixture(t,{post:(_path,value)=>{payload=value;return gate.promise;}});await review(f);const pending=f.users.confirmGrant();await f.users.openDetail('other-person');gate.resolve({...payload,id:'receipt',uid:'admin-one',rechargeType:'admin',amountCents:1234});await pending;assert.equal(f.users.detail.value.id,'other-person');assert.equal(f.users.receipt.value,null);assert.equal(f.users.grantStage.value,'closed');assert.equal(f.users.pending.value,null);
});
test('a definite rejection allows editing with a fresh request while preserving the original form values',async t=>{
 let version=0;const f=fixture(t,{key:()=> 'request-version-'+String(++version).padStart(8,'0'),post:()=>{throw Object.assign(Error('changed'),{status:409});}});await review(f);const original=f.users.grantReview.value.payload.requestKey;await f.users.confirmGrant();assert.equal(f.users.pending.value.state,'rejected');assert.equal(f.users.backToEdit(),true);assert.equal(f.users.grantForm.model3Count,3);assert.equal(f.users.grantForm.amountYuan,'12.34');f.users.reviewGrant();assert.notEqual(f.users.grantReview.value.payload.requestKey,original);
});
test('a later permission or commerce rejection cannot erase an earlier unknown grant outcome',async t=>{
 let attempts=0;const f=fixture(t,{post:()=>{if(++attempts===1)throw Error('response lost');throw Object.assign(Error('commerce disabled'),{status:404});}});await review(f);await f.users.confirmGrant();await f.users.confirmGrant();assert.equal(f.users.pending.value.state,'uncertain');assert.equal(f.users.backToEdit(),false);assert.equal(f.users.dismissRejected(),false);
});
test('an explicitly rejected first request can be closed even if its recipient was removed',async t=>{
 const f=fixture(t,{post:()=>{throw Object.assign(Error('removed'),{status:404});}});await review(f);await f.users.confirmGrant();f.users.closeDetail();assert.equal(f.users.dismissRejected(),true);assert.equal(f.users.pending.value,null);assert.equal(f.storage.getItem('qg:user-grant:operator'),null);
});
test('changing account or losing role clears private data and never applies a late grant receipt',async t=>{
 const gate=deferred();let payload;const f=fixture(t,{post:(_path,value)=>{payload=value;return gate.promise;}});await f.users.search();await review(f);const pending=f.users.confirmGrant();f.auth.user.role='USER';assert.equal(f.users.detail.value,null);assert.equal(f.users.rows.value.length,0);gate.resolve({...payload,id:'receipt',uid:'admin-one',rechargeType:'admin',amountCents:1234});await pending;assert.equal(f.users.receipt.value,null);assert.equal(f.users.notice.value,'');assert.ok(readGrant(f.storage.getItem('qg:user-grant:operator'),'operator'));assert.equal(readGrant(f.storage.getItem('qg:user-grant:operator'),'another-operator'),null);
});
test('status changes review a stable user version, block duplicate submission and protect the current administrator',async t=>{
 const gate=deferred(),f=fixture(t,{patch:()=>gate.promise});await f.users.openDetail('reader');assert.equal(f.users.reviewStatus(),true);const pending=f.users.confirmStatus();assert.equal(await f.users.confirmStatus(),false);const call=f.calls.find(row=>row.method==='PATCH');assert.deepEqual(call.payload,{status:'DISABLED',expectedUpdatedAt:at});gate.resolve({id:'reader',status:'DISABLED'});await pending;assert.equal(f.users.statusReview.value,null);
 await f.users.openDetail('operator');assert.equal(f.users.reviewStatus(),false);
});
test('all added copy has English and Traditional Chinese while interpolation preserves literal recipient text',()=>{
 for(const [text,[tw,en]] of Object.entries(USER_MESSAGES)){assert.ok(tw,text);assert.ok(en,text);assert.ok(!/[\u3400-\u9fff]/.test(en),text);assert.deepEqual([...tw.matchAll(/\{(\w+)\}/g)].map(row=>row[1]),[...text.matchAll(/\{(\w+)\}/g)].map(row=>row[1]));}
 assert.equal(userText('en','注册于 {date}',{date:'{date} $& <literal>'}),'Joined {date} $& <literal>');assert.equal(userText('zh-TW','禁用账号'),'停用帳號');
});
