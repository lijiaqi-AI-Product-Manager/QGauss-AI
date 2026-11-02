import { Injectable, Logger } from '@nestjs/common';
import { randomInt, createHash } from 'node:crypto';
import { Prisma, SalesOrder } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { formatBps, formatCents, yuanToCents } from '../../common/money/money';
import { page, toBool, toInt, toStr } from '../../common/params';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';

/**
 * 分销
 *
 * 资金流：
 *   买家下单 → 支付成功 → 按邀请人的万分比计佣
 *     → sales_users.totalCents（累计）与 distributionCents（可提现）同时增加
 *   申请提现 → distributionCents 立即扣减、withdrawalCents 增加（冻结）
 *     → 审核通过：钱在站外打给用户；审核驳回：冻结金额退回 distributionCents
 *
 * 为什么提现要在申请时就扣：如果等到审核通过再扣，用户可以在审核期间
 * 反复申请，把同一笔佣金提多次。先扣后审是唯一不会出事的顺序。
 */

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomInviteCode(): string {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return out;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rate: RateLimitService,
  ) {}

  /** 懒生成邀请码：老用户第一次查看分销页时补一个，不要求迁移时批量回填 */
  async ensureInviteCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
    if (user?.inviteCode) return user.inviteCode;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomInviteCode();
      try {
        const res = await this.prisma.user.updateMany({
          where: { id: userId, inviteCode: null },
          data: { inviteCode: code },
        });
        if (res.count === 1) return code;
        // 0 行说明并发下已经被别的请求写入，重新读一次即可
        const again = await this.prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
        if (again?.inviteCode) return again.inviteCode;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    throw new BusinessException(ErrorCode.INTERNAL, '邀请码生成失败，请重试', 500);
  }


  /** Affiliate flag and account row commit together; retry keeps the original rate and enabled state. */
  async apply(userId: string, dto: Record<string, unknown>) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, username: true, isDistribution: true } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);
    if (user.isDistribution && await this.prisma.salesUser.findUnique({ where: { userId } })) return this.info(userId);
    await this.ensureInviteCode(userId);
    const defaultBps = toInt(await this.settings.get<number>('commerce.defaultCommissionBps'), 0, 0, 10000, '佣金比例'), name = this.inputText(dto.salesOutletName ?? user.username, 60, '推广名称', true);
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.user.updateMany({ where: { id: userId, deletedAt: null }, data: { isDistribution: true } });
      if (claimed.count !== 1) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);
      await tx.salesUser.upsert({ where: { userId }, update: {}, create: { userId, performanceBps: defaultBps, salesOutletName: name } });
    });
    return this.info(userId);
  }

  private async withdrawalPolicy() { return { minCents: toInt(await this.settings.get<number>('commerce.minWithdrawalCents'), 1000, 1, 100000000, '最低提现额'), maxCents: 100000000 }; }

  /** One read transaction; legacy withdrawalCents includes pending and accepted applications. */
  async info(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { isDistribution: true } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);
    if (!user.isDistribution) throw new BusinessException(ErrorCode.SALES_NOT_ENABLED, '你还没有开通分销资格', 403);
    const [snapshot, policy, inviteCode] = await Promise.all([
      this.prisma.$transaction(async tx => {
        const sales = await tx.salesUser.findUnique({ where: { userId } }), inviteeCount = await tx.user.count({ where: { invitedBy: userId } });
        const records = await tx.salesRecord.aggregate({ where: { inviterUserId: userId }, _count: { _all: true }, _sum: { commissionCents: true } });
        const withdrawals = await tx.salesOrder.groupBy({ by: ['orderStatus', 'paymentStatus'], where: { userId }, _sum: { amountCents: true } });
        return { sales, inviteeCount, records, withdrawals };
      }), this.withdrawalPolicy(), this.ensureInviteCode(userId),
    ]);
    const { sales, inviteeCount, records, withdrawals } = snapshot;
    if (!sales) throw new BusinessException(ErrorCode.SALES_NOT_ENABLED, '分销账户不存在', 403);
    const summary = { pendingCents: 0, approvedUnpaidCents: 0, paidCents: 0, rejectedCents: 0 };
    for (const row of withdrawals) {
      const cents = row._sum.amountCents ?? 0;
      if (row.orderStatus === 0) summary.pendingCents += cents;
      else if (row.orderStatus === 2) summary.rejectedCents += cents;
      else if (row.orderStatus === 1 && row.paymentStatus === 1) summary.paidCents += cents;
      else if (row.orderStatus === 1) summary.approvedUnpaidCents += cents;
    }
    return {
      enabled: sales.enabled, inviteCode, performanceBps: sales.performanceBps, performancePct: formatBps(sales.performanceBps), salesOutletName: sales.salesOutletName,
      totalCents: sales.totalCents, totalYuan: formatCents(sales.totalCents), distributionCents: sales.distributionCents, distributionYuan: formatCents(sales.distributionCents),
      withdrawalCents: sales.withdrawalCents, withdrawalYuan: formatCents(sales.withdrawalCents), orderCount: sales.orderCount, inviteeCount,
      recordCount: records._count._all, recordSumCents: records._sum.commissionCents ?? 0, withdrawalPolicy: policy, withdrawalSummary: summary,
    };
  }
  private inputText(value: unknown, max: number, label: string, empty = false): string {
    if (typeof value !== 'string' || value.trim().length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new BusinessException(ErrorCode.PARAM_INVALID, label + '格式不正确', 400);
    return value.trim();
  }
  private queryText(value: unknown, max: number, label: string): string { if (value === undefined || value === '') return ''; return this.inputText(value, max, label, true); }
  private intentKey(value: unknown): string | null {
    if (value === undefined) return null;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) throw new BusinessException(ErrorCode.PARAM_INVALID, '提现请求标识无效', 400);
    return value;
  }
  private safePage(q: { page?: unknown; pageSize?: unknown }) {
    for (const value of [q.page, q.pageSize]) if (value !== undefined && (typeof value !== 'string' && typeof value !== 'number' || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1000000)) throw new BusinessException(ErrorCode.PARAM_INVALID, '分页参数无效', 400);
    return page(q);
  }
  private withdrawalView(order: SalesOrder) {
    const { requestKey: _key, requestHash: _hash, ...row } = order;
    return { ...row, amountYuan: formatCents(order.amountCents), statusText: this.withdrawText(order.orderStatus) };
  }
  async records(userId: string, q: { page?: unknown; pageSize?: unknown; keyword?: unknown }) {
    const { skip, take, page: p, pageSize } = this.safePage(q), keyword = this.queryText(q.keyword, 64, '订单号');
    const where: Prisma.SalesRecordWhereInput = { inviterUserId: userId, ...(keyword ? { orderId: { contains: keyword } } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.salesRecord.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }), this.prisma.salesRecord.count({ where })]);
    return { items, total, page: p, pageSize };
  }
  async withdrawals(userId: string, q: { page?: unknown; pageSize?: unknown; stage?: unknown; id?: unknown; requestKey?: unknown }) {
    const { skip, take, page: p, pageSize } = this.safePage(q), stage = this.queryText(q.stage, 20, '申请状态'), id = this.queryText(q.id, 64, '申请编号'), requestKey = this.intentKey(q.requestKey);
    if (stage && !['pending', 'approved', 'paid', 'rejected'].includes(stage)) throw new BusinessException(ErrorCode.PARAM_INVALID, '申请状态无效', 400);
    const where: Prisma.SalesOrderWhereInput = { userId, ...(id ? { id } : {}), ...(requestKey ? { requestKey } : {}) };
    if (stage) Object.assign(where, stage === 'pending' ? { orderStatus: 0 } : stage === 'rejected' ? { orderStatus: 2 } : { orderStatus: 1, paymentStatus: stage === 'paid' ? 1 : 0 });
    const [items, total] = await this.prisma.$transaction([this.prisma.salesOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }), this.prisma.salesOrder.count({ where })]);
    return { items: items.map(row => this.withdrawalView(row)), total, page: p, pageSize };
  }
  async withdraw(userId: string, dto: Record<string, unknown>) {
    let amountCents: number;
    if (dto.amountYuan !== undefined && dto.amountYuan !== null && dto.amountYuan !== '') {
      const cents = yuanToCents(dto.amountYuan);
      if (cents === null) throw new BusinessException(ErrorCode.PARAM_INVALID, '提现金额格式不正确', 400);
      amountCents = cents;
    } else {
      if (typeof dto.amountCents !== 'number' && typeof dto.amountCents !== 'string') throw new BusinessException(ErrorCode.PARAM_INVALID, '提现金额格式不正确', 400);
      amountCents = toInt(dto.amountCents, 0, 1, 100000000, '提现金额（分）');
    }
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100000000) throw new BusinessException(ErrorCode.PARAM_INVALID, '提现金额超出有效范围', 400);
    if (dto.channels !== undefined && typeof dto.channels !== 'string' && typeof dto.channels !== 'number') throw new BusinessException(ErrorCode.PARAM_INVALID, '收款方式无效', 400);
    const channels = toInt(dto.channels, 1, 1, 3, '收款方式'), contact = this.inputText(dto.contact, 120, '收款账号'), remark = dto.remark === undefined ? '' : this.inputText(dto.remark, 200, '申请备注', true), requestKey = this.intentKey(dto.requestKey);
    const requestHash = createHash('sha256').update(JSON.stringify({ amountCents, channels, contact, remark })).digest('hex');
    const replay = async (db: Prisma.TransactionClient | PrismaService) => {
      if (!requestKey) return null;
      const prior = await db.salesOrder.findUnique({ where: { userId_requestKey: { userId, requestKey } } });
      if (prior && prior.requestHash !== requestHash) throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '同一提现请求不能更换金额或收款信息，请查询原申请', 409);
      return prior ? { ...this.withdrawalView(prior), reused: true } : null;
    };
    const prior = await replay(this.prisma); if (prior) return prior;
    const limit = Number(await this.settings.get<number>('commerce.withdrawRateLimit')) || 5;
    if (!this.rate.tryConsume('salesWithdraw:' + userId, limit, 60000)) throw new BusinessException(ErrorCode.RATE_LIMITED, '提现申请过于频繁，请稍后再试', 429);
    const sales = await this.prisma.salesUser.findUnique({ where: { userId } });
    if (!sales || !sales.enabled) throw new BusinessException(ErrorCode.SALES_NOT_ENABLED, '分销账户不存在或已停用', 403);
    const policy = await this.withdrawalPolicy();
    if (amountCents < policy.minCents) throw new BusinessException(ErrorCode.WITHDRAWAL_INVALID, '最低提现 ' + formatCents(policy.minCents) + ' 元', 400);
    return this.prisma.$transaction(async tx => {
      // Acquire SQLite's writer before transaction reads. This advances updatedAt but preserves money.
      await tx.salesUser.updateMany({ where: { userId }, data: { distributionCents: { increment: 0 } } });
      const duplicate = await replay(tx); if (duplicate) return duplicate;
      const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null, isDistribution: true }, select: { id: true } });
      if (!user) throw new BusinessException(ErrorCode.SALES_NOT_ENABLED, '推广账户不可申请提现', 403);
      const claimed = await tx.salesUser.updateMany({
        where: { userId, distributionCents: { gte: amountCents }, withdrawalCents: { lte: 2147483647 - amountCents }, enabled: true },
        data: { distributionCents: { decrement: amountCents }, withdrawalCents: { increment: amountCents } },
      });
      if (claimed.count !== 1) throw new BusinessException(ErrorCode.WITHDRAWAL_INVALID, '可提现余额不足或账户额度异常', 400);
      const order = await tx.salesOrder.create({ data: { userId, amountCents, channels, contact, remark, requestKey, requestHash } });
      return { ...this.withdrawalView(order), reused: false };
    });
  }

  // ---------------------------------------------------------------------------
  // 后台
  // ---------------------------------------------------------------------------

  /** 分销员列表（含用户信息，SalesUser 与 User 之间没有外键，手工拼） */
  async manage(q: { page?: unknown; pageSize?: unknown; enabled?: unknown; keyword?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.SalesUserWhereInput = {};
    if (q.enabled !== undefined && q.enabled !== '') where.enabled = toBool(q.enabled, true);

    // 关键词必须进 where，不能拉一页回来再在内存里过滤：
    // 否则「搜不到第 2 页的人」，而且 total 也不是搜索结果的数量。
    const keyword = toStr(q.keyword, '', 60).trim();
    if (keyword) {
      const matched = await this.prisma.user.findMany({
        where: { OR: [{ username: { contains: keyword } }, { email: { contains: keyword } }] },
        select: { id: true },
        take: 500,
      });
      where.OR = [
        { userId: { in: matched.map((u) => u.id) } },
        { salesOutletName: { contains: keyword } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.salesUser.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.salesUser.count({ where }),
    ]);

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, username: true, email: true, inviteCode: true, invitedBy: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const items = rows.map((r) => {
      const u = userMap.get(r.userId);
      return {
        ...r,
        totalYuan: formatCents(r.totalCents),
        distributionYuan: formatCents(r.distributionCents),
        withdrawalYuan: formatCents(r.withdrawalCents),
        performancePct: formatBps(r.performanceBps),
        username: u?.username ?? '',
        email: u?.email ?? '',
        inviteCode: u?.inviteCode ?? '',
      };
    });

    return { items, total, page: p, pageSize };
  }

  /** 修改分销员：佣金比例 / 启停 */
  async manageUpdate(userId: string, dto: Record<string, unknown>) {
    const sales = await this.prisma.salesUser.findUnique({ where: { userId } });
    if (!sales) throw new BusinessException(ErrorCode.NOT_FOUND, '分销员不存在', 404);

    const data: Prisma.SalesUserUpdateInput = {};
    if (dto.performanceBps !== undefined) {
      data.performanceBps = toInt(dto.performanceBps, sales.performanceBps, 0, 10_000, '佣金比例（万分比）');
    }
    if (dto.enabled !== undefined) data.enabled = toBool(dto.enabled, sales.enabled);
    if (dto.salesOutletName !== undefined) data.salesOutletName = toStr(dto.salesOutletName, sales.salesOutletName, 60);
    if (Object.keys(data).length === 0) return { userId, updated: false };

    const updated = await this.prisma.salesUser.update({ where: { userId }, data });
    return { userId, updated: true, enabled: updated.enabled, performanceBps: updated.performanceBps };
  }

  /** 提现申请列表（后台） */
  async auditList(q: { page?: unknown; pageSize?: unknown; orderStatus?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.SalesOrderWhereInput = {};
    if (q.orderStatus !== undefined && q.orderStatus !== '') {
      where.orderStatus = toInt(q.orderStatus, 0, 0, 2, '审核状态');
    }
    const [rows, total] = await Promise.all([
      this.prisma.salesOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.salesOrder.count({ where }),
    ]);

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, username: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      items: rows.map((o) => ({
        ...this.withdrawalView(o),
        amountYuan: formatCents(o.amountCents),
        statusText: this.withdrawText(o.orderStatus),
        username: userMap.get(o.userId)?.username ?? '',
        email: userMap.get(o.userId)?.email ?? '',
      })),
      total,
      page: p,
      pageSize,
    };
  }

  /**
   * 审核提现。
   * 通过：钱在站外打给用户，这里只记状态（paymentStatus=1 表示已打款）。
   * 驳回：把冻结的金额退回可提现余额，必须与状态更新同事务。
   */
  async audit(id: string, adminId: string, dto: Record<string, unknown>) {
    if (typeof dto.pass !== 'boolean') throw new BusinessException(ErrorCode.PARAM_INVALID, '审核结果必须是布尔值', 400);
    const pass = dto.pass;
    if (dto.paymentStatus !== undefined && typeof dto.paymentStatus !== 'number' && typeof dto.paymentStatus !== 'string') throw new BusinessException(ErrorCode.PARAM_INVALID, '打款状态无效', 400);
    const paymentStatus = pass ? toInt(dto.paymentStatus, 0, 0, 1, '打款状态') : 0;
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '提现申请不存在', 404);
    if (order.orderStatus === 1 && order.paymentStatus === 0 && pass && paymentStatus === 1) {
      const recorded = await this.prisma.salesOrder.updateMany({
        where: { id, orderStatus: 1, paymentStatus: 0 },
        data: { paymentStatus: 1, remark: toStr(dto.remark, order.remark, 200) },
      });
      if (recorded.count !== 1) throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '打款登记状态已变化，请刷新核对', 409);
      return { id, orderStatus: 1, paymentStatus: 1, statusText: this.withdrawText(1) };
    }
    if (order.orderStatus !== 0) {
      throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '该申请已处理', 409);
    }
    if (!Number.isSafeInteger(order.amountCents) || order.amountCents <= 0) throw new BusinessException(ErrorCode.INTERNAL, '申请金额异常，请核查原记录', 500);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.salesOrder.updateMany({
        where: { id, orderStatus: 0 },
        data: {
          orderStatus: pass ? 1 : 2,
          auditStatus: pass ? 1 : 2,
          auditUserId: adminId,
          auditedAt: new Date(),
          paymentStatus,
          remark: toStr(dto.remark, order.remark, 200),
        },
      });
      if (claimed.count !== 1) {
        throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '该申请已处理', 409);
      }
      if (!pass) {
        const refunded = await tx.salesUser.updateMany({
          where: { userId: order.userId, withdrawalCents: { gte: order.amountCents }, distributionCents: { lte: 2147483647 - order.amountCents } },
          data: {
            distributionCents: { increment: order.amountCents },
            withdrawalCents: { decrement: order.amountCents },
          },
        });
        if (refunded.count !== 1) throw new BusinessException(ErrorCode.INTERNAL, '冻结金额异常，已回滚审核，请核查账户', 500);
      }
      this.logger.log(`提现申请 ${id} ${pass ? '通过' : '驳回'}（审核人 ${adminId}）`);
      return { id, orderStatus: pass ? 1 : 2, paymentStatus, statusText: this.withdrawText(pass ? 1 : 2) };
    });
  }

  private withdrawText(status: number): string {
    return status === 0 ? '待审核' : status === 1 ? '已通过' : '已驳回';
  }
}
