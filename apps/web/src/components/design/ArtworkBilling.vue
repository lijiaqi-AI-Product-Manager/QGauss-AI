<template>
  <section class="qp-billing" aria-label="作品费用" :data-state="billing.state">
    <header><span class="qp-billing-coin" aria-hidden="true">Q</span><div><small>这一次创作的费用</small><strong>{{ title }}</strong></div></header>
    <template v-if="billing.state !== 'LEGACY'">
      <dl><div><dt>锁定单价</dt><dd>{{ billing.unitCost || 0 }}<small> 次 / 张</small></dd></div><div><dt>实际结算</dt><dd>{{ billing.charged || 0 }}<small> 次</small></dd></div></dl>
      <p v-if="billing.reserved">已预留 {{ billing.reserved }} 次，按实际成功张数结算。</p>
      <p v-else-if="billing.returned">未使用的 {{ billing.returned }} 次已释放回可用额度。</p>
      <p v-else-if="billing.state === 'FREE'">提交时为免费创作，本次不会补扣次数。</p>
      <p v-if="billing.expired">{{ billing.expired }} 次未使用的会员预留已失效，不计入新一天或新套餐。</p>
    </template>
    <p v-else>这件作品来自此前版本，费用以钱包中的实际流水为准。</p>
  </section>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ billing: { type: Object, required: true } });
const title = computed(() => ({ LEGACY: '历史费用记录', FREE: '本次不扣次数', RESERVED: '次数已预留', SETTLED: '本次已结算', RELEASED: '未扣次数，预留已结束' }[props.billing.state] || '费用记录'));
</script>

<style scoped>
.qp-billing{position:relative;margin:20px 0;padding:17px;border:1px solid var(--qd-line);border-radius:17px;background:radial-gradient(ellipse at 95% 0%,color-mix(in srgb,var(--qd-brand) 12%,transparent),transparent 70%),color-mix(in srgb,var(--qd-soft) 35%,var(--qd-card));overflow:hidden}
.qp-billing header{display:flex;align-items:center;gap:11px}.qp-billing header>div{display:grid;gap:4px}.qp-billing header small{font-size:9px;color:var(--qd-muted)}.qp-billing strong{font-size:12px;font-weight:550;letter-spacing:.01em}.qp-billing-coin{display:grid;place-items:center;width:33px;height:33px;flex:none;border-radius:50%;color:var(--qd-brand);font-size:15px;font-weight:700;background:linear-gradient(140deg,var(--qd-card),var(--qd-soft));border:1px solid var(--qd-edge);box-shadow:inset -3px -3px 5px color-mix(in srgb,var(--qd-brand) 12%,transparent),2px 3px 0 color-mix(in srgb,var(--qd-brand) 18%,transparent);transform:rotate(-12deg)}
.qp-billing dl{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:17px 0 0;padding:13px 0 0;border-top:1px solid var(--qd-line)}.qp-billing dt{font-size:9px;color:var(--qd-muted);margin-bottom:4px}.qp-billing dd{margin:0;font:600 20px var(--qg-mono);color:var(--qd-ink)}.qp-billing dd small{font:9px var(--qg-font);color:var(--qd-muted)}.qp-billing p{margin:12px 0 0;font-size:10px;line-height:1.85;color:var(--qd-muted);overflow-wrap:anywhere}
@media(max-width:760px){.qp-billing{padding:17px;margin:20px 0}.qp-billing p{font-size:11px}.qp-billing strong{font-size:13px}.qp-billing header small,.qp-billing dt{font-size:10px}}
</style>
