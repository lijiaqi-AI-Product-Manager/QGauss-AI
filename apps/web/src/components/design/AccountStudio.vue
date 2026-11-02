<template>
  <div class="qac-studio">
    <header class="qac-hero">
      <div class="qac-hero-copy"><span class="qac-eyebrow">QGAUSS AI / YOUR OWN SPACE</span><p class="qac-section-tag">个人空间</p><h1>每一个灵感，<br /><mark>都有你的名字。</mark></h1><p>照顾好你的创作身份，再把好点子交给世界。</p><div class="qac-hero-links"><button type="button" @click="openSection('profile')">编辑创作身份 <ClientIcon name="arrowUpRight" /></button><button type="button" @click="openSection('security')"><ClientIcon name="lock" /> 登录与密码</button></div></div>
      <div class="qac-pass-scene" aria-label="创作身份卡"><span class="qac-pass-halo"></span><div class="qac-creator-pass"><span class="qac-pass-top">QGAUSS <b>CREATOR PASS</b></span><AccountAvatar :value="draft.avatar" :size="86" /><strong>{{ draft.displayName.trim() || profile?.displayName || auth.user?.username || '你的创作身份' }}</strong><span class="qac-pass-role">{{ dirty ? '编辑预览 · 尚未保存' : profile?.role === 'ADMIN' ? '站点管理员' : '创作伙伴' }}</span><span class="qac-pass-cut"></span><div class="qac-pass-bottom"><span>IDEAS START WITH YOU</span><span aria-hidden="true">✦</span></div></div><span class="qac-scene-orbit"></span><span class="qac-scene-star" aria-hidden="true">✦</span></div>
    </header>

    <nav ref="sectionNavigation" class="qac-tabs" aria-label="个人空间分区" role="tablist"><button v-for="(tab,index) in sections" :id="'qac-tab-' + tab.id" :key="tab.id" :ref="el => tabButtons[index] = el" type="button" role="tab" :aria-selected="section === tab.id" :aria-controls="'qac-panel-' + tab.id" :tabindex="section === tab.id ? 0 : -1" @click="openSection(tab.id)" @keydown="tabKey($event,index)"><ClientIcon :name="tab.icon" /><span>{{ tab.title }}</span><b>{{ tab.number }}</b></button></nav>

    <div v-if="loading" class="qac-state" role="status"><BrandLoader /><h2>正在取回你的创作身份</h2><p>资料准备好，就可以继续。</p></div>
    <div v-else-if="loadError" class="qac-state" role="alert"><span class="qac-state-symbol">↻</span><h2>这次没有取回资料</h2><p>{{ loadError }}</p><button class="qac-primary" type="button" @click="loadProfile">重新读取</button></div>
    <template v-else-if="profile">
      <section v-show="section === 'profile'" id="qac-panel-profile" class="qac-panel qac-profile-grid" role="tabpanel" aria-labelledby="qac-tab-profile">
        <form class="qac-card qac-profile-form" @submit.prevent="saveProfile">
          <div class="qac-card-heading"><span class="qac-number">01</span><div><h2>和灵感打个招呼</h2><p>这里的名字会出现在你的 QGauss 空间里。</p></div></div>
          <label class="qac-label" for="qac-name">创作昵称 <span>最多 32 个字符</span></label><input id="qac-name" v-model="draft.displayName" class="qac-input" maxlength="64" autocomplete="nickname" placeholder="你希望 QGauss 怎么称呼你？" :disabled="profileSaving" :aria-invalid="!!nameProblem" aria-describedby="qac-name-hint" /><p id="qac-name-hint" class="qac-field-hint" :class="{ 'is-error': nameProblem }">{{ nameProblem || '修改不会自动保存；邮箱与登录名保持原有设置。' }}</p>
          <fieldset class="qac-avatar-field" :disabled="profileSaving"><legend>挑一位头像搭档</legend><div class="qac-avatar-options"><button v-for="avatar in ACCOUNT_AVATARS" :key="avatar.id" type="button" :aria-label="avatar.name" :aria-pressed="draft.avatar === avatar.id" @click="draft.avatar = avatar.id; avatarTouched = true"><AccountAvatar :value="avatar.id" :size="48" decorative /><span>{{ avatar.name }}</span><b v-if="draft.avatar === avatar.id" aria-hidden="true">✓</b></button></div></fieldset>
          <div v-if="profileNote" class="qac-inline-note" :class="{ 'is-error': profileNoteKind === 'error' }" role="status">{{ profileNote }}</div>
          <div class="qac-form-actions"><span>{{ profileUncertain ? '先确认保存结果，再继续编辑。' : dirty ? '有尚未保存的更改' : '资料已与当前账户同步' }}</span><button v-if="profileUncertain" type="button" class="qac-primary" @click="confirmProfile">读取最新资料</button><button v-else type="submit" class="qac-primary" :disabled="!dirty || !!nameProblem || profileSaving"><span v-if="profileSaving" class="qac-spinner" aria-hidden="true"></span>{{ profileSaving ? '正在保存' : '保存创作身份' }}<ClientIcon v-if="!profileSaving" name="arrowUpRight" /></button></div>
        </form>
        <aside class="qac-card qac-account-facts"><span class="qac-eyebrow">BELONGS TO YOU</span><h2>你的账户名片</h2><dl><div><dt>登录名</dt><dd>{{ profile.username }}</dd></div><div><dt>注册邮箱</dt><dd>{{ profile.email || '暂无记录' }}</dd></div><div><dt>加入时间</dt><dd>{{ accountDate(profile.createdAt) }}</dd></div><div><dt>账户角色</dt><dd>{{ profile.role === 'ADMIN' ? '站点管理员' : '普通用户' }}</dd></div></dl><p>个人空间仅供本人查看。需要调整登录邮箱或账户角色时，请联系站点管理员。</p><button type="button" @click="openSection('security')">查看登录足迹 <ClientIcon name="arrowUpRight" /></button></aside>
      </section>

      <section v-show="section === 'security'" id="qac-panel-security" class="qac-panel qac-security-grid" role="tabpanel" aria-labelledby="qac-tab-security">
        <EmailVerificationCard v-model:code="emailCode" :email="profile.email" :owner-key="profile.id" :verified-at="profile.emailVerifiedAt || ''" :delivery-ready="emailReady" :disabled="passwordSaving" @verified="emailVerified" />
        <form class="qac-card qac-password-form" @submit.prevent="reviewPassword"><div class="qac-card-heading"><span class="qac-number">02</span><div><h2>给创作空间换把钥匙</h2><p>修改后，此账号在所有设备的登录都会失效。</p></div></div><label class="qac-label" for="qac-old-password">当前密码</label><input id="qac-old-password" v-model="password.old" class="qac-input" :type="showPasswords ? 'text' : 'password'" autocomplete="current-password" maxlength="128" :disabled="passwordSaving" /><label class="qac-label" for="qac-new-password">新密码 <span>{{ profile.role === 'ADMIN' ? '12–32 字符，英文字母＋数字' : '8–32 个字符' }}</span></label><input id="qac-new-password" v-model="password.next" class="qac-input" :type="showPasswords ? 'text' : 'password'" autocomplete="new-password" maxlength="64" :disabled="passwordSaving" /><label class="qac-label" for="qac-confirm-password">再填写一次新密码</label><input id="qac-confirm-password" v-model="password.confirm" class="qac-input" :type="showPasswords ? 'text' : 'password'" autocomplete="new-password" maxlength="64" :disabled="passwordSaving" /><label class="qac-check"><input v-model="showPasswords" type="checkbox" :disabled="passwordSaving" /> 显示密码</label><p v-if="passwordError" class="qac-inline-note is-error" role="alert">{{ passwordError }}</p><div class="qac-form-actions"><span>密码不会保存在此浏览器的草稿中。</span><button type="submit" class="qac-primary" :disabled="passwordSaving">确认修改 <ClientIcon name="arrowUpRight" /></button></div></form>
        <div class="qac-card qac-login-history"><div class="qac-card-heading"><span class="qac-number">↗</span><div><h2>最近的登录足迹</h2><p>设备名称由浏览器报告，不代表设备认证。</p></div></div><div v-if="logsLoading" class="qac-history-state" role="status"><span class="qac-spinner"></span>正在读取登录记录</div><div v-else-if="logsError" class="qac-history-state" role="alert"><p>{{ logsError }}</p><button type="button" @click="loadLogs(logPage)">重试读取</button></div><div v-else-if="!loginRows.length" class="qac-history-state"><span>✦</span><p>暂时没有登录记录。</p></div><ol v-else><li v-for="row in loginRows" :key="row.id"><span class="qac-login-icon"><ClientIcon name="user" /></span><div><strong>{{ loginDevice(row.userAgent) }}</strong><time :datetime="row.createdAt">{{ accountDate(row.createdAt) }}</time><small>{{ revealNetwork ? row.ip || '未记录网络地址' : '网络地址已隐藏' }}</small></div><span class="qac-login-outcome" :class="{ failed: !row.success }">{{ row.success ? '登录成功' : '未登录成功' }}</span></li></ol><div class="qac-history-tools"><button type="button" :aria-pressed="revealNetwork" @click="revealNetwork = !revealNetwork">{{ revealNetwork ? '隐藏网络地址' : '显示网络地址' }}</button><span>{{ logsLoading ? '正在读取记录' : logsError ? '记录数量尚未确认' : logTotal + ' 条记录' }}</span></div><nav v-if="logTotal > logPageSize" class="qac-pager" aria-label="登录记录分页"><button type="button" :disabled="logsLoading || logPage <= 1" @click="loadLogs(logPage - 1)">上一页</button><span>第 {{ logPage }} 页</span><button type="button" :disabled="logsLoading || logPage * logPageSize >= logTotal" @click="loadLogs(logPage + 1)">下一页</button></nav></div>
      </section>

      <section v-show="section === 'start'" id="qac-panel-start" class="qac-panel qac-start-grid" role="tabpanel" aria-labelledby="qac-tab-start"><div class="qac-card qac-start-intro"><span class="qac-eyebrow">YOUR NEXT SMALL STEP</span><h2>从一个小念头，<br /><mark>走到第一份作品。</mark></h2><p>挑一个现在想做的事。这里只打开工作区，你准备好后再开始生成。</p><div class="qac-start-orb" aria-hidden="true"><span>Q</span><i>✦</i></div></div><router-link v-for="step in startSteps" :key="step.path" class="qac-card qac-start-step" :to="step.path"><span class="qac-step-icon"><ClientIcon :name="step.icon" /></span><span><small>{{ step.number }}</small><h3>{{ step.title }}</h3><p>{{ step.description }}</p></span><ClientIcon name="arrowUpRight" /></router-link></section>
    </template>
    <dialog ref="passwordDialog" class="qac-confirm-dialog" aria-labelledby="qac-password-dialog-title" @cancel="cancelPasswordReview"><span class="qac-dialog-emblem"><ClientIcon name="lock" /></span><span class="qac-eyebrow">A FRESH KEY</span><h2 id="qac-password-dialog-title">准备换一把新钥匙？</h2><p>修改成功后，此账号的所有登录和未使用的密码重置链接都会失效。请使用新密码重新登录。</p><p>仅修改密码，已有会话与作品会保留。</p><div class="qac-dialog-actions"><button type="button" :disabled="passwordSaving" @click="closePasswordReview">返回检查</button><button type="button" class="qac-primary" :disabled="passwordSaving" @click="changePassword"><span v-if="passwordSaving" class="qac-spinner"></span>{{ passwordSaving ? '正在提交' : '修改并重新登录' }}</button></div></dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';
