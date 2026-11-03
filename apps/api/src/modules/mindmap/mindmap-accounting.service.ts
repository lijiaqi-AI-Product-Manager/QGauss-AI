import {Injectable} from '@nestjs/common';
import {PrismaService} from '../../common/prisma/prisma.service';
import {LedgerService} from '../commerce/ledger.service';
import {mindmapGeneratedOutline} from './mindmap-outline';

@Injectable()
export class MindmapAccountingService {
 constructor(private readonly prisma:PrismaService,private readonly ledger:LedgerService){}

 async stage(id:string,data:{outline:string;title:string;promptTokens:number;completionTokens:number;costMicros:number;estimated:boolean}){
  const parsed=mindmapGeneratedOutline(data.outline);
  return(await this.prisma.mindmapGeneration.updateMany({where:{id,status:'RUNNING'},data:{...data,outline:parsed.outline,status:'SETTLING'}})).count>0;
 }

 async complete(id:string){
  return this.prisma.$transaction(async tx=>{
   const claimed=await tx.mindmapGeneration.updateMany({where:{id,status:'SETTLING'},data:{status:'COMPLETED'}});if(!claimed.count)return false;
   const row=await tx.mindmapGeneration.findUniqueOrThrow({where:{id}});mindmapGeneratedOutline(row.outline);
   let returnedAmount=0,expiredAmount=0;
   if(row.reservedAmount){const settled=await this.ledger.settleCountReservationTx(tx,id,row.reservedAmount);this.assertReservation(row,settled);returnedAmount=settled.returnedAmount;expiredAmount=settled.expiredAmount;}
   const usage=await tx.usageRecord.create({data:{userId:row.userId,kind:'mindmap',modelName:row.modelName,channelId:row.channelId,promptTokens:row.promptTokens,completionTokens:row.completionTokens,priceInPerM:row.priceInPerM,priceOutPerM:row.priceOutPerM,costMicros:row.costMicros,estimated:row.estimated}});
   await tx.mindmapGeneration.update({where:{id},data:{usageId:usage.id,finishedAt:new Date(),chargedAmount:row.reservedAmount,returnedAmount,expiredAmount,billingState:row.reservedAmount?'SETTLED':'FREE',errorCode:null,errorMessage:null}});return true;
  });
 }

 async stop(id:string,status:'FAILED'|'CANCELED',errorCode:string,errorMessage:string){
  return this.prisma.$transaction(async tx=>{
   const claimed=await tx.mindmapGeneration.updateMany({where:{id,status:{in:['QUEUED','RUNNING']}},data:{status,errorCode,errorMessage,finishedAt:new Date()}});if(!claimed.count)return false;
   const row=await tx.mindmapGeneration.findUniqueOrThrow({where:{id}});
   if(row.reservedAmount){const settled=await this.ledger.settleCountReservationTx(tx,id,0);this.assertReservation(row,settled);await tx.mindmapGeneration.update({where:{id},data:{billingState:'RELEASED',returnedAmount:settled.returnedAmount,expiredAmount:settled.expiredAmount}});}return true;
  });
 }

 private assertReservation(row:{userId:string;pool:string;reservedAmount:number},settled:{userId:string;pool:string;amount:number;bizType:string}){
  if(row.userId!==settled.userId||row.pool!==settled.pool||row.reservedAmount!==settled.amount||settled.bizType!=='mindmap')throw new Error('导图任务与预留次数不一致');
 }
}
