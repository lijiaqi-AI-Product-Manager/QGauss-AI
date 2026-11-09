import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectScope,ref,reactive,nextTick} from 'vue';
import {useArtifactSaves} from '../src/composables/useArtifactSaves.js';
import {usePersonalFiles,personalFilesRevision} from '../src/composables/usePersonalFiles.js';
import {agentRunReport} from '../src/lib/agent-presentation.js';
import {FILE_MESSAGES} from '../src/i18n/file-messages.js';
import {chatText} from '../src/i18n/chat-messages.js';
const key='a'.repeat(64),tick=()=>new Promise(resolve=>setTimeout(resolve,0)),auth=()=>reactive({isLoggedIn:true,identityRevision:1});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function setup(t,create){const scope=effectScope(),state=scope.run(create);t.after(()=>scope.stop());return{scope,state};}
test('remote results retain a valid server key without trusting malformed receipt identities',()=>{
 const report=agentRunReport({kind:'agent',status:'completed',artifacts:[{url:'https://files.qgauss.test/result',title:'原名称 {count} $&',key},{url:'https://files.qgauss.test/other',key:'../secret'}]});assert.equal(report.artifacts[0].key,key);assert.equal(report.artifacts[0].title,'原名称 {count} $&');assert.equal(report.artifacts[1].key,undefined);
});
test('opening a finished result reads its receipt and never submits a save automatically',async t=>{
 const calls=[],{state}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:auth(),client:{async get(path){calls.push(path);return{items:[{key,status:'unsaved',version:0}]};},post(){throw Error('Unexpected save');}}}));await tick();assert.equal(state.receipts.value[key].status,'unsaved');assert.equal(calls.length,1);
});
test('double clicks during acceptance submit only one save and then read the original receipt',async t=>{
 const gate=deferred(),posts=[],client={async get(){return{items:[{key,status:posts.length?'saved':'unsaved',version:posts.length?1:0}]};},post(path,body){posts.push({path,body});return gate.promise;}},{state}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:auth(),client}));await tick();const running=state.save(key);await state.save(key);assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{expectedVersion:0});gate.resolve({});await running;assert.equal(state.receipts.value[key].status,'saved');
});
test('an uncertain save response checks the receipt without repeating the mutation',async t=>{
 let reads=0,posts=0;const {state}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:auth(),client:{async get(){reads++;return{items:[{key,status:reads===1?'unsaved':'saved',version:reads===1?0:1}]};},async post(){posts++;throw Error('Connection interrupted');}}}));await tick();await state.save(key);assert.equal(posts,1);assert.equal(reads,2);assert.equal(state.receipts.value[key].status,'saved');
});
test('a failed status read disables further mutation until its receipt can be checked',async t=>{
 let reads=0,posts=0;const {state}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:auth(),client:{async get(){if(++reads>1)throw Error('Offline');return{items:[{key,status:'unsaved',version:0}]};},async post(){posts++;throw Error('Offline');}}}));await tick();await state.save(key);assert.equal(state.checkingError.value,true);await state.save(key);assert.equal(posts,1);
});
test('switching accounts discards a late private receipt and only reads the new identity',async t=>{
 const owner=auth(),gate=deferred();let reads=0;const {state}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:owner,client:{get(){return++reads===1?gate.promise:Promise.resolve({items:[]});}}}));owner.identityRevision++;await nextTick();gate.resolve({items:[{key,status:'saved',version:1}]});await tick();assert.deepEqual(state.receipts.value,{});assert.equal(reads,2);
});
test('leaving a result stops polling and discards late reads',async t=>{
 const gate=deferred(),{state,scope}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:auth(),client:{get(){return gate.promise;}}}));scope.stop();gate.resolve({items:[{key,status:'saved',version:1}]});await tick();assert.deepEqual(state.receipts.value,{});
});
test('a completed reply whose durable artifacts arrive later can recover through a read without another submission',async t=>{
 let reads=0;const {state}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:auth(),client:{async get(){return{items:++reads===1?[]:[{key,status:'unsaved',version:0}]};},post(){throw Error('No automatic save');}}}));await tick();assert.equal(state.checkingError.value,true);assert.deepEqual(state.receipts.value,{});await state.refresh();assert.equal(state.checkingError.value,false);assert.equal(state.receipts.value[key].status,'unsaved');
});
test('file search preserves literal names and only requests the private library',async t=>{
 const paths=[],{state}=setup(t,()=>usePersonalFiles({auth:auth(),client:{async get(path){paths.push(path);return{items:[],total:0};}}}));assert.equal(paths.length,0);state.show();await tick();state.filter('search','原名称 {count} $&');await tick();assert.match(paths.at(-1),/library=1/);assert.equal(new URL('https://qgauss.test'+paths.at(-1)).searchParams.get('q'),'原名称 {count} $&');state.filter('tab','trash');await tick();assert.match(paths.at(-1),/trash=1/);
});
test('closing a library ignores a late file list',async t=>{
 const gate=deferred(),{state}=setup(t,()=>usePersonalFiles({auth:auth(),client:{get(){return gate.promise;}}}));state.show();state.close();gate.resolve({items:[{id:'private'}],total:1});await tick();assert.equal(state.open.value,false);assert.deepEqual(state.items.value,[]);
});
test('a changed library refreshes the original result card through a read',async t=>{
 let reads=0;const {state}=setup(t,()=>useArtifactSaves(ref('message'),ref(true),{auth:auth(),client:{async get(){reads++;return{items:[{key,status:reads===1?'saved':'trashed',version:1}]};}}}));await tick();personalFilesRevision.value++;await tick();assert.equal(reads,2);assert.equal(state.receipts.value[key].status,'trashed');
});
test('trash and restore send the displayed file version and never resubmit after a failure',async t=>{
 const posts=[],{state}=setup(t,()=>usePersonalFiles({auth:auth(),client:{async get(){return{items:[],total:0};},async post(path,body){posts.push({path,body});throw Error('Unknown outcome');}}}));state.show();await tick();await state.change({id:'file',version:3},'restore');assert.deepEqual(posts,[{path:'/upload/file/restore',body:{expectedVersion:3}}]);assert.ok(state.error.value);assert.equal(posts.length,1);
});
test('account changes cancel a pending private download before any link or object URL is created',async t=>{
 const owner=auth(),gate=deferred(),paths=[],{state}=setup(t,()=>usePersonalFiles({auth:owner,loadBlob(path){paths.push(path);return gate.promise;},client:{}}));const pending=state.download({id:'owned-file',filename:'私人名称.txt'});owner.identityRevision++;await nextTick();gate.resolve(new Blob(['private']));await pending;assert.deepEqual(paths,['/api/upload/owned-file/raw']);assert.equal(state.busyId.value,'');
});
test('file interface copy covers three languages, preserves placeholders and keeps unknown titles verbatim',()=>{
 const params=text=>[...text.matchAll(/\{(\w+)\}/g)].map(row=>row[1]).sort();for(const [original,values]of Object.entries(FILE_MESSAGES)){for(const value of values){assert.deepEqual(params(value),params(original));assert.ok(value.length);}assert.doesNotMatch(values[1],/[\u3400-\u9fff]/);}
 assert.equal(chatText('en','移到回收站：{name}',{name:'原名称 {count} $&'}),'Move to trash: 原名称 {count} $&');assert.equal(chatText('en','原名称 {count} $&'),'原名称 {count} $&');assert.equal(chatText('zh-TW','我的创作文件'),'我的創作檔案');
});
