<template>
  <div class="qsi-page" :class="'qsi-' + appearance.variant">
    <AmbientScene />
    <header class="qsi-header"><router-link to="/setup"><img src="/brand/qgauss-mark.svg" alt="" />QGauss AI</router-link><span>属于你的创作空间 / FIRST LIGHT</span></header>
    <main class="qsi-layout">
      <section class="qsi-story"><span class="qsi-eyebrow">A SMALL START. A WHOLE NEW WORLD.</span><h1>让第一个想法，<br /><mark>在这里发光。</mark></h1><p>为 QGauss AI 点亮第一盏灯。先建立你的管理员身份，再慢慢布置模型、作品与伙伴。</p><div class="qsi-beacon" aria-hidden="true"><span class="qsi-beacon-ring"></span><span class="qsi-beacon-ring qsi-beacon-ring-two"></span><div class="qsi-lantern"><span>Q</span><i>✦</i></div><span class="qsi-pedestal"></span><span class="qsi-beacon-caption">YOUR IDEAS, READY FOR LIFTOFF</span></div><div class="qsi-story-note"><span>01</span><p>一次初始化，开启一个新空间。<br />已有账户的站点不会重新开放安装。</p></div></section>
      <section class="qsi-card" aria-labelledby="qsi-title" :aria-busy="installation.loading || pending">
        <div class="qsi-card-top"><span class="qsi-eyebrow">YOUR QGAUSS / INITIAL EDITION</span><span class="qsi-ticket-dot">✦</span></div>
        <template v-if="installation.loading && !pending"><h2 id="qsi-title" tabindex="-1">正在确认空间状态</h2><div class="qsi-loading" role="status"><BrandLoader />请稍等片刻</div></template>
        <template v-else-if="outcome === 'success'"><span class="qsi-result-mark">✓</span><h2 id="qsi-title" tabindex="-1">第一盏灯，亮了。</h2><p>管理员已经创建。接下来请使用刚设置的账户登录，查看你的启航清单。</p><router-link class="qsi-primary" to="/login?redirect=/welcome">登录并布置空间 <ClientIcon name="arrowUpRight" /></router-link></template>
        <template v-else-if="outcome === 'unknown'"><span class="qsi-result-mark">?</span><h2 id="qsi-title" tabindex="-1">先确认，再继续。</h2><p>连接中断，尚未确认创建结果。为避免重复提交，安装凭证和密码已从此页清除。</p><p v-if="installation.status && !installation.status.required" class="qsi-note">站点已关闭初始化入口。请用刚设置的账户登录确认；这条状态不能证明本次账户创建成功。</p><p v-else-if="installation.status?.required" class="qsi-note">站点仍等待初始化。你可以重新打开本页，核对状态后再明确填写。</p><p v-if="installation.error" class="qsi-error" role="alert">{{ installation.error }}</p><button class="qsi-secondary" type="button" @click="installation.check()">重新核对站点状态</button><router-link class="qsi-primary" to="/login?redirect=/welcome">前往登录确认 <ClientIcon name="arrowUpRight" /></router-link></template>
        <template v-else-if="installation.error"><h2 id="qsi-title" tabindex="-1">暂时没有连上空间。</h2><p class="qsi-error" role="alert">{{ installation.error }}</p><button class="qsi-primary" type="button" @click="installation.check()">重新连接</button></template>
        <template v-else-if="!installation.status?.required"><span class="qsi-result-mark">↗</span><h2 id="qsi-title" tabindex="-1">这里已经有人点亮了灯。</h2><p>站点已有账户或已经完成初始化，安装入口已关闭。</p><router-link class="qsi-primary" :to="auth.isAdmin ? '/welcome' : '/login?redirect=/welcome'">{{ auth.isAdmin ? '查看启航清单' : '返回登录' }} <ClientIcon name="arrowUpRight" /></router-link></template>
        <template v-else-if="!installation.status.canInitialize"><h2 id="qsi-title" tabindex="-1">还差一小步准备。</h2><p>{{ installation.status.needsSecureConnection ? '请通过安全连接或在本机打开安装页，再继续创建管理员。' : '请由部署负责人配置独立的安装凭证，然后重新启动站点。安装凭证不会在页面上公开。' }}</p><button class="qsi-primary" type="button" @click="installation.check()">重新检查准备状态</button></template>
        <template v-else>
          <ol class="qsi-steps" aria-label="安装进度"><li v-for="(label,index) in ['准备','身份','确认']" :key="label" :aria-current="step === index ? 'step' : undefined" :class="{active:step === index,done:step > index}"><span>{{ index + 1 }}</span>{{ label }}</li></ol>
          <template v-if="step === 0"><h2 id="qsi-title" tabindex="-1">你的空间，从你开始。</h2><p>准备好一个常用邮箱、一份独立密码，以及部署负责人提供的安装凭证。</p><div class="qsi-checklist"><div><span>✦</span><p><b>先建立管理员</b>用来布置模型、管理成员和站点规则。</p></div><div><span>↗</span><p><b>再选择创作搭档</b>完成后可连接模型，或明确开启本地演示。</p></div><div><span>○</span><p><b>按自己的节奏开放</b>默认关闭公开注册和收费，准备好后再开放。</p></div></div><button class="qsi-primary" type="button" @click="step = 1">准备好了，开始布置 <ClientIcon name="arrowUpRight" /></button></template>
          <form v-else-if="step === 1" @submit.prevent="review" novalidate><h2 id="qsi-title" tabindex="-1">为你的空间，留个名字。</h2><p>产品名称统一为 QGauss AI。以下信息仅用于创建本站管理员。</p><label for="qsi-token">安装凭证 <span>由部署负责人提供</span></label><input id="qsi-token" v-model="form.ownerToken" type="password" autocomplete="off" maxlength="128" spellcheck="false" /><div class="qsi-form-pair"><div><label for="qsi-email">管理员邮箱</label><input id="qsi-email" v-model="form.email" type="email" autocomplete="email" maxlength="128" /></div><div><label for="qsi-username">账户名</label><input id="qsi-username" v-model="form.username" autocomplete="username" maxlength="20" spellcheck="false" /></div></div><label for="qsi-name">昵称 <span>选填</span></label><input id="qsi-name" v-model="form.displayName" autocomplete="nickname" maxlength="64" /><label for="qsi-password">管理员密码 <span>12–32 字符，英文字母＋数字</span></label><input id="qsi-password" v-model="form.password" type="password" autocomplete="new-password" maxlength="64" /><label for="qsi-confirm">再填写一次密码</label><input id="qsi-confirm" v-model="form.confirm" type="password" autocomplete="new-password" maxlength="64" /><label for="qsi-origin">站点地址 <span>邮件中的链接将使用此地址</span></label><input id="qsi-origin" v-model="form.siteBaseUrl" type="url" autocomplete="url" maxlength="512" spellcheck="false" /><label class="qsi-checkbox"><input v-model="form.openRegistration" type="checkbox" />初始化后允许新用户自行注册</label><p class="qsi-note">安装凭证和密码只留在当前页面，离开后清除。不会自动发送邮件或调用模型。</p><p v-if="errorText" class="qsi-error" role="alert">{{ errorText }}</p><div class="qsi-actions"><button class="qsi-secondary" type="button" @click="step = 0">返回</button><button class="qsi-primary" type="submit">核对创建信息 <ClientIcon name="arrowUpRight" /></button></div></form>
          <template v-else><h2 id="qsi-title" tabindex="-1">最后，核对一下。</h2><p>明确创建后，本站初始化入口将关闭。不会自动登录或开始生成。</p><dl class="qsi-review"><div><dt>产品</dt><dd>QGauss AI</dd></div><div><dt>管理员邮箱</dt><dd>{{ form.email.trim() }}</dd></div><div><dt>账户名</dt><dd>{{ form.username }}</dd></div><div><dt>站点地址</dt><dd>{{ form.siteBaseUrl }}</dd></div><div><dt>公开注册</dt><dd>{{ form.openRegistration ? '允许新用户注册' : '暂不开放' }}</dd></div><div><dt>收费</dt><dd>保持关闭</dd></div></dl><p class="qsi-note">安装凭证和密码不在核对卡中显示。</p><p v-if="errorText" class="qsi-error" role="alert">{{ errorText }}</p><div class="qsi-actions"><button class="qsi-secondary" type="button" :disabled="pending" @click="step = 1">返回修改</button><button class="qsi-primary" type="button" :disabled="pending" @click="initialize"><span v-if="pending" class="qsi-spinner"></span>{{ pending ? '正在点亮空间' : '创建管理员，点亮空间' }}</button></div></template>
        </template>
        <footer class="qsi-card-footer"><span>QGauss AI</span><span>CREATE A LITTLE BRIGHTER.</span></footer>
      </section>
    </main>
  </div>
