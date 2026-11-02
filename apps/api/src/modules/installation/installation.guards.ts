import { CanActivate, ExecutionContext, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { INSTALLATION_ALLOWED } from '../../common/decorators/installation-allowed.decorator';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { InstallationService, isLoopbackAddress } from './installation.service';

export function secureInstallationRequest(req: Request) { return req.secure || isLoopbackAddress(req.ip); }

@Injectable()
export class InstallationGate implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly installation: InstallationService) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(INSTALLATION_ALLOWED, [context.getHandler(), context.getClass()])) return true;
    if (await this.installation.isRequired()) throw new ServiceUnavailableException('站点正在等待初始化，请由部署负责人完成安装');
    return true;
  }
}

@Injectable()
export class InstallationOwnerGuard implements CanActivate {
  constructor(private readonly installation: InstallationService, private readonly rateLimit: RateLimitService) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (!this.rateLimit.tryConsume('installation-owner:' + (req.ip || 'unknown'), 5, 15 * 60_000)) throw new HttpException('安装尝试过于频繁，请稍后再试', 429);
    this.installation.assertOwner(req.headers['x-qgauss-install-token'], secureInstallationRequest(req));
    return true;
  }
}
