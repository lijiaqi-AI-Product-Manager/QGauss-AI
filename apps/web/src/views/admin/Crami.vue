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
      <el-row :gutter="12" class="qg-stats">
        <el-col :xs="12" :sm="6">
          <el-card shadow="never"><div class="qg-lbl">未使用</div><div class="qg-val">{{ stats.unused }}</div></el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never"><div class="qg-lbl">已使用</div><div class="qg-val">{{ stats.used }}</div></el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never"><div class="qg-lbl">已作废</div><div class="qg-val">{{ stats.voided }}</div></el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never"><div class="qg-lbl">总数</div><div class="qg-val">{{ stats.total }}</div></el-card>
        </el-col>
      </el-row>

      <el-tabs v-model="tab">
        <el-tab-pane label="套餐" name="package">
          <div class="qg-row">
            <el-button type="primary" @click="openCreate">新建套餐</el-button>
            <el-button @click="loadPackages">刷新</el-button>
          </div>
          <el-table :data="packages" size="small" empty-text="还没有套餐">
            <el-table-column prop="name" label="名称" min-width="140" />
            <el-table-column label="价格（元）" width="110">
              <template #default="{ row }">{{ row.priceYuan }}</template>
            </el-table-column>
            <el-table-column prop="days" label="会员天数" width="100" />
            <el-table-column label="次数（低/高/图/智能体）" width="190">
              <template #default="{ row }">
                {{ row.model3Count }} / {{ row.model4Count }} / {{ row.drawMjCount }} / {{ row.agentCount }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
                  {{ row.status === 1 ? '上架' : '下架' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="sort" label="排序" width="80" />
            <el-table-column label="操作" width="200">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button link type="danger" @click="removePackage(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="卡密" name="crami">
          <div class="qg-row">
            <el-select v-model="genForm.packageId" placeholder="选择套餐" style="width: 200px">
              <el-option v-for="p in packages" :key="p.id" :value="p.id" :label="p.name" />
            </el-select>
            <el-input-number v-model="genForm.count" :min="1" :max="500" />
            <el-select v-model="genForm.cramiType" style="width: 170px">
              <el-option :value="1" label="一码一用" />
              <el-option :value="2" label="每人限用一次" />
            </el-select>
            <el-button type="primary" :loading="generating" @click="generate">生成卡密</el-button>
          </div>

          <div class="qg-row">
            <el-select v-model="filter.packageId" clearable placeholder="按套餐筛选" style="width: 200px">
              <el-option v-for="p in packages" :key="p.id" :value="p.id" :label="p.name" />
            </el-select>
            <el-select v-model="filter.status" clearable placeholder="按状态筛选" style="width: 160px">
              <el-option :value="0" label="未使用" />
              <el-option :value="1" label="已使用" />
              <el-option :value="2" label="已作废" />
            </el-select>
            <el-button @click="loadCramis">查询</el-button>
          </div>

          <el-table :data="cramis" size="small" empty-text="没有符合条件的卡密">
            <el-table-column prop="codeDisplay" label="卡密" width="190" />
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                {{ row.cramiType === 1 ? '一码一用' : '每人限用一次' }}
              </template>
            </el-table-column>
            <el-table-column label="面值" width="200">
              <template #default="{ row }">{{ faceText(row) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" width="180">
              <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button v-if="row.status === 0" link type="danger" @click="voidCrami(row)">
                  作废
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>

      <el-dialog v-model="dialog" :title="editing ? '编辑套餐' : '新建套餐'" width="560px">
        <el-form label-width="110px">
          <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="价格（元）"><el-input v-model="form.priceYuan" placeholder="如 19.90" /></el-form-item>
          <el-form-item label="会员天数">
            <el-input-number v-model="form.days" :min="-1" />
            <span class="qg-tip">-1 表示永久</span>
          </el-form-item>
          <el-form-item label="低价次数"><el-input-number v-model="form.model3Count" :min="0" /></el-form-item>
          <el-form-item label="高价次数"><el-input-number v-model="form.model4Count" :min="0" /></el-form-item>
          <el-form-item label="绘图次数"><el-input-number v-model="form.drawMjCount" :min="0" /></el-form-item>
          <el-form-item label="智能体次数"><el-input-number v-model="form.agentCount" :min="0" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
          <el-form-item label="上架"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialog = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElAlert, ElButton, ElCard, ElCol, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElRow, ElSelect, ElSwitch, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag } from 'element-plus';
import { api } from '../../api/client.js';

const disabled = ref(false);
const tab = ref('package');
const stats = reactive({ unused: 0, used: 0, voided: 0, total: 0 });
const packages = ref([]);
const cramis = ref([]);
const dialog = ref(false);
const editing = ref(null);
const saving = ref(false);
const generating = ref(false);
const genForm = reactive({ packageId: '', count: 10, cramiType: 1 });
const filter = reactive({ packageId: '', status: '' });
const form = reactive({
  name: '',
  priceYuan: '',
  days: 0,
  model3Count: 0,
  model4Count: 0,
  drawMjCount: 0,
  agentCount: 0,
  sort: 100,
  status: 1,
});

function fail(e) {
  if (e?.status === 404) {
    disabled.value = true;
    return;
  }
  ElMessage.error(e?.message || '操作失败');
}

function fmt(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusText(s) {
  return s === 0 ? '未使用' : s === 1 ? '已使用' : '已作废';
}
function statusType(s) {
  return s === 0 ? 'success' : s === 1 ? 'warning' : 'info';
}
function faceText(row) {
  const parts = [];
  if (row.days) parts.push(`${row.days} 天`);
  if (row.model3Count) parts.push(`低 ${row.model3Count}`);
  if (row.model4Count) parts.push(`高 ${row.model4Count}`);
  if (row.drawMjCount) parts.push(`图 ${row.drawMjCount}`);
  if (row.agentCount) parts.push(`智能体 ${row.agentCount}`);
  return parts.join('，') || '—';
}

async function loadStats() {
  try {
    Object.assign(stats, await api.get('/crami/stats'));
  } catch (e) {
    fail(e);
  }
}

async function loadPackages() {
  try {
    const res = await api.get('/crami/package/list?pageSize=100');
    packages.value = res?.items ?? [];
  } catch (e) {
    fail(e);
  }
}

async function loadCramis() {
  try {
    const qs = new URLSearchParams({ pageSize: 50 });
    if (filter.packageId) qs.set('packageId', filter.packageId);
    if (filter.status !== '' && filter.status !== null) qs.set('status', String(filter.status));
    const res = await api.get(`/crami/list?${qs.toString()}`);
    cramis.value = res?.items ?? [];
  } catch (e) {
    fail(e);
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    name: '',
    priceYuan: '',
    days: 0,
    model3Count: 0,
    model4Count: 0,
    drawMjCount: 0,
    agentCount: 0,
    sort: 100,
    status: 1,
  });
  dialog.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    priceYuan: row.priceYuan,
    days: row.days,
    model3Count: row.model3Count,
    model4Count: row.model4Count,
    drawMjCount: row.drawMjCount,
    agentCount: row.agentCount,
    sort: row.sort,
    status: row.status,
  });
  dialog.value = true;
}

