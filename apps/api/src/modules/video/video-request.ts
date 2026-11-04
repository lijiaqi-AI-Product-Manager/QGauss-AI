import {Prisma,VideoTask} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';

type Db=Prisma.TransactionClient;
export type VideoRequestRow={id:string;userId:string;requestKey:string;taskId:string|null;state:string};
const conflict=(message:string)=>new BusinessException(ErrorCode.CONVERSATION_BUSY,message,409);
export const videoRequestEnded=()=>new BusinessException(ErrorCode.NOT_FOUND,'这次提交等待已结束，请重新确认后再开始创作。',410);
export function videoRequestKey(value:string){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(value))throw new BusinessException(ErrorCode.PARAM_INVALID,'视频提交标识无效。',400);return value;}
export async function videoRequest(db:Db,userId:string,key:string){videoRequestKey(key);const rows=await db.$queryRaw<VideoRequestRow[]>`SELECT * FROM "video_requests" WHERE "userId"=${userId} AND "requestKey"=${key}`;return rows[0]||null;}
export async function assertVideoOwner(db:Db,userId:string){if(!await db.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'账户当前不可用',403);}
export async function lockVideoOwner(db:Db,userId:string){await db.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;await assertVideoOwner(db,userId);}

/** Re-read after a marker appears: another connection may have just accepted the task. */
export async function replayVideoRequest(db:Db,userId:string,key:string,signature:string):Promise<VideoTask|null>{
  let row=await db.videoTask.findUnique({where:{userId_requestKey:{userId,requestKey:key}}});
  if(!row){const marker=await videoRequest(db,userId,key);if(marker?.state==='ENDED')throw videoRequestEnded();if(marker){row=await db.videoTask.findUnique({where:{userId_requestKey:{userId,requestKey:key}}});if(!row)throw conflict('这次提交已经受理，请先核对原任务。');}}
  if(row){if(row.intentHash!==signature)throw conflict('同一提交标识不能用于不同创意');if(row.deletedAt)throw new BusinessException(ErrorCode.NOT_FOUND,'视频任务不存在',404);}
  return row;
}
export async function acceptVideoRequest(db:Db,task:VideoTask){const now=new Date();await db.$executeRaw`INSERT INTO "video_requests" ("id","userId","requestKey","taskId","state","createdAt","updatedAt") VALUES (${randomUUID()},${task.userId},${task.requestKey},${task.id},'ACCEPTED',${now},${now})`;}
export async function endVideoRequest(db:Db,userId:string,key:string){videoRequestKey(key);const now=new Date();await db.$executeRaw`INSERT INTO "video_requests" ("id","userId","requestKey","state","createdAt","updatedAt") VALUES (${randomUUID()},${userId},${key},'ENDED',${now},${now}) ON CONFLICT("userId","requestKey") DO UPDATE SET "state"='ENDED',"updatedAt"=${now}`;}
