<template>
 <div class="qcs-page">
  <header class="qcs-hero"><div><span class="qcs-eyebrow">QGAUSS / YOUR OWN LITTLE CREW</span><h1>把你的擅长，<br><mark>变成一位好搭档。</mark></h1><p>写下角色的专长与工作方式。先放进自己的空间，准备好后，再邀请更多人遇见它。</p><router-link to="/apps">去应用广场逛逛 ↗</router-link></div><div class="qcs-sculpture" aria-hidden="true"><i></i><AppAvatar :icon="draft.icon" private-image/><b>ONE IDEA.<br>ITS OWN PERSONALITY.</b><em>✦</em></div></header>
  <div class="qcs-workspace">
   <aside class="qcs-shelf" aria-label="我的创建"><div class="qcs-shelf-head"><h2>我的小队 <b>{{ counts.active }}</b></h2><button type="button" aria-label="创建新应用" @click="choose(null)">＋</button></div><div class="qcs-tabs"><button type="button" :aria-pressed="view==='active'" @click="changeView('active')">我的创建</button><button type="button" :aria-pressed="view==='trash'" @click="changeView('trash')">回收站 {{ counts.trash||'' }}</button></div><BrandLoader v-if="loading" text="正在取回你的小队…"/><p v-else-if="loadError" class="qcs-error" role="alert">{{ loadError }}<button type="button" @click="load">重新读取</button></p><p v-else-if="!items.length" class="qcs-empty">{{ view==='trash'?'回收站里还没有搭档。':'还没有自己的搭档。写下第一份角色设定吧。' }}</p><div v-else class="qcs-shelf-items"><button v-for="app in items" :key="app.id" type="button" class="qcs-mini" :aria-pressed="selected?.id===app.id" @click="choose(app)"><AppAvatar :icon="app.icon" private-image/><div><b>{{ app.name }}</b><small>{{ creatorState(app) }}</small></div><i>↗</i></button></div><button type="button" class="qcs-refresh" :disabled="loading" @click="refresh">刷新我的创建 ↻</button></aside>
   <div class="qcs-desk">
    <div v-if="pendingCreate" class="qcs-recovery" role="status"><b>上一份保存结果还未确认。</b><p>先找回原来的保存记录，避免再创建一份。</p><button type="button" :disabled="locked" @click="checkCreated">核对原保存结果</button><button v-if="!selected" type="button" :disabled="locked||(!createBody&&!!problem)" @click="openCreateRecovery">继续原保存</button></div>
    <div v-if="pendingAction" class="qcs-recovery" role="status"><b>有一步操作，还需要核对。</b><p>先读回原记录；尚未执行的操作也可以明确结束，不会重复提交。</p><button type="button" :disabled="locked" @click="checkAction()">核对原操作</button></div>
    <div class="qcs-heading"><div><span class="qcs-eyebrow">THE CHARACTER DESK</span><h2 ref="deskHeading" tabindex="-1">{{ selected?'照顾好这位搭档':'一位新搭档，正在成形。' }}</h2></div><span class="qcs-status" :data-state="selected?.reviewStatus">{{ selected?creatorState(selected):'尚未保存' }}</span></div>
    <BrandLoader v-if="locked||booting" :size="26" :text="writing?'正在保存这一步…':'正在打开搭档档案…'"/>
    <p v-if="storageNotice" class="qcs-note" role="status">{{ storageNotice }}</p>
    <p v-if="note" class="qcs-note" role="status">{{ note }}</p><p v-if="error" class="qcs-error" role="alert">{{ error }}</p>
    <div class="qcs-editor-grid">
     <form class="qcs-card qcs-editor" @submit.prevent="save"><fieldset :disabled="busy||booting||!editable"><legend class="qcs-sr">应用内容</legend><label>搭档的名字<input v-model="draft.name" aria-label="自建应用名称" maxlength="64" placeholder="例如：把复杂事情讲简单的朋友"/></label><label>一句话介绍<textarea v-model="draft.description" aria-label="自建应用介绍" maxlength="240" rows="2" placeholder="它最擅长什么，会为谁带来帮助？"/></label><div class="qcs-icons" role="group" aria-label="应用形象"><button v-for="icon in CREATOR_ICONS" :key="icon" type="button" :aria-label="'使用形象 '+icon" :aria-pressed="draft.icon===icon" @click="draft.icon=icon">{{ icon }}</button></div><AppImagePicker :key="imageEpoch" v-model="draft.icon" :disabled="busy||booting||!editable" @busy="imageBusy=$event" @editing="imageDirty=$event"/><label>角色设定 <small>{{ draft.systemPrompt.length }} / 8000</small><textarea v-model="draft.systemPrompt" aria-label="自建应用角色设定" maxlength="8000" rows="9" placeholder="你是一位……你的目标是……请按这些方式工作……"/></label><p class="qcs-hint">角色设定会交给你选择的模型；公开详情不直接展示这段内容。</p><label>第一句招呼<textarea v-model="draft.greeting" aria-label="自建应用开场白" maxlength="1000" rows="3" placeholder="嗨，今天想一起解决什么？"/></label><div class="qcs-pair"><label>模型<select v-model="draft.defaultModel" aria-label="自建应用默认模型"><option value="">每次对话时选择</option><option v-if="draft.defaultModel&&!models.some(m=>m.name===draft.defaultModel)" :value="draft.defaultModel">原模型暂不可用</option><option v-for="model in models" :key="model.name" :value="model.name">{{ model.displayName||model.name }}{{ model.ready?'':' · 暂未接入' }}</option></select></label><label>擅长的方向<select v-model="draft.categoryId" aria-label="自建应用分类"><option value="">先不分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label></div></fieldset><p v-if="problem&&dirty" class="qcs-hint" role="status">{{ problem }}</p><div class="qcs-save-line"><span>{{ editable?selected?dirty?'有尚未保存的修改':'已与保存记录同步':dirty?'有尚未保存的草稿':'从名字和角色设定开始。':selected?.deletedAt?'恢复到我的创建，再继续编辑。':'先撤回审核或公开，再编辑这份内容。' }}</span><button v-if="editable" type="submit" class="qcs-primary" :disabled="locked||booting||!!problem||!dirty||(!selected&&!!pendingCreate)||!!pendingAction"><BrandLoader v-if="saving" :size="20"/>{{ saving?'正在保存…':selected?'保存修改':'保存为私有应用' }}<span v-if="!saving">↗</span></button></div></form>
     <aside class="qcs-preview-column"><section class="qcs-card qcs-preview"><span class="qcs-eyebrow">A FIRST HELLO / LIVE PREVIEW</span><div class="qcs-preview-icon"><AppAvatar :icon="draft.icon" private-image/></div><h3>{{ draft.name.trim()||'这位搭档，还在等一个名字。' }}</h3><p>{{ draft.description.trim()||'一点擅长，也能成为一份帮助。' }}</p><blockquote>{{ draft.greeting.trim()||'嗨，很高兴认识你。我们从哪里开始？' }}</blockquote><small>这是介绍预览，尚未发起模型对话。</small></section><section v-if="selected" class="qcs-card qcs-actions"><h3>下一小步</h3><button v-if="!selected.deletedAt" type="button" :disabled="locked||booting||dirty||!!pendingAction" @click="launch">去聊聊 ↗</button><button v-if="editable&&selected&&!selected.deletedAt" type="button" class="qcs-primary" :disabled="locked||booting||dirty||!!pendingAction" @click="reviewDialog?.showModal()">提交到应用广场 ✦</button><button v-if="['PENDING','APPROVED'].includes(selected.reviewStatus)&&!selected.deletedAt" type="button" :disabled="locked||booting||!!pendingAction" @click="requestAction('withdraw')">{{ selected.published?'撤回公开，继续打磨':'撤回审核，继续编辑' }}</button><button v-if="selected.published&&selected.reviewStatus==='APPROVED'" type="button" @click="copyShare">复制应用分享链接 ↗</button><button v-if="!selected.deletedAt" type="button" :disabled="locked||booting||!!pendingAction" @click="duplicate">复制成一位新搭档</button><button v-if="editable&&selected&&!selected.deletedAt" type="button" :disabled="locked||booting||dirty||!!pendingAction" @click="requestAction('trash')">放入回收站</button><button v-if="selected.deletedAt" type="button" :disabled="locked||booting||!!pendingAction" @click="requestAction('restore')">恢复为私有应用 ↗</button></section><section v-if="selected?.reviewNote" class="qcs-card qcs-review-note"><span class="qcs-eyebrow">A NOTE FOR YOUR NEXT DRAFT</span><h3>审核反馈</h3><p>{{ selected.reviewNote }}</p></section><section v-if="selected?.rewardGrantedAt" class="qcs-card"><h3>第一次被看见的鼓励</h3><p>{{ creatorReward({counts:selected.reward}) }}</p></section></aside>
    </div>
   </div>
  </div>
  <dialog ref="reviewDialog" class="qcs-dialog" aria-labelledby="qcs-submit-title" @cancel.prevent="!locked&&reviewDialog.close()"><span class="qcs-eyebrow">LET A GOOD IDEA MEET MORE PEOPLE</span><h2 id="qcs-submit-title">准备把它，介绍给更多人？</h2><p>提交后内容会暂时锁定。审核通过后，应用介绍会进入广场；角色设定只供后台审核，不在公开详情直接展示。</p><p>你也可以主动撤回，继续打磨。</p><div><button type="button" :disabled="locked" @click="reviewDialog.close()">再看看</button><button type="button" class="qcs-primary" :disabled="locked" @click="action('submit')">确认提交审核 ↗</button></div></dialog>
  <dialog ref="actionDialog" class="qcs-dialog" aria-labelledby="qcs-action-title" @cancel.prevent="!locked&&actionDialog.close()"><h2 id="qcs-action-title">{{ wantedAction==='trash'?'把这位搭档，暂时收起来？':wantedAction==='restore'?'让这位搭档，回到你的空间？':'先收回这份公开邀请？' }}</h2><p>{{ wantedAction==='trash'?'它会进入你的回收站，可以恢复。已有对话会保留。':wantedAction==='restore'?'恢复后仅自己可用，公开展示需要重新审核。':'撤回后，其他人不能再从广场、分享链接或新提问中使用它。已接受的生成和历史对话会按原规则保留。' }}</p><div><button type="button" :disabled="locked" @click="actionDialog.close()">再想一想</button><button type="button" class="qcs-primary" :disabled="locked" @click="action(wantedAction)">确认这一步 ↗</button></div></dialog>
  <dialog ref="recoveryDialog" class="qcs-dialog" aria-labelledby="qcs-recovery-title" @cancel.prevent="!locked&&recoveryDialog.close()"><h2 id="qcs-recovery-title">{{ recoveryKind==='create'?'继续上一份保存？':'核对，并结束这次等待？' }}</h2><p>{{ recoveryKind==='create'?'会继续同一份保存，不会重新创建第二位搭档。已有记录会先被取回。':'已经完成的操作会保留结果；尚未执行的操作会明确结束，不会在稍后突然生效。' }}</p><p v-if="recoveryKind==='create'&&!createBody">本页已重新打开，请先重新核对当前草稿。</p><div><button type="button" :disabled="locked" @click="recoveryDialog.close()">返回核对</button><button type="button" class="qcs-primary" :disabled="locked" @click="recoveryKind==='create'?retryCreate():reconcileAction()">{{ locked?'正在核对…':recoveryKind==='create'?'继续原保存 ↗':'核对并结束等待 ↗' }}</button></div></dialog>
  <dialog ref="discardDialog" class="qcs-dialog" aria-labelledby="qcs-discard-title" @cancel.prevent="finishDiscard(false)"><h2 id="qcs-discard-title">还有修改，没来得及保存。</h2><p>留下继续编辑，或放弃这份未保存的修改。</p><div><button type="button" @click="finishDiscard(false)">继续编辑</button><button type="button" @click="finishDiscard(true)">放弃修改</button></div></dialog>
 </div>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue';
