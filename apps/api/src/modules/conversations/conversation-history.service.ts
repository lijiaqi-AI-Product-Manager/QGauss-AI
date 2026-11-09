import {Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {ChatService} from '../chat/chat.service';
import {assertConversationActor,conversationSummary,conversationSummaryInclude} from './conversation-state';
import {ConversationHistoryDto,ConversationPreviewDto,ConversationRemovalDto,ConversationStatusDto,HistoryFilterDto} from './dto/history.dto';

type Filter={kind:'chat'|'app'|'agent';scope:'active'|'trash';q:string;folder:string};
type Conditions={sql:string;params:any[]};
const folderExpression='CASE WHEN EXISTS (SELECT 1 FROM "conversation_folders" f WHERE f."id"=c."folderId" AND f."userId"=c."userId") THEN c."folderId" ELSE NULL END';
const kindExpression='CASE WHEN c."agentId" IS NOT NULL THEN \'agent\' WHEN c."appId" IS NOT NULL THEN \'app\' ELSE \'chat\' END';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const changed=()=>new BusinessException(ErrorCode.CONVERSATION_HISTORY_CHANGED,'当前记录已变化，请重新确认要整理的对话。',409);
function filter(input:Partial<HistoryFilterDto>):Filter{return{kind:input.kind||'chat',scope:input.scope||'active',q:(input.q||'').trim(),folder:(input.folder||'').trim()};}
function conditions(userId:string,value:Filter,omit?:'kind'|'folder'):Conditions{
 const clauses=['c."userId"=?',value.scope==='trash'?'c."deletedAt" IS NOT NULL':'c."deletedAt" IS NULL'],params:any[]=[userId];
 if(value.q){clauses.push('instr(lower(c."title"),lower(?))>0');params.push(value.q);}
 if(omit!=='kind'){clauses.push(kindExpression+'=?');params.push(value.kind);}
 if(omit!=='folder'&&value.folder){if(value.folder==='unfiled')clauses.push('('+folderExpression+') IS NULL');else{clauses.push('('+folderExpression+')=?');params.push(value.folder);}}
 return{sql:clauses.join(' AND '),params};
}
function timestamp(value:any){const source=typeof value==='bigint'||typeof value==='string'&&/^\d+$/.test(value)?Number(value):typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)?value.replace(' ','T')+'Z':value,date=value instanceof Date?value:new Date(source);if(!Number.isFinite(date.getTime()))throw new BusinessException(ErrorCode.PARAM_INVALID,'会话记录的时间暂未确认，请刷新',400);return date.toISOString();}
function nextCursor(userId:string,value:Filter,row:any){return Buffer.from(JSON.stringify({v:1,h:hash([userId,value]),i:row.id,p:row.pinnedAt===null?null:timestamp(row.pinnedAt),l:timestamp(row.lastMessageAt)})).toString('base64url');}
function cursorConditions(userId:string,value:Filter,cursor?:string):Conditions{
 if(!cursor)return{sql:'',params:[]};
 try{const point=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(point.v!==1||point.h!==hash([userId,value])||typeof point.i!=='string'||!point.i.length||point.i.length>128||typeof point.l!=='string'||timestamp(point.l)!==point.l||point.p!==null&&(typeof point.p!=='string'||timestamp(point.p)!==point.p))throw Error('cursor');
  const after='(c."lastMessageAt"<? OR (c."lastMessageAt"=? AND c."id"<?))',date=new Date(point.l);
  return point.p===null?{sql:' AND (c."pinnedAt" IS NULL AND '+after+')',params:[date,date,point.i]}:{sql:' AND (c."pinnedAt"<? OR c."pinnedAt" IS NULL OR (c."pinnedAt"=? AND '+after+'))',params:[new Date(point.p),new Date(point.p),date,date,point.i]};
 }catch{throw new BusinessException(ErrorCode.PARAM_INVALID,'翻页记录与当前筛选不一致，请刷新后继续',400);}
}
function normalizeFolder(row:any,folders:Set<string>){return folders.has(row.folderId)?row:{...row,folderId:null};}

