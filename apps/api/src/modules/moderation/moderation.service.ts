import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

export interface ModerationResult {
  word: string;
  action: 'block' | 'review';
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  private cache: { items: Array<{ word: string; action: string }>; at: number } | null = null;
  private readonly ttl = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  private async load(): Promise<Array<{ word: string; action: string }>> {
    if (this.cache && Date.now() - this.cache.at < this.ttl) return this.cache.items;

    const rows = await this.prisma.sensitiveWord.findMany({
      where: { enabled: true, deletedAt: null },
      select: { word: true, action: true },
    });
    // 长词优先，避免短词先命中导致误判
    rows.sort((a, b) => b.word.length - a.word.length);
    this.cache = { items: rows, at: Date.now() };
    return rows;
  }

  invalidate() {
    this.cache = null;
  }

  /** 命中检测：返回第一个命中的词 */
  async check(text: string): Promise<ModerationResult | null> {
    if (!text) return null;
    const items = await this.load();
    if (items.length === 0) return null;

    const lower = text.toLowerCase();
    for (const item of items) {
      if (lower.includes(item.word.toLowerCase())) {
        return { word: item.word, action: item.action === 'review' ? 'review' : 'block' };
      }
    }
    return null;
  }

  async recordHit(input: {
    userId: string;
    word: string;
    source?: string;
    excerpt?: string;
    conversationId?: string;
  }) {
    await this.prisma.moderationHit
      .create({
        data: {
          userId: input.userId,
          word: input.word,
          source: input.source ?? 'chat',
          excerpt: input.excerpt?.slice(0, 200),
          conversationId: input.conversationId,
        },
      })
      .catch((e) => this.logger.warn(`记录违规失败: ${e.message}`));
  }

  // ---------------- 词库管理 ----------------
  listWords() {
    return this.prisma.sensitiveWord.findMany({
      where: { deletedAt: null },
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createWord(data: { word: string; category?: string; action?: string }) {
    const exists = await this.prisma.sensitiveWord.findUnique({ where: { word: data.word } });
    if (exists) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '该词已存在');
    }
    const row = await this.prisma.sensitiveWord.create({
      data: {
        word: data.word,
        category: data.category ?? 'general',
        action: data.action ?? 'block',
      },
    });
    this.invalidate();
    return row;
  }

  async updateWord(
    id: string,
    data: { word?: string; category?: string; action?: string; enabled?: boolean },
  ) {
    const exists = await this.prisma.sensitiveWord.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new BusinessException(ErrorCode.NOT_FOUND, '敏感词不存在', 404);

    // 改名要查重：撞 unique 约束会抛 P2002，落到前端变成 500 而不是可读提示
    if (data.word) {
      const dup = await this.prisma.sensitiveWord.findUnique({ where: { word: data.word } });
      if (dup && dup.id !== id) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '该词已存在');
      }
    }

    const { word, category, action, enabled } = data;
    const row = await this.prisma.sensitiveWord.update({
      where: { id },
      data: {
        ...(word !== undefined ? { word } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(action !== undefined ? { action } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });
    this.invalidate();
    return row;
  }

  async removeWord(id: string) {
    await this.prisma.sensitiveWord.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });
    this.invalidate();
    return { ok: true };
  }

  async listHits(page = 1, pageSize = 20) {
    const [items, total] = await Promise.all([
      this.prisma.moderationHit.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.moderationHit.count(),
    ]);
    return { items, total, page, pageSize };
  }
}
