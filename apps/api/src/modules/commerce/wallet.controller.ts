import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommerceGuard } from './commerce.guard';
import { WalletService } from './wallet.service';

/**
 * 账户与次数。
 * 整个控制器受 CommerceGuard 控制：commerce.enabled=false 时全部 404。
 */
@Controller('balance')
@UseGuards(CommerceGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** 当前用户余额概览 */
  @Get('query')
  query(@CurrentUser('id') userId: string) {
    return this.wallet.overview(userId);
  }

  /** 当前用户消费流水 */
  @Get('consumeLog')
  consumeLog(@CurrentUser('id') userId: string, @Query() q: Record<string, unknown>) {
    return this.wallet.consumeLogs(userId, q);
  }

  /** 当前用户充值流水 */
  @Get('rechargeLog')
  rechargeLog(@CurrentUser('id') userId: string, @Query() q: Record<string, unknown>) {
    return this.wallet.rechargeLogs(userId, q);
  }

  /** 管理员：全部用户消费流水 */
  @Roles('ADMIN')
  @Get('accountLog')
  accountLog(@Query() q: Record<string, unknown>) {
    return this.wallet.allConsumeLogs(q);
  }

  /** 游客数据继承（本项目无游客体系，显式空实现） */
  @Get('getVisitorCount')
  visitorCount(@CurrentUser('id') userId: string) {
    return this.wallet.visitorCount(userId);
  }

  @Post('inheritVisitorData')
  inherit(@CurrentUser('id') userId: string) {
    return this.wallet.inheritVisitorData(userId);
  }

  /** 管理员：手工发放次数/会员/余额 */
  @Roles('ADMIN')
  @Post('upgradeBalance')
  upgrade(@CurrentUser('id') adminId: string, @Body() dto: Record<string, unknown>) {
    return this.wallet.manualGrant(adminId, dto as never);
  }
}
