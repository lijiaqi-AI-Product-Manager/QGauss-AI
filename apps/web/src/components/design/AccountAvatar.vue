<template>
  <span class="qac-avatar" :class="'qac-avatar-' + choice.tone" :style="{ '--qac-avatar-size': size + 'px' }" :role="decorative ? undefined : 'img'" :aria-label="decorative ? undefined : choice.name" :aria-hidden="decorative ? 'true' : undefined"><span class="qac-avatar-face"><i></i><i></i><b></b></span><span class="qac-avatar-glint"></span></span>
</template>
<script setup>
import { computed } from 'vue';
import { accountAvatar } from '../../lib/account-profile.js';
const props = defineProps({ value: String, size: { type: Number, default: 48 }, decorative: Boolean });
const choice = computed(() => accountAvatar(props.value));
</script>
<style scoped>
.qac-avatar{--qac-avatar-light:#bdacff;--qac-avatar-dark:#7550db;position:relative;display:inline-grid;place-items:center;flex:0 0 auto;isolation:isolate;width:var(--qac-avatar-size);height:var(--qac-avatar-size);border-radius:32%;background:radial-gradient(circle at 24% 18%,#fff9,transparent 45%),linear-gradient(145deg,var(--qac-avatar-light),var(--qac-avatar-dark));box-shadow:inset 2px 3px 4px #fff7,inset -3px -4px 5px #25203d29,0 8px 14px -7px var(--qac-avatar-dark);transform:rotate(-5deg)}
.qac-avatar-lime{--qac-avatar-light:#e1f9a0;--qac-avatar-dark:#719e32}.qac-avatar-coral{--qac-avatar-light:#ffc7b0;--qac-avatar-dark:#e4778d}.qac-avatar-orbit{--qac-avatar-light:#93cbef;--qac-avatar-dark:#6656b5}
.qac-avatar-face{position:relative;display:flex;justify-content:center;gap:14%;width:70%;height:48%;padding-top:8%;border-radius:40%;background:#ffffff24;box-shadow:inset 0 0 1px #fff7}.qac-avatar-face i{width:13%;height:54%;border-radius:99px;background:#fff;box-shadow:0 1px 3px #38365830}.qac-avatar-face b{position:absolute;bottom:13%;left:40%;width:20%;height:17%;border-radius:0 0 99px 99px;background:#fff9}.qac-avatar-glint{position:absolute;left:14%;top:13%;width:24%;height:8%;border-radius:99px;background:#ffffff70;transform:rotate(-24deg)}
</style>
