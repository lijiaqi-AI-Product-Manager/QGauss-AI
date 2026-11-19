<template>
  <div class="qor-workspace">
    <header class="qor-hero">
      <span class="qor-emblem"><ClientIcon name="wallet" /></span>
      <div>
        <h1>订单与核对</h1>
        <p>按订单核对支付通知、权益到账和推广佣金。</p>
      </div>
      <button v-if="!disabled" class="qor-button" type="button" :disabled="loading" @click="load(page)">
        <ClientIcon name="refresh" />刷新
      </button>
    </header>

    <div v-if="disabled" class="qor-message" role="status">
      <ClientIcon name="info" />
      <div><strong>商业功能已关闭</strong><p>开启商业功能后即可在这里管理订单。</p></div>
      <router-link class="qor-button" :to="{ name: 'settings' }">前往系统设置</router-link>
    </div>

    <template v-else>
      <section v-if="overview" class="qor-overview" aria-label="当前筛选范围汇总">
        <article v-for="card in summary" :key="card.title" :class="'qor-card qor-card--' + card.tone">
          <span class="qor-card-icon"><ClientIcon :name="card.icon" /></span>
          <div>
            <h2>{{ card.title }}</h2>
            <strong>{{ card.value }}</strong>
            <p>{{ card.detail }}</p>
          </div>
        </article>
      </section>

      <section class="qor-board" aria-labelledby="qor-list-heading" :aria-busy="loading">
        <div class="qor-board-heading">
          <div>
            <h2 id="qor-list-heading">订单明细</h2>
            <p>下单日期按北京时间计算</p>
          </div>
          <button class="qor-button" type="button" :disabled="loading || !!loadError || !items.length" @click="exportPage">
            <ClientIcon name="download" />导出本页
          </button>
        </div>
        <form class="qor-filters" @submit.prevent="applyFilters">
          <label class="qor-keyword">
            订单号 / 交易号
            <span class="qor-search">
              <ClientIcon name="search" />
              <input v-model.trim="draft.keyword" type="search" maxlength="64" placeholder="输入号码查询" />
            </span>
          </label>
          <label>
            订单状态
            <select v-model="draft.status">
              <option value="">全部状态</option>
              <option v-for="(label, value) in orderStatuses" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>
            支付通道
            <select v-model="draft.platform">
              <option value="">全部通道</option>
              <option v-for="(label, value) in platforms" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>
            下单日期从
            <input v-model="draft.fromDay" type="date" :max="draft.throughDay || undefined" />
          </label>
          <label>
            下单日期至
            <input v-model="draft.throughDay" type="date" :min="draft.fromDay || undefined" />
          </label>
          <div class="qor-filter-actions">
            <button class="qor-button qor-button--primary" type="submit">查询</button>
            <button class="qor-button qor-button--quiet" type="button" @click="clearFilters">清空</button>
          </div>
        </form>

        <div v-if="loading" class="qor-empty" role="status">
          <span class="qor-loader" aria-hidden="true"></span>
          正在加载订单
        </div>
        <div v-else-if="loadError" class="qor-empty" role="alert">
          <ClientIcon name="info" />
          <strong>{{ loadError }}</strong>
          <button class="qor-button" type="button" @click="load(page)">重试</button>
        </div>
        <div v-else-if="!items.length" class="qor-empty" role="status">
          <ClientIcon name="file" />
          <strong>没有符合条件的订单</strong>
          <span>试试放宽日期或清空筛选。</span>
        </div>
        <ul v-else class="qor-orders" role="list" aria-label="订单列表">
          <li class="qor-order-head" aria-hidden="true">
            <span>商品 / 订单号</span><span>金额</span><span>状态 / 通道</span><span>下单时间</span><span></span>
          </li>
          <li v-for="row in items" :key="row.orderId" class="qor-order-row">
            <div class="qor-order-name">
              <span class="qor-item-icon"><ClientIcon :name="row.goodsType === 'money' ? 'wallet' : 'model'" /></span>
              <div>
                <strong>{{ row.goodsName || '订单商品' }}<small v-if="row.count > 1"> ×{{ row.count }}</small></strong>
                <span class="qor-id" :title="row.orderId">{{ row.orderId }}</span>
              </div>
            </div>
            <strong class="qor-amount">{{ currency(row.totalCents) }}</strong>
            <div class="qor-order-state">
              <span class="qor-badge" :data-tone="row.status === 1 ? (row.payPlatform === 'mock' ? 'demo' : 'paid') : row.status === 0 ? 'waiting' : 'muted'">
                {{ row.payPlatform === 'mock' && row.status === 1 ? '模拟已支付' : row.statusText }}
              </span>
              <span v-if="row.payPlatform && row.payPlatform !== 'mock'" class="qor-subtle">{{ platformLabel(row.payPlatform) }}</span>
            </div>
            <time class="qor-row-date" :datetime="row.createdAt">{{ orderDate(row.createdAt) }}</time>
            <button class="qor-button qor-review-link" type="button" :aria-label="'核对订单 ' + row.orderId" @click="selected = row.orderId">
              核对<ClientIcon name="chevronRight" />
            </button>
          </li>
        </ul>

        <nav v-if="total > 0 && !loadError && !loading" class="qor-pager" aria-label="订单分页">
          <span>共 {{ whole(total) }} 笔 · 第 {{ whole(page) }} / {{ whole(pageCount) }} 页</span>
          <div>
            <button class="qor-button" type="button" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
            <button class="qor-button" type="button" :disabled="page >= pageCount" @click="load(page + 1)">下一页</button>
          </div>
        </nav>
      </section>
    </template>
    <OrderReviewDialog v-if="selected" :order-id="selected" @close="selected = ''" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { api } from '../../api/client.js';
