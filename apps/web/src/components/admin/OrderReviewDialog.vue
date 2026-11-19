<template>
  <Teleport to="body">
    <dialog ref="dialog" class="qor-dialog" aria-labelledby="qor-detail-heading" @close="emit('close')">
      <header class="qor-dialog-header">
        <span class="qor-card-icon"><ClientIcon name="file" /></span>
        <div>
          <h2 id="qor-detail-heading">订单核对单</h2>
          <p>{{ detail?.order.goodsName || '支付与到账凭证' }}</p>
        </div>
        <button class="qor-button qor-icon-button" type="button" aria-label="关闭核对单" autofocus @click="dialog.close()">
          <ClientIcon name="close" />
        </button>
      </header>
      <div class="qor-dialog-body" :aria-busy="loading">
        <div v-if="loading" class="qor-empty" role="status">
          <span class="qor-loader" aria-hidden="true"></span>正在读取核对凭证
        </div>
        <div v-else-if="error" class="qor-empty" role="alert">
          <ClientIcon name="info" />
          <strong>{{ error }}</strong>
          <button class="qor-button" type="button" @click="load">重试</button>
        </div>
        <template v-else-if="detail">
          <section class="qor-review-state" :data-tone="result.tone" aria-label="站内核对结果">
            <ClientIcon :name="result.icon" />
            <div>
              <strong>{{ result.label }}</strong>
              <ul v-if="detail.findings.length" class="qor-findings">
                <li v-for="finding in detail.findings" :key="finding">{{ finding }}</li>
              </ul>
              <p v-else>{{ result.description }}</p>
            </div>
          </section>

          <dl class="qor-receipt-grid">
            <div><dt>订单号</dt><dd class="qor-full-id">{{ detail.order.orderId }}</dd></div>
            <div><dt>交易号</dt><dd class="qor-full-id">{{ detail.order.tradeId || '—' }}</dd></div>
            <div><dt>订单状态</dt><dd>{{ detail.order.statusText }} · {{ currency(detail.order.totalCents) }}</dd></div>
            <div><dt>支付通道</dt><dd>{{ platformLabel(detail.order.payPlatform) }}</dd></div>
            <div><dt>下单时间</dt><dd>{{ orderDate(detail.order.createdAt) }}</dd></div>
            <div><dt>支付时间</dt><dd>{{ orderDate(detail.order.paydAt) }}</dd></div>
          </dl>

          <section class="qor-evidence" aria-labelledby="qor-grant-heading">
            <h3 id="qor-grant-heading"><ClientIcon name="model" />权益到账</h3>
            <div class="qor-evidence-row">
              <span>下单权益</span>
              <strong>{{ describeGrant(detail.expectedGrant) }}</strong>
            </div>
            <div v-for="grant in detail.grants" :key="grant.id" class="qor-evidence-row">
              <span>{{ orderDate(grant.createdAt) }}</span>
              <strong>{{ describeGrant(grant) }}</strong>
            </div>
            <p v-if="!detail.grants.length">暂无权益到账记录。</p>
            <p v-else-if="detail.grants.length === 2">已列出最近两条到账记录。</p>
          </section>

          <section class="qor-evidence" aria-labelledby="qor-notify-heading">
            <h3 id="qor-notify-heading"><ClientIcon name="bell" />支付通知</h3>
            <p v-if="detail.matchedNotification">已找到与订单匹配并完成处理的通知。</p>
            <p v-if="!detail.notices.length">{{ detail.state === 'demo' ? '模拟付款由站内登记。' : '暂无支付通知。' }}</p>
            <div v-for="notice in detail.notices" :key="notice.id" class="qor-evidence-row">
              <div>
                <strong>{{ platformLabel(notice.provider) }} · {{ noticeLabel(notice) }}</strong>
                <span v-if="notice.tradeId" class="qor-full-id">{{ notice.tradeId }}</span>
              </div>
              <div>
                <strong v-if="notice.verified">{{ currency(notice.amountCents) }}</strong>
                <span>{{ orderDate(notice.createdAt) }}</span>
              </div>
            </div>
            <p v-if="detail.moreNotices">列表展示最近 12 条，站内核对覆盖全部已验证通知。</p>
          </section>

          <section class="qor-evidence" aria-labelledby="qor-commission-heading">
            <h3 id="qor-commission-heading"><ClientIcon name="wallet" />佣金凭证</h3>
            <p v-if="!detail.commissions.length">暂无佣金记录。</p>
            <div v-for="commission in detail.commissions" :key="commission.id" class="qor-evidence-row">
              <div>
                <strong>{{ commission.settled ? '已记账' : '待记账' }} · {{ commission.commissionBps / 100 }}%</strong>
                <span>{{ orderDate(commission.createdAt) }}</span>
              </div>
              <strong>{{ currency(commission.commissionCents) }}</strong>
            </div>
            <p v-if="detail.commissions.length === 2">已列出最近两条佣金记录。</p>
          </section>

          <p class="qor-detail-note"><ClientIcon name="info" />时间为北京时间。渠道账单、费率与实际结算请在商户侧核对。</p>
        </template>
      </div>
      <footer v-if="detail" class="qor-dialog-footer">
        <button class="qor-button" type="button" :disabled="loading" @click="load"><ClientIcon name="refresh" />重新核对</button>
        <button class="qor-button qor-button--primary" type="button" :disabled="loading || !!error" @click="exportReview">
          <ClientIcon name="download" />导出核对单
        </button>
      </footer>
    </dialog>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api/client.js';
