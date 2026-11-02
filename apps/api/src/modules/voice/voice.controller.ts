import { Body, Controller, Get, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { VoiceService } from './voice.service';
import { VoiceConfigDto, VoiceCreateDto, VoiceQuoteDto } from './voice.dto';
import { MAX_RECORDING_BYTES } from './voice-protocol';

@Controller('voice')
export class VoiceController {
  constructor(private readonly voice:VoiceService){}
  @Roles('ADMIN') @Get('admin/config') config(){return this.voice.adminConfig();}
  @Roles('ADMIN') @Put('admin/config') save(@Body() dto:VoiceConfigDto){return this.voice.saveConfig(dto);}
  @Roles('ADMIN') @Get('admin/receipts') receipts(){return this.voice.receipts();}
  @Get('options') options(){return this.voice.options();}
  @Post('quote') quote(@CurrentUser() user:AuthUser,@Body() dto:VoiceQuoteDto){return this.voice.quote(user.id,dto);}
  @Post('recordings') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_RECORDING_BYTES,files:1}})) recording(@CurrentUser() user:AuthUser,@UploadedFile() file:any){return this.voice.recording(user.id,file);}
  @Post('tasks') create(@CurrentUser() user:AuthUser,@Body() dto:VoiceCreateDto){return this.voice.create(user.id,dto);}
  @Get('tasks/by-request/:key') byRequest(@CurrentUser() user:AuthUser,@Param('key') key:string){return this.voice.byRequest(user.id,key);}
  @Get('tasks/:id') detail(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.voice.detail(user.id,id);}
  @Post('tasks/:id/cancel') cancel(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.voice.cancel(user.id,id);}
  @Get('tasks/:id/audio/:index') async audio(@CurrentUser() user:AuthUser,@Param('id') id:string,@Param('index') index:string,@Res() res:Response){
    const part=/^(0|[1-9][0-9]*)$/.test(index)?Number(index):-1,file=await this.voice.audio(user.id,id,part);
    res.setHeader('Content-Type','audio/mpeg');res.setHeader('Content-Length',file.buffer.length);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);res.end(file.buffer);
  }
}
