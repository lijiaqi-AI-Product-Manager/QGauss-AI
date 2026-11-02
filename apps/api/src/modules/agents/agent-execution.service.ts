import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AgentConnection, AgentRun, Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { AgentActivity, publicAgentActivity, safeAgentActivity } from '../../common/llm/agent-activity';
import { CozeInput, CozeRemote, CozeStreamDecoder, cozeChatBody } from '../../common/llm/coze-protocol';
import { readProtocolResponse } from '../../common/llm/chat-stream';
import { UpstreamError } from '../../common/llm/chat-protocol';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { AttachmentMeta } from '../chat/attachments.service';
import { ChatRun } from '../chat/chat-run';
import { CozeClientService } from './coze-client.service';
import { ResolvedAgent } from './agents.service';

type PreparedAgentRun={row:AgentRun;input:CozeInput[];send:CozeInput[]};
const remoteId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export function agentContextHash(input:CozeInput[]){return createHash('sha256').update(JSON.stringify(input.map(row=>({role:row.role,content:row.content,attachments:row.role==='user'?[...new Set(row.attachments||[])]:[]})))).digest('hex');}
const conflict=(text:string)=>new BusinessException(ErrorCode.CONVERSATION_BUSY,text,409);

/** Native generations are never automatically retried. Only the idempotent cancellation has bounded retries. */
@Injectable()
export class AgentExecutionService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(AgentExecutionService.name);
  private timer?:NodeJS.Timeout;
  private working=false;
  constructor(private readonly prisma:PrismaService,private readonly storage:StorageService,private readonly settings:SettingsService,private readonly coze:CozeClientService){}
  onModuleInit(){this.timer=setInterval(()=>{void this.retryCancellations().catch(()=>this.logger.warn('智能体停止回执待重试'));},10000);this.timer.unref?.();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async validateInput(userId:string,input:Array<{role:string;content:string;attachments?:string[]}>){
    if(!input.length||input.length>100||input.some(row=>!['user','assistant'].includes(row.role))||input.at(-1)?.role!=='user'||input.reduce((sum,row)=>sum+row.content.length,0)>1_000_000)throw new BusinessException(ErrorCode.PARAM_INVALID,'智能体上下文需要由问题与回复组成，并以当前问题结束',400);
    const max=Number(await this.settings.get<number>('chat.maxAttachments'))||9,ids=[...new Set(input.flatMap(row=>row.attachments||[]))];
    if(ids.length>40||input.some(row=>(row.attachments?.length||0)>max||row.role!=='user'&&row.attachments?.length))throw new BusinessException(ErrorCode.PARAM_INVALID,`单条消息最多附带 ${max} 个文件；较长历史请关闭上下文后继续`,400);
    const rows=ids.length?await this.prisma.uploadFile.findMany({where:{id:{in:ids},userId,deletedAt:null},select:{id:true,filename:true,mime:true,size:true}}):[];
    if(rows.length!==ids.length)throw new BusinessException(ErrorCode.PARAM_INVALID,'附件不存在、已删除或不属于当前账户',400);
    const byId=new Map(rows.map(row=>[row.id,row])),last=input.at(-1)!;
    const lastUserAttachments:AttachmentMeta[]=[...new Set(last.attachments||[])].map(id=>{const row=byId.get(id)!;return{id,name:row.filename,mime:row.mime,size:row.size,kind:/^image\/(png|jpeg|webp|gif)$/.test(row.mime)?'image':'document'};});
    return{input:input.map(row=>({role:row.role as 'user'|'assistant',content:row.content,...(row.role==='user'&&row.attachments?.length?{attachments:[...new Set(row.attachments)]}:{})})),lastUserAttachments};
  }
  async prepareTx(tx:Prisma.TransactionClient,resolved:ResolvedAgent,userId:string,conversationId:string,messageId:string,parentId:string|undefined,input:CozeInput[]):Promise<PreparedAgentRun>{
    const busy=await tx.message.findFirst({where:{conversationId,role:'ASSISTANT',id:{not:messageId},status:{in:['PENDING','STREAMING','SETTLING']}}});if(busy)throw conflict('此搭档会话仍在协作或结算中，请完成后再继续');
    let parent:AgentRun|null=null;
    if(parentId){
      const owned=await tx.message.findFirst({where:{id:parentId,conversationId,role:'ASSISTANT',status:'COMPLETED',deletedAt:null},include:{agentRun:true}});
      if(!owned?.agentRun||owned.agentRun.userId!==userId||owned.agentRun.agentId!==resolved.agent.id)throw conflict('所选上下文已变化，请重新打开历史后发送');
      const candidate=owned.agentRun;
      if(candidate.state==='completed'&&candidate.connectionId===resolved.connection.id&&candidate.connectionVersion===resolved.connection.version&&candidate.remoteConversationId&&candidate.contextHash===agentContextHash(input.slice(0,-1))){
        const latest=await tx.agentRun.findFirst({where:{connectionId:candidate.connectionId,connectionVersion:candidate.connectionVersion,remoteConversationId:candidate.remoteConversationId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
        if(latest?.id===candidate.id)parent=candidate;
      }
    }
    const row=await tx.agentRun.create({data:{messageId,userId,agentId:resolved.agent.id,connectionId:resolved.connection.id,connectionVersion:resolved.connection.version,contextUser:parent?.contextUser||'qg_'+randomBytes(24).toString('hex'),contextMode:parent?'continued':'fresh',remoteConversationId:parent?.remoteConversationId||null}});
    const activity:AgentActivity={kind:'agent',status:'waiting',context:parent?'continued':'fresh',steps:[],suggestions:[],artifacts:[]};
    await tx.message.update({where:{id:messageId},data:{agentJson:JSON.stringify(activity)}});
    return{row,input,send:parent?[input.at(-1)!]:input};
  }
  private async providerFiles(userId:string,connection:AgentConnection,input:CozeInput[],signal:AbortSignal){
    const files=new Map<string,{id:string;kind:'image'|'file'}>();
    for(const id of [...new Set(input.flatMap(row=>row.attachments||[]))]){
      signal.throwIfAborted();
      // Local ownership/deletion is rechecked even for a cached provider file.
      const local=await this.prisma.uploadFile.findFirst({where:{id,userId,deletedAt:null},select:{id:true,mime:true}});if(!local)throw new UpstreamError(400,'agent attachment unavailable','附件已删除或不可用，请重新上传');
      const where={userId_connectionId_connectionVersion_uploadId:{userId,connectionId:connection.id,connectionVersion:connection.version,uploadId:id}},cached=await this.prisma.agentFileMapping.findUnique({where});
      let fileId=cached&&cached.expiresAt.getTime()>Date.now()?cached.remoteFileId:null;
      if(!fileId){
        const file=await this.storage.read(id,userId,'USER'),form=new FormData();form.set('file',new Blob([new Uint8Array(file.buffer)],{type:file.mime}),file.filename);
        const json=await this.coze.json(connection,'/v1/files/upload',{method:'POST',body:form},{signal});if(!remoteId(json.data?.id))throw new UpstreamError(502,'invalid agent file receipt','智能体服务没有确认接收附件');fileId=json.data.id;
        await this.prisma.agentFileMapping.upsert({where,create:{userId,connectionId:connection.id,connectionVersion:connection.version,uploadId:id,remoteFileId:fileId!,expiresAt:new Date(Date.now()+7*86400000)},update:{remoteFileId:fileId!,expiresAt:new Date(Date.now()+7*86400000)}});
      }
      files.set(id,{id:fileId!,kind:/^image\/(png|jpeg|webp|gif)$/.test(local.mime)?'image':'file'});
    }
    return input.map(row=>({role:row.role,content:row.content,...(row.attachments?.length?{files:row.attachments.map(id=>files.get(id)!)}:{})}));
  }
  async stream(prepared:PreparedAgentRun,resolved:ResolvedAgent,run:ChatRun,onFirstToken:()=>void){
    let queue=Promise.resolve(),known:CozeRemote|undefined;
    const enqueue=(work:()=>Promise<void>|void)=>{queue=queue.then(work);void queue.catch(()=>{});};
    const decoder=new CozeStreamDecoder(resolved.agent.botId,prepared.row.contextMode==='continued'?'continued':'fresh',{
      remote:value=>{known=value;enqueue(async()=>{if(prepared.row.remoteConversationId&&prepared.row.remoteConversationId!==value.conversationId)throw new UpstreamError(502,'agent conversation mismatch','智能体服务返回的上下文身份不一致');await this.prisma.agentRun.update({where:{messageId:run.messageId},data:{remoteConversationId:value.conversationId,remoteChatId:value.chatId,state:'streaming'}});});},
      emit:(event,value)=>enqueue(()=>{if(!run.signal.aborted){onFirstToken();run.emit(event,{v:value});}}),
      activity:value=>enqueue(()=>{if(!run.signal.aborted)run.emit('agent',value);}),
    });
    try{
      const messages=await this.providerFiles(run.userId,resolved.connection,prepared.send,run.signal);run.signal.throwIfAborted();
      const response=await this.coze.request(resolved.connection,'/v3/chat',{method:'POST',body:JSON.stringify(cozeChatBody(resolved.agent.botId,prepared.row.contextUser,messages))},{query:prepared.row.remoteConversationId?{conversation_id:prepared.row.remoteConversationId}:undefined,signal:run.signal});
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw new UpstreamError(response.status,'agent generation HTTP error',[401,403].includes(response.status)?'搭档授权未通过，请联系管理员核对连接。':response.status===429?'搭档服务当前繁忙，请稍后手动重试。':'搭档服务暂未完成这次请求，请稍后明确重试。');}
      const out=await readProtocolResponse(response,decoder,run.signal,resolved.connection.timeoutMs,()=>queue);await queue;
      run.signal.throwIfAborted();
      await this.prisma.agentRun.update({where:{messageId:run.messageId},data:{state:'completed',contextHash:agentContextHash([...prepared.input,{role:'assistant',content:out.text}])}});
      return out;
    }catch(error){
      await queue.catch(()=>{});
      await this.requestCancellation(run.messageId,resolved.connection,known).catch(()=>this.logger.warn('智能体停止请求待恢复'));
      throw error;
    }
  }
  async finalActivity(messageId:string,status:string,activity:unknown){
    const row=await this.prisma.agentRun.update({where:{messageId},data:{state:status==='COMPLETED'?'completed':status==='ABORTED'?'interrupted':'failed'}});
    const current=safeAgentActivity(activity)||{kind:'agent' as const,status:'waiting' as const,context:row.contextMode==='continued'?'continued' as const:'fresh' as const,steps:[],suggestions:[],artifacts:[]};
    return publicAgentActivity({...current,status:status==='COMPLETED'?'completed':status==='ABORTED'?'interrupted':'failed'},row)!;
  }
  async recover(messageId:string){
    const row=await this.prisma.agentRun.findUnique({where:{messageId},include:{message:{select:{status:true,agentJson:true}}}});if(!row||row.message.status==='COMPLETED')return;
    await this.prisma.agentRun.update({where:{id:row.id},data:{state:'interrupted',...(row.cancelState==='none'?{cancelState:row.remoteConversationId&&row.remoteChatId?'requested':'unknown',cancelAttempts:row.remoteChatId?0:3}:{})}});
  }
  async requestCancellation(messageId:string,connection:AgentConnection,fallback?:CozeRemote){
    let row=await this.prisma.agentRun.findUnique({where:{messageId}});if(!row||row.cancelState==='accepted')return;
    if(fallback&&(!row.remoteChatId||!row.remoteConversationId))row=await this.prisma.agentRun.update({where:{messageId},data:{remoteChatId:fallback.chatId,remoteConversationId:fallback.conversationId}});
    if(!row.remoteChatId||!row.remoteConversationId){await this.prisma.agentRun.update({where:{id:row.id},data:{cancelState:'unknown',cancelAttempts:3}});return;}
    await this.prisma.agentRun.updateMany({where:{id:row.id,cancelState:{notIn:['accepted','sending']}},data:{cancelState:'requested'}});
    await this.cancelOnce(row.id,connection);
  }
  private async cancelOnce(id:string,credential?:AgentConnection){
    const row=await this.prisma.agentRun.findUnique({where:{id},include:{connection:true}});if(!row||!row.remoteChatId||!row.remoteConversationId||row.cancelAttempts>=3||row.cancelState==='accepted')return;
    const connection=credential||row.connection;
    if(connection.version!==row.connectionVersion){await this.prisma.agentRun.updateMany({where:{id,cancelState:{not:'accepted'}},data:{cancelState:'unknown',cancelAttempts:3}});return;}
    const token=randomUUID(),claimed=await this.prisma.agentRun.updateMany({where:{id,cancelAttempts:row.cancelAttempts,cancelState:{in:['requested','unknown']},cancelToken:row.cancelToken},data:{cancelState:'sending',cancelToken:token,cancelAttempts:{increment:1},cancelTriedAt:new Date()}});if(!claimed.count)return;
    let state='unknown';
    try{const json=await this.coze.json(connection,'/v3/chat/cancel',{method:'POST',body:JSON.stringify({conversation_id:row.remoteConversationId,chat_id:row.remoteChatId})},{timeoutMs:5000,signal:AbortSignal.timeout(5000)});if(json.code!==0||json.data?.id&&json.data.id!==row.remoteChatId||json.data?.conversation_id&&json.data.conversation_id!==row.remoteConversationId)throw new Error('invalid cancellation receipt');state='accepted';}catch{/* An accepted cancel does not prove remote computation or provider billing stopped. */}
    await this.prisma.agentRun.updateMany({where:{id,cancelToken:token,cancelState:'sending'},data:{cancelState:state,cancelToken:null}});
  }
  private async retryCancellations(){
    if(this.working)return;this.working=true;
    try{
      const cutoff=new Date(Date.now()-15000);
      await this.prisma.agentRun.updateMany({where:{cancelState:'sending',cancelTriedAt:{lt:cutoff}},data:{cancelState:'unknown',cancelToken:null}});
      const rows=await this.prisma.agentRun.findMany({where:{cancelState:{in:['requested','unknown']},cancelAttempts:{lt:3},remoteChatId:{not:null},remoteConversationId:{not:null},message:{status:{in:['COMPLETED','ABORTED','FAILED']}},OR:[{cancelTriedAt:null},{cancelTriedAt:{lt:cutoff}}]},select:{id:true},orderBy:{createdAt:'asc'},take:2});
      await Promise.all(rows.map(row=>this.cancelOnce(row.id)));
    }finally{this.working=false;}
  }
}
