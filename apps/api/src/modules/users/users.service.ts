import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { passwordProblem } from '../../common/security/password-policy';
import { Prisma } from '@prisma/client';
import { userQuery, userConditions, userId, activityQuery } from './users.query';
import { shanghaiDate } from '../commerce/ledger.service';
import {AuthUser,authSession} from '../../common/decorators/current-user.decorator';
import {profileInput,ProfileInput} from './profile.query';
import {AVATAR_PREFIX,AVATAR_SCOPE,avatarId} from './avatar-image';

const publicUser = { id:true,email:true,username:true,displayName:true,role:true,status:true,isDistribution:true,adminNote:true,emailVerifiedAt:true,createdAt:true,updatedAt:true } satisfies Prisma.UserSelect;
const orderBy = [{ createdAt:'desc' as const },{ id:'desc' as const }];
const explicitBoundary=(input:Record<string,unknown>)=>typeof input.asOf==='string'&&!!input.asOf.trim();
const boundary=(now:Date,dates:(Date|null)[])=>new Date(Math.max(now.getTime(),...dates.filter((date):date is Date=>!!date&&date.getTime()<=now.getTime()+1000).map(date=>date.getTime()))).toISOString();

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly rateLimit: RateLimitService) {}

  private async activityReadAt(tx:Prisma.TransactionClient,id:string,kind?:string){
    const now=new Date(),where={userId:id,createdAt:{lte:new Date(now.getTime()+1000)}},pending:Promise<Date|null>[]=[];
    if(!kind||kind==='grants')pending.push(tx.accountLog.aggregate({where,_max:{createdAt:true}}).then(row=>row._max.createdAt));
    if(!kind||kind==='logins')pending.push(tx.userLoginLog.aggregate({where,_max:{createdAt:true}}).then(row=>row._max.createdAt));
    if(!kind||kind==='conversations')pending.push(tx.conversation.aggregate({where,_max:{createdAt:true}}).then(row=>row._max.createdAt));
    if(!kind||kind==='management')pending.push(tx.userAccountOperation.aggregate({where,_max:{createdAt:true}}).then(row=>row._max.createdAt));
    return boundary(now,await Promise.all(pending));
  }

  private strip(user: any) {
    if (!user) return null;
    const { passwordHash, tokenVersion, adminNote, ...rest } = user;
    return rest;
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);
    return this.strip(user);
  }

  async updateProfile(userId:string,input:ProfileInput,actor?:AuthUser){
    const {expectedUpdatedAt,...fields}=profileInput(input);
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;
      const person=await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null}});
      if(!person)throw new BusinessException(ErrorCode.FORBIDDEN,'当前账号无法修改资料',403);
      if(actor){const context=authSession(actor);if(actor.id!==userId||!context||context.tokenVersion!==person.tokenVersion||!await tx.refreshToken.findFirst({where:{userId,familyId:context.familyId,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前登录无权执行此操作',403);}
      if(expectedUpdatedAt!==undefined&&person.updatedAt.toISOString()!==expectedUpdatedAt)throw new BusinessException(ErrorCode.PARAM_INVALID,'资料已变化，请读取最新资料并核对修改',409);
      const changes=Object.fromEntries(Object.entries(fields).filter(([key,value])=>person[key as keyof typeof person]!==value));
      if(!Object.keys(changes).length)return this.strip(person);
      if(Object.hasOwn(changes,'avatar')){
        const id=avatarId(changes.avatar);
        if(typeof changes.avatar==='string'&&changes.avatar.startsWith(AVATAR_PREFIX)&&!id)throw new BusinessException(ErrorCode.PARAM_INVALID,'头像内容不正确');
        if(id){
          const file=await tx.uploadFile.findFirst({where:{id,userId,scope:AVATAR_SCOPE,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});
          if(!file||!await tx.userAvatarUpload.findFirst({where:{userId,fileId:id,status:'READY'}}))throw new BusinessException(ErrorCode.PARAM_INVALID,'这份头像预览当前不可用，请重新选择图片。',409);
          await tx.uploadFile.update({where:{id},data:{expiresAt:null}});
        }
        const previous=avatarId(person.avatar);
        if(previous&&previous!==id)await tx.uploadFile.updateMany({where:{id:previous,userId,scope:AVATAR_SCOPE,deletedAt:null,purgedAt:null},data:{expiresAt:new Date(Date.now()+86400000)}});
      }
      const saved=await tx.user.update({where:{id:userId},data:{...changes,updatedAt:new Date(Math.max(Date.now(),person.updatedAt.getTime()+1))}});
      return this.strip(saved);
    });
  }

  /**
   * 改密：校验原密码 → 更新 hash → tokenVersion +1 → 吊销全部 refresh。
   * tokenVersion 变化会让所有已签发的 access token 在下一次请求时失效。
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    if (!this.rateLimit.tryConsume('change-password:' + userId, 5, 15 * 60_000)) throw new BusinessException(ErrorCode.RATE_LIMITED, '修改密码过于频繁，请稍后再试', 429);
    if (oldPassword === newPassword) throw new BusinessException(ErrorCode.PARAM_INVALID, '新密码不能与当前密码相同');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new BusinessException(ErrorCode.CREDENTIAL_INVALID, '原密码不正确');
    }

    const problem = passwordProblem(newPassword, user.role === 'ADMIN');
    if (problem) throw new BusinessException(ErrorCode.PARAM_INVALID, problem, 422);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({where:{id:userId,passwordHash:user.passwordHash,tokenVersion:user.tokenVersion,status:'ACTIVE',deletedAt:null},data:{passwordHash,tokenVersion:{increment:1}}});
      if (changed.count !== 1) throw new BusinessException(ErrorCode.CREDENTIAL_INVALID, '账号或密码已变更，请重新登录后操作', 409);
      const now = new Date();
      await tx.refreshToken.updateMany({where:{userId,revokedAt:null},data:{revokedAt:now}});
      await tx.passwordReset.updateMany({where:{userId,usedAt:null},data:{usedAt:now}});
    });

    return { ok: true };
  }

  async list(input: Record<string, unknown> = {}) {
    const q=userQuery(input);
    return this.prisma.$transaction(async tx=>{
      if(!explicitBoundary(input)){const now=new Date(),latest=await tx.user.aggregate({where:{deletedAt:null,createdAt:{lte:new Date(now.getTime()+1000)}},_max:{createdAt:true}});q.asOf=boundary(now,[latest._max.createdAt]);}
      const where=userConditions(q);
      const ids=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT u."id" FROM "users" u WHERE ${where} ORDER BY u."createdAt" DESC,u."id" DESC LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}`);
      const counts=await tx.$queryRaw<{total:bigint;active:bigint;admins:bigint}[]>(Prisma.sql`SELECT count(*) total,coalesce(sum(CASE WHEN u."status"='ACTIVE' THEN 1 ELSE 0 END),0) active,coalesce(sum(CASE WHEN u."role"='ADMIN' THEN 1 ELSE 0 END),0) admins FROM "users" u WHERE ${where}`);
      const items=ids.length?await tx.user.findMany({where:{id:{in:ids.map(row=>row.id)}},select:publicUser,orderBy}):[];
      return {items,total:Number(counts[0].total),active:Number(counts[0].active),admins:Number(counts[0].admins),page:q.page,pageSize:q.pageSize,asOf:q.asOf};
    });
  }

  async detail(id: string) {
    userId(id);
    return this.prisma.$transaction(async tx=>{
      const user=await tx.user.findFirst({where:{id,deletedAt:null},select:publicUser});
      if(!user)throw new BusinessException(ErrorCode.NOT_FOUND,'用户不存在',404);
      const readAt=await this.activityReadAt(tx,id),activityWhere={userId:id,createdAt:{lte:new Date(readAt)}};
      const [ub,money,reserved,conversations,grants,logins,management,sales]=await Promise.all([
        tx.userBalance.findUnique({where:{userId:id}}),tx.balance.findUnique({where:{userId:id},select:{balanceCents:true}}),
        tx.countReservation.groupBy({by:['pool'],where:{userId:id,status:'HELD'},_sum:{amount:true}}),
        tx.conversation.count({where:activityWhere}),tx.accountLog.count({where:activityWhere}),tx.userLoginLog.count({where:activityWhere}),
        tx.userAccountOperation.count({where:activityWhere}),
        tx.salesUser.findUnique({where:{userId:id},select:{id:true}}),
      ]);
      const now=new Date(),isMember=!!ub?.expirationTime&&ub.expirationTime>now,reset=ub?.memberResetOn!==shanghaiDate(now);
      const pools=[['model3','model3Count','memberModel3Count','dailyModel3Count'],['model4','model4Count','memberModel4Count','dailyModel4Count'],['drawMj','drawMjCount','memberDrawMjCount','dailyDrawMjCount'],['agent','agentCount','memberAgentCount','dailyAgentCount']] as const;
      const counts=Object.fromEntries(pools.map(([key,paid,member,daily])=>[key,{paid:ub?.[paid]??0,member:isMember?(ub?.[reset?daily:member]??0):0,reserved:reserved.find(row=>row.pool===key)?._sum.amount??0}]));
      return {...user,distributionAccountReady:!!sales,balanceCents:money?.balanceCents??0,counts,isMember,expirationTime:ub?.expirationTime??null,activity:{conversations,grants,logins,management},readAt};
    });
  }

  async activity(id: string,input: Record<string,unknown> = {}) {
    userId(id);const q=activityQuery(input),{kind,page,pageSize}=q,skip=(page-1)*pageSize;
    return this.prisma.$transaction(async tx=>{
      if(!await tx.user.findFirst({where:{id,deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.NOT_FOUND,'用户不存在',404);
      const asOf=explicitBoundary(input)?q.asOf:await this.activityReadAt(tx,id,kind),where={userId:id,createdAt:{lte:new Date(asOf)}};
      if(kind==='management'){const [rows,total]=await Promise.all([tx.userAccountOperation.findMany({where,orderBy,skip,take:pageSize,select:{id:true,kind:true,resultJson:true,createdAt:true}}),tx.userAccountOperation.count({where})]);return{items:rows.map(({resultJson,...row})=>({...row,receipt:JSON.parse(resultJson)})),total,page,pageSize,kind,userId:id,asOf};}
      const [items,total]=kind==='logins'?await Promise.all([
        tx.userLoginLog.findMany({where,orderBy,skip,take:pageSize,select:{id:true,success:true,ip:true,userAgent:true,createdAt:true}}),tx.userLoginLog.count({where}),
      ]):kind==='grants'?await Promise.all([
        tx.accountLog.findMany({where,orderBy,skip,take:pageSize,select:{id:true,uid:true,pkgName:true,rechargeType:true,model3Count:true,model4Count:true,drawMjCount:true,agentCount:true,days:true,amountCents:true,remark:true,createdAt:true}}),tx.accountLog.count({where}),
      ]):await Promise.all([
        tx.conversation.findMany({where,orderBy,skip,take:pageSize,select:{id:true,title:true,deletedAt:true,createdAt:true,updatedAt:true}}),tx.conversation.count({where}),
      ]);
      return {items,total,page,pageSize,kind,userId:id,asOf};
    });
  }

  /** 封禁/解封：封禁时立即失效所有凭证 */
  async setStatus(id: string, status: 'ACTIVE' | 'DISABLED', actorId?: string, expectedUpdatedAt?: string) {
    // 自己把自己禁用 = 把唯一管理员锁在门外，直接拒绝
    if (actorId && actorId === id && status === 'DISABLED') {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '不能禁用自己的账号');
    }

    // 先查再改：直接 update 不存在的 id 会抛 P2025，前端只会看到 500
    userId(id);
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actorId||id}`;
      if(actorId&&!await tx.user.findFirst({where:{id:actorId,role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前账号无权管理用户',403);
      const existing=await tx.user.findFirst({where:{id,deletedAt:null},select:publicUser});
      if(!existing)throw new BusinessException(ErrorCode.NOT_FOUND,'用户不存在',404);
      if(existing.status===status)return existing;
      if(expectedUpdatedAt&&existing.updatedAt.toISOString()!==expectedUpdatedAt)throw new BusinessException(ErrorCode.PARAM_INVALID,'用户资料已变化，请重新核对',409);
      const user=await tx.user.update({where:{id},data:{status,...(status==='DISABLED'?{tokenVersion:{increment:1}}:{})},select:publicUser});
      if(status==='DISABLED')await tx.refreshToken.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
      return user;
    });
  }

  /** 登录日志 */
  async listLoginLogs(id: string, page = 1, pageSize = 20) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BusinessException(ErrorCode.PARAM_INVALID, '登录记录分页参数无效');
    const [items, total] = await this.prisma.$transaction([
      this.prisma.userLoginLog.findMany({
        where: { userId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.userLoginLog.count({ where: { userId: id } }),
    ]);
    return { items, total, page, pageSize };
  }

  async ownLoginLogs(userId: string, page = 1, pageSize = 4) {
    const result = await this.listLoginLogs(userId, page, pageSize);
    return {...result,items:result.items.map(({id,success,ip,userAgent,createdAt})=>({id,success,ip,userAgent,createdAt}))};
  }

}
