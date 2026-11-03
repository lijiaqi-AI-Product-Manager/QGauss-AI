<template>
  <button class="qgd-appearance-launcher qgd-liquid" type="button" :aria-label="t('appearance.open')" @click="appearance.open = true"><ClientIcon name="palette" /><span>{{ appearance.design.letter }}<i></i>{{ t('appearance.'+appearance.variant+'.label') }}</span><ClientIcon name="chevronLeft" /></button>
  <dialog ref="dialog" class="qgd-appearance-dialog" aria-labelledby="qgd-appearance-title" @cancel.prevent="appearance.open = false" @click="backdrop">
    <header><div><span class="qgd-kicker">MAKE IT FEEL LIKE YOU</span><h2 id="qgd-appearance-title">{{ t('appearance.title') }}</h2><p>{{ t('appearance.description') }}</p></div><button type="button" class="qgd-icon-button" :aria-label="t('appearance.close')" @click="appearance.open = false"><ClientIcon name="close" /></button></header>
    <div class="qgd-design-options">
      <button v-for="design in DESIGN_VARIANTS" :key="design.id" type="button" class="qgd-design-option" :class="[{ selected: appearance.variant === design.id }, `preview-${design.id}`]" :aria-pressed="appearance.variant === design.id" @click="appearance.choose(design.id)">
        <div class="qgd-mini-ui" aria-hidden="true"><span class="mini-rail"></span><span class="mini-title"></span><span class="mini-orb"></span><span class="mini-card c1"></span><span class="mini-card c2"></span><span class="mini-input"></span><span class="mini-star">✦</span></div>
        <div class="qgd-design-option-copy"><span class="qgd-design-letter">{{ design.letter }}</span><div><b>{{ t('appearance.'+design.id+'.label') }}</b><small>{{ design.english }}</small></div><ClientIcon v-if="appearance.variant === design.id" name="check" /></div><p>{{ t('appearance.'+design.id+'.description') }}</p>
      </button>
    </div>
    <div class="qgd-appearance-settings"><label><span><b>{{ t('appearance.motion') }}</b><small>{{ t('appearance.motionDescription') }}</small></span><input type="checkbox" role="switch" :checked="appearance.motion" :aria-label="t('appearance.motionLabel')" @change="appearance.setMotion($event.target.checked)" /></label><label><span><b>{{ t('appearance.glass') }}</b><small>{{ t('appearance.glassDescription') }}</small></span><input type="range" min="55" max="95" :value="appearance.glass" :aria-label="t('appearance.glassLabel')" @input="appearance.setGlass($event.target.value)" /></label></div>
    <footer><span><i></i>{{ appearance.saveFailed ? t('appearance.session') : appearance.saved ? t('language.saved') : t('appearance.choose') }}</span><button type="button" class="qgd-primary" @click="appearance.open = false">{{ t('appearance.continue') }} <ClientIcon name="arrow" /></button></footer>
  </dialog>
</template>
<script setup>
import {t} from '../../i18n/index.js';
import { nextTick, ref, watch } from 'vue';
import { DESIGN_VARIANTS, useAppearance } from '../../stores/appearance.js';
import ClientIcon from '../reference/ClientIcon.vue';
const appearance = useAppearance(), dialog = ref(null);
watch(() => appearance.open, async open => { await nextTick(); if (!dialog.value || open !== appearance.open) return; if (open && !dialog.value.open) dialog.value.showModal(); else if (!open && dialog.value.open) dialog.value.close(); });
function backdrop(event) { if (event.target !== dialog.value) return; const rect = dialog.value.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) appearance.open = false; }
</script>