import ClientIcon from '../reference/ClientIcon.vue';
import { currency, downloadOrderCsv, orderDate, platformLabel, whole } from './order-review-format.js';

const props = defineProps({ orderId: { type: String, required: true } });
const emit = defineEmits(['close']);
const dialog = ref(null);
const detail = ref(null);
const loading = ref(true);
const error = ref('');
const outcomes = {
  matched: { label: '站内凭证已匹配', icon: 'check', tone: 'paid', description: '支付通知与订单一致，权益到账凭证已找到。' },
  demo: { label: '模拟订单', icon: 'model', tone: 'demo', description: '已找到本次模拟付款对应的权益到账凭证。' },
  attention: { label: '待人工核对', icon: 'info', tone: 'waiting' },
  open: { label: '无已确认收款', icon: 'file', tone: 'muted', description: '当前订单没有已确认的收款。' },
};
const result = computed(() => outcomes[detail.value.state]);
const grantFields = {
  model3Count: '基础', model4Count: '高级', drawMjCount: '绘画', agentCount: '应用',
};
let pending;

function describeGrant(grant) {
  if (!grant) return '暂无原始凭证';
  const parts = [];
  if (Object.hasOwn(grant, 'amountCents') && (grant.amountCents || grant.days === undefined)) {
    parts.push('余额 ' + currency(grant.amountCents));
  }
  for (const [field, label] of Object.entries(grantFields)) {
    if (grant[field]) parts.push(label + ' ' + whole(grant[field]) + ' 次');
  }
  if (grant.days) parts.push(grant.days < 0 ? '永久会员' : '会员 ' + whole(grant.days) + ' 天');
  return parts.join(' · ') || '无额外次数或会员权益';
}

function noticeLabel(notice) {
  if (notice.handled) return '已处理';
  return notice.verified ? '已验证待处理' : '未验证';
}

async function load() {
  pending?.abort();
  const request = new AbortController();
  pending = request;
  loading.value = true;
  error.value = '';
  try {
    const reviewed = await api.get('/order/manage/' + encodeURIComponent(props.orderId), { signal: request.signal });
    if (pending === request) detail.value = reviewed;
  } catch (failure) {
    if (pending === request && !request.signal.aborted) {
      detail.value = null;
      error.value = failure.message || '核对凭证加载失败';
    }
  } finally {
    if (pending === request) loading.value = false;
  }
}

function exportReview() {
  const { order, findings, expectedGrant, grants, notices, commissions, moreNotices, matchedNotification } = detail.value;
  downloadOrderCsv('QGauss-订单核对-' + order.orderId, [
    ['记录类型', '项目', '内容', '金额（分）', '时间（北京时间）'],
    ['订单', '订单号', order.orderId],
    ['订单', '商品', order.goodsName],
    ['订单', '状态', order.statusText, order.totalCents, orderDate(order.createdAt)],
    ['订单', '支付通道', platformLabel(order.payPlatform)],
    ['订单', '支付交易号', order.tradeId, '', orderDate(order.paydAt)],
    ['站内核对', '结果', result.value.label],
    ...findings.map(finding => ['站内核对', '待核事项', finding]),
    ['支付通知', '匹配凭证', matchedNotification ? '已找到' : '暂无'],
    ...notices.map(notice => ['支付通知', noticeLabel(notice), notice.tradeId || platformLabel(notice.provider), notice.amountCents, orderDate(notice.createdAt)]),
    ...(moreNotices ? [['支付通知', '范围', '仅列最近 12 条，站内核对覆盖全部已验证通知']] : []),
    ['权益', '下单权益', describeGrant(expectedGrant)],
    ...grants.map(grant => ['权益', '到账记录', describeGrant(grant), grant.amountCents, orderDate(grant.createdAt)]),
    ...commissions.map(commission => ['佣金', commission.settled ? '已记账' : '待记账', commission.commissionBps / 100 + '%', commission.commissionCents, orderDate(commission.createdAt)]),
    ['渠道结算', '待核对', '请核对商户账单、费率与实际结算'],
  ]);
}

onMounted(() => {
  dialog.value.showModal();
  void load();
});
onBeforeUnmount(() => pending?.abort());
</script>
