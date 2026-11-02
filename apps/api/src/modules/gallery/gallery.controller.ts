import {Body,Controller,Get,Header,Param,Put,Query,Req,Res} from '@nestjs/common';
import {IsBoolean} from 'class-validator';
import {Transform} from 'class-transformer';
import type {Request,Response} from 'express';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {GalleryService} from './gallery.service';

export class GalleryFavoriteDto {@Transform(({obj,key})=>obj[key]) @IsBoolean() favorite:boolean;}
export class GalleryFeatureDto {@Transform(({obj,key})=>obj[key]) @IsBoolean() featured:boolean;}

@Controller('gallery')
export class GalleryController {
 constructor(private readonly gallery:GalleryService){}
 @Get('options') @Header('Cache-Control','private, no-store')
 options(@CurrentUser() user:AuthUser){return this.gallery.options(user.id);}
 @Get('works') @Header('Cache-Control','private, no-store')
 list(@CurrentUser() user:AuthUser,@Query() query:Record<string,unknown>){return this.gallery.list(user.id,query);}
 @Get('works/:kind/:id') @Header('Cache-Control','private, no-store')
 detail(@CurrentUser() user:AuthUser,@Param('kind') kind:string,@Param('id') id:string){return this.gallery.detail(user.id,kind,id);}
 @Get('works/:kind/:id/reuse') @Header('Cache-Control','private, no-store')
 reuse(@CurrentUser() user:AuthUser,@Param('kind') kind:string,@Param('id') id:string){return this.gallery.reuse(user.id,kind,id);}
 @Put('works/:kind/:id/favorite') @Header('Cache-Control','private, no-store')
 favorite(@CurrentUser() user:AuthUser,@Param('kind') kind:string,@Param('id') id:string,@Body() dto:GalleryFavoriteDto){return this.gallery.favorite(user.id,kind,id,dto.favorite);}
 @Roles('ADMIN') @Put('works/:kind/:id/feature') @Header('Cache-Control','private, no-store')
 feature(@CurrentUser() user:AuthUser,@Param('kind') kind:string,@Param('id') id:string,@Body() dto:GalleryFeatureDto){return this.gallery.feature(user.id,kind,id,dto.featured);}
 @Get('works/:kind/:id/playback') @Header('Cache-Control','private, no-store')
 playback(@CurrentUser() user:AuthUser,@Param('kind') kind:string,@Param('id') id:string,@Query('index') index:unknown){return this.gallery.playback(user.id,kind,id,index);}
 @Get('works/:kind/:id/assets/:index')
 async asset(@CurrentUser() user:AuthUser,@Param('kind') kind:string,@Param('id') id:string,@Param('index') index:string,@Query('thumb') thumb:unknown,@Req() request:Request,@Res() response:Response){
  const file=await this.gallery.asset(user.id,kind,id,index,thumb,request.ip||'local');
  response.setHeader('Content-Type',file.mime);response.setHeader('Content-Length',file.buffer.length);response.setHeader('Cache-Control','private, no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
  if(file.mime==='image/svg+xml')response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");
  response.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);response.end(file.buffer);
 }
}
