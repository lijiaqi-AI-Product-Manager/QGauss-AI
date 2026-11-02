import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

@Injectable()
export class PresetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 前台：只返回启用的预设，按分组组织 */
  async listGrouped() {
    const [groups, presets] = await Promise.all([
      this.prisma.presetGroup.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.preset.findMany({
        where: { enabled: true, deletedAt: null },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const byGroup = new Map<string, any[]>();
    for (const p of presets) {
      const key = p.groupId ?? 'ungrouped';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push({
        id: p.id,
        title: p.title,
        prompt: p.prompt,
        icon: p.icon,
      });
    }

    const result = groups.map((g) => ({
      id: g.id,
      name: g.name,
      items: byGroup.get(g.id) ?? [],
    }));

    const ungrouped = byGroup.get('ungrouped') ?? [];
    if (ungrouped.length > 0) {
      result.push({ id: 'ungrouped', name: '未分组', items: ungrouped });
    }
    return result.filter((g) => g.items.length > 0);
  }

  // ---------------- 后台 ----------------
  async adminList() {
    const rows = await this.prisma.preset.findMany({
      where: { deletedAt: null },
      orderBy: [{ groupId: 'asc' }, { sort: 'asc' }],
      include: { group: { select: { id: true, name: true } } },
    });
    return rows;
  }

  listGroups() {
    return this.prisma.presetGroup.findMany({ orderBy: { sort: 'asc' } });
  }

  async createGroup(data: { name: string; sort?: number }) {
    // name 是 unique：撞了会抛 P2002，前端只会看到 500
    const dup = await this.prisma.presetGroup.findUnique({ where: { name: data.name } });
    if (dup) throw new BusinessException(ErrorCode.PARAM_INVALID, '分组名称已存在');
    return this.prisma.presetGroup.create({ data });
  }

  async updateGroup(id: string, data: { name?: string; sort?: number }) {
    await this.assertGroup(id);
    if (data.name) {
      const dup = await this.prisma.presetGroup.findUnique({ where: { name: data.name } });
      if (dup && dup.id !== id) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '分组名称已存在');
      }
    }
    return this.prisma.presetGroup.update({ where: { id }, data });
  }

  async removeGroup(id: string) {
    await this.assertGroup(id);
    // schema 里 Preset.group 是 onDelete: SetNull，删组不会带走预设，只会变成未分组
    await this.prisma.presetGroup.delete({ where: { id } });
    return { ok: true };
  }

  async createPreset(data: {
    groupId?: string;
    title: string;
    prompt: string;
    icon?: string;
    sort?: number;
  }) {
    if (data.groupId) await this.assertGroup(data.groupId);
    return this.prisma.preset.create({ data });
  }

  async updatePreset(
    id: string,
    data: {
      groupId?: string | null;
      title?: string;
      prompt?: string;
      icon?: string;
      sort?: number;
      enabled?: boolean;
    },
  ) {
    await this.assertPreset(id);
    if (data.groupId) await this.assertGroup(data.groupId);
    return this.prisma.preset.update({ where: { id }, data });
  }

  async removePreset(id: string) {
    await this.assertPreset(id);
    await this.prisma.preset.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  private async assertGroup(id: string) {
    const hit = await this.prisma.presetGroup.findUnique({ where: { id }, select: { id: true } });
    if (!hit) throw new BusinessException(ErrorCode.NOT_FOUND, '预设分组不存在', 404);
  }

  private async assertPreset(id: string) {
    const hit = await this.prisma.preset.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!hit) throw new BusinessException(ErrorCode.NOT_FOUND, '预设不存在', 404);
  }
}