import {onBeforeRouteLeave,useRouter} from 'vue-router';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {CREATOR_ICONS,creatorState,creatorEditable,creatorDraft,creatorPayload,creatorProblem,creatorReward,creatorShareUrl,creatorPendingAction,creatorResolution,creatorActionNote} from '../../lib/app-creator.js';
import AppAvatar from './AppAvatar.vue';
import AppImagePicker from './AppImagePicker.vue';
import BrandLoader from './BrandLoader.vue';
import './app-creator.css';

const auth=useAuth(),router=useRouter();
const imageBusy=ref(false),imageDirty=ref(false),imageEpoch=ref(0);
const locked=computed(()=>busy.value||imageBusy.value);
const items=ref([]),models=ref([]),categories=ref([]),counts=reactive({active:0,trash:0}),view=ref('active');
const selected=ref(null),draft=reactive(creatorDraft()),baseline=ref(JSON.stringify(creatorDraft()));
const loading=ref(false),booting=ref(false),saving=ref(false),writing=ref(false),busy=ref(false),loadError=ref(''),error=ref(''),note=ref(''),storageNotice=ref('');
const pendingCreate=ref(''),createBody=ref(null),pendingAction=ref(null);
const reviewDialog=ref(null),actionDialog=ref(null),discardDialog=ref(null),recoveryDialog=ref(null),recoveryKind=ref(''),wantedAction=ref(''),deskHeading=ref(null);
const dirty=computed(()=>imageDirty.value||JSON.stringify(draft)!==baseline.value),editable=computed(()=>creatorEditable(selected.value)),problem=computed(()=>imageDirty.value?'请先确认或取消图片裁切。':creatorProblem(draft));
let alive=true,epoch=0,loadEpoch=0,discardResolve;
const controllers=new Set(),owner=()=>auth.user?.id,stamp=()=>({id:owner(),revision:auth.identityRevision,epoch});
const current=s=>alive&&s.id===owner()&&s.revision===auth.identityRevision&&s.epoch===epoch;
const key=()=>crypto.randomUUID(),storageKey=kind=>`qg:app-${kind}:${owner()}`;
function remember(kind,value){try{if(value)sessionStorage.setItem(storageKey(kind),kind==='create'?value:JSON.stringify(value));else sessionStorage.removeItem(storageKey(kind));storageNotice.value='';}catch{storageNotice.value='临时恢复记录未能保留，请在本页核对结果后再离开。';}}
function rememberCreate(value){pendingCreate.value=value;remember('create',value);}
function rememberAction(value){pendingAction.value=creatorPendingAction(value);remember('action',pendingAction.value);}
async function rpc(method,url,body){const controller=new AbortController();controllers.add(controller);try{return await api[method](url,...(method==='get'?[{signal:controller.signal,retry:false}]:[body,{signal:controller.signal,retry:false}]));}finally{controllers.delete(controller);}}
function validRow(row){if(!row||typeof row.id!=='string'||!Number.isInteger(row.version)||row.version<1||typeof row.systemPrompt!=='string')throw Error('搭档资料不完整，请重新读取。');return row;}
function matchesDraft(row){return !imageDirty.value&&JSON.stringify(creatorPayload(draft))===JSON.stringify(creatorPayload(creatorDraft(row)));}
function apply(row,keepDraft=false){if(row!==null)validRow(row);selected.value=row;if(!keepDraft){imageEpoch.value++;imageDirty.value=false;Object.assign(draft,creatorDraft(row));}baseline.value=JSON.stringify(creatorDraft(row));error.value='';note.value='';}
function finishDiscard(value){discardDialog.value?.close();const resolve=discardResolve;discardResolve=null;resolve?.(value);}
function mayDiscard(){if(!dirty.value)return Promise.resolve(true);if(discardResolve)return Promise.resolve(false);return new Promise(resolve=>{discardResolve=resolve;discardDialog.value?.showModal();});}
function closeDialogs(){reviewDialog.value?.close();actionDialog.value?.close();recoveryDialog.value?.close();}
function protectDraft(event){if(dirty.value||writing.value){event.preventDefault();event.returnValue='';}}
async function focusDesk(){await nextTick();if(alive)deskHeading.value?.focus({preventScroll:true});}
const rejected=e=>Number.isInteger(e.status)&&e.status>=400&&e.status<500&&e.status!==408;

