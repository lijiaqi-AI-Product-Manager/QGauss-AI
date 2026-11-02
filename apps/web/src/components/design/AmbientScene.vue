<template><div class="qgd-ambient" :class="`activity-${chatActivity}`" aria-hidden="true"><i></i><i></i><i></i><span class="qgd-ambient-grid"></span><span class="qgd-ambient-orbit o1"></span><span class="qgd-ambient-orbit o2"></span><span class="qgd-grain"></span></div></template>
<script setup>
import { useUi } from '../../stores/ui.js';
const { chatActivity } = useUi();
</script>
