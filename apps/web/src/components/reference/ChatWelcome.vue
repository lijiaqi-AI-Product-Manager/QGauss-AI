<template>
  <div class="qgc-chat-welcome" :class="{ 'is-near-input': nearInput, 'is-collapsed': hideHeading }">
    <div class="qgd-chat-companion" aria-hidden="true"><img src="/art/qgauss-companion.png" alt="" width="1280" height="1280" /></div>
    <div v-if="!hideHeading" class="qgc-chat-greeting"><h1 :aria-label="headline"><span v-if="reducedMotion || !appearance.motion || appName">{{ headline }}</span><QGaussTypedText v-else aria-hidden="true" :text="headline" :type-speed="80" :back-speed="50" :delay="0" :back-delay="2000" :show-cursor="true" :loop="true" cursor-style="default" :center-expand="true" /></h1></div>
    <p v-if="!hideHint">{{ hint }}</p>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { currentLang } from '../../i18n/index.js';
import QGaussTypedText from './QGaussTypedText.js';
import './typed-text.css';
import { useAppearance } from '../../stores/appearance.js';
const appearance = useAppearance();
const props = defineProps({ appName: String, hideHint: Boolean, hideHeading: Boolean, nearInput: Boolean });
const media = window.matchMedia('(prefers-reduced-motion:reduce)');
const reducedMotion = ref(media.matches);
function update(event) { reducedMotion.value = event.matches; }
media.addEventListener('change', update);
onBeforeUnmount(() => media.removeEventListener('change', update));
const headline = computed(() => {
  if (props.appName) return props.appName;
  const hour = new Date().getHours(), index = hour < 5 ? 0 : hour < 12 ? 1 : hour < 14 ? 2 : hour < 18 ? 3 : 4;
  const greeting = currentLang.value === 'en' ? ['Good late night', 'Good morning', 'Good noon', 'Good afternoon', 'Good evening'][index] : ['深夜好', '早上好', '中午好', '下午好', '晚上好'][index];
  return currentLang.value === 'en' ? `${greeting}, how can I help you?` : currentLang.value === 'zh-TW' ? `${greeting}，有什麼可以幫您？` : `${greeting}，有什么可以帮您？`;
});
const hint = computed(() => currentLang.value === 'en' ? 'As your AI assistant, I can help with knowledge, math, coding, writing, brainstorming, and more.' : currentLang.value === 'zh-TW' ? '作為您的智慧小搭檔，我既能聊知識、解數學題、寫程式碼、寫文案、還能想點子陪您聊天，為您解惑答疑' : '作为您的智能小搭档，我既能聊知识、解数学题、写代码、写文案、还能想点子陪您聊天，为您解惑答疑');
</script>
