<template>
  <div class="qloader" role="status">
    <BrandLoader :size="size" :text="text" />
  </div>
</template>

<script setup>
/** 加载：用品牌角色「思考」而不是系统菊花；背后一团呼吸的品牌光 */
import BrandLoader from './design/BrandLoader.vue';

defineProps({
  text: { type: String, default: '马上就好…' },
  size: { type: Number, default: 44 },
});
</script>

<style scoped>
.qloader {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 0;
}
.qloader-glow {
  position: absolute;
  top: 12px;
  width: 110px;
  height: 80px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(134, 115, 242, 0.35), transparent);
  animation: qloader-breathe 1.8s ease-in-out infinite;
}
.qloader-text {
  position: relative;
  font-size: 13px;
  color: var(--qg-sub);
}
@keyframes qloader-breathe {
  50% {
    transform: scale(1.18);
    opacity: 0.6;
  }
}
</style>
