import {Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {LedgerService} from '../commerce/ledger.service';
import {ModerationService} from '../moderation/moderation.service';
import {AppActionDto,CreateOwnedAppDto,CreatorAppContentDto,ReviewOwnedAppDto,UpdateOwnedAppDto} from './dto/creator-app.dto';
import {publicAppWhere} from './app-visibility';

const bad=(message:string,status=400)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status),missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'没有找到这份应用',404);
const sha=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const REWARDS={model3:'apps.reviewReward.model3',model4:'apps.reviewReward.model4',drawMj:'apps.reviewReward.drawMj',agent:'apps.reviewReward.agent'} as const;
const OWNER_SELECT={id:true,username:true,displayName:true,role:true,status:true,deletedAt:true} as const;
const icons=['🪐','🎨','🧠','📝','🧭','💻'];
const parse=<T>(text:string|null|undefined,fallback:T):T=>{try{return JSON.parse(text||'') as T;}catch{return fallback;}};
const editable=(row:any)=>!row.deletedAt&&!row.published&&['DRAFT','REJECTED'].includes(row.reviewStatus);
const content=(row:any)=>({name:row.name,description:row.description||'',icon:row.icon,systemPrompt:row.systemPrompt,defaultModel:row.defaultModel||null,greeting:row.greeting||'',categoryId:row.categoryId||null});

