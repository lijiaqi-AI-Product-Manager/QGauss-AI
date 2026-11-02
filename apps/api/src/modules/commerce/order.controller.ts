import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommerceGuard } from './commerce.guard';
import { OrderService } from './order.service';

/** 订单 */
@Controller('order')
@UseGuards(CommerceGuard)
export class OrderController {
  constructor(private readonly order: OrderService) {}

  /** 下单：goodsType=package 买套餐，goodsType=money 充值余额 */
  @Post('create')
  create(@CurrentUser('id') userId: string, @Body() dto: Record<string, unknown>) {
    return this.order.create(userId, dto);
  }

  @Get('list')
  list(@CurrentUser('id') userId: string, @Query() q: Record<string, unknown>) {
    return this.order.list(userId, q);
  }

  /** 后台订单列表 */
  @Roles('ADMIN')
  @Get('manage')
  manage(@Query() q: Record<string, unknown>) {
    return this.order.manage(q);
  }

  @Get('detail/:orderId')
  detail(@CurrentUser() me: AuthUser, @Param('orderId') orderId: string) {
    return this.order.detail(me.id, orderId, me.role === 'ADMIN');
  }

  /** 用户主动关闭未支付订单 */
  @Post('close/:orderId')
  close(@CurrentUser('id') userId: string, @Param('orderId') orderId: string) {
    return this.order.close(userId, orderId);
  }
}
