import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import type {VideoQuoteDto} from './video.dto';
import type {NativeVideoIntent} from './video.provider';
import type {VideoMaterial} from './video-materials';
import {videoFeatures,UPSCALE_MODELS} from './video-profiles';
import {normalizeVideoSpeaker} from './video-speaker';
function bad(message:string):never{throw new BusinessException(ErrorCode.PARAM_INVALID,message,400);}
const controls=['upscaleFactor','enhanceModel','compression','noise','halo','grain','recoverDetail'];
export function videoToolIntent(dto:VideoQuoteDto,profile:string,presetId:string):NativeVideoIntent{
 const features=videoFeatures(profile),mode=dto.mode,prompt=dto.prompt.trim()||({upscale:'让每一帧，再清楚一点。',lipsync:'让画面，接住这一段声音。'})[mode];
 if(!features.modes.includes(mode)||!prompt)bad('请选择支持此处理方式的模型，并填写画面描述');
 if(dto.sourceTaskId!==undefined||['style','motion','guidanceScale','frameRate','pan','tilt','rotate','zoom','negativePrompt'].some(k=>dto[k]!==undefined))bad('此处理方式不接收旧版运镜或续写参数');
 const fal=profile.startsWith('FAL_'),following=['edit','upscale','lipsync'].includes(mode),seconds=dto.seconds??(following?0:5),ratio=dto.ratio,resolution=fal?'':dto.resolution||'720p';
 if(following?seconds!==0:!features.seconds.includes(seconds))bad('此处理的时长选项无效');if(mode==='edit'?ratio!=='adaptive':!features.ratios.includes(ratio))bad('所选处理方式不支持此画幅');
 if(fal?(dto.resolution!==undefined||dto.seed!==undefined||dto.sound!==undefined):!features.resolutions.includes(resolution))bad('所选处理方式不支持此清晰度、种子或同步声音参数');
 if(mode!=='upscale'&&controls.some(k=>dto[k]!==undefined)||mode!=='lipsync'&&dto.syncMode!==undefined)bad('处理选项与当前创作方式不符');
 if(mode!=='lipsync'&&dto.speakerSelection!==undefined)bad('人物选择只用于口型同步');
 const caps=mode==='edit'?{...features.referenceLimits!,video:1}:features.referenceLimits!,counts=Object.fromEntries(['image','video','audio'].map(kind=>[kind,(dto[kind+'Ids']||[]).length]));
 const all=['image','video','audio'].flatMap(kind=>dto[kind+'Ids']||[]);if(!all.length||new Set(all).size!==all.length)bad('请加入不重复的素材');for(const kind of ['image','video','audio'])if(counts[kind]>caps[kind])bad('素材数量超过当前模型上限');
 if(following&&counts.video!==1||mode==='lipsync'&&counts.audio!==1)bad('请选择一条原片；口型同步还需要一段声音');if(mode==='reference'&&!features.audioOnly&&!counts.image&&!counts.video)bad('这个模型不能只用声音生成视频，请搭配图片或视频');
 const result:NativeVideoIntent={presetId,mode,prompt,ratio,seconds,resolution,...Object.fromEntries(['imageIds','videoIds','audioIds'].filter(k=>dto[k]!==undefined).map(k=>[k,[...dto[k]]])),...(!fal?{sound:dto.sound??true,...(dto.seed===undefined?{}:{seed:dto.seed})}:{})};
 if(mode==='upscale'){const factor=dto.upscaleFactor??2,model=dto.enhanceModel||'Proteus';if(!Number.isFinite(factor)||factor<1||factor>4||!UPSCALE_MODELS.includes(model))bad('精修模型或放大倍率无效');if(['Proteus Natural','Gaia 2'].includes(model)&&factor!==2)bad('这个精修模型只支持 2 倍放大');Object.assign(result,{upscaleFactor:factor,enhanceModel:model});for(const k of controls.slice(2))if(dto[k]!==undefined){if(!Number.isFinite(dto[k])||dto[k]<0||dto[k]>(k==='grain'?.1:1))bad('精修强度超出范围');result[k]=dto[k];}}
 if(mode==='lipsync'){const syncMode=dto.syncMode||'cut_off';if(!['cut_off','loop','bounce','silence','remap'].includes(syncMode))bad('请选择支持的时长处理方式');result.syncMode=syncMode;const speaker=normalizeVideoSpeaker(dto.speakerSelection);if(speaker){if(speaker.videoId!==dto.videoIds?.[0])bad('人物选择与原视频不符，请重新点选');result.speakerSelection=speaker;}}
 return result;
}
export function validateVideoToolMaterials(intent:NativeVideoIntent,profile:string,materials:VideoMaterial[]){
 const videos=materials.filter(x=>x.kind==='video'),audio=materials.filter(x=>x.kind==='audio');
 if(!profile.startsWith('FAL_')){
  const duration=profile==='ARK_2_5'?30:15;for(const kind of ['video','audio']){const items=materials.filter(x=>x.kind===kind);if(items.some(x=>!x.duration||x.duration<2||x.duration>duration+.05)||items.reduce((n,x)=>n+x.duration!,0)>duration+.05)bad('参考'+(kind==='video'?'视频':'声音')+'单份及合计时长须在 2–'+duration+' 秒范围内');}
  for(const m of materials){if(m.kind==='audio'){if(m.size>15*1024*1024)bad('当前模型声音参考每段最多 15 MB');continue;}const w=m.width!,h=m.height!;if(Math.min(w,h)<300||Math.max(w,h)>6000||w/h<.4||w/h>2.5||w*h>8295044||m.kind==='video'&&(w*h<407696||!['avc1','avc3','hvc1','hev1'].includes(m.codec!)||m.fps!<23.99||m.fps!>60.01))bad('参考画面尺寸、视频编码或帧率不符合当前模型范围');}
  if(intent.mode==='edit'&&(!videos[0]?.duration||videos[0].duration<4))bad('改写原片需要 4–30 秒视频');
 }
 if(['edit','upscale','lipsync'].includes(intent.mode)){
  const longest=intent.mode==='lipsync'?Math.max(videos[0]?.duration||0,audio[0]?.duration||0):videos[0]?.duration||0;if(!longest||longest>300.1)bad('素材时长无法确认或超过五分钟');intent.billingSeconds=Math.ceil(longest-1e-6);
 }
 return intent;
}
