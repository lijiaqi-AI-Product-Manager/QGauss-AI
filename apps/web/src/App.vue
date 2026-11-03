<template>
  <el-config-provider :locale="zhCn">
  <!-- 登录页不加外壳 -->
  <router-view v-if="!showChrome" />

  <ClientShell v-else-if="!route.meta.admin" :menus="menus" :title="title" :site-config="publicSiteConfig" :announcement="announcement" :commerce-enabled="commerceEnabled" :balance="balance" :balance-tooltip="balanceTooltip" @logout="onLogout" @dismiss-announcement="dismissAnnouncement"><router-view /></ClientShell>

  <div v-else class="qg-layout" :class="{ 'no-panel': !showPanel, immersive: immersive && route.name === 'chat' }">
    <div v-if="sidebarOpen" class="qg-sidebar-mask" @click="sidebarOpen = false"></div>

    <!-- 图标轨道：常驻，切页面不跳 -->
    <aside class="qg-rail qg-glass" aria-label="主导航">
      <router-link class="qg-rail-brand" to="/chat" title="QGauss AI" aria-label="QGauss AI">Q</router-link>

      <router-link class="qg-rail-item" :class="{ active: route.path === '/chat' }" to="/chat" title="对话" aria-label="对话">
        <el-icon><ChatDotRound /></el-icon>
        <span>对话</span>
      </router-link>
      <router-link class="qg-rail-item" :class="{ active: route.path === '/plaza' }" to="/plaza" title="模型广场" aria-label="模型广场">
        <el-icon><Shop /></el-icon>
        <span>广场</span>
      </router-link>
      <router-link class="qg-rail-item" :class="{ active: route.path === '/painting' }" to="/painting" title="专业绘画" aria-label="专业绘画">
        <el-icon><Picture /></el-icon>
        <span>绘画</span>
      </router-link>
      <router-link class="qg-rail-item" :class="{ active: route.path === '/apps' }" to="/apps" title="应用" aria-label="应用">
        <el-icon><Grid /></el-icon>
        <span>应用</span>
      </router-link>
      <router-link
        v-if="commerceEnabled"
        class="qg-rail-item"
        :class="{ active: route.path === '/wallet' }"
        to="/wallet" title="我的钱包" aria-label="我的钱包"
      >
        <el-icon><Wallet /></el-icon>
        <span>钱包</span>
      </router-link>
      <router-link
        v-if="auth.user?.role === 'ADMIN'"
        class="qg-rail-item"
        :class="{ active: route.path === '/statistic' }"
        to="/statistic" title="管理后台" aria-label="管理后台"
      >
        <el-icon><Setting /></el-icon>
        <span>管理</span>
      </router-link>

      <div class="qg-rail-spacer"></div>

      <div class="qg-rail-foot">
        <button
          class="qg-icon-btn"
          type="button"
          :title="isDark ? '切换到浅色' : '切换到深色'"
          :aria-label="isDark ? '切换到浅色' : '切换到深色'"
          @click="toggleTheme"
        >
          <el-icon><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
        </button>
        <router-link class="qg-avatar-btn" to="/account" title="个人空间" aria-label="个人空间"><AccountAvatar :value="auth.user?.avatar" :size="30" decorative /></router-link>
      </div>
    </aside>

    <!-- 导航面板：对话/绘画自带左栏，桌面端不再叠一层；移动端以抽屉形式打开 -->
    <aside v-if="showPanel || sidebarOpen" class="qg-panel qg-glass" :class="{ open: sidebarOpen }" aria-label="导航">
      <div class="qg-panel-brand">
        <span class="qg-brand-dot"></span>
        <span>QGauss AI</span>
      </div>

      <nav class="qg-nav">
        <!-- 移动端没有图标轨道，主入口放进抽屉 -->
        <div class="qg-nav-primary">
          <router-link
            v-for="item in primaryNav"
            :key="item.path"
            class="qg-nav-item"
            :class="{ active: route.path === item.path }"
            :to="item.path"
          >
            <el-icon><component :is="item.icon" /></el-icon> {{ item.title }}
          </router-link>
        </div>
        <template v-for="group in menus" :key="group.id">
          <div class="qg-nav-group">{{ group.title }}</div>
          <template v-for="item in group.children" :key="item.id">
            <router-link
              v-if="isImplemented(item.path)"
              class="qg-nav-item"
              :class="{ active: route.path === item.path }"
              :to="item.path"
            >
              <el-icon><component :is="item.icon || 'Menu'" /></el-icon> {{ item.title }}
            </router-link>
            <div v-else class="qg-nav-item disabled" :title="'即将上线：' + item.title">
              <el-icon><component :is="item.icon || 'Menu'" /></el-icon> {{ item.title }}
            </div>
          </template>
        </template>

        <template v-if="commerceEnabled">
          <div class="qg-nav-group">商业化</div>
          <router-link class="qg-nav-item" :class="{ active: route.path === '/recharge' }" to="/recharge">
            <el-icon><Goods /></el-icon> 充值
          </router-link>
          <router-link class="qg-nav-item" :class="{ active: route.path === '/wallet' }" to="/wallet" title="我的钱包" aria-label="我的钱包">
            <el-icon><Wallet /></el-icon> 我的钱包
          </router-link>
          <router-link class="qg-nav-item" :class="{ active: route.path === '/sales' }" to="/sales">
            <el-icon><Share /></el-icon> 推广分佣
          </router-link>
          <template v-if="auth.user?.role === 'ADMIN'">
            <router-link class="qg-nav-item" :class="{ active: route.path === '/admin/crami' }" to="/admin/crami">
              <el-icon><Ticket /></el-icon> 卡密与套餐
            </router-link>
            <router-link class="qg-nav-item" :class="{ active: route.path === '/admin/orders' }" to="/admin/orders">
              <el-icon><Document /></el-icon> 订单管理
            </router-link>
            <router-link class="qg-nav-item" :class="{ active: route.path === '/admin/sales' }" to="/admin/sales">
              <el-icon><Money /></el-icon> 分销与提现
            </router-link>
          </template>
        </template>
      </nav>

      <div class="qg-panel-foot">
        <span>v0.1.0 · {{ auth.user?.username }}</span>
        <button type="button" class="qg-icon-btn qg-only-mobile" :aria-label="t('logout')" :title="t('logout')" @click="onLogout">
          <el-icon><SwitchButton /></el-icon>
        </button>
      </div>
    </aside>

    <main class="qg-main">
      <header class="qg-header">
        <div class="qg-header-left">
          <button
            class="qg-icon-btn qg-only-mobile"
            type="button"
            aria-label="打开导航"
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
            aria-label="查看账户额度与余额"
          >
            <QStar :size="15" />
            <span>我的额度</span>
          </router-link>
          <el-tag v-if="auth.user" class="qg-hide-mobile" size="small" type="info">{{ auth.user.role }}</el-tag>
          <el-button text @click="router.push('/account')">个人空间</el-button>
          <el-button text @click="onToggleLang">{{ currentLang === 'zh' ? 'EN' : '中文' }}</el-button>
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
    <nav v-if="route.name !== 'chat'" class="qg-tabbar qg-glass" aria-label="底部导航">
      <router-link v-for="tab in tabs" :key="tab.path" class="qg-tab" :class="{ active: route.path === tab.path }" :to="tab.path">
        <el-icon><component :is="tab.icon" /></el-icon>
        <span>{{ tab.title }}</span>
      </router-link>
      <button type="button" class="qg-tab" style="border: 0; background: none" @click="sidebarOpen = true">
        <el-icon><Menu /></el-icon>
        <span>更多</span>
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
import { computed, onMounted, ref, watch } from 'vue';
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
import { currentLang, t, toggleLang } from './i18n/index.js';

