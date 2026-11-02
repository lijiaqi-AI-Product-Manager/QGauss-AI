import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

/** 一次请求实际使用的 Key；ref 用于冷却 / 排除，id 为空表示渠道主 Key 或「无需鉴权」 */
export interface PoolKey {
  ref: string;
  id: string | null;
  apiKey: string;
  weight: number;
}

const CACHE_TTL_MS = 10_000;
const DEFAULT_COOLDOWN_MS = 30_000;
const AUTH_COOLDOWN_MS = 10 * 60_000;
const TOUCH_INTERVAL_MS = 60_000;

/** 这些错误是「这把 Key」的问题，而不是渠道的问题：换同渠道的另一把 Key 即可 */
const KEY_LEVEL_ERRORS = new Set(['upstream_auth', 'upstream_rate_limited']);

/**
 * 渠道 Key 池
 *
 * 候选 = 渠道主 Key（channels.apiKeyEnc）+ channel_keys 里启用的 Key，按权重轮询。
 *   - 401/403：池内 Key 落库禁用（管理员确认后手动恢复）；主 Key 改不了配置，只做长冷却
 *   - 429：只冷却这把 Key
 * 渠道一把 Key 都没配时返回空 Key：本地 / 内网上游（Ollama、假上游）本来就不需要鉴权。
 *
 * 冷却与轮询游标是运行时状态，放内存；多实例时和熔断器一起换成 Redis 实现。
 */
