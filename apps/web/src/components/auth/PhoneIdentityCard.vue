<template>
  <section class="qac-card qph-access qph-binding" :aria-labelledby="titleId">
    <div class="qph-binding-heading"><span aria-hidden="true" class="qph-handset"><i></i><b>✦</b></span><div><span class="qph-eyebrow">ONE MORE WAY HOME</span><h2 :id="titleId">{{ct('给账户留一个熟悉的号码')}}</h2><p class="qph-small">{{ct('确认新号码与当前密码。你的邮箱、作品和余额会保留。')}}</p></div></div>
    <div class="qph-policy" role="status"><BrandLoader v-if="reading" :size="18"/><span>{{ct(identity?identity.phoneMasked?'当前号码：{phone}':'尚未绑定手机号码。':'正在读取号码状态…',{phone:identity?.phoneMasked||''})}}</span><button type="button" :disabled="busy||reading||blocked" @click="refreshIdentity">{{ct('重新读取')}}</button></div>
    <form class="qph-form" novalidate @submit.prevent="reviewBinding">
      <label :for="phoneId">{{ct('新的手机号码')}}</label><div class="qph-number"><span>{{ct('中国大陆')}} <b>+86</b></span><input :id="phoneId" v-model="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="28" :disabled="locked||codeBusy" :placeholder="ct('填写十一位手机号码')" @input="error=''"/></div>
      <PhoneCodeCard v-model="code" :phone="phone" purpose="bind" :policy="policy" :active="active" :disabled="locked" request-base="/users/me/phone/requests" @busy="codeBusy=$event"/>
      <label :for="passwordId">{{ct('当前登录密码')}}</label><input :id="passwordId" v-model="password" class="qph-input" type="password" autocomplete="current-password" maxlength="128" :disabled="locked" :placeholder="ct('确认是你本人在操作')" @input="error=''"/>
      <p class="qph-small">{{ct('绑定号码不会修改登录密码，也不会合并其他账户。')}}</p>
      <div v-if="pending" class="qph-pending" role="status"><b>{{ct('先核对，刚才的那一步。')}}</b><p>{{ct('结果确认前保留当前内容，不会自动重新提交。')}}</p><div><button type="button" :disabled="busy||blocked" @click="readAction">{{ct('核对刚才的处理')}}</button><button type="button" :disabled="busy||blocked" @click="reviewClose">{{ct('结束这次等待')}}</button></div></div>
      <p v-if="error" class="qph-error" role="alert">{{ct(error)}}</p><p v-if="notice" class="qph-small" role="status">{{ct(notice)}}</p>
      <button class="qph-primary qph-submit" type="submit" :disabled="locked||codeBusy||!identity||!policy?.deliveryReady" :aria-busy="busy"><BrandLoader v-if="busy" :size="18"/>{{ct(identity?.phoneMasked?'确认更换号码':'确认绑定号码')}}<span aria-hidden="true">↗</span></button>
    </form>
    <dialog ref="reviewDialog" class="qph-dialog" @close="review=null" :aria-labelledby="reviewId" @cancel="cancelReview"><span class="qph-eyebrow">A NUMBER THAT BELONGS TO YOU</span><h3 :id="reviewId">{{ct('让这个号码，连接你的空间。')}}</h3><p>{{ct('将绑定 {phone}。原有邮箱和密码保持可用，已有作品与余额会保留。',{phone:review?.masked||''})}}</p><p v-if="error" class="qph-error" role="alert">{{ct(error)}}</p><footer><button type="button" :disabled="busy" @click="reviewDialog?.close()">{{ct('返回检查')}}</button><button type="button" class="qph-primary" :disabled="busy||blocked" @click="bindPhone">{{ct('确认绑定')}}</button></footer></dialog>
    <dialog ref="closeDialog" class="qph-dialog" :aria-labelledby="closeId" @cancel.prevent="closeDialog?.close()"><span class="qph-eyebrow">KNOW WHERE YOU LEFT OFF</span><h3 :id="closeId">{{ct('结束这次账户等待？')}}</h3><p>{{ct('尚未完成的请求将结束。已经完成的绑定会保留，不会自动撤销。')}}</p><p v-if="error" class="qph-error" role="alert">{{ct(error)}}</p><footer><button type="button" :disabled="busy" @click="closeDialog?.close()">{{ct('再等等')}}</button><button type="button" class="qph-primary" :disabled="busy||blocked" @click="finishClose">{{ct('确认结束等待')}}</button></footer></dialog>
  </section>
