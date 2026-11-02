import { createHash } from 'node:crypto';
import { safeFetch } from '../../common/net/safe-fetch';
import { readVideoBody, videoResultUrl } from '../video/video-protocol';
import { mjName } from './mj-profiles';
export function mjHash(value: unknown): string { const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
export interface MjRoute {channelId:string;baseUrl:string;timeoutMs:number;keyId:string|null;keyHash:string;authMode:string}
export interface MjAction {id:string;customId?:string;label:string;group:string;kind:string;priceKey:string;needsMask?:boolean;needsPrompt?:boolean;customZoom?:boolean;supported:boolean;reason?:string;index?:number;virtual?:boolean;defaultPrompt?:string}
export interface MjState {id:string;status:'queued'|'running'|'succeeded'|'failed'|'modal';progress:number;imageUrl:string|null;videos:string[];posterUrl:string|null;text:string|null;buttons:Array<{customId:string;label:string}>;grid:boolean;seed?:string}
export class MjUpstreamError extends Error {constructor(public readonly status:number,public readonly uncertain=false,public readonly code?:number){super('MJ 服务暂未完成本次请求');}}
export function mjId(raw:unknown) {if(typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0)raw=String(raw);if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(raw))throw Error('MJ 原生任务编号无效');return raw;}
export function mjEndpoint(base:string,path:string) {const u=new URL(base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('MJ 原连接入口格式无效');u.pathname=u.pathname.replace(/\/+$/,'').replace(/\/mj(?:\/(?:fast|relax|turbo))?$/i,'')+'/mj/'+path;return u.href;}
export function mjActions(taskId:string,buttons:Array<{customId:string;label:string}>,video:boolean,grid:boolean,videos=0):MjAction[] {
  const items:MjAction[]=[];const seen=new Set<string>();
  for(const b of buttons.slice(0,40)){if(!b||typeof b.customId!=='string'||b.customId.length>500||!/^[A-Za-z0-9_:.-]+$/.test(b.customId)||seen.has(b.customId))continue;seen.add(b.customId);let kind='',label=b.label?.slice(0,60)||'',group='继续打磨',needsPrompt=false,needsMask=false;
    const customId=b.customId,u=/^MJ::JOB::upsample::([1-4])::/.exec(customId),v=/^MJ::JOB::variation::([1-4])::/.exec(customId),p=/^MJ::JOB::pan_(left|right|up|down)::/.exec(customId);
    if(u){kind='upscale';label='放大 '+u[1];group='选一张，再近一点';}
    else if(v){kind='variation';label='变化 '+v[1];group='换一种可能';}
    else if(/^MJ::JOB::(high|low)_variation::/.test(customId)){kind='variation';label=customId.includes('high_')?'大幅变化':'轻微变化';group='换一种可能';}
    else if(/^MJ::JOB::reroll::/.test(customId)){kind='reroll';label='重新想象';group='换一种可能';}
    else if(p){kind='pan';label='向'+({left:'左',right:'右',up:'上',down:'下'})[p[1]]+'扩展';}
    else if(/^MJ::JOB::upsample_[A-Za-z0-9_]+::/.test(customId)){kind='upscale';label=label||'精细放大';}
    else if(/^MJ::Outpaint::/.test(customId)){kind='outpaint';label=label||'扩展画面';}
    else if(/^MJ::CustomZoom::/.test(customId)){kind='outpaint';label='自定义扩图';needsPrompt=true;}
    else if(/^MJ::Inpaint::/.test(customId)){kind='inpaint';label='局部重绘';needsMask=needsPrompt=true;}
    else if(/^MJ::Job::PicReader/.test(customId)){kind='imagine';label=label||'沿这份描述创作';group='从文字，走向画面';}
    else if(customId.includes('MJ::Picread::Retry')){kind='describe';label='重新读懂画面';}
    else if(/^MJ::JOB::animate_/.test(customId)){kind=customId.includes('_extend')?'video_extend':'video';label=label||mjName(kind);group='下一幕';}
    const nativeVideo=kind==='video'||kind==='video_extend';
    items.push({id:mjHash({taskId,customId}).slice(0,32),customId,label:label||'服务新增操作',group,kind:kind||'unknown',priceKey:kind||'unknown',needsMask,needsPrompt,...(customId.startsWith('MJ::CustomZoom::')?{customZoom:true}:{}),supported:!!kind&&(!nativeVideo||video),...(!kind?{reason:'此原生动作尚未适配，请保留作品稍后继续'}:nativeVideo&&!video?{reason:'此连接尚未开启短片创作'}:{})});
  }
  if(video){for(let index=0;index<(videos|| (grid?4:1));index++){const kind=videos?'video_extend':'video';items.push({id:mjHash({taskId,kind,index}).slice(0,32),label:videos?'续写片段 '+(index+1):grid?'让画面 '+(index+1)+' 动起来':'让画面动起来',group:'下一幕',kind,priceKey:kind,supported:true,index,virtual:true});}}
  return items;
}
export function normalizeMjState(body:any,expected:string):MjState {
  const id=mjId(body?.id);if(id!==expected)throw Error('MJ 返回了不同任务');const raw=String(body.status||'');let status:MjState['status'];
  if(body.remixModaling===true||raw==='MODAL')status='modal';else if(raw==='SUCCESS')status='succeeded';else if(['FAILURE','FAILED','CANCELED','CANCELLED'].includes(raw))status='failed';else if(['NOT_START','SUBMITTED'].includes(raw))status='queued';else if(raw==='IN_PROGRESS')status='running';else throw Error('MJ 返回了未知状态');
  const buttons=(Array.isArray(body.buttons)?body.buttons:[]).slice(0,40).filter(b=>b&&typeof b.customId==='string').map(b=>({customId:b.customId,label:typeof b.label==='string'?b.label:''}));
  const entries:any[]=Array.isArray(body.videoUrls)?body.videoUrls:[];let videos:string[]=entries.map(v=>videoResultUrl(typeof v==='string'?v:v?.url||v?.videoUrl)).filter((v):v is string=>!!v);
  if(entries.length>4||entries.length&&videos.length!==entries.length)throw Error('MJ 原生片段列表不完整');
  const single=videoResultUrl(body.videoUrl);if(!videos.length&&single)videos=[single];const imageUrl=videoResultUrl(body.imageUrl);
  // Some gateways place a VIDEO result in imageUrl. Never interpret its poster as a still result.
  if(!videos.length&&body.action==='VIDEO'&&imageUrl&&/\.mp4(?:$|[?#])/i.test(imageUrl))videos=[imageUrl];
  const text=typeof body.properties?.finalPrompt==='string'?body.properties.finalPrompt:typeof body.description==='string'?body.description:null;
  const seed=typeof body.seed==='string'||typeof body.seed==='number'?String(body.seed):undefined,p=Number(String(body.progress??'').replace('%',''));
  return {id,status,progress:status==='succeeded'?100:Number.isFinite(p)?Math.max(0,Math.min(98,Math.floor(p))):0,imageUrl:videos.length?null:imageUrl,videos:videos.slice(0,4),posterUrl:videos.length?videoResultUrl(body.videoGenOriginImageUrl)||videoResultUrl(entries[0]?.thumbnail):null,text:text?.slice(0,32000)||null,buttons,grid:buttons.some(b=>/^MJ::JOB::upsample::[1-4]::/.test(b.customId)),...(seed&&/^\d{1,20}$/.test(seed)?{seed}:{})};
}
export async function mjRequest(route:MjRoute,key:string,path:string,payload:unknown,outer:AbortSignal,submit=false) {
  const signal=AbortSignal.any([outer,AbortSignal.timeout(route.timeoutMs)]);let responded=false;
  try{const response=await safeFetch(mjEndpoint(route.baseUrl,path),{method:payload===undefined?'GET':'POST',headers:{...(route.authMode==='BEARER'?{Authorization:'Bearer '+key}:{'mj-api-secret':key}),...(payload===undefined?{}:{'Content-Type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)})},{signal,timeoutMs:route.timeoutMs,allowHttp:process.env.ALLOW_HTTP_UPSTREAM==='1'});responded=true;if(!response.ok){await response.body?.cancel().catch(()=>{});throw new MjUpstreamError(response.status,submit&&response.status>=500);}
    if(path.endsWith('/cancel')){await response.body?.cancel().catch(()=>{});return null;}const body=await readVideoBody(response,2*1024*1024,signal);try{return JSON.parse(body.toString('utf8').replace(/("(?:id|result)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,'$1"$2"'));}catch{throw new MjUpstreamError(0,submit);}
  }catch(e){if(e instanceof MjUpstreamError)throw e;throw new MjUpstreamError(0,submit||!responded);}
}
export function mjSubmission(body:any,profile:string,modal=false):{id:string;modal:boolean} {
  const code=body?.code;if(!Number.isInteger(code))throw new MjUpstreamError(0,true);
  // PLUS reserves 21 for a modal; the original open-source proxy uses 21 for an existing task.
  if(![1,22,...(profile==='PROXY'||!modal?[21]:[])].includes(code))throw new MjUpstreamError(200,false,code);
  return {id:mjId(body.result),modal:profile==='PLUS'&&code===21};
}
