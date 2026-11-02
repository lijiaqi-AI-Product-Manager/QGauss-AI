import {galleryPublicPage} from '../gallery/gallery-query';
import {saveGalleryPublication} from '../gallery/gallery-publication';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ModerationService } from '../moderation/moderation.service';
import { StorageService } from '../storage/storage.service';
import { ModelsService } from '../models/models.service';
import { IMAGE_QUALITY_FACTORS } from './image-pricing';
import { imageFeatures } from './image-features';
import { ImageAccountingService } from './image-accounting.service';
import { ImageRunsService } from './image-runs.service';
import { prepareImageInputs } from './image-inputs';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

/** 比例 → 宽高（按档位基准尺寸推导，保证长边落在 1K/2K/4K 附近） */
export const RATIOS = [
  { key: '1:1', label: '方形', scene: '头像 / 产品图', w: 1, h: 1 },
  { key: '3:4', label: '竖版', scene: '社交海报', w: 3, h: 4 },
  { key: '4:3', label: '横版', scene: '文章配图', w: 4, h: 3 },
  { key: '16:9', label: '宽屏', scene: '电脑壁纸', w: 16, h: 9 },
  { key: '9:16', label: '长屏', scene: '手机壁纸', w: 9, h: 16 },
  { key: '2:3', label: '竖版海报', scene: '营销海报', w: 2, h: 3 },
  { key: '3:2', label: '横版海报', scene: '公众号配图', w: 3, h: 2 },
  { key: '2:1', label: '横幅', scene: '宽屏横幅', w: 2, h: 1 },
  { key: '21:9', label: '超宽', scene: '长屏壁纸', w: 21, h: 9 },
] as const;

export const RESOLUTIONS = [
  { key: '1K', base: 1024, label: '1K' },
  { key: '2K', base: 2048, label: '2K' },
  { key: '4K', base: 3072, label: '4K' },
] as const;

export const QUALITIES = ['low', 'medium', 'high', 'auto'] as const;

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 历史脏数据 / 半截写入不能把整个列表打成 500
    return fallback;
  }
}

/** 由比例 + 档位算实际像素尺寸；比例非法时回落到 1:1 */
export function sizeOf(ratio: string, resolution: string): string {
  const r = RATIOS.find((x) => x.key === ratio) ?? RATIOS[0];
  const res = RESOLUTIONS.find((x) => x.key === resolution) ?? RESOLUTIONS[0];
  const base = res.base;
  const long = Math.max(r.w, r.h);
  const w = Math.round((base * r.w) / long / 16) * 16;
  const h = Math.round((base * r.h) / long / 16) * 16;
  return `${w}x${h}`;
}

function view(task: any) {
  const inputs = safeJson<any>(task.inputJson, null);
  const referenceIds = Array.isArray(inputs?.references) ? inputs.references.filter(file => typeof file?.id === 'string').map(file => file.id) : undefined;
  const storedResults = task.status === 'SUCCESS' ? safeJson<any[]>(task.resultJson, []) : [];
  const prefix = (process.env.API_PREFIX ?? 'api').replace(/^\/+|\/+$/g, '');
  const results = (Array.isArray(storedResults) ? storedResults : [])
    .filter(result => result && typeof result.fileId === 'string' && result.fileId.length > 0)
    .map(result => ({ ...result, url: `/${prefix}/image/tasks/${encodeURIComponent(task.id)}/results/${encodeURIComponent(result.fileId)}` }));
  return {
    id: task.id,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    model: task.model,
    versionName: task.versionName,
    provider: task.provider,
    mode: task.mode,
    ratio: task.ratio,
    resolution: task.resolution,
    quality: task.quality,
    seed: task.seed,
    catId: task.catId,
    published: task.published,
    recommended: task.recommended,
    parentId: task.parentId,
    action: task.action,
    editOf: task.editOf,
    referenceIds,
    maskId: typeof inputs?.mask?.id === 'string' ? inputs.mask.id : undefined,
    size: task.size,
    n: task.n,
    status: task.status,
    progress: task.progress,
    results,
    meta: safeJson<any>(task.metaJson, null),
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    publishedAt:task.publishedAt,updatedAt:task.updatedAt,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    billing: task.billingUnitCost == null ? { state: 'LEGACY' } : {
      state: task.billingState, unitCost: task.billingUnitCost,
      reserved: task.billingState === 'RESERVED' ? task.reservedAmount : 0,
      limit: task.reservedAmount, charged: task.chargedAmount,
      returned: task.returnedAmount, expired: task.expiredAmount,
    },
    // 作品详情页「创意参数」串：模型|尺寸|画质|格式|比例|张数
    spec:
      `${task.versionName || task.model || '站点默认模型'}｜${task.size}｜${task.quality}｜${task.ratio}｜×${task.n}`.trim(),
  };
}

