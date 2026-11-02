<template>
  <div style="padding: 20px; height: 100%; overflow: auto">
    <el-tabs v-model="tab">
      <el-tab-pane label="词库" name="words">
        <el-card shadow="never">
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center">
              <span>敏感词（命中后拦截，命中记录留档）</span>
              <el-button size="small" type="primary" @click="openCreate">新增词</el-button>
            </div>
          </template>

          <el-table :data="words" size="small">
            <el-table-column prop="word" label="词" min-width="160" />
            <el-table-column prop="category" label="分类" width="140" />
            <el-table-column label="动作" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="row.action === 'block' ? 'danger' : 'warning'">
                  {{ row.action === 'block' ? '拦截' : '待审' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="90">
              <template #default="{ row }">
                <el-switch :model-value="row.enabled" @change="(v) => toggle(row, v)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button link size="small" type="danger" @click="remove(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="命中记录" name="hits">
        <el-card shadow="never">
          <el-table :data="hits" size="small">
            <el-table-column prop="word" label="命中词" width="140" />
            <el-table-column prop="excerpt" label="上下文" min-width="260" show-overflow-tooltip />
            <el-table-column prop="userId" label="用户" width="200" show-overflow-tooltip />
            <el-table-column prop="createdAt" label="时间" width="180" />
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="visible" title="新增敏感词" width="420">
      <el-form label-width="80">
        <el-form-item label="词"><el-input v-model="form.word" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="form.category" placeholder="general" /></el-form-item>
        <el-form-item label="动作">
          <el-radio-group v-model="form.action">
            <el-radio value="block">拦截</el-radio>
            <el-radio value="review">待审</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElRadio, ElRadioGroup, ElSwitch, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag } from 'element-plus';
import { api } from '../../api/client.js';

const tab = ref('words');
const words = ref([]);
const hits = ref([]);
const visible = ref(false);
const form = reactive({ word: '', category: 'general', action: 'block' });

async function loadWords() {
  words.value = await api.get('/moderation/words');
}

async function loadHits() {
  const data = await api.get('/moderation/hits');
  hits.value = data.items;
}

function openCreate() {
  Object.assign(form, { word: '', category: 'general', action: 'block' });
  visible.value = true;
}

async function save() {
  if (!form.word.trim()) return ElMessage.warning('请输入词');
  try {
    await api.post('/moderation/words', { ...form });
    ElMessage.success('已添加，立即生效');
    visible.value = false;
    await loadWords();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function toggle(row, enabled) {
  await api.patch(`/moderation/words/${row.id}`, { enabled });
  await loadWords();
}

async function remove(row) {
  await ElMessageBox.confirm(`删除敏感词「${row.word}」？`, '提示', { type: 'warning' });
  await api.del(`/moderation/words/${row.id}`);
  await loadWords();
}

watch(tab, (v) => {
  if (v === 'hits') loadHits();
});

onMounted(loadWords);
</script>
