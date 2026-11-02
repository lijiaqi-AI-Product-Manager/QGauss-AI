import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import type { MjQuoteDto } from './mj.dto';
import type { MjAction } from './mj-protocol';
import { mjFeatures } from './mj-profiles';
function bad(message:string):never{throw new BusinessException(ErrorCode.PARAM_INVALID,message);}
export interface MjIntent {presetId:string;kind:string;prompt:string;model?:string;version?:string;ratio?:string;quality?:number;hd?:boolean;raw?:boolean;stylize?:number;chaos?:number;seed?:number;negativePrompt?:string;imageWeight?:number;characterWeight?:number;styleWeight?:number;references?:Array<{id:string;role:string}>;dimensions?:string;sourceTaskId?:string;actionId?:string;action?:MjAction;maskId?:string;zoom?:number;remix?:boolean;strong?:boolean;motion?:string;videoType?:string;batchSize?:number;loop?:boolean;sourceIndex?:number}
type Features=ReturnType<typeof mjFeatures>;
/** Parse exposed native flags before quoting. Unknown cost-changing flags never slip past the quote. */
function promptFlags(raw:string) {
  const tokens=[...raw.matchAll(/(?:^|\s)--([a-z][a-z0-9-]*)\b/gi)];const out:any={};
  if(!tokens.length)return {prompt:raw.trim(),values:out};
  const names:Record<string,string>={ar:'ratio',aspect:'ratio',v:'version',version:'version',niji:'niji',q:'quality',quality:'quality',s:'stylize',stylize:'stylize',c:'chaos',chaos:'chaos',seed:'seed',no:'negativePrompt',iw:'imageWeight',cw:'characterWeight',ow:'characterWeight',sw:'styleWeight',hd:'hd',raw:'raw',style:'style',fast:'fast',relax:'relax',turbo:'turbo'};
  for(let i=0;i<tokens.length;i++){const token=tokens[i],key=names[token[1].toLowerCase()],value=raw.slice(token.index!+token[0].length,tokens[i+1]?.index??raw.length).trim();if(!key)bad('描述含有尚未开放的原生参数 --'+token[1]+'，请移除后再确认');if(out[key]!==undefined)bad('同一原生参数只能填写一次');
    if(['hd','raw','fast','relax','turbo'].includes(key)){if(value)bad('--'+token[1]+' 后不接其他文字');out[key]=true;}
    else if(key==='style'){if(value!=='raw')bad('当前仅开放原生 raw 风格，请在描述中表达其他风格');out.raw=true;}
    else if(key==='niji'){if(value&&value!=='6')bad('当前连接仅开放 Niji 6');out.model='niji';out.version='6';out.niji=true;}
    else if(['ratio','version','negativePrompt'].includes(key)){if(!value)bad('原生参数值不能为空');out[key]=value;}
    else {if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))bad('原生参数需要有效数字');out[key]=Number(value);}
  }
  return {prompt:raw.slice(0,tokens[0].index).trim(),values:out};
}
export function makeMjIntent(dto:MjQuoteDto,features:Features,speed:string,action?:MjAction):MjIntent {
  const prompt=dto.prompt.trim(),base:MjIntent={presetId:dto.presetId,kind:dto.kind,prompt};
  if(!features.kinds.includes(dto.kind)&&dto.kind!=='action')bad('此连接未开放该创作方式');
  const references=(dto.references||[]).map(r=>({id:r.id,role:r.role}));if(new Set(references.map(r=>r.id)).size!==references.length)bad('参考素材不能重复');
  if(dto.kind==='action'){
    if(!dto.sourceTaskId||!dto.actionId||!action?.supported||action.virtual)bad('请从本人作品选择已适配的原生操作');
    if(references.length||dto.sourceIndex!==undefined)bad('此动作沿用来源作品，不接收新参考素材');
    if(action.needsMask?!dto.maskId:dto.maskId!==undefined)bad('当前动作的重绘选区不完整');
    if(action.needsPrompt&&!prompt)bad('请补充这次希望改变的内容');
    // Modal parameters cannot silently alter the reserved model, quality, batch or speed.
    const flags=[...prompt.matchAll(/(?:^|\s)--([a-z][a-z0-9-]*)\b/gi)];
    if(flags.some(f=>!['zoom','ar','aspect'].includes(f[1].toLowerCase()))||flags.length&&!action.customId?.startsWith('MJ::CustomZoom::'))bad('此动作保留原模型与费用参数；请在自由创作台调整模型或画质');
    if(action.customId?.startsWith('MJ::CustomZoom::')){const zoom=/(?:^|\s)--zoom\s+(\d+(?:\.\d+)?)(?=\s|$)/i.exec(prompt);if(zoom&&(Number(zoom[1])<1||Number(zoom[1])>2))bad('自定义扩图描述需包含 --zoom 1 到 2，例如 --zoom 1.5');for(const f of flags.filter(f=>f[1]!=='zoom')){const value=prompt.slice(f.index!+f[0].length).trim().split(/\s/)[0];const m=/^(\d{1,4}):(\d{1,4})$/.exec(value);if(!m||!Number(m[1])||!Number(m[2])||Math.max(+m[1]/+m[2],+m[2]/+m[1])>14)bad('扩图画幅无效');}}
    return {...base,sourceTaskId:dto.sourceTaskId,actionId:dto.actionId,action,...(action.customZoom?{zoom:dto.zoom??Number(/--zoom\s+(\d+(?:\.\d+)?)/i.exec(prompt)?.[1]||1.5)}:{}),...(dto.maskId?{maskId:dto.maskId}:{}),remix:dto.remix??false,strong:dto.strong??false};
  }
  if(dto.kind==='video'){
    if(speed==='relax' && dto.videoType==='vid_1.1_i2v_720')bad('720p 短片请使用快速连接，悠闲连接使用 480p');if(!prompt)bad('请描述这一幕的运动与画面');if(/(?:^|\s)--[a-z]/i.test(prompt))bad('短片参数请在创作台选择，描述中不接收原生参数');
    if(dto.sourceTaskId){if(!action?.virtual||!['video','video_extend'].includes(action.kind)||references.length)bad('来源片段或画面操作无效');}
    else {if(references.filter(r=>r.role==='first').length!==1||references.filter(r=>r.role==='last').length>1||references.some(r=>!['first','last'].includes(r.role)))bad('短片需要一张首帧，可另选一张尾帧');if(dto.loop&&references.some(r=>r.role==='last'))bad('循环短片使用首帧作尾帧，请移除独立尾帧');}
    return {...base,motion:dto.motion||'low',videoType:dto.videoType||'vid_1.1_i2v_480',batchSize:dto.batchSize??4,loop:dto.loop??false,...(dto.sourceTaskId?{sourceTaskId:dto.sourceTaskId,sourceIndex:dto.sourceIndex??0,action}:{references})};
  }
  if(['blend','describe','swap'].includes(dto.kind)){
    if(dto.sourceTaskId||dto.maskId)bad('当前创作不接收来源任务或选区');
    if(dto.kind==='blend'&&(references.length<2||references.length>features.blendLimit||references.some(r=>r.role!=='image')))bad('融合需要 2–'+features.blendLimit+' 张画面参考');
    if(dto.kind==='describe'&&(references.length!==1||references[0].role!=='image'))bad('读懂画面需要一张画面参考');
    if(dto.kind==='swap'&&(references.length!==2||references.filter(r=>r.role==='faceSource').length!==1||references.filter(r=>r.role==='faceTarget').length!==1))bad('人物合成需要各一张来源人物与目标画面');
    return {...base,references,...(dto.kind==='blend'?{dimensions:dto.dimensions||'SQUARE'}:{})};
  }
  if(dto.kind==='shorten'){if(!prompt)bad('请填写需要精简的描述');if(/(?:^|\s)--[a-z]/i.test(prompt))bad('精简描述不接收原生绘画参数');if(references.length)bad('精简描述不需要图片');return base;}
  const parsed=promptFlags(prompt),f=parsed.values;if(!parsed.prompt)bad('请先描述想象中的画面');for(const mode of ['fast','relax','turbo'])if(f[mode]&&mode!==speed)bad('原生速度参数与所选创作连接不一致');
  const model=f.model||dto.model||'mj',version=f.version||dto.version||features.versions[model]?.[0],quality=f.quality??(f.version?.startsWith('8.')?0:dto.quality??(version?.startsWith('8.')?0:1));
  if(version?.startsWith('8.') && speed === 'turbo')bad('V8.1 与 V8.2 未开放 Turbo，请选择快速或悠闲连接');
  if(!features.versions[model]?.includes(version))bad('此连接未开放所选模型版本');
  if(!(features.qualities[version]||[]).includes(quality))bad('所选版本不支持此画质；V8.1 与 V8.2 使用模型默认画质');
  const ratio=f.ratio||dto.ratio||'1:1',m=/^(\d{1,4}):(\d{1,4})$/.exec(ratio),hd=f.hd??dto.hd??false;
  if(!m||!+m[1]||!+m[2]||Math.max(+m[1]/+m[2],+m[2]/+m[1])>(hd?4:14))bad(hd?'HD 画幅最大为 4:1 或 1:4':'画幅比例需要在 1:14 到 14:1 之间');
  if(hd&&!features.hdVersions.includes(version))bad('此版本未开放原生 HD');
  const params={stylize:f.stylize??dto.stylize??100,chaos:f.chaos??dto.chaos??0,seed:f.seed??dto.seed,imageWeight:f.imageWeight??dto.imageWeight??1,characterWeight:f.characterWeight??dto.characterWeight??100,styleWeight:f.styleWeight??dto.styleWeight??100};
  for(const [key,limit]of [['stylize',1000],['chaos',100],['seed',4294967295],['characterWeight',version==='7'?1000:100],['styleWeight',1000]] as const)if(params[key]!==undefined&&(!Number.isInteger(params[key])||params[key]!<0||params[key]!>limit))bad('原生参数 '+key+' 超出当前版本范围');
  if(!Number.isFinite(params.imageWeight)||params.imageWeight<0||params.imageWeight>(version==='5.2'?2:3))bad('画面参考权重超出当前版本范围');
  if(references.some(r=>!features.roles[version]?.includes(r.role))||references.filter(r=>r.role==='character').length>1)bad('当前版本不接收所选参考类型或数量');
  if(version==='7'&&quality===4&&references.some(r=>r.role==='character'))bad('V7 的 4 倍画质不能同时使用主体参考');
  const negativePrompt=f.negativePrompt??dto.negativePrompt??'';if(/(?:^|\s)--[a-z]/i.test(negativePrompt))bad('反向描述不能包含原生参数');
  return {...base,prompt:parsed.prompt,model,version,ratio,quality,hd,raw:f.raw??dto.raw??false,...params,negativePrompt,references};
}
export function compileMjPrompt(intent:MjIntent,urls:Array<{role:string;url:string}>,speed:string) {
  const pieces=[...urls.filter(r=>r.role==='image').map(r=>r.url),intent.prompt];
  pieces.push(intent.model==='niji'?'--niji '+intent.version:'--v '+intent.version,'--ar '+intent.ratio);
  if(intent.quality)pieces.push('--q '+intent.quality);if(intent.hd)pieces.push('--hd');if(intent.raw)pieces.push(['5.2','6','6.1'].includes(intent.version!)?'--style raw':'--raw');
  if(intent.stylize!==undefined)pieces.push('--s '+intent.stylize);if(intent.chaos!==undefined)pieces.push('--c '+intent.chaos);if(intent.seed!==undefined)pieces.push('--seed '+intent.seed);if(intent.negativePrompt)pieces.push('--no '+intent.negativePrompt);
  const image=urls.some(r=>r.role==='image'),style=urls.filter(r=>r.role==='style'),character=urls.find(r=>r.role==='character');if(image)pieces.push('--iw '+intent.imageWeight);
  if(style.length)pieces.push('--sref '+style.map(r=>r.url).join(' '),'--sw '+intent.styleWeight);
  if(character)pieces.push((intent.version==='7'?'--oref ':'--cref ')+character.url,(intent.version==='7'?'--ow ':'--cw ')+intent.characterWeight);
  pieces.push('--'+speed);return pieces.join(' ');
}
