<template>
  <div class="qor-workspace qst-workspace">
    <header class="qor-hero">
      <span class="qor-emblem"><ClientIcon name="file" /></span>
      <div>
        <h1>商户账单</h1>
        <p>导入渠道收款、退款凭证并与站内订单核对。</p>
      </div>
      <router-link class="qor-button" :to="{ name: 'ordersAdmin' }"><ClientIcon name="wallet" />订单管理</router-link>
    </header>

    <div class="qst-layout">
      <div class="qst-stack">
        <section class="qor-board qst-import" aria-labelledby="statement-import-heading">
          <div class="qor-board-heading">
            <h2 id="statement-import-heading">导入账单</h2>
            <button class="qor-button" type="button" @click="downloadTemplate"><ClientIcon name="download" />下载模板</button>
          </div>
          <form class="qst-form" @submit.prevent="importFile">
            <label>
              所属通道
              <select v-model="provider" required>
                <option value="" disabled>选择收款通道</option>
                <option value="epay">{{ platformLabel('epay') }}</option>
                <option value="hupi">{{ platformLabel('hupi') }}</option>
              </select>
            </label>
            <label>
              账单文件
              <input ref="fileInput" type="file" accept=".csv,text/csv" required @change="selectFile" />
              <small>UTF-8 CSV，最多 3000 条，1 MB</small>
            </label>
            <label class="qst-checkbox">
              <input v-model="completePeriod" type="checkbox" />
              按完整账期核对缺行
            </label>
            <div v-if="completePeriod" class="qst-dates">
              <label>开始日期<input v-model="fromDay" type="date" required :max="throughDay || undefined" /></label>
              <label>结束日期<input v-model="throughDay" type="date" required :min="fromDay || undefined" /></label>
              <small>按北京时间计算，最多 31 天。</small>
            </div>
            <button class="qor-button qor-button--primary" type="submit" :disabled="importing">
              <ClientIcon name="file" />{{ importing ? '正在核对…' : '导入并核对' }}
            </button>
            <p v-if="importError" class="qst-error" role="alert">{{ importError }}</p>
            <p v-if="importNotice" class="qst-notice" role="status">{{ importNotice }}</p>
          </form>
        </section>

        <section class="qor-board qst-archive" aria-labelledby="statement-history-heading">
          <div class="qor-board-heading">
            <h2 id="statement-history-heading">账单档案</h2>
            <button class="qor-button qor-icon-button" type="button" aria-label="刷新账单档案" :disabled="historyLoading" @click="loadArchive(archivePage)">
              <ClientIcon name="refresh" />
            </button>
          </div>
          <p v-if="historyLoading" class="qst-placeholder" role="status">正在加载账单…</p>
          <p v-else-if="historyError" class="qst-error" role="alert">{{ historyError }}</p>
          <p v-else-if="!archive.length" class="qst-placeholder">已导入的账单会留在这里。</p>
          <ul v-else class="qst-archive-list" role="list">
            <li v-for="item in archive" :key="item.id">
              <button class="qst-archive-item" type="button" :aria-pressed="selectedId === item.id" @click="openStatement(item.id, true)">
                <span class="qor-card-icon"><ClientIcon name="file" /></span>
                <span>
                  <strong :title="item.fileName">{{ item.fileName }}</strong>
                  <small>{{ platformLabel(item.provider) }} · {{ whole(item.openCount) }} 笔待复核</small>
                </span>
                <ClientIcon name="chevronRight" />
              </button>
            </li>
          </ul>
          <nav v-if="archiveTotal > archiveSize" class="qor-pager" aria-label="账单档案分页">
            <button class="qor-button" type="button" :disabled="archivePage <= 1 || historyLoading" @click="loadArchive(archivePage - 1)">上一页</button>
            <button class="qor-button" type="button" :disabled="archivePage * archiveSize >= archiveTotal || historyLoading" @click="loadArchive(archivePage + 1)">下一页</button>
          </nav>
        </section>
      </div>

      <section class="qor-board qst-results" aria-labelledby="statement-result-heading" :aria-busy="detailLoading">
        <header class="qor-board-heading">
          <div>
            <h2 id="statement-result-heading" ref="detailHeading" tabindex="-1">核对结果</h2>
            <p v-if="result">{{ platformLabel(result.statement.provider) }} · {{ periodLabel(result.statement) }}</p>
          </div>
          <button v-if="result" class="qor-button" type="button" :disabled="exporting || detailLoading || !result.total" @click="exportResult">
            <ClientIcon name="download" />{{ exporting ? '正在导出…' : '导出结果' }}
          </button>
        </header>
        <p v-if="detailError" class="qst-error" role="alert">{{ detailError }}</p>
        <p v-if="exportError" class="qst-error" role="alert">{{ exportError }}</p>
        <div v-if="detailLoading" class="qor-empty" role="status">
          <span class="qor-loader" aria-hidden="true"></span>正在读取核对结果
        </div>
        <div v-else-if="!result" class="qor-empty">
          <ClientIcon name="file" />
          <strong>{{ detailError ? '核对结果加载失败' : '等待账单' }}</strong>
          <button v-if="detailError" class="qor-button" type="button" @click="loadDetail(1)">重试</button>
          <span v-else>导入新账单或打开一份历史账单。</span>
        </div>
        <template v-else>
          <dl class="qst-overview" aria-label="渠道金额汇总">
            <div><dt>渠道收款</dt><dd>{{ currency(result.statement.paymentCents) }}</dd></div>
            <div><dt>渠道退款</dt><dd>{{ currency(result.statement.refundCents) }}</dd></div>
            <div><dt>账单手续费</dt><dd>{{ result.statement.feeCents === null ? '有缺项' : currency(result.statement.feeCents) }}</dd></div>
          </dl>
          <div class="qst-filters" role="group" aria-label="筛选核对状态">
            <button v-for="filter in statusFilters" :key="filter.value" type="button" class="qor-button"
              :aria-pressed="state === filter.value" @click="selectState(filter.value)">
              {{ filter.label }} {{ whole(result.statement[filter.count]) }}
            </button>
          </div>

          <div v-if="!result.items.length" class="qor-empty">
            <ClientIcon name="check" />
            <strong>这个状态下没有记录</strong>
          </div>
          <ul v-else class="qst-result-list" aria-label="账单记录" role="list">
            <li v-for="row in result.items" :key="row.id" class="qst-result-row">
              <div class="qst-result-label">
                <strong>{{ rowType(row.kind) }}</strong>
                <small :title="row.eventRef || row.orderRef">{{ row.eventRef || row.orderRef }}</small>
              </div>
              <div class="qst-result-amount">
                <strong>{{ row.amountCents === null ? currency(row.localAmountCents) : currency(row.amountCents) }}</strong>
                <small>{{ row.amountCents === null ? '站内金额' : '渠道金额' }}</small>
              </div>
              <span class="qor-badge" :data-tone="row.state === 'open' ? 'waiting' : row.state === 'matched' ? 'paid' : 'demo'">
                {{ stateName(row.state) }}
              </span>
              <button class="qor-button" type="button" :aria-label="'查看 ' + (row.eventRef || row.orderRef)" @click="selectedRow = row">
                查看<ClientIcon name="chevronRight" />
              </button>
            </li>
          </ul>
          <nav v-if="result.total > 0" class="qor-pager" aria-label="账单记录分页">
            <span>共 {{ whole(result.total) }} 笔 · 第 {{ whole(result.page) }} / {{ whole(detailPages) }} 页</span>
            <div>
              <button class="qor-button" type="button" :disabled="result.page <= 1" @click="loadDetail(result.page - 1)">上一页</button>
              <button class="qor-button" type="button" :disabled="result.page >= detailPages" @click="loadDetail(result.page + 1)">下一页</button>
            </div>
          </nav>
        </template>
      </section>
    </div>

    <PaymentStatementDialog v-if="selectedRow" :statement-id="selectedId" :entry="selectedRow"
      @close="selectedRow = null" @saved="refreshAfterReview" @stale="loadDetail(result?.page)" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { api, uploadPaymentStatement } from '../../api/client.js';
