import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {MindmapGeneration,Prisma} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {BreakerRegistry} from '../../common/llm/breaker';
import {classifyFailure} from '../../common/llm/classify';
import {buildChatRequest,UpstreamError} from '../../common/llm/chat-protocol';
import {readChatResponse} from '../../common/llm/chat-stream';
import {estimateTokens} from '../../common/llm/context';
import {safeFetch} from '../../common/net/safe-fetch';
import {ModelsService} from '../models/models.service';
import {KeyPoolService,PoolKey} from '../models/key-pool.service';
import {LedgerService} from '../commerce/ledger.service';
import {ModerationService} from '../moderation/moderation.service';
import {MindmapGenerationDto,MindmapGenerationQuoteDto,MindmapPageDto} from './mindmap.dto';
import {MindmapAccountingService} from './mindmap-accounting.service';
import {mindmapPlan,mindmapPrompt,MINDMAP_PROTOCOLS} from './mindmap-generation-plan';
import {mindmapGeneratedOutline} from './mindmap-outline';
import {assertMindmapReplay,lockMindmapOperation,mindmapConflict,mindmapHash,mindmapId,mindmapMissing} from './mindmap-operation';

const ACTIVE=['QUEUED','RUNNING','SETTLING'];
const unavailable=()=>new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE,'当前模型暂时不可用，请稍后再试。',400);

@Injectable()
export class MindmapGenerationsService implements OnModuleInit,OnModuleDestroy {
 private readonly logger=new Logger(MindmapGenerationsService.name);
 private readonly active=new Map<string,{controller:AbortController;promise:Promise<void>}>();
 private timer?:ReturnType<typeof setInterval>;
 private stopping=false;
 private sweeping=false;
 constructor(private readonly prisma:PrismaService,private readonly models:ModelsService,private readonly keys:KeyPoolService,private readonly breaker:BreakerRegistry,private readonly ledger:LedgerService,private readonly accounting:MindmapAccountingService,private readonly moderation:ModerationService,private readonly rate:RateLimitService){}

 async onModuleInit(){await this.recover(true);this.timer=setInterval(()=>{void this.recover(false).catch(()=>this.logger.warn('导图任务恢复暂未完成'));},30000);this.timer.unref();}
 async onModuleDestroy(){this.stopping=true;if(this.timer)clearInterval(this.timer);for(const job of this.active.values())job.controller.abort();await Promise.allSettled([...this.active.values()].map(job=>job.promise));}

 async options(){
  const rows=await this.prisma.aiModel.findMany({where:{status:'ENABLED',deletedAt:null},orderBy:[{sort:'asc'},{name:'asc'}],include:{channels:{where:{enabled:true},include:{channel:{select:{status:true,deletedAt:true,type:true}}}}}});
  return{models:rows.filter(row=>row.capabilities.split(',').map(x=>x.trim()).includes('chat')).map(row=>({id:row.id,name:row.displayName||row.name,ready:row.channels.some(binding=>binding.channel.status==='ENABLED'&&!binding.channel.deletedAt&&MINDMAP_PROTOCOLS.has(binding.channel.type))})).sort((a,b)=>Number(b.ready)-Number(a.ready))};
 }

 async quote(userId:string,dto:MindmapGenerationQuoteDto){
  if(!this.rate.tryConsume('mindmap-quote:'+userId,30))throw new BusinessException(ErrorCode.RATE_LIMITED,'操作有些频繁，请稍后再试。',429);
  return this.prisma.$transaction(async tx=>{await this.assertOwner(tx,userId);const plan=await mindmapPlan(tx,dto);await this.checkContent(tx,plan.prompt+'\n'+plan.context);return{revision:plan.revision,cost:plan.charge?.amount||0,pool:plan.charge?.pool||null,modelName:plan.model.displayName||plan.model.name};});
 }

