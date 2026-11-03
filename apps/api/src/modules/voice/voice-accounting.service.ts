import { Injectable } from '@nestjs/common';
import { Prisma, VoiceTask } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerService, isPool } from '../commerce/ledger.service';
import {syncVoiceRecordingExpiry,voiceExpiry} from './voice-retention';

export type VoiceResult={id:string;mime:string};
export function voiceResults(raw:string):VoiceResult[]{try{const data=JSON.parse(raw);return Array.isArray(data)&&data.every(row=>row&&typeof row.id==='string'&&row.mime==='audio/mpeg')?data:[];}catch{return[];}}

@Injectable()
export class VoiceAccountingService {
  constructor(private readonly prisma:PrismaService,private readonly ledger:LedgerService){}
  async reserveTx(tx:Prisma.TransactionClient,task:VoiceTask,cost:number){
    if(!isPool(task.pool))throw new Error('语音次数池无效');
    if(cost)await this.ledger.reserveCountTx(tx,task.userId,{pool:task.pool,amount:cost,refId:task.id,bizType:'voice',model:task.model,modelName:task.kind==='speech'?task.sample?'音色试听':task.messageId?'回答朗读':'文字配音':'录音转写'});
    return tx.voiceTask.update({where:{id:task.id},data:{reservedAmount:cost,billingState:cost?'RESERVED':'FREE'}});
  }
  async stage(id:string,transcript:string,results:VoiceResult[]){
    const changed=await this.prisma.voiceTask.updateMany({where:{id,status:'RUNNING'},data:{status:'SETTLING',progress:95,transcript,resultJson:JSON.stringify(results)}});return changed.count>0;
  }
  async complete(id:string){
    return this.prisma.$transaction(async tx=>{
      const claimed=await tx.voiceTask.updateMany({where:{id,status:'SETTLING'},data:{status:'COMPLETED'}});if(!claimed.count)return false;
      const row=await tx.voiceTask.findUniqueOrThrow({where:{id}}),results=voiceResults(row.resultJson);
      if(row.kind==='speech'&&(results.length!==row.segmentCount||row.completedSegments!==row.segmentCount)||row.kind==='transcription'&&!row.transcript.trim())throw new Error('语音结果尚未完整保存');
      let returnedAmount=0,expiredAmount=0;
      if(row.reservedAmount){const settled=await this.ledger.settleCountReservationTx(tx,id,row.reservedAmount);if(settled.userId!==row.userId||settled.pool!==row.pool||settled.amount!==row.reservedAmount||settled.bizType!=='voice')throw new Error('语音结果与次数预留不一致');returnedAmount=settled.returnedAmount;expiredAmount=settled.expiredAmount;}
      const finishedAt=new Date(),expiresAt=voiceExpiry(row.retentionDays,finishedAt);
      await tx.voiceTask.update({where:{id},data:{progress:100,finishedAt,expiresAt,label:row.label||(row.kind==='transcription'?row.transcript.replace(/\s+/g,' ').slice(0,120):''),chargedAmount:row.reservedAmount,returnedAmount,expiredAmount,billingState:row.reservedAmount?'SETTLED':'FREE',errorCode:null,errorMessage:null}});
      if(results.length)await tx.uploadFile.updateMany({where:{id:{in:results.map(file=>file.id)},userId:row.userId,scope:'voice-result',deletedAt:null,purgedAt:null},data:{expiresAt}});
      await syncVoiceRecordingExpiry(tx,row.userId,row.inputFileId,finishedAt);return true;
    });
  }
  async stop(id:string,status:'FAILED'|'CANCELED',code:string,message:string){
    return this.prisma.$transaction(async tx=>{
      const changed=await tx.voiceTask.updateMany({where:{id,status:{in:['QUEUED','RUNNING']}},data:{status,errorCode:code,errorMessage:message,finishedAt:new Date()}});if(!changed.count)return false;
      const row=await tx.voiceTask.findUniqueOrThrow({where:{id}});if(row.reservedAmount){const settled=await this.ledger.settleCountReservationTx(tx,id,0);if(settled.userId!==row.userId||settled.pool!==row.pool||settled.amount!==row.reservedAmount||settled.bizType!=='voice')throw new Error('语音次数预留不一致');await tx.voiceTask.update({where:{id},data:{billingState:'RELEASED',returnedAmount:settled.returnedAmount,expiredAmount:settled.expiredAmount}});}
      await tx.voiceTask.update({where:{id},data:{expiresAt:voiceExpiry(row.retentionDays,row.finishedAt!)}});await syncVoiceRecordingExpiry(tx,row.userId,row.inputFileId,row.finishedAt!);return true;
    });
  }
}
