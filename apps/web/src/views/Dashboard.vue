<template>
  <div style="height: 100%; overflow: auto">
    <PageHero class="qgd-dashboard-hero" title="把全局，看得更" highlight="清楚。" eyebrow="QGAUSS CONTROL ROOM" description="运营数据、调用趋势与渠道状态，在同一处从容掌握。" icon="settings" />
    <div class="qg-stat-grid">
      <div v-for="card in cards" :key="card.label" class="qg-stat-card">
        <div class="qg-stat-label">{{ card.label }}</div>
        <div class="qg-stat-value">{{ card.value }}</div>
      </div>
    </div>

    <div style="padding: 0 20px 24px">
      <el-card shadow="never" style="margin-bottom: 16px">
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span>近 7 日调用趋势</span>
            <el-radio-group v-model="trendField" size="small">
              <el-radio-button value="calls">调用</el-radio-button>
              <el-radio-button value="tokens">token</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <TrendChart :data="trend" :field="trendField" />
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span>渠道健康度</span>
            <el-button size="small" @click="resetBreakers">重置熔断</el-button>
          </div>
        </template>
        <el-table :data="channels" size="small" style="width: 100%">
          <el-table-column prop="name" label="渠道" />
          <el-table-column label="启用" width="90">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                {{ row.enabled ? '是' : '否' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="熔断状态" width="120">
            <template #default="{ row }">
              <el-tag
                size="small"
                :type="row.breaker.state === 'CLOSED' ? 'success' : row.breaker.state === 'HALF_OPEN' ? 'warning' : 'danger'"
              >
                {{ row.breaker.state }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="breaker.failures" label="窗口失败" width="100" />
          <el-table-column prop="breaker.consecutiveFailures" label="连续失败" width="100" />
          <el-table-column prop="breaker.lastError" label="最近错误" />
        </el-table>
      </el-card>

      <el-card shadow="never" style="margin-top: 16px">
        <template #header>最近失败请求</template>
        <el-table :data="errors" size="small">
          <el-table-column prop="modelName" label="模型" width="180" />
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column prop="errorCode" label="错误码" width="160" />
          <el-table-column prop="createdAt" label="时间" />
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import PageHero from '../components/design/PageHero.vue';
import { computed, onMounted, ref } from 'vue';
import { ElButton, ElCard, ElMessage, ElRadioButton, ElRadioGroup, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { api } from '../api/client.js';
import TrendChart from '../components/TrendChart.vue';

const overview = ref({});
const channels = ref([]);
const errors = ref([]);
const trend = ref([]);
const trendField = ref('calls');

const cards = computed(() => [
  { label: '近 7 日调用', value: overview.value.calls ?? '-' },
  { label: 'token 总量', value: overview.value.totalTokens ?? '-' },
  { label: '失败率', value: overview.value.failureRate != null ? `${overview.value.failureRate}%` : '-' },
  { label: '会话数', value: overview.value.conversations ?? '-' },
  { label: '活跃用户', value: overview.value.activeUsers ?? '-' },
]);

async function load() {
  const [ov, ch, er, tr] = await Promise.all([
    api.get('/statistic/overview?days=7').catch(() => ({})),
    api.get('/models/channels/health').catch(() => []),
    api.get('/statistic/errors?limit=8').catch(() => []),
    api.get('/statistic/trend?days=7').catch(() => []),
  ]);
  overview.value = ov;
  channels.value = ch;
  errors.value = er;
  trend.value = tr;
}

async function resetBreakers() {
  await api.post('/models/channels/health/reset');
  ElMessage.success('已重置熔断状态');
  await load();
}

onMounted(load);
</script>
