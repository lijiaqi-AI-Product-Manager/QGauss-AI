import { Injectable } from '@nestjs/common';
import { VideoTask } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { StorageService } from '../storage/storage.service';
import { prepareImageInputs } from '../image/image-inputs';
import { videoFiles } from './video-accounting.service';
import type { VideoInputs } from './video.service';
import {VideoMaterialsService} from './video-materials.service';
const absent = () => new BusinessException(ErrorCode.NOT_FOUND, '视频文件暂不可用', 404);
interface Ticket { v: 1; purpose: 'input' | 'playback'; taskId: string; fileId: string; kind: string; actor: string; version: number; expires: number }
@Injectable()
export class VideoMediaService {
  private readonly prefix = '/' + (process.env.API_PREFIX || 'api').replace(/^\/+|\/+$/g, '');
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly box: SecretBox, private readonly rate: RateLimitService,private readonly materials:VideoMaterialsService) {}
  private async actor(id: string) { const row = await this.prisma.user.findFirst({ where: { id, status: 'ACTIVE', deletedAt: null }, select: { id: true, tokenVersion: true } }); if (!row) throw absent(); return row; }
  private seal(value: Ticket) { return this.box.encrypt(JSON.stringify(value)); }
  private open(raw: unknown): Ticket { try { if (typeof raw !== 'string' || raw.length < 40 || raw.length > 3000) throw absent(); const t = JSON.parse(this.box.decrypt(raw)); if (t.v !== 1 || !['input', 'playback'].includes(t.purpose) || typeof t.taskId !== 'string' || typeof t.fileId !== 'string' || typeof t.actor !== 'string' || typeof t.kind !== 'string' || !Number.isInteger(t.version) || !Number.isSafeInteger(t.expires) || t.expires < Date.now() || t.expires > Date.now() + 121 * 60000) throw absent(); return t; } catch { throw absent(); } }
  async playback(userId: string, task: VideoTask) {
    if (task.status !== 'SUCCESS' || task.deletedAt || task.userId !== userId && !task.published) throw absent();
    const files = videoFiles(task.resultJson); if (!files) throw absent(); const actor = await this.actor(userId), expires = Date.now() + 5 * 60000;
    const link = (fileId: string, kind: string) => this.prefix + '/video/media/' + encodeURIComponent(task.id) + '/' + kind + '?ticket=' + encodeURIComponent(this.seal({ v: 1, purpose: 'playback', taskId: task.id, fileId, kind, actor: userId, version: actor.tokenVersion, expires }));
    const videoUrl = link(files.videoFileId, 'video'); return { videoUrl, downloadUrl: videoUrl + '&download=1', posterUrl: files.posterFileId ? link(files.posterFileId, 'poster') : null, expiresAt: new Date(expires).toISOString() };
  }
  async inputUrl(task: VideoTask, kind: string) {
    const preset = JSON.parse(task.presetJson), inputs: VideoInputs = JSON.parse(task.inputJson || '{}'), actor = await this.actor(task.userId), fileId = /^material(?:[0-9]|[1-4][0-9])$/.test(kind) ? inputs.materials?.[Number(kind.slice(8))]?.id : kind === 'image0' ? inputs.references?.[0]?.id : inputs.sourceVideo?.fileId;
    if (!preset.publicBaseUrl || !fileId) throw absent(); const expires = task.deadlineAt.getTime() + 60000;
    const token = this.seal({ v: 1, purpose: 'input', taskId: task.id, fileId, kind, actor: task.userId, version: actor.tokenVersion, expires });
    return preset.publicBaseUrl.replace(/\/+$/, '') + this.prefix + '/video/input/' + encodeURIComponent(task.id) + '/' + kind + '?ticket=' + encodeURIComponent(token);
  }
  async access(id: string, kind: string, raw: unknown, purpose: 'input' | 'playback', address: string) {
    if (!this.rate.tryConsume('video-media:' + address, 240)) throw new BusinessException(ErrorCode.RATE_LIMITED, '视频读取过于频繁，请稍后再试', 429);
    const ticket = this.open(raw); if (ticket.taskId !== id || ticket.kind !== kind || ticket.purpose !== purpose) throw absent();
    const actor = await this.actor(ticket.actor); if (actor.tokenVersion !== ticket.version) throw absent();
    const task = await this.prisma.videoTask.findUnique({ where: { id } }); if (!task || task.deletedAt) throw absent();
    if (purpose === 'playback') {
      if (task.status !== 'SUCCESS' || task.userId !== actor.id && !task.published || !['video', 'poster'].includes(kind)) throw absent();
      const files = videoFiles(task.resultJson), fileId = kind === 'video' ? files?.videoFileId : files?.posterFileId; if (!fileId || fileId !== ticket.fileId) throw absent();
      const file = await this.storage.detail(fileId, task.userId, 'USER'); if (kind === 'video' ? file.mime !== 'video/mp4' || file.scope !== 'video' : !/^image\/(png|jpeg|webp)$/.test(file.mime) || file.scope !== 'video-poster') throw absent();
      return { owner: task.userId, fileId, size: file.size, mime: file.mime, filename: 'QGauss-film-' + task.id.slice(-10) + (kind === 'video' ? '.mp4' : '.jpg'), buffer: undefined as Buffer | undefined };
    }
    if (task.userId !== actor.id || !['SUBMITTING', 'POLLING'].includes(task.status)) throw absent();
    const inputs: VideoInputs = JSON.parse(task.inputJson || '{}');
    if(/^material(?:[0-9]|[1-4][0-9])$/.test(kind)){const item=inputs.materials?.[Number(kind.slice(8))];if(!item||item.id!==ticket.fileId)throw absent();try{const file=await this.materials.readExpected(task.userId,item);return{owner:task.userId,fileId:item.id,size:file.buffer.length,mime:file.mime,filename:'QGauss-material-'+item.kind,buffer:file.buffer};}catch{throw absent();}}
    if (kind === 'image0') {
      const source = inputs.references?.[0]; if (!source || source.id !== ticket.fileId) throw absent();
      try { const data = await prepareImageInputs(this.storage, task.userId, [source.id], undefined, { version: 1, references: [source] }, true), file = data.images[0]; return { owner: task.userId, fileId: source.id, size: file.buffer.length, mime: 'image/png', filename: 'QGauss-reference.png', buffer: file.buffer }; } catch { throw absent(); }
    }
    if (kind !== 'sourceVideo' || !inputs.sourceVideo || inputs.sourceVideo.fileId !== ticket.fileId) throw absent();
    const parent = await this.prisma.videoTask.findFirst({ where: { id: inputs.sourceVideo.taskId, userId: task.userId, status: 'SUCCESS', deletedAt: null } }), file = await this.prisma.uploadFile.findFirst({ where: { id: ticket.fileId, userId: task.userId, deletedAt: null, scope: 'video', mime: 'video/mp4' } });
    if (!parent || !file || videoFiles(parent.resultJson)?.videoFileId !== file.id || file.sha256 !== inputs.sourceVideo.sha256 || file.size !== inputs.sourceVideo.size) throw absent();
    return { owner: task.userId, fileId: file.id, size: file.size, mime: file.mime, filename: 'QGauss-source.mp4', buffer: undefined as Buffer | undefined };
  }
}
