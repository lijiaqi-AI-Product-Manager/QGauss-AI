<template>
  <button class="qgd-appearance-launcher qgd-liquid" type="button" aria-label="打开外观实验室" @click="appearance.open = true"><ClientIcon name="palette" /><span>{{ appearance.design.letter }}<i></i>{{ appearance.design.label }}</span><ClientIcon name="chevronLeft" /></button>
  <dialog ref="dialog" class="qgd-appearance-dialog" aria-labelledby="qgd-appearance-title" @cancel.prevent="appearance.open = false" @click="backdrop">
    <header><div><span class="qgd-kicker">MAKE IT FEEL LIKE YOU</span><h2 id="qgd-appearance-title">给灵感，换一种心情。</h2><p>三种构图，同一个 QGauss。随时切换，继续创作。</p></div><button type="button" class="qgd-icon-button" aria-label="关闭外观实验室" @click="appearance.open = false"><ClientIcon name="close" /></button></header>
    <div class="qgd-design-options">
      <button v-for="design in DESIGN_VARIANTS" :key="design.id" type="button" class="qgd-design-option" :class="[{ selected: appearance.variant === design.id }, `preview-${design.id}`]" :aria-pressed="appearance.variant === design.id" @click="appearance.choose(design.id)">
        <div class="qgd-mini-ui" aria-hidden="true"><span class="mini-rail"></span><span class="mini-title"></span><span class="mini-orb"></span><span class="mini-card c1"></span><span class="mini-card c2"></span><span class="mini-input"></span><span class="mini-star">✦</span></div>
        <div class="qgd-design-option-copy"><span class="qgd-design-letter">{{ design.letter }}</span><div><b>{{ design.label }}</b><small>{{ design.english }}</small></div><ClientIcon v-if="appearance.variant === design.id" name="check" /></div><p>{{ design.description }}</p>
      </button>
    </div>
    <div class="qgd-appearance-settings"><label><span><b>让界面动起来</b><small>呼吸、漂浮、弹性切换。系统减弱动态设置优先。</small></span><input type="checkbox" role="switch" :checked="appearance.motion" aria-label="界面动效" @change="appearance.setMotion($event.target.checked)" /></label><label><span><b>玻璃的通透感</b><small>拖动调节，找到舒服的层次。</small></span><input type="range" min="55" max="95" :value="appearance.glass" aria-label="玻璃不透明度" @input="appearance.setGlass($event.target.value)" /></label></div>
    <footer><span><i></i>已保存在当前浏览器</span><button type="button" class="qgd-primary" @click="appearance.open = false">就用这个，继续创作 <ClientIcon name="arrow" /></button></footer>
  </dialog>
</template>
<script setup>
import { nextTick, ref, watch } from 'vue';
import { DESIGN_VARIANTS, useAppearance } from '../../stores/appearance.js';
import ClientIcon from '../reference/ClientIcon.vue';
const appearance = useAppearance(), dialog = ref(null);
watch(() => appearance.open, async open => { await nextTick(); if (!dialog.value || open !== appearance.open) return; if (open && !dialog.value.open) dialog.value.showModal(); else if (!open && dialog.value.open) dialog.value.close(); });
function backdrop(event) { if (event.target !== dialog.value) return; const rect = dialog.value.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) appearance.open = false; }
</script>
