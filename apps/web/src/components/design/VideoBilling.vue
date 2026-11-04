<template>
  <section class="qv-bill-card" :aria-label="vt('视频费用')" :data-state="receipt.state">
    <header><span aria-hidden="true">Q</span><div><small>{{ vt('这一次创作的费用') }}</small><strong>{{ receipt.title }}</strong></div></header>
    <dl v-if="receipt.known" class="qv-bill">
      <div v-if="receipt.active"><dt>{{ vt('已预留') }}</dt><dd>{{ receipt.reserved }} <small>{{ units(receipt.reserved) }}</small></dd></div>
      <div><dt>{{ vt('本次结算') }}</dt><dd>{{ receipt.charged }} <small>{{ units(receipt.charged) }}</small></dd></div>
      <div v-if="receipt.returned"><dt>{{ vt('已释放') }}</dt><dd>{{ receipt.returned }} <small>{{ units(receipt.returned) }}</small></dd></div>
      <div v-if="receipt.expired"><dt>{{ vt('已过期权益') }}</dt><dd>{{ receipt.expired }} <small>{{ units(receipt.expired) }}</small></dd></div>
    </dl>
    <p v-for="(note,index) in receipt.notes" :key="index">{{ note }}</p>
  </section>
</template>
<script setup>
import {computed} from 'vue';
import {videoText as vt} from '../../i18n/video.js';
import {videoPoolLabel,videoReceipt} from '../../lib/video-presentation.js';
const props=defineProps({billing:{type:Object,default:null}}),receipt=computed(()=>videoReceipt(props.billing,vt));
const units=amount=>videoPoolLabel(receipt.value.pool,amount,vt);
</script>
<style scoped>
.qv-bill-card{min-width:0;margin:18px 0;padding:18px;border:1px solid var(--qd-edge);border-radius:20px;background:radial-gradient(ellipse at top right,color-mix(in srgb,var(--qd-brand) 15%,transparent),transparent 75%),var(--qd-glass)}
.qv-bill-card header{display:flex;align-items:center;gap:11px}.qv-bill-card header>span{display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:50%;color:var(--qd-brand);border:1px solid var(--qd-edge);background:linear-gradient(135deg,var(--qd-card),var(--qd-soft));box-shadow:3px 4px 0 color-mix(in srgb,var(--qd-brand) 15%,transparent);transform:rotate(-12deg);font-weight:700}.qv-bill-card header>div{display:grid;gap:5px}.qv-bill-card header small,.qv-bill-card dt{font-size:10px;color:var(--qd-muted)}.qv-bill-card strong{font-size:13px}.qv-bill-card .qv-bill{margin:16px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:15px}.qv-bill-card dd{margin:6px 0 0;font-size:21px;color:var(--qd-ink)}.qv-bill-card dd small{font-size:10px}.qv-bill-card p{margin:12px 0 0;font-size:11px;line-height:1.8;color:var(--qd-muted);overflow-wrap:anywhere}
@media(max-width:650px){.qv-bill-card{padding:15px}.qv-bill-card .qv-bill{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
