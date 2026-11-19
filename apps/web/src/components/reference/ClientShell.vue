<template>
  <div class="qg-client-shell" :class="{ 'is-floating': floating && appearance.variant !== 'play', 'is-feature-page': !isChat, 'is-immersive': immersive && isChat, 'drawer-open': clientNavigationOpen }">
    <AmbientScene />
    <nav class="qgd-primary-navigation" :style="{'--qgc-tool-space':toolSpace+'px'}" :class="{ 'qgd-liquid': appearance.variant === 'orbit' }" :aria-label="t('shell.primaryNavigation')"><router-link class="qgd-rail-logo" to="/chat" :aria-label="t('shell.home')"><img src="/brand/qgauss-mark.svg" alt="" /><b>QGauss</b></router-link><div ref="primaryNavigation" :class="{ 'qgd-liquid': appearance.variant === 'play' }"><MenuLink v-for="item in navigation" :key="item.id||item.path" :row="item" :active="navActive(item.path)" layout="rail"/></div><button type="button" :aria-label="t('shell.appearance')" @click="appearance.open = true"><ClientIcon name="palette" /></button></nav>
    <div id="qgc-desktop-sidebar"></div>
    <dialog id="qgc-mobile-drawer" ref="drawerElement" class="qgc-drawer" :aria-label="t('shell.navigation')"
      @cancel.prevent="dismissDrawer" @close="drawerClosed" @click.self="dismissDrawer"
      @keydown.esc.capture="keepDrawerBehindPopup" @keydown.tab="keepDrawerFocus">
      <div id="qgc-mobile-sidebar" class="qgc-drawer-body"></div>
    </dialog>
    <Teleport defer :to="mobile ? '#qgc-mobile-sidebar' : '#qgc-desktop-sidebar'">
      <aside class="qgc-sidebar" :aria-label="t('shell.navigation')">
        <div class="qgc-sidebar-heading">
          <router-link class="qgc-brand" to="/chat" aria-label="QGauss AI" @click="closeDrawer">
            <img src="/brand/qgauss-mark.svg" alt="" /><span><b>QGauss AI</b><small>{{ t('shell.slogan') }}</small></span>
          </router-link>
          <button v-if="mobile" class="qgc-drawer-close" type="button" autofocus :aria-label="t('shell.closeNavigation')" @click="closeDrawer">
            <ClientIcon name="close" />
          </button>
        </div>
        <div v-if="mobile && isChat" class="qgc-drawer-tabs" role="group" :aria-label="t('shell.navigation')">
          <button type="button" :aria-pressed="clientNavigationPane === 'pages'" @click="clientNavigationPane = 'pages'">
            <ClientIcon name="apps" />{{ t('shell.allPages') }}
          </button>
          <button type="button" :aria-pressed="clientNavigationPane === 'history'" @click="clientNavigationPane = 'history'">
            <ClientIcon name="chat" />{{ t('shell.chatHistory') }}
          </button>
        </div>
        <nav v-if="favoriteNavigation.length" class="qgc-pinned-nav" :aria-label="t('shell.quickNavigation')">
          <MenuLink v-for="item in favoriteNavigation" :key="item.id||item.path" :row="item" :active="navActive(item.path)" @navigate="closeDrawer" />
        </nav>
        <p v-if="navigationError" class="qgc-navigation-state" role="status">{{nt(navigationError)}}<button type="button" :disabled="navigationLoading" @click="$emit('refresh-navigation')">{{nt('重新读取')}}</button></p>
        <div v-if="isChat" v-show="!mobile || clientNavigationPane === 'history'" id="qg-chat-history" class="qgc-history"></div>
        <nav v-if="!isChat || (mobile && clientNavigationPane === 'pages')" class="qgc-nav" :class="{ 'qgc-drawer-pages': mobile }" :aria-label="t('shell.allPages')">
          <MenuLink v-for="item in navigation" :key="item.id||item.path" :row="item" :active="navActive(item.path)" @navigate="closeDrawer" />
        </nav>
        <footer class="qgc-side-footer">
          <button type="button" @click="dialog = 'navigation'"><ClientIcon name="plus" /><span>{{ t('shell.addMenu') }}</span></button>
          <button type="button" @click="dialog = 'about'"><ClientIcon name="info" /><span>{{ t('shell.about') }}</span></button>
        </footer>
      </aside>
      <div v-if="isChat" id="qg-chat-history-overlays"></div>
    </Teleport>
    <header class="qgc-header">
      <div class="qgc-header-left">
        <button class="qgc-layout-toggle" type="button" :aria-label="mobile ? t('shell.openNavigation') : t('shell.toggleSidebar')"
          :aria-expanded="mobile ? clientNavigationOpen : undefined" :aria-haspopup="mobile ? 'dialog' : undefined"
          :aria-controls="mobile ? 'qgc-mobile-drawer' : undefined" @click="toggleLayout">
          <img v-if="mobile" src="/brand/qgauss-mark.svg" alt="" /><ClientIcon v-else name="layout" />
        </button>
        <div ref="navPopupRoot" class="qgc-page-nav">
          <button class="qgc-page-title" type="button" :aria-expanded="menu === 'navigation'" @click="toggleMenu('navigation')">{{ pageTitle }}</button>
          <nav v-if="menu === 'navigation'" class="qgc-popover qgc-nav-popover" :aria-label="t('shell.switchPage')"><MenuLink v-for="item in navigation" :key="item.id||item.path" :row="item" :active="navActive(item.path)" @navigate="menu=''"/></nav>
        </div>
      </div>
      <div ref="toolsRoot" class="qgc-header-actions">
        <router-link v-if="balance.enabled" class="qgc-credit" to="/wallet" :title="balanceTooltip"><ClientIcon name="wallet" /><span>{{ t('shell.credits') }}</span></router-link>
        <div class="qgc-notice-wrap"><button class="qgc-glass-action" type="button" :aria-label="t('shell.notice')" @click="dialog = 'notice'"><ClientIcon name="bell" /></button><span v-if="announcement" class="qgc-notice-badge">{{ t('shell.new') }}</span></div>
        <LanguagePicker compact/>
        <button class="qgc-glass-action" type="button" :aria-label="t('shell.theme')" @click="toggleTheme"><ClientIcon :name="isDark ? 'moon' : 'sun'" /></button>
        <div v-if="auth.isLoggedIn" class="qgc-tool-popover"><button class="qgc-user" type="button" :aria-label="t('shell.accountMenu')" :aria-expanded="menu === 'account'" @click="toggleMenu('account')"><AccountAvatar :value="auth.user.avatar" :size="30" decorative /></button><div v-if="menu === 'account'" class="qgc-popover"><p>{{ auth.user.displayName || auth.user.username }}</p><router-link to="/account" @click="menu = ''">{{ t('shell.account') }}</router-link><router-link to="/voice" @click="menu = ''">{{ t('shell.voiceHistory') }}</router-link><router-link v-if="canManage" to="/mail" @click="menu = ''">{{ t('shell.mail') }}</router-link><router-link v-if="canManage" to="/welcome" @click="menu = ''">{{ t('shell.welcome') }}</router-link><router-link v-if="canManage" to="/menus/manage" @click="menu=''">{{nt('导航工作台')}}</router-link><router-link v-if="canManage" to="/statistic" @click="menu = ''">{{ t('shell.admin') }}</router-link><router-link v-if="commerceEnabled" to="/wallet" @click="menu = ''">{{ t('shell.wallet') }}</router-link><button type="button" @click="$emit('logout')">{{ t('shell.signOut') }}</button></div></div>
        <router-link v-else class="qgc-login" :to="{ path: '/login', query: { redirect: route.fullPath } }">{{ t('shell.login') }}</router-link>
      </div>
    </header>
    <main class="qgc-content"><slot /></main>
    <nav v-if="mobile" class="qgc-mobile-nav qgd-liquid" :aria-label="t('shell.mobileNavigation')">
      <div ref="mobileNavigation" class="qgc-mobile-entries">
        <MenuLink v-for="item in navigation.filter(item=>item.path!=='/statistic')" :key="item.id||item.path" :row="item" :active="navActive(item.path)" layout="tab" />
      </div>
      <button class="qgc-dock-more" type="button" aria-haspopup="dialog" aria-controls="qgc-mobile-drawer"
        :aria-expanded="clientNavigationOpen" @click="openClientNavigation('pages', $event.currentTarget)">
        <ClientIcon name="apps" /><span>{{ t('shell.morePages') }}</span>
      </button>
    </nav>
    <dialog ref="dialogElement" class="qgc-dialog" :aria-label="dialogTitle" @cancel.prevent="dialog = ''">
      <div class="qgc-dialog-heading"><h2>{{ dialogTitle }}</h2><button type="button" :aria-label="t('shell.close')" @click="dialog = ''"><ClientIcon name="close" /></button></div>
      <template v-if="dialog === 'notice'"><p class="qgc-notice-content">{{ siteConfig['site.announcement'] || t('shell.noNotice') }}</p></template>
      <template v-else-if="dialog === 'about'"><img class="qgc-about-mark" src="/brand/qgauss-mark.svg" alt="" /><h3>QGauss AI</h3><p>{{ t('shell.aboutDescription') }}</p><div class="qgc-agreements"><a href="/agreement/userAgreement.html" target="_blank" rel="noopener">{{ t('shell.userAgreement') }}</a><a href="/agreement/privacyAgreement.html" target="_blank" rel="noopener">{{ t('shell.privacy') }}</a></div></template>
      <div v-else-if="dialog === 'navigation'" class="qgc-dialog-nav"><label v-for="item in navigation" :key="item.id||item.path"><input type="checkbox" :checked="favorites.includes(favoriteKey(item))||favorites.includes(item.path)" @change="toggleFavorite(item)" /><ClientIcon :name="item.icon" /><span>{{ item.title }}</span></label></div>
      <button class="qgc-dialog-close" type="button" @click="dialog = ''">{{ t('shell.close') }}</button>
    </dialog>
  </div>
