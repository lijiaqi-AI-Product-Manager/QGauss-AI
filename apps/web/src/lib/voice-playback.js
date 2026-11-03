import {createVoiceStreamPlayer,supportsVoiceStream} from './voice-stream-player.js';

const terminal=task=>['COMPLETED','FAILED','CANCELED'].includes(task?.status);
/** One reader follows one accepted task, independently from generation polling. */
export function createVoicePlayback({getAudio,loadBlob,readStream,onChange=()=>{},active=()=>true,rate=()=>1,environment=globalThis}){
  let task=null,element=null,live=null,controller=null,url='',revision=0,wanted=false,autoSeen=false,waiting=null;
  const state={playing:false,loading:false,url:'',part:0,seconds:0,duration:0,phase:'idle',mode:'segments',notice:'',reconnectable:false};
  const emit=patch=>{Object.assign(state,patch,{requested:wanted});if(active())onChange({...state});},valid=(own,id)=>active()&&own===revision&&task?.id===id;
  function clearMedia(){revision++;controller?.abort();controller=null;const previous=live;live=null;previous?.stop();if(element){element.onended=element.onloadedmetadata=element.ondurationchange=element.ontimeupdate=element.onerror=null;element.pause();element.removeAttribute('src');element.load?.();}if(url)environment.URL.revokeObjectURL(url);url='';}
  function stop(){wanted=false;waiting=null;clearMedia();emit({playing:false,loading:false,url:'',seconds:0,duration:0,phase:'idle',mode:'segments',notice:'',reconnectable:false});}
  function attach(own,id){
    element=getAudio();if(!element)throw Error('声音播放器尚未准备好');element.playbackRate=rate();
    element.onloadedmetadata=element.ondurationchange=()=>{if(valid(own,id))emit({duration:Number.isFinite(element.duration)?element.duration:0});};
    element.ontimeupdate=()=>{if(valid(own,id))emit({seconds:Number.isFinite(element.currentTime)?element.currentTime:0});};
    element.onended=()=>{if(!valid(own,id))return;if(state.mode==='stream'){wanted=false;emit({playing:false,phase:'ended'});return;}const next=state.part+1;if(wanted&&task.audio?.[next])void part(next);else if(wanted&&!terminal(task)){waiting=next;emit({playing:false,loading:false,phase:'waiting'});}else{wanted=false;emit({playing:false,phase:'ended'});}};
    element.onerror=()=>{if(valid(own,id))interrupted();};return element;
  }
  function interrupted(){wanted=false;waiting=null;clearMedia();emit({playing:false,loading:false,url:'',mode:'segments',phase:'interrupted',notice:'播放连接暂时中断，可以重新连接原声音；不会重新生成。',reconnectable:!!task?.streamUrl});}
  async function part(index=0){
    if(!active()||!task?.audio?.[index])return;clearMedia();wanted=true;waiting=null;const own=revision,id=task.id;controller=new AbortController();emit({playing:false,loading:true,url:'',part:index,seconds:0,duration:0,mode:'segments',phase:'connecting',notice:state.notice.startsWith('当前浏览器')?state.notice:'',reconnectable:false});
    try{const blob=await loadBlob(task.audio[index].url,{signal:controller.signal});if(!valid(own,id))return;const audio=attach(own,id);url=environment.URL.createObjectURL(blob);audio.src=url;emit({url});if(!wanted){emit({phase:'paused'});return;}await audio.play();if(valid(own,id)&&wanted)emit({playing:true,phase:'playing'});}
    catch(error){if(valid(own,id)&&error.name!=='AbortError'){wanted=false;emit({playing:false,phase:error.name==='NotAllowedError'?'gesture':'interrupted',notice:error.name==='NotAllowedError'?'声音已准备好，请点击播放。':'这段声音暂时无法播放，可以继续读取原声音。',reconnectable:!!task?.streamUrl});}}
    finally{if(valid(own,id)){controller=null;emit({loading:false});}}
  }
  async function begin(){
    if(!active()||!task)return;if(task.streamUrl&&supportsVoiceStream(environment)){
      clearMedia();wanted=true;waiting=null;const own=revision,id=task.id,audio=attach(own,id);emit({playing:false,loading:true,url:'',seconds:0,duration:0,mode:'stream',phase:'connecting',notice:'',reconnectable:false});
      const streamUrl=task.streamUrl;live=createVoiceStreamPlayer({audio,read:signal=>readStream(streamUrl,{signal}),environment,onState:value=>{if(!valid(own,id))return;if(value.phase==='gesture')wanted=false;const phase=value.phase==='received'&&!wanted&&!value.playing?(state.phase==='gesture'?'gesture':'paused'):value.phase;emit({playing:value.playing,loading:['connecting','buffering'].includes(phase),phase,duration:Number.isFinite(audio.duration)?audio.duration:0,notice:phase==='gesture'?'声音已准备好，请点击播放。':''});},onError:()=>{if(valid(own,id))interrupted();}});void live.run();return;
    }
    emit({mode:'segments',notice:task.streamUrl?'当前浏览器会按已生成片段连续播放。':''});waiting=state.part;wanted=true;await kick();
  }
  async function kick(){if(!wanted||!active()||!task||live)return;if(waiting!==null&&task.audio?.[waiting]){await part(waiting);return;}if(!url&&!state.loading){waiting=waiting??state.part;emit({playing:false,phase:'waiting',loading:false});}}
  async function update(next,{autoplay=false}={}){
    if(next?.kind!=='speech'){if(task)stop();task=null;return;}if(task?.id!==next.id){stop();autoSeen=false;emit({part:0});}task=next;
    if(['FAILED','CANCELED'].includes(next.status)){stop();return;}
    if(autoplay&&!autoSeen){autoSeen=true;wanted=true;await begin();}else await kick();
  }
  async function play(){
    if(!active()||!task)return;if(live){if(wanted){wanted=false;live.pause();emit({playing:false,loading:false,phase:'paused'});}else{wanted=true;await live.play();}return;}
    if(wanted&&(state.playing||state.phase==='waiting'||state.loading)){wanted=false;element?.pause();emit({playing:false,loading:false,phase:'paused'});return;}
    wanted=true;if(controller&&!controller.signal.aborted&&!url){emit({loading:true,phase:'connecting'});return;}if(waiting!==null){await kick();return;}if(!url){await begin();return;}const own=revision,id=task.id;try{await element.play();if(valid(own,id)&&wanted)emit({playing:true,phase:'playing',notice:''});}catch(error){if(valid(own,id)){wanted=false;emit({playing:false,phase:'gesture',notice:'请再次点击播放，声音不会重新生成。'});}}
  }
  async function reconnect(){if(!active()||!task)return;wanted=true;await begin();}
  function seek(value){const seconds=Number(value);if(active()&&element&&Number.isFinite(seconds)&&state.duration)element.currentTime=Math.max(0,Math.min(seconds,state.duration));}
  function setRate(){if(active()&&element)element.playbackRate=rate();}
  return{update,play,part,reconnect,stop,seek,setRate};
}
