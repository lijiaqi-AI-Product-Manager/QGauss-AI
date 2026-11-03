<template>
  <nav v-if="entries.length > 1" ref="root" class="qg-thread-outline" :aria-label="ct(&quot;对话目录&quot;)">
    <button ref="trigger" type="button" class="qg-icon-btn" :aria-label="ct(&quot;打开对话目录&quot;)" :title="ct(&quot;对话目录&quot;)" :aria-expanded="open" :aria-controls="panelId" @click="toggle">
      <span aria-hidden="true">≡</span><span class="qg-outline-count">{{ entries.length }}</span>
    </button>
    <section v-if="open" :id="panelId" class="qg-outline-panel" :aria-label="ct(&quot;本次对话的问题&quot;)">
      <header><span>{{ ct("这一路的想法") }}</span><small>{{ ct("{p0} 轮",{p0:(entries.length)}) }}</small><button type="button" :aria-label="ct(&quot;关闭对话目录&quot;)" @click="close(true)">×</button></header>
      <ol>
        <li v-for="(entry, index) in entries" :key="entry.index">
          <button type="button" :aria-current="active === entry.index ? 'location' : undefined" @click="navigate(entry)">
            <span class="qg-outline-number">{{ String(index + 1).padStart(2, '0') }}</span><span>{{ entry.label }}</span>
          </button>
        </li>
      </ol>
    </section>
  </nav>
</template>
<script setup>
import {chatText as ct} from "../i18n/chat.js";
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
const props = defineProps({ entries: { type: Array, default: () => [] }, scroller: { type: Object, default: null }, threadKey: { type: String, default: '' } });
const emit = defineEmits(['navigate']);
const root = ref(null), trigger = ref(null), open = ref(false), active = ref(null);
const panelId = 'qgauss-outline-' + useId();
let frame = null;
function close(focus = false) { open.value = false; if (focus) trigger.value?.focus(); }
async function toggle() { open.value = !open.value; if (open.value) { updateActive(); await nextTick(); root.value?.querySelector('ol button[aria-current],ol button')?.focus(); } }
function elementFor(index) { return [...(props.scroller?.querySelectorAll('[data-qg-turn]') || [])].find(node => node.getAttribute('data-qg-turn') === String(index)); }
function updateActive() {
  frame = null;
  if (!props.scroller) return;
  const top = props.scroller.getBoundingClientRect().top + 65;
  let current = props.entries[0]?.index;
  for (const entry of props.entries) if (elementFor(entry.index)?.getBoundingClientRect().top <= top) current = entry.index;
  active.value = current;
}
function onScroll() { if (open.value && frame === null) frame = requestAnimationFrame(updateActive); }
function navigate(entry) {
  const target = elementFor(entry.index), container = props.scroller;
  if (!target || !container) return;
  emit('navigate');
  const top = Math.max(0, container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 20);
  const quiet = document.documentElement.dataset.qgMotion === 'quiet' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (container.scrollTo) container.scrollTo({ top, behavior: quiet ? 'auto' : 'smooth' }); else container.scrollTop = top;
  active.value = entry.index; close(); target.focus({ preventScroll: true });
}
function outside(event) { if (open.value && !root.value?.contains(event.target)) close(); }
function escape(event) {
  if (open.value && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
}
watch(() => props.scroller, (element, previous) => { previous?.removeEventListener('scroll', onScroll); element?.addEventListener('scroll', onScroll, { passive: true }); }, { immediate: true });
watch(() => props.threadKey, () => close());
watch(() => props.entries.length, length => { if (length < 2) close(); });
onMounted(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true); });
onBeforeUnmount(() => {
  props.scroller?.removeEventListener('scroll', onScroll);
  document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true);
  if (frame !== null) cancelAnimationFrame(frame);
});
</script>
<style>
.qg-thread-outline { position: relative; }
.qg-thread-outline > button { position: relative; font-size: 23px; }
.qg-outline-count { position: absolute; right: 0; top: 0; min-width: 12px; padding: 0 2px; border-radius: 5px; color: var(--qg-brand); background: var(--qg-brand-soft); font: 600 9px/1.4 system-ui; }
.qg-outline-panel { position: absolute; right: 0; top: calc(100% + 10px); z-index: 45; width: min(310px,calc(100vw - 32px)); border: 1px solid var(--qg-border); border-radius: 20px; background: var(--qg-panel); box-shadow: var(--qg-shadow-lg); overflow: hidden; }
.qg-outline-panel header { display: flex; align-items: center; gap: 10px; padding: 16px 16px 10px; font-size: 13px; font-weight: 650; }
.qg-outline-panel header small { margin-right: auto; color: var(--qg-sub); font-weight: 400; }
.qg-outline-panel header button { border: 0; border-radius: 8px; width: 28px; height: 28px; color: var(--qg-sub); background: var(--qg-panel-2); cursor: pointer; font-size: 19px; }
.qg-outline-panel ol { display: grid; grid-template-columns: minmax(0,1fr); gap: 4px; max-height: min(430px,60vh); padding: 5px 8px 12px; margin: 0; overflow: auto; list-style: none; }
.qg-outline-panel li { min-width: 0; }
.qg-outline-panel li button { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 12px; border: 0; border-radius: 12px; background: transparent; color: var(--qg-text); text-align: left; cursor: pointer; font-size: 12px; line-height: 1.6; }
.qg-outline-panel li button:hover,.qg-outline-panel li button[aria-current] { background: var(--qg-brand-soft); }
.qg-outline-panel li button span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qg-outline-number { color: var(--qg-brand); font: 600 11px/1.9 monospace; }
.qg-outline-panel button:focus-visible { outline: 2px solid var(--qg-brand); outline-offset: -2px; }
</style>
