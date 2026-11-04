<template>
  <dialog ref="dialog" class="qsp-dialog" aria-labelledby="qsp-title" @cancel.prevent="close" @click="backdrop">
    <header><div><span class="qsp-eyebrow">QGAUSS / FIND YOUR LEADING VOICE</span><h2 id="qsp-title">{{ vt("这一幕，") }}<em>{{ vt("让谁开口？") }}</em></h2></div><button type="button" class="qsp-close" :aria-label="vt(&quot;关闭人物选择&quot;)" @click="close">×</button></header>
    <div class="qsp-body"><p class="qsp-intro">{{ vt("先停在人物清晰的画面，再点一下想让他开口的脸。选择会跟随这条视频保存。") }}</p>
    <div v-if="loading" class="qsp-loading" role="status"><BrandLoader :size="38" :text="vt(&quot;正在打开你的画面…&quot;)" /></div>
    <div v-else-if="error" class="qsp-error" role="alert"><b>{{ vt("画面还没有准备好") }}</b><p>{{ vt(error) }}</p><button type="button" @click="open">{{ vt("再打开一次") }}</button></div>
    <template v-else-if="timeline && url">
      <div class="qsp-screen" :class="{'is-ready':frameReady}">
        <video ref="video" :src="url" muted playsinline preload="auto" aria-hidden="true" @loadeddata="seek" @seeked="renderFrame" @error="mediaError" />
        <div class="qsp-canvas-wrap" :style="{aspectRatio:timeline.width+'/'+timeline.height}">
          <canvas ref="canvas" :width="timeline.width" :height="timeline.height" tabindex="0" role="button" :aria-label="vt(&quot;选择画面中的说话人物，点按脸部或使用方向键定位&quot;)" :aria-disabled="!frameReady" @pointerdown="locate" @keydown="move" />
          <span v-if="point && frameReady" class="qsp-pin" :style="{left:100*(point.x+.5)/timeline.width+'%',top:100*(point.y+.5)/timeline.height+'%'}" aria-hidden="true"><i></i><b>{{ vt("主角") }}</b></span>
          <div v-if="!frameReady" class="qsp-frame-loading"><BrandLoader :size="26" :text="vt(&quot;正在停住这一帧…&quot;)" /></div>
        </div>
      </div>
      <div class="qsp-frame-head"><span>{{ vt("寻找人物清晰的时刻") }}</span><b>{{ speakerTime(timeline.frames[frameNumber]) }}</b><small>{{ vt("第 {p0} / {p1} 帧",{p0:(frameNumber+1),p1:(timeline.frames.length)}) }}</small></div>
      <input v-model.number="frameNumber" class="qsp-timeline" type="range" min="0" :max="timeline.frames.length-1" step="1" :aria-label="vt(&quot;选择人物出现的画面&quot;)" @input="changeFrame" />
      <div class="qsp-frame-buttons"><button type="button" :disabled="frameNumber===0" @click="step(-1)">{{ vt("← 上一帧") }}</button><span>{{ vt("换一帧后，请重新点选人物") }}</span><button type="button" :disabled="frameNumber===timeline.frames.length-1" @click="step(1)">{{ vt("下一帧 →") }}</button></div>
      <div class="qsp-selection" role="status"><span class="qsp-selection-icon" aria-hidden="true">{{ point ? '◎' : '⌖' }}</span><div><b>{{ point ? vt("主角，已经找到。") : vt("点一下画面里的脸。") }}</b><p>{{ point ? vt("这一帧与人物位置会一起用于本次口型同步。") : vt("也可以聚焦画面后按空格定位，再用方向键微调。") }}</p></div><button v-if="point" type="button" @click="point=null">{{ vt("重新点选") }}</button></div>
    </template></div>
    <footer><p>{{ vt("这里只选择画面，不会开始生成或扣次。") }}</p><div><button type="button" class="qsp-secondary" @click="close">{{ vt("再想一想") }}</button><button type="button" class="qsp-primary" :disabled="!frameReady || !point || loading || !!error" @click="confirm">{{ vt("让这位主角开口 ↗") }}</button></div></footer>
  </dialog>
