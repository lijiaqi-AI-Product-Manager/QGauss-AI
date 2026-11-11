import {Injectable,Optional} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {AuthUser,authSession} from '../../common/decorators/current-user.decorator';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {managementInput,sessionActionInput,sessionQuery} from './account-controls.query';
import {userId} from './users.query';
import {CONFIG_MAP,coerceConfigValue} from '../../common/config/config.registry';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const targetSelect={id:true,username:true,email:true,role:true,status:true,deletedAt:true,adminNote:true,isDistribution:true,updatedAt:true,tokenVersion:true} satisfies Prisma.UserSelect;
type Target=Prisma.UserGetPayload<{select:typeof targetSelect}>;
type Group={familyId:string;signature:string;createdAt:number|bigint|string|Date;lastSeenAt:number|bigint|string|Date;expiresAt:number|bigint|string|Date;revision?:string};
const milliseconds=(value:Group['createdAt'])=>typeof value==='bigint'?Number(value):typeof value==='number'?value:new Date(value).getTime();
const stamp=(value:Group['createdAt'])=>new Date(milliseconds(value)).toISOString();
const identity=(value:{id:string;username:string;email:string|null})=>({id:value.id,username:value.username,email:value.email});
const nextUpdatedAt=(current:Date)=>new Date(Math.max(Date.now(),current.getTime()+1));
const conflict=(message:string):never=>{throw new BusinessException(ErrorCode.PARAM_INVALID,message,409);};

@Injectable()
export class UserAccountControlsService {
  constructor(private readonly prisma:PrismaService,@Optional() private readonly rate?:RateLimitService){}
  private consume(actorId:string){if(this.rate&&!this.rate.tryConsume('account-action:'+actorId,40,60000))throw new BusinessException(ErrorCode.RATE_LIMITED,'操作过于频繁，请稍后再试',429);}

