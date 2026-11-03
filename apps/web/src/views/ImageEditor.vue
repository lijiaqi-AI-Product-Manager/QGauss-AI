<template>
 <section class="qge-page" :data-variant="appearance.variant" aria-labelledby="qge-title">
  <header class="qge-heading"><div class="qge-heading-mark" aria-hidden="true"><i></i><span>✳</span></div><div><span class="qge-eyebrow">QGAUSS / A LITTLE CHANGE, A NEW POSSIBILITY</span><h1 id="qge-title">留住喜欢的，<em>重画一点。</em></h1><p>选一块颜色，或自由画出想改变的区域。</p></div><div class="qge-heading-actions"><button type="button" :disabled="locked" @click="fileInput?.click()"><ClientIcon name="plus"/>打开图片</button><button type="button" :disabled="locked" @click="openExample">试试小花园 ↗</button></div><input ref="fileInput" class="qge-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="选择要编辑的图片" @change="fileChanged"/></header>
  <div v-if="state.error" class="qge-notice is-error" role="alert">{{ state.error }}<button v-if="state.selecting" type="button" @click="stopSelection">停止选择</button></div><div v-else-if="state.notice" class="qge-notice" role="status">{{ state.notice }}</div>
  <div class="qge-workspace">
   <aside class="qge-tools" aria-label="选区工具"><span class="qge-eyebrow">MAKE ROOM FOR SOMETHING NEW</span><h2>让这里，<em>有点不一样。</em></h2><div class="qge-tool-body"><div class="qge-tool-switch" role="group" aria-label="选择方式"><button type="button" :aria-pressed="state.tool==='region'" :disabled="locked" @click="state.tool='region'"><span>✦</span><b>颜色选区</b><small>点一下，选中相邻颜色</small></button><button type="button" :aria-pressed="state.tool==='brush'" :disabled="locked" @click="state.tool='brush'"><ClientIcon name="palette"/><b>自由涂抹</b><small>画出你想改变的部分</small></button></div>
    <fieldset :disabled="locked"><legend>选区操作</legend><div class="qge-operation"><button type="button" :aria-pressed="!state.erase" @click="state.erase=false">＋ 添加</button><button type="button" :aria-pressed="state.erase" @click="state.erase=true">− 擦除</button></div><label v-if="state.tool==='region'">相似颜色范围 <b>{{ state.tolerance }}</b><input v-model.number="state.tolerance" aria-label="颜色容差" type="range" min="0" max="300" step="5"/><small>范围越大，能一起选中的相邻颜色越多。</small></label><label v-else>画笔大小 <b>{{ state.brush }} px</b><input v-model.number="state.brush" aria-label="画笔大小" type="range" min="2" max="256" step="2"/><small>按住并拖动，粉色部分就是重绘区域。</small></label></fieldset></div>
    <div class="qge-history"><button type="button" :disabled="locked||!state.canUndo" @click="undo"><ClientIcon name="undo"/>撤销</button><button type="button" :disabled="locked||!state.canRedo" @click="redo">重做 ↗</button><button type="button" :disabled="locked||!state.selected" @click="clearSelection"><ClientIcon name="trash"/>清空选区</button></div><div class="qge-tool-note"><i aria-hidden="true">✳</i><p>切换工具会保留选区。<br/>本地打开与编辑不会发起生成或扣费。</p></div>
   </aside>
   <section class="qge-canvas-panel" aria-label="图像编辑画布"><header><div><span class="qge-status-dot" :class="{busy:locked}"></span><b>{{ state.loading?'正在展开画面':state.selecting?'正在寻找相邻颜色':state.ready?state.sourceName:'你的下一张小作品' }}</b></div><span>{{ state.ready?state.width+' × '+state.height:'PNG · JPEG · WebP · 静态 GIF' }}</span></header>
    <div ref="viewport" class="qge-stage" :class="{'is-pan':state.panMode,'is-erase':state.erase,'is-locked':locked}" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerCancel" @lostpointercapture="lostPointer" @wheel="wheel">
     <div v-if="state.ready" class="qge-picture" :style="pictureStyle"><canvas ref="baseCanvas" :width="state.width" :height="state.height" aria-hidden="true"></canvas><canvas ref="overlayCanvas" :width="state.width" :height="state.height" tabindex="0" role="img" aria-label="图像选区画布，方向键移动位置，回车选择；双指可缩放和平移" @keydown="keyboard"></canvas><span v-if="state.keyboard" class="qge-keyboard-cursor" :style="{left:cursor.x+'px',top:cursor.y+'px',width:state.brush+'px',height:state.brush+'px'}" aria-hidden="true"></span></div>
     <div v-if="!state.ready&&!state.loading" class="qge-empty"><div class="qge-empty-art" aria-hidden="true"><i></i><i></i><span>✦</span></div><h2>想改变的，<br/><em>由你来圈定。</em></h2><p>打开一张图片，从一点新想法开始。<br/>图片最多 10 MB、800 万像素。</p><button type="button" @click="fileInput?.click()">打开我的图片 ＋</button></div>
     <div v-if="state.loading||state.selecting||state.exporting||state.sending" class="qge-progress" role="status"><QLoader :size="38"/><b>{{ state.loading?'正在展开画面…':state.selecting?'正在选择相邻颜色…':state.exporting?'正在保存选区…':'正在准备绘画设定…' }}</b><span v-if="state.selecting">{{ state.progress }}%</span><button v-if="state.selecting" type="button" @click="stopSelection">停止这次选择</button></div>
    </div><footer class="qge-canvas-tools"><div><button type="button" :aria-pressed="state.panMode" :disabled="!state.ready||locked" @click="state.panMode=!state.panMode">{{ state.panMode?'移动画布':'画选区' }}</button><span v-if="state.ready">{{ state.selected.toLocaleString() }} 个像素 · {{ selectedPercent }}%</span></div><div><button type="button" aria-label="缩小画布" :disabled="!state.ready" @click="setZoom(state.zoom/1.25)">−</button><button type="button" :disabled="!state.ready" @click="setZoom(1)">{{ Math.round(state.zoom*100) }}%</button><button type="button" aria-label="放大画布" :disabled="!state.ready" @click="setZoom(state.zoom*1.25)">＋</button><button type="button" :disabled="!state.ready" @click="fit">适应画面</button></div></footer>
   </section>
   <aside class="qge-preview-panel" aria-label="选区预览与导出"><div class="qge-preview-body"><header><span class="qge-eyebrow">A LITTLE PREVIEW</span><h2>新的可能，<em>在这里。</em></h2></header><div class="qge-preview-image"><canvas v-show="state.ready" ref="previewCanvas" aria-label="白色是重绘区域，黑色是保留区域"></canvas><span v-if="!state.ready">✳</span></div><p>白色重新想象，黑色作为保留参考。导出会保留原图尺寸。</p><label class="qge-export-label">保存方式<select v-model="state.format" :disabled="locked" aria-label="选区导出方式"><option value="selection">黑白选区图</option><option value="transparent">透明蒙版</option></select></label><button type="button" class="qge-export" :disabled="!state.ready||locked" @click="download">{{ state.exporting?'正在保存…':'保存选区 PNG ↗' }}</button><label class="qge-prompt">想让这里变成什么？<textarea v-model="state.prompt" maxlength="4000" rows="3" placeholder="例如：把这盆绿植换成一束柔粉色郁金香，保留原来的光影…" :disabled="locked"></textarea></label></div><div class="qge-preview-footer"><button type="button" class="qge-send" :disabled="!state.ready||locked" @click="sendToPainting">{{ state.sending?'正在准备…':state.selected&&state.selected<state.width*state.height?'带入局部重绘 ↗':'用整图作为参考 ↗' }}</button><small>先带入图片与描述，在绘画页确认模型和费用后再生成。</small></div>
   </aside>
  </div>
  <dialog ref="confirmDialog" class="qge-confirm" aria-labelledby="qge-confirm-title" @cancel.prevent="decide(false)"><span class="qge-eyebrow">KEEP A LITTLE ROOM FOR YOUR IDEAS</span><h2 id="qge-confirm-title">这份编辑，<em>还没留好。</em></h2><p>离开或换图会放下当前选区和描述。PNG 只保留选区，想一起保留描述，可以先带入绘画。</p><div><button type="button" @click="decide(false)">留在这里</button><button type="button" @click="decide(true)">放下这份选区</button></div></dialog>
 </section>
