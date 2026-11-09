import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {safeAgentActivity} from '../../common/llm/agent-activity';
import {ArtifactDownloadError,downloadArtifact} from '../../common/net/artifact-download';
import {ArtifactStage,StorageService} from '../storage/storage.service';

const ACTIVE=['QUEUED','FETCHING','STORING','VERIFYING'];
const COPY:Record<string,string>={TIMEOUT:'取回成果超时，可稍后重试。',EXPIRED:'远程链接已失效，原回复仍保留。',REMOTE:'远程成果暂未取回，可稍后重试。',ADDRESS:'这个成果地址暂不支持保存。',FORMAT:'这个成果格式暂不支持保存，可打开原链接查看。',TOO_LARGE:'成果超过当前文件大小上限。',EMPTY:'远程成果暂未提供文件内容。',REDIRECT:'成果跳转次数过多，可打开原链接查看。',INTERRUPTED:'上次保存已中断，可重新保存。',INTEGRITY:'文件内容未通过完整性检查，可重新保存。',STORAGE:'个人文件暂未存好，请稍后重试。',SOURCE:'原回复暂不可用，无法保存成果。'};
@Injectable()
export class ArtifactSavesService implements OnModuleInit,OnModuleDestroy{
 private readonly logger=new Logger(ArtifactSavesService.name);
 private timer?:ReturnType<typeof setInterval>;private stopped=false;private scanning=false;
 private readonly running=new Map<string,{promise:Promise<void>;abort:AbortController}>();
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageService){}
 async onModuleInit(){
  await this.prisma.agentArtifactSave.updateMany({where:{status:'FETCHING'},data:{status:'FAILED',errorCode:'INTERRUPTED'}});
  this.timer=setInterval(()=>this.kick(),15000);this.timer.unref?.();this.kick();
 }
 async onModuleDestroy(){this.stopped=true;clearInterval(this.timer);for(const task of this.running.values())task.abort.abort();await Promise.allSettled([...this.running.values()].map(task=>task.promise));}
 private async source(userId:string,messageId:string){
  const message=await this.prisma.message.findFirst({where:{id:messageId,role:'ASSISTANT',deletedAt:null,conversation:{userId,deletedAt:null}},select:{id:true,status:true,agentJson:true}});
  if(!message)throw new BusinessException(ErrorCode.NOT_FOUND,'原回复不存在',404);
  const report=safeAgentActivity(message.agentJson);if(!report)throw new BusinessException(ErrorCode.NOT_FOUND,'原回复不存在',404);
  return{message,report};
 }
 private async view(key:string,row?:any){
  if(!row)return{key,version:0,status:'unsaved'};
  const base={key,version:row.version};
  if(row.status==='SAVED')return{...base,...await this.storage.artifactFile(row.userId,row.fileId||'')};
  return{...base,status:ACTIVE.includes(row.status)?row.status.toLowerCase():'failed',...(row.errorCode?{error:COPY[row.errorCode]||COPY.STORAGE}:{})};
 }
 async list(userId:string,messageId:string){
  const {report}=await this.source(userId,messageId),rows=await this.prisma.agentArtifactSave.findMany({where:{userId,messageId}});
  if(rows.some(row=>row.status==='VERIFYING'))this.kick();
  return{items:await Promise.all(report.artifacts.map(artifact=>this.view(artifact.key!,rows.find(row=>row.artifactKey===artifact.key))))};
 }
 async save(userId:string,messageId:string,key:string,expectedVersion:number){
  if(!/^[a-f0-9]{64}$/.test(key))throw new BusinessException(ErrorCode.NOT_FOUND,'成果不存在',404);
  const {message,report}=await this.source(userId,messageId),artifact=report.artifacts.find(item=>item.key===key);
  if(!artifact)throw new BusinessException(ErrorCode.NOT_FOUND,'成果不存在',404);
  if(!['COMPLETED','ABORTED','FAILED'].includes(message.status))throw new BusinessException(ErrorCode.PARAM_INVALID,'请等待本轮结果确认后再保存',409);
  const old=await this.prisma.agentArtifactSave.findUnique({where:{userId_messageId_artifactKey:{userId,messageId,artifactKey:key}}});
  const missing=old?.status==='SAVED'&&old.fileId&&(await this.storage.artifactFile(userId,old.fileId)).status==='removed';
  if(old?.status==='FAILED'&&old.version===expectedVersion&&old.stageJson){
   try{const stage=JSON.parse(old.stageJson) as ArtifactStage;if(!await this.prisma.uploadFile.findFirst({where:{storedKey:stage.storedKey}}))await this.storage.discardArtifact(stage);}
   catch{throw new BusinessException(ErrorCode.PARAM_INVALID,'请先核对原保存记录',409);}
  }
  const row=await this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;
   if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前身份不能保存文件',403);
   const previous=await tx.agentArtifactSave.findUnique({where:{userId_messageId_artifactKey:{userId,messageId,artifactKey:key}}});
   if(previous){
    if(expectedVersion!==previous.version||ACTIVE.includes(previous.status))return previous;
    if(previous.status==='SAVED'){
     const file=previous.fileId?await tx.uploadFile.findFirst({where:{id:previous.fileId,userId,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}}):null;
     const trash=previous.fileId?await tx.uploadFile.findFirst({where:{id:previous.fileId,userId,trashedAt:{not:null},purgedAt:null}}):null;
     if(file&&!missing||trash)return previous;
     if(file&&missing)await tx.uploadFile.updateMany({where:{id:file.id,userId,deletedAt:null},data:{deletedAt:new Date(),purgedAt:new Date(),version:{increment:1}}});
    }
   }else if(expectedVersion!==0)throw new BusinessException(ErrorCode.PARAM_INVALID,'请先核对原保存记录',409);
   if(await tx.agentArtifactSave.count({where:{userId,status:{in:ACTIVE}}})>=2)throw new BusinessException(ErrorCode.PARAM_INVALID,'已有两份成果正在保存，请稍后再试',409);
   if(previous)return tx.agentArtifactSave.update({where:{id:previous.id},data:{version:{increment:1},status:'QUEUED',stageJson:null,fileId:null,errorCode:null}});
   return tx.agentArtifactSave.create({data:{userId,messageId,artifactKey:key,sourceUrl:artifact.url,title:artifact.title}});
  });this.kick();return this.view(key,row);
 }
 private kick(queuedOnly=false){if(this.stopped||this.scanning)return;this.scanning=true;queueMicrotask(async()=>{
  try{const rows=await this.prisma.agentArtifactSave.findMany({where:{status:{in:queuedOnly?['QUEUED']:['QUEUED','STORING','VERIFYING']}},orderBy:{createdAt:'asc'},take:100});
   for(const row of rows){if(this.stopped||this.running.size>=4)break;if(this.running.has(row.id))continue;const abort=new AbortController(),promise=this.run(row,abort.signal).catch(()=>this.logger.warn('成果保存记录等待下次核对')).finally(()=>{this.running.delete(row.id);this.kick(true);});this.running.set(row.id,{promise,abort});}
  }catch{this.logger.warn('成果保存队列暂未读到');}finally{this.scanning=false;}
 });}
 private async commit(row:any,stage:ArtifactStage){
  await this.prisma.$transaction(async tx=>{
   const receipt=await tx.agentArtifactSave.findFirst({where:{id:row.id,version:row.version,status:{in:['STORING','VERIFYING']}}});if(!receipt)return;
   const actor=await tx.user.findFirst({where:{id:row.userId,status:'ACTIVE',deletedAt:null}}),message=await tx.message.findFirst({where:{id:row.messageId,deletedAt:null,conversation:{userId:row.userId,deletedAt:null}}});
   if(!actor||!message)throw new Error('SOURCE');
   const existing=await tx.uploadFile.findUnique({where:{id:stage.id}});
   if(existing&&(existing.userId!==row.userId||existing.storedKey!==stage.storedKey||existing.sha256!==stage.sha256||existing.deletedAt||existing.purgedAt))throw new Error('INTEGRITY');
   if(!existing)await tx.uploadFile.create({data:{...stage,userId:row.userId,scope:'agent-result'}});
   await tx.agentArtifactSave.update({where:{id:row.id},data:{status:'SAVED',fileId:stage.id,errorCode:null}});
  });
 }
 private async recover(row:any,stage:ArtifactStage){
  try{if(!await this.storage.verifyArtifact(stage)){await this.fail(row,'INTERRUPTED');return;}await this.commit(row,stage);}
  catch(error){const code=(error as Error)?.message;if(['INTEGRITY','SOURCE','STORAGE'].includes(code)){await this.fail(row,code);}else await this.prisma.agentArtifactSave.updateMany({where:{id:row.id,version:row.version,status:{in:['STORING','VERIFYING']}},data:{status:'VERIFYING',errorCode:null}});}
 }
 private async fail(row:any,code:string){await this.prisma.agentArtifactSave.updateMany({where:{id:row.id,version:row.version,status:{in:ACTIVE}},data:{status:'FAILED',errorCode:COPY[code]?code:'STORAGE'}});}
 private async run(row:any,signal:AbortSignal){
  if(row.status!=='QUEUED'){
   let stage:ArtifactStage;try{stage=JSON.parse(row.stageJson||'');}catch{await this.fail(row,'STORAGE');return;}await this.recover(row,stage);return;
  }
  const claimed=await this.prisma.agentArtifactSave.updateMany({where:{id:row.id,version:row.version,status:'QUEUED'},data:{status:'FETCHING',errorCode:null}});if(!claimed.count)return;
  let stage:ArtifactStage|undefined;
  try{
   await this.source(row.userId,row.messageId);if(!await this.prisma.user.findFirst({where:{id:row.userId,status:'ACTIVE',deletedAt:null}}))throw new Error('SOURCE');
   const buffer=await downloadArtifact(row.sourceUrl,await this.storage.artifactLimit(),signal);signal.throwIfAborted();stage=await this.storage.prepareArtifact(buffer,row.title);
   const prepared=await this.prisma.agentArtifactSave.updateMany({where:{id:row.id,version:row.version,status:'FETCHING'},data:{status:'STORING',stageJson:JSON.stringify(stage)}});if(!prepared.count)return;
   await this.storage.putArtifact(stage,buffer);await this.commit(row,stage);
  }catch(error){
   if(stage){await this.recover(row,stage);return;}
   await this.fail(row,error instanceof ArtifactDownloadError?error.code:(error as Error)?.message||'STORAGE');
  }
 }
}
