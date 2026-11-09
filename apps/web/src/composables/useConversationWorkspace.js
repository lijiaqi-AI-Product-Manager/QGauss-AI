import {computed,ref,watch,onScopeDispose} from 'vue';
import {api} from '../api/client.js';import {useAuth} from '../stores/auth.js';import {historyPath,readConversationPage,matchesHistory} from '../lib/conversation-history.js';

export function useConversationWorkspace({client=api,auth=useAuth(),kind=ref('chat'),query=ref(''),folder=ref(''),trash=ref(false),debounceMs=220}={}){
 const items=ref([]),folders=ref([]),total=ref(),unpinnedTotal=ref(),kindCounts=ref({}),folderCounts=ref({}),cursor=ref(null),hasMore=ref(false),loading=ref(false),loadingMore=ref(false),error=ref(''),actionError=ref(''),busy=ref(false),countsStale=ref(false),clock=ref(new Date());
 const filter=computed(()=>({kind:kind.value,q:query.value.trim(),folder:folder.value,scope:trash.value?'trash':'active'})),key=computed(()=>JSON.stringify(filter.value)),notice=computed(()=>actionError.value||error.value),reportedTotal=computed(()=>countsStale.value?undefined:total.value),reportedUnpinned=computed(()=>countsStale.value?undefined:unpinnedTotal.value),reportedKinds=computed(()=>countsStale.value?{}:kindCounts.value),reportedFolders=computed(()=>countsStale.value?{}:folderCounts.value);
 let alive=true,resetting=false,ticket=0,actionTicket=0,listRead,moreRead,statusRead,actionRead,loadPromise,loadKey='',appliedKey='',searchTimer;
 const current=(request,identity,scope,sequence)=>alive&&auth.isLoggedIn&&identity===auth.identityRevision&&scope===key.value&&sequence===ticket&&!request.signal.aborted;
 function abortReads(){listRead?.abort();moreRead?.abort();statusRead?.abort();ticket++;listRead=moreRead=statusRead=undefined;loadPromise=undefined;loadKey='';loading.value=false;loadingMore.value=false;}
 function invalidateAction(){actionTicket++;actionRead?.abort();actionRead=undefined;busy.value=false;}
 function empty(){items.value=[];folders.value=[];total.value=undefined;unpinnedTotal.value=undefined;kindCounts.value={};folderCounts.value={};cursor.value=null;hasMore.value=false;countsStale.value=false;error.value='';actionError.value='';appliedKey='';}
 function clear(){clearTimeout(searchTimer);abortReads();invalidateAction();empty();}
 function apply(page,append){
  if(append){const byId=new Map(items.value.map(row=>[row.id,row]));for(const row of page.items)byId.set(row.id,{...row,statusUnknown:false});items.value=[...byId.values()];}else items.value=page.items.map(row=>({...row,statusUnknown:false}));
  folders.value=page.folders;total.value=page.total;unpinnedTotal.value=page.unpinnedTotal;kindCounts.value=page.kindCounts;folderCounts.value=page.folderCounts;cursor.value=page.nextCursor;hasMore.value=page.hasMore;error.value='';countsStale.value=false;appliedKey=key.value;clock.value=new Date();
 }
 function refresh({force=false}={}){
  if(!alive||!auth.isLoggedIn){clear();return Promise.resolve(false);}if(!force&&loadPromise&&loadKey===key.value)return loadPromise;
  abortReads();const scope=key.value,sequence=ticket,identity=auth.identityRevision,request=new AbortController(),value={...filter.value};listRead=request;loading.value=true;loadKey=scope;
  if(appliedKey!==scope){items.value=[];total.value=undefined;unpinnedTotal.value=undefined;kindCounts.value={};folderCounts.value={};cursor.value=null;hasMore.value=false;countsStale.value=false;}error.value='';
  const pending=(async()=>{try{const page=readConversationPage(await client.get(historyPath(value),{signal:request.signal}));if(!current(request,identity,scope,sequence))return false;apply(page,false);actionError.value='';return true;}catch{if(current(request,identity,scope,sequence))error.value='对话档案暂未打开，请稍后重试。';return false;}finally{if(sequence===ticket){loading.value=false;listRead=undefined;loadPromise=undefined;loadKey='';}}})();loadPromise=pending;return pending;
 }
 async function more(){
  if(!alive||!auth.isLoggedIn||loading.value||loadingMore.value||!hasMore.value||!cursor.value)return false;
  const request=new AbortController(),identity=auth.identityRevision,scope=key.value,sequence=ticket,value={...filter.value},point=cursor.value;moreRead=request;loadingMore.value=true;
  try{const page=readConversationPage(await client.get(historyPath(value,point),{signal:request.signal}));if(!current(request,identity,scope,sequence))return false;apply(page,true);return true;}catch{if(current(request,identity,scope,sequence))error.value='更早的对话暂未打开，已显示的内容会保留。';return false;}finally{if(moreRead===request){moreRead=undefined;loadingMore.value=false;}}
 }
 async function refreshStatus(){
  if(!alive||!auth.isLoggedIn||loading.value||loadingMore.value||statusRead||!items.value.length)return false;
  const request=new AbortController(),identity=auth.identityRevision,scope=key.value,sequence=ticket,ids=items.value.map(row=>row.id),value={...filter.value};statusRead=request;
  try{
   for(let offset=0;offset<ids.length;offset+=200){const batch=ids.slice(offset,offset+200),result=await client.post('/conversations/status',{ids:batch,scope:value.scope},{signal:request.signal});if(!current(request,identity,scope,sequence))return false;
    if(!Array.isArray(result?.items)||!Array.isArray(result?.missing)||result.items.some(row=>!batch.includes(row.id)||!Number.isSafeInteger(row.version)||row.version<1)||result.missing.some(id=>!batch.includes(id)))throw Error('status-response');const updates=new Map(result.items.map(row=>[row.id,row])),missing=new Set(result.missing);if(batch.some(id=>!updates.has(id)&&!missing.has(id)))throw Error('status-incomplete');
    items.value=items.value.flatMap(row=>{if(!batch.includes(row.id))return[row];const next=updates.get(row.id);if(!next||!matchesHistory(next,value)){countsStale.value=true;return[];}if(['title','pinned','folderId','appId','agentId'].some(field=>row[field]!==next[field]))countsStale.value=true;return[{...next,statusUnknown:false}];});
   }clock.value=new Date();return true;
  }catch{if(current(request,identity,scope,sequence)){items.value=items.value.map(row=>({...row,statusUnknown:true}));error.value='部分对话状态暂未核对，刷新后可继续整理。';}return false;}finally{if(statusRead===request)statusRead=undefined;}
 }
 function beginAction(){if(!alive||!auth.isLoggedIn||busy.value)return null;const sequence=++actionTicket,identity=auth.identityRevision,scope=key.value,request=new AbortController();actionRead=request;busy.value=true;return{identity,scope,sequence,request,current:()=>alive&&auth.isLoggedIn&&identity===auth.identityRevision&&scope===key.value&&sequence===actionTicket&&!request.signal.aborted};}
 function finishAction(action){if(action?.sequence===actionTicket){busy.value=false;actionRead=undefined;}}
 async function request(action,method,path,body){if(!action?.current())return null;try{const options={signal:action.request.signal},result=method==='get'?await client.get(path,options):method==='del'?await client.del(path,{...options,body}):await client[method](path,body,options);return action.current()?result:null;}catch(cause){if(!action.current())return null;actionError.value=[404,409].includes(cause?.status)?'记录已变化，请刷新后再操作。':[400,403,422].includes(cause?.status)?'这次整理未被接受，请检查后再试。':'操作结果暂未确认，请刷新查看。';throw cause;}}
 function filterChanged(next,old){if(resetting)return;clearTimeout(searchTimer);abortReads();invalidateAction();items.value=[];total.value=undefined;unpinnedTotal.value=undefined;kindCounts.value={};folderCounts.value={};cursor.value=null;hasMore.value=false;error.value='';actionError.value='';if(!auth.isLoggedIn)return;loading.value=true;const a=JSON.parse(next),b=old?JSON.parse(old):{};if(a.q!==b.q&&a.kind===b.kind&&a.folder===b.folder&&a.scope===b.scope)searchTimer=setTimeout(()=>void refresh(),debounceMs);else void refresh();}
 watch(key,filterChanged,{flush:'sync'});
 watch(()=>auth.identityRevision,()=>{resetting=true;try{clear();query.value='';folder.value='';trash.value=false;kind.value='chat';}finally{resetting=false;}},{flush:'sync'});
 onScopeDispose(()=>{alive=false;clear();});
 return{items,folders,total:reportedTotal,unpinnedTotal:reportedUnpinned,kindCounts:reportedKinds,folderCounts:reportedFolders,hasMore,loading,loadingMore,error,actionError,notice,busy,countsStale,clock,kind,query,folder,trash,filter,key,refresh,more,refreshStatus,beginAction,finishAction,request,clear};
}
