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
      <el-tabs v-model="tab">
        <el-tab-pane label="提现审核" name="audit">
          <div class="qg-row">
            <el-select v-model="orderStatus" clearable placeholder="全部状态" style="width: 150px">
              <el-option :value="0" label="待审核" />
              <el-option :value="1" label="已通过" />
              <el-option :value="2" label="已驳回" />
            </el-select>
            <el-button @click="loadAudits">刷新</el-button>
          </div>

          <el-table :data="audits" size="small" empty-text="没有提现申请">
            <el-table-column prop="username" label="用户" width="140" />
            <el-table-column prop="amountYuan" label="金额（元）" width="110" />
            <el-table-column label="收款方式" width="110">
              <template #default="{ row }">{{ channelText(row.channels) }}</template>
            </el-table-column>
            <el-table-column prop="contact" label="收款账号" min-width="150" />
            <el-table-column prop="statusText" label="状态" width="100" />
            <el-table-column label="申请时间" width="170">
              <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <template v-if="row.orderStatus === 0">
                  <el-button link type="success" @click="decide(row, true)">通过</el-button>
                  <el-button link type="danger" @click="decide(row, false)">驳回</el-button>
                </template>
                <el-button v-else-if="row.orderStatus === 1 && row.paymentStatus === 0" link type="success" @click="decide(row, true)">登记已打款</el-button>
                <span v-else class="qg-dim">{{ row.orderStatus === 1 ? '已登记打款' : '已处理' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="分销员" name="sales">
          <div class="qg-row">
            <el-input
              v-model="keyword"
              placeholder="用户名 / 邮箱 / 网点名"
              style="width: 240px"
              @keyup.enter="loadSales"
            />
            <el-button @click="loadSales">搜索</el-button>
          </div>

          <el-table :data="sales" size="small" empty-text="还没有分销员">
            <el-table-column prop="username" label="用户" width="140" />
            <el-table-column prop="email" label="邮箱" min-width="180" />
            <el-table-column prop="inviteCode" label="邀请码" width="120" />
            <el-table-column label="可提现（元）" width="120">
              <template #default="{ row }">{{ row.distributionYuan }}</template>
            </el-table-column>
            <el-table-column label="累计佣金（元）" width="130">
              <template #default="{ row }">{{ row.totalYuan }}</template>
            </el-table-column>
            <el-table-column label="佣金比例" width="200">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.performanceBps"
                  :min="0"
                  :max="10000"
                  :step="100"
                  size="small"
                  controls-position="right"
                />
                <span class="qg-dim"> = {{ (row.performanceBps / 100).toFixed(1) }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="90">
              <template #default="{ row }">
                <el-switch v-model="row.enabled" @change="toggle(row)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button link type="primary" @click="saveBps(row)">保存比例</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="qg-dim qg-tip">佣金比例为万分比：1000 = 10%。保存后即时生效，只影响之后的订单。</div>
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect, ElSwitch, ElTabPane, ElTable, ElTableColumn, ElTabs } from 'element-plus';
import { api } from '../../api/client.js';

const disabled = ref(false);
const tab = ref('audit');
const audits = ref([]);
const sales = ref([]);
const orderStatus = ref('');
const keyword = ref('');

function fail(e) {
  if (e?.status === 404) {
    disabled.value = true;
    return;
  }
  ElMessage.error(e?.message || '操作失败');
}

function fmt(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function channelText(c) {
  return c === 1 ? '支付宝' : c === 2 ? '微信' : c === 3 ? '银行卡' : '—';
}

async function loadAudits() {
  try {
    const qs = new URLSearchParams({ pageSize: '50' });
    if (orderStatus.value !== '' && orderStatus.value !== null) {
      qs.set('orderStatus', String(orderStatus.value));
    }
    const res = await api.get(`/sales/audit?${qs.toString()}`);
    audits.value = res?.items ?? [];
  } catch (e) {
    fail(e);
  }
}

async function loadSales() {
  try {
    const qs = new URLSearchParams({ pageSize: '50' });
    if (String(keyword.value || '').trim()) qs.set('keyword', String(keyword.value).trim());
    const res = await api.get(`/sales/manage?${qs.toString()}`);
    sales.value = res?.items ?? [];
  } catch (e) {
    fail(e);
  }
}

async function decide(row, pass) {
  const label = pass ? row.orderStatus === 1 ? '登记已打款' : '通过' : '驳回';
  try {
    await ElMessageBox.confirm(
      pass
        ? `确认已向「${row.username}」打款 ${row.amountYuan} 元？通过后金额不再退回。`
        : `驳回后将把 ${row.amountYuan} 元退回其可提现余额，确认？`,
      `${label}提现申请`,
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await api.post(`/sales/audit/${row.id}`, { pass, ...(pass ? { paymentStatus: 1 } : {}) });
    ElMessage.success(`已${label}`);
    await loadAudits();
  } catch (e) {
    fail(e);
  }
}

async function toggle(row) {
  try {
    await api.patch(`/sales/manage/${row.userId}`, { enabled: row.enabled });
    ElMessage.success(row.enabled ? '已启用' : '已停用');
  } catch (e) {
    row.enabled = !row.enabled; // 回滚开关，避免界面与服务端不一致
    fail(e);
  }
}

async function saveBps(row) {
  try {
    await api.patch(`/sales/manage/${row.userId}`, { performanceBps: row.performanceBps });
    ElMessage.success('佣金比例已保存');
  } catch (e) {
    fail(e);
  }
}

onMounted(async () => {
  await Promise.all([loadAudits(), loadSales()]);
});
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
.qg-dim {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.qg-tip {
  margin-top: 8px;
}
</style>
