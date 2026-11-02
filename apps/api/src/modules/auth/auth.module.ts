import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SettingsModule } from '../settings/settings.module';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtStrategy } from './jwt.strategy';
import { EmailVerificationService } from './email-verification.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), SettingsModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService, JwtStrategy, EmailVerificationService],
  exports: [AuthService],
})
export class AuthModule {}