async function load(){const s=stamp(),id=++loadEpoch;loading.value=true;loadError.value='';try{const row=await rpc('get','/apps/mine?view='+view.value);if(current(s)&&id===loadEpoch){items.value=Array.isArray(row.items)?row.items:[];Object.assign(counts,row.counts);}}catch(e){if(current(s)&&id===loadEpoch)loadError.value=e.message;}finally{if(current(s)&&id===loadEpoch)loading.value=false;}}
async function choose(row){
 if(locked.value||booting.value||!await mayDiscard())return;
 if(!row){const wasTrash=view.value==='trash';view.value='active';apply(null);if(wasTrash)await load();await focusDesk();return;}
 const s=stamp();busy.value=true;error.value='';
 try{const full=await rpc('get','/apps/mine/'+encodeURIComponent(row.id));if(current(s)){apply(full);await focusDesk();}}catch(e){if(current(s))error.value=e.message;}finally{if(current(s))busy.value=false;}
}
async function changeView(next){if(locked.value||booting.value||next===view.value||!await mayDiscard())return;view.value=next;apply(null);await load();}
async function refresh(){
 if(locked.value||booting.value)return;const s=stamp(),id=selected.value?.id;busy.value=true;
 try{await load();if(id){const row=await rpc('get','/apps/mine/'+encodeURIComponent(id));if(current(s)&&selected.value?.id===id){const keep=dirty.value&&!matchesDraft(row);apply(row,keep);note.value=keep?'已读取最新档案，未保存草稿仍保留。':'已读取最新档案。';}}}catch(e){if(current(s))error.value=e.message;}finally{if(current(s))busy.value=false;}
}
async function acceptRecovered(row){
 validRow(row);
 if(selected.value&&selected.value.id!==row.id&&dirty.value&&!await mayDiscard()){note.value='原记录已找到，可以在我的小队中打开。';return;}
 const keep=(!selected.value||selected.value.id===row.id)&&dirty.value&&!matchesDraft(row);
 view.value=row.deletedAt?'trash':'active';apply(row,keep);note.value=keep?'已找回原记录，未保存草稿仍保留。':'已找回原来的保存记录。';await focusDesk();
}
async function sendCreate(body,fresh){
 const s=stamp();busy.value=true;writing.value=true;saving.value=true;error.value='';createBody.value=Object.freeze({...body});rememberCreate(body.requestKey);
 try{const row=await rpc('post','/apps/mine',body);if(!current(s))return;const keep=dirty.value&&!matchesDraft(row);apply(row,keep);rememberCreate('');createBody.value=null;closeDialogs();view.value='active';note.value=keep?'保存已完成，未保存草稿仍保留。':'已保存，这位搭档现在只属于你。';await load();await focusDesk();}
 catch(e){if(current(s)){error.value=e.message;closeDialogs();if(fresh&&rejected(e)){rememberCreate('');createBody.value=null;}else note.value='保存结果尚未确认，请核对原记录，或继续同一份保存。';await focusDesk();}}
 finally{if(current(s)){busy.value=false;writing.value=false;saving.value=false;}}
}
async function save(){
 if(locked.value||booting.value||!editable.value||problem.value||!dirty.value||pendingAction.value)return;
 if(!selected.value){if(pendingCreate.value)return;await sendCreate({...creatorPayload(draft),requestKey:key()},true);return;}
 const s=stamp(),row=selected.value,body={...creatorPayload(draft),version:row.version,requestKey:key()};rememberAction({id:row.id,version:row.version,requestKey:body.requestKey,kind:'UPDATE'});busy.value=true;writing.value=true;saving.value=true;error.value='';
 try{const saved=await rpc('put','/apps/mine/'+encodeURIComponent(row.id),body);if(!current(s))return;apply(saved);rememberAction(null);note.value='修改已保存。';await load();await focusDesk();}
 catch(e){if(current(s)){error.value=e.message;if(rejected(e))rememberAction(null);else note.value='保存结果尚未确认，请先核对原操作。';await focusDesk();}}
 finally{if(current(s)){busy.value=false;writing.value=false;saving.value=false;}}
}
async function checkCreated(){
 if(locked.value||!pendingCreate.value)return;const s=stamp();busy.value=true;error.value='';
 try{const row=await rpc('get','/apps/mine/by-request/'+encodeURIComponent(pendingCreate.value));if(!current(s))return;validRow(row);rememberCreate('');createBody.value=null;await acceptRecovered(row);await load();}
 catch(e){if(current(s)){error.value=e.status===404?'暂未找到原保存记录，可以继续原保存。':e.message;}}
 finally{if(current(s))busy.value=false;}
}
function openCreateRecovery(){if(locked.value||selected.value||!pendingCreate.value||(!createBody.value&&problem.value))return;recoveryKind.value='create';recoveryDialog.value?.showModal();}
async function retryCreate(){
 if(locked.value||!pendingCreate.value||selected.value)return;const body=createBody.value||{...creatorPayload(draft),requestKey:pendingCreate.value};if(!createBody.value&&problem.value)return;
 const s=stamp();busy.value=true;error.value='';let found;
 try{found=await rpc('get','/apps/mine/by-request/'+encodeURIComponent(pendingCreate.value));}
 catch(e){if(!current(s))return;if(e.status!==404){error.value=e.message;closeDialogs();return;}}
 finally{if(current(s))busy.value=false;}
 if(!current(s))return;if(found){validRow(found);rememberCreate('');createBody.value=null;closeDialogs();await acceptRecovered(found);await load();return;}await sendCreate(body,false);
}
function requestAction(kind){if(locked.value||pendingAction.value)return;wantedAction.value=kind;actionDialog.value?.showModal();}
async function action(kind){
 if(locked.value||pendingAction.value||!selected.value)return;const s=stamp(),row=selected.value,body={version:row.version,requestKey:key()};if(['submit','trash'].includes(kind)&&dirty.value)return;rememberAction({id:row.id,...body,kind:kind.toUpperCase()});busy.value=true;writing.value=true;error.value='';
 try{const saved=await rpc('post','/apps/mine/'+encodeURIComponent(row.id)+'/'+kind,body);if(!current(s))return;const keep=dirty.value&&!matchesDraft(saved);apply(saved,keep);rememberAction(null);closeDialogs();view.value=saved.deletedAt?'trash':'active';note.value=creatorActionNote(kind.toUpperCase())+(keep?' 未保存草稿仍保留。':'');await load();await focusDesk();}
 catch(e){if(current(s)){error.value=e.message;closeDialogs();if(rejected(e))rememberAction(null);else note.value='结果尚未确认，请先核对原操作；不会自动重复提交。';await focusDesk();}}
 finally{if(current(s)){busy.value=false;writing.value=false;}}
}
async function checkAction({auto=false}={}){
 if(locked.value||!pendingAction.value)return;const s=stamp(),pending={...pendingAction.value};busy.value=true;error.value='';
 try{const row=await rpc('get','/apps/mine/'+encodeURIComponent(pending.id));if(!current(s))return;validRow(row);const resolution=creatorResolution(row,pending);
  if(resolution==='waiting'){note.value='原操作尚未确认。可以继续核对，或结束这次等待。';if(!auto){closeDialogs();recoveryKind.value='action';recoveryDialog.value?.showModal();}return;}
  rememberAction(null);closeDialogs();await acceptRecovered(row);note.value=resolution==='applied'?creatorActionNote(pending.kind):resolution==='not-applied'?'原操作未执行，已结束等待。':'已读取当前状态，没有重复执行原操作。';await load();
 }catch(e){if(current(s)){error.value=e.message;if(e.status===404){rememberAction(null);note.value='原记录当前不可用，没有重复执行这一步。';}}}finally{if(current(s))busy.value=false;}
}
async function reconcileAction(){
 if(locked.value||!pendingAction.value)return;const s=stamp(),pending={...pendingAction.value};busy.value=true;writing.value=true;error.value='';
 try{const result=await rpc('post','/apps/mine/'+encodeURIComponent(pending.id)+'/reconcile',{version:pending.version,requestKey:pending.requestKey});if(!current(s))return;validRow(result.app);rememberAction(null);closeDialogs();await acceptRecovered(result.app);note.value=result.resolution==='applied'?creatorActionNote(pending.kind):result.resolution==='not-applied'?'原操作尚未执行，已结束等待。可以重新选择下一步。':'已读取当前状态，没有重复执行原操作。';await load();}
 catch(e){if(current(s)){error.value=e.message;closeDialogs();if(e.status===404)rememberAction(null);await focusDesk();}}
 finally{if(current(s)){busy.value=false;writing.value=false;}}
}
async function duplicate(){if(locked.value||pendingAction.value||!selected.value||!await mayDiscard())return;const copy=creatorDraft(selected.value);apply(null);view.value='active';Object.assign(draft,copy,{name:(copy.name+' · 新版本').slice(0,64)});note.value='这是尚未保存的新草稿。';await focusDesk();}
function launch(){if(!selected.value||dirty.value||locked.value||pendingAction.value||selected.value.deletedAt)return;router.push({path:'/chat',query:{app:selected.value.id}});}
async function copyShare(){const url=creatorShareUrl(selected.value,location.origin);if(!url)return;const s=stamp();try{await navigator.clipboard.writeText(url);if(current(s))note.value='分享链接已复制。撤回公开后，这个链接会停止开放。';}catch{if(current(s))error.value='暂时无法复制，请检查浏览器的剪贴板设置。';}}
async function bootstrap(){
 const s=stamp();booting.value=true;
 try{try{const saved=sessionStorage.getItem(storageKey('create'));pendingCreate.value=typeof saved==='string'&&/^[a-f\d-]{36}$/i.test(saved)?saved:'';pendingAction.value=creatorPendingAction(JSON.parse(sessionStorage.getItem(storageKey('action'))||'null'));}catch{}
  await Promise.allSettled([load(),rpc('get','/models/available').then(rows=>{if(current(s))models.value=(Array.isArray(rows)?rows:[]).filter(m=>String(m.capabilities||'chat').split(',').map(value=>value.trim()).some(value=>['chat','vision','reasoning','tools'].includes(value)));}),rpc('get','/apps/categories').then(rows=>{if(current(s))categories.value=Array.isArray(rows)?rows:[];})]);
  if(current(s)&&pendingAction.value)await checkAction({auto:true});if(current(s)&&pendingCreate.value)await checkCreated();
 }finally{if(current(s))booting.value=false;}
}
watch([()=>auth.user?.id,()=>auth.identityRevision],()=>{epoch++;loadEpoch++;for(const controller of controllers)controller.abort();controllers.clear();finishDiscard(false);closeDialogs();items.value=[];models.value=[];categories.value=[];Object.assign(counts,{active:0,trash:0});view.value='active';busy.value=false;writing.value=false;saving.value=false;loading.value=false;booting.value=false;pendingCreate.value='';createBody.value=null;pendingAction.value=null;storageNotice.value='';apply(null);if(auth.isLoggedIn)bootstrap();});
onBeforeRouteLeave(()=>writing.value||imageBusy.value?false:mayDiscard());onMounted(()=>{window.addEventListener('beforeunload',protectDraft);void bootstrap();});onBeforeUnmount(()=>{window.removeEventListener('beforeunload',protectDraft);alive=false;epoch++;for(const controller of controllers)controller.abort();controllers.clear();finishDiscard(false);});

</script>
