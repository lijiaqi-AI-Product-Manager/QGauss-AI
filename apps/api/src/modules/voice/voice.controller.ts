import { Body, Controller, Delete,Get,Header,HttpCode, Param, Post, Put, Query,Res, UploadedFile, UseInterceptors,UnauthorizedException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser,authSession } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { VoiceService } from './voice.service';
import { VoiceConfigDto, VoiceCreateDto, VoiceQuoteDto } from './voice.dto';
import { MAX_RECORDING_BYTES } from './voice-protocol';
import {VoiceLibraryService} from './voice-library.service';

@Controller('voice')
export class VoiceController {
  constructor(private readonly voice:VoiceService,private readonly library:VoiceLibraryService){}
  @Get('library') @Header('Cache-Control','private, no-store') history(@CurrentUser() user:AuthUser,@Query() query:Record<string,unknown>){return this.library.list(user.id,query);}
  @Get('library/:id') @Header('Cache-Control','private, no-store') historicalDetail(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.library.detail(user.id,id);}
  @Delete('library/:id') removeHistory(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.library.remove(user.id,id);}
  @Roles('ADMIN') @Get('admin/config') config(){return this.voice.adminConfig();}
  @Roles('ADMIN') @Put('admin/config') save(@Body() dto:VoiceConfigDto){return this.voice.saveConfig(dto);}
  @Roles('ADMIN') @Get('admin/receipts') receipts(){return this.voice.receipts();}
  @Get('options') options(){return this.voice.options();}
  @Post('quote') @Header('Cache-Control','private, no-store') quote(@CurrentUser() user:AuthUser,@Body() dto:VoiceQuoteDto){return this.voice.quote(user.id,dto);}
  @Post('recordings') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_RECORDING_BYTES,files:1}})) recording(@CurrentUser() user:AuthUser,@UploadedFile() file:any){return this.voice.recording(user.id,file);}
  @Post('tasks') @Header('Cache-Control','private, no-store') create(@CurrentUser() user:AuthUser,@Body() dto:VoiceCreateDto){return this.voice.create(user.id,dto);}
  @Post('requests/:key/end') @HttpCode(200) @Header('Cache-Control','private, no-store') end(@CurrentUser() user:AuthUser,@Param('key') key:string){return this.voice.endRequest(user.id,key);}
  @Get('tasks/:id/download') async download(@CurrentUser() user:AuthUser,@Param('id') id:string,@Res() res:Response){const file=await this.voice.download(user.id,id);res.setHeader('Content-Type','audio/mpeg');res.setHeader('Content-Length',file.buffer.length);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);res.end(file.buffer);}
  @Get('tasks/by-request/:key') @Header('Cache-Control','private, no-store') byRequest(@CurrentUser() user:AuthUser,@Param('key') key:string){return this.voice.byRequest(user.id,key);}
  @Get('tasks/:id') @Header('Cache-Control','private, no-store') detail(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.voice.detail(user.id,id);}
  @Get('tasks/:id/stream') async stream(@CurrentUser() user:AuthUser,@Param('id') id:string,@Res() res:Response){
    const controller=new AbortController(),close=()=>controller.abort(Error('声音播放连接已关闭'));res.once('close',close);
    try{const session=authSession(user);if(!session)throw new UnauthorizedException();const chunks=await this.voice.stream(user.id,id,controller.signal,session);res.setHeader('Content-Type','audio/mpeg');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
      for await(const chunk of chunks){controller.signal.throwIfAborted();if(!res.write(chunk))await new Promise<void>((resolve,reject)=>{const cleanup=()=>{res.off('drain',drain);res.off('close',ended);res.off('error',ended);controller.signal.removeEventListener('abort',ended);},drain=()=>{cleanup();resolve();},ended=()=>{cleanup();reject(Error('声音播放连接已关闭'));};res.once('drain',drain);res.once('close',ended);res.once('error',ended);controller.signal.addEventListener('abort',ended,{once:true});if(controller.signal.aborted)ended();});}res.end();
    }catch(error){if(!res.headersSent)throw error;res.destroy();}finally{res.off('close',close);controller.abort();}
  }
  @Post('tasks/:id/cancel') cancel(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.voice.cancel(user.id,id);}
  @Get('tasks/:id/audio/:index') async audio(@CurrentUser() user:AuthUser,@Param('id') id:string,@Param('index') index:string,@Res() res:Response){
    const part=/^(0|[1-9][0-9]*)$/.test(index)?Number(index):-1,file=await this.voice.audio(user.id,id,part);
    res.setHeader('Content-Type','audio/mpeg');res.setHeader('Content-Length',file.buffer.length);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);res.end(file.buffer);
  }
}
