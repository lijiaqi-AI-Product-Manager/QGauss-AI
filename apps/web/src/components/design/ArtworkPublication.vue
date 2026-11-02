<template>
  <section class="qga-publication" aria-label="作品公开确认" :aria-busy="busy">
    <strong ref="heading" tabindex="-1">{{ desired?'让这份灵感，被更多人遇见。':'让这份作品，回到自己的空间。' }}</strong>
    <p>{{ desired?'公开后，站内用户可浏览、保存作品，并复制公开的文字与设定。私有参考素材、原始任务身份和费用回执不会公开。':'撤回后，新的作品与媒体读取会停止。已保存到其他设备的内容无法远程收回。' }}</p>
    <label v-if="desired">风格分类<select v-model="category" aria-label="公开作品分类" :disabled="busy||!identityValid"><option value="">暂不分类</option><option v-if="category&&!categories.some(row=>row.id===category)" :value="category" disabled>原分类已停用，请重新选择</option><option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option></select></label>
    <p v-if="message" :role="error?'alert':'status'">{{ message }}</p>
    <div><button v-if="satisfied" type="button" :disabled="busy||!identityValid" @click="finish">完成，回到作品</button><button v-else type="button" :disabled="busy||!identityValid||invalidCategory||unknown&&!checked" @click="submit(desired)">{{ busy?'正在核对回执…':checked?'再次确认'+(desired?'公开':'不公开'):'确认'+(desired?'公开':'撤回') }}</button><button v-if="attempted" type="button" :disabled="busy||!identityValid" @click="check">核对公开状态</button><button v-if="attempted&&desired" type="button" :disabled="busy||!identityValid" @click="submit(false)">明确设为不公开</button><button type="button" :disabled="busy||!identityValid" @click="emit('cancel')">{{ unknown?'稍后再核对':'保留现状' }}</button></div>
  </section>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
