/** 独立视觉观察入口：真实 Vue 页面 + 明确的本地数据夹具，不连接项目 API。 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import * as icons from '@element-plus/icons-vue';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import 'highlight.js/styles/github.css';
import '../../apps/web/src/styles/tokens.css';
import '../../apps/web/src/styles/app.css';
import App from '../../apps/web/src/App.vue';
import { router } from '../../apps/web/src/router.js';
import { useAuth } from '../../apps/web/src/stores/auth.js';
import { richMessages } from './rich-fixture.mjs';
import { artworkFixtures } from './artwork-fixture.mjs';
import { videoFixtures } from './video-fixture.mjs';
import {videoToolFixtures,filmMaterialSamples} from './video-tools-fixture.mjs';
import { midjourneyFixtures } from './midjourney-fixture.mjs';
import { imageBillingFixtures } from './image-billing-fixture.mjs';
import {appStudioFixtures,appStudioPage} from './app-creator-fixture.mjs';
import { appDiscoveryFixtures } from './app-discovery-fixture.mjs';
import { modelDiscoveryFixtures } from './model-discovery-fixture.mjs';
import { walletEnergyFixtures, walletFixturePage } from './wallet-energy-fixture.mjs';
import { membershipFixtures, membershipOrderPage } from './membership-fixture.mjs';
import { referralFixtures, referralPage } from './referral-fixture.mjs';
import { chatCountMessages } from './chat-count-fixture.mjs';
import { nativeProtocolChannels, nativeProtocolMessages } from './native-protocol-fixture.mjs';
import { accountFixtures, accountLogPage } from './account-fixture.mjs';
import { installationFixtures } from './installation-fixture.mjs';
import { mailFixtures, mailFixturePage } from './mail-fixture.mjs';
import { webSearchMessage } from './web-search-fixture.mjs';
import {agentFixtures,agentFixturePage} from './agent-fixture.mjs';
import {voiceLibraryFixtures,voiceLibraryPage} from './voice-library-fixture.mjs';
import {voiceFixtures} from './voice-fixture.mjs';
import {galleryFixtures,galleryPage,galleryFavorite} from './gallery-fixture.mjs';
import {mindmapFixtures,mindmapFixtureReply} from './mindmap-fixture.mjs';
import {imageEditorPreview} from './image-editor-fixture.mjs';
import {emailVerificationFixtures,emailVerificationAction} from './email-verification-fixture.mjs';
const installationState = new URL(location.href).searchParams.get('state');
const imageEditorData=installationState?.startsWith('image-editor')?imageEditorPreview():null;
const galleryMode=installationState?.startsWith('gallery-');
const mindmapData=installationState?.startsWith('mindmap-')?mindmapFixtures(installationState):null;

const richMode = new URL(location.href).searchParams.get('state')?.startsWith('rich');
const chatCountMode = new URL(location.href).searchParams.get('state')?.startsWith('chat-count');
const chatSettlingMode = new URL(location.href).searchParams.get('state') === 'chat-settling';
const webSearchMode = installationState?.startsWith('web-search');
const runningMode = chatSettlingMode || installationState === 'web-search-progress' || new URL(location.href).searchParams.get('state') === 'running';
const nativeProtocolMode = new URL(location.href).searchParams.get('state') === 'native-protocols';
const historyMode = installationState?.startsWith('voice-') || webSearchMode || nativeProtocolMode || chatCountMode || richMode || runningMode || new URL(location.href).searchParams.get('state') === 'history';
const adminMode = new URL(location.href).searchParams.get('persona') === 'admin' || installationState?.startsWith('welcome-') || installationState?.startsWith('mail-') || installationState?.startsWith('review-');
const artworkMode = new URL(location.href).searchParams.get('state')?.startsWith('artworks');
const artworkData = artworkFixtures();
let imageEditUploads = 0;
const imageBillingMode = new URL(location.href).searchParams.get('state') === 'artworks-billing';
const conversation = { id: 'qg-reference-conversation', title: runningMode ? '观察用生成任务' : '观察用历史会话', activeMessageId: runningMode ? 'qg-reference-assistant' : null, appId: null, pinned: false, messageCount: 2, createdAt: '2026-10-30T08:00:00Z', lastMessageAt: '2026-10-30T08:00:00Z' };
const models = [
  { id: 'qg-reference-model', name: 'qgauss-reference', displayName: 'QGauss 灵感模型', vendor: 'QGauss', ready: true, capabilities: ['chat', 'vision'], tags: ['演示样例'], description: '用来观察文字与图像理解卡片的本地模型样例，不连接供应商。', maxContext: 128000 },
  { id: 'qg-reference-reason', name: 'qgauss-reason', displayName: 'QGauss 思考模型', vendor: 'QGauss', ready: true, capabilities: ['chat', 'reasoning'], tags: ['演示样例'], description: '用来观察推理与长文场景的本地模型样例。', maxContext: 200000 },
  { id: 'qg-reference-offline', name: 'qgauss-offline', displayName: 'QGauss 视觉模型', vendor: 'QGauss', ready: false, capabilities: ['vision'], tags: ['演示样例'], description: '维护状态的展示样例；按钮不会开始真实对话。', maxContext: 64000 },
];
const fixtures = {
  ...installationFixtures(installationState),
  ...mailFixtures(installationState),
  '/api/settings/public': { 'commerce.enabled': false, 'site.name': 'QGauss AI' },
  '/api/menus': [],
  '/api/conversations': historyMode ? [conversation] : [],
  '/api/conversations/qg-reference-conversation': { ...conversation, model: { name: 'qgauss-reference' }, messages: [{ id: 'qg-reference-user', role: 'USER', content: '请说明这个观察场景。', parentId: null }, { id: 'qg-reference-assistant', role: 'ASSISTANT', content: '这是用于界面观察的**本地夹具**，不代表真实模型回复。\n\n```js\nconst product = "QGauss AI";\n```', parentId: 'qg-reference-user', status: runningMode ? 'STREAMING' : 'COMPLETED' }] },
  '/api/models/available': models,
  '/api/models/plaza': { total: 3, ready: 2, vendors: [{ key: 'QGauss', label: 'QGauss', count: 3 }], models },
  '/api/apps/categories': [{ id: 'qg-writing', name: '写作与表达' }, { id: 'qg-learning', name: '学习与规划' }],
  '/api/apps': [
    { id: 'qg-writer', name: '灵感写手', categoryId: 'qg-writing', category: { name: '写作与表达' }, description: '把零散念头，整理成有温度的文字。这是本地展示样例。', defaultModel: 'qgauss-reference', favorited: false },
    { id: 'qg-planner', name: '小步规划师', categoryId: 'qg-learning', category: { name: '学习与规划' }, description: '把大目标拆成今天能开始的一小步。这是本地展示样例。', defaultModel: 'qgauss-reason', favorited: true },
    { id: 'qg-teacher', name: '知识翻译官', categoryId: 'qg-learning', category: { name: '学习与规划' }, description: '用容易理解的比喻，聊懂复杂知识。这是本地展示样例。', defaultModel: 'qgauss-reference', favorited: false },
  ],
  '/api/image/options': { ratios: [{ key: '1:1', w: 1, h: 1, scene: '方形' }, { key: '3:4', w: 3, h: 4, scene: '肖像' }, { key: '16:9', w: 16, h: 9, scene: '横幅' }], resolutions: [{ key: '1K', label: '1K' }, { key: '2K', label: '2K' }, { key: '4K', label: '4K' }], cats: [], models: [{ name: 'qgauss-image-demo', displayName: 'QGauss 图像样例' }, { name: 'qgauss-image-studio', displayName: 'QGauss 工作室样例' }] },
  '/api/image/tasks': { items: [], total: 0 },
  '/api/image/square': { items: [], total: 0 },
  '/api/statistic/overview': { users: 0, conversations: 0, messages: 0, totalTokens: 0 },
  '/api/statistic/trend': [],
  '/api/statistic/errors': [],
  '/api/models/channels/health': [],
  '/api/chat-logs': { items: [], total: 0 },
  '/api/folders': [],
  '/api/presets': [],
  '/api/chat/quota': { limit: 0, used: 0 },
};
if (richMode) { conversation.title = '公式与图表工作台'; conversation.messageCount = 6; fixtures['/api/conversations/qg-reference-conversation'].title = conversation.title; fixtures['/api/conversations/qg-reference-conversation'].messages = richMessages(new URL(location.href).searchParams.get('state') === 'rich-error'); }
if (nativeProtocolMode) { conversation.title = '每轮用量，清楚记录'; conversation.messageCount = 6; fixtures['/api/conversations/qg-reference-conversation'].title = conversation.title; fixtures['/api/conversations/qg-reference-conversation'].messages = nativeProtocolMessages(); }
if (webSearchMode) {
  conversation.title='沿着来源，打开灵感';
  models[0].capabilities.push('web_search');models[0].webSearchAvailable=true;
  Object.assign(fixtures['/api/conversations/qg-reference-conversation'],{title:conversation.title,messages:[{id:'qg-reference-user',role:'USER',content:'为我的秋日创作空间找一些光影、材质和动效灵感，并附上资料来源。'},webSearchMessage(installationState)]});
}
if (new URL(location.href).searchParams.get('state') === 'native-channels') fixtures['/api/models/channels'] = nativeProtocolChannels();
if (new URL(location.href).searchParams.get('state')?.startsWith('account')) Object.assign(fixtures,accountFixtures(new URL(location.href).searchParams.get('state')));
if (chatCountMode) { conversation.title = '每一份灵感都有记录'; conversation.messageCount = 6; fixtures['/api/conversations/qg-reference-conversation'].title = conversation.title; fixtures['/api/conversations/qg-reference-conversation'].messages = chatCountMessages(); }
if (chatCountMode || chatSettlingMode) { Object.assign(fixtures, { '/api/balance/query': walletEnergyFixtures()['/api/balance/query'] }); }
if (chatSettlingMode) { conversation.activeMessageStatus = 'SETTLING'; const message = fixtures['/api/conversations/qg-reference-conversation'].messages[1]; message.status = 'SETTLING'; message.billing = { state: 'SETTLING', pool: 'model3', limit: 2, reserved: 2, charged: 0, returned: 0, expired: 0 }; }
if (artworkMode) {
  if (installationState === 'artworks-edit') {
    Object.assign(artworkData.mine[0], { mode: 'img2img', editOf: 'qg-edit-main', referenceIds: ['qg-edit-main', 'qg-edit-material'], prompt: '保留玻璃小伙伴的主体，把主图右侧的背景改成漂浮花园。参考图二提供青柠色和柔软材质。' });
    fixtures['/api/image/options'].defaultFeatures = { qualities: ['auto'], resolutions: ['1K', '2K', '4K'], ratios: ['1:1', '3:4', '16:9'], seed: false, pixelSize: true, maxReferences: 8, mask: true };
    fixtures['/api/image/options'].billing = { enabled: true, costPerImage: 1, qualityFactors: { auto: 1, high: 2 } };
  }
  if (imageBillingMode) { Object.assign(fixtures, imageBillingFixtures(artworkData)); fixtures['/api/settings/public']['commerce.enabled'] = true; fixtures['/api/image/options'].billing = { enabled: true, costPerImage: 1, qualityFactors: { auto: 1, low: 1, medium: 1, high: 2 }, reservation: true }; }
  fixtures['/api/image/tasks'] = { items: artworkData.mine, total: artworkData.mine.length };
  fixtures['/api/image/square'] = { items: artworkData.square, total: artworkData.square.length };
  for (const task of [...artworkData.mine, ...artworkData.square]) fixtures['/api/image/tasks/' + task.id] = task;
}
if (new URL(location.href).searchParams.get('state')?.startsWith('apps-')) Object.assign(fixtures, appDiscoveryFixtures());
if (new URL(location.href).searchParams.get('state')?.startsWith('models-')) Object.assign(fixtures, modelDiscoveryFixtures());
if (new URL(location.href).searchParams.get('state')?.startsWith('wallet-')) Object.assign(fixtures, walletEnergyFixtures());
if (new URL(location.href).searchParams.get('state')?.startsWith('membership-')) Object.assign(fixtures, membershipFixtures());
if (new URL(location.href).searchParams.get('state') === 'membership-disabled') fixtures['/api/settings/public']['commerce.enabled'] = false;
const referralState = new URL(location.href).searchParams.get('state');
if(installationState?.startsWith('agents-'))Object.assign(fixtures,agentFixtures(installationState));
if(installationState?.startsWith('voice-')){Object.assign(fixtures,voiceFixtures(installationState));fixtures['/api/settings/public']['commerce.enabled']=true;}
if(installationState?.startsWith('video-')){Object.assign(fixtures,installationState.startsWith('video-tools-')?videoToolFixtures(installationState):videoFixtures(installationState));fixtures['/api/settings/public']['commerce.enabled']=true;}
if(installationState?.startsWith('mj-')){Object.assign(fixtures,midjourneyFixtures(installationState));fixtures['/api/settings/public']['commerce.enabled']=true;}
if (referralState?.startsWith('referral-')) Object.assign(fixtures, referralFixtures());
if (referralState === 'referral-disabled') fixtures['/api/settings/public']['commerce.enabled'] = false;
if (referralState === 'referral-paused') fixtures['/api/sales/info'].enabled = false;
for (const app of fixtures['/api/apps']) fixtures['/api/apps/' + app.id] ||= app;
Object.assign(fixtures,emailVerificationFixtures(fixtures,installationState));
if(installationState?.startsWith('creator-')||installationState?.startsWith('review-'))Object.assign(fixtures,appStudioFixtures(installationState));
if(installationState?.startsWith('voice-library-'))Object.assign(fixtures,voiceLibraryFixtures(installationState));
if(galleryMode)Object.assign(fixtures,galleryFixtures(installationState));
const nativeFetch = window.fetch.bind(window);
if(imageEditorData){fixtures['/api/image/options'].defaultFeatures=imageEditorData.features;fixtures['/api/image/options'].models=[{id:'qg-editor-model',name:'qgauss-image-editor',displayName:'QGauss 图像搭档',ready:true,features:imageEditorData.features}];}
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input?.url==='string'?input.url:String(input), location.href);
  if(url.origin===location.origin&&!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
  if(installationState?.startsWith('status-')&&url.pathname==='/api/health')return new Response(JSON.stringify({status:installationState==='status-offline'?'unavailable':'ok'}),{status:installationState==='status-offline'?503:200,headers:{'Content-Type':'application/json'}});
  if(imageEditorData&&url.origin===location.origin){const result=await imageEditorData.reply(url,init);if(result)return result;}
  if(mindmapData&&url.origin===location.origin&&url.pathname.startsWith('/api/mindmap/')){const body=typeof init.body==='string'?JSON.parse(init.body):{};const result=mindmapFixtureReply(mindmapData,url,init.method||'GET',body);return new Response(JSON.stringify(result.error?{code:result.status,message:result.error}:{code:0,data:result.data}),{status:result.status,headers:{'Content-Type':'application/json'}});}
  if(galleryMode&&url.origin===location.origin){
    if(installationState==='gallery-error'&&url.pathname==='/api/gallery/works')return new Response(JSON.stringify({code:503,message:'本地作品列表加载失败样例'}),{status:503,headers:{'Content-Type':'application/json'}});
    if((init.method||'GET')==='GET'&&/^\/api\/gallery\/works\/(image|mj|video)\/qg-gallery-\d+\/assets\/\d+$/.test(url.pathname))return new Response(fixtures[url.pathname]||'',{status:Object.hasOwn(fixtures,url.pathname)?200:404,headers:{'Content-Type':'image/svg+xml'}});
    const target=/^\/api\/gallery\/works\/(image|mj|video)\/(qg-gallery-\d+)\/favorite$/.exec(url.pathname);
    if(target&&(init.method||'GET')==='PUT'){const value=galleryFavorite(fixtures,target[1]+':'+target[2],JSON.parse(init.body||'{}').favorite);return new Response(JSON.stringify(value?{code:0,data:value}:{code:404,message:'作品不可用'}),{status:value?200:404,headers:{'Content-Type':'application/json'}});}
  }
  if(url.origin===location.origin&&installationState?.startsWith('email-')){const sample=emailVerificationAction(installationState,url.pathname,init.method||'GET',typeof init.body==='string'?JSON.parse(init.body):{},fixtures);if(sample)return sample;}
  if(installationState?.startsWith('voice-library-')&&/^\/api\/voice\/tasks\/qg-library-voice-\d+\/audio\/[01]$/.test(url.pathname))return nativeFetch('/qgauss-film-voice.wav');
  if(installationState?.startsWith('video-tools-')){
    const raw=/^\/api\/upload\/(qg-film-material-(image|video|audio))\/raw$/.exec(url.pathname);if(raw)return nativeFetch(({image:'/art/qgauss-companion.png',video:'/qgauss-film-material.mp4',audio:'/qgauss-film-voice.wav'})[raw[2]]);
    if((init.method||'GET')==='POST'&&url.pathname.startsWith('/api/video/materials/from-task/'))return new Response(JSON.stringify({code:0,data:filmMaterialSamples[1]}),{status:201,headers:{'Content-Type':'application/json'}});
    if((init.method||'GET')==='POST'&&url.pathname==='/api/video/quote'){const body=JSON.parse(init.body||'{}'),kind=body.mode,materials=filmMaterialSamples.filter(m=>(body[m.kind+'Ids']||[]).includes(m.id)),seconds=kind==='upscale'||kind==='lipsync'||kind==='edit'?6:body.seconds||6,multiplier=kind==='upscale'?(body.upscaleFactor||2)**2:1;return new Response(JSON.stringify({code:0,data:{revision:'a'.repeat(64),name:kind==='upscale'?'画面精修室':kind==='lipsync'?'表情与声音':'光影叙事',cost:(fixtures['/api/video/options'].presets.find(p=>p.id===body.presetId)?.pricing.base||0)+Math.ceil((fixtures['/api/video/options'].presets.find(p=>p.id===body.presetId)?.pricing.perSecond||0)*seconds*multiplier),pool:'drawMj',seconds,multiplier,followsSource:['upscale','lipsync','edit'].includes(kind),materials}}),{status:201,headers:{'Content-Type':'application/json'}});}
  }
  if (installationState?.startsWith('mj-') && url.pathname === '/api/upload' && init.method === 'POST') return new Response(JSON.stringify({code:0,data:{id:'qg-mj-local-mask'}}),{status:201,headers:{'Content-Type':'application/json'}});
  if (installationState?.startsWith('mj-') && url.pathname.startsWith('/api/mj/sample/')) return nativeFetch('/qgauss-mj-grid.svg');
  if (installationState === 'artworks-edit' && /^\/api\/upload\/qg-edit-(main|material)\/raw$/.test(url.pathname)) return nativeFetch(url.pathname.includes('-main/') ? '/art/qgauss-companion.png' : '/art/qgauss-play-sculpture.png');
  if (installationState === 'artworks-edit' && url.pathname === '/api/upload' && init.method === 'POST') return new Response(JSON.stringify({ code: 0, data: { id: 'qg-edit-mask-' + (++imageEditUploads) } }), { status: 201, headers: { 'Content-Type': 'application/json', 'X-QGauss-Reference-Fixture': 'client-preview' } });
  if (new URL(location.href).searchParams.get('state') === 'models-error' && url.pathname === '/api/models/plaza') return new Response(JSON.stringify({ code: 503, message: '明确的本地模型加载错误样例' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-QGauss-Reference-Fixture': 'client-preview' } });
  if (new URL(location.href).searchParams.get('state') === 'apps-error' && url.pathname === '/api/apps') return new Response(JSON.stringify({ code: 503, message: '明确的本地应用加载错误样例' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-QGauss-Reference-Fixture': 'client-preview' } });
  if (new URL(location.href).searchParams.get('state') === 'artworks-error' && url.pathname === '/api/image/tasks') return new Response(JSON.stringify({ code: 503, message: '明确的本地网络错误样例' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-QGauss-Reference-Fixture': 'client-preview' } });
  if (runningMode && url.origin === location.origin && (init.method || 'GET') === 'GET' && url.pathname === '/api/chat/runs/qg-reference-assistant/events') {
    let channel;
    const body = new ReadableStream({
      start(controller) {
        channel = controller;
        const snapshot = { messageId: 'qg-reference-assistant', conversationId: conversation.id, userMessageId: 'qg-reference-user', status: 'STREAMING', content: '这是用于观察**后台续接状态**的只读样例。\n\n切换工作区外观或会话，不会重新发送问题。真实任务的继续、停止和扣费通过独立 HTTP 回归验证。', reasoning: '先整理问题，再把零散想法变成清晰的下一步。' };
        if(webSearchMode){const message=webSearchMessage(installationState);Object.assign(snapshot,{content:message.content,status:message.status,reasoning:'',webSearch:message.webSearch});}
        if (chatSettlingMode) Object.assign(snapshot, { status: 'SETTLING', content: '这是**保存与结算中**的只读观察样例，没有生成或收费。\n\n真实回复保存后会继续完成结算，此时无需重新发送；连接恢复只读取原回复。', reasoning: '', billing: { state: 'SETTLING', pool: 'model3', limit: 2, reserved: 2, charged: 0, returned: 0, expired: 0 } });
        controller.enqueue(new TextEncoder().encode('id: 8\nevent: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n'));
      },
    });
    init.signal?.addEventListener('abort', () => { try { channel.close(); } catch {} }, { once: true });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'X-QGauss-Reference-Fixture': 'client-preview' } });
  }
  if (url.pathname === '/api/sales/info' && ['referral-error','referral-join'].includes(referralState)) return new Response(JSON.stringify({code:503,message:'明确的本地推广账户状态样例'}),{status:referralState === 'referral-join' ? 403 : 503,headers:{'Content-Type':'application/json'}});
  if (referralState === 'referral-records-error' && url.pathname === '/api/sales/records') return new Response(JSON.stringify({code:503,message:'明确的本地推广记录错误样例'}),{status:503,headers:{'Content-Type':'application/json'}});
  const memberState = new URL(location.href).searchParams.get('state');
  if ((memberState === 'membership-error' || memberState === 'membership-disabled') && url.pathname === '/api/crami/packages' || memberState === 'membership-orders-error' && url.pathname === '/api/order/list') return new Response(JSON.stringify({code:503,message:'明确的本地会员补给加载错误样例'}),{status:memberState === 'membership-disabled'?404:503,headers:{'Content-Type':'application/json'}});
  const walletState = new URL(location.href).searchParams.get('state');
  if ((walletState === 'wallet-error' || walletState === 'wallet-disabled') && url.pathname === '/api/balance/query' || walletState === 'wallet-logs-error' && url.pathname === '/api/balance/consumeLog') return new Response(JSON.stringify({ code: 503, message: '明确的本地钱包状态样例' }), { status: walletState === 'wallet-disabled' ? 404 : 503, headers: { 'Content-Type': 'application/json' } });
  const supported = url.origin === location.origin && (init.method || 'GET') === 'GET' && Object.hasOwn(fixtures, url.pathname);
  if ((installationState === 'mail-error' && url.pathname === '/api/mail/status') || (installationState === 'mail-rows-error' && url.pathname === '/api/mail/outbox')) return new Response(JSON.stringify({code:503,message:'明确的本地邮件状态读取失败样例'}),{status:503,headers:{'Content-Type':'application/json'}});
  if ((installationState === 'install-error' && url.pathname === '/api/installation/status') || (installationState === 'welcome-error' && url.pathname === '/api/installation/readiness')) return new Response(JSON.stringify({code:503,message:'明确的本地启航清单读取失败样例'}),{status:503,headers:{'Content-Type':'application/json'}});
  if ((new URL(location.href).searchParams.get('state') === 'account-error' && url.pathname === '/api/users/profile') || (new URL(location.href).searchParams.get('state') === 'account-logs-error' && url.pathname === '/api/users/logins')) return new Response(JSON.stringify({code:503,message:'明确的本地账户读取失败样例'}),{status:503,headers:{'Content-Type':'application/json'}});
  let data = fixtures[url.pathname];
  if(supported&&galleryMode&&url.pathname==='/api/gallery/works')data=galleryPage(data,url.search);
  if(supported&&galleryMode&&url.pathname.endsWith('/playback')&&url.pathname.includes('/works/mj/'))data={...data,videoUrl:data.videoUrl.replace(/\/0\?ticket=/,'/'+(url.searchParams.get('index')||'0')+'?ticket=')};
  if(supported&&installationState?.startsWith('voice-library-')&&url.pathname==='/api/voice/library')data=voiceLibraryPage(data,url);
  if(supported&&(installationState?.startsWith('creator-')||installationState?.startsWith('review-')))data=appStudioPage(data,url);
  if(installationState==='agents-error'&&url.pathname==='/api/agents')return new Response(JSON.stringify({code:503,message:'本地搭档列表加载失败样例'}),{status:503,headers:{'Content-Type':'application/json'}});
  if(supported&&url.pathname==='/api/agents')data=agentFixturePage(data,url);
  if(supported && url.pathname === '/api/mail/outbox')data=mailFixturePage(data,url);
  if(supported && url.pathname==='/api/users/logins')data=accountLogPage(data,url);
  if (supported && referralState?.startsWith('referral-') && ['/api/sales/records','/api/sales/withdrawals'].includes(url.pathname)) data = referralPage(referralState === 'referral-empty' ? [] : data,url);
  if (supported && memberState === 'membership-empty' && url.pathname === '/api/crami/packages') data = {items:[]};
  if (supported && memberState?.startsWith('membership-') && url.pathname === '/api/order/list') data = membershipOrderPage(memberState === 'membership-empty' ? [] : data,url);
  if (supported && walletState?.startsWith('wallet-') && ['/api/balance/consumeLog', '/api/balance/rechargeLog', '/api/crami/myLog'].includes(url.pathname)) data = walletFixturePage(walletState === 'wallet-empty' ? [] : data, url);
  if (supported && walletState === 'wallet-signed' && url.pathname === '/api/signin/signinLog') data = { ...data, signedToday: true, streak: 3, items: [...data.items, { signInDate: data.today }] };
  if (supported && new URL(location.href).searchParams.get('state') === 'models-empty' && url.pathname === '/api/models/plaza') data = { total: 0, ready: 0, vendors: [], models: [] };
  if (supported && new URL(location.href).searchParams.get('state') === 'apps-empty' && url.pathname === '/api/apps') data = [];
  if (supported && url.pathname === '/api/apps' && url.searchParams.has('categoryId')) data = data.filter(item => item.categoryId === url.searchParams.get('categoryId'));
  return new Response(JSON.stringify(supported ? { code: 0, data } : { code: 501, message: '独立视觉观察夹具未实现此操作，请在项目 API 验收中验证' }), { status: supported ? 200 : 501, headers: { 'Content-Type': 'application/json', 'X-QGauss-Reference-Fixture': 'client-preview' } });
};

const pinia = createPinia();
const auth = useAuth(pinia);
auth.remember = false;
if (!installationState?.startsWith('install-') && !installationState?.startsWith('status-') && installationState !== 'email-register' && installationState !== 'creator-guest') auth.apply({ accessToken: 'qgauss-reference-only', refreshToken: 'qgauss-reference-only', user: { id: 'qgauss-reference-only', username: 'QGauss 观察员', role: adminMode ? 'ADMIN' : 'USER' } });
if(['voice-transcript','voice-player','voice-interrupted'].includes(installationState))sessionStorage.setItem('qg:voice:qgauss-reference-only:qg-reference-conversation',JSON.stringify({requestKey:'qg-voice-visual-intent',taskId:'qg-voice-result',payload:{kind:installationState==='voice-transcript'?'transcription':'speech'},quoteRevision:'a'.repeat(64)}));
const app = createApp(App);
app.use(pinia).use(router);
for (const [key, component] of Object.entries(icons)) app.component(key, component);
app.mount('#app');
