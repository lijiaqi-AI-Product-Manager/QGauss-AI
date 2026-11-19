<template>
  <section class="qav-card" aria-labelledby="qav-manager-title">
    <div class="qav-card-heading">
      <span class="qav-emblem" aria-hidden="true"><ClientIcon name="lock" /></span>
      <div>
        <h2 id="qav-manager-title">{{ vt('title') }}</h2>
        <p>{{ vt('intro') }}</p>
      </div>
      <span v-if="status" class="qav-chip" :data-enabled="status.enabled">{{ vt(status.enabled ? 'enabled' : 'notEnabled') }}</span>
    </div>
    <p v-if="loading" class="qav-note" role="status">{{ vt('reading') }}</p>
    <div v-else-if="loadError" class="qav-tools">
      <p class="qav-error" role="alert">{{ vt(loadError) }}</p>
      <button type="button" class="qav-action" @click="load">{{ vt('retry') }}</button>
    </div>
    <template v-else-if="status">
      <p v-if="status.enabled" class="qav-note">{{ vt('count', { count: status.recoveryRemaining }) }}</p>
      <p v-if="!status.canManage" class="qav-note">{{ vt('needPassword') }}</p>
      <div v-else class="qav-tools">
        <button type="button" class="qav-action qav-primary" :disabled="blocked" @click="open('begin')">
          <ClientIcon name="lock" />{{ vt(status.enabled ? 'switchFactor' : 'setup') }}
        </button>
        <template v-if="status.enabled">
          <button type="button" class="qav-action" :disabled="blocked" @click="open('recovery-codes')">{{ vt('replaceCodes') }}</button>
          <button type="button" class="qav-action" :disabled="blocked" @click="open('disable')">{{ vt('disable') }}</button>
        </template>
      </div>
    </template>
    <p v-if="notice" class="qav-note" role="status">{{ vt(notice) }}</p>
  </section>

  <Teleport to="body">
    <dialog ref="dialog" class="qav-dialog" aria-labelledby="qav-dialog-heading" @close="clear" @cancel="cancel">
      <div class="qav-dialog-body">
        <header>
          <span class="qav-emblem" aria-hidden="true"><ClientIcon :name="codes.length ? 'check' : 'lock'" /></span>
          <h2 id="qav-dialog-heading" ref="heading" tabindex="-1">{{ vt(title) }}</h2>
        </header>

        <template v-if="codes.length">
          <p class="qav-note">{{ vt('saveHint') }}</p>
          <ul class="qav-codes" role="list"><li v-for="value in codes" :key="value"><code>{{ value }}</code></li></ul>
          <div class="qav-tools">
            <button type="button" class="qav-action" @click="copy(codes.join('\n'))">{{ vt('copyCodes') }}</button>
            <button type="button" class="qav-action" @click="download">{{ vt('downloadCodes') }}</button>
            <button type="button" class="qav-action qav-primary" @click="dialog.close()">{{ vt('close') }}</button>
          </div>
        </template>
        <form v-else-if="pair" class="qav-form" @submit.prevent="submit('enable')">
          <p class="qav-note">{{ vt('pairInstructions') }}</p>
          <p class="qav-note">{{ vt('pairExpiry', { time: pairExpiry }) }}</p>
          <div class="qav-key">
            <span>{{ vt('key') }}</span>
            <code>{{ pair.secret }}</code>
            <div class="qav-tools">
              <button type="button" class="qav-action" :disabled="busy" @click="copy(pair.secret)">{{ vt('copyKey') }}</button>
              <a class="qav-action" :href="pair.uri">{{ vt('openApp') }}</a>
            </div>
          </div>
          <label class="qav-field">
            <span>{{ vt('factorCode') }}</span>
            <input v-model.trim="code" required maxlength="6" pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code" :disabled="busy" />
          </label>
          <div class="qav-tools">
            <button type="submit" class="qav-action qav-primary" :disabled="busy">
              <ClientIcon v-if="busy" name="refresh" class="qav-spin" />{{ vt(busy ? 'working' : 'confirmPair') }}
            </button>
            <button type="button" class="qav-action" :disabled="busy" @click="dialog.close()">{{ vt('cancel') }}</button>
          </div>
        </form>
        <form v-else class="qav-form" @submit.prevent="submit(action)">
          <p v-if="action" class="qav-note">{{ vt(action === 'recovery-codes' ? 'replaceWarning' : 'expireOthers') }}</p>
          <label class="qav-field">
            <span>{{ vt('password') }}</span>
            <input ref="passwordInput" v-model="password" type="password" required minlength="1" maxlength="128" autocomplete="current-password" :disabled="busy" />
          </label>
          <label v-if="requireProof" class="qav-field">
            <span>{{ vt('currentProof') }}</span>
            <input v-model.trim="code" required maxlength="40" autocomplete="off" :disabled="busy" />
          </label>
          <div class="qav-tools">
            <button type="submit" class="qav-action qav-primary" :disabled="busy">
              <ClientIcon v-if="busy" name="refresh" class="qav-spin" />{{ vt(busy ? 'working' : 'next') }}
            </button>
            <button type="button" class="qav-action" :disabled="busy" @click="dialog.close()">{{ vt('cancel') }}</button>
          </div>
        </form>
        <p v-if="error" class="qav-error" role="alert">{{ vt(error) }}</p>
        <p v-if="feedback" class="qav-note" role="status">{{ vt(feedback) }}</p>
      </div>
    </dialog>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { api } from '../../api/client.js';
