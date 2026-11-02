import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const TZ_OFFSET_MS = 8 * 3600_000;

@Injectable()
export class StatisticService {
  constructor(private readonly prisma: PrismaService) {}

  /** 天数纠偏：NaN / 0 / 负数 / 超大值都会让 Prisma 拿到 Invalid Date 或扫全表 */
  private normalizeDays(days: number) {
    if (!Number.isFinite(days)) return 7;
    return Math.min(365, Math.max(1, Math.floor(days)));
  }

  private from(days: number) {
    return new Date(Date.now() - this.normalizeDays(days) * 86_400_000);
  }

  private dayKey(d: Date) {
    return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** 总览：调用量 / token / 成本 / 失败率 */
  async overview(days = 7) {
    const from = this.from(days);

    const [usage, assistantCount, failedCount, conversations, users, activeUsers] =
      await Promise.all([
        this.prisma.usageRecord.aggregate({
          where: { createdAt: { gte: from } },
          _sum: { promptTokens: true, completionTokens: true, costMicros: true },
          _count: { _all: true },
        }),
        this.prisma.message.count({
          where: { role: 'ASSISTANT', status: { in: ['COMPLETED', 'FAILED', 'ABORTED'] }, createdAt: { gte: from } },
        }),
        this.prisma.message.count({
          where: { role: 'ASSISTANT', status: 'FAILED', createdAt: { gte: from } },
        }),
        this.prisma.conversation.count({
          where: { createdAt: { gte: from }, deletedAt: null },
        }),
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.usageRecord
          .groupBy({ by: ['userId'], where: { createdAt: { gte: from } } })
          .then((r) => r.length),
      ]);

    const promptTokens = usage._sum.promptTokens ?? 0;
    const completionTokens = usage._sum.completionTokens ?? 0;

    return {
      days,
      calls: usage._count._all,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costMicros: usage._sum.costMicros ?? 0,
      conversations,
      assistantMessages: assistantCount,
      failedMessages: failedCount,
      failureRate: assistantCount === 0 ? 0 : Number(((failedCount / assistantCount) * 100).toFixed(2)),
      totalUsers: users,
      activeUsers,
    };
  }

  async byModel(days = 7) {
    const rows = await this.prisma.usageRecord.groupBy({
      by: ['modelName'],
      where: { createdAt: { gte: this.from(days) } },
      _sum: { promptTokens: true, completionTokens: true, costMicros: true },
      _count: { _all: true },
      orderBy: { _count: { modelName: 'desc' } },
    });

    return rows
      .map((r) => ({
        model: r.modelName,
        calls: r._count._all,
        promptTokens: r._sum.promptTokens ?? 0,
        completionTokens: r._sum.completionTokens ?? 0,
        costMicros: r._sum.costMicros ?? 0,
      }))
      .sort((a, b) => b.calls - a.calls);
  }

  async byChannel(days = 7) {
    const rows = await this.prisma.usageRecord.groupBy({
      by: ['channelId'],
      where: { createdAt: { gte: this.from(days) } },
      _sum: { promptTokens: true, completionTokens: true, costMicros: true },
      _count: { _all: true },
    });

    const ids = rows.map((r) => r.channelId).filter((v): v is string => !!v);
    const channels = ids.length
      ? await this.prisma.channel.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, type: true },
        })
      : [];
    const nameMap = new Map(channels.map((c) => [c.id, c]));

    return rows
      .map((r) => ({
        channelId: r.channelId,
        channelName: r.channelId ? (nameMap.get(r.channelId)?.name ?? '已删除渠道') : '未知',
        channelType: r.channelId ? (nameMap.get(r.channelId)?.type ?? '') : '',
        calls: r._count._all,
        promptTokens: r._sum.promptTokens ?? 0,
        completionTokens: r._sum.completionTokens ?? 0,
        costMicros: r._sum.costMicros ?? 0,
      }))
      .sort((a, b) => b.calls - a.calls);
  }

  /** 按天趋势（在 JS 里分桶，保持数据库无关） */
  async trend(days = 7) {
    const window = this.normalizeDays(days);
    const from = this.from(window);
    const rows = await this.prisma.usageRecord.findMany({
      where: { createdAt: { gte: from } },
      select: { createdAt: true, promptTokens: true, completionTokens: true, costMicros: true },
      // 没有 orderBy 时 take 截断的结果不确定，趋势图会随查询计划漂移
      orderBy: { createdAt: 'desc' },
      take: 20000,
    });

    const buckets = new Map<string, { date: string; calls: number; tokens: number; costMicros: number }>();
    for (let i = window - 1; i >= 0; i -= 1) {
      const key = this.dayKey(new Date(Date.now() - i * 86_400_000));
      buckets.set(key, { date: key, calls: 0, tokens: 0, costMicros: 0 });
    }
    for (const r of rows) {
      const key = this.dayKey(r.createdAt);
      const b = buckets.get(key) ?? { date: key, calls: 0, tokens: 0, costMicros: 0 };
      b.calls += 1;
      b.tokens += r.promptTokens + r.completionTokens;
      b.costMicros += r.costMicros;
      buckets.set(key, b);
    }
    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async recentErrors(limit = 10) {
    // 控制器把 query 直接透传进来，Number('abc')=NaN 会让 Prisma 报参数错误
    const take = Math.min(100, Math.max(1, Math.floor(Number(limit) || 10)));
    const rows = await this.prisma.message.findMany({
      where: { role: 'ASSISTANT', status: { in: ['FAILED', 'ABORTED'] } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        conversationId: true,
        status: true,
        errorCode: true,
        modelName: true,
        createdAt: true,
      },
    });
    return rows;
  }

  /** 渠道尝试分布（用于看哪条链路最不稳） */
  async attempts(days = 7) {
    const from = this.from(days);
    const rows = await this.prisma.chatAttempt.groupBy({
      by: ['channelId', 'outcome'],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      channelId: r.channelId,
      outcome: r.outcome,
      count: r._count._all,
    }));
  }
}
