<template>
  <CreativeHome :models="models" :recent="recent" @start="$emit('start', $event)" @open="$emit('open', $event)" @voice="$emit('voice',$event)" />
</template>
<script setup>
import CreativeHome from '../design/CreativeHome.vue';
defineProps({ models: Array, recent: Array });
defineEmits(['start', 'open', 'voice']);
</script>
