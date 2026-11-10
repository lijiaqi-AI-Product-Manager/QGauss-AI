<template>
  <section class="qev-card" :class="{ 'is-verified': verifiedAt, 'is-compact': registration }" :aria-label="ct('邮箱验证')">
    <div class="qev-top"><span class="qev-envelope" aria-hidden="true"><i></i><b>{{ verifiedAt ? '✓' : '✦' }}</b></span><div><span class="qev-eyebrow">A LITTLE STEP / BELONGS TO YOU</span><h3 ref="verificationTitle" tabindex="-1">{{ verifiedAt ? ct('邮箱，已与你的空间相连。') : registration ? ct('给新灵感，一个可靠的地址。') : ct('把邮箱，和你的空间连起来。') }}</h3><p>{{ verifiedAt ? ct('已确认这个邮箱由你使用。') : registration ? ct('输入寄到邮箱的六位数字，再开启你的 QGauss 空间。') : ct('一封短信笺，确认这个地址由你使用。') }}</p></div></div>
    <p class="qev-address"><span>{{ email || ct('先填写你的邮箱') }}</span><b>{{ verifiedAt ? ct('已验证') : challenge ? ct('等待核对') : ct('待验证') }}</b></p>
    <template v-if="!verifiedAt">
      <p v-if="!deliveryReady" class="qev-unavailable" role="status">{{ ct('邮箱投递尚未就绪，请稍后再来。') }}</p>
      <div v-else class="qev-controls"><button type="button" class="qev-send" :disabled="disabled || busy || remaining > 0 || !email" @click="sendCode"><BrandLoader v-if="sending" :size="18" />{{ sending ? ct('正在寄出…') : remaining > 0 ? ct('{seconds} 秒后可重发',{seconds:remaining}) : challenge ? ct('重新寄送验证码') : ct('寄送邮箱验证码') }}<span v-if="!sending" aria-hidden="true">↗</span></button><div v-if="challenge" class="qev-code"><label :for="inputId">{{ ct('邮箱验证码') }}</label><input :id="inputId" :value="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :placeholder="ct('六位数字')" :aria-label="ct('邮箱验证码')" :disabled="disabled || confirming" @input="changed($event.target.value)"/><span class="qev-expiry">{{ expired ? ct('验证码已过期，请重新寄送。') : ct('验证码十分钟内有效，新代码会替换旧代码。') }}</span></div><button v-if="challenge && !registration" type="button" class="qev-confirm" :disabled="disabled || busy || !/^\d{6}$/.test(code) || expired" @click="confirm"><BrandLoader v-if="confirming" :size="18"/>{{ confirming ? ct('正在核对…') : ct('确认这个邮箱') }}</button></div>
      <p v-if="registration && challenge" class="qev-note">{{ ct('验证码在创建账户时核对；需要重新寄送时，请填写更新后的图形验证码。') }}</p>
      <p v-if="ct(error)" class="qev-error" role="alert">{{ ct(error) }}</p><p v-else-if="ct(notice)" class="qev-note" role="status">{{ ct(notice) }}</p>
    </template>
  </section>
</template>

