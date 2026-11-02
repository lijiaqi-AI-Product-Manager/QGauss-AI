<template>
  <div style="padding: 20px; height: 100%; overflow: auto">
    <el-card shadow="never">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>渠道</span>
          <div>
            <el-button size="small" @click="resetBreakers">重置熔断</el-button>
            <el-button size="small" type="primary" @click="openCreate">新增渠道</el-button>
          </div>
        </div>
      </template>

      <el-table :data="rows" size="small" style="width: 100%">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="通信方式" min-width="180"><template #default="{ row }">{{ PROTOCOLS[row.type]?.label || row.type }}</template></el-table-column>
        <el-table-column prop="baseUrl" label="Base URL" min-width="220" show-overflow-tooltip />
        <el-table-column label="密钥" width="130">
          <template #default="{ row }">
            <span v-if="row.hasApiKey" style="font-family: monospace">{{ row.apiKeyMasked }}</span>
            <span v-else style="color: var(--qg-sub)">未设置</span>
          </template>
        </el-table-column>
        <el-table-column label="Key 池" width="110">
          <template #default="{ row }">
            <el-button link size="small" @click="openPool(row)">
              {{ row.poolKeys ? `${row.poolKeysEnabled} / ${row.poolKeys} 可用` : '添加' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="优先级/权重" width="120">
          <template #default="{ row }">{{ row.priority }} / {{ row.weight }}</template>
        </el-table-column>
        <el-table-column label="熔断" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="breakerType(row.breaker.state)">{{ row.breaker.state }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'ENABLED' ? 'success' : 'info'">
              {{ row.status === 'ENABLED' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="290" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" :loading="testing === row.id" @click="testOne(row)">测试</el-button>
            <el-button link size="small" @click="toggle(row)">
              {{ row.status === 'ENABLED' ? '停用' : '启用' }}
            </el-button>
            <el-button v-if="row.hasApiKey" link size="small" @click="clearKey(row)">清空密钥</el-button>
            <el-button link size="small" type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="visible" :title="editing ? '编辑渠道' : '新增渠道'" width="520">
      <el-form :model="form" label-width="110">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option v-for="t in TYPES" :key="t" :label="PROTOCOLS[t].label" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL">
          <el-input v-model="form.baseUrl" :placeholder="PROTOCOLS[form.type]?.base" />
        </el-form-item>
        <el-alert :title="PROTOCOLS[form.type]?.note" type="info" :closable="false" show-icon style="margin-bottom:16px" />
        <el-form-item v-if="form.type==='CUSTOM'" label="联网兼容"><label><input v-model="form.webSearchRetrieval" type="checkbox" /> 此网关明确支持 retrieval 联网</label><small class="qg-muted">仅在服务商明确支持该方式时开启；模型还需配置 web_search，保存不会发起测试或检索。</small></el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password
            :placeholder="editing ? '留空表示不修改' : 'sk-...'" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="0" />
          <span style="margin-left: 8px; color: var(--qg-sub); font-size: 12px">数字小的先用</span>
        </el-form-item>
        <el-form-item label="权重"><el-input-number v-model="form.weight" :min="0" /></el-form-item>
        <el-form-item label="超时(ms)"><el-input-number v-model="form.timeoutMs" :min="1000" :step="1000" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="poolVisible" :title="`Key 池 · ${poolChannel?.name ?? ''}`" size="560px">
      <p class="pool-tip">
        渠道「主 Key」之外的额外 Key，按权重轮询分摊。某把 Key 返回 401/403 会被自动禁用，
        返回 429 只冷却这一把；同渠道还有可用 Key 时不会熔断整个渠道。
      </p>
      <el-input
        v-model="poolInput"
        type="textarea"
        :rows="4"
        placeholder="每行一把 Key，可一次粘贴多行；重复的会自动跳过"
      />
      <div class="pool-actions">
        <span class="pool-weight">权重 <el-input-number v-model="poolWeight" :min="1" :max="100" size="small" /></span>
        <el-button type="primary" size="small" :loading="poolSaving" :disabled="!poolInput.trim()" @click="addKeys">
          导入
        </el-button>
        <span style="flex: 1"></span>
        <el-button size="small" :disabled="!poolKeys.some((k) => k.status === 'DISABLED')" @click="purgeDisabled">
          删除全部已禁用
        </el-button>
      </div>

      <el-table v-loading="poolLoading" :data="poolKeys" size="small" style="width: 100%">
        <el-table-column label="Key" width="110">
          <template #default="{ row }"><span class="pool-mono">{{ row.masked }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'DISABLED'" size="small" type="danger">已禁用</el-tag>
            <el-tag v-else-if="row.coolingMs > 0" size="small" type="warning">冷却 {{ Math.ceil(row.coolingMs / 1000) }}s</el-tag>
            <el-tag v-else size="small" type="success">可用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="权重" width="70" prop="weight" />
        <el-table-column label="失败 / 最近错误" min-width="120">
          <template #default="{ row }">
            <span>{{ row.failCount }}</span>
            <span v-if="row.lastError" class="pool-sub"> · {{ row.lastError }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" :loading="testing === row.id" @click="testKey(row)">测试</el-button>
            <el-button link size="small" @click="toggleKey(row)">{{ row.status === 'ENABLED' ? '禁用' : '启用' }}</el-button>
            <el-button link size="small" type="danger" @click="removeKey(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <el-dialog v-model="testVisible" title="连通性测试" width="460">
      <div v-if="testResult">
        <p style="margin: 0 0 8px">
          <el-tag :type="testResult.ok ? 'success' : 'danger'" size="small">
            {{ testResult.ok ? '连通' : '失败' }}
          </el-tag>
          <span style="margin-left: 8px; color: var(--qg-sub); font-size: 13px">
            {{ testResult.channel }} · HTTP {{ testResult.status || '—' }} · {{ testResult.latencyMs }}ms
          </span>
        </p>
        <p v-if="testResult.model" style="font-size: 12px; color: var(--qg-sub)">探测模型：{{ testResult.model }}</p>
        <el-alert v-if="testResult.note" :title="testResult.note" type="info" :closable="false" />
        <pre
          v-if="testResult.error"
          style="background: var(--el-color-danger-light-9); color: var(--qg-danger); padding: 10px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-all"
          >{{ testResult.error }}</pre
        >
      </div>
      <template #footer>
        <el-button @click="testVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElAlert, ElButton, ElCard, ElDialog, ElDrawer, ElForm, ElFormItem, ElInput, ElInputNumber, ElLoading, ElMessage, ElMessageBox, ElOption, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus';
const vLoading = ElLoading.directive;
import { api } from '../../api/client.js';

const PROTOCOLS = {
  OPENAI: { label: 'OpenAI Chat · 兼容接口', base: 'https://api.openai.com/v1', note: '填写 API 根地址，对话使用 /chat/completions；可接入提供同格式的服务。' },
  OPENAI_RESPONSES: { label: 'OpenAI Responses', base: 'https://api.openai.com/v1', note: '对话使用 /responses，转换文本与图片输入；会话由本站管理，不自动执行工具。' },
  ANTHROPIC: { label: 'Anthropic Messages', base: 'https://api.anthropic.com/v1', note: '对话使用 /messages 与 2023-06-01 兼容版本，自动转换系统提示与图片。新版本参数尚未适配。' },
  GEMINI: { label: 'Gemini · 原生接口', base: 'https://generativelanguage.googleapis.com/v1beta', note: '填写包含 /v1beta 的根地址，绑定模型名后使用 streamGenerateContent；密钥通过请求头发送。' },
  CUSTOM: { label: '自定义 · Chat 兼容格式', base: 'https://your-api.example/v1', note: '自定义地址仍需提供 OpenAI Chat 兼容格式；请勿把其他原生接口填在此处。' },
  MOCK: { label: 'QGauss 本地模拟', base: 'mock://local', note: '本地模拟回复，不调用外部模型服务。' },
};
const TYPES = Object.keys(PROTOCOLS);

const rows = ref([]);
const visible = ref(false);
const editing = ref(null);
const saving = ref(false);
const testing = ref('');
const testVisible = ref(false);
const testResult = ref(null);

const form = reactive({
  name: '',
  type: 'OPENAI',
  baseUrl: '',
  apiKey: '',
  priority: 10,
  weight: 1,
  timeoutMs: 60000,
  webSearchRetrieval:false,
});

function breakerType(state) {
  return state === 'CLOSED' ? 'success' : state === 'HALF_OPEN' ? 'warning' : 'danger';
}

async function load() {
  const [channels, health] = await Promise.all([
    api.get('/models/channels'),
    api.get('/models/channels/health').catch(() => []),
  ]);
  const healthMap = new Map(health.map((h) => [h.id, h.breaker]));
  rows.value = channels.map((c) => ({
    ...c,
    breaker: healthMap.get(c.id) ?? { state: 'CLOSED' },
  }));
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { name: '', type: 'OPENAI', baseUrl: '', apiKey: '', priority: 10, weight: 1, timeoutMs: 60000,webSearchRetrieval:false });
  visible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    type: row.type,
    baseUrl: row.baseUrl,
    apiKey: '',
    priority: row.priority,
    weight: row.weight,
    timeoutMs: row.timeoutMs,
    webSearchRetrieval:row.extra?.webSearchProtocol==='retrieval',
  });
  visible.value = true;
}

async function save() {
  saving.value = true;
  try {
    const {webSearchRetrieval,...payload} = form;
    if(form.type==='CUSTOM'&&(webSearchRetrieval||editing.value?.extra?.webSearchProtocol==='retrieval')){
      const extra={...(editing.value?.extra||{})};if(webSearchRetrieval)extra.webSearchProtocol='retrieval';else delete extra.webSearchProtocol;payload.extra=extra;
    }
    if (editing.value && !payload.apiKey) delete payload.apiKey;
    if (editing.value) await api.patch(`/models/channels/${editing.value.id}`, payload);
    else await api.post('/models/channels', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  try {
    const status = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
    await api.patch(`/models/channels/${row.id}`, { status });
    await load();
  } catch (e) {
    ElMessage.error(e?.message || '操作失败');
  }
}

/** 清空已保存的密钥（编辑框留空表示“不修改”，所以必须单独一个动作） */
async function clearKey(row) {
  try {
    await ElMessageBox.confirm(`清空渠道「${row.name}」已保存的密钥？`, '提示', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  try {
    await api.patch(`/models/channels/${row.id}`, { apiKey: '' });
    ElMessage.success('密钥已清空');
    await load();
  } catch (e) {
    ElMessage.error(e?.message || '清空失败');
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除渠道「${row.name}」？`, '提示', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  try {
    await api.del(`/models/channels/${row.id}`);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

async function resetBreakers() {
  await api.post('/models/channels/health/reset');
  ElMessage.success('已重置熔断');
  await load();
}

async function testOne(row) {
  testing.value = row.id;
  try {
    const res = await api.post(`/models/channels/${row.id}/test`);
    testResult.value = { channel: row.name, ...res };
    testVisible.value = true;
  } catch (e) {
    testResult.value = { channel: row.name, ok: false, status: 0, latencyMs: 0, error: e.message };
    testVisible.value = true;
  } finally {
    testing.value = '';
  }
}

/* ---------------- Key 池 ---------------- */
const poolVisible = ref(false);
const poolChannel = ref(null);
const poolKeys = ref([]);
const poolLoading = ref(false);
const poolSaving = ref(false);
const poolInput = ref('');
const poolWeight = ref(1);

async function loadPool() {
  if (!poolChannel.value) return;
  poolLoading.value = true;
  try {
    poolKeys.value = await api.get(`/models/channels/${poolChannel.value.id}/keys`);
  } catch (e) {
    ElMessage.error(e?.message || '加载失败');
  } finally {
    poolLoading.value = false;
  }
}

function openPool(row) {
  poolChannel.value = row;
  poolInput.value = '';
  poolWeight.value = 1;
  poolKeys.value = [];
  poolVisible.value = true;
  loadPool();
}

async function addKeys() {
  const keys = poolInput.value.split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return;
  poolSaving.value = true;
  try {
    const { added, skipped } = await api.post(`/models/channels/${poolChannel.value.id}/keys`, {
      keys,
      weight: poolWeight.value,
    });
    ElMessage.success(skipped ? `已导入 ${added} 把，跳过 ${skipped} 把（重复或过短）` : `已导入 ${added} 把`);
    poolInput.value = '';
    await Promise.all([loadPool(), load()]);
  } catch (e) {
    ElMessage.error(e?.message || '导入失败');
  } finally {
    poolSaving.value = false;
  }
}

async function toggleKey(row) {
  try {
    await api.patch(`/models/channels/${poolChannel.value.id}/keys/${row.id}`, {
      status: row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED',
    });
    await Promise.all([loadPool(), load()]);
  } catch (e) {
    ElMessage.error(e?.message || '操作失败');
  }
}

async function removeKey(row) {
  try {
    await ElMessageBox.confirm(`删除 Key ${row.masked}？`, '提示', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.del(`/models/channels/${poolChannel.value.id}/keys/${row.id}`);
    await Promise.all([loadPool(), load()]);
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

async function purgeDisabled() {
  try {
    await ElMessageBox.confirm('删除这个渠道下全部已禁用的 Key？', '提示', { type: 'warning' });
  } catch {
    return;
  }
  try {
    const { count } = await api.post(`/models/channels/${poolChannel.value.id}/keys/bulk-delete`, { disabledOnly: true });
    ElMessage.success(`已删除 ${count} 把`);
    await Promise.all([loadPool(), load()]);
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

async function testKey(row) {
  testing.value = row.id;
  try {
    const res = await api.post(`/models/channels/${poolChannel.value.id}/keys/${row.id}/test`);
    testResult.value = { channel: `${poolChannel.value.name} · ${row.masked}`, ...res };
  } catch (e) {
    testResult.value = { channel: row.masked, ok: false, status: 0, latencyMs: 0, error: e.message };
  } finally {
    testing.value = '';
    testVisible.value = true;
  }
}

onMounted(load);
</script>

<style scoped>
.pool-tip {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--qg-sub);
}
.pool-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 14px;
}
.pool-weight {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--qg-sub);
}
.pool-mono {
  font-family: var(--qg-mono);
}
.pool-sub {
  color: var(--qg-faint);
  font-size: 12px;
}
</style>