const auth = useAuth();
useAppearance().initialize();
const route = useRoute();
const router = useRouter();
const menus = ref([]);
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

const title = computed(() => ({agents:'行动搭档',agentDetail:'搭档档案',agentStudio:'搭档控制室',voiceStudio:'声音控制台',midjourney:'MJ 进阶创作',mjStudio:'MJ 控制台',video:'视频创作',videoStudio:'视频控制台'})[route.name] ?? TITLES[route.name] ?? '概览');

const tabs = computed(() => [
  { path: '/chat', title: '对话', icon: 'ChatDotRound' },
  { path: '/plaza', title: '广场', icon: 'Shop' },
  { path: '/painting', title: '绘画', icon: 'Picture' },
  commerceEnabled.value ? { path: '/wallet', title: '钱包', icon: 'Wallet' } : { path: '/apps', title: '应用', icon: 'Grid' },
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
function withoutChat(groups) {
  return groups
    .map((g) => ({ ...g, children: (g.children ?? []).filter((c) => c.path !== '/chat') }))
    .filter((g) => g.children.length > 0);
}

function defaultMenus() {
  const groups = [
    {
      id: 'fallback-content',
      title: '内容',
      children: [
        { id: 'fallback-apps', title: '应用', path: '/apps', icon: 'Grid' },
        { id: 'fallback-image', title: '图像', path: '/image', icon: 'Picture' },
        { id: 'fallback-presets', title: '预设', path: '/presets', icon: 'MagicStick' },
      ],
    },
  ];
  if (auth.user?.role === 'ADMIN') {
    groups.push({
      id: 'fallback-admin',
      title: '管理',
      children: [
        { id: 'fallback-mail', title: '邮件投递台', path: '/mail', icon: 'Message' },
        { id: 'fallback-agents', title: '搭档控制室', path: '/agents/manage', icon: 'Connection' },
        { id: 'fallback-voice', title: '声音控制台', path: '/voice/manage', icon: 'Microphone' },
        { id: 'fallback-mj', title: 'MJ 控制台', path: '/mj/manage', icon: 'Picture' },
        { id: 'fallback-video', title: '视频控制台', path: '/video/manage', icon: 'VideoCamera' },
        { id: 'fallback-welcome', title: '启航清单', path: '/welcome', icon: 'Position' },
        { id: 'fallback-stat', title: '统计', path: '/statistic', icon: 'TrendCharts' },
        { id: 'fallback-chatlogs', title: '聊天记录', path: '/chat-logs', icon: 'Document' },
        { id: 'fallback-moderation', title: '敏感词', path: '/moderation', icon: 'Warning' },
        { id: 'fallback-users', title: '用户', path: '/users', icon: 'User' },
        { id: 'fallback-settings', title: '系统配置', path: '/settings', icon: 'Tools' },
      ],
    });
  }
  return groups;
}

async function loadMenus() {
  if (!auth.isLoggedIn) return;
  try {
    const list = await api.get('/menus');
    const groups=Array.isArray(list) && list.length > 0 ? list : defaultMenus();
    if(auth.isAdmin&&!groups.some(group=>group.path==='/agents/manage'||group.children?.some(child=>child.path==='/agents/manage')))groups.push({id:'agent-studio-entry',title:'行动搭档',children:[{id:'agent-studio',title:'搭档控制室',path:'/agents/manage',icon:'Connection'}]});
    if(auth.isAdmin&&!groups.some(group=>group.path==='/mj/manage'||group.children?.some(child=>child.path==='/mj/manage')))groups.push({id:'mj-studio-entry',title:'进阶创作',children:[{id:'mj-studio',title:'MJ 控制台',path:'/mj/manage',icon:'Picture'}]});
    if(auth.isAdmin&&!groups.some(group=>group.path==='/video/manage'||group.children?.some(child=>child.path==='/video/manage')))groups.push({id:'video-studio-entry',title:'视频创作',children:[{id:'video-studio',title:'视频控制台',path:'/video/manage',icon:'VideoCamera'}]});
    if(auth.isAdmin&&!groups.some(group=>group.path==='/voice/manage'||group.children?.some(child=>child.path==='/voice/manage')))groups.push({id:'voice-studio-entry',title:'声音工作区',children:[{id:'voice-studio',title:'声音控制台',path:'/voice/manage',icon:'Microphone'}]});
    menus.value = withoutChat(groups);
  } catch {
    menus.value = withoutChat(defaultMenus());
  }
}

async function loadPublicSettings() {
  try {
    const pub = await api.get('/settings/public');
    publicSiteConfig.value = pub || {};
    commerceEnabled.value = pub?.['commerce.enabled'] === true;
    setCommerceEnabled(commerceEnabled.value);
    const text = pub?.['site.announcement'] ?? '';
    // 关掉过一次就不再用同一条公告打扰用户
    if (text && localStorage.getItem(DISMISS_KEY) !== text) announcement.value = text;
  } catch {
    /* 忽略 */
  }
}

function dismissAnnouncement() {
  localStorage.setItem(DISMISS_KEY, announcement.value);
  announcement.value = '';
}

watch(
  () => auth.user?.id,
  (userId) => {
    resetBalance();
    if (userId) {
      loadMenus();
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
  loadMenus();
  // 先拿到商业化开关再决定要不要查余额
  await loadPublicSettings();
  if (auth.isLoggedIn) refreshBalance();
});

function onLogout() {
  resetBalance();
  auth.logout();
  router.push('/login');
}

function onToggleLang() {
  toggleLang();
}
</script>
