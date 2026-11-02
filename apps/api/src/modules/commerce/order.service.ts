import { Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { acceptedOffer, captureOffer, offerRevision, validOffer, orderTimeout, overdueOrders } from './order-offer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { formatCents, yuanToCents } from '../../common/money/money';
import { page, toInt, toStr } from '../../common/params';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';

/**
 * 订单
 *
 * 状态机（保留既有数字约定）：
 *   0 未支付 ——create--> 1 已支付
 *   0 未支付 ——超时/手动关闭--> 3 已关闭
 *   0 未支付 ——渠道返回失败--> 2 支付失败
 *   1 已支付 ——后台退款--> 4 已退款
 * 只有 0 可以迁移到 1，这个约束由 `updateMany({ status: 0 })` 的影响行数保证。
 */

export const ORDER_STATUS = {
  UNPAID: 0,
  PAID: 1,
  FAILED: 2,
  CLOSED: 3,
  REFUNDED: 4,
} as const;

const STATUS_TEXT: Record<number, string> = {
  0: '未支付',
  1: '已支付',
  2: '支付失败',
  3: '已关闭',
  4: '已退款',
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rate: RateLimitService,
  ) {}

  /**
   * 惰性关单：不依赖定时任务，任何一次读订单都顺手把过期的未支付单关掉。
   * 单实例没问题；多实例也安全，因为条件里带了 status=0。
   */
  async expireStale() {
    const timeout = orderTimeout(await this.settings.get<number>('commerce.orderTimeoutMinutes'));
    const now = new Date();
    const res = await this.prisma.order.updateMany({
      where: { status: ORDER_STATUS.UNPAID, ...overdueOrders(now, timeout) },
      data: { status: ORDER_STATUS.CLOSED },
    });
    return res.count;
  }

  /** Create one accepted order for each optional client intent key. */
  async create(userId: string, dto: Record<string, unknown>) {
    const goodsType = toStr(dto.goodsType, 'package', 20);
    if (!['package', 'money'].includes(goodsType)) throw new BusinessException(ErrorCode.PARAM_INVALID, '不支持的 goodsType');
    const count = toInt(dto.count, 1, 1, 99, '数量');
    const channel = toStr(dto.channel, '', 20);
    const requestKey = dto.requestKey === undefined ? null : dto.requestKey;
    if (dto.requestKey !== undefined && (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(requestKey))) throw new BusinessException(ErrorCode.PARAM_INVALID, '下单请求标识无效', 400);
    const expected = dto.expectedOfferRevision;
    if (expected !== undefined && (goodsType !== 'package' || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐确认版本无效', 400);
    let goodsId = goodsType === 'package' ? toStr(dto.goodsId, '', 64) : '';
    let moneyCents = 0;
    if (goodsType === 'package' && !goodsId) throw new BusinessException(ErrorCode.PARAM_INVALID, '缺少套餐 goodsId');
    if (goodsType === 'money') {
      const cents = yuanToCents(dto.amountYuan ?? dto.amount);
      if (cents === null || cents <= 0 || cents > 2147483647) throw new BusinessException(ErrorCode.PARAM_INVALID, '充值金额格式或范围不正确', 400);
      moneyCents = cents; goodsId = String(cents);
    }
    const requestHash = createHash('sha256').update(JSON.stringify({ goodsType, goodsId, count, channel, expected: expected ?? '' })).digest('hex');
    await this.expireStale();
    const replay = async (db: Prisma.TransactionClient | PrismaService) => {
      if (!requestKey) return null;
      const prior = await db.order.findUnique({ where: { userId_requestKey: { userId, requestKey: requestKey as string } } });
      if (prior && prior.requestHash !== requestHash) throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '同一下单标识不能用于不同选择，请重新确认', 409);
      return prior ? { ...this.view(prior), reused: true } : null;
    };
    const prior = await replay(this.prisma);
    if (prior) return prior;
    const limit = Number(await this.settings.get<number>('commerce.orderRateLimit')) || 20;
    if (!this.rate.tryConsume('orderCreate:' + userId, limit, 60000)) throw new BusinessException(ErrorCode.RATE_LIMITED, '下单过于频繁，请稍后再试', 429);
    const timeout = orderTimeout(await this.settings.get<number>('commerce.orderTimeoutMinutes'));
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "orders" SET "status" = "status" WHERE "id" = (SELECT "id" FROM "orders" WHERE "userId" = ${userId} LIMIT 1)`;
      const duplicate = await replay(tx);
      if (duplicate) return duplicate;
      let goodsName = '', priceCents = moneyCents, goodsSnapshot = '';
      if (goodsType === 'package') {
        const pkg = await tx.cramiPackage.findFirst({ where: { id: goodsId, deletedAt: null, status: 1 } });
        if (!pkg) throw new BusinessException(ErrorCode.NOT_FOUND, '套餐已下架或不存在，请重新选择', 404);
        const offer = captureOffer(pkg);
        if (!validOffer(offer) || !offer.priceCents) throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐金额或权益配置无效', 400);
        if (expected !== undefined && expected !== offerRevision(offer)) throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '套餐内容或价格已更新，请重新确认后下单', 409);
        for (const value of [offer.model3Count, offer.model4Count, offer.drawMjCount, offer.agentCount]) if (value * count > 2147483647) throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐数量超过可发放范围', 400);
        goodsName = offer.name; priceCents = offer.priceCents; goodsSnapshot = JSON.stringify(offer);
      } else goodsName = '余额充值 ' + formatCents(moneyCents) + ' 元';
      const totalCents = priceCents * count;
      if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 2147483647) throw new BusinessException(ErrorCode.PARAM_INVALID, '订单金额超过有效范围', 400);
      const createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + timeout);
      if (!Number.isFinite(expiresAt.getTime())) throw new BusinessException(ErrorCode.PARAM_INVALID, '订单有效期配置无效', 400);
      const order = await tx.order.create({ data: { orderId: randomUUID().replace(/-/g, ''), userId, goodsId, goodsType, goodsName, count, priceCents, totalCents, status: ORDER_STATUS.UNPAID, channel, requestKey: requestKey as string | null, requestHash, goodsSnapshot, createdAt, expiresAt } });
      return { ...this.view(order), reused: false };
    });
  }

  /** 我的订单 */
  async list(userId: string, q: { page?: unknown; pageSize?: unknown; status?: unknown }) {
    await this.expireStale();
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.OrderWhereInput = { userId };
    if (q.status !== undefined && q.status !== '') where.status = toInt(q.status, 0, 0, 4, '状态');
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.order.count({ where }),
    ]);
    return { items: items.map((o) => this.view(o)), total, page: p, pageSize };
  }

  /** 订单详情：本人或管理员 */
  async detail(userId: string, orderId: string, isAdmin: boolean) {
    await this.expireStale();
    const order = await this.prisma.order.findUnique({ where: { orderId } });
    if (!order) throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, '订单不存在', 404);
    if (!isAdmin && order.userId !== userId) {
      // 不泄露「订单存在但不属于你」
      throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, '订单不存在', 404);
    }
    return this.view(order);
  }

  /** 后台订单列表 */
  async manage(q: { page?: unknown; pageSize?: unknown; status?: unknown; userId?: unknown; keyword?: unknown }) {
    await this.expireStale();
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.OrderWhereInput = {};
    if (q.status !== undefined && q.status !== '') where.status = toInt(q.status, 0, 0, 4, '状态');
    const userId = toStr(q.userId, '', 40);
    if (userId) where.userId = userId;
    const keyword = toStr(q.keyword, '', 64).trim();
    if (keyword) where.OR = [{ orderId: { contains: keyword } }, { tradeId: { contains: keyword } }];

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.order.count({ where }),
    ]);
    return { items: items.map((o) => this.view(o)), total, page: p, pageSize };
  }

  /** 关闭未支付订单（用户主动取消） */
  async close(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { orderId } });
    if (!order || order.userId !== userId) {
      throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, '订单不存在', 404);
    }
    if (order.status !== ORDER_STATUS.UNPAID) {
      throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '只有未支付的订单可以关闭', 409);
    }
    const res = await this.prisma.order.updateMany({
      where: { id: order.id, status: ORDER_STATUS.UNPAID },
      data: { status: ORDER_STATUS.CLOSED },
    });
    if (res.count !== 1) {
      throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '订单状态已变化，请刷新后重试', 409);
    }
    return { orderId, status: ORDER_STATUS.CLOSED, statusText: STATUS_TEXT[ORDER_STATUS.CLOSED] };
  }

  view(o: {
    orderId: string;
    goodsType: string;
    goodsId: string;
    goodsName: string;
    count: number;
    priceCents: number;
    totalCents: number;
    status: number;
    payPlatform: string;
    tradeId: string;
    channel: string;
    paydAt: Date | null;
    createdAt: Date;
    goodsSnapshot?: string;
    expiresAt?: Date | null;
  }) {
    return {
      orderId: o.orderId,
      goodsType: o.goodsType,
      goodsId: o.goodsId,
      goodsName: o.goodsName,
      count: o.count,
      priceCents: o.priceCents,
      totalCents: o.totalCents,
      totalYuan: formatCents(o.totalCents),
      status: o.status,
      statusText: STATUS_TEXT[o.status] ?? '未知',
      payPlatform: o.payPlatform,
      tradeId: o.tradeId,
      channel: o.channel,
      paydAt: o.paydAt,
      createdAt: o.createdAt,
      expiresAt: o.expiresAt ?? null,
      entitlements: o.goodsType === 'package' ? acceptedOffer(o.goodsSnapshot) : null,
      legacyEntitlements: o.goodsType === 'package' && !o.goodsSnapshot,
    };
  }
}
