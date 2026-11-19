<template>
  <el-config-provider :locale="componentLocale">
  <!-- 登录页不加外壳 -->
  <router-view v-if="!showChrome" />

  <ClientShell v-else-if="!route.meta.admin || route.meta.client" :menus="menus" :title="title" :site-config="publicSiteConfig" :announcement="announcement" :commerce-enabled="commerceEnabled" :balance="balance" :balance-tooltip="balanceTooltip" :can-manage="auth.isAdmin&&navRole==='ADMIN'" :navigation-error="navError" :navigation-loading="navLoading" @refresh-navigation="refreshMenus" @logout="onLogout" @dismiss-announcement="dismissAnnouncement"><router-view /></ClientShell>

  <div v-else class="qg-layout" :class="{ 'no-panel': !showPanel, immersive: immersive && route.name === 'chat' }">
    <div v-if="sidebarOpen" class="qg-sidebar-mask" @click="sidebarOpen = false"></div>

    <!-- 图标轨道：常驻，切页面不跳 -->
    <aside class="qg-rail qg-glass" :aria-label="t('shell.primaryNavigation')">
      <router-link class="qg-rail-brand" to="/chat" title="QGauss AI" aria-label="QGauss AI">Q</router-link>

      <router-link class="qg-rail-item" :class="{ active: route.path === '/chat' }" to="/chat" :title="t('shell.chat')" :aria-label="t('shell.chat')">
        <el-icon><ChatDotRound /></el-icon>
        <span>{{t('shell.tabChat')}}</span>
      </router-link>
      <router-link class="qg-rail-item" :class="{ active: route.path === '/plaza' }" to="/plaza" :title="t('shell.models')" :aria-label="t('shell.models')">
        <el-icon><Shop /></el-icon>
        <span>{{t('shell.tabGallery')}}</span>
      </router-link>
      <router-link class="qg-rail-item" :class="{ active: route.path === '/painting' }" to="/painting" :title="t('shell.painting')" :aria-label="t('shell.painting')">
        <el-icon><Picture /></el-icon>
        <span>{{t('shell.tabPainting')}}</span>
      </router-link>
      <router-link class="qg-rail-item" :class="{ active: route.path === '/apps' }" to="/apps" :title="t('shell.apps')" :aria-label="t('shell.apps')">
        <el-icon><Grid /></el-icon>
        <span>{{t('shell.tabApps')}}</span>
      </router-link>
      <router-link
        v-if="commerceEnabled"
        class="qg-rail-item"
        :class="{ active: route.path === '/wallet' }"
        to="/wallet" :title="t('shell.wallet')" :aria-label="t('shell.wallet')"
      >
        <el-icon><Wallet /></el-icon>
        <span>{{t('shell.tabWallet')}}</span>
      </router-link>
      <router-link
        v-if="auth.isAdmin&&navRole==='ADMIN'"
        class="qg-rail-item"
        :class="{ active: route.path === '/statistic' }"
        to="/statistic" :title="t('shell.admin')" :aria-label="t('shell.admin')"
      >
        <el-icon><Setting /></el-icon>
        <span>{{t('shell.adminShort')}}</span>
      </router-link>

      <div class="qg-rail-spacer"></div>

      <div class="qg-rail-foot">
        <button
          class="qg-icon-btn"
          type="button"
          :title="t('shell.theme')"
          :aria-label="t('shell.theme')" :aria-pressed="isDark"
          @click="toggleTheme"
        >
          <el-icon><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
        </button>
        <router-link class="qg-avatar-btn" to="/account" :title="t('shell.account')" :aria-label="t('shell.account')"><AccountAvatar :value="auth.user?.avatar" :size="30" decorative /></router-link>
      </div>
    </aside>

    <!-- 导航面板：对话/绘画自带左栏，桌面端不再叠一层；移动端以抽屉形式打开 -->
    <aside v-if="showPanel || sidebarOpen" class="qg-panel qg-glass qan-panel" :class="{open:sidebarOpen}" :aria-label="t('shell.navigation')"><AdminNavigation :rows="adminMenus" :loading="navLoading" :error="navError" :can-manage="auth.isAdmin&&navRole==='ADMIN'" @refresh="refreshMenus" @close="sidebarOpen=false"/></aside>

    <main class="qg-main">
      <header class="qg-header">
        <div class="qg-header-left">
          <button
            class="qg-icon-btn qg-only-mobile"
            type="button"
            :aria-label="t('shell.openNavigation')"
            @click="sidebarOpen = true"
          >
            <el-icon><Menu /></el-icon>
          </button>
          <!-- 页面自带大标题时顶栏不再重复 -->
          <div v-if="!route.meta.ownTitle" class="qg-header-title">{{ title }}</div>
        </div>
        <div class="qg-header-actions">
          <router-link
            v-if="balance.enabled"
            to="/wallet"
            class="qg-credit"
            :title="balanceTooltip"
            :aria-label="t('shell.walletSummary')"
          >
            <QStar :size="15" />
            <span>{{ t('shell.credits') }}</span>
          </router-link>
          <el-tag v-if="auth.user" class="qg-hide-mobile" size="small" type="info">{{ auth.user.role }}</el-tag>
          <el-button text @click="router.push('/account')">{{ t('shell.account') }}</el-button>
          <LanguagePicker compact/>
          <el-button class="qg-hide-mobile" text @click="onLogout">{{ t('logout') }}</el-button>
        </div>
      </header>

      <el-alert
        v-if="announcement"
        :title="announcement"
        type="info"
        show-icon
        :closable="true"
        @close="dismissAnnouncement"
      />

      <section class="qg-content">
        <router-view />
      </section>
    </main>

    <!-- 移动端：底部悬浮玻璃胶囊 Tab（对话页底部是输入框，不叠 Tab） -->
    <nav v-if="route.name !== 'chat'" class="qg-tabbar qg-glass" :aria-label="t('shell.mobileNavigation')">
      <router-link v-for="tab in tabs" :key="tab.path" class="qg-tab" :class="{ active: route.path === tab.path }" :to="tab.path">
        <el-icon><component :is="tab.icon" /></el-icon>
        <span>{{ tab.title }}</span>
      </router-link>
      <button type="button" class="qg-tab" style="border: 0; background: none" @click="sidebarOpen = true">
        <el-icon><Menu /></el-icon>
        <span>{{ t('shell.more') }}</span>
      </button>
    </nav>
  </div>
  <AppearancePanel />
  <LiquidGlassDefs />
  <AmbientScene v-if="route.meta.admin" />
  </el-config-provider>
