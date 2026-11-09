import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {conversationAppSelect,conversationAppView} from '../apps/app-visibility';
import type {Prisma} from '@prisma/client';
export const conversationSummaryInclude={_count:{select:{messages:{where:{deletedAt:null}}}},app:{select:conversationAppSelect},agent:{select:{id:true,name:true}},messages:{where:{deletedAt:null,role:'ASSISTANT',status:{in:['PENDING','STREAMING','SETTLING']}},select:{id:true,status:true},take:1,orderBy:{createdAt:'desc'}}} satisfies Prisma.ConversationInclude;
export function conversationSummary(row:any,userId:string){return{id:row.id,version:row.version,title:row.title,modelId:row.modelId,folderId:row.folderId,appId:row.appId,app:conversationAppView(row.app,userId),agentId:row.agentId,agent:row.agent,pinned:!!row.pinnedAt,messageCount:row._count.messages,activeMessageId:row.messages[0]?.id??null,activeMessageStatus:row.messages[0]?.status??null,lastMessageAt:row.lastMessageAt,createdAt:row.createdAt,deletedAt:row.deletedAt};}
export async function assertConversationActor(tx:any,userId:string,lock=true){if(lock)await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前身份不能修改会话',403);}
export async function ownedConversation(tx:any,userId:string,id:string,expectedVersion?:number,trash=false){
 const row=await tx.conversation.findFirst({where:{id,userId,...(trash?{deletedAt:{not:null}}:{deletedAt:null})}});if(!row)throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND,'会话不存在',404);
 if(expectedVersion!==undefined&&row.version!==expectedVersion)throw new BusinessException(ErrorCode.CONVERSATION_CHANGED,'这段对话已变化，请刷新后再操作。',409);return row;
}
