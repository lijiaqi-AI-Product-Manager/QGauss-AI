import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommerceGuard } from './commerce.guard';
import { SalesService } from './sales.service';

/** 分销 */
@Controller('sales')
@UseGuards(CommerceGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // ---- 用户侧 ----

  /** 申请成为分销员（幂等） */
  @Post('apply')
  apply(@CurrentUser('id') userId: string, @Body() dto: Record<string, unknown>) {
    return this.sales.apply(userId, dto);
  }

  @Get('info')
  info(@CurrentUser('id') userId: string) {
    return this.sales.info(userId);
  }

  @Get('records')
  records(@CurrentUser('id') userId: string, @Query() q: Record<string, unknown>) {
    return this.sales.records(userId, q);
  }

  @Get('withdrawals')
  withdrawals(@CurrentUser('id') userId: string, @Query() q: Record<string, unknown>) {
    return this.sales.withdrawals(userId, q);
  }

  /** 申请提现：金额当场冻结，审核期间不能重复提 */
  @Post('withdraw')
  withdraw(@CurrentUser('id') userId: string, @Body() dto: Record<string, unknown>) {
    return this.sales.withdraw(userId, dto);
  }

  // ---- 后台 ----

  @Roles('ADMIN')
  @Get('manage')
  manage(@Query() q: Record<string, unknown>) {
    return this.sales.manage(q);
  }

  @Roles('ADMIN')
  @Patch('manage/:userId')
  manageUpdate(@Param('userId') userId: string, @Body() dto: Record<string, unknown>) {
    return this.sales.manageUpdate(userId, dto);
  }

  @Roles('ADMIN')
  @Get('audit')
  auditList(@Query() q: Record<string, unknown>) {
    return this.sales.auditList(q);
  }

  @Roles('ADMIN')
  @Post('audit/:id')
  audit(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.sales.audit(id, adminId, dto);
  }
}
