import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {ArtifactStage,IncomingFile,StorageService} from './storage.service';

const COPY:Record<string,string>={INTERRUPTED:'上次上传已中断，可以重新上传原文件。',INTEGRITY:'上传内容未能完整保存，请重新上传原文件。',STORAGE:'文件暂未存好，可以稍后重新上传。',SOURCE:'当前身份不能完成这次上传。'};
@Injectable()
export class ChatUploadsService implements OnModuleInit,OnModuleDestroy{
 private readonly logger=new Logger(ChatUploadsService.name);
 private readonly running=new Map<string,Promise<void>>();private stopped=false;private scanning=false;private timer?:ReturnType<typeof setInterval>;
 private readonly admitting=new Map<string,number>();
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageService){}
 onModuleInit(){this.timer=setInterval(()=>this.kick(),15000);this.timer.unref?.();this.kick();}
 async onModuleDestroy(){this.stopped=true;clearInterval(this.timer);await Promise.allSettled([...this.running.values()]);}
 private async view(row:any){
  const base={requestKey:row.requestKey,version:row.version};
  if(row.status==='STORED')return{...base,...await this.storage.chatUploadFile(row.userId,row.fileId||'')};
  return{...base,status:row.status==='FAILED'?'failed':row.status==='VERIFYING'?'verifying':'storing',...(row.errorCode?{error:COPY[row.errorCode]||COPY.STORAGE}:{})};
 }
 async read(userId:string,requestKey:string){
  const row=await this.prisma.uploadReceipt.findUnique({where:{userId_requestKey:{userId,requestKey}}});
  if(!row)throw new BusinessException(ErrorCode.NOT_FOUND,'暂未找到这次上传记录',404);
  if(['STORING','VERIFYING'].includes(row.status)&&!this.admitting.has(userId+':'+requestKey))this.start(row,()=>this.recover(row));
  return this.view(row);
 }
 async save(userId:string,requestKey:string,expectedVersion:number,file:IncomingFile){
  const key=userId+':'+requestKey;this.admitting.set(key,(this.admitting.get(key)||0)+1);
  try{return await this.accept(userId,requestKey,expectedVersion,file);}finally{const count=(this.admitting.get(key)||1)-1;if(count)this.admitting.set(key,count);else this.admitting.delete(key);}
 }
 private async accept(userId:string,requestKey:string,expectedVersion:number,file:IncomingFile){
  const stage=await this.storage.prepareChatUpload(file),inputHash=createHash('sha256').update(JSON.stringify({sha256:stage.sha256,size:stage.size,mime:stage.mime,filename:stage.filename})).digest('hex');
  const old=await this.prisma.uploadReceipt.findUnique({where:{userId_requestKey:{userId,requestKey}}});
  if(old&&old.inputHash!==inputHash)throw new BusinessException(ErrorCode.PARAM_INVALID,'同一次上传不能换成不同文件，请重新添加附件',409);
  if(old?.status==='FAILED'&&old.version===expectedVersion){
   try{await this.discard(old);}catch{throw new BusinessException(ErrorCode.PARAM_INVALID,'原上传记录暂未确认，请稍后核对',409);}
  }
  const accepted=await this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;
   if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前身份不能上传附件',403);
   const previous=await tx.uploadReceipt.findUnique({where:{userId_requestKey:{userId,requestKey}}});
   if(previous){
    if(previous.inputHash!==inputHash)throw new BusinessException(ErrorCode.PARAM_INVALID,'同一次上传不能换成不同文件，请重新添加附件',409);
    if(previous.status!=='FAILED'||previous.version!==expectedVersion)return{row:previous,write:false};
   }else if(expectedVersion!==0)throw new BusinessException(ErrorCode.PARAM_INVALID,'请先核对原上传记录',409);
   if(await tx.uploadReceipt.count({where:{userId,status:{in:['STORING','VERIFYING']}}})>=3||await tx.uploadReceipt.count({where:{status:{in:['STORING','VERIFYING']}}})>=6)throw new BusinessException(ErrorCode.PARAM_INVALID,'还有附件正在保存，请稍后重新上传',429);
   const row=previous?await tx.uploadReceipt.update({where:{id:previous.id},data:{version:{increment:1},status:'STORING',stageJson:JSON.stringify(stage),fileId:null,errorCode:null}}):await tx.uploadReceipt.create({data:{userId,requestKey,inputHash,stageJson:JSON.stringify(stage)}});
   return{row,write:true};
  });
  if(accepted.write)this.start(accepted.row,async()=>{try{await this.storage.putArtifact(stage,file.buffer);await this.commit(accepted.row,stage);}catch{await this.recover(accepted.row);}});
  return this.view(accepted.row);
 }
 private start(row:any,work:()=>Promise<void>){
  const key=row.id+':'+row.version;if(this.stopped||this.running.has(key))return;
  const pending=Promise.resolve().then(work).catch(()=>this.logger.warn('附件上传记录等待下次核对')).finally(()=>this.running.delete(key));this.running.set(key,pending);
 }
 private kick(){if(this.stopped||this.scanning)return;this.scanning=true;queueMicrotask(async()=>{try{const rows=await this.prisma.uploadReceipt.findMany({where:{status:{in:['STORING','VERIFYING']}},orderBy:{updatedAt:'asc'},take:6});for(const row of rows)if(!this.admitting.has(row.userId+':'+row.requestKey))this.start(row,()=>this.recover(row));}catch{this.logger.warn('附件上传记录暂未读到');}finally{this.scanning=false;}});}
 private async commit(row:any,stage:ArtifactStage){
  const committed=await this.prisma.$transaction(async tx=>{
   const current=await tx.uploadReceipt.findFirst({where:{id:row.id,version:row.version,status:{in:['STORING','VERIFYING']}}});if(!current)return false;
   if(!await tx.user.findFirst({where:{id:row.userId,status:'ACTIVE',deletedAt:null}}))throw new Error('SOURCE');
   const existing=await tx.uploadFile.findUnique({where:{id:stage.id}});
   if(existing&&(existing.userId!==row.userId||existing.storedKey!==stage.storedKey||existing.sha256!==stage.sha256||existing.scope!=='chat'||existing.deletedAt||existing.purgedAt))throw new Error('INTEGRITY');
   if(!existing)await tx.uploadFile.create({data:{...stage,userId:row.userId,scope:'chat'}});
   await tx.uploadReceipt.update({where:{id:row.id},data:{status:'STORED',fileId:stage.id,errorCode:null}});
   return true;
  });if(!committed)await this.discard(row);
 }
 private async discard(row:any){const stage=JSON.parse(row.stageJson) as ArtifactStage;if(!await this.prisma.uploadFile.findFirst({where:{storedKey:stage.storedKey}}))await this.storage.discardArtifact(stage);}
 private async fail(row:any,code:string){
  const changed=await this.prisma.uploadReceipt.updateMany({where:{id:row.id,version:row.version,status:{in:['STORING','VERIFYING']}},data:{status:'FAILED',errorCode:code}});
  if(changed.count)await this.discard(row).catch(()=>this.logger.warn('未完成的附件存储等待下次清理'));
 }
 private async recover(row:any){
  try{const current=await this.prisma.uploadReceipt.findFirst({where:{id:row.id,version:row.version,status:{in:['STORING','VERIFYING']}}});if(!current)return;const stage=JSON.parse(current.stageJson) as ArtifactStage;
   if(!await this.storage.verifyArtifact(stage)){await this.fail(current,'INTERRUPTED');return;}await this.commit(current,stage);
  }catch(error){const code=(error as Error)?.message;if(['INTEGRITY','SOURCE','STORAGE'].includes(code))await this.fail(row,code);else await this.prisma.uploadReceipt.updateMany({where:{id:row.id,version:row.version,status:{in:['STORING','VERIFYING']}},data:{status:'VERIFYING',errorCode:null}});}
 }
}
