import {Body,CallHandler,Controller,Delete,ExecutionContext,Get,NestInterceptor,Param,Patch,Post,Query,UseInterceptors} from '@nestjs/common';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {OptionalAuth} from '../../common/decorators/optional-auth.decorator';
import {CreateMenuDto,UpdateMenuDto} from './dto/menu.dto';
import {MenuService} from './menu.service';
const menuInput=(value:object)=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
class MenuHeaders implements NestInterceptor{intercept(context:ExecutionContext,next:CallHandler){context.switchToHttp().getResponse().setHeader('Cache-Control','no-store');return next.handle();}}
@Controller('menus')
@UseInterceptors(new MenuHeaders())
export class MenuController{
 constructor(private readonly menus:MenuService){}
 @Get() async tree(@CurrentUser() actor:AuthUser){return(await this.menus.navigation(actor)).items;}
 @OptionalAuth() @Get('navigation') navigation(@CurrentUser() actor:AuthUser,@Query('platform') platform?:string){return this.menus.navigation(actor,platform);}
 @OptionalAuth() @Get('entries/:id') entry(@Param('id') id:string,@CurrentUser() actor:AuthUser,@Query('platform') platform?:string){return this.menus.entry(id,actor,platform);}
 @Roles('ADMIN') @Get('workspace') workspace(@CurrentUser() actor:AuthUser){return this.menus.workspace(actor);}
 @Roles('ADMIN') @Get('operations/:key') read(@Param('key') key:string,@CurrentUser() actor:AuthUser){return this.menus.read(key,actor);}
 @Roles('ADMIN') @Post('operations/:key') apply(@Param('key') key:string,@Body() body:unknown,@CurrentUser() actor:AuthUser){return this.menus.apply(key,body,actor);}
 @Roles('ADMIN') @Post('operations/:key/close') close(@Param('key') key:string,@Body() body:unknown,@CurrentUser() actor:AuthUser){return this.menus.close(key,body,actor);}
 @Roles('ADMIN') @Get('admin') all(@CurrentUser() actor:AuthUser){return this.menus.all(actor);}
 @Roles('ADMIN') @Post() create(@Body() body:CreateMenuDto,@CurrentUser() actor:AuthUser){return this.menus.create(menuInput(body),actor);}
 @Roles('ADMIN') @Patch(':id') update(@Param('id') id:string,@Body() body:UpdateMenuDto,@CurrentUser() actor:AuthUser){return this.menus.update(id,menuInput(body),actor);}
 @Roles('ADMIN') @Delete(':id') remove(@Param('id') id:string,@CurrentUser() actor:AuthUser){return this.menus.remove(id,actor);}
}
