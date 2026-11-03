<template>
 <div class="qcs-page qar-page"><header class="qcs-hero"><div><span class="qcs-eyebrow">QGAUSS / GOOD IDEAS DESERVE A STAGE</span><h1>让好角色，<br><mark>被更多人遇见。</mark></h1><p>看看它如何介绍自己、怎样帮助别人。每一次公开，都先经过认真核对。</p><router-link to="/apps">看看应用广场 ↗</router-link> <router-link to="/settings">设置首次通过奖励 ↗</router-link></div><div class="qcs-sculpture" aria-hidden="true"><i></i><span>✦</span><b>A LITTLE REVIEW.<br>A BETTER CREATIVE WORLD.</b><em>↗</em></div></header>
  <p v-if="storageNotice" class="qcs-hint" role="status">{{ storageNotice }}</p><p v-if="error" class="qcs-error" role="alert">{{ error }}</p><p v-if="note" class="qcs-note" role="status">{{ note }}</p><div v-if="uncertain" class="qcs-recovery" role="status"><p>有一份审核的结果尚未确认。核对完成后，再做下一次决定。</p><button type="button" :disabled="busy" @click="checkDecision()">核对原审核结果 ↗</button></div><div class="qar-workspace"><section class="qcs-card qar-queue" aria-label="应用审核队列"><header><h2 ref="deskHeading" tabindex="-1">等一个认真回应</h2><button type="button" :disabled="loading||busy" @click="refresh">刷新 ↻</button></header><div class="qcs-tabs"><button v-for="item in statuses" :key="item.key" type="button" :aria-pressed="status===item.key" :disabled="busy" @click="filter(item.key)">{{ item.title }}</button></div><BrandLoader v-if="loading" text="正在整理审核小队…"/><p v-else-if="loadError" class="qcs-error" role="alert">{{ loadError }}</p><p v-else-if="!rows.length" class="qcs-empty">这一页暂时没有需要查看的应用。</p><button v-for="row in rows" :key="row.id" type="button" class="qar-row" :aria-pressed="detail?.id===row.id" :disabled="busy" @click="open(row)"><AppAvatar :icon="row.icon" :app-id="row.id"/><div><b>{{ row.name }}</b><p>{{ row.description||'还没有一句话介绍' }}</p><small>{{ row.owner?.displayName||row.owner?.username||'创作伙伴' }} · {{ creatorState(row) }}</small></div><i>↗</i></button><nav class="qar-pager" aria-label="审核分页"><button type="button" :disabled="page<=1||loading||busy" @click="page--;load()">上一页</button><span>{{ total }} 份 · 第 {{ page }} 页</span><button type="button" :disabled="page*pageSize>=total||loading||busy" @click="page++;load()">下一页</button></nav></section>
   <section class="qcs-card qar-detail" aria-label="应用审核内容"><BrandLoader v-if="detailLoading" text="正在打开角色档案…"/><p v-else-if="!detail" class="qcs-empty">从左边选一位搭档，看看它的设定。</p><template v-else><header><span class="qar-detail-icon"><AppAvatar :icon="detail.icon" :app-id="detail.id" @state="imageState=$event"/></span><div><span class="qcs-eyebrow">A CHARACTER, A LITTLE CLOSER</span><h2 ref="detailHeading" tabindex="-1">{{ detail.name }}</h2><p>{{ creatorState(detail) }} · 第 {{ detail.version }} 版</p></div></header><p v-if="appImageId(detail.icon)&&imageState==='error'" class="qcs-error" role="alert">图片暂时无法读取，请重新打开档案核对；完整查看后再确认公开。</p><p>{{ detail.description }}</p><dl><div><dt>创作者</dt><dd>{{ detail.owner?.displayName||detail.owner?.username||'创作伙伴' }}</dd></div><div><dt>默认模型</dt><dd>{{ detail.defaultModel||'在对话时选择' }}</dd></div></dl><h3>它的第一句招呼</h3><blockquote>{{ detail.greeting||'未设置开场白' }}</blockquote><label>角色设定<textarea :value="detail.systemPrompt" readonly aria-label="待审核角色设定" rows="10"/></label><p class="qcs-hint">这段设定供审核查看，不在公开详情直接展示。审核不会自动发起模型对话。</p><section class="qar-reward"><b>{{ detail.rewardOffer?.alreadyGranted?'首次通过奖励已处理':'本次通过后的首次鼓励' }}</b><p>{{ creatorReward(detail.rewardOffer) }}</p><small>{{ detail.rewardOffer?.alreadyGranted?'重新审核不会再次赠送。':'确认通过时按这份结果赠送；设置变化会要求重新核对。' }}</small></section><label>给创作者的反馈<textarea v-model="reviewNote" aria-label="应用审核反馈" maxlength="500" rows="3" :disabled="busy" placeholder="指出具体问题，或留一句鼓励。退回时请说明原因。"/></label><div class="qar-actions"><template v-if="detail.reviewStatus==='PENDING'"><button type="button" :disabled="busy||!!uncertain" @click="reviewKind='REJECT';confirmation.showModal()">退回打磨</button><button type="button" class="qcs-primary" :disabled="busy||!!uncertain||!!appImageId(detail.icon)&&imageState!=='ready'" @click="reviewKind='APPROVE';confirmation.showModal()">让它进入广场 ↗</button></template><button v-if="detail.reviewStatus==='APPROVED'" type="button" :disabled="busy||!!uncertain" @click="reviewKind='UNPUBLISH';confirmation.showModal()">停止公开并退回作者</button></div></template></section>
  </div>
  <dialog ref="confirmation" class="qcs-dialog" aria-labelledby="qar-confirm-title" @cancel.prevent="!busy&&confirmation.close()"><span class="qcs-eyebrow">ONE CLEAR DECISION</span><h2 id="qar-confirm-title">{{ reviewKind==='APPROVE'?'让这位搭档，走上广场？':reviewKind==='REJECT'?'把建议，交给创作者？':'先让这位搭档，回到作者身边？' }}</h2><p>{{ detail?.name }}</p><p>{{ reviewKind==='APPROVE'?creatorReward(detail?.rewardOffer):reviewKind==='REJECT'?'退回后作者可以继续修改。请先在反馈中说明原因。':'公开展示、分享入口和新提问会停止开放；已有对话保留。' }}</p><p v-if="error" class="qcs-error" role="alert">{{ error }}</p><div><button type="button" :disabled="busy" @click="confirmation.close()">返回核对</button><button type="button" class="qcs-primary" :disabled="busy" @click="decide"><BrandLoader v-if="busy" :size="20"/>{{ busy?'正在保存决定…':'确认这次决定 ↗' }}</button></div></dialog>
 <dialog ref="recoveryDialog" class="qcs-dialog" aria-labelledby="qar-recovery-title" @cancel.prevent="!busy&&recoveryDialog.close()"><h2 id="qar-recovery-title">核对，并结束这次等待？</h2><p>已完成的审核会保留原结果。尚未执行的审核会明确结束，不会在稍后突然公开应用或发放奖励。</p><div><button type="button" :disabled="busy" @click="recoveryDialog.close()">返回核对</button><button type="button" class="qcs-primary" :disabled="busy" @click="reconcileDecision">{{ busy?'正在核对…':'核对并结束等待 ↗' }}</button></div></dialog>
 <dialog ref="discardDialog" class="qcs-dialog" aria-labelledby="qar-discard-title" @cancel.prevent="finishDiscard(false)"><h2 id="qar-discard-title">这份反馈，还没有保存。</h2><p>留下继续核对，或放弃尚未提交的反馈。</p><div><button type="button" @click="finishDiscard(false)">继续核对</button><button type="button" @click="finishDiscard(true)">放弃反馈</button></div></dialog>
 </div>
