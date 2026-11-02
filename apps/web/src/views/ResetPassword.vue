<template>
  <div class="login-page qgd-auth-page qac-reset" :class="'auth-' + appearance.variant">
    <AmbientScene />
    <header class="qgd-auth-header"><router-link to="/chat"><img src="/brand/qgauss-mark.svg" alt="" /><b>QGauss AI</b></router-link><router-link to="/login">返回登录 <ClientIcon name="arrowUpRight" /></router-link></header>
    <main class="qgd-auth-main"><section class="qgd-auth-story"><span class="qgd-kicker">A FRESH KEY. YOUR SAME SPACE.</span><h1>好点子一直在，<br /><mark>换把新钥匙就好。</mark></h1><p>重设登录密码，回到你的 QGauss 创作空间。已有会话和作品会保留。</p><div class="qac-key-sculpture" aria-hidden="true"><span class="qac-key-ring"></span><span class="qac-key-shaft"></span><i>✦</i></div><span class="qgd-auth-caption">QGAUSS AI / FIND YOUR WAY BACK</span></section>
      <section class="qgd-auth-card qac-reset-card" aria-labelledby="qac-reset-title"><span class="qgd-kicker">WELCOME BACK TO YOUR IDEAS</span>
        <template v-if="outcome === 'success'"><span class="qac-reset-emblem">✓</span><h2 id="qac-reset-title">新钥匙，准备好了。</h2><p>密码已经更新。此账号之前的登录和未使用的重置链接已失效，请使用新密码重新登录。</p><button class="qac-primary" type="button" @click="goToLogin">{{ auth.isLoggedIn ? '退出当前登录，再验证新密码' : '使用新密码登录' }} <ClientIcon name="arrowUpRight" /></button><router-link v-if="auth.isLoggedIn" class="qac-reset-current" to="/chat">保留当前登录，返回空间</router-link></template>
        <template v-else-if="outcome === 'unknown'"><span class="qac-reset-emblem">?</span><h2 id="qac-reset-title">还没有确认修改结果。</h2><p>提交时连接中断，密码可能已经更新。请先尝试使用新密码登录；如果无法登录，再重新申请邮件。</p><button class="qac-primary" type="button" @click="goToLogin">{{ auth.isLoggedIn ? '退出当前登录，再验证新密码' : '前往登录确认' }} <ClientIcon name="arrowUpRight" /></button><router-link v-if="auth.isLoggedIn" class="qac-reset-current" to="/chat">保留当前登录，返回空间</router-link></template>
        <template v-else-if="outcome === 'invalid' || outcome === 'expired'"><span class="qac-reset-emblem">↗</span><h2 id="qac-reset-title">{{ outcome === 'invalid' ? '请从重置邮件重新打开。' : '需要一封新的重置邮件。' }}</h2><p>{{ outcome === 'invalid' ? '请从最新的重置邮件打开此页面。当前地址没有可使用的重置链接。' : '这个重置链接已经使用、失效或无法继续。请回到登录页，重新申请找回密码。' }}</p><router-link class="qac-primary" to="/login">返回登录，重新申请 <ClientIcon name="arrowUpRight" /></router-link></template>
        <template v-else><h2 id="qac-reset-title">把钥匙，换成新的。</h2><p class="qgd-auth-intro">设置新的登录密码，修改后需要重新登录。</p><p v-if="auth.isLoggedIn" class="qac-inline-note">完成重置后，此浏览器会回到未登录状态。</p><form @submit.prevent="submit"><label class="qac-label" for="qac-reset-password">新密码 <span>8–32 字符；管理员至少 12 字符，含英文字母和数字</span></label><input id="qac-reset-password" v-model="password.next" class="qac-input" :type="showPasswords ? 'text' : 'password'" autocomplete="new-password" maxlength="64" :disabled="pending" /><label class="qac-label" for="qac-reset-confirm">再次填写新密码</label><input id="qac-reset-confirm" v-model="password.confirm" class="qac-input" :type="showPasswords ? 'text' : 'password'" autocomplete="new-password" maxlength="64" :disabled="pending" /><label class="qac-check"><input v-model="showPasswords" type="checkbox" :disabled="pending" /> 显示密码</label><p v-if="errorText" class="qac-inline-note is-error" role="alert">{{ errorText }}</p><button class="qac-primary qac-reset-submit" type="submit" :disabled="pending"><span v-if="pending" class="qac-spinner"></span>{{ pending ? '正在更新密码' : '更新密码' }}<ClientIcon v-if="!pending" name="arrowUpRight" /></button><p class="qac-reset-note">成功后，此账号所有登录与未使用的重置链接都会失效。刷新此页后，请从邮件重新打开。</p></form></template>
        <div class="qgd-auth-card-footer"><span>QGauss AI</span><span>你的创作，始终属于你。</span></div>
      </section>
    </main><footer class="qgd-auth-footer">QGauss AI · YOUR SPACE TO CREATE</footer>
  </div>
</template>
<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import { useAppearance } from '../stores/appearance.js';
import { passwordProblem } from '../lib/account-profile.js';
import AmbientScene from '../components/design/AmbientScene.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import '../components/design/workbench-pages.css';
import '../components/design/account-studio.css';
const route=useRoute(), router=useRouter(), auth=useAuth(), appearance=useAppearance();
let token=typeof route.query.token==='string' && /^[A-Za-z0-9_-]{16,128}$/.test(route.query.token) ? route.query.token : '';
const outcome=ref(token ? '' : 'invalid'), password=reactive({next:'',confirm:''}), pending=ref(false), errorText=ref(''), showPasswords=ref(false);
let alive=true, request=null;
onMounted(()=>{ if(Object.hasOwn(route.query,'token')) router.replace({path:'/reset-password',query:{}}); });
function goToLogin(){if(auth.isLoggedIn)void auth.logout();if(alive)router.push({path:'/login',query:{redirect:'/account'}});}
async function submit(){
  if(pending.value || !token || outcome.value)return;
  errorText.value=passwordProblem('',password.next,password.confirm,false);if(errorText.value)return;
  pending.value=true;request=new AbortController();const owner=auth.identityRevision;
  try{await api.post('/auth/reset-password',{token,newPassword:password.next},{signal:request.signal,retry:false});if(!alive)return;token='';outcome.value='success';if(auth.identityRevision===owner)auth.clearLocal('password-changed');}
  catch(error){if(!alive||request.signal.aborted)return;if(!error?.status||error.status>=500){outcome.value='unknown';token='';if(auth.identityRevision===owner)auth.clearLocal('password-unknown');}else if(error.status===400||error.status===403){outcome.value='expired';token='';}else errorText.value=error?.message||'暂时无法修改，请稍后再试。';}
  finally{password.next=password.confirm='';showPasswords.value=false;if(alive)pending.value=false;}
}
onBeforeUnmount(()=>{alive=false;request?.abort();token='';password.next=password.confirm='';showPasswords.value=false;});
</script>
