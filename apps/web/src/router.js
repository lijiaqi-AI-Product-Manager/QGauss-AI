import { createRouter, createWebHistory } from 'vue-router';
import { guardNavigation } from './lib/navigation-guard.js';
import {legacyRoutes,systemStatusRoutes,installRouteRecovery} from './lib/route-recovery.js';
import StatusPage from './views/StatusPage.vue';

/**
 * 路由路径与后端 menus 表里的 path 保持一致，
 * 这样侧边栏可以直接用 router.resolve() 判断某个菜单是否已经实现。
 */
const routes = [
  { path: '/setup', name: 'setup', component: () => import('./views/Install.vue'), meta: { public: true, authSurface: true } },
  { path: '/welcome', name: 'welcome', component: () => import('./views/Welcome.vue'), meta: { admin: true, ownTitle: true } },
  { path: '/mail', name: 'mail', component: () => import('./views/admin/MailStudio.vue'), meta: { admin: true, ownTitle: true } },
  { path: '/voice/manage', name: 'voiceStudio', component: () => import('./views/admin/VoiceControl.vue'), meta: { admin: true, ownTitle: true } },
  { path: '/voice',name:'voiceLibrary',component:()=>import('./views/VoiceHistory.vue'),meta:{ownTitle:true,title:'声音收藏室'} },
  { path: '/video/manage', name: 'videoStudio', component: () => import('./views/admin/VideoControl.vue'), meta: { admin: true, ownTitle: true } },
  { path: '/agents/manage', alias:['/agentcoze/config','/agentcoze/manage','/agentcoze/import','/agentcoze/chatlog'], name: 'agentStudio', component: () => import('./views/admin/AgentStudio.vue'), meta: { admin: true, ownTitle: true } },
  { path: '/login', name: 'login', component: () => import('./views/Login.vue'), meta: { public: true, authSurface: true } },
  { path: '/reset-password', name: 'resetPassword', component: () => import('./views/ResetPassword.vue'), meta: { public: true, authSurface: true } },
  { path: '/', redirect: '/chat' },
  { path: '/chat', alias: ['/chatai','/agent/chat'], name: 'chat', component: () => import('./views/Chat.vue'), meta: { public: true, client: true } },
  { path: '/agent', name: 'agents', component: () => import('./views/Agents.vue'), meta: { ownTitle: true } },
  { path: '/agent/app', name: 'agentDetail', component: () => import('./views/AgentDetail.vue'), meta: { ownTitle: true } },
  { path: '/plaza', name: 'plaza', component: () => import('./views/ModelPlaza.vue'), meta: { ownTitle: true } },
  { path: '/painting', name: 'painting', component: () => import('./views/Painting.vue'), meta: { ownTitle: true } },
  { path:'/market',name:'creativeGallery',component:()=>import('./views/Market.vue'),meta:{ownTitle:true,title:'创意作品广场'} },
  { path: '/mindmap', name: 'mindmap', component: () => import('./views/Mindmap.vue'), meta: { ownTitle: true, title: '思维导图' } },
  { path:'/extend',name:'extensions',component:()=>import('./views/Extensions.vue'),meta:{ownTitle:true,title:'扩展工作台'} },
  { path:'/extensions/manage',name:'extensionStudio',component:()=>import('./views/admin/ExtensionControl.vue'),meta:{admin:true,ownTitle:true,title:'扩展工具箱'} },
  { path: '/inpaint', alias:'/repaint', name:'imageEditor', component:()=>import('./views/ImageEditor.vue'),meta:{ownTitle:true,title:'图像编辑台'} },
  { path: '/mj', name: 'midjourney', component: () => import('./views/Midjourney.vue'), meta: { ownTitle: true } },
  { path: '/mj/manage', name: 'mjStudio', component: () => import('./views/admin/MidjourneyControl.vue'), meta: { admin: true, ownTitle: true } },
  { path: '/video', name: 'video', component: () => import('./views/Video.vue'), meta: { ownTitle: true } },
  { path: '/apps', name: 'apps', component: () => import('./views/Apps.vue'), meta: { public:true,ownTitle: true } },
  { path: '/role', name:'appCreator',component:()=>import('./views/MyApps.vue'),meta:{ownTitle:true,title:'我的创建'} },
  { path: '/apps/manage',name:'appReview',component:()=>import('./views/admin/AppReview.vue'),meta:{admin:true,ownTitle:true,title:'应用审核'} },
  ...legacyRoutes,
  { path: '/recharge', name: 'recharge', component: () => import('./views/Recharge.vue'), meta: { ownTitle: true } },
  { path: '/wallet', name: 'wallet', component: () => import('./views/Wallet.vue'), meta: { ownTitle: true } },
  { path: '/sales', name: 'sales', component: () => import('./views/Sales.vue'), meta: { ownTitle: true } },
  { path: '/account', name: 'account', component: () => import('./views/Account.vue'), meta: { ownTitle: true } },
  { path: '/statistic', name: 'statistic', component: () => import('./views/Dashboard.vue'), meta: { admin: true } },
  { path: '/models/channels', name: 'channels', component: () => import('./views/admin/Channels.vue'), meta: { admin: true } },
  { path: '/models/list', name: 'models', component: () => import('./views/admin/Models.vue'), meta: { admin: true } },
  { path: '/settings', name: 'settings', component: () => import('./views/admin/Settings.vue'), meta: { admin: true } },
  { path: '/users', name: 'users', component: () => import('./views/admin/Users.vue'), meta: { admin: true } },
  { path: '/moderation', name: 'moderation', component: () => import('./views/admin/Moderation.vue'), meta: { admin: true } },
  { path: '/chat-logs', name: 'chatLogs', component: () => import('./views/admin/ChatLogs.vue'), meta: { admin: true } },
  { path: '/presets', name: 'presets', component: () => import('./views/admin/Presets.vue'), meta: { admin: true } },
  { path: '/admin/crami', name: 'cramiAdmin', component: () => import('./views/admin/Crami.vue'), meta: { admin: true } },
  { path: '/admin/orders', name: 'ordersAdmin', component: () => import('./views/admin/Orders.vue'), meta: { admin: true } },
  { path: '/admin/sales', name: 'salesAdmin', component: () => import('./views/admin/SalesAudit.vue'), meta: { admin: true } },
  ...systemStatusRoutes(StatusPage),
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(guardNavigation);
installRouteRecovery(router);
