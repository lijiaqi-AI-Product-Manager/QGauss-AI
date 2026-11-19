<template>
  <Teleport to="body">
    <dialog ref="dialog" class="qor-dialog qst-dialog" aria-labelledby="statement-line-heading" @close="emit('close')" @cancel="onCancel">
      <header class="qor-dialog-header">
        <span class="qor-card-icon"><ClientIcon name="file" /></span>
        <div>
          <h2 id="statement-line-heading">账单记录</h2>
          <p>{{ rowType(entry.kind) }} · {{ stateName(entry.state) }} · {{ orderDate(entry.occurredAt) }}</p>
        </div>
        <button class="qor-button qor-icon-button" type="button" aria-label="关闭账单记录" :disabled="saving" autofocus @click="dialog.close()">
          <ClientIcon name="close" />
        </button>
      </header>

      <div class="qor-dialog-body">
        <section class="qor-review-state" :data-tone="entry.findings.length ? 'waiting' : 'paid'" aria-label="原核对结果">
          <ClientIcon :name="entry.findings.length ? 'info' : 'check'" />
          <div>
            <strong>{{ entry.findings.length ? '导入时的差异' : '订单与渠道记录一致' }}</strong>
            <ul v-if="entry.findings.length" class="qor-findings">
              <li v-for="finding in entry.findings" :key="finding">{{ finding }}</li>
            </ul>
          </div>
        </section>

        <dl class="qor-receipt-grid">
          <div><dt>渠道流水号</dt><dd class="qor-full-id">{{ entry.eventRef || '—' }}</dd></div>
          <div><dt>交易号</dt><dd class="qor-full-id">{{ entry.tradeRef || '—' }}</dd></div>
          <div><dt>账单订单号</dt><dd class="qor-full-id">{{ entry.orderRef || '—' }}</dd></div>
          <div><dt>关联站内订单</dt><dd class="qor-full-id">{{ entry.localOrderId || '—' }}</dd></div>
          <div><dt>渠道凭证金额</dt><dd>{{ money(entry.amountCents) }}</dd></div>
          <div><dt>导入时站内金额</dt><dd>{{ money(entry.localAmountCents) }}</dd></div>
          <div><dt>手续费</dt><dd>{{ money(entry.feeCents) }}</dd></div>
          <div><dt>账单所在行</dt><dd>{{ entry.sourceLine ?? '站内补充项' }}</dd></div>
        </dl>

        <section v-if="entry.decisions.length" class="qor-evidence" aria-labelledby="statement-decisions-heading">
          <h3 id="statement-decisions-heading"><ClientIcon name="check" />最近复核记录</h3>
          <div v-for="record in entry.decisions" :key="record.revision" class="qst-decision">
            <strong>{{ record.state === 'reviewed' ? '已登记复核' : '已重新打开' }}</strong>
            <span>{{ orderDate(record.createdAt) }} · <abbr :title="record.actorId">编号 {{ record.actorId.slice(-8) }}</abbr></span>
            <p>{{ record.note }}</p>
          </div>
        </section>

        <form v-if="entry.state !== 'matched'" id="statement-review-form" class="qst-form" @submit.prevent="save">
          <label>
            复核说明
            <textarea v-model.trim="note" rows="3" required maxlength="500"
              :placeholder="entry.state === 'reviewed' ? '填写重新打开的原因' : '填写复核结论与凭证线索'"></textarea>
          </label>
          <p v-if="error" class="qst-error" role="alert">{{ error }}</p>
        </form>
      </div>
      <footer v-if="entry.state !== 'matched'" class="qor-dialog-footer">
        <button class="qor-button qor-button--primary" type="submit" form="statement-review-form" :disabled="saving || stale">
          <ClientIcon :name="entry.state === 'reviewed' ? 'refresh' : 'check'" />
          {{ saving ? '正在保存…' : entry.state === 'reviewed' ? '重新打开' : '登记已复核' }}
        </button>
      </footer>
    </dialog>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api/client.js';
import ClientIcon from '../reference/ClientIcon.vue';
import { currency, orderDate } from './order-review-format.js';
import { rowType, stateName } from './payment-statement-format.js';

const props = defineProps({ statementId: { type: String, required: true }, entry: { type: Object, required: true } });
const emit = defineEmits(['close', 'saved', 'stale']);
const dialog = ref(null);
const note = ref('');
const saving = ref(false);
const stale = ref(false);
const error = ref('');
let request;

function money(value) {
  return value === null ? '—' : currency(value);
}

function onCancel(event) {
  if (saving.value) event.preventDefault();
}

async function save() {
  if (saving.value || stale.value) return;
  saving.value = true;
  error.value = '';
  request = new AbortController();
  const row = props.entry;
  const url = '/admin/payment-statements/' + encodeURIComponent(props.statementId) + '/rows/' + encodeURIComponent(row.id);
  try {
    await api.patch(url, { state: row.state === 'reviewed' ? 'open' : 'reviewed', revision: row.revision, note: note.value }, { signal: request.signal });
    if (!request.signal.aborted) emit('saved');
  } catch (failure) {
    if (!request.signal.aborted) {
      error.value = failure.message || '复核结论保存失败';
      if (failure.status === 409) {
        stale.value = true;
        emit('stale');
      }
    }
  } finally {
    saving.value = false;
  }
}

onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => request?.abort());
</script>