import ClientIcon from '../../components/reference/ClientIcon.vue';
import PaymentStatementDialog from '../../components/admin/PaymentStatementDialog.vue';
import { currency, downloadOrderCsv, orderDate, platformLabel, whole } from '../../components/admin/order-review-format.js';
import { importColumns, periodLabel, rowType, stateName } from '../../components/admin/payment-statement-format.js';
import './order-review.css';
import './payment-statements.css';

const endpoint = '/admin/payment-statements';
const archiveSize = 6;
const statusFilters = [
  { value: '', label: '全部', count: 'rowCount' },
  { value: 'open', label: '待复核', count: 'openCount' },
  { value: 'reviewed', label: '已复核', count: 'reviewedCount' },
  { value: 'matched', label: '已匹配', count: 'matchedCount' },
];
const provider = ref('');
const file = shallowRef(null);
const fileInput = ref(null);
const completePeriod = ref(false);
const fromDay = ref('');
const throughDay = ref('');
const importing = ref(false);
const importError = ref('');
const importNotice = ref('');
const archive = ref([]);
const archivePage = ref(1);
const archiveTotal = ref(0);
const historyLoading = ref(true);
const historyError = ref('');
const selectedId = ref('');
const detailHeading = ref(null);
const detailLoading = ref(false);
const detailError = ref('');
const result = ref(null);
const state = ref('');
const selectedRow = shallowRef(null);
const exporting = ref(false);
const exportError = ref('');
const detailPages = computed(() => Math.max(1, Math.ceil((result.value?.total || 0) / 20)));
let archiveRequest, detailRequest, importRequest, exportRequest;

