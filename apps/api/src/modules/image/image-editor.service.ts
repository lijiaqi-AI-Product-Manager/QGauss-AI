import {Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PrismaService} from '../../common/prisma/prisma.service';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {StorageService} from '../storage/storage.service';
import {prepareImageInputs} from './image-inputs';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'这张图片不存在或已移除，请重新选择。',404);

@Injectable()
export class ImageEditorService {
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageService,private readonly rate:RateLimitService){}
 private async own(userId:string,id:string){if(typeof id!=='string'||!ID.test(id))throw new BusinessException(ErrorCode.PARAM_INVALID,'图片标识无效。',400);const row=await this.prisma.uploadFile.findFirst({where:{id,userId,deletedAt:null,purgedAt:null}});if(!row||row.expiresAt&&row.expiresAt.getTime()<=Date.now())throw missing();return row;}
 private limit(userId:string,kind:string,amount:number){if(!this.rate.tryConsume('image-editor:'+kind+':'+userId,amount))throw new BusinessException(ErrorCode.RATE_LIMITED,'图片读取较频繁，请稍后再试。',429);}

 async inputs(userId:string,sourceId:string,maskId?:string){
  this.limit(userId,'inputs',30);const source=await this.own(userId,sourceId);if(maskId)await this.own(userId,maskId);
  const parsed=await prepareImageInputs(this.storage,userId,[sourceId],maskId);await this.own(userId,sourceId);if(maskId)await this.own(userId,maskId);
  const primary=parsed.snapshot.references[0],url=(id:string)=>'/api/image/editor/files/'+id;
  return{version:1,source:{id:sourceId,width:primary.width,height:primary.height,name:source.filename,mime:source.mime,url:url(sourceId)},mask:parsed.snapshot.mask?{id:maskId!,width:primary.width,height:primary.height,url:url(maskId!)}:null};
 }

 async file(userId:string,id:string){
  this.limit(userId,'file',60);const row=await this.own(userId,id),parsed=await prepareImageInputs(this.storage,userId,[id]);
  let file:Awaited<ReturnType<StorageService['read']>>;try{file=await this.storage.read(id,userId,'USER');}catch{throw missing();}
  await this.own(userId,id);if(createHash('sha256').update(file.buffer).digest('hex')!==parsed.snapshot.references[0].sha256)throw new BusinessException(ErrorCode.PARAM_INVALID,'图片内容已变化，请重新选择。',409);
  return{buffer:file.buffer,mime:file.mime,filename:row.filename};
 }
}
