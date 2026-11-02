import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {GalleryKind,galleryId} from './gallery-query';

/** A later withdrawal invalidates an earlier, still pending publication confirmation. */
export async function saveGalleryPublication(prisma:PrismaService,userId:string,kind:GalleryKind,rawId:string,published:boolean,catId?:string,expectedUpdatedAt?:string){
 const id=galleryId(rawId);if(typeof published!=='boolean')throw new BusinessException(ErrorCode.PARAM_INVALID,'公开状态不正确',400);
 if(catId!==undefined&&(typeof catId!=='string'||catId.length>128))throw new BusinessException(ErrorCode.PARAM_INVALID,'作品分类不正确',400);
 const expected=expectedUpdatedAt===undefined?undefined:Date.parse(expectedUpdatedAt);if(expected!==undefined&&!Number.isFinite(expected))throw new BusinessException(ErrorCode.PARAM_INVALID,'作品确认时间不正确',400);
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;
  if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前账户不可用',403);
  const task=kind==='image'?await tx.imageTask.findFirst({where:{id,userId,deletedAt:null}}):kind==='mj'?await tx.mjTask.findFirst({where:{id,userId,deletedAt:null}}):await tx.videoTask.findFirst({where:{id,userId,deletedAt:null}});
  if(!task)throw new BusinessException(ErrorCode.NOT_FOUND,'作品不存在或当前不可用',404);
  if(published&&task.status!=='SUCCESS')throw new BusinessException(ErrorCode.PARAM_INVALID,'只有完成保存与结算的作品才能公开',400);
  const category=catId===undefined?task.catId:catId||null;
  if(catId&& !await tx.creationCat.findFirst({where:{id:catId,status:true},select:{id:true}}))throw new BusinessException(ErrorCode.PARAM_INVALID,'作品分类已变化，请刷新后重新选择',400);
  if(published&&task.published&&category===task.catId)return task;
  if(published&&expected!==undefined&&task.updatedAt.getTime()!==expected)throw new BusinessException(ErrorCode.PARAM_INVALID,'作品状态已变化，请重新核对后再确认公开',409);
  const now=new Date(Math.max(Date.now(),task.updatedAt.getTime()+1));
  const data={published,catId:category,updatedAt:now,...(published&&!task.published?{publishedAt:now}:{})};
  return kind==='image'?tx.imageTask.update({where:{id},data}):kind==='mj'?tx.mjTask.update({where:{id},data}):tx.videoTask.update({where:{id},data});
 });
}
