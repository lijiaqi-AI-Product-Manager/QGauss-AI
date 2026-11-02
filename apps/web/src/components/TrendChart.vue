<template>
  <div>
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" style="width: 100%; height: 160px; display: block">
      <defs>
        <linearGradient id="qgTrend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--qg-brand)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--qg-brand)" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      <line v-for="t in ticks" :key="t" :x1="0" :y1="t" :x2="W" :y2="t" stroke="var(--qg-border)" stroke-width="1" />

      <polygon :points="areaPoints" fill="url(#qgTrend)" />
      <polyline :points="linePoints" fill="none" stroke="var(--qg-brand)" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>

    <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--qg-sub); margin-top: 6px">
      <span>{{ firstLabel }}</span>
      <span>峰值 {{ maxValue }}</span>
      <span>{{ lastLabel }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Array, default: () => [] },
  /** 取哪个字段画线 */
  field: { type: String, default: 'calls' },
});

const W = 600;
const H = 160;

const values = computed(() => props.data.map((d) => Number(d[props.field] ?? 0)));
const maxValue = computed(() => Math.max(1, ...values.value));

function x(index) {
  const n = Math.max(1, values.value.length - 1);
  return (index / n) * W;
}

function y(value) {
  return H - (value / maxValue.value) * (H - 12) - 6;
}

const linePoints = computed(() =>
  values.value.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
);

const areaPoints = computed(() => {
  if (values.value.length === 0) return '';
  return `0,${H} ${linePoints.value} ${W},${H}`;
});

const ticks = computed(() => [0.25, 0.5, 0.75].map((r) => (H * r).toFixed(1)));

const firstLabel = computed(() => props.data[0]?.date ?? '');
const lastLabel = computed(() => props.data[props.data.length - 1]?.date ?? '');
</script>
