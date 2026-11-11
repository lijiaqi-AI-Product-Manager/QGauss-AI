<template>
  <div class="qg-auth-form-flow">
    <div class="qph-channel-tabs" role="tablist" :aria-label="ct('选择账户入口')" @keydown="channelKeydown">
      <button v-for="item in channels" :id="channelId+'-'+item.id" :key="item.id" type="button" role="tab" :aria-selected="channel===item.id" :aria-controls="channelId+'-panel-'+item.id" :tabindex="channel===item.id?0:-1" :disabled="loading||phoneBusy||externalBusy" @click="selectChannel(item.id)"><span aria-hidden="true">{{item.icon}}</span>{{ct(item.label)}}</button>
    </div>
    <div v-show="channel==='account'" :id="channelId+'-panel-account'" class="login-form-container" :class="{ 'is-login': mode === 'login' }" role="tabpanel" :aria-labelledby="channelId+'-account'">
      <form class="n-form" novalidate @submit.prevent="submit"><section v-if="mode==='forget'" class="qg-recovery-intro" aria-live="polite"><h3>{{ct('通过邮箱，找回创作空间。')}}</h3><p>{{ct(!emailPolicyKnown?'正在确认邮箱恢复是否可用…':emailReady?'输入账户使用的邮箱。若账户可用，将向该地址寄送三十分钟内有效的重置链接。':'邮箱找回暂未开放，请联系站点管理员。')}}</p><button v-if="!emailPolicyKnown" type="button" :disabled="loading" @click="loadEmailPolicy">{{ct('重新读取')}}</button></section>
        <p v-if="mode === 'register' && !emailPolicyKnown" class="qg-auth-notice" role="status">{{ ct(emailPolicyError || '正在确认注册要求…') }}<button v-if="emailPolicyError" type="button" @click="loadEmailPolicy">{{ct('重新读取')}}</button></p>
        <div v-for="field in fields" :key="field.key" class="n-form-item input-3d">
          <label class="n-form-item-label" :for="`qg-auth-${field.key}`"><span class="n-form-item-label__text">{{ field.label }}</span></label>
          <div class="n-form-item-blank" :class="{ 'qg-auth-captcha-row': field.key === 'captchaCode' }">
            <div class="n-input" :class="{ 'n-input--focus': focused === field.key, 'placeholder-error': fieldErrors[field.key] }">
              <div class="n-input-wrapper">
                <input :id="`qg-auth-${field.key}`" v-model="form[field.key]" class="n-input__input-el"
                  :type="field.key === 'password' ? visible ? 'text' : 'password' : field.type || 'text'"
                  :name="field.key" :data-qg-password="field.key === 'password' ? '' : undefined" :autocomplete="field.autocomplete" :maxlength="field.key === 'password' ? 32 : undefined" :disabled="loading"
                  :placeholder="fieldErrors[field.key] || field.placeholder" :aria-invalid="!!fieldErrors[field.key]"
                  :aria-describedby="error ? 'qg-auth-error' : undefined" @focus="focus(field.key)" @blur="focus('none')" @input="changed(field.key)" />
                <button v-if="field.key === 'password'" class="n-input__eye" type="button" :aria-label="text(visible ? 'hidePassword' : 'showPassword')" :aria-pressed="visible" @mousedown.prevent @click="togglePassword">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path v-if="!visible" d="m3 3 18 18"/></svg>
                </button>
              </div>
            </div>
            <button v-if="field.key === 'captchaCode'" class="qg-auth-captcha" type="button" :aria-label="text('changeCaptcha')" @click="loadCaptcha" v-html="captcha.svg"></button>
          </div>
        </div>
        <EmailVerificationCard v-if="mode === 'register' && emailRequired" v-model:code="emailCode" :email="form.email" registration :delivery-ready="emailReady" :captcha-id="captcha.id" :captcha-code="form.captchaCode" :disabled="loading" @challenge="emailChallenge = $event" @busy="emailBusy = $event" @captcha-used="refreshEmailCaptcha" />
        <div v-if="mode === 'login'" class="qg-auth-assist">
          <label><input v-model="remember" type="checkbox" />{{ text('remember') }}</label>
          <button type="button" @click="changeMode('forget')">{{ text('forgot') }}</button>
        </div>
        <p v-if="error" id="qg-auth-error" class="qg-auth-error" role="alert">{{ct(error)}}</p>
        <p v-if="notice" class="qg-auth-notice" role="status">{{ct(notice)}}</p>
        <div class="n-form-item form-btn-item"><div class="n-form-item-blank">
          <button class="n-button n-button--primary-type" type="submit" :disabled="loading || emailBusy || mode === 'register' && !emailPolicyKnown || mode==='forget' && (!emailPolicyKnown || !emailReady)" :aria-busy="loading"><span class="n-button__content">{{ loading ? text('loading') : text(mode === 'login' ? 'submit' : mode === 'register' ? 'register' : 'reset') }}</span></button>
        </div></div>
      </form>
      <div v-if="mode === 'login'" class="login-type-switch-slot"><slot name="switch" /></div>
    </div>
    <div v-if="phoneOpened" v-show="channel==='phone'" :id="channelId+'-panel-phone'" role="tabpanel" :aria-labelledby="channelId+'-phone'"><PhoneAccessPanel ref="phonePanel" :mode="mode" :active="channel==='phone'" :agreed="agreed" :remember="remember" :register-enabled="registerEnabled" @mode-change="changeMode" @remember-change="remember=$event" @consent-required="consentVisible=true" @interaction="$emit('interaction',$event)" @busy="phoneBusy=$event" /></div>
    <div v-if="externalOpened" v-show="channel==='external'" :id="channelId+'-panel-external'" role="tabpanel" :aria-labelledby="channelId+'-external'"><ExternalAccessPanel ref="externalPanel" :active="channel==='external'" :agreed="agreed" :remember="remember" @consent-required="consentVisible=true" @interaction="$emit('interaction',$event)" @busy="externalBusy=$event"/></div>
    <div v-if="mode !== 'login'" class="qg-auth-return"><button type="button" :disabled="loading||phoneBusy||externalBusy" @click="changeMode('login')">{{ text('back') }}</button></div>
    <div class="qg-auth-form-footer">
      <div v-if="mode!=='forget'" class="box-agreement">
        <label class="qg-auth-agreement-check"><input v-model="agreed" type="checkbox" :aria-label="text('agreementRequired')" /></label>
        <div class="content">{{ text(mode === 'login' ? 'agreement' : 'agreementRegister') }}<a class="agreement-text" href="/agreement/userAgreement.html" target="_blank" rel="noopener">{{ text('userAgreement') }}</a>{{ text('and') }}<a class="agreement-text" href="/agreement/privacyAgreement.html" target="_blank" rel="noopener">{{ text('privacy') }}</a></div>
      </div>
      <div v-if="registerEnabled" class="signup-bottom" :class="{ 'is-hidden': mode !== 'login' }"><span>{{ text('noAccount') }}</span><button type="button" :disabled="loading||phoneBusy||externalBusy" @click="changeMode('register')">{{ text('goRegister') }}</button></div>
    </div>
    <Teleport to="body">
      <div v-if="consentVisible" class="qg-auth-consent-mask" @click.self="consentVisible = false" @keydown="consentKeydown">
        <section ref="consentDialog" class="qg-auth-consent" role="dialog" aria-modal="true" aria-labelledby="qg-consent-title">
          <div class="qg-auth-consent-body">
            <h2 id="qg-consent-title">{{ text('consentTitle') }}</h2>
            <p>{{ text('consentMessage') }} <a href="/agreement/userAgreement.html" target="_blank" rel="noopener">{{ text('userAgreement').replace(/[《》]/g, '') }}</a> {{ text('and') }} <a href="/agreement/privacyAgreement.html" target="_blank" rel="noopener">{{ text('privacy').replace(/[《》]/g, '') }}</a></p>
          </div>
          <div class="qg-auth-consent-actions"><button type="button" @click="consentVisible = false">{{ text('cancel') }}</button><button type="button" @click="acceptAndSubmit">{{ text('accept') }}</button></div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import {currentLang} from '../../i18n/index.js';
