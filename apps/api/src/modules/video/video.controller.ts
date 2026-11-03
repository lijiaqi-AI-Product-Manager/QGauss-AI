import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Req, Res,UploadedFile,UseInterceptors,UseGuards } from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { StorageService } from '../storage/storage.service';
import { VideoService } from './video.service';
import { VideoMediaService } from './video-media.service';
import { VideoCreateDto, VideoPresetDto, VideoPublishDto, VideoQuoteDto } from './video.dto';
import { videoByteRange } from './video-protocol';
import {VideoMaterialsService} from './video-materials.service';
import {VideoMaterialUploadGuard} from './video-material-upload.guard';
@Controller('video')
export class VideoController {
  constructor(private readonly video: VideoService, private readonly media: VideoMediaService, private readonly storage: StorageService,private readonly materials:VideoMaterialsService) {}
  @Post('materials/:kind') @UseGuards(VideoMaterialUploadGuard) @UseInterceptors(FileInterceptor('file',{limits:{fileSize:96*1024*1024,files:1,fields:0,parts:1}})) material(@CurrentUser() user:AuthUser,@Param('kind') kind:string,@UploadedFile() file:any){return this.materials.upload(user.id,kind,file);}
  @Post('materials/from-task/:id') @UseGuards(VideoMaterialUploadGuard) fromTask(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.materials.fromTask(user.id,id);}
  @Get('materials/:id/frames') @Header('Cache-Control','private, no-store') frames(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.video.materialFrames(user.id,id);}
  @Roles('ADMIN') @Get('admin/config') config() { return this.video.adminConfig(); }
  @Roles('ADMIN') @Post('admin/presets') add(@Body() dto: VideoPresetDto) { return this.video.savePreset(dto); }
  @Roles('ADMIN') @Put('admin/presets/:id') save(@Param('id') id: string, @Body() dto: VideoPresetDto) { return this.video.savePreset(dto, id); }
  @Roles('ADMIN') @Get('admin/receipts') receipts() { return this.video.receipts(); }
  @Roles('ADMIN') @Post('admin/tasks/:id/check') check(@Param('id') id: string) { return this.video.checkAgain(id); }
  @Get('options') options() { return this.video.options(); }
  @Post('quote') @Header('Cache-Control','private, no-store') quote(@CurrentUser() user: AuthUser, @Body() dto: VideoQuoteDto) { return this.video.quote(user.id, dto); }
  @Post('tasks') create(@CurrentUser() user: AuthUser, @Body() dto: VideoCreateDto) { return this.video.create(user.id, dto); }
  @Get('tasks/by-request/:key') byRequest(@CurrentUser() user: AuthUser, @Param('key') key: string) { return this.video.byRequest(user.id, key); }
  @Get('tasks') list(@CurrentUser() user: AuthUser, @Query('page') page = '1', @Query('pageSize') size = '12') { return this.video.list(user.id, false, Number(page), Number(size)); }
  @Get('trash') trash(@CurrentUser() user: AuthUser, @Query('page') page = '1', @Query('pageSize') size = '12') { return this.video.list(user.id, false, Number(page), Number(size), true); }
  @Get('square') square(@CurrentUser() user: AuthUser, @Query('page') page = '1', @Query('pageSize') size = '12') { return this.video.list(user.id, true, Number(page), Number(size)); }
  @Get('tasks/:id') detail(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.video.detail(user.id, id); }
  @Post('tasks/:id/cancel') cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.video.cancel(user.id, id); }
  @Patch('tasks/:id/publish') publish(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VideoPublishDto) { return this.video.publish(user.id, id, dto.published,dto.catId,dto.expectedUpdatedAt); }
  @Delete('tasks/:id') remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.video.remove(user.id, id); }
  @Post('tasks/:id/restore') restore(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.video.restore(user.id, id); }
  @Get('tasks/:id/playback') async playback(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.media.playback(user.id, await this.video.visible(user.id, id)); }
  @Public() @Get('media/:id/:kind') async mediaFile(@Param('id') id: string, @Param('kind') kind: string, @Query('ticket') ticket: unknown, @Req() req: Request, @Res() res: Response) { return this.serve(id, kind, ticket, 'playback', req, res); }
  @Public() @Get('input/:id/:kind') async inputFile(@Param('id') id: string, @Param('kind') kind: string, @Query('ticket') ticket: unknown, @Req() req: Request, @Res() res: Response) { return this.serve(id, kind, ticket, 'input', req, res); }
  private async serve(id: string, kind: string, ticket: unknown, purpose: 'input' | 'playback', req: Request, res: Response) {
    const file = await this.media.access(id, kind, ticket, purpose, req.ip || req.socket.remoteAddress || ''), range = videoByteRange(req.headers.range, file.size);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Accept-Ranges', 'bytes');
    if (!range) { res.status(416).setHeader('Content-Range', 'bytes */' + file.size); res.end(); return; }
    const stream = req.method !== 'HEAD' && !file.buffer ? (await this.storage.streamRange(file.fileId, file.owner, 'USER', range.start, range.end)).stream : null;
    res.status(range.partial ? 206 : 200); res.setHeader('Content-Type', file.mime); res.setHeader('Content-Length', range.end - range.start + 1); if (range.partial) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    if (req.method === 'HEAD') { res.end(); return; } if (file.buffer) { res.end(file.buffer.subarray(range.start, range.end + 1)); return; }
    try { await pipeline(stream!, res); } catch (error) { if (!res.destroyed) res.destroy(error as Error); }
  }
}
