import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommerceGuard } from './commerce.guard';
import { CramiService } from './crami.service';

/**
 * 卡密与套餐
 * commerce.enabled=false 时整个控制器 404。
 */
@Controller('crami')
@UseGuards(CommerceGuard)
export class CramiController {
  constructor(private readonly crami: CramiService) {}

  /** 前台可售套餐（充值页用，无需登录） */
  @Public()
  @Get('packages')
  packages() {
    return this.crami.publicPackages();
  }

  // ---- 套餐管理（后台） ----

  @Roles('ADMIN')
  @Post('package/create')
  createPackage(@Body() dto: Record<string, unknown>) {
    return this.crami.createPackage(dto);
  }

  @Roles('ADMIN')
  @Get('package/list')
  listPackages(@Query() q: Record<string, unknown>) {
    return this.crami.listPackages(q);
  }

  @Roles('ADMIN')
  @Patch('package/:id')
  updatePackage(@Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.crami.updatePackage(id, dto);
  }

  @Roles('ADMIN')
  @Delete('package/:id')
  removePackage(@Param('id') id: string) {
    return this.crami.removePackage(id);
  }

  // ---- 卡密管理（后台） ----

  @Roles('ADMIN')
  @Post('create')
  generate(@CurrentUser('id') adminId: string, @Body() dto: Record<string, unknown>) {
    return this.crami.generate(adminId, dto);
  }

  @Roles('ADMIN')
  @Get('list')
  list(@Query() q: Record<string, unknown>) {
    return this.crami.listCramis(q);
  }

  @Roles('ADMIN')
  @Get('stats')
  stats() {
    return this.crami.stats();
  }

  @Roles('ADMIN')
  @Delete(':id')
  void(@Param('id') id: string) {
    return this.crami.voidCrami(id);
  }

  // ---- 用户侧 ----

  /** 核销卡密 */
  @Post('exchange')
  exchange(@CurrentUser('id') userId: string, @Body() dto: Record<string, unknown>) {
    return this.crami.exchange(userId, dto?.code);
  }

  /** 我的核销记录 */
  @Get('myLog')
  myLog(@CurrentUser('id') userId: string, @Query() q: Record<string, unknown>) {
    return this.crami.myUses(userId, q);
  }
}
