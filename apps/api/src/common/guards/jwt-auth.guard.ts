import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { AuthUser, authSession } from '../decorators/current-user.decorator';
import { BusinessException, ErrorCode } from '../exceptions/business.exception';
import { ALLOW_PENDING_ADMIN_VERIFICATION } from '../security/admin-verification';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const optional=this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY,[context.getHandler(),context.getClass()]);
    if(optional&&!context.switchToHttp().getRequest().headers.authorization)return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(err: any, user: AuthUser | false, _info: unknown, context: ExecutionContext): TUser {
    if (err || !user) {
      throw new UnauthorizedException({ code: 2001, message: '未登录或登录已过期' });
    }
    if (authSession(user)?.adminVerificationRequired &&
        !this.reflector.get<boolean>(ALLOW_PENDING_ADMIN_VERIFICATION, context.getHandler())) {
      throw new BusinessException(ErrorCode.ADMIN_VERIFICATION_REQUIRED, '请先完成管理员两步验证', 403);
    }
    return user as unknown as TUser;
  }
}