import { currentLang } from '../../i18n/index.js';
import { verificationError, verificationText as vt } from '../../i18n/admin-verification-messages.js';
import { useAuth } from '../../stores/auth.js';
import ClientIcon from '../reference/ClientIcon.vue';
import './admin-verification.css';

const props = defineProps({ active: Boolean, blocked: Boolean });
const auth = useAuth();
const endpoint = '/auth/admin-verification';
const status = shallowRef(null);
const loading = ref(false);
const loadError = ref('');
const dialog = ref(null);
const heading = ref(null);
const passwordInput = ref(null);
const action = ref('');
const password = ref('');
const code = ref('');
const requireProof = ref(false);
const pair = shallowRef(null);
const codes = ref([]);
const busy = ref(false);
const error = ref('');
const feedback = ref('');
const notice = ref('');
let reading, request;

const title = computed(() => {
  if (codes.value.length) return 'saved';
  if (pair.value) return 'pairTitle';
  if (action.value === 'recovery-codes') return 'replaceCodes';
  if (action.value === 'disable') return 'disable';
  return status.value?.enabled ? 'switchFactor' : 'setup';
});
const pairExpiry = computed(() => new Intl.DateTimeFormat(
  currentLang.value === 'en' ? 'en-US' : currentLang.value === 'zh-TW' ? 'zh-TW' : 'zh-CN',
  { hour: '2-digit', minute: '2-digit' },
).format(new Date(pair.value.expiresAt)));

async function load() {
  if (!props.active) return;
  reading?.abort();
  reading = new AbortController();
  const { signal } = reading;
  const identity = auth.identityRevision;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await api.get(endpoint, { signal });
    if (!signal.aborted && auth.identityRevision === identity) status.value = result;
  } catch (failure) {
    if (!signal.aborted && auth.identityRevision === identity) loadError.value = verificationError(failure);
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function clear() {
  password.value = '';
  code.value = '';
  action.value = '';
  pair.value = null;
  codes.value = [];
  error.value = '';
  feedback.value = '';
}

async function open(operation) {
  clear();
  action.value = operation;
  requireProof.value = status.value.currentCodeRequired;
  dialog.value.showModal();
  await nextTick();
  passwordInput.value?.focus();
}

function cancel(event) {
  if (busy.value) event.preventDefault();
}

async function submit(operation) {
  if (busy.value) return;
  const identity = auth.identityRevision;
  const payload = operation === 'enable' ? { enrollmentId: pair.value.enrollmentId, code: code.value } :
    { password: password.value, ...(requireProof.value ? { code: code.value } : {}) };
  request = new AbortController();
  const { signal } = request;
  busy.value = true;
  feedback.value = '';
  error.value = '';
  notice.value = '';
  try {
    const result = await api.post(endpoint + '/' + operation, payload, { signal });
    if (signal.aborted || auth.identityRevision !== identity) return;
    if (result.session && !auth.acceptVerifiedSession(result.session, identity)) return;
    password.value = '';
    code.value = '';
    if (operation === 'begin') {
      pair.value = result;
    } else if (operation === 'disable') {
      notice.value = 'disabled';
      dialog.value.close();
      void load();
    } else {
      pair.value = null;
      codes.value = result.recoveryCodes;
      notice.value = operation === 'enable' ? 'updated' : 'codesReplaced';
      void load();
    }
    await nextTick();
    if (dialog.value?.open) heading.value?.focus();
  } catch (failure) {
    if (signal.aborted || auth.identityRevision !== identity) return;
    error.value = verificationError(failure);
    if (operation !== 'enable' && failure.code === 2013) requireProof.value = true;
    if (operation === 'enable' && failure.status === 409) {
      pair.value = null;
      code.value = '';
      void load();
    }
  } finally {
    busy.value = false;
  }
}

async function copy(value) {
  const identity = auth.identityRevision;
  try {
    await navigator.clipboard.writeText(value);
    if (dialog.value?.open && auth.identityRevision === identity) feedback.value = 'copied';
  } catch {
    if (dialog.value?.open && auth.identityRevision === identity) feedback.value = 'copyUnavailable';
  }
}

function download() {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob(['QGauss AI\n\n' + codes.value.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
  link.href = url;
  link.download = 'QGauss-recovery-codes.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

watch(() => [props.active, auth.identityRevision], ([active], previous) => {
  if (previous && previous[1] !== auth.identityRevision) {
    request?.abort();
    dialog.value?.close();
    clear();
    status.value = null;
    notice.value = '';
  }
  if (active) void load();
  else reading?.abort();
}, { immediate: true });
onBeforeUnmount(() => { reading?.abort(); request?.abort(); clear(); });
</script>
