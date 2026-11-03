import {registerAppImageTests} from './app-image-ui.cases.mjs';
import {registerVideoSpeakerTests} from './video-speaker-ui.cases.mjs';
import {registerVoiceComposerTests} from './voice-composer-ui.cases.mjs';
/** 用真实 Vue 组件验证跨路由挂载及鉴权动作；jsdom 不承担像素或原生焦点验收。 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { rollup } from 'rollup';
import vuePlugin from 'rollup-plugin-vue';
import postcss from 'rollup-plugin-postcss';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { richAssets } from '../../../scripts/web/rich-assets.mjs';
import {systemStatusRoutes} from '../src/lib/route-recovery.js';
import {mindmapAssets} from '../../../scripts/web/mindmap-assets.mjs';
import {saveImageEditorTransfer,readImageEditorTransfer,latestImageEditorTransfer} from '../src/lib/image-editor-transfer.js';
import { referralFixtures, referralPage } from '../../../scripts/preview/referral-fixture.mjs';
import { mailFixtures as mailCenterFixtures, mailFixturePage } from '../../../scripts/preview/mail-fixture.mjs';
import {agentFixtures,agentFixturePage} from '../../../scripts/preview/agent-fixture.mjs';
import {registerExtensionWorkbenchTests} from './extension-ui.cases.mjs';
import {midjourneyFixtures} from '../../../scripts/preview/midjourney-fixture.mjs';
import {videoFixtures} from '../../../scripts/preview/video-fixture.mjs';
import {appStudioFixtures,appStudioPage} from '../../../scripts/preview/app-creator-fixture.mjs';
import {voiceLibraryFixtures,voiceLibraryPage} from '../../../scripts/preview/voice-library-fixture.mjs';
import {voiceFixtures} from '../../../scripts/preview/voice-fixture.mjs';
import {galleryFixtures,galleryPage,galleryFavorite} from '../../../scripts/preview/gallery-fixture.mjs';
import {mindmapFixtures,mindmapFixtureReply} from '../../../scripts/preview/mindmap-fixture.mjs';

function filmToolsData(){const data=videoFixtures('video-library'),native=data['/api/video/options'].presets[0];native.features={...native.features,modes:['text','image','reference','edit','extend'],referenceLimits:{image:30,video:10,audio:10},audioOnly:true};for(const [id,mode,profile]of [['qg-film-upscale','upscale','FAL_UPSCALE'],['qg-film-lipsync','lipsync','FAL_LIPSYNC']])data['/api/video/options'].presets.push({id,name:mode==='upscale'?'画面精修室':'声音搭档',profile,caption:'本地样例',ready:true,features:{modes:[mode],ratios:['source'],seconds:[0],resolutions:[],camera:false,sound:false,maxImages:0,styles:[],referenceLimits:{image:0,video:1,audio:mode==='lipsync'?1:0}},pricing:{base:2,perSecond:1,pool:'drawMj'}});return data;}
function filmSelect(selector,value){const select=document.querySelector(selector);assert.ok(select,selector);select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}
async function filmAddFile(kind){const input=document.querySelector('input[aria-label="加入'+({image:'画面',video:'视频',audio:'声音'})[kind]+'素材"]');assert.ok(input);const file=new File(['local unit fixture'],'素材-'+kind,{type:kind==='image'?'image/png':kind==='audio'?'audio/wav':'video/mp4'});Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));await settle();await settle();}

const dom = new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>', { url: 'http://qgauss.test/chat', pretendToBeVisual: true });
for (const name of ['window', 'document', 'Document', 'ShadowRoot', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'SVGElement', 'Node', 'Event', 'CustomEvent', 'FocusEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'localStorage', 'sessionStorage', 'navigator', 'history', 'location']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
dom.window.HTMLMediaElement.prototype.pause = function () {};
dom.window.HTMLMediaElement.prototype.load = function () {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'qgauss-client-test-'));
assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep + 'qgauss-client-test-'));
const bundle = await rollup({
  input: 'qgauss-test-entry',
  external: (id) => ['vue', 'vue-router', 'pinia', 'element-plus', 'marked', 'dompurify', 'highlight.js', 'katex', 'mermaid', 'jspdf', 'svg2pdf.js'].some((name) => id === name || id.startsWith(`${name}/`)),
  plugins: [
    { name: 'qgauss-test-entry', resolveId(id) { if (id === 'qgauss-test-entry') return '\0qgauss-test-entry'; }, load(id) { if (id === '\0qgauss-test-entry') return `export {default as VoiceComposer} from ${JSON.stringify(join(webRoot,'src/views/VoiceComposer.vue'))};export {default as Extensions} from ${JSON.stringify(join(webRoot,'src/views/Extensions.vue'))};export {default as ExtensionControl} from ${JSON.stringify(join(webRoot,'src/views/admin/ExtensionControl.vue'))};export {default as StatusPage} from ${JSON.stringify(join(webRoot,'src/views/StatusPage.vue'))};export {default as Mindmap} from ${JSON.stringify(join(webRoot, 'src/views/Mindmap.vue'))};export {default as Market} from ${JSON.stringify(join(webRoot, 'src/views/Market.vue'))};export {default as Midjourney} from ${JSON.stringify(join(webRoot, 'src/views/Midjourney.vue'))};export {default as MidjourneyControl} from ${JSON.stringify(join(webRoot, 'src/views/admin/MidjourneyControl.vue'))};export {default as Video} from ${JSON.stringify(join(webRoot, 'src/views/Video.vue'))};export {default as VideoControl} from ${JSON.stringify(join(webRoot, 'src/views/admin/VideoControl.vue'))};export {default as VoiceControl} from ${JSON.stringify(join(webRoot, 'src/views/admin/VoiceControl.vue'))};export {default as Agents} from ${JSON.stringify(join(webRoot, 'src/views/Agents.vue'))};export {default as AgentDetail} from ${JSON.stringify(join(webRoot, 'src/views/AgentDetail.vue'))};export {default as AgentStudio} from ${JSON.stringify(join(webRoot, 'src/views/admin/AgentStudio.vue'))};export {default as MailStudio} from ${JSON.stringify(join(webRoot, 'src/views/admin/MailStudio.vue'))};export {default as Install} from ${JSON.stringify(join(webRoot, 'src/views/Install.vue'))};export {default as Welcome} from ${JSON.stringify(join(webRoot, 'src/views/Welcome.vue'))};export {useInstallation} from ${JSON.stringify(join(webRoot, 'src/stores/installation.js'))};export {guardNavigation} from ${JSON.stringify(join(webRoot, 'src/lib/navigation-guard.js'))};export {default as Account} from ${JSON.stringify(join(webRoot, 'src/views/Account.vue'))};export {default as ResetPassword} from ${JSON.stringify(join(webRoot, 'src/views/ResetPassword.vue'))};export {default as App} from ${JSON.stringify(join(webRoot, 'src/App.vue'))};export {default as Chat} from ${JSON.stringify(join(webRoot, 'src/views/Chat.vue'))};export {default as Apps} from ${JSON.stringify(join(webRoot, 'src/views/Apps.vue'))};export {default as ModelPlaza} from ${JSON.stringify(join(webRoot, 'src/views/ModelPlaza.vue'))};export {default as AdminModels} from ${JSON.stringify(join(webRoot, 'src/views/admin/Models.vue'))};export {default as AdminChannels} from ${JSON.stringify(join(webRoot, 'src/views/admin/Channels.vue'))};export {default as Painting} from ${JSON.stringify(join(webRoot, 'src/views/Painting.vue'))};export {default as Login} from ${JSON.stringify(join(webRoot, 'src/views/Login.vue'))};export {default as Sales} from ${JSON.stringify(join(webRoot, 'src/views/Sales.vue'))};export {default as Recharge} from ${JSON.stringify(join(webRoot, 'src/views/Recharge.vue'))};export {default as Wallet} from ${JSON.stringify(join(webRoot, 'src/views/Wallet.vue'))};export {default as MyApps} from ${JSON.stringify(join(webRoot, 'src/views/MyApps.vue'))};export {default as AppReview} from ${JSON.stringify(join(webRoot, 'src/views/admin/AppReview.vue'))};export {default as VoiceHistory} from ${JSON.stringify(join(webRoot, 'src/views/VoiceHistory.vue'))};export {useAuth} from ${JSON.stringify(join(webRoot, 'src/stores/auth.js'))};`; } },
    {name:'qgauss-mindmap-native-boundary',resolveId(id){if(id==='markmap-view')return join(webRoot,'test/fixtures/mindmap-layout.mjs');}},
    vuePlugin({ css: false }), richAssets(), mindmapAssets(), postcss({ inject: false }), nodeResolve({ browser:true, extensions: ['.js', '.vue', '.mjs'] }), commonjs(),
  ],
  onwarn(warning, warn) { if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning); },
});
const generated = await bundle.generate({ format: 'es', inlineDynamicImports: true });
const entry = generated.output.find((item) => item.type === 'chunk' && item.isEntry);
// 临时文件需从项目依赖树解析 external 模块，使用绝对模块 URL。
let code = entry.code;
for (const dependency of entry.imports) {
  const path = import.meta.resolve(dependency);
  code = code.replaceAll(`from '${dependency}'`, `from '${path}'`);
}
const entryFile = join(temp, 'client.mjs');
await writeFile(entryFile, code);
await bundle.close();
const { VoiceComposer, Extensions, ExtensionControl, StatusPage, Mindmap, Market, VoiceHistory, MyApps, AppReview, Midjourney, MidjourneyControl, Video, VideoControl, VoiceControl, App, Agents, AgentDetail, AgentStudio, MailStudio, Install, Welcome, useInstallation, guardNavigation, Account, ResetPassword, Chat, Apps, ModelPlaza, AdminModels, AdminChannels, Painting, Wallet, Recharge, Sales, Login, useAuth } = await import(pathToFileURL(entryFile));
const { createApp, nextTick } = await import('vue');
const { createPinia } = await import('pinia');
const { createRouter, createMemoryHistory } = await import('vue-router');
const { ElMessage } = await import('element-plus');
const { default: QGaussTypedText } = await import('../src/components/reference/QGaussTypedText.js');
const icons = await import('@element-plus/icons-vue');
const settle = async () => { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 15)); await nextTick(); };
const relayJson = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { code: 0, data } : { code: status, message: data }), { status, headers: { 'Content-Type': 'application/json' } });
function relayInterceptor(extra, data = referralFixtures()) {
  return async call => {
    const intercepted = await extra?.(call, data); if (intercepted) return intercepted;
    const url = new URL(call.url, 'http://qgauss.test');
    if (call.method === 'GET' && Object.hasOwn(data, url.pathname)) return relayJson(['/api/sales/records', '/api/sales/withdrawals'].includes(url.pathname) ? referralPage(data[url.pathname], url) : data[url.pathname]);
  };
}
async function mountRelay(extra, data) { return mount({ loggedIn: true, initialPath: '/sales', intercept: relayInterceptor(extra, data) }); }
function relayInput(selector, value) { const input = document.querySelector(selector); assert.ok(input, selector); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
async function relayReview(amount = '35.70', contact = '合成测试账号-3570') { relayInput('#qr-amount', amount); relayInput('#qr-contact', contact); await settle(); document.querySelector('.qr-withdraw-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(); }

async function mount({ loggedIn = false, admin = false, pending = false, historyRows, intercept, initialPath, guestDraft, storedVideoIntent, storedAppCreate, storedAppAction, storedReviewAction, storedVoiceRemoval, realLogin = false, realGuard = false } = {}) {
  localStorage.clear(); sessionStorage.clear();
  if(storedVoiceRemoval)sessionStorage.setItem('qg:voice-remove:test-user',storedVoiceRemoval);
  if(storedAppCreate)sessionStorage.setItem('qg:app-create:test-user',storedAppCreate);
  if(storedAppAction)sessionStorage.setItem('qg:app-action:test-user',JSON.stringify(storedAppAction));
  if(storedReviewAction)sessionStorage.setItem('qg:app-review:test-user',JSON.stringify(storedReviewAction));
  if (storedVideoIntent) sessionStorage.setItem('qg:video:intent:test-user',JSON.stringify(storedVideoIntent));
  if (guestDraft !== undefined) sessionStorage.setItem('qg:guest-draft', guestDraft);
  document.querySelector('#mount').innerHTML = '';
  const calls = [], errors = [];
  const conversations = historyRows || [{ id: 'c1', title: '普通对话', appId: null, pinned: false }, { id: 'c2', title: '应用对话', appId: 'a1', pinned: false }];
  const modelRows = [{ id: 'model-a', name: 'qa-model', displayName: '测试模型', vendor: 'QGauss', ready: true }, { id: 'model-b', name: 'qa-second', displayName: '第二模型', vendor: 'QGauss', ready: true }, { id: 'model-c', name: 'qa-offline', displayName: '离线模型', vendor: 'QGauss 研发', ready: false }];
  const selections = new Map([['c1', 'model-a'], ['c2', 'model-a']]);
  let profileRow={id:'test-user',username:'测试用户',displayName:'灵感观察员',email:'observer@qgauss.test',avatar:'qgauss:violet',role:admin?'ADMIN':'USER',createdAt:'2026-10-30T08:00:00Z'};
  globalThis.fetch = async (url, init = {}) => {
    const call = { signal: init.signal, url: String(url), method: init.method || 'GET', authorization: new Headers(init.headers).get('authorization'), installationToken: new Headers(init.headers).get('x-qgauss-install-token'), body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body || null };
    calls.push(call);
    const intercepted = await intercept?.(call);
    if (intercepted) return intercepted;
    if(call.url === '/api/installation/status')return relayJson({required:false,canInitialize:false,needsSecureConnection:false});
    if (pending && ['/api/conversations', '/api/models/available', '/api/folders'].includes(url)) { await new Promise((resolve) => setTimeout(resolve, 60)); return new Response(JSON.stringify({ message: '会话已退出' }), { status: 401 }); }
    if (call.url === '/api/users/profile') {if(call.method==='PATCH')profileRow={...profileRow,...call.body};return relayJson(profileRow);}
    if(call.url.startsWith('/api/users/logins?'))return relayJson({items:[],total:0,page:1,pageSize:4});
    if(call.url==='/api/users/password' || call.url==='/api/auth/reset-password')return relayJson({ok:true});
    const conversationKey = /^\/api\/conversations\/(c[12])$/.exec(url)?.[1];
    if (conversationKey && call.method === 'PATCH' && call.body.modelId) selections.set(conversationKey, call.body.modelId);
    const data = url === '/api/settings/public' ? { 'commerce.enabled': false } : url === '/api/conversations' ? conversations : url === '/api/conversations/bulk-delete' ? { count: 1 } : conversationKey ? { id: conversationKey, model: modelRows.find(m => m.id === selections.get(conversationKey)), messages: [{ id: 'm1', role: 'USER', content: '测试提问', parentId: null }, { id: 'm2', role: 'ASSISTANT', content: '测试回答', parentId: 'm1', status: 'COMPLETED' }] } : url === '/api/models/available' ? modelRows : url === '/api/chat/quota' ? { limit: 0, used: 0 } : [];
    return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const pinia = createPinia(), auth = useAuth(pinia);
  if (loggedIn) auth.apply({ accessToken: 'test-access', refreshToken: 'test-refresh', user: { id: 'test-user', username: '测试用户', role: admin ? 'ADMIN' : 'USER' } });
  const router = createRouter({ history: createMemoryHistory(), routes: [{path:'/voice/create',name:'voiceComposer',component:VoiceComposer,meta:{ownTitle:true,title:'声音工作室'}},{path:'/extend',name:'extensions',component:Extensions,meta:{ownTitle:true,title:'扩展工作台'}},{path:'/extensions/manage',name:'extensionStudio',component:ExtensionControl,meta:{admin:true,ownTitle:true}},{path:'/inpaint',name:'imageEditor',component:{template:'<p>图像编辑入口</p>'}},{path:'/mindmap',name:'mindmap',component:Mindmap,meta:{ownTitle:true,title:'思维导图'}},{path:'/market',name:'creativeGallery',component:Market,meta:{ownTitle:true,title:'创意作品广场'}},{path:'/mj',name:'midjourney',component:Midjourney},{path:'/mj/manage',name:'mjStudio',component:MidjourneyControl,meta:{admin:true,ownTitle:true}},{path:'/video',name:'video',component:Video},{path:'/video/manage',name:'videoStudio',component:VideoControl,meta:{admin:true,ownTitle:true}},{path:'/voice',name:'voiceLibrary',component:VoiceHistory,meta:{ownTitle:true,title:'声音收藏室'}},{path:'/voice/manage',name:'voiceStudio',component:VoiceControl,meta:{admin:true,ownTitle:true}},{path:'/agent',name:'agents',component:Agents},{path:'/agent/app',name:'agentDetail',component:AgentDetail},{path:'/agents/manage',name:'agentStudio',component:AgentStudio,meta:{admin:true,ownTitle:true}},{path:'/mail',name:'mail',component:MailStudio,meta:{admin:true,ownTitle:true}},{path:'/setup',name:'setup',component:Install,meta:{public:true,authSurface:true}},{path:'/welcome',name:'welcome',component:Welcome,meta:{admin:true,ownTitle:true}},{ path: '/', redirect: '/chat' }, { path: '/chat',alias:['/agent/chat'], name: 'chat', component: Chat, meta: { public: true, client: true } }, { path: '/login', name: 'login', component: realLogin ? Login : { template: '<p>测试登录页</p>' }, meta: { public: true } }, { path: '/image', redirect: '/painting' }, { path: '/models/list', name: 'models', component: AdminModels, meta: { admin: true } }, { path: '/models/channels', name: 'channels', component: AdminChannels, meta: { admin: true } }, { path: '/presets', name: 'presets', component: { template: '<p>后台预设</p>' }, meta: { admin: true } }, {path:'/role',name:'appCreator',component:MyApps},{path:'/apps/manage',name:'appReview',component:AppReview,meta:{admin:true,ownTitle:true}},{path:'/app-store',redirect:to=>({path:'/apps',query:to.query})},{ path: '/apps', name: 'apps', component: Apps,meta:{public:true} }, { path: '/plaza', name: 'plaza', component: ModelPlaza }, { path: '/painting', name: 'painting', component: Painting }, { path: '/wallet', name: 'wallet', component: Wallet }, { path: '/recharge', name: 'recharge', component: Recharge }, { path: '/sales', name: 'sales', component: Sales }, {path:'/account',name:'account',component:Account}, {path:'/reset-password',name:'resetPassword',component:ResetPassword,meta:{public:true,authSurface:true}},...systemStatusRoutes(StatusPage)] });
  if(realGuard){auth.booting=false;router.beforeEach(guardNavigation);}
  const app = createApp(App);
  app.config.errorHandler = (error) => errors.push(error);
  app.config.warnHandler = (message) => { if (/Failed to resolve (component|directive)/.test(message)) errors.push(new Error(message)); };
  app.use(pinia).use(router);
  for (const [name, icon] of Object.entries(icons)) app.component(name, icon);
  if (initialPath) await router.push(initialPath);
  app.mount('#mount');
  await router.isReady(); await settle();
  return { app, router, auth, installation:useInstallation(pinia), errors, calls, close: async () => { ElMessage.closeAll(); app.unmount(); await settle(); } };
}

function videoInterceptor(extra, data = videoFixtures('video-library')) {
  return async call => { const custom = await extra?.(call, data); if (custom) return custom; const url = new URL(call.url, 'http://qgauss.test'); if (call.method === 'GET' && Object.hasOwn(data, url.pathname)) return relayJson(data[url.pathname]); };
}
function videoClick(text) { const scope=document.querySelector('dialog[open]')||document; const button = [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text); assert.ok(button, text); button.click(); }
function mjInterceptor(extra,data=midjourneyFixtures('mj-gallery')) { return async call=>{const custom=await extra?.(call,data);if(custom)return custom;const url=new URL(call.url,'http://qgauss.test');if(call.method==='GET'&&url.pathname.startsWith('/api/mj/sample/'))return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});if(call.method==='GET'&&Object.hasOwn(data,url.pathname))return relayJson(data[url.pathname]);}; }
test('MJ 控制台读取与保存真实字段，不自动调用生成',async()=>{
 const data=midjourneyFixtures('mj-gallery');const f=await mount({loggedIn:true,admin:true,initialPath:'/mj/manage',intercept:mjInterceptor(call=>call.method==='PUT'&&call.url.startsWith('/api/mj/admin/presets/')?relayJson({...call.body,id:'qg-mj-sample',version:4}):null,data)});
 try{await settle();assert.ok(document.querySelector('[aria-label="MJ 连接名称"]'));relayInput('[aria-label="MJ 连接名称"]','QGauss 新工作室');document.querySelector('.qja-page form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();const save=f.calls.find(c=>c.method==='PUT'&&c.url.startsWith('/api/mj/admin/presets/'));assert.equal(save.body.name,'QGauss 新工作室');assert.equal(save.body.enabled,true);assert.equal(save.body.version,3);assert.equal(save.body.hdMultiplier,2);assert.equal(typeof save.body.prices.imagine,'number');assert.equal(f.calls.some(c=>c.url==='/api/mj/tasks'&&c.method==='POST'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('MJ 版本切换移除不支持的 HD，扩图用滑杆提交清晰参数',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/mj',intercept:mjInterceptor(call=>call.url==='/api/mj/quote'?relayJson({revision:'d'.repeat(64),cost:2,pool:'drawMj'}):null)});
 try{const version=document.querySelector('[aria-label="MJ 版本"]');version.value='8.2';version.dispatchEvent(new Event('change',{bubbles:true}));await settle();const hd=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('生成 HD 画面')).querySelector('input');hd.checked=true;hd.dispatchEvent(new Event('change',{bubbles:true}));await settle();version.value='7';version.dispatchEvent(new Event('change',{bubbles:true}));await settle();relayInput('#qj-prompt','切回普通版本');videoClick('让想象，开始生长↗');await settle();assert.equal(f.calls.find(c=>c.url==='/api/mj/quote').body.hd,false);videoClick('再想一想');document.querySelector('.qj-cover').click();await settle();await settle();[...document.querySelectorAll('.qj-action-deck button')].find(b=>b.textContent.includes('自定义扩图')).click();await settle();relayInput('[aria-label="MJ 扩图范围"]','1.7');videoClick('让想象，开始生长↗');await settle();const q=f.calls.filter(c=>c.url==='/api/mj/quote').at(-1);assert.equal(q.body.zoom,1.7);assert.equal(q.body.prompt,'玻璃小行星');assert.equal(q.body.actionId,'qg-customzoom');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('MJ 工作台读取作品不自动生成，零值种子进入报价，取消确认不提交',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/mj',intercept:mjInterceptor(call=>call.url==='/api/mj/quote'?relayJson({revision:'a'.repeat(64),cost:4,pool:'drawMj',kindName:'文字成画'}):null)});
 try{assert.equal(document.querySelectorAll('.qj-card').length,5);assert.equal(f.calls.some(c=>c.method==='POST'&&c.url.startsWith('/api/mj')),false);relayInput('#qj-prompt','一颗玻璃小行星');relayInput('[aria-label="MJ 随机种子"]','0');videoClick('让想象，开始生长↗');await settle();const q=f.calls.find(c=>c.url==='/api/mj/quote');assert.equal(q.body.seed,0);assert.equal(document.querySelector('.qj-confirm').open,true);assert.match(document.querySelector('.qj-confirm').textContent,/4 绘画次数/);videoClick('再想一想');await settle();assert.equal(f.calls.some(c=>c.method==='POST'&&c.url==='/api/mj/tasks'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('MJ 双击确认只提交一次，成功接收后清除原意图',async()=>{
 let release;const held=new Promise(done=>{release=done;}),data=midjourneyFixtures('mj-gallery');const f=await mount({loggedIn:true,initialPath:'/mj',intercept:mjInterceptor(async call=>call.url==='/api/mj/quote'?relayJson({revision:'b'.repeat(64),cost:3,pool:'drawMj'}):call.url==='/api/mj/tasks'&&call.method==='POST'?(await held,relayJson(data['/api/mj/tasks'].items[1],201)):null,data)});
 try{relayInput('#qj-prompt','同一份想象');videoClick('让想象，开始生长↗');await settle();const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认这次创作');button.click();button.click();await settle();assert.equal(f.calls.filter(c=>c.url==='/api/mj/tasks'&&c.method==='POST').length,1);assert.ok(sessionStorage.getItem('qg:mj:intent:test-user'));release();await settle();await settle();assert.equal(sessionStorage.getItem('qg:mj:intent:test-user'),null);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});
test('MJ 原生操作只传来源和服务器动作标识，公开需要再次确认，回收可恢复',async()=>{
 const data=midjourneyFixtures('mj-gallery'),row=data['/api/mj/tasks'].items[0];data['/api/mj/trash']={items:[row],total:1};const f=await mount({loggedIn:true,initialPath:'/mj',intercept:mjInterceptor(call=>call.url==='/api/mj/quote'?relayJson({revision:'c'.repeat(64),cost:1,pool:'drawMj'}):call.url.endsWith('/publish')?relayJson({...row,published:call.body.published}):call.url.endsWith('/restore')?relayJson({...row,published:false}):null,data)});
 try{document.querySelector('.qj-cover').click();await settle();await settle();videoClick('放进灵感展厅');await settle();assert.equal(f.calls.some(c=>c.url.endsWith('/publish')),false);videoClick('确认公开');await settle();assert.equal(f.calls.find(c=>c.url.endsWith('/publish')).method,'PATCH');const action=[...document.querySelectorAll('.qj-action-deck button')].find(b=>b.textContent.includes('放大 1'));action.click();await settle();assert.equal(document.querySelector('.qj-detail').open,false);videoClick('让想象，开始生长↗');await settle();const q=f.calls.find(c=>c.url==='/api/mj/quote');assert.equal(q.body.sourceTaskId,row.id);assert.equal(q.body.actionId,'qg-u1');assert.equal(q.body.customId,undefined);videoClick('再想一想');videoClick('回收站');await settle();videoClick('恢复这份想象 ↗');await settle();assert.equal(f.calls.find(c=>c.url.endsWith('/restore')).method,'POST');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('MJ 补充回执丢失后重试保留同一标识，服务确认后才清理',async()=>{
 const data=midjourneyFixtures('mj-gallery'),row=data['/api/mj/tasks'].items[0];row.status='WAITING_INPUT';row.results=[];row.actions=[];let attempts=0;const f=await mount({loggedIn:true,initialPath:'/mj',intercept:mjInterceptor(call=>call.url.endsWith('/modal')?(++attempts===1?Promise.reject(Error('synthetic disconnect')):relayJson({...row,status:'POLLING',modalReceipt:{requestKey:call.body.requestKey}})):null,data)});
 try{document.querySelector('.qj-card footer button').click();await settle();await settle();relayInput('[aria-label="补充 MJ 创作描述"]','保留这一份补充');videoClick('确认补充并继续 ↗');await settle();assert.ok(sessionStorage.getItem('qg:mj-modal:intent:test-user'));videoClick('确认补充并继续 ↗');await settle();await settle();const calls=f.calls.filter(c=>c.url.endsWith('/modal'));assert.equal(calls.length,2);assert.equal(calls[0].body.requestKey,calls[1].body.requestKey);assert.equal(calls[0].body.prompt,calls[1].body.prompt);assert.equal(sessionStorage.getItem('qg:mj-modal:intent:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('视频工作台：读取片库不自动开机，先确认费用，取消确认不提交', async () => {
  const f = await mount({ loggedIn: true, initialPath: '/video', intercept: videoInterceptor(call => call.url === '/api/video/quote' ? relayJson({ revision: 'a'.repeat(64), cost: 8, pool: 'drawMj', name: '光影叙事' }) : null) });
  try { assert.equal(document.querySelectorAll('.qv-card').length, 4); assert.equal(f.calls.some(c => c.method === 'POST' && c.url.startsWith('/api/video')), false); relayInput('#qv-prompt', '让玻璃小行星缓慢旋转'); relayInput('[aria-label="视频随机种子"]', '0'); videoClick('让这一幕动起来↗'); await settle(); const quote = f.calls.find(c => c.url === '/api/video/quote'); assert.equal(quote.body.seed, 0); assert.equal(quote.body.seconds, 5); assert.equal(document.querySelector('.qv-confirm').open, true); assert.match(document.querySelector('.qv-confirm').textContent, /8 绘画次数/); assert.equal(f.calls.some(c => c.url === '/api/video/tasks' && c.method === 'POST'), false); videoClick('再想一想'); await settle(); assert.equal(document.querySelector('.qv-confirm').open, false); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('视频提交：双击只提交一次，接收后清除本次意图并更新片库', async () => {
  let release; const held = new Promise(done => { release = done; }); const data = videoFixtures('video-library');
  const f = await mount({ loggedIn: true, initialPath: '/video', intercept: videoInterceptor(async call => call.url === '/api/video/quote' ? relayJson({ revision: 'b'.repeat(64), cost: 6, pool: 'drawMj', name: '光影叙事' }) : call.url === '/api/video/tasks' && call.method === 'POST' ? (await held, relayJson(data['/api/video/tasks'].items[1], 201)) : null, data) });
  try { relayInput('#qv-prompt', '合成视频提交'); videoClick('让这一幕动起来↗'); await settle(); const submit = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '确认开始创作'); submit.click(); submit.click(); await settle(); assert.equal(f.calls.filter(c => c.url === '/api/video/tasks' && c.method === 'POST').length, 1); assert.ok(sessionStorage.getItem('qg:video:intent:test-user')); release(); await settle(); await settle(); assert.equal(sessionStorage.getItem('qg:video:intent:test-user'), null); assert.equal(document.querySelector('.qv-confirm').open, false); assert.deepEqual(f.errors, []); } finally { release(); await f.close(); }
});
test('视频恢复：页面重载只找回原意图，再次确认仍使用原提交标识', async () => {
  const intent = { requestKey: 'qgauss-recover-original-key', quoteRevision: 'a'.repeat(64), payload: { presetId: 'qg-motion-ark', mode: 'text', prompt: '已写好的原始创意', seconds: 5, ratio: '16:9', resolution: '720p', sound: true } }, data = videoFixtures('video-library');
  const f = await mount({ loggedIn: true, initialPath: '/video', storedVideoIntent: intent, intercept: videoInterceptor(call => call.url.startsWith('/api/video/tasks/by-request/') ? relayJson('暂未找到', 404) : call.url === '/api/video/quote' ? relayJson({ revision: 'c'.repeat(64), cost: 6, pool: 'drawMj', name: '光影叙事' }) : call.url === '/api/video/tasks' && call.method === 'POST' ? relayJson(data['/api/video/tasks'].items[1], 201) : null, data) });
  try { await settle(); assert.ok(document.querySelector('.qv-recovery')); assert.equal(f.calls.some(c => c.method === 'POST' && c.url.startsWith('/api/video')), false); videoClick('再次确认原提交'); await settle(); assert.equal(document.querySelector('.qv-confirm').open, true); videoClick('确认开始创作'); await settle(); const sent = f.calls.find(c => c.url === '/api/video/tasks' && c.method === 'POST'); assert.equal(sent.body.requestKey, intent.requestKey); assert.equal(sent.body.prompt, intent.payload.prompt); assert.equal(sent.body.quoteRevision, 'c'.repeat(64)); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('视频详情：本人续写保留来源，公开需要二次确认，回收站可恢复', async () => {
  const data = videoFixtures('video-library'), row = data['/api/video/tasks'].items[0]; data['/api/video/trash'] = { items: [row], total: 1 };
  const f = await mount({ loggedIn: true, initialPath: '/video', intercept: videoInterceptor(call => /\/publish$/.test(call.url) ? relayJson({ ...row, published: call.body.published }) : /\/restore$/.test(call.url) ? relayJson({ ...row, published: false }) : null, data) });
  try { document.querySelector('.qv-poster').click(); await settle(); await settle(); assert.equal(document.querySelector('.qv-detail').open, true); assert.ok(document.querySelector('video[controls][playsinline]')); videoClick('发布到放映厅'); await settle(); assert.equal(f.calls.some(c => /\/publish$/.test(c.url)), false); videoClick('确认公开'); await settle(); assert.equal(f.calls.find(c => /\/publish$/.test(c.url)).method, 'PATCH'); document.querySelector('[aria-label="关闭视频详情"]').click(); await settle(); videoClick('回收站'); await settle(); assert.equal(document.querySelector('.qv-poster'), null); videoClick('恢复到我的片库 ↗'); await settle(); assert.equal(f.calls.find(c => /\/restore$/.test(c.url)).method, 'POST'); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('兼容视频续写：描述和运镜保留原值，输入锁定，费用确认使用来源编号', async () => {
  const data = videoFixtures('video-library'), row = data['/api/video/tasks'].items[0]; Object.assign(row, { profile: 'PIKA_1', presetId: 'qg-motion-pika', seconds: 6, params: { mode: 'image', seconds: 0, style: '3D', motion: 2, guidanceScale: 16, frameRate: 24, pan: 'left', tilt: 'up', rotate: 'ccw', zoom: 'in', negativePrompt: 'noise', seed: 0 } });
  const f = await mount({ loggedIn: true, initialPath: '/video', intercept: videoInterceptor(call => call.url === '/api/video/quote' ? relayJson({ revision: 'd'.repeat(64), cost: 5, pool: 'drawMj', name: '运镜实验室' }) : null, data) });
  try { document.querySelector('.qv-poster').click(); await settle(); await settle(); videoClick('续写下一幕 ↗'); await settle(); assert.equal(document.querySelector('#qv-prompt').readOnly, true); assert.equal(document.querySelector('.qv-parameters').disabled, true); assert.equal(document.querySelector('#qv-prompt').value, row.prompt); videoClick('让这一幕动起来↗'); await settle(); const body = f.calls.find(c => c.url === '/api/video/quote').body; assert.equal(body.sourceTaskId, row.id); assert.equal(body.pan, 'left'); assert.equal(body.motion, 2); assert.equal(body.seed, 0); assert.equal(body.seconds, undefined); assert.equal(body.imageIds, undefined); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('视频控制台：保存沿用版本，仅修改设置，不请求外部生成', async () => {
  const data = videoFixtures('video-library'), f = await mount({ loggedIn: true, admin: true, initialPath: '/video/manage', intercept: videoInterceptor(call => call.method === 'PUT' && call.url.includes('/presets/') ? relayJson({ ...call.body, id: 'qg-motion-ark', version: 4 }) : null, data) });
  try { relayInput('[aria-label="视频基础次数"]', '9'); document.querySelector('.qva-panel form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(); const call = f.calls.find(c => c.method === 'PUT' && c.url.includes('/presets/')); assert.equal(call.body.version, 3); assert.equal(call.body.baseCost, 9); assert.equal(Object.hasOwn(call.body, 'id'), false); assert.equal(Object.hasOwn(call.body, 'updatedAt'), false); assert.equal(Object.hasOwn(call.body, 'apiKey'), false); assert.equal(f.calls.some(c => c.url === '/api/video/quote' || c.url === '/api/video/tasks'), false); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});

test('语音入口：访客先登录，已写的草稿仍保留',async()=>{const f=await mount();try{const input=document.querySelector('[aria-label="灵感输入框"]');input.value='准备好的产品问题';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="语音输入与音色"]').click();await settle();assert.equal(f.router.currentRoute.value.path,'/login');assert.equal(sessionStorage.getItem('qg:guest-draft'),'准备好的产品问题');assert.equal(f.calls.some(call=>call.url.includes('/voice/')),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}});

test('语音面板：六音色可选择，未明确试听不会生成，返回新会话关闭面板',async()=>{const data=voiceFixtures(),f=await mount({loggedIn:true,intercept:call=>Object.hasOwn(data,call.url)?relayJson(data[call.url]):null});try{document.querySelector('[aria-label="语音输入与音色"]').click();await settle();assert.match(document.querySelector('.qvoice-topline').textContent,/把灵感/);assert.ok(document.querySelector('.qvoice-primary').textContent.includes('开始录音'));[...document.querySelectorAll('.qvoice-tabs button')].find(button=>button.textContent==='声音偏好').click();await settle();assert.equal(document.querySelectorAll('.qvoice-voice').length,6);document.querySelector('[aria-label="选择晨星 Nova音色"]').click();await settle();assert.equal(document.querySelector('[aria-label="选择晨星 Nova音色"]').getAttribute('aria-pressed'),'true');assert.equal(f.calls.some(call=>call.url==='/api/voice/quote'||call.url==='/api/voice/tasks'),false);document.querySelector('.cv-new').click();await settle();assert.equal(document.querySelector('[aria-label="语音输入与音色"]').getAttribute('aria-pressed'),'false');assert.deepEqual(f.errors,[]);}finally{await f.close();}});

test('回答朗读：从本人历史回答发起费用确认，取消不请求生成',async()=>{const data=voiceFixtures(),f=await mount({loggedIn:true,intercept:call=>call.url==='/api/voice/quote'?relayJson({kind:'speech',cost:2,pool:'model3',segments:2,revision:'a'.repeat(64)}):Object.hasOwn(data,call.url)?relayJson(data[call.url]):null});try{document.querySelector('.cv-conv').click();await settle();document.querySelector('[aria-label="朗读回答"]').click();await settle();assert.match(document.querySelector('.qvoice-confirm').textContent,/本次 2 次低价模型额度/);assert.match(document.querySelector('.qvoice-confirm').textContent,/2 段/);const call=f.calls.find(call=>call.url==='/api/voice/quote');assert.equal(call.body.messageId,'m2');assert.equal(call.body.voice,'fable');assert.equal(f.calls.some(call=>call.url==='/api/voice/tasks'),false);document.querySelector('.qvoice-confirm .qvoice-secondary').click();await settle();assert.equal(f.calls.some(call=>call.url==='/api/voice/tasks'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}});

test('声音控制台：读取不触发生成，保存沿用原确认版本且只发送配置字段',async()=>{const data=voiceFixtures(),f=await mount({loggedIn:true,admin:true,initialPath:'/voice/manage',intercept:call=>call.url==='/api/voice/admin/config'&&call.method==='PUT'?relayJson({...call.body,version:5}):Object.hasOwn(data,call.url)?relayJson(data[call.url]):null});try{assert.match(document.querySelector('.qvc-hero h1').textContent,/被温柔听见/);const cost=document.querySelectorAll('.qvc-billing-grid input')[0];cost.value='7';cost.dispatchEvent(new Event('input',{bubbles:true}));const days=document.querySelector('[aria-label="新声音作品保留天数"]');days.value='14';days.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.qvc-config').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();const saved=f.calls.find(call=>call.url==='/api/voice/admin/config'&&call.method==='PUT');assert.equal(saved.body.version,4);assert.equal(saved.body.speechCost,7);assert.equal(saved.body.retentionDays,14);assert.equal(Object.hasOwn(saved.body,'apiKey'),false);assert.equal(Object.hasOwn(saved.body,'updatedAt'),false);assert.match(document.querySelector('.qvc-feedback').textContent,/已保存/);assert.equal(f.calls.some(call=>call.url==='/api/voice/tasks'||call.url==='/api/voice/quote'),false);assert.equal(document.querySelectorAll('.qvc-receipt-list article').length,3);assert.deepEqual(f.errors,[]);}finally{await f.close();}});

test('声音控制台：旧设置被拒绝后保留当前填写内容，提示刷新再确认',async()=>{const data=voiceFixtures(),f=await mount({loggedIn:true,admin:true,initialPath:'/voice/manage',intercept:call=>call.url==='/api/voice/admin/config'&&call.method==='PUT'?new Response(JSON.stringify({code:409,message:'语音设置已变化，请刷新后保存'}),{status:409,headers:{'Content-Type':'application/json'}}):Object.hasOwn(data,call.url)?relayJson(data[call.url]):null});try{const input=document.querySelectorAll('.qvc-billing-grid input')[0];input.value='9';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.qvc-config').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();assert.match(document.querySelector('.qvc-feedback.error').textContent,/已变化/);assert.equal(document.querySelectorAll('.qvc-billing-grid input')[0].value,'9');assert.equal(f.calls.filter(call=>call.url==='/api/voice/admin/config'&&call.method==='PUT').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}});

test('异步首屏路由：历史面板挂载进侧栏，匿名首页不请求私有数据', async () => {
  const fixture = await mount();
  try {
    assert.ok(document.querySelector('.qgc-history .cv-convs'));
    assert.equal(document.querySelector('.qgc-empty h1').getAttribute('aria-label'), 'QGauss AI 灵感工作台');
    assert.equal(fixture.calls.some((call) => /conversations|models\/available|folders/.test(call.url)), false);
    document.querySelector('.qgc-empty-new').click(); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/login');
    assert.equal(fixture.router.currentRoute.value.query.redirect, '/chat?new=1');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('已登录界面：会话类型筛选、打开历史与新建编辑器保持可用', async () => {
  const fixture = await mount({ loggedIn: true });
  try {
    assert.equal(document.querySelectorAll('.cv-conv').length, 1);
    assert.match(document.querySelector('.cv-conv').textContent, /普通对话/);
    document.querySelectorAll('.qgc-history-tabs button')[1].click(); await settle();
    assert.match(document.querySelector('.cv-conv').textContent, /应用对话/);
    document.querySelectorAll('.qgc-history-tabs button')[0].click(); await settle();
    document.querySelector('.cv-conv').click(); await settle();
    assert.match(document.querySelector('.cv-main').textContent, /测试回答/);
    document.querySelector('.cv-new').click(); await settle();
    assert.ok(document.querySelector('.cv-input'));
    assert.equal(fixture.calls.find((call) => call.url === '/api/conversations/c1').authorization, 'Bearer test-access');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('退出发生在首屏请求返回前：不会出现未处理拒绝或重新挂回聊天界面', async () => {
  const fixture = await mount({ loggedIn: true, pending: true });
  try {
    document.querySelector('.qgc-user').click(); await settle();
    [...document.querySelectorAll('.qgc-popover button')].find((button) => button.textContent === '退出登录').click();
    await new Promise((resolve) => setTimeout(resolve, 80)); await settle();
    assert.equal(fixture.auth.isLoggedIn, false);
    assert.equal(fixture.router.currentRoute.value.path, '/login');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('清空非置顶只作用于当前可见历史，不包含应用标签和置顶记录', async () => {
  const fixture = await mount({ loggedIn: true, historyRows: [{ id: 'c1', title: '普通对话', appId: null, pinned: false }, { id: 'c2', title: '应用对话', appId: 'a1', pinned: false }, { id: 'c3', title: '置顶对话', appId: null, pinned: true }] });
  try {
    [...document.querySelectorAll('.qgc-history-operations button')].find((button) => button.textContent === '清空非置顶').click(); await settle();
    assert.match(document.querySelector('.el-message-box').textContent, /当前列表中 1 个未置顶/);
    [...document.querySelectorAll('.el-message-box__btns button')].find((button) => button.textContent.trim() === '删除').click(); await settle();
    // Element Plus 在关闭过渡结束后才兑现确认 Promise，等待业务请求而非固定动画时长。
    const deadline = Date.now() + 2000;
    while (!fixture.calls.some((call) => call.url === '/api/conversations/bulk-delete') && Date.now() < deadline) await settle();
    assert.deepEqual(fixture.calls.find((call) => call.url === '/api/conversations/bulk-delete')?.body, { ids: ['c1'] });
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型弹窗可以筛选并关闭，选择模型后仍保留输入草稿', async () => {
  const fixture = await mount({ loggedIn: true });
  try {
    document.querySelector('.cv-new').click(); await settle();
    const input = document.querySelector('.cv-input'); input.value = '保留这段草稿'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.cv-tools .cv-chip').click(); await settle();
    const dialog = document.querySelector('.qgc-model-dialog'); assert.equal(dialog.open, true);
    const search = dialog.querySelector('input[aria-label="搜索模型"]');
    search.value = '不匹配的模型'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    assert.equal(dialog.querySelectorAll('.cv-model-item').length, 0);
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    dialog.querySelector('.qgc-picker-use').click(); await settle();
    assert.equal(dialog.open, false);
    assert.equal(input.value, '保留这段草稿');
    assert.match(document.querySelector('.qgc-page-title').textContent, /新对话/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型搜索跨供应商，未接入的模型不可选，取消弹窗后搜索重置', async () => {
  const fixture = await mount({ loggedIn: true });
  try {
    document.querySelector('.cv-new').click(); await settle();
    document.querySelector('.cv-tools .cv-chip').click(); await settle();
    const dialog = document.querySelector('.qgc-model-dialog'), search = dialog.querySelector('input');
    search.value = '离线模型'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    assert.equal(dialog.querySelectorAll('.cv-model-item').length, 1);
    assert.equal(dialog.querySelector('.qgc-picker-use').disabled, true);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true })); await settle();
    assert.equal(dialog.open, false);
    document.querySelector('.cv-tools .cv-chip').click(); await settle();
    const reopened = document.querySelector('.qgc-model-dialog');
    assert.equal(reopened.open, true);
    assert.equal(reopened.querySelector('input').value, '');
    const selectedTab = reopened.querySelector('[role="tab"][aria-selected="true"]');
    selectedTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await settle();
    assert.match(reopened.querySelector('[role="tab"][aria-selected="true"]').textContent, /全部供应商/);
    assert.equal(reopened.querySelectorAll('.cv-model-item').length, 3);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('在历史会话切换模型会保存，重开后恢复选择', async () => {
  const fixture = await mount({ loggedIn: true });
  try {
    document.querySelector('.cv-conv').click(); await settle();
    document.querySelector('.cv-tools .cv-chip').click(); await settle();
    document.querySelector('[data-model-id="model-b"] .qgc-picker-use').click(); await settle();
    const patch = fixture.calls.find(call => call.method === 'PATCH' && call.url === '/api/conversations/c1');
    assert.deepEqual(patch?.body, { modelId: 'model-b' });
    assert.equal(patch?.authorization, 'Bearer test-access');
    assert.match(document.querySelector('.cv-tools .cv-chip').textContent, /第二模型/);
    document.querySelector('.cv-new').click(); await settle();
    document.querySelector('.cv-conv').click(); await settle();
    assert.match(document.querySelector('.cv-tools .cv-chip').textContent, /第二模型/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('历史模型已下线时保留名称，另建新对话使用可用模型', async () => {
  const fixture = await mount({ loggedIn: true, intercept: call => call.url === '/api/conversations/c1' && call.method === 'GET' ? new Response(JSON.stringify({ code: 0, data: { id: 'c1', model: { id: 'retired', name: 'qa-retired', displayName: '已停用模型' }, messages: [] } }), { status: 200 }) : undefined });
  try {
    document.querySelector('.cv-conv').click(); await settle();
    assert.match(document.querySelector('.cv-tools .cv-chip').textContent, /已停用模型/);
    const input = document.querySelector('.cv-input'); input.value = '保留模型归属'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    document.querySelector('.cv-send').click(); await settle();
    assert.equal(document.querySelector('.qgc-model-dialog').open, true);
    assert.match(document.querySelector('.el-message').textContent, /已停用或未接入/);
    assert.equal(fixture.calls.some(call => call.url === '/api/chat/completions'), false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await settle();
    assert.match(document.querySelector('.cv-tools .cv-chip').textContent, /测试模型/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('保存模型失败时保持旧选择、输入草稿和弹窗，允许重试', async () => {
  const fixture = await mount({ loggedIn: true, intercept: call => call.method === 'PATCH' ? new Response(JSON.stringify({ message: '模型保存失败' }), { status: 400 }) : undefined });
  try {
    document.querySelector('.cv-conv').click(); await settle();
    const input = document.querySelector('.cv-input'); input.value = '失败后保留'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.cv-tools .cv-chip').click(); await settle();
    document.querySelector('[data-model-id="model-b"] .qgc-picker-use').click(); await settle();
    assert.equal(document.querySelector('.qgc-model-dialog').open, true);
    assert.match(document.querySelector('.cv-tools .cv-chip').textContent, /测试模型/);
    assert.equal(input.value, '失败后保留');
    assert.match(document.querySelector('.el-message').textContent, /模型保存失败/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型保存期间新建会话，旧请求返回不会切换新草稿的模型', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const fixture = await mount({ loggedIn: true, intercept: async call => { if (call.method === 'PATCH') await held; } });
  try {
    document.querySelector('.cv-conv').click(); await settle();
    document.querySelector('.cv-tools .cv-chip').click(); await settle();
    document.querySelector('[data-model-id="model-b"] .qgc-picker-use').click(); await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await settle();
    release(); await settle();
    assert.match(document.querySelector('.cv-tools .cv-chip').textContent, /测试模型/);
    assert.equal(document.querySelector('.qgc-model-dialog').open, false);
    assert.match(document.querySelector('.qgc-page-title').textContent, /新对话/);
    assert.deepEqual(fixture.errors, []);
  } finally { release(); await fixture.close(); }
});

test('打开历史尚未返回时新建会话，旧详情不能覆盖新草稿', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const fixture = await mount({ loggedIn: true, intercept: async call => { if (call.url === '/api/conversations/c1') await held; } });
  try {
    document.querySelector('.cv-conv').click(); await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await settle();
    release(); await settle();
    assert.ok(document.querySelector('.qgc-chat.is-new-chat'));
    assert.doesNotMatch(document.querySelector('.cv-main').textContent, /测试回答/);
    assert.match(document.querySelector('.qgc-page-title').textContent, /新对话/);
    assert.deepEqual(fixture.errors, []);
  } finally { release(); await fixture.close(); }
});

test('三套外观实时切换，首页和会话草稿均保留，切换不触发写入接口', async () => {
  const fixture = await mount({ loggedIn: true });
  const choose = async label => {
    document.querySelector('.qgd-appearance-launcher').click(); await settle();
    assert.equal(document.querySelector('.qgd-appearance-dialog').open, true);
    [...document.querySelectorAll('.qgd-design-option')].find(button => button.textContent.includes(label)).click(); await settle();
    document.querySelector('.qgd-appearance-dialog footer .qgd-primary').click(); await settle();
    assert.equal(document.querySelector('.qgd-appearance-dialog').open, false);
  };
  try {
    const homeInput = document.querySelector('[aria-label="灵感输入框"]');
    homeInput.value = '跨外观保留的首页灵感'; homeInput.dispatchEvent(new Event('input', { bubbles: true }));
    await choose('青柠游乐场');
    assert.equal(document.documentElement.dataset.qgDesign, 'play');
    assert.equal(document.querySelector('[aria-label="灵感输入框"]').value, '跨外观保留的首页灵感');
    document.querySelector('.qgc-empty-new').click(); await settle();
    assert.equal(document.querySelector('.cv-input').value, '跨外观保留的首页灵感');
    await choose('星际液态');
    assert.equal(document.documentElement.dataset.qgDesign, 'orbit');
    assert.equal(document.querySelector('.cv-input').value, '跨外观保留的首页灵感');
    await choose('光屿工作室');
    assert.equal(document.documentElement.dataset.qgDesign, 'studio');
    assert.equal(fixture.calls.some(call => call.method !== 'GET'), false);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('中文输入法确认文字不跳转，正式回车后匿名灵感随登录跳转暂存', async () => {
  const fixture = await mount();
  try {
    const input = document.querySelector('[aria-label="灵感输入框"]');
    input.value = '请帮我展开这个中文灵感'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/chat');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/login');
    assert.equal(fixture.router.currentRoute.value.query.redirect, '/chat?new=1');
    assert.equal(sessionStorage.getItem('qg:guest-draft'), '请帮我展开这个中文灵感');
    assert.equal(fixture.calls.some(call => call.method !== 'GET'), false);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('登录返回新建页时恢复匿名草稿且只消费一次，不自动发送', async () => {
  const fixture = await mount({ loggedIn: true, initialPath: '/chat?new=1', guestDraft: '登录之前写下的灵感' });
  try {
    assert.equal(document.querySelector('.cv-input').value, '登录之前写下的灵感');
    assert.equal(sessionStorage.getItem('qg:guest-draft'), null);
    assert.equal(fixture.calls.some(call => call.method !== 'GET'), false);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('应用分类快速切换时，晚返回的旧分类不能覆盖最新列表', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const fixture = await mount({ loggedIn: true, intercept: async call => {
    if (call.url === '/api/apps/categories') return response([{ id: 'writing', name: '写作' }, { id: 'learning', name: '学习' }]);
    if (call.url === '/api/apps?categoryId=writing') { await held; return response([{ id: 'old', name: '旧写作应用' }]); }
    if (call.url === '/api/apps?categoryId=learning') return response([{ id: 'new', name: '新学习应用' }]);
  } });
  try {
    await fixture.router.push('/apps'); await settle();
    const chips = [...document.querySelectorAll('.apps-page .qg-vendor-chip')];
    chips.find(button => button.textContent.trim() === '写作').click(); await settle();
    chips.find(button => button.textContent.trim() === '学习').click(); await settle();
    release(); await settle();
    assert.match(document.querySelector('.apps-page .qa-card-grid').textContent, /新学习应用/);
    assert.doesNotMatch(document.querySelector('.apps-page .qa-card-grid').textContent, /旧写作应用/);
    assert.match(document.querySelector('.apps-page .qg-vendor-chip.active').textContent, /学习/);
    assert.deepEqual(fixture.errors, []);
  } finally { release(); await fixture.close(); }
});

test('应用收藏与详情按钮独立，预览后开始正确的新应用会话且不自动发送', async () => {
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const application = { id: 'writer', version:1,name: '灵感写手', defaultModel: 'qa-second', greeting: '你好，我是你的写作搭档。' };
  const fixture = await mount({ loggedIn: true, intercept: call => call.url === '/api/apps' ? response([application]) : call.url === '/api/apps/writer' ? response(application) : call.url === '/api/apps/writer/favorite' ? response({ favorited: true }) : undefined });
  try {
    await fixture.router.push('/apps'); await settle();
    const favorite = document.querySelector('.apps-fav');
    favorite.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/apps');
    favorite.click(); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/apps');
    assert.ok(document.querySelector('.apps-fav.on'));
    assert.equal(fixture.calls.filter(call => call.url === '/api/apps/writer/favorite').length, 1);
    assert.deepEqual(fixture.calls.find(call => call.url === '/api/apps/writer/favorite').body, { favorited: true });
    assert.equal(document.querySelector('.qa-card-open').tagName, 'BUTTON');
    document.querySelector('.qa-card-open').click(); await settle();
    assert.equal(document.querySelector('.qa-detail-dialog').open, true);
    assert.equal(fixture.router.currentRoute.value.path, '/apps');
    assert.match(document.querySelector('.qa-greeting').textContent, /写作搭档/);
    document.querySelector('.qa-detail-actions .qa-start').click(); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/chat');
    assert.equal(fixture.router.currentRoute.value.query.app, 'writer');
    assert.match(document.querySelector('.cv-main').textContent, /写作搭档/);
    assert.equal(fixture.calls.some(call => call.url === '/api/chat/completions'), false);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('应用搜索支持多词与全半角，收藏和分批展示只筛选当前列表且不会写入后端', async () => {
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const rows = Array.from({ length: 13 }, (_, i) => ({ id: 'app-' + i, name: '搭档 ' + i, description: '灵感整理', category: { name: '创意' }, defaultModel: 'qa-model', favorited: i % 2 === 0 }));
  rows[0].name = 'AI 写作搭档';
  const fixture = await mount({ loggedIn: true, initialPath: '/apps', intercept: call => call.url === '/api/apps' ? response(rows) : undefined });
  try {
    assert.equal(document.querySelectorAll('.qa-card').length, 9);
    document.querySelector('.qa-library-footer button').click(); await settle();
    assert.equal(document.querySelectorAll('.qa-card').length, 13);
    const search = document.querySelector('input[aria-label="搜索应用"]');
    search.value = 'ＡＩ 创意'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    assert.equal(document.querySelectorAll('.qa-card').length, 1); assert.match(document.querySelector('.qa-card').textContent, /AI 写作/);
    document.querySelector('[aria-label="清空应用搜索"]').click(); await settle();
    assert.equal(document.querySelectorAll('.qa-card').length, 9);
    document.querySelector('.qa-favorites-filter').click(); await settle();
    assert.equal(document.querySelectorAll('.qa-card').length, 7);
    assert.equal(fixture.calls.filter(call => call.url === '/api/apps').length, 1);
    assert.equal(fixture.calls.some(call => call.method !== 'GET'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('应用详情晚返回不能覆盖新搭档，关闭中止读取并让迟到内容保持不可见', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const rows = [{ id: 'old', name: '旧搭档' }, { id: 'new', name: '新搭档', greeting: '<img src=x onerror=alert(1)> 保留原文' }];
  const fixture = await mount({ loggedIn: true, initialPath: '/apps', intercept: async call => { if (call.url === '/api/apps') return response(rows); if (call.url === '/api/apps/old') { await held; return response(rows[0]); } if (call.url === '/api/apps/new') return response(rows[1]); } });
  try {
    const buttons = [...document.querySelectorAll('.qa-card-open')];
    buttons[0].click(); await settle(); buttons[1].click(); await settle(); release(); await settle();
    assert.equal(fixture.calls.find(call => call.url === '/api/apps/old').signal.aborted, true);
    assert.equal(document.querySelector('#qa-detail-title').textContent, '新搭档');
    assert.match(document.querySelector('.qa-greeting').textContent, /<img src=x/); assert.equal(document.querySelector('.qa-greeting img'), null);
    document.querySelector('.qa-detail-close').click(); await settle();
    assert.equal(document.querySelector('.qa-detail-dialog').open, false);
    assert.equal(fixture.calls.find(call => call.url === '/api/apps/new').signal.aborted, true);
    assert.deepEqual(fixture.errors, []);
  } finally { release(); await fixture.close(); }
});

test('收藏请求单飞并发送明确状态，刷新晚返回也不会撤销刚完成的收藏', async () => {
  let releaseFavorite, releaseRefresh, listCalls = 0;
  const heldFavorite = new Promise(resolve => { releaseFavorite = resolve; }), heldRefresh = new Promise(resolve => { releaseRefresh = resolve; });
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const app = { id: 'writer', name: '写作搭档', favorited: false };
  const fixture = await mount({ loggedIn: true, initialPath: '/apps', intercept: async call => {
    if (call.url === '/api/apps') { if (++listCalls > 1) await heldRefresh; return response([app]); }
    if (call.url === '/api/apps/writer') return response(app);
    if (call.url === '/api/apps/writer/favorite') { await heldFavorite; return response({ favorited: true }); }
  } });
  try {
    document.querySelector('.qa-card-open').click(); await settle();
    const favorite = document.querySelector('.qa-detail-favorite'); favorite.click(); favorite.click(); await settle();
    assert.equal(fixture.calls.filter(call => call.url.endsWith('/favorite')).length, 1);
    assert.deepEqual(fixture.calls.find(call => call.url.endsWith('/favorite')).body, { favorited: true });
    document.querySelector('.qa-detail-close').click(); await settle(); document.querySelector('.qa-result-line button').click(); await settle();
    releaseFavorite(); await settle(); releaseRefresh(); await settle();
    assert.ok(document.querySelector('.apps-fav.on')); assert.equal(document.querySelector('.apps-fav').disabled, false);
    assert.deepEqual(fixture.errors, []);
  } finally { releaseFavorite(); releaseRefresh(); await fixture.close(); }
});

test('已下架应用阻止快捷开聊，失败详情可重试且不创建会话或计费', async () => {
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  let unavailable = true;
  const fixture = await mount({ loggedIn: true, initialPath: '/apps', intercept: call => call.url === '/api/apps' ? response([{ id: 'gone', name: '暂离搭档' }]) : call.url === '/api/apps/gone' ? unavailable ? new Response(JSON.stringify({ message: '应用不存在' }), { status: 404 }) : response({ id: 'gone', name: '归来的搭档' }) : undefined });
  try {
    document.querySelector('.qa-card .qa-start').click(); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/apps'); assert.match(document.querySelector('.qa-detail-error').textContent, /已经下架/);
    assert.equal(document.querySelector('.qa-detail-actions'), null);
    unavailable = false; document.querySelector('.qa-detail-error button').click(); await settle();
    assert.equal(document.querySelector('#qa-detail-title').textContent, '归来的搭档');
    assert.equal(fixture.router.currentRoute.value.path, '/apps'); assert.equal(fixture.calls.some(call => call.method !== 'GET'), false);
    assert.match(document.querySelector('.qa-greeting small').textContent, /示意/); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('应用分类加载错误不遮住全部列表，收藏失败保留原状态并可重试', async () => {
  let attempts = 0;
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const fixture = await mount({ loggedIn: true, initialPath: '/apps', intercept: call => {
    if (call.url === '/api/apps') return response([{ id: 'writer', name: '写作搭档' }]);
    if (call.url === '/api/apps/categories') return new Response(JSON.stringify({ message: '暂时故障' }), { status: 503 });
    if (call.url.endsWith('/favorite')) return ++attempts === 1 ? new Response(JSON.stringify({ message: '暂未保存' }), { status: 503 }) : response({ favorited: true });
  } });
  try {
    assert.match(document.querySelector('.qa-inline-error').textContent, /仍可浏览/); assert.equal(document.querySelectorAll('.qa-card').length, 1);
    document.querySelector('.apps-fav').click(); await settle();
    assert.equal(document.querySelector('.apps-fav.on'), null); assert.match(document.querySelector('.el-message').textContent, /暂未保存/);
    document.querySelector('.apps-fav').click(); await settle(); assert.ok(document.querySelector('.apps-fav.on'));
    assert.deepEqual(fixture.calls.filter(call => call.url.endsWith('/favorite')).map(call => call.body), [{ favorited: true }, { favorited: true }]); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('应用列表故障保留搜索，重试后恢复匹配结果，不把加载失败报成零个应用', async () => {
  let attempts = 0;
  const fixture = await mount({ loggedIn: true, initialPath: '/apps', intercept: call => call.url === '/api/apps' ? ++attempts === 1 ? new Response(JSON.stringify({ message: '暂时无法连接' }), { status: 503 }) : new Response(JSON.stringify({ code: 0, data: [{ id: 'new-writer', name: '新写作搭档' }, { id: 'other', name: '其他搭档' }] }), { status: 200 }) : undefined });
  try {
    assert.match(document.querySelector('.qa-result-line').textContent, /列表暂未更新/);
    assert.doesNotMatch(document.querySelector('.qa-result-line').textContent, /0.*位/);
    const search = document.querySelector('[aria-label="搜索应用"]'); search.value = '写作'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    document.querySelector('.qa-empty .qgd-primary').click(); await settle();
    assert.equal(search.value, '写作'); assert.equal(document.querySelectorAll('.qa-card').length, 1); assert.match(document.querySelector('.qa-card').textContent, /新写作搭档/); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('离开应用中心或退出账号后，中止旧请求且迟到详情不能再打开窗口', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const fixture = await mount({ loggedIn: true, initialPath: '/apps', intercept: async call => { if (call.url === '/api/apps') return response([{ id: 'slow', name: '慢搭档' }]); if (call.url === '/api/apps/slow') { await held; return response({ id: 'slow', name: '迟到搭档' }); } } });
  try {
    document.querySelector('.qa-card-open').click(); await settle();
    fixture.auth.user = null; await settle();
    assert.equal(fixture.calls.find(call => call.url === '/api/apps/slow').signal.aborted, true);
    release(); await settle();
    assert.equal(document.querySelector('.qa-detail-dialog')?.open || false, false);
    assert.match(document.querySelector('.qa-card').textContent,/慢搭档/);assert.equal(document.body.textContent.includes('迟到搭档'),false); assert.deepEqual(fixture.errors, []);
  } finally { release(); await fixture.close(); }
});

test('模型广场按中文能力筛选，维护模型不跳转，可用卡片带入真实模型参数', async () => {
  const models = [{ id: 'reason', name: 'qg-reason', displayName: '逻辑搭档', vendor: 'QGauss', ready: true, capabilities: ['reasoning'] }, { id: 'image', name: 'qg-image', displayName: '画面搭档', vendor: 'QGauss', ready: false, capabilities: ['vision'] }];
  const fixture = await mount({ loggedIn: true, intercept: call => call.url === '/api/models/plaza' ? new Response(JSON.stringify({ code: 0, data: { total: 2, ready: 1, vendors: [], models } }), { status: 200 }) : call.url === '/api/models/available' ? new Response(JSON.stringify({ code: 0, data: models }), { status: 200 }) : undefined });
  try {
    await fixture.router.push('/plaza'); await settle();
    const input = document.querySelector('input[aria-label="搜索模型"]');
    input.value = '推理'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    assert.equal(document.querySelectorAll('.qg-plaza .qm-model-card').length, 1);
    assert.match(document.querySelector('.qg-plaza .qm-model-card').textContent, /逻辑搭档/);
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    assert.equal(document.querySelector('.qg-plaza .qm-model-card.is-offline .qm-use').disabled, true); document.querySelector('.qg-plaza .qm-model-card.is-offline .qm-use').click(); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/plaza');
    document.querySelector('.qg-plaza .qm-model-card:not(.is-offline) .qm-use').click(); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/chat');
    assert.equal(fixture.router.currentRoute.value.query.model, 'qg-reason');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型广场区分网络失败与搜索空状态，点击重试可恢复列表', async () => {
  let attempts = 0;
  const fixture = await mount({ loggedIn: true, intercept: call => call.url === '/api/models/plaza' ? ++attempts === 1 ? new Response(JSON.stringify({ message: '连接暂时不可用' }), { status: 503 }) : new Response(JSON.stringify({ code: 0, data: { total: 1, ready: 1, models: [{ name: 'recovered', displayName: '恢复的搭档', ready: true }] } }), { status: 200 }) : undefined });
  try {
    await fixture.router.push('/plaza'); await settle();
    assert.match(document.querySelector('.qg-plaza').textContent, /连接暂时不可用/);
    assert.doesNotMatch(document.querySelector('.qg-plaza').textContent, /没找到匹配的模型/);
    [...document.querySelectorAll('.qg-plaza button')].find(button => button.textContent.trim() === '再试一次').click(); await settle();
    assert.match(document.querySelector('.qg-plaza .qm-model-card').textContent, /恢复的搭档/);
    assert.equal(attempts, 2);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型观测站组合能力、厂商、已接入与多词搜索，排序和展开不调用生成接口', async () => {
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const models = Array.from({ length: 12 }, (_, i) => ({ name: 'model-' + i, displayName: i === 0 ? 'AI 视觉搭档' : '搭档 ' + i, vendor: i < 6 ? 'QGauss' : 'QGauss Lab', capabilities: i % 2 ? ['chat'] : ['chat', 'vision'], ready: i !== 2, maxContext: 8000 + i * 1000 }));
  const fixture = await mount({ loggedIn: true, initialPath: '/plaza', intercept: call => call.url === '/api/models/plaza' ? response({ models }) : undefined });
  try {
    assert.equal(document.querySelectorAll('.qm-model-card').length, 9); document.querySelector('.qm-catalog-footer button').click(); await settle(); assert.equal(document.querySelectorAll('.qm-model-card').length, 12);
    [...document.querySelectorAll('.qm-capabilities button')].find(button => button.textContent.includes('图片理解')).click(); await settle(); assert.equal(document.querySelectorAll('.qm-model-card').length, 6);
    const ready = document.querySelector('.qm-view-controls input'); ready.checked = true; ready.dispatchEvent(new Event('change', { bubbles: true })); await settle(); assert.equal(document.querySelectorAll('.qm-model-card').length, 5);
    const input = document.querySelector('[aria-label="搜索模型"]'); input.value = 'ＡＩ 视觉'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle(); assert.equal(document.querySelectorAll('.qm-model-card').length, 1);
    document.querySelector('[aria-label="清空模型搜索"]').click(); await settle();
    const sort = document.querySelector('[aria-label="模型排序"]'); sort.value = 'context'; sort.dispatchEvent(new Event('change', { bubbles: true })); await settle(); assert.match(document.querySelector('.qm-model-card h3').textContent, /搭档 10/);
    assert.equal(fixture.calls.some(call => call.method !== 'GET'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型对照最多三位，筛选不会移除已选，移出后模态关闭并保留其余选择', async () => {
  const models = Array.from({ length: 4 }, (_, i) => ({ name: 'compare-' + i, displayName: '对照搭档 ' + i, ready: i !== 3, maxContext: 131072, maxOutput: 8192, capabilities: ['chat'], billing: { mode: 'count', pool: 'model4', amount: i + 1 } }));
  const fixture = await mount({ loggedIn: true, initialPath: '/plaza', intercept: call => call.url === '/api/models/plaza' ? new Response(JSON.stringify({ code: 0, data: { models } }), { status: 200 }) : undefined });
  try {
    const toggles = [...document.querySelectorAll('.qm-model-card .qm-compare-toggle')]; for (const button of toggles) { button.click(); await settle(); }
    assert.equal(document.querySelectorAll('.qm-tray-models>span').length, 3); assert.match(document.querySelector('.el-message').textContent, /最多对照 3/);
    const search = document.querySelector('[aria-label="搜索模型"]'); search.value = '不存在'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle(); assert.equal(document.querySelectorAll('.qm-model-card').length, 0);
    document.querySelector('.qm-tray-actions .qm-use').click(); await settle(); assert.equal(document.querySelector('.qm-compare-dialog').open, true); assert.equal(document.querySelectorAll('.qm-compare-grid>article').length, 3);
    assert.match(document.querySelector('.qm-compare-grid').textContent, /131,072 tokens/); assert.match(document.querySelector('.qm-compare-grid').textContent, /3 次 \/ 完成对话/);
    document.querySelector('.qm-compare-remove').click(); await settle(); document.querySelector('.qm-compare-remove').click(); await settle();
    assert.equal(document.querySelector('.qm-compare-dialog').open, false); assert.equal(document.querySelectorAll('.qm-tray-models>span').length, 1); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型详情区分有效次数与微元成本参考，原始介绍文本不能成为 HTML', async () => {
  const model = { name: 'precise', displayName: '精确成本模型', ready: true, description: '<img src=x onerror=alert(1)> 普通文本', maxContext: 131072, maxOutput: 8192, priceInPerM: 3, priceOutPerM: 1200000, countPool: 'model4', countCost: 3, billing: { mode: 'none', reason: 'commerce-disabled' } };
  const fixture = await mount({ loggedIn: true, initialPath: '/plaza', intercept: call => call.url === '/api/models/plaza' ? new Response(JSON.stringify({ code: 0, data: { models: [model] } }), { status: 200 }) : undefined });
  try {
    document.querySelector('.qm-card-open').click(); await settle(); assert.equal(document.querySelector('.qm-detail-dialog').open, true);
    assert.match(document.querySelector('.qm-billing-note').textContent, /当前不扣次数/); assert.match(document.querySelector('.qm-cost-reference').textContent, /¥0.000003/); assert.match(document.querySelector('.qm-cost-reference').textContent, /¥1.2/);
    assert.equal(document.querySelector('.qm-detail-description img'), null); assert.match(document.querySelector('.qm-detail-description').textContent, /<img/);
    document.querySelector('.qm-detail-dialog .qm-dialog-close').click(); await settle(); assert.equal(document.querySelector('.qm-detail-dialog').open, false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('模型开始前重新确认，已停用的模型阻止跳转且保留参数对照快照', async () => {
  const model = { name: 'withdrawn', displayName: '刚停用的搭档', ready: true, capabilities: ['chat'] };
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const fixture = await mount({ loggedIn: true, initialPath: '/plaza', intercept: call => call.url === '/api/models/plaza' ? response({ models: [model] }) : call.url === '/api/models/available' ? response([]) : undefined });
  try {
    document.querySelector('.qm-card-open').click(); await settle(); document.querySelector('.qm-detail-actions .qm-use').click(); await settle();
    assert.equal(fixture.router.currentRoute.value.path, '/plaza'); assert.match(document.querySelector('.qm-detail-dialog .qm-inline-error').textContent, /暂时无法使用/); assert.equal(document.querySelector('.qm-detail-actions .qm-use').disabled, true);
    assert.match(document.querySelector('.qm-billing-note').textContent, /已不在当前列表中/); assert.equal(fixture.calls.some(call => call.method !== 'GET'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('关闭详情或离开模型观测站后，迟到的开始确认不能再跳转', async () => {
  for (const leave of [false, true]) {
    let release; const held = new Promise(resolve => { release = resolve; }); const model = { name: 'slow-model', displayName: '慢搭档', ready: true };
    const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
    const fixture = await mount({ loggedIn: true, initialPath: '/plaza', intercept: async call => { if (call.url === '/api/models/plaza') return response({ models: [model] }); if (call.url === '/api/models/available') { await held; return response([model]); } } });
    try {
      document.querySelector('.qm-card-open').click(); await settle(); document.querySelector('.qm-detail-actions .qm-use').click(); await settle();
      if (leave) await fixture.router.push('/apps'); else document.querySelector('.qm-detail-dialog .qm-dialog-close').click(); await settle();
      assert.equal(fixture.calls.find(call => call.url === '/api/models/available').signal.aborted, true); release(); await settle();
      assert.equal(fixture.router.currentRoute.value.path, leave ? '/apps' : '/plaza'); assert.deepEqual(fixture.errors, []);
    } finally { release(); await fixture.close(); }
  }
});

test('图像模型带入绘画参数且不会自动提交，失效的绘画参数不悄悄换成默认模型', async () => {
  const model = { name: 'qg-image', displayName: '图像搭档', ready: true, capabilities: ['image', 'vision'] };
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const intercept = call => call.url === '/api/models/plaza' ? response({ models: [model] }) : call.url === '/api/models/available' ? response([model]) : call.url === '/api/image/options' ? response({ ratios: [{ key: '1:1', w: 1, h: 1 }], resolutions: [{ key: '1K', label: '1K' }], models: [model] }) : call.url === '/api/image/tasks' && call.method === 'POST' ? response({ id: 'image-created', status: 'QUEUED', results: [] }) : /^\/api\/image\/(tasks|square)/.test(call.url) ? response({ items: [], total: 0 }) : undefined;
  const fixture = await mount({ loggedIn: true, initialPath: '/plaza', intercept });
  try {
    document.querySelector('.qm-model-card .qm-use').click(); await settle(); assert.equal(fixture.router.currentRoute.value.path, '/painting'); assert.equal(fixture.router.currentRoute.value.query.model, 'qg-image'); assert.equal(fixture.calls.some(call => call.method === 'POST'), false);
    const prompt = document.querySelector('#qp-prompt'); prompt.value = '测试图像入口'; prompt.dispatchEvent(new Event('input', { bubbles: true })); await settle(); document.querySelector('.qp-generate').click(); await settle();
    assert.equal(fixture.calls.find(call => call.url === '/api/image/tasks' && call.method === 'POST')?.body.model, 'qg-image'); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
  const stale = await mount({ loggedIn: true, initialPath: '/painting?model=gone-image', intercept });
  try {
    const prompt = document.querySelector('#qp-prompt'); prompt.value = '不使用默认模型'; prompt.dispatchEvent(new Event('input', { bubbles: true })); await settle(); document.querySelector('.qp-generate').click(); await settle();
    assert.equal(stale.calls.some(call => call.method === 'POST'), false); assert.match(document.querySelector('.el-message').textContent, /绘画模型已停用/); assert.deepEqual(stale.errors, []);
  } finally { await stale.close(); }
});

test('指定不存在或仅绘画的聊天模型时保持草稿并阻止自动替换，选择器只提供对话模型', async () => {
  const rows = [{ id: 'image', name: 'only-image', displayName: '只画图', capabilities: ['image'], ready: true }, { id: 'chat', name: 'chat-valid', displayName: '对话搭档', capabilities: ['chat'], ready: true }];
  for (const name of ['missing-model', 'only-image']) {
    const fixture = await mount({ loggedIn: true, initialPath: '/chat?model=' + name, intercept: call => call.url === '/api/models/available' ? new Response(JSON.stringify({ code: 0, data: rows }), { status: 200 }) : undefined });
    try {
      const input = document.querySelector('.cv-input'); input.value = '保留问题'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle(); document.querySelector('.cv-send').click(); await settle();
      assert.equal(fixture.calls.some(call => call.url === '/api/chat/completions'), false); assert.equal(input.value, '保留问题'); assert.equal(document.querySelectorAll('.qgc-picker-card').length, 1); assert.match(document.querySelector('.qgc-picker-card').textContent, /对话搭档/); assert.deepEqual(fixture.errors, []);
    } finally { await fixture.close(); }
  }
});

test('聊天选择器与发送区遵循有效收费规则，不把成本参考或关闭收费的次数配置当作收费', async () => {
  const rows = [{ id: 'no-charge', name: 'no-charge', displayName: '配置模型', ready: true, countPool: 'model4', countCost: 3, priceInPerM: 1000000, billing: { mode: 'none', reason: 'commerce-disabled' } }];
  const fixture = await mount({ loggedIn: true, initialPath: '/chat?new=1', intercept: call => call.url === '/api/models/available' ? new Response(JSON.stringify({ code: 0, data: rows }), { status: 200 }) : undefined });
  try {
    assert.match(document.querySelector('.qgc-model-cost-note').textContent, /当前不扣次数/); document.querySelector('button[aria-label="选择模型：配置模型"]').click(); await settle();
    assert.match(document.querySelector('.qgc-picker-price').textContent, /当前不扣次数/); assert.doesNotMatch(document.querySelector('.qgc-picker-price').textContent, /按用量计费|3 次/); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('后台模型只有一组厂商元数据，微元成本精确回填，非法小数被阻止且有效编辑发送整数', async () => {
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const model = { id: 'admin-model', name: 'admin-model', displayName: '后台模型', vendor: 'QGauss', description: '模型介绍', tags: '测试', badge: '', maxContext: 128000, maxOutput: 8192, capabilities: ['chat'], channels: [], countPool: '', countCost: 0, priceInPerM: 3, priceOutPerM: 1200000, sort: 0, status: 'ENABLED' };
  const fixture = await mount({ loggedIn: true, admin: true, initialPath: '/models/list', intercept: call => call.url === '/api/models' ? response([model]) : call.url === '/api/models/channels' ? response([]) : call.url === '/api/models/admin-model' ? response(model) : undefined });
  try {
    assert.equal([...document.querySelectorAll('.el-table__header th')].filter(el => el.textContent.trim() === '厂商').length, 1);
    [...document.querySelectorAll('.el-table button')].find(button => button.textContent.trim() === '编辑').click(); await settle();
    assert.equal([...document.querySelectorAll('.el-dialog .el-form-item__label')].filter(el => el.textContent === '厂商').length, 1);
    const input = document.querySelector('[aria-label="输入成本参考"]'); assert.equal(input.value, '0.000003'); input.value = '0.0000001'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    [...document.querySelectorAll('.el-dialog__footer button')].find(button => button.textContent.trim() === '保存').click(); await settle(); assert.equal(fixture.calls.some(call => call.method === 'PATCH'), false);
    input.value = '0.000004'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle(); [...document.querySelectorAll('.el-dialog__footer button')].find(button => button.textContent.trim() === '保存').click(); await settle();
    const saved = fixture.calls.find(call => call.method === 'PATCH'); assert.equal(saved?.body.priceInPerM, 4); assert.equal(saved?.body.priceOutPerM, 1200000); assert.equal(Object.hasOwn(saved.body, 'priceInYuan'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('绘画灵感只填提示词，模型选项来自 API，实际生成携带选中的模型标识', async () => {
  const response = data => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/image/options') return response({ ratios: [{ key: '1:1', w: 1, h: 1, scene: '方形' }], resolutions: [{ key: '1K', label: '1K' }], cats: [], models: [{ name: 'image-a', displayName: '图像模型 A' }, { name: 'image-b', displayName: '图像模型 B' }] });
    if (call.url.startsWith('/api/image/tasks') || call.url.startsWith('/api/image/square')) return response({ items: [] });
  } });
  try {
    await fixture.router.push('/painting'); await settle();
    document.querySelector('.qgd-painting-prompts button').click(); await settle();
    assert.match(document.querySelector('textarea[aria-label="绘画提示词"]').value, /未来工作室/);
    assert.equal(fixture.calls.some(call => call.method !== 'GET'), false);
    document.querySelector('.qp-params .el-select__wrapper').click(); await settle();
    const options = [...document.querySelectorAll('.el-select-dropdown__item')];
    assert.ok(options.find(option => option.textContent.trim() === '站点默认模型'));
    options.find(option => option.textContent.trim() === '图像模型 B').click(); await settle();
    [...document.querySelectorAll('.qp-actions button')].find(button => button.textContent.trim() === '开始生成').click(); await settle();
    const request = fixture.calls.find(call => call.url === '/api/image/tasks' && call.method === 'POST');
    assert.equal(request?.body.model, 'image-b');
    assert.equal(request?.body.versionName, '图像模型 B');
    assert.match(request?.body.prompt, /未来工作室/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('打字组件在启动前卸载，不留下延迟启动或循环任务', async () => {
  const nativeTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
  const tasks = new Map(); let serial = 0;
  globalThis.setTimeout = (callback, delay) => { const id = ++serial; tasks.set(id, { callback, delay }); return id; };
  globalThis.clearTimeout = (id) => tasks.delete(id);
  const container = document.createElement('div'); document.body.append(container);
  const app = createApp(QGaussTypedText, { text: 'QGauss AI', loop: true });
  try {
    app.mount(container); await nextTick();
    assert.ok([...tasks.values()].some(task => task.delay === 500));
    app.unmount(); await nextTick();
    assert.equal(tasks.size, 0, '卸载后的延迟回调不应再启动新的打字循环');
  } finally { globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClearTimeout; container.remove(); }
});

after(async () => { dom.window.close(); await rm(temp, { recursive: true, force: true }); });

const runFrame = (id, event, data) => 'id: ' + id + '\nevent: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';

const searchModel = {id:'model-a',name:'qa-model',displayName:'QGauss 检索搭档',vendor:'QGauss',ready:true,webSearchAvailable:true,capabilities:['chat','web_search']};
const searchReport = {requested:true,status:'complete',sources:[{url:'https://sources.qgauss.test/one',title:'QGauss 来源资料'}],citations:[{url:'https://sources.qgauss.test/one',start:4,end:4}]};
const searchHistory = report => ({id:'c1',model:{name:'qa-model'},messages:[{id:'su1',role:'USER',content:'之前的查找问题'},{id:'sa1',role:'ASSISTANT',parentId:'su1',status:'COMPLETED',content:'资料回答保留原文',...(report?{webSearch:report}:{})}]});

test('联网入口明确切换、不自动检索；开启时关闭上下文效果，关闭后恢复原偏好', async()=>{
  const f=await mount({loggedIn:true,intercept:c=>c.url==='/api/models/available'?relayJson([searchModel]):undefined});
  try{
    document.querySelector('.qgc-empty-new').click();await settle();
    const search=document.querySelector('[aria-label="允许联网检索"]'),context=document.querySelector('[aria-label="上下文开"]');assert.equal(search.disabled,false);assert.equal(search.getAttribute('aria-pressed'),'false');assert.ok(context);
    search.click();await settle();assert.equal(search.getAttribute('aria-pressed'),'true');assert.equal(context.disabled,true);assert.equal(context.getAttribute('aria-pressed'),'false');assert.match(document.querySelector('.cv-web-search-note').textContent,/仅发送当前问题和附件/);
    search.click();await settle();assert.equal(context.disabled,false);assert.equal(context.getAttribute('aria-pressed'),'true');assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('真实 Vue 发问只带当前问题，逐步显示检索进度、来源卡片与原文编号',async()=>{
  let live;
  const f=await mount({loggedIn:true,intercept:c=>c.url==='/api/models/available'?relayJson([searchModel]):c.url==='/api/chat/completions'?(live=runResponse(c,runFrame(1,'meta',{messageId:'search-live',conversationId:'c1'})+runFrame(2,'search',{requested:true,status:'searching',sources:[],citations:[]}))).response:undefined});
  try{
    clickHistory('普通对话');await settle();document.querySelector('[aria-label="允许联网检索"]').click();await settle();typeChat('本轮的检索问题');await settle();document.querySelector('.cv-send').click();await settle();
    const sent=f.calls.find(c=>c.url==='/api/chat/completions');assert.equal(sent.body.webSearch,true);assert.deepEqual(sent.body.messages,[{role:'user',content:'本轮的检索问题'}]);assert.match(document.querySelector('.qws-sources').textContent,/正在查找资料/);
    live.write(runFrame(3,'delta',{v:'资料回答保留原文'})+runFrame(4,'search',{...searchReport,sources:[...searchReport.sources,{url:'javascript:alert(1)',title:'unsafe'}]}));await settle();
    assert.equal(document.querySelectorAll('.qws-sources li a').length,1);assert.equal(document.querySelector('.qws-sources a').getAttribute('rel'),'noopener noreferrer nofollow');assert.doesNotMatch(document.querySelectorAll('.qg-md')[1].textContent,/https:\/\//);
    live.write(runFrame(5,'done',{status:'COMPLETED',webSearch:searchReport}));live.close();await settle();await settle();assert.ok(document.querySelector('.qg-md a[href="https://sources.qgauss.test/one"]'));assert.match(document.querySelector('.qws-sources').textContent,/资料来源已返回/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('历史恢复联网状态；关闭联网后重新生成立即清除旧引用，新建也不继承检索开关',async()=>{
  let live,regenerated=false;
  const f=await mount({loggedIn:true,intercept:c=>c.url==='/api/models/available'?relayJson([searchModel]):c.url==='/api/conversations/c1'?relayJson(searchHistory(regenerated?null:searchReport)):c.url==='/api/chat/completions'?(regenerated=true,live=runResponse(c,runFrame(1,'meta',{messageId:'ordinary-regenerate',conversationId:'c1'}))).response:undefined});
  try{
    clickHistory('普通对话');await settle();assert.equal(document.querySelector('[aria-label="允许联网检索"]').getAttribute('aria-pressed'),'true');assert.equal(document.querySelectorAll('.qws-sources').length,1);assert.equal(f.calls.some(c=>c.method!=='GET'),false);
    document.querySelector('[aria-label="允许联网检索"]').click();await settle();document.querySelector('[aria-label="重新生成"]').click();await settle();assert.equal(f.calls.find(c=>c.url==='/api/chat/completions').body.webSearch,false);assert.equal(document.querySelectorAll('.qws-sources').length,0);
    live.write(runFrame(2,'delta',{v:'普通回答'})+runFrame(3,'done',{status:'COMPLETED'}));live.close();await settle();await settle();document.querySelector('.cv-new').click();await settle();assert.equal(document.querySelector('[aria-label="允许联网检索"]').getAttribute('aria-pressed'),'false');assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('历史检索模型暂不支持联网时保留来源，阻止误发，用户可显式关闭后继续',async()=>{
  const f=await mount({loggedIn:true,intercept:c=>c.url==='/api/conversations/c1'?relayJson(searchHistory(searchReport)):undefined});
  try{
    clickHistory('普通对话');await settle();typeChat('需要先关闭联网');await settle();assert.equal(document.querySelector('.cv-send').disabled,true);assert.match(document.querySelector('.cv-web-search-note').textContent,/尚未接入联网/);assert.equal(document.querySelectorAll('.qws-sources').length,1);assert.equal(f.calls.some(c=>c.url==='/api/chat/completions'),false);
    document.querySelector('[aria-label="允许联网检索"]').click();await settle();assert.equal(document.querySelector('.cv-send').disabled,false);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('退出或切换会话后迟到的检索事件不会重新挂回来源与用户状态',async()=>{
  let live;
  const f=await mount({loggedIn:true,intercept:c=>c.url==='/api/models/available'?relayJson([searchModel]):c.url==='/api/chat/completions'?(live=runResponse(c,runFrame(1,'meta',{messageId:'late-search',conversationId:'c1'}))).response:undefined});
  try{
    document.querySelector('.qgc-empty-new').click();await settle();document.querySelector('[aria-label="允许联网检索"]').click();typeChat('迟到的检索');await settle();document.querySelector('.cv-send').click();await settle();f.auth.clearLocal();await settle();
    assert.equal(f.calls.find(c=>c.url==='/api/chat/completions').signal.aborted,true);assert.equal(document.querySelectorAll('.qws-sources').length,0);assert.equal(f.auth.isLoggedIn,false);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('兼容渠道只有明确保存才改变联网配置，保留其他参数并保持空密钥不修改',async()=>{
  const row={...nativeChannelRow,type:'CUSTOM',extra:{unrelated:'keep',webSearchProtocol:'retrieval'}};
  const f=await mount({loggedIn:true,admin:true,initialPath:'/models/channels',intercept:c=>c.url==='/api/models/channels'?relayJson([row]):c.method==='PATCH'?relayJson(row):undefined});
  try{
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='编辑').click();await settle();const checkbox=document.querySelector('.el-dialog input[type="checkbox"]');assert.equal(checkbox.checked,true);checkbox.click();await settle();assert.equal(f.calls.some(c=>c.method!=='GET'),false);
    [...document.querySelectorAll('.el-dialog button')].find(b=>b.textContent.trim()==='保存').click();await settle();const saved=f.calls.find(c=>c.method==='PATCH');assert.deepEqual(saved.body.extra,{unrelated:'keep'});assert.equal('apiKey' in saved.body,false);assert.equal('webSearchRetrieval' in saved.body,false);assert.equal(f.calls.some(c=>c.url.endsWith('/test')),false);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
function runResponse(call, initial = '') {
  let channel;
  const body = new ReadableStream({ start(c) { channel = c; if (initial) c.enqueue(new TextEncoder().encode(initial)); } });
  call.signal?.addEventListener('abort', () => { try { channel.error(new DOMException('aborted', 'AbortError')); } catch {} }, { once: true });
  return { response: new Response(body), write: value => channel.enqueue(new TextEncoder().encode(value)), close: () => channel.close() };
}
function typeChat(value) { const input = document.querySelector('[aria-label="消息输入框"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
function clickHistory(title) { [...document.querySelectorAll('.cv-conv')].find(el => el.textContent.includes(title)).click(); }

test('对话历史区分模型服务报送和估算用量，并解释输出上限', async () => {
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/conversations/c1') return relayJson({ id: 'c1', model: { name: 'qa-model' }, messages: [
      { id: 'u1', role: 'USER', content: '检查用量' },
      { id: 'a1', parentId: 'u1', role: 'ASSISTANT', status: 'COMPLETED', finishReason: 'length', content: '已保存的有限回复', promptTokens: 19, completionTokens: 11, usageEstimated: false },
      { id: 'u2', role: 'USER', content: '缺少用量' },
      { id: 'a2', parentId: 'u2', role: 'ASSISTANT', status: 'COMPLETED', content: '沿用估算的回复', promptTokens: 7, completionTokens: 4, usageEstimated: true },
    ] });
  } });
  try {
    clickHistory('普通对话'); await settle(); const text = document.querySelector('.cv-scroll').textContent;
    assert.match(text, /用量 30 · 模型服务返回/); assert.match(text, /用量 11 · 估算/); assert.match(text, /达到输出上限.*可以继续提问/);
    assert.equal(fixture.calls.some(x => x.url === '/api/chat/completions'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('本轮完成使用模型报送用量，保留原次数回执且不自动继续生成', async () => {
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/chat/completions') return new Response(runFrame(1, 'meta', { messageId: 'native-done', conversationId: 'c1' }) + runFrame(2, 'delta', { v: '原生接口的回复' }) + runFrame(3, 'done', { status: 'COMPLETED', finishReason: 'length', promptTokens: 23, completionTokens: 12, usageEstimated: false, contextLimit: 16000, billing: { state: 'SETTLED', pool: 'model3', limit: 2, charged: 2, reserved: 0 } }));
  } });
  try {
    document.querySelector('.qgc-empty-new').click(); await settle(); typeChat('检查本轮用量'); await settle(); document.querySelector('.cv-send').click(); await settle(); await settle();
    assert.match(document.querySelector('.cv-meta').textContent, /上下文 35 \/ 16000 · 模型服务返回/); assert.match(document.querySelector('.cv-billing').textContent, /已结算 2 次/); assert.match(document.querySelector('.cv-notice').textContent, /输出上限/); assert.equal(fixture.calls.filter(x => x.url === '/api/chat/completions').length, 1); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

const nativeChannelRow = { id: 'native-channel', name: 'QGauss 原生观察渠道', type: 'OPENAI_RESPONSES', baseUrl: 'https://gateway.qgauss.test/v1', apiKeyMasked: '****test', hasApiKey: true, priority: 1, weight: 1, timeoutMs: 10000, status: 'ENABLED', poolKeys: 0, poolKeysEnabled: 0 };
async function mountNativeChannels(intercept) { return mount({ loggedIn: true, admin: true, initialPath: '/models/channels', intercept: async call => { const custom = await intercept?.(call); if (custom) return custom; if (call.url === '/api/models/channels') return relayJson([nativeChannelRow]); if (call.url === '/api/models/channels/health') return relayJson([]); } }); }

test('渠道原生通信说明与根地址提示随选择变化，不自动保存或测试', async () => {
  const fixture = await mountNativeChannels();
  try {
    [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '新增渠道').click(); await settle();
    document.querySelector('.el-dialog .el-select__wrapper').click(); await settle();
    [...document.querySelectorAll('.el-select-dropdown__item')].find(x => x.textContent.trim() === 'Gemini · 原生接口').click(); await settle();
    assert.ok(document.querySelector('input[placeholder="https://generativelanguage.googleapis.com/v1beta"]')); assert.match(document.querySelector('.el-dialog .el-alert').textContent, /streamGenerateContent.*请求头/);
    assert.equal(fixture.calls.some(x => x.method !== 'GET'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('编辑原生渠道保持原地址和空密钥，明确保存才提交通信方式', async () => {
  const fixture = await mountNativeChannels(call => call.method === 'PATCH' ? relayJson(nativeChannelRow) : undefined);
  try {
    [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '编辑').click(); await settle();
    assert.equal(document.querySelector('input[placeholder="https://api.openai.com/v1"]').value, nativeChannelRow.baseUrl);
    assert.match(document.querySelector('.el-dialog .el-alert').textContent, /\/responses.*不自动执行工具/);
    assert.equal(document.querySelector('.el-dialog input[type="password"]').value, ''); assert.equal(fixture.calls.some(x => x.method !== 'GET'), false);
    [...document.querySelectorAll('.el-dialog button')].find(x => x.textContent.trim() === '保存').click(); await settle();
    const written = fixture.calls.find(x => x.method === 'PATCH'); assert.equal(written.body.type, 'OPENAI_RESPONSES'); assert.equal(written.body.baseUrl, nativeChannelRow.baseUrl); assert.equal('apiKey' in written.body, false); assert.equal(fixture.calls.some(x => x.url.endsWith('/test')), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('对话显示预留、保存结算与最终消耗，结算期间不能重复生成或停止', async () => {
  let live;
  const reserved = { state: 'RESERVED', pool: 'model3', limit: 2, reserved: 2, charged: 0 };
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/chat/completions') { live = runResponse(call, runFrame(1, 'meta', { messageId: 'count-run', conversationId: 'c1', billing: reserved }) + runFrame(2, 'delta', { v: '这是一段完整回复' })); return live.response; }
  } });
  try {
    document.querySelector('.qgc-empty-new').click(); await settle(); typeChat('记录本次消耗'); await settle(); document.querySelector('.cv-send').click(); await settle();
    assert.match(document.querySelector('.cv-billing').textContent, /已预留 2 次.*低价模型/);
    live.write(runFrame(3, 'snapshot', { messageId: 'count-run', conversationId: 'c1', content: '这是一段完整回复', status: 'SETTLING', billing: { ...reserved, state: 'SETTLING' } })); await settle();
    assert.match(document.querySelector('.cv-notice').textContent, /正在保存与结算.*无需重新发送/); assert.equal(document.querySelector('.cv-stop').disabled, true);
    assert.match(document.querySelector('.qgd-run-badge').textContent, /结算中/);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle(); assert.equal(fixture.calls.some(x => x.url.endsWith('/cancel')), false);
    live.write(runFrame(4, 'done', { status: 'COMPLETED', promptTokens: 4, completionTokens: 6, billing: { ...reserved, state: 'SETTLED', reserved: 0, charged: 2 }, charged: { pool: 'model3', amount: 2 } })); live.close(); await settle(); await settle();
    assert.match(document.querySelector('.cv-billing').textContent, /已结算 2 次.*低价模型/); assert.equal(document.querySelector('.cv-stop'), null);
    assert.equal(fixture.calls.filter(x => x.url === '/api/chat/completions').length, 1); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('重开保存结算中的历史只续接原回复，保留释放与过期说明', async () => {
  let live;
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/conversations/c1') return relayJson({ id: 'c1', model: { name: 'qa-model' }, messages: [{ id: 'u1', role: 'USER', content: '中止的提问' }, { id: 'pending-count', parentId: 'u1', role: 'ASSISTANT', content: '保留的部分文字', status: 'SETTLING', billing: { state: 'SETTLING', pool: 'model3', limit: 3, reserved: 3 } }] });
    if (call.url === '/api/chat/runs/pending-count/events') { live = runResponse(call, runFrame(0, 'snapshot', { messageId: 'pending-count', conversationId: 'c1', status: 'SETTLING', content: '保留的部分文字' })); return live.response; }
  } });
  try {
    clickHistory('普通对话'); await settle(); assert.match(document.querySelector('.cv-notice').textContent, /保存与结算/);
    assert.equal(document.querySelector('.cv-stop').disabled, true);
    live.write(runFrame(1, 'done', { status: 'ABORTED', billing: { state: 'RELEASED', pool: 'model3', limit: 3, reserved: 0, charged: 0, returned: 1, expired: 2 } })); live.close(); await settle(); await settle();
    assert.match(document.querySelector('.cv-billing').textContent, /本次未扣次数.*已释放 1 次.*2 次会员额度已到期/);
    assert.equal(fixture.calls.some(x => x.url === '/api/chat/completions'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('旧历史没有费用快照时不虚构免费或零消耗回执', async () => {
  const fixture = await mount({ loggedIn: true });
  try { clickHistory('普通对话'); await settle(); assert.equal(document.querySelector('.cv-billing'), null); assert.deepEqual(fixture.errors, []); }
  finally { await fixture.close(); }
});

test('切换会话只解除观察，重开进行中历史用快照续接且不重复发送', async () => {
  let initial;
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/chat/completions') { initial = runResponse(call, runFrame(1, 'meta', { messageId: 'run-1', conversationId: 'c1', userMessageId: 'u1' }) + runFrame(2, 'delta', { v: '最初半段' })); return initial.response; }
    if (call.url === '/api/conversations/c1') return new Response(JSON.stringify({ data: { id: 'c1', model: { name: 'qa-model' }, messages: [{ id: 'u1', role: 'USER', content: '继续写', status: 'COMPLETED' }, { id: 'run-1', parentId: 'u1', role: 'ASSISTANT', content: '旧落库快照', status: 'STREAMING' }] } }));
    if (call.url === '/api/chat/runs/run-1/events') return new Response(runFrame(10, 'snapshot', { messageId: 'run-1', conversationId: 'c1', status: 'STREAMING', content: '接回的前半', reasoning: '' }) + runFrame(11, 'delta', { v: '和后半' }) + runFrame(12, 'done', { status: 'COMPLETED' }));
  } });
  try {
    document.querySelector('.qgc-empty-new').click(); await settle(); typeChat('继续写'); await settle(); document.querySelector('.cv-send').click(); await settle();
    assert.ok(document.querySelector('.cv-stop'));
    document.querySelector('.cv-new').click(); await settle(); typeChat('另一个草稿');
    assert.equal(fixture.calls.filter(x => x.url.endsWith('/cancel')).length, 0);
    assert.equal(fixture.calls.find(x => x.url === '/api/chat/completions').signal.aborted, true);
    clickHistory('普通对话'); await settle(); await settle();
    assert.match(document.querySelector('.cv-scroll').textContent, /接回的前半和后半/);
    assert.doesNotMatch(document.querySelector('.cv-scroll').textContent, /旧落库快照接回/);
    assert.equal(document.querySelector('[aria-label="消息输入框"]').value, '另一个草稿');
    assert.equal(fixture.calls.filter(x => x.url === '/api/chat/completions').length, 1);
    assert.equal(fixture.calls.filter(x => x.url === '/api/chat/runs/run-1/events').length, 1);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('显式停止调用任务取消接口，保留已有内容和输入草稿', async () => {
  let live;
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/conversations/c1') return new Response(JSON.stringify({ data: { id: 'c1', model: { name: 'qa-model' }, messages: [{ id: 'u1', role: 'USER', content: '正在写作' }, { id: 'run-stop', parentId: 'u1', role: 'ASSISTANT', content: '', status: 'STREAMING' }] } }));
    if (call.url === '/api/chat/runs/run-stop/events') { live = runResponse(call, runFrame(2, 'snapshot', { messageId: 'run-stop', conversationId: 'c1', status: 'STREAMING', content: '保留的部分文字' })); return live.response; }
    if (call.url === '/api/chat/runs/run-stop/cancel') { live.write(runFrame(3, 'done', { status: 'ABORTED', finishReason: 'user_cancel' })); live.close(); return new Response(JSON.stringify({ data: { cancelRequested: true, status: 'RUNNING' } })); }
  } });
  try {
    clickHistory('普通对话'); await settle(); typeChat('尚未发送的草稿'); await settle();
    document.querySelector('.cv-stop').click(); await settle(); await settle();
    assert.equal(fixture.calls.filter(x => x.url === '/api/chat/runs/run-stop/cancel' && x.method === 'POST').length, 1);
    assert.equal(fixture.calls.some(x => x.url === '/api/chat/completions'), false);
    assert.match(document.querySelector('.cv-scroll').textContent, /保留的部分文字/);
    assert.equal(document.querySelector('[aria-label="消息输入框"]').value, '尚未发送的草稿');
    assert.equal(document.querySelector('.cv-stop'), null);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('旧发送的延迟响应不能覆盖新会话或清除新一轮的生成状态', async () => {
  let releaseFirst, second;
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url !== '/api/chat/completions') return;
    if (call.body.messages.at(-1).content === '第一个请求') return new Promise(resolve => { releaseFirst = resolve; });
    second = runResponse(call, runFrame(1, 'meta', { messageId: 'new-run', conversationId: 'c2' }) + runFrame(2, 'delta', { v: '新会话的内容' })); return second.response;
  } });
  try {
    document.querySelector('.qgc-empty-new').click(); await settle(); typeChat('第一个请求'); await settle(); document.querySelector('.cv-send').click(); await settle();
    document.querySelectorAll('.qgc-history-tabs button')[1].click(); await settle();
    clickHistory('应用对话'); await settle(); typeChat('第二个请求'); await settle(); document.querySelector('.cv-send').click(); await settle();
    releaseFirst(new Response(runFrame(1, 'meta', { messageId: 'old-run', conversationId: 'c1' }) + runFrame(2, 'delta', { v: '旧会话不应出现' }) + runFrame(3, 'done', { status: 'COMPLETED' })));
    await settle(); await settle();
    assert.ok(document.querySelector('.cv-stop'));
    assert.match(document.querySelector('.cv-scroll').textContent, /新会话的内容/);
    assert.doesNotMatch(document.querySelector('.cv-scroll').textContent, /旧会话不应出现/);
    assert.equal(fixture.calls.filter(x => x.url.endsWith('/cancel')).length, 0);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});


// Painting workspace: real Vue components and transport boundaries, with synthetic HTTP data.
const paintResponse = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'Content-Type': 'application/json' } });
const paintOptions = { ratios: [{ key: '1:1', w: 1, h: 1, scene: '方形' }, { key: '3:4', w: 3, h: 4, scene: '海报' }], resolutions: [{ key: '1K', label: '1K', base: 1024 }, { key: '2K', label: '2K', base: 2048 }], cats: [{ id: 'style-a', name: '柔光' }], models: [{ name: 'image-a', displayName: '图像 A', ready: true }] };
function paintingTask(id, extra = {}) { return { id, prompt: '作品 ' + id, model: 'image-a', versionName: '图像 A', status: 'SUCCESS', n: 2, ratio: '3:4', resolution: '2K', quality: 'high', seed: 0, catId: 'style-a', mode: 'text2img', size: '1536x2048', published: false, createdAt: '2026-10-31T01:00:00Z', results: [1, 2].map(i => ({ fileId: id + '-' + i, mime: 'image/png', url: '/api/image/tasks/' + id + '/results/' + id + '-' + i })), ...extra }; }
async function mountPainting({ items = [paintingTask('first')], squareItems = [], intercept } = {}) {
  const fixture = await mount({ loggedIn: true, intercept: async call => {
    const custom = await intercept?.(call); if (custom) return custom;
    if (call.url === '/api/image/options') return paintResponse(paintOptions);
    if (call.url.startsWith('/api/image/tasks?')) return paintResponse({ items, total: items.length });
    if (call.url.startsWith('/api/image/square?')) return paintResponse({ items: squareItems, total: squareItems.length });
    if (/^\/api\/(image\/tasks\/[^/]+\/results\/|upload\/)/.test(call.url)) return new Response(new Blob(['image fixture'], { type: 'image/png' }), { headers: { 'Content-Type': 'image/png' } });
    const item = [...items, ...squareItems].find(t => call.url === '/api/image/tasks/' + t.id);
    if (item && call.method === 'GET') return paintResponse({ ...item, mine: items.some(t => t.id === item.id), events: [] });
    if (call.url === '/api/image/tasks' && call.method === 'POST') return paintResponse(paintingTask('accepted', { status: 'QUEUED', results: [] }));
  } });
  await fixture.router.push('/painting'); await settle(); return fixture;
}
function paintClick(selector, text) { const button = [...document.querySelectorAll(selector)].find(el => el.textContent.includes(text)); assert.ok(button, 'missing painting action ' + text); button.click(); }

test('作品详情逐张切换与下载选择一致，列表和详情不会重复下载第一张', async () => {
  const fixture = await mountPainting(); const links = [], nativeClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { links.push({ href: this.href, filename: this.download }); };
  try {
    document.querySelector('.qp-image-button').click(); await settle();
    const first = document.querySelector('.qp-detail-image-area>img').src;
    document.querySelector('[aria-label="下一张作品"]').click(); await settle();
    assert.match(document.querySelector('.qp-detail-image-area>img').alt, /第 2 张/);
    assert.notEqual(document.querySelector('.qp-detail-image-area>img').src, first);
    document.querySelector('.qp-primary-action').click(); await settle();
    assert.equal(links.length, 1); assert.match(links[0].filename, /-2\.png$/); assert.ok(links[0].href.startsWith('blob:'));
    assert.equal(fixture.calls.filter(call => call.url.endsWith('/results/first-1')).length, 1);
    assert.deepEqual(fixture.errors, []);
  } finally { window.HTMLAnchorElement.prototype.click = nativeClick; await fixture.close(); }
});

test('关闭后再打开另一件作品，旧详情的迟到结果不会覆盖新作品', async () => {
  let finish;
  const fixture = await mountPainting({ items: [paintingTask('first'), paintingTask('second')], intercept: call => call.url === '/api/image/tasks/first' ? new Promise(resolve => { finish = resolve; }) : null });
  try {
    document.querySelectorAll('.qp-image-button')[0].click(); await settle();
    document.querySelector('[aria-label="关闭作品详情"]').click(); await settle();
    document.querySelectorAll('.qp-image-button')[1].click(); await settle();
    finish(paintResponse({ ...paintingTask('first'), mine: true })); await settle();
    assert.equal(document.querySelector('.qp-artwork-dialog').open, true);
    assert.equal(document.querySelector('.qp-detail-prompt').textContent, '作品 second');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('自己的图生图复用完整参数与零种子，只有明确点击生成才提交', async () => {
  const fixture = await mountPainting({ items: [paintingTask('owned', { mode: 'img2img', editOf: 'own-reference' })] });
  try {
    document.querySelector('.qp-image-button').click(); await settle(); document.querySelector('.qp-secondary-action').click(); await settle();
    assert.equal(fixture.calls.some(call => call.method === 'POST'), false);
    const promptInput = document.querySelector('#qp-prompt');
    assert.equal(document.activeElement, promptInput);
    document.querySelector('.qp-artwork-dialog').dispatchEvent(new Event('close'));
    await settle();
    assert.equal(document.activeElement, promptInput, 'delayed native close keeps reuse editing focus');
    assert.match(document.querySelector('.qp-reference-tile img').alt, /原作参考图/);
    document.querySelector('.qp-generate').click(); await settle();
    const request = fixture.calls.find(call => call.method === 'POST' && call.url === '/api/image/tasks');
    assert.equal(request.body.seed, 0); assert.equal(request.body.editOf, 'own-reference'); assert.equal(request.body.model, 'image-a');
    assert.equal(request.body.catId, 'style-a'); assert.equal(request.body.n, 2); assert.equal(request.body.quality, 'high');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('复用公开图生图先清除旧参考图，未选择自己的参考图时不提交', async () => {
  const fixture = await mountPainting({ items: [paintingTask('owned', { mode: 'img2img', editOf: 'old-private-reference' })], squareItems: [paintingTask('public', { mode: 'img2img', published: true, editOf: null })] });
  try {
    document.querySelector('.qp-image-button').click(); await settle(); document.querySelector('.qp-secondary-action').click(); await settle();
    paintClick('.qp-gallery-tabs button', '灵感广场'); await settle(); document.querySelector('.qp-image-button').click(); await settle();
    assert.equal(document.querySelector('.qp-owner-actions'), null);
    document.querySelector('.qp-secondary-action').click(); await settle(); document.querySelector('.qp-generate').click(); await settle();
    assert.equal(fixture.calls.some(call => call.method === 'POST'), false);
    assert.equal(document.querySelectorAll('.qp-reference-tile img').length, 0);
    assert.equal(document.querySelector('.qp-reference>img'), null); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('画廊失败保留草稿且可重试，不把网络失败显示成没有作品', async () => {
  let failures = true;
  const fixture = await mountPainting({ intercept: call => call.url.startsWith('/api/image/tasks?') && failures ? new Response('{"message":"unavailable"}', { status: 503 }) : null });
  try {
    assert.match(document.querySelector('.qp-gallery [role="alert"]').textContent, /作品暂未更新/);
    assert.equal(document.querySelector('.qp-empty-artboard'), null);
    const textarea = document.querySelector('[aria-label="绘画提示词"]'); textarea.value = '保留这段描述'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    failures = false; paintClick('.qp-gallery .qp-inline-error button', '再试一次'); await settle();
    assert.equal(document.querySelectorAll('.qp-card').length, 1); assert.equal(textarea.value, '保留这段描述'); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('快速切换画廊时迟到的旧列表不覆盖新列表，提交期间双击只产生一个任务', async () => {
  let firstList, finishCreate, lists = 0;
  const fixture = await mountPainting({ intercept: call => {
    if (call.url.startsWith('/api/image/tasks?') && ++lists === 1) return new Promise(resolve => { firstList = resolve; });
    if (call.url === '/api/image/tasks' && call.method === 'POST') return new Promise(resolve => { finishCreate = resolve; });
  } });
  try {
    paintClick('.qp-gallery-tabs button', '灵感广场'); await settle(); paintClick('.qp-gallery-tabs button', '我的画廊'); await settle();
    firstList(paintResponse({ items: [paintingTask('stale')], total: 1 })); await settle();
    assert.doesNotMatch(document.querySelector('.qp-gallery').textContent, /作品 stale/);
    const textarea = document.querySelector('[aria-label="绘画提示词"]'); textarea.value = '画一座云上的屋子'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const button = document.querySelector('.qp-generate'); button.click(); button.click(); await settle();
    assert.equal(fixture.calls.filter(call => call.method === 'POST' && call.url === '/api/image/tasks').length, 1);
    finishCreate(paintResponse(paintingTask('accepted'))); await settle(); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('离开绘画页后迟到的列表不会加载私有图片或启动轮询', async () => {
  let finish;
  const fixture = await mountPainting({ intercept: call => call.url.startsWith('/api/image/tasks?') ? new Promise(resolve => { finish = resolve; }) : null });
  await fixture.close(); const previous = fixture.calls.length;
  finish(paintResponse({ items: [paintingTask('late')], total: 1 })); await settle();
  assert.equal(fixture.calls.length, previous); assert.equal(document.querySelector('.qp-artwork-dialog'), null); assert.deepEqual(fixture.errors, []);
});

test('旧报价被拒后刷新费用，保留描述并等待再次点击才提交新费用', async () => {
  let cost = 1, attempts = 0;
  const fixture = await mountPainting({ intercept: call => {
    if (call.url === '/api/image/options') return paintResponse({ ...paintOptions, billing: { enabled: true, costPerImage: cost, qualityFactors: { auto: 1, high: 2 }, reservation: true } });
    if (call.url === '/api/image/tasks' && call.method === 'POST' && ++attempts === 1) { cost = 3; return new Response(JSON.stringify({ message: '绘画费用已更新，请确认新费用后再次生成' }), { status: 409 }); }
  } });
  try {
    const prompt = document.querySelector('#qp-prompt'); prompt.value = '保留我的创作描述'; prompt.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.qp-generate').click(); await settle();
    assert.equal(attempts, 1); assert.equal(prompt.value, '保留我的创作描述');
    assert.match(document.querySelector('.qp-actions p').textContent, /预计 3 次/);
    assert.equal(fixture.calls.find(c => c.method === 'POST' && c.url === '/api/image/tasks').body.expectedUnitCost, 1);
    document.querySelector('.qp-generate').click(); await settle();
    assert.equal(attempts, 2);
    assert.equal(fixture.calls.filter(c => c.method === 'POST' && c.url === '/api/image/tasks')[1].body.expectedUnitCost, 3);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('保存与结算中的作品继续显示进度和预留费用，不显示取消或回收操作', async () => {
  const item = paintingTask('settling', { status: 'SETTLING', results: [], billing: { state: 'RESERVED', unitCost: 2, reserved: 4, charged: 0 } });
  const fixture = await mountPainting({ items: [item] });
  try {
    document.querySelector('.qp-card-actions button').click(); await settle();
    assert.match(document.querySelector('.qp-card').textContent, /正在保存与结算/);
    assert.match(document.querySelector('.qp-billing').textContent, /次数已预留/);
    assert.match(document.querySelector('.qp-billing').textContent, /已预留 4 次/);
    assert.doesNotMatch(document.querySelector('.qp-owner-actions').textContent, /取消生成|移入回收/);
    assert.equal(document.querySelector('.qp-primary-action').disabled, true);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('画廊任务完成时，打开的详情同步费用与完整足迹，不必关闭重开', async () => {
  const item = paintingTask('phase', { status: 'RUNNING', results: [], billing: { state: 'RESERVED', unitCost: 1, reserved: 2, charged: 0 } });
  const fixture = await mountPainting({ items: [item], intercept: call => {
    if (call.url === '/api/image/tasks/phase') return paintResponse({ ...item, mine: true, events: item.status === 'SUCCESS' ? [1, 2, 3].map(id => ({ id, message: '步骤 ' + id })) : [{ id: 1, message: '步骤 1' }] });
  } });
  try {
    document.querySelector('.qp-card-actions button').click(); await settle();
    Object.assign(item, paintingTask('phase', { billing: { state: 'SETTLED', unitCost: 1, reserved: 0, charged: 2, returned: 0 } }));
    document.querySelector('.qp-refresh').click(); await settle(); await settle();
    assert.equal(document.querySelector('.qp-artwork-dialog').open, true);
    assert.match(document.querySelector('.qp-billing').textContent, /本次已结算/);
    assert.match(document.querySelector('.qp-timeline summary').textContent, /3/);
    assert.equal(document.querySelectorAll('.qp-image-filmstrip button').length, 2);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('完成阶段的迟到详情刷新不能覆盖后来打开的另一件作品', async () => {
  const first = paintingTask('phase-old', { status: 'RUNNING', results: [] }), second = paintingTask('phase-new');
  let calls = 0, finish;
  const fixture = await mountPainting({ items: [first, second], intercept: call => {
    if (call.url === '/api/image/tasks/phase-old' && ++calls > 1) return new Promise(resolve => { finish = resolve; });
  } });
  try {
    document.querySelector('.qp-card-actions button').click(); await settle();
    Object.assign(first, paintingTask('phase-old'));
    document.querySelector('.qp-refresh').click(); await settle();
    assert.equal(typeof finish, 'function');
    document.querySelector('[aria-label="关闭作品详情"]').click(); await settle();
    document.querySelectorAll('.qp-image-button')[1].click(); await settle();
    finish(paintResponse({ ...first, mine: true })); await settle();
    assert.equal(document.querySelector('.qp-detail-prompt').textContent, '作品 phase-new');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('钱包流水卡区分预留、结算和释放，不把结算显示为再次扣可用次数', async () => {
  const fixture = await mount({ loggedIn: true, intercept: call => {
    if (call.url === '/api/settings/public') return paintResponse({ 'commerce.enabled': true });
    if (call.url === '/api/balance/query') return paintResponse({ balanceYuan: '0.00', counts: { drawMj: 8 }, reserved: { drawMj: 4 } });
    if (call.url === '/api/signin/signinLog') return paintResponse({ enabled: false });
    if (call.url.startsWith('/api/balance/consumeLog')) return paintResponse({ items: [
      { id: 's', direction: 1, sourceLogId: 'h', amount: 4, deductionType: 'drawMj', modelName: 'QGauss 图像样例' },
      { id: 'r', direction: 5, sourceLogId: 'h', amount: 2, deductionType: 'drawMj' },
      { id: 'h', direction: 4, amount: 6, deductionType: 'drawMj' },
    ] });
  } });
  try {
    await fixture.router.push('/wallet'); await settle(); await settle();
    const cards = [...document.querySelectorAll('.wl-mobile-ledger article')];
    assert.equal(cards.length, 3);
    assert.match(cards[0].textContent, /结算.*4 次.*无变动/);
    assert.match(cards[1].textContent, /释放.*2 次.*\+2 次/);
    assert.match(cards[2].textContent, /预留.*6 次.*−6 次/);
    assert.match(document.querySelector('.wl-reserved').textContent, /4 次/);
    assert.equal(fixture.calls.some(call => call.method === 'POST'), false);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

function energyBalance() { return { balanceYuan: '12.34', balanceCents: 1234, isMember: true, expirationTime: '9999-12-31T00:00:00Z', counts: { model3: 15, model4: 8, drawMj: 6, agent: 2 }, paid: { model3: 10, model4: 5, drawMj: 6, agent: 2 }, member: { model3: 5, model4: 3 }, daily: { model3: 10, model4: 5 }, reserved: { drawMj: 4 }, used: { model3: 7 } }; }
function memberOffer(extra={}) { return {id:'offer-a',name:'创作补给',des:'<img src=x onerror=alert(1)>',priceCents:1990,days:30,model3Count:10,model4Count:5,drawMjCount:3,agentCount:2,offerRevision:'a'.repeat(64),...extra}; }
function memberOrder(extra={}) { return {orderId:'qgauss-order-a',goodsName:'已接受的补给',goodsType:'package',count:1,totalCents:1990,status:0,expiresAt:'2026-11-01T00:00:00Z',entitlements:memberOffer(),...extra}; }
function memberIntercept(call) {
  if(call.url==='/api/settings/public')return paintResponse({'commerce.enabled':true});
  if(call.url==='/api/balance/query')return paintResponse(energyBalance());
  if(call.url==='/api/crami/packages')return paintResponse({items:[memberOffer(),memberOffer({id:'offer-b',name:'次数补充',days:0,offerRevision:'b'.repeat(64)})]});
  if(call.url.startsWith('/api/order/list'))return paintResponse({items:[memberOrder()],total:1});
  if(call.url==='/api/order/create')return paintResponse(memberOrder());
  if(call.url.startsWith('/api/order/detail/'))return paintResponse(memberOrder());
  if(call.url.startsWith('/api/pay/prepare/'))return paintResponse({mock:true,provider:'mock'});
  if(call.url.startsWith('/api/pay/status/'))return paintResponse({orderId:'qgauss-order-a',status:0,totalCents:1990});
  return energyIntercept(call);
}
async function selectMemberOffer() { document.querySelector('.qc-offer-card .qc-primary').click(); await settle(); }
test('选择套餐只打开确认，不下单、不准备支付，介绍按文本呈现且关闭返回入口',async()=>{
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:memberIntercept});
  try{
    await selectMemberOffer();assert.equal(document.querySelector('.qc-checkout-dialog').open,true);
    assert.match(document.querySelector('.qc-checkout-dialog').textContent,/19.90.*会员 30 天/s);
    assert.equal(document.querySelector('.qc-offer-card img'),null);assert.match(document.querySelector('.qc-offer-description').textContent,/<img src=x/);
    assert.equal(fixture.calls.some(c=>c.method==='POST'),false);
    document.querySelector('[aria-label="关闭订单详情"]').click();await settle();
    assert.equal(document.querySelector('.qc-checkout-dialog').open,false);
    assert.equal(document.activeElement,document.querySelector('.qc-offer-card .qc-primary'));assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('确认下单单飞并携带已查看版本，模拟付款必须另行明确点击',async()=>{
  let finish;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>{
    if(call.url==='/api/order/create')return new Promise(resolve=>{finish=()=>resolve(paintResponse(memberOrder()));});
    if(call.url.startsWith('/api/pay/mock/'))return paintResponse({status:1,paid:true});
    return memberIntercept(call);
  }});
  try{
    await selectMemberOffer();const confirm=document.querySelector('.qc-checkout-dialog>.qc-primary');confirm.click();confirm.click();await settle();
    assert.equal(fixture.calls.filter(c=>c.url==='/api/order/create').length,1);
    const payload=fixture.calls.find(c=>c.url==='/api/order/create').body;assert.equal(payload.expectedOfferRevision,'a'.repeat(64));assert.match(payload.requestKey,/^[a-f0-9-]{36}$/);
    finish();await settle();await settle();
    assert.equal(fixture.calls.some(c=>c.url.startsWith('/api/pay/mock/')),false);
    assert.match(document.querySelector('.qc-checkout-dialog').textContent,/等待付款.*模拟支付/s);
    document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();await settle();
    assert.equal(fixture.calls.filter(c=>c.url.startsWith('/api/pay/mock/')).length,1);
    assert.match(document.querySelector('.qc-checkout-dialog').textContent,/已支付.*权益到账/s);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('支付准备失败保留同一订单，重试不会再次下单',async()=>{
  let failing=true;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>call.url.startsWith('/api/pay/prepare/')&&failing?new Response(JSON.stringify({message:'通道暂不可用'}),{status:503}):memberIntercept(call)});
  try{
    await selectMemberOffer();document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();await settle();
    assert.match(document.querySelector('.qc-checkout-dialog').textContent,/qgauss-order-a.*通道暂不可用/s);
    failing=false;document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();
    assert.equal(fixture.calls.filter(c=>c.url==='/api/order/create').length,1);
    assert.equal(fixture.calls.filter(c=>c.url.startsWith('/api/pay/prepare/')).length,2);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('丢失下单响应可在离开后恢复相同请求，且恢复前不会自动重发',async()=>{
  let first=true;const payloads=[];
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>{
    if(call.url==='/api/order/create'){payloads.push(call.body);if(first){first=false;return new Response('{}',{status:503});}}
    return memberIntercept(call);
  }});
  try{
    await selectMemberOffer();document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();
    assert.match(document.querySelector('.qc-inline-error').textContent,/尚未确认/);
    await fixture.router.push('/chat');await settle();await fixture.router.push('/recharge');await settle();await settle();
    assert.ok(document.querySelector('.qc-recovery'));assert.equal(payloads.length,1);
    document.querySelector('.qc-recovery button').click();await settle();document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();await settle();
    assert.equal(payloads.length,2);assert.deepEqual(payloads[0],payloads[1]);assert.equal(sessionStorage.getItem('qg:checkout-pending:test-user'),null);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('确认版本变化 409 后更新套餐并重新选择，不自动接受更高价格',async()=>{
  let changed=false;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>{
    if(call.url==='/api/order/create'){changed=true;return new Response(JSON.stringify({message:'套餐已更新'}),{status:409});}
    if(call.url==='/api/crami/packages'&&changed)return paintResponse({items:[memberOffer({priceCents:2990,offerRevision:'b'.repeat(64)})]});
    return memberIntercept(call);
  }});
  try{
    await selectMemberOffer();document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();
    assert.match(document.querySelector('.qc-inline-error').textContent,/套餐已更新/);
    document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();await settle();
    assert.match(document.querySelector('.qc-offer-price').textContent,/29.90/);assert.equal(document.querySelector('.qc-checkout-dialog').open,false);
    assert.equal(fixture.calls.filter(c=>c.url==='/api/order/create').length,1);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('关闭等待中的下单弹窗会中止读取并保留恢复标识，迟到结果不能启动支付',async()=>{
  let finish;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>call.url==='/api/order/create'?new Promise(resolve=>{finish=resolve;}):memberIntercept(call)});
  try{
    await selectMemberOffer();document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();
    const req=fixture.calls.find(c=>c.url==='/api/order/create');
    document.querySelector('[aria-label="关闭订单详情"]').click();await settle();assert.equal(req.signal.aborted,true);
    finish(paintResponse(memberOrder()));await settle();
    assert.equal(document.querySelector('.qc-checkout-dialog').open,false);assert.ok(document.querySelector('.qc-recovery'));
    assert.equal(fixture.calls.some(c=>c.url.startsWith('/api/pay/prepare/')),false);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('切换账号中止旧订单创建，清除旧账号恢复标识与付款操作',async()=>{
  let finish;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>call.url==='/api/order/create'?new Promise(resolve=>{finish=resolve;}):memberIntercept(call)});
  try{
    await selectMemberOffer();document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();
    const req=fixture.calls.find(c=>c.url==='/api/order/create');fixture.auth.apply({accessToken:'other-access',refreshToken:'other-refresh',user:{id:'other-user',username:'另一账号',role:'USER'}});await settle();await settle();
    assert.equal(req.signal.aborted,true);assert.equal(sessionStorage.getItem('qg:checkout-pending:test-user'),null);
    finish(paintResponse(memberOrder()));await settle();assert.equal(document.querySelector('.qc-checkout-dialog').open,false);
    assert.equal(fixture.calls.some(c=>c.url.startsWith('/api/pay/prepare/')),false);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('余额充值拒绝零和多余精度，确认前不下单，确认金额保持精确分',async()=>{
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:memberIntercept});
  try{
    const input=document.querySelector('[aria-label="充值金额"]'),form=input.closest('form');
    for(const value of ['0','1.001']){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();assert.match(document.querySelector('.qc-money-card .qc-inline-error').textContent,/最多两位小数/);}
    input.value='5.05';input.dispatchEvent(new Event('input',{bubbles:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
    assert.equal(fixture.calls.some(c=>c.url==='/api/order/create'),false);assert.match(document.querySelector('.qc-checkout-price').textContent,/5.05/);
    document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();const call=fixture.calls.find(c=>c.url==='/api/order/create');assert.equal(call.body.goodsType,'money');assert.equal(call.body.amountYuan,'5.05');assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('卡密错误不会关闭整页，长期会员权益不显示为负一天',async()=>{
  let valid=false;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>{
    if(call.url==='/api/crami/exchange')return valid?paintResponse({granted:{days:-1,model3Count:10}}):new Response(JSON.stringify({message:'卡密不存在'}),{status:404});
    return memberIntercept(call);
  }});
  try{
    const input=document.querySelector('[aria-label="兑换卡密"]');input.value='ABCD-EFGH-JKMN';input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
    assert.match(document.querySelector('.qc-redeem-card').textContent,/卡密不存在/);assert.ok(document.querySelector('.qc-offer-grid'));
    valid=true;input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();assert.match(document.querySelector('.qc-grant-message.is-success').textContent,/长期会员/);assert.doesNotMatch(document.querySelector('.qc-grant-message.is-success').textContent,/-1/);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('兑换响应不确定时不重复提交，引导查看实际兑换记录',async()=>{
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>call.url==='/api/crami/exchange'?new Response('{}',{status:503}):memberIntercept(call)});
  try{
    const input=document.querySelector('[aria-label="兑换卡密"]');input.value='ABCD-EFGH-JKMN';input.dispatchEvent(new Event('input',{bubbles:true}));const form=input.closest('form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
    assert.equal(fixture.calls.filter(c=>c.url==='/api/crami/exchange').length,1);assert.equal(document.querySelector('.qc-redeem-card button[type=submit]').disabled,true);assert.equal(document.querySelector('.qc-grant-message a').getAttribute('href'),'/wallet');
  }finally{await fixture.close();}
});
test('支付准备拒绝脚本地址，支付页返回参数不能伪造已到账状态',async()=>{
  const fixture=await mount({loggedIn:true,initialPath:'/recharge?order=qgauss-order-a&paid=true',intercept:call=>call.url.startsWith('/api/pay/prepare/')?paintResponse({payUrl:'javascript:alert(1)'}):memberIntercept(call)});
  try{
    await settle();assert.match(document.querySelector('.qc-checkout-dialog').textContent,/等待付款/);assert.equal(fixture.calls.some(c=>c.method==='POST'),false);
    document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();assert.match(document.querySelector('.qc-inline-error').textContent,/付款地址无效/);
    assert.equal(document.querySelector('.qc-checkout-dialog a[target=_blank]'),null);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('支付结果不确定时先读取状态，已关闭订单不能继续获取付款方式',async()=>{
  let closed=false;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge?order=qgauss-order-a',intercept:call=>{
    if(call.url.startsWith('/api/order/close/')){closed=true;return new Response('{}',{status:503});}
    if(call.url.startsWith('/api/pay/status/'))return paintResponse({status:closed?3:0});
    return memberIntercept(call);
  }});
  try{
    await settle();document.querySelector('.qc-checkout-actions button:last-child').click();await settle();assert.match(document.querySelector('.qc-checkout-dialog>.qc-primary').textContent,/先确认订单状态/);
    document.querySelector('.qc-checkout-dialog>.qc-primary').click();await settle();assert.match(document.querySelector('.qc-checkout-dialog').textContent,/订单已关闭/);
    assert.equal(document.querySelector('.qc-checkout-actions'),null);assert.equal(fixture.calls.some(c=>c.url.startsWith('/api/pay/mock/')),false);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('订单筛选与分页使用服务端总数，迟到旧页不会覆盖新状态',async()=>{
  let finish;
  const fixture=await mount({loggedIn:true,initialPath:'/recharge',intercept:call=>{
    if(call.url.startsWith('/api/order/list')){const url=new URL('https://qgauss.test'+call.url);if(url.searchParams.get('page')==='2')return new Promise(resolve=>{finish=resolve;});return paintResponse({items:[memberOrder({status:url.searchParams.has('status')?1:0})],total:url.searchParams.has('status')?1:7});}
    return memberIntercept(call);
  }});
  try{
    document.querySelector('[aria-label="下一页订单"]').click();await settle();
    const filter=document.querySelector('[aria-label="订单状态"]');filter.value='1';filter.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    finish(paintResponse({items:[memberOrder()],total:7}));await settle();
    assert.match(document.querySelector('.qc-order-list').textContent,/权益到账/);assert.equal(document.querySelector('[aria-label="下一页订单"]').disabled,true);
    const query=new URL('https://qgauss.test'+fixture.calls.filter(c=>c.url.startsWith('/api/order/list')).at(-1).url);assert.equal(query.searchParams.get('page'),'1');assert.equal(query.searchParams.get('status'),'1');assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
test('订单详情保留下单快照并按数量显示，不用后来读取的套餐替换',async()=>{
  const fixture=await mount({loggedIn:true,initialPath:'/recharge?order=qgauss-order-a',intercept:call=>call.url.startsWith('/api/order/detail/')?paintResponse(memberOrder({count:2,totalCents:3980,entitlements:memberOffer({model3Count:7})})):memberIntercept(call)});
  try{
    await settle();assert.match(document.querySelector('.qc-checkout-price').textContent,/39.80/);assert.match(document.querySelector('.qc-checkout-benefits').textContent,/低价模型14 次/);assert.match(document.querySelector('.qc-checkout-benefits').textContent,/会员 60 天/);assert.deepEqual(fixture.errors,[]);
  }finally{await fixture.close();}
});
function energySignin(extra = {}) { return { enabled: true, today: '2026-11-01', signedToday: false, reward: 2, rewardPool: 'model4', items: [{ signInDate: '2026-10-31' }], ...extra }; }
function energyRow(id = 'energy-1') { return { id, uid: 'test-receipt', createdAt: '2026-10-31T16:30:00Z', direction: 1, sourceLogId: 'reserved-original', deductionType: 'drawMj', amount: 2, modelName: 'QGauss 图像', remark: '<img src=x onerror=alert(1)>', refId: 'work-reference' }; }
test('直接切换账号会清空共享额度并忽略旧响应，顶栏不把不同次数相加成积分', async () => {
  const pending = [];
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => call.url === '/api/balance/query' && call.authorization === 'Bearer test-access' ? new Promise(resolve => pending.push({ resolve, signal: call.signal })) : energyIntercept(call) });
  try {
    fixture.auth.apply({ accessToken: 'new-user-access', refreshToken: 'new-user-refresh', user: { id: 'new-user', username: '新账号', role: 'USER' } }); await settle(); await settle();
    assert.ok(pending.length >= 1); assert.ok(pending.every(request => request.signal.aborted));
    for (const request of pending) request.resolve(paintResponse({ ...energyBalance(), balanceYuan: '9999.00', balanceCents: 999900 }));
    await settle();
    assert.match(document.querySelector('.qe-pass').textContent, /12.34/);
    assert.doesNotMatch(document.querySelector('.qe-pass').textContent, /9999/);
    assert.match(document.querySelector('.qgc-credit').textContent, /我的额度/);
    assert.doesNotMatch(document.querySelector('.qgc-credit').textContent, /积分/);
    assert.match(document.querySelector('.qgc-credit').title, /12.34/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
function energyIntercept(call) {
  if (call.url === '/api/settings/public') return paintResponse({ 'commerce.enabled': true });
  if (call.url === '/api/balance/query') return paintResponse(energyBalance());
  if (call.url === '/api/signin/signinLog') return paintResponse(energySignin());
  if (/^\/api\/(balance\/(consumeLog|rechargeLog)|crami\/myLog)/.test(call.url)) return paintResponse({ items: [energyRow()], total: 1 });
}
test('钱包首屏失败不会伪装成零余额，重试后区分购买/会员/预留并按服务器日期显示签到', async () => {
  let broken = true;
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => call.url === '/api/balance/query' && broken ? new Response(JSON.stringify({ message: 'offline' }), { status: 503 }) : energyIntercept(call) });
  try {
    assert.equal(document.querySelector('.qe-pass'), null); assert.match(document.querySelector('.qe-error').textContent, /余额尚未确认/);
    broken = false; document.querySelector('.qe-error button').click(); await settle(); await settle();
    assert.match(document.querySelector('.qe-pass').textContent, /12.34.*会员长期有效/s);
    assert.match(document.querySelector('.qe-pool-model3').textContent, /15.*购买剩余10.*今日会员剩余5.*10/s);
    assert.equal(document.querySelectorAll('.qe-calendar>div').length, 7);
    assert.equal(document.querySelector('.qe-calendar .is-today').getAttribute('aria-label'), '2026-11-01 未签到');
    assert.match(document.querySelector('.qe-signin-copy').textContent, /2 次高价模型/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('钱包筛选与翻页查询服务端完整记录，详情保留关联流水并按文本渲染说明', async () => {
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => call.url.startsWith('/api/balance/consumeLog') ? paintResponse({ items: [energyRow(new URL('https://qgauss.test'+call.url).searchParams.get('page'))], total: 21 }) : energyIntercept(call) });
  try {
    const pool = document.querySelector('[aria-label="额度类型"]'); pool.value = 'drawMj'; pool.dispatchEvent(new Event('change', { bubbles: true }));
    const direction = document.querySelector('[aria-label="流水动作"]'); direction.value = '1'; direction.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.querySelector('[aria-label="搜索流水"]'); input.value = '图像'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.qe-log-filters').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
    document.querySelector('[aria-label="下一页记录"]').click(); await settle();
    const url = new URL('https://qgauss.test'+fixture.calls.filter(c=>c.url.startsWith('/api/balance/consumeLog')).at(-1).url);
    assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('deductionType'), 'drawMj'); assert.equal(url.searchParams.get('direction'), '1'); assert.equal(url.searchParams.get('keyword'), '图像');
    document.querySelector('.qe-record-open').click(); await settle();
    assert.equal(document.querySelector('.qe-receipt').open, true);
    assert.match(document.querySelector('.qe-receipt').textContent, /关联流水.*reserved-original/s);
    assert.match(document.querySelector('.qe-receipt').textContent, /无变动/);
    assert.equal(document.querySelector('.qe-receipt img'), null);
    assert.match(document.querySelector('.qe-receipt').textContent, /<img src=x/);
    document.querySelector('[aria-label="关闭记录详情"]').click(); await settle();
    assert.equal(document.querySelector('.qe-receipt').open, false);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('切换记录标签中止旧请求，迟到用量不会覆盖到账记录，标签支持方向键', async () => {
  let finish;
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => {
    if (call.url.startsWith('/api/balance/consumeLog')) return new Promise(resolve => { finish = resolve; });
    if (call.url.startsWith('/api/balance/rechargeLog')) return paintResponse({ items: [{ id: 'grant', rechargeType: 'signin', model4Count: 2 }], total: 1 });
    return energyIntercept(call);
  } });
  try {
    document.querySelector('#qe-tab-consume').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle();
    assert.equal(document.querySelector('#qe-tab-recharge').getAttribute('aria-selected'), 'true');
    assert.equal(fixture.calls.find(c=>c.url.startsWith('/api/balance/consumeLog')).signal.aborted, true);
    finish(paintResponse({ items: [energyRow()], total: 99 })); await settle();
    assert.match(document.querySelector('.qe-record-list').textContent, /签到奖励.*高价模型 2 次/s);
    assert.doesNotMatch(document.querySelector('.qe-record-list').textContent, /QGauss 图像/);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('签到连点只发送一次，成功后更新余额和服务器签到状态，不自动提交其他写操作', async () => {
  let finish, signed = false;
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => {
    if (call.url === '/api/signin/sign') return new Promise(resolve => { finish = () => { signed = true; resolve(paintResponse({ reward: 2, pool: 'model4' })); }; });
    if (call.url === '/api/signin/signinLog') return paintResponse(energySignin({ signedToday: signed, streak: signed ? 1 : 0 }));
    return energyIntercept(call);
  } });
  try {
    const button = document.querySelector('.qe-sign-button'); button.click(); button.click(); await settle();
    assert.equal(fixture.calls.filter(c=>c.method==='POST').length, 1); assert.equal(button.disabled, true);
    finish(); await settle(); await settle();
    assert.match(document.querySelector('.qe-sign-message').textContent, /已到账 2 次高价模型/);
    assert.equal(document.querySelector('.qe-sign-button').disabled, true);
    assert.ok(fixture.calls.filter(c=>c.url==='/api/balance/query').length >= 2);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('签到响应丢失后先读取状态，不能连续重发不确定的领取操作', async () => {
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => call.url === '/api/signin/sign' ? new Response('{}', { status: 503 }) : energyIntercept(call) });
  try {
    document.querySelector('.qe-sign-button').click(); await settle();
    assert.equal(document.querySelector('.qe-sign-button').disabled, true);
    assert.match(document.querySelector('.qe-sign-message').textContent, /尚未确认/);
    document.querySelector('.qe-signin-copy p button').click(); await settle();
    assert.equal(document.querySelector('.qe-sign-button').disabled, false);
    assert.equal(fixture.calls.filter(c=>c.method==='POST').length, 1);
  } finally { await fixture.close(); }
});
test('重复签到 409 会读取已到账状态，签到子模块 404 不隐藏整个钱包', async () => {
  let posted = false;
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => {
    if (call.url === '/api/signin/sign') { posted = true; return new Response('{}', { status: 409 }); }
    if (call.url === '/api/signin/signinLog' && posted) return paintResponse(energySignin({ signedToday: true }));
    return energyIntercept(call);
  } });
  try { document.querySelector('.qe-sign-button').click(); await settle(); await settle(); assert.match(document.querySelector('.qe-sign-message').textContent, /今天已领取/); assert.equal(document.querySelector('.qe-sign-button').disabled, true); } finally { await fixture.close(); }
  const closed = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => call.url === '/api/signin/signinLog' ? new Response('{}', { status: 404 }) : energyIntercept(call) });
  try { assert.ok(document.querySelector('.qe-pass')); assert.match(document.querySelector('.qe-signin-copy').textContent, /暂未开放/); } finally { await closed.close(); }
});
test('退出后中止钱包读取，迟到数据无法重新展示旧账户余额或打开记录', async () => {
  const finishes = [];
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => call.url === '/api/balance/query' ? new Promise(resolve => { finishes.push(resolve); }) : energyIntercept(call) });
  try {
    const request = fixture.calls.find(c=>c.url==='/api/balance/query'); fixture.auth.clearLocal(); await settle();
    assert.equal(request.signal.aborted, true);
    for (const finish of finishes) finish(paintResponse(energyBalance())); await settle();
    assert.equal(document.querySelector('.qgc-credit'), null); assert.equal(document.querySelector('.qe-pass'), null); assert.equal(document.querySelector('.qe-record-list'), null);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('流水加载错误与空结果分开说明，错误页允许回到前页重试', async () => {
  const fixture = await mount({ loggedIn: true, initialPath: '/wallet', intercept: call => {
    if (call.url.startsWith('/api/balance/consumeLog')) return call.url.includes('page=2') ? new Response(JSON.stringify({ message: 'records offline' }), { status: 503 }) : paintResponse({ items: [energyRow()], total: 11 });
    return energyIntercept(call);
  } });
  try {
    document.querySelector('[aria-label="下一页记录"]').click(); await settle();
    assert.match(document.querySelector('#qe-log-panel').textContent, /这页记录暂时没到/);
    assert.doesNotMatch(document.querySelector('#qe-log-panel').textContent, /等你写下/);
    document.querySelector('[aria-label="上一页记录"]').click(); await settle();
    assert.ok(document.querySelector('.qe-record-list article')); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('推广页在商业化开启时展示真实账户、邀请码和六条记录，初始读取不写入', async () => {
  const f = await mountRelay();
  try { assert.equal(document.querySelector('.qr-invite-card>code').textContent, 'QGTEAM26'); assert.equal(document.querySelectorAll('.qr-metrics article').length, 3); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 6); assert.equal(document.querySelector('.qr-balance-number strong').textContent, '55.14'); assert.match(document.querySelector('.qr-invite-card footer').textContent, /12.*10%/); assert.equal(f.calls.some(c => c.method === 'POST'), false); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('未开通页面先解释开通，确认只提交一次，成功后进入账户而不创建提现', async () => {
  let opened = false, release;
  const f = await mountRelay(async (c, data) => {
    if (c.url === '/api/sales/info' && !opened) return relayJson('尚未开通', 403);
    if (c.url === '/api/sales/apply') { await new Promise(r => { release = r; }); opened = true; return relayJson(data['/api/sales/info']); }
  });
  try { assert.ok(document.querySelector('.qr-join-card')); document.querySelector('.qr-open-join').click(); await settle(); assert.equal(f.calls.some(c => c.method === 'POST'), false); document.querySelector('.qr-confirm-join').click(); document.querySelector('.qr-confirm-join').click(); await settle(); assert.equal(f.calls.filter(c => c.url === '/api/sales/apply').length, 1); release(); await settle(); assert.ok(document.querySelector('.qr-invite-card')); assert.equal(document.querySelector('.qr-dialog').open, false); assert.equal(f.calls.some(c => c.url === '/api/sales/withdraw'), false); assert.deepEqual(f.errors, []); } finally { release?.(); await f.close(); }
});
test('账户错误不伪装零金额，关闭商业化不读取私有推广接口，暂停仍可查历史', async () => {
  const error = await mountRelay(c => c.url === '/api/sales/info' ? relayJson('账户读取失败', 503) : null);
  try { assert.match(document.querySelector('.qr-state').textContent, /账户读取失败/); assert.equal(document.querySelector('.qr-balance-card'), null); assert.equal(document.querySelector('.qr-open-join'), null); } finally { await error.close(); }
  const disabled = await mountRelay(c => c.url === '/api/settings/public' ? relayJson({ 'commerce.enabled': false }) : null);
  try { assert.match(document.querySelector('.qr-state').textContent, /尚未开启/); assert.equal(disabled.calls.some(c => c.url.startsWith('/api/sales/')), false); } finally { await disabled.close(); }
  const pausedData = referralFixtures(); pausedData['/api/sales/info'].enabled = false; const paused = await mountRelay(null, pausedData);
  try { assert.ok(document.querySelector('.qr-paused')); assert.equal(document.querySelector('.qr-review-withdraw').disabled, true); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 6); } finally { await paused.close(); }
});
test('提现先核对精确金额、实际收款方式和账号，取消保留草稿且不冻结', async () => {
  const f = await mountRelay();
  try { document.querySelector('input[name="qr-channel"][value="2"]').click(); await relayReview(); const dialog = document.querySelector('.qr-dialog'); assert.equal(dialog.open, true); assert.match(dialog.textContent, /35.70/); assert.match(dialog.textContent, /微信/); assert.match(dialog.querySelector('.qr-contact-full').textContent, /合成测试账号-3570/); assert.equal(f.calls.some(c => c.url === '/api/sales/withdraw'), false); dialog.querySelector('[aria-label="关闭推广详情"]').click(); await settle(); assert.equal(dialog.open, false); assert.equal(document.querySelector('#qr-amount').value, '35.70'); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('金额边界使用服务端规则，非法选择不能打开确认或提交提现', async () => {
  const data = referralFixtures(); data['/api/sales/info'].withdrawalPolicy.minCents = 2500; const f = await mountRelay(null, data);
  try { await relayReview('20'); assert.match(document.querySelector('.qr-inline-error').textContent, /25.00/); await relayReview('55.15'); assert.match(document.querySelector('.qr-inline-error').textContent, /超过/); await relayReview('1.001'); assert.equal(document.querySelector('.qr-dialog').open, false); assert.equal(f.calls.some(c => c.method === 'POST'), false); document.querySelector('.qr-amount button').click(); await settle(); assert.equal(document.querySelector('#qr-amount').value, '55.14'); } finally { await f.close(); }
});
test('双击确认仅发起一笔带唯一请求标识的提现，成功后清空账号且不保存账号', async () => {
  let release; const data = referralFixtures(), f = await mountRelay(async c => {
    if (c.url === '/api/sales/withdraw') { await new Promise(r => { release = r; }); data['/api/sales/info'].distributionCents -= 3570; return relayJson({ ...data['/api/sales/withdrawals'][0], id: 'accepted-withdrawal', amountCents: 3570, contact: c.body.contact }); }
  }, data);
  try { await relayReview(); document.querySelector('.qr-confirm-withdraw').click(); document.querySelector('.qr-confirm-withdraw').click(); await settle(); const posts = f.calls.filter(c => c.url === '/api/sales/withdraw'); assert.equal(posts.length, 1); assert.match(posts[0].body.requestKey, /^[A-Za-z0-9_-]{16,80}$/); assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), posts[0].body.requestKey); assert.equal(JSON.stringify(sessionStorage).includes('合成测试账号'), false); release(); await settle(); assert.match(document.querySelector('.qr-dialog h2').textContent, /等待审核/); assert.equal(document.querySelector('#qr-contact').value, ''); assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), null); assert.deepEqual(f.errors, []); } finally { release?.(); await f.close(); }
});
test('提现响应丢失先查询原申请，查到后不重发、不重复冻结', async () => {
  const data = referralFixtures(), f = await mountRelay(c => {
    if (c.url === '/api/sales/withdraw') throw new TypeError('response lost');
    if (c.url.startsWith('/api/sales/withdrawals?requestKey=')) return relayJson({ items: [{ ...data['/api/sales/withdrawals'][0], id: 'already-accepted' }], total: 1 });
  }, data);
  try { await relayReview(); document.querySelector('.qr-confirm-withdraw').click(); await settle(); assert.match(document.querySelector('.qr-dialog').textContent, /结果.*确认/); assert.ok(sessionStorage.getItem('qg:withdraw-pending:test-user')); document.querySelector('.qr-dialog .qr-secondary').click(); await settle(); assert.match(document.querySelector('.qr-dialog').textContent, /already-accepted/); assert.equal(f.calls.filter(c => c.url === '/api/sales/withdraw').length, 1); assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), null); } finally { await f.close(); }
});
test('未知提现结果后遇到限流仍保留原标识，后续确认不会生成替代请求', async () => {
  let attempts = 0; const data = referralFixtures(), f = await mountRelay(c => {
    if (c.url === '/api/sales/withdraw') { attempts++; if (attempts === 1) throw new TypeError('response lost'); if (attempts === 2) return relayJson('稍后再试', 429); return relayJson(data['/api/sales/withdrawals'][0]); }
  }, data);
  try { await relayReview(); document.querySelector('.qr-confirm-withdraw').click(); await settle(); const key = sessionStorage.getItem('qg:withdraw-pending:test-user'); document.querySelector('.qr-confirm-withdraw').click(); await settle(); assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), key); assert.match(document.querySelector('.qr-dialog').textContent, /原申请结果仍待确认/); document.querySelector('.qr-confirm-withdraw').click(); await settle(); assert.equal(new Set(f.calls.filter(c => c.url === '/api/sales/withdraw').map(c => c.body.requestKey)).size, 1); } finally { await f.close(); }
});
test('离开再返回只恢复请求标识，账号与金额清空且不会自动重发提现', async () => {
  const f = await mountRelay(c => c.url === '/api/sales/withdraw' ? Promise.reject(new TypeError('response lost')) : null);
  try { await relayReview(); document.querySelector('.qr-confirm-withdraw').click(); await settle(); const key = sessionStorage.getItem('qg:withdraw-pending:test-user'); await f.router.push('/plaza'); await settle(); await f.router.push('/sales'); await settle(); assert.ok(document.querySelector('.qr-recovery')); assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), key); assert.equal(document.querySelector('#qr-contact').value, ''); assert.equal(document.querySelector('#qr-amount').value, ''); assert.equal(f.calls.filter(c => c.url === '/api/sales/withdraw').length, 1); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('确认请求期间关闭弹窗保留恢复标识，迟到结果不能重新打开详情', async () => {
  let release; const data = referralFixtures(), f = await mountRelay(async c => { if (c.url === '/api/sales/withdraw') { await new Promise(r => { release = r; }); return relayJson(data['/api/sales/withdrawals'][0]); } }, data);
  try { await relayReview(); document.querySelector('.qr-confirm-withdraw').click(); await settle(); const post = f.calls.find(c => c.url === '/api/sales/withdraw'); document.querySelector('.qr-dialog [aria-label="关闭推广详情"]').click(); await settle(); assert.equal(post.signal.aborted, true); release(); await settle(); assert.equal(document.querySelector('.qr-dialog').open, false); assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), post.body.requestKey); assert.ok(document.querySelector('.qr-recovery')); } finally { release?.(); await f.close(); }
});
test('账号切换清空私有输入与恢复标识，旧提现响应不挂回新账户', async () => {
  let release, switched = false; const data = referralFixtures(), f = await mountRelay(async c => {
    if (c.url === '/api/sales/withdraw') { await new Promise(r => { release = r; }); return relayJson({ ...data['/api/sales/withdrawals'][0], id: 'old-private-withdrawal' }); }
    if (switched && c.url === '/api/sales/info') return relayJson({ ...data['/api/sales/info'], inviteCode: 'QGNEW026' });
  }, data);
  try { await relayReview(); document.querySelector('.qr-confirm-withdraw').click(); await settle(); switched = true; f.auth.apply({ accessToken: 'second-token', refreshToken: 'second-refresh', user: { id: 'other-account', username: '另一账户', role: 'USER' } }); await settle(); release(); await settle(); assert.equal(document.querySelector('.qr-invite-card>code').textContent, 'QGNEW026'); assert.equal(document.querySelector('#qr-contact').value, ''); assert.equal(document.querySelector('.qr-dialog').open, false); assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), null); assert.doesNotMatch(document.querySelector('.qr-referral').textContent, /old-private-withdrawal|合成测试账号/); assert.deepEqual(f.errors, []); } finally { release?.(); await f.close(); }
});
test('推广记录通过服务器分页、切换与状态筛选，搜索提交后才更改条件', async () => {
  const f = await mountRelay();
  try { document.querySelector('[aria-label="下一页推广记录"]').click(); await settle(); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 3); assert.match(f.calls.at(-1).url, /page=2/); document.querySelectorAll('.qr-journal-tabs button')[1].click(); await settle(); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 6); const select = document.querySelector('[aria-label="提现申请状态"]'); select.value = 'approved'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle(); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 1); assert.match(document.querySelector('.qr-journal-list').textContent, /审核通过.*待打款/); document.querySelectorAll('.qr-journal-tabs button')[0].click(); await settle(); relayInput('[aria-label="搜索佣金订单号"]', 'qg-invited-order-8'); await settle(); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 6); document.querySelector('.qr-journal-tools form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 1); assert.match(f.calls.at(-1).url, /keyword=qg-invited-order-8/); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('记录读取404不关闭推广账户，错误与空列表分开且可重试', async () => {
  let fail = true; const f = await mountRelay(c => c.url.startsWith('/api/sales/records?') && fail ? relayJson('记录暂未接上', 404) : null);
  try { assert.ok(document.querySelector('.qr-invite-card')); assert.match(document.querySelector('.qr-journal-state').textContent, /记录暂未接上/); assert.ok(document.querySelector('.qr-review-withdraw')); fail = false; document.querySelector('.qr-journal-state button').click(); await settle(); assert.equal(document.querySelectorAll('.qr-journal-list>li').length, 6); relayInput('[aria-label="搜索佣金订单号"]', 'missing'); document.querySelector('.qr-journal-tools form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(); assert.match(document.querySelector('.qr-journal-state').textContent, /这组条件/); assert.doesNotMatch(document.querySelector('.qr-journal-state').textContent, /读取失败/); } finally { await f.close(); }
});
test('申请详情默认遮盖账号，明确揭示后可收起，刷新只读取服务端当前状态', async () => {
  let refreshed = false; const data = referralFixtures(), f = await mountRelay(c => c.url.startsWith('/api/sales/withdrawals?id=') ? relayJson({ items: [{ ...data['/api/sales/withdrawals'][1], paymentStatus: refreshed ? 1 : 0 }], total: 1 }) : null, data);
  try { document.querySelectorAll('.qr-journal-tabs button')[1].click(); await settle(); document.querySelector('[aria-label="查看提现：qg-withdraw-1"]').click(); await settle(); const dialog = document.querySelector('.qr-dialog'); assert.match(dialog.querySelector('h2').textContent, /审核通过.*待打款/); assert.doesNotMatch(dialog.querySelector('.qr-contact-full').textContent, /本地合成收款/); dialog.querySelector('.qr-reveal').click(); await settle(); assert.match(dialog.querySelector('.qr-contact-full').textContent, /本地合成收款/); refreshed = true; dialog.querySelector('.qr-secondary').click(); await settle(); assert.match(dialog.querySelector('h2').textContent, /已登记打款/); assert.equal(f.calls.some(c => c.method === 'POST'), false); dialog.querySelector('[aria-label="关闭推广详情"]').click(); await settle(); document.querySelector('[aria-label="查看提现：qg-withdraw-1"]').click(); await settle(); assert.equal(dialog.querySelector('.qr-reveal').getAttribute('aria-pressed'), 'false'); } finally { await f.close(); }
});
test('复制邀请链接使用本站来源，剪贴板拒绝时提供可手动复制的内容', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard'); let copied = '', deny = false;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (deny) throw new Error('denied'); copied = text; } } });
  const f = await mountRelay();
  try { document.querySelectorAll('.qr-invite-actions button')[1].click(); await settle(); assert.equal(copied, 'http://qgauss.test/login?invite=QGTEAM26'); deny = true; document.querySelectorAll('.qr-invite-actions button')[0].click(); await settle(); assert.equal(document.querySelector('[aria-label="手动复制邀请内容"]').value, 'QGTEAM26'); assert.equal(f.calls.some(c => c.method === 'POST'), false); } finally { await f.close(); if (original) Object.defineProperty(navigator, 'clipboard', original); else delete navigator.clipboard; }
});
test('邀请链接进入真实注册界面预填可编辑邀请码，不勾选协议或自动注册', async () => {
  const f = await mount({ realLogin: true, initialPath: '/login?invite=qgteam26', intercept: c => c.url === '/api/settings/public' ? relayJson({ 'security.registerEnabled': true }) : c.url === '/api/auth/captcha' ? relayJson({ captchaId: 'fixture', svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }) : null });
  try { assert.equal(document.querySelector('#qg-auth-inviteCode').value, 'QGTEAM26'); assert.ok(document.querySelector('#qg-auth-username')); assert.equal(document.querySelector('.qg-auth-agreement-check input').checked, false); relayInput('#qg-auth-inviteCode', 'QGEDIT26'); await settle(); assert.equal(document.querySelector('#qg-auth-inviteCode').value, 'QGEDIT26'); assert.equal(f.calls.some(c => c.method === 'POST'), false); assert.deepEqual(f.errors, []); } finally { await f.close(); }
});
test('非法或重复邀请码参数与关闭注册不触发自动切换、验证码或认证写入', async () => {
  for (const [path, enabled] of [['/login?invite=bad', true], ['/login?invite=QGTEAM26&invite=QGEDIT26', true], ['/login?invite=QGTEAM26', false]]) {
    const f = await mount({ realLogin: true, initialPath: path, intercept: c => c.url === '/api/settings/public' ? relayJson({ 'security.registerEnabled': enabled }) : null });
    try { assert.ok(document.querySelector('#qg-auth-account')); assert.equal(document.querySelector('#qg-auth-inviteCode'), null); assert.equal(f.calls.some(c => c.url === '/api/auth/captcha' || c.method === 'POST'), false); assert.deepEqual(f.errors, []); } finally { await f.close(); }
  }
});
test('邀请页迟到配置与验证码在切走或返回登录后不再挂回或发起新请求', async () => {
  let release; const f = await mount({ realLogin: true, initialPath: '/login?invite=QGTEAM26', intercept: async c => { if (c.url === '/api/settings/public') { await new Promise(r => { release = r; }); return relayJson({ 'security.registerEnabled': true }); } } });
  try { await f.router.push('/chat'); await settle(); release(); await settle(); assert.equal(f.calls.some(c => c.url === '/api/auth/captcha'), false); assert.deepEqual(f.errors, []); } finally { release?.(); await f.close(); }
  let finishCaptcha; const g = await mount({ realLogin: true, initialPath: '/login?invite=QGTEAM26', intercept: async c => c.url === '/api/settings/public' ? relayJson({ 'security.registerEnabled': true }) : c.url === '/api/auth/captcha' ? (await new Promise(r => { finishCaptcha = r; }), relayJson('late captcha failure', 503)) : null });
  try { assert.ok(document.querySelector('#qg-auth-inviteCode')); document.querySelector('.qg-auth-return button').click(); await settle(); finishCaptcha(); await settle(); assert.ok(document.querySelector('#qg-auth-account')); assert.equal(document.querySelector('.qg-auth-error'), null); assert.deepEqual(g.errors, []); } finally { finishCaptcha?.(); await g.close(); }
});

test('开通响应未知时禁用重复确认，刷新已开通账户后不再重复申请', async () => {
  let opened = false;
  const f = await mountRelay((c, data) => {
    if (c.url === '/api/sales/info' && !opened) return relayJson('尚未开通', 403);
    if (c.url === '/api/sales/apply') { opened = true; throw new TypeError('response lost'); }
  });
  try {
    document.querySelector('.qr-open-join').click(); await settle();
    document.querySelector('.qr-confirm-join').click(); await settle();
    assert.equal(document.querySelector('.qr-confirm-join').disabled, true);
    assert.match(document.querySelector('.qr-dialog').textContent, /结果待确认/);
    document.querySelector('.qr-confirm-join').click(); await settle();
    assert.equal(f.calls.filter(c => c.url === '/api/sales/apply').length, 1);
    document.querySelector('.qr-dialog [aria-label="关闭推广详情"]').click(); await settle();
    document.querySelector('[aria-label="刷新推广账户"]').click(); await settle();
    assert.ok(document.querySelector('.qr-invite-card'));
    assert.equal(f.calls.filter(c => c.url === '/api/sales/apply').length, 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('明确拒绝的提现重试不产生虚假的未知结果或残留恢复标识', async () => {
  const f = await mountRelay(c => c.url === '/api/sales/withdraw' ? relayJson('最低提现规则已更新，请重新核对', 400) : null);
  try {
    await relayReview();
    for (let i = 0; i < 2; i++) {
      document.querySelector('.qr-confirm-withdraw').click(); await settle();
      assert.match(document.querySelector('.qr-dialog').textContent, /最低提现规则已更新/);
      assert.doesNotMatch(document.querySelector('.qr-dialog').textContent, /原申请结果仍待确认/);
      assert.equal(sessionStorage.getItem('qg:withdraw-pending:test-user'), null);
    }
    document.querySelector('.qr-dialog [aria-label="关闭推广详情"]').click(); await settle();
    assert.equal(document.querySelector('.qr-recovery'), null);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});


const accountRow=(overrides={})=>({id:'test-user',username:'测试用户',displayName:'灵感观察员',email:'observer@qgauss.test',avatar:'qgauss:violet',role:'USER',createdAt:'2026-10-30T08:00:00Z',...overrides});
function accountInput(selector,value){const input=document.querySelector(selector);assert.ok(input,selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
function accountSubmit(selector){document.querySelector(selector).dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
const accountWrites=f=>f.calls.filter(call=>call.method!=='GET'&&/users\/(profile|password)|auth\/reset-password/.test(call.url));
async function accountSecurity(){document.querySelector('#qac-tab-security').click();await settle();}
async function accountReview(){accountInput('#qac-old-password','SyntheticOld-123');accountInput('#qac-new-password','SyntheticNew-456');accountInput('#qac-confirm-password','SyntheticNew-456');accountSubmit('.qac-password-form');await settle();}

test('个人空间从账户菜单进入，昵称与头像只在明确保存后更新',async()=>{
  const f=await mount({loggedIn:true});try{document.querySelector('.qgc-user').click();await settle();const link=[...document.querySelectorAll('.qgc-popover a')].find(x=>x.textContent==='个人空间');assert.ok(link);link.click();await settle();
    assert.equal(f.router.currentRoute.value.path,'/account');assert.equal(document.querySelector('#qac-name').value,'灵感观察员');assert.equal(accountWrites(f).length,0);
    accountInput('#qac-name','  新的创作名字  ');document.querySelector('[aria-label="珊瑚搭档"]').click();await settle();assert.equal(accountWrites(f).length,0);
    accountSubmit('.qac-profile-form');await settle();assert.deepEqual(accountWrites(f)[0].body,{displayName:'新的创作名字',avatar:'qgauss:coral'});assert.equal(f.auth.user.displayName,'新的创作名字');assert.equal(f.auth.user.avatar,'qgauss:coral');assert.match(document.querySelector('.qac-inline-note').textContent,/已保存/);await f.router.push('/chat');await settle();assert.match(document.querySelector('.qgc-empty').textContent,/新的创作名字/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间保留未保存昵称，切换外观不触发写入，旧头像地址不会产生外部图片',async()=>{
  const f=await mount({loggedIn:true,initialPath:'/account',intercept:call=>call.url==='/api/users/profile'?relayJson(accountRow({avatar:'https://legacy.example.invalid/private-avatar.png'})):undefined});try{
    assert.equal(document.querySelector('.qac-profile-form button[type=submit]').disabled,true);accountInput('#qac-name','尚未保存的创作名字');await settle();
    document.querySelector('[aria-label="打开外观实验室"]').click();await settle();const orbitCard=[...document.querySelectorAll('button[aria-pressed]')].find(x=>x.textContent.includes('星际液态'));assert.ok(orbitCard);orbitCard.click();document.querySelector('[aria-label="关闭外观实验室"]').click();await settle();assert.equal(document.querySelector('#qac-name').value,'尚未保存的创作名字');assert.equal(document.documentElement.getAttribute('data-qg-design'),'orbit');assert.equal(accountWrites(f).length,0);assert.equal(document.querySelector('img[src^="https://legacy.example.invalid"]'),null);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间保存结果未知时先读取原结果，不自动重复写入',async()=>{
  let saved=false;const f=await mount({loggedIn:true,initialPath:'/account',intercept:call=>{if(call.url!=='/api/users/profile')return;if(call.method==='PATCH'){saved=true;throw new TypeError('Synthetic lost response');}return relayJson(accountRow({displayName:saved?'已接受的名字':'灵感观察员'}));}});try{
    accountInput('#qac-name','已接受的名字');accountSubmit('.qac-profile-form');await settle();assert.match(document.querySelector('.qac-inline-note').textContent,/尚未确认/);assert.equal(accountWrites(f).length,1);
    [...document.querySelectorAll('.qac-form-actions button')].find(x=>x.textContent==='读取最新资料').click();await settle();assert.match(document.querySelector('.qac-inline-note').textContent,/已确认/);assert.equal(accountWrites(f).length,1);assert.equal(f.auth.user.displayName,'已接受的名字');assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间切换账号后，迟到的资料不能覆盖新账号',async()=>{
  let finish;const f=await mount({loggedIn:true,initialPath:'/account',intercept:call=>{if(call.url!=='/api/users/profile')return;if(call.authorization==='Bearer test-access')return new Promise(done=>finish=done);return relayJson(accountRow({id:'second-user',displayName:'新账号的资料'}));}});try{
    f.auth.apply({accessToken:'second-access',refreshToken:'second-refresh',user:{id:'second-user',username:'新账号',role:'USER'}});await settle();finish(relayJson(accountRow({displayName:'迟到的旧资料'})));await settle();assert.equal(f.auth.user.id,'second-user');assert.equal(document.querySelector('#qac-name').value,'新账号的资料');assert.doesNotMatch(document.querySelector('.qac-studio').textContent,/迟到的旧资料/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间足迹失败不误示零记录，重试后分页且网络地址明确操作才显示',async()=>{
  let logFailure=true;const f=await mount({loggedIn:true,initialPath:'/account',intercept:call=>{if(!call.url.startsWith('/api/users/logins?'))return;if(logFailure)return relayJson('稍后重试读取足迹',503);const page=Number(new URL(call.url,'http://qgauss.test').searchParams.get('page'));return relayJson({items:[{id:'login-'+page,success:page===1,userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',ip:'192.0.2.'+page,createdAt:'2026-10-30T08:00:00Z'}],total:5,page,pageSize:4});}});try{
    await accountSecurity();assert.match(document.querySelector('.qac-history-tools').textContent,/记录数量尚未确认/);assert.doesNotMatch(document.querySelector('.qac-history-tools').textContent,/0 条记录/);logFailure=false;[...document.querySelectorAll('.qac-history-state button')].find(x=>x.textContent==='重试读取').click();await settle();assert.match(document.querySelector('.qac-history-tools').textContent,/5 条记录/);assert.match(document.querySelector('.qac-login-history').textContent,/网络地址已隐藏/);assert.doesNotMatch(document.querySelector('.qac-login-history').textContent,/192\.0\.2/);[...document.querySelectorAll('.qac-history-tools button')].find(x=>x.textContent==='显示网络地址').click();await settle();assert.match(document.querySelector('.qac-login-history').textContent,/192\.0\.2\.1/);
    [...document.querySelectorAll('.qac-pager button')].find(x=>x.textContent==='下一页').click();await settle();assert.match(document.querySelector('.qac-login-history').textContent,/未登录成功/);assert.ok(f.calls.some(x=>x.url==='/api/users/logins?page=2&pageSize=4'));assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间改密先核对，取消不提交，成功后退出并说明重新登录',async()=>{
  const f=await mount({loggedIn:true,initialPath:'/account',realLogin:true});try{
    await accountSecurity();accountInput('#qac-old-password','SyntheticOld-123');accountInput('#qac-new-password','SyntheticNew-456');accountInput('#qac-confirm-password','Different-789');accountSubmit('.qac-password-form');await settle();assert.match(document.querySelector('.qac-password-form').textContent,/不一致/);assert.equal(accountWrites(f).length,0);
    await accountReview();assert.equal(document.querySelector('.qac-confirm-dialog').open,true);assert.doesNotMatch(document.querySelector('.qac-confirm-dialog').textContent,/SyntheticOld|SyntheticNew/);assert.equal(accountWrites(f).length,0);document.querySelector('.qac-dialog-actions button').click();await settle();assert.equal(accountWrites(f).length,0);
    accountSubmit('.qac-password-form');await settle();document.querySelector('.qac-dialog-actions .qac-primary').click();await settle();assert.equal(f.auth.isLoggedIn,false);assert.equal(f.router.currentRoute.value.path,'/login');assert.match(document.querySelector('.qac-login-notice').textContent,/密码已更新/);assert.equal(accountWrites(f).length,1);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间改密拒绝后清空密码，双击只提交一次',async()=>{
  let finish;const f=await mount({loggedIn:true,initialPath:'/account',intercept:call=>call.url==='/api/users/password'?new Promise(done=>finish=done):undefined});try{
    await accountSecurity();await accountReview();const button=document.querySelector('.qac-dialog-actions .qac-primary');button.click();button.click();await settle();assert.equal(accountWrites(f).length,1);assert.equal(button.disabled,true);finish(relayJson('原密码不正确',400));await settle();assert.equal(f.auth.isLoggedIn,true);assert.equal(document.querySelector('#qac-old-password').value,'');assert.equal(document.querySelector('#qac-new-password').value,'');assert.match(document.querySelector('.qac-password-form').textContent,/原密码不正确/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间旧改密请求的迟到结果不能退出新账号或清空新表单',async()=>{
  let finish;const f=await mount({loggedIn:true,initialPath:'/account',intercept:call=>call.url==='/api/users/password'?new Promise(done=>finish=done):undefined});try{
    await accountSecurity();await accountReview();document.querySelector('.qac-dialog-actions .qac-primary').click();await settle();f.auth.apply({accessToken:'second-access',refreshToken:'second-refresh',user:{id:'second-user',username:'新账号',role:'USER'}});await settle();await accountSecurity();accountInput('#qac-old-password','SecondAccountPrivate-123');finish(relayJson({ok:true}));await settle();assert.equal(f.auth.user.id,'second-user');assert.equal(document.querySelector('#qac-old-password').value,'SecondAccountPrivate-123');assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('个人空间离开密码分区即清空密码，键盘可切换分区',async()=>{
  const f=await mount({loggedIn:true,initialPath:'/account'});try{await accountSecurity();accountInput('#qac-old-password','SyntheticPrivate-123');document.querySelector('#qac-tab-security').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await settle();assert.equal(document.activeElement.id,'qac-tab-start');assert.equal(document.querySelector('#qac-old-password').value,'');assert.equal(accountWrites(f).length,0);assert.match(document.querySelector('#qac-panel-start').textContent,/打开工作区/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('密码重置缺少有效链接时不请求修改，页面保持独立认证外观',async()=>{
  const f=await mount({initialPath:'/reset-password?token=short'});try{assert.match(document.querySelector('.qac-reset-card').textContent,/新的重置邮件/);assert.equal(document.querySelector('.qgc-header'),null);assert.equal(f.router.currentRoute.value.query.token,undefined);assert.equal(accountWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('密码重置从地址移除链接凭证，明确提交后成功且不持久保存密码',async()=>{
  const token='synthetic-reset-link-123456789';const f=await mount({initialPath:'/reset-password?token='+token});try{assert.equal(f.router.currentRoute.value.query.token,undefined);assert.equal(accountWrites(f).length,0);accountInput('#qac-reset-password','SyntheticReset-456');accountInput('#qac-reset-confirm','SyntheticReset-456');accountSubmit('.qac-reset-card form');await settle();assert.match(document.querySelector('.qac-reset-card').textContent,/新钥匙，准备好了/);assert.equal(accountWrites(f).length,1);assert.deepEqual(accountWrites(f)[0].body,{token,newPassword:'SyntheticReset-456'});assert.equal(document.querySelector('#qac-reset-password'),null);for(const storage of [localStorage,sessionStorage]){const values=Array.from({length:storage.length},(_,index)=>storage.getItem(storage.key(index))).join(' ');assert.ok(!values.includes(token)&&!values.includes('SyntheticReset-456'));}assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('密码重置过期与提交结果未知分别说明，均不自动重试',async()=>{
  for(const unknown of [false,true]){const f=await mount({initialPath:'/reset-password?token=synthetic-reset-link-123456789',intercept:call=>{if(call.url!=='/api/auth/reset-password')return;if(unknown)throw new TypeError('Synthetic lost response');return relayJson('链接无效或已过期',400);}});try{accountInput('#qac-reset-password','SyntheticReset-456');accountInput('#qac-reset-confirm','SyntheticReset-456');accountSubmit('.qac-reset-card form');await settle();assert.match(document.querySelector('.qac-reset-card').textContent,unknown?/没有确认修改结果/:/新的重置邮件/);assert.equal(accountWrites(f).length,1);assert.equal(document.querySelector('#qac-reset-password'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
});


test('个人空间改密结果未知时不伪报成功，退出后提示先确认新密码',async()=>{
  const f=await mount({loggedIn:true,initialPath:'/account',realLogin:true,intercept:call=>{if(call.url==='/api/users/password')throw new TypeError('Synthetic response lost');}});try{await accountSecurity();await accountReview();document.querySelector('.qac-dialog-actions .qac-primary').click();await settle();assert.equal(f.auth.isLoggedIn,false);assert.equal(f.router.currentRoute.value.path,'/login');assert.match(document.querySelector('.qac-login-notice').textContent,/尚未确认/);assert.doesNotMatch(document.querySelector('.qac-login-notice').textContent,/密码已更新/);assert.equal(accountWrites(f).length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('密码重置页面离开后的迟到成功不能退出后来登录的账号',async()=>{
  let finish;const f=await mount({initialPath:'/reset-password?token=synthetic-reset-link-123456789',intercept:call=>call.url==='/api/auth/reset-password'?new Promise(done=>finish=done):undefined});try{accountInput('#qac-reset-password','SyntheticReset-456');accountInput('#qac-reset-confirm','SyntheticReset-456');accountSubmit('.qac-reset-card form');await settle();f.auth.apply({accessToken:'later-access',refreshToken:'later-refresh',user:{id:'later-user',username:'新账号',role:'USER'}});await f.router.push('/chat');await settle();finish(relayJson({ok:true}));await settle();assert.equal(f.auth.user.id,'later-user');assert.equal(f.router.currentRoute.value.path,'/chat');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

test('密码重置结果未知时退出原登录，登录按钮能真正到达登录页',async()=>{
  const f=await mount({loggedIn:true,initialPath:'/reset-password?token=synthetic-reset-link-123456789',realLogin:true,intercept:call=>{if(call.url==='/api/auth/reset-password')throw new TypeError('Synthetic lost result');}});try{accountInput('#qac-reset-password','SyntheticReset-456');accountInput('#qac-reset-confirm','SyntheticReset-456');accountSubmit('.qac-reset-card form');await settle();assert.equal(f.auth.isLoggedIn,false);assert.match(document.querySelector('.qac-reset-card').textContent,/没有确认修改结果/);document.querySelector('.qac-reset-card button.qac-primary').click();await settle();assert.equal(f.router.currentRoute.value.path,'/login');assert.match(document.querySelector('.qac-login-notice').textContent,/尚未确认/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('密码重置期间建立的新登录不会自动退出，用户可明确选择后续登录',async()=>{
  let finish,finishLogout;const f=await mount({initialPath:'/reset-password?token=synthetic-reset-link-123456789',realLogin:true,intercept:call=>call.url==='/api/auth/reset-password'?new Promise(done=>finish=done):call.url==='/api/auth/logout'?new Promise(done=>finishLogout=done):undefined});try{accountInput('#qac-reset-password','SyntheticReset-456');accountInput('#qac-reset-confirm','SyntheticReset-456');accountSubmit('.qac-reset-card form');await settle();f.auth.apply({accessToken:'later-access',refreshToken:'later-refresh',user:{id:'later-user',username:'新账号',role:'USER'}});finish(relayJson({ok:true}));await settle();assert.equal(f.auth.user.id,'later-user');assert.match(document.querySelector('.qac-reset-card button.qac-primary').textContent,/退出当前登录/);assert.equal(document.querySelector('.qac-reset-current').getAttribute('href'),'/chat');document.querySelector('.qac-reset-card button.qac-primary').click();await settle();assert.equal(f.auth.isLoggedIn,false);assert.equal(f.router.currentRoute.value.path,'/login');finishLogout(relayJson({ok:true}));await settle();assert.deepEqual(f.errors,[]);}finally{await f.close();}
});


const installationStatus = {required:true,canInitialize:true,needsSecureConnection:false};
const syntheticInstall = {ownerToken:'synthetic-install-only-8190-test-credential',email:'owner@qgauss.test',username:'space_owner',displayName:'合成空间',password:'SyntheticAdminPass-819',confirm:'SyntheticAdminPass-819',siteBaseUrl:'https://space.qgauss.test'};
async function mountInstallation(intercept) { return mount({initialPath:'/setup',realGuard:true,intercept:async call => await intercept?.(call) || (call.url==='/api/installation/status' ? relayJson(installationStatus) : null)}); }
async function reviewInstallation() { document.querySelector('.qsi-card>.qsi-primary').click(); await settle(); for(const [field,value] of Object.entries(syntheticInstall)){const id={ownerToken:'token',displayName:'name',siteBaseUrl:'origin',password:'password',confirm:'confirm',email:'email',username:'username'}[field];relayInput('#qsi-'+id,value);} document.querySelector('.qsi-card form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle(); }
const readinessFixture = {canEnableDemo:true,chatModel:null,checks:[{id:'model',state:'missing',title:'让一位创作搭档就位',description:'还没有可用模型。',action:{label:'连接模型服务',path:'/models/channels'}},{id:'mail',state:'optional',title:'为账户留一条返回的路',description:'邮件配置不代表投递成功。',action:{label:'核对站点地址',path:'/settings'}}]};

test('首次安装：空站点先进入安装页，不尝试登录续期或读取私有内容',async()=>{
 const f=await mount({initialPath:'/chat',realGuard:true,intercept:c=>c.url==='/api/installation/status'?relayJson(installationStatus):null});try{assert.equal(f.router.currentRoute.value.path,'/setup');assert.match(document.body.textContent,/你的空间，从你开始/);assert.equal(f.calls.some(c=>/auth\/(refresh|me)|conversations|models\/available/.test(c.url)),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('首次安装：状态读取失败停在明确错误页，重试成功后恢复准备步骤',async()=>{
 let fail=true;const f=await mountInstallation(c=>c.url==='/api/installation/status'?relayJson(fail?'合成连接失败':installationStatus,fail?503:200):null);try{assert.match(document.body.textContent,/暂时没有连上空间/);fail=false;document.querySelector('.qsi-card>.qsi-primary').click();await settle();assert.match(document.body.textContent,/你的空间，从你开始/);assert.equal(f.calls.filter(c=>c.url==='/api/installation/status').length,2);}finally{await f.close();}
});
test('首次安装：缺少部署凭证和非安全连接分别说明准备条件，均不提供创建表单',async()=>{
 for(const needsSecureConnection of [false,true]){const f=await mountInstallation(c=>c.url==='/api/installation/status'?relayJson({...installationStatus,canInitialize:false,needsSecureConnection}):null);try{assert.equal(document.querySelector('#qsi-token'),null);assert.match(document.body.textContent,needsSecureConnection?/安全连接/:/部署负责人配置独立的安装凭证/);}finally{await f.close();}}
});
test('首次安装：已有站点关闭入口，匿名启航清单保留登录返回路径',async()=>{
 const f=await mount({initialPath:'/setup',realGuard:true});try{assert.match(document.body.textContent,/这里已经有人点亮了灯/);assert.equal(document.querySelector('#qsi-token'),null);await f.router.push('/welcome');await settle();assert.equal(f.router.currentRoute.value.path,'/login');assert.equal(f.router.currentRoute.value.query.redirect,'/welcome');}finally{await f.close();}
});
test('首次安装：普通用户不能进入管理员清单',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/welcome',realGuard:true});try{assert.equal(f.router.currentRoute.value.path,'/unauthorized');assert.equal(f.calls.some(c=>c.url==='/api/installation/readiness'),false);assert.match(document.querySelector('.qgs-copy').textContent,/当前账号暂时不能访问/);}finally{await f.close();}
});
test('首次安装：明确确认前不提交，凭证只随专用请求头发送，成功不自动登录',async()=>{
 const f=await mountInstallation(c=>c.url==='/api/installation'&&c.method==='POST'?relayJson({initialized:true}):null);try{await reviewInstallation();assert.equal(f.calls.some(c=>c.method==='POST'),false);assert.equal(document.querySelector('.qsi-review').textContent.includes(syntheticInstall.password),false);document.querySelector('.qsi-actions .qsi-primary').click();await settle();const call=f.calls.find(c=>c.url==='/api/installation'&&c.method==='POST');assert.equal(call.body.openRegistration,false);assert.equal(call.installationToken,syntheticInstall.ownerToken);assert.equal(Object.hasOwn(call.body,'ownerToken'),false);assert.equal(call.body.siteBaseUrl,syntheticInstall.siteBaseUrl);assert.match(document.body.textContent,/第一盏灯，亮了/);assert.equal(f.auth.isLoggedIn,false);assert.equal(localStorage.getItem('qg:refresh'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('首次安装：响应未知时清除表单且不重试创建，重新核对只读取公开状态',async()=>{
 let accepted=false;const f=await mountInstallation(c=>{if(c.url==='/api/installation'&&c.method==='POST'){accepted=true;return relayJson('合成结果未知',503);}if(c.url==='/api/installation/status')return relayJson(accepted?{required:false,canInitialize:false}:installationStatus);});try{await reviewInstallation();document.querySelector('.qsi-actions .qsi-primary').click();await settle();assert.match(document.body.textContent,/先确认，再继续/);assert.equal(document.querySelector('#qsi-password'),null);document.querySelector('.qsi-card>.qsi-secondary').click();await settle();assert.match(document.body.textContent,/这条状态不能证明本次账户创建成功/);assert.equal(f.calls.filter(c=>c.url==='/api/installation'&&c.method==='POST').length,1);}finally{await f.close();}
});
test('首次安装：提交拒绝回到空密码表单，离开后重新进入不恢复敏感信息',async()=>{
 const f=await mountInstallation(c=>c.url==='/api/installation'&&c.method==='POST'?relayJson('合成凭证拒绝',403):null);try{await reviewInstallation();document.querySelector('.qsi-actions .qsi-primary').click();await settle();assert.equal(document.querySelector('#qsi-token').value,'');assert.equal(document.querySelector('#qsi-password').value,'');assert.equal(document.querySelector('#qsi-email').value,syntheticInstall.email);f.installation.status={required:false,canInitialize:false};await f.router.push('/login');await f.router.push('/setup');await settle();assert.equal(document.querySelector('#qsi-email'),null);assert.equal(localStorage.getItem('qg:install-token'),null);assert.equal(sessionStorage.getItem('qg:install-token'),null);}finally{await f.close();}
});
test('启航清单：实际配置与可选项分开，打开设置不把任务标为已完成',async()=>{
 const f=await mount({loggedIn:true,admin:true,initialPath:'/welcome',realGuard:true,intercept:c=>c.url==='/api/installation/readiness'?relayJson(readinessFixture):null});try{assert.equal(document.querySelectorAll('.qsi-readiness-card').length,2);assert.match(document.body.textContent,/等待布置/);document.querySelector('.qsi-check-link').click();await settle();assert.equal(f.router.currentRoute.value.path,'/models/channels');assert.equal(f.calls.some(c=>c.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('启航清单：本地体验需要两次明确点击，未知结果只能先核对',async()=>{
 const f=await mount({loggedIn:true,admin:true,initialPath:'/welcome',intercept:c=>c.url==='/api/installation/readiness'?relayJson(readinessFixture):c.url==='/api/installation/demo'?relayJson('合成未知结果',503):null});try{document.querySelector('.qsi-demo-card>.qsi-secondary').click();await settle();assert.equal(f.calls.some(c=>c.url==='/api/installation/demo'),false);document.querySelector('.qsi-demo-confirm .qsi-primary').click();await settle();assert.match(document.body.textContent,/开启结果尚未确认/);assert.equal(f.calls.filter(c=>c.url==='/api/installation/demo').length,1);document.querySelector('.qsi-demo-card>.qsi-secondary').click();await settle();assert.equal(f.calls.filter(c=>c.url==='/api/installation/demo').length,1);}finally{await f.close();}
});
test('启航清单：切换账号后旧读取和旧开启结果不能恢复前一账号的内容',async()=>{
 let release;const f=await mount({loggedIn:true,admin:true,initialPath:'/welcome',intercept:async c=>c.url==='/api/installation/readiness'?(await new Promise(r=>{release=r;}),relayJson(readinessFixture)):null});try{f.auth.apply({accessToken:'synthetic-other',refreshToken:'synthetic-other',user:{id:'other-user',role:'USER',username:'另一个合成用户'}});release();await settle();assert.equal(document.querySelector('.qsi-readiness-grid'),null);assert.equal(document.querySelector('.qsi-demo-card'),null);}finally{await f.close();}
});
test('个人空间：启航链接直接打开登录与密码分区',async()=>{
 const f=await mount({loggedIn:true,admin:true,initialPath:'/account?section=security'});try{assert.equal(document.querySelector('#qac-tab-security').getAttribute('aria-selected'),'true');assert.ok(f.calls.some(c=>c.url.startsWith('/api/users/logins?')));}finally{await f.close();}
});

test('首次安装：成功状态必须有明确回执，空响应不能冒充创建完成',async()=>{const f=await mountInstallation(c=>c.url==='/api/installation'&&c.method==='POST'?relayJson({}):null);try{await reviewInstallation();document.querySelector('.qsi-actions .qsi-primary').click();await settle();assert.match(document.body.textContent,/先确认，再继续/);assert.equal(f.installation.status.required,true);}finally{await f.close();}});

test('密码重置：管理员弱密码被拒绝后仍可用原链接明确重填',async()=>{
 let attempts=0;const f=await mount({initialPath:'/reset-password?token=synthetic-reset-owner-token-819',intercept:c=>c.url==='/api/auth/reset-password'?relayJson(++attempts===1?'管理员新密码至少 12 个字符':{ok:true},attempts===1?422:200):null});try{relayInput('#qac-reset-password','Weakpass9');relayInput('#qac-reset-confirm','Weakpass9');document.querySelector('.qac-reset form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();assert.match(document.body.textContent,/管理员新密码至少 12/);assert.equal(document.querySelector('#qac-reset-password').value,'');relayInput('#qac-reset-password','SyntheticResetAdmin-819');relayInput('#qac-reset-confirm','SyntheticResetAdmin-819');document.querySelector('.qac-reset form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();assert.match(document.body.textContent,/新钥匙，准备好了/);const calls=f.calls.filter(c=>c.url==='/api/auth/reset-password');assert.equal(calls.length,2);assert.equal(calls[0].body.token,calls[1].body.token);}finally{await f.close();}
});


async function mountMail(state = 'mail-ready', extra) {
  const data = mailCenterFixtures(state);
  const f = await mount({ loggedIn:true, admin:true, initialPath:'/mail', intercept:async call => {
    const custom = await extra?.(call,data); if(custom)return custom;
    const url = new URL(call.url,'http://qgauss.test');
    if(call.method==='GET' && Object.hasOwn(data,url.pathname))return relayJson(url.pathname==='/api/mail/outbox'?mailFixturePage(data[url.pathname],url):data[url.pathname]);
  }});
  return {...f,data};
}
function mailButton(label) { const button=[...document.querySelectorAll('.qmp-page button')].find(node=>node.textContent.trim()===label); assert.ok(button,label); return button; }

test('邮件中心：未配置显示待准备、空记录，禁用发信并提供隔离的模板预览',async()=>{
  const f=await mountMail('mail-empty');try{
    assert.match(document.querySelector('.qmp-page').textContent,/这里还没有回执/);
    assert.equal(mailButton('给自己发一封体验信').disabled,true);
    assert.equal(document.querySelectorAll('.qmp-template-buttons button').length,3);
    const preview=document.querySelector('.qmp-letter-preview iframe');assert.equal(preview.getAttribute('sandbox'),'');assert.equal(preview.hasAttribute('inert'),true);
    assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('邮件中心：筛选与分页携带当前条件，回执详情只读且不提供重发',async()=>{
  const f=await mountMail();try{
    assert.equal(document.querySelectorAll('.qmp-receipts li').length,8);
    mailButton('下一页').click();await settle();assert.equal(document.querySelectorAll('.qmp-receipts li').length,4);
    const select=document.querySelector('.qmp-filters select');select.value='sent';select.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    assert.equal(document.querySelectorAll('.qmp-receipts li').length,2);assert.match(f.calls.at(-1).url,/page=1.*status=sent/);
    document.querySelector('.qmp-receipt-open').click();await settle();assert.equal(document.querySelector('.qmp-receipt-dialog').open,true);
    assert.doesNotMatch(document.querySelector('.qmp-receipt-dialog').textContent,/token=|重新发送/);
    assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('邮件中心：先核对再明确发送，重复点击只创建一次且收件人不来自表单',async()=>{
  let finish;
  const f=await mountMail('mail-ready',call=>call.method==='POST'&&call.url==='/api/mail/probes'?new Promise(resolve=>{finish=resolve;}):null);try{
    mailButton('给自己发一封体验信').click();await settle();assert.equal(document.querySelector('.qmp-dialog').open,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
    mailButton('确认发送体验信').click();await settle();mailButton('正在创建').click();await settle();
    const writes=f.calls.filter(call=>call.method==='POST');assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0].body),['requestKey']);assert.match(writes[0].body.requestKey,/^[a-f0-9-]{36}$/i);
    const probe={id:'synthetic-probe',status:'queued',createdAt:'2026-11-01T08:00:00Z',canConfirm:false,retryScheduled:false};f.data['/api/mail/status'].recentProbe=probe;finish(relayJson(probe));await settle();await settle();
    assert.equal(mailButton('给自己发一封体验信').disabled,true);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('邮件中心：网络中断不自动重发，使用同次意图只读核对后恢复回执',async()=>{
  const f=await mountMail('mail-ready',call=>{if(call.method==='POST'&&call.url==='/api/mail/probes')throw TypeError('synthetic lost response');if(call.url.startsWith('/api/mail/probes/'))return relayJson({id:'synthetic-probe',status:'unknown',createdAt:'2026-11-01T08:00:00Z',canConfirm:true,retryScheduled:false});});try{
    mailButton('给自己发一封体验信').click();await settle();mailButton('确认发送体验信').click();await settle();await settle();
    assert.match(document.querySelector('.qmp-notice').textContent,/不会自动重复发送/);assert.equal(mailButton('给自己发一封体验信').disabled,true);
    const key=f.calls.find(call=>call.method==='POST').body.requestKey;mailButton('核对这次请求').click();await settle();
    assert.ok(f.calls.some(call=>call.method==='GET'&&call.url==='/api/mail/probes/'+key));assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.match(document.querySelector('.qmp-probe-receipt').textContent,/尚未确认服务器/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('邮件中心：本人确认收信独立保存，未知投递仍保留未确认说明',async()=>{
  const f=await mountMail('mail-unknown',(call,data)=>{if(call.method==='POST'&&call.url.endsWith('/confirm')){const probe={...data['/api/mail/status'].recentProbe,confirmedAt:'2026-11-01T08:45:00Z'};data['/api/mail/status'].recentProbe=probe;return relayJson(probe);}});try{
    mailButton('我已在邮箱收到这封信').click();await settle();await settle();assert.match(document.querySelector('.qmp-probe-receipt').textContent,/你已确认收到/);
    assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.match(document.querySelector('.qmp-probe-receipt').textContent,/未确认/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('邮件中心：登出中止读取与写入，迟到结果不重新显示其他账号回执',async()=>{
  let finish;
  const f=await mountMail('mail-ready',call=>call.method==='POST'?new Promise(resolve=>{finish=resolve;}):null);try{
    mailButton('给自己发一封体验信').click();await settle();mailButton('确认发送体验信').click();await settle();
    const write=f.calls.find(call=>call.method==='POST');f.auth.clearLocal();await settle();assert.equal(write.signal.aborted,true);
    finish(relayJson({id:'old-private-probe',status:'sent',to:'private***@qgauss.test'}));await settle();
    assert.equal(document.querySelector('#mount').textContent.includes('private***'),false);assert.doesNotMatch(document.querySelector('#mount').textContent,/old-private-probe/);assert.equal(document.querySelector('.qmp-dialog')?.open??false,false);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('邮件中心：状态和列表失败分别展示重试，不把加载失败当作空记录',async()=>{
  const f=await mountMail('mail-ready',call=>['/api/mail/status','/api/mail/outbox'].some(path=>call.url.startsWith(path))?relayJson('synthetic mail unavailable',503):null);try{
    assert.match(document.querySelector('.qmp-page').textContent,/暂时没有读到发件状态/);assert.doesNotMatch(document.querySelector('.qmp-outbox').textContent,/这里还没有回执|共 0 条/);
    assert.ok(mailButton('重新读取'));assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

function agentRelay(state='agents-library',extra){
  const data=agentFixtures(state);
  return async call=>{const response=await extra?.(call,data);if(response)return response;const url=new URL(call.url,'http://qgauss.test');if(call.method==='GET'&&Object.hasOwn(data,url.pathname))return relayJson(url.pathname==='/api/agents'?agentFixturePage(data[url.pathname],url):data[url.pathname]);};
}
async function mountAgents({state='agents-library',path='/agent',admin=false,extra}={}){return mount({loggedIn:true,admin,initialPath:path,intercept:agentRelay(state,extra)});}
const agentButton=(text,root=document)=>[...root.querySelectorAll('button')].find(x=>x.textContent.trim()===text);
function agentReply(call){const activity={kind:'agent',status:'completed',context:call.body.agentParentId?'continued':'fresh',steps:[],suggestions:['继续下一步？'],artifacts:[]};const wire=[['meta',{conversationId:'qg-agent-conversation',messageId:'new-agent-answer',userMessageId:'new-agent-question',agentId:call.body.agentId}],['delta',{v:'合成的搭档回复'}],['agent',activity],['done',{messageId:'new-agent-answer',status:'COMPLETED',agentActivity:activity,promptTokens:7,completionTokens:5}]].map(([event,data])=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n').join('');return new Response(wire,{headers:{'Content-Type':'text/event-stream'}});}

test('智能体搭档馆：独立入口、档案、推荐问题只导航和填草稿，不自动发送',async()=>{
 const f=await mountAgents();try{assert.equal(document.querySelectorAll('.qag-card').length,6);assert.match(document.querySelector('.qag-stats').textContent,/6/);document.querySelector('.qag-card-title').click();await settle();assert.equal(f.router.currentRoute.value.path,'/agent/app');assert.match(document.querySelector('.qag-profile h1').textContent,/行动规划官/);assert.match(document.querySelector('.qag-detail-card dl').textContent,/2 次/);document.querySelector('.qag-detail-questions button').click();await settle();await settle();assert.equal(f.router.currentRoute.value.path,'/agent/chat');assert.equal(document.querySelector('.cv-input').value,'帮我整理这个目标的第一步');assert.ok(document.querySelector('.qag-chat-intro'));assert.equal(f.calls.filter(x=>x.method==='POST').length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('智能体搭档馆：收藏明确设置状态，搜索与可用筛选不触发生成',async()=>{
 const f=await mountAgents({extra:(call,data)=>{if(call.method==='POST'&&call.url.endsWith('/favorite')){const id=call.url.split('/')[3],row=data['/api/agents/'+id];row.favorited=call.body.favorited;return relayJson({favorited:row.favorited});}}});try{document.querySelector('.qag-favorite').click();await settle();const write=f.calls.find(x=>x.method==='POST');assert.equal(write.body.favorited,true);assert.equal(document.querySelector('.qag-favorite').getAttribute('aria-pressed'),'true');const search=document.querySelector('[aria-label="搜索智能体"]');search.value='资料';search.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,280));await settle();assert.equal(document.querySelectorAll('.qag-card').length,1);assert.match(document.querySelector('.qag-card-title').textContent,/资料探索者/);assert.equal(f.calls.some(x=>x.url.includes('/chat/completions')),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('智能体历史：安全回执和建议问题保留，接续当前分支时不混用普通模型',async()=>{
 const f=await mountAgents({state:'agents-chat-completed',path:'/chat',extra:call=>call.url==='/api/chat/completions'?agentReply(call):undefined});try{document.querySelectorAll('.qgc-history-tabs button')[2].click();await settle();document.querySelector('.cv-conv').click();await settle();await settle();assert.equal(document.querySelector('[aria-label="允许联网检索"]'),null);assert.equal(document.querySelector('button[aria-label^="选择模型"]'),null);assert.match(document.querySelector('.qag-run').textContent,/整理可行动的步骤/);const link=document.querySelector('.qag-artifacts a');assert.equal(link.getAttribute('rel'),'noopener noreferrer');assert.equal(link.getAttribute('referrerpolicy'),'no-referrer');assert.equal(document.querySelector('.qag-artifacts img'),null);document.querySelector('.qag-followups button').click();await settle();assert.equal(document.querySelector('.cv-input').value,'把第一步拆成今天的行动');assert.equal(f.calls.some(x=>x.url==='/api/chat/completions'),false);document.querySelector('.cv-send').click();await settle();await settle();const send=f.calls.find(x=>x.url==='/api/chat/completions');assert.equal(send.body.agentId,'qg-agent-plan');assert.equal(send.body.agentParentId,'qg-agent-answer');assert.equal(send.body.agentOfferRevision,'a'.repeat(64));assert.equal('model' in send.body,false);assert.equal(send.body.messages.length,3);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('智能体会话：关闭上下文只传新问题，加载资料不会偷偷发起协作',async()=>{
 const f=await mountAgents({path:'/agent/chat?agent=qg-agent-plan&draft=单独讨论这个问题',extra:call=>call.url==='/api/chat/completions'?agentReply(call):undefined});try{assert.equal(f.calls.filter(x=>x.method==='POST').length,0);document.querySelector('[aria-label="上下文开"]').click();await settle();document.querySelector('.cv-send').click();await settle();const request=f.calls.find(x=>x.url==='/api/chat/completions');assert.equal(request.body.messages.length,1);assert.equal('agentParentId' in request.body,false);assert.equal(request.body.messages[0].content,'单独讨论这个问题');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('智能体会话：下架或资料读取失败时保留明确状态，发送不可用',async()=>{
 const f=await mountAgents({path:'/agent/chat?agent=qg-agent-plan&draft=不要发送',extra:call=>call.url==='/api/agents/qg-agent-plan'?relayJson('搭档暂未完成连接',503):undefined});try{assert.match(document.querySelector('.qag-composer-quote').textContent,/搭档暂未完成连接/);assert.equal(document.querySelector('.cv-send').disabled,true);assert.equal(f.calls.some(x=>x.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('智能体取消回执：接受请求不表示服务方计算停止，失败状态不展示成功建议',async()=>{
 const f=await mountAgents({state:'agents-chat-cancel',path:'/chat'});try{document.querySelectorAll('.qgc-history-tabs button')[2].click();await settle();document.querySelector('.cv-conv').click();await settle();assert.match(document.querySelector('.qag-cancel-note').textContent,/计算或用量可能仍会继续/);assert.equal(document.querySelector('.qag-followups'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('搭档控制室：首次读取只拉取本地配置，显式核对才请求外部列表',async()=>{
 const f=await mountAgents({admin:true,path:'/agents/manage',state:'agents-admin',extra:call=>call.url.endsWith('/probe')?relayJson({ok:true}):undefined});try{assert.match(document.querySelector('.qaa-card').textContent,/QGauss 协作空间/);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);agentButton('编辑连接').click();await settle();assert.equal(document.querySelector('.qaa-dialog').open,true);const secret=document.querySelector('.qaa-dialog textarea');assert.equal(secret.value,'');assert.equal(document.querySelector('.qaa-dialog input[autocomplete="new-password"]'),null);document.querySelector('[aria-label="关闭连接编辑"]').click();await settle();agentButton('核对授权').click();await settle();assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.match(document.querySelector('.qaa-notice').textContent,/真实协作仍需单独体验验收/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('搭档控制室：身份切换立即清除配置与凭据，迟到的原账号资料不重现',async()=>{
 let release,late=false;const f=await mountAgents({admin:true,path:'/agents/manage',state:'agents-admin',extra:call=>late&&call.url==='/api/agents/admin/connections'?new Promise(r=>release=r):undefined});try{agentButton('编辑连接').click();await settle();const field=document.querySelector('.qaa-dialog textarea');field.value='private-local-synthetic-draft';field.dispatchEvent(new Event('input',{bubbles:true}));late=true;agentButton('刷新状态').click();await settle();const request=f.calls.findLast(x=>x.url==='/api/agents/admin/connections');f.auth.clearLocal();await settle();assert.equal(request.signal.aborted,true);release(relayJson([{id:'private-old-config',name:'旧账号连接'}]));await settle();assert.doesNotMatch(document.querySelector('#mount').textContent,/private-old-config|旧账号连接|private-local-synthetic/);assert.equal(document.querySelector('.qaa-dialog')?.open??false,false);assert.deepEqual(f.errors,[]);}finally{release?.(relayJson([]));await f.close();}
});

test('搭档控制室：保存带上确认版本，留空凭据不回显且重定向功能菜单可点击',async()=>{
 const f=await mountAgents({admin:true,path:'/agents/manage',state:'agents-admin',extra:(call,data)=>{if(call.method==='PATCH'&&call.url.startsWith('/api/agents/admin/connections/')){data['/api/agents/admin/connections'][0].version=2;return relayJson({id:'qg-agent-connection',version:2,hasCredential:true});}}});try{assert.ok(document.querySelector('a[href="/image"]'));agentButton('编辑连接').click();await settle();document.querySelector('.qaa-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();const write=f.calls.find(x=>x.method==='PATCH');assert.equal(write.body.version,1);assert.equal(write.body.secret,'');assert.equal(document.querySelector('.qaa-dialog').open,false);assert.equal(document.querySelector('.qaa-dialog textarea').value,'');assert.equal(f.calls.some(x=>x.url.includes('/probe')),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('搭档控制室：授权核对失败刷新后保留原因，不被状态刷新清空',async()=>{
 const f=await mountAgents({admin:true,path:'/agents/manage',state:'agents-admin',extra:(call,data)=>{if(call.method==='POST'&&call.url.endsWith('/probe')){data['/api/agents/admin/connections'][0].lastProbeOk=false;return relayJson('合成授权未通过，请核对连接',403);}}});try{agentButton('核对授权').click();await settle();assert.match(document.querySelector('.qaa-error').textContent,/合成授权未通过/);assert.match(document.querySelector('.qaa-card').textContent,/最近一次未通过/);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

test('智能体深链接：元信息等待期间始终保留搭档加载态，不闪回普通模型首页',async()=>{
 let release;const f=await mountAgents({path:'/agent/chat?agent=qg-agent-plan&draft=保留这条搭档草稿',extra:(call,data)=>call.url==='/api/agents/qg-agent-plan'?new Promise(done=>release=()=>done(relayJson(data['/api/agents/qg-agent-plan']))):undefined});try{assert.ok(document.querySelector('.qag-chat-intro'));assert.equal(document.querySelector('.qgc-empty'),null);assert.equal(document.querySelector('.cv-send').disabled,true);assert.equal(document.querySelector('[aria-label="允许联网检索"]'),null);assert.equal(document.querySelector('.cv-input').value,'保留这条搭档草稿');release();await settle();await settle();assert.equal(document.querySelector('.cv-input').value,'保留这条搭档草稿');assert.match(document.querySelector('.qag-chat-intro h1').textContent,/行动规划官/);assert.equal(f.calls.some(x=>x.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{release?.();await f.close();}
});

const multiPaintOptions = { ...paintOptions, models: [{ ...paintOptions.models[0], features: { qualities: ['auto', 'high'], resolutions: ['1K', '2K'], ratios: ['1:1', '3:4'], maxReferences: 8, mask: true, pixelSize: true } }] };
multiPaintOptions.defaultFeatures = multiPaintOptions.models[0].features;
const withMulti = call => call.url === '/api/image/options' ? paintResponse(multiPaintOptions) : null;
const editorDraft=()=>({prompt:'保留原来的绘画描述',negativePrompt:'避免文字',model:'image-a',ratio:'3:4',resolution:'2K',quality:'high',n:2,seed:4294967295,catId:'style-a',references:[{id:'editor-main',name:'主图.png'},{id:'editor-second',name:'材质.png'}],editOrigin:{taskId:'original-task',fileId:'editor-main'}});
const editorInputs=(sourceId='editor-main',maskId='editor-mask')=>({version:1,source:{id:sourceId,width:640,height:480,name:'主图.png',url:'/api/image/editor/files/'+sourceId},mask:maskId?{id:maskId,width:640,height:480,url:'/api/image/editor/files/'+maskId}:null});
const editorTransfer=(extra={})=>saveImageEditorTransfer('test-user',{sourceId:'editor-main',maskId:'editor-mask',prompt:'只改变已经选中的花朵',returnDraft:editorDraft(),...extra});
const editorRead=call=>call.url.startsWith('/api/image/editor/inputs?')?paintResponse(editorInputs()):call.url.startsWith('/api/image/editor/files/')?new Response(new Blob(['image fixture'],{type:'image/png'}),{headers:{'Content-Type':'image/png'}}):withMulti(call);

test('图像编辑台带入：恢复多图、选区与完整参数，明确生成才创建任务',async()=>{
 let seeded=false;const f=await mountPainting({intercept:call=>{if(call.url==='/api/image/options'&&!seeded){seeded=true;editorTransfer();}return editorRead(call);}});
 try{await settle();assert.match(document.querySelector('.qge-entry').textContent,/重绘设定已就位/);assert.equal(document.querySelector('#qp-prompt').value,'只改变已经选中的花朵');assert.equal(document.querySelectorAll('.qp-reference-tile img').length,2);assert.equal(f.calls.some(c=>c.method==='POST'&&c.url==='/api/image/tasks'),false);document.querySelector('.qp-generate').click();await settle();const sent=f.calls.find(c=>c.method==='POST'&&c.url==='/api/image/tasks');assert.ok(sent);for(const [key,value]of Object.entries({negativePrompt:'避免文字',model:'image-a',ratio:'3:4',resolution:'2K',quality:'high',n:2,seed:4294967295,catId:'style-a',mode:'img2img',editOf:'editor-main',maskId:'editor-mask',parentId:'original-task',action:'redraw'}))assert.equal(sent.body[key],value,key);assert.deepEqual(sent.body.referenceIds,['editor-main','editor-second']);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('图像编辑台带入：当前草稿需要确认，取消保留草稿并清除临时入口',async()=>{
 const f=await mountPainting({intercept:editorRead});try{relayInput('#qp-prompt','继续保留这个想法');await settle();const record=editorTransfer();await f.router.push({path:'/painting',query:{editor:record.id}});await settle();assert.match(document.querySelector('.qge-entry').textContent,/当前绘画草稿会/);assert.equal(document.querySelector('.qp-generate').disabled,true);assert.equal(document.querySelector('#qp-prompt').value,'继续保留这个想法');paintClick('.qge-entry button','保留当前草稿');await settle();assert.equal(document.querySelector('#qp-prompt').value,'继续保留这个想法');assert.equal(latestImageEditorTransfer('test-user'),null);assert.equal(f.router.currentRoute.value.query.editor,undefined);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('图像编辑台带入：确认时重新读取已撤回选区，失败保留当前草稿',async()=>{
 let withdrawn=false;const f=await mountPainting({intercept:call=>withdrawn&&call.url.startsWith('/api/image/editor/inputs?')?relayJson('图片已移除',404):editorRead(call)});try{relayInput('#qp-prompt','尚未替换的草稿');await settle();const record=editorTransfer();await f.router.push({path:'/painting',query:{editor:record.id}});await settle();withdrawn=true;paintClick('.qge-entry button','带入这份重绘设定');await settle();assert.match(document.querySelector('.qge-entry').textContent,/已移除/);assert.equal(document.querySelector('#qp-prompt').value,'尚未替换的草稿');assert.equal(document.querySelector('.qp-generate').disabled,true);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url==='/api/image/tasks').length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('图像编辑台带入：身份更新放弃迟到的私有素材回执',async()=>{
 let release,signal;const f=await mountPainting({intercept:call=>call.url.startsWith('/api/image/editor/inputs?')?new Promise(done=>{release=done;signal=call.signal;}):editorRead(call)});try{const record=editorTransfer();await f.router.push({path:'/painting',query:{editor:record.id}});await settle();assert.equal(document.querySelector('.qp-generate').disabled,true);f.auth.apply({accessToken:'renewed-access',refreshToken:'renewed-refresh',user:{id:'test-user',username:'新身份',role:'USER'}});await settle();assert.equal(signal.aborted,true);release(paintResponse(editorInputs()));await settle();assert.equal(document.querySelectorAll('.qp-reference-tile img').length,0);assert.doesNotMatch(document.querySelector('#mount').textContent,/只改变已经选中的花朵/);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url==='/api/image/tasks').length,0);assert.deepEqual(f.errors,[]);}finally{release?.(paintResponse(editorInputs()));await f.close();}
});
test('图像编辑台带入：公开设定与私有选区入口冲突时均不覆盖草稿',async()=>{
 const f=await mountPainting({intercept:editorRead});try{relayInput('#qp-prompt','保留冲突前的草稿');await settle();const record=editorTransfer();await f.router.push({path:'/painting',query:{editor:record.id,gallery:'image:shared-work'}});await settle();assert.equal(document.querySelector('#qp-prompt').value,'保留冲突前的草稿');assert.equal(document.querySelector('.qp-generate').disabled,true);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url==='/api/image/tasks').length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('图像编辑台返回：打开编辑前保存多图顺序与原作品关系',async()=>{
 let seeded=false;const f=await mountPainting({intercept:call=>{if(call.url==='/api/image/options'&&!seeded){seeded=true;editorTransfer();}return editorRead(call);}});try{await settle();f.router.addRoute({path:'/inpaint',component:{template:'<p>图像编辑入口</p>'}});paintClick('.qp-mask-action','在图像编辑台调整');await settle();assert.equal(f.router.currentRoute.value.path,'/inpaint');const record=readImageEditorTransfer('test-user',f.router.currentRoute.value.query.editor);assert.equal(record.maskId,'editor-mask');assert.equal(record.prompt,'只改变已经选中的花朵');assert.deepEqual(record.returnDraft.references,editorDraft().references);assert.deepEqual(record.returnDraft.editOrigin,editorDraft().editOrigin);assert.equal(record.returnDraft.seed,4294967295);assert.equal(f.calls.some(c=>c.method==='POST'&&c.url==='/api/image/tasks'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('多图历史按原顺序恢复，切换主图后明确生成携带新顺序', async () => {
  const fixture = await mountPainting({ items: [paintingTask('multi', { mode: 'img2img', editOf: 'a', referenceIds: ['a', 'b'] })], intercept: withMulti });
  try { document.querySelector('.qp-image-button').click(); await settle(); document.querySelector('.qp-secondary-action').click(); await settle();
    assert.equal(document.querySelectorAll('.qp-reference-tile img').length, 2);
    document.querySelector('[aria-label="将参考图 2 设为主图"]').click(); await settle();
    assert.equal(fixture.calls.some(c => c.url === '/api/image/tasks' && c.method === 'POST'), false);
    document.querySelector('.qp-generate').click(); await settle(); const accepted = fixture.calls.find(c => c.url === '/api/image/tasks' && c.method === 'POST');
    assert.deepEqual(accepted.body.referenceIds, ['b', 'a']); assert.equal(accepted.body.editOf, 'b'); assert.equal(accepted.body.maskId, undefined); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('删除主图会把下一张升为主图，不会提交已移除的私有文件', async () => {
  const fixture = await mountPainting({ items: [paintingTask('multi', { mode: 'img2img', editOf: 'a', referenceIds: ['a', 'b'] })], intercept: withMulti });
  try { document.querySelector('.qp-image-button').click(); await settle(); document.querySelector('.qp-secondary-action').click(); await settle();
    document.querySelector('[aria-label="移除参考图 1"]').click(); await settle(); document.querySelector('.qp-generate').click(); await settle();
    const accepted = fixture.calls.find(c => c.url === '/api/image/tasks' && c.method === 'POST'); assert.deepEqual(accepted.body.referenceIds, ['b']); assert.equal(accepted.body.editOf, 'b'); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('历史参考图超出所选模型能力时不提交，局部重绘入口明确禁用', async () => {
  const fixture = await mountPainting({ items: [paintingTask('multi', { mode: 'img2img', editOf: 'a', referenceIds: ['a', 'b'] })], intercept: call => call.url === '/api/image/options' ? paintResponse({ ...multiPaintOptions, models: [{ ...multiPaintOptions.models[0], features: { ...multiPaintOptions.models[0].features, maxReferences: 1, mask: false } }] }) : null });
  try { document.querySelector('.qp-image-button').click(); await settle(); document.querySelector('.qp-secondary-action').click(); await settle(); document.querySelector('.qp-generate').click(); await settle();
    assert.equal(fixture.calls.some(c => c.url === '/api/image/tasks' && c.method === 'POST'), false); assert.equal(document.querySelector('.qp-mask-action').disabled, true); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('一次选择多张图片各自上传，保留文件顺序，上传不触发生成', async () => {
  let count = 0; const fixture = await mountPainting({ intercept: call => withMulti(call) || (call.url === '/api/upload' && call.method === 'POST' ? paintResponse({ id: 'uploaded-' + (++count) }) : null) });
  try { paintClick('.qp-mode button', '参考图创作'); await settle(); const input = document.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['first'], 'first.png', { type: 'image/png' }), new File(['second'], 'second.png', { type: 'image/png' })] }); input.dispatchEvent(new Event('change')); await settle(); await settle();
    assert.equal(count, 2); assert.equal(document.querySelectorAll('.qp-reference-tile img').length, 2); assert.equal(fixture.calls.some(c => c.url === '/api/image/tasks' && c.method === 'POST'), false); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
test('上传中的路由离开会放弃迟到结果，返回创作台不会带回旧图片', async () => {
  let finish, signal; const fixture = await mountPainting({ intercept: call => withMulti(call) || (call.url === '/api/upload' && call.method === 'POST' ? new Promise(done => { finish = done; signal = call.signal; }) : null) });
  try { paintClick('.qp-mode button', '参考图创作'); await settle(); const input = document.querySelector('input[type=file]'); Object.defineProperty(input, 'files', { configurable: true, value: [new File(['old'], 'old.png', { type: 'image/png' })] }); input.dispatchEvent(new Event('change')); await settle();
    await fixture.router.push('/chat'); await settle(); assert.equal(signal.aborted, true); finish(paintResponse({ id: 'late-file' })); await settle(); await fixture.router.push('/painting'); await settle(); paintClick('.qp-mode button', '参考图创作'); await settle(); assert.equal(document.querySelectorAll('.qp-reference-tile img').length, 0); assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('从作品第二张继续编辑使用选中图片，明确生成才附带来源作品', async () => {
  const fixture = await mountPainting({ intercept: withMulti });
  try { document.querySelector('.qp-image-button').click(); await settle(); document.querySelector('[aria-label="下一张作品"]').click(); await settle(); paintClick('.qp-mask-action', '继续编辑这张图'); await settle(); assert.equal(fixture.calls.some(c => c.url === '/api/image/tasks' && c.method === 'POST'), false); document.querySelector('.qp-generate').click(); await settle(); const accepted = fixture.calls.find(c => c.url === '/api/image/tasks' && c.method === 'POST'); assert.deepEqual(accepted.body.referenceIds, ['first-2']); assert.equal(accepted.body.editOf, 'first-2'); assert.equal(accepted.body.parentId, 'first'); assert.equal(accepted.body.action, 'variant'); assert.equal(accepted.body.n, 1); assert.deepEqual(fixture.errors, []); }
  finally { await fixture.close(); }
});


const emailChallengeSample=()=>({challengeId:'71ce2401-3443-4bf9-93ce-111111111111',expiresAt:new Date(Date.now()+600000).toISOString(),resendAfter:60});
function emailRelay(extra){return call=>extra?.(call)||(call.url==='/api/auth/registration-policy'?relayJson({emailVerificationRequired:true,emailDeliveryReady:true,expiresIn:600,resendAfter:60}):call.url==='/api/settings/public'?relayJson({'security.registerEnabled':true}):call.url==='/api/auth/captcha'?relayJson({captchaId:'email-captcha',svg:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}):call.url==='/api/auth/registration-code'||call.url==='/api/auth/email-verification/send'?relayJson(emailChallengeSample()):null);}
async function emailRequest(f){await settle();document.querySelector('.qev-send').click();await settle();await settle();assert.ok(document.querySelector('[aria-label="邮箱验证码"]'));}
test('注册邮箱：寄送前需要邮箱和图形码，寄送不会自动注册，修改地址使旧挑战离开表单',async()=>{
 const f=await mount({realLogin:true,initialPath:'/login?invite=QGTEAM26',intercept:emailRelay()});try{document.querySelector('.qev-send').click();await settle();assert.equal(f.calls.some(c=>c.url==='/api/auth/registration-code'),false);relayInput('#qg-auth-email','owner@qgauss.test');relayInput('#qg-auth-captchaCode','QG26');await emailRequest(f);const sent=f.calls.find(c=>c.url==='/api/auth/registration-code');assert.equal(sent.body.captchaCode,'QG26');assert.equal(sent.body.email,'owner@qgauss.test');assert.equal(document.querySelector('.qev-send').disabled,true);assert.equal(document.querySelector('#qg-auth-captchaCode').value,'');relayInput('[aria-label="邮箱验证码"]','012345');relayInput('#qg-auth-email','next@qgauss.test');await settle();assert.equal(document.querySelector('[aria-label="邮箱验证码"]'),null);assert.equal(f.calls.some(c=>c.url==='/api/auth/register'),false);assert.equal(JSON.stringify({...localStorage,...sessionStorage}).includes('012345'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('注册邮箱：确认创建只提交邮箱挑战和原样六位代码，不重复使用已消费的图形码',async()=>{
 const f=await mount({realLogin:true,initialPath:'/login?invite=QGTEAM26',intercept:emailRelay(c=>c.url==='/api/auth/register'?relayJson({accessToken:'created-access',refreshToken:'created-refresh',user:{id:'created-user',username:'qg_creator',role:'USER',email:'owner@qgauss.test',emailVerifiedAt:new Date().toISOString()}}):null)});try{relayInput('#qg-auth-username','qg_creator');relayInput('#qg-auth-password','SyntheticPass-123');relayInput('#qg-auth-email','owner@qgauss.test');relayInput('#qg-auth-captchaCode','QG26');await emailRequest(f);relayInput('[aria-label="邮箱验证码"]','012345');const agreed=document.querySelector('.qg-auth-agreement-check input');agreed.checked=true;agreed.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.qg-auth-form-flow form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();await settle();const call=f.calls.find(c=>c.url==='/api/auth/register');assert.ok(call);assert.equal(call.body.emailCode,'012345');assert.equal(call.body.emailChallengeId,emailChallengeSample().challengeId);assert.equal(Object.hasOwn(call.body,'captchaId'),false);assert.equal(f.calls.filter(c=>c.url==='/api/auth/register').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('注册邮箱：注册要求未确认时不允许提交，离开后的迟到策略不会打开旧表单',async()=>{
 let release;const f=await mount({realLogin:true,initialPath:'/login?invite=QGTEAM26',intercept:emailRelay(c=>c.url==='/api/auth/registration-policy'?new Promise(done=>{release=()=>done(relayJson({emailVerificationRequired:true,emailDeliveryReady:true}));}):null)});try{assert.equal(document.querySelector('.qg-auth-form-flow button[type="submit"]').disabled,true);await f.router.push('/chat');release();await settle();assert.equal(document.querySelector('.qg-auth-form-flow'),null);assert.equal(f.calls.some(c=>c.url==='/api/auth/register'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('个人邮箱：验证成功保留未保存的昵称并更新账户验证状态',async()=>{
 const at=new Date().toISOString(),f=await mount({loggedIn:true,initialPath:'/account',intercept:emailRelay(c=>c.url==='/api/auth/email-verification/confirm'?relayJson({emailVerifiedAt:at}):null)});try{accountInput('#qac-name','尚未保存的昵称');await accountSecurity();await emailRequest(f);relayInput('[aria-label="邮箱验证码"]','246810');await settle();document.querySelector('.qev-confirm').click();await settle();assert.match(document.querySelector('.qev-card').textContent,/已验证/);assert.equal(f.auth.user.emailVerifiedAt,at);assert.equal(document.activeElement,document.querySelector('.qev-card h3'));document.querySelector('.qac-tabs button').click();await settle();assert.equal(document.querySelector('#qac-name').value,'尚未保存的昵称');assert.equal(f.calls.some(c=>c.url==='/api/users/profile'&&c.method==='PATCH'),false);assert.equal(f.calls.filter(c=>c.url==='/api/auth/email-verification/confirm').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('个人邮箱：确认响应丢失时只读取最新资料，不自动重复确认',async()=>{
 let confirmed=false;const at=new Date().toISOString(),f=await mount({loggedIn:true,initialPath:'/account',intercept:emailRelay(c=>{if(c.url==='/api/auth/email-verification/confirm'){confirmed=true;throw new TypeError('Synthetic response lost');}if(confirmed&&c.url==='/api/users/profile')return relayJson({id:'test-user',username:'测试用户',email:'observer@qgauss.test',emailVerifiedAt:at,role:'USER'});return null;})});try{await accountSecurity();await emailRequest(f);relayInput('[aria-label="邮箱验证码"]','246810');await settle();document.querySelector('.qev-confirm').click();await settle();await settle();assert.match(document.querySelector('.qev-card').textContent,/已验证/);assert.equal(f.calls.filter(c=>c.url==='/api/auth/email-verification/confirm').length,1);assert.ok(f.calls.filter(c=>c.url==='/api/users/profile').length>=2);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('个人邮箱：离开中的迟到寄送结果不带回新页面，也不触发自动确认',async()=>{
 let release;const f=await mount({loggedIn:true,initialPath:'/account',intercept:emailRelay(c=>c.url==='/api/auth/email-verification/send'?new Promise(done=>{release=()=>done(relayJson(emailChallengeSample()));}):null)});try{await accountSecurity();document.querySelector('.qev-send').click();await settle();await f.router.push('/chat');release();await settle();await f.router.push('/account');await settle();await accountSecurity();assert.equal(document.querySelector('[aria-label="邮箱验证码"]'),null);assert.equal(f.calls.some(c=>c.url==='/api/auth/email-verification/confirm'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('个人邮箱：发件未准备时说明状态，没有无效寄送按钮',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/account',intercept:emailRelay(c=>c.url==='/api/auth/registration-policy'?relayJson({emailVerificationRequired:false,emailDeliveryReady:false}):null)});try{await accountSecurity();assert.match(document.querySelector('.qev-card').textContent,/投递尚未就绪/);assert.equal(document.querySelector('.qev-send'),null);assert.equal(f.calls.some(c=>c.url==='/api/auth/email-verification/send'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('视频素材入口：精修、口型与方舟连接可填写素材入口，保存不发起外部任务',async()=>{
 const data=filmToolsData();data['/api/video/admin/config'].profiles.push({key:'ARK_2_0',name:'方舟 Seedance 2.0'},{key:'FAL_UPSCALE',name:'视频精修'},{key:'FAL_LIPSYNC',name:'口型同步'});const f=await mount({loggedIn:true,admin:true,initialPath:'/video/manage',intercept:videoInterceptor(call=>call.method==='PUT'&&call.url.includes('/presets/')?relayJson({...call.body,id:'qg-motion-ark',version:4}):null,data)});
 try{for(const profile of ['FAL_UPSCALE','FAL_LIPSYNC','ARK_2_0']){filmSelect('[aria-label="视频协议"]',profile);await settle();const input=document.querySelector('[aria-label="视频公网入口"]');assert.ok(input,'Each material-dependent profile must expose its origin input');relayInput('[aria-label="视频公网入口"]','https://qgauss.example');if(profile==='FAL_UPSCALE'){assert.equal(document.querySelector('[aria-label="视频上游模型"]').value,'topaz/upscale/video/precision');assert.match(document.querySelector('.qva-form').textContent,/放大倍率²/);}if(profile==='FAL_LIPSYNC'){assert.equal(document.querySelector('[aria-label="视频上游模型"]').value,'fal-ai/sync-lipsync/v3');assert.match(document.querySelector('.qva-form').textContent,/较长素材秒数/);}}document.querySelector('.qva-panel form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();const call=f.calls.find(c=>c.method==='PUT'&&c.url.includes('/presets/'));assert.equal(call.body.publicBaseUrl,'https://qgauss.example');assert.equal(call.body.profile,'ARK_2_0');assert.equal(f.calls.some(c=>c.url==='/api/video/quote'||c.url==='/api/video/tasks'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('视频素材精修：模型切换选择有效操作，带入原片后报价包含倍率和私有素材',async()=>{
 const data=filmToolsData(),row=data['/api/video/tasks'].items[0];const f=await mount({loggedIn:true,initialPath:'/video',intercept:videoInterceptor(call=>call.url==='/api/video/materials/from-task/'+row.id?relayJson({id:'owned-film',filename:'原片.mp4',duration:6,width:640,height:640,mime:'video/mp4'}):call.url==='/api/video/quote'?relayJson({revision:'a'.repeat(64),name:'画面精修室',cost:26,pool:'drawMj',seconds:6,multiplier:4,followsSource:true,materials:[{kind:'video',filename:'原片.mp4',duration:6}]}):null,data)});
 try{filmSelect('[aria-label="视频创作模型"]','qg-film-upscale');await settle();assert.equal(document.querySelector('.qv-modes button[aria-pressed="true"]').textContent,'画面精修');filmSelect('[aria-label="从当前片库页选择视频"]',row.id);await settle();videoClick('带入 ↗');await settle();await settle();assert.equal(document.querySelectorAll('.qvm-card').length,1);videoClick('开始精修↗');await settle();const quote=f.calls.find(c=>c.url==='/api/video/quote');assert.ok(quote,'Prepared original must reach explicit quotation');assert.deepEqual(quote.body.videoIds,['owned-film']);assert.equal(quote.body.enhanceModel,'Proteus');assert.equal(quote.body.upscaleFactor,2);assert.equal(quote.body.noise,undefined);assert.equal(quote.body.seed,undefined);assert.match(document.querySelector('.qv-confirm').textContent,/原片.mp4/);assert.match(document.querySelector('.qv-confirm').textContent,/26 绘画次数/);assert.equal(f.calls.some(c=>c.url==='/api/video/tasks'&&c.method==='POST'),false);videoClick('再想一想');for(const [model,max] of [['Proteus Natural','2'],['Gaia 2','2'],['Rhea','4']]){filmSelect('[aria-label="视频精修模型"]',model);await settle();assert.equal(document.querySelector('[aria-label="视频放大倍率"]').max,max);}assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('视频多素材：图片、视频、声音使用各自上传入口与原顺序，先确认再提交',async()=>{
 const data=filmToolsData();const f=await mount({loggedIn:true,initialPath:'/video',intercept:videoInterceptor(call=>call.method==='POST'&&call.url.startsWith('/api/video/materials/')?relayJson({id:'owned-'+call.url.split('/').pop(),filename:'本地素材',duration:3,width:640,height:640}):call.url==='/api/video/quote'?relayJson({revision:'b'.repeat(64),cost:8,pool:'drawMj',name:'光影叙事'}):null,data)});
 try{videoClick('多素材导演');await settle();relayInput('#qv-prompt','用画面 1、视频 1 和声音 1 创作下一幕');for(const kind of ['image','video','audio'])await filmAddFile(kind);videoClick('让素材成为下一幕↗');await settle();const quote=f.calls.find(c=>c.url==='/api/video/quote');assert.deepEqual(quote.body.imageIds,['owned-image']);assert.deepEqual(quote.body.videoIds,['owned-video']);assert.deepEqual(quote.body.audioIds,['owned-audio']);assert.equal(quote.body.mode,'reference');assert.equal(document.querySelectorAll('.qvm-card').length,3);assert.equal(document.querySelector('.qv-confirm').open,true);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('视频素材切换：不支持的原素材保留并提示，不能悄悄丢弃后提交',async()=>{
 const data=filmToolsData();const f=await mount({loggedIn:true,initialPath:'/video',intercept:videoInterceptor(call=>call.url==='/api/video/materials/image'?relayJson({id:'owned-scene',filename:'画面参考'}):null,data)});
 try{videoClick('多素材导演');await settle();await filmAddFile('image');filmSelect('[aria-label="视频创作模型"]','qg-film-upscale');await settle();assert.equal(document.querySelectorAll('.qvm-card').length,1);assert.match(document.querySelector('.qvm-error').textContent,/上限/);videoClick('开始精修↗');await settle();assert.equal(f.calls.some(c=>c.url==='/api/video/quote'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('视频素材移除：停止预览并释放本页对象地址，下一次确认不再携带文件',async()=>{
 const data=filmToolsData(),revoked=[],prior=URL.revokeObjectURL;URL.revokeObjectURL=url=>{revoked.push(url);prior(url);};const f=await mount({loggedIn:true,initialPath:'/video',intercept:videoInterceptor(call=>call.url==='/api/video/materials/audio'?relayJson({id:'owned-sound',filename:'声音参考',duration:3}):null,data)});
 try{videoClick('多素材导演');await settle();await filmAddFile('audio');const audio=document.querySelector('.qvm-card audio'),source=audio.src;assert.match(source,/^blob:/);document.querySelector('[aria-label="移除声音素材 1"]').click();await settle();assert.ok(revoked.includes(source));assert.equal(document.querySelector('.qvm-card audio'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();URL.revokeObjectURL=prior;}
});


test('视频历史再创作：重新带入本人原素材，不沿用另一份草稿或成片编号',async()=>{
 const data=filmToolsData(),row=data['/api/video/tasks'].items[0];row.mode='reference';row.materials=[{id:'history-private-video',kind:'video',filename:'历史原片.mp4',duration:6}];row.params={...row.params,mode:'reference',videoIds:['history-private-video']};data['/api/video/tasks/'+row.id]=row;
 const f=await mount({loggedIn:true,initialPath:'/video',intercept:videoInterceptor(call=>call.url==='/api/video/quote'?relayJson({revision:'c'.repeat(64),cost:8,pool:'drawMj',name:'光影叙事'}):null,data)});
 try{document.querySelector('.qv-poster').click();await settle();await settle();videoClick('带着灵感再创作');await settle();assert.match(document.querySelector('.qvm-card').textContent,/历史原片/);videoClick('让素材成为下一幕↗');await settle();const quote=f.calls.find(c=>c.url==='/api/video/quote');assert.equal(quote.body.mode,'reference');assert.deepEqual(quote.body.videoIds,['history-private-video']);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('视频素材预览：按需读取，移除中的迟到文件不能恢复已删除预览',async()=>{
 const data=filmToolsData(),row=data['/api/video/tasks'].items[0];let release;const held=new Promise(done=>{release=done;});const f=await mount({loggedIn:true,initialPath:'/video',intercept:videoInterceptor(async call=>call.url==='/api/video/materials/from-task/'+row.id?relayJson({id:'preview-owned-video',filename:'按需原片.mp4',duration:6}):call.url==='/api/upload/preview-owned-video/raw'?(await held,new Response(new Blob(['local preview'],{type:'video/mp4'}))):null,data)});
 try{filmSelect('[aria-label="视频创作模型"]','qg-film-upscale');await settle();filmSelect('[aria-label="从当前片库页选择视频"]',row.id);await settle();videoClick('带入 ↗');await settle();await settle();assert.equal(f.calls.some(c=>c.url==='/api/upload/preview-owned-video/raw'),false);document.querySelector('[aria-label="预览视频素材 1"]').click();await settle();assert.equal(f.calls.filter(c=>c.url==='/api/upload/preview-owned-video/raw').length,1);document.querySelector('[aria-label="移除视频素材 1"]').click();await settle();release();await settle();await settle();assert.equal(document.querySelector('.qvm-card'),null);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});

function creatorInterceptor(extra,data=appStudioFixtures('creator-ready','test-user')){return async call=>{const result=await extra?.(call,data);if(result)return result;const url=new URL(call.url,'http://qgauss.test');if(call.method==='GET'&&Object.hasOwn(data,url.pathname))return relayJson(appStudioPage(data[url.pathname],url));};}
const creatorRow=(extra={})=>({...appStudioFixtures('creator-ready','test-user')['/api/apps/mine/qg-role-1'],...extra});
function creatorFill(name='新灵感搭档'){relayInput('[aria-label="自建应用名称"]',name);relayInput('[aria-label="自建应用角色设定"]','只保留在编辑器中的私人设定。');}
async function creatorSave(){document.querySelector('.qcs-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();await settle();}
const studioWrites=f=>f.calls.filter(call=>call.method!=='GET'&&call.url.includes('/apps/'));

test('自建应用：首次打开只读取，选中记录后才获取私有设定',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/role',intercept:creatorInterceptor()});try{assert.equal(studioWrites(f).length,0);assert.equal(document.querySelector('[aria-label="自建应用角色设定"]').value,'');document.querySelector('.qcs-mini').click();await settle();assert.match(document.querySelector('[aria-label="自建应用角色设定"]').value,/耐心的灵感伙伴/);assert.equal(f.calls.filter(c=>c.url==='/api/apps/mine/qg-role-1').length,1);assert.equal(JSON.stringify({...sessionStorage}).includes('耐心的灵感伙伴'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：预览不生成，显式保存提交完整角色内容且不提交归属或公开状态',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/role',intercept:creatorInterceptor(call=>call.method==='POST'&&call.url==='/api/apps/mine'?relayJson(creatorRow({...call.body,version:1})):null)});try{creatorFill();await settle();assert.match(document.querySelector('.qcs-preview').textContent,/新灵感搭档/);assert.equal(studioWrites(f).length,0);await creatorSave();const save=studioWrites(f)[0];assert.equal(save.body.name,'新灵感搭档');assert.equal(save.body.systemPrompt,'只保留在编辑器中的私人设定。');assert.equal(save.body.defaultModel,null);assert.match(save.body.requestKey,/^[a-f\d-]{36}$/i);for(const key of ['ownerId','published','reviewStatus'])assert.equal(save.body[key],undefined);assert.equal(f.calls.some(c=>c.url==='/api/chat/completions'),false);assert.equal(sessionStorage.getItem('qg:app-create:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：保存中断仅保留恢复编号，继续原保存使用同一份内容与编号',async()=>{
 let attempts=0;const f=await mount({loggedIn:true,initialPath:'/role',intercept:creatorInterceptor(call=>{if(call.url.startsWith('/api/apps/mine/by-request/'))return relayJson('暂未找到',404);if(call.method==='POST'&&call.url==='/api/apps/mine'){attempts++;return attempts===1?Promise.reject(Error('连接中断')):relayJson(creatorRow({...call.body,version:1}));}})});
 try{creatorFill();await creatorSave();const first=studioWrites(f)[0];assert.equal(sessionStorage.getItem('qg:app-create:test-user'),first.body.requestKey);assert.equal(JSON.stringify({...sessionStorage}).includes('私人设定'),false);relayInput('[aria-label="自建应用名称"]','尚未保存的新名字');await settle();videoClick('核对原保存结果');await settle();assert.equal(sessionStorage.getItem('qg:app-create:test-user'),first.body.requestKey);videoClick('继续原保存');await settle();assert.equal(studioWrites(f).length,1);videoClick('返回核对');await settle();assert.equal(studioWrites(f).length,1);videoClick('继续原保存');await settle();videoClick('继续原保存 ↗');await settle();await settle();assert.deepEqual(studioWrites(f)[1].body,first.body);assert.equal(document.querySelector('[aria-label="自建应用名称"]').value,'尚未保存的新名字');assert.equal(sessionStorage.getItem('qg:app-create:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：明确拒绝后可修改再保存，未知结果找回原记录不再创建',async()=>{
 let attempts=0,saved;const f=await mount({loggedIn:true,initialPath:'/role',intercept:creatorInterceptor(call=>{if(call.url.startsWith('/api/apps/mine/by-request/'))return relayJson(saved);if(call.method==='POST'&&call.url==='/api/apps/mine'){attempts++;if(attempts===1)return relayJson('请调整角色内容',400);saved=creatorRow({...call.body,version:1});return Promise.reject(Error('连接中断'));}})});
 try{creatorFill();await creatorSave();assert.equal(sessionStorage.getItem('qg:app-create:test-user'),null);relayInput('[aria-label="自建应用名称"]','重新打磨');await creatorSave();assert.notEqual(studioWrites(f)[0].body.requestKey,studioWrites(f)[1].body.requestKey);videoClick('核对原保存结果');await settle();assert.equal(studioWrites(f).length,2);assert.equal(document.querySelector('[aria-label="自建应用名称"]').value,'重新打磨');assert.equal(sessionStorage.getItem('qg:app-create:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：重开页面只查询原保存，草稿设定不会写入浏览器存储',async()=>{
 const key='00000000-0000-4000-8000-000000000123';const f=await mount({loggedIn:true,initialPath:'/role',storedAppCreate:key,intercept:creatorInterceptor(call=>call.url.startsWith('/api/apps/mine/by-request/')?relayJson('未保存',404):null)});try{await settle();assert.equal(studioWrites(f).length,0);assert.equal(sessionStorage.getItem('qg:app-create:test-user'),key);creatorFill();await settle();videoClick('继续原保存');await settle();assert.equal(studioWrites(f).length,0);assert.match(document.querySelector('#qcs-recovery-title').textContent,/上一份保存/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：版本冲突保留修改，刷新档案不会抹去草稿',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/role',intercept:creatorInterceptor(call=>call.method==='PUT'?relayJson('应用已更新，请重新核对',409):null)});try{document.querySelector('.qcs-mini').click();await settle();relayInput('[aria-label="自建应用名称"]','未保存的名字');await creatorSave();const save=studioWrites(f)[0];assert.equal(save.body.version,2);assert.equal(save.url,'/api/apps/mine/qg-role-1');assert.equal(sessionStorage.getItem('qg:app-action:test-user'),null);const refresh=document.querySelector('.qcs-refresh');assert.ok(refresh);refresh.click();await settle();assert.equal(document.querySelector('[aria-label="自建应用名称"]').value,'未保存的名字');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：切换草稿先确认放弃，取消时不读取其他私有设定',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/role',intercept:creatorInterceptor()});try{creatorFill();await settle();assert.equal(window.dispatchEvent(new Event('beforeunload',{cancelable:true})),false);document.querySelector('.qcs-mini').click();await settle();assert.equal(document.querySelector('#qcs-discard-title').closest('dialog').open,true);assert.equal(f.calls.some(c=>c.url==='/api/apps/mine/qg-role-1'),false);videoClick('继续编辑');await settle();assert.equal(document.querySelector('[aria-label="自建应用名称"]').value,'新灵感搭档');document.querySelector('.qcs-mini').click();await settle();videoClick('放弃修改');await settle();assert.equal(document.querySelector('[aria-label="自建应用名称"]').value,'灵感漫游者');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：提交需确认，未知结果只读核对后明确结束等待',async()=>{
 const row=creatorRow();const f=await mount({loggedIn:true,initialPath:'/role',intercept:creatorInterceptor(call=>{if(call.method==='POST'&&call.url.endsWith('/submit'))return Promise.reject(Error('结果未返回'));if(call.method==='POST'&&call.url.endsWith('/reconcile'))return relayJson({resolution:'not-applied',app:{...row,version:3,lastActionKey:call.body.requestKey,lastAction:'RECONCILE'}});})});
 try{document.querySelector('.qcs-mini').click();await settle();videoClick('提交到应用广场 ✦');await settle();assert.equal(studioWrites(f).length,0);videoClick('再看看');await settle();assert.equal(studioWrites(f).length,0);videoClick('提交到应用广场 ✦');await settle();videoClick('确认提交审核 ↗');await settle();const pending=JSON.parse(sessionStorage.getItem('qg:app-action:test-user'));assert.deepEqual(Object.keys(pending).sort(),['id','kind','requestKey','version']);assert.equal(pending.kind,'SUBMIT');const recovery=[...document.querySelectorAll('.qcs-recovery button')].find(b=>b.textContent.includes('核对原操作'));assert.ok(recovery);recovery.click();await settle();assert.equal(studioWrites(f).length,1);videoClick('核对并结束等待 ↗');await settle();assert.equal(studioWrites(f)[1].url,'/api/apps/mine/qg-role-1/reconcile');assert.deepEqual(studioWrites(f)[1].body,{version:2,requestKey:pending.requestKey});assert.equal(sessionStorage.getItem('qg:app-action:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('自建应用：重新进入仅核对原操作，不自动再次提交或撤回',async()=>{
 const pending={id:'qg-role-1',version:2,kind:'SUBMIT',requestKey:'00000000-0000-4000-8000-000000000123'};const f=await mount({loggedIn:true,initialPath:'/role',storedAppAction:pending,intercept:creatorInterceptor()});try{await settle();assert.equal(studioWrites(f).length,0);assert.ok(sessionStorage.getItem('qg:app-action:test-user'));assert.match(document.querySelector('.qcs-recovery').textContent,/核对/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('应用审核：打开档案不发奖，明确通过时提交所核对的奖励版本',async()=>{
 const data=appStudioFixtures('review-ready','test-user');const f=await mount({loggedIn:true,admin:true,initialPath:'/apps/manage',intercept:creatorInterceptor(call=>call.method==='POST'?relayJson({...data['/api/apps/admin/review/qg-role-2'],reviewStatus:'APPROVED',published:true,version:4}):null,data)});try{document.querySelector('.qar-row').click();await settle();assert.match(document.querySelector('[aria-label="待审核角色设定"]').value,/耐心的灵感伙伴/);assert.equal(studioWrites(f).length,0);videoClick('让它进入广场 ↗');await settle();assert.equal(studioWrites(f).length,0);videoClick('确认这次决定 ↗');await settle();const save=studioWrites(f)[0];assert.equal(save.body.decision,'APPROVE');assert.equal(save.body.version,3);assert.equal(save.body.offerRevision,'a'.repeat(64));assert.equal(document.querySelector('#qar-confirm-title').closest('dialog').open,false);assert.equal(document.activeElement,document.querySelector('.qar-detail h2'));assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('应用审核：未知决定阻止重复通过，重开仅查询，显式核对才结束等待',async()=>{
 const pending={id:'qg-role-2',version:3,kind:'REVIEW',requestKey:'00000000-0000-4000-8000-000000000123'},data=appStudioFixtures('review-ready','test-user');const f=await mount({loggedIn:true,admin:true,initialPath:'/apps/manage',storedReviewAction:pending,intercept:creatorInterceptor(call=>call.method==='POST'&&call.url.endsWith('/reconcile')?relayJson({resolution:'not-applied',app:{...data['/api/apps/admin/review/qg-role-2'],version:4,lastActionKey:call.body.requestKey,lastAction:'RECONCILE'}}):null,data)});try{await settle();assert.equal(studioWrites(f).length,0);document.querySelector('.qar-row').click();await settle();assert.equal([...document.querySelectorAll('.qar-actions button')].every(b=>b.disabled),true);videoClick('核对原审核结果 ↗');await settle();assert.equal(studioWrites(f).length,0);videoClick('核对并结束等待 ↗');await settle();assert.equal(studioWrites(f).length,1);assert.equal(studioWrites(f)[0].url,'/api/apps/admin/review/qg-role-2/reconcile');assert.equal(sessionStorage.getItem('qg:app-review:test-user'),null);assert.equal([...document.querySelectorAll('.qar-actions button')].every(b=>!b.disabled),true);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('应用审核：退回反馈保留未提交修改，切换队列先确认',async()=>{
 const f=await mount({loggedIn:true,admin:true,initialPath:'/apps/manage',intercept:creatorInterceptor()});try{document.querySelector('.qar-row').click();await settle();relayInput('[aria-label="应用审核反馈"]','请写清楚擅长的场景');await settle();videoClick('已经公开');await settle();assert.equal(document.querySelector('#qar-discard-title').closest('dialog').open,true);videoClick('继续核对');await settle();assert.equal(document.querySelector('[aria-label="应用审核反馈"]').value,'请写清楚擅长的场景');videoClick('已经公开');await settle();videoClick('放弃反馈');await settle();assert.equal(document.querySelector('[aria-label="待审核角色设定"]'),null);assert.match(document.querySelector('.qar-row').textContent,/你的文字搭档/);assert.equal(studioWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('应用审核：新档案加载失败清除旧设定，账户变化不重现迟到内容',async()=>{
 let release;const held=new Promise(r=>release=r);const f=await mount({loggedIn:true,admin:true,initialPath:'/apps/manage',intercept:creatorInterceptor(async call=>{if(call.url==='/api/apps/admin/review/qg-role-2'){await held;return relayJson(creatorRow({name:'旧账户私有内容'}));}})});try{document.querySelector('.qar-row').click();await settle();assert.equal(document.querySelector('[aria-label="待审核角色设定"]'),null);f.auth.clearLocal();await settle();release();await settle();assert.equal(document.querySelector('[aria-label="待审核角色设定"]'),null);assert.equal(document.body.textContent.includes('旧账户私有内容'),false);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});
test('应用入口：两种分享参数都只打开详情，访客开始协作保留登录返回地址',async()=>{
 for(const param of ['shareId','shareAppId']){const data=appStudioFixtures();const f=await mount({initialPath:'/app-store?'+param+'=qg-role-share-3',realGuard:true,intercept:creatorInterceptor(null,data)});try{await settle();assert.equal(f.router.currentRoute.value.path,'/apps');assert.equal(document.querySelector('.qa-detail-dialog').open,true);assert.match(document.querySelector('#qa-detail-title').textContent,/你的文字搭档/);assert.equal(studioWrites(f).length,0);document.querySelector('.qa-detail-actions .qa-start').click();await settle();assert.equal(f.router.currentRoute.value.path,'/login');assert.equal(f.router.currentRoute.value.query.redirect,'/chat?app=qg-role-3');assert.deepEqual(f.errors,[]);}finally{await f.close();}}
});
test('应用入口：失效或重复分享参数明确提示，不打开其他应用或发起对话',async()=>{
 for(const query of ['shareId=missing','shareId=x&shareId=y']){const f=await mount({initialPath:'/apps?'+query,intercept:creatorInterceptor(call=>call.url.startsWith('/api/apps/shared/')?relayJson('不可用',404):null)});try{await settle();assert.match(document.querySelector('.qa-inline-error').textContent,/分享|链接/);assert.equal(document.querySelector('.qa-detail-dialog').open,false);assert.equal(studioWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
});
test('应用对话：深链接核对版本与开场白，不自动发送，提问带上角色版本',async()=>{
 const data=creatorChatData();data['/api/apps/qg-role-1']={...data['/api/apps/qg-role-1'],defaultModel:'qa-second'};const f=await mount({loggedIn:true,initialPath:'/chat?app=qg-role-1',intercept:creatorInterceptor(call=>call.method==='POST'&&call.url==='/api/chat/completions'?relayJson('本地仅检查提问',400):null,data)});try{await settle();assert.match(document.querySelector('.cv-app').textContent,/灵感漫游者/);assert.match(document.querySelector('.cv-thread').textContent,/今天有什么/);assert.equal(f.calls.some(c=>c.url==='/api/chat/completions'),false);relayInput('.cv-input','新的问题');await settle();document.querySelector('.cv-send').click();await settle();const save=f.calls.find(c=>c.url==='/api/chat/completions');assert.ok(save);assert.equal(save.body.appId,'qg-role-1');assert.equal(save.body.appVersion,2);assert.equal(save.body.model,'qa-second');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('应用对话：同页切换应用忽略迟到档案，历史不可用时阻止新提问',async()=>{
 let release;const held=new Promise(r=>release=r);const data=creatorChatData();const f=await mount({loggedIn:true,initialPath:'/chat?app=qg-role-1',intercept:creatorInterceptor(async call=>{if(call.url==='/api/apps/qg-role-1'){await held;return relayJson(data[call.url]);}if(call.url==='/api/conversations/c2')return relayJson({id:'c2',appId:'qg-role-2',app:null,model:{name:'qa-model'},messages:[{id:'old',role:'ASSISTANT',content:'仍然可以查看的历史回答',status:'COMPLETED'}]});},data)});try{await f.router.push('/chat?app=qg-role-3');await settle();release();await settle();assert.match(document.querySelector('.cv-app').textContent,/你的文字搭档/);await f.router.push('/chat');await settle();const historyButton=[...document.querySelectorAll('.qgc-history-tabs button')].find(b=>/应用/.test(b.textContent));if(historyButton){historyButton.click();await settle();}const row=[...document.querySelectorAll('.cv-conv')].find(b=>b.textContent.includes('应用对话'));assert.ok(row);row.click();await settle();assert.match(document.querySelector('.cv-thread').textContent,/仍然可以查看/);relayInput('.cv-input','不要变成普通提问');await settle();assert.equal(document.querySelector('.cv-send').disabled,true);assert.match(document.querySelector('.qag-composer-quote').textContent,/当前不可用/);assert.equal(f.calls.some(c=>c.url==='/api/chat/completions'),false);document.querySelector('[aria-label="退出应用"]').click();await settle();assert.equal(document.querySelector('.cv-app'),null);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});
test('应用对话：资料变化后停止重试，刷新只读不自动重发',async()=>{
 const data=creatorChatData();data['/api/apps/qg-role-1'].defaultModel='qa-model';const f=await mount({loggedIn:true,initialPath:'/chat?app=qg-role-1',intercept:creatorInterceptor(call=>call.method==='POST'&&call.url==='/api/chat/completions'?relayJson('应用设定已变化，请重新打开并核对',409):null,data)});try{await settle();relayInput('.cv-input','版本变化的问题');await settle();document.querySelector('.cv-send').click();await settle();relayInput('.cv-input','下一次提问');await settle();assert.equal(document.querySelector('.cv-send').disabled,true);assert.match(document.querySelector('.qag-composer-quote').textContent,/应用设定已变化/);data['/api/apps/qg-role-1'].version=9;videoClick('刷新应用资料');await settle();assert.equal(document.querySelector('.cv-send').disabled,false);assert.equal(f.calls.filter(c=>c.url==='/api/chat/completions').length,1);assert.match(document.querySelector('.qag-composer-quote').textContent,/第 9 版/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

function creatorChatData(){const data=appStudioFixtures();data['/api/models/available']=[{id:'model-a',name:'qa-model',displayName:'测试模型',capabilities:['chat'],ready:true},{id:'model-b',name:'qa-second',displayName:'第二模型',capabilities:['chat'],ready:true}];return data;}

test('应用审核：奖励变化后刷新当前档案，保留反馈并使用新的奖励版本',async()=>{
 const data=appStudioFixtures('review-ready','test-user');const f=await mount({loggedIn:true,admin:true,initialPath:'/apps/manage',intercept:creatorInterceptor(call=>call.method==='POST'?relayJson({...data['/api/apps/admin/review/qg-role-2'],reviewStatus:'APPROVED',version:4}):null,data)});
 try{document.querySelector('.qar-row').click();await settle();relayInput('[aria-label="应用审核反馈"]','这份反馈尚未提交');await settle();assert.equal(window.dispatchEvent(new Event('beforeunload',{cancelable:true})),false);data['/api/apps/admin/review/qg-role-2'].rewardOffer={counts:{model3:7},revision:'b'.repeat(64),alreadyGranted:false};videoClick('刷新 ↻');await settle();assert.equal(document.querySelector('[aria-label="应用审核反馈"]').value,'这份反馈尚未提交');assert.match(document.querySelector('.qar-reward').textContent,/7 基础次数/);videoClick('让它进入广场 ↗');await settle();videoClick('确认这次决定 ↗');await settle();assert.equal(studioWrites(f)[0].body.offerRevision,'b'.repeat(64));assert.equal(studioWrites(f)[0].body.note,'这份反馈尚未提交');assert.equal(window.dispatchEvent(new Event('beforeunload',{cancelable:true})),true);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

function voiceLibraryInterceptor(extra,data=voiceLibraryFixtures()){
 return async call=>{const result=await extra?.(call,data);if(result)return result;const url=new URL(call.url,'http://qgauss.test');if(call.method==='GET'&&url.pathname.startsWith('/api/voice/tasks/qg-library-voice-')&&url.pathname.includes('/audio/'))return new Response(new Uint8Array(100),{headers:{'Content-Type':'audio/mpeg'}});if(call.method==='GET'&&Object.hasOwn(data,url.pathname))return relayJson(url.pathname==='/api/voice/library'?voiceLibraryPage(data[url.pathname],url):data[url.pathname]);};
}
async function mountVoiceLibrary(extra,options={}){
 const oldPlay=dom.window.HTMLMediaElement.prototype.play;dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
 const data=options.data||voiceLibraryFixtures(),f=await mount({loggedIn:true,initialPath:'/voice',...options,intercept:voiceLibraryInterceptor(extra,data)}),close=f.close;f.data=data;f.close=async()=>{await close();dom.window.HTMLMediaElement.prototype.play=oldPlay;};return f;
}
const voiceWrites=f=>f.calls.filter(call=>call.method!=='GET'&&call.url.includes('/voice/'));
const voiceOpen=async(index=0)=>{document.querySelectorAll('.qvl-card-open')[index].click();await settle();};

test('声音收藏室：打开只读，个人记录与保存规则完整展示，尚未选择不读取音频',async()=>{
 const f=await mountVoiceLibrary();try{assert.equal(document.querySelectorAll('.qvl-card').length,9);assert.match(document.querySelector('.qvl-policy').textContent,/7 天/);assert.equal(voiceWrites(f).length,0);assert.equal(f.calls.some(call=>call.url.includes('/audio/')),false);assert.ok([...document.querySelectorAll('a')].some(a=>a.getAttribute('href')==='/chat?voice=record'));assert.equal(document.querySelector('.qgc-page-title').textContent,'声音收藏室');await voiceOpen();assert.match(document.querySelector('.qvl-detail').textContent,/第 1 \/ 2 段/);assert.equal(document.activeElement,document.querySelector('.qvl-detail h2'));assert.equal(f.calls.some(call=>call.url.includes('/audio/')),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：搜索、类型、状态和分页只查询当前账户的历史，不发起生成',async()=>{
 const f=await mountVoiceLibrary();try{videoClick('下一页 →');await settle();assert.equal(document.querySelectorAll('.qvl-card').length,1);assert.match(f.calls.at(-1).url,/page=2/);videoClick('说过的好想法');await settle();assert.equal(document.querySelectorAll('.qvl-card').length,3);relayInput('[aria-label="搜索声音记录"]','小小的计划');document.querySelector('.qvl-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(document.querySelectorAll('.qvl-card').length,1);filmSelect('[aria-label="筛选声音状态"]','expired');await settle();assert.match(document.querySelector('.qvl-empty').textContent,/换个词/);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：点击重播只读取音频，暂停与刷新保留同一播放器，不产生新费用',async()=>{
 const f=await mountVoiceLibrary();try{await voiceOpen();videoClick('▶');await settle();assert.equal(f.calls.filter(call=>call.url.includes('/audio/')).length,1);assert.equal(voiceWrites(f).length,0);const audio=document.querySelector('.qvl-detail audio'),url=audio.getAttribute('src');assert.ok(url.startsWith('blob:'));assert.ok(document.querySelector('[aria-label="暂停这段声音"]'));videoClick('刷新记录');await settle();assert.equal(document.querySelector('.qvl-detail audio'),audio);assert.equal(audio.getAttribute('src'),url);document.querySelector('[aria-label="暂停这段声音"]').click();await settle();document.querySelector('[aria-label="播放这段声音"]').click();await settle();assert.equal(f.calls.filter(call=>call.url.includes('/audio/')).length,1);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：上一段、下一段与进度条操作同一份已保存结果',async()=>{
 const f=await mountVoiceLibrary();try{await voiceOpen();document.querySelector('[aria-label="下一段声音"]').click();await settle();assert.ok(f.calls.some(call=>call.url==='/api/voice/tasks/qg-library-voice-0/audio/1'));assert.match(document.querySelector('.qvl-player').textContent,/第 2 \/ 2 段/);const audio=document.querySelector('.qvl-detail audio');Object.defineProperty(audio,'duration',{value:8,configurable:true});audio.dispatchEvent(new Event('loadedmetadata'));await settle();const progress=document.querySelector('[aria-label="声音播放进度"]');progress.value='3.2';progress.dispatchEvent(new Event('input',{bubbles:true}));assert.equal(audio.currentTime,3.2);document.querySelector('[aria-label="上一段声音"]').click();await settle();assert.ok(f.calls.some(call=>call.url==='/api/voice/tasks/qg-library-voice-0/audio/0'));assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：选中其他记录和账户退出会中止迟到音频，不留下旧账户内容',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),f=await mountVoiceLibrary(async call=>{if(call.url==='/api/voice/tasks/qg-library-voice-0/audio/0'){await held;return new Response(new Uint8Array(100),{headers:{'Content-Type':'audio/mpeg'}});}});
 try{await voiceOpen();document.querySelector('[aria-label="播放这段声音"]').click();await settle();const audioCall=f.calls.find(call=>call.url.includes('/audio/'));await voiceOpen(1);assert.equal(audioCall.signal.aborted,true);release();await settle();assert.equal(document.querySelector('.qvl-detail audio').getAttribute('src'),null);assert.match(document.querySelector('.qvl-detail h2').textContent,/关于下一次发布/);f.auth.clearLocal();await settle();assert.equal(document.querySelector('.qvl-transcript'),null);assert.equal(document.querySelectorAll('.qvl-card').length,0);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});
test('声音收藏室：已到期的声音只显示回执，无法播放或把内容带入对话',async()=>{
 const f=await mountVoiceLibrary();try{filmSelect('[aria-label="筛选声音状态"]','expired');await settle();await voiceOpen();assert.match(document.querySelector('.qvl-detail').textContent,/保留期限已过/);assert.match(document.querySelector('.qvl-receipt').textContent,/已结算 2 次/);assert.equal(document.querySelector('[aria-label="播放这段声音"]'),null);assert.equal(document.querySelector('.qvl-transcript'),null);assert.equal(f.calls.some(call=>call.url.includes('/audio/')),false);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：清理必须确认，取消不发请求；确认后保留结果提示与焦点',async()=>{
 const removed=new Set(),f=await mountVoiceLibrary((call,data)=>{const id=call.url.match(/^\/api\/voice\/library\/(qg-library-voice-\d+)$/)?.[1];if(call.method==='DELETE'){removed.add(id);data['/api/voice/library'].items=data['/api/voice/library'].items.filter(row=>row.id!==id);return relayJson({removed:true,cleanup:'background'});}if(id&&removed.has(id))return relayJson('已清理',404);});
 try{await voiceOpen();videoClick('清理这条记录');await settle();assert.match(document.querySelector('#qvl-remove-title').closest('dialog').textContent,/不能撤销/);assert.equal(voiceWrites(f).length,0);videoClick('再留一会儿');await settle();assert.equal(voiceWrites(f).length,0);videoClick('清理这条记录');await settle();videoClick('确认清理这条记录');await settle();assert.equal(voiceWrites(f).length,1);assert.equal(voiceWrites(f)[0].method,'DELETE');assert.equal(voiceWrites(f)[0].url,'/api/voice/library/qg-library-voice-0');assert.equal(sessionStorage.getItem('qg:voice-remove:test-user'),null);assert.match(document.querySelector('.qvl-notice').textContent,/后台清理/);assert.equal(document.activeElement,document.querySelector('#qvl-library-title'));assert.equal(document.querySelector('.qvl-detail h2'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：清理结果丢失时先查询原记录，确认已移除后不重复清理',async()=>{
 let removed=false;const f=await mountVoiceLibrary((call,data)=>{if(call.method==='DELETE'){removed=true;data['/api/voice/library'].items=data['/api/voice/library'].items.filter(row=>row.id!=='qg-library-voice-0');return Promise.reject(Error('连接中断'));}if(removed&&call.url==='/api/voice/library/qg-library-voice-0')return relayJson('已清理',404);});
 try{await voiceOpen();videoClick('清理这条记录');await settle();videoClick('确认清理这条记录');await settle();assert.equal(sessionStorage.getItem('qg:voice-remove:test-user'),'qg-library-voice-0');assert.equal(JSON.stringify({...sessionStorage}).includes('好点子'),false);videoClick('核对原清理结果 ↗');await settle();assert.equal(voiceWrites(f).length,1);assert.equal(sessionStorage.getItem('qg:voice-remove:test-user'),null);assert.match(document.querySelector('.qvl-notice').textContent,/没有重复生成/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：清理尚未发生时只重新确认同一条记录，不自动重发',async()=>{
 let count=0;const f=await mountVoiceLibrary(call=>{if(call.method==='DELETE')return ++count===1?Promise.reject(Error('尚未确认')):relayJson({removed:true});});try{await voiceOpen();videoClick('清理这条记录');await settle();videoClick('确认清理这条记录');await settle();videoClick('核对原清理结果 ↗');await settle();assert.equal(voiceWrites(f).length,1);assert.equal(document.querySelector('#qvl-remove-title').closest('dialog').open,true);videoClick('再留一会儿');await settle();assert.equal(voiceWrites(f).length,1);videoClick('核对原清理结果 ↗');await settle();videoClick('确认清理这条记录');await settle();assert.equal(voiceWrites(f).length,2);assert.equal(voiceWrites(f)[0].url,voiceWrites(f)[1].url);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：重开页面保留清理编号，不自动再次删除或生成',async()=>{
 const f=await mountVoiceLibrary(null,{storedVoiceRemoval:'qg-library-voice-0'});try{assert.ok(document.querySelector('.qvl-recovery'));assert.equal(voiceWrites(f).length,0);assert.equal(sessionStorage.getItem('qg:voice-remove:test-user'),'qg-library-voice-0');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：进行中任务先确认停止，已保存结算时不提供停止按钮',async()=>{
 const data=voiceLibraryFixtures(),id='qg-library-voice-8';const f=await mountVoiceLibrary(call=>{if(call.method==='POST'&&call.url==='/api/voice/tasks/'+id+'/cancel'){Object.assign(data['/api/voice/library/'+id],{status:'CANCELED',availability:'unavailable',billing:{state:'RELEASED',pool:'model3',limit:2,reserved:0,charged:0,returned:2,expired:0}});return relayJson({id,status:'CANCELED'});}}, {data});
 try{await voiceOpen(8);videoClick('停止这次生成');await settle();assert.equal(voiceWrites(f).length,0);videoClick('确认停止这次生成');await settle();assert.equal(voiceWrites(f).length,1);assert.equal(voiceWrites(f)[0].url,'/api/voice/tasks/'+id+'/cancel');assert.match(document.querySelector('.qvl-receipt').textContent,/已退回 2 次/);assert.equal(sessionStorage.getItem('qg:voice-stop:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：停止结果未知时只读取原任务，完成后不再次取消或退还',async()=>{
 const data=voiceLibraryFixtures(),id='qg-library-voice-8';const f=await mountVoiceLibrary(call=>{if(call.method==='POST'&&call.url.endsWith('/cancel')){Object.assign(data['/api/voice/library/'+id],{status:'CANCELED',availability:'unavailable',billing:{state:'RELEASED',pool:'model3',limit:2,reserved:0,charged:0,returned:2,expired:0}});return Promise.reject(Error('未收到停止回执'));}},{data});try{await voiceOpen(8);videoClick('停止这次生成');await settle();videoClick('确认停止这次生成');await settle();assert.equal(sessionStorage.getItem('qg:voice-stop:test-user'),id);videoClick('核对原停止结果 ↻');await settle();assert.equal(voiceWrites(f).length,1);assert.equal(sessionStorage.getItem('qg:voice-stop:test-user'),null);assert.match(document.querySelector('.qvl-notice').textContent,/没有再次退款/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音收藏室：读取失败不宣称免费或永久保存，资料不完整时保持错误与重试入口',async()=>{
 let bad=true;const f=await mountVoiceLibrary(call=>call.url.startsWith('/api/voice/library?')&&bad?relayJson('保存规则暂未读到',503):call.url==='/api/voice/library/qg-library-voice-0'?relayJson({id:'qg-library-voice-0',kind:'speech',availability:'ready'}):null);try{assert.match(document.querySelector('.qvl-policy').textContent,/规则待核对/);assert.equal(document.querySelector('.qvl-policy').textContent.includes('保留至主动清理'),false);bad=false;videoClick('再取一次 ↻');await settle();await voiceOpen();assert.match(document.querySelector('.qvl-error').textContent,/资料不完整/);assert.equal(document.querySelector('[aria-label="播放这段声音"]'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音历史入口：把转写带入对话仅填入文字，不自动发送或生成',async()=>{
 const f=await mountVoiceLibrary();try{await voiceOpen(1);const text=document.querySelector('[aria-label="历史转写文字"]').value;videoClick('带去对话 ↗');await settle();await settle();assert.equal(f.router.currentRoute.value.path,'/chat');assert.equal(f.router.currentRoute.value.query.voiceTask,'qg-library-voice-1');assert.equal(document.querySelector('.cv-input').value,text);assert.equal(document.activeElement,document.querySelector('.cv-input'));assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'),false);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音历史入口：原对话在同页打开原模型和历史，未完成回复只续接一次',async()=>{
 const data=voiceLibraryFixtures();data['/api/voice/library/qg-library-voice-0'].conversationId='c2';const f=await mountVoiceLibrary(null,{data});try{await voiceOpen();const link=document.querySelector('.qvl-conversation-link');assert.equal(link.getAttribute('href'),'/chat?conversation=c2');link.click();await settle();await settle();assert.equal(f.router.currentRoute.value.query.conversation,'c2');assert.match(document.querySelector('.cv-thread').textContent,/测试回答/);assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('声音历史入口：等待转写时锁住发送，换到另一个入口后忽略迟到文字',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),data=voiceLibraryFixtures();const f=await mount({loggedIn:true,initialPath:'/chat?voiceTask=qg-library-voice-1',intercept:voiceLibraryInterceptor(async call=>{if(call.url==='/api/voice/library/qg-library-voice-1'){await held;return relayJson(data[call.url]);}},data)});try{assert.equal(document.querySelector('.cv-input').disabled,true);await f.router.push('/chat?voiceTask=qg-library-voice-4');await settle();const expected=data['/api/voice/library/qg-library-voice-4'].transcript;release();await settle();assert.equal(document.querySelector('.cv-input').value,expected);assert.equal(document.querySelector('.cv-input').disabled,false);assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});
test('声音历史入口：过期转写与重复参数明确失败，开始普通对话后才恢复发送',async()=>{
 for(const path of ['/chat?voiceTask=qg-library-voice-9','/chat?voiceTask=x&voiceTask=y']){const f=await mount({loggedIn:true,initialPath:path,intercept:voiceLibraryInterceptor()});try{await settle();assert.match(document.querySelector('.qag-composer-quote').textContent,/不完整|转写|期限/);relayInput('.cv-input','不能错误回落成普通提问');await settle();assert.equal(document.querySelector('.cv-send').disabled,true);videoClick('开始普通对话');await settle();relayInput('.cv-input','明确开始的新问题');await settle();assert.equal(document.querySelector('.cv-send').disabled,false);assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
});
test('声音历史入口：打开录音或声音偏好只显示面板，不申请麦克风或试听生成',async()=>{
 const data=voiceFixtures();for(const tab of ['record','voices']){const f=await mount({loggedIn:true,initialPath:'/chat?voice='+tab,intercept:voiceLibraryInterceptor(call=>call.url==='/api/voice/options'?relayJson(data[call.url]):null)});try{await settle();assert.ok(document.querySelector('.qvoice-dialog'));assert.equal(voiceWrites(f).length,0);assert.equal(document.body.textContent.includes('等待麦克风许可'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
});
test('声音历史入口：初始资料迟到不能覆盖用户已经选中的历史对话',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),data=creatorChatData();data['/api/apps/qg-role-1'].defaultModel='qa-model';const f=await mount({loggedIn:true,initialPath:'/chat?app=qg-role-1',intercept:creatorInterceptor(async call=>{if(call.url==='/api/apps/qg-role-1'){await held;return relayJson(data[call.url]);}},data)});try{assert.equal(document.querySelector('.cv-input').disabled,false);const ordinary=[...document.querySelectorAll('.qgc-history-tabs button')].find(button=>button.textContent==='AI对话');ordinary.click();await settle();document.querySelector('.cv-conv').click();await settle();release();await settle();assert.match(document.querySelector('.cv-thread').textContent,/测试回答/);assert.equal(document.querySelector('.cv-app'),null);assert.equal(f.calls.some(call=>call.url==='/api/chat/completions'),false);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});

function galleryInterceptor(custom,data=galleryFixtures()){
 return async call=>{const override=await custom?.(call,data);if(override)return override;
  const url=new URL(call.url,'http://qgauss.test');if(url.pathname==='/api/gallery/works'&&call.method==='GET')return relayJson(galleryPage(data[url.pathname],url.search));
  if(call.method==='PUT'&&url.pathname.endsWith('/favorite')){const parts=url.pathname.split('/'),value=galleryFavorite(data,parts[4]+':'+parts[5],call.body.favorite);return value?relayJson(value):new Response(JSON.stringify({code:404,message:'作品不可用'}),{status:404,headers:{'Content-Type':'application/json'}});}
  if(Object.hasOwn(data,url.pathname)){const value=data[url.pathname];return typeof value==='string'?new Response(value,{headers:{'Content-Type':'image/svg+xml'}}):relayJson(value);}return null;
 };
}
async function mountGallery(custom,options={}){
 const prototype=window.HTMLMediaElement.prototype,original={play:prototype.play,pause:prototype.pause,load:prototype.load};prototype.play=()=>Promise.resolve();prototype.pause=prototype.load=()=>{};
 try{const f=await mount({loggedIn:true,initialPath:'/market',...options,intercept:galleryInterceptor(custom,options.data)}),close=f.close;f.close=async()=>{try{await close();}finally{Object.assign(prototype,original);}};await settle();return f;}catch(error){Object.assign(prototype,original);throw error;}
}
const galleryWrites=f=>f.calls.filter(call=>call.url.startsWith('/api/gallery/')&&call.method!=='GET');
async function galleryOpen(index=0){const title=galleryFixtures()['/api/gallery/works'].items[index].title;const button=document.querySelector('[aria-label="查看公开作品：'+title+'"]');assert.ok(button);button.click();await settle();await settle();}

test('作品公开确认：先展示公开范围，明确选择分类后才提交带版本的目标状态',async()=>{
 const work=paintingTask('publication',{updatedAt:'2026-11-03T00:00:00.000Z'}),f=await mountPainting({items:[work],intercept:call=>{if(call.method==='PATCH'&&call.url.endsWith('/publish')){Object.assign(work,{...call.body,catId:call.body.catId??work.catId,publishedAt:'2026-11-03T01:00:00.000Z',updatedAt:'2026-11-03T01:00:00.000Z'});return paintResponse(work);}}});
 try{document.querySelector('.qp-image-button').click();await settle();paintClick('.qp-owner-actions button','发布到灵感广场');await settle();assert.equal(f.calls.filter(call=>call.method==='PATCH').length,0);assert.match(document.querySelector('.qga-publication').textContent,/私有参考素材/);filmSelect('[aria-label="公开作品分类"]','');videoClick('确认公开');await settle();const call=f.calls.find(call=>call.method==='PATCH'&&call.url.endsWith('/publish'));assert.deepEqual(call.body,{published:true,catId:'',expectedUpdatedAt:'2026-11-03T00:00:00.000Z'});assert.match(document.querySelector('.qga-publication').textContent,/作品已公开/);assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('作品公开确认：回执丢失只读取原状态，不能自动重复公开',async()=>{
 const work=paintingTask('publication-lost',{updatedAt:'2026-11-03T00:00:00.000Z'}),f=await mountPainting({items:[work],intercept:call=>{if(call.method==='PATCH'&&call.url.endsWith('/publish')){work.published=true;work.updatedAt='2026-11-03T01:00:00.000Z';return new Response(JSON.stringify({message:'回执暂未到达'}),{status:503,headers:{'Content-Type':'application/json'}});}}});
 try{document.querySelector('.qp-image-button').click();await settle();paintClick('.qp-owner-actions button','发布到灵感广场');await settle();videoClick('确认公开');await settle();assert.match(document.querySelector('.qga-publication').textContent,/不会自动重发/);videoClick('核对公开状态');await settle();assert.equal(f.calls.filter(call=>call.method==='PATCH').length,1);assert.match(document.querySelector('.qga-publication').textContent,/目前作品已公开/);assert.equal(sessionStorage.getItem('qg:publication:test-user:image:publication-lost'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('作品公开确认：结果未知时可以明确撤回，不根据旧画面翻转目标',async()=>{
 const work=paintingTask('publication-stop',{updatedAt:'2026-11-03T00:00:00.000Z'}),f=await mountPainting({items:[work],intercept:call=>{if(call.method==='PATCH'&&call.url.endsWith('/publish'))return call.body.published?new Response('{}',{status:503}):paintResponse({...work,published:false,updatedAt:'2026-11-03T01:00:00.000Z'});}});
 try{document.querySelector('.qp-image-button').click();await settle();paintClick('.qp-owner-actions button','发布到灵感广场');await settle();videoClick('确认公开');await settle();videoClick('明确设为不公开');await settle();assert.deepEqual(f.calls.filter(call=>call.method==='PATCH').map(call=>call.body.published),[true,false]);assert.match(document.querySelector('.qga-publication').textContent,/早先的公开确认不会覆盖/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场推荐：只向当前管理账户展示，未知回执先读取再明确重试',async()=>{
 const f=await mountGallery((call,data)=>{if(call.method==='PUT'&&call.url.endsWith('/feature')){data['/api/gallery/works/image/qg-gallery-0'].featured=call.body.featured;return new Response('{}',{status:503});}},{admin:true});
 try{await galleryOpen();assert.ok(document.querySelector('.qga-curation'));videoClick('取消推荐');await settle();assert.equal(galleryWrites(f).length,1);videoClick('核对推荐状态');await settle();assert.equal(galleryWrites(f).length,1);assert.match(document.querySelector('.qga-curation').textContent,/已找回推荐结果/);assert.equal(document.querySelector('.qga-card-featured'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 const viewer=await mountGallery();try{await galleryOpen();assert.equal(document.querySelector('.qga-curation'),null);assert.equal(galleryWrites(viewer).length,0);}finally{await viewer.close();}
});

test('创意作品广场：合并作品类型并加载真实组件，浏览不触发生成或收藏',async()=>{
 const f=await mountGallery();try{assert.match(document.querySelector('.qga-hero h1').textContent,/想象力/);assert.equal(document.querySelectorAll('.qga-card').length,18);assert.match(document.querySelector('.qga-result-note').textContent,/22/);assert.equal(galleryWrites(f).length,0);assert.equal(f.calls.some(call=>/\/quote$|\/completions$/.test(call.url)),false);assert.equal(document.querySelector('video'),null);assert.ok(f.calls.some(call=>call.url.includes('/assets/0')));assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场：分页、类型、分类、搜索与清空使用同一组筛选，分页不会沿用旧页码',async()=>{
 const f=await mountGallery();try{videoClick('再遇见一些 →');await settle();assert.equal(document.querySelectorAll('.qga-card').length,4);videoClick('MJ 灵感7');await settle();assert.equal(document.querySelectorAll('.qga-card').length,7);const last=()=>new URL(f.calls.filter(call=>call.url.startsWith('/api/gallery/works?')).at(-1).url,'http://qgauss.test');assert.equal(last().searchParams.get('page'),'1');assert.equal(last().searchParams.get('kind'),'mj');videoClick('光与材质');await settle();assert.equal(last().searchParams.get('catId'),'qg-cat-light');relayInput('[aria-label="搜索公开作品"]','没有出现的画面');document.querySelector('.qga-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();assert.match(document.querySelector('.qga-empty').textContent,/换个方向/);videoClick('看看全部作品');await settle();assert.equal(document.querySelectorAll('.qga-card').length,18);assert.equal(galleryWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场：详情对应原卡片、可切换多张画面，关闭清理入口并恢复焦点',async()=>{
 const f=await mountGallery();try{const trigger=document.querySelector('.qga-card-open');await galleryOpen();assert.equal(f.router.currentRoute.value.query.work,'image:qg-gallery-0');assert.equal(document.querySelector('.qga-inspector h2').textContent,galleryFixtures()['/api/gallery/works'].items[0].title);assert.equal(document.activeElement,document.querySelector('.qga-inspector h2'));document.querySelector('[aria-label="下一个作品画面"]').click();await settle();assert.match(document.querySelector('.qga-carousel').textContent,/2 \/ 2/);document.querySelector('[aria-label="关闭作品详情"]').click();await settle();assert.equal(document.querySelector('.qga-dialog').open,false);assert.equal(f.router.currentRoute.value.query.work,undefined);assert.equal(document.activeElement,trigger);assert.equal(galleryWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场：收藏使用明确目标值并同步数量，不能把点击变成生成任务',async()=>{
 const f=await mountGallery();try{let button=document.querySelector('.qga-card-heart');assert.equal(button.getAttribute('aria-pressed'),'true');button.click();await settle();await settle();const write=galleryWrites(f)[0];assert.deepEqual(write.body,{favorite:false});assert.equal(write.url,'/api/gallery/works/image/qg-gallery-0/favorite');button=document.querySelector('.qga-card-heart');assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(button.textContent,'2');button.click();await settle();await settle();assert.deepEqual(galleryWrites(f)[1].body,{favorite:true});assert.equal(document.querySelector('.qga-card-heart').textContent,'3');assert.equal(f.calls.some(call=>call.url.endsWith('/quote')),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场：收藏已执行但回执丢失时先读取原结果，核对不重复提交',async()=>{
 let lost=true;const f=await mountGallery((call,data)=>{if(call.method==='PUT'&&lost){lost=false;galleryFavorite(data,'image:qg-gallery-0',call.body.favorite);return new Response(JSON.stringify({code:503,message:'收藏回执暂未返回'}),{status:503,headers:{'Content-Type':'application/json'}});}});try{document.querySelector('.qga-card-heart').click();await settle();assert.ok(document.querySelector('.qga-recovery'));assert.deepEqual(JSON.parse(sessionStorage.getItem('qg:gallery-favorite:test-user')),{key:'image:qg-gallery-0',favorite:false});videoClick('核对原结果');await settle();await settle();assert.equal(document.querySelector('.qga-recovery'),null);assert.equal(galleryWrites(f).length,1);assert.equal(sessionStorage.getItem('qg:gallery-favorite:test-user'),null);assert.equal(document.querySelector('.qga-card-heart').getAttribute('aria-pressed'),'false');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场：换选作品后忽略迟到详情，缺失与重复入口不偷偷换成其他作品',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),data=galleryFixtures();const f=await mountGallery(async call=>{if(call.url==='/api/gallery/works/image/qg-gallery-0'){await held;return relayJson(data[call.url]);}},{data});try{document.querySelector('.qga-card-open').click();await settle();const key='mj:qg-gallery-1';await f.router.push('/market?work='+encodeURIComponent(key));await settle();release();await settle();assert.equal(document.querySelector('.qga-inspector h2').textContent,data['/api/gallery/works/mj/qg-gallery-1'].title);await f.router.push('/market?work=x&work=y');await settle();assert.match(document.querySelector('.qga-dialog').textContent,/入口不完整/);assert.equal(document.querySelector('.qga-inspector'),null);assert.equal(galleryWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});
test('创意作品广场：播放只取得原视频凭证，关闭详情立即停止并移除播放器',async()=>{
 const f=await mountGallery();try{await galleryOpen(2);assert.equal(document.querySelector('video'),null);document.querySelector('[aria-label="播放公开作品"]').click();await settle();const player=document.querySelector('video');assert.ok(player);assert.match(player.getAttribute('src'),/^\/api\/video\/media\/qg-gallery-2\/video\?ticket=/);assert.equal(f.calls.filter(call=>call.url==='/api/gallery/works/video/qg-gallery-2/playback?index=0').length,1);document.querySelector('[aria-label="关闭作品详情"]').click();await settle();assert.equal(document.querySelector('video'),null);assert.equal(galleryWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场：空列表与读取失败有明确出路，不伪造作品或写入收藏',async()=>{
 for(const mode of ['empty','error']){const f=await mountGallery(mode==='error'?call=>call.url.startsWith('/api/gallery/works?')?new Response(JSON.stringify({code:503,message:'作品服务暂时不可用'}),{status:503,headers:{'Content-Type':'application/json'}}):null:null,{data:galleryFixtures(mode==='empty'?'gallery-empty':'gallery-ready')});try{assert.equal(document.querySelectorAll('.qga-card').length,0);assert.match(document.querySelector('.qga-empty').textContent,mode==='empty'?/第一份公开灵感/:/暂时还没抵达/);assert.equal(galleryWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
});

test('创意作品广场衔接：三类作品只带入各自工作台的公开设定，不自动报价或生成',async()=>{
 const data=galleryFixtures();for(const [kind,index,path] of [['image',0,'/painting'],['mj',1,'/mj'],['video',2,'/video']]){const row=data['/api/gallery/works'].items[index],f=await mountGallery(null,{data,initialPath:path+'?gallery='+encodeURIComponent(row.key)});try{await settle();assert.equal(document.querySelector('textarea').value,row.prompt);assert.match(document.querySelector('.qge-entry').textContent,/已带入/);assert.equal(f.calls.filter(call=>call.url==='/api/gallery/works/'+kind+'/'+row.id+'/reuse').length,1);assert.equal(f.calls.some(call=>call.method==='POST'&&/\/tasks$|\/quote$/.test(call.url)),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
});
test('创意作品广场衔接：等待设定时保留用户新输入，替换草稿需要明确选择并重新核对作品',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),data=galleryFixtures();const f=await mountGallery(async call=>{if(call.url==='/api/gallery/works/image/qg-gallery-0/reuse'){await held;return relayJson(data[call.url]);}},{data,initialPath:'/painting?gallery=image:qg-gallery-0'});try{assert.equal(document.querySelector('.qp-generate').disabled,true);relayInput('textarea','刚写下的个人想法');release();await settle();await settle();assert.equal(document.querySelector('textarea').value,'刚写下的个人想法');assert.match(document.querySelector('.qge-entry').textContent,/尚未提交/);videoClick('用作品设定替换当前草稿');await settle();await settle();assert.equal(document.querySelector('textarea').value,data['/api/gallery/works/image/qg-gallery-0/reuse'].draft.prompt);assert.equal(f.calls.filter(call=>call.url.endsWith('/reuse')).length,2);assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.deepEqual(f.errors,[]);}finally{release();await f.close();}
});
test('创意作品广场衔接：已撤回的作品不回落到空白生成，明确放弃带入后保留自己的草稿',async()=>{
 const f=await mountGallery(call=>call.url.endsWith('/reuse')?new Response(JSON.stringify({code:404,message:'作品已撤回'}),{status:404,headers:{'Content-Type':'application/json'}}):null,{initialPath:'/painting?gallery=image:qg-gallery-0'});try{assert.match(document.querySelector('.qge-entry').textContent,/已撤回/);relayInput('textarea','仍然留在这里的草稿');assert.equal(document.querySelector('.qp-generate').disabled,true);videoClick('保留当前草稿，暂不带入');await settle();assert.equal(document.querySelector('textarea').value,'仍然留在这里的草稿');assert.equal(document.querySelector('.qge-entry'),null);assert.equal(f.router.currentRoute.value.query.gallery,undefined);assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('创意作品广场衔接：原画面设置不再受支持时不悄悄替换比例，也不能直接发起生成',async()=>{
 const data=galleryFixtures();data['/api/gallery/works/image/qg-gallery-0/reuse'].draft.ratio='21:9';data['/api/image/options'].models[0].features.ratios=['1:1'];const f=await mountGallery(null,{data,initialPath:'/painting?gallery=image:qg-gallery-0'});try{await settle();const original=document.querySelector('[aria-label="选择比例 21:9"]');assert.equal(original.getAttribute('aria-pressed'),'true');assert.equal(original.disabled,true);document.querySelector('.qp-generate').click();await settle();assert.equal(f.calls.some(call=>call.method==='POST'&&call.url==='/api/image/tasks'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

async function mindmapInput(selector,value){relayInput(selector,value);await settle();}
function mindmapInterceptor(data,extra){return async call=>{const result=await extra?.(call,data);if(result)return result;const answer=mindmapFixtureReply(data,new URL(call.url,'http://qgauss.test'),call.method,call.body||{});if(!answer)return null;return new Response(JSON.stringify(answer.error?{code:answer.status,message:answer.error}:{code:0,data:answer.data}),{status:answer.status,headers:{'Content-Type':'application/json'}});};}
async function mindmapWait(check){for(let n=0;n<100;n++){await settle();if(check())return;}assert.fail('Mindmap state did not become ready');}
async function mountMindmap({state='mindmap-ready',path='/mindmap?doc=qg-map-1',extra,...options}={}){const data=mindmapFixtures(state),f=await mount({loggedIn:true,initialPath:path,...options,intercept:mindmapInterceptor(data,extra)});f.memory=data;await mindmapWait(()=>document.querySelector('.qgm-page')&&(!path.includes('doc=')||document.querySelector('#qgm-outline')?.value.includes('下一次')));await mindmapWait(()=>!document.querySelector('.qgm-canvas.is-drawing'));return f;}
const mindmapWrites=f=>f.calls.filter(call=>call.url.startsWith('/api/mindmap/')&&call.method!=='GET');
const mindmapClick=text=>{const button=[...document.querySelectorAll('.qgm-page button,.qgm-dialog button')].find(button=>button.textContent.trim().replace(/\s*↗$/,'')===text.replace(/\s*↗$/,''));assert.ok(button,'Missing map action '+text);button.click();};
test('思维导图：读取文档与真实 Vue 编辑器，浏览和绘制不自动写入或生成',async()=>{const f=await mountMindmap();try{assert.equal(document.querySelector('[aria-label="文档名称"]').value,f.memory.documents[0].title);assert.equal(document.querySelector('#qgm-outline').value,f.memory.documents[0].outline);assert.match(document.querySelector('.qgm-map-meta').textContent,/个节点/);assert.equal(document.querySelector('.qgm-save').disabled,true);assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：明确保存才提交原文档版本，保存期间新输入不会被旧回执覆盖',async()=>{let finish;const f=await mountMindmap({extra:(call,data)=>call.url==='/api/mindmap/mutations'&&call.method==='POST'?new Promise(resolve=>{const reply=mindmapFixtureReply(data,new URL(call.url,'http://qgauss.test'),call.method,call.body);finish=()=>resolve(relayJson(reply.data));}):null});try{await mindmapInput('#qgm-outline','# 第一份修改\n- 保留');mindmapClick('保存这份想法');await settle();const call=mindmapWrites(f)[0];assert.equal(call.body.kind,'edit');assert.equal(call.body.documentId,'qg-map-1');assert.equal(call.body.expectedVersion,1);assert.equal(call.body.outline,'# 第一份修改\n- 保留');await mindmapInput('#qgm-outline','# 等回执时继续写的内容');finish();await settle();assert.equal(document.querySelector('#qgm-outline').value,'# 等回执时继续写的内容');assert.equal(document.querySelector('.qgm-save').disabled,false);assert.match(document.querySelector('.qgm-document-state').textContent,/新的修改/);assert.deepEqual(f.errors,[]);}finally{finish?.();await f.close();}});
test('思维导图：保存已执行但回执丢失，核对只读取原结果，不重新保存',async()=>{let lost=true;const f=await mountMindmap({extra:(call,data)=>{if(call.url==='/api/mindmap/mutations'&&call.method==='POST'&&lost){lost=false;mindmapFixtureReply(data,new URL(call.url,'http://qgauss.test'),call.method,call.body);return new Response('{}',{status:503});}}});try{await mindmapInput('#qgm-outline','# 新的线索\n- 没有丢');mindmapClick('保存这份想法');await settle();assert.ok(document.querySelector('.qgm-receipt'));mindmapClick('核对原回执');await settle();assert.equal(mindmapWrites(f).length,1);assert.equal(document.querySelector('.qgm-receipt'),null);assert.equal(document.querySelector('#qgm-outline').value,'# 新的线索\n- 没有丢');assert.equal(document.querySelector('.qgm-save').disabled,true);assert.equal(sessionStorage.getItem('qg:mindmap:mutation:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：等待另一份文档时继续输入，迟到读取必须再次确认才能替换',async()=>{let finish;const f=await mountMindmap({extra:call=>call.url==='/api/mindmap/documents/qg-map-2'?new Promise(resolve=>{finish=resolve;}):null});try{mindmapClick('想法收纳');await settle();const card=[...document.querySelectorAll('.qgm-document-card')].find(card=>card.textContent.includes('把复杂的事'));assert.ok(card);card.click();await settle();await mindmapInput('#qgm-outline','# 我刚刚又想到一点');finish(relayJson(f.memory.documents[1]));await settle();assert.equal(document.querySelector('#qgm-outline').value,'# 我刚刚又想到一点');assert.match(document.querySelector('.qgm-confirm').textContent,/等待期间的修改已保留/);mindmapClick('保留当前内容');await settle();assert.equal(document.querySelector('#qgm-outline').value,'# 我刚刚又想到一点');assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{finish?.(relayJson(f.memory.documents[1]));await f.close();}});
test('思维导图：生成先核对费用，确认只提交一次，结果不自动替换编辑内容',async()=>{const f=await mountMindmap();try{document.querySelector('#qgm-assist-tab').click();await mindmapInput('[aria-label="描述导图需求"]','整理一次真正可执行的学习计划');mindmapClick('先看看这次生成');await settle();assert.equal(mindmapWrites(f).length,1);assert.equal(mindmapWrites(f)[0].url,'/api/mindmap/generations/quote');assert.match(document.querySelector('.qgm-generation-quote').textContent,/2 次/);const before=document.querySelector('#qgm-outline').value;mindmapClick('确认开始生成');await settle();assert.equal(mindmapWrites(f).filter(call=>call.url==='/api/mindmap/generations').length,1);assert.equal(document.querySelector('#qgm-outline').value,before);document.querySelector('[aria-label="同步导图生成状态"]').click();await settle();document.querySelector('[aria-label="同步导图生成状态"]').click();await settle();assert.match(document.querySelector('.qgm-generation').textContent,/新思路/);mindmapClick('把这份思路带入大纲 ↗');await settle();assert.equal(document.querySelector('#qgm-outline').value,before);mindmapClick('确认带入大纲');await settle();assert.equal(document.querySelector('#qgm-outline').value,f.memory.history[0].outline);assert.equal(mindmapWrites(f).some(call=>call.url==='/api/mindmap/mutations'),false);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：报价过程中改写上下文，不显示过期确认，也不自动开始生成',async()=>{let finish;const f=await mountMindmap({extra:call=>call.url==='/api/mindmap/generations/quote'?new Promise(resolve=>{finish=resolve;}):null});try{document.querySelector('#qgm-assist-tab').click();await mindmapInput('[aria-label="描述导图需求"]','一份新计划');mindmapClick('先看看这次生成');await settle();await mindmapInput('#qgm-outline','# 刚刚改过的线索');finish(relayJson({revision:'old-quote',cost:2,modelName:'QGauss'}));await settle();assert.equal(document.querySelector('.qgm-generation-quote').open,false);assert.equal(mindmapWrites(f).filter(call=>call.url==='/api/mindmap/generations').length,0);assert.equal(document.querySelector('#qgm-outline').value,'# 刚刚改过的线索');assert.deepEqual(f.errors,[]);}finally{finish?.(relayJson({revision:'old-quote',cost:2}));await f.close();}});
test('思维导图：生成回执丢失先找回同一任务，不重复提交或丢掉当前大纲',async()=>{let lost=true;const f=await mountMindmap({extra:(call,data)=>{if(call.url==='/api/mindmap/generations'&&call.method==='POST'&&lost){lost=false;mindmapFixtureReply(data,new URL(call.url,'http://qgauss.test'),call.method,call.body);return new Response('{}',{status:503});}}});try{document.querySelector('#qgm-assist-tab').click();await mindmapInput('[aria-label="描述导图需求"]','整理我刚刚的线索');mindmapClick('先看看这次生成');await settle();mindmapClick('确认开始生成');await settle();assert.ok(document.querySelector('.qgm-generation-recovery'));const source=document.querySelector('#qgm-outline').value;mindmapClick('找回原生成');await settle();assert.equal(document.querySelector('.qgm-generation-recovery'),null);assert.equal(mindmapWrites(f).filter(call=>call.url==='/api/mindmap/generations').length,1);assert.equal(document.querySelector('#qgm-outline').value,source);assert.equal(sessionStorage.getItem('qg:mindmap:generation:test-user'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：未接入模型时仍能手写和保存，不创建虚假的生成结果',async()=>{const f=await mountMindmap({state:'mindmap-offline',path:'/mindmap'});try{document.querySelector('#qgm-assist-tab').click();await mindmapInput('[aria-label="描述导图需求"]','现在就开始');const generate=[...document.querySelectorAll('button')].find(button=>button.classList.contains('qgm-generate'));assert.equal(generate.disabled,true);assert.match(document.querySelector('.qgm-assist-panel').textContent,/连接还未准备好/);document.querySelector('#qgm-outline-tab').click();await mindmapInput('[aria-label="文档名称"]','先把自己的想法留下');await mindmapInput('#qgm-outline','# 手写也很好\n- 第一件事');mindmapClick('保存这份想法');await settle();assert.equal(mindmapWrites(f)[0].body.kind,'create');assert.equal(mindmapWrites(f).some(call=>call.url.includes('/generations')),false);assert.equal(f.memory.documents.filter(doc=>doc.title==='先把自己的想法留下').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}});


test('思维导图：空标题保存采用大纲主题，成功后不残留虚假的未保存状态',async()=>{const f=await mountMindmap({path:'/mindmap'});try{await mindmapInput('#qgm-outline','# 自动采用这一主题\n- 线索');mindmapClick('保存这份想法');await settle();assert.equal(document.querySelector('[aria-label="文档名称"]').value,'自动采用这一主题');assert.equal(document.querySelector('.qgm-save').disabled,true);assert.equal(mindmapWrites(f)[0].body.title,'自动采用这一主题');assert.equal('originalFingerprint' in mindmapWrites(f)[0].body,false);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：云端版本冲突保留草稿，只读核对后允许明确另存',async()=>{let conflict=true;const f=await mountMindmap({extra:(call,data)=>{if(call.url==='/api/mindmap/mutations'&&conflict){conflict=false;data.documents[0]={...data.documents[0],version:2,outline:'# 另一处已保存的版本'};return relayJson('文档已有其他修改，请核对后再保存。',409);}}});try{await mindmapInput('#qgm-outline','# 我正在写的内容');mindmapClick('保存这份想法');await settle();assert.equal(document.querySelector('#qgm-outline').value,'# 我正在写的内容');assert.equal(document.querySelector('.qgm-receipt'),null);assert.match(document.querySelector('.qgm-conflict').textContent,/云端文档已有变化/);assert.equal(document.querySelector('.qgm-save').disabled,true);mindmapClick('把当前内容另存为新文档');await settle();mindmapClick('保存这份想法');await settle();assert.equal(mindmapWrites(f).length,2);assert.equal(mindmapWrites(f)[1].body.kind,'create');assert.equal(mindmapWrites(f)[1].body.documentId,null);assert.equal(f.memory.documents.find(row=>row.id==='qg-map-1').outline,'# 另一处已保存的版本');assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：明确拒绝的保存释放待核对状态，错误文字和草稿都保留',async()=>{const f=await mountMindmap({extra:call=>call.url==='/api/mindmap/mutations'?relayJson('当前文档数量已满，请先整理收纳。',400):null});try{await mindmapInput('#qgm-outline','# 尚未保存的一份线索');mindmapClick('保存这份想法');await settle();assert.match(document.querySelector('.qgm-alert').textContent,/数量已满/);assert.equal(document.querySelector('.qgm-receipt'),null);assert.equal(sessionStorage.getItem('qg:mindmap:mutation:test-user'),null);assert.equal(document.querySelector('#qgm-outline').value,'# 尚未保存的一份线索');assert.equal(document.querySelector('.qgm-save').disabled,false);assert.equal(mindmapWrites(f).length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：次数不足不伪装成正在生成，也不留下无法开始的恢复入口',async()=>{const f=await mountMindmap({extra:call=>call.url==='/api/mindmap/generations'&&call.method==='POST'?relayJson('本次可用次数不足，尚未开始生成。',402):null});try{document.querySelector('#qgm-assist-tab').click();await mindmapInput('[aria-label="描述导图需求"]','把线索整理清楚');mindmapClick('先看看这次生成');await settle();mindmapClick('确认开始生成');await settle();assert.match(document.querySelector('.qgm-assist-panel').textContent,/可用次数不足/);assert.equal(document.querySelector('.qgm-generation-recovery'),null);assert.equal(document.querySelector('.qgm-generation'),null);assert.equal(sessionStorage.getItem('qg:mindmap:generation:test-user'),null);assert.equal(mindmapWrites(f).filter(call=>call.url==='/api/mindmap/generations').length,1);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：未知保存明确结束后才允许新操作，迟到的旧标识已被封存',async()=>{let lost=true;const f=await mountMindmap({extra:call=>{if(call.url==='/api/mindmap/mutations'&&lost){lost=false;return relayJson('连接暂未回应',503);}}});try{await mindmapInput('#qgm-outline','# 等待核对的内容');mindmapClick('保存这份想法');await settle();const first=mindmapWrites(f)[0];assert.equal(document.querySelector('.qgm-save').disabled,true);mindmapClick('明确结束等待');await settle();assert.equal(mindmapWrites(f)[1].url,'/api/mindmap/mutations/'+first.body.requestKey+'/end');assert.equal(document.querySelector('.qgm-receipt'),null);assert.equal(document.querySelector('#qgm-outline').value,'# 等待核对的内容');assert.equal(mindmapFixtureReply(f.memory,new URL(first.url,'http://qgauss.test'),'POST',first.body).status,409);mindmapClick('保存这份想法');await settle();assert.notEqual(mindmapWrites(f)[2].body.requestKey,first.body.requestKey);assert.equal(document.querySelector('.qgm-save').disabled,true);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：移入回收先确认，恢复同一文档并保留未保存的文字',async()=>{const f=await mountMindmap();try{await mindmapInput('#qgm-outline','# 我还没有保存的修改');mindmapClick('想法收纳');await settle();document.querySelector('[aria-label="将文档移入回收：下一次，做点不一样的。"] ').click();await settle();assert.equal(mindmapWrites(f).length,0);mindmapClick('确认移入回收');await settle();assert.equal(mindmapWrites(f)[0].body.kind,'archive');assert.equal(document.querySelector('#qgm-outline').value,'# 我还没有保存的修改');assert.equal(document.querySelector('#qgm-outline').disabled,true);document.querySelector('[aria-label="关闭文档收纳"]').click();await settle();mindmapClick('恢复这份文档');await settle();assert.equal(mindmapWrites(f)[1].body.kind,'restore');assert.equal(mindmapWrites(f)[1].body.documentId,'qg-map-1');assert.equal(document.querySelector('#qgm-outline').value,'# 我还没有保存的修改');assert.equal(document.querySelector('#qgm-outline').disabled,false);assert.equal(document.querySelector('.qgm-save').disabled,false);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：账号切换丢弃私有草稿和迟到保存，不把旧编辑带入新会话',async()=>{let finish;const f=await mountMindmap({path:'/mindmap',extra:(call,data)=>call.url==='/api/mindmap/mutations'?new Promise(resolve=>{const value=mindmapFixtureReply(data,new URL(call.url,'http://qgauss.test'),call.method,call.body);finish=()=>resolve(relayJson(value.data));}):null});try{await mindmapInput('#qgm-outline','# 前一个账号的私有草稿');mindmapClick('保存这份想法');await settle();f.auth.apply({accessToken:'next-session',refreshToken:'next-refresh',user:{id:'second-user',username:'另一位用户',role:'USER'}});await settle();finish();await settle();assert.equal(document.querySelector('#qgm-outline').value,'');assert.equal(sessionStorage.getItem('qg:mindmap:draft:test-user'),null);assert.equal(document.querySelector('.qgm-receipt'),null);assert.equal(document.querySelector('.qgm-document-state').textContent,'新想法');assert.equal(mindmapWrites(f).length,1);assert.deepEqual(f.errors,[]);}finally{finish?.();await f.close();}});
test('思维导图：离开工作台保留本标签页草稿，随后退出账号立即清理',async()=>{const f=await mountMindmap({path:'/mindmap'});try{await mindmapInput('#qgm-outline','# 离开前写下的线索');assert.match(sessionStorage.getItem('qg:mindmap:draft:test-user'),/离开前写下/);await f.router.push('/chat');await settle();assert.match(sessionStorage.getItem('qg:mindmap:draft:test-user'),/离开前写下/);f.auth.clearLocal();await settle();assert.equal(sessionStorage.getItem('qg:mindmap:draft:test-user'),null);assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});

test('思维导图：离开后返回带文档入口，恢复本标签草稿并保持可保存',async()=>{const f=await mountMindmap();try{await mindmapInput('#qgm-outline','# 下次回来继续写');await f.router.push('/chat');await settle();await f.router.push('/mindmap?doc=qg-map-1');await mindmapWait(()=>document.querySelector('#qgm-outline')?.value==='# 下次回来继续写'&&!document.querySelector('.qgm-save')?.disabled);assert.equal(document.querySelector('.qgm-confirm').open,false);assert.equal(document.querySelector('.qgm-conflict'),null);assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：键盘可以切换创作页签并把焦点交给所选工具',async()=>{const f=await mountMindmap();try{const outline=document.querySelector('#qgm-outline-tab');outline.focus();outline.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await settle();assert.equal(document.activeElement.id,'qgm-assist-tab');assert.equal(document.querySelector('#qgm-assist-tab').getAttribute('aria-selected'),'true');document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));await settle();assert.equal(document.activeElement.id,'qgm-outline-tab');assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：不可保存的控制字符留在当前页说明原因，不产生后台操作',async()=>{const f=await mountMindmap();try{await mindmapInput('#qgm-outline','# 保留\u0000未确认的文字');mindmapClick('保存这份想法');await settle();assert.match(document.querySelector('.qgm-alert').textContent,/有效的文字大纲/);assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：停止回执丢失后只同步同一任务，不重复停止或重新生成',async()=>{let lost=true;const f=await mountMindmap({extra:(call,data)=>{if(call.url.endsWith('/cancel')&&lost){lost=false;mindmapFixtureReply(data,new URL(call.url,'http://qgauss.test'),call.method,call.body);return relayJson('连接中断',503);}}});try{document.querySelector('#qgm-assist-tab').click();await mindmapInput('[aria-label="描述导图需求"]','整理一份计划');mindmapClick('先看看这次生成');await settle();mindmapClick('确认开始生成');await settle();const source=document.querySelector('#qgm-outline').value;mindmapClick('停止这次等待');await settle();assert.match(document.querySelector('.qgm-generation').textContent,/先核对停止结果/);mindmapClick('先核对停止结果');await settle();assert.match(document.querySelector('.qgm-generation').textContent,/已停止这次等待/);assert.equal(mindmapWrites(f).filter(call=>call.url.endsWith('/cancel')).length,1);assert.equal(mindmapWrites(f).filter(call=>call.url==='/api/mindmap/generations').length,1);assert.equal(document.querySelector('#qgm-outline').value,source);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：未知生成明确结束后封存旧标识，当前编辑没有被替换',async()=>{const f=await mountMindmap({extra:call=>call.url==='/api/mindmap/generations'&&call.method==='POST'?relayJson('结果未确认',503):null});try{document.querySelector('#qgm-assist-tab').click();await mindmapInput('[aria-label="描述导图需求"]','重新整理一次');mindmapClick('先看看这次生成');await settle();mindmapClick('确认开始生成');await settle();const first=mindmapWrites(f).find(call=>call.url==='/api/mindmap/generations'),before=document.querySelector('#qgm-outline').value;mindmapClick('明确结束等待');await settle();assert.equal(document.querySelector('.qgm-generation-recovery'),null);assert.equal(sessionStorage.getItem('qg:mindmap:generation:test-user'),null);assert.equal(document.querySelector('#qgm-outline').value,before);assert.equal(mindmapWrites(f).filter(call=>call.url.endsWith('/end')).length,1);assert.equal(mindmapFixtureReply(f.memory,new URL(first.url,'http://qgauss.test'),'POST',first.body).status,409);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：导入只接受文字文件，替换现有大纲前必须明确选择',async()=>{const f=await mountMindmap();try{const input=document.querySelector('[aria-label="导入大纲文件"]'),before=document.querySelector('#qgm-outline').value;Object.defineProperty(input,'files',{configurable:true,value:[new window.File(['# 不应带入'],'页面.html',{type:'text/html'})]});input.dispatchEvent(new Event('change',{bubbles:true}));await settle();assert.equal(document.querySelector('#qgm-outline').value,before);assert.match(document.querySelector('.qgm-alert').textContent,/文字或 Markdown/);Object.defineProperty(input,'files',{configurable:true,value:[{name:'我的导入.md',size:60,text:async()=>'\uFEFF# 文件里的新想法\r\n- 正文'}]});input.dispatchEvent(new Event('change',{bubbles:true}));await settle();assert.equal(document.querySelector('#qgm-outline').value,before);mindmapClick('替换当前大纲');await settle();assert.equal(document.querySelector('#qgm-outline').value,'# 文件里的新想法\n- 正文');assert.equal(document.querySelector('[aria-label="文档名称"]').value,'我的导入');assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：账号切换后迟到的本地文件不进入另一位用户的编辑器',async()=>{let finish;const f=await mountMindmap({path:'/mindmap'});try{const input=document.querySelector('[aria-label="导入大纲文件"]');Object.defineProperty(input,'files',{configurable:true,value:[{name:'之前的文件.md',size:80,text:()=>new Promise(resolve=>{finish=resolve;})}]});input.dispatchEvent(new Event('change',{bubbles:true}));f.auth.apply({accessToken:'other-session',refreshToken:'other-refresh',user:{id:'third-user',username:'另一位使用者',role:'USER'}});await settle();finish('# 前一个人的文件内容');await settle();assert.equal(document.querySelector('#qgm-outline').value,'');assert.equal(document.querySelector('.qgm-confirm').open,false);assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{finish?.('# 不会进入编辑器');await f.close();}});

test('思维导图：打开另一份文档后链接指向所选内容，新文档移除旧入口',async()=>{const f=await mountMindmap();try{mindmapClick('想法收纳');await settle();[...document.querySelectorAll('.qgm-document-card')].find(card=>card.textContent.includes('把复杂的事')).click();await mindmapWait(()=>f.router.currentRoute.value.query.doc==='qg-map-2');assert.equal(document.querySelector('#qgm-outline').value,f.memory.documents.find(row=>row.id==='qg-map-2').outline);mindmapClick('一个新想法');await settle();assert.equal(f.router.currentRoute.value.query.doc,undefined);assert.equal(document.querySelector('#qgm-outline').value,'');assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：另存后链接使用新的文档标识，不再回到原文档',async()=>{const f=await mountMindmap();try{const source=document.querySelector('#qgm-outline').value;mindmapClick('另存一份');await settle();assert.equal(f.router.currentRoute.value.query.doc,undefined);mindmapClick('保存这份想法');await settle();const created=f.memory.documents.find(row=>row.id.startsWith('qg-map-created-'));assert.ok(created);assert.equal(f.router.currentRoute.value.query.doc,created.id);assert.equal(document.querySelector('#qgm-outline').value,source);assert.equal(mindmapWrites(f).length,1);assert.equal(mindmapWrites(f)[0].body.kind,'create');assert.deepEqual(f.errors,[]);}finally{await f.close();}});
test('思维导图：有草稿时切换文档入口，保留当前内容同时纠正浏览器链接',async()=>{const f=await mountMindmap();try{await mindmapInput('#qgm-outline','# 我还在写的内容');await f.router.push('/mindmap?doc=qg-map-2');await settle();assert.equal(document.querySelector('#qgm-outline').value,'# 我还在写的内容');assert.equal(f.router.currentRoute.value.query.doc,'qg-map-1');assert.equal(document.querySelector('.qgm-confirm').open,true);mindmapClick('保留当前内容');await settle();assert.equal(f.router.currentRoute.value.query.doc,'qg-map-1');assert.equal(mindmapWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}});


test('异常恢复：匿名访客在站点状态不可用时仍能看见明确的缺失页面',async()=>{
 const f=await mount({initialPath:'/missing/private-id?draft=do-not-echo',realGuard:true,intercept:call=>call.url==='/api/installation/status'?relayJson('unavailable',503):null});try{assert.equal(f.router.currentRoute.value.name,'notFound');assert.ok(document.querySelector('.qgs-page'));assert.match(document.querySelector('#qgs-title').textContent,/页面走丢了/);assert.equal(document.querySelector('.qgc-header'),null);assert.equal(f.calls.some(c=>c.url==='/api/installation/status'),false);assert.equal(f.calls.some(c=>c.url==='/api/health'),false);assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.doesNotMatch(document.querySelector('.qgs-page').textContent,/private-id|do-not-echo/);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('异常恢复：检查连接只读取公开健康状态，不携带令牌或重复提交',async()=>{
 let release;const f=await mount({loggedIn:true,initialPath:'/500',realGuard:true,intercept:call=>call.url==='/api/health'?new Promise(done=>release=done):null});try{const button=document.querySelector('.qgs-connection button');button.click();button.click();await settle();assert.equal(button.disabled,true);const calls=f.calls.filter(c=>c.url==='/api/health');assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.equal(calls[0].authorization,null);release(relayJson({status:'ok'}));await settle();assert.match(document.querySelector('.qgs-connection').textContent,/连接已经亮起来/);assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.deepEqual(f.errors,[]);}finally{release?.(relayJson({status:'ok'}));await f.close();}
});
test('异常恢复：连接失败给出可重试状态，页面离开后不显示迟到回执',async()=>{
 let release,reads=0;const f=await mount({initialPath:'/update-expired',realGuard:true,intercept:call=>call.url==='/api/health'?(++reads===1?relayJson('PRIVATE-SERVER-ERROR',503):new Promise(done=>release=done)):null});try{document.querySelector('.qgs-connection button').click();await settle();assert.match(document.querySelector('.qgs-connection').textContent,/暂时没有接通/);assert.doesNotMatch(document.querySelector('.qgs-page').textContent,/PRIVATE-SERVER-ERROR/);document.querySelector('.qgs-connection button').click();await settle();const pending=f.calls.findLast(c=>c.url==='/api/health');await f.router.push('/404');await settle();assert.equal(pending.signal.aborted,true);release(relayJson({status:'ok'}));await settle();assert.doesNotMatch(document.querySelector('.qgs-connection').textContent,/连接已经亮起来/);assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.deepEqual(f.errors,[]);}finally{release?.(relayJson({status:'ok'}));await f.close();}
});
test('异常恢复：受限管理页只显示账号入口，不读取受限页面内容',async()=>{
 const f=await mount({loggedIn:true,initialPath:'/models/list',realGuard:true});try{assert.equal(f.router.currentRoute.value.path,'/unauthorized');assert.match(document.querySelector('#qgs-title').textContent,/这扇门/);assert.equal(document.querySelector('.qgs-secondary').getAttribute('href'),'/account');assert.equal(f.calls.some(c=>c.url==='/api/models'),false);assert.equal(document.querySelector('.qg-layout'),null);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

test('异常恢复：离开错误页后恢复原页面标题，不把异常状态留给创作页',async()=>{
 const previous=document.title,f=await mount({initialPath:'/404',realGuard:true});try{assert.match(document.title,/页面走丢了/);await f.router.push('/chat');await settle();assert.equal(document.title,previous);assert.equal(document.querySelector('.qgs-page'),null);assert.ok(document.querySelector('[aria-label="QGauss AI 灵感工作台"]'));assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

registerExtensionWorkbenchTests({test,assert,mount,settle,relayJson});

registerVoiceComposerTests({test,assert,mount,settle,relayJson});

registerVideoSpeakerTests({test,assert,mount,settle,relayJson,filmToolsData,filmSelect,filmAddFile});

registerAppImageTests({test,assert,mount,settle,relayJson});
