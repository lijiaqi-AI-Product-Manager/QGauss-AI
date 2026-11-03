<template>
  <div class="login-page qgd-auth-page" :class="`auth-${appearance.variant}`">
    <AmbientScene />
    <header class="qgd-auth-header"><router-link to="/chat"><img src="/brand/qgauss-mark.svg" alt="" /><b>QGauss AI</b></router-link><div><LanguagePicker/><router-link to="/chat" class="qgl-explore" :aria-label="t('entry.explore')" :title="t('entry.explore')"><span>{{ t('entry.explore') }}</span><ClientIcon name="arrowUpRight" /></router-link></div></header>
    <main class="qgd-auth-main"><section class="qgd-auth-story"><span class="qgd-kicker">A LITTLE IDEA. A WHOLE NEW WORLD.</span><h1>{{ t('entry.storyFirst') }}<br /><mark>{{ t('entry.storySecond') }}</mark></h1><p>{{ t('entry.story') }}</p><HeroSculpture :variant="appearance.variant" /><span class="qgd-auth-caption">QGAUSS AI / MADE FOR YOUR IMAGINATION</span></section><section class="qgd-auth-card" :aria-label="heading"><div class="qgd-auth-mini" aria-hidden="true"><img src="/art/qgauss-companion.png" alt="" /></div><span class="qgd-kicker">YOUR IDEAS BELONG HERE</span><h2>{{ heading }}<span>✦</span></h2><p class="qgd-auth-intro">{{ intro }}</p><p v-if="mode === 'login' && auth.sessionNotice" class="qac-login-notice" role="status">{{ t(auth.sessionNotice === 'password-changed' ? 'entry.passwordChanged' : 'entry.passwordUnknown') }}</p><AuthForm @sub-view-change="mode = $event" /><div class="qgd-auth-card-footer"><span>QGauss AI</span><span>{{ t('entry.footer') }}</span></div></section></main>
    <footer class="qgd-auth-footer">QGauss AI · YOUR SPACE TO CREATE</footer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import LanguagePicker from '../components/design/LanguagePicker.vue';
import AuthForm from '../components/auth/AuthForm.vue';
import AmbientScene from '../components/design/AmbientScene.vue';
import HeroSculpture from '../components/design/HeroSculpture.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import { useAppearance } from '../stores/appearance.js';
import { t } from '../i18n/index.js';
import { useAuth } from '../stores/auth.js';
import '../components/auth/controls.css';
import '../components/design/workbench-pages.css';
const appearance = useAppearance(), mode = ref('login'), auth = useAuth();
const heading = computed(() => t('entry.heading.'+mode.value));
const intro = computed(() => t('entry.intro.'+mode.value));
</script>
<style scoped>
.qac-login-notice{padding:12px 14px;border-radius:14px;background:var(--qd-soft);color:var(--qd-brand);font-size:12px;line-height:1.8;margin:16px 0;overflow-wrap:anywhere}
.qgd-auth-card :deep(.qg-auth-assist){gap:8px 16px;flex-wrap:wrap;align-items:center}
@media(max-width:600px){.qgd-auth-header{padding-inline:20px;gap:12px}.qgd-auth-header>a:first-child{white-space:nowrap;flex:none;gap:8px}.qgd-auth-header>a:first-child b{font-size:16px}.qgd-auth-header>div{gap:8px;min-width:0}.qgd-auth-header>div :deep(.qgl-picker),.qgd-auth-header>div :deep(.qgl-picker .qgl-select){max-width:110px}.qgd-auth-header>div :deep(.qgl-select){padding-left:8px;padding-right:20px}.qgd-auth-header .qgl-explore{display:grid;place-items:center;flex:none;min-width:44px;min-height:44px}.qgl-explore span{display:none}}
@media(max-width:380px){.qgd-auth-header>div :deep(.qgl-picker),.qgd-auth-header>div :deep(.qgl-picker .qgl-select){max-width:90px}}
</style>