function downloadTemplate() {
  downloadOrderCsv('QGauss-商户账单模板', [importColumns]);
}

function selectFile(event) {
  file.value = event.target.files?.[0] ?? null;
  importError.value = '';
  importNotice.value = '';
}

async function importFile() {
  if (importing.value) return;
  if (!file.value || !/\.csv$/i.test(file.value.name) || file.value.size > 1024 * 1024) {
    importError.value = '请选择不超过 1 MB 的 CSV 文件。';
    return;
  }
  const request = new AbortController();
  importRequest = request;
  importing.value = true;
  importError.value = '';
  importNotice.value = '';
  const fields = {
    provider: provider.value,
    ...(completePeriod.value ? { fromDay: fromDay.value, throughDay: throughDay.value } : {}),
  };
  try {
    const saved = await uploadPaymentStatement(file.value, fields, { signal: request.signal });
    if (request.signal.aborted) return;
    importNotice.value = saved.reused ? '相同账单已导入，已打开原核对结果。' : '已导入 ' + whole(saved.importedCount) + ' 笔渠道记录。';
    file.value = null;
    fileInput.value.value = '';
    void openStatement(saved.id, true);
    void loadArchive(1);
  } catch (error) {
    if (!request.signal.aborted) importError.value = error.message || '账单导入失败';
  } finally {
    if (importRequest === request) importing.value = false;
  }
}

async function loadArchive(target = 1) {
  archiveRequest?.abort();
  const request = new AbortController();
  archiveRequest = request;
  historyLoading.value = true;
  historyError.value = '';
  try {
    const data = await api.get(endpoint + '?page=' + target + '&pageSize=' + archiveSize, { signal: request.signal });
    if (request.signal.aborted) return;
    archive.value = data.items;
    archivePage.value = data.page;
    archiveTotal.value = data.total;
    if (!selectedId.value && data.items[0]) void openStatement(data.items[0].id);
  } catch (error) {
    if (!request.signal.aborted) historyError.value = error.message || '账单档案加载失败';
  } finally {
    if (archiveRequest === request) historyLoading.value = false;
  }
}

async function openStatement(id, focus = false) {
  if (id !== selectedId.value) {
    result.value = null;
    state.value = '';
  }
  selectedId.value = id;
  await loadDetail(1);
  if (focus && selectedId.value === id) {
    await nextTick();
    detailHeading.value?.focus();
  }
}

async function loadDetail(target = 1) {
  if (!selectedId.value) return;
  detailRequest?.abort();
  const request = new AbortController();
  detailRequest = request;
  detailLoading.value = true;
  detailError.value = '';
  exportError.value = '';
  const query = new URLSearchParams({ page: String(target), state: state.value });
  try {
    const data = await api.get(endpoint + '/' + encodeURIComponent(selectedId.value) + '?' + query, { signal: request.signal });
    if (request.signal.aborted) return;
    const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (target > lastPage) return loadDetail(lastPage);
    result.value = data;
  } catch (error) {
    if (!request.signal.aborted) {
      detailError.value = error.message || '核对结果加载失败';
      result.value = null;
    }
  } finally {
    if (detailRequest === request) detailLoading.value = false;
  }
}

function selectState(filter) {
  state.value = filter;
  void loadDetail(1);
}

function refreshAfterReview() {
  selectedRow.value = null;
  void loadDetail(result.value?.page);
  void loadArchive(archivePage.value);
}

async function exportResult() {
  if (exporting.value) return;
  const request = new AbortController();
  exportRequest = request;
  exporting.value = true;
  exportError.value = '';
  const id = selectedId.value;
  const filter = state.value;
  try {
    const data = await api.get(endpoint + '/' + encodeURIComponent(id) + '/export?state=' + encodeURIComponent(filter), { signal: request.signal });
    if (request.signal.aborted || selectedId.value !== id || state.value !== filter) return;
    const headers = [...importColumns, '站内订单号', '站内订单金额（分）', '差异', '复核状态', '最新复核说明', '复核人编号', '最新复核时间'];
    const rows = data.items.map(row => [
      rowType(row.kind), row.eventRef, row.orderRef, row.tradeRef, orderDate(row.occurredAt), row.amountCents, row.feeCents,
      row.localOrderId, row.localAmountCents, row.findings.join('；'), stateName(row.state), row.decisions[0]?.note, row.decisions[0]?.actorId,
      row.decisions[0] ? orderDate(row.decisions[0].createdAt) : '',
    ]);
    downloadOrderCsv('QGauss-商户账单核对-' + id.slice(-8), [headers, ...rows]);
  } catch (error) {
    if (!request.signal.aborted) exportError.value = error.message || '导出核对结果失败';
  } finally {
    if (exportRequest === request) exporting.value = false;
  }
}

onMounted(loadArchive);
onBeforeUnmount(() => {
  for (const request of [archiveRequest, detailRequest, importRequest, exportRequest]) request?.abort();
});
</script>
