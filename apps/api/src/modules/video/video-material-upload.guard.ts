import {CanActivate,ExecutionContext,Injectable} from '@nestjs/common';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
@Injectable()
export class VideoMaterialUploadGuard implements CanActivate{
 private readonly active=new Map<string,number>();private total=0;
 constructor(private readonly rate:RateLimitService){}
 canActivate(context:ExecutionContext){const request=context.switchToHttp().getRequest(),response=context.switchToHttp().getResponse(),owner=request.user?.id;
  if(!owner)throw new BusinessException(ErrorCode.UNAUTHORIZED,'请先登录',401);
  const length=request.headers['content-length'];if(length&&(!/^\d+$/.test(length)||Number(length)>96*1024*1024+65536))throw new BusinessException(ErrorCode.PARAM_INVALID,'单份素材超过大小限制',413);
  if(this.total>=4||(this.active.get(owner)||0)>=2||!this.rate.tryConsume('video-material-upload:'+owner,60))throw new BusinessException(ErrorCode.RATE_LIMITED,'素材正在准备中，请稍后再加入',429);
  this.total++;this.active.set(owner,(this.active.get(owner)||0)+1);let released=false;
  const release=()=>{if(released)return;released=true;this.total--;const count=(this.active.get(owner)||1)-1;if(count)this.active.set(owner,count);else this.active.delete(owner);};response.once('finish',release);response.once('close',release);request.once('aborted',release);return true;
 }
}
