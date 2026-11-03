import {CanActivate,ExecutionContext,Injectable} from '@nestjs/common';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {APP_IMAGE_MAX_BYTES} from './app-image';

@Injectable()
export class AppImageUploadGuard implements CanActivate {
  private readonly active = new Map<string,number>();
  private total = 0;
  constructor(private readonly rate:RateLimitService) {}
  canActivate(context:ExecutionContext) {
    const req=context.switchToHttp().getRequest(), res=context.switchToHttp().getResponse(), owner=req.user?.id;
    if(!owner) throw new BusinessException(ErrorCode.UNAUTHORIZED,'请先登录',401);
    const length=req.headers['content-length'];
    if(length && (!/^\d+$/.test(length)||Number(length)>APP_IMAGE_MAX_BYTES+65536)) throw new BusinessException(ErrorCode.PARAM_INVALID,'图片不能超过 5MB',413);
    if(this.total>=4||(this.active.get(owner)||0)>=2||!this.rate.tryConsume('app-image-upload:'+owner,20)) throw new BusinessException(ErrorCode.RATE_LIMITED,'图片正在准备中，请稍后再试',429);
    this.total++;this.active.set(owner,(this.active.get(owner)||0)+1);let released=false;
    const release=()=>{if(released)return;released=true;this.total--;const left=(this.active.get(owner)||1)-1;if(left)this.active.set(owner,left);else this.active.delete(owner);};
    res.once('finish',release);res.once('close',release);req.once('aborted',release);return true;
  }
}
