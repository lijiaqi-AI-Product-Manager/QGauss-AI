import {Body,CallHandler,Controller,ExecutionContext,Get,NestInterceptor,Param,Post,Query,Req,Res,UseInterceptors} from '@nestjs/common';
import type {Request,Response} from 'express';
import {Public} from '../../common/decorators/public.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {ExternalAuthService} from './external-auth.service';
import {externalCookieName} from './external-input';
class ExternalResponseHeaders implements NestInterceptor{intercept(context:ExecutionContext,next:CallHandler){const response=context.switchToHttp().getResponse<Response>();response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');return next.handle();}}
const meta=(req:Request)=>({ip:req.ip,userAgent:req.headers['user-agent']}),proof=(req:Request)=>req.headers['x-qgauss-identity'];
@Controller('auth/external')
@UseInterceptors(new ExternalResponseHeaders())
export class ExternalAuthController{
 constructor(private readonly external:ExternalAuthService){}
 @Public() @Get('policy') policy(){return this.external.policy();}
 @Roles('ADMIN') @Get('configuration') configuration(){return this.external.configurationSummary();}
 @Public() @Post('requests/:key') async create(@Param('key') key:string,@Body() body:unknown,@Req() req:Request,@Res({passthrough:true}) response:Response){const result=await this.external.create(key,proof(req),body,meta(req));if(result.method==='browser'&&result.status==='waiting')response.cookie(externalCookieName(result.requestKey),proof(req),this.external.browserCookieOptions());return result;}
 @Public() @Get('requests/:key') read(@Param('key') key:string,@Req() req:Request){return this.external.read(key,proof(req),meta(req));}
 @Public() @Post('requests/:key/complete') complete(@Param('key') key:string,@Body() body:unknown,@Req() req:Request){return this.external.complete(key,proof(req),body,meta(req));}
 @Public() @Post('requests/:key/exchange') exchange(@Param('key') key:string,@Body() body:unknown,@Req() req:Request){return this.external.exchange(key,proof(req),body,meta(req));}
 @Public() @Post('requests/:key/acknowledge') acknowledge(@Param('key') key:string,@Body() body:unknown,@Req() req:Request){return this.external.acknowledge(key,proof(req),body,meta(req));}
 @Public() @Post('requests/:key/close') close(@Param('key') key:string,@Body() body:unknown,@Req() req:Request){return this.external.close(key,proof(req),body,meta(req));}
 @Public() @Get('notify') verify(@Query() query:unknown,@Res() response:Response){response.type('text/plain').send(this.external.verifyEndpoint(query));}
 @Public() @Post('notify') async notify(@Query() query:unknown,@Body() body:unknown,@Req() req:Request,@Res() response:Response){const result=await this.external.notify(query,body as string,meta(req));response.status(200).type(result==='success'?'text/plain':'application/xml').send(result);}
 @Public() @Get('callback') async callback(@Query() query:unknown,@Req() req:Request,@Res() response:Response){try{const result=await this.external.browserCallback(query,meta(req),req.headers.cookie),{maxAge,...options}=this.external.browserCookieOptions();response.clearCookie(externalCookieName(result.requestKey),options);response.redirect(303,result.path);}catch{response.redirect(303,'/login?channel=external&externalReturn=unconfirmed');}}
}
@Controller('users/me/external')
@UseInterceptors(new ExternalResponseHeaders())
export class ExternalIdentityController{
 constructor(private readonly external:ExternalAuthService){}
 @Get() identity(@CurrentUser() actor:AuthUser){return this.external.identity(actor);}
 @Post('requests/:key') async create(@Param('key') key:string,@Body() body:unknown,@Req() req:Request,@CurrentUser() actor:AuthUser,@Res({passthrough:true}) response:Response){const result=await this.external.create(key,proof(req),body,meta(req),actor);if(result.method==='browser'&&result.status==='waiting')response.cookie(externalCookieName(result.requestKey),proof(req),this.external.browserCookieOptions());return result;}
 @Get('requests/:key') read(@Param('key') key:string,@Req() req:Request,@CurrentUser() actor:AuthUser){return this.external.read(key,proof(req),meta(req),actor);}
 @Post('requests/:key/complete') complete(@Param('key') key:string,@Body() body:unknown,@Req() req:Request,@CurrentUser() actor:AuthUser){return this.external.complete(key,proof(req),body,meta(req),actor);}
 @Post('requests/:key/close') close(@Param('key') key:string,@Body() body:unknown,@Req() req:Request,@CurrentUser() actor:AuthUser){return this.external.close(key,proof(req),body,meta(req),actor);}
}
