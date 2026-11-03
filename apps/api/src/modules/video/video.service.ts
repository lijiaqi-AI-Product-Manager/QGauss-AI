import {galleryPublicPage} from '../gallery/gallery-query';
import {saveGalleryPublication} from '../gallery/gallery-publication';
import { Injectable } from '@nestjs/common';
import { VideoPreset, VideoTask } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { SettingsService } from '../settings/settings.service';
import { ModerationService } from '../moderation/moderation.service';
import { StorageService } from '../storage/storage.service';
import { prepareImageInputs, type ImageInputs } from '../image/image-inputs';
import { VideoCreateDto, VideoPresetDto, VideoQuoteDto } from './video.dto';
import { VideoAccountingService, videoFiles } from './video-accounting.service';
import { VideoConnectionService } from './video-connection.service';
import { videoFeatures, VIDEO_ACTIVE, VIDEO_PROFILES, videoModeName, videoProfileName } from './video-profiles';
import { VideoRunsService } from './video-runs.service';
import type { NativeVideoIntent } from './video.provider';
import {VideoMaterialsService} from './video-materials.service';
import type {VideoMaterial} from './video-materials';
import {videoToolIntent,validateVideoToolMaterials} from './video-tools-intent';
import {VIDEO_TOOL_MODES,FAL_VIDEO_MODELS} from './video-profiles';
import { videoEndpoint } from './video-protocol';
const bad = (message: string, status = 400) => new BusinessException(ErrorCode.PARAM_INVALID, message, status);
const absent = () => new BusinessException(ErrorCode.NOT_FOUND, '视频任务不存在', 404);
const parse = <T>(raw: string | null | undefined, fallback: T): T => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
function stable(value: any): any { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, stable(value[k])])); return value; }
export const videoHash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export type VideoInputs = ImageInputs & { materials?:VideoMaterial[]; sourceVideo?: { taskId: string; fileId: string; sha256: string; size: number } };
function requestHash(dto: VideoQuoteDto) { const { requestKey, quoteRevision, ...intent } = dto as VideoCreateDto; return videoHash({ ...intent, prompt: dto.prompt.trim() }); }
const presetView = (p: VideoPreset) => ({ id: p.id, name: p.name, profile: p.profile, channelId: p.channelId, upstreamModel: p.upstreamModel, enabled: p.enabled, baseCost: p.baseCost, perSecondCost: p.perSecondCost, pool: p.pool, maxWaitMinutes: p.maxWaitMinutes, publicBaseUrl: p.publicBaseUrl, version: p.version, updatedAt: p.updatedAt });
@Injectable()
export class VideoService {
  private readonly preparing = new Set<string>();
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly storage: StorageService, private readonly moderation: ModerationService, private readonly accounting: VideoAccountingService, private readonly connection: VideoConnectionService, private readonly runs: VideoRunsService, private readonly rate: RateLimitService, private readonly materials:VideoMaterialsService) {}
  private async costs(p: VideoPreset) { const [enabled, demo] = await Promise.all([this.settings.get<boolean>('commerce.enabled'), this.settings.get<boolean>('demo.siteEnabled')]); return { base: enabled && !demo ? p.baseCost : 0, perSecond: enabled && !demo ? p.perSecondCost : 0, pool: p.pool }; }
  private publicBase(raw: string) { if (!raw.trim()) return ''; try { const u = new URL(raw.trim()); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.protocol === 'http:' && process.env.NODE_ENV === 'production') throw Error(); return u.href.replace(/\/+$/, ''); } catch { throw bad('本站公网入口需要完整的网址，生产环境使用 HTTPS'); } }
  async adminConfig() { const [presets, channels] = await Promise.all([this.prisma.videoPreset.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }), this.prisma.channel.findMany({ where: { type: 'OPENAI', deletedAt: null }, select: { id: true, name: true, type: true, status: true } })]); return { presets: presets.map(presetView), channels: channels.map(c => ({ id: c.id, name: c.name, type: c.type, enabled: c.status === 'ENABLED' })), profiles: VIDEO_PROFILES.map(key => ({ key, name: videoProfileName(key) })) }; }
  async savePreset(dto: VideoPresetDto, id?: string) {
    const base = this.publicBase(dto.publicBaseUrl), model = dto.upstreamModel.trim(), name = dto.name.trim(); if (!name) throw bad('请填写前台名称');
    if(dto.profile.startsWith('FAL_') && model && model !== FAL_VIDEO_MODELS[dto.profile]) throw bad('这个处理协议需要对应的原生模型路径');
    if (dto.profile === 'PIKA_1' && model && model !== '1.0') throw bad('Pika Web 视频档位使用 1.0 模型');
    if (model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw bad('上游模型或接入点格式无效');
    if (dto.enabled) { if (!dto.channelId || !model) throw bad('开启前请选择渠道并填写上游模型'); const channel = await this.connection.channel(dto.channelId); if (!channel) throw bad('所选视频渠道尚未开启'); try { videoEndpoint(channel.baseUrl, dto.profile, 'submit'); } catch { throw bad('视频渠道基地址格式无效'); } }
    const data = { name, profile: dto.profile, channelId: dto.channelId, upstreamModel: model, enabled: dto.enabled, baseCost: dto.baseCost, perSecondCost: dto.perSecondCost, pool: dto.pool, maxWaitMinutes: dto.maxWaitMinutes, publicBaseUrl: base };
    if (!id) { if (dto.version !== 0) throw bad('新增连接版本应为零', 409); if (await this.prisma.videoPreset.count({ where: { deletedAt: null } }) >= 32) throw bad('视频创作连接最多 32 条'); return presetView(await this.prisma.videoPreset.create({ data })); }
    const updated = await this.prisma.videoPreset.updateMany({ where: { id, version: dto.version, deletedAt: null }, data: { ...data, version: { increment: 1 } } }); if (!updated.count) throw bad('视频连接已更新，请重新读取后编辑', 409); return presetView(await this.prisma.videoPreset.findUniqueOrThrow({ where: { id } }));
  }
  async options() {const cats=await this.prisma.creationCat.findMany({where:{status:true},orderBy:[{sort:'asc'},{id:'asc'}],select:{id:true,name:true}}); const presets = await this.prisma.videoPreset.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }); return {cats, presets: await Promise.all(presets.map(async p => { const channel = p.enabled ? await this.connection.channel(p.channelId) : null, features = videoFeatures(p.profile); if (!p.publicBaseUrl) features.modes = features.modes.filter(m => !VIDEO_TOOL_MODES.includes(m) && !(p.profile === 'PIKA_1' && m === 'image') && !(p.profile === 'ARK_2_5' && m === 'extend')); const ready = p.enabled && !!channel && !!p.upstreamModel && features.modes.length>0; return { id: p.id, name: p.name, profile: p.profile, caption: videoProfileName(p.profile), ready, reason: ready ? '' : p.enabled && channel && !features.modes.length ? '请先在控制台配置素材读取入口' : p.enabled ? '视频原连接暂不可用' : '这条创作连接尚未开启', features, pricing: await this.costs(p) }; })) }; }
  private intent(dto: VideoQuoteDto, p: VideoPreset): NativeVideoIntent {
    if(VIDEO_TOOL_MODES.includes(dto.mode))return videoToolIntent(dto,p.profile,p.id);
    if(['videoIds','audioIds','upscaleFactor','enhanceModel','syncMode','speakerSelection','compression','noise','halo','grain','recoverDetail'].some(k=>dto[k]!==undefined))throw bad('素材与处理选项不属于当前创作方式');
    const f = videoFeatures(p.profile), prompt = dto.prompt.trim(); if (!prompt) throw bad('请描述想创作的画面');
    if (!f.modes.includes(dto.mode) || !f.ratios.includes(dto.ratio)) throw bad('所选模型不支持此创作方式或画幅');
    const seconds = dto.seconds ?? (p.profile === 'PIKA_1' ? 0 : 5), resolution = dto.resolution ?? (p.profile === 'PIKA_1' ? '' : '720p');
    if (!f.seconds.includes(seconds) || (resolution && !f.resolutions.includes(resolution))) throw bad('所选模型不支持此时长或清晰度');
    if (p.profile !== 'PIKA_1' && !resolution) throw bad('请选择视频清晰度');
    if (f.adaptiveImage && ['image', 'extend'].includes(dto.mode) && dto.ratio !== 'adaptive') throw bad('此档位的参考图和续写需要跟随原画面比例');
    if (!f.sound && dto.sound !== undefined) throw bad('所选档位未开放同步声音选项');
    if (!f.camera && ['style', 'motion', 'guidanceScale', 'frameRate', 'pan', 'tilt', 'rotate', 'zoom', 'negativePrompt'].some(k => dto[k] !== undefined)) throw bad('请在描述中表达风格和运镜，此档位不接收独立运镜参数');
    if (dto.mode === 'image' ? !dto.imageIds?.length || dto.imageIds.length > f.maxImages : dto.imageIds !== undefined) throw bad('参考图数量与当前创作方式不符');
    if (dto.mode === 'extend' ? !dto.sourceTaskId : dto.sourceTaskId !== undefined) throw bad('续写需要选择自己的已完成成片');
    return { presetId: p.id, mode: dto.mode, prompt, ratio: dto.ratio, seconds, resolution, ...(dto.seed === undefined ? {} : { seed: dto.seed }), ...(f.sound ? { sound: dto.sound ?? true } : {}), ...(dto.mode === 'image' ? { imageIds: [...dto.imageIds!] } : {}), ...(dto.mode === 'extend' ? { sourceTaskId: dto.sourceTaskId } : {}), ...(f.camera ? { style: dto.style || '', motion: dto.motion ?? 1, guidanceScale: dto.guidanceScale ?? 16, frameRate: dto.frameRate ?? 24, pan: dto.pan || '', tilt: dto.tilt || '', rotate: dto.rotate || '', zoom: dto.zoom || '', negativePrompt: dto.negativePrompt || '' } : {}) };
  }
  private async prepare(userId: string, dto: VideoQuoteDto) {
    const preset = await this.prisma.videoPreset.findFirst({ where: { id: dto.presetId, enabled: true, deletedAt: null } }); if (!preset) throw bad('这条视频连接尚未开启');
    const channel = await this.connection.channel(preset.channelId); if (!channel) throw bad('视频原连接暂不可用');
    const intent = this.intent(dto, preset), hit = await this.moderation.check(intent.prompt + '\n' + (intent.negativePrompt || ''));
    if (hit?.action === 'block') { await this.moderation.recordHit({ userId, word: hit.word, source: 'video', excerpt: intent.prompt }); throw new BusinessException(ErrorCode.CONTENT_BLOCKED, '描述未通过站点内容检查，请调整后重试', 400); }
    let inputs: VideoInputs | null = null, inheritedRoute: string | null = null;
    if (intent.mode === 'image') {
      if (preset.profile === 'PIKA_1' && !preset.publicBaseUrl) throw bad('此连接需要先配置本站公网素材入口');
      if (this.preparing.has(userId) || this.preparing.size >= 4) throw bad('参考图片正在处理中，请稍后再试', 429);
      this.preparing.add(userId); try { inputs = (await prepareImageInputs(this.storage, userId, intent.imageIds!)).snapshot; } finally { this.preparing.delete(userId); }
      if (preset.profile !== 'PIKA_1' && inputs.references.some(i => Math.min(i.width, i.height) < 300 || Math.max(i.width, i.height) > 6000 || i.width / i.height < .4 || i.width / i.height > 2.5)) throw bad('此模型参考图每边需为 300–6000 像素，宽高比需在 0.4–2.5 之间');
    }
    if (intent.mode === 'extend') {
      const source = await this.prisma.videoTask.findFirst({ where: { id: intent.sourceTaskId!, userId, status: 'SUCCESS', deletedAt: null } }), files = videoFiles(source?.resultJson);
      if (!source || !files) throw bad('来源成片不存在或尚未完成');
      const original = parse<NativeVideoIntent>(source.intentJson, null as any), metadata = await this.prisma.uploadFile.findFirst({ where: { id: files.videoFileId, userId, mime: 'video/mp4', scope: 'video', deletedAt: null }, select: { id: true, size: true, sha256: true } });
      if (!metadata) throw bad('来源成片文件已移除');
      if (preset.profile === 'PIKA_1') {
        if (source.profile !== 'PIKA_1' || parse<any>(source.routeJson, {}).channelId !== preset.channelId || !parse<any>(source.outputJson, {}).videoUrl) throw bad('兼容续写需要同一原连接生成的成片');
        const keys = ['prompt', 'ratio', 'seconds', 'resolution', 'seed', 'style', 'motion', 'guidanceScale', 'frameRate', 'pan', 'tilt', 'rotate', 'zoom', 'negativePrompt'];
        if (keys.some(k => intent[k] !== original[k])) throw bad('兼容续写保留来源描述、风格和运镜，请使用来源成片参数'); inheritedRoute = source.routeJson;
      } else { if (!preset.publicBaseUrl) throw bad('续写需要先配置本站公网素材入口'); if (!files.duration || files.duration < 4 || files.duration > 30) throw bad('续写来源需要可确认的 4–30 秒成片'); }
      inputs = { version: 1, references: [], sourceVideo: { taskId: source.id, fileId: metadata.id, sha256: metadata.sha256, size: metadata.size } };
    }
    if(VIDEO_TOOL_MODES.includes(intent.mode)){
      if(!preset.publicBaseUrl)throw bad('这项创作需要先配置本站公网素材入口');
      if(this.preparing.has(userId)||this.preparing.size>=4)throw bad('素材正在处理中，请稍后再试',429);
      this.preparing.add(userId);try{const selected=await this.materials.selection(userId,intent);validateVideoToolMaterials(intent,preset.profile,selected);if(intent.speakerSelection)await this.materials.validateSpeaker(userId,intent.speakerSelection,selected);inputs={version:1,references:[],materials:selected};}finally{this.preparing.delete(userId);}
    }
    const pricing = await this.costs(preset), multiplier=intent.mode==='upscale'?Math.pow(intent.upscaleFactor!,2):1, cost = pricing.base + Math.ceil(pricing.perSecond * (intent.billingSeconds??intent.seconds) * multiplier);
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > 2147483647) throw bad('视频费用配置无效');
    const revision = videoHash({ presetVersion: preset.version, channelId: channel.id, channelUpdatedAt: channel.updatedAt.toISOString(), intent, inputs, cost, pool: preset.pool });
    return { preset, intent, inputs, inheritedRoute, revision, cost };
  }
  async materialFrames(userId:string,id:string){if(!this.rate.tryConsume('video-frames:'+userId,30)||this.preparing.has(userId)||this.preparing.size>=4)throw bad('画面正在准备中，请稍后再试',429);this.preparing.add(userId);try{return await this.materials.frames(userId,id);}finally{this.preparing.delete(userId);}}
  async quote(userId: string, dto: VideoQuoteDto) { if (!this.rate.tryConsume('video-quote:' + userId, await this.settings.get<number>('security.videoQuoteRateLimit'))) throw bad('费用核对过于频繁，请稍后重试', 429); const p = await this.prepare(userId, dto); return { revision: p.revision, cost: p.cost, pool: p.preset.pool, name: p.preset.name, seconds: p.intent.billingSeconds??p.intent.seconds, followsSource: ['edit','upscale','lipsync'].includes(p.intent.mode), multiplier:p.intent.mode==='upscale'?Math.pow(p.intent.upscaleFactor!,2):1, materials:p.inputs?.materials?.map(({kind,filename,duration,width,height})=>({kind,filename,duration,width,height})), mode: p.intent.mode,...(p.intent.speakerSelection?{speakerSelection:p.intent.speakerSelection}:{}) }; }
  async create(userId: string, dto: VideoCreateDto) {
    const signature = requestHash(dto), previous = await this.prisma.videoTask.findUnique({ where: { userId_requestKey: { userId, requestKey: dto.requestKey } } });
    if (previous) { if (previous.intentHash !== signature) throw bad('同一提交标识不能用于不同创意', 409); if (previous.deletedAt) throw absent(); return this.view(previous, userId); }
    if (!this.rate.tryConsume('video-create:' + userId, await this.settings.get<number>('security.videoRateLimit'))) throw bad('开机过于频繁，请稍后重试', 429);
    const p = await this.prepare(userId, dto); if (p.revision !== dto.quoteRevision) throw bad('连接、素材或费用已变化，请再次确认后开机', 409);
    try {
      const task = await this.prisma.$transaction(async tx => {
        const row = await tx.videoTask.create({ data: { userId, requestKey: dto.requestKey, intentHash: signature, presetId: p.preset.id, presetName: p.preset.name, profile: p.preset.profile, presetJson: JSON.stringify(presetView(p.preset)), intentJson: JSON.stringify(p.intent), inputJson: p.inputs ? JSON.stringify(p.inputs) : null, routeJson: p.inheritedRoute, pool: p.preset.pool, totalCost: p.cost, deadlineAt: new Date(Date.now() + p.preset.maxWaitMinutes * 60000), message: '这一幕已进入片场队列' } });
        if (await tx.videoTask.count({ where: { userId, deletedAt: null, status: { in: VIDEO_ACTIVE } } }) > 3) throw bad('同时等待的创作最多三条，请等一条完成', 429);
        const accepted = await this.accounting.reserveTx(tx, row); await tx.videoTaskEvent.create({ data: { taskId: row.id, status: 'QUEUED', message: row.totalCost ? `已确认开机，预留 ${row.totalCost} 次` : '已确认开机，本次不扣次数' } }); return accepted;
      }); return this.view(task, userId);
    } catch (error) { if ((error as any)?.code === 'P2002') { const row = await this.prisma.videoTask.findUnique({ where: { userId_requestKey: { userId, requestKey: dto.requestKey } } }); if (row && row.intentHash === signature && !row.deletedAt) return this.view(row, userId); throw bad('同一提交标识不能用于不同创意', 409); } throw error; }
  }
  view(task: VideoTask, actor: string, admin = false) {
    const mine = task.userId === actor, intent = parse<NativeVideoIntent>(task.intentJson, {} as NativeVideoIntent), files = videoFiles(task.resultJson), features = videoFeatures(task.profile), params: any = { ...intent }; if (!mine) { delete params.imageIds; delete params.sourceTaskId; delete params.videoIds; delete params.audioIds; delete params.speakerSelection; }
    return { id: task.id, presetId: task.presetId, presetName: task.presetName, profile: task.profile, mode: intent.mode, modeLabel: videoModeName(intent.mode), prompt: intent.prompt, ratio: intent.ratio, resolution: intent.resolution, seconds: files?.duration || intent.seconds, seed: intent.seed, params, ...(mine ? { imageIds: intent.imageIds, sourceTaskId: intent.sourceTaskId, materials:parse<VideoInputs | null>(task.inputJson,null)?.materials?.map(({sha256,sourceTaskId,...m})=>m), requestKey: task.requestKey } : {}), status: task.status, progress: task.progress, message: task.message, errorCode: task.errorCode, mine, published: task.published,catId:task.catId,publishedAt:task.publishedAt,updatedAt:task.updatedAt, canExtend: features.modes.includes('extend') && !!files?.videoFileId && (task.profile === 'PIKA_1' || !!files.duration && files.duration >= 4 && files.duration <= 30), ...(mine || admin ? { billing: { pool: task.pool, state: task.billingState, reserved: task.billingState === 'RESERVED' ? task.reservedAmount : 0, limit: task.reservedAmount, charged: task.chargedAmount, returned: task.returnedAmount, expired: task.expiredAmount }, remoteCancelState: task.remoteCancelState } : {}), ...(admin ? { upstreamId: task.upstreamId } : {}), createdAt: task.createdAt, finishedAt: task.finishedAt };
  }
  async visible(userId: string, id: string) { const row = await this.prisma.videoTask.findUnique({ where: { id } }); if (!row || row.deletedAt || row.userId !== userId && (!row.published || row.status !== 'SUCCESS' || !await this.prisma.user.findFirst({where:{id:row.userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))) throw absent(); return row; }
  async detail(userId: string, id: string) { const row = await this.visible(userId, id), mine = row.userId === userId, events = mine ? await this.prisma.videoTaskEvent.findMany({ where: { taskId: id }, orderBy: { createdAt: 'asc' } }) : []; return { ...this.view(row, userId), events }; }
  async byRequest(userId: string, requestKey: string) { const row = await this.prisma.videoTask.findUnique({ where: { userId_requestKey: { userId, requestKey } } }); if (!row || row.deletedAt) throw absent(); return this.detail(userId, row.id); }
  async list(userId:string,square:boolean,page:number,size:number,trash=false){page=Number.isFinite(page)?Math.max(1,Math.min(100000,Math.floor(page))):1;size=Number.isFinite(size)?Math.max(1,Math.min(30,Math.floor(size))):12;return this.prisma.$transaction(async tx=>{const shared=square?await galleryPublicPage(tx,'video',page,size):null;const where:any=shared?{id:{in:shared.ids}}:{deletedAt:trash?{not:null}:null,userId};const [rows,total]=await Promise.all([tx.videoTask.findMany({where,...(shared?{}:{skip:(page-1)*size,take:size}),orderBy:[{createdAt:'desc'},{id:'desc'}]}),shared?Promise.resolve(shared.total):tx.videoTask.count({where})]);if(shared)rows.sort((a,b)=>shared.ids.indexOf(a.id)-shared.ids.indexOf(b.id));return{items:rows.map(row=>this.view(row,userId)),total,page,pageSize:size};});}
  async cancel(userId: string, id: string) { const row = await this.prisma.videoTask.findFirst({ where: { id, userId, deletedAt: null } }); if (!row) throw absent(); if (['SUCCESS', 'FAILED', 'CANCELED'].includes(row.status)) return this.detail(userId, id); if (['SAVING', 'SETTLING'].includes(row.status)) throw bad('成片正在保存与结算，请等待完成'); if (await this.accounting.stop(id, 'CANCELED', '已停止站内等待，未结算预留已释放；外部服务可能继续处理', undefined, userId)) this.runs.abort(id); return this.detail(userId, id); }
  async publish(userId:string,id:string,published:boolean,catId?:string,expectedUpdatedAt?:string){await saveGalleryPublication(this.prisma,userId,'video',id,published,catId,expectedUpdatedAt);return this.detail(userId,id);}
  async remove(userId: string, id: string) { const updated = await this.prisma.videoTask.updateMany({ where: { id, userId, deletedAt: null, status: { in: ['SUCCESS', 'FAILED', 'CANCELED'] } }, data: { deletedAt: new Date(), published: false } }); if (!updated.count) throw bad('请先停止等待，或等待成片保存完成'); return { removed: true }; }
  async restore(userId: string, id: string) { const updated = await this.prisma.videoTask.updateMany({ where: { id, userId, deletedAt: { not: null }, status: { in: ['SUCCESS', 'FAILED', 'CANCELED'] } }, data: { deletedAt: null, published: false } }); if (!updated.count) throw absent(); return this.detail(userId, id); }
  async receipts() { const rows = await this.prisma.videoTask.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }); return { items: rows.map(t => this.view(t, '', true)) }; }
  async checkAgain(id: string) { const update = await this.prisma.videoTask.updateMany({ where: { id, deletedAt: null, status: { in: ['POLLING', 'SAVING', 'SETTLING'] } }, data: { nextCheckAt: new Date() } }); if (!update.count) throw bad('这条任务目前无需续查'); return { arranged: true }; }
}
