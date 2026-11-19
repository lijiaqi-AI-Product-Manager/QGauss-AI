import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

@Injectable()
export class PresetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 前台：只返回启用的预设，按分组组织 */
  async listGrouped() {
    const [groups, presets] = await this.prisma.$transaction([
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
  async adminList(archived = false) {
    const rows = await this.prisma.preset.findMany({
      where: { deletedAt: archived ? { not: null } : null },
      orderBy: [{ groupId: 'asc' }, { sort: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      include: { group: { select: { id: true, name: true } } },
    });
    return rows;
  }

  listGroups() {
    return this.prisma.presetGroup.findMany({ orderBy: { sort: 'asc' } });
  }

  async createGroup(data: { name: string; sort?: number }) {
    this.requireText(data.name);
    return this.withUniqueGroup(() => this.prisma.presetGroup.create({ data }));
  }

  async updateGroup(id: string, data: { name?: string; sort?: number; expectedUpdatedAt?: string }) {
    const {expectedUpdatedAt, ...patch} = data;
    if (patch.name !== undefined) this.requireText(patch.name);
    return this.withUniqueGroup(() => this.prisma.$transaction(async db => {
      const current = await this.assertGroup(id, db);
      this.checkRevision(current.updatedAt, expectedUpdatedAt);
      return db.presetGroup.update({
        where: { id },
        data: { ...patch, updatedAt: this.nextRevision(current.updatedAt) },
      });
    }));
  }

  async removeGroup(id: string, expectedUpdatedAt?: string) {
    return this.prisma.$transaction(async db => {
      const current = await this.assertGroup(id, db);
      this.checkRevision(current.updatedAt, expectedUpdatedAt);
      // The relation moves the entries to the ungrouped list.
      await db.presetGroup.delete({ where: { id } });
      return { ok: true };
    });
  }

  async createPreset(data: {
    groupId?: string;
    title: string;
    prompt: string;
    icon?: string;
    sort?: number;
    enabled?: boolean;
  }) {
    this.requireText(data.title);
    this.requireText(data.prompt);
    return this.prisma.$transaction(async db => {
      if (data.groupId) await this.assertGroup(data.groupId, db);
      return db.preset.create({ data });
    });
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
      expectedUpdatedAt?: string;
    },
  ) {
    const {expectedUpdatedAt, ...patch} = data;
    if (patch.title !== undefined) this.requireText(patch.title);
    if (patch.prompt !== undefined) this.requireText(patch.prompt);
    return this.changePreset(id, expectedUpdatedAt, false, patch);
  }

  async removePreset(id: string, expectedUpdatedAt?: string) {
    await this.changePreset(id, expectedUpdatedAt, false, { deletedAt: new Date() });
    return { ok: true };
  }

  async restorePreset(id: string, expectedUpdatedAt?: string) {
    if (!expectedUpdatedAt) throw new BusinessException(ErrorCode.PARAM_INVALID, '请重新读取回收站后再恢复');
    return this.changePreset(id, expectedUpdatedAt, true, { deletedAt: null });
  }

  private async changePreset(
    id: string,
    expectedUpdatedAt: string | undefined,
    archived: boolean,
    patch: Prisma.PresetUncheckedUpdateInput & { groupId?: string | null },
  ) {
    return this.prisma.$transaction(async db => {
      const current = await db.preset.findUnique({ where: { id } });
      if (!current || Boolean(current.deletedAt) !== archived) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '预设不存在或状态已变化', 404);
      }
      this.checkRevision(current.updatedAt, expectedUpdatedAt);
      if (patch.groupId) await this.assertGroup(patch.groupId, db);
      return db.preset.update({
        where: { id },
        data: { ...patch, updatedAt: this.nextRevision(current.updatedAt) },
      });
    });
  }

  private async assertGroup(id: string, db: Prisma.TransactionClient) {
    const hit = await db.presetGroup.findUnique({ where: { id }, select: { updatedAt: true } });
    if (!hit) throw new BusinessException(ErrorCode.NOT_FOUND, '预设分组不存在', 404);
    return hit;
  }

  private requireText(value: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '名称和提示词需要填写完整');
    }
  }

  private checkRevision(current: Date, expected?: string) {
    if (expected !== undefined && current.getTime() !== Date.parse(expected)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '这项预设或分组已有变化，请重新核对', 409);
    }
  }

  private nextRevision(current: Date) {
    return new Date(Math.max(Date.now(), current.getTime() + 1));
  }

  private async withUniqueGroup<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '分组名称已存在', 409);
      }
      throw error;
    }
  }
}
