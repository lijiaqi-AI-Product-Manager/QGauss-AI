import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { SettingsService } from '../settings/settings.service';
import { MailService } from '../mail/mail.service';
import { CaptchaService } from './captcha.service';
import { RegistrationCodeDto } from './dto/email-verification.dto';
import {emailCodeHash,emailCodeMatches} from '../../common/security/email-code';

type Purpose='REGISTER'|'ACCOUNT';
type Proof={id:string;email:string;purpose:Purpose;userId:string|null;tokenVersion:number|null;codeHash:string};
const bad=(message='邮箱验证码错误、过期或已使用')=>new BusinessException(ErrorCode.PARAM_INVALID,message);
const limited=(message:string)=>new BusinessException(ErrorCode.RATE_LIMITED,message,429);
const TEN_MINUTES=600000,DAY=86400000;

@Injectable()
export class EmailVerificationService {
  constructor(private readonly prisma:PrismaService,private readonly config:ConfigService,private readonly settings:SettingsService,private readonly mail:MailService,private readonly captcha:CaptchaService,private readonly rateLimit:RateLimitService){}
  async policy(){return{emailVerificationRequired:await this.settings.get<boolean>('security.emailVerificationRequired'),emailDeliveryReady:this.mail.configurationSummary().ready,expiresIn:600,resendAfter:60};}
  private digest(value:string){return createHmac('sha256',this.config.getOrThrow<string>('JWT_SECRET')).update('qgauss-email-verification\0'+value).digest('hex');}
  private signature(row:{id:string;email:string;purpose:string},code:string){return emailCodeHash(this.config.getOrThrow<string>('JWT_SECRET'),row,code);}
  async requestRegistration(dto:RegistrationCodeDto,ip?:string){
    if(!await this.settings.get<boolean>('security.registerEnabled'))throw new BusinessException(ErrorCode.FORBIDDEN,'当前未开放注册',403);
    if(!this.rateLimit.tryConsume('email-code-request:'+(ip||'unknown'),12))throw limited('寄送请求过于频繁，请稍后再试');
    if(!this.captcha.verify(dto.captchaId,dto.captchaCode))throw bad('图形验证码错误或已过期，请刷新后再试');
    return this.send(dto.email.trim().toLowerCase(),'REGISTER',ip);
  }
  async requestAccount(userId:string,ip?:string){
    if(!this.rateLimit.tryConsume('email-code-account:'+userId,6))throw limited('寄送请求过于频繁，请稍后再试');
    const user=await this.prisma.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null}});
    if(!user)throw new BusinessException(ErrorCode.UNAUTHORIZED,'请重新登录',401);
    if(!user.email)throw bad('这个账户尚未设置邮箱，请使用手机入口');
    if(user.emailVerifiedAt)throw bad('这个邮箱已验证');
    return this.send(user.email,'ACCOUNT',ip,{id:user.id,tokenVersion:user.tokenVersion});
  }
  private async send(email:string,purpose:Purpose,ip?:string,user?:{id:string;tokenVersion:number}){
    if(!this.mail.configurationSummary().ready)throw bad('邮箱投递尚未就绪，请联系站点管理员');
    const now=new Date(),id=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0'),ipHash=this.digest('ip\0'+(ip||'unknown'));
    const prepared=await this.mail.prepare('emailVerification',{code,challengeId:id,purpose:purpose==='REGISTER'?'创建账户':'确认注册邮箱'});
    if(prepared.status!=='queued')throw bad('邮箱投递尚未就绪，请稍后再试');
    await this.prisma.$transaction(async tx=>{
      if(user){const active=await tx.user.findFirst({where:{id:user.id,email,status:'ACTIVE',deletedAt:null,tokenVersion:user.tokenVersion,emailVerifiedAt:null}});if(!active)throw bad('账户状态已变化，请刷新个人空间');}
      const latest=await tx.emailVerification.findFirst({where:{email,purpose},orderBy:{createdAt:'desc'}});
      if(latest&&now.getTime()-latest.createdAt.getTime()<60000)throw limited('请等待一分钟后再寄送验证码');
      const since=new Date(now.getTime()-DAY);
      const [perEmail,perIp]=await Promise.all([tx.emailVerification.count({where:{email,createdAt:{gt:since}}}),tx.emailVerification.count({where:{ipHash,createdAt:{gt:since}}})]);
      if(perEmail>=10||perIp>=30)throw limited('今天的验证码寄送次数已用完，请稍后再试');
      await tx.emailVerification.updateMany({where:{email,purpose,usedAt:null},data:{usedAt:now}});
      await tx.emailVerification.create({data:{id,email,purpose,userId:user?.id,tokenVersion:user?.tokenVersion,codeHash:this.signature({id,email,purpose},code),ipHash,expiresAt:new Date(now.getTime()+TEN_MINUTES),createdAt:now}});
      await tx.mailOutbox.create({data:{...prepared,to:email,requestedById:user?.id}});
    });
    this.mail.kick();
    return{challengeId:id,expiresAt:new Date(now.getTime()+TEN_MINUTES).toISOString(),resendAfter:60};
  }
  /** Failed guesses are committed before an error is raised, so rollback cannot restore the guess budget. */
  async claim(challengeId:string|undefined,code:string|undefined,email:string,purpose:Purpose,ip?:string,user?:{id:string;tokenVersion:number}):Promise<Proof>{
    if(!this.rateLimit.tryConsume('email-code-confirm:'+(ip||'unknown'),30))throw limited('核对请求过于频繁，请稍后再试');
    if(typeof challengeId!=='string'||typeof code!=='string'||!/^\d{6}$/.test(code))throw bad();
    const result=await this.prisma.$transaction(async tx=>{
      const row=await tx.emailVerification.findFirst({where:{id:challengeId,email,purpose,userId:user?.id??null,tokenVersion:user?.tokenVersion??null,usedAt:null,expiresAt:{gt:new Date()},attempts:{lt:5}}});
      if(!row)return null;
      const accepted=await tx.emailVerification.updateMany({where:{id:row.id,codeHash:row.codeHash,usedAt:null,attempts:{lt:5},expiresAt:{gt:new Date()}},data:{attempts:{increment:1}}});
      if(accepted.count!==1)return null;
      if(!emailCodeMatches(this.config.getOrThrow<string>('JWT_SECRET'),row,code))return null;
      return{id:row.id,email:row.email,purpose,userId:row.userId,tokenVersion:row.tokenVersion,codeHash:row.codeHash};
    });
    if(!result)throw bad();return result;
  }
  async consumeTx(tx:Prisma.TransactionClient,proof:Proof){
    const accepted=await tx.emailVerification.updateMany({where:{id:proof.id,email:proof.email,purpose:proof.purpose,userId:proof.userId,tokenVersion:proof.tokenVersion,codeHash:proof.codeHash,usedAt:null,attempts:{lte:5},expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
    if(accepted.count!==1)throw bad();
  }
  async confirmAccount(userId:string,challengeId:string,code:string,ip?:string){
    const user=await this.prisma.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null}});
    if(!user)throw new BusinessException(ErrorCode.UNAUTHORIZED,'请重新登录',401);
    if(!user.email)throw bad('这个账户尚未设置邮箱，请使用手机入口');
    const proof=await this.claim(challengeId,code,user.email,'ACCOUNT',ip,{id:user.id,tokenVersion:user.tokenVersion});
    return this.prisma.$transaction(async tx=>{
      await this.consumeTx(tx,proof);const now=new Date();
      const accepted=await tx.user.updateMany({where:{id:user.id,email:user.email,tokenVersion:user.tokenVersion,status:'ACTIVE',deletedAt:null,emailVerifiedAt:null},data:{emailVerifiedAt:now}});
      if(accepted.count!==1)throw bad('账户状态已变化，请刷新个人空间');return{emailVerifiedAt:now.toISOString()};
    });
  }
}