  private async actor(tx:Prisma.TransactionClient,actor:AuthUser,own:boolean){
    const context=authSession(actor),person=await tx.user.findFirst({where:{id:actor.id,status:'ACTIVE',deletedAt:null},select:{id:true,username:true,email:true,role:true,tokenVersion:true}});
    if(!person||!context||person.tokenVersion!==context.tokenVersion||(!own&&person.role!=='ADMIN')||!['USER','ADMIN'].includes(person.role)||!await tx.refreshToken.findFirst({where:{userId:actor.id,familyId:context.familyId,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前登录无权执行此操作',403);
    return{person,context};
  }

  private async person(tx:Prisma.TransactionClient,id:string){const value=await tx.user.findFirst({where:{id,deletedAt:null},select:targetSelect});if(!value)throw new BusinessException(ErrorCode.NOT_FOUND,'用户不存在或已移除',404);return value;}
  private writable(person:Target){if(person.role==='SUPER')throw new BusinessException(ErrorCode.FORBIDDEN,'受保护账号不可执行此操作',403);}

  private async groups(tx:Prisma.TransactionClient,id:string,tokenVersion:number,now:Date){
    const rows=await tx.$queryRaw<Group[]>(Prisma.sql`SELECT r."familyId",min(r."createdAt") "createdAt",max(coalesce(r."usedAt",r."createdAt")) "lastSeenAt",max(CASE WHEN r."revokedAt" IS NULL AND r."expiresAt">${now} THEN r."expiresAt" END) "expiresAt",group_concat(CASE WHEN r."revokedAt" IS NULL AND r."expiresAt">${now} THEN r."id" END,',') "signature" FROM "refresh_tokens" r WHERE r."userId"=${id} GROUP BY r."familyId" HAVING sum(CASE WHEN r."revokedAt" IS NULL AND r."expiresAt">${now} THEN 1 ELSE 0 END)>0`);
    return rows.map(row=>({...row,revision:digest({userId:id,tokenVersion,familyId:row.familyId,ids:row.signature.split(',').sort(),expiresAt:stamp(row.expiresAt)})})).sort((a,b)=>milliseconds(b.lastSeenAt)-milliseconds(a.lastSeenAt)||(a.familyId<b.familyId?1:a.familyId>b.familyId?-1:0));
  }
  private revision(groups:Awaited<ReturnType<UserAccountControlsService['groups']>>,user:Target){return digest({userId:user.id,tokenVersion:user.tokenVersion,sessions:groups.map(row=>[row.familyId,row.revision]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)});}

  async sessions(id:string,input:Record<string,unknown>,actor:AuthUser,own=false){
    userId(id);if(own&&id!==actor.id)throw new BusinessException(ErrorCode.FORBIDDEN,'只能查看自己的登录',403);const q=sessionQuery(input);
    return this.prisma.$transaction(async tx=>{const accepted=await this.actor(tx,actor,own),person=await this.person(tx,id),now=new Date(),all=await this.groups(tx,id,person.tokenVersion,now),asOf=typeof input.asOf==='string'&&input.asOf.trim()?q.asOf:new Date(all.reduce((latest,row)=>milliseconds(row.createdAt)<=now.getTime()+1000?Math.max(latest,milliseconds(row.createdAt)):latest,now.getTime())).toISOString(),listed=all.filter(row=>milliseconds(row.createdAt)<=new Date(asOf).getTime()),visible=listed.slice((q.page-1)*q.pageSize,q.page*q.pageSize);
      const rows=visible.length?await tx.refreshToken.findMany({where:{userId:id,familyId:{in:visible.map(row=>row.familyId)},revokedAt:null,expiresAt:{gt:now}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{familyId:true,ip:true,userAgent:true}}):[];
      const others=all.filter(row=>id!==actor.id||row.familyId!==accepted.context.familyId);
      return{userId:id,user:{...identity(person),updatedAt:person.updatedAt.toISOString()},page:q.page,pageSize:q.pageSize,asOf,readAt:now.toISOString(),total:listed.length,activeTotal:all.length,otherTotal:others.length,revision:this.revision(all,person),otherRevision:this.revision(others,person),items:visible.map(row=>{const info=rows.find(item=>item.familyId===row.familyId);return{id:row.familyId,revision:row.revision,createdAt:stamp(row.createdAt),lastSeenAt:stamp(row.lastSeenAt),expiresAt:stamp(row.expiresAt),ip:info?.ip||'',userAgent:info?.userAgent||'',isCurrent:id===actor.id&&row.familyId===accepted.context.familyId};})};
    });
  }

  private async stored(tx:Prisma.TransactionClient,actorId:string,requestKey:string,payloadHash:string){const row=await tx.userAccountOperation.findUnique({where:{actorId_requestKey:{actorId,requestKey}}});if(!row)return null;if(row.payloadHash!==payloadHash)conflict('操作编号对应的内容已变化，请核对原操作');return JSON.parse(row.resultJson);}
  private async referralAccount(tx:Prisma.TransactionClient,user:Target){
    if(await tx.salesUser.findUnique({where:{userId:user.id},select:{id:true}}))return false;
    const definition=CONFIG_MAP.get('commerce.defaultCommissionBps')!,row=await tx.globalConfig.findUnique({where:{key:definition.key},select:{value:true}});let rate=definition.default;
    if(row)try{rate=coerceConfigValue(definition,JSON.parse(row.value))??definition.default;}catch{/* Invalid legacy settings use the registered default. */}
    await tx.salesUser.create({data:{userId:user.id,performanceBps:Number(rate),salesOutletName:user.username}});return true;
  }
  private async save(tx:Prisma.TransactionClient,actor:Pick<AuthUser,'id'|'username'|'email'>,user:Pick<Target,'id'|'username'|'email'>,kind:string,requestKey:string,payloadHash:string,details:object){const now=new Date(),id='uma-'+randomUUID(),receipt={id,kind,requestKey,userId:user.id,target:identity(user),actor:identity(actor),createdAt:now.toISOString(),outcome:'APPLIED',...details};await tx.userAccountOperation.create({data:{id,actorId:actor.id,userId:user.id,requestKey,kind,payloadHash,resultJson:JSON.stringify(receipt),createdAt:now}});return receipt;}

  async updateManagement(id:string,input:object,actor:AuthUser){
    userId(id);const parsed=managementInput(input),{requestKey,...body}=parsed,payloadHash=digest({userId:id,kind:'metadata',...body});
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;const accepted=await this.actor(tx,actor,false),old=await this.stored(tx,actor.id,requestKey,payloadHash);if(old)return old;
      this.consume(actor.id);const person=await this.person(tx,id);this.writable(person);if(person.updatedAt.toISOString()!==body.expectedUpdatedAt)conflict('用户资料已变化，请重新读取后核对');
      const before={adminNote:person.adminNote,isDistribution:person.isDistribution,updatedAt:person.updatedAt.toISOString()},data:Prisma.UserUpdateInput={};if(body.adminNote!==undefined&&body.adminNote!==person.adminNote)data.adminNote=body.adminNote;if(body.isDistribution!==undefined&&body.isDistribution!==person.isDistribution)data.isDistribution=body.isDistribution;
      const referralAccountCreated=body.isDistribution===true?await this.referralAccount(tx,person):false,fields=Object.keys(data);if(referralAccountCreated&&!fields.includes('isDistribution'))fields.push('isDistribution');const changed=fields.length>0;if(changed)data.updatedAt=nextUpdatedAt(person.updatedAt);const after=changed?await tx.user.update({where:{id},data,select:{adminNote:true,isDistribution:true,updatedAt:true}}):before;
      return this.save(tx,{...actor,...accepted.person},person,'metadata',requestKey,payloadHash,{changed,fields,before,referralAccountCreated,after:{...after,updatedAt:typeof after.updatedAt==='string'?after.updatedAt:after.updatedAt.toISOString()}});
    });
  }

  async endSessions(id:string,input:object,actor:AuthUser,own=false){
    userId(id);if(own&&id!==actor.id)throw new BusinessException(ErrorCode.FORBIDDEN,'只能管理自己的登录',403);const parsed=sessionActionInput(input),kind=parsed.scope==='one'?'session':parsed.scope,{requestKey,...body}=parsed,payloadHash=digest({userId:id,kind,...body});
    if(own&&body.scope==='all'||!own&&body.scope==='others')throw new BusinessException(ErrorCode.FORBIDDEN,'此入口不支持该登录范围',403);
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;const accepted=await this.actor(tx,actor,own),old=await this.stored(tx,actor.id,requestKey,payloadHash);if(old)return old;
      this.consume(actor.id);const person=await this.person(tx,id);this.writable(person);if(person.updatedAt.toISOString()!==body.expectedUpdatedAt)conflict('用户资料已变化，请重新读取后核对');
      if(body.scope==='all'&&id===actor.id||body.scope==='one'&&id===actor.id&&body.sessionId===accepted.context.familyId)throw new BusinessException(ErrorCode.PARAM_INVALID,'当前管理登录请使用退出登录',422);
      const now=new Date(),all=await this.groups(tx,id,person.tokenVersion,now),selected=body.scope==='one'?all.filter(row=>row.familyId===body.sessionId):body.scope==='others'?all.filter(row=>row.familyId!==accepted.context.familyId):all;
      if(body.scope==='one'&&selected.length!==1)conflict('该登录已结束，请重新读取后核对');const actual=body.scope==='one'?selected[0].revision:this.revision(selected,person);if(actual!==body.expectedRevision)conflict('登录范围已变化，请重新读取后核对');
      if(selected.length){await tx.user.update({where:{id},data:{updatedAt:nextUpdatedAt(person.updatedAt),...(body.scope==='all'?{tokenVersion:{increment:1}}:{})}});await tx.refreshToken.updateMany({where:{userId:id,familyId:{in:selected.map(row=>row.familyId)},revokedAt:null},data:{revokedAt:now}});}
      return this.save(tx,{...actor,...accepted.person},person,kind,requestKey,payloadHash,{changed:selected.length>0,scope:body.scope,...(body.scope==='one'?{sessionId:body.sessionId}:{}),endedCount:selected.length});
    });
  }

  async kickOffline(id:string,actor:AuthUser){
    userId(id);if(id===actor.id)throw new BusinessException(ErrorCode.PARAM_INVALID,'当前管理账号不能全部下线',422);
    return this.prisma.$transaction(async tx=>{await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;await this.actor(tx,actor,false);this.consume(actor.id);const person=await this.person(tx,id);this.writable(person);await tx.user.update({where:{id},data:{tokenVersion:{increment:1},updatedAt:nextUpdatedAt(person.updatedAt)}});await tx.refreshToken.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});return{ok:true};});
  }

  async resolveAction(id:string,input:{kind:string;payload:object},actor:AuthUser,own=false){
    userId(id);if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['kind','payload'].includes(key))||!['metadata','session','all','others'].includes(input.kind))throw new BusinessException(ErrorCode.PARAM_INVALID,'操作内容不正确',400);
    if(own&&(id!==actor.id||input.kind==='metadata'||input.kind==='all')||!own&&input.kind==='others')throw new BusinessException(ErrorCode.FORBIDDEN,'此入口不支持该操作范围',403);
    const parsed=input.kind==='metadata'?managementInput(input.payload):sessionActionInput(input.payload),{requestKey,...body}=parsed;
    if(input.kind!=='metadata'&&('scope' in parsed?parsed.scope==='one'?'session':parsed.scope:'')!==input.kind)throw new BusinessException(ErrorCode.PARAM_INVALID,'操作内容不正确',400);
    const payloadHash=digest({userId:id,kind:input.kind,...body});
    return this.prisma.$transaction(async tx=>{await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;const accepted=await this.actor(tx,actor,own),old=await this.stored(tx,actor.id,requestKey,payloadHash);if(old)return old;this.consume(actor.id);
      const person=await tx.user.findUnique({where:{id},select:{id:true,username:true,email:true}});
      // Recording the final outcome under the same writer lock also stops a delayed original request.
      return this.save(tx,{...actor,...accepted.person},person||{id,username:'',email:''},input.kind,requestKey,payloadHash,{outcome:'NOT_APPLIED',changed:false,fields:[]});
    });
  }
}