async function save() {
  if (!String(form.name || '').trim()) {
    ElMessage.warning('请填写套餐名称');
    return;
  }
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(String(form.priceYuan).trim())) {
    ElMessage.warning('价格格式不正确（最多两位小数）');
    return;
  }
  const payload = {
    name: String(form.name).trim(),
    priceYuan: String(form.priceYuan).trim(),
    days: form.days,
    model3Count: form.model3Count,
    model4Count: form.model4Count,
    drawMjCount: form.drawMjCount,
    agentCount: form.agentCount,
    sort: form.sort,
    status: form.status,
  };
  saving.value = true;
  try {
    if (editing.value) await api.patch(`/crami/package/${editing.value.id}`, payload);
    else await api.post('/crami/package/create', payload);
    ElMessage.success('已保存');
    dialog.value = false;
    await loadPackages();
  } catch (e) {
    fail(e);
  } finally {
    saving.value = false;
  }
}

async function removePackage(row) {
  try {
    await ElMessageBox.confirm(`删除套餐「${row.name}」？已发出的卡密不受影响。`, '确认', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await api.del(`/crami/package/${row.id}`);
    ElMessage.success('已删除');
    await Promise.all([loadPackages(), loadStats()]);
  } catch (e) {
    fail(e);
  }
}

async function generate() {
  if (!genForm.packageId) {
    ElMessage.warning('请先选择套餐');
    return;
  }
  generating.value = true;
  try {
    const res = await api.post('/crami/create', {
      packageId: genForm.packageId,
      count: genForm.count,
      cramiType: genForm.cramiType,
    });
    ElMessage.success(`已生成 ${res?.created ?? 0} 张卡密`);
    await Promise.all([loadCramis(), loadStats()]);
  } catch (e) {
    fail(e);
  } finally {
    generating.value = false;
  }
}

async function voidCrami(row) {
  try {
    await ElMessageBox.confirm(`作废卡密 ${row.codeDisplay}？作废后不可恢复。`, '确认', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await api.del(`/crami/${row.id}`);
    ElMessage.success('已作废');
    await Promise.all([loadCramis(), loadStats()]);
  } catch (e) {
    fail(e);
  }
}

onMounted(async () => {
  await Promise.all([loadPackages(), loadCramis(), loadStats()]);
});
</script>

<style scoped>
.qg-page {
  padding: 16px;
}
.qg-stats {
  margin-bottom: 8px;
}
.qg-lbl {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.qg-val {
  font-size: 22px;
  font-weight: 700;
  margin-top: 4px;
}
.qg-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin: 12px 0;
}
.qg-tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
