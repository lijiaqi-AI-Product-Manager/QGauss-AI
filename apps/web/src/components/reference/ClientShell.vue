<template>
  <div class="qg-client-shell" :class="{ 'is-floating': floating && appearance.variant !== 'play', 'is-feature-page': !isChat, 'is-immersive': immersive && isChat, 'drawer-open': clientNavigationOpen }">
    <AmbientScene />
    <nav class="qgd-primary-navigation" :class="{ 'qgd-liquid': appearance.variant === 'orbit' }" aria-label="主导航"><router-link class="qgd-rail-logo" to="/chat" aria-label="QGauss AI 首页"><img src="/brand/qgauss-mark.svg" alt="" /><b>QGauss</b></router-link><div :class="{ 'qgd-liquid': appearance.variant === 'play' }"><router-link v-for="item in navigation" :key="item.path" :to="item.path" :aria-current="navActive(item.path) ? 'page' : undefined" :title="item.title"><span><ClientIcon :name="item.icon" /></span><b>{{ item.title }}</b></router-link></div><button type="button" aria-label="外观实验室" @click="appearance.open = true"><ClientIcon name="palette" /></button></nav>
    <button v-if="clientNavigationOpen" class="qgc-drawer-mask" type="button" aria-label="关闭导航" @click="clientNavigationOpen = false"></button>
    <aside ref="sidebarElement" class="qgc-sidebar" aria-label="QGauss AI 导航" :inert="mobile && !clientNavigationOpen" :aria-hidden="mobile && !clientNavigationOpen ? 'true' : undefined">
      <router-link class="qgc-brand" to="/chat" aria-label="QGauss AI"><img src="/brand/qgauss-mark.svg" alt="" /><span><b>QGauss AI</b><small>把想象，变成可能。</small></span></router-link>
      <nav v-if="favoriteNavigation.length" class="qgc-pinned-nav" aria-label="快捷菜单"><router-link v-for="item in favoriteNavigation" :key="item.path" :to="item.path" :title="item.title"><ClientIcon :name="item.icon" /><span>{{ item.title }}</span></router-link></nav>
      <div v-if="isChat" id="qg-chat-history" class="qgc-history"></div>
      <nav v-else class="qgc-nav" aria-label="功能导航"><router-link v-for="item in navigation" :key="item.path" :to="item.path" :class="{ active: navActive(item.path) }"><ClientIcon :name="item.icon" /><span>{{ item.title }}</span></router-link></nav>
      <footer class="qgc-side-footer">
        <button type="button" @click="dialog = 'navigation'"><ClientIcon name="plus" /><span>添加菜单</span></button>
        <button type="button" @click="dialog = 'about'"><ClientIcon name="info" /><span>关于我们</span></button>
      </footer>
    </aside>
    <header class="qgc-header" :inert="mobile && clientNavigationOpen">
      <div class="qgc-header-left">
        <button ref="layoutButton" class="qgc-layout-toggle" type="button" :aria-label="mobile ? '打开导航' : '切换会话侧栏'" :aria-expanded="mobile ? clientNavigationOpen : undefined" @click="toggleLayout"><img v-if="mobile" src="/brand/qgauss-mark.svg" alt="" /><ClientIcon v-else name="layout" /></button>
        <div ref="navPopupRoot" class="qgc-page-nav">
          <button class="qgc-page-title" type="button" :aria-expanded="menu === 'navigation'" @click="toggleMenu('navigation')">{{ pageTitle }}</button>
          <nav v-if="menu === 'navigation'" class="qgc-popover qgc-nav-popover" aria-label="切换功能"><router-link v-for="item in navigation" :key="item.path" :to="item.path" @click="menu = ''"><ClientIcon :name="item.icon" />{{ item.title }}</router-link></nav>
        </div>
      </div>
      <div ref="toolsRoot" class="qgc-header-actions">
        <router-link v-if="balance.enabled" class="qgc-credit" to="/wallet" :title="balanceTooltip"><ClientIcon name="wallet" /><span>我的额度</span></router-link>
        <div class="qgc-notice-wrap"><button class="qgc-glass-action" type="button" aria-label="系统公告" @click="dialog = 'notice'"><ClientIcon name="bell" /></button><span v-if="announcement" class="qgc-notice-badge">新</span></div>
        <div class="qgc-tool-popover"><button class="qgc-glass-action" type="button" :aria-label="languageLabel" :aria-expanded="menu === 'language'" @click="toggleMenu('language')"><ClientIcon name="language" /></button><div v-if="menu === 'language'" class="qgc-popover"><button v-for="language in languages" :key="language.key" type="button" :aria-current="currentLang === language.key ? 'true' : undefined" @click="setLanguage(language.key)">{{ language.title }} <span v-if="currentLang === language.key">✓</span></button></div></div>
        <button class="qgc-glass-action" type="button" aria-label="主题" @click="toggleTheme"><ClientIcon :name="isDark ? 'moon' : 'sun'" /></button>
        <div v-if="auth.isLoggedIn" class="qgc-tool-popover"><button class="qgc-user" type="button" aria-label="账户菜单" :aria-expanded="menu === 'account'" @click="toggleMenu('account')"><AccountAvatar :value="auth.user.avatar" :size="30" decorative /></button><div v-if="menu === 'account'" class="qgc-popover"><p>{{ auth.user.displayName || auth.user.username }}</p><router-link to="/account" @click="menu = ''">个人空间</router-link><router-link to="/voice" @click="menu = ''">声音收藏室</router-link><router-link v-if="auth.isAdmin" to="/mail" @click="menu = ''">邮件投递台</router-link><router-link v-if="auth.isAdmin" to="/welcome" @click="menu = ''">启航清单</router-link><router-link v-if="auth.isAdmin" to="/statistic" @click="menu = ''">管理后台</router-link><router-link v-if="commerceEnabled" to="/wallet" @click="menu = ''">我的钱包</router-link><button type="button" @click="$emit('logout')">退出登录</button></div></div>
        <router-link v-else class="qgc-login" :to="{ path: '/login', query: { redirect: route.fullPath } }">{{ currentLang === 'en' ? 'Log in' : '登录' }}</router-link>
      </div>
    </header>
    <main class="qgc-content" :inert="mobile && clientNavigationOpen"><slot /></main>
    <nav v-if="mobile" class="qgc-mobile-nav qgd-liquid" aria-label="移动导航" :inert="clientNavigationOpen"><router-link v-for="item in navigation.filter(item => item.path !== '/statistic')" :key="item.path" :to="item.path" :aria-current="navActive(item.path) ? 'page' : undefined"><ClientIcon :name="item.icon" /><span>{{ item.title }}</span></router-link></nav>
    <dialog ref="dialogElement" class="qgc-dialog" :aria-label="dialogTitle" @cancel.prevent="dialog = ''">
      <div class="qgc-dialog-heading"><h2>{{ dialogTitle }}</h2><button type="button" aria-label="关闭" @click="dialog = ''"><ClientIcon name="close" /></button></div>
      <template v-if="dialog === 'notice'"><p class="qgc-notice-content">{{ siteConfig['site.announcement'] || '暂无公告' }}</p></template>
      <template v-else-if="dialog === 'about'"><img class="qgc-about-mark" src="/brand/qgauss-mark.svg" alt="" /><h3>QGauss AI</h3><p>多模型 AI 创作平台</p><div class="qgc-agreements"><a href="/agreement/userAgreement.html" target="_blank" rel="noopener">用户协议</a><a href="/agreement/privacyAgreement.html" target="_blank" rel="noopener">隐私政策</a></div></template>
      <div v-else-if="dialog === 'navigation'" class="qgc-dialog-nav"><label v-for="item in navigation" :key="item.path"><input type="checkbox" :checked="favorites.includes(item.path)" @change="toggleFavorite(item.path)" /><ClientIcon :name="item.icon" /><span>{{ item.title }}</span></label></div>
      <button class="qgc-dialog-close" type="button" @click="dialog = ''">关闭</button>
    </dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../../stores/auth.js';