@Injectable()
export class ImageService {
  private readonly preparingInputs = new Set<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly accounting: ImageAccountingService,
    private readonly moderation: ModerationService,
    private readonly storage: StorageService,
    private readonly models: ModelsService,
    private readonly runs: ImageRunsService,
  ) {}

  /** 工作台可选参数：比例/档位/画质/风格分类/模型版本（前端一次拉齐，避免硬编码） */
  async options() {
    const [cats, models, commerce, demo, cost, defaultChannel, defaultModel] = await Promise.all([
      this.prisma.creationCat.findMany({ where: { status: true }, orderBy: { sort: 'asc' } }),
      this.prisma.aiModel.findMany({
        where: { deletedAt: null, status: 'ENABLED' },
        orderBy: { sort: 'asc' },
        select: { name: true, displayName: true, capabilities: true, channels: { where: { enabled: true, channel: { status: 'ENABLED', deletedAt: null } }, select: { weight: true, upstreamName: true, channel: { select: { type: true, priority: true } } } } },
      }),
      this.settings.get<boolean>('commerce.enabled'),
      this.settings.get<boolean>('demo.siteEnabled'),
      this.settings.get<number>('commerce.imageCost'),
      this.defaultChannel(),
      this.settings.get<string>('image.model'),
    ]);
    const imageModels = models.filter((m) => (m.capabilities ?? '').includes('image'));
    return {
      ratios: RATIOS.map((r) => ({ ...r })),
      resolutions: RESOLUTIONS.map((r) => ({ ...r })),
      qualities: QUALITIES.map((q) => ({ key: q })),
      modes: [
        { key: 'text2img', label: '文生图' },
        { key: 'img2img', label: '图生图' },
      ],
      cats,
      models: imageModels.map(m => { const bindings = m.channels.sort((a, b) => a.channel.priority - b.channel.priority || b.weight - a.weight); return { name: m.name, displayName: m.displayName, capabilities: m.capabilities, ready: bindings.length > 0, features: imageFeatures(bindings[0]?.channel.type ?? '', bindings[0]?.upstreamName) }; }),
      defaultFeatures: imageFeatures(defaultChannel?.type ?? '', defaultModel || (defaultChannel?.type === 'GEMINI' ? process.env.NANO_BANANA_MODEL || 'gemini-2.5-flash-image' : '')),
      billing: { enabled: !!commerce && !demo && Number.isFinite(Number(cost)) && Number(cost) > 0, costPerImage: Number(cost) || 0, qualityFactors: IMAGE_QUALITY_FACTORS, pool: 'drawMj', reservation: true },
    };
  }

  private async defaultChannel() {
    const configured = await this.settings.get<string>('image.defaultChannel');
    if (configured) {
      const channel = await this.prisma.channel.findFirst({ where: { id: configured, status: 'ENABLED', deletedAt: null } });
      if (channel) return channel;
    }
    return this.prisma.channel.findFirst({ where: { status: 'ENABLED', deletedAt: null }, orderBy: { priority: 'asc' } });
  }

  async create(
    userId: string,
    data: {
      prompt: string;
      negativePrompt?: string;
      ratio?: string;
      resolution?: string;
      quality?: string;
      seed?: number;
      versionName?: string;
      catId?: string;
      mode?: string;
      parentId?: string;
      action?: string;
      size?: string;
      n?: number;
      model?: string;
      editOf?: string;
      referenceIds?: string[];
      maskId?: string;
      expectedUnitCost?: number;
    },
  ) {
    const prompt = data.prompt?.trim();
    if (!prompt) throw new BusinessException(ErrorCode.PARAM_INVALID, '提示词不能为空');
    if (prompt.length > 4000) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '提示词最多 4000 字');
    }

    // 敏感词：提交前拦截，不排队、不调用上游、不扣费；命中记录进后台
    const hit = await this.moderation.check(`${prompt}\n${data.negativePrompt ?? ''}`);
    if (hit?.action === 'block') {
      await this.moderation.recordHit({ userId, word: hit.word, source: 'image', excerpt: prompt });
      const masked = `${hit.word.slice(0, 1)}${'*'.repeat(Math.max(1, hit.word.length - 1))}`;
      throw new BusinessException(ErrorCode.CONTENT_BLOCKED, `提示词包含敏感词「${masked}」，已被拦截`, 400);
    }

    const editOf = data.referenceIds?.[0] || data.editOf;
    if (data.referenceIds && data.editOf && data.editOf !== data.referenceIds[0]) throw new BusinessException(ErrorCode.PARAM_INVALID, '主图与参考图顺序不一致，请重新选择');
    if (data.mode === 'text2img' && (data.referenceIds || data.maskId)) throw new BusinessException(ErrorCode.PARAM_INVALID, '请切换到参考图创作后再使用参考图和选区');
    if ((data.mode === 'img2img' || data.maskId) && !editOf) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '图生图需要选择参考图');
    }
    // 图生图：参考图必须属于当前用户且确实为图片。
    if (editOf && !data.referenceIds && !data.maskId) {
      const file = await this.prisma.uploadFile.findFirst({
        where: { id: editOf, userId, deletedAt: null },
        select: { id: true, mime: true },
      });
      if (!file) throw new BusinessException(ErrorCode.PARAM_INVALID, '参考图不存在');
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.mime)) throw new BusinessException(ErrorCode.PARAM_INVALID, '参考文件必须是 PNG、JPEG、WebP 或 GIF 图片');
    }

    // 二级操作（变体/放大/重绘）必须指向自己的、且已成功的任务
    if (data.parentId) {
      const parent = await this.prisma.imageTask.findFirst({
        where: { id: data.parentId, userId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!parent) throw new BusinessException(ErrorCode.PARAM_INVALID, '来源作品不存在');
      if (parent.status !== 'SUCCESS') {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '来源作品尚未生成完成');
      }
    }

    let modelName = '';
    let versionName = data.versionName;
    let features;
    if (data.model) {
      const route = await this.models.resolveRoute(data.model);
      if (!(route.model.capabilities ?? '').split(/[\s,]+/).includes('image')) throw new BusinessException(ErrorCode.PARAM_INVALID, '请选择支持绘画的模型');
      modelName = route.model.name;
      versionName = route.model.displayName || route.model.name;
      features = imageFeatures(route.channels[0].type, route.channels[0].upstreamName);
    } else {
      const channel = await this.defaultChannel();
      features = imageFeatures(channel?.type ?? '', (await this.settings.get<string>('image.model')) || (channel?.type === 'GEMINI' ? process.env.NANO_BANANA_MODEL || 'gemini-2.5-flash-image' : ''));
    }
    if (data.quality && !features.qualities.includes(data.quality)) throw new BusinessException(ErrorCode.PARAM_INVALID, '所选模型不支持此画质，请选择自动');
    if (data.resolution && !features.resolutions.includes(data.resolution)) throw new BusinessException(ErrorCode.PARAM_INVALID, '所选模型不支持此分辨率');
    if (data.ratio && !features.ratios.includes(data.ratio)) throw new BusinessException(ErrorCode.PARAM_INVALID, '所选模型不支持此比例');
    let inputJson: string | undefined;
    if (data.referenceIds || data.maskId) {
      const ids = data.referenceIds || [editOf!];
      if (ids.length > features.maxReferences) throw new BusinessException(ErrorCode.PARAM_INVALID, `所选模型最多支持 ${features.maxReferences} 张参考图`);
      if (data.maskId && !features.mask) throw new BusinessException(ErrorCode.PARAM_INVALID, '所选模型未开放局部重绘，请移除选区或更换模型');
      if (this.preparingInputs.has(userId) || this.preparingInputs.size >= 4) throw new BusinessException(ErrorCode.RATE_LIMITED, '参考图正在处理中，请稍后再试', 429);
      this.preparingInputs.add(userId);
      try { const prepared = await prepareImageInputs(this.storage, userId, ids, data.maskId); inputJson = JSON.stringify(prepared.snapshot); }
      finally { this.preparingInputs.delete(userId); }
    }
    const n = Math.min(Math.max(data.n ?? 1, 1), 4);

    const ratio = RATIOS.some((r) => r.key === data.ratio) ? data.ratio! : '1:1';
    const resolution = RESOLUTIONS.some((r) => r.key === data.resolution) ? data.resolution! : '1K';
    const quality = QUALITIES.includes((data.quality ?? 'auto') as any) ? data.quality ?? 'auto' : 'auto';
    const unitCost = await this.accounting.quote(quality);
    if (data.expectedUnitCost !== undefined && data.expectedUnitCost !== unitCost) throw new BusinessException(ErrorCode.PARAM_INVALID, '绘画费用已更新，请确认新费用后再次生成', 409);
    return this.prisma.$transaction(async tx => {
    // Insert first so admission and reservation share a write lock before reading balances.
    const task = await tx.imageTask.create({
      data: {
        userId,
        prompt,
        negativePrompt: data.negativePrompt,
        editOf,
        inputJson,
        model: modelName,
        versionName,
        ratio,
        resolution,
        quality,
        seed: Number.isFinite(data.seed) ? Math.trunc(data.seed as number) : null,
        catId: data.catId || null,
        mode: data.mode === 'img2img' || editOf ? 'img2img' : 'text2img',
        parentId: data.parentId || null,
        action: data.action || null,
        size: data.size || sizeOf(ratio, resolution),
        n,
        status: 'QUEUED',
      },
    });

    const pending = await tx.imageTask.count({ where: { userId, status: { in: ['QUEUED', 'RUNNING', 'SETTLING'] }, deletedAt: null } });
    if (pending > 5) throw new BusinessException(ErrorCode.RATE_LIMITED, '排队任务过多，请等待完成后再试', 429);
    const accepted = await this.accounting.reserveTaskTx(tx, task, unitCost);
    await tx.imageTaskEvent.create({ data: { taskId: task.id, status: 'QUEUED', message: accepted.reservedAmount ? `任务已进入队列，已预留 ${accepted.reservedAmount} 次` : '任务已进入队列' } });
    return view(accepted);
    });
  }

  async list(
    userId: string,
    opts: { page?: number; pageSize?: number; status?: string; catId?: string } = {},
  ) {
    const safePage = Number.isFinite(opts.page) ? Math.max(1, Math.floor(opts.page!)) : 1;
    const safeSize = Number.isFinite(opts.pageSize)
      ? Math.min(100, Math.max(1, Math.floor(opts.pageSize!)))
      : 20;
    const where: any = { userId, deletedAt: null };
    if (opts.status) where.status = opts.status;
    if (opts.catId) where.catId = opts.catId;

    const [items, total] = await Promise.all([
      this.prisma.imageTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.imageTask.count({ where }),
    ]);
    return { items: items.map(view), total, page: safePage, pageSize: safeSize };
  }

  /** 绘画广场：所有人已发布的作品，推荐在前 */
  async square(opts: { page?: number; pageSize?: number; catId?: string } = {}) {
    const safePage = Number.isFinite(opts.page) ? Math.max(1, Math.floor(opts.page!)) : 1;
    const safeSize = Number.isFinite(opts.pageSize)
      ? Math.min(60, Math.max(1, Math.floor(opts.pageSize!)))
      : 24;
    return this.prisma.$transaction(async tx=>{
    const {ids,total}=await galleryPublicPage(tx,'image',safePage,safeSize,opts.catId,true);
    const rows=await tx.imageTask.findMany({where:{id:{in:ids}}});rows.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));

    // 作者名脱敏（广场不暴露完整账号）
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, maskName(u.username)]));

    return {
      items: rows.map((r) => ({ ...view(r), parentId:null,meta:undefined,editOf: null, referenceIds: undefined, maskId: undefined, billing: undefined, author: nameOf.get(r.userId) ?? '匿名用户' })),
      total,
      page: safePage,
      pageSize: safeSize,
    };
    });
  }

  private async visibleTask(userId: string, id: string) {
    const task = await this.prisma.imageTask.findUnique({ where: { id } });
    // 广场作品对所有人可见；其余只对作者可见，且一律不泄露「是否存在别人的任务」
    if (!task || task.deletedAt) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在', 404);
    }
    if (task.userId !== userId && (!task.published || task.status !== 'SUCCESS' || !await this.prisma.user.findFirst({where:{id:task.userId,status:'ACTIVE',deletedAt:null},select:{id:true}}))) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在', 404);
    }
    return task;
  }

  /** Only declared output files may cross the task's publication boundary. */
  async result(userId: string, id: string, fileId: string) {
    const task = await this.visibleTask(userId, id);
    if (task.status !== 'SUCCESS') throw new BusinessException(ErrorCode.NOT_FOUND, '作品尚未完成保存与结算', 404);
    const results = safeJson<any[]>(task.resultJson, []);
    if (!Array.isArray(results) || !results.some(result => result?.fileId === fileId)) throw new BusinessException(ErrorCode.NOT_FOUND, '作品图片不存在', 404);
    const metadata=await this.storage.detail(fileId,task.userId,'USER');
    if(metadata.scope!=='image')throw new BusinessException(ErrorCode.NOT_FOUND,'作品图片不存在',404);
    const file = await this.storage.read(fileId, task.userId, 'USER');
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.mime)) throw new BusinessException(ErrorCode.NOT_FOUND, '作品图片不存在', 404);
    await this.visibleTask(userId,id);
    return file;
  }

  async detail(userId: string, id: string) {
    const task = await this.visibleTask(userId, id);
    const mine = task.userId === userId;
    const events = mine ? await this.prisma.imageTaskEvent.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    }) : [];
    const data = view(task);
    return { ...data, parentId:mine?data.parentId:null,meta:mine?data.meta:undefined,editOf: mine ? task.editOf : null, referenceIds: mine ? data.referenceIds : undefined, maskId: mine ? data.maskId : undefined, billing: mine ? data.billing : undefined, events, mine };
  }

  /** 发布 / 取消发布到绘画广场 */
  async publish(userId:string,id:string,published:boolean,catId?:string,expectedUpdatedAt?:string){const row=await saveGalleryPublication(this.prisma,userId,'image',id,published,catId,expectedUpdatedAt);return{ok:true,published:row.published,catId:row.catId,publishedAt:row.publishedAt,updatedAt:row.updatedAt};}

  /** 软删除：后台「一键清理」再物理删除 */
  async remove(userId: string, id: string) {
    const task = await this.prisma.imageTask.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!task) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在', 404);
    if (['QUEUED', 'RUNNING', 'SETTLING'].includes(task.status)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '任务进行中，请先取消');
    }
    await this.prisma.imageTask.update({
      where: { id },
      data: { deletedAt: new Date(), published: false },
    });
    return { ok: true };
  }

  async cancel(userId: string, id: string) {
    const task = await this.prisma.imageTask.findUnique({ where: { id } });
    if (!task || task.userId !== userId || task.deletedAt) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在', 404);
    }
    if (!['QUEUED', 'RUNNING'].includes(task.status)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, task.status === 'SETTLING' ? '作品正在保存与结算，请等待完成' : '任务已结束，无法取消');
    }
    if (!(await this.accounting.stop(id, 'CANCELED', '用户取消，未使用的预留次数已释放', userId))) throw new BusinessException(ErrorCode.PARAM_INVALID, '任务已进入保存或已经结束，无法取消');
    this.runs.cancel(id);
    return { ok: true };
  }
}

/** 广场作者名脱敏：保留首尾各 1 位 */
function maskName(name: string): string {
  if (!name) return '匿名用户';
  if (name.length <= 2) return name[0] + '*';
  return name[0] + '*'.repeat(Math.min(3, name.length - 2)) + name[name.length - 1];
}
