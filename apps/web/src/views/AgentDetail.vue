<template>
 <section class="qag-space qag-profile">
  <router-link class="qag-back" to="/agent"><ClientIcon name="chevronLeft" />{{ pt('回到行动搭档馆') }}</router-link>
  <div v-if="loading&&!agent" class="qag-detail-loading" role="status"><BrandLoader :text="pt('正在打开搭档的专长档案…')" :size="50" /></div>
  <div v-else-if="error&&!agent" class="qag-empty" role="alert"><span>☁</span><h1>{{ pt('这位搭档，暂时不在场。') }}</h1><p>{{ pt(error) }}</p><button class="qag-primary" type="button" @click="load()">{{ pt('重新查看') }}<ClientIcon name="refresh" /></button></div>
  <template v-if="agent">
   <div v-if="error" class="qag-profile-notice" role="alert"><span>{{ pt('最新资料暂未确认，先保留这份档案；重新核对后再开启协作。') }} {{ pt(error) }}</span><button type="button" :disabled="loading" @click="load(true)">{{ pt('重新核对') }}</button></div>
   <header class="qag-detail-hero">
    <div><span class="qag-eyebrow">QGAUSS / MEET YOUR ACTION PARTNER</span><span class="qag-ready" :class="{'is-ready':agent.ready}"><i></i>{{ pt(agentAvailability(agent)) }}</span><h1>{{ agent.name }}</h1><p>{{ agent.description||pt('让一位专业搭档，加入你的下一步。') }}</p><div class="qag-tags"><span v-for="tag in agent.tags||[]" :key="tag">{{ tag }}</span></div>
     <div class="qag-detail-actions"><button class="qag-primary" type="button" :disabled="!canLaunch" @click="launch()">{{ pt(canLaunch?'开启协作会话':loading?'正在核对搭档资料…':preparation.reason||'重新核对后再开始') }}<ClientIcon name="arrowUpRight" /></button><button class="qag-secondary" type="button" :aria-pressed="!!agent.favorited" :disabled="favoriteBusy" @click="favorite">{{ pt(agent.favorited?'♥ 已收藏':'♡ 收藏搭档') }}</button></div>
     <small class="qag-start-note">{{ pt('先打开新会话，由你发送第一个问题。') }}</small>
     <div class="qag-profile-sync"><span>{{ syncLabel }}</span><button type="button" :disabled="loading" @click="load(true)"><ClientIcon name="refresh" />{{ pt(loading?'正在核对搭档资料…':'刷新资料') }}</button></div>
    </div>
    <div class="qag-detail-sculpture" aria-hidden="true"><i></i><span>Q<small>YOUR NEXT<br>GOOD COMPANY</small></span><b>✦</b><em>✧</em></div>
   </header>
   <AgentCapabilities :agent="agent" />
   <div class="qag-detail-grid">
    <section class="qag-detail-card"><span class="qag-eyebrow">A LITTLE HELLO</span><h2>{{ pt('从一句问候开始。') }}</h2><blockquote>{{ agent.greeting||pt('你好，很高兴加入你的行动小队。今天，想一起完成什么？') }}</blockquote><small v-if="!agent.greeting">{{ pt('开场白示意 · 尚未设置专属问候') }}</small><div v-if="agent.suggestedQuestions?.length" class="qag-detail-questions"><h3>{{ pt('也可以从这些问题开始') }}</h3><button v-for="question in agent.suggestedQuestions" :key="question" type="button" :disabled="!canLaunch" @click="launch(question)">{{ question }}<ClientIcon name="arrowUpRight" /></button><small>{{ pt('点击打开会话并填入草稿，不自动发送。') }}</small></div></section>
    <aside class="qag-detail-card"><span class="qag-eyebrow">BEFORE WE BEGIN</span><h2>{{ pt('开始前，清楚一点。') }}</h2><dl><div><dt>{{ pt('本轮报价') }}</dt><dd>{{ agentQuote(agent,pt).label }}</dd></div><div><dt>{{ pt('结算方式') }}</dt><dd>{{ agentQuote(agent,pt).detail }}</dd></div><div><dt>{{ pt('内容与附件') }}</dt><dd>{{ pt('发送的问题和所选附件会交给配置的智能体服务处理。') }}</dd></div><div><dt>{{ pt('协作方式') }}</dt><dd>{{ pt('知识、工具和具体能力由搭档配置决定；支持的文件与任务仍需以实际返回为准。') }}</dd></div></dl><p>{{ pt('停止时会向服务方提出取消请求；服务方可能仍产生计算或用量。') }}</p></aside>
   </div>
  </template>
 </section>