import { useUi } from '../../stores/ui.js';
import { useTheme } from '../../stores/theme.js';
import { currentLang, setLang } from '../../i18n/index.js';
import ClientIcon from './ClientIcon.vue';
import AmbientScene from '../design/AmbientScene.vue';
import AccountAvatar from '../design/AccountAvatar.vue';
import { useAppearance } from '../../stores/appearance.js';
import '../design/workbench-shell.css';
const props = defineProps({ menus: { type: Array, default: () => [] }, siteConfig: { type: Object, default: () => ({}) }, announcement: String, commerceEnabled: Boolean, balance: { type: Object, default: () => ({ enabled: false }) }, balanceTooltip: String, title: String });
const emit = defineEmits(['logout', 'dismiss-announcement']);
const route = useRoute(), router = useRouter(), auth = useAuth();
const appearance = useAppearance();
const { immersive, clientNavigationOpen, clientChatTitle } = useUi();
const { isDark, toggle: toggleTheme } = useTheme();
const media = window.matchMedia('(max-width:639px)'), mobile = ref(media.matches);
function updateMobile(event) { mobile.value = event.matches; clientNavigationOpen.value = false; }
const floating = ref(false), menu = ref(''), dialog = ref(''), dialogElement = ref(null), toolsRoot = ref(null), navPopupRoot = ref(null), sidebarElement = ref(null), layoutButton = ref(null);
const favorites = ref([]);
try { floating.value = localStorage.getItem('qg:client-layout') === 'floating'; } catch { /* 只影响布局偏好保存 */ }
try { const saved = JSON.parse(localStorage.getItem('qg:client-favorites') || '[]'); if (Array.isArray(saved)) favorites.value = saved.filter((path) => typeof path === 'string'); } catch { /* 无效偏好使用空列表 */ }
const isChat = computed(() => route.name === 'chat');
function navActive(path){if(path==='/agent')return ['agents','agentDetail'].includes(route.name)||route.path==='/agent/chat';if(path==='/chat')return isChat.value&&route.path!=='/agent/chat';return route.path===path;}
const pageTitle = computed(() => isChat.value ? clientChatTitle.value || (currentLang.value === 'en' ? 'Chat' : '对话聊天') : route.meta.title || props.title || 'QGauss AI');
const languages = [{ key: 'zh', title: '简体中文' }, { key: 'zh-TW', title: '繁體中文' }, { key: 'en', title: 'English' }];
const languageLabel = computed(() => languages.find((item) => item.key === currentLang.value)?.title || '简体中文');
const navigation = computed(() => {
  const base = [{ path: '/chat', title: '对话聊天', icon: 'chat' }, { path: '/apps', title: '应用广场', icon: 'apps' }, { path: '/agent', title: '行动搭档', icon: 'agent' }, { path: '/painting', title: '智能绘画', icon: 'image' }, { path: '/market', title: '创意广场', icon: 'gallery' }, { path: '/video', title: '视频创作', icon: 'video' }, { path: '/plaza', title: '模型广场', icon: 'model' }];
  const paths = new Set(base.map((item) => item.path));
  function include(rows) {
    for (const row of rows) {
      if (row.children?.length) include(row.children);
      if (!row.path || paths.has(row.path)) continue;
      const match = router.resolve(row.path);
      if (!match.name || match.meta.admin) continue;
      paths.add(row.path); base.push({ path: row.path, title: row.title, icon: 'apps' });
    }
  }
  include(props.menus);
  if (props.commerceEnabled) base.push({ path: '/recharge', title: '会员中心', icon: 'wallet' }, { path: '/sales', title: '推广计划', icon: 'user' });
  if (auth.isAdmin) base.push({ path: '/statistic', title: '管理后台', icon: 'settings' });
  return base;
});
const favoriteNavigation = computed(() => navigation.value.filter((item) => favorites.value.includes(item.path)));
const dialogTitle = computed(() => dialog.value === 'notice' ? '系统公告' : dialog.value === 'navigation' ? '添加菜单' : '关于 QGauss AI');
function toggleFavorite(path) {
  favorites.value = favorites.value.includes(path) ? favorites.value.filter((item) => item !== path) : [...favorites.value, path];
  try { localStorage.setItem('qg:client-favorites', JSON.stringify(favorites.value)); } catch { /* 当前界面仍使用所选菜单 */ }
}
function toggleMenu(next) { menu.value = menu.value === next ? '' : next; }
function setLanguage(next) { setLang(next); menu.value = ''; }
function toggleLayout() {
  if (mobile.value) { clientNavigationOpen.value = !clientNavigationOpen.value; return; }
  floating.value = !floating.value;
  try { localStorage.setItem('qg:client-layout', floating.value ? 'floating' : 'workbench'); } catch { /* 忽略 */ }
}
function outside(event) { if (!toolsRoot.value?.contains(event.target) && !navPopupRoot.value?.contains(event.target)) menu.value = ''; }
function keyboard(event) { if (event.key === 'Escape') { menu.value = ''; clientNavigationOpen.value = false; } }
watch(() => route.fullPath, () => { menu.value = ''; clientNavigationOpen.value = false; });
watch(clientNavigationOpen, async (open) => {
  if (!mobile.value) return;
  await nextTick();
  if (open) sidebarElement.value?.querySelector('a,button')?.focus();
  else layoutButton.value?.focus();
});
watch(dialog, async (kind, old) => {
  menu.value = '';
  if (old === 'notice' && !kind) emit('dismiss-announcement');
  await nextTick();
  if (!dialogElement.value) return;
  if (kind && !dialogElement.value.open) dialogElement.value.showModal();
  else if (!kind && dialogElement.value.open) dialogElement.value.close();
});
onMounted(() => { media.addEventListener('change', updateMobile); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard); });
onBeforeUnmount(() => { media.removeEventListener('change', updateMobile); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); });
</script>
