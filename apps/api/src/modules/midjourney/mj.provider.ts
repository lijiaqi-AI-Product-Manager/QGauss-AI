import { Injectable } from '@nestjs/common';
import { videoResultUrl } from '../video/video-protocol';
import { compileMjPrompt, MjIntent } from './mj-intent';
import { MjRoute, mjRequest, mjSubmission, MjUpstreamError, MjState, normalizeMjState } from './mj-protocol';
export interface MjPrepared {images:Array<{buffer:Buffer;mime:string}>;maskImage?:{buffer:Buffer;mime:string};sourceImage?:Buffer;sourceUpstreamId?:string}
const data=(image:{buffer:Buffer;mime:string})=>`data:${image.mime};base64,${image.buffer.toString('base64')}`;
@Injectable()
export class MjProvider {
  async submit(route:MjRoute,key:string,preset:any,intent:MjIntent,inputs:MjPrepared,signal:AbortSignal,onAttempt:()=>void):Promise<{id:string;modal:boolean;direct?:MjState}> {
    const filter={modes:[preset.speed.toUpperCase()]},common={state:'qgauss',notifyHook:'',accountFilter:filter};let path='submit/'+intent.kind,payload:any;
    if(intent.kind==='imagine'){
      const urls:Array<{role:string;url:string}>=[];
      if(inputs.images.length){const body=await mjRequest(route,key,'submit/upload-discord-images',{base64Array:inputs.images.map(data),accountFilter:filter},signal);const raw=body?.result;if(![0,1].includes(body?.code)||!Array.isArray(raw)||raw.length!==inputs.images.length)throw new MjUpstreamError(200,false,body?.code);for(let i=0;i<raw.length;i++){const url=videoResultUrl(raw[i]);if(!url)throw new MjUpstreamError(200);urls.push({role:intent.references![i].role,url});}}
      payload={...common,botType:intent.model==='niji'?'NIJI_JOURNEY':'MID_JOURNEY',prompt:compileMjPrompt(intent,urls,preset.speed),base64Array:[]};
    }else if(intent.kind==='blend')payload={...common,botType:'MID_JOURNEY',base64Array:inputs.images.map(data),dimensions:intent.dimensions};
    else if(intent.kind==='describe')payload={...common,botType:'MID_JOURNEY',base64:data(inputs.images[0])};
    else if(intent.kind==='shorten')payload={...common,prompt:intent.prompt};
    else if(intent.kind==='swap'){path='insight-face/swap';payload={...common,sourceBase64:data(inputs.images[intent.references!.findIndex(r=>r.role==='faceSource')]),targetBase64:data(inputs.images[intent.references!.findIndex(r=>r.role==='faceTarget')])};}
    else if(intent.kind==='action')payload={...common,taskId:inputs.sourceUpstreamId,customId:intent.action!.customId,chooseSameChannel:true,enableRemix:intent.remix,strong:intent.strong};
    else if(intent.kind==='video'){
      const extend=intent.action?.kind==='video_extend';payload={...common,prompt:intent.prompt,motion:intent.motion,videoType:intent.videoType,batchSize:intent.batchSize,loop:intent.loop,...(extend?{taskId:inputs.sourceUpstreamId,action:'extend',index:intent.sourceIndex??0}:{image:inputs.sourceImage?data({buffer:inputs.sourceImage,mime:'image/png'}):data(inputs.images[intent.references!.findIndex(r=>r.role==='first')]),...(!intent.loop&&intent.references?.some(r=>r.role==='last')?{endImage:data(inputs.images[intent.references.findIndex(r=>r.role==='last')])}:{})})};
    }else throw Error('MJ 创作方式未适配');
    signal.throwIfAborted();onAttempt();const body=await mjRequest(route,key,path,payload,signal,true);
    if(intent.kind==='swap'&&body?.code===0&&videoResultUrl(body.result))return{id:'',modal:false,direct:{id:'',status:'succeeded',progress:100,imageUrl:videoResultUrl(body.result),posterUrl:null,videos:[],text:null,buttons:[],grid:false}};
    const accepted=mjSubmission(body,preset.profile);if(accepted.modal&&intent.kind!=='action')throw new MjUpstreamError(200,true);return accepted;
  }
  async modal(route:MjRoute,key:string,profile:string,id:string,prompt:string,maskImage:MjPrepared['maskImage'],signal:AbortSignal,onAttempt:()=>void){signal.throwIfAborted();onAttempt();return mjSubmission(await mjRequest(route,key,'submit/modal',{taskId:id,prompt,...(maskImage?{maskBase64:data(maskImage)}:{})},signal,true),profile,true);}
  async poll(route:MjRoute,key:string,id:string,signal:AbortSignal){return normalizeMjState(await mjRequest(route,key,'task/'+encodeURIComponent(id)+'/fetch',undefined,signal),id);}
  async cancel(route:MjRoute,key:string,profile:string,id:string,signal:AbortSignal){if(profile!=='PLUS')return'LOCAL_ONLY';await mjRequest(route,key,'task/'+encodeURIComponent(id)+'/cancel',{},signal);return'ACKNOWLEDGED';}
}
