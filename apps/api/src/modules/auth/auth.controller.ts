import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { IsEmail, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import * as svgCaptcha from 'svg-captcha';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailVerificationService } from './email-verification.service';
import { ConfirmEmailDto, RegistrationCodeDto } from './dto/email-verification.dto';

class ForgotPasswordDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;
}

class ResetPasswordDto {
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(16, 128)
  token: string;

  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(8, 32, { message: '新密码需 8-32 位' })
  newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly captcha: CaptchaService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  private meta(req: Request) {
    return {
      ip: req.ip ?? req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
  }

  @Public()
  @Get('captcha')
  getCaptcha() {
    const cap = svgCaptcha.create({
      size: 4,
      noise: 2,
      color: true,
      ignoreChars: '0o1iIlL',
      background: '#f5f7fa',
    });
    const id = randomUUID();
    this.captcha.save(id, cap.text);
    return { captchaId: id, svg: cap.data };
  }

  @Public()
  @Get('registration-policy')
  registrationPolicy(){return this.emailVerification.policy();}

  @Public()
  @Post('registration-code')
  registrationCode(@Body() dto:RegistrationCodeDto,@Req() req:Request){return this.emailVerification.requestRegistration(dto,this.meta(req).ip);}

  @Post('email-verification/send')
  requestEmailVerification(@CurrentUser() user:AuthUser,@Req() req:Request){return this.emailVerification.requestAccount(user.id,this.meta(req).ip);}

  @Post('email-verification/confirm')
  confirmEmail(@CurrentUser() user:AuthUser,@Body() dto:ConfirmEmailDto,@Req() req:Request){return this.emailVerification.confirmAccount(user.id,dto.challengeId,dto.code,this.meta(req).ip);}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, this.meta(req));
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.meta(req));
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.meta(req));
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.auth.forgotPassword(dto.email, this.meta(req));
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto.token, dto.newPassword, this.meta(req));
  }

  @Public()
  @Post('logout')
  logout(@Body() dto: LogoutDto, @Req() req: Request) {
    const accessToken = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];
    return this.auth.logout(dto?.refreshToken, this.meta(req), accessToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
