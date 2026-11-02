<template>
  <div style="padding: 20px; height: 100%; overflow: auto">
    <el-card shadow="never">
      <template #header>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
          <span>聊天记录</span>
          <span style="flex: 1"></span>
          <el-input v-model="filters.keyword" placeholder="内容关键词" size="small" style="width: 180px" clearable />
          <el-input v-model="filters.modelName" placeholder="模型名" size="small" style="width: 150px" clearable />
          <el-select v-model="filters.status" placeholder="状态" size="small" style="width: 120px" clearable>
            <el-option label="等待回复" value="PENDING" />
            <el-option label="正在生成" value="STREAMING" />
            <el-option label="保存与结算中" value="SETTLING" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="失败" value="FAILED" />
            <el-option label="已停止" value="ABORTED" />
          </el-select>
          <el-date-picker
            v-model="range"
            type="daterange"
            size="small"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 240px"
          />
          <el-button size="small" @click="search">查询</el-button>
          <el-button size="small" type="primary" :loading="exporting" @click="exportExcel">导出 Excel</el-button>
        </div>
      </template>

      <el-table :data="rows" size="small" style="width: 100%">
        <el-table-column prop="createdAt" label="时间" width="170">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="user" label="用户" width="120" />
        <el-table-column prop="conversationTitle" label="会话" width="180" show-overflow-tooltip />
        <el-table-column prop="role" label="角色" width="100" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'COMPLETED' ? 'success' : row.status === 'FAILED' ? 'danger' : 'info'">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="modelName" label="模型" width="140" />
        <el-table-column label="token" width="110">
          <template #default="{ row }">{{ row.promptTokens || 0 }} / {{ row.completionTokens || 0 }}</template>
        </el-table-column>
        <el-table-column prop="content" label="内容" min-width="320" show-overflow-tooltip />
      </el-table>

      <div style="margin-top: 12px; text-align: right">
        <el-pagination
          layout="total, prev, pager, next"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="onPage"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElButton, ElCard, ElDatePicker, ElInput, ElMessage, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { api, getAccessToken } from '../../api/client.js';

const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const exporting = ref(false);
const range = ref(null);
const filters = reactive({ keyword: '', modelName: '', status: '' });

function fmt(v) {
  return v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '';
}

function queryString() {
  const q = new URLSearchParams();
  if (filters.keyword) q.set('keyword', filters.keyword);
  if (filters.modelName) q.set('modelName', filters.modelName);
  if (filters.status) q.set('status', filters.status);
  if (range.value?.[0]) q.set('from', `${range.value[0]}T00:00:00`);
  if (range.value?.[1]) q.set('to', `${range.value[1]}T23:59:59`);
  return q;
}

async function load() {
  const q = queryString();
  q.set('page', String(page.value));
  q.set('pageSize', String(pageSize));
  const data = await api.get(`/chat-logs?${q.toString()}`);
  rows.value = data.items;
  total.value = data.total;
}

function onPage(p) {
  page.value = p;
  load();
}

/** 改筛选条件时回到第一页，否则会在新结果里停在旧页码上 */
function search() {
  page.value = 1;
  load();
}

async function exportExcel() {
  exporting.value = true;
  try {
    const q = queryString();
    const res = await fetch(`/api/chat-logs/export?${q.toString()}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    if (!res.ok) throw new Error(`导出失败(${res.status})`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    // 立刻 revoke 会让部分浏览器取消下载，延后一秒再释放
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ElMessage.success('已开始下载');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    exporting.value = false;
  }
}

onMounted(load);
</script>
