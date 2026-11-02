<template>
  <svg
    class="qstar"
    :class="{ twinkle }"
    :style="{ width: `${size}px`, height: `${size}px`, animationDelay: `${delay}ms` }"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFF1A6" />
        <stop offset="0.45" stop-color="#FFD23F" />
        <stop offset="1" stop-color="#FFA51F" />
      </linearGradient>
    </defs>
    <path
      d="M12 0.8c.9 6.2 4.9 10.2 11.2 11.2-6.3 1-10.3 5-11.2 11.2C11 16.9 7 12.9.8 12 7 11 11 7 12 .8z"
      :fill="`url(#${gid})`"
    />
    <path d="M12 3.6c.5 3.5 2 5.3 4.4 6.4-2.9-.3-4-1.8-4.4-6.4z" fill="#fff" opacity="0.7" />
  </svg>
</template>

<script setup>
/** 黄色四角星 ✦：素材里出现频率最高的点缀，配 3D 物件、标题和空状态使用 */
defineProps({
  size: { type: Number, default: 16 },
  twinkle: { type: Boolean, default: true },
  delay: { type: Number, default: 0 },
});

const gid = `qstar-${Math.random().toString(36).slice(2, 8)}`;
</script>

<style scoped>
.qstar {
  display: inline-block;
  flex: none;
  filter: drop-shadow(0 3px 6px rgba(255, 165, 31, 0.35));
}
.qstar.twinkle {
  animation: qg-twinkle 2.4s ease-in-out infinite;
}
</style>
