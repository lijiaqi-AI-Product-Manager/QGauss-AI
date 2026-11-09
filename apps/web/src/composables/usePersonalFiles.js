import {ref,watch,onScopeDispose} from 'vue';
import {api,fetchBlob} from '../api/client.js';
import {useAuth} from '../stores/auth.js';
export const personalFilesRevision=ref(0);

export function usePersonalFiles({client=api,loadBlob=fetchBlob,auth=useAuth()}={}){
 const open=ref(false),items=ref([]),loading=ref(false),error=ref(''),tab=ref('active'),kind=ref('all'),page=ref(1),total=ref(0),busyId=ref('');
 let alive=true,revision=0,read,download,q='',mutation=false;
 function cancel(){revision++;read?.abort();download?.abort();loading.value=false;busyId.value='';}
 async function refresh(){
  read?.abort();if(!open.value||!auth.isLoggedIn)return;
  const request=new AbortController(),ticket=++revision,identity=auth.identityRevision;read=request;loading.value=true;error.value='';
  const current=()=>alive&&open.value&&!request.signal.aborted&&ticket===revision&&identity===auth.identityRevision&&auth.isLoggedIn;
  try{const data=await client.get(`/upload?library=1&trash=${tab.value==='trash'?1:0}&kind=${kind.value}&page=${page.value}&pageSize=20&q=${encodeURIComponent(q)}`,{signal:request.signal});if(!current())return;items.value=data.items||[];total.value=data.total||0;if(page.value>1&&!items.value.length){page.value=Math.max(1,Math.ceil(total.value/20));void refresh();}}
  catch{if(current())error.value='个人文件暂未读到，请重新核对。';}
  finally{if(current())loading.value=false;}
 }
 function show(value='active'){tab.value=value==='trash'?'trash':'active';page.value=1;kind.value='all';q='';items.value=[];open.value=true;void refresh();}
 function close(){open.value=false;cancel();}
 function filter(field,value){if(field==='tab')tab.value=value==='trash'?'trash':'active';if(field==='kind')kind.value=['image','file'].includes(value)?value:'all';if(field==='search')q=String(value).slice(0,100);page.value=field==='page'?Math.max(1,Number(value)||1):1;items.value=[];void refresh();}
 async function change(file,action){
  if(mutation||!open.value||!auth.isLoggedIn||!Number.isSafeInteger(file.version))return;mutation=true;busyId.value=file.id;const identity=auth.identityRevision;
  let uncertain=false;
  try{await client.post(`/upload/${encodeURIComponent(file.id)}/${action}`,{expectedVersion:file.version});}
  catch{uncertain=true;}
  finally{if(alive&&identity===auth.identityRevision){mutation=false;busyId.value='';personalFilesRevision.value++;await refresh();if(uncertain&&!error.value&&open.value)error.value='操作结果暂未确认，已重新核对文件列表。';}}
 }
 async function saveDownload(file){
  if(!auth.isLoggedIn||!file?.id||busyId.value)return;download?.abort();const request=new AbortController(),identity=auth.identityRevision;download=request;busyId.value=file.id;
  try{const blob=await loadBlob(`/api/upload/${encodeURIComponent(file.id)}/raw`,{signal:request.signal});if(!alive||request.signal.aborted||identity!==auth.identityRevision||!auth.isLoggedIn)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.filename||'QGauss-file';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch{if(alive&&!request.signal.aborted&&identity===auth.identityRevision)error.value='文件暂未取回，请重新核对。';}
  finally{if(alive&&identity===auth.identityRevision)busyId.value='';}
 }
 watch(()=>auth.identityRevision,()=>{close();items.value=[];error.value='';mutation=false;});
 onScopeDispose(()=>{alive=false;cancel();});
 return{open,items,loading,error,tab,kind,page,total,busyId,show,close,filter,refresh,change,download:saveDownload};
}
