import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import type {Prisma,VoiceTask} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {StorageService} from '../storage/storage.service';
import {voiceResults} from './voice-accounting.service';
import {syncVoiceRecordingExpiry,VOICE_TERMINAL,voiceContentActive,voiceFileActive} from './voice-retention';

const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'声音记录不存在或已被清理',404);
const invalid=(message:string)=>new BusinessException(ErrorCode.PARAM_INVALID,message,400);
type SourceIndex={messages:Map<string,{id:string;content:string;conversationId:string}>;recordings:Set<string>;audio:Set<string>};

@Injectable()
export class VoiceLibraryService implements OnModuleInit,OnModuleDestroy {
 private readonly logger=new Logger(VoiceLibraryService.name);
 private timer?:NodeJS.Timeout;
 private work:Promise<void>|null=null;
 private cleanupRequested=false;
 private fileCursor?:{deletedAt:Date;id:string};
 private closing=false;
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageService,private readonly rate:RateLimitService){}

 onModuleInit(){this.timer=setInterval(()=>this.kickCleanup(),60000);this.timer.unref?.();this.kickCleanup();}
 async onModuleDestroy(){this.closing=true;if(this.timer)clearInterval(this.timer);await this.work;}
 private kickCleanup(){if(this.closing)return;if(this.work){this.cleanupRequested=true;return;}this.cleanupRequested=false;this.work=this.sweep().catch(()=>this.logger.warn('部分声音内容等待继续清理')).finally(()=>{this.work=null;if(this.cleanupRequested&&!this.closing)this.kickCleanup();});}
 private scalar(value:unknown,fallback:string){if(value===undefined)return fallback;if(typeof value!=='string')throw invalid('声音筛选条件不正确');return value;}
 private page(value:unknown,fallback:number,max:number){const text=this.scalar(value,String(fallback));if(!/^[1-9][0-9]{0,5}$/.test(text)||Number(text)>max)throw invalid('声音分页条件不正确');return Number(text);}
 private async sources(userId:string,rows:VoiceTask[],now:Date):Promise<SourceIndex>{
  const readable=rows.filter(row=>voiceContentActive(row,now)),messages=[...new Set(readable.filter(row=>row.kind==='speech'&&!row.sample&&row.messageId).map(row=>row.messageId!))],recordings=[...new Set(readable.filter(row=>row.kind==='transcription'&&row.inputFileId).map(row=>row.inputFileId!))],audio=[...new Set(readable.flatMap(row=>voiceResults(row.resultJson).map(file=>file.id)))];
  const [messageRows,recordingRows,audioRows]=await Promise.all([
   this.prisma.message.findMany({where:{id:{in:messages},role:'ASSISTANT',status:'COMPLETED',deletedAt:null,conversation:{userId,deletedAt:null}},select:{id:true,content:true,conversationId:true}}),
   this.prisma.uploadFile.findMany({where:{id:{in:recordings},userId,scope:'voice-recording',mime:'audio/wav',...voiceFileActive(now)},select:{id:true}}),
   this.prisma.uploadFile.findMany({where:{id:{in:audio},userId,scope:'voice-result',mime:'audio/mpeg',...voiceFileActive(now)},select:{id:true}}),
  ]);
  return{messages:new Map(messageRows.map(row=>[row.id,row])),recordings:new Set(recordingRows.map(row=>row.id)),audio:new Set(audioRows.map(row=>row.id))};
 }
 private view(row:VoiceTask,sources:SourceIndex,now:Date,full=false){
  const finished=VOICE_TERMINAL.includes(row.status),expired=finished&&!!row.expiresAt&&row.expiresAt<=now,active=voiceContentActive(row,now),message=row.messageId?sources.messages.get(row.messageId):null;
  const sourceAvailable=row.kind==='speech'?row.sample||!!message:!!row.inputFileId&&sources.recordings.has(row.inputFileId);
  const results=voiceResults(row.resultJson),complete=row.kind==='speech'?results.length===row.segmentCount&&row.completedSegments===row.segmentCount&&results.every(file=>sources.audio.has(file.id)):!!row.transcript.trim();
  const ready=active&&sourceAvailable&&row.status==='COMPLETED'&&complete;
  const availability=expired?'expired':!finished?'processing':ready?'ready':'unavailable';
  const reason=expired?'保留期限已过，内容停止开放；原有费用回执仍保留。':!active?'这份内容已被清理，原有费用回执仍保留。':!sourceAvailable?'原对话或录音已被移除，无法继续读取这份内容。':row.status==='FAILED'||row.status==='CANCELED'?row.errorMessage||'本次未完成，次数处理结果见下方回执。':row.status==='COMPLETED'&&!complete?'声音文件不完整或已被移除，无法继续播放。':'';
  const prefix=(process.env.API_PREFIX||'api').replace(/^\/+|\/+$/g,'');
  return{id:row.id,kind:row.kind,label:active&&sourceAvailable?(row.label||message?.content.replace(/\s+/g,' ').slice(0,120)||''):'',sample:row.sample,voice:row.voice,status:row.status,progress:row.progress,availability,availabilityReason:reason,retentionDays:row.retentionDays,expiresAt:row.expiresAt,createdAt:row.createdAt,finishedAt:row.finishedAt,segmentCount:row.segmentCount,completedSegments:row.completedSegments,inputChars:row.inputChars,inputSeconds:row.inputSeconds,billing:{state:row.billingState,pool:row.pool,limit:row.reservedAmount,reserved:finished?0:row.reservedAmount,charged:row.chargedAmount,returned:row.returnedAmount,expired:row.expiredAmount},...(full?{messageId:active&&message?row.messageId:null,conversationId:active&&message?message.conversationId:null,transcript:ready&&row.kind==='transcription'?row.transcript:'',audio:ready&&row.kind==='speech'?results.map((file,index)=>({index,url:`/${prefix}/voice/tasks/${encodeURIComponent(row.id)}/audio/${index}`,mime:file.mime})):[]}:{})};
 }
 async list(userId:string,query:Record<string,unknown>={}){
  const kind=this.scalar(query.kind,'all'),state=this.scalar(query.state,'all'),q=this.scalar(query.q,'').trim(),page=this.page(query.page,1,100000),pageSize=this.page(query.pageSize,9,30),now=new Date();
  if(!['all','speech','transcription'].includes(kind)||!['all','completed','processing','failed','canceled','expired'].includes(state)||q.length>100)throw invalid('声音筛选条件不正确');
  const where:Prisma.VoiceTaskWhereInput={userId,deletedAt:null,...(kind==='all'?{}:{kind})},conditions:Prisma.VoiceTaskWhereInput[]=[];
  if(q)conditions.push({purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:now}}]},{OR:[{label:{contains:q}},{voice:{contains:q}},{transcript:{contains:q}}]});
  if(state==='expired')conditions.push({status:{in:VOICE_TERMINAL},expiresAt:{lte:now}});
  else if(state==='processing')conditions.push({status:{notIn:VOICE_TERMINAL}});
  else if(state!=='all')conditions.push({status:({completed:'COMPLETED',failed:'FAILED',canceled:'CANCELED'} as Record<string,string>)[state],OR:[{expiresAt:null},{expiresAt:{gt:now}}]});
  if(conditions.length)where.AND=conditions;
  const [rows,total,all,speech,transcription,config]=await Promise.all([
   this.prisma.voiceTask.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize}),this.prisma.voiceTask.count({where}),
   this.prisma.voiceTask.count({where:{userId,deletedAt:null}}),this.prisma.voiceTask.count({where:{userId,deletedAt:null,kind:'speech'}}),this.prisma.voiceTask.count({where:{userId,deletedAt:null,kind:'transcription'}}),this.prisma.voiceConfig.findUnique({where:{id:'site'},select:{retentionDays:true}}),
  ]);
  const sources=await this.sources(userId,rows,now);return{items:rows.map(row=>this.view(row,sources,now)),total,page,pageSize,counts:{all,speech,transcription},policy:{retentionDays:config?.retentionDays||0,pendingRecordingHours:24,cleanup:'background',appliesTo:'future'}};
 }
 async detail(userId:string,id:string){const row=await this.prisma.voiceTask.findFirst({where:{id,userId,deletedAt:null}});if(!row)throw missing();const now=new Date();return this.view(row,await this.sources(userId,[row],now),now,true);}
 private async purgeContentTx(tx:Prisma.TransactionClient,row:VoiceTask,now:Date){
  const ids=voiceResults(row.resultJson).map(file=>file.id);
  if(ids.length)await tx.uploadFile.updateMany({where:{id:{in:ids},userId:row.userId,scope:'voice-result',mime:'audio/mpeg',purgedAt:null},data:{deletedAt:now,expiresAt:now}});
  await tx.voiceTask.update({where:{id:row.id},data:{label:'',transcript:'',resultJson:'[]',purgedAt:now}});
  await syncVoiceRecordingExpiry(tx,row.userId,row.inputFileId,now);
  if(row.inputFileId)await this.withdrawRecordingTx(tx,row.userId,row.inputFileId,now);
 }
 private async withdrawRecordingTx(tx:Prisma.TransactionClient,userId:string,id:string,now:Date){
  const needed=await tx.voiceTask.count({where:{userId,inputFileId:id,deletedAt:null,purgedAt:null,OR:[{status:{notIn:VOICE_TERMINAL}},{expiresAt:null},{expiresAt:{gt:now}}]}});
  if(!needed)await tx.uploadFile.updateMany({where:{id,userId,scope:'voice-recording',mime:'audio/wav',purgedAt:null},data:{deletedAt:now,expiresAt:now}});
 }
 async remove(userId:string,id:string){
  if(!this.rate.tryConsume('voice-library-remove:'+userId,30))throw new BusinessException(ErrorCode.RATE_LIMITED,'清理操作过快，请稍后再试',429);
  await this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;
   if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'账户当前不可用',403);
   const row=await tx.voiceTask.findFirst({where:{id,userId}});if(!row)throw missing();if(row.deletedAt)return;
   if(!VOICE_TERMINAL.includes(row.status))throw new BusinessException(ErrorCode.CONVERSATION_BUSY,'请先等待生成结束或明确停止，再清理这条记录',409);
   const now=new Date();await tx.voiceTask.update({where:{id},data:{deletedAt:now}});await this.purgeContentTx(tx,row,now);
  });
  this.kickCleanup();return{removed:true,cleanup:'background'};
 }
 async sweep(now=new Date()){
  const rows=await this.prisma.voiceTask.findMany({where:{purgedAt:null,status:{in:VOICE_TERMINAL},OR:[{deletedAt:{not:null}},{expiresAt:{lte:now}}]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:30,select:{id:true}});
  for(const item of rows){if(this.closing)return;await this.prisma.$transaction(async tx=>{const row=await tx.voiceTask.findFirst({where:{id:item.id,purgedAt:null,status:{in:VOICE_TERMINAL},OR:[{deletedAt:{not:null}},{expiresAt:{lte:now}}]}});if(row)await this.purgeContentTx(tx,row,now);});}
  const expiredFiles=await this.prisma.uploadFile.findMany({where:{scope:{in:['voice-recording','voice-result']},expiresAt:{lte:now},deletedAt:null,purgedAt:null},orderBy:[{createdAt:'asc'},{id:'asc'}],take:30,select:{id:true,userId:true,scope:true}});
  for(const file of expiredFiles){if(this.closing)return;await this.prisma.$transaction(async tx=>{
   if(file.scope==='voice-recording'){await syncVoiceRecordingExpiry(tx,file.userId,file.id,now);await this.withdrawRecordingTx(tx,file.userId,file.id,now);}
   else if(!await tx.voiceTask.count({where:{userId:file.userId,status:{notIn:VOICE_TERMINAL},deletedAt:null}}))await tx.uploadFile.updateMany({where:{id:file.id,userId:file.userId,scope:'voice-result',expiresAt:{lte:now},deletedAt:null,purgedAt:null},data:{deletedAt:now}});
  });}
  const pendingWhere:Prisma.UploadFileWhereInput={deletedAt:{not:null},purgedAt:null,OR:[{scope:'voice-recording',mime:'audio/wav'},{scope:'voice-result',mime:'audio/mpeg'}]};
  const readPending=()=>this.prisma.uploadFile.findMany({where:{...pendingWhere,...(this.fileCursor?{AND:[{OR:[{deletedAt:{gt:this.fileCursor.deletedAt}},{deletedAt:this.fileCursor.deletedAt,id:{gt:this.fileCursor.id}}]}]}:{})},orderBy:[{deletedAt:'asc'},{id:'asc'}],take:12,select:{id:true,userId:true,scope:true,deletedAt:true}});
  let pending=await readPending();if(!pending.length&&this.fileCursor){this.fileCursor=undefined;pending=await readPending();}
  if(pending.length){const last=pending[pending.length-1];this.fileCursor={deletedAt:last.deletedAt!,id:last.id};}
  for(let index=0;index<pending.length&&!this.closing;index+=3){const results=await Promise.allSettled(pending.slice(index,index+3).map(file=>this.storage.purgeVoiceFile(file.id,file.userId,file.scope as 'voice-recording'|'voice-result')));if(results.some(result=>result.status==='rejected'))this.logger.warn('声音文件暂未完成清理，将继续处理');}
 }
}
