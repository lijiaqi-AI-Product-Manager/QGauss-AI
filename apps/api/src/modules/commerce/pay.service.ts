import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { commissionCents, formatCents, yuanToCents } from '../../common/money/money';
import { toStr } from '../../common/params';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { LedgerService } from './ledger.service';
import { ORDER_STATUS } from './order.service';
import { acceptedOffer, orderTimeout, overdueOrders } from './order-offer';

/**
 * 支付
 *
 * 三条不可退让的原则：
 *   1. 回调必须验签；验不过只记录不发货。
 *   2. 金额必须与订单一致；不一致不发货（防「付 1 分钱买 100 元套餐」）。
 *   3. 发货幂等：`updateMany({status:0} → status:1)` 的影响行数就是闸门。
 *      重复回调只会命中 0 行，因此绝不会重复发放。
 *
 * 说明：epay（易支付）与 hupi（虎皮椒）的验签按公开文档实现，
 * 本项目没有真实商户号，未与线上网关做联调；上线前必须用真实凭据回归一次。
 */

export interface NotifyResult {
  /** 是否处理成功（决定回给第三方的 body） */
  ok: boolean;
  message: string;
  orderId?: string;
  fulfilled?: boolean;
}

const PROVIDERS = ['mock', 'epay', 'hupi'] as const;
type Provider = (typeof PROVIDERS)[number];

function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/**
 * 支付凭据只从环境变量读取：
 *   - 不落数据库（global_configs 会进备份、也会被后台配置接口读出来）
 *   - 不下发给前端（config.public 里没有这些 key）
 * 非机密的网关地址/商户号也放 env，避免「一半在库里一半在 env」的排查成本。
 */
const PAY_ENV = {
  epayGateway: 'PAY_EPAY_GATEWAY',
  epayPid: 'PAY_EPAY_PID',
  epayKey: 'PAY_EPAY_KEY',
  hupiGateway: 'PAY_HUPI_GATEWAY',
  hupiAppId: 'PAY_HUPI_APPID',
  hupiAppKey: 'PAY_HUPI_APPKEY',
} as const;

function env(name: string): string {
  return String(process.env[name] ?? '').trim();
}

/** 参数按 key 升序拼成 k=v&k=v（跳过空值与指定排除项） */
function signString(params: Record<string, unknown>, exclude: string[]): string {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k) && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
}

@Injectable()
export class PayService {
  private readonly logger = new Logger(PayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly rate: RateLimitService,
  ) {}

