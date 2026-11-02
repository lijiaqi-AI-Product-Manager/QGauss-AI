import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ImageService } from './image.service';

class CreateImageTaskDto {
  @IsString() @Length(1, 4000) prompt: string;
  @IsOptional() @IsString() @Length(0, 2000) negativePrompt?: string;
  @IsOptional() @IsString() ratio?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsIn(['low', 'medium', 'high', 'auto']) quality?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4294967295) seed?: number;
  @IsOptional() @IsString() versionName?: string;
  @IsOptional() @IsString() catId?: string;
  @IsOptional() @IsIn(['text2img', 'img2img']) mode?: string;
  /** 二级操作来源：变体 / 放大 / 局部重绘 */
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsIn(['variant', 'upscale', 'redraw', 'removebg']) action?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) n?: number;
  @IsOptional() @IsString() model?: string;
  /** 图生图：参考图文件 id */
  @IsOptional() @IsString() editOf?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ArrayUnique() @IsString({ each: true }) @Length(1, 120, { each: true }) referenceIds?: string[];
  @IsOptional() @IsString() @Length(1, 120) maskId?: string;
  /** 前端展示的每张次数报价；变化时要求重新确认，避免静默接受更高费用。 */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) expectedUnitCost?: number;
}

class PublishDto {
  @IsBoolean() published: boolean;
}

@Controller('image')
export class ImageController {
  constructor(private readonly image: ImageService) {}

  @Get('options')
  options() {
    return this.image.options();
  }

  /** 绘画广场（登录即可看） */
  @Get('square')
  square(@Query('page') page = 1, @Query('pageSize') pageSize = 24, @Query('catId') catId?: string) {
    return this.image.square({ page: Number(page), pageSize: Number(pageSize), catId });
  }

  @Post('tasks')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateImageTaskDto) {
    return this.image.create(user.id, dto);
  }

  @Get('tasks')
  list(
    @CurrentUser() user: AuthUser,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('status') status?: string,
    @Query('catId') catId?: string,
  ) {
    return this.image.list(user.id, {
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      catId,
    });
  }

  @Get('tasks/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.image.detail(user.id, id);
  }

  @Get('tasks/:id/results/:fileId')
  async result(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('fileId') fileId: string, @Res() res: Response, @Query('download') download?: string) {
    const file = await this.image.result(user.id, id, fileId);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (file.mime === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.end(file.buffer);
  }

  @Patch('tasks/:id/publish')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PublishDto) {
    return this.image.publish(user.id, id, dto.published);
  }

  /** 取消排队/执行中的任务 */
  @Post('tasks/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.image.cancel(user.id, id);
  }

  /** 软删除：作品先移入回收，后台再物理清理（后台可一键清理用户已删除的绘画） */
  @Delete('tasks/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.image.remove(user.id, id);
  }
}
