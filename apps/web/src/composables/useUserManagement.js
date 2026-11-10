import {computed,onScopeDispose,reactive,ref,watch} from 'vue';
import {api} from '../api/client.js';
import {useAuth} from '../stores/auth.js';
import {USER_FILTERS,emptyGrant,userSearch,userPage,userDetail,grantPayload,readGrant,grantReceipt} from '../lib/user-management.js';

export function useUserManagement({client=api,auth=useAuth(),storage,key=()=>globalThis.crypto.randomUUID()}={}) {
  if(storage===undefined){try{storage=globalThis.sessionStorage;}catch{storage=null;}}
  const filters=reactive({...USER_FILTERS}),rows=ref([]),total=ref(0),active=ref(0),admins=ref(0),page=ref(1),pageSize=20,applied=ref(null),appliedDraft=ref(''),loading=ref(false),error=ref('');
  const selectedId=ref(''),detail=ref(null),detailLoading=ref(false),detailError=ref(''),activity=ref([]),activityKind=ref('grants'),activityPage=ref(1),activityTotal=ref(0),activityLoading=ref(false),activityError=ref('');
  const grantForm=reactive(emptyGrant()),grantStage=ref('closed'),grantReview=ref(null),pending=ref(null),mutationBusy=ref(false),mutationError=ref(''),notice=ref(''),receipt=ref(null),statusReview=ref(null);
  let alive=true,listRead,detailRead,activityRead,mutationRead,sequence=0,lastAttempt,activityAttempt;
  const allowed=()=>alive&&auth.isLoggedIn&&auth.user?.role==='ADMIN',current=(read,identity)=>allowed()&&!read.signal.aborted&&auth.identityRevision===identity;
  const storageKey=actor=>'qg:user-grant:'+actor;
  function restore(){try{pending.value=readGrant(storage?.getItem(storageKey(auth.user?.id)),auth.user?.id);}catch{pending.value=null;}}
  function persist(value){if(!storage)throw Error('无法保存本次核对，请检查浏览器存储后重试');storage.setItem(storageKey(value.actorId),JSON.stringify(value));if(!readGrant(storage.getItem(storageKey(value.actorId)),value.actorId))throw Error('无法保存本次核对，请检查浏览器存储后重试');}
  function removePending(value){try{const item=readGrant(storage?.getItem(storageKey(value.actorId)),value.actorId);if(item?.payload.requestKey===value.payload.requestKey)storage.removeItem(storageKey(value.actorId));}catch{/* A retained receipt can be safely recovered using its original request. */}pending.value=null;}
  function closeDetail(){detailRead?.abort();activityRead?.abort();activityAttempt=undefined;selectedId.value='';detail.value=null;detailError.value='';detailLoading.value=false;activity.value=[];activityTotal.value=0;activityError.value='';activityLoading.value=false;grantStage.value='closed';grantReview.value=null;statusReview.value=null;}
  async function load(query,targetPage,reset=false,draft=appliedDraft.value){
    if(!allowed())return false;const read=new AbortController(),identity=auth.identityRevision,ticket=++sequence;listRead?.abort();listRead=read;loading.value=true;error.value='';lastAttempt={query:{...query},targetPage,reset,draft};
    if(reset){rows.value=[];total.value=0;active.value=0;admins.value=0;page.value=1;applied.value=null;}
    try{const params=new URLSearchParams({...query,page:String(targetPage),pageSize:String(pageSize)}),data=userPage(await client.get('/users?'+params,{signal:read.signal}),targetPage,pageSize);
      if(!current(read,identity)||ticket!==sequence)return false;
      const last=Math.max(1,Math.ceil(data.total/pageSize));if(targetPage>last)return load({...query,asOf:data.asOf},last,reset,draft);
      rows.value=data.items;total.value=data.total;active.value=data.active;admins.value=data.admins;page.value=targetPage;applied.value={...query,asOf:data.asOf};appliedDraft.value=draft;return true;
    }catch(cause){if(current(read,identity)&&ticket===sequence)error.value=cause.status===403?'当前账号无权管理用户':'用户暂未读取完整，请重试';return false;}
    finally{if(listRead===read){listRead=undefined;loading.value=false;}}
  }
  async function search(){try{return await load(userSearch(filters),1,true,JSON.stringify(filters));}catch(cause){error.value=cause.message;return false;}}
  const reset=()=>{Object.assign(filters,USER_FILTERS);return search();};
  const retry=()=>lastAttempt?load(lastAttempt.query,lastAttempt.targetPage,lastAttempt.reset,lastAttempt.draft):search();
  const refresh=()=>applied.value?load({...applied.value},page.value):search();
  const goPage=target=>!loading.value&&applied.value&&Number.isSafeInteger(target)&&target>0&&target<=Math.max(1,Math.ceil(total.value/pageSize))?load({...applied.value},target):false;
  async function loadActivity(kind=activityKind.value,targetPage=1){
    if(!allowed()||!selectedId.value||!['grants','logins','conversations','management'].includes(kind))return false;
    const read=new AbortController(),identity=auth.identityRevision,id=selectedId.value;activityRead?.abort();activityRead=read;activityAttempt={id,kind,page:targetPage};activityLoading.value=true;activityError.value='';
    const changed=kind!==activityKind.value;activityKind.value=kind;if(changed){activity.value=[];activityTotal.value=0;activityPage.value=1;}
    try{const params=new URLSearchParams({kind,page:String(targetPage),pageSize:'10'});if(detail.value?.readAt)params.set('asOf',detail.value.readAt);const data=await client.get('/users/'+encodeURIComponent(id)+'/activity?'+params,{signal:read.signal});
      if(!current(read,identity)||activityRead!==read||selectedId.value!==id)return false;
      if(!data||data.userId!==id||data.kind!==kind||data.page!==targetPage||data.pageSize!==10||!Array.isArray(data.items)||data.items.length>10||!Number.isSafeInteger(data.total)||data.total<0)throw Error('incomplete activity');
      const last=Math.max(1,Math.ceil(data.total/10));if(targetPage>last)return loadActivity(kind,last);
      activity.value=data.items;activityTotal.value=data.total;activityPage.value=targetPage;return true;
    }catch{if(current(read,identity)&&activityRead===read)activityError.value='用户明细暂未读取完整，请重试';return false;}
    finally{if(activityRead===read){activityRead=undefined;activityLoading.value=false;}}
  }
  const retryActivity=()=>activityAttempt?.id===selectedId.value?loadActivity(activityAttempt.kind,activityAttempt.page):loadActivity();
  async function openDetail(id,{preserve=false,quiet=false}={}){
    if(!allowed()||!/^[A-Za-z0-9_-]{1,128}$/.test(id))return false;
    const keep=quiet&&preserve&&detail.value?.id===id&&selectedId.value===id;detailRead?.abort();activityRead?.abort();const read=new AbortController(),identity=auth.identityRevision;detailRead=read;selectedId.value=id;if(!keep)detail.value=null;detailLoading.value=!keep;detailError.value='';
    if(!preserve){activity.value=[];activityTotal.value=0;activityPage.value=1;activityKind.value='grants';grantStage.value='closed';grantReview.value=null;statusReview.value=null;mutationError.value='';receipt.value=null;}
    try{const data=await client.get('/users/'+encodeURIComponent(id),{signal:read.signal});if(!current(read,identity)||detailRead!==read||selectedId.value!==id)return false;
      detail.value=userDetail(data,id);await loadActivity(activityKind.value,activityPage.value);return current(read,identity)&&detailRead===read&&selectedId.value===id&&detail.value?.id===id;
    }catch(cause){if(current(read,identity)&&detailRead===read){if(keep)mutationError.value=cause.status===404?'用户不存在或已移除':'用户资料暂未打开，请重试';else detailError.value=cause.status===404?'用户不存在或已移除':'用户资料暂未打开，请重试';}return false;}
    finally{if(detailRead===read){detailRead=undefined;detailLoading.value=false;}}
  }
  function editGrant(){if(!detail.value||mutationBusy.value||pending.value||detail.value.status!=='ACTIVE')return false;Object.assign(grantForm,emptyGrant());grantStage.value='edit';grantReview.value=null;statusReview.value=null;mutationError.value='';receipt.value=null;return true;}
  function reviewGrant(){if(!detail.value||mutationBusy.value||pending.value)return false;try{const payload=grantPayload(grantForm,detail.value);grantReview.value={actorId:auth.user.id,target:{id:detail.value.id,username:detail.value.username,email:detail.value.email},payload:Object.freeze({...payload,requestKey:key()})};grantStage.value='review';mutationError.value='';return true;}catch(cause){mutationError.value=cause.message;return false;}}
  async function resumeGrant(){const intent=pending.value;if(!intent||mutationBusy.value)return false;const result=await openDetail(intent.target.id);if(!result)return false;if(pending.value?.payload.requestKey!==intent.payload.requestKey)return false;grantReview.value=intent;grantStage.value='review';return true;}
  function backToEdit(){if(mutationBusy.value)return false;if(pending.value){if(pending.value.state!=='rejected')return false;const payload=pending.value.payload;Object.assign(grantForm,emptyGrant(),Object.fromEntries(Object.keys(emptyGrant()).filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]])));removePending(pending.value);}grantStage.value='edit';grantReview.value=null;mutationError.value='';return true;}
  async function confirmGrant(){
    const review=grantReview.value;if(!allowed()||!review||mutationBusy.value||review.actorId!==auth.user.id)return false;
    const hadUnknown=pending.value?.state==='uncertain',intent={...review,state:'uncertain'},read=new AbortController(),identity=auth.identityRevision;
    try{persist(intent);}catch(cause){mutationError.value=cause.message;return false;}
    pending.value=intent;mutationBusy.value=true;mutationError.value='';notice.value='';mutationRead=read;
    const timer=setTimeout(()=>read.abort(),20000);
    try{const result=await client.post('/balance/upgradeBalance',intent.payload,{signal:read.signal});
      if(!current(read,identity)||mutationRead!==read)return false;if(!grantReceipt(result,intent.payload))throw Error('incomplete receipt');
      removePending(intent);notice.value='权益已发放，凭据已保存';
      if(selectedId.value===intent.target.id){receipt.value=result;grantStage.value='done';activityKind.value='grants';activityPage.value=1;}
      await refresh();if(selectedId.value===intent.target.id)await openDetail(intent.target.id,{preserve:true});return true;
    }catch(cause){
      if(allowed()&&identity===auth.identityRevision&&mutationRead===read){
        if(!hadUnknown&&[400,403,404,409,422].includes(cause.status)){intent.state='rejected';try{persist(intent);}catch{}pending.value=intent;mutationError.value=cause.status===404?'商业化未开启或用户已移除，请核对后再发放':cause.status===409?'用户资料或发放内容已变化，请重新核对':'本次发放未获接受，请核对内容与权限';}
        else mutationError.value='发放结果暂未确认，请继续核对原请求';
      }return false;
    }finally{clearTimeout(timer);if(mutationRead===read){mutationRead=undefined;mutationBusy.value=false;}}
  }
  function dismissRejected(){if(mutationBusy.value||pending.value?.state!=='rejected')return false;removePending(pending.value);grantReview.value=null;grantStage.value='closed';mutationError.value='';return true;}
  function reviewStatus(){if(!detail.value||mutationBusy.value||pending.value||(detail.value.id===auth.user.id&&detail.value.status==='ACTIVE'))return false;statusReview.value={...detail.value,next:detail.value.status==='ACTIVE'?'DISABLED':'ACTIVE'};grantStage.value='closed';mutationError.value='';return true;}
  async function confirmStatus(){
    const review=statusReview.value;if(!allowed()||!review||mutationBusy.value)return false;const identity=auth.identityRevision,read=new AbortController();mutationRead=read;mutationBusy.value=true;mutationError.value='';const timer=setTimeout(()=>read.abort(),20000);
    try{const data=await client.patch('/users/'+encodeURIComponent(review.id)+'/status',{status:review.next,expectedUpdatedAt:review.updatedAt},{signal:read.signal});if(!current(read,identity)||mutationRead!==read)return false;if(data?.id!==review.id||data.status!==review.next)throw Error('incomplete status');statusReview.value=null;notice.value='账号状态已更新';await refresh();if(selectedId.value===review.id)await openDetail(review.id,{preserve:true});return true;}
    catch(cause){if(allowed()&&identity===auth.identityRevision&&mutationRead===read)mutationError.value=cause.status===409?'用户资料已变化，请重新读取后核对':'状态更新暂未确认，请重试或重新读取';return false;}
    finally{clearTimeout(timer);if(mutationRead===read){mutationRead=undefined;mutationBusy.value=false;}}
  }
  function clear(){sequence++;listRead?.abort();closeDetail();mutationRead?.abort();mutationRead=undefined;mutationBusy.value=false;rows.value=[];total.value=0;active.value=0;admins.value=0;page.value=1;loading.value=false;applied.value=null;appliedDraft.value='';error.value='';mutationError.value='';notice.value='';pending.value=null;receipt.value=null;lastAttempt=undefined;Object.assign(filters,USER_FILTERS);}
  watch(()=>[auth.identityRevision,auth.user?.id,auth.user?.role,auth.isLoggedIn],()=>{clear();if(allowed())restore();},{flush:'sync'});
  onScopeDispose(()=>{clear();alive=false;});if(allowed())restore();
  return {filters,rows,total,active,admins,page,pageSize,applied,dirty:computed(()=>!!applied.value&&JSON.stringify(filters)!==appliedDraft.value),loading,error,search,reset,retry,refresh,goPage,
    selectedId,detail,detailLoading,detailError,openDetail,closeDetail,activity,activityKind,activityPage,activityTotal,activityLoading,activityError,loadActivity,retryActivity,
    grantForm,grantStage,grantReview,pending,mutationBusy,mutationError,notice,receipt,editGrant,reviewGrant,resumeGrant,backToEdit,confirmGrant,dismissRejected,statusReview,reviewStatus,confirmStatus,
    ownId:computed(()=>auth.user?.id)};
}
