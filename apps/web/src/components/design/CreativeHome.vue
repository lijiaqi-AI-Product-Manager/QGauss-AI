<template>
  <section class="qgc-empty qgd-home" :class="`home-${appearance.variant}`" aria-label="开始对话">
    <div class="qgd-home-topline"><span class="qgd-kicker">QGAUSS AI <i></i> YOUR CREATIVE SPACE</span><button type="button" class="qgd-home-edition" @click="appearance.open = true">{{ appearance.design.letter }} / {{ appearance.design.label }} <ClientIcon name="palette" /></button></div>
    <div class="qgd-home-hero" :class="`hero-${appearance.variant}`">
      <div class="qgd-home-copy"><span class="qgd-small-note">嗨，{{ nickname }}，{{ copy.greeting }} <span>✦</span></span><h1 aria-label="QGauss AI 灵感工作台">{{ copy.line }}<br />{{ copy.second }}<mark>{{ copy.highlight }}</mark></h1><p>{{ copy.description }}</p><span v-if="appearance.variant === 'studio'" class="qgd-hand-note">好点子，从这里开始 <svg viewBox="0 0 65 30"><path d="M2 4q40-8 53 17m-15-6 16 8 4-14" /></svg></span><span v-if="appearance.variant === 'orbit'" class="qgd-orbit-tag"><i></i>YOUR NEXT UNIVERSE</span></div>
      <HeroSculpture :variant="appearance.variant" />
      <span v-if="appearance.variant === 'play'" class="qgd-play-stamp" aria-hidden="true">100%<small>你的想象力</small></span><div v-if="appearance.variant === 'orbit'" class="qgd-orbit-coordinate" aria-hidden="true">IDEA / 001<br /><span>∞ POSSIBILITIES</span></div>
    </div>
    <form class="qgd-start-composer" @submit.prevent="start"><div class="qgd-start-input"><span class="qgd-composer-gem"><ClientIcon name="spark" /></span><textarea v-model="draft" rows="1" maxlength="12000" aria-label="灵感输入框" placeholder="把脑海里的小想法，说给 QGauss 听…" @keydown.enter.exact="onEnter"></textarea><button type="submit" class="qgc-empty-new" aria-label="开始对话"><span>开始对话</span><ClientIcon name="arrow" /></button></div><div class="qgd-start-foot"><span><i></i>{{ modelNote }}</span><span class="qgd-home-voice-shortcut"><button type="button" aria-label="语音输入与音色" @click="$emit('voice',draft)"><ClientIcon name="microphone" /><span>用声音开始</span></button><span>Enter 开始 <kbd>↵</kbd></span></span></div></form>
    <div class="qgd-home-tools"><button v-for="tool in tools" :key="tool.title" type="button" class="qgd-idea-card" :class="`idea-${tool.kind}`" @click="activate(tool)"><span class="qgd-idea-icon"><ClientIcon :name="tool.icon" /></span><span class="qgd-idea-copy"><small>{{ tool.eyebrow }}</small><b>{{ tool.title }}</b><span>{{ tool.description }}</span></span><span class="qgd-idea-arrow"><ClientIcon name="arrowUpRight" /></span></button></div>
    <div class="qgd-home-bottom"><div class="qgd-home-recent"><div class="qgd-section-heading"><h2>{{ recent.length ? '继续上次的灵感' : '今天，先从一个小想法开始' }}</h2><span>{{ recent.length ? '接着聊，不用从头来' : '一点提示，帮你打开思路' }}</span></div><div v-if="recent.length" class="qgd-recent-list"><button v-for="item in recent.slice(0, 3)" :key="item.id" type="button" @click="$emit('open', item.id)"><ClientIcon name="chat" /><span>{{ item.title }}</span><ClientIcon name="arrowUpRight" /></button></div><div v-else class="qgd-prompt-pills"><button v-for="prompt in prompts" :key="prompt" type="button" @click="$emit('start', prompt)">{{ prompt }} <ClientIcon name="plus" /></button></div></div><button type="button" class="qgd-inspiration-note" @click="surprise"><span>给灵感一点偶然</span><b>抽一张灵感签 ↗</b><ClientIcon name="shuffle" /></button></div>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../../stores/auth.js';
