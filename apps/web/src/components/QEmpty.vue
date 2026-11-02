<template>
  <div class="qempty" :class="{ compact }">
    <div class="qempty-stage">
      <span class="qempty-pedestal"></span>
      <QBot class="qempty-bot" :mood="mood" :size="compact ? 52 : 76" />
      <QStar class="qempty-star s1" :size="compact ? 12 : 18" />
      <QStar class="qempty-star s2" :size="compact ? 9 : 12" :delay="700" />
    </div>
    <p class="qempty-title">{{ title }}</p>
    <p v-if="desc" class="qempty-desc">{{ desc }}</p>
    <div v-if="$slots.default" class="qempty-action"><slot /></div>
  </div>
</template>

<script setup>
/** 空状态：情绪角色 + 一句口语文案 + 一个胶囊按钮，不用灰色插图 */
import QBot from './QBot.vue';
import QStar from './QStar.vue';

defineProps({
  title: { type: String, default: '这里空空的~' },
  desc: { type: String, default: '' },
  mood: { type: String, default: 'sleep' },
  compact: { type: Boolean, default: false },
});
</script>

<style scoped>
.qempty {
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 36px 16px;
}
.qempty.compact {
  padding: 18px 10px;
}
.qempty-stage {
  position: relative;
  width: 120px;
  height: 104px;
  display: grid;
  place-items: center;
}
.compact .qempty-stage {
  width: 90px;
  height: 76px;
}
.qempty-bot {
  animation: qg-float 3.2s ease-in-out infinite;
}
/* 展示台：底部一片品牌色接触阴影 */
.qempty-pedestal {
  position: absolute;
  bottom: 6px;
  width: 64%;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(134, 115, 242, 0.35), transparent);
}
.qempty-star {
  position: absolute;
}
.s1 {
  top: 6px;
  right: 14px;
}
.s2 {
  bottom: 30px;
  left: 14px;
}
.qempty-title {
  margin: 10px 0 0;
  font-weight: 700;
  font-size: 15px;
  color: var(--qg-text);
}
.compact .qempty-title {
  font-size: 13px;
}
.qempty-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--qg-sub);
  max-width: 320px;
}
.qempty-action {
  margin-top: 14px;
}
</style>