@Injectable()
export class KeyPoolService {
  private readonly logger = new Logger(KeyPoolService.name);
  private readonly cooldowns = new Map<string, number>();
  private readonly cursors = new Map<string, number>();
  private readonly cache = new Map<string, { at: number; keys: PoolKey[] }>();
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
  ) {}

  isKeyLevel(errorCode: string) {
    return KEY_LEVEL_ERRORS.has(errorCode);
  }

  /** 选一把可用 Key；null 表示配置了 Key 但此刻全部不可用（禁用或冷却中） */
  async pick(channel: { id: string; apiKey: string }, exclude: Set<string> = new Set()): Promise<PoolKey | null> {
    const all = await this.candidates(channel);
    if (all.length === 0) return { ref: `none:${channel.id}`, id: null, apiKey: '', weight: 1 };

    const usable = this.usable(all, exclude);
    if (usable.length === 0) return null;

    const total = usable.reduce((n, k) => n + k.weight, 0);
    const cursor = this.cursors.get(channel.id) ?? 0;
    this.cursors.set(channel.id, cursor + 1);
    let n = cursor % total;
    for (const k of usable) {
      if (n < k.weight) return k;
      n -= k.weight;
    }
    return usable[0];
  }

  /** 排除已试过的 Key 后，同渠道是否还有可用 Key（决定同渠道换 Key 还是换渠道） */
  async hasAlternative(channel: { id: string; apiKey: string }, exclude: Set<string>) {
    return this.usable(await this.candidates(channel), exclude).length > 0;
  }

  async reportFailure(channelId: string, key: PoolKey, errorCode: string, cooldownMs?: number) {
    if (key.ref.startsWith('none:')) return;
    const auth = errorCode === 'upstream_auth';
    if (auth && key.id) {
      await this.prisma.channelKey
        .update({
          where: { id: key.id },
          data: { status: 'DISABLED', disabledAt: new Date(), lastError: errorCode, failCount: { increment: 1 } },
        })
        .catch(() => void 0);
      this.cache.delete(channelId);
      this.logger.warn(`渠道 ${channelId} 的 Key ${key.id} 鉴权失败，已自动禁用`);
      return;
    }
    this.cooldowns.set(key.ref, Date.now() + (auth ? AUTH_COOLDOWN_MS : (cooldownMs ?? DEFAULT_COOLDOWN_MS)));
    if (key.id) {
      void this.prisma.channelKey
        .update({ where: { id: key.id }, data: { lastError: errorCode, failCount: { increment: 1 } } })
        .catch(() => void 0);
    }
  }

  /** 成功只更新 lastUsedAt，并且每把 Key 每分钟最多写一次库 */
  reportSuccess(key: PoolKey) {
    this.cooldowns.delete(key.ref);
    if (!key.id) return;
    const now = Date.now();
    if (now - (this.touched.get(key.id) ?? 0) < TOUCH_INTERVAL_MS) return;
    this.touched.set(key.id, now);
    void this.prisma.channelKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => void 0);
  }

  /** 冷却中的 Key 引用 → 剩余毫秒（后台展示用） */
  coolingMs(ref: string) {
    return Math.max(0, (this.cooldowns.get(ref) ?? 0) - Date.now());
  }

  // ---------------- 后台管理 ----------------

  async list(channelId: string) {
    await this.assertChannel(channelId);
    const rows = await this.prisma.channelKey.findMany({
      where: { channelId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((k) => ({
      id: k.id,
      masked: `****${k.last4}`,
      weight: k.weight,
      status: k.status,
      failCount: k.failCount,
      lastError: k.lastError,
      lastUsedAt: k.lastUsedAt,
      disabledAt: k.disabledAt,
      coolingMs: this.coolingMs(k.id),
      createdAt: k.createdAt,
    }));
  }

  /** 批量导入：一行一把，自动去空白、去重；已存在的跳过 */
  async addBatch(channelId: string, keys: string[], weight = 1) {
    await this.assertChannel(channelId);
    const clean = [...new Set(keys.map((k) => k.trim()).filter((k) => k.length >= 4))];
    let added = 0;
    for (const key of clean) {
      try {
        await this.prisma.channelKey.create({
          data: {
            channelId,
            keyEnc: this.box.encrypt(key),
            keyHash: this.hash(key),
            last4: key.slice(-4),
            weight: Math.max(1, Math.min(100, Math.trunc(weight))),
          },
        });
        added += 1;
      } catch {
        /* 唯一键冲突 = 重复 Key，跳过 */
      }
    }
    this.cache.delete(channelId);
    return { added, skipped: keys.length - added };
  }

  async update(channelId: string, keyId: string, data: { status?: 'ENABLED' | 'DISABLED'; weight?: number }) {
    await this.assertKey(channelId, keyId);
    const row = await this.prisma.channelKey.update({
      where: { id: keyId },
      data: {
        ...(data.weight !== undefined ? { weight: Math.max(1, Math.min(100, Math.trunc(data.weight))) } : {}),
        ...(data.status === 'ENABLED' ? { status: 'ENABLED', disabledAt: null, failCount: 0, lastError: null } : {}),
        ...(data.status === 'DISABLED' ? { status: 'DISABLED', disabledAt: new Date() } : {}),
      },
    });
    if (data.status === 'ENABLED') this.cooldowns.delete(keyId);
    this.cache.delete(channelId);
    return { id: row.id, status: row.status, weight: row.weight };
  }

  async remove(channelId: string, keyId: string) {
    await this.assertKey(channelId, keyId);
    await this.prisma.channelKey.delete({ where: { id: keyId } });
    this.cache.delete(channelId);
    return { ok: true };
  }

  /** 批量删除：指定 ids，或删除全部已禁用的 Key */
  async bulkRemove(channelId: string, data: { ids?: string[]; disabledOnly?: boolean }) {
    await this.assertChannel(channelId);
    const ids = [...new Set(data.ids ?? [])];
    if (ids.length === 0 && !data.disabledOnly) return { count: 0 };
    const res = await this.prisma.channelKey.deleteMany({
      where: {
        channelId,
        OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(data.disabledOnly ? [{ status: 'DISABLED' }] : [])],
      },
    });
    this.cache.delete(channelId);
    return { count: res.count };
  }

  /** 取单把 Key 的明文，只给「测试连通」用，不出接口 */
  async revealForTest(channelId: string, keyId: string) {
    await this.assertKey(channelId, keyId);
    const row = await this.prisma.channelKey.findUnique({ where: { id: keyId } });
    return row ? this.decrypt(row.keyEnc) : '';
  }

  // ---------------- 内部 ----------------

  private usable(all: PoolKey[], exclude: Set<string>) {
    const now = Date.now();
    return all.filter((k) => !exclude.has(k.ref) && (this.cooldowns.get(k.ref) ?? 0) <= now);
  }

  private async candidates(channel: { id: string; apiKey: string }): Promise<PoolKey[]> {
    const hit = this.cache.get(channel.id);
    let pooled: PoolKey[];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      pooled = hit.keys;
    } else {
      const rows = await this.prisma.channelKey.findMany({
        where: { channelId: channel.id, status: 'ENABLED' },
        orderBy: { createdAt: 'asc' },
      });
      pooled = rows
        .map((r) => ({ ref: r.id, id: r.id, apiKey: this.decrypt(r.keyEnc), weight: Math.max(1, r.weight) }))
        .filter((k) => k.apiKey);
      this.cache.set(channel.id, { at: Date.now(), keys: pooled });
    }
    const main: PoolKey[] = channel.apiKey
      ? [{ ref: `main:${channel.id}`, id: null, apiKey: channel.apiKey, weight: 1 }]
      : [];
    return [...main, ...pooled];
  }

  private decrypt(enc: string) {
    try {
      return this.box.decrypt(enc);
    } catch (err: any) {
      this.logger.error(`池内 Key 解密失败: ${err?.message}`);
      return '';
    }
  }

  private hash(key: string) {
    return createHash('sha256').update(key).digest('hex');
  }

  private async assertChannel(channelId: string) {
    const hit = await this.prisma.channel.findFirst({ where: { id: channelId, deletedAt: null }, select: { id: true } });
    if (!hit) throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在', 404);
  }

  private async assertKey(channelId: string, keyId: string) {
    const hit = await this.prisma.channelKey.findFirst({ where: { id: keyId, channelId }, select: { id: true } });
    if (!hit) throw new BusinessException(ErrorCode.NOT_FOUND, 'Key 不存在', 404);
  }
}