<script setup>
import {currentLang} from '../../i18n/index.js';
import {accountText} from '../../i18n/account-messages.js';
const ct=(key,params)=>accountText(currentLang.value,key,params);
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';
import BrandLoader from '../design/BrandLoader.vue';
import './email-verification.css';
const props=defineProps({email:{type:String,default:''},ownerKey:{type:String,default:''},verifiedAt:{type:String,default:''},registration:Boolean,deliveryReady:Boolean,captchaId:{type:String,default:''},captchaCode:{type:String,default:''},disabled:Boolean,code:{type:String,default:''}});
const emit=defineEmits(['update:code','challenge','captcha-used','verified','busy']);
const auth=useAuth(),challenge=ref(null),sending=ref(false),confirming=ref(false),error=ref(''),notice=ref(''),now=ref(Date.now());
const verificationTitle=ref(null);
const busy=computed(()=>sending.value||confirming.value),inputId=computed(()=>props.registration?'qev-register-code':'qev-account-code');
const remaining=computed(()=>challenge.value?Math.max(0,Math.ceil((challenge.value.resendAt-now.value)/1000)):0),expired=computed(()=>!!challenge.value&&now.value>=Date.parse(challenge.value.expiresAt));
let alive=true,epoch=0,request,timer;
function reset(){epoch++;request?.abort();clearInterval(timer);timer=undefined;challenge.value=null;sending.value=false;confirming.value=false;error.value='';notice.value='';emit('challenge',null);emit('update:code','');emit('busy',false);}
function changed(value){error.value='';emit('update:code',value);}
async function sendCode(){
 if(props.disabled||busy.value||remaining.value||!props.deliveryReady)return;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(props.email.trim())){error.value='先填写完整的邮箱地址。';return;}
 if(props.registration&&(!props.captchaId||!props.captchaCode.trim())){error.value='先填写图形验证码，再寄送邮箱验证码。';return;}
 const key=++epoch,owner=auth.identityRevision,email=props.email;request?.abort();request=new AbortController();sending.value=true;error.value='';notice.value='';emit('busy',true);
 try{const row=await api.post(props.registration?'/auth/registration-code':'/auth/email-verification/send',props.registration?{email,captchaId:props.captchaId,captchaCode:props.captchaCode}:{},{signal:request.signal,retry:false});if(!alive||key!==epoch||owner!==auth.identityRevision||email!==props.email)return;if(!row||!/^[a-f\d-]{36}$/i.test(row.challengeId)||!Number.isFinite(Date.parse(row.expiresAt))||!Number.isInteger(row.resendAfter)||row.resendAfter<1||row.resendAfter>600)throw Error('寄送结果尚未确认，请检查邮箱并稍后重新寄送。');now.value=Date.now();challenge.value={id:row.challengeId,expiresAt:row.expiresAt,resendAt:now.value+row.resendAfter*1000};emit('challenge',challenge.value);emit('update:code','');notice.value='已加入寄送队列，请检查收件箱或垃圾邮件。';clearInterval(timer);timer=setInterval(()=>{now.value=Date.now();if(challenge.value&&now.value>=Date.parse(challenge.value.expiresAt)){clearInterval(timer);timer=undefined;}},1000);
 }catch(e){if(alive&&key===epoch&&!request.signal.aborted)error.value=e.message;}
 finally{if(alive&&key===epoch){sending.value=false;emit('busy',false);if(props.registration)emit('captcha-used');}}
}
async function confirm(){
 if(props.disabled||busy.value||props.registration||!challenge.value||expired.value||!/^\d{6}$/.test(props.code))return;
 const key=++epoch,owner=auth.identityRevision;request?.abort();request=new AbortController();confirming.value=true;error.value='';emit('busy',true);
 try{const row=await api.post('/auth/email-verification/confirm',{challengeId:challenge.value.id,code:props.code},{signal:request.signal,retry:false});if(!alive||key!==epoch||owner!==auth.identityRevision)return;emit('verified',row.emailVerifiedAt);emit('update:code','');clearInterval(timer);timer=undefined;notice.value='邮箱已确认，可以继续创作。';}
 catch(e){if(alive&&key===epoch&&!request.signal.aborted){error.value=e.message;try{const row=await api.get('/users/profile',{signal:request.signal,retry:false});if(alive&&key===epoch&&owner===auth.identityRevision&&row.id===props.ownerKey&&row.email===props.email&&row.emailVerifiedAt){error.value='';emit('verified',row.emailVerifiedAt);emit('update:code','');clearInterval(timer);timer=undefined;notice.value='已读取到邮箱验证成功的结果。';}}catch{}}}
 finally{if(alive&&key===epoch){confirming.value=false;emit('busy',false);}}
}
watch(()=>[props.email,props.ownerKey,auth.identityRevision],reset);
watch(()=>props.verifiedAt,async(at,previous)=>{if(at&&!previous){await nextTick();if(alive&&props.verifiedAt===at)verificationTitle.value?.focus();}});
onBeforeUnmount(()=>{alive=false;epoch++;request?.abort();clearInterval(timer);emit('busy',false);});
</script>
