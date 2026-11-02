import { createApp } from 'vue';
import { createPinia } from 'pinia';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

// 顺序即覆盖顺序：组件库 → 组件库暗色变量 → 代码高亮 → 自有令牌 → 自有全局样式
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import 'highlight.js/styles/github.css';
import './styles/tokens.css';
import './styles/app.css';
// 主题要在挂载前落到 <html> 上，避免首屏闪白
import './stores/theme.js';

import App from './App.vue';
import { router } from './router.js';
import { setRefreshHandler } from './api/client.js';
import { useAuth } from './stores/auth.js';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

// 任意请求 401 时，统一走一次静默刷新
const auth = useAuth(pinia);
setRefreshHandler(() => auth.refresh());

app.mount('#app');