</template>
<script setup>
import { nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import { useAppearance } from '../stores/appearance.js';
import { useInstallation } from '../stores/installation.js';
import { installationProblem } from '../lib/installation-form.js';
import AmbientScene from '../components/design/AmbientScene.vue';
import BrandLoader from '../components/design/BrandLoader.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import '../components/design/installation.css';
const appearance = useAppearance(), installation = useInstallation(), auth = useAuth();
const step = ref(0), pending = ref(false), outcome = ref(''), errorText = ref('');
const form = reactive({ ownerToken: '', email: '', username: '', displayName: '', password: '', confirm: '', siteBaseUrl: window.location.origin, openRegistration: false });
let alive = true, request;
function clearSecrets() { form.ownerToken = form.password = form.confirm = ''; }
function review() { errorText.value = installationProblem(form); if (!errorText.value) step.value = 2; }
async function initialize() {
  if (pending.value || step.value !== 2 || outcome.value) return;
  errorText.value = installationProblem(form);
  if (errorText.value) { step.value = 1; return; }
  pending.value = true;
  request = new AbortController();
  try {
    const result = await api.post('/installation', { requestKey: crypto.randomUUID(), email: form.email.trim(), username: form.username, displayName: form.displayName.trim(), password: form.password, siteBaseUrl: form.siteBaseUrl, openRegistration: form.openRegistration }, { headers: { 'x-qgauss-install-token': form.ownerToken }, retry: false, signal: request.signal });
    if (!alive) return;
    if (result?.initialized !== true) throw new Error('创建结果尚未确认');
    installation.status = { required: false, canInitialize: false };
    outcome.value = 'success';
  } catch (error) {
    if (!alive || request.signal.aborted) return;
    if (!error?.status || error.status >= 500 || error.status === 409) outcome.value = 'unknown';
    else { errorText.value = error?.message || '暂时无法创建，请核对后重试。'; step.value = 1; }
  } finally { clearSecrets(); if (alive) pending.value = false; }
}
onBeforeUnmount(() => { alive = false; request?.abort(); clearSecrets(); });
watch(step, async value => { await nextTick(); if (alive) document.querySelector(value === 1 ? '#qsi-token' : '#qsi-title')?.focus(); });
</script>
