<template>
 <section class="qex-identity" :aria-labelledby="'qex-identity-'+id">
  <header><span class="qex-identity-eyebrow">QGAUSS / ANOTHER WAY HOME</span><h2 :id="'qex-identity-'+id">{{ct('连上你的扫码身份')}}</h2><p>{{ct('给回到创作空间，多留一条熟悉的路。')}}</p></header>
  <div v-if="loading" class="qex-identity-state" role="status"><BrandLoader :size="22"/>{{ct('正在读取')}}</div>
  <template v-else-if="identity">
   <div class="qex-identity-state" role="status"><b aria-hidden="true">{{identity.linked?'✓':'✦'}}</b><span>{{ct(identity.linked?'已连接扫码身份':'尚未连接扫码身份')}}</span><button class="qph-read" type="button" :disabled="busy||blocked" @click="load">{{ct('重新读取')}}</button></div>
   <p v-if="!identity.available" class="qex-identity-note">{{ct('扫码服务暂未开放，邮箱和手机密码仍可登录。')}}</p>
   <template v-if="!identity.linked&&identity.passwordConfigured&&identity.available"><label :for="'qex-current-'+id">{{ct('当前登录密码')}}</label><input :id="'qex-current-'+id" v-model="password" class="qex-identity-input" type="password" autocomplete="current-password" maxlength="128" :disabled="busy||blocked" /><p class="qex-identity-note">{{ct('确认当前密码后，再用自己的手机完成关联。')}}</p><ExternalAccessPanel purpose="link" :active="active" :blocked="blocked" :agreed="true" :current-password="password" @busy="setBusy" @completed="completed"/></template>
   <slot v-if="identity.linked&&!identity.passwordConfigured" name="initial-password" :identity="identity"/>
  </template>
  <p v-if="error" class="qex-error" role="alert">{{ct(error)}}</p><button v-if="!identity&&!loading" type="button" class="qph-read" :disabled="blocked" @click="load">{{ct('重新读取')}}</button>
 </section>
</template>
<script setup>
import {onBeforeUnmount,ref,useId,watch} from 'vue';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {currentLang} from '../../i18n/index.js';
import {accountText} from '../../i18n/account-messages.js';
import {externalIdentity} from '../../lib/external-identity.js';
import BrandLoader from '../design/BrandLoader.vue';
import ExternalAccessPanel from './ExternalAccessPanel.vue';
import './external-identity.css';
const props=defineProps({active:Boolean,blocked:Boolean}),emit=defineEmits(['busy','profile-received','identity-received']),auth=useAuth(),id=useId(),ct=(key,params)=>accountText(currentLang.value,key,params),identity=ref(null),loading=ref(false),busy=ref(false),error=ref(''),password=ref('');let alive=true,epoch=0,controller;
function setBusy(value){busy.value=value;emit('busy',value);}function cancel(){epoch++;controller?.abort();controller=null;loading.value=false;setBusy(false);}
async function load(){if(!props.active||!auth.user?.id)return;const owner=auth.user.id,revision=auth.identityRevision,version=++epoch,request=new AbortController();controller?.abort();controller=request;loading.value=true;error.value='';try{const value=await api.get('/users/me/external',{signal:request.signal,retry:false});if(!alive||!props.active||request.signal.aborted||version!==epoch||auth.user?.id!==owner||auth.identityRevision!==revision)return;identity.value=externalIdentity(value,owner);emit('identity-received',identity.value);}catch(e){if(alive&&!request.signal.aborted&&version===epoch&&auth.user?.id===owner)error.value=e.message||'扫码身份暂未读取完整，请重新读取。';}finally{if(alive&&version===epoch)loading.value=false;}}
async function completed(){password.value='';await load();}
watch(()=>[props.active,auth.user?.id,auth.identityRevision],()=>{cancel();password.value='';identity.value=null;error.value='';if(props.active)load();},{immediate:true});onBeforeUnmount(()=>{alive=false;cancel();password.value='';});
</script>
