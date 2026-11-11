import {Injectable} from '@nestjs/common';
import {PhoneAccountAction,Prisma} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {AuthUser} from '../../common/decorators/current-user.decorator';
import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {passwordProblem} from '../../common/security/password-policy';
import {SettingsService} from '../settings/settings.service';
import {PhoneDeliveryService} from './phone-delivery.service';
import {maskedPhone,phoneActionInput,phoneBad,phoneCloseInput,phoneKey} from './phone-input';
import {phoneSession} from './phone-session';

type Meta={ip?:string};
const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'未找到这次账户处理',404);
const changed=()=>phoneBad('这次处理已有变化，请重新核对。',409);

@Injectable()
export class PhoneAccountService {
  constructor(private readonly prisma:PrismaService,private readonly delivery:PhoneDeliveryService,private readonly settings:SettingsService,private readonly rateLimit:RateLimitService){}
  private receipt(row:PhoneAccountAction){return{requestKey:row.id,purpose:row.purpose,status:row.status==='APPLIED'?'applied':'closed',version:row.version,serverNow:new Date().toISOString(),...(row.appliedAt?{appliedAt:row.appliedAt.toISOString()}:{}),...(row.phoneMasked?{phoneMasked:row.phoneMasked}:{})};}
  private same(row:PhoneAccountAction,owner:string,purpose?:string){if(row.owner!==owner)throw missing();if(purpose&&row.purpose!==purpose)throw changed();if(owner==='guest'&&row.purpose==='bind'||owner!=='guest'&&row.purpose!=='bind')throw missing();}
  async read(key:string,actor?:AuthUser){const row=await this.prisma.phoneAccountAction.findUnique({where:{id:phoneKey(key)}});if(!row)throw missing();this.same(row,actor?.id||'guest');return this.receipt(row);}
  async identity(actor:AuthUser){return this.prisma.$transaction(async tx=>{await phoneSession(tx,actor);const row=await tx.userPhoneIdentity.findUnique({where:{userId:actor.id}});return{phoneMasked:row?maskedPhone(row.phone):null,verifiedAt:row?.verifiedAt.toISOString()||null,updatedAt:row?.updatedAt.toISOString()||null};});}
  async apply(key:string,input:unknown,meta:Meta={},actor?:AuthUser){
    const id=phoneKey(key),body=phoneActionInput(input,!!actor),owner=actor?.id||'guest',inputHash=this.delivery.digest('account',JSON.stringify([owner,body.purpose,body.phone,body.code,body.password,body.username,body.inviteCode,body.expectedUpdatedAt||'']));
    if(body.expectedVersion!==0)throw changed();
    const prior=await this.prisma.phoneAccountAction.findUnique({where:{id}});
    if(prior){this.same(prior,owner,body.purpose);if(prior.status!=='CLOSED'&&prior.inputHash!==inputHash)throw changed();return this.receipt(prior);}
    if(!this.rateLimit.tryConsume('phone-account:'+(meta.ip||'unknown'),30,900_000))throw new BusinessException(ErrorCode.RATE_LIMITED,'核对请求过于频繁，请稍后再试',429);
    const policy=await this.delivery.policy();
    const accessInvite=body.purpose==='register'?await this.settings.get<string>('security.registerInviteCode'):'';
    if(body.purpose==='register'&&!policy.registrationEnabled)throw phoneBad('注册暂未开放，已有账户仍可登录。');
    if(body.purpose==='register'&&accessInvite&&body.inviteCode!==accessInvite)throw phoneBad('邀请码不正确');
    const current=actor?await this.prisma.user.findFirst({where:{id:actor.id,status:'ACTIVE',deletedAt:null}}):null;
    if(actor&&(!current||!await bcrypt.compare(body.password,current.passwordHash)))throw new BusinessException(ErrorCode.CREDENTIAL_INVALID,'当前密码不正确，请重新填写',401);
    const passwordHash=actor?undefined:await bcrypt.hash(body.password,10);
    let result:{row?:PhoneAccountAction;error?:BusinessException};
    try{result=await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "phone_account_actions" SET "id"="id" WHERE "id"=${id}`;
      const row=await tx.phoneAccountAction.findUnique({where:{id}});
      if(row){this.same(row,owner,body.purpose);if(row.status!=='CLOSED'&&row.inputHash!==inputHash)throw changed();return{row};}
      const session=actor?await phoneSession(tx,actor):null;
      if(session&&session.user.passwordHash!==current!.passwordHash)throw new BusinessException(ErrorCode.UNAUTHORIZED,'当前登录已变化，请重新登录',401);
      const identity=await tx.userPhoneIdentity.findUnique({where:{phone:body.phone}});
      let person=session?.user;
      if(body.purpose==='recover'){
        person=identity?await tx.user.findFirst({where:{id:identity.userId,status:'ACTIVE',deletedAt:null}})||undefined:undefined;
        if(!person)return{error:phoneBad()};
      }else if(body.purpose==='bind'){
        if(!person)throw new BusinessException(ErrorCode.UNAUTHORIZED,'请重新登录',401);
        if(person.updatedAt.toISOString()!==body.expectedUpdatedAt)throw changed();
      }
      const proof=await this.delivery.claimTx(tx,body.phone,body.purpose,body.code,owner,person?{id:person.id,tokenVersion:person.tokenVersion}:undefined);
      if(!proof)return{error:phoneBad()};
      if(body.purpose==='register'&&(identity||await tx.user.findUnique({where:{username:body.username},select:{id:true}})))return{error:phoneBad('号码或登录名已被使用，请核对后再试')};
      if(body.purpose==='bind'&&identity)return{error:phoneBad(identity.userId===person!.id?'这个号码已经绑定当前账户':'这个号码当前无法绑定，请核对后再试')};
      const now=new Date();let subjectId:string;
      if(body.purpose==='register'){
        const referral=body.inviteCode.trim().toUpperCase();let invitedBy='';
        if(referral&&body.inviteCode!==accessInvite){const inviter=await tx.user.findFirst({where:{inviteCode:referral,isDistribution:true,deletedAt:null},select:{id:true}});if(inviter)invitedBy=inviter.id;}
        const user=await tx.user.create({data:{email:null,username:body.username,passwordHash:passwordHash!,invitedBy}});
        await tx.userPhoneIdentity.create({data:{userId:user.id,phone:body.phone,verifiedAt:now}});subjectId=user.id;
      }else if(body.purpose==='recover'){
        const problem=passwordProblem(body.password,['ADMIN','SUPER'].includes(person!.role));if(problem)return{error:phoneBad(problem,422)};
        if(await bcrypt.compare(body.password,person!.passwordHash))return{error:phoneBad('请使用与当前密码不同的新密码。',422)};
        const accepted=await tx.user.updateMany({where:{id:person!.id,tokenVersion:person!.tokenVersion,passwordHash:person!.passwordHash,status:'ACTIVE',deletedAt:null},data:{passwordHash:passwordHash!,tokenVersion:{increment:1},updatedAt:new Date(Math.max(Date.now(),person!.updatedAt.getTime()+1))}});
        if(accepted.count!==1)throw changed();
        await tx.refreshToken.updateMany({where:{userId:person!.id,revokedAt:null},data:{revokedAt:now}});
        await tx.passwordReset.updateMany({where:{userId:person!.id,usedAt:null},data:{usedAt:now}});subjectId=person!.id;
      }else{
        await tx.userPhoneIdentity.upsert({where:{userId:person!.id},create:{userId:person!.id,phone:body.phone,verifiedAt:now},update:{phone:body.phone,verifiedAt:now}});
        await tx.user.update({where:{id:person!.id},data:{updatedAt:new Date(Math.max(Date.now(),person!.updatedAt.getTime()+1))}});subjectId=person!.id;
      }
      await this.delivery.consumeTx(tx,proof);
      return{row:await tx.phoneAccountAction.create({data:{id,owner,purpose:body.purpose,inputHash,status:'APPLIED',subjectId,phoneMasked:maskedPhone(body.phone),appliedAt:now}})};
    });}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw phoneBad('号码或登录名已被使用，请核对后再试');throw error;}
    if(result.error)throw result.error;return this.receipt(result.row!);
  }
  async close(key:string,input:unknown,meta:Meta={},actor?:AuthUser){
    const id=phoneKey(key),body=phoneCloseInput(input,!!actor),owner=actor?.id||'guest';
    if(!this.rateLimit.tryConsume('phone-account-close:'+owner+':'+(meta.ip||'unknown'),30))throw new BusinessException(ErrorCode.RATE_LIMITED,'操作过于频繁，请稍后再试',429);
    const row=await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "phone_account_actions" SET "id"="id" WHERE "id"=${id}`;
      if(actor)await phoneSession(tx,actor);
      const row=await tx.phoneAccountAction.findUnique({where:{id}});
      if(!row){if(body.expectedVersion!==0)throw changed();return tx.phoneAccountAction.create({data:{id,owner,purpose:body.purpose,status:'CLOSED'}});}
      this.same(row,owner,body.purpose);if(row.status==='APPLIED'||row.status==='CLOSED')return row;if(row.version!==body.expectedVersion)throw changed();
      return tx.phoneAccountAction.update({where:{id},data:{status:'CLOSED',version:{increment:1}}});
    });return this.receipt(row);
  }
}
