import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { microsToCents } from '../../common/money/money';

/**
 * 账本服务 —— 商业化内核唯一的余额写入入口。
 *
 * 铁律：
 *   1. 余额只能经本服务改动；任何业务模块直接 update Balance / UserBalance 都视为缺陷。
 *   2. 每次变动必须落一条不可变流水（BalanceConsumeLog / AccountLog），先记账再返回。
 *   3. 扣减用「条件更新 + 检查影响行数」做乐观并发控制，绝不 read-modify-write。
 *   4. 扣费与退款成对出现在同一 refId 下，靠 refunded 标记保证退款幂等。
 *
 * 四个次数池：
 *   model3 低价模型 / model4 高价模型 / drawMj 绘图 / agent 智能体
 * 每个池有两个来源，扣减顺序固定为「会员每日额度 → 购买的次数」。
 *
 * 两套入口：
 *   - consume / grant / refundByRef     自带事务，供单步业务使用
 *   - consumeTx / grantTx / refundByRefTx  复用调用方事务，供「卡密核销 / 订单履约」
 *     这类必须与发放同生共死的场景使用。Prisma 不允许嵌套交互式事务，
 *     所以这类场景必须走 Tx 版本，不能在 $transaction 里再调 consume/grant。
 */

export type Pool = 'model3' | 'model4' | 'drawMj' | 'agent';

interface PoolFields {
  /** 购买的剩余次数 */
  paid: 'model3Count' | 'model4Count' | 'drawMjCount' | 'agentCount';
  /** 会员当日剩余 */
  member: 'memberModel3Count' | 'memberModel4Count' | 'memberDrawMjCount' | 'memberAgentCount';
  /** 会员每日上限 */
  daily: 'dailyModel3Count' | 'dailyModel4Count' | 'dailyDrawMjCount' | 'dailyAgentCount';
  /** 累计已用 */
  used: 'useModel3Count' | 'useModel4Count' | 'useDrawMjToken' | 'useAgentCount';
}

const POOL_FIELDS: Record<Pool, PoolFields> = {
  model3: { paid: 'model3Count', member: 'memberModel3Count', daily: 'dailyModel3Count', used: 'useModel3Count' },
  model4: { paid: 'model4Count', member: 'memberModel4Count', daily: 'dailyModel4Count', used: 'useModel4Count' },
  drawMj: { paid: 'drawMjCount', member: 'memberDrawMjCount', daily: 'dailyDrawMjCount', used: 'useDrawMjToken' },
  agent: { paid: 'agentCount', member: 'memberAgentCount', daily: 'dailyAgentCount', used: 'useAgentCount' },
};

export function isPool(value: unknown): value is Pool {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(POOL_FIELDS, value);
}

/** 永久会员的到期时间哨兵（避免用 null 表示"永久"与"无会员"混淆） */
const PERPETUAL = new Date('9999-12-31T00:00:00.000Z');

const TZ_OFFSET_MS = 8 * 3600_000;

