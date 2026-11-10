import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, reactive } from 'vue';
import { useConversationRecords } from '../src/composables/useConversationRecords.js';
import { RECORD_FILTERS, RECORD_MIME, recordQuery, recordUsage, checkWorkbook } from '../src/lib/conversation-records.js';
import { RECORD_MESSAGES, recordText } from '../src/i18n/record-messages.js';
const row = (id='message-one') => ({ id,content:'QGauss 100%_ready <script>literal</script>',role:'ASSISTANT',status:'COMPLETED',conversationId:'conversation-one',billing:null,promptTokens:null,completionTokens:null });
const page = (items=[row()],number=1,total=items.length) => ({ items,total,page:number,pageSize:20,asOf:'2026-01-02T12:00:00.000Z' });
const full = id => ({...row(id),reasoning:'保留文本',branches:[],branchCount:0});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const workbook = () => new Blob([new Uint8Array([80,75,3,4]),'x'.repeat(120)],{type:RECORD_MIME});
function fixture(t,options={}) {
  const scope=effectScope(),auth=reactive({isLoggedIn:true,identityRevision:1,user:{id:'operator',role:'ADMIN'}}),calls=[],saved=[];
  const client={async get(path,settings){calls.push({path,settings});return options.get?options.get(path,settings):path.startsWith('/chat-logs?')?page():full(path.split('/').pop());}};
  const records=scope.run(()=>useConversationRecords({auth,client,download:options.download||(async()=>workbook()),save:value=>saved.push(value)}));t.after(()=>scope.stop());return{scope,auth,calls,saved,records};
}
test('filter dates use local whole-day bounds and reject invalid ranges',()=>{
  const query=recordQuery({...RECORD_FILTERS,from:'2026-01-02',to:'2026-01-02',keyword:'  100%_  '});assert.equal(query.keyword,'100%_');assert.equal(new Date(query.from).getHours(),0);assert.equal(new Date(query.to).getMilliseconds(),999);assert.equal(new Date(query.to).getHours(),23);
  assert.throws(()=>recordQuery({...RECORD_FILTERS,from:'2026-02-31'}));assert.throws(()=>recordQuery({...RECORD_FILTERS,from:'2026-01-03',to:'2026-01-02'}));assert.equal(recordUsage(null),'—');assert.equal(recordUsage(0),'0');
});
test('search clears previous results and only the newest reply may populate the page',async t=>{
  const gates=[deferred(),deferred()],f=fixture(t,{get:()=>gates.shift().promise}),one=gates[0],two=gates[1],first=f.records.search();f.records.filters.keyword='new';const second=f.records.search();assert.equal(f.calls[0].settings.signal.aborted,true);two.resolve(page([row('new')]));await second;one.resolve(page([row('old')]));await first;assert.equal(f.records.rows.value[0].id,'new');assert.equal(f.records.loading.value,false);
});
test('typing draft filters cannot change paging or export conditions before a new search',async t=>{
  let downloadPath;const f=fixture(t,{get:path=>page([row()],new URL(path,'https://qgauss.test').searchParams.get('page')==='2'?2:1,21),download:async path=>{downloadPath=path;return workbook();}});
  f.records.filters.keyword='applied';await f.records.search();f.records.filters.keyword='draft';assert.equal(f.records.dirty.value,true);await f.records.goPage(2);assert.equal(new URL(f.calls[1].path,'https://qgauss.test').searchParams.get('keyword'),'applied');assert.equal(f.records.page.value,2);await f.records.exportExcel();assert.equal(new URL(downloadPath,'https://qgauss.test').searchParams.get('keyword'),'applied');assert.equal(f.saved.length,1);
});
test('failed pagination retains the visible page and retry requests the failed page once',async t=>{
  let count=0;const f=fixture(t,{get:path=>{if(++count===2)throw new Error('offline');return page([row('row-'+count)],Number(new URL(path,'https://qgauss.test').searchParams.get('page')),21);}});await f.records.search();await f.records.goPage(2);assert.equal(f.records.page.value,1);assert.equal(f.records.rows.value[0].id,'row-1');assert.ok(f.records.error.value);await f.records.retry();assert.equal(f.records.page.value,2);assert.equal(f.calls.length,3);
});
test('shrinking result sets return to the new last page with the same query time',async t=>{
  const f=fixture(t,{get:path=>{const query=new URL(path,'https://qgauss.test').searchParams;return query.get('page')==='2'?page([],2,1):page([row()],1,f.calls.length===1?21:1);}});await f.records.search();await f.records.goPage(2);assert.equal(f.records.page.value,1);assert.equal(f.records.total.value,1);assert.equal(f.calls.length,3);assert.equal(new URL(f.calls[2].path,'https://qgauss.test').searchParams.get('asOf'),'2026-01-02T12:00:00.000Z');
});
test('malformed or mismatched pages cannot be displayed or exported',async t=>{
  const f=fixture(t,{get:()=>({...page(),page:2})});await f.records.search();assert.equal(f.records.applied.value,null);assert.equal(f.records.rows.value.length,0);assert.equal(f.records.canExport.value,false);assert.ok(f.records.error.value);
});
test('only a complete typed workbook starts a download',async t=>{
  const f=fixture(t,{download:async()=>new Blob(['{"message":"unavailable"}'],{type:'application/json'})});await f.records.search();assert.equal(await f.records.exportExcel(),false);assert.equal(f.saved.length,0);assert.ok(f.records.exportError.value);assert.equal(f.records.exportNotice.value,'');await assert.rejects(()=>checkWorkbook(new Blob(['x'.repeat(150)],{type:RECORD_MIME})));
});
test('cancelling an export suppresses a late successful file and repeated clicks share no new work',async t=>{
  const gate=deferred();let count=0;const f=fixture(t,{download:()=>{count++;return gate.promise;}});await f.records.search();const pending=f.records.exportExcel();assert.equal(await f.records.exportExcel(),false);f.records.cancelExport();gate.resolve(workbook());await pending;assert.equal(f.saved.length,0);assert.equal(count,1);assert.equal(f.records.exportNotice.value,'');
});
test('a new search invalidates a workbook for the preceding query',async t=>{
  const gate=deferred(),f=fixture(t,{download:()=>gate.promise});await f.records.search();const pending=f.records.exportExcel();f.records.filters.keyword='new';await f.records.search();gate.resolve(workbook());await pending;assert.equal(f.saved.length,0);assert.equal(f.records.exportNotice.value,'');
});
test('out-of-order message details and closed dialogs cannot expose a previous message',async t=>{
  const first=deferred(),second=deferred(),f=fixture(t,{get:path=>path.endsWith('/first')?first.promise:second.promise});const one=f.records.openDetail('first'),two=f.records.openDetail('second');second.resolve(full('second'));await two;first.resolve(full('first'));await one;assert.equal(f.records.detail.value.id,'second');f.records.closeDetail();assert.equal(f.records.detail.value,null);assert.equal(f.records.selectedId.value,'');
});
test('missing and mismatched details have explicit error states',async t=>{
  const f=fixture(t,{get:()=>full('other')});await f.records.openDetail('first');assert.equal(f.records.detail.value,null);assert.ok(f.records.detailError.value);assert.equal(f.records.detailLoading.value,false);
});
test('account changes and role revocation clear records, filters, details and in-flight downloads',async t=>{
  const gate=deferred(),f=fixture(t,{download:()=>gate.promise});await f.records.search();f.records.filters.keyword='private';await f.records.openDetail('message-one');const pending=f.records.exportExcel();f.auth.user.role='USER';assert.equal(f.records.rows.value.length,0);assert.equal(f.records.filters.keyword,'');assert.equal(f.records.detail.value,null);gate.resolve(workbook());await pending;assert.equal(f.saved.length,0);assert.equal(await f.records.search(),false);
});
test('unmounting suppresses pending reads even when the transport ignores abort',async t=>{
  const gate=deferred(),f=fixture(t,{get:()=>gate.promise}),pending=f.records.search();f.scope.stop();gate.resolve(page());await pending;assert.equal(f.records.rows.value.length,0);assert.equal(f.records.loading.value,false);
});
test('three-language copy preserves placeholders and leaves user data literal',()=>{
  const tokens=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();for(const[key,values]of Object.entries(RECORD_MESSAGES))for(const value of values)assert.deepEqual(tokens(value),tokens(key));
  assert.equal(recordText('en','第 {page} / {pages} 页',{page:'原标题 $&',pages:3}),'Page 原标题 $& of 3');assert.equal(recordText('zh-TW','消息明细'),'訊息明細');
});
