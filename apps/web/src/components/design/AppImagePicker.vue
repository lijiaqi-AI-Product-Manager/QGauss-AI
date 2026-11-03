<template>
 <section class="qai-picker" :aria-label="at('自定义应用图片')">
  <div class="qai-picker-head"><AppAvatar :icon="modelValue" private-image/><div><b>{{ at('让它拥有自己的模样') }}</b><p>{{ at('选一张图片，裁出属于它的个性。') }}</p></div><button type="button" :disabled="disabled||busy||!!pending" @click="input?.click()">{{ appImageId(modelValue)?at('更换图片 ↗'):at('上传图片 ＋') }}</button></div>
  <input ref="input" type="file" class="qai-file" accept="image/png,image/jpeg,image/webp" :aria-label="at('上传应用形象')" :disabled="disabled||busy||!!pending" @change="choose"/>
  <p class="qai-hint">{{ at('PNG、JPEG、WebP · 最大 5MB · 图片随应用审核与公开') }}</p>
  <div v-if="pending" class="qai-recovery"><span>{{ at('有一张临时图片，可以先核对保存结果。') }}</span><button type="button" :disabled="disabled||busy" @click="recover">{{ at('核对上次图片') }}</button><button type="button" :disabled="busy" @click="abandon">{{ at('暂不使用') }}</button></div>
  <p v-if="error" class="qai-error" role="alert">{{ at(error) }}</p><p v-if="note" class="qai-note" role="status">{{ at(note) }}</p>
  <dialog ref="dialog" class="qai-dialog" aria-labelledby="qai-crop-title" @cancel.prevent="cancel">
   <header><div><span class="qcs-eyebrow">A FACE FOR YOUR NEXT IDEA</span><h2 id="qai-crop-title">{{ at('给这位搭档，一个新模样。') }}</h2><p>{{ recovered?at('找到原来保存的图片，确认后用于当前草稿。'):at('拖动画面找到主角，用缩放调整大小。') }}</p></div><button type="button" :aria-label="at('关闭图片裁切')" @click="cancel">×</button></header>
   <div class="qai-dialog-body"><div class="qai-crop-wrap"><div class="qai-crop-glow"></div><AppAvatar v-if="recovered" class="qai-recovered" :icon="recovered" private-image/><canvas v-else ref="canvas" width="512" height="512" tabindex="0" role="img" :aria-label="at('应用图片裁切预览，可拖动或使用方向键调整，Shift 加快移动')" @pointerdown="startDrag" @pointermove="drag" @pointerup="stopDrag" @pointercancel="stopDrag" @keydown="moveKey"></canvas><span class="qai-crop-ring" aria-hidden="true"></span><span class="qai-crop-label">YOUR CHARACTER / 512 × 512</span></div>
    <div v-if="!recovered" class="qai-adjust"><label for="qai-zoom">{{ at('靠近一点') }} <output>{{ Number(zoom).toFixed(1) }}×</output></label><input id="qai-zoom" v-model.number="zoom" type="range" min="1" max="4" step="0.05" :disabled="busy" :aria-label="at('图片缩放')"/><button type="button" :disabled="busy" @click="resetCrop">{{ at('回到正中 ↺') }}</button><small>{{ at('方向键可微调位置，按住 Shift 移动更快。') }}</small></div>
    <p v-if="error" class="qai-error" role="alert">{{ at(error) }}</p><BrandLoader v-if="busy" :size="24" :text="at('正在准备这张图片…')"/>
   </div>
   <footer><p>{{ at('只保留裁切后的图片。保存应用前，这张图片仅自己可见。') }}</p><div><button type="button" @click="cancel">{{ at('返回编辑') }}</button><button type="button" class="qai-primary" :disabled="busy||disabled||!bitmap&&!recovered" @click="confirm">{{ busy?at('正在保存…'):recovered?at('使用已保存的图片 ↗'):at('使用这张图片 ↗') }}</button></div></footer>
  </dialog>
 </section>
