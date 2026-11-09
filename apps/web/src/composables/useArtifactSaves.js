import {ref,watch,onScopeDispose} from 'vue';
import {api} from '../api/client.js';
import {useAuth} from '../stores/auth.js';
import {personalFilesRevision} from './usePersonalFiles.js';

const ongoing=new Set(['queued','fetching','storing','verifying']);
/** Reading a receipt never submits another save or generation. */
export function useArtifactSaves(messageId,enabled,{client=api,auth=useAuth()}={}){
 const receipts=ref({}),checking=ref(false),checkingError=ref(false);
 let alive=true,revision=0,read,timer,posting=false,emptyReads=0;
 const stop=()=>{revision++;read?.abort();clearTimeout(timer);checking.value=false;posting=false;};
 async function refresh(){
  clearTimeout(timer);read?.abort();if(!alive||!enabled.value||!messageId.value||!auth.isLoggedIn)return;
  const request=new AbortController(),version=++revision,identity=auth.identityRevision,id=messageId.value;read=request;checking.value=true;
  const current=()=>alive&&!request.signal.aborted&&version===revision&&auth.identityRevision===identity&&auth.isLoggedIn&&messageId.value===id;
  try{const data=await client.get(`/agents/messages/${encodeURIComponent(id)}/artifacts`,{signal:request.signal});if(!current())return;if(!data.items?.length){checkingError.value=true;if(++emptyReads<=8)timer=setTimeout(refresh,1800);return;}emptyReads=0;receipts.value=Object.fromEntries(data.items.map(item=>[item.key,item]));checkingError.value=false;if(Object.values(receipts.value).some(item=>ongoing.has(item.status)))timer=setTimeout(refresh,1800);}
  catch{if(current())checkingError.value=true;}
  finally{if(current())checking.value=false;}
 }
 async function save(key){
  const receipt=receipts.value[key];if(posting||!enabled.value||!receipt||!['unsaved','failed','removed'].includes(receipt.status)||!auth.isLoggedIn)return;
  const identity=auth.identityRevision,id=messageId.value;posting=true;receipts.value={...receipts.value,[key]:{...receipt,status:'queued'}};
  try{await client.post(`/agents/messages/${encodeURIComponent(id)}/artifacts/${key}/save`,{expectedVersion:receipt.version});}
  catch{/* The server may have accepted it. Resolve the original receipt first. */}
  finally{if(alive&&auth.identityRevision===identity&&messageId.value===id){posting=false;await refresh();}}
 }
 watch([messageId,enabled,()=>auth.identityRevision,personalFilesRevision],()=>{stop();emptyReads=0;receipts.value={};checkingError.value=false;void refresh();},{immediate:true});
 onScopeDispose(()=>{alive=false;stop();});
 return{receipts,checking,checkingError,save,refresh};
}
