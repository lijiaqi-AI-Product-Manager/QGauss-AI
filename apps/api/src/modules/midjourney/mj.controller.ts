import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { StorageService } from '../storage/storage.service';
import { videoByteRange } from '../video/video-protocol';
import { MjService } from './mj.service';
import { MjMediaService } from './mj-media.service';
import { MjCreateDto, MjPresetDto, MjPublishDto, MjQuoteDto, MjModalDto } from './mj.dto';
@Controller('mj')
export class MjController {
  constructor(private readonly mj:MjService,private readonly media:MjMediaService,private readonly storage:StorageService){}
  @Roles('ADMIN') @Get('admin/config') config(){return this.mj.adminConfig();}
  @Roles('ADMIN') @Post('admin/presets') add(@Body() dto:MjPresetDto){return this.mj.savePreset(dto);}
  @Roles('ADMIN') @Put('admin/presets/:id') save(@Param('id') id:string,@Body() dto:MjPresetDto){return this.mj.savePreset(dto,id);}
  @Roles('ADMIN') @Get('admin/receipts') receipts(){return this.mj.receipts();}
  @Roles('ADMIN') @Post('admin/tasks/:id/check') check(@Param('id') id:string){return this.mj.checkAgain(id);}
  @Get('options') options(){return this.mj.options();}
  @Post('quote') quote(@CurrentUser() u:AuthUser,@Body() dto:MjQuoteDto){return this.mj.quote(u.id,dto);}
  @Post('tasks') create(@CurrentUser() u:AuthUser,@Body() dto:MjCreateDto){return this.mj.create(u.id,dto);}
  @Get('tasks/by-request/:key') byRequest(@CurrentUser() u:AuthUser,@Param('key') key:string){return this.mj.byRequest(u.id,key);}
  @Get('tasks') list(@CurrentUser() u:AuthUser,@Query('page') page='1',@Query('pageSize') size='12'){return this.mj.list(u.id,false,Number(page),Number(size));}
  @Get('trash') trash(@CurrentUser() u:AuthUser,@Query('page') page='1',@Query('pageSize') size='12'){return this.mj.list(u.id,false,Number(page),Number(size),true);}
  @Get('square') square(@CurrentUser() u:AuthUser,@Query('page') page='1',@Query('pageSize') size='12'){return this.mj.list(u.id,true,Number(page),Number(size));}
  @Get('tasks/:id') detail(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.mj.detail(u.id,id);}
  @Post('tasks/:id/cancel') cancel(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.mj.cancel(u.id,id);}
  @Post('tasks/:id/modal') modal(@CurrentUser() u:AuthUser,@Param('id') id:string,@Body() dto:MjModalDto){return this.mj.resumeModal(u.id,id,dto);}
  @Post('tasks/:id/seed') seed(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.mj.seed(u.id,id);}
  @Patch('tasks/:id/publish') publish(@CurrentUser() u:AuthUser,@Param('id') id:string,@Body() dto:MjPublishDto){return this.mj.publish(u.id,id,dto.published,dto.catId,dto.expectedUpdatedAt);}
  @Delete('tasks/:id') remove(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.mj.remove(u.id,id);}
  @Post('tasks/:id/restore') restore(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.mj.restore(u.id,id);}
  @Get('tasks/:id/playback') async playback(@CurrentUser() u:AuthUser,@Param('id') id:string,@Query('index') index='0'){return this.media.playback(u.id,await this.mj.visible(u.id,id),Number(index));}
  @Get('tasks/:id/media/:index') async still(@CurrentUser() u:AuthUser,@Param('id') id:string,@Param('index') index:string,@Req() req:Request,@Res() res:Response){return this.serve(await this.media.still(u.id,await this.mj.visible(u.id,id),Number(index)),req,res);}
  @Get('tasks/:id/poster/:index') async poster(@CurrentUser() u:AuthUser,@Param('id') id:string,@Param('index') index:string,@Req() req:Request,@Res() res:Response){return this.serve(await this.media.still(u.id,await this.mj.visible(u.id,id),Number(index),true),req,res);}
  @Public() @Get('media/:id/:index') async movie(@Param('id') id:string,@Param('index') index:string,@Query('ticket') ticket:unknown,@Req() req:Request,@Res() res:Response){return this.serve(await this.media.ticket(id,Number(index),ticket,req.ip||req.socket.remoteAddress||''),req,res);}
  private async serve(file:{fileId:string;owner:string;mime:string;size:number;filename:string},req:Request,res:Response){const range=videoByteRange(req.headers.range,file.size);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Accept-Ranges','bytes');if(!range){res.status(416).setHeader('Content-Range','bytes */'+file.size);res.end();return;}
    const stream=req.method!=='HEAD'?(await this.storage.streamRange(file.fileId,file.owner,'USER',range.start,range.end)).stream:null;res.status(range.partial?206:200);res.setHeader('Content-Type',file.mime);res.setHeader('Content-Length',range.end-range.start+1);if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${file.size}`);res.setHeader('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);if(req.method==='HEAD'){res.end();return;}try{await pipeline(stream!,res);}catch(e){if(!res.destroyed)res.destroy(e as Error);}
  }
}
