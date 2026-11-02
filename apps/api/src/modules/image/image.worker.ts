import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ImageTask } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { ImageProvider } from './image.provider';
import { parseImageInputs, prepareImageInputs } from './image-inputs';
import { imageFeatures } from './image-features';
import { KeyPoolService } from '../models/key-pool.service';
import { ModelsService } from '../models/models.service';
import { ImageAccountingService } from './image-accounting.service';
import { ImageRunsService } from './image-runs.service';

const CONCURRENCY = 2;
const TICK_MS = 500;
type SavedImage = { fileId: string; url: string; mime: string };

@Injectable()
export class ImageWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageWorker.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private stopping = false;
  private readonly active = new Map<string, Promise<void>>();
  private readonly retryAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly provider: ImageProvider,
    private readonly box: SecretBox,
    private readonly accounting: ImageAccountingService,
    private readonly keyPool: KeyPoolService,
    private readonly models: ModelsService,
    private readonly runs: ImageRunsService,
  ) {}

  async onModuleInit() {
    // Recovery completes before polling. An interrupted provider call is never replayed.
    await this.recover();
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.runs.abortAll();
    let deadline: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(this.active.values()),
      new Promise(resolve => { deadline = setTimeout(resolve, 5000); }),
    ]);
    if (deadline) clearTimeout(deadline);
  }

  private async recover() {
    const interrupted = await this.prisma.imageTask.findMany({ where: { OR: [{ status: 'RUNNING' }, { status: { in: ['QUEUED', 'SETTLING'] }, deletedAt: { not: null } }] } });
    for (const task of interrupted) {
      await this.accounting.stop(task.id, 'FAILED', '服务重启，未完成的生成已停止，预留次数已释放；可调整后重试', undefined, true);
      await this.cleanupTaskFiles(task);
    }
    if (interrupted.length) this.logger.warn(`恢复：${interrupted.length} 个中断任务已收尾；已保存作品将继续结算`);
  }

  private async tick() {
    if (this.stopping || this.ticking || this.active.size >= CONCURRENCY) return;
    this.ticking = true;
    try {
      const settling = await this.prisma.imageTask.findMany({ where: { status: 'SETTLING', deletedAt: null }, orderBy: { updatedAt: 'asc' }, take: 20 });
      const resume = settling.find(task => !this.active.has(task.id) && (this.retryAt.get(task.id) || 0) <= Date.now());
      if (resume) { this.launch(resume.id, true); return; }
      const task = await this.prisma.imageTask.findFirst({ where: { status: 'QUEUED', deletedAt: null }, orderBy: { createdAt: 'asc' } });
      if (!task || this.active.has(task.id)) return;
      const claimed = await this.prisma.imageTask.updateMany({ where: { id: task.id, status: 'QUEUED', deletedAt: null }, data: { status: 'RUNNING', startedAt: new Date(), progress: 10 } });
      if (claimed.count) this.launch(task.id);
    } catch (error: any) {
      this.logger.warn(`图像队列轮询失败: ${error?.message ?? error}`);
    } finally { this.ticking = false; }
  }

  private launch(id: string, settling = false) {
    const work = (settling ? this.resumeSettlement(id) : this.process(id))
      .catch(error => this.logger.error(`图像任务 ${id} 处理异常: ${error?.message ?? error}`))
      .finally(() => this.active.delete(id));
    this.active.set(id, work);
  }

  private async process(taskId: string) {
    let controller: AbortController | undefined;
    const saved: SavedImage[] = [];
    try {
      const task = await this.accounting.prepare(taskId);
      if (!task || task.deletedAt || task.status !== 'RUNNING') return;
      controller = this.runs.open(taskId);
      const current = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
      if (!current || current.deletedAt || current.status !== 'RUNNING') return;
      await this.prisma.imageTaskEvent.create({ data: { taskId, status: 'RUNNING', message: '已开始生成' } });
      const route = await this.resolveImageRoute(task.model), channel = route.channel;
      if (!channel) throw new Error('没有可用的图像渠道，请在后台配置');
      const changed = await this.prisma.imageTask.updateMany({ where: { id: taskId, status: 'RUNNING', deletedAt: null }, data: { channelId: channel.id, provider: ImageProvider.providerName(channel.type), progress: 30 } });
      if (!changed.count) return;
      let sourceImage;
      let sourceImages, maskImage;
      if (task.inputJson) {
        const snapshot = parseImageInputs(task.inputJson)!;
        const features = imageFeatures(channel.type, route.upstreamName);
        if (snapshot.references.length > features.maxReferences || (snapshot.mask && !features.mask)) throw new Error('当前图像渠道已不支持原参考设置，请调整后重试');
        if (snapshot.references[0].id !== task.editOf) throw new Error('主参考图记录不一致');
        const prepared = await prepareImageInputs(this.storage, task.userId, snapshot.references.map(file => file.id), snapshot.mask?.id, snapshot, true);
        sourceImages = prepared.images; maskImage = prepared.maskImage;
      } else if (task.editOf) {
        const file = await this.storage.read(task.editOf, task.userId, 'USER');
        sourceImage = { buffer: file.buffer, mime: file.mime };
      }
      const mainKey = channel.apiKey ?? this.decryptKey(channel.apiKeyEnc);
      const pooledKey = await this.keyPool.pick({ id: channel.id, apiKey: mainKey });
      controller.signal.throwIfAborted();
      const result = await this.provider.generate(
        { id: channel.id, type: channel.type, baseUrl: channel.baseUrl, apiKey: pooledKey?.apiKey ?? mainKey, timeoutMs: channel.timeoutMs },
        {
          prompt: task.prompt, negativePrompt: task.negativePrompt ?? undefined, size: task.size, n: task.n,
          sourceImage, sourceImages, maskImage, quality: task.quality, ratio: task.ratio, resolution: task.resolution,
          seed: task.seed ?? undefined, model: route.upstreamName, signal: controller.signal,
          shouldContinue: async () => {
            if (controller?.signal.aborted) return false;
            const row = await this.prisma.imageTask.findUnique({ where: { id: taskId }, select: { status: true, deletedAt: true } });
            return !!row && !row.deletedAt && row.status === 'RUNNING';
          },
        },
      );
      const images = result.images.slice(0, task.n);
      if (!images.length) throw new Error('图像上游没有返回任何结果');
      controller.signal.throwIfAborted();
      const fresh = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
      if (!fresh || fresh.deletedAt || fresh.status !== 'RUNNING') return;
      for (let i = 0; i < images.length; i += 1) {
        const item = images[i];
        const file = await this.storage.saveBuffer(task.userId, item.buffer, { mime: item.mime, filename: `image-${taskId}-${i + 1}.${item.mime.split('/')[1]}`, scope: 'image' });
        saved.push({ fileId: file.id, url: file.url, mime: file.mime });
        controller.signal.throwIfAborted();
      }
      if (!(await this.accounting.stage(taskId, saved, result.meta))) {
        await this.cleanupFiles(task.userId, saved);
        return;
      }
      await this.resumeSettlement(taskId);
    } catch (error: any) {
      const task = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
      // A successful stage retains its durable outputs even if the acknowledgement failed.
      if (task?.status === 'SETTLING' || task?.status === 'SUCCESS') return;
      await this.accounting.stop(taskId, 'FAILED', controller?.signal.aborted ? '生成已中断，未使用的预留次数已释放' : String(error?.message ?? error).slice(0, 300));
      if (task) await this.cleanupFiles(task.userId, saved);
      this.logger.warn(`图像任务 ${taskId} 已停止: ${error?.message ?? error}`);
    } finally { if (controller) this.runs.close(taskId, controller); }
  }

  private async resumeSettlement(taskId: string) {
    try {
      const task = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
      if (!task || task.deletedAt || task.status !== 'SETTLING') { this.retryAt.delete(taskId); return; }
      let results: SavedImage[];
      try {
        results = JSON.parse(task.resultJson || '[]');
        if (!Array.isArray(results) || !results.length || results.length > task.n || results.some(file => !file || typeof file.fileId !== 'string')) throw new Error('作品文件记录不完整');
      } catch {
        await this.accounting.stop(taskId, 'FAILED', '作品文件记录不完整，预留次数已释放', undefined, true);
        await this.cleanupTaskFiles(task);
        this.retryAt.delete(taskId);
        return;
      }
      for (const file of results) {
        try { await this.storage.read(file.fileId, task.userId, 'USER'); }
        catch (error: any) {
          if (error?.code === 'ENOENT' || error?.getStatus?.() === 404) {
            await this.accounting.stop(taskId, 'FAILED', '作品文件未能完整保存，预留次数已释放', undefined, true);
            await this.cleanupTaskFiles(task);
            this.retryAt.delete(taskId);
            return;
          }
          throw error;
        }
      }
      await this.accounting.complete(taskId);
      this.retryAt.delete(taskId);
    } catch (error: any) {
      this.retryAt.set(taskId, Date.now() + 10_000);
      await this.prisma.imageTask.updateMany({ where: { id: taskId, status: 'SETTLING' }, data: { errorCode: 'settlement_pending', errorMessage: '图片已生成，保存与结算暂未完成，系统会自动重试' } }).catch(() => undefined);
      this.logger.warn(`图像任务 ${taskId} 等待结算重试: ${error?.message ?? error}`);
    }
  }

  private async cleanupFiles(userId: string, files: Array<{ fileId: string }>) {
    const results = await Promise.allSettled(files.map(file => this.storage.remove(file.fileId, userId, 'USER')));
    if (results.some(result => result.status === 'rejected')) this.logger.warn('部分未完成图像文件未能清理，需存储恢复后复核');
  }

  private async cleanupTaskFiles(task: ImageTask) {
    const files = await this.prisma.uploadFile.findMany({ where: { userId: task.userId, scope: 'image', filename: { startsWith: `image-${task.id}-` }, deletedAt: null }, select: { id: true } });
    await this.cleanupFiles(task.userId, files.map(file => ({ fileId: file.id })));
  }

  private decryptKey(enc: string): string {
    if (!enc) return '';
    try { return this.box.decrypt(enc); } catch { return ''; }
  }

  private async resolveChannel() {
    const configured = await this.settings.get<string>('image.defaultChannel');
    if (configured) {
      const channel = await this.prisma.channel.findFirst({ where: { id: configured, status: 'ENABLED', deletedAt: null } });
      if (channel) return channel;
    }
    return this.prisma.channel.findFirst({ where: { status: 'ENABLED', deletedAt: null }, orderBy: { priority: 'asc' } });
  }

  private async resolveImageRoute(modelName: string) {
    const legacyDefault = modelName === 'mock-image' && !(await this.prisma.aiModel.findUnique({ where: { name: modelName }, select: { id: true } }));
    if (modelName && !legacyDefault) {
      const route = await this.models.resolveRoute(modelName);
      if (!(route.model.capabilities ?? '').split(/[\s,]+/).includes('image')) throw new Error('所选模型不支持绘画');
      return { channel: route.channels[0] as any, upstreamName: route.channels[0].upstreamName };
    }
    return { channel: await this.resolveChannel() as any, upstreamName: (await this.settings.get<string>('image.model')) || undefined };
  }
}
