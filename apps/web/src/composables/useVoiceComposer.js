import {computed,onBeforeUnmount,onMounted,reactive,watch} from 'vue';
import {api,fetchBlob} from '../api/client.js';
import {useAuth} from '../stores/auth.js';
import {useBalance} from '../stores/balance.js';
import {voiceTerminal} from '../lib/voice-presentation.js';
import {readVoiceComposerDraft,saveVoiceComposerDraft,saveVoiceComposerPending,readVoiceComposerPending,clearVoiceComposerPending,takeVoiceCompositionTransfer} from '../lib/voice-composer-state.js';

export function useVoiceComposer(audio){
 const auth=useAuth(),balance=useBalance(),state=reactive({draft:{text:'',title:'',voice:'fable'},options:null,loading:true,error:'',notice:'',offer:null,pending:null,task:null,stage:'idle',stopping:false,downloading:false,playing:false,audioLoading:false,audioUrl:'',part:0,playbackSeconds:0,playbackDuration:0,playbackRate:1,clearReview:false,transfer:null});
 const busy=computed(()=>!!state.pending||state.stopping);
 let alive=true,owner=auth.user?.id,identity=auth.identityRevision,epoch=0,observer=0,pollTimer,read,write,optionsRead,mediaRead,mediaRevision=0,downloadRead;
 const stamp=()=>({owner,identity,epoch}),current=s=>alive&&auth.isLoggedIn&&auth.user?.id===(s?.owner??owner)&&auth.identityRevision===(s?.identity??identity)&&(s?.epoch??epoch)===epoch;
 const valid=op=>current()&&state.pending===op;
 function stopPlayback(){mediaRevision++;mediaRead?.abort();if(audio.value){audio.value.pause();audio.value.removeAttribute('src');audio.value.load?.();}if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl='';state.playing=false;state.audioLoading=false;state.playbackSeconds=state.playbackDuration=0;}
 async function loadOptions(){if(!current())return;const s=stamp();optionsRead?.abort();optionsRead=new AbortController();state.loading=true;try{const result=await api.get('/voice/options',{signal:optionsRead.signal,retry:false});if(current(s))state.options=result;}catch(error){if(current(s)&&error.name!=='AbortError')state.error=error.message||'声音工作室暂时未能打开。';}finally{if(current(s))state.loading=false;}}
 async function quote(sample=false){
  if(!current()||busy.value||state.offer)return;state.error='';state.notice='';const text=state.draft.text.trim();if(!sample&&(!text||text.length>(state.options?.maxSpeechChars||16000))){state.error='请先填写上限以内的配音文字。';return;}
  const payload=sample?{kind:'speech',sample:true,voice:state.draft.voice}:{kind:'speech',text,title:state.draft.title.trim(),voice:state.draft.voice},offer=reactive({payload,quote:null,error:'',loading:true});state.offer=offer;const s=stamp();read?.abort();read=new AbortController();
  try{const result=await api.post('/voice/quote',payload,{signal:read.signal,retry:false});if(current(s)&&state.offer===offer){if(!result||typeof result.revision!=='string'||!Number.isInteger(result.cost)||!Number.isInteger(result.segments))throw Error('本次次数暂时未能完整读取。');offer.quote=result;}}
  catch(error){if(current(s)&&state.offer===offer&&error.name!=='AbortError')offer.error=error.message||'暂时无法核对本次生成。';}finally{if(current(s)&&state.offer===offer)offer.loading=false;}
 }
 function reject(){read?.abort();state.offer=null;}
 function normalize(task,op){if(!task||typeof task.id!=='string'||task.kind!=='speech'||task.voice!==op.payload.voice||!!task.sample!==!!op.payload.sample||!['QUEUED','RUNNING','SETTLING','COMPLETED','FAILED','CANCELED'].includes(task.status)||!Array.isArray(task.audio))throw Error('原任务回执暂时不完整。');return task;}
 function receive(op,value){
  if(!valid(op))return false;const task=normalize(value,op);if(state.task?.id&&state.task.id!==task.id)throw Error('任务回执与原请求不一致。');state.task=task;
  if(voiceTerminal(task)){clearTimeout(pollTimer);clearVoiceComposerPending(owner);state.pending=null;state.stage='ready';state.notice=task.status==='COMPLETED'?'声音已保存，可以重听或保存完整配音。':task.status==='CANCELED'?'这次生成已经停止，次数处理请以回执为准。':'这次声音没有完成，可以修改文字后重新确认。';void balance.refresh().catch(()=>{});return true;}
  state.stage='working';return false;
 }
 function schedule(op){clearTimeout(pollTimer);if(valid(op))pollTimer=setTimeout(()=>void poll(op),900);}
 async function poll(op){if(!valid(op))return;const own=++observer;read?.abort();read=new AbortController();try{const task=await api.get('/voice/tasks/by-request/'+encodeURIComponent(op.requestKey),{signal:read.signal,retry:false});if(!valid(op)||own!==observer)return;if(!receive(op,task))schedule(op);}catch(error){if(valid(op)&&own===observer&&error.name!=='AbortError'){state.stage='unknown';state.error='原任务暂时未能同步。先核对原任务，再决定是否继续。';}}}
 async function submit(op){
  if(!valid(op))return;clearTimeout(pollTimer);read?.abort();write?.abort();write=new AbortController();const own=++observer;state.stage='preparing';state.error='';
  try{const task=await api.post('/voice/tasks',{...op.payload,requestKey:op.requestKey,quoteRevision:op.quoteRevision},{signal:write.signal,retry:false});if(!valid(op)||own!==observer)return;if(!receive(op,task))schedule(op);}
  catch(error){if(valid(op)&&own===observer&&error.name!=='AbortError'){state.stage='unknown';state.error=error.status&&error.status<500?error.message:'提交结果暂未确认，请先核对原任务。';}}
 }
 async function approve(){const offer=state.offer;if(!offer?.quote||offer.loading||offer.error||busy.value||!current())return;let op;try{op=reactive(saveVoiceComposerPending(owner,{payload:{...offer.payload},requestKey:crypto.randomUUID(),quoteRevision:offer.quote.revision}));}catch(error){offer.error=error.message;return;}stopPlayback();state.offer=null;state.pending=op;state.task=null;state.part=0;await submit(op);}
 async function check(){const op=state.pending;if(!valid(op)||['preparing','checking','stopping'].includes(state.stage))return;clearTimeout(pollTimer);state.stage='checking';state.error='';await poll(op);}
 async function retry(){const op=state.pending;if(!valid(op)||state.stage!=='unknown')return;if(state.task&&!voiceTerminal(state.task)){await check();return;}await submit(op);}
 async function stop(){
  const op=state.pending;if(!valid(op)||state.stopping)return;observer++;write?.abort();read?.abort();clearTimeout(pollTimer);const own=observer;state.stopping=true;state.stage='stopping';state.error='';
  try{let task;try{task=await api.get('/voice/tasks/by-request/'+encodeURIComponent(op.requestKey),{retry:false});}catch(error){if(error.status!==404)throw error;}
   if(!valid(op)||own!==observer)return;
   if(task){if(voiceTerminal(task)){receive(op,task);return;}const result=await api.post('/voice/tasks/'+encodeURIComponent(task.id)+'/cancel',{}, {retry:false});if(valid(op)&&own===observer&&!receive(op,result))schedule(op);}
   else{await api.post('/voice/requests/'+encodeURIComponent(op.requestKey)+'/end',{}, {retry:false});if(valid(op)&&own===observer){clearVoiceComposerPending(owner);state.pending=null;state.stage='ended';state.notice='这次等待已经结束，迟到的提交不会重新启动。';}}
  }catch(error){if(valid(op)&&own===observer){state.stage='unknown';state.error=error.status===409?'原任务可能已经接受，请核对原任务后再请求停止。':'停止结果尚未确认，请继续核对原任务。';}}finally{if(current())state.stopping=false;}
 }
 async function playPart(index=0){
  const task=state.task,s=stamp();if(!current(s)||!task?.audio?.[index]||!audio.value)return;stopPlayback();const own=mediaRevision;state.part=index;state.audioLoading=true;state.error='';mediaRead=new AbortController();
  try{const blob=await fetchBlob(task.audio[index].url,{signal:mediaRead.signal});if(!current(s)||state.task?.id!==task.id||own!==mediaRevision)return;state.audioUrl=URL.createObjectURL(blob);await Promise.resolve();if(!current(s)||own!==mediaRevision)return;audio.value.src=state.audioUrl;audio.value.playbackRate=state.playbackRate;await audio.value.play();if(current(s)&&own===mediaRevision)state.playing=true;}
  catch(error){if(current(s)&&own===mediaRevision&&error.name!=='AbortError')state.error=error.name==='NotAllowedError'?'声音已准备好，请点击播放。':error.message||'这段声音暂时未能播放，可以再次点击重听。';}finally{if(current(s)&&own===mediaRevision)state.audioLoading=false;}
 }
 async function play(){if(!current()||!audio.value)return;if(state.playing){audio.value.pause();state.playing=false;return;}if(!state.audioUrl){await playPart(state.part);return;}const s=stamp(),own=mediaRevision;try{await audio.value.play();if(current(s)&&own===mediaRevision)state.playing=true;}catch{if(current(s)&&own===mediaRevision)state.error='请再次点击播放这段声音。';}}
 function metadata(){if(current()&&audio.value&&state.audioUrl){state.playbackDuration=Number.isFinite(audio.value.duration)?audio.value.duration:0;audio.value.playbackRate=state.playbackRate;}}
 function timeUpdate(){if(current()&&audio.value&&state.audioUrl)state.playbackSeconds=Number.isFinite(audio.value.currentTime)?audio.value.currentTime:0;}
 function seek(value){const seconds=Number(value);if(current()&&audio.value&&Number.isFinite(seconds)&&state.playbackDuration)audio.value.currentTime=Math.max(0,Math.min(seconds,state.playbackDuration));}
 function nextPart(){if(!current())return;if(state.task?.audio?.[state.part+1])void playPart(state.part+1);else{state.playing=false;state.playbackSeconds=state.playbackDuration;}}
 function audioError(){if(current()&&state.audioUrl){state.playing=false;state.error='这段声音暂时无法播放，可以重新读取已保存的声音。';stopPlayback();}}
 async function download(){const s=stamp(),task=state.task;if(!current(s)||task?.status!=='COMPLETED'||!task.audio?.length||state.downloading)return;state.downloading=true;state.error='';downloadRead?.abort();downloadRead=new AbortController();try{const blob=await fetchBlob('/api/voice/tasks/'+encodeURIComponent(task.id)+'/download',{signal:downloadRead.signal});if(!current(s)||state.task?.id!==task.id)return;const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=('QGauss-'+(task.sample?'音色试听':task.label||'声音作品')).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,100)+'.mp3';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);state.notice='完整配音已整理，可以在浏览器下载中找到。';}catch(error){if(current(s)&&error.name!=='AbortError')state.error=error.message||'这次未能保存完整配音，原声音仍留在收藏室。';}finally{if(current(s))state.downloading=false;}}
 function clearDraft(){state.draft.text=state.draft.title='';state.clearReview=false;state.notice='纸张已整理好，下一段想法可以开始了。';}
 function adoptTransfer(){if(state.transfer){state.draft={...state.transfer};state.transfer=null;state.notice='文字已经带入，生成前还会再次确认。';}}
 function keepDraft(){state.transfer=null;state.notice='当前文字已经保留，未启动新的生成。';}
 function dispose(){epoch++;observer++;for(const controller of [read,write,optionsRead,downloadRead])controller?.abort();clearTimeout(pollTimer);stopPlayback();state.offer=state.pending=state.task=state.transfer=null;state.stage='idle';state.error=state.notice='';state.clearReview=false;state.stopping=state.downloading=state.loading=false;state.draft={text:'',title:'',voice:'fable'};state.options=null;}
 async function bootstrap(){if(!current())return;state.draft=readVoiceComposerDraft(owner);const transfer=takeVoiceCompositionTransfer(owner);if(transfer){if(state.draft.text.trim()&&(state.draft.text!==transfer.text||state.draft.title!==transfer.title))state.transfer=transfer;else state.draft=transfer;}const pending=readVoiceComposerPending(owner);if(pending){state.pending=reactive(pending);state.stage='unknown';void check();}await loadOptions();}
 watch(()=>state.draft,()=>{if(current())saveVoiceComposerDraft(owner,state.draft);},{deep:true});
 watch(()=>state.playbackRate,value=>{if(![.75,1,1.25,1.5].includes(value)){state.playbackRate=1;return;}if(audio.value)audio.value.playbackRate=value;});
 watch([()=>auth.user?.id,()=>auth.identityRevision,()=>auth.user?.role],async()=>{dispose();owner=auth.user?.id;identity=auth.identityRevision;if(current())await bootstrap();});
 onMounted(()=>void bootstrap());onBeforeUnmount(()=>{if(current())saveVoiceComposerDraft(owner,state.draft);alive=false;dispose();});
 return{state,busy,loadOptions,quote,reject,approve,check,retry,stop,play,playPart,metadata,timeUpdate,seek,nextPart,audioError,download,clearDraft,adoptTransfer,keepDraft};
}
