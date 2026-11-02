import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Channel, VoiceConfig, VoiceTask } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { safeFetch } from '../../common/net/safe-fetch';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { SettingsService } from '../settings/settings.service';
import { KeyPoolService } from '../models/key-pool.service';
import { ModerationService } from '../moderation/moderation.service';
import { IncomingFile, StorageService } from '../storage/storage.service';
import {syncVoiceRecordingExpiry,voiceContentActive,voiceFileActive} from './voice-retention';
import { VoiceConfigDto, VoiceCreateDto, VoiceQuoteDto } from './voice.dto';
import { VoiceAccountingService, VoiceResult, voiceResults } from './voice-accounting.service';
import { inspectVoiceWav, MAX_RECORDING_BYTES, MAX_RECORDING_SECONDS, readVoiceBody, splitVoiceText, validMp3, VOICE_PREVIEW_TEXT, voiceEndpoint } from './voice-protocol';

const defaults=()=>({id:'site',enabled:false,speechChannelId:'',transcriptionChannelId:'',speechModel:'tts-1',transcriptionModel:'whisper-1',speechCost:0,transcriptionCost:0,pool:'model3',maxSpeechChars:16000,retentionDays:0,version:0,updatedAt:new Date(0)} satisfies VoiceConfig);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid=(text:string)=>new BusinessException(ErrorCode.PARAM_INVALID,text,400);
const conflict=(text:string)=>new BusinessException(ErrorCode.CONVERSATION_BUSY,text,409);
const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'语音内容不存在或已移除',404);
const terminal=(row:VoiceTask)=>['COMPLETED','FAILED','CANCELED'].includes(row.status);
type Intent={kind:'speech'|'transcription';messageId:string|null;fileId:string|null;sample:boolean;voice:string};
type Prepared={config:VoiceConfig;channel:Channel;payload:Intent;text:string;segments:string[];seconds:number;inputHash:string;cost:number;revision:string;};

