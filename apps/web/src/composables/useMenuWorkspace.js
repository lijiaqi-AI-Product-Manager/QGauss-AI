import{computed,onBeforeUnmount,reactive,ref,watch}from'vue';
import{api}from'../api/client.js';
import{useAuth}from'../stores/auth.js';
import{currentLang}from'../i18n/index.js';
import{MENU_FIELDS,NAVIGATION_CATALOG,menuChanges,menuDraft,menuLabel,menuHint,menuOperationKey,menuProblem,menuReceipt,menuRelated,menuWorkspace}from'../lib/navigation.js';
import{readMenuPending,saveMenuPending}from'../lib/navigation-pending.js';
import{announceNavigationSaved,subscribeNavigationChanges}from'../lib/navigation-changes.js';
const memories=new WeakMap();
function memory(auth){let value=memories.get(auth);if(!value){value=new Map();memories.set(auth,value);}return value;}
const sort=(a,b)=>a.sort-b.sort||(a.id<b.id?-1:a.id>b.id?1:0),copy=value=>JSON.parse(JSON.stringify(value));
export function useMenuWorkspace(){
 const auth=useAuth(),items=ref([]),drafts=reactive({}),bases=reactive({}),conflicts=reactive({}),selected=ref(''),scope=ref('client'),query=ref(''),loading=ref(false),saving=ref(false),checking=ref(false),ready=ref(false),error=ref(''),loadError=ref(''),notice=ref(''),receipt=ref(null),pending=ref(null),review=ref(null),closing=ref(false),revision=ref(''),readAt=ref('');
 let owner='',identity=0,epoch=0,loadEpoch=0,alive=true;const requests=new Set(),memoryKey=()=>owner+':'+identity;
 const context=()=>({owner,identity,epoch}),current=at=>alive&&auth.isAdmin&&owner===at.owner&&identity===at.identity&&epoch===at.epoch&&auth.user?.id===owner&&auth.identityRevision===identity;
 const controller=()=>{const request=new AbortController();requests.add(request);return request;},busy=computed(()=>saving.value||checking.value),locked=computed(()=>!auth.isAdmin||!ready.value||!!pending.value||busy.value);
 const rows=computed(()=>Object.keys(drafts).map(id=>{const {labels,...base}=bases[id]||{};return{...base,...drafts[id],id,deletedAt:base.deletedAt||null};}));
 const changes=computed(()=>menuChanges(items.value,drafts,bases)),conflictCount=computed(()=>Object.keys(conflicts).length),active=computed(()=>rows.value.filter(row=>!row.deletedAt)),groups=computed(()=>active.value.filter(row=>row.kind==='group'));
 const problems=computed(()=>Object.fromEntries(changes.value.flatMap(change=>{const problem=menuProblem(drafts[change.id],Object.keys(change.patch),!bases[change.id]);return problem?[[change.id,problem]]:[];})));
 const currentRow=computed(()=>rows.value.find(row=>row.id===selected.value)||null);
 const outline=computed(()=>{
  const allowed=rows.value.filter(row=>scope.value==='trash'?!!row.deletedAt:!row.deletedAt&&(row.surface===scope.value||row.surface==='both')),map=new Map(allowed.map(row=>[row.id,row])),children=new Map(),ordered=[],seen=new Set();
  for(const row of allowed){const parent=map.has(row.parentId)?row.parentId:'';if(!children.has(parent))children.set(parent,[]);children.get(parent).push(row);}
  const visit=(parent,depth)=>{for(const row of(children.get(parent)||[]).sort(sort)){if(seen.has(row.id))continue;seen.add(row.id);ordered.push({...row,depth:Math.min(depth,6)});visit(row.id,depth+1);}};visit('',0);for(const row of allowed.sort(sort))if(!seen.has(row.id)){seen.add(row.id);ordered.push({...row,depth:0});visit(row.id,1);}
  const needle=query.value.trim().toLocaleLowerCase();return needle?ordered.filter(row=>[menuLabel(row,currentLang.value),menuHint(row,currentLang.value),row.path,row.targetUrl,...MENU_FIELDS.filter(key=>key.startsWith('title')).map(key=>row[key])].join(' ').toLocaleLowerCase().includes(needle)):ordered;
 });
 function dirty(id){return !!drafts[id]&&(!bases[id]||MENU_FIELDS.some(key=>drafts[id][key]!==bases[id][key]));}
 function keepDraft(){if(!owner)return;const local=Object.fromEntries(Object.keys(drafts).filter(dirty).map(id=>[id,{value:copy(drafts[id]),base:bases[id]?copy(bases[id]):null}]));const cache=memory(auth);if(Object.keys(local).length)cache.set(memoryKey(),{local,selected:selected.value,scope:scope.value,query:query.value});else cache.delete(memoryKey());}
 function clearObjects(){for(const data of[drafts,bases,conflicts])for(const key of Object.keys(data))delete data[key];}
 function remember(value){pending.value=value;return saveMenuPending(owner,value);}
 function choose(id){selected.value=id;const row=rows.value.find(item=>item.id===id);if(row)scope.value=row.deletedAt?'trash':row.surface==='both'?(scope.value==='manage'?'manage':'client'):row.surface;}
 function reconcile(snapshot){
  const found=new Set(snapshot.items.map(row=>row.id));
  for(const row of snapshot.items){if(dirty(row.id)&&(!bases[row.id]||bases[row.id].revision!==row.revision)){conflicts[row.id]=row;continue;}if(!dirty(row.id)){bases[row.id]=row;drafts[row.id]=menuDraft(row);delete conflicts[row.id];}}
  for(const id of Object.keys(bases))if(!found.has(id)){if(dirty(id))conflicts[id]={missing:true};else{delete bases[id];delete drafts[id];delete conflicts[id];}}
  items.value=snapshot.items;revision.value=snapshot.revision;readAt.value=snapshot.readAt;ready.value=true;if(!drafts[selected.value])choose(rows.value.find(row=>!row.deletedAt)?.id||'');
 }
 async function load(){if(!auth.isAdmin)return;const at=context(),n=++loadEpoch,request=controller();loading.value=true;loadError.value='';try{const value=await api.get('/menus/workspace',{signal:request.signal});if(current(at)&&n===loadEpoch)reconcile(menuWorkspace(value,at.owner));}catch(e){if(current(at)&&n===loadEpoch&&e.name!=='AbortError')loadError.value=e.message||'导航尚未读取完整，请重新读取。';}finally{requests.delete(request);if(current(at)&&n===loadEpoch)loading.value=false;}}
 async function refresh(){if(busy.value)return;review.value=null;await load();}
 function resolve(id,mode){
  const latest=conflicts[id];if(!latest)return;if(latest.missing||latest.deletedAt){if(mode==='mine'){error.value='请先恢复这个入口。';return;}delete drafts[id];delete bases[id];if(!latest.missing){bases[id]=latest;drafts[id]=menuDraft(latest);}delete conflicts[id];return;}
  const patch=Object.fromEntries(MENU_FIELDS.filter(key=>drafts[id][key]!==bases[id]?.[key]).map(key=>[key,drafts[id][key]]));bases[id]=latest;drafts[id]={...menuDraft(latest),...(mode==='mine'?patch:{})};delete conflicts[id];error.value='';
 }
 function add(kind='internal'){
  if(locked.value)return;const id=menuOperationKey(),surface=scope.value==='manage'?'manage':'client';drafts[id]=menuDraft({title:'',kind,path:kind==='group'?'':'/chat',surface,roles:surface==='manage'?'ADMIN':'ALL',requireLogin:surface==='manage',sort:(active.value.filter(row=>row.surface===surface&&!row.parentId).length+1)*10});selected.value=id;scope.value=surface;query.value='';error.value='';
 }
 function removeNew(id,seen=new Set()){if(bases[id]||locked.value||seen.has(id))return;seen.add(id);const children=rows.value.filter(row=>row.parentId===id);for(const row of children){if(!bases[row.id])removeNew(row.id,seen);else drafts[row.id].parentId=bases[row.id].parentId;}delete drafts[id];delete conflicts[id];if(selected.value===id)selected.value=rows.value.find(row=>!row.deletedAt)?.id||'';}
 function setKind(kind){const row=currentRow.value;if(!row||locked.value)return;const value=drafts[row.id];value.kind=kind;if(kind==='internal'&&!value.path)value.path='/chat';if(kind==='external')value.openInNewTab=true;error.value='';}
 function useDefaultName(){const row=currentRow.value,route=NAVIGATION_CATALOG.routes.find(item=>item.path===drafts[row?.id]?.path);if(!row||!route||locked.value)return;Object.assign(drafts[row.id],{standardKey:route.key,title:route.title,titleEn:'',titleTw:''});}
 function selectPath(path){const row=currentRow.value;if(!row||locked.value)return;const value=drafts[row.id],previous=NAVIGATION_CATALOG.routes.find(item=>item.key===value.standardKey),route=NAVIGATION_CATALOG.routes.find(item=>item.path===path);value.path=path;if(route&&(!value.title||previous&&value.title===previous.title)){value.title=route.title;value.standardKey=route.key;}if(route?.admin)value.roles='ADMIN';}
 function move(id,direction,target){
  if(locked.value)return;const row=rows.value.find(item=>item.id===id);if(!row||row.deletedAt)return;const siblings=active.value.filter(item=>item.parentId===row.parentId&&item.surface===row.surface).sort(sort),from=siblings.findIndex(item=>item.id===id),to=target?siblings.findIndex(item=>item.id===target):from+direction;
  if(to<0||to>=siblings.length||from===to)return;const [moved]=siblings.splice(from,1);siblings.splice(to,0,moved);siblings.forEach((item,index)=>drafts[item.id].sort=(index+1)*10);selected.value=id;
 }
 function reset(){clearObjects();for(const row of items.value){bases[row.id]=row;drafts[row.id]=menuDraft(row);}memory(auth).delete(memoryKey());if(!drafts[selected.value])choose(rows.value.find(row=>!row.deletedAt)?.id||'');error.value='';}
 function openReview(){
  if(locked.value||loading.value||!changes.value.length)return;error.value='';if(conflictCount.value){choose(Object.keys(conflicts)[0]);error.value='有变化需要先核对。';return;}const bad=Object.keys(problems.value)[0];if(bad){choose(bad);error.value=problems.value[bad];return;}
  const body={expectedVersion:0,expectedRevision:revision.value,action:'save',changes:copy(changes.value)};if(JSON.stringify(body).length>500000){error.value='本次改动较多，请先减少图片或分批保存。';return;}
  review.value={action:'save',body,changes:JSON.stringify(changes.value),rows:body.changes.map(change=>({id:change.id,title:drafts[change.id].title,before:bases[change.id]||null,after:copy(drafts[change.id]),fields:Object.keys(change.patch)}))};
 }
 function organize(id,action){
  if(locked.value)return;if(changes.value.length){error.value='先保存或撤回本次编辑，再整理导航。';return;}const ids=menuRelated(items.value,id,action);if(!ids.length)return;review.value={action,body:{expectedVersion:0,expectedRevision:revision.value,action,ids},rows:ids.map(key=>({id:key,title:items.value.find(row=>row.id===key)?.title||'',before:items.value.find(row=>row.id===key),after:null,fields:[]}))};error.value='';
 }
 function discard(){if(!locked.value&&changes.value.length)review.value={action:'discard',rows:[],body:null};}
 async function accept(raw,key){
  const value=menuReceipt(raw,key,owner);receipt.value=value;remember(null);review.value=null;closing.value=false;error.value='';
  if(value.status==='applied'){
   const updated=new Map(items.value.map(row=>[row.id,row]));for(const item of value.items){const row={...item.after,revision:'',available:true,virtual:false};updated.set(item.id,row);bases[item.id]=row;drafts[item.id]=menuDraft(row);delete conflicts[item.id];}
   items.value=[...updated.values()];if(value.action==='archive')scope.value='trash';else if(value.action==='restore'){const restored=updated.get(selected.value);if(restored)scope.value=restored.surface==='both'?'client':restored.surface;}ready.value=false;memory(auth).delete(memoryKey());notice.value='';announceNavigationSaved(value.id);
  }else if(value.status==='closed')notice.value='尚未保存的申请已结束。';else error.value=value.reason==='changed'?'导航已有变化，本次没有保存。请重新读取并核对。':value.detail||'本次调整未获接受，请检查入口内容与分组。';await load();
 }
 async function confirm(){
  if(!review.value||busy.value||locked.value)return;if(review.value.action==='discard'){reset();review.value=null;return;}if(review.value.body.expectedRevision!==revision.value||review.value.action==='save'&&review.value.changes!==JSON.stringify(changes.value)){review.value=null;error.value='填写内容已有变化，请重新预览。';return;}
  const at=context(),request=controller(),body=copy(review.value.body);let key;try{key=menuOperationKey();}catch(e){requests.delete(request);error.value=e.message;return;}saving.value=true;receipt.value=null;notice.value='';error.value='';
  try{if(!remember({key,operationVersion:0})){remember(null);throw Object.assign(Error('浏览器未能保存处理编号，本次申请尚未提交。'),{status:422});}const value=await api.post('/menus/operations/'+key,body,{signal:request.signal,retry:false});if(current(at))await accept(value,key);}
  catch(e){if(current(at)){if([400,401,403,422,429].includes(e.status))remember(null);review.value=null;error.value=e.message||'导航结果尚未核对完整，请继续核对原申请。';}}
  finally{requests.delete(request);if(current(at))saving.value=false;}
 }
 async function checkPending(){if(!pending.value||busy.value)return;const at=context(),key=pending.value.key,request=controller();checking.value=true;error.value='';try{const value=await api.get('/menus/operations/'+key,{signal:request.signal,retry:false});if(current(at)&&pending.value?.key===key)await accept(value,key);}catch(e){if(current(at))error.value=e.status===404?'暂未找到可确认的结果，可以重新核对或结束这次等待。':e.message;}finally{requests.delete(request);if(current(at))checking.value=false;}}
 async function conclude(){if(!pending.value||busy.value)return;const at=context(),record={...pending.value},request=controller();saving.value=true;error.value='';try{const value=await api.post('/menus/operations/'+record.key+'/close',{expectedVersion:record.operationVersion},{signal:request.signal,retry:false});if(current(at)&&pending.value?.key===record.key)await accept(value,record.key);}catch(e){if(current(at))error.value=e.message;}finally{requests.delete(request);if(current(at))saving.value=false;}}
 watch(()=>[auth.user?.id,auth.user?.role,auth.identityRevision],async()=>{
  if(owner)memory(auth).delete(memoryKey());for(const request of requests)request.abort();requests.clear();epoch++;loadEpoch++;owner=auth.user?.id||'';identity=auth.identityRevision;clearObjects();items.value=[];selected.value='';ready.value=false;loading.value=false;saving.value=false;checking.value=false;error.value='';loadError.value='';notice.value='';receipt.value=null;review.value=null;closing.value=false;revision.value='';readAt.value='';pending.value=auth.isAdmin?readMenuPending(owner):null;
  const cached=memory(auth).get(memoryKey());if(cached){for(const[id,row]of Object.entries(cached.local)){drafts[id]=row.value;if(row.base)bases[id]=row.base;}selected.value=cached.selected;scope.value=cached.scope;query.value=cached.query;}
  if(auth.isAdmin){const at=context();await load();if(current(at)&&pending.value)await checkPending();}
 },{immediate:true,flush:'sync'});
 watch(drafts,keepDraft,{deep:true});const stop=subscribeNavigationChanges(()=>{if(!busy.value)void refresh();},{remoteOnly:true});onBeforeUnmount(()=>{keepDraft();alive=false;epoch++;stop();for(const request of requests)request.abort();requests.clear();});
 return{auth,items,drafts,bases,conflicts,selected,scope,query,loading,saving,checking,ready,error,loadError,notice,receipt,pending,review,closing,revision,readAt,busy,locked,rows,changes,conflictCount,active,groups,problems,currentRow,outline,dirty,choose,refresh,resolve,add,removeNew,setKind,useDefaultName,selectPath,move,openReview,organize,discard,confirm,checkPending,conclude};
}
