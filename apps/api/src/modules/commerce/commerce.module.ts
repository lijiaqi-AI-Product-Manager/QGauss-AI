import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { RateLimitModule } from '../../common/ratelimit/rate-limit.module';
import { CommerceGuard } from './commerce.guard';
import { LedgerService } from './ledger.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { SigninController } from './signin.controller';
import { SigninService } from './signin.service';
import { CramiController } from './crami.controller';
import { CramiService } from './crami.service';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { PayController } from './pay.controller';
import { PayService } from './pay.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

/**
 * 商业化模块
 *
 * 设计要点：
 *   - 与主站解耦：不引入循环依赖，只依赖 SettingsModule 与全局 PrismaModule
 *   - 全部路由挂 CommerceGuard，commerce.enabled=false 时对外表现为"不存在"
 *   - LedgerService 是余额的唯一写入入口，对外导出供 chat / image 复用
 *   - 付费回调（/pay/notify/:provider）是唯一 @Public 的写接口，靠签名验证身份
 */
@Module({
  imports: [SettingsModule, RateLimitModule],
  controllers: [
    WalletController,
    SigninController,
    CramiController,
    OrderController,
    PayController,
    SalesController,
  ],
  providers: [
    CommerceGuard,
    LedgerService,
    WalletService,
    SigninService,
    CramiService,
    OrderService,
    PayService,
    SalesService,
  ],
  exports: [CommerceGuard, LedgerService, WalletService, SigninService],
})
export class CommerceModule {}
