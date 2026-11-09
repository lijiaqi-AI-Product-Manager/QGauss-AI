import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectScope,reactive,nextTick} from 'vue';
import {useChatAttachments} from '../src/composables/useChatAttachments.js';
import {personalFilesRevision} from '../src/composables/usePersonalFiles.js';
import {ATTACHMENT_MESSAGES} from '../src/i18n/attachment-messages.js';
import {chatText} from '../src/i18n/chat-messages.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const original=(name='原文件 {count} $&.txt',type='text/plain')=>new File(['QGauss local original'],name,{type});
const stored=(key='file',mime='text/plain')=>({status:'stored',version:1,file:{id:key,filename:'原文件 {count} $&.txt',mime,size:21,version:1}});
function fixture(t,{transfer,client,auth}={}){
 const owner=auth||reactive({isLoggedIn:true,identityRevision:1}),scope=effectScope(),requests=[],notices=[],revoked=[],created=[];let serial=0;
 const environment={crypto:{randomUUID(){return '00000000-0000-4000-8000-'+String(++serial).padStart(12,'0');}},URL:{createObjectURL(file){const url='blob:qgauss-'+serial;created.push({url,file});return url;},revokeObjectURL(url){revoked.push(url);}}};
 const queue=scope.run(()=>useChatAttachments({
  auth:owner,environment,notify:(...args)=>notices.push(args),
  transfer:transfer|| (async(file,key,version,options)=>{requests.push({file,key,version,signal:options.signal});return stored(key);}),
  client:client||{async get(){throw Object.assign(Error('No receipt'),{status:404});},async post(path,body){requests.push({path,body});return{items:body.ids.map(id=>({id,status:'available'}))};}}
 }));t.after(()=>scope.stop());return{queue,scope,owner,requests,notices,created,revoked};
}
test('adding attachments starts only upload transfers, preserves literal filenames and does not submit a chat',async t=>{
 const f=fixture(t),input=original();f.queue.add([input]);await tick();assert.equal(f.requests.length,1);assert.equal(f.requests[0].file,input);assert.equal(f.requests[0].version,0);assert.equal(f.queue.files.value[0].name,'原文件 {count} $&.txt');assert.equal(f.queue.files.value[0].status,'done');assert.equal(f.queue.files.value[0].canRetry,false);assert.equal(f.queue.readyFiles.value.length,1);assert.equal(f.queue.blocked.value,false);
});
test('three active uploads are bounded and a completed receipt releases the next queued file',async t=>{
 const calls=[],gates=[];const f=fixture(t,{transfer(file,key,version,options){const gate=deferred();gates.push(gate);calls.push({file,key,version,options});return gate.promise;}});f.queue.add(Array.from({length:5},(_,i)=>original('file-'+i+'.txt')));assert.equal(calls.length,3);assert.deepEqual(f.queue.files.value.map(file=>file.status),['uploading','uploading','uploading','queued','queued']);gates[0].resolve(stored('first'));await tick();assert.equal(calls.length,4);gates[1].resolve(stored('second'));await tick();assert.equal(calls.length,5);for(const gate of gates.slice(2))gate.resolve(stored('later'));await tick();assert.equal(f.queue.files.value.every(file=>file.status==='done'),true);
});
test('a lost upload response checks the original operation and adopts its saved file without uploading again',async t=>{
 let posts=0,reads=0;const f=fixture(t,{async transfer(){posts++;throw Error('Response lost');},client:{async get(){reads++;return stored('original');}}});f.queue.add([original()]);await tick();assert.equal(posts,1);assert.equal(reads,1);assert.equal(f.queue.files.value[0].id,'original');assert.equal(f.queue.blocked.value,false);
});
test('an unknown outcome blocks sending and only reads again after explicit checking',async t=>{
 let posts=0,reads=0,available=false;const f=fixture(t,{async transfer(){posts++;throw Error('Offline');},client:{async get(){reads++;if(!available)throw Error('Still offline');return stored('recovered');}}});f.queue.add([original()]);await tick();const file=f.queue.files.value[0];assert.equal(file.status,'unknown');assert.equal(f.queue.blocked.value,true);assert.equal(await f.queue.checkBeforeSend(),false);assert.equal(posts,1);available=true;await f.queue.inspect(file);assert.equal(file.id,'recovered');assert.equal(posts,1);assert.equal(reads,2);
});
test('known rejection keeps a readable cause and retries the same file and request key only after checking',async t=>{
 const calls=[];let posts=0;const input=original(),f=fixture(t,{async transfer(file,key,version){calls.push({file,key,version});if(++posts===1)throw Object.assign(Error('Invalid parameters'),{status:415});return stored('accepted');},client:{async get(){throw Object.assign(Error('Not found'),{status:404});}}});f.queue.add([input]);await tick();const file=f.queue.files.value[0];assert.equal(file.status,'error');assert.equal(file.error,'这个附件格式暂不支持上传');assert.equal(f.queue.blocked.value,true);await f.queue.retry(file);await tick();assert.equal(file.status,'done');assert.equal(calls.length,2);assert.equal(calls[0].key,calls[1].key);assert.equal(calls[1].file,input);assert.equal(calls[1].version,0);
});
test('an explicitly failed stored operation retries with its latest receipt version',async t=>{
 const calls=[];const failed={status:'failed',version:1,error:'上次上传已中断，可以重新上传原文件。'},f=fixture(t,{async transfer(file,key,version){calls.push({key,version});return calls.length===1?failed:stored('second-attempt');},client:{async get(){return failed;}}});f.queue.add([original()]);await tick();const file=f.queue.files.value[0];assert.equal(file.status,'error');await f.queue.retry(file);await tick();assert.deepEqual(calls.map(call=>call.version),[0,1]);assert.equal(file.id,'second-attempt');
});
test('rapid retry calls cannot restart a currently active upload',async t=>{
 const gate=deferred();let calls=0;const f=fixture(t,{transfer(){calls++;return gate.promise;}});f.queue.add([original()]);await f.queue.retry(f.queue.files.value[0]);assert.equal(calls,1);gate.resolve(stored());await tick();
});
test('removing an attachment cancels its observer and ignores a late success',async t=>{
 const gate=deferred(),calls=[],f=fixture(t,{transfer(file,key,version,options){calls.push(options);return gate.promise;}});f.queue.add([original()]);f.queue.remove(f.queue.files.value[0]);assert.equal(calls[0].signal.aborted,true);gate.resolve(stored('late'));await tick();assert.deepEqual(f.queue.files.value,[]);assert.deepEqual(f.notices,[]);
});
test('a late upload failure after account change cannot restore old filenames or show old notifications',async t=>{
 const gate=deferred(),f=fixture(t,{transfer(){return gate.promise;}});f.queue.add([original('private-old-account.txt')]);f.owner.identityRevision++;await nextTick();gate.reject(Error('Old failure'));await tick();assert.deepEqual(f.queue.files.value,[]);assert.deepEqual(f.notices,[]);assert.equal(f.queue.blocked.value,false);
});
test('leaving the composer ignores a late receipt and clears owned object URLs',async t=>{
 const gate=deferred(),f=fixture(t,{transfer(){return gate.promise;}});f.queue.add([original('picture.png','image/png')]);f.scope.stop();gate.resolve(stored('old-image','image/png'));await tick();assert.deepEqual(f.queue.files.value,[]);assert.deepEqual(f.revoked,['blob:qgauss-1']);
});
test('removing image previews revokes them, while previews handed to message history keep their new owner',async t=>{
 const f=fixture(t);f.queue.add([original('one.png','image/png')]);const first=f.queue.files.value[0];f.queue.remove(first);assert.deepEqual(f.revoked,['blob:qgauss-1']);f.queue.add([original('two.png','image/png')]);const second=f.queue.files.value[0];assert.equal(f.queue.retainPreview(second),'blob:qgauss-2');f.queue.files.value=[];await tick();assert.deepEqual(f.revoked,['blob:qgauss-1']);
});
test('content-sniffed documents do not stay displayed as images',async t=>{
 const f=fixture(t);f.queue.add([original('looks-like-picture.png','image/png')]);await tick();assert.equal(f.queue.files.value[0].kind,'document');
});
test('sending is blocked by unavailable files and a later library restoration makes them usable again',async t=>{
 let available=false,checks=0;const f=fixture(t,{client:{async post(path,body){checks++;return{items:body.ids.map(id=>({id,status:available?'available':'unavailable'}))};}}});f.queue.files.value=[reactive({localId:'saved',id:'owned-file',name:'原名称',status:'done',error:''})];assert.equal(await f.queue.checkBeforeSend(),false);assert.equal(f.queue.files.value[0].status,'unavailable');assert.equal(f.queue.blocked.value,true);available=true;personalFilesRevision.value++;await tick();assert.equal(f.queue.files.value[0].status,'done');assert.equal(checks,2);assert.equal(f.queue.blocked.value,false);
});
test('an unreadable document gives a specific recovery action without submitting any upload',async t=>{
 const f=fixture(t,{client:{async post(){return{items:[{id:'bad-document',status:'unavailable',reason:'unreadable'}]};}}});f.queue.files.value=[reactive({localId:'bad',id:'bad-document',status:'done',error:''})];assert.equal(await f.queue.checkBeforeSend(),false);assert.equal(f.queue.files.value[0].error,'这个文档暂不能读取，请更换文件后重试。');assert.equal(f.requests.length,0);
});
test('a preflight connection failure retains attachments as unconfirmed and can be checked without reupload',async t=>{
 let okay=false,reads=0;const f=fixture(t,{client:{async post(){reads++;if(!okay)throw Error('Offline');return{items:[{id:'file',status:'available'}]};}}});f.queue.files.value=[reactive({localId:'file',id:'file',status:'done',error:''})];assert.equal(await f.queue.checkBeforeSend(),false);assert.equal(f.queue.files.value[0].status,'check-failed');okay=true;await f.queue.inspect(f.queue.files.value[0]);assert.equal(f.queue.files.value[0].status,'done');assert.equal(reads,2);assert.equal(f.requests.length,0);
});
test('changing accounts while preflight is pending cannot attach the old account file again',async t=>{
 const gate=deferred(),f=fixture(t,{client:{post(){return gate.promise;}}});f.queue.files.value=[reactive({localId:'private',id:'private',status:'done'})];const checking=f.queue.checkBeforeSend();f.owner.identityRevision++;await nextTick();gate.resolve({items:[{id:'private',status:'available'}]});assert.equal(await checking,false);assert.deepEqual(f.queue.files.value,[]);assert.equal(f.queue.checking.value,false);
});
test('the queue respects nine files and explains how many extra choices were skipped',async t=>{
 const hold=deferred(),f=fixture(t,{transfer(){return hold.promise;}});f.queue.add(Array.from({length:12},(_,i)=>original('file-'+i)));assert.equal(f.queue.files.value.length,9);assert.equal(f.notices[0][1].count,9);f.queue.add([original()]);assert.equal(f.notices[1][0],'一条消息最多附带 9 个文件');hold.resolve(stored());await tick();
});
test('attachment copy covers simplified, traditional and English while preserving names and placeholders',()=>{
 const params=value=>[...value.matchAll(/\{(\w+)\}/g)].map(row=>row[1]).sort();for(const [key,languages]of Object.entries(ATTACHMENT_MESSAGES))for(const value of languages){assert.ok(value.length);assert.deepEqual(params(value),params(key));}assert.equal(chatText('en','从编辑区移除：{name}',{name:'原文件 {count} $&'}),'Remove from composer: 原文件 {count} $&');assert.equal(chatText('zh-TW','文件已就绪'),'檔案已就緒');assert.equal(chatText('en','文件暂未核对，请稍后重试。'),'This file could not be checked. Please try again later.');
});

test('restoring a file recovers an unavailable upload receipt even before the composer learned its file id',async t=>{
 let restored=false,posts=0,reads=0;const f=fixture(t,{async transfer(){posts++;return{status:'unavailable',version:1};},client:{async get(){reads++;return restored?stored('same-restored-file'):{status:'unavailable',version:1};}}});
 f.queue.add([original()]);await tick();const file=f.queue.files.value[0];assert.equal(file.id,'');assert.equal(file.status,'unavailable');restored=true;personalFilesRevision.value++;await tick();assert.equal(file.id,'same-restored-file');assert.equal(file.status,'done');assert.equal(posts,1);assert.equal(reads,1);
});
