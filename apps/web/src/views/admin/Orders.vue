<template>
  <div class="qg-page">
    <el-alert
      v-if="disabled"
      type="info"
      show-icon
      :closable="false"
      title="本站未开启商业化"
      description="需要先在系统配置里打开 commerce.enabled。"
    />

    <template v-else>
      <div class="qg-row">
        <el-select v-model="status" clearable placeholder="全部状态" style="width: 160px">
          <el-option :value="0" label="未支付" />
          <el-option :value="1" label="已支付" />
          <el-option :value="2" label="支付失败" />
          <el-option :value="3" label="已关闭" />
          <el-option :value="4" label="已退款" />
        </el-select>
        <el-input
          v-model="keyword"
          placeholder="订单号 / 交易号"
          style="width: 260px"
          @keyup.enter="reload"
        />
        <el-button type="primary" @click="reload">查询</el-button>
      </div>

      <el-table :data="items" size="small" empty-text="没有订单">
        <el-table-column label="订单号" width="230">
          <template #default="{ row }">
            <el-tooltip :content="row.orderId" placement="top">
              <span class="qg-mono">{{ row.orderId.slice(0, 12) }}…</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="goodsName" label="商品" min-width="150" />
        <el-table-column prop="count" label="数量" width="70" />
        <el-table-column label="金额（元）" width="110">
          <template #default="{ row }">{{ row.totalYuan }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="payPlatform" label="通道" width="100" />
        <el-table-column label="下单时间" width="170">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="支付时间" width="170">
          <template #default="{ row }">{{ fmt(row.paydAt) }}</template>
        </el-table-column>
      </el-table>

      <div class="qg-pager">
        <el-button :disabled="page <= 1" @click="prev">上一页</el-button>
        <span class="qg-pager-text">第 {{ page }} 页 · 共 {{ total }} 条</span>
        <el-button :disabled="page * pageSize >= total" @click="next">下一页</el-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElInput, ElMessage, ElOption, ElSelect, ElTable, ElTableColumn, ElTag, ElTooltip } from 'element-plus';
import { api } from '../../api/client.js';

const disabled = ref(false);
const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const status = ref('');
const keyword = ref('');

function fail(e) {
  if (e?.status === 404) {
    disabled.value = true;
    return;
  }
  ElMessage.error(e?.message || '加载失败');
}

function fmt(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusType(s) {
  return s === 1 ? 'success' : s === 0 ? 'warning' : 'info';
}

async function load() {
  try {
    const qs = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (status.value !== '' && status.value !== null) qs.set('status', String(status.value));
    if (String(keyword.value || '').trim()) qs.set('keyword', String(keyword.value).trim());
    const res = await api.get(`/order/manage?${qs.toString()}`);
    items.value = res?.items ?? [];
    total.value = res?.total ?? 0;
  } catch (e) {
    fail(e);
  }
}

function reload() {
  page.value = 1;
  load();
}
function prev() {
  if (page.value > 1) {
    page.value -= 1;
    load();
  }
}
function next() {
  page.value += 1;
  load();
}

onMounted(load);
</script>

<style scoped>
.qg-page {
  padding: 16px;
}
.qg-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.qg-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.qg-pager {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.qg-pager-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
