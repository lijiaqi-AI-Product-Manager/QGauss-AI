<template>
  <div class="qg-page apps-page">
    <el-tabs v-model="tab" class="qa-hub-tabs" :class="{ 'is-reader': !auth.isAdmin }">
      <el-tab-pane label="灵感搭档馆" name="market"><AppDiscovery v-if="tab === 'market'" /></el-tab-pane>

      <el-tab-pane v-if="auth.isAdmin" label="应用管理" name="admin">
        <div style="margin-bottom: 12px">
          <el-button size="small" type="primary" @click="openCreate">新增应用</el-button>
        </div>
        <el-table :data="adminApps" size="small">
          <el-table-column prop="name" label="名称" width="160" />
          <el-table-column label="分类" width="120">
            <template #default="{ row }">{{ row.category?.name || '未分类' }}</template>
          </el-table-column>
          <el-table-column prop="defaultModel" label="默认模型" width="140" />
          <el-table-column prop="systemPrompt" label="System Prompt" min-width="260" show-overflow-tooltip />
          <el-table-column label="上架" width="90">
            <template #default="{ row }">
              <el-switch :model-value="row.published" @change="(v) => togglePublish(row, v)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-button link size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link size="small" type="danger" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="visible" :title="editing ? '编辑应用' : '新增应用'" width="600">
      <el-form label-width="110">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.categoryId" style="width: 100%" clearable placeholder="未分类">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" /></el-form-item>
        <el-form-item label="默认模型"><el-input v-model="form.defaultModel" placeholder="mock-chat" /></el-form-item>
        <el-form-item label="开场白"><el-input v-model="form.greeting" /></el-form-item>
        <el-form-item label="System Prompt">
          <el-input v-model="form.systemPrompt" type="textarea" :rows="6" />
        </el-form-item>
        <el-form-item label="上架"><el-switch v-model="form.published" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElSwitch, ElTabPane, ElTable, ElTableColumn, ElTabs } from 'element-plus';
import { api } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import AppDiscovery from '../components/design/AppDiscovery.vue';

const auth = useAuth();

const tab = ref('market');
const categories = ref([]);
const adminApps = ref([]);

const visible = ref(false);
const editing = ref(null);
const form = reactive({
  name: '',
  categoryId: '',
  description: '',
  defaultModel: 'mock-chat',
  greeting: '',
  systemPrompt: '',
  published: true,
});

async function loadCategories() {
  categories.value = await api.get('/apps/categories');
}

async function loadAdmin() {
  if (!auth.isAdmin) return;
  adminApps.value = await api.get('/apps/admin/list');
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    name: '',
    categoryId: categories.value[0]?.id ?? '',
    description: '',
    defaultModel: 'mock-chat',
    greeting: '',
    systemPrompt: '',
    published: true,
  });
  visible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    categoryId: row.categoryId ?? '',
    description: row.description ?? '',
    defaultModel: row.defaultModel ?? '',
    greeting: row.greeting ?? '',
    systemPrompt: row.systemPrompt,
    published: row.published,
  });
  visible.value = true;
}

async function save() {
  if (!form.name || !form.systemPrompt) return ElMessage.warning('名称和 System Prompt 必填');
  const payload = { ...form, categoryId: form.categoryId || null };
  if (editing.value) await api.patch(`/apps/admin/${editing.value.id}`, payload);
  else await api.post('/apps/admin/create', payload);
  ElMessage.success('已保存');
  visible.value = false;
  await loadAdmin();
}

async function togglePublish(row, published) {
  await api.patch(`/apps/admin/${row.id}`, { published });
  await loadAdmin();
}

async function remove(row) {
  await ElMessageBox.confirm(`删除应用「${row.name}」？`, '提示', { type: 'warning' });
  await api.del(`/apps/admin/${row.id}`);
  await loadAdmin();
}

onMounted(async () => {
  if (!auth.isAdmin) return;
  try { await Promise.all([loadCategories(), loadAdmin()]); }
  catch (error) { ElMessage.error(error.message || '应用信息加载失败'); }
});
</script>

<style scoped>
.apps-page{max-width:none}.qa-hub-tabs:deep(>.el-tabs__header){margin-bottom:20px}.qa-hub-tabs:deep(>.el-tabs__header .el-tabs__item){font-size:12px}
.qa-hub-tabs.is-reader:deep(>.el-tabs__header){display:none}
</style>