</template>
<script setup>
import {videoText as vt} from "../../i18n/video.js";
import {nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {api,fetchBlob} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {speakerPoint,speakerTime,validSpeaker} from '../../lib/video-speaker.js';
import BrandLoader from './BrandLoader.vue';
import './video-speaker.css';
const props=defineProps({material:{type:Object,default:null},modelValue:{type:Object,default:null}}),emit=defineEmits(['update:modelValue','busy']);
const auth=useAuth(),owner=auth.user?.id,dialog=ref(null),video=ref(null),canvas=ref(null),loading=ref(false),error=ref(''),url=ref(''),timeline=ref(null),frameNumber=ref(0),point=ref(null),frameReady=ref(false);
let alive=true,controller,revision=0;
const current=()=>alive&&auth.isLoggedIn&&auth.user?.id===owner;
function release(){controller?.abort();revision++;frameReady.value=false;const player=video.value;if(player){player.pause();player.removeAttribute('src');player.load();}if(url.value)URL.revokeObjectURL(url.value);url.value='';timeline.value=null;point.value=null;loading.value=false;emit('busy',false);}
function close(){release();dialog.value?.close();}
function backdrop(event){if(event.target===dialog.value){const r=dialog.value.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}}
async function open(){
  if(!current()||!props.material)return;release();const id=props.material.id,epoch=revision,request=controller=new AbortController();loading.value=true;error.value='';emit('busy',true);dialog.value?.showModal();
  try{
    const [info,blob]=await Promise.all([api.get('/video/materials/'+encodeURIComponent(id)+'/frames',{signal:request.signal}),fetchBlob('/api/upload/'+encodeURIComponent(id)+'/raw',{signal:request.signal})]);
    if(!current()||revision!==epoch||request.signal.aborted||props.material?.id!==id)return;
    if(!Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||info.width<1||info.height<1||!Array.isArray(info.frames)||!info.frames.length||info.frames.length>100000||info.frames.some((x,i)=>!Number.isFinite(x)||x<0||i>0&&x<=info.frames[i-1]))throw Error('这条视频的画面时刻暂时无法确认，请重新保存后再试。');
    timeline.value=info;frameNumber.value=validSpeaker(props.modelValue,{...props.material,width:info.width,height:info.height},info.frames.length)?props.modelValue.frameNumber:0;point.value=validSpeaker(props.modelValue,{...props.material,width:info.width,height:info.height},info.frames.length)?{x:props.modelValue.x,y:props.modelValue.y}:null;url.value=URL.createObjectURL(blob);
  }catch(e){if(current()&&revision===epoch&&!request.signal.aborted){error.value=e.message||'视频暂未打开，请稍后重试。';request.abort();}}
  finally{if(current()&&revision===epoch){loading.value=false;await nextTick();if(url.value)seek();}}
}
function mediaError(){if(current()&&dialog.value?.open){error.value='当前设备暂时无法读取这条视频，请换用可播放的 MP4。';frameReady.value=false;}}
function seek(){const player=video.value,info=timeline.value;if(!current()||!player||!info||!url.value||player.readyState<2)return;if(player.videoWidth!==info.width||player.videoHeight!==info.height){error.value='这条视频的显示画幅与素材记录不同，请重新保存后再选择人物。';return;}const target=info.frames[frameNumber.value];frameReady.value=false;try{if(Math.abs(player.currentTime-target)<.00001&&!player.seeking)renderFrame();else player.currentTime=target;}catch{mediaError();}}
function renderFrame(){const player=video.value,info=timeline.value;if(!current()||!player||!info||!canvas.value||player.seeking||player.readyState<2||Math.abs(player.currentTime-info.frames[frameNumber.value])>.001)return;try{canvas.value.getContext('2d').drawImage(player,0,0,info.width,info.height);frameReady.value=true;}catch{mediaError();}}
function changeFrame(){point.value=null;frameReady.value=false;seek();}
function step(delta){if(!timeline.value)return;frameNumber.value=Math.max(0,Math.min(timeline.value.frames.length-1,frameNumber.value+delta));changeFrame();}
function locate(event){if(!current()||!frameReady.value||!timeline.value||event.button!==0)return;point.value=speakerPoint(event.clientX,event.clientY,canvas.value.getBoundingClientRect(),timeline.value.width,timeline.value.height);canvas.value.focus({preventScroll:true});}
function move(event){if(!current()||!frameReady.value||!timeline.value||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Enter'].includes(event.key))return;event.preventDefault();const {width,height}=timeline.value,p=point.value||{x:Math.floor(width/2),y:Math.floor(height/2)},amount=event.shiftKey?10:1;point.value={x:Math.max(0,Math.min(width-1,p.x+(event.key==='ArrowLeft'?-amount:event.key==='ArrowRight'?amount:0))),y:Math.max(0,Math.min(height-1,p.y+(event.key==='ArrowUp'?-amount:event.key==='ArrowDown'?amount:0)))};}
function confirm(){const info=timeline.value;if(!current()||!frameReady.value||!point.value||!info||!props.material)return;const selection={videoId:props.material.id,frameNumber:frameNumber.value,x:point.value.x,y:point.value.y};if(!validSpeaker(selection,{...props.material,width:info.width,height:info.height},info.frames.length))return;emit('update:modelValue',selection);close();}
watch(()=>props.material?.id,()=>close());watch(()=>auth.user?.id,()=>{if(!current())close();});watch(()=>auth.isLoggedIn,()=>{if(!current())close();});
onBeforeUnmount(()=>{alive=false;close();});defineExpose({open,close});
</script>
