<template>
  <section class="qgc-empty qgd-home" :class="`home-${appearance.variant}`" :aria-label="t('home.start')">
    <div class="qgd-home-topline"><span class="qgd-kicker">QGAUSS AI <i></i> YOUR CREATIVE SPACE</span><button type="button" class="qgd-home-edition" @click="appearance.open = true">{{ appearance.design.letter }} / {{ t(`appearance.${appearance.variant}.label`) }} <ClientIcon name="palette" /></button></div>
    <div class="qgd-home-hero" :class="`hero-${appearance.variant}`">
      <div class="qgd-home-copy"><span class="qgd-small-note">{{ t('home.hello', {name:nickname, greeting:copy.greeting}) }} <span>✦</span></span><h1 :aria-label="t('home.title')">{{ copy.line }}<br />{{ copy.second }}<mark>{{ copy.highlight }}</mark></h1><p>{{ copy.description }}</p><span v-if="appearance.variant === 'studio'" class="qgd-hand-note">{{ t('home.handNote') }} <svg viewBox="0 0 65 30"><path d="M2 4q40-8 53 17m-15-6 16 8 4-14" /></svg></span><span v-if="appearance.variant === 'orbit'" class="qgd-orbit-tag"><i></i>YOUR NEXT UNIVERSE</span></div>
      <HeroSculpture :variant="appearance.variant" />
      <span v-if="appearance.variant === 'play'" class="qgd-play-stamp" aria-hidden="true">100%<small>{{ t('home.imagination') }}</small></span><div v-if="appearance.variant === 'orbit'" class="qgd-orbit-coordinate" aria-hidden="true">IDEA / 001<br /><span>∞ POSSIBILITIES</span></div>
    </div>
    <form class="qgd-start-composer" @submit.prevent="start"><div class="qgd-start-input"><span class="qgd-composer-gem"><ClientIcon name="spark" /></span><textarea v-model="draft" rows="1" maxlength="12000" :aria-label="t('home.input')" :placeholder="t('home.placeholder')" @keydown.enter.exact="onEnter"></textarea><button type="submit" class="qgc-empty-new" :aria-label="t('home.start')"><span>{{ t('home.start') }}</span><ClientIcon name="arrow" /></button></div><div class="qgd-start-foot"><span><i></i>{{ modelNote }}</span><span class="qgd-home-voice-shortcut"><button type="button" :aria-label="t('conversation.voice')" @click="$emit('voice',draft)"><ClientIcon name="microphone" /><span>{{ t('home.voice') }}</span></button><span>{{ t('home.enter') }} <kbd>↵</kbd></span></span></div></form>
    <div class="qgd-home-tools"><button v-for="tool in tools" :key="tool.kind" type="button" class="qgd-idea-card" :class="`idea-${tool.kind}`" @click="activate(tool)"><span class="qgd-idea-icon"><ClientIcon :name="tool.icon" /></span><span class="qgd-idea-copy"><small>{{ tool.eyebrow }}</small><b>{{ tool.title }}</b><span>{{ tool.description }}</span></span><span class="qgd-idea-arrow"><ClientIcon name="arrowUpRight" /></span></button></div>
    <div class="qgd-home-bottom"><div class="qgd-home-recent"><div class="qgd-section-heading"><h2>{{ t(recent.length ? 'home.recent' : 'home.suggestions') }}</h2><span>{{ t(recent.length ? 'home.recentHint' : 'home.suggestionsHint') }}</span></div><div v-if="recent.length" class="qgd-recent-list"><button v-for="item in recent.slice(0, 3)" :key="item.id" type="button" @click="$emit('open', item.id)"><ClientIcon name="chat" /><span>{{ item.title }}</span><ClientIcon name="arrowUpRight" /></button></div><div v-else class="qgd-prompt-pills"><button v-for="prompt in prompts" :key="prompt" type="button" @click="$emit('start', prompt)">{{ prompt }} <ClientIcon name="plus" /></button></div></div><button type="button" class="qgd-inspiration-note" @click="surprise"><span>{{ t('home.surprise') }}</span><b>{{ t('home.drawIdea') }}</b><ClientIcon name="shuffle" /></button></div>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../../stores/auth.js';
import { useAppearance } from '../../stores/appearance.js';
import { t } from '../../i18n/index.js';
import HeroSculpture from './HeroSculpture.vue';
import ClientIcon from '../reference/ClientIcon.vue';
const props = defineProps({ models: { type: Array, default: () => [] }, recent: { type: Array, default: () => [] } });
const emit = defineEmits(['start', 'open', 'voice']);
const router = useRouter(), auth = useAuth(), appearance = useAppearance(), draft = ref(''), surpriseIndex = ref(0);
const nickname = computed(() => auth.user?.displayName || auth.user?.username || t('home.friend'));
const copy = computed(() => Object.fromEntries(['greeting', 'line', 'second', 'highlight', 'description'].map(key => [key, t(`home.${appearance.variant}.${key}`)])));
const modelNote = computed(() => auth.isLoggedIn ? props.models.some(model => model.ready) ? t('home.modelsReady', {count:props.models.filter(model => model.ready).length}) : t('home.chooseModel') : t('home.signIn'));
const tools = computed(() => [
  { title: t('home.write.title'), eyebrow: 'WORDS TO WONDER', description: t('home.write.description'), icon: 'write', kind: 'write', prompt: t('home.write.prompt') },
  { title: t('home.image.title'), eyebrow: 'PICTURE THE POSSIBLE', description: t('home.image.description'), icon: 'image', kind: 'image', path: '/painting' },
  { title: t('home.apps.title'), eyebrow: 'A LITTLE HELP, A LOT MORE', description: t('home.apps.description'), icon: 'apps', kind: 'apps', path: '/apps' },
]);
const prompts = computed(() => [0, 1, 2].map(index => t(`home.prompt.${index}`)));
function start() { emit('start', draft.value.trim()); }
function onEnter(event) { if (event.isComposing || event.keyCode === 229) return; event.preventDefault(); start(); }
function activate(tool) { if (tool.path) router.push(tool.path); else emit('start', tool.prompt); }
function surprise() { draft.value = t(`home.surprise.${surpriseIndex.value++ % 3}`); }
</script>
<style scoped>.qgd-start-foot>.qgd-home-voice-shortcut{display:flex;align-items:center;gap:13px}.qgd-home-voice-shortcut button{display:inline-flex;align-items:center;gap:4px;background:transparent;border:0;color:var(--qg-sub);font:inherit;font-size:10px;padding:1px;cursor:pointer;white-space:nowrap}.qgd-home-voice-shortcut button:hover{color:var(--qg-brand)}.qgd-home-voice-shortcut button svg{width:13px;height:13px}.qgd-home-voice-shortcut button:focus-visible{outline:2px solid var(--qg-brand);outline-offset:4px;border-radius:4px}@media(max-width:640px){.qgd-home-voice-shortcut>span{display:none}.qgd-home-voice-shortcut button{font-size:9px;min-height:26px}}</style>
