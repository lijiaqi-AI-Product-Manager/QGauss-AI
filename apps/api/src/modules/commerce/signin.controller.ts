import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommerceGuard } from './commerce.guard';
import { SigninService } from './signin.service';

/** 每日签到 */
@Controller('signin')
@UseGuards(CommerceGuard)
export class SigninController {
  constructor(private readonly signin: SigninService) {}

  @Get('signinLog')
  log(@CurrentUser('id') userId: string) {
    return this.signin.log(userId);
  }

  @Post('sign')
  sign(@CurrentUser('id') userId: string, @Body() _body: Record<string, unknown>) {
    return this.signin.sign(userId);
  }
}
