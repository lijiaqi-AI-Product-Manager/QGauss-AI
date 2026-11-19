<template>
  <div class="qsi-welcome" :class="'qsi-' + appearance.variant">
    <header class="qsi-welcome-heading">
      <div><h1>{{ wt('title') }}<br /><mark>{{ wt('titleAccent') }}</mark></h1><p>{{ wt('intro') }}</p></div>
      <div class="qsi-mini-beacon" aria-hidden="true"><span>Q</span><i>✦</i></div>
    </header>
    <div v-if="loading" class="qsi-card qsi-loading" role="status"><BrandLoader />{{ wt('loading') }}</div>
    <div v-else-if="loadFailed" class="qsi-card" role="alert">
      <h2>{{ wt('loadError') }}</h2><button class="qsi-primary" type="button" @click="load">{{ wt('retry') }}</button>
    </div>
    <template v-else-if="readiness">
      <section class="qsi-flight-strip">
        <div>
          <h2>{{ wt(readiness.chatModel ? 'modelPresent' : 'modelEmpty') }}</h2>
          <p>{{ wt(readiness.chatModel ? readiness.chatModel.demo ? 'demoModel' : 'modelDetail' : 'modelEmptyDetail') }}</p>
        </div>
        <router-link class="qsi-primary" :to="readiness.chatModel ? {path:'/chat',query:{model:readiness.chatModel.name}} : '/models/channels'">
          {{ wt(readiness.chatModel ? 'chat' : 'connect') }} <ClientIcon name="arrowUpRight" />
        </router-link>
      </section>
      <LaunchReadiness v-if="readiness.launch" :readiness="readiness" />
      <section class="qsi-readiness-grid" :aria-label="wt('checklist')">
        <article v-for="check in visibleChecks" :key="check.id" class="qsi-card qsi-readiness-card" :class="'qsi-check-' + check.state">
          <div class="qsi-check-top"><span class="qsi-state-pill">{{ wt(check.state) || wt('unknown') }}</span></div>
          <h2>{{ check.title }}</h2><p>{{ check.description }}</p>
          <router-link v-if="check.action" class="qsi-check-link" :to="check.action.path">
            {{ check.action.label }} <ClientIcon name="arrowUpRight" />
          </router-link>
        </article>
      </section>
      <section class="qsi-demo-card">
        <div><h2>{{ wt('demoTitle') }}</h2><p>{{ wt('demoIntro') }}</p></div>
        <template v-if="demoUncertain">
          <p class="qsi-note" role="status">{{ wt('demoUncertain') }}</p>
          <button class="qsi-secondary" type="button" :disabled="demoPending" @click="load">{{ wt('checkAgain') }}</button>
        </template>
        <template v-else-if="readiness.canEnableDemo">
          <button v-if="!demoReview" class="qsi-secondary" type="button" @click="demoReview = true">{{ wt('demoReview') }}</button>
          <div v-else class="qsi-demo-confirm">
            <p>{{ wt('demoConfirm') }}</p>
            <div class="qsi-actions">
              <button class="qsi-secondary" type="button" :disabled="demoPending" @click="demoReview = false">{{ wt('cancel') }}</button>
              <button class="qsi-primary" type="button" :disabled="demoPending" @click="enableDemo">
                <span v-if="demoPending" class="qsi-spinner"></span>{{ wt(demoPending ? 'enabling' : 'enable') }}
              </button>
            </div>
          </div>
        </template>
        <p v-else class="qsi-note">{{ wt('demoConfigured') }}</p>
        <p v-if="demoError" class="qsi-error" role="alert">{{ wt('demoError') }}</p>
      </section>
      <footer class="qsi-welcome-footer"><router-link to="/chat">{{ wt('workspace') }} <ClientIcon name="arrowUpRight" /></router-link></footer>
    </template>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import { useAppearance } from '../stores/appearance.js';
import { welcomeText as wt, welcomeCheck } from '../i18n/welcome-messages.js';
import BrandLoader from '../components/design/BrandLoader.vue';
import LaunchReadiness from '../components/design/LaunchReadiness.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import '../components/design/installation.css';
const auth = useAuth(), appearance = useAppearance();
const loading = ref(true), loadFailed = ref(false), readiness = ref(null), demoReview = ref(false), demoPending = ref(false), demoUncertain = ref(false), demoError = ref(false);
const visibleChecks = computed(() => {
  const data = readiness.value;
  if (!data) return [];
  return data.checks.filter(check => !data.launch || !['mail', 'opening'].includes(check.id))
    .map(check => welcomeCheck(check, data.chatModel));
});
let alive = true, readRequest, writeRequest;
const current = owner => alive && auth.isAdmin && auth.identityRevision === owner;
async function load() {
  readRequest?.abort(); const request = new AbortController(), owner = auth.identityRevision; readRequest = request;
  loading.value = true; loadFailed.value = false;
  try {
    const data = await api.get('/installation/readiness', { signal: request.signal, retry: false });
    if (!current(owner) || request.signal.aborted) return;
    if (!Array.isArray(data?.checks)) { loadFailed.value = true; return; }
    readiness.value = data; demoUncertain.value = false; demoReview.value = false;
  } catch { if (current(owner) && !request.signal.aborted) loadFailed.value = true; }
  finally { if (current(owner) && readRequest === request) loading.value = false; }
}
async function enableDemo() {
  if (demoPending.value || !demoReview.value || !readiness.value?.canEnableDemo || demoUncertain.value) return;
  const owner = auth.identityRevision, request = new AbortController(); writeRequest = request; demoPending.value = true; demoError.value = false;
  try { await api.post('/installation/demo', {}, { retry: false, signal: request.signal }); if (current(owner)) await load(); }
  catch (error) { if (!current(owner) || request.signal.aborted) return; demoUncertain.value = !error?.status || error.status === 409 || error.status >= 500; demoError.value = !demoUncertain.value; }
  finally { if (current(owner)) demoPending.value = false; }
}
watch(() => auth.identityRevision, () => { readRequest?.abort(); writeRequest?.abort(); readiness.value = null; loadFailed.value = demoReview.value = demoPending.value = demoUncertain.value = demoError.value = false; if (auth.isAdmin) load(); });
onMounted(load);
onBeforeUnmount(() => { alive = false; readRequest?.abort(); writeRequest?.abort(); });
</script>
