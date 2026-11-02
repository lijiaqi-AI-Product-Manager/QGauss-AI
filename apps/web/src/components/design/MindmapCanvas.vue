<template>
 <div ref="host" class="qgm-canvas" :class="{'is-drawing':state==='loading','is-empty':!source.trim()}">
  <div class="qgm-canvas-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
  <svg ref="graphic" class="qgm-graph-svg" role="group" aria-label="思维导图画布" :aria-busy="state==='loading'||rendered!==source"></svg>
  <div v-if="state==='loading'" class="qgm-graph-message" role="status"><QLoader :size="34"/><b>正在把想法，轻轻铺开…</b></div>
  <div v-else-if="state==='error'" class="qgm-graph-message is-error" role="alert"><span>↗</span><b>这份大纲还需要整理一下。</b><p>{{ error }}</p><button type="button" @click="schedule">重新绘制</button></div>
  <div v-else-if="!source.trim()" class="qgm-graph-message qgm-graph-empty"><div class="qgm-empty-orbit" aria-hidden="true"><i></i><i></i><b>✳</b></div><h2>给一个想法，<br><mark>长出枝桠的空间。</mark></h2><p>在大纲里写下第一句话，<br>或挑一份灵感起点，看看会发生什么。</p><button type="button" @click="emit('sample')">找一个起点 <span>↗</span></button></div>
 </div>
