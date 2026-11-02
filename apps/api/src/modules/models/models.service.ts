import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { safeFetch } from '../../common/net/safe-fetch';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { modelCapabilities } from './model-capabilities';
import { buildChatRequest } from '../../common/llm/chat-protocol';
import { webSearchMode, WebSearchMode } from '../../common/llm/web-search';
import {
  BindChannelDto,
  CreateChannelDto,
  CreateModelDto,
  UpdateChannelDto,
  UpdateModelDto,
} from './dto/model.dto';

export interface ResolvedChannel {
  webSearchMode?: WebSearchMode | null;
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  priority: number;
  weight: number;
  upstreamName: string;
}

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
  ) {}

  // ---------------- channels ----------------
  async listChannels() {
    const rows = await this.prisma.channel.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { models: true } } },
    });
    // Key 池统计单独聚合（channel_keys 不建关系，保持 provider 无关）
    const pools = await this.prisma.channelKey.groupBy({
      by: ['channelId', 'status'],
      where: { channelId: { in: rows.map((c) => c.id) } },
      _count: { _all: true },
    });
    return rows.map((c) => {
      const mine = pools.filter((p) => p.channelId === c.id);
      return {
        ...this.toChannelView(c),
        poolKeys: mine.reduce((n, p) => n + p._count._all, 0),
        poolKeysEnabled: mine.filter((p) => p.status === 'ENABLED').reduce((n, p) => n + p._count._all, 0),
      };
    });
  }

  private toChannelView(c: any) {
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      baseUrl: c.baseUrl,
      apiKeyMasked: c.apiKeyLast4 ? `****${c.apiKeyLast4}` : '',
      hasApiKey: !!c.apiKeyEnc,
      priority: c.priority,
      weight: c.weight,
      status: c.status,
      timeoutMs: c.timeoutMs,
      extra: c.extra ? JSON.parse(c.extra) : null,
      modelCount: c._count?.models,
      createdAt: c.createdAt,
    };
  }

  async createChannel(dto: CreateChannelDto) {
    const exists = await this.prisma.channel.findUnique({ where: { name: dto.name } });
    if (exists) throw new BusinessException(ErrorCode.PARAM_INVALID, '渠道名已存在');

    const channel = await this.prisma.channel.create({
      data: {
        name: dto.name,
        type: dto.type,
        baseUrl: dto.baseUrl.replace(/\/+$/, ''),
        apiKeyEnc: dto.apiKey ? this.box.encrypt(dto.apiKey) : '',
        apiKeyLast4: dto.apiKey ? dto.apiKey.slice(-4) : '',
        priority: dto.priority ?? 0,
        weight: dto.weight ?? 1,
        timeoutMs: dto.timeoutMs ?? 60000,
        extra: dto.extra ? JSON.stringify(dto.extra) : null,
      },
    });
    return this.toChannelView(channel);
  }

  async updateChannel(id: string, dto: UpdateChannelDto) {
    const patch: any = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl.replace(/\/+$/, '') } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.weight !== undefined ? { weight: dto.weight } : {}),
      ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.extra !== undefined ? { extra: JSON.stringify(dto.extra) } : {}),
    };
    // 留空（不传）表示不修改密钥；显式传空串表示清空（前端“清空密钥”按钮）
    if (typeof dto.apiKey === 'string') {
      if (dto.apiKey) {
        patch.apiKeyEnc = this.box.encrypt(dto.apiKey);
        patch.apiKeyLast4 = dto.apiKey.slice(-4);
      } else {
        patch.apiKeyEnc = '';
        patch.apiKeyLast4 = '';
      }
    }
    const channel = await this.prisma.channel.update({ where: { id }, data: patch });
    return this.toChannelView(channel);
  }

  async removeChannel(id: string) {
    await this.prisma.channel.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISABLED' },
    });
    return { ok: true };
  }

  /**
   * 测试连通：发一次最小请求，只回显状态码 / 延迟 / 截断后的错误摘要。
   * 注意：这不是业务请求，**不计入熔断统计**，也不产生用量记录。
   */
  async testChannel(id: string, keyOverride?: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在', 404);
    // 传了 keyOverride 时测池里的某一把 Key，否则测渠道主 Key
    const apiKey = keyOverride ?? this.safeDecrypt(channel.apiKeyEnc);

    if (channel.type === 'MOCK') {
      return { ok: true, status: 200, latencyMs: 0, note: '本地模拟渠道，无需联网', error: null };
    }

    // 优先用绑定在该渠道上的第一个模型名，否则用一个通用探测名
    const binding = await this.prisma.modelChannel.findFirst({ where: { channelId: id } });
    if (!binding && ['OPENAI_RESPONSES', 'ANTHROPIC', 'GEMINI'].includes(channel.type)) return { ok: false, status: 0, latencyMs: 0, error: '请先为此渠道绑定实际模型，再测试连接' };
    const probeModel = binding?.upstreamName ?? 'gpt-3.5-turbo';

    const started = Date.now();
    try {
      const request = buildChatRequest({ ...channel, apiKey, upstreamName: probeModel }, [{ role: 'user', content: 'ping' }], { maxTokens: channel.type === 'OPENAI_RESPONSES' ? 16 : 1, stream: false });
      const timeoutMs = Math.min(channel.timeoutMs, 15_000);
      const res = await safeFetch(request.url, request.init, { timeoutMs, signal: AbortSignal.timeout(timeoutMs) });

      const reader = res.body?.getReader();
      let raw = '', bytes = 0;
      if (reader) {
        const decoder = new TextDecoder();
        try {
          while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 65536) throw new Error('探测回复过大，请检查接口地址'); raw += decoder.decode(part.value, { stream: true }); }
          raw += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      const text = apiKey ? raw.replaceAll(apiKey, '[已隐藏]') : raw;
      const latencyMs = Date.now() - started;

      if (res.ok) {
        let value: any;
        try { value = JSON.parse(text); } catch { return { ok: false, status: res.status, latencyMs, model: probeModel, error: '接口没有返回有效的探测结果，请核对通信方式和 API 根地址' }; }
        const recognized = channel.type === 'GEMINI' ? Array.isArray(value?.candidates) : channel.type === 'ANTHROPIC' ? Array.isArray(value?.content) : channel.type === 'OPENAI_RESPONSES' ? Array.isArray(value?.output) : Array.isArray(value?.choices);
        if (value?.error || !recognized) return { ok: false, status: res.status, latencyMs, model: probeModel, error: '模型服务返回了错误或其他格式，请核对配置' };
        return { ok: true, status: res.status, latencyMs, model: probeModel, error: null };
      }
      return {
        ok: false,
        status: res.status,
        latencyMs,
        model: probeModel,
        error: text.slice(0, 200),
      };
    } catch (e: any) {
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - started,
        model: probeModel,
        error: (apiKey ? String(e?.message ?? e).replaceAll(apiKey, '[已隐藏]') : String(e?.message ?? e)).slice(0, 200),
      };
    }
  }

  // ---------------- models ----------------
  async listModels() {
    const rows = await this.prisma.aiModel.findMany({
      where: { deletedAt: null },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: {
        channels: {
          include: {
            channel: {
              select: { id: true, name: true, type: true, status: true, deletedAt: true },
            },
          },
        },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      displayName: m.displayName,
      maxContext: m.maxContext,
      maxOutput: m.maxOutput,
      capabilities: modelCapabilities(m.capabilities),
      priceInPerM: m.priceInPerM,
      priceOutPerM: m.priceOutPerM,
      // 模型广场的展示元数据（后台表单要能回填，故原样下发字符串）
      vendor: (m.vendor || '').trim(),
      description: m.description || '',
      tags: m.tags || '',
      badge: m.badge || '',
      // 次数计费：前台充值页需要显示「这个模型每次消耗几次」
      countPool: m.countPool,
      countCost: m.countCost,
      status: m.status,
      sort: m.sort,
      channels: m.channels.map((mc) => ({
        channelId: mc.channelId,
        channelName: mc.channel.name,
        channelType: mc.channel.type,
        channelStatus: mc.channel.status,
        upstreamName: mc.upstreamName,
        weight: mc.weight,
        enabled: mc.enabled,
      })),
    }));
  }

  /** 模型广场 / 对话页模型面板共用的展示结构（绝不带渠道地址与密钥） */
  private toPublicModel(m: any) {
    const bindings: any[] = Array.isArray(m.channels) ? m.channels : [];
    return {
      id: m.id,
      name: m.name,
      displayName: m.displayName,
      vendor: (m.vendor || '').trim(),
      description: m.description || '',
      tags: (m.tags || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
      badge: m.badge || '',
      maxContext: m.maxContext,
      maxOutput: m.maxOutput,
      capabilities: modelCapabilities(m.capabilities),
      webSearchAvailable: modelCapabilities(m.capabilities).includes('web_search') && bindings.some(mc=>mc?.enabled!==false&&mc?.channel?.status==='ENABLED'&&!mc?.channel?.deletedAt&&webSearchMode(mc.channel.type,mc.channel.extra)),
      priceInPerM: m.priceInPerM,
      priceOutPerM: m.priceOutPerM,
      countPool: m.countPool || '',
      countCost: m.countCost || 0,
      // 至少有一条「启用且渠道可用」的绑定，才真的能发起对话
      ready: bindings.some(
        (mc) => mc?.channel?.status === 'ENABLED' && !mc?.channel?.deletedAt,
      ),
    };
  }

  /** 全部已启用模型 + 可用性标记；能直接对话的排在前面 */
  async availableModels() {
    const rows = await this.prisma.aiModel.findMany({
      where: { status: 'ENABLED', deletedAt: null },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      include: {
        channels: {
          where: { enabled: true },
          include: { channel: { select: { status: true, deletedAt: true, type:true, extra:true } } },
        },
      },
    });
    const list = rows.map((m) => this.toPublicModel(m));
    // 不能用的模型仍然展示（便于运营「先上架、后接渠道」），但排在后面
    return list.sort((a, b) => Number(b.ready) - Number(a.ready));
  }

  /**
   * 模型广场：按厂商分组的卡片数据。
   * 与 available 的唯一差别是附带厂商分组统计，卡片字段完全一致。
   */
  async plaza() {
    const models = await this.availableModels();
    const groups = new Map<string, { key: string; label: string; count: number }>();
    for (const m of models) {
      const key = m.vendor || '其他';
      const hit = groups.get(key);
      if (hit) hit.count += 1;
      else groups.set(key, { key, label: key, count: 1 });
    }
    const vendors = [...groups.values()].sort(
      (a, b) => b.count - a.count || a.key.localeCompare(b.key),
    );
    return {
      total: models.length,
      ready: models.filter((m) => m.ready).length,
      vendors,
      models,
    };
  }

  createModel(dto: CreateModelDto) {
    return this.prisma.aiModel.create({ data: { ...dto, ...(dto.capabilities !== undefined ? { capabilities: modelCapabilities(dto.capabilities).join(',') } : {}) } });
  }

  updateModel(id: string, dto: UpdateModelDto) {
    return this.prisma.aiModel.update({ where: { id }, data: { ...dto, ...(dto.capabilities !== undefined ? { capabilities: modelCapabilities(dto.capabilities).join(',') } : {}) } });
  }

  async removeModel(id: string) {
    await this.prisma.aiModel.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISABLED' },
    });
    return { ok: true };
  }

  async bindChannel(modelId: string, dto: BindChannelDto) {
    return this.prisma.modelChannel.upsert({
      where: { modelId_channelId: { modelId, channelId: dto.channelId } },
      create: {
        modelId,
        channelId: dto.channelId,
        upstreamName: dto.upstreamName,
        weight: dto.weight ?? 1,
        enabled: dto.enabled ?? true,
      },
      update: {
        upstreamName: dto.upstreamName,
        weight: dto.weight ?? 1,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async unbindChannel(modelId: string, channelId: string) {
    await this.prisma.modelChannel
      .delete({ where: { modelId_channelId: { modelId, channelId } } })
      .catch(() => void 0);
    return { ok: true };
  }

  // ---------------- routing ----------------
  /**
   * 解析逻辑模型 → 可用渠道列表（含解密后的 apiKey，仅内部使用）。
   * 排序：priority 升序，再按 weight 降序。
   */
  async resolveRoute(modelName: string) {
    const model = await this.prisma.aiModel.findUnique({
      where: { name: modelName },
      include: {
        channels: {
          where: { enabled: true },
          include: { channel: true },
        },
      },
    });

    if (!model || model.deletedAt) {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND, `模型 ${modelName} 不存在`, 404);
    }
    if (model.status !== 'ENABLED') {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND, `模型 ${modelName} 已停用`);
    }

    const channels: ResolvedChannel[] = model.channels
      .filter((mc) => mc.channel.status === 'ENABLED' && !mc.channel.deletedAt)
      .map((mc) => ({
        id: mc.channel.id,
        name: mc.channel.name,
        type: mc.channel.type,
        webSearchMode: webSearchMode(mc.channel.type,mc.channel.extra),
        baseUrl: mc.channel.baseUrl,
        apiKey: this.safeDecrypt(mc.channel.apiKeyEnc),
        timeoutMs: mc.channel.timeoutMs,
        priority: mc.channel.priority,
        weight: mc.weight,
        upstreamName: mc.upstreamName,
      }))
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight);

    if (channels.length === 0) {
      throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE, '该模型暂无可用渠道');
    }

    return { model: { ...model, capabilities: modelCapabilities(model.capabilities).join(',') }, channels };
  }

  private safeDecrypt(enc: string): string {
    if (!enc) return '';
    try {
      return this.box.decrypt(enc);
    } catch (err: any) {
      this.logger.error(`渠道密钥解密失败: ${err?.message}`);
      return '';
    }
  }
}
