<template>
  <div style="padding: 20px; height: 100%; overflow: auto">
    <el-card shadow="never">
      <template #header>图像生成</template>
      <el-form label-width="90">
        <el-form-item label="提示词">
          <el-input v-model="prompt" type="textarea" :rows="3" placeholder="描述你想要的画面，例如：一只坐在窗台上的橘猫，水彩风格" />
        </el-form-item>
        <el-form-item label="尺寸">
          <el-select v-model="size" style="width: 160px">
            <el-option label="512×512" value="512x512" />
            <el-option label="768×768" value="768x768" />
            <el-option label="1024×1024" value="1024x1024" />
          </el-select>
          <span style="margin-left: 12px; color: var(--qg-sub); font-size: 12px">
            当前默认为本地模拟渠道，可在后台切换到真实上游
          </span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="creating" @click="submit">开始生成</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" style="margin-top: 16px">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>我的任务</span>
          <el-button size="small" @click="load">刷新</el-button>
        </div>
      </template>

      <el-empty v-if="tasks.length === 0" description="还没有生成任务" />

      <div v-for="task in tasks" :key="task.id" style="border-bottom: 1px solid var(--qg-border); padding: 12px 0">
        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px">
          <el-tag size="small" :type="statusType(task.status)">{{ statusLabel(task.status) }}</el-tag>
          <el-tag v-if="task.provider" size="small" type="info">{{ task.provider }}</el-tag>
          <el-tag v-if="task.editOf" size="small" type="warning">图生图</el-tag>
          <span style="flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ task.prompt }}
          </span>
          <span style="font-size: 12px; color: var(--qg-sub)">{{ task.size }}</span>
          <el-button v-if="isPending(task.status)" link size="small" @click="cancel(task)">取消</el-button>
        </div>

        <el-progress v-if="isPending(task.status)" :percentage="task.progress" :stroke-width="4" />

        <div v-if="task.status === 'FAILED'" style="font-size: 12px; color: var(--qg-danger)">
          {{ task.errorMessage || task.errorCode }}
        </div>

        <div v-if="task.results?.length" style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px">
          <el-image
            v-for="r in task.results"
            :key="r.fileId"
            :src="r.blobUrl || r.url"
            :preview-src-list="task.results.map((x) => x.blobUrl || x.url)"
            fit="cover"
            style="width: 140px; height: 140px; border-radius: 8px; border: 1px solid var(--qg-border)"
          >
            <template #error>
              <div style="display: grid; place-items: center; height: 100%; color: var(--qg-sub); font-size: 12px">
                加载失败
              </div>
            </template>
          </el-image>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElImage, ElInput, ElMessage, ElOption, ElProgress, ElSelect, ElTag } from 'element-plus';
import { api, getAccessToken } from '../api/client.js';

const prompt = ref('');
const size = ref('512x512');
const creating = ref(false);
const tasks = ref([]);
let poller = null;
/** 图片接口要带 Bearer，<img src> 带不上，所以统一换成 blob URL */
const blobUrls = new Set();

async function hydrate(results = []) {
  return Promise.all(
    results.map(async (r) => {
      if (!r?.url) return r;
      try {
        const res = await fetch(r.url, {
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        });
        if (!res.ok) return r;
        const url = URL.createObjectURL(await res.blob());
        return { ...r, blobUrl: url };
      } catch {
        return r;
      }
    }),
  );
}

function isPending(status) {
  return status === 'QUEUED' || status === 'RUNNING';
}

function statusLabel(s) {
  return { QUEUED: '排队中', RUNNING: '生成中', SUCCESS: '已完成', FAILED: '失败', CANCELED: '已取消' }[s] ?? s;
}

function statusType(s) {
  return { QUEUED: 'info', RUNNING: 'warning', SUCCESS: 'success', FAILED: 'danger', CANCELED: 'info' }[s] ?? 'info';
}

async function load() {
  const data = await api.get('/image/tasks?page=1&pageSize=20');
  const items = data.items ?? [];
  const hydrated = await Promise.all(
    items.map(async (t) => ({
      ...t,
      results: t.results?.length ? await hydrate(t.results) : t.results,
    })),
  );
  // 只保留本轮还在用的 blob URL，其余立刻释放，避免轮询一直涨内存
  const keep = new Set(
    hydrated.flatMap((t) => (t.results ?? []).map((r) => r.blobUrl).filter(Boolean)),
  );
  for (const u of blobUrls) if (!keep.has(u)) URL.revokeObjectURL(u);
  blobUrls.clear();
  for (const u of keep) blobUrls.add(u);
  tasks.value = hydrated;
}

async function submit() {
  if (!prompt.value.trim()) return ElMessage.warning('请输入提示词');
  creating.value = true;
  try {
    await api.post('/image/tasks', { prompt: prompt.value, size: size.value, n: 1 });
    ElMessage.success('已提交，正在生成');
    prompt.value = '';
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    creating.value = false;
  }
}

async function cancel(task) {
  await api.del(`/image/tasks/${task.id}`);
  await load();
}

onMounted(async () => {
  await load();
  // 有未完成任务时每 2 秒刷新
  poller = setInterval(async () => {
    if (tasks.value.some((t) => isPending(t.status))) await load();
  }, 2000);
});

onUnmounted(() => {
  if (poller) clearInterval(poller);
  for (const u of blobUrls) URL.revokeObjectURL(u);
  blobUrls.clear();
});
</script>
