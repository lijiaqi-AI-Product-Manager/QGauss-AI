import { Injectable } from '@nestjs/common';

/**
 * 进程内令牌桶限流。
 *
 * 单实例够用；多实例部署时把 buckets 换成 Redis 即可（接口不变）。
 * 采用"固定窗口 + 滑动余额"的简化实现：窗口内每来一次扣一个令牌，
 * 窗口结束后补满。
 */
interface Bucket {
  tokens: number;
  resetAt: number;
  /** 记录建桶时的上限：配置改了要立即生效，不能等窗口过期 */
  limit: number;
}

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  /** 返回 true 表示放行，false 表示超限 */
  tryConsume(key: string, limit: number, windowMs = 60_000): boolean {
    if (!limit || limit <= 0) return true;

    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now || bucket.limit !== limit) {
      this.buckets.set(key, { tokens: limit - 1, resetAt: now + windowMs, limit });
      return true;
    }
    if (bucket.tokens <= 0) return false;

    bucket.tokens -= 1;
    return true;
  }

  /** 剩余可用次数（用于响应头/调试） */
  remaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= Date.now()) return -1;
    return Math.max(0, bucket.tokens);
  }

  private sweep(now: number) {
    // 每分钟清一次过期桶，避免内存无限增长
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
