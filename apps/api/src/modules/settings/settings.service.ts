import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CONFIG_MAP,
  CONFIG_REGISTRY,
  ConfigValue,
  coerceConfigValue,
  isKnownConfig,
} from '../../common/config/config.registry';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { mailTransportConfiguration } from '../mail/mail-config';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, { value: ConfigValue; at: number }>();
  private readonly ttl = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T extends ConfigValue = ConfigValue>(key: string): Promise<T> {
    const def = CONFIG_MAP.get(key);
    if (!def) {
      this.logger.warn(`读取了未注册的配置项: ${key}`);
      return undefined as unknown as T;
    }

    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttl) return hit.value as T;

    const row = await this.prisma.globalConfig.findUnique({ where: { key } });
    let value: ConfigValue = def.default;

    if (row) {
      try {
        const parsed = coerceConfigValue(def, JSON.parse(row.value));
        if (parsed === null) {
          this.logger.warn(`配置 ${key} 值非法，已回落默认值`);
        } else {
          value = parsed;
        }
      } catch {
        this.logger.warn(`配置 ${key} 不是合法 JSON，已回落默认值`);
      }
    }

    this.cache.set(key, { value, at: Date.now() });
    return value as T;
  }

  async getMany(keys: string[]) {
    const out: Record<string, ConfigValue> = {};
    for (const key of keys) out[key] = await this.get(key);
    return out;
  }

  /** 前台可见（public: true 的项） */
  async publicConfig() {
    const keys = CONFIG_REGISTRY.filter((d) => d.public).map((d) => d.key);
    return this.getMany(keys);
  }

  /** 后台完整列表：注册表 + 当前值 + 元信息 */
  async adminList() {
    return Promise.all(
      CONFIG_REGISTRY.map(async (def) => ({
        key: def.key,
        value: await this.get(def.key),
        defaultValue: def.default,
        type: def.type,
        group: def.group,
        description: def.description,
        public: !!def.public,
      })),
    );
  }

  private parsed(key: string,input: unknown) {
    if (!isKnownConfig(key)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, `未注册的配置项: ${key}`);
    }
    const def = CONFIG_MAP.get(key)!;
    const value = coerceConfigValue(def, input);
    if (value === null) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, `配置 ${key} 的取值不合法`);
    }
    if(key.startsWith('apps.reviewReward.')&&!Number.isSafeInteger(value))throw new BusinessException(ErrorCode.PARAM_INVALID,'创作者奖励需要填写整数次数');
    if(['security.smsDailyLimit','security.externalDailyLimit'].includes(key)&&!Number.isSafeInteger(value))throw new BusinessException(ErrorCode.PARAM_INVALID,key==='security.smsDailyLimit'?'短信申请上限需要填写整数次数':'连接申请上限需要填写整数次数');
    if(key==='security.emailVerificationRequired'&&value===true&&!mailTransportConfiguration(process.env).ready)throw new BusinessException(ErrorCode.PARAM_INVALID,'请先准备发件设置，再开启注册邮箱必验');
    return value;
  }

  async set(key: string, input: unknown, updatedBy?: string) {
    const value=this.parsed(key,input);

    await this.prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value), updatedBy },
      update: { value: JSON.stringify(value), updatedBy },
    });
    this.cache.delete(key);
    return { key, value };
  }

  async setMany(items: { key: string; value: unknown }[], updatedBy?: string) {
    if(new Set(items.map(item=>item.key)).size!==items.length)throw new BusinessException(ErrorCode.PARAM_INVALID,'同一配置项不能重复提交');
    const results=items.map(item=>({key:item.key,value:this.parsed(item.key,item.value)}));
    await this.prisma.$transaction(async tx=>{for(const {key,value}of results)await tx.globalConfig.upsert({where:{key},create:{key,value:JSON.stringify(value),updatedBy},update:{value:JSON.stringify(value),updatedBy}});});
    for(const {key}of results)this.cache.delete(key);
    return { updated: results.length, items: results };
  }

  invalidateAll() {
    this.cache.clear();
  }
}
