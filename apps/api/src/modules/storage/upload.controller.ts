import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageService } from './storage.service';
import {FileLibraryDto,FileVersionDto} from './file-library.dto';

@Controller('upload')
export class UploadController {
  constructor(private readonly storage: StorageService) {}

  /**
   * 上传文件（multipart，字段名 file）。
   * 限制在拦截器层先挡一次，真实上限由配置 upload.maxSizeMb 决定。
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: any,
    @Body('scope') scope?: string,
  ) {
    return this.storage.upload(user.id, file, scope || 'chat');
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query:FileLibraryDto,
  ) {
    return query.library==='1'?this.storage.listLibrary(user.id,query):this.storage.listMine(user.id,query.page,query.pageSize);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.storage.detail(id, user.id, user.role);
  }

  @Get(':id/raw')
  async raw(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, mime, filename,scope } = await this.storage.read(id, user.id, user.role);
    // 只有位图（和沙箱里的 SVG）允许内联渲染：text/plain、application/pdf 之类内联回源
    // 等于把同源执行面交给用户
    const isSvg = mime === 'image/svg+xml';
    const inline = isSvg || /^image\/(png|jpeg|gif|webp)$/.test(mime);
    res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isSvg) {
      // SVG 可以内嵌脚本：即使只在 <img> 里用，也把它关进沙箱，直接打开同样不执行
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', ['app-icon','chat','agent-result'].includes(scope)?'private, no-store':'private, max-age=3600');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.end(buffer);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.storage.remove(id, user.id, user.role);
  }
  @Post(':id/trash') trash(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:FileVersionDto){return this.storage.trashFile(user.id,id,dto.expectedVersion);}
  @Post(':id/restore') restore(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:FileVersionDto){return this.storage.trashFile(user.id,id,dto.expectedVersion,true);}
}
