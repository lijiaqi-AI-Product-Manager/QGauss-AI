<template>
  <div class="qsi-welcome" :class="'qsi-' + appearance.variant">
    <header class="qsi-welcome-heading"><div><span class="qsi-eyebrow">QGAUSS AI / YOUR LAUNCH NOTES</span><h1>把空间布置好，<br /><mark>再让灵感起飞。</mark></h1><p>一份属于管理员的启航清单。读取实际配置与创作记录，准备好一项，就离第一份作品近一点。</p></div><div class="qsi-mini-beacon" aria-hidden="true"><span>Q</span><i>✦</i><b>READY, SET, CREATE.</b></div></header>
    <div v-if="loading" class="qsi-card qsi-loading" role="status"><BrandLoader />正在核对你的空间</div>
    <div v-else-if="errorText" class="qsi-card" role="alert"><h2>清单暂时没有读到。</h2><p>{{ errorText }}</p><button class="qsi-primary" type="button" @click="load">重新读取</button></div>
    <template v-else-if="readiness">
      <section class="qsi-flight-strip"><div><span class="qsi-eyebrow">YOUR CURRENT SPACE</span><h2>{{ readiness.chatModel ? '搭档已就位，试着聊一个想法。' : '先为你的空间，选一位搭档。' }}</h2><p>{{ readiness.chatModel ? '配置就绪代表可以发起请求，真实效果与速度仍需亲自验证。' : '可以连接真实模型，也可以先明确开启一位不联网的本地演示搭档。' }}</p></div><router-link class="qsi-primary" :to="readiness.chatModel ? {path:'/chat',query:{model:readiness.chatModel.name}} : '/models/channels'">{{ readiness.chatModel ? '打开对话工作区' : '连接模型服务' }} <ClientIcon name="arrowUpRight" /></router-link></section>
      <section class="qsi-readiness-grid" aria-label="空间启航清单"><article v-for="(check,index) in readiness.checks" :key="check.id" class="qsi-card qsi-readiness-card" :class="'qsi-check-' + check.state"><div class="qsi-check-top"><span class="qsi-check-number">0{{ index + 1 }}</span><span class="qsi-state-pill">{{ stateLabels[check.state] || '待确认' }}</span></div><h2>{{ check.title }}</h2><p>{{ check.description }}</p><router-link v-if="check.action" class="qsi-check-link" :to="check.action.path">{{ check.action.label }} <ClientIcon name="arrowUpRight" /></router-link></article></section>
      <section class="qsi-demo-card"><div><span class="qsi-eyebrow">TRY SOMETHING SMALL</span><h2>先和一位本地搭档打个招呼。</h2><p>本地体验不连接外部模型，回复用于熟悉操作，不代表真实模型能力。开启只添加演示配置，不会自动生成。</p></div><template v-if="demoUncertain"><p class="qsi-note" role="status">开启结果尚未确认。请先重新读取清单，再决定下一步。</p><button class="qsi-secondary" type="button" :disabled="demoPending" @click="load">重新核对状态</button></template><template v-else-if="readiness.canEnableDemo"><button v-if="!demoReview" class="qsi-secondary" type="button" @click="demoReview = true">了解并开启本地体验</button><div v-else class="qsi-demo-confirm"><p>确认向本站添加 QGauss 本地体验模型？已有模型不会被替换。</p><div class="qsi-actions"><button class="qsi-secondary" type="button" :disabled="demoPending" @click="demoReview = false">暂时不用</button><button class="qsi-primary" type="button" :disabled="demoPending" @click="enableDemo"><span v-if="demoPending" class="qsi-spinner"></span>{{ demoPending ? '正在准备' : '确认开启本地体验' }}</button></div></div></template><p v-else class="qsi-note">已有可用的对话配置，请从工作区选择模型。</p><p v-if="demoError" class="qsi-error" role="alert">{{ demoError }}</p></section>
      <footer class="qsi-welcome-footer"><p>邮件配置不等于投递成功，模型配置不等于实际生成通过。请逐项亲自体验，再开放给其他人。</p><router-link to="/chat">进入创作空间 <ClientIcon name="arrowUpRight" /></router-link></footer>
    </template>
  </div>
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import { useAppearance } from '../stores/appearance.js';
import BrandLoader from '../components/design/BrandLoader.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import '../components/design/installation.css';
const auth = useAuth(), appearance = useAppearance();
const stateLabels = { ready: '已完成', configured: '已配置 · 待体验', action: '下一小步', optional: '按需准备', missing: '等待布置' };
const loading = ref(true), errorText = ref(''), readiness = ref(null), demoReview = ref(false), demoPending = ref(false), demoUncertain = ref(false), demoError = ref('');
let alive = true, readRequest, writeRequest;
const current = owner => alive && auth.isAdmin && auth.identityRevision === owner;
async function load() {
  readRequest?.abort(); const request = new AbortController(), owner = auth.identityRevision; readRequest = request;
  loading.value = true; errorText.value = '';
  try {
    const data = await api.get('/installation/readiness', { signal: request.signal, retry: false });
    if (!current(owner) || request.signal.aborted) return;
    if (!Array.isArray(data?.checks)) throw new Error('清单内容尚未确认，请重试。');
    readiness.value = data; demoUncertain.value = false; demoReview.value = false;
  } catch (error) { if (current(owner) && !request.signal.aborted) errorText.value = error?.message || '暂时无法读取清单。'; }
  finally { if (current(owner) && readRequest === request) loading.value = false; }
}
async function enableDemo() {
  if (demoPending.value || !demoReview.value || !readiness.value?.canEnableDemo || demoUncertain.value) return;
  const owner = auth.identityRevision, request = new AbortController(); writeRequest = request; demoPending.value = true; demoError.value = '';
  try { await api.post('/installation/demo', {}, { retry: false, signal: request.signal }); if (current(owner)) await load(); }
  catch (error) { if (!current(owner) || request.signal.aborted) return; demoUncertain.value = !error?.status || error.status >= 500; demoError.value = demoUncertain.value ? '' : error?.message || '暂时无法开启，请核对后重试。'; }
  finally { if (current(owner)) demoPending.value = false; }
}
watch(() => auth.identityRevision, () => { readRequest?.abort(); writeRequest?.abort(); readiness.value = null; errorText.value = ''; demoReview.value = demoPending.value = demoUncertain.value = false; demoError.value = ''; if (auth.isAdmin) load(); });
onMounted(load);
onBeforeUnmount(() => { alive = false; readRequest?.abort(); writeRequest?.abort(); });
</script>
