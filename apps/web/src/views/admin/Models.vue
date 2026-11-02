<template>
  <div style="padding: 20px; height: 100%; overflow: auto">
    <el-card shadow="never">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>模型</span>
          <el-button size="small" type="primary" @click="openCreate">新增模型</el-button>
        </div>
      </template>

      <el-table :data="rows" size="small" style="width: 100%">
        <el-table-column prop="name" label="对外名称" min-width="150" />
        <el-table-column prop="displayName" label="展示名" min-width="140" />
        <el-table-column label="厂商" width="130">
          <template #default="{ row }">
            <span>{{ row.vendor || '其他' }}</span>
            <el-tag
              v-if="row.badge"
              size="small"
              type="danger"
              effect="dark"
              style="margin-left: 6px"
            >{{ row.badge }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上下文" width="120">
          <template #default="{ row }">{{ row.maxContext }} / {{ row.maxOutput }}</template>
        </el-table-column>
        <el-table-column label="渠道绑定" min-width="260">
          <template #default="{ row }">
            <el-tag
              v-for="c in row.channels"
              :key="c.channelId"
              size="small"
              closable
              style="margin-right: 6px"
              @close="unbind(row, c)"
            >
              {{ c.channelName }} → {{ c.upstreamName }}
            </el-tag>
            <span v-if="row.channels.length === 0" style="color: var(--qg-sub)">未绑定</span>
          </template>
        </el-table-column>
        <el-table-column label="次数设置" width="150">
          <template #default="{ row }">
            <span v-if="row.countPool && row.countCost">{{ poolText(row.countPool) }} × {{ row.countCost }}</span>
            <span v-else style="color: var(--el-text-color-secondary)">未配置次数消耗</span>
          </template>
        </el-table-column>
        <el-table-column label="成本参考 / 百万 tokens" min-width="180"><template #default="{ row }"><div>输入 {{ microsLabel(row.priceInPerM) }}</div><div>输出 {{ microsLabel(row.priceOutPerM) }}</div></template></el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'ENABLED' ? 'success' : 'info'">
              {{ row.status === 'ENABLED' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" @click="openBind(row)">绑定渠道</el-button>
            <el-button link size="small" @click="toggle(row)">
              {{ row.status === 'ENABLED' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="visible" :title="editing ? '编辑模型' : '新增模型'" width="520">
      <el-form :model="form" label-width="110">
        <el-form-item label="对外名称">
          <el-input v-model="form.name" :disabled="!!editing" placeholder="gpt-4o-mini" />
        </el-form-item>
        <el-form-item label="展示名"><el-input v-model="form.displayName" /></el-form-item>
        <el-form-item label="厂商">
          <el-input v-model="form.vendor" placeholder="OpenAI / DeepSeek / 其他" />
          <span class="qg-tip">留空归入「其他」，模型广场按厂商分组</span>
        </el-form-item>
        <el-form-item label="一句话介绍">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="展示在模型广场卡片上"
          />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="form.tags" placeholder="逗号分隔：视觉,推理,长上下文" />
        </el-form-item>
        <el-form-item label="角标">
          <el-input v-model="form.badge" placeholder="HOT / NEW / 推荐，留空不显示" />
        </el-form-item>
        <el-form-item label="最大上下文"><el-input-number v-model="form.maxContext" :min="1024" :step="1024" /></el-form-item>
        <el-form-item label="最大输出"><el-input-number v-model="form.maxOutput" :min="1" :step="256" /></el-form-item>
        <el-form-item label="能力">
          <el-input v-model="form.capabilities" placeholder="chat,vision,reasoning,web_search" />
          <small class="qg-muted">支持联网的模型可加入 web_search，并绑定 Responses、Anthropic 或明确启用 retrieval 的兼容渠道。此处是能力配置，仍需真实调用验证。</small>
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
        <el-form-item label="计费次数池">
          <el-select v-model="form.countPool" style="width: 220px">
            <el-option value="" label="不按次数计费（只记 token）" />
            <el-option value="model3" label="低价模型 model3" />
            <el-option value="model4" label="高价模型 model4" />
            <el-option value="drawMj" label="绘图 drawMj" />
            <el-option value="agent" label="智能体 agent" />
          </el-select>
        </el-form-item>
        <el-form-item label="每次消耗">
          <el-input-number v-model="form.countCost" :min="0" />
          <span class="qg-tip">次（0 表示不扣）</span>
        </el-form-item>
        <el-form-item label="输入成本参考"><el-input v-model="form.priceInYuan" aria-label="输入成本参考" inputmode="decimal" placeholder="元 / 百万 tokens，最多 6 位小数" /></el-form-item>
        <el-form-item label="输出成本参考"><el-input v-model="form.priceOutYuan" aria-label="输出成本参考" inputmode="decimal" placeholder="元 / 百万 tokens，最多 6 位小数" /></el-form-item>
        <p class="qg-tip">成本参考用于用量统计，不按此金额扣钱包。实际对话费用由次数池和站点收费开关决定。</p>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="bindVisible" title="绑定渠道" width="480">
      <el-form label-width="110">
        <el-form-item label="渠道">
          <el-select v-model="bindForm.channelId" style="width: 100%">
            <el-option v-for="c in channels" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="上游模型名">
          <el-input v-model="bindForm.upstreamName" placeholder="该渠道上的真实模型名 / Azure 部署名" />
        </el-form-item>
        <el-form-item label="权重"><el-input-number v-model="bindForm.weight" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button type="primary" @click="doBind">绑定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { api } from '../../api/client.js';
import { microsLabel, parseMicros } from '../../lib/model-presentation.js';
const priceInput = value => { const label = microsLabel(value); return label.startsWith('¥') ? label.slice(1) : ''; };

const rows = ref([]);
const channels = ref([]);
const visible = ref(false);
const bindVisible = ref(false);
const editing = ref(null);
const saving = ref(false);
const bindTarget = ref(null);

const form = reactive({
  name: '',
  displayName: '',
  vendor: '',
  description: '',
  tags: '',
  badge: '',
  maxContext: 8192,
  maxOutput: 2048,
  capabilities: 'chat',
  sort: 0,
  countPool: '',
  countCost: 0,
  priceInYuan: '0',
  priceOutYuan: '0',
});
const bindForm = reactive({ channelId: '', upstreamName: '', weight: 1 });

async function load() {
  const [models, chs] = await Promise.all([api.get('/models'), api.get('/models/channels')]);
  rows.value = models;
  channels.value = chs;
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    name: '',
    displayName: '',
    vendor: '',
    description: '',
    tags: '',
    badge: '',
    maxContext: 8192,
    maxOutput: 2048,
    capabilities: 'chat',
    sort: 0,
    countPool: '',
    countCost: 0,
  priceInYuan: '0',
  priceOutYuan: '0',
  });
  visible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    displayName: row.displayName,
    vendor: row.vendor ?? '',
    description: row.description ?? '',
    tags: row.tags ?? '',
    badge: row.badge ?? '',
    maxContext: row.maxContext,
    maxOutput: row.maxOutput,
    capabilities: row.capabilities.join(','),
    sort: row.sort,
    countPool: row.countPool ?? '',
    countCost: row.countCost ?? 0,
    priceInYuan: priceInput(row.priceInPerM),
    priceOutYuan: priceInput(row.priceOutPerM),
  });
  visible.value = true;
}

const POOL_LABEL = { model3: '低价', model4: '高价', drawMj: '绘图', agent: '智能体' };
function poolText(pool) {
  return POOL_LABEL[pool] ?? pool;
}

async function save() {
  saving.value = true;
  try {
    const { priceInYuan, priceOutYuan, ...base } = form;
    const priceInPerM = parseMicros(priceInYuan), priceOutPerM = parseMicros(priceOutYuan);
    if (priceInPerM === null || priceOutPerM === null) return ElMessage.warning('成本参考须为 0–2147.483647 元，最多 6 位小数');
    const payload = { ...base, priceInPerM, priceOutPerM };
    if (editing.value) await api.patch(`/models/${editing.value.id}`, payload);
    else await api.post('/models', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

function openBind(row) {
  bindTarget.value = row;
  Object.assign(bindForm, { channelId: channels.value[0]?.id ?? '', upstreamName: row.name, weight: 1 });
  bindVisible.value = true;
}

async function doBind() {
  if (!bindForm.channelId || !bindForm.upstreamName) return ElMessage.warning('渠道和上游模型名必填');
  await api.post(`/models/${bindTarget.value.id}/channels`, { ...bindForm });
  ElMessage.success('已绑定');
  bindVisible.value = false;
  await load();
}

async function toggle(row) {
  await api.patch(`/models/${row.id}`, { status: row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' });
  await load();
}

/** 解绑渠道：之前只能绑不能解，点标签上的 × 走这里 */
async function unbind(row, binding) {
  try {
    await ElMessageBox.confirm(
      `解除「${row.name}」与渠道「${binding.channelName}」的绑定？`,
      '提示',
      { type: 'warning' },
    );
    await api.del(`/models/${row.id}/channels/${binding.channelId}`);
    ElMessage.success('已解绑');
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message ?? '解绑失败');
  }
}

onMounted(load);
</script>
