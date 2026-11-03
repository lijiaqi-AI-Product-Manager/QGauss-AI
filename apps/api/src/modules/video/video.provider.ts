import { Injectable } from '@nestjs/common';
import { safeFetch } from '../../common/net/safe-fetch';
import { readVideoBody, videoEndpoint, videoJobId, videoResultUrl, VideoUpstreamError } from './video-protocol';
import type {VideoSpeakerSelection} from './video-speaker';

export interface VideoRoute { channelId: string; baseUrl: string; timeoutMs: number; keyId: string | null; keyHash: string; upstreamModel: string }
export interface NativeVideoIntent { presetId: string; mode: string; prompt: string; ratio: string; seconds: number; resolution: string; seed?: number; sound?: boolean; imageIds?: string[]; videoIds?:string[];audioIds?:string[];billingSeconds?:number;upscaleFactor?:number;enhanceModel?:string;syncMode?:string;speakerSelection?:VideoSpeakerSelection;compression?:number;noise?:number;halo?:number;grain?:number;recoverDetail?:number; sourceTaskId?: string; style?: string; motion?: number; guidanceScale?: number; frameRate?: number; pan?: string; tilt?: string; rotate?: string; zoom?: string; negativePrompt?: string }
export interface NativeVideoState { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'; progress: number; videoUrl: string | null; posterUrl: string | null; seed?: number }
export function normalizeVideoState(profile: string, body: any, expected?: string): NativeVideoState {
  const job = profile === 'PIKA_1' ? body?.job : body;
  const id = videoJobId(job?.id); if (expected && id !== expected) throw Error('视频服务返回了不同的任务');
  const raw = String(job.status || ''), success = profile === 'PIKA_1' ? raw === 'finished' : raw === 'succeeded';
  let state: NativeVideoState['status'];
  if (success) state = 'succeeded'; else if (['failed', 'error', 'expired'].includes(raw)) state = 'failed'; else if (['cancelled', 'canceled'].includes(raw)) state = 'canceled'; else if (['queued', 'delayed', 'pending'].includes(raw)) state = 'queued'; else if (['running', 'processing', 'generating', 'in_progress'].includes(raw)) state = 'running'; else throw Error('视频服务返回了未知任务状态');
  const videos = Array.isArray(body?.videos) ? body.videos : body?.video ? [body.video] : [];
  const video = videos.find(v => (!v.jobId || v.jobId === id) && v.resultUrl && (!v.status || v.status === 'finished'));
  const videoUrl = videoResultUrl(profile === 'PIKA_1' ? video?.resultUrl : body?.content?.video_url), posterUrl = videoResultUrl(profile === 'PIKA_1' ? video?.videoPoster || video?.imageThumb : body?.content?.last_frame_url);
  if (state === 'succeeded' && !videoUrl) state = 'running';
  const p = Number(profile === 'PIKA_1' ? video?.progress ?? job.progress : job.progress), progress = state === 'succeeded' ? 100 : Number.isFinite(p) ? Math.max(0, Math.min(99, Math.floor(p > 0 && p < 1 ? p * 100 : p))) : 0;
  const seed = Number(profile === 'PIKA_1' ? video?.seed : body?.seed);
  return { id, status: state, progress, videoUrl, posterUrl, ...(Number.isSafeInteger(seed) && seed >= 0 && seed <= 4294967295 ? { seed } : {}) };
}

@Injectable()
export class VideoProvider {
  private async json(route: VideoRoute, key: string, profile: string, action: 'submit' | 'extend' | 'poll' | 'cancel' | 'result', payload: unknown, signal: AbortSignal, id?: string) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(route.timeoutMs)]), submit = action === 'submit' || action === 'extend'; let received = false;
    try {
      const response = await safeFetch(videoEndpoint(route.baseUrl, profile, action, id), { method: action === 'poll'||action==='result' ? 'GET' : action === 'cancel' ? profile.startsWith('FAL_')?'PUT':'DELETE' : 'POST', headers: { ...(key ? { Authorization: (profile.startsWith('FAL_')?'Key ':'Bearer ') + key } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }, { signal: deadline, timeoutMs: route.timeoutMs, allowHttp: process.env.ALLOW_HTTP_UPSTREAM === '1' }); received = true;
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new VideoUpstreamError(response.status, submit ? 'submit' : action); }
      if (action === 'cancel'&&!profile.startsWith('FAL_')) { await response.body?.cancel().catch(() => {}); return null; }
      const raw = await readVideoBody(response, 1024 * 1024, deadline);
      try { const value=JSON.parse(raw.toString('utf8'));return action==='cancel'?{...value,httpStatus:response.status}:value; } catch { throw new VideoUpstreamError(0, submit ? 'submit' : action, submit); }
    } catch (error) { if (error instanceof VideoUpstreamError) throw error; throw new VideoUpstreamError(0, submit ? 'submit' : action, submit || !received); }
  }
  async submit(route: VideoRoute, key: string, profile: string, intent: NativeVideoIntent, inputs: { images: Array<{ buffer: Buffer; mime: string }>; imageUrl?: string; videoUrl?: string;materials?:Array<{kind:string;url:string}> }, signal: AbortSignal) {
    let payload: any;
    if(profile.startsWith('FAL_')){
      const video=inputs.materials?.find(x=>x.kind==='video')?.url,audio=inputs.materials?.find(x=>x.kind==='audio')?.url;if(!video||profile==='FAL_LIPSYNC'&&!audio)throw Error('视频处理素材尚未准备完整');
      payload=profile==='FAL_UPSCALE'?{enable_safety_checker:true,video_url:video,model:intent.enhanceModel,upscale_factor:intent.upscaleFactor,H264_output:true,...Object.fromEntries([['compression','compression'],['noise','noise'],['halo','halo'],['grain','grain'],['recoverDetail','recover_detail']].filter(([key])=>intent[key]!==undefined).map(([key,target])=>[target,intent[key]]))}:{enable_safety_checker:true,video_url:video,audio_url:audio,sync_mode:intent.syncMode,...(intent.speakerSelection?{options:{active_speaker_detection:{auto_detect:false,frame_number:intent.speakerSelection.frameNumber,coordinates:[intent.speakerSelection.x,intent.speakerSelection.y]}}}:{})};
    }else if (profile === 'PIKA_1') {
      const camera = Object.fromEntries(['pan', 'tilt', 'rotate', 'zoom'].filter(k => intent[k]).map(k => [k, intent[k]]));
      payload = { model: '1.0', sfx: true, promptText: (intent.style ? intent.style + ' ' : '') + intent.prompt, options: { aspectRatio: intent.ratio, frameRate: intent.frameRate, camera, parameters: { guidanceScale: intent.guidanceScale, motion: intent.motion, negativePrompt: intent.negativePrompt || '', seed: intent.seed ?? null }, extend: intent.mode === 'extend' }, ...(inputs.imageUrl ? { image: inputs.imageUrl } : {}), ...(inputs.videoUrl ? { video: inputs.videoUrl } : {}) };
    } else {
      const content: any[] = [{ type: 'text', text: intent.prompt }];
      inputs.images.forEach((image, i) => content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.buffer.toString('base64')}` }, role: i ? 'last_frame' : 'first_frame' }));
      if (inputs.videoUrl) content.push({ type: 'video_url', video_url: { url: inputs.videoUrl }, role: 'reference_video' });
      for(const item of inputs.materials||[])content.push({type:item.kind+'_url',[item.kind+'_url']:{url:item.url},role:'reference_'+item.kind});
      payload = { model: route.upstreamModel, content, ratio: intent.ratio, duration: intent.mode==='edit'?-1:intent.seconds, resolution: intent.resolution, watermark: true, return_last_frame: true, ...(intent.seed === undefined ? {} : { seed: intent.seed }), ...(intent.sound === undefined ? {} : { generate_audio: intent.sound }), ...(profile==='ARK_2_5'&&['reference','edit','extend'].includes(intent.mode) ? { omni_reference_task_type: intent.mode } : {}) };
    }
    const body = await this.json(route, key, profile, intent.mode === 'extend' && profile === 'PIKA_1' ? 'extend' : 'submit', payload, signal);
    // Creation commonly returns only an ID; persist it before querying anything else.
    return videoJobId(profile.startsWith('FAL_')?body?.request_id:profile === 'PIKA_1' ? body?.job?.id : body?.id);
  }
  async poll(route: VideoRoute, key: string, profile: string, id: string, signal: AbortSignal) {
    id=videoJobId(id);const body=await this.json(route,key,profile,'poll',undefined,signal,id);if(!profile.startsWith('FAL_'))return normalizeVideoState(profile,body,id);
    if(body?.request_id!==undefined&&body.request_id!==id)throw Error('原连接返回了其他任务编号');
    if(!['IN_QUEUE','IN_PROGRESS','COMPLETED'].includes(body?.status))throw Error('视频处理状态尚未确认');
    const empty={id,progress:body.status==='IN_QUEUE'?10:50,videoUrl:null,posterUrl:null};if(body.status!=='COMPLETED')return{...empty,status:body.status==='IN_QUEUE'?'queued' as const:'running' as const};
    let result:any;try{result=await this.json(route,key,profile,'result',undefined,signal,id);}catch(e){if(e instanceof VideoUpstreamError&&e.status===422)return{...empty,status:'failed' as const};throw e;}
    if(result?.request_id!==undefined&&result.request_id!==id)throw Error('视频处理结果不属于原任务');const videoUrl=videoResultUrl(result?.video?.url);if(!videoUrl)throw Error('处理结果没有返回有效成片');return{...empty,status:'succeeded' as const,progress:95,videoUrl};
  }
  async cancelQueued(route: VideoRoute, key: string, profile: string, id: string, signal: AbortSignal) {
    if (profile === 'PIKA_1') return 'LOCAL_ONLY';
    if(profile.startsWith('FAL_')){const result=await this.json(route,key,profile,'cancel',undefined,signal,videoJobId(id));return result.httpStatus===200&&result.status==='OK'?'ACKNOWLEDGED':result.httpStatus===202&&result.status==='CANCELLATION_REQUESTED'?'SIGNALLED':'UNCONFIRMED';}
    const state = await this.poll(route, key, profile, id, signal);
    if (state.status !== 'queued') return 'LOCAL_ONLY';
    await this.json(route, key, profile, 'cancel', undefined, signal, id); return 'ACKNOWLEDGED';
  }
}
