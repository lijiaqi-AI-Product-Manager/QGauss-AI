import {Injectable} from '@nestjs/common';
import {Prisma,GlobalConfig,SettingsOperation} from '@prisma/client';
import {createHash} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {SecretBox} from '../../common/crypto/secret-box';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {AuthUser,authSession} from '../../common/decorators/current-user.decorator';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {CONFIG_MAP,CONFIG_REGISTRY,ConfigDef,ConfigValue,coerceConfigValue} from '../../common/config/config.registry';
import {SettingsService} from './settings.service';

const bad=(message='本次调整的内容不正确，请重新核对。',status=422)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status),missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'暂未找到这次保存结果。',404),changed=()=>bad('这次保存申请已有变化，请核对原结果。',409),hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const object=(value:unknown,allowed:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw bad();return value as Record<string,unknown>;};
const operationKey=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))throw bad();return value;};
const version=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<0)throw bad();return Number(value);};
type Change={key:string;value:ConfigValue;expectedRevision:string};
const lengths:Record<string,number>={'site.name':120,'security.registerInviteCode':64,'site.baseUrl':2048,'commerce.payNotifyBaseUrl':2048,'chat.defaultModel':128,'image.model':128,'image.defaultChannel':128,'commerce.currency':16};
const maxLength=(key:string)=>lengths[key]??20000;
const sensitive=(key:string)=>key==='security.registerInviteCode';
const integer=(def:ConfigDef)=>def.type==='number'&&def.key!=='upload.maxSizeMb';
function input(value:unknown){const body=object(value,['expectedVersion','changes']);if(version(body.expectedVersion)!==0||!Array.isArray(body.changes)||body.changes.length<1||body.changes.length>128||Buffer.byteLength(JSON.stringify(body))>131072)throw bad();const seen=new Set<string>();return body.changes.map(raw=>{const row=object(raw,['key','value','expectedRevision']);if(typeof row.key!=='string'||!CONFIG_MAP.has(row.key)||seen.has(row.key)||typeof row.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(row.expectedRevision))throw bad();const def=CONFIG_MAP.get(row.key)!;if(typeof row.value!==def.type||def.type==='number'&&(!Number.isFinite(Number(row.value))||Math.abs(Number(row.value))>Number.MAX_SAFE_INTEGER||integer(def)&&!Number.isSafeInteger(row.value))||def.type==='string'&&String(row.value).length>maxLength(row.key))throw bad();seen.add(row.key);return{key:row.key,value:row.value as ConfigValue,expectedRevision:row.expectedRevision};}).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);}
@Injectable()
export class SettingsWorkspaceService{
 constructor(private readonly prisma:PrismaService,private readonly settings:SettingsService,private readonly box:SecretBox,private readonly rate:RateLimitService){}
 private limit(kind:string,actor:AuthUser,count:number){if(!this.rate.tryConsume('settings:'+kind+':'+actor.id,count,60000))throw new BusinessException(ErrorCode.RATE_LIMITED,'设置核对过于频繁，请稍后再试。',429);}
 private async actor(tx:Prisma.TransactionClient,actor:AuthUser){
  await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;const context=authSession(actor),now=new Date(),user=await tx.user.findFirst({where:{id:actor.id,status:'ACTIVE',deletedAt:null}});if(!context||!user||context.tokenVersion!==user.tokenVersion||context.expiresAt!==null&&context.expiresAt<=now.getTime()||!await tx.refreshToken.findFirst({where:{userId:user.id,familyId:context.familyId,revokedAt:null,expiresAt:{gt:now}},select:{id:true}}))throw new BusinessException(ErrorCode.UNAUTHORIZED,'当前登录已变化，请重新登录',401);if(actor.role!=='ADMIN'||user.role!=='ADMIN')throw new BusinessException(ErrorCode.FORBIDDEN,'当前账号没有管理权限。',403);return{user,context};
 }
 private revision(def:ConfigDef,row?:GlobalConfig){return hash(JSON.stringify([def,row?.version??-1,row?.value??null,row?.updatedAt.toISOString()??null]));}
 private value(def:ConfigDef,row?:GlobalConfig){if(row)try{const value=coerceConfigValue(def,JSON.parse(row.value));if(value!==null)return value;}catch{}return def.default;}
 private receipt(row:SettingsOperation){let items:unknown[]=[];if(row.status==='APPLIED'){if(!row.payloadEnc)throw bad('保存结果尚未核对完整，请继续核对原申请。',503);try{items=JSON.parse(this.box.decrypt(row.payloadEnc));}catch{throw bad('保存结果尚未核对完整，请继续核对原申请。',503);}}return{id:row.id,ownerId:row.ownerId,status:row.status.toLowerCase(),version:row.version,serverNow:new Date().toISOString(),createdAt:row.createdAt.toISOString(),...(row.appliedAt?{appliedAt:row.appliedAt.toISOString()}:{}),...(row.closedAt?{closedAt:row.closedAt.toISOString()}:{}),reason:row.reason,items,conflicts:JSON.parse(row.conflicts)};}
 async snapshot(actor:AuthUser){this.limit('snapshot',actor,90);return this.prisma.$transaction(async tx=>{await this.actor(tx,actor);const rows=await tx.globalConfig.findMany({where:{key:{in:CONFIG_REGISTRY.map(def=>def.key)}}}),byKey=new Map(rows.map(row=>[row.key,row]));return{userId:actor.id,readAt:new Date().toISOString(),items:CONFIG_REGISTRY.map(def=>({key:def.key,value:this.value(def,byKey.get(def.key)),defaultValue:def.default,type:def.type,group:def.group,description:def.description,public:!!def.public,sensitive:sensitive(def.key),integer:integer(def),revision:this.revision(def,byKey.get(def.key)),...(def.min!==undefined?{min:def.min}:{}),...(def.max!==undefined?{max:def.max}:{}),...(def.type==='string'?{maxLength:maxLength(def.key)}:{})}))};});}
 async read(key:string,actor:AuthUser){const id=operationKey(key);this.limit('read',actor,180);return this.prisma.$transaction(async tx=>{await this.actor(tx,actor);const row=await tx.settingsOperation.findUnique({where:{id}});if(!row||row.ownerId!==actor.id)throw missing();return this.receipt(row);});}
 async apply(key:string,value:unknown,actor:AuthUser){
  const id=operationKey(key),changes=input(value),inputHash=hash(JSON.stringify(changes));this.limit('apply',actor,30);
  const result=await this.prisma.$transaction(async tx=>{
   const {context}=await this.actor(tx,actor),prior=await tx.settingsOperation.findUnique({where:{id}});if(prior){if(prior.ownerId!==actor.id)throw missing();if(prior.status==='CLOSED')return prior;if(prior.inputHash!==inputHash)throw changed();return prior;}
   const rows=await tx.globalConfig.findMany({where:{key:{in:changes.map(change=>change.key)}}}),byKey=new Map(rows.map(row=>[row.key,row])),conflicts=changes.filter(change=>this.revision(CONFIG_MAP.get(change.key)!,byKey.get(change.key))!==change.expectedRevision).map(change=>change.key),base={id,ownerId:actor.id,familyId:context.familyId,tokenVersion:context.tokenVersion,inputHash};
   if(conflicts.length)return tx.settingsOperation.create({data:{...base,status:'REJECTED',reason:'changed',conflicts:JSON.stringify(conflicts)}});
   let parsed:Change[];try{parsed=changes.map(change=>({...change,value:this.settings.validateChange(change.key,change.value)}));}catch(error){if(error instanceof BusinessException)return tx.settingsOperation.create({data:{...base,status:'REJECTED',reason:'invalid'}});throw error;}
   const items=parsed.map(change=>{const def=CONFIG_MAP.get(change.key)!,before=this.value(def,byKey.get(change.key)),after=change.value;return{key:change.key,description:def.description,public:!!def.public,sensitive:sensitive(change.key),...(sensitive(change.key)?{beforeConfigured:!!before,afterConfigured:!!after}:{before,after})};});
   for(const change of parsed)await tx.globalConfig.upsert({where:{key:change.key},create:{key:change.key,value:JSON.stringify(change.value),updatedBy:actor.id},update:{value:JSON.stringify(change.value),updatedBy:actor.id}});
   return tx.settingsOperation.create({data:{...base,status:'APPLIED',payloadEnc:this.box.encrypt(JSON.stringify(items)),appliedAt:new Date()}});
  });if(result.status==='APPLIED')this.settings.invalidateAll();return this.receipt(result);
 }
 async close(key:string,value:unknown,actor:AuthUser){const id=operationKey(key),expectedVersion=version(object(value,['expectedVersion']).expectedVersion);this.limit('close',actor,30);return this.prisma.$transaction(async tx=>{const{context}=await this.actor(tx,actor),prior=await tx.settingsOperation.findUnique({where:{id}});if(prior){if(prior.ownerId!==actor.id)throw missing();if(expectedVersion>prior.version)throw changed();return this.receipt(prior);}if(expectedVersion!==0)throw changed();return this.receipt(await tx.settingsOperation.create({data:{id,ownerId:actor.id,familyId:context.familyId,tokenVersion:context.tokenVersion,status:'CLOSED',closedAt:new Date()}}));});}
}
