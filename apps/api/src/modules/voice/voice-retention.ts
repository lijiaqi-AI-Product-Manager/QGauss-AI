import type {Prisma} from '@prisma/client';

export const VOICE_TERMINAL=['COMPLETED','FAILED','CANCELED'];
export function voiceExpiry(days:number,finishedAt:Date){
 if(!Number.isInteger(days)||days<0||days>3650)throw new Error('Invalid voice retention period');
 return days?new Date(finishedAt.getTime()+days*86400000):null;
}
export const voiceFileActive=(now=new Date()):Prisma.UploadFileWhereInput=>({deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:now}}]});
export function voiceContentActive(row:{deletedAt:Date|null;purgedAt:Date|null;expiresAt:Date|null},now=new Date()){return!row.deletedAt&&!row.purgedAt&&(!row.expiresAt||row.expiresAt>now);}
/** A shared recording survives while any accepted operation still needs it. */
export async function syncVoiceRecordingExpiry(tx:Prisma.TransactionClient,userId:string,inputFileId:string|null,now=new Date()){
 if(!inputFileId)return;
 const file=await tx.uploadFile.findFirst({where:{id:inputFileId,userId,scope:'voice-recording',deletedAt:null,purgedAt:null},select:{id:true}});if(!file)return;
 const references=await tx.voiceTask.findMany({where:{userId,inputFileId,deletedAt:null,purgedAt:null},select:{status:true,expiresAt:true}});
 const protectedReference=references.some(row=>!VOICE_TERMINAL.includes(row.status)||!row.expiresAt);
 const expiresAt=protectedReference?null:new Date(Math.max(now.getTime(),...references.map(row=>row.expiresAt!.getTime())));
 await tx.uploadFile.updateMany({where:{id:inputFileId,userId,scope:'voice-recording',deletedAt:null,purgedAt:null},data:{expiresAt}});
}