</template>
<script setup>
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {ElMessage} from 'element-plus';
import {api} from '../api/client.js';
import {useAuth} from '../stores/auth.js';
import {agentQuote,agentAvailability} from '../lib/agent-presentation.js';
import {agentPreparation} from '../lib/agent-capabilities.js';
import {partnerText as pt,partnerLocale} from '../i18n/partner.js';
import ClientIcon from '../components/reference/ClientIcon.vue';
import BrandLoader from '../components/design/BrandLoader.vue';
import AgentCapabilities from '../components/design/AgentCapabilities.vue';
import '../components/design/agent-space.css';
const route=useRoute(),router=useRouter(),auth=useAuth(),agent=ref(null),loading=ref(true),error=ref(''),favoriteBusy=ref(false),id=computed(()=>String(route.query.agent||''));
const preparation=computed(()=>agentPreparation(agent.value)),canLaunch=computed(()=>!loading.value&&!error.value&&preparation.value.ready);
const syncLabel=computed(()=>{const value=agent.value?.lastSyncAt,time=typeof value==='string'?new Date(value):null;return time&&Number.isFinite(time.getTime())?pt('档案同步于 {time}',{time:new Intl.DateTimeFormat(partnerLocale(),{dateStyle:'medium'}).format(time)}):pt('档案同步时间尚未提供');});
let active=true,controller=null,favoriteController=null,revision=0;
async function load(preserve=false){
 controller?.abort();controller=new AbortController();const signal=controller.signal,version=++revision,identity=auth.identityRevision,target=id.value;
 if(!preserve)agent.value=null;loading.value=true;error.value='';
 if(!target||target.length>200){agent.value=null;error.value='没有找到对应的搭档，请回到列表重新选择。';loading.value=false;return;}
 const current=()=>active&&!signal.aborted&&identity===auth.identityRevision&&version===revision&&target===id.value;
 try{const value=await api.get('/agents/'+encodeURIComponent(target),{signal,retry:false});if(current()){if(value?.id!==target)throw new Error('搭档资料身份未能确认，请重新核对。');agent.value=value;}}
 catch(e){if(current()){if(e.status===404)agent.value=null;error.value=e.status===404?'这位搭档可能已经下架，可以回到列表认识其他搭档。':e.message||'暂未打开档案，请重试。';}}
 finally{if(current())loading.value=false;}
}
async function favorite(){
 if(!agent.value||favoriteBusy.value)return;const target=agent.value,identity=auth.identityRevision,c=new AbortController();favoriteController=c;favoriteBusy.value=true;
 try{const result=await api.post('/agents/'+encodeURIComponent(target.id)+'/favorite',{favorited:!target.favorited},{signal:c.signal});if(active&&!c.signal.aborted&&identity===auth.identityRevision&&agent.value===target)target.favorited=!!result.favorited;}
 catch(e){if(active&&!c.signal.aborted&&identity===auth.identityRevision)ElMessage.error(pt(e.message||'收藏结果暂未确认，请刷新核对。'));}
 finally{if(favoriteController===c){favoriteBusy.value=false;favoriteController=null;}}
}
function launch(question){if(!canLaunch.value)return;return router.push({path:'/agent/chat',query:{agent:agent.value.id,...(typeof question==='string'?{draft:question}:{})}});}
watch(id,()=>{favoriteController?.abort();favoriteBusy.value=false;void load();});
watch(()=>auth.identityRevision,()=>{controller?.abort();favoriteController?.abort();agent.value=null;error.value='';favoriteBusy.value=false;revision++;if(auth.isLoggedIn)void load();else loading.value=false;});
onMounted(()=>{if(auth.isLoggedIn)void load();else loading.value=false;});onBeforeUnmount(()=>{active=false;controller?.abort();favoriteController?.abort();});
</script>