</template>

<script setup>
import { ElAlert, ElButton, ElConfigProvider, ElIcon, ElTag } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn.mjs';
import zhTw from 'element-plus/es/locale/lang/zh-tw.mjs';
import en from 'element-plus/es/locale/lang/en.mjs';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {useMenuNavigation} from './composables/useMenuNavigation.js';
import AdminNavigation from './components/navigation/AdminNavigation.vue';
import {subscribeSettingsChanges} from './lib/settings-changes.js';
import {bindAppearanceSync} from './lib/appearance-sync.js';
import {isImplementedRoute} from './lib/route-recovery.js';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api/client.js';
import QStar from './components/QStar.vue';
import ClientShell from './components/reference/ClientShell.vue';
import AccountAvatar from './components/design/AccountAvatar.vue';
import AppearancePanel from './components/design/AppearancePanel.vue';
import LiquidGlassDefs from './components/design/LiquidGlassDefs.vue';
import AmbientScene from './components/design/AmbientScene.vue';
import { useAppearance } from './stores/appearance.js';
import './components/design/appearance.css';
import './components/design/workbench-pages.css';
import './components/design/liquid-glass.css';
import { useAuth } from './stores/auth.js';
import { useBalance } from './stores/balance.js';
import { useTheme } from './stores/theme.js';
import { useUi } from './stores/ui.js';
import { currentLang,t,routeTitle } from './i18n/index.js';
import LanguagePicker from './components/design/LanguagePicker.vue';

const auth = useAuth();
const componentLocale=computed(()=>currentLang.value==='en'?en:currentLang.value==='zh-TW'?zhTw:zhCn);
const appearance=useAppearance();
appearance.initialize();
const stopAppearanceSync=bindAppearanceSync(appearance,useTheme());
onUnmounted(stopAppearanceSync);
const route = useRoute();
const router = useRouter();
const announcement = ref('');
const publicSiteConfig = ref({});
const sidebarOpen = ref(false);
// 商业化是可选模块：关闭时连入口都不显示，避免点进去 404
const commerceEnabled = ref(false);

const {
  state: balance,
  tooltip: balanceTooltip,
  refresh: refreshBalance,
  reset: resetBalance,
  setCommerceEnabled,
} = useBalance();

const { isDark, toggle: toggleTheme } = useTheme();
// 沉浸模式由对话页开关，外壳据此收起轨道 / 顶栏
const { immersive } = useUi();

