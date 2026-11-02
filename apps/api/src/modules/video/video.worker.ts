import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { VideoTask } from '@prisma/client';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { parseImageInputs, prepareImageInputs } from '../image/image-inputs';
import { VideoAccountingService, videoFiles, type VideoFiles } from './video-accounting.service';
import { VideoConnectionService } from './video-connection.service';
import { VideoMediaService } from './video-media.service';
import { MAX_VIDEO_BYTES } from './video-profiles';
import { downloadVideoAsset, VideoFormatError, VideoUpstreamError } from './video-protocol';
import { VideoProvider, type NativeVideoIntent, type NativeVideoState, type VideoRoute } from './video.provider';
import { VideoRunsService } from './video-runs.service';
import type { VideoInputs } from './video.service';
import {VideoMaterialsService} from './video-materials.service';
import {VIDEO_TOOL_MODES} from './video-profiles';
import {inspectVideoToolOutput} from './video-tool-output';
const POLL_MS = process.env.NODE_ENV === 'test' ? 250 : 3000;
@Injectable()
export class VideoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoWorker.name);
  private readonly active = new Map<string, Promise<unknown>>();
  private timer?: NodeJS.Timeout; private ticking = false; private stopping = false;
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly accounting: VideoAccountingService, private readonly connection: VideoConnectionService, private readonly media: VideoMediaService, private readonly provider: VideoProvider, private readonly runs: VideoRunsService,private readonly materials:VideoMaterialsService) {}
  async onModuleInit() { await this.recover(); this.timer = setInterval(() => void this.tick(), 400); this.timer.unref(); }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); this.runs.abortAll(); let limit: NodeJS.Timeout; await Promise.race([Promise.allSettled(this.active.values()), new Promise(done => { limit = setTimeout(done, 5000); })]); clearTimeout(limit!); }
  private async recover() {
    const interrupted = await this.prisma.videoTask.findMany({ where: { status: 'SUBMITTING' } });
    for (const task of interrupted) await this.accounting.stop(task.id, 'FAILED', '服务重启，外部提交结果未确认；没有重新发送，未结算预留已释放', 'submission_unconfirmed');
    await this.prisma.videoTask.updateMany({ where: { status: { in: ['POLLING', 'SAVING', 'SETTLING'] }, deletedAt: null }, data: { nextCheckAt: new Date() } });
    await this.prisma.videoTask.updateMany({ where: { status: 'CANCELED', remoteCancelState: 'PROCESSING' }, data: { remoteCancelState: 'UNCONFIRMED' } });
    if (interrupted.length) this.logger.warn(`视频：${interrupted.length} 条未确认提交已处理；已取得编号的任务只续查原任务`);
  }
  private async tick() {
    if (this.stopping || this.ticking || this.active.size >= 2) return; this.ticking = true;
    try {
      const due = await this.prisma.videoTask.findMany({ where: { deletedAt: null, nextCheckAt: { lte: new Date() }, OR: [{ status: { in: ['SETTLING', 'SAVING', 'POLLING'] } }, { status: 'CANCELED', remoteCancelState: 'REQUESTED' }] }, orderBy: { nextCheckAt: 'asc' }, take: 30 });
      const rank = { SETTLING: 0, SAVING: 1, CANCELED: 2, POLLING: 3 }, ready = due.filter(t => !this.active.has(t.id)).sort((a, b) => rank[a.status] - rank[b.status])[0];
      // One due poll must not starve admission: a held external job can stay due every tick.
      if (ready) this.launch(ready);
      if (this.active.size >= 2) return;
      const submitted = await this.prisma.videoTask.findMany({ where: { status: { in: ['SUBMITTING', 'POLLING'] }, deletedAt: null }, select: { userId: true } }); if (submitted.length >= 8) return;
      const queued = await this.prisma.videoTask.findMany({ where: { status: 'QUEUED', deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 30 }), next = queued.find(t => !this.active.has(t.id) && submitted.filter(s => s.userId === t.userId).length < 2);
      if (!next) return; if (next.deadlineAt.getTime() < Date.now()) { await this.accounting.stop(next.id, 'FAILED', '排队超过本次等待上限，未结算预留已释放', 'queue_expired'); return; }
      const claimed = await this.prisma.videoTask.updateMany({ where: { id: next.id, status: 'QUEUED', deletedAt: null }, data: { status: 'SUBMITTING', startedAt: new Date(), message: '正在向原连接提交这一幕' } }); if (claimed.count) this.launch({ ...next, status: 'SUBMITTING' });
    } catch { this.logger.warn('视频队列本次读取未完成，将继续核对'); } finally { this.ticking = false; }
  }
  private launch(task: VideoTask) { const promise = this.process(task).catch(() => this.logger.warn(`视频任务 ${task.id} 等待核对`)).finally(() => this.active.delete(task.id)); this.active.set(task.id, promise); }
  private async process(task: VideoTask) {
    const controller = this.runs.open(task.id);
    try {
      if (task.status === 'SUBMITTING') await this.submit(task, controller.signal);
      else if (task.status === 'POLLING') await this.poll(task, controller.signal);
      else if (task.status === 'SAVING') await this.save(task, controller.signal);
      else if (task.status === 'SETTLING') await this.settle(task);
      else if (task.status === 'CANCELED') await this.cancelRemote(task, controller.signal);
    } finally { this.runs.close(task.id, controller); }
  }
  private async submit(task: VideoTask, signal: AbortSignal) {
    let attempted = false, receivedId: string | undefined;
    try {
      const user = await this.prisma.user.findFirst({ where: { id: task.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } }); if (!user) throw Error('创作账户暂不可用');
      const preset = JSON.parse(task.presetJson), intent: NativeVideoIntent = JSON.parse(task.intentJson), inputs: VideoInputs | null = task.inputJson ? JSON.parse(task.inputJson) : null;
      let images: Array<{ buffer: Buffer; mime: string }> = [], imageUrl: string | undefined, videoUrl: string | undefined;
      if (intent.mode === 'image') { const snapshot = parseImageInputs(task.inputJson)!; const prepared = await prepareImageInputs(this.storage, task.userId, intent.imageIds!, undefined, snapshot, true); images = prepared.images; if (task.profile === 'PIKA_1') imageUrl = await this.media.inputUrl(task, 'image0'); }
      if (intent.mode === 'extend') {
        const source = await this.prisma.videoTask.findFirst({ where: { id: inputs?.sourceVideo?.taskId, userId: task.userId, status: 'SUCCESS', deletedAt: null } }), files = videoFiles(source?.resultJson), record = inputs?.sourceVideo ? await this.prisma.uploadFile.findFirst({ where: { id: inputs.sourceVideo.fileId, userId: task.userId, deletedAt: null } }) : null;
        if (!source || !files || !record || files.videoFileId !== record.id || record.sha256 !== inputs?.sourceVideo?.sha256) throw Error('来源成片已变化或移除');
        videoUrl = task.profile === 'PIKA_1' ? JSON.parse(source.outputJson || '{}').videoUrl : await this.media.inputUrl(task, 'sourceVideo'); if (!videoUrl) throw Error('来源成片暂不可用');
      }
      const materialUrls:Array<{kind:string;url:string}>=[];
      if(VIDEO_TOOL_MODES.includes(intent.mode)){if(!inputs?.materials?.length)throw Error('素材记录不完整');await this.materials.selection(task.userId,intent,inputs.materials);for(let i=0;i<inputs.materials.length;i++){signal.throwIfAborted();materialUrls.push({kind:inputs.materials[i].kind,url:await this.media.inputUrl(task,'material'+i)});}}
      const picked = task.routeJson ? await this.connection.pinned(JSON.parse(task.routeJson)) : await this.connection.pick(preset.channelId, preset.upstreamModel, task.profile), route = picked.route;
      const stored = await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'SUBMITTING', deletedAt: null }, data: { routeJson: JSON.stringify(route) } }); if (!stored.count) return;
      signal.throwIfAborted(); attempted = true; receivedId = await this.provider.submit(route, picked.key, task.profile, intent, { images, imageUrl, videoUrl,materials:materialUrls }, signal);
      const accepted = await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'SUBMITTING', deletedAt: null }, data: { upstreamId: receivedId, upstreamStatus: 'queued', status: 'POLLING', message: '外部任务已受理，接下来只查询这一幕', nextCheckAt: new Date(Date.now() + POLL_MS) } });
      if (accepted.count) await this.prisma.videoTaskEvent.create({ data: { taskId: task.id, status: 'POLLING', message: '外部任务编号已保存，重启后只续查原任务' } });
      else await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'CANCELED', upstreamId: null }, data: { upstreamId: receivedId, routeJson: JSON.stringify(route), remoteCancelState: 'REQUESTED', nextCheckAt: new Date() } });
    } catch (error) {
      const fresh = await this.prisma.videoTask.findUnique({ where: { id: task.id } }); if (!fresh || fresh.status !== 'SUBMITTING') return;
      if (receivedId) { const saved = await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'SUBMITTING' }, data: { upstreamId: receivedId, status: 'POLLING', upstreamStatus: 'queued', message: '原任务编号已找回，将继续查询', nextCheckAt: new Date() } }).catch(() => null); if (saved?.count) return; }
      const unknown = attempted && (!(error instanceof VideoUpstreamError) || error.uncertain || error.status >= 500 || error.status === 0);
      await this.accounting.stop(task.id, 'FAILED', unknown ? '视频提交结果未确认，未自动重发；未结算预留已释放，请核对后再开始新创作' : attempted ? '视频服务未接受本次提交，未结算预留已释放' : '素材或原连接暂不可用，本次未提交，未结算预留已释放', unknown ? 'submission_unconfirmed' : 'submission_rejected');
    }
  }
  private async poll(task: VideoTask, signal: AbortSignal) {
    if (task.deadlineAt.getTime() < Date.now()) { await this.accounting.stop(task.id, 'FAILED', '视频超过本次等待上限，未结算预留已释放；外部服务仍可能继续处理', 'provider_timeout'); return; }
    let route: VideoRoute | undefined;
    try {
      if (!task.upstreamId || !task.routeJson) throw Error('原任务编号不完整'); route = JSON.parse(task.routeJson); const resolved = await this.connection.pinned(route!); const state = await this.provider.poll(resolved.route, resolved.key, task.profile, task.upstreamId, signal);
      if (state.status === 'failed' || state.status === 'canceled') { await this.accounting.stop(task.id, 'FAILED', '视频服务未完成这一幕，未结算预留已释放', state.status === 'canceled' ? 'provider_canceled' : 'provider_failed'); return; }
      const done = state.status === 'succeeded', changed = await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'POLLING', deletedAt: null }, data: { status: done ? 'SAVING' : 'POLLING', upstreamStatus: state.status, progress: done ? 95 : Math.max(task.progress, state.progress), message: done ? '这一幕已完成，正在保存成片' : state.status === 'queued' ? '服务方正在排片，仍在等待原任务' : '镜头正在一点点成形', attempts: 0, errorCode: null, nextCheckAt: new Date(Date.now() + (done ? 0 : POLL_MS)), ...(done ? { outputJson: JSON.stringify(state) } : {}) } });
      if (done && changed.count) await this.prisma.videoTaskEvent.create({ data: { taskId: task.id, status: 'SAVING', message: '原任务已完成，开始私有保存成片' } });
    } catch (error) {
      if (signal.aborted) return; if (error instanceof VideoUpstreamError && [401, 403].includes(error.status) && route) await this.connection.authorizationFailure(route);
      const attempts = task.attempts + 1, auth = error instanceof VideoUpstreamError && [401, 403].includes(error.status);
      await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'POLLING' }, data: { attempts, errorCode: auth ? 'connection_authorization' : 'poll_pending', message: auth ? '原连接授权暂未通过，等待管理员核对；不会重新提交生成' : '原任务暂未查询完成，将继续核对，不会重复开机', nextCheckAt: new Date(auth ? task.deadlineAt.getTime() : Date.now() + Math.min(60000, POLL_MS * Math.pow(2, Math.min(attempts, 5)))) } });
    }
  }
  private async savedMovie(task: VideoTask) { const prior = await this.prisma.uploadFile.findFirst({ where: { userId: task.userId, scope: 'video', filename: `video-${task.id}.mp4`, deletedAt: null } }); if (!prior) return null; const file = await this.storage.read(prior.id, task.userId, 'USER'), info = inspectVideoToolOutput(file.buffer,task.intentJson,task.inputJson); return { id: prior.id, info }; }
  private async save(task: VideoTask, signal: AbortSignal) {
    try {
      const output: NativeVideoState = JSON.parse(task.outputJson || '{}'); if (!output.videoUrl) throw Error('成片地址未完整保存');
      let movie = await this.savedMovie(task);
      if (!movie) { const bytes = await downloadVideoAsset(output.videoUrl, MAX_VIDEO_BYTES, 120000, signal), info = inspectVideoToolOutput(bytes,task.intentJson,task.inputJson); signal.throwIfAborted(); const file = await this.storage.saveBuffer(task.userId, bytes, { scope: 'video', mime: 'video/mp4', filename: `video-${task.id}.mp4` }); movie = { id: file.id, info }; }
      const results: VideoFiles = { videoFileId: movie.id, ...(movie.info.duration ? { duration: movie.info.duration } : {}) };
      if (output.posterUrl) {
        const prior = await this.prisma.uploadFile.findFirst({ where: { userId: task.userId, scope: 'video-poster', filename: `video-${task.id}-poster.jpg`, deletedAt: null } });
        if (prior) results.posterFileId = prior.id;
        else try { const buffer = await downloadVideoAsset(output.posterUrl, 6 * 1024 * 1024, 20000, signal), normalized = await sharp(buffer, { limitInputPixels: 8388608, failOn: 'warning' }).rotate().resize({ width: 960, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(), poster = await this.storage.saveBuffer(task.userId, normalized, { scope: 'video-poster', mime: 'image/jpeg', filename: `video-${task.id}-poster.jpg` }); results.posterFileId = poster.id; } catch { if (signal.aborted) return; }
      }
      signal.throwIfAborted(); if (await this.accounting.stage(task.id, results)) await this.settle({ ...task, status: 'SETTLING', resultJson: JSON.stringify(results) });
    } catch (error) {
      if (signal.aborted) return; const current = await this.prisma.videoTask.findUnique({ where: { id: task.id } }); if (!current || ['SETTLING', 'SUCCESS'].includes(current.status)) return;
      if (task.deadlineAt.getTime() < Date.now() || error instanceof VideoFormatError && task.attempts >= 2) { await this.accounting.stop(task.id, 'FAILED', '成片未能完整保存，未结算预留已释放', 'storage_failed', undefined, true); return; }
      let outputJson = task.outputJson;
      // A fresh read of the same external job may renew an expiring asset URL; never regenerate.
      if (error instanceof VideoUpstreamError && [401, 403, 404].includes(error.status) && task.routeJson && task.upstreamId) try { const resolved = await this.connection.pinned(JSON.parse(task.routeJson)), fresh = await this.provider.poll(resolved.route, resolved.key, task.profile, task.upstreamId, signal); if (fresh.status === 'succeeded') outputJson = JSON.stringify(fresh); } catch {}
      await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'SAVING' }, data: { outputJson, attempts: { increment: 1 }, errorCode: 'storage_pending', message: '原任务已完成，成片保存暂未完成，将继续保存同一结果', nextCheckAt: new Date(Date.now() + Math.min(60000, POLL_MS * Math.pow(2, Math.min(task.attempts + 1, 5)))) } });
    }
  }
  private async settle(task: VideoTask) {
    try { const files = videoFiles(task.resultJson); if (!files) throw new VideoFormatError('成片记录不完整'); const metadata = await this.prisma.uploadFile.findFirst({ where: { id: files.videoFileId, userId: task.userId, deletedAt: null, scope: 'video', mime: 'video/mp4' } }); if (!metadata) throw new VideoFormatError('成片记录不完整'); const stored = await this.storage.read(files.videoFileId, task.userId, 'USER'); inspectVideoToolOutput(stored.buffer,task.intentJson,task.inputJson); if (stored.buffer.length !== metadata.size || createHash('sha256').update(stored.buffer).digest('hex') !== metadata.sha256) throw new VideoFormatError('成片内容未完整保存'); await this.accounting.complete(task.id); }
    catch (error) { if (error instanceof VideoFormatError || (error as any)?.code === 'ENOENT' || (error as any)?.getStatus?.() === 404) { await this.accounting.stop(task.id, 'FAILED', '已保存的成片文件不完整，未结算预留已释放', 'saved_file_missing', undefined, true); return; } await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'SETTLING' }, data: { errorCode: 'settlement_pending', message: '成片已保存，结算暂未完成；将只继续本次结算', nextCheckAt: new Date(Date.now() + 5000) } }); }
  }
  private async cancelRemote(task: VideoTask, signal: AbortSignal) {
    const claimed = await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'CANCELED', remoteCancelState: 'REQUESTED' }, data: { remoteCancelState: 'PROCESSING' } }); if (!claimed.count) return;
    let result = 'UNCONFIRMED'; try { if (task.upstreamId && task.routeJson) { const resolved = await this.connection.pinned(JSON.parse(task.routeJson)); result = await this.provider.cancelQueued(resolved.route, resolved.key, task.profile, task.upstreamId, signal); } } catch {}
    await this.prisma.videoTask.updateMany({ where: { id: task.id, status: 'CANCELED', remoteCancelState: 'PROCESSING' }, data: { remoteCancelState: result } });
    await this.prisma.videoTaskEvent.create({ data: { taskId: task.id, status: 'CANCELED', message: result === 'ACKNOWLEDGED' ? '服务方已确认取消排队；站内预留已处理' : result === 'SIGNALLED' ? '服务方已接收运行中取消信号，仍可能完成或产生外部费用；站内预留已处理' : result === 'LOCAL_ONLY' ? '已停止站内等待；外部任务已运行或不支持取消，仍可能产生外部费用' : '外部取消结果未确认，没有自动重发取消；站内预留已处理' } });
  }
}
