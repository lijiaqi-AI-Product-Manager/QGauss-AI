<template>
  <div style="padding: 20px; height: 100%; overflow: auto">
    <el-card shadow="never">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>预设（对话页快捷入口）</span>
          <el-button size="small" type="primary" @click="openCreate">新增预设</el-button>
        </div>
      </template>

      <el-table :data="rows" size="small">
        <el-table-column label="分组" width="150">
          <template #default="{ row }">{{ row.group?.name ?? '未分组' }}</template>
        </el-table-column>
        <el-table-column prop="title" label="标题" width="180" />
        <el-table-column prop="prompt" label="提示词" min-width="300" show-overflow-tooltip />
        <el-table-column prop="sort" label="排序" width="80" />
        <el-table-column label="启用" width="90">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="(v) => toggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button link size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="visible" :title="editing ? '编辑预设' : '新增预设'" width="560">
      <el-form label-width="90">
        <el-form-item label="分组">
          <el-select v-model="form.groupId" style="width: 100%" clearable placeholder="未分组">
            <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="提示词">
          <el-input v-model="form.prompt" type="textarea" :rows="6" />
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect, ElSwitch, ElTable, ElTableColumn } from 'element-plus';
import { api } from '../../api/client.js';

const rows = ref([]);
const groups = ref([]);
const visible = ref(false);
const editing = ref(null);
const saving = ref(false);

const form = reactive({ groupId: '', title: '', prompt: '', sort: 0 });

async function load() {
  const [presets, grps] = await Promise.all([api.get('/presets/admin'), api.get('/presets/groups')]);
  rows.value = presets;
  groups.value = grps;
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { groupId: groups.value[0]?.id ?? '', title: '', prompt: '', sort: 0 });
  visible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    groupId: row.groupId ?? '',
    title: row.title,
    prompt: row.prompt,
    sort: row.sort,
  });
  visible.value = true;
}

async function save() {
  if (!form.title || !form.prompt) return ElMessage.warning('标题和提示词必填');
  saving.value = true;
  try {
    const payload = { ...form, groupId: form.groupId || null };
    if (editing.value) await api.patch(`/presets/${editing.value.id}`, payload);
    else await api.post('/presets', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function toggle(row, enabled) {
  await api.patch(`/presets/${row.id}`, { enabled });
  await load();
}

async function remove(row) {
  await ElMessageBox.confirm(`删除预设「${row.title}」？`, '提示', { type: 'warning' });
  await api.del(`/presets/${row.id}`);
  await load();
}

onMounted(load);
</script>
