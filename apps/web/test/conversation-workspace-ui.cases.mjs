import {conversationArchive} from './conversation-workspace-fixtures.mjs';
export function registerConversationWorkspaceTests({test,assert,mount,settle,relayJson,setLang}){
 const wait=async predicate=>{for(let i=0;i<180;i++){if(predicate())return;await settle();}assert.ok(predicate(),'conversation archive did not settle');};
 const model={id:'model-a',name:'qgauss-notebook',displayName:'QGauss 灵感搭档',ready:true,capabilities:['chat'],billing:{mode:'none'}};
 const failure=(status=409)=>new Response(JSON.stringify({code:4015,message:'记录已变化'}),{status,headers:{'content-type':'application/json'}});
 const enter=(selector,value)=>{const node=document.querySelector(selector);assert.ok(node,selector);node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
 const button=(text,root=document)=>{const node=[...root.querySelectorAll('button')].find(row=>row.textContent.trim()===text||row.getAttribute('aria-label')===text||row.getAttribute('title')===text);assert.ok(node,text);return node;};
 const rows=()=>[...document.querySelectorAll('.qcw-shelf .cv-conv')];
 const writes=f=>f.calls.filter(call=>call.method!=='GET'&&call.url!=='/api/conversations/status');
 async function fixture(initial=[{id:'c1',title:'原对话 {count} $&'}],options={}){
  setLang('zh');const archive=conversationArchive(initial,options.folders||[]);
  const f=await mount({loggedIn:true,initialPath:options.initialPath||'/chat?new=1',intercept:async call=>{
   const custom=await options.intercept?.(call,archive);if(custom)return custom;
   if(call.url==='/api/models/available')return relayJson([model]);
   const value=archive.respond(call);if(value!==undefined)return relayJson(value);
   const id=/^\/api\/conversations\/([^/]+)$/.exec(call.url)?.[1];
   if(id&&call.method==='GET'){const row=archive.rows.find(row=>row.id===id);return row&&!row.deletedAt?relayJson({...row,model,messages:[{id:id+'-u',role:'USER',content:'原始问题'},{id:id+'-a',parentId:id+'-u',role:'ASSISTANT',status:'COMPLETED',content:'保存的原回答'}]}):failure(404);}
  }});
  try{await wait(()=>(document.querySelector('.cv-input')||document.querySelector('[aria-label="灵感输入框"]'))&&!document.querySelector('.qcw-loading'));return Object.assign(f,{archive});}catch(error){await f.close();throw error;}
 }
 async function open(title){const row=rows().find(row=>row.getAttribute('aria-label')===title);assert.ok(row,title);row.click();await wait(()=>document.querySelector('.cv-msg'));}
 async function menu(title,text){const row=rows().find(row=>row.getAttribute('aria-label')===title);assert.ok(row,title);row.querySelector('.cv-op').click();await settle();const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find(row=>row.textContent.trim()===text);assert.ok(item,text);item.click();await settle();}
 async function confirm(text='移入回收站'){await wait(()=>document.querySelector('.el-message-box'));button(text,document.querySelector('.el-message-box')).click();await settle();}
 async function search(value){const input=document.querySelector('.cv-search input');if(!input){button('搜索对话').click();await settle();}enter('.cv-search input',value);}
 const swap=f=>f.auth.apply({accessToken:'new-access',refreshToken:'new-refresh',user:{id:'new-user',username:'新账户',role:'USER'}});

 test('会话档案：超过百条仍能分页与全量搜索，草稿和原始标题保留',async()=>{
  const initial=Array.from({length:105},(_,index)=>({id:'c'+(index+1),title:index===104?'旧灵感 {count} $&':'灵感 '+(index+1)})),f=await fixture(initial);
  try{assert.equal(rows().length,40);enter('.cv-input','没写完的文字');button('继续打开更早的对话').click();await wait(()=>rows().length===80);assert.match(document.querySelector('.qcw-count').textContent,/80.*105/);await search('旧灵感');await wait(()=>rows().length===1&&rows()[0].textContent.includes('旧灵感'));assert.equal(rows()[0].getAttribute('aria-label'),'旧灵感 {count} $&');assert.equal(document.querySelector('.cv-input').value,'没写完的文字');assert.equal(writes(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：较早页面失败保留已打开记录，只在再次点击时重读同一页',async()=>{
  let offline=true;const f=await fixture(Array.from({length:45},(_,i)=>({id:'c'+i,title:'灵感 '+i})),{intercept:call=>call.url.includes('cursor=')&&offline?relayJson('暂未读取',503):undefined});
  try{button('继续打开更早的对话').click();await wait(()=>document.querySelector('.qcw-error'));assert.equal(rows().length,40);assert.match(document.querySelector('.qcw-error').textContent,/已显示的内容会保留/);assert.equal(f.calls.filter(call=>call.url.includes('cursor=')).length,1);offline=false;button('继续打开更早的对话').click();await wait(()=>rows().length===45);const calls=f.calls.filter(call=>call.url.includes('cursor='));assert.equal(calls[0].url,calls[1].url);assert.equal(writes(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：筛选独立请求正确分类与分组，未分组不会混入其他分组',async()=>{
  const f=await fixture([{id:'c1',title:'普通未分组'},{id:'c2',title:'分组里的灵感',folderId:'f1'},{id:'c3',title:'应用灵感',appId:'app1'},{id:'c4',title:'搭档灵感',agentId:'agent1'}],{folders:[{id:'f1',name:'我的小宇宙'}]});
  try{assert.equal(rows().length,2);button('未分组').click();await wait(()=>rows().length===1);assert.match(rows()[0].textContent,/普通未分组/);button('我的小宇宙').click();await wait(()=>rows().some(row=>row.textContent.includes('分组里的灵感')));document.querySelectorAll('.qgc-history-tabs button')[1].click();await wait(()=>!document.querySelector('.qcw-loading'));assert.equal(rows().length,0);button('全部').click();await wait(()=>rows().some(row=>row.textContent.includes('应用灵感')));assert.equal(rows().length,1);assert.equal(writes(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：当前对话移入回收站保留未发送文字与同一份已上传附件',async()=>{
  let uploads=0;const title='原对话 {count} $&',f=await fixture(undefined,{intercept:call=>/^\/api\/upload\/requests\//.test(call.url)?call.method==='POST'?(uploads++,relayJson({status:'stored',version:1,file:{id:'owned-file',filename:'原附件.txt',mime:'text/plain',size:8}})):relayJson('没有记录',404):undefined});
  try{await open(title);enter('.cv-input','还没有发送的下一问');const picker=document.querySelector('.cv-main input[type=file]');Object.defineProperty(picker,'files',{value:[new File(['original'],'原附件.txt',{type:'text/plain'})],configurable:true});picker.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>document.querySelector('.cv-pending-item.done'));await menu(title,'移到对话回收站');assert.match(document.querySelector('.el-message-box').textContent,/原消息和记录会保留/);await confirm();await wait(()=>f.calls.some(call=>call.url.endsWith('/c1/trash'))&&!document.querySelector('.cv-msg'));assert.equal(document.querySelector('.cv-input').value,'还没有发送的下一问');assert.equal(document.querySelector('.cv-pending-name').textContent,'原附件.txt');assert.equal(uploads,1);assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：移除另一个筛选结果不会清空正在阅读的对话和草稿',async()=>{
  const f=await fixture([{id:'c1',title:'正在阅读'},{id:'c2',title:'准备整理'}]);
  try{await open('正在阅读');enter('.cv-input','阅读中的草稿');await search('准备整理');await wait(()=>rows().length===1&&rows()[0].textContent.includes('准备整理'));await menu('准备整理','移到对话回收站');await confirm();await wait(()=>f.archive.rows.find(row=>row.id==='c2').deletedAt);assert.match(document.querySelector('.cv-thread').textContent,/保存的原回答/);assert.equal(document.querySelector('.cv-input').value,'阅读中的草稿');assert.equal(f.archive.rows.find(row=>row.id==='c1').deletedAt,null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：回收站恢复保留原分类与消息，不自动打开或重新生成',async()=>{
  const f=await fixture([{id:'c1',title:'待恢复的原故事',deletedAt:'2026-11-09T03:00:00Z',version:4}]);
  try{button('打开对话回收站').click();await wait(()=>rows().length===1);button('恢复对话：待恢复的原故事').click();await wait(()=>f.archive.rows[0].deletedAt===null&&rows().length===0);assert.deepEqual(f.calls.find(call=>call.url.endsWith('/restore')).body,{expectedVersion:4});assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'||call.url==='/api/conversations/c1'),false);button('回到会话档案').click();await wait(()=>rows().length===1);await open('待恢复的原故事');assert.match(document.querySelector('.cv-thread').textContent,/保存的原回答/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：批量清理覆盖六百条历史的全部页数并保留置顶',async()=>{
  const f=await fixture(Array.from({length:603},(_,i)=>({id:'c'+i,title:'历史 '+i,pinned:i<2})));
  try{assert.equal(rows().length,40);button('清空非置顶').click();await wait(()=>document.querySelector('.el-message-box'));assert.match(document.querySelector('.el-message-box').textContent,/将 601 段/);assert.match(document.querySelector('.el-message-box').textContent,/置顶对话会保留/);await confirm();await wait(()=>rows().length===2);assert.equal(f.archive.rows.filter(row=>row.deletedAt).length,601);assert.equal(rows().every(row=>row.textContent.includes('✦')),true);assert.equal(f.calls.filter(call=>call.url==='/api/conversations/bulk-delete').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：批量确认后数据变化会拒绝旧确认，不能自动再次清理',async()=>{
  const f=await fixture([{id:'c1',title:'等待置顶'}],{intercept:(call,archive)=>{if(call.url==='/api/conversations/bulk-delete'){archive.rows[0].pinned=true;archive.rows[0].version++;return failure();}}});
  try{button('清空非置顶').click();await confirm();await wait(()=>document.querySelector('.qcw-error'));assert.match(document.querySelector('.qcw-error').textContent,/记录已变化/);assert.equal(f.archive.rows[0].deletedAt,null);button('刷新会话档案').click();await wait(()=>rows()[0]?.textContent.includes('✦'));assert.equal(f.calls.filter(call=>call.url==='/api/conversations/bulk-delete').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：取消批量确认只读取预览，不提交清理',async()=>{
  const f=await fixture();try{button('清空非置顶').click();await wait(()=>document.querySelector('.el-message-box'));button('取消',document.querySelector('.el-message-box')).click();await settle();assert.equal(f.calls.filter(call=>call.url==='/api/conversations/bulk-preview').length,1);assert.equal(f.calls.some(call=>call.url==='/api/conversations/bulk-delete'),false);assert.equal(rows().length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：切换分类使旧批量预览失效，迟到结果不会打开确认框',async()=>{
  let release;const held=new Promise(done=>release=done),f=await fixture(undefined,{intercept:async(call,archive)=>{if(call.url==='/api/conversations/bulk-preview'){const result=archive.respond(call);await held;return relayJson(result);}}});
  try{button('清空非置顶').click();await wait(()=>f.calls.some(call=>call.url==='/api/conversations/bulk-preview'));document.querySelectorAll('.qgc-history-tabs button')[1].click();await settle();release();await settle();assert.equal(f.calls.find(call=>call.url==='/api/conversations/bulk-preview').signal.aborted,true);assert.equal(document.querySelector('.el-message-box'),null);assert.equal(f.calls.some(call=>call.url==='/api/conversations/bulk-delete'),false);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
 });
 test('会话档案：切换账号关闭旧的分组名称输入，不能把原账户草稿提交给新账户',async()=>{
  const f=await fixture();try{button('会话分组').click();await wait(()=>document.querySelector('.el-message-box__input input'));enter('.el-message-box__input input','旧账号的私有分组');swap(f);await settle();await settle();assert.equal(f.calls.some(call=>call.url==='/api/folders'&&call.method==='POST'),false);assert.doesNotMatch(document.querySelector('#mount').textContent,/旧账号的私有分组/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：清理回执丢失时保留草稿，刷新只核对原记录而不重复提交',async()=>{
  const f=await fixture(undefined,{intercept:(call,archive)=>{if(call.url.endsWith('/c1/trash')){archive.respond(call);throw Error('response lost');}}});
  try{await open('原对话 {count} $&');enter('.cv-input','保留这个下一问');await menu('原对话 {count} $&','移到对话回收站');await confirm();await wait(()=>document.querySelector('.qcw-error'));assert.match(document.querySelector('.qcw-error').textContent,/操作结果暂未确认/);assert.match(document.querySelector('.cv-thread').textContent,/保存的原回答/);button('刷新会话档案').click();await wait(()=>!document.querySelector('.cv-msg'));assert.equal(document.querySelector('.cv-input').value,'保留这个下一问');assert.equal(f.calls.filter(call=>call.url.endsWith('/c1/trash')).length,1);assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：回收站记录不会进入首页的继续对话入口',async()=>{
  const f=await fixture([{id:'c1',title:'正在继续的故事'},{id:'c2',title:'只在回收站的故事',deletedAt:'2026-11-09T03:00:00Z'}],{initialPath:'/chat'});
  try{button('打开对话回收站').click();await wait(()=>rows().some(row=>row.getAttribute('aria-label')==='只在回收站的故事'));const shelf=document.querySelector('.qcw-shelf');assert.equal([...document.querySelectorAll('button')].filter(row=>!shelf.contains(row)&&row.textContent.includes('只在回收站的故事')).length,0);assert.equal(f.calls.some(call=>call.url==='/api/conversations/c2'),false);assert.equal(writes(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
 test('会话档案：三种语言切换保留搜索、原名称和选中记录，不重新整理或生成',async()=>{
  const f=await fixture();try{await search('原对话');await wait(()=>rows().length===1);button('批量管理').click();await settle();rows()[0].dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));await settle();assert.equal(rows()[0].getAttribute('aria-checked'),'true');await setLang('en');await settle();assert.match(document.querySelector('.qcw-heading').textContent,/Your idea archive/);assert.equal(document.querySelector('.cv-search input').value,'原对话');assert.equal(rows()[0].getAttribute('aria-label'),'原对话 {count} $&');await setLang('zh-TW');await settle();assert.match(document.querySelector('.qcw-heading').textContent,/你的靈感檔案/);assert.equal(rows()[0].getAttribute('aria-checked'),'true');assert.equal(writes(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });
}
