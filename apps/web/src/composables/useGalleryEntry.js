import {computed,nextTick,onBeforeUnmount,reactive,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {api} from '../api/client.js';

/** Public settings are read again at the destination; entering a workspace never submits a task. */
export function useGalleryEntry({auth,target,apply,beforeRead=()=>{},hasDraft=()=>false,canApply=()=>true}){
 const route=useRoute(),router=useRouter();
 const state=reactive({present:route.query.gallery!==undefined,pending:route.query.gallery!==undefined,error:'',offered:null,source:null,applied:false,sourceDraft:null});
 let alive=true,initialized=false,revision=0,read;
 const current=(own,identity,user)=>alive&&auth.isLoggedIn&&own===revision&&auth.identityRevision===identity&&auth.user?.id===user;
 function validKey(value){if(typeof value!=='string'||value.length>140)return null;const match=/^(image|mj|video):([A-Za-z0-9_-]{1,128})$/.exec(value);return match?{kind:match[1],id:match[2]}:null;}
 async function open({confirmed=false}={}){
  read?.abort();const own=++revision,key=route.query.gallery,identity=auth.identityRevision,user=auth.user?.id,parsed=validKey(key);
  state.present=key!==undefined;state.pending=state.present;state.error='';state.offered=null;state.applied=false;state.source=null;state.sourceDraft=null;
  if(!state.present||!auth.isLoggedIn){state.pending=false;return;}
  if(!parsed||({image:'/painting',mj:'/mj',video:'/video'})[parsed.kind]!==target){state.pending=false;state.error='这份作品与当前创作入口不匹配，请回到作品广场重新选择。';return;}
  beforeRead();read=new AbortController();
  try{
   const value=await api.get('/gallery/works/'+parsed.kind+'/'+encodeURIComponent(parsed.id)+'/reuse',{signal:read.signal,retry:false});
   if(!current(own,identity,user)||read.signal.aborted)return;
   const draft=value?.draft;
   if(value?.key!==key||value.target!==target||typeof value.title!=='string'||!draft||typeof draft!=='object'||Array.isArray(draft)||typeof draft.prompt!=='string'||!draft.prompt.trim()||draft.prompt.length>8000||Object.keys(draft).length>30||!Object.values(draft).every(item=>item===null||['string','boolean','number'].includes(typeof item)&&!(typeof item==='number'&&!Number.isFinite(item))))throw Error('公开作品的创作设定不完整，请重新核对。');
   state.source={key,title:value.title,author:typeof value.author==='string'?value.author:'QGauss 创作者',note:typeof value.note==='string'?value.note:''};
   if(!canApply()){state.offered=value;state.error='当前创作参数尚未就绪，或有提交等待处理。请先完成核对，或暂不带入这份作品。';return;}
   if(!confirmed&&hasDraft()){state.offered=value;return;}
   state.sourceDraft={...draft};state.applied=true;await apply({...draft});await nextTick();
   if(!current(own,identity,user))return;
  }catch(error){if(current(own,identity,user)&&error.name!=='AbortError'){state.applied=false;state.sourceDraft=null;state.error=error.status===404?'这份作品已撤回或当前不可用，原草稿没有被替换。':error.message||'作品设定暂未打开，请重新核对。';}}
  finally{if(current(own,identity,user))state.pending=false;}
 }
 function initialize(){initialized=true;return open();}
 function confirm(){return open({confirmed:true});}
 function cancel(){read?.abort();revision++;state.present=state.pending=state.applied=false;state.offered=state.source=state.sourceDraft=null;state.error='';const query={...route.query};delete query.gallery;void router.replace({path:route.path,query});}
 watch(()=>route.query.gallery,(value,previous)=>{if(value!==previous&&initialized)void open();});
 watch([()=>auth.user?.id,()=>auth.identityRevision],()=>{read?.abort();revision++;state.source=state.sourceDraft=state.offered=null;state.applied=state.pending=false;state.error=state.present?'账户已变化，请重新核对这份作品后再创作。':'';});
 onBeforeUnmount(()=>{alive=false;revision++;read?.abort();});
 return Object.assign(state,{blocked:computed(()=>state.present&&(state.pending||!!state.error||!!state.offered||!state.applied)),initialize,retry:()=>open(),confirm,cancel});
}