</template>

<script setup>
import MenuLink from '../navigation/MenuLink.vue';
import {flattenNavigation,menuLabel} from '../../lib/navigation.js';
import {navigationText} from '../../i18n/navigation-messages.js';
import {currentLang} from '../../i18n/index.js';
import '../navigation/navigation.css';
import LanguagePicker from '../design/LanguagePicker.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuth } from '../../stores/auth.js';
import { useUi } from '../../stores/ui.js';
import { useTheme } from '../../stores/theme.js';
import { t,routeTitle } from '../../i18n/index.js';
import ClientIcon from './ClientIcon.vue';
import AmbientScene from '../design/AmbientScene.vue';
import AccountAvatar from '../design/AccountAvatar.vue';
import { useAppearance } from '../../stores/appearance.js';
import '../design/workbench-shell.css';
const props = defineProps({ menus: { type: Array, default: () => [] }, siteConfig: { type: Object, default: () => ({}) }, announcement: String, commerceEnabled: Boolean, balance: { type: Object, default: () => ({ enabled: false }) }, balanceTooltip: String, title: String, navigationError:String, navigationLoading:Boolean,canManage:Boolean });
const emit = defineEmits(['logout', 'dismiss-announcement','refresh-navigation']);
const route = useRoute(), auth = useAuth();
const appearance = useAppearance();
const { immersive, clientNavigationOpen, clientNavigationPane, openClientNavigation, clientChatTitle } = useUi();
const { isDark, toggle: toggleTheme } = useTheme();
const media = window.matchMedia('(max-width:639px)'), mobile = ref(media.matches);
function updateMobile(event) { mobile.value = event.matches; clientNavigationOpen.value = false; }
const floating = ref(false), menu = ref(''), dialog = ref(''), dialogElement = ref(null), drawerElement = ref(null), toolsRoot = ref(null), navPopupRoot = ref(null);
const primaryNavigation=ref(null),mobileNavigation=ref(null),toolSpace=ref(240);let toolsObserver;
const favorites = ref([]);
try { floating.value = localStorage.getItem('qg:client-layout') === 'floating'; } catch { /* 只影响布局偏好保存 */ }
try { const saved = JSON.parse(localStorage.getItem('qg:client-favorites') || '[]'); if (Array.isArray(saved)) favorites.value = saved.filter((path) => typeof path === 'string'); } catch { /* 无效偏好使用空列表 */ }
const isChat = computed(() => route.name === 'chat');
function navActive(path){if(path==='/agent')return ['agents','agentDetail'].includes(route.name)||route.path==='/agent/chat';if(path==='/chat')return isChat.value&&route.path!=='/agent/chat';if(path==='/voice/create')return route.path==='/voice'||route.path==='/voice/create';if(path==='/inpaint')return route.name==='imageEditor';return route.path===path;}
const pageTitle = computed(() => isChat.value ? clientChatTitle.value || t('shell.chat') : routeTitle(route.path) || route.meta.title || props.title || 'QGauss AI');
const navigation = computed(() => {
 const entries=flattenNavigation(props.menus).filter(row=>!row.admin).map(row=>({...row,title:menuLabel(row,currentLang.value)}));
 if(props.canManage)entries.push({id:'core-admin',path:'/statistic',title:routeTitle('/statistic'),titleEn:routeTitle('/statistic'),titleTw:routeTitle('/statistic'),icon:'settings',kind:'internal',available:true,url:null,openInNewTab:false,loginRequired:false});
 return entries;
});
function favoriteKey(item){return item.id&&!item.id.startsWith('qg-nav-')&&!item.id.startsWith('core-')?item.id:item.path;}
const nt=value=>navigationText(currentLang.value,value);
const favoriteNavigation = computed(() => navigation.value.filter((item) => favorites.value.includes(favoriteKey(item))||favorites.value.includes(item.path)));
const dialogTitle = computed(() => dialog.value === 'notice' ? t('shell.notice') : dialog.value === 'navigation' ? t('shell.addMenu') : t('shell.aboutTitle'));
function toggleFavorite(item) {
  const path=favoriteKey(item);
  favorites.value = favorites.value.includes(path) ? favorites.value.filter((value) => value !== path&&value!==item.path) : [...favorites.value, path];
  try { localStorage.setItem('qg:client-favorites', JSON.stringify(favorites.value)); } catch { /* 当前界面仍使用所选菜单 */ }
}
function toggleMenu(next) { menu.value = menu.value === next ? '' : next; }
function toggleLayout(event) {
  if (mobile.value) {
    if (clientNavigationOpen.value) closeDrawer();
    else openClientNavigation('pages', event.currentTarget);
    return;
  }
  floating.value = !floating.value;
  try { localStorage.setItem('qg:client-layout', floating.value ? 'floating' : 'workbench'); } catch { /* 忽略 */ }
}
function outside(event) { if (!toolsRoot.value?.contains(event.target) && !navPopupRoot.value?.contains(event.target)) menu.value = ''; }
function keyboard(event) { if (event.key === 'Escape') menu.value = ''; }
function closeDrawer() { clientNavigationOpen.value = false; }
function drawerClosed() { if (!drawerElement.value?.open) closeDrawer(); }
function historyPopupVisible() {
  const popups = drawerElement.value?.querySelectorAll('#qg-chat-history-overlays :is(.el-dropdown__popper,.el-overlay.is-message-box)');
  return popups && [...popups].some(node => node.getClientRects().length);
}
function dismissDrawer() { if (!historyPopupVisible()) closeDrawer(); }
function keepDrawerBehindPopup(event) { if (historyPopupVisible()) event.preventDefault(); }
function keepDrawerFocus(event) {
  const drawer = drawerElement.value;
  if (!drawer?.open || event.defaultPrevented || historyPopupVisible()) return;
  const controls = [...drawer.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(node =>
    node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert],[aria-hidden="true"]') &&
    node.getClientRects().length && getComputedStyle(node).visibility === 'visible',
  );
  const first = controls[0], last = controls.at(-1);
  if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
async function revealNavigation(){await nextTick();for(const nav of [primaryNavigation.value,mobileNavigation.value])nav?.querySelector('[aria-current=page]')?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'auto'});}
watch([()=>route.path,()=>appearance.variant,mobile,()=>navigation.value.map(row=>row.path).join('|')],()=>void revealNavigation());
watch(() => route.fullPath, () => { menu.value = ''; clientNavigationOpen.value = false; });
watch([mobile, clientNavigationOpen], ([narrow, requested]) => {
  const drawer = drawerElement.value;
  if (!drawer) return;
  if (narrow && requested && !drawer.open) {
    menu.value = '';
    drawer.showModal();
  } else if ((!narrow || !requested) && drawer.open) {
    drawer.close();
  }
}, { flush: 'post' });
watch(dialog, async (kind, old) => {
  menu.value = '';
  if (old === 'notice' && !kind) emit('dismiss-announcement');
  await nextTick();
  if (!dialogElement.value) return;
  if (kind && !dialogElement.value.open) dialogElement.value.showModal();
  else if (!kind && dialogElement.value.open) dialogElement.value.close();
});
onMounted(() => {if(typeof ResizeObserver!=='undefined'&&toolsRoot.value){toolsObserver=new ResizeObserver(()=>{toolSpace.value=Math.ceil(toolsRoot.value?.getBoundingClientRect().width||240);});toolsObserver.observe(toolsRoot.value);}void revealNavigation();media.addEventListener('change', updateMobile); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard); });
onBeforeUnmount(() => {closeDrawer();drawerElement.value?.close();toolsObserver?.disconnect();media.removeEventListener('change', updateMobile); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); });
</script>
