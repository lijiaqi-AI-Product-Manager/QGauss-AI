import { Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { acceptedOffer, captureOffer, offerRevision, orderGrantRemark, packageOrderGrant, validOffer, orderTimeout, overdueOrders } from './order-offer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { commissionCents, formatCents, yuanToCents } from '../../common/money/money';
import { page, toInt, toStr } from '../../common/params';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';

/**
 * 订单
 *
 * 状态机（保留既有数字约定）：
 *   0 未支付 ——create--> 1 已支付
 *   0 未支付 ——超时/手动关闭--> 3 已关闭
 *   0 未支付 ——渠道返回失败--> 2 支付失败
 *   4 已退款是历史状态，退款凭证需另外核实。
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

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_NOTICE_LIMIT = 12;

function orderReviewDay(value: unknown): Date | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const utc = new Date(value + 'T00:00:00Z');
    if (Number.isFinite(utc.getTime()) && utc.toISOString().slice(0, 10) === value) {
      return new Date(utc.getTime() - 8 * 60 * 60 * 1000);
    }
  }
  throw new BusinessException(ErrorCode.PARAM_INVALID, '下单日期格式不正确', 400);
}

function reviewOffer(order: { goodsType: string; goodsSnapshot: string }) {
  if (order.goodsType !== 'package') return { offer: null, unreadable: false };
  try {
    return { offer: acceptedOffer(order.goodsSnapshot), unreadable: false };
  } catch {
    return { offer: null, unreadable: true };
  }
}

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
  async manage(q: Record<string, unknown>) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.OrderWhereInput = {};
    if (q.status !== undefined && q.status !== '') where.status = toInt(q.status, 0, 0, 4, '状态');
    const userId = toStr(q.userId, '', 40);
    if (userId) where.userId = userId;
    const keyword = toStr(q.keyword, '', 64).trim();
    if (keyword) where.OR = [{ orderId: { contains: keyword } }, { tradeId: { contains: keyword } }];
    const platform = toStr(q.platform, '', 20).trim();
    if (platform) where.payPlatform = platform;
    const from = orderReviewDay(q.fromDay);
    const through = orderReviewDay(q.throughDay);
    if (from && through && through < from) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '结束日期应晚于或等于开始日期', 400);
    }
    if (from || through) {
      where.createdAt = { gte: from, lt: through && new Date(through.getTime() + DAY_MS) };
    }

    await this.expireStale();
    const [items, groups] = await this.prisma.$transaction(async tx => {
      const groups = await tx.order.groupBy({
        where, by: ['status', 'payPlatform'],
        _count: { _all: true }, _sum: { totalCents: true },
      });
      const items = await tx.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take });
      return [items, groups] as const;
    });
    let total = 0;
    const overview = { paidCents: 0, demoCents: 0, waitingCount: 0 };
    for (const group of groups) {
      total += group._count._all;
      if (group.status === ORDER_STATUS.UNPAID) overview.waitingCount += group._count._all;
      if (group.status === ORDER_STATUS.PAID) {
        const key = group.payPlatform === 'mock' ? 'demoCents' : 'paidCents';
        overview[key] += group._sum.totalCents ?? 0;
      }
    }
    return { items: items.map(o => this.view(o, reviewOffer(o).offer)), total, page: p, pageSize, overview };
  }

  /** 核对站内收款、权益及佣金凭证，按同一读快照比较。 */
  async review(orderId: string) {
    return this.prisma.$transaction(async tx => {
      const order = await tx.order.findUnique({ where: { orderId: toStr(orderId, '', 64) } });
      if (!order) throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, '订单不存在', 404);

      const paid = order.status === ORDER_STATUS.PAID;
      const refunded = order.status === ORDER_STATUS.REFUNDED;
      const completedPayment = paid || refunded;
      const demo = order.payPlatform === 'mock';
      const scope = { orderId: order.orderId };
      const verified = { ...scope, verified: true };
      const sort = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
      const [notices, matchingNotice, conflict, grants, commissions] = await Promise.all([
        tx.payNotify.findMany({
          where: scope, orderBy: sort, take: REVIEW_NOTICE_LIMIT + 1,
          select: { id: true, provider: true, tradeId: true, amountCents: true, verified: true, handled: true, createdAt: true },
        }),
        completedPayment && !demo && order.tradeId && order.payPlatform
          ? tx.payNotify.findFirst({
              where: { ...verified, handled: true, provider: order.payPlatform, tradeId: order.tradeId, amountCents: order.totalCents },
              select: { id: true },
            })
          : null,
        tx.payNotify.findFirst({
          where: completedPayment ? {
            ...verified,
            OR: [
              { amountCents: { not: order.totalCents } },
              { provider: { not: order.payPlatform } },
              { tradeId: { not: order.tradeId } },
            ],
          } : verified,
          select: { id: true },
        }),
        tx.accountLog.findMany({
          where: { userId: order.userId, rechargeType: 'order', remark: orderGrantRemark(order.orderId) },
          orderBy: sort, take: 2,
          select: { id: true, packageId: true, amountCents: true, model3Count: true, model4Count: true, drawMjCount: true, agentCount: true, days: true, createdAt: true },
        }),
        tx.salesRecord.findMany({
          where: scope, orderBy: sort, take: 2,
          select: { id: true, inviteeUserId: true, orderCents: true, commissionCents: true, commissionBps: true, settled: true, createdAt: true },
        }),
      ]);

      const { offer, unreadable } = reviewOffer(order);
      const expectedGrant = order.goodsType === 'money' ? { amountCents: order.totalCents } : offer ? packageOrderGrant(offer, order.count) : null;
      const findings: string[] = [];
      if (conflict) findings.push(completedPayment ? '已验证通知与订单的金额、渠道或交易号不符' : '存在已验证的支付通知，订单尚未记为已支付');
      if (completedPayment && !demo && !matchingNotice) findings.push('缺少与订单匹配且已处理的支付通知');
      if (unreadable) findings.push('下单权益快照无法读取');
      else if (completedPayment && order.goodsType === 'package' && !offer) findings.push('旧订单缺少下单权益快照');

      if (completedPayment && grants.length === 0) findings.push('缺少权益到账凭证');
      if (!completedPayment && grants.length > 0) findings.push('未确认收款的订单存在权益到账凭证');
      if (grants.length > 1) findings.push('同一订单存在多条权益到账凭证');
      if (expectedGrant && grants.some(grant =>
        Object.entries(expectedGrant).some(([key, value]) => grant[key as keyof typeof grant] !== value) ||
        (offer && (grant.packageId !== offer.id || grant.amountCents !== 0))
      )) findings.push('实际到账与下单权益不符');
      if (commissions.length > 1) findings.push('同一订单存在多条佣金凭证');
      if (commissions.some(commission =>
        !completedPayment || !commission.settled || commission.inviteeUserId !== order.userId ||
        commission.orderCents !== order.totalCents ||
        commission.commissionCents <= 0 || commission.commissionBps > 10_000 ||
        commission.commissionCents !== commissionCents(order.totalCents, commission.commissionBps)
      )) findings.push('佣金凭证需人工核对');
      if (refunded) findings.push('退款凭证需在线下核对');

      return {
        order: this.view(order, offer),
        state: findings.length ? 'attention' : paid ? (demo ? 'demo' : 'matched') : 'open',
        findings, expectedGrant,
        matchedNotification: !!matchingNotice,
        notices: notices.slice(0, REVIEW_NOTICE_LIMIT).map(notice => ({
          ...notice,
          tradeId: notice.verified ? notice.tradeId : null,
          amountCents: notice.verified ? notice.amountCents : null,
        })),
        moreNotices: notices.length > REVIEW_NOTICE_LIMIT,
        grants: grants.map(({ packageId, ...grant }) => grant),
        commissions: commissions.map(({ inviteeUserId, ...commission }) => commission),
      };
    });
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
  }, entitlements = o.goodsType === 'package' ? acceptedOffer(o.goodsSnapshot) : null) {
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
      entitlements,
      legacyEntitlements: o.goodsType === 'package' && !o.goodsSnapshot,
    };
  }
}