/** Native operations are accepted once. Transport errors and restarts never retry a generation. */
@Injectable()
export class VoiceService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(VoiceService.name);
  private readonly running=new Map<string,{controller:AbortController;work:Promise<void>}>();
  private closing=false;
  private settlementTimer?:NodeJS.Timeout;
  private settling=false;
  constructor(private readonly prisma:PrismaService,private readonly settings:SettingsService,private readonly storage:StorageService,private readonly accounting:VoiceAccountingService,private readonly keys:KeyPoolService,private readonly box:SecretBox,private readonly moderation:ModerationService,private readonly rate:RateLimitService){}
  async onModuleInit(){
    const staged=await this.prisma.voiceTask.findMany({where:{status:'SETTLING'},select:{id:true}});for(const row of staged)await this.accounting.complete(row.id);
    const interrupted=await this.prisma.voiceTask.findMany({where:{status:{in:['QUEUED','RUNNING']}},select:{id:true}});for(const row of interrupted){await this.accounting.stop(row.id,'FAILED','server_interrupted','服务重新启动，本次语音已中断；未重新提交给服务方');await this.cleanFailed(row.id);}
    this.settlementTimer=setInterval(()=>{void this.settleSaved().catch(()=>this.logger.warn('语音结果等待完成结算'));},10000);this.settlementTimer.unref?.();
  }
  async onModuleDestroy(){this.closing=true;if(this.settlementTimer)clearInterval(this.settlementTimer);for(const run of this.running.values())run.controller.abort(new Error('voice shutdown'));await Promise.allSettled([...this.running.values()].map(run=>run.work));}
  private async settleSaved(){if(this.settling||this.closing)return;this.settling=true;try{const rows=await this.prisma.voiceTask.findMany({where:{status:'SETTLING'},select:{id:true},take:10});for(const row of rows)await this.accounting.complete(row.id);}finally{this.settling=false;}}
  private config(){return this.prisma.voiceConfig.findUnique({where:{id:'site'}}).then(row=>row||defaults());}
  async adminConfig(){return this.config();}
  private async channel(id:string){
    const row=id?await this.prisma.channel.findFirst({where:{id,deletedAt:null,status:'ENABLED'}}):null;
    if(!row||!['OPENAI','CUSTOM'].includes(row.type))return null;try{voiceEndpoint(row.baseUrl,'speech');}catch{return null;}return row;
  }
  private async readiness(config:VoiceConfig,kind:'speech'|'transcription',cost:number){
    const channel=await this.channel(kind==='speech'?config.speechChannelId:config.transcriptionChannelId),ready=config.enabled&&!!channel;
    return{ready,reason:ready?'':!config.enabled?'站点尚未开启语音服务':'语音渠道尚未就绪，请联系管理员配置',cost,pool:config.pool};
  }
  async options(){const config=await this.config(),cost=await this.costs(config);return{speech:await this.readiness(config,'speech',cost.speech),transcription:await this.readiness(config,'transcription',cost.transcription),maxRecordingSeconds:MAX_RECORDING_SECONDS,maxRecordingBytes:MAX_RECORDING_BYTES,maxSpeechChars:config.maxSpeechChars,voices:['alloy','echo','fable','nova','onyx','shimmer'],disclosure:'AI 合成声音',retention:{days:config.retentionDays,pendingRecordingHours:24,appliesTo:'future'}};}
  private async costs(config:VoiceConfig){const [enabled,demo]=await Promise.all([this.settings.get<boolean>('commerce.enabled'),this.settings.get<boolean>('demo.siteEnabled')]);return{speech:enabled&&!demo?config.speechCost:0,transcription:enabled&&!demo?config.transcriptionCost:0};}
  async saveConfig(dto:VoiceConfigDto){
    for(const id of new Set([dto.speechChannelId,dto.transcriptionChannelId].filter(Boolean)))if(!await this.channel(id))throw invalid('请选择已启用的 OpenAI 兼容语音渠道，并核对 API 根地址');
    if(dto.enabled&&!dto.speechChannelId&&!dto.transcriptionChannelId)throw invalid('请至少配置一个语音渠道再开启服务');
    const {version,...data}=dto;
    try{return await this.prisma.$transaction(async tx=>{if(version===0){if(await tx.voiceConfig.findUnique({where:{id:'site'}}))throw conflict('语音设置已变化，请刷新后保存');return tx.voiceConfig.create({data:{id:'site',...data,version:1}});}const changed=await tx.voiceConfig.updateMany({where:{id:'site',version},data:{...data,version:{increment:1}}});if(!changed.count)throw conflict('语音设置已变化，请刷新后保存');return tx.voiceConfig.findUniqueOrThrow({where:{id:'site'}});});}
    catch(error){if((error as any)?.code==='P2002')throw conflict('语音设置已变化，请刷新后保存');throw error;}
  }
  intent(dto:VoiceQuoteDto):Intent{
    if(dto.kind==='speech'){if(dto.fileId||(!dto.messageId&&dto.sample!==true)||dto.messageId&&dto.sample===true)throw invalid('请指定一个完整回答，或选择音色试听');return{kind:dto.kind,messageId:dto.messageId||null,fileId:null,sample:dto.sample===true,voice:dto.voice||'fable'};}
    if(!dto.fileId||dto.messageId||dto.sample||dto.voice)throw invalid('转写需要一份本人录制的音频');return{kind:dto.kind,messageId:null,fileId:dto.fileId,sample:false,voice:'fable'};
  }
  private async source(userId:string,payload:Intent){
    if(payload.kind==='transcription'){
      const row=await this.prisma.uploadFile.findFirst({where:{id:payload.fileId!,userId,deletedAt:null,scope:'voice-recording',mime:'audio/wav',...voiceFileActive()}});if(!row)throw missing();const file=await this.storage.read(row.id,userId,'USER');let audio:{seconds:number};try{audio=inspectVoiceWav(file.buffer);}catch{throw invalid('录音已损坏或超过五分钟，请重新录制');}return{text:'',seconds:audio.seconds,inputHash:row.sha256};
    }
    if(payload.sample)return{text:VOICE_PREVIEW_TEXT,seconds:0,inputHash:hash(VOICE_PREVIEW_TEXT)};
    const message=await this.prisma.message.findFirst({where:{id:payload.messageId!,role:'ASSISTANT',status:'COMPLETED',deletedAt:null,conversation:{userId,deletedAt:null}}});if(!message)throw missing();if(!message.content.trim())throw invalid('这条回答没有可朗读的文字');return{text:message.content,seconds:0,inputHash:hash(message.content)};
  }
  private async prepare(userId:string,dto:VoiceQuoteDto):Promise<Prepared>{
    const payload=this.intent(dto),config=await this.config();if(!config.enabled)throw invalid('站点尚未开启语音服务');
    const channel=await this.channel(payload.kind==='speech'?config.speechChannelId:config.transcriptionChannelId);if(!channel)throw invalid('语音渠道暂不可用，请联系管理员');
    const input=await this.source(userId,payload);if(input.text.length>config.maxSpeechChars)throw invalid(`这条回答超过当前 ${config.maxSpeechChars} 字符的朗读上限`);
    const segments=payload.kind==='speech'?splitVoiceText(input.text):[],cost=(await this.costs(config))[payload.kind];
    const revision=hash({configVersion:config.version,channelId:channel.id,channelUpdated:channel.updatedAt.toISOString(),payload,inputHash:input.inputHash,cost,pool:config.pool});
    return{config,channel,payload,...input,segments,cost,revision};
  }
  async quote(userId:string,dto:VoiceQuoteDto){const plan=await this.prepare(userId,dto);return{kind:plan.payload.kind,revision:plan.revision,cost:plan.cost,pool:plan.config.pool,chars:plan.text.length,seconds:plan.seconds,segments:plan.segments.length||1,disclosure:'AI 合成声音'};}
  async recording(userId:string,file:IncomingFile){
    if(!this.rate.tryConsume(`voice-upload:${userId}`,12))throw new BusinessException(ErrorCode.RATE_LIMITED,'录音上传过于频繁，请稍后再试',429);
    const options=await this.options();if(!options.transcription.ready)throw invalid(options.transcription.reason);if(!file?.buffer?.length)throw invalid('没有收到录音');try{inspectVoiceWav(file.buffer);}catch(error){throw invalid((error as Error).message);}
    return this.storage.saveBuffer(userId,file.buffer,{mime:'audio/wav',filename:'QGauss-voice.wav',scope:'voice-recording',expiresAt:new Date(Date.now()+86400000)});
  }
  async create(userId:string,dto:VoiceCreateDto){
    if(this.closing)throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE,'语音服务正在重新启动，请稍后再试',503);
    const payload=this.intent(dto),requestHash=hash(payload),replay=await this.prisma.voiceTask.findUnique({where:{userId_requestKey:{userId,requestKey:dto.requestKey}}});if(replay){if(replay.requestHash!==requestHash)throw conflict('同一次语音提交不能换成其他内容');return this.detail(userId,replay.id);}
    const plan=await this.prepare(userId,dto);if(dto.quoteRevision!==plan.revision)throw conflict('语音内容或费用设置已变化，请重新确认');
    const hit=plan.text?await this.moderation.check(plan.text):null;if(hit){await this.moderation.recordHit({userId,word:hit.word,source:'voice',excerpt:plan.text});throw new BusinessException(hit.action==='review'?ErrorCode.CONTENT_REVIEW:ErrorCode.CONTENT_BLOCKED,'这段内容暂不能生成语音',400);}
    if(!this.rate.tryConsume(`voice-create:${userId}`,await this.settings.get<number>('security.voiceRateLimit')))throw new BusinessException(ErrorCode.RATE_LIMITED,'语音请求过于频繁，请稍后再试',429);
    let accepted:VoiceTask,created=false;
    try{accepted=await this.prisma.$transaction(async tx=>{
      const locked=await tx.voiceConfig.updateMany({where:{id:'site',version:plan.config.version,enabled:true},data:{enabled:true}});if(!locked.count)throw conflict('语音设置已变化，请重新确认');
      const previous=await tx.voiceTask.findUnique({where:{userId_requestKey:{userId,requestKey:dto.requestKey}}});if(previous){if(previous.requestHash!==requestHash)throw conflict('同一次语音提交不能换成其他内容');return previous;}
      const channel=await tx.channel.findFirst({where:{id:plan.channel.id,status:'ENABLED',deletedAt:null}});if(!channel||channel.updatedAt.getTime()!==plan.channel.updatedAt.getTime())throw conflict('语音渠道已变化，请重新确认');
      if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'账户当前不可用',403);
      if(payload.kind==='transcription'){
        const file=await tx.uploadFile.findFirst({where:{id:payload.fileId!,userId,scope:'voice-recording',mime:'audio/wav',...voiceFileActive()},select:{sha256:true}});if(!file||file.sha256!==plan.inputHash)throw conflict('录音内容已变化或到期，请重新确认');
      }else if(!payload.sample){const message=await tx.message.findFirst({where:{id:payload.messageId!,role:'ASSISTANT',status:'COMPLETED',deletedAt:null,conversation:{userId,deletedAt:null}},select:{content:true}});if(!message||hash(message.content)!==plan.inputHash)throw conflict('回答内容已变化，请重新确认');}
      if(await tx.voiceTask.count({where:{userId,status:{in:['QUEUED','RUNNING','SETTLING']}}})>=2)throw conflict('已有两项语音正在处理，请稍后再提交');
      const row=await tx.voiceTask.create({data:{userId,requestKey:dto.requestKey,requestHash,label:plan.text.replace(/\s+/g,' ').slice(0,120),retentionDays:plan.config.retentionDays,kind:payload.kind,messageId:payload.messageId,inputFileId:payload.fileId,sample:payload.sample,voice:payload.voice,model:payload.kind==='speech'?plan.config.speechModel:plan.config.transcriptionModel,channelId:channel.id,configVersion:plan.config.version,inputChars:plan.text.length,inputSeconds:plan.seconds,segmentCount:plan.segments.length||1,pool:plan.config.pool}});created=true;await syncVoiceRecordingExpiry(tx,userId,payload.fileId);return this.accounting.reserveTx(tx,row,plan.cost);
    });}catch(error){if((error as any)?.code==='P2002'){const previous=await this.prisma.voiceTask.findUnique({where:{userId_requestKey:{userId,requestKey:dto.requestKey}}});if(previous?.requestHash===requestHash)return this.detail(userId,previous.id);}throw error;}
    if(created){const controller=new AbortController(),work=Promise.resolve().then(()=>this.execute(accepted.id,plan,controller)).catch(()=>this.logger.warn('语音任务回执等待恢复')).finally(()=>this.running.delete(accepted.id));this.running.set(accepted.id,{controller,work});}
    return this.view(accepted);
  }
  private view(row:VoiceTask){const prefix=(process.env.API_PREFIX||'api').replace(/^\/+|\/+$/g,'');return{id:row.id,kind:row.kind,messageId:row.messageId,sample:row.sample,voice:row.voice,status:row.status,progress:row.progress,segmentCount:row.segmentCount,completedSegments:row.completedSegments,transcript:row.status==='COMPLETED'?row.transcript:'',audio:row.status==='COMPLETED'?voiceResults(row.resultJson).map((file,index)=>({index,url:`/${prefix}/voice/tasks/${encodeURIComponent(row.id)}/audio/${index}`,mime:file.mime})):[],errorCode:row.errorCode,errorMessage:row.errorMessage,createdAt:row.createdAt,finishedAt:row.finishedAt,billing:{state:row.billingState,pool:row.pool,limit:row.reservedAmount,reserved:!terminal(row)?row.reservedAmount:0,charged:row.chargedAmount,returned:row.returnedAmount,expired:row.expiredAmount}};}
  private async owned(userId:string,id:string,source=true){const row=await this.prisma.voiceTask.findFirst({where:{id,userId}});if(!row||row.deletedAt||row.purgedAt||terminal(row)&&!voiceContentActive(row))throw missing();if(source){if(row.kind==='transcription'){if(!await this.prisma.uploadFile.findFirst({where:{id:row.inputFileId!,userId,deletedAt:null,scope:'voice-recording',mime:'audio/wav',...voiceFileActive()},select:{id:true}}))throw missing();}else await this.source(userId,{kind:'speech',messageId:row.messageId,fileId:null,sample:row.sample,voice:row.voice});}return row;}
  async detail(userId:string,id:string){return this.view(await this.owned(userId,id));}
  async byRequest(userId:string,key:string){const row=await this.prisma.voiceTask.findUnique({where:{userId_requestKey:{userId,requestKey:key}}});if(!row)throw missing();return this.detail(userId,row.id);}
  async audio(userId:string,id:string,index:number){const row=await this.owned(userId,id);if(row.status!=='COMPLETED'||!Number.isSafeInteger(index)||index<0)throw missing();const file=voiceResults(row.resultJson)[index];if(!file)throw missing();return this.storage.read(file.id,userId,'USER');}
  async cancel(userId:string,id:string){const row=await this.owned(userId,id,false);const stopped=await this.accounting.stop(row.id,'CANCELED','canceled','已停止生成；外部服务是否继续计费，以服务方账单为准');if(stopped){this.running.get(id)?.controller.abort(new Error('voice canceled'));await this.cleanFailed(id);}const final=await this.prisma.voiceTask.findUniqueOrThrow({where:{id}});if(final.status==='COMPLETED')return this.detail(userId,id);return this.view(final);}
  async receipts(){const rows=await this.prisma.voiceTask.findMany({orderBy:{createdAt:'desc'},take:50});return rows.map(row=>({...this.view(row),channelId:row.channelId,model:row.model,inputChars:row.inputChars,inputSeconds:row.inputSeconds,attemptedSegments:row.attemptedSegments,possibleProviderCharge:row.attemptedSegments>0,transcript:undefined,audio:[]}));}
  private async cleanFailed(id:string){const row=await this.prisma.voiceTask.findUnique({where:{id}});if(!row||!['FAILED','CANCELED'].includes(row.status))return;for(const file of voiceResults(row.resultJson))await this.storage.remove(file.id,row.userId,'USER').catch(()=>{});}
  private async execute(id:string,plan:Prepared,controller:AbortController){
    const task=await this.prisma.voiceTask.findUniqueOrThrow({where:{id}}),stored:VoiceResult[]=[];let staged=false,audioBytes=0;
    try{
      const claimed=await this.prisma.voiceTask.updateMany({where:{id,status:'QUEUED'},data:{status:'RUNNING',progress:5}});if(!claimed.count)return;
      const key=await this.keys.pick({id:plan.channel.id,apiKey:plan.channel.apiKeyEnc?this.box.decrypt(plan.channel.apiKeyEnc):''});if(!key)throw new Error('语音渠道密钥暂不可用，请联系管理员');
      const totalSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.max(1000,Math.min(plan.channel.timeoutMs,180000)))]);let transcript='';
      for(let index=0;index<(task.kind==='speech'?plan.segments.length:1);index++){
        totalSignal.throwIfAborted();const source=await this.source(task.userId,plan.payload);if(source.inputHash!==plan.inputHash)throw new Error('语音源内容已变化，请重新确认');
        const channel=await this.channel(plan.channel.id),config=await this.config(),user=await this.prisma.user.findFirst({where:{id:task.userId,status:'ACTIVE',deletedAt:null}});if(!user||!channel||channel.updatedAt.getTime()!==plan.channel.updatedAt.getTime()||!config.enabled||config.version!==plan.config.version)throw new Error('语音配置或账号状态已变化，本次已停止');
        const headers:Record<string,string>={...(key.apiKey?{Authorization:`Bearer ${key.apiKey}`}:{})};let body:BodyInit;
        if(task.kind==='speech'){headers['Content-Type']='application/json';headers.Accept='audio/mpeg';body=JSON.stringify({model:task.model,voice:task.voice,input:plan.segments[index],response_format:'mp3'});}else{const file=await this.storage.read(task.inputFileId!,task.userId,'USER'),form=new FormData();form.set('file',new Blob([new Uint8Array(file.buffer)],{type:'audio/wav'}),'QGauss-voice.wav');form.set('model',task.model);form.set('response_format','json');form.set('language','zh');form.set('prompt','请将语言转为中文简体');body=form;}
        const marked=await this.prisma.voiceTask.updateMany({where:{id,status:'RUNNING'},data:{attemptedSegments:{increment:1}}});if(!marked.count)return;
        const response=await safeFetch(voiceEndpoint(channel.baseUrl,task.kind as 'speech'|'transcription'),{method:'POST',headers,body},{signal:totalSignal,timeoutMs:channel.timeoutMs});
        if(!response.ok)await this.keys.reportFailure(channel.id,key,[401,403].includes(response.status)?'upstream_auth':response.status===429?'upstream_rate_limited':'upstream_error');
        const data=await readVoiceBody(response,task.kind==='speech'?16*1024*1024:1024*1024,totalSignal);totalSignal.throwIfAborted();
        if(task.kind==='speech'){
          if(!validMp3(data))throw new Error('语音服务没有返回有效 MP3 音频');audioBytes+=data.length;if(audioBytes>32*1024*1024)throw new Error('语音结果超过本次大小上限');const saved=await this.storage.saveBuffer(task.userId,data,{mime:'audio/mpeg',filename:`QGauss-${task.voice}-${index+1}.mp3`,scope:'voice-result',expiresAt:new Date(Date.now()+86400000)});stored.push({id:saved.id,mime:'audio/mpeg'});
          const savedProgress=await this.prisma.voiceTask.updateMany({where:{id,status:'RUNNING'},data:{resultJson:JSON.stringify(stored),completedSegments:stored.length,progress:Math.min(90,5+Math.floor(85*stored.length/plan.segments.length))}});if(!savedProgress.count)return;
        }else{let json:unknown;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw new Error('语音服务返回的转写结果无效');}transcript=typeof (json as any)?.text==='string'?(json as any).text.trim():'';if(!transcript||transcript.length>30000)throw new Error('没有识别到有效文字，请检查录音后再试');const hit=await this.moderation.check(transcript);if(hit){await this.moderation.recordHit({userId:task.userId,word:hit.word,source:'voice',excerpt:transcript});throw new Error('转写内容暂不能使用');}await this.prisma.voiceTask.updateMany({where:{id,status:'RUNNING'},data:{completedSegments:1}});}
        this.keys.reportSuccess(key);
      }
      totalSignal.throwIfAborted();await this.source(task.userId,plan.payload);staged=await this.accounting.stage(id,transcript,stored);if(staged)await this.accounting.complete(id);
    }catch(error){
      if(!staged){const canceled=controller.signal.aborted;await this.accounting.stop(id,canceled?'CANCELED':'FAILED',canceled?'canceled':'voice_failed',canceled?'已停止生成；外部服务可能仍计费':(error as Error)?.name==='TimeoutError'?'语音服务等待超时；本次未自动重试':this.safeError(error));}
      else this.logger.warn('语音结果已保存，结算等待恢复');
    }finally{
      if(!staged)for(const file of stored)await this.storage.remove(file.id,task.userId,'USER').catch(()=>{});
      await this.cleanFailed(id);
    }
  }
  private safeError(error:unknown){const message=error instanceof Error?error.message:'';return /^(语音|这条|没有|请|录音|转写|麦克风)/.test(message)&&message.length<220?message:'语音服务暂时未完成请求，请稍后明确重试';}
}
