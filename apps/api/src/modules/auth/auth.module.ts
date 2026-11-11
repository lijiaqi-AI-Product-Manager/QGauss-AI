import {MiddlewareConsumer,Module,NestModule,RequestMethod} from '@nestjs/common';
import {text} from 'express';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SettingsModule } from '../settings/settings.module';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtStrategy } from './jwt.strategy';
import { EmailVerificationService } from './email-verification.service';
import {PhoneDeliveryService} from './phone-delivery.service';
import {PhoneAccountService} from './phone-account.service';
import {PhoneAuthController,PhoneIdentityController} from './phone.controller';
import {ExternalAuthService} from './external-auth.service';
import {ExternalProviderService} from './external-provider.service';
import {ExternalAuthController,ExternalIdentityController} from './external.controller';

@Module({
  imports: [PassportModule, JwtModule.register({}), SettingsModule, MailModule],
  controllers: [AuthController,PhoneAuthController,PhoneIdentityController,ExternalAuthController,ExternalIdentityController],
  providers: [AuthService, CaptchaService, JwtStrategy, EmailVerificationService,PhoneDeliveryService,PhoneAccountService,ExternalAuthService,ExternalProviderService],
  exports: [AuthService],
})
export class AuthModule implements NestModule{
 configure(consumer:MiddlewareConsumer){consumer.apply(text({type:['text/xml','application/xml'],limit:'64kb'})).forRoutes({path:'auth/external/notify',method:RequestMethod.POST});}
}
