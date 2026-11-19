<template>
  <section class="qor-board qst-import" aria-labelledby="statement-import-heading">
    <div class="qor-board-heading">
      <h2 id="statement-import-heading">导入账单</h2>
      <button class="qor-button" type="button" @click="downloadTemplate"><ClientIcon name="download" />下载模板</button>
    </div>
    <form class="qst-form" @submit.prevent="submit">
      <fieldset class="qst-fields" :disabled="Boolean(busy)">
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
          <input ref="fileInput" type="file" accept=".csv,text/csv" required aria-describedby="statement-file-hint" @change="selectFile" />
          <small id="statement-file-hint">原始 CSV 或标准模板，最多 3000 条，1 MB</small>
        </label>

        <template v-if="format === 'standard'">
          <label class="qst-checkbox">
            <input v-model="completePeriod" type="checkbox" />按完整账期核对缺行
          </label>
          <div v-if="completePeriod" class="qst-dates">
            <label>开始日期<input v-model="fromDay" type="date" required :max="throughDay || undefined" /></label>
            <label>结束日期<input v-model="throughDay" type="date" required :min="fromDay || undefined" /></label>
            <small>按北京时间计算，最多 31 天。</small>
          </div>
        </template>

        <section v-if="format === 'columns'" class="qst-mapping" aria-labelledby="statement-mapping-heading">
          <h3 id="statement-mapping-heading" ref="mappingHeading" tabindex="-1">对应账单字段</h3>
          <p>订单号与网关交易号至少选一项。退款请使用独立退款流水号。</p>
          <div class="qst-map-grid">
            <label>
              记录类型
              <select v-model="mapping.rowKind" required>
                <option value="" disabled>请选择</option>
                <option value="payment">全是收款</option>
                <option value="refund">全是退款</option>
                <option value="column">按文件中的列</option>
              </select>
            </label>
            <label>
              金额与手续费单位
              <select v-model="mapping.unit" required>
                <option value="" disabled>请选择</option>
                <option value="yuan">人民币元</option>
                <option value="cents">人民币分</option>
              </select>
            </label>
            <label v-for="field in visibleMappingFields" :key="field.key">
              {{ field.label }}
              <select v-model="mapping[field.key]" :required="field.required">
                <option value=""> {{ field.required ? '请选择列' : '留空' }}</option>
                <option v-for="(column, index) in columns" :key="index" :value="index">{{ index + 1 }} · {{ column || '无标题' }}</option>
              </select>
            </label>
          </div>
          <p>时间按北京时间填写，例如 2026-06-13 09:30:00。</p>
        </section>
      </fieldset>

      <section v-if="preview && !preview.mappingRequired" class="qst-preview" aria-labelledby="statement-preview-heading">
        <div class="qst-preview-title">
          <span class="qor-card-icon"><ClientIcon :name="preview.previewToken ? 'check' : 'info'" /></span>
          <div>
            <h3 id="statement-preview-heading" ref="previewHeading" tabindex="-1">导入预览</h3>
            <p>{{ formatLabels[format] }} · {{ completePeriod ? '完整账期' : '逐笔核对' }}</p>
          </div>
        </div>
        <dl v-if="!preview.issueCount" class="qst-preview-totals">
          <div><dt>收款 · {{ whole(preview.totals.paymentCount) }} 笔</dt><dd>{{ currency(preview.totals.paymentCents) }}</dd></div>
          <div><dt>退款 · {{ whole(preview.totals.refundCount) }} 笔</dt><dd>{{ currency(preview.totals.refundCents) }}</dd></div>
        </dl>
        <p v-if="!preview.issueCount && preview.examples.length" class="qst-preview-fee">
          手续费合计 <strong>{{ preview.totals.feeCents === null ? '有记录未提供' : currency(preview.totals.feeCents) }}</strong>
        </p>
        <p v-if="excludedCount" class="qst-exclusions">
          已排除 {{ whole(excludedCount) }} 笔：撤销 {{ whole(preview.excluded.revoked) }} 笔，退款未成功 {{ whole(preview.excluded.unfinishedRefunds) }} 笔。
        </p>
        <p v-if="!preview.previewToken && !preview.issueCount" class="qst-exclusions">此文件没有可导入的记录。</p>
        <div v-if="preview.issueCount" class="qst-preview-issues" role="alert">
          <strong>{{ whole(preview.issueCount) }} 处需要修正</strong>
          <ul>
            <li v-for="issue in preview.issues" :key="issue.line || issue.message">
              <strong v-if="issue.line">第 {{ issue.line }} 行</strong> {{ issue.message }}
            </li>
          </ul>
          <p v-if="preview.issueCount > preview.issues.length">已显示前 {{ preview.issues.length }} 处。</p>
        </div>
        <ul v-else-if="preview.examples.length" class="qst-preview-examples" aria-label="前六笔记录" role="list">
          <li v-for="entry in preview.examples" :key="entry.sourceLine">
            <span>
              <strong>{{ rowType(entry.kind) }} · {{ currency(entry.amountCents) }}</strong>
              <small>第 {{ entry.sourceLine }} 行 · {{ orderDate(entry.occurredAt) }}</small>
            </span>
            <code :title="entry.orderRef || entry.tradeRef">{{ entry.orderRef || entry.tradeRef }}</code>
          </li>
        </ul>
      </section>

      <button class="qor-button qor-button--primary" type="submit" :disabled="Boolean(busy)">
        <ClientIcon :class="{ 'qst-spin': busy }" :name="busy ? 'refresh' : preview?.previewToken ? 'check' : 'file'" />
        {{ actionLabel }}
      </button>
      <p v-if="error" class="qst-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="qst-notice" role="status">{{ notice }}</p>
    </form>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { previewPaymentStatement, uploadPaymentStatement } from '../../api/client.js';
