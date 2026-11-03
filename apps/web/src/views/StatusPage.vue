<template>
 <div class="qgs-page" :data-state="kind" :data-variant="appearance.variant">
  <AmbientScene />
  <header class="qgs-header"><router-link class="qgs-brand" to="/chat" aria-label="QGauss AI 首页"><img src="/brand/qgauss-mark.svg" alt=""/><span>QGauss AI</span></router-link><span class="qgs-header-note">给灵感，留一条回来的路。</span><button type="button" class="qgs-appearance" @click="appearance.open=true" aria-label="打开外观实验室"><ClientIcon name="palette"/></button></header>
  <main class="qgs-main" aria-labelledby="qgs-title">
   <section class="qgs-art" aria-hidden="true"><div class="qgs-orbit qgs-orbit-one"></div><div class="qgs-orbit qgs-orbit-two"></div><span class="qgs-spark qgs-spark-one">✳</span><span class="qgs-spark qgs-spark-two">✦</span><div class="qgs-stack"><div class="qgs-stack-back"></div><div class="qgs-stack-front"><span class="qgs-art-code">{{ content.code }}</span><span class="qgs-art-caption">{{ content.art }}</span><div v-if="kind==='403'" class="qgs-lock"><i></i><b>•</b></div><div v-else class="qgs-companion"><i></i><i></i><b>⌣</b></div></div><div class="qgs-art-label"><i></i>{{ content.label }}</div></div><span class="qgs-art-foot">QGAUSS / KEEP YOUR IDEAS CLOSE</span></section>
   <section class="qgs-copy"><span class="qgs-eyebrow">{{ content.eyebrow }}</span><h1 id="qgs-title">{{ content.title }}<br/><em>{{ content.accent }}</em></h1><p class="qgs-description">{{ content.description }}</p>
    <div class="qgs-actions"><button v-if="kind==='update'||kind==='500'" type="button" class="qgs-primary" @click="reopen">{{ kind==='update'?'更新页面，再出发':'重新打开刚才页面' }}<ClientIcon name="arrowUpRight"/></button><router-link v-else class="qgs-primary" to="/chat">回到创作空间<ClientIcon name="arrowUpRight"/></router-link><router-link v-if="kind==='403'" class="qgs-secondary" :to="auth.isLoggedIn?'/account':'/login'">{{ auth.isLoggedIn?'查看我的账号':'前往登录' }}</router-link><router-link v-else-if="kind==='404'" class="qgs-secondary" to="/apps">逛逛应用广场</router-link><router-link v-else class="qgs-secondary" to="/chat">回到创作空间</router-link></div>
    <p v-if="kind==='500'||kind==='update'" class="qgs-recovery-note">返回后先核对最近记录，再决定是否重新提交创作。</p>
    <div class="qgs-connection" :data-status="connection.status"><span class="qgs-connection-dot"></span><div aria-live="polite"><b>{{ connectionTitle }}</b><span>{{ connection.message||'可以先检查连接，再继续你的想法。' }}</span></div><button type="button" :disabled="connection.status==='checking'" @click="checkConnection"><QLoader v-if="connection.status==='checking'" :size="18"/>{{ connection.status==='checking'?'检查中':'检查连接' }}</button></div>
   </section>
   <nav class="qgs-destinations" aria-label="继续探索"><router-link v-for="item in destinations" :key="item.path" :to="item.path"><span class="qgs-destination-symbol"><ClientIcon :name="item.icon"/></span><div><b>{{ item.title }}</b><span>{{ item.description }}</span></div><ClientIcon name="arrowUpRight"/></router-link></nav>
  </main><footer class="qgs-footer"><span>QGauss AI</span><span>每个小想法，都有下一站。<i>✦</i></span></footer>
 </div>
</template>
<script setup>
import {computed,onBeforeUnmount,reactive,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {useAuth} from '../stores/auth.js';
import {useAppearance} from '../stores/appearance.js';
import {safeReturnTarget} from '../lib/route-recovery.js';
import AmbientScene from '../components/design/AmbientScene.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import QLoader from '../components/QLoader.vue';
import '../components/design/status-page.css';
const route=useRoute(),router=useRouter(),auth=useAuth(),appearance=useAppearance(),previousTitle=document.title;
const pages={
 '404':{code:'404',art:'A LITTLE DETOUR',label:'灵感没有走丢',eyebrow:'A NEW WAY BACK',title:'页面走丢了，',accent:'好点子还在。',description:'这个地址暂时没有对应的页面。回到熟悉的空间，继续刚才的想法。'},
 '403':{code:'403',art:'YOUR OWN LITTLE SPACE',label:'找到属于你的入口',eyebrow:'THE RIGHT DOOR, FOR YOU',title:'这扇门，',accent:'暂时还没打开。',description:'当前账号暂时不能访问这个空间。你可以查看自己的账号，或回到创作页面继续使用。'},
 '500':{code:'500',art:'A SMALL PAUSE',label:'让连接重新亮起来',eyebrow:'TAKE A LITTLE BREATH',title:'遇到一点小停顿，',accent:'灵感先别停。',description:'这个页面刚才没能顺利打开。检查连接后，可以重新打开；已有创作的结果请到记录里核对。'},
 update:{code:'↻',art:'SOMETHING NEW IS HERE',label:'准备迎接新的画面',eyebrow:'A FRESH START',title:'新的画面，',accent:'等你重新打开。',description:'当前页面的内容暂时无法完整加载。重新打开页面，获取最新内容后继续。'},
};
const kind=computed(()=>Object.hasOwn(pages,route.meta.systemStatus)?route.meta.systemStatus:'404'),content=computed(()=>pages[kind.value]);
const destinations=[{path:'/chat',icon:'chat',title:'对话聊天',description:'接住下一个好点子'},{path:'/apps',icon:'apps',title:'应用广场',description:'寻找新的创作搭档'},{path:'/painting',icon:'image',title:'智能绘画',description:'让想象慢慢成形'}];
const connection=reactive({status:'idle',message:''}),connectionTitle=computed(()=>({idle:'灵感连接站',checking:'正在确认连接…',online:'连接已经亮起来',offline:'连接暂时没有接通'}[connection.status]));
let controller,alive=true,revision=0;
async function checkConnection(){
 if(connection.status==='checking')return;const own=++revision;controller?.abort();controller=new AbortController();connection.status='checking';connection.message='';
 try{const response=await fetch('/api/health',{method:'GET',credentials:'omit',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)])});if(!response.ok)throw Error('unavailable');if(!alive||own!==revision)return;connection.status='online';connection.message='可以重新打开页面，继续你的创作。';}
 catch{if(alive&&own===revision){connection.status='offline';connection.message='请稍后再试，或确认当前网络是否可用。';}}
}
function reopen(){window.location.replace(safeReturnTarget(router,route.query.return));}
watch(()=>route.fullPath,()=>{revision++;controller?.abort();connection.status='idle';connection.message='';document.title=content.value.title.replace(/，$/,'')+' · QGauss AI';},{immediate:true});
onBeforeUnmount(()=>{alive=false;revision++;controller?.abort();document.title=previousTitle;});
</script>