/** Asia/Shanghai 的 yyyy-MM-dd。账本的"一天"以北京时间为准。 */
export function shanghaiDate(at: Date = new Date()): string {
  return new Date(at.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export interface GrantInput {
  model3Count?: number;
  model4Count?: number;
  drawMjCount?: number;
  agentCount?: number;
  /** 会员天数；负数表示永久 */
  days?: number;
  /** 会员每日额度上限；不传则沿用套餐/现状 */
  dailyModel3Count?: number;
  dailyModel4Count?: number;
  dailyDrawMjCount?: number;
  dailyAgentCount?: number;
  packageId?: string;
  extent?: string;
  pkgName?: string;
  /** admin | crami | order | gift | signin */
  rechargeType: string;
  amountCents?: number;
  rebateUserId?: string;
  remark?: string;
}

export interface ConsumeInput {
  pool?: Pool;
  /** 扣减次数；pool 为空时必填 cents */
  amount?: number;
  /** 扣减金额（分） */
  cents?: number;
  bizType: string;
  refId?: string;
  model?: string;
  modelName?: string;
  remark?: string;
  upstreamStatus?: number;
}

export interface CountReservationInput {
  pool: Pool;
  amount: number;
  refId: string;
  bizType: string;
  model?: string;
  modelName?: string;
}

export interface BalanceView {
  userId: string;
  /** 各池可用总数（会员当日 + 购买） */
  counts: Record<Pool, number>;
  /** 会员当日剩余 */
  member: Record<Pool, number>;
  /** 会员每日上限 */
  daily: Record<Pool, number>;
  /** 购买的剩余次数 */
  paid: Record<Pool, number>;
  /** 已从可用额度移出、尚未结算的次数 */
  reserved: Record<Pool, number>;
  /** 累计已用 */
  used: { model3: number; model4: number; drawMj: number; agent: number };
  balanceCents: number;
  packageId: string;
  extent: string;
  /** 会员到期时间；null 表示非会员 */
  expirationTime: Date | null;
  isMember: boolean;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // 读
  // ---------------------------------------------------------------------------

  /** 保证两个余额行存在（幂等），返回原始行 */
  async ensure(userId: string) {
    const [userBalance, balance] = await Promise.all([
      this.prisma.userBalance.upsert({ where: { userId }, create: { userId }, update: {} }),
      this.prisma.balance.upsert({ where: { userId }, create: { userId }, update: {} }),
    ]);
    return { userBalance, balance };
  }

  /** 事务版本：调用方自带事务时用，避免在 $transaction 内再开事务 */
  async ensureTx(tx: Prisma.TransactionClient, userId: string) {
    // Empty upserts may be implemented as reads. Take the balance write lock explicitly
    // before daily-reset reads; the no-op changes no counters or audit metadata.
    await tx.$executeRaw`UPDATE "user_balances" SET "userId" = "userId" WHERE "userId" = ${userId}`;
    const [userBalance, balance] = await Promise.all([
      tx.userBalance.upsert({ where: { userId }, create: { userId }, update: {} }),
      tx.balance.upsert({ where: { userId }, create: { userId }, update: {} }),
    ]);
    return { userBalance, balance };
  }

  /** 读余额视图；读之前先把会员每日额度按天刷新一次 */
  async view(userId: string): Promise<BalanceView> {
    return this.prisma.$transaction(async tx => {
      // The first write serializes a daily reset with reservations and consumption on SQLite.
      const { userBalance, balance } = await this.ensureTx(tx, userId);
      const refreshed = await this.refreshDailyTx(tx, userId, userBalance);
      const holds = await tx.countReservation.groupBy({ by: ['pool'], where: { userId, status: 'HELD' }, _sum: { amount: true } });
      const reserved: Record<Pool, number> = { model3: 0, model4: 0, drawMj: 0, agent: 0 };
      for (const hold of holds) if (isPool(hold.pool)) reserved[hold.pool] = hold._sum.amount ?? 0;
      return { ...this.toView(refreshed, balance.balanceCents), reserved };
    });
  }

  private toView(ub: Prisma.UserBalanceGetPayload<object>, balanceCents: number): Omit<BalanceView, 'reserved'> {
    const now = Date.now();
    const isMember = !!ub.expirationTime && ub.expirationTime.getTime() > now;
    const member = {
      model3: isMember ? ub.memberModel3Count : 0,
      model4: isMember ? ub.memberModel4Count : 0,
      drawMj: isMember ? ub.memberDrawMjCount : 0,
      agent: isMember ? ub.memberAgentCount : 0,
    };
    const paid = {
      model3: ub.model3Count,
      model4: ub.model4Count,
      drawMj: ub.drawMjCount,
      agent: ub.agentCount,
    };
    const counts = {
      model3: member.model3 + paid.model3,
      model4: member.model4 + paid.model4,
      drawMj: member.drawMj + paid.drawMj,
      agent: member.agent + paid.agent,
    };
    return {
      userId: ub.userId,
      counts,
      member,
      daily: {
        model3: isMember ? ub.dailyModel3Count : 0,
        model4: isMember ? ub.dailyModel4Count : 0,
        drawMj: isMember ? ub.dailyDrawMjCount : 0,
        agent: isMember ? ub.dailyAgentCount : 0,
      },
      paid,
      used: {
        model3: ub.useModel3Count,
        model4: ub.useModel4Count,
        drawMj: ub.useDrawMjToken,
        agent: ub.useAgentCount,
      },
      balanceCents,
      packageId: ub.packageId,
      extent: ub.extent,
      expirationTime: ub.expirationTime,
      isMember,
    };
  }

  // ---------------------------------------------------------------------------
  // 扣费
  // ---------------------------------------------------------------------------

  /** Move counts out of availability without recording final usage. Caller owns the task transaction. */
  async reserveCountTx(tx: Prisma.TransactionClient, userId: string, input: CountReservationInput) {
    if (!isPool(input.pool) || !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 2_147_483_647 || !input.refId) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '次数预留参数无效');
    }
    await this.ensureTx(tx, userId);
    const existing = await tx.countReservation.findUnique({ where: { refId: input.refId } });
    if (existing) {
      if (existing.userId !== userId || existing.pool !== input.pool || existing.amount !== input.amount) throw new BusinessException(ErrorCode.PARAM_INVALID, '预留记录与任务不一致');
      return existing;
    }
    const ub = await tx.userBalance.findUniqueOrThrow({ where: { userId } });
    const fresh = await this.refreshDailyTx(tx, userId, ub);
    const fields = POOL_FIELDS[input.pool];
    const memberAvailable = fresh.expirationTime && fresh.expirationTime.getTime() > Date.now() ? fresh[fields.member] : 0;
    if (memberAvailable + fresh[fields.paid] < input.amount) throw new BusinessException(ErrorCode.BALANCE_NOT_ENOUGH, `可用次数不足（需预留 ${input.amount} 次，当前 ${memberAvailable + fresh[fields.paid]} 次）`, 402);
    const memberAmount = Math.min(memberAvailable, input.amount), paidAmount = input.amount - memberAmount;
    let memberLogId: string | undefined, paidLogId: string | undefined;
    for (const source of [{ amount: memberAmount, field: fields.member, member: true }, { amount: paidAmount, field: fields.paid, member: false }]) {
      if (!source.amount) continue;
      await this.decField(tx, userId, source.field, source.amount, '可用次数不足');
      const log = await this.writeLog(tx, { ...input, userId, direction: 4, deductionType: input.pool, amount: source.amount, balanceKey: source.field, remark: '任务已接受，预留次数；成功后按实际用量结算' });
      if (source.member) memberLogId = log.id; else paidLogId = log.id;
    }
    return tx.countReservation.create({ data: { refId: input.refId, userId, pool: input.pool, amount: input.amount, memberAmount, paidAmount, memberDay: fresh.memberResetOn, memberExpiresAt: fresh.expirationTime, memberLogId, paidLogId, bizType: input.bizType, model: input.model ?? '', modelName: input.modelName ?? '' } });
  }

  /** Settle or release one reservation. Result, account changes and audit rows commit together. */
  async settleCountReservationTx(tx: Prisma.TransactionClient, refId: string, amount: number) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new BusinessException(ErrorCode.PARAM_INVALID, '结算次数无效');
    // A conditional write takes the reservation lock before any dependent reads.
    const lock = await tx.countReservation.updateMany({ where: { refId, status: 'HELD' }, data: { status: 'HELD' } });
    const reservation = await tx.countReservation.findUnique({ where: { refId } });
    if (!reservation) throw new BusinessException(ErrorCode.INTERNAL, '次数预留记录不存在', 500);
    if (!lock.count) {
      if (reservation.settledAmount !== amount) throw new BusinessException(ErrorCode.PARAM_INVALID, '该预留已按其他用量结算');
      return reservation;
    }
    if (amount > reservation.amount || !isPool(reservation.pool)) throw new BusinessException(ErrorCode.PARAM_INVALID, '实际用量超出预留次数');
    const fields = POOL_FIELDS[reservation.pool];
    const ub = await tx.userBalance.findUniqueOrThrow({ where: { userId: reservation.userId } });
    const fresh = await this.refreshDailyTx(tx, reservation.userId, ub);
    const memberUsed = Math.min(amount, reservation.memberAmount), paidUsed = amount - memberUsed;
    const memberUnused = reservation.memberAmount - memberUsed, paidReturned = reservation.paidAmount - paidUsed;
    const memberStillValid = reservation.memberDay === shanghaiDate() && !!reservation.memberExpiresAt && reservation.memberExpiresAt.getTime() > Date.now() && !!fresh.expirationTime && fresh.expirationTime.getTime() > Date.now();
    const memberReturned = memberStillValid ? Math.min(memberUnused, Math.max(0, fresh[fields.daily] - fresh[fields.member])) : 0;
    const expiredAmount = memberUnused - memberReturned, returnedAmount = memberReturned + paidReturned;
    for (const source of [
      { field: fields.member, used: memberUsed, returned: memberReturned, expired: expiredAmount, logId: reservation.memberLogId },
      { field: fields.paid, used: paidUsed, returned: paidReturned, expired: 0, logId: reservation.paidLogId },
    ]) {
      const common = { userId: reservation.userId, deductionType: reservation.pool, balanceKey: source.field, bizType: reservation.bizType, refId, model: reservation.model, modelName: reservation.modelName, sourceLogId: source.logId ?? undefined };
      if (source.used) await this.writeLog(tx, { ...common, direction: 1, amount: source.used, remark: '从已预留次数结算，不再次减少可用次数' });
      if (source.returned) {
        await tx.userBalance.update({ where: { userId: reservation.userId }, data: { [source.field]: { increment: source.returned } } as Prisma.UserBalanceUpdateInput });
        await this.writeLog(tx, { ...common, direction: 5, amount: source.returned, remark: '未使用的预留次数已释放' });
      }
      if (source.expired) await this.writeLog(tx, { ...common, direction: 6, amount: source.expired, remark: '未使用的会员预留额度已到期，不转入新一天或新套餐' });
    }
    if (amount) await tx.userBalance.update({ where: { userId: reservation.userId }, data: { [fields.used]: { increment: amount } } as Prisma.UserBalanceUpdateInput });
    return tx.countReservation.update({ where: { refId }, data: { status: amount ? 'SETTLED' : 'RELEASED', settledAmount: amount, returnedAmount, expiredAmount, completedAt: new Date() } });
  }

  /**
   * 扣费入口。pool 与 cents 二选一（也可同时，用于"次数 + 超量金额"场景）。
   * 返回本次写入的流水；调用方拿 refId 即可在失败时调 refundByRef。
   */
  async consume(userId: string, input: ConsumeInput) {
    return this.prisma.$transaction(async tx => { await this.ensureTx(tx, userId); return this.consumeTx(tx, userId, input); });
  }

  /** 事务内的扣费实现；供已有事务的业务复用（不要在 $transaction 里再调 consume） */
  async consumeTx(tx: Prisma.TransactionClient, userId: string, input: ConsumeInput) {
    const amount = input.amount ?? 0;
    const cents = input.cents ?? 0;
    if (!Number.isInteger(amount) || amount < 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '扣减次数必须是非负整数');
    }
    if (!Number.isInteger(cents) || cents < 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '扣减金额必须是非负整数（分）');
    }
    if (amount === 0 && cents === 0) {
      return [];
    }
    if (amount > 0 && !isPool(input.pool)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '扣减次数时必须指定次数池');
    }

    const ub = await tx.userBalance.findUnique({ where: { userId } });
    if (!ub) throw new BusinessException(ErrorCode.INTERNAL, '余额账户不存在', 500);
    const fresh = await this.refreshDailyTx(tx, userId, ub);

    const logs: Array<{ id: string; balanceKey: string; amount: number }> = [];

    if (amount > 0 && isPool(input.pool)) {
      const f = POOL_FIELDS[input.pool];
      const memberAvail = fresh[f.member];
      const paidAvail = fresh[f.paid];
      if (memberAvail + paidAvail < amount) {
        throw new BusinessException(
          ErrorCode.BALANCE_NOT_ENOUGH,
          `剩余次数不足（需要 ${amount} 次，当前 ${memberAvail + paidAvail} 次）`,
          402,
        );
      }
      const fromMember = Math.min(memberAvail, amount);
      const fromPaid = amount - fromMember;

      if (fromMember > 0) {
        await this.decField(tx, userId, f.member, fromMember, '剩余次数不足');
        logs.push(
          await this.writeLog(tx, {
            userId,
            direction: 1,
            deductionType: input.pool,
            amount: fromMember,
            balanceKey: f.member,
            bizType: input.bizType,
            model: input.model,
            modelName: input.modelName,
            useAmount: amount,
            refId: input.refId,
            remark: input.remark,
            upstreamStatus: input.upstreamStatus,
          }),
        );
      }
      if (fromPaid > 0) {
        await this.decField(tx, userId, f.paid, fromPaid, '剩余次数不足');
        logs.push(
          await this.writeLog(tx, {
            userId,
            direction: 1,
            deductionType: input.pool,
            amount: fromPaid,
            balanceKey: f.paid,
            bizType: input.bizType,
            model: input.model,
            modelName: input.modelName,
            useAmount: amount,
            refId: input.refId,
            remark: input.remark,
            upstreamStatus: input.upstreamStatus,
          }),
        );
      }
      // 累计用量：按池分别累加
      const usedData: Record<string, unknown> = { [f.used]: { increment: amount } };
      await tx.userBalance.update({ where: { userId }, data: usedData as Prisma.UserBalanceUpdateInput });
    }

    if (cents > 0) {
      await this.decField(tx, userId, 'balanceCents', cents, '余额不足', 'balance');
      logs.push(
        await this.writeLog(tx, {
          userId,
          direction: 1,
          deductionType: 'money',
          amount: cents,
          balanceKey: 'balanceCents',
          bizType: input.bizType,
          model: input.model,
          modelName: input.modelName,
          useAmount: cents,
          refId: input.refId,
          remark: input.remark,
          upstreamStatus: input.upstreamStatus,
        }),
      );
      // decField already applied the guarded debit; the audit row must not debit it again.
    }

    return logs;
  }

  /** 按微单位扣费（内部换算成分，向上取整） */
  async consumeMicros(userId: string, micros: number, input: Omit<ConsumeInput, 'cents' | 'amount' | 'pool'>) {
    return this.consume(userId, { ...input, cents: microsToCents(micros) });
  }

  /**
   * 按 refId 全额退款。幂等：已 refunded 的流水不会重复退。
   * 返回退款流水条数。
   */
  async refundByRef(refId: string, remark = '调用失败，已返还') {
    if (!refId) return 0;
    return this.prisma.$transaction((tx) => this.refundByRefTx(tx, refId, remark));
  }

  /** 事务内的退款实现 */
  async refundByRefTx(tx: Prisma.TransactionClient, refId: string, remark = '调用失败，已返还') {
    if (!refId) return 0;

    const origin = await tx.balanceConsumeLog.findMany({
      where: { refId, direction: 1, refunded: false },
    });
    if (origin.length === 0) return 0;

    let refunded = 0;
    for (const log of origin) {
      if (log.balanceKey === 'balanceCents') {
        await tx.balance.update({
          where: { userId: log.userId },
          data: { balanceCents: { increment: log.amount } },
        });
      } else {
        const data: Record<string, unknown> = { [log.balanceKey]: { increment: log.amount } };
        await tx.userBalance.update({
          where: { userId: log.userId },
          data: data as Prisma.UserBalanceUpdateInput,
        });
      }
      await tx.balanceConsumeLog.update({ where: { id: log.id }, data: { refunded: true } });
      await tx.balanceConsumeLog.create({
        data: {
          userId: log.userId,
          direction: 2,
          deductionType: log.deductionType,
          amount: log.amount,
          balanceKey: log.balanceKey,
          bizType: log.bizType,
          model: log.model,
          modelName: log.modelName,
          useAmount: log.useAmount,
          refId: log.refId,
          sourceLogId: log.id,
          refunded: true,
          remark,
          uid: randomUUID(),
        },
      });
      refunded += 1;
    }
    return refunded;
  }

  // ---------------------------------------------------------------------------
  // 发放
  // ---------------------------------------------------------------------------

  /**
   * 发放次数/会员/余额，并写一条 AccountLog。
   * 供：卡密核销、订单支付成功、后台手工充值、签到奖励共用。
   */
  async grant(userId: string, input: GrantInput) {
    return this.prisma.$transaction(async tx => { await this.ensureTx(tx, userId); return this.grantTx(tx, userId, input); });
  }

  /** 事务内的发放实现 */
  async grantTx(tx: Prisma.TransactionClient, userId: string, input: GrantInput) {
    const counts = {
      model3: input.model3Count ?? 0,
      model4: input.model4Count ?? 0,
      drawMj: input.drawMjCount ?? 0,
      agent: input.agentCount ?? 0,
    };
    for (const v of Object.values(counts)) {
      if (!Number.isInteger(v) || v < 0) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '发放次数必须是非负整数');
      }
    }
    const days = input.days ?? 0;
    if (!Number.isInteger(days)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '会员天数必须是整数');
    }
    const amountCents = input.amountCents ?? 0;
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '充值金额必须是非负整数（分）');
    }

    const ub = await tx.userBalance.findUnique({ where: { userId } });
    if (!ub) throw new BusinessException(ErrorCode.INTERNAL, '余额账户不存在', 500);

    const now = new Date();
    const activeUntil = ub.expirationTime && ub.expirationTime.getTime() > now.getTime() ? ub.expirationTime : now;
    let expirationTime = ub.expirationTime;
    if (days < 0) expirationTime = PERPETUAL;
    else if (days > 0) expirationTime = addDays(activeUntil, days);

    const data: Prisma.UserBalanceUpdateInput = {};
    if (counts.model3) data.model3Count = { increment: counts.model3 };
    if (counts.model4) data.model4Count = { increment: counts.model4 };
    if (counts.drawMj) data.drawMjCount = { increment: counts.drawMj };
    if (counts.agent) data.agentCount = { increment: counts.agent };

    if (days !== 0) {
      data.expirationTime = expirationTime;
      data.memberResetOn = shanghaiDate();
      // 会员每日额度：上限取「本次传入 > 套餐现值」，当日额度直接拉满到上限
      const dailyNext = {
        model3: Math.max(input.dailyModel3Count ?? ub.dailyModel3Count, input.dailyModel3Count ?? 0),
        model4: Math.max(input.dailyModel4Count ?? ub.dailyModel4Count, input.dailyModel4Count ?? 0),
        drawMj: Math.max(input.dailyDrawMjCount ?? ub.dailyDrawMjCount, input.dailyDrawMjCount ?? 0),
        agent: Math.max(input.dailyAgentCount ?? ub.dailyAgentCount, input.dailyAgentCount ?? 0),
      };
      data.dailyModel3Count = dailyNext.model3;
      data.dailyModel4Count = dailyNext.model4;
      data.dailyDrawMjCount = dailyNext.drawMj;
      data.dailyAgentCount = dailyNext.agent;
      data.memberModel3Count = dailyNext.model3;
      data.memberModel4Count = dailyNext.model4;
      data.memberDrawMjCount = dailyNext.drawMj;
      data.memberAgentCount = dailyNext.agent;
    }
    if (input.packageId) data.packageId = input.packageId;
    if (input.extent) data.extent = input.extent;

    if (Object.keys(data).length > 0) {
      await tx.userBalance.update({ where: { userId }, data });
    }

    if (amountCents > 0) {
      await tx.balance.update({
        where: { userId },
        data: { balanceCents: { increment: amountCents } },
      });
    }

    return tx.accountLog.create({
      data: {
        userId,
        pkgName: input.pkgName ?? '',
        packageId: input.packageId ?? '',
        memberDays: days,
        rechargeType: input.rechargeType,
        model3Count: counts.model3,
        model4Count: counts.model4,
        drawMjCount: counts.drawMj,
        agentCount: counts.agent,
        days,
        amountCents,
        rebateUserId: input.rebateUserId ?? '',
        uid: randomUUID(),
        extent: input.extent ?? '',
        remark: input.remark ?? '',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  /** 事务内的每日额度刷新（consume 里用，必须与扣减同事务） */
  private async refreshDailyTx(
    tx: Prisma.TransactionClient,
    userId: string,
    ub: Prisma.UserBalanceGetPayload<object>,
  ) {
    const today = shanghaiDate();
    const now = Date.now();
    const expired = !!ub.expirationTime && ub.expirationTime.getTime() <= now;
    if (ub.memberResetOn === today && !expired) return ub;

    const data: Prisma.UserBalanceUpdateInput = { memberResetOn: today };
    if (expired) {
      data.memberModel3Count = 0;
      data.memberModel4Count = 0;
      data.memberDrawMjCount = 0;
      data.memberAgentCount = 0;
      data.dailyModel3Count = 0;
      data.dailyModel4Count = 0;
      data.dailyDrawMjCount = 0;
      data.dailyAgentCount = 0;
    } else if (ub.memberResetOn !== today) {
      data.memberModel3Count = ub.dailyModel3Count;
      data.memberModel4Count = ub.dailyModel4Count;
      data.memberDrawMjCount = ub.dailyDrawMjCount;
      data.memberAgentCount = ub.dailyAgentCount;
    }
    return tx.userBalance.update({ where: { userId }, data });
  }

  /**
   * 条件扣减：把「余额 >= n」写进 where，靠影响行数判断成功。
   * 这样即使并发请求同时扣费，也不会出现负数余额。
   */
  private async decField(
    tx: Prisma.TransactionClient,
    userId: string,
    field: string,
    n: number,
    message: string,
    table: 'userBalance' | 'balance' = 'userBalance',
  ) {
    let changed = 0;
    if (table === 'balance') {
      const res = await tx.balance.updateMany({
        where: { userId, balanceCents: { gte: n } },
        data: { balanceCents: { decrement: n } },
      });
      changed = res.count;
    } else {
      const where: Record<string, unknown> = { userId, [field]: { gte: n } };
      const data: Record<string, unknown> = { [field]: { decrement: n } };
      const res = await tx.userBalance.updateMany({
        where: where as Prisma.UserBalanceWhereInput,
        data: data as Prisma.UserBalanceUpdateInput,
      });
      changed = res.count;
    }
    if (changed !== 1) {
      throw new BusinessException(ErrorCode.BALANCE_NOT_ENOUGH, message, 402);
    }
  }

  private async writeLog(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      direction: number;
      deductionType: string;
      amount: number;
      balanceKey: string;
      bizType: string;
      model?: string;
      modelName?: string;
      useAmount?: number;
      refId?: string;
      remark?: string;
      upstreamStatus?: number;
      sourceLogId?: string;
    },
  ) {
    const log = await tx.balanceConsumeLog.create({
      data: {
        userId: input.userId,
        direction: input.direction,
        deductionType: input.deductionType,
        amount: input.amount,
        balanceKey: input.balanceKey,
        bizType: input.bizType,
        model: input.model ?? '',
        modelName: input.modelName ?? '',
        useAmount: input.useAmount ?? input.amount,
        refId: input.refId ?? '',
        refunded: false,
        remark: input.remark ?? '',
        upstreamStatus: input.upstreamStatus,
        sourceLogId: input.sourceLogId,
        uid: randomUUID(),
      },
    });
    return { id: log.id, balanceKey: log.balanceKey, amount: log.amount };
  }
}
