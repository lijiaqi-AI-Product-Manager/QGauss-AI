<template>
 <div class="qgl-language" :class="{'qgl-compact':compact}">
  <label class="qgl-picker" :title="label"><ClientIcon name="language"/><span class="qgl-sr">{{ label }}</span><select class="qgl-select" :value="languageMode" :aria-label="t('language.label')" @change="setLang($event.target.value)"><option value="auto" :title="t('language.auto')">{{ t('language.autoOption') }} · {{ deviceName }}</option><option v-for="item in LANGUAGE_OPTIONS" :key="item.key" :value="item.key">{{ item.title }}</option></select><i v-if="languageMode==='auto'" class="qgl-device" aria-hidden="true"></i></label>
  <span v-if="!languageSaved" class="qgl-session" :title="t('language.session')"><span aria-hidden="true">{{ t('language.sessionShort') }}</span><span class="qgl-sr" role="status">{{ t('language.session') }}</span></span>
 </div>
</template>
<script setup>
import {computed} from 'vue';
import {currentLang,languageMode,languageSaved,deviceLang,setLang,t} from '../../i18n/index.js';
import {LANGUAGE_OPTIONS} from '../../i18n/language-preferences.js';
import ClientIcon from '../reference/ClientIcon.vue';
defineProps({compact:Boolean});
const deviceName=computed(()=>LANGUAGE_OPTIONS.find(item=>item.key===deviceLang.value)?.title||'简体中文');
const label=computed(()=>t('language.label')+' · '+(LANGUAGE_OPTIONS.find(item=>item.key===currentLang.value)?.title||'简体中文')+(languageMode.value==='auto'?' · '+t('language.auto'):''));
</script>
<style>
.qgl-language{position:relative;display:inline-flex;flex:none;align-items:center;vertical-align:middle;color:var(--qd-ink,var(--qg-text,#282635))}.qgl-picker{position:relative;display:flex;align-items:center;gap:8px;min-height:44px;max-width:235px;border:1px solid var(--qd-line,#dcd8e9);border-radius:15px;background:color-mix(in srgb,var(--qd-surface,#fff) 76%,transparent);box-shadow:inset 0 1px 0 #ffffff35;backdrop-filter:blur(18px);transition:background .18s,border-color .18s}.qgl-picker>svg{position:absolute;left:12px;pointer-events:none;width:17px;height:17px;z-index:1}.qgl-picker .qgl-select{display:block;color:inherit;border:0;background:transparent;min-height:44px;width:100%;max-width:235px;padding:9px 26px 9px 37px;border-radius:14px;font:inherit;font-size:12px;line-height:1.5;cursor:pointer;text-overflow:ellipsis;box-shadow:none}.qgl-picker .qgl-select:focus-visible{outline:3px solid var(--qd-accent,#b5a1ff);outline-offset:3px}.qgl-select option{color:var(--qd-ink,#282635);background:var(--qd-surface,#fff);font-size:14px}.qgl-device{position:absolute;left:24px;top:10px;width:5px;height:5px;border-radius:50%;background:var(--qd-accent,#b5a1ff);box-shadow:0 0 6px color-mix(in srgb,var(--qd-accent,#b5a1ff) 65%,transparent);pointer-events:none}.qgl-compact .qgl-picker{width:44px;max-width:44px;border-radius:14px}.qgl-compact .qgl-picker>svg{left:13px}.qgl-compact .qgl-select{width:44px;max-width:44px;padding:0;font-size:0;color:transparent;appearance:none}.qgl-compact .qgl-select option{font-size:14px}.qgl-compact .qgl-device{left:28px;top:9px}.qgl-session{position:absolute;right:0;top:calc(100% + 3px);font-size:9px;line-height:1.4;white-space:nowrap;padding:2px 6px;border-radius:5px;background:var(--qd-surface,#fff);color:var(--qd-muted,#777384);z-index:2}.qgl-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:600px){.qgl-language:not(.qgl-compact) .qgl-picker,.qgl-language:not(.qgl-compact) .qgl-select{max-width:145px}.qgl-language:not(.qgl-compact) .qgl-picker>svg{display:none}.qgl-language:not(.qgl-compact) .qgl-select{padding-left:10px;font-size:11px}.qgl-language:not(.qgl-compact) .qgl-device{display:none}}
@media(prefers-reduced-motion:reduce){.qgl-picker{transition:none}}
</style>
