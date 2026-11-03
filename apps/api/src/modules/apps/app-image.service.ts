import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import sharp from 'sharp';
import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {StorageService,IncomingFile} from '../storage/storage.service';
import {detectType} from '../../common/storage/file-type';
import {appVisibleTo} from './app-visibility';
import {APP_IMAGE_MAX_BYTES,APP_IMAGE_MAX_PIXELS,APP_IMAGE_PREFIX,APP_IMAGE_SCOPE,appImageId,appImageRequestId} from './app-image';

const bad=(message:string,status=400)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status);
const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'这张应用图片当前不可用',404);
const DAY=24*60*60*1000;

/** Only the processed square is retained. Publication is always decided by the app. */
@Injectable()
export class AppImageService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(AppImageService.name);
  private timer?:NodeJS.Timeout;
  private sweeping=false;
  constructor(private readonly prisma:PrismaService,private readonly storage:StorageService) {}
  onModuleInit(){this.timer=setInterval(()=>void this.cleanup().catch(()=>this.logger.warn('应用临时图片清理稍后重试')),10*60*1000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private id(userId:string,key:unknown){const id=appImageRequestId(userId,key);if(!id)throw bad('图片保存标识不正确');return id;}
  private view(row:{id:string;createdAt:Date;expiresAt:Date|null}){return{icon:APP_IMAGE_PREFIX+row.id,createdAt:row.createdAt,expiresAt:row.expiresAt};}
  async byRequest(userId:string,key:unknown){const row=await this.prisma.uploadFile.findFirst({where:{id:this.id(userId,key),userId,scope:APP_IMAGE_SCOPE,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});if(!row)throw missing();return this.view(row);}
  async upload(userId:string,key:unknown,cropText:unknown,file:IncomingFile){
    const id=this.id(userId,key);
    if(!file?.buffer?.length||file.buffer.length>APP_IMAGE_MAX_BYTES)throw bad('请选择不超过 5MB 的 PNG、JPEG 或 WebP 图片',413);
    const type=detectType(file.buffer);
    if(!type||!['image/png','image/jpeg','image/webp'].includes(type.mime))throw bad('请使用静态 PNG、JPEG 或 WebP 图片');
    if(type.mime==='image/png')for(let pos=8;pos+12<=file.buffer.length;){const length=file.buffer.readUInt32BE(pos);if(length>file.buffer.length-pos-12)break;if(file.buffer.toString('ascii',pos+4,pos+8)==='acTL')throw bad('请使用静态 PNG、JPEG 或 WebP 图片');pos+=length+12;}
    let crop:any;try{crop=JSON.parse(typeof cropText==='string'?cropText:'');}catch{throw bad('请重新确认图片裁切范围');}
    const keys=['x','y','size','width','height'];
    if(!crop||typeof crop!=='object'||Array.isArray(crop)||Object.keys(crop).length!==keys.length||!keys.every(k=>Number.isSafeInteger(crop[k]))||crop.x<0||crop.y<0||crop.size<1||crop.width<1||crop.height<1)throw bad('请重新确认图片裁切范围');
    let output:Buffer;
    try{
      const image=sharp(file.buffer,{limitInputPixels:APP_IMAGE_MAX_PIXELS,failOn:'warning'}),metadata=await image.metadata();
      if(!['png','jpeg','webp'].includes(metadata.format||'')||(metadata.pages||1)!==1)throw bad('请使用静态 PNG、JPEG 或 WebP 图片');
      const swapped=[5,6,7,8].includes(metadata.orientation||1),width=swapped?metadata.height:metadata.width,height=swapped?metadata.width:metadata.height;
      if(width!==crop.width||height!==crop.height||crop.x+crop.size>width!||crop.y+crop.size>height!)throw bad('图片尺寸已变化，请重新选择裁切范围');
      output=await image.autoOrient().extract({left:crop.x,top:crop.y,width:crop.size,height:crop.size}).resize(512,512,{fit:'fill'}).png({compressionLevel:8}).toBuffer();
    }catch(error){if(error instanceof BusinessException)throw error;throw bad('图片无法完整读取，请换一张静态图片');}
    const row=await this.storage.saveAppImage(userId,id,output);
    return this.view(row);
  }
  async privateImage(userId:string,id:string){
    if(!appImageId(APP_IMAGE_PREFIX+id))throw missing();
    const row=await this.prisma.uploadFile.findFirst({where:{id,userId,scope:APP_IMAGE_SCOPE,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});
    if(!row)throw missing();return this.storage.read(id,userId,'USER');
  }
  private async visible(id:string,imageId:unknown,user?:{id:string;role:string}){
    const row=await this.prisma.app.findUnique({where:{id},include:{owner:{select:{status:true,deletedAt:true}}}});
    if(!row||appImageId(row.icon)!==imageId)throw missing();
    const owner=row.origin==='USER'&&row.ownerId===user?.id;
    const review=['ADMIN','SUPER'].includes(user?.role||'')&&row.origin==='USER'&&!row.deletedAt&&['PENDING','APPROVED','REJECTED'].includes(row.reviewStatus);
    if(!owner&&!review&&!appVisibleTo(row,user?.id||''))throw missing();
    const file=await this.prisma.uploadFile.findFirst({where:{id:String(imageId),scope:APP_IMAGE_SCOPE,userId:row.ownerId||row.createdBy||'',deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});
    if(!file)throw missing();return{app:row,file};
  }
  async appImage(id:string,imageId:unknown,user?:{id:string;role:string}){
    if(typeof imageId!=='string'||!appImageId(APP_IMAGE_PREFIX+imageId))throw missing();
    const before=await this.visible(id,imageId,user),result=await this.storage.read(before.file.id,before.file.userId,'USER');
    const after=await this.visible(id,imageId,user);if(after.app.version!==before.app.version)throw missing();return result;
  }
  async cleanup(){
    if(this.sweeping)return;this.sweeping=true;
    try{
      const now=new Date(),expires=new Date(now.getTime()+DAY);
      // Bound images are kept while any active or archived app still refers to them.
      await this.prisma.$executeRaw`UPDATE "upload_files" SET "expiresAt"=${expires} WHERE "scope"=${APP_IMAGE_SCOPE} AND "deletedAt" IS NULL AND "expiresAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "icon"=${APP_IMAGE_PREFIX} || "upload_files"."id")`;
      const rows=await this.prisma.uploadFile.findMany({where:{scope:APP_IMAGE_SCOPE,purgedAt:null,OR:[{deletedAt:{not:null}},{expiresAt:{lte:now}}]},take:100});
      for(const row of rows){const changed=await this.prisma.uploadFile.updateMany({where:{id:row.id,scope:APP_IMAGE_SCOPE,purgedAt:null,OR:[{deletedAt:{not:null}},{expiresAt:{lte:now}}]},data:{deletedAt:row.deletedAt||now}});if(changed.count)await this.storage.purgeAppImage(row.id,row.userId).catch(()=>this.logger.warn('一张临时应用图片等待清理'));}
    }finally{this.sweeping=false;}
  }
}
