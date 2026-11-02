import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { LedgerService, Pool, isPool, shanghaiDate } from './ledger.service';

/**
 * 每日签到。
 *
 * 语义：
 *   - 每人每天（Asia/Shanghai）只能签一次，靠 (userId, signInDate) 唯一键兜并发
 *   - 奖励发放走账本，rechargeType='signin'，可在充值流水里看到
 *   - 连续天数由记录反推，不额外存状态，避免"状态与流水不一致"
 */
@Injectable()
export class SigninService {
  private readonly logger = new Logger(SigninService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  private async reward(): Promise<{ pool: Pool; count: number }> {
    const rawPool = await this.settings.get<string>('commerce.signinPool');
    const pool: Pool = isPool(rawPool) ? rawPool : 'model3';
    const count = Math.max(0, Math.floor(Number(await this.settings.get<number>('commerce.signinCount')) || 0));
    if (!Number.isSafeInteger(count) || count > 2147483647) throw new BusinessException(ErrorCode.PARAM_INVALID, '签到奖励次数超出范围', 400);
    return { pool, count };
  }

  async log(userId: string) {
    const items = await this.prisma.signin.findMany({
      where: { userId },
      orderBy: { signInDate: 'desc' },
      take: 60,
      select: { id: true, signInDate: true, signInTime: true, reward: true },
    });
    const today = shanghaiDate();
    const enabled = await this.settings.get<boolean>('commerce.signinEnabled');
    const reward = await this.reward();
    // reward 统一成「次数」，池名单独给：sign() 早就返回数字，
    // 这里以前返回 {pool,count} 对象，前端直接插值就渲染成了 JSON。
    return {
      enabled,
      today,
      signedToday: items.some((i) => i.signInDate === today),
      streak: await this.currentStreak(userId, items.map((i) => i.signInDate), today),
      reward: reward.count,
      rewardPool: reward.pool,
      items,
    };
  }

  async sign(userId: string) {
    const enabled = await this.settings.get<boolean>('commerce.signinEnabled');
    if (!enabled) {
      throw new BusinessException(ErrorCode.COMMERCE_DISABLED, '签到未开放', 404);
    }

    const today = shanghaiDate();
    const { pool, count } = await this.reward();

    try {
      await this.prisma.$transaction(async tx => {
        await this.ledger.ensureTx(tx, userId);
        await tx.signin.create({ data: { userId, signInDate: today, reward: count } });
        if (count > 0) {
          await this.ledger.grantTx(tx, userId, {
            ...(pool === 'model3' ? { model3Count: count } : {}),
            ...(pool === 'model4' ? { model4Count: count } : {}),
            ...(pool === 'drawMj' ? { drawMjCount: count } : {}),
            ...(pool === 'agent' ? { agentCount: count } : {}),
            rechargeType: 'signin',
            remark: '每日签到奖励 ' + count + ' 次（' + pool + '）',
          });
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BusinessException(ErrorCode.ALREADY_SIGNED, '今天已经签到过了', 409);
      }
      throw err;
    }

    if (count === 0) this.logger.log('用户 ' + userId + ' 签到成功，奖励为 0');

    const view = await this.ledger.view(userId);
    const dates = await this.prisma.signin.findMany({
      where: { userId },
      orderBy: { signInDate: 'desc' },
      take: 60,
      select: { signInDate: true },
    });
    return {
      date: today,
      reward: count,
      pool,
      streak: await this.currentStreak(userId, dates.map((d) => d.signInDate), today),
      counts: view.counts,
    };
  }

  /** Keep the calendar bounded, but continue reading an uninterrupted streak past 60 days. */
  private async currentStreak(userId: string, firstDates: string[], today: string): Promise<number> {
    let dates = firstDates, total = this.streak(dates, today);
    if (total < 60) return total;
    const cursor = new Date(today + 'T00:00:00.000Z');
    cursor.setUTCDate(cursor.getUTCDate() - total);
    while (dates.length === 60) {
      const older = await this.prisma.signin.findMany({
        where: { userId, signInDate: { lt: dates[dates.length - 1] } },
        orderBy: { signInDate: 'desc' },
        take: 60,
        select: { signInDate: true },
      });
      dates = older.map(row => row.signInDate);
      for (const date of dates) {
        if (date !== cursor.toISOString().slice(0, 10)) return total;
        total += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
    }
    return total;
  }

  /** 从今天的日期往前数连续签到天数（今天没签也算上，因为调用时刚签完） */
  private streak(dates: string[], today: string): number {
    const set = new Set(dates);
    if (!set.has(today)) return 0;
    let n = 0;
    const cursor = new Date(`${today}T00:00:00.000Z`);
    for (;;) {
      const key = cursor.toISOString().slice(0, 10);
      if (!set.has(key)) break;
      n += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return n;
  }
}