 async create(userId:string,dto:MindmapGenerationDto){
  const input=mindmapPrompt(dto),hash=mindmapHash({modelId:dto.modelId,...input,quoteRevision:dto.quoteRevision});let acceptedId:string|null=null;
  const result=await this.prisma.$transaction(async tx=>{
   const locked=await lockMindmapOperation(tx,userId,dto.requestKey,'generation',hash);
   if(!locked.inserted){assertMindmapReplay(locked.row,'generation',hash);if(locked.row.state==='ENDED')throw mindmapConflict('这次生成已结束确认，请重新点击生成。');const row=await tx.mindmapGeneration.findFirst({where:{id:locked.row.generationId!,userId}});if(!row)throw mindmapMissing();return this.present(row);}
   await this.assertOwner(tx,userId);if(this.stopping)throw unavailable();
   if(!this.rate.tryConsume('mindmap-create:'+userId,12))throw new BusinessException(ErrorCode.RATE_LIMITED,'生成操作有些频繁，请稍后再试。',429);
   if(await tx.mindmapGeneration.count({where:{userId,status:{in:ACTIVE}}}))throw mindmapConflict('还有一份思路正在整理，请等待完成，或先停止它。');
   const plan=await mindmapPlan(tx,dto);if(plan.revision!==dto.quoteRevision)throw mindmapConflict('模型或费用设置已更新，请重新确认本次生成。');
   await this.checkContent(tx,plan.prompt+'\n'+plan.context);
   const candidate=plan.channels.find(row=>this.breaker.isAvailable(row.channelId));if(!candidate)throw unavailable();
   const row=await tx.mindmapGeneration.create({data:{userId,requestKey:dto.requestKey,modelId:plan.model.id,modelName:plan.model.name,modelDisplayName:plan.model.displayName,channelId:candidate.channelId,routeRevision:plan.revision,prompt:plan.prompt,context:plan.context,title:plan.prompt.slice(0,100),maxOutput:plan.maxOutput,priceInPerM:plan.model.priceInPerM,priceOutPerM:plan.model.priceOutPerM,pool:plan.charge?.pool||'model3',reservedAmount:plan.charge?.amount||0,billingState:plan.charge?'RESERVED':'FREE'}});
   if(plan.charge)await this.ledger.reserveCountTx(tx,userId,{...plan.charge,refId:row.id,bizType:'mindmap',model:row.modelName,modelName:row.modelDisplayName||row.modelName});
   await tx.mindmapOperation.update({where:{id:locked.row.id},data:{generationId:row.id}});acceptedId=row.id;return this.present(row);
  });
  if(acceptedId)this.launch(acceptedId);return result;
 }

 private launch(id:string){
  if(this.active.has(id)||this.stopping)return;
  const controller=new AbortController();
  const promise=Promise.resolve().then(()=>this.run(id,controller)).catch(()=>this.logger.warn('导图任务等待恢复：'+id)).finally(()=>this.active.delete(id));
  this.active.set(id,{controller,promise});
 }

