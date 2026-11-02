import { Injectable } from '@nestjs/common';
import { Agent, AgentConnection, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { cozeEndpoint } from '../../common/llm/coze-protocol';
import { safeAgentActivity } from '../../common/llm/agent-activity';
import { UpstreamError } from '../../common/llm/chat-protocol';
import { SettingsService } from '../settings/settings.service';
import { chatBilling } from '../commerce/chat-pricing';
import { CozeClientService, validatedAgentSecret } from './coze-client.service';
import { AgentConnectionDto, AgentEditDto, AgentListDto } from './agent.dto';

export type ResolvedAgent = {agent:Agent;connection:AgentConnection;model:{id:null;name:string;maxContext:number;maxOutput:number;countPool:string;countCost:number;priceInPerM:number;priceOutPerM:number};offerRevision:string;commerceEnabled:boolean};
const clean=(v:unknown,n:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n):'';
const strings=(v:unknown,n:number,len:number)=>[...new Set((Array.isArray(v)?v:[]).map(x=>clean(x,len)).filter(Boolean))].slice(0,n);
const parsed=(v:string,fallback:any)=>{try{return JSON.parse(v);}catch{return fallback;}};
const missing=(message:string)=>new BusinessException(ErrorCode.NOT_FOUND,message,404);
const invalid=(message:string)=>new BusinessException(ErrorCode.PARAM_INVALID,message,400);

export function agentOffer(agent:Pick<Agent,'id'|'countCost'|'published'|'updatedAt'>,connection:Pick<AgentConnection,'id'|'version'>,commerce:boolean){
  return createHash('sha256').update(JSON.stringify([agent.id,agent.countCost,agent.published,agent.updatedAt.toISOString(),connection.id,connection.version,commerce])).digest('hex');
}
function metadata(raw:any){
  return {model:clean(raw?.model_info?.model_name,100),tools:(Array.isArray(raw?.plugin_info_list)?raw.plugin_info_list:[]).slice(0,20).map((x:any)=>({name:clean(x?.name,100),description:clean(x?.description,500)})).filter((x:any)=>x.name),workflows:(Array.isArray(raw?.workflow_info_list)?raw.workflow_info_list:[]).slice(0,20).map((x:any)=>({name:clean(x?.name,100),description:clean(x?.description,500)})).filter((x:any)=>x.name),knowledgeCount:Math.min(1000,Array.isArray(raw?.knowledge?.knowledge_infos)?raw.knowledge.knowledge_infos.length:0)};
}
function publicCapabilities(raw:any){return{model:clean(raw?.model,100),tools:(Array.isArray(raw?.tools)?raw.tools:[]).slice(0,20).map((x:any)=>({name:clean(x?.name,100),description:clean(x?.description,500)})).filter((x:any)=>x.name),workflows:(Array.isArray(raw?.workflows)?raw.workflows:[]).slice(0,20).map((x:any)=>({name:clean(x?.name,100),description:clean(x?.description,500)})).filter((x:any)=>x.name),knowledgeCount:Number.isSafeInteger(raw?.knowledgeCount)?Math.max(0,Math.min(1000,raw.knowledgeCount)):0};}

/** Configuration saves are local. Only explicit probe, discovery, import or sync contact the provider. */
@Injectable()
export class AgentsService {
  constructor(private readonly prisma:PrismaService,private readonly settings:SettingsService,private readonly box:SecretBox,private readonly coze:CozeClientService){}
  private async policy(){const[commerce,demo]=await Promise.all([this.settings.get<boolean>('commerce.enabled'),this.settings.get<boolean>('demo.siteEnabled')]);return{commerce:!!commerce,demo:!!demo};}
  private availability(connection:AgentConnection,demo:boolean){return demo?'demo':connection.deletedAt||!connection.enabled?'disabled':!connection.secretEnc?'unconfigured':'ready';}
  private publicAgent(agent:Agent&{connection:AgentConnection;favorites?:Array<{userId:string}>},policy:{commerce:boolean;demo:boolean}){
    const availability=this.availability(agent.connection,policy.demo);
    return {id:agent.id,name:agent.name,description:agent.description,greeting:agent.greeting,tags:strings(parsed(agent.tagsJson,[]),8,24),suggestedQuestions:strings(parsed(agent.questionsJson,[]),6,400),capabilities:publicCapabilities(parsed(agent.metadataJson,{})),ready:availability==='ready',availability,favorited:!!agent.favorites?.length,billing:chatBilling({countPool:'agent',countCost:agent.countCost},policy.commerce,false),offerRevision:agentOffer(agent,agent.connection,policy.commerce),lastSyncAt:agent.lastSyncAt};
  }
  async list(userId:string,query:AgentListDto){
    const policy=await this.policy(),base:Prisma.AgentWhereInput={published:true,deletedAt:null};
    const ready:Prisma.AgentWhereInput=policy.demo?{id:'__demo_unavailable__'}:{connection:{deletedAt:null,enabled:true,secretEnc:{not:''}}};
    const where:Prisma.AgentWhereInput={...base,...(query.q?.trim()?{OR:[{name:{contains:query.q.trim()}},{description:{contains:query.q.trim()}},{tagsJson:{contains:query.q.trim()}}]}:{}),...(query.favorites==='1'?{favorites:{some:{userId}}}:{}),...(query.ready==='1'?ready:{})};
    const page=query.page||1,pageSize=query.pageSize||12;
    const[rows,total,published,readyCount,favorites]=await Promise.all([this.prisma.agent.findMany({where,include:{connection:true,favorites:{where:{userId},select:{userId:true}}},orderBy:[{sort:'asc'},{createdAt:'desc'}],skip:(page-1)*pageSize,take:pageSize}),this.prisma.agent.count({where}),this.prisma.agent.count({where:base}),this.prisma.agent.count({where:{...base,...ready}}),this.prisma.agent.count({where:{...base,favorites:{some:{userId}}}})]);
    return {items:rows.map(x=>this.publicAgent(x,policy)),total,page,pageSize,summary:{published,ready:readyCount,favorites}};
  }
  async detail(userId:string,id:string){const[row,policy]=await Promise.all([this.prisma.agent.findFirst({where:{id,published:true,deletedAt:null},include:{connection:true,favorites:{where:{userId},select:{userId:true}}}}),this.policy()]);if(!row)throw missing('智能体搭档不存在或尚未发布');return this.publicAgent(row,policy);}
  async favorite(userId:string,id:string,favorited:boolean){
    return this.prisma.$transaction(async tx=>{const row=await tx.agent.findFirst({where:{id,published:true,deletedAt:null},select:{id:true}});if(!row)throw missing('智能体搭档不存在或尚未发布');if(favorited)await tx.agentFavorite.upsert({where:{userId_agentId:{userId,agentId:id}},create:{userId,agentId:id},update:{}});else await tx.agentFavorite.deleteMany({where:{userId,agentId:id}});return{favorited};});
  }
  async resolveForChat(id:string,revision?:string):Promise<ResolvedAgent>{
    const[row,policy]=await Promise.all([this.prisma.agent.findFirst({where:{id,published:true,deletedAt:null},include:{connection:true}}),this.policy()]);
    if(!row)throw missing('智能体搭档不存在或尚未发布');const availability=this.availability(row.connection,policy.demo);
    if(availability!=='ready')throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE,policy.demo?'当前站点为演示模式，智能体真实协作尚未开放':'这位搭档暂未完成连接配置，请联系管理员',503);
    const offerRevision=agentOffer(row,row.connection,policy.commerce);if(!revision||revision!==offerRevision)throw new BusinessException(ErrorCode.PARAM_INVALID,'搭档配置或费用已更新，请刷新后确认再发送',409);
    return {agent:row,connection:row.connection,model:{id:null,name:row.name,maxContext:128000,maxOutput:8192,countPool:'agent',countCost:row.countCost,priceInPerM:0,priceOutPerM:0},offerRevision,commerceEnabled:policy.commerce};
  }
  async assertOfferTx(tx:Prisma.TransactionClient,resolved:ResolvedAgent){
    const row=await tx.agent.findFirst({where:{id:resolved.agent.id,published:true,deletedAt:null},include:{connection:true}});
    const flags=await tx.globalConfig.findMany({where:{key:{in:['commerce.enabled','demo.siteEnabled']}},select:{key:true,value:true}}),flag=(key:string)=>flags.find(x=>x.key===key)?.value==='true';
    if(!row||flag('demo.siteEnabled')||flag('commerce.enabled')!==resolved.commerceEnabled||this.availability(row.connection,false)!=='ready'||agentOffer(row,row.connection,resolved.commerceEnabled)!==resolved.offerRevision)throw new BusinessException(ErrorCode.PARAM_INVALID,'搭档配置已变化，请刷新后再发送',409);
  }
  private connectionView({secretEnc,...row}:AgentConnection){return {...row,hasCredential:!!secretEnc};}
  async connections(){return(await this.prisma.agentConnection.findMany({where:{deletedAt:null},orderBy:{createdAt:'desc'}})).map(x=>this.connectionView(x));}
  async connection(id:string){const row=await this.prisma.agentConnection.findFirst({where:{id,deletedAt:null}});if(!row)throw missing('连接配置不存在');return row;}
  async saveConnection(dto:AgentConnectionDto,id?:string){
    const old=id?await this.connection(id):null,name=(dto.name??old?.name??'').trim(),baseUrl=(dto.baseUrl??old?.baseUrl??'').trim().replace(/\/+$/,''),authMode=dto.authMode??old?.authMode??'JWT';
    if(old&&dto.version!==undefined&&dto.version!==old.version)throw new BusinessException(ErrorCode.PARAM_INVALID,'连接已被更新，请刷新资料后再保存',409);
    if(!name)throw invalid('请填写连接名称');try{cozeEndpoint(baseUrl,'/v1/workspaces');}catch(error){throw invalid((error as Error).message);}
    const appId=(dto.appId??old?.appId??'').trim(),publicKeyId=(dto.publicKeyId??old?.publicKeyId??'').trim(),spaceId=(dto.spaceId??old?.spaceId??'').trim();
    if(authMode==='JWT'&&(!appId||!publicKeyId))throw invalid('OAuth 授权需要应用 ID 与公钥指纹');
    if(dto.secret===undefined||!dto.secret.trim()){if(old?.authMode&&old.authMode!==authMode)throw invalid('切换授权方式时需要重新填写凭据');}
    let secretEnc=old?.secretEnc||'';if(dto.secret?.trim()){try{secretEnc=this.box.encrypt(validatedAgentSecret(authMode,dto.secret));}catch(error){throw invalid((error as Error).message);}}
    const data={name,baseUrl,authMode,appId:authMode==='JWT'?appId:null,publicKeyId:authMode==='JWT'?publicKeyId:null,spaceId:spaceId||null,secretEnc,enabled:dto.enabled??old?.enabled??true,timeoutMs:dto.timeoutMs??old?.timeoutMs??60000,lastProbeAt:null,lastProbeOk:null};
    const saved=old?await this.prisma.$transaction(async tx=>{const changed=await tx.agentConnection.updateMany({where:{id:old.id,version:old.version,deletedAt:null},data:{...data,version:{increment:1}}});if(!changed.count)throw new BusinessException(ErrorCode.PARAM_INVALID,'连接已被更新，请刷新资料后再保存',409);return tx.agentConnection.findUniqueOrThrow({where:{id:old.id}});}):await this.prisma.agentConnection.create({data});if(old)this.coze.invalidate(old);return this.connectionView(saved);
  }
  async removeConnection(id:string){const old=await this.connection(id);await this.prisma.agentConnection.update({where:{id},data:{enabled:false,deletedAt:new Date(),version:{increment:1}}});this.coze.invalidate(old);return{ok:true};}
  private async remote<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof BusinessException)throw error;throw new BusinessException(ErrorCode.UPSTREAM_ERROR,error instanceof UpstreamError?error.message:'智能体连接未完成，请核对地址、授权与网络后重试',error instanceof UpstreamError?Math.max(400,Math.min(599,error.status)):502);}}
  async probe(id:string){
    const connection=await this.connection(id);let ok=false;
    try{await this.remote(()=>this.coze.json(connection,connection.spaceId?'/v1/space/published_bots_list':'/v1/workspaces',{}, {query:connection.spaceId?{space_id:connection.spaceId,page_index:'1',page_size:'1'}:{page_num:'1',page_size:'1'},timeoutMs:10000}));ok=true;return{ok:true,checkedAt:new Date().toISOString(),scope:connection.spaceId?'published-list':'workspace-list'};}finally{await this.prisma.agentConnection.updateMany({where:{id,version:connection.version,deletedAt:null},data:{lastProbeAt:new Date(),lastProbeOk:ok}});}
  }
  async discover(id:string,page:number){
    const connection=await this.connection(id);if(!connection.spaceId)throw invalid('请先填写并保存空间 ID');const json=await this.remote(()=>this.coze.json(connection,'/v1/space/published_bots_list',{}, {query:{space_id:connection.spaceId!,page_index:String(page),page_size:'20'},timeoutMs:15000}));
    if(!Array.isArray(json.data?.space_bots))throw new BusinessException(ErrorCode.UPSTREAM_ERROR,'智能体服务未返回有效的已发布搭档列表',502);
    return{items:json.data.space_bots.slice(0,20).filter((x:any)=>/^\d{1,64}$/.test(String(x?.bot_id))).map((x:any)=>({botId:String(x.bot_id),name:clean(x.bot_name,64),description:clean(x.description,2000)})),page,pageSize:20,total:Number.isSafeInteger(json.data.total)&&json.data.total>=0?json.data.total:null};
  }
  private async fetchMetadata(connection:AgentConnection,botId:string){
    const json=await this.remote(()=>this.coze.json(connection,'/v1/bots/'+botId,{}, {query:{is_published:'true'},timeoutMs:15000})),raw=json.data;
    if(!raw||String(raw.bot_id||raw.id)!==botId||!clean(raw.name,64))throw new BusinessException(ErrorCode.UPSTREAM_ERROR,'智能体服务返回的搭档资料不完整或身份不符',502);
    return{name:clean(raw.name,64),description:clean(raw.description,2000),greeting:clean(raw.onboarding_info?.prologue,4000),questionsJson:JSON.stringify(strings(raw.onboarding_info?.suggested_questions,6,400)),metadataJson:JSON.stringify(metadata(raw)),lastSyncAt:new Date()};
  }
  async importBots(id:string,botIds:string[],countCost:number){
    if(!botIds.length)throw invalid('请至少选择一位搭档');const connection=await this.connection(id),prepared:Array<{botId:string;data:Awaited<ReturnType<AgentsService['fetchMetadata']>>}>=[];
    // Fetch every selected bot before writing, so a remote failure cannot leave a half-imported batch.
    for(const botId of [...new Set(botIds)])prepared.push({botId,data:await this.fetchMetadata(connection,botId)});
    return this.prisma.$transaction(async tx=>{const current=await tx.agentConnection.findFirst({where:{id,deletedAt:null,version:connection.version}});if(!current)throw new BusinessException(ErrorCode.PARAM_INVALID,'连接已变化，请重新获取列表',409);const items:Array<{id:string;name:string;published:boolean;countCost:number}>=[];for(const {botId,data}of prepared){const row=await tx.agent.upsert({where:{connectionId_botId:{connectionId:id,botId}},create:{...data,connectionId:id,botId,countCost,published:false},update:{...data,deletedAt:null}});items.push({id:row.id,name:row.name,published:row.published,countCost:row.countCost});}return{items,imported:items.length};});
  }
  private adminAgent(row:Agent&{connection?:{name:string;enabled:boolean;deletedAt:Date|null}}){const{tagsJson,questionsJson,metadataJson,...base}=row;return{...base,tags:strings(parsed(tagsJson,[]),8,24),suggestedQuestions:strings(parsed(questionsJson,[]),6,400),capabilities:parsed(metadataJson,{})};}
  async adminList(){return(await this.prisma.agent.findMany({where:{deletedAt:null},include:{connection:{select:{name:true,enabled:true,deletedAt:true}}},orderBy:[{sort:'asc'},{createdAt:'desc'}]})).map(row=>this.adminAgent(row));}
  async saveAgent(dto:AgentEditDto,id?:string){
    const old=id?await this.prisma.agent.findFirst({where:{id,deletedAt:null}}):null;if(id&&!old)throw missing('搭档不存在');
    if(old&&((dto.connectionId!==undefined&&dto.connectionId!==old.connectionId)||(dto.botId!==undefined&&dto.botId!==old.botId)))throw invalid('已创建搭档的连接与远端身份不可更换，请新建搭档');
    const connectionId=dto.connectionId??old?.connectionId,botId=dto.botId??old?.botId,name=(dto.name??old?.name??'').trim();if(!connectionId||!botId||!name)throw invalid('请填写连接、搭档 ID 与名称');await this.connection(connectionId);
    const data={connectionId,botId,name,...(dto.description!==undefined?{description:dto.description}:{}),...(dto.greeting!==undefined?{greeting:dto.greeting}:{}),...(dto.tags!==undefined?{tagsJson:JSON.stringify(strings(dto.tags,8,24))}:{}),...(dto.suggestedQuestions!==undefined?{questionsJson:JSON.stringify(strings(dto.suggestedQuestions,6,400))}:{}),...(dto.countCost!==undefined?{countCost:dto.countCost}:{}),...(dto.published!==undefined?{published:dto.published}:{}),...(dto.sort!==undefined?{sort:dto.sort}:{})};
    try{return this.adminAgent(old?await this.prisma.agent.update({where:{id:old.id},data}):await this.prisma.agent.create({data}));}catch(error){if((error as any)?.code==='P2002')throw new BusinessException(ErrorCode.PARAM_INVALID,'此连接下的搭档已存在，请编辑已有资料',409);throw error;}
  }
  async syncAgent(id:string){const old=await this.prisma.agent.findFirst({where:{id,deletedAt:null}});if(!old)throw missing('搭档不存在');const connection=await this.connection(old.connectionId),data=await this.fetchMetadata(connection,old.botId);return this.prisma.$transaction(async tx=>{const valid=await tx.agentConnection.findFirst({where:{id:connection.id,version:connection.version,deletedAt:null}});if(!valid)throw new BusinessException(ErrorCode.PARAM_INVALID,'连接已变化，请重试',409);return this.adminAgent(await tx.agent.update({where:{id},data}));});}
  async removeAgent(id:string){const changed=await this.prisma.agent.updateMany({where:{id,deletedAt:null},data:{published:false,deletedAt:new Date()}});if(!changed.count)throw missing('搭档不存在');return{ok:true};}
  async receipts(){const rows=await this.prisma.agentRun.findMany({orderBy:{createdAt:'desc'},take:40,select:{messageId:true,state:true,contextMode:true,cancelState:true,createdAt:true,agent:{select:{id:true,name:true}},message:{select:{status:true,agentJson:true,billingState:true,reservedAmount:true,chargedAmount:true,returnedAmount:true,expiredAmount:true,errorCode:true,durationMs:true}}}});return rows.map(({message,...row})=>({...row,...message,agentJson:undefined,activity:safeAgentActivity(message.agentJson)}));}
}
