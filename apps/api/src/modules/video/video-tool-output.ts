import {inspectMp4,VideoFormatError} from './video-protocol';
import {inspectVideoMaterial} from './video-materials';
import type {NativeVideoIntent} from './video.provider';
import type {VideoInputs} from './video.service';
import {VIDEO_TOOL_MODES} from './video-profiles';
/** Check advertised processing results before private storage or settlement. No visual-quality claim. */
export function inspectVideoToolOutput(bytes:Buffer,intentJson:string,inputJson:string|null){
 const intent:NativeVideoIntent=JSON.parse(intentJson);if(!VIDEO_TOOL_MODES.includes(intent.mode))return inspectMp4(bytes);
 const info=inspectVideoMaterial(bytes),input:VideoInputs=JSON.parse(inputJson||'{}'),source=input.materials?.find(x=>x.kind==='video'),audio=input.materials?.find(x=>x.kind==='audio');
 if(intent.mode==='upscale'){
  const factor=intent.upscaleFactor!;if(!source?.width||!source.height||!source.duration||Math.abs(info.width-source.width*factor)>2||Math.abs(info.height-source.height*factor)>2||Math.abs(info.duration-source.duration)>.5)throw new VideoFormatError('精修结果与确认的画幅、倍率或时长不符');
 }
 if(intent.mode==='edit'&&(!source?.duration||!source.width||!source.height||Math.abs(info.duration-source.duration)>.5||Math.abs(info.width/info.height-source.width/source.height)>.02))throw new VideoFormatError('改写结果未保留原片画幅或时长');
 if(intent.mode==='lipsync'){
  if(!info.hasAudio||!source?.duration||!audio?.duration)throw new VideoFormatError('口型成片没有完整声音与视频轨');const expected=intent.syncMode==='cut_off'?Math.min(source.duration,audio.duration):intent.syncMode==='silence'?Math.max(source.duration,audio.duration):audio.duration;
  if(Math.abs(info.duration-expected)>.5)throw new VideoFormatError('口型成片时长与确认的声音处理方式不符');
 }
 return info;
}
