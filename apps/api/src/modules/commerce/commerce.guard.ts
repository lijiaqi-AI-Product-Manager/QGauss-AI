import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

/**
 * 商业化总开关。
 *
 * 关闭时所有商业接口返回 404 而不是 403 —— 不对外泄露"这里本来有个功能"。
 * 之所以用 Guard 而不是在每个 service 里判：路由级开关是最不容易漏的位置，
 * 将来新增商业路由只要挂上这个 Guard 就自动受控。
 */
@Injectable()
export class CommerceGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(_ctx: ExecutionContext): Promise<boolean> {
    const enabled = await this.settings.get<boolean>('commerce.enabled');
    if (!enabled) {
      throw new BusinessException(ErrorCode.COMMERCE_DISABLED, '页面不存在', 404);
    }
    return true;
  }
}