</template>
<script setup>
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import DOMPurify from 'dompurify';
import QLoader from '../QLoader.vue';
import {useAppearance} from '../../stores/appearance.js';
import {parseMindmap,decorateMindmapMath,portableMindmap} from '../../lib/mindmap-outline.js';
import {renderMath} from '../../lib/rich-renderers.js';
import {captureMindmapLabels} from '../../lib/mindmap-labels.js';
const props=defineProps({source:{type:String,default:''}}),emit=defineEmits(['ready','busy','error','zoom','line','sample']);
const appearance=useAppearance(),host=ref(null),graphic=ref(null),state=ref('loading'),error=ref('');
let alive=true,revision=0,instance,resize,mutation,timer,motionQuery,queue=Promise.resolve(),rendered='',scale=1;
const palettes={studio:['#7b68d5','#b56e8b','#4f9b90','#b18a53','#6c91bd'],play:['#7154d7','#e07b4b','#3a9b79','#d68d29','#4489b5'],orbit:['#a894ff','#75cfcc','#ed9eae','#a0cb77','#99bfff']};
const colors=()=>palettes[appearance.variant]||palettes.studio;
const options=()=>({id:'qg-map-'+crypto.randomUUID().slice(0,8),autoFit:false,embedGlobalCSS:true,duration:!appearance.motion||window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:220,fitRatio:.94,maxInitialScale:1,maxWidth:230,nodeMinHeight:28,paddingX:13,spacingHorizontal:85,spacingVertical:12,initialExpandLevel:-1,scrollForPan:false,zoom:true,pan:true,color:node=>colors()[(node.payload?.qgBranch||0)%colors().length],lineWidth:node=>(node.payload?.qgDepth||0)<2?2:1.3});
const sanitize=html=>DOMPurify.sanitize(html,{USE_PROFILES:{html:true},ADD_ATTR:['data-qg-math','data-display'],FORBID_TAGS:['img','style','script','iframe','audio','video','form','input','button'],FORBID_ATTR:['style','id'],ALLOW_DATA_ATTR:false});
function visit(node,fn){if(!node)return;fn(node);for(const child of node.children||[])visit(child,fn);}
function labelText(html){const template=document.createElement('template');template.innerHTML=html;for(const math of template.content.querySelectorAll('.katex-mathml'))math.remove();return template.content.textContent||'这条线索';}
function zoomChanged(){if(!instance)return;const value=/scale\(\s*([\d.e+-]+)\s*\)/.exec(instance.g.attr('transform')||'');if(value&&Number.isFinite(Number(value[1]))){scale=Number(value[1]);emit('zoom',Math.round(scale*100));}}
function decorate(){if(!instance||!alive)return;const selection=instance.svg.selectAll('g.markmap-node');selection.attr('data-depth',node=>node.payload?.qgDepth||0);selection.select('circle').attr('role','button').attr('tabindex',node=>node.children?.length?0:null).attr('aria-label',node=>labelText(node.content)+'，展开或折叠分支').attr('aria-expanded',node=>node.children?.length?String(!node.payload?.fold):null).on('click',async(event,node)=>{await instance.toggleNode(node,event.ctrlKey||event.metaKey);if(alive)decorate();}).on('keydown.qgauss',async(event,node)=>{if(!['Enter',' '].includes(event.key))return;event.preventDefault();await instance.toggleNode(node);if(alive)decorate();});selection.selectAll('a').attr('target','_blank').attr('rel','noopener noreferrer');selection.select('foreignObject').on('dblclick.qgauss',(event,node)=>{if(!event.target.closest('a'))emit('line',node.payload?.lines?.[0]??0);});}
async function draw(version){
 if(!alive||version!==revision)return;state.value='loading';error.value='';emit('busy',true);
 try{const data=parseMindmap(props.source,sanitize);await decorateMindmapMath(data.root,renderMath,()=>alive&&version===revision);if(!alive||version!==revision)return;
  if(!data.root){mutation?.disconnect();instance?.destroy();instance=null;graphic.value?.replaceChildren();rendered=props.source;state.value='ready';emit('ready',data);return;}
  const {Markmap}=await import('markmap-view');if(!alive||version!==revision)return;
  const folds=new Map();visit(instance?.state.data,node=>{if(node.payload?.fold)folds.set(node.payload.qgKey,node.payload.fold);});visit(data.root,node=>{if(folds.has(node.payload.qgKey))node.payload.fold=folds.get(node.payload.qgKey);});
  if(!instance){instance=new Markmap(graphic.value,options());instance.g.attr('data-qg-root','');mutation=new MutationObserver(zoomChanged);mutation.observe(instance.g.node(),{attributes:true,attributeFilter:['transform']});}
  instance.setOptions({color:options().color,duration:options().duration});await instance.setData(data.root);if(!alive||version!==revision)return;decorate();await instance.fit();if(!alive||version!==revision)return;zoomChanged();rendered=props.source;state.value='ready';emit('ready',data);
 }catch(cause){if(alive&&version===revision){mutation?.disconnect();instance?.destroy();instance=null;graphic.value?.replaceChildren();state.value='error';error.value=cause.message||'画布暂未展开，文字大纲仍然保留。';emit('error',error.value);}}
 finally{if(alive&&version===revision)emit('busy',false);}
}
function schedule(){clearTimeout(timer);const version=++revision;emit('busy',true);timer=setTimeout(()=>{queue=queue.catch(()=>{}).then(()=>draw(version));},180);}
async function fit(){if(instance&&state.value==='ready'){await instance.fit();zoomChanged();}}
async function zoom(factor){if(instance&&state.value==='ready'&&Number.isFinite(factor)&&factor>0){await instance.rescale(factor);zoomChanged();}}
async function originalSize(){await zoom(1/scale);}
async function prepare(){await nextTick();await queue;if(!alive||!instance||state.value!=='ready'||rendered!==props.source)throw Error('请等当前大纲绘制完成后再导出。');const version=revision;await document.fonts?.ready;if(!alive||version!==revision)throw Error('大纲刚有变化，请等绘制完成后再导出。');const duration=instance.options.duration;instance.setOptions({duration:0});try{await instance.renderData();await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));if(alive&&version===revision){decorate();await fit();}}finally{if(alive&&instance)instance.setOptions({duration});}}
async function fold(closed){if(!instance||state.value!=='ready')return;visit(instance.state.data,node=>{if((node.payload?.qgDepth||0)>0)node.payload={...node.payload,fold:closed?1:0};});await instance.renderData();if(alive){decorate();await fit();}}
function snapshot(){if(!instance||state.value!=='ready'||rendered!==props.source)throw Error('请等当前大纲绘制完成后再导出。');const group=instance.g.node(),bounds=group.getBBox();if(!Number.isFinite(bounds.width)||bounds.width<=0||bounds.height<=0)throw Error('画布还没有可导出的内容。');return{svg:graphic.value.cloneNode(true),labels:captureMindmapLabels(graphic.value,group),bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},data:portableMindmap(instance.state.data),source:rendered};}
defineExpose({fit,zoom,originalSize,fold,prepare,snapshot});
watch(()=>props.source,schedule);
function syncAppearance(){queue=queue.catch(()=>{}).then(async()=>{if(!alive||!instance)return;const value=options();instance.setOptions({color:value.color,duration:value.duration});await instance.renderData();if(alive)decorate();});}
watch([()=>appearance.variant,()=>appearance.motion],syncAppearance);
onMounted(async()=>{await nextTick();if(!alive||!host.value||!graphic.value)return;motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');motionQuery.addEventListener?.('change',syncAppearance);resize=new ResizeObserver(()=>{if(instance&&state.value==='ready')void fit();});resize.observe(host.value);resize.observe(graphic.value);schedule();});
onBeforeUnmount(()=>{alive=false;revision++;clearTimeout(timer);motionQuery?.removeEventListener?.('change',syncAppearance);resize?.disconnect();mutation?.disconnect();instance?.destroy();});
</script>
