import { Body, Controller, Get, Ip, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CommerceGuard } from './commerce.guard';
import { PayService } from './pay.service';

/**
 * 支付
 *
 * 回调是唯一不需要登录的接口：第三方服务器不可能带 JWT。
 * 它的身份验证靠签名，不靠 token，所以这里 @Public() 是必需且安全的。
 */
@Controller('pay')
@UseGuards(CommerceGuard)
export class PayController {
  constructor(private readonly pay: PayService) {}

  /**
   * 第三方回调。
   * 无论成败都回 200 + 纯文本，因为网关只认 body 内容；
   * 用 4xx/5xx 会让网关反复重推，反而放大问题。
   */
  @Public()
  @Post('notify/:provider')
  async notify(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.pay.notify(provider, body ?? {}, ip);
      res.status(200).type('text/plain').send(result.ok ? 'success' : 'fail');
    } catch (err) {
      // 未预期的异常（例如数据库不可用）也不能把堆栈回给网关
      res.status(200).type('text/plain').send('fail');
      throw err;
    }
  }

  /** 下单后取支付参数 */
  @Post('prepare/:orderId')
  prepare(@CurrentUser('id') userId: string, @Param('orderId') orderId: string) {
    return this.pay.prepare(userId, orderId);
  }

  /** 前端轮询支付结果 */
  @Get('status/:orderId')
  status(@CurrentUser() me: AuthUser, @Param('orderId') orderId: string) {
    return this.pay.status(me.id, orderId, me.role === 'ADMIN');
  }

  /** 模拟支付（仅开发/演示，生产环境直接拒绝） */
  @Post('mock/:orderId')
  mock(@CurrentUser('id') userId: string, @Param('orderId') orderId: string) {
    return this.pay.mockPay(userId, orderId);
  }
}