  /** 当前启用的支付渠道（来自 commerce.payProviders） */
  async providers(): Promise<Provider[]> {
    const raw = await this.settings.get<string>('commerce.payProviders');
    const list = String(raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const out: Provider[] = [];
    for (const name of list) {
      if ((PROVIDERS as readonly string[]).includes(name) && !out.includes(name as Provider)) {
        out.push(name as Provider);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 下单后的支付准备
  // ---------------------------------------------------------------------------

  /** 返回该订单该怎么付：mock 给出模拟支付入口，epay/hupi 给出跳转链接 */
  async prepare(userId: string, orderId: string) {
    await this.expireOrders();
    const order = await this.loadOwnOrder(userId, orderId);
    if (order.status !== ORDER_STATUS.UNPAID) {
      throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '该订单不是待支付状态', 409);
    }

    const enabled = await this.providers();
    if (enabled.length === 0) {
      throw new BusinessException(
        ErrorCode.PAY_PROVIDER_UNAVAILABLE,
        '站点尚未配置支付渠道，请联系管理员',
        503,
      );
    }
    const provider = enabled[0];

    if (provider === 'mock') {
      // 生产环境直接拒绝 mock：否则任何人都能给自己发余额
      if (process.env.NODE_ENV === 'production') {
        throw new BusinessException(
          ErrorCode.PAY_PROVIDER_UNAVAILABLE,
          '生产环境禁止使用模拟支付，请配置真实支付渠道',
          503,
        );
      }
      return {
        provider,
        mock: true,
        amountYuan: formatCents(order.totalCents),
        tip: '这是开发/演示用的模拟支付，不会产生真实扣款',
      };
    }

    if (provider === 'epay') {
      const gateway = env(PAY_ENV.epayGateway);
      const pid = env(PAY_ENV.epayPid);
      const key = env(PAY_ENV.epayKey);
      if (!gateway || !pid || !key) {
        throw new BusinessException(ErrorCode.PAY_PROVIDER_UNAVAILABLE, '易支付参数未配置（PAY_EPAY_*）', 503);
      }
      const notifyUrl = await this.notifyUrl('epay');
      const params: Record<string, string> = {
        pid,
        type: 'alipay',
        out_trade_no: order.orderId,
        notify_url: notifyUrl,
        return_url: await this.returnUrl(order.orderId),
        name: order.goodsName.slice(0, 60),
        money: formatCents(order.totalCents),
      };
      const sign = md5(`${signString(params, [])}${key}`);
      return { provider, payUrl: this.gatewayUrl(gateway, { ...params, sign, sign_type: 'MD5' }) };
    }

    // hupi
    const gateway = env(PAY_ENV.hupiGateway);
    const appid = env(PAY_ENV.hupiAppId);
    const appkey = env(PAY_ENV.hupiAppKey);
    if (!gateway || !appid || !appkey) {
      throw new BusinessException(ErrorCode.PAY_PROVIDER_UNAVAILABLE, '虎皮椒参数未配置（PAY_HUPI_*）', 503);
    }
    const time = Math.floor(Date.now() / 1000);
    const nonce = md5(`${order.orderId}:${time}`).slice(0, 16);
    const params: Record<string, string> = {
      version: '1.1',
      appid,
      trade_order_id: order.orderId,
      total_fee: formatCents(order.totalCents),
      title: order.goodsName.slice(0, 60),
      time: String(time),
      notify_url: await this.notifyUrl('hupi'),
      return_url: await this.returnUrl(order.orderId),
      nonce_str: nonce,
    };
    // 虎皮椒签名：md5(按 key 升序的 k=v&... + appkey)
    const hash = md5(`${signString(params, [])}${appkey}`);
    return { provider, payUrl: this.gatewayUrl(gateway, { ...params, hash }) };
  }

  private async notifyUrl(provider: string) {
    const base = await this.settings.get<string>('commerce.payNotifyBaseUrl');
    const origin = String(base ?? '').replace(/\/+$/, '');
    // 未配置公网地址时退回相对路径：仅本机/内网回调可用，上线必须配
    return origin ? `${origin}/api/pay/notify/${provider}` : `/api/pay/notify/${provider}`;
  }

  private async returnUrl(orderId: string) {
    const base = await this.settings.get<string>('site.baseUrl');
    const origin = String(base ?? '').replace(/\/+$/, '');
    return origin + '/recharge?order=' + encodeURIComponent(orderId);
  }

  private gatewayUrl(base: string, params: Record<string, string>) {
    try {
      const url = new URL(base);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid gateway');
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return url.href;
    } catch { throw new BusinessException(ErrorCode.PAY_PROVIDER_UNAVAILABLE, '支付网关地址无效，请联系管理员', 503); }
  }

  private async expireOrders() {
    const timeout = orderTimeout(await this.settings.get<number>('commerce.orderTimeoutMinutes'));
    await this.prisma.order.updateMany({ where: { status: ORDER_STATUS.UNPAID, ...overdueOrders(new Date(), timeout) }, data: { status: ORDER_STATUS.CLOSED } });
  }

  // ---------------------------------------------------------------------------
  // 回调
  // ---------------------------------------------------------------------------

  /**
   * 第三方支付回调。无论成败都会落一条 PayNotify（原始报文 + IP），
   * 出问题时可以靠它重放和对账。
   */
  async notify(provider: string, params: Record<string, unknown>, ip: string): Promise<NotifyResult> {
    // 回调是公开接口：先按 IP 限流，避免有人用垃圾请求把 pay_notifies 表刷满
    const notifyLimit = Number(await this.settings.get<number>('commerce.notifyRateLimit')) || 120;
    if (!this.rate.tryConsume(`payNotify:${toStr(ip, 'unknown', 64)}`, notifyLimit, 60_000)) {
      this.logger.warn(`支付回调被限流 ip=${ip}`);
      return { ok: false, message: 'too many requests' };
    }

    const name = toStr(provider, '', 20).toLowerCase();
    const raw = JSON.stringify(params).slice(0, 4000);
    const record = await this.prisma.payNotify.create({
      data: {
        provider: name,
        orderId: toStr(params.out_trade_no ?? params.trade_order_id, '', 64),
        tradeId: toStr(params.trade_no ?? params.transaction_id, '', 64),
        verified: false,
        raw,
        ip: toStr(ip, '', 64),
      },
    });

    const fail = async (message: string): Promise<NotifyResult> => {
      await this.prisma.payNotify.update({
        where: { id: record.id },
        data: { error: message.slice(0, 500) },
      });
      this.logger.warn(`支付回调被拒绝（${name}）：${message}`);
      return { ok: false, message };
    };

    if (!(PROVIDERS as readonly string[]).includes(name) || name === 'mock') {
      return fail('未知的支付渠道');
    }

    const verified = await this.verify(name as Provider, params);
    if (!verified.ok) {
      await this.prisma.payNotify.update({ where: { id: record.id }, data: { error: verified.error } });
      this.logger.warn(`支付回调验签失败（${name}）：${verified.error}`);
      return { ok: false, message: verified.error };
    }

    const order = await this.prisma.order.findUnique({ where: { orderId: verified.orderId } });
    if (!order) return fail('订单不存在');

    if (order.status === ORDER_STATUS.PAID) {
      // 重复回调：幂等返回成功，不再发货
      await this.prisma.payNotify.update({
        where: { id: record.id },
        data: { verified: true, handled: true, amountCents: verified.amountCents, orderId: order.orderId },
      });
      return { ok: true, message: 'ok', orderId: order.orderId, fulfilled: false };
    }
    if (order.status !== ORDER_STATUS.UNPAID) {
      return fail(`订单状态不允许支付（当前 ${order.status}）`);
    }
    if (verified.amountCents !== order.totalCents) {
      const msg = `金额不一致：订单 ${order.totalCents} 分，回调 ${verified.amountCents} 分`;
      await this.prisma.payNotify.update({ where: { id: record.id }, data: { error: msg } });
      return { ok: false, message: msg };
    }

    const fulfilled = await this.fulfill(order, name as Provider, verified.tradeId);
    await this.prisma.payNotify.update({
      where: { id: record.id },
      data: {
        verified: true,
        handled: fulfilled,
        amountCents: verified.amountCents,
        orderId: order.orderId,
        tradeId: verified.tradeId,
      },
    });
    return { ok: fulfilled, message: fulfilled ? 'ok' : '订单已被处理', orderId: order.orderId, fulfilled };
  }

  /** 验签 + 解析。返回订单号与金额（分） */
  private async verify(
    provider: Provider,
    params: Record<string, unknown>,
  ): Promise<{ ok: true; orderId: string; tradeId: string; amountCents: number } | { ok: false; error: string }> {
    if (provider === 'epay') {
      const key = env(PAY_ENV.epayKey);
      if (!key) return { ok: false, error: '未配置易支付密钥' };
      const sign = toStr(params.sign, '', 64).toLowerCase();
      const expected = md5(`${signString(params, ['sign', 'sign_type'])}${key}`);
      if (!sign || sign !== expected) return { ok: false, error: '签名不匹配' };
      if (toStr(params.trade_status, '') !== 'TRADE_SUCCESS') {
        return { ok: false, error: `交易未成功（${toStr(params.trade_status, '')}）` };
      }
      const amountCents = yuanToCents(toStr(params.money, ''));
      if (amountCents === null) return { ok: false, error: '金额格式不正确' };
      const orderId = toStr(params.out_trade_no, '', 64);
      if (!orderId) return { ok: false, error: '缺少 out_trade_no' };
      return { ok: true, orderId, tradeId: toStr(params.trade_no, '', 64), amountCents };
    }

    if (provider === 'hupi') {
      const appkey = env(PAY_ENV.hupiAppKey);
      if (!appkey) return { ok: false, error: '未配置虎皮椒密钥' };
      const appid = toStr(params.appid, '');
      const configured = env(PAY_ENV.hupiAppId);
      if (configured && appid !== configured) return { ok: false, error: 'appid 不匹配' };
      const hash = toStr(params.hash, '', 64).toLowerCase();
      const time = toStr(params.time, '');
      const transactionId = toStr(params.transaction_id, '');
      const openOrderId = toStr(params.open_order_id, '');
      // 虎皮椒回调签名：md5(appid + time + transaction_id + open_order_id + appkey)
      const expected = md5(`${appid}${time}${transactionId}${openOrderId}${appkey}`);
      if (!hash || hash !== expected) return { ok: false, error: '签名不匹配' };
      if (toStr(params.status, '') !== 'OD') return { ok: false, error: '交易未成功' };
      const amountCents = yuanToCents(toStr(params.total_fee, ''));
      if (amountCents === null) return { ok: false, error: '金额格式不正确' };
      const orderId = toStr(params.trade_order_id, '', 64);
      if (!orderId) return { ok: false, error: '缺少 trade_order_id' };
      return { ok: true, orderId, tradeId: transactionId, amountCents };
    }

    return { ok: false, error: '未实现的支付渠道' };
  }

  // ---------------------------------------------------------------------------
  // 履约
  // ---------------------------------------------------------------------------

  /**
   * 把订单标记为已支付并发放商品，全过程一个事务。
   * 返回 false 表示这笔订单已经被别的并发回调处理过。
   */
  async fulfill(
    order: {
      id: string;
      orderId: string;
      userId: string;
      goodsId: string;
      goodsType: string;
      goodsName: string;
      count: number;
      totalCents: number;
    },
    provider: string,
    tradeId: string,
  ): Promise<boolean> {
    const defaultBps = Number(await this.settings.get<number>('commerce.defaultCommissionBps')) || 0;
    const timeout = orderTimeout(await this.settings.get<number>('commerce.orderTimeoutMinutes'));

    return this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { id: order.id, status: ORDER_STATUS.UNPAID, ...overdueOrders(new Date(), timeout) }, data: { status: ORDER_STATUS.CLOSED } });
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: ORDER_STATUS.UNPAID },
        data: { status: ORDER_STATUS.PAID, paydAt: new Date(), payPlatform: provider, tradeId },
      });
      if (claimed.count !== 1) return false;
      const accepted = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      await this.ledger.ensureTx(tx, accepted.userId);

      if (accepted.goodsType === 'money') {
        await this.ledger.grantTx(tx, accepted.userId, {
          amountCents: accepted.totalCents,
          rechargeType: 'order',
          pkgName: accepted.goodsName,
          remark: `订单 ${accepted.orderId} 支付成功`,
        });
      } else {
        // New orders use accepted entitlements; only legacy orders without a snapshot use the original lookup.
        const pkg = acceptedOffer(accepted.goodsSnapshot) || await tx.cramiPackage.findUnique({ where: { id: accepted.goodsId } });
        if (!pkg) {
          // 抛错让整个事务回滚：订单保持未支付，回调记录里留下错误，由人工补发
          throw new BusinessException(ErrorCode.INTERNAL, '订单商品已不存在，请联系客服补发', 500);
        }
        const times = Math.max(1, accepted.count);
        const days = pkg.days < 0 ? -1 : pkg.days * times;
        await this.ledger.grantTx(tx, accepted.userId, {
          model3Count: pkg.model3Count * times,
          model4Count: pkg.model4Count * times,
          drawMjCount: pkg.drawMjCount * times,
          agentCount: pkg.agentCount * times,
          days,
          packageId: pkg.id,
          pkgName: pkg.name,
          rechargeType: 'order',
          remark: `订单 ${accepted.orderId} 支付成功`,
        });
      }

      await this.settleCommission(tx, accepted, defaultBps);
      return true;
    });
  }

  /**
   * 分销佣金：买家有邀请人且邀请人具备分销资格时，按万分比计佣。
   * 佣金向下取整，不允许超过订单实收。
   */
  private async settleCommission(
    tx: Prisma.TransactionClient,
    order: { orderId: string; userId: string; totalCents: number },
    defaultBps: number,
  ) {
    const buyer = await tx.user.findUnique({
      where: { id: order.userId },
      select: { invitedBy: true },
    });
    if (!buyer?.invitedBy) return;

    const inviter = await tx.user.findUnique({
      where: { id: buyer.invitedBy },
      select: { id: true, isDistribution: true },
    });
    if (!inviter?.isDistribution) return;

    const sales = await tx.salesUser.findUnique({ where: { userId: inviter.id } });
    if (!sales || !sales.enabled) return;

    const bps = sales.performanceBps > 0 ? sales.performanceBps : defaultBps;
    const cents = commissionCents(order.totalCents, bps);
    if (cents <= 0) return;

    await tx.salesUser.update({
      where: { userId: inviter.id },
      data: {
        totalCents: { increment: cents },
        distributionCents: { increment: cents },
        orderCount: { increment: 1 },
      },
    });
    await tx.salesRecord.create({
      data: {
        inviterUserId: inviter.id,
        inviteeUserId: order.userId,
        orderId: order.orderId,
        orderCents: order.totalCents,
        commissionCents: cents,
        commissionBps: bps,
        settled: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 查询 / 模拟支付
  // ---------------------------------------------------------------------------

  async status(userId: string, orderId: string, isAdmin: boolean) {
    await this.expireOrders();
    const order = await this.prisma.order.findUnique({ where: { orderId } });
    if (!order || (!isAdmin && order.userId !== userId)) {
      throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, '订单不存在', 404);
    }
    return {
      orderId: order.orderId,
      status: order.status,
      paydAt: order.paydAt,
      tradeId: order.tradeId,
      payPlatform: order.payPlatform,
      totalCents: order.totalCents,
    };
  }

  /**
   * 模拟支付成功（仅开发/演示）。
   * 三道闸：provider 必须包含 mock、非生产环境、订单必须是本人且未支付。
   */
  async mockPay(userId: string, orderId: string) {
    await this.expireOrders();
    const limit = Number(await this.settings.get<number>('commerce.mockPayRateLimit')) || 20;
    if (!this.rate.tryConsume(`mockPay:${userId}`, limit, 60_000)) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, '操作过于频繁，请稍后再试', 429);
    }

    if (process.env.NODE_ENV === 'production') {
      throw new BusinessException(ErrorCode.PAY_PROVIDER_UNAVAILABLE, '生产环境禁止模拟支付', 403);
    }
    const enabled = await this.providers();
    if (!enabled.includes('mock')) {
      throw new BusinessException(ErrorCode.PAY_PROVIDER_UNAVAILABLE, '未启用模拟支付', 503);
    }
    const order = await this.loadOwnOrder(userId, orderId);
    if (order.status !== ORDER_STATUS.UNPAID) {
      throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '该订单不是待支付状态', 409);
    }
    const fulfilled = await this.fulfill(order, 'mock', `MOCK-${Date.now()}`);
    if (!fulfilled) throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '订单状态已变化，请刷新后确认', 409);
    return {
      orderId: order.orderId,
      paid: fulfilled,
      status: ORDER_STATUS.PAID,
      amountCents: order.totalCents,
      amountYuan: formatCents(order.totalCents),
    };
  }

  private async loadOwnOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { orderId: toStr(orderId, '', 64) } });
    if (!order || order.userId !== userId) {
      throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, '订单不存在', 404);
    }
    return order;
  }
}
