<template>
  <span
    class="qbot"
    :class="[`is-${mood}`, { 'is-still': still }]"
    :style="{ '--s': `${size}px` }"
    role="img"
    :aria-label="LABELS[mood]"
  >
    <span class="qbot-shine"></span>
    <span class="qbot-eyes">
      <i class="qbot-eye"></i>
      <i class="qbot-eye"></i>
    </span>
    <span v-if="mood === 'happy' || mood === 'idle'" class="qbot-cheeks"><i></i><i></i></span>
    <span v-if="mood === 'sleep'" class="qbot-z">z</span>
  </span>
</template>

<script setup>
/**
 * QGauss 的 AI 形象：渐变圆角方块（黏土质感）+ 两只白色胶囊眼睛，只靠眼睛表达情绪。
 *   idle     眨眼、偶尔张望（待机）
 *   thinking 眼睛左右快速张望（思考 / 加载）
 *   happy    眯眼笑（回答完成、成功）
 *   sleep    闭眼 + z（空状态、离线）
 * 动效小幅度循环、弹簧曲线；开启「减弱动态效果」时全部静止。
 */
defineProps({
  mood: { type: String, default: 'idle' },
  size: { type: Number, default: 32 },
  /** 列表里的历史头像不需要动 */
  still: { type: Boolean, default: false },
});

const LABELS = { idle: 'QGauss 助手', thinking: 'QGauss 助手正在思考', happy: 'QGauss 助手', sleep: 'QGauss 助手在休息' };
</script>

<style scoped>
.qbot {
  --s: 32px;
  position: relative;
  flex: none;
  display: inline-block;
  width: var(--s);
  height: var(--s);
  border-radius: 32%;
  background:
    radial-gradient(70% 55% at 30% 22%, rgba(255, 255, 255, 0.55), transparent 60%),
    linear-gradient(140deg, #6f8dff 0%, #8673f2 48%, #b56cf0 100%);
  box-shadow:
    inset 0 calc(var(--s) * 0.05) calc(var(--s) * 0.12) rgba(255, 255, 255, 0.45),
    inset 0 calc(var(--s) * -0.08) calc(var(--s) * 0.14) rgba(60, 30, 160, 0.38),
    0 calc(var(--s) * 0.18) calc(var(--s) * 0.36) calc(var(--s) * -0.14) rgba(103, 60, 233, 0.55);
}
.qbot-shine {
  position: absolute;
  top: 9%;
  left: 15%;
  width: 26%;
  height: 12%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.6);
  filter: blur(calc(var(--s) * 0.015));
  transform: rotate(-18deg);
}
.qbot-eyes {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15%;
  padding-top: 4%;
}
.qbot-eye {
  display: block;
  width: 14%;
  height: 32%;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 0 calc(var(--s) * 0.06) rgba(255, 255, 255, 0.7);
  transform-origin: 50% 60%;
}
.qbot-cheeks {
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 20%;
  display: flex;
  justify-content: space-between;
}
.qbot-cheeks i {
  width: 16%;
  height: calc(var(--s) * 0.07);
  border-radius: 50%;
  background: rgba(255, 150, 190, 0.7);
  filter: blur(calc(var(--s) * 0.01));
}
.qbot-z {
  position: absolute;
  top: -18%;
  right: -12%;
  font-family: var(--qg-font-num);
  font-weight: 800;
  font-size: calc(var(--s) * 0.32);
  color: var(--qg-brand);
  animation: qbot-z 2.4s ease-in-out infinite;
}

/* idle：眨眼 + 偶尔张望 */
.is-idle .qbot-eyes {
  animation: qbot-look 6s var(--qg-ease-spring) infinite;
}
.is-idle .qbot-eye {
  animation: qbot-blink 3.6s ease-in-out infinite;
}

/* thinking：眼睛变小、左右快速张望，身体轻轻起伏 */
.is-thinking {
  animation: qbot-bob 1.2s ease-in-out infinite;
}
.is-thinking .qbot-eye {
  height: 24%;
}
.is-thinking .qbot-eyes {
  animation: qbot-scan 1.2s var(--qg-ease-spring) infinite;
}

/* happy：眯眼笑（∩ ∩） */
.is-happy .qbot-eye {
  height: 14%;
  width: 18%;
  background: transparent;
  border: calc(var(--s) * 0.06) solid #fff;
  border-bottom: 0;
  border-radius: 999px 999px 0 0;
  box-shadow: none;
}
.is-happy {
  animation: qbot-hop 1.6s var(--qg-ease-spring) infinite;
}

/* sleep：闭眼 */
.is-sleep .qbot-eye {
  height: 6%;
  width: 18%;
}
.is-sleep {
  filter: saturate(0.85);
}

.is-still,
.is-still .qbot-eyes,
.is-still .qbot-eye {
  animation: none !important;
}

@keyframes qbot-blink {
  0%,
  44%,
  50%,
  100% {
    transform: scaleY(1);
  }
  47% {
    transform: scaleY(0.12);
  }
}
@keyframes qbot-look {
  0%,
  30%,
  100% {
    transform: translateX(0);
  }
  38%,
  52% {
    transform: translateX(8%);
  }
  60%,
  72% {
    transform: translateX(-6%);
  }
}
@keyframes qbot-scan {
  0%,
  100% {
    transform: translate(-9%, -4%);
  }
  50% {
    transform: translate(9%, -4%);
  }
}
@keyframes qbot-bob {
  50% {
    transform: translateY(-6%) scale(1.03, 0.97);
  }
}
@keyframes qbot-hop {
  0%,
  70%,
  100% {
    transform: translateY(0);
  }
  80% {
    transform: translateY(-10%) scale(0.98, 1.03);
  }
}
@keyframes qbot-z {
  0% {
    opacity: 0;
    transform: translate(0, 20%) scale(0.7);
  }
  40% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(30%, -60%) scale(1.1);
  }
}
</style>
