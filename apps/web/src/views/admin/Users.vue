<template>
  <div style="padding: 20px; height: 100%; overflow: auto">
    <el-card shadow="never">
      <template #header>
        <div style="display: flex; gap: 8px; align-items: center">
          <span>用户</span>
          <span style="flex: 1"></span>
          <el-input v-model="keyword" placeholder="搜索邮箱/用户名" size="small" style="width: 220px" clearable @keyup.enter="search" />
          <el-button size="small" @click="search">搜索</el-button>
        </div>
      </template>

      <el-table :data="rows" size="small">
        <el-table-column prop="username" label="用户名" min-width="130" />
        <el-table-column prop="email" label="邮箱" min-width="200" />
        <el-table-column prop="displayName" label="昵称" min-width="120" />
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.role === 'ADMIN' ? 'warning' : 'info'">{{ row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'ACTIVE' ? 'success' : 'danger'">
              {{ row.status === 'ACTIVE' ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190">
          <template #default="{ row }">
            <el-button link size="small" @click="toggle(row)">
              {{ row.status === 'ACTIVE' ? '禁用' : '恢复' }}
            </el-button>
            <el-button link size="small" type="primary" @click="openGrant(row)">发放</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 12px; text-align: right">
        <el-pagination
          layout="prev, pager, next"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="onPage"
        />
      </div>
    </el-card>

    <el-dialog v-model="grantVisible" title="发放次数 / 余额 / 会员" width="480">
      <el-form label-width="110">
        <el-form-item label="用户">
          <el-input :model-value="grantUser?.username ?? ''" disabled />
        </el-form-item>
        <el-form-item label="低价次数">
          <el-input-number v-model="grantForm.model3Count" :min="0" />
        </el-form-item>
        <el-form-item label="高价次数">
          <el-input-number v-model="grantForm.model4Count" :min="0" />
        </el-form-item>
        <el-form-item label="绘图次数">
          <el-input-number v-model="grantForm.drawMjCount" :min="0" />
        </el-form-item>
        <el-form-item label="智能体次数">
          <el-input-number v-model="grantForm.agentCount" :min="0" />
        </el-form-item>
        <el-form-item label="会员天数">
          <el-input-number v-model="grantForm.days" :min="-1" />
          <span style="margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary)">
            -1 表示永久
          </span>
        </el-form-item>
        <el-form-item label="余额（元）">
          <el-input v-model="grantForm.amountYuan" placeholder="如 10.00；留空则不充" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="grantForm.remark" placeholder="选填，会写进发放流水" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="grantVisible = false">取消</el-button>
        <el-button type="primary" :loading="granting" @click="doGrant">确认发放</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElPagination, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { api } from '../../api/client.js';

const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const keyword = ref('');
const grantVisible = ref(false);
const granting = ref(false);
const grantUser = ref(null);
const grantForm = reactive({
  model3Count: 0,
  model4Count: 0,
  drawMjCount: 0,
  agentCount: 0,
  days: 0,
  amountYuan: '',
  remark: '',
});

async function load() {
  const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
  if (keyword.value) query.set('keyword', keyword.value);
  const data = await api.get(`/users?${query}`);
  rows.value = data.items;
  total.value = data.total;
}

function onPage(p) {
  page.value = p;
  load();
}

/** 换关键词后回到第一页，否则会在新结果里停在旧页码上 */
function search() {
  page.value = 1;
  load();
}

async function toggle(row) {
  const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  await ElMessageBox.confirm(
    next === 'DISABLED' ? `禁用「${row.username}」后其登录状态会立即失效，继续？` : `恢复「${row.username}」？`,
    '提示',
    { type: 'warning' },
  );
  await api.patch(`/users/${row.id}/status`, { status: next });
  ElMessage.success('已更新');
  await load();
}

function openGrant(row) {
  grantUser.value = row;
  Object.assign(grantForm, {
    model3Count: 0,
    model4Count: 0,
    drawMjCount: 0,
    agentCount: 0,
    days: 0,
    amountYuan: '',
    remark: '',
  });
  grantVisible.value = true;
}

async function doGrant() {
  const user = grantUser.value;
  if (!user) return;
  const amount = String(grantForm.amountYuan || '').trim();
  if (amount && !/^\d{1,7}(\.\d{1,2})?$/.test(amount)) {
    ElMessage.warning('余额格式不正确（最多两位小数）');
    return;
  }
  const payload = {
    userId: user.id,
    model3Count: grantForm.model3Count,
    model4Count: grantForm.model4Count,
    drawMjCount: grantForm.drawMjCount,
    agentCount: grantForm.agentCount,
    days: grantForm.days,
    ...(amount ? { amountYuan: amount } : {}),
    ...(grantForm.remark ? { remark: grantForm.remark } : {}),
  };
  const empty =
    !payload.model3Count && !payload.model4Count && !payload.drawMjCount &&
    !payload.agentCount && !payload.days && !amount;
  if (empty) {
    ElMessage.warning('至少填写一项发放内容');
    return;
  }
  granting.value = true;
  try {
    await api.post('/balance/upgradeBalance', payload);
    ElMessage.success('已发放');
    grantVisible.value = false;
  } catch (e) {
    if (e?.status === 404) ElMessage.warning('商业化未开启，无法发放额度');
    else ElMessage.error(e?.message || '发放失败');
  } finally {
    granting.value = false;
  }
}

onMounted(load);
</script>
