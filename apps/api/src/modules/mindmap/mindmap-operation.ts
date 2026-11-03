import {createHash,randomUUID} from 'node:crypto';
import {Prisma,MindmapOperation} from '@prisma/client';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {MINDMAP_IDENTIFIER} from './mindmap.dto';

export const mindmapHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const mindmapConflict=(message='这条操作已被更新，请重新确认后再继续。')=>new BusinessException(ErrorCode.PARAM_INVALID,message,409);
export const mindmapMissing=()=>new BusinessException(ErrorCode.NOT_FOUND,'没有找到这份内容。',404);
export function mindmapId(value:string){if(typeof value!=='string'||!MINDMAP_IDENTIFIER.test(value))throw new BusinessException(ErrorCode.PARAM_INVALID,'内容标识无效。',400);return value;}

/** The first statement owns the SQLite writer lock before any dependent reads. */
export async function lockMindmapOperation(tx:Prisma.TransactionClient,userId:string,requestKey:string,kind:string,payloadHash:string,state='APPLIED',documentId:string|null=null){
 mindmapId(requestKey);
 const inserted=await tx.$executeRaw`INSERT INTO "mindmap_operations" ("id","userId","requestKey","kind","payloadHash","state","documentId","createdAt") VALUES (${randomUUID()},${userId},${requestKey},${kind},${payloadHash},${state},${documentId},${new Date()}) ON CONFLICT ("userId","requestKey") DO NOTHING`;
 const row=await tx.mindmapOperation.findUniqueOrThrow({where:{userId_requestKey:{userId,requestKey}}});
 return{row,inserted:inserted===1};
}

export function assertMindmapReplay(row:MindmapOperation,kind:string,payloadHash:string){
 if(row.kind!==kind||row.state!=='ENDED'&&row.payloadHash!==payloadHash)throw mindmapConflict('这个操作编号已经用于其他内容，请重新发起操作。');
}
