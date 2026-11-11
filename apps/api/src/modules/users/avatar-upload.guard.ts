import {CanActivate,ExecutionContext,Injectable} from '@nestjs/common';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {AVATAR_MAX_BYTES} from './avatar-image';

@Injectable()
export class AvatarUploadGuard implements CanActivate{
 private total=0;private active=new Map<string,number>();
 constructor(private readonly rate:RateLimitService){}
 canActivate(context:ExecutionContext){
  const request=context.switchToHttp().getRequest(),response=context.switchToHttp().getResponse(),owner=request.user?.id;
  if(!owner)throw new BusinessException(ErrorCode.UNAUTHORIZED,'请先登录。',401);
  const length=request.headers['content-length'];
  if(length&&(!/^\d+$/.test(length)||Number(length)>AVATAR_MAX_BYTES+65536))throw new BusinessException(ErrorCode.PARAM_INVALID,'头像图片不能超过 12MB。',413);
  if(this.total>=4||(this.active.get(owner)||0)>=2||!this.rate.tryConsume('profile-avatar:'+owner,30))throw new BusinessException(ErrorCode.RATE_LIMITED,'头像正在准备中，请稍后再试。',429);
  this.total++;this.active.set(owner,(this.active.get(owner)||0)+1);let released=false;
  const release=()=>{if(released)return;released=true;this.total--;const left=(this.active.get(owner)||1)-1;if(left)this.active.set(owner,left);else this.active.delete(owner);};
  response.once('finish',release);response.once('close',release);request.once('aborted',release);return true;
 }
}