</template>
<script setup>
import {appText as at} from '../../i18n/index.js';
import {nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {api,uploadAppImage} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {appImageId,appImageCrop,appImageFileProblem,imageRequestKey} from '../../lib/app-image.js';
import AppAvatar from './AppAvatar.vue';
import BrandLoader from './BrandLoader.vue';
import './app-image.css';
const props=defineProps({modelValue:String,disabled:Boolean});const emit=defineEmits(['update:modelValue','busy','editing']);
const auth=useAuth(),input=ref(null),dialog=ref(null),canvas=ref(null),bitmap=ref(null),zoom=ref(1),cx=ref(.5),cy=ref(.5),busy=ref(false),pending=ref(''),recovered=ref(''),error=ref(''),note=ref('');
let source=null,controller,epoch=0,alive=true,dragging=null,intent=null;
const storageKey=()=>`qgauss.app-image.pending.v1:${auth.user?.id||''}`;
function saved(key){try{if(key)sessionStorage.setItem(storageKey(),key);else sessionStorage.removeItem(storageKey());pending.value=key;return true;}catch{error.value='暂时无法保留图片恢复记录，请检查浏览器存储后再试。';return false;}}
function setBusy(value){busy.value=value;emit('busy',value);}
function release(){bitmap.value?.close?.();bitmap.value=null;source=null;intent=null;dragging=null;}
function cancel(){epoch++;controller?.abort();controller=null;setBusy(false);dialog.value?.close();release();recovered.value='';emit('editing',false);}
function abandon(){cancel();saved('');note.value='这张临时图片不会用于应用，稍后会自动清理。';error.value='';}
function crop(){return appImageCrop(bitmap.value.width,bitmap.value.height,Number(zoom.value),cx.value,cy.value);}
function paint(){if(!bitmap.value||!canvas.value)return;const c=crop(),ctx=canvas.value.getContext('2d');ctx.clearRect(0,0,512,512);ctx.drawImage(bitmap.value,c.x,c.y,c.size,c.size,0,0,512,512);}
function resetCrop(){zoom.value=1;cx.value=.5;cy.value=.5;paint();}
async function choose(event){
 const file=event.target.files?.[0];event.target.value='';if(!file||props.disabled||busy.value||pending.value)return;error.value='';note.value='';const problem=appImageFileProblem(file);if(problem){error.value=problem;return;}
 const revision=++epoch;release();let image;
 try{image=await createImageBitmap(file,{imageOrientation:'from-image'});if(!alive||revision!==epoch){image.close();return;}appImageCrop(image.width,image.height);bitmap.value=image;source=file;resetCrop();recovered.value='';emit('editing',true);dialog.value?.showModal();await nextTick();paint();canvas.value?.focus();}
 catch{image?.close?.();if(alive&&revision===epoch){release();error.value='图片无法读取，或超过 1600 万像素，请换一张静态图片。';}}
}
function startDrag(event){if(busy.value||!bitmap.value)return;const c=crop();cx.value=(c.x+c.size/2)/c.width;cy.value=(c.y+c.size/2)/c.height;dragging={x:event.clientX,y:event.clientY,cx:cx.value,cy:cy.value,crop:c,width:canvas.value.getBoundingClientRect().width};canvas.value.setPointerCapture?.(event.pointerId);}
function drag(event){if(!dragging||busy.value)return;const d=dragging;cx.value=Math.max(0,Math.min(1,d.cx-(event.clientX-d.x)*d.crop.size/d.width/d.crop.width));cy.value=Math.max(0,Math.min(1,d.cy-(event.clientY-d.y)*d.crop.size/d.width/d.crop.height));}
function stopDrag(){dragging=null;}
function moveKey(event){if(busy.value||!bitmap.value||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const c=crop(),step=Math.max(1,Math.round(c.size/100))*(event.shiftKey?10:1);cx.value=(c.x+c.size/2+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0))/c.width;cy.value=(c.y+c.size/2+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0))/c.height;}
async function confirm(){
 if(busy.value||props.disabled)return;if(recovered.value){emit('update:modelValue',recovered.value);saved('');cancel();note.value='图片已用于当前草稿，保存应用后生效。';return;}if(!bitmap.value||!source)return;
 if(!intent){intent=Object.freeze({file:source,crop:Object.freeze(crop()),key:crypto.randomUUID()});if(!saved(intent.key)){intent=null;return;}}
 const body=intent,revision=++epoch;controller=new AbortController();setBusy(true);error.value='';
 try{const row=await uploadAppImage(body.file,body.key,body.crop,{signal:controller.signal});if(!alive||revision!==epoch)return;if(!appImageId(row?.icon))throw Error('图片保存结果不完整，请核对原结果。');emit('update:modelValue',row.icon);saved('');cancel();note.value='图片已用于当前草稿，保存应用后生效。';}
 catch(e){if(alive&&revision===epoch){error.value=e.message||'图片保存结果尚未确认。';if(Number.isInteger(e.status)&&e.status>=400&&e.status<500&&e.status!==408){saved('');intent=null;}else{cancel();note.value='图片保存结果尚未确认，请核对上次图片后再使用。';}}}
 finally{if(alive&&revision===epoch)setBusy(false);}
}
async function recover(){
 if(busy.value||props.disabled||!pending.value)return;const key=pending.value,revision=++epoch;controller=new AbortController();setBusy(true);error.value='';
 try{const row=await api.get('/apps/icons/by-request/'+encodeURIComponent(key),{signal:controller.signal,retry:false});if(!alive||revision!==epoch)return;if(!appImageId(row?.icon))throw Error('图片记录不完整，请重新核对。');release();recovered.value=row.icon;emit('editing',true);dialog.value?.showModal();}
 catch(e){if(alive&&revision===epoch)error.value=e.status===404?'暂未找到这张图片。可以稍后核对，或选择暂不使用。':e.message;}
 finally{if(alive&&revision===epoch)setBusy(false);}
}
watch([zoom,cx,cy],()=>{if(!busy.value)paint();});
watch([()=>auth.user?.id,()=>auth.identityRevision],()=>{cancel();error.value='';note.value='';try{pending.value=imageRequestKey(sessionStorage.getItem(storageKey()));}catch{pending.value='';}},{immediate:true});
onBeforeUnmount(()=>{alive=false;cancel();});
</script>