import { useAppearance } from '../../stores/appearance.js';
import { ACCOUNT_AVATARS, accountAvatar, accountDate, loginDevice, passwordProblem } from '../../lib/account-profile.js';
import AccountAvatar from './AccountAvatar.vue';
import ClientIcon from '../reference/ClientIcon.vue';
import BrandLoader from './BrandLoader.vue';
import EmailVerificationCard from '../auth/EmailVerificationCard.vue';
import './account-studio.css';
const auth = useAuth(), appearance = useAppearance();
const route = useRoute();
const emailCode=ref(''),emailReady=ref(false);
function emailVerified(at){if(profile.value&&profile.value.id===auth.user?.id){profile.value={...profile.value,emailVerifiedAt:at};auth.user.emailVerifiedAt=at;}}
const emailPolicyAbort=new AbortController();let emailPolicyAlive=true;
onMounted(async()=>{try{const row=await api.get('/auth/registration-policy',{signal:emailPolicyAbort.signal,retry:false});if(emailPolicyAlive)emailReady.value=!!row.emailDeliveryReady;}catch{}});
onBeforeUnmount(()=>{emailPolicyAlive=false;emailPolicyAbort.abort();});
const sections = [{id:'profile',title:'创作身份',icon:'user',number:'01'},{id:'security',title:'登录与密码',icon:'lock',number:'02'},{id:'start',title:'开始创作',icon:'star',number:'03'}];
const startSteps = [{number:'01 / CHAT',title:'聊清楚一个想法',description:'选择合适的模型，把问题、文档或图片交给你的搭档。',path:'/chat',icon:'chat'},{number:'02 / CREATE',title:'把脑海里的画面画出来',description:'从一段描述开始，在绘画工作台调整画面与参数。',path:'/painting',icon:'image'},{number:'03 / DISCOVER',title:'遇见不同专长的搭档',description:'去应用中心，挑一位适合眼前任务的 AI 助手。',path:'/apps',icon:'apps'}];
const section = ref('profile'), sectionNavigation = ref(null), tabButtons = [], profile = ref(null), loading = ref(false), loadError = ref('');
const draft = reactive({displayName:'',avatar:ACCOUNT_AVATARS[0].id}), profileSaving = ref(false), profileNote = ref(''), profileNoteKind = ref(''), profileUncertain = ref(false), avatarTouched = ref(false);
const password = reactive({old:'',next:'',confirm:''}), passwordSaving = ref(false), passwordError = ref(''), showPasswords = ref(false), passwordDialog = ref(null);
const loginRows = ref([]), logsLoading = ref(false), logsError = ref(''), logPage = ref(1), logTotal = ref(0), logPageSize = 4, revealNetwork = ref(false);
let alive = true, profileRequest = null, logsRequest = null, writeRequest = null, logVersion = 0;
const current = stamp => alive && auth.isLoggedIn && auth.user?.id === stamp.id && auth.identityRevision === stamp.revision;
const stamp = () => ({id:auth.user?.id,revision:auth.identityRevision});
const nameProblem = computed(() => !draft.displayName.trim() ? '请填写一个创作昵称。' : [...draft.displayName.trim()].length > 32 ? '创作昵称最多 32 个字符。' : '');
const dirty = computed(() => !!profile.value && (draft.displayName.trim() !== (profile.value.displayName || profile.value.username) || avatarTouched.value && draft.avatar !== profile.value.avatar));
function applyProfile(data, replaceDraft = true) { profile.value = data; if (replaceDraft) { draft.displayName = data.displayName || data.username; draft.avatar = accountAvatar(data.avatar).id; avatarTouched.value = false; } }
function clearPasswords() { password.old = password.next = password.confirm = ''; showPasswords.value = false; }
async function loadProfile() {
  if (!auth.isLoggedIn) return;
  profileRequest?.abort(); const request = new AbortController(), owner = stamp(); profileRequest = request; loading.value = true; loadError.value = '';
  try { const data = await api.get('/users/profile',{signal:request.signal,retry:false}); if (!current(owner) || request.signal.aborted) return; applyProfile(data); auth.user = {...auth.user,displayName:data.displayName,avatar:data.avatar}; }
  catch (error) { if (current(owner) && !request.signal.aborted) loadError.value = error?.message || '请稍后重试。'; }
  finally { if (current(owner) && profileRequest === request) loading.value = false; }
}
async function saveProfile() {
  if (profileSaving.value || profileUncertain.value || !dirty.value || nameProblem.value) return;
  const owner = stamp(), request = new AbortController(); writeRequest = request; profileSaving.value = true; profileNote.value = '';
  try { const data = await api.patch('/users/profile',{displayName:draft.displayName.trim(),...(avatarTouched.value ? {avatar:draft.avatar} : {})},{signal:request.signal,retry:false}); if (!current(owner)) return; applyProfile(data); auth.user = {...auth.user,displayName:data.displayName,avatar:data.avatar}; profileNoteKind.value = 'success'; profileNote.value = '创作身份已保存。下次回来，依然是你。'; }
  catch (error) { if (!current(owner) || request.signal.aborted) return; profileNoteKind.value = 'error'; profileUncertain.value = !error?.status || error.status >= 500; profileNote.value = profileUncertain.value ? '保存结果尚未确认。请先读取最新资料，你的编辑内容仍保留。' : error.message || '这次没有保存成功。'; }
  finally { if (current(owner)) profileSaving.value = false; }
}
async function confirmProfile() {
  if (profileSaving.value) return; const owner = stamp(), request = new AbortController(); writeRequest = request; profileSaving.value = true;
  try { const data = await api.get('/users/profile',{signal:request.signal,retry:false}); if (!current(owner)) return; applyProfile(data,false); auth.user = {...auth.user,displayName:data.displayName,avatar:data.avatar}; profileUncertain.value = false; profileNoteKind.value = ''; profileNote.value = dirty.value ? '已读取最新资料。你的编辑仍保留，确认后可以再次保存。' : '已确认：这份创作身份已经保存。'; }
  catch (error) { if (current(owner) && !request.signal.aborted) { profileNoteKind.value='error'; profileNote.value='暂时无法确认保存结果，请稍后重新读取。'; } }
  finally { if (current(owner)) profileSaving.value=false; }
}
async function loadLogs(page = 1) {
  logsRequest?.abort(); const request = new AbortController(), owner = stamp(), version = ++logVersion; logsRequest = request; logsLoading.value = true; logsError.value = '';
  try { const data = await api.get('/users/logins?page=' + page + '&pageSize=' + logPageSize,{signal:request.signal,retry:false}); if (!current(owner) || request.signal.aborted || version !== logVersion) return; loginRows.value = data.items; logTotal.value=data.total; logPage.value=data.page; }
  catch (error) { if (current(owner) && !request.signal.aborted && version===logVersion) logsError.value=error?.message || '暂时无法读取登录记录。'; }
  finally { if (current(owner) && version===logVersion) logsLoading.value=false; }
}
function chooseSection(value) { if (!sections.some(x=>x.id===value) || passwordSaving.value) return; if (section.value==='security' && value!=='security') { clearPasswords(); passwordError.value=''; } section.value=value; if (value==='security' && !loginRows.value.length && !logsLoading.value) loadLogs(); }
async function openSection(value) { chooseSection(value); await nextTick(); sectionNavigation.value?.scrollIntoView?.({block:'start',behavior:appearance.motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant'}); }
async function tabKey(event,index) { const moves={ArrowRight:(index+1)%3,ArrowLeft:(index+2)%3,Home:0,End:2}; if (!(event.key in moves)) return; event.preventDefault(); await openSection(sections[moves[event.key]].id); await nextTick(); tabButtons[moves[event.key]]?.focus(); }
function reviewPassword() { passwordError.value=passwordProblem(password.old,password.next,password.confirm,true,profile.value?.role === 'ADMIN'); if (passwordError.value || passwordSaving.value) return; passwordDialog.value?.showModal(); }
function closePasswordReview() { if (passwordSaving.value) return; passwordDialog.value?.close(); }
function cancelPasswordReview(event) { if (passwordSaving.value) event.preventDefault(); }
async function changePassword() {
  if (passwordSaving.value || passwordProblem(password.old,password.next,password.confirm,true,profile.value?.role === 'ADMIN')) return;
  const owner=stamp(), request=new AbortController(); writeRequest=request; passwordSaving.value=true; passwordError.value='';
  try { await api.post('/users/password',{oldPassword:password.old,newPassword:password.next},{signal:request.signal,retry:false}); if (current(owner)) auth.clearLocal('password-changed'); }
  catch (error) { if (!current(owner) || request.signal.aborted) return; if (!error?.status || error.status>=500) auth.clearLocal('password-unknown'); else passwordError.value=error?.message || '密码暂未修改，请检查后重试。'; }
  finally { if (current(owner)) { clearPasswords(); passwordDialog.value?.close(); passwordSaving.value=false; } }
}
watch(()=>auth.identityRevision,()=>{profileRequest?.abort();logsRequest?.abort();writeRequest?.abort();clearPasswords();passwordDialog.value?.close();section.value='profile';profile.value=null;loginRows.value=[];revealNetwork.value=false;logsLoading.value=false;logsError.value='';logTotal.value=0;logPage.value=1;logVersion++;draft.displayName='';draft.avatar=ACCOUNT_AVATARS[0].id;profileUncertain.value=false;profileSaving.value=false;passwordSaving.value=false;passwordError.value='';loadError.value='';profileNote.value='';if(auth.isLoggedIn)loadProfile();});
watch(() => route.query.section, value => { if (sections.some(item => item.id === value)) openSection(value); });
onMounted(async () => { const owner = stamp(); await loadProfile(); if (current(owner) && sections.some(item => item.id === route.query.section)) openSection(route.query.section); });
onBeforeUnmount(()=>{alive=false;profileRequest?.abort();logsRequest?.abort();writeRequest?.abort();clearPasswords();passwordDialog.value?.close();});
</script>
