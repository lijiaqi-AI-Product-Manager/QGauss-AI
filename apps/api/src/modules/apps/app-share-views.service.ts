import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {publicAppWhere} from './app-visibility';

const MAX_VIEWS=2147483647;
const RECEIPT_DAYS=7;
const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'应用分享不存在或已停止公开',404);
const invalid=()=>new BusinessException(ErrorCode.PARAM_INVALID,'分享浏览标识不正确',400);

@Injectable()
export class AppShareViewsService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(AppShareViewsService.name);
  private timer?:NodeJS.Timeout;
  private pruning?:Promise<number>;
  private closing=false;
  constructor(private readonly prisma:PrismaService,private readonly rate:RateLimitService){}

  async onModuleInit(){
    await this.prune();
    this.timer=setInterval(()=>{void this.prune().catch(()=>this.logger.warn('分享浏览回执等待清理'));},3600000);this.timer.unref?.();
  }
  async onModuleDestroy(){this.closing=true;if(this.timer)clearInterval(this.timer);await this.pruning?.catch(()=>{});}

  private token(value:unknown){if(typeof value!=='string'||!value||value.length>128)throw missing();return value;}
  private async published(client:Prisma.TransactionClient,token:string){
    const row=await client.app.findFirst({where:{AND:[publicAppWhere(),{OR:[{shareId:token},{id:token}]}]},select:{id:true,shareViewCount:true}});
    if(!row)throw missing();return row;
  }

  async read(token:unknown){return this.published(this.prisma,this.token(token));}

  async record(token:unknown,key:unknown,actor:string){
    const share=this.token(token);if(typeof key!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(key))throw invalid();
    if(this.closing)throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE,'分享统计正在更新，请稍后核对',503);
    if(!this.rate.tryConsume('app-share-visit:'+String(actor).slice(0,160),120))throw new BusinessException(ErrorCode.RATE_LIMITED,'分享浏览统计操作过于频繁，请稍后核对',429);
    const requestKey=key.toLowerCase();
    return this.prisma.$transaction(async tx=>{
      // Acquire the writer before checking visibility or a previous receipt.
      // A visit does not change the app's version, edit date or review history.
      await tx.$executeRaw`UPDATE "apps" SET "id"="id" WHERE "shareId"=${share} OR "id"=${share}`;
      const row=await this.published(tx,share),where={appId_requestKey:{appId:row.id,requestKey}};
      const previous=await tx.appShareVisit.findUnique({where});
      if(previous)return{...row,counted:false};
      await tx.appShareVisit.create({data:{appId:row.id,requestKey}});
      if(row.shareViewCount<MAX_VIEWS)await tx.$executeRaw`UPDATE "apps" SET "shareViewCount"="shareViewCount"+1 WHERE "id"=${row.id} AND "shareViewCount"<${MAX_VIEWS}`;
      const current=await tx.app.findUniqueOrThrow({where:{id:row.id},select:{id:true,shareViewCount:true}});
      return{...current,counted:row.shareViewCount<MAX_VIEWS};
    });
  }

  async prune(){
    if(this.closing)return 0;if(this.pruning)return this.pruning;
    this.pruning=this.prisma.$transaction(tx=>tx.appShareVisit.deleteMany({where:{createdAt:{lt:new Date(Date.now()-RECEIPT_DAYS*86400000)}}})).then(result=>result.count).finally(()=>{this.pruning=undefined;});
    return this.pruning;
  }
}
