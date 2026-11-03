import {Injectable} from '@nestjs/common';
import {MindmapOperation,Prisma} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {MindmapEndMutationDto,MindmapMutationDto,MindmapPageDto} from './mindmap.dto';
import {mindmapOutline} from './mindmap-outline';
import {assertMindmapReplay,lockMindmapOperation,mindmapConflict,mindmapHash,mindmapId,mindmapMissing} from './mindmap-operation';

@Injectable()
export class MindmapDocumentsService {
 constructor(private readonly prisma:PrismaService,private readonly rate:RateLimitService){}

 async list(userId:string,query:MindmapPageDto){
  const{page=1,pageSize=6,view='active',q=''}=query;
  const where:Prisma.MindmapDocumentWhereInput={userId,archivedAt:view==='trash'?{not:null}:null,...(q.trim()?{OR:[{title:{contains:q.trim()}},{outline:{contains:q.trim()}}]}:{})};
  return this.prisma.$transaction(async tx=>{const total=await tx.mindmapDocument.count({where}),items=await tx.mindmapDocument.findMany({where,select:{id:true,title:true,nodeCount:true,version:true,archivedAt:true,createdAt:true,updatedAt:true},orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize});return{items,total,page,pageSize};});
 }

 async get(userId:string,id:string){const row=await this.prisma.mindmapDocument.findFirst({where:{userId,id:mindmapId(id)}});if(!row)throw mindmapMissing();return row;}

 private async receipt(tx:Prisma.TransactionClient,row:MindmapOperation){
  return{requestKey:row.requestKey,kind:row.kind,state:row.state,documentId:row.documentId,version:row.documentVersion,
   document:row.documentId?await tx.mindmapDocument.findFirst({where:{id:row.documentId,userId:row.userId}}):null};
 }

 async operation(userId:string,requestKey:string){
  return this.prisma.$transaction(async tx=>{const row=await tx.mindmapOperation.findUnique({where:{userId_requestKey:{userId,requestKey:mindmapId(requestKey)}}});if(!row||row.kind==='generation')throw mindmapMissing();return this.receipt(tx,row);});
 }

 async mutate(userId:string,dto:MindmapMutationDto){
  const content=dto.kind==='create'||dto.kind==='edit'?mindmapOutline(dto.outline):null;
  const title=content?(dto.title?.trim()||content.title):undefined;
  const payload={kind:dto.kind,documentId:dto.kind==='create'?null:mindmapId(dto.documentId!),expectedVersion:dto.kind==='create'?null:dto.expectedVersion,title,outline:content?.outline};
  return this.prisma.$transaction(async tx=>{
   const locked=await lockMindmapOperation(tx,userId,dto.requestKey,dto.kind,mindmapHash(payload),'APPLIED',payload.documentId);
   if(!locked.inserted){assertMindmapReplay(locked.row,dto.kind,mindmapHash(payload));if(locked.row.state==='ENDED'&&locked.row.documentId!==payload.documentId)throw mindmapConflict();return this.receipt(tx,locked.row);}
   if(!this.rate.tryConsume('mindmap-document:'+userId,60))throw new BusinessException(ErrorCode.RATE_LIMITED,'保存得有些频繁，请稍后继续。',429);
   let document;
   if(dto.kind==='create')document=await tx.mindmapDocument.create({data:{userId,title:title!,outline:content!.outline,nodeCount:content!.nodeCount}});
   else{
    const current=await tx.mindmapDocument.findFirst({where:{id:payload.documentId!,userId}});if(!current)throw mindmapMissing();
    if(current.version!==dto.expectedVersion||current.version>=2147483647)throw mindmapConflict('这份内容已在其他地方更新，请先查看最新版本。');
    if(dto.kind==='edit'&&current.archivedAt||dto.kind==='archive'&&current.archivedAt||dto.kind==='restore'&&!current.archivedAt)throw mindmapConflict('这份内容的状态已经变化，请刷新后再继续。');
    const changed=await tx.mindmapDocument.updateMany({where:{id:current.id,userId,version:dto.expectedVersion},data:{version:{increment:1},...(dto.kind==='edit'?{title,outline:content!.outline,nodeCount:content!.nodeCount}:dto.kind==='archive'?{archivedAt:new Date()}:{archivedAt:null})}});
    if(!changed.count)throw mindmapConflict();document=await tx.mindmapDocument.findUniqueOrThrow({where:{id:current.id}});
   }
   const row=await tx.mindmapOperation.update({where:{id:locked.row.id},data:{documentId:document.id,documentVersion:document.version}});return this.receipt(tx,row);
  });
 }

 async end(userId:string,requestKey:string,dto:MindmapEndMutationDto){
  const documentId=dto.kind==='create'?null:mindmapId(dto.documentId!);
  return this.prisma.$transaction(async tx=>{
   const{row}=await lockMindmapOperation(tx,userId,requestKey,dto.kind,'','ENDED',documentId);
   if(row.kind!==dto.kind||row.documentId!==documentId&&dto.kind!=='create')throw mindmapConflict();
   return this.receipt(tx,row);
  });
 }
}
