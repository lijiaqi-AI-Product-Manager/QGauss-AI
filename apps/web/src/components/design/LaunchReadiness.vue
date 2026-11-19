<template>
  <section class="qsi-launch" :aria-label="tt('title')">
    <header>
      <h2>{{ tt('title') }}</h2>
      <p>{{ tt('intro') }}</p>
    </header>
    <div class="qsi-launch-stages">
      <article v-for="stage in stages" :key="stage.title" :class="'qsi-launch-' + stage.title">
        <span class="qsi-launch-emblem"><ClientIcon :name="stage.icon" /></span>
        <h3>{{ tt(stage.title) }}</h3>
        <span class="qsi-state-pill">{{ tt(stage.state) }}</span>
        <p>{{ tt(stage.detail) }}</p>
      </article>
    </div>
    <div class="qsi-launch-checks">
      <article v-for="service in services" :key="service.id">
        <div>
          <h3>{{ tt(service.id) }}</h3>
          <span class="qsi-state-pill">{{ tt(service.state) }}</span>
          <p v-if="service.detail">{{ tt(service.detail) }}</p>
        </div>
        <router-link :to="service.target" class="qsi-check-link">
          {{ tt(service.action) }} <ClientIcon name="arrowUpRight" />
        </router-link>
      </article>
    </div>
  </section>
</template>

<script setup>
import {computed} from 'vue';
import {currentLang} from '../../i18n/index.js';
import ClientIcon from '../reference/ClientIcon.vue';
import './launch-readiness.css';

const props = defineProps({readiness: {type: Object, required: true}});
const labels = {
  title: ['按阶段开放你的空间', '按階段開放你的空間', 'Choose how to open your workspace'],
  intro: ['先验证自己的操作，再邀请用户，最后确认收费流程。', '先驗證自己的操作，再邀請使用者，最後確認收費流程。', 'Try the workflow yourself, then invite users before testing paid access.'],
  local: ['本地体验', '本機體驗', 'Local trial'],
  trial: ['小范围试用', '小規模試用', 'Private trial'],
  launch: ['收费上线', '付費上線', 'Paid launch'],
  localDemo: ['本地演示可用', '本機展示可用', 'Local demo available'],
  demoAvailable: ['可开启本地体验', '可開啟本機體驗', 'Local demo can be enabled'],
  modelNeeded: ['先连接模型', '先連接模型', 'Connect a model first'],
  configured: ['已配置 · 待实测', '已設定 · 待實測', 'Configured · test pending'],
  pending: ['等待实际验收', '等待實際驗收', 'Live checks pending'],
  missing: ['待配置', '待設定', 'Setup needed'],
  unread: ['状态未读取', '狀態未讀取', 'Status unavailable'],
  closed: ['已关闭', '已關閉', 'Closed'],
  demo: ['仅模拟渠道', '僅模擬渠道', 'Demo channel only'],
  localDetail: ['自己走一遍对话、保存和历史恢复。', '自己走一遍對話、儲存和歷史還原。', 'Try a conversation, save it, then reopen its history.'],
  trialDetail: ['请用真实模型与用户登录方式完成一次创作。', '請使用真實模型與使用者登入方式完成一次創作。', 'Complete a creation using your live model and sign-in method.'],
  launchDetail: ['核对真实付款、发放权益、退款和对账。', '核對真實付款、發放權益、退款及對帳。', 'Verify live payment, credit delivery, refunds and reconciliation.'],
  registration: ['注册入口', '註冊入口', 'Registration'],
  mail: ['邮箱投递', '郵件寄送', 'Email delivery'],
  phone: ['短信投递', '簡訊寄送', 'SMS delivery'],
  external: ['扫码登录', '掃碼登入', 'QR sign-in'],
  payments: ['收款服务', '收款服務', 'Payments'],
  invite: ['邀请码注册', '邀請碼註冊', 'Invite-only registration'],
  public: ['公开注册', '公開註冊', 'Open registration'],
  emailNeeded: ['注册需要邮箱验证。', '註冊需要信箱驗證。', 'Registration requires email verification.'],
  receipt: ['已确认体验信', '已確認體驗郵件', 'Test email received'],
  resetCheck: ['请核对从邮件链接找回密码。', '請核對透過郵件連結找回密碼。', 'Verify password recovery from the email link.'],
  signInOnly: ['注册入口尚未启用。', '註冊入口尚未啟用。', 'Registration is currently off for this method.'],
  passwordOnly: ['已绑定号码可用密码登录。', '已綁定號碼可用密碼登入。', 'Linked numbers can still sign in with a password.'],
  manual: ['仅管理员建立账号', '僅管理員建立帳號', 'Administrator-created accounts only'],
  accessSettings: ['账号与安全', '帳號與安全', 'Account and security'],
  paymentSettings: ['会员与计费', '會員與計費', 'Membership and billing'],
  mailCenter: ['打开邮件投递台', '開啟郵件投遞台', 'Open mail center'],
};
const tt = key => labels[key][currentLang.value === 'en' ? 2 : currentLang.value === 'zh-TW' ? 1 : 0];
const launch = computed(() => props.readiness.launch ?? {});
const model = computed(() => props.readiness.chatModel);
const liveChat = computed(() => launch.value.liveChatConfigured ?? Boolean(model.value && !model.value.demo));
const paymentState = computed(() => {
  const state = launch.value.payments?.state;
  return ['closed', 'demo', 'missing', 'configured'].includes(state) ? state : 'unread';
});
const stages = computed(() => [
  {title: 'local', icon: 'chat', state: !model.value ? 'demoAvailable' : model.value.demo ? 'localDemo' : 'configured', detail: 'localDetail'},
  {title: 'trial', icon: 'user', state: liveChat.value ? 'pending' : 'modelNeeded', detail: 'trialDetail'},
  {title: 'launch', icon: 'wallet', state: paymentState.value, detail: 'launchDetail'},
]);
const services = computed(() => {
  const {registration, phone, external} = launch.value;
  const mail = props.readiness.checks.find(check => check.id === 'mail')?.state;
  const mode = registration?.mode;
  const security = {path: '/settings', query: {group: 'security'}};
  const commerce = {path: '/settings', query: {group: 'commerce'}};
  return [
    {id: 'registration', state: mode === 'admin' ? 'manual' : ['invite', 'public'].includes(mode) ? mode : 'unread', detail: mode !== 'admin' && registration?.emailVerificationRequired ? 'emailNeeded' : '', target: security, action: 'accessSettings'},
    {id: 'mail', state: mail === 'ready' ? 'receipt' : mail === 'configured' ? 'configured' : mail === 'optional' ? 'missing' : 'unread', detail: 'resetCheck', target: '/mail', action: 'mailCenter'},
    {id: 'phone', state: !phone ? 'unread' : phone.deliveryConfigured ? 'configured' : 'missing', detail: phone?.deliveryConfigured && !phone.registrationEnabled ? 'signInOnly' : !phone?.deliveryConfigured && phone?.passwordSignInEnabled ? 'passwordOnly' : '', target: security, action: 'accessSettings'},
    {id: 'external', state: ['closed', 'configured', 'missing'].includes(external?.state) ? external.state : 'unread', detail: external?.state === 'configured' && !external.registrationEnabled ? 'signInOnly' : '', target: security, action: 'accessSettings'},
    {id: 'payments', state: paymentState.value, target: commerce, action: 'paymentSettings'},
  ];
});
</script>