import ClientIcon from '../../components/reference/ClientIcon.vue';
import OrderReviewDialog from '../../components/admin/OrderReviewDialog.vue';
import { currency, downloadOrderCsv, orderDate, orderStatuses, platformLabel, platforms, whole } from '../../components/admin/order-review-format.js';
import './order-review.css';

const blankFilters = { status: '', platform: '', keyword: '', fromDay: '', throughDay: '' };
const pageSize = 20;
const draft = reactive({ ...blankFilters });
const disabled = ref(false);
const loading = ref(true);
const loadError = ref('');
const items = ref([]);
const total = ref(0);
const overview = ref(null);
const page = ref(1);
const selected = ref('');
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const summary = computed(() => [
  { title: '筛选订单', value: whole(total.value), icon: 'file', tone: 'violet', detail: '当前范围内的所有状态' },
  { title: '已支付订单金额', value: currency(overview.value.paidCents), icon: 'wallet', tone: 'mint', detail: '模拟付款单独汇总' },
  { title: '待付款', value: whole(overview.value.waitingCount), icon: 'info', tone: 'amber', detail: '当前仍可付款的订单' },
  { title: '模拟订单金额', value: currency(overview.value.demoCents), icon: 'model', tone: 'blue', detail: '已完成模拟付款' },
]);
let submitted = { ...blankFilters };
let pending;

async function load(targetPage = 1) {
  pending?.abort();
  const request = new AbortController();
  pending = request;
  loading.value = true;
  loadError.value = '';
  const query = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
  for (const [key, value] of Object.entries(submitted)) {
    if (value !== '') query.set(key, value);
  }
  try {
    const result = await api.get('/order/manage?' + query.toString(), { signal: request.signal });
    if (pending !== request) return;
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
    if (targetPage > lastPage) return load(lastPage);
    disabled.value = false;
    items.value = result.items;
    total.value = result.total;
    page.value = result.page;
    overview.value = result.overview;
  } catch (error) {
    if (pending !== request || request.signal.aborted) return;
    disabled.value = Number(error.code) === 8001;
    loadError.value = error.message || '订单加载失败';
    overview.value = null;
  } finally {
    if (pending === request) loading.value = false;
  }
}

function applyFilters() {
  submitted = { ...draft };
  void load(1);
}

function clearFilters() {
  Object.assign(draft, blankFilters);
  applyFilters();
}

function exportPage() {
  downloadOrderCsv('QGauss-订单-第' + page.value + '页', [
    ['订单号', '商品', '数量', '金额（分）', '状态', '通道', '交易号', '下单时间（北京时间）', '支付时间（北京时间）'],
    ...items.value.map(row => [
      row.orderId, row.goodsName, row.count, row.totalCents, row.statusText,
      platformLabel(row.payPlatform), row.tradeId, orderDate(row.createdAt), orderDate(row.paydAt),
    ]),
  ]);
}

onMounted(load);
onBeforeUnmount(() => pending?.abort());
</script>