@Injectable()
export class AppCreatorService {
 constructor(private readonly prisma:PrismaService,private readonly ledger:LedgerService,private readonly moderation:ModerationService,private readonly rateLimit:RateLimitService){}
 private rate(userId:string){if(!this.rateLimit.tryConsume('app-creator:'+userId,30))throw new BusinessException(ErrorCode.RATE_LIMITED,'操作太快了，请稍后再试',429);}
 private async actorTx(tx:Prisma.TransactionClient,userId:string,admin=false){
  await tx.$executeRaw`UPDATE "users" SET "id" = "id" WHERE "id" = ${userId}`;
  const actor=await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:OWNER_SELECT});
  if(!actor||admin&&!['ADMIN','SUPER'].includes(actor.role))throw new BusinessException(ErrorCode.FORBIDDEN,'当前身份不能执行这一步',403);return actor;
 }
 private normalize(dto:CreatorAppContentDto){return {name:dto.name.trim(),description:dto.description.trim(),icon:dto.icon,systemPrompt:dto.systemPrompt,defaultModel:dto.defaultModel?.trim()||null,greeting:dto.greeting.trim(),categoryId:dto.categoryId||null};}
 private async validate(value:ReturnType<AppCreatorService['normalize']>,tx:Prisma.TransactionClient){
  if(!value.name||!value.systemPrompt.trim()||!icons.includes(value.icon))throw bad('请填写名字、角色设定并选择应用形象');
  if(value.categoryId&&!await tx.appCategory.findUnique({where:{id:value.categoryId}}))throw bad('这个分类已变化，请重新选择');
  if(value.defaultModel){const model=await tx.aiModel.findFirst({where:{name:value.defaultModel,status:'ENABLED',deletedAt:null}});if(!model)throw bad('默认模型已变化，请重新选择');const caps=model.capabilities.split(',').map(v=>v.trim());if(!caps.some(v=>['chat','vision','reasoning','tools'].includes(v)))throw bad('请选择可以对话的模型');}
  const hit=await this.moderation.checkTx(tx,[value.name,value.description,value.systemPrompt,value.greeting].join('\n'));
  if(hit)throw new BusinessException(hit.action==='block'?ErrorCode.CONTENT_BLOCKED:ErrorCode.CONTENT_REVIEW,hit.action==='block'?'这份设定包含暂不能使用的内容，请调整后保存':'这份设定需要先由站点处理内容限制，请调整或联系管理员',400);
  return value;
 }
 private events(row:any,actor:any,action:string,note=''){const events=parse<any[]>(row?.eventsJson,[]);return JSON.stringify([...events.slice(-39),{version:(row?.version||0)+1,at:new Date().toISOString(),action,actorId:actor.id,actorRole:actor.role,note}]);}
 private view(row:any,full=true){
  const stored=parse<unknown>(row.eventsJson,[]),events=Array.isArray(stored)?stored.filter(event=>event&&typeof event==='object'):[];
  return{id:row.id,name:row.name,description:row.description,icon:row.icon,categoryId:row.categoryId,defaultModel:row.defaultModel,greeting:row.greeting,published:row.published,reviewStatus:row.reviewStatus,version:row.version,reviewNote:row.reviewNote,reviewedAt:row.reviewedAt,shareId:row.shareId,createdAt:row.createdAt,updatedAt:row.updatedAt,deletedAt:row.deletedAt,rewardGrantedAt:row.rewardGrantedAt,reward:parse(row.rewardJson,{}),...(full?{systemPrompt:row.systemPrompt,lastActionKey:row.lastActionKey,lastAction:events.at(-1)?.action||null,events:events.map(event=>({version:event.version,at:event.at,action:event.action,actorRole:event.actorRole,note:event.note}))}:{})};
 }
 async listMine(userId:string,view:unknown){if(view!==undefined&&(typeof view!=='string'||!['active','trash'].includes(view)))throw bad('请选择我的创建或回收站');const where={ownerId:userId,origin:'USER'},[items,active,trash]=await Promise.all([this.prisma.app.findMany({where:{...where,deletedAt:view==='trash'?{not:null}:null},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:100}),this.prisma.app.count({where:{...where,deletedAt:null}}),this.prisma.app.count({where:{...where,deletedAt:{not:null}}})]);return{items:items.map(row=>this.view(row,false)),counts:{active,trash},limit:20};}
 async mine(userId:string,id:string){const row=await this.prisma.app.findFirst({where:{id,ownerId:userId,origin:'USER'}});if(!row)throw missing();return this.view(row);}
 async byRequest(userId:string,key:string){if(!/^[a-f\d-]{36}$/i.test(key))throw bad('保存标识不正确');const row=await this.prisma.app.findFirst({where:{ownerId:userId,origin:'USER',createRequestKey:key}});if(!row)throw missing();return this.view(row);}
 async create(userId:string,dto:CreateOwnedAppDto){
  this.rate(userId);const value=this.normalize(dto),signature=sha(value);
  return this.prisma.$transaction(async tx=>{
   const actor=await this.actorTx(tx,userId),previous=await tx.app.findUnique({where:{ownerId_createRequestKey:{ownerId:userId,createRequestKey:dto.requestKey}}});
   if(previous){if(previous.createSignature!==signature)throw bad('同一保存标识不能用于不同内容，请先核对原记录',409);return this.view(previous);}
   await this.validate(value,tx);
   const [active,total]=await Promise.all([tx.app.count({where:{ownerId:userId,origin:'USER',deletedAt:null}}),tx.app.count({where:{ownerId:userId,origin:'USER'}})]);
   if(active>=20||total>=100)throw bad(active>=20?'最多同时保留 20 位自建搭档，请先整理已有应用':'最多保留 100 份应用记录，请联系管理员整理',409);
   const row=await tx.app.create({data:{...value,ownerId:userId,createdBy:userId,origin:'USER',published:false,reviewStatus:'DRAFT',shareId:randomUUID(),createRequestKey:dto.requestKey,createSignature:signature,lastActionKey:dto.requestKey,lastActionSignature:sha({action:'CREATE',actor:userId,signature}),eventsJson:this.events(null,actor,'CREATE')}});return this.view(row);
  });
 }
 async update(userId:string,id:string,dto:UpdateOwnedAppDto){const value=this.normalize(dto);return this.mutate(userId,id,dto,'UPDATE',value);}
 async action(userId:string,id:string,dto:AppActionDto,kind:'submit'|'withdraw'|'trash'|'restore'){return this.mutate(userId,id,dto,kind.toUpperCase());}
 private async mutate(userId:string,id:string,dto:AppActionDto,kind:string,value?:ReturnType<AppCreatorService['normalize']>){
  this.rate(userId);const signature=sha({actor:userId,kind,version:dto.version,value:value||null});
  return this.prisma.$transaction(async tx=>{
   const actor=await this.actorTx(tx,userId),row=await tx.app.findFirst({where:{id,ownerId:userId,origin:'USER'}});if(!row)throw missing();
   if(row.lastActionKey===dto.requestKey){if(row.lastActionSignature!==signature)throw bad('同一操作标识不能用于不同内容',409);return this.view(row);}
   if(row.version!==dto.version)throw bad('这份应用已变化，请先读取最新记录',409);
   const data:Prisma.AppUncheckedUpdateManyInput={version:{increment:1},lastActionKey:dto.requestKey,lastActionSignature:signature,eventsJson:this.events(row,actor,kind)};
   if(kind==='RESTORE'){if(!row.deletedAt)throw bad('这份应用不在回收站',409);if(await tx.app.count({where:{ownerId:userId,origin:'USER',deletedAt:null}})>=20)throw bad('正在使用的搭档已满，请先整理',409);Object.assign(data,{deletedAt:null,published:false,reviewStatus:'DRAFT'});}
   else{if(row.deletedAt)throw bad('这份应用已在回收站，请先恢复',409);
    if(kind==='UPDATE'){if(!editable(row))throw bad('请先撤回审核或公开，再修改内容',409);await this.validate(value!,tx);Object.assign(data,value,{reviewStatus:'DRAFT',published:false});}
    else if(kind==='SUBMIT'){if(!editable(row))throw bad('当前状态不能再次提交审核',409);await this.validate(content(row),tx);Object.assign(data,{reviewStatus:'PENDING',published:false,reviewNote:null});}
    else if(kind==='WITHDRAW'){if(!['PENDING','APPROVED'].includes(row.reviewStatus))throw bad('这份应用当前没有等待审核或公开',409);Object.assign(data,{reviewStatus:'DRAFT',published:false});}
    else if(kind==='TRASH'){if(!editable(row))throw bad('请先撤回审核或公开，再放入回收站',409);Object.assign(data,{deletedAt:new Date(),published:false,reviewStatus:'DRAFT'});}
    else throw bad('不支持的应用操作');
   }
   const accepted=await tx.app.updateMany({where:{id,ownerId:userId,version:dto.version},data});if(accepted.count!==1)throw bad('这份应用已变化，请刷新后核对',409);return this.view(await tx.app.findUniqueOrThrow({where:{id}}));
  });
 }
 async reconcile(actorId:string,id:string,dto:AppActionDto,admin=false){
  this.rate(actorId);
  return this.prisma.$transaction(async tx=>{
   const actor=await this.actorTx(tx,actorId,admin);
   let row=await tx.app.findFirst({where:{id,origin:'USER',...(admin?{deletedAt:null,reviewStatus:{in:['PENDING','APPROVED','REJECTED']}}:{ownerId:actorId})}});
   if(!row)throw missing();
   const signature=sha({actor:actorId,kind:'RECONCILE',version:dto.version});
   let resolution:'applied'|'changed'|'not-applied';
   if(row.lastActionKey===dto.requestKey)resolution=row.lastActionSignature===signature?'not-applied':'applied';
   else if(row.version>dto.version)resolution='changed';
   else{
    if(row.version!==dto.version)throw bad('操作版本不正确，请重新读取当前状态',409);
    const accepted=await tx.app.updateMany({where:{id,version:dto.version,origin:'USER'},data:{version:{increment:1},lastActionKey:dto.requestKey,lastActionSignature:signature,eventsJson:this.events(row,actor,'RECONCILE','结束尚未完成的操作')}});
    if(accepted.count!==1)throw bad('应用状态已变化，请刷新后核对',409);
    row=await tx.app.findUniqueOrThrow({where:{id}});resolution='not-applied';
   }
   return{app:admin?await this.adminView(tx,row):this.view(row),resolution};
  });
 }
 private page(raw:unknown,fallback:number,max:number){if(raw===undefined)return fallback;if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1||Number(raw)>max)throw bad('分页条件不正确');return Number(raw);}
 async reviews(status:unknown,page:unknown,pageSize:unknown){const state=status===undefined?'PENDING':status;if(typeof state!=='string'||!['PENDING','APPROVED','REJECTED'].includes(state))throw bad('审核状态不正确');const p=this.page(page,1,100000),size=this.page(pageSize,15,50),where={origin:'USER',reviewStatus:state,deletedAt:null},[rows,total]=await Promise.all([this.prisma.app.findMany({where,include:{owner:{select:OWNER_SELECT}},orderBy:[{updatedAt:'asc'},{id:'asc'}],skip:(p-1)*size,take:size}),this.prisma.app.count({where})]);return{items:rows.map(row=>({...this.view(row,false),owner:row.owner?{id:row.owner.id,username:row.owner.username,displayName:row.owner.displayName}:null})),total,page:p,pageSize:size};}
 private async offer(tx:Prisma.TransactionClient,row:any){
  const owner=row.owner||await tx.user.findUnique({where:{id:row.ownerId||''},select:OWNER_SELECT}),values=await tx.globalConfig.findMany({where:{key:{in:Object.values(REWARDS)}}}),counts:Record<string,number>={};
  for(const [pool,key]of Object.entries(REWARDS)){const value=parse<unknown>(values.find(v=>v.key===key)?.value,0);counts[pool]=!row.rewardGrantedAt&&owner?.role==='USER'&&typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=10000?value:0;}
  return{counts,alreadyGranted:!!row.rewardGrantedAt,revision:sha({id:row.id,version:row.version,content:content(row),counts,alreadyGranted:!!row.rewardGrantedAt,ownerRole:owner?.role,ownerStatus:owner?.status,ownerDeleted:owner?.deletedAt||null})};
 }
 private async adminView(tx:Prisma.TransactionClient,row:any){const owner=row.owner||await tx.user.findUnique({where:{id:row.ownerId||''},select:OWNER_SELECT});return{...this.view(row),owner:owner?{id:owner.id,username:owner.username,displayName:owner.displayName}:null,rewardOffer:await this.offer(tx,{...row,owner})};}
 async reviewDetail(id:string){const row=await this.prisma.app.findFirst({where:{id,origin:'USER',deletedAt:null,reviewStatus:{in:['PENDING','APPROVED','REJECTED']}},include:{owner:{select:OWNER_SELECT}}});if(!row)throw missing();return this.adminView(this.prisma,row);}
 async review(actorId:string,id:string,dto:ReviewOwnedAppDto){
  this.rate(actorId);const signature=sha({actor:actorId,kind:'REVIEW',version:dto.version,decision:dto.decision,note:dto.note.trim(),offer:dto.offerRevision||null});
  return this.prisma.$transaction(async tx=>{
   const actor=await this.actorTx(tx,actorId,true),row=await tx.app.findFirst({where:{id,origin:'USER',deletedAt:null},include:{owner:{select:OWNER_SELECT}}});if(!row)throw missing();
   if(row.lastActionKey===dto.requestKey){if(row.lastActionSignature!==signature)throw bad('同一审核标识不能用于不同决定',409);return this.adminView(tx,row);}
   if(row.version!==dto.version)throw bad('应用状态已变化，请重新核对',409);
   const data:Prisma.AppUncheckedUpdateManyInput={version:{increment:1},lastActionKey:dto.requestKey,lastActionSignature:signature,reviewedAt:new Date(),reviewNote:dto.note.trim(),eventsJson:this.events(row,actor,dto.decision,dto.note.trim())};
   let gift:Record<string,number>|null=null;
   if(dto.decision==='APPROVE'){
    if(!row.owner||row.owner.status!=='ACTIVE'||row.owner.deletedAt)throw bad('创作者当前不可用，不能发布或赠送次数',409);

    if(row.reviewStatus!=='PENDING')throw bad('这份应用当前不在待审核状态',409);const offer=await this.offer(tx,row);if(dto.offerRevision!==offer.revision)throw bad('角色内容或奖励设置已变化，请刷新并核对',409);
    await this.validate(content(row),tx);
    Object.assign(data,{published:true,reviewStatus:'APPROVED'});if(!row.rewardGrantedAt){gift=offer.counts;Object.assign(data,{rewardGrantedAt:new Date(),rewardJson:JSON.stringify(gift)});}
   }else{if(!dto.note.trim())throw bad('请填写具体反馈');if(dto.decision==='REJECT'&&row.reviewStatus!=='PENDING'||dto.decision==='UNPUBLISH'&&row.reviewStatus!=='APPROVED')throw bad('当前状态与审核动作不一致，请刷新',409);Object.assign(data,{published:false,reviewStatus:'REJECTED'});}
   const accepted=await tx.app.updateMany({where:{id,version:dto.version,origin:'USER',deletedAt:null},data});if(accepted.count!==1)throw bad('这份应用已被处理，请刷新核对',409);
   if(gift&&Object.values(gift).some(v=>v>0)){await this.ledger.ensureTx(tx,row.ownerId!);await this.ledger.grantTx(tx,row.ownerId!,{model3Count:gift.model3,model4Count:gift.model4,drawMjCount:gift.drawMj,agentCount:gift.agent,rechargeType:'gift',pkgName:'应用创作者奖励',extent:'app-review:'+row.id,remark:'作品奖励 · '+row.name});}
   return this.adminView(tx,await tx.app.findUniqueOrThrow({where:{id}}));
  });
 }
 async shared(userId:string|undefined,shareId:string){if(shareId.length>128)throw missing();const row=await this.prisma.app.findFirst({where:{AND:[publicAppWhere(),{OR:[{shareId},{id:shareId}]}]},select:{id:true}});if(!row)throw missing();return{id:row.id};}
}
