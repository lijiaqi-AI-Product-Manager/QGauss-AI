import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {PrismaService} from '../../common/prisma/prisma.service';
import {AuthUser,authSession} from '../../common/decorators/current-user.decorator';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {ArtifactStage,IncomingFile,StorageService} from '../storage/storage.service';
import {AVATAR_MAX_BYTES,AVATAR_MAX_PIXELS,AVATAR_PREFIX,AVATAR_SCOPE,avatarCrop,avatarId,normalizeAvatar} from './avatar-image';

const DAY=86400000;
const day=(date=new Date())=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
const bad=(message:string,status=400)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status);
const unavailable=()=>new BusinessException(ErrorCode.NOT_FOUND,'这张头像图片当前不可用。',404);
const failure:Record<string,string>={CONTENT:'图片无法完整读取，请换一张图片。',STORAGE:'这张图片暂时无法准备，请重新选择。',INTERRUPTED:'上次头像准备已中断，请重新选择图片。',SOURCE:'当前登录已变化，请重新登录后选择图片。'};

@Injectable()
export class UserAvatarService implements OnModuleInit,OnModuleDestroy{
 private readonly logger=new Logger(UserAvatarService.name);
 private readonly running=new Map<string,Promise<void>>();
 private readonly admitting=new Map<string,number>();
 private timer?:NodeJS.Timeout;private stopped=false;private scanning=false;private sweeping=false;private ticks=0;
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageService){}
 onModuleInit(){this.timer=setInterval(()=>this.kick(),15000);this.timer.unref();this.kick();}
 async onModuleDestroy(){this.stopped=true;if(this.timer)clearInterval(this.timer);await Promise.allSettled([...this.running.values()]);}
 private key(value:unknown){if(typeof value!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value))throw bad('头像准备标识不正确。');return value.toLowerCase();}
 private version(value:unknown){if(typeof value==='string'&&/^(?:0|[1-9]\d{0,8})$/.test(value))value=Number(value);if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>=1e9)throw bad('请先读取这次头像准备的最新结果。');return Number(value);}
 private async actor(tx:any,actor:AuthUser){
  const context=authSession(actor),person=await tx.user.findFirst({where:{id:actor.id,status:'ACTIVE',deletedAt:null}});
  if(!person||!context||context.tokenVersion!==person.tokenVersion||context.expiresAt!==null&&context.expiresAt<=Date.now()||!await tx.refreshToken.findFirst({where:{userId:actor.id,familyId:context.familyId,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前登录无权执行此操作。',403);
  return{person,context};
 }
 private async source(tx:any,row:any){return!!await tx.user.findFirst({where:{id:row.userId,status:'ACTIVE',deletedAt:null,tokenVersion:row.tokenVersion}})&&(!row.accessExpiresAt||row.accessExpiresAt>new Date())&&!!await tx.refreshToken.findFirst({where:{userId:row.userId,familyId:row.familyId,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}});}
 private quotaWhere(userId:string){return{userId,acceptedDay:day(),OR:[{status:'PROCESSING'},{fileId:{not:null}}]};}
 async policy(actor:AuthUser){await this.actor(this.prisma,actor);const used=await this.prisma.userAvatarUpload.count({where:this.quotaWhere(actor.id)});return{remaining:Math.max(0,10-used),dailyLimit:10,maxBytes:AVATAR_MAX_BYTES};}
 private async view(row:any){
  const base={requestKey:row.requestKey,version:row.version};
  if(row.status==='READY'){
   const file=await this.prisma.uploadFile.findFirst({where:{id:row.fileId,userId:row.userId,scope:AVATAR_SCOPE,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});
   if(!file)return{...base,status:'failed',error:'这份头像预览已过期，请重新选择图片。'};
   const owner=await this.prisma.user.findUnique({where:{id:row.userId},select:{avatar:true}});
   return{...base,status:'ready',avatar:AVATAR_PREFIX+file.id,current:owner?.avatar===AVATAR_PREFIX+file.id,expiresAt:file.expiresAt};
  }
  return{...base,status:row.status==='CLOSED'?'closed':row.status==='FAILED'?'failed':'processing',...(row.status==='FAILED'?{error:failure[row.errorCode]||failure.STORAGE}:{})};
 }
 async read(actor:AuthUser,key:unknown){
  const requestKey=this.key(key);await this.actor(this.prisma,actor);
  const row=await this.prisma.userAvatarUpload.findUnique({where:{userId_requestKey:{userId:actor.id,requestKey}}});
  if(!row)throw new BusinessException(ErrorCode.NOT_FOUND,'暂未找到这次头像准备。',404);
  if(row.status==='PROCESSING'&&!this.admitting.has(row.userId+':'+requestKey))this.start(row,()=>this.recover(row));
  return this.view(row);
 }
 async upload(actor:AuthUser,key:unknown,version:unknown,cropText:unknown,file:IncomingFile){
  const requestKey=this.key(key),expectedVersion=this.version(version),crop=avatarCrop(cropText);
  if(!file?.buffer?.length||file.buffer.length>AVATAR_MAX_BYTES)throw bad('头像图片不能超过 12MB。',413);
  const inputHash=createHash('sha256').update(file.buffer).update(JSON.stringify(crop)).digest('hex'),admission=actor.id+':'+requestKey;
  this.admitting.set(admission,(this.admitting.get(admission)||0)+1);
  try{
   const accepted=await this.prisma.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;const{context}=await this.actor(tx,actor);
    const previous=await tx.userAvatarUpload.findUnique({where:{userId_requestKey:{userId:actor.id,requestKey}}});
    if(previous){
     if(previous.status==='CLOSED')return{row:previous,write:false};
     if(previous.inputHash!==inputHash)throw bad('同一次头像准备不能更换图片或裁切范围。',409);
     if(previous.status!=='FAILED')return{row:previous,write:false};
     if(previous.version!==expectedVersion)throw bad('请先读取这次头像准备的最新结果。',409);
     if(previous.stageJson)throw bad('原图片正在核对，请结束这次准备后重新选择。',409);
    }else if(expectedVersion!==0)throw bad('请先读取这次头像准备的最新结果。',409);
    if(await tx.userAvatarUpload.count({where:this.quotaWhere(actor.id)})>=10)throw bad('今天已准备 10 张头像，请明天再来。',429);
    if(await tx.userAvatarUpload.count({where:{userId:actor.id,status:'PROCESSING'}})>=2||await tx.userAvatarUpload.count({where:{status:'PROCESSING'}})>=4)throw bad('头像正在准备中，请稍后再试。',429);
    const data={inputHash,status:'PROCESSING',errorCode:null,stageJson:null,fileId:null,acceptedDay:day(),familyId:context.familyId,tokenVersion:context.tokenVersion,accessExpiresAt:context.expiresAt===null?null:new Date(context.expiresAt)};
    const row=previous?await tx.userAvatarUpload.update({where:{id:previous.id},data:{...data,version:{increment:1}}}):await tx.userAvatarUpload.create({data:{...data,userId:actor.id,requestKey}});
    return{row,write:true};
   });
   if(accepted.write)this.start(accepted.row,()=>this.prepare(accepted.row,file,crop));
   return this.view(accepted.row);
  }finally{const left=(this.admitting.get(admission)||1)-1;if(left)this.admitting.set(admission,left);else this.admitting.delete(admission);}
 }
 private start(row:any,work:()=>Promise<void>){
  const key=row.id+':'+row.version;if(this.stopped||this.running.has(key))return;
  const pending=Promise.resolve().then(work).catch(()=>this.logger.warn('一张头像图片等待下次核对')).finally(()=>this.running.delete(key));this.running.set(key,pending);
 }
 private async prepare(row:any,file:IncomingFile,crop:ReturnType<typeof avatarCrop>){
  let stage:ArtifactStage|undefined;
  try{
   const image=await normalizeAvatar(file,crop);stage=await this.storage.prepareAvatarArtifact(image.buffer,image.mime,image.extension);
   const stored=await this.prisma.userAvatarUpload.updateMany({where:{id:row.id,version:row.version,status:'PROCESSING'},data:{stageJson:JSON.stringify(stage)}});
   if(!stored.count)return;
   await this.storage.putArtifact(stage,image.buffer);await this.commit(row,stage);
  }catch(error){if(stage)await this.recover({...row,stageJson:JSON.stringify(stage)});else await this.fail(row,error instanceof BusinessException?'CONTENT':'STORAGE');}
 }
 private async commit(row:any,stage:ArtifactStage){
  const committed=await this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${row.userId}`;
   const latest=await tx.userAvatarUpload.findFirst({where:{id:row.id,version:row.version,status:'PROCESSING'}});if(!latest)return false;
   if(!await this.source(tx,latest)){await tx.userAvatarUpload.update({where:{id:row.id},data:{status:'FAILED',errorCode:'SOURCE'}});return false;}
   const id='av_'+createHash('sha256').update(row.userId+':'+row.requestKey+':'+row.version).digest('hex').slice(0,48),existing=await tx.uploadFile.findUnique({where:{id}});
   if(existing&&(existing.userId!==row.userId||existing.sha256!==stage.sha256||existing.storedKey!==stage.storedKey||existing.scope!==AVATAR_SCOPE||existing.deletedAt||existing.purgedAt))throw Error('INTEGRITY');
   if(!existing)await tx.uploadFile.create({data:{...stage,id,userId:row.userId,scope:AVATAR_SCOPE,expiresAt:new Date(Date.now()+DAY)}});
   await tx.userAvatarUpload.update({where:{id:row.id},data:{status:'READY',fileId:id,errorCode:null}});return true;
  });if(!committed)await this.discard(stage);
 }
 private async discard(stage:ArtifactStage){if(!await this.prisma.uploadFile.findFirst({where:{storedKey:stage.storedKey}}))await this.storage.discardArtifact(stage);}
 private async fail(row:any,code:string){await this.prisma.userAvatarUpload.updateMany({where:{id:row.id,version:row.version,status:'PROCESSING'},data:{status:'FAILED',errorCode:code}});}
 private async recover(row:any){
  const latest=await this.prisma.userAvatarUpload.findFirst({where:{id:row.id,version:row.version,status:'PROCESSING'}});if(!latest)return;
  if(!latest.stageJson){await this.fail(latest,'INTERRUPTED');return;}
  try{const stage=JSON.parse(latest.stageJson)as ArtifactStage;if(await this.storage.verifyArtifact(stage))await this.commit(latest,stage);else await this.fail(latest,'STORAGE');}catch{await this.fail(latest,'STORAGE');}
 }
 async close(actor:AuthUser,key:unknown,version:unknown){
  const requestKey=this.key(key),expectedVersion=this.version(version);
  const result=await this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;const{person}=await this.actor(tx,actor);
   const row=await tx.userAvatarUpload.findUnique({where:{userId_requestKey:{userId:actor.id,requestKey}}});
   if(row?.status==='CLOSED')return row;
   if((row?.version||0)!==expectedVersion)throw bad('这次准备已有变化，请读取最新结果后再决定。',409);
   if(row?.fileId&&person.avatar===AVATAR_PREFIX+row.fileId)return row;
   if(row?.fileId)await tx.uploadFile.updateMany({where:{id:row.fileId,userId:actor.id,scope:AVATAR_SCOPE,deletedAt:null},data:{deletedAt:new Date()}});
   return row?tx.userAvatarUpload.update({where:{id:row.id},data:{status:'CLOSED',version:{increment:1}}}):tx.userAvatarUpload.create({data:{userId:actor.id,requestKey,status:'CLOSED',acceptedDay:day(),familyId:authSession(actor)!.familyId,tokenVersion:person.tokenVersion}});
  });return this.view(result);
 }
 async image(actor:AuthUser,id:string,still=false){
  if(!avatarId(AVATAR_PREFIX+id))throw unavailable();await this.actor(this.prisma,actor);
  const file=await this.prisma.uploadFile.findFirst({where:{id,userId:actor.id,scope:AVATAR_SCOPE,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});if(!file)throw unavailable();
  const result=await this.storage.readAvatarFile(id,actor.id);if(!still||result.mime==='image/png')return result;
  return{...result,buffer:await sharp(result.buffer,{page:0,pages:1,limitInputPixels:AVATAR_MAX_PIXELS}).png().toBuffer(),mime:'image/png',filename:'QGauss-avatar.png'};
 }
 private kick(){
  if(this.stopped||this.scanning)return;this.scanning=true;
  void(async()=>{try{const rows=await this.prisma.userAvatarUpload.findMany({where:{status:'PROCESSING'},orderBy:{updatedAt:'asc'},take:4});for(const row of rows)if(!this.admitting.has(row.userId+':'+row.requestKey))this.start(row,()=>this.recover(row));if(this.ticks++%40===0)await this.cleanup();}catch{this.logger.warn('头像准备记录稍后核对');}finally{this.scanning=false;}})();
 }
 async cleanup(){
  if(this.sweeping)return;this.sweeping=true;
  try{
   const now=new Date(),expires=new Date(now.getTime()+DAY);
   await this.prisma.$executeRaw`UPDATE "upload_files" SET "expiresAt"=${expires} WHERE "scope"=${AVATAR_SCOPE} AND "deletedAt" IS NULL AND "expiresAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "users" WHERE "avatar"=${AVATAR_PREFIX} || "upload_files"."id" AND "deletedAt" IS NULL)`;
   const files=await this.prisma.uploadFile.findMany({where:{scope:AVATAR_SCOPE,purgedAt:null,OR:[{deletedAt:{not:null}},{expiresAt:{lte:now}}]},take:40});
   for(const file of files){const changed=await this.prisma.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${file.userId}`;
    if(await tx.user.findFirst({where:{id:file.userId,avatar:AVATAR_PREFIX+file.id,deletedAt:null}}))return false;
    return!!(await tx.uploadFile.updateMany({where:{id:file.id,scope:AVATAR_SCOPE,purgedAt:null,OR:[{deletedAt:{not:null}},{expiresAt:{lte:now}}]},data:{deletedAt:now}})).count;
   });if(changed)await this.storage.purgeAvatarFile(file.id,file.userId);}
   const stale=await this.prisma.userAvatarUpload.findMany({where:{status:{in:['FAILED','CLOSED']},stageJson:{not:null}},take:40});
   for(const row of stale)if(![...this.running.keys()].some(key=>key.startsWith(row.id+':'))){await this.discard(JSON.parse(row.stageJson!)as ArtifactStage);await this.prisma.userAvatarUpload.updateMany({where:{id:row.id,version:row.version,status:{in:['FAILED','CLOSED']}},data:{stageJson:null}});}
  }finally{this.sweeping=false;}
 }
}