const props=defineProps({kind:{type:String,required:true},work:{type:Object,required:true},categories:{type:Array,default:()=>[]}}),emit=defineEmits(['updated','cancel']);
const auth=useAuth(),desired=ref(!props.work.published),category=ref(props.work.catId||''),busy=ref(false),attempted=ref(false),unknown=ref(false),checked=ref(false),satisfied=ref(false),message=ref(''),error=ref(false);
const invalidCategory=computed(()=>desired.value&&!!category.value&&!props.categories.some(row=>row.id===category.value));
const heading=ref(null);
const boundUser=auth.user?.id,boundIdentity=auth.identityRevision,identityValid=computed(()=>auth.isLoggedIn&&auth.user?.id===boundUser&&auth.identityRevision===boundIdentity);
let alive=true,epoch=0,request;
const key=()=>`qg:publication:${auth.user?.id}:${props.kind}:${props.work.id}`,base=()=>'/'+props.kind+'/tasks/'+encodeURIComponent(props.work.id),stamp=()=>({user:auth.user?.id,identity:auth.identityRevision,epoch,id:props.work.id});
const current=s=>alive&&auth.isLoggedIn&&s.user===auth.user?.id&&s.identity===auth.identityRevision&&s.epoch===epoch&&s.id===props.work.id;
function remember(value){try{value?sessionStorage.setItem(key(),JSON.stringify(value)):sessionStorage.removeItem(key());}catch{message.value='本页可以继续核对回执，请核对完成后再离开。';}}
function metadata(value){if(!value||value.id&&value.id!==props.work.id||typeof value.published!=='boolean')throw Error('公开结果尚未确认，请核对原作品。');return{id:props.work.id,published:value.published,...Object.fromEntries(['catId','publishedAt','updatedAt'].filter(field=>Object.hasOwn(value,field)).map(field=>[field,value[field]]))};}
function payload(value){return{published:value,...(value&&category.value!==(props.work.catId||'')?{catId:category.value}:{}),...(typeof props.work.updatedAt==='string'?{expectedUpdatedAt:props.work.updatedAt}:{})};}
async function submit(value){
 if(!identityValid.value||busy.value||!['image','mj','video'].includes(props.kind)||!props.work.mine||value&&invalidCategory.value)return;
 const s=stamp(),body=payload(value);desired.value=value;attempted.value=true;unknown.value=false;checked.value=false;satisfied.value=false;message.value='';error.value=false;remember(body);busy.value=true;request?.abort();request=new AbortController();
 try{const result=metadata(await api.patch(base()+'/publish',body,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)]),retry:false}));if(!current(s))return;if(result.published!==value||value&&Object.hasOwn(result,'catId')&&category.value!==(result.catId||''))throw Error('公开状态与回执不一致，请先核对原作品。');remember(null);satisfied.value=true;emit('updated',result);message.value=value?'作品已公开，原费用回执保持不变。':'作品已设为不公开，早先的公开确认不会覆盖这次撤回。';}
 catch(cause){if(!current(s))return;unknown.value=true;error.value=true;message.value=cause.status===409?'作品状态已变化，请先核对原作品，再决定是否继续。':'这次设置的结果还未确认，请先核对公开状态；不会自动重发。';}
 finally{if(current(s))busy.value=false;}
}
async function check(){
 if(!identityValid.value||busy.value)return;const s=stamp();busy.value=true;message.value='';error.value=false;request?.abort();request=new AbortController();
 try{const result=metadata(await api.get(base(),{signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)]),retry:false}));if(!current(s))return;emit('updated',result);checked.value=true;satisfied.value=result.published===desired.value&&(!desired.value||!Object.hasOwn(result,'catId')||category.value===(result.catId||''));
  if(satisfied.value){remember(null);unknown.value=false;message.value=result.published?'目前作品已公开，没有重复提交。':'目前作品未公开，没有重新提交设置。';}else message.value='已找回当前状态。本次目标尚未生效，可以再次明确确认，或保留现状。';
 }catch(cause){if(current(s)){error.value=true;unknown.value=true;message.value=cause.status===404?'原作品已被移除或当前不可用。请回到作品列表核对。':'暂未读取到当前状态，请稍后再核对。';}}
 finally{if(current(s))busy.value=false;}
}
function finish(){if(satisfied.value)remember(null);emit('cancel');}
function beforeUnload(event){if(busy.value){event.preventDefault();event.returnValue='';}}
onBeforeRouteLeave(()=>{if(busy.value){message.value='正在核对这次设置，请等待回执后再离开。';return false;}return true;});
watch([()=>auth.user?.id,()=>auth.identityRevision],()=>{epoch++;request?.abort();busy.value=false;message.value='账户已变化，请重新打开作品后再确认。';error.value=true;unknown.value=true;});
onMounted(()=>{window.addEventListener('beforeunload',beforeUnload);void nextTick(()=>{if(alive)heading.value?.focus();});try{const value=JSON.parse(sessionStorage.getItem(key())||'null');if(value&&typeof value.published==='boolean'){desired.value=value.published;if(typeof value.catId==='string')category.value=value.catId;attempted.value=unknown.value=true;void check();}}catch{/* Current status remains readable without stored intent. */}});
onBeforeUnmount(()=>{alive=false;epoch++;request?.abort();window.removeEventListener('beforeunload',beforeUnload);});
</script>
<style>
.qga-publication{padding:18px;border:1px solid color-mix(in srgb,var(--qd-brand) 26%,var(--qd-edge));border-radius:17px;background:color-mix(in srgb,var(--qd-brand) 6%,var(--qd-panel));color:var(--qd-ink);margin:15px 0}.qga-publication>strong{display:block;font-size:13px;line-height:1.8}.qga-publication>p{font-size:11px;line-height:1.9;color:var(--qd-muted);margin:11px 0}.qga-publication>label{display:grid;gap:9px;font-size:11px;margin:15px 0}.qga-publication select{width:100%;min-height:48px;background:var(--qd-panel);border:1px solid var(--qd-edge);border-radius:12px;color:var(--qd-ink);font:inherit;padding:10px 13px}.qga-publication>div{display:flex;gap:9px;flex-wrap:wrap}.qga-publication button{min-height:48px;border:1px solid var(--qd-edge);background:var(--qd-panel);color:var(--qd-ink);padding:10px 14px;border-radius:12px;font:inherit;font-size:11px;cursor:pointer}.qga-publication button:first-child{background:var(--qd-brand);color:var(--qd-on-brand);border-color:transparent}.qga-publication button:disabled{opacity:.5;cursor:not-allowed}.qga-publication :focus-visible{outline:3px solid var(--qd-brand);outline-offset:3px}@media(max-width:600px){.qga-publication{padding:16px;border-radius:15px}.qga-publication select{font-size:16px}.qga-publication button{font-size:11px}.qga-publication>p{font-size:11px}}
</style>
