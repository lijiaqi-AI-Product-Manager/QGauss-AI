import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVoicePlayback} from '../src/lib/voice-playback.js';
import {createVoiceStreamPlayer,supportsVoiceStream} from '../src/lib/voice-stream-player.js';
const tick=()=>new Promise(done=>setTimeout(done,0));
async function until(predicate){for(let n=0;n<100;n++){if(predicate())return;await tick();}assert.ok(predicate(),'playback did not settle');}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function fixture({supported=true,playGate,blocked=false}={}){
 const urls=new Map(),states=[],errors=[],sources=[],fetches=[],streams=[];let serial=0;
 class SourceBuffer extends EventTarget{updating=false;buffered={length:0};appended=[];appendBuffer(value){assert.equal(this.updating,false);this.updating=true;this.appended.push([...value]);queueMicrotask(()=>{this.updating=false;this.dispatchEvent(new Event('updateend'));});}abort(){this.updating=false;this.dispatchEvent(new Event('abort'));}remove(){queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}}
 class MediaSource extends EventTarget{static isTypeSupported(type){return supported&&type==='audio/mpeg';}readyState='closed';addSourceBuffer(){this.buffer=new SourceBuffer();return this.buffer;}endOfStream(){this.readyState='ended';this.finished=true;}}
 const environment={MediaSource,URL:{createObjectURL(value){const id='blob:qgauss-'+ ++serial;urls.set(id,value);if(value instanceof MediaSource)sources.push(value);return id;},revokeObjectURL(value){urls.delete(value);}}};
 class Audio extends EventTarget{paused=true;currentTime=0;duration=0;playCalls=0;get src(){return this.source;}set src(value){this.source=value;const media=urls.get(value);if(media instanceof MediaSource)queueMicrotask(()=>{media.readyState='open';media.dispatchEvent(new Event('sourceopen'));});}async play(){this.playCalls++;if(playGate)await playGate.promise;if(blocked)throw new DOMException('gesture required','NotAllowedError');this.paused=false;this.dispatchEvent(new Event('playing'));}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}load(){}removeAttribute(name){if(name==='src')this.source='';}}
 const audio=new Audio(),change=value=>states.push(value),task={id:'original-voice',kind:'speech',voice:'fable',status:'RUNNING',streamUrl:'/api/voice/tasks/original-voice/stream',audio:[]};
 const playback=createVoicePlayback({getAudio:()=>audio,environment,loadBlob:async path=>{fetches.push(path);return new Blob(['saved voice'],{type:'audio/mpeg'});},readStream:(path,options)=>{streams.push({path,signal:options.signal});return(async function*(){yield new Uint8Array([1,2]);yield new Uint8Array([3,4]);})();},onChange:change});
 return{audio,environment,urls,states,errors,sources,fetches,streams,task,playback,latest:()=>states.at(-1)};
}
test('声音收到第一段即尝试播放，播放许可未完成也继续接收后续音频',async()=>{
 const gate=deferred(),f=fixture({playGate:gate}),player=createVoiceStreamPlayer({audio:f.audio,environment:f.environment,read:async function*(){yield new Uint8Array([1]);yield new Uint8Array([2]);},onState:v=>f.states.push(v),onError:e=>f.errors.push(e)}),running=player.run();await running;assert.deepEqual(f.sources[0].buffer.appended,[[1],[2]]);assert.equal(f.sources[0].finished,true);assert.equal(f.audio.playCalls,1);gate.resolve();await tick();assert.equal(f.audio.paused,false);player.stop();assert.equal(f.urls.size,0);assert.deepEqual(f.errors,[]);
});
test('浏览器阻止自动播放时继续保留接收内容，显示亲自点击的状态',async()=>{
 const f=fixture({blocked:true}),player=createVoiceStreamPlayer({audio:f.audio,environment:f.environment,read:async function*(){yield new Uint8Array([1]);await tick();yield new Uint8Array([2]);},onState:v=>f.states.push(v),onError:e=>f.errors.push(e)});await player.run();assert.equal(f.sources[0].buffer.appended.length,2);assert.ok(f.states.some(s=>s.phase==='gesture'));assert.deepEqual(f.errors,[]);player.stop();
});
test('播放许可尚未完成时快速暂停再继续，会立即发起新的播放而不等待旧许可',async()=>{
 const f=fixture();let rejectOld,calls=0;f.audio.play=()=>{calls++;if(calls===1)return new Promise((_,reject)=>rejectOld=reject);f.audio.paused=false;f.audio.dispatchEvent(new Event('playing'));return Promise.resolve();};const player=createVoiceStreamPlayer({audio:f.audio,environment:f.environment,read:async function*(){yield new Uint8Array([1]);},onState:v=>f.states.push(v),onError:e=>f.errors.push(e)});await player.run();assert.equal(calls,1);player.pause();const resume=player.play();assert.equal(calls,2);await resume;rejectOld(new DOMException('previous play canceled','AbortError'));await tick();assert.equal(f.audio.paused,false);assert.equal(f.states.at(-1).phase,'playing');assert.deepEqual(f.errors,[]);assert.equal(f.sources.length,1);player.stop();
});
test('暂停连续播放后任务更新不会自动恢复，继续播放不增加读取连接',async()=>{
 const f=fixture();await f.playback.update(f.task,{autoplay:true});await until(()=>f.latest().playing);await f.playback.play();assert.equal(f.audio.paused,true);await f.playback.update({...f.task,status:'SETTLING'},{autoplay:true});assert.equal(f.audio.paused,true);await f.playback.play();assert.equal(f.audio.paused,false);assert.equal(f.streams.length,1);f.playback.stop();assert.equal(f.urls.size,0);
});
test('不支持连续解码时等待首段，后续片段准备好后衔接且不会重复播放首段',async()=>{
 const f=fixture({supported:false});await f.playback.update(f.task,{autoplay:true});assert.equal(f.latest().phase,'waiting');assert.equal(f.streams.length,0);await f.playback.update({...f.task,audio:[{url:'/api/voice/tasks/original-voice/audio/0'}]});assert.equal(f.audio.paused,false);assert.equal(f.fetches.length,1);f.audio.onended();assert.equal(f.latest().phase,'waiting');await f.playback.update({...f.task,audio:[{url:'/api/voice/tasks/original-voice/audio/0'}]});assert.equal(f.fetches.length,1);await f.playback.update({...f.task,audio:[{url:'/api/voice/tasks/original-voice/audio/0'},{url:'/api/voice/tasks/original-voice/audio/1'}]});assert.equal(f.latest().part,1);assert.equal(f.fetches.length,2);f.playback.stop();
});
test('等待下一段时暂停，迟到片段保持安静，继续后只读取下一段',async()=>{
 const f=fixture({supported:false}),one={...f.task,audio:[{url:'/api/voice/tasks/original-voice/audio/0'}]};await f.playback.update(one,{autoplay:true});f.audio.onended();await f.playback.play();assert.equal(f.latest().phase,'paused');await f.playback.update({...one,audio:[...one.audio,{url:'/api/voice/tasks/original-voice/audio/1'}]});assert.equal(f.fetches.length,1);await f.playback.play();assert.equal(f.latest().part,1);assert.equal(f.fetches.length,2);f.playback.stop();
});
test('音频读取期间暂停，迟到的声音只准备好，不擅自开始播放',async()=>{
 const f=fixture({supported:false}),gate=deferred(),states=[],p=createVoicePlayback({getAudio:()=>f.audio,environment:f.environment,loadBlob:()=>gate.promise,readStream:()=>{},onChange:v=>states.push(v)}),starting=p.update({...f.task,audio:[{url:'/api/voice/tasks/original-voice/audio/0'}]},{autoplay:true});await tick();await p.play();gate.resolve(new Blob(['voice']));await starting;assert.equal(f.audio.playCalls,0);assert.equal(states.at(-1).requested,false);await p.play();assert.equal(f.audio.playCalls,1);p.stop();
});
test('离开原任务后迟到音频不创建地址、不播放，已有地址与连接均被释放',async()=>{
 const f=fixture({supported:false}),gate=deferred(),p=createVoicePlayback({getAudio:()=>f.audio,environment:f.environment,loadBlob:()=>gate.promise,readStream:()=>{}}),starting=p.update({...f.task,audio:[{url:'/api/voice/tasks/original-voice/audio/0'}]},{autoplay:true});p.stop();gate.resolve(new Blob(['private old voice']));await starting;assert.equal(f.audio.playCalls,0);assert.equal(f.urls.size,0);
});
test('停止或失败的任务撤回临时播放，后续更新不会重连或自动播放',async()=>{
 const f=fixture();await f.playback.update(f.task,{autoplay:true});await until(()=>f.latest().playing);await f.playback.update({...f.task,status:'CANCELED',streamUrl:null,audio:[]},{autoplay:true});assert.equal(f.audio.paused,true);assert.equal(f.latest().requested,false);assert.equal(f.urls.size,0);assert.equal(f.streams.length,1);
});
test('能力判断拒绝不可用类型和受限入口，回退不创建声音连接',()=>{assert.equal(supportsVoiceStream({}),false);assert.equal(supportsVoiceStream({get MediaSource(){throw Error('blocked');}}),false);const f=fixture({supported:false});assert.equal(createVoiceStreamPlayer({audio:f.audio,environment:f.environment,read:()=>{throw Error('unexpected read');}}),null);});
test('正在读取首段时暂停再继续，会复用同一次读取',async()=>{
 const f=fixture({supported:false}),gate=deferred();let reads=0;const p=createVoicePlayback({getAudio:()=>f.audio,environment:f.environment,loadBlob:()=>{reads++;return gate.promise;},readStream:()=>{}}),starting=p.update({...f.task,audio:[{url:'/api/voice/tasks/original-voice/audio/0'}]},{autoplay:true});await tick();await p.play();await p.play();assert.equal(reads,1);gate.resolve(new Blob(['voice']));await starting;assert.equal(f.audio.playCalls,1);p.stop();
});
