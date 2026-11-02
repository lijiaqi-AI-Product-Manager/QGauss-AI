import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

/** 配额按 Asia/Shanghai 的自然日计算 */
const TZ_OFFSET_MS = 8 * 3600_000;

@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private dayStart(): Date {
    const shifted = new Date(Date.now() + TZ_OFFSET_MS);
    const utcMidnight = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    );
    return new Date(utcMidnight - TZ_OFFSET_MS);
  }

  async usedToday(userId: string): Promise<{ prompt: number; completion: number; total: number }> {
    const agg = await this.prisma.usageRecord.aggregate({
      where: { userId, createdAt: { gte: this.dayStart() } },
      _sum: { promptTokens: true, completionTokens: true },
    });
    const prompt = agg._sum.promptTokens ?? 0;
    const completion = agg._sum.completionTokens ?? 0;
    return { prompt, completion, total: prompt + completion };
  }

  async summary(userId: string) {
    const limit = await this.settings.get<number>('quota.dailyTokens');
    const used = await this.usedToday(userId);
    return {
      limit,
      used: used.total,
      prompt: used.prompt,
      completion: used.completion,
      remaining: limit > 0 ? Math.max(0, limit - used.total) : null,
      resetsAt: new Date(this.dayStart().getTime() + 24 * 3600_000).toISOString(),
    };
  }

  /** 超配额直接抛 429；limit = 0 表示不限 */
  async assertWithinQuota(userId: string): Promise<void> {
    const limit = await this.settings.get<number>('quota.dailyTokens');
    if (!limit || limit <= 0) return;

    const used = await this.usedToday(userId);
    if (used.total >= limit) {
      throw new BusinessException(
        ErrorCode.QUOTA_EXCEEDED,
        `今日 token 额度已用完（${used.total}/${limit}），明天再来`,
        429,
      );
    }
  }
}