@Injectable()
export class ConversationHistoryService {
 constructor(private readonly prisma:PrismaService,private readonly chat:ChatService){}
 async list(userId:string,input:ConversationHistoryDto){
  const value=filter(input),base=conditions(userId,value),after=cursorConditions(userId,value,input.cursor),limit=input.limit??40;
  return this.prisma.$transaction(async tx=>{
   await assertConversationActor(tx,userId,false);
   const points:any[]=await tx.$queryRawUnsafe('SELECT c."id",c."pinnedAt",c."lastMessageAt" FROM "conversations" c WHERE '+base.sql+after.sql+' ORDER BY c."pinnedAt" DESC,c."lastMessageAt" DESC,c."id" DESC LIMIT ?',...base.params,...after.params,limit+1),page=points.slice(0,limit),ids=page.map(row=>row.id),rows=ids.length?await tx.conversation.findMany({where:{id:{in:ids},userId},include:conversationSummaryInclude}):[],byId=new Map(rows.map(row=>[row.id,row]));
   const counts:any[]=await tx.$queryRawUnsafe('SELECT count(*) AS total,sum(CASE WHEN c."pinnedAt" IS NULL THEN 1 ELSE 0 END) AS unpinned FROM "conversations" c WHERE '+base.sql,...base.params),kindBase=conditions(userId,value,'kind'),kindRows:any[]=await tx.$queryRawUnsafe('SELECT '+kindExpression+' AS kind,count(*) AS total FROM "conversations" c WHERE '+kindBase.sql+' GROUP BY '+kindExpression,...kindBase.params),folderBase=conditions(userId,value,'folder'),folderRows:any[]=await tx.$queryRawUnsafe('SELECT ('+folderExpression+') AS folder,count(*) AS total FROM "conversations" c WHERE '+folderBase.sql+' GROUP BY ('+folderExpression+')',...folderBase.params),folders=await tx.conversationFolder.findMany({where:{userId},orderBy:[{sort:'asc'},{createdAt:'asc'},{id:'asc'}]}),ownedFolders=new Set(folders.map(row=>row.id));
   const kindCounts={chat:0,app:0,agent:0};for(const row of kindRows)kindCounts[row.kind as keyof typeof kindCounts]=Number(row.total);const folderCounts:Record<string,number>={};for(const row of folderRows)folderCounts[row.folder||'unfiled']=Number(row.total);
   return{items:ids.map(id=>conversationSummary(normalizeFolder(byId.get(id),ownedFolders),userId)),total:Number(counts[0].total),unpinnedTotal:Number(counts[0].unpinned||0),kindCounts,folderCounts,folders:folders.map(row=>({id:row.id,version:row.version,name:row.name,sort:row.sort,createdAt:row.createdAt,conversationCount:folderCounts[row.id]||0})),hasMore:points.length>limit,nextCursor:points.length>limit?nextCursor(userId,value,page.at(-1)):null};
  });
 }
 async status(userId:string,input:ConversationStatusDto){
  const rows=await this.prisma.conversation.findMany({where:{id:{in:input.ids},userId,deletedAt:input.scope==='trash'?{not:null}:null},include:conversationSummaryInclude}),folders=await this.prisma.conversationFolder.findMany({where:{userId},select:{id:true}}),owned=new Set(folders.map(row=>row.id)),found=new Set(rows.map(row=>row.id));return{items:rows.map(row=>conversationSummary(normalizeFolder(row,owned),userId)),missing:input.ids.filter(id=>!found.has(id))};
 }
 private async selection(tx:any,userId:string,input:ConversationPreviewDto){
  if(input.scope==='trash')throw new BusinessException(ErrorCode.PARAM_INVALID,'请先返回可用对话再整理',400);const value=filter(input),base=conditions(userId,value);let extra='';const params=[...base.params];
  if(input.mode==='selected'){
   const targets=input.targets||[],ids=targets.map(row=>row.id);if(!ids.length||new Set(ids).size!==ids.length)throw new BusinessException(ErrorCode.PARAM_INVALID,'请选择不同的对话再整理',400);extra=' AND c."id" IN ('+ids.map(()=>'?').join(',')+')';params.push(...ids);
  }else{if(input.targets?.length)throw new BusinessException(ErrorCode.PARAM_INVALID,'整理未置顶对话时不需要额外选择',400);extra=' AND c."pinnedAt" IS NULL';}
  const raw:any[]=await tx.$queryRawUnsafe('SELECT c."id",c."version",c."pinnedAt" FROM "conversations" c WHERE '+base.sql+extra+' ORDER BY c."id" ASC',...params),rows=raw.map(row=>({...row,version:Number(row.version)}));
  if(input.mode==='selected'){const expected=new Map(input.targets!.map(row=>[row.id,row.expectedVersion]));if(rows.length!==expected.size||rows.some(row=>expected.get(row.id)!==row.version))throw changed();}
  const active:any[]=await tx.$queryRawUnsafe('SELECT count(DISTINCT m."conversationId") AS total FROM "messages" m JOIN "conversations" c ON c."id"=m."conversationId" WHERE '+base.sql+extra+' AND m."deletedAt" IS NULL AND m."role"=\'ASSISTANT\' AND m."status" IN (\'PENDING\',\'STREAMING\',\'SETTLING\')',...params);
  return{rows,confirmation:hash([userId,value,input.mode,rows.map(row=>[row.id,row.version])]),count:rows.length,activeCount:Number(active[0].total),pinnedCount:rows.filter(row=>row.pinnedAt!==null).length};
 }
 async preview(userId:string,input:ConversationPreviewDto){return this.prisma.$transaction(async tx=>{await assertConversationActor(tx,userId,false);const {rows:_rows,...result}=await this.selection(tx,userId,input);return result;});}
 async remove(userId:string,input:ConversationRemovalDto){
  const result=await this.prisma.$transaction(async tx=>{await assertConversationActor(tx,userId);const selection=await this.selection(tx,userId,input);if(selection.confirmation!==input.confirmation)throw changed();const ids=selection.rows.map(row=>row.id),deletedAt=new Date();for(let offset=0;offset<ids.length;offset+=500)await tx.conversation.updateMany({where:{userId,deletedAt:null,id:{in:ids.slice(offset,offset+500)}},data:{deletedAt,version:{increment:1}}});return{count:ids.length,removedIds:ids};});
  for(const id of result.removedIds)this.chat.cancelConversationRuns(userId,id);return result;
 }
}