</template>
<script setup>
import AppAvatar from './AppAvatar.vue';
import {appImageId} from '../../lib/app-image.js';
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {creatorState,creatorReward,creatorPendingAction,creatorResolution} from '../../lib/app-creator.js';
import BrandLoader from './BrandLoader.vue';
import './app-creator.css';

const imageState=ref('idle');
const auth=useAuth(),rows=ref([]),total=ref(0),page=ref(1),pageSize=15,status=ref('PENDING'),loading=ref(false),loadError=ref(''),detail=ref(null),detailLoading=ref(false),reviewNote=ref(''),error=ref(''),note=ref(''),busy=ref(false),confirmation=ref(null),reviewKind=ref(''),uncertain=ref(null),recoveryDialog=ref(null),discardDialog=ref(null),deskHeading=ref(null),detailHeading=ref(null),storageNotice=ref('');
const statuses=[{key:'PENDING',title:'等待审核'},{key:'APPROVED',title:'已经公开'},{key:'REJECTED',title:'退回打磨'}],dirty=computed(()=>!!reviewNote.value.trim());
let alive=true,epoch=0,listVersion=0,detailVersion=0,discardResolve;
const controllers=new Set(),stamp=()=>({id:auth.user?.id,revision:auth.identityRevision,epoch}),current=s=>alive&&auth.isAdmin&&s.id===auth.user?.id&&s.revision===auth.identityRevision&&s.epoch===epoch;
const storageKey=()=>`qg:app-review:${auth.user?.id}`;
function remember(value){uncertain.value=creatorPendingAction(value);try{if(uncertain.value)sessionStorage.setItem(storageKey(),JSON.stringify(uncertain.value));else sessionStorage.removeItem(storageKey());storageNotice.value='';}catch{storageNotice.value='临时核对记录未能保留，请在本页确认结果后再离开。';}}
async function rpc(method,url,body){const c=new AbortController();controllers.add(c);try{return await api[method](url,...(method==='get'?[{signal:c.signal,retry:false}]:[body,{signal:c.signal,retry:false}]));}finally{controllers.delete(c);}}
function valid(row){if(!row||typeof row.id!=='string'||!Number.isInteger(row.version)||typeof row.systemPrompt!=='string')throw Error('审核档案不完整，请重新打开。');return row;}
async function focusDesk(){await nextTick();if(alive)(detailHeading.value||deskHeading.value)?.focus({preventScroll:true});}
function finishDiscard(value){discardDialog.value?.close();const resolve=discardResolve;discardResolve=null;resolve?.(value);}
function mayDiscard(){if(!dirty.value)return Promise.resolve(true);if(discardResolve)return Promise.resolve(false);return new Promise(resolve=>{discardResolve=resolve;discardDialog.value?.showModal();});}
function clearDetail(){detailVersion++;detail.value=null;reviewNote.value='';detailLoading.value=false;}
function protectFeedback(event){if(dirty.value||busy.value){event.preventDefault();event.returnValue='';}}
async function refresh(){
 if(busy.value)return;const s=stamp(),id=detail.value?.id;busy.value=true;error.value='';
 try{await load();if(id){const row=await rpc('get','/apps/admin/review/'+encodeURIComponent(id));if(current(s)&&detail.value?.id===id){detail.value=valid(row);note.value='已重新核对角色与奖励，未提交反馈仍保留。';await focusDesk();}}}
 catch(e){if(current(s)){error.value=e.message;if(e.status===404)clearDetail();}}
 finally{if(current(s))busy.value=false;}
}
async function load(){if(!auth.isAdmin)return;const s=stamp(),v=++listVersion;loading.value=true;loadError.value='';try{const row=await rpc('get',`/apps/admin/review?status=${status.value}&page=${page.value}&pageSize=${pageSize}`);if(current(s)&&v===listVersion){rows.value=Array.isArray(row.items)?row.items:[];total.value=row.total;}}catch(e){if(current(s)&&v===listVersion)loadError.value=e.message;}finally{if(current(s)&&v===listVersion)loading.value=false;}}
async function filter(next){if(busy.value||status.value===next||!await mayDiscard())return;clearDetail();status.value=next;page.value=1;await load();}
async function open(row){if(busy.value||!await mayDiscard())return;clearDetail();const s=stamp(),v=detailVersion;detailLoading.value=true;error.value='';note.value='';try{const data=await rpc('get','/apps/admin/review/'+encodeURIComponent(row.id));if(current(s)&&v===detailVersion){detail.value=valid(data);await focusDesk();}}catch(e){if(current(s)&&v===detailVersion)error.value=e.message;}finally{if(current(s)&&v===detailVersion)detailLoading.value=false;}}
async function decide(){
 if(busy.value||uncertain.value||!detail.value)return;
 if(reviewKind.value==='APPROVE'&&appImageId(detail.value?.icon)&&imageState.value!=='ready'){error.value='请先完整查看应用图片，再确认公开。';return;}
 if(reviewKind.value!=='APPROVE'&&!reviewNote.value.trim()){error.value='先写下具体反馈，让作者知道下一步。';confirmation.value?.close();return;}
 const s=stamp(),row=detail.value,requestKey=crypto.randomUUID(),pending={id:row.id,version:row.version,requestKey,kind:'REVIEW'};
 remember(pending);busy.value=true;error.value='';
 try{const saved=await rpc('post','/apps/admin/review/'+encodeURIComponent(row.id),{version:row.version,requestKey,decision:reviewKind.value,note:reviewNote.value,...(reviewKind.value==='APPROVE'?{offerRevision:row.rewardOffer?.revision}:{})});if(!current(s))return;detail.value=valid(saved);remember(null);reviewNote.value='';confirmation.value?.close();note.value='这次审核决定已保存。';await load();await focusDesk();}
 catch(e){if(current(s)){error.value=e.message;confirmation.value?.close();if(Number.isInteger(e.status)&&e.status>=400&&e.status<500&&e.status!==408)remember(null);else note.value='结果尚未确认，请先核对原审核；不会自动再次审核。';await focusDesk();}}
 finally{if(current(s))busy.value=false;}
}
async function acceptRecovered(row){valid(row);if(detail.value?.id!==row.id&&dirty.value&&!await mayDiscard())return;detail.value=row;reviewNote.value='';await focusDesk();}
async function checkDecision({auto=false}={}){
 if(busy.value||!uncertain.value)return;const s=stamp(),pending={...uncertain.value};busy.value=true;error.value='';
 try{const row=valid(await rpc('get','/apps/admin/review/'+encodeURIComponent(pending.id)));if(!current(s))return;const resolution=creatorResolution(row,pending);
  if(resolution==='waiting'){note.value='原审核尚未确认。可以继续核对，或结束这次等待。';if(!auto)recoveryDialog.value?.showModal();return;}
  remember(null);recoveryDialog.value?.close();await acceptRecovered(row);note.value=resolution==='applied'?'已找回原审核结果，没有再次执行或赠送。':resolution==='not-applied'?'原审核未执行，已结束等待。':'已读取当前状态，没有重复审核。';await load();
 }catch(e){if(current(s)){error.value=e.message;if(e.status===404){remember(null);if(detail.value?.id===pending.id)clearDetail();note.value='这份应用已离开可审核范围，没有重复执行。';}await focusDesk();}}
 finally{if(current(s))busy.value=false;}
}
async function reconcileDecision(){
 if(busy.value||!uncertain.value)return;const s=stamp(),pending={...uncertain.value};busy.value=true;error.value='';
 try{const result=await rpc('post','/apps/admin/review/'+encodeURIComponent(pending.id)+'/reconcile',{version:pending.version,requestKey:pending.requestKey});if(!current(s))return;valid(result.app);remember(null);recoveryDialog.value?.close();await acceptRecovered(result.app);note.value=result.resolution==='applied'?'已找回原审核结果，没有再次赠送。':result.resolution==='not-applied'?'原审核未执行，已结束等待。可以重新核对后做决定。':'已读取最新档案，没有重复审核。';await load();}
 catch(e){if(current(s)){error.value=e.message;recoveryDialog.value?.close();if(e.status===404){remember(null);if(detail.value?.id===pending.id)clearDetail();}await focusDesk();}}
 finally{if(current(s))busy.value=false;}
}
async function bootstrap(){if(!auth.isAdmin)return;try{const pending=creatorPendingAction(JSON.parse(sessionStorage.getItem(storageKey())||'null'));uncertain.value=pending?.kind==='REVIEW'?pending:null;}catch{}await load();if(alive&&auth.isAdmin&&uncertain.value)await checkDecision({auto:true});}
watch([()=>auth.user?.id,()=>auth.identityRevision,()=>auth.isAdmin],()=>{epoch++;listVersion++;for(const c of controllers)c.abort();controllers.clear();rows.value=[];total.value=0;page.value=1;status.value='PENDING';clearDetail();uncertain.value=null;storageNotice.value='';error.value='';note.value='';confirmation.value?.close();recoveryDialog.value?.close();finishDiscard(false);busy.value=false;loading.value=false;if(auth.isAdmin)bootstrap();});
onBeforeRouteLeave(()=>busy.value?false:mayDiscard());onMounted(()=>{window.addEventListener('beforeunload',protectFeedback);void bootstrap();});onBeforeUnmount(()=>{window.removeEventListener('beforeunload',protectFeedback);alive=false;epoch++;for(const c of controllers)c.abort();controllers.clear();finishDiscard(false);});

</script>
