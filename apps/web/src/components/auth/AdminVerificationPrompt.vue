<template>
  <form class="qav-prompt" @submit.prevent="verify">
    <label class="qav-field">
      <span>{{ vt(recovery ? 'recoveryCode' : 'factorCode') }}</span>
      <input ref="input" v-model.trim="code" required :maxlength="recovery ? 40 : 6" :pattern="recovery ? undefined : '[0-9]{6}'"
        :inputmode="recovery ? 'text' : 'numeric'" :autocomplete="recovery ? 'off' : 'one-time-code'"
        :disabled="busy" :aria-invalid="Boolean(error)" :aria-describedby="error ? 'qav-prompt-error' : undefined" />
    </label>
    <p v-if="error" id="qav-prompt-error" class="qav-error" role="alert">{{ vt(error) }}</p>
    <button type="submit" class="qav-action qav-primary" :disabled="busy">
      <ClientIcon :name="busy ? 'refresh' : 'lock'" :class="{ 'qav-spin': busy }" />{{ vt(busy ? 'working' : 'verify') }}
    </button>
    <div class="qav-prompt-options">
      <button type="button" class="qav-action" :disabled="busy" @click="toggleRecovery">{{ vt(recovery ? 'useFactor' : 'useRecovery') }}</button>
      <button type="button" class="qav-action" :disabled="busy" @click="signOut">{{ vt('signOut') }}</button>
    </div>
  </form>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';
import { adminVerificationDestination } from '../../lib/navigation-guard.js';
import { verificationError, verificationText as vt } from '../../i18n/admin-verification-messages.js';
import ClientIcon from '../reference/ClientIcon.vue';
import './admin-verification.css';

const auth = useAuth();
const route = useRoute();
const router = useRouter();
const recovery = ref(false);
const code = ref('');
const input = ref(null);
const error = ref('');
const busy = ref(false);
let request;

async function toggleRecovery() {
  recovery.value = !recovery.value;
  code.value = '';
  error.value = '';
  await nextTick();
  input.value?.focus();
}

async function verify() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  request = new AbortController();
  const { signal } = request;
  const identity = auth.identityRevision;
  try {
    const result = await api.post('/auth/admin-verification/verify', { code: code.value }, { signal });
    if (signal.aborted || !auth.acceptVerifiedSession(result.session, identity)) return;
    code.value = '';
    await router.replace(adminVerificationDestination(route.query.redirect));
  } catch (failure) {
    if (!signal.aborted) error.value = verificationError(failure);
  } finally {
    busy.value = false;
  }
}

async function signOut() {
  const redirect = adminVerificationDestination(route.query.redirect);
  void auth.logout();
  await router.replace({ name: 'login', query: { redirect } });
}

onMounted(() => input.value?.focus());
onBeforeUnmount(() => request?.abort());
</script>
