const TYPE='audio/mpeg';
export function supportsVoiceStream(environment=globalThis){try{return typeof environment.MediaSource==='function'&&environment.MediaSource.isTypeSupported(TYPE)===true;}catch{return false;}}

/** Audio loading and playback promises must not block each other. */
export function createVoiceStreamPlayer({audio,read,onState=()=>{},onError=()=>{},environment=globalThis}){
  if(!supportsVoiceStream(environment))return null;
  const controller=new AbortController(),signal=controller.signal,source=new environment.MediaSource(),events=[];let url='',buffer,stopped=false,started=false,received=false,wantsPlay=true,playRevision=0;
  const state=phase=>{if(!stopped)onState({phase,playing:!audio.paused,received});};
  function listen(target,name,handler){target.addEventListener(name,handler);events.push(()=>target.removeEventListener(name,handler));}
  function operation(target,event,action,timeout=15000){return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);target.removeEventListener(event,done);target.removeEventListener('error',failed);target.removeEventListener('abort',failed);signal.removeEventListener('abort',aborted);},done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(Error('这段声音暂时未能连续播放'));},aborted=()=>{cleanup();reject(signal.reason||new DOMException('声音播放已停止','AbortError'));},timer=setTimeout(failed,timeout);
    target.addEventListener(event,done,{once:true});target.addEventListener('error',failed,{once:true});target.addEventListener('abort',failed,{once:true});signal.addEventListener('abort',aborted,{once:true});try{signal.throwIfAborted();action();}catch(error){cleanup();reject(error);}
  });}
  async function play(){if(stopped)return;wantsPlay=true;const own=++playRevision;try{await audio.play();if(!stopped&&wantsPlay&&own===playRevision)state('playing');}catch(error){if(stopped||!wantsPlay||own!==playRevision||error.name==='AbortError')return;if(error.name==='NotAllowedError')state('gesture');else fail(error);}}
  function pause(){if(stopped)return;wantsPlay=false;playRevision++;audio.pause();state('paused');}
  function stop(){if(stopped)return;stopped=true;playRevision++;controller.abort();for(const dispose of events)dispose();try{if(buffer?.updating&&source.readyState==='open')buffer.abort();}catch{}audio.pause();audio.removeAttribute('src');audio.load?.();if(url)environment.URL.revokeObjectURL(url);url='';}
  function fail(error){if(stopped)return;stop();onError(error?.name==='NotAllowedError'?Error('请点击播放，声音不会重新生成'):Error('播放连接暂时中断，可以继续读取原声音'));}
  async function append(bytes){try{await operation(buffer,'updateend',()=>buffer.appendBuffer(bytes));}catch(error){if(error.name!=='QuotaExceededError'||!buffer.buffered?.length||audio.currentTime<=30)throw error;await operation(buffer,'updateend',()=>buffer.remove(0,audio.currentTime-30));await operation(buffer,'updateend',()=>buffer.appendBuffer(bytes));}}
  async function run(){if(started||stopped)return;started=true;state('connecting');
    try{const opened=operation(source,'sourceopen',()=>{url=environment.URL.createObjectURL(source);audio.src=url;audio.load?.();});await opened;signal.throwIfAborted();buffer=source.addSourceBuffer(TYPE);buffer.mode='sequence';
      listen(audio,'playing',()=>state('playing'));listen(audio,'waiting',()=>state('buffering'));listen(audio,'pause',()=>state('paused'));listen(audio,'ended',()=>state('ended'));listen(audio,'error',()=>fail());let bytes=0,requestedPlay=false;
      for await(const chunk of read(signal)){signal.throwIfAborted();await append(chunk);bytes+=chunk.byteLength;if(!requestedPlay&&wantsPlay){requestedPlay=true;void play();}}
      signal.throwIfAborted();if(!bytes)throw Error('暂未收到声音');if(source.readyState==='open')source.endOfStream();received=true;state('received');
    }catch(error){if(!signal.aborted)fail(error);}
  }
  return{run,play,pause,stop};
}
