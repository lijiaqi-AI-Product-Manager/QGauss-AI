import { Injectable } from '@nestjs/common';
import { Prisma, ImageTask } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { LedgerService } from '../commerce/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { imageChargeUnits } from './image-pricing';

/** Accepted image prices and count authorizations live with the task, never in process memory. */
@Injectable()
export class ImageAccountingService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService, private readonly settings: SettingsService) {}

  async quote(quality: string): Promise<number> {
    const [enabled, demo, value] = await Promise.all([
      this.settings.get<boolean>('commerce.enabled'), this.settings.get<boolean>('demo.siteEnabled'), this.settings.get<number>('commerce.imageCost'),
    ]);
    if (!enabled || demo) return 0;
    const cost = Number(value), unitCost = cost * imageChargeUnits(1, quality);
    if (!Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(unitCost) || unitCost * 4 > 2_147_483_647) throw new BusinessException(ErrorCode.INTERNAL, '站点绘画费用配置无效', 500);
    return unitCost;
  }

  async reserveTaskTx(tx: Prisma.TransactionClient, task: ImageTask, unitCost: number) {
    const amount = unitCost * task.n;
    if (amount) await this.ledger.reserveCountTx(tx, task.userId, { pool: 'drawMj', amount, refId: task.id, bizType: 'draw', model: task.model, modelName: task.versionName || task.model });
    return tx.imageTask.update({ where: { id: task.id }, data: { billingUnitCost: unitCost, billingState: amount ? 'RESERVED' : 'FREE', reservedAmount: amount } });
  }

  /** Legacy queued tasks receive their first price before their next upstream call. */
  async prepare(taskId: string) {
    const task = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
    if (!task || task.billingUnitCost !== null) return task;
    const cost = await this.quote(task.quality);
    return this.prisma.$transaction(async tx => {
      const claimed = await tx.imageTask.updateMany({ where: { id: taskId, status: 'RUNNING', deletedAt: null, billingUnitCost: null }, data: { billingUnitCost: cost } });
      if (!claimed.count) return tx.imageTask.findUnique({ where: { id: taskId } });
      return this.reserveTaskTx(tx, task, cost);
    });
  }

  /** Durable saved outputs precede final settlement, so a restart never calls the provider twice. */
  async stage(taskId: string, results: Array<{ fileId: string; url: string; mime: string }>, meta?: Record<string, unknown>) {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.imageTask.updateMany({ where: { id: taskId, status: 'RUNNING', deletedAt: null }, data: { status: 'SETTLING', progress: 95, resultJson: JSON.stringify(results), metaJson: meta ? JSON.stringify(meta) : null } });
      if (changed.count) await tx.imageTaskEvent.create({ data: { taskId, status: 'SETTLING', message: '图片已生成，正在保存作品并完成结算' } });
      return changed.count > 0;
    });
  }

  async complete(taskId: string) {
    return this.prisma.$transaction(async tx => {
      // SUCCESS is invisible to other requests until its ledger changes and event commit.
      const claimed = await tx.imageTask.updateMany({ where: { id: taskId, status: 'SETTLING', deletedAt: null }, data: { status: 'SUCCESS' } });
      if (!claimed.count) return false;
      const task = await tx.imageTask.findUniqueOrThrow({ where: { id: taskId } });
      const results: unknown = JSON.parse(task.resultJson || '[]');
      if (!Array.isArray(results) || !results.length || results.length > task.n || task.billingUnitCost === null) throw new Error('作品或费用记录不完整，暂不能结算');
      const amount = task.billingUnitCost * results.length;
      let returnedAmount = 0, expiredAmount = 0;
      if (task.reservedAmount) {
        const settled = await this.ledger.settleCountReservationTx(tx, task.id, amount);
        if (settled.userId !== task.userId || settled.pool !== 'drawMj' || settled.amount !== task.reservedAmount) throw new Error('次数预留与作品不一致');
        returnedAmount = settled.returnedAmount; expiredAmount = settled.expiredAmount;
      } else if (amount) throw new Error('作品缺少次数预留');
      await tx.imageTask.update({ where: { id: taskId }, data: { progress: 100, finishedAt: new Date(), billingState: task.reservedAmount ? 'SETTLED' : 'FREE', chargedAmount: amount, returnedAmount, expiredAmount, errorCode: null, errorMessage: null } });
      await tx.imageTaskEvent.create({ data: { taskId, status: 'SUCCESS', message: `生成完成，共 ${results.length} / ${task.n} 张` } });
      return true;
    });
  }

  async stop(taskId: string, status: 'FAILED' | 'CANCELED', message: string, userId?: string, includeSettling = false) {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.imageTask.updateMany({ where: { id: taskId, ...(userId ? { userId, deletedAt: null } : {}), status: { in: includeSettling ? ['QUEUED', 'RUNNING', 'SETTLING'] : ['QUEUED', 'RUNNING'] } }, data: { status, finishedAt: new Date(), published: false, errorCode: status === 'FAILED' ? 'generate_failed' : null, errorMessage: status === 'FAILED' ? message.slice(0, 300) : null } });
      if (!changed.count) return false;
      const task = await tx.imageTask.findUniqueOrThrow({ where: { id: taskId } });
      if (task.billingState === 'RESERVED') {
        const released = await this.ledger.settleCountReservationTx(tx, taskId, 0);
        if (released.userId !== task.userId || released.pool !== 'drawMj') throw new Error('次数预留与作品不一致');
        await tx.imageTask.update({ where: { id: taskId }, data: { billingState: 'RELEASED', returnedAmount: released.returnedAmount, expiredAmount: released.expiredAmount } });
      }
      await tx.imageTaskEvent.create({ data: { taskId, status, message: message.slice(0, 200) } });
      return true;
    });
  }
}
