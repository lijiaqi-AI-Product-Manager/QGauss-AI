import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { formatCents, yuanToCents } from '../../common/money/money';
import { page } from '../../common/params';
import { LedgerService } from './ledger.service';

export interface ManualGrantDto {
  userId: string;
  model3Count?: number;
  model4Count?: number;
  drawMjCount?: number;
  agentCount?: number;
  days?: number;
  amountYuan?: number | string;
  packageId?: string;
  extent?: string;
  remark?: string;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  /** 前台余额概览：次数 + 金额 + 最近流水 */
  async overview(userId: string) {
    const view = await this.ledger.view(userId);
    const currency = await this.settings.get<string>('commerce.currency');
    const recent = await this.prisma.balanceConsumeLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        direction: true,
        sourceLogId: true,
        refId: true,
        deductionType: true,
        amount: true,
        bizType: true,
        modelName: true,
        remark: true,
        createdAt: true,
      },
    });
    return {
      ...view,
      currency,
      balanceYuan: formatCents(view.balanceCents),
      recent,
    };
  }

  async consumeLogs(userId: string, q: { page?: unknown; pageSize?: unknown; bizType?: string; deductionType?: unknown; direction?: unknown; keyword?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.BalanceConsumeLogWhereInput = { userId, ...(q.bizType ? { bizType: String(q.bizType) } : {}) };
    if (q.deductionType !== undefined && q.deductionType !== '') {
      if (typeof q.deductionType !== 'string' || !['model3', 'model4', 'drawMj', 'agent', 'money'].includes(q.deductionType)) throw new BusinessException(ErrorCode.PARAM_INVALID, '额度类型无效', 400);
      where.deductionType = q.deductionType;
    }
    if (q.direction !== undefined && q.direction !== '') {
      if (!['string', 'number'].includes(typeof q.direction) || !/^[1-6]$/.test(String(q.direction))) throw new BusinessException(ErrorCode.PARAM_INVALID, '流水动作无效', 400);
      where.direction = Number(q.direction);
    }
    if (q.keyword !== undefined) {
      if (typeof q.keyword !== 'string' || q.keyword.length > 100) throw new BusinessException(ErrorCode.PARAM_INVALID, '搜索词须在 100 字以内', 400);
      const contains = q.keyword.trim();
      if (contains) where.OR = [{ modelName: { contains } }, { remark: { contains } }, { refId: { contains } }, { uid: { contains } }];
    }
    const [items, total] = await Promise.all([
      this.prisma.balanceConsumeLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.balanceConsumeLog.count({ where }),
    ]);
    return { items, total, page: p, pageSize };
  }

  /** 管理员视角：全部用户的消费流水 */
  async allConsumeLogs(q: { page?: unknown; pageSize?: unknown; userId?: string; bizType?: string }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Record<string, unknown> = {};
    if (q.userId) where.userId = String(q.userId);
    if (q.bizType) where.bizType = String(q.bizType);
    const [items, total] = await Promise.all([
      this.prisma.balanceConsumeLog.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.balanceConsumeLog.count({ where: where as never }),
    ]);
    return { items, total, page: p, pageSize };
  }

  async rechargeLogs(userId: string, q: { page?: unknown; pageSize?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.accountLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.accountLog.count({ where }),
    ]);
    return { items, total, page: p, pageSize };
  }

  /** 后台手工充值/发放 */
  async manualGrant(adminId: string, dto: ManualGrantDto) {
    if (!dto?.userId) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '缺少 userId');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);

    let amountCents = 0;
    if (dto.amountYuan !== undefined && dto.amountYuan !== null && dto.amountYuan !== '') {
      const cents = yuanToCents(dto.amountYuan);
      if (cents === null) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '金额格式不正确（最多两位小数）');
      }
      amountCents = cents;
    }

    const log = await this.ledger.grant(dto.userId, {
      model3Count: dto.model3Count,
      model4Count: dto.model4Count,
      drawMjCount: dto.drawMjCount,
      agentCount: dto.agentCount,
      days: dto.days,
      amountCents,
      packageId: dto.packageId,
      extent: dto.extent,
      rechargeType: 'admin',
      remark: dto.remark ?? `管理员 ${adminId} 手工发放`,
    });
    return log;
  }

  /**
   * 游客数据继承：允许未登录游客先试用、注册后继承。
   * 本项目没有游客账号体系（未登录根本无法发起对话），因此这里是显式的空实现，
   * 返回结构化结果而不是 404，避免前端按既有契约调用时报错。
   */
  async visitorCount(_userId: string) {
    return { count: 0, supported: false };
  }

  async inheritVisitorData(_userId: string) {
    return { inherited: 0, supported: false };
  }
}
