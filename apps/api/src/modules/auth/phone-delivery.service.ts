import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {PhoneVerificationRequest,Prisma} from '@prisma/client';
import {createHmac,randomInt,timingSafeEqual} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {SecretBox} from '../../common/crypto/secret-box';
import {AuthUser} from '../../common/decorators/current-user.decorator';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {SettingsService} from '../settings/settings.service';
import {CaptchaService} from './captcha.service';
import {PHONE_CODE_TTL,PHONE_COOLDOWN,PhonePurpose,maskedPhone,phoneBad,phoneCloseInput,phoneKey,phoneSendInput} from './phone-input';
import {PhoneSender,PhoneSendResult} from './phone-sender';
import {phoneSession} from './phone-session';

type Meta={ip?:string};
const liveStates=['QUEUED','SENDING','SUBMITTED','UNKNOWN'];
const limited=(message:string)=>new BusinessException(ErrorCode.RATE_LIMITED,message,429);
const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'未找到这次短信申请',404);
const changed=()=>phoneBad('这次申请已有变化，请重新核对。',409);

@Injectable()
export class PhoneDeliveryService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(PhoneDeliveryService.name);
  private readonly sender=new PhoneSender();
  private timer?:NodeJS.Timeout;
  private draining?:Promise<void>;
  private closing=false;
  constructor(private readonly prisma:PrismaService,private readonly config:ConfigService,private readonly settings:SettingsService,private readonly captcha:CaptchaService,private readonly rateLimit:RateLimitService,private readonly box:SecretBox){}
  digest(domain:string,value:string){return createHmac('sha256',this.config.getOrThrow<string>('JWT_SECRET')).update('qgauss-phone\0'+domain+'\0'+value).digest('hex');}
  private codeHash(row:{id:string;phone:string;purpose:string},code:string){return this.digest('code',JSON.stringify([row.id,row.phone,row.purpose,code]));}
  configurationSummary(){return this.sender.summary();}
  async policy(){
    const register=await this.settings.get<boolean>('security.registerEnabled'),phoneRegistration=await this.settings.get<boolean>('security.phoneRegistrationEnabled'),password=await this.settings.get<boolean>('security.phonePasswordEnabled');
    return{passwordEnabled:password!==false,registrationEnabled:!!register&&phoneRegistration!==false,deliveryReady:this.sender.summary().ready,captchaRequired:true,country:'CN',dialCode:'+86',codeLength:6,validitySeconds:PHONE_CODE_TTL/1000,cooldownSeconds:PHONE_COOLDOWN/1000};
  }
  receipt(row:PhoneVerificationRequest){
    const state:Record<string,string>={QUEUED:'preparing',SENDING:'preparing',SUBMITTED:'submitted',UNKNOWN:'unknown',FAILED:'failed',CLOSED:'closed',USED:'used'};
    return{requestKey:row.id,purpose:row.purpose,status:state[row.state],version:row.version,serverNow:new Date().toISOString(),...(row.phone?{phoneMasked:maskedPhone(row.phone),expiresAt:row.expiresAt!.toISOString(),cooldownUntil:row.cooldownUntil!.toISOString()}: {})};
  }
  private same(row:PhoneVerificationRequest,owner:string,purpose?:string){if(row.owner!==owner)throw missing();if(purpose&&row.purpose!==purpose)throw changed();}
  async read(key:string,actor?:AuthUser){const row=await this.prisma.phoneVerificationRequest.findUnique({where:{id:phoneKey(key)}});if(!row)throw missing();this.same(row,actor?.id||'guest');if(actor&&row.purpose!=='bind')throw missing();if(!actor&&row.purpose==='bind')throw missing();return this.receipt(row);}
  async request(key:string,input:unknown,meta:Meta={},actor?:AuthUser){
    const id=phoneKey(key),body=phoneSendInput(input,!!actor),owner=actor?.id||'guest',inputHash=this.digest('send',JSON.stringify([owner,body.purpose,body.phone]));
    if(body.expectedVersion!==0)throw changed();
    const prior=await this.prisma.phoneVerificationRequest.findUnique({where:{id}});
    if(prior){this.same(prior,owner,body.purpose);if(prior.state!=='CLOSED'&&prior.inputHash!==inputHash)throw changed();return this.receipt(prior);}
    if(!this.rateLimit.tryConsume('phone-send:'+(meta.ip||'unknown'),8))throw limited('短信申请过于频繁，请稍后再试');
    if(!this.sender.summary().ready)throw new BusinessException(ErrorCode.SMS_DELIVERY_UNAVAILABLE,'短信服务暂未开放，已有号码仍可使用密码登录。',503);
    const policy=await this.policy();if(body.purpose==='register'&&!policy.registrationEnabled)throw phoneBad('注册暂未开放，已有账户仍可登录。');
    if(!this.captcha.verify(body.captchaId,body.captchaCode))throw phoneBad('图形验证码错误或已过期，请刷新后再试');
    const now=new Date(),code=String(randomInt(0,1_000_000)).padStart(6,'0'),ipHash=this.digest('ip',meta.ip||'unknown');
    const row=await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "phone_verification_requests" SET "id"="id" WHERE "id"=${id}`;
      const existing=await tx.phoneVerificationRequest.findUnique({where:{id}});if(existing){this.same(existing,owner,body.purpose);if(existing.state!=='CLOSED'&&existing.inputHash!==inputHash)throw changed();return existing;}
      const session=actor?await phoneSession(tx,actor):null;
      const latest=await tx.phoneVerificationRequest.findFirst({where:{phone:body.phone,cooldownUntil:{gt:now}},orderBy:{createdAt:'desc'}});
      if(latest)throw limited('请等待一分钟后再申请短信');
      const since=new Date(now.getTime()-86400_000);
      const [perPhone,perIp,queued,dayTotal]=await Promise.all([tx.phoneVerificationRequest.count({where:{phone:body.phone,createdAt:{gt:since}}}),tx.phoneVerificationRequest.count({where:{ipHash,createdAt:{gt:since}}}),tx.phoneVerificationRequest.count({where:{state:'QUEUED'}}),tx.phoneVerificationRequest.count({where:{phone:{not:null},createdAt:{gt:since}}})]);
      const configured=await this.settings.get<number>('security.smsDailyLimit'),dayLimit=Number.isSafeInteger(configured)&&configured>0?configured:1000;
      if(perPhone>=10||perIp>=30||dayTotal>=dayLimit)throw limited('今天的短信申请次数已用完，请稍后再试');
      if(queued>=25)throw new BusinessException(ErrorCode.SMS_DELIVERY_UNAVAILABLE,'短信申请较多，请稍后再试',503);
      const identity=await tx.userPhoneIdentity.findUnique({where:{phone:body.phone}});
      const target=body.purpose==='recover'&&identity?await tx.user.findFirst({where:{id:identity.userId,status:'ACTIVE',deletedAt:null}}):session?.user;
      if(actor&&identity?.userId===actor.id)throw phoneBad('这个号码已经绑定当前账户');
      const eligible=body.purpose==='recover'?!!target:!identity;
      await tx.phoneVerificationRequest.updateMany({where:{phone:body.phone,purpose:body.purpose,state:{in:liveStates}},data:{state:'CLOSED',codeHash:null,codeEnc:null,version:{increment:1}}});
      return tx.phoneVerificationRequest.create({data:{id,owner,purpose:body.purpose,phone:body.phone,inputHash,codeHash:this.codeHash({id,phone:body.phone,purpose:body.purpose},code),codeEnc:eligible?this.box.encrypt(code):null,ipHash,eligible,targetUserId:target?.id,tokenVersion:target?.tokenVersion,familyId:session?.context.familyId,accessExpiresAt:session?.context.expiresAt?new Date(session.context.expiresAt):null,expiresAt:new Date(now.getTime()+PHONE_CODE_TTL),cooldownUntil:new Date(now.getTime()+PHONE_COOLDOWN),createdAt:now}});
    });
    this.kick();return this.receipt(row);
  }
  async close(key:string,input:unknown,meta:Meta={},actor?:AuthUser){
    const id=phoneKey(key),body=phoneCloseInput(input,!!actor),owner=actor?.id||'guest';
    if(!this.rateLimit.tryConsume('phone-close:'+owner+':'+(meta.ip||'unknown'),30))throw limited('操作过于频繁，请稍后再试');
    const row=await this.prisma.$transaction(async tx=>{
      if(actor)await phoneSession(tx,actor);
      const row=await tx.phoneVerificationRequest.findUnique({where:{id}});
      if(!row){if(body.expectedVersion!==0)throw changed();return tx.phoneVerificationRequest.create({data:{id,owner,purpose:body.purpose,state:'CLOSED'}});}
      this.same(row,owner,body.purpose);if(['CLOSED','USED'].includes(row.state))return row;if(row.version!==body.expectedVersion)throw changed();
      return tx.phoneVerificationRequest.update({where:{id},data:{state:'CLOSED',codeHash:null,codeEnc:null,version:{increment:1}}});
    });return this.receipt(row);
  }
  /** The caller commits invalid guesses before raising its public error. */
  async claimTx(tx:Prisma.TransactionClient,phone:string,purpose:PhonePurpose,code:string,owner='guest',person?:{id:string;tokenVersion:number}){
    const now=new Date(),row=await tx.phoneVerificationRequest.findFirst({where:{phone,purpose,owner,eligible:true,state:{in:['SENDING','SUBMITTED','UNKNOWN']},attempts:{lt:5},expiresAt:{gt:now}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
    if(!row||!row.codeHash||person&&(row.targetUserId!==person.id||row.tokenVersion!==person.tokenVersion))return null;
    const expected=Buffer.from(this.codeHash({id:row.id,phone,purpose},code),'hex'),actual=Buffer.from(row.codeHash,'hex');
    if(expected.length===actual.length&&timingSafeEqual(expected,actual))return row;
    await tx.phoneVerificationRequest.updateMany({where:{id:row.id,version:row.version,attempts:{lt:5},state:{in:['SENDING','SUBMITTED','UNKNOWN']},expiresAt:{gt:new Date()}},data:{attempts:{increment:1},version:{increment:1}}});
    return null;
  }
  async consumeTx(tx:Prisma.TransactionClient,row:PhoneVerificationRequest){
    const result=await tx.phoneVerificationRequest.updateMany({where:{id:row.id,state:{in:['SENDING','SUBMITTED','UNKNOWN']},attempts:{lt:5},expiresAt:{gt:new Date()},codeHash:row.codeHash},data:{state:'USED',codeHash:null,codeEnc:null,version:{increment:1}}});if(result.count!==1)throw phoneBad();
  }
  kick(){if(this.closing)return;if(this.draining)return;this.draining=this.drain().catch(()=>this.logger.warn('短信队列暂未完成，将核对已留存的申请')).finally(()=>{this.draining=undefined;});}
  private async eligibleTx(tx:Prisma.TransactionClient,row:PhoneVerificationRequest){
    if(!row.eligible||!row.phone)return false;
    const identity=await tx.userPhoneIdentity.findUnique({where:{phone:row.phone}});
    if(row.purpose==='register')return!identity;
    if(row.purpose==='recover'){const user=row.targetUserId?await tx.user.findFirst({where:{id:row.targetUserId,tokenVersion:row.tokenVersion!,status:'ACTIVE',deletedAt:null}}):null;return!!user&&identity?.userId===user.id;}
    if(identity||!row.targetUserId||!row.familyId||row.accessExpiresAt&&row.accessExpiresAt.getTime()<=Date.now())return false;
    return!!await tx.user.findFirst({where:{id:row.targetUserId,tokenVersion:row.tokenVersion!,status:'ACTIVE',deletedAt:null}})&&!!await tx.refreshToken.findFirst({where:{userId:row.targetUserId,familyId:row.familyId,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}});
  }
  private async drain(){
    await this.prisma.phoneVerificationRequest.updateMany({where:{state:'SENDING',startedAt:{lt:new Date(Date.now()-30_000)}},data:{state:'UNKNOWN',codeEnc:null,version:{increment:1}}});
    while(!this.closing){
      const row=await this.prisma.$transaction(async tx=>{
        const candidate=await tx.phoneVerificationRequest.findFirst({where:{state:'QUEUED'},orderBy:[{createdAt:'asc'},{id:'asc'}]});if(!candidate)return null;
        const expired=!candidate.expiresAt||candidate.expiresAt.getTime()<=Date.now(),eligible=!expired&&await this.eligibleTx(tx,candidate);
        const accepted=await tx.phoneVerificationRequest.updateMany({where:{id:candidate.id,state:'QUEUED',version:candidate.version},data:{state:expired?'FAILED':'SENDING',startedAt:new Date(),eligible,version:{increment:1},...(expired?{codeEnc:null,codeHash:null}:{})}});
        return accepted.count===1?{...candidate,expired,eligible}:null;
      });
      if(!row)break;if(row.expired)continue;
      let result:PhoneSendResult={status:'SUBMITTED'};
      if(row.eligible){let code='';try{code=row.codeEnc?this.box.decrypt(row.codeEnc):'';}catch{}if(!code||!row.phone)result={status:'FAILED'};else{try{result=await this.sender.send(row.phone,code,row.id);}catch{result={status:'UNKNOWN'};}}}
      await this.prisma.phoneVerificationRequest.updateMany({where:{id:row.id,state:'SENDING'},data:{state:result.status,codeEnc:null,providerMessageId:result.messageId||null,version:{increment:1},...(result.status==='FAILED'?{codeHash:null}:{})}});
    }
  }
  onModuleInit(){this.timer=setInterval(()=>this.kick(),5000);this.timer.unref();this.kick();}
  async onModuleDestroy(){this.closing=true;if(this.timer)clearInterval(this.timer);await this.draining;}
}
