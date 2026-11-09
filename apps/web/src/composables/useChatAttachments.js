import {computed,ref,reactive,watch,onScopeDispose} from 'vue';
import {api,uploadChatFile} from '../api/client.js';
import {useAuth} from '../stores/auth.js';
import {personalFilesRevision} from './usePersonalFiles.js';

const IMAGE=new Set(['image/png','image/jpeg','image/webp','image/gif']);
const WAITING=new Set(['queued','uploading','checking','storing','verifying']);
export function useChatAttachments({client=api,transfer=uploadChatFile,auth=useAuth(),notify=()=>{},environment=globalThis}={}){
 const files=ref([]),checking=ref(false),readyFiles=computed(()=>files.value.filter(file=>file.status==='done')),uploading=computed(()=>files.value.some(file=>WAITING.has(file.status))),blocked=computed(()=>files.value.some(file=>file.status!=='done'));
 const sources=new Map(),requests=new Map(),timers=new Map(),previews=new Set(),previewById=new Map();let alive=true,preflight,sequence=0;
 const current=(file,identity)=>alive&&auth.isLoggedIn&&auth.identityRevision===identity&&files.value.includes(file);
 function clearWork(localId){requests.get(localId)?.abort();requests.delete(localId);clearTimeout(timers.get(localId));timers.delete(localId);}
 function apply(file,receipt){
  file.version=Number.isSafeInteger(receipt?.version)?receipt.version:file.version;
  if(receipt?.status==='stored'&&receipt.file?.id){file.id=receipt.file.id;file.name=receipt.file.filename;file.size=receipt.file.size;file.kind=IMAGE.has(receipt.file.mime)?'image':'document';file.status='done';file.error='';file.canRetry=false;sources.delete(file.localId);}
  else if(receipt?.status==='failed'){file.status='error';file.error=receipt.error||'文件暂未存好，可以稍后重新上传。';}
  else if(receipt?.status==='unavailable'){file.status='unavailable';file.error='这份文件已不可用，请恢复文件或重新选择。';}
  else if(['storing','verifying'].includes(receipt?.status)){file.status=receipt.status;file.error='';}
  else{file.status='unknown';file.error='上传结果暂未确认，请核对原上传。';}
 }
 function schedule(file,attempt){if(attempt>=30){file.status='unknown';file.error='上传结果暂未确认，请核对原上传。';return;}timers.set(file.localId,setTimeout(()=>{void inspect(file,attempt+1);},1200));}
 async function inspect(file,attempt=0){
  if(!file.requestKey)return checkOne(file);if(!files.value.includes(file)||!auth.isLoggedIn)return;clearWork(file.localId);const request=new AbortController(),identity=auth.identityRevision;requests.set(file.localId,request);file.status='checking';file.error='';
  try{const receipt=await client.get('/upload/requests/'+encodeURIComponent(file.requestKey),{signal:request.signal});if(!current(file,identity)||request.signal.aborted)return;apply(file,receipt);if(['storing','verifying'].includes(file.status))schedule(file,attempt);}
  catch(error){if(!current(file,identity)||request.signal.aborted)return;if(error?.status===404){file.status='error';file.version=0;file.error='暂未找到完成的上传，可以重新上传原文件。';}else{file.status='unknown';file.error='上传结果暂未确认，请核对原上传。';}}
  finally{if(requests.get(file.localId)===request)requests.delete(file.localId);pump();}
 }
 function pump(){if(!alive||!auth.isLoggedIn)return;const active=files.value.filter(file=>['uploading','checking','storing','verifying'].includes(file.status)).length;for(const file of files.value.filter(file=>file.status==='queued').slice(0,Math.max(0,3-active)))void start(file);}
 async function start(file){
  const original=sources.get(file.localId);if(!original||!files.value.includes(file)||!auth.isLoggedIn)return;clearWork(file.localId);const request=new AbortController(),identity=auth.identityRevision;requests.set(file.localId,request);file.status='uploading';file.error='';
  try{const receipt=await transfer(original,file.requestKey,file.version,{signal:request.signal});if(!current(file,identity)||request.signal.aborted)return;apply(file,receipt);if(['storing','verifying'].includes(file.status))schedule(file,0);}
  catch(error){if(current(file,identity)&&!request.signal.aborted){await inspect(file);if(current(file,identity)&&file.status==='error'&&[400,413,415,422,429].includes(error?.status))file.error=({413:'附件超过当前文件大小上限',415:'这个附件格式暂不支持上传',429:'还有附件正在保存，请稍后重新上传'})[error.status]||'附件未通过检查，请重新选择原文件。';}}
  finally{if(requests.get(file.localId)===request)requests.delete(file.localId);pump();}
 }
 function add(list){
  if(!auth.isLoggedIn)return;const room=9-files.value.length;if(room<=0){notify('一条消息最多附带 9 个文件');return;}if(list.length>room)notify('最多还能添加 {count} 个文件，多出的已忽略',{count:room});
  for(const original of [...list].slice(0,room)){const requestKey=environment.crypto.randomUUID(),localId='upload-'+requestKey,kind=IMAGE.has(original.type)?'image':'document',preview=kind==='image'?environment.URL.createObjectURL(original):'';if(preview){previews.add(preview);previewById.set(localId,preview);}const file=reactive({localId,requestKey,name:original.name||'QGauss-file',size:original.size,kind,preview,status:'queued',id:'',version:0,error:'',canRetry:true});sources.set(localId,original);files.value.push(file);}pump();
 }
 function remove(file){clearWork(file.localId);sources.delete(file.localId);if(previews.delete(file.preview))environment.URL.revokeObjectURL(file.preview);files.value=files.value.filter(item=>item!==file);pump();}
 function retainPreview(file){previews.delete(file.preview);return file.preview;}
 async function retry(file){if(file.status!=='error'||!current(file,auth.identityRevision)||!sources.has(file.localId))return;await inspect(file);if(file.status==='error'&&current(file,auth.identityRevision)){file.status='queued';pump();}}
 async function verify(items){
  preflight?.abort();const request=new AbortController(),ticket=++sequence,identity=auth.identityRevision,ids=items.map(file=>file.id);preflight=request;checking.value=true;
  const valid=()=>alive&&!request.signal.aborted&&ticket===sequence&&auth.isLoggedIn&&auth.identityRevision===identity&&items.every(file=>files.value.includes(file));
  try{const result=await client.post('/upload/attachments/check',{ids},{signal:request.signal});if(!valid())return false;let okay=true;for(const file of items){const row=result.items?.find(item=>item.id===file.id);if(row?.status==='available'){file.status='done';file.error='';}else{okay=false;file.status=row?.status==='unavailable'?'unavailable':'check-failed';file.error=row?.reason==='unreadable'?'这个文档暂不能读取，请更换文件后重试。':row?.status==='unavailable'?'这份文件已不可用，请恢复文件或重新选择。':'文件暂未核对，请稍后重试。';}}return okay;}
  catch{if(valid())for(const file of items){file.status='check-failed';file.error='文件暂未核对，请稍后重试。';}return false;}
  finally{if(ticket===sequence)checking.value=false;}
 }
 async function checkOne(file){if(file.id&&files.value.includes(file))await verify([file]);}
 async function checkBeforeSend(){if(!files.value.length)return true;if(blocked.value)return false;return verify([...files.value]);}
 function clear(){preflight?.abort();sequence++;checking.value=false;for(const file of files.value)clearWork(file.localId);for(const url of previews)environment.URL.revokeObjectURL(url);previews.clear();previewById.clear();sources.clear();files.value=[];}
 watch(()=>files.value.map(file=>file.localId),(ids,old=[])=>{const kept=new Set(ids);for(const id of old)if(!kept.has(id)){clearWork(id);sources.delete(id);const url=previewById.get(id);if(previews.delete(url))environment.URL.revokeObjectURL(url);previewById.delete(id);}pump();},{flush:'sync'});
 watch(()=>auth.identityRevision,clear,{flush:'sync'});
 watch(personalFilesRevision,()=>{const items=files.value.filter(file=>file.id&&!WAITING.has(file.status));if(items.length)void verify(items);for(const file of files.value)if(!file.id&&file.requestKey&&file.status==='unavailable')void inspect(file);});
 onScopeDispose(()=>{alive=false;clear();});
 return{files,readyFiles,uploading,blocked,checking,add,remove,inspect,retry,checkOne,checkBeforeSend,retainPreview,clear};
}
