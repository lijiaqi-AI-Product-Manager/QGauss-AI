<template>
  <section class="qp-billing" :aria-label="pt(&quot;作品费用&quot;)" :data-state="receipt.state">
    <header><span class="qp-billing-coin" aria-hidden="true">Q</span><div><small>{{ pt("这一次创作的费用") }}</small><strong>{{ receipt.title }}</strong></div></header>
    <dl v-if="receipt.known"><div><dt>{{ pt("锁定单价") }}</dt><dd>{{ receipt.unitCost }}<small>{{ pt(" 次 / 张",{count:receipt.unitCost}) }}</small></dd></div><div><dt>{{ pt("实际结算") }}</dt><dd>{{ receipt.charged }}<small>{{ pt(" 次",{count:receipt.charged}) }}</small></dd></div></dl>
    <p v-for="(note,index) in receipt.notes" :key="index">{{ note }}</p>
  </section>
</template>

<script setup>
import {paintingText as pt} from "../../i18n/painting.js";
import { computed } from 'vue';
import {paintingReceipt} from '../../lib/painting-presentation.js';
const props = defineProps({ billing: { type: Object, required: true } });
const receipt=computed(()=>paintingReceipt(props.billing,pt));
</script>

<style scoped>
.qp-billing{position:relative;margin:20px 0;padding:17px;border:1px solid var(--qd-line);border-radius:17px;background:radial-gradient(ellipse at 95% 0%,color-mix(in srgb,var(--qd-brand) 12%,transparent),transparent 70%),color-mix(in srgb,var(--qd-soft) 35%,var(--qd-card));overflow:hidden}
.qp-billing header{display:flex;align-items:center;gap:11px}.qp-billing header>div{display:grid;gap:4px}.qp-billing header small{font-size:9px;color:var(--qd-muted)}.qp-billing strong{font-size:12px;font-weight:550;letter-spacing:.01em}.qp-billing-coin{display:grid;place-items:center;width:33px;height:33px;flex:none;border-radius:50%;color:var(--qd-brand);font-size:15px;font-weight:700;background:linear-gradient(140deg,var(--qd-card),var(--qd-soft));border:1px solid var(--qd-edge);box-shadow:inset -3px -3px 5px color-mix(in srgb,var(--qd-brand) 12%,transparent),2px 3px 0 color-mix(in srgb,var(--qd-brand) 18%,transparent);transform:rotate(-12deg)}
.qp-billing dl{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:17px 0 0;padding:13px 0 0;border-top:1px solid var(--qd-line)}.qp-billing dt{font-size:9px;color:var(--qd-muted);margin-bottom:4px}.qp-billing dd{margin:0;font:600 20px var(--qg-mono);color:var(--qd-ink)}.qp-billing dd small{font:9px var(--qg-font);color:var(--qd-muted)}.qp-billing p{margin:12px 0 0;font-size:10px;line-height:1.85;color:var(--qd-muted);overflow-wrap:anywhere}
@media(max-width:760px){.qp-billing{padding:17px;margin:20px 0}.qp-billing p{font-size:11px}.qp-billing strong{font-size:13px}.qp-billing header small,.qp-billing dt{font-size:10px}}
</style>
