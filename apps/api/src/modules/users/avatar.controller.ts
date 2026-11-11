import {Body,Controller,Get,Header,Param,Post,Query,Res,UploadedFile,UseGuards,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {Response} from 'express';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {UserAvatarService} from './avatar.service';
import {AvatarUploadGuard} from './avatar-upload.guard';
import {AVATAR_MAX_BYTES} from './avatar-image';

@Controller('users/me/avatar')
export class UserAvatarController{
 constructor(private readonly avatars:UserAvatarService){}
 @Get('policy') @Header('Cache-Control','private, no-store') policy(@CurrentUser() user:AuthUser){return this.avatars.policy(user);}
 @Post('uploads/:key') @UseGuards(AvatarUploadGuard) @UseInterceptors(FileInterceptor('file',{limits:{fileSize:AVATAR_MAX_BYTES,files:1,fields:2,fieldSize:1024,parts:3}}))
 upload(@CurrentUser() user:AuthUser,@Param('key') key:string,@Body('expectedVersion') version:unknown,@Body('crop') crop:unknown,@UploadedFile() file:any){return this.avatars.upload(user,key,version,crop,file);}
 @Get('uploads/:key') @Header('Cache-Control','private, no-store') read(@CurrentUser() user:AuthUser,@Param('key') key:string){return this.avatars.read(user,key);}
 @Post('uploads/:key/close') close(@CurrentUser() user:AuthUser,@Param('key') key:string,@Body('expectedVersion') version:unknown){return this.avatars.close(user,key,version);}
 @Get('files/:id') async image(@CurrentUser() user:AuthUser,@Param('id') id:string,@Query('still') still:unknown,@Res() response:Response){
  const file=await this.avatars.image(user,id,still==='1');response.setHeader('Cache-Control','private, no-store');response.setHeader('Content-Type',file.mime);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Disposition','inline; filename="'+file.filename+'"');response.end(file.buffer);
 }
}
