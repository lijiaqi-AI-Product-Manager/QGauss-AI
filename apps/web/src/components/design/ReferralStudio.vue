<template>
  <section class="qr-referral" aria-label="灵感接力站">
    <header class="qr-hero">
      <div class="qr-hero-copy"><span class="qr-eyebrow"><i></i> GOOD IDEAS TRAVEL TOGETHER</span><h1>好灵感，<br>值得<span>一起发光。</span></h1><p>邀请朋友加入 QGauss，把灵感传得更远。<br>每一份回响，都有清楚的记录。</p><div class="qr-hero-actions"><a href="#qr-partner" @click.prevent="scrollTo('qr-partner')">开启灵感接力<ClientIcon name="arrow" /></a><span>一个邀请码，一段新可能。</span></div></div>
      <div class="qr-link-art" aria-hidden="true"><i class="qr-art-track"></i><div class="qr-link-group"><i></i><i></i><i></i></div><span class="qr-art-star">✦</span><span class="qr-art-label"><ClientIcon name="user" /> YOU + YOUR PEOPLE</span><b>Q</b></div>
      <span class="qr-hero-index">QGAUSS / THE CREATIVE RELAY<br>A LITTLE CONNECTION. MORE POSSIBILITY.</span>
    </header>
    <section id="qr-partner" class="qr-partner" aria-labelledby="qr-partner-title">
      <header class="qr-section-heading"><div><span class="qr-eyebrow">YOUR CORNER OF THE CONNECTION</span><h2 id="qr-partner-title">把相遇，变成回响。</h2></div><button type="button" class="qr-refresh" :disabled="loading || !!busy" aria-label="刷新推广账户" @click="loadAccount"><ClientIcon name="refresh" /><span>刷新账户</span></button></header>
      <div v-if="loading" class="qr-loading" role="status"><BrandLoader :size="46" text="正在接上你的灵感回响…" /><div class="qr-skeleton"><i></i><i></i><i></i></div></div>
      <div v-else-if="phase === 'disabled'" class="qr-state"><ClientIcon name="info" /><h3>这里暂时还没开放。</h3><p>站点尚未开启推广与商业化，继续回到创作空间吧。</p><router-link to="/chat" class="qr-primary">回到创作<ClientIcon name="arrow" /></router-link></div>
      <div v-else-if="phase === 'error'" class="qr-state" role="alert"><ClientIcon name="refresh" /><h3>信号，稍微绕了点路。</h3><p>{{ accountError }}</p><button type="button" class="qr-primary" @click="loadAccount">重新读取账户<ClientIcon name="refresh" /></button></div>
      <template v-else-if="phase === 'eligible'">
        <div class="qr-join-card"><div><span class="qr-eyebrow">MAKE ROOM FOR YOUR PEOPLE</span><h3>下一位创作搭档，<br>也许就在你身边。</h3><p>开通推广账户后获得专属邀请码。朋友注册时填写，符合站点规则的成功付款订单会按实际配置计佣。</p><button type="button" class="qr-primary qr-open-join" :disabled="!!busy || applyingUncertain" @click="openJoin">了解并开通推广<ClientIcon name="arrowUpRight" /></button><p v-if="applyingUncertain" class="qr-inline-error" role="status">开通结果待确认。请先刷新账户，不要重复提交。</p></div><ol class="qr-steps"><li><span>01</span><div><strong>发出邀请</strong><p>朋友注册时绑定邀请码。</p></div><ClientIcon name="user" /></li><li><span>02</span><div><strong>创作有回响</strong><p>成功付款后按服务端规则计佣。</p></div><ClientIcon name="spark" /></li><li><span>03</span><div><strong>申请，再核对</strong><p>提现需审核，站外打款单独确认。</p></div><ClientIcon name="wallet" /></li></ol></div>
      </template>
      <template v-else-if="info">
        <p v-if="!info.enabled" class="qr-paused" role="status"><ClientIcon name="info" />推广账户已暂停，新订单不计佣、暂不可申请提现；历史记录仍可查看。</p>
        <div v-if="recoveryKey" class="qr-recovery" role="status"><ClientIcon name="info" /><p>有一笔提现结果待确认。先查询原申请；没有找到时，可按原金额与收款信息，用原请求再次确认。</p><button type="button" :disabled="!!busy" @click="findPending">查询原申请<ClientIcon name="refresh" /></button></div>
        <p v-if="recoveryMessage" class="qr-notice" role="status">{{ recoveryMessage }}</p>
        <div class="qr-account-grid">
          <article class="qr-balance-card"><span class="qr-eyebrow">ROOM FOR YOUR NEXT CHAPTER</span><span class="qr-balance-label">当前可提现</span><div class="qr-balance-number"><small>¥</small><strong>{{ referralMoney(info.distributionCents) }}</strong></div><p>佣金单独记录，不与模型次数或钱包余额互换。</p><a href="#qr-withdraw" @click.prevent="scrollTo('qr-withdraw')">核对提现方式<ClientIcon name="arrowUpRight" /></a><i aria-hidden="true"></i></article>
          <article class="qr-invite-card"><header><span class="qr-eyebrow">PASS A LITTLE POSSIBILITY</span><span class="qr-invite-tag">{{ info.enabled ? '接力中' : '已暂停' }}</span></header><h3>你的灵感邀请函。</h3><p>朋友注册时填写邀请码；通过邀请链接注册会预填，仍可自行修改。</p><code>{{ info.inviteCode }}</code><div class="qr-invite-actions"><button type="button" @click="copyInvite(false)"><ClientIcon name="copy" />复制邀请码</button><button type="button" :disabled="!shareLink" @click="copyInvite(true)"><ClientIcon name="arrowUpRight" />复制邀请链接</button></div><p v-if="copyMessage" class="qr-copy-status" role="status">{{ copyMessage }}</p><label v-if="copyFallback" class="qr-copy-fallback">请手动复制<input :value="copyFallback" readonly aria-label="手动复制邀请内容" @focus="$event.target.select()" /></label><footer><span><strong>{{ info.inviteeCount }}</strong> 位已绑定朋友</span><span><strong>{{ referralPercent(info.performanceBps) }}</strong> 当前佣金比例</span></footer></article>
        </div>
        <div class="qr-metrics"><article><ClientIcon name="spark" /><div><span>累计已记佣</span><strong>¥{{ referralMoney(info.totalCents) }}</strong><p>{{ info.orderCount }} 笔计佣订单 · 按每笔实际比例</p></div></article><article><ClientIcon name="refresh" /><div><span>申请处理中</span><strong>¥{{ referralMoney(processingCents) }}</strong><p>等待审核及审核通过待打款</p></div></article><article><ClientIcon name="check" /><div><span>已登记站外打款</span><strong>¥{{ referralMoney(info.withdrawalSummary?.paidCents) }}</strong><p>请以收款账户实际到账为准</p></div></article></div>
        <section id="qr-withdraw" class="qr-withdraw" aria-labelledby="qr-withdraw-title"><div class="qr-withdraw-copy"><span class="qr-eyebrow">CLEAR STEPS. NO GUESSWORK.</span><h2 id="qr-withdraw-title">每一笔，<br>先核对再出发。</h2><p>提交申请会立即冻结金额，等待审核。驳回后退回可提现余额；审核通过与登记打款分开显示。</p><span v-if="info.withdrawalPolicy" class="qr-policy"><ClientIcon name="info" />单笔 ¥{{ referralMoney(info.withdrawalPolicy.minCents) }}–¥{{ referralMoney(info.withdrawalPolicy.maxCents) }}</span></div><form class="qr-withdraw-form" @submit.prevent="reviewWithdrawal"><label for="qr-amount">申请金额 <span>人民币 / 元</span></label><div class="qr-amount"><span>¥</span><input id="qr-amount" v-model="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="提现金额" :disabled="!info.enabled || !!busy" /><button type="button" :disabled="!info.enabled || !!busy" @click="fillAvailable">全部可提</button></div><fieldset :disabled="!info.enabled || !!busy"><legend>收款方式</legend><label v-for="item in channels" :key="item.key"><input v-model="channel" type="radio" name="qr-channel" :value="item.key" /><span>{{ item.label }}</span><ClientIcon name="check" /></label></fieldset><label for="qr-contact">收款账号<span>仅用于本次站外打款</span></label><input id="qr-contact" v-model="contact" type="text" autocomplete="off" maxlength="120" placeholder="填写可核对的完整收款账号" aria-label="提现收款账号" :disabled="!info.enabled || !!busy" /><p class="qr-private-note">请确认账号与收款方式一致。页面离开后清空输入，不在浏览器保存收款账号。</p><p v-if="formError" class="qr-inline-error" role="alert">{{ formError }}</p><button class="qr-primary qr-review-withdraw" type="submit" :disabled="!info.enabled || !!busy">{{ recoveryKey ? '核对原申请信息' : '核对提现申请' }}<ClientIcon name="arrow" /></button></form></section>
        <section class="qr-journal" aria-labelledby="qr-journal-title">
          <header class="qr-section-heading"><div><span class="qr-eyebrow">EVERY CONNECTION LEAVES A TRACE</span><h2 id="qr-journal-title">灵感接力，有迹可循。</h2></div><button type="button" class="qr-refresh" :disabled="journal.loading" aria-label="刷新推广记录" @click="loadJournal"><ClientIcon name="refresh" /></button></header>
          <div class="qr-journal-tools"><div class="qr-journal-tabs" role="group" aria-label="推广记录类型"><button v-for="item in journalTabs" :key="item.key" type="button" :aria-pressed="tab === item.key" @click="tab = item.key">{{ item.label }}</button></div><form v-if="tab === 'records'" @submit.prevent="searchRecords"><label><ClientIcon name="search" /><input v-model="searchDraft" aria-label="搜索佣金订单号" maxlength="64" placeholder="搜索计佣订单号" /></label><button type="submit">查找</button></form><label v-else class="qr-stage-filter">申请状态<select v-model="stage" aria-label="提现申请状态"><option value="">全部状态</option><option value="pending">等待审核</option><option value="approved">审核通过待打款</option><option value="paid">已登记打款</option><option value="rejected">已驳回</option></select></label></div>
          <div v-if="journal.loading" class="qr-journal-loading" role="status"><BrandLoader :size="28" text="正在整理这段回响…" /></div><div v-else-if="journal.error" class="qr-state qr-journal-state" role="alert"><h3>记录暂时没有接上。</h3><p>{{ journal.error }}</p><button type="button" class="qr-primary" @click="loadJournal">重试读取<ClientIcon name="refresh" /></button></div>
          <div v-else-if="!journal.items.length" class="qr-state qr-journal-state"><ClientIcon :name="tab === 'records' ? 'spark' : 'file'" /><h3>{{ searchTerm || stage ? '这组条件下，还没有记录。' : tab === 'records' ? '每段接力，都从第一位朋友开始。' : '你的第一笔申请，还在未来。' }}</h3><p>{{ tab === 'records' ? '这里只展示真实已记佣订单，不会预估尚未发生的收入。' : '审核、驳回和打款登记会分别记录在这里。' }}</p></div>
          <ul v-else class="qr-journal-list" :aria-label="tab === 'records' ? '佣金明细' : '提现申请记录'"><li v-for="row in journal.items" :key="row.id"><span class="qr-row-icon"><ClientIcon :name="tab === 'records' ? 'spark' : 'wallet'" /></span><div class="qr-row-copy"><strong>{{ tab === 'records' ? '一份创作回响' : receivingChannel(row.channels) + ' · ' + maskedContact(row.contact) }}</strong><span>{{ walletDate(row.createdAt) }}（北京）</span><code>{{ tab === 'records' ? row.orderId : row.id }}</code></div><div class="qr-row-value"><strong>{{ tab === 'records' ? '+' : '' }}¥{{ referralMoney(tab === 'records' ? row.commissionCents : row.amountCents) }}</strong><span v-if="tab === 'records'">订单 ¥{{ referralMoney(row.orderCents) }} · {{ referralPercent(row.commissionBps) }}</span><span v-else :class="'qr-status-' + withdrawalStage(row).key">{{ withdrawalStage(row).label }}</span></div><button type="button" class="qr-row-open" :aria-label="'查看' + (tab === 'records' ? '佣金：' + row.orderId : '提现：' + row.id)" @click="openReceipt(row, $event)"><ClientIcon name="arrowUpRight" /></button></li></ul>
          <footer class="qr-pagination"><span v-if="journal.total !== null">共 {{ journal.total }} 条</span><nav aria-label="推广记录分页"><button type="button" aria-label="上一页推广记录" :disabled="journal.loading || journal.page === 1" @click="changePage(-1)"><ClientIcon name="chevronLeft" /></button><span>第 {{ journal.page }} 页{{ journal.total !== null ? ' / ' + Math.max(1, Math.ceil(journal.total / pageSize)) : '' }}</span><button type="button" aria-label="下一页推广记录" :disabled="journal.loading || journal.total === null || journal.page * pageSize >= journal.total" @click="changePage(1)"><ClientIcon name="chevronRight" /></button></nav></footer>
        </section>
      </template>
      <section v-if="phase === 'ready' || phase === 'eligible'" class="qr-faq" aria-label="推广说明"><details><summary>邀请关系，什么时候建立？<ClientIcon name="plus" /></summary><p>新用户注册时填写有效邀请码，服务端在注册时绑定。点击链接不会自动注册或同意协议，登录已有账户也不会重新绑定。</p></details><details><summary>佣金比例会一直不变吗？<ClientIcon name="plus" /></summary><p>当前比例来自站点实际配置。每笔佣金记录保留当时比例；未来配置变化不改写已产生记录。不开虚构收益或预计到账承诺。</p></details><details><summary>审核通过，就等于到账吗？<ClientIcon name="plus" /></summary><p>审核通过和管理员登记站外打款是不同状态，最终以你的收款账户为准。驳回会退回可提现余额；有疑问请保留申请编号核对。</p></details></section>
    </section>
    <dialog ref="dialog" class="qr-dialog" aria-labelledby="qr-dialog-title" @cancel.prevent="closeDialog" @close="onDialogClosed" @click="onBackdrop">
      <template v-if="modal">
        <header><span class="qr-eyebrow">A CLEAR NEXT STEP</span><button type="button" aria-label="关闭推广详情" @click="closeDialog"><ClientIcon name="close" /></button></header><span class="qr-dialog-symbol"><ClientIcon :name="modal.type === 'join' ? 'user' : modal.type === 'commission' ? 'spark' : 'wallet'" /></span><h2 id="qr-dialog-title">{{ modal.type === 'join' ? '一起，让灵感走远一点。' : modal.type === 'withdraw' ? '确认这笔申请。' : modal.type === 'commission' ? '这一份，已记下。' : withdrawalStage(modal.row).label }}</h2>
        <template v-if="modal.type === 'join'"><p>开通后获得邀请码，朋友注册时可填写。佣金按实际成功付款和服务端规则记录，比例可由管理员调整。</p><p>开通本身不创建充值或提现，也不会向朋友发送消息。已有账户不会因为访问邀请链接重新绑定。</p><button type="button" class="qr-primary qr-confirm-join" :disabled="!!busy || applyingUncertain" @click="apply">{{ busy ? '正在确认开通…' : '确认开通推广账户' }}<ClientIcon name="arrow" /></button></template>
        <template v-else-if="modal.type === 'withdraw'"><div class="qr-dialog-amount"><small>¥</small>{{ modal.payload.amountYuan }}</div><dl><div><dt>收款方式</dt><dd>{{ receivingChannel(modal.payload.channels) }}</dd></div><div><dt>收款账号</dt><dd class="qr-contact-full">{{ modal.payload.contact }}</dd></div><div><dt>提交后</dt><dd>冻结申请金额，等待审核</dd></div></dl><p>此操作提交提现申请，不直接完成站外打款。请再次核对金额、方式和完整账号。</p><p v-if="modal.uncertain" class="qr-inline-error" role="status">结果待确认，请先查询原申请。使用原请求重试只会冻结一次。</p><button v-if="modal.uncertain" type="button" class="qr-secondary" :disabled="!!busy" @click="findPending">查询原申请<ClientIcon name="refresh" /></button><button type="button" class="qr-primary qr-confirm-withdraw" :disabled="!!busy" @click="submitWithdrawal">{{ busy ? '正在确认申请…' : modal.uncertain ? '用原请求确认申请' : '确认申请并冻结 ¥' + modal.payload.amountYuan }}<ClientIcon name="arrow" /></button></template>
        <template v-else-if="modal.row"><div class="qr-dialog-amount"><small>¥</small>{{ referralMoney(modal.type === 'commission' ? modal.row.commissionCents : modal.row.amountCents) }}</div><dl v-if="modal.type === 'commission'"><div><dt>原订单金额</dt><dd>¥{{ referralMoney(modal.row.orderCents) }}</dd></div><div><dt>当时佣金比例</dt><dd>{{ referralPercent(modal.row.commissionBps) }}</dd></div><div><dt>计佣订单</dt><dd><code>{{ modal.row.orderId }}</code></dd></div></dl><template v-else><p>{{ withdrawalStage(modal.row).note }}</p><dl><div><dt>收款方式</dt><dd>{{ receivingChannel(modal.row.channels) }}</dd></div><div><dt>收款账号</dt><dd class="qr-contact-full">{{ revealContact ? modal.row.contact : maskedContact(modal.row.contact) }}<button type="button" class="qr-reveal" :aria-pressed="revealContact" @click="revealContact = !revealContact">{{ revealContact ? '收起完整账号' : '显示完整账号' }}</button></dd></div><div><dt>申请编号</dt><dd><code>{{ modal.row.id }}</code></dd></div><div v-if="modal.row.auditedAt"><dt>审核时间</dt><dd>{{ walletDate(modal.row.auditedAt) }}（北京）</dd></div><div v-if="modal.row.remark"><dt>记录说明</dt><dd>{{ modal.row.remark }}</dd></div></dl></template><p>记录时间 {{ walletDate(modal.row.createdAt) }}（北京）</p><button v-if="modal.type === 'receipt'" type="button" class="qr-secondary" :disabled="!!busy" @click="refreshReceipt">读取最新状态<ClientIcon name="refresh" /></button><button type="button" class="qr-primary" @click="closeDialog">收好这份记录<ClientIcon name="check" /></button></template>
        <p v-if="modal.error" class="qr-inline-error" role="alert">{{ modal.error }}</p>
      </template>
    </dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';