 private async run(id:string,controller:AbortController){
  const signal=controller.signal;let acquired=false,channelId='',key:PoolKey|null=null,timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},180000);timeout.unref();
  try{
   const claimed=await this.prisma.mindmapGeneration.updateMany({where:{id,status:'QUEUED'},data:{status:'RUNNING',startedAt:new Date()}});if(!claimed.count)return;
   const row=await this.prisma.mindmapGeneration.findUniqueOrThrow({where:{id}});channelId=row.channelId;
   const plan=await this.prisma.$transaction(async tx=>{await this.assertOwner(tx,row.userId);const next=await mindmapPlan(tx,{modelId:row.modelId,prompt:row.prompt,context:row.context});if(next.revision!==row.routeRevision)throw mindmapConflict();await this.checkContent(tx,row.prompt+'\n'+row.context);return next;});
   const route=await this.models.resolveRoute(row.modelName),channel=route.channels.find(candidate=>candidate.id===channelId&&MINDMAP_PROTOCOLS.has(candidate.type));if(!channel)throw unavailable();
   key=await this.keys.pick(channel);if(!key)throw unavailable();
   signal.throwIfAborted();
   // A cancellation accepted before this read cannot send a delayed provider request.
   const current=await this.prisma.mindmapGeneration.findUniqueOrThrow({where:{id}});if(current.status!=='RUNNING')return;
   if(!this.breaker.tryAcquire(channel.id))throw unavailable();acquired=true;
   const request=buildChatRequest({...channel,apiKey:key.apiKey},plan.messages,{maxTokens:row.maxOutput,temperature:0.7});
   const response=await safeFetch(request.url,request.init,{signal,timeoutMs:Math.min(channel.timeoutMs||60000,180000),allowHttp:plan.allowHttp,hostAllowlist:plan.hostAllowlist});
   let size=0;const result=await readChatResponse(response,request.type,(_event,value)=>{size+=value.length;if(size>100000)throw new UpstreamError(502,'outline response too large');},signal,channel.timeoutMs);
   if(result.finishReason!=='stop')throw new UpstreamError(502,'outline incomplete');
   const parsed=mindmapGeneratedOutline(result.text);await this.prisma.$transaction(tx=>this.checkContent(tx,parsed.outline));
   signal.throwIfAborted();
   const promptTokens=result.usage?.promptTokens??plan.inputTokens,completionTokens=result.usage?.completionTokens??estimateTokens(result.text+result.reasoning),costMicros=Math.ceil((promptTokens*row.priceInPerM+completionTokens*row.priceOutPerM)/1000000);
   if(!Number.isSafeInteger(costMicros)||costMicros<0||costMicros>2147483647)throw new UpstreamError(502,'invalid usage');
   const staged=await this.accounting.stage(id,{outline:parsed.outline,title:parsed.title,promptTokens,completionTokens,costMicros,estimated:!result.usage});
   this.breaker.recordSuccess(channelId);acquired=false;this.keys.reportSuccess(key);
   if(staged)await this.accounting.complete(id);
  }catch(error){
   const status=error instanceof UpstreamError?error.status:null,classification=classifyFailure(status,timedOut?'timeout':signal.aborted?'abort':error instanceof UpstreamError?'http':'network');
   if(acquired){if(classification.tripBreaker)this.breaker.recordFailure(channelId,classification.errorCode,classification.cooldownMs);else this.breaker.coolDown(channelId,classification.cooldownMs||1000);}
   if(key&&!signal.aborted&&error instanceof UpstreamError)await this.keys.reportFailure(channelId,key,classification.errorCode,classification.cooldownMs);
   const code=timedOut?'timeout':signal.aborted?'interrupted':error instanceof BusinessException?'configuration_changed':classification.errorCode;
   const message=timedOut?'这次整理等待过久，预留次数已释放。':signal.aborted?'这次整理已中止，预留次数已释放。':error instanceof BusinessException?'设置或内容要求发生变化，本次未完成，预留次数已释放。':'这次没有收到完整可用的大纲，预留次数已释放，请调整描述后再试。';
   await this.accounting.stop(id,'FAILED',code,message);
  }finally{clearTimeout(timeout);}
 }

 async get(userId:string,id:string){const row=await this.prisma.mindmapGeneration.findFirst({where:{userId,id:mindmapId(id)}});if(!row)throw mindmapMissing();return this.present(row);}
 async byRequest(userId:string,requestKey:string){const row=await this.prisma.mindmapGeneration.findUnique({where:{userId_requestKey:{userId,requestKey:mindmapId(requestKey)}}});if(!row)throw mindmapMissing();return this.present(row);}
 async list(userId:string,{page=1,pageSize=5}:MindmapPageDto){return this.prisma.$transaction(async tx=>{const where={userId},total=await tx.mindmapGeneration.count({where}),rows=await tx.mindmapGeneration.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize});return{items:rows.map(row=>this.present(row)),page,pageSize,total};});}
 async end(userId:string,requestKey:string){return this.prisma.$transaction(async tx=>{const{row}=await lockMindmapOperation(tx,userId,requestKey,'generation','','ENDED');if(row.kind!=='generation')throw mindmapConflict();const task=row.generationId?await tx.mindmapGeneration.findFirst({where:{id:row.generationId,userId}}):null;return{state:row.state,requestKey,task:task?this.present(task):null};});}
 async cancel(userId:string,id:string){await this.get(userId,id);const changed=await this.accounting.stop(id,'CANCELED','user_canceled','已停止这次整理，未使用的预留次数已释放。');if(changed)this.active.get(id)?.controller.abort();return this.get(userId,id);}

 async recover(startup=false){
  if(this.sweeping||this.stopping)return;this.sweeping=true;
  try{const rows=await this.prisma.mindmapGeneration.findMany({where:{status:{in:ACTIVE}},orderBy:{createdAt:'asc'}});for(const row of rows){if(this.active.has(row.id))continue;try{if(row.status==='SETTLING')await this.accounting.complete(row.id);else if(startup||row.updatedAt.getTime()<Date.now()-240000)await this.accounting.stop(row.id,'FAILED','interrupted','服务已恢复，上次未完成的整理已结束，预留次数已释放。');}catch{this.logger.warn('导图任务结算等待恢复：'+row.id);}}}finally{this.sweeping=false;}
 }

 private async assertOwner(tx:Prisma.TransactionClient,userId:string){if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前账号无法继续这次操作。',403);}
 private async checkContent(tx:Prisma.TransactionClient,text:string){const hit=await this.moderation.checkTx(tx,text);if(hit)throw new BusinessException(hit.action==='block'?ErrorCode.CONTENT_BLOCKED:ErrorCode.CONTENT_REVIEW,'这些内容暂时无法整理，请调整描述后再试。',400);}
 private present(row:MindmapGeneration){
  let message=row.errorMessage||(row.status==='COMPLETED'?'思路已经整理好，确认后可带入当前大纲。':row.status==='SETTLING'?'大纲已保存，正在核对本次用量。':'正在为这些线索整理新的思路。');
  if(row.expiredAmount)message+=`其中 ${row.expiredAmount} 次会员预留额度已到期，不会转入新的额度。`;
  return{id:row.id,requestKey:row.requestKey,title:row.title,modelName:row.modelDisplayName||row.modelName,status:row.status,outline:row.status==='COMPLETED'?row.outline:'',message,createdAt:row.createdAt,finishedAt:row.finishedAt,billing:{pool:row.pool,reserved:row.reservedAmount,charged:row.chargedAmount,returned:row.returnedAmount,expired:row.expiredAmount,state:row.billingState}};
 }
}
