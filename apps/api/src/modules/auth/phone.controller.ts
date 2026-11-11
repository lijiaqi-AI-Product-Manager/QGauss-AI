import {Body,CallHandler,Controller,ExecutionContext,Get,NestInterceptor,Param,Post,Req,UseInterceptors} from '@nestjs/common';
import type {Request,Response} from 'express';
import {Public} from '../../common/decorators/public.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {AuthService} from './auth.service';
import {PhoneDeliveryService} from './phone-delivery.service';
import {PhoneAccountService} from './phone-account.service';
import {phoneBad,phoneLoginInput} from './phone-input';

class PhoneResponseHeaders implements NestInterceptor {
  intercept(context:ExecutionContext,next:CallHandler){context.switchToHttp().getResponse<Response>().setHeader('Cache-Control','no-store');return next.handle();}
}

@Controller('auth/phone')
@UseInterceptors(new PhoneResponseHeaders())
export class PhoneAuthController {
  constructor(private readonly delivery:PhoneDeliveryService,private readonly accounts:PhoneAccountService,private readonly auth:AuthService){}
  @Public() @Get('policy') policy(){return this.delivery.policy();}
  @Roles('ADMIN') @Get('configuration') configuration(){return this.delivery.configurationSummary();}
  @Public() @Post('login') async login(@Body() input:unknown,@Req() req:Request){const body=phoneLoginInput(input);if(!(await this.delivery.policy()).passwordEnabled)throw phoneBad('手机密码登录暂未开放，请使用其他登录方式。');return this.auth.loginByPhone(body.phone,body.password,{ip:req.ip,userAgent:req.headers['user-agent']});}
  @Public() @Post('requests/:key') request(@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.delivery.request(key,input,{ip:req.ip});}
  @Public() @Get('requests/:key') readRequest(@Param('key') key:string){return this.delivery.read(key);}
  @Public() @Post('requests/:key/close') closeRequest(@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.delivery.close(key,input,{ip:req.ip});}
  @Public() @Post('actions/:key') action(@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.accounts.apply(key,input,{ip:req.ip});}
  @Public() @Get('actions/:key') readAction(@Param('key') key:string){return this.accounts.read(key);}
  @Public() @Post('actions/:key/close') closeAction(@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.accounts.close(key,input,{ip:req.ip});}
}

@Controller('users/me/phone')
@UseInterceptors(new PhoneResponseHeaders())
export class PhoneIdentityController {
  constructor(private readonly delivery:PhoneDeliveryService,private readonly accounts:PhoneAccountService){}
  @Get() identity(@CurrentUser() user:AuthUser){return this.accounts.identity(user);}
  @Post('requests/:key') request(@CurrentUser() user:AuthUser,@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.delivery.request(key,input,{ip:req.ip},user);}
  @Get('requests/:key') readRequest(@CurrentUser() user:AuthUser,@Param('key') key:string){return this.delivery.read(key,user);}
  @Post('requests/:key/close') closeRequest(@CurrentUser() user:AuthUser,@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.delivery.close(key,input,{ip:req.ip},user);}
  @Post('actions/:key') action(@CurrentUser() user:AuthUser,@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.accounts.apply(key,input,{ip:req.ip},user);}
  @Get('actions/:key') readAction(@CurrentUser() user:AuthUser,@Param('key') key:string){return this.accounts.read(key,user);}
  @Post('actions/:key/close') closeAction(@CurrentUser() user:AuthUser,@Param('key') key:string,@Body() input:unknown,@Req() req:Request){return this.accounts.close(key,input,{ip:req.ip},user);}
}
