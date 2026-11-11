<template>
 <section class="qex-access" :aria-label="ct(purpose==='link'?'扫码身份':'扫码登录')">
  <header class="qex-story"><span>QGAUSS / A FAMILIAR SIGNAL</span><h3>{{ct('一束光，连回你的空间。')}}</h3><p>{{ct('用自己的手机确认，继续这份灵感。')}}</p></header>
  <div v-if="!policy" class="qex-service" role="status"><BrandLoader v-if="policyLoading" :size="20"/><span>{{ct(policyLoading?'正在确认扫码服务…':'暂时无法确认扫码服务，请重新读取。')}}</span><button v-if="!policyLoading" type="button" @click="loadPolicy">{{ct('重新读取')}}</button></div>
  <p v-else-if="!policy.ready" class="qex-service" role="status">{{ct('扫码服务暂未开放，邮箱和手机密码仍可登录。')}}</p>
  <p v-if="route.query.externalReturn==='unconfirmed'" class="qex-notice" role="status">{{ct('这次返回尚未确认。请回到发起连接的浏览器核对，或结束后重新准备。')}}</p>
  <div v-if="!pending&&policy?.ready" class="qex-methods" :aria-label="ct('扫码连接')"><button v-if="policy.methods.qr" type="button" :aria-pressed="method==='qr'" :disabled="blocked||working" @click="method='qr'">{{ct('扫码连接')}}</button><button v-if="policy.methods.browser&&insideApp" type="button" :aria-pressed="method==='browser'" :disabled="blocked||working" @click="method='browser'">{{ct('应用内连接')}}</button></div>
  <div class="qex-signal" :class="['is-'+status,{'has-code':!!qrImage}]" :aria-busy="working">
   <i class="qex-orbit qex-orbit-one" aria-hidden="true"></i><i class="qex-orbit qex-orbit-two" aria-hidden="true"></i><span class="qex-spark qex-spark-one" aria-hidden="true">✦</span><span class="qex-spark qex-spark-two" aria-hidden="true">✧</span>
   <div v-if="qrImage" class="qex-code"><img :src="qrImage" :alt="ct('扫码连接图')" width="208" height="208"/><span class="qex-scan-line" aria-hidden="true"></span></div>
   <div v-else class="qex-object" :aria-label="ct('二维码尚未生成')"><span class="qex-object-edge"></span><span class="qex-object-face"><BrandLoader v-if="status==='preparing'" :size="46"/><b v-else aria-hidden="true">{{status==='confirmed'||status==='applied'?'✓':status==='expired'?'↻':'Q'}}</b><small>QGAUSS</small></span><span class="qex-object-shine"></span></div>
   <span class="qex-ground" aria-hidden="true"></span>
  </div>
  <div class="qex-result" role="status" aria-live="polite"><span class="qex-status-light" :class="'is-'+status"></span><strong>{{ct(statusText)}}</strong><small v-if="pending&&remaining>0&&['preparing','waiting','confirmed'].includes(status)">{{ct('{seconds} 秒后到期',{seconds:remaining})}}</small></div>
  <p class="qex-explain">{{ct(qrImage?'请使用本人微信扫码，并在手机上确认。':purpose==='link'?'连接只会关联当前账户，作品、余额和密码都会保留。':'仅当前浏览器能接回这次登录。')}}</p>
  <label v-if="!pending&&purpose==='login'&&policy?.inviteRequired" class="qex-invite">{{ct('邀请码（选填）')}}<input v-model="inviteCode" autocomplete="off" maxlength="64" :disabled="working||blocked"/></label>
  <p v-if="error" class="qex-error" role="alert">{{ct(error)}}</p><p v-if="notice" class="qex-notice" role="status">{{ct(notice)}}</p>
  <div class="qex-actions">
   <button v-if="!pending" type="button" class="qex-primary" :disabled="working||blocked||!policy?.ready" @click="submit"><BrandLoader v-if="working" :size="18"/>{{ct(working?'正在处理…':method==='browser'?'在当前应用中继续':purpose==='link'?'生成身份连接码':'生成我的登录码')}}<span aria-hidden="true">↗</span></button>
   <button v-if="pending&&canComplete" type="button" class="qex-primary" :disabled="working||blocked||reading" @click="submit"><BrandLoader v-if="working" :size="18"/>{{ct(working?'正在处理…':purpose==='link'?'确认关联当前账户':'进入我的空间')}}<span aria-hidden="true">↗</span></button>
   <button v-if="pending&&receipt?.authorizationUrl&&status==='waiting'" type="button" class="qex-primary" :disabled="working||blocked||reading" @click="openAuthorization">{{ct('在当前应用中继续')}}<span aria-hidden="true">↗</span></button>
   <div v-if="pending" class="qex-secondary-actions"><button type="button" :disabled="working||reading||blocked" @click="readResult(false)">{{ct('核对这次连接')}}</button><button v-if="status!=='closed'" type="button" :disabled="working||reading||blocked" @click="reviewClose">{{ct('结束这次等待')}}</button><button v-if="['closed','expired','failed'].includes(status)||status==='applied'&&receipt?.accepted" type="button" :disabled="working||reading||blocked" @click="reset">{{ct('再准备一束连接')}}</button></div>
  </div>
  <p class="qex-footnote">{{ct('扫码连接只用于这一次，不会合并其他账户。')}}</p>
  <dialog ref="closeDialog" class="qex-dialog" :aria-labelledby="'qex-close-'+id" @cancel.prevent="closeDialog?.close()"><span>QGAUSS / KNOW WHERE YOU LEFT OFF</span><h3 :id="'qex-close-'+id">{{ct('结束等待前，再核对一次。')}}</h3><p>{{ct('已经创建的账户或关联会保留，尚未确认的登录将结束。')}}</p><p v-if="error" class="qex-error" role="alert">{{ct(error)}}</p><footer><button type="button" :disabled="working" @click="closeDialog?.close()">{{ct('继续等待')}}</button><button type="button" class="qex-primary" :disabled="working" @click="finishClose">{{ct('确认结束')}}</button></footer></dialog>
 </section>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {currentLang} from '../../i18n/index.js';
