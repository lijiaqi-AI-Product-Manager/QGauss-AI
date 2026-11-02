import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const folders = await this.prisma.conversationFolder.findMany({
      where: { userId },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    if (folders.length === 0) return [];

    // 单独聚合会话数，避免在 schema 里为分组加关系（保持 provider 无关）
    const counts = await this.prisma.conversation.groupBy({
      by: ['folderId'],
      where: { userId, deletedAt: null, folderId: { in: folders.map((f) => f.id) } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.folderId, c._count._all]));

    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      sort: f.sort,
      createdAt: f.createdAt,
      conversationCount: countMap.get(f.id) ?? 0,
    }));
  }

  create(userId: string, name: string, sort = 0) {
    return this.prisma.conversationFolder.create({ data: { userId, name, sort } });
  }

  async update(userId: string, id: string, data: { name?: string; sort?: number }) {
    await this.assertOwner(userId, id);
    return this.prisma.conversationFolder.update({ where: { id }, data });
  }

  async remove(userId: string, id: string) {
    await this.assertOwner(userId, id);
    // 分组删除后，会话回到"未分组"，不级联删除会话
    await this.prisma.conversation.updateMany({
      where: { folderId: id, userId },
      data: { folderId: null },
    });
    await this.prisma.conversationFolder.delete({ where: { id } });
    return { ok: true };
  }

  private async assertOwner(userId: string, id: string) {
    const hit = await this.prisma.conversationFolder.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!hit) throw new BusinessException(ErrorCode.NOT_FOUND, '分组不存在', 404);
  }
}