import { useAppearance } from '../../stores/appearance.js';
import HeroSculpture from './HeroSculpture.vue';
import ClientIcon from '../reference/ClientIcon.vue';
const props = defineProps({ models: { type: Array, default: () => [] }, recent: { type: Array, default: () => [] } });
const emit = defineEmits(['start', 'open', 'voice']);
const router = useRouter(), auth = useAuth(), appearance = useAppearance(), draft = ref(''), surpriseIndex = ref(0);
const nickname = computed(() => auth.user?.displayName || auth.user?.username || '新朋友');
const copies = {
  studio: { greeting: '灵感搭子已就位', line: '让灵感，', second: '多一点', highlight: '可能。', description: '一个小念头，一段好文字，一幅新画面。和 QGauss 一起，把「想到」变成「做到」。' },
  play: { greeting: '今天也来点不一样', line: '好点子，', second: '现在就', highlight: '开玩。', description: '写点什么，画点什么，打开一个新脑洞。这里是你的想象力游乐场。' },
  orbit: { greeting: '灵感信号已连接', line: '下一个宇宙，', second: '从你的', highlight: '想象开始。', description: '让思绪自由漂浮，让每一个念头找到轨道。' },
};
const copy = computed(() => copies[appearance.variant]);
const modelNote = computed(() => auth.isLoggedIn ? props.models.some(model => model.ready) ? `${props.models.filter(model => model.ready).length} 个模型待命 · 选择合适的搭档` : '先来选一个合适的模型搭档' : '登录后开启你的灵感空间');
const tools = [
  { title: '写出好故事', eyebrow: 'WORDS TO WONDER', description: '文案、故事、表达，都有新思路', icon: 'write', kind: 'write', prompt: '我想写一段有感染力的文案，请先问我目标读者、用途和想传达的感受。' },
  { title: '画出想象力', eyebrow: 'PICTURE THE POSSIBLE', description: '把脑海里的画面，变成看得见', icon: 'image', kind: 'image', path: '/painting' },
  { title: '遇见灵感搭档', eyebrow: 'A LITTLE HELP, A LOT MORE', description: '挑个专长不同的 AI 应用', icon: 'apps', kind: 'apps', path: '/apps' },
];
const prompts = ['帮我把一个模糊的想法变成行动计划', '把复杂知识讲得像朋友聊天', '一起想一个有趣的创作主题'];
const surprises = ['用三个意想不到的词，帮我发想一个短篇故事。', '给我一个十分钟就能开始的创意小挑战。', '帮我从完全不同的角度，重新思考一个日常问题。'];
function start() { emit('start', draft.value.trim()); }
function onEnter(event) { if (event.isComposing || event.keyCode === 229) return; event.preventDefault(); start(); }
function activate(tool) { if (tool.path) router.push(tool.path); else emit('start', tool.prompt); }
function surprise() { draft.value = surprises[surpriseIndex.value++ % surprises.length]; }
</script>
<style scoped>.qgd-start-foot>.qgd-home-voice-shortcut{display:flex;align-items:center;gap:13px}.qgd-home-voice-shortcut button{display:inline-flex;align-items:center;gap:4px;background:transparent;border:0;color:var(--qg-sub);font:inherit;font-size:10px;padding:1px;cursor:pointer;white-space:nowrap}.qgd-home-voice-shortcut button:hover{color:var(--qg-brand)}.qgd-home-voice-shortcut button svg{width:13px;height:13px}.qgd-home-voice-shortcut button:focus-visible{outline:2px solid var(--qg-brand);outline-offset:4px;border-radius:4px}@media(max-width:640px){.qgd-home-voice-shortcut>span{display:none}.qgd-home-voice-shortcut button{font-size:9px;min-height:26px}}</style>
