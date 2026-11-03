<template>
  <div class="qgd-sculpture" :class="[`sculpture-${variant}`, { 'is-delighted': delighted }]" :style="{ '--pointer-x': `${x}deg`, '--pointer-y': `${y}deg` }" @pointermove="move" @pointerleave="reset">
    <div class="qgd-sculpture-halo"></div><span class="qgd-sculpture-orbit ring-one"></span><span class="qgd-sculpture-orbit ring-two"></span>
    <button type="button" class="qgd-sculpture-object" :aria-label="variant === 'play' ? t('sculpture.activate') : t('sculpture.greet')" @click="greet"><img :src="variant === 'play' ? '/art/qgauss-play-sculpture.png' : '/art/qgauss-companion.png'" :alt="variant === 'play' ? t('sculpture.playAlt') : t('sculpture.alt')" width="1254" height="1254" fetchpriority="high" /></button>
    <span class="qgd-sculpture-sticker qgd-liquid"><i></i>{{ delighted ? t('sculpture.delighted') : variant === 'orbit' ? t('sculpture.orbit') : t('sculpture.idea') }}</span>
    <span class="qgd-sculpture-star s1" aria-hidden="true">✦</span><span class="qgd-sculpture-star s2" aria-hidden="true">✧</span><span class="qgd-sculpture-glass" aria-hidden="true"></span>
  </div>
</template>
<script setup>
import {t} from '../../i18n/index.js';
import { onBeforeUnmount, ref } from 'vue';
import { useAppearance } from '../../stores/appearance.js';
defineProps({ variant: { type: String, default: 'studio' } });
const appearance = useAppearance(), x = ref(0), y = ref(0), delighted = ref(false);
let timer;
function move(event) { if (!appearance.motion || event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion:reduce)').matches) return; const box = event.currentTarget.getBoundingClientRect(); x.value = (event.clientX - box.x - box.width / 2) / box.width * 10; y.value = (box.height / 2 - event.clientY + box.y) / box.height * 8; }
function reset() { x.value = y.value = 0; }
function greet() { delighted.value = true; clearTimeout(timer); timer = setTimeout(() => { delighted.value = false; }, 2400); }
onBeforeUnmount(() => clearTimeout(timer));
</script>