const DISMISS_KEY = 'qg:announcement-dismissed';

const showChrome = computed(() => route.name !== 'login' && !route.meta.authSurface && (auth.isLoggedIn || route.meta.client));
const {client:menus,manage:adminMenus,role:navRole,loading:navLoading,error:navError,refresh:refreshMenus}=useMenuNavigation(commerceEnabled,showChrome);
// 对话与绘画页自带左栏（会话列表 / 参数面板），外壳不再叠导航面板
const showPanel = computed(() => !['chat', 'painting'].includes(route.name));

const TITLES = {
  chat: '对话',
  plaza: '模型广场',
  apps: '应用',
  painting: '专业绘画',
  image: '图像',
  statistic: '概览',
  channels: '渠道管理',
  models: '模型管理',
  settings: '系统配置',
  users: '用户管理',
  moderation: '敏感词',
  chatLogs: '聊天记录',
  presets: '预设管理',
  recharge: '充值',
  wallet: '我的钱包',
  sales: '推广分佣',
  account: '个人空间',
  cramiAdmin: '卡密与套餐',
  ordersAdmin: '订单管理',
  salesAdmin: '分销与提现',
};

const title = computed(() => routeTitle(route.path) || (({agents:'行动搭档',agentDetail:'搭档档案',agentStudio:'搭档控制室',voiceStudio:'声音控制台',midjourney:'MJ 进阶创作',mjStudio:'MJ 控制台',video:'视频创作',videoStudio:'视频控制台'})[route.name] ?? TITLES[route.name] ?? '概览'));

const tabs = computed(() => [
  { path: '/chat', title: t('shell.tabChat'), icon: 'ChatDotRound' },
  { path: '/plaza', title: t('shell.tabGallery'), icon: 'Shop' },
  { path: '/painting', title: t('shell.tabPainting'), icon: 'Picture' },
  commerceEnabled.value ? { path: '/wallet', title: t('shell.tabWallet'), icon: 'Wallet' } : { path: '/apps', title: t('shell.tabApps'), icon: 'Grid' },
]);

const primaryNav = computed(() => [
  { path: '/chat', title: '对话', icon: 'ChatDotRound' },
  { path: '/plaza', title: '模型广场', icon: 'Shop' },
  { path: '/painting', title: '专业绘画', icon: 'Picture' },
  ...(commerceEnabled.value ? [{ path: '/wallet', title: '我的钱包', icon: 'Wallet' }] : []),
]);

/** 只有 router 里真实存在的路径才可点击 */
const isImplemented=path=>isImplementedRoute(router,path);

/** 顺序固定的兜底导航：菜单接口异常时前台不能没有入口 */
/** 菜单表里如果也配了 /chat 会渲染两遍，这里统一剔掉 */
let publicSettingsEpoch=0;
async function loadPublicSettings() {
  const epoch=++publicSettingsEpoch;
  try {
    const pub = await api.get('/settings/public');
    if(epoch!==publicSettingsEpoch||!pub||typeof pub!=='object'||Array.isArray(pub))return;
    publicSiteConfig.value = pub || {};
    commerceEnabled.value = pub?.['commerce.enabled'] === true;
    setCommerceEnabled(commerceEnabled.value);
    const text = pub?.['site.announcement'] ?? '';
    // 关掉过一次就不再用同一条公告打扰用户
    let dismissed='';try{dismissed=localStorage.getItem(DISMISS_KEY)||'';}catch{}
    announcement.value = text && dismissed !== text ? text : '';
  } catch {
    /* 忽略 */
  }
}

onUnmounted(subscribeSettingsChanges(loadPublicSettings));

function dismissAnnouncement() {
  try{localStorage.setItem(DISMISS_KEY, announcement.value);}catch{}
  announcement.value = '';
}

watch(
  () => auth.user?.id,
  (userId) => {
    resetBalance();
    if (userId) {
      refreshBalance();
    } else {
      resetBalance();
      // 会话在别处失效（其他标签登出、刷新令牌被拒）时，别把用户留在一个半残的页面上
      if (!route.meta.public) router.push({ path: '/login', query: { redirect: route.fullPath } });
    }
  },
);
// 移动端：切换路由后自动收起抽屉
watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false;
  },
);
onMounted(async () => {
  // 先拿到商业化开关再决定要不要查余额
  await loadPublicSettings();
  if (auth.isLoggedIn) refreshBalance();
});

function onLogout() {
  resetBalance();
  auth.logout();
  router.push('/login');
}

</script>
