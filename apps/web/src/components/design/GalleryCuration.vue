<template>
  <section v-if="auth.isAdmin" class="qga-curation" aria-label="作品推荐管理">
    <strong>给好想法，多一点遇见。</strong>
    <p>推荐会优先展示这份公开作品，作品归属与费用保持不变。</p>
    <p v-if="message" :role="error?'alert':'status'">{{ message }}</p>
    <button v-if="!pending" type="button" :disabled="busy" @click="save(!work.featured)">{{ work.featured?'取消推荐':'设为推荐作品' }}</button>
    <template v-else><button type="button" :disabled="busy" @click="check">{{ busy?'正在核对…':'核对推荐状态' }}</button><button v-if="checked" type="button" :disabled="busy" @click="save(pending.featured)">再次确认{{ pending.featured?'推荐':'取消推荐' }}</button><button type="button" :disabled="busy" @click="remember(null)">结束等待</button></template>
  </section>
</template>
<script setup>
import {onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
const props=defineProps({work:{type:Object,required:true}}),emit=defineEmits(['updated']),auth=useAuth(),busy=ref(false),pending=ref(null),checked=ref(false),message=ref(''),error=ref(false);
const owner=auth.user?.id,identity=auth.identityRevision,key=()=>`qg:curation:${owner}:${props.work.key}`,base=()=>'/gallery/works/'+props.work.kind+'/'+encodeURIComponent(props.work.id);
let alive=true,revision=0,request;
const current=version=>alive&&auth.isLoggedIn&&auth.isAdmin&&auth.user?.id===owner&&auth.identityRevision===identity&&version===revision;
function remember(value){pending.value=value;checked.value=false;try{value?sessionStorage.setItem(key(),JSON.stringify(value)):sessionStorage.removeItem(key());}catch{message.value='请在本页核对推荐回执后再离开。';}}
async function save(featured){if(busy.value||!current(revision)||typeof featured!=='boolean')return;const version=++revision;remember({key:props.work.key,featured});busy.value=true;message.value='';error.value=false;request?.abort();request=new AbortController();try{const value=await api.put(base()+'/feature',{featured},{signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)]),retry:false});if(!current(version))return;if(value.key!==props.work.key||value.featured!==featured)throw Error('推荐回执尚未确认。');remember(null);emit('updated',value);message.value=featured?'这份作品已加入推荐。':'已取消推荐，仍可在公开作品中浏览。';}catch(cause){if(current(version)){error.value=true;message.value=cause.status===403?'当前账户无法管理推荐，请重新核对账户权限。':'推荐结果尚未确认，请先核对原作品，不会自动重发。';}}finally{if(current(version))busy.value=false;}}
async function check(){if(busy.value||!pending.value||!current(revision))return;const version=++revision;busy.value=true;message.value='';error.value=false;request?.abort();request=new AbortController();try{const value=await api.get(base(),{signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)]),retry:false});if(!current(version))return;if(value.key!==props.work.key||typeof value.featured!=='boolean')throw Error('作品状态尚未确认。');emit('updated',{key:value.key,featured:value.featured});if(value.featured===pending.value.featured){remember(null);message.value='已找回推荐结果，没有重复执行。';}else{checked.value=true;message.value='当前状态与原设置不同，可以再次明确确认。';}}catch(cause){if(current(version)){error.value=true;message.value=cause.status===404?'作品已撤回或不可用，请回到作品广场。':'暂时无法核对推荐状态，请稍后重试。';}}finally{if(current(version))busy.value=false;}}
onBeforeRouteLeave(()=>!busy.value);
watch([()=>auth.user?.id,()=>auth.identityRevision],()=>{revision++;request?.abort();busy.value=false;pending.value=null;});
onMounted(()=>{try{const value=JSON.parse(sessionStorage.getItem(key())||'null');if(value?.key===props.work.key&&typeof value.featured==='boolean'){pending.value=value;void check();}}catch{/* No content is stored with the receipt. */}});
onBeforeUnmount(()=>{alive=false;revision++;request?.abort();});
</script>
<style>
.qga-curation{padding:17px;margin-top:18px;border:1px solid var(--qd-edge);border-radius:16px;background:color-mix(in srgb,var(--qd-brand) 6%,var(--qd-panel))}.qga-curation strong{font-size:12px}.qga-curation p{font-size:11px;line-height:1.8;color:var(--qd-muted)}.qga-curation button{font:inherit;font-size:11px;min-height:48px;padding:10px 13px;border-radius:12px;border:1px solid var(--qd-edge);background:var(--qd-panel);color:var(--qd-ink);margin:4px 6px 0 0;cursor:pointer}.qga-curation button:disabled{opacity:.5;cursor:not-allowed}.qga-curation :focus-visible{outline:3px solid var(--qd-brand);outline-offset:3px}
</style>
