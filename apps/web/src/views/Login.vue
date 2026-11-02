<template>
  <div class="login-page qgd-auth-page" :class="`auth-${appearance.variant}`">
    <AmbientScene />
    <header class="qgd-auth-header"><router-link to="/chat"><img src="/brand/qgauss-mark.svg" alt="" /><b>QGauss AI</b></router-link><div><label><span class="qgd-sr-only">界面语言</span><select :value="currentLang" aria-label="界面语言" @change="setLang($event.target.value)"><option value="zh">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option></select></label><router-link to="/chat">{{ currentLang === 'en' ? 'Explore QGauss' : '先逛逛' }} <ClientIcon name="arrowUpRight" /></router-link></div></header>
    <main class="qgd-auth-main"><section class="qgd-auth-story"><span class="qgd-kicker">A LITTLE IDEA. A WHOLE NEW WORLD.</span><h1>{{ currentLang === 'en' ? 'A little spark.' : '一点灵感，' }}<br /><mark>{{ currentLang === 'en' ? 'A lot of possibility.' : '很多种可能。' }}</mark></h1><p>{{ currentLang === 'en' ? 'Make room for your next good idea. Your creative partner is here.' : '给好点子一个发光的地方。你的创作搭档，就在这里。' }}</p><HeroSculpture :variant="appearance.variant" /><span class="qgd-auth-caption">QGAUSS AI / MADE FOR YOUR IMAGINATION</span></section><section class="qgd-auth-card" :aria-label="heading"><div class="qgd-auth-mini" aria-hidden="true"><img src="/art/qgauss-companion.png" alt="" /></div><span class="qgd-kicker">YOUR IDEAS BELONG HERE</span><h2>{{ heading }}<span>✦</span></h2><p class="qgd-auth-intro">{{ intro }}</p><p v-if="mode === 'login' && auth.sessionNotice" class="qac-login-notice" role="status">{{ auth.sessionNotice === 'password-changed' ? '密码已更新，请使用新密码重新登录。' : '密码修改结果尚未确认。请先尝试使用新密码登录；如果无法登录，再试原密码或重新申请重置。' }}</p><AuthForm @sub-view-change="mode = $event" /><div class="qgd-auth-card-footer"><span>QGauss AI</span><span>每个小想法，都值得发光。</span></div></section></main>
    <footer class="qgd-auth-footer">QGauss AI · YOUR SPACE TO CREATE</footer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import AuthForm from '../components/auth/AuthForm.vue';
import AmbientScene from '../components/design/AmbientScene.vue';
import HeroSculpture from '../components/design/HeroSculpture.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import { useAppearance } from '../stores/appearance.js';
import { currentLang, setLang } from '../i18n/index.js';
import { useAuth } from '../stores/auth.js';
import '../components/auth/controls.css';
import '../components/design/workbench-pages.css';
const appearance = useAppearance(), mode = ref('login'), auth = useAuth();
const heading = computed(() => currentLang.value === 'en' ? mode.value === 'register' ? 'A fresh start.' : mode.value === 'forget' ? 'Find your way back.' : 'Welcome back.' : mode.value === 'register' ? '新灵感，从你开始。' : mode.value === 'forget' ? '找回你的灵感空间。' : '欢迎回来。');
const intro = computed(() => currentLang.value === 'en' ? mode.value === 'forget' ? 'We will send a reset link to your email.' : 'Your next good idea is waiting for you.' : mode.value === 'forget' ? '输入注册邮箱，我们会把重置链接发给你。' : mode.value === 'register' ? '创建你的专属空间，让每个小想法都有机会发光。' : '登录你的专属空间，继续把想象变成作品。');
</script>
<style scoped>
.qac-login-notice{padding:12px 14px;border-radius:14px;background:var(--qd-soft);color:var(--qd-brand);font-size:12px;line-height:1.8;margin:16px 0;overflow-wrap:anywhere}
</style>
