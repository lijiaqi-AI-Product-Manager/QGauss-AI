import { Body, Controller, Get, Header, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowPendingAdminVerification } from '../../common/security/admin-verification';
import { AdminVerificationService } from './admin-verification.service';

@Controller('auth/admin-verification')
export class AdminVerificationController {
  constructor(private readonly verification: AdminVerificationService) {}

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(@CurrentUser() user: AuthUser) {
    return this.verification.status(user);
  }

  @Post('begin')
  @Header('Cache-Control', 'private, no-store')
  begin(@CurrentUser() user: AuthUser, @Body() input: Record<string, unknown>) {
    return this.verification.begin(user, input);
  }

  @Post('enable')
  @Header('Cache-Control', 'private, no-store')
  enable(@CurrentUser() user: AuthUser, @Body() input: Record<string, unknown>, @Req() req: Request) {
    return this.verification.enable(user, input, this.meta(req));
  }

  @Post('verify')
  @AllowPendingAdminVerification()
  @Header('Cache-Control', 'private, no-store')
  verify(@CurrentUser() user: AuthUser, @Body() input: Record<string, unknown>, @Req() req: Request) {
    return this.verification.verify(user, input, this.meta(req));
  }

  @Post('recovery-codes')
  @Header('Cache-Control', 'private, no-store')
  recoveryCodes(@CurrentUser() user: AuthUser, @Body() input: Record<string, unknown>) {
    return this.verification.rotateRecoveryCodes(user, input);
  }

  @Post('disable')
  @Header('Cache-Control', 'private, no-store')
  disable(@CurrentUser() user: AuthUser, @Body() input: Record<string, unknown>, @Req() req: Request) {
    return this.verification.disable(user, input, this.meta(req));
  }
}