import {accountText} from '../../i18n/account-messages.js';
import {EXTERNAL_ACTIVE,externalHeaders,externalPolicy,externalReceipt,externalStatusText,newExternalRequest} from '../../lib/external-identity.js';
import {readExternalPending,saveExternalPending} from '../../lib/external-pending.js';
import BrandLoader from '../design/BrandLoader.vue';
import './external-identity.css';
const props=defineProps({purpose:{type:String,default:'login'},active:Boolean,agreed:Boolean,remember:{type:Boolean,default:true},blocked:Boolean,currentPassword:{type:String,default:''}}),emit=defineEmits(['busy','consent-required','completed','interaction']),auth=useAuth(),route=useRoute(),router=useRouter(),id=useId(),ct=(key,params)=>accountText(currentLang.value,key,params);
const insideApp=typeof navigator==='object'&&/MicroMessenger/i.test(navigator.userAgent||'');
const policy=ref(null),policyLoading=ref(false),pending=ref(null),receipt=ref(null),method=ref('qr'),inviteCode=ref(''),working=ref(false),reading=ref(false),error=ref(''),notice=ref(''),closeDialog=ref(null),clock=ref(Date.now()),offset=ref(0);
let alive=true,epoch=0,controller,policyController,policyEpoch=0,pollTimer,tickTimer,initiatedHere=false,acceptingSession=false;
const owner=()=>auth.user?.id||'guest',at=()=>({owner:owner(),revision:auth.identityRevision,purpose:props.purpose,epoch}),current=stamp=>alive&&props.active&&stamp.owner===owner()&&stamp.revision===auth.identityRevision&&stamp.purpose===props.purpose&&stamp.epoch===epoch,path=key=>(props.purpose==='link'?'/users/me/external':'/auth/external')+'/requests/'+encodeURIComponent(key),remaining=computed(()=>receipt.value?Math.max(0,Math.ceil((Date.parse(receipt.value.expiresAt)-clock.value-offset.value)/1000)):0),status=computed(()=>receipt.value&&['preparing','waiting','confirmed'].includes(receipt.value.status)&&remaining.value===0?'expired':receipt.value?.status||(pending.value?'unknown':'idle')),statusText=computed(()=>externalStatusText(status.value)),qrImage=computed(()=>status.value==='waiting'?receipt.value?.qrImage||'':''),canComplete=computed(()=>status.value==='confirmed'||status.value==='applied'&&receipt.value?.exchangeAvailable);
function setWorking(value){working.value=value;emit('busy',value);}
function cancel(){epoch++;controller?.abort();controller=null;clearTimeout(pollTimer);reading.value=false;setWorking(false);closeDialog.value?.close();}
function remember(row){pending.value=row;if(!saveExternalPending(owner(),props.purpose,row))throw Error('当前浏览器无法保留这次连接，请允许会话存储后再试。');}
function accept(value,context){const row=externalReceipt(value,context);offset.value=Date.parse(row.serverNow)-Date.now();clock.value=Date.now();receipt.value=row;remember({...context,version:row.version});return row;}
function options(context,signal){return{headers:externalHeaders(context.browserProof),retry:false,...(signal?{signal}:{})};}
function schedule(){clearTimeout(pollTimer);if(alive&&props.active&&pending.value&&['preparing','waiting'].includes(status.value))pollTimer=setTimeout(()=>{if(document.hidden)schedule();else readResult(true);},2000);}
async function loadPolicy(){policyController?.abort();const request=new AbortController(),revision=++policyEpoch,stamp=at();policyController=request;policyLoading.value=true;try{const value=await api.get('/auth/external/policy',{signal:request.signal,retry:false});if(!current(stamp)||revision!==policyEpoch||request.signal.aborted)return;if(!externalPolicy(value))throw Error('暂时无法确认扫码服务，请重新读取。');policy.value=value;if(!value.methods.qr&&value.methods.browser)method.value='browser';}catch(e){if(current(stamp)&&revision===policyEpoch&&!request.signal.aborted){policy.value=null;error.value=e.message||'暂时无法确认扫码服务，请重新读取。';}}finally{if(current(stamp)&&revision===policyEpoch)policyLoading.value=false;}}
async function readResult(quiet=false){
 if(!pending.value||working.value||reading.value||!props.active||props.blocked)return;const context={...pending.value},stamp=at(),request=new AbortController();controller=request;reading.value=true;
 try{const value=await api.get(path(context.requestKey),options(context,request.signal));if(!current(stamp)||request.signal.aborted)return;const row=accept(value,context);error.value='';if(!quiet)notice.value='这次连接已读取，请确认后继续。';if(row.status==='confirmed'&&initiatedHere&&props.agreed){reading.value=false;await complete();}}
 catch(e){if(current(stamp)&&!request.signal.aborted){error.value=e.message||'暂未确认连接结果';notice.value='请先核对刚才的连接，不会自动生成另一张码。';}}
 finally{if(current(stamp)){reading.value=false;schedule();}}
}
async function submit(){
 if(working.value||reading.value||props.blocked||!props.active)return;if(props.purpose==='login'&&owner()!=='guest'){error.value='先退出当前账户，再准备另一次登录。';return;}
 if(canComplete.value){await complete();return;}if(pending.value){await readResult(false);return;}
 if(props.purpose==='login'&&!props.agreed){emit('consent-required');return;}if(props.purpose==='link'&&!props.currentPassword){error.value='先填写当前密码，再准备身份关联。';return;}
 if(!policy.value)await loadPolicy();if(!policy.value?.ready){error.value='扫码服务暂未开放，邮箱和手机密码仍可登录。';return;}
 const stamp=at(),request=new AbortController();controller=request;setWorking(true);error.value='';notice.value='';
 try{const context={...newExternalRequest(),method:method.value,purpose:props.purpose,owner:owner()};remember(context);receipt.value=null;initiatedHere=true;const body={method:context.method,expectedVersion:0,...(props.purpose==='link'?{currentPassword:props.currentPassword}:{agreed:true,inviteCode:inviteCode.value.trim()})},value=await api.post(path(context.requestKey),body,options(context,request.signal));if(!current(stamp)||request.signal.aborted)return;accept(value,context);}
 catch(e){if(current(stamp)&&!request.signal.aborted){error.value=e.message||'暂未确认连接结果';if(pending.value)notice.value='请先核对刚才的连接，不会自动生成另一张码。';}}
 finally{if(current(stamp)){setWorking(false);schedule();}}
}
async function complete(){
 if(!pending.value||working.value||props.blocked||!props.active)return;if(props.purpose==='login'&&!props.agreed){emit('consent-required');return;}const context={...pending.value},stamp=at(),request=new AbortController();controller=request;setWorking(true);error.value='';notice.value='';
 try{
  let row=receipt.value;if(row?.status!=='applied'){const value=await api.post(path(context.requestKey)+'/complete',{expectedVersion:context.version,agreed:props.purpose==='login'?true:undefined},options(context,request.signal));if(!current(stamp)||request.signal.aborted)return;row=accept(value,context);}
  if(row?.status!=='applied')throw Error('登录结果尚未确认，请先核对这次连接。');
  if(props.purpose==='link'){notice.value='连接已完成。';saveExternalPending(owner(),props.purpose,null);pending.value=null;emit('completed',row);return;}
  if(!row.exchangeAvailable){notice.value='连接已完成，请使用已有登录或重新准备。';return;}
  const latest={...pending.value},exchange=await api.post(path(context.requestKey)+'/exchange',{expectedVersion:latest.version},options(latest,request.signal));if(!current(stamp)||request.signal.aborted)return;
  if(!exchange||!exchange.session||exchange.receipt?.requestKey!==context.requestKey)throw Error('这次登录结果尚未核对完整，请重新读取。');accept(exchange.receipt,latest);
  acceptingSession=true;await auth.acceptLogin(exchange.session,{remember:props.remember});const signedInId=auth.user?.id,signedInRevision=auth.identityRevision;if(!signedInId||signedInId!==exchange.session.user?.id)throw Error('这次登录结果尚未核对完整，请重新读取。');
  try{await api.post(path(context.requestKey)+'/acknowledge',{expectedVersion:pending.value?.version??exchange.receipt.version},options(context));}catch{}
  saveExternalPending(context.owner,props.purpose,null);if(alive&&auth.user?.id===signedInId&&auth.identityRevision===signedInRevision){emit('completed',exchange.receipt);const target=typeof route.query.redirect==='string'&&route.query.redirect.startsWith('/')&&!route.query.redirect.startsWith('//')&&!route.query.redirect.includes('\\')&&!route.query.redirect.startsWith('/login')?route.query.redirect:'/chat';await router.replace(target);}
 }catch(e){if(current(stamp)&&!request.signal.aborted)error.value=e.message||'暂未确认连接结果';}
 finally{if(current(stamp)||acceptingSession){acceptingSession=false;setWorking(false);}}
}
function openAuthorization(){if(receipt.value?.authorizationUrl&&status.value==='waiting'&&!working.value&&!props.blocked)window.location.assign(receipt.value.authorizationUrl);}
async function reviewClose(){error.value='';await nextTick();closeDialog.value?.showModal();}
async function finishClose(){
 if(!pending.value||working.value||props.blocked)return;const context={...pending.value},stamp=at(),request=new AbortController();controller=request;setWorking(true);error.value='';
 try{const value=await api.post(path(context.requestKey)+'/close',{expectedVersion:context.version,method:context.method},options(context,request.signal));if(!current(stamp)||request.signal.aborted)return;accept(value,context);closeDialog.value?.close();initiatedHere=false;clearTimeout(pollTimer);}
 catch(e){if(current(stamp)&&!request.signal.aborted)error.value=e.message||'暂未确认连接结果';}finally{if(current(stamp))setWorking(false);}
}
function reset(){if(!pending.value||!['closed','expired','failed'].includes(status.value)&&!(status.value==='applied'&&receipt.value?.accepted))return;if(!saveExternalPending(owner(),props.purpose,null)){error.value='当前浏览器无法保留这次连接，请允许会话存储后再试。';return;}pending.value=null;receipt.value=null;error.value='';notice.value='';initiatedHere=false;loadPolicy();}
function activate(){cancel();receipt.value=null;pending.value=readExternalPending(owner(),props.purpose);error.value='';notice.value='';initiatedHere=false;emit('interaction',{isTyping:false,isPasswordFocus:false,focusedField:'none',passwordLength:0,isLoginError:false});if(!props.active)return;loadPolicy();if(pending.value)readResult(false);}
watch(()=>[props.active,props.purpose,owner(),auth.identityRevision],()=>{if(!acceptingSession)activate();},{immediate:true});watch(()=>props.blocked,value=>{if(!value&&props.active&&pending.value)schedule();});function visible(){if(!document.hidden&&props.active&&pending.value)readResult(true);}
onMounted(()=>{tickTimer=setInterval(()=>clock.value=Date.now(),1000);document.addEventListener('visibilitychange',visible);});onBeforeUnmount(()=>{alive=false;cancel();policyController?.abort();clearInterval(tickTimer);document.removeEventListener('visibilitychange',visible);});
defineExpose({submit});
</script>
