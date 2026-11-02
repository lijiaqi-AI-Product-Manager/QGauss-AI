import { Injectable } from '@nestjs/common';
import { MjTask } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { StorageService } from '../storage/storage.service';
import { mjFiles } from './mj-accounting.service';
const absent=()=>new BusinessException(ErrorCode.NOT_FOUND,'MJ 作品文件暂不可用',404);
interface Ticket {v:1;purpose:'mj-playback';taskId:string;fileId:string;index:number;actor:string;version:number;expires:number}
@Injectable()
export class MjMediaService {
  private readonly prefix='/'+(process.env.API_PREFIX||'api').replace(/^\/+|\/+$/g,'');
  constructor(private readonly prisma:PrismaService,private readonly storage:StorageService,private readonly box:SecretBox,private readonly rate:RateLimitService){}
  private async actor(id:string){const user=await this.prisma.user.findFirst({where:{id,status:'ACTIVE',deletedAt:null},select:{id:true,tokenVersion:true}});if(!user)throw absent();return user;}
  private async file(task:MjTask,index:number,poster=false){if(!Number.isInteger(index)||index<0||index>3||task.deletedAt||task.status!=='SUCCESS')throw absent();await this.actor(task.userId);const item=mjFiles(task.resultJson)?.items[index],fileId=poster?item?.posterFileId:item?.fileId;if(!item||!fileId)throw absent();const file=await this.prisma.uploadFile.findFirst({where:{id:fileId,userId:task.userId,deletedAt:null}});if(!file)throw absent();if(poster?file.scope!=='mj-poster'||!/^image\/(jpeg|png|webp)$/.test(file.mime):file.sha256!==item.sha256||file.size!==item.size||file.mime!==item.mime||(item.kind==='video'?file.scope!=='video'||file.mime!=='video/mp4':file.scope!=='mj-image'||!/^image\/(jpeg|png|webp)$/.test(file.mime)))throw absent();
    const extension=poster?'jpg':item.kind==='video'?'mp4':file.mime==='image/jpeg'?'jpg':file.mime==='image/webp'?'webp':'png';return{owner:task.userId,fileId,size:file.size,mime:file.mime,filename:'QGauss-creation-'+task.id.slice(-10)+'-'+(index+1)+'.'+extension};}
  async still(userId:string,task:MjTask,index:number,poster=false){await this.actor(userId);if(task.userId!==userId&&!task.published)throw absent();if(!poster&&mjFiles(task.resultJson)?.items[index]?.kind!=='image')throw absent();return this.file(task,index,poster);}
  async playback(userId:string,task:MjTask,index:number){if(task.userId!==userId&&!task.published||mjFiles(task.resultJson)?.items[index]?.kind!=='video')throw absent();const file=await this.file(task,index),actor=await this.actor(userId),expires=Date.now()+5*60000;const ticket=this.box.encrypt(JSON.stringify({v:1,purpose:'mj-playback',taskId:task.id,fileId:file.fileId,index,actor:userId,version:actor.tokenVersion,expires} satisfies Ticket));const videoUrl=this.prefix+'/mj/media/'+encodeURIComponent(task.id)+'/'+index+'?ticket='+encodeURIComponent(ticket);return{videoUrl,downloadUrl:videoUrl+'&download=1',expiresAt:new Date(expires).toISOString()};}
  async ticket(id:string,index:number,raw:unknown,address:string){if(!this.rate.tryConsume('mj-media:'+address,240))throw new BusinessException(ErrorCode.RATE_LIMITED,'作品读取过于频繁，请稍后再试',429);let t:Ticket;try{if(typeof raw!=='string'||raw.length<40||raw.length>3000)throw absent();t=JSON.parse(this.box.decrypt(raw));if(t.v!==1||t.purpose!=='mj-playback'||t.taskId!==id||t.index!==index||typeof t.actor!=='string'||typeof t.fileId!=='string'||!Number.isInteger(t.version)||!Number.isSafeInteger(t.expires)||t.expires<Date.now()||t.expires>Date.now()+6*60000)throw absent();}catch{throw absent();}
    const actor=await this.actor(t.actor);if(actor.tokenVersion!==t.version)throw absent();const task=await this.prisma.mjTask.findUnique({where:{id}});if(!task||task.userId!==actor.id&&!task.published)throw absent();const file=await this.file(task,index);if(file.fileId!==t.fileId||file.mime!=='video/mp4')throw absent();return file;
  }
}