import ClientIcon from '../reference/ClientIcon.vue';
import { currency, downloadOrderCsv, orderDate, platformLabel, whole } from './order-review-format.js';
import { importColumns, rowType } from './payment-statement-format.js';

const emit = defineEmits(['imported']);
const formatLabels = { standard: 'QGauss 标准模板', wechat: '微信支付交易账单', columns: '自定义列' };
const mappingFields = [
  { key: 'kind', label: '类型所在列', required: true },
  { key: 'eventRef', label: '渠道流水号', required: true },
  { key: 'orderRef', label: '商户订单号' },
  { key: 'tradeRef', label: '网关交易号' },
  { key: 'occurredAt', label: '发生时间', required: true },
  { key: 'amount', label: '交易金额', required: true },
  { key: 'fee', label: '手续费' },
  { key: 'currency', label: '币种' },
];
const provider = ref('');
const file = shallowRef(null);
const fileInput = ref(null);
const completePeriod = ref(false);
const fromDay = ref('');
const throughDay = ref('');
const format = ref('');
const columns = ref([]);
const mapping = ref({ rowKind: '', unit: '' });
const preview = shallowRef(null);
const busy = ref('');
const error = ref('');
const notice = ref('');
const mappingHeading = ref(null);
const previewHeading = ref(null);
let request;

const visibleMappingFields = computed(() => mappingFields.filter(field => field.key !== 'kind' || mapping.value.rowKind === 'column'));
const excludedCount = computed(() => (preview.value?.excluded.revoked || 0) + (preview.value?.excluded.unfinishedRefunds || 0));
const actionLabel = computed(() => {
  if (busy.value === 'import') return '正在核对…';
  if (busy.value === 'preview') return '正在读取…';
  if (preview.value?.previewToken) return '确认导入并核对';
  return format.value ? '更新预览' : '预览账单';
});

watch([provider, completePeriod, fromDay, throughDay, mapping], () => {
  preview.value = null;
  error.value = '';
  notice.value = '';
}, { deep: true, flush: 'sync' });

function selectFile(event) {
  file.value = event.target.files?.[0] ?? null;
  format.value = '';
  columns.value = [];
  mapping.value = { rowKind: '', unit: '' };
  completePeriod.value = false;
  fromDay.value = '';
  throughDay.value = '';
  preview.value = null;
  error.value = '';
  notice.value = '';
}

function downloadTemplate() {
  downloadOrderCsv('QGauss-商户账单导入模板', [importColumns]);
}

async function submit() {
  if (busy.value) return;
  if (!file.value || !/\.csv$/i.test(file.value.name) || file.value.size === 0 || file.value.size > 1024 * 1024) {
    error.value = '请选择不超过 1 MB 的 CSV 文件。';
    return;
  }
  const fields = { provider: provider.value };
  if (completePeriod.value) Object.assign(fields, { fromDay: fromDay.value, throughDay: throughDay.value });
  if (format.value === 'columns') {
    const settings = Object.fromEntries(Object.entries(mapping.value).filter(([, value]) => value !== ''));
    if (settings.orderRef === undefined && settings.tradeRef === undefined) {
      error.value = '请选择商户订单号或网关交易号所在列。';
      return;
    }
    fields.columns = JSON.stringify(settings);
  }
  const previewToken = preview.value?.previewToken;
  request = new AbortController();
  const { signal } = request;
  busy.value = previewToken ? 'import' : 'preview';
  error.value = '';
  notice.value = '';
  try {
    if (previewToken) {
      const saved = await uploadPaymentStatement(file.value, { ...fields, previewToken }, { signal });
      if (signal.aborted) return;
      fileInput.value.value = '';
      selectFile({ target: fileInput.value });
      notice.value = saved.reused ? '相同账单已导入，已打开原核对结果。' : '已导入 ' + whole(saved.importedCount) + ' 笔渠道记录。';
      emit('imported', saved);
      return;
    }
    const inspected = await previewPaymentStatement(file.value, fields, { signal });
    if (signal.aborted) return;
    format.value = inspected.format;
    columns.value = inspected.columns;
    if (inspected.mappingRequired) mapping.value = { rowKind: '', unit: '', ...inspected.suggested };
    preview.value = inspected;
    await nextTick();
    if (!signal.aborted) (inspected.mappingRequired ? mappingHeading.value : previewHeading.value)?.focus();
  } catch (failure) {
    if (signal.aborted) return;
    if (failure.status === 409) preview.value = null;
    error.value = failure.message || '账单处理失败，请重试。';
  } finally {
    busy.value = '';
  }
}

onBeforeUnmount(() => request?.abort());
</script>
