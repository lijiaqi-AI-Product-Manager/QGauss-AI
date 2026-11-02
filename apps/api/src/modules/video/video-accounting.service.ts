import { Injectable } from '@nestjs/common';
import { Prisma, VideoTask } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isPool, LedgerService } from '../commerce/ledger.service';
export interface VideoFiles { videoFileId: string; posterFileId?: string; duration?: number }
export function videoFiles(raw?: string | null): VideoFiles | null { try { const row = JSON.parse(raw || 'null'); return row && typeof row.videoFileId === 'string' && row.videoFileId.length && (!row.posterFileId || typeof row.posterFileId === 'string') ? row : null; } catch { return null; } }
@Injectable()
export class VideoAccountingService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}
  async reserveTx(tx: Prisma.TransactionClient, task: VideoTask) {
    if (!isPool(task.pool)) throw Error('视频次数池无效');
    if (task.totalCost) await this.ledger.reserveCountTx(tx, task.userId, { pool: task.pool, amount: task.totalCost, refId: task.id, bizType: 'video', model: task.profile, modelName: task.presetName });
    return tx.videoTask.update({ where: { id: task.id }, data: { reservedAmount: task.totalCost, billingState: task.totalCost ? 'RESERVED' : 'FREE' } });
  }
  async stage(id: string, results: VideoFiles) {
    return this.prisma.$transaction(async tx => { const row = await tx.videoTask.updateMany({ where: { id, status: 'SAVING', deletedAt: null }, data: { resultJson: JSON.stringify(results), status: 'SETTLING', progress: 99, message: '成片已保存，正在完成结算', nextCheckAt: new Date() } }); if (row.count) await tx.videoTaskEvent.create({ data: { taskId: id, status: 'SETTLING', message: '成片已保存，正在完成结算' } }); return row.count > 0; });
  }
  async complete(id: string) {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.videoTask.updateMany({ where: { id, status: 'SETTLING', deletedAt: null }, data: { status: 'SUCCESS' } }); if (!changed.count) return false;
      const task = await tx.videoTask.findUniqueOrThrow({ where: { id } }); if (!videoFiles(task.resultJson)) throw Error('成片尚未完整保存');
      let returnedAmount = 0, expiredAmount = 0;
      if (task.reservedAmount) { const result = await this.ledger.settleCountReservationTx(tx, id, task.totalCost); if (result.userId !== task.userId || result.pool !== task.pool || result.amount !== task.reservedAmount) throw Error('视频预留记录不一致'); returnedAmount = result.returnedAmount; expiredAmount = result.expiredAmount; }
      else if (task.totalCost) throw Error('视频缺少预留记录');
      await tx.videoTask.update({ where: { id }, data: { status: 'SUCCESS', progress: 100, finishedAt: new Date(), billingState: task.totalCost ? 'SETTLED' : 'FREE', chargedAmount: task.totalCost, returnedAmount, expiredAmount, errorCode: null, message: '成片已保存，可以开映了' } });
      await tx.videoTaskEvent.create({ data: { taskId: id, status: 'SUCCESS', message: '成片已保存并完成本次约定结算' } }); return true;
    });
  }
  async stop(id: string, status: 'FAILED' | 'CANCELED', message: string, code?: string, userId?: string, force = false) {
    return this.prisma.$transaction(async tx => {
      const accepted = await tx.videoTask.updateMany({ where: { id, ...(userId ? { userId, deletedAt: null } : {}), status: { in: force ? ['QUEUED', 'SUBMITTING', 'POLLING', 'SAVING', 'SETTLING'] : ['QUEUED', 'SUBMITTING', 'POLLING'] } }, data: { status, finishedAt: new Date(), message: message.slice(0, 250), errorCode: code || null, published: false } }); if (!accepted.count) return false;
      const task = await tx.videoTask.findUniqueOrThrow({ where: { id } }); let returnedAmount = 0, expiredAmount = 0;
      if (task.billingState === 'RESERVED') { const result = await this.ledger.settleCountReservationTx(tx, id, 0); if (result.userId !== task.userId || result.pool !== task.pool || result.amount !== task.reservedAmount) throw Error('视频释放记录不一致'); returnedAmount = result.returnedAmount; expiredAmount = result.expiredAmount; }
      await tx.videoTask.update({ where: { id }, data: { billingState: task.reservedAmount ? 'RELEASED' : 'FREE', returnedAmount, expiredAmount, remoteCancelState: task.upstreamId && status === 'CANCELED' ? 'REQUESTED' : 'NONE', nextCheckAt: new Date() } });
      await tx.videoTaskEvent.create({ data: { taskId: id, status, message: message.slice(0, 250) } }); return true;
    });
  }
}