import { walletDate } from '../../lib/wallet-presentation.js';
import { referralMoney, referralPercent, withdrawalStage, receivingChannel, maskedContact, invitationLink, withdrawalChoice } from '../../lib/referral-presentation.js';
import BrandLoader from './BrandLoader.vue';
import ClientIcon from '../reference/ClientIcon.vue';
import './referral-studio.css';
const auth = useAuth();
const phase = ref('loading'), loading = ref(true), info = ref(null), accountError = ref(''), busy = ref(''), applyingUncertain = ref(false);
const amount = ref(''), channel = ref(1), contact = ref(''), formError = ref(''), tab = ref('records'), stage = ref(''), searchDraft = ref(''), searchTerm = ref('');
const copyMessage = ref(''), copyFallback = ref(''), recoveryKey = ref(''), recoveryMessage = ref(''), dialog = ref(null), modal = ref(null), revealContact = ref(false);
const pageSize = 6, journal = reactive({ items: [], total: null, page: 1, loading: false, error: '' });
const channels = [{ key: 1, label: '支付宝' }, { key: 2, label: '微信' }, { key: 3, label: '银行卡' }];
const journalTabs = [{ key: 'records', label: '佣金明细' }, { key: 'withdrawals', label: '提现申请' }];
const shareLink = computed(() => invitationLink(info.value?.inviteCode, window.location.origin));
const processingCents = computed(() => { const summary = info.value?.withdrawalSummary; return Number.isSafeInteger(summary?.pendingCents) && Number.isSafeInteger(summary?.approvedUnpaidCents) ? summary.pendingCents + summary.approvedUnpaidCents : null; });
let alive = true, owner = auth.user?.id, opener = null;
const controllers = new Map();
const current = () => alive && !!owner && owner === auth.user?.id;
function scope(key) { controllers.get(key)?.abort(); const controller = new AbortController(), user = owner; controllers.set(key, controller); return { signal: controller.signal, current: () => current() && owner === user && !controller.signal.aborted && controllers.get(key) === controller }; }
function storedKey() { return 'qg:withdraw-pending:' + owner; }
function rememberKey(key) { recoveryKey.value = key; try { if (key) sessionStorage.setItem(storedKey(), key); else sessionStorage.removeItem(storedKey()); } catch { /* Never store receiving accounts. */ } }
function readPending() { try { const key = sessionStorage.getItem(storedKey()); recoveryKey.value = /^[A-Za-z0-9_-]{16,80}$/.test(key || '') ? key : ''; } catch { recoveryKey.value = ''; } }
async function loadAccount() {
  if (!current() || busy.value) return;
  const req = scope('account'); loading.value = true; accountError.value = '';
  try {
    const config = await api.get('/settings/public', { signal: req.signal }); if (!req.current()) return;
    if (config['commerce.enabled'] === false) { info.value = null; phase.value = 'disabled'; return; }
    const data = await api.get('/sales/info', { signal: req.signal }); if (!req.current()) return;
    info.value = data; phase.value = 'ready'; applyingUncertain.value = false; void loadJournal();
  } catch (error) {
    if (!req.current()) return; info.value = null;
    if (error.status === 403) { phase.value = 'eligible'; applyingUncertain.value = false; }
    else { phase.value = 'error'; accountError.value = error.message || '推广账户暂时读取失败，请稍后重试。'; }
  } finally { if (req.current()) loading.value = false; }
}
async function loadJournal() {
  if (!current() || phase.value !== 'ready') return;
  const req = scope('journal'), selected = tab.value; journal.loading = true; journal.error = ''; journal.items = []; journal.total = null;
  const query = new URLSearchParams({ page: String(journal.page), pageSize: String(pageSize) }); if (selected === 'records' && searchTerm.value) query.set('keyword', searchTerm.value); if (selected === 'withdrawals' && stage.value) query.set('stage', stage.value);
  try { const data = await api.get((selected === 'records' ? '/sales/records?' : '/sales/withdrawals?') + query, { signal: req.signal }); if (req.current()) { journal.items = Array.isArray(data.items) ? data.items : []; journal.total = Number.isSafeInteger(data.total) ? data.total : null; } }
  catch (error) { if (req.current()) journal.error = error.message || '记录暂时读取失败，请重试。'; }
  finally { if (req.current()) journal.loading = false; }
}
function searchRecords() { searchTerm.value = searchDraft.value.trim(); journal.page = 1; void loadJournal(); }
function changePage(delta) { if (journal.loading || journal.page + delta < 1 || delta > 0 && (journal.total === null || journal.page * pageSize >= journal.total)) return; journal.page += delta; void loadJournal(); }
watch([tab, stage], () => { journal.page = 1; void loadJournal(); });
async function showDialog(value, event) { if (!current() || busy.value) return; opener = event?.currentTarget?.matches?.('button,a') ? event.currentTarget : document.activeElement; revealContact.value = false; modal.value = value; const context = modal.value; await nextTick(); if (current() && modal.value === context && !dialog.value.open) dialog.value.showModal(); }
function openJoin(event) { if (phase.value === 'eligible' && !applyingUncertain.value) void showDialog({ type: 'join', error: '' }, event); }
async function apply() {
  const context = modal.value; if (!current() || busy.value || context?.type !== 'join' || applyingUncertain.value) return;
  const req = scope('mutation'); busy.value = 'apply'; context.error = '';
  try { const data = await api.post('/sales/apply', {}, { signal: req.signal }); if (!req.current() || modal.value !== context) return; info.value = data; phase.value = 'ready'; busy.value = ''; closeDialog(); void loadJournal(); }
  catch (error) { if (req.current() && modal.value === context) { applyingUncertain.value = !error.status || error.status >= 500; context.error = applyingUncertain.value ? '开通结果待确认，关闭后请先刷新账户。' : error.message || '开通未完成。'; } }
  finally { if (req.current()) busy.value = ''; }
}
async function copyInvite(link) {
  const text = link ? shareLink.value : info.value?.inviteCode; if (!text || !current()) return; const user = owner; copyMessage.value = ''; copyFallback.value = '';
  try { await navigator.clipboard.writeText(text); if (current() && owner === user) copyMessage.value = link ? '邀请链接已复制。朋友仍需自行完成注册。' : '邀请码已复制。'; }
  catch { if (current() && owner === user) { copyMessage.value = '浏览器未允许复制，可在下方手动复制。'; copyFallback.value = text; } }
}
function fillAvailable() { const max = info.value?.withdrawalPolicy?.maxCents; if (Number.isSafeInteger(info.value?.distributionCents) && Number.isSafeInteger(max)) amount.value = referralMoney(Math.min(info.value.distributionCents, max)); }
function reviewWithdrawal(event) {
  if (!current() || busy.value || !info.value?.enabled) return; const result = withdrawalChoice(amount.value, channel.value, contact.value, info.value.withdrawalPolicy, info.value.distributionCents); formError.value = result.error || ''; if (!result.payload) return;
  void showDialog({ type: 'withdraw', payload: { ...result.payload, requestKey: recoveryKey.value || crypto.randomUUID() }, error: '', uncertain: !!recoveryKey.value }, event);
}
async function submitWithdrawal() {
  const context = modal.value; if (!current() || busy.value || context?.type !== 'withdraw') return; const req = scope('mutation'), priorAttempt = !!context.attempted || context.uncertain; context.attempted = true; busy.value = 'withdraw'; context.error = ''; rememberKey(context.payload.requestKey);
  try { const data = await api.post('/sales/withdraw', context.payload, { signal: req.signal }); if (!req.current() || modal.value !== context) return; if (!data?.id) throw new Error('申请结果不完整'); rememberKey(''); recoveryMessage.value = '申请已确认，只冻结一次；可查看最新状态。'; amount.value = ''; contact.value = ''; modal.value = { type: 'receipt', row: data, error: '' }; revealContact.value = false; busy.value = ''; void loadAccount(); tab.value = 'withdrawals'; }
  catch (error) { if (req.current() && modal.value === context) { const known = [400, 403, 404, 429].includes(error.status); context.uncertain = !known || priorAttempt; if (known && !priorAttempt) { rememberKey(''); context.attempted = false; } context.error = known && priorAttempt ? '原申请结果仍待确认，请查询原申请；保留同一请求标识，不创建替代申请。' : known ? error.message || '申请未提交，请核对信息。' : error.status === 409 ? '原请求信息不一致，请查询原申请，勿创建替代申请。' : '申请结果尚未确认。请先查询原申请，或用原请求继续确认。'; } }
  finally { if (req.current()) busy.value = ''; }
}
async function findPending() {
  if (!current() || busy.value || !recoveryKey.value) return; const req = scope('recovery'); busy.value = 'recovery'; recoveryMessage.value = ''; const context = modal.value;
  try { const data = await api.get('/sales/withdrawals?requestKey=' + encodeURIComponent(recoveryKey.value) + '&page=1&pageSize=1', { signal: req.signal }); if (!req.current()) return; const row = data.items?.[0];
    if (row) { rememberKey(''); amount.value = ''; contact.value = ''; recoveryMessage.value = '已取回原申请，未再次冻结金额。'; busy.value = ''; if (context && modal.value === context) modal.value = { type: 'receipt', row, error: '' }; else await showDialog({ type: 'receipt', row, error: '' }); void loadAccount(); tab.value = 'withdrawals'; }
    else { recoveryMessage.value = '暂未找到原申请。可稍后再查；按原金额与收款信息用同一请求重试，不要创建替代请求。'; if (context && modal.value === context) context.error = recoveryMessage.value; }
  } catch (error) { if (req.current()) { recoveryMessage.value = error.message || '原申请尚未确认，请稍后重新查询。'; if (context && modal.value === context) context.error = recoveryMessage.value; } }
  finally { if (req.current()) busy.value = ''; }
}
function openReceipt(row, event) { void showDialog({ type: tab.value === 'records' ? 'commission' : 'receipt', row: { ...row }, error: '' }, event); }
async function refreshReceipt() {
  const context = modal.value; if (!current() || busy.value || context?.type !== 'receipt') return; const req = scope('receipt'); busy.value = 'receipt'; context.error = '';
  try { const data = await api.get('/sales/withdrawals?id=' + encodeURIComponent(context.row.id) + '&page=1&pageSize=1', { signal: req.signal }); if (!req.current() || modal.value !== context) return; if (!data.items?.[0]) throw new Error('未找到这份申请，请稍后核对。'); context.row = data.items[0]; void loadJournal(); }
  catch (error) { if (req.current() && modal.value === context) context.error = error.message || '最新状态尚未读取。'; }
  finally { if (req.current()) busy.value = ''; }
}
function closeDialog(restore = true) { controllers.get('mutation')?.abort(); controllers.get('receipt')?.abort(); controllers.get('recovery')?.abort(); if (busy.value === 'apply') applyingUncertain.value = true; if (dialog.value?.open) dialog.value.close(); modal.value = null; revealContact.value = false; busy.value = ''; const target = opener; opener = null; if (restore && target?.isConnected) target.focus({ preventScroll: true }); }
function onDialogClosed() { if (!dialog.value?.open && modal.value) closeDialog(); }
function onBackdrop(event) { if (event.target !== dialog.value) return; const r = dialog.value.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); }
function scrollTo(id) { document.getElementById(id)?.scrollIntoView({ behavior: document.documentElement.dataset.qgMotion === 'quiet' || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
function clear() { for (const c of controllers.values()) c.abort(); controllers.clear(); closeDialog(false); info.value = null; phase.value = 'loading'; loading.value = true; accountError.value = ''; amount.value = ''; contact.value = ''; channel.value = 1; formError.value = ''; tab.value = 'records'; stage.value = ''; searchDraft.value = ''; searchTerm.value = ''; journal.items = []; journal.total = null; journal.page = 1; journal.loading = false; journal.error = ''; recoveryKey.value = ''; recoveryMessage.value = ''; copyMessage.value = ''; copyFallback.value = ''; applyingUncertain.value = false; }
watch(() => auth.user?.id, id => { if (id === owner) return; try { sessionStorage.removeItem(storedKey()); } catch {} clear(); owner = id; if (id) { readPending(); void loadAccount(); } });
onMounted(() => { readPending(); void loadAccount(); });
onBeforeUnmount(() => { alive = false; clear(); });
</script>
