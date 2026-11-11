import {Prisma} from '@prisma/client';
import {AuthUser,authSession} from '../../common/decorators/current-user.decorator';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';

export async function phoneSession(tx:Prisma.TransactionClient,actor:AuthUser){
  await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;
  const context=authSession(actor),now=new Date(),user=await tx.user.findFirst({where:{id:actor.id,status:'ACTIVE',deletedAt:null}});
  if(!user||!context||context.tokenVersion!==user.tokenVersion||context.expiresAt!==null&&context.expiresAt<=now.getTime()||!await tx.refreshToken.findFirst({where:{userId:user.id,familyId:context.familyId,revokedAt:null,expiresAt:{gt:now}},select:{id:true}}))throw new BusinessException(ErrorCode.UNAUTHORIZED,'当前登录已变化，请重新登录',401);
  return{user,context};
}