</template>

<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue';
import {onBeforeRouteLeave,onBeforeRouteUpdate,useRoute,useRouter} from 'vue-router';
import {useAuth} from '../stores/auth.js';
import {useAppearance} from '../stores/appearance.js';
import {api,fetchBlob,uploadFile} from '../api/client.js';
import ClientIcon from '../components/reference/ClientIcon.vue';
import QLoader from '../components/QLoader.vue';
import {selectionDimensions,selectionPoint,contiguousSelection,selectionLayer,selectionStroke,combineSelection,selectionCount,packSelection,restoreSelection,selectionPixels,readSelectionAlpha,selectionHistory} from '../lib/image-selection.js';
import {saveImageEditorTransfer,readImageEditorTransfer} from '../lib/image-editor-transfer.js';
import {decodeEditorImage} from '../lib/image-editor-image.js';
import '../components/design/image-editor.css';

const auth=useAuth(),appearance=useAppearance(),route=useRoute(),router=useRouter(),owner=auth.user?.id,identity=auth.identityRevision;
const fileInput=ref(null),viewport=ref(null),baseCanvas=ref(null),overlayCanvas=ref(null),previewCanvas=ref(null),confirmDialog=ref(null);
const state=reactive({ready:false,loading:false,selecting:false,exporting:false,sending:false,progress:0,width:1,height:1,sourceName:'',sourceId:null,maskId:null,tool:'region',erase:false,tolerance:50,brush:64,panMode:false,zoom:1,panX:0,panY:0,selected:0,canUndo:false,canRedo:false,keyboard:false,prompt:'',format:'selection',revision:0,savedRevision:0,savedPrompt:'',error:'',notice:''});
const cursor=reactive({x:0,y:0}),locked=computed(()=>state.loading||state.selecting||state.exporting||state.sending),dirty=computed(()=>state.ready&&(state.revision!==state.savedRevision||state.prompt.trim()!==state.savedPrompt.trim())),selectedPercent=computed(()=>state.ready?(state.selected/(state.width*state.height)*100).toFixed(1):'0.0');
const pictureStyle=computed(()=>({width:state.width+'px',height:state.height+'px',transform:`translate(-50%,-50%) translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`}));
let alive=true,sourceVersion=0,sourceFile=null,pixels=null,layer=null,history=null,returnDraft=null,frame=0,observer,selectionController,requestController,decision,gesture=null,pan=null,stroke=null,regionClick=null,ignorePointers=false;
const pointers=new Map(),timers=new Map();
const current=()=>alive&&auth.isLoggedIn&&auth.user?.id===owner&&auth.identityRevision===identity;
const valid=version=>current()&&version===sourceVersion;
function toolsChanged(){state.canUndo=!!history?.canUndo;state.canRedo=!!history?.canRedo;state.selected=layer?selectionCount(layer.mask):0;}
function drawOverlay(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const context=overlayCanvas.value?.getContext('2d');if(context&&layer&&state.ready)context.putImageData(new ImageData(layer.rgba,state.width,state.height),0,0);});}
function drawPreview(){if(!layer||!previewCanvas.value)return;const ratio=Math.min(1,384/Math.max(state.width,state.height)),width=Math.max(1,Math.round(state.width*ratio)),height=Math.max(1,Math.round(state.height*ratio)),canvas=previewCanvas.value;canvas.width=width;canvas.height=height;const context=canvas.getContext('2d'),data=context.createImageData(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const source=Math.min(state.height-1,Math.floor((y+.5)/height*state.height))*state.width+Math.min(state.width-1,Math.floor((x+.5)/width*state.width)),p=(y*width+x)*4,value=layer.mask[source]?255:0;data.data[p]=data.data[p+1]=data.data[p+2]=value;data.data[p+3]=255;}context.putImageData(data,0,0);}
function changed(){state.revision++;state.maskId=null;state.notice='';state.error='';toolsChanged();drawOverlay();drawPreview();}
function fit(){if(!state.ready||!viewport.value)return;const rect=viewport.value.getBoundingClientRect();state.zoom=Math.max(.02,Math.min(1,(rect.width-48)/state.width,(rect.height-48)/state.height));state.panX=state.panY=0;}
function setZoom(value){state.zoom=Math.max(.02,Math.min(8,value));}
function wheel(event){if(!state.ready||!event.ctrlKey&&!event.metaKey&&!state.panMode)return;event.preventDefault();setZoom(state.zoom*Math.exp(-event.deltaY*.002));}
function point(event){const rect=overlayCanvas.value?.getBoundingClientRect();if(!rect||event.clientX<rect.left||event.clientY<rect.top||event.clientX>rect.right||event.clientY>rect.bottom)return null;return selectionPoint(event.clientX,event.clientY,rect,state.width,state.height);}
function cancelDraft(){if(stroke?.before&&layer){restoreSelection(layer,stroke.before);toolsChanged();drawOverlay();}stroke=null;regionClick=null;}
function releasePointer(event){pointers.delete(event.pointerId);if(viewport.value?.hasPointerCapture(event.pointerId))viewport.value.releasePointerCapture(event.pointerId);}
function pointerDown(event){
 if(!state.ready||locked.value||event.button!==0&&event.button!==1)return;state.keyboard=false;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});viewport.value?.setPointerCapture(event.pointerId);
 if(pointers.size===2){cancelDraft();pan=null;const[a,b]=[...pointers.values()],rect=viewport.value.getBoundingClientRect(),center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};gesture={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:state.zoom,worldX:(center.x-rect.left-rect.width/2-state.panX)/state.zoom,worldY:(center.y-rect.top-rect.height/2-state.panY)/state.zoom};ignorePointers=true;return;}
 if(ignorePointers)return;if(state.panMode||event.button===1){pan={id:event.pointerId,x:event.clientX,y:event.clientY,panX:state.panX,panY:state.panY};return;}
 const p=point(event);if(!p)return;overlayCanvas.value?.focus({preventScroll:true});cursor.x=p.x;cursor.y=p.y;
 if(state.tool==='region'){regionClick={id:event.pointerId,point:p,x:event.clientX,y:event.clientY};return;}
 stroke={id:event.pointerId,last:p,before:packSelection(layer.mask)};selectionStroke(layer,p,p,state.brush,state.erase);drawOverlay();
}
function pointerMove(event){
 if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
 if(gesture&&pointers.size>=2){const[a,b]=[...pointers.values()],rect=viewport.value.getBoundingClientRect(),x=(a.x+b.x)/2,y=(a.y+b.y)/2;setZoom(gesture.zoom*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance);state.panX=x-rect.left-rect.width/2-gesture.worldX*state.zoom;state.panY=y-rect.top-rect.height/2-gesture.worldY*state.zoom;return;}
 if(pan?.id===event.pointerId){state.panX=pan.panX+event.clientX-pan.x;state.panY=pan.panY+event.clientY-pan.y;return;}
 if(regionClick?.id===event.pointerId&&Math.hypot(event.clientX-regionClick.x,event.clientY-regionClick.y)>6)regionClick=null;
 if(stroke?.id!==event.pointerId)return;const p=point(event);if(!p){stroke.last=null;return;}selectionStroke(layer,stroke.last||p,p,state.brush,state.erase);stroke.last=p;drawOverlay();
}
function pointerUp(event){
 if(stroke?.id===event.pointerId){history.pushPacked(stroke.before);stroke=null;changed();}
 const click=regionClick?.id===event.pointerId?regionClick:null;regionClick=null;if(pan?.id===event.pointerId)pan=null;releasePointer(event);if(pointers.size<2)gesture=null;if(!pointers.size)ignorePointers=false;
 if(click&&!ignorePointers)void selectRegion(click.point);
}
function pointerCancel(event){if(stroke?.id===event.pointerId)cancelDraft();if(regionClick?.id===event.pointerId)regionClick=null;if(pan?.id===event.pointerId)pan=null;releasePointer(event);gesture=null;if(!pointers.size)ignorePointers=false;}
function lostPointer(event){if(pointers.has(event.pointerId))pointerCancel(event);}
async function selectRegion(p){
 if(locked.value||!layer||!pixels)return;const version=sourceVersion,target=layer,revision=state.revision,controller=new AbortController();selectionController=controller;state.selecting=true;state.progress=0;state.error='';
 try{const result=await contiguousSelection(pixels,state.width,state.height,p.x,p.y,{tolerance:state.tolerance,signal:controller.signal,onProgress:value=>{if(valid(version))state.progress=value;}});if(!valid(version)||target!==layer||revision!==state.revision)return;history.push(layer.mask);combineSelection(layer,result,state.erase?'subtract':'add');changed();}catch(error){if(valid(version)&&error.name!=='AbortError')state.error=error.message||'这块区域暂时没有选好，请再试一次。';}finally{if(selectionController===controller){selectionController=null;if(valid(version))state.selecting=false;}}
}
function stopSelection(){selectionController?.abort();state.notice='已停止选择，原有选区保留。';}
function undo(){if(locked.value||!history?.canUndo)return;history.undo(layer);changed();}
function redo(){if(locked.value||!history?.canRedo)return;history.redo(layer);changed();}
function clearSelection(){if(locked.value||!layer||!state.selected)return;history.push(layer.mask);layer.mask.fill(0);layer.words.fill(0);changed();}
function keyboard(event){
 if(!state.ready||locked.value)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();return;}
 if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(event.key))return;event.preventDefault();state.keyboard=true;const step=event.shiftKey?10:1;
 if(event.key.startsWith('Arrow')){if(event.key==='ArrowUp')cursor.y=Math.max(0,cursor.y-step);if(event.key==='ArrowDown')cursor.y=Math.min(state.height-1,cursor.y+step);if(event.key==='ArrowLeft')cursor.x=Math.max(0,cursor.x-step);if(event.key==='ArrowRight')cursor.x=Math.min(state.width-1,cursor.x+step);return;}
 const p={x:Math.round(cursor.x),y:Math.round(cursor.y)};if(state.tool==='region')void selectRegion(p);else{history.push(layer.mask);selectionStroke(layer,p,p,state.brush,state.erase);changed();}
}
function decide(accept){confirmDialog.value?.close();const resolve=decision;decision=null;resolve?.(accept);}
async function mayDiscard(){if(!dirty.value)return true;if(decision)return false;await nextTick();confirmDialog.value?.showModal();return new Promise(resolve=>{decision=resolve;});}
function abortRequests(){selectionController?.abort();requestController?.abort();selectionController=requestController=null;}
function reset(){sourceVersion++;abortRequests();cancelAnimationFrame(frame);frame=0;layer=pixels=history=sourceFile=returnDraft=null;pointers.clear();stroke=regionClick=pan=gesture=null;ignorePointers=false;Object.assign(state,{ready:false,loading:false,selecting:false,exporting:false,sending:false,width:1,height:1,sourceName:'',sourceId:null,maskId:null,selected:0,canUndo:false,canRedo:false,revision:0,savedRevision:0,prompt:'',savedPrompt:'',error:'',notice:''});}
function blobFromCanvas(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片暂时未能保存，请再试一次。')),'image/png'));}
async function openFile(file,{sourceId=null,maskBlob=null,maskId=null,trusted=false,canOpen=()=>true}={}){
 if(!current())return;if(!trusted&&(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>10*1024*1024)){state.error='请选择不超过 10 MB 的 PNG、JPEG、WebP 或静态 GIF 图片。';return;}
 if(!await mayDiscard()||!current()||!canOpen())return;reset();const version=sourceVersion;state.loading=true;let bitmap,maskBitmap;
 try{bitmap=await decodeEditorImage(file);selectionDimensions(bitmap.width,bitmap.height);if(!valid(version))return;state.width=bitmap.width;state.height=bitmap.height;state.ready=true;state.sourceName=trusted?'QGauss 小花园':file.name||'QGauss 图片';await nextTick();if(!valid(version))return;const context=baseCanvas.value?.getContext('2d',{willReadFrequently:true});if(!context)throw Error('当前浏览器暂时无法展开画布，请更换浏览器后再试。');context.drawImage(bitmap.image||bitmap,0,0);pixels=context.getImageData(0,0,state.width,state.height).data;layer=selectionLayer(state.width,state.height);history=selectionHistory(layer.mask.length);
  if(maskBlob){maskBitmap=await decodeEditorImage(maskBlob);if(!valid(version))return;if(maskBitmap.width!==state.width||maskBitmap.height!==state.height)throw Error('选区尺寸与图片不一致，请重新选择。');const canvas=document.createElement('canvas');canvas.width=state.width;canvas.height=state.height;const maskContext=canvas.getContext('2d',{willReadFrequently:true});maskContext.drawImage(maskBitmap.image||maskBitmap,0,0);combineSelection(layer,readSelectionAlpha(maskContext.getImageData(0,0,state.width,state.height).data,state.width,state.height),'replace');}
  const preparedFile=trusted?new File([await blobFromCanvas(baseCanvas.value)],'QGauss-garden.png',{type:'image/png'}):file;if(!valid(version))return;sourceFile=preparedFile;state.sourceId=sourceId;state.maskId=maskId;cursor.x=Math.floor(state.width/2);cursor.y=Math.floor(state.height/2);fit();toolsChanged();drawOverlay();drawPreview();return{version};
 }catch(error){if(valid(version)){state.ready=false;layer=pixels=history=sourceFile=null;state.error=/[\u4e00-\u9fff]/.test(error.message||'')?error.message:'图片没有完整打开，请重新选择有效的静态图片。';}}finally{bitmap?.close?.();maskBitmap?.close?.();if(valid(version))state.loading=false;}
}
async function fileChanged(event){const file=event.target.files?.[0];event.target.value='';if(file)await openFile(file);}
async function openExample(){if(locked.value)return;const version=sourceVersion,controller=new AbortController();requestController?.abort();requestController=controller;state.loading=true;state.error='';const pending=()=>valid(version)&&requestController===controller&&!controller.signal.aborted;try{const response=await fetch('/art/qgauss-selection-garden.svg',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Error('示例图片暂时未能打开。');const blob=await response.blob();if(pending())await openFile(new File([blob],'QGauss 小花园.svg',{type:'image/svg+xml'}),{trusted:true,canOpen:pending});}catch(error){if(pending())state.error=error.message||'示例图片暂时未能打开。';}finally{if(requestController===controller)requestController=null;if(valid(version))state.loading=false;}}
async function maskBlob(transparent=true){const canvas=document.createElement('canvas');canvas.width=state.width;canvas.height=state.height;canvas.getContext('2d').putImageData(new ImageData(selectionPixels(layer.mask,transparent),state.width,state.height),0,0);return blobFromCanvas(canvas);}
async function download(){
 if(!state.ready||locked.value)return;const version=sourceVersion,revision=state.revision,format=state.format;state.exporting=true;state.error='';
 try{const blob=await maskBlob(format==='transparent');if(!valid(version)||revision!==state.revision)return;const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=format==='transparent'?'QGauss-mask.png':'QGauss-selection.png';document.body.appendChild(anchor);anchor.click();anchor.remove();const timer=setTimeout(()=>{URL.revokeObjectURL(url);timers.delete(timer);},30000);timers.set(timer,url);state.savedRevision=revision;state.notice='选区已保存为 PNG，尺寸与原图一致。';}catch(error){if(valid(version))state.error=error.message||'选区暂时未能保存。';}finally{if(valid(version))state.exporting=false;}
}
async function sendToPainting(){
 if(!state.ready||locked.value||!sourceFile)return;const version=sourceVersion,revision=state.revision,controller=new AbortController();requestController=controller;state.sending=true;state.error='';
 try{if(!state.sourceId){const uploaded=await uploadFile(sourceFile,{signal:controller.signal,retry:false});if(!valid(version))return;state.sourceId=uploaded.id;}
  const partial=state.selected>0&&state.selected<state.width*state.height;if(partial&&!state.maskId){const blob=await maskBlob();if(!valid(version)||revision!==state.revision)return;if(blob.size>4*1024*1024)throw Error('选区文件较大，请简化选区或缩小图片后再试。');const uploaded=await uploadFile(new File([blob],'QGauss-selection.png',{type:'image/png'}),{signal:controller.signal,retry:false});if(!valid(version)||revision!==state.revision)return;state.maskId=uploaded.id;}
  const params=new URLSearchParams({sourceId:state.sourceId,...(partial?{maskId:state.maskId}:{})});await api.get('/image/editor/inputs?'+params,{signal:controller.signal,retry:false});if(!valid(version)||revision!==state.revision)return;const transfer=saveImageEditorTransfer(owner,{sourceId:state.sourceId,maskId:partial?state.maskId:null,prompt:state.prompt,returnDraft});state.savedRevision=revision;state.savedPrompt=state.prompt;await router.push({path:'/painting',query:{editor:transfer.id}});
 }catch(error){if(valid(version))state.error=error.message||'这份设定暂时未能带入，图片与选区仍在这里。';}finally{if(requestController===controller)requestController=null;if(valid(version))state.sending=false;}
}
async function loadEntry(){
 let sourceId=route.query.sourceId,maskId=route.query.maskId,record=null;
 if(route.query.editor!==undefined){try{record=readImageEditorTransfer(owner,route.query.editor);sourceId=record.sourceId;maskId=record.maskId||undefined;}catch(error){state.error=error.message;return;}}
 if(sourceId===undefined&&maskId===undefined)return;
 if(typeof sourceId!=='string'||maskId!==undefined&&typeof maskId!=='string'){state.error='图片设定不完整，请重新从绘画页打开。';return;}if(!current())return;
 const version=sourceVersion,controller=new AbortController();requestController?.abort();requestController=controller;state.loading=true;state.error='';const pending=()=>valid(version)&&requestController===controller&&!controller.signal.aborted;
 try{const query=new URLSearchParams({sourceId,...(maskId?{maskId}:{})}),entry=await api.get('/image/editor/inputs?'+query,{signal:controller.signal,retry:false});if(!pending())return;if(entry?.source?.id!==sourceId||(entry.mask?.id||null)!==(maskId||null))throw Error('图片设定不一致，请重新打开。');
  const source=await fetchBlob('/api/image/editor/files/'+encodeURIComponent(sourceId),{signal:controller.signal});if(!pending())return;
  const mask=maskId?await fetchBlob('/api/image/editor/files/'+encodeURIComponent(maskId),{signal:controller.signal}):null;if(!pending())return;
  const loaded=await openFile(new File([source],entry.source.name||'QGauss 图片',{type:source.type}),{sourceId,maskId:maskId||null,maskBlob:mask,canOpen:pending});
  if(loaded&&valid(loaded.version)&&record){returnDraft=record.returnDraft;state.prompt=record.prompt;state.savedPrompt=record.prompt;}
 }catch(error){if(pending())state.error=error.message||'这份图片暂时未能打开。';}finally{if(requestController===controller)requestController=null;if(valid(version))state.loading=false;}
}
function beforeUnload(event){if(dirty.value){event.preventDefault();event.returnValue='';}}
onBeforeRouteLeave(()=>mayDiscard());onBeforeRouteUpdate(async(to,from)=>{if(to.query.sourceId===from.query.sourceId&&to.query.maskId===from.query.maskId&&to.query.editor===from.query.editor)return true;if(!await mayDiscard())return false;state.savedRevision=state.revision;state.savedPrompt=state.prompt;return true;});
watch(()=>[route.query.sourceId,route.query.maskId,route.query.editor],()=>{void loadEntry();});
watch(()=>[auth.user?.id,auth.identityRevision,auth.isLoggedIn],()=>{if(!current()){decide(false);reset();}});
onMounted(()=>{window.addEventListener('beforeunload',beforeUnload);observer=new ResizeObserver(()=>{if(state.ready)fit();});if(viewport.value)observer.observe(viewport.value);void loadEntry();});
onBeforeUnmount(()=>{alive=false;decide(false);abortRequests();observer?.disconnect();cancelAnimationFrame(frame);window.removeEventListener('beforeunload',beforeUnload);for(const[timer,url]of timers){clearTimeout(timer);URL.revokeObjectURL(url);}timers.clear();layer=pixels=history=sourceFile=null;});
</script>