import {accountText} from '../../i18n/account-messages.js';
const ct=(key,params)=>accountText(currentLang.value,key,params);
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';
import { authText as text } from './auth-locale.js';
import EmailVerificationCard from './EmailVerificationCard.vue';
import PhoneAccessPanel from './PhoneAccessPanel.vue';
import ExternalAccessPanel from './ExternalAccessPanel.vue';
import './phone-identity.css';

const emit = defineEmits(['interaction', 'subViewChange']);
const auth = useAuth();
const router = useRouter();
const route = useRoute();
const mode = ref('login');
const channel=ref('account'), phoneOpened=ref(false), phonePanel=ref(null), phoneBusy=ref(false), channelId='qph-channel-'+useId();
const externalOpened=ref(false),externalPanel=ref(null),externalBusy=ref(false);
const channels=[{id:'account',label:'邮箱或登录名',icon:'@'},{id:'phone',label:'手机号码',icon:'↗'},{id:'external',label:'扫码登录',icon:'✦'}];
const loading = ref(false);
const visible = ref(false);
const agreed = ref(false);
const remember = ref(true);
const focused = ref('none');
const error = ref('');
const notice = ref('');
const consentVisible = ref(false);
const consentDialog = ref(null);
let consentTrigger;
let authAlive = true, captchaEpoch = 0;
let policyEpoch=0;
const configAbort = new AbortController();
const registerEnabled = ref(false);
const emailRequired=ref(false),emailReady=ref(false),emailCode=ref(''),emailChallenge=ref(null),emailBusy=ref(false);
const emailPolicyKnown=ref(false),emailPolicyError=ref('');
const form = reactive({ account: '', username: '', password: '', email: '', captchaCode: '', inviteCode: '' });
const fieldErrors = reactive({});
const captcha = reactive({ svg: '', id: '' });
const fields = computed(() => mode.value === 'login' ? [
  { key: 'account', label: text('email'), placeholder: text('account'), autocomplete: 'username' },
  { key: 'password', label: text('password'), placeholder: text('passwordHint'), autocomplete: 'current-password' },
] : mode.value === 'forget' ? [
  { key: 'email', label: text('email'), placeholder: text('emailHint'), type: 'email', autocomplete: 'email' },
] : [
  { key: 'username', label: text('username'), placeholder: text('usernameHint'), autocomplete: 'username' },
  { key: 'password', label: text('password'), placeholder: text('passwordRule'), autocomplete: 'new-password' },
  { key: 'email', label: text('email'), placeholder: text('emailHint'), type: 'email', autocomplete: 'email' },
  { key: 'captchaCode', label: text('captcha'), placeholder: text('captchaHint'), autocomplete: 'off' },
  { key: 'inviteCode', label: text('inviteCode'), placeholder: text('inviteHint'), autocomplete: 'off' },
]);

