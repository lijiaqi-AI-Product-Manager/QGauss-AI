import {Body,CallHandler,Controller,ExecutionContext,Get,NestInterceptor,Param,Post,UseInterceptors} from '@nestjs/common';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {SettingsWorkspaceService} from './settings-workspace.service';
class SettingsResponseHeaders implements NestInterceptor{intercept(context:ExecutionContext,next:CallHandler){context.switchToHttp().getResponse().setHeader('Cache-Control','no-store');return next.handle();}}
@Controller('settings')
@Roles('ADMIN')
@UseInterceptors(new SettingsResponseHeaders())
export class SettingsWorkspaceController{
 constructor(private readonly settings:SettingsWorkspaceService){}
 @Get('workspace') snapshot(@CurrentUser() actor:AuthUser){return this.settings.snapshot(actor);}
 @Get('operations/:key') read(@Param('key') key:string,@CurrentUser() actor:AuthUser){return this.settings.read(key,actor);}
 @Post('operations/:key') apply(@Param('key') key:string,@Body() body:unknown,@CurrentUser() actor:AuthUser){return this.settings.apply(key,body,actor);}
 @Post('operations/:key/close') close(@Param('key') key:string,@Body() body:unknown,@CurrentUser() actor:AuthUser){return this.settings.close(key,body,actor);}
}
