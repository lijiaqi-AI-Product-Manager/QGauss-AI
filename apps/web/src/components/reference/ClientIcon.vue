<template><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(path, index) in paths" :key="index" :d="path" /></svg></template>
<script setup>
import { computed } from 'vue';
const props = defineProps({ name: String });
const icons = {
  video: ['M3 5h18v14H3zM3 9h18M7 5l3 4M14 5l3 4M10 12l5 3-5 3z'],
  microphone:['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'],
  sound:['M4 9h4l5-4v14l-5-4H4V9ZM17 9a5 5 0 0 1 0 6M20 6a9 9 0 0 1 0 12'],
  lock: ['M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3M12 14v3'],
  agent: ['M7 7h10a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4ZM12 3v4M9 12h.01M15 12h.01M9 16h6M1 12v3M23 12v3'],
  mail: ['M3 5h18v14H3zM3 5l9 7 9-7'],
  globe: ['M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z'],
  download: ['M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'],
  copy: ['M8 8h13v13H8zM16 8V3H3v13h5'],
  refresh: ['M20 7v5h-5M4 17v-5h5M19 11a7 7 0 0 0-12-5L4 9M5 13a7 7 0 0 0 12 5l3-3'],
  menu: ['M4 5h16M4 12h16M4 19h16'], close: ['m6 6 12 12M18 6 6 18'],
  layout: ['M4 4h16v16H4zM10 4v16'], chat: ['M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0Z', 'M8 11h.01M12 11h.01M16 11h.01'],
  apps: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  image: ['M3 3h18v18H3zM3 16l5-5 4 4 3-3 6 6', 'M8 7h.01'],
  model: ['m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'],
  language: ['M3 5h12M9 3v2c0 6-3 9-6 11m2-8c1 4 4 7 8 9m1 4 4-10 4 10m-6-4h4'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'],
  moon: ['M20 15.5A8.8 8.8 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z'],
  plus: ['M12 4v16M4 12h16'], search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm5.5 13 5 5'],
  chevronLeft: ['m15 5-7 7 7 7'], chevronRight: ['m9 5 7 7-7 7'], check: ['m5 12 4 4L19 6'],
  reasoning: ['M9 3a4 4 0 0 0-4 4v1a4 4 0 0 0 0 8v1a4 4 0 0 0 7 2 4 4 0 0 0 7-2v-1a4 4 0 0 0 0-8V7a4 4 0 0 0-7-3M12 4v15M5 8h3M5 16h3M19 8h-3M19 16h-3'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'], arrowUpRight: ['M6 18 18 6M6 6h12v12'],
  palette: ['M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 5-5c0-3-4-5-9-5Z', 'M7 9h.01M9 6h.01M14 6h.01M17 9h.01'],
  write: ['m14 4 6 6M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z'],
  file: ['M6 3h8l4 4v14H6V3ZM14 3v5h5M9 12h6M9 16h6'],
  spark: ['m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z'],
  shuffle: ['M3 5h3l12 14h3m-4-4 4 4-4 3M3 19h3L18 5h3m-4-3 4 3-4 4'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7h.01'],
  user: ['M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a8 8 0 0 1 16 0v2'],
  wallet: ['M3 6h17v15H3V6Zm0 0 14-3v3M16 12h5v5h-5z'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM8 3h8l1 4 4 1v8l-4 1-1 4H8l-1-4-4-1V8l4-1 1-4Z'],
};
const paths = computed(() => icons[props.name] || icons.apps);
</script>