function dispatch(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
function selectChannel(value){if(loading.value||phoneBusy.value||externalBusy.value||!channels.some(item=>item.id===value))return;if(value==='external'&&mode.value==='forget')changeMode('login');channel.value=value;if(value==='phone')phoneOpened.value=true;else if(value==='external')externalOpened.value=true;else interaction();}
async function channelKeydown(event){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||loading.value||phoneBusy.value||externalBusy.value)return;event.preventDefault();const index=channels.findIndex(item=>item.id===channel.value),next=event.key==='Home'?0:event.key==='End'?channels.length-1:(index+(event.key==='ArrowRight'?1:-1)+channels.length)%channels.length;selectChannel(channels[next].id);await nextTick();document.getElementById(channelId+'-'+channel.value)?.focus();}
function interaction() { emit('interaction', { isTyping: focused.value !== 'none', passwordLength: form.password.length, isPasswordFocus: focused.value === 'password', isPasswordVisible: visible.value, focusedField: focused.value === 'account' ? 'email' : focused.value, isLoginError: !!error.value }); }
function focus(key) { focused.value = key; interaction(); dispatch('login-field-focus', key === 'account' ? 'email' : key); }
function changed(key) { delete fieldErrors[key]; error.value = ''; notice.value = ''; dispatch('login-error-state', false); interaction(); }
function togglePassword() { visible.value = !visible.value; dispatch('login-password-visibility', visible.value); interaction(); }
async function loadCaptcha() {
  const epoch = ++captchaEpoch;
  try { const data = await api.get('/auth/captcha'); if (!authAlive || mode.value !== 'register' || epoch !== captchaEpoch) return; captcha.svg = data.svg; captcha.id = data.captchaId; }
  catch (failure) { if (authAlive && mode.value === 'register' && epoch === captchaEpoch) error.value = failure.message; }
}
function refreshEmailCaptcha(){form.captchaCode='';loadCaptcha();}
async function loadEmailPolicy(){const epoch=++policyEpoch;emailPolicyError.value='';try{const policy=await api.get('/auth/registration-policy',{signal:configAbort.signal,retry:false});if(!policy||typeof policy.emailVerificationRequired!=='boolean'||typeof policy.emailDeliveryReady!=='boolean')throw Error('暂时无法确认注册要求，请重新读取。');if(authAlive&&epoch===policyEpoch){emailRequired.value=policy.emailVerificationRequired;emailReady.value=policy.emailDeliveryReady;emailPolicyKnown.value=true;}}catch(e){if(authAlive&&epoch===policyEpoch){emailPolicyKnown.value=false;emailPolicyError.value=e.message;}}}
function changeMode(next) {
  if(loading.value||phoneBusy.value||externalBusy.value)return;
  form.password='';if(next==='forget'&&!form.email&&auth.user?.email)form.email=auth.user.email;
  if (next === 'register' && !registerEnabled.value) { error.value = text('registrationClosed'); return; }
  emailChallenge.value=null;emailCode.value='';emailBusy.value=false;mode.value = next; visible.value = false; error.value = ''; notice.value = ''; focused.value = 'none';
  if (next !== 'register') captchaEpoch++;
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
  dispatch('login-password-visibility', false); emit('subViewChange', next); interaction();
  if (next === 'register') loadCaptcha();
}
async function submit() {
  if(channel.value==='external'){await externalPanel.value?.submit();return;}
  if(channel.value==='phone'){await phonePanel.value?.submit();return;}
  if (loading.value||emailBusy.value) return;
  const submissionMode=mode.value;
  if(mode.value==='forget'&&!emailPolicyKnown.value)await loadEmailPolicy();
  if(!authAlive||mode.value!==submissionMode)return;
  if(mode.value==='forget'&&(!emailPolicyKnown.value||!emailReady.value)){error.value='邮箱找回暂未开放，请联系站点管理员。';return;}
  if(mode.value==='register'&&!emailPolicyKnown.value){await loadEmailPolicy();if(!emailPolicyKnown.value)return;}
  if (mode.value!=='forget' && !agreed.value) { consentVisible.value = true; return; }
  const empty = fields.value.filter((field) => field.key !== 'inviteCode' && !(field.key==='captchaCode'&&emailRequired.value&&emailChallenge.value) && !form[field.key].trim());
  if (empty.length) {
    for (const field of empty) fieldErrors[field.key] = field.placeholder;
    error.value = text('required'); dispatch('login-error-state', true); interaction(); return;
  }
  if(mode.value==='register'&&emailRequired.value&&(!emailChallenge.value||!/^\d{6}$/.test(emailCode.value))){error.value='请先寄送并填写六位邮箱验证码。';return;}
  loading.value = true; error.value = ''; notice.value = '';
  try {
    if (mode.value === 'forget') {
      await api.post('/auth/forgot-password',{email:form.email.trim()},{signal:configAbort.signal,retry:false});if(!authAlive)return;notice.value='系统已收到找回申请。若邮箱关联可用账户，请留意收件箱或垃圾邮件。';
    } else {
      if (mode.value === 'login') await auth.login(form.account, form.password, { remember: remember.value });
      else await auth.register({ username: form.username, password: form.password, email: form.email, ...(emailRequired.value?{emailChallengeId:emailChallenge.value.id,emailCode:emailCode.value}:{captchaId:captcha.id,captchaCode:form.captchaCode}), inviteCode: form.inviteCode });
      if(!authAlive)return;
      const destination = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//') ? route.query.redirect : '/chat';
      await router.push(destination);
    }
  } catch (failure) {
    if(!authAlive)return;
    error.value=mode.value==='forget'&&!failure.status?'申请结果尚未确认，请先检查收件箱或垃圾邮件，稍后再手动申请。':failure.message||text('required');
    if(mode.value==='forget'&&failure.status===503)await loadEmailPolicy(); dispatch('login-error-state', true); interaction();
    if (mode.value === 'register') {await loadCaptcha();await loadEmailPolicy();}
  } finally { loading.value = false; }
}
function acceptAndSubmit() { agreed.value = true; consentVisible.value = false; submit(); }
function consentKeydown(event) {
  if (event.key === 'Escape') { consentVisible.value = false; event.preventDefault(); }
  if (event.key !== 'Tab') return;
  const controls = [...consentDialog.value.querySelectorAll('a,button')];
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch(consentVisible, async (shown) => {
  if (shown) { consentTrigger = document.activeElement; await nextTick(); consentDialog.value?.querySelector('button')?.focus(); }
  else consentTrigger?.focus();
});
watch(() => form.password, interaction);
onMounted(async () => {
  if(route.query.channel==='phone')selectChannel('phone');
  if(route.query.channel==='external')selectChannel('external');
  if(route.query.mode==='forget')changeMode('forget');else emit('subViewChange','login');
  loadEmailPolicy();
  try {
    const config = await api.get('/settings/public', { signal: configAbort.signal }); if (!authAlive) return; registerEnabled.value = !!config['security.registerEnabled'];
    const invite = typeof route.query.invite === 'string' ? route.query.invite.trim().toUpperCase() : '';
    if (route.query.mode!=='forget' && registerEnabled.value && /^[A-Z0-9]{8}$/.test(invite)) { form.inviteCode = invite; changeMode('register'); notice.value = text('invitationReady'); }
  } catch { if (authAlive) registerEnabled.value = false; }
});
watch(()=>route.query.channel,value=>{if(['account','phone','external'].includes(value))selectChannel(value);});
onBeforeUnmount(() => { authAlive = false; captchaEpoch++; configAbort.abort(); emit('interaction', { isTyping: false, passwordLength: 0, isPasswordFocus: false, isPasswordVisible: false, focusedField: 'none', isLoginError: false }); });
</script>
