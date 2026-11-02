import { Body, Controller, Get, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { InstallationAllowed } from '../../common/decorators/installation-allowed.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { InstallationOwnerGuard, secureInstallationRequest } from './installation.guards';
import { InitializeDto } from './installation.dto';
import { InstallationService } from './installation.service';

@Controller('installation')
export class InstallationController {
  constructor(private readonly installation: InstallationService, private readonly rateLimit: RateLimitService) {}

  @Public()
  @InstallationAllowed()
  @Get('status')
  status(@Req() req: Request) {
    if (!this.rateLimit.tryConsume('installation-status:' + (req.ip || 'unknown'), 120)) throw new HttpException('请稍后重新检查', 429);
    return this.installation.status(secureInstallationRequest(req));
  }

  @Public()
  @InstallationAllowed()
  @UseGuards(InstallationOwnerGuard)
  @Post()
  initialize(@Body() dto: InitializeDto) { return this.installation.initialize(dto); }

  @Roles('ADMIN')
  @Get('readiness')
  readiness(@CurrentUser() user: AuthUser) { return this.installation.readiness(user.id); }

  @Roles('ADMIN')
  @Post('demo')
  enableDemo() { return this.installation.enableDemo(); }
}
