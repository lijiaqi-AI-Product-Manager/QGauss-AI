import {computed,nextTick,onBeforeUnmount,reactive,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {api} from '../api/client.js';
import {latestImageEditorTransfer,readImageEditorTransfer,removeImageEditorTransfer} from '../lib/image-editor-transfer.js';

export function useImageEditorEntry({auth,apply,hasDraft=()=>false,canApply=()=>true,currentModel=()=>''}){
 const route=useRoute(),router=useRouter(),state=reactive({present:route.query.editor!==undefined,pending:route.query.editor!==undefined,error:'',offered:null,applied:false,record:null,sourceModel:''});
 let alive=true,initialized=false,revision=0,read,key=null;
 const current=(own,user,identity)=>alive&&own===revision&&auth.isLoggedIn&&auth.user?.id===user&&auth.identityRevision===identity;
 async function open({confirmed=false}={}){
  read?.abort();const own=++revision,user=auth.user?.id,identity=auth.identityRevision;key=route.query.editor??(route.query.gallery===undefined?latestImageEditorTransfer(user):null);
  Object.assign(state,{present:key!==null&&key!==undefined,pending:key!==null&&key!==undefined,error:'',offered:null,applied:false,record:null,sourceModel:''});if(!state.present||!auth.isLoggedIn){state.pending=false;return;}
  if(route.query.gallery!==undefined){state.pending=false;state.error='当前有两份创作设定，请先保留其中一份后再继续。';return;}
  read=new AbortController();
  try{
   const record=readImageEditorTransfer(user,key),query=new URLSearchParams({sourceId:record.sourceId,...(record.maskId?{maskId:record.maskId}:{})}),inputs=await api.get('/image/editor/inputs?'+query,{signal:read.signal,retry:false});
   if(!current(own,user,identity)||read.signal.aborted)return;if(inputs?.source?.id!==record.sourceId||(inputs.mask?.id||null)!==record.maskId)throw Error('重绘图片与选区不一致，请回到编辑台重新带入。');state.record=record;
   if(!canApply()){state.offered={record,inputs};state.error='当前绘画参数尚未就绪，或还有提交等待处理。请完成核对后再带入。';return;}
   if(!confirmed&&hasDraft()){state.offered={record,inputs};return;}
   state.sourceModel=record.returnDraft?.model??currentModel();state.applied=true;await apply({record,inputs});await nextTick();
  }catch(error){if(current(own,user,identity)&&error.name!=='AbortError'){state.applied=false;state.error=error.status===404?'原图或选区已移除，当前绘画草稿已保留。':error.message||'重绘设定暂时无法读取，请重新核对。';}}
  finally{if(current(own,user,identity))state.pending=false;}
 }
 function cancel(){read?.abort();revision++;if(typeof key==='string')removeImageEditorTransfer(auth.user?.id,key);Object.assign(state,{present:false,pending:false,error:'',offered:null,applied:false,record:null,sourceModel:''});const query={...route.query};delete query.editor;void router.replace({path:route.path,query});}
 watch(()=>route.query.editor,(value,previous)=>{if(initialized&&value!==previous)void open();});
 watch(()=>route.query.gallery,(value,previous)=>{if(initialized&&value!==previous&&state.present)void open();});
 watch([()=>auth.user?.id,()=>auth.identityRevision],()=>{read?.abort();revision++;state.offered=state.record=null;state.applied=state.pending=false;state.error=state.present?'账户已变化，请重新打开本账号的重绘设定。':'';});
 onBeforeUnmount(()=>{alive=false;revision++;read?.abort();});
 return Object.assign(state,{blocked:computed(()=>state.present&&(state.pending||!!state.error||!!state.offered||!state.applied)),initialize(){initialized=true;return open();},retry:()=>open(),confirm:()=>open({confirmed:true}),cancel});
}
