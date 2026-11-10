<template>
  <section ref="root" class="qgu-page qgua-self" aria-labelledby="qgua-own-heading">
    <div v-if="state.pending" class="qgu-feedback qgu-pending" role="status"><div><b>{{ ct('有一项账户操作待确认') }}</b><p>{{ state.pending.target.username }} · {{ state.pending.target.email }}</p></div><button type="button" class="qgu-button" :disabled="state.busy || blocked" @click="state.resume">{{ ct('继续核对原操作') }}</button><button v-if="state.pending.state==='rejected'" type="button" class="qgu-button" :disabled="state.busy || blocked" @click="state.dismissRejected">{{ ct('结束本次核对') }}</button></div>
    <p v-if="state.notice" class="qgu-feedback" role="status">{{ ct(state.notice) }}</p>
    <div class="qgua-own-heading"><span class="qgua-symbol" aria-hidden="true"><ClientIcon name="lock" /><i></i></span><div><h2 id="qgua-own-heading">{{ ct('我的登录') }}</h2><p>{{ ct('查看并管理可以继续使用的登录。') }}</p></div><button type="button" class="qgu-button qgu-primary" :disabled="state.busy || !!state.pending || blocked" @click="state.openSessions">{{ ct('查看有效登录') }}</button></div>
    <UserAccountControls :state="state" :person="profile" />
  </section>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {currentLang} from '../../i18n/index.js';
import {controlText} from '../../i18n/user-account-messages.js';
import {useUserAccountControls} from '../../composables/useUserAccountControls.js';
import UserAccountControls from '../admin/UserAccountControls.vue';
import ClientIcon from '../reference/ClientIcon.vue';
import './user-management.css';
const props=defineProps({profile:{type:Object,required:true},blocked:Boolean}),emit=defineEmits(['busy','profileReceived']),auth=useAuth(),root=ref(null),ct=(text,values)=>controlText(currentLang.value,text,values),selectedId=computed(()=>auth.user?.id||'');
async function refreshProfile(){const id=auth.user?.id,identity=auth.identityRevision;try{const fresh=await api.get('/users/profile',{retry:false});if(!auth.isLoggedIn||auth.user?.id!==id||auth.identityRevision!==identity)return false;emit('profileReceived',fresh);return true;}catch{return false;}}
const state=reactive(useUserAccountControls({user:computed(()=>props.profile),selectedId,self:true,externalBusy:computed(()=>props.blocked),openUser:refreshProfile,onChanged:refreshProfile}));
watch(()=>state.busy,value=>emit('busy',value),{flush:'sync'});
watch(()=>state.panel,async value=>{if(value==='review'||value==='done'){await nextTick();root.value?.querySelector(value==='review'?'[data-confirm-management]':'.qgua-done')?.focus();}});
onBeforeUnmount(()=>emit('busy',false));
</script>