</template>

<script setup>
import {computed,nextTick,onBeforeUnmount,ref,useId,watch} from 'vue';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {currentLang} from '../../i18n/index.js';
import {accountText} from '../../i18n/account-messages.js';
import {newPhoneKey,normalizedPhone,phoneActionReceipt,phonePolicy,phoneProblem} from '../../lib/phone-identity.js';
import {readPhonePending,savePhonePending} from '../../lib/phone-pending.js';
import BrandLoader from '../design/BrandLoader.vue';
import PhoneCodeCard from './PhoneCodeCard.vue';
import './phone-identity.css';

const props=defineProps({profile:Object,active:Boolean,blocked:Boolean}),emit=defineEmits(['busy','profile-received']);
const auth=useAuth(),ct=(key,params)=>accountText(currentLang.value,key,params),id=useId();
const titleId='qph-binding-'+id,phoneId='qph-bind-phone-'+id,passwordId='qph-bind-password-'+id,reviewId='qph-bind-review-'+id,closeId='qph-bind-close-'+id;
const phone=ref(''),password=ref(''),code=ref(''),identity=ref(null),policy=ref(null),busy=ref(false),reading=ref(false),codeBusy=ref(false),pending=ref(null),error=ref(''),notice=ref(''),review=ref(null),reviewDialog=ref(null),closeDialog=ref(null),closeVersion=ref(0);
const locked=computed(()=>props.blocked||busy.value||!!pending.value);
let alive=true,request,epoch=0,readRequest,readEpoch=0;
const owner=()=>auth.user?.id||'',stamp=()=>({id:owner(),revision:auth.identityRevision}),current=at=>alive&&props.active&&!!at.id&&at.id===owner()&&at.revision===auth.identityRevision;
function setBusy(value){busy.value=value;emit('busy',value);}
function remember(value){pending.value=value;savePhonePending('action',owner(),'bind',value);}
function cancelReview(event){if(busy.value)event.preventDefault();}
function cancel(){epoch++;request?.abort();readEpoch++;readRequest?.abort();reading.value=false;setBusy(false);review.value=null;reviewDialog.value?.close();closeDialog.value?.close();}
async function refreshIdentity(){
  if(!props.active||!owner()||busy.value||props.blocked)return;
  readRequest?.abort();const controller=new AbortController(),version=++readEpoch,at=stamp();readRequest=controller;reading.value=true;error.value='';
  try{
    const [row,service]=await Promise.all([api.get('/users/me/phone',{signal:controller.signal,retry:false}),api.get('/auth/phone/policy',{signal:controller.signal,retry:false})]);
    if(!current(at)||controller.signal.aborted||version!==readEpoch)return;
    if(!row||!(row.phoneMasked===null||typeof row.phoneMasked==='string'&&row.phoneMasked.length<=40&&/[*•]/.test(row.phoneMasked))||!phonePolicy(service))throw Error('暂时无法确认手机服务，请重新读取。');
    identity.value=row;policy.value=service;
  }catch(e){if(current(at)&&!controller.signal.aborted&&version===readEpoch)error.value=e.message;}
  finally{if(current(at)&&version===readEpoch)reading.value=false;}
}
async function refreshProfile(at,controller){const row=await api.get('/users/profile',{signal:controller.signal,retry:false});if(current(at)&&!controller.signal.aborted)emit('profile-received',row);}
async function completed(row,at,controller){
  if(row.status==='closed'){remember(null);notice.value='这次账户等待已结束，已完成的操作会保留。';return;}
  remember(null);password.value='';code.value='';phone.value='';reviewDialog.value?.close();notice.value='刚才的号码绑定已完成，正在读取当前号码。';
  try{await refreshProfile(at,controller);if(current(at)){const row=await api.get('/users/me/phone',{signal:controller.signal,retry:false});if(current(at)&&!controller.signal.aborted&&row&&(row.phoneMasked===null||typeof row.phoneMasked==='string'&&/[*•]/.test(row.phoneMasked)))identity.value=row;}}
  catch(e){if(current(at)&&!controller.signal.aborted)error.value='绑定已完成，当前资料暂未读取，请重新读取。';}
}
async function reviewBinding(){
  if(locked.value||codeBusy.value||!props.active||!identity.value||!policy.value?.deliveryReady)return;
  error.value=phoneProblem(phone.value)||(!/^\d{6}$/.test(code.value)?'请填写六位短信验证码。':!password.value?'请先填写当前密码。':'');if(error.value)return;
  const value=normalizedPhone(phone.value);review.value={phone:value,code:code.value,password:password.value,expectedUpdatedAt:props.profile?.updatedAt,masked:value.slice(0,6)+'****'+value.slice(-4)};
  await nextTick();reviewDialog.value?.showModal();
}
async function bindPhone(){
  if(busy.value||props.blocked||!review.value||!props.active||pending.value)return;
  const at=stamp(),version=++epoch,key=newPhoneKey(),controller=new AbortController();request=controller;setBusy(true);error.value='';notice.value='';
  const body={purpose:'bind',phone:review.value.phone,code:review.value.code,password:review.value.password,expectedUpdatedAt:review.value.expectedUpdatedAt,expectedVersion:0};remember({key,operationVersion:0});
  try{const row=await api.post('/users/me/phone/actions/'+key,body,{signal:controller.signal,retry:false});if(!current(at)||version!==epoch)return;if(!phoneActionReceipt(row,key,'bind'))throw Error('账户处理结果不完整，请核对原结果。');await completed(row,at,controller);}
  catch(e){if(current(at)&&version===epoch){if([400,401,403,422,429,503].includes(e.status))remember(null);error.value=e.message||'账户处理结果尚未确认，请核对原结果。';}}
  finally{if(current(at)&&version===epoch){review.value=null;reviewDialog.value?.close();setBusy(false);}}
}
async function readAction(){
  if(!pending.value||busy.value||props.blocked)return;const at=stamp(),version=++epoch,key=pending.value.key,controller=new AbortController();request=controller;setBusy(true);error.value='';
  try{const row=await api.get('/users/me/phone/actions/'+key,{signal:controller.signal,retry:false});if(!current(at)||version!==epoch)return;if(!phoneActionReceipt(row,key,'bind'))throw Error('账户处理结果不完整，请核对原结果。');await completed(row,at,controller);}
  catch(e){if(current(at)&&version===epoch)error.value=e.status===404?'暂未找到这次处理，可稍后核对或明确结束等待。':e.message;}
  finally{if(current(at)&&version===epoch)setBusy(false);}
}
async function reviewClose(){
  if(!pending.value||busy.value||props.blocked)return;const at=stamp(),version=++epoch,key=pending.value.key,controller=new AbortController();request=controller;setBusy(true);error.value='';
  try{let row,missing=false;try{row=await api.get('/users/me/phone/actions/'+key,{signal:controller.signal,retry:false});}catch(e){if(e.status!==404)throw e;missing=true;row={version:0};}if(!current(at)||version!==epoch)return;if(!missing&&!phoneActionReceipt(row,key,'bind'))throw Error('账户处理结果不完整，请核对原结果。');closeVersion.value=row.version;await nextTick();closeDialog.value?.showModal();}
  catch(e){if(current(at)&&version===epoch)error.value=e.message;}
  finally{if(current(at)&&version===epoch)setBusy(false);}
}
async function finishClose(){
  if(!pending.value||busy.value||props.blocked)return;const at=stamp(),version=++epoch,key=pending.value.key,controller=new AbortController();request=controller;setBusy(true);error.value='';
  try{const row=await api.post('/users/me/phone/actions/'+key+'/close',{purpose:'bind',expectedVersion:closeVersion.value},{signal:controller.signal,retry:false});if(!current(at)||version!==epoch)return;if(!phoneActionReceipt(row,key,'bind'))throw Error('账户处理结果不完整，请核对原结果。');await completed(row,at,controller);closeDialog.value?.close();}
  catch(e){if(current(at)&&version===epoch)error.value=e.status===409?'这次处理已有变化，请重新核对。':e.message;}
  finally{if(current(at)&&version===epoch)setBusy(false);}
}
watch([()=>props.active,()=>auth.user?.id,()=>auth.identityRevision],([active,userId,revision],[previousActive,previousId,previousRevision]=[])=>{
  cancel();password.value='';code.value='';error.value='';if(userId!==previousId||revision!==previousRevision){phone.value='';identity.value=null;policy.value=null;notice.value='';}
  pending.value=active&&owner()?readPhonePending('action',owner(),'bind'):null;if(active)void refreshIdentity();
},{immediate:true});
onBeforeUnmount(()=>{alive=false;cancel();password.value='';code.value='';phone.value='';});
</script>
